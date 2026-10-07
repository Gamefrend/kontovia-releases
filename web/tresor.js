/**
 * Kontovia – Tresorverwaltung der Web-Fassung.
 *
 * Seit 2.26 liegt die Buchhaltung in einer SQLite-Datenbank (sqlschema.js,
 * sqlkern.js), die das Rechenwerk sqlwerk.js führt. Die Datei kontovia.tresor
 * bleibt der Einstieg: Sie trägt den mit dem Passwort umhüllten
 * Datenschlüssel (DEK) und je nach Format (kern.js)
 *   3  den Verweis auf die verschlüsselte Datenbank im Dateispeicher des
 *      Browsers (OPFS). Gespeichert werden nur geänderte Zeilen.
 *   2  ein Abbild der Datenbank. So liegt die Buchhaltung in einem Ordner auf
 *      dem Gerät und in Browsern ohne OPFS (dann wird jedes Mal das ganze
 *      Abbild geschrieben), und kurz, nachdem ein Stand aus der Cloud oder
 *      einer Sicherung übernommen wurde.
 *   1  den Bestand als JSON (bis 2.25).
 *
 * Umstellung: Liegt beim Entsperren Format 1 oder 2 vor, wird der Stand in
 * eine neue Datenbank eingelesen, Zeile für Zeile zurückgelesen und mit der
 * Quelle verglichen; erst danach ersetzt der Verweis (oder das Abbild) die
 * Datei, in einem Schritt. Ein Stand aus Format 1 bleibt vorher als Sicherung
 * „vor-umstellung-…“ liegen, die nie automatisch gelöscht wird. Bricht etwas
 * ab, liegt die alte Datei unverändert da, und beim nächsten Entsperren
 * beginnt es von vorn.
 *
 * Belege bleiben, wie sie sind: einzeln verschlüsselt mit HKDF(DEK).
 * Der Schlüssel der Datenbank ist HKDF(DEK, "kontovia/sqlite/v1"); Passwort,
 * Fingerabdruck, Google-Schlüssel, Übergabe und Kopplung bleiben gültig.
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import * as S from './sql.js';
import { zerlegen, zusammensetzen, unterschiede, leer, abweichung, JOURNAL, JOURNAL_FENSTER, SCHEMA_FASSUNG } from './sqlschema.js';
import { fuerSicherung, cloudNachEinspielen, journalNachEinspielen } from './zugang.js';

export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024; // 40 MB pro Beleg
const BACKUP_KEEP = 25;
const BACKUP_MIN_INTERVAL_MS = 30 * 60 * 1000; // höchstens alle 30 Minuten
/** Sicherungen mit diesem Anfang zählen nicht zu den 25 und werden nie automatisch gelöscht. */
export const UMSTELLUNG_PRAEFIX = 'vor-umstellung-';

export const TRESOR = 'kontovia.tresor';
const ID_RE = /^[a-f0-9]{32}$/;

const attachAad = (id) => K.utf8(`kontovia/attachment/${id}`);
const zeitstempel = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Fehler, der beim Entsperren mit dem Datenschlüssel „passt nicht“ heißt. */
const passtNicht = (text = 'Der Schlüssel passt nicht zu dieser Buchhaltung.') => Object.assign(new Error(text), { code: 'BAD_KEY' });

export class Vault {
  constructor(appVersion = '') {
    this.appVersion = appVersion;
    this.dataDir = 'Speicher dieses Browsers';
    /** @type {Uint8Array|null} */
    this.dek = null;
    /** @type {Uint8Array|null} */
    this.attachKey = null;
    this.db = null;
    this.header = null;
    this.lastBackupAt = 0;
    this.saving = null;
    /** Wird mit dem Bestand gerufen, wenn er sich öffnet oder gespeichert wird (Name des Kontos, bridge.js). */
    this.beschrifter = null;
    /** Meldet die Schritte einer Umstellung (bridge.js zeigt „Ihre Daten werden … vorbereitet“). */
    this.melder = null;
    /** Das Rechenwerk der Datenbank (sql.js), solange offen. */
    this.motor = null;
    /** 'opfs' (Datei im Dateispeicher des Browsers) | 'speicher' (Abbild in kontovia.tresor) */
    this.modus = null;
    this.verweis = null;
    /** Der zuletzt geschriebene Stand als Zeilenform: Gegenstück für das Speichern nur geänderter Zeilen. */
    this.zeilen = null;
    /** Wie viele Journaleinträge in der Datenbank liegen (die Oberfläche sieht die neuesten JOURNAL_FENSTER). */
    this.journalGesamt = 0;
    /** Erfüllt sich, wenn das Rechenwerk nach dem Sperren beendet ist. */
    this.beendet = Promise.resolve();
  }

