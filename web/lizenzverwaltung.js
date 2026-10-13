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
 * Signiert wird nicht im Browser, sondern von Cloud Functions (functions/): Lizenz zuweisen, Geräteschein und
 * Tarif-Einstellung. Der private Schlüssel (scripts/lizenz-schluessel.js: privat.jwk) liegt einmal auf dem Server
 * (`server/signierschluessel.json`, hier nur hochladen und löschen, nie lesbar) und verlässt ihn nie; die Funktionen
 * lassen nur die bestätigte Adresse des Betreibers zu. Im Programm gibt es keinen Schlüssel zu entsperren.
 *
 * Automatische Lizenz (functions/): Dieselbe Funktionsgruppe signiert Scheine für Konten ohne Lizenz (Testbetrieb: Max,
 * danach Standard). Der Modus liegt in `server/modus.json`. Entzogene Konten bekommen einen Vermerk statt
 * einer gelöschten Datei, sonst legte die Funktion ihnen wieder eine an.
 */

import { request, requestJson } from './netz.js';
import BUILTIN from './cloudconfig.js';
import { scheinPruefen, tarifePruefenSigniert, emailNorm, emailVarianten, OEFFENTLICHER_SCHLUESSEL, STUFEN } from './lizenz.js';
import { utf8 } from './kern.js';

const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';
const enc = encodeURIComponent;
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
/* Signieren über die Cloud Functions                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lizenzen, Gerätescheine und die Tarif-Einstellung signiert eine Cloud Function (functions/): Der Schlüssel liegt
 * auf dem Server (server/signierschluessel.json, hier nur hochladen) und kommt nie ins Programm. Die Funktion prüft
 * selbst, ob die Anmeldung die des Betreibers ist. Gerufen wird mit dem Token der Cloud-Anmeldung (`kopf`).
 */
