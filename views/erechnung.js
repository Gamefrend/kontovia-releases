/**
 * Kontovia – eine E-Rechnung lesbar anzeigen.
 *
 * Die Werte kommen aus lib/erechnung.js. Angezeigt wird, was in der Datei
 * steht; gerechnet wird hier nichts. Die Originaldatei bleibt unverändert im
 * Tresor und ist, was aufbewahrt wird (GoBD Rz. 118 ff.).
 */

import { html, raw, esc, money, fmtDate } from '../lib/util.js';
import { modal } from '../lib/ui.js';

const betrag = (c, waehrung = 'EUR') => (c === null || c === undefined ? '–' : `${money(c)} ${waehrung === 'EUR' ? '€' : waehrung}`);
const satzText = (s) => `${String(s).replace('.', ',')} %`;

function partei(titel, p) {
  return `<div class="erech-partei">
    <div class="tiny muted">${esc(titel)}</div>
    <strong>${esc(p?.name || '–')}</strong>
    ${p?.anschrift ? `<div class="small">${esc(p.anschrift)}</div>` : ''}
    ${p?.ustId ? `<div class="small muted">USt-IdNr. ${esc(p.ustId)}</div>` : ''}
    ${p?.steuernummer ? `<div class="small muted">Steuernummer ${esc(p.steuernummer)}</div>` : ''}
    ${p?.email ? `<div class="small muted">${esc(p.email)}</div>` : ''}
  </div>`;
}

/** Die Rechnung als HTML (für Fenster und Druck). */
export function eRechnungHtml(r) {
  const w = r.waehrung;
  const zeilen = r.positionen.length ? r.positionen.map((p) => `<tr>
      <td class="muted">${esc(p.nr)}</td>
      <td>${esc(p.name || '–')}</td>
      <td class="num">${p.menge ? esc(String(p.menge).replace('.', ',')) : ''} ${esc(p.einheit)}</td>
      <td class="num">${p.einzelpreis === null ? '' : esc(money(p.einzelpreis))}</td>
      <td class="num">${esc(satzText(p.satz))}</td>
      <td class="num">${esc(money(p.netto ?? 0))}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">Keine Positionen angegeben.</td></tr>';
  return html`
    <div class="erech">
      <div class="row between wrap mb8" style="gap:8px">
        <div>
          <div class="erech-titel">${r.gutschrift ? 'Gutschrift' : 'Rechnung'} ${r.nummer || ''}</div>
          <div class="small muted">vom ${fmtDate(r.datum)}${r.faellig ? ` · fällig am ${fmtDate(r.faellig)}` : ''}</div>
        </div>
        <span class="badge info">${r.format}</span>
      </div>
      <div class="grid c2 mb16">
        ${raw(partei('Von (Verkäufer)', r.verkaeufer))}
        ${raw(partei('An (Käufer)', r.kaeufer))}
      </div>
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th>Pos.</th><th>Leistung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">USt</th><th class="num">Netto</th></tr></thead>
        <tbody>${raw(zeilen)}</tbody>
      </table></div>
      <div class="erech-summen">
        <table class="data compact"><tbody>
          <tr><td>Summe netto</td><td class="num">${betrag(r.netto, w)}</td></tr>
          ${raw(r.steuersaetze.map((s) => `<tr><td class="muted">Umsatzsteuer ${esc(satzText(s.satz))} auf ${esc(betrag(s.basis, w))}${s.kategorie && s.kategorie !== 'S' ? ` (Kategorie ${esc(s.kategorie)})` : ''}</td><td class="num">${esc(betrag(s.steuer, w))}</td></tr>`).join(''))}
          <tr class="strong"><td>Gesamt</td><td class="num">${betrag(r.brutto, w)}</td></tr>
          ${r.zahlbetrag !== null && r.zahlbetrag !== r.brutto ? raw(`<tr><td>Zu zahlen</td><td class="num">${esc(betrag(r.zahlbetrag, w))}</td></tr>`) : ''}
        </tbody></table>
      </div>
      ${r.iban || r.verwendungszweck || r.zahlungsbedingungen ? raw(`<div class="notice mt16 small">
        ${r.iban ? `<div>IBAN <strong style="font-family:var(--mono)">${esc(r.iban)}</strong></div>` : ''}
        ${r.verwendungszweck ? `<div>Verwendungszweck: ${esc(r.verwendungszweck)}</div>` : ''}
        ${r.zahlungsbedingungen ? `<div class="muted">${esc(r.zahlungsbedingungen)}</div>` : ''}
      </div>`) : ''}
      ${r.leitwegId ? raw(`<p class="tiny muted mt8 mb0">Käuferreferenz (Leitweg-ID): ${esc(r.leitwegId)}</p>`) : ''}
      ${r.hinweise.length ? raw(`<div class="small mt8">${r.hinweise.map((h) => `<p class="mt0 mb8" style="white-space:pre-wrap">${esc(h)}</p>`).join('')}</div>`) : ''}
    </div>`;
}

/**
 * Fenster mit der lesbaren Rechnung.
 * @param {object} r  Ergebnis von eRechnungLesen()
 * @param {{titel?:string, extraFoot?:string, onUebernehmen?:Function}} opts
 */
export function zeigeERechnung(r, { titel = '', onUebernehmen = null } = {}) {
  const m = modal({
    title: titel || `${r.gutschrift ? 'Gutschrift' : 'Rechnung'} ${r.nummer || ''}, ${r.verkaeufer?.name || 'E-Rechnung'}`,
    size: 'wide',
    body: `${eRechnungHtml(r)}
      <p class="tiny muted mt16 mb0">Lesbare Darstellung der strukturierten Rechnungsdaten (${esc(r.syntax)}).
      Aufbewahrt wird die Originaldatei, unverändert und mit Prüfsumme.</p>`,
    foot: `${onUebernehmen ? '<button class="btn" data-take>In die Buchung übernehmen</button>' : ''}
      <button class="btn primary" data-x>Schließen</button>`,
  });
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-take]')?.addEventListener('click', () => { m.close(); onUebernehmen(); });
  return m;
}
