/**
 * Kontovia – Terminkalender: Monat, Woche, Tag und Liste; mehrere Kalender,
 * Tags, Suche, Schnelleingabe, Ziehen und Ablegen. Termine sind mit
 * Buchungen, Rechnungen, Projekten und Aufgaben verknüpfbar.
 */

import {
  html, raw, esc, $, $$, money, fmtDate, fmtDateLong, fmtDateShort, todayISO, fromISO, uid,
  addDays, monthEnd, MONTHS, MONTHS_SHORT, WEEKDAYS, isoWeek, sortBy, int,
} from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, emptyState } from '../lib/ui.js';
import { sel, commit, saveNow, subscribe, upsertAppointment, deleteAppointment, applyTodoChanges, newTodoDraft, newTransactionDraft } from '../lib/store.js';
import { depositInfo, isVoidPart } from '../lib/calc.js';
import { expandAppointments, expandForList, regelText, wochentage, intervall, WOCHENTAGE } from '../lib/termine.js';
import {
  FARBEN, kalenderListe, kalenderSchluessel, terminFarbe, neueKalenderId, lokaleKalender, tagsLesen, alleTags,
  passtTermin, schnellEingabe, ERINNERUNG_ZEIT, ERINNERUNG_GANZTAGS, erinnerungText, verschoben, zeitraum, blaettern,
  tagesLage, minuten,
} from '../lib/kalender.js';
import { refresh } from '../lib/router.js';
import { fokusMerken } from '../lib/fokus.js';
import { prefs, setPref } from '../lib/prefs.js';
import { openTransactionDialog } from './transactions.js';
import { openCalendarSyncDialog, statusText, bestaetigen } from './calendarsync.js';
import { calState, onCalendarSync, refreshCalendarStatus, syncCalendar, calendarSettings, seitAbgleich } from '../lib/gcalsync.js';
import { eventIdFor } from '../lib/gcal.js';
import { openMenu } from '../lib/popover.js';
import { steuertermine } from '../lib/fristen.js';
import { kann } from '../lib/lizenz.js';
import { oeffneFrist } from './spruenge.js';
import { openTodoDialog } from './todos.js';
import { projektAuswahl } from '../lib/projektwahl.js';

/* Was gerade zu sehen ist. Darstellung, Filter und Reiter bleiben auf diesem Gerät (prefs). */
const state = {
  cursor: todayISO(),
  mode: 'month', // month | week | day | agenda
  showDue: true,
  showEvents: true,
  showDone: true,
  showTax: true,
  showTodos: true,
  showKontovia: true, // alles, was aus Kontovia stammt; aus = nur die Google-Kalender („privat“)
  showTermine: true,  // die in Kontovia angelegten Termine
  showGoogle: true,   // Termine aus weiteren Google-Kalendern
  kalenderAus: new Set(), // ausgeblendete Kalender (Schlüssel aus lib/kalender.js)
  tags: new Set(),        // gewählte Tags (mindestens einer muss passen)
  suche: '',
};
(() => {
  const p = prefs.kalenderAnsicht || {};
  for (const k of ['mode', 'showDue', 'showEvents', 'showDone', 'showTax', 'showTodos', 'showKontovia', 'showTermine', 'showGoogle']) if (p[k] !== undefined) state[k] = p[k];
  if (!['month', 'week', 'day', 'agenda'].includes(state.mode)) state.mode = 'month';
  if (Array.isArray(p.kalenderAus)) state.kalenderAus = new Set(p.kalenderAus);
  // Der frühere Reiter „nur dieser Kalender“ ist jetzt: alle anderen ausgeblendet. Was er gewählt hatte, bleibt unbeachtet.
  if (Array.isArray(p.tags)) state.tags = new Set(p.tags);
})();
function merken() {
  setPref('kalenderAnsicht', {
    mode: state.mode, showDue: state.showDue, showEvents: state.showEvents, showDone: state.showDone, showTax: state.showTax, showTodos: state.showTodos,
    showKontovia: state.showKontovia, showTermine: state.showTermine, showGoogle: state.showGoogle,
    kalenderAus: [...state.kalenderAus], tags: [...state.tags],
  });
}

const FREQ = { none: 'einmalig', daily: 'täglich', weekly: 'wöchentlich', biweekly: 'alle zwei Wochen', monthly: 'monatlich', yearly: 'jährlich' };
const STUNDE_PX = 48; // Höhe einer Stunde im Zeitraster

/* -------------------------------------------------------------------------- */
/* Einträge                                                                    */
/* -------------------------------------------------------------------------- */

/** Alle Kalender der Ansicht: lokale und Google-Kalender, mit Farbe. */
function kalenderAlle() {
  return kalenderListe({ settings: sel.settings(), weitere: calendarSettings().weitere, appointments: sel.appointments() });
}

function filter() {
  return {
    kalenderAus: state.kalenderAus, tags: state.tags, suche: state.suche, kontaktName: sel.contactName,
    herkunft: { kontovia: state.showKontovia, termine: state.showTermine, google: state.showGoogle },
  };
}

/** Gehört der Termin zu einem nur lesbaren Google-Kalender (mit dem Konto geteilt)? */
function nurLesen(a, kal = kalenderAlle()) {
  return !!a?.extern && kal.find((k) => k.key === kalenderSchluessel(a))?.readOnly === true;
}

/** Termine im Zeitraum, gefiltert und mit Farbe. `liste`: mehrtägige nur einmal. */
function termine(from, to, { liste = false } = {}) {
  const f = filter();
  const kal = kalenderAlle();
  const alle = (liste ? expandForList : expandAppointments)(sel.appointments(), from, to);
  return alle
    .filter((e) => (state.showDone || !e.done) && passtTermin(e, f))
    .map((e) => ({ ...e, farbe: terminFarbe(e, kal), nurLesen: nurLesen(e, kal) }));
}

