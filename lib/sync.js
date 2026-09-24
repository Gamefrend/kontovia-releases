/**
 * Kontovia – Ablauf des Cloud-Abgleichs.
 *
 * Der Abgleich läuft immer nach demselben Muster: Cloud-Stand holen, mit dem
 * lokalen Stand und der Basis zusammenführen, Ergebnis zurückschreiben.
 * Schreibt zwischendurch ein anderes Gerät, bricht der Hauptprozess ab und
 * wir beginnen von vorn – höchstens dreimal, dann meldet sich die Anwendung.
 */

import { store, setDb, saveNow, subscribe } from './store.js';
import { mergeDb, summarizeMerge } from './merge.js';

const api = window.kontovia;

export const syncState = {
  running: false,
  lastResult: null,
  lastError: null,
  lastAt: null,
  needsDecision: null,   // 'fremd', wenn Cloud und lokaler Tresor nicht zusammenpassen
  progress: null,
};

const watchers = new Set();
export function onSync(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function emit() { for (const fn of watchers) { try { fn(syncState); } catch { /* egal */ } } }

/**
 * Merkt sich, ob seit dem letzten erfolgreichen Abgleich hier etwas geändert
 * wurde. Ist hier nichts passiert und drüben auch nicht, wird der Tresor gar
 * nicht erst geladen. Das spart bei einer bezahlten Ablage bares Geld und
 * macht den regelmäßigen Abgleich praktisch kostenlos.
 */
let dirtySinceSync = true;
subscribe((ev) => { if (ev.type === 'change') dirtySinceSync = true; });

api.on.cloudProgress?.((p) => { syncState.progress = p; emit(); });

/**
 * Führt einen vollständigen Abgleich durch.
 * @param {{silent?:boolean, reason?:string}} opts
 */
export async function syncNow({ silent = false, reason = 'manuell' } = {}) {
  if (syncState.running) return { skipped: 'läuft-bereits' };
  const status = await api.cloud.status();
  if (!status.linked) return { skipped: 'nicht-verbunden' };

  syncState.running = true;
  syncState.lastError = null;
  syncState.needsDecision = null;
  emit();

  try {
    // Ungespeicherte Änderungen zuerst festschreiben, damit sie mitgehen.
    if (store.dirty) await saveNow();

    for (let versuch = 1; versuch <= 3; versuch++) {
      const begin = await api.cloud.begin({ dirty: dirtySinceSync, force: reason === 'manuell' && dirtySinceSync });

      if (begin.state === 'fremd') {
        syncState.needsDecision = { kind: 'fremd', ...begin };
        return { needsDecision: true, ...begin };
      }

      if (begin.state === 'aktuell') {
        // Weder hier noch drüben hat sich etwas getan.
        syncState.lastAt = new Date().toISOString();
        syncState.lastResult = { summary: 'schon auf dem gleichen Stand', stats: null, conflicts: 0 };
        syncState.lastError = null;
        return { ok: true, unchanged: true, summary: 'schon auf dem gleichen Stand' };
      }

      let merged = store.db;
      let conflicts = [];
      let stats = null;

      if (begin.state === 'bereit') {
        const res = mergeDb(begin.base, store.db, begin.remote);
        merged = res.merged;
        conflicts = res.conflicts;
        stats = res.stats;
        if (conflicts.length) {
          merged.syncConflicts = [
            ...(store.db.syncConflicts || []),
            ...conflicts.map((c) => ({ ...c, at: new Date().toISOString(), reason })),
          ].slice(-200);
        }
        setDb(merged);
      }

      // Stand der Buchhaltung vor dem Hochladen. Hochladen und Belegabgleich
      // dauern; wird in dieser Zeit weitergearbeitet, darf der Bestand danach
      // nicht als gesichert und abgeglichen gelten.
      const revVorher = store.revision;
      try {
        const res = await api.cloud.commit(merged);
        if (store.revision === revVorher) {
          store.dirty = false;
          dirtySinceSync = false;
        } else {
          dirtySinceSync = true;
          saveNow();
        }
        syncState.lastResult = { ...res, stats, conflicts: conflicts.length, summary: stats ? summarizeMerge(stats, conflicts) : 'hochgeladen' };
        syncState.lastAt = new Date().toISOString();
        syncState.lastError = null;
        return { ok: true, stats, conflicts, summary: syncState.lastResult.summary };
      } catch (err) {
        if (err.code === 'RETRY' && versuch < 3) continue; // anderes Gerät war schneller
        throw err;
      }
    }
    throw new Error('Der Abgleich ist mehrfach mit einem anderen Gerät zusammengetroffen. Bitte später erneut versuchen.');
  } catch (err) {
    syncState.lastError = err.message;
    if (!silent) throw err;
    return { error: err.message };
  } finally {
    syncState.running = false;
    syncState.progress = null;
    emit();
  }
}

/* -------------------------------------------------------------------------- */
/* Automatik                                                                   */
/* -------------------------------------------------------------------------- */

let pending = null;
let enabled = false;

/** Startet einen Abgleich, nachdem eine Weile nichts mehr geändert wurde. */
function scheduleAfterChange() {
  if (!enabled) return;
  clearTimeout(pending);
  pending = setTimeout(() => { syncNow({ silent: true, reason: 'nach-änderung' }); }, 25000);
}

/**
 * Die Anmeldungen dürfen nur einmal je Programmlauf entstehen. startAutoSync()
 * läuft nach jedem Entsperren – also auch nach jeder automatischen Sperre.
 * Ohne diese Sperre sammelte sich mit jedem Entsperren ein weiterer Satz
 * Zuhörer an, und ein einzelnes Speichern stieße am Ende mehrere Abgleiche an.
 */
let angemeldet = false;

export async function startAutoSync() {
  const status = await api.cloud.status().catch(() => ({}));
  enabled = !!status.linked && status.autoSync !== false;
  if (!enabled) return false;

  if (!angemeldet) {
    angemeldet = true;
    subscribe((ev) => { if (ev.type === 'change') scheduleAfterChange(); });
    api.on.cloudTick?.(() => syncNow({ silent: true, reason: 'zeitplan' }));

    // Vor dem Schließen noch schnell hochladen, was offen ist.
    window.addEventListener('beforeunload', () => {
      if (store.dirty) saveNow();
    });
  }

  // Beim Start einmal abgleichen, damit man auf dem Stand des anderen Geräts ist.
  setTimeout(() => syncNow({ silent: true, reason: 'programmstart' }), 3000);
  return true;
}

export function stopAutoSync() {
  enabled = false;
  clearTimeout(pending);
}
