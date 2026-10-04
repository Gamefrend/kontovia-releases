/**
 * Kontovia – QR-Code nach ISO/IEC 18004 (Model 2), selbst geschrieben.
 *
 * Kann Bytefolgen (UTF-8) in allen vier Fehlerkorrekturstufen und allen 40
 * Versionen. Gebraucht wird es für den GiroCode (lib/girocode.js): Stufe M,
 * Version höchstens 13. Es gibt keine Abhängigkeit; geprüft wird gegen den
 * Beispielfall der Norm, bekannte Kapazitäten und einen eigenen Leser
 * (scripts/pruefungen/girocode.test.js).
 *
 * Ablauf: Daten in Bits (Modus Byte), auffüllen, in Blöcke teilen, je Block
 * Reed-Solomon über GF(256) mit Polynom 0x11D, Blöcke verschränken, Module
 * platzieren, unter den acht Masken die mit der niedrigsten Strafe nehmen,
 * Format- und Versionsinformation eintragen.
 */

/** Fehlerkorrekturstufen: Formatbits und Index in den Tabellen. */
export const STUFEN = { L: { bits: 1, i: 0 }, M: { bits: 0, i: 1 }, Q: { bits: 3, i: 2 }, H: { bits: 2, i: 3 } };

/** Korrekturcodewörter je Block, [Stufe][Version], Version 1 bis 40 (Index 0 ungenutzt). */
const EC_JE_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Anzahl der Blöcke, [Stufe][Version]. */
const BLOECKE = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Anzahl der Datenmodule ohne Funktionsmuster, daraus die Zahl der Codewörter. */
function rohModule(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

const gesamtCodewoerter = (v) => Math.floor(rohModule(v) / 8);

/** Datencodewörter einer Version und Stufe. */
export function datenCodewoerter(version, stufe = 'M') {
  const i = STUFEN[stufe].i;
  return gesamtCodewoerter(version) - EC_JE_BLOCK[i][version] * BLOECKE[i][version];
}

/** Wie viele Bytes in Version und Stufe passen (Bytemodus). */
export function byteKapazitaet(version, stufe = 'M') {
  const kopf = 4 + (version <= 9 ? 8 : 16);
  return Math.floor((datenCodewoerter(version, stufe) * 8 - kopf) / 8);
}

/* -------------------------------------------------------------------------- */
/* Reed-Solomon über GF(256)                                                   */
/* -------------------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mal = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Erzeugerpolynom vom Grad n (ohne den führenden Koeffizienten 1). */
function erzeuger(n) {
  const p = new Array(n).fill(0);
  p[n - 1] = 1;
  let wurzel = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      p[j] = mal(p[j], wurzel);
      if (j + 1 < n) p[j] ^= p[j + 1];
    }
    wurzel = mal(wurzel, 2);
  }
  return p;
}

/** Die n Korrekturbytes zu den Datenbytes. */
export function reedSolomon(daten, n) {
  const g = erzeuger(n);
  const rest = new Array(n).fill(0);
  for (const b of daten) {
    const f = b ^ rest.shift();
    rest.push(0);
    for (let i = 0; i < n; i++) rest[i] ^= mal(g[i], f);
  }
  return rest;
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                        */
/* -------------------------------------------------------------------------- */

function bch(wert, polynom, grad) {
  let r = wert << grad;
  const hoechstes = (x) => 31 - Math.clz32(x);
  const g = hoechstes(polynom);
  for (let i = hoechstes(r); i >= g; i--) if ((r >>> i) & 1) r ^= polynom << (i - g);
  return (wert << grad) | r;
}

/** 15 Bit Formatinformation (Stufe, Maske), mit der Norm-Maske 0x5412. */
export function formatBits(stufe, maske) {
  return bch((STUFEN[stufe].bits << 3) | maske, 0x537, 10) ^ 0x5412;
}

/** 18 Bit Versionsinformation (ab Version 7). */
export function versionBits(version) {
  return bch(version, 0x1f25, 12);
}

/* -------------------------------------------------------------------------- */
/* Aufbau                                                                      */
/* -------------------------------------------------------------------------- */

/** Mittelpunkte der Ausrichtungsmuster einer Version. */
export function ausrichtungen(version) {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const schritt = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let p = version * 4 + 10; out.length < n; p -= schritt) out.splice(1, 0, p);
  return out;
}

