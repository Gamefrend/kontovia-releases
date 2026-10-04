/**
 * Kontovia – Kontoauszüge lesen: CSV, CAMT.053 (XML) und MT940.
 *
 * Alles geschieht im Browser aus den Bytes der gewählten Datei; nichts wird
 * hochgeladen, und die Datei selbst wird nirgends abgelegt. Diese Datei kennt
 * weder Oberfläche noch Speicher und läuft deshalb auch in den Prüfungen
 * (scripts/pruefungen/kontoauszug.test.js, mit Beispieldateien unter
 * scripts/fixtures/kontoauszug/).
 *
 * Jeder Umsatz kommt in dieselbe Form:
 *   { datum, valuta, betrag, waehrung, gegenseite, gegenIban, gegenBic,
 *     zweck, buchungstext, referenz, zeile }
 * datum und valuta als ISO („2026-10-04“), betrag in Cent mit Vorzeichen
 * (Eingang positiv, Ausgang negativ), zeile als Nummer in der Datei.
 *
 * Die Zeichensätze UTF-8 (auch mit BOM), UTF-16, Windows-1252 und ISO-8859-1
 * werden erkannt; Umlaute und € stimmen danach.
 */

import { xmlBaum } from './erechnung.js';
import { norm } from './util.js';

/* -------------------------------------------------------------------------- */
/* Zeichensatz                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bytes → Text. Reihenfolge: BOM, gültiges UTF-8, Angabe im XML-Kopf, sonst
 * Windows-1252 (das auch ISO-8859-1 abdeckt, dazu € und typografische Zeichen).
 * @returns {{text:string, kodierung:string}}
 */
export function textAusBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), kodierung: 'UTF-8 mit BOM' };
  if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), kodierung: 'UTF-16' };
  if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), kodierung: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), kodierung: 'UTF-8' };
  } catch { /* kein UTF-8 */ }
  const kopf = new TextDecoder('windows-1252').decode(u8.subarray(0, 200));
  const angabe = /encoding\s*=\s*["']([\w-]+)["']/i.exec(kopf)?.[1] || '';
  if (/^iso-?8859-?1$|^latin-?1$/i.test(angabe)) return { text: new TextDecoder('windows-1252').decode(u8), kodierung: 'ISO-8859-1' };
  return { text: new TextDecoder('windows-1252').decode(u8), kodierung: 'Windows-1252' };
}

/** Welches Format hat die Datei? 'camt', 'mt940' oder 'csv'. */
export function formatErkennen(text) {
  const kopf = String(text).slice(0, 4000);
  if (/^\s*<\?xml|^\s*<(?:\w+:)?Document\b/.test(kopf) && /camt\.0(?:52|53|54)|BkToCstmr/.test(String(text).slice(0, 20000))) return 'camt';
  if (/(^|\n):20:/.test(kopf) && /(^|\n):6[0-9][FM]?:|(^|\n):61:/.test(String(text).slice(0, 200000))) return 'mt940';
  return 'csv';
}

/* -------------------------------------------------------------------------- */
/* Gemeinsames                                                                 */
/* -------------------------------------------------------------------------- */

const zu = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Datum aus vielen Schreibweisen → ISO oder null. Zweistellige Jahre zählen als 20xx. */
export function datumLesen(s) {
  const t = zu(s).replace(/[T ]\d{1,2}:\d{2}.*$/, '');
  let m;
  let j; let mo; let tg;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [, j, mo, tg] = m;
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t))) [, tg, mo, j] = m;
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{2})$/.exec(t))) { [, tg, mo] = m; j = `20${m[3]}`; }
  else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) [, j, mo, tg] = m;
  else if ((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t))) [, tg, mo, j] = m;
  else return null;
  const J = Number(j); const M = Number(mo); const T = Number(tg);
  if (M < 1 || M > 12 || T < 1 || T > 31 || J < 1990 || J > 2100) return null;
  const d = new Date(Date.UTC(J, M - 1, T));
  if (d.getUTCMonth() !== M - 1) return null;
  return `${String(J).padStart(4, '0')}-${String(M).padStart(2, '0')}-${String(T).padStart(2, '0')}`;
}

