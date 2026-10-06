/**
 * Kontovia – Rechnungen schreiben: Aufbau, Berechnung, Pflichtangaben.
 *
 * Eine Rechnung entsteht als Entwurf und lässt sich beliebig ändern. Mit dem
 * Ausstellen bekommt sie ihre Nummer, und es entstehen zwei Dateien, die ab
 * dann feststehen (GoBD): die E-Rechnung als XML (lib/erechnung-schreiben.js)
 * und das gestaltete PDF mit derselben XML darin (ZUGFeRD / Factur-X,
 * lib/rechnungsdruck.js). Was die Datei gilt, steht in der XML; das PDF ist
 * die lesbare Ansicht dazu.
 *
 * Diese Datei kennt keine Oberfläche und keinen Speicher: Sie rechnet und
 * prüft nur und läuft deshalb auch in den Prüfungen (scripts/pruefungen).
 *
 * Grundlagen: § 14 Abs. 4 UStG (Pflichtangaben), EN 16931 (Inhalt einer
 * E-Rechnung, Rechenregeln BR-CO-*), XRechnung 3.0 (zusätzliche Regeln
 * BR-DE-* für Rechnungen an öffentliche Auftraggeber).
 */

import { uid, todayISO, addDays, money, ustIdHinweis } from './util.js';

/* -------------------------------------------------------------------------- */
/* Verzeichnisse                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Mengeneinheiten nach UN/ECE Recommendation 20 (in E-Rechnungen Pflicht).
 * kurz steht auf dem PDF, worte helfen beim Erkennen freier Eingaben.
 */
export const EINHEITEN = [
  { code: 'C62', name: 'Stück', kurz: 'Stk.', worte: ['stück', 'stk', 'st', 'stck', 'x', 'mal', 'einheit', 'einheiten', 'piece', 'pcs', 'pc'] },
  { code: 'HUR', name: 'Stunde', kurz: 'Std.', worte: ['stunde', 'stunden', 'std', 'h', 'hour', 'hours'] },
  { code: 'MIN', name: 'Minute', kurz: 'Min.', worte: ['minute', 'minuten', 'min'] },
  { code: 'DAY', name: 'Tag', kurz: 'Tag', worte: ['tag', 'tage', 'tg', 'day', 'days'] },
  { code: 'E49', name: 'Arbeitstag', kurz: 'AT', worte: ['arbeitstag', 'arbeitstage', 'at', 'personentag', 'personentage', 'pt'] },
  { code: 'WEE', name: 'Woche', kurz: 'Woche', worte: ['woche', 'wochen', 'wo'] },
  { code: 'MON', name: 'Monat', kurz: 'Monat', worte: ['monat', 'monate', 'mon', 'mo', 'mtl'] },
  { code: 'ANN', name: 'Jahr', kurz: 'Jahr', worte: ['jahr', 'jahre', 'j', 'jährlich'] },
  { code: 'LS', name: 'Pauschale', kurz: 'psch.', worte: ['pauschal', 'pauschale', 'psch', 'pausch', 'flat'] },
  { code: 'E48', name: 'Leistung', kurz: 'Leistung', worte: ['leistung', 'leistungen', 'leistungseinheit', 'le', 'service'] },
  { code: 'SET', name: 'Satz', kurz: 'Satz', worte: ['satz', 'set', 'sätze'] },
  { code: 'PR', name: 'Paar', kurz: 'Paar', worte: ['paar', 'paare'] },
  { code: 'XPK', name: 'Packung', kurz: 'Pck.', worte: ['packung', 'packungen', 'pck', 'pack', 'paket', 'pakete'] },
  { code: 'KGM', name: 'Kilogramm', kurz: 'kg', worte: ['kilogramm', 'kg', 'kilo'] },
  { code: 'GRM', name: 'Gramm', kurz: 'g', worte: ['gramm', 'g', 'gr'] },
  { code: 'TNE', name: 'Tonne', kurz: 't', worte: ['tonne', 'tonnen', 't'] },
  { code: 'MTR', name: 'Meter', kurz: 'm', worte: ['meter', 'm', 'lfm', 'laufmeter'] },
  { code: 'KMT', name: 'Kilometer', kurz: 'km', worte: ['kilometer', 'km'] },
  { code: 'MTK', name: 'Quadratmeter', kurz: 'm²', worte: ['quadratmeter', 'm²', 'm2', 'qm'] },
  { code: 'MTQ', name: 'Kubikmeter', kurz: 'm³', worte: ['kubikmeter', 'm³', 'm3', 'cbm'] },
  { code: 'LTR', name: 'Liter', kurz: 'l', worte: ['liter', 'l', 'ltr'] },
  { code: 'KWH', name: 'Kilowattstunde', kurz: 'kWh', worte: ['kilowattstunde', 'kilowattstunden', 'kwh'] },
  { code: 'P1', name: 'Prozent', kurz: '%', worte: ['prozent', '%'] },
];

const EINHEIT_NACH_CODE = new Map(EINHEITEN.map((e) => [e.code, e]));

/** Name zur Anzeige einer Einheit: eigener Text, sonst Kurzname zum Code. */
export function einheitText(pos) {
  return String(pos?.einheitText || '').trim() || EINHEIT_NACH_CODE.get(pos?.einheit)?.kurz || pos?.einheit || '';
}

/** Kurzname zum Code („HUR“ → „Std.“). */
export const einheitKurz = (code) => EINHEIT_NACH_CODE.get(code)?.kurz || code || '';

/**
 * Freie Eingabe → Einheit. Bekannte Wörter („Std.“, „qm“, „pauschal“) und
 * Codes („HUR“) werden erkannt. Was es als Code nicht gibt, steht auf dem PDF
 * wie eingegeben und in der E-Rechnung als Stück (C62).
 * @returns {{code:string, text:string, bekannt:boolean}}
 */