/**
 * Das Gitter vorbereiten: Funktionsmuster setzen, `fest` merkt, welche Module
 * keine Daten tragen.
 */
function gitter(version) {
  const n = version * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fest = Array.from({ length: n }, () => new Array(n).fill(false));
  const setze = (x, y, dunkel) => { m[y][x] = dunkel; fest[y][x] = true; };

  // Zeitmuster
  for (let i = 0; i < n; i++) { setze(6, i, i % 2 === 0); setze(i, 6, i % 2 === 0); }
  // Suchmuster mit Trennstreifen
  const sucher = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setze(x, y, d !== 2 && d !== 4);
      }
    }
  };
  sucher(3, 3); sucher(n - 4, 3); sucher(3, n - 4);
  // Ausrichtungsmuster
  const a = ausrichtungen(version);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === a.length - 1) || (i === a.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setze(a[i] + dx, a[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Platz für Format- und Versionsinformation reservieren (Inhalt folgt später)
  for (let i = 0; i < 9; i++) { fest[8][i] = true; fest[i][8] = true; }
  for (let i = 0; i < 8; i++) { fest[8][n - 1 - i] = true; fest[n - 1 - i][8] = true; }
  setze(8, n - 8, true); // das einzelne dunkle Modul
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fest[i][n - 11 + j] = true; fest[n - 11 + j][i] = true; }
  }
  return { n, m, fest };
}

function formatEintragen(g, stufe, maske) {
  const { n, m } = g;
  const bits = formatBits(stufe, maske);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  // Um das obere linke Suchmuster
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  // Zweite Kopie: unter dem linken unteren und rechts vom oberen rechten Suchmuster
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
  m[n - 8][8] = true;
}

function versionEintragen(g, version) {
  if (version < 7) return;
  const { n, m } = g;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dunkel = ((bits >>> i) & 1) === 1;
    const a = n - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m[b][a] = dunkel;
    m[a][b] = dunkel;
  }
}