/**
 * Betrag als Text → Cent oder null. `dezimal`: 'komma' (1.234,56), 'punkt'
 * (1,234.56) oder 'auto' (entscheidet am Wert; „1.234“ gilt als Tausender).
 */
export function betragLesen(s, dezimal = 'auto') {
  let t = zu(s).replace(/[€$£]|EUR|USD|CHF/gi, '').replace(/\s/g, '').replace(/[−–]/g, '-');
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (/^[+-]/.test(t)) { if (t[0] === '-') neg = true; t = t.slice(1); }
  if (/^[-+]/.test(t)) return null;
  if (/[SD]$/i.test(t)) { neg = true; t = t.slice(0, -1); } else if (/[HC]$/i.test(t)) t = t.slice(0, -1);
  if (!/^[\d.,']+$/.test(t) || !/\d/.test(t)) return null;
  t = t.replace(/'/g, '');
  let d = dezimal;
  if (d === 'auto') {
    const k = t.lastIndexOf(','); const p = t.lastIndexOf('.');
    if (k >= 0 && p >= 0) d = k > p ? 'komma' : 'punkt';
    else if (k >= 0) d = /,\d{1,2}$/.test(t) || !/^\d{1,3}(,\d{3})+$/.test(t) ? 'komma' : 'punkt';
    else if (p >= 0) d = /^\d{1,3}(\.\d{3})+$/.test(t) ? 'komma' : 'punkt';
    else d = 'komma';
  }
  t = d === 'komma' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const cent = Math.round(Number(t) * 100);
  return neg ? -cent : cent;
}

/** Eine IBAN im Text finden (mit Leerzeichen erlaubt). */
export function ibanFinden(s) {
  const m = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b/.exec(String(s ?? '').toUpperCase());
  return m ? m[1].replace(/\s/g, '') : '';
}

const umsatz = (o) => ({
  datum: '', valuta: '', betrag: 0, waehrung: 'EUR', gegenseite: '', gegenIban: '', gegenBic: '', zweck: '', buchungstext: '', referenz: '', zeile: 0, ...o,
});

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/** Trennzeichen aus den ersten Zeilen: das, das in den meisten Zeilen gleich oft (und mindestens einmal) vorkommt. */
export function csvTrenner(text) {
  const zeilen = String(text).split(/\r?\n/).filter((z) => z.trim()).slice(0, 40);
  let beste = ';'; let punkte = -1;
  for (const t of [';', '\t', ',', '|']) {
    const zaehl = zeilen.map((z) => { let n = 0; let q = false; for (const c of z) { if (c === '"') q = !q; else if (c === t && !q) n++; } return n; });
    const haeufig = new Map();
    for (const n of zaehl) if (n > 0) haeufig.set(n, (haeufig.get(n) || 0) + 1);
    let top = 0; let nTop = 0;
    for (const [n, c] of haeufig) if (c > top || (c === top && n > nTop)) { top = c; nTop = n; }
    // Mehr gleich lange Zeilen mit mehr Spalten gewinnen; ein Komma im Text allein genügt nicht.
    const p = top * 10 + Math.min(nTop, 20);
    if (top >= 2 && p > punkte) { punkte = p; beste = t; }
  }
  return beste;
}

/**
 * Zerlegt CSV in Zeilen und Zellen. Zellen in Anführungszeichen dürfen das
 * Trennzeichen, Zeilenumbrüche und verdoppelte Anführungszeichen enthalten.
 * @returns {string[][]}
 */
export function csvZeilen(text, trenner = ';') {
  const out = [];
  let zeile = [];
  let zelle = '';
  let q = false;
  const s = String(text);
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { zelle += '"'; i++; } else q = false; } else zelle += c;
    } else if (c === '"' && zelle === '') q = true;
    else if (c === trenner) { zeile.push(zelle); zelle = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      zeile.push(zelle); zelle = '';
      if (zeile.length > 1 || zeile[0] !== '') out.push(zeile);
      zeile = [];
    } else zelle += c;
  }
  if (zelle !== '' || zeile.length) { zeile.push(zelle); if (zeile.length > 1 || zeile[0] !== '') out.push(zeile); }
  return out;
}

