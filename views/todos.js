/**
 * Kontovia – Aufgaben.
 *
 * Eine Liste zum Abhaken. Eine Aufgabe hat einen Titel, auf Wunsch einen
 * formatierten Text mit Bildern, Unteraufgaben, ein Fälligkeitsdatum und
 * Verknüpfungen: mit einem Termin, mit Buchungen, Kontakten und Rechnungen.
 * Ohne eigenes Datum gilt der Termin: Bis dahin sollte sie erledigt sein, und
 * so wird sie auch einsortiert.
 *
 * Drei Arten: einfach, Ziel (eine Menge bis zu einer Frist, mit Fortschritt,
 * Tagesplan und Hochrechnung) und wiederholt (kommt nach dem Abhaken wieder).
 * Gerechnet wird in lib/aufgaben.js, geschrieben in lib/store.js.
 */

import { html, raw, esc, $, $$, fmtDate, fmtDateShort, todayISO, addDays, relativeDays, norm, int } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, emptyState } from '../lib/ui.js';
import { sel, store, upsertTodo, setTodoDone, deleteTodo, newTodoDraft, zielFortschritt } from '../lib/store.js';
import { refresh, navigate } from '../lib/router.js';
import { openAppointmentDialog } from './calendar.js';
import { expandAppointments } from '../lib/termine.js';
import { prefs, setPref } from '../lib/prefs.js';
import { openPopover } from '../lib/popover.js';
import { richEditor, bilderEntfernen } from '../lib/richeditor.js';
import { aufgabenHtml, klartext, bildIds } from '../lib/richtext.js';
import {
  teilaufgaben, neueTeilaufgabe, fortschritt, verknuepfungen, verknuepfungHinzu, verknuepfungenRoh, aufgabenZu,
  horizontNormal, horizontEnde, horizontText, horizontTitel, aufgabenText, EINHEITEN, VERKNUEPFUNG_ARTEN,
  ARTEN, aufgabenArt, zielRechnung, zielSatz, zielNormal, mengeText, wiederholungNormal, wiederholungText, WIEDERHOLUNG_EINHEITEN,
} from '../lib/aufgaben.js';
import { sucheIndex, suchen } from '../lib/suchindex.js';

const state = {
  show: 'open', // open | done | all
  q: '',
};

const horizont = () => horizontNormal(prefs.aufgabenHorizont);

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
  return `<span class="badge ${cls} tiny" title="${esc(fromAppointment ? `Kein eigenes Datum, es gilt der Termin am ${fmtDate(date)}` : `Fällig am ${fmtDate(date)}`)}">${icon('clock', 11).__raw} ${esc(text)}</span>`;
}

function apptChip(todo) {
  const appt = todo.appointmentId ? sel.appointment(todo.appointmentId) : null;
  if (!appt) return '';
  const tag = nextOccurrence(appt);
  return `<button type="button" class="chip todo-appt" data-open-appt="${esc(appt.id)}" title="Termin öffnen">
    ${icon('calendar', 12).__raw}<span class="truncate">${esc(fmtDateShort(tag))} · ${esc(appt.title || 'Termin')}</span></button>`;
}

const LINK_ICON = { buchung: 'book', kontakt: 'users', rechnung: 'invoice' };

/** Öffnet das Ziel einer Verknüpfung. Die Ansichten werden erst jetzt geladen: Sie kennen ihrerseits die Aufgaben. */
export async function verknuepfungOeffnen(typ, id) {
  if (typ === 'buchung') (await import('./transactions.js')).openTransactionDialog(id);
  else if (typ === 'kontakt') (await import('./master.js')).openStammdatum('contacts', id);
  else if (typ === 'rechnung') navigate('rechnungen', { id });
}

function linkChips(todo, max = 3) {
  const liste = verknuepfungen(store.db, todo);
  const sicht = liste.slice(0, max).map((v) => `<button type="button" class="chip todo-appt" data-open-link="${esc(v.typ)}:${esc(v.id)}"
    title="${esc(`${VERKNUEPFUNG_ARTEN[v.typ]} öffnen: ${v.titel}`)}">${icon(LINK_ICON[v.typ], 12).__raw}<span class="truncate">${esc(v.titel)}</span></button>`);
  if (liste.length > max) sicht.push(`<span class="badge tiny" title="${esc(liste.slice(max).map((v) => v.titel).join(', '))}">+${liste.length - max}</span>`);
  return sicht.join('');
}

/** Erste Zeile des Textes, für die Liste. */
function textAuszug(todo) {
  return klartext(aufgabenHtml(todo)).split('\n').find((z) => z.trim()) || '';
}

