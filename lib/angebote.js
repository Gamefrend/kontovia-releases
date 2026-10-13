/**
 * Kontovia – Angebote, Auftragsbestätigungen und Lieferscheine: Aufbau, Nummern, Zustand, Umwandeln.
 *
 * Die drei Belegarten haben dieselbe Form wie eine Rechnung (lib/rechnung.js: neueRechnung), damit Editor,
 * Vorschau und Druck (lib/rechnungsdruck.js) sie ohne eigene Wege darstellen. Unterschieden werden sie am Feld
 * `belegart`. Sie liegen in einer eigenen Sammlung (`angebote`, Id-Präfix `an_`), nie bei den Rechnungen: Sie
 * sind keine Rechnungen im Sinn des § 14 UStG, zählen nicht in Umsatzsteuer, EÜR, Mahnwesen oder offene Posten
 * und erzeugen keine Buchung und keine E-Rechnung. Beim Ausstellen bekommen sie eine Nummer (eigener Kreis je Art,
 * etwa AN-2026-0001) und ein PDF, das ab dann feststeht.
 *
 * Ablauf: Angebot → (angenommen) → Auftragsbestätigung → Lieferschein und/oder Rechnung. Jeder Folgebeleg merkt
 * sich seine Quelle (`bezug`), die Quelle ihre Folgebelege (`folge`).
 *
 * Diese Datei kennt keine Oberfläche und keinen Speicher (läuft in den Prüfungen).
 */

import { uid, todayISO, addDays } from './util.js';
import { neueRechnung, neuePosition } from './rechnung.js';

/** Die Belegarten mit Titel, Nummernkreis und Standardtexten (Englisch: dokumenttexte.js, STANDARD_EN). */
export const BELEGARTEN = {
  angebot: {
    titel: 'Angebot', mehrzahl: 'Angebote', praefix: 'AN-',
    kopftext: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:',
    schlusstext: 'Wir freuen uns auf Ihren Auftrag. Bei Fragen sind wir gern für Sie da.\nMit freundlichen Grüßen',
  },
  auftrag: {
    titel: 'Auftragsbestätigung', mehrzahl: 'Auftragsbestätigungen', praefix: 'AB-',
    kopftext: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Wir bestätigen ihn wie folgt:',
    schlusstext: 'Die Rechnung erhalten Sie nach Erbringung der Leistung.\nMit freundlichen Grüßen',
  },
  lieferschein: {
    titel: 'Lieferschein', mehrzahl: 'Lieferscheine', praefix: 'LS-',
    kopftext: 'Sehr geehrte Damen und Herren,\n\nwir liefern Ihnen:',
    schlusstext: 'Ware vollständig und unbeschädigt erhalten:\n\n\n______________________________\nDatum, Unterschrift',
  },
};

/** Ist das ein Angebot, eine Auftragsbestätigung oder ein Lieferschein (und keine Rechnung)? */
export const istBeleg = (r) => Object.hasOwn(BELEGARTEN, String(r?.belegart || ''));

/** So lange gilt ein neues Angebot, wenn nichts anderes eingestellt ist. */
export const GUELTIG_TAGE = 30;

/**
 * Ein neuer Entwurf. Die Felder der Rechnung bleiben (gleiche Form), was nur zur Rechnung gehört, ist leer.
 * @param {string} belegart  angebot | auftrag | lieferschein
 */
export function neuerBeleg(settings = {}, belegart = 'angebot', vorgabe = {}) {
  const art = BELEGARTEN[belegart] ? belegart : 'angebot';
  const heute = todayISO();
  const b = neueRechnung(settings, {
    id: uid('an'),
    belegart: art,
    ergebnis: '', // nur Angebot: '' (offen) | angenommen | abgelehnt
    ergebnisAm: '',
    gueltigBis: art === 'angebot' ? addDays(heute, GUELTIG_TAGE) : '',
    kopftext: BELEGARTEN[art].kopftext,
    schlusstext: BELEGARTEN[art].schlusstext,
    folge: [], // [{ id, belegart | 'rechnung', nummer }]
    raten: null,
    wiederholung: null,
    bereitsGezahlt: 0,
    zahlungszielTage: 0,
    ...vorgabe,
  });
  delete b.transactionIds;
  return b;
}

/**
 * Nächste Nummer im Kreis der Belegart: AN-2026-0001, eins über der höchsten dieses Jahres.
 * Wie bei den Rechnungen aus dem Bestand gerechnet, damit zwei abgeglichene Geräte dieselbe Folge sehen.
 */
