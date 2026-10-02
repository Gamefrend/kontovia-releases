/** Kontovia – Terminkalender, verknüpfbar mit Buchungen und Rechnungen. */

import {
  html, raw, esc, $, $$, money, fmtDate, fmtDateLong, todayISO, fromISO, uid,
  addMonths, addDays, monthStart, monthEnd, MONTHS, MONTHS_SHORT, WEEKDAYS, isoWeek, sortBy, int,
} from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, emptyState } from '../lib/ui.js';
import { sel, upsertAppointment, deleteAppointment, applyTodoChanges, newTodoDraft, newTransactionDraft } from '../lib/store.js';
import { depositInfo, isVoidPart } from '../lib/calc.js';
import { expandAppointments } from '../lib/termine.js';
import { refresh } from '../lib/router.js';
import { openTransactionDialog } from './transactions.js';
import { openCalendarSyncDialog, statusText } from './calendarsync.js';
import { calState, onCalendarSync, refreshCalendarStatus, syncCalendar, calendarSettings } from '../lib/gcalsync.js';
import { eventIdFor } from '../lib/gcal.js';
import { openMenu } from '../lib/popover.js';
import { steuertermine } from '../lib/fristen.js';
import { oeffneFrist } from './spruenge.js';

const state = {
  cursor: monthStart(todayISO()),
  mode: 'month', // month | agenda
  showDue: true,
  showEvents: true,
  showDone: true,
  showTax: true,
};

const FREQ = { none: 'einmalig', weekly: 'wöchentlich', biweekly: 'alle zwei Wochen', monthly: 'monatlich', yearly: 'jährlich' };

/** Zahlungstermine (Fälligkeiten offener Rechnungen) als Kalendereinträge. */
function dueEntries(from, to) {
  return sel.transactions()
    .filter((t) => !isVoidPart(t) && !t.paidDate && (t.dueDate || t.date) >= from && (t.dueDate || t.date) <= to)
    .map((t) => ({
      id: 'due_' + t.id,
      isDue: true,
      txId: t.id,
      occurrence: t.dueDate || t.date,
      title: `${t.type === 'income' ? 'Zahlungseingang' : 'Zahlung fällig'}: ${t.description}`,
      amount: t.gross,
      type: t.type,
      allDay: true,
    }));
}

/**
 * Veranstaltungstermine aus Anzahlungen – bei einer Hochzeit der Tag selbst.
 * Die Anzahlung ist längst gebucht; im Kalender steht, wann geliefert wird
 * und welcher Restbetrag dann noch aussteht.
 */
function eventEntries(from, to) {
  const out = [];
  for (const t of sel.transactions()) {
    if (isVoidPart(t)) continue;
    const dep = depositInfo(t);
    if (!dep?.eventDate || dep.eventDate < from || dep.eventDate > to) continue;
    out.push({
      id: 'evt_' + t.id,
      isEvent: true,
      txId: t.id,
      occurrence: dep.eventDate,
      title: `${t.description}${t.location ? ' · ' + t.location : ''}`
        + (dep.remaining > 0 ? ` · Restbetrag ${money(dep.remaining)} €` : ''),
      allDay: true,
    });
  }
  return out;
}

/** Steuertermine (Voranmeldung, Jahreserklärungen) als Kalendereinträge. */
function taxEntries(from, to) {
  return steuertermine(sel.settings(), from, to).map((t, i) => ({
    ...t,
    id: `tax_${t.datum}_${i}`,
    isTax: true,
    occurrence: t.datum,
    title: t.titel,
    allDay: true,
  }));
}

