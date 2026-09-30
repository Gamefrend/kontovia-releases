/**
 * Kontovia – wiederkehrende Buchungen.
 *
 * Miete, Telefon, Software-Abos, Versicherungen: Eine Regel merkt sich die
 * Vorlage und den Turnus. Fällige Buchungen legt Kontovia nicht still an,
 * sondern bietet sie nach dem Entsperren zum Anlegen an – jede wird dann eine
 * gewöhnliche Buchung mit eigenem Journaleintrag, änder- und stornierbar wie
 * jede andere. Belege gehören weiterhin an jede einzelne Buchung.
 *
 * Termine werden vom ersten Datum aus gerechnet, nicht vom vorigen: Eine
 * Miete am 31. steht im Februar am 28. und im März wieder am 31.
 *
 * Die Kennung einer erzeugten Buchung folgt aus Regel und Datum. Legen zwei
 * abgeglichene Geräte dieselbe Buchung an, ist es beim Abgleich dieselbe –
 * es entsteht kein Doppel.
 *
 * Ohne Bezug zur Oberfläche, damit scripts/check.js die Rechnung prüfen kann.
 */

import { addMonths } from './util.js';

/** Turnus: [Bezeichnung, Monate]. */
export const TURNUS = {
  monthly: ['monatlich', 1],
  quarterly: ['vierteljährlich', 3],
  yearly: ['jährlich', 12],
};

/** Felder der Vorlage – alles, was eine Buchung ausmacht, außer Datum, Zahlung und Belegen. */
const VORLAGE = ['type', 'description', 'categoryId', 'contactId', 'accountId', 'gross', 'net', 'vat', 'vatRate',
  'vatTreatment', 'reverseCharge', 'reference', 'notes', 'location', 'unlisted'];

/** Datum des n-ten Vorkommens (0 = erstes). */
export function vorkommen(regel, n) {
  const schritt = TURNUS[regel.freq]?.[1] || 1;
  return addMonths(regel.start, n * schritt);
}

/** Das nächste noch nicht angelegte Datum einer Regel, oder '' wenn sie ausgelaufen ist. */
export function naechstesDatum(regel) {
  const d = vorkommen(regel, Number(regel.n) || 0);
  return regel.until && d > regel.until ? '' : d;
}

/** Legt aus einer Buchung eine Regel an; die Buchung selbst ist das erste Vorkommen. */
export function regelAusBuchung(tx, freq, { id, until = '' } = {}) {
  const template = {};
  for (const k of VORLAGE) if (tx[k] !== undefined) template[k] = tx[k];
  return {
    id,
    active: true,
    freq: TURNUS[freq] ? freq : 'monthly',
    start: tx.date,
    n: 1,
    until: until || '',
    paid: !!tx.paidDate,
    template,
    createdAt: new Date().toISOString(),
  };
}

/** Kennung der Buchung zum n-ten Vorkommen – gleich auf jedem Gerät. */
export function buchungsId(regel, datum) {
  return `tx_w${String(regel.id).replace(/^rec_?/, '')}_${String(datum).replace(/-/g, '')}`;
}

/**
 * Fällige Vorkommen aller aktiven Regeln bis einschließlich `heute`.
 * Höchstens 36 je Regel – wer ein Jahr lang nicht da war, soll nicht
 * hunderte Zeilen auf einmal sehen.
 * @param {string} gesperrtBis  Festschreibung: Vorkommen bis dahin sind gesperrt
 * @returns {Array<{regel:object, datum:string, index:number, gesperrt:boolean, vorhanden:boolean}>}
 */
export function faellige(db, heute, gesperrtBis = '') {
  const vorhanden = new Set((db.transactions || []).map((t) => t.id));
  const out = [];
  for (const regel of db.recurring || []) {
    if (regel.active === false || !TURNUS[regel.freq] || !regel.start) continue;
    for (let n = Number(regel.n) || 0, k = 0; k < 36; n++, k++) {
      const datum = vorkommen(regel, n);
      if (datum > heute || (regel.until && datum > regel.until)) break;
      const id = buchungsId(regel, datum);
      out.push({ regel, datum, index: n, gesperrt: !!gesperrtBis && datum <= gesperrtBis, vorhanden: vorhanden.has(id) });
    }
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum) || String(a.regel.template?.description).localeCompare(String(b.regel.template?.description), 'de'));
}

/** Die Buchung zu einem Vorkommen. */
export function buchungAusRegel(regel, datum) {
  const t = regel.template || {};
  return {
    type: 'expense', description: '', categoryId: '', contactId: '', accountId: '',
    gross: 0, net: 0, vat: 0, vatRate: 0, reference: '', notes: '', location: '', unlisted: false,
    ...t,
    id: buchungsId(regel, datum),
    date: datum,
    paidDate: regel.paid ? datum : '',
    dueDate: '',
    invoiceNumber: '',
    isDeposit: false,
    depositPercent: 0,
    eventDate: '',
    attachments: [],
    appointmentIds: [],
    voided: false,
    isReversal: false,
    recurringId: regel.id,
    // Fest aus dem Datum: Zwei Geräte erzeugen dieselbe Buchung gleich.
    createdAt: `${datum}T00:00:00.000Z`,
  };
}