function datenPlatzieren(g, bytes) {
  const { n, m, fest } = g;
  let i = 0;
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = rechts - j;
        const aufwaerts = ((rechts + 1) & 2) === 0;
        const y = aufwaerts ? n - 1 - v : v;
        if (fest[y][x] || i >= bytes.length * 8) continue;
        m[y][x] = ((bytes[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

const MASKEN = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function maskieren(g, nr) {
  const { n, m, fest } = g;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fest[y][x] && MASKEN[nr](x, y)) m[y][x] = !m[y][x];
}

/** Strafpunkte nach ISO 18004, 7.8.3. */
export function strafe(m) {
  const n = m.length;
  let punkte = 0;
  // Regel 1: fünf und mehr gleiche Module in einer Reihe oder Spalte; Regel 3: Suchmusterähnliches
  const muster1 = [true, false, true, true, true, false, true, false, false, false, false];
  const muster2 = [false, false, false, false, true, false, true, true, true, false, true];
  const passt = (zeile, i, mu) => mu.every((v, k) => zeile[i + k] === v);
  for (let a = 0; a < n; a++) {
    for (const spalte of [false, true]) {
      const zeile = [];
      for (let b = 0; b < n; b++) zeile.push(spalte ? m[b][a] : m[a][b]);
      let lauf = 1;
      for (let b = 1; b < n; b++) {
        if (zeile[b] === zeile[b - 1]) {
          lauf++;
          if (lauf === 5) punkte += 3;
          else if (lauf > 5) punkte += 1;
        } else lauf = 1;
      }
      for (let b = 0; b + 11 <= n; b++) if (passt(zeile, b, muster1) || passt(zeile, b, muster2)) punkte += 40;
    }
  }
  // Regel 2: Blöcke 2 × 2
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) punkte += 3;
  }
  // Regel 4: Verhältnis dunkler Module
  let dunkel = 0;
  for (const z of m) for (const v of z) if (v) dunkel++;
  const prozent = (dunkel * 100) / (n * n);
  punkte += Math.floor(Math.abs(prozent - 50) / 5) * 10;
  return punkte;
}

/** UTF-8 aus Text. */
const utf8 = (t) => (typeof t === 'string' ? new TextEncoder().encode(t) : Uint8Array.from(t));

/**
 * Codewörter (Daten und Korrektur, verschränkt) für Bytes, Version und Stufe.
 * @returns {number[]}
 */
export function codewoerter(bytes, version, stufe = 'M') {
  const i = STUFEN[stufe].i;
  const bits = [];
  const schreibe = (wert, anzahl) => { for (let k = anzahl - 1; k >= 0; k--) bits.push((wert >>> k) & 1); };
  schreibe(0b0100, 4);
  schreibe(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) schreibe(b, 8);
  const kapazitaet = datenCodewoerter(version, stufe) * 8;
  schreibe(0, Math.min(4, kapazitaet - bits.length));
  while (bits.length % 8) bits.push(0);
  const daten = [];
  for (let k = 0; k < bits.length; k += 8) daten.push(parseInt(bits.slice(k, k + 8).join(''), 2));
  for (let pad = 0xec; daten.length < kapazitaet / 8; pad ^= 0xec ^ 0x11) daten.push(pad);

  const nBloecke = BLOECKE[i][version];
  const ecJe = EC_JE_BLOCK[i][version];
  const gesamt = gesamtCodewoerter(version);
  const kurz = nBloecke - (gesamt % nBloecke);
  const kurzLaenge = Math.floor(gesamt / nBloecke);
  const bloecke = [];
  const ecs = [];
  for (let b = 0, k = 0; b < nBloecke; b++) {
    const laenge = kurzLaenge - ecJe + (b < kurz ? 0 : 1);
    const teil = daten.slice(k, k + laenge);
    k += laenge;
    bloecke.push(teil);
    ecs.push(reedSolomon(teil, ecJe));
  }
  const out = [];
  for (let k = 0; k < bloecke[bloecke.length - 1].length; k++) for (const b of bloecke) if (k < b.length) out.push(b[k]);
  for (let k = 0; k < ecJe; k++) for (const e of ecs) out.push(e[k]);
  return out;
}

/**
 * Erzeugt einen QR-Code.
 * @param {string|Uint8Array|number[]} daten  Text (wird UTF-8) oder Bytes
 * @param {{stufe?:'L'|'M'|'Q'|'H', minVersion?:number, maxVersion?:number, maske?:number}} [opt]
 * @returns {{version:number, groesse:number, stufe:string, maske:number, module:boolean[][]}}
 * @throws wenn die Daten in keine erlaubte Version passen
 */
export function qrCode(daten, { stufe = 'M', minVersion = 1, maxVersion = 40, maske = -1 } = {}) {
  if (!STUFEN[stufe]) throw new Error('Unbekannte Fehlerkorrekturstufe.');
  const bytes = utf8(daten);
  let version = minVersion;
  while (version <= maxVersion && byteKapazitaet(version, stufe) < bytes.length) version++;
  if (version > maxVersion) throw new Error('Die Daten sind für den QR-Code zu lang.');

  const cw = codewoerter(bytes, version, stufe);
  const basis = gitter(version);
  datenPlatzieren(basis, cw);

  let beste = null;
  for (let nr = 0; nr < 8; nr++) {
    if (maske >= 0 && nr !== maske) continue;
    const g = { n: basis.n, fest: basis.fest, m: basis.m.map((z) => z.slice()) };
    maskieren(g, nr);
    formatEintragen(g, stufe, nr);
    versionEintragen(g, version);
    const s = strafe(g.m);
    if (!beste || s < beste.s) beste = { s, g, nr };
  }
  return { version, groesse: basis.n, stufe, maske: beste.nr, module: beste.g.m };
}

/**
 * Die dunklen Module als Rechtecke (je Zeile zusammenhängende Läufe), in
 * Modulen gemessen: [{x, y, b}] mit Höhe 1. Spart gegenüber einem Rechteck
 * je Modul rund die Hälfte der Zeichenbefehle.
 */
export function laeufe(module) {
  const out = [];
  module.forEach((zeile, y) => {
    let x = 0;
    while (x < zeile.length) {
      if (!zeile[x]) { x++; continue; }
      let b = 1;
      while (x + b < zeile.length && zeile[x + b]) b++;
      out.push({ x, y, b });
      x += b;
    }
  });
  return out;
}
