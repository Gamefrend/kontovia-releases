/**
 * Kontovia – Tresorverwaltung der Web-Fassung.
 * Die verschlüsselten Blöcke liegen im Speicher des Browsers oder in einem
 * Ordner auf dem Gerät (siehe ablage.js).
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { fuerSicherung, cloudNachEinspielen, journalNachEinspielen } from './zugang.js';

export const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024; // 40 MB pro Beleg
const BACKUP_KEEP = 25;
const BACKUP_MIN_INTERVAL_MS = 30 * 60 * 1000; // höchstens alle 30 Minuten

export const TRESOR = 'kontovia.tresor';
const ID_RE = /^[a-f0-9]{32}$/;

const attachAad = (id) => K.utf8(`kontovia/attachment/${id}`);

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
  }

  get isLocked() {
    return this.dek === null;
  }

  async exists() {
    return !!(await A.lesen('dateien', TRESOR));
  }

  async _adopt(dek, header, db) {
    this.dek = dek;
    this.attachKey = await K.subKey(dek, 'kontovia/attachments/v1');
    this.header = header;
    this.db = db;
  }

  async create(password, initialDb) {
    if (await this.exists()) throw new Error('Am Speicherort liegt bereits eine Buchhaltung.');
    const { buffer, dek, header } = await K.createContainer(password, initialDb, {
      app: 'Kontovia',
      appVersion: this.appVersion || '1.0.0',
    });
    await A.schreiben('dateien', TRESOR, buffer);
    await this._adopt(dek, header, initialDb);
    return true;
  }

  async unlock(password) {
    const buf = await A.lesen('dateien', TRESOR);
    if (!buf) throw new Error('Am Speicherort liegt keine Buchhaltung.');
    const { data, dek, header } = await K.openContainer(password, buf);
    await this._adopt(dek, header, data);
    return data;
  }

  /** Entsperren mit dem Schlüssel aus der Übergabe nach einer Aktualisierung (uebergabe.js). */
  async unlockWithKey(dek) {
    const buf = await A.lesen('dateien', TRESOR);
    if (!buf) throw new Error('Am Speicherort liegt keine Buchhaltung.');
    const { header, headerBuf, body } = K.unpackContainer(buf);
    let data;
    try {
      data = await K.openBody(dek, body, headerBuf);
    } catch {
      throw Object.assign(new Error('Der Schlüssel passt nicht zu diesem Tresor.'), { code: 'BAD_KEY' });
    }
    await this._adopt(dek, header, data);
    return data;
  }

  /** Übernimmt einen Tresor aus der Cloud als ersten Tresor – geschrieben wird erst, wenn das Passwort passt. */
  async adoptContainer(bytes, password) {
    if (await this.exists()) throw new Error('Am Speicherort liegt bereits eine Buchhaltung.');
    const { data, dek, header } = await K.openContainer(String(password ?? ''), bytes);
    await A.schreiben('dateien', TRESOR, bytes);
    await this._adopt(dek, header, data);
    return data;
  }

  /** Legt den jetzigen Stand vor einem Eingriff als Sicherung ab. */
  async sicherungskopie(anlass) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bisher = await A.lesen('dateien', TRESOR);
    if (bisher) await this.backupAblegen(`${anlass}-${stamp}.tresor`, bisher).catch(() => {});
  }

  lock() {
    K.wipe(this.dek);
    K.wipe(this.attachKey);
    this.dek = null;
    this.attachKey = null;
    this.db = null;
    this.header = null;
  }

  assertUnlocked() {
    if (this.isLocked) {
      const e = new Error('Der Tresor ist gesperrt.');
      e.code = 'LOCKED';
      throw e;
    }
  }

  /** Persistiert den übergebenen Datenbestand. Serialisiert gleichzeitige Aufrufe. */
  async save(db) {
    this.assertUnlocked();
    this.db = db;
    const run = async () => {
      // Zwischen Aufruf und Ausführung kann gesperrt worden sein.
      this.assertUnlocked();
      const header = { ...this.header, savedAt: new Date().toISOString() };
      const body = await K.sealBody(this.dek, db, header);
      const buffer = K.packContainer(header, body);
      await this._maybeBackup();
      await A.schreiben('dateien', TRESOR, buffer);
      this.header = header;
      return { bytes: buffer.length, savedAt: header.savedAt };
    };
    this.saving = (this.saving || Promise.resolve()).then(run, run);
    return this.saving;
  }

  /** Legt den noch unveränderten Stand als Sicherung ab. */
  async _maybeBackup() {
    const now = Date.now();
    if (now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
    const current = await A.lesen('dateien', TRESOR);
    if (!current) return;
    this.lastBackupAt = now;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      await this.backupAblegen(`kontovia-${stamp}.tresor`, current);
    } catch (err) {
      console.error('Sicherung fehlgeschlagen:', err.message);
    }
  }

  async backupAblegen(name, bytes) {
    await A.schreiben('sicherungen', name, { bytes, mtime: Date.now() });
    const names = (await A.schluessel('sicherungen')).filter((n) => String(n).endsWith('.tresor')).sort();
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

  async changePassword(oldPassword, newPassword) {
    this.assertUnlocked();
    // Altes Passwort gegen den gespeicherten Stand prüfen, nicht gegen den Arbeitsspeicher.
    const buf = await A.lesen('dateien', TRESOR);
    const check = await K.openContainer(oldPassword, buf);
    K.wipe(check.dek);
    const header = await K.rewrap(this.dek, newPassword, this.header);
    const body = await K.sealBody(this.dek, this.db, header);
    await A.schreiben('dateien', TRESOR, K.packContainer(header, body));
    this.header = header;
    return true;
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

  /**
   * Prüft eine Kopie beim Umzug des Speicherorts mit dem Schlüssel des offenen
   * Tresors: Tresordatei, Abgleichbasis und Belege müssen sich entschlüsseln
   * lassen, Sicherungen (womöglich mit einem älteren Passwort) wenigstens als
   * Kontovia-Datei lesen. Wirft, wenn nicht.
   */
  async kopiePruefen(store, key, bytes) {
    this.assertUnlocked();
    if (store === 'dateien' && key === TRESOR) {
      const { headerBuf, body } = K.unpackContainer(bytes);
      await K.openBody(this.dek, body, headerBuf);
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
    return {
      dataDir: this.dataDir,
      vaultBytes: vault?.byteLength || 0,
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
      // Ohne Anmeldemerkmale (zugang.js).
      db: fuerSicherung(this.db),
      attachments,
    };
    const { buffer, dek } = await K.createContainer(password, payload, { app: 'Kontovia-Sicherung' });
    K.wipe(dek);
    return buffer;
  }

  /** Stellt eine Vollsicherung wieder her – überschreibt den aktuellen Bestand. */
  async importFullBackup(bytes, password) {
    const { data, dek } = await K.openContainer(password, bytes);
    K.wipe(dek);
    if (data?.kind !== 'kontovia-vollsicherung') {
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
