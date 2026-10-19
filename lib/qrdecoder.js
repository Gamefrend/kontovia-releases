/**
 * Kontovia – QR-Codes in Kamerabildern finden und lesen, selbst geschrieben.
 *
 * Gebraucht für die Kopplung eines zweiten Geräts in Browsern ohne eigenen
 * Strichcode-Leser (Safari auf dem iPhone, Firefox). lib/qrlesen.js nimmt den
 * Leser des Browsers, wo es ihn gibt, sonst diesen. Es gibt keine
 * Abhängigkeit und keinen fremden Code. `qrLesen` ist eine reine Funktion:
 * Bilddaten ({data, width, height}, RGBA wie ImageData, oder ein Grauwert je
 * Pixel) hinein, Text oder null heraus. So läuft sie auch in den Prüfungen
 * (scripts/pruefungen/entsperrung.test.js) mit Bildern, die aus lib/qr.js
 * gezeichnet werden.
 *
 * Ablauf:
 *  1. Graustufen, dann Schwarz/Weiß mit örtlicher Schwelle (Blöcke von 8 × 8
 *     Pixeln, gemittelt über die Nachbarn), damit Schatten und Verläufe nicht
 *     stören. Klappt es nicht, ein zweiter Versuch mit leicht geglättetem Bild
 *     (gegen Bildrauschen).
 *  2. Suchmuster: Zeilen nach Läufen dunkel-hell-dunkel-hell-dunkel im
 *     Verhältnis 1:1:3:1:1 absuchen, senkrecht, waagrecht und diagonal
 *     gegenprüfen. Das geht in jeder Drehung, weil die Ringe konzentrisch sind.
 *     Drei passende bilden ein rechtwinkliges Dreieck, die Ecke am rechten
 *     Winkel liegt oben links.
 *  3. Größe: die Modulbreite entlang der Kanten messen, daraus die Version.
 *  4. Entzerrung: das Ausrichtungsmuster unten rechts suchen (ab Version 2) und
 *     aus vier Punkten eine Perspektive (Homographie) bestimmen; ohne es gilt
 *     ein Parallelogramm.
 *  5. Module abtasten, Format (Stufe, Maske) und ab Version 7 die Version aus
 *     den Schutzbits lesen, Maske entfernen, Codewörter im Zickzack lesen,
 *     Blöcke entschachteln, je Block Reed-Solomon korrigieren
 *     (Berlekamp-Massey, Chien, Forney), Bytemodus lesen (UTF-8).
 *
 * Bild und Text bleiben im Gerät: Hier wird nichts gemerkt, gesendet oder
 * protokolliert, und Fehler tragen nie den gelesenen Inhalt.
 */

import { STUFEN, blockAufbau, funktionsModule, formatBits, versionBits, MASKEN } from './qr.js';

/* -------------------------------------------------------------------------- */
/* Reed-Solomon über GF(256), Polynom 0x11D, Wurzeln α^0 … α^(n-1)             */
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
const durch = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
/** α hoch i, auch für negative i. */
const hoch = (i) => EXP[((i % 255) + 255) % 255];

/** Prüfwerte (Syndrome) eines Blocks; true, wenn alle null sind. */
function syndrome(block, ec, s) {
  let null_ = true;
  for (let j = 0; j < ec; j++) {
    const a = EXP[j];
    let w = 0;
    for (let i = 0; i < block.length; i++) w = mal(w, a) ^ block[i];
    s[j] = w;
    if (w) null_ = false;
  }
  return null_;
}

/**
 * Korrigiert einen Block (Daten und Korrekturbytes, höchster Grad zuerst) an
 * Ort und Stelle. Bis zu ec/2 falsche Bytes lassen sich beheben.
 * @returns {boolean} false, wenn der Block zu stark beschädigt ist
 */
