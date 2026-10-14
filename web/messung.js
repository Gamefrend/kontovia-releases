/**
 * Kontovia – Nutzungsmessung: Senden (mit Zustimmung) und Lesen (nur Betreiber).
 *
 * Die Messung sagt, WIE Kontovia benutzt wird, nie WAS darin steht: in welchem Bereich jemand war (in Stufen),
 * wo schnell mehrfach geklickt wurde, wie lange das Laden dauerte (in Stufen), welcher Fehlercode auftrat. Keine
 * Beträge, Namen, Texte, Ids. Es gibt keine Kennung, die über eine Sitzung hinaus bleibt; „aktive Geräte“ zählt ein
 * Merker auf dem Gerät („heute schon gemeldet“), den der Server nur aufaddiert.
 *
 * Gesendet wird, was die Oberfläche nach Zustimmung zusammenstellt (lib/messung.js). Hier wird es vor dem Senden
 * noch einmal gegen dieselbe Erlaubnisliste gehalten wie auf dem Server (functions/messunglogik.js; die Prüfung
 * `messung` hält beide gleich): Alles, was nicht genau passt, fliegt heraus. Die Anfrage trägt keine Anmeldung und
 * keine Cookies und geht an die Cloud Function `messung` des eigenen Projekts (Host in netz.js: ERLAUBT).
 *
 * Lesen: Die Zähler liegen als messung/<Tag>.json im Cloud-Speicher; die Regeln lassen nur den Betreiber lesen
 * (firebase/storage.rules). `lesen` holt die Tage und zählt sie zusammen.
 */

import { request, requestJson } from './netz.js';
import BUILTIN from './cloudconfig.js';

const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';
const enc = encodeURIComponent;

export const MAX_BYTES = 8 * 1024;
export const MAX_EREIGNISSE = 100;

export const DAUER = ['u5s', 'u30s', 'u2m', 'u10m', 'o10m'];
export const LADEZEIT = ['u300', 'u1000', 'u3000', 'u10000', 'o10000'];
export const LADE_ARTEN = ['start', 'entsperren', 'ansicht', 'lcp', 'inp', 'ruckeln'];
export const GERAETE = ['handy', 'desktop'];
export const ABO_EREIGNISSE = ['aufruf', 'installieren', 'anmelden', 'anmeldung', 'vergleich', 'app-oeffnen'];
const SPRACHEN = ['de', 'en'];

export const RE = {
  ansicht: /^[a-z][a-z0-9]{1,23}$/,
  element: /^[a-zA-Z]{2,31}$/,
  code: /^[A-Z][A-Z0-9_]{2,31}$/,
  version: /^\d{1,2}\.\d{1,3}\.\d{1,3}$/,
  tarif: /^[a-z]{3,12}$/,
};

const istText = (v) => typeof v === 'string';
const inListe = (liste, v) => istText(v) && liste.includes(v);
const passt = (re, v) => istText(v) && re.test(v);

/** Ein Ereignis in feste Form bringen; null, wenn es nicht genau dem Schema entspricht. */
export function ereignisBereinigen(e) {
  if (!e || typeof e !== 'object') return null;
  switch (e.t) {
    case 'ansicht':
      return passt(RE.ansicht, e.a) && inListe(DAUER, e.d) ? { t: 'ansicht', a: e.a, d: e.d } : null;
    case 'frust':
      return passt(RE.ansicht, e.a) && passt(RE.element, e.e) ? { t: 'frust', a: e.a, e: e.e } : null;
    case 'lade': {
      if (!inListe(LADE_ARTEN, e.m) || !inListe(LADEZEIT, e.s)) return null;
      if (e.a !== undefined && !passt(RE.ansicht, e.a)) return null;
      return e.a === undefined ? { t: 'lade', m: e.m, s: e.s } : { t: 'lade', m: e.m, a: e.a, s: e.s };
    }
    case 'fehler': {
      if (!passt(RE.code, e.c)) return null;
      if (e.a !== undefined && !passt(RE.ansicht, e.a)) return null;
      return e.a === undefined ? { t: 'fehler', c: e.c } : { t: 'fehler', a: e.a, c: e.c };
    }
    case 'abo': {
      if (!inListe(ABO_EREIGNISSE, e.e)) return null;
      if (e.l !== undefined && !inListe(SPRACHEN, e.l)) return null;
      if (e.x !== undefined && !passt(RE.tarif, e.x)) return null;
      const aus = { t: 'abo', e: e.e };
      if (e.l !== undefined) aus.l = e.l;
      if (e.x !== undefined) aus.x = e.x;
      return aus;
    }
    default:
      return null;
  }
}

/**
 * Ein Paket der Oberfläche in die Form bringen, die gesendet wird. Unbekannte Felder und Ereignisse fallen weg.
 * @returns {{v:1,q:'app'|'abo',ev:object[],ver?:string,g?:string,neu?:1,tag?:1,woche?:1,monat?:1}}
 */