export function einheitAusText(eingabe) {
  const roh = String(eingabe ?? '').trim();
  if (!roh) return { code: 'C62', text: '', bekannt: true };
  const klein = roh.toLowerCase().replace(/\.$/, '').replace(/\(e\)$|\(n\)$/, '');
  const treffer = EINHEIT_NACH_CODE.get(roh.toUpperCase())
    || EINHEITEN.find((e) => e.name.toLowerCase() === klein || e.kurz.toLowerCase().replace(/\.$/, '') === klein || e.worte.includes(klein));
  if (treffer) return { code: treffer.code, text: roh === treffer.kurz || roh.toUpperCase() === treffer.code ? '' : roh, bekannt: true };
  return { code: 'C62', text: roh, bekannt: false };
}

/** Rechnungsarten (UNTDID 1001), die auch die XRechnung zulässt. */
export const ARTEN = {
  380: 'Rechnung',
  326: 'Teilrechnung',
  384: 'Korrekturrechnung',
  381: 'Gutschrift',
};

/**
 * Steuerfälle. kategorie ist die Umsatzsteuerkategorie der E-Rechnung
 * (UNCL 5305); null heißt: je Position nach Steuersatz (S oder Z).
 */
export const STEUERFAELLE = {
  standard: { name: 'Mit Umsatzsteuer', kategorie: null, grund: '' },
  kleinunternehmer: {
    name: 'Kleinunternehmer (§ 19 UStG)', kategorie: 'E', code: '',
    grund: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).',
  },
  reverseCharge: {
    name: 'Steuerschuld beim Kunden (§ 13b UStG)', kategorie: 'AE', code: 'VATEX-EU-AE',
    grund: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG).',
  },
  innergemeinschaftlich: {
    name: 'Innergemeinschaftliche Lieferung (EU)', kategorie: 'K', code: 'VATEX-EU-IC',
    grund: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG).',
  },
  ausfuhr: {
    name: 'Ausfuhr außerhalb der EU', kategorie: 'G', code: 'VATEX-EU-G',
    grund: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a UStG).',
  },
  steuerfrei: { name: 'Steuerfrei aus anderem Grund', kategorie: 'E', code: '', grund: '' },
};

/** Zahlungsarten (UNTDID 4461). */
export const ZAHLUNGSARTEN = {
  ueberweisung: { name: 'Überweisung', code: '58' },
  bar: { name: 'Bar', code: '10' },
  karte: { name: 'Karte', code: '48' },
  online: { name: 'Online-Zahlung (etwa PayPal)', code: '68' },
};

/** Länder für Anschriften (ISO 3166-1); eu: Mitglied der Europäischen Union. */
export const LAENDER = {
  DE: { name: 'Deutschland', eu: true }, AT: { name: 'Österreich', eu: true }, CH: { name: 'Schweiz', eu: false },
  BE: { name: 'Belgien', eu: true }, BG: { name: 'Bulgarien', eu: true }, CY: { name: 'Zypern', eu: true },
  CZ: { name: 'Tschechien', eu: true }, DK: { name: 'Dänemark', eu: true }, EE: { name: 'Estland', eu: true },
  ES: { name: 'Spanien', eu: true }, FI: { name: 'Finnland', eu: true }, FR: { name: 'Frankreich', eu: true },
  GR: { name: 'Griechenland', eu: true }, HR: { name: 'Kroatien', eu: true }, HU: { name: 'Ungarn', eu: true },
  IE: { name: 'Irland', eu: true }, IT: { name: 'Italien', eu: true }, LT: { name: 'Litauen', eu: true },
  LU: { name: 'Luxemburg', eu: true }, LV: { name: 'Lettland', eu: true }, MT: { name: 'Malta', eu: true },
  NL: { name: 'Niederlande', eu: true }, PL: { name: 'Polen', eu: true }, PT: { name: 'Portugal', eu: true },
  RO: { name: 'Rumänien', eu: true }, SE: { name: 'Schweden', eu: true }, SI: { name: 'Slowenien', eu: true },
  SK: { name: 'Slowakei', eu: true }, GB: { name: 'Vereinigtes Königreich', eu: false }, NO: { name: 'Norwegen', eu: false },
  LI: { name: 'Liechtenstein', eu: false }, US: { name: 'Vereinigte Staaten', eu: false }, TR: { name: 'Türkei', eu: false },
};

export const istEuLand = (code) => !!LAENDER[String(code || '').toUpperCase()]?.eu;

/** Für Auswahllisten: Deutschland, Österreich, Schweiz zuerst, danach alle übrigen nach dem Alphabet. */
export function laenderSortiert() {
  const vorn = ['DE', 'AT', 'CH'];
  const rest = Object.entries(LAENDER).filter(([c]) => !vorn.includes(c)).sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'));
  return [...vorn.map((c) => [c, LAENDER[c]]), ...rest];
}

/* -------------------------------------------------------------------------- */
/* Rechnungsprofil und Gestaltung (in den Einstellungen)                       */
/* -------------------------------------------------------------------------- */

export const PROFIL_VORGABE = {
  land: 'DE',
  iban: '',
  bic: '',
  bank: '',
  kontoinhaber: '',
  register: '',
  geschaeftsfuehrung: '',
  web: '',
  praefix: '',
  zahlungszielTage: 14,
  kopftext: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Wir berechnen Ihnen folgende Leistungen:',
  schlusstext: 'Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer.\nMit freundlichen Grüßen',
};

export const DESIGN_VORGABE = {
  layout: 'klassisch', // klassisch | modern | schlicht
  akzent: '#3446e0',
  logoId: '',
  logoBreite: 40, // mm
  logoPosition: 'rechts', // links | mitte | rechts
  bildId: '',
  bildBreite: 45, // mm
  bildPosition: 'schluss', // schluss | fuss
  schriftgroesse: 9.5,
  tabellenkopfFarbig: true,
  fusszeile: true,
  falzmarken: true,
  hinweisERechnung: true,
  girocode: true, // GiroCode (EPC-QR) bei Überweisung, siehe lib/girocode.js
  // Freie Gestaltung (Reiter Gestaltung): alles optional, leer heißt Standard.
  textfarbe: '#14181d',
  tabellenstil: 'auto', // auto | flaeche | linien | streifen | raster
  spalteNr: true,
  spalteEinheit: true, // aus: die Einheit steht in der Mengenspalte („3 Std.“)
  spalteSatz: true, // aus: nur möglich, solange die Rechnung einen einzigen Steuersatz hat
  spaltenTitel: {}, // { name: 'Leistung', … } eigene Spaltenüberschriften
  titelGroesse: 0, // 0 = nach Stil
  randLinks: 25, // mm
  randRechts: 20, // mm
  firmenkopf: true, // Firmenname im Kopf, wenn kein Logo da ist
  absenderzeile: true, // kleine Zeile über der Anschrift
  positionen: {}, // verschobene Bausteine in mm: { kopf:{x,y}, anschrift:{x,y}, info:{x,y}, inhalt:{y} }
  reihenfolge: ['kopftext', 'tabelle', 'hinweise', 'schlusstext', 'bilder', 'bild'],
  briefpapierId: '',
  briefpapierSeiten: 'alle', // erste | alle
  elemente: [], // eigene Bilder, Texte, Flächen und Linien (siehe ELEMENT_VORGABE)
};

