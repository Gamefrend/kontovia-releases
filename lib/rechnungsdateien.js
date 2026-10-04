/**
 * Kontovia – Dateien rund um Rechnungen: Bilder der Gestaltung, PDF und XML
 * erzeugen, ablegen, speichern und anzeigen.
 *
 * Logo und Zusatzbild liegen verschlüsselt im Tresor wie jeder Beleg; die
 * Einstellungen merken sich nur die Kennung. Jedes Bild wird beim Hochladen
 * auf weißem Grund in ein JPEG umgerechnet: PDF/A duldet keine Transparenz,
 * und so bleibt die Rechnung klein.
 */

import { verkaeuferAus, design as designAus, designVoll } from './rechnung.js';
import { eRechnungXml, xmlDateiname } from './erechnung-schreiben.js';
import { rechnungPdf, rechnungSeiten, pdfDateiname, bilderNachName } from './rechnungsdruck.js';
import { jpegInfo } from './pdfa.js';
import { seiteAlsSvg } from './pdfvorschau.js';
import { base64 } from './pdfausgabe.js';
import { store } from './store.js';

const api = globalThis.window?.kontovia || {};

export function base64ZuBytes(b64) {
  const s = atob(String(b64 || ''));
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/* -------------------------------------------------------------------------- */
/* Bilder                                                                      */
/* -------------------------------------------------------------------------- */

/** Geladene Bilder je Belegkennung: { bytes, breite, hoehe, url }. */
const bildCache = new Map();

async function bildLaden(id) {
  if (!id) return null;
  if (bildCache.has(id)) return bildCache.get(id);
  try {
    const bytes = base64ZuBytes(await api.attach.read(id));
    const info = jpegInfo(bytes);
    if (!info) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
    const b = { bytes, breite: info.breite, hoehe: info.hoehe, url };
    bildCache.set(id, b);
    return b;
  } catch {
    return null;
  }
}

/**
 * Alle Bilder einer Gestaltung (Logo, Zusatzbild, Briefpapier, eigene
 * Elemente) und die Bilder einer Rechnung.
 */
export async function bilderLaden(d, r = null) {
  const freiIds = [...new Set([
    ...(Array.isArray(d?.elemente) ? d.elemente : []).filter((e) => e?.art === 'bild' && e.bildId).map((e) => e.bildId),
    ...(Array.isArray(r?.bilder) ? r.bilder : []).filter((e) => e?.bildId).map((e) => e.bildId),
  ])];
  const [logo, bild, briefpapier, ...frei] = await Promise.all([bildLaden(d?.logoId), bildLaden(d?.bildId), bildLaden(d?.briefpapierId), ...freiIds.map(bildLaden)]);
  const freiMap = Object.fromEntries(freiIds.map((id, i) => [id, frei[i]]).filter(([, b]) => b));
  return { ...(logo ? { logo } : {}), ...(bild ? { bild } : {}), ...(briefpapier ? { briefpapier } : {}), frei: freiMap };
}

/** Ein einzelnes Bild aus dem Tresor (für Vorschaubilder in der Oberfläche). */
export const bildHolen = (id) => bildLaden(id);

/**
 * Wandelt eine Bilddatei in ein JPEG auf weißem Grund (höchstens 1600 px,
 * ein Briefpapier bis 2480 px, das sind 300 dpi auf A4) und legt es im
 * Tresor ab. Rückgabe: Belegeintrag.
 */
export async function bildAblegen(datei, { maxPixel = 1600 } = {}) {
  const quelle = await createImageBitmap(datei);
  const faktor = Math.min(1, maxPixel / quelle.width, maxPixel / quelle.height);
  const breite = Math.max(1, Math.round(quelle.width * faktor));
  const hoehe = Math.max(1, Math.round(quelle.height * faktor));
  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, breite, hoehe);
  ctx.drawImage(quelle, 0, 0, breite, hoehe);
  quelle.close?.();
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Das Bild ließ sich nicht umwandeln.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = String(datei.name || 'bild').replace(/\.[^.]+$/, '') + '.jpg';
  const meta = await api.attach.add(name, 'image/jpeg', base64(bytes));
  bildCache.set(meta.id, { bytes, breite, hoehe, url: URL.createObjectURL(blob) });
  return meta;
}

