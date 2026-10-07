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
 * Windows-Fassung.
 *
 * Seit 2.26 ist der Cloud-Stand ein Abbild der Datenbank (v2/tresor.kv). Liegt
 * nur die alte Datei tresor.kv da, stellt der erste Abgleich um: alten Stand
 * sichern, neue Datei hochladen, zurücklesen, erst dann die alte löschen.
 * Schreibt ein Gerät mit älterer Fassung später wieder nach tresor.kv, wird
 * das übernommen und wieder abgeräumt (docs/sql-umstellung.md 7).
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { TRESOR } from './tresor.js';
import { FirebaseBackend, BACKUP_RE } from './firebase.js';
import BUILTIN from './cloudconfig.js';
import { journalNachEinspielen, fuerSicherung, altlastenEntfernen } from './zugang.js';
import { zerlegen, zusammensetzen, JOURNAL, JOURNAL_FENSTER } from './sqlschema.js';
import * as W from './weiterleitung.js';
import * as KP from './koppeln.js';
import * as Z from './zulassung.js';
import { googlePaket, googleSchluessel, googleMerken, googleVergessen, googleMerker, googleAnzeige, googleAnzeigeSetzen, biometrieEntfernen } from './entsperrung.js';

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

/**
 * Name einer Sicherung, wie die Oberfläche ihn sieht: Abbilder seit 2.26 ohne
 * Vorsatz, ältere mit „alt/“, der Stand vor der Umstellung mit „umstellung/“.
 */
export function sicherungsTeile(name) {
  const m = /^(?:(alt|umstellung)\/)?([^/]+)$/.exec(String(name));
  if (!m || !BACKUP_RE.test(m[2])) return null;
  return { ort: m[1] || 'v2', datei: m[2] };
}