export function rsKorrigieren(block, ec) {
  const n = block.length;
  const s = new Array(ec);
  if (syndrome(block, ec, s)) return true;
  // Berlekamp-Massey: das Fehlerort-Polynom C (niedrigster Grad zuerst)
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let k = 0; k < ec; k++) {
    let d = s[k];
    for (let i = 1; i <= L; i++) d ^= mal(C[i] || 0, s[k - i]);
    if (d === 0) { m++; continue; }
    const f = durch(d, b);
    const neu = C.slice();
    while (neu.length < B.length + m) neu.push(0);
    for (let i = 0; i < B.length; i++) neu[i + m] ^= mal(f, B[i]);
    if (2 * L <= k) { B = C; L = k + 1 - L; b = d; m = 1; } else m++;
    C = neu;
  }
  if (2 * L > ec) return false;
  // Chien: an welchen Stellen ist C(X^-1) = 0?
  const orte = [];
  for (let i = 0; i < n; i++) {
    const xinv = hoch(-(n - 1 - i));
    let w = 0;
    for (let k = C.length - 1; k >= 0; k--) w = mal(w, xinv) ^ C[k];
    if (w === 0) orte.push(i);
  }
  if (orte.length !== L) return false;
  // Forney: Ω = S·C mod x^ec, Fehlerwert = X · Ω(X^-1) / C'(X^-1)
  const om = new Array(ec).fill(0);
  for (let i = 0; i < ec; i++) for (let k = 0; k <= i && k < C.length; k++) om[i] ^= mal(C[k], s[i - k]);
  for (const i of orte) {
    const p = n - 1 - i;
    const xinv = hoch(-p);
    let o = 0;
    for (let k = ec - 1; k >= 0; k--) o = mal(o, xinv) ^ om[k];
    let ab = 0;
    for (let k = 1; k < C.length; k += 2) ab ^= mal(C[k], hoch(-p * (k - 1)));
    if (!ab) return false;
    block[i] ^= mal(hoch(p), durch(o, ab));
  }
  return syndrome(block, ec, s);
}

/* -------------------------------------------------------------------------- */
/* Aus der Modulmatrix lesen                                                   */
/* -------------------------------------------------------------------------- */

const bitsAnders = (a, b) => {
  let x = a ^ b;
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
};

/** Stufe und Maske aus beiden Kopien der Formatinformation (bis 3 falsche Bits). */
function formatLesen(m) {
  const n = m.length;
  const bit = (y, x) => (m[y][x] ? 1 : 0);
  let a = 0;
  let b = 0;
  for (let i = 0; i <= 5; i++) a |= bit(i, 8) << i;
  a |= bit(7, 8) << 6;
  a |= bit(8, 8) << 7;
  a |= bit(8, 7) << 8;
  for (let i = 9; i < 15; i++) a |= bit(8, 14 - i) << i;
  for (let i = 0; i < 8; i++) b |= bit(8, n - 1 - i) << i;
  for (let i = 8; i < 15; i++) b |= bit(n - 15 + i, 8) << i;
  let beste = null;
  for (const stufe of Object.keys(STUFEN)) {
    for (let maske = 0; maske < 8; maske++) {
      const f = formatBits(stufe, maske);
      const d = Math.min(bitsAnders(a, f), bitsAnders(b, f));
      if (!beste || d < beste.d) beste = { d, stufe, maske };
    }
  }
  return beste.d <= 3 ? beste : null;
}

/** Die Version aus der Versionsinformation (ab Version 7), sonst 0. */
function versionLesen(m) {
  const n = m.length;
  let a = 0;
  let b = 0;
  for (let i = 0; i < 18; i++) {
    const p = n - 11 + (i % 3);
    const q = Math.floor(i / 3);
    a |= (m[q][p] ? 1 : 0) << i;
    b |= (m[p][q] ? 1 : 0) << i;
  }
  let beste = null;
  for (let v = 7; v <= 40; v++) {
    const d = Math.min(bitsAnders(a, versionBits(v)), bitsAnders(b, versionBits(v)));
    if (!beste || d < beste.d) beste = { d, v };
  }
  return beste.d <= 3 ? beste.v : 0;
}

