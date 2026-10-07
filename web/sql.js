/**
 * Kontovia – Zugang der Web-Schicht zur Datenbank.
 *
 * Im Browser startet motorStarten() das Rechenwerk (sqlwerk.js, eigener
 * Worker) und reicht Aufträge hin und Ergebnisse zurück. Unter Node (die
 * Prüfungen) laufen dieselben Aufträge aus sqlkern.js im selben Prozess, mit
 * derselben SQLite; die Dateien des Kontos liegen dann im Arbeitsspeicher des
 * Moduls, so wie OPFS im Browser über ein Neuladen hinweg bleibt.
 *
 * Ein Motor gehört zu einem Konto und lebt, solange die Buchhaltung offen ist.
 * beenden() hält ihn an; im Browser endet damit der Worker samt Schlüssel.
 */

const AUFTRAEGE = ['oeffnenDatei', 'oeffnenSpeicher', 'schliessen', 'einlesen', 'auslesen', 'anwenden', 'abbild', 'abbildAusZeilen',
  'abbildLesen', 'abbildEinlesen', 'journalAlle', 'zaehlen', 'pruefen', 'meta', 'dateien', 'dateiLoeschen', 'allesLoeschen'];

const imBrowser = () => typeof Worker !== 'undefined' && typeof document !== 'undefined';

/**
 * @param {{konto:string, ordner:string, opfs?:boolean}} opts
 *   konto: Kennung (haupt oder die eines weiteren Kontos), ordner: Ordner im OPFS,
 *   opfs: false = nur Arbeitsspeicher (Buchhaltung in einem Ordner auf dem Gerät)
 * @returns {Promise<object>} der Motor: {ablage:'opfs'|'speicher', grund, …Aufträge, beenden()}
 */
export async function motorStarten({ konto, ordner, opfs = true }) {
  const m = imBrowser() ? await imWorker() : await imProzess();
  const start = await m.rufen('start', { konto, ordner, opfs });
  const motor = { ablage: start.ablage, grund: start.grund || '', beenden: m.beenden, get beendet() { return m.beendet(); } };
  for (const op of AUFTRAEGE) motor[op] = (...args) => m.rufen(op, ...args);
  return motor;
}

async function imWorker() {
  const w = new Worker(new URL('./sqlwerk.js', import.meta.url), { type: 'module' });
  const offen = new Map();
  let nr = 0;
  let aus = false;
  const allesAbbrechen = (grund) => {
    for (const [, p] of offen) p.reject(Object.assign(new Error(grund), { code: 'SQL_BEENDET' }));
    offen.clear();
  };
  w.onmessage = (e) => {
    const { id, ok, wert, fehler, code } = e.data || {};
    const p = offen.get(id);
    if (!p) return;
    offen.delete(id);
    if (ok) p.resolve(wert);
    else p.reject(Object.assign(new Error(fehler || 'Die Datenbank meldet einen Fehler.'), { code: code || '' }));
  };
  w.onerror = (e) => {
    e.preventDefault?.();
    allesAbbrechen(`Das Rechenwerk der Datenbank ist ausgefallen: ${e.message || 'unbekannter Fehler'}`);
  };
  return {
    rufen(op, ...args) {
      if (aus) return Promise.reject(Object.assign(new Error('Die Datenbank ist geschlossen.'), { code: 'SQL_BEENDET' }));
      const id = ++nr;
      return new Promise((resolve, reject) => {
        offen.set(id, { resolve, reject });
        w.postMessage({ id, op, args });
      });
    },
    beenden() {
      if (aus) return;
      aus = true;
      w.terminate();
      allesAbbrechen('Die Datenbank wurde geschlossen.');
    },
    beendet: () => aus,
  };
}

/* -------------------------------------------------------------------------- */
/* Unter Node: dieselben Aufträge im selben Prozess                            */
/* -------------------------------------------------------------------------- */

let nodeSqlite = null;
/** Dateien je Ordner, die im Arbeitsspeicher dieses Moduls liegen (Nachbildung von OPFS). */
const nodeOrdner = new Map();
/** Für die Prüfungen: OPFS fehlt (wie im privaten Modus). */
let nodeOhneOpfs = false;
export function nodeOpfsAbschalten(aus = true) { nodeOhneOpfs = aus; }

/** Löscht eine Datei im Arbeitsspeicher von SQLite (Nachbildung von OPFS unter Node). */
function nodeUnlink(sqlite3, p) {
  const f = sqlite3.wasm.xWrap('sqlite3__wasm_vfs_unlink', 'int', ['sqlite3_vfs*', 'string']);
  return f(sqlite3.capi.sqlite3_vfs_find('unix-none'), p);
}

async function nodeLaden() {
  if (nodeSqlite) return nodeSqlite;
  // sqlite3.mjs reicht beim Start einen Zustand über globalThis weiter; mehrere
  // Kopien dieses Moduls (ein Gerät je Kopie in den Prüfungen) starten deshalb nacheinander.
  const vorher = globalThis.__kontoviaSqlStart || Promise.resolve();
  let fertig;
  globalThis.__kontoviaSqlStart = new Promise((r) => { fertig = r; });
  await vorher.catch(() => {});
  try {
    return await nodeLadenJetzt();
  } finally {
    fertig();
  }
}

