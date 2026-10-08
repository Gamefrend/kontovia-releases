/**
 * Kontovia – Daten aus anderen Programmen lesen und in Buchungen, Kontakte
 * und Produkte übersetzen.
 *
 * Formate:
 *   DATEV-Format (EXTF/DTVF)  Buchungsstapel (Kategorie 21) und Debitoren/
 *                             Kreditoren (Kategorie 16). Das geben DATEV,
 *                             Lexware Office, sevDesk und fast jede Kanzlei aus.
 *   CSV/Tabelle mit Buchungen Spalten werden an der Überschrift erkannt
 *                             (Kontovia, lexoffice, sevDesk, Excel-Listen).
 *   vCard (.vcf)              Kontakte aus Outlook, Google, Apple, Telefon.
 *   CSV mit Kontakten         Outlook, Google Kontakte, lexoffice, Kontovia.
 *   CSV mit Produkten         Artikelnummer, Bezeichnung, Preis, Einheit, Steuersatz.
 * ELSTER-Dateien liest lib/elster.js, Kontoauszüge lib/kontoauszug.js,
 * E-Rechnungen lib/erechnung.js, Kalenderdateien lib/ics.js.
 *
 * Diese Datei kennt weder Oberfläche noch Speicher: Sie bekommt Text und den
 * Bestand und liefert Vorschläge. Gebucht wird in lib/datenimportaktionen.js,
 * erst nach Bestätigung. Prüfung: scripts/pruefungen/datenimport.test.js.
 */

import { csvTrenner, csvZeilen, datumLesen, betragLesen } from './kontoauszug.js';
import { norm, uid, splitFromGross, splitFromNet, gebiet } from './util.js';
import { einheitAusText } from './rechnung.js';
import { DATEV_AUTOMATIK } from './exports.js';

/** Höchstzahl an Zeilen je Datei, damit eine versehentlich gewählte Riesendatei den Browser nicht lähmt. */
export const MAX_ZEILEN = 50000;