/** Rollen der Spalten und woran man sie am Kopf erkennt (Kopf vorher mit norm() geglättet). Die Reihenfolge entscheidet. */
const ROLLEN = [
  ['eigeneIban', /auftragskonto|^eigene?s? ?(konto|iban)/],
  ['referenz', /kundenreferenz|end-?to-?end|mandatsreferenz|sammlerreferenz|glaeubiger|creditor id/],
  ['status', /^status$/],
  ['valuta', /valuta|wertstellung|value date/],
  ['saldo', /saldo|balance/],
  ['soll', /^(soll|belastung|ausgang|debit)(\b| |$)/],
  ['haben', /^(haben|gutschrift|eingang|credit)(\b| |$)/],
  ['betrag', /^(betrag|amount|umsatz)(\b|$)/],
  ['waehrung', /waehrung|currency|^whrg$|^cur$/],
  ['gegenseiteEin', /^zahlungspflichtige( r)?$/],
  ['gegenseiteAus', /^zahlungsempfaenger( in)?$|^empfaenger( in)?$/],
  ['gegenBic', /\bbic\b|swift/],
  ['gegenIban', /iban|kontonummer|account number/],
  ['gegenseite', /beguenstigter|auftraggeber|empfaenger|payee|^name$|name zahlungsbeteiligter|gegenpartei|name\/firma|partner|zahlungsbeteiligter/],
  ['zweck', /verwendungszweck|zweck|payment reference|beschreibung|buchungsinformation|description|^text$|mitteilung|reference|verwendung/],
  ['buchungstext', /buchungstext|umsatztyp|transaction type|^art$|buchungsart|vorgang/],
  ['datum', /^(buchungs ?tag|buchungsdatum|buchung|datum|date|booking date|umsatzdatum|buchungsdatum)$|^buchungs?tag$/],
];

const rolleVon = (kopf) => {
  const n = norm(kopf).replace(/[()*]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [rolle, re] of ROLLEN) if (re.test(n)) return rolle;
  return '';
};

/** Wie viele Zellen einer Zeile sehen wie Spaltenüberschriften aus. */
const kopfPunkte = (zeile) => zeile.reduce((n, z) => n + (rolleVon(z) ? 1 : 0), 0);

