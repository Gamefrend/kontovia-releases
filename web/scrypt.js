/**
 * Kontovia – scrypt (RFC 7914) für den Browser.
 *
 * WebCrypto bringt PBKDF2-HMAC-SHA256 mit, aber kein scrypt. Die beiden
 * PBKDF2-Schritte übernimmt deshalb WebCrypto, den speicherharten Kern
 * dazwischen (ROMix mit Salsa20/8) rechnet dieses Modul selbst.
 *
 * Das Ergebnis muss Byte für Byte dem von crypto.scrypt in Node entsprechen –
 * sonst ließe sich ein am PC angelegter Tresor im Browser nicht öffnen und
 * umgekehrt. scripts/check.js vergleicht beide Wege.
 */

/**
 * Obergrenze wie im Hauptprozess (SCRYPT_MAXMEM). Die Parameter stehen im
 * Klartext-Kopf der Tresordatei; ohne Grenze könnte eine manipulierte Datei
 * den Browser mit einer riesigen Speicheranforderung lahmlegen.
 */
const MAXMEM = 384 * 1024 * 1024;

/**
 * HMAC füllt einen kurzen Schlüssel mit Nullbytes auf. Ein leeres Passwort
 * ergibt deshalb denselben HMAC-Schlüssel wie ein einzelnes Nullbyte – und
 * manche Browser lehnen einen leeren PBKDF2-Schlüssel ab.
 */
function hmacKeyBytes(pw) {
  return pw.length ? pw : new Uint8Array(1);
}

