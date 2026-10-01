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
 *
 * Sicherungen in der Cloud, die Anmeldung vor dem ersten Tresor und das
 * Mitnehmen der Geräteverbindung beim Übernehmen laufen wie in der
 * Windows-Fassung; die Begründungen stehen dort.
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { TRESOR } from './tresor.js';
import { FirebaseBackend } from './firebase.js';
import { DriveBackend } from './googledrive.js';
import BUILTIN from './cloudconfig.js';
import { journalNachEinspielen, fuerSicherung } from './zugang.js';
import * as W from './weiterleitung.js';

const BASIS = 'sync-basis.bin';
const BASIS_AAD = K.utf8('kontovia/sync-basis');
const attachAad = (id) => K.utf8(`kontovia/attachment/${id}`);

const SICHERUNG_ABSTAND_MS = 20 * 60 * 60 * 1000;
const SICHERUNG_BEHALTEN = 30;
const BELEG_FRIST_MS = 90 * 24 * 60 * 60 * 1000;
/** Die Web-Fassung führt ihre Client-Felder unter eigenen Namen (webClientId, webClientSecret). */
const VERBINDUNG = ['provider', 'apiKey', 'bucket', 'clientId', 'clientSecret', 'webClientId', 'webClientSecret',
  'autoSync', 'autoSyncMinutes', 'state', 'linkedAt'];

export function sicherungsName(anlass, jetzt = new Date()) {
  return `${jetzt.toISOString().slice(0, 19).replace(/:/g, '-')}Z_${anlass}.kv`;
}

