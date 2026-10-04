/**
 * Kontovia – GiroCode (EPC-QR-Code) für Überweisungen.
 *
 * Der European Payments Council legt in „Quick Response Code: Guidelines to
 * Enable the Data Capture for the Initiation of a SEPA Credit Transfer“
 * (EPC069-12) fest, was im QR-Code steht: zwölf Zeilen, getrennt durch einen
 * Zeilenumbruch, Zeichensatz UTF-8, höchstens 331 Bytes, Fehlerkorrektur M,
 * Version des QR-Codes höchstens 13. Die Banking-Apps lesen daraus Empfänger,
 * IBAN, Betrag und Verwendungszweck und füllen die Überweisung aus.
 *
 * Diese Datei baut den Inhalt (Version 002: die BIC darf fehlen) und zeichnet
 * den Code in eine Seite (lib/pdfa.js). Der QR-Code selbst entsteht in
 * lib/qr.js.
 */

import { qrCode, laeufe } from './qr.js';
import { ibanGueltig } from './rechnung.js';

const MAX_BYTES = 331;
const bytesVon = (t) => new TextEncoder().encode(t).length;

/** Kürzt einen Text auf höchstens n Zeichen, ohne ein Zeichen zu zerreißen. */
function kuerzen(text, n) {
  const z = [...String(text ?? '').replace(/[\r\n]+/g, ' ').trim()];
  return z.slice(0, n).join('');
}

/**
 * Der Inhalt des GiroCodes.
 *
 * @param {{name:string, iban:string, bic?:string, betrag:number, verwendung:string}} a
 *   betrag in Cent (0,01 bis 999.999.999,99 €); verwendung ist der freie
 *   Verwendungszweck (höchstens 140 Zeichen), bei uns „Rechnung <Nummer>“
 * @returns {{ok:true, text:string}|{ok:false, grund:string}}
 */
export function girocodeInhalt({ name, iban, bic = '', betrag, verwendung = '' } = {}) {
  const i = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!i) return { ok: false, grund: 'Es fehlt die IBAN.' };
  if (!ibanGueltig(i)) return { ok: false, grund: 'Die IBAN ist ungültig.' };
  const n = kuerzen(name, 70);
  if (!n) return { ok: false, grund: 'Es fehlt der Name des Empfängers.' };
  const cent = Math.round(Number(betrag));
  if (!Number.isFinite(cent) || cent < 1) return { ok: false, grund: 'Der Betrag muss größer als null sein.' };
  if (cent > 99999999999) return { ok: false, grund: 'Der Betrag ist zu hoch.' };
  const b = String(bic || '').replace(/\s/g, '').toUpperCase();
  if (b && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b)) return { ok: false, grund: 'Die BIC ist ungültig.' };
  const euro = `${Math.floor(cent / 100)}.${String(cent % 100).padStart(2, '0')}`;
  const zeilen = [
    'BCD', // Servicekennung
    '002', // Version (BIC optional)
    '1', // Zeichensatz 1 = UTF-8
    'SCT', // SEPA Credit Transfer
    b,
    n,
    i,
    `EUR${euro}`,
    '', // Zweckcode
    '', // strukturierte Referenz (entweder diese oder der freie Text)
    kuerzen(verwendung, 140),
  ];
  let text = zeilen.join('\n');
  // Passt alles zusammen nicht in 331 Bytes, wird der freie Text gekürzt; Empfänger, IBAN und Betrag bleiben vollständig.
  while (bytesVon(text) > MAX_BYTES && zeilen[10]) {
    zeilen[10] = [...zeilen[10]].slice(0, -1).join('');
    text = zeilen.join('\n');
  }
  if (bytesVon(text) > MAX_BYTES) return { ok: false, grund: 'Die Angaben sind zu lang für den GiroCode.' };
  return { ok: true, text };
}

/** Der QR-Code zu einem Inhalt: Stufe M, höchstens Version 13. */
export function girocodeModule(text) {
  return qrCode(text, { stufe: 'M', maxVersion: 13 });
}

/**
 * Zeichnet den GiroCode mit Ruhezone ins Blatt.
 * @param {import('./pdfa.js').Seite} seite
 * @param {{module:boolean[][], groesse:number}} qr
 * @param {number} x  linke Kante in Punkt (die Ruhezone gehört dazu)
 * @param {number} y  obere Kante in Punkt
 * @param {number} breite  Seitenlänge in Punkt einschließlich Ruhezone von vier Modulen
 */
export function girocodeZeichnen(seite, qr, x, y, breite, farbe = '#000000') {
  const ruhe = 4;
  const m = breite / (qr.groesse + 2 * ruhe);
  seite.rechteck(x, y, breite, breite, { fuellung: '#ffffff' });
  for (const l of laeufe(qr.module)) {
    // Eine Spur über den nächsten Lauf hinaus, damit keine Haarlinien zwischen den Zeilen entstehen.
    seite.rechteck(x + (ruhe + l.x) * m, y + (ruhe + l.y) * m, l.b * m, m * 1.04, { fuellung: farbe });
  }
}
