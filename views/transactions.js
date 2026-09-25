/** Kontovia – Buchungen erfassen, suchen, bearbeiten. */

import {
  html, raw, esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO, uid, norm,
  sortBy, sum, bytes, splitFromGross, splitFromNet, addDays, int, fmtDateShort, debounce,
} from '../lib/util.js';
import { icon, toast, ok, err, warn, modal, confirmDialog, amountCell, emptyState } from '../lib/ui.js';
import {
  store, sel, upsertTransaction, deleteTransaction, voidTransaction, isLockedDate,
  newTransactionDraft, commit, nextInvoiceNumber, upsertEntity, removeAttachmentRecord,
} from '../lib/store.js';
import { defaultPeriod, periodControl } from '../lib/period.js';
import { openMenu } from '../lib/popover.js';
import { navigate, refresh } from '../lib/router.js';
import { vatTreatment, depositInfo } from '../lib/calc.js';

const api = window.kontovia;
/** Läuft Kontovia im Browser statt in Electron? (src/web/bridge.js) */
const WEB = api?.platform === 'web';

/* Filterzustand bleibt beim Ansichtswechsel erhalten. */
const filters = {
  period: defaultPeriod(),
  search: '',
  type: 'alle',
  categoryId: '',
  accountId: '',
  contactId: '',
  location: '',
  status: 'alle',
  hasReceipt: 'alle',
  listing: 'alle', // alle | gelistet | nicht-gelistet
  sort: 'date',
  dir: -1,
  showVoided: false,
};

/** Die Spaltenfilter ohne Zeitraum und Suche – das, was „Alle Filter zurücksetzen“ leert. */
const COLUMN_FILTERS = {
  type: 'alle', categoryId: '', accountId: '', contactId: '', location: '',
  status: 'alle', hasReceipt: 'alle', listing: 'alle', showVoided: false,
};

const STATUS_TEXT = { offen: 'offen', bezahlt: 'bezahlt', ueberfaellig: 'überfällig' };

/** Die Zeitraumwahl oben rechts; wird neu gezeichnet, wenn der Zeitraum von hier aus springt. */
let periodCtl = null;

const VAT_TREATMENTS = {
  standard: 'Regelbesteuert',
  steuerfrei: 'Steuerfrei / nicht steuerbar',
  'ig-lieferung': 'Innergemeinschaftliche Lieferung',
  'reverse-charge-out': 'Reverse Charge (Leistung ins Ausland)',
  'ig-erwerb': 'Innergemeinschaftlicher Erwerb',
  'reverse-charge-in': 'Reverse Charge (§ 13b, Leistungsempfänger)',
};

/* -------------------------------------------------------------------------- */
/* Filterung                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Buchungen, die zu Zeitraum, Suche und Filtern passen. `except` lässt einen
 * Filter außen vor – so zählt ein Spaltenfilter, wie viele Treffer jede seiner
 * Möglichkeiten zusammen mit allen übrigen Filtern ergäbe.
 */
