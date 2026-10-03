/**
 * Startbestand für einen frisch angelegten Tresor.
 *
 * Die EÜR-Zeilennummern beziehen sich auf den amtlichen Vordruck Anlage EÜR 2025
 * (BMF-Schreiben vom 29.08.2025). Das Formular ändert sich fast jährlich – die
 * Zuordnung ist deshalb pro Kategorie in den Stammdaten frei änderbar; die
 * Bezeichnungen der Zeilen stehen in src/renderer/lib/euer.js. Die SKR-Konten
 * sind Vorschläge; verbindlich ist immer die Absprache mit der Steuerberatung.
 */

/** Stand des Formulars, auf den die Startkategorien ausgerichtet sind (siehe euer.js). */
const EUER_FORM = 2025;

/* Kürzel: [Name, EÜR-Zeile, SKR03, SKR04, Standard-USt-Satz, Flags] */
const INCOME = [
  ['Erlöse 19 % USt', 15, '8400', '4400', 19, {}],
  ['Erlöse 7 % USt', 15, '8300', '4300', 7, {}],
  ['Erlöse steuerfrei', 16, '8125', '4125', 0, {}],
  ['Erlöse als Kleinunternehmer (§ 19)', 12, '8195', '4185', 0, {}],
  ['Innergemeinschaftliche Lieferung', 16, '8125', '4125', 0, { intraEu: true }],
  ['Leistung ins Ausland (Reverse Charge)', 16, '8336', '4336', 0, { reverseCharge: true }],
  ['Zinserträge', 16, '2650', '7100', 0, {}],
  ['Verkauf von Anlagevermögen', 19, '8820', '4845', 19, {}],
  ['Private Kfz-Nutzung', 20, '8921', '4645', 19, {}],
  ['Umsatzsteuer-Erstattung Finanzamt', 18, '1780', '3820', 0, { vatNeutral: true }],
  ['Sonstige Betriebseinnahmen', 16, '8500', '4500', 0, {}],
  ['Privateinlage', null, '1890', '2180', 0, { private: true }],
];

const EXPENSE = [
  ['Wareneinkauf / Material', 27, '3400', '5400', 19, {}],
  ['Fremdleistungen / Subunternehmer', 29, '3100', '5900', 19, {}],
  ['Löhne und Gehälter', 30, '4100', '6020', 0, {}],
  ['Sozialabgaben Arbeitgeber', 30, '4130', '6110', 0, {}],
  ['Abschreibungen (AfA)', 33, '4830', '6220', 0, { depreciation: true, noVat: true }],
  ['Geringwertige Wirtschaftsgüter (bis 800 €)', 36, '4855', '6260', 19, {}],
  ['Miete Betriebsräume', 39, '4210', '6310', 0, {}],
  ['Nebenkosten, Strom, Heizung', 41, '4240', '6325', 19, {}],
  ['Häusliches Arbeitszimmer', 65, '4288', '6348', 0, {}],
  ['Kfz-Kosten (laufend)', 70, '4530', '6530', 19, {}],
  ['Kfz-Leasing', 68, '4570', '6560', 19, {}],
  ['Reisekosten', 44, '4663', '6673', 19, {}],
  ['Verpflegungsmehraufwand (Pauschale)', 64, '4668', '6674', 0, {}],
  ['Bewirtungskosten', 63, '4650', '6640', 19, { deductibleRate: 0.7 }],
  ['Geschenke an Geschäftsfreunde', 62, '4630', '6610', 19, {}],
  ['Werbung und Marketing', 54, '4600', '6600', 19, {}],
  ['Telefon und Internet', 43, '4920', '6805', 19, {}],
  ['Porto und Versand', 51, '4910', '6800', 19, {}],
  ['Bürobedarf', 51, '4930', '6815', 19, {}],
  ['Software, Lizenzen, Cloud-Dienste', 50, '4980', '6835', 19, {}],
  ['Fortbildung und Fachliteratur', 45, '4945', '6821', 19, {}],
  ['Rechts- und Steuerberatung', 46, '4950', '6825', 19, {}],
  ['Buchführungskosten', 46, '4955', '6827', 19, {}],
  ['Versicherungen', 49, '4360', '6400', 0, {}],
  ['Beiträge, Gebühren, Abgaben', 49, '4380', '6420', 0, {}],
  ['Miete / Leasing bewegliche Wirtschaftsgüter', 47, '4805', '6835', 19, {}],
  ['Schuldzinsen', 56, '2110', '7310', 0, {}],
  ['Bankgebühren und Kontoführung', 60, '4970', '6855', 0, {}],
  ['Gezahlte Vorsteuer', 57, '1576', '1406', 0, { vatNeutral: true }],
  ['An Finanzamt gezahlte Umsatzsteuer', 58, '1780', '3820', 0, { vatNeutral: true }],
  ['Sonstige Betriebsausgaben', 60, '4900', '6300', 19, {}],
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
    schema: 2,
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
    todos: [],
    assets: [],
    recurring: [],
    auditLog: [],
    counters: { invoice: 1 },
    // Die Bezeichnungen der Zeilen setzt die Oberfläche beim Laden (euer.js).
    euerLines: {},
    euerForm: EUER_FORM,
  };
}

export { makeSeed, EUER_FORM };
