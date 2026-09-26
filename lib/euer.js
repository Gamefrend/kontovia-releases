/**
 * Kontovia – Zeilen der Anlage EÜR.
 *
 * Grundlage ist der amtliche Vordruck Anlage EÜR 2025 (BMF-Schreiben vom
 * 29.08.2025, IV C 6 - S 2142/00023/010/001); für 2026 rechnet formLine() in
 * die Nummern des neuen Vordrucks um. Das Formular ändert sich fast jedes Jahr;
 * die Zuordnung jeder Kategorie bleibt deshalb in den Stammdaten frei änderbar.
 * Hier stehen die Bezeichnungen, die Zeilen, die Kontovia selbst belegt, die
 * Umrechnung je Jahrgang und die Umstellung älterer Tresore.
 */

/**
 * Stand des Formulars, auf den die gespeicherte Zuordnung ausgerichtet ist.
 * Kategorien tragen ihre Zeile immer nach diesem Vordruck; für den Bericht
 * eines anderen Jahres rechnet formLine() sie in dessen Nummern um.
 */
export const EUER_FORM = 2025;

/**
 * Nummern der Vordrucke je Jahr, ausgehend von 2025.
 *
 * 2026 (BMF-Schreiben vom 01.09.2026, IV C 6 - S 2142/00024/010/001): In
 * Zeile 27 kam die Rücklage für die Tierbewertung (Land- und Forstwirte)
 * hinzu. Waren rücken von 27 hinter den Übertrag auf 29, alle Ausgabenzeilen
 * ab 29 und die Gewinnermittlung um eins; die Einnahmen bleiben.
 */
const VORDRUCKE = {
  2025: (z) => z,
  2026: (z) => (z === 27 ? 29 : z >= 29 ? z + 1 : z),
};
const JAHRE = Object.keys(VORDRUCKE).map(Number);

/**
 * Der Vordruck, nach dem ein Jahr erklärt wird. Für frühere Jahre gilt
 * näherungsweise 2025, für spätere der jüngste bekannte – bis er hier
 * nachgetragen ist, weist die Oberfläche auf die Prüfung hin.
 */
export function formYear(year) {
  const y = Number(year) || EUER_FORM;
  return Math.min(Math.max(y, JAHRE[0]), JAHRE[JAHRE.length - 1]);
}

/** Zeilennummer einer gespeicherten Zuordnung im Vordruck des Jahres. */
export function formLine(line, year) {
  if (line === null || line === undefined || line === '') return line;
  return VORDRUCKE[formYear(year)](Number(line));
}

/** Die festen Zeilen (EUER) in den Nummern des Vordrucks eines Jahres, samt Jahr. */
export function formLines(year) {
  const out = { jahr: formYear(year) };
  for (const [k, z] of Object.entries(EUER)) out[k] = formLine(z, year);
  return out;
}

/** Zeilen, die Kontovia selbst belegt oder als Summe ausgibt. */
export const EUER = {
  kleinunternehmer: 12,
  steuerpflichtig: 15,
  steuerfrei: 16,
  ustVereinnahmt: 17,
  ustErstattet: 18,
  summeEinnahmen: 23,
  afaBeweglich: 33,
  vorsteuer: 57,
  ustGezahlt: 58,
  uebrigeAusgaben: 60,
  summeAusgaben: 75,
  gewinn: 92,
};