/** Zahlungstermine (Fälligkeiten offener Rechnungen) als Kalendereinträge. */
function dueEntries(from, to) {
  if (!state.showKontovia || state.suche || state.tags.size) return [];
  return sel.transactions()
    .filter((t) => !isVoidPart(t) && !t.paidDate && (t.dueDate || t.date) >= from && (t.dueDate || t.date) <= to)
    .map((t) => ({
      id: 'due_' + t.id,
      isDue: true,
      txId: t.id,
      occurrence: t.dueDate || t.date,
      title: `${t.type === 'income' ? 'Zahlungseingang erwartet' : 'Zahlung fällig'}: ${t.description}`,
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
  if (!state.showKontovia || state.tags.size) return [];
  const out = [];
  const q = state.suche.toLowerCase().trim();
  for (const t of sel.transactions()) {
    if (isVoidPart(t)) continue;
    const dep = depositInfo(t);
    if (!dep?.eventDate || dep.eventDate < from || dep.eventDate > to) continue;
    const title = `${t.description}${t.location ? ' · ' + t.location : ''}`
      + (dep.remaining > 0 ? ` · Restbetrag ${money(dep.remaining)} €` : '');
    if (q && !title.toLowerCase().includes(q)) continue;
    out.push({ id: 'evt_' + t.id, isEvent: true, txId: t.id, occurrence: dep.eventDate, title, allDay: true });
  }
  return out;
}

/** Aufgaben mit eigenem Fälligkeitsdatum als Kalendereinträge. Aufgaben an einem Termin zeigt dieser selbst. */
function todoEntries(from, to) {
  if (!state.showKontovia || state.tags.size) return [];
  const q = state.suche.toLowerCase().trim();
  return sel.todos()
    .filter((t) => t.dueDate && t.dueDate >= from && t.dueDate <= to && (state.showDone || !t.done) && (!q || String(t.title || '').toLowerCase().includes(q)))
    .map((t) => ({
      id: 'todo_' + t.id,
      isTodo: true,
      todoId: t.id,
      occurrence: t.dueDate,
      title: t.title || '(ohne Titel)',
      done: !!t.done,
      allDay: true,
    }));
}

/** Steuertermine (Voranmeldung, Jahreserklärungen) als Kalendereinträge. */
function taxEntries(from, to) {
  if (!state.showKontovia || !kann('steuertermine') || state.suche || state.tags.size) return [];
  return steuertermine(sel.settings(), from, to).map((t, i) => ({
    ...t,
    id: `tax_${t.datum}_${i}`,
    isTax: true,
    occurrence: t.datum,
    title: t.titel,
    allDay: true,
  }));
}

/** Alles im Zeitraum außer den Terminen selbst. */
function sonstige(from, to) {
  return [
    ...(state.showTax ? taxEntries(from, to) : []),
    ...(state.showTodos ? todoEntries(from, to) : []),
    ...(state.showDue && state.mode !== 'agenda' ? dueEntries(from, to) : []),
    ...(state.showEvents ? eventEntries(from, to) : []),
  ];
}

/** Kennzeichnet einen Steuertermin im HTML, damit ein Klick zu seinen Zahlen führt. */
const taxAttrs = (e) => `data-tax="1" data-tax-from="${esc(e.zeitraum?.from || '')}" data-tax-to="${esc(e.zeitraum?.to || '')}" data-tax-jahr="${esc(e.jahr || '')}"`;

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params, { actions } = {}) {
  if (params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) state.cursor = params.date;
  actions.innerHTML = html`
    <div class="seg" role="group" aria-label="Darstellung">
      <button data-mode="month" class="${state.mode === 'month' ? 'active' : ''}" aria-pressed="${state.mode === 'month'}">Monat</button>
      <button data-mode="week" class="${state.mode === 'week' ? 'active' : ''}" aria-pressed="${state.mode === 'week'}">Woche</button>
      <button data-mode="day" class="${state.mode === 'day' ? 'active' : ''}" aria-pressed="${state.mode === 'day'}">Tag</button>
      <button data-mode="agenda" class="${state.mode === 'agenda' ? 'active' : ''}" aria-pressed="${state.mode === 'agenda'}">Liste</button>
    </div>
    <button class="btn" id="calShow" aria-haspopup="dialog" aria-expanded="false" title="Was der Kalender zeigt">${icon('eye', 16)} Anzeige ${icon('down', 14)}</button>
    <button class="btn" id="calSync" title="Mit Google Kalender oder per Kalenderdatei (.ics) abgleichen">${icon('refresh', 16)} Abgleich</button>
    <button class="btn primary" id="newAppt">${icon('plus', 16)} Neuer Termin</button>`;
  $$('[data-mode]', actions).forEach((b) => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    merken();
    // Die Leiste bleibt stehen, damit die Marke zum neuen Reiter gleiten kann.
    $$('[data-mode]', actions).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    draw(root, { bewegung: 'wechsel' });
  }));
  // Was eingeblendet wird, steht in einem Menü statt in vielen Häkchen über dem Kalender.
  actions.querySelector('#calShow').addEventListener('click', (e) => openMenu(e.currentTarget, {
    label: 'Anzeige',
    keepOpen: true,
    align: 'end',
    sections: () => {
      const kal = kalenderAlle();
      const lokal = kal.filter((k) => k.art === 'lokal');
      const google = kal.filter((k) => k.art === 'google');
      const tags = alleTags(sel.appointments());
      const kalOption = (k) => ({ value: k.key, label: k.name, sub: k.readOnly ? 'nur lesen' : '', on: !state.kalenderAus.has(k.key), count: k.anzahl });
      const googleDa = google.length > 0 || !!calState.status?.linked;
      return [{
        key: 'show',
        title: 'Woher die Einträge kommen',
        options: [
          { value: 'showKontovia', label: 'Kontovia', sub: googleDa ? 'aus: nur Google, also privat' : '', on: state.showKontovia },
          googleDa && { value: 'showGoogle', label: 'Google Kalender', on: state.showGoogle },
        ].filter(Boolean),
      }, {
        key: 'show',
        title: 'Aus Kontovia zeigen',
        options: state.showKontovia ? [
          { value: 'showTermine', label: 'Meine Termine', on: state.showTermine },
          state.mode !== 'agenda' && { value: 'showDue', label: 'Zahlungstermine offener Rechnungen', on: state.showDue },
          { value: 'showEvents', label: 'Veranstaltungen aus Anzahlungen', on: state.showEvents },
          { value: 'showTax', label: 'Steuertermine (Voranmeldung, Erklärungen)', on: state.showTax },
          { value: 'showTodos', label: 'Aufgaben mit Fälligkeit', on: state.showTodos },
          { value: 'showDone', label: 'Erledigte Termine', on: state.showDone },
        ].filter(Boolean) : [{ value: 'showKontovia', label: 'Kontovia ist ausgeblendet', sub: 'zum Einblenden tippen', on: false }],
      }, lokal.length > 1 && { key: 'kal', title: google.length ? 'Meine Kalender' : 'Kalender', options: lokal.map(kalOption) },
      google.length > 0 && { key: 'kal', title: 'Google Kalender', options: google.map(kalOption) },
      tags.length > 0 && {
        key: 'tag',
        title: 'Nur Termine mit Tag',
        search: tags.length > 8,
        options: tags.map((t) => ({ value: t.tag, label: t.tag, on: state.tags.has(t.tag), count: t.anzahl })),
      }].filter(Boolean);
    },
    onPick: (key, val) => {
      if (key === 'show') state[val] = !state[val];
      else if (key === 'kal') { if (state.kalenderAus.has(val)) state.kalenderAus.delete(val); else state.kalenderAus.add(val); }
      else if (key === 'tag') { if (state.tags.has(val)) state.tags.delete(val); else state.tags.add(val); }
      merken();
      draw(root);
    },
  }));
  actions.querySelector('#newAppt').addEventListener('click', () => openAppointmentDialog(null, { date: state.mode === 'month' ? todayISO() : state.cursor, calendarId: lokalerReiter() }));
  actions.querySelector('#calSync').addEventListener('click', openCalendarSyncDialog);
  draw(root);
  ansichtAktuellHalten(root);

  // Beim Öffnen des Kalenders frisch abgleichen, wenn der letzte Abgleich
  // ein paar Minuten zurückliegt – dann stimmt, was hier steht.
  const st = await refreshCalendarStatus();
  if (st?.linked && !calState.running && seitAbgleich() > 3 * 60 * 1000) {
    syncCalendar({ reason: 'kalender' }).then((r) => { if (r?.summary && r.summary !== 'alles auf dem gleichen Stand' && kalenderOffen(root)) draw(root); }).catch(() => {});
  }
}

/**
 * Vorgabe für neue Termine: der Kalender, den man gerade allein sieht. Sind mehrere
 * sichtbar oder ist es ein Google-Kalender, bleibt es der Standardkalender
 * (in einen Google-Kalender schreibt man nur über das Feld „Kalender“ im Termin).
 */
function lokalerReiter() {
  const sichtbar = kalenderAlle().filter((k) => !state.kalenderAus.has(k.key));
  return sichtbar.length === 1 && sichtbar[0].art === 'lokal' ? sichtbar[0].key : '';
}

/**
 * Solange die Ansicht offen ist: Was ein Abgleich hereinbringt (neue Termine, neu geteilte
 * Kalender), erscheint ohne Zutun. Kurz gebündelt, damit ein Abgleich mit vielen Änderungen
 * nur einmal neu zeichnet.
 */
let aktuellAb = null;
function ansichtAktuellHalten(root) {
  aktuellAb?.();
  let zeitgeber = null;
  const ab = subscribe((ev) => {
    // Der Behälter bleibt beim Wechsel der Ansicht bestehen; ohne Kalender darin ist hier nichts mehr zu tun.
    if (!kalenderOffen(root)) { ab(); if (aktuellAb === ab) aktuellAb = null; return; }
    if (ev?.type !== 'change' || !/^(termin\.kalenderabgleich|einstellung\.kalender)$/.test(ev.action || '')) return;
    clearTimeout(zeitgeber);
    zeitgeber = setTimeout(() => { if (kalenderOffen(root)) draw(root); }, 150);
  });
  aktuellAb = () => { clearTimeout(zeitgeber); ab(); };
}

/** Zeigt der Behälter noch den Kalender? (Er wird für jede Ansicht wiederverwendet.) */
function kalenderOffen(root) {
  return root.isConnected && !!root.querySelector('#calHost');
}

/**
 * Kleiner Hinweis in der Kopfleiste des Kalenders. Ist die Bestätigung bei Google
 * fällig, ist er der eine Tipp dafür; sonst führt er zum Abgleich.
 */
function syncBadge() {
  const text = statusText();
  if (!text) return '';
  const fehler = !!(calState.lastError || calState.status?.lastError);
  const warten = !!calState.status?.bestaetigen && !calState.running;
  const laeuft = calState.running;
  const titel = fehler ? (calState.lastError || calState.status?.lastError) : warten ? 'Mit einem Tipp bei Google bestätigen, dann läuft der Abgleich weiter' : 'Kalender-Abgleich öffnen';
  return `<button class="badge cal-sync ${fehler ? 'neg' : warten ? 'warn' : 'info'}${laeuft ? ' dreht' : ''}" id="calSyncBadge" title="${esc(titel)}">${icon('refresh', 12).__raw} ${esc(text)}</button>`;
}

async function syncBadgeKlick(root) {
  if (!calState.status?.bestaetigen) { openCalendarSyncDialog(); return; }
  // Ein Tipp genügt: bestätigen und gleich abgleichen.
  if (!await bestaetigen()) return;
  await syncCalendar({ reason: 'bestaetigt' }).catch(() => {});
  if (kalenderOffen(root)) draw(root);
}

