/**
 * Kontovia – Berichte.
 *
 * Jeder Bericht wird als neutrales Dokument beschrieben (dokument.js): daraus
 * entstehen die druckfertige Seite (alsHtml) und die PDF-Datei (alsPdf). Die
 * Berichte enthalten keinerlei Skripte und keine Bilder, nur Text und Tabellen.
 */

import { money, fmtDate, fmtDateLong, todayISO, int, sum, ymLabel, dz } from './util.js';
import {
  periodReport, euerReport, vatReturn, balanceSheet, openItems, accountBalances, accountLedger,
  isKleinunternehmer, ohneUst, keinVorsteuerAbzug, basisOf, depreciationInRange, bookValue, depositInfo, averages, isEffective, formLines,
  afaMethod, AFA_METHODE, jahresvergleich, jahresMonate, ossMeldung,
} from './calc.js';
import { LAENDER, berechnen, zustand, ZUSTAENDE, titel as belegTitel } from './rechnung.js';
import { belegZustand, BELEG_ZUSTAENDE } from './angebote.js';
import { projektAuswertung, projektBezuege, projektTermine, dauerText, abgerechnet } from './projekte.js';
import { periodLabel } from './period.js';
import { elsterWerte } from './elster.js';
import { kassen, kassenbuch } from './kasse.js';
import { liquiditaetsVorschau } from './liquiditaet.js';
import { bwa, summenSalden, ustJahr } from './bwa.js';
import { OSS_ARTEN } from './sonderfaelle.js';

export { alsHtml, alsPdf } from './dokument.js';

const doc = (db, titel, untertitel, bloecke, fuss = '') => ({ titel, untertitel, firma: db.settings || {}, bloecke, fuss });
const quer = (d) => ({ ...d, quer: true });
const h2 = (text, extra = {}) => ({ art: 'h2', text, ...extra });
const h3 = (text) => ({ art: 'h3', text });
const hinweis = (...inhalt) => ({ art: 'hinweis', inhalt: inhalt.flat().map((l) => (typeof l === 'string' ? { t: l } : l)) });
const fett = (t) => ({ t, fett: true });
const klein = (t) => ({ t, klein: true, gedaempft: true });
/** Zweispaltige Tabelle ohne Kopf: Bezeichnung und Betrag. */
const ZWEI = [{}, { rechts: true }];
const betragZeile = (label, wert, art) => ({ zellen: [label, money(wert)], ...(art ? { art } : {}) });
/** Ohne Zeilen steht ein Hinweis über die ganze Breite. */
const oderLeer = (zeilen, text, spalten) => (zeilen.length ? zeilen : [{ zellen: [{ inhalt: text, spalten, gedaempft: true }] }]);

/* -------------------------------------------------------------------------- */
/* Gewinn- und Verlustrechnung                                                 */
/* -------------------------------------------------------------------------- */

export function guvReport(db, period) {
  const kleinU = ohneUst(db, period.to);
  const r = periodReport(db, period.from, period.to);
  const F = formLines(String(period.to).slice(0, 4));
  // Einnahmen und Ausgaben zählen am Zahlungstag – wie in der Anlage EÜR.
  const basisText = basisOf(db, period.from) === 'ist' || kleinU
    ? 'Zufluss-/Abflussprinzip (§ 11 EStG)'
    : 'Zufluss-/Abflussprinzip (§ 11 EStG); die noch offene Zahllast folgt der Soll-Versteuerung (Rechnungsdatum)';

  const spalten = (steuer) => [
    { titel: 'Kategorie' }, { titel: 'Anzahl', rechts: true },
    ...(kleinU ? [] : [{ titel: steuer, rechts: true }]),
    { titel: kleinU ? 'Betrag' : 'Netto', rechts: true },
  ];
  const kat = (c) => ({ zellen: [c.name, int(c.count), ...(kleinU ? [] : [{ inhalt: money(c.vat), gedaempft: true }]), money(c.amount)] });
  const n = kleinU ? 3 : 4;

  const einnahmen = oderLeer(r.byCategory.filter((c) => c.kind === 'income').map(kat), 'Keine Einnahmen im Zeitraum', n);
  einnahmen.push({ art: 'summe', zellen: ['Summe Betriebseinnahmen', int(r.countIncome), ...(kleinU ? [] : [money(r.incomeVat)]), money(r.incomeForProfit)] });
  const ausgaben = oderLeer(r.byCategory.filter((c) => c.kind === 'expense').map(kat), 'Keine Ausgaben im Zeitraum', n);
  if (r.depreciation) {
    ausgaben.push({ zellen: ['Abschreibungen (AfA)', int((db.assets || []).length), ...(kleinU ? [] : [{ inhalt: '–', gedaempft: true }]), money(r.depreciation)] });
  }
  ausgaben.push({ art: 'summe', zellen: ['Summe Betriebsausgaben', int(r.countExpense), ...(kleinU ? [] : [money(r.expenseVat)]), money(r.expenseForProfit)] });

  const ergebnis = [
    betragZeile('Betriebseinnahmen', r.incomeForProfit),
    betragZeile('abzüglich Betriebsausgaben', -r.expenseForProfit),
    betragZeile(`${r.profit >= 0 ? 'Gewinn' : 'Verlust'} vor Steuern`, r.profit, 'summe'),
  ];
  if (r.expenseDeductible !== r.expenseForProfit) {
    ergebnis.push(betragZeile('Steuerlich abziehbare Ausgaben (nach Kürzung, z. B. Bewirtung 70 %)', r.expenseDeductible, 'zwischen'));
    ergebnis.push(betragZeile('Steuerliches Ergebnis', r.taxableProfit, 'summe'));
  }

  const bloecke = [
    {
      art: 'kennzahlen',
      werte: [
        { label: 'Betriebseinnahmen', wert: `${money(r.incomeForProfit)} €`, ton: 'pos' },
        { label: 'Betriebsausgaben', wert: `${money(r.expenseForProfit)} €`, ton: 'neg' },
        { label: r.profit >= 0 ? 'Gewinn' : 'Verlust', wert: `${money(r.profit)} €`, ton: r.profit >= 0 ? 'pos' : 'neg' },
      ],
    },
    h2('Betriebseinnahmen'),
    { art: 'tabelle', spalten: spalten('Umsatzsteuer'), zeilen: einnahmen },
    h2('Betriebsausgaben'),
    { art: 'tabelle', spalten: spalten('Vorsteuer'), zeilen: ausgaben },
    h2('Ergebnis'),
    { art: 'tabelle', spalten: ZWEI, zeilen: ergebnis },
  ];

  if (r.privateIn || r.privateOut) {
    bloecke.push(h3('Nachrichtlich: Privatvorgänge (nicht im Ergebnis enthalten)'),
      { art: 'tabelle', spalten: ZWEI, zeilen: [betragZeile('Privateinlagen', r.privateIn), betragZeile('Privatentnahmen', r.privateOut)] });
  }
  if (r.vatRemitted || r.vatRefunded) {
    bloecke.push(h3('Nachrichtlich: Umsatzsteuer-Verrechnung mit dem Finanzamt'), {
      art: 'tabelle',
      spalten: ZWEI,
      zeilen: [
        betragZeile('Im Zeitraum an das Finanzamt gezahlt', r.vatRemitted),
        ...(r.vatRefunded ? [betragZeile('Vom Finanzamt erstattet', r.vatRefunded)] : []),
        betragZeile('Danach noch offene Zahllast des Zeitraums', r.vatOutstanding),
      ],
    }, hinweis(`Diese Zahlungen gleichen nur das Umsatzsteuerkonto aus und sind in der Nettobetrachtung weder Ertrag noch Aufwand. `
      + `In der Anlage EÜR erscheinen sie dagegen in eigenen Zeilen (${F.ustErstattet} und ${F.ustGezahlt}).`));
  }

  bloecke.push(...monatsTabelle(r));
  bloecke.push(hinweis(fett('Wie diese Zahlen zustande kommen.'), ` Grundlage ist das ${basisText}. `
    + (kleinU
      ? (keinVorsteuerAbzug(db, period.to)
        ? 'Ohne Vorsteuerabzug (nur umsatzsteuerfreie Umsätze) wird durchgehend mit Bruttobeträgen gerechnet: Die Umsatzsteuer auf Ihre Ausgaben gehört zu den Kosten.'
        : 'Als Kleinunternehmer nach § 19 UStG wird durchgehend mit Bruttobeträgen gerechnet; ein Vorsteuerabzug findet nicht statt.')
      : 'Einnahmen und Ausgaben sind netto ausgewiesen. Die Umsatzsteuer ist ein durchlaufender Posten und in der Umsatzsteuer-Voranmeldung abgebildet.')
    + ' Anschaffungen über 800 € netto gehen nicht sofort, sondern über die Abschreibung in das Ergebnis ein.'));

  return doc(db, 'Gewinn- und Verlustrechnung', periodLabel(period), bloecke,
    'Diese Aufstellung ist eine betriebswirtschaftliche Auswertung und ersetzt keine Steuererklärung.');
}