const ZIEL_STATUS = {
  geschafft: ['pos', 'geschafft'],
  imPlan: ['pos', 'im Plan'],
  hinten: ['warn', 'im Rückstand'],
  verfehlt: ['neg', 'Frist vorbei'],
  ohneDatum: ['', ''],
};

/** Fortschrittsbalken, Satz zum Stand und Eintragen des Fortschritts bei einem Ziel. */
function zielBlock(todo, compact) {
  const heute = todayISO();
  const r = zielRechnung(todo, heute);
  const [kl, text] = ZIEL_STATUS[r.status];
  const e = r.einheit ? ` ${r.einheit}` : '';
  const prog = r.prognose !== null && r.status !== 'geschafft' && r.status !== 'verfehlt'
    ? `<span class="muted" title="Hochgerechnet aus dem bisherigen Tempo (${esc(mengeText(r.tempo))}${esc(e)} pro Tag)">Mit diesem Tempo: ${esc(mengeText(r.prognose))}${esc(e)}</span>` : '';
  const eintragen = !compact && !todo.done
    ? `<div class="todo-ziel-add">
        <input type="number" step="any" value="1" data-ziel-menge aria-label="Menge${esc(e)}">
        <button type="button" class="btn sm" data-ziel-add="${esc(todo.id)}">${icon('plus', 13).__raw} Eintragen</button>
      </div>` : '';
  return `<div class="todo-ziel">
    <div class="bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r.anteil * 100)}"><div class="bar-fill" style="width:${Math.round(r.anteil * 100)}%;background:var(--${r.status === 'hinten' ? 'warn' : r.status === 'verfehlt' ? 'neg' : 'accent'}, var(--accent))"></div></div>
    <div class="todo-ziel-text">${text ? `<span class="badge tiny ${kl}">${esc(text)}</span> ` : ''}${esc(zielSatz(todo, heute))}${prog ? ` · ${prog}` : ''}</div>
    ${eintragen}
  </div>`;
}

/** Eine Zeile der Liste – auch in der Übersicht verwendet. */
export function todoRow(todo, { compact = false } = {}) {
  const auszug = !compact ? textAuszug(todo) : '';
  const notiz = auszug ? `<span class="todo-note truncate">${esc(auszug)}</span>` : '';
  const fort = fortschritt(todo);
  const teile = fort.gesamt
    ? `<span class="badge tiny ${fort.fertig === fort.gesamt ? 'pos' : ''}" title="${fort.fertig} von ${fort.gesamt} Unteraufgaben erledigt">${icon('todo', 11).__raw} ${fort.fertig}/${fort.gesamt}</span>` : '';
  const bilder = bildIds(aufgabenHtml(todo)).length
    ? `<span class="badge tiny" title="Mit Bild">${icon('image', 11).__raw}</span>` : '';
  const unter = !compact && !todo.done && fort.gesamt
    ? `<div class="todo-subs">${teilaufgaben(todo).map((s) => `
        <label class="todo-sub${s.done ? ' done' : ''}">
          <input type="checkbox" data-toggle-sub="${esc(todo.id)}:${esc(s.id)}" ${s.done ? 'checked' : ''}>
          <span>${esc(s.title)}</span>
        </label>`).join('')}</div>` : '';
  const art = aufgabenArt(todo);
  const wdh = art === 'wiederholend'
    ? `<span class="badge tiny" title="Nach dem Abhaken kommt die Aufgabe von selbst wieder${todo.wiederholung?.anzahl ? `, bisher ${int(todo.wiederholung.anzahl)}-mal erledigt` : ''}">${icon('refresh', 11).__raw} ${esc(wiederholungText(todo.wiederholung))}</span>` : '';
  return `<div class="todo-item${todo.done ? ' done' : ''}" data-todo="${esc(todo.id)}">
    <input type="checkbox" class="todo-check" data-toggle-todo="${esc(todo.id)}" ${todo.done ? 'checked' : ''}
      aria-label="${esc(todo.title)} ${todo.done ? 'wieder öffnen' : art === 'ziel' ? 'als geschafft abhaken' : 'als erledigt abhaken'}">
    <div class="todo-main" data-edit-todo="${esc(todo.id)}" role="button" tabindex="0">
      <div class="todo-title">${esc(todo.title || '(ohne Titel)')}</div>
      <div class="todo-meta">${dueBadge(todo)}${wdh}${teile}${bilder}${apptChip(todo)}${compact ? '' : linkChips(todo)}${notiz}</div>
      ${art === 'ziel' ? zielBlock(todo, compact) : ''}
      ${unter}
    </div>
  </div>`;
}

