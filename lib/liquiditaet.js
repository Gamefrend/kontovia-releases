/**
 * Kontovia – Liquiditätsvorschau: Wie entwickelt sich der Kontostand in den nächsten Wochen?
 *
 * Reine Rechnung aus dem, was schon im Bestand steht, ohne Schätzung aus der Vergangenheit:
 *   Start      Stand aller aktiven Konten (Bank und Kasse) heute (calc.js: accountBalances)
 *   Zuflüsse   offene Einnahmen zu ihrer Fälligkeit (überfällige zählen heute in einer Woche, als Hoffnung,
 *              aber sichtbar markiert), Raten einzeln, wiederkehrende Einnahmen und wiederkehrende Rechnungen
 *              (Betrag der Vorlage zu Datum plus Zahlungsziel)
 *   Abflüsse   offene Ausgaben zu ihrer Fälligkeit, wiederkehrende Ausgaben, die Umsatzsteuer-Zahllast der
 *              Voranmeldungen mit Frist im Zeitraum (fristen.js: steuertermine, calc.js: vatReturn Kz 83)
 * Private Buchungen zählen mit, denn sie bewegen dasselbe Geld; stornierte nicht.
 */

import { addDays, todayISO } from './util.js';
import { accountBalances, isVoidPart, vatReturn } from './calc.js';
import { TURNUS, vorkommen, vorkommenId } from './wiederkehrend.js';
import { steuertermine } from './fristen.js';
import { berechnen } from './rechnung.js';

const NACHFRIST = 7;

/**
 * @param {object} db
 * @param {{heute?:string, tage?:number}} opt
 * @returns {{start:number, ende:number, tiefpunkt:{datum:string, bestand:number}, posten:Array<{datum:string, betrag:number,
 *   text:string, art:string, ueberfaellig?:boolean}>, wochen:Array<{von:string, bis:string, ein:number, aus:number, bestand:number}>,
 *   einnahmen:number, ausgaben:number}}
 */
export function liquiditaetsVorschau(db, { heute = todayISO(), tage = 90 } = {}) {
  const bis = addDays(heute, tage);
  const konten = accountBalances(db, heute).filter((k) => k.active !== false);
  const start = konten.reduce((s, k) => s + k.balance, 0);
  const posten = [];
  const vorhanden = new Set([...(db.transactions || []), ...(db.invoices || [])].map((t) => t.id));

  // Offene Buchungen (auch Raten): Fälligkeit, sonst Rechnungsdatum; Überfälliges nach einer Nachfrist.
  for (const t of db.transactions || []) {
    if (t.paidDate || isVoidPart(t) || !t.gross) continue;
    const faellig = t.dueDate || t.date;
    const ueber = faellig < heute;
    const datum = ueber ? addDays(heute, NACHFRIST) : faellig;
    if (datum > bis) continue;
    const vz = t.type === 'income' ? 1 : -1;
    posten.push({ datum, betrag: vz * Math.abs(t.gross), text: t.description || (vz > 0 ? 'Offene Einnahme' : 'Offene Ausgabe'), art: vz > 0 ? 'forderung' : 'verbindlichkeit', ...(ueber ? { ueberfaellig: true } : {}) });
  }

  // Wiederkehrendes: künftige Vorkommen, die noch nicht angelegt sind.
  for (const regel of db.recurring || []) {
    if (regel.active === false || !TURNUS[regel.freq] || !regel.start) continue;
    for (let n = Number(regel.n) || 0, k = 0; k < 400; n++, k++) {
      if (Number(regel.anzahl) > 0 && n >= Number(regel.anzahl)) break;
      const d = vorkommen(regel, n);
      if (regel.until && d > regel.until) break;
      if (d > bis) break;
      if (d < heute || vorhanden.has(vorkommenId(regel, d))) continue;
      if (regel.art === 'rechnung' && regel.rechnung) {
        const betrag = berechnen(regel.rechnung).brutto;
        const zahltag = addDays(d, Number(regel.rechnung.zahlungszielTage) || 0);
        if (betrag && zahltag <= bis) posten.push({ datum: zahltag, betrag, text: regel.template?.description || regel.rechnung.betreff || 'Wiederkehrende Rechnung', art: 'wiederkehrend' });
        continue;
      }
      const t = regel.template || {};
      if (!t.gross) continue;
      posten.push({ datum: d, betrag: (t.type === 'income' ? 1 : -1) * Math.abs(t.gross), text: t.description || 'Wiederkehrende Buchung', art: 'wiederkehrend' });
    }
  }

  // Umsatzsteuer: Zahllast der Voranmeldungen, deren Frist in den Zeitraum fällt.
  for (const termin of steuertermine(db.settings || {}, heute, bis)) {
    if (termin.art !== 'ustva' || !termin.zeitraum) continue;
    const zahllast = vatReturn(db, termin.zeitraum.from, termin.zeitraum.to).kz83;
    if (zahllast > 0) posten.push({ datum: termin.datum, betrag: -zahllast, text: termin.titel, art: 'steuer' });
  }

  posten.sort((a, b) => a.datum.localeCompare(b.datum) || b.betrag - a.betrag);
  let bestand = start;
  let tiefpunkt = { datum: heute, bestand: start };
  for (const p of posten) {
    bestand += p.betrag;
    p.bestand = bestand;
    if (bestand < tiefpunkt.bestand) tiefpunkt = { datum: p.datum, bestand };
  }

  const wochen = [];
  let lauf = start;
  for (let von = heute; von <= bis; von = addDays(von, 7)) {
    const wbis = addDays(von, 6);
    const drin = posten.filter((p) => p.datum >= von && p.datum <= wbis);
    const ein = drin.filter((p) => p.betrag > 0).reduce((s, p) => s + p.betrag, 0);
    const aus = drin.filter((p) => p.betrag < 0).reduce((s, p) => s - p.betrag, 0);
    lauf += ein - aus;
    wochen.push({ von, bis: wbis, ein, aus, bestand: lauf });
  }
  return {
    start, ende: bestand, tiefpunkt, posten, wochen,
    einnahmen: posten.filter((p) => p.betrag > 0).reduce((s, p) => s + p.betrag, 0),
    ausgaben: posten.filter((p) => p.betrag < 0).reduce((s, p) => s - p.betrag, 0),
  };
}
