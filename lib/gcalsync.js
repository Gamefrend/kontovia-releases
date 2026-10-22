/**
 * Kontovia – Ablauf des Kalenderabgleichs mit Google.
 *
 * Holen, vergleichen, ausführen, merken:
 *   1. die Web-Schicht (src/web/gcal.js) holt alle Ereignisse des Kontovia-Kalenders und – wenn
 *      ausgewählt – der weiteren Kalender (ab gut einem Jahr zurück)
 *   2. gcal.js entscheidet, was wohin muss
 *   3. die Web-Schicht schreibt nach Google, hier wird lokal übernommen
 *   4. der Merkzettel (wer hat was zuletzt gesehen) wird festgehalten
 *
 * Automatisch läuft das beim Entsperren, alle fünf Minuten, sobald Kontovia
 * wieder im Vordergrund ist oder das Netz zurückkehrt, und kurz nach jeder
 * Änderung an Terminen oder Buchungen – aber nur, wenn auf diesem Gerät ein
 * Google-Konto verbunden ist. Mit dem Konto geteilte Kalender kommen auf
 * Wunsch von selbst dazu (nur lesend).
 */

import { store, sel, commit, saveNow, subscribe, applyCalendarChanges } from './store.js';
import { planSync, planWeitere, derivedEntries, eventIdFor, WEITERE_TAGE_ZURUECK } from './gcal.js';
import { geteilteAbgleichen } from './kalender.js';
import { addDays, todayISO } from './util.js';
import { kann } from './lizenz.js';

const api = globalThis.window?.kontovia || {};

/** Wie weit nach vorn ein nur lesbarer, geteilter Kalender geholt wird. */
export const LESEN_TAGE_VOR = 730;
/** Abstand der Abgleiche im Hintergrund und Mindestabstand nach der Rückkehr ins Fenster. */
const INTERVALL_MS = 5 * 60 * 1000;
const RUECKKEHR_MS = 2 * 60 * 1000;
/** Pause nach einer Änderung, damit mehrere Eingaben in einem Abgleich landen. */
const NACH_AENDERUNG_MS = 5000;

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
    // Weitere Google-Kalender: [{id, name, color?, readOnly?}]. Nur lesbare (geteilte) Kalender laufen in eine
    // Richtung, die übrigen in beide.
    weitere: Array.isArray(g.weitere) ? g.weitere.filter((k) => k && typeof k.id === 'string') : [],
    // Geteilte Kalender von selbst dazunehmen; was abgewählt wurde, kommt nicht wieder.
    autoGeteilt: g.autoGeteilt === true,
    autoGesetzt: g.autoGeteilt !== undefined, // nie gewählt: der Auswahldialog schlägt „an“ vor
    abgewaehlt: Array.isArray(g.abgewaehlt) ? g.abgewaehlt.filter((id) => typeof id === 'string') : [],
  };
}

/**
 * Einstellungen des Abgleichs schreiben (im Tresor, ohne Journalzeile).
 * `system`: der Abgleich selbst führt Namen, Farben und neu geteilte Kalender nach;
 * das gilt dann für jede Rolle, wie bei den Terminen aus dem Abgleich.
 */
export async function saveCalendarSettings(patch, { system = false } = {}) {
  await commit('einstellung.kalender', (db) => {
    db.settings.googleCalendar = { ...(db.settings.googleCalendar || {}), ...patch };
    db.settings.updatedAt = new Date().toISOString();
  }, { silent: true, system });
  await saveNow();
}

/**
 * Vor dem Abgleich: Namen, Farben und Rechte der gewählten Kalender nachführen
 * und, wenn gewünscht, neu geteilte Kalender aufnehmen. Eine Liste, die Google
 * gerade nicht liefert, hält den Abgleich nicht auf.
 */