let badgeWatch = null;
function wireSyncBadge(root) {
  const anbinden = () => root.querySelector('#calSyncBadge')?.addEventListener('click', () => syncBadgeKlick(root));
  anbinden();
  // Während eines laufenden Abgleichs den Hinweis mitführen.
  badgeWatch?.();
  badgeWatch = onCalendarSync(() => {
    const el = root.querySelector('#calSyncBadge');
    if (!root.isConnected) { badgeWatch?.(); badgeWatch = null; return; }
    if (el) el.outerHTML = syncBadge() || '<span id="calSyncBadge"></span>';
    anbinden();
  });
}

/** Überschrift des Ausschnitts. */
function titel() {
  const { from, to } = zeitraum(state.mode, state.cursor);
  if (state.mode === 'month') return `${MONTHS[Number(state.cursor.slice(5, 7)) - 1]} ${state.cursor.slice(0, 4)}`;
  if (state.mode === 'week') return `KW ${isoWeek(from)}: ${fmtDateShort(from)} bis ${fmtDate(to)}`;
  if (state.mode === 'day') return `${WEEKDAYS[(fromISO(state.cursor).getDay() + 6) % 7]}, ${fmtDateLong(state.cursor)}`;
  return 'Kommende Termine';
}

/**
 * Zeichnet den Kalender. `bewegung` lässt das Raster einblenden: 'vor' und
 * 'zurueck' beim Blättern (es gleitet aus der Richtung herein), 'wechsel' beim
 * Wechsel der Darstellung. Bei allem anderen (Filter, Suche, Abgleich) bleibt
 * es ruhig, sonst flackerte der Kalender bei jedem Tastendruck.
 */
function draw(root, { bewegung = '' } = {}) {
  const kal = kalenderAlle();
  const navTitle = { month: 'Monat', week: 'Woche', day: 'Tag' }[state.mode] || '';
  root.innerHTML = html`
    <div class="card cal-card">
      <div class="filters cal-bar">
        ${state.mode !== 'agenda' ? raw(`<div class="cal-nav" role="group" aria-label="Blättern">
          <button class="btn sm icon-only" id="prev" title="${esc('Vorheriger ' + navTitle)}" aria-label="${esc('Vorheriger ' + navTitle)}">${icon('left', 15).__raw}</button>
          <button class="btn sm" id="today">Heute</button>
          <button class="btn sm icon-only" id="next" title="${esc('Nächster ' + navTitle)}" aria-label="${esc('Nächster ' + navTitle)}">${icon('right', 15).__raw}</button>
        </div>`) : ''}
        <h2 class="cal-titel" aria-live="polite">${titel()}</h2>
        <div class="spacer"></div>
        <input type="search" class="search" id="calSearch" placeholder="Termine suchen …" aria-label="Termine suchen" value="${state.suche}">
        ${raw(syncBadge())}
        <span id="calHint" class="cal-hinweis">${raw(hiddenHint())}</span>
      </div>
      <div class="cal-body">
        ${raw(tabsHtml(kal))}
        <div class="cal-quick">
          <span class="cal-quick-icon" aria-hidden="true">${icon('plus', 14)}</span>
          <input id="calQuick" placeholder="Schnell eintragen, z. B. „morgen 14:00 Steuerberater“ oder „Fr 9-10 Zahnarzt #privat“" aria-label="Termin schnell eintragen">
          <span class="hint small muted">Enter öffnet den fertig ausgefüllten Termin zum Prüfen.</span>
        </div>
        <div id="calHost"></div>
      </div>
    </div>
    <div id="calListe"></div>`;
  drawInhalt(root, { bewegung });

  const blaettern_ = (richtung) => {
    state.cursor = blaettern(state.mode, state.cursor, richtung);
    draw(root, { bewegung: richtung > 0 ? 'vor' : 'zurueck' });
  };
  $('#prev', root)?.addEventListener('click', () => blaettern_(-1));
  $('#next', root)?.addEventListener('click', () => blaettern_(1));
  $('#today', root)?.addEventListener('click', () => {
    const richtung = todayISO() >= state.cursor ? 'vor' : 'zurueck';
    state.cursor = todayISO();
    draw(root, { bewegung: richtung });
  });
  const suche = $('#calSearch', root);
  let sucheTimer = null;
  suche.addEventListener('input', () => {
    clearTimeout(sucheTimer);
    // Nur Raster und Liste werden neu gezeichnet; das Suchfeld bleibt, wie es ist, und behält den Cursor.
    sucheTimer = setTimeout(() => {
      state.suche = suche.value.trim();
      drawInhalt(root);
    }, 220);
  });
  const quick = $('#calQuick', root);
  quick.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    e.preventDefault();
    const p = schnellEingabe(quick.value, { heute: todayISO() });
    if (!p.erkannt.includes('datum') && state.mode !== 'month') p.date = state.cursor;
    quick.value = '';
    openAppointmentDialog(null, { ...p, calendarId: lokalerReiter() });
  });
  // Ein Klick blendet einen Kalender ein oder aus, ein Doppelklick zeigt nur diesen. Die Reiter bleiben
  // dabei stehen (nur ihr Zustand wechselt), damit sie weich umschalten und der Fokus nicht verloren geht.
  const kalenderWechsel = (neu) => {
    state.kalenderAus = neu;
    merken();
    reiterNachziehen(root);
    drawInhalt(root);
  };
  $$('.cal-chip', root).forEach((b) => {
    const key = b.dataset.kal;
    b.addEventListener('click', (e) => {
      if (e.detail > 1) return;
      const neu = new Set(state.kalenderAus);
      if (neu.has(key)) neu.delete(key); else neu.add(key);
      kalenderWechsel(neu);
    });
    b.addEventListener('dblclick', () => kalenderWechsel(new Set(kal.map((k) => k.key).filter((x) => x !== key))));
  });
  root.querySelector('#calAlle')?.addEventListener('click', () => {
    kalenderWechsel(new Set());
    root.querySelector('.cal-chip')?.focus();
  });
  root.querySelector('#calPrivat')?.addEventListener('click', () => {
    state.showKontovia = !state.showKontovia;
    if (!state.showKontovia) state.showGoogle = true;
    merken();
    draw(root);
  });
  root.querySelector('#calKalender')?.addEventListener('click', () => openKalenderVerwaltung().then(() => draw(root)));

  wireSyncBadge(root);
}

/**
 * Raster und Liste neu zeichnen, ohne Kopf, Suchfeld und Reiter anzufassen. Das geht
 * schneller, lässt die Reiter weich umschalten und das Suchfeld seinen Cursor behalten.
 */
function drawInhalt(root, { bewegung = '' } = {}) {
  const host = root.querySelector('#calHost');
  const liste = root.querySelector('#calListe');
  if (!host || !liste) return;
  const { from, to } = zeitraum(state.mode, state.cursor);
  host.innerHTML = state.mode === 'agenda' ? '' : html`<div class="cal-flaeche${bewegung ? ` cal-ein cal-${bewegung}` : ''}">${raw(state.mode === 'month' ? monthHtml(from, to) : weekHtml(from, to))}</div>`;
  liste.innerHTML = listeHtml(from, to);
  const hinweis = root.querySelector('#calHint');
  if (hinweis) hinweis.innerHTML = hiddenHint();
  if (state.mode === 'week' || state.mode === 'day') {
    const grid = root.querySelector('.cal-week');
    // Morgens anfangen, nicht um Mitternacht; am heutigen Tag bei der aktuellen Stunde.
    const heute = from <= todayISO() && todayISO() <= to;
    const stunde = heute ? Math.max(0, new Date().getHours() - 1) : 7;
    if (grid) grid.scrollTop = stunde * STUNDE_PX;
  }
  wireEvents(root);
  wireDnd(root);
}

/** Zustand der Kalender-Reiter an `state.kalenderAus` angleichen. */
function reiterNachziehen(root) {
  $$('.cal-chip', root).forEach((b) => {
    const an = !state.kalenderAus.has(b.dataset.kal);
    b.classList.toggle('aus', !an);
    b.setAttribute('aria-pressed', String(an));
  });
  const alle = root.querySelector('#calAlle');
  if (alle) alle.hidden = state.kalenderAus.size === 0;
}

/**
 * Die Kalender als Reiter: jeder lässt sich ein- und ausblenden (Filter), auch die mit
 * dem Konto geteilten Google-Kalender. Ein Kalender mit Schloss ist nur lesbar.
 */
