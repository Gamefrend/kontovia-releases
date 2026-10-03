/**
 * Kontovia – ein kleiner PDF-Schreiber, ohne fremden Code.
 *
 * Erzeugt PDF 1.4 mit den Standardschriften Helvetica, Helvetica-Bold und
 * Helvetica-Oblique in der Kodierung WinAnsi. Die Schriften gehören zu den 14,
 * die jedes PDF-Programm mitbringt; eingebettet wird deshalb nichts, und der
 * Text bleibt markier-, durchsuch- und kopierbar. WinAnsi deckt alles ab, was
 * eine deutsche Buchhaltung braucht: ä ö ü ß, €, §, „ “, –.
 *
 * Diese Datei kennt nur Seiten, Text, Linien und Flächen. Was auf welche
 * Seite kommt, entscheidet dokument.js.
 *
 * Koordinaten: in Punkt (1/72 Zoll), Ursprung oben links. Umgerechnet auf
 * den PDF-Ursprung unten links wird erst beim Schreiben.
 */

export const MM = 72 / 25.4;
export const A4 = { breite: 595.28, hoehe: 841.89 };

/* -------------------------------------------------------------------------- */
/* Zeichen und Breiten                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Laufweiten der Zeichen 32 bis 255 in WinAnsi, in Tausendsteln der
 * Schriftgröße. Ausgelesen aus Arial (maßgleich zu Helvetica), einzelne
 * Zeichen auf die Werte der Helvetica-Metriken von Adobe gesetzt
 * (± · µ ÷). Sie stehen zusätzlich im PDF (/Widths), damit jedes Programm
 * genauso misst wie diese Datei: rechtsbündige Beträge bleiben bündig.
 */
const BREITEN = {
  normal: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 552, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500],
  fett: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 552, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556],
};
BREITEN.kursiv = BREITEN.normal;

/** Unicode → WinAnsi für die Zeichen 0x80–0x9F. */
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
/** Was WinAnsi nicht hat, durch Ähnliches ersetzen statt durch „?“. */
const ERSATZ = new Map([
  [0x2212, '-'], [0x2192, '->'], [0x2190, '<-'], [0x2264, '<='], [0x2265, '>='], [0x2248, '~'], [0x2260, '!='],
  [0x00a0, ' '], [0x202f, ' '], [0x2009, ' '], [0x2007, ' '], [0x2011, '-'], [0x2010, '-'], [0x2212, '-'],
  [0x2713, 'x'], [0x2714, 'x'], [0x00ad, ''], [0x200b, ''], [0xfeff, ''], [0x2032, "'"], [0x2033, '"'],
  [0x00d8, 'Ø'],
]);

/** Text als WinAnsi-Codes; Zeilenumbrüche und Steuerzeichen werden zu Leerzeichen. */
export function winAnsi(text) {
  const out = [];
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp < 32) out.push(32);
    else if (cp < 128 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (CP1252.has(cp)) out.push(CP1252.get(cp));
    else if (ERSATZ.has(cp)) for (const e of ERSATZ.get(cp)) out.push(e.codePointAt(0) <= 0xff ? e.codePointAt(0) : 63);
    else out.push(63); // „?“
  }
  return out;
}

/** Breite eines Textes in Punkt. */
export function textBreite(text, groesse, schrift = 'normal') {
  const b = BREITEN[schrift] || BREITEN.normal;
  let summe = 0;
  for (const c of winAnsi(text)) summe += c >= 32 ? b[c - 32] : 0;
  return (summe * groesse) / 1000;
}

/* -------------------------------------------------------------------------- */
/* Seiten                                                                      */
/* -------------------------------------------------------------------------- */

const SCHRIFT = { normal: 'F1', fett: 'F2', kursiv: 'F3' };
const zahl = (n) => (Math.round(n * 100) / 100).toString();

/** Farbe als #rrggbb oder [r, g, b] (0–1) in PDF-Anweisungen. */
function farbe(f) {
  if (Array.isArray(f)) return f.map(zahl).join(' ');
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(f || '#000000'));
  if (!m) return '0 0 0';
  return [m[1], m[2], m[3]].map((h) => zahl(parseInt(h, 16) / 255)).join(' ');
}

