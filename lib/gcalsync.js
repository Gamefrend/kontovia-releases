/**
 * Kontovia – Ablauf des Kalenderabgleichs mit Google.
 *
 * Holen, vergleichen, ausführen, merken:
 *   1. der Hauptprozess holt alle Ereignisse des Kontovia-Kalenders
 *   2. gcal.js entscheidet, was wohin muss
 *   3. der Hauptprozess schreibt nach Google, hier wird lokal übernommen
 *   4. der Merkzettel (wer hat was zuletzt gesehen) wird festgehalten
 *
 * Automatisch läuft das beim Entsperren, alle 15 Minuten und kurz nach jeder
 * Änderung an Terminen oder Buchungen – aber nur, wenn auf diesem Gerät ein
 * Google-Konto verbunden ist.
 */

import { store, sel, saveNow, subscribe, applyCalendarChanges } from './store.js';
import { planSync, derivedEntries, eventIdFor } from './gcal.js';

const api = globalThis.window?.kontovia || {};

export const calState = {
  running: false,
  status: null,     // letzte Antwort von api.gcal.status()
  lastAt: null,
  lastError: null,
  lastSummary: '',
};

const watchers = new Set();
export function onCalendarSync(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function emit() { for (const fn of watchers) { try { fn(calState); } catch { /* egal */ } } }

export function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'; } catch { return 'Europe/Berlin'; }
}

/** Einstellungen des Abgleichs – im Tresor, damit alle Geräte dieselben haben. */
export function calendarSettings() {
  const g = store.db?.settings?.googleCalendar || {};
  return {
    calendarId: g.calendarId || '',
    includeEvents: g.includeEvents !== false,
    includeDue: g.includeDue === true,
    sendNotes: g.sendNotes !== false,
  };
}

export async function refreshCalendarStatus() {
  if (!api.gcal) { calState.status = { available: false, linked: false }; emit(); return calState.status; }
  try {
    calState.status = await api.gcal.status();
    if (calState.status?.lastSyncAt) calState.lastAt = calState.status.lastSyncAt;
    if (calState.status?.lastError && !calState.lastError) calState.lastError = calState.status.lastError;
  } catch {
    calState.status = { available: false, linked: false };
  }
  emit();
  return calState.status;
}

/**
 * Ein vollständiger Abgleich.
 * @returns {Promise<{summary:string, stats:object}|{skipped:string}>}
 */