/** Datenbits im Bytemodus lesen (ECI wird übergangen). */
function bytesLesen(daten, version) {
  const gesamt = daten.length * 8;
  let pos = 0;
  const lies = (anzahl) => {
    if (pos + anzahl > gesamt) return -1;
    let v = 0;
    for (let k = 0; k < anzahl; k++, pos++) v = (v * 2) + ((daten[pos >>> 3] >>> (7 - (pos & 7))) & 1);
    return v;
  };
  const out = [];
  while (pos + 4 <= gesamt) {
    const modus = lies(4);
    if (modus === 0) break;
    if (modus === 0b0111) {
      const a = lies(8);
      if (a < 0) return null;
      if ((a & 0xc0) === 0x80) { if (lies(8) < 0) return null; } else if ((a & 0xe0) === 0xc0) { if (lies(16) < 0) return null; } else if (a & 0x80) return null;
      continue;
    }
    if (modus !== 0b0100) return null;
    const anzahl = lies(version <= 9 ? 8 : 16);
    if (anzahl < 0) return null;
    for (let k = 0; k < anzahl; k++) {
      const b = lies(8);
      if (b < 0) return null;
      out.push(b);
    }
  }
  return out;
}

const festJeVersion = new Map();
const fest = (v) => {
  if (!festJeVersion.has(v)) festJeVersion.set(v, funktionsModule(v));
  return festJeVersion.get(v);
};

/**
 * Liest eine Modulmatrix (Zeilen, dunkel = wahr), wie sie lib/qr.js erzeugt
 * oder die Kamera abtastet.
 * @param {ArrayLike<ArrayLike<unknown>>} m
 * @returns {string|null}
 */
export function matrixLesen(m) {
  const n = m?.length || 0;
  if (n < 21 || n > 177 || (n - 17) % 4) return null;
  const version = (n - 17) / 4;
  if (version >= 7) {
    const v = versionLesen(m);
    if (v && v !== version) return null;
  }
  const fmt = formatLesen(m);
  if (!fmt) return null;
  const f = fest(version);
  const maske = MASKEN[fmt.maske];
  const { bloecke, ecJe, gesamt } = blockAufbau(version, fmt.stufe);
  const cw = new Uint8Array(gesamt);
  const bits = gesamt * 8;
  let i = 0;
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    const aufwaerts = ((rechts + 1) & 2) === 0;
    for (let v = 0; v < n && i < bits; v++) {
      const y = aufwaerts ? n - 1 - v : v;
      for (let j = 0; j < 2 && i < bits; j++) {
        const x = rechts - j;
        if (f[y][x]) continue;
        if (!m[y][x] !== !maske(x, y)) cw[i >>> 3] |= 0x80 >>> (i & 7);
        i++;
      }
    }
  }
  // Entschachteln: erst die Datenbytes reihum, dann die Korrekturbytes
  const kurz = bloecke - (gesamt % bloecke);
  const kurzLaenge = Math.floor(gesamt / bloecke);
  const laengen = [];
  for (let b = 0; b < bloecke; b++) laengen.push(kurzLaenge - ecJe + (b < kurz ? 0 : 1));
  const teile = laengen.map((l) => new Uint8Array(l + ecJe));
  let k = 0;
  for (let p = 0; p < laengen[bloecke - 1]; p++) for (let b = 0; b < bloecke; b++) if (p < laengen[b]) teile[b][p] = cw[k++];
  for (let p = 0; p < ecJe; p++) for (let b = 0; b < bloecke; b++) teile[b][laengen[b] + p] = cw[k++];
  const daten = [];
  for (let b = 0; b < bloecke; b++) {
    if (!rsKorrigieren(teile[b], ecJe)) return null;
    for (let p = 0; p < laengen[b]; p++) daten.push(teile[b][p]);
  }
  const bytes = bytesLesen(daten, version);
  if (!bytes || !bytes.length) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return null; }
}

const transponiert = (m) => m.map((_, y) => m.map((z) => z[y]));

/* -------------------------------------------------------------------------- */
/* Bild: Graustufen und Schwarz/Weiß                                           */
/* -------------------------------------------------------------------------- */

function grau({ data, width: w, height: h }) {
  const n = w * h;
  const g = new Uint8Array(n);
  if (data.length === n) { g.set(data); return g; }
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  return g;
}

