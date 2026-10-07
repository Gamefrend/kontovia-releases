/**
 * Kontovia – ELSTER-Dateien schreiben und lesen.
 *
 * „Mein ELSTER“ nimmt für die Umsatzsteuer-Voranmeldung eine XML-Datei an
 * (Formular öffnen, Reiter „XML-Import“). Erwartet wird nur der Block
 * <Anmeldungssteuern> aus der amtlichen Schnittstelle, mit Namensraum und
 * Version des Jahres und im Zeichensatz ISO-8859-15. Kontovia übermittelt
 * selbst nichts; die Datei lädt der Nutzer hoch und sendet in ELSTER ab.
 *
 * Umgekehrt liest diese Datei solche XML-Dateien wieder ein: die eigenen,
 * die anderer Programme und vollständige ELSTER-Datensätze mit Transferkopf.
 * Daraus entsteht eine „Meldung“ (Sammlung elsterMeldungen), die neben die
 * eigene Berechnung gestellt wird. Mein ELSTER selbst kann keine Daten
 * ausgeben, nur einen Ausdruck als PDF; der lässt sich nicht einlesen.
 *
 * Rundung wie in ELSTER: Bemessungsgrundlagen in vollen Euro (Nachkommastellen
 * fallen weg), die Steuer darauf rechnet ELSTER selbst, Steuer- und
 * Vorsteuerbeträge mit Cent. Die Kennzahl 83 entsteht daraus und kann deshalb
 * um einige Cent von der centgenauen Summe der Buchungen abweichen.
 *
 * Läuft ohne Oberfläche und Speicher (Prüfung: scripts/pruefungen/datenimport.test.js).
 */

import { xmlBaum } from './erechnung.js';
import { vatReturn } from './calc.js';
import { todayISO } from './util.js';

/* -------------------------------------------------------------------------- */
/* Steuernummer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Bundesländer mit Vorziffern des 13-stelligen ELSTER-Formats. Aus der
 * Schreibweise auf dem Bescheid wird: Vorziffern, Finanzamt, „0“, Rest.
 * Hessen schreibt eine führende 0, die im ELSTER-Format wegfällt.
 */
export const BUNDESLAENDER = {
  BW: { name: 'Baden-Württemberg', vor: '28', stellen: 10 },
  BY: { name: 'Bayern', vor: '9', stellen: 11 },
  BE: { name: 'Berlin', vor: '11', stellen: 10 },
  BB: { name: 'Brandenburg', vor: '3', stellen: 11 },
  HB: { name: 'Bremen', vor: '24', stellen: 10 },
  HH: { name: 'Hamburg', vor: '22', stellen: 10 },
  HE: { name: 'Hessen', vor: '26', stellen: 11, ohneNull: true },
  MV: { name: 'Mecklenburg-Vorpommern', vor: '4', stellen: 11 },
  NI: { name: 'Niedersachsen', vor: '23', stellen: 10 },
  NW: { name: 'Nordrhein-Westfalen', vor: '5', stellen: 11 },
  RP: { name: 'Rheinland-Pfalz', vor: '27', stellen: 10 },
  SL: { name: 'Saarland', vor: '1', stellen: 11 },
  SN: { name: 'Sachsen', vor: '3', stellen: 11 },
  ST: { name: 'Sachsen-Anhalt', vor: '3', stellen: 11 },
  SH: { name: 'Schleswig-Holstein', vor: '21', stellen: 10 },
  TH: { name: 'Thüringen', vor: '4', stellen: 11 },
};

/** Grobe Zuordnung der Postleitzahl zum Bundesland, nur als Vorschlag. */
const PLZ_LAND = [
  [1, 'SN'], [6, 'ST'], [7, 'TH'], [8, 'SN'], [10, 'BE'], [14, 'BB'], [17, 'MV'], [20, 'HH'], [23, 'SH'],
  [26, 'NI'], [28, 'HB'], [29, 'NI'], [32, 'NW'], [34, 'HE'], [37, 'NI'], [39, 'ST'], [40, 'NW'], [49, 'NI'],
  [50, 'NW'], [54, 'RP'], [57, 'NW'], [60, 'HE'], [66, 'SL'], [67, 'RP'], [68, 'BW'], [80, 'BY'], [88, 'BW'],
  [89, 'BY'], [98, 'TH'],
];