export function sicherungsAngaben(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z_([a-z-]+)\.kv$/.exec(String(name));
  return m ? { at: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`, anlass: m[5] } : null;
}

function verbindungVon(c) {
  const out = {};
  for (const k of VERBINDUNG) if (c?.[k] !== undefined) out[k] = structuredClone(c[k]);
  return out;
}

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
    this.anmeldung = null;
    this.mitnehmen = null;
    /** Was nach einer Weiterleitung zu Google an die Oberfläche geht (einmalig). */
    this.meldung = null;
    this.ebenVerbunden = null;
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

  baustein(provider, e, state) {
    const zeigeCode = this.ui.zeigeCode;
    return provider === 'drive'
      ? new DriveBackend({ clientId: e.clientId, clientSecret: e.clientSecret, zeigeCode }, state)
      : new FirebaseBackend({ apiKey: e.apiKey, bucket: e.bucket, clientId: e.clientId, clientSecret: e.clientSecret, zeigeCode }, state);
  }

  be() {
    const c = this.cfg();
    if (this.backend && this.backend.name === c.provider) return this.backend;
    c.state ??= {};
    c.state[c.provider] ??= {};
    this.backend = this.baustein(c.provider, this.effective(), c.state[c.provider]);
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
    const weiterleitung = this.weiterleitungMoeglich();
    const configured = provider === 'drive' ? !!clientId : !!(apiKey && bucket && (clientId || weiterleitung));
    return {
      weiterleitung,
      provider,
      configured,
      linked: !!state.refreshToken,
      email: state.email || '',
      autoSync: c.autoSync !== false,
      autoSyncMinutes: Number(c.autoSyncMinutes ?? 15),
      lastSyncAt: c.lastSyncAt || null,
      lastRemoteVersion: c.remoteVersion || null,
      lastCloudBackupAt: c.lastCloudBackupAt || null,
      cloudBackupError: c.cloudBackupError || null,
      builtIn: {
        apiKey: !!BUILTIN.firebase.apiKey,
        bucket: !!BUILTIN.firebase.bucket,
        clientId: !!builtinClient || weiterleitung,
      },
      missing: provider === 'drive'
        ? (clientId ? [] : ['clientId'])
        : [!apiKey && 'apiKey', !bucket && 'bucket', !(clientId || weiterleitung) && 'clientId'].filter(Boolean),
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

  /* ---------------------------------------------------------------------- */
  /* Anmeldung beim ersten Start                                             */
  /* ---------------------------------------------------------------------- */

  anmeldeStatus() {
    const f = BUILTIN.firebase || {};
    const g = BUILTIN.googleGeraet || {};
    const weiterleitung = this.weiterleitungMoeglich();
    const moeglich = BUILTIN.provider === 'drive' ? !!g.clientId : !!(f.apiKey && f.bucket && (g.clientId || weiterleitung));
    const a = this.anmeldung;
    return {
      moeglich,
      weiterleitung,
      code: BUILTIN.provider === 'drive' ? !!g.clientId : !!(f.apiKey && f.bucket && g.clientId),
      provider: BUILTIN.provider,
      angemeldet: !!a,
      email: a?.state.email || '',
      vorhanden: !!a?.meta.exists,
      groesse: a?.meta.size || 0,
      stand: a?.meta.updated || null,
    };
  }

  async anmelden() {
    if (await this.vault.exists()) throw new Error('In diesem Browser gibt es bereits eine Buchhaltung. Die Verbindung zu Google richten Sie in den Einstellungen ein.');
    if (!this.anmeldeStatus().moeglich) throw new Error('In dieser Fassung ist keine Anmeldung bei Google hinterlegt.');
    await this.anmeldungVerwerfen();
    const provider = BUILTIN.provider === 'drive' ? 'drive' : 'firebase';
    const state = {};
    const be = this.baustein(provider, {
      apiKey: BUILTIN.firebase.apiKey,
      bucket: BUILTIN.firebase.bucket,
      clientId: BUILTIN.googleGeraet?.clientId || '',
      clientSecret: BUILTIN.googleGeraet?.clientSecret || '',
    }, state);
    await be.connect();
    let meta;
    try {
      meta = await be.vaultMeta();
    } catch (err) {
      await be.disconnect().catch(() => {});
      throw new Error(`Angemeldet, aber die Cloud ist nicht erreichbar: ${err.message}`);
    }
    this.anmeldung = { provider, state, be, meta, blob: null };
    return this.anmeldeStatus();
  }

  /* ---------------------------------------------------------------------- */
  /* Anmeldung per Weiterleitung (weiterleitung.js)                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Geht der Weg ohne Code? Nur mit Firebase im mitgelieferten Projekt – der
   * Client für die Weiterleitung gehört zu diesem Projekt. Wer ein eigenes
   * eingetragen hat oder in Google Drive ablegt, meldet sich per Code an.
   */
  weiterleitungMoeglich() {
    const c = this.vault.db?.cloud || {};
    const provider = c.provider || BUILTIN.provider;
    return provider !== 'drive' && !c.apiKey && !c.bucket
      && !!(BUILTIN.googleWeb?.clientId && BUILTIN.firebase?.apiKey && BUILTIN.firebase?.bucket);
  }

  /**
   * Leitet zu Google weiter. Die Seite verlässt Kontovia; weiter geht es nach
   * der Rückkehr in rueckkehr(). Der zurückgegebene Promise erfüllt sich nie.
   * @param {'erststart'|'verbinden'} zweck
   */
  weiterleiten(zweck) {
    const url = W.starten({
      clientId: BUILTIN.googleWeb.clientId,
      zweck,
      loginHint: this.vault.db?.cloud?.state?.firebase?.email || '',
    });
    location.assign(url);
    return new Promise(() => {});
  }

  /**
   * Nach der Rückkehr von Google, beim Start (der Tresor ist gesperrt):
   * Token bei Firebase eintauschen und nachsehen, ob im Konto schon eine
   * Buchhaltung liegt. Verbunden wird erst beim Anlegen, Laden oder – für
   * einen vorhandenen Tresor – nach dem Entsperren (anmeldungVerbinden).
   */
  async rueckkehr(antwort) {
    this.meldung = { zweck: antwort.zweck, fehler: antwort.fehler || '', abgebrochen: !!antwort.abgebrochen, email: antwort.email || '' };
    if (antwort.fehler) return;
    try {
      const state = {};
      const be = this.baustein('firebase', {
        apiKey: BUILTIN.firebase.apiKey, bucket: BUILTIN.firebase.bucket, clientId: BUILTIN.googleWeb.clientId, clientSecret: '',
      }, state);
      await be.mitIdToken(antwort.idToken, antwort.email);
      let meta;
      try {
        meta = await be.vaultMeta();
      } catch (err) {
        await be.disconnect().catch(() => {});
        throw new Error(`Angemeldet, aber die Cloud ist nicht erreichbar: ${err.message}`);
      }
      this.anmeldung = { provider: 'firebase', state, be, meta, blob: null, zweck: antwort.zweck };
      this.meldung.email = state.email || antwort.email || '';
    } catch (err) {
      this.meldung.fehler = err.message;
    }
  }

  /** Nach dem Entsperren: eine eben per Weiterleitung erfolgte Anmeldung mit diesem Tresor verbinden. */
  async anmeldungVerbinden() {
    const a = this.anmeldung;
    if (!a || a.zweck !== 'verbinden' || this.vault.isLocked) return false;
    this.anmeldung = null;
    const c = this.cfg();
    c.provider = a.provider;
    c.state = { ...(c.state || {}), [a.provider]: a.state };
    c.linkedAt = new Date().toISOString();
    this.backend = a.be;
    await this.vault.save(this.vault.db);
    this.ebenVerbunden = a.state.email || 'Google-Konto';
    return true;
  }

  /**
   * Einmalige Meldungen an die Oberfläche: die Rückkehr von Google (beim Start
   * abgeholt) und „eben verbunden“ (nach dem Entsperren abgeholt).
   */
  rueckmeldung() {
    const m = this.meldung;
    const v = this.ebenVerbunden;
    this.meldung = null;
    this.ebenVerbunden = null;
    if (!m && !v) return null;
    return { ...(m || {}), ...(v ? { ebenVerbunden: true, email: v } : {}) };
  }

  async anmeldungVerwerfen() {
    const a = this.anmeldung;
    this.anmeldung = null;
    if (a) await a.be.disconnect().catch(() => {});
    return true;
  }

  async anmeldungEintragen() {
    const a = this.anmeldung;
    if (!a || this.vault.isLocked) return false;
    this.anmeldung = null;
    if (a.meta.exists) { await a.be.disconnect().catch(() => {}); return false; }
    const c = this.cfg();
    c.provider = a.provider;
    c.state = { [a.provider]: a.state };
    c.linkedAt = new Date().toISOString();
    this.backend = a.be;
    await this.vault.save(this.vault.db);
    return true;
  }

  async ausCloudLaden(password) {
    const a = this.anmeldung;
    if (!a?.meta.exists) throw new Error('In Ihrem Konto liegt keine Buchhaltung, die sich laden ließe.');
    a.blob ??= await a.be.vaultDownload();
    const db = await this.vault.adoptContainer(a.blob, password);
    this.anmeldung = null;
    const c = (db.cloud && typeof db.cloud === 'object') ? db.cloud : (db.cloud = {});
    for (const k of VERBINDUNG) delete c[k];
    c.provider = a.provider;
    c.state = { [a.provider]: a.state };
    c.linkedAt = new Date().toISOString();
    c.remoteVersion = a.meta.version;
    delete c.lastSyncAt;
    this.backend = a.be;
    await this.writeBase(db);
    await this.vault.save(db);
    return db;
  }

  async nachEntsperren() {
    const v = this.mitnehmen;
    this.mitnehmen = null;
    if (!v || this.vault.isLocked) return false;
    const c = this.cfg();
    for (const k of VERBINDUNG) delete c[k];
    Object.assign(c, v);
    delete c.remoteVersion;
    delete c.lastSyncAt;
    this.backend = null;
    await this.vault.save(this.vault.db);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Basis und Abgleich                                                      */
  /* ---------------------------------------------------------------------- */

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
    const container = await this.verpacken(db);
    const up = await be.vaultUpload(container);

    c.remoteVersion = up.version;
    c.lastSyncAt = new Date().toISOString();

    try {
      await this.vielleichtSichern(container);
      delete c.cloudBackupError;
    } catch (err) {
      c.cloudBackupError = String(err?.message || err).slice(0, 300);
    }

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

    // Nicht mehr gebrauchte Belege bleiben eine Frist lang für die Sicherungen liegen.
    const c = this.cfg();
    const bisher = c.verwaisteBelege && typeof c.verwaisteBelege === 'object' ? c.verwaisteBelege : {};
    const verwaist = {};
    const jetzt = Date.now();
    for (const a of remote) {
      if (wanted.has(a.id)) continue;
      const seit = Date.parse(bisher[a.id] || '') || jetzt;
      if (jetzt - seit >= BELEG_FRIST_MS) {
        await be.attachmentRemove(a.id).catch(() => {});
        removed++;
      } else {
        verwaist[a.id] = new Date(seit).toISOString();
      }
    }
    c.verwaisteBelege = verwaist;
    return { hochgeladen: up, heruntergeladen: down, entfernt: removed };
  }

  /** Wie in der Windows-Fassung: ohne Anmeldemerkmale in die Cloud. */
  async verpacken(db) {
    const header = { ...this.vault.header, savedAt: new Date().toISOString() };
    return K.packContainer(header, await K.sealBody(this.vault.dek, fuerSicherung(db), header));
  }

  /* ---------------------------------------------------------------------- */
  /* Sicherungen in der Cloud                                                */
  /* ---------------------------------------------------------------------- */

  async sicherungAblegen(container, anlass) {
    const be = this.be();
    const res = await be.backupUpload(sicherungsName(anlass), container);
    this.cfg().lastCloudBackupAt = new Date().toISOString();
    try {
      const liste = (await be.listBackups()).sort((a, b) => b.name.localeCompare(a.name));
      for (const alt of liste.slice(SICHERUNG_BEHALTEN)) await be.backupRemove(alt.name).catch(() => {});
    } catch { /* aufgeräumt wird beim nächsten Mal */ }
    return { name: res.name, size: res.size, ...sicherungsAngaben(res.name) };
  }

  async vielleichtSichern(container) {
    const c = this.cfg();
    if (Date.now() - (Date.parse(c.lastCloudBackupAt || '') || 0) < SICHERUNG_ABSTAND_MS) return null;
    const neueste = (await this.be().listBackups())
      .map((s) => Date.parse(sicherungsAngaben(s.name)?.at || '') || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    if (Date.now() - neueste < SICHERUNG_ABSTAND_MS) {
      c.lastCloudBackupAt = new Date(neueste).toISOString();
      return null;
    }
    return this.sicherungAblegen(container, 'auto');
  }

  async sicherungen() {
    this.vault.assertUnlocked();
    return (await this.be().listBackups())
      .map((s) => ({ name: s.name, size: s.size, ...sicherungsAngaben(s.name) }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  async jetztSichern() {
    this.vault.assertUnlocked();
    const res = await this.sicherungAblegen(await this.verpacken(this.vault.db), 'manuell');
    await this.vault.save(this.vault.db);
    return res;
  }

  async sicherungEinspielen(name, password) {
    this.vault.assertUnlocked();
    if (!sicherungsAngaben(name)) throw new Error('Ungültiger Name einer Sicherung.');
    const blob = await this.be().backupDownload(name);
    const { headerBuf, body } = K.unpackContainer(blob);
    let db = null;
    try { db = await K.openBody(this.vault.dek, body, headerBuf); } catch { db = null; }

    if (db) {
      await this.vault.sicherungskopie('vor-wiederherstellung');
      await this.sicherungAblegen(await this.verpacken(this.vault.db), 'vor-wiederherstellung');
      db.cloud = this.vault.db.cloud;
      db.auditLog = journalNachEinspielen(this.vault.db.auditLog, db.auditLog);
      db.restoredAt = new Date().toISOString();
      await this.vault.save(db);
      return { state: 'eingespielt', transactions: db.transactions?.length || 0, attachments: db.attachments?.length || 0 };
    }

    if (!password) return { state: 'passwort' };
    const probe = await K.openContainer(String(password), blob); // wirft bei falschem Passwort
    K.wipe(probe.dek);
    await this.uebernehmen(blob, 'vor-wiederherstellung');
    return { state: 'uebernommen' };
  }

  /* ---------------------------------------------------------------------- */
  /* Erstverknüpfung                                                         */
  /* ---------------------------------------------------------------------- */

  /** Übernimmt den Cloud-Stand vollständig. Der hiesige Tresor wird vorher gesichert. */
  async adoptRemote() {
    this.vault.assertUnlocked();
    await this.uebernehmen(await this.be().vaultDownload(), 'vor-cloud-uebernahme');
    return true;
  }

  async uebernehmen(blob, anlass) {
    K.unpackContainer(blob); // wirft, wenn es keine gültige Datei ist
    await this.vault.sicherungskopie(anlass);
    this.mitnehmen = verbindungVon(this.cfg());
    await A.schreiben('dateien', TRESOR, blob);
    await A.loeschen('dateien', BASIS).catch(() => {});
    this.backend = null;
    this.vault.lock(); // der Schlüssel des anderen Tresors ist ein anderer
  }

  async overwriteRemote() {
    this.vault.assertUnlocked();
    const db = this.vault.db;
    const meta = await this.be().vaultMeta();
    if (meta.exists) await this.sicherungAblegen(await this.be().vaultDownload(), 'vor-ueberschreiben');
    const container = await this.verpacken(db);
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
