/**
 * Kontovia – Fahrtenbuch für den Firmenwagen und Dienstreisen (SEC-65).
 *
 * Rein rechnend, ohne Oberfläche und ohne Speicher (Prüfung rechenkern). Fenster: views/fahrten.js,
 * Änderungen: lib/fahrtenaktionen.js.
 *
 *  - Fahrtenbuch (§ 6 Abs. 1 Nr. 4 Satz 3 EStG): Sammlung `fahrten`, je Fahrt
 *    `{id, fahrzeugId, datum, kmStart, kmEnde, km, art, start, ziel, anlass, partner, createdAt, updatedAt}`.
 *    `art`: betrieblich | privat | arbeitsweg (Fahrt zwischen Wohnung und Betrieb). Die Fahrzeuge stehen in
 *    `settings.fahrzeuge` (`[{id, name, kennzeichen, listenpreis, antrieb}]`). Jede Änderung steht mit dem alten
 *    Inhalt im Journal, im festgeschriebenen Zeitraum bleibt eine Fahrt, wie sie ist.
 *  - Auswertung: Anteil der privaten Kilometer an den Gesamtkosten des Fahrzeugs gegen die 1-%-Regel
 *    (lib/sonderfaelle.js: privatnutzung). Die 1-%-Regel gilt nur bei mehr als 50 % betrieblicher Nutzung;
 *    Fahrten zwischen Wohnung und Betrieb zählen dabei als betrieblich.
 *  - Dienstreise: Verpflegungsmehraufwand nach § 9 Abs. 4a EStG (Inland 14 € für An- und Abreisetag oder mehr als
 *    8 Stunden, 28 € für volle Tage; Ausland nach der Tabelle des BMF, von Hand eingetragen), gekürzt um gestellte
 *    Mahlzeiten (Frühstück 20 %, Mittag- und Abendessen je 40 % des vollen Satzes). Ergibt eine Buchung ohne
 *    Geldfluss (EÜR-Zeile 64), dazu die Fahrt mit dem eigenen Auto (Kilometerpauschale, Zeile 71).
 */

import { privatnutzung, fahrtBetrag, KM_SATZ } from './sonderfaelle.js';

export const FAHRT_ARTEN = {
  betrieblich: 'Betrieblich',
  privat: 'Privat',
  arbeitsweg: 'Wohnung und Betrieb',
};
export const fahrtArt = (a) => (FAHRT_ARTEN[a] ? a : 'betrieblich');

const zahl = (x) => {
  const n = Number(String(x ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
/** Kilometer auf eine Nachkommastelle. */
const km1 = (n) => Math.round(zahl(n) * 10) / 10;

/** Gefahrene Kilometer: aus den Ständen, sonst wie eingetragen. */
export function fahrtKm(f) {
  const a = zahl(f?.kmStart);
  const e = zahl(f?.kmEnde);
  if (a > 0 && e > a) return km1(e - a);
  return Math.max(0, km1(f?.km));
}

/** Eine neue Fahrt, Felder wie oben. */
export function neueFahrt(vorgabe = {}) {
  return {
    id: '', fahrzeugId: '', datum: '', kmStart: '', kmEnde: '', km: 0, art: 'betrieblich',
    start: '', ziel: '', anlass: '', partner: '', ...vorgabe,
  };
}

/**
 * Was einer Fahrt für ein ordnungsgemäßes Fahrtenbuch fehlt.
 * @returns {Array<{feld:string, text:string, stufe:'pflicht'|'hinweis'}>}
 */
export function fahrtPruefen(f) {
  const out = [];
  const p = (feld, text, stufe = 'pflicht') => out.push({ feld, text, stufe });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f?.datum || ''))) p('datum', 'Datum fehlt.');
  const a = zahl(f?.kmStart);
  const e = zahl(f?.kmEnde);
  if (a > 0 && e > 0 && e <= a) p('kmEnde', 'Der Kilometerstand am Ende muss größer sein als am Anfang.');
  else if (!(fahrtKm(f) > 0)) p('km', 'Kilometer fehlen.');
  if (!(a > 0 && e > 0)) p('kmStart', 'Ein Fahrtenbuch braucht den Kilometerstand am Anfang und am Ende jeder Fahrt.', 'hinweis');
  if (fahrtArt(f?.art) === 'betrieblich') {
    if (!String(f?.ziel || '').trim()) p('ziel', 'Bei betrieblichen Fahrten gehört das Ziel dazu.');
    if (!String(f?.anlass || '').trim()) p('anlass', 'Bei betrieblichen Fahrten gehört der Anlass dazu.');
  }
  return out;
}