/** Kennzeichnet einen Steuertermin im HTML, damit ein Klick zu seinen Zahlen führt. */
const taxAttrs = (e) => `data-tax="1" data-tax-from="${esc(e.zeitraum?.from || '')}" data-tax-to="${esc(e.zeitraum?.to || '')}" data-tax-jahr="${esc(e.jahr || '')}"`;

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = html`
    <div class="seg" role="group" aria-label="Darstellung">
      <button data-mode="month" class="${state.mode === 'month' ? 'active' : ''}" aria-pressed="${state.mode === 'month'}">Monat</button>
      <button data-mode="agenda" class="${state.mode === 'agenda' ? 'active' : ''}" aria-pressed="${state.mode === 'agenda'}">Liste</button>
    </div>
    <button class="btn" id="calShow" aria-haspopup="dialog" aria-expanded="false" title="Was der Kalender zeigt">${icon('eye', 16)} Anzeige ${icon('down', 14)}</button>
    <button class="btn" id="calSync" title="Mit Google Kalender oder per Kalenderdatei (.ics) abgleichen">${icon('refresh', 16)} Abgleich</button>
    <button class="btn primary" id="newAppt">${icon('plus', 16)} Termin</button>`;
  $$('[data-mode]', actions).forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    render(root, params, { actions });
  }));
  // Was eingeblendet wird, steht in einem Menü statt in drei Häkchen über dem Kalender.
  actions.querySelector('#calShow').addEventListener('click', (e) => openMenu(e.currentTarget, {
    label: 'Anzeige',
    keepOpen: true,
    align: 'end',
    sections: () => [{
      key: 'show',
      title: 'Im Kalender zeigen',
      options: [
        state.mode === 'month' && { value: 'showDue', label: 'Zahlungstermine offener Rechnungen', on: state.showDue },
        { value: 'showEvents', label: 'Veranstaltungen aus Anzahlungen', on: state.showEvents },
        { value: 'showTax', label: 'Steuertermine (Voranmeldung, Erklärungen)', on: state.showTax },
        { value: 'showDone', label: 'Erledigte Termine', on: state.showDone },
      ].filter(Boolean),
    }],
    onPick: (_, key) => { state[key] = !state[key]; draw(root); },
  }));
  actions.querySelector('#newAppt').addEventListener('click', () => openAppointmentDialog(null, { date: todayISO() }));
  actions.querySelector('#calSync').addEventListener('click', openCalendarSyncDialog);
  draw(root);

  // Beim Öffnen des Kalenders frisch abgleichen, wenn der letzte Abgleich
  // ein paar Minuten zurückliegt – dann stimmt, was hier steht.
  const st = await refreshCalendarStatus();
  const zuletzt = Date.parse(calState.lastAt || st?.lastSyncAt || 0) || 0;
  if (st?.linked && !calState.running && Date.now() - zuletzt > 3 * 60 * 1000) {
    syncCalendar({ reason: 'kalender' }).then((r) => { if (r?.summary && r.summary !== 'alles auf dem gleichen Stand' && root.isConnected) draw(root); }).catch(() => {});
  }
}

/** Kleiner Hinweis in der Kopfleiste des Kalenders; führt zum Abgleich. */
function syncBadge() {
  const text = statusText();
  if (!text) return '';
  const fehler = !!(calState.lastError || calState.status?.lastError);
  return `<button class="badge ${fehler ? 'neg' : 'info'}" id="calSyncBadge" style="border:0;cursor:pointer" title="${esc(fehler ? (calState.lastError || calState.status?.lastError) : 'Kalender-Abgleich öffnen')}">${icon('refresh', 12).__raw} ${esc(text)}</button>`;
}

let badgeWatch = null;
function wireSyncBadge(root) {
  root.querySelector('#calSyncBadge')?.addEventListener('click', openCalendarSyncDialog);
  // Während eines laufenden Abgleichs den Hinweis mitführen.
  badgeWatch?.();
  badgeWatch = onCalendarSync(() => {
    const el = root.querySelector('#calSyncBadge');
    if (!root.isConnected) { badgeWatch?.(); badgeWatch = null; return; }
    if (el) el.outerHTML = syncBadge() || '<span id="calSyncBadge"></span>';
    root.querySelector('#calSyncBadge')?.addEventListener('click', openCalendarSyncDialog);
  });
}

function draw(root) {
  if (state.mode === 'agenda') return drawAgenda(root);
  drawMonth(root);
}

function drawMonth(root) {
  const first = monthStart(state.cursor);
  const last = monthEnd(state.cursor);
  const firstWeekday = (fromISO(first).getDay() + 6) % 7; // Montag = 0
  const gridStart = addDays(first, -firstWeekday);
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  const gridEnd = cells[41];

  const events = expandAppointments(sel.appointments(), gridStart, gridEnd)
    .filter((e) => state.showDone || !e.done);
  const dues = state.showDue ? dueEntries(gridStart, gridEnd) : [];
  const veranstaltungen = state.showEvents ? eventEntries(gridStart, gridEnd) : [];
  const fristen = state.showTax ? taxEntries(gridStart, gridEnd) : [];
  const byDay = new Map();
  for (const e of [...fristen, ...events, ...dues, ...veranstaltungen]) {
    if (!byDay.has(e.occurrence)) byDay.set(e.occurrence, []);
    byDay.get(e.occurrence).push(e);
  }

  const monthName = `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`;
  const monthEvents = [...events].filter((e) => e.occurrence >= first && e.occurrence <= last);

  root.innerHTML = html`
    <div class="card">
      <div class="filters">
        <button class="btn sm" id="prev" title="Vorheriger Monat" aria-label="Vorheriger Monat">${icon('left', 15)}</button>
        <button class="btn sm" id="today">Heute</button>
        <button class="btn sm" id="next" title="Nächster Monat" aria-label="Nächster Monat">${icon('right', 15)}</button>
        <h3 style="margin:0 0 0 8px;font-size:16px">${monthName}</h3>
        <div class="spacer"></div>
        ${raw(syncBadge())}
        ${raw(hiddenHint())}
      </div>
      <div class="cal-grid">
        ${raw(WEEKDAYS.map((w) => `<div class="cal-head">${w}</div>`).join(''))}
        ${raw(cells.map((d) => cellHtml(d, first, byDay.get(d) || [])).join(''))}
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>Termine im ${monthName}</h3><div class="spacer"></div><span class="badge">${int(monthEvents.length)}</span></div>
      <div class="card-body ${monthEvents.length ? 'tight' : ''}">
        ${monthEvents.length
          ? raw('<div style="padding:0 16px">' + sortBy(monthEvents, (e) => e.occurrence + (e.startTime || '')).map(agendaRow).join('') + '</div>')
          : emptyState('Keine Termine', 'In diesem Monat ist nichts eingetragen.')}
      </div>
    </div>`;

  $('#prev', root).addEventListener('click', () => { state.cursor = addMonths(state.cursor, -1); draw(root); });
  $('#next', root).addEventListener('click', () => { state.cursor = addMonths(state.cursor, 1); draw(root); });
  $('#today', root).addEventListener('click', () => { state.cursor = monthStart(todayISO()); draw(root); });

  wireEvents(root);
  wireSyncBadge(root);
}

