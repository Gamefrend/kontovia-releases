/**
 * Kontovia – Abgleich mit der Cloud, Web-Fassung.
 *
 * Gegenstück zu src/main/cloud.js, mit demselben Ablauf in drei Schritten
 * (begin – Oberfläche führt zusammen – commit). Hochgeladen wird nur, was
 * bereits verschlüsselt ist; der Schlüssel bleibt auf dem Gerät.
 *
 * Auf dem iPhone ist der Abgleich wichtiger als am PC: Der Browser darf
 * Website-Daten bei Platzmangel räumen, und dann ist die Cloud der einzige
 * zweite Ort, an dem die Buchhaltung noch liegt.
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { TRESOR } from './tresor.js';
import { FirebaseBackend } from './firebase.js';
import { DriveBackend } from './googledrive.js';
import BUILTIN from './cloudconfig.js';

const BASIS = 'sync-basis.bin';
const BASIS_AAD = K.utf8('kontovia/sync-basis');
const attachAad = (id) => K.utf8(`kontovia/attachment/${id}`);

export class Cloud {
  /**
   * @param {import('./tresor.js').Vault} vault
   * @param {{zeigeCode:Function}} ui  zeigt den Anmeldecode von Google an
   */
  constructor(vault, ui) {
    this.vault = vault;
    this.ui = ui;
    this.backend = null;
    this.busy = false;
    this.lastError = null;
    this.pending = null;
  }

  cfg() {
    const db = this.vault.db;
    if (!db) throw new Error('Der Tresor ist gesperrt.');
    db.cloud ??= {};
    db.cloud.provider ??= BUILTIN.provider;
    return db.cloud;
  }

  /**
   * Die Web-Fassung meldet sich mit einem eigenen OAuth-Client an (Typ
   * „Fernseher und Geräte mit eingeschränkter Eingabe“). Die Client-ID der
   * Windows-Fassung taugt dafür nicht; sie steht deshalb in eigenen Feldern.
   */
  effective() {
    const c = this.cfg();
    return {
      provider: c.provider,
      apiKey: c.apiKey || BUILTIN.firebase.apiKey,
      bucket: c.bucket || BUILTIN.firebase.bucket,
      clientId: c.webClientId || BUILTIN.googleGeraet?.clientId || '',
      clientSecret: c.webClientSecret || BUILTIN.googleGeraet?.clientSecret || '',
    };
  }

  be() {
    const c = this.cfg();
    if (this.backend && this.backend.name === c.provider) return this.backend;
    c.state ??= {};
    c.state[c.provider] ??= {};
    const state = c.state[c.provider];
    const e = this.effective();
    const zeigeCode = this.ui.zeigeCode;
    this.backend = c.provider === 'drive'
      ? new DriveBackend({ clientId: e.clientId, clientSecret: e.clientSecret, zeigeCode }, state)
      : new FirebaseBackend({ apiKey: e.apiKey, bucket: e.bucket, clientId: e.clientId, clientSecret: e.clientSecret, zeigeCode }, state);
    return this.backend;
  }

  status() {
    const c = this.vault.db?.cloud || {};
    const provider = c.provider || 'firebase';
    const state = c.state?.[provider] || {};
    const builtinClient = BUILTIN.googleGeraet?.clientId || '';
    const clientId = c.webClientId || builtinClient;
    const apiKey = c.apiKey || BUILTIN.firebase.apiKey;
    const bucket = c.bucket || BUILTIN.firebase.bucket;
    const configured = provider === 'drive' ? !!clientId : !!(apiKey && bucket && clientId);
    return {
      provider,
      configured,
      linked: !!state.refreshToken,
      email: state.email || '',
      autoSync: c.autoSync !== false,
      autoSyncMinutes: Number(c.autoSyncMinutes ?? 15),
      lastSyncAt: c.lastSyncAt || null,
      lastRemoteVersion: c.remoteVersion || null,
      builtIn: {
        apiKey: !!BUILTIN.firebase.apiKey,
        bucket: !!BUILTIN.firebase.bucket,
        clientId: !!builtinClient,
      },
      missing: provider === 'drive'
        ? (clientId ? [] : ['clientId'])
        : [!apiKey && 'apiKey', !bucket && 'bucket', !clientId && 'clientId'].filter(Boolean),
      lastError: this.lastError,
      busy: this.busy,
      clientKind: 'geraet',
    };
  }

  /** Übernimmt die Einstellungen aus der Oberfläche. */
  configure({ provider, apiKey, bucket, clientId, clientSecret, autoSync, autoSyncMinutes }) {
    const str = (v) => String(v ?? '').slice(0, 200).trim();
    const c = this.cfg();
    if (provider !== undefined) c.provider = provider === 'drive' ? 'drive' : 'firebase';
    if (apiKey !== undefined) c.apiKey = str(apiKey);
    if (bucket !== undefined) c.bucket = str(bucket).replace(/^gs:\/\//, '');
    if (clientId !== undefined) c.webClientId = str(clientId);
    if (clientSecret !== undefined) c.webClientSecret = str(clientSecret);
    if (autoSync !== undefined) c.autoSync = !!autoSync;
    if (autoSyncMinutes !== undefined) {
      const m = Number(autoSyncMinutes);
      c.autoSyncMinutes = Number.isFinite(m) && m >= 5 && m <= 720 ? m : 15;
    }
    this.backend = null;
  }

  async connect() {
    const res = await this.be().connect();
    this.cfg().linkedAt = new Date().toISOString();
    await this.vault.save(this.vault.db);
    return res;
  }

  async disconnect({ keepRemote = true } = {}) {
    const be = this.be();
    if (!keepRemote) {
      try { await be.removeAll(); } catch { /* auch dann wird lokal getrennt */ }
    }
    await be.disconnect();
    const c = this.cfg();
    delete c.remoteVersion;
    delete c.lastSyncAt;
    this.backend = null;
    await A.loeschen('dateien', BASIS).catch(() => {});
    await this.vault.save(this.vault.db);
    return true;
  }

  async readBase() {
    try {
      const blob = await A.lesen('dateien', BASIS);
      if (!blob) return null;
      return JSON.parse(K.fromUtf8(await K.open(this.vault.dek, blob, BASIS_AAD)));
    } catch {
      return null;
    }
  }

  async writeBase(db) {
    const blob = await K.seal(this.vault.dek, K.utf8(JSON.stringify(db)), BASIS_AAD);
    await A.schreiben('dateien', BASIS, blob);
  }

  /**
   * Holt den Cloud-Stand. Rückgabe wie in der Windows-Fassung:
   *   leer | aktuell | bereit (mit remote und base) | fremd
   */
  async begin({ force = false, dirty = true } = {}) {
    this.vault.assertUnlocked();
    const be = this.be();
    const c = this.cfg();

    const meta = await be.vaultMeta();
    if (!meta.exists) {
      this.pending = { remoteVersion: null, hadRemote: false };
      return { state: 'leer' };
    }

    // Kostenbremse: drüben unverändert und hier nichts Neues – nicht laden.
    if (!force && meta.version && meta.version === c.remoteVersion && !dirty) {
      this.pending = null;
      return { state: 'aktuell', remoteVersion: meta.version };
    }

    const blob = await be.vaultDownload();
    let remote;
    try {
      const { headerBuf, body } = K.unpackContainer(blob);
      remote = await K.openBody(this.vault.dek, body, headerBuf);
    } catch {
      this.pending = null;
      return { state: 'fremd', modifiedTime: meta.updated, size: meta.size };
    }

    this.pending = { remoteVersion: meta.version, hadRemote: true };
    return { state: 'bereit', remote, base: await this.readBase(), remoteVersion: meta.version };
  }

  async commit(db, onProgress = () => {}) {
    this.vault.assertUnlocked();
    if (!this.pending) throw new Error('Kein laufender Abgleich – bitte erneut starten.');
    const be = this.be();

    if (this.pending.hadRemote) {
      const now = await be.vaultMeta();
      if (now.exists && now.version !== this.pending.remoteVersion) {
        this.pending = null;
        const e = new Error('Ein anderes Gerät hat währenddessen gespeichert.');
        e.code = 'RETRY';
        throw e;
      }
    }

    // Maßgeblich ist der eigene Cloud-Block – dort stehen Anmeldemerkmal und Abgleichstand.
    db.cloud = this.vault.db?.cloud || db.cloud || {};
    const c = db.cloud;

    await this.vault.save(db);

    onProgress({ phase: 'tresor' });
    const header = { ...this.vault.header, savedAt: new Date().toISOString() };
    const container = K.packContainer(header, await K.sealBody(this.vault.dek, db, header));
    const up = await be.vaultUpload(container);

    c.remoteVersion = up.version;
    c.lastSyncAt = new Date().toISOString();

    const attachments = await this.syncAttachments(db, onProgress);
    await this.writeBase(db);

    // Während des Hochladens kann weitergearbeitet worden sein: den neueren
    // Stand schreiben und nur den Abgleichvermerk ergänzen.
    const aktuell = this.vault.db || db;
    aktuell.cloud = c;
    await this.vault.save(aktuell);

    this.pending = null;
    this.lastError = null;
    return { remoteVersion: up.version, bytes: container.length, attachments };
  }

  /** Belege sind unveränderlich: fehlt eine Datei auf einer Seite, wird sie übertragen. */
  async syncAttachments(db, onProgress = () => {}) {
    const be = this.be();
    const wanted = new Set((db.attachments || []).map((a) => a.id));
    const remote = await be.listAttachments();
    const remoteIds = new Set(remote.map((a) => a.id));
    const localIds = new Set(await this.vault.localAttachmentIds());

    let up = 0, down = 0, removed = 0, done = 0;
    for (const id of wanted) {
      if (localIds.has(id) && !remoteIds.has(id)) {
        onProgress({ phase: 'beleg-hoch', id, done: ++done, total: wanted.size });
        const raw = await this.vault.readAttachment(id);
        await be.attachmentUpload(id, await K.seal(this.vault.attachKey, raw, attachAad(id)));
        up++;
      } else if (!localIds.has(id) && remoteIds.has(id)) {
        onProgress({ phase: 'beleg-runter', id, done: ++done, total: wanted.size });
        // Wird vor dem Ablegen geprüft: gehört der Beleg zu diesem Tresor?
        await this.vault.storeSealedAttachment(id, await be.attachmentDownload(id));
        down++;
      }
    }

    for (const a of remote) {
      if (!wanted.has(a.id)) {
        await be.attachmentRemove(a.id).catch(() => {});
        removed++;
      }
    }
    return { hochgeladen: up, heruntergeladen: down, entfernt: removed };
  }

  /** Übernimmt den Cloud-Stand vollständig. Der hiesige Tresor wird vorher gesichert. */
  async adoptRemote() {
    this.vault.assertUnlocked();
    const blob = await this.be().vaultDownload();
    K.unpackContainer(blob); // wirft, wenn es keine gültige Datei ist

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bisher = await A.lesen('dateien', TRESOR);
    if (bisher) await this.vault.backupAblegen(`vor-cloud-uebernahme-${stamp}.tresor`, bisher).catch(() => {});

    await A.schreiben('dateien', TRESOR, blob);
    await A.loeschen('dateien', BASIS).catch(() => {});
    this.backend = null;
    this.vault.lock(); // der Schlüssel des Cloud-Tresors ist ein anderer
    return true;
  }

  async overwriteRemote() {
    this.vault.assertUnlocked();
    const db = this.vault.db;
    const header = { ...this.vault.header, savedAt: new Date().toISOString() };
    const container = K.packContainer(header, await K.sealBody(this.vault.dek, db, header));
    const up = await this.be().vaultUpload(container);
    const c = this.cfg();
    c.remoteVersion = up.version;
    c.lastSyncAt = new Date().toISOString();
    this.pending = { remoteVersion: up.version, hadRemote: true };
    await this.syncAttachments(db);
    await this.writeBase(db);
    await this.vault.save(db);
    this.pending = null;
    return { remoteVersion: up.version };
  }

  async quota() {
    return this.be().quota();
  }
}