async function pbkdf2(password, salt, len) {
  const key = await crypto.subtle.importKey('raw', hmacKeyBytes(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

const rotl = (a, b) => (a << b) | (a >>> (32 - b));

/** Salsa20/8-Kern, arbeitet auf 16 Wörtern ab Position `o` in `B`. */
function salsa8(B, o) {
  let x0 = B[o], x1 = B[o + 1], x2 = B[o + 2], x3 = B[o + 3];
  let x4 = B[o + 4], x5 = B[o + 5], x6 = B[o + 6], x7 = B[o + 7];
  let x8 = B[o + 8], x9 = B[o + 9], x10 = B[o + 10], x11 = B[o + 11];
  let x12 = B[o + 12], x13 = B[o + 13], x14 = B[o + 14], x15 = B[o + 15];
  for (let i = 0; i < 8; i += 2) {
    // Spalten
    x4 ^= rotl(x0 + x12, 7); x8 ^= rotl(x4 + x0, 9);
    x12 ^= rotl(x8 + x4, 13); x0 ^= rotl(x12 + x8, 18);
    x9 ^= rotl(x5 + x1, 7); x13 ^= rotl(x9 + x5, 9);
    x1 ^= rotl(x13 + x9, 13); x5 ^= rotl(x1 + x13, 18);
    x14 ^= rotl(x10 + x6, 7); x2 ^= rotl(x14 + x10, 9);
    x6 ^= rotl(x2 + x14, 13); x10 ^= rotl(x6 + x2, 18);
    x3 ^= rotl(x15 + x11, 7); x7 ^= rotl(x3 + x15, 9);
    x11 ^= rotl(x7 + x3, 13); x15 ^= rotl(x11 + x7, 18);
    // Zeilen
    x1 ^= rotl(x0 + x3, 7); x2 ^= rotl(x1 + x0, 9);
    x3 ^= rotl(x2 + x1, 13); x0 ^= rotl(x3 + x2, 18);
    x6 ^= rotl(x5 + x4, 7); x7 ^= rotl(x6 + x5, 9);
    x4 ^= rotl(x7 + x6, 13); x5 ^= rotl(x4 + x7, 18);
    x11 ^= rotl(x10 + x9, 7); x8 ^= rotl(x11 + x10, 9);
    x9 ^= rotl(x8 + x11, 13); x10 ^= rotl(x9 + x8, 18);
    x12 ^= rotl(x15 + x14, 7); x13 ^= rotl(x12 + x15, 9);
    x14 ^= rotl(x13 + x12, 13); x15 ^= rotl(x14 + x13, 18);
  }
  // Uint32Array rechnet die Summen von selbst modulo 2^32.
  B[o] += x0; B[o + 1] += x1; B[o + 2] += x2; B[o + 3] += x3;
  B[o + 4] += x4; B[o + 5] += x5; B[o + 6] += x6; B[o + 7] += x7;
  B[o + 8] += x8; B[o + 9] += x9; B[o + 10] += x10; B[o + 11] += x11;
  B[o + 12] += x12; B[o + 13] += x13; B[o + 14] += x14; B[o + 15] += x15;
}

/**
 * BlockMix: XY[0 .. 32r) ist der Eingabeblock, XY[32r .. 64r) Zwischenablage.
 * Das Ergebnis steht danach wieder in XY[0 .. 32r).
 */
function blockMix(XY, r, T) {
  const Y = 32 * r;
  T.set(XY.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    const b = i * 16;
    for (let k = 0; k < 16; k++) T[k] ^= XY[b + k];
    salsa8(T, 0);
    XY.set(T, Y + b);
  }
  // Gerade Teilblöcke nach vorn, ungerade dahinter.
  for (let i = 0; i < r; i++) {
    XY.copyWithin(i * 16, Y + (2 * i) * 16, Y + (2 * i) * 16 + 16);
    XY.copyWithin((i + r) * 16, Y + (2 * i + 1) * 16, Y + (2 * i + 1) * 16 + 16);
  }
}

/** ROMix auf einem Block von 128·r Bytes ab `offset` in `B` (an Ort und Stelle). */
function roMix(B, offset, N, r, V, XY, T) {
  const words = 32 * r;
  for (let i = 0; i < words; i++) {
    const j = offset + i * 4;
    XY[i] = B[j] | (B[j + 1] << 8) | (B[j + 2] << 16) | (B[j + 3] << 24);
  }
  for (let i = 0; i < N; i++) {
    V.set(XY.subarray(0, words), i * words);
    blockMix(XY, r, T);
  }
  const last = (2 * r - 1) * 16;
  for (let i = 0; i < N; i++) {
    const j = (XY[last] & (N - 1)) * words;
    for (let k = 0; k < words; k++) XY[k] ^= V[j + k];
    blockMix(XY, r, T);
  }
  for (let i = 0; i < words; i++) {
    const w = XY[i];
    const j = offset + i * 4;
    B[j] = w; B[j + 1] = w >>> 8; B[j + 2] = w >>> 16; B[j + 3] = w >>> 24;
  }
}

/**
 * Leitet einen Schlüssel ab.
 * @param {Uint8Array} password
 * @param {Uint8Array} salt
 * @param {{N:number, r:number, p:number, keyLen:number}} params
 * @returns {Promise<Uint8Array>}
 */
export async function scrypt(password, salt, { N, r, p, keyLen }) {
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) throw new Error('scrypt: N muss eine Zweierpotenz sein.');
  if (!Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1 || p > 16) throw new Error('scrypt: ungültige Parameter.');
  if (!Number.isInteger(keyLen) || keyLen < 1 || keyLen > 1024) throw new Error('scrypt: ungültige Schlüssellänge.');
  if (128 * N * r > MAXMEM) throw new Error('scrypt: Die Parameter verlangen mehr Speicher als erlaubt.');

  const B = await pbkdf2(password, salt, p * 128 * r);
  const V = new Uint32Array(32 * r * N);
  const XY = new Uint32Array(64 * r);
  const T = new Uint32Array(16);
  try {
    for (let i = 0; i < p; i++) roMix(B, i * 128 * r, N, r, V, XY, T);
    return await pbkdf2(password, B, keyLen);
  } finally {
    // Zwischenstände sind aus dem Passwort abgeleitet – nicht liegen lassen.
    B.fill(0);
    XY.fill(0);
    V.fill(0);
  }
}
