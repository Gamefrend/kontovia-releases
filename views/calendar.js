/** Kontovia – Terminkalender, verknüpfbar mit Buchungen und Rechnungen. */

import {
  html, raw, esc, $, $$, money, fmtDate, fmtDateLong, todayISO, toISO, fromISO, uid,
  addMonths, addDays, monthStart, monthEnd, MONTHS, WEEKDAYS, isoWeek, relativeDays, sortBy, int,
} from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, emptyState } from '../lib/ui.js';
import { store, sel, upsertAppointment, deleteAppointment, commit } from '../lib/store.js';
import { depositInfo } from '../lib/calc.js';
import { navigate, refresh } from '../lib/router.js';
import { openTransactionDialog } from './transactions.js';
import { openCalendarSyncDialog, statusText } from './calendarsync.js';
import { calState, onCalendarSync, refreshCalendarStatus, syncCalendar } from '../lib/gcalsync.js';

const state = {
  cursor: monthStart(todayISO()),
  mode: 'month', // month | agenda
  showDue: true,
  showEvents: true,
  showDone: true,
};

const FREQ = { none: 'einmalig', weekly: 'wöchentlich', biweekly: 'alle zwei Wochen', monthly: 'monatlich', yearly: 'jährlich' };

/* -------------------------------------------------------------------------- */
/* Wiederholungen auflösen                                                     */
/* -------------------------------------------------------------------------- */

export function expandAppointments(appts, from, to) {
  const out = [];
  for (const a of appts) {
    const freq = a.recurrence?.freq || 'none';
    if (freq === 'none') {
      if (a.date >= from && a.date <= to) out.push({ ...a, occurrence: a.date });
      continue;
    }
    const until = a.recurrence?.until || to;
    let d = a.date;
    let guard = 0;
    while (d <= to && d <= until && guard++ < 1200) {
      if (d >= from) out.push({ ...a, occurrence: d, isRepeat: d !== a.date });
      if (freq === 'weekly') d = addDays(d, 7);
      else if (freq === 'biweekly') d = addDays(d, 14);
      else if (freq === 'monthly') d = addMonths(d, 1);
      else if (freq === 'yearly') d = addMonths(d, 12);
      else break;
    }
  }
  return out;
}

