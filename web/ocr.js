/**
 * Kontovia – Texterkennung für Fotos von Belegen, ganz auf dem Gerät.
 *
 * Seitenseite von Tesseract.js (vendor/tesseract/tesseract.esm.min.js): bereitet das Bild auf (drehen nach den
 * Angaben der Kamera, verkleinern, Graustufen, Kontrast) und schickt es an den abgeschotteten Worker
 * (ocr-worker.js), der den Text liest. Sprachpakete Deutsch und Englisch (Deutsch zuerst; unsichere Wörter liest
 * Tesseract mit dem englischen Paket nach, etwa bei Rechnungen ausländischer Anbieter).
 * Nichts davon geht ins Netz; Rechenkern und Sprachpaket kommen aus der eigenen Fassung im Zwischenspeicher.
 * Der Worker startet erst beim ersten Beleg (gut 8 MB laden, ein, zwei Sekunden einrichten) und wird nach zwei Minuten
 * ohne Arbeit beendet, damit er keinen Speicher hält.
 *
 * Was im Text steht, deutet lib/beleglesen.js (Betrag, Datum, Lieferant); das hier liefert nur den Text.
 */

const PFAD = (p) => new URL(p, import.meta.url).href;
const LEERLAUF_MS = 2 * 60 * 1000;
/** Längste Seite des aufbereiteten Bildes: genug für Kassenbons, ohne den Speicher kleiner Telefone zu sprengen. */
const MAX_PIXEL = 2400;
/** Sprachpakete in vendor/tesseract/ (HERKUNFT.md): Deutsch zuerst, Englisch für den Rest. */
const SPRACHEN = 'deu+eng';

let arbeiter = null; // Promise<Tesseract-Worker>
let zeitgeber = null;

/** Kann dieser Browser die Texterkennung ausführen? (WebAssembly mit SIMD; ohne SIMD fehlt der passende Rechenkern.) */
export function texterkennungMoeglich() {
  if (typeof WebAssembly !== 'object' || typeof Worker === 'undefined') return false;
  try {
    // Kleinstes Modul mit SIMD-Anweisungen, dieselbe Probe wie wasm-feature-detect in Tesseract (worker.min.js).
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

async function holen() {
  if (!arbeiter) {
    arbeiter = import('./vendor/tesseract/tesseract.esm.min.js').then((m) => (m.default || m).createWorker(SPRACHEN, 1, {
      workerPath: PFAD('./ocr-worker.js'),
      corePath: PFAD('./vendor/tesseract/tesseract-core-simd-lstm.wasm.js'),
      langPath: PFAD('./vendor/tesseract'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: () => {},
      errorHandler: () => {},
    }));
    arbeiter.catch(() => { arbeiter = null; });
  }
  return arbeiter;
}

function spaeterBeenden() {
  clearTimeout(zeitgeber);
  zeitgeber = setTimeout(beenden, LEERLAUF_MS);
}

/** Den Worker beenden (beim Sperren und nach dem Leerlauf). */
export async function beenden() {
  clearTimeout(zeitgeber);
  const w = arbeiter;
  arbeiter = null;
  if (!w) return;
  try { await (await w).terminate(); } catch { /* war nie richtig da */ }
}

/** Das Bild für die Erkennung aufbereiten: richtig herum, verkleinert, grau, mit mehr Kontrast, als PNG. */
async function aufbereiten(quelle) {
  const bild = await createImageBitmap(quelle, { imageOrientation: 'from-image' });
  const faktor = Math.min(1, MAX_PIXEL / Math.max(bild.width, bild.height));
  const b = Math.max(1, Math.round(bild.width * faktor));
  const h = Math.max(1, Math.round(bild.height * faktor));
  const leinwand = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(b, h) : Object.assign(document.createElement('canvas'), { width: b, height: h });
  const ctx = leinwand.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, b, h);
  ctx.drawImage(bild, 0, 0, b, h);
  bild.close?.();
  const daten = ctx.getImageData(0, 0, b, h);
  const p = daten.data;
  // Graustufen und Kontrast um den Mittelwert gestreckt: hilft bei blassen Thermobons und Schatten.
  let summe = 0;
  for (let i = 0; i < p.length; i += 4) summe += 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const mittel = summe / (p.length / 4) || 128;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const v = Math.max(0, Math.min(255, (g - mittel) * 1.6 + 150));
    p[i] = v; p[i + 1] = v; p[i + 2] = v;
  }
  ctx.putImageData(daten, 0, 0);
  return leinwand.convertToBlob ? leinwand.convertToBlob({ type: 'image/png' }) : new Promise((ok) => leinwand.toBlob(ok, 'image/png'));
}

/**
 * Text aus einem Bild (Blob oder Datei: JPEG, PNG, WebP, auf dem iPhone auch HEIC, was der Browser eben öffnet).
 * @returns {Promise<{text:string, sicherheit:number}>} sicherheit 0–100 laut Tesseract
 */
export async function texterkennung(bild) {
  if (!texterkennungMoeglich()) throw Object.assign(new Error('Dieser Browser kann Fotos nicht selbst lesen. Bitte tragen Sie die Angaben von Hand ein.'), { code: 'OCR_NICHT_MOEGLICH' });
  clearTimeout(zeitgeber);
  try {
    const eingabe = await aufbereiten(bild);
    const w = await holen();
    const { data } = await w.recognize(eingabe);
    return { text: String(data?.text || ''), sicherheit: Math.round(Number(data?.confidence) || 0) };
  } finally {
    spaeterBeenden();
  }
}