function tabsHtml(kal) {
  // Mit Google verbunden: ein Tipp stellt auf „privat“ (nur Google) und wieder zurück.
  const privat = (kal.some((k) => k.art === 'google') || calState.status?.linked)
    ? `<button type="button" class="chip" id="calPrivat" aria-pressed="${!state.showKontovia}" title="Blendet alles aus Kontovia aus und zeigt nur die Google-Kalender. Feiner einstellen: Anzeige oben rechts.">${icon('hide', 13).__raw} ${state.showKontovia ? 'Nur privat' : 'Kontovia einblenden'}</button>`
    : '';
  if (kal.length < 2) return `<div class="cal-tabs">${privat}<span class="spacer"></span>${verwaltenKnopf()}</div>`;
  return `<div class="cal-tabs" role="group" aria-label="Kalender ein- und ausblenden">
    ${privat}
    ${kal.map((k) => {
      const an = !state.kalenderAus.has(k.key);
      const titel = `${k.art === 'google' ? `Google Kalender „${k.name}“${k.readOnly ? ', nur lesen' : ''}` : k.name}. Klick blendet ein oder aus, Doppelklick zeigt nur diesen.`;
      return `<button type="button" class="chip cal-chip${an ? '' : ' aus'}" aria-pressed="${an}" data-kal="${esc(k.key)}" style="--c:${esc(k.color || 'var(--accent)')}" title="${esc(titel)}">
        <span class="cal-dot"></span><span class="cal-chip-name">${esc(k.name)}</span>${k.readOnly ? `<span class="cal-chip-lesen" aria-label="nur lesen">${icon('lock', 11).__raw}</span>` : ''}${k.art === 'google' && !k.readOnly ? '<span class="tiny muted">Google</span>' : ''}</button>`;
    }).join('')}
    <button type="button" class="chip cal-alle" id="calAlle" ${state.kalenderAus.size ? '' : 'hidden'}>Alle zeigen</button>
    <span class="spacer"></span>
    ${verwaltenKnopf()}
  </div>`;
}

const verwaltenKnopf = () => `<button type="button" class="btn sm ghost" id="calKalender" title="Kalender anlegen, umbenennen, färben">${icon('settings', 14).__raw} Kalender verwalten</button>`;

/**
 * Was gerade ausgeblendet ist – sonst fiele nicht auf, dass etwas fehlt.
 * Geändert wird es über „Anzeige“ oben rechts.
 */
function hiddenHint() {
  const weg = [
    !state.showKontovia && 'Kontovia',
    !state.showGoogle && 'Google Kalender',
    state.showKontovia && !state.showTermine && 'Meine Termine',
    state.showKontovia && state.mode !== 'agenda' && !state.showDue && 'Zahlungstermine',
    state.showKontovia && !state.showEvents && 'Veranstaltungen',
    state.showKontovia && !state.showTax && 'Steuertermine',
    state.showKontovia && !state.showTodos && 'Aufgaben',
    !state.showDone && 'Erledigte',
  ].filter(Boolean);
  const tags = state.tags.size ? `<span class="small cal-hinweis-teil" title="Über „Anzeige“ oben rechts ändern">${icon('tag', 13).__raw} ${esc([...state.tags].join(', '))}</span>` : '';
  return (weg.length ? `<span class="small muted cal-hinweis-teil" title="Über „Anzeige“ oben rechts wieder einblenden">${icon('hide', 13).__raw} ausgeblendet: ${esc(weg.join(', '))}</span>` : '') + tags;
}

/* ---- Monat ---------------------------------------------------------------- */

function monthHtml(gridStart, gridEnd) {
  const first = state.cursor.slice(0, 8) + '01';
  const byDay = new Map();
  for (const e of [...sonstige(gridStart, gridEnd), ...termine(gridStart, gridEnd)]) {
    if (!byDay.has(e.occurrence)) byDay.set(e.occurrence, []);
    byDay.get(e.occurrence).push(e);
  }
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  return `<div class="cal-grid">
    ${WEEKDAYS.map((w) => `<div class="cal-head">${w}</div>`).join('')}
    ${cells.map((d, i) => cellHtml(d, first, byDay.get(d) || [], i)).join('')}
  </div>`;
}

/** Ein Termin als farbiger Balken (Monat, ganztägig in der Woche). */
function evHtml(e, { zeit = true } = {}) {
  if (e.isTax) return `<div class="cal-ev cal-tax" ${taxAttrs(e)} title="${esc(`${e.title}: ${e.hinweis}`)}">§ ${esc(e.title)}</div>`;
  if (e.isTodo) return `<div class="cal-ev cal-todo ${e.done ? 'done' : ''}" data-cal-todo="${esc(e.todoId)}" title="${esc('Aufgabe: ' + e.title)}">${e.done ? '✓' : '☐'} ${esc(e.title)}</div>`;
  if (e.isDue) return `<div class="cal-ev cal-due" data-tx="${esc(e.txId)}" title="${esc(e.title)}">${esc(money(e.amount))} € ${esc(e.type === 'income' ? '↓' : '↑')}</div>`;
  if (e.isEvent) return `<div class="cal-ev cal-event" data-tx="${esc(e.txId)}" title="${esc(e.title)}">${esc(e.title)}</div>`;
  const span = e.spanLength > 1 ? ` cal-span ${e.spanIndex === 0 ? 'span-start' : ''} ${e.spanIndex === e.spanLength - 1 ? 'span-end' : ''}` : '';
  const hinweis = [e.title, e.spanLength > 1 ? `${fmtDate(e.spanStart)} bis ${fmtDate(e.spanEnd)}` : '', e.location, e.extern ? `Google Kalender „${kalenderName(e.extern)}“${e.nurLesen ? ', nur lesen' : ''}` : '', (e.tags || []).map((t) => '#' + t).join(' ')].filter(Boolean).join(' · ');
  // Was nur lesbar ist, lässt sich öffnen, aber nicht verschieben.
  return `<div class="cal-ev ${e.done ? 'done' : ''}${e.nurLesen ? ' cal-lesen' : ''}${span}" data-appt="${esc(e.id)}" data-occ="${esc(e.spanStart || e.occurrence)}" ${e.nurLesen ? '' : 'draggable="true"'} title="${esc(hinweis)}" ${e.farbe ? `style="--ev:${esc(e.farbe)}"` : ''}>${zeit && !e.allDay && e.startTime && (e.spanIndex ?? 0) === 0 ? `<span class="cal-ev-zeit">${esc(e.startTime)}</span> ` : ''}${esc(e.title)}</div>`;
}

function cellHtml(date, monthRef, items, index = 0) {
  const other = date.slice(0, 7) !== monthRef.slice(0, 7);
  const dow = (fromISO(date).getDay() + 6) % 7;
  const cls = ['cal-cell', other ? 'other' : '', date === todayISO() ? 'today' : '', dow >= 5 ? 'weekend' : ''].filter(Boolean).join(' ');
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  // Der vorgelesene Name ist der sichtbare Inhalt (Tag, Einträge) und dahinter, was ein Klick tut.
  return `<div class="${cls}" data-day="${date}" data-drop="1" tabindex="0" role="button" style="--z:${index}">
    <div class="cal-day">${Number(date.slice(8, 10))}<span class="sr-only">. ${esc(fmtDate(date))}</span></div>
    <div class="cal-evs">
      ${shown.map((e) => evHtml(e)).join('')}
      ${more > 0 ? `<button type="button" class="cal-more" data-more="${date}">+ ${more} weitere</button>` : ''}
    </div>
    <span class="sr-only">, neuer Termin</span>
  </div>`;
}

/* ---- Woche und Tag -------------------------------------------------------- */