export function sicherungsAngaben(name) {
  const t = sicherungsTeile(name);
  const m = t && /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z_([a-z-]+)\.kv$/.exec(t.datei);
  return m ? { at: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`, anlass: m[5], ort: t.ort } : null;
}

function gleicheBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
    /** Weiteres Gerät koppeln: auf dem offenen Gerät (Geber) und auf dem neuen (Abbruchschalter). */
    this.geber = null;
    this.koppelnAbbruch = null;
    /** Wann lag der lokale Stand zuletzt gesichert in der Cloud, wann wurde zuletzt lokal etwas geändert (zulassung.js)? */
    this.abgeglichenUm = 0;
    this.lokalGeaendertUm = 0;
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
      let alles = true;
      try { await be.removeAll(); } catch { alles = false; /* auch dann wird lokal getrennt */ }
      // Wer alles löschen lässt, will auch seine Anmeldedaten (E-Mail-Adresse) los sein, aber nur,
      // wenn die Ablage wirklich leer ist: Ohne die Anmeldung ließe sich ein Rest nicht mehr entfernen.
      if (alles && typeof be.kontoLoeschen === 'function') { try { await be.kontoLoeschen(); } catch { /* bleibt auf Anfrage beim Betreiber */ } }
    }
    // Abmelden, nicht widerrufen: Google widerriefe die Freigabe aller Geräte.
    await be.disconnect({ widerrufen: false });
    const c = this.cfg();
    delete c.remoteVersion;
    delete c.lastSyncAt;
    this.backend = null;
    await A.loeschen('dateien', BASIS).catch(() => {});
    // Ohne Verbindung gibt es nichts zu bestätigen: Die Frist der Zulassung endet damit, ein offener Code ebenso.
    await Z.vergessen();
    await this.koppelnAbbrechen().catch(() => {});
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
    a.blob ??= await a.be.vaultDownload(undefined, a.meta.fassung);
    return this.ausCloudUebernehmen(a, (blob) => this.vault.adoptContainerWithKey(blob, dek));
  }

  /** Legt den Datenschlüssel in das verbundene Google-Konto (Einstellungen → Sicherheit). */
  async googleEinrichten() {
    this.vault.assertUnlocked();
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken) throw Object.assign(new Error('Dazu muss Kontovia mit Ihrem Google-Konto verbunden sein.'), { code: 'NICHT_VERBUNDEN' });
    await this.be().schluesselSchreiben(googlePaket(this.vault.dek));
    await googleMerken(st.email);
    await googleAnzeigeSetzen(true);
    return true;
  }

  async googleEntfernen() {
    this.vault.assertUnlocked();
    if (this.cfg().state?.firebase?.refreshToken) await this.be().schluesselLoeschen();
    await googleVergessen();
    await googleAnzeigeSetzen(false);
    return true;
  }

  /**
   * Ist der Schlüssel im verbundenen Konto hinterlegt? Gesperrt zählt, was dieses Gerät
   * weiß: eingeschaltet (Merker oder Anzeige) oder ungeprüft (Bestand vor 2.25.1).
   */
  async googleStatus() {
    const merker = await googleMerker();
    if (this.vault.isLocked) {
      const anzeige = await googleAnzeige();
      return { eingerichtet: !!merker || anzeige === true, ungeprueft: !merker && anzeige === undefined, email: merker?.email || '' };
    }
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken) return { eingerichtet: false, verbunden: false, email: '' };
    const dek = await this.schluesselPruefen(this.be());
    const da = !!dek;
    if (dek) K.wipe(dek);
    return { eingerichtet: da, verbunden: true, email: st.email || '' };
  }

  /**
   * Nach jedem Entsperren: den Schlüssel im Konto mit diesem Tresor vergleichen.
   * - passt: der Sperrbildschirm zeigt „Mit Google entsperren“.
   * - veraltet (etwa nach einer Sicherung) und auf diesem Gerät eingeschaltet (Merker): im Konto erneuern.
   * - fehlt sicher (anderswo ausgeschaltet): nie neu anlegen, Merker weg, Knopf weg.
   * - ließ sich nicht lesen (Netz, Anmeldung): nichts ändern.
   * Nie verbunden gewesen: Mit Google lässt sich dieser Tresor nicht öffnen, Knopf weg.
   * @returns {Promise<boolean>} true, wenn der Schlüssel im Konto erneuert wurde
   */
  async googleAuffrischen() {
    if (this.vault.isLocked) return false;
    const merker = await googleMerker();
    const c = this.cfg();
    if (!c.state?.firebase?.refreshToken) {
      if (!merker && !c.linkedAt) await googleAnzeigeSetzen(false);
      return false;
    }
    const be = this.be();
    let bytes;
    try { bytes = await be.schluesselLesen(); } catch { return false; }
    const alt = bytes ? googleSchluessel(bytes) : null;
    const dek = this.vault.dek;
    const gleich = !!alt && alt.length === dek.length && alt.every((b, i) => b === dek[i]);
    if (alt) K.wipe(alt);
    if (gleich) { await googleAnzeigeSetzen(true); return false; }
    if (merker && bytes) {
      await be.schluesselSchreiben(googlePaket(dek));
      await googleAnzeigeSetzen(true);
      return true;
    }
    if (merker) await googleVergessen().catch(() => {});
    await googleAnzeigeSetzen(false);
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* Befristete Zulassung (zulassung.js)                                     */
  /* ---------------------------------------------------------------------- */

  /** Hat sich lokal etwas geändert? Dann gilt der Stand erst nach dem nächsten Abgleich wieder als gesichert. */
  lokalGeaendert() {
    this.lokalGeaendertUm = Date.now();
  }

  /** Der Stand für die Anzeige. Geht auch gesperrt: Er stammt aus dem Merkbuch außerhalb des Tresors. */
  async zulassungStatus() {
    const rec = await Z.lesen();
    const verbunden = this.vault.db ? !!this.cfg().state?.firebase?.refreshToken : !!rec?.uid;
    if (!verbunden && !rec?.lokalGesperrt) return { aktiv: false, zustand: 'aus', stufe: 0 };
    return { aktiv: verbunden, ...Z.stand(rec) };
  }

  /**
   * Fragt den Cloud-Speicher, ob dieses Konto noch zugelassen ist. Löscht nie selbst.
   * @returns {Promise<object>} der Stand, dazu `aktion` ('loeschen' erst nach zweifach bestätigter Sperre)
   *   und `netz` (true: der Speicher war nicht erreichbar)
   */
  async zulassungPruefen() {
    this.vault.assertUnlocked();
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken || !st.uid) return { aktiv: false, zustand: 'aus', stufe: 0, aktion: 'nichts', netz: false };
    const antwort = await this.be().zulassungLesen();
    const r = Z.verarbeiten(await Z.lesen(), st.uid, antwort, Date.now());
    await Z.schreiben(r.rec);
    return { aktiv: true, ...Z.stand(r.rec), aktion: r.aktion, netz: antwort.art === 'netz', antwort: antwort.art };
  }

  /** Liegt der lokale Stand gesichert in der Cloud? Nur dann darf etwas gelöscht werden. */
  async zulassungAbgesichert() {
    try {
      const meta = await this.be().vaultMeta();
      const c = this.cfg();
      if (!meta?.exists || !c.remoteVersion || meta.version !== c.remoteVersion) return false;
      return this.abgeglichenUm > 0 && this.abgeglichenUm >= this.lokalGeaendertUm;
    } catch { return false; }
  }

  /**
   * Letzte Prüfung vor dem Löschen: Die Sperre muss jetzt noch gelten und zweifach bestätigt
   * sein, und die Buchhaltung muss gesichert in der Cloud liegen.
   * @returns {Promise<{erlaubt:boolean, grund?:string}>}
   */
  async zulassungFreigabe() {
    this.vault.assertUnlocked();
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken || !st.uid) return { erlaubt: false, grund: 'nicht-verbunden' };
    const antwort = await this.be().zulassungLesen();
    if (antwort.art !== 'gesperrt' || !(antwort.serverZeit > 0)) return { erlaubt: false, grund: 'nicht-mehr-gesperrt' };
    const rec = await Z.lesen();
    const b = rec?.uid === st.uid ? rec.beobachtet || [] : [];
    if (!(b.length >= 2 && b[b.length - 1] - b[0] >= Z.BEOBACHTUNG_ABSTAND_MS)) return { erlaubt: false, grund: 'nicht-bestaetigt' };
    if (!await this.zulassungAbgesichert()) return { erlaubt: false, grund: 'nicht-gesichert' };
    return { erlaubt: true };
  }

  /**
   * Das Gerät sperren, statt zu löschen: Cloud-Verbindung, Fingerabdruck und Google-Zugang
   * dieses Geräts entfernen. Die verschlüsselte Datei bleibt, das Passwort öffnet sie weiter.
   */
  async zulassungSperren() {
    this.vault.assertUnlocked();
    await this.disconnect({ keepRemote: true });
    await biometrieEntfernen().catch(() => {});
    await googleVergessen().catch(() => {});
    await googleAnzeigeSetzen(false);
    await Z.schreiben({ v: 1, lokalGesperrt: { seit: new Date().toISOString() } });
    return Z.stand(await Z.lesen());
  }

  /* ---------------------------------------------------------------------- */
  /* Weiteres Gerät koppeln (koppeln.js)                                     */
  /* ---------------------------------------------------------------------- */

  /** Auf dem offenen Gerät: einen Code erzeugen, der ein neues Gerät mit demselben Google-Konto freischaltet. */
  async koppelnStart() {
    this.vault.assertUnlocked();
    const st = this.cfg().state?.firebase || {};
    if (!st.refreshToken || !st.uid) throw Object.assign(new Error('Dazu muss Kontovia mit Ihrem Google-Konto verbunden sein.'), { code: 'NICHT_VERBUNDEN' });
    await this.koppelnAbbrechen();
    const be = this.be();
    const geber = new KP.Geber({ backend: be, uid: st.uid, dekHolen: () => { this.vault.assertUnlocked(); return this.vault.dek; } });
    const r = await geber.starten();
    this.geber = geber;
    KP.aufraeumen(be).catch(() => {});
    return { adresse: KP.kopplungsAdresse(W.rueckAdresse(globalThis.location?.href || 'https://kontovia.invalid/'), r.code), anzeige: KP.codeAnzeige(r.code), gueltigBis: r.gueltigBis };
  }

  /** Meldet sich ein Gerät? Nach dem Abschluss wird es in die Liste dieses Geräts eingetragen. */
  async koppelnAbfragen() {
    const g = this.geber;
    if (!g) return { zustand: 'keiner' };
    const s = await g.abfragen();
    if (s.zustand === 'fertig' && !g.eingetragen && !this.vault.isLocked) {
      g.eingetragen = true;
      return { ...s, geraet: await this.koppelnEintragen(s.name) };
    }
    return s;
  }

  /** Trägt ein verbundenes Gerät in die Liste dieses Geräts ein. Das Speichern darf das Verbinden nie nachträglich scheitern lassen. */
  async koppelnEintragen(name) {
    const c = this.cfg();
    const eintrag = { id: K.toHex(K.randomBytes(6)), name: KP.geraeteNameBereinigen(name), seit: new Date().toISOString() };
    c.gekoppelt = [...(Array.isArray(c.gekoppelt) ? c.gekoppelt : []), eintrag].slice(-20);
    try { await this.vault.save(this.vault.db); } catch { /* bleibt im Speicher und geht mit dem nächsten Speichern mit */ }
    return eintrag;
  }

  /**
   * Der Nutzer sagt, dass das neue Gerät trotz Fehlermeldung verbunden ist: in die Liste aufnehmen.
   * Zweimal derselbe Name kurz hintereinander ergibt nur einen Eintrag.
   */
  async koppelnVermerken(name) {
    this.vault.assertUnlocked();
    const sauber = KP.geraeteNameBereinigen(name);
    const c = this.cfg();
    const vorhanden = (Array.isArray(c.gekoppelt) ? c.gekoppelt : []).find((e) => e.name === sauber && Date.now() - Date.parse(e.seit) < 10 * 60 * 1000);
    return vorhanden ? { id: String(vorhanden.id), name: String(vorhanden.name), seit: String(vorhanden.seit) } : this.koppelnEintragen(sauber);
  }

  /** Das Gerät ist erkannt: den Datenschlüssel für genau dieses Gerät ablegen. */
  async koppelnBestaetigen() {
    this.vault.assertUnlocked();
    if (!this.geber) throw Object.assign(new Error('Es läuft gerade keine Kopplung.'), { code: 'KOPPELN_ZUSTAND' });
    return this.geber.bestaetigen();
  }

  /** Abbruch, „Das bin nicht ich“, Sperren: alles löschen, das Geheimnis überschreiben. */
  async koppelnAbbrechen() {
    const g = this.geber;
    this.geber = null;
    if (g) await g.beenden('abgebrochen');
    return true;
  }

  /** Angeschlossene Geräte (nur die Liste dieses Geräts; sie entscheidet über nichts). */
  koppelnGeraete() {
    const c = this.vault.db ? this.cfg() : {};
    return (Array.isArray(c.gekoppelt) ? c.gekoppelt : []).map((e) => ({ id: String(e.id), name: String(e.name), seit: String(e.seit) }));
  }

  async koppelnGeraetEntfernen(id) {
    this.vault.assertUnlocked();
    const c = this.cfg();
    const vorher = this.koppelnGeraete();
    const weg = vorher.find((e) => e.id === String(id));
    c.gekoppelt = vorher.filter((e) => e.id !== String(id));
    await this.vault.save(this.vault.db);
    return weg || null;
  }

  /** Liegengebliebene Pakete aus früheren Versuchen entfernen (beim Entsperren). */
  async koppelnAufraeumen() {
    const st = this.vault.db ? this.cfg().state?.firebase : null;
    if (!st?.refreshToken) return 0;
    // Nicht bei jedem Abgleich nachsehen: alle zehn Minuten genügt.
    if (Date.now() - (this.aufgeraeumtUm || 0) < 10 * 60 * 1000) return 0;
    this.aufgeraeumtUm = Date.now();
    return KP.aufraeumen(this.be());
  }

  /**
   * Auf dem neuen Gerät, nach der Anmeldung bei Google: mit dem Code vom anderen Gerät
   * den Datenschlüssel holen und die Buchhaltung laden. Kehrt erst zurück, wenn das
   * andere Gerät bestätigt hat (oder die Zeit um ist).
   */
  async koppelnVerbinden({ code, name }) {
    const a = this.anmeldung;
    if (!a?.meta.exists) throw new Error('In Ihrem Konto liegt keine Buchhaltung, die sich laden ließe.');
    if (this.koppelnAbbruch) this.koppelnAbbruch.abort();
    const abbruch = new AbortController();
    this.koppelnAbbruch = abbruch;
    let dek;
    try {
      dek = await KP.verbinden({ backend: a.be, uid: a.state.uid, code, name, abbruch: abbruch.signal });
    } finally {
      if (this.koppelnAbbruch === abbruch) this.koppelnAbbruch = null;
    }
    if (a.schluessel) K.wipe(a.schluessel);
    a.schluessel = dek;
    let db;
    try {
      db = await this.ausCloudLadenOhnePasswort();
    } catch (err) {
      K.wipe(dek);
      throw err;
    }
    this.cfg().geraeteName = KP.geraeteNameBereinigen(name);
    await this.vault.save(this.vault.db);
    return db;
  }

  koppelnVerbindenAbbrechen() {
    this.koppelnAbbruch?.abort();
    return true;
  }

  async ausCloudLaden(password) {
    const a = this.anmeldung;
    if (!a?.meta.exists) throw new Error('In Ihrem Konto liegt keine Buchhaltung, die sich laden ließe.');
    a.blob ??= await a.be.vaultDownload(undefined, a.meta.fassung);
    return this.ausCloudUebernehmen(a, (blob) => this.vault.adoptContainer(blob, password));
  }

  /** Gemeinsam für beide Wege: den geladenen Tresor öffnen (Passwort oder Schlüssel) und diese Verbindung eintragen. */
  async ausCloudUebernehmen(a, oeffnen) {
    const db = await oeffnen(a.blob);
    this.anmeldung = null;
    const c = (db.cloud && typeof db.cloud === 'object') ? db.cloud : (db.cloud = {});
    for (const k of VERBINDUNG) delete c[k];
    delete c.gekoppelt;
    delete c.geraeteName;
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

  /** Die Basis des Abgleichs: seit 2.26 ein Abbild der Datenbank (ohne Journal), davor JSON. */
  async readBase() {
    try {
      const blob = await A.lesen('dateien', BASIS);
      if (!blob) return null;
      const roh = await K.open(this.vault.dek, blob, BASIS_AAD);
      if (K.istAbbild(roh)) return zusammensetzen((await this.vault.motor.abbildLesen(roh, { fenster: 1 })).zf);
      return JSON.parse(K.fromUtf8(roh));
    } catch {
      return null;
    }
  }

  async writeBase(db) {
    // Das Journal braucht die Basis nicht (merge.js vereinigt es ohne sie).
    const zf = zerlegen(db);
    if (zf.tabellen[JOURNAL]) zf.tabellen[JOURNAL] = [];
    const abbild = await this.vault.motor.abbildAusZeilen(zf);
    await A.schreiben('dateien', BASIS, await K.seal(this.vault.dek, abbild, BASIS_AAD));
  }

  /**
   * Öffnet einen Stand aus der Cloud mit dem Schlüssel dieses Tresors (Format 1
   * oder 2). Sein Journal geht dabei vollständig in die Datenbank dieses Geräts
   * (nur anfügen); die Oberfläche bekommt die neuesten Einträge. Wirft, wenn der
   * Stand zu einer anderen Buchhaltung gehört.
   */
  async standOeffnen(blob) {
    const c = K.unpackContainer(blob);
    if (c.version === K.FORMAT_VERWEIS) throw new Error('Ein Verweis gehört nicht in die Cloud.');
    const inhalt = await K.inhaltOeffnen(this.vault.dek, c);
    if (inhalt.data) {
      await this.vault.journalErgaenzen(inhalt.data[JOURNAL]);
      return inhalt.data;
    }
    const r = await this.vault.motor.abbildLesen(inhalt.abbild, { fenster: JOURNAL_FENSTER, journalUebernehmen: true });
    this.vault.journalGesamt += r.uebernommen || 0;
    return zusammensetzen(r.zf);
  }

  /**
   * Die alte Datei (tresor.kv) neben der neuen: von einem Gerät mit älterer
   * Fassung (bis 2.25), das die neue nicht kennt. Gehört sie zu einer anderen
   * Buchhaltung, bleibt sie unberührt (und wird nicht bei jedem Abgleich neu geladen).
   * @returns {Promise<{version:string, blob:Uint8Array, db:object}|null>}
   */
  async altPruefen(be) {
    const m = await be.altMeta();
    const c = this.cfg();
    if (!m.exists) { delete c.fremdeAltdatei; return null; }
    if (c.fremdeAltdatei === m.version) return null;
    const blob = await be.altDownload();
    try {
      return { version: m.version, blob, db: await this.standOeffnen(blob) };
    } catch {
      c.fremdeAltdatei = m.version;
      return null;
    }
  }

  /**
   * Der Stand der alten Datei zum Zeitpunkt der Umstellung (Sicherung
   * „vor-umstellung“): Gegenstück, um bei einem Gerät mit älterer Fassung
   * Geändertes von Veraltetem zu unterscheiden (merge.js: nachzueglerEinarbeiten).
   */
  async umstellungsBasis(be) {
    try {
      const liste = (await be.listBackups('umstellung'))
        .filter((s) => sicherungsAngaben(s.name)?.anlass === 'vor-umstellung')
        .sort((a, b) => b.name.localeCompare(a.name));
      if (!liste.length) return null;
      const c = K.unpackContainer(await be.backupDownload(liste[0].name, 'umstellung'));
      const inhalt = await K.inhaltOeffnen(this.vault.dek, c);
      return inhalt.data || zusammensetzen((await this.vault.motor.abbildLesen(inhalt.abbild, { fenster: 1 })).zf);
    } catch {
      return null;
    }
  }

  /**
   * Holt den Cloud-Stand. Rückgabe wie in der Windows-Fassung:
   *   leer | aktuell | bereit (mit remote und base) | fremd
   * Liegt nur die alte Datei vor (vor der Umstellung), ist sie der Cloud-Stand;
   * commit() stellt dann um. Liegt neben der neuen noch die alte (ein Gerät mit
   * älterer Fassung hat geschrieben), kommt sie als `nachzuegler` mit.
   */
  async begin({ force = false, dirty = true } = {}) {
    this.vault.assertUnlocked();
    const be = this.be();
    const c = this.cfg();

    const meta = await be.vaultMeta();
    if (!meta.exists) {
      this.pending = { remoteVersion: null, hadRemote: false, fassung: 2 };
      return { state: 'leer' };
    }
    const alt = meta.fassung === 2 ? await this.altPruefen(be) : null;

    // Kostenbremse: drüben unverändert und hier nichts Neues – nicht laden.
    if (!force && meta.version && meta.version === c.remoteVersion && !dirty && !alt) {
      this.pending = null;
      this.abgeglichenUm = Date.now();
      return { state: 'aktuell', remoteVersion: meta.version };
    }

    const blob = await be.vaultDownload(undefined, meta.fassung);
    let remote;
    try {
      remote = await this.standOeffnen(blob);
    } catch {
      this.pending = null;
      return { state: 'fremd', modifiedTime: meta.updated, size: meta.size };
    }

    this.pending = {
      remoteVersion: meta.version,
      hadRemote: true,
      fassung: meta.fassung,
      // Umstellung: die alte Datei, so wie sie hier gelesen wurde.
      alt: meta.fassung === 1 ? { version: meta.version, blob } : alt ? { version: alt.version, blob: alt.blob, nachzuegler: true } : null,
    };
    const out = { state: 'bereit', remote, base: await this.readBase(), remoteVersion: meta.version };
    if (alt) {
      out.nachzuegler = alt.db;
      out.nachzueglerBasis = await this.umstellungsBasis(be);
    }
    return out;
  }

  async commit(db, onProgress = () => {}) {
    this.vault.assertUnlocked();
    if (!this.pending) throw new Error('Kein laufender Abgleich. Bitte erneut starten.');
    // Was ab jetzt lokal geändert wird, ist nicht mehr im Hochgeladenen.
    const gesichertStand = Date.now();
    const be = this.be();
    const p = this.pending;

    const now = await be.vaultMeta();
    if (p.hadRemote ? (now.exists && now.version !== p.remoteVersion) : now.exists) {
      this.pending = null;
      const e = new Error('Ein anderes Gerät hat währenddessen gespeichert.');
      e.code = 'RETRY';
      throw e;
    }

    // Maßgeblich ist der eigene Cloud-Block – dort stehen Anmeldemerkmal und Abgleichstand.
    db.cloud = this.vault.db?.cloud || db.cloud || {};
    const c = db.cloud;

    await this.vault.save(db);

    // Umstellung: Den Stand der alten Datei sichern, bevor die neue entsteht.
    // Er bleibt immer liegen (Gegenstück für Geräte mit älterer Fassung).
    if (p.fassung === 1 && p.alt) await this.altSichern(p.alt, 'vor-umstellung');

    onProgress({ phase: 'tresor' });
    const container = await this.verpacken();
    const up = await be.vaultUpload(container);
    if (Number(up.size) !== container.length) throw new Error('Das Hochladen ist unvollständig angekommen. Bitte noch einmal abgleichen.');

    c.remoteVersion = up.version;
    c.lastSyncAt = new Date().toISOString();

    // Die alte Datei erst abräumen, wenn die neue geprüft in der Cloud liegt.
    if (p.alt) {
      try {
        await this.altAbraeumen(container, p.alt);
        delete c.umstellungFehler;
      } catch (err) {
        c.umstellungFehler = String(err?.message || err).slice(0, 300);
      }
    }

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
    this.abgeglichenUm = gesichertStand;
    return { remoteVersion: up.version, bytes: container.length, attachments };
  }

  /** Legt den Stand der alten Datei unter v2/umstellung/ ab und prüft ihn durch Zurücklesen. */
  async altSichern(alt, anlass) {
    const be = this.be();
    const name = sicherungsName(anlass);
    await be.backupUpload(name, alt.blob, 'umstellung');
    if (!gleicheBytes(await be.backupDownload(name, 'umstellung'), alt.blob)) {
      throw new Error('Die Sicherung der alten Datei ist nicht vollständig in der Cloud angekommen.');
    }
    return name;
  }

  /**
   * Die Reihenfolge der Umstellung: 1. hochladen (commit), 2. warten, bis das
   * Hochladen erfolgreich ist: die neue Datei zurücklesen, Byte für Byte
   * vergleichen und öffnen, 3. erst dann die alte Datei löschen, und nur, wenn
   * sie seit dem Lesen niemand verändert hat (sonst beim nächsten Abgleich).
   */
  async altAbraeumen(container, alt) {
    const be = this.be();
    const zurueck = await be.vaultDownload(undefined, 2);
    if (!gleicheBytes(zurueck, container)) throw new Error('Die neue Datei in der Cloud weicht vom Hochgeladenen ab; die alte bleibt.');
    const c = K.unpackContainer(zurueck);
    await this.vault.motor.abbildLesen(await K.openAbbild(this.vault.dek, c.body, c.headerBuf), { fenster: 1 });
    const vorher = await be.altMeta();
    if (!vorher.exists) return false;
    if (vorher.version !== alt.version) return false;
    if (alt.nachzuegler) await this.altSichern(alt, 'nachzuegler');
    const jetzt = await be.altMeta();
    if (!jetzt.exists || jetzt.version !== alt.version) return false;
    await be.altLoeschen();
    this.cfg().cloudUmgestellt ??= new Date().toISOString();
    return true;
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

  /**
   * Der Stand für die Cloud: ein Abbild der Datenbank dieses Geräts (mit dem
   * ganzen Journal), wie früher unter Windows ohne Anmeldemerkmale.
   */
  async verpacken() {
    await this.vault.saving?.catch(() => {});
    const header = { ...this.vault.header, savedAt: new Date().toISOString() };
    // Was zu diesem Gerät gehört (Liste verbundener Geräte, eigener Gerätename), geht nicht in den gemeinsamen Stand.
    const werte = {};
    const stand = fuerSicherung({ cloud: this.vault.db?.cloud });
    if (stand?.cloud && typeof stand.cloud === 'object') {
      const { gekoppelt, geraeteName, ...rest } = stand.cloud;
      void gekoppelt; void geraeteName;
      werte.cloud = JSON.stringify(rest);
    }
    const abbild = await this.vault.motor.abbild({ werte });
    return K.packContainer(header, await K.sealAbbild(this.vault.dek, abbild, header), K.FORMAT_ABBILD);
  }

  /* ---------------------------------------------------------------------- */
  /* Sicherungen in der Cloud                                                */
  /* ---------------------------------------------------------------------- */

  async sicherungAblegen(container, anlass) {
    const be = this.be();
    const res = await be.backupUpload(sicherungsName(anlass), container, 'v2');
    this.cfg().lastCloudBackupAt = new Date().toISOString();
    try {
      const liste = (await be.listBackups('v2')).sort((a, b) => b.name.localeCompare(a.name));
      for (const alt of liste.slice(SICHERUNG_BEHALTEN)) await be.backupRemove(alt.name, 'v2').catch(() => {});
    } catch { /* aufgeräumt wird beim nächsten Mal */ }
    return { name: res.name, size: res.size, ...sicherungsAngaben(res.name) };
  }

  async vielleichtSichern(container) {
    const c = this.cfg();
    if (Date.now() - (Date.parse(c.lastCloudBackupAt || '') || 0) < SICHERUNG_ABSTAND_MS) return null;
    const neueste = (await this.be().listBackups('v2'))
      .map((s) => Date.parse(sicherungsAngaben(s.name)?.at || '') || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    if (Date.now() - neueste < SICHERUNG_ABSTAND_MS) {
      c.lastCloudBackupAt = new Date(neueste).toISOString();
      return null;
    }
    return this.sicherungAblegen(container, 'auto');
  }

  /** Alle Sicherungen: die seit 2.26, die älteren und den Stand vor der Umstellung. */
  async sicherungen() {
    this.vault.assertUnlocked();
    const be = this.be();
    const out = [];
    for (const [ort, vorsatz] of [['v2', ''], ['alt', 'alt/'], ['umstellung', 'umstellung/']]) {
      let liste = [];
      try { liste = await be.listBackups(ort); } catch (err) { if (ort === 'v2') throw err; }
      for (const s of liste) out.push({ name: vorsatz + s.name, size: s.size, ...sicherungsAngaben(vorsatz + s.name) });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.name.localeCompare(a.name));
  }

  async jetztSichern() {
    this.vault.assertUnlocked();
    const res = await this.sicherungAblegen(await this.verpacken(), 'manuell');
    await this.vault.save(this.vault.db);
    return res;
  }

  async sicherungEinspielen(name, password) {
    this.vault.assertUnlocked();
    const t = sicherungsTeile(name);
    if (!t) throw new Error('Ungültiger Name einer Sicherung.');
    const blob = await this.be().backupDownload(t.datei, t.ort);
    const c = K.unpackContainer(blob);
    if (c.version === K.FORMAT_VERWEIS) throw new Error('Diese Datei ist keine Sicherung.');
    let db = null;
    try {
      const inhalt = await K.inhaltOeffnen(this.vault.dek, c);
      db = inhalt.data || zusammensetzen((await this.vault.motor.abbildLesen(inhalt.abbild)).zf);
    } catch { db = null; }

    if (db) {
      await this.vault.sicherungskopie('vor-wiederherstellung');
      await this.sicherungAblegen(await this.verpacken(), 'vor-wiederherstellung');
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
    const be = this.be();
    const meta = await be.vaultMeta();
    if (!meta.exists) throw new Error('In der Cloud liegt keine Buchhaltung.');
    await this.uebernehmen(await be.vaultDownload(undefined, meta.fassung), 'vor-cloud-uebernahme');
    return true;
  }

  async uebernehmen(blob, anlass) {
    // Wirft, wenn es keine gültige Datei ist; ein Verweis gehört nie in die Cloud.
    if (K.unpackContainer(blob).version === K.FORMAT_VERWEIS) throw new Error('Diese Datei lässt sich nicht übernehmen.');
    await this.vault.sicherungskopie(anlass);
    this.mitnehmen = verbindungVon(this.cfg());
    await this.vault.saving?.catch(() => {});
    await A.schreiben('dateien', TRESOR, blob);
    await A.loeschen('dateien', BASIS).catch(() => {});
    this.backend = null;
    this.vault.lock(); // der Schlüssel des anderen Tresors ist ein anderer
  }

  /**
   * Auf ausdrücklichen Wunsch: den Stand dieses Geräts in die Cloud schreiben.
   * Was dort lag, kommt vorher in die Sicherungen; eine alte Datei aus der Zeit
   * vor 2.26, die sich gesichert hat, wird danach entfernt.
   */
  async overwriteRemote() {
    this.vault.assertUnlocked();
    const be = this.be();
    const db = this.vault.db;
    const meta = await be.vaultMeta();
    if (meta.exists) await this.sicherungAblegen(await be.vaultDownload(undefined, meta.fassung), 'vor-ueberschreiben');
    const alt = await be.altMeta();
    const altBlob = alt.exists && meta.fassung !== 1 ? await be.altDownload() : null;
    if (altBlob) await this.sicherungAblegen(altBlob, 'vor-ueberschreiben');
    const container = await this.verpacken();
    const up = await be.vaultUpload(container);
    if (alt.exists) await this.altAbraeumen(container, { version: alt.version, blob: altBlob }).catch(() => {});
    const c = this.cfg();
    c.remoteVersion = up.version;
    c.lastSyncAt = new Date().toISOString();
    this.pending = { remoteVersion: up.version, hadRemote: true, fassung: 2 };
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
