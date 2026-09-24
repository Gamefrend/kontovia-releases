/**
 * Kontovia – Ablage im Google Drive des Nutzers (appDataFolder), Web-Fassung.
 * Gegenstück zu src/main/providers/googledrive.js und src/main/drive.js.
 */

import { requestJson, request } from './netz.js';
import * as gauth from './anmeldung.js';

const VAULT_NAME = 'tresor.kv';
const ATTACH_PREFIX = 'beleg_';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,size,modifiedTime,md5Checksum,appProperties';

const auth = (token) => ({ authorization: `Bearer ${token}` });

/* ------------------------------ Drive-Schnittstelle ------------------------ */

async function list(token) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${FILES}?spaces=appDataFolder&pageSize=200&fields=nextPageToken,files(${FIELDS})`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await requestJson(url, { headers: auth(token), timeoutMs: 30000 });
    out.push(...(data?.files || []));
    pageToken = data?.nextPageToken || '';
  } while (pageToken && out.length < 5000);
  return out;
}

const meta = (token, fileId) => requestJson(`${FILES}/${encodeURIComponent(fileId)}?fields=${FIELDS}`, {
  headers: auth(token), timeoutMs: 20000,
});

async function download(token, fileId, onProgress) {
  const res = await request(`${FILES}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: auth(token), timeoutMs: 10 * 60 * 1000, onProgress,
  });
  if (res.status !== 200) throw new Error(`Google Drive antwortete mit HTTP ${res.status} beim Herunterladen.`);
  return res.body;
}

function multipart(metadata, content) {
  const boundary = 'kontovia' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const te = new TextEncoder();
  const head = te.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    + JSON.stringify(metadata)
    + `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = te.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + content.length + tail.length);
  body.set(head, 0);
  body.set(content, head.length);
  body.set(tail, head.length + content.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function create(token, name, content, appProperties = {}) {
  const { body, contentType } = multipart({ name, parents: ['appDataFolder'], appProperties }, content);
  return requestJson(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
    method: 'POST', headers: { ...auth(token), 'content-type': contentType }, body, timeoutMs: 10 * 60 * 1000,
  });
}

async function update(token, fileId, content, appProperties = {}) {
  const { body, contentType } = multipart({ appProperties }, content);
  return requestJson(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${FIELDS}`, {
    method: 'PATCH', headers: { ...auth(token), 'content-type': contentType }, body, timeoutMs: 10 * 60 * 1000,
  });
}

async function remove(token, fileId) {
  await requestJson(`${FILES}/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: auth(token), timeoutMs: 20000 });
  return true;
}

async function quota(token) {
  const data = await requestJson('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user(emailAddress)', {
    headers: auth(token), timeoutMs: 20000,
  });
  return {
    email: data?.user?.emailAddress || '',
    used: Number(data?.storageQuota?.usage || 0),
    limit: Number(data?.storageQuota?.limit || 0),
  };
}

/* ------------------------------ Baustein ----------------------------------- */

export class DriveBackend {
  constructor(cfg, state) {
    this.cfg = cfg || {};
    this.state = state || {};
    this.token = null;
  }

  get name() { return 'drive'; }

  assertConfigured() {
    if (!this.cfg.clientId) throw new Error('Es ist keine Google-Client-ID hinterlegt.');
  }

  async connect() {
    this.assertConfigured();
    const res = await gauth.authorize({
      clientId: this.cfg.clientId,
      clientSecret: this.cfg.clientSecret,
      scopes: gauth.DRIVE_SCOPES,
      zeigeCode: this.cfg.zeigeCode,
    });
    this.state.refreshToken = res.refreshToken;
    this.state.email = res.email;
    this.token = { accessToken: res.accessToken, expiresAt: res.expiresAt };
    return { email: res.email };
  }

  async disconnect() {
    await gauth.revoke(this.state.refreshToken);
    delete this.state.refreshToken;
    delete this.state.email;
    delete this.state.fileId;
    this.token = null;
  }

  async accessToken() {
    if (!this.state.refreshToken) throw new Error('Es ist kein Google-Konto verbunden.');
    if (this.token && this.token.expiresAt > Date.now()) return this.token.accessToken;
    this.token = await gauth.refresh({
      clientId: this.cfg.clientId,
      clientSecret: this.cfg.clientSecret,
      refreshToken: this.state.refreshToken,
    });
    return this.token.accessToken;
  }

  async findVault(token) {
    if (this.state.fileId) {
      try { return await meta(token, this.state.fileId); } catch { delete this.state.fileId; }
    }
    const found = (await list(token)).find((f) => f.name === VAULT_NAME);
    if (found) this.state.fileId = found.id;
    return found || null;
  }

  async vaultMeta() {
    const token = await this.accessToken();
    const f = await this.findVault(token);
    if (!f) return { exists: false };
    return { exists: true, version: String(f.modifiedTime || ''), size: Number(f.size || 0), updated: f.modifiedTime };
  }

  async vaultDownload(onProgress) {
    const token = await this.accessToken();
    const f = await this.findVault(token);
    if (!f) throw new Error('In der Cloud liegt noch kein Tresor.');
    return download(token, f.id, onProgress);
  }

  async vaultUpload(bytes) {
    const token = await this.accessToken();
    const existing = await this.findVault(token);
    const props = { app: 'Kontovia' };
    const f = existing ? await update(token, existing.id, bytes, props) : await create(token, VAULT_NAME, bytes, props);
    this.state.fileId = f.id;
    return { version: String(f.modifiedTime || ''), size: Number(f.size || bytes.length) };
  }

  async listAttachments() {
    const token = await this.accessToken();
    return (await list(token))
      .filter((f) => f.name.startsWith(ATTACH_PREFIX))
      .map((f) => ({ id: f.name.slice(ATTACH_PREFIX.length), size: Number(f.size || 0), fileId: f.id }));
  }

  async attachmentDownload(id) {
    const token = await this.accessToken();
    const found = (await this.listAttachments()).find((a) => a.id === id);
    if (!found) throw new Error('Der Beleg liegt nicht in der Cloud.');
    return download(token, found.fileId);
  }

  async attachmentUpload(id, bytes) {
    const token = await this.accessToken();
    await create(token, ATTACH_PREFIX + id, bytes, { app: 'Kontovia', kind: 'beleg' });
    return true;
  }

  async attachmentRemove(id) {
    const token = await this.accessToken();
    const found = (await this.listAttachments()).find((a) => a.id === id);
    if (found) await remove(token, found.fileId).catch(() => {});
    return true;
  }

  async removeAll() {
    const token = await this.accessToken();
    for (const f of await list(token)) await remove(token, f.id).catch(() => {});
    delete this.state.fileId;
    return true;
  }

  async quota() {
    const q = await quota(await this.accessToken());
    return { ...q, scope: 'Ihr Google-Kontingent' };
  }
}
