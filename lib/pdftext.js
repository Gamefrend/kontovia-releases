/**
 * Kontovia – Text aus einem PDF lesen, ohne fremde Bibliothek (für „Beleg lesen“, lib/beleglesen.js).
 *
 * Digitale Rechnungen (aus Buchhaltungs- und Shopsystemen) tragen ihren Text als Textebene. Dieser Leser geht die
 * Objekte der Datei durch (auch die in Objektströmen, PDF 1.5), entpackt Ströme (FlateDecode), ordnet je Seite
 * die Schriften ihren Zeichentabellen zu (ToUnicode-CMap, sonst WinAnsi) und setzt aus den Textbefehlen
 * (Tj, TJ, ', ", Td, TD, Tm, T*) Zeilen zusammen, auch aus Formularobjekten (Do). Ziel ist lesbarer Text für die
 * Erkennung von Betrag, Datum und Lieferant, kein exaktes Layout.
 *
 * Gescannte PDFs haben keine Textebene, nur Bilder. Dafür gibt der Leser die eingebetteten JPEG-Bilder
 * (DCTDecode) heraus; die liest die Texterkennung (src/web/ocr.js).
 *
 * Schutz: Größe, Zahl der Objekte, Länge entpackter Ströme und Tiefe der Formularobjekte sind begrenzt, damit
 * eine präparierte Datei den Browser nicht festhält. Verschlüsselte PDFs werden nicht gelesen.
 * Läuft im Browser und unter Node (DecompressionStream).
 */

const MAX_PDF = 25 * 1024 * 1024;
const MAX_OBJEKTE = 20000;
const MAX_ENTPACKT = 16 * 1024 * 1024;
const MAX_TEXT = 200000;
const MAX_BILDER = 8;

/** Bytes → Text mit einem Zeichen je Byte (Positionen bleiben gleich). */
const latin1 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
};

async function entpacken(daten) {
  const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream('deflate'));
  const leser = strom.getReader();
  const teile = [];
  let laenge = 0;
  for (;;) {
    let r;
    try { r = await leser.read(); } catch { break; } // abgeschnittene Ströme: was da ist, reicht oft
    if (r.done) break;
    laenge += r.value.length;
    if (laenge > MAX_ENTPACKT) { leser.cancel().catch(() => {}); throw new Error('Datenstrom zu groß.'); }
    teile.push(r.value);
  }
  const out = new Uint8Array(laenge);
  let o = 0;
  for (const t of teile) { out.set(t, o); o += t.length; }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Kleiner Leser für PDF-Werte (Wörterbücher, Felder, Namen, Verweise)         */
/* -------------------------------------------------------------------------- */

const WEISS = /[\0\t\n\f\r ]/;
const TRENN = /[\0\t\n\f\r ()<>[\]{}/%]/;

