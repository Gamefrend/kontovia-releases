/**
 * Kontovia – Übersicht: die wichtigsten Zahlen auf einen Blick.
 *
 * Die Übersicht besteht aus Modulen, die sich über „Anpassen“ verschieben,
 * in der Breite ändern, aus- und wieder einblenden lassen. Die Anordnung
 * bleibt auf diesem Gerät (prefs.js); ohne eigene gilt die Voreinstellung.
 */

import {
  html, raw, esc, $, $$, money, todayISO, int, ymLabel, addDays, relativeDays, sum, fmtDate, MONTHS_SHORT,
} from '../lib/util.js';
import { icon, statCard, deltaBadge, rankBars, donut, emptyState, chart, mountCharts, amountCell, ok } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import {
  compareRanges, trend, openItems, accountBalances, balanceSheet,
  receiptCoverage, healthChecks, topCategories, isKleinunternehmer, scopeDb, averages,
} from '../lib/calc.js';
import {
  prefs, scope, scopeToggleHtml, wireScopeToggle, verlaufControls, wireVerlauf, verlaufBody,
  anteilControls, wireAnteil, loadDashLayout, saveDashLayout,
} from '../lib/prefs.js';
import { defaultPeriod, periodControl } from '../lib/period.js';
import { navigate } from '../lib/router.js';
import { openTransactionDialog } from './transactions.js';
import { openAppointmentDialog } from './calendar.js';

const period = defaultPeriod();
/** Ist die Übersicht gerade im Anpassen-Modus? Gilt nur bis zum Verlassen der Ansicht. */
let editing = false;

/** Breiten im 12er-Raster: ein Viertel, ein Drittel, die Hälfte, zwei Drittel, ganze Breite. */
const SIZES = [3, 4, 6, 8, 12];
const SIZE_LABEL = { 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 12: '1' };
const SIZE_TITLE = { 3: 'ein Viertel', 4: 'ein Drittel', 6: 'halbe Breite', 8: 'zwei Drittel', 12: 'ganze Breite' };

export async function render(root, params, { actions } = {}) {
  editing = false;
  actions.innerHTML = html`
    <div id="dbPeriod"></div>
    <button class="btn income" id="quickIncome">${icon('plus', 16)} Einnahme</button>
    <button class="btn expense" id="quickExpense">${icon('plus', 16)} Ausgabe</button>`;
  periodControl($('#dbPeriod', actions), period, () => draw(root));
  actions.querySelector('#quickIncome').addEventListener('click', () => openTransactionDialog(null, 'income'));
  actions.querySelector('#quickExpense').addEventListener('click', () => openTransactionDialog(null, 'expense'));
  draw(root);
}

/* -------------------------------------------------------------------------- */
/* Module                                                                      */
/* -------------------------------------------------------------------------- */

/** Ø-Angabe unter einer Kennzahl – nur, wenn es mehr als einen Monat gibt. */
function avgFoot(value, avg) {
  return avg.months > 1 ? `<span class="avg-foot" title="Durchschnitt über ${avg.months} Monate">Ø ${esc(money(value))} € je Monat</span>` : '';
}

const euro = (v) => `${esc(money(v))} <span class="muted" style="font-size:15px">€</span>`;

/**
 * Alles, was die Module brauchen – jeweils erst berechnet, wenn ein
 * sichtbares Modul danach fragt.
 */
function context() {
  // Nicht gelistete Buchungen zählen nur mit, wenn der Schalter gesetzt ist.
  const db = scopeDb(store.db, scope.includeUnlisted);
  const once = (fn) => { let done = false; let v; return () => { if (!done) { v = fn(); done = true; } return v; }; };
  const cmp = once(() => compareRanges(db, period.from, period.to));
  const c = {
    db,
    klein: isKleinunternehmer(db),
    current: () => cmp().current,
    previous: () => cmp().previous,
    avg: once(() => averages(cmp().current)),
    open: once(() => openItems(db, todayISO())),
    accounts: once(() => accountBalances(db, todayISO())),
  };
  return c;
}

