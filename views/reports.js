/** Kontovia – Auswertungen: GuV, EÜR, Umsatzsteuer, Vermögen, offene Posten. */

import {
  html, raw, esc, $, $$, money, fmtDate, fmtDateLong, todayISO, int, sum, ymLabel, pct,
} from '../lib/util.js';
import { icon, statCard, deltaBadge, compareLabel, rankBars, emptyState, ok, err, modal, chart, mountCharts, segToggle, wireSeg } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import {
  compareRanges, trend, euerReport, vatReturn, vatPeriods, balanceSheet,
  openItems, accountBalances, isKleinunternehmer, basisOf, depreciationInRange, bookValue,
  totalDepreciation, healthChecks, scopeDb, unlistedStats, averages,
} from '../lib/calc.js';
import {
  prefs, setPref, scope, scopeToggleHtml, wireScopeToggle, verlaufControls, wireVerlauf, verlaufBody,
  anteilControls, wireAnteil,
} from '../lib/prefs.js';
import { defaultPeriod, periodControl, periodLabel, setPeriod } from '../lib/period.js';
import * as R from '../lib/reports.js';
import { table, mountTables } from '../lib/table.js';
import { openTransactionDialog } from './transactions.js';

const api = window.kontovia;
const period = defaultPeriod();
let tab = 'guv';
/** Die Zeitraumwahl oben rechts – der Umsatzsteuer-Reiter setzt den Zeitraum auch von sich aus. */
let periodCtl = null;

const TABS = {
  guv: 'Gewinn & Verlust',
  euer: 'Anlage EÜR',
  ust: 'Umsatzsteuer',
  bilanz: 'Vermögen',
  opos: 'Offene Posten',
  konten: 'Konten',
  anlagen: 'Anlagevermögen',
};

export async function render(root, params, { actions } = {}) {
  if (params?.tab) tab = params.tab;
  actions.innerHTML = html`
    <div id="rpPeriod"></div>
    <button class="btn" id="btnPreview">${icon('eye', 16)} Vorschau</button>
    <button class="btn primary" id="btnPdf">${icon('pdf', 16)} Als PDF</button>`;
  periodCtl = periodControl($('#rpPeriod', actions), period, () => draw(root));
  actions.querySelector('#btnPdf').addEventListener('click', () => exportPdf(false));
  actions.querySelector('#btnPreview').addEventListener('click', () => exportPdf(true));
  draw(root);
}

function draw(root) {
  // Nicht gelistete Buchungen zählen nur mit, wenn das Häkchen gesetzt ist –
  // für alle Reiter gemeinsam und ebenso im PDF dieser Ansicht.
  const db = scopeDb(store.db, scope.includeUnlisted);
  // Der Umsatzsteuer-Reiter ist für Kleinunternehmer ausgeblendet – war er
  // vor einem Wechsel der Einstellung aktiv, fällt die Ansicht auf die GuV zurück.
  if (tab === 'ust' && isKleinunternehmer(db)) tab = 'guv';
  root.innerHTML = html`
    <div class="row wrap mb16" style="gap:10px 16px">
      <div class="seg tabs" id="tabs" role="group" aria-label="Auswertung">
        ${raw(Object.entries(TABS)
          .filter(([k]) => !(k === 'ust' && isKleinunternehmer(db)))
          .map(([k, v]) => `<button aria-pressed="${tab === k}" data-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(v)}</button>`).join(''))}
      </div>
      <div class="spacer"></div>
      ${scopeToggleHtml(store.db, period.from, period.to)}
    </div>
    <div id="tabBody"></div>`;

  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    draw(root);
    $(`[data-tab="${tab}"]`, root)?.focus();
  }));
  wireScopeToggle(root, () => draw(root));

  const body = $('#tabBody', root);
  ({ guv, euer, ust, bilanz, opos, konten, anlagen }[tab] || guv)(body, db);
  mountCharts(body);
  mountTables(body);
}

/**
 * Hinweis auf EÜR und Umsatzsteuer, solange nicht gelistete Buchungen
 * mitgezählt werden: Diese Zahlen sind dann nicht die fürs Finanzamt.
 */
function scopeWarning() {
  if (!scope.includeUnlisted) return '';
  const st = unlistedStats(store.db, period.from, period.to);
  if (!st.count) return '';
  return `<div class="notice warn mb16"><strong>Enthält ${st.count === 1 ? 'eine nicht gelistete Buchung' : `${int(st.count)} nicht gelistete Buchungen`}.</strong>
    Für ELSTER gelten die Werte ohne sie – entfernen Sie dafür oben das Häkchen, oder nehmen Sie die
    Unterlagen unter „Export &amp; Finanzamt“, die nicht gelistete Buchungen nie enthalten.</div>`;
}

/* -------------------------------------------------------------------------- */
/* Gewinn und Verlust                                                          */
/* -------------------------------------------------------------------------- */