  async _beschriften(db, geoeffnet) {
    try { await this.beschrifter?.(db, geoeffnet); } catch (err) { console.error('Konto beschriften:', err?.message); }
  }

  _melden(schritt) {
    try { this.melder?.(schritt); } catch { /* nur Anzeige */ }
  }

  get isLocked() {
    return this.dek === null;
  }

  async exists() {
    return !!(await A.lesen('dateien', TRESOR));
  }

  async _motorHolen() {
    if (this.motor) return this.motor;
    await this.beendet;
    const ort = A.sqlOrt();
    this.motor = await S.motorStarten(ort);
    return this.motor;
  }

  /** Rechenwerk anhalten, sobald laufendes Speichern fertig ist; vorher die Datenbank sauber schließen. */
  _motorBeenden() {
    const m = this.motor;
    this.motor = null;
    const s = this.saving;
    this.beendet = Promise.resolve(s).catch(() => {})
      .then(() => m?.schliessen())
      .catch(() => {})
      .then(() => m?.beenden());
    return this.beendet;
  }

  async _adopt(dek, header, db) {
    this.dek = dek;
    this.attachKey = await K.subKey(dek, 'kontovia/attachments/v1');
    this.header = header;
    this.db = db;
    await this._beschriften(db, true);
  }

  static async sqlSchluessel(dek) {
    const k = await K.subKey(dek, 'kontovia/sqlite/v1');
    try { return K.toHex(k); } finally { K.wipe(k); }
  }

  /* ---------------------------------------------------------------------- */
  /* Anlegen, Entsperren, Umstellen                                          */
  /* ---------------------------------------------------------------------- */

  async create(password, initialDb) {
    if (await this.exists()) throw new Error('Am Speicherort liegt bereits eine Buchhaltung.');
    const { header, dek } = await K.neuerKopf(password, { app: 'Kontovia', appVersion: this.appVersion || '1.0.0' });
    try {
      const motor = await this._motorHolen();
      const zf = zerlegen(initialDb);
      let buffer;
      if (motor.ablage === 'opfs') {
        const verweis = { datei: neueDatei(), seit: new Date().toISOString(), schema: SCHEMA_FASSUNG };
        await motor.oeffnenDatei({ name: verweis.datei, schluessel: await Vault.sqlSchluessel(dek), anlegen: true });
        await motor.einlesen(zf, { von: 'neu', am: verweis.seit, app: this.appVersion });
        buffer = K.packContainer(header, await K.sealVerweis(dek, verweis, header), K.FORMAT_VERWEIS);
        this.verweis = verweis;
      } else {
        await motor.oeffnenSpeicher();
        await motor.einlesen(zf, { von: 'neu', am: new Date().toISOString(), app: this.appVersion });
        buffer = await this._abbildDatei(dek, header);
      }
      await A.schreiben('dateien', TRESOR, buffer);
      this.modus = motor.ablage;
      this.zeilen = zf;
      this.journalGesamt = zf.tabellen[JOURNAL]?.length || 0;
      await this._adopt(dek, header, initialDb);
      return true;
    } catch (err) {
      K.wipe(dek);
      this._motorBeenden();
      throw err;
    }
  }

  async unlock(password) {
    const buf = await A.lesen('dateien', TRESOR);
    if (!buf) throw new Error('Am Speicherort liegt keine Buchhaltung.');
    const c = K.unpackContainer(buf);
    const dek = await K.kopfOeffnen(password, c.header);
    return this._oeffnen(dek, c, buf);
  }

  /** Entsperren mit dem Schlüssel aus der Übergabe nach einer Aktualisierung (uebergabe.js). */
  async unlockWithKey(dek) {
    const buf = await A.lesen('dateien', TRESOR);
    if (!buf) throw new Error('Am Speicherort liegt keine Buchhaltung.');
    return this._oeffnen(dek, K.unpackContainer(buf), buf, { mitSchluessel: true });
  }

