/**
 * Kontovia – Ablage der Web-Fassung.
 *
 * Drei Bereiche, wie der Datenordner der früheren Windows-Fassung:
 *   dateien     – kontovia.tresor, sync-basis.bin
 *   belege      – jeder Beleg einzeln verschlüsselt, Schlüssel = Kennung
 *   sicherungen – ältere Stände der Tresordatei
 *
 * Wohin geschrieben wird, entscheidet der Unterbau:
 *
 *   Browser  IndexedDB (Voreinstellung, jeder Browser). Eine Transaktion wird
 *            ganz oder gar nicht geschrieben; das übernimmt die Rolle von
 *            „temporäre Datei, fsync, umbenennen“. Der Browser darf solche
 *            Daten bei Platzmangel räumen.
 *   Ordner   ein Ordner auf dem Gerät (File System Access API, Chrome und
 *            Edge). Dasselbe Layout wie unter Windows: kontovia.tresor,
 *            sync-basis.bin, belege/<Kennung>.beleg, sicherungen/<Name>.
 *            Geschrieben wird über createWritable(): Chromium schreibt in eine
 *            Zwischendatei und tauscht sie beim close() aus.
 *
 * Ist ein Ordner gewählt, ist er die einzige Quelle; es gibt keinen Spiegel im
 * Browser, damit es keine zwei Wahrheiten gibt. Was zu diesem Gerät gehört und
 * nicht zur Buchhaltung (Gerätekennung, Wahl des Speicherorts), bleibt immer
 * im Browser. Gespeichert wird ausschließlich, was ohnehin verschlüsselt ist;
 * nur die Gerätekennung liegt, wie unter Windows, im Klartext.
 */

const DB_NAME = 'kontovia';
const DB_VERSION = 1;
export const STORES = ['dateien', 'belege', 'sicherungen'];

/** Einträge, die immer im Browser bleiben: Sie gehören zu diesem Gerät, nicht zur Buchhaltung. */
const NUR_IM_BROWSER = new Set(['geraet', 'speicherort', 'uebergabe', 'biometrie', 'entsperrung-google']);
/** Was aus dem Bereich „dateien“ in den Ordner gehört. */
const DATEIEN_IM_ORDNER = new Set(['kontovia.tresor', 'sync-basis.bin']);
const BELEG_ID = /^[a-f0-9]{32}$/;
/** Sicherungen: kontovia-<Zeit>.tresor, vor-…-<Zeit>.tresor; nie mit Pfadteilen. */
const SICHERUNG = /^[\w.-]{1,120}\.tresor$/;

/* -------------------------------------------------------------------------- */
/* Unterbau: IndexedDB                                                         */
/* -------------------------------------------------------------------------- */

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

/** Größe eines Eintrags: Uint8Array oder {bytes}. */
const groesse = (v) => v?.byteLength ?? v?.bytes?.byteLength ?? 0;

const indexedDb = {
  art: 'browser',
  lesen: (store, key) => vorgang(store, 'readonly', (os) => os.get(key)),
  schreiben: (store, key, value) => vorgang(store, 'readwrite', (os) => { os.put(value, key); }),
  /** Mehrere Einträge in einer einzigen Transaktion – alles oder nichts. */
  schreibenMehrere: (store, eintraege) => vorgang(store, 'readwrite', (os) => { for (const [k, v] of eintraege) os.put(v, k); }),
  loeschen: (store, key) => vorgang(store, 'readwrite', (os) => { os.delete(key); }),
  schluessel: (store) => vorgang(store, 'readonly', (os) => os.getAllKeys()),
  umfang: (store) => vorgang(store, 'readonly', (os) => new Promise((resolve, reject) => {
    let bytes = 0;
    let count = 0;
    const req = os.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve({ bytes, count }); return; }
      bytes += groesse(c.value);
      count++;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  })),
};

/* -------------------------------------------------------------------------- */
/* Unterbau: Ordner auf dem Gerät                                              */
/* -------------------------------------------------------------------------- */

/** Fehler des Dateisystems in Meldungen, mit denen man etwas anfangen kann. */
function ordnerFehler(err, name) {
  if (err?.code) return err;
  let e;
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    e = new Error(`Kontovia darf gerade nicht auf den Ordner „${name}“ zugreifen. Erlauben Sie den Zugriff, wenn der Browser danach fragt.`);
    e.code = 'ORDNER_ZUGRIFF';
  } else if (err?.name === 'NotFoundError') {
    e = new Error(`Der Ordner „${name}“ ist nicht mehr da. Wurde er verschoben, umbenannt oder gelöscht?`);
    e.code = 'ORDNER_FEHLT';
  } else if (err?.name === 'QuotaExceededError') {
    e = new Error('Auf dem Datenträger ist nicht genug Platz frei.');
    e.code = 'KEIN_PLATZ';
  } else if (err?.name === 'NoModificationAllowedError' || err?.name === 'InvalidStateError') {
    e = new Error(`Eine Datei im Ordner „${name}“ ist gerade von einem anderen Programm belegt. Bitte gleich noch einmal versuchen.`);
    e.code = 'ORDNER_BELEGT';
  } else {
    e = new Error(err?.message || 'Der Ordner ließ sich nicht lesen oder schreiben.');
  }
  return e;
}