/** 3 × 3 gemittelt: nimmt Bildrauschen die Spitzen. */
function weich(g, w, h) {
  const t = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const z = y * w;
    for (let x = 0; x < w; x++) t[z + x] = g[z + (x > 0 ? x - 1 : x)] + g[z + x] + g[z + (x < w - 1 ? x + 1 : x)];
  }
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const oben = (y > 0 ? y - 1 : y) * w;
    const unten = (y < h - 1 ? y + 1 : y) * w;
    const z = y * w;
    for (let x = 0; x < w; x++) o[z + x] = ((t[oben + x] + t[z + x] + t[unten + x]) / 9) | 0;
  }
  return o;
}

const BLOCK = 8;
const KONTRAST = 24;

/** Schwarz/Weiß (1 = dunkel) mit einer Schwelle je Block, gemittelt über 5 × 5 Blöcke. */
function binaer(g, w, h) {
  const bw = Math.ceil(w / BLOCK);
  const bh = Math.ceil(h / BLOCK);
  const mittel = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let min = 255;
      let max = 0;
      let summe = 0;
      let anzahl = 0;
      const y1 = Math.min(h, by * BLOCK + BLOCK);
      const x1 = Math.min(w, bx * BLOCK + BLOCK);
      for (let y = by * BLOCK; y < y1; y++) {
        for (let x = bx * BLOCK, i = y * w + x; x < x1; x++, i++) {
          const v = g[i];
          summe += v;
          anzahl++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      let wert = summe / anzahl;
      if (max - min <= KONTRAST) {
        // Gleichmäßiger Block: hell, außer die Nachbarn sagen, er liegt in einer dunklen Fläche.
        wert = min / 2;
        if (by > 0 && bx > 0) {
          const nb = (mittel[(by - 1) * bw + bx] + 2 * mittel[by * bw + bx - 1] + mittel[(by - 1) * bw + bx - 1]) / 4;
          if (min < nb) wert = nb;
        }
      }
      mittel[by * bw + bx] = wert;
    }
  }
  const bin = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = Math.min(bh - 1, Math.max(0, by + dy)) * bw;
        for (let dx = -2; dx <= 2; dx++) s += mittel[yy + Math.min(bw - 1, Math.max(0, bx + dx))];
      }
      const schwelle = s / 25;
      const y1 = Math.min(h, by * BLOCK + BLOCK);
      const x1 = Math.min(w, bx * BLOCK + BLOCK);
      for (let y = by * BLOCK; y < y1; y++) {
        for (let x = bx * BLOCK, i = y * w + x; x < x1; x++, i++) bin[i] = g[i] <= schwelle ? 1 : 0;
      }
    }
  }
  return bin;
}

/* -------------------------------------------------------------------------- */
/* Suchmuster                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Drei Läufe ab (x, y) in Richtung (dx, dy): dunkel, hell, dunkel. Die ersten
 * zwei dürfen nicht länger als `grenze` sein, der dritte wird dort gekappt.
 */
function strahl(bin, w, h, x, y, dx, dy, grenze, out) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  let i = 0;
  let soll = 1;
  while (x >= 0 && y >= 0 && x < w && y < h) {
    if (bin[y * w + x] !== soll) {
      if (++i === 3) return true;
      soll ^= 1;
    }
    if (++out[i] > grenze) return i === 2;
    x += dx;
    y += dy;
  }
  return i === 2;
}

const VOR = [0, 0, 0];
const RUECK = [0, 0, 0];

/** Fünf Läufe durch einen dunklen Punkt in beide Richtungen, dazu die Mitte des mittleren (relativ zum Pixel). */
function kreuz(bin, w, h, x, y, dx, dy, grenze) {
  if (x < 0 || y < 0 || x >= w || y >= h || !bin[y * w + x]) return null;
  if (!strahl(bin, w, h, x, y, dx, dy, grenze, VOR)) return null;
  if (!strahl(bin, w, h, x - dx, y - dy, -dx, -dy, grenze, RUECK)) return null;
  return { l: [RUECK[2], RUECK[1], RUECK[0] + VOR[0], VOR[1], VOR[2]], mitte: (VOR[0] - RUECK[0]) / 2 };
}

