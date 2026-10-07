/**
 * Kontovia – Arbeit an der Datenbank: öffnen, einlesen, auslesen, ändern, Abbilder.
 *
 * Läuft im Rechenwerk der Datenbank (sqlwerk.js, eigener Worker) und in den
 * Prüfungen unter Node, immer mit derselben SQLite (vendor/sqlite3.wasm,
 * SQLite3 Multiple Ciphers). Die Buchhaltung kennt diese Datei nicht; sie
 * bekommt und liefert die Zeilenform aus sqlschema.js.
 *
 * Zwei Arten, eine Datenbank zu halten:
 *   Datei     verschlüsselt im privaten Dateisystem des Browsers (OPFS). Jede
 *             Seite ist mit ChaCha20-Poly1305 verschlüsselt, Schlüssel aus dem
 *             Datenschlüssel des Tresors. Schreiben ist eine Transaktion im
 *             WAL-Verfahren (Abbruch mittendrin: der alte Stand gilt).
 *   Speicher  nur im Arbeitsspeicher; gesichert wird ein Abbild (Ordner auf
 *             dem Gerät, Browser ohne OPFS). Das Abbild verschlüsselt kern.js.
 *
 * Ein Abbild ist eine gewöhnliche SQLite-Datei ohne Verschlüsselung; es
 * verlässt das Rechenwerk nur zum Verschlüsseln (Cloud, Sicherungen).
 */

import { ddl, tabelleDdl, SCHEMA_FASSUNG, TABELLEN, JOURNAL, NAME_RE, journalSchluessel } from './sqlschema.js';

/**
 * Fest eingestellt, damit eine neue Fassung von SQLite3 Multiple Ciphers das
 * Dateiformat nicht still ändert. Nie ändern: bestehende Datenbanken gingen
 * sonst nicht mehr auf.
 */
export const VERSCHLUESSELUNG = Object.freeze({ cipher: 'chacha20', legacy: 0, kdf_iter: 64007 });
const SEITE = 8192;
const HEX64 = /^[0-9a-f]{64}$/;
const SQLITE_DESERIALIZE_FREEONCLOSE = 1;
const SQLITE_DESERIALIZE_RESIZEABLE = 2;

/**
 * @param {object} sqlite3   die geladene SQLite (sqlite3InitModule)
 * @param {{vfs:string, pfad:(name:string)=>string}|null} dateien
 *        wie Dateien geöffnet werden (Browser: OPFS-Pool, Node: Arbeitsspeicher
 *        des Moduls); null, wenn es keine dauerhaften Dateien gibt
 */
