/**
 * Kontovia – Jahresvergleich (Reiter in den Auswertungen).
 *
 * Ausgaben oder Einnahmen über mehrere Jahre nebeneinander: Summe je Jahr,
 * jede Kategorie mit ihrer Veränderung zum Jahr davor und der Verlauf über die
 * Monate. Gerechnet wird in calc.js (jahresvergleich, jahresMonate), hier steht
 * nur die Darstellung. Steht das laufende Jahr dabei, zählt jedes Jahr nur bis
 * zum selben Tag, sonst wäre der Vergleich unfair; per Schalter lassen sich
 * auch ganze Jahre vergleichen. PDF und Druck: lib/reports.js (vergleichPdf).
 */

import { html, raw, esc, $, $$, money, todayISO } from '../lib/util.js';
import { statCard, deltaBadge, emptyState, segToggle, wireSeg } from '../lib/ui.js';
import { trend, jahresvergleich, jahresMonate, effectiveDate, isEffective, PROFIT_BASIS } from '../lib/calc.js';
import { table, mountTables } from '../lib/table.js';

/* Was der Nutzer gewählt hat; fehlt etwas, wird es aus dem Bestand abgeleitet. */
const wahl = { art: 'expense', jahre: null, zeitraum: 'auto', kat: '', ansicht: 'monat' };
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Jahre, in denen es etwas zu vergleichen gibt (nach Zahlungstag), aufsteigend. */
function vergleichsJahre(db) {
  const jahre = new Set();
  for (const t of db.transactions) {
    const d = effectiveDate(t, PROFIT_BASIS);
    if (d && isEffective(t)) jahre.add(Number(d.slice(0, 4)));
  }
  for (const a of db.assets || []) if (a.purchaseDate) jahre.add(Number(a.purchaseDate.slice(0, 4)));
  return [...jahre].filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * Die aktuelle Wahl als fertige Angabe für Rechnung, Anzeige und PDF.
 * @returns {{art:string, jahre:number[], alle:number[], bis:string|null, laufend:boolean, kategorie:string, heute:string}}
 */
export function vergleichEinstellung(db) {
  const alle = vergleichsJahre(db);
  const heute = todayISO();
  let jahre = (wahl.jahre || []).filter((y) => alle.includes(y));
  if (!jahre.length) jahre = alle.slice(-3);
  jahre = [...jahre].sort((a, b) => a - b);
  // Steht das laufende Jahr dabei, ist ein Vergleich bis zum gleichen Tag fairer als gegen ganze Jahre.
  const laufend = jahre.includes(Number(heute.slice(0, 4))) && jahre.length > 1;
  const zeitraum = wahl.zeitraum === 'auto' ? (laufend ? 'stichtag' : 'ganz') : wahl.zeitraum;
  return { art: wahl.art, jahre, alle, bis: laufend && zeitraum === 'stichtag' ? heute.slice(5) : null, laufend, kategorie: wahl.kat, heute };
}

const tag = (bis) => `${bis.slice(3)}.${bis.slice(0, 2)}.`;

export function vergleich(root, db) {
  const v = vergleichEinstellung(db);
  const ausgaben = v.art === 'expense';
  const name = ausgaben ? 'Ausgaben' : 'Einnahmen';
  if (!v.alle.length) {
    root.innerHTML = html`<div class="card">${emptyState('Noch nichts zu vergleichen', 'Sobald es bezahlte Buchungen gibt, vergleicht Kontovia hier Ihre Jahre.')}</div>`;
    return;
  }
  const r = jahresvergleich(db, { jahre: v.jahre, art: v.art, bis: v.bis });
  const letzte = v.jahre.at(-1);
  // Mehr Ausgaben sind schlecht (rot), mehr Einnahmen gut (grün).
  const ton = (diff) => (diff === 0 ? '' : ((diff > 0) === ausgaben ? 'neg' : 'pos'));
  const vz = (cent) => `${cent > 0 ? '+' : cent < 0 ? '−' : ''} ${money(Math.abs(cent))}`;
  const stichtagText = v.bis ? `1.1. bis ${tag(v.bis)}` : 'ganze Jahre';

  const jahrKarten = v.jahre.map((y, i) => {
    const vor = i > 0 ? v.jahre[i - 1] : null;
    const fuss = vor === null ? `<span class="muted">${stichtagText}</span>`
      : `${deltaBadge(trend(r.summen[y], r.summen[vor]), { invert: ausgaben }).__raw} <span class="muted">zu ${vor}</span>`;
    return statCard({ label: String(y), value: `${esc(money(r.summen[y]))} €`, tone: ausgaben ? 'neg' : 'pos', foot: fuss }).__raw;
  }).join('');

  const spalten = [
    { key: 'name', label: 'Kategorie', type: 'text', cell: (c) => esc(c.name) },
    ...v.jahre.map((y) => ({
      key: `y${y}`, label: String(y), type: 'num', value: (c) => c.werte[y],
      cell: (c) => (c.werte[y] ? esc(money(c.werte[y])) : '<span class="muted">–</span>'),
    })),
    {
      key: 'diff', label: 'Veränderung', sortLabel: `Veränderung ${letzte} zum Jahr davor`, type: 'num',
      value: (c) => c.diff ?? 0, cell: (c) => (c.diff === null ? '–' : `<span class="amount ${ton(c.diff)}">${esc(vz(c.diff))}</span>`),
    },
    {
      key: 'trend', label: '%', sortLabel: 'Veränderung in Prozent', type: 'num', tdCls: 'muted',
      value: (c) => c.trend ?? 0, cell: (c) => (c.trend === null ? '–' : deltaBadge(c.trend, { invert: ausgaben }).__raw),
    },
  ];
  const summenFuss = `<tr><td>Summe</td>${v.jahre.map((y) => `<td class="num">${esc(money(r.summen[y]))}</td>`).join('')}
    <td class="num">${r.veraenderung ? `<span class="amount ${ton(r.veraenderung.diff)}">${esc(vz(r.veraenderung.diff))}</span>` : ''}</td>
    <td class="num">${r.veraenderung ? deltaBadge(r.veraenderung.trend, { invert: ausgaben }).__raw : ''}</td></tr>`;

  // Verlauf über das Jahr: ein Balken je Jahr und Monat, das jüngste Jahr am kräftigsten.
  const monate = jahresMonate(db, { jahre: v.jahre, art: v.art, categoryId: v.kategorie, bis: v.bis });
  const reihen = v.jahre.map((y) => {
    let lauf = 0;
    return monate[y].map((w) => (wahl.ansicht === 'summe' ? (lauf += w) : w));
  });
  const hoechst = Math.max(1, ...reihen.flat());
  const deckkraft = (i) => (v.jahre.length === 1 ? 1 : 0.28 + 0.72 * (i / (v.jahre.length - 1)));
  const balken = MONATE.map((m, mi) => `
    <div class="vgl-monat">
      <div class="vgl-saeulen">${v.jahre.map((y, i) => {
    const w = reihen[i][mi];
    const h = Math.max(w > 0 ? 2 : 0, (w / hoechst) * 100);
    return `<span class="vgl-saeule" style="height:${h.toFixed(1)}%;opacity:${deckkraft(i).toFixed(2)}" title="${esc(`${m} ${y}: ${money(w)} €`)}"></span>`;
  }).join('')}</div>
      <div class="vgl-label">${m}</div>
    </div>`).join('');
  // Buchungen ohne Kategorie (keine Kennung) lassen sich nicht einzeln herausgreifen.
  const katOptionen = [['', `Alle ${name}`], ...r.kategorien.filter((k) => k.id).map((k) => [k.id, k.name])]
    .map(([id, t]) => `<option value="${esc(id)}" ${id === v.kategorie ? 'selected' : ''}>${esc(t)}</option>`).join('');

  root.innerHTML = html`
    <div class="card mb16">
      <div class="card-body">
        <div class="row wrap" style="gap:12px 24px;align-items:center">
          ${segToggle('vglArt', [['expense', 'Ausgaben'], ['income', 'Einnahmen']], v.art, 'Was verglichen wird')}
          <div class="row wrap" style="gap:6px 14px" role="group" aria-label="Jahre">
            ${raw(v.alle.map((y) => `<label class="check"><input type="checkbox" data-vgl-jahr="${y}" ${v.jahre.includes(y) ? 'checked' : ''}> <span>${y}</span></label>`).join(''))}
          </div>
          <div class="spacer"></div>
          ${v.laufend ? segToggle('vglZeit', [['stichtag', `Bis ${tag(v.heute.slice(5))}`], ['ganz', 'Ganze Jahre']], v.bis ? 'stichtag' : 'ganz', 'Zeitraum der Jahre') : ''}
        </div>
        ${v.jahre.length < 2 ? raw('<p class="small muted mb0 mt8">Wählen Sie mindestens zwei Jahre, um sie zu vergleichen.</p>') : ''}
        ${v.bis ? raw(`<p class="small muted mb0 mt8">Das laufende Jahr ist noch nicht zu Ende. Deshalb zählt jedes Jahr nur bis zum ${tag(v.bis)}, damit die Zahlen vergleichbar bleiben.</p>`) : ''}
      </div>
    </div>

    <div class="grid c4 mb16">${raw(jahrKarten)}</div>

    <div class="card mb16">
      <div class="card-head"><h2>${name} nach Kategorie</h2><span class="sub">${stichtagText}</span></div>
      <div class="card-body">
        ${table({
    id: 'vergleich-kat', cls: 'data', toolbar: false, defaultSort: { key: `y${letzte}`, dir: -1 }, rows: r.kategorien, columns: spalten,
    emptyTitle: `Keine ${name} in diesen Jahren`, foot: () => summenFuss,
  })}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Verlauf über das Jahr</h2><div class="spacer"></div>
        <select id="vglKat" aria-label="Kategorie für den Verlauf">${raw(katOptionen)}</select>
        ${segToggle('vglAnsicht', [['monat', 'Je Monat'], ['summe', 'Aufgelaufen']], wahl.ansicht, 'Darstellung')}
      </div>
      <div class="card-body">
        <div class="vgl-chart" role="img" aria-label="${name} je Monat, ${v.jahre.join(', ')}">${raw(balken)}</div>
        <div class="vgl-legende">${raw(v.jahre.map((y, i) => `<span><i style="opacity:${deckkraft(i).toFixed(2)}"></i>${y}</span>`).join(''))}</div>
      </div>
    </div>`;

  mountTables(root);
  const neu = () => vergleich(root, db);
  wireSeg(root, 'vglArt', (a) => { wahl.art = a; wahl.kat = ''; neu(); });
  wireSeg(root, 'vglZeit', (z) => { wahl.zeitraum = z; neu(); });
  wireSeg(root, 'vglAnsicht', (a) => { wahl.ansicht = a; neu(); });
  $('#vglKat', root).addEventListener('change', (e) => { wahl.kat = e.target.value; neu(); });
  $$('[data-vgl-jahr]', root).forEach((c) => c.addEventListener('change', () => {
    const gewaehlt = $$('[data-vgl-jahr]', root).filter((x) => x.checked).map((x) => Number(x.dataset.vglJahr));
    // Ohne Haken gälte wieder die Voreinstellung; lieber bleibt die bisherige Wahl.
    wahl.jahre = gewaehlt.length ? gewaehlt : v.jahre;
    neu();
  }));
}