/**
 * Was gerade ausgeblendet ist – sonst fiele nicht auf, dass etwas fehlt.
 * Geändert wird es über „Anzeige“ oben rechts.
 */
function hiddenHint() {
  const weg = [
    state.mode === 'month' && !state.showDue && 'Zahlungstermine',
    !state.showEvents && 'Veranstaltungen',
    !state.showTax && 'Steuertermine',
    !state.showDone && 'Erledigte',
  ].filter(Boolean);
  return weg.length ? `<span class="small muted" title="Über „Anzeige“ oben rechts wieder einblenden">${icon('hide', 13).__raw} ausgeblendet: ${esc(weg.join(', '))}</span>` : '';
}

function cellHtml(date, monthRef, items) {
  const other = date.slice(0, 7) !== monthRef.slice(0, 7);
  const dow = (fromISO(date).getDay() + 6) % 7;
  const cls = ['cal-cell', other ? 'other' : '', date === todayISO() ? 'today' : '', dow >= 5 ? 'weekend' : ''].filter(Boolean).join(' ');
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return `<div class="${cls}" data-day="${date}" tabindex="0" role="button" aria-label="${esc(fmtDate(date))}, neuer Termin">
    <div class="cal-day">${Number(date.slice(8, 10))}</div>
    ${shown.map((e) => e.isTax
      ? `<div class="cal-ev cal-tax" ${taxAttrs(e)} title="${esc(`${e.title}: ${e.hinweis}`)}">§ ${esc(e.title)}</div>`
      : e.isDue
      ? `<div class="cal-ev" style="background:var(--warn-soft);color:var(--warn);border-left-color:var(--warn)" data-tx="${esc(e.txId)}" title="${esc(e.title)}">${esc(money(e.amount))} € ${esc(e.type === 'income' ? '↓' : '↑')}</div>`
      : e.isEvent
      ? `<div class="cal-ev" style="background:var(--accent-soft);color:var(--accent);border-left-color:var(--accent)" data-tx="${esc(e.txId)}" title="${esc(e.title)}">${esc(e.title)}</div>`
      : `<div class="cal-ev ${e.done ? 'done' : ''}" data-appt="${esc(e.id)}" title="${esc(e.title + (e.extern ? ` · Google Kalender „${kalenderName(e.extern)}“` : ''))}" ${e.color ? `style="border-left-color:${esc(e.color)};color:${esc(e.color)}"` : ''}>${e.allDay ? '' : esc((e.startTime || '') + ' ')}${esc(e.title)}</div>`).join('')}
    ${more > 0 ? `<div class="cal-more">+ ${more} weitere</div>` : ''}
  </div>`;
}

/** „✓ 1/3“ – wie viele Aufgaben am Termin schon erledigt sind. */
function todoBadge(apptId) {
  const todos = sel.todosOf(apptId);
  if (!todos.length) return '';
  const fertig = todos.filter((t) => t.done).length;
  return `<span class="badge ${fertig === todos.length ? 'pos' : ''}" title="${fertig} von ${todos.length} Aufgaben erledigt">${icon('todo', 12).__raw} ${fertig}/${todos.length}</span>`;
}

