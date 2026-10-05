/**
 * Kontovia – Excel-Arbeitsmappen (.xlsx) schreiben und lesen, ohne fremden Code.
 *
 * Eine .xlsx-Datei ist ein ZIP-Archiv mit einigen XML-Dateien (Office Open
 * XML, ISO/IEC 29500). Hier entsteht das Nötigste: mehrere Blätter, fette
 * Kopfzeile, fixierte erste Zeile, Filter, Spaltenbreiten, echte Datums- und
 * Eurozellen, damit Excel, LibreOffice und Numbers rechnen und sortieren
 * können. Das ZIP wird unkomprimiert geschrieben; das hält den Code klein und
 * ist für Tabellen dieser Größe unerheblich.
 *
 * Zellen: Text (string), Zahl (number), { datum: 'JJJJ-MM-TT' }, { geld: Cent },
 * { prozent: 19 }, null für leer. Texte, die mit = + - @ beginnen, bleiben Text
 * (inlineStr), nie Formel.
 */

/* -------------------------------------------------------------------------- */
/* ZIP (ohne Kompression)                                                      */
/* -------------------------------------------------------------------------- */

let CRC_TAB = null;
function crc32(u8) {
  if (!CRC_TAB) {
    CRC_TAB = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TAB[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TAB[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {{name:string, data:Uint8Array}[]} dateien */
export function zipOhneKompression(dateien) {
  const te = new TextEncoder();
  const teile = []; const zentral = [];
  let offset = 0;
  // Fester Zeitstempel (1.1.2026): gleiche Daten ergeben dieselbe Datei.
  const zeit = 0; const datum = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of dateien) {
    const name = te.encode(f.name);
    const crc = crc32(f.data);
    const lokal = new Uint8Array(30 + name.length);
    const l = new DataView(lokal.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
    l.setUint16(10, zeit, true); l.setUint16(12, datum, true); l.setUint32(14, crc, true);
    l.setUint32(18, f.data.length, true); l.setUint32(22, f.data.length, true); l.setUint16(26, name.length, true); l.setUint16(28, 0, true);
    lokal.set(name, 30);
    const z = new Uint8Array(46 + name.length);
    const c = new DataView(z.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, zeit, true); c.setUint16(14, datum, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    z.set(name, 46);
    teile.push(lokal, f.data);
    zentral.push(z);
    offset += lokal.length + f.data.length;
  }
  const groesse = zentral.reduce((n, z) => n + z.length, 0);
  const ende = new Uint8Array(22);
  const e = new DataView(ende.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, dateien.length, true); e.setUint16(10, dateien.length, true);
  e.setUint32(12, groesse, true); e.setUint32(16, offset, true);
  const alle = [...teile, ...zentral, ende];
  const out = new Uint8Array(alle.reduce((n, t) => n + t.length, 0));
  let p = 0;
  for (const t of alle) { out.set(t, p); p += t.length; }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Lesen                                                                       */
/* -------------------------------------------------------------------------- */

/** Entpackt einen Eintrag (gespeichert oder Deflate) mit den Mitteln des Browsers. */
async function entpacken(daten, methode) {
  if (methode === 0) return daten;
  if (methode !== 8) throw new Error('Die Excel-Datei ist auf eine Weise gepackt, die Kontovia nicht lesen kann.');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([daten]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Liest die Einträge eines ZIP-Archivs über das zentrale Verzeichnis. */
async function zipLesen(u8, gesucht) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let ende = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { ende = i; break; }
  if (ende < 0) throw Object.assign(new Error('Die Datei ist keine Excel-Datei (.xlsx).'), { code: 'FORMAT' });
  const anzahl = dv.getUint16(ende + 10, true);
  let p = dv.getUint32(ende + 16, true);
  const td = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < anzahl && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const methode = dv.getUint16(p + 10, true);
    const groesse = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true); const extra = dv.getUint16(p + 30, true); const komm = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + komm;
    if (!gesucht(name)) continue;
    if (groesse > 64 * 1024 * 1024) throw new Error('Die Excel-Datei ist zu groß.');
    const start = lokal + 30 + dv.getUint16(lokal + 26, true) + dv.getUint16(lokal + 28, true);
    out.set(name, td.decode(await entpacken(u8.subarray(start, start + groesse), methode)));
  }
  return out;
}

const xmlText = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
  const m = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  if (m) return m;
  return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});

/** Eingebaute Datumsformate von Excel (numFmtId). */
const DATUM_FORMATE = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);

/**
 * Liest das erste Blatt einer .xlsx-Datei als Zeilen aus Texten. Datumszellen
 * kommen als „TT.MM.JJJJ“, Zahlen mit Dezimalkomma; so verstehen die
 * CSV-Leser die Werte ohne Unterschied.
 * @param {Uint8Array} u8
 * @returns {Promise<string[][]>}
 */
export async function xlsxLesen(u8) {
  const dateien = await zipLesen(u8, (n) => /^xl\/(sharedStrings|styles|workbook)\.xml$|^xl\/worksheets\/sheet\d+\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(n));
  // Das erste Blatt laut Mappe, nicht das mit der kleinsten Nummer.
  const wb = dateien.get('xl/workbook.xml') || '';
  const rels = dateien.get('xl/_rels/workbook.xml.rels') || '';
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  const ziel = rid && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  const blattName = ziel ? `xl/${ziel.replace(/^\/?xl\//, '')}` : [...dateien.keys()].filter((n) => /worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const blatt = dateien.get(blattName);
  if (!blatt) throw Object.assign(new Error('Die Excel-Datei enthält kein Tabellenblatt.'), { code: 'FORMAT' });

  const geteilt = [...(dateien.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''));
  const styles = dateien.get('xl/styles.xml') || '';
  const eigene = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), xmlText(m[2])]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || '';
  const istDatum = [...xfs.matchAll(/<xf\b[^>]*?(?:numFmtId="(\d+)")?[^>]*?\/?>/g)].map((m) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] || 0);
    const code = eigene.get(id);
    return DATUM_FORMATE.has(id) || (!!code && /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,\s€]*$/.test(code));
  });

  const zeilen = [];
  const spalteNr = (ref) => { let n = 0; for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  for (const r of blatt.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const nr = Number(/\br="(\d+)"/.exec(r[1] || r[3] || '')?.[1] || zeilen.length + 1) - 1;
    const zeile = [];
    for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attr)?.[1];
      const i = ref ? spalteNr(ref) : zeile.length;
      const t = /\bt="(\w+)"/.exec(attr)?.[1] || 'n';
      const s = Number(/\bs="(\d+)"/.exec(attr)?.[1] || 0);
      const innen = c[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(innen)?.[1];
      let wert = '';
      if (t === 's') wert = geteilt[Number(v)] ?? '';
      else if (t === 'inlineStr') wert = [...innen.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join('');
      else if (t === 'str' || t === 'e') wert = v !== undefined ? xmlText(v) : '';
      else if (t === 'b') wert = v === '1' ? 'ja' : 'nein';
      else if (v !== undefined) {
        const n = Number(v);
        if (istDatum[s] && Number.isFinite(n) && n > 0 && n < 2958466) {
          const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
          wert = `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
        } else if (Number.isFinite(n)) wert = Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
        else wert = v;
      }
      while (zeile.length < i) zeile.push('');
      zeile[i] = wert;
    }
    while (zeilen.length < nr) zeilen.push([]);
    zeilen[nr] = zeile;
  }
  return zeilen.filter((z) => z.some((x) => String(x).trim()));
}

/** Zeilen → CSV mit Semikolon, damit die Tabellenleser eine Excel-Datei wie eine CSV-Datei behandeln. */
export function alsCsv(zeilen) {
  return zeilen.map((z) => z.map((v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
}

/* -------------------------------------------------------------------------- */
/* Arbeitsmappe                                                                */
/* -------------------------------------------------------------------------- */

const x = (s) => String(s ?? '')
  // Steuerzeichen außer Tab und Zeilenumbruch sind in XML 1.0 verboten.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Spaltenbuchstaben: 0 → A, 26 → AA. */
export function spalte(i) {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Tage seit dem 30.12.1899 – so zählt Excel Datumswerte. */
function serial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* Stile: 0 normal, 1 fett (Kopf), 2 Datum, 3 Euro, 4 Prozent, 5 fett Euro (Summen). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="DD.MM.YYYY"/><numFmt numFmtId="165" formatCode="#,##0.00 &quot;€&quot;;[Red]-#,##0.00 &quot;€&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EAF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function zelle(ref, v, kopf) {
  if (v === null || v === undefined || v === '') return '';
  if (kopf) return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === 'object') {
    if ('datum' in v) { const s = serial(v.datum); return s === null ? '' : `<c r="${ref}" s="2"><v>${s}</v></c>`; }
    if ('geld' in v) return `<c r="${ref}" s="${v.summe ? 5 : 3}"><v>${(Number(v.geld) || 0) / 100}</v></c>`;
    if ('prozent' in v) return `<c r="${ref}" s="4"><v>${(Number(v.prozent) || 0) / 100}</v></c>`;
    if ('fett' in v) return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${x(v.fett)}</t></is></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
}

function blattXml(b) {
  const zeilen = [b.kopf, ...b.zeilen];
  const breite = b.kopf.length;
  const cols = b.kopf.map((k, i) => {
    const w = b.breiten?.[i] || Math.min(60, Math.max(10, String(k).length + 2, ...b.zeilen.slice(0, 200).map((r) => {
      const v = r[i];
      return v && typeof v === 'object' ? 14 : String(v ?? '').length + 2;
    })));
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  }).join('');
  const rows = zeilen.map((r, zi) => `<row r="${zi + 1}">${r.map((v, si) => zelle(`${spalte(si)}${zi + 1}`, v, zi === 0)).join('')}</row>`).join('');
  const letzte = `${spalte(Math.max(0, breite - 1))}${Math.max(1, zeilen.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${letzte}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows}</sheetData>
${b.zeilen.length && b.filter !== false ? `<autoFilter ref="A1:${letzte}"/>` : ''}
</worksheet>`;
}

/** Blattnamen: höchstens 31 Zeichen, ohne : \ / ? * [ ], eindeutig. */
function blattName(name, vergeben) {
  let n = String(name || 'Blatt').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Blatt';
  for (let i = 2; vergeben.has(n.toLowerCase()); i++) n = `${n.slice(0, 27)} ${i}`;
  vergeben.add(n.toLowerCase());
  return n;
}

/**
 * @param {{name:string, kopf:string[], zeilen:any[][], breiten?:number[], filter?:boolean}[]} blaetter
 * @returns {Uint8Array} Inhalt der .xlsx-Datei
 */
export function xlsxMappe(blaetter, { titel = 'Kontovia', autor = 'Kontovia' } = {}) {
  const te = new TextEncoder();
  const vergeben = new Set();
  const namen = blaetter.map((b) => blattName(b.name, vergeben));
  const n = blaetter.length;
  const jetzt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const dateien = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(titel)}</dc:title><dc:creator>${x(autor)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${jetzt}</dcterms:created>
</cp:coreProperties>`],
    ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kontovia</Application></Properties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${namen.map((name, i) => `<sheet name="${x(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${blaetter.some((b) => b.zeilen.length && b.filter !== false) ? `<definedNames>${blaetter.map((b, i) => (b.zeilen.length && b.filter !== false ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(namen[i]).replace(/'/g, "''")}'!$A$1:$${spalte(Math.max(0, b.kopf.length - 1))}$${b.zeilen.length + 1}</definedName>` : '')).join('')}</definedNames>` : ''}
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', STYLES],
    ...blaetter.map((b, i) => [`xl/worksheets/sheet${i + 1}.xml`, blattXml(b)]),
  ];
  return zipOhneKompression(dateien.map(([name, text]) => ({ name, data: te.encode(text) })));
}