function weekHtml(from, to) {
  const tage = [];
  for (let d = from; d <= to; d = addDays(d, 1)) tage.push(d);
  const alle = [...sonstige(from, to), ...termine(from, to)];
  const ganz = new Map();
  const zeitlich = new Map();
  for (const e of alle) {
    const ziel = e.allDay || !e.startTime || e.isTax || e.isTodo || e.isDue || e.isEvent ? ganz : zeitlich;
    if (!ziel.has(e.occurrence)) ziel.set(e.occurrence, []);
    ziel.get(e.occurrence).push(e);
  }
  const heute = todayISO();
  const jetzt = new Date();
  const jetztMin = jetzt.getHours() * 60 + jetzt.getMinutes();
  const stunden = [];
  for (let h = 0; h < 24; h++) stunden.push(`<div class="cal-hour" style="height:${STUNDE_PX}px">${String(h).padStart(2, '0')}:00</div>`);
  const kopf = tage.map((d) => `<button type="button" class="cal-week-day ${d === heute ? 'today' : ''}" data-goday="${d}" title="Tag ansehen">
    <span class="w">${esc(WEEKDAYS[(fromISO(d).getDay() + 6) % 7])}</span> <span class="d">${Number(d.slice(8, 10))}</span></button>`).join('');
  const ganzZeilen = tage.map((d) => `<div class="cal-allday-cell" data-day="${d}" data-drop="1">${(ganz.get(d) || []).map((e) => evHtml(e, { zeit: false })).join('')}</div>`).join('');
  const spalten = tage.map((d) => {
    const lage = tagesLage(zeitlich.get(d) || []);
    const slots = [];
    for (let m = 0; m < 1440; m += 30) {
      const t = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      // Die Linie liegt am unteren Rand der Zeile: unter der vollen Stunde gestrichelt (halbe Stunde), unter der halben durchgezogen (volle Stunde).
      slots.push(`<div class="cal-slot ${m % 60 ? '' : 'half'}" data-day="${d}" data-slot="${t}" data-drop="1" style="height:${STUNDE_PX / 2}px" title="${esc(fmtDateShort(d) + ' ' + t)}"></div>`);
    }
    const evs = lage.map(({ e, von, bis, spalte, spalten: n }) => {
      const top = (von / 60) * STUNDE_PX;
      const h = Math.max(18, ((bis - von) / 60) * STUNDE_PX - 2);
      const hinweis = [e.title, `${e.startTime}${e.endTime ? ' bis ' + e.endTime : ''}`, e.location, e.extern ? `Google Kalender „${kalenderName(e.extern)}“${e.nurLesen ? ', nur lesen' : ''}` : ''].filter(Boolean).join(' · ');
      return `<div class="cal-ev cal-timed ${e.done ? 'done' : ''}${e.nurLesen ? ' cal-lesen' : ''}" data-appt="${esc(e.id)}" data-occ="${esc(e.spanStart || e.occurrence)}" ${e.nurLesen ? '' : 'draggable="true"'}
        style="top:${top}px;height:${h}px;left:calc(${(spalte / n) * 100}% + 1px);width:calc(${100 / n}% - 3px);${e.farbe ? `--ev:${esc(e.farbe)}` : ''}" title="${esc(hinweis)}">
        <span class="t">${esc(e.startTime)}${e.endTime ? ' bis ' + esc(e.endTime) : ''}</span>
        <span class="n">${esc(e.title)}</span>${e.location ? `<span class="l">${esc(e.location)}</span>` : ''}
      </div>`;
    }).join('');
    const now = d === heute ? `<div class="cal-now" style="top:${(jetztMin / 60) * STUNDE_PX}px"></div>` : '';
    return `<div class="cal-daycol ${d === heute ? 'today' : ''}" data-day="${d}">${slots.join('')}${evs}${now}</div>`;
  }).join('');
  // Der ganze Block scrollt, Kopf und ganztägige Zeile bleiben oben stehen: So liegen die Spalten
  // immer unter ihren Tagen, auch wenn die Bildlaufleiste Platz braucht.
  return `<div class="cal-week" style="--cols:${tage.length}">
    <div class="cal-week-kopf">
      <div class="cal-week-head"><div class="cal-gutter"></div>${kopf}</div>
      <div class="cal-allday"><div class="cal-gutter cal-gutter-text">ganztägig</div>${ganzZeilen}</div>
    </div>
    <div class="cal-timegrid">
      <div class="cal-hours">${stunden.join('')}</div>
      ${spalten}
    </div>
  </div>`;
}

/* ---- Listen --------------------------------------------------------------- */

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
  const anchor = e.isTax ? taxAttrs(e) : e.isEvent || e.isDue ? `data-tx="${esc(e.txId)}"` : e.isTodo ? `data-cal-todo="${esc(e.todoId)}"` : `data-appt="${esc(e.id)}"`;
  const zeit = e.isTax ? esc(e.hinweis) : e.isTodo ? 'fällig' : e.isDue ? `${esc(money(e.amount))} €`
    : e.spanEnd && e.spanEnd > e.occurrence ? `bis ${esc(fmtDate(e.spanEnd))}${e.allDay || !e.startTime ? '' : ', ab ' + esc(e.startTime)}`
      : e.allDay ? 'ganztägig' : esc((e.startTime || '') + (e.endTime ? ' – ' + e.endTime : ''));
  const tags = (e.tags || []).map((t) => `<span class="badge tiny">#${esc(t)}</span>`).join(' ');
  return `<div class="agenda-item" ${anchor}>
    <div class="agenda-date" ${e.farbe ? `style="color:${esc(e.farbe)}"` : ''}>
      <div class="d">${esc(e.occurrence.slice(8, 10))}</div>
      <div class="m">${esc(MONTHS_SHORT[Number(e.occurrence.slice(5, 7)) - 1])}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="strong truncate">${e.done ? '✓ ' : ''}${esc(e.title)}${e.isRepeat ? ' <span class="badge tiny">Wiederholung</span>' : ''}${e.isEvent ? ' <span class="badge info tiny">Veranstaltung</span>' : ''}${e.isDue ? ' <span class="badge warn tiny">Zahlungstermin</span>' : ''}${e.isTax ? ' <span class="badge warn tiny">Steuertermin</span>' : ''}${e.isTodo ? ' <span class="badge pos tiny">Aufgabe</span>' : ''} ${tags}</div>
      <div class="tiny muted">
        ${zeit}
        ${e.location ? ' · ' + esc(e.location) : ''}
        ${e.contactId ? ' · ' + esc(sel.contactName(e.contactId)) : ''}
        ${e.projektId && sel.projekt(e.projektId) ? ' · ' + esc(sel.projekt(e.projektId).name) : ''}
        ${e.extern ? ' · ' + esc(kalenderName(e.extern)) + (e.nurLesen ? ' (nur lesen)' : '') : e.calendarId ? ' · ' + esc(lokaleKalender(sel.settings()).find((k) => k.id === e.calendarId)?.name || '') : ''}
        · KW ${isoWeek(e.occurrence)}
      </div>
    </div>
    ${e.isEvent || e.isTax || e.isTodo || e.isDue ? '' : todoBadge(e.id)}
    ${linked ? `<span class="badge info">${icon('link', 12).__raw} ${linked} Buchung${linked > 1 ? 'en' : ''}</span>` : ''}
  </div>`;
}

function listeHtml(from, to) {
  const liste = (eintraege, leerTitel, leerText) => eintraege.length
    ? '<div class="cal-liste-inner">' + eintraege.map(agendaRow).join('') + '</div>'
    : emptyState(leerTitel, leerText).__raw;
  if (state.suche) {
    const von = addDays(todayISO(), -365);
    const bis = addDays(todayISO(), 365);
    const treffer = sortBy([...termine(von, bis, { liste: true }), ...sonstige(von, bis)], (e) => e.occurrence + (e.startTime || ''));
    return `<div class="card mt16 cal-liste">
      <div class="card-head"><h2>Suche: „${esc(state.suche)}“</h2><span class="sub">ein Jahr zurück und voraus</span><div class="spacer"></div><span class="badge">${int(treffer.length)}</span></div>
      <div class="card-body ${treffer.length ? 'tight' : ''}">${liste(treffer, 'Nichts gefunden', 'Kein Termin passt zu dieser Suche.')}</div>
    </div>`;
  }
  if (state.mode === 'agenda') {
    const heute = todayISO();
    const bis = addDays(heute, 365);
    const past = sortBy([...termine(addDays(heute, -365), addDays(heute, -1), { liste: true }), ...(state.showEvents ? eventEntries(addDays(heute, -365), addDays(heute, -1)) : [])], (e) => e.occurrence, -1).slice(0, 40);
    const events = sortBy([...termine(heute, bis, { liste: true }), ...sonstige(heute, bis)], (e) => e.occurrence + (e.startTime || ''));
    return `<div class="card mt16 cal-liste">
        <div class="card-head"><h2>Kommende Termine</h2><span class="sub">nächste zwölf Monate</span><div class="spacer"></div><span class="badge">${int(events.length)}</span></div>
        <div class="card-body ${events.length ? 'tight' : ''}">${liste(events, 'Nichts geplant', 'Legen Sie oben rechts einen Termin an.')}</div>
      </div>
      <div class="card mt16 cal-liste">
        <div class="card-head"><h2>Vergangene Termine</h2><span class="sub">letzte zwölf Monate</span></div>
        <div class="card-body ${past.length ? 'tight' : ''}">${liste(past, 'Keine Einträge', 'Hier erscheinen zurückliegende Termine.')}</div>
      </div>`;
  }
  let a = from;
  let b = to;
  let kopf = `Termine im ${titel()}`;
  if (state.mode === 'month') {
    a = state.cursor.slice(0, 8) + '01';
    b = monthEnd(a);
  } else if (state.mode === 'week') kopf = 'Termine der Woche';
  else kopf = 'An diesem Tag';
  // Im Monat stehen unten nur Termine und Aufgaben; Zahlungs- und Steuertermine zeigt das Raster.
  const eintraege = sortBy([...termine(a, b, { liste: true }), ...(state.mode === 'month' ? (state.showTodos ? todoEntries(a, b) : []) : sonstige(a, b))], (e) => e.occurrence + (e.startTime || ''));
  return `<div class="card mt16 cal-liste">
    <div class="card-head"><h2>${esc(kopf)}</h2><div class="spacer"></div><span class="badge">${int(eintraege.length)}</span></div>
    <div class="card-body ${eintraege.length ? 'tight' : ''}">${liste(eintraege, 'Keine Termine', state.mode === 'day' ? 'An diesem Tag ist nichts eingetragen.' : 'In diesem Zeitraum ist nichts eingetragen.')}</div>
  </div>`;
}