/** Bausteine, die im Fluss untereinander stehen, in ihrer Standardreihenfolge. */
export const FLUSS_BAUSTEINE = {
  kopftext: 'Text vor den Positionen',
  tabelle: 'Positionen und Summen',
  hinweise: 'Zahlung, Bank und Steuerhinweise',
  schlusstext: 'Text am Ende',
  bilder: 'Bilder der Rechnung',
  bild: 'Zusätzliches Bild',
};

/** Vorgaben für eigene Elemente; Maße in mm, Ursprung oben links. */
export const ELEMENT_VORGABE = {
  text: { art: 'text', x: 25, y: 250, b: 80, text: 'Ihr Text', groesse: 10, fett: false, farbe: '#14181d', ausrichtung: 'links', seiten: 'erste' },
  bild: { art: 'bild', x: 140, y: 250, b: 40, bildId: '', seiten: 'erste' },
  flaeche: { art: 'flaeche', x: 0, y: 0, b: 6, h: 297, fuellung: '#3446e0', rand: '', staerke: 0.5, seiten: 'alle' },
  linie: { art: 'linie', x: 25, y: 100, b: 165, richtung: 'waagerecht', staerke: 0.8, farbe: '#3446e0', seiten: 'erste' },
};

/** Platzhalter in eigenen Texten: {nummer}, {datum}, {kunde} … */
export const PLATZHALTER = {
  nummer: 'Rechnungsnummer',
  datum: 'Rechnungsdatum',
  faellig: 'Fälligkeit',
  kunde: 'Name des Kunden',
  betrag: 'Gesamtbetrag',
  firma: 'Ihr Firmenname',
  seite: 'Seitenzahl',
};

export function profil(settings = {}) {
  return { ...PROFIL_VORGABE, ...(settings.rechnung?.profil || {}) };
}

export function design(settings = {}) {
  return designVoll(settings.rechnung?.design);
}

const HEX = /^#[0-9a-f]{6}$/i;
const zahlIn = (n, lo, hi, vorgabe) => (n === '' || n === null || n === undefined || !Number.isFinite(Number(n)) ? vorgabe : Math.min(hi, Math.max(lo, Number(n))));
const auswahlAus = (wert, erlaubt, vorgabe) => (erlaubt.includes(wert) ? wert : vorgabe);

/**
 * Eine gespeicherte Gestaltung mit allen Vorgaben ergänzt (auch die eingefrorene einer alten Rechnung).
 *
 * Außerdem bereinigt: Was nicht passt (eine leere Zahl, eine kaputte Farbe, ein
 * Rand, der die Seite zuschnürt), fällt auf einen brauchbaren Wert zurück. So
 * kann keine Gestaltung eine Rechnung unlesbar machen, egal wie sie entstanden
 * ist (Eingabe, Verlauf, ältere Fassung, Sicherung).
 */
export function designVoll(d = {}) {
  const x = { ...DESIGN_VORGABE, ...(d || {}) };
  // Neue Bausteine kommen an ihre Standardstelle, unbekannte fallen weg.
  const bekannt = Object.keys(FLUSS_BAUSTEINE);
  const eigen = (Array.isArray(x.reihenfolge) ? x.reihenfolge : []).filter((k, i, a) => bekannt.includes(k) && a.indexOf(k) === i);
  for (const k of bekannt) if (!eigen.includes(k)) eigen.splice(Math.min(bekannt.indexOf(k), eigen.length), 0, k);
  x.reihenfolge = eigen;
  x.spaltenTitel = x.spaltenTitel && typeof x.spaltenTitel === 'object' ? x.spaltenTitel : {};
  x.girocode = x.girocode !== false;

  x.layout = auswahlAus(x.layout, ['klassisch', 'modern', 'schlicht'], 'klassisch');
  x.tabellenstil = auswahlAus(x.tabellenstil, ['auto', 'flaeche', 'linien', 'streifen', 'raster'], 'auto');
  x.logoPosition = auswahlAus(x.logoPosition, ['links', 'mitte', 'rechts'], 'rechts');
  x.bildPosition = auswahlAus(x.bildPosition, ['schluss', 'fuss'], 'schluss');
  x.briefpapierSeiten = auswahlAus(x.briefpapierSeiten, ['erste', 'alle'], 'alle');
  x.akzent = HEX.test(String(x.akzent)) ? x.akzent : DESIGN_VORGABE.akzent;
  x.textfarbe = HEX.test(String(x.textfarbe)) ? x.textfarbe : DESIGN_VORGABE.textfarbe;
  x.schriftgroesse = zahlIn(x.schriftgroesse, 8, 11, 9.5);
  const tg = Number(x.titelGroesse);
  x.titelGroesse = Number.isFinite(tg) && tg > 0 ? zahlIn(tg, 10, 30, 0) : 0;
  x.logoBreite = zahlIn(x.logoBreite, 10, 80, 40);
  x.bildBreite = zahlIn(x.bildBreite, 10, 120, 45);
  // Die Ränder lassen immer mindestens 140 mm für die Tabelle.
  let rl = zahlIn(x.randLinks, 8, 45, 25);
  let rr = zahlIn(x.randRechts, 8, 45, 20);
  if (rl + rr > 70) { const f = 70 / (rl + rr); rl = Math.max(8, rl * f); rr = Math.max(8, rr * f); }
  x.randLinks = Math.round(rl * 2) / 2;
  x.randRechts = Math.round(rr * 2) / 2;

  // Verschobene Bausteine: nur bekannte, nur Zahlen.
  const pos = x.positionen && typeof x.positionen === 'object' ? x.positionen : {};
  x.positionen = {};
  for (const key of ['kopf', 'anschrift', 'info']) {
    const p = pos[key];
    if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) && p.x !== '' && p.y !== '') x.positionen[key] = { x: Number(p.x), y: Number(p.y) };
  }
  if (pos.inhalt && Number.isFinite(Number(pos.inhalt.y)) && pos.inhalt.y !== '') x.positionen.inhalt = { y: Number(pos.inhalt.y) };

  x.elemente = (Array.isArray(x.elemente) ? x.elemente : []).filter((e) => e && ELEMENT_VORGABE[e.art]).map((e) => {
    const v = ELEMENT_VORGABE[e.art];
    const out = { ...v, ...e };
    out.seiten = auswahlAus(out.seiten, ['erste', 'alle'], 'erste');
    out.x = zahlIn(out.x, -50, 260, v.x);
    out.y = zahlIn(out.y, -50, 350, v.y);
    out.b = zahlIn(out.b, 0.5, 297, v.b);
    if (e.art === 'flaeche') out.h = zahlIn(out.h, 0.5, 297, v.h);
    if (e.art === 'text') { out.groesse = zahlIn(out.groesse, 5, 60, v.groesse); out.text = String(out.text ?? ''); out.ausrichtung = auswahlAus(out.ausrichtung, ['links', 'mitte', 'rechts'], 'links'); }
    if (e.art === 'linie') { out.staerke = zahlIn(out.staerke, 0.1, 10, v.staerke); out.richtung = auswahlAus(out.richtung, ['waagerecht', 'senkrecht'], 'waagerecht'); }
    for (const f of ['farbe', 'fuellung', 'rand']) if (out[f] && !HEX.test(String(out[f]))) out[f] = f === 'farbe' ? v.farbe || '' : '';
    return out;
  });
  return x;
}