function guv(root, db) {
  const klein = isKleinunternehmer(db);
  const cmp = compareRanges(db, period.from, period.to);
  const { current, previous } = cmp;
  // Im laufenden Zeitraum bis zum gleichen Stand wie der Vorzeitraum.
  const delta = (key) => `${deltaBadge(trend(cmp.currentToDate[key], previous[key]), { invert: key === 'expenseForProfit' }).__raw} ${compareLabel(cmp)}`;
  const checks = healthChecks(db, period.from, period.to);
  const avg = averages(current);
  const perMonth = (v) => (avg.months ? Math.round(v / avg.months) : 0);
  const anteilPct = (v, total) => (total ? (Math.abs(v) / total * 100).toFixed(1).replace('.', ',') : '0,0');
  const avgFoot = (v) => (avg.months > 1 ? `<span class="avg-foot">Ø ${esc(money(v))} € je Monat</span>` : '');

  const incomeCats = current.byCategory.filter((c) => c.kind === 'income');
  const expenseCats = current.byCategory.filter((c) => c.kind === 'expense');

  /* Kategorien je Seite, sortierbar nach jeder Spalte. Ein Klick auf eine Zeile
     zeigt die Buchungen dahinter; die Abschreibung hat keine eigenen Buchungen. */
  const catTable = (kind, rows, total, count, vatSum, avgSum) => table({
    id: `guv-${kind}`,
    cls: 'data',
    toolbar: false,
    defaultSort: { key: 'amount', dir: -1 },
    rows,
    columns: [
      { key: 'name', label: 'Kategorie', type: 'text', cell: (c) => esc(c.name) },
      { key: 'count', label: 'Anz.', sortLabel: 'Anzahl', type: 'num', tdCls: 'muted', cell: (c) => (c.count === null ? '–' : int(c.count)) },
      ...(klein ? [] : [{
        key: 'vat', label: kind === 'income' ? 'USt' : 'Vorst.', sortLabel: kind === 'income' ? 'Umsatzsteuer' : 'Vorsteuer', type: 'num', tdCls: 'muted',
        cell: (c) => (c.vat === null ? '–' : esc(money(c.vat))),
      }]),
      { key: 'amount', label: klein ? 'Betrag' : 'Netto', type: 'num', cell: (c) => esc(money(c.amount)) },
      {
        key: 'avg', label: 'Ø/Monat', sortLabel: 'Durchschnitt je Monat', type: 'num', tdCls: 'muted',
        value: (c) => perMonth(c.amount), cell: (c) => esc(money(perMonth(c.amount))),
      },
      {
        key: 'share', label: 'Anteil', type: 'num', tdCls: 'muted',
        value: (c) => (total ? Math.abs(c.amount) / total : 0), cell: (c) => `${anteilPct(c.amount, total || 1)} %`,
      },
    ],
    onRowClick: (c) => openCategory(db, c.categoryId),
    rowClickable: (c) => !!c.categoryId,
    emptyTitle: kind === 'income' ? 'Keine Einnahmen' : 'Keine Ausgaben',
    foot: () => `<tr><td>Summe</td><td class="num">${int(count)}</td>${klein ? '' : `<td class="num">${esc(money(vatSum))}</td>`}<td class="num">${esc(money(total))}</td><td class="num">${esc(money(avgSum))}</td><td></td></tr>`,
  });
  const afa = current.depreciation
    ? [{ categoryId: '', name: 'Abschreibungen (AfA)', count: null, vat: null, amount: current.depreciation }]
    : [];

  // Aufteilung: Ausgaben einschließlich Abschreibung, damit die Summe zur Tabelle passt.
  const artAusgaben = prefs.anteilGuvArt !== 'income';
  const anteilRows = artAusgaben
    ? [...expenseCats.map((c) => ({ name: c.name, amount: c.amount })), ...(current.depreciation ? [{ name: 'Abschreibungen (AfA)', amount: current.depreciation }] : [])]
    : incomeCats.map((c) => ({ name: c.name, amount: c.amount }));
  const anteilTotal = artAusgaben ? current.expenseForProfit : current.incomeForProfit;
  const anteilBody = prefs.anteilGuv === 'pie'
    ? chart('pie', anteilRows, { centerLabel: artAusgaben ? 'Ausgaben' : 'Einnahmen', label: 'Aufteilung nach Kategorie' })
    : rankBars([...anteilRows].sort((a, b) => b.amount - a.amount).slice(0, 10), { color: artAusgaben ? 'var(--neg)' : 'var(--pos)', total: anteilTotal });

  const kpi = (k, v, s = '') => `<div><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const monat = (m) => (m ? `${esc(ymLabel(m.ym))}: ${esc(money(m.profit))} €` : '–');

  root.innerHTML = html`
    <div class="grid c4 mb16">
      ${statCard({ label: 'Betriebseinnahmen', value: `${esc(money(current.incomeForProfit))} €`, tone: 'pos', foot: `${delta('incomeForProfit')}${avgFoot(avg.income)}` })}
      ${statCard({ label: 'Betriebsausgaben', value: `${esc(money(current.expenseForProfit))} €`, tone: 'neg', foot: `${delta('expenseForProfit')}${avgFoot(avg.expense)}` })}
      ${statCard({ label: current.profit >= 0 ? 'Gewinn' : 'Verlust', value: `${esc(money(current.profit))} €`, tone: current.profit >= 0 ? 'pos' : 'neg', foot: `${delta('profit')}${avgFoot(avg.profit)}` })}
      ${statCard({ label: 'Abschreibungen im Zeitraum', value: `${esc(money(current.depreciation))} €`, foot: `<span>${int((db.assets || []).length)} Wirtschaftsgüter</span>` })}
    </div>

    <div class="card mb16">
      <div class="card-head"><h3>Verlauf</h3><span class="sub">${esc(periodLabel(period))}</span><div class="spacer"></div>${verlaufControls()}</div>
      <div class="card-body">${verlaufBody(current.months, avg, (s) => ymLabel(s.ym))}</div>
    </div>

    <div class="grid c2 mb16">
      <div class="card">
        <div class="card-head">
          <h3>Aufteilung nach Kategorie</h3>
          <div class="spacer"></div>
          ${segToggle('anteilGuvArt', [['expense', 'Ausgaben'], ['income', 'Einnahmen']], artAusgaben ? 'expense' : 'income', 'Welche Seite')}
          ${anteilControls('anteilGuv')}
        </div>
        <div class="card-body">${anteilBody}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Durchschnittswerte</h3><span class="sub">${avg.months ? `über ${avg.months} ${avg.months === 1 ? 'Monat' : 'Monate'}` : 'Zeitraum hat noch nicht begonnen'}</span></div>
        <div class="card-body">
          <div class="kpi-list">
            ${raw(kpi('Einnahmen je Monat', `<span class="amount pos">${esc(money(avg.income))} €</span>`))}
            ${raw(kpi('Ausgaben je Monat', `<span class="amount neg">${esc(money(avg.expense))} €</span>`))}
            ${raw(kpi('Ergebnis je Monat', `<span class="amount ${avg.profit >= 0 ? 'pos' : 'neg'}">${esc(money(avg.profit))} €</span>`))}
            ${raw(kpi('Einnahme je Buchung', avg.perIncome === null ? '–' : `${esc(money(avg.perIncome))} €`, `${int(current.countIncome)} Einnahmen`))}
            ${raw(kpi('Ausgabe je Buchung', avg.perExpense === null ? '–' : `${esc(money(avg.perExpense))} €`, `${int(current.countExpense)} Ausgaben, ohne Abschreibung`))}
            ${raw(kpi('Bester / schwächster Monat', avg.best ? `<span class="small">${monat(avg.best)}</span>` : '–', avg.worst ? monat(avg.worst) : ''))}
          </div>
          <p class="tiny muted mt16 mb0">Gemittelt wird über die Monate des Zeitraums, die schon begonnen haben –
          im laufenden Jahr also nicht über zwölf. Die Tabelle beim Verlauf (Knopf „Tabelle“) zeigt jeden Monat einzeln.</p>
        </div>
      </div>
    </div>

    <div class="grid c2">
      <div class="card">
        <div class="card-head"><h3>Betriebseinnahmen</h3><div class="spacer"></div><span class="badge pos">${esc(money(current.incomeForProfit))} €</span></div>
        ${catTable('income', incomeCats, current.incomeForProfit, current.countIncome, current.incomeVat, avg.income)}
      </div>

      <div class="card">
        <div class="card-head"><h3>Betriebsausgaben</h3><div class="spacer"></div><span class="badge neg">${esc(money(current.expenseForProfit))} €</span></div>
        ${catTable('expense', [...expenseCats, ...afa], current.expenseForProfit, current.countExpense, current.expenseVat, avg.expense)}
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>Ergebnisrechnung</h3></div>
      <div class="card-body">
        <table class="data">
          <tbody>
            <tr><td>Betriebseinnahmen</td><td class="num">${money(current.incomeForProfit)} €</td></tr>
            <tr><td>abzüglich Betriebsausgaben</td><td class="num">− ${money(current.expenseForProfit)} €</td></tr>
            <tr style="border-top:2px solid var(--border-strong)"><td><strong>${current.profit >= 0 ? 'Gewinn' : 'Verlust'}</strong></td><td class="num"><strong class="amount ${current.profit >= 0 ? 'pos' : 'neg'}">${money(current.profit)} €</strong></td></tr>
            ${current.expenseDeductible !== current.expenseForProfit ? raw(`
              <tr><td class="muted">davon steuerlich abziehbar (nach Kürzung, z. B. Bewirtung 70 %)</td><td class="num muted">${esc(money(current.expenseDeductible))} €</td></tr>
              <tr><td><strong>Steuerliches Ergebnis</strong></td><td class="num"><strong>${esc(money(current.taxableProfit))} €</strong></td></tr>`) : ''}
            ${current.privateIn || current.privateOut ? raw(`
              <tr><td colspan="2" class="muted small" style="padding-top:14px">Nachrichtlich – wirkt sich nicht auf den Gewinn aus:</td></tr>
              <tr><td class="muted">Privateinlagen</td><td class="num muted">${esc(money(current.privateIn))} €</td></tr>
              <tr><td class="muted">Privatentnahmen</td><td class="num muted">${esc(money(current.privateOut))} €</td></tr>`) : ''}
            ${current.vatRemitted || current.vatRefunded ? raw(`
              <tr><td colspan="2" class="muted small" style="padding-top:14px">Umsatzsteuer-Verrechnung mit dem Finanzamt – kein Aufwand, sondern Ausgleich des Steuerkontos:</td></tr>
              <tr><td class="muted">im Zeitraum an das Finanzamt gezahlt</td><td class="num muted">${esc(money(current.vatRemitted))} €</td></tr>
              ${current.vatRefunded ? `<tr><td class="muted">vom Finanzamt erstattet</td><td class="num muted">${esc(money(current.vatRefunded))} €</td></tr>` : ''}
              <tr><td class="muted">danach noch offene Zahllast des Zeitraums</td><td class="num muted">${esc(money(current.vatOutstanding))} €</td></tr>`) : ''}
          </tbody>
        </table>
        ${current.margin !== null ? raw(`<p class="small muted mt16 mb0">Von jedem eingenommenen Euro bleiben ${esc((current.margin * 100).toFixed(1).replace('.', ','))} Cent als Gewinn übrig.</p>`) : ''}
      </div>
    </div>

    ${checks.length ? raw(`<div class="card mt16"><div class="card-head"><h3>Hinweise zur Datenqualität</h3></div><div class="card-body">
      ${checks.map((c) => `<div class="notice ${c.level === 'error' ? 'danger' : c.level === 'warn' ? 'warn' : ''} mb8">${esc(c.text)}</div>`).join('')}
    </div></div>`) : ''}`;

  // Umschalten ändert nur die Darstellung – neu gezeichnet wird nur dieser Reiter.
  const redraw = () => { guv(root, db); mountCharts(root); mountTables(root); };
  wireVerlauf(root, redraw);
  wireAnteil(root, 'anteilGuv', redraw);
  wireSeg(root, 'anteilGuvArt', (v) => { setPref('anteilGuvArt', v); redraw(); });
}

/**
 * Die Buchungen hinter einer Kategorie – sortierbar, nach Kontakt filterbar,
 * und jede Zeile öffnet die Buchung selbst.
 */
function openCategory(db, categoryId) {
  const basis = basisOf(db);
  const rows = db.transactions.filter((t) => {
    if (t.voided || t.categoryId !== categoryId) return false;
    const d = basis === 'soll' ? t.date : t.paidDate;
    return d && d >= period.from && d <= period.to;
  });
  const viele = rows.length > 12;
  const m = modal({
    title: `Buchungen: ${sel.categoryName(categoryId)}`,
    size: 'wide',
    body: html`
      <p class="mt0 muted small">${periodLabel(period)} · Ein Klick auf eine Zeile öffnet die Buchung.</p>
      ${table({
        id: 'kategorie-buchungen',
        cls: 'data compact',
        toolbar: viele,
        search: viele ? { placeholder: 'In diesen Buchungen suchen …', text: (t) => [t.description, t.invoiceNumber, sel.contactName(t.contactId)].join(' ') } : null,
        defaultSort: { key: 'date', dir: 1 },
        rows,
        unit: ['Buchung', 'Buchungen'],
        columns: [
          { key: 'date', label: 'Datum', type: 'date', tdCls: 'nowrap', cell: (t) => esc(fmtDate(t.date)) },
          { key: 'description', label: 'Beschreibung', type: 'text', cell: (t) => esc(t.description) },
          {
            key: 'contact', label: 'Kontakt', type: 'text', tdCls: 'small muted',
            value: (t) => (t.contactId ? sel.contactName(t.contactId) : ''), cell: (t) => esc(sel.contactName(t.contactId)),
          },
          { key: 'net', label: 'Netto', type: 'num', cell: (t) => esc(money(t.net)) },
          { key: 'gross', label: 'Brutto', type: 'num', cell: (t) => esc(money(t.gross)) },
        ],
        filters: contactFilter(rows, 'contact'),
        onRowClick: (t) => openTransactionDialog(t.id),
        emptyTitle: 'Keine Buchungen',
        foot: (sichtbar) => `<tr><td colspan="3">Summe (${int(sichtbar.length)})</td><td class="num">${esc(money(sum(sichtbar, (t) => t.net)))}</td><td class="num">${esc(money(sum(sichtbar, (t) => t.gross)))}</td></tr>`,
      })}`,
    foot: '<button class="btn primary" data-x>Schließen</button>',
  });
  mountTables(m.root);
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
}

/** Filter „Kontakt“ für Buchungslisten; nur Kontakte, die in den Zeilen vorkommen. */
function contactFilter(rows, column) {
  const ids = [...new Set(rows.map((t) => t.contactId).filter(Boolean))];
  if (ids.length < 2) return [];
  return [{
    key: 'contactId', column, title: 'Kontakt', initial: '', search: ids.length > 8,
    options: () => [['', 'Alle Kontakte', () => true],
      ...ids.map((id) => [id, sel.contactName(id), (t) => t.contactId === id]).sort((a, b) => a[1].localeCompare(b[1], 'de'))],
  }];
}

/* -------------------------------------------------------------------------- */
/* Anlage EÜR                                                                  */
/* -------------------------------------------------------------------------- */

function euer(root, db) {
  const e = euerReport(db, period.from, period.to);
  const line = (r) => `<tr><td class="num strong" style="width:70px">${r.line}</td><td>${esc(r.label)}</td><td class="num">${esc(money(r.amount))} €</td></tr>`;

  root.innerHTML = html`
    ${raw(scopeWarning())}
    <div class="notice mb16">
      <strong>Was Sie hier sehen.</strong> Ihre Buchungen, zusammengefasst nach den Zeilen der
      amtlichen Anlage EÜR. Sie können die Beträge direkt in „Mein ELSTER“ übertragen.
      Die Zeilennummern des Formulars ändern sich gelegentlich – bitte einmal gegen
      das Formular des jeweiligen Jahres prüfen. Die Zuordnung jeder Kategorie
      lässt sich unter Stammdaten anpassen.
    </div>

    <div class="grid c2">
      <div class="card">
        <div class="card-head"><h3>Betriebseinnahmen</h3></div>
        <div class="table-wrap"><table class="data">
          <tbody>${raw(e.income.map(line).join('') || '<tr><td colspan="3" class="muted center">Keine Einnahmen</td></tr>')}</tbody>
          <tfoot><tr><td class="num">22</td><td>Summe Betriebseinnahmen</td><td class="num">${money(e.incomeTotal)} €</td></tr></tfoot>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Betriebsausgaben</h3></div>
        <div class="table-wrap"><table class="data">
          <tbody>${raw(e.expense.map(line).join('') || '<tr><td colspan="3" class="muted center">Keine Ausgaben</td></tr>')}</tbody>
          <tfoot><tr><td class="num">71</td><td>Summe Betriebsausgaben</td><td class="num">${money(e.expenseTotal)} €</td></tr></tfoot>
        </table></div>
      </div>
    </div>

    ${!e.kleinunternehmer && e.reconciliation.vatFlow ? raw(`
    <div class="card mt16">
      <div class="card-head"><h3>Warum weicht das vom Gewinn in der GuV ab?</h3></div>
      <div class="card-body">
        <p class="small muted mt0">In der Einnahmen-Überschuss-Rechnung läuft die Umsatzsteuer als
        Betriebseinnahme und Betriebsausgabe mit. Die vereinnahmte Umsatzsteuer erhöht den EÜR-Gewinn
        so lange, bis Sie sie an das Finanzamt überweisen und diese Zahlung als Ausgabe erfassen.
        Über das ganze Jahr gleicht sich das aus – die Umsatzsteuer kostet Sie keinen Cent Gewinn.</p>
        <table class="data">
          <tbody>
            <tr><td>Ergebnis ohne Umsatzsteuer (wie in der Gewinn- und Verlustrechnung)</td><td class="num">${esc(money(e.reconciliation.netResult))} €</td></tr>
            <tr><td class="muted">+ vereinnahmte Umsatzsteuer (Zeile 16)</td><td class="num muted">${esc(money(e.reconciliation.vatCollected))} €</td></tr>
            ${e.reconciliation.vatRefunded ? `<tr><td class="muted">+ Erstattung vom Finanzamt (Zeile 17)</td><td class="num muted">${esc(money(e.reconciliation.vatRefunded))} €</td></tr>` : ''}
            <tr><td class="muted">− gezahlte Vorsteuer (Zeile 55)</td><td class="num muted">− ${esc(money(e.reconciliation.vatDeducted))} €</td></tr>
            <tr><td class="muted">− an das Finanzamt gezahlte Umsatzsteuer (Zeile 56)</td><td class="num muted">− ${esc(money(e.reconciliation.vatRemitted))} €</td></tr>
            <tr style="border-top:2px solid var(--border-strong)"><td><strong>Gewinn laut Anlage EÜR (Zeile 72)</strong></td><td class="num"><strong>${esc(money(e.profit))} €</strong></td></tr>
          </tbody>
        </table>
        ${!e.reconciliation.vatRemitted ? `<div class="notice warn mt16">Sie haben im Zeitraum noch keine
        Umsatzsteuer-Vorauszahlung als Ausgabe erfasst. Sobald Sie an das Finanzamt überweisen, buchen Sie
        das mit der Kategorie „An Finanzamt gezahlte Umsatzsteuer“ – dann stimmt der EÜR-Gewinn.</div>` : ''}
      </div>
    </div>`) : ''}

    <div class="card mt16">
      <div class="card-body">
        <div class="row between">
          <div>
            <div class="muted small">Zeile 72 · ${e.profit >= 0 ? 'Steuerpflichtiger Gewinn' : 'Verlust'}</div>
            <div style="font-size:28px;font-weight:660;letter-spacing:-.6px" class="num ${e.profit >= 0 ? 'amount pos' : 'amount neg'}">${money(e.profit)} €</div>
          </div>
          <div class="right small muted">
            ${esc(periodLabel(period))}<br>
            ${e.kleinunternehmer ? 'Kleinunternehmer § 19 UStG' : 'Regelbesteuerung'}<br>
            ${e.basis === 'ist' ? 'Zuflussprinzip § 11 EStG' : 'Rechnungsdatum'}
          </div>
        </div>
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Umsatzsteuer                                                                */
/* -------------------------------------------------------------------------- */

function ust(root, db) {
  const year = Number(period.from.slice(0, 4));
  const v = vatReturn(db, period.from, period.to);
  const periods = vatPeriods(db, year);
  const kz = (n, label, val, strong = false) => `
    <tr${strong ? ' style="font-weight:640"' : ''}>
      <td class="num strong" style="width:70px">${n || ''}</td>
      <td>${esc(label)}</td>
      <td class="num">${esc(money(val))} €</td>
    </tr>`;

  root.innerHTML = html`
    ${raw(scopeWarning())}
    <div class="grid c3 mb16">
      ${statCard({ label: 'Vereinnahmte Umsatzsteuer', value: `${esc(money(v.umsatzsteuer))} €`, tone: 'neg' })}
      ${statCard({ label: 'Abziehbare Vorsteuer', value: `${esc(money(v.vorsteuer))} €`, tone: 'pos' })}
      ${statCard({
        label: v.kz83 >= 0 ? 'Zahllast (Kennzahl 83)' : 'Erstattung (Kennzahl 83)',
        value: `${esc(money(Math.abs(v.kz83)))} €`,
        tone: v.kz83 >= 0 ? 'neg' : 'pos',
        foot: v.kz83 >= 0 ? '<span>an das Finanzamt zu zahlen</span>' : '<span>vom Finanzamt zu erstatten</span>',
      })}
    </div>

    <div class="grid c2">
      <div class="card">
        <div class="card-head"><h3>Kennzahlen der Voranmeldung</h3><span class="sub">${esc(periodLabel(period))}</span></div>
        <div class="table-wrap"><table class="data">
          <tbody>
            ${raw(kz(81, 'Umsätze 19 % (Bemessungsgrundlage)', v.kz81net))}
            ${raw(kz('', 'darauf Umsatzsteuer', v.kz81tax))}
            ${raw(kz(86, 'Umsätze 7 % (Bemessungsgrundlage)', v.kz86net))}
            ${raw(kz('', 'darauf Umsatzsteuer', v.kz86tax))}
            ${v.kz35net ? raw(kz(35, 'Umsätze zu anderen Steuersätzen', v.kz35net) + kz(36, 'Steuer dazu', v.kz36tax)) : ''}
            ${v.kz41 ? raw(kz(41, 'Innergemeinschaftliche Lieferungen', v.kz41)) : ''}
            ${v.kz21 ? raw(kz(21, 'Nicht steuerbare sonstige Leistungen (§ 18b)', v.kz21)) : ''}
            ${v.kz48 ? raw(kz(48, 'Steuerfreie Umsätze ohne Vorsteuerabzug', v.kz48)) : ''}
            ${v.kz89net ? raw(kz(89, 'Innergemeinschaftliche Erwerbe 19 %', v.kz89net)) : ''}
            ${v.kz46net ? raw(kz(46, 'Leistungen nach § 13b', v.kz46net) + kz(47, 'Steuer nach § 13b', v.kz47tax)) : ''}
            ${raw(kz(66, 'Vorsteuer aus Rechnungen', v.kz66))}
            ${v.kz61 ? raw(kz(61, 'Vorsteuer aus i.g. Erwerben', v.kz61)) : ''}
            ${v.kz67 ? raw(kz(67, 'Vorsteuer nach § 13b', v.kz67)) : ''}
          </tbody>
          <tfoot><tr><td class="num">83</td><td>${v.kz83 >= 0 ? 'Verbleibende Vorauszahlung' : 'Verbleibender Überschuss'}</td><td class="num">${money(v.kz83)} €</td></tr></tfoot>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Voranmeldungszeiträume ${year}</h3><span class="sub">${esc(db.settings.vatPeriod)}</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Zeitraum</th><th class="num">Umsatzsteuer</th><th class="num">Vorsteuer</th><th class="num">Zahllast</th></tr></thead>
          <tbody>
            ${raw(periods.map((p) => `<tr class="clickable" data-from="${p.from}" data-to="${p.to}">
              <td>${esc(p.label)} <span class="tiny muted">${esc(fmtDate(p.from))}–${esc(fmtDate(p.to))}</span></td>
              <td class="num">${esc(money(p.result.umsatzsteuer))}</td>
              <td class="num">${esc(money(p.result.vorsteuer))}</td>
              <td class="num ${p.result.kz83 > 0 ? 'amount neg' : p.result.kz83 < 0 ? 'amount pos' : ''}">${esc(money(p.result.kz83))}</td>
            </tr>`).join(''))}
          </tbody>
          <tfoot><tr>
            <td>Jahr gesamt</td>
            <td class="num">${money(sum(periods, (p) => p.result.umsatzsteuer))}</td>
            <td class="num">${money(sum(periods, (p) => p.result.vorsteuer))}</td>
            <td class="num">${money(sum(periods, (p) => p.result.kz83))}</td>
          </tr></tfoot>
        </table></div>
        <div class="card-body">
          <p class="small muted mb0">Zeitraum anklicken, um ihn oben als Auswertungszeitraum zu übernehmen.
          Die Voranmeldung ist bis zum 10. Tag nach Ablauf des Zeitraums zu übermitteln.</p>
        </div>
      </div>
    </div>`;

  $$('[data-from]', root).forEach((tr) => tr.addEventListener('click', () => {
    setPeriod(period, tr.dataset.from, tr.dataset.to);
    periodCtl?.update();
    draw(root.closest('#content') || root.parentElement);
  }));
}

/* -------------------------------------------------------------------------- */
/* Vermögen                                                                    */
/* -------------------------------------------------------------------------- */

function bilanz(root, db) {
  const b = balanceSheet(db, period.to);
  const line = (label, value, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(money(value))} €</td></tr>`;

  root.innerHTML = html`
    <div class="notice mb16">
      <strong>Vermögensübersicht statt Bilanz.</strong> Bei einer Einnahmen-Überschuss-Rechnung
      besteht keine Bilanzierungspflicht. Diese Gegenüberstellung zeigt trotzdem, was dem
      Betrieb zum Stichtag gehört und was er schuldet – die Differenz ist Ihr Reinvermögen.
      Sie folgt nicht der Gliederung des § 266 HGB.
    </div>

    <div class="grid c2">
      <div class="card">
        <div class="card-head"><h3>Vermögen</h3><div class="spacer"></div><span class="badge pos">${esc(money(b.activa.total))} €</span></div>
        <div class="table-wrap"><table class="data">
          <tbody>
            <tr class="group"><td colspan="2" class="muted small strong">Anlagevermögen</td></tr>
            ${raw((b.activa.assets || []).map((a) => line(`${a.name} (${fmtDate(a.purchaseDate)})`, a.bookValue)).join('')
              || '<tr><td class="muted">Kein Anlagevermögen erfasst</td><td class="num">0,00 €</td></tr>')}
            <tr class="group"><td colspan="2" class="muted small strong" style="padding-top:14px">Umlaufvermögen</td></tr>
            ${raw(line('Forderungen aus Lieferungen und Leistungen', b.activa.receivables))}
            ${raw((b.activa.accounts || []).map((a) => line(a.name, a.balance)).join(''))}
          </tbody>
          <tfoot><tr><td>Summe Vermögen</td><td class="num">${money(b.activa.total)} €</td></tr></tfoot>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Schulden und Reinvermögen</h3><div class="spacer"></div><span class="badge">${esc(money(b.passiva.total))} €</span></div>
        <div class="table-wrap"><table class="data">
          <tbody>
            ${raw(line('Verbindlichkeiten aus Lieferungen und Leistungen', b.passiva.payables))}
            ${b.passiva.vatLiability ? raw(line('Umsatzsteuer-Zahllast (laufendes Jahr)', b.passiva.vatLiability)) : ''}
            ${b.passiva.vatClaim ? raw(line('nachrichtlich: Vorsteuer-Erstattungsanspruch', b.passiva.vatClaim)) : ''}
            <tr><td colspan="2" style="padding:0"><hr class="sep" style="margin:6px 0"></td></tr>
            ${raw(line('Reinvermögen (Eigenkapital)', b.passiva.equity))}
          </tbody>
          <tfoot><tr><td>Summe</td><td class="num">${money(b.passiva.total)} €</td></tr></tfoot>
        </table></div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>Entwicklung des Eigenkapitals im laufenden Jahr</h3></div>
      <div class="card-body">
        <table class="data">
          <tbody>
            ${raw(line('Ergebnis seit Jahresbeginn', b.equityDevelopment.profitYtd))}
            ${raw(line('Privateinlagen', b.equityDevelopment.deposits))}
            ${raw(line('Privatentnahmen', -b.equityDevelopment.withdrawals))}
          </tbody>
          <tfoot><tr><td>Veränderung</td><td class="num">${money(b.equityDevelopment.profitYtd + b.equityDevelopment.deposits - b.equityDevelopment.withdrawals)} €</td></tr></tfoot>
        </table>
      </div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Offene Posten                                                               */
/* -------------------------------------------------------------------------- */

function opos(root, db) {
  const o = openItems(db, todayISO());
  /* Beide Listen lassen sich sortieren, durchsuchen und nach Kontakt und
     Fälligkeit filtern; ein Klick öffnet die Buchung. */
  const liste = (id, items, title, tone) => `
    <div class="card">
      <div class="card-head"><h3>${esc(title)}</h3><div class="spacer"></div>
        <span class="badge ${tone}">${esc(money(sum(items, (t) => t.gross)))} €</span></div>
      ${table({
        id,
        cls: 'data',
        defaultSort: { key: 'due', dir: 1 },
        rows: items,
        unit: ['Rechnung', 'Rechnungen'],
        search: items.length > 8 ? {
          placeholder: 'Suchen: Text, Rechnungsnummer, Kontakt …',
          text: (t) => [t.description, t.invoiceNumber, sel.contactName(t.contactId), (t.gross / 100).toFixed(2)].join(' '),
        } : null,
        columns: [
          { key: 'date', label: 'Datum', type: 'date', tdCls: 'nowrap', cell: (t) => esc(fmtDate(t.date)) },
          { key: 'description', label: 'Beschreibung', type: 'text', tdCls: 'truncate', cell: (t) => `<span class="truncate" style="display:block;max-width:280px">${esc(t.description)}</span>` },
          {
            key: 'contact', label: 'Kontakt', type: 'text', tdCls: 'small muted',
            value: (t) => (t.contactId ? sel.contactName(t.contactId) : ''), cell: (t) => esc(sel.contactName(t.contactId)),
          },
          {
            key: 'due', label: 'Fällig', type: 'date', dir: 1, dirText: ['am längsten fällig zuerst', 'zuletzt fällig zuerst'],
            value: (t) => t.dueDate || t.date,
            cell: (t) => (t.overdue ? `<span class="badge neg">${t.overdueDays} Tage über</span>` : `<span class="badge">${esc(fmtDate(t.dueDate || t.date))}</span>`),
          },
          { key: 'amount', label: 'Betrag', type: 'num', value: (t) => t.gross, cell: (t) => `${esc(money(t.gross))} €` },
        ],
        filters: [
          ...contactFilter(items, 'contact'),
          {
            key: 'faellig', column: 'due', title: 'Fälligkeit', initial: 'alle', chip: (v, label) => label,
            options: () => [['alle', 'Alle offenen', () => true], ['ueber', 'Nur überfällige', (t) => t.overdue], ['ziel', 'Nur im Zahlungsziel', (t) => !t.overdue]],
          },
        ],
        onRowClick: (t) => openTransactionDialog(t.id),
        emptyTitle: 'Nichts offen',
        foot: (sichtbar) => (sichtbar.length !== items.length
          ? `<tr><td colspan="4">Summe der angezeigten (${int(sichtbar.length)})</td><td class="num">${esc(money(sum(sichtbar, (t) => t.gross)))} €</td></tr>`
          : ''),
      }).__raw}
    </div>`;

  const aging = (a, title) => {
    const rows = [['nicht fällig', a.current], ['1–30 Tage', a.d30], ['31–60 Tage', a.d60], ['61–90 Tage', a.d90], ['über 90 Tage', a.older]];
    return `<div class="card"><div class="card-head"><h3>${esc(title)}</h3></div><div class="card-body">
      ${rankBars(rows.map(([name, amount]) => ({ name, amount })), { color: 'var(--warn)' }).__raw}</div></div>`;
  };

  root.innerHTML = html`
    <div class="grid c2 mb16">
      ${statCard({ label: 'Forderungen gegen Kunden', value: `${esc(money(o.receivableTotal))} €`, tone: 'pos', foot: `<span>${int(o.receivables.length)} Rechnungen, davon ${int(o.receivables.filter((t) => t.overdue).length)} überfällig</span>` })}
      ${statCard({ label: 'Eigene Verbindlichkeiten', value: `${esc(money(o.payableTotal))} €`, tone: 'neg', foot: `<span>${int(o.payables.length)} Rechnungen, davon ${int(o.payables.filter((t) => t.overdue).length)} überfällig</span>` })}
    </div>
    <div class="grid c2 mb16">
      ${raw(aging(o.receivableAging, 'Altersstruktur Forderungen'))}
      ${raw(aging(o.payableAging, 'Altersstruktur Verbindlichkeiten'))}
    </div>
    ${raw(liste('opos-forderungen', o.receivables, 'Forderungen – Kunden schulden Ihnen Geld', 'pos'))}
    <div class="mt16">${raw(liste('opos-verbindlichkeiten', o.payables, 'Verbindlichkeiten – Sie schulden noch Geld', 'neg'))}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Konten                                                                      */
/* -------------------------------------------------------------------------- */

function konten(root, db) {
  const accounts = accountBalances(db, period.to);
  root.innerHTML = html`
    <div class="grid c${Math.min(4, Math.max(1, accounts.length))} mb16">
      ${raw(accounts.map((a) => statCard({
        label: a.name, icon: 'bank',
        value: `${esc(money(a.balance))} €`,
        tone: a.balance < 0 ? 'neg' : '',
        foot: `<span>Zufluss ${esc(money(a.inflow))} € · Abfluss ${esc(money(a.outflow))} €</span>`,
      }).__raw).join(''))}
    </div>
    ${raw(accounts.map((acc) => accountSheet(db, acc)).join('') || emptyState('Keine Konten', 'Legen Sie unter Stammdaten ein Bankkonto an.').__raw)}`;

  $$('[data-tx]', root).forEach((tr) => tr.addEventListener('click', () => openTransactionDialog(tr.dataset.tx)));
}

function accountSheet(db, acc) {
  const rows = db.transactions
    .filter((t) => !t.voided && t.accountId === acc.id && t.paidDate && t.paidDate >= period.from && t.paidDate <= period.to)
    .sort((a, b) => a.paidDate.localeCompare(b.paidDate));
  let running = Number(acc.openingBalance) || 0;
  for (const t of db.transactions) {
    if (t.voided || t.accountId !== acc.id || !t.paidDate || t.paidDate >= period.from) continue;
    running += t.type === 'income' ? t.gross : -t.gross;
  }
  const opening = running;
  return `
    <div class="card mb16">
      <div class="card-head"><h3>${esc(acc.name)}</h3><span class="sub">${esc(acc.kind === 'bank' ? 'Bankkonto' : 'Kasse')}${acc.iban ? ' · ' + esc(acc.iban) : ''}</span></div>
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th>Datum</th><th>Vorgang</th><th class="num">Eingang</th><th class="num">Ausgang</th><th class="num">Saldo</th></tr></thead>
        <tbody>
          <tr><td colspan="4" class="muted">Anfangsbestand am ${esc(fmtDate(period.from))}</td><td class="num">${esc(money(opening))}</td></tr>
          ${rows.map((t) => {
            running += t.type === 'income' ? t.gross : -t.gross;
            return `<tr class="clickable" data-tx="${esc(t.id)}">
              <td class="nowrap">${esc(fmtDate(t.paidDate))}</td>
              <td class="truncate" style="max-width:340px">${esc(t.description)}</td>
              <td class="num amount pos">${t.type === 'income' ? esc(money(t.gross)) : ''}</td>
              <td class="num amount neg">${t.type === 'expense' ? esc(money(t.gross)) : ''}</td>
              <td class="num">${esc(money(running))}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr><td colspan="4">Endbestand am ${esc(fmtDate(period.to))}</td><td class="num">${esc(money(running))}</td></tr></tfoot>
      </table></div>
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Anlagevermögen                                                              */
/* -------------------------------------------------------------------------- */

function anlagen(root, db) {
  const assets = db.assets || [];
  root.innerHTML = html`
    <div class="grid c3 mb16">
      ${statCard({ label: 'Anschaffungskosten gesamt', value: `${esc(money(sum(assets, (a) => a.cost)))} €` })}
      ${statCard({ label: 'Abschreibung im Zeitraum', value: `${esc(money(totalDepreciation(db, period.from, period.to)))} €`, tone: 'neg' })}
      ${statCard({ label: 'Restbuchwert am Stichtag', value: `${esc(money(sum(assets, (a) => bookValue(a, period.to))))} €` })}
    </div>
    <div class="card">
      <div class="card-head"><h3>Anlagenverzeichnis</h3><span class="sub">§ 4 Abs. 3 Satz 5 EStG</span></div>
      ${assets.length ? table({
        id: 'anlagen-auswertung',
        cls: 'data',
        toolbar: false,
        defaultSort: { key: 'purchaseDate', dir: 1 },
        rows: assets,
        columns: [
          { key: 'name', label: 'Wirtschaftsgut', type: 'text', cell: (a) => esc(a.name) },
          { key: 'purchaseDate', label: 'Anschaffung', type: 'date', tdCls: 'nowrap', cell: (a) => esc(fmtDate(a.purchaseDate)) },
          { key: 'cost', label: 'Kosten', type: 'num', cell: (a) => esc(money(a.cost)) },
          { key: 'usefulLifeYears', label: 'Nutzungsdauer', type: 'num', value: (a) => Number(a.usefulLifeYears), cell: (a) => `${esc(a.usefulLifeYears)} Jahre` },
          {
            key: 'afa', label: 'AfA im Zeitraum', type: 'num',
            value: (a) => depreciationInRange(a, period.from, period.to), cell: (a) => esc(money(depreciationInRange(a, period.from, period.to))),
          },
          { key: 'book', label: 'Restbuchwert', type: 'num', value: (a) => bookValue(a, period.to), cell: (a) => esc(money(bookValue(a, period.to))) },
        ],
      }) : emptyState('Kein Anlagevermögen', 'Anschaffungen über 800 € netto tragen Sie beim Erfassen der Ausgabe als Anlagegut ein.')}
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

async function exportPdf(preview) {
  // Das PDF zeigt, was die Ansicht zeigt – samt Vermerk, falls nicht
  // gelistete Buchungen darin stecken.
  const db = scopeDb(store.db, scope.includeUnlisted);
  const st = scope.includeUnlisted ? unlistedStats(store.db, period.from, period.to) : { count: 0 };
  const makers = {
    guv: () => [R.guvReport(db, period), `GuV_${period.from}_${period.to}.pdf`],
    euer: () => [R.euerPdf(db, period), `Anlage-EUER_${period.from.slice(0, 4)}.pdf`],
    ust: () => [R.ustvaPdf(db, period), `UStVA_${period.from}_${period.to}.pdf`],
    bilanz: () => [R.balancePdf(db, period), `Vermoegensuebersicht_${period.to}.pdf`],
    opos: () => [R.openItemsPdf(db, todayISO()), `Offene-Posten_${todayISO()}.pdf`],
    konten: () => [R.accountsPdf(db, period), `Kontenblaetter_${period.from}_${period.to}.pdf`],
    anlagen: () => [R.assetsPdf(db, period), `Anlagenverzeichnis_${period.to}.pdf`],
  };
  let [doc, name] = (makers[tab] || makers.guv)();
  if (st.count) {
    doc = doc.replace('</body>', `<div class="note"><strong>Enthält ${st.count} nicht gelistete Buchung${st.count === 1 ? '' : 'en'}.</strong>
      Diese Aufstellung ist nur für den eigenen Gebrauch; für das Finanzamt gelten die Werte ohne sie.</div></body>`);
  }
  try {
    const res = await api.pdf.create({ html: doc, defaultName: name, preview });
    if (res?.path) ok('PDF gespeichert', res.path);
    else if (res?.previewed) ok('Vorschau geöffnet', 'Die Datei wird beim Beenden von Kontovia gelöscht.');
  } catch (e) {
    err('PDF konnte nicht erstellt werden', e.message);
  }
}

export { period };
