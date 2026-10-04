/**
 * Kontovia – PDF/A-3 für Rechnungen, ohne fremden Code.
 *
 * Eine E-Rechnung nach ZUGFeRD / Factur-X ist ein PDF/A-3, in dem die
 * Rechnungsdaten als XML-Datei stecken. PDF/A verlangt mehr als die Berichte
 * aus lib/pdf.js mitbringen:
 *
 *   - jede Schrift eingebettet: Geist Regular und Bold (fonts/geist-pdf.js),
 *     in der Kodierung WinAnsi mit Breitentabelle aus der Schrift selbst
 *   - ein Farbprofil (sRGB) als „Output Intent“ für alle Farben und Bilder
 *   - Metadaten als XMP, deckungsgleich mit dem Info-Verzeichnis, samt der
 *     Kennung pdfaid (Teil 3, Stufe B) und den Factur-X-Angaben
 *   - eingebettete Dateien mit Medientyp, Datum und Beziehung (/AF)
 *   - kein Verschlüsseln, keine Skripte, keine Transparenz, keine Verweise
 *     nach außen
 *
 * Bilder (Logo, Unterschrift) kommen als JPEG; die Oberfläche wandelt jedes
 * hochgeladene Bild vorher um (views/rechnungen.js).
 *
 * Koordinaten wie in lib/pdf.js: Punkt, Ursprung oben links.
 */

import { winAnsi } from './pdf.js';
import { GEIST } from '../fonts/geist-pdf.js';

export const MM = 72 / 25.4;
export const A4 = { breite: 595.28, hoehe: 841.89 };

/* -------------------------------------------------------------------------- */
/* Schrift                                                                     */
/* -------------------------------------------------------------------------- */

/* Zeichen, für die Geist keine Glyphe hat, werden ersetzt; PDF/A duldet
   keinen Verweis auf eine fehlende Glyphe. */
const ERSATZ = { 0x7f: 0x20, 0x83: 0x66, 0x86: 0x2b, 0x87: 0x2b, 0x89: 0x25, 0x8a: 0x53, 0x8e: 0x5a, 0x9a: 0x73, 0x9e: 0x7a, 0x9f: 0x59 };
const FEHLT = new Set(GEIST.normal.fehlt);

/** Text → WinAnsi-Codes, die die eingebettete Schrift auch zeichnen kann. */
export function codes(text) {
  const out = [];
  for (const c of winAnsi(text)) {
    if (c === 0xad) continue; // weiches Trennzeichen
    out.push(FEHLT.has(c) ? (ERSATZ[c] ?? 0x3f) : c);
  }
  return out;
}

/** Breite eines Textes in Punkt. */
export function textBreite(text, groesse, schrift = 'normal') {
  const b = (GEIST[schrift] || GEIST.normal).breiten;
  let summe = 0;
  for (const c of codes(text)) summe += c >= 32 ? b[c - 32] : 0;
  return (summe * groesse) / 1000;
}

/** Schriftmaße (Tausendstel der Schriftgröße). */
export const SCHRIFTMASS = { ascent: GEIST.normal.info.ascent, descent: GEIST.normal.info.descent, versal: GEIST.normal.info.capHeight };

/* -------------------------------------------------------------------------- */
/* Seiten                                                                      */
/* -------------------------------------------------------------------------- */

const SCHRIFT = { normal: 'F1', fett: 'F2' };
const zahl = (n) => (Math.round(n * 1000) / 1000).toString();

export function farbe(f) {
  if (Array.isArray(f)) return f.map(zahl).join(' ');
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(f || '#000000'));
  if (!m) return '0 0 0';
  return [m[1], m[2], m[3]].map((h) => zahl(parseInt(h, 16) / 255)).join(' ');
}

