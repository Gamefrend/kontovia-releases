/**
 * Kontovia – Dateien sichern, öffnen und auswählen in der Web-Fassung.
 *
 * Drei Wege, je nachdem, was der Browser kann (dazu Teilen mit Text für den
 * E-Mail-Versand und der Download ohne Dialog für E-Mail-Entwürfe):
 *   Chrome/Edge am Rechner  echter Speichern-Dialog und Ordnerauswahl
 *   iPhone und iPad         Teilen-Menü („In Dateien sichern“, AirDrop, Mail)
 *   übrige Browser          Download in den Download-Ordner
 *
 * Teilen und Speichern-Dialoge verlangen, dass sie unmittelbar auf einen
 * Klick folgen. Dauert die Vorbereitung länger – etwa bei einer Vollsicherung
 * mit vielen Belegen –, ist dieser Klick verbraucht. Dann erscheint ein
 * kleines Fenster mit einem Knopf, dessen Klick den Vorgang abschließt.
 */

import { modal } from '../lib/ui.js';
import { zip } from './zip.js';

export function istMobilesApple() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const istMobil = () => istMobilesApple() || /Android/i.test(navigator.userAgent);

/** Als App auf dem Home-Bildschirm gestartet, nicht in einem Browserfenster. */
const istAlsApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  xml: 'application/xml', zip: 'application/zip', html: 'text/html', kvbak: 'application/octet-stream', eml: 'message/rfc822',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeFuer(name) {
  return MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
}

/** Wie sanitizeName im Hauptprozess: keine Pfade, keine Steuerzeichen. */
export function sichererName(name) {
  return String(name || 'datei')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180) || 'datei';
}

const keineNutzeraktion = (e) => e?.name === 'NotAllowedError' || e?.name === 'SecurityError';

function typenAus(filters) {
  const out = [];
  for (const f of filters || []) {
    const ext = (f.extensions || []).filter((x) => x && x !== '*');
    if (!ext.length) continue;
    out.push({ description: f.name || ext.join(', '), accept: { [mimeFuer('x.' + ext[0])]: ext.map((x) => '.' + x) } });
  }
  return out;
}

function herunterladen(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Der eigentliche Vorgang – braucht einen frischen Klick. */
async function ausfuehren(file, filters) {
  if (window.showSaveFilePicker && !istMobil()) {
    const handle = await window.showSaveFilePicker({ suggestedName: file.name, types: typenAus(filters) });
    const w = await handle.createWritable();
    await w.write(file);
    await w.close();
    return handle.name;
  }
  // Ein PDF soll als Datei landen, nicht im Teilen-Menü (dort steht „Drucken“ gleich bei den
  // Aktionen). In Safari wird es deshalb wie jeder Download gesichert. Nur die installierte App
  // behält das Teilen-Menü: Ein Download würde dort in einer Vorschau ohne Weg zurück enden.
  const alsDownload = file.type === 'application/pdf' && !istAlsApp();
  if (istMobilesApple() && !alsDownload && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return file.name;
  }
  herunterladen(file);
  return file.name;
}

/** Fenster mit einem Knopf, dessen Klick den Vorgang auslöst. */
function mitKnopf(file, filters) {
  return new Promise((resolve) => {
    let erledigt = false;
    const m = modal({
      title: 'Datei ist bereit',
      size: 'slim',
      body: `<p class="mt0">„${file.name.replace(/[<>&"]/g, '')}“ ist fertig erstellt.</p>
        <p class="small muted mb0">${istMobilesApple()
          ? 'Tippen Sie auf „Sichern“ und wählen Sie im Teilen-Menü „In Dateien sichern“.'
          : 'Klicken Sie auf „Sichern“, um den Speicherort zu wählen.'}</p>`,
      foot: '<button class="btn" data-nein>Verwerfen</button><button class="btn primary" data-ja>Sichern</button>',
      onClose: () => { if (!erledigt) resolve(null); },
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-ja]').addEventListener('click', async () => {
      erledigt = true;
      m.close();
      try { resolve(await ausfuehren(file, filters)); } catch (e) { resolve(e?.name === 'AbortError' ? null : Promise.reject(e)); }
    });
  });
}

/**
 * Bietet eine Datei zum Sichern an.
 * @returns {Promise<string|null>} Dateiname oder null bei Abbruch
 */
export async function anbieten(bytes, name, { mime, filters } = {}) {
  const file = new File([bytes], sichererName(name), { type: mime || mimeFuer(name) });
  try {
    return await ausfuehren(file, filters);
  } catch (e) {
    if (e?.name === 'AbortError') return null;
    if (keineNutzeraktion(e)) return mitKnopf(file, filters);
    throw e;
  }
}

/**
 * Legt eine Datei ohne Speichern-Dialog in den Download-Ordner. Am Rechner
 * öffnet ein Klick in der Download-Leiste sie dann mit dem passenden
 * Programm, eine E-Mail etwa in Outlook. iPhone und iPad haben keine solche
 * Leiste; dort gilt der übliche Weg.
 * @returns {Promise<string|null>} Dateiname oder null bei Abbruch
 */