/** Der eigene Betrieb als Verkäufer einer Rechnung. */
export function verkaeuferAus(settings = {}) {
  const p = profil(settings);
  const name = String(settings.companyName || settings.ownerName || '').trim();
  return {
    name,
    inhaber: String(settings.ownerName || '').trim(),
    strasse: String(settings.street || '').trim(),
    plz: String(settings.zip || '').trim(),
    ort: String(settings.city || '').trim(),
    land: p.land || 'DE',
    ustId: String(settings.vatId || '').replace(/\s/g, '').toUpperCase(),
    steuernummer: String(settings.taxNumber || '').trim(),
    email: String(settings.email || '').trim(),
    telefon: String(settings.phone || '').trim(),
    iban: String(p.iban || '').replace(/\s/g, '').toUpperCase(),
    bic: String(p.bic || '').replace(/\s/g, '').toUpperCase(),
    bank: String(p.bank || '').trim(),
    kontoinhaber: String(p.kontoinhaber || '').trim() || name,
    register: String(p.register || '').trim(),
    geschaeftsfuehrung: String(p.geschaeftsfuehrung || '').trim(),
    web: String(p.web || '').trim(),
    kleinunternehmer: settings.taxMode === 'kleinunternehmer',
  };
}

/* -------------------------------------------------------------------------- */
/* Entwürfe                                                                    */
/* -------------------------------------------------------------------------- */

export function neuePosition(settings = {}, vorgabe = {}) {
  return {
    id: uid('pos'),
    produktId: '',
    artikelnummer: '',
    name: '',
    beschreibung: '',
    menge: 1,
    einheit: 'C62',
    einheitText: '',
    preis: 0, // Cent, netto je Einheit
    satz: settings.taxMode === 'kleinunternehmer' ? 0 : Number(settings.defaultVatRate ?? 19),
    ...vorgabe,
  };
}

export function leererKaeufer() {
  return {
    kontaktId: '', name: '', zusatz: '', strasse: '', plz: '', ort: '', land: 'DE',
    ustId: '', email: '', leitwegId: '', kundennummer: '',
  };
}

export function neueRechnung(settings = {}, vorgabe = {}) {
  const p = profil(settings);
  const heute = todayISO();
  const jetzt = new Date().toISOString();
  return {
    id: uid('re'),
    richtung: 'ausgang',
    status: 'entwurf', // entwurf | ausgestellt
    art: '380',
    storno: false,
    nummer: '',
    datum: heute,
    leistungArt: 'datum', // datum | zeitraum
    leistungsdatum: heute,
    leistungVon: '',
    leistungBis: '',
    zahlungszielTage: Number(p.zahlungszielTage) || 0,
    faellig: '',
    waehrung: 'EUR',
    steuerfall: settings.taxMode === 'kleinunternehmer' ? 'kleinunternehmer' : 'standard',
    befreiungsgrund: '',
    kaeufer: leererKaeufer(),
    betreff: '',
    bestellnummer: '',
    kopftext: p.kopftext,
    schlusstext: p.schlusstext,
    zahlungsart: 'ueberweisung',
    zahlungsbedingungen: '',
    skontoTage: 0,
    skontoProzent: 0,
    bereitsGezahlt: 0,
    // § 14 Abs. 4 Nr. 9 UStG: Leistung an einem Grundstück für eine Privatperson
    hinweisAufbewahrung: false,
    bilder: [], // Bilder, die auf dieser Rechnung stehen: { id, bildId, breite (mm), text }
    positionen: [neuePosition(settings)],
    bezug: null, // { id, nummer, datum } bei Korrektur, Gutschrift und Storno
    transactionIds: [],
    dateien: null, // { xml, pdf } Belegkennungen, ab dem Ausstellen
    versand: [],
    createdAt: jetzt,
    updatedAt: jetzt,
    ...vorgabe,
  };
}

