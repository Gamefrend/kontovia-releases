/** Kontovia – Übersicht: die wichtigsten Zahlen auf einen Blick. */

import {
  html, raw, esc, $, $$, money, fmtDate, todayISO, int, ymLabel, addDays, relativeDays, sum,
} from '../lib/util.js';
import { icon, statCard, deltaBadge, rankBars, donut, emptyState, chart, mountCharts } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import {
  compareRanges, trend, openItems, accountBalances, balanceSheet,
  receiptCoverage, healthChecks, topCategories, isKleinunternehmer, scopeDb, averages,
} from '../lib/calc.js';
import {
  prefs, scope, scopeBarHtml, wireScopeBar, verlaufControls, wireVerlauf, verlaufBody,
  anteilControls, wireAnteil,
} from '../lib/prefs.js';
import { defaultPeriod, periodPickerHtml, wirePeriodPicker, periodLabel } from '../lib/period.js';
import { navigate } from '../lib/router.js';
import { openTransactionDialog } from './transactions.js';
import { openAppointmentDialog } from './calendar.js';

const period = defaultPeriod();

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = html`
    ${raw(periodPickerHtml(period, 'db'))}
    <button class="btn income" id="quickIncome">${icon('plus', 16)} Einnahme</button>
    <button class="btn expense" id="quickExpense">${icon('plus', 16)} Ausgabe</button>`;
  wirePeriodPicker(actions, period, () => draw(root), 'db');
  actions.querySelector('#quickIncome').addEventListener('click', () => openTransactionDialog(null, 'income'));
  actions.querySelector('#quickExpense').addEventListener('click', () => openTransactionDialog(null, 'expense'));
  draw(root);
}

/** Ø-Angabe unter einer Kennzahl – nur, wenn es mehr als einen Monat gibt. */
function avgFoot(value, avg) {
  return avg.months > 1 ? `<span class="avg-foot" title="Durchschnitt über ${avg.months} Monate">Ø ${esc(money(value))} € je Monat</span>` : '';
}