/** Eingabezeilen der Anlage EÜR 2025 mit ihrer Bezeichnung im Formular (gekürzt). */
export const EUER_ZEILEN = {
  12: 'Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer (§ 19 UStG)',
  13: 'davon nicht steuerbare Umsätze sowie Umsätze nach § 19 Abs. 2 UStG',
  15: 'Umsatzsteuerpflichtige Betriebseinnahmen',
  16: 'Umsatzsteuerfreie, nicht steuerbare und § 13b-Betriebseinnahmen',
  17: 'Vereinnahmte Umsatzsteuer',
  18: 'Vom Finanzamt erstattete Umsatzsteuer',
  19: 'Veräußerung oder Entnahme von Anlagevermögen',
  20: 'Private Kfz-Nutzung',
  21: 'Sonstige Sach-, Nutzungs- und Leistungsentnahmen',
  22: 'Auflösung von Rücklagen und Ausgleichsposten',
  23: 'Summe Betriebseinnahmen',
  24: 'Betriebsausgabenpauschale für bestimmte Berufsgruppen',
  27: 'Waren, Rohstoffe und Hilfsstoffe',
  29: 'Bezogene Fremdleistungen',
  30: 'Ausgaben für eigenes Personal',
  31: 'AfA auf Grundstücke und grundstücksgleiche Rechte',
  32: 'AfA auf immaterielle Wirtschaftsgüter',
  33: 'AfA auf bewegliche Wirtschaftsgüter',
  36: 'Geringwertige Wirtschaftsgüter (§ 6 Abs. 2 EStG)',
  37: 'Auflösung Sammelposten (§ 6 Abs. 2a EStG)',
  38: 'Restbuchwerte ausgeschiedener Anlagegüter',
  39: 'Miete/Pacht für Geschäftsräume',
  40: 'Aufwendungen für doppelte Haushaltsführung',
  41: 'Sonstige Aufwendungen für betrieblich genutzte Grundstücke',
  43: 'Aufwendungen für Telekommunikation',
  44: 'Übernachtungs- und Reisenebenkosten bei Geschäftsreisen',
  45: 'Fortbildungskosten',
  46: 'Rechts- und Steuerberatung, Buchführung',
  47: 'Miete/Leasing für bewegliche Wirtschaftsgüter (ohne Kfz)',
  48: 'Erhaltungsaufwendungen (ohne Gebäude und Kfz)',
  49: 'Beiträge, Gebühren, Abgaben und Versicherungen',
  50: 'Laufende EDV-Kosten',
  51: 'Arbeitsmittel (Bürobedarf, Porto, Fachliteratur)',
  52: 'Abfallbeseitigung und Entsorgung',
  53: 'Verpackung und Transport',
  54: 'Werbekosten',
  55: 'Schuldzinsen für Anschaffungen des Anlagevermögens',
  56: 'Übrige Schuldzinsen',
  57: 'Gezahlte Vorsteuerbeträge',
  58: 'An das Finanzamt gezahlte Umsatzsteuer',
  60: 'Übrige unbeschränkt abziehbare Betriebsausgaben',
  62: 'Geschenke',
  63: 'Bewirtungsaufwendungen',
  64: 'Verpflegungsmehraufwendungen',
  65: 'Häusliches Arbeitszimmer',
  66: 'Tagespauschale für die Tätigkeit in der häuslichen Wohnung',
  67: 'Sonstige beschränkt abziehbare Betriebsausgaben',
  68: 'Kfz: Leasingkosten',
  69: 'Kfz: Steuern, Versicherungen und Maut',
  70: 'Kfz und Fahrten: sonstige tatsächliche Kosten (Treibstoff, Reparaturen, ÖPNV)',
  71: 'Fahrtkosten für nicht zum Betrieb gehörende Fahrzeuge',
  75: 'Summe Betriebsausgaben',
  92: 'Gewinn/Verlust',
};

/**
 * Bis Fassung 1.5 lagen die Startkategorien auf Zeilennummern, die zu keinem
 * Jahrgang des Formulars passten (Summe der Einnahmen in Zeile 22 statt 23,
 * Reisekosten unter den beschränkt abziehbaren Ausgaben). Je Startkategorie:
 * [bisherige Zeile, Zeile 2025].
 */
const STARTKATEGORIEN_BIS_1_5 = {
  cat_e01: [14, 15], cat_e02: [14, 15], cat_e03: [15, 16], cat_e04: [11, 12],
  cat_e05: [15, 16], cat_e06: [15, 16], cat_e07: [15, 16], cat_e08: [18, 19],
  cat_e09: [19, 20], cat_e10: [17, 18], cat_e11: [15, 16],
  cat_a01: [26, 27], cat_a02: [27, 29], cat_a03: [28, 30], cat_a04: [28, 30],
  cat_a05: [31, 33], cat_a06: [33, 36], cat_a07: [37, 39], cat_a08: [38, 41],
  cat_a09: [66, 65], cat_a10: [42, 70], cat_a11: [43, 68], cat_a12: [65, 44],
  cat_a13: [64, 64], cat_a14: [63, 63], cat_a15: [59, 62], cat_a16: [52, 54],
  cat_a17: [47, 43], cat_a18: [57, 51], cat_a19: [57, 51], cat_a20: [57, 50],
  cat_a21: [48, 45], cat_a22: [49, 46], cat_a23: [49, 46], cat_a24: [51, 49],
  cat_a25: [51, 49], cat_a26: [50, 47], cat_a27: [53, 56], cat_a28: [57, 60],
  cat_a29: [55, 57], cat_a30: [56, 58], cat_a31: [57, 60],
};

/**
 * Stellt einen Tresor auf die Zeilen des Formulars 2025 um.
 *
 * Umgehängt werden nur Startkategorien, die noch auf ihrer alten Zeile
 * stehen. Eine Zuordnung, die jemand selbst gesetzt hat, bleibt unangetastet –
 * sie könnte schon stimmen – und wird zur Prüfung gemeldet.
 *
 * @returns {{geaendert:number, eigene:string[]}|null} null, wenn nichts zu tun war
 */
export function migrateEuerLines(db) {
  db.euerLines = { ...EUER_ZEILEN };
  if ((Number(db.euerForm) || 0) >= EUER_FORM) return null;
  const jetzt = new Date().toISOString();
  let geaendert = 0;
  const eigene = [];
  for (const c of db.categories || []) {
    if (c.private || c.euerLine === null || c.euerLine === undefined || c.euerLine === '') continue;
    const z = Number(c.euerLine);
    const alt = STARTKATEGORIEN_BIS_1_5[c.id];
    if (alt && z === alt[0] && alt[0] !== alt[1]) {
      c.euerLine = alt[1];
      // Sonst gewänne beim Abgleich die unveränderte Fassung eines anderen Geräts.
      c.updatedAt = jetzt;
      geaendert++;
    } else if (!alt || z !== alt[1]) {
      eigene.push(c.name);
    }
  }
  db.euerForm = EUER_FORM;
  return geaendert || eigene.length ? { geaendert, eigene } : null;
}