const nichtDa = (err) => err?.name === 'NotFoundError' || err?.name === 'TypeMismatchError';

/**
 * Ein Ordner als Unterbau.
 * @param {FileSystemDirectoryHandle} root  der Ordner mit kontovia.tresor
 */
export function ordnerUnterbau(root) {
  const name = root.name || 'Ordner';

  /** Wo ein Eintrag im Ordner liegt; Unterordner nur beim Schreiben anlegen. */
  async function ort(store, key, anlegen) {
    if (store === 'dateien') {
      if (!DATEIEN_IM_ORDNER.has(String(key))) throw new Error(`„${key}“ gehört nicht in den Ordner.`);
      return { dir: root, datei: String(key) };
    }
    if (store === 'belege') {
      if (!BELEG_ID.test(String(key))) throw new Error('Ungültige Beleg-Kennung.');
      return { dir: await root.getDirectoryHandle('belege', { create: anlegen }), datei: `${key}.beleg` };
    }
    if (store === 'sicherungen') {
      if (!SICHERUNG.test(String(key))) throw new Error('Ungültiger Name einer Sicherung.');
      return { dir: await root.getDirectoryHandle('sicherungen', { create: anlegen }), datei: String(key) };
    }
    throw new Error(`Unbekannter Bereich: ${store}`);
  }

  async function unterordner(store) {
    try {
      return await root.getDirectoryHandle(store);
    } catch (err) {
      if (nichtDa(err)) return null;
      throw ordnerFehler(err, name);
    }
  }

  /** Die Dateien eines Unterordners: [{key, file}] ohne Zwischendateien. */
  async function dateienIn(store) {
    const dir = await unterordner(store);
    const out = [];
    if (!dir) return out;
    try {
      for await (const [n, h] of dir.entries()) {
        if (h.kind !== 'file') continue;
        if (store === 'belege') {
          const m = /^([a-f0-9]{32})\.beleg$/.exec(n);
          if (m) out.push({ key: m[1], handle: h });
        } else if (SICHERUNG.test(n)) {
          out.push({ key: n, handle: h });
        }
      }
    } catch (err) {
      throw ordnerFehler(err, name);
    }
    return out;
  }

  async function schreibeDatei(dir, datei, bytes) {
    const fh = await dir.getFileHandle(datei, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(bytes);
      await w.close();
    } catch (err) {
      await w.abort?.().catch(() => {});
      throw err;
    }
  }

  return {
    art: 'ordner',
    root,
    name,
    async lesen(store, key) {
      try {
        const o = await ort(store, key, false);
        const f = await (await o.dir.getFileHandle(o.datei)).getFile();
        const bytes = new Uint8Array(await f.arrayBuffer());
        return store === 'sicherungen' ? { bytes, mtime: f.lastModified } : bytes;
      } catch (err) {
        if (nichtDa(err)) return undefined;
        throw ordnerFehler(err, name);
      }
    },
    async schreiben(store, key, value) {
      try {
        const o = await ort(store, key, true);
        await schreibeDatei(o.dir, o.datei, store === 'sicherungen' ? value.bytes : value);
      } catch (err) {
        throw ordnerFehler(err, name);
      }
    },
    /** Nacheinander; ein Abbruch hinterlässt höchstens Belege ohne Verweis, die das Aufräumen findet. */
    async schreibenMehrere(store, eintraege) {
      for (const [k, v] of eintraege) await this.schreiben(store, k, v);
    },
    async loeschen(store, key) {
      try {
        const o = await ort(store, key, false);
        await o.dir.removeEntry(o.datei);
      } catch (err) {
        if (nichtDa(err)) return;
        throw ordnerFehler(err, name);
      }
    },
    async schluessel(store) {
      if (store === 'dateien') {
        const da = [];
        for (const k of DATEIEN_IM_ORDNER) if (await this.lesen('dateien', k) !== undefined) da.push(k);
        return da;
      }
      return (await dateienIn(store)).map((d) => d.key);
    },
    async umfang(store) {
      let bytes = 0;
      let count = 0;
      for (const d of await dateienIn(store)) {
        try {
          bytes += (await d.handle.getFile()).size;
          count++;
        } catch { /* eben gelöscht */ }
      }
      return { bytes, count };
    },
    /** Erlaubt der Browser den Zugriff? 'granted' | 'prompt' | 'denied' */
    async zugriff() {
      try {
        return await root.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
      } catch {
        return 'prompt';
      }
    },
    /** Fragt nach dem Zugriff; braucht einen Klick (Nutzergeste) unmittelbar davor. */
    async zugriffErbitten() {
      try {
        return await root.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
      } catch {
        return 'denied';
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Auswahl des Unterbaus                                                       */
/* -------------------------------------------------------------------------- */

let browser = indexedDb;
let ordner = null;
/** Läuft ein Umzug, warten Schreibzugriffe, bis er fertig ist (dann gilt der neue Ort). */
let umzug = null;
/** Schreibzugriffe, die gerade laufen; ein Umzug beginnt erst, wenn keiner mehr läuft. */
let laufend = 0;
let ruhig = [];

const unterbau = (store, key) => (ordner && !(store === 'dateien' && NUR_IM_BROWSER.has(String(key))) ? ordner : browser);
const warten = async () => { while (umzug) await umzug.catch(() => {}); };

async function schreibend(fn) {
  await warten();
  laufend++;
  try {
    return await fn();
  } finally {
    if (--laufend === 0) { for (const r of ruhig) r(); ruhig = []; }
  }
}
const stille = () => (laufend ? new Promise((r) => ruhig.push(r)) : Promise.resolve());

export function lesen(store, key) {
  return unterbau(store, key).lesen(store, key);
}

export function schreiben(store, key, value) {
  return schreibend(() => unterbau(store, key).schreiben(store, key, value));
}

/** Mehrere Einträge auf einmal; im Browser in einer einzigen Transaktion. */
export function schreibenMehrere(store, eintraege) {
  if (!eintraege.length) return Promise.resolve();
  return schreibend(() => unterbau(store, eintraege[0][0]).schreibenMehrere(store, eintraege));
}

export function loeschen(store, key) {
  return schreibend(() => unterbau(store, key).loeschen(store, key));
}

export function schluessel(store) {
  return unterbau(store, '').schluessel(store);
}

/** Anzahl und Gesamtgröße aller Einträge (Uint8Array oder {bytes}). */
export function umfang(store) {
  return unterbau(store, '').umfang(store);
}

/**
 * Für die Prüfungen ohne Browser: einen anderen Unterbau für den Bereich
 * „Browser“ einsetzen (etwa speicherImArbeitsspeicher()).
 */
export function browserUnterbauSetzen(u) {
  browser = u || indexedDb;
  ordner = null;
}

/** Ein Unterbau im Arbeitsspeicher, mit derselben Schnittstelle wie IndexedDB (für die Prüfungen). */
export function speicherImArbeitsspeicher() {
  const daten = new Map(STORES.map((s) => [s, new Map()]));
  // Einträge mit Ordner-Handles (Speicherort) lassen sich außerhalb des Browsers nicht klonen.
  const kopie = (v) => {
    if (v instanceof Uint8Array) return new Uint8Array(v);
    try { return structuredClone(v); } catch { return { ...v }; }
  };
  return {
    art: 'browser',
    daten,
    lesen: async (s, k) => (daten.get(s).has(k) ? kopie(daten.get(s).get(k)) : undefined),
    schreiben: async (s, k, v) => { daten.get(s).set(k, kopie(v)); },
    schreibenMehrere: async (s, e) => { for (const [k, v] of e) daten.get(s).set(k, kopie(v)); },
    loeschen: async (s, k) => { daten.get(s).delete(k); },
    schluessel: async (s) => [...daten.get(s).keys()],
    umfang: async (s) => {
      let bytes = 0;
      for (const v of daten.get(s).values()) bytes += groesse(v);
      return { bytes, count: daten.get(s).size };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Speicherort: Wahl, Zugriff, Umzug                                           */
/* -------------------------------------------------------------------------- */

const SPEICHERORT = 'speicherort';

/** Kann dieser Browser in einen Ordner speichern? (Chrome, Edge; nicht Safari, Firefox) */
export const ordnerMoeglich = () => typeof globalThis.showDirectoryPicker === 'function';

/** Beim Start: den gemerkten Ordner einsetzen. Ob der Zugriff erlaubt ist, sagt speicherort(). */
export async function speicherortLaden() {
  const s = await browser.lesen('dateien', SPEICHERORT).catch(() => undefined);
  ordner = s?.art === 'ordner' && s.handle ? ordnerUnterbau(s.handle) : null;
  return speicherort();
}

/**
 * Wo die Buchhaltung liegt und ob Kontovia gerade herankommt.
 * @returns {Promise<{art:'browser'|'ordner', name:string, zugriff:string|null, moeglich:boolean}>}
 */
export async function speicherort() {
  if (!ordner) return { art: 'browser', name: '', zugriff: null, moeglich: ordnerMoeglich() };
  return { art: 'ordner', name: ordner.name, zugriff: await ordner.zugriff(), moeglich: ordnerMoeglich() };
}

/** Bittet um Zugriff auf den gemerkten Ordner (aus einem Klick heraus aufrufen). */
export async function zugriffErbitten() {
  if (!ordner) return 'granted';
  return ordner.zugriffErbitten();
}

/**
 * Abmelden: entfernt alles aus dem Browser, was zu dieser Buchhaltung gehört.
 * Nur die Gerätekennung bleibt. Ein gewählter Ordner wird vergessen; die
 * Dateien darin bleiben unberührt.
 */
export function geraetLeeren() {
  return schreibend(async () => {
    ordner = null;
    for (const s of STORES) {
      for (const k of await browser.schluessel(s)) {
        if (s === 'dateien' && k === 'geraet') continue;
        await browser.loeschen(s, k);
      }
    }
  });
}

/** Den Ordner nicht mehr verwenden; die Dateien darin bleiben unberührt. */
export function ordnerVergessen() {
  return schreibend(async () => {
    ordner = null;
    await browser.loeschen('dateien', SPEICHERORT);
  });
}

/**
 * Was liegt in einem gewählten Ordner? Eine Buchhaltung direkt darin, eine im
 * Unterordner „daten“ (so wie unter Windows im Datenordner von Kontovia), oder
 * keine. Für einen neuen Ort wird in einem nicht leeren Ordner ein Unterordner
 * „Kontovia“ angelegt, damit nichts zwischen fremden Dateien landet.
 * @returns {Promise<{handle:FileSystemDirectoryHandle, name:string, tresor:boolean, pfad:string}>}
 */
export async function ordnerPruefen(gewaehlt, { anlegen = false } = {}) {
  const hat = async (dir, datei) => {
    try { await dir.getFileHandle(datei); return true; } catch { return false; }
  };
  const unter = async (dir, n, create = false) => {
    try { return await dir.getDirectoryHandle(n, { create }); } catch { return null; }
  };
  try {
    if (await hat(gewaehlt, 'kontovia.tresor')) return { handle: gewaehlt, name: gewaehlt.name, tresor: true, pfad: gewaehlt.name };
    const daten = await unter(gewaehlt, 'daten');
    if (daten && await hat(daten, 'kontovia.tresor')) return { handle: daten, name: daten.name, tresor: true, pfad: `${gewaehlt.name}/daten` };
    const kontovia = await unter(gewaehlt, 'Kontovia');
    if (kontovia && await hat(kontovia, 'kontovia.tresor')) return { handle: kontovia, name: kontovia.name, tresor: true, pfad: `${gewaehlt.name}/Kontovia` };
    let leer = true;
    for await (const _ of gewaehlt.keys()) { leer = false; break; }
    if (leer || !anlegen) return { handle: gewaehlt, name: gewaehlt.name, tresor: false, pfad: gewaehlt.name, leer };
    const neu = await gewaehlt.getDirectoryHandle('Kontovia', { create: true });
    return { handle: neu, name: neu.name, tresor: false, pfad: `${gewaehlt.name}/Kontovia`, leer: true };
  } catch (err) {
    throw ordnerFehler(err, gewaehlt?.name || 'Ordner');
  }
}

/** Einen Ordner mit vorhandener Buchhaltung als Speicherort einsetzen (bevor es im Browser eine gibt). */
export function ordnerVerwenden(handle) {
  return schreibend(async () => {
    const neu = ordnerUnterbau(handle);
    if (await neu.lesen('dateien', 'kontovia.tresor') === undefined) throw new Error(`Im Ordner „${neu.name}“ liegt keine Kontovia-Buchhaltung.`);
    await browser.schreiben('dateien', SPEICHERORT, { art: 'ordner', handle, name: neu.name, seit: new Date().toISOString() });
    ordner = neu;
  });
}

async function sha256(u8) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u8)), (b) => b.toString(16).padStart(2, '0')).join('');
}
const bytesVon = (v) => (v instanceof Uint8Array ? v : v?.bytes);

/**
 * Kopiert alles von einem Unterbau in einen anderen und liest jede Datei
 * zurück. `pruefen(store, key, bytes)` prüft zusätzlich, ob sich die Kopie
 * entschlüsseln lässt (wirft, wenn nicht).
 */
async function kopieren(von, nach, { pruefen, fortschritt }) {
  const liste = [];
  for (const k of DATEIEN_IM_ORDNER) {
    const v = await von.lesen('dateien', k);
    if (v !== undefined) liste.push(['dateien', k, v]);
  }
  for (const store of ['belege', 'sicherungen']) {
    for (const k of await von.schluessel(store)) {
      const v = await von.lesen(store, k);
      if (v !== undefined) liste.push([store, String(k), v]);
    }
  }
  if (!liste.some(([s, k]) => s === 'dateien' && k === 'kontovia.tresor')) throw new Error('Es gibt keine Tresordatei, die sich verschieben ließe.');
  // Die Tresordatei zuletzt: Bricht der Umzug ab, liegt am neuen Ort keine
  // halbe Buchhaltung, die beim nächsten Start für vollständig gehalten würde.
  liste.sort((a, b) => (a[1] === 'kontovia.tresor') - (b[1] === 'kontovia.tresor'));
  let n = 0;
  for (const [store, key, value] of liste) {
    await nach.schreiben(store, key, value);
    const zurueck = await nach.lesen(store, key);
    const a = bytesVon(value);
    const b = bytesVon(zurueck);
    if (!b || a.byteLength !== b.byteLength || await sha256(a) !== await sha256(b)) {
      throw new Error(`Die Kopie von ${store === 'dateien' ? key : `${store}/${key}`} stimmt nicht mit dem Original überein. Der Umzug wurde abgebrochen.`);
    }
    if (pruefen) await pruefen(store, key, b);
    fortschritt?.({ fertig: ++n, gesamt: liste.length });
  }
  return liste;
}

/**
 * Zieht die Buchhaltung aus dem Browser in einen Ordner um: alles kopieren,
 * zurücklesen, Prüfsumme und Entschlüsselbarkeit prüfen, erst dann umschalten
 * und den Speicher im Browser leeren. Schreibzugriffe der Anwendung warten so
 * lange und landen danach im Ordner.
 */
export function inOrdnerUmziehen(handle, { pruefen, fortschritt } = {}) {
  if (ordner) return Promise.reject(new Error('Die Buchhaltung liegt bereits in einem Ordner.'));
  const lauf = (async () => {
    await stille();
    const ziel = ordnerUnterbau(handle);
    if (await ziel.lesen('dateien', 'kontovia.tresor') !== undefined) {
      throw new Error(`Im Ordner „${ziel.name}“ liegt schon eine Kontovia-Buchhaltung. Wählen Sie einen anderen Ordner.`);
    }
    const liste = await kopieren(browser, ziel, { pruefen, fortschritt });
    await browser.schreiben('dateien', SPEICHERORT, { art: 'ordner', handle, name: ziel.name, seit: new Date().toISOString() });
    ordner = ziel;
    for (const [store, key] of liste) await browser.loeschen(store, key).catch(() => {});
    return { name: ziel.name, dateien: liste.length };
  })();
  // Fehlschläge meldet `lauf` dem Aufrufer; hier zählt nur, dass der Umzug vorbei ist.
  umzug = lauf.then(() => {}, () => {}).then(() => { umzug = null; });
  return lauf;
}

/**
 * Der Rückweg: aus dem Ordner zurück in den Browser. Die Dateien im Ordner
 * bleiben liegen; wer sie nicht mehr braucht, löscht sie selbst.
 */
export function inBrowserUmziehen({ pruefen, fortschritt } = {}) {
  if (!ordner) return Promise.reject(new Error('Die Buchhaltung liegt bereits im Browser.'));
  const lauf = (async () => {
    await stille();
    const quelle = ordner;
    if (await browser.lesen('dateien', 'kontovia.tresor') !== undefined) {
      throw new Error('Im Speicher des Browsers liegt noch eine andere Buchhaltung. Der Umzug wurde abgebrochen.');
    }
    const liste = await kopieren(quelle, browser, { pruefen, fortschritt });
    await browser.loeschen('dateien', SPEICHERORT);
    ordner = null;
    return { name: quelle.name, dateien: liste.length };
  })();
  // Fehlschläge meldet `lauf` dem Aufrufer; hier zählt nur, dass der Umzug vorbei ist.
  umzug = lauf.then(() => {}, () => {}).then(() => { umzug = null; });
  return lauf;
}

/* -------------------------------------------------------------------------- */
/* Speicher des Browsers                                                       */
/* -------------------------------------------------------------------------- */

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
