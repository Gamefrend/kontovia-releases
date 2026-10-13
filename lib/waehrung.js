/**
 * Kontovia – Fremdwährungen: Liste der Währungen, Umrechnungskurs, Umrechnen in Euro.
 *
 * Gebucht wird immer in Euro-Cent (Unverhandelbar 2: ganzzahlige Cent); Auswertungen, Voranmeldung, EÜR und
 * Exporte rechnen weiter nur mit Euro. Eine Rechnung oder Buchung in fremder Währung trägt zusätzlich, was
 * in der Fremdwährung vereinbart ist:
 *
 *   Rechnung  `waehrung` (ISO 4217) und `kurs`: Einheiten der Fremdwährung je 1 Euro (wie die EZB und das
 *             BMF ihn angeben, etwa 1 € = 1,0850 USD). Positionen und Summen stehen in der Fremdwährung.
 *   Buchung   `fremd: { waehrung, betrag, kurs }`: Bruttobetrag in Cent der Fremdwährung; `gross` ist der
 *             Euro-Betrag daraus (inEuro).
 *
 * Kontovia holt keine Kurse aus dem Netz. Für die Umsatzsteuer gilt der Monatsdurchschnitt, den das
 * Bundesfinanzministerium veröffentlicht (§ 16 Abs. 6 UStG), mit Zustimmung des Finanzamts der Tageskurs;
 * der Nutzer trägt den Kurs ein.
 */

import { sprache } from './sprache.js';

/** Häufige Währungen; weitere ISO-Codes nimmt waehrungGueltig ebenfalls an. */
export const WAEHRUNGEN = {
  EUR: 'Euro', USD: 'US-Dollar', GBP: 'Britisches Pfund', CHF: 'Schweizer Franken', JPY: 'Japanischer Yen', CNY: 'Chinesischer Yuan',
  CAD: 'Kanadischer Dollar', AUD: 'Australischer Dollar', NZD: 'Neuseeland-Dollar', SEK: 'Schwedische Krone', NOK: 'Norwegische Krone',
  DKK: 'Dänische Krone', PLN: 'Polnischer Złoty', CZK: 'Tschechische Krone', HUF: 'Ungarischer Forint', RON: 'Rumänischer Leu',
  BGN: 'Bulgarischer Lew', TRY: 'Türkische Lira', ISK: 'Isländische Krone', HKD: 'Hongkong-Dollar', SGD: 'Singapur-Dollar',
  INR: 'Indische Rupie', KRW: 'Südkoreanischer Won', MXN: 'Mexikanischer Peso', BRL: 'Brasilianischer Real', ZAR: 'Südafrikanischer Rand',
  ILS: 'Israelischer Schekel', AED: 'VAE-Dirham', THB: 'Thailändischer Baht', IDR: 'Indonesische Rupiah', MYR: 'Malaysischer Ringgit', PHP: 'Philippinischer Peso',
};

/** Ein Code aus drei Großbuchstaben. */
export const waehrungGueltig = (w) => /^[A-Z]{3}$/.test(String(w || ''));

/** Ist das eine Fremdwährung (alles außer Euro)? */
export const istFremd = (w) => !!w && String(w).toUpperCase() !== 'EUR';

/** Ein Kurs ist eine positive Zahl mit höchstens sechs Nachkommastellen, nicht absurd groß. */
export function kursGueltig(kurs) {
  const k = Number(kurs);
  return Number.isFinite(k) && k > 0 && k < 1e7;
}

/** „1,0850“ oder „1.085“ → 1.085; leer oder ungültig → 0. Beide Dezimalzeichen sind erlaubt, Tausenderpunkte nicht. */
export function kursLesen(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  const t = s.includes(',') && s.includes('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return 0;
  const k = Math.round(Number(t) * 1e6) / 1e6;
  return kursGueltig(k) ? k : 0;
}

/** Kurs für ein Eingabefeld, mit Dezimalzeichen der Oberfläche. */
export function kursEingabe(kurs) {
  if (!kursGueltig(kurs)) return '';
  const s = String(Number(kurs));
  return sprache() === 'en' ? s : s.replace('.', ',');
}

/** Cent der Fremdwährung → Euro-Cent (kaufmännisch gerundet). */
export function inEuro(cent, kurs) {
  if (!kursGueltig(kurs)) return 0;
  const c = Number(cent) || 0;
  return Math.sign(c) * Math.round(Math.abs(c) / Number(kurs));
}

/** Euro-Cent → Cent der Fremdwährung. */
export function inFremd(euroCent, kurs) {
  if (!kursGueltig(kurs)) return 0;
  const c = Number(euroCent) || 0;
  return Math.sign(c) * Math.round(Math.abs(c) * Number(kurs));
}

/** „1 € = 1,085 USD“ */
export function kursText(kurs, waehrung) {
  return `1 € = ${kursEingabe(kurs)} ${waehrung}`;
}