export function filtered(except = '') {
  const q = norm(filters.search);
  const { from, to } = filters.period;
  const f = except ? { ...filters, [except]: COLUMN_FILTERS[except] } : filters;
  return sel.transactions().filter((t) => {
    if (t.voided && !f.showVoided) return false;
    const d = t.date;
    if (d < from || d > to) return false;
    if (f.type !== 'alle' && t.type !== f.type) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.contactId && t.contactId !== f.contactId) return false;
    if (f.location && (t.location || '') !== f.location) return false;
    if (f.status === 'offen' && t.paidDate) return false;
    if (f.status === 'bezahlt' && !t.paidDate) return false;
    if (f.status === 'ueberfaellig' && (t.paidDate || (t.dueDate || t.date) >= todayISO())) return false;
    if (f.hasReceipt === 'mit' && !(t.attachments || []).length) return false;
    if (f.hasReceipt === 'ohne' && (t.attachments || []).length) return false;
    if (f.listing === 'gelistet' && t.unlisted) return false;
    if (f.listing === 'nicht-gelistet' && !t.unlisted) return false;
    if (q) {
      const hay = norm([t.description, t.invoiceNumber, t.reference, t.notes, t.location,
        sel.categoryName(t.categoryId), sel.contactName(t.contactId), (t.gross / 100).toFixed(2)].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params = {}, { actions } = {}) {
  if (params.focusId) {
    filters.search = '';
    filters.period = { preset: 'alles', from: '1900-01-01', to: '2999-12-31' };
  }
  // Aus der Übersicht heraus lässt sich gefiltert hierher springen,
  // etwa „12 Buchungen ohne Beleg anzeigen“.
  if (params.receipt) filters.hasReceipt = params.receipt;
  if (params.status) filters.status = params.status;
  if (params.categoryId) filters.categoryId = params.categoryId;

  actions.innerHTML = html`
    <div id="txPeriod"></div>
    <button class="btn income" id="newIncome">${icon('plus', 16)} Einnahme</button>
    <button class="btn expense" id="newExpense">${icon('plus', 16)} Ausgabe</button>`;
  periodCtl = periodControl($('#txPeriod', actions), filters.period, () => drawList(root));
  actions.querySelector('#newIncome').addEventListener('click', () => openTransactionDialog(null, 'income'));
  actions.querySelector('#newExpense').addEventListener('click', () => openTransactionDialog(null, 'expense'));

  drawList(root);
  if (params.focusId) setTimeout(() => openTransactionDialog(params.focusId), 60);
}

/** Alle bisher vergebenen Orte – als Filterliste und als Eingabevorschlag. */
export function knownLocations() {
  const set = new Set(sel.transactions().map((t) => String(t.location || '').trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Was in den Spaltenköpfen gefiltert werden kann. Jede Möglichkeit zeigt, wie
 * viele Buchungen sie zusammen mit den übrigen Filtern ergäbe.
 */
function columnMenu(col) {
  const opts = (key, list) => {
    const basis = filtered(key);
    return list.map(([value, label, test, sub]) => ({ value, label, sub, count: basis.filter(test).length }));
  };
  const alle = () => true;
  switch (col) {
    case 'description': {
      const orte = knownLocations();
      return {
        label: 'Nach Ort filtern',
        sections: [{
          key: 'location', title: 'Ort der Leistung', value: filters.location, search: orte.length > 8, hideEmpty: true,
          options: opts('location', [['', 'Alle Orte', alle], ...orte.map((o) => [o, o, (t) => (t.location || '') === o])]),
        }],
      };
    }
    case 'category': {
      const cats = sortBy(sel.categories(), (c) => (c.kind === 'income' ? '0' : '1') + c.name.toLowerCase());
      return {
        label: 'Nach Kategorie filtern',
        sections: [{
          key: 'categoryId', title: 'Kategorie', value: filters.categoryId, search: cats.length > 8, hideEmpty: true,
          options: opts('categoryId', [['', 'Alle Kategorien', alle],
            ...cats.map((c) => [c.id, c.name, (t) => t.categoryId === c.id, c.kind === 'income' ? 'Einnahme' : 'Ausgabe'])]),
        }],
      };
    }
    case 'contact': {
      const kontakte = sortBy(sel.contacts(), (c) => c.name.toLowerCase());
      return {
        label: 'Nach Kontakt filtern',
        sections: [{
          key: 'contactId', title: 'Kunde oder Lieferant', value: filters.contactId, search: kontakte.length > 8, hideEmpty: true,
          options: opts('contactId', [['', 'Alle Kontakte', alle], ...kontakte.map((c) => [c.id, c.name, (t) => t.contactId === c.id])]),
        }],
      };
    }
    case 'status': {
      const heute = todayISO();
      const unlisted = filters.listing !== 'alle' || sel.transactions().some((t) => t.unlisted);
      return {
        label: 'Nach Status filtern',
        sections: [
          {
            key: 'status', title: 'Zahlung', value: filters.status,
            options: opts('status', [
              ['alle', 'Jeder Zahlstatus', alle],
              ['offen', 'Offen', (t) => !t.paidDate],
              ['bezahlt', 'Bezahlt', (t) => !!t.paidDate],
              ['ueberfaellig', 'Überfällig', (t) => !t.paidDate && (t.dueDate || t.date) < heute],
            ]),
          },
          unlisted && {
            key: 'listing', title: 'Finanzamt-Unterlagen', value: filters.listing,
            options: opts('listing', [
              ['alle', 'Gelistete und nicht gelistete', alle],
              ['gelistet', 'Nur gelistete', (t) => !t.unlisted],
              ['nicht-gelistet', 'Nur nicht gelistete', (t) => !!t.unlisted],
            ]),
          },
          {
            key: 'showVoided', title: 'Stornierte Buchungen', value: filters.showVoided ? 'ja' : 'nein',
            options: [
              { value: 'nein', label: 'Ausblenden' },
              { value: 'ja', label: 'Einblenden', count: filtered('showVoided').filter((t) => t.voided).length },
            ],
          },
        ],
      };
    }
    case 'amount':
      return {
        label: 'Nach Art filtern',
        sections: [{
          key: 'type', title: 'Art der Buchung', value: filters.type,
          options: opts('type', [['alle', 'Einnahmen und Ausgaben', alle],
            ['income', 'Nur Einnahmen', (t) => t.type === 'income'], ['expense', 'Nur Ausgaben', (t) => t.type === 'expense']]),
        }],
      };
    case 'receipt':
      return {
        label: 'Nach Beleg filtern',
        sections: [{
          key: 'hasReceipt', title: 'Beleg', value: filters.hasReceipt,
          options: opts('hasReceipt', [['alle', 'Mit und ohne Beleg', alle],
            ['mit', 'Mit Beleg', (t) => (t.attachments || []).length > 0], ['ohne', 'Ohne Beleg', (t) => !(t.attachments || []).length]]),
        }],
      };
    default: return null;
  }
}

/** Die gesetzten Spaltenfilter als Chips – was gerade wirkt, soll man sehen. */
function activeFilters() {
  const out = [];
  if (filters.type !== 'alle') out.push(['type', filters.type === 'income' ? 'Nur Einnahmen' : 'Nur Ausgaben', 'amount']);
  if (filters.categoryId) out.push(['categoryId', `Kategorie: ${sel.categoryName(filters.categoryId)}`, 'category']);
  if (filters.contactId) out.push(['contactId', `Kontakt: ${sel.contactName(filters.contactId)}`, 'contact']);
  if (filters.accountId) out.push(['accountId', `Konto: ${sel.accounts().find((a) => a.id === filters.accountId)?.name || '–'}`, '']);
  if (filters.location) out.push(['location', `Ort: ${filters.location}`, 'description']);
  if (filters.status !== 'alle') out.push(['status', `Status: ${STATUS_TEXT[filters.status] || filters.status}`, 'status']);
  if (filters.listing !== 'alle') out.push(['listing', filters.listing === 'gelistet' ? 'Nur gelistete' : 'Nur nicht gelistete', 'status']);
  if (filters.showVoided) out.push(['showVoided', 'Mit stornierten', 'status']);
  if (filters.hasReceipt !== 'alle') out.push(['hasReceipt', filters.hasReceipt === 'mit' ? 'Mit Beleg' : 'Ohne Beleg', 'receipt']);
  return out;
}

function drawList(root) {
  // Wurde der letzte Beleg zu einem Ort geändert, fällt der Ort aus der Liste –
  // ein Filter darauf würde sonst unsichtbar weiterwirken.
  if (filters.location && !knownLocations().includes(filters.location)) filters.location = '';
  const rows = sortBy(filtered(), (t) => {
    if (filters.sort === 'amount') return t.gross;
    if (filters.sort === 'category') return sel.categoryName(t.categoryId);
    if (filters.sort === 'contact') return sel.contactName(t.contactId);
    return t[filters.sort] ?? '';
  }, filters.dir);

  const income = rows.filter((t) => t.type === 'income');
  const expense = rows.filter((t) => t.type === 'expense');
  const sumIncome = sum(income, (t) => t.gross);
  const sumExpense = sum(expense, (t) => t.gross);
  const openCount = rows.filter((t) => !t.paidDate).length;
  const unlistedCount = rows.filter((t) => t.unlisted && !t.voided).length;
  const aktiv = activeFilters();

  root.innerHTML = html`
    <div class="card">
      <div class="filters">
        <input type="search" class="search" id="txSearch" placeholder="Suchen: Text, Rechnungsnummer, Betrag …" value="${filters.search}" aria-label="Buchungen durchsuchen">
        <div class="spacer"></div>
        <div class="tx-sum" aria-live="polite">
          <span><strong>${int(rows.length)}</strong> <span class="muted">${rows.length === 1 ? 'Buchung' : 'Buchungen'}</span></span>
          <span><span class="muted">Einnahmen</span> <strong class="amount pos">${money(sumIncome)} €</strong></span>
          <span><span class="muted">Ausgaben</span> <strong class="amount neg">${money(sumExpense)} €</strong></span>
          <span><span class="muted">Saldo</span> <strong class="amount ${sumIncome - sumExpense >= 0 ? 'pos' : 'neg'}">${money(sumIncome - sumExpense)} €</strong></span>
          ${openCount ? raw(`<span class="badge warn">${openCount} offen</span>`) : ''}
          ${unlistedCount ? raw(`<span class="badge unlisted" title="In den Summen enthalten, in Finanzamt-Unterlagen nicht">${unlistedCount} nicht gelistet</span>`) : ''}
        </div>
      </div>

      ${aktiv.length ? raw(`
      <div class="filter-chips" role="group" aria-label="Gesetzte Filter">
        <span class="muted small">${icon('filter', 13).__raw} Gefiltert:</span>
        ${aktiv.map(([key, text]) => `<span class="chip active">${esc(text)}<button type="button" class="chip-x" data-clear="${esc(key)}" aria-label="Filter „${esc(text)}“ entfernen" title="Filter entfernen">${icon('x', 12).__raw}</button></span>`).join('')}
        ${aktiv.length > 1 || filters.search ? '<button type="button" class="btn sm ghost" id="resetFilter">Alle Filter zurücksetzen</button>' : ''}
      </div>`) : ''}

      <div class="table-wrap">
        ${sel.transactions().length ? raw(tableHtml(rows))
          : emptyState(
            'Noch keine Buchungen',
            'Erfassen Sie Ihre erste Einnahme oder Ausgabe – oben rechts.',
            '<button class="btn primary mt16" data-first>Erste Buchung anlegen</button>',
          )}
      </div>
    </div>`;

  /* Verdrahtung */
  const search = $('#txSearch', root);
  search.addEventListener('input', debounce(() => {
    filters.search = search.value;
    const pos = search.selectionStart;
    drawList(root);
    const neu = $('#txSearch', root);
    neu.focus();
    try { neu.setSelectionRange(pos, pos); } catch { /* Schreibmarke ans Ende ist auch in Ordnung */ }
  }, 120));

  $$('[data-clear]', root).forEach((b) => b.addEventListener('click', () => {
    filters[b.dataset.clear] = COLUMN_FILTERS[b.dataset.clear];
    drawList(root);
    ($('.chip-x', root) || $('#txSearch', root)).focus();
  }));
  $('#resetFilter', root)?.addEventListener('click', () => {
    Object.assign(filters, COLUMN_FILTERS, { search: '' });
    drawList(root);
    $('#txSearch', root).focus();
  });
  // Findet gar nichts mehr, setzt dieser Knopf auch den Zeitraum zurück.
  $('[data-reset]', root)?.addEventListener('click', () => {
    Object.assign(filters, COLUMN_FILTERS, { search: '' });
    Object.assign(filters.period, defaultPeriod());
    periodCtl?.update();
    drawList(root);
  });
  $('[data-first]', root)?.addEventListener('click', () => openTransactionDialog(null, 'expense'));

  $$('[data-sort]', root).forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    if (filters.sort === key) filters.dir = -filters.dir;
    else { filters.sort = key; filters.dir = key === 'date' ? -1 : 1; }
    drawList(root);
    $(`[data-sort="${key}"]`, root)?.focus();
  }));

  $$('[data-filter]', root).forEach((b) => b.addEventListener('click', () => {
    const col = b.dataset.filter;
    const menu = columnMenu(col);
    if (!menu) return;
    openMenu(b, {
      ...menu,
      align: b.closest('th')?.classList.contains('num') || col === 'receipt' ? 'end' : 'start',
      onPick: (key, val) => {
        filters[key] = key === 'showVoided' ? val === 'ja' : val;
        drawList(root);
        $(`[data-filter="${col}"]`, root)?.focus();
      },
    });
  }));

  $$('tr[data-id]', root).forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openTransactionDialog(tr.dataset.id);
    });
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === tr) openTransactionDialog(tr.dataset.id);
    });
  });

  $$('[data-pay]', root).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tx = sel.transaction(b.dataset.pay);
    // Das Zahlungsdatum bestimmt bei der Ist-Besteuerung, in welchen Zeitraum
    // die Buchung fällt. Es nachträglich in einem festgeschriebenen Zeitraum
    // zu setzen, würde eine bereits abgeschlossene Periode verändern.
    if (isLockedDate(tx.date) || isLockedDate(todayISO())) {
      err('Zeitraum ist festgeschrieben', 'Das Zahlungsdatum lässt sich hier nicht mehr nachtragen.');
      return;
    }
    await upsertTransaction({ ...tx, paidDate: todayISO() });
    ok('Als bezahlt vermerkt', `${tx.description} · heute`);
    drawList(root);
  }));
}

