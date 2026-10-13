/**
 * Kontovia – „Beleg lesen“: aus einer angehängten Datei einen Vorschlag für die Buchung.
 *
 * Reihenfolge: E-Rechnung prüft das Buchungsfenster vorher selbst (lib/erechnung.js, die genauesten Werte).
 * Hier dann ein PDF mit Textebene (lib/pdftext.js), ein gescanntes PDF (seine Seitenbilder) oder ein Foto,
 * beides über die Texterkennung auf dem Gerät (api.beleg → src/web/ocr.js). Den Text deutet lib/beleglesen.js.
 * Ergebnis ist nur ein Vorschlag; übernommen wird er erst auf Klick.
 */

import { store, sel } from './store.js';
import { pdfLesen } from './pdftext.js';
import { belegDeuten } from './beleglesen.js';

const api = globalThis.window?.kontovia || {};

const istPdf = (u8, meta) => String(meta?.mime || '').includes('pdf') || /\.pdf$/i.test(meta?.fileName || '') || (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46);
const istBild = (meta) => /^image\//.test(String(meta?.mime || '')) || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(meta?.fileName || '');

/** Lässt sich diese Datei lesen? (für den Knopf „Beleg lesen“) */
export const lesbar = (meta) => istBild(meta) || /pdf/i.test(String(meta?.mime || '')) || /\.pdf$/i.test(meta?.fileName || '');

function kontext() {
  const s = store.db?.settings || {};
  return {
    kontakte: sel.contacts().map((c) => ({ id: c.id, name: c.name, taxId: c.taxId, vatId: c.vatId })),
    eigeneUstId: s.vatId || '',
    eigenerName: s.companyName || '',
  };
}

/**
 * @param {Uint8Array} bytes
 * @param {{mime?:string, fileName?:string}} meta
 * @returns {Promise<{vorschlag:object, quelle:'pdf'|'scan'|'foto', text:string}|null>} null: nichts Lesbares
 */
export async function belegErkennen(bytes, meta = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let text = '';
  let quelle = '';
  if (istPdf(u8, meta)) {
    const pdf = await pdfLesen(u8);
    if (pdf.verschluesselt) return null;
    // Genug Text mit Ziffern: digitales PDF. Sonst sind es Scans, dann die Seitenbilder lesen (höchstens zwei).
    if (pdf.text.replace(/\s/g, '').length >= 40 && /\d/.test(pdf.text)) { text = pdf.text; quelle = 'pdf'; } else if (pdf.bilder.length && api.beleg) {
      const teile = [];
      for (const b of pdf.bilder.slice(0, 2)) teile.push((await api.beleg.texterkennung(b, 'image/jpeg')).text);
      text = teile.join('\n');
      quelle = 'scan';
    }
  } else if (istBild(meta) && api.beleg) {
    text = (await api.beleg.texterkennung(u8, meta.mime || 'image/jpeg')).text;
    quelle = 'foto';
  }
  if (!text.trim()) return null;
  const vorschlag = belegDeuten(text, kontext());
  if (!vorschlag.gefunden.length) return null;
  return { vorschlag, quelle, text };
}