/** Fahrten eines Fahrzeugs in Fahrtreihenfolge (Datum, dann Kilometerstand). */
export function fahrtenSortiert(fahrten, fahrzeugId = null) {
  return (fahrten || []).filter((f) => fahrzeugId === null || (f.fahrzeugId || '') === (fahrzeugId || ''))
    .sort((x, y) => String(x.datum).localeCompare(String(y.datum)) || zahl(x.kmStart) - zahl(y.kmStart));
}

/**
 * Lücken im Kilometerstand: Eine Fahrt beginnt nicht dort, wo die vorige desselben Fahrzeugs endete.
 * @returns {Array<{vorher:string, nachher:string, km:number}>} km > 0: nicht eingetragene Strecke, < 0: Überschneidung
 */
export function kmLuecken(fahrten, fahrzeugId = '') {
  const liste = fahrtenSortiert(fahrten, fahrzeugId).filter((f) => zahl(f.kmStart) > 0 && zahl(f.kmEnde) > 0);
  const out = [];
  for (let i = 1; i < liste.length; i++) {
    const d = km1(zahl(liste[i].kmStart) - zahl(liste[i - 1].kmEnde));
    if (d !== 0) out.push({ vorher: liste[i - 1].id, nachher: liste[i].id, km: d });
  }
  return out;
}

/**
 * Auswertung eines Jahres für ein Fahrzeug.
 * @param {Array<object>} fahrten
 * @param {{jahr:number|string, fahrzeugId?:string, kosten?:number, listenpreis?:number, antrieb?:string, monate?:number}} o
 *   kosten: Gesamtkosten des Fahrzeugs im Jahr in Cent (mit Abschreibung), listenpreis in Cent, monate mit Firmenwagen
 */
export function fahrtenAuswertung(fahrten, { jahr, fahrzeugId = '', kosten = 0, listenpreis = 0, antrieb = 'verbrenner', monate = 12 } = {}) {
  const j = String(jahr);
  const liste = fahrtenSortiert(fahrten, fahrzeugId).filter((f) => String(f.datum || '').slice(0, 4) === j);
  const km = { betrieblich: 0, privat: 0, arbeitsweg: 0, gesamt: 0 };
  for (const f of liste) {
    const k = fahrtKm(f);
    km[fahrtArt(f.art)] += k;
    km.gesamt += k;
  }
  for (const k of Object.keys(km)) km[k] = km1(km[k]);
  const anteil = (x) => (km.gesamt > 0 ? x / km.gesamt : 0);
  const k = Math.max(0, Math.round(zahl(kosten)));
  // Nach Fahrtenbuch: die Kosten im Verhältnis der Kilometer.
  const privatKosten = Math.round(k * anteil(km.privat));
  const arbeitswegKosten = Math.round(k * anteil(km.arbeitsweg));
  // 1-%-Regel: nur bei mehr als der Hälfte betrieblicher Nutzung (Fahrten zur Arbeit zählen mit).
  const betrieblichAnteil = anteil(km.betrieblich + km.arbeitsweg);
  const pauschalErlaubt = km.gesamt > 0 && betrieblichAnteil > 0.5;
  const m = Math.min(12, Math.max(0, Math.round(zahl(monate))));
  const pauschal = listenpreis > 0 ? privatnutzung(listenpreis, antrieb).net * m : 0;
  const vergleichbar = k > 0 && listenpreis > 0 && pauschalErlaubt;
  return {
    jahr: Number(j), fahrten: liste.length, km,
    anteilPrivat: anteil(km.privat), anteilArbeitsweg: anteil(km.arbeitsweg), anteilBetrieblich: betrieblichAnteil,
    kosten: k, privatKosten, arbeitswegKosten, pauschal, monate: m, pauschalErlaubt,
    guenstiger: vergleichbar ? (pauschal < privatKosten ? 'pauschal' : 'fahrtenbuch') : (km.gesamt > 0 && !pauschalErlaubt ? 'fahrtenbuch' : ''),
    luecken: kmLuecken(fahrten, fahrzeugId).filter((l) => liste.some((f) => f.id === l.nachher)),
  };
}

