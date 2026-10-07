/**
 * Kontovia – Ablage in Firebase, Web-Fassung.
 *
 * Dieselben Pfade und derselbe Tresorname wie früher in der Windows-Fassung:
 * Cloud-Stände von dort lassen sich hier weiter abgleichen. Die
 * Google-Anmeldung davor steht in weiterleitung.js und anmeldung.js.
 */

import { requestJson, request, form } from './netz.js';
import * as gauth from './anmeldung.js';
import { DATEI_RE } from './koppeln.js';
import { einordnen } from './zulassung.js';
import { readIdToken } from './weiterleitung.js';

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';
const SECURETOKEN = 'https://securetoken.googleapis.com/v1';
const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';

export const VAULT_NAME = 'tresor.kv';
const SCHLUESSEL_NAME = 'entsperrung.kv';
/** Wie früher unter Windows: 2026-10-01T08-30-00Z_auto.kv */
export const BACKUP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_[a-z-]{1,30}\.kv$/;

const enc = (s) => encodeURIComponent(s);

/** Wie früher unter Windows: abgelaufene oder widerrufene Sitzung → code NEU_ANMELDEN. */
export function anmeldungUngueltig(err) {
  if (!/INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|invalid_grant|expired or revoked/i.test(String(err?.message))) return err;
  return Object.assign(
    new Error('Die Anmeldung bei Google gilt nicht mehr, etwa weil der Zugriff im Google-Konto entfernt wurde. Bitte neu anmelden; Ihre Daten bleiben dabei, wie sie sind.'),
    { code: 'NEU_ANMELDEN' },
  );
}

export class FirebaseBackend {
  /**
   * @param {{apiKey:string, bucket:string, clientId:string, clientSecret:string, zeigeCode:Function}} cfg
   * @param {object} state  liegt im Tresor: refreshToken, uid, email
   */
  constructor(cfg, state) {
    this.cfg = cfg || {};
    this.state = state || {};
    this.token = null; // { idToken, expiresAt } – nur im Arbeitsspeicher
  }

  get name() { return 'firebase'; }

  assertConfigured() {
    if (!this.cfg.apiKey) throw new Error('Es ist kein Firebase-Web-API-Schlüssel hinterlegt.');
    if (!this.cfg.bucket) throw new Error('Es ist kein Firebase-Speicherort (Bucket) hinterlegt.');
    if (!this.cfg.clientId) throw new Error('Es ist keine Google-Client-ID hinterlegt.');
  }

  async connect() {
    this.assertConfigured();
    const google = await gauth.authorize({
      clientId: this.cfg.clientId,
      clientSecret: this.cfg.clientSecret,
      scopes: ['openid', 'email', 'profile'],
      zeigeCode: this.cfg.zeigeCode,
    });
    if (!google.idToken) throw new Error('Google hat die Anmeldung nicht bestätigt. Bitte erneut anmelden.');
    const res = await this.mitIdToken(google.idToken, google.email);
    this.state.googleRefreshToken = google.refreshToken || '';
    return res;
  }

