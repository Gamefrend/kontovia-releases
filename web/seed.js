// Erzeugt aus src/main/seed.js – dort ändern, nicht hier.
const module = { exports: {} };
(function (module, exports) {
'use strict';
/**
 * Startbestand für einen frisch angelegten Tresor.
 *
 * Die EÜR-Zeilennummern beziehen sich auf die Anlage EÜR (Stand 2024/2025).
 * Das Formular ändert sich jährlich – die Zuordnung ist deshalb pro Kategorie
 * in den Stammdaten frei änderbar. Die SKR-Konten sind Vorschläge; verbindlich
 * ist immer die Absprache mit der Steuerberatung.
 */

const EUER_LINES = {
  11: 'Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer (§ 19 UStG)',
  14: 'Umsatzsteuerpflichtige Betriebseinnahmen',
  15: 'Umsatzsteuerfreie und nicht umsatzsteuerbare Betriebseinnahmen',
  16: 'Vereinnahmte Umsatzsteuer',
  17: 'Vom Finanzamt erstattete Umsatzsteuer',
  18: 'Veräußerung oder Entnahme von Anlagevermögen',
  19: 'Private Kfz-Nutzung',
  20: 'Sonstige Sach-, Nutzungs- und Leistungsentnahmen',
  22: 'Summe Betriebseinnahmen',
  26: 'Waren, Rohstoffe und Hilfsstoffe',
  27: 'Bezogene Fremdleistungen',
  28: 'Ausgaben für eigenes Personal',
  29: 'Absetzung für Abnutzung auf unbewegliche Wirtschaftsgüter',
  31: 'Absetzung für Abnutzung auf bewegliche Wirtschaftsgüter',
  33: 'Aufwendungen für geringwertige Wirtschaftsgüter',
  37: 'Miete und Pacht für Betriebsräume',
  38: 'Sonstige Aufwendungen für betrieblich genutzte Grundstücke',
  42: 'Laufende Kfz-Kosten',
  43: 'Übrige Fahrtkosten, Leasing',
  47: 'Aufwendungen für Telekommunikation',
  48: 'Fortbildungskosten',
  49: 'Rechts- und Steuerberatung, Buchführung',
  50: 'Miete/Leasing für bewegliche Wirtschaftsgüter',
  51: 'Beiträge, Gebühren, Abgaben und Versicherungen',
  52: 'Werbekosten',
  53: 'Schuldzinsen',
  55: 'Gezahlte Vorsteuerbeträge',
  56: 'An das Finanzamt gezahlte Umsatzsteuer',
  57: 'Übrige unbeschränkt abziehbare Betriebsausgaben',
  59: 'Geschenke an Geschäftsfreunde (beschränkt abziehbar)',
  63: 'Bewirtungsaufwendungen (70 % abziehbar)',
  64: 'Verpflegungsmehraufwendungen',
  65: 'Sonstige beschränkt abziehbare Betriebsausgaben (Reisekosten)',
  66: 'Häusliches Arbeitszimmer',
  71: 'Summe Betriebsausgaben',
  72: 'Gewinn / Verlust',
};

/* Kürzel: [Name, EÜR-Zeile, SKR03, SKR04, Standard-USt-Satz, Flags] */
const INCOME = [
  ['Erlöse 19 % USt', 14, '8400', '4400', 19, {}],
  ['Erlöse 7 % USt', 14, '8300', '4300', 7, {}],
  ['Erlöse steuerfrei', 15, '8125', '4125', 0, {}],
  ['Erlöse als Kleinunternehmer (§ 19)', 11, '8195', '4185', 0, {}],
  ['Innergemeinschaftliche Lieferung', 15, '8125', '4125', 0, { intraEu: true }],
  ['Leistung ins Ausland (Reverse Charge)', 15, '8336', '4336', 0, { reverseCharge: true }],
  ['Zinserträge', 15, '2650', '7100', 0, {}],
  ['Verkauf von Anlagevermögen', 18, '8820', '4845', 19, {}],
  ['Private Kfz-Nutzung', 19, '8921', '4645', 19, {}],
  ['Umsatzsteuer-Erstattung Finanzamt', 17, '1780', '3820', 0, { vatNeutral: true }],
  ['Sonstige Betriebseinnahmen', 15, '8500', '4500', 0, {}],
  ['Privateinlage', null, '1890', '2180', 0, { private: true }],
];

const EXPENSE = [
  ['Wareneinkauf / Material', 26, '3400', '5400', 19, {}],
  ['Fremdleistungen / Subunternehmer', 27, '3100', '5900', 19, {}],
  ['Löhne und Gehälter', 28, '4100', '6020', 0, {}],
  ['Sozialabgaben Arbeitgeber', 28, '4130', '6110', 0, {}],
  ['Abschreibungen (AfA)', 31, '4830', '6220', 0, { depreciation: true, noVat: true }],
  ['Geringwertige Wirtschaftsgüter (bis 800 €)', 33, '4855', '6260', 19, {}],
  ['Miete Betriebsräume', 37, '4210', '6310', 0, {}],
  ['Nebenkosten, Strom, Heizung', 38, '4240', '6325', 19, {}],
  ['Häusliches Arbeitszimmer', 66, '4288', '6348', 0, {}],
  ['Kfz-Kosten (laufend)', 42, '4530', '6530', 19, {}],
  ['Kfz-Leasing', 43, '4570', '6560', 19, {}],
  ['Reisekosten', 65, '4663', '6673', 19, {}],
  ['Verpflegungsmehraufwand (Pauschale)', 64, '4668', '6674', 0, {}],
  ['Bewirtungskosten', 63, '4650', '6640', 19, { deductibleRate: 0.7 }],
  ['Geschenke an Geschäftsfreunde', 59, '4630', '6610', 19, {}],
  ['Werbung und Marketing', 52, '4600', '6600', 19, {}],
  ['Telefon und Internet', 47, '4920', '6805', 19, {}],
  ['Porto und Versand', 57, '4910', '6800', 19, {}],
  ['Bürobedarf', 57, '4930', '6815', 19, {}],
  ['Software, Lizenzen, Cloud-Dienste', 57, '4980', '6835', 19, {}],
  ['Fortbildung und Fachliteratur', 48, '4945', '6821', 19, {}],
  ['Rechts- und Steuerberatung', 49, '4950', '6825', 19, {}],
  ['Buchführungskosten', 49, '4955', '6827', 19, {}],
  ['Versicherungen', 51, '4360', '6400', 0, {}],
  ['Beiträge, Gebühren, Abgaben', 51, '4380', '6420', 0, {}],
  ['Miete / Leasing bewegliche Wirtschaftsgüter', 50, '4805', '6835', 19, {}],
  ['Schuldzinsen', 53, '2110', '7310', 0, {}],
  ['Bankgebühren und Kontoführung', 57, '4970', '6855', 0, {}],
  ['Gezahlte Vorsteuer', 55, '1576', '1406', 0, { vatNeutral: true }],
  ['An Finanzamt gezahlte Umsatzsteuer', 56, '1780', '3820', 0, { vatNeutral: true }],
  ['Sonstige Betriebsausgaben', 57, '4900', '6300', 19, {}],
  ['Privatentnahme', null, '1800', '2100', 0, { private: true }],
];

function build(list, kind) {
  return list.map(([name, euer, skr03, skr04, vatRate, flags], i) => ({
    id: `cat_${kind === 'income' ? 'e' : 'a'}${String(i + 1).padStart(2, '0')}`,
    kind,
    name,
    euerLine: euer,
    skr03,
    skr04,
    vatRate,
    active: true,
    ...flags,
  }));
}

function makeSeed(settings = {}) {
  const year = new Date().getFullYear();
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    settings: {
      companyName: '',
      ownerName: '',
      street: '',
      zip: '',
      city: '',
      taxNumber: '',
      vatId: '',
      taxOffice: '',
      email: '',
      phone: '',
      // 'kleinunternehmer' = § 19 UStG, keine Umsatzsteuer
      // 'regelbesteuerung' = mit Umsatzsteuerausweis
      taxMode: 'regelbesteuerung',
      // 'ist' = Einnahmen-Überschuss-Rechnung nach Zahlungsfluss (Regelfall)
      // 'soll' = nach Rechnungsdatum
      accountingBasis: 'ist',
      defaultVatRate: 19,
      currency: 'EUR',
      fiscalYear: year,
      vatPeriod: 'monatlich', // monatlich | vierteljährlich | jährlich
      chartOfAccounts: 'SKR03',
      // Sicherheit
      autoLockMinutes: 10,
      clearClipboardSeconds: 30,
      // Darstellung
      theme: 'system',
      startView: 'dashboard',
      ...settings,
    },
    accounts: [
      { id: 'acc_bank', name: 'Geschäftskonto', kind: 'bank', iban: '', openingBalance: 0, openingDate: `${year}-01-01`, skr03: '1200', skr04: '1800', active: true },
      { id: 'acc_kasse', name: 'Kasse', kind: 'cash', iban: '', openingBalance: 0, openingDate: `${year}-01-01`, skr03: '1000', skr04: '1600', active: true },
    ],
    categories: [...build(INCOME, 'income'), ...build(EXPENSE, 'expense')],
    contacts: [],
    transactions: [],
    attachments: [],
    appointments: [],
    assets: [],
    auditLog: [],
    counters: { invoice: 1 },
    euerLines: EUER_LINES,
  };
}

module.exports = { makeSeed, EUER_LINES };

})(module, module.exports);
export const { makeSeed, EUER_LINES } = module.exports;