function monatsTabelle(r) {
  if (r.months.length < 2) return [];
  const avg = averages(r);
  const zeilen = r.months.map((m) => ({
    zellen: [ymLabel(m.ym), money(m.income), money(m.expense), { inhalt: money(m.profit), ton: m.profit >= 0 ? 'pos' : 'neg' }],
  }));
  zeilen.push({
    art: 'summe',
    zellen: ['Summe', money(sum(r.months, (m) => m.income)), money(sum(r.months, (m) => m.expense)), money(sum(r.months, (m) => m.profit))],
  });
  if (avg.months) {
    zeilen.push({
      art: 'zwischen',
      zellen: [[{ t: 'Durchschnitt je Monat ' }, klein(`(${avg.months} Monate)`)], money(avg.income), money(avg.expense), money(avg.profit)],
    });
  }
  return [
    h2('Monatsübersicht', { zusammen: true }),
    {
      art: 'tabelle',
      zusammen: true,
      spalten: [{ titel: 'Monat' }, { titel: 'Einnahmen', rechts: true }, { titel: 'Ausgaben', rechts: true }, { titel: 'Ergebnis', rechts: true }],
      zeilen,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Anlage EÜR                                                                  */
/* -------------------------------------------------------------------------- */

const ZEILE_TEXT_BETRAG = [{ titel: 'Zeile', breite: 16, rechts: true }, { titel: 'Bezeichnung' }, { titel: 'Betrag in €', breite: 32, rechts: true }];

export function euerPdf(db, period) {
  const e = euerReport(db, period.from, period.to);
  const F = e.form;
  const einnahmen = oderLeer(e.income.map((r) => ({ zellen: [String(r.line), r.label, money(r.amount)] })), 'Keine Einnahmen im Zeitraum', 3);
  einnahmen.push({ art: 'summe', zellen: [String(F.summeEinnahmen), 'Summe Betriebseinnahmen', money(e.incomeTotal)] });
  const ausgaben = oderLeer(e.expense.map((r) => ({
    zellen: [String(r.line),
      r.nonDeductible
        ? [{ t: r.label }, { t: `abziehbarer Teil; nicht abziehbar: ${money(r.nonDeductible)} € (linke Spalte im Formular)`, umbruch: true, gedaempft: true }]
        : r.label,
      money(r.amount)],
  })), 'Keine Ausgaben im Zeitraum', 3);
  ausgaben.push({ art: 'summe', zellen: [String(F.summeAusgaben), 'Summe Betriebsausgaben', money(e.expenseTotal)] });

  const bloecke = [
    hinweis(fett('So übertragen Sie die Werte.'), ` Die linke Spalte nennt die Zeilennummer der amtlichen Anlage EÜR (Vordruck ${F.jahr}). `
      + 'Öffnen Sie in „Mein ELSTER“ das Formular „Einnahmenüberschussrechnung (Anlage EÜR)“ und tragen Sie die Beträge in die '
      + 'gleichnamigen Zeilen ein. Die Beträge folgen dem Zahlungsfluss (§ 11 EStG). Prüfen Sie die Zeilennummern gegen das Formular '
      + 'des jeweiligen Jahres. Sie ändern sich fast jährlich.'),
    h2('Betriebseinnahmen'),
    { art: 'tabelle', spalten: ZEILE_TEXT_BETRAG, zeilen: einnahmen },
    h2('Betriebsausgaben'),
    { art: 'tabelle', spalten: ZEILE_TEXT_BETRAG, zeilen: ausgaben },
    h2('Ergebnis'),
    {
      art: 'tabelle',
      spalten: [{ breite: 16, rechts: true }, {}, { breite: 32, rechts: true }],
      zeilen: [{
        art: 'summe',
        zellen: [String(F.gewinn), `${e.profit >= 0 ? 'Gewinn' : 'Verlust'} (Zeile ${F.summeAusgaben + 1} abzüglich Zeile ${F.summeAusgaben + 2}; `
          + `ohne Korrekturen der Zeilen ${F.summeAusgaben + 3} bis ${F.gewinn - 1})`, money(e.profit)],
      }],
    },
  ];

  if (!e.kleinunternehmer && e.reconciliation.vatFlow) {
    const u = e.reconciliation;
    bloecke.push(h3('Überleitung zum Ergebnis der Gewinn- und Verlustrechnung'), {
      art: 'tabelle',
      spalten: ZWEI,
      zeilen: [
        betragZeile('Ergebnis ohne Umsatzsteuer (Nettobetrachtung)', u.netResult),
        betragZeile(`zuzüglich vereinnahmte Umsatzsteuer (Zeile ${F.ustVereinnahmt})`, u.vatCollected),
        ...(u.vatRefunded ? [betragZeile(`zuzüglich Erstattung vom Finanzamt (Zeile ${F.ustErstattet})`, u.vatRefunded)] : []),
        betragZeile(`abzüglich gezahlte Vorsteuer (Zeile ${F.vorsteuer})`, -u.vatDeducted),
        betragZeile(`abzüglich an das Finanzamt gezahlte Umsatzsteuer (Zeile ${F.ustGezahlt})`, -u.vatRemitted),
        betragZeile('Gewinn laut Anlage EÜR', e.profit, 'summe'),
      ],
    }, hinweis('In der Einnahmen-Überschuss-Rechnung ist die Umsatzsteuer ein durchlaufender Posten, der zeitversetzt wirkt: Sie erhöht '
      + 'den Gewinn, bis die Zahllast an das Finanzamt überwiesen und als Betriebsausgabe erfasst ist. Über mehrere Jahre gleicht sich das aus; '
      + 'die Vorauszahlung für Dezember, gezahlt bis zum 10. Januar, zählt noch im alten Jahr (10-Tage-Regel).'));
  }
  if (e.zehnTage.length) {
    bloecke.push(hinweis(fett('10-Tage-Regel. '), `${e.zehnTage.length} regelmäßig wiederkehrende ${e.zehnTage.length === 1 ? 'Zahlung zählt' : 'Zahlungen zählen'} `
      + 'im Jahr, zu dem sie gehören, nicht im Jahr der Zahlung (§ 11 EStG): '
      + e.zehnTage.map((z) => `${db.transactions.find((t) => t.id === z.id)?.description || 'Buchung'} vom ${fmtDate(z.bezahlt)}`).join('; ') + '.'));
  }
  if (e.ohneKategorie.length) {
    bloecke.push(hinweis(fett('Ohne Kategorie. '), `${e.ohneKategorie.length} ${e.ohneKategorie.length === 1 ? 'Buchung steht' : 'Buchungen stehen'} `
      + `vorläufig in Zeile ${F.steuerpflichtig} bzw. ${F.uebrigeAusgaben}. Ordnen Sie sie einer Kategorie zu, bevor Sie die Zahlen übernehmen.`));
  }

  bloecke.push(...anlagenTabelle(db, period));
  return doc(db, 'Anlage EÜR: Zeilenzuordnung', periodLabel(period), bloecke,
    'Kontovia übermittelt nichts an die Finanzverwaltung. Die Übertragung nach ELSTER nehmen Sie selbst vor.');
}

/** Anlagenverzeichnis als eigenständiger Bericht. */
export function assetsPdf(db, period) {
  const bloecke = (db.assets || []).length
    ? anlagenTabelle(db, period, false)
    : [{ art: 'absatz', inhalt: 'Kein Anlagevermögen erfasst.', gedaempft: true }];
  return doc(db, 'Anlagenverzeichnis', periodLabel(period), bloecke,
    'Lineare Abschreibung monatsgenau ab dem Anschaffungsmonat (§ 7 Abs. 1 Satz 4 EStG); degressiv vom Restwert nach § 7 Abs. 2 EStG '
    + '(Anschaffung 2020 bis 2022 höchstens 25 %, 04/2024 bis 12/2024 höchstens 20 %, 07/2025 bis 12/2027 höchstens 30 %); Computerhardware '
    + 'und Software auf Wunsch mit einem Jahr Nutzungsdauer voll im Anschaffungsjahr (BMF-Schreiben vom 22.02.2022). Ausgeschiedene Güter '
    + 'werden bis zum Monat des Abgangs abgeschrieben, der Rest ist Restbuchwert. Maßgeblich sind die amtlichen AfA-Tabellen.');
}

const ABGANG_ART = { verkauf: 'verkauft', entnahme: 'entnommen', verschrottung: 'verschrottet' };

function anlagenTabelle(db, period, neueSeite = true) {
  const assets = db.assets || [];
  if (!assets.length) return [];
  const zeilen = assets.map((a) => ({
    zellen: [
      a.abgang?.datum ? [{ t: `${a.name} ` }, klein(`(${ABGANG_ART[a.abgang.art] || 'ausgeschieden'} am ${fmtDate(a.abgang.datum)})`)] : a.name,
      fmtDate(a.purchaseDate), money(a.cost), `${afaMethod(a) === 'sofort' ? 1 : a.usefulLifeYears} J.`,
      AFA_METHODE[afaMethod(a)], money(depreciationInRange(a, period.from, period.to)), money(bookValue(a, period.to)),
    ],
  }));
  zeilen.push({
    art: 'summe',
    zellen: [
      { inhalt: 'Summe', spalten: 2 }, money(sum(assets, (a) => a.cost)), '', '',
      money(sum(assets, (a) => depreciationInRange(a, period.from, period.to))), money(sum(assets, (a) => bookValue(a, period.to))),
    ],
  });
  return [
    h2('Anlagenverzeichnis (§ 4 Abs. 3 Satz 5 EStG)', { neueSeite }),
    {
      art: 'tabelle',
      spalten: [
        { titel: 'Wirtschaftsgut' }, { titel: 'Anschaffung', rechts: true }, { titel: 'Kosten', rechts: true },
        { titel: 'Nutzungsdauer', rechts: true }, { titel: 'Methode' }, { titel: 'AfA im Zeitraum', rechts: true }, { titel: 'Restbuchwert', rechts: true },
      ],
      zeilen,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Umsatzsteuer-Voranmeldung                                                   */
/* -------------------------------------------------------------------------- */

export function ustvaPdf(db, period) {
  const v = vatReturn(db, period.from, period.to);
  if (v.ohneVorsteuerabzug) {
    return doc(db, 'Umsatzsteuer', periodLabel(period), [
      hinweis(fett('Kein Vorsteuerabzug.'), ' Ihre Umsätze sind umsatzsteuerfrei (§ 4 UStG). Sie führen keine Umsatzsteuer ab und melden keine Voranmeldungen; '
        + 'die Umsatzsteuer auf Ihre Ausgaben ist nicht abziehbar (§ 15 Abs. 2 UStG) und zählt zu den Betriebsausgaben.'),
    ]);
  }
  if (v.kleinunternehmer) {
    return doc(db, 'Umsatzsteuer', periodLabel(period), [
      hinweis(fett('Kleinunternehmerregelung.'), ' Sie führen nach § 19 UStG keine Umsatzsteuer ab und melden keine Voranmeldungen. '
        + 'In Ihren Rechnungen darf keine Umsatzsteuer ausgewiesen sein.'),
    ]);
  }
  const KZ = [{ breite: 16, rechts: true }, {}, { breite: 32, rechts: true }];
  const zeile = (kz, label, wert, art) => ({ zellen: [String(kz), label, money(wert)], ...(art ? { art } : {}) });
  const wenn = (bed, z) => (bed ? [z] : []);

  return doc(db, 'Umsatzsteuer-Voranmeldung', periodLabel(period), [
    hinweis(fett('Übertragung nach ELSTER.'), ' Die Nummern links sind die amtlichen Kennzahlen des Formulars „Umsatzsteuer-Voranmeldung“. '
      + 'Tragen Sie die Beträge in die gleichnamigen Felder ein. Bemessungsgrundlagen werden ohne Nachkommastellen abgerundet erwartet, '
      + 'Steuerbeträge mit zwei Nachkommastellen.'),
    h2('Steuerpflichtige Umsätze (Bemessungsgrundlagen)'),
    {
      art: 'tabelle',
      spalten: KZ,
      zeilen: [
        zeile(81, 'Umsätze zum Steuersatz von 19 %', v.kz81net),
        zeile(86, 'Umsätze zum Steuersatz von 7 %', v.kz86net),
        ...wenn(v.kz35net, zeile(35, 'Umsätze zu anderen Steuersätzen', v.kz35net)),
        ...wenn(v.kz41, zeile(41, 'Innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.', v.kz41)),
        ...wenn(v.kz21, zeile(21, 'Nicht steuerbare sonstige Leistungen (§ 18b Satz 1 Nr. 2 UStG)', v.kz21)),
        ...wenn(v.kz43, zeile(43, 'Steuerfreie Umsätze mit Vorsteuerabzug (Ausfuhrlieferungen u. a.)', v.kz43)),
        ...wenn(v.kz45, zeile(45, 'Nicht steuerbare Umsätze (Leistungsort nicht im Inland)', v.kz45)),
        ...wenn(v.kz48, zeile(48, 'Steuerfreie Umsätze ohne Vorsteuerabzug', v.kz48)),
        ...wenn(v.kz60, zeile(60, 'Steuerpflichtige Umsätze, für die der Leistungsempfänger die Steuer schuldet (§ 13b)', v.kz60)),
        ...wenn(v.kz89net, zeile(89, 'Innergemeinschaftliche Erwerbe zum Steuersatz von 19 %', v.kz89net)),
        ...wenn(v.kz93net, zeile(93, 'Innergemeinschaftliche Erwerbe zum Steuersatz von 7 %', v.kz93net)),
        ...wenn(v.kz46net, zeile(46, 'Sonstige Leistungen aus dem übrigen EU-Gebiet, Steuer schulden Sie (§ 13b Abs. 1)', v.kz46net)),
        ...wenn(v.kz84net, zeile(84, 'Andere Leistungen, für die Sie die Steuer schulden (§ 13b)', v.kz84net)),
      ],
    },
    ...wenn(v.kz50, hinweis(fett('Kennzahl 50: '), `Davon Minderung wegen Forderungsausfall ${money(v.kz50)} € (in den Umsätzen oben schon enthalten). `
      + 'Bitte in Mein ELSTER in Kennzahl 50 eintragen; die XML-Datei enthält sie nicht.')),
    ...wenn(v.ohneKategorie.length, hinweis(fett('Unvollständig: '), `${v.ohneKategorie.length} ${v.ohneKategorie.length === 1 ? 'Buchung' : 'Buchungen'} ohne Kategorie `
      + 'fehlen in den Kennzahlen. Ordnen Sie sie zu, bevor Sie die Voranmeldung abgeben.')),
    h2('Steuerbeträge'),
    {
      art: 'tabelle',
      spalten: KZ,
      zeilen: [
        zeile('', 'Umsatzsteuer auf Umsätze 19 %', v.kz81tax),
        zeile('', 'Umsatzsteuer auf Umsätze 7 %', v.kz86tax),
        ...wenn(v.kz36tax, zeile(36, 'Umsatzsteuer zu anderen Steuersätzen', v.kz36tax)),
        ...wenn(v.kz89tax || v.kz93tax, zeile('', 'Umsatzsteuer aus innergemeinschaftlichen Erwerben', v.kz89tax + v.kz93tax)),
        ...wenn(v.kz47tax, zeile(47, 'Umsatzsteuer aus Leistungen nach § 13b Abs. 1', v.kz47tax)),
        ...wenn(v.kz85tax, zeile(85, 'Umsatzsteuer aus anderen Leistungen nach § 13b', v.kz85tax)),
        zeile('', 'Umsatzsteuer gesamt', v.umsatzsteuer, 'zwischen'),
      ],
    },
    h2('Abziehbare Vorsteuer'),
    {
      art: 'tabelle',
      spalten: KZ,
      zeilen: [
        zeile(66, 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern', v.kz66),
        ...wenn(v.kz61, zeile(61, 'Vorsteuer aus innergemeinschaftlichen Erwerben', v.kz61)),
        ...wenn(v.kz67, zeile(67, 'Vorsteuer aus Leistungen nach § 13b', v.kz67)),
        zeile('', 'Vorsteuer gesamt', v.vorsteuer, 'zwischen'),
      ],
    },
    h2('Ergebnis'),
    {
      art: 'tabelle',
      spalten: KZ,
      zeilen: [
        ...wenn(v.kz39, zeile(39, 'Abzug der festgesetzten Sondervorauszahlung (Dauerfristverlängerung)', -v.kz39)),
        zeile(83, v.kz83 >= 0 ? 'Verbleibende Umsatzsteuer-Vorauszahlung (an das Finanzamt)' : 'Verbleibender Überschuss (Erstattung durch das Finanzamt)', v.kz83, 'summe'),
      ],
    },
    // ELSTER rechnet die Steuer aus den auf volle Euro gekürzten Bemessungsgrundlagen; das kann ein paar Cent ausmachen.
    ...wenn(elsterWerte(v).kz83 !== v.kz83, hinweis(fett('In ELSTER: '), `Kennzahl 83 ergibt dort ${money(elsterWerte(v).kz83)} €, weil ELSTER die Steuer aus den Bemessungsgrundlagen in vollen Euro rechnet. `
      + `Der Unterschied von ${money(elsterWerte(v).kz83 - v.kz83, { sign: true })} € ist gewollt und gleicht sich in der Jahreserklärung aus.`)),
    hinweis(`Berechnet nach dem ${basisOf(db, period.from) === 'ist' ? 'Ist-Prinzip (Besteuerung nach vereinnahmten Entgelten, § 20 UStG)' : 'Soll-Prinzip (vereinbarte Entgelte)'}; `
      + 'die Vorsteuer zählt mit dem Datum der Rechnung. '
      + 'Die Voranmeldung ist bis zum 10. Tag nach Ablauf des Voranmeldungszeitraums zu übermitteln; bei genehmigter Dauerfristverlängerung einen Monat später.'),
    ...ossBloecke(db, period),
  ]);
}

/** OSS-Meldung je Land und Satz (calc.js: ossMeldung), nur wenn es im Zeitraum OSS-Verkäufe gibt. */
function ossBloecke(db, period) {
  const m = ossMeldung(db, period.from, period.to);
  if (!m.zeilen.length) return [];
  return [
    h2('OSS-Meldung (Verkäufe an Privatkunden in der EU)'),
    {
      art: 'tabelle',
      spalten: [{ titel: 'Land' }, { titel: 'Art', breite: 32 }, { titel: 'Satz', breite: 18, rechts: true }, { titel: 'Netto in €', breite: 32, rechts: true }, { titel: 'Umsatzsteuer in €', breite: 36, rechts: true }],
      zeilen: [
        ...m.zeilen.map((z) => ({ zellen: [LAENDER[z.land]?.name || z.land, OSS_ARTEN[z.art] || '', `${dz(z.satz)} %`, money(z.netto), money(z.steuer)] })),
        { zellen: ['Zusammen', '', '', money(m.netto), money(m.steuer)], art: 'summe' },
      ],
    },
    hinweis('Diese Umsätze stehen nicht in der Voranmeldung oben. Die OSS-Meldung geben Sie vierteljährlich im Online-Portal des Bundeszentralamts für Steuern ab, gezählt nach Rechnungsdatum.'),
  ];
}

/* -------------------------------------------------------------------------- */
/* Vermögensübersicht                                                          */
/* -------------------------------------------------------------------------- */

export function balancePdf(db, period) {
  const b = balanceSheet(db, period.to);
  const schulden = b.passiva.payables + b.passiva.vatLiability;
  const anlagen = (b.activa.assets || []).map((a) => ({ zellen: [[{ t: `${a.name} ` }, klein(`(Anschaffung ${fmtDate(a.purchaseDate)})`)], money(a.bookValue)] }));
  const gruppe = (t) => ({ art: 'gruppe', zellen: [{ inhalt: t, spalten: 2 }] });
  const ek = b.equityDevelopment;
  return doc(db, 'Vermögensübersicht', `Stichtag ${fmtDateLong(period.to)}`, [
    {
      art: 'kennzahlen',
      werte: [
        { label: 'Vermögen', wert: `${money(b.activa.total)} €` },
        { label: 'Schulden', wert: `${money(schulden)} €`, ton: 'neg' },
        { label: 'Reinvermögen', wert: `${money(b.passiva.equity)} €`, ton: b.passiva.equity >= 0 ? 'pos' : 'neg' },
      ],
    },
    h2('Vermögen (Aktiva)'),
    {
      art: 'tabelle',
      spalten: ZWEI,
      zeilen: [
        gruppe('Anlagevermögen'),
        ...(anlagen.length ? anlagen : [{ zellen: [{ inhalt: 'Kein Anlagevermögen erfasst', gedaempft: true }, '0,00'] }]),
        betragZeile('Summe Anlagevermögen', b.activa.fixedAssets, 'zwischen'),
        gruppe('Umlaufvermögen'),
        betragZeile('Forderungen aus Lieferungen und Leistungen', b.activa.receivables),
        ...(b.activa.accounts || []).map((a) => betragZeile(a.name, a.balance)),
        betragZeile('Summe Umlaufvermögen', b.activa.receivables + b.activa.cash, 'zwischen'),
        betragZeile('Summe Vermögen', b.activa.total, 'summe'),
      ],
    },
    h2('Schulden und Reinvermögen (Passiva)'),
    {
      art: 'tabelle',
      spalten: ZWEI,
      zeilen: [
        betragZeile('Verbindlichkeiten aus Lieferungen und Leistungen', b.passiva.payables),
        ...(b.passiva.vatLiability ? [betragZeile('Umsatzsteuer-Zahllast (laufendes Jahr)', b.passiva.vatLiability)] : []),
        ...(b.passiva.vatClaim ? [betragZeile('nachrichtlich: Vorsteuer-Erstattungsanspruch', b.passiva.vatClaim)] : []),
        betragZeile('Summe Schulden', schulden, 'zwischen'),
        betragZeile('Reinvermögen (Eigenkapital)', b.passiva.equity),
        betragZeile('Summe Passiva', b.passiva.total, 'summe'),
      ],
    },
    h2('Entwicklung des Eigenkapitals im laufenden Jahr'),
    {
      art: 'tabelle',
      spalten: ZWEI,
      zeilen: [
        betragZeile('Ergebnis seit Jahresbeginn', ek.profitYtd),
        betragZeile('Privateinlagen', ek.deposits),
        betragZeile('Privatentnahmen', -ek.withdrawals),
        betragZeile('Veränderung', ek.profitYtd + ek.deposits - ek.withdrawals, 'summe'),
      ],
    },
    hinweis(fett('Was diese Übersicht ist und was nicht.'), ' Bei einer Einnahmen-Überschuss-Rechnung besteht keine Pflicht zur Bilanzierung. '
      + 'Diese Gegenüberstellung zeigt, was dem Betrieb zum Stichtag gehört und was er schuldet. Sie folgt nicht der Gliederung des '
      + '§ 266 HGB und ersetzt keine handelsrechtliche Bilanz. Das Reinvermögen ergibt sich rechnerisch als Vermögen abzüglich Schulden.'),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Journal und offene Posten                                                   */
/* -------------------------------------------------------------------------- */

/** Ort und Anzahlung stehen im Journal als Zusatz hinter der Beschreibung. */
function journalZusatz(t) {
  const teile = [];
  if (t.location) teile.push(t.location);
  const dep = depositInfo(t);
  if (dep?.percent) {
    teile.push(`Anzahlung ${dz(dep.percent)} %` + (dep.eventDate ? `, Termin ${fmtDate(dep.eventDate)}` : ''));
  }
  return teile.length ? [klein(` · ${teile.join(' · ')}`)] : [];
}

const catName = (db, id) => db.categories.find((c) => c.id === id)?.name || '–';

export function journalPdf(db, period, rows) {
  const kleinU = ohneUst(db, period.to);
  const list = rows || db.transactions
    .filter((t) => t.date >= period.from && t.date <= period.to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const totalIn = sum(list.filter((t) => t.type === 'income' && isEffective(t)), (t) => t.gross);
  const totalOut = sum(list.filter((t) => t.type === 'expense' && isEffective(t)), (t) => t.gross);
  const n = kleinU ? 6 : 8;

  const zeilen = oderLeer(list.map((t) => ({
    ...(t.voided ? { art: 'storno' } : {}),
    zellen: [
      fmtDate(t.date),
      [klein(t.invoiceNumber || '')],
      [{ t: t.description || '' }, ...journalZusatz(t), ...((t.attachments || []).length ? [klein(' [Beleg]')] : [])],
      [{ t: catName(db, t.categoryId), klein: true }],
      t.paidDate ? [{ t: fmtDate(t.paidDate), klein: true }] : [klein('offen')],
      ...(kleinU ? [] : [money(t.net), { inhalt: money(t.vat), gedaempft: true }]),
      { inhalt: `${t.type === 'income' ? '+' : '−'} ${money(Math.abs(t.gross))}`, ton: t.type === 'income' ? 'pos' : 'neg' },
    ],
  })), 'Keine Buchungen im Zeitraum', n);
  zeilen.push({
    art: 'summe',
    zellen: [{ inhalt: `Summe Einnahmen ${money(totalIn)} € · Summe Ausgaben ${money(totalOut)} €`, spalten: n - 1 }, money(totalIn - totalOut)],
  });

  // Acht Spalten: im Querformat bleibt der Beschreibung genug Platz.
  return quer(doc(db, 'Buchungsjournal', periodLabel(period), [
    {
      art: 'tabelle',
      spalten: [
        { titel: 'Datum', breite: 18 }, { titel: 'Beleg-Nr.', breite: 20 }, { titel: 'Beschreibung' }, { titel: 'Kategorie' },
        { titel: 'Zahlung', breite: 18 },
        ...(kleinU ? [] : [{ titel: 'Netto', breite: 20, rechts: true }, { titel: 'USt', breite: 18, rechts: true }]),
        { titel: 'Brutto', breite: 22, rechts: true },
      ],
      zeilen,
    },
    hinweis('Vollständige Auflistung aller Geschäftsvorfälle im Zeitraum in zeitlicher Reihenfolge (Grundbuchfunktion). Stornierte '
      + 'Buchungen sind durchgestrichen dargestellt und bleiben zusammen mit ihrer Gegenbuchung nachvollziehbar erhalten.'),
  ]));
}

export function openItemsPdf(db, asOf = todayISO()) {
  const o = openItems(db, asOf);
  const tabelle = (items, titel, kind) => [
    h2(titel),
    {
      art: 'tabelle',
      spalten: [
        { titel: 'Datum', breite: 18 }, { titel: 'Beleg-Nr.', breite: 20 }, { titel: 'Beschreibung' },
        { titel: kind === 'income' ? 'Kunde' : 'Lieferant' }, { titel: 'Fällig', breite: 18 },
        { titel: 'Tage', breite: 16, rechts: true }, { titel: 'Betrag', breite: 22, rechts: true },
      ],
      zeilen: [
        ...oderLeer(items.map((t) => ({
          zellen: [
            fmtDate(t.date), [klein(t.invoiceNumber || '')], t.description || '',
            [{ t: db.contacts.find((c) => c.id === t.contactId)?.name || '', klein: true }], fmtDate(t.dueDate),
            t.overdue ? { inhalt: `+${t.overdueDays}`, ton: 'neg' } : '–', money(t.gross),
          ],
        })), 'Nichts offen', 7),
        { art: 'summe', zellen: [{ inhalt: 'Summe', spalten: 6 }, money(sum(items, (t) => t.gross))] },
      ],
    },
  ];
  const alter = (a, titel) => [
    h3(titel),
    {
      art: 'tabelle',
      spalten: ZWEI,
      zeilen: [
        betragZeile('nicht fällig', a.current), betragZeile('1 bis 30 Tage überfällig', a.d30), betragZeile('31 bis 60 Tage überfällig', a.d60),
        betragZeile('61 bis 90 Tage überfällig', a.d90), betragZeile('über 90 Tage überfällig', a.older),
      ],
    },
  ];
  return doc(db, 'Offene Posten', `Stichtag ${fmtDateLong(asOf)}`, [
    ...tabelle(o.receivables, 'Forderungen: von Kunden noch nicht bezahlt', 'income'),
    ...alter(o.receivableAging, 'Altersstruktur der Forderungen'),
    ...tabelle(o.payables, 'Verbindlichkeiten: von Ihnen noch nicht bezahlt', 'expense'),
    ...alter(o.payableAging, 'Altersstruktur der Verbindlichkeiten'),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Jahresvergleich                                                             */
/* -------------------------------------------------------------------------- */

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const prozent = (f) => (f === null || f === undefined || !Number.isFinite(f) ? '–' : `${f > 0 ? '+' : f < 0 ? '−' : ''}${dz(Math.abs(f * 100).toFixed(Math.abs(f) < 0.1 ? 1 : 0))} %`);
const vorzeichen = (cent) => (cent > 0 ? '+ ' : cent < 0 ? '− ' : '') + money(Math.abs(cent));

/**
 * Ausgaben (oder Einnahmen) über mehrere Jahre: Summen, Kategorien nebeneinander und der Verlauf über die Monate.
 * @param {{jahre:number[], art:'expense'|'income', bis?:string|null, kategorie?:string}} spec
 *   bis: 'MM-TT' vergleicht nur bis zu diesem Tag des Jahres; kategorie: Kennung der Kategorie, 'afa' oder leer für alles
 */
export function vergleichPdf(db, spec) {
  const { art = 'expense', bis = null, kategorie = '' } = spec;
  const v = jahresvergleich(db, { jahre: spec.jahre, art, bis });
  const ausgaben = art === 'expense';
  const name = ausgaben ? 'Ausgaben' : 'Einnahmen';
  const jahre = v.jahre;
  const stichtag = bis ? `${bis.slice(3)}.${bis.slice(0, 2)}.` : '';
  const n = jahre.length + 3;
  const letzte = jahre.at(-1);
  const tabelle = {
    art: 'tabelle',
    spalten: [{ titel: 'Kategorie' }, ...jahre.map((y) => ({ titel: String(y), breite: 22, rechts: true })), { titel: 'Veränderung', breite: 24, rechts: true }, { titel: '%', breite: 16, rechts: true }],
    zeilen: [
      ...oderLeer(v.kategorien.map((k) => ({
        zellen: [
          k.name, ...jahre.map((y) => money(k.werte[y])),
          k.diff === null ? '–' : { inhalt: vorzeichen(k.diff), ton: k.diff === 0 ? undefined : ((k.diff > 0) === ausgaben ? 'neg' : 'pos') },
          k.trend === null ? '–' : { inhalt: prozent(k.trend), gedaempft: true },
        ],
      })), `Keine ${name} in diesen Jahren`, n),
      {
        art: 'summe',
        zellen: [`Summe ${name}`, ...jahre.map((y) => money(v.summen[y])),
          v.veraenderung ? { inhalt: vorzeichen(v.veraenderung.diff), ton: v.veraenderung.diff === 0 ? undefined : ((v.veraenderung.diff > 0) === ausgaben ? 'neg' : 'pos') } : '–',
          v.veraenderung ? prozent(v.veraenderung.trend) : '–'],
      },
    ],
  };
  const monate = jahresMonate(db, { jahre, art, categoryId: kategorie, bis });
  const katName = !kategorie ? `Alle ${name}` : kategorie === 'afa' ? 'Abschreibungen (AfA)' : (db.categories.find((c) => c.id === kategorie)?.name || 'Ohne Kategorie');
  const verlauf = {
    art: 'tabelle',
    spalten: [{ titel: 'Monat' }, ...jahre.map((y) => ({ titel: String(y), breite: 26, rechts: true }))],
    zeilen: [
      ...MONATE.map((m, i) => ({ zellen: [m, ...jahre.map((y) => money(monate[y][i]))] })),
      { art: 'summe', zellen: ['Summe', ...jahre.map((y) => money(monate[y].reduce((a, b) => a + b, 0)))] },
    ],
  };
  return doc(db, `Jahresvergleich ${name}`, `${jahre.join(', ')}${bis ? `, jeweils vom 1.1. bis ${stichtag}` : ', ganze Jahre'}`, [
    {
      art: 'kennzahlen',
      werte: jahre.map((y) => ({ label: String(y), wert: `${money(v.summen[y])} €`, ton: undefined })),
    },
    tabelle,
    h2(`Verlauf über das Jahr: ${katName}`, { zusammen: true }),
    verlauf,
    hinweis(`Die Veränderung vergleicht ${letzte} mit ${v.vorjahr ?? 'dem Vorjahr'}. ${ausgaben ? 'Mehr Ausgaben sind rot, weniger grün.' : 'Mehr Einnahmen sind grün, weniger rot.'}`
      + ` Gezählt wird wie in der Gewinn- und Verlustrechnung: am Zahlungstag${ohneUst(db) ? (keinVorsteuerAbzug(db) ? ', brutto (ohne Vorsteuerabzug)' : ', brutto (Kleinunternehmer)') : ', netto'}, einschließlich Abschreibungen.`),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Kontenblatt                                                                 */
/* -------------------------------------------------------------------------- */

export function accountsPdf(db, period) {
  const accounts = accountBalances(db, period.to);
  const bloecke = accounts.flatMap((acc) => {
    const { opening, rows, closing } = accountLedger(db, acc, period.from, period.to);
    return [
      h2([{ t: `${acc.name} ` }, klein(`(${acc.kind === 'bank' ? 'Bankkonto' : 'Kasse'}${acc.iban ? ', ' + acc.iban : ''})`)]),
      {
        art: 'tabelle',
        spalten: [
          { titel: 'Datum', breite: 18 }, { titel: 'Vorgang' }, { titel: 'Eingang', breite: 22, rechts: true },
          { titel: 'Ausgang', breite: 22, rechts: true }, { titel: 'Saldo', breite: 24, rechts: true },
        ],
        zeilen: [
          { art: 'gruppe', zellen: [{ inhalt: `Anfangsbestand am ${fmtDate(period.from)}`, spalten: 4 }, money(opening)] },
          ...rows.map(({ tx: t, balance }) => ({
            zellen: [
              fmtDate(t.paidDate), t.description || '',
              { inhalt: t.type === 'income' ? money(t.gross) : '', ton: 'pos' },
              { inhalt: t.type === 'expense' ? money(t.gross) : '', ton: 'neg' },
              money(balance),
            ],
          })),
          { art: 'summe', zellen: [{ inhalt: `Endbestand am ${fmtDate(period.to)}`, spalten: 4 }, money(closing)] },
        ],
      },
    ];
  });
  return doc(db, 'Kontenblätter', periodLabel(period), bloecke.length ? bloecke : [{ art: 'absatz', inhalt: 'Keine Konten angelegt.', gedaempft: true }]);
}

/* -------------------------------------------------------------------------- */
/* BWA, Summen- und Saldenliste, Umsatzsteuer-Jahresübersicht (lib/bwa.js)     */
/* -------------------------------------------------------------------------- */

const anteilText = (x) => (x === null || x === undefined ? '' : `${dz((x * 100).toFixed(1))} %`);

/** BWA des Zeitraums; beginnt er nicht am 1. Januar, steht das Jahr bis zum Ende des Zeitraums daneben. */
export function bwaPdf(db, period) {
  const b = bwa(db, period.from, period.to);
  const jahrBeginn = `${period.to.slice(0, 4)}-01-01`;
  const kum = period.from > jahrBeginn ? bwa(db, jahrBeginn, period.to) : null;
  const ART = { summe: 'gruppe', ergebnis: 'summe' };
  const spalten = [{ titel: 'Bezeichnung' }, { titel: 'Zeitraum', breite: 28, rechts: true }, { titel: '% Umsatz', breite: 18, rechts: true },
    ...(kum ? [{ titel: 'Seit Jahresbeginn', breite: 30, rechts: true }, { titel: '% Umsatz', breite: 18, rechts: true }] : [])];
  const zeilen = b.zeilen.map((z, i) => ({
    zellen: [z.label, money(z.betrag), anteilText(z.anteil), ...(kum ? [money(kum.zeilen[i].betrag), anteilText(kum.zeilen[i].anteil)] : [])],
    ...(ART[z.art] ? { art: ART[z.art] } : {}),
  }));
  const bloecke = [{ art: 'tabelle', spalten, zeilen }];
  bloecke.push(hinweis('Abgeleitet aus der Anlage EÜR, nach Zahlungstag, ohne Umsatzsteuer. Kosten stehen in voller Höhe, auch wo die EÜR sie kürzt (etwa Bewirtung).'
    + (b.gekuerzt ? ` Steuerlich nicht abziehbar davon: ${money(b.gekuerzt)} €.` : '')));
  if (b.ohneKategorie.length) bloecke.push(hinweis(fett(`${b.ohneKategorie.length === 1 ? 'Eine Buchung' : `${b.ohneKategorie.length} Buchungen`} ohne Kategorie`), ' stehen unter Umsatzerlöse bzw. Sonstige Kosten.'));
  return doc(db, 'Betriebswirtschaftliche Auswertung', periodLabel(period), bloecke);
}

/** Summen- und Saldenliste des Zeitraums. */
export function susaPdf(db, period) {
  const s = summenSalden(db, period.from, period.to);
  const saldo = (k) => (k.saldo ? `${money(Math.abs(k.saldo))} ${k.saldo > 0 ? 'S' : 'H'}` : '0,00');
  return doc(db, 'Summen- und Saldenliste', `${periodLabel(period)} · ${s.rahmen}`, [
    {
      art: 'tabelle',
      spalten: [{ titel: 'Konto', breite: 16 }, { titel: 'Bezeichnung' }, { titel: 'Soll', breite: 26, rechts: true }, { titel: 'Haben', breite: 26, rechts: true }, { titel: 'Saldo', breite: 30, rechts: true }],
      zeilen: [
        ...oderLeer(s.konten.map((k) => ({ zellen: [k.nr, k.name, money(k.soll), money(k.haben), saldo(k)] })), 'Keine Zahlungen im Zeitraum', 5),
        { art: 'summe', zellen: ['', 'Summe', money(s.soll), money(s.haben), ''] },
      ],
    },
    hinweis('Gebucht nach Zahlungstag aus den Kategorien und Konten mit ihren Sachkonten, dazu die Abschreibung. Eine vereinfachte Liste aus Kontovia; die Buchführung Ihrer Kanzlei kann abweichen.'),
  ]);
}

/** Umsatzsteuer-Jahresübersicht: Kennzahlen, Voranmeldungen, Rest. */
export function ustJahrPdf(db, jahr) {
  const u = ustJahr(db, jahr);
  if (u.ohneUst) return doc(db, `Umsatzsteuer ${u.jahr}`, 'Jahresübersicht', [{ art: 'absatz', inhalt: 'In diesem Jahr gab es keine Umsatzsteuer (Kleinunternehmer oder ohne Vorsteuerabzug).', gedaempft: true }]);
  return doc(db, `Umsatzsteuer ${u.jahr}`, 'Jahresübersicht für die Umsatzsteuererklärung', [
    h2('Werte des Jahres'),
    {
      art: 'tabelle',
      spalten: [{ titel: 'Kz (Voranmeldung)', breite: 30 }, { titel: 'Bezeichnung' }, { titel: 'Betrag', breite: 30, rechts: true }],
      zeilen: [
        ...oderLeer(u.kennzahlen.map((k) => ({ zellen: [k.nr, k.label, money(k.wert)] })), 'Keine Umsätze', 3),
        { art: 'summe', zellen: ['', 'Umsatzsteuer des Jahres (nach Abzug der Vorsteuer)', money(u.jahressteuer)] },
      ],
    },
    h2('Voranmeldungen'),
    {
      art: 'tabelle',
      spalten: [{ titel: 'Zeitraum' }, { titel: 'Grundlage', breite: 40 }, { titel: 'Vorauszahlung', breite: 30, rechts: true }],
      zeilen: [
        ...u.perioden.map((p) => ({ zellen: [`${p.label} (${fmtDate(p.from)}–${fmtDate(p.to)})`, p.quelle === 'meldung' ? 'eingelesene Meldung' : (p.laeuft ? 'berechnet, läuft noch' : 'berechnet'), money(p.angemeldet)] })),
        { art: 'summe', zellen: ['Summe der Vorauszahlungen', '', money(u.vorauszahlungen)] },
      ],
    },
    { art: 'tabelle', spalten: ZWEI, zeilen: [betragZeile(u.rest >= 0 ? 'Noch zu zahlen (Abschlusszahlung)' : 'Zu erstatten', Math.abs(u.rest), 'summe')] },
    hinweis('Bemessungsgrundlagen in vollen Euro wie in ELSTER. Die Nummern sind die der Voranmeldung; in der Umsatzsteuererklärung haben die Felder eigene Nummern. Bitte vor dem Übertragen mit dem Formular abgleichen.'),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Kassenbuch und Liquiditätsvorschau                                          */
/* -------------------------------------------------------------------------- */

/** Kassenbuch einer Barkasse (lib/kasse.js). Private Bewegungen stehen mit Betrag, aber ohne Text darin. */
export function kassenbuchPdf(db, period, kasseId = '') {
  const liste = kassen(db);
  const kasse = liste.find((k) => k.id === kasseId) || liste[0];
  if (!kasse) return doc(db, 'Kassenbuch', periodLabel(period), [{ art: 'absatz', inhalt: 'Keine Kasse angelegt.', gedaempft: true }]);
  const kb = kassenbuch(db, kasse, period.from, period.to);
  const zeilen = [{ art: 'gruppe', zellen: [{ inhalt: `Anfangsbestand am ${fmtDate(period.from)}`, spalten: 6 }, money(kb.opening)] }];
  for (const t of kb.tage) {
    for (const z of t.zeilen) {
      zeilen.push({
        zellen: [String(z.nr), fmtDate(t.datum), z.tx.unlisted ? 'Privat' : (z.tx.description || ''), z.tx.invoiceNumber || '',
          { inhalt: z.ein ? money(z.ein) : '', ton: 'pos' }, { inhalt: z.aus ? money(z.aus) : '', ton: 'neg' }, money(z.bestand)],
      });
    }
    zeilen.push({ art: 'gruppe', zellen: ['', { inhalt: `Tagesabschluss ${fmtDate(t.datum)}`, spalten: 3 }, money(t.ein), money(t.aus), money(t.endbestand)] });
  }
  zeilen.push({ art: 'summe', zellen: [{ inhalt: `Endbestand am ${fmtDate(period.to)}`, spalten: 6 }, money(kb.closing)] });
  const bloecke = [
    h2([{ t: `${kasse.name} ` }, klein('(Kasse)')]),
    {
      art: 'tabelle',
      spalten: [{ titel: 'Nr.', breite: 10, rechts: true }, { titel: 'Datum', breite: 18 }, { titel: 'Vorgang' }, { titel: 'Beleg', breite: 22 },
        { titel: 'Einnahme', breite: 20, rechts: true }, { titel: 'Ausgabe', breite: 20, rechts: true }, { titel: 'Bestand', breite: 22, rechts: true }],
      zeilen,
    },
  ];
  if (kb.zaehlungen.length) {
    bloecke.push(h3('Kassensturz'), {
      art: 'tabelle',
      spalten: [{ titel: 'Datum', breite: 22 }, { titel: 'Notiz' }, { titel: 'Gezählt', breite: 24, rechts: true }, { titel: 'Laut Kassenbuch', breite: 28, rechts: true }, { titel: 'Differenz', breite: 24, rechts: true }],
      zeilen: kb.zaehlungen.map((z) => ({ zellen: [fmtDate(z.datum), z.notiz, money(z.gezaehlt), money(z.buch), money(z.differenz)] })),
    });
  }
  if (kb.fehltage.length) bloecke.push(hinweis(fett('Fehlbestand: '), `An ${kb.fehltage.length} Tagen lag der Bestand am Tagesende unter null (zuerst am ${fmtDate(kb.fehltage[0])}).`));
  return doc(db, 'Kassenbuch', periodLabel(period), bloecke);
}

/** Liquiditätsvorschau (lib/liquiditaet.js): Wochen und erwartete Zahlungen. */
export function liquiditaetPdf(db, tage = 90) {
  const v = liquiditaetsVorschau(db, { tage });
  const ART = { forderung: 'offene Einnahme', verbindlichkeit: 'offene Ausgabe', wiederkehrend: 'wiederkehrend', steuer: 'Umsatzsteuer' };
  return doc(db, 'Liquiditätsvorschau', `${fmtDate(todayISO())} bis ${fmtDate(v.wochen[v.wochen.length - 1]?.bis || todayISO())}`, [
    { art: 'tabelle', spalten: ZWEI, zeilen: [betragZeile('Heute auf allen Konten', v.start), betragZeile('Erwartete Eingänge', v.einnahmen), betragZeile('Erwartete Ausgänge', -v.ausgaben), betragZeile('Erwarteter Stand am Ende', v.ende, 'summe')] },
    ...(v.tiefpunkt.bestand < 0 ? [hinweis(fett('Engpass: '), `Am ${fmtDate(v.tiefpunkt.datum)} läge der Stand bei ${money(v.tiefpunkt.bestand)} €.`)] : []),
    h2('Stand je Woche'),
    { art: 'tabelle', spalten: [{ titel: 'Woche' }, { titel: 'Eingänge', breite: 26, rechts: true }, { titel: 'Ausgänge', breite: 26, rechts: true }, { titel: 'Stand', breite: 28, rechts: true }],
      zeilen: v.wochen.map((w) => ({ zellen: [`${fmtDate(w.von)} bis ${fmtDate(w.bis)}`, money(w.ein), money(w.aus), money(w.bestand)] })) },
    h2('Erwartete Zahlungen'),
    { art: 'tabelle', spalten: [{ titel: 'Datum', breite: 20 }, { titel: 'Vorgang' }, { titel: 'Art', breite: 30 }, { titel: 'Betrag', breite: 24, rechts: true }, { titel: 'Stand danach', breite: 26, rechts: true }],
      zeilen: oderLeer(v.posten.map((p) => ({ zellen: [fmtDate(p.datum), p.ueberfaellig ? `${p.text} (überfällig)` : p.text, ART[p.art] || '', money(p.betrag), money(p.bestand)] })), 'Keine erwarteten Zahlungen.', 5) },
    hinweis('Gerechnet wird nur mit dem, was in Kontovia steht: offene Einnahmen und Ausgaben zu ihrer Fälligkeit, wiederkehrende Buchungen und Rechnungen, die Umsatzsteuer-Zahllast der Voranmeldungen.'),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Projektbericht                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Alles zu einem Projekt auf einem Blatt (lib/projekte.js): Kennzahlen, Stunden je Person, Zeiten, Rechnungen und
 * Angebote, Buchungen (ohne private) und kommende Termine. Für den Kunden oder die eigene Nachkalkulation.
 */
export function projektPdf(db, projekt, heute = todayISO()) {
  const a = projektAuswertung(db, projekt);
  const b = projektBezuege(db, projekt.id);
  const rechnungen = db.invoices || [];
  const txById = new Map((db.transactions || []).map((t) => [t.id, t]));
  const kunde = (db.contacts || []).find((c) => c.id === projekt.kontaktId);
  const kennzahlen = [
    { zellen: ['Kunde', kunde?.name || 'ohne Kunde'] },
    ...(projekt.stundensatz ? [{ zellen: ['Stundensatz netto', `${money(projekt.stundensatz)} €`] }] : []),
    ...(projekt.kostenstelle ? [{ zellen: ['Kostenstelle', projekt.kostenstelle] }] : []),
    { zellen: ['Stunden', dauerText(a.minuten)] },
    { zellen: ['Davon noch nicht abgerechnet', `${dauerText(a.offenMinuten)} (${money(a.offenWert)} €)`] },
    betragZeile('Offene Forderungen', a.offenForderung),
    betragZeile('Einnahmen netto', a.einnahmen),
    betragZeile('Ausgaben netto', -a.ausgaben),
    betragZeile('Ergebnis', a.ergebnis, 'summe'),
    ...(a.budgetAnteil !== null ? [{ zellen: ['Budget', `${Math.round(a.budgetAnteil * 100)} % von ${money(projekt.budget)} €`] }] : []),
    ...(a.stundenAnteil !== null ? [{ zellen: ['Stundenbudget', `${Math.round(a.stundenAnteil * 100)} % von ${projekt.budgetStunden} Std.`] }] : []),
  ];
  const bloecke = [{ art: 'tabelle', spalten: ZWEI, zeilen: kennzahlen }];
  if (a.personen.length) {
    bloecke.push(h2('Stunden je Person'), {
      art: 'tabelle',
      spalten: [{ titel: 'Person' }, { titel: 'Stunden', breite: 24, rechts: true }, { titel: 'Offen', breite: 24, rechts: true }, { titel: 'Offener Wert', breite: 28, rechts: true }],
      zeilen: a.personen.map((x) => ({ zellen: [x.person, dauerText(x.minuten), dauerText(x.offenMinuten), money(x.offenWert)] })),
    });
  }
  const mitPerson = b.zeiten.some((z) => z.person);
  bloecke.push(h2('Zeiten'), {
    art: 'tabelle',
    spalten: [{ titel: 'Datum', breite: 20 }, ...(mitPerson ? [{ titel: 'Person', breite: 28 }] : []), { titel: 'Tätigkeit' }, { titel: 'Dauer', breite: 16, rechts: true }, { titel: 'Stand', breite: 24 }],
    zeilen: oderLeer([...b.zeiten].reverse().map((z) => ({
      zellen: [fmtDate(z.datum), ...(mitPerson ? [z.person || ''] : []), z.beschreibung || '', dauerText(z.minuten),
        abgerechnet(z, rechnungen) ? 'abgerechnet' : z.abrechenbar === false ? 'nicht abrechenbar' : 'offen'],
    })), 'Keine Zeiten erfasst.', mitPerson ? 5 : 4),
  });
  const belege = [
    ...b.rechnungen.map((r) => {
      const z = zustand(r, { buchungen: (r.transactionIds || []).map((id) => txById.get(id)).filter(Boolean) });
      return { x: r, stand: ZUSTAENDE[z]?.name || '', betrag: berechnen(r).brutto };
    }),
    ...b.belege.map((x) => ({ x, stand: BELEG_ZUSTAENDE[belegZustand(x, { rechnungen })]?.name || '', betrag: x.belegart === 'lieferschein' ? null : berechnen(x).brutto })),
  ].sort((p, q) => String(p.x.datum || '').localeCompare(String(q.x.datum || '')));
  bloecke.push(h2('Rechnungen und Angebote'), {
    art: 'tabelle',
    spalten: [{ titel: 'Beleg' }, { titel: 'Datum', breite: 20 }, { titel: 'Stand', breite: 28 }, { titel: 'Brutto', breite: 24, rechts: true }],
    zeilen: oderLeer(belege.map((z) => ({ zellen: [`${belegTitel(z.x)} ${z.x.nummer || 'Entwurf'}`, fmtDate(z.x.datum), z.stand, z.betrag === null ? '' : money(z.betrag)] })), 'Keine Rechnungen oder Angebote.', 4),
  });
  bloecke.push(h2('Buchungen'), {
    art: 'tabelle',
    spalten: [{ titel: 'Datum', breite: 20 }, { titel: 'Beschreibung' }, { titel: 'Netto', breite: 24, rechts: true }, { titel: 'Zahlung', breite: 22 }],
    zeilen: oderLeer([...b.buchungen].reverse().map((t) => ({
      zellen: [fmtDate(t.date), `${t.description || ''}${t.voided || t.isReversal ? ' (storniert)' : ''}`,
        { inhalt: `${t.type === 'income' ? '' : '−'}${money(Math.abs(t.net || 0))}`, ton: t.type === 'income' ? 'pos' : 'neg' }, t.paidDate ? 'bezahlt' : 'offen'],
    })), 'Keine Buchungen.', 4),
  });
  const kommend = projektTermine(db, projekt.id, heute).filter((x) => x.kommend && !x.termin.done);
  if (kommend.length) {
    bloecke.push(h2('Kommende Termine'), {
      art: 'tabelle',
      spalten: [{ titel: 'Datum', breite: 20 }, { titel: 'Zeit', breite: 26 }, { titel: 'Termin' }],
      zeilen: kommend.map((x) => ({ zellen: [fmtDate(x.tag), x.termin.allDay ? 'ganztägig' : [x.termin.startTime, x.termin.endTime].filter(Boolean).join(' bis '), x.termin.title || ''] })),
    });
  }
  return doc(db, 'Projektbericht', `${projekt.name || 'Projekt'}, Stand ${fmtDate(heute)}`, bloecke);
}

/* -------------------------------------------------------------------------- */
/* Kompletter Jahresbericht                                                    */
/* -------------------------------------------------------------------------- */

/** Die Berichte eines Jahres, jeder auf eigenen Seiten. */
export function yearPack(db, period) {
  return [
    guvReport(db, period),
    euerPdf(db, period),
    ustvaPdf(db, period),
    balancePdf(db, period),
    openItemsPdf(db, period.to),
    journalPdf(db, period),
  ];
}
