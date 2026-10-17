/**
 * Kontovia – Steuerrücklage: grob geschätzt, wie viel Einkommensteuer, Solidaritätszuschlag, Kirchensteuer und
 * Gewerbesteuer auf den Gewinn des Jahres zukommen, und wie viel davon auf den Gewinn bis heute entfällt.
 *
 * Grundlage ist der Gewinn laut Anlage EÜR (calc.js: euerReport) seit dem 1. Januar, im laufenden Jahr auf zwölf
 * Monate hochgerechnet (Gewinn bis heute × 12 / begonnene Monate). Dazu kommen auf Wunsch weitere Einkünfte oder
 * Abzüge aus den Einstellungen (`settings.ruecklage.weitere`, auch negativ). Nicht berücksichtigt: Sonderausgaben,
 * Vorsorgeaufwendungen, Freibeträge, Hinzurechnungen der Gewerbesteuer. Eine Schätzung zum Planen, kein Bescheid.
 *
 * Tarif nach § 32a EStG je Jahr (2025, 2026; spätere Jahre rechnen mit dem jüngsten hinterlegten, von Hand
 * nachtragen wie EU_SAETZE), Solidaritätszuschlag mit Freigrenze und Milderungszone (§ 3, § 4 SolZG), Kirchensteuer
 * 8 oder 9 % der Einkommensteuer, Gewerbesteuer: Gewerbeertrag auf volle 100 € abgerundet, Freibetrag 24.500 €,
 * Messzahl 3,5 %, Hebesatz der Gemeinde; Anrechnung auf die Einkommensteuer mit dem 4,0-fachen Messbetrag (§ 35 EStG),
 * höchstens die Gewerbesteuer und die Einkommensteuer.
 *
 * Rein rechnend (Prüfung `rechenkern`). Beträge in Cent.
 */

import { euerReport, listedOnly } from './calc.js';
import { todayISO } from './util.js';

/**
 * § 32a Abs. 1 EStG je Jahr: Grundfreibetrag, Grenzen der Zonen (volle Euro) und Beiwerte.
 * 2025 und 2026 nach dem Steuerfortentwicklungsgesetz (BGBl. 2024 I Nr. 449), geprüft am 17.10.2026.
 */
export const TARIFE = {
  2025: { gfb: 12096, z2: 17443, z3: 68480, z4: 277825, a: 932.30, b: 176.64, c: 1015.13, d: 10911.92, e: 19246.67, soli: 19950 },
  2026: { gfb: 12348, z2: 17799, z3: 69878, z4: 277825, a: 914.51, b: 173.10, c: 1034.87, d: 11135.63, e: 19470.38, soli: 20350 },
};
const JAHRE = Object.keys(TARIFE).map(Number).sort((a, b) => a - b);
export const tarifJahr = (jahr) => Math.min(Math.max(Number(jahr) || JAHRE.at(-1), JAHRE[0]), JAHRE.at(-1));

export const GEWST_FREIBETRAG = 2450000;
export const GEWST_MESSZAHL = 0.035;
export const GEWST_ANRECHNUNG = 4.0;

/** Tarifliche Einkommensteuer in Cent für ein zu versteuerndes Einkommen in Cent (Grundtabelle), auf volle Euro abgerundet. */
export function tarif(zveCent, jahr) {
  const t = TARIFE[tarifJahr(jahr)];
  const x = Math.floor(Math.max(0, zveCent) / 100);
  let st;
  if (x <= t.gfb) st = 0;
  else if (x <= t.z2) { const y = (x - t.gfb) / 10000; st = (t.a * y + 1400) * y; }
  else if (x <= t.z3) { const z = (x - t.z2) / 10000; st = (t.b * z + 2397) * z + t.c; }
  else if (x <= t.z4) st = 0.42 * x - t.d;
  else st = 0.45 * x - t.e;
  return Math.floor(st + 1e-9) * 100;
}

/** Einkommensteuer, bei Zusammenveranlagung nach dem Splittingverfahren (das Doppelte der Steuer auf die Hälfte). */
export function einkommensteuer(zveCent, jahr, { splitting = false } = {}) {
  if (!splitting) return tarif(zveCent, jahr);
  return 2 * tarif(Math.floor(Math.max(0, zveCent) / 200) * 100, jahr);
}