  /** Übernimmt einen Tresor aus der Cloud als ersten Tresor – geschrieben wird erst, wenn das Passwort passt. */
  async adoptContainer(bytes, password) {
    if (await this.exists()) throw new Error('Am Speicherort liegt bereits eine Buchhaltung.');
    const c = K.unpackContainer(bytes);
    const dek = await K.kopfOeffnen(String(password ?? ''), c.header);
    await K.inhaltOeffnen(dek, c);
    await A.schreiben('dateien', TRESOR, bytes);
    return this._oeffnen(dek, c, bytes);
  }

  /** Wie adoptContainer, aber mit dem Datenschlüssel statt des Passworts (Entsperren per Google-Konto). */
  async adoptContainerWithKey(bytes, dek) {
    if (await this.exists()) throw new Error('Am Speicherort liegt bereits eine Buchhaltung.');
    const c = K.unpackContainer(bytes);
    try { await K.inhaltOeffnen(dek, c); } catch { throw passtNicht(); }
    await A.schreiben('dateien', TRESOR, bytes);
    return this._oeffnen(dek, c, bytes, { mitSchluessel: true });
  }

  /**
   * Gemeinsamer Weg nach dem Entsperren: Datenbank öffnen oder den Stand aus
   * Format 1/2 einlesen (Umstellung). Gibt den Bestand für die Oberfläche zurück.
   */
  async _oeffnen(dek, c, buf, { mitSchluessel = false } = {}) {
    let inhalt;
    try {
      inhalt = await K.inhaltOeffnen(dek, c);
    } catch (err) {
      if (mitSchluessel) throw passtNicht('Der Schlüssel passt nicht zu diesem Tresor.');
      throw err;
    }
    try {
      const motor = await this._motorHolen();
      const schluessel = await Vault.sqlSchluessel(dek);
      let r;
      if (inhalt.verweis) {
        if (motor.ablage !== 'opfs') {
          throw Object.assign(new Error('Die Buchhaltung liegt im Datenspeicher dieses Browsers, und der ist gerade nicht erreichbar. Bitte die Seite neu laden. Hilft das nicht, holt „Aus der Cloud laden“ oder eine Sicherung den Stand zurück.'), { code: 'SQL_KEIN_SPEICHER' });
        }
        await motor.oeffnenDatei({ name: inhalt.verweis.datei, schluessel });
        r = await motor.auslesen({ fenster: JOURNAL_FENSTER });
        // Nie einen leeren Bestand übernehmen: Der Abgleich trüge sonst Löschungen in die Cloud.
        if (!r.zf.reihenfolge.length) throw Object.assign(new Error('Die Datenbank dieser Buchhaltung ist leer. Holen Sie den Stand aus der Cloud oder aus einer Vollsicherung zurück.'), { code: 'SQL_FEHLT' });
        this.modus = 'opfs';
        this.verweis = inhalt.verweis;
        await this._aufraeumen(inhalt.verweis.datei);
      } else {
        r = await this._umstellen(dek, c, inhalt, buf, motor, schluessel);
      }
      this.zeilen = r.zf;
      this.journalGesamt = r.journalGesamt;
      const db = zusammensetzen(r.zf);
      await this._adopt(dek, c.header, db);
      return db;
    } catch (err) {
      this._motorBeenden();
      this.modus = null;
      this.verweis = null;
      this.zeilen = null;
      throw err;
    }
  }

  /**
   * Liest einen Stand aus Format 1 (JSON) oder 2 (Abbild) ein und prüft ihn,
   * bevor kontovia.tresor ersetzt wird. Siehe Kopf dieser Datei.
   */
  async _umstellen(dek, c, inhalt, buf, motor, schluessel) {
    // Nur der Schritt aus der alten Fassung (Format 1) dauert spürbar: Die Oberfläche zeigt solange einen Hinweis.
    if (!inhalt.data) return this._umstellenJetzt(dek, c, inhalt, buf, motor, schluessel);
    this._melden({ schritt: 'umstellung', phase: 'start' });
    try {
      return await this._umstellenJetzt(dek, c, inhalt, buf, motor, schluessel);
    } finally {
      this._melden({ schritt: 'umstellung', phase: 'ende' });
    }
  }

