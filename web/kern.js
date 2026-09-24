/**
 * Kontovia – Sicherheitsschicht der Web-Fassung.
 *
 * Gegenstück zu src/main/secure.js: dasselbe Dateiformat, dieselben
 * Schlüssel, dieselben Zusatzdaten. Eine im Browser geschriebene Tresordatei
 * öffnet die Windows-Fassung und umgekehrt – sonst könnten beide nicht über
 * die Cloud abgleichen. scripts/check.js prüft das in beide Richtungen.
 *
 *   Passwort --scrypt--> KEK  --AES-256-GCM--> entpackt DEK (zufällig, 32 Byte)
 *   DEK --AES-256-GCM--> Tresordatei (gesamte Buchhaltung als JSON)
 *   HKDF(DEK,"kontovia/attachments/v1") --> Belegschlüssel
 *
 * Unterschied zu Node: WebCrypto legt beim Importieren eine eigene Kopie des
 * Schlüssels an, die sich nicht überschreiben lässt. Überschrieben wird, was
 * hier als Uint8Array vorliegt; die Kopie verschwindet mit dem Objekt.
 */

import { scrypt } from './scrypt.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// 'KONTOVIA' und ein Formatbyte – dieselben 9 Byte wie in secure.js. Danach
// folgt noch einmal ein eigenes Versionsbyte.
const MAGIC = new Uint8Array([0x4b, 0x4f, 0x4e, 0x54, 0x4f, 0x56, 0x49, 0x41, 0x01]);
const FORMAT_VERSION = 1;

export const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 1 << 17, r: 8, p: 1, keyLen: 32 });

const IV_LEN = 12;
const TAG_LEN = 16;
const SALT_LEN = 16;

/* -------------------------------------------------------------------------- */
/* Hilfen                                                                      */
/* -------------------------------------------------------------------------- */

export const utf8 = (s) => enc.encode(String(s));
export const fromUtf8 = (u8) => dec.decode(u8);

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function toBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const bin = atob(String(b64));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Überschreibt Schlüsselmaterial, so gut es im Browser geht. */
export function wipe(u8) {
  if (u8 instanceof Uint8Array) {
    crypto.getRandomValues(u8);
    u8.fill(0);
  }
}

export async function sha256Hex(u8) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', u8)));
}

async function stream(u8, transform) {
  const s = new Blob([u8]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export const gzip = (u8) => stream(u8, new CompressionStream('gzip'));
export const gunzip = (u8) => stream(u8, new DecompressionStream('gzip'));

/* -------------------------------------------------------------------------- */
/* Primitive                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * scrypt belegt rund 128 MiB und rechnet eine Weile. Im Hintergrund-Thread
 * bleibt die Oberfläche dabei bedienbar; der Speicher wird mit dem Thread
 * wieder freigegeben. Wo das nicht geht (Prüfskript), wird direkt gerechnet.
 */
function scryptImThread(password, salt, params) {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return scrypt(password, salt, params);
  }
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL('./scrypt-worker.js', import.meta.url), { type: 'module' });
    } catch {
      scrypt(password, salt, params).then(resolve, reject);
      return;
    }
    w.onmessage = (e) => {
      w.terminate();
      if (e.data?.key) resolve(new Uint8Array(e.data.key));
      else reject(new Error(e.data?.error || 'Die Schlüsselableitung ist fehlgeschlagen.'));
    };
    w.onerror = (e) => {
      w.terminate();
      e.preventDefault?.();
      // Ein Browser ohne Modul-Worker: dann eben im Vordergrund.
      scrypt(password, salt, params).then(resolve, reject);
    };
    w.postMessage({ password, salt, params });
  });
}

export async function deriveKey(password, salt, kdf = DEFAULT_KDF) {
  if (!kdf || kdf.name !== 'scrypt') throw new Error('Unbekanntes KDF: ' + (kdf?.name ?? ''));
  const pw = utf8(password);
  try {
    return await scryptImThread(pw, salt, { N: kdf.N, r: kdf.r, p: kdf.p, keyLen: kdf.keyLen });
  } finally {
    pw.fill(0);
  }
}

export async function subKey(masterKey, info, len = 32) {
  const k = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
    k,
    len * 8,
  );
  return new Uint8Array(bits);
}

const aesKey = (raw, usage) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);

/** AES-256-GCM. Ergebnis: iv | tag | ciphertext – wie in secure.js. */
export async function seal(key, plaintext, aad) {
  const iv = randomBytes(IV_LEN);
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) params.additionalData = aad;
  // WebCrypto hängt das Tag hinten an; die Datei führt es vor dem Chiffrat.
  const out = new Uint8Array(await crypto.subtle.encrypt(params, await aesKey(key, 'encrypt'), plaintext));
  const ct = out.subarray(0, out.length - TAG_LEN);
  const tag = out.subarray(out.length - TAG_LEN);
  return concat(iv, tag, ct);
}