/** Kurzer Fingerabdruck der Kopfzeile, um eine gemerkte Zuordnung wiederzufinden (nicht kryptografisch). */
export function kopfSignatur(kopfzellen) {
  const s = kopfzellen.map((z) => norm(z).replace(/\s+/g, ' ').trim()).join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Die Rollen, die der Nutzer pro Spalte wählen kann, mit Namen für die Oberfläche. */
export const SPALTENROLLEN = {
  datum: 'Buchungstag',
  valuta: 'Wertstellung',
  betrag: 'Betrag',
  soll: 'Soll (Ausgang)',
  haben: 'Haben (Eingang)',
  gegenseite: 'Name der Gegenseite',
  gegenseiteEin: 'Name bei Eingängen (Zahlungspflichtiger)',
  gegenseiteAus: 'Name bei Ausgängen (Empfänger)',
  gegenIban: 'IBAN der Gegenseite',
  gegenBic: 'BIC der Gegenseite',
  zweck: 'Verwendungszweck',
  buchungstext: 'Buchungstext',
  referenz: 'Referenz',
  waehrung: 'Währung',
  saldo: 'Saldo',
  status: 'Status (nur „gebucht“ zählt)',
  eigeneIban: 'Eigenes Konto (IBAN)',
};

/**
 * Liest eine CSV-Datei.
 *
 * @param {string} text
 * @param {{trenner?:string, kopfzeile?:number, spalten?:Object<string,number>, dezimal?:'komma'|'punkt'|'auto'}} [opt]
 *   spalten: Rolle → Spaltennummer (überschreibt die Erkennung; -1 = nicht verwenden)
 * @returns {object} { format, trenner, zeilen (roh), kopfzeile, kopf, spalten, erkannt, dezimal, umsaetze, uebersprungen, konto }
 */
export function csvLesen(text, opt = {}) {
  const trenner = opt.trenner || csvTrenner(text);
  const zeilen = csvZeilen(text, trenner);
  // Kopfzeile: die erste mit mindestens drei erkannten Überschriften; sonst die mit den meisten (mindestens zwei)
  let kopfzeile = Number.isInteger(opt.kopfzeile) ? opt.kopfzeile : -1;
  if (kopfzeile < 0) {
    let bestP = 0;
    for (let i = 0; i < Math.min(zeilen.length, 80); i++) {
      const p = kopfPunkte(zeilen[i]);
      if (p >= 3) { kopfzeile = i; break; }
      if (p > bestP) { bestP = p; kopfzeile = p >= 2 ? i : -1; }
    }
  }
  const kopf = kopfzeile >= 0 ? zeilen[kopfzeile].map(zu) : [];
  const erkannt = {};
  kopf.forEach((z, i) => {
    const r = rolleVon(z);
    // Das eigene Konto steht oft in mehreren Spalten („Bezeichnung Auftragskonto“, „IBAN Auftragskonto“): gesucht ist die mit der IBAN.
    if (r && (!(r in erkannt) || (r === 'eigeneIban' && /iban/.test(norm(z)) && !/iban/.test(norm(kopf[erkannt[r]]))))) erkannt[r] = i;
  });
  const spalten = { ...erkannt };
  for (const [r, i] of Object.entries(opt.spalten || {})) { if (i === -1 || i === null) delete spalten[r]; else spalten[r] = i; }

  // Kopfangaben vor der Tabelle: eigene IBAN etwa bei ING („IBAN;DE12 …“)
  let eigeneIban = '';
  for (let i = 0; i < (kopfzeile >= 0 ? kopfzeile : Math.min(zeilen.length, 12)); i++) {
    const f = ibanFinden(zeilen[i].join(' '));
    if (f) { eigeneIban = f; break; }
  }

  const daten = zeilen.slice(kopfzeile >= 0 ? kopfzeile + 1 : 0);
  const zelle = (z, rolle) => (rolle in spalten && spalten[rolle] < z.length ? zu(z[spalten[rolle]]) : '');

  // Dezimalzeichen am Betrag der Spalte erkennen
  let dezimal = opt.dezimal || 'auto';
  if (dezimal === 'auto') {
    let komma = 0; let punkt = 0;
    for (const z of daten.slice(0, 400)) {
      for (const r of ['betrag', 'soll', 'haben']) {
        const w = zelle(z, r);
        if (/,\d{1,2}\s*[-+€A-Za-z]*$/.test(w)) komma++;
        else if (/\.\d{1,2}\s*[-+€A-Za-z]*$/.test(w) && !/^\d{1,3}(\.\d{3})+$/.test(w)) punkt++;
      }
    }
    dezimal = punkt > komma ? 'punkt' : 'komma';
  }

  const umsaetze = [];
  const uebersprungen = [];
  let nr = kopfzeile >= 0 ? kopfzeile + 1 : 0;
  for (const z of daten) {
    nr++;
    if (z.every((c) => !zu(c))) continue;
    const datum = datumLesen(zelle(z, 'datum')) || (opt.spalten?.datum === undefined ? datumLesen(zelle(z, 'valuta')) : null);
    let betrag = null;
    if ('betrag' in spalten) betrag = betragLesen(zelle(z, 'betrag'), dezimal);
    else if ('soll' in spalten || 'haben' in spalten) {
      const s = betragLesen(zelle(z, 'soll'), dezimal);
      const h = betragLesen(zelle(z, 'haben'), dezimal);
      if (s !== null || h !== null) betrag = (h ?? 0) - Math.abs(s ?? 0);
    }
    if (!datum || betrag === null) { uebersprungen.push({ zeile: nr, grund: !datum ? 'kein Datum' : 'kein Betrag', text: z.map(zu).join(' ').slice(0, 80) }); continue; }
    const st = zelle(z, 'status');
    if (st && !/gebucht|booked|^$/i.test(st)) { uebersprungen.push({ zeile: nr, grund: `Status „${st}“, noch nicht gebucht`, text: z.map(zu).join(' ').slice(0, 80) }); continue; }
    const name = betrag > 0 ? (zelle(z, 'gegenseiteEin') || zelle(z, 'gegenseite') || zelle(z, 'gegenseiteAus')) : (zelle(z, 'gegenseiteAus') || zelle(z, 'gegenseite') || zelle(z, 'gegenseiteEin'));
    const ib = zelle(z, 'gegenIban');
    umsaetze.push(umsatz({
      datum,
      valuta: datumLesen(zelle(z, 'valuta')) || '',
      betrag,
      waehrung: (zelle(z, 'waehrung') || 'EUR').toUpperCase().slice(0, 3),
      gegenseite: name,
      gegenIban: ibanFinden(ib) || ib.replace(/\s/g, ''),
      gegenBic: zelle(z, 'gegenBic'),
      zweck: zelle(z, 'zweck'),
      buchungstext: zelle(z, 'buchungstext'),
      referenz: zelle(z, 'referenz'),
      zeile: nr,
    }));
    if (!eigeneIban && 'eigeneIban' in spalten) eigeneIban = ibanFinden(zelle(z, 'eigeneIban'));
  }
  return {
    format: 'csv', trenner, zeilen, kopfzeile, kopf, spalten, erkannt, dezimal, signatur: kopf.length ? kopfSignatur(kopf) : '',
    umsaetze, uebersprungen, konto: { iban: eigeneIban },
  };
}

/* -------------------------------------------------------------------------- */
/* CAMT.053                                                                    */
/* -------------------------------------------------------------------------- */

const k1 = (n, name) => n?.children?.find((c) => c.name === name) || null;
const kn = (n, name) => n?.children?.filter((c) => c.name === name) || [];
const pf = (n, ...namen) => namen.reduce((x, name) => k1(x, name), n);
const tx = (n) => zu(n?.text);
const wt = (n, ...namen) => tx(pf(n, ...namen));
/** Datum oder Datum mit Zeit aus <Dt> oder <DtTm>. */
const camtDatum = (n) => datumLesen(wt(n, 'Dt') || wt(n, 'DtTm').slice(0, 10));

/**
 * Liest CAMT.053 (auch 052 und 054; Version 02 bis 08, Namensraum egal).
 * Je Buchung mit mehreren Einzelposten, die einzeln einen Betrag nennen und
 * zusammen den Betrag der Buchung ergeben, entsteht je Posten ein Umsatz.
 */
export function camtLesen(text) {
  const wurzel = xmlBaum(text);
  const doc = wurzel.name === 'Document' ? wurzel : (k1(wurzel, 'Document') || wurzel);
  const hauptteil = doc.children.find((c) => /^BkToCstmr/.test(c.name));
  if (!hauptteil) throw new Error('Das ist keine CAMT-Datei.');
  const umsaetze = [];
  const uebersprungen = [];
  let iban = '';
  let nr = 0;
  const abschnitte = hauptteil.children.filter((c) => ['Stmt', 'Rpt', 'Ntfctn'].includes(c.name));
  for (const st of abschnitte) {
    iban ||= wt(st, 'Acct', 'Id', 'IBAN') || wt(st, 'Acct', 'Id', 'Othr', 'Id');
    for (const e of kn(st, 'Ntry')) {
      nr++;
      const status = wt(e, 'Sts') || wt(e, 'Sts', 'Cd');
      if (status && !/^(BOOK|BOOKED|gebucht)$/i.test(status)) { uebersprungen.push({ zeile: nr, grund: `Status ${status}`, text: '' }); continue; }
      const eAmt = pf(e, 'Amt');
      const gesamt = betragLesen(tx(eAmt), 'punkt');
      if (gesamt === null) { uebersprungen.push({ zeile: nr, grund: 'kein Betrag', text: '' }); continue; }
      const eingang = wt(e, 'CdtDbtInd') === 'CRDT';
      const waehr = (eAmt?.attrs?.Ccy || 'EUR').toUpperCase();
      const datum = camtDatum(pf(e, 'BookgDt')) || camtDatum(pf(e, 'ValDt'));
      const valuta = camtDatum(pf(e, 'ValDt')) || '';
      if (!datum) { uebersprungen.push({ zeile: nr, grund: 'kein Datum', text: '' }); continue; }
      const buchungstext = wt(e, 'AddtlNtryInf') || wt(e, 'BkTxCd', 'Prtry', 'Cd') || wt(e, 'BkTxCd', 'Domn', 'Fmly', 'Cd');
      const details = kn(pf(e, 'NtryDtls'), 'TxDtls');

      const aus = (d, betrag, richtungEin) => {
        const parteien = pf(d, 'RltdPties');
        const wer = richtungEin ? 'Dbtr' : 'Cdtr';
        const konto = richtungEin ? 'DbtrAcct' : 'CdtrAcct';
        const agent = richtungEin ? 'DbtrAgt' : 'CdtrAgt';
        const ustrd = kn(pf(d, 'RmtInf'), 'Ustrd').map(tx).filter(Boolean).join(' ');
        const strukt = wt(d, 'RmtInf', 'Strd', 'CdtrRefInf', 'Ref');
        return umsatz({
          datum, valuta, betrag, waehrung: waehr,
          gegenseite: wt(parteien, wer, 'Nm') || wt(parteien, wer, 'Pty', 'Nm') || wt(parteien, `Ultmt${wer}`, 'Nm'),
          gegenIban: wt(parteien, konto, 'Id', 'IBAN') || wt(parteien, konto, 'Id', 'Othr', 'Id'),
          gegenBic: wt(d, 'RltdAgts', agent, 'FinInstnId', 'BIC') || wt(d, 'RltdAgts', agent, 'FinInstnId', 'BICFI'),
          zweck: ustrd || strukt || wt(d, 'AddtlTxInf'),
          buchungstext: buchungstext || wt(d, 'AddtlTxInf'),
          referenz: wt(d, 'Refs', 'EndToEndId') && wt(d, 'Refs', 'EndToEndId') !== 'NOTPROVIDED' ? wt(d, 'Refs', 'EndToEndId') : (wt(d, 'Refs', 'MndtId') || wt(e, 'AcctSvcrRef')),
          zeile: nr,
        });
      };

      const einzel = details.map((d) => {
        const a = pf(d, 'AmtDtls', 'TxAmt', 'Amt') || pf(d, 'Amt');
        const b = a ? betragLesen(tx(a), 'punkt') : null;
        const ein = (wt(d, 'CdtDbtInd') || (eingang ? 'CRDT' : 'DBIT')) === 'CRDT';
        return { d, b, ein };
      });
      const teilbar = details.length > 1 && einzel.every((x) => x.b !== null)
        && einzel.reduce((s, x) => s + (x.ein === eingang ? x.b : -x.b), 0) === gesamt;
      if (teilbar) {
        for (const x of einzel) { umsaetze.push(aus(x.d, x.ein ? x.b : -x.b, x.ein)); }
      } else {
        const d = details[0] || e;
        umsaetze.push(aus(d, eingang ? gesamt : -gesamt, eingang));
        // Mehrere Einzelposten ohne eigenen Betrag: Verwendungszwecke zusammenführen
        if (details.length > 1) {
          const alle = details.map((x) => kn(pf(x, 'RmtInf'), 'Ustrd').map(tx).join(' ')).filter(Boolean);
          if (alle.length > 1) umsaetze[umsaetze.length - 1].zweck = zu(alle.join(' '));
        }
      }
    }
  }
  return { format: 'camt', umsaetze, uebersprungen, konto: { iban: iban.replace(/\s/g, '') } };
}

/* -------------------------------------------------------------------------- */
/* MT940                                                                       */
/* -------------------------------------------------------------------------- */

/** :86:-Feld nach deutscher Konvention („?20Verwendungszweck?32Name …“) zerlegen. */
function mt86(feld) {
  const t = String(feld).replace(/\r?\n/g, '');
  const out = { buchungstext: '', zweck: '', gegenseite: '', gegenIban: '', gegenBic: '', referenz: '' };
  const gvc = /^(\d{3})(?=\?|$)/.exec(t);
  if (!/\?\d\d/.test(t)) {
    // Ohne Unterfelder: alles ist Verwendungszweck.
    out.zweck = zu(t);
    return zweckZerlegen(out);
  }
  const teile = {};
  for (const m of t.matchAll(/\?(\d\d)([^?]*)/g)) teile[m[1]] = (teile[m[1]] || '') + m[2];
  out.buchungstext = zu(teile['00'] || '');
  let zweck = '';
  const zeilen = [];
  for (let i = 20; i <= 29; i++) if (teile[String(i)] !== undefined) zeilen.push(teile[String(i)]);
  for (let i = 60; i <= 63; i++) if (teile[String(i)] !== undefined) zeilen.push(teile[String(i)]);
  // Zeilen sind auf 27 Zeichen gebrochen: ist eine voll, geht das Wort in der nächsten weiter.
  zeilen.forEach((z, i) => { zweck += (i && zeilen[i - 1].length < 27 ? ' ' : '') + z; });
  out.zweck = zu(zweck);
  out.gegenseite = zu((teile['32'] || '') + (teile['33'] || ''));
  out.gegenBic = zu(teile['30'] || '');
  out.gegenIban = ibanFinden(teile['31'] || '') || zu(teile['31'] || '');
  if (gvc) out.buchungstext ||= `GVC ${gvc[1]}`;
  return zweckZerlegen(out);
}

/** EREF+, KREF+, SVWZ+, IBAN+, BIC+, ABWA+ … aus dem Verwendungszweck lösen. */
function zweckZerlegen(o) {
  const z = o.zweck;
  if (!/(?:^|\s)(?:EREF|KREF|SVWZ|MREF|CRED|IBAN|BIC|ABWA|ABWE|OAMT|COAM)\+/.test(z)) return o;
  const felder = {};
  const re = /(EREF|KREF|SVWZ|MREF|CRED|IBAN|BIC|ABWA|ABWE|OAMT|COAM)\+/g;
  const marken = [...z.matchAll(re)];
  marken.forEach((m, i) => { felder[m[1]] = zu(z.slice(m.index + m[0].length, i + 1 < marken.length ? marken[i + 1].index : undefined)); });
  if (felder.SVWZ !== undefined) o.zweck = felder.SVWZ;
  else o.zweck = zu(z.replace(re, ' '));
  if (felder.EREF && felder.EREF !== 'NOTPROVIDED') o.referenz = felder.EREF;
  if (!o.gegenIban && felder.IBAN) o.gegenIban = felder.IBAN.replace(/\s/g, '');
  if (!o.gegenBic && felder.BIC) o.gegenBic = felder.BIC;
  if (!o.gegenseite && felder.ABWA) o.gegenseite = felder.ABWA;
  return o;
}

/**
 * Liest MT940 (SWIFT, Feld :61: und :86:, deutsche Bankenkonvention).
 * @returns {{format:'mt940', umsaetze:object[], uebersprungen:object[], konto:{iban:string}}}
 */
export function mt940Lesen(text) {
  // Felder: eine Zeile, die mit „:nn:“ oder „:nnX:“ beginnt, öffnet ein Feld; alles andere (außer „-“) setzt das Feld fort.
  const felder = [];
  for (const roh of String(text).split(/\r?\n/)) {
    const m = /^:(\d\d[A-Z]?):(.*)$/.exec(roh);
    if (m) felder.push({ tag: m[1], text: m[2] });
    else if (roh.startsWith('-') && roh.trim() === '-') continue;
    else if (felder.length && roh.length) felder[felder.length - 1].text += `\n${roh}`;
  }
  const umsaetze = [];
  const uebersprungen = [];
  let iban = '';
  let nr = 0;
  for (let i = 0; i < felder.length; i++) {
    const f = felder[i];
    if (f.tag === '25' && !iban) {
      iban = ibanFinden(f.text) || '';
    } else if (f.tag === '61') {
      nr++;
      const kopf = f.text.split('\n')[0];
      const mm = /^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])([A-Z])?([\d,]+)N(\w{3})(.*)$/.exec(kopf);
      if (!mm) { uebersprungen.push({ zeile: nr, grund: 'Zeile :61: nicht lesbar', text: kopf.slice(0, 80) }); continue; }
      const jahr = 2000 + Number(mm[1]);
      const valuta = `${jahr}-${mm[2]}-${mm[3]}`;
      let datum = valuta;
      if (mm[4]) {
        const bm = Number(mm[4].slice(0, 2));
        const bt = mm[4].slice(2);
        // Buchungstag ohne Jahr: das Jahr der Valuta, bei Jahreswechsel das benachbarte
        let by = jahr;
        if (bm === 12 && Number(mm[2]) === 1) by = jahr - 1;
        else if (bm === 1 && Number(mm[2]) === 12) by = jahr + 1;
        datum = `${by}-${String(bm).padStart(2, '0')}-${bt}`;
      }
      const cent = betragLesen(mm[7], 'komma');
      const art = mm[5];
      const minus = art === 'D' || art === 'RC';
      const rest = mm[9] || '';
      const [kundenRef] = rest.split('//');
      const u = umsatz({
        datum: datumLesen(datum) || '', valuta: datumLesen(valuta) || '', betrag: minus ? -(cent ?? 0) : (cent ?? 0), zeile: nr,
        referenz: zu(kundenRef === 'NONREF' ? '' : kundenRef),
      });
      const naechstes = felder[i + 1];
      if (naechstes?.tag === '86') Object.assign(u, Object.fromEntries(Object.entries(mt86(naechstes.text)).filter(([, v]) => v)));
      if (!u.datum || cent === null) { uebersprungen.push({ zeile: nr, grund: !u.datum ? 'kein Datum' : 'kein Betrag', text: kopf.slice(0, 80) }); continue; }
      umsaetze.push(u);
    }
  }
  if (!umsaetze.length && !uebersprungen.length) throw new Error('In der MT940-Datei stehen keine Umsätze.');
  return { format: 'mt940', umsaetze, uebersprungen, konto: { iban } };
}