/**
 * Haken, Bearbeiten, Unteraufgaben, Termin und Verknüpfungen in einer
 * gezeichneten Liste. Nach jeder Änderung zeichnet `redraw` neu.
 */
export function wireTodoRows(root, redraw) {
  $$('[data-toggle-todo]', root).forEach((c) => c.addEventListener('change', async () => {
    await setTodoDone(c.dataset.toggleTodo, c.checked);
    const t = sel.todo(c.dataset.toggleTodo);
    if (c.checked && t && aufgabenArt(t) === 'wiederholend') ok('Erledigt', `${t.title}, nächstes Mal am ${fmtDate(t.dueDate)}`);
    else if (c.checked) ok('Erledigt', t?.title || '');
    redraw();
  }));
  $$('[data-ziel-add]', root).forEach((b) => {
    const eintragen = async () => {
      const menge = Number(String(b.parentElement.querySelector('[data-ziel-menge]').value).replace(',', '.'));
      if (!Number.isFinite(menge) || menge === 0) { warn('Bitte eine Menge eintragen'); return; }
      await zielFortschritt(b.dataset.zielAdd, menge);
      const t = sel.todo(b.dataset.zielAdd);
      if (t?.done) ok('Ziel geschafft', t.title);
      redraw();
    };
    b.addEventListener('click', eintragen);
    b.parentElement.querySelector('[data-ziel-menge]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); eintragen(); } });
  });
  $$('[data-toggle-sub]', root).forEach((c) => c.addEventListener('change', async () => {
    const [tid, sid] = c.dataset.toggleSub.split(':');
    const t = sel.todo(tid);
    if (!t) return;
    await upsertTodo({ ...t, subtasks: teilaufgaben(t).map((s) => (s.id === sid ? { ...s, done: c.checked } : s)) });
    redraw();
  }));
  $$('[data-edit-todo]', root).forEach((n) => {
    const open = () => openTodoDialog(n.dataset.editTodo, {}, { nachSpeichern: redraw });
    n.addEventListener('click', (e) => { if (!e.target.closest('[data-open-appt],[data-open-link],.todo-subs,.todo-ziel-add')) open(); });
    n.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); open(); } });
  });
  $$('[data-open-appt]', root).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openAppointmentDialog(b.dataset.openAppt);
  }));
  $$('[data-open-link]', root).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const [typ, id] = b.dataset.openLink.split(':');
    verknuepfungOeffnen(typ, id);
  }));
}

/* -------------------------------------------------------------------------- */
/* Aufgaben an anderer Stelle (Buchung, Kontakt, Rechnung)                     */
/* -------------------------------------------------------------------------- */

/**
 * Füllt `el` mit den Aufgaben, die zu einem Ziel gehören, und einem Knopf für
 * eine neue. Zeichnet sich nach jeder Änderung selbst neu.
 * @param {HTMLElement} el
 * @param {'buchung'|'kontakt'|'rechnung'} typ
 * @param {string} id
 * @param {{titel?:string, vorgabe?:string}} [o]  Überschrift; Vorschlag für den Titel einer neuen Aufgabe
 */