/** Das Fahrtenbuch als CSV (Semikolon, für das Finanzamt oder die Steuerberatung). */
export function fahrtenCsv(fahrten, fahrzeugId = '', { jahr = '' } = {}) {
  const feld = (s) => {
    const t = String(s ?? '');
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const zahlText = (n) => (n === '' || n === null || n === undefined ? '' : String(n).replace('.', ','));
  const kopf = ['Datum', 'Kilometerstand Beginn', 'Kilometerstand Ende', 'Kilometer', 'Art', 'Start', 'Ziel', 'Anlass', 'Geschäftspartner'];
  const zeilen = fahrtenSortiert(fahrten, fahrzeugId).filter((f) => !jahr || String(f.datum || '').startsWith(String(jahr)))
    .map((f) => [f.datum, zahlText(f.kmStart), zahlText(f.kmEnde), zahlText(fahrtKm(f)), FAHRT_ARTEN[fahrtArt(f.art)], f.start, f.ziel, f.anlass, f.partner].map(feld).join(';'));
  return `${[kopf.join(';'), ...zeilen].join('\r\n')}\r\n`;
}

/* -------------------------------------------------------------------------- */
/* Dienstreise                                                                 */
/* -------------------------------------------------------------------------- */

/** Verpflegungspauschalen im Inland in Cent (§ 9 Abs. 4a Satz 3 EStG, seit 2020). */
export const VERPFLEGUNG_INLAND = { voll: 2800, teil: 1400 };
/** Kürzung je gestellter Mahlzeit, Anteil des vollen Satzes (§ 9 Abs. 4a Satz 8 EStG). */
export const MAHLZEIT_KUERZUNG = { fruehstueck: 0.2, mittag: 0.4, abend: 0.4 };
/** EÜR-Zeile für Verpflegungsmehraufwendungen (Vordruck 2025). */
export const VERPFLEGUNG_ZEILE = 64;
/** Die Pauschalen gibt es an derselben Tätigkeitsstätte nur in den ersten drei Monaten (§ 9 Abs. 4a Satz 6 EStG). */
export const DREI_MONATE_TAGE = 92;

/** Alle Tage von `von` bis `bis` (ISO), höchstens ein Jahr. */
export function reiseTage(von, bis) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(von)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(bis)) || bis < von) return out;
  const d = new Date(`${von}T12:00:00Z`);
  while (out.length < 366) {
    const iso = d.toISOString().slice(0, 10);
    out.push(iso);
    if (iso >= bis) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Verpflegungsmehraufwand einer Dienstreise.
 * @param {{von:string, bis:string, stunden?:number, mahlzeiten?:Object<string,{fruehstueck?:boolean, mittag?:boolean, abend?:boolean}>,
 *   satz?:{voll:number, teil:number}}} r  stunden: Abwesenheit bei einer Reise an einem Tag; mahlzeiten je Tag (ISO)
 * @returns {{tage:Array<{datum:string, art:'voll'|'teil'|'keine', pauschale:number, kuerzung:number, betrag:number}>, summe:number, hinweise:string[]}}
 */
export function verpflegung({ von, bis, stunden = 0, mahlzeiten = {}, satz = VERPFLEGUNG_INLAND } = {}) {
  const voll = Math.max(0, Math.round(zahl(satz?.voll)));
  const teil = Math.max(0, Math.round(zahl(satz?.teil)));
  const liste = reiseTage(von, bis);
  const hinweise = [];
  const tage = liste.map((datum, i) => {
    let art;
    if (liste.length === 1) art = zahl(stunden) > 8 ? 'teil' : 'keine';
    else art = i === 0 || i === liste.length - 1 ? 'teil' : 'voll';
    const pauschale = art === 'voll' ? voll : art === 'teil' ? teil : 0;
    const m = mahlzeiten?.[datum] || {};
    const k = (m.fruehstueck ? Math.round(voll * MAHLZEIT_KUERZUNG.fruehstueck) : 0)
      + (m.mittag ? Math.round(voll * MAHLZEIT_KUERZUNG.mittag) : 0) + (m.abend ? Math.round(voll * MAHLZEIT_KUERZUNG.abend) : 0);
    const kuerzung = Math.min(pauschale, k);
    return { datum, art, pauschale, kuerzung, betrag: pauschale - kuerzung };
  });
  if (liste.length === 1 && art0(tage) === 'keine') hinweise.push('Unter 8 Stunden unterwegs: keine Pauschale.');
  if (liste.length > DREI_MONATE_TAGE) hinweise.push('Nach drei Monaten am selben Ort gibt es keine Pauschale mehr. Kürzen Sie die Reise oder teilen Sie sie auf.');
  return { tage, summe: tage.reduce((s, t) => s + t.betrag, 0), hinweise };
}
const art0 = (tage) => tage[0]?.art;

/**
 * Buchungen einer Dienstreise: Verpflegung (ohne Geldfluss, wie die Kilometerpauschale) und Fahrt mit dem eigenen Auto.
 * Übernachtung und Fahrkarten haben eine Rechnung und werden als gewöhnliche Ausgabe mit Beleg gebucht.
 * @param {{von:string, bis:string, ziel:string, anlass?:string, land?:string, km?:number, verpflegung:{summe:number, tage:Array}}} reise
 * @param {{verpflegungKategorie?:string, fahrtKategorie?:string, id:(p:string)=>string}} o
 */
export function reiseBuchungen(reise, { verpflegungKategorie = '', fahrtKategorie = '', id }) {
  const datum = reise.bis || reise.von;
  const zweck = [reise.ziel, reise.anlass].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  const basis = (extra) => ({
    id: id('tx'), type: 'expense', date: datum, paidDate: datum, dueDate: '', contactId: '', accountId: '', vatRate: 0,
    invoiceNumber: '', reference: '', notes: '', location: '', unlisted: false, projektId: reise.projektId || '', attachments: [],
    appointmentIds: [], reverseCharge: false, voided: false, ...extra,
  });
  const out = [];
  const summe = Math.round(zahl(reise.verpflegung?.summe));
  if (summe > 0) {
    out.push(basis({
      description: `Verpflegungsmehraufwand ${zweck}`.trim(), categoryId: verpflegungKategorie, gross: summe, net: summe, vat: 0,
      verpflegung: { von: reise.von, bis: reise.bis, tage: reise.verpflegung.tage.filter((t) => t.betrag > 0).length, land: reise.land || 'DE' },
    }));
  }
  const km = km1(reise.km);
  if (km > 0) {
    const f = fahrtBetrag(km, KM_SATZ);
    out.push(basis({
      description: `Fahrt mit eigenem Auto ${zweck}`.trim(), categoryId: fahrtKategorie, gross: f.gross, net: f.net, vat: 0,
      fahrt: { km: f.km, satz: f.satz, strecke: zweck },
    }));
  }
  return out;
}