function wert(t, i) {
  const n = t.length;
  const weiter = () => { while (i < n) { if (WEISS.test(t[i])) i++; else if (t[i] === '%') { while (i < n && t[i] !== '\n' && t[i] !== '\r') i++; } else break; } };
  weiter();
  const c = t[i];
  if (c === '<' && t[i + 1] === '<') {
    i += 2;
    const d = {};
    for (;;) {
      weiter();
      if (i >= n) break;
      if (t[i] === '>' && t[i + 1] === '>') { i += 2; break; }
      if (t[i] !== '/') { i++; continue; }
      const k = wert(t, i); i = k.i;
      const v = wert(t, i); i = v.i;
      d[k.v.name] = v.v;
    }
    return { v: { dict: d }, i };
  }
  if (c === '[') {
    i++;
    const a = [];
    for (;;) {
      weiter();
      if (i >= n || t[i] === ']') { i++; break; }
      const v = wert(t, i); i = v.i; a.push(v.v);
    }
    return { v: a, i };
  }
  if (c === '/') {
    let j = i + 1;
    while (j < n && !TRENN.test(t[j])) j++;
    return { v: { name: t.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, i: j };
  }
  if (c === '(') { const s = literal(t, i); return { v: { str: s.s }, i: s.i }; }
  if (c === '<') { const j = t.indexOf('>', i); return { v: { str: hexText(t.slice(i + 1, j)) }, i: j + 1 }; }
  // Zahl, Verweis (n g R), true/false/null
  const m = /^([+-]?\d*\.?\d+)(?:\s+(\d+)\s+R(?![A-Za-z]))?/.exec(t.slice(i, i + 40));
  if (m) {
    if (m[2] !== undefined && /^\d+$/.test(m[1])) return { v: { ref: Number(m[1]) }, i: i + m[0].length };
    return { v: Number(m[1]), i: i + m[0].length };
  }
  let j = i;
  while (j < n && !TRENN.test(t[j])) j++;
  return { v: t.slice(i, j), i: Math.max(j, i + 1) };
}

function hexText(h) {
  const s = h.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let k = 0; k < s.length; k += 2) out += String.fromCharCode(parseInt((s.slice(k, k + 2) + '0').slice(0, 2), 16));
  return out;
}

function literal(t, i) {
  let tiefe = 0;
  let s = '';
  i++;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') {
      const d = t[++i];
      const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[d];
      if (esc !== undefined) s += esc;
      else if (/[0-7]/.test(d)) {
        let o = d;
        while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i];
        s += String.fromCharCode(parseInt(o, 8) & 0xff);
      } else if (d === '\r') { if (t[i + 1] === '\n') i++; } else if (d !== '\n') s += d;
    } else if (c === '(') { tiefe++; s += c; } else if (c === ')') { if (tiefe === 0) return { s, i: i + 1 }; tiefe--; s += c; } else s += c;
  }
  return { s, i };
}

/* -------------------------------------------------------------------------- */
/* Objekte der Datei                                                           */
/* -------------------------------------------------------------------------- */

async function objekteLesen(u8) {
  const t = latin1(u8);
  const objekte = new Map(); // nr → { dict, roh, strom: Uint8Array|null, filter }
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  let zahl = 0;
  while ((m = re.exec(t)) && zahl++ < MAX_OBJEKTE) {
    const nr = Number(m[1]);
    const start = m.index + m[0].length;
    const ende = t.indexOf('endobj', start);
    if (ende < 0) break;
    const v = wert(t, start);
    const eintrag = { wert: v.v, dict: v.v?.dict || null, strom: null };
    const s = t.indexOf('stream', v.i);
    if (eintrag.dict && s >= 0 && s < ende && /^\s*$/.test(t.slice(v.i, s))) {
      let a = s + 6;
      if (t[a] === '\r') a++;
      if (t[a] === '\n') a++;
      // Die Länge steht meist direkt im Wörterbuch; sonst (Verweis, falsche Angabe) gilt das letzte „endstream“ vor „endobj“.
      const len = typeof eintrag.dict.Length === 'number' ? eintrag.dict.Length : -1;
      let b;
      if (len >= 0 && a + len <= ende && /^\s*endstream/.test(t.slice(a + len, a + len + 12))) b = a + len;
      else {
        b = t.lastIndexOf('endstream', ende);
        if (t[b - 1] === '\n') b--;
        if (t[b - 1] === '\r') b--;
      }
      eintrag.strom = u8.subarray(a, Math.max(a, b));
    }
    objekte.set(nr, eintrag);
    re.lastIndex = ende + 6;
  }
  // Objektströme (PDF 1.5): darin liegen weitere Objekte ohne eigenen Datenstrom.
  for (const [, o] of [...objekte]) {
    if (o.dict?.Type?.name !== 'ObjStm' || !o.strom) continue;
    try {
      const daten = latin1(await stromDaten(o));
      const n = Number(o.dict.N) || 0;
      const first = Number(o.dict.First) || 0;
      const kopf = daten.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k < n && k * 2 + 1 < kopf.length; k++) {
        const nr = kopf[k * 2];
        if (objekte.has(nr)) continue;
        const v = wert(daten, first + kopf[k * 2 + 1]);
        objekte.set(nr, { wert: v.v, dict: v.v?.dict || null, strom: null });
      }
    } catch { /* unlesbarer Objektstrom */ }
  }
  return { objekte, verschluesselt: /\/Encrypt\s/.test(t.slice(Math.max(0, t.length - 4096))) || /trailer[\s\S]{0,400}\/Encrypt/.test(t) };
}