export function aufgabenAbschnitt(el, typ, id, { titel = 'Aufgaben dazu', vorgabe = '' } = {}) {
  const zeichnen = () => {
    if (!el.isConnected) return;
    const liste = aufgabenZu(store.db, typ, id).sort((a, b) => Number(!!a.done) - Number(!!b.done) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    el.innerHTML = `
      <div class="row between" style="gap:8px;margin-bottom:${liste.length ? 4 : 0}px">
        <strong class="small">${esc(titel)}${liste.length ? ` <span class="muted">${liste.filter((t) => !t.done).length} offen</span>` : ''}</strong>
        <button type="button" class="btn sm ghost" data-neue-aufgabe>${icon('plus', 14).__raw} Aufgabe</button>
      </div>
      ${liste.length ? `<div class="todo-mini">${liste.map((t) => todoRow(t, { compact: true })).join('')}</div>` : ''}`;
    wireTodoRows(el, zeichnen);
    el.querySelector('[data-neue-aufgabe]').addEventListener('click', () => {
      openTodoDialog(null, { title: vorgabe, links: [{ typ, id }] }, { nachSpeichern: zeichnen });
    });
  };
  zeichnen();
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
  const ziele = verknuepfungen(store.db, t).map((v) => v.titel).join(' ');
  return norm(`${aufgabenText(t)} ${appt?.title || ''} ${ziele}`).includes(norm(state.q));
}

/** Das Fenster, in dem man den Vorschauzeitraum der Liste einstellt. */
function zeitraumWaehlen(anker, root) {
  const VORSCHLAEGE = [[7, 'tage'], [14, 'tage'], [4, 'wochen'], [1, 'monate'], [3, 'monate'], [6, 'monate']];
  openPopover(anker, {
    label: 'Zeitraum der Vorschau',
    className: 'menu hz',
    align: 'end',
    build: (pop, handle) => {
      const jetzt = horizont();
      pop.innerHTML = `
        <div class="menu-title">Vorschau in der Liste</div>
        ${VORSCHLAEGE.map(([n, e]) => {
          const an = jetzt.n === n && jetzt.einheit === e;
          return `<button type="button" class="menu-opt" data-nav aria-pressed="${an}" data-n="${n}" data-e="${e}">${icon('check', 14).__raw}<span class="menu-label">${esc(horizontTitel({ n, einheit: e }))}</span></button>`;
        }).join('')}
        <div class="menu-sep"></div>
        <div class="menu-title">Eigener Zeitraum</div>
        <form class="hz-frei" autocomplete="off">
          <span>Nächste</span>
          <input type="number" id="hzN" min="1" max="365" step="1" value="${jetzt.n}" aria-label="Anzahl">
          <select id="hzE" aria-label="Einheit">${Object.entries(EINHEITEN).map(([k, [, viele]]) => `<option value="${k}" ${k === jetzt.einheit ? 'selected' : ''}>${viele}</option>`).join('')}</select>
          <button class="btn sm primary" type="submit">OK</button>
        </form>`;
      const setzen = (n, einheit) => {
        setPref('aufgabenHorizont', horizontNormal({ n, einheit }));
        handle.close(true);
        draw(root);
      };
      pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-n]');
        if (b) setzen(Number(b.dataset.n), b.dataset.e);
      });
      pop.querySelector('.hz-frei').addEventListener('submit', (e) => {
        e.preventDefault();
        setzen(Number(pop.querySelector('#hzN').value), pop.querySelector('#hzE').value);
      });
      setTimeout(() => pop.querySelector('#hzN')?.select(), 20);
    },
  });
}