/**
 * Spaltenkopf mit Sortierknopf und – wo es etwas zu filtern gibt – einem
 * Trichter. Ein gesetzter Filter färbt den Trichter ein.
 */
function th(label, { sort = '', filter = '', on = false, width = '', cls = '', title = '' } = {}) {
  const arrow = sort && filters.sort === sort ? (filters.dir === 1 ? ' ▲' : ' ▼') : '';
  const sortBtn = sort
    ? `<button type="button" class="th-sort" data-sort="${sort}" title="Nach ${esc(label)} sortieren">${esc(label)}${arrow}</button>`
    : `<span>${esc(label)}</span>`;
  const name = title || FILTER_TITLES[filter];
  const filterBtn = filter
    ? `<button type="button" class="th-filter${on ? ' on' : ''}" data-filter="${filter}" aria-haspopup="dialog" aria-expanded="false"
        aria-label="${esc(name)}${on ? ' (aktiv)' : ''}" title="${esc(name)}">${icon('filter', 13).__raw}</button>`
    : '';
  const sortiert = sort && filters.sort === sort ? ` aria-sort="${filters.dir === 1 ? 'ascending' : 'descending'}"` : '';
  return `<th class="${cls}"${sortiert}${width ? ` style="width:${width}"` : ''}><div class="th">${label ? sortBtn : ''}${filterBtn}</div></th>`;
}

const FILTER_TITLES = {
  description: 'Nach Ort filtern', category: 'Nach Kategorie filtern', contact: 'Nach Kontakt filtern',
  status: 'Nach Status filtern', amount: 'Nach Art filtern (Einnahmen/Ausgaben)', receipt: 'Nach Beleg filtern',
};

function tableHtml(rows) {
  const klein = store.db.settings.taxMode === 'kleinunternehmer';
  const orte = filters.location || knownLocations().length;
  const statusOn = filters.status !== 'alle' || filters.listing !== 'alle' || filters.showVoided;
  return html`
    <table class="data fixed">
      <thead>
        <tr>
          ${raw(th('Datum', { sort: 'date', width: '92px' }))}
          ${raw(th('Beleg-Nr.', { width: '82px', cls: 'col-nr' }))}
          ${raw(th('Beschreibung', { sort: 'description', filter: orte ? 'description' : '', on: !!filters.location }))}
          ${raw(th('Kategorie', { sort: 'category', filter: 'category', on: !!filters.categoryId, width: '150px' }))}
          ${raw(th('Kontakt', { sort: 'contact', filter: sel.contacts().length ? 'contact' : '', on: !!filters.contactId, width: '120px', cls: 'col-kontakt' }))}
          ${raw(th('Status', { filter: 'status', on: statusOn, width: '132px' }))}
          ${klein ? '' : raw('<th class="num" style="width:92px">Netto</th><th class="num col-ust" style="width:78px">USt</th>')}
          ${raw(th('Brutto', { sort: 'amount', filter: 'amount', on: filters.type !== 'alle', width: '118px', cls: 'num' }))}
          ${raw(th('', { filter: 'receipt', on: filters.hasReceipt !== 'alle', width: '40px', cls: 'center' }))}
        </tr>
      </thead>
      <tbody>
        ${raw(rows.map((t) => rowHtml(t, klein)).join('') || `<tr class="empty-row"><td colspan="${klein ? 8 : 10}">${emptyState(
          'Keine Treffer',
          'Keine Buchung passt zu Zeitraum, Suche und Filtern.',
          '<button class="btn mt16" data-reset>Filter und Zeitraum zurücksetzen</button>',
        ).__raw}</td></tr>`)}
      </tbody>
    </table>`;
}

function rowHtml(t, klein) {
  const cat = sel.category(t.categoryId);
  const overdue = !t.paidDate && (t.dueDate || t.date) < todayISO();
  const status = t.paidDate
    ? `<span class="badge pos">bezahlt ${esc(fmtDateShort(t.paidDate))}</span>`
    : overdue
      ? `<span class="badge neg">überfällig</span>`
      : `<span class="badge warn">offen</span>`;
  const receipts = (t.attachments || []).length;
  const dep = depositInfo(t);
  return `
    <tr data-id="${esc(t.id)}" class="clickable ${t.voided ? 'void' : ''} ${t.unlisted ? 'unlisted' : ''}" tabindex="0">
      <td class="nowrap">${esc(fmtDate(t.date))}</td>
      <td class="tiny muted nowrap col-nr">${esc(t.invoiceNumber || '')}</td>
      <td>
        <div class="truncate">${esc(t.description || '(ohne Beschreibung)')}</div>
        ${t.unlisted ? `<span class="badge unlisted tiny" title="Erscheint nicht in Finanzamt-Export, EÜR, Umsatzsteuer und DATEV">${icon('hide', 11).__raw} nicht gelistet</span>` : ''}
        ${t.location ? `<div class="tiny muted truncate">${icon('pin', 11).__raw} ${esc(t.location)}</div>` : ''}
        ${dep ? `<span class="badge info tiny" title="${esc(depositTitle(dep))}">Anzahlung${dep.percent ? ' ' + esc(percentText(dep.percent)) + ' %' : ''}</span>` : ''}
        ${t.isReversal ? '<span class="badge tiny">Storno</span>' : ''}
        ${t.assetId ? '<span class="badge info tiny">aktiviert</span>' : ''}
      </td>
      <td class="small truncate"><span class="dot" style="background:hsl(${cat ? hue(cat.name) : 0} 55% 55%);margin-right:6px"></span>${esc(cat?.name || '–')}</td>
      <td class="small truncate col-kontakt">${esc(sel.contactName(t.contactId))}</td>
      <td>${status}${!t.paidDate && !t.voided ? `<button class="btn sm ghost" data-pay="${esc(t.id)}" title="Als heute bezahlt markieren">${icon('check', 13).__raw}</button>` : ''}</td>
      ${klein ? '' : `<td class="num">${esc(money(t.net))}</td><td class="num muted col-ust">${t.vat ? esc(money(t.vat)) : '–'}</td>`}
      <td class="num">${amountCell(t.gross, t.type).__raw}</td>
      <td class="center">${receipts ? `<span title="${receipts} Beleg(e)">${icon('paperclip', 14).__raw}</span>` : ''}</td>
    </tr>`;
}