export function paketBereinigen(roh) {
  const quelle = roh?.q === 'abo' ? 'abo' : 'app';
  const paket = { v: 1, q: quelle, ev: [] };
  if (quelle === 'app') {
    if (roh?.neu === 1) {
      paket.neu = 1;
      if (passt(RE.version, roh.ver)) paket.ver = roh.ver;
      if (inListe(GERAETE, roh.g)) paket.g = roh.g;
    }
    for (const k of ['tag', 'woche', 'monat']) if (roh?.[k] === 1) paket[k] = 1;
  }
  const liste = Array.isArray(roh?.ev) ? roh.ev.slice(0, MAX_EREIGNISSE) : [];
  for (const e of liste) {
    const s = ereignisBereinigen(e);
    if (s && (s.t === 'abo') === (quelle === 'abo')) paket.ev.push(s);
  }
  return paket;
}

/** Adresse der Cloud Function. */
export function endpunkt(cfg = null) {
  const projekt = cfg?.projectId || BUILTIN.firebase?.projectId || String(cfg?.bucket || BUILTIN.firebase?.bucket || '').split('.')[0];
  if (!projekt) throw new Error('Es ist kein Projekt hinterlegt.');
  return `https://europe-west3-${projekt}.cloudfunctions.net/messung`;
}

/**
 * Sendet ein Paket. Ohne Anmeldung, ohne Cookies, ohne Absender-Seite (netz.js: referrerPolicy no-referrer).
 * `text/plain` hält die Anfrage „einfach“ (kein Vorab-Aufruf). Ein leeres Paket wird nicht gesendet.
 * @returns {Promise<{gesendet:boolean, ereignisse:number}>}
 */
export async function senden(roh, cfg = null) {
  const paket = paketBereinigen(roh);
  const hatFlags = paket.neu || paket.tag || paket.woche || paket.monat;
  if (!paket.ev.length && !hatFlags) return { gesendet: false, ereignisse: 0 };
  const text = JSON.stringify(paket);
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Das Paket der Messung ist zu groß.');
  await requestJson(endpunkt(cfg), {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode(text), timeoutMs: 15000,
  });
  return { gesendet: true, ereignisse: paket.ev.length };
}

/* ---- Lesen und Auswerten: nur der Betreiber (kopf = Anmeldung der Cloud) ---- */

const TAG_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRUPPEN = ['version', 'geraet', 'ansicht', 'frust', 'lade', 'fehler', 'abo'];

/** Mehrere Tagesstände zu einer Summe zusammenzählen. */
export function zusammenzaehlen(tage) {
  const s = { tage: tage.length, sitzungen: 0, geraeteTag: 0, geraeteWoche: 0, geraeteMonat: 0, verworfen: 0 };
  for (const g of GRUPPEN) s[g] = {};
  for (const t of tage) {
    for (const k of ['sitzungen', 'geraeteTag', 'geraeteWoche', 'geraeteMonat', 'verworfen']) s[k] += Number(t?.[k]) || 0;
    for (const g of GRUPPEN) {
      for (const [k, n] of Object.entries(t?.[g] || {})) s[g][k] = (s[g][k] || 0) + (Number(n) || 0);
    }
  }
  return s;
}

/**
 * Holt die Tagesstände der letzten `tage` Tage und zählt sie zusammen.
 * @returns {Promise<{reihe:object[], summe:object}>}  reihe: je Tag der Stand (älteste zuerst)
 */
export async function lesen({ tage = 30 } = {}, cfg = null, kopf = {}) {
  const b = cfg?.bucket || BUILTIN.firebase?.bucket;
  if (!b) throw new Error('Es ist kein Cloud-Speicher hinterlegt.');
  const anzahl = Math.max(1, Math.min(366, Math.floor(Number(tage)) || 30));
  const prefix = 'messung/';
  const namen = [];
  let seite = '';
  do {
    const url = `${STORAGE}/${enc(b)}/o?prefix=${enc(prefix)}&maxResults=1000${seite ? `&pageToken=${enc(seite)}` : ''}`;
    const data = await requestJson(url, { headers: { ...kopf }, timeoutMs: 30000 });
    for (const it of data?.items || []) {
      const n = String(it.name).slice(prefix.length).replace(/\.json$/, '');
      if (TAG_RE.test(n)) namen.push(n);
    }
    seite = data?.nextPageToken || '';
  } while (seite && namen.length < 2000);
  const gewaehlt = namen.sort().slice(-anzahl);
  const reihe = [];
  for (const tag of gewaehlt) {
    try {
      const res = await request(`${STORAGE}/${enc(b)}/o/${enc(`${prefix}${tag}.json`)}?alt=media`, { headers: { ...kopf }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 });
      if (res.status !== 200) continue;
      const d = JSON.parse(new TextDecoder().decode(res.body));
      if (d && d.v === 1) reihe.push({ ...d, tag });
    } catch { /* eine beschädigte Datei hält die übrigen nicht auf */ }
  }
  return { reihe, summe: zusammenzaehlen(reihe) };
}
