/**
 * Kontovia – Aufgaben.
 *
 * Eine schlichte Liste zum Abhaken. Eine Aufgabe kann zu einem Termin gehören
 * („Unterlagen für den Steuerberater zusammenstellen“), muss aber nicht. Ohne
 * eigenes Fälligkeitsdatum gilt dann der Termin: Bis dahin sollte sie erledigt
 * sein, und so wird sie auch einsortiert.
 */

import { html, raw, esc, $, $$, fmtDate, fmtDateShort, todayISO, addDays, relativeDays, norm, int } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, emptyState } from '../lib/ui.js';
import { sel, upsertTodo, setTodoDone, deleteTodo, newTodoDraft } from '../lib/store.js';
import { refresh } from '../lib/router.js';
import { openAppointmentDialog } from './calendar.js';
import { expandAppointments } from '../lib/termine.js';

const state = {
  show: 'open', // open | done | all
  q: '',
};

/* -------------------------------------------------------------------------- */
/* Fälligkeit                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Der nächste Tag eines Termins ab heute – bei Serien das nächste Vorkommen.
 * Ist eine Serie schon ausgelaufen, gilt ihr letztes Vorkommen, nicht das erste.
 */
export function nextOccurrence(appt, today = todayISO()) {
  if (!appt) return '';
  const next = expandAppointments([appt], today, addDays(today, 800))[0];
  if (next) return next.occurrence;
  if (appt.date >= today) return appt.date;
  return expandAppointments([appt], appt.date, addDays(today, -1)).at(-1)?.occurrence || appt.date;
}

/**
 * Bis wann eine Aufgabe erledigt sein sollte: das eigene Datum, sonst der
 * verknüpfte Termin. `fromAppointment` sagt, woher das Datum stammt.
 */
export function dueOf(todo, today = todayISO()) {
  if (todo.dueDate) return { date: todo.dueDate, fromAppointment: false };
  const appt = todo.appointmentId ? sel.appointment(todo.appointmentId) : null;
  return appt ? { date: nextOccurrence(appt, today), fromAppointment: true } : { date: '', fromAppointment: false };
}

/** Offene Aufgaben in der Reihenfolge, in der sie drankommen. */
export function openTodosSorted(today = todayISO()) {
  return sel.todos()
    .filter((t) => !t.done)
    .map((t) => ({ t, due: dueOf(t, today).date }))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || String(a.t.createdAt || '').localeCompare(String(b.t.createdAt || '')))
    .map((x) => x.t);
}

function dueBadge(todo, today = todayISO()) {
  if (todo.done) return todo.doneAt ? `<span class="badge pos tiny">erledigt ${esc(fmtDateShort(todo.doneAt.slice(0, 10)))}</span>` : '';
  const { date, fromAppointment } = dueOf(todo, today);
  if (!date) return '';
  const cls = date < today ? 'neg' : date === today ? 'warn' : date <= addDays(today, 7) ? 'info' : '';
  const rel = relativeDays(date);
  const text = date < today ? `überfällig seit ${fmtDateShort(date)}` : `bis ${rel === 'heute' || rel === 'morgen' ? rel : fmtDateShort(date)}`;
  return `<span class="badge ${cls} tiny" title="${esc(fromAppointment ? `Kein eigenes Datum – es gilt der Termin am ${fmtDate(date)}` : `Fällig am ${fmtDate(date)}`)}">${icon('clock', 11).__raw} ${esc(text)}</span>`;
}

function apptChip(todo) {
  const appt = todo.appointmentId ? sel.appointment(todo.appointmentId) : null;
  if (!appt) return '';
  const tag = nextOccurrence(appt);
  return `<button type="button" class="chip todo-appt" data-open-appt="${esc(appt.id)}" title="Termin öffnen">
    ${icon('calendar', 12).__raw}<span class="truncate">${esc(fmtDateShort(tag))} · ${esc(appt.title || 'Termin')}</span></button>`;
}