  async _umstellenJetzt(dek, c, inhalt, buf, motor, schluessel) {
    const ausJson = !!inhalt.data;
    const quelle = ausJson ? zerlegen(inhalt.data) : null;
    const herkunft = { von: ausJson ? 'json' : 'abbild', am: new Date().toISOString(), app: this.appVersion };
    const einlesen = () => (ausJson ? motor.einlesen(quelle, herkunft) : motor.abbildEinlesen(inhalt.abbild, herkunft));
    const sollZeilen = async () => quelle || (await motor.abbildLesen(inhalt.abbild)).zf;

    if (motor.ablage === 'opfs') {
      const datei = neueDatei();
      await motor.oeffnenDatei({ name: datei, schluessel, anlegen: true });
      try {
        await einlesen();
        const abw = abweichung(await sollZeilen(), (await motor.auslesen({ fenster: 0 })).zf);
        const pr = await motor.pruefen();
        if (abw || !pr.ok) throw new Error(`Die Umstellung ist an einer Prüfung gescheitert (${abw || 'Datenbank'}). Ihre Daten sind unverändert; beim nächsten Öffnen versucht Kontovia es noch einmal.`);
      } catch (err) {
        await motor.schliessen().catch(() => {});
        await motor.dateiLoeschen(datei).catch(() => {});
        throw err;
      }
      if (ausJson) await this._umstellungSichern(buf);
      const verweis = { datei, seit: herkunft.am, schema: SCHEMA_FASSUNG };
      const neu = K.packContainer(c.header, await K.sealVerweis(dek, verweis, c.header), K.FORMAT_VERWEIS);
      await A.schreiben('dateien', TRESOR, neu);
      // Zurücklesen: Erst wenn der Verweis wirklich dasteht, gilt die neue Datenbank.
      const zurueck = K.unpackContainer(await A.lesen('dateien', TRESOR));
      if (zurueck.version !== K.FORMAT_VERWEIS || (await K.openVerweis(dek, zurueck.body, zurueck.headerBuf)).datei !== datei) {
        throw new Error('Der Verweis auf die Datenbank ließ sich nicht schreiben. Bitte noch einmal öffnen.');
      }
      this.modus = 'opfs';
      this.verweis = verweis;
      await this._aufraeumen(datei);
    } else {
      await motor.oeffnenSpeicher();
      await einlesen();
      if (ausJson) {
        const abw = abweichung(quelle, (await motor.auslesen({ fenster: 0 })).zf);
        if (abw) throw new Error(`Die Umstellung ist an einer Prüfung gescheitert (${abw}). Ihre Daten sind unverändert.`);
        const header = { ...c.header, savedAt: new Date().toISOString() };
        const datei = await this._abbildDatei(dek, header);
        // Das Abbild so prüfen, wie es auf dem Datenträger landet.
        const probe = K.unpackContainer(datei);
        const imAbbild = (await motor.abbildLesen(await K.openAbbild(dek, probe.body, probe.headerBuf))).zf;
        const abw2 = abweichung(quelle, imAbbild);
        if (abw2) throw new Error(`Die Umstellung ist an einer Prüfung gescheitert (Abbild: ${abw2}). Ihre Daten sind unverändert.`);
        await this._umstellungSichern(buf);
        await A.schreiben('dateien', TRESOR, datei);
        const zurueck = await A.lesen('dateien', TRESOR);
        if (!gleicheBytes(zurueck, datei)) throw new Error('Die umgestellte Datei ließ sich nicht schreiben. Bitte noch einmal öffnen.');
        // Der Kopf der neuen Datei (savedAt) gilt ab jetzt; _oeffnen übernimmt ihn aus c.
        c.header = header;
      }
      this.modus = 'speicher';
      this.verweis = null;
    }
    return motor.auslesen({ fenster: JOURNAL_FENSTER });
  }

  /** Den Stand aus der alten Fassung als Sicherung ablegen, zurücklesen, vergleichen. */
  async _umstellungSichern(buf) {
    const name = `${UMSTELLUNG_PRAEFIX}${zeitstempel()}.tresor`;
    await A.schreiben('sicherungen', name, { bytes: buf, mtime: Date.now() });
    const zurueck = await A.lesen('sicherungen', name);
    if (!gleicheBytes(zurueck?.bytes, buf)) throw new Error('Die Sicherung vor der Umstellung ließ sich nicht schreiben. Ihre Daten sind unverändert.');
  }

