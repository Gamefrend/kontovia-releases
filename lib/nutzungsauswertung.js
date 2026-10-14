/**
 * Kontovia – Auswertung der Nutzungsmessung (reine Rechnung, ohne Oberfläche und ohne Netz).
 *
 * Aus den Tageszählern (functions/messunglogik.js: `ansicht`, `frust`, `lade`, `fehler`, `abo` …) werden die Tabellen
 * des Admin-Bereichs (lib/nutzungsansicht.js). Alle Eingaben sind Zähler; hier gibt es nichts Persönliches.
 *
 * Mindestmenge: Unter MINDEST_SITZUNGEN Sitzungen im Zeitraum zeigt die Ansicht keine Einzelheiten, damit aus wenigen
 * Besuchen nichts herausgelesen wird, was wie eine Aussage über „die Nutzer“ aussieht.
 */

import { wochenSchluessel, monatsSchluessel } from './messung.js';

export const MINDEST_SITZUNGEN = 5;

export const DAUER_REIHE = ['u5s', 'u30s', 'u2m', 'u10m', 'o10m'];
export const LADE_REIHE = ['u300', 'u1000', 'u3000', 'u10000', 'o10000'];
/** Ab dieser Stufe gilt eine Ladezeit als langsam (3 Sekunden und mehr). */
const LANGSAM = new Set(['u10000', 'o10000']);

const nachAnzahl = (a, b) => b.n - a.n;

/** Schlüssel „a|b|c“ in Teile zerlegen. */
const teile = (k) => String(k).split('|');

/** Median-Stufe: die erste Stufe, bis zu der mindestens die Hälfte der Besuche reicht. */
export function medianStufe(stufen, reihe) {
  const gesamt = reihe.reduce((s, k) => s + (stufen[k] || 0), 0);
  if (!gesamt) return '';
  let lauf = 0;
  for (const k of reihe) { lauf += stufen[k] || 0; if (lauf * 2 >= gesamt) return k; }
  return reihe[reihe.length - 1];
}

/** Besuche je Bereich mit Verteilung der Verweildauer. */
export function bereiche(summe) {
  const nach = new Map();
  for (const [k, n] of Object.entries(summe?.ansicht || {})) {
    const [a, d] = teile(k);
    const z = nach.get(a) || { a, n: 0, stufen: {} };
    z.n += n;
    z.stufen[d] = (z.stufen[d] || 0) + n;
    nach.set(a, z);
  }
  return [...nach.values()].map((z) => ({ ...z, median: medianStufe(z.stufen, DAUER_REIHE) })).sort(nachAnzahl);
}

/** Ladezeiten je Art (und Bereich): Anzahl, Anteil langsam, häufigste Stufe. */
export function ladezeiten(summe) {
  const nach = new Map();
  for (const [k, n] of Object.entries(summe?.lade || {})) {
    const [m, a, s] = teile(k);
    const schluessel = `${m}|${a}`;
    const z = nach.get(schluessel) || { m, a: a === '-' ? '' : a, n: 0, langsam: 0, stufen: {} };
    z.n += n;
    if (LANGSAM.has(s)) z.langsam += n;
    z.stufen[s] = (z.stufen[s] || 0) + n;
    nach.set(schluessel, z);
  }
  return [...nach.values()]
    .map((z) => ({ ...z, anteil: z.n ? z.langsam / z.n : 0, median: medianStufe(z.stufen, LADE_REIHE) }))
    // Die langsamsten zuerst; bei gleichem Anteil die mit mehr Messungen.
    .sort((x, y) => (y.anteil - x.anteil) || (y.n - x.n));
}

/** Frust-Klicks: Bereich und Stelle, häufigste zuerst. */
export function frustKlicks(summe) {
  return Object.entries(summe?.frust || {}).map(([k, n]) => { const [a, e] = teile(k); return { a, e, n }; }).sort(nachAnzahl);
}

/** Fehlercodes: Code und Bereich, häufigste zuerst. */
export function fehlerCodes(summe) {
  return Object.entries(summe?.fehler || {}).map(([k, n]) => { const [a, c] = teile(k); return { a: a === '-' ? '' : a, c, n }; }).sort(nachAnzahl);
}

/** Eine Zählergruppe mit einfachem Schlüssel (Version, Gerät) als sortierte Liste. */
export function liste(gruppe) {
  return Object.entries(gruppe || {}).map(([name, n]) => ({ name, n })).sort(nachAnzahl);
}

/** Abo-Seite: Aufrufe und Klicks je Ereignis, mit Aufschlüsselung nach Sprache und Tarif. */
export function aboSeite(summe) {
  const nach = new Map();
  for (const [k, n] of Object.entries(summe?.abo || {})) {
    const [e, l, x] = teile(k);
    const z = nach.get(e) || { e, n: 0, sprachen: {}, tarife: {} };
    z.n += n;
    if (l !== '-') z.sprachen[l] = (z.sprachen[l] || 0) + n;
    if (x !== '-') z.tarife[x] = (z.tarife[x] || 0) + n;
    nach.set(e, z);
  }
  return [...nach.values()].sort(nachAnzahl);
}

/**
 * Aktive Geräte: gestern/heute (letzter Tag der Reihe), in der Kalenderwoche und im Monat des letzten Tages. Die
 * Wochen- und Monatszahl ist die Summe der Merker „diese Woche/diesen Monat erstmals gemeldet“ über die Tage der
 * Woche bzw. des Monats; ein Gerät zählt dort genau einmal.
 */
export function aktiveGeraete(reihe) {
  const letzter = reihe[reihe.length - 1];
  if (!letzter) return { tag: 0, woche: 0, monat: 0, datum: '' };
  const woche = wochenSchluessel(letzter.tag);
  const monat = monatsSchluessel(letzter.tag);
  let w = 0;
  let m = 0;
  for (const t of reihe) {
    if (wochenSchluessel(t.tag) === woche) w += Number(t.geraeteWoche) || 0;
    if (monatsSchluessel(t.tag) === monat) m += Number(t.geraeteMonat) || 0;
  }
  return { tag: Number(letzter.geraeteTag) || 0, woche: w, monat: m, datum: letzter.tag };
}

/** Der Tagesverlauf der aktiven Geräte (für die Balken). */
export function verlauf(reihe) {
  return reihe.map((t) => ({ tag: t.tag, geraete: Number(t.geraeteTag) || 0, sitzungen: Number(t.sitzungen) || 0 }));
}
