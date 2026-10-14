/**
 * Kontovia – Nutzungsmessung in der Oberfläche (nur mit Zustimmung, auf diesem Gerät eingestellt).
 *
 * Gemessen wird, WIE das Programm benutzt wird, nie WAS darin steht:
 *   ansicht  in welchem Bereich jemand war und wie lange (nur sichtbare Zeit, in fünf Stufen)
 *   frust    dreimal schnell an derselben Stelle geklickt: Bereich und Art oder feste Kennung des Elements
 *   lade     Dauer von Start, Entsperren, Aufbau eines Bereichs, langsamste Reaktion auf Eingaben (INP-Näherung), lange
 *            Aussetzer (alles in Stufen). Der „erste sichtbare Inhalt“ (LCP) fehlt bewusst: In einer App mit Passwortabfrage
 *            misst er vor allem, wie lange jemand getippt hat. Ereignisse von vor der Zustimmung (etwa das Entsperren selbst,
 *            das wegen der Schlüsselableitung immer dauert) zählen für die Reaktionszeit nicht.
 *   fehler   ein fester Fehlercode (nie die Meldung, sie könnte Inhalte enthalten)
 * Dazu Version, Gerätetyp (Handy/Computer) und drei Merker, ob dieses Gerät heute/diese Woche/diesen Monat schon
 * gezählt wurde (so entstehen „aktive Geräte“ ohne jede Kennung).
 *
 * Was nie hinausgeht: Beträge, Namen, Texte, Ids, Suchbegriffe, Adressen, Einstellungen. Elemente erscheinen nur mit
 * einer Kennung aus Buchstaben (feste Ids aus dem Quelltext, nie solche mit Zahlen oder Unterstrichen, wie sie aus
 * Datensätzen entstehen) oder als Art („button“, „link“, „feld“, „flaeche“). Der Admin-Bereich wird nicht gemessen.
 *
 * Aufbau: Ereignisse sammeln sich im Arbeitsspeicher (höchstens 200), gesendet wird gebündelt alle zwei Minuten,
 * beim Verlassen der Seite und beim Sperren, über api.messung.senden → src/web/messung.js (dieselbe Erlaubnisliste wie
 * auf dem Server). Beim Sperren ist der Speicher leer, nichts davon landet im Tresor oder auf dem Datenträger; nur der
 * Schalter und die drei Merker liegen als Geräte-Vorliebe in prefs.js. Ohne Zustimmung läuft nichts davon.
 */

import { prefs, setPref } from './prefs.js';
import { todayISO } from './util.js';
import { router } from './router.js';

const api = () => globalThis.window?.kontovia;

export const MAX_PUFFER = 200;
export const SENDE_INTERVALL_MS = 2 * 60 * 1000;
const MAX_FEHLER = 20;
const MAX_RUCKELN = 10;

/** Dieselben Formen wie src/web/messung.js und functions/messunglogik.js (die Prüfung `messung` vergleicht sie). */
export const RE_ANSICHT = /^[a-z][a-z0-9]{1,23}$/;
export const RE_ELEMENT = /^[a-zA-Z]{2,31}$/;
export const RE_CODE = /^[A-Z][A-Z0-9_]{2,31}$/;

/* -------------------------------------------------------------------------- */
/* Reine Hilfen (ohne Browser, geprüft in scripts/pruefungen/messung.test.js)  */
/* -------------------------------------------------------------------------- */

const DAUER_STUFEN = [[5000, 'u5s'], [30000, 'u30s'], [120000, 'u2m'], [600000, 'u10m']];
const LADE_STUFEN = [[300, 'u300'], [1000, 'u1000'], [3000, 'u3000'], [10000, 'u10000']];

/** Verweildauer in Millisekunden → Stufe. */
export function dauerStufe(ms) {
  const n = Number(ms) || 0;
  for (const [grenze, name] of DAUER_STUFEN) if (n < grenze) return name;
  return 'o10m';
}

/** Ladezeit in Millisekunden → Stufe. */
export function ladeStufe(ms) {
  const n = Number(ms) || 0;
  for (const [grenze, name] of LADE_STUFEN) if (n < grenze) return name;
  return 'o10000';
}

/** Anzeigename einer Stufe für den Admin-Bereich. */
export const STUFENNAMEN = {
  u5s: 'unter 5 s', u30s: '5 bis 30 s', u2m: '30 s bis 2 min', u10m: '2 bis 10 min', o10m: 'über 10 min',
  u300: 'unter 0,3 s', u1000: '0,3 bis 1 s', u3000: '1 bis 3 s', u10000: '3 bis 10 s', o10000: 'über 10 s',
};

const pad = (n) => String(n).padStart(2, '0');
const KW = 'W';