const summe = (l) => l[0] + l[1] + l[2] + l[3] + l[4];

/** Stimmen die Läufe zum Verhältnis 1:1:3:1:1? */
function suchVerhaeltnis(l, toleranz = 0.6) {
  const total = summe(l);
  if (total < 7) return false;
  const m = total / 7;
  const t = m * toleranz;
  return Math.abs(l[0] - m) < t && Math.abs(l[1] - m) < t && Math.abs(l[2] - 3 * m) < 3 * t
    && Math.abs(l[3] - m) < t && Math.abs(l[4] - m) < t;
}

/** Ein Treffer in einer Zeile: senkrecht, waagrecht und diagonal nachprüfen. */
function suchPruefen(bin, w, h, cx, y, total) {
  const x = Math.floor(cx);
  const s = kreuz(bin, w, h, x, y, 0, 1, total);
  if (!s || !suchVerhaeltnis(s.l)) return null;
  const sv = summe(s.l);
  if (Math.abs(sv - total) > 0.4 * Math.max(sv, total)) return null;
  const ny = y + 0.5 + s.mitte;
  const z = kreuz(bin, w, h, x, Math.floor(ny), 1, 0, total * 1.5);
  if (!z || !suchVerhaeltnis(z.l)) return null;
  const nx = x + 0.5 + z.mitte;
  const d = kreuz(bin, w, h, Math.floor(nx), Math.floor(ny), 1, 1, total * 1.5);
  if (!d || !suchVerhaeltnis(d.l, 0.75)) return null;
  return { x: nx, y: ny, m: (sv + summe(z.l)) / 14, n: 1 };
}

/** Alle Suchmuster-Kandidaten im Bild, zusammengefasst. */
function sucherFinden(bin, w, h) {
  const kand = [];
  const starts = new Int32Array(w + 1);
  const laeufe = new Int32Array(w + 1);
  const schritt = h > 720 ? 2 : 1;
  for (let y = 0; y < h; y += schritt) {
    const zeile = y * w;
    let n = 0;
    let start = 0;
    for (let x = 1; x <= w; x++) {
      if (x === w || bin[zeile + x] !== bin[zeile + x - 1]) { starts[n] = start; laeufe[n++] = x - start; start = x; }
    }
    for (let k = bin[zeile] ? 0 : 1; k + 4 < n; k += 2) {
      const l = [laeufe[k], laeufe[k + 1], laeufe[k + 2], laeufe[k + 3], laeufe[k + 4]];
      if (!suchVerhaeltnis(l)) continue;
      const c = suchPruefen(bin, w, h, starts[k + 2] + laeufe[k + 2] / 2, y, summe(l));
      if (!c) continue;
      const da = kand.find((q) => Math.abs(q.x - c.x) <= q.m * 2 && Math.abs(q.y - c.y) <= q.m * 2 && c.m < q.m * 2 && q.m < c.m * 2);
      if (da) {
        da.x = (da.x * da.n + c.x) / (da.n + 1);
        da.y = (da.y * da.n + c.y) / (da.n + 1);
        da.m = (da.m * da.n + c.m) / (da.n + 1);
        da.n++;
      } else if (kand.length < 200) kand.push(c);
    }
  }
  return kand;
}