export async function open(key, blob, aad) {
  if (!(blob instanceof Uint8Array) || blob.length < IV_LEN + TAG_LEN) {
    throw new Error('Datenblock ist beschädigt oder unvollständig.');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const params = { name: 'AES-GCM', iv, tagLength: 128 };
  if (aad) params.additionalData = aad;
  try {
    return new Uint8Array(await crypto.subtle.decrypt(params, await aesKey(key, 'decrypt'), concat(ct, tag)));
  } catch {
    throw new Error('Der Datenblock lässt sich nicht entschlüsseln (falscher Schlüssel oder verändert).');
  }
}

/* -------------------------------------------------------------------------- */
/* Container-Format                                                            */
/* -------------------------------------------------------------------------- */
/*
 *  MAGIC(9) | version(1) | headerLen(4 LE) | header(JSON utf8) | body
 *  header  = { kdf, salt, wrappedDek, createdAt, app }
 *  body    = seal(DEK, gzip(JSON), aad = headerBuffer)
 */

const DEK_AAD = utf8('kontovia/dek');

export function packContainer(header, body) {
  const h = utf8(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, h.length, true);
  return concat(MAGIC, new Uint8Array([FORMAT_VERSION]), len, h, body);
}

export function unpackContainer(buf) {
  if (!(buf instanceof Uint8Array) || buf.length < MAGIC.length + 5) {
    throw new Error('Keine gültige Kontovia-Datei.');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC[i]) throw new Error('Keine gültige Kontovia-Datei (Signatur fehlt).');
  }
  const version = buf[MAGIC.length];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Dateiformat Version ${version} wird von dieser Programmversion nicht unterstützt.`);
  }
  const headerLen = new DataView(buf.buffer, buf.byteOffset + MAGIC.length + 1, 4).getUint32(0, true);
  const headerStart = MAGIC.length + 5;
  const headerEnd = headerStart + headerLen;
  if (headerEnd > buf.length) throw new Error('Datei ist beschädigt (Header).');
  const headerBuf = buf.subarray(headerStart, headerEnd);
  let header;
  try {
    header = JSON.parse(fromUtf8(headerBuf));
  } catch {
    throw new Error('Datei ist beschädigt (Header nicht lesbar).');
  }
  return { header, headerBuf, body: buf.subarray(headerEnd) };
}

export async function sealBody(dek, data, header) {
  const packed = await gzip(utf8(JSON.stringify(data)));
  return seal(dek, packed, utf8(JSON.stringify(header)));
}

export async function openBody(dek, body, headerBuf) {
  const packed = await open(dek, body, headerBuf);
  return JSON.parse(fromUtf8(await gunzip(packed)));
}

/** Erzeugt einen frischen Container. Der DEK bleibt für die Sitzung im Speicher. */
export async function createContainer(password, data, extraHeader = {}) {
  const salt = randomBytes(SALT_LEN);
  const kdf = { ...DEFAULT_KDF };
  const kek = await deriveKey(password, salt, kdf);
  const dek = randomBytes(32);
  const header = {
    kdf,
    salt: toBase64(salt),
    wrappedDek: toBase64(await seal(kek, dek, DEK_AAD)),
    createdAt: new Date().toISOString(),
    ...extraHeader,
  };
  wipe(kek);
  const body = await sealBody(dek, data, header);
  return { buffer: packContainer(header, body), dek, header };
}

/**
 * Entsperrt einen Container. Falsches Passwort und manipulierte Datei sind
 * nicht unterscheidbar – beides heißt: Authentifizierung fehlgeschlagen.
 */
export async function openContainer(password, buf) {
  const { header, headerBuf, body } = unpackContainer(buf);
  const kek = await deriveKey(password, fromBase64(header.salt), header.kdf);
  let dek;
  try {
    dek = await open(kek, fromBase64(header.wrappedDek), DEK_AAD);
  } catch {
    const e = new Error('Falsches Passwort oder beschädigte Datei.');
    e.code = 'BAD_PASSWORD';
    throw e;
  } finally {
    wipe(kek);
  }
  const data = await openBody(dek, body, headerBuf);
  return { data, dek, header, headerBuf };
}

/** Passwortwechsel: nur der gewrappte DEK wird neu erzeugt. */
export async function rewrap(dek, newPassword, oldHeader) {
  const salt = randomBytes(SALT_LEN);
  const kdf = { ...DEFAULT_KDF };
  const kek = await deriveKey(newPassword, salt, kdf);
  try {
    return {
      ...oldHeader,
      kdf,
      salt: toBase64(salt),
      wrappedDek: toBase64(await seal(kek, dek, DEK_AAD)),
      rekeyedAt: new Date().toISOString(),
    };
  } finally {
    wipe(kek);
  }
}