  /** Dateien im Dateispeicher, auf die nichts mehr verweist (frühere Umstellungen, Abbrüche). */
  async _aufraeumen(behalten) {
    try {
      for (const n of await this.motor.dateien()) {
        if (n === behalten || /-(wal|journal)$/.test(n)) continue;
        await this.motor.dateiLoeschen(n);
      }
    } catch (err) {
      console.error('Aufräumen der Datenbank:', err?.message);
    }
  }

  /** Format 2: ein Abbild der offenen Datenbank, verschlüsselt. */
  async _abbildDatei(dek, header, { werte } = {}) {
    const abbild = await this.motor.abbild({ werte });
    return K.packContainer(header, await K.sealAbbild(dek, abbild, header), K.FORMAT_ABBILD);
  }

  /** Der jetzige Stand als eigenständige Datei (Format 2), etwa für eine Sicherung. */
  async standAlsDatei() {
    this.assertUnlocked();
    if (this.modus === 'speicher') {
      const bisher = await A.lesen('dateien', TRESOR);
      if (bisher) return bisher;
    }
    return this._abbildDatei(this.dek, { ...this.header, savedAt: new Date().toISOString() });
  }

  /** Legt den jetzigen Stand vor einem Eingriff als Sicherung ab. */
  async sicherungskopie(anlass) {
    try {
      const bytes = await this.standAlsDatei();
      await this.backupAblegen(`${anlass}-${zeitstempel()}.tresor`, bytes);
    } catch (err) {
      console.error('Sicherung vor dem Eingriff:', err?.message);
    }
  }

  lock() {
    K.wipe(this.dek);
    K.wipe(this.attachKey);
    this.dek = null;
    this.attachKey = null;
    this.db = null;
    this.header = null;
    this.zeilen = null;
    this.verweis = null;
    this.modus = null;
    this.journalGesamt = 0;
    this._motorBeenden();
  }

  assertUnlocked() {
    if (this.isLocked) {
      const e = new Error('Der Tresor ist gesperrt.');
      e.code = 'LOCKED';
      throw e;
    }
  }

  /**
   * Persistiert den übergebenen Datenbestand. Serialisiert gleichzeitige Aufrufe.
   * In die Datenbank gehen nur die geänderten Zeilen, in einer Transaktion;
   * Journaleinträge kommen nur hinzu.
   */
  async save(db) {
    this.assertUnlocked();
    this.db = db;
    const run = async () => {
      // Zwischen Aufruf und Ausführung kann gesperrt worden sein.
      this.assertUnlocked();
      const motor = this.motor;
      const neu = zerlegen(db);
      const ops = unterschiede(this.zeilen, neu);
      if (!leer(ops)) {
        const r = await motor.anwenden(ops);
        if (this.motor !== motor) return { bytes: 0, savedAt: null };
        this.journalGesamt += r?.journal || 0;
      }
      this.zeilen = neu;
      await this._beschriften(db, false);
      const savedAt = new Date().toISOString();
      // In der Datenbank steht der Stand jetzt; die Sicherung (höchstens alle 30 Minuten) folgt danach.
      if (this.modus === 'opfs') return { bytes: 0, savedAt };
      const header = { ...this.header, savedAt };
      const buffer = await this._abbildDatei(this.dek, header);
      await this._maybeBackup();
      if (this.motor !== motor) return { bytes: 0, savedAt: null };
      await A.schreiben('dateien', TRESOR, buffer);
      this.header = header;
      return { bytes: buffer.length, savedAt };
    };
    const lauf = (this.saving || Promise.resolve()).then(run, run);
    // Wer speichert, wartet nur aufs Speichern; Sperren und Umzug warten auch auf die Sicherung.
    this.saving = lauf.then(() => (this.modus === 'opfs' && !this.isLocked ? this._maybeBackup() : null)).catch(() => {});
    return lauf;
  }