export function werkzeug(sqlite3, dateien) {
  const { oo1, capi, wasm } = sqlite3;
  /** @type {any} die offene Datenbank */
  let db = null;
  let art = null;

  function grundeinstellung(d) {
    d.exec('PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=OFF;');
  }

  function schemaAnlegen(d, { indizes = true } = {}) {
    d.transaction(() => {
      for (const s of ddl('main', { indizes })) d.exec(s);
      const fassung = d.selectValue("SELECT wert FROM meta WHERE schluessel='schema'");
      if (fassung == null) {
        d.exec({ sql: 'INSERT INTO meta(schluessel, wert) VALUES (?, ?), (?, ?)', bind: ['schema', String(SCHEMA_FASSUNG), 'erstellt', new Date().toISOString()] });
      }
    });
    d.exec(`PRAGMA user_version=${SCHEMA_FASSUNG}`);
  }

  function offen() {
    if (!db) throw Object.assign(new Error('Die Datenbank ist nicht geöffnet.'), { code: 'SQL_ZU' });
    return db;
  }

  /**
   * Öffnet die verschlüsselte Datei `name`; mit `anlegen` auch eine neue. Ein falscher
   * Schlüssel wirft BAD_KEY. Ohne `anlegen` wirft eine fehlende oder leere Datei
   * SQL_FEHLT: Eine leere Datenbank darf nie als Buchhaltung gelten (der Abgleich
   * trüge sonst Löschungen in die Cloud).
   */
  function oeffnenDatei({ name, schluessel, anlegen = false }) {
    if (!dateien) throw Object.assign(new Error('Dieser Browser bietet keinen Dateispeicher für die Datenbank.'), { code: 'SQL_KEIN_SPEICHER' });
    if (!/^[\w.-]{1,80}$/.test(String(name))) throw new Error('Ungültiger Name der Datenbank.');
    if (!HEX64.test(String(schluessel))) throw new Error('Ungültiger Schlüssel der Datenbank.');
    schliessen();
    let d;
    try {
      // Ohne „anlegen“ nur öffnen: Eine fehlende Datei entsteht so gar nicht erst.
      d = new oo1.DB({ filename: dateien.pfad(name), vfs: dateien.vfs, flags: anlegen ? 'c' : 'w' });
    } catch (err) {
      if (anlegen) throw err;
      throw Object.assign(new Error('Die Datenbank dieser Buchhaltung fehlt auf diesem Gerät, womöglich hat der Browser sie geräumt. Holen Sie den Stand aus der Cloud oder aus einer Vollsicherung zurück.'), { code: 'SQL_FEHLT', cause: err });
    }
    try {
      const v = VERSCHLUESSELUNG;
      d.exec(`PRAGMA cipher='${v.cipher}'; PRAGMA legacy=${v.legacy}; PRAGMA kdf_iter=${v.kdf_iter};`);
      d.exec(`PRAGMA hexkey='${schluessel}';`);
      // Vor dem ersten Lesen: ohne gemeinsamen Speicher geht WAL nur exklusiv.
      d.exec('PRAGMA locking_mode=EXCLUSIVE;');
      try {
        d.selectValue('SELECT count(*) FROM sqlite_master');
      } catch (err) {
        throw Object.assign(new Error('Der Schlüssel passt nicht zu dieser Datenbank.'), { code: 'BAD_KEY', cause: err });
      }
      const neu = !d.selectValue("SELECT count(*) FROM sqlite_master WHERE name='meta'");
      if (neu && !anlegen) {
        throw Object.assign(new Error('Die Datenbank dieser Buchhaltung fehlt auf diesem Gerät, womöglich hat der Browser sie geräumt. Holen Sie den Stand aus der Cloud oder aus einer Vollsicherung zurück.'), { code: 'SQL_FEHLT', leer: true });
      }
      if (neu) d.exec(`PRAGMA page_size=${SEITE};`);
      // Nie das Rückroll-Journal: Mit ihm ginge die Datei bei einem Abbruch
      // mitten im Schreiben kaputt (vendor/HERKUNFT.md).
      const modus = d.selectValue('PRAGMA journal_mode=WAL');
      if (String(modus).toLowerCase() !== 'wal') throw new Error(`Die Datenbank lässt sich nicht sicher schreiben (${modus}).`);
      // Die WAL-Datei nach jedem Übertrag wieder klein halten: sie wird beim Öffnen ganz gelesen.
      d.exec('PRAGMA synchronous=FULL; PRAGMA journal_size_limit=4194304;');
      grundeinstellung(d);
      schemaAnlegen(d);
      db = d;
      art = 'datei';
      return { neu, schema: Number(d.selectValue('PRAGMA user_version')) };
    } catch (err) {
      try { d.close(); } catch { /* war nie richtig offen */ }
      throw err;
    }
  }

  /** Eine leere Datenbank im Arbeitsspeicher. */
  function oeffnenSpeicher() {
    schliessen();
    const d = new oo1.DB(':memory:', 'c');
    grundeinstellung(d);
    schemaAnlegen(d);
    db = d;
    art = 'speicher';
    return { neu: true, schema: SCHEMA_FASSUNG };
  }

  function schliessen() {
    if (db) {
      // Alles aus der WAL-Datei in die Datenbank übertragen: Das nächste Öffnen geht dann schnell.
      if (art === 'datei') { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* beim nächsten Öffnen */ } }
      try { db.close(); } catch { /* schon zu */ }
    }
    db = null;
    art = null;
  }

  /** Tabellen, die eine Zeilenform braucht (auch unbekannte aus künftigen Fassungen). */
  function tabellenSicherstellen(d, namen) {
    for (const n of namen) {
      if (Object.hasOwn(TABELLEN, n)) continue;
      for (const s of tabelleDdl(n)) d.exec(s);
    }
  }

  function metaSetzen(d, k, v) {
    d.exec({ sql: 'INSERT INTO meta(schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert', bind: [k, v] });
  }

  function vorhandeneTabellen(d) {
    return d.selectValues("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('meta','werte') AND name NOT LIKE 'sqlite_%'");
  }

  /**
   * Ersetzt den ganzen Inhalt durch die Zeilenform `zf`, in einer Transaktion.
   * @param {object} herkunft  wird in meta.umstellung vermerkt (woher der Stand kam)
   */
  function einlesenIn(d, zf, herkunft = null) {
    const namen = Object.keys(zf.tabellen);
    for (const n of namen) if (!NAME_RE.test(n)) throw new Error(`Ungültiger Name einer Sammlung: ${n}`);
    d.transaction(() => {
      tabellenSicherstellen(d, namen);
      for (const t of vorhandeneTabellen(d)) d.exec(`DELETE FROM "${t}"`);
      d.exec('DELETE FROM werte');
      const w = d.prepare('INSERT INTO werte(schluessel, daten) VALUES (?, ?)');
      try { for (const [k, v] of Object.entries(zf.werte)) w.bind([k, v]).stepReset(); } finally { w.finalize(); }
      for (const n of namen) {
        const zeilen = zf.tabellen[n];
        const st = d.prepare(n === JOURNAL
          ? `INSERT INTO "${n}"(ord, daten, schluessel) VALUES (?, ?, ?)`
          : `INSERT INTO "${n}"(ord, daten) VALUES (?, ?)`);
        try {
          for (let i = 0; i < zeilen.length; i++) {
            st.bind(n === JOURNAL ? [i, zeilen[i], journalSchluessel(JSON.parse(zeilen[i]))] : [i, zeilen[i]]).stepReset();
          }
        } finally { st.finalize(); }
      }
      metaSetzen(d, 'reihenfolge', JSON.stringify(zf.reihenfolge));
      if (herkunft) metaSetzen(d, 'umstellung', JSON.stringify(herkunft));
    });
  }

  /**
   * Liest die Zeilenform. `fenster`: höchstens so viele Journaleinträge (die
   * neuesten nach Zeit), der Rest bleibt im Archiv; 0 = alle.
   */
  function auslesenAus(d, { fenster = 0 } = {}) {
    const roh = d.selectValue("SELECT wert FROM meta WHERE schluessel='reihenfolge'");
    const reihenfolge = roh ? JSON.parse(roh) : [];
    const werte = Object.create(null);
    for (const [k, v] of d.selectArrays('SELECT schluessel, daten FROM werte')) werte[k] = v;
    const tabellen = Object.create(null);
    const da = new Set(vorhandeneTabellen(d));
    let journalGesamt = 0;
    for (const [k, art_] of reihenfolge) {
      if (art_ !== 't') continue;
      if (!NAME_RE.test(k) || !da.has(k)) { tabellen[k] = []; continue; }
      if (k === JOURNAL) {
        journalGesamt = Number(d.selectValue(`SELECT count(*) FROM "${k}"`));
        if (fenster > 0 && journalGesamt > fenster) {
          tabellen[k] = d.selectValues(`SELECT daten FROM "${k}" WHERE ord IN (SELECT ord FROM "${k}" ORDER BY ts DESC, device DESC, seq DESC LIMIT ?) ORDER BY ord`, [fenster]);
          continue;
        }
      }
      tabellen[k] = d.selectValues(`SELECT daten FROM "${k}" ORDER BY ord`);
    }
    return { zf: { reihenfolge, werte, tabellen }, journalGesamt };
  }

  /** Fügt Journaleinträge an, die noch fehlen (Kennung wie beim Zusammenführen). Löscht nie. */
  function journalAnfuegen(d, texte) {
    if (!texte.length) return 0;
    let naechste = Number(d.selectValue(`SELECT coalesce(max(ord) + 1, 0) FROM "${JOURNAL}"`));
    const da = d.prepare(`SELECT 1 FROM "${JOURNAL}" WHERE schluessel = ? LIMIT 1`);
    const neu = d.prepare(`INSERT INTO "${JOURNAL}"(ord, daten, schluessel) VALUES (?, ?, ?)`);
    let n = 0;
    try {
      for (const t of texte) {
        const k = journalSchluessel(JSON.parse(t));
        const vorhanden = da.bind([k]).step();
        da.reset();
        if (vorhanden) continue;
        neu.bind([naechste++, t, k]).stepReset();
        n++;
      }
    } finally {
      da.finalize();
      neu.finalize();
    }
    return n;
  }

  /** Die Aufträge aus sqlschema.js: unterschiede(), in einer Transaktion. */
  function anwenden(ops) {
    const d = offen();
    let journal = 0;
    d.transaction(() => {
      if (ops.reihenfolge) {
        // Tabellen gibt es nur für Sammlungen, die diese Fassung kennt (sqlschema.js: zerlegen).
        if (ops.reihenfolge.some(([k, a]) => a === 't' && !Object.hasOwn(TABELLEN, k))) throw new Error('Unbekannte Sammlung im Auftrag.');
        metaSetzen(d, 'reihenfolge', JSON.stringify(ops.reihenfolge));
      }
      if (ops.werte.length) {
        const setzen = d.prepare('INSERT INTO werte(schluessel, daten) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET daten=excluded.daten');
        const weg = d.prepare('DELETE FROM werte WHERE schluessel = ?');
        try {
          for (const [k, v] of ops.werte) (v === null ? weg.bind([k]) : setzen.bind([k, v])).stepReset();
        } finally {
          setzen.finalize();
          weg.finalize();
        }
      }
      for (const [name, t] of Object.entries(ops.tabellen)) {
        if (!Object.hasOwn(TABELLEN, name) || name === JOURNAL) throw new Error(`Unbekannte Sammlung im Auftrag: ${name}`);
        if (t.setzen.length) {
          const st = d.prepare(`INSERT INTO "${name}"(ord, daten) VALUES (?, ?) ON CONFLICT(ord) DO UPDATE SET daten=excluded.daten`);
          try { for (const [i, z] of t.setzen) st.bind([i, z]).stepReset(); } finally { st.finalize(); }
        }
        d.exec({ sql: `DELETE FROM "${name}" WHERE ord >= ?`, bind: [t.laenge] });
      }
      journal = journalAnfuegen(d, ops.journal);
    });
    return { journal };
  }

  /** Öffnet ein Abbild (Bytes einer SQLite-Datei) als eigene Datenbank im Arbeitsspeicher. */
  function abbildOeffnen(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 512) throw new Error('Das Abbild der Datenbank ist leer oder beschädigt.');
    const kopf = new TextDecoder().decode(bytes.subarray(0, 15));
    if (kopf !== 'SQLite format 3') throw new Error('Das ist kein Abbild einer Kontovia-Datenbank.');
    const d = new oo1.DB(':memory:', 'c');
    try {
      const p = wasm.allocFromTypedArray(bytes);
      const rc = capi.sqlite3_deserialize(d.pointer, 'main', p, bytes.length, bytes.length,
        SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE);
      if (rc) throw new Error(`Das Abbild ließ sich nicht öffnen (${capi.sqlite3_js_rc_str(rc)}).`);
      // Ein Abbild aus einer WAL-Datei trägt den Vermerk WAL; im Arbeitsspeicher gilt das Rückroll-Journal.
      d.exec('PRAGMA journal_mode=MEMORY;');
      const ok = d.selectValue('PRAGMA quick_check');
      if (ok !== 'ok') throw new Error(`Das Abbild der Datenbank ist beschädigt (${ok}).`);
      if (!d.selectValue("SELECT count(*) FROM sqlite_master WHERE name='meta'")) throw new Error('Das ist kein Abbild einer Kontovia-Datenbank.');
      grundeinstellung(d);
      return d;
    } catch (err) {
      try { d.close(); } catch { /* egal */ }
      throw err;
    }
  }

  /** Abbild → Zeilenform. Optional: Journal des Abbilds in die offene Datenbank übernehmen (nur anfügen). */
  function abbildLesen(bytes, { fenster = 0, journalUebernehmen = false } = {}) {
    const d = abbildOeffnen(bytes);
    try {
      const schema = Number(d.selectValue("SELECT wert FROM meta WHERE schluessel='schema'") || 0);
      const r = auslesenAus(d, { fenster });
      let uebernommen = 0;
      if (journalUebernehmen && db) {
        const alle = d.selectValues(`SELECT daten FROM "${JOURNAL}" ORDER BY ord`);
        db.transaction(() => { uebernommen = journalAnfuegen(db, alle); });
      }
      return { ...r, schema, uebernommen };
    } finally {
      d.close();
    }
  }

  /**
   * Ein Abbild des offenen Bestands: eine frische Datenbank ohne Verschlüsselung
   * (angehängt im Arbeitsspeicher, KEY ''), als Bytes. `werte`: Einträge, die im
   * Abbild anders lauten (Text) oder fehlen sollen (null), etwa der Cloud-Block
   * ohne Anmeldemerkmale. Kopiert wird in SQLite selbst, ohne Umweg über Texte.
   */
  function abbild({ werte: ersatz = {} } = {}) {
    const d = offen();
    d.exec("ATTACH DATABASE ':memory:' AS abbild KEY ''");
    try {
      d.exec(`PRAGMA abbild.page_size=${SEITE};`);
      const tabellen = vorhandeneTabellen(d);
      for (const s of ddl('abbild', { indizes: false })) d.exec(s);
      for (const t of tabellen) if (!Object.hasOwn(TABELLEN, t) && NAME_RE.test(t)) for (const s of tabelleDdl(t, 'abbild', { indizes: false })) d.exec(s);
      d.transaction(() => {
        d.exec('INSERT INTO abbild.meta(schluessel, wert) SELECT schluessel, wert FROM main.meta');
        d.exec('INSERT INTO abbild.werte(schluessel, daten) SELECT schluessel, daten FROM main.werte');
        for (const t of tabellen) {
          if (!NAME_RE.test(t)) continue;
          const sp = t === JOURNAL ? 'ord, daten, schluessel' : 'ord, daten';
          d.exec(`INSERT INTO abbild."${t}"(${sp}) SELECT ${sp} FROM main."${t}"`);
        }
        for (const [k, v] of Object.entries(ersatz)) {
          if (v === null) {
            d.exec({ sql: 'DELETE FROM abbild.werte WHERE schluessel = ?', bind: [k] });
            const roh = d.selectValue("SELECT wert FROM abbild.meta WHERE schluessel='reihenfolge'");
            const reihenfolge = (roh ? JSON.parse(roh) : []).filter(([s]) => s !== k);
            d.exec({ sql: "UPDATE abbild.meta SET wert = ? WHERE schluessel='reihenfolge'", bind: [JSON.stringify(reihenfolge)] });
          } else {
            d.exec({ sql: 'UPDATE abbild.werte SET daten = ? WHERE schluessel = ?', bind: [v, k] });
          }
        }
      });
      d.exec(`PRAGMA abbild.user_version=${SCHEMA_FASSUNG}`);
      return capi.sqlite3_js_db_export(d, 'abbild');
    } finally {
      d.exec('DETACH DATABASE abbild');
    }
  }

  /** Eine Zeilenform als Abbild (etwa die Abgleichbasis). */
  function abbildAusZeilen(zf) {
    const ziel = new oo1.DB(':memory:', 'c');
    try {
      grundeinstellung(ziel);
      ziel.exec(`PRAGMA page_size=${SEITE};`);
      schemaAnlegen(ziel, { indizes: false });
      einlesenIn(ziel, zf);
      return capi.sqlite3_js_db_export(ziel);
    } finally {
      ziel.close();
    }
  }

  /** Alle Journaleinträge (auch das Archiv), nach Zeit geordnet: für Exporte und die Prüfung der Kette. */
  function journalAlle() {
    return offen().selectValues(`SELECT daten FROM "${JOURNAL}" ORDER BY ts, device, seq, ord`);
  }

  function zaehlen() {
    const d = offen();
    const out = { werte: Number(d.selectValue('SELECT count(*) FROM werte')) };
    for (const t of vorhandeneTabellen(d)) out[t] = Number(d.selectValue(`SELECT count(*) FROM "${t}"`));
    return out;
  }

  function pruefen() {
    const d = offen();
    return {
      ok: d.selectValue('PRAGMA quick_check') === 'ok',
      schema: Number(d.selectValue('PRAGMA user_version')),
      groesse: Number(d.selectValue('PRAGMA page_count')) * Number(d.selectValue('PRAGMA page_size')),
      art,
      anzahl: zaehlen(),
    };
  }

  return {
    get art() { return art; },
    oeffnenDatei,
    oeffnenSpeicher,
    schliessen,
    einlesen: (zf, herkunft) => { einlesenIn(offen(), zf, herkunft); return zaehlen(); },
    auslesen: (opts) => auslesenAus(offen(), opts),
    anwenden,
    abbild,
    abbildAusZeilen: (zf) => abbildAusZeilen(zf),
    abbildLesen,
    abbildEinlesen: (bytes, herkunft) => {
      const { zf } = abbildLesen(bytes, { fenster: 0 });
      einlesenIn(offen(), zf, herkunft);
      return zaehlen();
    },
    journalAlle,
    zaehlen,
    pruefen,
    meta: (k) => offen().selectValue('SELECT wert FROM meta WHERE schluessel = ?', [k]) ?? null,
  };
}
