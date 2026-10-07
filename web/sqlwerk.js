/**
 * Kontovia – Rechenwerk der Datenbank (eigener Worker).
 *
 * Hier läuft SQLite (vendor/sqlite3.wasm, SQLite3 Multiple Ciphers), abseits
 * der Oberfläche. Die Seite selbst darf kein WebAssembly ausführen (CSP ohne
 * 'wasm-unsafe-eval'); ein Worker hat seine eigene Umgebung.
 *
 * Speicher: das private Dateisystem des Browsers (OPFS) über den Weg
 * „opfs-sahpool“, je Konto ein eigener Ordner, darüber die Verschlüsselung von
 * SQLite3 Multiple Ciphers. Ohne OPFS (privater Modus, ältere Browser) hält
 * das Rechenwerk die Datenbank nur im Arbeitsspeicher; gesichert wird dann ein
 * verschlüsseltes Abbild (tresor.js).
 *
 * Netz: keines. fetch ist gesperrt bis auf die eigene .wasm-Datei, deren
 * Prüfsumme vor dem Start verglichen wird. Beim Sperren beendet die Web-Schicht
 * den Worker; Schlüssel und Daten im Arbeitsspeicher sind dann weg.
 *
 * Nachrichten (von sql.js): {id, op, args}; Antwort {id, ok, wert} oder
 * {id, fehler, code}. Die Aufträge sind die von sqlkern.js plus
 *   start({konto, ordner})   SQLite laden, OPFS-Pool des Kontos einhängen
 *   dateien()                Dateien im Pool
 *   dateiLoeschen(name)      eine Datei (samt WAL) aus dem Pool
 *   allesLoeschen()          den Pool des Kontos leeren und entfernen
 */

import init from './vendor/sqlite3.mjs';
import { werkzeug } from './sqlkern.js';

/** SHA-256 von vendor/sqlite3.wasm (vendor/HERKUNFT.md). */
const WASM_SHA256 = 'b6aedab9eee5cd5de0f13498e0bf64bb5ee9cc786d1d0303cc365578b64d18ab';
const WASM_URL = new URL('./vendor/sqlite3.wasm', import.meta.url).href;

const echtesFetch = self.fetch.bind(self);
self.fetch = async (eingabe, initOpts = {}) => {
  const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe?.url;
  if (url !== WASM_URL) throw new Error(`Das Rechenwerk der Datenbank hat kein Netz: ${url}`);
  return echtesFetch(eingabe, { ...initOpts, credentials: 'same-origin' });
};

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

let sqlite3 = null;
let pool = null;
let poolName = '';
let w = null;

async function laden() {
  if (sqlite3) return sqlite3;
  const res = await self.fetch(WASM_URL);
  if (!res.ok) throw new Error(`Die Datenbank ließ sich nicht laden (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== WASM_SHA256) {
    throw Object.assign(new Error('Die Datei der Datenbank ist beschädigt. Bitte die Seite neu laden.'), { code: 'SQL_PRUEFSUMME' });
  }
  globalThis.sqlite3ApiConfig = { warn: () => {}, log: () => {} };
  sqlite3 = await init({
    print: () => {},
    printErr: () => {},
    instantiateWasm(imports, fertig) {
      WebAssembly.instantiate(bytes, imports).then((r) => fertig(r.instance, r.module));
      return {};
    },
  });
  return sqlite3;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Den Pool des Kontos einhängen. Direkt nach dem Neuladen hält das alte
 * Rechenwerk die Dateien womöglich noch einen Augenblick: dann kurz warten.
 */
async function poolEinhaengen(konto, ordner) {
  const name = `kv-${konto}`;
  let letzter = null;
  for (let versuch = 0; versuch < 30; versuch++) {
    try {
      const p = await sqlite3.installOpfsSAHPoolVfs({ name, directory: ordner, initialCapacity: 8, forceReinitIfPreviouslyFailed: true });
      await p.reserveMinimumCapacity(8);
      const rc = sqlite3.capi.sqlite3mc_vfs_create(name, 0);
      if (rc) throw new Error(`Die Verschlüsselung der Datenbank ließ sich nicht einrichten (${rc}).`);
      return { pool: p, vfs: `multipleciphers-${name}` };
    } catch (err) {
      letzter = err;
      await pause(Math.min(100 * (versuch + 1), 500));
    }
  }
  throw letzter || new Error('Der Speicher für die Datenbank ist nicht verfügbar.');
}

function opfsMoeglich() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
    && !!globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle;
}

const auftraege = {
  /** @returns {{ablage:'opfs'|'speicher', grund?:string}} */
  async start({ konto, ordner, opfs = true }) {
    if (!/^[\w-]{1,60}$/.test(String(konto)) || !/^\.[\w-]{1,80}$/.test(String(ordner))) throw new Error('Ungültige Angaben zum Konto.');
    await laden();
    let grund = '';
    let dateien = null;
    if (opfs && opfsMoeglich()) {
      try {
        const e = await poolEinhaengen(konto, ordner);
        pool = e.pool;
        poolName = `kv-${konto}`;
        dateien = { vfs: e.vfs, pfad: (n) => `/${n}` };
      } catch (err) {
        grund = String(err?.message || err);
      }
    } else {
      grund = opfs ? 'kein OPFS' : 'abgeschaltet';
    }
    w = werkzeug(sqlite3, dateien);
    return { ablage: dateien ? 'opfs' : 'speicher', grund };
  },
  dateien() {
    return pool ? pool.getFileNames().map((n) => String(n).replace(/^\//, '')) : [];
  },
  dateiLoeschen(name) {
    if (!pool) return false;
    let weg = false;
    for (const n of [`/${name}`, `/${name}-wal`, `/${name}-journal`]) weg = pool.unlink(n) || weg;
    return weg;
  },
  async allesLoeschen() {
    w?.schliessen();
    if (pool) {
      // Erst die Verschlüsselungsschicht, dann den Pool darunter (samt Ordner).
      sqlite3.capi.sqlite3mc_vfs_destroy(`multipleciphers-${poolName}`);
      await pool.removeVfs();
    }
    pool = null;
    return true;
  },
};

self.onmessage = async (e) => {
  const { id, op, args = [] } = e.data || {};
  try {
    let wert;
    if (Object.hasOwn(auftraege, op)) wert = await auftraege[op](...args);
    else if (w && typeof w[op] === 'function') wert = await w[op](...args);
    else throw new Error(`Unbekannter Auftrag an die Datenbank: ${op}`);
    const transfer = wert instanceof Uint8Array ? [wert.buffer] : [];
    self.postMessage({ id, ok: true, wert }, transfer);
  } catch (err) {
    self.postMessage({ id, fehler: String(err?.message || err), code: err?.code || '' });
  }
};