/** Eine Position ohne jeden Inhalt zählt nicht (etwa die leere letzte Zeile). */
export const positionLeer = (p) => !String(p?.name || '').trim() && !String(p?.beschreibung || '').trim() && !Number(p?.preis);

/* -------------------------------------------------------------------------- */
/* Rechnen                                                                     */
/* -------------------------------------------------------------------------- */

/** Kaufmännisch runden, für negative Beträge spiegelbildlich (Storno = −Original). */
export function rund(x) {
  const n = Number(x) || 0;
  return Math.sign(n) * Math.round(Number(Math.abs(n).toFixed(6)));
}

/** Menge auf höchstens vier Nachkommastellen. */
export const menge4 = (m) => Math.sign(Number(m) || 0) * Math.round(Math.abs(Number(m) || 0) * 10000) / 10000;

/**
 * Rechnet eine Rechnung nach den Regeln der EN 16931: Positionsbetrag =
 * Menge × Preis (gerundet auf Cent), Steuer je Kategorie und Satz aus der
 * Summe ihrer Positionen (BR-CO-17), Gesamt = Netto + Steuer (BR-CO-15).
 */
export function berechnen(r) {
  const fall = STEUERFAELLE[r?.steuerfall] || STEUERFAELLE.standard;
  const grund = fall.kategorie ? (r.steuerfall === 'steuerfrei' ? String(r.befreiungsgrund || '').trim() : fall.grund) : '';
  const zeilen = (r?.positionen || []).filter((p) => !positionLeer(p)).map((p, i) => {
    const menge = menge4(p.menge);
    const preis = Math.round(Number(p.preis) || 0);
    const satz = fall.kategorie ? 0 : Number(p.satz) || 0;
    return {
      ...p,
      nr: i + 1,
      menge,
      preis,
      netto: rund(menge * preis),
      satz,
      kategorie: fall.kategorie || (satz > 0 ? 'S' : 'Z'),
    };
  });
  const gruppen = new Map();
  for (const z of zeilen) {
    const key = `${z.kategorie}|${z.satz}`;
    if (!gruppen.has(key)) gruppen.set(key, { kategorie: z.kategorie, satz: z.satz, basis: 0, steuer: 0, grund: '', code: '' });
    gruppen.get(key).basis += z.netto;
  }
  const steuern = [...gruppen.values()].sort((a, b) => b.satz - a.satz || a.kategorie.localeCompare(b.kategorie)).map((g) => ({
    ...g,
    steuer: rund((g.basis * g.satz) / 100),
    grund: g.kategorie === 'S' || g.kategorie === 'Z' ? '' : grund,
    code: g.kategorie === 'S' || g.kategorie === 'Z' ? '' : (fall.code || ''),
  }));
  const netto = zeilen.reduce((s, z) => s + z.netto, 0);
  const steuer = steuern.reduce((s, g) => s + g.steuer, 0);
  const brutto = netto + steuer;
  const bereitsGezahlt = Math.round(Number(r?.bereitsGezahlt) || 0);
  return { zeilen, steuern, netto, steuer, brutto, bereitsGezahlt, zahlbetrag: brutto - bereitsGezahlt, grund };
}

/** Teilt einen Betrag im Verhältnis der Gewichte auf (Rest auf den letzten). */
export function aufteilen(gesamt, gewichte) {
  const summe = gewichte.reduce((a, b) => a + b, 0);
  if (!summe) return gewichte.map((_, i) => (i === gewichte.length - 1 ? gesamt : 0));
  let rest = gesamt;
  return gewichte.map((g, i) => {
    if (i === gewichte.length - 1) return rest;
    const teil = Math.round((gesamt * g) / summe);
    rest -= teil;
    return teil;
  });
}

/**
 * Bereits gezahlte Beträge (Anzahlungen) je Steuersatz, anteilig zum
 * Bruttobetrag. Eine Schlussrechnung muss die Anzahlungen samt der darauf
 * entfallenden Steuer absetzen (§ 14 Abs. 5 Satz 2 UStG), sonst schuldet
 * der Betrieb die Steuer doppelt (§ 14c UStG).
 * @returns {Array<{kategorie:string, satz:number, brutto:number, netto:number, steuer:number}>}
 */
export function anzahlungTeile(b) {
  if (!b?.bereitsGezahlt || !b.steuern.length) return [];
  const teile = aufteilen(b.bereitsGezahlt, b.steuern.map((g) => g.basis + g.steuer));
  return b.steuern.map((g, i) => {
    const brutto = teile[i];
    const netto = g.satz ? rund(brutto / (1 + g.satz / 100)) : brutto;
    return { kategorie: g.kategorie, satz: g.satz, brutto, netto, steuer: brutto - netto };
  });
}

/** Hinweis nach § 14 Abs. 4 Nr. 9 UStG (Leistung an einem Grundstück für Privatpersonen). */
export const AUFBEWAHRUNG_TEXT = 'Sie sind gesetzlich verpflichtet, diese Rechnung zwei Jahre lang aufzubewahren (§ 14b Abs. 1 Satz 5 UStG).';

/** Eine Gutschrift an den Kunden: Geld fließt zu ihm, nicht zu uns. */
export const istGutschrift = (r) => String(r?.art) === '381';

/** Fälligkeit: von Hand gesetzt oder Rechnungsdatum plus Zahlungsziel. */
export function faelligkeit(r) {
  if (r?.faellig) return r.faellig;
  const tage = Number(r?.zahlungszielTage);
  if (!r?.datum || !Number.isFinite(tage) || tage < 0) return '';
  return addDays(r.datum, tage);
}

