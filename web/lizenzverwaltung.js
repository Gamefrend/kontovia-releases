/**
 * Kontovia – Lizenzverwaltung des Betreibers (Entwicklermenü).
 *
 * Konten:    konten/<uid>.json legt jedes Konto einmal an, sobald es mit Google angemeldet ist
 *            (firebase.js: kontoMelden): Adresse und Datum. So sieht der Betreiber, wer sich angemeldet hat.
 * Lizenzen:  lizenzen/<email>.json legt nur der Betreiber an: `{v, schein, email, stufe, ab, bis, notiz,
 *            ausgestellt}`. Maßgeblich ist allein der signierte Schein (lizenz.js), die übrigen Felder sind
 *            für die Liste. Lesen darf ihn außer dem Betreiber nur das Konto mit genau dieser Adresse.
 *            Für gmail.com/googlemail.com wird je Schreibweise ein Schein abgelegt (Google meldet beide).
 *
 * Die Regeln (firebase/storage.rules) lassen Auflisten, Schreiben und Löschen nur dem Betreiber zu
 * (`istBetreiber()`); die Anmeldung kommt von der Cloud-Verbindung (`kopf`, bridge.js: betreiberKopf).
 *
 * Signiert wird hier im Browser mit dem privaten Schlüssel aus scripts/lizenz-schluessel.js (privat.jwk).
 * Der Betreiber wählt die Datei je Sitzung; sie wird nicht exportierbar eingelesen, nur im Arbeitsspeicher
 * gehalten und beim Sperren vergessen. Ein Schlüssel, der nicht zum öffentlichen im Programm passt, wird
 * abgelehnt (Scheine damit wären überall ungültig).
 */

import { request, requestJson } from './netz.js';
import BUILTIN from './cloudconfig.js';
import { scheinAusstellen, scheinPruefen, emailNorm, emailVarianten, OEFFENTLICHER_SCHLUESSEL, STUFEN } from './lizenz.js';

const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';
const enc = encodeURIComponent;
const TAG = 86400000;
const MAX_NOTIZ = 200;

const fehler = (code, text) => Object.assign(new Error(text), { code });

function bucket(cfg) {
  const b = cfg?.bucket || BUILTIN.firebase?.bucket;
  if (!b) throw new Error('Es ist kein Cloud-Speicher hinterlegt.');
  return b;
}

/** Wie rueckmeldung.js: 401/403 heißt hier „nicht der Betreiber“ oder Regeln noch nicht veröffentlicht. */
function deutlich(err) {
  if (err?.status === 401 || err?.status === 403) {
    return Object.assign(new Error('Der Cloud-Speicher hat abgelehnt. Angemeldet ist nicht das Konto des Betreibers, oder die neuen Speicherregeln sind noch nicht veröffentlicht.'), { status: err.status, code: 'LIZENZ_RECHTE' });
  }
  return err;
}

/* -------------------------------------------------------------------------- */
/* Signierschlüssel (nur im Arbeitsspeicher)                                   */
/* -------------------------------------------------------------------------- */

let signierer = null;

/** Liest privat.jwk ein. Wirft, wenn es kein privater P-256-Schlüssel ist oder er nicht zum Programm passt. */
export async function schluesselLaden(jwkText, oeffentlich = OEFFENTLICHER_SCHLUESSEL) {
  let jwk;
  try { jwk = JSON.parse(String(jwkText || '')); } catch { jwk = null; }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
    throw fehler('LIZENZ_SCHLUESSEL', 'Das ist keine Schlüsseldatei für Lizenzen (privat.jwk).');
  }
  if (jwk.x !== oeffentlich.x || jwk.y !== oeffentlich.y) {
    throw fehler('LIZENZ_SCHLUESSEL', 'Dieser Schlüssel passt nicht zum Programm. Scheine damit wären ungültig.');
  }
  const { kty, crv, x, y, d } = jwk;
  signierer = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { geladen: true };
}

export const schluesselDa = () => !!signierer;
export function schluesselVergessen() { signierer = null; }