const abstand = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Die besten Dreiecke aus drei Suchmustern: [oben links, oben rechts, unten links]. */
function dreiecke(kand) {
  const sicher = kand.filter((k) => k.n >= 2);
  const basis = (sicher.length >= 3 ? sicher : kand).slice().sort((a, b) => b.n - a.n).slice(0, 12);
  const out = [];
  for (let i = 0; i < basis.length; i++) {
    for (let j = i + 1; j < basis.length; j++) {
      for (let k = j + 1; k < basis.length; k++) {
        const p = [basis[i], basis[j], basis[k]];
        const groesse = Math.max(p[0].m, p[1].m, p[2].m) / Math.min(p[0].m, p[1].m, p[2].m);
        if (groesse > 2.5) continue;
        const d01 = abstand(p[0], p[1]);
        const d02 = abstand(p[0], p[2]);
        const d12 = abstand(p[1], p[2]);
        const [a, b, c] = d12 >= d01 && d12 >= d02 ? [p[0], p[1], p[2]] : d02 >= d01 ? [p[1], p[0], p[2]] : [p[2], p[0], p[1]];
        const ab = abstand(a, b);
        const ac = abstand(a, c);
        const mm = (a.m + b.m + c.m) / 3;
        if (Math.min(ab, ac) < 8 * mm) continue;
        const seiten = Math.max(ab, ac) / Math.min(ab, ac);
        if (seiten > 1.6) continue;
        const cos = ((b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y)) / (ab * ac);
        if (Math.abs(cos) > 0.4) continue;
        const dreh = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        out.push({ s: (seiten - 1) + Math.abs(cos) + (groesse - 1) / 2, d: dreh > 0 ? [a, b, c] : [a, c, b] });
      }
    }
  }
  return out.sort((x, y) => x.s - y.s).slice(0, 4).map((o) => o.d);
}

/* -------------------------------------------------------------------------- */
/* Größe, Ausrichtung, Entzerrung                                              */
/* -------------------------------------------------------------------------- */

/** Abstand von der Mitte eines Suchmusters bis zum Ende seines äußeren Rings (3,5 Module). */
function randAbstand(bin, w, h, x, y, ux, uy, max) {
  let zustand = 0;
  for (let t = 0; t <= max; t += 0.5) {
    const px = Math.floor(x + ux * t);
    const py = Math.floor(y + uy * t);
    if (px < 0 || py < 0 || px >= w || py >= h) return zustand === 2 ? t : NaN;
    const dunkel = bin[py * w + px] === 1;
    if (zustand === 0 && !dunkel) zustand = 1;
    else if (zustand === 1 && dunkel) zustand = 2;
    else if (zustand === 2 && !dunkel) return t;
  }
  return NaN;
}

/** Modulbreite entlang der Kante von a nach b, an beiden Suchmustern gemessen. */
function modulLaengs(bin, w, h, a, b) {
  const d = abstand(a, b);
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  const werte = [];
  for (const [p, sx] of [[a, 1], [b, -1]]) {
    const max = p.m * 8;
    const hin = randAbstand(bin, w, h, p.x, p.y, ux * sx, uy * sx, max);
    const her = randAbstand(bin, w, h, p.x, p.y, -ux * sx, -uy * sx, max);
    if (hin > 0 && her > 0) werte.push((hin + her) / 7);
  }
  return werte.length ? werte.reduce((s, v) => s + v, 0) / werte.length : (a.m + b.m) / 2;
}

/**
 * Kandidaten für das Ausrichtungsmuster (1:1:1 um eine dunkle Mitte) nahe der
 * erwarteten Stelle, die nächsten zuerst. Bei schräg gehaltener Kamera liegt
 * es ein Stück daneben; welcher Kandidat stimmt, entscheidet die Korrektur.
 */