const zu = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Kurzer, stabiler Fingerabdruck (FNV-1a), nicht kryptografisch. */
export function fingerabdruck(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let h2 = 5381;
  for (let i = 0; i < s.length; i++) h2 = (Math.imul(h2, 33) ^ s.charCodeAt(i)) >>> 0;
  return (h >>> 0).toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/* -------------------------------------------------------------------------- */
/* Welche Datei ist das?                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Art der Datei nach Inhalt (der Name hilft nur im Zweifel):
 * 'datev', 'elster', 'vcard', 'ics', 'kontoauszug', 'erechnung', 'csv' oder ''.
 */
export function dateiArt(text, name = '') {
  const kopf = String(text ?? '').replace(/^﻿/, '').slice(0, 6000);
  if (/^\s*"?(EXTF|DTVF)"?\s*[;,]/.test(kopf)) return 'datev';
  if (/^\s*BEGIN:VCARD/im.test(kopf)) return 'vcard';
  if (/^\s*BEGIN:VCALENDAR/im.test(kopf)) return 'ics';
  if (/<(\w+:)?(Anmeldungssteuern|Elster)\b/.test(kopf) || /<(\w+:)?Umsatzsteuervoranmeldung\b/.test(String(text).slice(0, 200000))) return 'elster';
  if (/CrossIndustryInvoice|urn:oasis:names:specification:ubl|<(\w+:)?Invoice\b/.test(kopf)) return 'erechnung';
  if (/camt\.05[234]|BkToCstmr/.test(kopf) || /(^|\n):20:/.test(kopf)) return 'kontoauszug';
  if (/^\s*</.test(kopf)) return '';
  if (/\.(csv|txt|tsv)$/i.test(name) || /[;,\t]/.test(kopf)) return 'csv';
  return '';
}

/* -------------------------------------------------------------------------- */
/* DATEV-Format                                                                */
/* -------------------------------------------------------------------------- */

/** Spalten des DATEV-Formats, an der Überschrift erkannt (norm, ohne Klammern). */
const DATEV_SPALTEN = {
  umsatz: /^umsatz/,
  sh: /^soll\/?haben/,
  wkz: /^wkz umsatz/,
  konto: /^konto$/,
  gegenkonto: /^gegenkonto/,
  bu: /^bu-?schluessel/,
  datum: /^belegdatum/,
  beleg: /^belegfeld 1$/,
  beleg2: /^belegfeld 2$/,
  text: /^buchungstext/,
  // Debitoren/Kreditoren
  firma: /^name \(adressatentyp unternehmen\)/,
  nachname: /^name \(adressatentyp natuerl/,
  vorname: /^vorname \(adressatentyp natuerl/,
  kurz: /^kurzbezeichnung/,
  ustid: /^eu-ustid|^eu-ust-id|^ust-id/,
  euland: /^eu-land/,
  strasse: /^strasse$/,
  plz: /^postleitzahl$/,
  ort: /^ort$/,
  land: /^land$/,
  telefon: /^telefon$/,
  email: /^e-mail$/,
  steuernummer: /^steuernummer$/,
  iban: /^iban(-nr\.?| 1)?$/,
};

/**
 * Liest eine DATEV-Datei (EXTF oder DTVF).
 * @returns {{kategorie:number, kopf:object, zeilen:object[], hinweise:string[]}}
 */
export function datevLesen(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const roh = csvZeilen(src, ';');
  if (roh.length < 2) throw Object.assign(new Error('Die DATEV-Datei ist leer.'), { code: 'LEER' });
  const h = roh[0].map((z) => zu(z).replace(/^"|"$/g, ''));
  if (!/^(EXTF|DTVF)$/.test(h[0])) throw Object.assign(new Error('Die Datei beginnt nicht mit einem DATEV-Kopf (EXTF).'), { code: 'FORMAT' });
  const kategorie = Number(h[2]) || 0;
  const rahmen = { '03': 'skr03', '04': 'skr04', 3: 'skr03', 4: 'skr04' }[String(h[26] || '').replace(/\D/g, '')] || '';
  const kopf = {
    format: h[0], version: Number(h[1]) || 0, kategorie, name: h[3] || '',
    berater: h[10] || '', mandant: h[11] || '', wjBeginn: datumLesen(h[12]) || '', sachkontenlaenge: Number(h[13]) || 4,
    von: datumLesen(h[14]) || '', bis: datumLesen(h[15]) || '', bezeichnung: h[16] || '', rahmen,
    waehrung: h[21] || 'EUR',
  };
  const namen = roh[1].map((z) => norm(zu(z)));
  const idx = {};
  for (const [rolle, re] of Object.entries(DATEV_SPALTEN)) idx[rolle] = namen.findIndex((n) => re.test(n));
  const hinweise = [];
  const zeilen = [];
  const daten = roh.slice(2, 2 + MAX_ZEILEN);
  if (roh.length - 2 > MAX_ZEILEN) hinweise.push(`Die Datei hat mehr als ${MAX_ZEILEN.toLocaleString(gebiet())} Zeilen; gelesen wurden die ersten.`);
  const z = (r, rolle) => (idx[rolle] >= 0 ? zu(r[idx[rolle]]) : '');

  if (kategorie === 16) {
    for (let i = 0; i < daten.length; i++) {
      const r = daten[i];
      const konto = z(r, 'konto');
      if (!konto) continue;
      zeilen.push({
        nr: i + 3, konto, firma: z(r, 'firma'), nachname: z(r, 'nachname'), vorname: z(r, 'vorname'), kurz: z(r, 'kurz'),
        ustid: (z(r, 'euland') + z(r, 'ustid')).replace(/\s/g, '').toUpperCase(), strasse: z(r, 'strasse'), plz: z(r, 'plz'),
        ort: z(r, 'ort'), land: z(r, 'land').toUpperCase(), telefon: z(r, 'telefon'), email: z(r, 'email'), steuernummer: z(r, 'steuernummer'),
      });
    }
    return { kategorie, kopf, zeilen, hinweise };
  }
  if (kategorie !== 21) {
    throw Object.assign(new Error(`Diese DATEV-Datei enthält ${h[3] || 'andere Daten'}. Eingelesen werden Buchungsstapel sowie Debitoren und Kreditoren.`), { code: 'KATEGORIE' });
  }
  if (idx.umsatz < 0 || idx.konto < 0 || idx.gegenkonto < 0) throw Object.assign(new Error('In der DATEV-Datei fehlen die Spalten Umsatz, Konto oder Gegenkonto.'), { code: 'SPALTEN' });

  const jahr0 = Number((kopf.wjBeginn || kopf.von || '').slice(0, 4)) || new Date().getFullYear();
  const wjMonat = Number((kopf.wjBeginn || '').slice(5, 7)) || 1;
  for (let i = 0; i < daten.length; i++) {
    const r = daten[i];
    const betrag = betragLesen(z(r, 'umsatz'), 'komma');
    if (!betrag) continue;
    // Belegdatum steht als TTMM; das Jahr folgt aus dem Wirtschaftsjahr.
    const d = z(r, 'datum').replace(/\D/g, '');
    let datum = null;
    if (d.length === 8) datum = datumLesen(`${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`);
    else if (d.length === 3 || d.length === 4) {
      const tt = d.slice(0, d.length - 2).padStart(2, '0');
      const mm = d.slice(-2);
      const jahr = Number(mm) < wjMonat ? jahr0 + 1 : jahr0;
      datum = datumLesen(`${tt}.${mm}.${jahr}`);
    }
    if (!datum) { hinweise.push(`Zeile ${i + 3}: Belegdatum „${z(r, 'datum')}“ ist nicht lesbar und wurde übersprungen.`); continue; }
    const wkz = z(r, 'wkz').toUpperCase();
    if (wkz && wkz !== 'EUR') { hinweise.push(`Zeile ${i + 3}: Betrag in ${wkz} wurde übersprungen; übernommen werden Euro-Beträge.`); continue; }
    zeilen.push({
      nr: i + 3, datum, betrag: Math.abs(betrag), sh: (z(r, 'sh').toUpperCase() || 'S')[0] === 'H' ? 'H' : 'S',
      konto: z(r, 'konto').replace(/\D/g, ''), gegenkonto: z(r, 'gegenkonto').replace(/\D/g, ''), bu: z(r, 'bu').replace(/\D/g, ''),
      beleg: z(r, 'beleg'), beleg2: z(r, 'beleg2'), text: z(r, 'text'),
    });
  }
  return { kategorie, kopf, zeilen, hinweise };
}

/** Geldkonten der Kontenrahmen (Kasse, Bank, Geldtransit) als Bereiche. */
const GELD = { skr03: [[1000, 1399]], skr04: [[1460, 1460], [1600, 1899]] };
/** Personenkonten: Debitoren 10000–69999, Kreditoren 70000–99999 (bei vierstelligen Sachkonten). */
const istPerson = (k) => k.length >= 5 && Number(k) >= 10000;

/** Steuersatz aus dem BU-Schlüssel (letzte Stelle zählt, die erste ist eine Berichtigung). */
const BU_SATZ = { 1: 0, 2: 7, 3: 19, 5: 16, 7: 16, 8: 7, 9: 19 };

/**
 * Übersetzt einen DATEV-Buchungsstapel in Buchungsvorschläge.
 * Jede Zeile wird zu genau einem Vorschlag: { nr, art: 'buchung'|'zahlung'|'enthalten'|'aus', tx?, grund, doppelt }.
 * 'enthalten': eine Zahlung, die als Zahlungsdatum in einer Rechnung derselben Datei steht.
 * Zahlungen (Geldkonto gegen Personenkonto) schließen eine Rechnung aus derselben Datei
 * oder eine offene Buchung mit gleicher Belegnummer.
 * @param {object} stapel Ergebnis von datevLesen
 * @param {object} db Bestand (nur gelesen)
 * @param {{kontoId?:string, datei?:string}} opt
 */
export function datevZuBuchungen(stapel, db, opt = {}) {
  const s = db.settings || {};
  const skr = stapel.kopf.rahmen || (s.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03');
  const klein = s.taxMode === 'kleinunternehmer';
  const konten = (db.accounts || []).filter((a) => a.active !== false);
  const standardKonto = konten.find((a) => a.id === opt.kontoId) || konten.find((a) => a.kind === 'bank') || konten[0];
  const geldkonto = (k) => konten.find((a) => String(a[skr] || '') === k);
  const istGeld = (k) => !!geldkonto(k) || GELD[skr].some(([a, b]) => Number(k) >= a && Number(k) <= b && k.length === 4);
  const kats = (db.categories || []).filter((c) => c.active !== false);
  const vorhanden = new Set((db.transactions || []).map((t) => t.importHash).filter(Boolean));
  const gesehen = new Map();
  const out = [];
  const rechnungen = new Map(); // Belegnummer|Personenkonto → Vorschlag
  const mitSchluesseln = stapel.zeilen.some((z) => z.bu);

  for (const z of stapel.zeilen) {
    const a = z.konto; const b = z.gegenkonto;
    const roh = `${z.datum}|${z.betrag}|${z.sh}|${a}|${b}|${z.bu}|${z.beleg}|${z.text}`;
    const n = (gesehen.get(roh) || 0) + 1;
    gesehen.set(roh, n);
    const hash = `datev:${fingerabdruck(`${roh}|${n}`)}`;
    const basis = { nr: z.nr, datum: z.datum, betrag: z.betrag, text: z.text, beleg: z.beleg, konto: a, gegenkonto: b, hash, doppelt: vorhanden.has(hash) };
    if (!a || !b) { out.push({ ...basis, art: 'aus', grund: 'Konto oder Gegenkonto fehlt.' }); continue; }
    const gA = istGeld(a); const gB = istGeld(b);
    const pA = istPerson(a); const pB = istPerson(b);

    if (gA && gB) { out.push({ ...basis, art: 'aus', grund: 'Umbuchung zwischen zwei Geldkonten; sie ändert kein Ergebnis.' }); continue; }
    if ((gA && pB) || (pA && gB)) {
      // Zahlung auf eine Rechnung: Geld kommt herein, wenn das Geldkonto im Soll steht.
      const person = pA ? a : b;
      const geld = gA ? a : b;
      out.push({ ...basis, art: 'zahlung', person, geldkontoId: (geldkonto(geld) || standardKonto)?.id || '', grund: '' });
      continue;
    }
    if (pA && pB) { out.push({ ...basis, art: 'aus', grund: 'Umbuchung zwischen zwei Personenkonten.' }); continue; }
    const sachA = !gA && !pA; const sachB = !gB && !pB;
    if (sachA && sachB) { out.push({ ...basis, art: 'aus', grund: 'Umbuchung zwischen Sachkonten, etwa Abschreibung oder Abgrenzung. Bitte von Hand prüfen.' }); continue; }

    const sach = sachA ? a : b;
    const gegen = sachA ? b : a;
    // Das Konto steht im angegebenen Soll/Haben, das Gegenkonto im anderen.
    const sachImSoll = sachA ? z.sh === 'S' : z.sh === 'H';
    const passende = kats.filter((c) => String(c[skr] || '') === sach);
    const satzBu = z.bu ? BU_SATZ[Number(z.bu.slice(-1))] : undefined;
    let kat = passende.find((c) => (c.kind === 'expense') === sachImSoll && (satzBu === undefined || Number(c.vatRate) === satzBu))
      || passende.find((c) => (c.kind === 'expense') === sachImSoll) || null;
    const typ = kat ? kat.kind : (sachImSoll ? 'expense' : 'income');
    if (!kat && passende.length) {
      out.push({ ...basis, art: 'aus', grund: `Gegenbuchung auf Konto ${sach} (${passende[0].name}), etwa eine Gutschrift. Bitte von Hand als Storno erfassen.` });
      continue;
    }
    // Ohne Steuerschlüssel: Auf Automatikkonten gilt der Satz des Kontos. Arbeitet die
    // Datei sonst mit Schlüsseln, heißt ein fehlender Schlüssel „ohne Steuer“; sonst
    // ist der Satz unbekannt und kommt aus der Kategorie.
    let satz = 0;
    if (!klein && !kat?.private && !kat?.vatNeutral) {
      if (satzBu !== undefined) satz = satzBu;
      else if (!mitSchluesseln || DATEV_AUTOMATIK[skr].has(sach)) satz = Number(kat?.vatRate) || 0;
    }
    const t = splitFromGross(z.betrag, satz);
    const offen = istPerson(gegen);
    const geldKonto = offen ? standardKonto : (geldkonto(gegen) || standardKonto);
    const tx = buchungsEntwurf({
      type: typ, date: z.datum, paidDate: offen ? '' : z.datum,
      description: (z.text || (kat?.name ?? `Konto ${sach}`)).slice(0, 200),
      categoryId: kat?.id || '', accountId: geldKonto?.id || '',
      gross: t.gross, net: t.net, vat: t.vat, vatRate: satz, invoiceNumber: z.beleg.slice(0, 36),
      importHash: hash, import: { quelle: 'DATEV', datei: opt.datei || '', konto: sach, gegenkonto: gegen },
    });
    const v = {
      ...basis, art: 'buchung', tx, offen, person: offen ? gegen : '',
      grund: kat ? '' : `Konto ${sach} gehört zu keiner Kategorie; die Buchung kommt ohne Kategorie.`,
    };
    out.push(v);
    if (offen && z.beleg) rechnungen.set(`${norm(z.beleg)}|${gegen}`, v);
  }

  // Zahlungen ihren Rechnungen zuordnen.
  const offeneImBestand = (db.transactions || []).filter((t) => !t.paidDate && !t.voided && !t.isReversal && t.invoiceNumber);
  for (const v of out) {
    if (v.art !== 'zahlung') continue;
    const r = v.beleg && rechnungen.get(`${norm(v.beleg)}|${v.person}`);
    if (r && !r.tx.paidDate && r.tx.gross === v.betrag) {
      r.tx.paidDate = v.datum;
      r.tx.accountId = v.geldkontoId || r.tx.accountId;
      r.bezahltDurch = v.nr;
      // Die Zahlung steckt jetzt als Zahlungsdatum in der Rechnung und wird nicht eigens übernommen.
      v.art = 'enthalten';
      v.doppelt = r.doppelt;
      v.zuRechnung = r.nr;
      v.grund = `Steckt als Zahlungsdatum in der Rechnung ${v.beleg} (Zeile ${r.nr}).`;
      continue;
    }
    const alt = v.beleg && offeneImBestand.find((t) => norm(t.invoiceNumber) === norm(v.beleg) && t.gross === v.betrag);
    if (alt) {
      v.bestandTxId = alt.id;
      v.grund = `Zahlung zur vorhandenen Buchung „${alt.description}“ (${v.beleg}).`;
      continue;
    }
    v.art = 'aus';
    v.grund = 'Zahlung ohne passende Rechnung in der Datei oder im Bestand.';
  }
  return aehnlicheMarkieren(out, db);
}

/** Kontakte aus DATEV-Debitoren und -Kreditoren. */
export function datevKontakte(stapel) {
  return stapel.zeilen.map((z) => {
    const name = z.firma || [z.vorname, z.nachname].filter(Boolean).join(' ') || z.kurz || `Konto ${z.konto}`;
    const nr = Number(z.konto);
    return kontaktEntwurf({
      name, kind: nr >= 70000 ? 'supplier' : 'customer', email: z.email, phone: z.telefon,
      street: z.strasse, zip: z.plz, city: z.ort, country: z.land || 'DE',
      vatId: /^[A-Z]{2}[0-9A-Z]/.test(z.ustid) ? z.ustid : '', taxId: z.ustid || z.steuernummer, customerNumber: z.konto,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Buchungen aus einer Tabelle                                                 */
/* -------------------------------------------------------------------------- */

/** Spaltenrollen für Buchungstabellen, erkannt an der Überschrift (norm, ohne Satzzeichen). Die Reihenfolge entscheidet. */
const BUCHUNG_ROLLEN = [
  ['zahldatum', /^(zahlungsdatum|bezahlt am|zahldatum|zahlung am|datum der zahlung|bezahldatum|paid date)$/],
  ['faellig', /^(faelligkeit|faellig am|faelligkeitsdatum|due date)$/],
  ['datum', /^(datum|belegdatum|rechnungsdatum|buchungsdatum|beleg ?datum|date|leistungsdatum)$/],
  ['art', /^(art|typ|belegtyp|einnahme\/ausgabe|richtung|type|buchungsart)$/],
  ['einnahme', /^(einnahme|einnahmen|eingang|haben)$/],
  ['ausgabe', /^(ausgabe|ausgaben|ausgang|soll)$/],
  ['satz', /(ust|mwst|steuer)[- ]?(satz|prozent)|^steuersatz|^satz$|^vat rate$|^ust %$|^mwst %$/],
  ['ust', /^(ust|mwst|umsatzsteuer|steuer|vorsteuer|ust-?betrag|mwst-?betrag|steuerbetrag|vat)( in eur| eur)?$/],
  ['netto', /^(netto|nettobetrag|betrag netto|netto in eur|net)( eur)?$/],
  ['brutto', /^(brutto|bruttobetrag|betrag brutto|gesamt|gesamtbetrag|betrag|summe|amount|brutto in eur|betrag in eur|rechnungsbetrag)( eur)?$/],
  ['kategorie', /^(kategorie|buchungskategorie|kostenart|category)$/],
  ['konto', /^(konto skr0?3|konto skr0?4|sachkonto|gegenkonto|konto)$/],
  ['kontakt', /^(kontakt|kunde|lieferant|kunde\/lieferant|geschaeftspartner|partner|name|empfaenger|auftraggeber|firma)$/],
  ['beleg', /^(beleg-?nr|belegnummer|rechnungsnummer|rechnungs-?nr|re-?nr|beleg|nummer|invoice number)$/],
  ['text', /^(beschreibung|buchungstext|text|titel|bezeichnung|verwendungszweck|betreff|description)$/],
  ['notiz', /^(notiz|bemerkung|kommentar|notes)$/],
  ['storno', /^storno$/],
];

const rolleBuchung = (k) => {
  const n = norm(k).replace(/[()*:]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [r, re] of BUCHUNG_ROLLEN) if (re.test(n)) return r;
  return '';
};

/** Erkennt Spalten und liest jede Zeile als Rohbuchung. */
export function buchungenCsvLesen(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const trenner = csvTrenner(src);
  const roh = csvZeilen(src, trenner);
  let kopfzeile = -1; let best = 1;
  for (let i = 0; i < Math.min(roh.length, 30); i++) {
    const p = roh[i].filter((z) => rolleBuchung(z)).length;
    if (p > best) { best = p; kopfzeile = i; }
  }
  if (kopfzeile < 0) throw Object.assign(new Error('In der Tabelle fehlen erkennbare Überschriften wie Datum, Betrag und Beschreibung.'), { code: 'KOPF' });
  const spalten = {};
  roh[kopfzeile].forEach((k, i) => { const r = rolleBuchung(k); if (r && !(r in spalten)) spalten[r] = i; });
  // Eine Spalte „Konto SKR03“ neben „Konto SKR04“: nimm die zum Kontenrahmen passende später.
  roh[kopfzeile].forEach((k, i) => { const n = norm(k); if (/skr0?3/.test(n)) spalten.skr03 = i; if (/skr0?4/.test(n)) spalten.skr04 = i; });
  if (!('datum' in spalten) && 'zahldatum' in spalten) spalten.datum = spalten.zahldatum;
  const fehlt = ['datum'].filter((r) => !(r in spalten));
  if (!('brutto' in spalten) && !('netto' in spalten) && !('einnahme' in spalten) && !('ausgabe' in spalten)) fehlt.push('Betrag');
  if (fehlt.length) throw Object.assign(new Error(`In der Tabelle fehlt die Spalte ${fehlt.map((f) => (f === 'datum' ? 'Datum' : f)).join(' und ')}.`), { code: 'SPALTEN' });

  const z = (r, rolle) => (rolle in spalten ? zu(r[spalten[rolle]]) : '');
  const zeilen = [];
  const hinweise = [];
  for (let i = kopfzeile + 1; i < roh.length && zeilen.length < MAX_ZEILEN; i++) {
    const r = roh[i];
    if (r.every((x) => !zu(x))) continue;
    const datum = datumLesen(z(r, 'datum'));
    if (!datum) { if (zu(r.join(''))) hinweise.push(`Zeile ${i + 1}: kein lesbares Datum, übersprungen.`); continue; }
    let brutto = betragLesen(z(r, 'brutto'));
    const netto = betragLesen(z(r, 'netto'));
    const ust = betragLesen(z(r, 'ust'));
    const ein = betragLesen(z(r, 'einnahme'));
    const aus = betragLesen(z(r, 'ausgabe'));
    let vorzeichen = 0;
    if (brutto === null && (ein || aus)) { brutto = ein ? Math.abs(ein) : Math.abs(aus); vorzeichen = ein ? 1 : -1; }
    if (brutto === null && netto !== null) brutto = netto + (ust || 0);
    if (!brutto) { hinweise.push(`Zeile ${i + 1}: kein Betrag, übersprungen.`); continue; }
    const artText = norm(z(r, 'art'));
    let typ = '';
    if (/einnahme|ertrag|erloes|umsatz|income|eingang|rechnung an|ausgangsrechnung|verkauf/.test(artText)) typ = 'income';
    else if (/ausgabe|aufwand|kosten|expense|ausgang|eingangsrechnung|einkauf|beleg/.test(artText)) typ = 'expense';
    if (!typ) typ = vorzeichen ? (vorzeichen > 0 ? 'income' : 'expense') : brutto < 0 ? 'expense' : 'income';
    const satzText = z(r, 'satz').replace('%', '').trim();
    let satz = satzText ? Number(satzText.replace(',', '.')) : null;
    if (satz !== null && !Number.isFinite(satz)) satz = null;
    zeilen.push({
      zeile: i + 1, datum, zahldatum: datumLesen(z(r, 'zahldatum')) || '', faellig: datumLesen(z(r, 'faellig')) || '', typ,
      brutto: Math.abs(brutto), netto: netto === null ? null : Math.abs(netto), ust: ust === null ? null : Math.abs(ust), satz,
      kategorie: z(r, 'kategorie'), konto: z(r, 'konto'), skr03: z(r, 'skr03'), skr04: z(r, 'skr04'),
      kontakt: z(r, 'kontakt'), beleg: z(r, 'beleg'), text: z(r, 'text'), notiz: z(r, 'notiz'),
      storno: /^(storniert|gegenbuchung)$/i.test(z(r, 'storno')) ? z(r, 'storno') : '',
      hatZahldatum: 'zahldatum' in spalten,
    });
  }
  return { trenner, kopfzeile, spalten, zeilen, hinweise };
}

/**
 * Rohbuchungen aus einer Tabelle → Vorschläge mit fertigen Buchungen.
 * Kategorien werden am Namen oder am Sachkonto erkannt; unbekannte Kontakte
 * werden als neue Kontakte vorgeschlagen.
 */
export function tabelleZuBuchungen(gelesen, db, opt = {}) {
  const s = db.settings || {};
  const skr = s.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03';
  const klein = s.taxMode === 'kleinunternehmer';
  const konten = (db.accounts || []).filter((a) => a.active !== false);
  const konto = konten.find((a) => a.id === opt.kontoId) || konten.find((a) => a.kind === 'bank') || konten[0];
  const kats = (db.categories || []).filter((c) => c.active !== false);
  const kontakte = new Map((db.contacts || []).map((c) => [norm(c.name), c]));
  const neueKontakte = new Map();
  const vorhanden = new Set((db.transactions || []).map((t) => t.importHash).filter(Boolean));
  const gesehen = new Map();
  const out = [];
  for (const z of gelesen.zeilen) {
    const roh = `${z.datum}|${z.typ}|${z.brutto}|${z.beleg}|${z.text}|${z.kontakt}`;
    const n = (gesehen.get(roh) || 0) + 1;
    gesehen.set(roh, n);
    const hash = `tabelle:${fingerabdruck(`${roh}|${n}`)}`;
    const basis = { nr: z.zeile, datum: z.datum, betrag: z.brutto, text: z.text, beleg: z.beleg, hash, doppelt: vorhanden.has(hash) };
    if (z.storno) { out.push({ ...basis, art: 'aus', grund: `In der Tabelle als „${z.storno}“ markiert; Storno und Gegenbuchung bleiben draußen.` }); continue; }
    const kontoNr = z[skr] || z.konto;
    let kat = z.kategorie ? kats.find((c) => c.kind === z.typ && norm(c.name) === norm(z.kategorie)) || kats.find((c) => norm(c.name) === norm(z.kategorie)) : null;
    if (!kat && kontoNr) kat = kats.find((c) => c.kind === z.typ && String(c[skr] || '') === kontoNr.replace(/\D/g, '')) || null;
    const typ = kat ? kat.kind : z.typ;
    let satz = 0;
    if (!klein && !kat?.private && !kat?.vatNeutral) {
      if (z.satz !== null) satz = z.satz;
      else if (z.netto !== null && z.netto > 0 && z.brutto !== z.netto) satz = Math.round(((z.brutto - z.netto) / z.netto) * 100);
      else if (z.ust !== null && z.ust > 0 && z.brutto > z.ust) satz = Math.round((z.ust / (z.brutto - z.ust)) * 100);
      else if (z.ust === 0 || (z.netto !== null && z.netto === z.brutto)) satz = 0;
      else satz = Number(kat?.vatRate) || 0;
    }
    let t = splitFromGross(z.brutto, satz);
    // Stehen Netto und Steuer ausdrücklich in der Tabelle, gelten sie centgenau.
    if (!klein && satz && z.netto !== null && z.ust !== null && z.netto + z.ust === z.brutto) t = { gross: z.brutto, net: z.netto, vat: z.ust };
    else if (!klein && satz && z.netto !== null && z.ust === null && splitFromNet(z.netto, satz).gross === z.brutto) t = splitFromNet(z.netto, satz);
    let contactId = '';
    if (z.kontakt) {
      const k = kontakte.get(norm(z.kontakt)) || neueKontakte.get(norm(z.kontakt));
      if (k) contactId = k.id;
      else {
        const neu = kontaktEntwurf({ name: z.kontakt, kind: typ === 'income' ? 'customer' : 'supplier' });
        neueKontakte.set(norm(z.kontakt), neu);
        contactId = neu.id;
      }
    }
    const bezahlt = z.hatZahldatum ? z.zahldatum : z.datum;
    const tx = buchungsEntwurf({
      type: typ, date: z.datum, paidDate: bezahlt, dueDate: z.faellig,
      description: (z.text || z.kontakt || kat?.name || (typ === 'income' ? 'Einnahme' : 'Ausgabe')).slice(0, 200),
      categoryId: kat?.id || '', contactId, accountId: konto?.id || '',
      gross: t.gross, net: t.net, vat: t.vat, vatRate: satz, invoiceNumber: z.beleg.slice(0, 60), notes: z.notiz.slice(0, 2000),
      importHash: hash, import: { quelle: 'Tabelle', datei: opt.datei || '' },
    });
    const gruende = [];
    if (!kat) gruende.push(z.kategorie ? `Kategorie „${z.kategorie}“ gibt es nicht; die Buchung kommt ohne Kategorie.` : 'Ohne Kategorie.');
    if (!bezahlt) gruende.push('Noch nicht bezahlt.');
    out.push({ ...basis, art: 'buchung', tx, grund: gruende.join(' ') });
  }
  return { vorschlaege: aehnlicheMarkieren(out, db), neueKontakte: [...neueKontakte.values()] };
}

/**
 * Markiert Vorschläge, zu denen es im Bestand schon eine Buchung gleicher Art
 * mit gleichem Datum und Betrag gibt (etwa beim Einlesen der eigenen Ausgabe).
 * Solche Zeilen sind nicht vorausgewählt, lassen sich aber wählen.
 */
export function aehnlicheMarkieren(vorschlaege, db) {
  const schluessel = (t) => `${t.type}|${t.date}|${t.gross}`;
  const bestand = new Map();
  for (const t of db.transactions || []) {
    if (t.voided || t.isReversal) continue;
    const k = schluessel(t);
    if (!bestand.has(k)) bestand.set(k, []);
    bestand.get(k).push(t);
  }
  for (const v of vorschlaege) {
    if (v.art !== 'buchung' || v.doppelt || !v.tx) continue;
    const treffer = bestand.get(schluessel(v.tx));
    if (!treffer?.length) continue;
    const gleich = treffer.find((t) => norm(t.description) === norm(v.tx.description) || (t.invoiceNumber && t.invoiceNumber === v.tx.invoiceNumber)) || treffer[0];
    v.aehnlich = { id: gleich.id, text: gleich.description || '' };
    v.grund = [v.grund, `Mögliche Dublette: Am selben Tag gibt es schon „${gleich.description || 'eine Buchung'}“ über denselben Betrag.`].filter(Boolean).join(' ');
  }
  return vorschlaege;
}

/* -------------------------------------------------------------------------- */
/* Entwürfe                                                                     */
/* -------------------------------------------------------------------------- */

/** Vollständige Buchung mit allen Feldern, die auch newTransactionDraft (store.js) setzt. */
export function buchungsEntwurf(felder) {
  const jetzt = new Date().toISOString();
  return {
    id: uid('tx'), type: 'expense', date: '', description: '', categoryId: '', contactId: '', accountId: '',
    gross: 0, net: 0, vat: 0, vatRate: 0, paidDate: '', dueDate: '', invoiceNumber: '', reference: '', notes: '', location: '',
    isDeposit: false, depositPercent: 0, eventDate: '', unlisted: false, attachments: [], appointmentIds: [],
    reverseCharge: false, voided: false, createdAt: jetzt, ...felder,
  };
}

/** Kontakt mit den Feldern des Stammdaten-Dialogs (views/master.js). */
export function kontaktEntwurf(f) {
  const land = String(f.country || 'DE').toUpperCase().slice(0, 2) || 'DE';
  const address = f.address || [f.addressExtra, f.street, [f.zip, f.city].filter(Boolean).join(' '), land !== 'DE' ? land : ''].filter(Boolean).join('\n');
  return {
    id: uid('con'), name: zu(f.name).slice(0, 200), kind: f.kind || 'customer', email: zu(f.email).slice(0, 200), phone: zu(f.phone).slice(0, 60),
    addressExtra: zu(f.addressExtra), street: zu(f.street), zip: zu(f.zip), city: zu(f.city), country: land,
    taxId: zu(f.taxId || f.vatId), vatId: zu(f.vatId).replace(/\s/g, '').toUpperCase(), customerNumber: zu(f.customerNumber), buyerReference: '',
    notes: String(f.notes || '').trim().slice(0, 2000), address,
  };
}

/* -------------------------------------------------------------------------- */
/* vCard                                                                        */
/* -------------------------------------------------------------------------- */

/** Quoted-Printable (vCard 2.1) → Text. */
function qpDecode(s, charset = 'utf-8') {
  const bytes = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(t.charCodeAt(i) & 0xff);
  }
  try { return new TextDecoder(/8859|latin|1252/i.test(charset) ? 'windows-1252' : 'utf-8').decode(new Uint8Array(bytes)); } catch { return t; }
}

const vEsc = (s) => String(s ?? '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
/** Teilt an ; und , ohne maskierte Zeichen zu trennen. */
const vTeile = (s, t = ';') => String(s).split(new RegExp(`(?<!\\\\)${t}`)).map(vEsc);

/** Liest eine oder mehrere vCards (2.1, 3.0, 4.0). */
export function vcardLesen(text) {
  // Fortsetzungszeilen beginnen mit Leerzeichen oder Tab; bei 2.1 auch nach „=“ am Zeilenende.
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').replace(/=\n/g, '=\n');
  const karten = [];
  let k = null;
  const zeilen = src.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    let zeile = zeilen[i];
    // Quoted-Printable-Werte enden mit „=“ und gehen in der nächsten Zeile weiter.
    while (/ENCODING=QUOTED-PRINTABLE/i.test(zeile.split(':')[0]) && zeile.endsWith('=') && i + 1 < zeilen.length) zeile = zeile.slice(0, -1) + zeilen[++i];
    if (/^BEGIN:VCARD/i.test(zeile)) { k = { tel: [], email: [], adr: null, org: '', fn: '', n: '', note: '', title: '', url: '' }; continue; }
    if (/^END:VCARD/i.test(zeile)) { if (k) karten.push(k); k = null; continue; }
    if (!k) continue;
    const p = zeile.indexOf(':');
    if (p < 0) continue;
    const kopf = zeile.slice(0, p);
    let wert = zeile.slice(p + 1);
    const [name, ...param] = kopf.split(';');
    const feld = name.replace(/^item\d+\./i, '').toUpperCase();
    const params = param.join(';').toUpperCase();
    if (/QUOTED-PRINTABLE/.test(params)) wert = qpDecode(wert, /CHARSET=([\w-]+)/.exec(params)?.[1] || 'utf-8');
    const typ = /WORK/.test(params) ? 'work' : /HOME/.test(params) ? 'home' : /CELL|MOBILE/.test(params) ? 'cell' : '';
    if (feld === 'FN') k.fn = vEsc(wert).trim();
    else if (feld === 'N') k.n = vTeile(wert).slice(0, 2).reverse().filter(Boolean).join(' ').trim();
    else if (feld === 'ORG') k.org = vTeile(wert)[0].trim();
    else if (feld === 'TEL') k.tel.push({ typ, wert: wert.replace(/^tel:/i, '').trim() });
    else if (feld === 'EMAIL') k.email.push({ typ, wert: wert.replace(/^mailto:/i, '').trim() });
    else if (feld === 'ADR' && (!k.adr || typ === 'work')) {
      const [, zusatz, strasse, ort, , plz, land] = vTeile(wert);
      k.adr = { zusatz: zusatz || '', strasse: strasse || '', ort: ort || '', plz: plz || '', land: land || '' };
    } else if (feld === 'NOTE') k.note = vEsc(wert).trim();
    else if (feld === 'TITLE') k.title = vEsc(wert).trim();
  }
  return karten.map((c) => {
    const name = c.org || c.fn || c.n;
    const bevorzugt = (liste) => (liste.find((x) => x.typ === 'work') || liste[0])?.wert || '';
    const notiz = [c.org && (c.fn || c.n) && c.org !== (c.fn || c.n) ? `Ansprechperson: ${c.fn || c.n}${c.title ? ` (${c.title})` : ''}` : '', c.note].filter(Boolean).join('\n');
    return kontaktEntwurf({
      name, kind: 'customer', email: bevorzugt(c.email), phone: bevorzugt(c.tel),
      addressExtra: c.adr?.zusatz, street: c.adr?.strasse, zip: c.adr?.plz, city: c.adr?.ort, country: landKuerzel(c.adr?.land), notes: notiz,
    });
  }).filter((c) => c.name);
}

/** „Deutschland“, „Germany“, „DE“ → „DE“; Unbekanntes bleibt DE. */
const LAND_NAMEN = {
  deutschland: 'DE', germany: 'DE', oesterreich: 'AT', austria: 'AT', schweiz: 'CH', switzerland: 'CH', frankreich: 'FR', france: 'FR',
  niederlande: 'NL', netherlands: 'NL', belgien: 'BE', belgium: 'BE', italien: 'IT', italy: 'IT', spanien: 'ES', spain: 'ES',
  polen: 'PL', poland: 'PL', daenemark: 'DK', denmark: 'DK', luxemburg: 'LU', luxembourg: 'LU', tschechien: 'CZ', 'vereinigtes koenigreich': 'GB',
  'united kingdom': 'GB', usa: 'US', 'united states': 'US', schweden: 'SE', sweden: 'SE',
};
export function landKuerzel(s) {
  const t = zu(s);
  if (!t) return 'DE';
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return LAND_NAMEN[norm(t)] || 'DE';
}

/* -------------------------------------------------------------------------- */
/* Kontakte und Produkte aus CSV                                                */
/* -------------------------------------------------------------------------- */

const KONTAKT_ROLLEN = [
  ['firma', /^(firma|firmenname|unternehmen|company|organisation|organization 1 - name|organization name|name der firma)$/],
  ['vorname', /^(vorname|first name|given name)$/],
  ['nachname', /^(nachname|last name|family name|surname)$/],
  ['name', /^(name|anzeigename|display name|kontakt|kunde|lieferant|kunde\/lieferant)$/],
  ['art', /^(art|typ|kontaktart|rolle)$/],
  ['email', /^(e-?mail|e-?mail-?adresse|e-?mail address|e-?mail 1 - value|email adresse)$/],
  ['telefon', /^(telefon|telefon geschaeftlich|business phone|phone|phone 1 - value|telefonnummer|mobil|mobile phone)$/],
  ['strasse', /^(strasse|strasse geschaeftlich|business street|street|address 1 - street|adresse|strasse und hausnummer|anschrift strasse)$/],
  ['plz', /^(plz|postleitzahl|postleitzahl geschaeftlich|business postal code|postal code|address 1 - postal code|zip)$/],
  ['ort', /^(ort|stadt|ort geschaeftlich|business city|city|address 1 - city)$/],
  ['land', /^(land|land\/region geschaeftlich|business country\/region|country|address 1 - country|staat)$/],
  ['anschrift', /^(anschrift|address)$/],
  ['ustid', /^(ust-?idnr\.?|ust-?id|umsatzsteuer-?id|ust-?identifikationsnummer|vat id|vat number)$/],
  ['steuernummer', /^(steuernummer|steuernummer\/ust-?idnr|tax number)$/],
  ['kundennummer', /^(kundennummer|kunden-?nr\.?|lieferantennummer|kontonummer|nummer|customer number|debitorennummer|kreditorennummer)$/],
  ['notiz', /^(notiz|notizen|bemerkung|notes|kommentar)$/],
];

function rollenSpalten(kopf, rollen) {
  const spalten = {};
  kopf.forEach((k, i) => {
    const n = norm(k).replace(/[()*:]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [r, re] of rollen) if (re.test(n) && !(r in spalten)) { spalten[r] = i; break; }
  });
  return spalten;
}

function tabelleMitKopf(text, rollen, mindestens = 2) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const trenner = csvTrenner(src);
  const roh = csvZeilen(src, trenner);
  let kopfzeile = -1; let best = mindestens - 1;
  for (let i = 0; i < Math.min(roh.length, 30); i++) {
    const p = Object.keys(rollenSpalten(roh[i], rollen)).length;
    if (p > best) { best = p; kopfzeile = i; }
  }
  if (kopfzeile < 0) return null;
  return { spalten: rollenSpalten(roh[kopfzeile], rollen), daten: roh.slice(kopfzeile + 1, kopfzeile + 1 + MAX_ZEILEN), kopfzeile };
}

/** Kontakte aus einer CSV-Tabelle (Outlook, Google, lexoffice, Kontovia). */
export function kontakteCsvLesen(text) {
  const t = tabelleMitKopf(text, KONTAKT_ROLLEN);
  if (!t || !(['firma', 'name', 'nachname'].some((r) => r in t.spalten))) throw Object.assign(new Error('In der Tabelle fehlt eine Spalte mit dem Namen oder der Firma.'), { code: 'KOPF' });
  const out = [];
  for (const r of t.daten) {
    const z = (rolle) => (rolle in t.spalten ? zu(r[t.spalten[rolle]]) : '');
    const person = [z('vorname'), z('nachname')].filter(Boolean).join(' ');
    const name = z('firma') || z('name') || person;
    if (!name) continue;
    const art = norm(z('art'));
    const kind = /lieferant|supplier|kreditor/.test(art) ? 'supplier' : /kunde.*lieferant|beides|both/.test(art) ? 'both' : 'customer';
    const ust = z('ustid').replace(/\s/g, '').toUpperCase();
    const freieAnschrift = z('anschrift');
    let strasse = z('strasse'); let plz = z('plz'); let ort = z('ort');
    if (!strasse && freieAnschrift) {
      const m = /^(.*?)[,\n]\s*(\d{4,5})\s+(.+)$/.exec(freieAnschrift);
      if (m) [, strasse, plz, ort] = m;
    }
    out.push(kontaktEntwurf({
      name, kind: /kunde & lieferant|kunde und lieferant/.test(art) ? 'both' : kind, email: z('email'), phone: z('telefon'),
      street: strasse, zip: plz, city: ort, country: landKuerzel(z('land')),
      vatId: /^[A-Z]{2}[0-9A-Z]/.test(ust) ? ust : '', taxId: ust || z('steuernummer'), customerNumber: z('kundennummer'),
      notes: [z('firma') && person ? `Ansprechperson: ${person}` : '', z('notiz')].filter(Boolean).join('\n'),
    }));
  }
  return out;
}

const PRODUKT_ROLLEN = [
  ['nummer', /^(artikelnummer|artikel-?nr\.?|art\.?-?nr\.?|sku|produktnummer|nummer|item number)$/],
  ['name', /^(bezeichnung|name|artikel|produkt|produktname|artikelname|titel|leistung)$/],
  ['beschreibung', /^(beschreibung|langtext|details|description)$/],
  ['netto', /^(preis|preis netto|nettopreis|einzelpreis|einzelpreis netto|vk netto|verkaufspreis netto|netto|price)( eur| in eur)?$/],
  ['brutto', /^(preis brutto|bruttopreis|vk brutto|verkaufspreis brutto|brutto)( eur| in eur)?$/],
  ['einheit', /^(einheit|mengeneinheit|je einheit|unit)$/],
  ['satz', /(ust|mwst|steuer)[- ]?(satz|prozent)|^steuersatz$|^ust$|^mwst$|^umsatzsteuer$|^vat$/],
  ['kategorie', /^(kategorie|warengruppe|gruppe|category)$/],
];

/** Produkte aus einer CSV-Tabelle. Preise in Cent netto. */
export function produkteCsvLesen(text, { standardSatz = 19 } = {}) {
  const t = tabelleMitKopf(text, PRODUKT_ROLLEN);
  if (!t || !('name' in t.spalten)) throw Object.assign(new Error('In der Tabelle fehlt die Spalte Bezeichnung oder Name.'), { code: 'KOPF' });
  const out = [];
  for (const r of t.daten) {
    const z = (rolle) => (rolle in t.spalten ? zu(r[t.spalten[rolle]]) : '');
    const name = z('name');
    if (!name) continue;
    const satzText = z('satz').replace('%', '').trim();
    let satz = satzText ? Number(satzText.replace(',', '.')) : standardSatz;
    if (![0, 7, 19].includes(satz)) satz = standardSatz;
    let preis = betragLesen(z('netto'));
    const brutto = betragLesen(z('brutto'));
    if (preis === null && brutto !== null) preis = splitFromGross(brutto, satz).net;
    const e = einheitAusText(z('einheit') || 'Stk.');
    out.push({
      id: uid('prod'), name: name.slice(0, 200), beschreibung: z('beschreibung').slice(0, 2000), kategorie: z('kategorie').slice(0, 80),
      artikelnummer: z('nummer').slice(0, 60), einheit: e.code, einheitText: e.text, preis: preis || 0, satz, active: true,
    });
  }
  return out;
}

/**
 * Was steht in einer Tabelle? 'buchungen', 'kontakte', 'produkte' oder ''.
 * Entscheidet nach der Zahl erkannter Überschriften und typischen Spalten.
 */
export function tabellenArt(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const roh = csvZeilen(src, csvTrenner(src)).slice(0, 30);
  const punkte = (rolleFn) => Math.max(0, ...roh.map((z) => z.filter((k) => rolleFn(k)).length));
  const rolleAus = (rollen) => (k) => { const n = norm(k).replace(/[()*:]/g, ' ').replace(/\s+/g, ' ').trim(); return rollen.some(([, re]) => re.test(n)); };
  const hat = (re) => roh.some((z) => z.some((k) => re.test(norm(k))));
  const p = {
    buchungen: punkte(rolleBuchung) + (hat(/^(brutto|netto|ust|mwst|einnahme|ausgabe|kategorie|belegdatum)/) ? 2 : 0),
    kontakte: punkte(rolleAus(KONTAKT_ROLLEN)) + (hat(/e-?mail|vorname|nachname|telefon|plz|postleitzahl/) ? 2 : 0),
    produkte: punkte(rolleAus(PRODUKT_ROLLEN)) + (hat(/artikel|einheit|einzelpreis|sku/) ? 2 : 0),
  };
  const [best, wert] = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  return wert >= 3 ? best : '';
}

/* -------------------------------------------------------------------------- */
/* Dubletten bei Stammdaten                                                     */
/* -------------------------------------------------------------------------- */

/** Markiert Kontakte, die es schon gibt (gleicher Name oder gleiche E-Mail), und doppelte in der Datei. */
export function kontakteAbgleichen(liste, db) {
  const namen = new Set((db.contacts || []).map((c) => norm(c.name)));
  const mails = new Set((db.contacts || []).map((c) => norm(c.email)).filter(Boolean));
  const datei = new Set();
  return liste.map((c) => {
    const n = norm(c.name);
    const doppelt = namen.has(n) || (c.email && mails.has(norm(c.email)));
    const wiederholt = datei.has(n);
    datei.add(n);
    return { kontakt: c, doppelt: !!doppelt, grund: doppelt ? 'Gibt es schon.' : wiederholt ? 'Steht mehrfach in der Datei.' : '', wiederholt };
  });
}

/** Markiert Produkte, die es schon gibt (gleiche Artikelnummer oder gleicher Name). */
export function produkteAbgleichen(liste, db) {
  const nr = new Set((db.products || []).map((p) => norm(p.artikelnummer)).filter(Boolean));
  const namen = new Set((db.products || []).map((p) => norm(p.name)));
  return liste.map((p) => {
    const doppelt = (p.artikelnummer && nr.has(norm(p.artikelnummer))) || namen.has(norm(p.name));
    return { produkt: p, doppelt: !!doppelt, grund: doppelt ? 'Gibt es schon.' : '' };
  });
}