/* -------------------------------------------------------------------------- */
/* Speicher                                                                    */
/* -------------------------------------------------------------------------- */

async function liste(b, prefix, kopf) {
  const namen = [];
  let seite = '';
  do {
    const url = `${STORAGE}/${enc(b)}/o?prefix=${enc(prefix)}&maxResults=1000${seite ? `&pageToken=${enc(seite)}` : ''}`;
    const data = await requestJson(url, { headers: { ...kopf }, timeoutMs: 30000 });
    for (const it of data?.items || []) namen.push({ name: String(it.name).slice(prefix.length), updated: it.updated || '' });
    seite = data?.nextPageToken || '';
  } while (seite && namen.length < 5000);
  return namen.filter((n) => n.name.endsWith('.json') && !n.name.includes('/'));
}

async function jsonLesen(b, pfad, kopf) {
  const res = await request(`${STORAGE}/${enc(b)}/o/${enc(pfad)}?alt=media`, { headers: { ...kopf }, timeoutMs: 30000, maxBytes: 64 * 1024 });
  if (res.status !== 200) return null;
  try { return JSON.parse(new TextDecoder().decode(res.body)); } catch { return null; }
}

/** Mehrere Dateien parallel lesen, aber nicht alle auf einmal. */
async function alleLesen(b, prefix, eintraege, kopf) {
  const out = [];
  for (let i = 0; i < eintraege.length; i += 8) {
    const teil = eintraege.slice(i, i + 8);
    out.push(...await Promise.all(teil.map(async (e) => ({ ...e, daten: await jsonLesen(b, prefix + e.name, kopf).catch(() => null) }))));
  }
  return out;
}

/**
 * Konten und Lizenzen, zusammengeführt nach Adresse (neueste Anmeldung zuerst).
 * @returns {Promise<{eintraege:Array<{email:string, konten:Array<{uid:string, seit:string}>, lizenz:object|null}>}>}
 */
export async function laden(kopf, cfg = null, schluessel = OEFFENTLICHER_SCHLUESSEL) {
  const b = bucket(cfg);
  try {
    const [konten, lizenzen] = await Promise.all([liste(b, 'konten/', kopf), liste(b, 'lizenzen/', kopf)]);
    const [k, l] = await Promise.all([alleLesen(b, 'konten/', konten, kopf), alleLesen(b, 'lizenzen/', lizenzen, kopf)]);
    const nachEmail = new Map();
    const eintrag = (email) => {
      // gmail.com und googlemail.com sind dasselbe Postfach: eine Zeile, unter gmail.com.
      const schluessel = email.replace(/@googlemail\.com$/, '@gmail.com');
      if (!nachEmail.has(schluessel)) nachEmail.set(schluessel, { email: schluessel, konten: [], lizenz: null });
      return nachEmail.get(schluessel);
    };
    for (const x of k) {
      const email = emailNorm(x.daten?.email);
      if (!email) continue;
      eintrag(email).konten.push({ uid: x.name.slice(0, -5), seit: String(x.daten?.seit || x.updated || '') });
    }
    for (const x of l) {
      const email = emailNorm(x.name.slice(0, -5));
      if (!email || !x.daten) continue;
      let echt = true;
      let s = null;
      try { s = await scheinPruefen(x.daten.schein, schluessel); } catch { echt = false; }
      const e = eintrag(email);
      // Bei gmail/googlemail liegen zwei gleiche Scheine: einer reicht für die Liste.
      if (e.lizenz && e.lizenz.echt) continue;
      e.lizenz = {
        echt, id: s?.id || '', stufe: s?.stufe || String(x.daten.stufe || ''), ab: s?.ab || '', bis: s?.bis || String(x.daten.bis || ''),
        schonfristTage: s?.schonfristTage ?? 0, notiz: String(x.daten.notiz || '').slice(0, MAX_NOTIZ), ausgestellt: String(x.daten.ausgestellt || x.updated || ''),
      };
    }
    const eintraege = [...nachEmail.values()];
    const zuletzt = (e) => [...e.konten.map((x) => x.seit), e.lizenz?.ausgestellt || ''].sort().pop() || '';
    eintraege.sort((a, c) => zuletzt(c).localeCompare(zuletzt(a)));
    return { eintraege };
  } catch (err) {
    throw deutlich(err);
  }
}