/* ---- Verdrahtung ---------------------------------------------------------- */

function wireEvents(root) {
  $$('[data-appt]', root).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    openAppointmentDialog(n.dataset.appt);
  }));
  $$('[data-cal-todo]', root).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    openTodoDialog(n.dataset.calTodo, {}, { nachSpeichern: () => draw(root) });
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
  $$('[data-more]', root).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    state.cursor = n.dataset.more;
    state.mode = 'day';
    merken();
    refresh();
  }));
  $$('[data-goday]', root).forEach((n) => n.addEventListener('click', () => {
    state.cursor = n.dataset.goday;
    state.mode = 'day';
    merken();
    refresh();
  }));
  const neu = (day, slot) => openAppointmentDialog(null, { date: day, calendarId: lokalerReiter(), ...(slot ? { allDay: false, startTime: slot, endTime: plusStunde(slot) } : {}) });
  $$('.cal-cell[data-day]', root).forEach((n) => {
    n.addEventListener('click', () => neu(n.dataset.day));
    n.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === n) { e.preventDefault(); neu(n.dataset.day); }
    });
  });
  $$('.cal-slot', root).forEach((n) => n.addEventListener('click', () => neu(n.dataset.day, n.dataset.slot)));
  $$('.cal-allday-cell', root).forEach((n) => n.addEventListener('click', (e) => { if (e.target === n) neu(n.dataset.day); }));
}