/** Ein Text als PDF-Zeichenkette (WinAnsi-Bytes, Sonderzeichen maskiert). */
function zeichenkette(text) {
  let s = '(';
  for (const c of winAnsi(text)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

export class Seite {
  constructor({ quer = false } = {}) {
    this.breite = quer ? A4.hoehe : A4.breite;
    this.hoehe = quer ? A4.breite : A4.hoehe;
    this.ops = [];
  }

  /** Text, Grundlinie bei y. */
  text(x, y, text, { groesse = 10, schrift = 'normal', farbe: f = '#14181d' } = {}) {
    if (!String(text ?? '').length) return;
    this.ops.push(`BT /${SCHRIFT[schrift] || 'F1'} ${zahl(groesse)} Tf ${farbe(f)} rg 1 0 0 1 ${zahl(x)} ${zahl(this.hoehe - y)} Tm ${zeichenkette(text)} Tj ET`);
  }

  linie(x1, y1, x2, y2, { staerke = 0.5, farbe: f = '#000000' } = {}) {
    this.ops.push(`${zahl(staerke)} w ${farbe(f)} RG ${zahl(x1)} ${zahl(this.hoehe - y1)} m ${zahl(x2)} ${zahl(this.hoehe - y2)} l S`);
  }

  /** Rechteck, oben links bei (x, y). */
  rechteck(x, y, b, h, { fuellung = null, rand = null, staerke = 0.5 } = {}) {
    const r = `${zahl(x)} ${zahl(this.hoehe - y - h)} ${zahl(b)} ${zahl(h)} re`;
    if (fuellung && rand) this.ops.push(`${farbe(fuellung)} rg ${zahl(staerke)} w ${farbe(rand)} RG ${r} B`);
    else if (fuellung) this.ops.push(`${farbe(fuellung)} rg ${r} f`);
    else if (rand) this.ops.push(`${zahl(staerke)} w ${farbe(rand)} RG ${r} S`);
  }
}

/* -------------------------------------------------------------------------- */
/* Datei                                                                       */
/* -------------------------------------------------------------------------- */

const enc = new TextEncoder();
const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

async function packen(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Text für das Info-Verzeichnis: UTF-16BE mit Byte-Order-Mark, als Hex. */
function infoText(text) {
  let hex = 'FEFF';
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    const einheiten = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    for (const u of einheiten) hex += u.toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

function pdfDatum(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const vz = off >= 0 ? '+' : '-';
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    + `${vz}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}

/**
 * Setzt die Seiten zu einer PDF-Datei zusammen.
 * @param {Seite[]} seiten
 * @param {{titel?:string, autor?:string, betreff?:string, jetzt?:Date}} info
 * @returns {Promise<Uint8Array>}
 */
export async function pdfDatei(seiten, { titel = '', autor = '', betreff = '', jetzt = new Date() } = {}) {
  const objekte = []; // Nummer = Index + 1; Inhalt als Uint8Array
  const neu = () => objekte.push(null);
  const setzen = (nr, teile) => { objekte[nr - 1] = teile; };

  const katalog = neu();
  const baum = neu();
  const schriften = {};
  for (const [art, name] of [['normal', 'Helvetica'], ['fett', 'Helvetica-Bold'], ['kursiv', 'Helvetica-Oblique']]) {
    const nr = neu();
    schriften[art] = nr;
    setzen(nr, [latin1(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding `
      + `/FirstChar 32 /LastChar 255 /Widths [${BREITEN[art].join(' ')}] >>`)]);
  }
  const ressourcen = `<< /Font << /F1 ${schriften.normal} 0 R /F2 ${schriften.fett} 0 R /F3 ${schriften.kursiv} 0 R >> >>`;

  const kinder = [];
  for (const s of seiten) {
    const seitenNr = neu();
    const inhaltNr = neu();
    kinder.push(seitenNr);
    setzen(seitenNr, [latin1(`<< /Type /Page /Parent ${baum} 0 R /MediaBox [0 0 ${zahl(s.breite)} ${zahl(s.hoehe)}] `
      + `/Resources ${ressourcen} /Contents ${inhaltNr} 0 R >>`)]);
    const roh = latin1(s.ops.join('\n'));
    const gepackt = await packen(roh);
    const daten = gepackt || roh;
    setzen(inhaltNr, [
      latin1(`<< /Length ${daten.length}${gepackt ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
      daten,
      latin1('\nendstream'),
    ]);
  }
  setzen(katalog, [latin1(`<< /Type /Catalog /Pages ${baum} 0 R >>`)]);
  setzen(baum, [latin1(`<< /Type /Pages /Kids [${kinder.map((k) => `${k} 0 R`).join(' ')}] /Count ${kinder.length} >>`)]);
  const infoNr = neu();
  setzen(infoNr, [latin1(`<< /Title ${infoText(titel)} /Author ${infoText(autor)} /Subject ${infoText(betreff)} `
    + `/Creator ${infoText('Kontovia')} /Producer ${infoText('Kontovia')} /CreationDate (${pdfDatum(jetzt)}) >>`)]);

  // Zusammensetzen mit Querverweistabelle.
  const teile = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let laenge = teile[0].length;
  const versatz = [];
  objekte.forEach((inhalt, i) => {
    versatz.push(laenge);
    const kopf = latin1(`${i + 1} 0 obj\n`);
    const fuss = latin1('\nendobj\n');
    teile.push(kopf, ...inhalt, fuss);
    laenge += kopf.length + inhalt.reduce((n, t) => n + t.length, 0) + fuss.length;
  });
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  let xref = `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const v of versatz) xref += `${String(v).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objekte.length + 1} /Root ${katalog} 0 R /Info ${infoNr} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${laenge}\n%%EOF\n`;
  teile.push(enc.encode(xref));

  const gesamt = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let o = 0;
  for (const t of teile) { gesamt.set(t, o); o += t.length; }
  return gesamt;
}