export function landAusPlz(plz) {
  const n = Number(String(plz ?? '').trim().slice(0, 2));
  if (!/^\d{5}$/.test(String(plz ?? '').trim())) return '';
  let land = '';
  for (const [ab, l] of PLZ_LAND) if (n >= ab) land = l;
  return land;
}

/**
 * Steuernummer → 13 Ziffern für ELSTER, sonst ''. Schon 13-stellige Nummern
 * bleiben, wie sie sind; die Vorziffern müssen dann zum Land passen.
 */
export function steuernummerElster(eingabe, land) {
  const z = String(eingabe ?? '').replace(/\D/g, '');
  const l = BUNDESLAENDER[land];
  if (z.length === 13) return !l || z.startsWith(l.vor) ? z : '';
  if (!l) return '';
  if (l.ohneNull && z.length === 11 && z[0] === '0') return l.vor + z.slice(1, 3) + '0' + z.slice(3);
  if (z.length === 12 && z.startsWith(l.vor)) {
    // Zwölfstellige Schreibweise mit Vorziffern, nur ohne die eingeschobene 0.
    return z.slice(0, 4) + '0' + z.slice(4);
  }
  // Hessen: elf Stellen nur mit der führenden 0 (oben), ohne sie zehn. Bis 2.26
  // wurde aus elf Stellen ohne 0 eine 14-stellige Nummer.
  if (l.ohneNull) return z.length === 10 ? l.vor + z.slice(0, 2) + '0' + z.slice(2) : '';
  if (z.length !== l.stellen) return '';
  const fa = l.stellen === 10 ? 2 : 3;
  return l.vor + z.slice(0, fa) + '0' + z.slice(fa);
}

/* -------------------------------------------------------------------------- */
/* Werte wie ELSTER sie erwartet                                               */
/* -------------------------------------------------------------------------- */

/** Kennzahlen mit Bemessungsgrundlage in vollen Euro und dem Steuersatz, mit dem ELSTER die Steuer rechnet. */
const BASIS = { kz81: 19, kz86: 7, kz35: 0, kz41: 0, kz21: 0, kz43: 0, kz45: 0, kz48: 0, kz60: 0, kz89: 19, kz93: 7, kz46: 0, kz84: 0 };
/** Kennzahlen mit Cent (Steuerbeträge, Sondervorauszahlung). */
const CENT = ['kz36', 'kz39', 'kz47', 'kz61', 'kz66', 'kz67', 'kz83', 'kz85'];

/** Volle Euro ohne Nachkommastellen, für negative Werte zur Null hin. */
const euroGanz = (cent) => Math.trunc((Number(cent) || 0) / 100);

/**
 * Die Werte, die in ELSTER stehen: Bemessungsgrundlagen in Euro (ganzzahlig),
 * Steuer- und Vorsteuerbeträge in Cent, Kennzahl 83 in Cent so, wie ELSTER
 * sie aus diesen Werten errechnet.
 * @param {object} v Ergebnis von vatReturn()
 */