/** Bilddatei wählen (ohne Umweg über den Belegdialog). */
export function bildWaehlen() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
}

/* -------------------------------------------------------------------------- */
/* Erzeugen                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Verkäufer und Gestaltung einer Rechnung: bei einer ausgestellten der Stand
 * vom Ausstellen, sonst der aus den Einstellungen.
 */
export function rahmenVon(r) {
  const s = store.db?.settings || {};
  // Die eingefrorene Gestaltung nur mit den Vorgaben ergänzen, nie mit heutigen Einstellungen:
  // Sonst tauchten neue Elemente auch in der Ansicht alter Rechnungen auf.
  // Auch den GiroCode: Rechnungen vor 2.10 hatten keinen, ihre Ansicht soll dem abgelegten PDF gleichen.
  if (r?.status === 'ausgestellt' && r.verkaeufer) return { v: r.verkaeufer, d: designVoll({ girocode: false, ...(r.gestaltung || {}) }) };
  return { v: verkaeuferAus(s), d: designAus(s) };
}

/** Die beiden Dateien einer Rechnung, frisch erzeugt. */
export async function dateienErzeugen(r, { v, d } = rahmenVon(r)) {
  const bilder = await bilderLaden(d, r);
  const xmlFx = eRechnungXml(r, v, { profil: 'en16931' });
  const xmlX = eRechnungXml(r, v, { profil: 'xrechnung' });
  const pdf = await rechnungPdf(r, v, d, { bilder, xml: xmlFx, profil: 'en16931' });
  return { pdf, xmlFx, xmlX };
}

/** Vorschau als SVG-Seiten. */
export async function vorschauSvg(r, rahmen = rahmenVon(r)) {
  return (await vorschauDaten(r, rahmen)).svgs;
}

/** Vorschau samt den verschiebbaren Bereichen der ersten Seite (für den Gestalter). */
export async function vorschauDaten(r, { v, d } = rahmenVon(r)) {
  const bilder = await bilderLaden(d, r);
  const { seiten, bereiche } = rechnungSeiten(r, v, d, { bilder, eRechnung: true });
  const urls = Object.fromEntries(Object.entries(bilderNachName(bilder)).map(([n, b]) => [n, b.url]));
  return { svgs: seiten.map((s) => seiteAlsSvg(s, urls)), bereiche, bilder };
}

/* -------------------------------------------------------------------------- */
/* Speichern und Anzeigen                                                      */
/* -------------------------------------------------------------------------- */

const PDF_FILTER = [{ name: 'PDF-Dokument', extensions: ['pdf'] }];
const XML_FILTER = [{ name: 'E-Rechnung (XML)', extensions: ['xml'] }];

/** Die abgelegte Datei einer ausgestellten Rechnung lesen. */
export async function abgelegt(r, art) {
  const id = r?.dateien?.[art];
  if (!id) return null;
  return base64ZuBytes(await api.attach.read(id));
}

export async function pdfSpeichern(r) {
  const bytes = (r.status === 'ausgestellt' && await abgelegt(r, 'pdf').catch(() => null)) || (await dateienErzeugen(r)).pdf;
  return api.file.save({ dataBase64: base64(bytes), defaultName: pdfDateiname(r), filters: PDF_FILTER });
}

export async function pdfZeigen(r) {
  const bytes = (r.status === 'ausgestellt' && await abgelegt(r, 'pdf').catch(() => null)) || (await dateienErzeugen(r)).pdf;
  return api.file.open({ dataBase64: base64(bytes), defaultName: pdfDateiname(r), mime: 'application/pdf' });
}

/** XML speichern: 'xrechnung' oder 'en16931' (dieselbe Datei wie im PDF). */
export async function xmlSpeichern(r, profil = 'xrechnung') {
  let bytes = null;
  if (r.status === 'ausgestellt' && profil === 'xrechnung') bytes = await abgelegt(r, 'xml').catch(() => null);
  if (!bytes) {
    const { v } = rahmenVon(r);
    bytes = new TextEncoder().encode(eRechnungXml(r, v, { profil }));
  }
  return api.file.save({ dataBase64: base64(bytes), defaultName: xmlDateiname(r, profil), filters: XML_FILTER });
}