export async function herunterladenOderAnbieten(bytes, name, { mime } = {}) {
  if (istMobil()) return anbieten(bytes, name, { mime });
  const file = new File([bytes], sichererName(name), { type: mime || mimeFuer(name) });
  herunterladen(file);
  return file.name;
}

/**
 * Kann das Teilen-Menü diese Dateien weitergeben? Geprüft wird nur Name und
 * Art; manche Browser lehnen etwa XML ab.
 * @param {{name:string, mime?:string}[]} liste
 */
export function teilenMoeglich(liste) {
  if (!navigator.canShare || !liste?.length) return false;
  try {
    return navigator.canShare({ files: liste.map((f) => new File([], sichererName(f.name), { type: f.mime || mimeFuer(f.name) })) });
  } catch {
    return false;
  }
}

/**
 * Dateien samt Text an das Teilen-Menü des Geräts (Mail, Outlook …).
 * Muss unmittelbar auf einen Klick folgen.
 * @returns {Promise<boolean>} false bei Abbruch
 */
export async function teilen(files, { title = '', text = '' } = {}) {
  const liste = files.map((f) => new File([f.data], sichererName(f.name), { type: f.mime || mimeFuer(f.name) }));
  if (!navigator.canShare?.({ files: liste })) {
    throw Object.assign(new Error('Dieses Gerät kann die Dateien nicht teilen.'), { code: 'TEILEN_NICHT_MOEGLICH' });
  }
  try {
    await navigator.share({ files: liste, title, text });
    return true;
  } catch (e) {
    if (e?.name === 'AbortError') return false;
    if (keineNutzeraktion(e)) throw Object.assign(new Error('Bitte tippen Sie noch einmal auf den Knopf.'), { code: 'KLICK_NOETIG' });
    throw e;
  }
}

/**
 * Mehrere Dateien: am Rechner in einen gewählten Ordner, sonst als ZIP.
 * @param {{name:string, data:Uint8Array}[]} files
 * @returns {Promise<{dir:string, written:string[]}|null>}
 */
/** Die Dateien als ZIP-Bytes (für das Jahresarchiv, bridge.js: file.archiv). */
export function zipBytes(files) {
  return zip(files);
}

export async function mehrereAnbieten(files, { zipName = 'Kontovia-Export' } = {}) {
  if (window.showDirectoryPicker && !istMobil()) {
    let dir = null;
    try {
      dir = await window.showDirectoryPicker({ id: 'kontovia-export', mode: 'readwrite' });
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      if (!keineNutzeraktion(e)) throw e;
      // Klick verbraucht – dann als ZIP über den Knopf.
    }
    if (dir) {
      const written = [];
      for (const f of files) {
        const h = await dir.getFileHandle(sichererName(f.name), { create: true });
        const w = await h.createWritable();
        await w.write(f.data);
        await w.close();
        written.push(f.name);
      }
      return { dir: dir.name, written };
    }
  }
  return alsZipAnbieten(files, { zipName });
}

/** Mehrere Dateien als eine ZIP-Datei anbieten (Speichern-Dialog oder Download). */
export async function alsZipAnbieten(files, { zipName = 'Kontovia-Export' } = {}) {
  const name = await anbieten(await zip(files), `${sichererName(zipName)}.zip`, { mime: 'application/zip' });
  return name ? { dir: name, written: files.map((f) => f.name) } : null;
}

/**
 * Öffnet einen Beleg in einem neuen Tab. Nur Formate, die der Browser selbst
 * anzeigt; alles andere – vor allem HTML – wird zum Sichern angeboten statt
 * unter der Adresse von Kontovia geöffnet.
 */
const ANZEIGBAR = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain)$/;

export async function oeffnen(bytes, name, mime) {
  const typ = ANZEIGBAR.test(mime) ? mime : '';
  if (!typ) return anbieten(bytes, name, { mime: 'application/octet-stream' });
  const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  if (!w) return anbieten(bytes, name, { mime: typ });
  return name;
}

/**
 * Dateiauswahl des Browsers. Auf dem iPhone bietet sie zusätzlich Kamera
 * und Fotomediathek an – Belege lassen sich direkt fotografieren.
 * @returns {Promise<File[]>}
 */
export function waehlen({ multiple = false, filters = [], accept = '' } = {}) {
  const ext = filters.flatMap((f) => f.extensions || []).filter((x) => x && x !== '*');
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    // „image/*“ statt einzelner Bildendungen: dann wandelt das iPhone Fotos
    // von HEIC in JPEG um, das jeder Rechner und jede Kanzlei öffnen kann.
    if (accept) input.accept = accept;
    else if (ext.length && !filters.some((f) => (f.extensions || []).includes('*'))) {
      input.accept = ext.map((x) => '.' + x).join(',');
    }
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(input);
    let fertig = false;
    const ende = (files) => {
      if (fertig) return;
      fertig = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => ende([...(input.files || [])]));
    input.addEventListener('cancel', () => ende([]));
    input.click();
  });
}