export function elsterWerte(v) {
  const w = {
    kz81: euroGanz(v.kz81net), kz86: euroGanz(v.kz86net), kz35: euroGanz(v.kz35net), kz36: v.kz36tax || 0,
    kz41: euroGanz(v.kz41), kz21: euroGanz(v.kz21), kz43: euroGanz(v.kz43), kz45: euroGanz(v.kz45), kz48: euroGanz(v.kz48),
    kz60: euroGanz(v.kz60), kz89: euroGanz(v.kz89net), kz93: euroGanz(v.kz93net), kz46: euroGanz(v.kz46net), kz47: v.kz47tax || 0,
    kz84: euroGanz(v.kz84net), kz85: v.kz85tax || 0,
    kz66: v.kz66 || 0, kz61: v.kz61 || 0, kz67: v.kz67 || 0, kz39: v.kz39 || 0,
  };
  // Euro × Prozent ergibt genau Cent: 1.234 € × 19 = 23.446 Cent.
  const ust = w.kz81 * 19 + w.kz86 * 7 + w.kz89 * 19 + w.kz93 * 7 + w.kz36 + w.kz47 + w.kz85;
  w.kz83 = ust - w.kz66 - w.kz61 - w.kz67 - w.kz39;
  w.umsatzsteuer = ust;
  return w;
}

/** Voranmeldungszeitraum für ELSTER: „01“ bis „12“ (Monat), „41“ bis „44“ (Quartal), sonst null. */
export function ustvaZeitraum(period) {
  const { from, to } = period || {};
  if (!/^\d{4}-\d{2}-01$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from.slice(0, 4) !== to.slice(0, 4)) return null;
  const m1 = Number(from.slice(5, 7));
  const m2 = Number(to.slice(5, 7));
  const letzter = new Date(Date.UTC(Number(to.slice(0, 4)), m2, 0)).getUTCDate();
  if (Number(to.slice(8, 10)) !== letzter) return null;
  if (m1 === m2) return String(m1).padStart(2, '0');
  if (m2 === m1 + 2 && (m1 - 1) % 3 === 0) return String(41 + (m1 - 1) / 3);
  return null;
}