function ausrichtungSuchen(bin, w, h, ex, ey, modul) {
  const r = Math.max(4, Math.round(modul * 10));
  const x0 = Math.max(0, Math.floor(ex - r));
  const x1 = Math.min(w, Math.ceil(ex + r));
  const y0 = Math.max(0, Math.floor(ey - r));
  const y1 = Math.min(h, Math.ceil(ey + r));
  if (x1 - x0 < 5 || y1 - y0 < 5) return [];
  const lo = modul * 0.4;
  const hi = modul * 2.2;
  const passt = (l) => l >= lo && l <= hi;
  const starts = new Int32Array(x1 - x0 + 1);
  const laeufe = new Int32Array(x1 - x0 + 1);
  const gefunden = [];
  for (let y = y0; y < y1; y++) {
    const zeile = y * w;
    let n = 0;
    let start = x0;
    for (let x = x0 + 1; x <= x1; x++) {
      if (x === x1 || bin[zeile + x] !== bin[zeile + x - 1]) { starts[n] = start; laeufe[n++] = x - start; start = x; }
    }
    for (let k = bin[zeile + x0] ? 2 : 3; k + 2 < n; k += 2) {
      const a = laeufe[k - 1];
      const b = laeufe[k];
      const c = laeufe[k + 1];
      if (!passt(a) || !passt(b) || !passt(c) || laeufe[k - 2] < lo || laeufe[k + 2] < lo) continue;
      if (Math.max(a, b, c) > 2 * Math.min(a, b, c)) continue;
      const x = Math.floor(starts[k] + b / 2);
      const s = kreuz(bin, w, h, x, y, 0, 1, hi * 1.5);
      if (!s || !passt(s.l[1]) || !passt(s.l[2]) || !passt(s.l[3]) || s.l[0] < lo || s.l[4] < lo) continue;
      const cy = y + 0.5 + s.mitte;
      const z = kreuz(bin, w, h, x, Math.floor(cy), 1, 0, hi * 1.5);
      if (!z || !passt(z.l[1]) || !passt(z.l[2]) || !passt(z.l[3])) continue;
      const cx = x + 0.5 + z.mitte;
      const d = Math.hypot(cx - ex, cy - ey);
      if (d > r) continue;
      const da = gefunden.find((q) => Math.hypot(q.x - cx, q.y - cy) < modul);
      if (da) { if (d < da.d) Object.assign(da, { x: cx, y: cy, d }); } else gefunden.push({ x: cx, y: cy, d });
    }
  }
  return gefunden.sort((a, b) => a.d - b.d).slice(0, 6);
}

/** Perspektive aus vier Punktpaaren (Modul → Bild), gelöst als lineares System. */
function homographie(von, nach) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = von[i];
    const [x, y] = nach[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const H = A.map((z, i) => z[8] / z[i]);
  return (u, v) => {
    const d = H[6] * u + H[7] * v + 1;
    return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d];
  };
}

/** Module abtasten; ab etwa drei Pixeln je Modul entscheidet die Mehrheit aus fünf Punkten. */
function abtasten(bin, w, h, abb, dim, modul) {
  const punkt = (u, v) => {
    const [px, py] = abb(u, v);
    const x = Math.floor(px);
    const y = Math.floor(py);
    return x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x];
  };
  const fuenf = modul >= 4;
  const m = [];
  for (let y = 0; y < dim; y++) {
    const z = new Uint8Array(dim);
    for (let x = 0; x < dim; x++) {
      const u = x + 0.5;
      const v = y + 0.5;
      z[x] = fuenf
        ? (punkt(u, v) + punkt(u - 0.22, v - 0.22) + punkt(u + 0.22, v - 0.22) + punkt(u - 0.22, v + 0.22) + punkt(u + 0.22, v + 0.22) >= 3 ? 1 : 0)
        : punkt(u, v);
    }
    m.push(z);
  }
  return m;
}

/**
 * Schnelle Vorprüfung: Zwischen den Suchmustern liegen in Zeile und Spalte 6
 * abwechselnd dunkle und helle Module (Zeitmuster). Passt das nicht, sind
 * Dreieck, Version oder Entzerrung falsch, und das teure Abtasten entfällt.
 * Ein Viertel Abweichung ist erlaubt (Schmutz, Kratzer).
 */
function zeitmusterPasst(bin, w, h, abb, dim) {
  let falsch = 0;
  let anzahl = 0;
  const dunkel = (u, v) => {
    const [px, py] = abb(u, v);
    const x = Math.floor(px);
    const y = Math.floor(py);
    return x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;
  };
  for (let i = 8; i <= dim - 9; i++) {
    if (dunkel(i + 0.5, 6.5) !== (i % 2 === 0)) falsch++;
    if (dunkel(6.5, i + 0.5) !== (i % 2 === 0)) falsch++;
    anzahl += 2;
  }
  return falsch <= anzahl * 0.25;
}

