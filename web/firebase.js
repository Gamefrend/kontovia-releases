/**
 * Kontovia – Ablage in Firebase, Web-Fassung.
 *
 * Gegenstück zu src/main/providers/firebase.js – dieselben Pfade, derselbe
 * Tresorname. Ein Konto, das am PC verbunden ist, sieht im Browser denselben
 * Zweig und denselben Tresor. Nur die Google-Anmeldung davor läuft anders
 * (siehe anmeldung.js).
 */

import { requestJson, request, form } from './netz.js';
import * as gauth from './anmeldung.js';

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';
const SECURETOKEN = 'https://securetoken.googleapis.com/v1';
const STORAGE = 'https://firebasestorage.googleapis.com/v0/b';

export const VAULT_NAME = 'tresor.kv';

const enc = (s) => encodeURIComponent(s);

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
    if (!google.idToken) throw new Error('Google hat kein Identitätsmerkmal geliefert – bitte erneut anmelden.');

    const data = await requestJson(`${IDENTITY}/accounts:signInWithIdp?key=${enc(this.cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postBody: form({ id_token: google.idToken, providerId: 'google.com' }),
        // Wie in der Windows-Fassung. Beim Eintausch eines ID-Tokens gibt es
        // keine Umleitung; der Wert wird nur formal verlangt.
        requestUri: 'http://127.0.0.1',
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
      timeoutMs: 30000,
    });
    if (!data?.idToken || !data?.refreshToken) {
      throw new Error('Firebase hat die Anmeldung nicht bestätigt. Ist die Google-Anmeldung im Firebase-Projekt eingeschaltet?');
    }

    this.state.refreshToken = data.refreshToken;
    this.state.uid = data.localId;
    this.state.email = data.email || google.email || '';
    this.state.googleRefreshToken = google.refreshToken || '';
    this.token = { idToken: data.idToken, expiresAt: Date.now() + (Number(data.expiresIn) || 3600) * 1000 - 60000 };
    return { email: this.state.email, uid: this.state.uid };
  }

  async disconnect() {
    await gauth.revoke(this.state.googleRefreshToken);
    delete this.state.refreshToken;
    delete this.state.googleRefreshToken;
    delete this.state.uid;
    delete this.state.email;
    this.token = null;
  }

  async idToken() {
    if (!this.state.refreshToken) throw new Error('Es ist kein Konto verbunden.');
    if (this.token && this.token.expiresAt > Date.now()) return this.token.idToken;
    const data = await requestJson(`${SECURETOKEN}/token?key=${enc(this.cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'refresh_token', refresh_token: this.state.refreshToken }),
      timeoutMs: 30000,
    });
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

  async removeAll() {
    for (const a of await this.listAttachments()) await this.attachmentRemove(a.id).catch(() => {});
    const headers = await this.auth();
    try {
      await requestJson(this.objectUrl(`${this.base()}/${VAULT_NAME}`), { method: 'DELETE', headers, timeoutMs: 20000 });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return true;
  }

  async quota() {
    const attachments = await this.listAttachments();
    const meta = await this.vaultMeta().catch(() => ({ size: 0 }));
    const used = (meta.size || 0) + attachments.reduce((s, a) => s + a.size, 0);
    return { email: this.state.email || '', used, limit: 0, scope: 'eigener Verbrauch im Projekt' };
  }
}
