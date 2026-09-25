/**
 * Kontovia – Darstellungswünsche, die über mehrere Ansichten gelten.
 *
 * Welche Diagrammart jemand bevorzugt, ist keine Buchhaltung: es gehört nicht
 * in den Tresor, nicht ins Änderungsjournal und nicht in den Cloud-Abgleich.
 * Es bleibt auf diesem Gerät (localStorage) und darf dort auch fehlen – dann
 * gelten die Voreinstellungen.
 *
 * Das Häkchen „Nicht gelistete einbeziehen“ gilt bewusst nur bis zum
 * Sperren: Wer es einmal setzt, soll beim nächsten Entsperren nicht
 * unbemerkt mit anderen Zahlen arbeiten als denen, die ans Finanzamt gehen.
 */

import { html, raw, money, int } from './util.js';
import { unlistedStats } from './calc.js';
import { chart, monthTableHtml, segToggle, wireSeg } from './ui.js';

const KEY = 'kontovia.darstellung';

const DEFAULTS = {
  verlauf: 'bars',       // bars | lines | cumulative | table
  verlaufAvg: true,      // Monatsdurchschnitt einblenden
  anteilAusgaben: 'bars', // bars | pie
  anteilEinnahmen: 'bars',
  anteilGuv: 'pie',
  anteilGuvArt: 'expense', // expense | income
};

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs = load();

/** Setzt einen Wunsch und merkt ihn sich auf diesem Gerät. */
export function setPref(key, value) {
  prefs[key] = value;
  try {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = prefs[k];
    globalThis.localStorage?.setItem(KEY, JSON.stringify(out));
  } catch { /* privater Modus oder gesperrter Speicher: dann eben nur bis zum Neustart */ }
}

/*
 * Anordnung der Übersicht: welche Module in welcher Reihenfolge und Breite.
 * Ebenfalls nur auf diesem Gerät – am Telefon passt eine andere Anordnung als
 * am großen Bildschirm. Ohne gespeicherte Anordnung gilt die Voreinstellung.
 */
const LAYOUT_KEY = 'kontovia.uebersicht';
/* Zusätzlich im Speicher – ohne nutzbaren localStorage gilt die Wahl dann wenigstens bis zum Neustart. */
let layout;

/** @returns {Array<{id:string,size:number,hidden:boolean}>|null} */
export function loadDashLayout() {
  if (layout !== undefined) return layout;
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(LAYOUT_KEY) || 'null');
    layout = Array.isArray(v) ? v : null;
  } catch {
    layout = null;
  }
  return layout;
}

/** Merkt sich die Anordnung; `null` kehrt zur Voreinstellung zurück. */
export function saveDashLayout(list) {
  layout = list ? list.map(({ id, size, hidden }) => ({ id, size, hidden: !!hidden })) : null;
  try {
    if (layout) globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify(layout));
    else globalThis.localStorage?.removeItem(LAYOUT_KEY);
  } catch { /* dann eben nur bis zum Neustart */ }
}

/** Nicht gelistete Buchungen einbeziehen? Gilt für Übersicht und Auswertungen gemeinsam. */
export const scope = { includeUnlisted: false };

/**
 * Kleiner Schalter „Nicht gelistete einbeziehen“ mit der Anzahl im Zeitraum.
 * Früher eine eigene Leiste über die ganze Breite; die Einzelheiten stehen
 * jetzt im Hinweistext. Ohne solche Buchungen im Zeitraum fehlt er – es sei
 * denn, er ist eingeschaltet; dann muss man ihn auch wieder lösen können.
 */
export function scopeToggleHtml(db, from, to) {
  const st = unlistedStats(db, from, to);
  if (!st.count && !scope.includeUnlisted) return raw('');
  const detail = st.count
    ? `${st.count === 1 ? '1 nicht gelistete Buchung' : `${int(st.count)} nicht gelistete Buchungen`} im Zeitraum`
      + ` (Einnahmen ${money(st.income)} €, Ausgaben ${money(st.expense)} €).`
    : 'Im Zeitraum gibt es keine nicht gelisteten Buchungen.';
  const wirkung = scope.includeUnlisted
    ? 'Die Zahlen enthalten sie jetzt – in Exporte für Finanzamt und Steuerkanzlei gehen sie trotzdem nie.'
    : 'Sie sind in den Zahlen nicht enthalten.';
  return raw(html`
    <label class="scope-toggle ${scope.includeUnlisted ? 'on' : ''}" title="${detail} ${wirkung}">
      <input type="checkbox" data-scope-unlisted ${scope.includeUnlisted ? 'checked' : ''}>
      <span>${scope.includeUnlisted ? 'Nicht gelistete einbezogen' : 'Nicht gelistete einbeziehen'}</span>
      <span class="badge unlisted">${int(st.count)}</span>
    </label>`);
}

/** Verdrahtet den Schalter; onChange zeichnet die Ansicht neu. */
export function wireScopeToggle(root, onChange) {
  root.querySelector('[data-scope-unlisted]')?.addEventListener('change', (e) => {
    scope.includeUnlisted = e.target.checked;
    onChange();
  });
}


/* -------------------------------------------------------------------------- */
/* Umschalter der Diagramme                                                    */
/* -------------------------------------------------------------------------- */

const VERLAUF = [['bars', 'Säulen', 'bars'], ['lines', 'Linien', 'line'], ['cumulative', 'Aufgelaufen', 'sum'], ['table', 'Tabelle', 'table']];
const ANTEIL = [['bars', 'Balken', 'bars'], ['pie', 'Torte', 'pie']];

/** Knöpfe für den Verlauf: Darstellungsart und Monatsdurchschnitt. */
export function verlaufControls() {
  const avgMoeglich = prefs.verlauf === 'bars' || prefs.verlauf === 'lines';
  return raw(`${segToggle('verlauf', VERLAUF, prefs.verlauf, 'Darstellung des Verlaufs').__raw}
    ${avgMoeglich ? `<label class="check small" title="Durchschnitt je Monat als gestrichelte Linie"><input type="checkbox" data-verlauf-avg ${prefs.verlaufAvg ? 'checked' : ''}> Ø</label>` : ''}`);
}

export function wireVerlauf(root, redraw) {
  wireSeg(root, 'verlauf', (v) => { setPref('verlauf', v); redraw(); });
  root.querySelector('[data-verlauf-avg]')?.addEventListener('change', (e) => { setPref('verlaufAvg', e.target.checked); redraw(); });
}

/** Der Verlauf in der gewählten Darstellung. */
export function verlaufBody(months, avg, labelFor) {
  if (prefs.verlauf === 'table') return raw(monthTableHtml(months, { labelFor, avg }));
  const showAvg = prefs.verlaufAvg && (prefs.verlauf === 'bars' || prefs.verlauf === 'lines') && avg?.months;
  return chart(prefs.verlauf, months, { labelFor, avg: showAvg ? avg : null });
}

/** Umschalter Balken/Torte für eine Anteilsdarstellung. */
export function anteilControls(key) {
  return segToggle(key, ANTEIL, prefs[key], 'Darstellung der Anteile');
}

export function wireAnteil(root, key, redraw) {
  wireSeg(root, key, (v) => { setPref(key, v); redraw(); });
}