function zeichenkette(text) {
  let s = '(';
  for (const c of codes(text)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

export class Seite {
  constructor() {
    this.breite = A4.breite;
    this.hoehe = A4.hoehe;
    this.ops = [];
    this.bilder = new Set();
    // Dasselbe noch einmal als Liste, für die Vorschau in der Oberfläche (pdfvorschau.js).
    this.elemente = [];
  }

  /** Text, Grundlinie bei y. */
  text(x, y, text, { groesse = 10, schrift = 'normal', farbe: f = '#14181d' } = {}) {
    if (!String(text ?? '').length) return;
    this.elemente.push({ art: 'text', x, y, text: String(text), groesse, schrift, farbe: f });
    this.ops.push(`BT /${SCHRIFT[schrift] || 'F1'} ${zahl(groesse)} Tf ${farbe(f)} rg 1 0 0 1 ${zahl(x)} ${zahl(this.hoehe - y)} Tm ${zeichenkette(text)} Tj ET`);
  }

  linie(x1, y1, x2, y2, { staerke = 0.5, farbe: f = '#000000' } = {}) {
    this.elemente.push({ art: 'linie', x1, y1, x2, y2, staerke, farbe: f });
    this.ops.push(`${zahl(staerke)} w ${farbe(f)} RG ${zahl(x1)} ${zahl(this.hoehe - y1)} m ${zahl(x2)} ${zahl(this.hoehe - y2)} l S`);
  }

  rechteck(x, y, b, h, { fuellung = null, rand = null, staerke = 0.5 } = {}) {
    this.elemente.push({ art: 'rechteck', x, y, b, h, fuellung, rand, staerke });
    const r = `${zahl(x)} ${zahl(this.hoehe - y - h)} ${zahl(b)} ${zahl(h)} re`;
    if (fuellung && rand) this.ops.push(`${farbe(fuellung)} rg ${zahl(staerke)} w ${farbe(rand)} RG ${r} B`);
    else if (fuellung) this.ops.push(`${farbe(fuellung)} rg ${r} f`);
    else if (rand) this.ops.push(`${zahl(staerke)} w ${farbe(rand)} RG ${r} S`);
  }

  /** Bild (vorher in pdfaDatei unter diesem Namen übergeben), oben links bei (x, y). */
  bild(name, x, y, b, h) {
    this.bilder.add(name);
    this.elemente.push({ art: 'bild', name, x, y, b, h });
    this.ops.push(`q ${zahl(b)} 0 0 ${zahl(h)} ${zahl(x)} ${zahl(this.hoehe - y - h)} cm /${name} Do Q`);
  }
}

/* -------------------------------------------------------------------------- */
/* Bilder                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Breite, Höhe und Farbkanäle eines JPEG aus seinem Kopf (SOF-Marke).
 * @returns {{breite:number, hoehe:number, kanaele:number}|null}
 */
export function jpegInfo(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < u8.length) {
    if (u8[p] !== 0xff) { p++; continue; }
    const marke = u8[p + 1];
    if (marke === 0xd8 || marke === 0x01 || (marke >= 0xd0 && marke <= 0xd7)) { p += 2; continue; }
    const laenge = (u8[p + 2] << 8) | u8[p + 3];
    if ((marke >= 0xc0 && marke <= 0xc3) || (marke >= 0xc5 && marke <= 0xc7) || (marke >= 0xc9 && marke <= 0xcb) || (marke >= 0xcd && marke <= 0xcf)) {
      return { hoehe: (u8[p + 5] << 8) | u8[p + 6], breite: (u8[p + 7] << 8) | u8[p + 8], kanaele: u8[p + 9] };
    }
    p += 2 + laenge;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Farbprofil sRGB (ICC v2), selbst erzeugt                                    */
/* -------------------------------------------------------------------------- */

let iccCache = null;

/**
 * Ein schlankes sRGB-Profil nach IEC 61966-2-1: Primärfarben auf D50
 * angepasst, Tonwertkurve als Tabelle mit 1024 Stützstellen.
 */
export function srgbProfil() {
  if (iccCache) return iccCache;
  const teile = [];
  const s15 = (v) => { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, Math.round(v * 65536)); return new Uint8Array(b.buffer); };
  const u32 = (v) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v); return new Uint8Array(b.buffer); };
  const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const verbinden = (liste) => { const n = liste.reduce((a, l) => a + l.length, 0); const o = new Uint8Array(n); let p = 0; for (const l of liste) { o.set(l, p); p += l.length; } return o; };
  const xyz = (x, y, z) => verbinden([ascii('XYZ '), u32(0), s15(x), s15(y), s15(z)]);
  const kurve = (() => {
    const n = 1024;
    const d = new DataView(new ArrayBuffer(12 + n * 2));
    ascii('curv').forEach((c, i) => d.setUint8(i, c));
    d.setUint32(8, n);
    for (let i = 0; i < n; i++) {
      const v = i / (n - 1);
      const lin = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      d.setUint16(12 + i * 2, Math.round(lin * 65535));
    }
    return new Uint8Array(d.buffer);
  })();
  const beschreibung = (() => {
    const text = 'sRGB IEC61966-2.1';
    const d = new Uint8Array(12 + text.length + 1 + 4 + 4 + 2 + 1 + 67);
    d.set(ascii('desc'), 0);
    new DataView(d.buffer).setUint32(8, text.length + 1);
    d.set(ascii(text), 12);
    return d;
  })();
  const recht = verbinden([ascii('text'), u32(0), ascii('Public Domain\0')]);
  const tags = [
    ['desc', beschreibung],
    ['cprt', recht],
    ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.4360747, 0.2225045, 0.0139322)],
    ['gXYZ', xyz(0.3850649, 0.7168786, 0.0971045)],
    ['bXYZ', xyz(0.1430804, 0.0606169, 0.7141733)],
    ['rTRC', kurve],
    ['gTRC', kurve],
    ['bTRC', kurve],
  ];
  const tabelleLaenge = 4 + tags.length * 12;
  let offset = 128 + tabelleLaenge;
  const eintraege = [];
  const daten = [];
  const gesehen = new Map();
  for (const [sig, inhalt] of tags) {
    if (gesehen.has(inhalt)) { eintraege.push([sig, gesehen.get(inhalt), inhalt.length]); continue; }
    while (offset % 4) { daten.push(new Uint8Array(1)); offset++; }
    eintraege.push([sig, offset, inhalt.length]);
    gesehen.set(inhalt, offset);
    daten.push(inhalt);
    offset += inhalt.length;
  }
  const gesamt = offset;
  const kopf = new Uint8Array(128);
  const dv = new DataView(kopf.buffer);
  dv.setUint32(0, gesamt);
  dv.setUint32(8, 0x02100000);
  kopf.set(ascii('mntr'), 12);
  kopf.set(ascii('RGB '), 16);
  kopf.set(ascii('XYZ '), 20);
  [2026, 1, 1, 0, 0, 0].forEach((v, i) => dv.setUint16(24 + i * 2, v));
  kopf.set(ascii('acsp'), 36);
  dv.setInt32(68, Math.round(0.9642 * 65536));
  dv.setInt32(72, 65536);
  dv.setInt32(76, Math.round(0.8249 * 65536));
  const tabelle = new DataView(new ArrayBuffer(tabelleLaenge));
  tabelle.setUint32(0, tags.length);
  eintraege.forEach(([sig, off, len], i) => {
    for (let k = 0; k < 4; k++) tabelle.setUint8(4 + i * 12 + k, sig.charCodeAt(k));
    tabelle.setUint32(8 + i * 12, off);
    tabelle.setUint32(12 + i * 12, len);
  });
  teile.push(kopf, new Uint8Array(tabelle.buffer), ...daten);
  iccCache = verbinden(teile);
  return iccCache;
}