/** Eine Zeile der Liste – auch in der Übersicht verwendet. */
export function todoRow(todo, { compact = false } = {}) {
  const notiz = !compact && todo.notes ? `<span class="todo-note truncate">${esc(todo.notes.split('\n')[0])}</span>` : '';
  return `<div class="todo-item${todo.done ? ' done' : ''}" data-todo="${esc(todo.id)}">
    <input type="checkbox" class="todo-check" data-toggle-todo="${esc(todo.id)}" ${todo.done ? 'checked' : ''}
      aria-label="${esc(todo.title)} ${todo.done ? 'wieder öffnen' : 'als erledigt abhaken'}">
    <div class="todo-main" data-edit-todo="${esc(todo.id)}" role="button" tabindex="0">
      <div class="todo-title">${esc(todo.title || '(ohne Titel)')}</div>
      <div class="todo-meta">${dueBadge(todo)}${apptChip(todo)}${notiz}</div>
    </div>
  </div>`;
}

/**
 * Haken, Bearbeiten und Termin in einer gezeichneten Liste. Nach jeder
 * Änderung zeichnet `redraw` neu.
 */
export function wireTodoRows(root, redraw) {
  $$('[data-toggle-todo]', root).forEach((c) => c.addEventListener('change', async () => {
    await setTodoDone(c.dataset.toggleTodo, c.checked);
    if (c.checked) ok('Erledigt', sel.todo(c.dataset.toggleTodo)?.title || '');
    redraw();
  }));
  $$('[data-edit-todo]', root).forEach((n) => {
    const open = () => openTodoDialog(n.dataset.editTodo);
    n.addEventListener('click', (e) => { if (!e.target.closest('[data-open-appt]')) open(); });
    n.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); open(); } });
  });
  $$('[data-open-appt]', root).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openAppointmentDialog(b.dataset.openAppt);
  }));
}

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = html`
    <div class="seg" role="group" aria-label="Welche Aufgaben">
      ${raw([['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']].map(([k, t]) =>
        `<button data-show="${k}" class="${state.show === k ? 'active' : ''}" aria-pressed="${state.show === k}">${t}</button>`).join(''))}
    </div>
    <button class="btn primary" id="newTodo">${icon('plus', 16)} Aufgabe</button>`;
  $$('[data-show]', actions).forEach((b) => b.addEventListener('click', () => {
    state.show = b.dataset.show;
    $$('[data-show]', actions).forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    draw(root);
  }));
  $('#newTodo', actions).addEventListener('click', () => openTodoDialog(null));
  draw(root);
}

function matches(t) {
  if (!state.q) return true;
  const appt = t.appointmentId ? sel.appointment(t.appointmentId) : null;
  return norm(`${t.title} ${t.notes || ''} ${appt?.title || ''}`).includes(norm(state.q));
}