function draw(root) {
  // Nicht gelistete Buchungen zählen nur mit, wenn das Häkchen gesetzt ist.
  const db = scopeDb(store.db, scope.includeUnlisted);
  const klein = isKleinunternehmer(db);
  const { current, previous } = compareRanges(db, period.from, period.to);
  const open = openItems(db, todayISO());
  const accounts = accountBalances(db, todayISO());
  const cash = sum(accounts, (a) => a.balance);
  const cov = receiptCoverage(db, period.from, period.to);
  const checks = healthChecks(db, period.from, period.to);
  const upcoming = sel.appointments()
    .filter((a) => a.date >= todayISO() && a.date <= addDays(todayISO(), 45))
    .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')))
    .slice(0, 6);
  const bs = balanceSheet(db, period.to);
  const avg = averages(current);
  const topExpense = topCategories(current, 'expense', 50);
  const topIncome = topCategories(current, 'income', 50);
  const anteil = (rows, key, color, center) => (prefs[key] === 'pie'
    ? chart('pie', rows.map((c) => ({ name: c.name, amount: c.amount })), { centerLabel: center, label: `${center} nach Kategorie` })
    : rankBars(rows.slice(0, 7), { color, total: rows.reduce((t, c) => t + Math.abs(c.amount), 0) }));

  root.innerHTML = html`
    <div class="page-head">
      <div>
        <h2>${esc(store.db.settings.companyName || store.db.settings.ownerName || 'Ihre Buchhaltung')}</h2>
        <p>${esc(periodLabel(period))} · Gewinnermittlung ${db.settings.accountingBasis === 'ist' ? 'nach Zahlungsfluss' : 'nach Rechnungsdatum'}${klein ? ' · Kleinunternehmer § 19 UStG' : ''}</p>
      </div>
    </div>
    ${scopeBarHtml(store.db, period.from, period.to)}

    <div class="grid c4">
      ${statCard({
        label: 'Einnahmen', icon: 'up',
        value: `${esc(money(current.incomeForProfit))} <span class="muted" style="font-size:15px">€</span>`,
        tone: 'pos',
        foot: `${deltaBadge(trend(current.incomeForProfit, previous.incomeForProfit)).__raw} <span>ggü. Vorzeitraum</span>`
          + avgFoot(avg.income, avg),
      })}
      ${statCard({
        label: 'Ausgaben', icon: 'down',
        value: `${esc(money(current.expenseForProfit))} <span class="muted" style="font-size:15px">€</span>`,
        tone: 'neg',
        foot: `${deltaBadge(trend(current.expenseForProfit, previous.expenseForProfit)).__raw} <span>ggü. Vorzeitraum</span>`
          + avgFoot(avg.expense, avg),
      })}
      ${statCard({
        label: current.profit >= 0 ? 'Gewinn' : 'Verlust', icon: 'scale',
        value: `${esc(money(current.profit))} <span class="muted" style="font-size:15px">€</span>`,
        tone: current.profit >= 0 ? 'pos' : 'neg',
        foot: (current.margin !== null ? `<span>Marge ${esc((current.margin * 100).toFixed(1).replace('.', ','))} %</span>` : '<span>–</span>')
          + avgFoot(avg.profit, avg),
      })}
      ${klein
        ? statCard({
          label: 'Kontostände heute', icon: 'bank',
          value: `${esc(money(cash))} <span class="muted" style="font-size:15px">€</span>`,
          tone: cash >= 0 ? '' : 'neg',
          foot: `<span>über ${accounts.length} Konten</span>`,
        })
        : statCard({
          label: current.vatPayable >= 0 ? 'Umsatzsteuer-Zahllast' : 'Vorsteuer-Erstattung', icon: 'euro',
          value: `${esc(money(Math.abs(current.vatPayable)))} <span class="muted" style="font-size:15px">€</span>`,
          tone: current.vatPayable > 0 ? 'neg' : 'pos',
          foot: `<span>vereinnahmt ${esc(money(current.incomeVat))} € · Vorsteuer ${esc(money(current.expenseVat))} €</span>`,
        })}
    </div>

    <div class="grid side mt16">
      <div class="card">
        <div class="card-head">
          <h3>Verlauf</h3>
          <span class="sub">je Monat</span>
          <div class="spacer"></div>
          ${verlaufControls()}
          <button class="btn sm ghost" data-goto="reports">Details ${icon('right', 13)}</button>
        </div>
        <div class="card-body">${verlaufBody(current.months, avg, (s) => ymLabel(s.ym))}</div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Offene Posten</h3></div>
        <div class="card-body">
          <div class="row between" style="align-items:flex-start">
            <div class="stack">
              <span class="muted small">Ihre Forderungen</span>
              <span class="value num" style="font-size:20px;font-weight:650;color:var(--pos)">${money(open.receivableTotal)} €</span>
              <span class="tiny muted">${int(open.receivables.length)} unbezahlte Rechnungen</span>
            </div>
            <div class="stack right">
              <span class="muted small">Ihre Verbindlichkeiten</span>
              <span class="value num" style="font-size:20px;font-weight:650;color:var(--neg)">${money(open.payableTotal)} €</span>
              <span class="tiny muted">${int(open.payables.length)} offene Rechnungen</span>
            </div>
          </div>
          <hr class="sep">
          ${open.receivables.length
            ? raw(`<div class="small muted mb8">Am längsten offen:</div>` + open.receivables.slice(0, 5).map((t) => `
                <div class="row between" style="padding:4px 0;cursor:pointer" data-tx="${esc(t.id)}">
                  <div class="truncate" style="max-width:170px">${esc(t.description)}</div>
                  <div class="row" style="gap:8px">
                    ${t.overdue ? `<span class="badge neg tiny">${t.overdueDays} T</span>` : '<span class="badge tiny">im Ziel</span>'}
                    <span class="num">${esc(money(t.gross))} €</span>
                  </div>
                </div>`).join(''))
            : raw('<p class="muted small mb0">Alle Rechnungen sind bezahlt.</p>')}
        </div>
      </div>
    </div>

    <div class="grid c3 mt16">
      <div class="card">
        <div class="card-head"><h3>Größte Ausgabenblöcke</h3><div class="spacer"></div>${anteilControls('anteilAusgaben')}</div>
        <div class="card-body">
          ${anteil(topExpense, 'anteilAusgaben', 'var(--neg)', 'Ausgaben')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Umsatz nach Kategorie</h3><div class="spacer"></div>${anteilControls('anteilEinnahmen')}</div>
        <div class="card-body">
          ${anteil(topIncome, 'anteilEinnahmen', 'var(--pos)', 'Einnahmen')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Konten und Vermögen</h3></div>
        <div class="card-body">
          ${raw(accounts.map((a) => `
            <div class="row between" style="padding:5px 0">
              <span>${icon('bank', 14).__raw} ${esc(a.name)}</span>
              <span class="num strong ${a.balance < 0 ? 'amount neg' : ''}">${esc(money(a.balance))} €</span>
            </div>`).join(''))}
          <hr class="sep">
          <div class="row between"><span class="muted">Anlagevermögen (Restwert)</span><span class="num">${money(bs.activa.fixedAssets)} €</span></div>
          <div class="row between"><span class="muted">Forderungen</span><span class="num">${money(bs.activa.receivables)} €</span></div>
          <div class="row between"><span class="muted">Verbindlichkeiten</span><span class="num">− ${money(bs.passiva.payables)} €</span></div>
          <hr class="sep">
          <div class="row between"><strong>Reinvermögen</strong><strong class="num">${money(bs.passiva.equity)} €</strong></div>
        </div>
      </div>
    </div>

    <div class="grid side mt16">
      <div class="card">
        <div class="card-head">
          <h3>Anstehende Termine</h3>
          <div class="spacer"></div>
          <button class="btn sm ghost" data-goto="calendar">Kalender ${icon('right', 13)}</button>
        </div>
        <div class="card-body ${upcoming.length ? 'tight' : ''}">
          ${upcoming.length ? raw(`<div style="padding:0 16px">${upcoming.map((a) => {
            const linked = (a.transactionIds || []).length;
            return `<div class="agenda-item" data-appt="${esc(a.id)}">
              <div class="agenda-date">
                <div class="d">${esc(a.date.slice(8, 10))}</div>
                <div class="m">${esc(['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][Number(a.date.slice(5, 7)) - 1])}</div>
              </div>
              <div style="flex:1;min-width:0">
                <div class="strong truncate">${esc(a.title)}</div>
                <div class="tiny muted">${a.allDay ? 'ganztägig' : esc((a.startTime || '') + (a.endTime ? '–' + a.endTime : ''))}${a.location ? ' · ' + esc(a.location) : ''} · ${esc(relativeDays(a.date))}</div>
              </div>
              ${linked ? `<span class="badge info">${icon('link', 12).__raw} ${linked}</span>` : ''}
            </div>`;
          }).join('')}</div>`) : emptyState('Keine Termine', 'In den nächsten sechs Wochen steht nichts an.')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Ordnung und Vollständigkeit</h3></div>
        <div class="card-body">
          <div class="row" style="gap:16px;align-items:center">
            ${donut(cov.ratio, { color: cov.ratio > 0.9 ? 'var(--pos)' : cov.ratio > 0.6 ? 'var(--warn)' : 'var(--neg)' })}
            <div class="stack">
              <strong>Belegquote</strong>
              <span class="small muted">${int(cov.withDoc)} von ${int(cov.total)} Buchungen haben einen Beleg.</span>
              ${cov.missing.length ? raw(`<button class="btn sm mt8" id="showMissing">${cov.missing.length} ohne Beleg anzeigen</button>`) : ''}
            </div>
          </div>
          ${checks.length ? raw('<hr class="sep">' + checks.map((c) => `
            <div class="notice ${c.level === 'error' ? 'danger' : c.level === 'warn' ? 'warn' : ''} mb8">${esc(c.text)}</div>`).join('')) : raw('<hr class="sep"><div class="notice ok">Keine Auffälligkeiten gefunden.</div>')}
        </div>
      </div>
    </div>`;

  mountCharts(root);
  const redraw = () => draw(root);
  wireScopeBar(root, redraw);
  wireVerlauf(root, redraw);
  wireAnteil(root, 'anteilAusgaben', redraw);
  wireAnteil(root, 'anteilEinnahmen', redraw);
  $$('[data-goto]', root).forEach((b) => b.addEventListener('click', () => navigate(b.dataset.goto)));
  $$('[data-tx]', root).forEach((b) => b.addEventListener('click', () => openTransactionDialog(b.dataset.tx)));
  $$('[data-appt]', root).forEach((b) => b.addEventListener('click', () => openAppointmentDialog(b.dataset.appt)));
  $('#showMissing', root)?.addEventListener('click', () => navigate('transactions', { receipt: 'ohne' }));
}
