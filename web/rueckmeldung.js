/**
 * Kontovia – Rückmeldungen online.
 *
 * Wer Feedback gibt, schickt es in den Cloud-Speicher des Projekts
 * (Ordner feedback/ im selben Bucket wie die Tresore, siehe
 * firebase/storage.rules). Dazu braucht es kein Konto: Anlegen darf jeder,
 * aber nur kleine Dateien mit festem Namen, und nichts lässt sich danach
 * ändern.
 *
 * Lesen, Auflisten und Löschen darf seit 2.27 nur der Betreiber, angemeldet
 * mit seinem Google-Konto: Das Entwicklermenü schickt die Anmeldung der Cloud
 * mit (`kopf`, bridge.js), die Regeln prüfen sie. Bis 2.26 ging das ohne
 * Anmeldung für jeden. Gesendet wird nur, was die
 * Person im Rückmeldefenster sieht und bestätigt:
 * Art, Text, Name der Seite, Programmversion, Fenstergröße und auf Wunsch ein
 * Bildschirmfoto. Nichts aus der Buchhaltung, keine Kennung, keine E-Mail.
 * Anders als der Tresor ist das nicht verschlüsselt, der Absender wird im
 * Fenster darauf hingewiesen.
 */

import { request, requestJson } from './netz.js';
import BUILTIN from './cloudconfig.js';

const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';
const enc = encodeURIComponent;

export const ID_RE = /^fb_[a-f0-9]{18}$/;
export const ARTEN = ['idee', 'fehler', 'frage', 'lob'];
export const MAX_JSON = 40 * 1024;
export const MAX_FOTO = 4 * 1024 * 1024;

const text = (v, n) => String(v ?? '').slice(0, n);

/** Genau die Felder, die das Fenster zeigt, in fester Form und Länge. */
export function paket(e) {
  if (!ID_RE.test(String(e?.id))) throw new Error('Ungültige Kennung der Rückmeldung.');
  return {
    id: e.id,
    createdAt: text(e.createdAt, 30),
    art: ARTEN.includes(e.art) ? e.art : 'idee',
    text: text(e.text, 5000),
    ansicht: text(e.ansicht, 80),
    version: text(e.version, 20),
    fenster: text(e.fenster, 20),
    foto: !!e.foto,
  };
}

function bucket(cfg) {
  const b = cfg?.bucket || BUILTIN.firebase?.bucket;
  if (!b) throw new Error('Es ist kein Cloud-Speicher hinterlegt.');
  return b;
}

async function hochladen(b, name, bytes, typ, headers = {}) {
  return requestJson(`${STORAGE}/${enc(b)}/o?uploadType=media&name=${enc(name)}`, {
    method: 'POST', headers: { 'content-type': typ, ...headers }, body: bytes, timeoutMs: 60000,
  });
}

function fehlerDeutlich(err) {
  if (err?.status === 403 || err?.status === 401) return Object.assign(new Error('Der Server hat die Rückmeldung abgelehnt.'), { status: err.status });
  return err;
}

/**
 * Sendet eine Rückmeldung. Das Foto zuerst, damit niemand eine Rückmeldung
 * ohne ihr Bild findet; schlägt das Foto fehl, geht nichts hinaus.
 * Die Regeln erlauben nur Neues: Ein zweiter Versuch mit derselben Kennung wird
 * abgelehnt, deshalb zählt die Oberfläche die Versuche und gibt irgendwann auf.
 */
export async function senden({ eintrag, fotoBytes = null }, cfg = null) {
  const b = bucket(cfg);
  const daten = paket({ ...eintrag, foto: !!fotoBytes });
  const json = new TextEncoder().encode(JSON.stringify(daten));
  if (json.length >= MAX_JSON) throw new Error('Die Rückmeldung ist zu lang.');
  if (fotoBytes && fotoBytes.length >= MAX_FOTO) throw new Error('Das Bildschirmfoto ist zu groß.');
  try {
    if (fotoBytes) await hochladen(b, `feedback/${daten.id}.jpg`, fotoBytes, 'image/jpeg');
    await hochladen(b, `feedback/${daten.id}.json`, json, 'application/json');
  } catch (err) {
    throw fehlerDeutlich(err);
  }
  return { ok: true };
}

/* ---- Lesen und Löschen: nur der Betreiber (kopf = Anmeldung der Cloud) ---- */

/** Lädt die eingegangenen Rückmeldungen (neueste zuerst). */
export async function laden(cfg = null, kopf = {}) {
  const b = bucket(cfg);
  const headers = { ...kopf };
  const prefix = 'feedback/';
  const namen = [];
  let seite = '';
  do {
    const url = `${STORAGE}/${enc(b)}/o?prefix=${enc(prefix)}&maxResults=1000${seite ? `&pageToken=${enc(seite)}` : ''}`;
    const data = await requestJson(url, { headers, timeoutMs: 30000 });
    for (const it of data?.items || []) namen.push(String(it.name).slice(prefix.length));
    seite = data?.nextPageToken || '';
  } while (seite && namen.length < 5000);
  const ids = namen.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((i) => ID_RE.test(i));
  const fotos = new Set(namen.filter((n) => n.endsWith('.jpg')).map((n) => n.slice(0, -4)));
  const out = [];
  for (const id of ids.slice(-300)) {
    try {
      const res = await request(`${STORAGE}/${enc(b)}/o/${enc(prefix + id + '.json')}?alt=media`, { headers, timeoutMs: 30000, maxBytes: MAX_JSON * 2 });
      if (res.status !== 200) continue;
      const d = JSON.parse(new TextDecoder().decode(res.body));
      out.push({ ...paket({ ...d, id }), hatFoto: fotos.has(id) });
    } catch { /* eine beschädigte Datei hält die übrigen nicht auf */ }
  }
  return out.sort((a, c) => String(c.createdAt).localeCompare(String(a.createdAt)));
}

export async function foto(id, cfg = null, kopf = {}) {
  if (!ID_RE.test(String(id))) throw new Error('Ungültige Kennung.');
  const res = await request(`${STORAGE}/${enc(bucket(cfg))}/o/${enc(`feedback/${id}.jpg`)}?alt=media`, {
    headers: { ...kopf }, timeoutMs: 60000, maxBytes: MAX_FOTO + 1024,
  });
  if (res.status !== 200) throw new Error(`Das Foto konnte nicht geladen werden (HTTP ${res.status}).`);
  return res.body;
}

export async function loeschen(id, cfg = null, kopf = {}) {
  if (!ID_RE.test(String(id))) throw new Error('Ungültige Kennung.');
  const b = bucket(cfg);
  const headers = { ...kopf };
  for (const ende of ['jpg', 'json']) {
    try {
      await requestJson(`${STORAGE}/${enc(b)}/o/${enc(`feedback/${id}.${ende}`)}`, { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }
  return true;
}
