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
import { icon, statCard, deltaBadge, compareLabel, rankBars, donut, emptyState, chart, mountCharts, amountCell, ok } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import {
  compareRanges, trend, openItems, accountBalances, balanceSheet,
  receiptCoverage, healthChecks, topCategories, isKleinunternehmer, scopeDb, averages, vatReturn, listedOnly,
} from '../lib/calc.js';
import { steuertermine } from '../lib/fristen.js';
import {
  prefs, scope, scopeToggleHtml, wireScopeToggle, verlaufControls, wireVerlauf, verlaufBody,
  anteilControls, wireAnteil, loadDashLayout, saveDashLayout,
} from '../lib/prefs.js';
import { defaultPeriod, periodControl, resolvePreset } from '../lib/period.js';
import { mountTables } from '../lib/table.js';
import { navigate } from '../lib/router.js';
import { openTransactionDialog } from './transactions.js';
import { openAppointmentDialog } from './calendar.js';
import { openTodosSorted, todoRow, wireTodoRows } from './todos.js';
import { checkNotice, wireCheckLinks, oeffneFrist } from './spruenge.js';
import { offeneVorkommen, faelligeAnbieten } from './wiederkehrend.js';

const period = defaultPeriod();
/** Ist die Übersicht gerade im Anpassen-Modus? Gilt nur bis zum Verlassen der Ansicht. */
let editing = false;

/** Breiten im 12er-Raster: ein Viertel, ein Drittel, die Hälfte, zwei Drittel, drei Viertel, ganze Breite. */
const SIZES = [3, 4, 6, 8, 9, 12];
const SIZE_LABEL = { 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 9: '¾', 12: '1' };
const SIZE_TITLE = { 3: 'ein Viertel', 4: 'ein Drittel', 6: 'halbe Breite', 8: 'zwei Drittel', 9: 'drei Viertel', 12: 'ganze Breite' };

export async function render(root, params, { actions } = {}) {
  editing = false;
  actions.innerHTML = html`<div id="dbPeriod"></div>`;
  periodControl($('#dbPeriod', actions), period, () => draw(root));
  draw(root);
}

/* -------------------------------------------------------------------------- */
/* Module                                                                      */
/* -------------------------------------------------------------------------- */

/** Ø-Angabe unter einer Kennzahl – nur, wenn es mehr als einen Monat gibt. */
function avgFoot(value, avg) {
  return avg.months > 1 ? `<span class="avg-foot" title="Durchschnitt über ${avg.months} Monate">Ø ${esc(money(value))} € je Monat</span>` : '';
}

/* -------------------------------------------------------------------------- */
/* Klickziele                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Jede Zahl und jede Liste der Übersicht führt zu den Daten dahinter. Die
 * Ziele werden beim Zeichnen gesammelt (z) und danach verdrahtet; im HTML
 * steht nur ein Verweis auf ihre Nummer. `haupt` kennzeichnet das Ziel des
 * ganzen Moduls: Ein Klick irgendwo auf die Karte, der nichts anderes trifft,
 * führt dorthin. Mit der Tastatur erreicht man es über die Überschrift.
 */
let ziele = [];

/** Attribute für ein anklickbares Element der Übersicht. */
function z(view, params = {}, { haupt = false, titel = '' } = {}) {
  ziele.push({ view, params });
  return ` data-ziel="${ziele.length - 1}"${haupt ? ' data-haupt' : ''} role="link" tabindex="0"${titel ? ` title="${esc(titel)}"` : ''}`;
}

/** Der Zeitraum der Übersicht – oder ein Teil davon – als Angabe für die Zielansicht. */
const zeitraum = (from = period.from, to = period.to) => ({
  preset: from === period.from && to === period.to ? period.preset : 'benutzerdefiniert', from, to,
});
const gesamt = () => ({ preset: 'alles', ...resolvePreset('alles') });

/**
 * Die Buchungsliste so gefiltert, dass sie die Zahl der Übersicht erklärt:
 * Zahlungen im Zeitraum, ohne nicht gelistete Buchungen, sofern die nicht mitzählen.
 * Alle anderen Filter der Liste werden dafür zurückgesetzt.
 */