async function geteilteNachfuehren(cfg) {
  let liste;
  try {
    liste = await api.gcal.calendars();
  } catch (e) {
    if (e?.code === 'BESTAETIGEN') throw e;
    return { cfg, neu: [] };
  }
  const r = geteilteAbgleichen({ weitere: cfg.weitere, liste, auto: cfg.autoGeteilt, abgewaehlt: cfg.abgewaehlt });
  if (!r.geaendert) return { cfg, neu: [] };
  await saveCalendarSettings({ weitere: r.weitere }, { system: true });
  return { cfg: { ...cfg, weitere: r.weitere }, neu: r.neu };
}

/* Stille Erneuerung des Zugriffs (src/web/gcal.js, still): Scheitert sie, wird nicht bei jedem Abgleich
   erneut gefragt, und nach drei Fehlschlägen ruht sie, bis jemand von Hand bestätigt hat oder die Seite
   neu geladen wird (der Browser sperrt dann vermutlich Cookies von Drittseiten). */
const STILL_PAUSE_MS = 20 * 60 * 1000;
const STILL_FEHLER_MAX = 3;
let stillFehler = { n: 0, am: 0 };

/** Nach einer Bestätigung von Hand darf die stille Erneuerung wieder versuchen. */
export function stillZuruecksetzen() { stillFehler = { n: 0, am: 0 }; }

