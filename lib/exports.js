/**
 * Kontovia – Ausgabeformate für Finanzamt, Steuerberatung und Archiv.
 *
 * Wichtige Randbedingung: Kontovia übermittelt nichts an ELSTER. Eine
 * Übertragung über die amtliche ERiC-Schnittstelle setzt eine zertifizierte
 * Bibliothek und ein Registrierungszertifikat voraus. Was hier entsteht, sind
 * exakt aufbereitete Werte, die man in „Mein ELSTER“ nur noch abschreibt,
 * sowie Dateien, die eine Steuerkanzlei direkt einlesen kann.
 */

import { esc, money, fmtDate, todayISO } from './util.js';
import {
  euerReport, vatReturn, openItems,
  isKleinunternehmer, basisOf, depreciationInRange, bookValue, effectiveDate, vatTreatment, depositInfo, afaMethod, AFA_METHODE,
  listedOnly, isUnlisted, isEffective,
} from './calc.js';
import { periodLabel } from './period.js';

/*
 * Alles, was für Finanzamt, Steuerkanzlei oder Betriebsprüfung gedacht ist,
 * arbeitet auf dem Bestand ohne nicht gelistete Buchungen. Gefiltert wird
 * hier in jeder dieser Funktionen selbst und nicht erst in der Ansicht – so
 * kann kein Aufrufer eine nicht gelistete Buchung versehentlich mitgeben.
 * Ausgenommen sind nur der vollständige JSON-Export und die frei gewählte
 * Buchungstabelle (transactionsCsv), deren Zeilen der Aufrufer bestimmt.
 */

/** Herkunftsvermerk für Begleittexte – freiwillig, siehe COMPLIANCE.md Abschnitt 7. */
export function originNote(version = '') {
  return `Erstellt mit Kontovia${version ? ' ' + version : ''} am ${fmtDate(todayISO())}, berechnet aus den
erfassten Buchungen nach festen Rechenregeln. An der Berechnung wirkt keine
künstliche Intelligenz mit; gleiche Buchungen ergeben immer dieselben Werte.
Die Werte sind eine Arbeitshilfe: Prüfen Sie sie, bevor Sie sie übernehmen.`;
}

/* -------------------------------------------------------------------------- */
/* CSV-Grundlagen                                                              */
/* -------------------------------------------------------------------------- */

const SEP = ';';

/**
 * Tabellenkalkulationen deuten eine Zelle, die mit =, +, @ oder einem
 * Steuerzeichen beginnt, als Formel. Ein Buchungstext wie `=HYPERLINK(…)`
 * würde in Excel beim Öffnen ausgeführt – und zwar dort, wo die Datei ankommt:
 * in der Steuerkanzlei oder beim Finanzamt. Solche Zellen bekommen deshalb ein
 * vorangestelltes Apostroph; Excel zeigt dann den Text und rechnet nicht.
 *
 * Ausgenommen bleibt das Minuszeichen vor einer reinen Zahl: „-1.234,56“ ist
 * ein negativer Betrag und muss ein Zahlenwert bleiben.
 */
function neutralize(s) {
  if (/^[=+@\t\r]/.test(s)) return "'" + s;
  if (s.startsWith('-') && !/^-[\d.,]*$/.test(s)) return "'" + s;
  return s;
}

function cell(v) {
  const s = neutralize(v === null || v === undefined ? '' : String(v));
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Deutsche Zahlendarstellung mit Komma – so erwartet es Excel im DE-Gebietsschema. */
function num(cents, decimals = 2) {
  return ((Number(cents) || 0) / 100).toFixed(decimals).replace('.', ',');
}

/** Steuersatz mit Dezimalkomma (19,00) – ein Punkt wäre im Prüfprogramm ein Tausendertrenner. */
function rate(v) {
  return (Number(v) || 0).toFixed(2).replace('.', ',');
}

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(SEP)];
  for (const r of rows) lines.push(r.map(cell).join(SEP));
  // BOM, damit Excel die Umlaute richtig erkennt.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** „storniert“, „Gegenbuchung“ oder leer – in allen Listen gleich benannt. */
function stornoText(t) {
  return t.voided ? 'storniert' : t.isReversal ? 'Gegenbuchung' : '';
}

/* -------------------------------------------------------------------------- */
/* Buchungen                                                                   */
/* -------------------------------------------------------------------------- */

export function transactionsCsv(db, rows) {
  const klein = isKleinunternehmer(db);
  const cat = (id) => db.categories.find((c) => c.id === id);
  const headers = [
    'Datum', 'Zahlungsdatum', 'Faelligkeit', 'Art', 'Beschreibung', 'Kategorie',
    'EUER-Zeile', 'Konto SKR03', 'Konto SKR04', 'Kontakt', 'Zahlungskonto',
    'Beleg-Nr', 'Referenz', 'Netto', 'USt-Satz', 'USt-Betrag', 'Brutto',
    'USt-Behandlung', 'Bezahlt', 'Belege', 'Storno', 'Ort',
    'Anzahlung in %', 'Veranstaltung', 'Gesamtbetrag', 'Restbetrag', 'Notiz',
  ];
  const data = rows.map((t) => {
    const c = cat(t.categoryId);
    const dep = depositInfo(t);
    return [
      fmtDate(t.date), t.paidDate ? fmtDate(t.paidDate) : '', t.dueDate ? fmtDate(t.dueDate) : '',
      t.type === 'income' ? 'Einnahme' : 'Ausgabe',
      t.description, c?.name || '', c?.euerLine ?? '', c?.skr03 || '', c?.skr04 || '',
      db.contacts.find((x) => x.id === t.contactId)?.name || '',
      db.accounts.find((x) => x.id === t.accountId)?.name || '',
      t.invoiceNumber || '', t.reference || '',
      num(klein ? t.gross : t.net), klein ? '' : String(t.vatRate || 0), num(klein ? 0 : t.vat), num(t.gross),
      vatTreatment(db, t), t.paidDate ? 'ja' : 'nein',
      (t.attachments || []).map((id) => db.attachments.find((a) => a.id === id)?.fileName).filter(Boolean).join(' | '),
      stornoText(t) || 'nein', t.location || '',
      dep?.percent ? String(dep.percent).replace('.', ',') : '',
      dep?.eventDate ? fmtDate(dep.eventDate) : '',
      dep?.total ? num(dep.total) : '', dep?.total ? num(dep.remaining) : '',
      (t.notes || '').replace(/\s+/g, ' '),
    ];
  });
  return toCsv(headers, data);
}