/** Text der Zahlungsbedingungen, wie er auf PDF und in der XML steht. */
export function zahlungsText(r, { mitDatum = true } = {}) {
  const eigen = String(r?.zahlungsbedingungen || '').trim();
  if (eigen) return eigen;
  if (istGutschrift(r)) return 'Den Betrag überweisen wir Ihnen oder verrechnen ihn mit offenen Rechnungen.';
  const teile = [];
  const f = faelligkeit(r);
  const tage = Number(r?.zahlungszielTage) || 0;
  const d = (iso) => iso.split('-').reverse().join('.');
  if (Number(r?.skontoTage) > 0 && Number(r?.skontoProzent) > 0) {
    const bis = r.datum ? addDays(r.datum, Number(r.skontoTage)) : '';
    teile.push(`Bei Zahlung innerhalb von ${r.skontoTage} Tagen${bis && mitDatum ? ` (bis ${d(bis)})` : ''} gewähren wir ${String(r.skontoProzent).replace('.', ',')} % Skonto.`);
  }
  if (r?.zahlungsart === 'bar') teile.unshift('Der Betrag wurde bar bezahlt.');
  else if (tage === 0 && f === r?.datum) teile.unshift('Zahlbar sofort ohne Abzug.');
  else if (f) teile.unshift(`Zahlbar ohne Abzug bis zum ${mitDatum ? d(f) : `${tage}. Tag nach Rechnungsdatum`}.`);
  return teile.join(' ');
}

/** Titel einer Rechnung: „Rechnung“, „Stornorechnung“, „Gutschrift“ … */
export function titel(r) {
  if (r?.storno) return 'Stornorechnung';
  return ARTEN[r?.art] || 'Rechnung';
}

/* -------------------------------------------------------------------------- */
/* Prüfen                                                                      */
/* -------------------------------------------------------------------------- */

/** IBAN prüfen (Länge und Prüfziffer nach ISO 13616). */
export function ibanGueltig(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith('DE') && s.length !== 22) return false;
  const umgestellt = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of umgestellt) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

const leer = (v) => !String(v ?? '').trim();
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

/**
 * Prüft eine Rechnung auf Pflichtangaben. Gespeichert und ausgestellt werden
 * darf sie trotzdem; die Liste sagt nur, was fehlt.
 *
 * stufe: 'pflicht'  gesetzlich vorgeschrieben (§ 14 UStG) oder für eine
 *                   gültige E-Rechnung nötig (EN 16931)
 *        'xrechnung' nur für die XRechnung (öffentliche Auftraggeber)
 *        'hinweis'  empfohlen oder ungewöhnlich
 * bereich: wo es nachzutragen ist (kaeufer, positionen, rechnung, zahlung,
 *          verkaeufer = Rechnungsdaten des eigenen Betriebs)
 *
 * @param {object} r Rechnung
 * @param {object} v Verkäufer (verkaeuferAus)
 * @param {{nummern?:Set<string>}} opts  vergebene Nummern anderer Rechnungen
 * @returns {Array<{stufe:string, bereich:string, feld:string, text:string}>}
 */
