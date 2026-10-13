/**
 * Kontovia – Kassenbuch für Barkassen (Konten der Art „cash“), reine Rechnung ohne Speicher und Oberfläche.
 *
 * Grundlage sind die bezahlten Buchungen der Kasse, wie im Kontenblatt (calc.js: accountLedger): Anfangsbestand,
 * dann jede Bewegung nach Zahlungstag mit laufender Nummer und Bestand, je Tag Einnahmen, Ausgaben und
 * Endbestand. Geprüft wird, was eine Betriebsprüfung zuerst ansieht: Der Bestand darf an keinem Tagesende unter
 * null fallen (eine Kasse kann nicht weniger als nichts enthalten), und gezählte Bestände (Kassensturz,
 * `konto.zaehlungen`) sollen mit dem Buchbestand übereinstimmen. Eine Differenz bucht der Nutzer selbst
 * (Kassendifferenz), Kontovia schlägt sie nur vor.
 *
 * Grundlagen: § 146 Abs. 1 AO (Kasseneinnahmen und -ausgaben täglich festhalten), GoBD Rz. 48 ff.
 */

import { accountLedger } from './calc.js';

/** Barkassen des Bestands. */
export const kassen = (db) => (db.accounts || []).filter((a) => a.kind === 'cash' && a.active !== false);

/** Buchbestand der Kasse am Ende eines Tages. */
export function bestandAm(db, kasse, datum) {
  return accountLedger(db, kasse, datum, datum).closing;
}

/**
 * Das Kassenbuch eines Zeitraums.
 * @returns {{opening:number, closing:number, einnahmen:number, ausgaben:number,
 *   tage:Array<{datum:string, zeilen:Array<{nr:number, tx:object, ein:number, aus:number, bestand:number}>, ein:number, aus:number, endbestand:number}>,
 *   fehltage:string[], zaehlungen:Array<{datum:string, gezaehlt:number, buch:number, differenz:number, notiz:string}>}}
 */
export function kassenbuch(db, kasse, from, to) {
  const { opening, rows, closing } = accountLedger(db, kasse, from, to);
  const tage = [];
  let nr = 0;
  for (const { tx, balance } of rows) {
    let tag = tage[tage.length - 1];
    if (!tag || tag.datum !== tx.paidDate) {
      tag = { datum: tx.paidDate, zeilen: [], ein: 0, aus: 0, endbestand: 0 };
      tage.push(tag);
    }
    const ein = tx.type === 'income' ? tx.gross : 0;
    const aus = tx.type === 'income' ? 0 : tx.gross;
    tag.zeilen.push({ nr: ++nr, tx, ein, aus, bestand: balance });
    tag.ein += ein;
    tag.aus += aus;
    tag.endbestand = balance;
  }
  const zaehlungen = (kasse.zaehlungen || [])
    .filter((z) => z.datum >= from && z.datum <= to)
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map((z) => {
      const buch = bestandAm(db, kasse, z.datum);
      return { datum: z.datum, gezaehlt: Math.round(Number(z.betrag) || 0), buch, differenz: Math.round(Number(z.betrag) || 0) - buch, notiz: z.notiz || '' };
    });
  return {
    opening, closing,
    einnahmen: tage.reduce((s, t) => s + t.ein, 0),
    ausgaben: tage.reduce((s, t) => s + t.aus, 0),
    tage,
    fehltage: tage.filter((t) => t.endbestand < 0).map((t) => t.datum),
    zaehlungen,
  };
}

/** Eine Zählung (Kassensturz): Betrag in Cent, Datum, Notiz. Sie hängt am Konto (`zaehlungen`). */
export function zaehlung(datum, betrag, notiz = '') {
  return { datum, betrag: Math.round(Number(betrag) || 0), notiz: String(notiz || '').slice(0, 200), ts: new Date().toISOString() };
}

/**
 * Stückelung beim Zählen (Euro-Scheine und -Münzen in Cent): Summe aus Anzahl je Wert.
 * @param {Object<string, number>} anzahl  Wert in Cent → Anzahl
 */
export const STUECKELUNG = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
export function zaehlSumme(anzahl = {}) {
  return STUECKELUNG.reduce((s, w) => s + w * Math.max(0, Math.round(Number(anzahl[w]) || 0)), 0);
}
