/**
 * Kontovia – Ratenzahlung.
 *
 * Eine Rechnung oder Buchung, die der Kunde (oder Sie selbst) in Raten zahlt,
 * wird in einzelne Buchungen zerlegt: gleiches Rechnungsdatum, jede Rate mit
 * eigener Fälligkeit und eigenem Zahlungsdatum. So stimmen Mahnwesen,
 * offene Posten, Ist-Versteuerung und EÜR ohne Sonderfall: Jede Zahlung zählt
 * an dem Tag, an dem sie fließt.
 *
 * Die Summe der Raten ist immer der volle Betrag. Den Rest der Rundung trägt
 * die letzte Rate (wie bei `aufteilen` in lib/rechnung.js).
 *
 * Ohne Bezug zur Oberfläche, damit scripts/check.js die Rechnung prüfen kann.
 */

import { uid } from './util.js';
import { vorkommen, TURNUS } from './wiederkehrend.js';

/** Mehr Raten als das sind kein Zahlungsplan mehr, sondern ein Dauerauftrag. */
export const MAX_RATEN = 120;

/** Zahl der Raten, auf ganze Zahlen von 1 bis MAX_RATEN gebracht (1 = keine Raten). */
export function ratenAnzahl(wert) {
  const n = Math.round(Number(wert) || 0);
  return n < 2 ? 1 : Math.min(MAX_RATEN, n);
}

/** Teilt einen Betrag in n gleiche Teile; den Rest der Rundung trägt der letzte. */
export function gleichTeilen(gesamt, n) {
  const teil = Math.round(gesamt / n);
  const out = Array(n).fill(teil);
  out[n - 1] = gesamt - teil * (n - 1);
  return out;
}

/**
 * Der Plan: eine Zeile je Rate mit Fälligkeit und Betrag.
 * @param {number} gesamt  Cent
 * @param {{anzahl:number, freq?:string, start:string}} opts  `start` = Fälligkeit der ersten Rate
 * @returns {Array<{nr:number, von:number, datum:string, betrag:number}>}  leer, wenn keine Raten gewollt sind
 */
export function ratenPlan(gesamt, { anzahl, freq = 'monthly', start } = {}) {
  const n = ratenAnzahl(anzahl);
  if (n < 2 || !start) return [];
  const f = TURNUS[freq] ? freq : 'monthly';
  return gleichTeilen(Number(gesamt) || 0, n).map((betrag, i) => ({ nr: i + 1, von: n, datum: vorkommen({ start, freq: f }, i), betrag }));
}

/**
 * Zerlegt eine Buchung in ihre Raten. Datum (Rechnungsdatum), Kategorie, Kontakt
 * und Steuersatz bleiben, Brutto und Netto werden geteilt, die Steuer ergibt
 * sich als Unterschied. Belege hängen nur an der ersten Rate.
 * Alle Raten sind offen: Gezahlt wird jede einzeln.
 * @param {object} tx  Entwurf einer Buchung (noch nicht gespeichert)
 * @param {{anzahl:number, freq?:string, start?:string}} opts  `start`: Fälligkeit der ersten Rate, sonst die der Buchung oder ihr Datum
 * @returns {object[]}  mindestens eine Buchung; bei weniger als zwei Raten die Buchung selbst
 */
export function ratenBuchungen(tx, { anzahl, freq = 'monthly', start = '' } = {}) {
  const n = ratenAnzahl(anzahl);
  if (n < 2) return [tx];
  const plan = ratenPlan(tx.gross, { anzahl: n, freq, start: start || tx.dueDate || tx.date });
  const netto = gleichTeilen(tx.net, n);
  const ratenId = uid('rt');
  return plan.map((rate, i) => ({
    ...structuredClone(tx),
    id: i === 0 && tx.id ? tx.id : uid('tx'),
    gross: rate.betrag,
    net: netto[i],
    vat: rate.betrag - netto[i],
    dueDate: rate.datum,
    paidDate: '',
    description: `${tx.description} (Rate ${rate.nr}/${n})`.slice(0, 200),
    attachments: i === 0 ? [...(tx.attachments || [])] : [],
    ratenId,
    rate: rate.nr,
    raten: n,
  }));
}