/** Kalenderwoche nach ISO 8601 als „JJJJ-Www“. */
export function wochenSchluessel(iso) {
  const [j, m, t] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(j, (m || 1) - 1, t || 1));
  const tag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - tag);
  const jahrBeginn = Date.UTC(d.getUTCFullYear(), 0, 1);
  const woche = Math.ceil(((d - jahrBeginn) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-' + KW + pad(woche);
}

/** „JJJJ-MM“ aus einem Datum „JJJJ-MM-TT“. */
export const monatsSchluessel = (iso) => String(iso).slice(0, 7);

/**
 * Welche Merker „heute/diese Woche/diesen Monat noch nicht gezählt“ gelten, wenn zuletzt `stand` gemeldet wurde.
 * @returns {{flags:{tag?:1,woche?:1,monat?:1}, neuerStand:{tag:string,woche:string,monat:string}}}
 */
export function merker(stand, heute) {
  const jetzt = { tag: heute, woche: wochenSchluessel(heute), monat: monatsSchluessel(heute) };
  const flags = {};
  for (const k of ['tag', 'woche', 'monat']) if (stand?.[k] !== jetzt[k]) flags[k] = 1;
  return { flags, neuerStand: { ...(stand || {}), ...jetzt } };
}

/**
 * Kennung eines angeklickten Elements: die feste Id des Elements oder eines Vorfahren (nur Buchstaben), sonst seine Art.
 * Ids mit Zahlen oder Unterstrichen stammen oft aus Datensätzen und zählen nie.
 */
export function elementKennung(el) {
  let n = el;
  for (let i = 0; n && n.nodeType === 1 && i < 5; i++, n = n.parentElement) {
    if (typeof n.id === 'string' && RE_ELEMENT.test(n.id)) return n.id;
  }
  if (el?.closest?.('button,[role="button"],.btn')) return 'button';
  if (el?.closest?.('a')) return 'link';
  if (['input', 'select', 'textarea', 'label'].some((s) => el?.closest?.(s))) return 'feld';
  return 'flaeche';
}

/**
 * Erkennt Frust-Klicks: `anzahl` Klicks innerhalb von `fensterMs` im Umkreis von `radius` Pixeln. Danach `ruheMs` Pause,
 * damit ein einziger Wutanfall nur einmal zählt. Gibt für jeden Klick wahr zurück, wenn er einen Frust-Klick auslöst.
 */
export function frustMelder({ anzahl = 3, fensterMs = 1000, radius = 30, ruheMs = 3000 } = {}) {
  let klicks = [];
  let letzter = -Infinity;
  return (k) => {
    klicks = klicks.filter((c) => k.t - c.t <= fensterMs);
    klicks.push(k);
    const nah = klicks.filter((c) => Math.hypot(c.x - k.x, c.y - k.y) <= radius);
    if (nah.length >= anzahl && k.t - letzter > ruheMs) { letzter = k.t; klicks = []; return true; }
    return false;
  };
}

/** Fehlercode für die Messung: ein fester Code des Fehlers, sonst ein allgemeiner. Nie der Text. */
export function fehlerCode(fehler, vorgabe = 'JS_FEHLER') {
  const c = fehler && typeof fehler === 'object' ? fehler.code : '';
  return typeof c === 'string' && RE_CODE.test(c) ? c : vorgabe;
}

/** Gerätetyp grob: Handy (Touch) oder Computer. */
export function geraetArt() {
  try {
    return globalThis.matchMedia?.('(pointer: coarse)')?.matches ? 'handy' : 'desktop';
  } catch {
    return 'desktop';
  }
}

/** Beispielpaket, damit man vor der Zustimmung sieht, wie die Angaben aussehen. */
export function beispielPaket() {
  return {
    v: 1, q: 'app', neu: 1, ver: '2.39.0', g: 'desktop', tag: 1,
    ev: [
      { t: 'ansicht', a: 'rechnungen', d: 'u2m' },
      { t: 'frust', a: 'transactions', e: 'button' },
      { t: 'lade', m: 'start', s: 'u3000' },
      { t: 'lade', m: 'ansicht', a: 'reports', s: 'u1000' },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Zustand                                                                     */
/* -------------------------------------------------------------------------- */

let aktiv = false;
let sendet = false;
let puffer = [];
let sitzungNeu = true;
let version = '';
let ansicht = '';
let ansichtSeit = 0;
let sichtbarMs = 0;
let sichtbarAb = 0;
let fehlerAnzahl = 0;
let ruckelAnzahl = 0;
let inpMs = 0;
let timer = 0;
let beobachter = [];
const frust = frustMelder();

const jetzt = () => (globalThis.performance?.now?.() ?? Date.now());

/** Hat diese Person zugestimmt? Nur dann läuft irgendetwas. */
export const messungAn = () => prefs.messung === 'ja';

function eintragen(e) {
  puffer.push(e);
  if (puffer.length > MAX_PUFFER) puffer.splice(0, puffer.length - MAX_PUFFER);
}

/* -------------------------------------------------------------------------- */
/* Bereiche und Ladezeiten                                                     */
/* -------------------------------------------------------------------------- */

const gemessen = (view) => RE_ANSICHT.test(String(view)) && view !== 'admin';

function ansichtSchliessen() {
  if (!ansicht) return;
  const t = jetzt();
  const dauer = sichtbarMs + (sichtbarAb ? t - sichtbarAb : 0);
  if (dauer > 0) eintragen({ t: 'ansicht', a: ansicht, d: dauerStufe(dauer) });
  ansicht = '';
}

/** Die Hülle wechselt den Bereich: den alten abschließen, den neuen beginnen. */
export function ansichtWechsel(view) {
  if (!messungAn() || !aktiv) return;
  // Neu zeichnen im selben Bereich (nach dem Speichern, beim Reiterwechsel) ist kein neuer Besuch.
  if (view === ansicht) { ansichtSeit = jetzt(); return; }
  ansichtSchliessen();
  if (!gemessen(view)) return;
  ansicht = view;
  ansichtSeit = jetzt();
  sichtbarMs = 0;
  sichtbarAb = globalThis.document?.hidden ? 0 : ansichtSeit;
}

/** Der Bereich ist gezeichnet: wie lange hat es seit dem Wechsel gedauert? */
export function ansichtGezeichnet(view) {
  if (!messungAn() || !aktiv || !gemessen(view) || view !== ansicht) return;
  eintragen({ t: 'lade', m: 'ansicht', a: view, s: ladeStufe(jetzt() - ansichtSeit) });
}

/** Eine Dauer in Millisekunden melden (Start, Entsperren). Vor dem Start der Messung vorgemerkt. */
export function ladezeit(art, ms) {
  if (!messungAn() || !['start', 'entsperren'].includes(art) || !(ms >= 0)) return;
  eintragen({ t: 'lade', m: art, s: ladeStufe(ms) });
}

/* -------------------------------------------------------------------------- */
/* Beobachter                                                                  */
/* -------------------------------------------------------------------------- */

function beobachten(typ, optionen, fn) {
  try {
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(typ)) return;
    const o = new PerformanceObserver((liste) => { for (const e of liste.getEntries()) fn(e); });
    o.observe({ type: typ, ...optionen });
    beobachter.push(o);
  } catch { /* der Browser kennt diesen Typ nicht: dann fehlt diese Zahl eben */ }
}

function beiKlick(e) {
  if (!ansicht) return;
  if (frust({ x: e.clientX, y: e.clientY, t: e.timeStamp || jetzt() })) {
    eintragen({ t: 'frust', a: ansicht, e: elementKennung(e.target) });
  }
}

function beiSichtbarkeit() {
  const t = jetzt();
  if (globalThis.document.hidden) {
    if (sichtbarAb) sichtbarMs += t - sichtbarAb;
    sichtbarAb = 0;
    abschlussWerte();
    flush();
  } else if (ansicht) {
    sichtbarAb = t;
  }
}

function beiFehler(e) {
  if (fehlerAnzahl >= MAX_FEHLER) return;
  fehlerAnzahl += 1;
  eintragen({ t: 'fehler', ...(gemessen(ansicht) ? { a: ansicht } : {}), c: fehlerCode(e?.error) });
}

function beiAblehnung(e) {
  if (fehlerAnzahl >= MAX_FEHLER) return;
  fehlerAnzahl += 1;
  eintragen({ t: 'fehler', ...(gemessen(ansicht) ? { a: ansicht } : {}), c: fehlerCode(e?.reason, 'JS_ABLEHNUNG') });
}

let abschlussGemeldet = false;
/** Die langsamste Reaktion auf eine Eingabe einmal je Sitzung melden, sobald die Seite in den Hintergrund geht oder gesperrt wird. */
function abschlussWerte() {
  if (abschlussGemeldet) return;
  abschlussGemeldet = true;
  if (inpMs > 0) eintragen({ t: 'lade', m: 'inp', s: ladeStufe(inpMs) });
}

/* -------------------------------------------------------------------------- */
/* Paket und Senden                                                            */
/* -------------------------------------------------------------------------- */

/** Baut das Paket aus Ereignissen, ohne etwas zu verändern (Vorschau und Senden benutzen dasselbe). */
export function paketBauen(ereignisse, { neu = sitzungNeu, stand = prefs.messungStand, heute = todayISO() } = {}) {
  const paket = { v: 1, q: 'app', ev: ereignisse.map((e) => ({ ...e })) };
  const m = merker(stand, heute);
  if (neu) {
    paket.neu = 1;
    if (/^\d{1,2}\.\d{1,3}\.\d{1,3}$/.test(version)) paket.ver = version;
    paket.g = geraetArt();
  }
  Object.assign(paket, m.flags);
  return { paket, neuerStand: m.neuerStand, flags: m.flags };
}

/** Was würde jetzt gesendet? Ohne Zustimmung (oder bei leerem Speicher) ein Beispiel. */
export function vorschau() {
  if (!messungAn() || !aktiv) return { beispiel: true, paket: beispielPaket() };
  const kopie = puffer.slice();
  // Der laufende Bereich ist noch offen: so, als würde er jetzt abgeschlossen.
  if (ansicht) {
    const dauer = sichtbarMs + (sichtbarAb ? jetzt() - sichtbarAb : 0);
    if (dauer > 0) kopie.push({ t: 'ansicht', a: ansicht, d: dauerStufe(dauer) });
  }
  return { beispiel: false, paket: paketBauen(kopie).paket };
}

async function flush() {
  if (!aktiv || sendet || !messungAn()) return;
  const ereignisse = puffer.splice(0);
  const { paket, neuerStand, flags } = paketBauen(ereignisse);
  if (!paket.ev.length && !paket.neu && !Object.keys(flags).length) return;
  sendet = true;
  try {
    await api().messung.senden(paket);
    sitzungNeu = false;
    if (Object.keys(flags).length) setPref('messungStand', neuerStand);
  } catch {
    // Offline ist der Normalfall dieses Programms: das Paket bleibt liegen und geht beim nächsten Mal mit.
    puffer = ereignisse.concat(puffer).slice(-MAX_PUFFER);
  } finally {
    sendet = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Start und Ende                                                              */
/* -------------------------------------------------------------------------- */

/** Beginnt die Messung (nach dem Entsperren, nur mit Zustimmung). */
export function messungStarten({ version: v = '' } = {}) {
  if (!messungAn() || aktiv || !globalThis.document) return;
  aktiv = true;
  version = String(v || '');
  sitzungNeu = true;
  abschlussGemeldet = false;
  fehlerAnzahl = 0;
  ruckelAnzahl = 0;
  inpMs = 0;
  document.addEventListener('click', beiKlick, true);
  document.addEventListener('visibilitychange', beiSichtbarkeit);
  window.addEventListener('error', beiFehler);
  window.addEventListener('unhandledrejection', beiAblehnung);
  beobachten('event', { durationThreshold: 40, buffered: false }, (e) => { inpMs = Math.max(inpMs, e.duration || 0); });
  beobachten('longtask', { buffered: false }, (e) => {
    if (e.duration >= 200 && ruckelAnzahl < MAX_RUCKELN) {
      ruckelAnzahl += 1;
      eintragen({ t: 'lade', m: 'ruckeln', ...(gemessen(ansicht) ? { a: ansicht } : {}), s: ladeStufe(e.duration) });
    }
  });
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    const ende = nav?.loadEventEnd || nav?.domContentLoadedEventEnd || 0;
    if (ende > 0) eintragen({ t: 'lade', m: 'start', s: ladeStufe(ende) });
  } catch { /* ohne Navigationszeiten fehlt nur diese Zahl */ }
  timer = setInterval(flush, SENDE_INTERVALL_MS);
  // Der Bereich, in dem das Entsperren gelandet ist, zählt von Anfang an.
  ansichtWechsel(router.view);
}

function abbauen() {
  aktiv = false;
  clearInterval(timer);
  document.removeEventListener('click', beiKlick, true);
  document.removeEventListener('visibilitychange', beiSichtbarkeit);
  window.removeEventListener('error', beiFehler);
  window.removeEventListener('unhandledrejection', beiAblehnung);
  for (const o of beobachter) { try { o.disconnect(); } catch { /* egal */ } }
  beobachter = [];
  puffer = [];
  ansicht = '';
}

/** Beim Sperren: Rest senden (wenn es geht), dann alles vergessen. */
export async function messungBeenden() {
  if (!aktiv) { puffer = []; return; }
  ansichtSchliessen();
  abschlussWerte();
  try { await Promise.race([flush(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* beim Sperren nichts mehr tun */ }
  abbauen();
}

/** Zustimmung ändern (Fenster beim ersten Mal, Schalter in den Einstellungen). */
export function messungErlauben(ja, { version: v = version } = {}) {
  setPref('messung', ja ? 'ja' : 'nein');
  if (ja) {
    messungStarten({ version: v });
  } else {
    // Widerruf: nichts mehr senden, nichts aufbewahren, auch die Merker vergessen.
    abbauen();
    setPref('messungStand', {});
  }
}