const card = (title, body, { head = '', sub = '', tight = false } = {}) => `
  <div class="card">
    <div class="card-head"><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${head ? `<div class="spacer"></div>${head}` : ''}</div>
    <div class="card-body${tight ? ' tight' : ''}">${body}</div>
  </div>`;

function anteil(rows, key, color, center) {
  return (prefs[key] === 'pie'
    ? chart('pie', rows.map((c) => ({ name: c.name, amount: c.amount })), { centerLabel: center, label: `${center} nach Kategorie` })
    : rankBars(rows.slice(0, 7), { color, total: rows.reduce((t, c) => t + Math.abs(c.amount), 0) })).__raw;
}

/**
 * Die Module der Übersicht in ihrer voreingestellten Reihenfolge.
 * `size` ist die voreingestellte Breite, `hidden` gibt an, ob das Modul
 * anfangs ausgeblendet ist, `available` blendet es ganz aus (etwa die
 * Umsatzsteuer für Kleinunternehmer).
 */
const WIDGETS = {
  einnahmen: {
    title: 'Einnahmen', size: 3,
    render: (c) => statCard({
      label: 'Einnahmen', icon: 'up', value: euro(c.current().incomeForProfit), tone: 'pos',
      foot: `${deltaBadge(trend(c.current().incomeForProfit, c.previous().incomeForProfit)).__raw} <span>ggü. Vorzeitraum</span>`
        + avgFoot(c.avg().income, c.avg()),
    }).__raw,
  },
  ausgaben: {
    title: 'Ausgaben', size: 3,
    render: (c) => statCard({
      label: 'Ausgaben', icon: 'down', value: euro(c.current().expenseForProfit), tone: 'neg',
      foot: `${deltaBadge(trend(c.current().expenseForProfit, c.previous().expenseForProfit)).__raw} <span>ggü. Vorzeitraum</span>`
        + avgFoot(c.avg().expense, c.avg()),
    }).__raw,
  },
  ergebnis: {
    title: 'Gewinn oder Verlust', size: 3,
    render: (c) => {
      const cur = c.current();
      return statCard({
        label: cur.profit >= 0 ? 'Gewinn' : 'Verlust', icon: 'scale', value: euro(cur.profit), tone: cur.profit >= 0 ? 'pos' : 'neg',
        foot: (cur.margin !== null ? `<span>Marge ${esc((cur.margin * 100).toFixed(1).replace('.', ','))} %</span>` : '<span>–</span>')
          + avgFoot(c.avg().profit, c.avg()),
      }).__raw;
    },
  },
  ust: {
    title: 'Umsatzsteuer', size: 3, available: (c) => !c.klein,
    render: (c) => {
      const cur = c.current();
      return statCard({
        label: cur.vatPayable >= 0 ? 'Umsatzsteuer-Zahllast' : 'Vorsteuer-Erstattung', icon: 'euro',
        value: euro(Math.abs(cur.vatPayable)), tone: cur.vatPayable > 0 ? 'neg' : 'pos',
        foot: `<span>vereinnahmt ${esc(money(cur.incomeVat))} € · Vorsteuer ${esc(money(cur.expenseVat))} €</span>`,
      }).__raw;
    },
  },
  kasse: {
    title: 'Kontostände heute', size: 3, hidden: (c) => !c.klein,
    render: (c) => {
      const cash = sum(c.accounts(), (a) => a.balance);
      return statCard({
        label: 'Kontostände heute', icon: 'bank', value: euro(cash), tone: cash >= 0 ? '' : 'neg',
        foot: `<span>über ${c.accounts().length} Konten</span>`,
      }).__raw;
    },
  },
  verlauf: {
    title: 'Verlauf', size: 8,
    render: (c) => card('Verlauf', verlaufBody(c.current().months, c.avg(), (s) => ymLabel(s.ym)).__raw, {
      sub: 'je Monat',
      head: `${verlaufControls().__raw}<button class="btn sm ghost" data-goto="reports">Details ${icon('right', 13).__raw}</button>`,
    }),
  },
  offen: {
    title: 'Offene Posten', size: 4,
    render: (c) => {
      const open = c.open();
      return card('Offene Posten', `
        <div class="row between" style="align-items:flex-start">
          <div class="stack">
            <span class="muted small">Ihre Forderungen</span>
            <span class="value num" style="font-size:20px;font-weight:650;color:var(--pos)">${esc(money(open.receivableTotal))} €</span>
            <span class="tiny muted">${int(open.receivables.length)} unbezahlte Rechnungen</span>
          </div>
          <div class="stack right">
            <span class="muted small">Ihre Verbindlichkeiten</span>
            <span class="value num" style="font-size:20px;font-weight:650;color:var(--neg)">${esc(money(open.payableTotal))} €</span>
            <span class="tiny muted">${int(open.payables.length)} offene Rechnungen</span>
          </div>
        </div>
        <hr class="sep">
        ${open.receivables.length
          ? `<div class="small muted mb8">Am längsten offen:</div>` + open.receivables.slice(0, 5).map((t) => `
            <div class="row between list-row" data-tx="${esc(t.id)}" role="button" tabindex="0">
              <div class="truncate">${esc(t.description)}</div>
              <div class="row nowrap" style="gap:8px">
                ${t.overdue ? `<span class="badge neg tiny">${t.overdueDays} T</span>` : '<span class="badge tiny">im Ziel</span>'}
                <span class="num">${esc(money(t.gross))} €</span>
              </div>
            </div>`).join('')
          : '<p class="muted small mb0">Alle Rechnungen sind bezahlt.</p>'}`);
    },
  },
  ausgabenKat: {
    title: 'Größte Ausgabenblöcke', size: 4,
    render: (c) => card('Größte Ausgabenblöcke', anteil(topCategories(c.current(), 'expense', 50), 'anteilAusgaben', 'var(--neg)', 'Ausgaben'), {
      head: anteilControls('anteilAusgaben').__raw,
    }),
  },
  einnahmenKat: {
    title: 'Umsatz nach Kategorie', size: 4,
    render: (c) => card('Umsatz nach Kategorie', anteil(topCategories(c.current(), 'income', 50), 'anteilEinnahmen', 'var(--pos)', 'Einnahmen'), {
      head: anteilControls('anteilEinnahmen').__raw,
    }),
  },
  vermoegen: {
    title: 'Konten und Vermögen', size: 4,
    render: (c) => {
      const bs = balanceSheet(c.db, period.to);
      return card('Konten und Vermögen', `
        ${c.accounts().map((a) => `
          <div class="row between" style="padding:5px 0">
            <span>${icon('bank', 14).__raw} ${esc(a.name)}</span>
            <span class="num strong ${a.balance < 0 ? 'amount neg' : ''}">${esc(money(a.balance))} €</span>
          </div>`).join('')}
        <hr class="sep">
        <div class="row between"><span class="muted">Anlagevermögen (Restwert)</span><span class="num">${esc(money(bs.activa.fixedAssets))} €</span></div>
        <div class="row between"><span class="muted">Forderungen</span><span class="num">${esc(money(bs.activa.receivables))} €</span></div>
        <div class="row between"><span class="muted">Verbindlichkeiten</span><span class="num">− ${esc(money(bs.passiva.payables))} €</span></div>
        <hr class="sep">
        <div class="row between"><strong>Reinvermögen</strong><strong class="num">${esc(money(bs.passiva.equity))} €</strong></div>`);
    },
  },
  termine: {
    title: 'Anstehende Termine', size: 8,
    render: () => {
      const upcoming = sel.appointments()
        .filter((a) => a.date >= todayISO() && a.date <= addDays(todayISO(), 45))
        .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')))
        .slice(0, 6);
      const body = upcoming.length ? `<div style="padding:0 16px">${upcoming.map((a) => {
        const linked = (a.transactionIds || []).length;
        return `<div class="agenda-item" data-appt="${esc(a.id)}" role="button" tabindex="0">
          <div class="agenda-date">
            <div class="d">${esc(a.date.slice(8, 10))}</div>
            <div class="m">${esc(MONTHS_SHORT[Number(a.date.slice(5, 7)) - 1])}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div class="strong truncate">${esc(a.title)}</div>
            <div class="tiny muted">${a.allDay ? 'ganztägig' : esc((a.startTime || '') + (a.endTime ? '–' + a.endTime : ''))}${a.location ? ' · ' + esc(a.location) : ''} · ${esc(relativeDays(a.date))}</div>
          </div>
          ${linked ? `<span class="badge info">${icon('link', 12).__raw} ${linked}</span>` : ''}
        </div>`;
      }).join('')}</div>` : emptyState('Keine Termine', 'In den nächsten sechs Wochen steht nichts an.').__raw;
      return card('Anstehende Termine', body, {
        tight: upcoming.length > 0,
        head: `<button class="btn sm ghost" data-goto="calendar">Kalender ${icon('right', 13).__raw}</button>`,
      });
    },
  },
  ordnung: {
    title: 'Ordnung und Vollständigkeit', size: 4,
    render: (c) => {
      const cov = receiptCoverage(c.db, period.from, period.to);
      const checks = healthChecks(c.db, period.from, period.to);
      return card('Ordnung und Vollständigkeit', `
        <div class="row" style="gap:16px;align-items:center">
          ${donut(cov.ratio, { color: cov.ratio > 0.9 ? 'var(--pos)' : cov.ratio > 0.6 ? 'var(--warn)' : 'var(--neg)' }).__raw}
          <div class="stack">
            <strong>Belegquote</strong>
            <span class="small muted">${int(cov.withDoc)} von ${int(cov.total)} Buchungen haben einen Beleg.</span>
            ${cov.missing.length ? `<button class="btn sm mt8" id="showMissing">${cov.missing.length} ohne Beleg anzeigen</button>` : ''}
          </div>
        </div>
        <hr class="sep">
        ${checks.length
          ? checks.map((k) => `<div class="notice ${k.level === 'error' ? 'danger' : k.level === 'warn' ? 'warn' : ''} mb8">${esc(k.text)}</div>`).join('')
          : '<div class="notice ok">Keine Auffälligkeiten gefunden.</div>'}`);
    },
  },
  letzte: {
    title: 'Letzte Buchungen', size: 6, hidden: true,
    render: () => {
      const rows = sel.liveTransactions()
        .sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || '')))
        .slice(0, 7);
      const body = rows.length ? rows.map((t) => `
        <div class="row between list-row" data-tx="${esc(t.id)}" role="button" tabindex="0">
          <div style="min-width:0">
            <div class="truncate">${esc(t.description || '(ohne Beschreibung)')}</div>
            <div class="tiny muted truncate">${esc(fmtDate(t.date))} · ${esc(sel.categoryName(t.categoryId))}</div>
          </div>
          <span class="num nowrap">${amountCell(t.gross, t.type).__raw} €</span>
        </div>`).join('') : emptyState('Noch keine Buchungen', 'Oben rechts legen Sie die erste an.').__raw;
      return card('Letzte Buchungen', body, {
        head: `<button class="btn sm ghost" data-goto="transactions">Alle ${icon('right', 13).__raw}</button>`,
      });
    },
  },
  durchschnitt: {
    title: 'Durchschnittswerte', size: 6, hidden: true,
    render: (c) => {
      const avg = c.avg();
      const cur = c.current();
      const kpi = (k, v, s = '') => `<div><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;
      const monat = (m) => (m ? `${esc(ymLabel(m.ym))}: ${esc(money(m.profit))} €` : '–');
      return card('Durchschnittswerte', `
        <div class="kpi-list">
          ${kpi('Einnahmen je Monat', `<span class="amount pos">${esc(money(avg.income))} €</span>`)}
          ${kpi('Ausgaben je Monat', `<span class="amount neg">${esc(money(avg.expense))} €</span>`)}
          ${kpi('Ergebnis je Monat', `<span class="amount ${avg.profit >= 0 ? 'pos' : 'neg'}">${esc(money(avg.profit))} €</span>`)}
          ${kpi('Einnahme je Buchung', avg.perIncome === null ? '–' : `${esc(money(avg.perIncome))} €`, `${int(cur.countIncome)} Einnahmen`)}
          ${kpi('Ausgabe je Buchung', avg.perExpense === null ? '–' : `${esc(money(avg.perExpense))} €`, `${int(cur.countExpense)} Ausgaben`)}
          ${kpi('Bester Monat', avg.best ? `<span class="small">${monat(avg.best)}</span>` : '–')}
        </div>`, { sub: avg.months ? `über ${avg.months} ${avg.months === 1 ? 'Monat' : 'Monate'}` : '' });
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Anordnung                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Die gültige Anordnung: die gespeicherte, bereinigt um unbekannte Module
 * und ergänzt um solche, die eine neuere Fassung mitbringt – diese erst
 * einmal ausgeblendet, damit sich nichts ungefragt verschiebt.
 */
function currentLayout(c) {
  const voreinstellung = Object.entries(WIDGETS).map(([id, w]) => ({
    id, size: w.size, hidden: typeof w.hidden === 'function' ? w.hidden(c) : !!w.hidden,
  }));
  const saved = loadDashLayout();
  if (!saved) return voreinstellung;
  const out = [];
  const seen = new Set();
  for (const e of saved) {
    if (!WIDGETS[e?.id] || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, size: SIZES.includes(e.size) ? e.size : WIDGETS[e.id].size, hidden: !!e.hidden });
  }
  for (const d of voreinstellung) if (!seen.has(d.id)) out.push({ ...d, hidden: true });
  return out;
}

const available = (id, c) => !WIDGETS[id].available || WIDGETS[id].available(c);

/* -------------------------------------------------------------------------- */
/* Zeichnen                                                                    */
/* -------------------------------------------------------------------------- */

function draw(root) {
  const c = context();
  const lay = currentLayout(c).filter((e) => available(e.id, c));
  const sichtbar = lay.filter((e) => !e.hidden);
  const versteckt = lay.filter((e) => e.hidden);

  const item = (e, i) => {
    const w = WIDGETS[e.id];
    const bar = editing ? `
      <div class="dash-edit">
        <span class="dash-grip" title="Zum Verschieben ziehen">${icon('grip', 16).__raw}</span>
        <span class="dash-name">${esc(w.title)}</span>
        <button type="button" class="icon-btn" data-hide="${e.id}" aria-label="${esc(w.title)} ausblenden" title="Ausblenden">${icon('hide', 16).__raw}</button>
        <div class="dash-tools">
          <div class="seg sm" role="group" aria-label="Breite von ${esc(w.title)}">
            ${SIZES.map((s) => `<button type="button" data-size="${s}" data-id="${e.id}" class="${s === e.size ? 'active' : ''}" aria-pressed="${s === e.size}" title="${SIZE_TITLE[s]}" aria-label="${SIZE_TITLE[s]}">${SIZE_LABEL[s]}</button>`).join('')}
          </div>
          <button type="button" class="icon-btn" data-move="-1" data-id="${e.id}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(w.title)} nach vorn" title="Nach vorn">${icon('left', 16).__raw}</button>
          <button type="button" class="icon-btn" data-move="1" data-id="${e.id}" ${i === sichtbar.length - 1 ? 'disabled' : ''} aria-label="${esc(w.title)} nach hinten" title="Nach hinten">${icon('right', 16).__raw}</button>
        </div>
      </div>` : '';
    return `<section class="dash-item w-${e.size}" data-widget="${e.id}"${editing ? ' draggable="true"' : ''} aria-label="${esc(w.title)}">
      ${bar}<div class="dash-body"${editing ? ' inert' : ''}>${w.render(c)}</div>
    </section>`;
  };

  const s = store.db.settings;
  root.innerHTML = html`
    ${editing ? raw(`
    <div class="dash-bar" role="region" aria-label="Übersicht anpassen">
      <div class="dash-bar-text">
        <strong>Übersicht anpassen</strong>
        <span class="small muted">Module an ihren Platz ziehen oder mit den Pfeilen verschieben, die Breite wählen,
        Unnötiges ausblenden. Die Anordnung gilt für dieses Gerät.</span>
      </div>
      <div class="row" style="gap:8px">
        <button type="button" class="btn" id="dashReset">${icon('refresh', 15).__raw} Voreinstellung</button>
        <button type="button" class="btn primary" id="dashDone">${icon('check', 15).__raw} Fertig</button>
      </div>
      <div class="dash-add">
        <span class="small muted">Ausgeblendet:</span>
        ${versteckt.length
          ? versteckt.map((e) => `<button type="button" class="chip" data-show="${e.id}">${icon('plus', 12).__raw} ${esc(WIDGETS[e.id].title)}</button>`).join('')
          : '<span class="small muted">nichts – alle Module sind zu sehen.</span>'}
      </div>
    </div>`) : raw(`
    <div class="page-head">
      <div>
        <h2>${esc(s.companyName || s.ownerName || 'Ihre Buchhaltung')}</h2>
        <p>Gewinnermittlung ${c.db.settings.accountingBasis === 'ist' ? 'nach Zahlungsfluss' : 'nach Rechnungsdatum'}${c.klein ? ' · Kleinunternehmer § 19 UStG' : ''}</p>
      </div>
      <div class="spacer"></div>
      ${scopeToggleHtml(store.db, period.from, period.to).__raw}
      <button type="button" class="btn ghost" id="dashEdit" title="Module anordnen, Größe ändern, ein- und ausblenden">${icon('layout', 16).__raw} Anpassen</button>
    </div>`)}

    <div class="dash${editing ? ' editing' : ''}" id="dashGrid">
      ${raw(sichtbar.map(item).join(''))}
    </div>
    ${sichtbar.length ? '' : raw(`<div class="card">${emptyState('Alle Module sind ausgeblendet', 'Über „Anpassen“ holen Sie sie zurück.').__raw}</div>`)}`;

  mountCharts(root);
  const redraw = () => draw(root);
  if (editing) wireEditing(root, lay, redraw);
  else wireContent(root, redraw);
}

/** Die Bedienung der Module selbst – im Anpassen-Modus ist sie gesperrt. */
function wireContent(root, redraw) {
  wireScopeToggle(root, redraw);
  wireVerlauf(root, redraw);
  wireAnteil(root, 'anteilAusgaben', redraw);
  wireAnteil(root, 'anteilEinnahmen', redraw);
  $('#dashEdit', root)?.addEventListener('click', () => {
    editing = true;
    redraw();
    $('#dashDone', root)?.focus();
  });
  $$('[data-goto]', root).forEach((b) => b.addEventListener('click', () => navigate(b.dataset.goto)));
  const oeffnen = (sel2, fn) => $$(sel2, root).forEach((n) => {
    n.addEventListener('click', () => fn(n));
    n.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); fn(n); } });
  });
  oeffnen('[data-tx]', (n) => openTransactionDialog(n.dataset.tx));
  oeffnen('[data-appt]', (n) => openAppointmentDialog(n.dataset.appt));
  $('#showMissing', root)?.addEventListener('click', () => navigate('transactions', { receipt: 'ohne' }));
}

/** Verschieben, Breite, Aus- und Einblenden. Jede Änderung wird sofort gemerkt. */
function wireEditing(root, lay, redraw) {
  /* Nach dem Neuzeichnen bleibt der Fokus beim selben Bedienelement – oder beim
     ersten der genannten, das noch bedienbar ist. */
  const speichern = (...fokus) => {
    saveDashLayout(lay);
    redraw();
    for (const f of fokus) {
      const n = $(f, root);
      if (n && !n.disabled) { n.focus(); break; }
    }
  };
  $('#dashDone', root).addEventListener('click', () => {
    editing = false;
    redraw();
    $('#dashEdit', root)?.focus();
  });
  $('#dashReset', root).addEventListener('click', () => {
    saveDashLayout(null);
    redraw();
    ok('Voreinstellung wiederhergestellt');
    $('#dashReset', root)?.focus();
  });
  $$('[data-size]', root).forEach((b) => b.addEventListener('click', () => {
    lay.find((e) => e.id === b.dataset.id).size = Number(b.dataset.size);
    speichern(`[data-size="${b.dataset.size}"][data-id="${b.dataset.id}"]`);
  }));
  $$('[data-hide]', root).forEach((b) => b.addEventListener('click', () => {
    lay.find((e) => e.id === b.dataset.hide).hidden = true;
    speichern('#dashDone');
  }));
  $$('[data-show]', root).forEach((b) => b.addEventListener('click', () => {
    lay.find((e) => e.id === b.dataset.show).hidden = false;
    speichern(`[data-hide="${b.dataset.show}"]`);
  }));
  // Pfeile tauschen mit dem nächsten sichtbaren Nachbarn – der Weg ohne Maus.
  $$('[data-move]', root).forEach((b) => b.addEventListener('click', () => {
    const sichtbar = lay.filter((e) => !e.hidden);
    const i = sichtbar.findIndex((e) => e.id === b.dataset.id);
    const j = i + Number(b.dataset.move);
    if (j < 0 || j >= sichtbar.length) return;
    const a = lay.indexOf(sichtbar[i]);
    const z = lay.indexOf(sichtbar[j]);
    [lay[a], lay[z]] = [lay[z], lay[a]];
    const id = b.dataset.id;
    speichern(`[data-move="${b.dataset.move}"][data-id="${id}"]`, `[data-move="${-b.dataset.move}"][data-id="${id}"]`);
  }));

  wireDrag($('#dashGrid', root), (order) => {
    // Die neue Reihenfolge der sichtbaren Module; ausgeblendete behalten ihren Platz dazwischen.
    const sichtbar = order.map((id) => lay.find((e) => e.id === id));
    let k = 0;
    for (let i = 0; i < lay.length; i++) if (!lay[i].hidden) lay[i] = sichtbar[k++];
    speichern();
  });
}

/**
 * Ziehen mit der Maus. Das gezogene Modul rückt schon während des Ziehens an
 * seinen neuen Platz: vor das Modul unter dem Zeiger, wenn der Zeiger in
 * dessen vorderer Hälfte steht, sonst dahinter. Weil nur die Lage des Zeigers
 * zählt, springt nichts hin und her, wenn Module verschieden breit sind.
 */
function wireDrag(grid, onDone) {
  if (!grid) return;
  let drag = null;
  grid.addEventListener('dragstart', (e) => {
    drag = e.target.closest?.('.dash-item');
    if (!drag) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.dataset.widget);
    requestAnimationFrame(() => drag?.classList.add('dragging'));
  });
  grid.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = e.target.closest?.('.dash-item');
    if (!over || over === drag) return;
    const r = over.getBoundingClientRect();
    const breit = r.width > grid.clientWidth * 0.7;
    const vorn = breit ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
    if (vorn && over.previousElementSibling !== drag) over.before(drag);
    else if (!vorn && over.nextElementSibling !== drag) over.after(drag);
  });
  grid.addEventListener('drop', (e) => { if (drag) e.preventDefault(); });
  grid.addEventListener('dragend', () => {
    if (!drag) return;
    drag.classList.remove('dragging');
    drag = null;
    onDone([...grid.querySelectorAll('.dash-item')].map((n) => n.dataset.widget));
  });
}