export function naechsteNummer(liste, belegart, jahr = new Date().getFullYear()) {
  const p = (BELEGARTEN[belegart] || BELEGARTEN.angebot).praefix;
  const muster = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${jahr}-(\\d{1,6})$`);
  let hoechste = 0;
  for (const b of liste || []) {
    if (b?.belegart !== belegart) continue;
    const m = muster.exec(String(b.nummer || '').trim());
    if (m) hoechste = Math.max(hoechste, Number(m[1]));
  }
  return `${p}${jahr}-${String(hoechste + 1).padStart(4, '0')}`;
}

/** Felder, die beim Umwandeln mitgehen (Kunde, Inhalt, Texte bleiben; Nummer, Datum und Dateien entstehen neu). */
const MITNEHMEN = ['kaeufer', 'betreff', 'bestellnummer', 'steuerfall', 'befreiungsgrund', 'sprache', 'waehrung', 'leistungArt',
  'leistungsdatum', 'leistungVon', 'leistungBis', 'bilder', 'projektId'];

function uebernehmen(ziel, quelle) {
  for (const f of MITNEHMEN) if (quelle[f] !== undefined) ziel[f] = structuredClone(quelle[f]);
  ziel.positionen = (quelle.positionen || []).map((p) => ({ ...structuredClone(p), id: uid('pos') }));
  return ziel;
}

/** Ein Folgebeleg aus einem Beleg (Angebot → Auftragsbestätigung, Auftragsbestätigung → Lieferschein). */
export function belegAusBeleg(quelle, belegart, settings = {}) {
  const b = uebernehmen(neuerBeleg(settings, belegart), quelle);
  if (!b.positionen.length) b.positionen = [neuePosition(settings)];
  b.bezug = { id: quelle.id, nummer: quelle.nummer || '', datum: quelle.datum || '', belegart: quelle.belegart };
  if (belegart === 'lieferschein' && b.leistungArt !== 'zeitraum') b.leistungsdatum = todayISO();
  return b;
}

/**
 * Ein Rechnungsentwurf aus einem Beleg. Die Rechnung bekommt Kunde, Positionen und Steuerfall, dazu den Verweis
 * `ausBeleg`; Texte und Zahlungsangaben kommen aus den Voreinstellungen der Rechnung.
 */
export function rechnungAusBeleg(quelle, settings = {}) {
  const r = uebernehmen(neueRechnung(settings), quelle);
  if (!r.positionen.length) r.positionen = [neuePosition(settings)];
  if (r.leistungArt !== 'zeitraum' && (!r.leistungsdatum || quelle.belegart === 'angebot')) r.leistungsdatum = todayISO();
  if (!String(r.betreff || '').trim() && quelle.nummer) r.betreff = `${BELEGARTEN[quelle.belegart]?.titel || 'Angebot'} ${quelle.nummer}`;
  r.ausBeleg = { id: quelle.id, nummer: quelle.nummer || '', belegart: quelle.belegart };
  return r;
}

/** Die ausgestellten, nicht stornierten Rechnungen, die aus diesem Beleg entstanden sind (Feld `ausBeleg`). */
export const rechnungenZu = (b, rechnungen = []) => rechnungen.filter((r) => r?.ausBeleg?.id === b?.id && r.status === 'ausgestellt' && !r.storno && !r.storniertDurch);

/**
 * Zustand eines Belegs für Liste und Abzeichen.
 *   entwurf, offen (Angebot ausgestellt, noch gültig), abgelaufen (Angebot über „gültig bis“), angenommen,
 *   abgelehnt, berechnet (es gibt eine ausgestellte Rechnung dazu), ausgestellt (Auftragsbestätigung, Lieferschein)
 * @param {{heute?:string, rechnungen?:object[]}} opt  rechnungen: alle Rechnungen des Bestands
 */
export function belegZustand(b, { heute = todayISO(), rechnungen = [] } = {}) {
  if (!b || b.status !== 'ausgestellt') return 'entwurf';
  if (rechnungenZu(b, rechnungen).length) return 'berechnet';
  if (b.belegart === 'angebot') {
    if (b.ergebnis === 'angenommen') return 'angenommen';
    if (b.ergebnis === 'abgelehnt') return 'abgelehnt';
    if (b.gueltigBis && b.gueltigBis < heute) return 'abgelaufen';
    return 'offen';
  }
  return 'ausgestellt';
}

export const BELEG_ZUSTAENDE = {
  entwurf: { name: 'Entwurf', ton: '' },
  offen: { name: 'Offen', ton: 'warn' },
  abgelaufen: { name: 'Abgelaufen', ton: 'neg' },
  angenommen: { name: 'Angenommen', ton: 'pos' },
  abgelehnt: { name: 'Abgelehnt', ton: 'neg' },
  berechnet: { name: 'Berechnet', ton: 'pos' },
  ausgestellt: { name: 'Ausgestellt', ton: 'pos' },
};

/**
 * Was vor dem Ausstellen fehlt. Ein Angebot braucht keine Pflichtangaben nach § 14 UStG, aber einen Empfänger,
 * mindestens eine Position und ein sinnvolles Datum.
 * @returns {Array<{bereich:string, stufe:'pflicht'|'hinweis', text:string}>}
 */
export function belegPruefen(b, { nummern = null } = {}) {
  const out = [];
  const add = (bereich, stufe, text) => out.push({ bereich, stufe, text });
  if (!String(b.kaeufer?.name || '').trim()) add('kaeufer', 'pflicht', 'Name des Kunden fehlt');
  if (!String(b.kaeufer?.strasse || '').trim() || !String(b.kaeufer?.ort || '').trim()) add('kaeufer', 'hinweis', 'Anschrift des Kunden unvollständig');
  const posten = (b.positionen || []).filter((p) => String(p.name || '').trim() || String(p.beschreibung || '').trim());
  if (!posten.length) add('positionen', 'pflicht', 'Mindestens eine Position mit Bezeichnung');
  if (b.belegart !== 'lieferschein' && posten.some((p) => !Number(p.preis))) add('positionen', 'hinweis', 'Eine Position hat keinen Preis');
  if (!b.datum) add('rechnung', 'pflicht', 'Datum fehlt');
  if (b.belegart === 'angebot' && b.gueltigBis && b.datum && b.gueltigBis < b.datum) add('rechnung', 'pflicht', 'Gültig bis liegt vor dem Datum');
  if (b.belegart === 'lieferschein' && b.leistungArt !== 'zeitraum' && !b.leistungsdatum) add('rechnung', 'hinweis', 'Lieferdatum fehlt');
  const nr = String(b.nummer || '').trim();
  if (nr && nummern?.has(nr)) add('rechnung', 'pflicht', `Die Nummer ${nr} ist schon vergeben`);
  return out;
}