/** Zahlungstermine (Fälligkeiten offener Rechnungen) als Kalendereinträge. */
function dueEntries(from, to) {
  return sel.transactions()
    .filter((t) => !t.voided && !t.paidDate && (t.dueDate || t.date) >= from && (t.dueDate || t.date) <= to)
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
    if (t.voided) continue;
    const dep = depositInfo(t);
    if (!dep?.eventDate || dep.eventDate < from || dep.eventDate > to) continue;
    out.push({
      id: 'evt_' + t.id,
      isEvent: true,
      txId: t.id,
      occurrence: dep.eventDate,
      title: `${t.description}${t.location ? ' · ' + t.location : ''}`
        + (dep.remaining > 0 ? ` – Restbetrag ${money(dep.remaining)} €` : ''),
      allDay: true,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = html`
    <div class="seg">
      <button data-mode="month" class="${state.mode === 'month' ? 'active' : ''}">Monat</button>
      <button data-mode="agenda" class="${state.mode === 'agenda' ? 'active' : ''}">Liste</button>
    </div>
    <button class="btn" id="calSync" title="Mit Google Kalender oder per Kalenderdatei (.ics) abgleichen">${icon('refresh', 16)} Abgleich</button>
    <button class="btn primary" id="newAppt">${icon('plus', 16)} Termin</button>`;
  $$('[data-mode]', actions).forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    render(root, params, { actions });
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
  const byDay = new Map();
  for (const e of [...events, ...dues, ...veranstaltungen]) {
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
        <span class="badge">${int(monthEvents.length)} Termine</span>
        <label class="check"><input type="checkbox" id="tDue" ${state.showDue ? 'checked' : ''}> Zahlungstermine</label>
        <label class="check"><input type="checkbox" id="tEvent" ${state.showEvents ? 'checked' : ''}> Veranstaltungen</label>
        <label class="check"><input type="checkbox" id="tDone" ${state.showDone ? 'checked' : ''}> Erledigte</label>
      </div>
      <div class="cal-grid">
        ${raw(WEEKDAYS.map((w) => `<div class="cal-head">${w}</div>`).join(''))}
        ${raw(cells.map((d) => cellHtml(d, first, byDay.get(d) || [])).join(''))}
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>Termine im ${esc(monthName)}</h3></div>
      <div class="card-body ${monthEvents.length ? 'tight' : ''}">
        ${monthEvents.length
          ? raw('<div style="padding:0 16px">' + sortBy(monthEvents, (e) => e.occurrence + (e.startTime || '')).map(agendaRow).join('') + '</div>')
          : emptyState('Keine Termine', 'In diesem Monat ist nichts eingetragen.')}
      </div>
    </div>`;

  $('#prev', root).addEventListener('click', () => { state.cursor = addMonths(state.cursor, -1); draw(root); });
  $('#next', root).addEventListener('click', () => { state.cursor = addMonths(state.cursor, 1); draw(root); });
  $('#today', root).addEventListener('click', () => { state.cursor = monthStart(todayISO()); draw(root); });
  $('#tDue', root).addEventListener('change', (e) => { state.showDue = e.target.checked; draw(root); });
  $('#tEvent', root).addEventListener('change', (e) => { state.showEvents = e.target.checked; draw(root); });
  $('#tDone', root).addEventListener('change', (e) => { state.showDone = e.target.checked; draw(root); });

  wireEvents(root);
  wireSyncBadge(root);
}

function cellHtml(date, monthRef, items) {
  const other = date.slice(0, 7) !== monthRef.slice(0, 7);
  const dow = (fromISO(date).getDay() + 6) % 7;
  const cls = ['cal-cell', other ? 'other' : '', date === todayISO() ? 'today' : '', dow >= 5 ? 'weekend' : ''].filter(Boolean).join(' ');
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return `<div class="${cls}" data-day="${date}" tabindex="0" role="button" aria-label="${esc(fmtDate(date))}, neuer Termin">
    <div class="cal-day">${Number(date.slice(8, 10))}</div>
    ${shown.map((e) => e.isDue
      ? `<div class="cal-ev" style="background:var(--warn-soft);color:var(--warn);border-left-color:var(--warn)" data-tx="${esc(e.txId)}" title="${esc(e.title)}">${esc(money(e.amount))} € ${esc(e.type === 'income' ? '↓' : '↑')}</div>`
      : e.isEvent
      ? `<div class="cal-ev" style="background:var(--accent-soft);color:var(--accent);border-left-color:var(--accent)" data-tx="${esc(e.txId)}" title="${esc(e.title)}">${esc(e.title)}</div>`
      : `<div class="cal-ev ${e.done ? 'done' : ''}" data-appt="${esc(e.id)}" title="${esc(e.title)}" ${e.color ? `style="border-left-color:${esc(e.color)};color:${esc(e.color)}"` : ''}>${e.allDay ? '' : esc((e.startTime || '') + ' ')}${esc(e.title)}</div>`).join('')}
    ${more > 0 ? `<div class="cal-more">+ ${more} weitere</div>` : ''}
  </div>`;
}

function agendaRow(e) {
  const linked = (e.transactionIds || []).length;
  // Veranstaltungen stammen aus einer Buchung und führen auch dorthin zurück.
  const anchor = e.isEvent ? `data-tx="${esc(e.txId)}"` : `data-appt="${esc(e.id)}"`;
  return `<div class="agenda-item" ${anchor}>
    <div class="agenda-date">
      <div class="d">${esc(e.occurrence.slice(8, 10))}</div>
      <div class="m">${esc(['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'][Number(e.occurrence.slice(5, 7)) - 1])}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="strong truncate">${e.done ? '✓ ' : ''}${esc(e.title)}${e.isRepeat ? ' <span class="badge tiny">Wiederholung</span>' : ''}${e.isEvent ? ' <span class="badge info tiny">Veranstaltung</span>' : ''}</div>
      <div class="tiny muted">
        ${e.allDay ? 'ganztägig' : esc((e.startTime || '') + (e.endTime ? ' – ' + e.endTime : ''))}
        ${e.location ? ' · ' + esc(e.location) : ''}
        ${e.contactId ? ' · ' + esc(sel.contactName(e.contactId)) : ''}
        · KW ${isoWeek(e.occurrence)}
      </div>
    </div>
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
  ], (e) => e.occurrence + (e.startTime || ''));

  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h3>Kommende Termine</h3>
        <span class="sub">nächste zwölf Monate</span>
        <div class="spacer"></div>
        ${raw(syncBadge())}
        <label class="check"><input type="checkbox" id="tDone" ${state.showDone ? 'checked' : ''}> Erledigte zeigen</label>
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

  $('#tDone', root).addEventListener('change', (e) => { state.showDone = e.target.checked; draw(root); });
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

  const m = modal({
    title: isNew ? 'Neuer Termin' : 'Termin bearbeiten',
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

  function draw() {
    const linked = (a.transactionIds || []).map(sel.transaction).filter(Boolean);
    form.innerHTML = html`
      <div class="field">
        <label>Titel *</label>
        <input id="t_title" value="${esc(a.title)}" placeholder="z. B. Steuerberater-Termin, Montage Kunde Meier">
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
          <input id="t_location" value="${esc(a.location || '')}">
        </div>
        <div class="field">
          <label>Kontakt</label>
          <select id="t_contactId">
            <option value="">– keiner –</option>
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
          <textarea id="t_notes" placeholder="Was ist zu tun, was wird gebraucht …">${esc(a.notes || '')}</textarea>
        </div>
      </div>

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
      m.close();
      openTransactionDialog(null, 'income');

      // Sobald eine neue Buchung entsteht, wird sie mit dem Termin verbunden.
      const before = new Set(sel.transactions().map((t) => t.id));
      const check = setInterval(async () => {
        const fresh = sel.transactions().find((t) => !before.has(t.id));
        if (!fresh) return;
        clearInterval(check);
        const aktuell = sel.appointment(a.id) || a;
        aktuell.transactionIds = [...(aktuell.transactionIds || []), fresh.id];
        await upsertAppointment(aktuell);
        ok('Termin und Buchung verknüpft', fresh.description);
        refresh();
      }, 400);
      // Nicht endlos warten: wer die Buchung abbricht, soll keinen Zombie-Timer hinterlassen.
      setTimeout(() => clearInterval(check), 120000);
    });
    form.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', () => {
      collect();
      a.transactionIds = a.transactionIds.filter((x) => x !== b.dataset.unlink);
      draw();
    }));
    form.querySelectorAll('[data-open-tx]').forEach((b) => b.addEventListener('click', () => {
      openTransactionDialog(b.dataset.openTx);
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
  }

  m.root.querySelector('#btnCancel').addEventListener('click', () => m.close());
  m.root.querySelector('#btnSave').addEventListener('click', async () => {
    collect();
    if (!a.title) { warn('Bitte einen Titel eintragen'); return; }
    await upsertAppointment(a);
    m.close();
    ok(isNew ? 'Termin angelegt' : 'Termin gespeichert', `${fmtDateLong(a.date)}`);
    refresh();
  });
  m.root.querySelector('#btnDel')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Termin löschen?', text: 'Der Termin wird entfernt. Verknüpfte Buchungen bleiben erhalten.', confirmLabel: 'Löschen', danger: true })) return;
    await deleteAppointment(a.id);
    m.close();
    ok('Termin gelöscht');
    refresh();
  });
  m.root.querySelector('#btnDone')?.addEventListener('click', async () => {
    collect();
    a.done = !a.done;
    await upsertAppointment(a);
    m.close();
    ok(a.done ? 'Als erledigt markiert' : 'Wieder als offen markiert');
    refresh();
  });

  draw();
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