function plusStunde(hhmm) {
  const t = minuten(hhmm) + 60;
  return t >= 1440 ? '23:59' : `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Ziehen und Ablegen: ein Termin auf einen anderen Tag (Monat, ganztägige
 * Zeile) oder in eine andere halbe Stunde (Zeitraster). Eine Reihe wandert
 * als Ganzes mit. Aufgaben, Zahlungstermine und Steuertermine lassen sich
 * nicht ziehen, sie gehören zu ihrer Buchung.
 */
function wireDnd(root) {
  let drag = null;
  $$('.cal-ev[draggable]', root).forEach((n) => {
    n.addEventListener('dragstart', (e) => {
      drag = { id: n.dataset.appt, occ: n.dataset.occ };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', n.dataset.appt); } catch { /* egal */ }
      n.classList.add('dragging');
    });
    n.addEventListener('dragend', () => {
      drag = null;
      n.classList.remove('dragging');
      $$('.drop-over', root).forEach((x) => x.classList.remove('drop-over'));
    });
  });
  $$('[data-drop]', root).forEach((z) => {
    z.addEventListener('dragover', (e) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      z.classList.add('drop-over');
    });
    z.addEventListener('dragleave', () => z.classList.remove('drop-over'));
    z.addEventListener('drop', async (e) => {
      e.preventDefault();
      z.classList.remove('drop-over');
      if (!drag) return;
      const d = drag;
      drag = null;
      await terminAblegen(d, z.dataset.day, z.dataset.slot || '', root);
    });
  });
}

async function terminAblegen({ id, occ }, tag, slot, root) {
  const a = sel.appointment(id);
  if (!a || !tag) return;
  if (nurLesen(a)) {
    warn('Nur lesbar', 'Dieser Termin gehört zu einem geteilten Kalender, den Kontovia nur anzeigt.');
    return;
  }
  const neu = verschoben(a, { aufTag: tag, vonTag: occ || a.date, startTime: a.allDay ? '' : slot });
  if (neu.date === a.date && neu.startTime === a.startTime) return;
  const reihe = (a.recurrence?.freq || 'none') !== 'none';
  await upsertAppointment(neu);
  ok('Termin verschoben', reihe ? `Die ganze Reihe beginnt jetzt am ${fmtDate(neu.date)}.` : `${fmtDateLong(neu.date)}${neu.allDay ? '' : ', ' + neu.startTime}`);
  drawInhalt(root);
}

/* -------------------------------------------------------------------------- */
/* Termindialog                                                                */
/* -------------------------------------------------------------------------- */

export function openAppointmentDialog(id, preset = {}) {
  const existing = id ? sel.appointment(id) : null;
  if (existing) fokusMerken('termin', existing.id);
  const a = existing ? structuredClone(existing) : {
    id: uid('apt'),
    title: '',
    date: preset.date || todayISO(),
    endDate: '',
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    notes: '',
    contactId: '',
    projektId: '',
    calendarId: '',
    color: '',
    tags: [],
    done: false,
    transactionIds: [],
    recurrence: { freq: 'none', until: '' },
    reminderMinutes: 0,
    createdAt: new Date().toISOString(),
    // Vorausgefüllt, etwa vom Assistenten, von der Projektseite oder der Schnelleingabe.
    ...Object.fromEntries(Object.entries(preset).filter(([k, v]) => ['title', 'allDay', 'startTime', 'endTime', 'endDate', 'location', 'notes', 'contactId', 'projektId', 'calendarId', 'tags', 'recurrence', 'color', 'reminderMinutes'].includes(k) && v !== undefined)),
  };
  if (!Array.isArray(a.tags)) a.tags = [];
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
        ${!isNew ? `<button class="btn sm" id="btnCopy" title="Einen neuen Termin mit denselben Angaben anlegen">${icon('copy', 14).__raw} Kopie</button>` : ''}
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

  /* Kalender: eigene Kalender immer, weitere Google-Kalender nur für neue
     Termine. Den Google-Kalender eines bestehenden Termins zu wechseln, ist
     nicht vorgesehen; bestehende zeigen, woher sie kommen. */
  const weitere = calState.status?.linked && calState.status?.weitereErlaubt ? calendarSettings().weitere.filter((k) => !k.readOnly) : [];
  const lokale = lokaleKalender(sel.settings());
  // Ein Termin aus einem mit dem Konto geteilten Kalender: Google gilt, Kontovia schreibt nie dorthin.
  const lesend = !isNew && nurLesen(existing);
  function kalenderFeld() {
    if (lesend) {
      return `<div class="notice mb16 small">${icon('lock', 14).__raw} Aus dem geteilten Google Kalender
        <strong>„${esc(kalenderName(a.extern))}“</strong>, den Kontovia nur anzeigt. Titel, Zeit, Ort und Notiz ändern sich nur dort.
        Kontakt, Projekt, Tags, Aufgaben und Buchungen können Sie hier trotzdem ergänzen.</div>`;
    }
    if (a.extern && !isNew) {
      const aktiv = calendarSettings().weitere.some((k) => k.id === a.extern.calendarId);
      return `<div class="notice mb16 small">${icon('calendar', 14).__raw} Aus Google Kalender
        <strong>„${esc(kalenderName(a.extern))}“</strong>. ${aktiv
        ? 'Änderungen und Löschen gehen beim nächsten Abgleich auch dorthin.'
        : 'Dieser Kalender wird derzeit nicht abgeglichen; Änderungen bleiben in Kontovia.'}</div>`;
    }
    if (lokale.length < 2 && !weitere.length) return '';
    const wahl = a.extern?.calendarId ? 'g:' + a.extern.calendarId : (a.calendarId || '');
    return `<div class="field">
        <label>Kalender</label>
        <select id="t_kalender">
          ${lokale.length > 1 && weitere.length ? '<optgroup label="Meine Kalender">' : ''}
          ${lokale.map((k) => `<option value="${esc(k.id)}" ${k.id === wahl ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
          ${lokale.length > 1 && weitere.length ? '</optgroup>' : ''}
          ${isNew && weitere.length ? `<optgroup label="Google Kalender">${weitere.map((k) => `<option value="g:${esc(k.id)}" ${'g:' + k.id === wahl ? 'selected' : ''}>${esc(k.name || k.id)}</option>`).join('')}</optgroup>` : ''}
        </select>
        <span class="hint">${weitere.length ? 'Ein Google-Kalender trägt den Termin direkt dort ein.' : 'Kalender lassen sich einzeln ein- und ausblenden.'}</span>
      </div>`;
  }

  /** Projekt des Termins (lib/projektwahl.js): Der Termin erscheint dann auf der Projektseite. */
  function projektFeld() {
    return projektAuswahl(a.projektId || '', { praefix: 't_', hinweis: 'Der Termin steht dann auch auf der Seite des Projekts.' });
  }

  function farbFeld() {
    const kal = lokale.find((k) => k.id === (a.calendarId || ''));
    return `<div class="field">
      <label>Farbe</label>
      <div class="cal-swatches" role="radiogroup" aria-label="Farbe des Termins">
        <button type="button" class="cal-swatch ${!a.color ? 'active' : ''}" data-color="" title="Farbe des Kalenders" aria-label="Farbe des Kalenders" aria-pressed="${!a.color}" style="--c:${esc(kal?.color || 'var(--accent)')}"><span class="cal-swatch-auto"></span></button>
        ${FARBEN.map(([name, wert]) => `<button type="button" class="cal-swatch ${a.color === wert ? 'active' : ''}" data-color="${wert}" title="${esc(name)}" aria-label="${esc(name)}" aria-pressed="${a.color === wert}" style="--c:${wert}"></button>`).join('')}
      </div>
    </div>`;
  }

  function erinnerungFeld() {
    const ganz = a.allDay || !a.startTime;
    const liste = ganz ? ERINNERUNG_GANZTAGS : ERINNERUNG_ZEIT;
    const wert = Number(a.reminderMinutes || 0);
    const bekannt = liste.some(([mm]) => mm === wert);
    return `<select id="t_reminder">
      ${liste.map(([mm, text]) => `<option value="${mm}" ${mm === wert ? 'selected' : ''}>${esc(text)}</option>`).join('')}
      ${!bekannt && wert ? `<option value="${wert}" selected>${esc(erinnerungText(a))}</option>` : ''}
    </select>`;
  }

  function wiederholungFeld() {
    const r = a.recurrence || {};
    const freq = r.freq || 'none';
    const n = intervall(r);
    const tage = wochentage(r);
    const mitTagen = freq === 'weekly' || freq === 'biweekly';
    return `<div class="field">
        <label>Wiederholung</label>
        <div class="row" style="gap:8px">
          <select id="t_freq" style="flex:1">
            ${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${freq === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
          <label class="row nowrap small" style="gap:4px;${freq === 'none' || freq === 'biweekly' ? 'display:none' : ''}" id="t_intervalWrap">alle
            <input type="number" id="t_interval" min="1" max="99" value="${n}" style="width:56px" aria-label="Abstand der Wiederholung">
            <span id="t_intervalEinheit">${esc({ daily: 'Tage', weekly: 'Wochen', monthly: 'Monate', yearly: 'Jahre' }[freq] || '')}</span></label>
        </div>
        <div class="cal-weekdays" id="t_weekdays" style="${mitTagen ? '' : 'display:none'}" role="group" aria-label="Wochentage">
          ${WOCHENTAGE.map((d, i) => `<label class="cal-weekday"><input type="checkbox" value="${d}" ${tage.includes(d) ? 'checked' : ''}> ${esc(WEEKDAYS[i])}</label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Wiederholen bis</label>
        <input type="date" id="t_until" value="${esc(r.until || '')}" ${freq === 'none' ? 'disabled' : ''}>
        <span class="hint" id="t_regelText">${esc(freq === 'none' ? '' : regelText(a, { tage: WEEKDAYS }))}</span>
      </div>`;
  }

  function draw() {
    const linked = (a.transactionIds || []).map(sel.transaction).filter(Boolean);
    const tagsBekannt = alleTags(sel.appointments()).map((t) => t.tag);
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
          <label>Letzter Tag</label>
          <input type="date" id="t_endDate" value="${a.endDate || ''}" min="${a.date}">
          <span class="hint">Nur für Termine über mehrere Tage, sonst leer lassen.</span>
        </div>
        <div class="field">
          <label>Zeit</label>
          <div class="row cal-zeitzeile" style="gap:8px">
            <label class="check nowrap"><input type="checkbox" id="t_allDay" ${a.allDay ? 'checked' : ''}> ganztägig</label>
            <input type="time" id="t_start" value="${a.startTime || '09:00'}" ${a.allDay ? 'disabled' : ''} aria-label="Beginn">
            <input type="time" id="t_end" value="${a.endTime || ''}" ${a.allDay ? 'disabled' : ''} aria-label="Ende">
          </div>
        </div>
        <div class="field">
          <label>Erinnerung</label>
          <span id="t_reminderWrap">${raw(erinnerungFeld())}</span>
          <span class="hint">Als Hinweis im Programm, auf Wunsch als Benachrichtigung des Geräts (Einstellungen → Kalender).</span>
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
        ${raw(projektFeld())}
        <div class="field">
          <label>Tags</label>
          <input id="t_tags" value="${(a.tags || []).join(', ')}" placeholder="z. B. Kunde, Steuer, privat" list="t_tagsListe">
          <datalist id="t_tagsListe">${raw(tagsBekannt.map((t) => `<option value="${esc(t)}">`).join(''))}</datalist>
          <span class="hint">Mehrere mit Komma trennen. Nach Tags lässt sich der Kalender filtern.</span>
        </div>
        ${raw(farbFeld())}
        ${raw(wiederholungFeld())}
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

    // Was von Google kommt, ist gesperrt; die eigenen Angaben darunter bleiben offen.
    if (lesend) {
      for (const k of ['title', 'date', 'endDate', 'allDay', 'start', 'end', 'location', 'notes', 'freq', 'interval', 'until']) {
        const feld = form.querySelector('#t_' + k);
        if (feld) feld.disabled = true;
      }
      form.querySelectorAll('#t_weekdays input').forEach((c) => { c.disabled = true; });
    }
    form.querySelector('#t_allDay').addEventListener('change', (e) => {
      a.allDay = e.target.checked;
      form.querySelector('#t_start').disabled = a.allDay;
      form.querySelector('#t_end').disabled = a.allDay;
      // Ganztägig und mit Uhrzeit haben andere Erinnerungen; der Wert wird zurückgesetzt, wenn er nicht passt.
      const liste = a.allDay ? ERINNERUNG_GANZTAGS : ERINNERUNG_ZEIT;
      if (!liste.some(([mm]) => mm === Number(a.reminderMinutes || 0))) a.reminderMinutes = 0;
      form.querySelector('#t_reminderWrap').innerHTML = html`${raw(erinnerungFeld())}`;
    });
    form.querySelector('#t_date').addEventListener('change', (e) => {
      form.querySelector('#t_endDate').min = e.target.value;
    });
    const freqFeld = form.querySelector('#t_freq');
    const regelZeigen = () => {
      const freq = freqFeld.value;
      form.querySelector('#t_until').disabled = freq === 'none';
      form.querySelector('#t_intervalWrap').style.display = freq === 'none' || freq === 'biweekly' ? 'none' : '';
      form.querySelector('#t_intervalEinheit').textContent = { daily: 'Tage', weekly: 'Wochen', monthly: 'Monate', yearly: 'Jahre' }[freq] || '';
      form.querySelector('#t_weekdays').style.display = freq === 'weekly' || freq === 'biweekly' ? '' : 'none';
      collect();
      form.querySelector('#t_regelText').textContent = freq === 'none' ? '' : regelText(a, { tage: WEEKDAYS });
    };
    freqFeld.addEventListener('change', regelZeigen);
    form.querySelector('#t_interval').addEventListener('input', regelZeigen);
    form.querySelectorAll('#t_weekdays input').forEach((c) => c.addEventListener('change', regelZeigen));
    form.querySelectorAll('.cal-swatch').forEach((b) => b.addEventListener('click', () => {
      a.color = b.dataset.color;
      form.querySelectorAll('.cal-swatch').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    }));
    form.querySelector('#t_kalender')?.addEventListener('change', () => {
      collect();
      // Die Vorschau „Farbe des Kalenders“ folgt dem gewählten Kalender.
      const kal = lokale.find((k) => k.id === (a.calendarId || ''));
      form.querySelector('.cal-swatch[data-color=""]').style.setProperty('--c', kal?.color || 'var(--accent)');
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
        ...(a.projektId ? { projektId: a.projektId } : {}),
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
    const ende = g('endDate').value;
    a.endDate = ende && ende > a.date ? ende : '';
    a.allDay = g('allDay').checked;
    a.startTime = a.allDay ? '' : g('start').value;
    a.endTime = a.allDay ? '' : g('end').value;
    a.location = g('location').value.trim();
    a.contactId = g('contactId').value;
    if (g('projektId')) a.projektId = g('projektId').value;
    a.notes = g('notes').value.trim();
    a.tags = tagsLesen(g('tags').value);
    a.reminderMinutes = Number(g('reminder')?.value || 0) || 0;
    const freq = g('freq').value;
    // Eine Wiederholung aus Google, die Kontovia nicht darstellen kann, bleibt
    // erhalten, solange hier keine eigene gewählt wird.
    const google = freq === 'none' && Array.isArray(a.recurrence?.google) ? { google: a.recurrence.google } : {};
    const r = { freq, until: g('until').value, ...google };
    const n = Math.min(99, Math.max(1, Number(g('interval').value) || 1));
    if (freq !== 'none' && freq !== 'biweekly' && n > 1) r.interval = n;
    if (freq === 'weekly' || freq === 'biweekly') {
      const tage = [...form.querySelectorAll('#t_weekdays input:checked')].map((c) => c.value);
      if (tage.length) r.byDay = tage;
    }
    a.recurrence = r;
    const kal = form.querySelector('#t_kalender');
    if (kal) {
      const wert = kal.value;
      if (wert.startsWith('g:')) {
        const k = weitere.find((x) => x.id === wert.slice(2));
        if (k) { a.extern = { calendarId: k.id, eventId: eventIdFor(a.id), calendarName: k.name || '' }; a.calendarId = ''; }
      } else {
        if (isNew) delete a.extern;
        a.calendarId = wert;
      }
    }
  }

  /** Alles, was „Abbrechen“ verwerfen würde – Termin, Aufgaben und ein angefangener Aufgabentitel. */
  function stand() {
    collect();
    return JSON.stringify([a, todos, geloest.map((t) => t.id), form.querySelector('#t_todoNew')?.value.trim() || '']);
  }

  function pruefen() {
    if (lesend) return true; // die Angaben von Google sind gesperrt und kommen von dort
    if (!a.title) { warn('Bitte einen Titel eintragen'); return false; }
    if (!a.allDay && a.startTime && a.endTime && a.endTime < a.startTime && !a.endDate) {
      warn('Ende liegt vor dem Beginn', 'Bitte die Uhrzeiten prüfen. Ein Termin über mehrere Tage bekommt einen letzten Tag.');
      form.querySelector('#t_end')?.focus();
      return false;
    }
    if (a.recurrence?.freq !== 'none' && a.recurrence?.until && a.recurrence.until < a.date) {
      warn('Wiederholung endet vor dem ersten Termin', 'Bitte „Wiederholen bis“ prüfen.');
      return false;
    }
    return true;
  }

  m.root.querySelector('#btnCancel').addEventListener('click', () => m.dismiss());
  m.root.querySelector('#btnSave').addEventListener('click', async () => {
    collect();
    if (!pruefen()) return;
    fertig = true;
    await upsertAppointment(a);
    await saveTodos();
    m.close();
    ok(isNew ? 'Termin angelegt' : 'Termin gespeichert', `${fmtDateLong(a.date)}`);
    refresh();
  });
  m.root.querySelector('#btnDel')?.addEventListener('click', async () => {
    const auchGoogle = lesend
      ? ` Im geteilten Google Kalender „${kalenderName(a.extern)}“ bleibt er bestehen; Kontovia blendet ihn nur hier aus.`
      : a.extern && calendarSettings().weitere.some((k) => k.id === a.extern.calendarId)
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
  m.root.querySelector('#btnCopy')?.addEventListener('click', () => {
    collect();
    fertig = true;
    m.close();
    const { id: _id, extern: _extern, done: _done, transactionIds: _tx, createdAt: _c, updatedAt: _u, ...rest } = a;
    openAppointmentDialog(null, { ...rest, date: a.date });
  });

  draw();
  ausgangslage = stand();
}

/** Anzeigename des Google-Kalenders, aus dem ein Termin stammt. */
function kalenderName(extern) {
  return calendarSettings().weitere.find((k) => k.id === extern?.calendarId)?.name || extern?.calendarName || 'weiterer Kalender';
}

/* -------------------------------------------------------------------------- */
/* Kalender verwalten                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Eigene Kalender anlegen, umbenennen, färben und entfernen. Die Liste steht
 * in den Einstellungen des Tresors und gilt damit auf allen Geräten. Beim
 * Entfernen wandern die Termine in den Standardkalender.
 */
export function openKalenderVerwaltung() {
  return new Promise((resolve) => {
    const s = sel.settings();
    const liste = lokaleKalender(s).map((k) => ({ ...k }));
    let fertig = false;
    const m = modal({
      title: 'Kalender verwalten',
      body: '<div id="kalListe"></div>',
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    const host = m.root.querySelector('#kalListe');
    const weitere = calendarSettings().weitere;
    const anzahl = (id) => sel.appointments().filter((a) => !a.extern && (a.calendarId || '') === id).length;
    const zeichnen = () => {
      host.innerHTML = html`
        <p class="mt0 small" style="line-height:1.6">Mehrere Kalender halten Berufliches und Privates, Standorte oder Personen getrennt. In der Ansicht sehen Sie
        alle zusammen oder einen einzeln (Reiter), jeder lässt sich ein- und ausblenden.</p>
        <div class="stack" style="gap:8px">
          ${raw(liste.map((k, i) => `
            <div class="row cal-kal-zeile" style="gap:8px">
              <select data-kal-farbe="${i}" aria-label="Farbe" class="sm cal-farbwahl" style="--c:${esc(k.color || 'var(--accent)')};width:150px;flex:none">
                <option value="" ${!k.color ? 'selected' : ''}>Standardfarbe</option>
                ${FARBEN.map(([name, wert]) => `<option value="${wert}" ${k.color === wert ? 'selected' : ''}>${esc(name)}</option>`).join('')}
              </select>
              <input data-kal-name="${i}" value="${esc(k.name)}" aria-label="Name des Kalenders" style="flex:1;min-width:0" maxlength="60">
              <span class="badge" title="Termine in diesem Kalender">${int(anzahl(k.id))}</span>
              ${k.id ? `<button type="button" class="icon-btn" data-kal-weg="${i}" title="Kalender entfernen (die Termine bleiben und wandern in „${esc(liste[0].name)}“)" aria-label="${esc(k.name)} entfernen">${icon('trash', 15).__raw}</button>` : '<span style="width:28px"></span>'}
            </div>`).join(''))}
        </div>
        <button type="button" class="btn sm mt8" id="kalNeu">${icon('plus', 14)} Neuer Kalender</button>
        ${weitere.length ? raw(`<hr class="sep"><p class="small muted mt0 mb0">Google-Kalender (${esc(weitere.map((k) => k.name || k.id).join(', '))}) verwalten Sie unter „Abgleich“: dort auswählen, lösen und auf Wunsch die von Kontovia angelegten Einträge löschen.</p>`) : ''}`;
      host.querySelectorAll('[data-kal-name]').forEach((inp) => inp.addEventListener('input', () => { liste[Number(inp.dataset.kalName)].name = inp.value; }));
      host.querySelectorAll('[data-kal-farbe]').forEach((sl) => sl.addEventListener('change', () => {
        liste[Number(sl.dataset.kalFarbe)].color = sl.value;
        sl.style.setProperty('--c', sl.value || 'var(--accent)');
      }));
      host.querySelectorAll('[data-kal-weg]').forEach((b) => b.addEventListener('click', () => { liste.splice(Number(b.dataset.kalWeg), 1); zeichnen(); }));
      host.querySelector('#kalNeu').addEventListener('click', () => {
        liste.push({ id: neueKalenderId({ kalender: liste.filter((k) => k.id) }), name: `Kalender ${liste.length}`, color: FARBEN[liste.length % FARBEN.length][1] });
        zeichnen();
        host.querySelectorAll('[data-kal-name]')[liste.length - 1]?.select();
      });
    };
    zeichnen();
    m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const standard = liste[0];
      const eigene = liste.slice(1).map((k) => ({ id: k.id, name: k.name.trim() || 'Kalender', color: k.color || '' }));
      const bleiben = new Set(eigene.map((k) => k.id));
      fertig = true;
      await commit('kalender.liste', (db) => {
        db.settings.kalender = eigene;
        db.settings.kalenderStandardName = standard.name.trim() || undefined;
        db.settings.kalenderStandardFarbe = standard.color || undefined;
        db.settings.updatedAt = new Date().toISOString();
        // Termine entfernter Kalender gehören jetzt zum Standardkalender.
        const jetzt = new Date().toISOString();
        for (const a of db.appointments) {
          if (a.calendarId && !bleiben.has(a.calendarId)) { a.calendarId = ''; a.updatedAt = jetzt; }
        }
        return eigene.length;
      }, { entity: 'einstellungen', summary: `Kalender: ${[standard.name, ...eigene.map((k) => k.name)].join(', ')}` });
      await saveNow();
      // Reiter und Ausblendungen entfernter Kalender aufräumen.
      for (const k of [...state.kalenderAus]) if (!k.startsWith('g:') && k && !bleiben.has(k)) state.kalenderAus.delete(k);
      merken();
      m.close();
      ok('Kalender gespeichert');
      resolve(true);
    });
  });
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