/* -------------------------------------------------------------------------- */
/* Datei                                                                       */
/* -------------------------------------------------------------------------- */

const enc = new TextEncoder();
const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function base64Bytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

async function packen(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Text als PDF-Zeichenkette in UTF-16BE (Info, Dateinamen). */
function pdfText(text) {
  let hex = 'FEFF';
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    const einheiten = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    for (const u of einheiten) hex += u.toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

/** Datei- und Schlüsselnamen als einfacher ASCII-Literal. */
function pdfAscii(text) {
  return `(${String(text).replace(/[^\x20-\x7e]/g, '_').replace(/([()\\])/g, '\\$1')})`;
}

const zwei = (n) => String(n).padStart(2, '0');

function zeitzone(d) {
  const off = -d.getTimezoneOffset();
  return { vz: off >= 0 ? '+' : '-', h: zwei(Math.floor(Math.abs(off) / 60)), m: zwei(Math.abs(off) % 60) };
}

function pdfDatum(d) {
  const z = zeitzone(d);
  return `D:${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}${zwei(d.getHours())}${zwei(d.getMinutes())}${zwei(d.getSeconds())}${z.vz}${z.h}'${z.m}'`;
}

function xmpDatum(d) {
  const z = zeitzone(d);
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}${z.vz}${z.h}:${z.m}`;
}

const xmlText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Die Factur-X-Angaben in den Metadaten samt Schemabeschreibung (PDF/A verlangt sie). */
function facturX({ dateiname, profil }) {
  const eigenschaft = (name, beschreibung) => `
            <rdf:li rdf:parseType="Resource">
              <pdfaProperty:name>${name}</pdfaProperty:name>
              <pdfaProperty:valueType>Text</pdfaProperty:valueType>
              <pdfaProperty:category>external</pdfaProperty:category>
              <pdfaProperty:description>${beschreibung}</pdfaProperty:description>
            </rdf:li>`;
  return `
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${eigenschaft('DocumentFileName', 'Name of the embedded XML invoice file')}${eigenschaft('DocumentType', 'INVOICE')}${eigenschaft('Version', 'The actual version of the Factur-X XML schema')}${eigenschaft('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${xmlText(dateiname)}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${xmlText(profil)}</fx:ConformanceLevel>
    </rdf:Description>`;
}

function xmp({ titel, autor, betreff, jetzt, fx }) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(titel)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmlText(autor)}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(betreff)}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>Kontovia</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>Kontovia</xmp:CreatorTool>
      <xmp:CreateDate>${xmpDatum(jetzt)}</xmp:CreateDate>
      <xmp:ModifyDate>${xmpDatum(jetzt)}</xmp:ModifyDate>
      <xmp:MetadataDate>${xmpDatum(jetzt)}</xmp:MetadataDate>
    </rdf:Description>${fx ? facturX(fx) : ''}
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Setzt die Seiten zu einem PDF/A-3b zusammen.
 * @param {Seite[]} seiten
 * @param {object} o
 * @param {string} o.titel
 * @param {string} o.autor
 * @param {string} o.betreff
 * @param {Object<string,{bytes:Uint8Array}>} [o.bilder]  JPEG je Name (wie in Seite.bild)
 * @param {{name:string, bytes:Uint8Array, mime:string, beschreibung:string, beziehung?:string}} [o.anhang]
 * @param {{dateiname:string, profil:string}} [o.facturX]  Factur-X-Angaben in den Metadaten
 * @param {Date} [o.jetzt]
 * @returns {Promise<Uint8Array>}
 */
export async function pdfaDatei(seiten, { titel = '', autor = '', betreff = '', bilder = {}, anhang = null, facturX: fx = null, jetzt = new Date() } = {}) {
  const objekte = [];
  const neu = () => objekte.push(null);
  const setzen = (nr, teile) => { objekte[nr - 1] = teile; };
  const strom = async (dict, daten, { packen: gepackt = true } = {}) => {
    const p = gepackt ? await packen(daten) : null;
    const d = p || daten;
    return [latin1(`<< ${dict} /Length ${d.length}${p ? ' /Filter /FlateDecode' : ''} >>\nstream\n`), d, latin1('\nendstream')];
  };

  const katalog = neu();
  const baum = neu();

  // Schriften
  const schriften = {};
  for (const [art, s] of Object.entries(GEIST)) {
    const ttf = base64Bytes(s.ttf);
    const datei = neu();
    setzen(datei, await strom(`/Length1 ${ttf.length}`, ttf));
    const beschr = neu();
    const i = s.info;
    setzen(beschr, [latin1(`<< /Type /FontDescriptor /FontName /${s.name} /Flags 32 /FontBBox [${i.box.join(' ')}] /ItalicAngle 0 `
      + `/Ascent ${i.ascent} /Descent ${i.descent} /CapHeight ${i.capHeight} /StemV ${art === 'fett' ? 140 : 80} /FontFile2 ${datei} 0 R >>`)]);
    const nr = neu();
    setzen(nr, [latin1(`<< /Type /Font /Subtype /TrueType /BaseFont /${s.name} /FirstChar 32 /LastChar 255 `
      + `/Widths [${s.breiten.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${beschr} 0 R >>`)]);
    schriften[art] = nr;
  }

  // Bilder
  const bildNr = {};
  for (const [name, b] of Object.entries(bilder || {})) {
    const info = jpegInfo(b.bytes);
    if (!info) continue;
    const nr = neu();
    const raum = info.kanaele === 1 ? '/DeviceGray' : '/DeviceRGB';
    setzen(nr, [latin1(`<< /Type /XObject /Subtype /Image /Width ${info.breite} /Height ${info.hoehe} /ColorSpace ${raum} /BitsPerComponent 8 /Filter /DCTDecode /Length ${b.bytes.length} >>\nstream\n`),
      b.bytes, latin1('\nendstream')]);
    bildNr[name] = nr;
  }

  // Seiten
  const kinder = [];
  for (const s of seiten) {
    const seitenNr = neu();
    const inhaltNr = neu();
    kinder.push(seitenNr);
    const xo = [...s.bilder].filter((n) => bildNr[n]).map((n) => `/${n} ${bildNr[n]} 0 R`).join(' ');
    const ressourcen = `<< /Font << /F1 ${schriften.normal} 0 R /F2 ${schriften.fett} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >>`;
    setzen(seitenNr, [latin1(`<< /Type /Page /Parent ${baum} 0 R /MediaBox [0 0 ${zahl(s.breite)} ${zahl(s.hoehe)}] `
      + `/Resources ${ressourcen} /Contents ${inhaltNr} 0 R >>`)]);
    // Bilder ohne übergebene Daten fallen weg, statt die Datei ungültig zu machen.
    const ops = s.ops.filter((op) => { const m = / \/(\w+) Do Q$/.exec(op); return !m || bildNr[m[1]]; });
    setzen(inhaltNr, await strom('', latin1(ops.join('\n'))));
  }
  setzen(baum, [latin1(`<< /Type /Pages /Kids [${kinder.map((k) => `${k} 0 R`).join(' ')}] /Count ${kinder.length} >>`)]);

  // Farbprofil
  const icc = neu();
  setzen(icc, await strom('/N 3', srgbProfil()));
  const absicht = neu();
  setzen(absicht, [latin1(`<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${icc} 0 R >>`)]);

  // Metadaten (unverpackt, wie PDF/A es verlangt)
  const meta = neu();
  const xmpBytes = enc.encode(xmp({ titel, autor, betreff, jetzt, fx }));
  setzen(meta, [latin1(`<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>\nstream\n`), xmpBytes, latin1('\nendstream')]);

  // Eingebettete Datei
  let anhangTeil = '';
  if (anhang) {
    const daten = neu();
    const mime = String(anhang.mime || 'application/octet-stream').replace('/', '#2F');
    setzen(daten, await strom(`/Type /EmbeddedFile /Subtype /${mime} /Params << /ModDate (${pdfDatum(jetzt)}) /Size ${anhang.bytes.length} >>`, anhang.bytes));
    const spec = neu();
    setzen(spec, [latin1(`<< /Type /Filespec /F ${pdfAscii(anhang.name)} /UF ${pdfText(anhang.name)} /Desc ${pdfText(anhang.beschreibung || anhang.name)} `
      + `/AFRelationship /${anhang.beziehung || 'Alternative'} /EF << /F ${daten} 0 R /UF ${daten} 0 R >> >>`)]);
    anhangTeil = ` /Names << /EmbeddedFiles << /Names [${pdfAscii(anhang.name)} ${spec} 0 R] >> >> /AF [${spec} 0 R]`;
  }

  setzen(katalog, [latin1(`<< /Type /Catalog /Pages ${baum} 0 R /Metadata ${meta} 0 R /OutputIntents [${absicht} 0 R] /Lang (de-DE)`
    + ` /ViewerPreferences << /DisplayDocTitle true >>${anhangTeil} >>`)]);
  const infoNr = neu();
  setzen(infoNr, [latin1(`<< /Title ${pdfText(titel)} /Author ${pdfText(autor)} /Subject ${pdfText(betreff)} /Creator ${pdfText('Kontovia')} `
    + `/Producer ${pdfText('Kontovia')} /CreationDate (${pdfDatum(jetzt)}) /ModDate (${pdfDatum(jetzt)}) >>`)]);

  const teile = [latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
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