/** Prozentwerte werden mit deutschem Dezimalkomma ein- und ausgegeben. */
function parsePercent(input) {
  const n = Number(String(input ?? '').replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function percentText(p) {
  return p ? String(p).replace('.', ',') : '';
}

function depositTitle(dep) {
  const teile = [`Anzahlung ${percentText(dep.percent)} % von ${money(dep.total)} €`];
  if (dep.remaining) teile.push(`Restbetrag ${money(dep.remaining)} €`);
  if (dep.eventDate) teile.push(`Termin ${fmtDate(dep.eventDate)}`);
  return teile.join(' · ');
}

function hue(text) {
  let h = 0;
  for (let i = 0; i < String(text).length; i++) h = (h * 31 + String(text).charCodeAt(i)) % 360;
  return h;
}

/* -------------------------------------------------------------------------- */
/* Erfassungsdialog                                                            */
/* -------------------------------------------------------------------------- */

export function openTransactionDialog(id, type = 'expense') {
  // `id` darf eine Kennung, null (neu) oder ein fertiger Entwurf (Duplikat) sein.
  const draft = id && typeof id === 'object' ? id : null;
  const existing = draft ? null : (id ? sel.transaction(id) : null);
  const tx = existing ? structuredClone(existing) : (draft || newTransactionDraft(type));
  const isNew = !existing;
  type = tx.type;
  const klein = store.db.settings.taxMode === 'kleinunternehmer';
  const locked = existing && isLockedDate(existing.date);

  /* Belege, die in diesem Dialog neu hinzugekommen sind – bei Abbruch wieder weg. */
  const addedAttachments = [];
  let attachments = (tx.attachments || []).map(sel.attachment).filter(Boolean);
  let inputMode = 'gross';
  /* Stand nach dem ersten Zeichnen; weicht die Eingabe davon ab, fragt das
     Fenster vor dem Wegklicken nach. */
  let ausgangslage = null;

  const m = modal({
    title: isNew ? (type === 'income' ? 'Neue Einnahme' : 'Neue Ausgabe') : 'Buchung bearbeiten',
    size: 'wide',
    body: '<div id="txForm"></div>',
    foot: `
      <div class="left row" style="gap:8px">
        ${!isNew ? `<button class="btn danger sm" id="btnDelete">${icon('trash', 14).__raw} Löschen</button>` : ''}
        ${!isNew && !tx.voided ? `<button class="btn sm" id="btnVoid">Stornieren</button>` : ''}
        ${!isNew ? `<button class="btn sm" id="btnDuplicate">${icon('copy', 14).__raw} Duplizieren</button>` : ''}
      </div>
      <button class="btn" id="btnCancel">Abbrechen</button>
      <button class="btn primary" id="btnSave">${isNew ? 'Buchung anlegen' : 'Änderungen speichern'}</button>`,
    onClose: () => cleanupUnsaved(),
    confirmDismiss: () => {
      if (ausgangslage === null || saved) return false;
      collect();
      return JSON.stringify(tx) !== ausgangslage || addedAttachments.length > 0;
    },
  });

  async function cleanupUnsaved() {
    for (const a of addedAttachments) {
      if (!saved) { try { await api.attach.remove(a.id); } catch { /* egal */ } }
    }
  }
  let saved = false;

  const form = m.root.querySelector('#txForm');

  function draw() {
    const cats = sel.activeCategories(tx.type);
    const orte = knownLocations();
    const treat = vatTreatment(store.db, tx);
    const linkedAppts = sel.appointments().filter((a) => (a.transactionIds || []).includes(tx.id));
    const asset = tx.assetId ? sel.assets().find((a) => a.id === tx.assetId) : null;

    form.innerHTML = html`
      ${locked ? raw(`<div class="notice warn mb16">Diese Buchung liegt im festgeschriebenen Zeitraum (bis ${esc(store.db.locks.at(-1)?.until || '')}). Sie kann nicht mehr geändert, sondern nur noch storniert werden.</div>`) : ''}
      ${tx.voided ? raw('<div class="notice danger mb16">Diese Buchung wurde storniert und wirkt sich nicht mehr auf Auswertungen aus.</div>') : ''}

      <div class="seg mb16">
        <button data-type="expense" class="expense ${tx.type === 'expense' ? 'active' : ''}">Ausgabe</button>
        <button data-type="income" class="income ${tx.type === 'income' ? 'active' : ''}">Einnahme</button>
      </div>

      <div class="form-grid">
        <div class="field full">
          <label>Beschreibung *</label>
          <input id="i_description" value="${esc(tx.description)}" placeholder="${tx.type === 'income' ? 'z. B. Rechnung 2025-0042, Website-Relaunch' : 'z. B. Bürostühle, Bahnfahrt Berlin'}">
        </div>

        <div class="field">
          <label>${tx.type === 'income' ? 'Rechnungsdatum' : 'Belegdatum'} *</label>
          <input type="date" id="i_date" value="${tx.date}">
        </div>
        <div class="field">
          <label>Kategorie *</label>
          <select id="i_categoryId">
            <option value="">– bitte wählen –</option>
            ${raw(cats.map((c) => `<option value="${esc(c.id)}" ${tx.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}${c.euerLine ? ` · EÜR ${c.euerLine}` : ''}</option>`).join(''))}
          </select>
        </div>

        <div class="field">
          <label>${tx.type === 'income' ? 'Kunde' : 'Lieferant'}</label>
          <div class="row" style="gap:6px">
            <select id="i_contactId" style="flex:1">
              <option value="">– keiner –</option>
              ${raw(sel.contacts().map((c) => `<option value="${esc(c.id)}" ${tx.contactId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
            </select>
            <button class="btn sm" id="btnNewContact" title="Neuen Kontakt anlegen">${icon('plus', 14)}</button>
          </div>
        </div>
        <div class="field">
          <label>Zahlungskonto</label>
          <select id="i_accountId">
            <option value="">– keins –</option>
            ${raw(sel.accounts().map((a) => `<option value="${esc(a.id)}" ${tx.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join(''))}
          </select>
        </div>
        ${tx.type === 'income' ? raw(`
        <div class="field full">
          <label>Ort</label>
          <input id="i_location" list="ortListe" value="${esc(tx.location || '')}" placeholder="z. B. Schloss Elmau, Garmisch">
          <datalist id="ortListe">${orte.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>
          <span class="hint">Wo die Leistung erbracht wurde. Die Liste schlägt bereits verwendete Orte vor; in der Buchungsliste lässt sich danach filtern.</span>
        </div>`) : ''}
      </div>

      <div class="card mt8" style="background:var(--surface-2)">
        <div class="card-body">
          <div class="row between mb8">
            <strong style="font-size:13px">Betrag</strong>
            ${klein ? raw('<span class="badge">Kleinunternehmer – keine Umsatzsteuer</span>') : raw(`
              <div class="seg">
                <button data-mode="gross" class="${inputMode === 'gross' ? 'active' : ''}">Brutto eingeben</button>
                <button data-mode="net" class="${inputMode === 'net' ? 'active' : ''}">Netto eingeben</button>
              </div>`)}
          </div>
          <div class="form-grid c3">
            <div class="field">
              <label>${klein ? 'Betrag' : inputMode === 'gross' ? 'Bruttobetrag' : 'Nettobetrag'} *</label>
              <input class="money-input" id="i_amount" value="${moneyInput(inputMode === 'gross' || klein ? tx.gross : tx.net)}" placeholder="0,00" inputmode="decimal">
            </div>
            ${klein ? '' : raw(`
            <div class="field">
              <label>Umsatzsteuersatz</label>
              <select id="i_vatRate">
                ${[19, 7, 0].map((r) => `<option value="${r}" ${Number(tx.vatRate) === r ? 'selected' : ''}>${r} %</option>`).join('')}
              </select>
            </div>`)}
            <div class="field">
              <label>Rechnungs-/Belegnummer</label>
              <div class="row" style="gap:6px">
                <input id="i_invoiceNumber" value="${esc(tx.invoiceNumber || '')}" style="flex:1">
                ${tx.type === 'income' ? raw('<button class="btn sm" id="btnNextNo" title="Nächste freie Nummer">#</button>') : ''}
              </div>
            </div>
          </div>
          <div class="row" id="amountSummary" style="gap:22px;font-size:13px;padding-top:2px"></div>
        </div>
      </div>

      ${tx.type === 'income' ? raw(`
      <div class="card mt8" style="background:var(--surface-2)">
        <div class="card-body">
          <label class="check">
            <input type="checkbox" id="i_isDeposit" ${tx.isDeposit ? 'checked' : ''}>
            <strong style="font-size:13px">Anzahlung auf einen späteren Termin</strong>
          </label>
          <div id="depositBox" ${tx.isDeposit ? '' : 'style="display:none"'}>
            <div class="form-grid mt8">
              <div class="field">
                <label>Termin der Veranstaltung</label>
                <input type="date" id="i_eventDate" value="${esc(tx.eventDate || '')}">
                <span class="hint">Bei Hochzeiten das Hochzeitsdatum. Der Termin erscheint im Kalender.</span>
              </div>
              <div class="field">
                <label>Anteil der Anzahlung</label>
                <div class="row" style="gap:6px">
                  <input id="i_depositPercent" inputmode="decimal" style="flex:1;min-width:60px" value="${esc(percentText(tx.depositPercent))}" placeholder="30">
                  <span class="muted">%</span>
                  ${[20, 30, 50].map((v) => `<button class="btn sm" data-pct="${v}">${v} %</button>`).join('')}
                </div>
                <span class="hint">Anteil am vereinbarten Gesamtbetrag.</span>
              </div>
            </div>
            <div id="depositSummary" class="mt8"></div>
          </div>
        </div>
      </div>`) : ''}

      <div class="form-grid mt16">
        <div class="field">
          <label>Zahlung</label>
          <div class="row" style="gap:8px">
            <label class="check"><input type="checkbox" id="i_isPaid" ${tx.paidDate ? 'checked' : ''}> bezahlt am</label>
            <input type="date" id="i_paidDate" value="${tx.paidDate || todayISO()}" ${tx.paidDate ? '' : 'disabled'} style="flex:1">
          </div>
          <span class="hint">${store.db.settings.accountingBasis === 'ist'
            ? 'Bei der Einnahmen-Überschuss-Rechnung zählt dieses Datum für den Gewinn.'
            : 'Sie rechnen nach Rechnungsdatum – dieses Feld dient der Liquiditätsübersicht.'}</span>
        </div>
        <div class="field">
          <label>Fällig am</label>
          <div class="row" style="gap:6px">
            <input type="date" id="i_dueDate" value="${tx.dueDate || ''}" style="flex:1">
            <button class="btn sm" data-due="14" title="14 Tage ab Belegdatum">+14 T</button>
            <button class="btn sm" data-due="30" title="30 Tage ab Belegdatum">+30 T</button>
          </div>
        </div>
      </div>

      <div class="mt8">
        <label class="check" title="Erscheint nicht in Export &amp; Finanzamt, EÜR, Umsatzsteuer und DATEV">
          <input type="checkbox" id="i_unlisted" ${tx.unlisted ? 'checked' : ''}>
          <span>Nicht gelistet <span class="muted">– nur zur eigenen Übersicht, nicht in Finanzamt-Unterlagen</span></span>
        </label>
        <div class="notice warn mt8" id="unlistedHint" ${tx.unlisted ? '' : 'style="display:none"'}>
          Diese Buchung fehlt in allen Exporten für Finanzamt und Steuerkanzlei (EÜR, Umsatzsteuer,
          DATEV, Betriebsprüfung). In Übersicht und Auswertungen zählt sie nur, wenn dort
          <strong>„Nicht gelistete Buchungen einbeziehen“</strong> gesetzt ist. Gedacht für Vorgänge,
          die steuerlich nicht zum Betrieb gehören – betriebliche Einnahmen und Ausgaben müssen
          vollständig erklärt werden (§ 146 Abs. 1 AO).
        </div>
      </div>

      <details class="mt8" ${(tx.notes || tx.reference || tx.vatTreatment || asset) ? 'open' : ''}>
        <summary class="small muted" style="cursor:pointer;padding:6px 0">Weitere Angaben</summary>
        <div class="form-grid mt8">
          <div class="field">
            <label>Referenz / Verwendungszweck</label>
            <input id="i_reference" value="${esc(tx.reference || '')}">
          </div>
          ${klein ? '' : raw(`
          <div class="field">
            <label>Umsatzsteuerliche Behandlung</label>
            <select id="i_vatTreatment">
              ${Object.entries(VAT_TREATMENTS).map(([k, v]) => `<option value="${k}" ${treat === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
            <span class="hint">Bestimmt, in welche Kennzahl der Umsatzsteuer-Voranmeldung der Betrag fließt.</span>
          </div>`)}
          <div class="field full">
            <label>Notiz</label>
            <textarea id="i_notes" placeholder="Interne Bemerkung, betrieblicher Anlass bei Bewirtung, …">${esc(tx.notes || '')}</textarea>
          </div>
        </div>

        ${tx.type === 'expense' ? raw(`
        <div class="field">
          <label>Anlagevermögen</label>
          ${asset
            ? `<div class="notice ok">Diese Anschaffung wird über <strong>${esc(asset.name)}</strong> abgeschrieben
                 (${esc(money(asset.cost))} € über ${esc(asset.usefulLifeYears)} Jahre).
                 <button class="btn sm mt8" id="btnUnlinkAsset">Verknüpfung lösen</button></div>`
            : `<div class="row" style="gap:8px">
                 <button class="btn sm" id="btnMakeAsset">Als Anlagegut abschreiben …</button>
                 <span class="hint">Für Anschaffungen über 800 € netto, die über mehrere Jahre genutzt werden.</span>
               </div>`}
        </div>`) : ''}
      </details>

      <hr class="sep">

      <div class="row between mb8">
        <strong style="font-size:13px">Belege</strong>
        <span class="muted tiny">Verschlüsselt gespeichert, max. 40 MB je Datei</span>
      </div>
      <div class="attach-list mb8" id="attachList"></div>
      <div class="dropzone" id="dropzone">
        ${icon('paperclip', 16)} Rechnung hierher ziehen oder <u>Datei auswählen</u>
      </div>

      ${linkedAppts.length ? raw(`
        <hr class="sep">
        <div class="row between mb8"><strong style="font-size:13px">Verknüpfte Termine</strong></div>
        ${linkedAppts.map((a) => `<div class="attach"><span>${icon('calendar', 14).__raw}</span><span class="name">${esc(a.title)} · ${esc(fmtDate(a.date))}</span></div>`).join('')}
      `) : ''}`;

    drawAttachments();
    updateAmountSummary();
    wireForm();
  }

  /* ---------------------------------------------------------------------- */

  function collect() {
    const g = (id) => form.querySelector('#i_' + id);
    tx.description = g('description').value.trim();
    tx.date = g('date').value || todayISO();
    tx.categoryId = g('categoryId').value;
    tx.contactId = g('contactId').value;
    tx.accountId = g('accountId').value;
    tx.invoiceNumber = g('invoiceNumber').value.trim();
    tx.dueDate = g('dueDate').value;
    tx.paidDate = g('isPaid').checked ? (g('paidDate').value || todayISO()) : '';
    tx.reference = g('reference')?.value.trim() || '';
    tx.notes = g('notes')?.value.trim() || '';
    tx.unlisted = !!g('unlisted')?.checked;
    // Ort und Anzahlung gibt es nur bei Einnahmen; wechselt die Art, fallen sie weg.
    if (tx.type === 'income') {
      tx.location = g('location') ? g('location').value.trim() : (tx.location || '');
      tx.isDeposit = !!g('isDeposit')?.checked;
      tx.depositPercent = tx.isDeposit ? parsePercent(g('depositPercent')?.value) : 0;
      tx.eventDate = tx.isDeposit ? (g('eventDate')?.value || '') : '';
    } else {
      tx.location = '';
      tx.isDeposit = false;
      tx.depositPercent = 0;
      tx.eventDate = '';
    }
    if (!klein) {
      tx.vatRate = Number(g('vatRate').value);
      const tv = g('vatTreatment')?.value;
      if (tv) tx.vatTreatment = tv;
    } else {
      tx.vatRate = 0;
    }
    const amount = parseMoney(g('amount').value);
    const split = (inputMode === 'net' && !klein) ? splitFromNet(amount, tx.vatRate) : splitFromGross(amount, klein ? 0 : tx.vatRate);
    tx.gross = split.gross;
    tx.net = split.net;
    tx.vat = split.vat;
    tx.attachments = attachments.map((a) => a.id);
  }

  function updateAmountSummary() {
    collect();
    const box = form.querySelector('#amountSummary');
    if (!box) return;
    box.innerHTML = klein
      ? html`<span class="muted">Betrag:</span> <strong class="num">${money(tx.gross)} €</strong>`
      : html`
        <span><span class="muted">Netto</span> <strong class="num">${money(tx.net)} €</strong></span>
        <span><span class="muted">Umsatzsteuer ${tx.vatRate} %</span> <strong class="num">${money(tx.vat)} €</strong></span>
        <span><span class="muted">Brutto</span> <strong class="num">${money(tx.gross)} €</strong></span>
        ${tx.type === 'expense' && tx.vat ? raw('<span class="badge info">Vorsteuer abziehbar</span>') : ''}`;
    updateDepositSummary();
  }

  /**
   * Zeigt, was sich aus Anzahlung und Prozentsatz ergibt: der vereinbarte
   * Gesamtbetrag und der Rest, der zum Veranstaltungstag noch aussteht.
   */
  function updateDepositSummary() {
    const box = form.querySelector('#depositSummary');
    if (!box) return;
    collect();
    const dep = depositInfo(tx);
    if (!dep) { box.innerHTML = ''; return; }
    if (!dep.percent || !dep.total) {
      box.innerHTML = html`<p class="muted small mb0">Sobald der Anteil eingetragen ist, rechnet Kontovia den Gesamtbetrag und den offenen Rest aus.</p>`;
      return;
    }
    box.innerHTML = html`
      <div class="notice">
        <div class="row wrap" style="gap:18px;font-size:13px">
          <span><span class="muted">Anzahlung</span> <strong class="num">${money(tx.gross)} €</strong></span>
          <span><span class="muted">Gesamtbetrag</span> <strong class="num">${money(dep.total)} €</strong></span>
          <span><span class="muted">Restbetrag</span> <strong class="num">${money(dep.remaining)} €</strong></span>
          ${dep.eventDate ? raw(`<span><span class="muted">fällig zum</span> <strong>${esc(fmtDate(dep.eventDate))}</strong></span>`) : ''}
        </div>
        ${dep.remaining > 0 ? raw('<button class="btn sm mt8" id="btnRest">Restzahlung als offene Buchung vorbereiten</button>') : ''}
      </div>`;
    box.querySelector('#btnRest')?.addEventListener('click', createRemainder);
  }

  /**
   * Legt aus dem offenen Rest eine zweite, noch unbezahlte Buchung an –
   * datiert auf den Veranstaltungstag. Die Anzahlung selbst wird vorher
   * gespeichert, damit beim Wechsel in den zweiten Dialog nichts verloren geht.
   */
  async function createRemainder() {
    collect();
    const dep = depositInfo(tx);
    if (!dep || dep.remaining <= 0) { warn('Kein offener Restbetrag'); return; }
    if (!await saveTransaction()) return;
    const rest = {
      ...newTransactionDraft('income'),
      description: `Restzahlung: ${tx.description}`,
      categoryId: tx.categoryId,
      contactId: tx.contactId,
      accountId: tx.accountId,
      location: tx.location,
      reference: tx.reference,
      vatRate: tx.vatRate,
      date: dep.eventDate || todayISO(),
      dueDate: dep.eventDate || '',
      paidDate: '',
      notes: `Restbetrag nach Anzahlung vom ${fmtDate(tx.date)} (${percentText(dep.percent)} % von ${money(dep.total)} €).`,
      ...splitFromGross(dep.remaining, klein ? 0 : tx.vatRate),
    };
    m.close();
    ok('Anzahlung gespeichert', 'Der Restbetrag ist vorbereitet – bitte noch prüfen und anlegen.');
    refresh();
    setTimeout(() => openTransactionDialog(rest), 60);
  }

  function drawAttachments() {
    const list = form.querySelector('#attachList');
    if (!attachments.length) {
      list.innerHTML = '<p class="muted tiny mb0">Noch kein Beleg hinterlegt. Ohne Beleg keine Betriebsausgabe – das prüft das Finanzamt zuerst.</p>';
      return;
    }
    list.innerHTML = attachments.map((a) => `
      <div class="attach" data-att="${esc(a.id)}">
        <div class="thumb">${a.recovered ? '?' : esc((a.fileName.split('.').pop() || '?').slice(0, 4).toUpperCase())}</div>
        <div class="name" title="${esc(a.fileName)}">${esc(a.fileName)}<div class="tiny muted">${a.recovered
          ? 'aus einer älteren Fassung wiederhergestellt – Name und Prüfsumme fehlen'
          : `${esc(bytes(a.size))} · SHA-256 ${esc(String(a.sha256 || '').slice(0, 10))}…`}</div></div>
        <button class="btn sm ghost" data-view-att="${esc(a.id)}" title="Ansehen">${icon('eye', 14).__raw}</button>
        <button class="btn sm ghost" data-save-att="${esc(a.id)}" title="Speichern unter">${icon('save', 14).__raw}</button>
        <button class="btn sm ghost" data-del-att="${esc(a.id)}" title="Entfernen">${icon('trash', 14).__raw}</button>
      </div>`).join('');

    list.querySelectorAll('[data-view-att]').forEach((b) => b.addEventListener('click', () => {
      // Ein gerade erst angehängter Beleg steht noch nicht im Bestand – seine
      // Angaben kommen deshalb aus diesem Dialog.
      previewAttachment(b.dataset.viewAtt, attachments.find((x) => x.id === b.dataset.viewAtt));
    }));
    list.querySelectorAll('[data-save-att]').forEach((b) => b.addEventListener('click', async () => {
      const a = attachments.find((x) => x.id === b.dataset.saveAtt);
      const p = await api.attach.saveAs(a.id, a.fileName);
      if (p) ok('Beleg gespeichert', p);
    }));
    list.querySelectorAll('[data-del-att]').forEach((b) => b.addEventListener('click', async () => {
      const id2 = b.dataset.delAtt;
      if (!await confirmDialog({ title: 'Beleg entfernen?', text: 'Die Datei wird endgültig aus dem Tresor gelöscht.', confirmLabel: 'Entfernen', danger: true })) return;
      attachments = attachments.filter((x) => x.id !== id2);
      await api.attach.remove(id2);
      const i = addedAttachments.findIndex((x) => x.id === id2);
      if (i >= 0) addedAttachments.splice(i, 1);
      // War der Beleg bereits gespeichert, muss sein Eintrag mit Grabstein
      // verschwinden – sonst holt ihn der nächste Abgleich zurück.
      else await removeAttachmentRecord(id2);
      drawAttachments();
    }));
  }

  async function addFiles(files) {
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        const meta = await api.attach.add(f.name, f.type || 'application/octet-stream', b64);
        attachments.push(meta);
        addedAttachments.push(meta);
      } catch (e) {
        err('Beleg konnte nicht gespeichert werden', e.message);
      }
    }
    drawAttachments();
  }

  function wireForm() {
    form.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
      collect();
      tx.type = b.dataset.type;
      const cats = sel.activeCategories(tx.type);
      if (!cats.some((c) => c.id === tx.categoryId)) tx.categoryId = cats[0]?.id || '';
      draw();
    }));
    form.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      collect();
      inputMode = b.dataset.mode;
      draw();
    }));
    const amt = form.querySelector('#i_amount');
    amt.addEventListener('input', updateAmountSummary);
    amt.addEventListener('focus', () => amt.select());
    amt.addEventListener('blur', () => { if (amt.value.trim()) { amt.value = moneyInput(parseMoney(amt.value)); updateAmountSummary(); } });
    form.querySelector('#i_vatRate')?.addEventListener('change', updateAmountSummary);
    form.querySelector('#i_categoryId').addEventListener('change', (e) => {
      const c = sel.category(e.target.value);
      if (c && !klein && c.vatRate !== undefined && c.vatRate !== null) {
        const rateSel = form.querySelector('#i_vatRate');
        if (rateSel) { rateSel.value = String(c.vatRate); updateAmountSummary(); }
      }
    });
    form.querySelector('#i_isPaid').addEventListener('change', (e) => {
      form.querySelector('#i_paidDate').disabled = !e.target.checked;
    });
    form.querySelector('#i_unlisted').addEventListener('change', (e) => {
      form.querySelector('#unlistedHint').style.display = e.target.checked ? '' : 'none';
    });
    form.querySelector('#i_isDeposit')?.addEventListener('change', (e) => {
      const box = form.querySelector('#depositBox');
      if (box) box.style.display = e.target.checked ? '' : 'none';
      const pct = form.querySelector('#i_depositPercent');
      // Ein üblicher Satz als Vorgabe, damit das Feld nicht leer bleibt.
      if (e.target.checked && pct && !pct.value.trim()) pct.value = '30';
      updateDepositSummary();
    });
    form.querySelector('#i_depositPercent')?.addEventListener('input', updateDepositSummary);
    form.querySelector('#i_eventDate')?.addEventListener('change', updateDepositSummary);
    form.querySelectorAll('[data-pct]').forEach((b) => b.addEventListener('click', () => {
      form.querySelector('#i_depositPercent').value = b.dataset.pct;
      updateDepositSummary();
    }));
    form.querySelectorAll('[data-due]').forEach((b) => b.addEventListener('click', () => {
      form.querySelector('#i_dueDate').value = addDays(form.querySelector('#i_date').value || todayISO(), Number(b.dataset.due));
    }));
    form.querySelector('#btnNextNo')?.addEventListener('click', () => {
      form.querySelector('#i_invoiceNumber').value = nextInvoiceNumber();
    });
    form.querySelector('#btnNewContact')?.addEventListener('click', async () => {
      const created = await quickContactDialog(tx.type === 'income' ? 'customer' : 'supplier');
      if (created) { collect(); tx.contactId = created.id; draw(); }
    });
    form.querySelector('#btnMakeAsset')?.addEventListener('click', async () => {
      collect();
      if (!tx.net) { warn('Bitte zuerst einen Betrag eintragen'); return; }
      const created = await assetDialog({ name: tx.description, cost: klein ? tx.gross : tx.net, purchaseDate: tx.date });
      if (created) { tx.assetId = created.id; draw(); }
    });
    form.querySelector('#btnUnlinkAsset')?.addEventListener('click', () => { tx.assetId = ''; draw(); });

    const dz = form.querySelector('#dropzone');
    dz.addEventListener('click', async () => {
      const metas = await api.attach.pick();
      if (metas?.length) { attachments.push(...metas); addedAttachments.push(...metas); drawAttachments(); }
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('over');
      addFiles([...e.dataTransfer.files]);
    });
  }

  /** Prüft die Eingaben und schreibt die Buchung. Gibt zurück, ob gespeichert wurde. */
  async function saveTransaction() {
    collect();
    if (!tx.description) { fieldError(form.querySelector('#i_description'), 'Bitte eine Beschreibung eintragen.'); return false; }
    if (!tx.categoryId) { fieldError(form.querySelector('#i_categoryId'), 'Bitte eine Kategorie wählen.'); return false; }
    if (!tx.gross) { fieldError(form.querySelector('#i_amount'), 'Der Betrag darf nicht 0 sein.'); return false; }
    if (tx.isDeposit && (tx.depositPercent <= 0 || tx.depositPercent > 100)) {
      fieldError(form.querySelector('#i_depositPercent'), 'Bitte einen Wert zwischen 1 und 100 Prozent eintragen.');
      return false;
    }
    if (locked) { err('Zeitraum ist festgeschrieben', 'Bitte stornieren Sie die Buchung statt sie zu ändern.'); return false; }
    // Auch in die andere Richtung sperren: eine Buchung nachträglich in einen
    // abgeschlossenen Zeitraum zurückzudatieren, würde eine festgeschriebene
    // Periode verändern – gleich, ob die Buchung neu ist oder nur umdatiert
    // wird. Dasselbe gilt für das Zahlungsdatum, das bei der Ist-Besteuerung
    // über die Periodenzuordnung entscheidet.
    if (isLockedDate(tx.date) || (tx.paidDate && isLockedDate(tx.paidDate))) {
      err('Zeitraum ist festgeschrieben',
        'Für diesen Zeitraum sind keine neuen Buchungen mehr möglich. Wählen Sie ein Datum nach der Festschreibung.');
      return false;
    }
    saved = true;
    await upsertTransaction(tx, attachments);
    return true;
  }

  /* Fußzeile */
  m.root.querySelector('#btnCancel').addEventListener('click', () => m.dismiss());
  m.root.querySelector('#btnSave').addEventListener('click', async () => {
    const b = m.root.querySelector('#btnSave');
    if (b.disabled) return;
    b.disabled = true;
    try {
      if (!await saveTransaction()) return;
    } finally { b.disabled = false; }
    m.close();
    ok(isNew ? 'Buchung angelegt' : 'Buchung gespeichert', `${tx.description} · ${money(tx.gross)} €`);
    refresh();
  });
  m.root.querySelector('#btnDelete')?.addEventListener('click', async () => {
    if (isLockedDate(tx.date)) { err('Festgeschriebene Buchungen dürfen nicht gelöscht werden', 'Nutzen Sie stattdessen „Stornieren“.'); return; }
    const yes = await confirmDialog({
      title: 'Buchung löschen?',
      text: 'Die Buchung wird endgültig entfernt. Der Vorgang wird im Änderungsjournal vermerkt.',
      confirmLabel: 'Endgültig löschen', danger: true,
    });
    if (!yes) return;
    saved = true;
    for (const a of attachments) await api.attach.remove(a.id).catch(() => {});
    await commit('beleg.aufraeumen', (db) => {
      db.attachments = db.attachments.filter((a) => !tx.attachments.includes(a.id));
      for (const aid of tx.attachments || []) {
        if (!db.tombstones.some((t) => t.collection === 'attachments' && t.id === aid)) {
          db.tombstones.push({ collection: 'attachments', id: aid, deletedAt: new Date().toISOString() });
        }
      }
    }, { silent: true });
    await deleteTransaction(tx.id);
    m.close();
    ok('Buchung gelöscht');
    refresh();
  });
  m.root.querySelector('#btnVoid')?.addEventListener('click', async () => {
    const reason = await askText('Storno', 'Warum wird diese Buchung storniert?', 'z. B. doppelt erfasst');
    if (reason === null) return;
    saved = true;
    await voidTransaction(tx.id, reason);
    m.close();
    ok('Buchung storniert', 'Original und Gegenbuchung bleiben nachvollziehbar erhalten.');
    refresh();
  });
  m.root.querySelector('#btnDuplicate')?.addEventListener('click', () => {
    saved = true;
    m.close();
    const copy = { ...structuredClone(tx), id: uid('tx'), date: todayISO(), paidDate: '', invoiceNumber: '', attachments: [], voided: false, isReversal: false, createdAt: new Date().toISOString() };
    setTimeout(() => openTransactionDialog(copy), 60);
  });

  draw();
  collect();
  ausgangslage = JSON.stringify(tx);
  // Belege dürfen auch von außerhalb des Dialogs fallen gelassen werden.
  m.root.addEventListener('dragover', (e) => e.preventDefault());
  m.root.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
}

/* -------------------------------------------------------------------------- */
/* Hilfsdialoge                                                                */
/* -------------------------------------------------------------------------- */

export function askText(title, label, placeholder = '') {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title, size: 'slim',
      body: html`<div class="field"><label>${label}</label><input id="txt" placeholder="${placeholder}"></div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    const input = m.root.querySelector('#txt');
    const done = () => { settled = true; const v = input.value.trim(); m.close(); resolve(v); };
    m.root.querySelector('[data-yes]').addEventListener('click', done);
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}

/**
 * Markiert ein Pflichtfeld als fehlerhaft und setzt den Fokus hinein. Die
 * Markierung verschwindet mit der nächsten Eingabe.
 */
function fieldError(input, text) {
  const field = input?.closest('.field');
  if (!field) return;
  field.classList.add('error');
  let hint = field.querySelector('.err');
  if (!hint) { hint = document.createElement('span'); hint.className = 'err'; field.append(hint); }
  hint.textContent = text;
  const weg = () => { field.classList.remove('error'); hint.remove(); };
  input.addEventListener('input', weg, { once: true });
  input.addEventListener('change', weg, { once: true });
  input.focus();
}

export function quickContactDialog(kind = 'customer') {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Neuer Kontakt',
      size: 'slim',
      body: html`
        <div class="field"><label>Name *</label><input id="c_name"></div>
        <div class="field"><label>Art</label>
          <select id="c_kind">
            <option value="customer" ${kind === 'customer' ? 'selected' : ''}>Kunde</option>
            <option value="supplier" ${kind === 'supplier' ? 'selected' : ''}>Lieferant</option>
            <option value="both">Beides</option>
          </select>
        </div>
        <div class="field"><label>E-Mail</label><input id="c_email"></div>
        <div class="field"><label>Anschrift</label><textarea id="c_address"></textarea></div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Anlegen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const name = m.root.querySelector('#c_name').value.trim();
      if (!name) { warn('Bitte einen Namen eintragen'); return; }
      const contact = {
        id: uid('con'), name,
        kind: m.root.querySelector('#c_kind').value,
        email: m.root.querySelector('#c_email').value.trim(),
        address: m.root.querySelector('#c_address').value.trim(),
        taxId: '', notes: '',
      };
      settled = true;
      await upsertEntity('contacts', contact, 'kontakt');
      m.close();
      resolve(contact);
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}

export function assetDialog(preset = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Anlagegut abschreiben',
      size: 'slim',
      body: html`
        <p class="mt0 small muted">Anschaffungen über 800 € netto werden nicht sofort abgezogen,
        sondern über die betriebsgewöhnliche Nutzungsdauer verteilt (AfA, § 7 EStG).
        Kontovia rechnet linear und monatsgenau ab dem Anschaffungsmonat.</p>
        <div class="field"><label>Bezeichnung *</label><input id="a_name" value="${esc(preset.name || '')}"></div>
        <div class="field"><label>Anschaffungskosten (netto)</label><input class="money-input" id="a_cost" value="${moneyInput(preset.cost || 0)}"></div>
        <div class="field"><label>Anschaffungsdatum</label><input type="date" id="a_date" value="${preset.purchaseDate || todayISO()}"></div>
        <div class="field"><label>Nutzungsdauer</label>
          <select id="a_life">
            <option value="3" selected>3 Jahre – Computer, Notebooks, Tablets</option>
            <option value="5">5 Jahre – Maschinen, Werkzeuge</option>
            <option value="6">6 Jahre – Fahrzeuge (Pkw)</option>
            <option value="8">8 Jahre – Kopierer, Werkstattausstattung</option>
            <option value="10">10 Jahre – sonstige Betriebsausstattung</option>
            <option value="13">13 Jahre – Büromöbel</option>
          </select>
          <span class="hint">Maßgeblich sind die amtlichen AfA-Tabellen des Bundesfinanzministeriums.</span>
        </div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Anlegen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const name = m.root.querySelector('#a_name').value.trim();
      const cost = parseMoney(m.root.querySelector('#a_cost').value);
      if (!name || !cost) { warn('Bezeichnung und Kosten werden benötigt'); return; }
      const asset = {
        id: uid('ass'), name, cost,
        purchaseDate: m.root.querySelector('#a_date').value || todayISO(),
        usefulLifeYears: Number(m.root.querySelector('#a_life').value),
        method: 'linear',
      };
      settled = true;
      await upsertEntity('assets', asset, 'anlage');
      m.close();
      resolve(asset);
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}

/* -------------------------------------------------------------------------- */
/* Belegvorschau                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Erkennt den Dateityp an den ersten Bytes. Gebraucht für Belege aus älteren
 * Fassungen, deren Angaben nicht mehr vorliegen.
 */
function sniffMime(bytes) {
  const b = bytes;
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

export async function previewAttachment(id, metaHint = null) {
  const meta = { ...(sel.attachment(id) || { fileName: 'Beleg', mime: '' }), ...(metaHint || {}) };
  let b64;
  try {
    b64 = await api.attach.read(id);
  } catch (e) {
    err('Beleg kann nicht gelesen werden', e.message);
    return;
  }
  const daten = base64ToUint8(b64);
  // Bei wiederhergestellten Belegen fehlt die Typangabe – dann entscheidet
  // der Dateiinhalt, sonst gäbe es keine Vorschau.
  const mime = meta.mime || sniffMime(daten) || 'application/octet-stream';
  const blob = new Blob([daten], { type: mime });
  const url = URL.createObjectURL(blob);

  const isImage = /^image\//.test(mime);
  const isPdf = /pdf$/i.test(mime) || /\.pdf$/i.test(meta.fileName);

  const m = modal({
    title: meta.fileName,
    size: 'wide',
    body: isImage
      ? `<img class="preview-img" src="${url}" alt="Beleg">`
      : isPdf
        ? `<iframe class="preview-frame" src="${url}"></iframe>`
        : `<div class="empty"><h4>Keine Vorschau möglich</h4><p class="small">Dateityp ${esc(mime)}. Sie können den Beleg speichern oder extern öffnen.</p></div>`,
    foot: `<span class="left muted tiny">${meta.sha256
      ? `${esc(bytes(meta.size || 0))} · SHA-256 ${esc(String(meta.sha256).slice(0, 16))}…`
      : esc(bytes(daten.length))}</span>
           <button class="btn" data-ext>${icon('external', 14).__raw} Extern öffnen</button>
           <button class="btn primary" data-save>${icon('save', 14).__raw} Speichern unter</button>`,
    onClose: () => URL.revokeObjectURL(url),
  });
  m.root.querySelector('[data-save]').addEventListener('click', async () => {
    const p = await api.attach.saveAs(id, meta.fileName);
    if (p) ok('Beleg gespeichert', p);
  });
  m.root.querySelector('[data-ext]').addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Extern öffnen?',
      text: WEB
        ? 'Der Beleg wird entschlüsselt in einem neuen Browser-Tab geöffnet. Was der Browser nicht anzeigen kann, wird stattdessen zum Sichern angeboten.'
        : 'Der Beleg wird dafür unverschlüsselt in den temporären Ordner geschrieben und dort beim Beenden von Kontovia wieder gelöscht.',
      confirmLabel: 'Öffnen',
    });
    if (!yes) return;
    await api.attach.openExternal(id, meta.fileName);
  });
}

/* -------------------------------------------------------------------------- */

export function arrayBufferToBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { filters };
