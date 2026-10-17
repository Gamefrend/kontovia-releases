/**
 * Kontovia – Dateien von außen an die richtige Stelle bringen.
 *
 * Über „Öffnen mit“ am Computer oder „Teilen“ am Handy kommen Dateien in die installierte App
 * (Annahme in web/eingang.js, ohne Netz). Nach dem Entsperren verteilt sie diese Datei:
 *  - Belege (PDF, Fotos, E-Rechnung als XML) öffnen das Buchungsfenster wie „Neue Buchung › Aus Beleg“,
 *  - Kontoauszüge (CAMT, MT940) den Kontoauszug-Import,
 *  - alles andere (DATEV, Excel, CSV, vCard, Kalender, ELSTER) den Reiter Import, der das Format selbst erkennt.
 * Kommt eine Datei, solange Kontovia gesperrt ist, wartet sie bis zum Entsperren.
 */

import { navigate } from './router.js';
import { beimSperren } from './store.js';
import { toast, warn } from './ui.js';

const api = globalThis.window?.kontovia || {};

const BILD = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'tif', 'tiff']);
const KONTOAUSZUG = new Set(['sta', '940', 'mt940']);

/**
 * Wohin gehört die Datei? `kopf` ist der Anfang des Inhalts als Text (einige KB genügen).
 * @returns {'beleg'|'kontoauszug'|'import'}
 */
export function dateiZiel({ name = '', type = '' } = {}, kopf = '') {
  const endung = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  const mime = String(type).toLowerCase();
  if (mime.startsWith('image/') || BILD.has(endung)) return 'beleg';
  if (mime === 'application/pdf' || endung === 'pdf' || kopf.startsWith('%PDF')) return 'beleg';
  if (KONTOAUSZUG.has(endung) || /(^|\n):20:[^\n]*\r?\n(:21:[^\n]*\r?\n)?:25:/.test(kopf)) return 'kontoauszug';
  if (endung === 'xml' || mime.includes('xml') || /^\s*(﻿)?</.test(kopf)) {
    if (/camt\.05[234]|BkToCstmrStmt/.test(kopf)) return 'kontoauszug';
    if (/CrossIndustryInvoice|urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2/.test(kopf)) return 'beleg';
  }
  return 'import';
}

async function kopfLesen(datei) {
  try { return new TextDecoder('utf-8').decode(await datei.slice(0, 4096).arrayBuffer()); } catch { return ''; }
}

let frei = false;
beimSperren(() => { frei = false; });

const warteText = (n) => (n === 1
  ? 'Nach dem Entsperren öffnet Kontovia die Datei.'
  : `Nach dem Entsperren öffnet Kontovia ${n} Dateien.`);

/** Beim Start: auf Dateien hören. Solange gesperrt ist, sagt ein Hinweis, dass sie warten. */
export function eingangBeobachten() {
  api.on?.dateien?.(({ anzahl } = {}) => {
    if (frei) verteilen().catch((e) => console.error('Dateien von außen:', e));
    else toast('Datei empfangen', warteText(anzahl || 1), '', 7000);
  });
  Promise.resolve(api.file?.eingangWartet?.()).then((n) => { if (n) toast('Datei empfangen', warteText(n), '', 7000); }).catch(() => {});
}

/**
 * Nach dem Entsperren (app.js: afterUnlock): wartende Dateien verteilen, danach jede neue sofort.
 * @returns {Promise<boolean>} true, wenn eine Datei geöffnet wurde
 */
export async function eingangFreigeben() {
  frei = true;
  return verteilen();
}

async function verteilen() {
  let dateien = [];
  try { dateien = (await api.file?.eingang?.()) || []; } catch { return false; }
  if (!dateien.length) return false;
  // Erst hier geladen: benutzer.js zieht Konten und Abgleich nach, die der Start nicht braucht.
  const { kannSchreiben } = await import('./benutzer.js');
  if (!kannSchreiben()) {
    warn('Nur lesen', 'Mit Ihrer Rolle lassen sich keine Buchungen anlegen. Die Datei wurde nicht übernommen.');
    return false;
  }
  const gruppen = { beleg: [], kontoauszug: [], import: [] };
  for (const d of dateien) gruppen[dateiZiel(d, await kopfLesen(d))].push(d);

  // Je Aufruf ein Ziel: alle Belege in ein Buchungsfenster (wie „Aus Beleg“), sonst die erste übrige Datei.
  let genommen = 0;
  if (gruppen.beleg.length) {
    genommen = gruppen.beleg.length;
    const m = await import('../views/transactions.js');
    m.openTransactionDialog(null, 'expense', { dateien: gruppen.beleg });
  } else if (gruppen.kontoauszug.length) {
    genommen = 1;
    navigate('kontoimport', { datei: gruppen.kontoauszug[0] });
  } else {
    genommen = 1;
    navigate('export', { reiter: 'import', datei: gruppen.import[0] });
  }
  const rest = dateien.length - genommen;
  if (rest > 0) {
    toast('Weitere Dateien', rest === 1
      ? 'Eine weitere Datei wurde nicht geöffnet. Bitte öffnen Sie sie danach einzeln.'
      : `${rest} weitere Dateien wurden nicht geöffnet. Bitte öffnen Sie sie danach einzeln.`, 'warn', 9000);
  }
  return true;
}
