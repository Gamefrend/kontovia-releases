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
 * Der Schlüssel kommt je Sitzung entweder aus der Datei oder aus der Cloud (`betreiber/signierschluessel.json`);
 * er wird nicht exportierbar eingelesen, nur im Arbeitsspeicher gehalten und beim Sperren vergessen. Ein
 * Schlüssel, der nicht zum öffentlichen im Programm passt, wird abgelehnt (Scheine damit wären überall ungültig).
 *
 * Schlüssel in der Cloud: zwei getrennte Sperren. (1) Die Regeln lassen die Datei nur dem Betreiber-Konto zu
 * (`istBetreiber()`), alle anderen bekommen auch das Chiffrat nicht. (2) Die Datei enthält den Schlüssel nur
 * verschlüsselt, mit einer Passphrase (scrypt wie im Tresor, AES-256-GCM). Wer das Google-Konto oder die
 * Firebase-Konsole in die Hand bekommt, hat damit noch keinen Schlüssel; die Passphrase steht nirgends.
 */

import { request, requestJson } from './netz.js';
import BUILTIN from './cloudconfig.js';
import { scheinAusstellen, scheinPruefen, emailNorm, emailVarianten, OEFFENTLICHER_SCHLUESSEL, STUFEN } from './lizenz.js';
import { DEFAULT_KDF, deriveKey, seal, open, randomBytes, toBase64, fromBase64, utf8, fromUtf8, wipe } from './kern.js';

const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';
const enc = encodeURIComponent;
const TAG = 86400000;
const MAX_NOTIZ = 200;
const SCHLUESSEL_PFAD = 'betreiber/signierschluessel.json';
const SCHLUESSEL_AAD = utf8('kontovia/lizenz-signierschluessel/v1');
const MIN_PASSPHRASE = 12;

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

async function signiererSetzen(jwk) {
  signierer = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Liest privat.jwk ein. Wirft, wenn es kein privater P-256-Schlüssel ist oder er nicht zum Programm passt. */
export async function schluesselLaden(jwkText, oeffentlich = OEFFENTLICHER_SCHLUESSEL) {
  await signiererSetzen(jwkPruefen(jwkText, oeffentlich));
  return { geladen: true };
}

export const schluesselDa = () => !!signierer;
export function schluesselVergessen() { signierer = null; }

/* -------------------------------------------------------------------------- */
/* Signierschlüssel in der Cloud (verschlüsselt, nur für den Betreiber)         */
/* -------------------------------------------------------------------------- */

function passphrasePruefen(passphrase) {
  const pw = String(passphrase || '');
  if ([...pw].length < MIN_PASSPHRASE) {
    throw fehler('LIZENZ_PASSPHRASE', `Die Passphrase braucht mindestens ${MIN_PASSPHRASE} Zeichen. Wähle eine lange, die du nirgends sonst benutzt.`);
  }
  return pw;
}

async function schluesselDatei(b, kopf) {
  const res = await request(`${STORAGE}/${enc(b)}/o/${enc(SCHLUESSEL_PFAD)}?alt=media`, { headers: { ...kopf }, timeoutMs: 30000, maxBytes: 16 * 1024 });
  if (res.status === 404) return null;
  if (res.status !== 200) throw deutlich(Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }));
  try { return JSON.parse(new TextDecoder().decode(res.body)); } catch { return null; }
}

/** Liegt schon ein Schlüssel in der Cloud? (Nur ja/nein und Zeitpunkt, nichts Geheimes.) */
export async function schluesselCloudStand(kopf, cfg = null) {
  try {
    const d = await schluesselDatei(bucket(cfg), kopf);
    return { vorhanden: !!(d && d.v === 1 && d.blob), seit: String(d?.ts || '') };
  } catch (err) {
    throw deutlich(err);
  }
}

/**
 * privat.jwk mit einer Passphrase verschlüsseln und in der Cloud ablegen. Ersetzt einen vorhandenen. Danach ist der
 * Schlüssel auch für diese Sitzung geladen.
 * @param {object} [kdf] nur für Prüfungen (schwächer = schneller); beim Öffnen gilt, was in der Datei steht
 */
export async function schluesselSichern(kopf, jwkText, passphrase, cfg = null, oeffentlich = OEFFENTLICHER_SCHLUESSEL, kdf = DEFAULT_KDF) {
  const jwk = jwkPruefen(jwkText, oeffentlich);
  const pw = passphrasePruefen(passphrase);
  const b = bucket(cfg);
  const salt = randomBytes(16);
  const key = await deriveKey(pw, salt, kdf);
  const klar = utf8(JSON.stringify(jwk));
  try {
    const blob = await seal(key, klar, SCHLUESSEL_AAD);
    const inhalt = utf8(JSON.stringify({ v: 1, kdf, salt: toBase64(salt), blob: toBase64(blob), ts: new Date().toISOString() }));
    await requestJson(`${STORAGE}/${enc(b)}/o?uploadType=media&name=${enc(SCHLUESSEL_PFAD)}`, {
      method: 'POST', headers: { ...kopf, 'content-type': 'application/json' }, body: inhalt, timeoutMs: 30000,
    });
  } catch (err) {
    throw deutlich(err);
  } finally {
    wipe(key);
    wipe(klar);
  }
  await signiererSetzen(jwk);
  return { gesichert: true };
}

/** Den Schlüssel aus der Cloud holen, mit der Passphrase öffnen und für diese Sitzung laden. */
export async function schluesselAusCloud(kopf, passphrase, cfg = null, oeffentlich = OEFFENTLICHER_SCHLUESSEL) {
  let d;
  try { d = await schluesselDatei(bucket(cfg), kopf); } catch (err) { throw deutlich(err); }
  if (!d || d.v !== 1 || !d.blob || !d.salt) throw fehler('LIZENZ_KEIN_SCHLUESSEL', 'In der Cloud liegt noch kein Signierschlüssel.');
  const key = await deriveKey(String(passphrase || ''), fromBase64(d.salt), d.kdf);
  let klar;
  try {
    klar = await open(key, fromBase64(d.blob), SCHLUESSEL_AAD);
  } catch {
    throw fehler('LIZENZ_PASSPHRASE', 'Die Passphrase stimmt nicht.');
  } finally {
    wipe(key);
  }
  try {
    await signiererSetzen(jwkPruefen(fromUtf8(klar), oeffentlich));
  } finally {
    wipe(klar);
  }
  return { geladen: true };
}

/** Den Schlüssel aus der Cloud löschen (die Datei privat.jwk bleibt, wo sie ist). */
export async function schluesselCloudLoeschen(kopf, cfg = null) {
  try {
    await requestJson(`${STORAGE}/${enc(bucket(cfg))}/o/${enc(SCHLUESSEL_PFAD)}`, { method: 'DELETE', headers: { ...kopf }, timeoutMs: 20000 });
  } catch (err) {
    if (err.status !== 404) throw deutlich(err);
  }
  return true;
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