export function pruefen(r, v, { nummern = null } = {}) {
  const out = [];
  const add = (stufe, bereich, feld, text) => out.push({ stufe, bereich, feld, text });
  const k = r?.kaeufer || {};
  const fall = STEUERFAELLE[r?.steuerfall] || STEUERFAELLE.standard;
  const b = berechnen(r);

  // Der eigene Betrieb (§ 14 Abs. 4 Nr. 1 und 2 UStG, BR-6, BR-8, BR-9)
  if (leer(v?.name)) add('pflicht', 'verkaeufer', 'name', 'Name Ihres Betriebs fehlt.');
  if (leer(v?.strasse) || leer(v?.plz) || leer(v?.ort)) add('pflicht', 'verkaeufer', 'anschrift', 'Anschrift Ihres Betriebs ist unvollständig (Straße, PLZ, Ort).');
  if (leer(v?.ustId) && leer(v?.steuernummer)) add('pflicht', 'verkaeufer', 'steuer', 'Steuernummer oder USt-IdNr. Ihres Betriebs fehlt.');
  // Ohne Länderkürzel weist jede Prüfung die E-Rechnung ab (BR-CO-9).
  if (v?.ustId && !/^[A-Z]{2}/i.test(v.ustId)) add('pflicht', 'verkaeufer', 'ustId', 'Ihre USt-IdNr. muss mit dem Länderkürzel beginnen, etwa „DE“.');
  else if (v?.ustId && ustIdHinweis(v.ustId)) add('hinweis', 'verkaeufer', 'ustId', `Ihre USt-IdNr.: ${ustIdHinweis(v.ustId)}`);
  if (['AE', 'K', 'G'].includes(fall.kategorie) && leer(v?.ustId)) add('pflicht', 'verkaeufer', 'ustId', `Für „${fall.name}“ braucht es Ihre USt-IdNr.`);
  if (leer(v?.email)) add('xrechnung', 'verkaeufer', 'email', 'E-Mail-Adresse Ihres Betriebs fehlt.');
  if (leer(v?.telefon)) add('xrechnung', 'verkaeufer', 'telefon', 'Telefonnummer Ihres Betriebs fehlt.');
  if (leer(v?.inhaber) && leer(v?.name)) add('xrechnung', 'verkaeufer', 'kontakt', 'Ansprechpartner fehlt.');

  // Kunde (§ 14 Abs. 4 Nr. 1 UStG, BR-7, BR-10, BR-11)
  if (leer(k.name)) add('pflicht', 'kaeufer', 'name', 'Name des Kunden fehlt.');
  if (leer(k.strasse)) add('pflicht', 'kaeufer', 'strasse', 'Straße des Kunden fehlt.');
  if (leer(k.plz) || leer(k.ort)) add('pflicht', 'kaeufer', 'ort', 'PLZ und Ort des Kunden fehlen.');
  if (leer(k.land)) add('pflicht', 'kaeufer', 'land', 'Land des Kunden fehlt.');
  if (!leer(k.email) && !emailOk(k.email)) add('hinweis', 'kaeufer', 'email', 'Die E-Mail-Adresse des Kunden sieht unvollständig aus.');
  if (leer(k.email)) add('xrechnung', 'kaeufer', 'email', 'E-Mail-Adresse des Kunden fehlt.');
  if (leer(k.leitwegId)) add('xrechnung', 'kaeufer', 'leitwegId', 'Leitweg-ID des Kunden fehlt (bei Behörden Pflicht).');
  if (k.ustId && !/^\s*[A-Z]{2}/i.test(k.ustId)) add('pflicht', 'kaeufer', 'ustId', 'Die USt-IdNr. des Kunden muss mit dem Länderkürzel beginnen, etwa „DE“.');
  else if (k.ustId && ustIdHinweis(k.ustId)) add('hinweis', 'kaeufer', 'ustId', `USt-IdNr. des Kunden: ${ustIdHinweis(k.ustId)}`);

  // Rechnung (§ 14 Abs. 4 Nr. 3, 4 und 6 UStG)
  if (leer(r?.datum)) add('pflicht', 'rechnung', 'datum', 'Rechnungsdatum fehlt.');
  if (r?.leistungArt === 'zeitraum') {
    if (leer(r.leistungVon) || leer(r.leistungBis)) add('pflicht', 'rechnung', 'leistung', 'Leistungszeitraum ist unvollständig.');
    else if (r.leistungVon > r.leistungBis) add('pflicht', 'rechnung', 'leistung', 'Der Leistungszeitraum endet vor seinem Beginn.');
  } else if (leer(r?.leistungsdatum)) add('pflicht', 'rechnung', 'leistung', 'Leistungsdatum fehlt.');
  const nr = String(r?.nummer || '').trim();
  if (nr && nummern?.has(nr)) add('pflicht', 'rechnung', 'nummer', `Die Rechnungsnummer ${nr} ist schon vergeben.`);
  if ((r?.art === '384' || r?.art === '381' || r?.storno) && leer(r?.bezug?.nummer)) {
    add('hinweis', 'rechnung', 'bezug', 'Bei einer Korrektur oder Gutschrift sollte die ursprüngliche Rechnung angegeben sein.');
  }

  // Positionen (§ 14 Abs. 4 Nr. 5, 7, 8 UStG, BR-16, BR-21 ff.)
  if (!b.zeilen.length) add('pflicht', 'positionen', 'positionen', 'Die Rechnung hat noch keine Position.');
  b.zeilen.forEach((z) => {
    if (leer(z.name)) add('pflicht', 'positionen', `pos-${z.id}`, `Position ${z.nr}: Bezeichnung fehlt.`);
    if (!z.menge) add('pflicht', 'positionen', `pos-${z.id}`, `Position ${z.nr}: Menge fehlt.`);
    if (z.preis < 0) add('hinweis', 'positionen', `pos-${z.id}`, `Position ${z.nr}: negativer Preis. Für Nachlässe ist eine negative Menge üblicher.`);
    if (einheitAusText(z.einheitText).bekannt === false && z.einheit === 'C62') {
      add('hinweis', 'positionen', `pos-${z.id}`, `Position ${z.nr}: Die Einheit „${z.einheitText}“ steht in der E-Rechnung als Stück.`);
    }
    if (!fall.kategorie && ![0, 7, 19].includes(z.satz)) add('hinweis', 'positionen', `pos-${z.id}`, `Position ${z.nr}: ungewöhnlicher Steuersatz ${z.satz} %.`);
  });

  // Steuerfall
  if (r?.steuerfall === 'standard' && v?.kleinunternehmer) add('hinweis', 'rechnung', 'steuerfall', 'Sie sind als Kleinunternehmer eingestellt, die Rechnung weist aber Umsatzsteuer aus.');
  if (r?.steuerfall === 'kleinunternehmer' && v && !v.kleinunternehmer) add('hinweis', 'rechnung', 'steuerfall', 'Die Rechnung ist als Kleinunternehmer-Rechnung angelegt, Ihre Einstellungen sagen Regelbesteuerung.');
  if (r?.steuerfall === 'steuerfrei' && leer(r.befreiungsgrund)) add('pflicht', 'rechnung', 'befreiungsgrund', 'Bei einer steuerfreien Leistung muss der Grund auf der Rechnung stehen.');
  if (r?.steuerfall === 'reverseCharge' && leer(k.ustId)) add('pflicht', 'kaeufer', 'ustId', 'Bei Steuerschuld des Kunden braucht es seine USt-IdNr.');
  if (r?.steuerfall === 'innergemeinschaftlich') {
    if (leer(k.ustId)) add('pflicht', 'kaeufer', 'ustId', 'Für eine innergemeinschaftliche Lieferung braucht es die USt-IdNr. des Kunden.');
    if (!istEuLand(k.land) || k.land === (v?.land || 'DE')) add('pflicht', 'kaeufer', 'land', 'Eine innergemeinschaftliche Lieferung geht in ein anderes EU-Land.');
  }
  if (r?.steuerfall === 'ausfuhr' && istEuLand(k.land)) add('pflicht', 'kaeufer', 'land', 'Eine Ausfuhrlieferung geht in ein Land außerhalb der EU.');

  // Zahlung (BR-61, BR-DE-1, BR-CO-25)
  if (r?.zahlungsart === 'ueberweisung' && b.zahlbetrag > 0 && !istGutschrift(r)) {
    if (leer(v?.iban)) add('pflicht', 'verkaeufer', 'iban', 'Für die Zahlung per Überweisung fehlt Ihre IBAN.');
    else if (!ibanGueltig(v.iban)) add('pflicht', 'verkaeufer', 'iban', 'Ihre IBAN ist ungültig. Bitte auf Zahlendreher prüfen.');
  }
  if (b.zahlbetrag > 0 && !istGutschrift(r) && !faelligkeit(r) && leer(r?.zahlungsbedingungen)) add('pflicht', 'zahlung', 'faellig', 'Fälligkeit oder Zahlungsbedingungen fehlen.');
  if (Number(r?.skontoProzent) > 0 && !(Number(r?.skontoTage) > 0)) add('hinweis', 'zahlung', 'skonto', 'Für das Skonto fehlt die Frist in Tagen.');
  if (b.bereitsGezahlt > b.brutto && b.brutto > 0) add('hinweis', 'zahlung', 'bereitsGezahlt', 'Es ist mehr bezahlt, als die Rechnung ausmacht.');
  if (istGutschrift(r) && b.bereitsGezahlt) add('hinweis', 'zahlung', 'bereitsGezahlt', 'Eine Gutschrift hat normalerweise keine Anzahlung.');
  return out;
}

