/**
 * Kontovia – Einhängen des Dateispeichers der Datenbank (OPFS, Weg „opfs-sahpool“).
 *
 * Läuft im Rechenwerk (sqlwerk.js); unter Node prüft es scripts/pruefungen/umstellung.test.js
 * mit einer Nachbildung von OPFS samt Sperren gegen dieselbe SQLite aus vendor/.
 *
 * Warum es diese Datei gibt (Datenbankverlust, nachgestellt am 17.10.2026):
 * Scheitert in vendor/sqlite3.mjs das Einhängen des Pools, räumt die Bibliothek
 * selbst auf: installOpfsSAHPoolVfs → removeVfs() löscht den Ordner `.opaque` samt
 * Datenbank rekursiv. Direkt nach dem Neuladen hält das alte Rechenwerk die Griffe
 * auf die Dateien oft noch; das Einhängen scheitert dann an der Sperre. Gibt das alte
 * Rechenwerk die Sperre genau zwischen diesem Fehler und dem Löschen frei, gelingt
 * das Löschen, und der nächste Versuch legt einen leeren Pool an (acht Dateien mit
 * 4096 Byte, nur Köpfe; SQL_FEHLT). Im Browser 5 von 80 Versuchen.
 *
 * Zwei Riegel, vendor/ bleibt unverändert:
 *  1. griffeFrei(): Erst wenn sich jede Datei des Pools einzeln öffnen und wieder
 *     schließen lässt, darf die Bibliothek einhängen. Sonst warten und neu sehen.
 *  2. loeschSperre(): Im Rechenwerk geht ein rekursives removeEntry nur innerhalb von
 *     mitLoeschen() (Abmelden, Konto entfernen). Das Aufräumen der Bibliothek nach
 *     einem Fehler läuft damit ins Leere, die Dateien bleiben.
 */

/** Unterordner, in dem opfs-sahpool die Dateien ablegt (vendor/sqlite3.mjs: OPAQUE_DIR_NAME). */
const OPAQUE = '.opaque';

let loeschenErlaubt = 0;
const gesperrt = new WeakSet();

/**
 * Sperrt rekursives Löschen von Ordnern über `proto.removeEntry` (FileSystemDirectoryHandle),
 * außer innerhalb von mitLoeschen(). Einzelne Dateien bleiben löschbar.
 */
export function loeschSperre(proto = globalThis.FileSystemDirectoryHandle?.prototype) {
  if (!proto || typeof proto.removeEntry !== 'function' || gesperrt.has(proto)) return;
  const echt = proto.removeEntry;
  Object.defineProperty(proto, 'removeEntry', {
    configurable: true,
    writable: true,
    value: function removeEntry(name, optionen) {
      if (optionen?.recursive && !loeschenErlaubt) {
        return Promise.reject(new DOMException(`Ordner „${name}“ wird hier nicht gelöscht.`, 'NoModificationAllowedError'));
      }
      return echt.call(this, name, optionen);
    },
  });
  gesperrt.add(proto);
}

/** Führt fn aus, während rekursives Löschen erlaubt ist (nur für bewusstes Entfernen des ganzen Pools). */
export async function mitLoeschen(fn) {
  loeschenErlaubt++;
  try {
    return await fn();
  } finally {
    loeschenErlaubt--;
  }
}

/**
 * Lassen sich alle Dateien des Pools jetzt öffnen? Öffnet jede einzeln und schließt
 * sie gleich wieder (nacheinander, damit kein Griff liegen bleibt). Ein fehlender
 * Ordner gilt als frei. @returns {Promise<{frei:boolean, grund?:string}>}
 */
export async function griffeFrei(wurzel, ordner) {
  let dir;
  try {
    dir = await (await wurzel.getDirectoryHandle(ordner)).getDirectoryHandle(OPAQUE);
  } catch (err) {
    if (err?.name === 'NotFoundError') return { frei: true };
    return { frei: false, grund: String(err?.message || err) };
  }
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file') continue;
    let griff;
    try {
      griff = await h.createSyncAccessHandle();
    } catch (err) {
      return { frei: false, grund: `${name}: ${err?.name || ''} ${err?.message || err}`.trim() };
    }
    griff.close();
  }
  return { frei: true };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Den Pool des Kontos einhängen. Direkt nach dem Neuladen hält das alte
 * Rechenwerk die Dateien womöglich noch einen Augenblick: dann kurz warten.
 * @returns {Promise<{pool:object, vfs:string}>}
 */
export async function poolEinhaengen(sqlite3, { konto, ordner, wurzel, versuche = 30, warten = pause }) {
  loeschSperre();
  const name = `kv-${konto}`;
  const root = wurzel || await navigator.storage.getDirectory();
  let letzter = null;
  for (let versuch = 0; versuch < versuche; versuch++) {
    try {
      const probe = await griffeFrei(root, ordner);
      if (!probe.frei) throw new Error(`Der Speicher der Datenbank ist noch belegt (${probe.grund}).`);
      const p = await sqlite3.installOpfsSAHPoolVfs({ name, directory: ordner, initialCapacity: 8, forceReinitIfPreviouslyFailed: true });
      await p.reserveMinimumCapacity(8);
      const rc = sqlite3.capi.sqlite3mc_vfs_create(name, 0);
      if (rc) throw new Error(`Die Verschlüsselung der Datenbank ließ sich nicht einrichten (${rc}).`);
      return { pool: p, vfs: `multipleciphers-${name}` };
    } catch (err) {
      letzter = err;
      await warten(Math.min(100 * (versuch + 1), 500));
    }
  }
  throw letzter || new Error('Der Speicher für die Datenbank ist nicht verfügbar.');
}
