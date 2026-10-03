/**
 * Kontovia – Berichte.
 *
 * Jeder Bericht wird als neutrales Dokument beschrieben (dokument.js): daraus
 * entstehen die druckfertige Seite (alsHtml) und die PDF-Datei (alsPdf). Die
 * Berichte enthalten keinerlei Skripte und keine Bilder, nur Text und Tabellen.
 */

import { money, fmtDate, fmtDateLong, todayISO, int, sum, ymLabel } from './util.js';
import {
  periodReport, euerReport, vatReturn, balanceSheet, openItems, accountBalances, accountLedger,
  isKleinunternehmer, basisOf, depreciationInRange, bookValue, depositInfo, averages, isEffective, formLines,
  afaMethod, AFA_METHODE,
} from './calc.js';
import { periodLabel } from './period.js';

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
  const kleinU = isKleinunternehmer(db);
  const r = periodReport(db, period.from, period.to);
  const F = formLines(String(period.to).slice(0, 4));
  // Einnahmen und Ausgaben zählen am Zahlungstag – wie in der Anlage EÜR.
  const basisText = basisOf(db) === 'ist' || kleinU
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
      ? 'Als Kleinunternehmer nach § 19 UStG wird durchgehend mit Bruttobeträgen gerechnet; ein Vorsteuerabzug findet nicht statt.'
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
      + 'den Gewinn, bis die Zahllast an das Finanzamt überwiesen und als Betriebsausgabe erfasst ist. Über das Jahr gleicht sich das aus.'));
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
    'Lineare Abschreibung monatsgenau ab dem Anschaffungsmonat (§ 7 Abs. 1 Satz 4 EStG); degressiv mit höchstens 30 % vom Restwert '
    + '(§ 7 Abs. 2 EStG, Anschaffung 07/2025 bis 12/2027); Computerhardware und Software auf Wunsch mit einem Jahr Nutzungsdauer '
    + 'voll im Anschaffungsjahr (BMF-Schreiben vom 22.02.2022). Maßgeblich sind die amtlichen AfA-Tabellen.');
}

function anlagenTabelle(db, period, neueSeite = true) {
  const assets = db.assets || [];
  if (!assets.length) return [];
  const zeilen = assets.map((a) => ({
    zellen: [
      a.name, fmtDate(a.purchaseDate), money(a.cost), `${afaMethod(a) === 'sofort' ? 1 : a.usefulLifeYears} J.`,
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
        ...wenn(v.kz48, zeile(48, 'Steuerfreie Umsätze ohne Vorsteuerabzug', v.kz48)),
        ...wenn(v.kz89net, zeile(89, 'Innergemeinschaftliche Erwerbe zum Steuersatz von 19 %', v.kz89net)),
        ...wenn(v.kz93net, zeile(93, 'Innergemeinschaftliche Erwerbe zum Steuersatz von 7 %', v.kz93net)),
        ...wenn(v.kz46net, zeile(46, 'Leistungen, für die der Leistungsempfänger die Steuer schuldet (§ 13b)', v.kz46net)),
      ],
    },
    h2('Steuerbeträge'),
    {
      art: 'tabelle',
      spalten: KZ,
      zeilen: [
        zeile('', 'Umsatzsteuer auf Umsätze 19 %', v.kz81tax),
        zeile('', 'Umsatzsteuer auf Umsätze 7 %', v.kz86tax),
        ...wenn(v.kz36tax, zeile(36, 'Umsatzsteuer zu anderen Steuersätzen', v.kz36tax)),
        ...wenn(v.kz89tax || v.kz93tax, zeile('', 'Umsatzsteuer aus innergemeinschaftlichen Erwerben', v.kz89tax + v.kz93tax)),
        ...wenn(v.kz47tax, zeile(47, 'Umsatzsteuer aus Leistungen nach § 13b', v.kz47tax)),
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
      zeilen: [zeile(83, v.kz83 >= 0 ? 'Verbleibende Umsatzsteuer-Vorauszahlung (an das Finanzamt)' : 'Verbleibender Überschuss (Erstattung durch das Finanzamt)', v.kz83, 'summe')],
    },
    hinweis(`Berechnet nach dem ${basisOf(db) === 'ist' ? 'Ist-Prinzip (Besteuerung nach vereinnahmten Entgelten, § 20 UStG)' : 'Soll-Prinzip (vereinbarte Entgelte)'}. `
      + 'Die Voranmeldung ist bis zum 10. Tag nach Ablauf des Voranmeldungszeitraums zu übermitteln; bei genehmigter Dauerfristverlängerung einen Monat später.'),
  ]);
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
    teile.push(`Anzahlung ${String(dep.percent).replace('.', ',')} %` + (dep.eventDate ? `, Termin ${fmtDate(dep.eventDate)}` : ''));
  }
  return teile.length ? [klein(` · ${teile.join(' · ')}`)] : [];
}

const catName = (db, id) => db.categories.find((c) => c.id === id)?.name || '–';

export function journalPdf(db, period, rows) {
  const kleinU = isKleinunternehmer(db);
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