export function euerCsv(db, period) {
  db = listedOnly(db);
  const e = euerReport(db, period.from, period.to);
  const F = e.form;
  const row = (r) => [r.line, r.label, num(r.amount), r.nonDeductible ? num(r.nonDeductible) : ''];
  const rows = [
    ['', `BETRIEBSEINNAHMEN (nach Zahlungsfluss, Vordruck ${F.jahr})`, '', ''],
    ...e.income.map(row),
    [F.summeEinnahmen, 'Summe Betriebseinnahmen', num(e.incomeTotal), ''],
    ['', '', '', ''],
    ['', 'BETRIEBSAUSGABEN', '', ''],
    ...e.expense.map(row),
    [F.summeAusgaben, 'Summe Betriebsausgaben', num(e.expenseTotal), ''],
    ['', '', '', ''],
    [F.gewinn, `${e.profit >= 0 ? 'Gewinn' : 'Verlust'} (ohne Korrekturen der Zeilen ${F.summeAusgaben + 3} bis ${F.gewinn - 1})`, num(e.profit), ''],
  ];
  if (!e.kleinunternehmer && e.reconciliation.vatFlow) {
    rows.push(
      ['', '', '', ''],
      ['', 'UEBERLEITUNG ZUR NETTOBETRACHTUNG (nachrichtlich)', '', ''],
      ['', 'Ergebnis ohne Umsatzsteuer', num(e.reconciliation.netResult), ''],
      [F.ustVereinnahmt, 'zuzueglich vereinnahmte Umsatzsteuer', num(e.reconciliation.vatCollected), ''],
      [F.vorsteuer, 'abzueglich gezahlte Vorsteuer', num(-e.reconciliation.vatDeducted), ''],
      [F.ustGezahlt, 'abzueglich an das Finanzamt gezahlte Umsatzsteuer', num(-e.reconciliation.vatRemitted), ''],
    );
  }
  return toCsv(['EUER-Zeile', 'Bezeichnung', 'Betrag in EUR', 'davon nicht abziehbar (linke Spalte)'], rows);
}

export function ustvaCsv(db, period) {
  db = listedOnly(db);
  const v = vatReturn(db, period.from, period.to);
  if (v.kleinunternehmer) {
    return toCsv(['Hinweis'], [['Kleinunternehmer nach § 19 UStG – keine Umsatzsteuer-Voranmeldung erforderlich.']]);
  }
  const rows = [
    ['81', 'Umsaetze zum Steuersatz 19 % (Bemessungsgrundlage)', num(v.kz81net)],
    ['', 'darauf entfallende Umsatzsteuer', num(v.kz81tax)],
    ['86', 'Umsaetze zum Steuersatz 7 % (Bemessungsgrundlage)', num(v.kz86net)],
    ['', 'darauf entfallende Umsatzsteuer', num(v.kz86tax)],
    ['35', 'Umsaetze zu anderen Steuersaetzen (Bemessungsgrundlage)', num(v.kz35net)],
    ['36', 'Steuer zu anderen Steuersaetzen', num(v.kz36tax)],
    ['41', 'Innergemeinschaftliche Lieferungen', num(v.kz41)],
    ['21', 'Nicht steuerbare sonstige Leistungen (§ 18b S. 1 Nr. 2 UStG)', num(v.kz21)],
    ['48', 'Steuerfreie Umsaetze ohne Vorsteuerabzug', num(v.kz48)],
    ['89', 'Innergemeinschaftliche Erwerbe 19 %', num(v.kz89net)],
    ['93', 'Innergemeinschaftliche Erwerbe 7 %', num(v.kz93net)],
    ['46', 'Leistungen nach § 13b (Bemessungsgrundlage)', num(v.kz46net)],
    ['47', 'Steuer nach § 13b', num(v.kz47tax)],
    ['66', 'Vorsteuer aus Rechnungen anderer Unternehmer', num(v.kz66)],
    ['61', 'Vorsteuer aus innergemeinschaftlichen Erwerben', num(v.kz61)],
    ['67', 'Vorsteuer aus Leistungen nach § 13b', num(v.kz67)],
    ['', 'Umsatzsteuer gesamt', num(v.umsatzsteuer)],
    ['', 'Vorsteuer gesamt', num(v.vorsteuer)],
    ['83', v.kz83 >= 0 ? 'Verbleibende Umsatzsteuer-Vorauszahlung' : 'Verbleibender Ueberschuss', num(v.kz83)],
  ];
  return toCsv(['Kennzahl', 'Bezeichnung', 'Betrag in EUR'], rows);
}

export function assetsCsv(db, period) {
  const rows = (db.assets || []).map((a) => [
    a.name, fmtDate(a.purchaseDate), num(a.cost), afaMethod(a) === 'sofort' ? 1 : a.usefulLifeYears, AFA_METHODE[afaMethod(a)],
    num(depreciationInRange(a, period.from, period.to)),
    num(bookValue(a, period.to)),
  ]);
  return toCsv(['Wirtschaftsgut', 'Anschaffung', 'Anschaffungskosten', 'Nutzungsdauer (Jahre)', 'Methode', 'AfA im Zeitraum', 'Restbuchwert'], rows);
}

