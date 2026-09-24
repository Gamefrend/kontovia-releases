/**
 * Kontovia – Ausgabeformate für Finanzamt, Steuerberatung und Archiv.
 *
 * Wichtige Randbedingung: Kontovia übermittelt nichts an ELSTER. Eine
 * Übertragung über die amtliche ERiC-Schnittstelle setzt eine zertifizierte
 * Bibliothek und ein Registrierungszertifikat voraus. Was hier entsteht, sind
 * exakt aufbereitete Werte, die man in „Mein ELSTER“ nur noch abschreibt,
 * sowie Dateien, die eine Steuerkanzlei direkt einlesen kann.
 */

import { esc, money, fmtDate, todayISO, sum, int } from './util.js';
import {
  periodReport, euerReport, vatReturn, openItems, accountBalances, balanceSheet,
  isKleinunternehmer, basisOf, depreciationInRange, bookValue, effectiveDate, vatTreatment, depositInfo,
  listedOnly, isUnlisted,
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

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(SEP)];
  for (const r of rows) lines.push(r.map(cell).join(SEP));
  // BOM, damit Excel die Umlaute richtig erkennt.
  return '﻿' + lines.join('\r\n') + '\r\n';
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
    'USt-Behandlung', 'Bezahlt', 'Belege', 'Storniert', 'Ort',
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
      t.voided ? 'ja' : 'nein', t.location || '',
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
  const rows = [
    ['', 'BETRIEBSEINNAHMEN', ''],
    ...e.income.map((r) => [r.line, r.label, num(r.amount)]),
    ['22', 'Summe Betriebseinnahmen', num(e.incomeTotal)],
    ['', '', ''],
    ['', 'BETRIEBSAUSGABEN', ''],
    ...e.expense.map((r) => [r.line, r.label, num(r.amount)]),
    ['71', 'Summe Betriebsausgaben', num(e.expenseTotal)],
    ['', '', ''],
    ['72', e.profit >= 0 ? 'Gewinn' : 'Verlust', num(e.profit)],
  ];
  if (!e.kleinunternehmer && e.reconciliation.vatFlow) {
    rows.push(
      ['', '', ''],
      ['', 'UEBERLEITUNG ZUR NETTOBETRACHTUNG (nachrichtlich)', ''],
      ['', 'Ergebnis ohne Umsatzsteuer', num(e.reconciliation.netResult)],
      ['16', 'zuzueglich vereinnahmte Umsatzsteuer', num(e.reconciliation.vatCollected)],
      ['55', 'abzueglich gezahlte Vorsteuer', num(-e.reconciliation.vatDeducted)],
      ['56', 'abzueglich an das Finanzamt gezahlte Umsatzsteuer', num(-e.reconciliation.vatRemitted)],
    );
  }
  return toCsv(['EUER-Zeile', 'Bezeichnung', 'Betrag in EUR'], rows);
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
    a.name, fmtDate(a.purchaseDate), num(a.cost), a.usefulLifeYears, 'linear',
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
 * Erzeugt einen Buchungsstapel, wie ihn Steuerkanzleien in DATEV einlesen.
 * Kodierung ist ISO-8859-1 – für deutsche Umlaute deckungsgleich mit der
 * von DATEV erwarteten Windows-1252-Kodierung.
 */