function agendaRow(e) {
  const linked = (e.transactionIds || []).length;
  // Veranstaltungen stammen aus einer Buchung und führen auch dorthin zurück,
  // Steuertermine zu den Zahlen, die dafür gebraucht werden.
  const anchor = e.isTax ? taxAttrs(e) : e.isEvent ? `data-tx="${esc(e.txId)}"` : `data-appt="${esc(e.id)}"`;
  return `<div class="agenda-item" ${anchor}>
    <div class="agenda-date">
      <div class="d">${esc(e.occurrence.slice(8, 10))}</div>
      <div class="m">${esc(MONTHS_SHORT[Number(e.occurrence.slice(5, 7)) - 1])}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="strong truncate">${e.done ? '✓ ' : ''}${esc(e.title)}${e.isRepeat ? ' <span class="badge tiny">Wiederholung</span>' : ''}${e.isEvent ? ' <span class="badge info tiny">Veranstaltung</span>' : ''}${e.isTax ? ' <span class="badge warn tiny">Steuertermin</span>' : ''}</div>
      <div class="tiny muted">
        ${e.isTax ? esc(e.hinweis) : e.allDay ? 'ganztägig' : esc((e.startTime || '') + (e.endTime ? ' – ' + e.endTime : ''))}
        ${e.location ? ' · ' + esc(e.location) : ''}
        ${e.contactId ? ' · ' + esc(sel.contactName(e.contactId)) : ''}
        · KW ${isoWeek(e.occurrence)}
      </div>
    </div>
    ${e.isEvent || e.isTax ? '' : todoBadge(e.id)}
    ${linked ? `<span class="badge info">${icon('link', 12).__raw} ${linked} Buchung${linked > 1 ? 'en' : ''}</span>` : ''}
  </div>`;
}

