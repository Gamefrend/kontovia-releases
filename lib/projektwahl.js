/**
 * Kontovia – Projekt in Fenstern und Listen: Auswahlfeld „Projekt“ (Buchung, Rechnung, Angebot, Termin) und die
 * Marke mit dem Projektnamen in Buchungs-, Rechnungs- und Angebotsliste.
 *
 * Eine Fassung für alle Fenster, damit überall dieselben Projekte zur Wahl stehen: laufende und pausierte, ein
 * abgeschlossenes nur, wenn es schon gewählt ist. Ohne Projekte (oder ohne den Tarif für Projekte, solange nichts
 * gewählt ist) gibt es kein Feld. Gibt fertiges HTML zurück; den Wert liest das Fenster selbst über die Id.
 */

import { esc } from './util.js';
import { icon } from './ui.js';
import { sel } from './store.js';
import { kann } from './lizenz.js';

const FELD = 'projektId';

/**
 * @param {string} gewaehlt  Id des gewählten Projekts oder ''
 * @param {{praefix:string, hinweis?:string, attrs?:string}} opt  Id des Feldes ist `<praefix>projektId` (wie die übrigen Felder des
 *   Fensters); `attrs` hängt am select (etwa `data-f="projektId"`)
 * @returns {string}
 */
export function projektAuswahl(gewaehlt, { praefix, hinweis = '', attrs = '' }) {
  const id = `${praefix}${FELD}`;
  const liste = sel.projekte().filter((p) => p.status !== 'abgeschlossen' || p.id === gewaehlt);
  if (!liste.length || (!kann('projekte') && !gewaehlt)) return '';
  const optionen = liste.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'))
    .map((p) => `<option value="${esc(p.id)}"${p.id === gewaehlt ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<div class="field">
      <label for="${esc(id)}">Projekt</label>
      <select id="${esc(id)}" ${attrs}><option value="">Keinem Projekt zugeordnet</option>${optionen}</select>
      ${hinweis ? `<span class="hint">${esc(hinweis)}</span>` : ''}
    </div>`;
}

/** Marke mit dem Projektnamen für eine Zeile (Buchung, Rechnung, Angebot); ohne Projekt leer. */
export function projektMarke(x) {
  const p = x?.projektId ? sel.projekt(x.projektId) : null;
  return p ? `<span class="badge tiny pj-marke" title="${esc(`Gehört zum Projekt ${p.name}`)}">${icon('folder', 11).__raw} ${esc(p.name)}</span>` : '';
}