/**
 * Einer Adresse eine Lizenz zuweisen (oder sie ersetzen): Schein signieren und ablegen.
 * @param {{email:string, stufe:string, tage:number, schonfrist?:number, notiz?:string}} angaben
 */
export async function zuweisen(kopf, angaben, cfg = null, jetzt = Date.now()) {
  if (!signierer) throw fehler('LIZENZ_SCHLUESSEL', 'Zuerst die Schlüsseldatei (privat.jwk) wählen.');
  const email = emailNorm(angaben?.email);
  if (!email) throw fehler('LIZENZ_EMAIL', 'Bitte eine gültige E-Mail-Adresse eingeben.');
  const stufe = String(angaben?.stufe || '');
  if (!STUFEN.includes(stufe) || stufe === 'kostenlos') throw fehler('LIZENZ_STUFE', 'Bitte einen Tarif wählen.');
  const tage = Math.floor(Number(angaben?.tage));
  if (!(tage >= 1 && tage <= 3660)) throw fehler('LIZENZ_TAGE', 'Die Laufzeit muss zwischen 1 und 3660 Tagen liegen.');
  const schonfrist = Math.min(60, Math.max(0, Math.floor(Number(angaben?.schonfrist ?? 14)) || 0));
  const notiz = String(angaben?.notiz || '').trim().slice(0, MAX_NOTIZ);
  const b = bucket(cfg);
  const id = `L-${new Date(jetzt).toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const ab = new Date(jetzt).toISOString();
  const bis = new Date(jetzt + tage * TAG).toISOString();
  try {
    for (const variante of emailVarianten(email)) {
      const schein = await scheinAusstellen({ id, stufe, email: variante, ab, bis, schonfrist }, signierer);
      const inhalt = new TextEncoder().encode(JSON.stringify({ v: 1, schein, email: variante, stufe, ab, bis, notiz, ausgestellt: ab }));
      await requestJson(`${STORAGE}/${enc(b)}/o?uploadType=media&name=${enc(`lizenzen/${variante}.json`)}`, {
        method: 'POST', headers: { ...kopf, 'content-type': 'application/json' }, body: inhalt, timeoutMs: 30000,
      });
    }
  } catch (err) {
    throw deutlich(err);
  }
  return { email, id, stufe, ab, bis, schonfristTage: schonfrist, notiz };
}

/** Die Lizenz einer Adresse entziehen. Das Konto fällt beim nächsten Abgleich zurück, spätestens nach der Prüffrist. */
export async function entziehen(kopf, email, cfg = null) {
  const e = emailNorm(email);
  if (!e) throw fehler('LIZENZ_EMAIL', 'Bitte eine gültige E-Mail-Adresse eingeben.');
  const b = bucket(cfg);
  try {
    for (const variante of emailVarianten(e)) {
      try {
        await requestJson(`${STORAGE}/${enc(b)}/o/${enc(`lizenzen/${variante}.json`)}`, { method: 'DELETE', headers: { ...kopf }, timeoutMs: 20000 });
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
  } catch (err) {
    throw deutlich(err);
  }
  return true;
}

/** Einen Eintrag der Kontenliste entfernen (z. B. auf Wunsch der Person). */
export async function kontoEntfernen(kopf, uid, cfg = null) {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(String(uid))) throw new Error('Ungültige Kontokennung.');
  try {
    await requestJson(`${STORAGE}/${enc(bucket(cfg))}/o/${enc(`konten/${uid}.json`)}`, { method: 'DELETE', headers: { ...kopf }, timeoutMs: 20000 });
  } catch (err) {
    if (err.status !== 404) throw deutlich(err);
  }
  return true;
}
