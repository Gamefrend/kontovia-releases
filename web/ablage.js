/**
 * Kontovia – Ablage im Browser (IndexedDB).
 *
 * Entspricht dem Datenordner der Windows-Fassung:
 *   dateien     – kontovia.tresor, sync-basis.bin, geraet
 *   belege      – jeder Beleg einzeln verschlüsselt, Schlüssel = Kennung
 *   sicherungen – ältere Stände der Tresordatei
 *
 * Eine IndexedDB-Transaktion ist atomar: sie wird ganz oder gar nicht
 * geschrieben. Das übernimmt hier die Rolle von „temporäre Datei, fsync,
 * umbenennen“. Gespeichert wird ausschließlich, was ohnehin verschlüsselt ist;
 * nur die Gerätekennung liegt – wie in der Windows-Fassung – im Klartext.
 */

const DB_NAME = 'kontovia';
const DB_VERSION = 1;
export const STORES = ['dateien', 'belege', 'sicherungen'];

let dbPromise = null;

function oeffnen() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Ein anderes Fenster mit neuerer Fassung will umbauen: Platz machen.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(new Error('Der Speicher des Browsers ist nicht verfügbar. Im privaten Modus kann Kontovia nichts ablegen.'));
    };
    req.onblocked = () => reject(new Error('Kontovia ist noch in einem anderen Fenster mit einer älteren Fassung geöffnet.'));
  });
  return dbPromise;
}

function vorgang(store, mode, fn) {
  return oeffnen().then((db) => new Promise((resolve, reject) => {
    // „strict“: der Browser meldet erst Erfolg, wenn die Daten wirklich auf
    // dem Datenträger stehen – bei einer Buchhaltung die richtige Wahl.
    const tx = db.transaction(store, mode, { durability: 'strict' });
    const os = tx.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then((r) => { result = r; }, reject);
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error || new Error('Speichern im Browser fehlgeschlagen.'));
    tx.onabort = () => reject(tx.error || new Error('Der Speichervorgang wurde abgebrochen.'));
  }));
}

export function lesen(store, key) {
  return vorgang(store, 'readonly', (os) => os.get(key));
}

export function schreiben(store, key, value) {
  return vorgang(store, 'readwrite', (os) => { os.put(value, key); });
}

/** Mehrere Einträge in einer einzigen Transaktion – alles oder nichts. */
export function schreibenMehrere(store, eintraege) {
  return vorgang(store, 'readwrite', (os) => { for (const [k, v] of eintraege) os.put(v, k); });
}

export function loeschen(store, key) {
  return vorgang(store, 'readwrite', (os) => { os.delete(key); });
}

export function schluessel(store) {
  return vorgang(store, 'readonly', (os) => os.getAllKeys());
}

/** Anzahl und Gesamtgröße aller Einträge (Uint8Array oder {bytes}). */
export function umfang(store) {
  return vorgang(store, 'readonly', (os) => new Promise((resolve, reject) => {
    let bytes = 0;
    let count = 0;
    const req = os.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve({ bytes, count }); return; }
      const v = c.value;
      bytes += v?.byteLength ?? v?.bytes?.byteLength ?? 0;
      count++;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

/** Bittet den Browser, die Daten nicht bei Platzmangel zu räumen. */
export async function dauerhaftAnfordern() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return !!(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

export async function kontingent() {
  try {
    const e = await navigator.storage?.estimate?.();
    const persistent = !!(await navigator.storage?.persisted?.());
    return e ? { usage: e.usage || 0, quota: e.quota || 0, persistent } : null;
  } catch {
    return null;
  }
}