function drawAgenda(root) {
  const from = todayISO();
  const to = addDays(from, 365);
  const past = [
    ...expandAppointments(sel.appointments(), addDays(from, -365), addDays(from, -1)),
    ...(state.showEvents ? eventEntries(addDays(from, -365), addDays(from, -1)) : []),
  ];
  const events = sortBy([
    ...expandAppointments(sel.appointments(), from, to).filter((e) => state.showDone || !e.done),
    ...(state.showEvents ? eventEntries(from, to) : []),
    ...(state.showTax ? taxEntries(from, to) : []),
  ], (e) => e.occurrence + (e.startTime || ''));

  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h3>Kommende Termine</h3>
        <span class="sub">nächste zwölf Monate</span>
        <div class="spacer"></div>
        ${raw(syncBadge())}
        ${raw(hiddenHint())}
      </div>
      <div class="card-body ${events.length ? 'tight' : ''}">
        ${events.length ? raw('<div style="padding:0 16px">' + events.map(agendaRow).join('') + '</div>')
          : emptyState('Nichts geplant', 'Legen Sie oben rechts einen Termin an.')}
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>Vergangene Termine</h3><span class="sub">letzte zwölf Monate</span></div>
      <div class="card-body ${past.length ? 'tight' : ''}">
        ${past.length ? raw('<div style="padding:0 16px">' + sortBy(past, (e) => e.occurrence, -1).slice(0, 40).map(agendaRow).join('') + '</div>')
          : emptyState('Keine Einträge', 'Hier erscheinen zurückliegende Termine.')}
      </div>
    </div>`;

  wireEvents(root);
  wireSyncBadge(root);
}

function wireEvents(root) {
  $$('[data-appt]', root).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    openAppointmentDialog(n.dataset.appt);
  }));
  $$('[data-tx]', root).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    openTransactionDialog(n.dataset.tx);
  }));
  $$('[data-tax]', root).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    const { taxFrom: from, taxTo: to, taxJahr: jahr } = n.dataset;
    oeffneFrist({ zeitraum: from && to ? { from, to } : null, jahr: jahr ? Number(jahr) : null });
  }));
  $$('[data-day]', root).forEach((n) => {
    n.addEventListener('click', () => openAppointmentDialog(null, { date: n.dataset.day }));
    n.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); openAppointmentDialog(null, { date: n.dataset.day }); }
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Termindialog                                                                */
/* -------------------------------------------------------------------------- */

export function openAppointmentDialog(id, preset = {}) {
  const existing = id ? sel.appointment(id) : null;
  const a = existing ? structuredClone(existing) : {
    id: uid('apt'),
    title: '',
    date: preset.date || todayISO(),
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    notes: '',
    contactId: '',
    color: '',
    done: false,
    transactionIds: [],
    recurrence: { freq: 'none', until: '' },
    reminderMinutes: 0,
    createdAt: new Date().toISOString(),
  };
  const isNew = !existing;
  /* Stand nach dem ersten Zeichnen; weicht die Eingabe davon ab, fragt das
     Fenster vor dem Wegklicken nach – wie beim Erfassen einer Buchung. */
  let ausgangslage = null;
  let fertig = false;

  const m = modal({
    title: isNew ? 'Neuer Termin' : 'Termin bearbeiten',
    confirmDismiss: () => ausgangslage !== null && !fertig && stand() !== ausgangslage,
    body: '<div id="apptForm"></div>',
    foot: `
      <div class="left row" style="gap:8px">
        ${!isNew ? `<button class="btn danger sm" id="btnDel">${icon('trash', 14).__raw} Löschen</button>` : ''}
        ${!isNew ? `<button class="btn sm" id="btnDone">${a.done ? 'Als offen markieren' : 'Als erledigt markieren'}</button>` : ''}
      </div>
      <button class="btn" id="btnCancel">Abbrechen</button>
      <button class="btn primary" id="btnSave">${isNew ? 'Termin anlegen' : 'Speichern'}</button>`,
  });
  const form = m.root.querySelector('#apptForm');

  /* Aufgaben zum Termin: bearbeitet wird eine Arbeitskopie, geschrieben erst
     zusammen mit dem Termin – „Abbrechen“ verwirft auch hier alles. */
  const todosVorher = new Map(sel.todosOf(a.id).map((t) => [t.id, t]));
  let todos = [...todosVorher.values()].map((t) => structuredClone(t));
  const geloest = [];

  function todoSection() {
    // Offene Aufgaben ohne Termin – und die hier gerade gelösten, falls man es sich anders überlegt.
    const frei = sel.todos().filter((t) => !t.done && (!t.appointmentId || geloest.some((x) => x.id === t.id))
      && !todos.some((x) => x.id === t.id));
    return `
      <hr class="sep">
      <div class="row between mb8">
        <strong style="font-size:13px">Aufgaben zu diesem Termin</strong>
        ${frei.length ? `<select id="t_todoPick" class="sm" aria-label="Vorhandene Aufgabe verknüpfen" style="max-width:260px">
          <option value="">Vorhandene Aufgabe verknüpfen …</option>
          ${frei.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('')}
        </select>` : ''}
      </div>
      ${todos.length ? `<div class="todo-mini">${todos.map((t) => `
        <div class="todo-item compact${t.done ? ' done' : ''}">
          <input type="checkbox" class="todo-check" data-appt-todo="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="${esc(t.title)} erledigt">
          <span class="todo-title truncate">${esc(t.title)}</span>
          ${t.dueDate ? `<span class="badge tiny">bis ${esc(fmtDate(t.dueDate))}</span>` : ''}
          <button type="button" class="icon-btn" data-appt-todo-drop="${esc(t.id)}"
            title="${todosVorher.has(t.id) ? 'Vom Termin lösen (die Aufgabe bleibt bestehen)' : 'Wieder entfernen'}"
            aria-label="${esc(t.title)} ${todosVorher.has(t.id) ? 'vom Termin lösen' : 'entfernen'}">${icon('x', 14).__raw}</button>
        </div>`).join('')}</div>` : '<p class="muted small mt0">Was bis zum Termin zu erledigen ist, lässt sich hier abhaken.</p>'}
      <div class="todo-add compact">
        <input id="t_todoNew" placeholder="Aufgabe hinzufügen, z. B. Vertrag ausdrucken" aria-label="Neue Aufgabe zum Termin">
        <button type="button" class="btn sm" id="btnTodoAdd">${icon('plus', 14).__raw} Hinzufügen</button>
      </div>`;
  }

  /** Übernimmt einen eingetippten, aber noch nicht hinzugefügten Titel. */
  function addPendingTodo() {
    const feld = form.querySelector('#t_todoNew');
    const title = feld?.value.trim();
    if (!title) return false;
    todos.push(newTodoDraft({ title, appointmentId: a.id }));
    feld.value = '';
    return true;
  }

  async function saveTodos() {
    addPendingTodo();
    const upserts = todos.filter((t) => {
      const vorher = todosVorher.get(t.id);
      return !vorher || JSON.stringify(vorher) !== JSON.stringify(t);
    });
    for (const t of geloest) upserts.push({ ...t, appointmentId: '' });
    await applyTodoChanges({ upserts, removals: [] });
  }

  /* Weitere Google-Kalender: Neue Termine lassen sich direkt dort eintragen,
     bestehende zeigen, woher sie kommen. Den Kalender eines bestehenden
     Termins zu wechseln, ist nicht vorgesehen. */
  const weitere = calState.status?.linked && calState.status?.weitereErlaubt ? calendarSettings().weitere : [];
  function kalenderFeld() {
    if (a.extern && !isNew) {
      const aktiv = calendarSettings().weitere.some((k) => k.id === a.extern.calendarId);
      return `<div class="notice mb16 small">${icon('calendar', 14).__raw} Aus Google Kalender
        <strong>„${esc(kalenderName(a.extern))}“</strong>. ${aktiv
        ? 'Änderungen und Löschen gehen beim nächsten Abgleich auch dorthin.'
        : 'Dieser Kalender wird derzeit nicht abgeglichen; Änderungen bleiben in Kontovia.'}</div>`;
    }
    if (!isNew || !weitere.length) return '';
    const wahl = a.extern?.calendarId || '';
    return `<div class="field">
        <label>Kalender</label>
        <select id="t_kalender">
          <option value="">Kontovia</option>
          ${weitere.map((k) => `<option value="${esc(k.id)}" ${k.id === wahl ? 'selected' : ''}>${esc(k.name || k.id)}</option>`).join('')}
        </select>
        <span class="hint">In welchem Google-Kalender der Termin erscheint.</span>
      </div>`;
  }

  function draw() {
    const linked = (a.transactionIds || []).map(sel.transaction).filter(Boolean);
    form.innerHTML = html`
      ${raw(kalenderFeld())}
      <div class="field">
        <label>Titel *</label>
        <input id="t_title" value="${a.title}" placeholder="z. B. Steuerberater-Termin, Montage Kunde Meier">
      </div>
      <div class="form-grid">
        <div class="field">
          <label>Datum *</label>
          <input type="date" id="t_date" value="${a.date}">
        </div>
        <div class="field">
          <label>Zeit</label>
          <div class="row" style="gap:8px">
            <label class="check nowrap"><input type="checkbox" id="t_allDay" ${a.allDay ? 'checked' : ''}> ganztägig</label>
            <input type="time" id="t_start" value="${a.startTime || '09:00'}" ${a.allDay ? 'disabled' : ''}>
            <input type="time" id="t_end" value="${a.endTime || ''}" ${a.allDay ? 'disabled' : ''}>
          </div>
        </div>
        <div class="field">
          <label>Ort</label>
          <input id="t_location" value="${a.location || ''}">
        </div>
        <div class="field">
          <label>Kontakt</label>
          <select id="t_contactId">
            <option value="">Keiner</option>
            ${raw(sel.contacts().map((c) => `<option value="${esc(c.id)}" ${a.contactId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}
          </select>
        </div>
        <div class="field">
          <label>Wiederholung</label>
          <select id="t_freq">
            ${raw(Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${(a.recurrence?.freq || 'none') === k ? 'selected' : ''}>${esc(v)}</option>`).join(''))}
          </select>
        </div>
        <div class="field">
          <label>Wiederholen bis</label>
          <input type="date" id="t_until" value="${a.recurrence?.until || ''}" ${(a.recurrence?.freq || 'none') === 'none' ? 'disabled' : ''}>
        </div>
        ${Array.isArray(a.recurrence?.google) && (a.recurrence?.freq || 'none') === 'none' ? raw(`
        <div class="notice full mb16">Dieser Termin wiederholt sich in Google Kalender nach einer Regel, die
          Kontovia nicht darstellen kann (<code>${esc(a.recurrence.google.join(' ').replace(/^RRULE:/, ''))}</code>).
          Hier erscheint nur der erste Termin; die Regel bleibt in Google erhalten, solange Sie oben keine
          eigene Wiederholung wählen.</div>`) : ''}
        <div class="field full">
          <label>Notiz</label>
          <textarea id="t_notes" placeholder="Was ist zu tun, was wird gebraucht …">${a.notes || ''}</textarea>
        </div>
      </div>

      ${raw(todoSection())}

      <hr class="sep">
      <div class="row between mb8">
        <strong style="font-size:13px">Verknüpfte Buchungen und Rechnungen</strong>
        <div class="row" style="gap:6px">
          <button class="btn sm" id="btnLink">${icon('link', 14)} Vorhandene verknüpfen</button>
          <button class="btn sm primary" id="btnCreateTx">${icon('plus', 14)} Buchung anlegen</button>
        </div>
      </div>
      ${linked.length ? raw(linked.map((t) => `
        <div class="attach">
          <span class="thumb">${t.type === 'income' ? '↓' : '↑'}</span>
          <div class="name">
            ${esc(t.description)}
            <div class="tiny muted">${esc(fmtDate(t.date))} · ${esc(money(t.gross))} € · ${esc(sel.categoryName(t.categoryId))}${t.invoiceNumber ? ' · Nr. ' + esc(t.invoiceNumber) : ''}</div>
          </div>
          <button class="btn sm ghost" data-open-tx="${esc(t.id)}" title="Öffnen">${icon('eye', 14).__raw}</button>
          <button class="btn sm ghost" data-unlink="${esc(t.id)}" title="Verknüpfung lösen">${icon('x', 14).__raw}</button>
        </div>`).join(''))
        : raw('<p class="muted small">Noch nichts verknüpft. So halten Sie fest, welche Rechnung zu welchem Auftrag oder Termin gehört.</p>')}`;

    form.querySelector('#t_allDay').addEventListener('change', (e) => {
      a.allDay = e.target.checked;
      form.querySelector('#t_start').disabled = a.allDay;
      form.querySelector('#t_end').disabled = a.allDay;
    });
    form.querySelector('#t_freq').addEventListener('change', (e) => {
      form.querySelector('#t_until').disabled = e.target.value === 'none';
    });
    form.querySelector('#btnLink').addEventListener('click', async () => {
      collect();
      const picked = await pickTransactions(a.transactionIds);
      if (picked) { a.transactionIds = picked; draw(); }
    });
    form.querySelector('#btnCreateTx').addEventListener('click', async () => {
      collect();
      if (!a.title) { warn('Bitte zuerst einen Titel eintragen'); return; }
      // Den Termin sofort sichern – sonst wäre die Eingabe verloren, falls die
      // anschließende Buchung abgebrochen wird.
      await upsertAppointment(a);
      await saveTodos();
      m.close();
      // Vorbelegt mit dem, was der Termin schon weiß. Verknüpft wird genau die
      // Buchung aus diesem Dialog – bis Fassung 1.7 lauerte hier zwei Minuten
      // lang ein Zeitgeber und hängte jede neue Buchung an, auch eine, die
      // gerade per Cloud-Abgleich von einem anderen Gerät kam.
      const entwurf = {
        ...newTransactionDraft('income'),
        description: a.title,
        contactId: a.contactId || '',
        location: a.location || '',
        date: a.date <= todayISO() ? a.date : todayISO(),
        paidDate: '',
      };
      openTransactionDialog(entwurf, 'income', {
        onSaved: async (tx) => {
          const aktuell = sel.appointment(a.id) || a;
          if ((aktuell.transactionIds || []).includes(tx.id)) return;
          await upsertAppointment({ ...aktuell, transactionIds: [...(aktuell.transactionIds || []), tx.id] });
          ok('Termin und Buchung verknüpft', tx.description);
        },
      });
    });
    form.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', () => {
      collect();
      a.transactionIds = a.transactionIds.filter((x) => x !== b.dataset.unlink);
      draw();
    }));
    form.querySelectorAll('[data-open-tx]').forEach((b) => b.addEventListener('click', () => {
      openTransactionDialog(b.dataset.openTx);
    }));

    const neu = form.querySelector('#t_todoNew');
    const hinzufuegen = () => {
      collect();
      if (!addPendingTodo()) { neu.focus(); return; }
      draw();
      form.querySelector('#t_todoNew')?.focus();
    };
    form.querySelector('#btnTodoAdd').addEventListener('click', hinzufuegen);
    neu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); hinzufuegen(); }
    });
    form.querySelector('#t_todoPick')?.addEventListener('change', (e) => {
      const t = sel.todo(e.target.value);
      if (!t) return;
      collect();
      const zurueck = geloest.findIndex((x) => x.id === t.id);
      if (zurueck >= 0) geloest.splice(zurueck, 1);
      todos.push({ ...structuredClone(t), appointmentId: a.id });
      draw();
    });
    form.querySelectorAll('[data-appt-todo]').forEach((c) => c.addEventListener('change', () => {
      const t = todos.find((x) => x.id === c.dataset.apptTodo);
      if (!t) return;
      t.done = c.checked;
      t.doneAt = c.checked ? new Date().toISOString() : '';
      c.closest('.todo-item')?.classList.toggle('done', c.checked);
    }));
    form.querySelectorAll('[data-appt-todo-drop]').forEach((b) => b.addEventListener('click', () => {
      collect();
      const t = todos.find((x) => x.id === b.dataset.apptTodoDrop);
      todos = todos.filter((x) => x !== t);
      if (t && todosVorher.has(t.id)) geloest.push(todosVorher.get(t.id));
      draw();
    }));
  }

  function collect() {
    const g = (k) => form.querySelector('#t_' + k);
    a.title = g('title').value.trim();
    a.date = g('date').value || todayISO();
    a.allDay = g('allDay').checked;
    a.startTime = a.allDay ? '' : g('start').value;
    a.endTime = a.allDay ? '' : g('end').value;
    a.location = g('location').value.trim();
    a.contactId = g('contactId').value;
    a.notes = g('notes').value.trim();
    const freq = g('freq').value;
    // Eine Wiederholung aus Google, die Kontovia nicht darstellen kann, bleibt
    // erhalten, solange hier keine eigene gewählt wird.
    const google = freq === 'none' && Array.isArray(a.recurrence?.google) ? { google: a.recurrence.google } : {};
    a.recurrence = { freq, until: g('until').value, ...google };
    const kal = form.querySelector('#t_kalender');
    if (kal) {
      const k = weitere.find((x) => x.id === kal.value);
      if (k) a.extern = { calendarId: k.id, eventId: eventIdFor(a.id), calendarName: k.name || '' };
      else delete a.extern;
    }
  }

  /** Alles, was „Abbrechen“ verwerfen würde – Termin, Aufgaben und ein angefangener Aufgabentitel. */
  function stand() {
    collect();
    return JSON.stringify([a, todos, geloest.map((t) => t.id), form.querySelector('#t_todoNew')?.value.trim() || '']);
  }

  m.root.querySelector('#btnCancel').addEventListener('click', () => m.dismiss());
  m.root.querySelector('#btnSave').addEventListener('click', async () => {
    collect();
    if (!a.title) { warn('Bitte einen Titel eintragen'); return; }
    if (!a.allDay && a.startTime && a.endTime && a.endTime < a.startTime) {
      warn('Ende liegt vor dem Beginn', 'Bitte die Uhrzeiten prüfen. Ein Termin über Mitternacht lässt sich als ganztägig eintragen.');
      form.querySelector('#t_end')?.focus();
      return;
    }
    if (a.recurrence?.freq !== 'none' && a.recurrence?.until && a.recurrence.until < a.date) {
      warn('Wiederholung endet vor dem ersten Termin', 'Bitte „Wiederholen bis“ prüfen.');
      return;
    }
    fertig = true;
    await upsertAppointment(a);
    await saveTodos();
    m.close();
    ok(isNew ? 'Termin angelegt' : 'Termin gespeichert', `${fmtDateLong(a.date)}`);
    refresh();
  });
  m.root.querySelector('#btnDel')?.addEventListener('click', async () => {
    const auchGoogle = a.extern && calendarSettings().weitere.some((k) => k.id === a.extern.calendarId)
      ? ` Beim nächsten Abgleich wird er auch in Google Kalender „${kalenderName(a.extern)}“ gelöscht.` : '';
    if (!await confirmDialog({ title: 'Termin löschen?', text: `Der Termin wird entfernt. Verknüpfte Buchungen${todosVorher.size ? ' und Aufgaben' : ''} bleiben erhalten.${auchGoogle}`, confirmLabel: 'Löschen', danger: true })) return;
    fertig = true;
    await deleteAppointment(a.id);
    m.close();
    ok('Termin gelöscht');
    refresh();
  });
  m.root.querySelector('#btnDone')?.addEventListener('click', async () => {
    collect();
    a.done = !a.done;
    fertig = true;
    await upsertAppointment(a);
    await saveTodos();
    m.close();
    ok(a.done ? 'Als erledigt markiert' : 'Wieder als offen markiert');
    refresh();
  });

  draw();
  ausgangslage = stand();
}

/** Anzeigename des Google-Kalenders, aus dem ein Termin stammt. */
function kalenderName(extern) {
  return calendarSettings().weitere.find((k) => k.id === extern?.calendarId)?.name || extern?.calendarName || 'weiterer Kalender';
}

/** Auswahlliste, um bestehende Buchungen mit einem Termin zu verbinden. */
function pickTransactions(selectedIds = []) {
  return new Promise((resolve) => {
    let settled = false;
    const chosen = new Set(selectedIds);
    const m = modal({
      title: 'Buchungen verknüpfen',
      body: html`
        <input type="search" id="q" placeholder="Suchen …" class="mb8">
        <div id="list" style="max-height:50vh;overflow-y:auto"></div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    const list = m.root.querySelector('#list');
    const q = m.root.querySelector('#q');

    const paint = () => {
      const term = q.value.toLowerCase();
      const rows = sel.liveTransactions()
        .filter((t) => !term || (t.description + ' ' + (t.invoiceNumber || '')).toLowerCase().includes(term))
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 200);
      list.innerHTML = rows.map((t) => `
        <label class="attach" style="cursor:pointer">
          <input type="checkbox" value="${esc(t.id)}" ${chosen.has(t.id) ? 'checked' : ''}>
          <div class="name">${esc(t.description)}
            <div class="tiny muted">${esc(fmtDate(t.date))} · ${esc(money(t.gross))} € · ${esc(t.type === 'income' ? 'Einnahme' : 'Ausgabe')}</div>
          </div>
        </label>`).join('') || '<p class="muted small">Keine Buchungen gefunden.</p>';
      list.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) chosen.add(c.value); else chosen.delete(c.value);
      }));
    };
    q.addEventListener('input', paint);
    paint();

    m.root.querySelector('[data-yes]').addEventListener('click', () => { settled = true; m.close(); resolve([...chosen]); });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}