/** Fehlt nichts, was Gesetz oder Norm verlangen? (Hinweise und XRechnung zählen nicht.) */
export const vollstaendig = (liste) => !liste.some((x) => x.stufe === 'pflicht');

/* -------------------------------------------------------------------------- */
/* Anschriften aus freiem Text                                                 */
/* -------------------------------------------------------------------------- */

const LAND_NAMEN = new Map(Object.entries(LAENDER).flatMap(([code, l]) => [[l.name.toLowerCase(), code], [code.toLowerCase(), code]]));
LAND_NAMEN.set('germany', 'DE'); LAND_NAMEN.set('austria', 'AT'); LAND_NAMEN.set('switzerland', 'CH');
LAND_NAMEN.set('deutschland', 'DE'); LAND_NAMEN.set('österreich', 'AT');

/**
 * Zerlegt eine eingefügte Anschrift („Muster GmbH\nz. Hd. Frau Beispiel\n
 * Hauptstr. 1\n12345 Musterstadt“) in Felder. Was sich nicht zuordnen lässt,
 * landet im Zusatz; nichts geht verloren.
 */
export function anschriftAusText(text) {
  // Zeilen, und innerhalb einer Zeile die Teile zwischen Kommas („Hauptstr. 1, 12345 Ort“).
  const zeilen = String(text ?? '').split(/\r?\n|;/).flatMap((z) => z.split(/,\s+/)).map((z) => z.trim()).filter(Boolean);
  const out = { name: '', zusatz: '', strasse: '', plz: '', ort: '', land: '', email: '', ustId: '' };
  const rest = [];
  for (const z of zeilen) {
    const klein = z.toLowerCase();
    let m;
    if (!out.email && (m = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i.exec(z))) { out.email = m[0]; continue; }
    if (!out.ustId && (m = /\b(?:USt-?Id(?:Nr)?\.?:?\s*)?([A-Z]{2}\s?\d[\d\s]{7,12})\b/.exec(z)) && /ust|vat|^[A-Z]{2}\s?\d/i.test(z)) {
      out.ustId = m[1].replace(/\s/g, ''); continue;
    }
    if (!out.land && LAND_NAMEN.has(klein)) { out.land = LAND_NAMEN.get(klein); continue; }
    if (!out.plz && (m = /^(?:([A-Z]{1,2})[-\s])?(\d{4,5})\s+(.+)$/.exec(z))) {
      out.plz = m[2];
      out.ort = m[3];
      if (m[1] && LAND_NAMEN.has(m[1].toLowerCase())) out.land = LAND_NAMEN.get(m[1].toLowerCase());
      else if (m[1] === 'A') out.land = 'AT';
      else if (m[2].length === 4 && !out.land) out.land = '';
      continue;
    }
    if (!out.strasse && /\d/.test(z) && /(str\.?|straße|strasse|weg|allee|platz|gasse|ring|damm|ufer|chaussee|markt|hof|\d+\s?[a-z]?$)/i.test(z) && rest.length) {
      out.strasse = z; continue;
    }
    if (/^postfach\b/i.test(z) && !out.strasse) { out.strasse = z; continue; }
    rest.push(z);
  }
  out.name = rest.shift() || '';
  out.zusatz = rest.join(', ');
  if (!out.land && out.plz) out.land = out.plz.length === 5 ? 'DE' : '';
  return out;
}

/** Felder eines Kontakts → Kunde einer Rechnung (mit Rückgriff auf die freie Anschrift). */
export function kaeuferAusKontakt(c) {
  if (!c) return leererKaeufer();
  const frei = anschriftAusText(`${c.name || ''}\n${c.address || ''}`);
  const tax = String(c.taxId || '').replace(/\s/g, '').toUpperCase();
  return {
    kontaktId: c.id,
    name: c.name || '',
    zusatz: c.addressExtra ?? (c.street ? '' : frei.zusatz),
    strasse: c.street || frei.strasse,
    plz: c.zip || frei.plz,
    ort: c.city || frei.ort,
    land: c.country || frei.land || 'DE',
    ustId: c.vatId || (/^[A-Z]{2}\d/.test(tax) ? tax : '') || frei.ustId,
    email: c.email || frei.email,
    leitwegId: c.buyerReference || '',
    kundennummer: c.customerNumber || '',
  };
}

/* -------------------------------------------------------------------------- */
/* Anzeige                                                                     */
/* -------------------------------------------------------------------------- */

/** Menge deutsch: 1,5 statt 1.5, ohne überflüssige Nullen. */
export function mengeText(m) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(Number(m) || 0);
}

/** Betrag mit Währung, „1.234,56 €“. */
export function betragText(cent, waehrung = 'EUR') {
  return `${money(cent)} ${waehrung === 'EUR' ? '€' : waehrung}`;
}

/** Satz deutsch: „19 %“, „7 %“, „5,5 %“. */
export const satzText = (s) => `${String(Number(s) || 0).replace('.', ',')} %`;

/**
 * Stand einer ausgehenden Rechnung für Liste und Filter.
 * entwurf | offen | ueberfaellig | bezahlt | storniert
 */
export function zustand(r, { buchungen = [], heute = todayISO(), storniert = false } = {}) {
  if (r.status !== 'ausgestellt') return 'entwurf';
  if (storniert || r.storniertDurch) return 'storniert';
  if (r.storno) return 'storno';
  const b = berechnen(r);
  if (b.zahlbetrag <= 0) return 'bezahlt';
  const live = buchungen.filter((t) => t && !t.voided);
  if (live.length && live.every((t) => !!t.paidDate)) return 'bezahlt';
  if (r.bezahltAm) return 'bezahlt';
  const f = faelligkeit(r);
  return f && f < heute ? 'ueberfaellig' : 'offen';
}

export const ZUSTAENDE = {
  entwurf: { name: 'Entwurf', ton: 'plain' },
  offen: { name: 'Offen', ton: 'info' },
  ueberfaellig: { name: 'Überfällig', ton: 'warn' },
  bezahlt: { name: 'Bezahlt', ton: 'pos' },
  storniert: { name: 'Storniert', ton: 'plain' },
  storno: { name: 'Storno', ton: 'plain' },
};