const filterVon = (dict) => {
  const f = dict?.Filter;
  return (Array.isArray(f) ? f : f ? [f] : []).map((x) => x?.name || '');
};

async function stromDaten(o) {
  let d = o.strom || new Uint8Array();
  for (const f of filterVon(o.dict)) {
    if (f === 'FlateDecode' || f === 'Fl') d = await entpacken(d);
    else return null; // andere Filter (Bilder, LZW …) sind für Text nicht nötig
  }
  return d;
}

/* -------------------------------------------------------------------------- */
/* Schriften: Zeichencode → Text                                               */
/* -------------------------------------------------------------------------- */

/** WinAnsi für 0x80–0x9f; der Rest entspricht Latin-1. */
const WIN = { 0x80: '€', 0x82: '‚', 0x84: '„', 0x85: '…', 0x8a: 'Š', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '\u2013', 0x97: '\u2014', 0x99: '™', 0x9a: 'š', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };

function utf16(hex) {
  let s = '';
  for (let k = 0; k + 3 < hex.length; k += 4) s += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
  return s;
}

/** ToUnicode-CMap lesen: {laengen:Set, map:Map<code, text>}. */
function cmapLesen(text) {
  const map = new Map();
  const laengen = new Set();
  for (const m of text.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) laengen.add(m[1].length / 2);
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16) + ':' + m[1].length / 2, utf16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16);
      const b = parseInt(m[2], 16);
      const lang = m[1].length / 2;
      if (b - a > 5000) continue;
      if (m[4] !== undefined) {
        const basis = utf16(m[4]);
        const letzte = basis.charCodeAt(basis.length - 1);
        for (let c = a; c <= b; c++) map.set(c + ':' + lang, basis.slice(0, -1) + String.fromCharCode(letzte + (c - a)));
      } else {
        const ziele = [...m[5].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => utf16(x[1]));
        for (let c = a; c <= b && c - a < ziele.length; c++) map.set(c + ':' + lang, ziele[c - a]);
      }
    }
  }
  for (const m of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const x of m[1].matchAll(/<([0-9a-fA-F]+)>/g)) laengen.add(x[1].length / 2);
  }
  return { map, laengen: [...laengen].filter((l) => l >= 1 && l <= 4).sort((x, y) => y - x) };
}

function dekodierer(cmap, zweiByte) {
  if (!cmap || !cmap.map.size) {
    // Ohne Tabelle: bei Identity-H zwei Byte je Zeichen (meist dann aber unlesbar), sonst WinAnsi.
    if (zweiByte) return (s) => { let o = ''; for (let k = 0; k + 1 < s.length; k += 2) { const c = (s.charCodeAt(k) << 8) | s.charCodeAt(k + 1); o += c >= 32 && c < 0xfffe ? String.fromCharCode(c) : ''; } return o; };
    return (s) => { let o = ''; for (const ch of s) { const c = ch.charCodeAt(0); o += WIN[c] || (c >= 32 ? ch : ''); } return o; };
  }
  const laengen = cmap.laengen.length ? cmap.laengen : [zweiByte ? 2 : 1];
  return (s) => {
    let o = '';
    for (let k = 0; k < s.length;) {
      let gefunden = false;
      for (const l of laengen) {
        if (k + l > s.length) continue;
        let c = 0;
        for (let x = 0; x < l; x++) c = (c << 8) | s.charCodeAt(k + x);
        const z = cmap.map.get(c + ':' + l);
        if (z !== undefined) { o += z; k += l; gefunden = true; break; }
      }
      if (!gefunden) { const c = s.charCodeAt(k); o += !zweiByte && c >= 32 ? (WIN[c] || s[k]) : ''; k += zweiByte ? 2 : 1; }
    }
    return o;
  };
}