/** Zeitraum aus Jahr und ELSTER-Code zurück in {from, to}. */
export function zeitraumAusCode(jahr, code) {
  const j = Number(jahr);
  const c = Number(code);
  const ende = (m) => `${j}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, '0')}`;
  if (c >= 1 && c <= 12) return { from: `${j}-${String(c).padStart(2, '0')}-01`, to: ende(c) };
  if (c >= 41 && c <= 44) { const m = (c - 41) * 3 + 1; return { from: `${j}-${String(m).padStart(2, '0')}-01`, to: ende(m + 2) }; }
  return null;
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** „März 2026“ oder „2. Quartal 2026“. */
export function zeitraumText(jahr, code) {
  const c = Number(code);
  if (c >= 1 && c <= 12) return `${MONATE[c - 1]} ${jahr}`;
  if (c >= 41 && c <= 44) return `${c - 40}. Quartal ${jahr}`;
  return String(jahr);
}

/* -------------------------------------------------------------------------- */
/* Schreiben                                                                   */
/* -------------------------------------------------------------------------- */

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zahl = (cent) => {
  const n = Number(cent) || 0;
  const s = (Math.abs(n) / 100).toFixed(2);
  return (n < 0 ? '-' : '') + s;
};

/**
 * Die Voranmeldung als XML für „Mein ELSTER“ (Reiter „XML-Import“).
 * Wirft, wenn der Zeitraum kein Monat oder Quartal ist oder die Steuernummer fehlt,
 * und solange Buchungen ohne Kategorie im Zeitraum liegen (Code OHNE_KATEGORIE,
 * mit `opt.trotzdem` erzeugt sie die Datei dennoch).
 * @param {{steuernummer:string, berichtigt?:boolean, heute?:string, trotzdem?:boolean}} opt
 */
export function ustvaXml(db, period, opt = {}) {
  const code = ustvaZeitraum(period);
  if (!code) throw Object.assign(new Error('Eine Voranmeldung gilt für einen Monat oder ein Quartal. Bitte den Zeitraum entsprechend wählen.'), { code: 'ZEITRAUM' });
  const stnr = String(opt.steuernummer || '').replace(/\D/g, '');
  if (stnr.length !== 13) throw Object.assign(new Error('Für ELSTER wird die Steuernummer im 13-stelligen Format gebraucht.'), { code: 'STEUERNUMMER' });
  const v = vatReturn(db, period.from, period.to);
  if (v.kleinunternehmer) throw Object.assign(new Error('Als Kleinunternehmer geben Sie keine Voranmeldung ab.'), { code: 'KLEIN' });
  if (v.ohneKategorie.length && !opt.trotzdem) {
    const n = v.ohneKategorie.length;
    throw Object.assign(new Error(`Im Zeitraum ${n === 1 ? 'liegt eine Buchung' : `liegen ${n} Buchungen`} ohne Kategorie. Ohne Kategorie ist nicht klar, ob und wie hoch Umsatzsteuer anfällt; die Voranmeldung wäre unvollständig.`), { code: 'OHNE_KATEGORIE', ids: v.ohneKategorie });
  }
  const w = elsterWerte(v);
  const jahr = period.from.slice(0, 4);
  const s = db.settings || {};
  const heute = (opt.heute || todayISO()).replace(/-/g, '');

  // Die Kennzahlen stehen im Schema in aufsteigender Reihenfolge.
  const felder = opt.berichtigt ? [['Kz10', '1']] : [];
  for (const kz of [...Object.keys(BASIS), ...CENT]) {
    // Leere Kennzahlen bleiben weg; die 83 steht immer drin, auch als 0,00.
    if (!w[kz] && kz !== 'kz83') continue;
    felder.push([`Kz${kz.slice(2)}`, kz in BASIS ? String(w[kz]) : zahl(w[kz])]);
  }
  felder.sort((a, b) => Number(a[0].slice(2)) - Number(b[0].slice(2)));

  const name = s.companyName || s.ownerName || 'Unternehmen';
  return `<?xml version="1.0" encoding="ISO-8859-15" standalone="no"?>
<Anmeldungssteuern xmlns="http://finkonsens.de/elster/elsteranmeldung/ustva/v${jahr}" version="${jahr}">
  <Erstellungsdatum>${heute}</Erstellungsdatum>
  <DatenLieferant>
    <Name>${xmlEsc(name.slice(0, 45))}</Name>
    <Strasse>${xmlEsc(String(s.street || '').slice(0, 30))}</Strasse>
    <PLZ>${xmlEsc(String(s.zip || '').slice(0, 12))}</PLZ>
    <Ort>${xmlEsc(String(s.city || '').slice(0, 30))}</Ort>
  </DatenLieferant>
  <Steuerfall>
    <Umsatzsteuervoranmeldung>
      <Jahr>${jahr}</Jahr>
      <Zeitraum>${code}</Zeitraum>
      <Steuernummer>${stnr}</Steuernummer>
${felder.map(([k, x]) => `      <${k}>${x}</${k}>`).join('\n')}
    </Umsatzsteuervoranmeldung>
  </Steuerfall>
</Anmeldungssteuern>
`;
}

/** ISO-8859-15: wie Latin-1, nur € und sieben weitere Zeichen an anderer Stelle. */
const LATIN9 = new Map([[0x20ac, 0xa4], [0x160, 0xa6], [0x161, 0xa8], [0x17d, 0xb4], [0x17e, 0xb8], [0x152, 0xbc], [0x153, 0xbd], [0x178, 0xbe]]);
const LATIN9_FREI = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);

/** Text → Bytes in ISO-8859-15; Zeichen außerhalb werden zu „?“. */
export function latin9(text) {
  const s = String(text ?? '');
  const out = new Uint8Array(s.length);
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (LATIN9.has(c)) out[n++] = LATIN9.get(c);
    else if (c < 0x100 && !LATIN9_FREI.has(c)) out[n++] = c;
    else out[n++] = 0x3f;
  }
  return out.subarray(0, n);
}

/* -------------------------------------------------------------------------- */
/* Lesen                                                                       */
/* -------------------------------------------------------------------------- */

