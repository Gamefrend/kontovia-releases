/**
 * Kontovia – Berichte als PDF speichern, anzeigen, drucken.
 *
 * Die PDF-Datei entsteht in der Oberfläche selbst (dokument.js, pdf.js) und
 * ist in beiden Fassungen dieselbe. Die Brücke übernimmt nur noch, was das
 * Gerät betrifft: Speichern-Dialog, Anzeigen, Druckdialog.
 */

import { alsPdf, alsHtml } from './dokument.js';

const api = globalThis.window?.kontovia || {};
const PDF_FILTER = [{ name: 'PDF-Dokument', extensions: ['pdf'] }];

export function base64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Ein oder mehrere Berichte als Datei für ein Paket: { name, dataBase64 }. */
export async function pdfFuerPaket(docs, name) {
  return { name, dataBase64: base64(await alsPdf(docs)) };
}

/** Speichern-Dialog; Rückgabe: Pfad bzw. Dateiname oder null bei Abbruch. */
export async function pdfSpeichern(docs, name) {
  const bytes = await alsPdf(docs);
  return api.file.save({ dataBase64: base64(bytes), defaultName: name, filters: PDF_FILTER });
}

/** Im PDF-Betrachter öffnen (Browser: neuer Tab; Windows: Standardprogramm). */
export async function pdfZeigen(docs, name) {
  const bytes = await alsPdf(docs);
  return api.file.open({ dataBase64: base64(bytes), defaultName: name, mime: 'application/pdf' });
}

/**
 * Gibt es einen Druckdialog? Auf Telefon und Tablet nicht: Dort heißt Drucken
 * „an einen Drucker senden“, gewollt ist aber fast immer die PDF-Datei.
 */
export function druckenMoeglich() {
  const ua = globalThis.navigator?.userAgent || '';
  const tablet = globalThis.navigator?.platform === 'MacIntel' && globalThis.navigator?.maxTouchPoints > 1;
  return !(/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || tablet);
}

/** Der Druckdialog als Zusatzweg (Web-Fassung). */
export async function drucken(docs, name) {
  const liste = Array.isArray(docs) ? docs : [docs];
  return api.pdf.create({ html: alsHtml(liste), defaultName: name, landscape: liste.some((d) => d.quer) });
}