const buchungen = (extra = {}) => ({
  neu: true, period: zeitraum(), status: 'alle', datum: 'zahlung', listing: scope.includeUnlisted ? 'alle' : 'gelistet', ...extra,
});
/** Noch unbezahlte Rechnungen oder Belege, unabhängig vom Zeitraum. */
const offenePosten = (type) => buchungen({ type, status: 'offen', datum: 'alle', period: gesamt() });

const monatsende = (ym) => `${ym}-${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;

const euro = (v) => `${esc(money(v))} <span class="muted" style="font-size:15px">€</span>`;

/**
 * Was hinter einer Einnahmen- oder Ausgabenzahl steckt: Zahlungen zu Buchungen
 * aus anderen Zeiträumen sind darin enthalten, noch offene Rechnungen des
 * Zeitraums nicht. Beides führt in die passend gefilterte Buchungsliste.
 */
function paymentFoot(cur, kind) {
  const income = kind === 'income';
  const fremd = cur.otherPeriod[kind];
  const fremdN = cur.otherPeriod[kind + 'Count'];
  const offen = cur.unpaid[kind];
  const offenN = cur.unpaid[kind + 'Count'];
  const [eins, viele] = income ? ['einer Rechnung', 'Rechnungen'] : ['einem Beleg', 'Belegen'];
  let out = '';
  if (fremdN) {
    out += `<button type="button" class="stat-link" data-tx-list="${kind}:fremd"
      title="Im Zeitraum bezahlt, aber mit einem Datum davor oder danach gebucht, etwa eine Restzahlung vor dem Veranstaltungstag. Zählt am Zahlungstag, also hier.">
      inkl. ${esc(money(fremd))} € aus ${fremdN === 1 ? `${eins} eines anderen Zeitraums` : `${fremdN} ${viele} anderer Zeiträume`}</button>`;
  }
  if (offenN) {
    out += `<button type="button" class="stat-link warn" data-tx-list="${kind}:offen"
      title="${income ? 'Rechnungen' : 'Belege'} mit Datum im Zeitraum, die noch nicht bezahlt sind. Sie zählen erst an ihrem Zahlungstag.">
      noch offen: ${esc(money(offen))} € aus ${offenN === 1 ? eins : `${offenN} ${viele}`}</button>`;
  }
  return out;
}

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
    // Veränderung zum Vorzeitraum, im laufenden Zeitraum bis zum gleichen Stand.
    delta: (key) => deltaBadge(trend(cmp().currentToDate[key], cmp().previous[key]), { invert: key === 'expenseForProfit' }).__raw
      + ' ' + compareLabel(cmp()),
    avg: once(() => averages(cmp().current)),
    open: once(() => openItems(db, todayISO())),
    accounts: once(() => accountBalances(db, todayISO())),
    checks: once(() => healthChecks(db, period.from, period.to)),
  };
  return c;
}

const card = (title, body, { head = '', sub = '', tight = false, ziel = '' } = {}) => `
  <div class="card">
    <div class="card-head"><h3${ziel}>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${head ? `<div class="spacer"></div>${head}` : ''}</div>
    <div class="card-body${tight ? ' tight' : ''}">${body}</div>
  </div>`;

function anteil(rows, key, color, center) {
  return (prefs[key] === 'pie'
    ? chart('pie', rows.map((c) => ({ name: c.name, amount: c.amount, id: c.categoryId })), { centerLabel: center, label: `${center} nach Kategorie` })
    : rankBars(rows.slice(0, 7).map((c) => ({ ...c, id: c.categoryId })), { color, total: rows.reduce((t, c) => t + Math.abs(c.amount), 0) })).__raw;
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
      ziel: z('transactions', buchungen({ type: 'income' }), { haupt: true, titel: 'Die Zahlungseingänge dieses Zeitraums ansehen' }),
      foot: c.delta('incomeForProfit')
        + avgFoot(c.avg().income, c.avg())
        + paymentFoot(c.current(), 'income'),
    }).__raw,
  },
  ausgaben: {
    title: 'Ausgaben', size: 3,
    render: (c) => statCard({
      label: 'Ausgaben', icon: 'down', value: euro(c.current().expenseForProfit), tone: 'neg',
      ziel: z('transactions', buchungen({ type: 'expense' }), { haupt: true, titel: 'Die Zahlungsausgänge dieses Zeitraums ansehen' }),
      foot: c.delta('expenseForProfit')
        + avgFoot(c.avg().expense, c.avg())
        + paymentFoot(c.current(), 'expense'),
    }).__raw,
  },
  ergebnis: {
    title: 'Gewinn oder Verlust', size: 3,
    render: (c) => {
      const cur = c.current();
      return statCard({
        label: cur.profit >= 0 ? 'Gewinn' : 'Verlust', icon: 'scale', value: euro(cur.profit), tone: cur.profit >= 0 ? 'pos' : 'neg',
        ziel: z('reports', { tab: 'guv', period: zeitraum() }, { haupt: true, titel: 'Gewinn- und Verlustrechnung öffnen' }),
        foot: (cur.margin !== null ? `<span>Marge ${esc((cur.margin * 100).toFixed(1).replace('.', ','))} %</span>` : '<span>–</span>')
          + avgFoot(c.avg().profit, c.avg()),
      }).__raw;
    },
  },
  ust: {
    title: 'Umsatzsteuer', size: 3, available: (c) => !c.klein,
    render: (c) => {
      const cur = c.current();
      const soll = cur.vatBasis === 'soll';
      return statCard({
        label: cur.vatPayable >= 0 ? 'Umsatzsteuer-Zahllast' : 'Vorsteuer-Erstattung', icon: 'euro',
        value: euro(Math.abs(cur.vatPayable)), tone: cur.vatPayable > 0 ? 'neg' : 'pos',
        ziel: z('reports', { tab: 'ust', period: zeitraum() }, { haupt: true, titel: 'Umsatzsteuer-Voranmeldung öffnen' }),
        foot: `<span>${soll ? 'Umsatzsteuer' : 'vereinnahmt'} ${esc(money(cur.vatIncome))} € · Vorsteuer ${esc(money(cur.vatExpense))} €</span>`
          + `<span class="avg-foot">${soll ? 'nach Rechnungsdatum (Soll-Versteuerung)' : 'nach Zahlungseingang (Ist-Versteuerung)'}</span>`,
      }).__raw;
    },
  },
  kasse: {
    title: 'Kontostände heute', size: 3, hidden: (c) => !c.klein,
    render: (c) => {
      const cash = sum(c.accounts(), (a) => a.balance);
      return statCard({
        label: 'Kontostände heute', icon: 'bank', value: euro(cash), tone: cash >= 0 ? '' : 'neg',
        ziel: z('master', { tab: 'accounts' }, { haupt: true, titel: 'Zu den Zahlungskonten' }),
        foot: `<span>über ${c.accounts().length} Konten</span>`,
      }).__raw;
    },
  },
  verlauf: {
    title: 'Verlauf', size: 8,
    render: (c) => card('Verlauf', verlaufBody(c.current().months, c.avg(), (s) => ymLabel(s.ym), { pick: true }).__raw, {
      sub: 'je Monat',
      ziel: z('reports', { tab: 'guv', period: zeitraum() }, { haupt: true, titel: 'Zur Gewinn- und Verlustrechnung' }),
      head: `${verlaufControls().__raw}<button class="btn sm ghost" data-goto="reports">Details ${icon('right', 13).__raw}</button>`,
    }),
  },
  offen: {
    title: 'Offene Posten', size: 4,
    render: (c) => {
      const open = c.open();
      return card('Offene Posten', `
        <div class="row between" style="align-items:flex-start">
          <div class="stack klick"${z('transactions', offenePosten('income'), { titel: 'Unbezahlte Rechnungen ansehen' })}>
            <span class="muted small">Ihre Forderungen</span>
            <span class="value num" style="font-size:20px;font-weight:650;color:var(--pos)">${esc(money(open.receivableTotal))} €</span>
            <span class="tiny muted">${int(open.receivables.length)} unbezahlte Rechnungen</span>
          </div>
          <div class="stack right klick"${z('transactions', offenePosten('expense'), { titel: 'Offene Rechnungen ansehen' })}>
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
          : '<p class="muted small mb0">Alle Rechnungen sind bezahlt.</p>'}`, {
        ziel: z('reports', { tab: 'opos' }, { haupt: true, titel: 'Liste der offenen Posten öffnen' }),
      });
    },
  },
  ausgabenKat: {
    title: 'Größte Ausgabenblöcke', size: 4,
    render: (c) => card('Größte Ausgabenblöcke', anteil(topCategories(c.current(), 'expense', 50), 'anteilAusgaben', 'var(--neg)', 'Ausgaben'), {
      head: anteilControls('anteilAusgaben').__raw,
      ziel: z('transactions', buchungen({ type: 'expense' }), { haupt: true, titel: 'Alle Ausgaben dieses Zeitraums ansehen' }),
    }),
  },
  einnahmenKat: {
    title: 'Umsatz nach Kategorie', size: 4,
    render: (c) => card('Umsatz nach Kategorie', anteil(topCategories(c.current(), 'income', 50), 'anteilEinnahmen', 'var(--pos)', 'Einnahmen'), {
      head: anteilControls('anteilEinnahmen').__raw,
      ziel: z('transactions', buchungen({ type: 'income' }), { haupt: true, titel: 'Alle Einnahmen dieses Zeitraums ansehen' }),
    }),
  },
  vermoegen: {
    title: 'Konten und Vermögen', size: 4,
    render: (c) => {
      const bs = balanceSheet(c.db, period.to);
      const konten = z('master', { tab: 'accounts' }, { titel: 'Zu den Zahlungskonten' });
      return card('Konten und Vermögen', `
        ${c.accounts().map((a) => `
          <div class="row between klick" style="padding:5px 0"${konten}>
            <span>${icon('bank', 14).__raw} ${esc(a.name)}</span>
            <span class="num strong ${a.balance < 0 ? 'amount neg' : ''}">${esc(money(a.balance))} €</span>
          </div>`).join('')}
        <hr class="sep">
        <div class="row between klick"${z('master', { tab: 'assets' }, { titel: 'Zum Anlagevermögen' })}><span class="muted">Anlagevermögen (Restwert)</span><span class="num">${esc(money(bs.activa.fixedAssets))} €</span></div>
        <div class="row between klick"${z('transactions', offenePosten('income'), { titel: 'Unbezahlte Rechnungen ansehen' })}><span class="muted">Forderungen</span><span class="num">${esc(money(bs.activa.receivables))} €</span></div>
        <div class="row between klick"${z('transactions', offenePosten('expense'), { titel: 'Offene Rechnungen ansehen' })}><span class="muted">Verbindlichkeiten</span><span class="num">− ${esc(money(bs.passiva.payables))} €</span></div>
        <hr class="sep">
        <div class="row between klick"${z('reports', { tab: 'bilanz', period: zeitraum() }, { titel: 'Vermögensübersicht öffnen' })}><strong>Reinvermögen</strong><strong class="num">${esc(money(bs.passiva.equity))} €</strong></div>`, {
        ziel: z('reports', { tab: 'bilanz', period: zeitraum() }, { haupt: true, titel: 'Vermögensübersicht öffnen' }),
      });
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
        ziel: z('calendar', {}, { haupt: true, titel: 'Zum Kalender' }),
        head: `<button class="btn sm ghost" data-goto="calendar">Kalender ${icon('right', 13).__raw}</button>`,
      });
    },
  },
  fristen: {
    // Fristen sind zu wichtig, um in einer schon angepassten Übersicht versteckt zu starten.
    title: 'Steuertermine', size: 4, sichtbarWennNeu: true,
    render: () => {
      const heute = todayISO();
      const termine = steuertermine(store.db.settings, heute, addDays(heute, 150)).slice(0, 5);
      // Beträge wie in den Unterlagen fürs Finanzamt: ohne nicht gelistete Buchungen.
      const amtlich = listedOnly(store.db);
      const body = termine.length ? `<div class="frist-list">${termine.map((t, i) => {
        const tage = Math.round((new Date(`${t.datum}T12:00:00`) - new Date(`${heute}T12:00:00`)) / 86400000);
        const eilig = tage <= 7;
        let betrag = '';
        if (t.zeitraum) {
          const kz83 = vatReturn(amtlich, t.zeitraum.from, t.zeitraum.to).kz83;
          betrag = `<span class="num ${kz83 > 0 ? 'amount neg' : kz83 < 0 ? 'amount pos' : 'muted'}" title="Kennzahl 83 nach dem heutigen Stand">${kz83 < 0 ? 'Erstattung ' : ''}${esc(money(Math.abs(kz83)))} €</span>`;
        }
        return `<div class="row between list-row" data-frist="${i}" role="button" tabindex="0" title="${esc(t.hinweis)}">
          <div style="min-width:0">
            <div class="truncate">${esc(t.titel)}</div>
            <div class="tiny muted">${esc(fmtDate(t.datum))} · ${esc(relativeDays(t.datum))}</div>
          </div>
          <div class="row nowrap" style="gap:8px">${betrag}${eilig ? `<span class="badge warn tiny">${tage <= 0 ? 'heute' : `${tage} T`}</span>` : ''}</div>
        </div>`;
      }).join('')}</div>
        <p class="tiny muted mt8 mb0">Fristen nach § 18 UStG und § 149 AO, verschoben auf den nächsten Werktag. ${store.db.settings.vatDeadline === 'dauerfrist' ? 'Mit Dauerfristverlängerung.' : 'Dauerfristverlängerung unter Einstellungen.'}</p>`
        : emptyState('Keine Termine', 'In den nächsten Monaten steht keine Steuerfrist an.').__raw;
      return card('Steuertermine', body, { sub: 'nächste Fristen', tight: false, ziel: z('calendar', {}, { haupt: true, titel: 'Im Kalender ansehen' }) });
    },
  },
  aufgaben: {
    title: 'Offene Aufgaben', size: 4,
    render: () => {
      const offen = openTodosSorted();
      const body = offen.length
        ? `<div class="todo-mini">${offen.slice(0, 6).map((t) => todoRow(t, { compact: true })).join('')}</div>`
          + (offen.length > 6 ? `<p class="tiny muted mb0 mt8">und ${offen.length - 6} weitere</p>` : '')
        : emptyState('Nichts offen', 'Alle Aufgaben sind erledigt.').__raw;
      return card('Offene Aufgaben', body, {
        sub: offen.length ? String(offen.length) : '',
        ziel: z('todos', {}, { haupt: true, titel: 'Zu allen Aufgaben' }),
        head: `<button class="btn sm ghost" data-goto="todos">Alle ${icon('right', 13).__raw}</button>`,
      });
    },
  },
  ordnung: {
    title: 'Ordnung und Vollständigkeit', size: 4,
    render: (c) => {
      const cov = receiptCoverage(c.db, period.from, period.to);
      const checks = c.checks();
      return card('Ordnung und Vollständigkeit', `
        <div class="row" style="gap:16px;align-items:center">
          <span class="klick"${z('transactions', buchungen({ receipt: 'ohne' }), { titel: 'Buchungen ohne Beleg ansehen' })}>${donut(cov.ratio, { color: cov.ratio > 0.9 ? 'var(--pos)' : cov.ratio > 0.6 ? 'var(--warn)' : 'var(--neg)' }).__raw}</span>
          <div class="stack">
            <strong>Belegquote</strong>
            <span class="small muted">${int(cov.withDoc)} von ${int(cov.total)} Buchungen haben einen Beleg.</span>
            ${cov.missing.length ? `<button class="btn sm mt8" id="showMissing">${cov.missing.length} ohne Beleg anzeigen</button>` : ''}
          </div>
        </div>
        <hr class="sep">
        ${checks.length
          ? checks.map((k, i) => checkNotice(k, i)).join('')
          : '<div class="notice ok">Keine Auffälligkeiten gefunden.</div>'}`, {
        ziel: z('transactions', buchungen({ receipt: cov.missing.length ? 'ohne' : 'alle' }), { haupt: true, titel: cov.missing.length ? 'Buchungen ohne Beleg ansehen' : 'Alle Buchungen des Zeitraums ansehen' }),
      });
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
        ziel: z('transactions', buchungen({ period: gesamt(), datum: 'alle' }), { haupt: true, titel: 'Alle Buchungen ansehen' }),
        head: `<button class="btn sm ghost" data-goto="transactions">Alle ${icon('right', 13).__raw}</button>`,
      });
    },
  },
  durchschnitt: {
    title: 'Durchschnittswerte', size: 6, hidden: true,
    render: (c) => {
      const avg = c.avg();
      const cur = c.current();
      const kpi = (k, v, s = '', ziel = '') => `<div class="klick"${ziel}><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;
      const monat = (m) => (m ? `${esc(ymLabel(m.ym))}: ${esc(money(m.profit))} €` : '–');
      return card('Durchschnittswerte', `
        <div class="kpi-list">
          ${kpi('Einnahmen je Monat', `<span class="amount pos">${esc(money(avg.income))} €</span>`, '', z('transactions', buchungen({ type: 'income' }), { titel: 'Die Einnahmen ansehen' }))}
          ${kpi('Ausgaben je Monat', `<span class="amount neg">${esc(money(avg.expense))} €</span>`, '', z('transactions', buchungen({ type: 'expense' }), { titel: 'Die Ausgaben ansehen' }))}
          ${kpi('Ergebnis je Monat', `<span class="amount ${avg.profit >= 0 ? 'pos' : 'neg'}">${esc(money(avg.profit))} €</span>`, '', z('reports', { tab: 'guv', period: zeitraum() }, { titel: 'Zur Gewinn- und Verlustrechnung' }))}
          ${kpi('Einnahme je Buchung', avg.perIncome === null ? '–' : `${esc(money(avg.perIncome))} €`, `${int(cur.countIncome)} Einnahmen`, z('transactions', buchungen({ type: 'income' }), { titel: 'Die Einnahmen ansehen' }))}
          ${kpi('Ausgabe je Buchung', avg.perExpense === null ? '–' : `${esc(money(avg.perExpense))} €`, `${int(cur.countExpense)} Ausgaben`, z('transactions', buchungen({ type: 'expense' }), { titel: 'Die Ausgaben ansehen' }))}
          ${kpi('Bester Monat', avg.best ? `<span class="small">${monat(avg.best)}</span>` : '–', '', avg.best ? z('transactions', buchungen({ period: zeitraum(`${avg.best.ym}-01`, monatsende(avg.best.ym)) }), { titel: 'Die Buchungen dieses Monats ansehen' }) : '')}
        </div>`, {
        sub: avg.months ? `über ${avg.months} ${avg.months === 1 ? 'Monat' : 'Monate'}` : '',
        ziel: z('reports', { tab: 'guv', period: zeitraum() }, { haupt: true, titel: 'Zur Gewinn- und Verlustrechnung' }),
      });
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Anordnung                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Die gültige Anordnung: die gespeicherte, bereinigt um unbekannte Module
 * und ergänzt um solche, die eine neuere Fassung mitbringt – diese erst
 * einmal ausgeblendet, damit sich nichts ungefragt verschiebt. Ausnahme sind
 * Module mit `sichtbarWennNeu`: Sie kommen sichtbar ans Ende.
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
  for (const d of voreinstellung) if (!seen.has(d.id)) out.push({ ...d, hidden: WIDGETS[d.id].sichtbarWennNeu ? d.hidden : true });
  return out;
}