/** Solidaritätszuschlag: 5,5 %, aber nichts bis zur Freigrenze und höchstens 11,9 % des Teils darüber; Cent abgerundet. */
export function solidaritaetszuschlag(estCent, jahr, { splitting = false } = {}) {
  const grenze = TARIFE[tarifJahr(jahr)].soli * 100 * (splitting ? 2 : 1);
  if (estCent <= grenze) return 0;
  return Math.floor(Math.min(estCent * 0.055, (estCent - grenze) * 0.119));
}

/** Gewerbesteuer und Messbetrag für einen Gewinn in Cent bei einem Hebesatz in Prozent (z. B. 400). */
export function gewerbesteuer(gewinnCent, hebesatz) {
  const ertrag = Math.floor(Math.max(0, gewinnCent) / 10000) * 10000;
  const basis = Math.max(0, ertrag - GEWST_FREIBETRAG);
  const messbetrag = Math.floor((basis * GEWST_MESSZAHL) / 100) * 100;
  return { messbetrag, steuer: Math.round((messbetrag * (Number(hebesatz) || 0)) / 100) };
}

/** Die Angaben aus den Einstellungen, mit Voreinstellungen. */
export function ruecklageEinstellung(settings = {}) {
  const r = settings.ruecklage || {};
  const hebesatz = Number(r.hebesatz);
  return {
    gewerbe: r.gewerbe === true,
    hebesatz: Number.isFinite(hebesatz) && hebesatz >= 200 && hebesatz <= 900 ? hebesatz : 400,
    splitting: r.splitting === true,
    kirche: [8, 9].includes(Number(r.kirche)) ? Number(r.kirche) : 0,
    weitere: Math.round(Number(r.weitere) || 0),
    vorauszahlungen: r.vorauszahlungen && typeof r.vorauszahlungen === 'object' ? r.vorauszahlungen : {},
    gesetzt: !!settings.ruecklage,
  };
}

/**
 * Schätzung für ein Jahr.
 * @returns {{jahr:number, tarifJahr:number, monate:number, gewinnBisher:number, gewinnJahr:number, zve:number,
 *   est:number, anrechnung:number, soli:number, kirche:number, gewst:number, summe:number, anteilBisher:number,
 *   vorausgezahlt:number, zuruecklegen:number, einstellung:object}}
 */
export function steuerRuecklage(db, { jahr, heute = todayISO() } = {}) {
  const j = Number(jahr) || Number(heute.slice(0, 4));
  const e = ruecklageEinstellung(db.settings);
  const laufend = j === Number(heute.slice(0, 4));
  const bis = laufend ? heute : `${j}-12-31`;
  const monate = laufend ? Number(heute.slice(5, 7)) : 12;
  // Wie in den Unterlagen fürs Finanzamt: ohne private Buchungen.
  const gewinnBisher = j > Number(heute.slice(0, 4)) ? 0 : euerReport(listedOnly(db), `${j}-01-01`, bis).profit;
  const gewinnJahr = Math.round((gewinnBisher * 12) / monate);
  const zve = Math.max(0, gewinnJahr + e.weitere);
  const estVoll = einkommensteuer(zve, j, { splitting: e.splitting });
  const g = e.gewerbe ? gewerbesteuer(gewinnJahr, e.hebesatz) : { messbetrag: 0, steuer: 0 };
  const anrechnung = Math.min(Math.floor(g.messbetrag * GEWST_ANRECHNUNG), g.steuer, estVoll);
  const est = estVoll - anrechnung;
  const soli = solidaritaetszuschlag(est, j, { splitting: e.splitting });
  // Kirchensteuer: von der Einkommensteuer ohne die Anrechnung der Gewerbesteuer (§ 51a Abs. 2 Satz 3 EStG).
  const kirche = Math.floor((estVoll * e.kirche) / 100);
  const summe = est + soli + kirche + g.steuer;
  const anteilBisher = Math.round((summe * monate) / 12);
  const vorausgezahlt = Math.max(0, Math.round(Number(e.vorauszahlungen[j]) || 0));
  return {
    jahr: j, tarifJahr: tarifJahr(j), monate, gewinnBisher, gewinnJahr, zve,
    est, anrechnung, soli, kirche, gewst: g.steuer, summe, anteilBisher, vorausgezahlt,
    zuruecklegen: Math.max(0, anteilBisher - vorausgezahlt), einstellung: e,
  };
}
