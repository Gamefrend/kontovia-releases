/**
 * Kontovia – Belege automatisch holen (SEC-62): Einstellungen, Merkliste und das Übernehmen eines gefundenen Belegs.
 *
 * Gelesen wird in der Web-Schicht (src/web/belegeingang.js): neue Dateien im Eingangsordner, Anhänge aus dem
 * Outlook-Postfach. Hier entscheidet sich, was damit geschieht, und zwar immer erst nach einem Klick:
 *   E-Rechnung (XML)   wird wie unter Rechnungen › Eingang gelesen und abgelegt (views/rechnungen.js: eingangHinzufuegen)
 *   PDF und Fotos      öffnen das Buchungsfenster wie „Neue Buchung › Aus Beleg“ (lib/dateieingang.js)
 * Was übernommen oder ausgeblendet wurde, kommt in `settings.belegeingang.gesehen` und erscheint nicht wieder, auch nicht
 * auf einem anderen Gerät. Die Absender für das Postfach stehen in `settings.belegeingang.absender`.
 * Journal: `belegeingang.einstellen` (Absender) und `belegeingang.merken` (gesehen).
 */

import { store, commit } from './store.js';
import { dateiZiel } from './dateieingang.js';

/** So viele Kennungen merkt sich Kontovia; ältere fallen heraus (sie liegen dann ohnehin weit zurück). */
export const MAX_GESEHEN = 3000;

/** Die Einstellungen (ohne Bestand leer). */
export function einstellung(db = store.db) {
  const e = db?.settings?.belegeingang || {};
  return {
    absender: Array.isArray(e.absender) ? e.absender.filter((a) => typeof a === 'string') : [],
    gesehen: Array.isArray(e.gesehen) ? e.gesehen.filter((k) => typeof k === 'string') : [],
  };
}

/** Absender aus einem Freitext: Adressen oder ganze Domains (@firma.de), durch Komma, Semikolon oder Zeilen getrennt. */
export function absenderLesen(text) {
  const out = [];
  for (const roh of String(text || '').split(/[\s,;]+/)) {
    const a = roh.trim().toLowerCase().replace(/^<|>$/g, '');
    if (!a) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$|^@[^\s@]+\.[^\s@]+$/.test(a)) return { fehler: `„${roh.trim()}“ ist keine E-Mail-Adresse.`, liste: [] };
    if (!out.includes(a)) out.push(a);
  }
  return { fehler: '', liste: out.slice(0, 50) };
}

export async function absenderSpeichern(liste) {
  return commit('belegeingang.einstellen', (db) => {
    db.settings.belegeingang = { ...einstellung(db), absender: liste.slice(0, 50) };
    return db.settings.belegeingang;
  }, { entity: 'einstellung', entityId: 'belegeingang', summary: `Absender für Belege aus Outlook: ${liste.join(', ') || 'keine'}`.slice(0, 300) });
}

/** Kennungen als gesehen merken (übernommen oder ausgeblendet). */
export async function gesehenMerken(kennungen, text = '') {
  const neu = kennungen.filter(Boolean);
  if (!neu.length) return;
  await commit('belegeingang.merken', (db) => {
    const e = einstellung(db);
    const alle = [...e.gesehen.filter((k) => !neu.includes(k)), ...neu].slice(-MAX_GESEHEN);
    db.settings.belegeingang = { ...e, gesehen: alle };
    return true;
  }, { entity: 'einstellung', entityId: 'belegeingang', summary: text.slice(0, 300) });
}

/** Wohin gehört ein gefundener Beleg? 'erechnung', 'beleg' oder '' (wird nicht übernommen). */
export function belegArt(fund) {
  const kopf = /\.xml$/i.test(fund.name) || /xml/i.test(fund.typ || '') ? atobKopf(fund.dataBase64) : '';
  if (/CrossIndustryInvoice|urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2/.test(kopf)) return 'erechnung';
  return dateiZiel({ name: fund.name, type: fund.typ }, kopf) === 'beleg' ? 'beleg' : '';
}

function atobKopf(b64) {
  try { return new TextDecoder('utf-8').decode(Uint8Array.from(atob(String(b64 || '').slice(0, 8000)), (c) => c.charCodeAt(0))); } catch { return ''; }
}

/** Ein Fund als Datei (für das Buchungsfenster). */
export function alsDatei(fund) {
  const bytes = Uint8Array.from(atob(fund.dataBase64), (c) => c.charCodeAt(0));
  const typ = fund.typ || (/\.pdf$/i.test(fund.name) ? 'application/pdf' : /\.xml$/i.test(fund.name) ? 'application/xml' : '');
  return new File([bytes], fund.name, { type: typ });
}