  /** Legt höchstens alle 30 Minuten einen Stand als Sicherung ab. */
  async _maybeBackup() {
    const now = Date.now();
    if (now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
    if (this.modus === 'speicher' && !(await A.lesen('dateien', TRESOR))) return;
    this.lastBackupAt = now;
    try {
      // Im Abbild-Modus der Stand vor diesem Speichern (wie bisher), sonst der jetzige.
      await this.backupAblegen(`kontovia-${zeitstempel()}.tresor`, await this.standAlsDatei());
    } catch (err) {
      console.error('Sicherung fehlgeschlagen:', err.message);
    }
  }

  async backupAblegen(name, bytes) {
    await A.schreiben('sicherungen', name, { bytes, mtime: Date.now() });
    const names = (await A.schluessel('sicherungen'))
      .filter((n) => String(n).endsWith('.tresor') && !String(n).startsWith(UMSTELLUNG_PRAEFIX))
      .sort();
    for (let i = 0; i < names.length - BACKUP_KEEP; i++) await A.loeschen('sicherungen', names[i]);
  }

  async listBackups() {
    const out = [];
    for (const name of await A.schluessel('sicherungen')) {
      const e = await A.lesen('sicherungen', name);
      if (e) out.push({ name: String(name), size: e.bytes?.byteLength || 0, mtime: e.mtime || 0 });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /**
   * Eine Sicherung auf diesem Gerät zurückholen (auch „vor-umstellung-…“): Der
   * jetzige Stand wird vorher gesichert, dann gilt der Stand der Sicherung,
   * wie beim Einspielen einer Cloud-Sicherung (restoredAt, Verbindungen und
   * Journal dieses Geräts bleiben). Nur Sicherungen dieser Buchhaltung.
   * @returns {Promise<object>} der Bestand für die Oberfläche
   */
  async sicherungZurueckholen(name) {
    this.assertUnlocked();
    if (!/^[\w.-]{1,120}\.tresor$/.test(String(name))) throw new Error('Ungültiger Name einer Sicherung.');
    const e = await A.lesen('sicherungen', name);
    if (!e?.bytes) throw new Error('Diese Sicherung liegt nicht mehr auf diesem Gerät.');
    const c = K.unpackContainer(e.bytes);
    if (c.version === K.FORMAT_VERWEIS) throw new Error('Diese Datei ist keine Sicherung.');
    let inhalt;
    try {
      inhalt = await K.inhaltOeffnen(this.dek, c);
    } catch {
      throw new Error('Diese Sicherung gehört zu einer anderen Buchhaltung (etwa vor einem „Cloud-Stand übernehmen“) und lässt sich hier nicht zurückholen.');
    }
    const db = inhalt.data || zusammensetzen((await this.motor.abbildLesen(inhalt.abbild)).zf);
    await this.saving?.catch(() => {});
    await this.sicherungskopie('vor-wiederherstellung');
    db.cloud = cloudNachEinspielen(this.db?.cloud, db.cloud);
    db.auditLog = journalNachEinspielen(this.db?.auditLog, db.auditLog);
    db.restoredAt = new Date().toISOString();
    await this.save(db);
    return db;
  }

  async changePassword(oldPassword, newPassword) {
    this.assertUnlocked();
    // Altes Passwort gegen den gespeicherten Stand prüfen, nicht gegen den Arbeitsspeicher.
    const c = K.unpackContainer(await A.lesen('dateien', TRESOR));
    K.wipe(await K.kopfOeffnen(oldPassword, c.header));
    await this.saving?.catch(() => {});
    const header = await K.rewrap(this.dek, newPassword, this.header);
    const neu = this.modus === 'opfs'
      ? K.packContainer(header, await K.sealVerweis(this.dek, this.verweis, header), K.FORMAT_VERWEIS)
      : await this._abbildDatei(this.dek, header);
    await A.schreiben('dateien', TRESOR, neu);
    this.header = header;
    return true;
  }

  /**
   * Journaleinträge (etwa aus einem Cloud-Stand) in die Datenbank übernehmen:
   * fehlende kommen hinzu, nichts wird geändert oder gelöscht.
   */
  async journalErgaenzen(eintraege) {
    this.assertUnlocked();
    if (!Array.isArray(eintraege) || !eintraege.length) return 0;
    const journal = eintraege.map((e) => JSON.stringify(e) ?? 'null');
    const r = await this.motor.anwenden({ reihenfolge: null, werte: [], tabellen: {}, journal });
    this.journalGesamt += r?.journal || 0;
    return r?.journal || 0;
  }

  /** Alle Journaleinträge, auch die im Archiv der Datenbank, nach Zeit (für Exporte). Vorher speichert die Oberfläche. */
  async journalAlle() {
    this.assertUnlocked();
    await this.saving?.catch(() => {});
    return (await this.motor.journalAlle()).map((t) => JSON.parse(t));
  }

  /* ---------------------------------------------------------------------- */
  /* Belege                                                                  */
  /* ---------------------------------------------------------------------- */

  _id(id) {
    if (!ID_RE.test(String(id))) throw new Error('Ungültige Beleg-Kennung.');
    return String(id);
  }

  async addAttachment(bytes, meta = {}) {
    this.assertUnlocked();
    if (!(bytes instanceof Uint8Array)) throw new Error('Kein Dateiinhalt übergeben.');
    if (bytes.length === 0) throw new Error('Die Datei ist leer.');
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Die Datei ist zu groß (max. ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB).`);
    }
    const id = K.toHex(K.randomBytes(16));
    const blob = await K.seal(this.attachKey, bytes, attachAad(id));
    await A.schreiben('belege', id, blob);
    return {
      id,
      fileName: String(meta.fileName || 'beleg'),
      mime: String(meta.mime || 'application/octet-stream'),
      size: bytes.length,
      sha256: await K.sha256Hex(bytes),
      createdAt: new Date().toISOString(),
    };
  }

  async readAttachment(id) {
    this.assertUnlocked();
    const blob = await A.lesen('belege', this._id(id));
    if (!blob) throw new Error('Der Beleg liegt auf diesem Gerät nicht vor. Ein Cloud-Abgleich holt ihn nach.');
    return K.open(this.attachKey, blob, attachAad(id));
  }

  /** Ablegen eines bereits verschlüsselten Belegs (aus der Cloud) – nach Prüfung. */
  async storeSealedAttachment(id, sealed) {
    this.assertUnlocked();
    await K.open(this.attachKey, sealed, attachAad(this._id(id)));
    await A.schreiben('belege', id, sealed);
  }

  async sealedAttachment(id) {
    this.assertUnlocked();
    const raw = await this.readAttachment(id);
    return K.seal(this.attachKey, raw, attachAad(id));
  }

  async localAttachmentIds() {
    return (await A.schluessel('belege')).map(String).filter((k) => ID_RE.test(k));
  }

  async deleteAttachment(id) {
    this.assertUnlocked();
    await A.loeschen('belege', this._id(id));
    return true;
  }

  async pruneOrphanAttachments(knownIds) {
    this.assertUnlocked();
    const known = new Set(knownIds);
    let removed = 0;
    for (const id of await this.localAttachmentIds()) {
      if (!known.has(id)) {
        await A.loeschen('belege', id);
        removed++;
      }
    }
    return removed;
  }

  /* ---------------------------------------------------------------------- */
  /* Umzug zwischen Browser und Ordner                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Vor dem Umzug in einen Ordner: Ein Verweis auf den Dateispeicher des Browsers
   * taugt dort nicht. Der Stand wird als Abbild in kontovia.tresor geschrieben
   * und die Datenbank fortan im Arbeitsspeicher geführt.
   * @returns {Promise<string|null>} die bisherige Datei im Dateispeicher (zum Aufräumen nach dem Umzug)
   */
  async fuerOrdnerVorbereiten() {
    this.assertUnlocked();
    await this.saving?.catch(() => {});
    if (this.modus !== 'opfs') return null;
    const header = { ...this.header, savedAt: new Date().toISOString() };
    const datei = await this._abbildDatei(this.dek, header);
    const alt = this.verweis?.datei || null;
    // Im Arbeitsspeicher weiterführen: dasselbe Abbild wieder einlesen.
    const probe = K.unpackContainer(datei);
    const abbild = await K.openAbbild(this.dek, probe.body, probe.headerBuf);
    await this.motor.schliessen();
    await this.motor.oeffnenSpeicher();
    await this.motor.abbildEinlesen(abbild, null);
    await A.schreiben('dateien', TRESOR, datei);
    this.header = header;
    this.modus = 'speicher';
    this.verweis = null;
    return alt;
  }

  /** Nach einem gelungenen Umzug in den Ordner: die Datenbank im Dateispeicher des Browsers entfernen. */
  async dateispeicherAufraeumen() {
    if (this.modus !== 'speicher') return false;
    try {
      for (const n of await this.motor.dateien()) if (!/-(wal|journal)$/.test(n)) await this.motor.dateiLoeschen(n);
    } catch (err) {
      console.error('Aufräumen nach dem Umzug:', err?.message);
    }
    return true;
  }

  /**
   * Prüft eine Kopie beim Umzug des Speicherorts mit dem Schlüssel des offenen
   * Tresors: Tresordatei, Abgleichbasis und Belege müssen sich entschlüsseln
   * lassen, Sicherungen (womöglich mit einem älteren Passwort) wenigstens als
   * Kontovia-Datei lesen. Wirft, wenn nicht.
   */
  async kopiePruefen(store, key, bytes) {
    this.assertUnlocked();
    if (store === 'dateien' && key === TRESOR) {
      const c = K.unpackContainer(bytes);
      if (c.version === K.FORMAT_VERWEIS) throw new Error('Die Tresordatei verweist auf den Speicher des Browsers und lässt sich so nicht verschieben.');
      await K.inhaltOeffnen(this.dek, c);
    } else if (store === 'dateien' && key === 'sync-basis.bin') {
      await K.open(this.dek, bytes, K.utf8('kontovia/sync-basis'));
    } else if (store === 'belege') {
      await K.open(this.attachKey, bytes, attachAad(this._id(key)));
    } else if (store === 'sicherungen') {
      K.unpackContainer(bytes);
    }
  }

  async storageStats() {
    const vault = await A.lesen('dateien', TRESOR);
    let datenbank = 0;
    if (this.motor && !this.isLocked) {
      try { datenbank = (await this.motor.pruefen()).groesse || 0; } catch { /* nur Anzeige */ }
    }
    return {
      dataDir: this.dataDir,
      vaultBytes: (vault?.byteLength || 0) + (this.modus === 'opfs' ? datenbank : 0),
      ablage: this.modus,
      journal: this.journalGesamt,
      attachments: await A.umfang('belege'),
      backups: await A.umfang('sicherungen'),
      browser: await A.kontingent(),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Vollsicherung (Daten + Belege in einer verschlüsselten Datei)           */
  /* ---------------------------------------------------------------------- */

  async exportFullBackup(password) {
    this.assertUnlocked();
    const attachments = [];
    for (const id of await this.localAttachmentIds()) {
      attachments.push({ id, data: K.toBase64(await this.readAttachment(id)) });
    }
    const payload = {
      kind: 'kontovia-vollsicherung',
      version: 1,
      exportedAt: new Date().toISOString(),
      // Ohne Anmeldemerkmale (zugang.js), mit dem ganzen Journal samt Archiv.
      db: fuerSicherung({ ...this.db, [JOURNAL]: await this.journalAlle() }),
      attachments,
    };
    // Format 1, damit jede Fassung die Vollsicherung lesen kann.
    const { buffer, dek } = await K.createContainer(password, payload, { app: 'Kontovia-Sicherung' });
    K.wipe(dek);
    return buffer;
  }

  /** Stellt eine Vollsicherung wieder her – überschreibt den aktuellen Bestand. */
  async importFullBackup(bytes, password) {
    const { data, dek, version } = await K.openContainer(password, bytes);
    K.wipe(dek);
    if (version !== 1 || data?.kind !== 'kontovia-vollsicherung') {
      throw new Error('Die Datei ist keine Kontovia-Vollsicherung.');
    }
    this.assertUnlocked();
    // Die Verbindungen dieses Geräts bleiben, wie sie sind; restoredAt wie früher unter Windows.
    if (data.db && typeof data.db === 'object') {
      data.db.cloud = cloudNachEinspielen(this.db?.cloud, data.db.cloud);
      data.db.auditLog = journalNachEinspielen(this.db?.auditLog, data.db.auditLog);
      data.db.restoredAt = new Date().toISOString();
    }
    // Belege zuerst, danach der Bestand – bei einem Abbruch bleibt nie ein
    // Datensatz ohne zugehörige Datei zurück.
    const eintraege = [];
    for (const a of data.attachments || []) {
      if (!ID_RE.test(String(a.id))) continue;
      eintraege.push([a.id, await K.seal(this.attachKey, K.fromBase64(a.data), attachAad(a.id))]);
    }
    if (eintraege.length) await A.schreibenMehrere('belege', eintraege);
    await this.save(data.db);
    return { transactions: data.db?.transactions?.length || 0, attachments: (data.attachments || []).length };
  }
}

/** Name einer neuen Datenbankdatei: je Umstellung eine eigene, die alte wird erst danach entfernt. */
function neueDatei() {
  return `bestand-${zeitstempel()}-${K.toHex(K.randomBytes(4))}.db`;
}

function gleicheBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