/** Mit fester Version lesen: erst mit Ausrichtungsmuster, dann als Parallelogramm. */
function mitVersion(bin, w, h, tl, tr, bl, version, modul) {
  const dim = 17 + 4 * version;
  const von = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5]];
  const nach = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];
  const abbildungen = [];
  if (version >= 2) {
    const f = (dim - 10) / (dim - 7);
    for (const ap of ausrichtungSuchen(bin, w, h, tl.x + (tr.x - tl.x + bl.x - tl.x) * f, tl.y + (tr.y - tl.y + bl.y - tl.y) * f, modul)) {
      abbildungen.push(homographie([...von, [dim - 6.5, dim - 6.5]], [...nach, [ap.x, ap.y]]));
    }
  }
  // Ohne (passendes) Ausrichtungsmuster: die vierte Ecke als Parallelogramm, dann
  // schrittweise verschoben, denn bei schräger Kamera liegt sie etwas daneben.
  const ex = [(tr.x - tl.x) / (dim - 7), (tr.y - tl.y) / (dim - 7)];
  const ey = [(bl.x - tl.x) / (dim - 7), (bl.y - tl.y) / (dim - 7)];
  for (const [a, b] of VERSCHIEBUNGEN) {
    const x = tr.x + bl.x - tl.x + a * ex[0] + b * ey[0];
    const y = tr.y + bl.y - tl.y + a * ex[1] + b * ey[1];
    abbildungen.push(homographie([...von, [dim - 3.5, dim - 3.5]], [...nach, [x, y]]));
  }
  let andere = 0;
  for (const abb of abbildungen) {
    if (!abb || !zeitmusterPasst(bin, w, h, abb, dim)) continue;
    const m = abtasten(bin, w, h, abb, dim, modul);
    if (version >= 7) {
      const v = versionLesen(m) || versionLesen(transponiert(m));
      if (v && v !== version) { andere ||= v; continue; }
    }
    const text = matrixLesen(m) ?? matrixLesen(transponiert(m));
    if (text !== null) return { text };
  }
  return andere ? { version: andere } : null;
}

/** Verschiebungen der vierten Ecke in Modulen, die kleinen zuerst. */
const VERSCHIEBUNGEN = (() => {
  const out = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) out.push([a, b]);
  return out.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
})();

function dreieckLesen(bin, w, h, tl, tr, bl) {
  const mx = modulLaengs(bin, w, h, tl, tr);
  const my = modulLaengs(bin, w, h, tl, bl);
  const dim = (abstand(tl, tr) / mx + abstand(tl, bl) / my) / 2 + 7;
  const v0 = Math.round((dim - 17) / 4);
  const versuche = [v0, v0 + 1, v0 - 1].filter((v) => v >= 1 && v <= 40);
  const versucht = new Set();
  const modul = (mx + my) / 2;
  while (versuche.length) {
    const v = versuche.shift();
    if (versucht.has(v)) continue;
    versucht.add(v);
    const r = mitVersion(bin, w, h, tl, tr, bl, v, modul);
    if (r?.text !== undefined) return r.text;
    if (r?.version && !versucht.has(r.version)) versuche.unshift(r.version);
  }
  return null;
}

function ausBinaer(bin, w, h) {
  const kand = sucherFinden(bin, w, h);
  if (kand.length < 3) return null;
  for (const [tl, tr, bl] of dreiecke(kand)) {
    const text = dreieckLesen(bin, w, h, tl, tr, bl);
    if (text !== null) return text;
  }
  return null;
}

/**
 * Sucht einen QR-Code im Bild und liest ihn.
 * @param {{data: ArrayLike<number>, width: number, height: number}} bild  RGBA (wie ImageData) oder ein Grauwert je Pixel
 * @returns {string|null} der Text, oder null, wenn keiner lesbar ist
 */
export function qrLesen(bild) {
  const w = bild?.width | 0;
  const h = bild?.height | 0;
  if (w < 21 || h < 21 || !bild.data || bild.data.length < w * h) return null;
  try {
    const g = grau(bild);
    return ausBinaer(binaer(g, w, h), w, h) ?? ausBinaer(binaer(weich(g, w, h), w, h), w, h);
  } catch {
    // Ein misslungenes Bild ist kein Fehler, nur kein Treffer (und der Inhalt erscheint nirgends).
    return null;
  }
}