/* -------------------------------------------------------------------------- */
/* Seiten und Textbefehle                                                      */
/* -------------------------------------------------------------------------- */

/** Befehle eines Inhaltsstroms in Reihenfolge: [{op, args}]. */
function befehle(t) {
  const out = [];
  let args = [];
  let i = 0;
  const n = t.length;
  while (i < n && out.length < 400000) {
    const c = t[i];
    if (WEISS.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && t[i] !== '\n' && t[i] !== '\r') i++; continue; }
    if (c === '(' || c === '[' || c === '/' || (c === '<' && t[i + 1] !== '<') || c === '+' || c === '-' || c === '.' || (c >= '0' && c <= '9')) {
      const v = wert(t, i); args.push(v.v); i = v.i; continue;
    }
    if (c === '<' && t[i + 1] === '<') { const v = wert(t, i); args.push(v.v); i = v.i; continue; }
    let j = i;
    while (j < n && !TRENN.test(t[j])) j++;
    if (j === i) { i++; continue; }
    const op = t.slice(i, j);
    i = j;
    if (op === 'BI') { const e = t.indexOf('EI', i); i = e < 0 ? n : e + 2; args = []; continue; } // eingebettetes Bild überspringen
    out.push({ op, args });
    args = [];
  }
  return out;
}