export function datevBuchungsstapel(db, period, opts = {}) {
  db = listedOnly(db);
  const s = db.settings;
  const skr = s.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03';
  const berater = String(opts.beraterNr || s.datevBerater || '1');
  const mandant = String(opts.mandantNr || s.datevMandant || '1');
  const ymd = (iso) => String(iso).replace(/-/g, '');
  const ddmm = (iso) => String(iso).slice(8, 10) + String(iso).slice(5, 7);
  const now = new Date();
  const stamp = now.getFullYear()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0') + '000';
  const wjBeginn = `${period.from.slice(0, 4)}0101`;

  const header = [
    '"EXTF"', '700', '21', '"Buchungsstapel"', '13', stamp, '', '"KO"',
    `"${clean(s.companyName || 'Kontovia', 25)}"`, '', berater, mandant, wjBeginn, '4',
    ymd(period.from), ymd(period.to), `"${clean('Kontovia ' + periodLabel(period), 30)}"`, '""',
    '1', '', '0', '"EUR"', '', '', '', '', `"${s.chartOfAccounts || 'SKR03'}"`, '', '', '', '""',
  ].join(SEP);

  const columns = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs',
    'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext',
    'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt',
    'Zinssperre', 'Beleglink',
  ].map(cell).join(SEP);

  const lines = [];
  // DATEV erwartet das Belegdatum – nicht das Zahlungsdatum. Offene Rechnungen
  // gehören mit in den Stapel, die Kanzlei führt daraus die offenen Posten.
  const rows = db.transactions
    .filter((t) => !t.voided && t.date >= period.from && t.date <= period.to)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const t of rows) {
    const cat = db.categories.find((c) => c.id === t.categoryId);
    const acc = db.accounts.find((a) => a.id === t.accountId);
    const sachkonto = cat?.[skr] || (t.type === 'income' ? '8400' : '4900');
    const geldkonto = acc?.[skr] || (skr === 'skr03' ? '1200' : '1800');

    // Einnahme: Geld kommt aufs Konto (Soll Bank an Erlöse).
    // Ausgabe:  Aufwand im Soll gegen das Geldkonto.
    const konto = t.type === 'income' ? geldkonto : sachkonto;
    const gegenkonto = t.type === 'income' ? sachkonto : geldkonto;

    lines.push([
      num(Math.abs(t.gross)), t.gross < 0 ? '"H"' : '"S"', '"EUR"', '', '', '',
      konto, gegenkonto, '',
      ddmm(t.date),
      `"${clean(t.invoiceNumber || '', 36)}"`, '', '',
      `"${clean(t.description || '', 60)}"`,
      '', '', '', '', '', '',
    ].join(SEP));
  }

  return [header, columns, ...lines].join('\r\n') + '\r\n';
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

/**
 * Liefert die Dateien, die bei einer Betriebsprüfung als „Datenträgerüberlassung“
 * erwartet werden: beschreibende index.xml plus die zugehörigen CSV-Dateien.
 */