function draw(root) {
  const today = todayISO();
  const alle = sel.todos();
  const offen = alle.filter((t) => !t.done);
  const erledigt = alle.filter((t) => t.done);
  const hz = horizont();
  const ende = horizontEnde(today, hz);

  let body;
  if (!alle.length) {
    body = emptyState('Noch keine Aufgaben', 'Mit „Aufgabe“ oben rechts legen Sie die erste an. Aufgaben können Text, Bilder und Unteraufgaben enthalten und lassen sich mit Terminen, Buchungen, Kontakten und Rechnungen verknüpfen.').__raw;
  } else if (state.show === 'done') {
    const rows = erledigt.filter(matches).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
    body = rows.length ? group('Erledigt', rows) : emptyState('Nichts gefunden', state.q ? 'Keine erledigte Aufgabe passt zur Suche.' : 'Noch nichts abgehakt.').__raw;
  } else {
    const sorted = openTodosSorted(today).filter(matches);
    const teile = [
      ['Überfällig', sorted.filter((t) => { const d = dueOf(t, today).date; return d && d < today; })],
      ['Heute', sorted.filter((t) => dueOf(t, today).date === today)],
      [horizontTitel(hz), sorted.filter((t) => { const d = dueOf(t, today).date; return d > today && d <= ende; })],
      ['Später', sorted.filter((t) => dueOf(t, today).date > ende)],
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
        ${alle.length && state.show !== 'done' ? raw(`<button class="btn sm" id="todoHorizont" aria-haspopup="dialog" aria-expanded="false" title="Wie weit die Liste vorausschaut">${icon('calendar', 14).__raw} Vorschau: ${esc(horizontText(hz))} ${icon('down', 13).__raw}</button>`) : ''}
      </div>
      <div class="card-body">
        <div id="todoList">${raw(body)}</div>
      </div>
    </div>`;

  $('#todoHorizont', root)?.addEventListener('click', (e) => zeitraumWaehlen(e.currentTarget, root));
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
  return `<option value="">Kein Termin</option>`
    + (kommend.length ? `<optgroup label="Kommende Termine">${kommend.map(opt).join('')}</optgroup>` : '')
    + (vergangen.length ? `<optgroup label="Vergangene Termine">${vergangen.map(opt).join('')}</optgroup>` : '');
}

/**
 * @param {string|null} id  bestehende Aufgabe oder null für eine neue
 * @param {object} [preset]  Vorbelegung einer neuen Aufgabe (title, dueDate, appointmentId, links …)
 * @param {{nachSpeichern?:Function}} [o]  wird nach Speichern und Löschen gerufen
 */
export function openTodoDialog(id, preset = {}, { nachSpeichern = null } = {}) {
  const existing = id ? sel.todo(id) : null;
  const t = existing ? structuredClone(existing) : newTodoDraft(preset);
  const isNew = !existing;
  const urspruenglich = bildIds(aufgabenHtml(t));
  const neueBilder = new Set();
  let subs = teilaufgaben(t).map((s) => ({ ...s }));
  let links = verknuepfungenRoh(t).map((l) => ({ ...l }));
  let art = aufgabenArt(t);
  const zz = zielNormal(t, todayISO());
  const ww = wiederholungNormal(t.wiederholung);
  let editor = null;
  let ausgangslage = null;
  let fertig = false;
  const stand = () => JSON.stringify([
    art, ['zGesamt', 'zEinheit', 'zStand', 'zStart', 'wN', 'wF'].map((k) => m.root.querySelector('#d_' + k)?.value),
    m.root.querySelector('#d_title')?.value.trim(), m.root.querySelector('#d_due')?.value, m.root.querySelector('#d_appt')?.value,
    editor?.html(), subs.map((s) => [s.title, s.done]), links, m.root.querySelector('#d_done')?.checked ?? t.done,
  ]);

  const m = modal({
    title: isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten',
    size: 'wide',
    // Vor dem Wegklicken nachfragen, wenn etwas eingetragen wurde.
    confirmDismiss: () => ausgangslage !== null && !fertig && stand() !== ausgangslage,
    // Bilder, die in einem verworfenen Fenster abgelegt wurden, wieder entfernen.
    onClose: () => { if (!fertig && neueBilder.size) bilderEntfernen([...neueBilder]); },
    body: html`
      <div class="todo-dlg">
        <div class="field">
          <label for="d_title">Aufgabe *</label>
          <input id="d_title" value="${t.title}" placeholder="z. B. Unterlagen für den Steuerberater zusammenstellen">
        </div>
        <div class="field">
          <label>Art</label>
          <div class="seg" id="d_art" role="group" aria-label="Art der Aufgabe">
            ${raw(Object.entries(ARTEN).map(([k, n]) => `<button type="button" data-art="${k}" aria-pressed="${k === art}" class="${k === art ? 'active' : ''}">${esc(n)}</button>`).join(''))}
          </div>
          <span class="hint" id="d_artHint"></span>
        </div>
        <div class="field" id="d_zielBox" hidden>
          <div class="form-grid">
            <div class="field"><label for="d_zGesamt">Wie viel insgesamt?</label><input type="number" id="d_zGesamt" min="0" step="any" value="${zz.gesamt}"></div>
            <div class="field"><label for="d_zEinheit">Einheit</label><input id="d_zEinheit" value="${zz.einheit}" placeholder="z. B. Seiten, Belege, km" maxlength="30"></div>
            <div class="field"><label for="d_zStand">Schon geschafft</label><input type="number" id="d_zStand" min="0" step="any" value="${zz.stand}"></div>
            <div class="field"><label for="d_zStart">Beginn</label><input type="date" id="d_zStart" value="${zz.start}"></div>
          </div>
          <p class="hint" id="d_zInfo" style="margin:8px 0 0"></p>
        </div>
        <div class="field" id="d_wdhBox" hidden>
          <label for="d_wN">Wiederholt sich</label>
          <div class="row" style="gap:8px;align-items:center">
            <span>alle</span>
            <input type="number" id="d_wN" min="1" max="365" step="1" value="${ww.n}" style="width:72px">
            <select id="d_wF" aria-label="Einheit">${raw(Object.entries(WIEDERHOLUNG_EINHEITEN).map(([k, [, viele]]) => `<option value="${k}" ${k === ww.freq ? 'selected' : ''}>${viele}</option>`).join(''))}</select>
          </div>
          <span class="hint">Nach dem Abhaken kommt die Aufgabe am nächsten Termin wieder, die Unteraufgaben sind dann wieder offen.</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="d_due" id="d_dueLabel">Fällig am</label>
            <input type="date" id="d_due" value="${t.dueDate || ''}">
            <span class="hint" id="d_dueHint">Freiwillig. Ohne Datum gilt der verknüpfte Termin.</span>
          </div>
          <div class="field">
            <label for="d_appt">Gehört zum Termin</label>
            <select id="d_appt">${raw(appointmentOptions(t.appointmentId))}</select>
            <span class="hint">Freiwillig. Die Aufgabe steht dann auch im Termin.</span>
          </div>
        </div>
        <div class="field">
          <label>Beschreibung</label>
          <div id="d_editor"></div>
        </div>
        <div class="field">
          <label for="d_subNew">Unteraufgaben</label>
          <div class="tl-subs" id="d_subs"></div>
          <div class="todo-add compact">
            <input id="d_subNew" placeholder="Unteraufgabe hinzufügen und Enter drücken" aria-label="Neue Unteraufgabe">
            <button type="button" class="btn sm" id="d_subAdd">${icon('plus', 14)} Hinzufügen</button>
          </div>
        </div>
        <div class="field">
          <label>Verknüpft mit</label>
          <div class="tl-links" id="d_links"></div>
          <div class="tl-picker" id="d_picker" hidden>
            <input type="search" id="d_pickQ" placeholder="Buchung, Kontakt oder Rechnung suchen …" aria-label="Verknüpfung suchen" autocomplete="off">
            <div class="tl-results" id="d_pickR"></div>
          </div>
          <span class="hint">Freiwillig. Die Aufgabe erscheint dann auch bei der Buchung, dem Kontakt oder der Rechnung.</span>
        </div>
        ${!isNew ? raw(`<label class="check"><input type="checkbox" id="d_done" ${t.done ? 'checked' : ''}> erledigt</label>`) : ''}
      </div>`,
    foot: `
      <div class="left row" style="gap:8px">
        ${!isNew ? `<button class="btn danger sm" id="btnDel">${icon('trash', 14).__raw} Löschen</button>` : ''}
      </div>
      <button class="btn" id="btnCancel">Abbrechen</button>
      <button class="btn primary" id="btnSave">${isNew ? 'Aufgabe anlegen' : 'Speichern'}</button>`,
  });
  const g = (k) => m.root.querySelector('#d_' + k);

  editor = richEditor(g('editor'), { html: aufgabenHtml(t), beiNeuemBild: (bid) => neueBilder.add(bid) });

  /* Art: einfach, Ziel, Wiederholung */
  const ART_HINWEIS = {
    einfach: '',
    ziel: 'Eine Menge bis zu einem Tag, zum Beispiel 20 Seiten in 10 Tagen. Kontovia rechnet aus, was pro Tag noch nötig ist.',
    wiederholend: 'Eine Aufgabe, die immer wieder anfällt, etwa jeden Monat die Umsatzsteuer vorbereiten.',
  };
  const zielInfo = () => {
    const heute = todayISO();
    const probe = {
      art: 'ziel', dueDate: g('due').value, createdAt: heute,
      ziel: { gesamt: Number(g('zGesamt').value), einheit: g('zEinheit').value, stand: Number(g('zStand').value), start: g('zStart').value || heute },
    };
    if (!probe.dueDate) { g('zInfo').textContent = 'Wählen Sie unten eine Frist, dann rechnet Kontovia mit.'; return; }
    const r = zielRechnung(probe, heute);
    const e = r.einheit ? ` ${r.einheit}` : '';
    g('zInfo').textContent = r.gesamtTage
      ? `Plan: ${mengeText(r.planProTag)}${e} pro Tag, ${r.gesamtTage} ${r.gesamtTage === 1 ? 'Tag' : 'Tage'} lang. ${zielSatz(probe, heute)}.` : '';
  };
  const artZeigen = () => {
    g('zielBox').hidden = art !== 'ziel';
    g('wdhBox').hidden = art !== 'wiederholend';
    g('artHint').textContent = ART_HINWEIS[art];
    g('dueLabel').textContent = art === 'ziel' ? 'Frist *' : art === 'wiederholend' ? 'Nächstes Mal am' : 'Fällig am';
    g('dueHint').textContent = art === 'ziel' ? 'Bis dahin soll die ganze Menge geschafft sein.'
      : art === 'wiederholend' ? 'Freiwillig. Ohne Datum gilt der Tag des ersten Abhakens als Start.' : 'Freiwillig. Ohne Datum gilt der verknüpfte Termin.';
    for (const b of g('art').querySelectorAll('[data-art]')) {
      b.classList.toggle('active', b.dataset.art === art);
      b.setAttribute('aria-pressed', String(b.dataset.art === art));
    }
    if (g('done')) g('done').closest('label').hidden = art !== 'einfach';
    if (art === 'ziel') zielInfo();
  };
  g('art').addEventListener('click', (e) => {
    const b = e.target.closest('[data-art]');
    if (!b) return;
    art = b.dataset.art;
    artZeigen();
  });
  for (const k of ['zGesamt', 'zEinheit', 'zStand', 'zStart', 'due']) g(k).addEventListener('input', () => { if (art === 'ziel') zielInfo(); });
  artZeigen();

  /* Unteraufgaben */
  const subsZeichnen = () => {
    g('subs').innerHTML = subs.map((s, i) => `
      <div class="tl-sub" data-sub="${esc(s.id)}">
        <input type="checkbox" class="todo-check" data-sub-done ${s.done ? 'checked' : ''} aria-label="${esc(s.title)} erledigt">
        <input class="tl-sub-title" data-sub-title value="${esc(s.title)}" aria-label="Unteraufgabe">
        <button type="button" class="icon-btn" data-sub-up title="Nach oben" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${icon('up', 14).__raw}</button>
        <button type="button" class="icon-btn" data-sub-down title="Nach unten" aria-label="Nach unten" ${i === subs.length - 1 ? 'disabled' : ''}>${icon('down', 14).__raw}</button>
        <button type="button" class="icon-btn" data-sub-weg title="Entfernen" aria-label="Unteraufgabe entfernen">${icon('x', 14).__raw}</button>
      </div>`).join('');
  };
  subsZeichnen();
  const subAdd = () => {
    const feld = g('subNew');
    const titel = feld.value.trim();
    if (!titel) { feld.focus(); return; }
    subs.push(neueTeilaufgabe(titel));
    feld.value = '';
    subsZeichnen();
    feld.focus();
  };
  g('subAdd').addEventListener('click', subAdd);
  g('subNew').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); subAdd(); } });
  g('subs').addEventListener('input', (e) => {
    const s = subs.find((x) => x.id === e.target.closest('[data-sub]')?.dataset.sub);
    if (s && e.target.matches('[data-sub-title]')) s.title = e.target.value;
  });
  g('subs').addEventListener('change', (e) => {
    const s = subs.find((x) => x.id === e.target.closest('[data-sub]')?.dataset.sub);
    if (s && e.target.matches('[data-sub-done]')) s.done = e.target.checked;
  });
  g('subs').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-sub-title]') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); g('subNew').focus(); }
  });
  g('subs').addEventListener('click', (e) => {
    const zeile = e.target.closest('[data-sub]');
    const i = subs.findIndex((x) => x.id === zeile?.dataset.sub);
    if (i < 0) return;
    if (e.target.closest('[data-sub-weg]')) subs.splice(i, 1);
    else if (e.target.closest('[data-sub-up]') && i > 0) [subs[i - 1], subs[i]] = [subs[i], subs[i - 1]];
    else if (e.target.closest('[data-sub-down]') && i < subs.length - 1) [subs[i + 1], subs[i]] = [subs[i], subs[i + 1]];
    else return;
    subsZeichnen();
  });

  /* Verknüpfungen */
  const linksZeichnen = () => {
    const vorhanden = verknuepfungen(store.db, { links });
    const tot = links.length - vorhanden.length;
    g('links').innerHTML = vorhanden.map((v) => `
      <span class="chip todo-link" data-l="${esc(v.typ)}:${esc(v.id)}">
        <button type="button" class="tl-link-open" data-l-open title="${esc(`${VERKNUEPFUNG_ARTEN[v.typ]} öffnen`)}">${icon(LINK_ICON[v.typ], 12).__raw}<span class="truncate">${esc(v.titel)}</span><span class="muted tiny">${esc(v.sub)}</span></button>
        <button type="button" class="chip-x" data-l-weg aria-label="Verknüpfung entfernen" title="Verknüpfung entfernen">${icon('x', 11).__raw}</button>
      </span>`).join('')
      + `<button type="button" class="chip" id="d_pick">${icon('plus', 12).__raw} Verknüpfen</button>`
      + (tot ? `<span class="small muted">${tot === 1 ? 'Ein Ziel gibt es nicht mehr' : `${tot} Ziele gibt es nicht mehr`}</span>` : '');
  };
  linksZeichnen();
  let index = null;
  const pickerZeichnen = () => {
    const q = g('pickQ').value.trim();
    const bereits = new Set(links.map((l) => `${l.typ}:${l.id}`));
    index ??= sucheIndex(store.db).filter((e) => VERKNUEPFUNG_ARTEN[e.art]);
    const treffer = q
      ? suchen(index, q, { pro: 12 }).filter((e) => !bereits.has(`${e.art}:${e.id}`))
      : [...index].filter((e) => !bereits.has(`${e.art}:${e.id}`)).sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || ''))).slice(0, 8);
    g('pickR').innerHTML = treffer.length
      ? treffer.map((e) => `<button type="button" class="menu-opt" data-add="${esc(e.art)}:${esc(e.id)}">${icon(LINK_ICON[e.art], 14).__raw}<span class="menu-label">${esc(e.titel)}<span class="menu-sub">${esc(VERKNUEPFUNG_ARTEN[e.art])} · ${esc(e.sub)}</span></span></button>`).join('')
      : `<p class="small muted" style="padding:6px 8px;margin:0">${q ? 'Nichts gefunden.' : 'Noch nichts zum Verknüpfen vorhanden.'}</p>`;
  };
  g('links').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-l]');
    if (chip && e.target.closest('[data-l-weg]')) {
      const [typ, lid] = chip.dataset.l.split(':');
      links = links.filter((l) => !(l.typ === typ && l.id === lid));
      linksZeichnen();
    } else if (chip && e.target.closest('[data-l-open]')) {
      const [typ, lid] = chip.dataset.l.split(':');
      verknuepfungOeffnen(typ, lid);
    } else if (e.target.closest('#d_pick')) {
      g('picker').hidden = !g('picker').hidden;
      if (!g('picker').hidden) { pickerZeichnen(); g('pickQ').focus(); }
    }
  });
  g('pickQ').addEventListener('input', pickerZeichnen);
  g('pickQ').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); g('pickR').querySelector('[data-add]')?.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); g('picker').hidden = true; }
  });
  g('pickR').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const [typ, lid] = b.dataset.add.split(':');
    links = verknuepfungHinzu({ links }, typ, lid);
    g('picker').hidden = true;
    g('pickQ').value = '';
    linksZeichnen();
  });

  ausgangslage = stand();
  m.root.querySelector('#btnCancel').addEventListener('click', () => m.dismiss());
  m.root.querySelector('#btnSave').addEventListener('click', async () => {
    t.title = g('title').value.trim();
    if (!t.title) { warn('Bitte die Aufgabe benennen'); g('title').focus(); return; }
    if (art === 'ziel') {
      if (!(Number(g('zGesamt').value) > 0)) { warn('Bitte die Gesamtmenge eintragen'); g('zGesamt').focus(); return; }
      if (!g('due').value) { warn('Bitte eine Frist wählen'); g('due').focus(); return; }
      if ((g('zStart').value || todayISO()) > g('due').value) { warn('Der Beginn liegt nach der Frist'); g('zStart').focus(); return; }
    }
    fertig = true;
    t.art = art === 'einfach' ? '' : art;
    if (art === 'ziel') {
      const stand = Math.max(0, Number(g('zStand').value) || 0);
      t.ziel = { gesamt: Number(g('zGesamt').value), einheit: g('zEinheit').value.trim(), stand, start: g('zStart').value || todayISO() };
    } else delete t.ziel;
    if (art === 'wiederholend') t.wiederholung = { ...(t.wiederholung || {}), ...wiederholungNormal({ freq: g('wF').value, n: g('wN').value }) };
    else delete t.wiederholung;
    t.dueDate = g('due').value || '';
    t.appointmentId = g('appt').value || '';
    t.body = editor.html();
    t.notes = klartext(t.body);
    // Eine Unteraufgabe, die noch im Eingabefeld steht, geht nicht verloren.
    const offen = g('subNew').value.trim();
    if (offen) subs.push(neueTeilaufgabe(offen));
    t.subtasks = subs.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim() }));
    t.links = verknuepfungenRoh({ links });
    // Bei einem Ziel entscheidet der Stand: Menge erreicht heißt erledigt.
    const done = art === 'ziel' ? t.ziel.stand >= t.ziel.gesamt : art === 'wiederholend' ? false : g('done') ? g('done').checked : t.done;
    if (done !== t.done) t.doneAt = done ? new Date().toISOString() : '';
    t.done = done;
    await upsertTodo(t);
    // Bilder, die nicht mehr im Text stehen, samt Datei entfernen.
    const bleiben = new Set(bildIds(t.body));
    await bilderEntfernen([...new Set([...urspruenglich, ...neueBilder])].filter((b) => !bleiben.has(b)));
    m.close();
    ok(isNew ? 'Aufgabe angelegt' : 'Aufgabe gespeichert', t.title);
    nachSpeichern?.();
    refresh();
  });
  m.root.querySelector('#btnDel')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Aufgabe löschen?', text: `„${t.title}“ wird entfernt.`, confirmLabel: 'Löschen', danger: true })) return;
    fertig = true;
    await deleteTodo(t.id);
    await bilderEntfernen([...new Set([...urspruenglich, ...neueBilder])]);
    m.close();
    ok('Aufgabe gelöscht');
    nachSpeichern?.();
    refresh();
  });
}