  /**
   * Eintausch eines Google-ID-Tokens bei Firebase – aus der Anmeldung per Code
   * oder per Weiterleitung (weiterleitung.js). Danach trägt die Firebase-Sitzung.
   */
  async mitIdToken(idToken, email = '') {
    if (!this.cfg.apiKey) throw new Error('Es ist kein Firebase-Web-API-Schlüssel hinterlegt.');
    if (!this.cfg.bucket) throw new Error('Es ist kein Firebase-Speicherort (Bucket) hinterlegt.');
    const data = await requestJson(`${IDENTITY}/accounts:signInWithIdp?key=${enc(this.cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postBody: form({ id_token: idToken, providerId: 'google.com' }),
        // Wie früher unter Windows. Beim Eintausch eines ID-Tokens gibt es
        // keine Umleitung; der Wert wird nur formal verlangt.
        requestUri: 'http://127.0.0.1',
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
      timeoutMs: 30000,
    });
    if (!data?.idToken || !data?.refreshToken) {
      throw new Error('Der Cloud-Speicher hat die Anmeldung nicht bestätigt. Bitte versuchen Sie es später noch einmal.');
    }

    this.state.refreshToken = data.refreshToken;
    this.state.uid = data.localId;
    this.state.email = data.email || email || '';
    this.token = { idToken: data.idToken, expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000 - 60000 };
    return { email: this.state.email, uid: this.state.uid };
  }

  /** @param {{widerrufen?:boolean}} opts  false: die Google-Freigabe stehen lassen (cloud.js) */
  async disconnect({ widerrufen = true } = {}) {
    if (widerrufen) await gauth.revoke(this.state.googleRefreshToken);
    delete this.state.refreshToken;
    delete this.state.googleRefreshToken;
    delete this.state.uid;
    delete this.state.email;
    this.token = null;
  }

  async idToken() {
    if (!this.state.refreshToken) throw new Error('Es ist kein Konto verbunden.');
    if (this.token && this.token.expiresAt > Date.now()) return this.token.idToken;
    let data;
    try {
      data = await requestJson(`${SECURETOKEN}/token?key=${enc(this.cfg.apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'refresh_token', refresh_token: this.state.refreshToken }),
        timeoutMs: 30000,
      });
    } catch (err) {
      throw anmeldungUngueltig(err);
    }
    if (!data?.id_token) throw new Error('Die Sitzung konnte nicht erneuert werden. Bitte neu anmelden.');
    if (data.refresh_token) this.state.refreshToken = data.refresh_token;
    this.state.uid = data.user_id || this.state.uid;
    this.token = { idToken: data.id_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000 };
    return this.token.idToken;
  }

  async auth() {
    return { authorization: `Firebase ${await this.idToken()}` };
  }

  base() {
    if (!this.state.uid) throw new Error('Keine Kontokennung vorhanden.');
    return `tresore/${this.state.uid}`;
  }

  objectUrl(objectPath, query = '') {
    return `${STORAGE}/${enc(this.cfg.bucket)}/o/${enc(objectPath)}${query}`;
  }

  async vaultMeta() {
    const headers = await this.auth();
    try {
      const m = await requestJson(this.objectUrl(`${this.base()}/${VAULT_NAME}`), { headers, timeoutMs: 20000 });
      return { exists: true, version: String(m.generation || m.updated || ''), size: Number(m.size || 0), updated: m.updated };
    } catch (err) {
      if (err.status === 404) return { exists: false };
      throw err;
    }
  }

  async vaultDownload(onProgress) {
    const headers = await this.auth();
    const res = await request(this.objectUrl(`${this.base()}/${VAULT_NAME}`, '?alt=media'), {
      headers, timeoutMs: 10 * 60 * 1000, onProgress,
    });
    if (res.status !== 200) throw new Error(`Der Tresor konnte nicht geladen werden (HTTP ${res.status}).`);
    return res.body;
  }

  async vaultUpload(bytes) {
    const headers = { ...(await this.auth()), 'content-type': 'application/octet-stream' };
    const path = `${this.base()}/${VAULT_NAME}`;
    const m = await requestJson(
      `${STORAGE}/${enc(this.cfg.bucket)}/o?uploadType=media&name=${enc(path)}`,
      { method: 'POST', headers, body: bytes, timeoutMs: 10 * 60 * 1000 },
    );
    return { version: String(m.generation || m.updated || ''), size: Number(m.size || bytes.length) };
  }

  async listAttachments() {
    const headers = await this.auth();
    const prefix = `${this.base()}/belege/`;
    const out = [];
    let pageToken = '';
    do {
      const url = `${STORAGE}/${enc(this.cfg.bucket)}/o?prefix=${enc(prefix)}&maxResults=1000`
        + (pageToken ? `&pageToken=${enc(pageToken)}` : '');
      const data = await requestJson(url, { headers, timeoutMs: 30000 });
      for (const item of data?.items || []) {
        const id = String(item.name || '').slice(prefix.length);
        if (/^[a-f0-9]{32}$/.test(id)) out.push({ id, size: Number(item.size || 0) });
      }
      pageToken = data?.nextPageToken || '';
    } while (pageToken && out.length < 10000);
    return out;
  }

  async attachmentDownload(id) {
    const headers = await this.auth();
    const res = await request(this.objectUrl(`${this.base()}/belege/${id}`, '?alt=media'), {
      headers, timeoutMs: 10 * 60 * 1000,
    });
    if (res.status !== 200) throw new Error(`Beleg konnte nicht geladen werden (HTTP ${res.status}).`);
    return res.body;
  }

  async attachmentUpload(id, bytes) {
    const headers = { ...(await this.auth()), 'content-type': 'application/octet-stream' };
    const path = `${this.base()}/belege/${id}`;
    await requestJson(
      `${STORAGE}/${enc(this.cfg.bucket)}/o?uploadType=media&name=${enc(path)}`,
      { method: 'POST', headers, body: bytes, timeoutMs: 10 * 60 * 1000 },
    );
    return true;
  }

  async attachmentRemove(id) {
    const headers = await this.auth();
    try {
      await requestJson(this.objectUrl(`${this.base()}/belege/${id}`), { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return true;
  }

  async listBackups() {
    const headers = await this.auth();
    const prefix = `${this.base()}/sicherungen/`;
    const out = [];
    let pageToken = '';
    do {
      const url = `${STORAGE}/${enc(this.cfg.bucket)}/o?prefix=${enc(prefix)}&maxResults=1000`
        + (pageToken ? `&pageToken=${enc(pageToken)}` : '');
      const data = await requestJson(url, { headers, timeoutMs: 30000 });
      for (const item of data?.items || []) {
        const name = String(item.name || '').slice(prefix.length);
        if (BACKUP_RE.test(name)) out.push({ name, size: Number(item.size || 0), updated: item.updated || '' });
      }
      pageToken = data?.nextPageToken || '';
    } while (pageToken && out.length < 2000);
    return out;
  }

  async backupDownload(name) {
    if (!BACKUP_RE.test(name)) throw new Error('Ungültiger Name einer Sicherung.');
    const headers = await this.auth();
    const res = await request(this.objectUrl(`${this.base()}/sicherungen/${name}`, '?alt=media'), {
      headers, timeoutMs: 10 * 60 * 1000,
    });
    if (res.status !== 200) throw new Error(`Die Sicherung konnte nicht geladen werden (HTTP ${res.status}).`);
    return res.body;
  }

  async backupUpload(name, bytes) {
    if (!BACKUP_RE.test(name)) throw new Error('Ungültiger Name einer Sicherung.');
    const headers = { ...(await this.auth()), 'content-type': 'application/octet-stream' };
    const path = `${this.base()}/sicherungen/${name}`;
    const m = await requestJson(
      `${STORAGE}/${enc(this.cfg.bucket)}/o?uploadType=media&name=${enc(path)}`,
      { method: 'POST', headers, body: bytes, timeoutMs: 10 * 60 * 1000 },
    );
    return { name, size: Number(m?.size || bytes.length), updated: m?.updated || '' };
  }

  async backupRemove(name) {
    if (!BACKUP_RE.test(name)) throw new Error('Ungültiger Name einer Sicherung.');
    const headers = await this.auth();
    try {
      await requestJson(this.objectUrl(`${this.base()}/sicherungen/${name}`), { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return true;
  }

  /**
   * Die Datei mit dem Datenschlüssel für „Mit Google entsperren“ (entsperrung.js); null nur,
   * wenn es sie sicher nicht gibt (404). Jede andere Antwort wirft: „unklar“ ist nicht „aus“.
   */
  async schluesselLesen() {
    const headers = await this.auth();
    try {
      const res = await request(this.objectUrl(`${this.base()}/${SCHLUESSEL_NAME}`, '?alt=media'), { headers, timeoutMs: 20000 });
      if (res.status === 200) return res.body;
      if (res.status === 404) return null;
      throw Object.assign(new Error(`Der Schlüssel ließ sich nicht lesen (HTTP ${res.status}).`), { status: res.status });
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async schluesselSchreiben(bytes) {
    const headers = { ...(await this.auth()), 'content-type': 'application/octet-stream' };
    await requestJson(
      `${STORAGE}/${enc(this.cfg.bucket)}/o?uploadType=media&name=${enc(`${this.base()}/${SCHLUESSEL_NAME}`)}`,
      { method: 'POST', headers, body: bytes, timeoutMs: 30000 },
    );
    return true;
  }

  async schluesselLoeschen() {
    const headers = await this.auth();
    try {
      await requestJson(this.objectUrl(`${this.base()}/${SCHLUESSEL_NAME}`), { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return true;
  }

  /**
   * Kurzlebige Dateien für das Koppeln eines weiteren Geräts (koppeln.js):
   * tresore/<uid>/koppeln/<20 Hex>.anfrage|antwort. Der Inhalt ist verschlossen
   * und ohne den QR-Code wertlos; hier liegt nur der Transport.
   */
  koppelnPfad(name) {
    if (!DATEI_RE.test(String(name))) throw new Error('Ungültiger Name einer Kopplungsdatei.');
    return `${this.base()}/koppeln/${name}`;
  }

  async koppelnLesen(name) {
    const headers = await this.auth();
    try {
      const res = await request(this.objectUrl(this.koppelnPfad(name), '?alt=media'), { headers, timeoutMs: 20000 });
      if (res.status === 404) return null;
      if (res.status !== 200) throw Object.assign(new Error(`Die Kopplungsdatei ließ sich nicht lesen (HTTP ${res.status}).`), { status: res.status });
      return res.body;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async koppelnSchreiben(name, bytes) {
    const headers = { ...(await this.auth()), 'content-type': 'application/octet-stream' };
    await requestJson(
      `${STORAGE}/${enc(this.cfg.bucket)}/o?uploadType=media&name=${enc(this.koppelnPfad(name))}`,
      { method: 'POST', headers, body: bytes, timeoutMs: 30000 },
    );
    return true;
  }

  async koppelnLoeschen(name) {
    const headers = await this.auth();
    try {
      await requestJson(this.objectUrl(this.koppelnPfad(name)), { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return true;
  }

  async koppelnListe() {
    const headers = await this.auth();
    const prefix = `${this.base()}/koppeln/`;
    const out = [];
    let pageToken = '';
    do {
      const url = `${STORAGE}/${enc(this.cfg.bucket)}/o?prefix=${enc(prefix)}&maxResults=200`
        + (pageToken ? `&pageToken=${enc(pageToken)}` : '');
      const data = await requestJson(url, { headers, timeoutMs: 30000 });
      for (const item of data?.items || []) {
        const name = String(item.name || '').slice(prefix.length);
        if (DATEI_RE.test(name)) out.push({ name, updated: item.updated || item.timeCreated || '' });
      }
      pageToken = data?.nextPageToken || '';
    } while (pageToken && out.length < 1000);
    return out;
  }

  /**
   * Die Zulassung dieses Kontos lesen (zulassung.js): zulassung/<uid>.json, nur lesbar für das
   * eigene Konto. Die Zeit des Servers ist die Ausstellungszeit eines frischen Tokens; die Uhr
   * des Geräts zählt dafür nicht.
   * @returns {Promise<{art:'zugelassen'|'gesperrt'|'unklar'|'netz'|'anmeldung', serverZeit:number, status?:number}>}
   */
  async zulassungLesen() {
    let idToken;
    try {
      this.token = null; // erzwingt ein frisches Token
      idToken = await this.idToken();
    } catch (err) {
      // Antwortete der Server (abgelaufene oder widerrufene Anmeldung), ist das etwas anderes als kein Netz.
      return { art: err?.code === 'NEU_ANMELDEN' || err?.status ? 'anmeldung' : 'netz', serverZeit: 0 };
    }
    const serverZeit = (Number(readIdToken(idToken).iat) || 0) * 1000;
    if (!this.state.uid) return { art: 'unklar', serverZeit };
    try {
      const res = await request(this.objectUrl(`zulassung/${this.state.uid}.json`, '?alt=media'), {
        headers: { authorization: `Firebase ${idToken}` }, timeoutMs: 20000, maxBytes: 64 * 1024,
      });
      return { art: einordnen(res.status, new TextDecoder().decode(res.body)), serverZeit, status: res.status };
    } catch {
      return { art: 'netz', serverZeit };
    }
  }

  async removeAll() {
    for (const e of await this.koppelnListe().catch(() => [])) await this.koppelnLoeschen(e.name).catch(() => {});
    for (const a of await this.listAttachments()) await this.attachmentRemove(a.id).catch(() => {});
    for (const s of await this.listBackups().catch(() => [])) await this.backupRemove(s.name).catch(() => {});
    const headers = await this.auth();
    try {
      await requestJson(this.objectUrl(`${this.base()}/${VAULT_NAME}`), { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    await this.schluesselLoeschen().catch(() => {});
    return true;
  }

  /**
   * Löscht das Anmeldekonto (E-Mail-Adresse und Kontokennung) bei Firebase Authentication.
   * Das Recht auf Löschung (Art. 17 DSGVO) schließt diese Angaben ein; ohne diesen Schritt
   * bliebe nach dem Löschen der Ablage der Eintrag der Anmeldung stehen.
   */
  async kontoLoeschen() {
    const idToken = await this.idToken();
    await requestJson(`${IDENTITY}/accounts:delete?key=${enc(this.cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
      timeoutMs: 30000,
    });
    return true;
  }

  async quota() {
    const attachments = await this.listAttachments();
    const backups = await this.listBackups().catch(() => []);
    const meta = await this.vaultMeta().catch(() => ({ size: 0 }));
    const used = (meta.size || 0) + [...attachments, ...backups].reduce((s, a) => s + a.size, 0);
    return { email: this.state.email || '', used, limit: 0, scope: 'eigener Verbrauch im Projekt' };
  }
}