export async function pdfLesen(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const leer = { text: '', seiten: 0, bilder: [], verschluesselt: false };
  if (u8.length < 8 || u8.length > MAX_PDF || latin1(u8.subarray(0, 5)) !== '%PDF-') return leer;
  const { objekte, verschluesselt } = await objekteLesen(u8);
  if (verschluesselt) return { ...leer, verschluesselt: true };
  const hole = (v) => (v && typeof v === 'object' && 'ref' in v ? objekte.get(v.ref)?.wert : v);
  const dictVon = (v) => hole(v)?.dict || null;

  // Seiten in Reihenfolge über den Seitenbaum, ererbte Ressourcen mitgenommen.
  const seiten = [];
  const katalog = [...objekte.values()].find((o) => o.dict?.Type?.name === 'Catalog');
  const besucht = new Set();
  const gehe = (ref, erbe) => {
    const nr = ref?.ref;
    if (nr === undefined || besucht.has(nr) || seiten.length > 500) return;
    besucht.add(nr);
    const d = objekte.get(nr)?.dict;
    if (!d) return;
    const res = d.Resources ? d.Resources : erbe;
    if (d.Type?.name === 'Pages' || Array.isArray(d.Kids)) for (const k of hole(d.Kids) || []) gehe(k, res);
    else seiten.push({ d, res });
  };
  if (katalog) gehe(katalog.dict.Pages, null);
  if (!seiten.length) for (const o of objekte.values()) if (o.dict?.Type?.name === 'Page') seiten.push({ d: o.dict, res: o.dict.Resources });

  const cmapCache = new Map();
  async function schriften(resDict) {
    const fonts = dictVon(dictVon(resDict)?.Font) || dictVon(resDict)?.Font?.dict || null;
    const out = {};
    for (const [name, ref] of Object.entries(fonts || {})) {
      const f = dictVon(ref);
      if (!f) continue;
      const zweiByte = f.Subtype?.name === 'Type0' || /Identity/.test(f.Encoding?.name || '');
      let cmap = null;
      const tu = f.ToUnicode?.ref;
      if (tu !== undefined) {
        if (!cmapCache.has(tu)) {
          let c = null;
          try { const d = await stromDaten(objekte.get(tu) || {}); if (d) c = cmapLesen(latin1(d)); } catch { c = null; }
          cmapCache.set(tu, c);
        }
        cmap = cmapCache.get(tu);
      }
      out[name] = dekodierer(cmap, zweiByte);
    }
    return out;
  }

  const zeilen = [];
  const bilder = [];
  let laenge = 0;

  async function inhalt(daten, resDict, tiefe) {
    if (!daten || tiefe > 4 || laenge > MAX_TEXT) return;
    const fonts = await schriften(resDict);
    const xobj = dictVon(dictVon(resDict)?.XObject) || {};
    let dek = (s) => s;
    let zeile = '';
    let lastY = null;
    let ty = 0;
    const umbruch = () => { if (zeile.trim()) { zeilen.push(zeile.replace(/\s+/g, ' ').trim()); laenge += zeile.length; } zeile = ''; };
    for (const { op, args } of befehle(latin1(daten))) {
      if (op === 'BT') { ty = 0; } else if (op === 'ET') { /* Zeile bleibt offen bis zum nächsten Sprung */ } else if (op === 'Tf') {
        dek = fonts[args[0]?.name] || ((s) => s);
      } else if (op === 'Td' || op === 'TD') {
        const dy = Number(args[1]) || 0;
        if (Math.abs(dy) > 1) { ty += dy; umbruch(); } else if (Number(args[0]) > 1) zeile += ' ';
      } else if (op === 'Tm') {
        const y = Number(args[5]) || 0;
        if (lastY === null || Math.abs(y - lastY) > 1) umbruch(); else zeile += ' ';
        lastY = y;
      } else if (op === 'T*' || op === "'" || op === '"') {
        umbruch();
        if (op !== 'T*') zeile += dek(args[args.length - 1]?.str || '');
      } else if (op === 'Tj') {
        zeile += dek(args[0]?.str || '');
      } else if (op === 'TJ') {
        for (const x of Array.isArray(args[0]) ? args[0] : []) {
          if (typeof x === 'number') { if (x < -180) zeile += ' '; } else if (x?.str !== undefined) zeile += dek(x.str);
        }
      } else if (op === 'Do') {
        const ref = xobj[args[0]?.name];
        const o = ref?.ref !== undefined ? objekte.get(ref.ref) : null;
        if (!o?.dict) continue;
        if (o.dict.Subtype?.name === 'Form') {
          umbruch();
          try { await inhalt(await stromDaten(o), o.dict.Resources || resDict, tiefe + 1); } catch { /* Formular unlesbar */ }
        } else if (o.dict.Subtype?.name === 'Image' && filterVon(o.dict).at(-1) === 'DCTDecode' && filterVon(o.dict).length === 1 && bilder.length < MAX_BILDER
          && (Number(o.dict.Width) || 0) >= 400 && (Number(o.dict.Height) || 0) >= 300) {
          bilder.push(o.strom.slice());
        }
      }
    }
    umbruch();
  }

  for (const s of seiten) {
    const c = hole(s.d.Contents);
    const teile = Array.isArray(c) ? c : [s.d.Contents];
    const daten = [];
    for (const r of teile) {
      const o = r?.ref !== undefined ? objekte.get(r.ref) : null;
      if (!o) continue;
      try { const d = await stromDaten(o); if (d) daten.push(d); } catch { /* Seite unlesbar */ }
    }
    const ganz = new Uint8Array(daten.reduce((n, d) => n + d.length + 1, 0));
    let o = 0;
    for (const d of daten) { ganz.set(d, o); o += d.length; ganz[o++] = 10; }
    await inhalt(ganz, s.res, 0);
    zeilen.push('');
    if (laenge > MAX_TEXT) break;
  }
  return { text: zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim(), seiten: seiten.length, bilder, verschluesselt: false };
}