const available = (id, c) => !WIDGETS[id].available || WIDGETS[id].available(c);

/* -------------------------------------------------------------------------- */
/* Zeichnen                                                                    */
/* -------------------------------------------------------------------------- */

function draw(root) {
  ziele = [];
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
  const faellig = editing ? 0 : offeneVorkommen().length;
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
          : '<span class="small muted">nichts, alle Module sind zu sehen.</span>'}
      </div>
    </div>`) : raw(`
    <div class="page-head">
      <div>
        <h2>${esc(s.companyName || s.ownerName || 'Ihre Buchhaltung')}</h2>
        <p title="Einnahmen, Ausgaben und Gewinn zählen am Tag der Zahlung, wie in der Anlage EÜR. Eine im Zeitraum bezahlte Rechnung zählt also auch dann, wenn ihr Datum außerhalb liegt.">Einnahmen und Ausgaben nach Zahlungsdatum · ${c.klein ? 'Kleinunternehmer § 19 UStG' : c.db.settings.accountingBasis === 'soll' ? 'Umsatzsteuer nach Rechnungsdatum (Soll)' : 'Umsatzsteuer nach Zahlungseingang (Ist)'}</p>
      </div>
      <div class="spacer"></div>
      ${scopeToggleHtml(store.db, period.from, period.to).__raw}
      <button type="button" class="btn ghost" id="dashEdit" title="Module anordnen, Größe ändern, ein- und ausblenden">${icon('layout', 16).__raw} Anpassen</button>
    </div>`)}

    ${faellig ? raw(`<div class="notice warn mb16 row between wrap" style="gap:8px">
      <span>${faellig === 1 ? 'Eine wiederkehrende Buchung ist' : `${int(faellig)} wiederkehrende Buchungen sind`} fällig.</span>
      <button type="button" class="btn sm" id="recDue">${icon('refresh', 14).__raw} Ansehen und anlegen</button></div>`) : ''}

    <div class="dash${editing ? ' editing' : ''}" id="dashGrid">
      ${raw(sichtbar.map(item).join(''))}
    </div>
    ${sichtbar.length ? '' : raw(`<div class="card">${emptyState('Alle Module sind ausgeblendet', 'Über „Anpassen“ holen Sie sie zurück.').__raw}</div>`)}`;

  mountCharts(root);
  mountTables(root);
  const redraw = () => draw(root);
  if (editing) wireEditing(root, lay, redraw);
  else wireContent(root, redraw, c);
}