export function gobdExport(db, period) {
  // Belege nicht gelisteter Buchungen gehören ebenso wenig hinein wie die Buchungen.
  const hidden = new Set((db.transactions || []).filter(isUnlisted).flatMap((t) => t.attachments || []));
  db = listedOnly(db);
  const basis = basisOf(db);
  const rows = db.transactions
    .filter((t) => {
      const d = effectiveDate(t, basis) || t.date;
      return d >= period.from && d <= period.to;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const buchungen = toCsv(
    ['ID', 'Belegdatum', 'Zahlungsdatum', 'Belegnummer', 'Buchungstext', 'Kategorie', 'Konto', 'Gegenkonto', 'Netto', 'Steuersatz', 'Steuer', 'Brutto', 'SollHaben', 'Storno', 'Erfasst am', 'Geaendert am'],
    rows.map((t) => {
      const cat = db.categories.find((c) => c.id === t.categoryId);
      const acc = db.accounts.find((a) => a.id === t.accountId);
      return [
        t.id, fmtDate(t.date), t.paidDate ? fmtDate(t.paidDate) : '', t.invoiceNumber || '',
        t.description, cat?.name || '', cat?.skr03 || '', acc?.skr03 || '',
        num(t.net), String(t.vatRate || 0), num(t.vat), num(t.gross),
        t.type === 'income' ? 'H' : 'S', t.voided ? 'J' : 'N',
        t.createdAt || '', t.updatedAt || '',
      ];
    }),
  );

  const konten = toCsv(['ID', 'Name', 'Art', 'SKR03', 'SKR04', 'Anfangsbestand', 'Stichtag'],
    db.accounts.map((a) => [a.id, a.name, a.kind, a.skr03 || '', a.skr04 || '', num(a.openingBalance), fmtDate(a.openingDate || '')]));

  const kategorien = toCsv(['ID', 'Name', 'Art', 'EUER-Zeile', 'SKR03', 'SKR04', 'Steuersatz'],
    db.categories.map((c) => [c.id, c.name, c.kind, c.euerLine ?? '', c.skr03 || '', c.skr04 || '', String(c.vatRate ?? '')]));

  const kontakte = contactsCsv(db);

  const journal = toCsv(['Nr', 'Zeitpunkt', 'Vorgang', 'Objekt', 'Objekt-ID', 'Beschreibung', 'Pruefsumme'],
    (db.auditLog || []).map((e) => [e.seq, e.ts, e.action, e.entity, e.entityId, e.summary, e.hash]));

  const belege = toCsv(['ID', 'Dateiname', 'Groesse', 'SHA-256', 'Erfasst am', 'Zugeordnete Buchung'],
    (db.attachments || []).filter((a) => !hidden.has(a.id)).map((a) => {
      const tx = db.transactions.find((t) => (t.attachments || []).includes(a.id));
      return [a.id, a.fileName, a.size, a.sha256, a.createdAt, tx?.id || ''];
    }));

  const index = indexXml(db, period, [
    { file: 'buchungen.csv', name: 'Buchungen', desc: 'Alle Geschäftsvorfälle des Zeitraums' },
    { file: 'konten.csv', name: 'Konten', desc: 'Zahlungskonten' },
    { file: 'kategorien.csv', name: 'Kategorien', desc: 'Kontenzuordnung und EÜR-Zeilen' },
    { file: 'kontakte.csv', name: 'Geschaeftspartner', desc: 'Kunden und Lieferanten' },
    { file: 'aenderungsjournal.csv', name: 'Aenderungsjournal', desc: 'Protokoll aller Änderungen mit Prüfsummenkette' },
    { file: 'belegverzeichnis.csv', name: 'Belege', desc: 'Verzeichnis der hinterlegten Belege mit Prüfsummen' },
  ]);

  return [
    { name: 'index.xml', text: index },
    { name: 'buchungen.csv', text: buchungen },
    { name: 'konten.csv', text: konten },
    { name: 'kategorien.csv', text: kategorien },
    { name: 'kontakte.csv', text: kontakte },
    { name: 'aenderungsjournal.csv', text: journal },
    { name: 'belegverzeichnis.csv', text: belege },
    { name: 'LIESMICH.txt', text: gobdReadme(db, period) },
  ];
}

function indexXml(db, period, tables) {
  const s = db.settings;
  const x = (v) => esc(String(v ?? ''));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">
<DataSet>
  <Version>1.0</Version>
  <DataSupplier>
    <Name>${x(s.companyName || s.ownerName || 'Unbekannt')}</Name>
    <Location>${x([s.zip, s.city].filter(Boolean).join(' '))}</Location>
    <Comment>Export aus Kontovia, Zeitraum ${x(fmtDate(period.from))} bis ${x(fmtDate(period.to))}</Comment>
  </DataSupplier>
${tables.map((t) => `  <Media>
    <Name>${x(t.name)}</Name>
    <Table>
      <URL>${x(t.file)}</URL>
      <Name>${x(t.name)}</Name>
      <Description>${x(t.desc)}</Description>
      <Validity><Range><From>${x(period.from)}</From><To>${x(period.to)}</To></Range><Format>YYYY-MM-DD</Format></Validity>
      <DecimalSymbol>,</DecimalSymbol>
      <DigitGroupingSymbol>.</DigitGroupingSymbol>
      <VariableLength>
        <ColumnDelimiter>;</ColumnDelimiter>
        <RecordDelimiter>&#13;&#10;</RecordDelimiter>
        <TextEncapsulator>"</TextEncapsulator>
      </VariableLength>
    </Table>
  </Media>`).join('\n')}
</DataSet>
`;
}

function gobdReadme(db, period) {
  return `KONTOVIA – DATENTRÄGERÜBERLASSUNG (GoBD / GDPdU, Format Z3)
=========================================================

Betrieb:    ${db.settings.companyName || db.settings.ownerName || '(ohne Angabe)'}
Steuernr.:  ${db.settings.taxNumber || '(ohne Angabe)'}
Zeitraum:   ${fmtDate(period.from)} bis ${fmtDate(period.to)}
Erstellt:   ${fmtDate(todayISO())}

INHALT
------
index.xml                Beschreibung der Datenstruktur nach GDPdU-Beschreibungsstandard
buchungen.csv            Alle Geschäftsvorfälle des Zeitraums
konten.csv               Zahlungskonten mit Anfangsbeständen
kategorien.csv           Kategorien mit EÜR-Zeile und SKR-Konto
kontakte.csv             Kunden und Lieferanten
aenderungsjournal.csv    Protokoll aller Änderungen mit verketteten Prüfsummen
belegverzeichnis.csv     Alle hinterlegten Belege mit SHA-256-Prüfsumme

ZUR UNVERÄNDERBARKEIT
---------------------
Jede Änderung am Datenbestand erzeugt einen Eintrag im Änderungsjournal.
Die Einträge sind über SHA-256 verkettet: die Spalte "Pruefsumme" wird über
den jeweiligen Eintrag einschließlich der Prüfsumme des Vorgängers gebildet.
Wird ein Eintrag nachträglich verändert, passen alle folgenden Prüfsummen
nicht mehr zusammen.

Stornierte Buchungen bleiben mit Kennzeichen "Storno = J" erhalten; zu jeder
Stornierung existiert eine betragsgleiche Gegenbuchung.

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

/** Alle Zahlenwerke eines Zeitraums als Dateiliste (ohne PDFs). */
export function taxOfficePack(db, period, version = '') {
  db = listedOnly(db);
  const rows = db.transactions.filter((t) => {
    const d = effectiveDate(t, basisOf(db)) || t.date;
    return d >= period.from && d <= period.to;
  });
  const label = period.from.slice(0, 4);
  const files = [
    { name: `EUER-Zeilen_${label}.csv`, text: euerCsv(db, period) },
    { name: `Buchungsjournal_${label}.csv`, text: transactionsCsv(db, rows) },
    { name: `Offene-Posten_${label}.csv`, text: openItemsCsv(db, period.to) },
    { name: `Anlagenverzeichnis_${label}.csv`, text: assetsCsv(db, period) },
    { name: `DATEV-Buchungsstapel_${label}.csv`, text: datevBuchungsstapel(db, period), encoding: 'latin1' },
    { name: 'LIESMICH.txt', text: packReadme(db, period, version) },
  ];
  if (!isKleinunternehmer(db)) {
    files.splice(1, 0, { name: `UStVA_${label}.csv`, text: ustvaCsv(db, period) });
  }
  return files;
}

function packReadme(db, period, version = '') {
  const e = euerReport(db, period.from, period.to);
  const v = vatReturn(db, period.from, period.to);
  const klein = isKleinunternehmer(db);
  return `KONTOVIA – UNTERLAGEN FÜR DAS FINANZAMT
======================================

Betrieb:      ${db.settings.companyName || db.settings.ownerName || '(ohne Angabe)'}
Steuernummer: ${db.settings.taxNumber || '(ohne Angabe)'}
${db.settings.vatId ? 'USt-IdNr.:    ' + db.settings.vatId + '\n' : ''}Finanzamt:    ${db.settings.taxOffice || '(ohne Angabe)'}
Zeitraum:     ${fmtDate(period.from)} bis ${fmtDate(period.to)}
Ermittlung:   ${basisOf(db) === 'ist' ? 'Einnahmen-Überschuss-Rechnung nach Zufluss (§ 11 EStG)' : 'nach Rechnungsdatum'}
Besteuerung:  ${klein ? 'Kleinunternehmer nach § 19 UStG' : 'Regelbesteuerung'}

DIE WICHTIGSTEN ZAHLEN
----------------------
Betriebseinnahmen (EÜR Zeile 22): ${money(e.incomeTotal)} EUR
Betriebsausgaben  (EÜR Zeile 71): ${money(e.expenseTotal)} EUR
${e.profit >= 0 ? 'Gewinn' : 'Verlust'}            (EÜR Zeile 72): ${money(e.profit)} EUR
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
   Prüfen Sie die Zeilennummern gegen das Formular des Jahres – sie ändern
   sich gelegentlich.
${klein ? '' : `4. Für die Umsatzsteuer-Voranmeldung das Formular "Umsatzsteuer-Voranmeldung"
   öffnen und die Kennzahlen aus UStVA_*.csv übertragen.
`}
Wenn Sie eine Steuerkanzlei beauftragen: Übergeben Sie einfach die Datei
DATEV-Buchungsstapel_*.csv. Sie lässt sich in DATEV direkt einlesen
(Format EXTF 700, Buchungsstapel). Die Kanzlei sollte die verwendeten
Sachkonten und Steuerschlüssel vor der Verbuchung prüfen – Kontovia setzt
Standardkonten des ${db.settings.chartOfAccounts || 'SKR03'} ein und vergibt bewusst keine
BU-Schlüssel, damit nichts falsch automatisiert wird.

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

/** Für den Fall, dass die Daten je in ein anderes Programm sollen. */
export function jsonExport(db) {
  return JSON.stringify({
    programm: 'Kontovia',
    version: 1,
    exportiert: new Date().toISOString(),
    hinweis: 'Beträge sind ganzzahlige Cent-Werte.',
    daten: db,
  }, null, 2);
}