function draw(root) {
  const today = todayISO();
  const alle = sel.todos();
  const offen = alle.filter((t) => !t.done);
  const erledigt = alle.filter((t) => t.done);

  let body;
  if (!alle.length) {
    body = emptyState('Noch keine Aufgaben', 'Oben eintragen und mit Enter anlegen. Eine Aufgabe lässt sich mit einem Termin verknüpfen, muss aber nicht.').__raw;
  } else if (state.show === 'done') {
    const rows = erledigt.filter(matches).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
    body = rows.length ? group('Erledigt', rows) : emptyState('Nichts gefunden', state.q ? 'Keine erledigte Aufgabe passt zur Suche.' : 'Noch nichts abgehakt.').__raw;
  } else {
    const sorted = openTodosSorted(today).filter(matches);
    const woche = addDays(today, 7);
    const teile = [
      ['Überfällig', sorted.filter((t) => { const d = dueOf(t, today).date; return d && d < today; })],
      ['Heute', sorted.filter((t) => dueOf(t, today).date === today)],
      ['Nächste sieben Tage', sorted.filter((t) => { const d = dueOf(t, today).date; return d > today && d <= woche; })],
      ['Später', sorted.filter((t) => dueOf(t, today).date > woche)],
      ['Ohne Datum', sorted.filter((t) => !dueOf(t, today).date)],
    ];
    body = teile.filter(([, rows]) => rows.length).map(([title, rows]) => group(title, rows)).join('');
    if (state.show === 'all') {
      const fertig = erledigt.filter(matches).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
      if (fertig.length) body += group('Erledigt', fertig);
    }
    if (!body) {
      body = state.q
        ? emptyState('Nichts gefunden', 'Keine Aufgabe passt zur Suche.').__raw
        : emptyState('Alles erledigt', erledigt.length ? `${int(erledigt.length)} erledigte Aufgaben stehen unter „Erledigt“.` : 'Keine offenen Aufgaben.').__raw;
    }
  }

  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h3>Aufgaben</h3>
        <span class="sub">${int(offen.length)} offen · ${int(erledigt.length)} erledigt</span>
        <div class="spacer"></div>
        ${alle.length > 6 ? raw(`<input type="search" class="search" id="todoSearch" placeholder="Suchen …" aria-label="Aufgaben durchsuchen" value="${esc(state.q)}" style="max-width:220px">`) : ''}
      </div>
      <div class="card-body">
        <form class="todo-add" id="todoAdd" autocomplete="off">
          <input id="todoTitle" placeholder="Neue Aufgabe, z. B. Belege für Oktober einscannen" aria-label="Neue Aufgabe">
          <input type="date" id="todoDue" aria-label="Fällig am (freiwillig)" title="Fällig am (freiwillig)">
          <button class="btn primary" type="submit">${icon('plus', 15)} Hinzufügen</button>
        </form>
        <div id="todoList">${raw(body)}</div>
      </div>
    </div>`;

  $('#todoAdd', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#todoTitle', root).value.trim();
    if (!title) { $('#todoTitle', root).focus(); return; }
    await upsertTodo(newTodoDraft({ title, dueDate: $('#todoDue', root).value || '' }));
    // In der Ansicht „Erledigt“ taucht die neue Aufgabe nicht auf – dann wenigstens bestätigen.
    if (state.show === 'done') ok('Aufgabe angelegt', `${title} – steht unter „Offen“`);
    draw(root);
    $('#todoTitle', root)?.focus();
  });
  const suche = $('#todoSearch', root);
  suche?.addEventListener('input', () => {
    state.q = suche.value;
    const pos = suche.selectionStart;
    draw(root);
    const neu = $('#todoSearch', root);
    neu?.focus();
    neu?.setSelectionRange(pos, pos);
  });
  wireTodoRows(root, () => draw(root));
}

function group(title, rows) {
  return `<div class="todo-group">
    <div class="todo-group-title">${esc(title)} <span class="muted">${rows.length}</span></div>
    ${rows.map((t) => todoRow(t)).join('')}
  </div>`;
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Termine zur Auswahl: kommende zuerst, danach die der letzten drei Monate.
 * Der schon verknüpfte ist immer dabei, auch wenn er weiter zurückliegt.
 */
function appointmentOptions(selectedId) {
  const today = todayISO();
  const kommend = [];
  const vergangen = [];
  for (const a of sel.appointments()) {
    const tag = nextOccurrence(a, today);
    if (tag >= today) kommend.push({ a, tag });
    else if (tag >= addDays(today, -92) || a.id === selectedId) vergangen.push({ a, tag });
  }
  kommend.sort((x, y) => (x.tag + (x.a.startTime || '')).localeCompare(y.tag + (y.a.startTime || '')));
  vergangen.sort((x, y) => y.tag.localeCompare(x.tag));
  const opt = ({ a, tag }) => `<option value="${esc(a.id)}" ${a.id === selectedId ? 'selected' : ''}>${esc(fmtDate(tag))} · ${esc(a.title || 'Termin')}${(a.recurrence?.freq || 'none') !== 'none' ? ' (Serie)' : ''}</option>`;
  return `<option value="">– kein Termin –</option>`
    + (kommend.length ? `<optgroup label="Kommende Termine">${kommend.map(opt).join('')}</optgroup>` : '')
    + (vergangen.length ? `<optgroup label="Vergangene Termine">${vergangen.map(opt).join('')}</optgroup>` : '');
}

export function openTodoDialog(id, preset = {}) {
  const existing = id ? sel.todo(id) : null;
  const t = existing ? structuredClone(existing) : newTodoDraft(preset);
  const isNew = !existing;
  let ausgangslage = null;
  let fertig = false;
  const stand = () => JSON.stringify(['title', 'due', 'appt', 'notes', 'done'].map((k) => {
    const el = m.root.querySelector('#d_' + k);
    return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : null;
  }));

  const m = modal({
    title: isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten',
    // Vor dem Wegklicken nachfragen, wenn etwas eingetragen wurde.
    confirmDismiss: () => ausgangslage !== null && !fertig && stand() !== ausgangslage,
    body: html`
      <div class="field">
        <label for="d_title">Aufgabe *</label>
        <input id="d_title" value="${t.title}" placeholder="z. B. Unterlagen für den Steuerberater zusammenstellen">
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="d_due">Fällig am</label>
          <input type="date" id="d_due" value="${t.dueDate || ''}">
          <span class="hint">Freiwillig. Ohne Datum gilt der verknüpfte Termin.</span>
        </div>
        <div class="field">
          <label for="d_appt">Gehört zum Termin</label>
          <select id="d_appt">${raw(appointmentOptions(t.appointmentId))}</select>
          <span class="hint">Freiwillig. Die Aufgabe steht dann auch im Termin.</span>
        </div>
        <div class="field full">
          <label for="d_notes">Notiz</label>
          <textarea id="d_notes" placeholder="Was genau, wer, wo …">${t.notes || ''}</textarea>
        </div>
        ${!isNew ? raw(`<label class="check full"><input type="checkbox" id="d_done" ${t.done ? 'checked' : ''}> erledigt</label>`) : ''}
      </div>`,
    foot: `
      <div class="left row" style="gap:8px">
        ${!isNew ? `<button class="btn danger sm" id="btnDel">${icon('trash', 14).__raw} Löschen</button>` : ''}
      </div>
      <button class="btn" id="btnCancel">Abbrechen</button>
      <button class="btn primary" id="btnSave">${isNew ? 'Aufgabe anlegen' : 'Speichern'}</button>`,
  });
  const g = (k) => m.root.querySelector('#d_' + k);

  ausgangslage = stand();
  m.root.querySelector('#btnCancel').addEventListener('click', () => m.dismiss());
  m.root.querySelector('#btnSave').addEventListener('click', async () => {
    t.title = g('title').value.trim();
    if (!t.title) { warn('Bitte die Aufgabe benennen'); g('title').focus(); return; }
    fertig = true;
    t.dueDate = g('due').value || '';
    t.appointmentId = g('appt').value || '';
    t.notes = g('notes').value.trim();
    const done = g('done') ? g('done').checked : t.done;
    if (done !== t.done) t.doneAt = done ? new Date().toISOString() : '';
    t.done = done;
    await upsertTodo(t);
    m.close();
    ok(isNew ? 'Aufgabe angelegt' : 'Aufgabe gespeichert', t.title);
    refresh();
  });
  m.root.querySelector('#btnDel')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Aufgabe löschen?', text: `„${t.title}“ wird entfernt.`, confirmLabel: 'Löschen', danger: true })) return;
    fertig = true;
    await deleteTodo(t.id);
    m.close();
    ok('Aufgabe gelöscht');
    refresh();
  });
}