/** Die Bedienung der Module selbst – im Anpassen-Modus ist sie gesperrt. */
function wireContent(root, redraw, c) {
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
  wireZiele(root);
  const oeffnen = (sel2, fn) => $$(sel2, root).forEach((n) => {
    n.addEventListener('click', () => fn(n));
    n.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); fn(n); } });
  });
  oeffnen('[data-tx]', (n) => openTransactionDialog(n.dataset.tx));
  oeffnen('[data-appt]', (n) => openAppointmentDialog(n.dataset.appt));
  wireTodoRows(root, redraw);
  // „inkl. … aus anderen Zeiträumen“ und „noch offen …“: dieselbe Auswahl als Buchungsliste.
  $$('[data-tx-list]', root).forEach((b) => b.addEventListener('click', () => {
    const [type, was] = b.dataset.txList.split(':');
    navigate('transactions', {
      period: { preset: period.preset, from: period.from, to: period.to },
      type,
      datum: was === 'fremd' ? 'fremd' : 'buchung',
      status: was === 'offen' ? 'offen' : 'alle',
    });
  }));
  $('#showMissing', root)?.addEventListener('click', () => navigate('transactions', { receipt: 'ohne' }));
  $('#recDue', root)?.addEventListener('click', () => faelligeAnbieten().then(redraw));
  if (root.querySelector('[data-check]')) wireCheckLinks(root, c.checks(), period);
  const termine = root.querySelector('[data-frist]') ? steuertermine(store.db.settings, todayISO(), addDays(todayISO(), 150)).slice(0, 5) : [];
  oeffnen('[data-frist]', (n) => oeffneFrist(termine[Number(n.dataset.frist)]));
}