const kinder = (n) => n?.children || [];
function finden(n, name, out = []) {
  if (!n) return out;
  if (n.name === name) out.push(n);
  for (const c of kinder(n)) finden(c, name, out);
  return out;
}
const textVon = (n, name) => String(kinder(n).find((c) => c.name === name)?.text ?? '').trim();

const FLAGS = new Set(['kz09', 'kz10', 'kz22', 'kz26', 'kz29']);

/** Kennzahl aus ELSTER-Text („1234“, „1234.56“, „1234,56“) → Cent. */
function centAus(s) {
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!/^-?\d+([.,]\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t.replace(',', '.')) * 100);
}

/**
 * Liest eine ELSTER-XML-Datei. Unterstützt werden Umsatzsteuer-Voranmeldungen
 * (auch mehrere in einer Datei, auch mit vollständigem Transferkopf).
 * Bemessungsgrundlagen und Steuerbeträge kommen einheitlich in Cent zurück.
 * @returns {{meldungen: object[], hinweise: string[]}}
 */
export function elsterLesen(text) {
  let baum;
  try { baum = xmlBaum(text); } catch (e) { throw Object.assign(new Error(`Die Datei ist kein lesbares XML: ${e.message}`), { code: 'XML' }); }
  const voranmeldungen = finden(baum, 'Umsatzsteuervoranmeldung');
  const hinweise = [];
  if (!voranmeldungen.length) {
    const andere = ['Lohnsteueranmeldung', 'Umsatzsteuererklaerung', 'EUER', 'E6000', 'Einkommensteuererklaerung', 'Zusammenfassende_Meldung']
      .filter((n) => finden(baum, n).length || String(text).includes(`<${n}`));
    throw Object.assign(new Error(andere.length
      ? 'Diese ELSTER-Datei enthält keine Umsatzsteuer-Voranmeldung. Eingelesen werden derzeit nur Voranmeldungen.'
      : 'In der Datei steht keine Umsatzsteuer-Voranmeldung im ELSTER-Format.'), { code: 'INHALT' });
  }
  const version = baum.attrs?.version || /ustva\/v(\d{4})/.exec(baum.attrs?.xmlns || '')?.[1] || '';
  const meldungen = [];
  for (const u of voranmeldungen) {
    const jahr = textVon(u, 'Jahr');
    const zeitraum = textVon(u, 'Zeitraum').padStart(2, '0');
    const range = zeitraumAusCode(jahr, zeitraum);
    if (!/^\d{4}$/.test(jahr) || !range) { hinweise.push(`Eine Voranmeldung ohne gültigen Zeitraum wurde übersprungen (${jahr || '?'}/${zeitraum || '?'}).`); continue; }
    const werte = {};
    let berichtigt = false;
    for (const c of kinder(u)) {
      const m = /^Kz(\d{2})$/.exec(c.name);
      if (!m) continue;
      const kz = `kz${m[1]}`;
      // Angaben zum Berater und Ankreuzfelder (berichtigt, Belege, Verrechnung, Lastschrift) sind keine Beträge.
      if (FLAGS.has(kz)) { if (kz === 'kz10') berichtigt = String(c.text).trim() === '1'; continue; }
      const c2 = centAus(c.text);
      if (c2 === null) { hinweise.push(`Kennzahl ${m[1]} hat keinen lesbaren Betrag und fehlt.`); continue; }
      // Bemessungsgrundlagen stehen in vollen Euro; sie kommen hier auch in Cent.
      werte[kz] = c2;
    }
    if (werte.kz83 === undefined) {
      // Ohne Kennzahl 83 rechnet Kontovia sie wie ELSTER nach.
      const e = (k) => Math.trunc((werte[k] || 0) / 100);
      werte.kz83 = e('kz81') * 19 + e('kz86') * 7 + e('kz89') * 19 + e('kz93') * 7 + (werte.kz36 || 0) + (werte.kz47 || 0) + (werte.kz85 || 0)
        - (werte.kz66 || 0) - (werte.kz61 || 0) - (werte.kz67 || 0) - (werte.kz39 || 0);
      hinweise.push(`${zeitraumText(jahr, zeitraum)}: Kennzahl 83 fehlte und wurde nachgerechnet.`);
    }
    meldungen.push({
      art: 'ustva', jahr, zeitraum, von: range.from, bis: range.to,
      steuernummer: textVon(u, 'Steuernummer').replace(/\D/g, ''),
      berichtigt, werte, version,
    });
  }
  if (!meldungen.length) throw Object.assign(new Error('Keine der Voranmeldungen in der Datei ließ sich lesen.'), { code: 'INHALT' });
  return { meldungen, hinweise };
}