async function nodeLadenJetzt() {
  if (nodeSqlite) return nodeSqlite;
  const fs = await import('node:fs');
  const bytes = fs.readFileSync(new URL('./vendor/sqlite3.wasm', import.meta.url));
  globalThis.sqlite3ApiConfig = { warn: () => {}, log: () => {} };
  const init = (await import('./vendor/sqlite3.mjs')).default;
  nodeSqlite = await init({
    print: () => {},
    printErr: () => {},
    instantiateWasm(imports, fertig) {
      WebAssembly.instantiate(bytes, imports).then((r) => fertig(r.instance, r.module));
      return {};
    },
  });
  return nodeSqlite;
}

async function imProzess() {
  const sqlite3 = await nodeLaden();
  const { werkzeug } = await import('./sqlkern.js');
  let w = null;
  let ordner = '';
  let aus = false;
  const pfad = (n) => `/${ordner.replace(/^\./, '')}--${n}`;
  const unlink = (p) => nodeUnlink(sqlite3, p);
  const auftraege = {
    start({ konto, ordner: o, opfs = true }) {
      if (!/^[\w-]{1,60}$/.test(String(konto)) || !/^\.[\w-]{1,80}$/.test(String(o))) throw new Error('Ungültige Angaben zum Konto.');
      ordner = o;
      const mitDateien = opfs && !nodeOhneOpfs;
      if (mitDateien && !nodeOrdner.has(o)) nodeOrdner.set(o, new Set());
      w = werkzeug(sqlite3, mitDateien ? {
        vfs: 'multipleciphers-unix-none',
        pfad: (n) => { nodeOrdner.get(o).add(n); return pfad(n); },
      } : null);
      return { ablage: mitDateien ? 'opfs' : 'speicher', grund: mitDateien ? '' : 'kein OPFS' };
    },
    /** Wie getFileNames() im Browser: nur Dateien, die es wirklich gibt (Öffnen ohne Anlegen). */
    dateien() {
      return [...(nodeOrdner.get(ordner) || [])].filter((n) => {
        try {
          new sqlite3.oo1.DB({ filename: pfad(n), vfs: 'unix-none', flags: 'r' }).close();
          return true;
        } catch {
          return false;
        }
      });
    },
    dateiLoeschen(name) {
      const set = nodeOrdner.get(ordner);
      if (!set?.has(name)) return false;
      for (const n of [name, `${name}-wal`, `${name}-journal`]) unlink(pfad(n));
      set.delete(name);
      return true;
    },
    allesLoeschen() {
      w?.schliessen();
      for (const n of nodeOrdner.get(ordner) || []) auftraege.dateiLoeschen(n);
      nodeOrdner.delete(ordner);
      return true;
    },
  };
  return {
    async rufen(op, ...args) {
      if (aus) throw Object.assign(new Error('Die Datenbank ist geschlossen.'), { code: 'SQL_BEENDET' });
      // Wie über die Grenze eines Workers: Ergebnisse und Argumente sind Kopien.
      const kopie = (v) => (v === undefined ? v : structuredClone(v));
      if (Object.hasOwn(auftraege, op)) return kopie(await auftraege[op](...args.map(kopie)));
      if (w && typeof w[op] === 'function') return kopie(await w[op](...args.map(kopie)));
      throw new Error(`Unbekannter Auftrag an die Datenbank: ${op}`);
    },
    beenden() {
      if (aus) return;
      aus = true;
      try { w?.schliessen(); } catch { /* schon zu */ }
    },
    beendet: () => aus,
  };
}

/**
 * Entfernt den Ordner eines Kontos aus dem Dateispeicher des Browsers (Abmelden,
 * Konto entfernen). Der Motor dieses Kontos muss vorher beendet sein.
 */
export async function ordnerEntfernen(ordner) {
  if (!/^\.[\w-]{1,80}$/.test(String(ordner))) throw new Error('Ungültiger Ordner der Datenbank.');
  if (!imBrowser()) {
    if (nodeSqlite) {
      const unlink = (p) => nodeUnlink(nodeSqlite, p);
      for (const n of nodeOrdner.get(ordner) || []) {
        for (const x of [n, `${n}-wal`, `${n}-journal`]) unlink(`/${ordner.replace(/^\./, '')}--${x}`);
      }
    }
    nodeOrdner.delete(ordner);
    return true;
  }
  if (!navigator.storage?.getDirectory) return false;
  const root = await navigator.storage.getDirectory();
  // Gibt das Rechenwerk die Dateien eben erst frei, kurz warten und noch einmal.
  for (let versuch = 0; versuch < 20; versuch++) {
    try {
      await root.removeEntry(ordner, { recursive: true });
      return true;
    } catch (err) {
      if (err?.name === 'NotFoundError') return true;
      if (versuch === 19) throw err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}