export function contactsCsv(db) {
  return toCsv(
    ['Name', 'Art', 'E-Mail', 'Telefon', 'Anschrift', 'Steuernummer/USt-IdNr', 'Notiz'],
    db.contacts.map((c) => [c.name, c.kind, c.email || '', c.phone || '', (c.address || '').replace(/\s+/g, ' '), c.taxId || '', c.notes || '']),
  );
}

export function openItemsCsv(db, asOf = todayISO()) {
  const o = openItems(listedOnly(db), asOf);
  const map = (t, kind) => [
    kind, fmtDate(t.date), t.invoiceNumber || '', t.description,
    db.contacts.find((c) => c.id === t.contactId)?.name || '',
    fmtDate(t.dueDate), t.overdue ? t.overdueDays : 0, num(t.gross),
  ];
  return toCsv(
    ['Art', 'Datum', 'Beleg-Nr', 'Beschreibung', 'Kontakt', 'Faellig', 'Tage ueberfaellig', 'Betrag'],
    [...o.receivables.map((t) => map(t, 'Forderung')), ...o.payables.map((t) => map(t, 'Verbindlichkeit'))],
  );
}

/* -------------------------------------------------------------------------- */
/* DATEV-Buchungsstapel (EXTF, Format 700)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Berater- und Mandantennummer, wie DATEV sie annimmt: Berater 1001 bis
 * 9999999, Mandant 1 bis 99999. Mit anderen Nummern weist DATEV den Stapel ab.
 */
export function datevNumbersValid(berater, mandant) {
  const b = Number(berater);
  const m = Number(mandant);
  return /^\d+$/.test(String(berater)) && /^\d+$/.test(String(mandant))
    && b >= 1001 && b <= 9999999 && m >= 1 && m <= 99999;
}

/**
 * Sachkonten mit Umsatzsteuer-Automatik (DATEV-Kennung AM/AV) unter den
 * Startkategorien. Auf ihnen rechnet DATEV die Steuer selbst heraus; ein
 * zusätzlicher Steuerschlüssel wäre dort ein Fehler.
 */
const AUTOMATIK = {
  skr03: new Set(['8400', '8300', '8125', '8336', '8820', '8921', '3400', '3300']),
  skr04: new Set(['4400', '4300', '4125', '4336', '4845', '4645', '5400', '5300']),
};

/** Sammelkonten für die Rechnung nach Soll: ein Debitor, ein Kreditor. */
const SAMMEL = { debitor: '10000', kreditor: '70000' };

/**
 * Belegfeld 1 dient DATEV als Schlüssel für offene Posten und nimmt nur
 * Buchstaben, Ziffern und $ & % * + - / an (höchstens 36 Zeichen).
 */
function belegfeld(s) {
  return String(s ?? '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9$&%*+\-/]/g, '')
    .slice(0, 36);
}

/**
 * Die Kalenderjahre, die ein Zeitraum berührt. Ein DATEV-Stapel darf kein
 * Wirtschaftsjahr überschreiten – das Belegdatum steht dort nur als TTMM, das
 * Jahr ergibt sich aus dem Stapel.
 */
export function datevYears(period) {
  const a = Number(period.from.slice(0, 4));
  const b = Number(period.to.slice(0, 4));
  const out = [];
  for (let y = a; y <= b && out.length < 50; y++) {
    out.push({ ...period, from: y === a ? period.from : `${y}-01-01`, to: y === b ? period.to : `${y}-12-31` });
  }
  return out;
}

/**
 * Buchungszeilen des Stapels, noch ohne Kopf.
 *
 * Nach Zahlungsfluss (Ist-Versteuerung, Kleinunternehmer, EÜR): Gebucht wird
 * nur, was im Zeitraum bezahlt wurde, zum Zahlungsdatum gegen das Geldkonto.
 * Offene Rechnungen gehören dort nicht hinein – sonst stünde im Bankkonto der
 * Kanzlei Geld, das nie eingegangen ist.
 *
 * Nach Rechnungsdatum (Soll-Versteuerung): Die Rechnung läuft zum
 * Rechnungsdatum über einen Sammeldebitor bzw. -kreditor, die Zahlung zum
 * Zahlungsdatum von dort auf das Geldkonto. So entstehen in DATEV die offenen
 * Posten und die Umsatzsteuer nach vereinbarten Entgelten.
 */
function datevLines(db, period, opts) {
  const skr = db.settings.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03';
  const klein = isKleinunternehmer(db);
  const soll = basisOf(db) === 'soll' && !klein;
  const bu = !!opts.steuerschluessel && !klein;
  const ddmm = (iso) => String(iso).slice(8, 10) + String(iso).slice(5, 7);
  const inPeriod = (d) => !!d && d >= period.from && d <= period.to;
  const out = [];

  const zeile = (datum, betrag, konto, gegenkonto, schluessel, t) => {
    if (!betrag) return;
    out.push({
      datum,
      text: [
        num(Math.abs(betrag)), betrag < 0 ? '"H"' : '"S"', '"EUR"', '', '', '',
        konto, gegenkonto, schluessel ? `"${schluessel}"` : '',
        ddmm(datum),
        `"${belegfeld(t.invoiceNumber)}"`, '', '',
        `"${clean(t.description || '', 60)}"`,
        '', '', '', '', '', '',
      ].join(SEP),
    });
  };

  for (const t of db.transactions) {
    if (!isEffective(t) || !t.gross) continue;
    const cat = db.categories.find((c) => c.id === t.categoryId);
    const acc = db.accounts.find((a) => a.id === t.accountId);
    const sachkonto = cat?.[skr] || (t.type === 'income' ? (skr === 'skr03' ? '8400' : '4400') : (skr === 'skr03' ? '4900' : '6300'));
    const geldkonto = acc?.[skr] || (skr === 'skr03' ? '1200' : '1800');
    const income = t.type === 'income';

    // Steuerschlüssel nur auf Konten ohne Automatik und nur für gewöhnliche
    // Umsätze; innergemeinschaftliche Fälle und § 13b bleiben der Kanzlei.
    let schluessel = '';
    if (bu && !cat?.private && !cat?.vatNeutral && vatTreatment(db, t) === 'standard' && !AUTOMATIK[skr].has(String(sachkonto))) {
      const r = Number(t.vatRate) || 0;
      schluessel = income ? ({ 19: '3', 7: '2' })[r] || '' : ({ 19: '9', 7: '8' })[r] || '';
    }

    if (!soll) {
      if (!inPeriod(t.paidDate)) continue;
      if (income) zeile(t.paidDate, t.gross, geldkonto, sachkonto, schluessel, t);
      else zeile(t.paidDate, t.gross, sachkonto, geldkonto, schluessel, t);
      continue;
    }

    // Privatentnahmen und Zahlungen an das Finanzamt haben keine Rechnung.
    const direkt = !!cat?.private || !!cat?.vatNeutral;
    if (direkt) {
      if (!inPeriod(t.paidDate)) continue;
      if (income) zeile(t.paidDate, t.gross, geldkonto, sachkonto, '', t);
      else zeile(t.paidDate, t.gross, sachkonto, geldkonto, '', t);
      continue;
    }
    const person = income ? (db.settings.datevDebitor || SAMMEL.debitor) : (db.settings.datevKreditor || SAMMEL.kreditor);
    if (inPeriod(t.date)) {
      if (income) zeile(t.date, t.gross, person, sachkonto, schluessel, t);
      else zeile(t.date, t.gross, sachkonto, person, schluessel, t);
    }
    if (inPeriod(t.paidDate)) {
      if (income) zeile(t.paidDate, t.gross, geldkonto, person, '', t);
      else zeile(t.paidDate, t.gross, person, geldkonto, '', t);
    }
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum)).map((l) => l.text);
}