async function stillErneuern() {
  if (!api.gcal?.still) return false;
  if (stillFehler.n >= STILL_FEHLER_MAX || Date.now() - stillFehler.am < STILL_PAUSE_MS) return false;
  let r = null;
  try { r = await api.gcal.still(); } catch { /* wie ein Fehlschlag */ }
  if (r?.ok) { stillZuruecksetzen(); return true; }
  stillFehler = { n: stillFehler.n + 1, am: Date.now() };
  return false;
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
  let st = await refreshCalendarStatus();
  if (!st?.linked) return { skipped: 'nicht-verbunden' };
  // Web-Fassung: Der Zugriff gilt eine Stunde. Erst still erneuern lassen (ohne Tipp, wo der Browser es zulässt) ...
  if ((st.bestaetigen || st.laeuftBaldAb) && await stillErneuern()) st = await refreshCalendarStatus();
  // ... sonst geht es nur auf einen Tipp hin.
  if (st.bestaetigen) return { skipped: 'bestaetigen' };

  calState.running = true;
  calState.lastError = null;
  emit();
  try {
    if (store.dirty) await saveNow();
    let cfg = calendarSettings();
    let neuGeteilt = [];
    if (st.weitereErlaubt && (cfg.weitere.length || cfg.autoGeteilt)) ({ cfg, neu: neuGeteilt } = await geteilteNachfuehren(cfg));
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
      throw new Error(`Der Abgleich würde ${plan.removals.length + loeschenFern} Termine löschen, das sind ungewöhnlich viele. `
        + 'Er wurde deshalb angehalten. Bitte prüfen Sie den Kalender „Kontovia“ in Google; zum Neuanfang Google Kalender trennen und neu verbinden.');
    }

    /* Weitere Kalender – nur, wenn ausgewählt und auf diesem Gerät freigegeben. */
    const weitere = st.weitereErlaubt ? cfg.weitere : [];
    const ab = addDays(todayISO(), -WEITERE_TAGE_ZURUECK);
    const bis = addDays(todayISO(), LESEN_TAGE_VOR);
    const lesend = new Set(weitere.filter((k) => k.readOnly === true).map((k) => k.id));
    const fern = weitere.length
      ? await api.gcal.pullWeitere({ ids: weitere.map((k) => k.id), timeMin: `${ab}T00:00:00Z`, timeMax: `${bis}T00:00:00Z`, lesen: [...lesend] })
      : [];
    const plaene = [];
    const kalFehler = [];
    for (const p of fern) {
      const kalender = weitere.find((k) => k.id === p.calendarId) || { id: p.calendarId };
      if (p.error) { kalFehler.push(`${kalender.name || p.calendarId}: ${p.error}`); continue; }
      plaene.push({
        kalender,
        pull: p,
        plan: planWeitere({
          appointments: sel.appointments(), tombstones: store.db.tombstones || [], kalender,
          events: p.events, map: p.map || {}, ab, bis, timeZone: tz, sendNotes: cfg.sendNotes,
        }),
      });
    }
    // Nur lesbare Kalender bekommen nie einen Auftrag; die Planung erzeugt keinen, dies ist der zweite Riegel.
    const alleOps = [...plan.ops, ...plaene.flatMap((x) => x.plan.ops)].filter((o) => !(o.calendarId && lesend.has(o.calendarId)));
    const alleUpserts = [...plan.upserts, ...plaene.flatMap((x) => x.plan.upserts)];
    const alleRemovals = [...plan.removals, ...plaene.flatMap((x) => x.plan.removals)];
    const bekanntWeitere = plaene.reduce((n, x) => n + Object.keys(x.pull.map || {}).length, 0);
    const loeschenWeitere = plaene.reduce((n, x) => n + x.plan.removals.length + x.plan.ops.filter((o) => o.kind === 'delete').length, 0);
    if (loeschenWeitere > 5 && loeschenWeitere > bekanntWeitere / 2) {
      throw new Error(`Der Abgleich würde in Ihren weiteren Google-Kalendern ${loeschenWeitere} Termine löschen, das sind ungewöhnlich viele. `
        + 'Er wurde deshalb angehalten. Bitte prüfen Sie die Kalender; zum Neuanfang die Auswahl unter Einstellungen → Kalender-Abgleich ändern.');
    }

    const results = alleOps.length ? await api.gcal.push(alleOps) : [];

    const upserts = alleUpserts.map(({ _remoteUpdated, ...a }) => a);
    const bestehend = new Set(sel.appointments().map((a) => a.id));
    const neu = upserts.filter((a) => !bestehend.has(a.id)).length;
    const summary = [
      neuGeteilt.length === 1 && '1 geteilter Kalender dazugekommen',
      neuGeteilt.length > 1 && `${neuGeteilt.length} geteilte Kalender dazugekommen`,
      neu && `${neu} neu aus Google`,
      upserts.length - neu && `${upserts.length - neu} aus Google geändert`,
      alleRemovals.length && `${alleRemovals.length} in Google gelöscht`,
      results.filter((r) => r.ok).length && `${results.filter((r) => r.ok).length} nach Google übertragen`,
    ].filter(Boolean).join(', ') || 'alles auf dem gleichen Stand';

    if (upserts.length || alleRemovals.length) {
      await applyCalendarChanges({ upserts, removals: alleRemovals, summary: `Google Kalender: ${summary}` });
    }

    // Merkzettel: was jetzt auf beiden Seiten gilt – je Kalender ein eigener.
    const map = { ...plan.links };
    for (const u of plan.upserts) map[eventIdFor(u.id)] = { updated: u._remoteUpdated, localAt: u.updatedAt };
    const mapsWeitere = {};
    for (const x of plaene) {
      const m = { ...x.plan.links };
      for (const u of x.plan.upserts) m[u.extern.eventId] = { updated: u._remoteUpdated, localAt: u.updatedAt };
      mapsWeitere[x.kalender.id] = m;
    }
    // Kalender, die diesmal nicht erreichbar waren, behalten ihren Merkzettel.
    for (const p of fern) if (p.error) mapsWeitere[p.calendarId] = p.map || {};
    const fehler = [...kalFehler];
    results.forEach((r, i) => {
      const op = alleOps[i];
      const ziel = op.calendarId ? mapsWeitere[op.calendarId] : map;
      const vorher = op.calendarId ? fern.find((p) => p.calendarId === op.calendarId)?.map : pull.map;
      if (!r?.ok) {
        fehler.push(r?.error || 'unbekannter Fehler');
        // Den alten Stand behalten, damit der nächste Abgleich es erneut versucht.
        if (vorher?.[op.eventId]) ziel[op.eventId] = vorher[op.eventId];
        return;
      }
      if (op.kind === 'delete') return;
      ziel[op.eventId] = op.derived ? { updated: r.updated, hash: op.hash } : { updated: r.updated, localAt: op.localAt };
    });
    const fehlerText = fehler.length ? `${fehler.length} Termin(e) nicht übertragen: ${fehler[0]}` : null;
    await api.gcal.finish({ map, error: fehlerText, ...(st.weitereErlaubt ? { weitere: mapsWeitere } : {}) });

    calState.lastAt = new Date().toISOString();
    calState.lastSummary = summary;
    calState.lastError = fehlerText;
    return { summary, stats: { ops: alleOps.length, upserts: upserts.length, removals: alleRemovals.length, errors: fehler.length }, reason };
  } catch (e) {
    // Mitten im Abgleich abgelaufen: kein Fehler, er wartet auf die Bestätigung.
    if (e.code === 'BESTAETIGEN') return { skipped: 'bestaetigen' };
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
let abmelden = null;

/** Änderungen, nach denen sich ein Abgleich lohnt. */
const ANLASS = /^(termin\.(anlegen|aendern|loeschen)|buchung\.)/;

/** Ist Kontovia gerade zu sehen? Im Hintergrund wartet der Abgleich, bis man zurückkommt. */
function imVordergrund() {
  const d = globalThis.document;
  return !d || d.visibilityState !== 'hidden';
}

/** Wie lange der letzte erfolgreiche Abgleich zurückliegt, in Millisekunden (ohne Abgleich: sehr lange). */
export function seitAbgleich() {
  const t = Date.parse(calState.lastAt || calState.status?.lastSyncAt || '') || 0;
  return Date.now() - t;
}

export async function startCalendarSync() {
  stopCalendarSync();
  const st = await refreshCalendarStatus();
  // Der Abgleich mit Google Kalender gehört zu Pro; darunter ruht er (die Verbindung bleibt bestehen).
  if (!st?.linked || !kann('kalender')) return;
  let versuch = 0;
  const leise = () => {
    versuch = Date.now();
    return syncCalendar({ reason: 'automatisch' }).catch((e) => console.warn('Kalenderabgleich:', e.message));
  };
  timer = setInterval(() => { if (imVordergrund()) leise(); }, INTERVALL_MS);
  unsub = subscribe((ev) => {
    if (ev.type !== 'change' || !ANLASS.test(ev.action || '')) return;
    clearTimeout(pending);
    pending = setTimeout(leise, NACH_AENDERUNG_MS);
  });
  // Wer das Fenster wieder aufruft oder wieder Netz hat, soll gleich den neuen Stand sehen,
  // nicht erst nach dem nächsten Takt.
  // Ein Versuch, der nicht gelang, wird nicht bei jedem Fensterwechsel wiederholt.
  const zurueck = () => { if (imVordergrund() && seitAbgleich() > RUECKKEHR_MS && Date.now() - versuch > 30 * 1000) leise(); };
  const d = globalThis.document;
  const w = globalThis.window;
  const hatDoc = typeof d?.addEventListener === 'function';
  const hatWin = typeof w?.addEventListener === 'function';
  if (hatDoc) d.addEventListener('visibilitychange', zurueck);
  if (hatWin) { w.addEventListener('online', zurueck); w.addEventListener('focus', zurueck); }
  abmelden = () => {
    if (hatDoc) d.removeEventListener('visibilitychange', zurueck);
    if (hatWin) { w.removeEventListener('online', zurueck); w.removeEventListener('focus', zurueck); }
  };
  leise();
}

export function stopCalendarSync() {
  clearInterval(timer);
  clearTimeout(pending);
  unsub?.();
  abmelden?.();
  timer = null;
  pending = null;
  unsub = null;
  abmelden = null;
}