/** Verdrahtet die Klickziele (z) sowie die Säulen und Kategorien der Diagramme (data-pick). */
function wireZiele(root) {
  const gehe = (n) => {
    const ziel = ziele[Number(n.dataset.ziel)];
    if (ziel) navigate(ziel.view, ziel.params);
  };
  $$('[data-ziel]', root).forEach((n) => {
    n.addEventListener('click', () => gehe(n));
    n.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); gehe(n); } });
  });

  // Ein Klick auf eine freie Stelle der Karte führt zum Hauptziel des Moduls.
  $$('.dash-body', root).forEach((body) => {
    const haupt = $('[data-haupt]', body);
    const karte = $('.card', body);
    if (!haupt || !karte) return;
    karte.classList.add('klickbar');
    karte.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select, textarea, label, summary, table, .chart-host, [data-ziel], [data-pick], [role="button"], [role="link"]')) return;
      if (String(window.getSelection?.() ?? '')) return;
      gehe(haupt);
    });
  });

  // Diagramme werden neu gezeichnet; deshalb hängt die Bedienung am Raster, nicht an den Elementen.
  const raster = $('#dashGrid', root);
  const waehlen = (n) => {
    const [art, wert] = n.dataset.pick.split(':');
    if (art === 'kat') {
      const type = n.closest('[data-widget]')?.dataset.widget === 'ausgabenKat' ? 'expense' : 'income';
      navigate('transactions', buchungen({ categoryId: wert, type }));
    } else if (art === 'monat') {
      navigate('transactions', buchungen({ period: zeitraum(`${wert}-01`, monatsende(wert)) }));
    }
  };
  raster.addEventListener('click', (e) => { const n = e.target.closest('[data-pick]'); if (n) waehlen(n); });
  raster.addEventListener('keydown', (e) => {
    const n = e.target.closest?.('[data-pick]');
    if (n && n === e.target && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); waehlen(n); }
  });
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