/**
 * Erzeugt einen Buchungsstapel, wie ihn Steuerkanzleien in DATEV einlesen.
 * Kodierung ist ISO-8859-1 – für deutsche Umlaute deckungsgleich mit der
 * von DATEV erwarteten Windows-1252-Kodierung.
 *
 * Der Zeitraum muss in einem Kalenderjahr liegen; für längere Zeiträume
 * liefert datevFiles() je Jahr einen Stapel.
 *
 * @param {{beraterNr?:string, mandantNr?:string, steuerschluessel?:boolean}} opts
 */
export function datevBuchungsstapel(db, period, opts = {}) {
  if (period.from.slice(0, 4) !== period.to.slice(0, 4)) {
    throw new Error('Ein DATEV-Stapel darf nur ein Wirtschaftsjahr umfassen.');
  }
  db = listedOnly(db);
  const s = db.settings;
  const berater = String(opts.beraterNr || s.datevBerater || '1001');
  const mandant = String(opts.mandantNr || s.datevMandant || '1');
  const ymd = (iso) => String(iso).replace(/-/g, '');
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}000`;
  const wjBeginn = `${period.from.slice(0, 4)}0101`;
  // Feld 27 „Sachkontenrahmen“ ist zweistellig: 03 oder 04.
  const rahmen = s.chartOfAccounts === 'SKR04' ? '04' : '03';

  const header = [
    '"EXTF"', '700', '21', '"Buchungsstapel"', '13', stamp, '', '"KO"',
    `"${clean(s.companyName || 'Kontovia', 25)}"`, '', berater, mandant, wjBeginn, '4',
    ymd(period.from), ymd(period.to), `"${clean('Kontovia ' + periodLabel(period), 30)}"`, '""',
    '1', '', '0', '"EUR"', '', '', '', '', `"${rahmen}"`, '', '', '', '""',
  ].join(SEP);

  const columns = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs',
    'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext',
    'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt',
    'Zinssperre', 'Beleglink',
  ].map(cell).join(SEP);

  return [header, columns, ...datevLines(db, period, opts)].join('\r\n') + '\r\n';
}

/** Je berührtem Kalenderjahr ein Stapel, benannt wie DATEV-Dateien üblich. */
export function datevFiles(db, period, opts = {}) {
  return datevYears(period).map((p) => ({
    name: `EXTF_Buchungsstapel_${p.from.replace(/-/g, '')}_${p.to.replace(/-/g, '')}.csv`,
    text: datevBuchungsstapel(db, p, opts),
    encoding: 'latin1',
  }));
}

/** Entfernt für DATEV problematische Zeichen und kürzt auf die Feldlänge. */
function clean(s, max) {
  const t = String(s ?? '').replace(/["\r\n;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  // Auch der DATEV-Stapel wird unterwegs regelmäßig in Excel geöffnet.
  return neutralize(t);
}

/* -------------------------------------------------------------------------- */
/* GoBD-/GDPdU-Datenträgerüberlassung (Format Z3)                              */
/* -------------------------------------------------------------------------- */

/*
 * Aufbau nach dem „Beschreibungsstandard für die Datenträgerüberlassung“
 * (GDPdU/GoBD, Version 1.1 vom 01.08.2002): Jede Tabelle ist eine Datei, die
 * index.xml beschreibt Kodierung, Trennzeichen und jede einzelne Spalte samt
 * Datentyp. Ohne Spaltenbeschreibung lehnt das Prüfprogramm der
 * Finanzverwaltung den Import ab. Die DTD muss im selben Ordner liegen.
 */

/** Spaltentypen der index.xml: a = Text, n = Zahl (mit Nachkommastellen), d = Datum TT.MM.JJJJ. */
const A = (name, desc) => ({ name, desc, type: 'a' });
const N = (name, desc, acc = 2) => ({ name, desc, type: 'n', acc });
const D = (name, desc) => ({ name, desc, type: 'd' });

const Z3 = {
  buchungen: {
    file: 'buchungen.csv', name: 'Buchungen', desc: 'Alle Geschäftsvorfälle des Zeitraums', key: 1,
    cols: [A('ID', 'Kennung der Buchung'), D('Belegdatum'), D('Zahlungsdatum'), A('Belegnummer'), A('Buchungstext'),
      A('Kategorie'), A('Konto', 'Sachkonto der Kategorie im gewählten Kontenrahmen'), A('Gegenkonto', 'Geldkonto'),
      N('Netto'), N('Steuersatz', 'in Prozent'), N('Steuer'), N('Brutto'), A('SollHaben', 'S = Ausgabe, H = Einnahme'),
      A('Storno', 'J = storniert, G = Gegenbuchung zu einem Storno, N = nein'), A('Storno_zu', 'ID der stornierten Buchung'),
      A('Erfasst_am', 'Zeitpunkt der Erfassung (ISO 8601, UTC)'), A('Geaendert_am', 'Zeitpunkt der letzten Änderung (ISO 8601, UTC)')],
  },
  konten: {
    file: 'konten.csv', name: 'Konten', desc: 'Zahlungskonten mit Anfangsbeständen', key: 1,
    cols: [A('ID'), A('Name'), A('Art'), A('SKR03'), A('SKR04'), N('Anfangsbestand'), D('Stichtag')],
  },
  kategorien: {
    file: 'kategorien.csv', name: 'Kategorien', desc: 'Kontenzuordnung und EÜR-Zeilen', key: 1,
    cols: [A('ID'), A('Name'), A('Art'), A('EUER_Zeile', 'Zeile der Anlage EÜR 2025'), A('SKR03'), A('SKR04'), N('Steuersatz', 'in Prozent')],
  },
  kontakte: {
    file: 'kontakte.csv', name: 'Geschaeftspartner', desc: 'Kunden und Lieferanten', key: 1,
    cols: [A('ID'), A('Name'), A('Art'), A('E_Mail'), A('Telefon'), A('Anschrift'), A('Steuernummer_USt_IdNr'), A('Notiz')],
  },
  journal: {
    file: 'aenderungsjournal.csv', name: 'Aenderungsjournal', desc: 'Protokoll aller Änderungen mit Prüfsummenkette je Gerät', key: 2,
    cols: [A('Geraet', 'Kennung des Geräts; jedes Gerät führt eine eigene Kette'), N('Nr', 'laufende Nummer je Gerät', 0),
      A('Zeitpunkt', 'ISO 8601, UTC'), A('Vorgang'), A('Objekt'), A('Objekt_ID'), A('Beschreibung'),
      A('Vorgaenger', 'Prüfsumme des vorigen Eintrags desselben Geräts'), A('Pruefsumme', 'SHA-256, hexadezimal')],
  },
  belege: {
    file: 'belegverzeichnis.csv', name: 'Belege', desc: 'Verzeichnis der hinterlegten Belege mit Prüfsummen', key: 1,
    cols: [A('ID'), A('Dateiname'), N('Groesse', 'in Byte', 0), A('SHA_256'), A('Erfasst_am'), A('Zugeordnete_Buchung')],
  },
};

/** Kopfzeile einer Z3-Tabelle – dieselben Namen wie in der index.xml. */
const kopf = (t) => t.cols.map((c) => c.name);

/**
 * Liefert die Dateien, die bei einer Betriebsprüfung als „Datenträgerüberlassung“
 * erwartet werden: beschreibende index.xml samt DTD plus die zugehörigen CSV-Dateien.
 */
export function gobdExport(db, period) {
  // Belege nicht gelisteter Buchungen gehören ebenso wenig hinein wie die Buchungen.
  const hidden = new Set((db.transactions || []).filter(isUnlisted).flatMap((t) => t.attachments || []));
  db = listedOnly(db);
  const basis = basisOf(db);
  const skr = db.settings.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03';
  const rows = db.transactions
    .filter((t) => {
      const d = effectiveDate(t, basis) || t.date;
      return d >= period.from && d <= period.to;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const buchungen = toCsv(kopf(Z3.buchungen), rows.map((t) => {
    const cat = db.categories.find((c) => c.id === t.categoryId);
    const acc = db.accounts.find((a) => a.id === t.accountId);
    return [
      t.id, fmtDate(t.date), t.paidDate ? fmtDate(t.paidDate) : '', t.invoiceNumber || '',
      t.description, cat?.name || '', cat?.[skr] || '', acc?.[skr] || '',
      num(t.net), rate(t.vatRate), num(t.vat), num(t.gross),
      t.type === 'income' ? 'H' : 'S', t.voided ? 'J' : t.isReversal ? 'G' : 'N', t.reversalOf || '',
      t.createdAt || '', t.updatedAt || '',
    ];
  }));

  const konten = toCsv(kopf(Z3.konten),
    db.accounts.map((a) => [a.id, a.name, a.kind, a.skr03 || '', a.skr04 || '', num(a.openingBalance), a.openingDate ? fmtDate(a.openingDate) : '']));

  const kategorien = toCsv(kopf(Z3.kategorien),
    db.categories.map((c) => [c.id, c.name, c.kind, c.euerLine ?? '', c.skr03 || '', c.skr04 || '', rate(c.vatRate)]));

  const kontakte = toCsv(kopf(Z3.kontakte),
    db.contacts.map((c) => [c.id, c.name, c.kind, c.email || '', c.phone || '', (c.address || '').replace(/\s+/g, ' '), c.taxId || '', c.notes || '']));

  // Alle Felder, die in die Prüfsumme eingehen – sonst ließe sich die Kette
  // aus dem Export heraus nicht nachrechnen.
  const journal = toCsv(kopf(Z3.journal),
    (db.auditLog || []).map((e) => [e.device ?? '', e.seq, e.ts, e.action, e.entity, e.entityId, e.summary, e.prev || '', e.hash]));

  const belege = toCsv(kopf(Z3.belege),
    (db.attachments || []).filter((a) => !hidden.has(a.id)).map((a) => {
      const tx = db.transactions.find((t) => (t.attachments || []).includes(a.id));
      return [a.id, a.fileName, a.size, a.sha256, a.createdAt, tx?.id || ''];
    }));

  const tabellen = [Z3.buchungen, Z3.konten, Z3.kategorien, Z3.kontakte, Z3.journal, Z3.belege];
  return [
    { name: 'index.xml', text: indexXml(db, period, tabellen) },
    { name: GDPDU_DTD_NAME, text: GDPDU_DTD },
    { name: Z3.buchungen.file, text: buchungen },
    { name: Z3.konten.file, text: konten },
    { name: Z3.kategorien.file, text: kategorien },
    { name: Z3.kontakte.file, text: kontakte },
    { name: Z3.journal.file, text: journal },
    { name: Z3.belege.file, text: belege },
    { name: 'LIESMICH.txt', text: gobdReadme(db, period) },
  ];
}

function indexXml(db, period, tables) {
  const s = db.settings;
  const x = (v) => esc(String(v ?? ''));
  const typ = (c) => (c.type === 'n' ? `<Numeric><Accuracy>${c.acc}</Accuracy></Numeric>`
    : c.type === 'd' ? '<Date><Format>DD.MM.YYYY</Format></Date>' : '<AlphaNumeric/>');
  const spalte = (c, tag) => `        <${tag}>
          <Name>${x(c.name)}</Name>${c.desc ? `\n          <Description>${x(c.desc)}</Description>` : ''}
          ${typ(c)}
        </${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DataSet SYSTEM "${GDPDU_DTD_NAME}">
<DataSet>
  <Version>1.0</Version>
  <DataSupplier>
    <Name>${x(s.companyName || s.ownerName || 'Unbekannt')}</Name>
    <Location>${x([s.street, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</Location>
    <Comment>Export aus Kontovia, Zeitraum ${x(fmtDate(period.from))} bis ${x(fmtDate(period.to))}${s.taxNumber ? `, Steuernummer ${x(s.taxNumber)}` : ''}</Comment>
  </DataSupplier>
  <Media>
    <Name>Datenträgerüberlassung ${x(period.from.slice(0, 4))}</Name>
${tables.map((t) => `    <Table>
      <URL>${x(t.file)}</URL>
      <Name>${x(t.name)}</Name>
      <Description>${x(t.desc)}</Description>
      <Validity><Range><From>${x(fmtDate(period.from))}</From><To>${x(fmtDate(period.to))}</To></Range><Format>DD.MM.YYYY</Format></Validity>
      <UTF8/>
      <DecimalSymbol>,</DecimalSymbol>
      <DigitGroupingSymbol>.</DigitGroupingSymbol>
      <Range><From>2</From></Range>
      <VariableLength>
        <ColumnDelimiter>;</ColumnDelimiter>
        <RecordDelimiter>&#13;&#10;</RecordDelimiter>
        <TextEncapsulator>"</TextEncapsulator>
${t.cols.map((c, i) => spalte(c, i < t.key ? 'VariablePrimaryKey' : 'VariableColumn')).join('\n')}
      </VariableLength>
    </Table>`).join('\n')}
  </Media>
</DataSet>
`;
}

export const GDPDU_DTD_NAME = 'gdpdu-01-08-2002.dtd';

/**
 * Die Elementdeklarationen des Beschreibungsstandards, Version 1.1 vom
 * 01.08.2002 – ohne die erläuternden Kommentare des Originals. Das
 * Prüfprogramm erwartet die DTD neben der index.xml.
 */
const GDPDU_DTD = `<?xml version="1.0" encoding="UTF-8"?>
<!-- GDPdU-Beschreibungsstandard, Version 1.1 (01.08.2002) -->
<!ELEMENT Version (#PCDATA)>
<!ELEMENT Location (#PCDATA)>
<!ELEMENT Comment (#PCDATA)>
<!ELEMENT Length (#PCDATA)>
<!ELEMENT References (#PCDATA)>
<!ELEMENT From (#PCDATA)>
<!ELEMENT To (#PCDATA)>
<!ELEMENT MaxLength (#PCDATA)>
<!ELEMENT TextEncapsulator (#PCDATA)>
<!ELEMENT Accuracy (#PCDATA)>
<!ELEMENT ImpliedAccuracy (#PCDATA)>
<!ELEMENT Format (#PCDATA)>
<!ELEMENT DecimalSymbol (#PCDATA)>
<!ELEMENT DigitGroupingSymbol (#PCDATA)>
<!ELEMENT Command (#PCDATA)>
<!ELEMENT URL (#PCDATA)>
<!ELEMENT Description (#PCDATA)>
<!ELEMENT Name (#PCDATA)>
<!ELEMENT Epoch (#PCDATA)>
<!ELEMENT ColumnDelimiter (#PCDATA)>
<!ELEMENT RecordDelimiter (#PCDATA)>
<!ELEMENT SkipNumBytes (#PCDATA)>
<!ELEMENT Range (From, (To | Length)?)>
<!ELEMENT FixedRange (From, (To | Length))>
<!ELEMENT DataSet (Version, DataSupplier?, Command*, Media+, Command*)>
<!ELEMENT AlphaNumeric EMPTY>
<!ELEMENT Date (Format?)>
<!ELEMENT Numeric ((ImpliedAccuracy | Accuracy)?)>
<!ELEMENT ANSI EMPTY>
<!ELEMENT Macintosh EMPTY>
<!ELEMENT OEM EMPTY>
<!ELEMENT UTF16 EMPTY>
<!ELEMENT UTF7 EMPTY>
<!ELEMENT UTF8 EMPTY>
<!ELEMENT FixedLength ((Length | RecordDelimiter)?, ((FixedPrimaryKey+, FixedColumn*) | (FixedColumn+)), ForeignKey*)>
<!ELEMENT FixedColumn (Name, Description?, (Numeric | AlphaNumeric | Date), Map*, FixedRange)>
<!ELEMENT FixedPrimaryKey (Name, Description?, (Numeric | AlphaNumeric | Date), Map*, FixedRange)>
<!ELEMENT VariableLength (ColumnDelimiter?, RecordDelimiter?, TextEncapsulator?, ((VariablePrimaryKey+, VariableColumn*) | (VariableColumn+)), ForeignKey*)>
<!ELEMENT VariableColumn (Name, Description?, (Numeric | (AlphaNumeric, MaxLength?) | Date), Map*)>
<!ELEMENT VariablePrimaryKey (Name, Description?, (Numeric | (AlphaNumeric, MaxLength?) | Date), Map*)>
<!ELEMENT DataSupplier (Name, Location, Comment)>
<!ELEMENT Media (Name, Command*, Table+, Command*)>
<!ELEMENT Table (URL, Name?, Description?, Validity?, (ANSI | Macintosh | OEM | UTF16 | UTF7 | UTF8)?, (DecimalSymbol, DigitGroupingSymbol)?, SkipNumBytes?, Range?, Epoch?, (VariableLength | FixedLength))>
<!ELEMENT ForeignKey (Name+, References)>
<!ELEMENT Map (Description?, From, To)>
<!ELEMENT Validity (Range, Format?)>
`;

function gobdReadme(db, period) {
  return `KONTOVIA – DATENTRÄGERÜBERLASSUNG (GoBD / GDPdU, Format Z3)
=========================================================

Betrieb:    ${db.settings.companyName || db.settings.ownerName || '(ohne Angabe)'}
Steuernr.:  ${db.settings.taxNumber || '(ohne Angabe)'}
Zeitraum:   ${fmtDate(period.from)} bis ${fmtDate(period.to)}
Erstellt:   ${fmtDate(todayISO())}

INHALT
------
index.xml                Beschreibung der Tabellen und Spalten nach dem
                         GDPdU-Beschreibungsstandard (UTF-8, Semikolon,
                         Dezimalkomma, erste Zeile = Spaltennamen)
${GDPDU_DTD_NAME}     zugehörige DTD
buchungen.csv            Alle Geschäftsvorfälle des Zeitraums
konten.csv               Zahlungskonten mit Anfangsbeständen
kategorien.csv           Kategorien mit EÜR-Zeile und SKR-Konto
kontakte.csv             Kunden und Lieferanten
aenderungsjournal.csv    Protokoll aller Änderungen mit verketteten Prüfsummen
belegverzeichnis.csv     Alle hinterlegten Belege mit SHA-256-Prüfsumme

ZUR UNVERÄNDERBARKEIT
---------------------
Jede Änderung am Datenbestand erzeugt einen Eintrag im Änderungsjournal.
Jedes Gerät führt eine eigene Kette. Die Prüfsumme eines Eintrags ist der
SHA-256-Wert (hexadezimal) des JSON-Texts
  {"seq":Nr,"device":Geraet,"ts":Zeitpunkt,"action":Vorgang,
   "entity":Objekt,"entityId":Objekt_ID,"summary":Beschreibung,
   "prev":Vorgaenger}
in genau dieser Reihenfolge, ohne Leerzeichen. "Vorgaenger" ist die Prüfsumme
des vorigen Eintrags desselben Geräts (beim ersten Eintrag "GENESIS"). Ist
"Geraet" leer (Einträge älterer Fassungen), fehlt "device" im JSON-Text. Wird ein
Eintrag nachträglich verändert, passen alle folgenden Prüfsummen nicht mehr.

STORNO
------
Stornierte Buchungen bleiben mit "Storno = J" erhalten. Zu jeder gehört eine
betragsgleiche Gegenbuchung mit umgekehrtem Vorzeichen ("Storno = G",
"Storno_zu" = ID der stornierten Buchung). Beide zusammen ergeben null.

BELEGE
------
Die Belegdateien selbst liegen verschlüsselt im Kontovia-Datenordner. Sie
können über "Export -> Belege exportieren" unverschlüsselt beigelegt werden.
Das Belegverzeichnis enthält für jede Datei eine SHA-256-Prüfsumme, mit der
sich die Unversehrtheit nachweisen lässt.
`;
}

/* -------------------------------------------------------------------------- */
/* Zusammenstellung für das Finanzamt                                          */
/* -------------------------------------------------------------------------- */

/**
 * Alle Zahlenwerke eines Zeitraums als Dateiliste (ohne PDFs).
 * @param {{beraterNr?:string, mandantNr?:string, steuerschluessel?:boolean}} datev
 */
export function taxOfficePack(db, period, version = '', datev = {}) {
  db = listedOnly(db);
  const rows = db.transactions.filter((t) => {
    const d = effectiveDate(t, basisOf(db)) || t.date;
    return d >= period.from && d <= period.to;
  });
  const label = period.from.slice(0, 4) === period.to.slice(0, 4)
    ? period.from.slice(0, 4)
    : `${period.from.slice(0, 4)}-${period.to.slice(0, 4)}`;
  const files = [
    { name: `EUER-Zeilen_${label}.csv`, text: euerCsv(db, period) },
    { name: `Buchungsjournal_${label}.csv`, text: transactionsCsv(db, rows) },
    { name: `Offene-Posten_${label}.csv`, text: openItemsCsv(db, period.to) },
    { name: `Anlagenverzeichnis_${label}.csv`, text: assetsCsv(db, period) },
    ...datevFiles(db, period, datev),
    { name: 'LIESMICH.txt', text: packReadme(db, period, version, datev) },
  ];
  if (!isKleinunternehmer(db)) {
    files.splice(1, 0, { name: `UStVA_${label}.csv`, text: ustvaCsv(db, period) });
  }
  return files;
}

function packReadme(db, period, version = '', datev = {}) {
  const e = euerReport(db, period.from, period.to);
  const F = e.form;
  const v = vatReturn(db, period.from, period.to);
  const klein = isKleinunternehmer(db);
  const soll = basisOf(db) === 'soll' && !klein;
  const nummernFehlen = !datevNumbersValid(datev.beraterNr || db.settings.datevBerater, datev.mandantNr || db.settings.datevMandant);
  return `KONTOVIA – UNTERLAGEN FÜR DAS FINANZAMT
======================================

Betrieb:      ${db.settings.companyName || db.settings.ownerName || '(ohne Angabe)'}
Steuernummer: ${db.settings.taxNumber || '(ohne Angabe)'}
${db.settings.vatId ? 'USt-IdNr.:    ' + db.settings.vatId + '\n' : ''}Finanzamt:    ${db.settings.taxOffice || '(ohne Angabe)'}
Zeitraum:     ${fmtDate(period.from)} bis ${fmtDate(period.to)}
Gewinn:       Einnahmen-Überschuss-Rechnung nach Zahlungsfluss (§ 4 Abs. 3, § 11 EStG)
Umsatzsteuer: ${klein ? 'Kleinunternehmer nach § 19 UStG' : soll ? 'Regelbesteuerung, nach vereinbarten Entgelten (Soll)' : 'Regelbesteuerung, nach vereinnahmten Entgelten (Ist, § 20 UStG)'}

DIE WICHTIGSTEN ZAHLEN
----------------------
Betriebseinnahmen (EÜR Zeile ${F.summeEinnahmen}): ${money(e.incomeTotal)} EUR
Betriebsausgaben  (EÜR Zeile ${F.summeAusgaben}): ${money(e.expenseTotal)} EUR
${e.profit >= 0 ? 'Gewinn ' : 'Verlust'}           (EÜR Zeile ${F.gewinn}): ${money(e.profit)} EUR
${klein ? '' : `
Umsatzsteuer gesamt:              ${money(v.umsatzsteuer)} EUR
Abziehbare Vorsteuer:             ${money(v.vorsteuer)} EUR
Zahllast (Kennzahl 83):           ${money(v.kz83)} EUR
`}
SO GEHT ES WEITER
-----------------
1. Melden Sie sich unter www.elster.de in "Mein ELSTER" an.
2. Formular "Einnahmenüberschussrechnung (Anlage EÜR)" öffnen.
3. Die Werte aus EUER-Zeilen_*.csv in die gleichnamigen Zeilen eintragen.
   Die Zeilennummern folgen dem Vordruck ${F.jahr}. Prüfen Sie sie gegen das
   Formular des Jahres – sie ändern sich fast jährlich. Bei Bewirtungen steht
   der nicht abziehbare Teil in der vierten Spalte (im Formular links).
4. Haben Sie Anlagegüter mit Abschreibung, gehört die Anlage AVEÜR dazu; die
   Werte stehen in Anlagenverzeichnis_*.csv.
${klein ? '' : `5. Für die Umsatzsteuer-Voranmeldung das Formular "Umsatzsteuer-Voranmeldung"
   öffnen und die Kennzahlen aus UStVA_*.csv übertragen.
`}
Wenn Sie eine Steuerkanzlei beauftragen: Übergeben Sie die Datei(en)
EXTF_Buchungsstapel_*.csv (Format EXTF 700, je Wirtschaftsjahr eine Datei).
${soll
    ? `Rechnungen laufen dort zum Rechnungsdatum über den Sammeldebitor
${db.settings.datevDebitor || SAMMEL.debitor} bzw. den Sammelkreditor ${db.settings.datevKreditor || SAMMEL.kreditor}, Zahlungen zum Zahlungsdatum von
dort auf das Geldkonto.`
    : `Gebucht ist, was im Zeitraum bezahlt wurde – zum Zahlungsdatum gegen das
Geldkonto. Offene Rechnungen stehen in Offene-Posten_*.csv.`}
Die Kanzlei sollte die Sachkonten des ${db.settings.chartOfAccounts || 'SKR03'} vor der Verbuchung prüfen.
${datev.steuerschluessel
    ? 'Steuerschlüssel sind nur für Konten ohne Umsatzsteuer-Automatik gesetzt\n(9/8 Vorsteuer 19/7 %, 3/2 Umsatzsteuer 19/7 %).'
    : 'Steuerschlüssel sind bewusst nicht gesetzt; auf Konten ohne Automatik trägt\ndie Kanzlei sie nach.'}
${nummernFehlen ? `
ACHTUNG: Berater- und Mandantennummer fehlen oder sind ungültig. Der Stapel
trägt Platzhalter (1001/1); die Kanzlei muss sie vor dem Einlesen ersetzen
oder Ihnen die richtigen Nummern nennen.
` : ''}
WICHTIG
-------
Kontovia übermittelt nichts an die Finanzverwaltung und ersetzt keine
Steuerberatung. Alle Zuordnungen sind Vorschläge und liegen in Ihrer
Verantwortung. Abgegeben wird nicht dieser Ordner, sondern Ihre
Erklärung in ELSTER – die Werte darin verantworten Sie, gleich mit
welchem Programm sie vorbereitet wurden.

HERKUNFT
--------
${originNote(version)}
`;
}

/* -------------------------------------------------------------------------- */
/* Sicherungskopie im Klartext (JSON)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Für den Fall, dass die Daten je in ein anderes Programm sollen.
 *
 * Ohne den Cloud-Block: Er beschreibt die Verbindungen dieses Geräts
 * (Konto, Kalender, Abgleichstand), nicht die Buchhaltung. Bis Fassung 1.7
 * stand darin das Aktualisierungsmerkmal von Google im Klartext.
 */
export function jsonExport(db) {
  const { cloud: _geraet, ...daten } = db || {};
  return JSON.stringify({
    programm: 'Kontovia',
    version: 1,
    exportiert: new Date().toISOString(),
    hinweis: 'Beträge sind ganzzahlige Cent-Werte.',
    daten,
  }, null, 2);
}