async function funktion(name, kopf, daten, cfg = null) {
  const projekt = cfg?.projectId || BUILTIN.firebase?.projectId || String(bucket(cfg)).split('.')[0];
  const token = String(kopf?.authorization || '').replace(/^Firebase /, '');
  try {
    const res = await requestJson(`https://europe-west3-${projekt}.cloudfunctions.net/${name}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: utf8(JSON.stringify({ data: daten })), timeoutMs: 30000,
    });
    return res?.result;
  } catch (err) {
    if (err?.status === 404) throw Object.assign(new Error('Die Cloud-Funktion zum Signieren ist noch nicht veröffentlicht.'), { code: 'LIZENZ_FUNKTION', status: 404 });
    if (err?.status === 401 || err?.status === 403) throw Object.assign(new Error('Die Cloud-Funktion hat abgelehnt. Angemeldet ist nicht das Konto des Betreibers.'), { code: 'LIZENZ_RECHTE', status: err.status });
    throw err;
  }
}

/** Prüft privat.jwk: privater P-256-Schlüssel, der zum öffentlichen im Programm passt. Gibt nur die nötigen Felder zurück. */
function jwkPruefen(jwkText, oeffentlich) {
  let jwk;
  try { jwk = JSON.parse(String(jwkText || '')); } catch { jwk = null; }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
    throw fehler('LIZENZ_SCHLUESSEL', 'Das ist keine Schlüsseldatei für Lizenzen (privat.jwk).');
  }
  if (jwk.x !== oeffentlich.x || jwk.y !== oeffentlich.y) {
    throw fehler('LIZENZ_SCHLUESSEL', 'Dieser Schlüssel passt nicht zum Programm. Scheine damit wären ungültig.');
  }
  const { kty, crv, x, y, d } = jwk;
  return { kty, crv, x, y, d };
}

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
      const e = eintrag(email);
      if (x.daten.quelle === 'entzogen') {
        // Vermerk ohne Schein (siehe entziehen): zählt nicht als Lizenz, hält aber die automatische fern.
        if (!e.lizenz) e.lizenz = { echt: false, entzogen: true, id: '', stufe: '', ab: '', bis: '', schonfristTage: 0, notiz: '', ausgestellt: String(x.daten.ausgestellt || x.updated || '') };
        continue;
      }
      let echt = true;
      let s = null;
      try { s = await scheinPruefen(x.daten.schein, schluessel); } catch { echt = false; }
      // Bei gmail/googlemail liegen zwei gleiche Scheine: einer reicht für die Liste.
      if (e.lizenz && e.lizenz.echt) continue;
      e.lizenz = {
        echt, automatisch: x.daten.quelle === 'auto', id: s?.id || '', stufe: s?.stufe || String(x.daten.stufe || ''), ab: s?.ab || '', bis: s?.bis || String(x.daten.bis || ''),
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
 * Einer Adresse eine Lizenz zuweisen (oder sie ersetzen): Die Cloud Function signiert den Schein und legt ihn ab.
 * Das ist hier nur der Aufruf; Prüfung der Angaben und Signatur liegen auf dem Server (functions/lizenzlogik.js).
 * @param {{email:string, stufe:string, tage?:number, bis?:string, schonfrist?:number, notiz?:string}} angaben
 */
export async function zuweisen(kopf, angaben, cfg = null) {
  return funktion('lizenzZuweisen', kopf, {
    email: angaben?.email, stufe: angaben?.stufe, tage: angaben?.tage, bis: angaben?.bis, schonfrist: angaben?.schonfrist, notiz: angaben?.notiz,
  }, cfg);
}

/**
 * Einen Geräteschein ausstellen: gilt nur für die Kennung eines Geräts, ohne Google-Konto. Er wird nirgends
 * abgelegt; der Betreiber gibt den Text dem Kunden, der ihn in der Lizenzkarte einlöst.
 * @returns {Promise<{schein:string, id:string, stufe:string, ab:string, bis:string, geraet:string}>}
 */
export async function geraetScheinAusstellen(kopf, angaben, cfg = null) {
  return funktion('geraetSchein', kopf, {
    geraet: angaben?.geraet, stufe: angaben?.stufe, tage: angaben?.tage, bis: angaben?.bis, schonfrist: angaben?.schonfrist,
  }, cfg);
}

/**
 * Die Lizenz einer Adresse entziehen. Das Konto fällt beim nächsten Abgleich zurück, spätestens nach der Prüffrist.
 * Die Datei bleibt als Vermerk ohne Schein stehen (`quelle: 'entzogen'`): Wäre sie weg, legte die Cloud Function
 * dem Konto beim nächsten Anmelden wieder die automatische Lizenz an. Mit `zuruecksetzen` wird die Datei gelöscht,
 * das Konto bekommt dann wieder die automatische Lizenz.
 */
export async function entziehen(kopf, email, cfg = null, { zuruecksetzen = false, jetzt = Date.now() } = {}) {
  const e = emailNorm(email);
  if (!e) throw fehler('LIZENZ_EMAIL', 'Bitte eine gültige E-Mail-Adresse eingeben.');
  const b = bucket(cfg);
  try {
    for (const variante of emailVarianten(e)) {
      if (zuruecksetzen) {
        try {
          await requestJson(`${STORAGE}/${enc(b)}/o/${enc(`lizenzen/${variante}.json`)}`, { method: 'DELETE', headers: { ...kopf }, timeoutMs: 20000 });
        } catch (err) {
          if (err.status !== 404) throw err;
        }
      } else {
        const inhalt = new TextEncoder().encode(JSON.stringify({ v: 1, email: variante, quelle: 'entzogen', ausgestellt: new Date(jetzt).toISOString() }));
        await requestJson(`${STORAGE}/${enc(b)}/o?uploadType=media&name=${enc(`lizenzen/${variante}.json`)}`, {
          method: 'POST', headers: { ...kopf, 'content-type': 'application/json' }, body: inhalt, timeoutMs: 30000,
        });
      }
    }
  } catch (err) {
    throw deutlich(err);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Server: Schlüssel und Modus der Cloud Function (functions/lizenzlogik.js)    */
/* -------------------------------------------------------------------------- */

const SERVER_SCHLUESSEL = 'server/signierschluessel.json';
const SERVER_MODUS = 'server/modus.json';

/**
 * Liegt auf dem Server ein Schlüssel, und läuft der Testbetrieb? Den Schlüssel selbst kann niemand lesen: Das Auflisten
 * zeigt nur, dass die Datei da ist. Ohne modus.json läuft der Testbetrieb.
 * @returns {Promise<{schluessel:boolean, schluesselSeit:string, testbetrieb:boolean}>}
 */
export async function serverStand(kopf, cfg = null) {
  const b = bucket(cfg);
  try {
    const namen = await liste(b, 'server/', kopf).catch((err) => { if (err.status === 404) return []; throw err; });
    const schluessel = namen.find((n) => n.name === 'signierschluessel.json');
    const modus = namen.some((n) => n.name === 'modus.json') ? await jsonLesen(b, SERVER_MODUS, kopf) : null;
    return { schluessel: !!schluessel, schluesselSeit: schluessel?.updated || '', testbetrieb: modus?.testbetrieb !== false };
  } catch (err) {
    throw deutlich(err);
  }
}

/** privat.jwk zum Server hochladen (Klartext, damit die Funktion signieren kann; danach liest ihn niemand mehr). Wird geprüft wie beim Laden. */
export async function serverSchluesselSetzen(kopf, jwkText, cfg = null, oeffentlich = OEFFENTLICHER_SCHLUESSEL) {
  const jwk = jwkPruefen(jwkText, oeffentlich);
  try {
    await requestJson(`${STORAGE}/${enc(bucket(cfg))}/o?uploadType=media&name=${enc(SERVER_SCHLUESSEL)}`, {
      method: 'POST', headers: { ...kopf, 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(jwk)), timeoutMs: 30000,
    });
  } catch (err) {
    throw deutlich(err);
  }
  return true;
}

export async function serverSchluesselLoeschen(kopf, cfg = null) {
  try {
    await requestJson(`${STORAGE}/${enc(bucket(cfg))}/o/${enc(SERVER_SCHLUESSEL)}`, { method: 'DELETE', headers: { ...kopf }, timeoutMs: 20000 });
  } catch (err) {
    if (err.status !== 404) throw deutlich(err);
  }
  return true;
}

/** Testbetrieb ein- oder ausschalten: an = neue Konten bekommen Max, aus = Standard. Bereits ausgestellte automatische Scheine wechseln beim nächsten Anmelden des Kontos. */
export async function serverModusSetzen(kopf, testbetrieb, cfg = null) {
  try {
    await requestJson(`${STORAGE}/${enc(bucket(cfg))}/o?uploadType=media&name=${enc(SERVER_MODUS)}`, {
      method: 'POST', headers: { ...kopf, 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({ v: 1, testbetrieb: !!testbetrieb, ts: new Date().toISOString() })), timeoutMs: 30000,
    });
  } catch (err) {
    throw deutlich(err);
  }
  return !!testbetrieb;
}

/* -------------------------------------------------------------------------- */
/* Tarif-Einstellung: welcher Bereich und welche Funktion zu welchem Tarif gehört */
/* -------------------------------------------------------------------------- */

const TARIFE_PFAD = 'konfig/tarife.json';
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * Prüft die Form der Einstellung (die inhaltliche Prüfung gegen die bekannten Funktionen macht lib/tarife.js beim
 * Anwenden): Funktionen → Stufe, Grenzen → Stufe → Name → Zahl oder null. Gibt eine bereinigte Kopie zurück.
 */
export function tarifePruefen(roh) {
  const aus = { v: 1, funktionen: {}, grenzen: {} };
  const f = roh?.funktionen;
  if (f && typeof f === 'object') {
    for (const [k, v] of Object.entries(f)) {
      if (!KEY_RE.test(k)) continue;
      if (!STUFEN.includes(v)) throw fehler('TARIFE_FORM', `Ungültige Stufe für ${k}.`);
      aus.funktionen[k] = v;
    }
  }
  const g = roh?.grenzen;
  if (g && typeof g === 'object') {
    for (const [stufe, zeile] of Object.entries(g)) {
      if (!STUFEN.includes(stufe) || !zeile || typeof zeile !== 'object') continue;
      for (const [was, n] of Object.entries(zeile)) {
        if (!KEY_RE.test(was)) continue;
        if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 100000)) throw fehler('TARIFE_FORM', `Ungültige Grenze für ${was}.`);
        (aus.grenzen[stufe] ??= {})[was] = n;
      }
    }
  }
  return aus;
}

/**
 * Die veröffentlichte Einstellung (nur Abweichungen) oder `null`, wenn keine liegt. Eine Datei ohne gültige
 * Signatur (ältere Fassung, von Hand gelegt) gilt bei keinem Konto: dann `{unsigniert: true}`.
 */
export async function tarifeLesen(kopf, cfg = null, schluessel = OEFFENTLICHER_SCHLUESSEL) {
  let d;
  try {
    d = await jsonLesen(bucket(cfg), TARIFE_PFAD, kopf);
  } catch (err) {
    throw deutlich(err);
  }
  if (!d) return null;
  try {
    return { ...(await tarifePruefenSigniert(d.signiert, schluessel)), signiert: d.signiert };
  } catch {
    return { unsigniert: true };
  }
}

/**
 * Die Einstellung signieren und veröffentlichen: gilt für jedes Konto beim nächsten Abgleich mit der Cloud oder bei
 * der nächsten Suche nach Updates. Signiert und abgelegt wird auf dem Server (Cloud Function); die Datei ist
 * öffentlich lesbar, geheim ist nichts daran, echt macht sie allein die Signatur.
 */
export async function tarifeSetzen(kopf, konfig, cfg = null) {
  return funktion('tarifeVeroeffentlichen', kopf, { konfig: tarifePruefen(konfig) }, cfg);
}

/** Die Veröffentlichung entfernen: Es gelten wieder die eingebauten Werte. */
export async function tarifeLoeschen(kopf, cfg = null) {
  try {
    await requestJson(`${STORAGE}/${enc(bucket(cfg))}/o/${enc(TARIFE_PFAD)}`, { method: 'DELETE', headers: { ...kopf }, timeoutMs: 20000 });
  } catch (err) {
    if (err.status !== 404) throw deutlich(err);
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