export async function syncCalendar({ reason = 'manuell' } = {}) {
  if (calState.running) return { skipped: 'läuft-bereits' };
  if (!api.gcal || !store.db) return { skipped: 'nicht-verfügbar' };
  const st = await refreshCalendarStatus();
  if (!st?.linked) return { skipped: 'nicht-verbunden' };

  calState.running = true;
  calState.lastError = null;
  emit();
  try {
    if (store.dirty) await saveNow();
    const cfg = calendarSettings();
    const tz = timeZone();
    const pull = await api.gcal.pull({ timeZone: tz });
    const plan = planSync({
      appointments: sel.appointments(),
      tombstones: store.db.tombstones || [],
      events: pull.events,
      map: pull.map || {},
      derived: derivedEntries(store.db, { events: cfg.includeEvents, due: cfg.includeDue }),
      timeZone: tz,
      sendNotes: cfg.sendNotes,
    });

    // Sicherung gegen einen Abgleich, der plötzlich den halben Bestand
    // löschen will – etwa nach dem Einspielen einer alten Sicherung oder wenn
    // Google einmal eine unvollständige Liste liefert. Lieber anhalten und
    // fragen lassen als stillschweigend Termine verlieren.
    const bekannt = Object.keys(pull.map || {}).length;
    const loeschenFern = plan.ops.filter((o) => o.kind === 'delete' && !o.derived).length;
    if ((plan.removals.length > 5 && plan.removals.length > bekannt / 2)
        || (loeschenFern > 5 && loeschenFern > bekannt / 2)) {
      throw new Error(`Der Abgleich würde ${plan.removals.length + loeschenFern} Termine löschen – ungewöhnlich viele. `
        + 'Er wurde deshalb angehalten. Bitte prüfen Sie den Kalender „Kontovia“ in Google; zum Neuanfang Google Kalender trennen und neu verbinden.');
    }

    const results = plan.ops.length ? await api.gcal.push(plan.ops) : [];

    const upserts = plan.upserts.map(({ _remoteUpdated, ...a }) => a);
    const bestehend = new Set(sel.appointments().map((a) => a.id));
    const neu = upserts.filter((a) => !bestehend.has(a.id)).length;
    const summary = [
      neu && `${neu} neu aus Google`,
      upserts.length - neu && `${upserts.length - neu} aus Google geändert`,
      plan.removals.length && `${plan.removals.length} in Google gelöscht`,
      results.filter((r) => r.ok).length && `${results.filter((r) => r.ok).length} nach Google übertragen`,
    ].filter(Boolean).join(', ') || 'alles auf dem gleichen Stand';

    if (upserts.length || plan.removals.length) {
      await applyCalendarChanges({ upserts, removals: plan.removals, summary: `Google Kalender: ${summary}` });
    }

    // Merkzettel: was jetzt auf beiden Seiten gilt.
    const map = { ...plan.links };
    for (const u of plan.upserts) map[eventIdFor(u.id)] = { updated: u._remoteUpdated, localAt: u.updatedAt };
    const fehler = [];
    results.forEach((r, i) => {
      const op = plan.ops[i];
      if (!r?.ok) {
        fehler.push(r?.error || 'unbekannter Fehler');
        // Den alten Stand behalten, damit der nächste Abgleich es erneut versucht.
        if (pull.map?.[op.eventId]) map[op.eventId] = pull.map[op.eventId];
        return;
      }
      if (op.kind === 'delete') return;
      map[op.eventId] = op.derived ? { updated: r.updated, hash: op.hash } : { updated: r.updated, localAt: op.localAt };
    });
    const fehlerText = fehler.length ? `${fehler.length} Termin(e) nicht übertragen: ${fehler[0]}` : null;
    await api.gcal.finish({ map, error: fehlerText });

    calState.lastAt = new Date().toISOString();
    calState.lastSummary = summary;
    calState.lastError = fehlerText;
    return { summary, stats: { ops: plan.ops.length, upserts: upserts.length, removals: plan.removals.length, errors: fehler.length }, reason };
  } catch (e) {
    calState.lastError = e.message;
    try { await api.gcal.finish({ error: e.message }); } catch { /* egal */ }
    throw e;
  } finally {
    calState.running = false;
    await refreshCalendarStatus().catch(() => {});
    emit();
  }
}

/* -------------------------------------------------------------------------- */
/* Automatik                                                                   */
/* -------------------------------------------------------------------------- */

let timer = null;
let pending = null;
let unsub = null;

/** Änderungen, nach denen sich ein Abgleich lohnt. */
const ANLASS = /^(termin\.(anlegen|aendern|loeschen)|buchung\.)/;

export async function startCalendarSync() {
  stopCalendarSync();
  const st = await refreshCalendarStatus();
  if (!st?.linked) return;
  const leise = () => syncCalendar({ reason: 'automatisch' }).catch((e) => console.warn('Kalenderabgleich:', e.message));
  timer = setInterval(leise, 15 * 60 * 1000);
  unsub = subscribe((ev) => {
    if (ev.type !== 'change' || !ANLASS.test(ev.action || '')) return;
    clearTimeout(pending);
    pending = setTimeout(leise, 8000);
  });
  leise();
}

export function stopCalendarSync() {
  clearInterval(timer);
  clearTimeout(pending);
  unsub?.();
  timer = null;
  pending = null;
  unsub = null;
}
