/**
 * Kontovia – Abgleich mit der Cloud, Web-Fassung.
 *
 * Der Ablauf in drei Schritten
 * (begin – Oberfläche führt zusammen – commit). Hochgeladen wird nur, was
 * bereits verschlüsselt ist; der Schlüssel bleibt auf dem Gerät.
 *
 * Auf dem iPhone ist der Abgleich wichtiger als am PC: Der Browser darf
 * Website-Daten bei Platzmangel räumen, und dann ist die Cloud der einzige
 * zweite Ort, an dem die Buchhaltung noch liegt.
 *
 * Sicherungen in der Cloud, die Anmeldung vor dem ersten Tresor und das
 * Mitnehmen der Geräteverbindung beim Übernehmen laufen wie in der früheren
 * früheren Windows-Fassung.
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { TRESOR } from './tresor.js';
import { FirebaseBackend } from './firebase.js';
import BUILTIN from './cloudconfig.js';
import { journalNachEinspielen, fuerSicherung, altlastenEntfernen } from './zugang.js';
import * as W from './weiterleitung.js';
import { googlePaket, googleSchluessel, googleMerken, googleVergessen, googleMerker } from './entsperrung.js';

const BASIS = 'sync-basis.bin';
const BASIS_AAD = K.utf8('kontovia/sync-basis');
const attachAad = (id) => K.utf8(`kontovia/attachment/${id}`);

const SICHERUNG_ABSTAND_MS = 20 * 60 * 60 * 1000;
const SICHERUNG_BEHALTEN = 30;
export const BELEG_FRIST_MS = 90 * 24 * 60 * 60 * 1000;
const VERBINDUNG = ['provider', 'autoSync', 'autoSyncMinutes', 'state', 'linkedAt'];

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
    if (altlastenEntfernen(db.cloud, BUILTIN.firebase)) this.backend = null;
    db.cloud.provider = 'firebase';
    return db.cloud;
  }

  /**
   * Die mitgelieferten Zugangsdaten (cloudconfig.js). Die Web-Fassung meldet
   * sich per Weiterleitung an (googleWeb) oder, als Rückfall, per Code mit
   * einem eigenen OAuth-Client (googleGeraet); die Client-ID der
   * Windows-Fassung taugt im Browser nicht.
   */
  effective() {
    return {
      provider: 'firebase',
      apiKey: BUILTIN.firebase.apiKey,
      bucket: BUILTIN.firebase.bucket,
      clientId: BUILTIN.googleGeraet?.clientId || '',
      clientSecret: BUILTIN.googleGeraet?.clientSecret || '',
    };
  }

  /** Erzeugt den Ablage-Baustein; die Prüfungen setzen hier einen nachgebildeten ein. */
  baustein(_provider, e, state) {
    return new FirebaseBackend({ apiKey: e.apiKey, bucket: e.bucket, clientId: e.clientId, clientSecret: e.clientSecret, zeigeCode: this.ui.zeigeCode }, state);
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
    const c = this.vault.db ? this.cfg() : {};
    const state = c.state?.firebase || {};
    const weiterleitung = this.weiterleitungMoeglich();
    const configured = !!(BUILTIN.firebase.apiKey && BUILTIN.firebase.bucket && (BUILTIN.googleGeraet?.clientId || weiterleitung));
    return {
      weiterleitung,
      provider: 'firebase',
      configured,
      linked: !!state.refreshToken,
      email: state.email || '',
      autoSync: c.autoSync !== false,
      autoSyncMinutes: Number(c.autoSyncMinutes ?? 15),
      lastSyncAt: c.lastSyncAt || null,
      lastRemoteVersion: c.remoteVersion || null,
      lastCloudBackupAt: c.lastCloudBackupAt || null,
      cloudBackupError: c.cloudBackupError || null,
      // Bis 1.13 auf Google Drive oder mit eigenen Zugangsdaten verbunden: neu verbinden.
      umgestellt: !state.refreshToken && c.umgestellt?.grund ? c.umgestellt.grund : null,
      lastError: this.lastError,
      busy: this.busy,
    };
  }

  /** Übernimmt die Einstellungen aus der Oberfläche: nur den zeitgesteuerten Abgleich. */
  configure({ autoSync, autoSyncMinutes }) {
    const c = this.cfg();
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
    delete this.cfg().umgestellt;
    await this.vault.save(this.vault.db);
    return res;
  }

  async disconnect({ keepRemote = true } = {}) {
    const be = this.be();
    if (!keepRemote) {
      try { await be.removeAll(); } catch { /* auch dann wird lokal getrennt */ }
    }
    // Abmelden, nicht widerrufen: Google widerriefe die Freigabe aller Geräte.
    await be.disconnect({ widerrufen: false });
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
    const moeglich = !!(f.apiKey && f.bucket && (g.clientId || weiterleitung));
    const a = this.anmeldung;
    return {
      moeglich,
      weiterleitung,
      code: !!(f.apiKey && f.bucket && g.clientId),
      provider: 'firebase',
      angemeldet: !!a,
      email: a?.state.email || '',
      vorhanden: !!a?.meta.exists,
      /** Liegt im Konto ein Schlüssel für „Mit Google entsperren“? */
      schluessel: !!a?.schluessel,
      groesse: a?.meta.size || 0,
      stand: a?.meta.updated || null,
    };
  }

  async anmelden() {
    if (await this.vault.exists()) throw new Error('In diesem Browser gibt es bereits eine Buchhaltung. Die Verbindung zu Google richten Sie in den Einstellungen ein.');
    if (!this.anmeldeStatus().moeglich) throw new Error('In dieser Fassung ist keine Anmeldung bei Google hinterlegt.');
    await this.anmeldungVerwerfen();
    const provider = 'firebase';
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
      await be.disconnect({ widerrufen: false }).catch(() => {});
      throw new Error(`Angemeldet, aber die Cloud ist nicht erreichbar: ${err.message}`);
    }
    this.anmeldung = { provider, state, be, meta, blob: null, schluessel: await this.schluesselPruefen(be) };
    return this.anmeldeStatus();
  }

  /* ---------------------------------------------------------------------- */
  /* Anmeldung per Weiterleitung (weiterleitung.js)                          */
  /* ---------------------------------------------------------------------- */

  /** Geht der Weg ohne Code? Dafür braucht es den Client für die Weiterleitung. */
  weiterleitungMoeglich() {
    return !!(BUILTIN.googleWeb?.clientId && BUILTIN.firebase?.apiKey && BUILTIN.firebase?.bucket);
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
        await be.disconnect({ widerrufen: false }).catch(() => {});
        throw new Error(`Angemeldet, aber die Cloud ist nicht erreichbar: ${err.message}`);
      }
      this.anmeldung = { provider: 'firebase', state, be, meta, blob: null, zweck: antwort.zweck, schluessel: await this.schluesselPruefen(be) };
      this.meldung.email = state.email || antwort.email || '';
    } catch (err) {
      this.meldung.fehler = err.message;
    }
  }

  /** Nach dem Entsperren: eine eben per Weiterleitung erfolgte Anmeldung mit diesem Tresor verbinden. */
  async anmeldungVerbinden() {
    const a = this.anmeldung;
    if (!a || !['verbinden', 'entsperren'].includes(a.zweck) || this.vault.isLocked) return false;
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
    if (a?.schluessel) K.wipe(a.schluessel);
    if (a) await a.be.disconnect({ widerrufen: false }).catch(() => {});
    return true;
  }

  async anmeldungEintragen() {
    const a = this.anmeldung;
    if (!a || this.vault.isLocked) return false;
    this.anmeldung = null;
    if (a.meta.exists) { await a.be.disconnect({ widerrufen: false }).catch(() => {}); return false; }
    const c = this.cfg();
    c.provider = a.provider;
    c.state = { [a.provider]: a.state };
    c.linkedAt = new Date().toISOString();
    this.backend = a.be;
    await this.vault.save(this.vault.db);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Mit Google entsperren (entsperrung.js)                                  */
  /* ---------------------------------------------------------------------- */

  /** Der Datenschlüssel aus dem Konto, wenn es ihn gibt; Fehler beim Lesen heißen „gibt es nicht“. */
  async schluesselPruefen(be) {
    try {
      const bytes = await be.schluesselLesen();
      return bytes ? googleSchluessel(bytes) : null;
    } catch { return null; }
  }

  /** Nach der Anmeldung bei Google, bei vorhandenem Tresor: den Schlüssel aus dem Konto übergeben (einmal). */
  schluesselUebergeben() {
    const a = this.anmeldung;
    if (!a?.schluessel) return null;
    const dek = a.schluessel;
    a.schluessel = null;
    return dek;
  }

  /** Erster Start: die Buchhaltung aus der Cloud laden, ohne Passwort, mit dem Schlüssel aus dem Konto. */
  async ausCloudLadenOhnePasswort() {
    const a = this.anmeldung;
    if (!a?.meta.exists) throw new Error('In Ihrem Konto liegt keine Buchhaltung, die sich laden ließe.');
    const dek = this.schluesselUebergeben();
    if (!dek) throw Object.assign(new Error('Für dieses Konto ist das Öffnen ohne Passwort nicht eingeschaltet. Bitte geben Sie das Passwort ein.'), { code: 'KEIN_SCHLUESSEL' });
    a.blob ??= await a.be.vaultDownload();
    return this.ausCloudUebernehmen(a, (blob) => this.vault.adoptContainerWithKey(blob, dek));
  }

  /** Legt den Datenschlüssel in das verbundene Google-Konto (Einstellungen → Sicherheit). */
  async googleEinrichten() {
    this.vault.assertUnlocked();
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken) throw Object.assign(new Error('Dazu muss Kontovia mit Ihrem Google-Konto verbunden sein.'), { code: 'NICHT_VERBUNDEN' });
    await this.be().schluesselSchreiben(googlePaket(this.vault.dek));
    await googleMerken(st.email);
    return true;
  }

  async googleEntfernen() {
    this.vault.assertUnlocked();
    if (this.cfg().state?.firebase?.refreshToken) await this.be().schluesselLoeschen();
    await googleVergessen();
    return true;
  }

  /** Ist der Schlüssel im verbundenen Konto hinterlegt? */
  async googleStatus() {
    const merker = await googleMerker();
    if (this.vault.isLocked) return { eingerichtet: !!merker, email: merker?.email || '' };
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken) return { eingerichtet: false, verbunden: false, email: '' };
    const dek = await this.schluesselPruefen(this.be());
    const da = !!dek;
    if (dek) K.wipe(dek);
    return { eingerichtet: da, verbunden: true, email: st.email || '' };
  }

  /** Nach dem Entsperren mit dem Passwort: hat sich der Schlüssel geändert (etwa nach einer Sicherung), im Konto erneuern. */
  async googleAuffrischen() {
    if (this.vault.isLocked || !(await googleMerker())) return false;
    if (!this.cfg().state?.firebase?.refreshToken) return false;
    const be = this.be();
    const alt = await this.schluesselPruefen(be);
    const gleich = alt && alt.length === this.vault.dek.length && alt.every((b, i) => b === this.vault.dek[i]);
    if (alt) K.wipe(alt);
    if (gleich) return false;
    await be.schluesselSchreiben(googlePaket(this.vault.dek));
    return true;
  }

  async ausCloudLaden(password) {
    const a = this.anmeldung;
    if (!a?.meta.exists) throw new Error('In Ihrem Konto liegt keine Buchhaltung, die sich laden ließe.');
    a.blob ??= await a.be.vaultDownload();
    return this.ausCloudUebernehmen(a, (blob) => this.vault.adoptContainer(blob, password));
  }

  /** Gemeinsam für beide Wege: den geladenen Tresor öffnen (Passwort oder Schlüssel) und diese Verbindung eintragen. */
  async ausCloudUebernehmen(a, oeffnen) {
    const db = await oeffnen(a.blob);
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
    if (!this.pending) throw new Error('Kein laufender Abgleich. Bitte erneut starten.');
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

  /** Wie früher unter Windows: ohne Anmeldemerkmale in die Cloud. */
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