/** Bezeichnungen der Kennzahlen, die Kontovia vergleicht, mit Schlüssel in vatReturn/elsterWerte. */
export const KENNZAHLEN = [
  ['kz81', '81', 'Umsätze 19 % (Bemessungsgrundlage)', true],
  ['kz86', '86', 'Umsätze 7 % (Bemessungsgrundlage)', true],
  ['kz35', '35', 'Umsätze zu anderen Steuersätzen', true],
  ['kz36', '36', 'Steuer zu anderen Steuersätzen', false],
  ['kz41', '41', 'Innergemeinschaftliche Lieferungen', true],
  ['kz21', '21', 'Nicht steuerbare Leistungen ins EU-Ausland', true],
  ['kz43', '43', 'Steuerfreie Umsätze mit Vorsteuerabzug (Ausfuhr)', true],
  ['kz45', '45', 'Nicht steuerbare Leistungen außerhalb der EU', true],
  ['kz48', '48', 'Steuerfreie Umsätze ohne Vorsteuerabzug', true],
  ['kz60', '60', 'Umsätze, für die der Kunde die Steuer schuldet', true],
  ['kz89', '89', 'Innergemeinschaftliche Erwerbe 19 %', true],
  ['kz93', '93', 'Innergemeinschaftliche Erwerbe 7 %', true],
  ['kz46', '46', 'Leistungen nach § 13b aus der EU (Bemessungsgrundlage)', true],
  ['kz47', '47', 'Steuer nach § 13b (EU)', false],
  ['kz84', '84', 'Andere Leistungen nach § 13b (Bemessungsgrundlage)', true],
  ['kz85', '85', 'Steuer auf andere Leistungen nach § 13b', false],
  ['kz66', '66', 'Vorsteuer aus Rechnungen', false],
  ['kz61', '61', 'Vorsteuer aus innergemeinschaftlichen Erwerben', false],
  ['kz67', '67', 'Vorsteuer aus Leistungen nach § 13b', false],
  ['kz39', '39', 'Sondervorauszahlung', false],
  ['kz83', '83', 'Verbleibende Vorauszahlung (oder Überschuss)', false],
];

/**
 * Stellt eine eingelesene Meldung neben die eigene Rechnung desselben Zeitraums.
 * Bemessungsgrundlagen werden in vollen Euro verglichen, Steuern auf den Cent.
 * @returns {{zeilen: {kz, nr, label, gemeldet, berechnet, abweichung}[], stimmt: boolean}}
 */
export function meldungVergleichen(db, meldung) {
  const v = vatReturn(db, meldung.von, meldung.bis);
  const w = elsterWerte(v);
  const zeilen = [];
  for (const [kz, nr, label, basis] of KENNZAHLEN) {
    const gemeldet = meldung.werte?.[kz] || 0;
    const berechnet = basis ? (w[kz] || 0) * 100 : (w[kz] || 0);
    const vergleich = basis ? Math.trunc(gemeldet / 100) * 100 : gemeldet;
    if (!gemeldet && !berechnet) continue;
    zeilen.push({ kz, nr, label, gemeldet, berechnet, abweichung: vergleich - berechnet });
  }
  return { zeilen, stimmt: zeilen.every((z) => z.abweichung === 0), kleinunternehmer: !!v.kleinunternehmer };
}