/* -------------------------------------------------------------------------- */
/* Eingang                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Liest einen Kontoauszug aus Bytes: Zeichensatz und Format werden erkannt.
 * Für CSV lassen sich Zuordnung, Trennzeichen und Kopfzeile übersteuern.
 * @returns {object} wie csvLesen / camtLesen / mt940Lesen, dazu kodierung und name
 */
export function kontoauszugLesen(bytes, name = '', opt = {}) {
  const { text, kodierung } = textAusBytes(bytes);
  const format = opt.format || formatErkennen(text);
  const erg = format === 'camt' ? camtLesen(text) : format === 'mt940' ? mt940Lesen(text) : csvLesen(text, opt);
  return { ...erg, kodierung, name };
}

/** Zeitraum und Summen der Umsätze für die Vorschau. */
export function zusammenfassung(umsaetze) {
  const daten = umsaetze.map((u) => u.datum).sort();
  return {
    anzahl: umsaetze.length,
    von: daten[0] || '',
    bis: daten[daten.length - 1] || '',
    eingang: umsaetze.filter((u) => u.betrag > 0).reduce((s, u) => s + u.betrag, 0),
    ausgang: umsaetze.filter((u) => u.betrag < 0).reduce((s, u) => s + u.betrag, 0),
  };
}
