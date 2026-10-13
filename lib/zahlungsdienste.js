/**
 * Kontovia – Exporte von Zahlungsdiensten lesen: PayPal (Aktivitäten als CSV)
 * und Stripe (Zahlungen oder Saldo-Bewegungen als CSV).
 *
 * Wer Rechnungen mit dem Link zum Online-Bezahlen verschickt (rechnung.js:
 * bezahlLinkFuer), sieht auf dem Bankkonto nur die Sammelauszahlung des
 * Dienstes. Die einzelnen Zahlungen stehen im Export des Dienstes, mit Name,
 * E-Mail-Adresse des Zahlers, Betreff oder Rechnungsnummer und Gebühr. Diese
 * Datei macht daraus Umsätze in derselben Form wie lib/kontoauszug.js, damit
 * lib/zuordnung.js sie offenen Rechnungen zuordnet:
 *
 *   Zahlung        Brutto, Gegenseite, `gegenEmail`, Zweck aus Betreff/Notiz/
 *                  Rechnungsnummer, Referenz = Transaktionscode
 *   Gebühr         eigener Umsatz (negativ), Gegenseite = Dienst
 *   Auszahlung     `uebertrag: true` (Geld wandert zwischen eigenen Konten,
 *                  lib/zuordnung.js bucht es nicht)
 *
 * Nur gebuchte Vorgänge zählen (PayPal „Abgeschlossen“, ohne reine Vermerke
 * wie Einbehalte; Stripe „Paid“/„succeeded“). Die Datei wird nur gelesen,
 * nichts geht an PayPal oder Stripe; eine Verbindung zum Dienst gibt es nicht.
 * Ohne Oberfläche und Speicher, geprüft in scripts/pruefungen/kontoauszug.test.js.
 */

import { norm } from './util.js';
import { csvTrenner, csvZeilen, betragLesen, datumLesen } from './kontoauszug.js';

const zu = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const kopfNorm = (s) => norm(zu(s).replace(/^﻿/, '')).replace(/[()"]/g, ' ').replace(/\s+/g, ' ').trim();

/** Spalten je Dienst, erkannt an der Überschrift (deutsch und englisch). */
const SPALTEN = {
  paypal: {
    datum: /^(datum|date)$/,
    name: /^name$/,
    typ: /^(typ|type)$/,
    status: /^status$/,
    waehrung: /^(waehrung|currency)$/,
    brutto: /^(brutto|gross)$/,
    gebuehr: /^(gebuehr|entgelt|fee)$/,
    von: /^(absender e-mail-adresse|from email address)$/,
    an: /^(empfaenger e-mail-adresse|to email address)$/,
    code: /^(transaktionscode|transaction id)$/,
    artikel: /^(artikelbezeichnung|item title)$/,
    rechnung: /^(rechnungsnummer|invoice number)$/,
    betreff: /^(betreff|subject)$/,
    hinweis: /^(hinweis|note)$/,
    wirkung: /^(auswirkung auf guthaben|balance impact)$/,
  },
  stripe: {
    id: /^id$/,
    datum: /^(created date utc|created utc|created)$/,
    typ: /^type$/,
    status: /^status$/,
    betrag: /^amount$/,
    erstattet: /^amount refunded$/,
    waehrung: /^currency$/,
    umgerechnet: /^converted amount$/,
    umgerechnetErstattet: /^converted amount refunded$/,
    umgerechnetWaehrung: /^converted currency$/,
    gebuehr: /^fee$/,
    beschreibung: /^description$/,
    kunde: /^(customer description|customer name|card name)$/,
    email: /^customer email$/,
    rechnung: /^(invoice number|invoice_number metadata|rechnungsnummer metadata|invoice id)$/,
  },
};

function spaltenSuchen(kopf, dienst) {
  const namen = kopf.map(kopfNorm);
  const out = {};
  for (const [rolle, re] of Object.entries(SPALTEN[dienst])) {
    const i = namen.findIndex((n) => re.test(n));
    if (i >= 0) out[rolle] = i;
  }
  return out;
}

/**
 * Stammt die Kopfzeile aus einem Export von PayPal oder Stripe?
 * @param {string[]} kopf
 * @returns {''|'paypal'|'stripe'}
 */
export function zahlungsdienstErkennen(kopf) {
  if (!Array.isArray(kopf) || kopf.length < 5) return '';
  const p = spaltenSuchen(kopf, 'paypal');
  if (['datum', 'name', 'brutto', 'code'].every((r) => r in p) && ('typ' in p || 'status' in p)) return 'paypal';
  const s = spaltenSuchen(kopf, 'stripe');
  if (['id', 'datum', 'betrag', 'waehrung'].every((r) => r in s) && ('gebuehr' in s || 'umgerechnet' in s)) return 'stripe';
  return '';
}

/** Sucht in den ersten Zeilen eines CSV-Textes die Kopfzeile eines Dienstes. */
export function dienstImText(text) {
  const anfang = String(text).replace(/^﻿/, '').split(/\r?\n/).slice(0, 20).join('\n');
  const zeilen = csvZeilen(anfang, csvTrenner(anfang));
  for (const z of zeilen) { const d = zahlungsdienstErkennen(z); if (d) return d; }
  return '';
}

/**
 * Ein eigenes Konto für einen Zahlungsdienst: die Art „Zahlungsdienst“ oder (aus Zeiten vor dieser Art) ein
 * Konto, das PayPal oder Stripe heißt. `dienst` grenzt auf einen Dienst ein.
 */
export function istDienstKonto(a, dienst = '') {
  if (!a || a.active === false) return false;
  const name = norm(a.name);
  if (dienst) return name.includes(dienst) || (a.kind === 'zahlungsdienst' && !/paypal|stripe/.test(name));
  return a.kind === 'zahlungsdienst' || /paypal|stripe/.test(name);
}

/** Name des Dienstes für Oberfläche und Gegenseite. */
export const DIENSTNAME = { paypal: 'PayPal', stripe: 'Stripe' };

/** Datum mit Schrägstrichen: Tag/Monat oder Monat/Tag, entschieden an allen Zeilen der Datei. */
function datumsLeser(werte) {
  let tagZuerst = 0; let monatZuerst = 0;
  for (const w of werte) {
    const m = /^(\d{1,2})\/(\d{1,2})\/\d{2,4}/.exec(zu(w));
    if (!m) continue;
    if (Number(m[1]) > 12) tagZuerst++;
    if (Number(m[2]) > 12) monatZuerst++;
  }
  const us = monatZuerst > tagZuerst;
  return (w) => {
    const t = zu(w);
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
    if (m && us) return datumLesen(`${m[2]}.${m[1]}.${m[3]}`);
    return datumLesen(t);
  };
}

/** Dezimalzeichen einer Betragsspalte: mehr Werte mit „,dd“ am Ende heißt Komma. */
function dezimalVon(werte) {
  let komma = 0; let punkt = 0;
  for (const w of werte.slice(0, 400)) {
    const t = zu(w);
    if (/,\d{1,2}$/.test(t)) komma++;
    else if (/\.\d{1,2}$/.test(t)) punkt++;
  }
  return komma > punkt ? 'komma' : 'punkt';
}

const umsatz = (o) => ({
  datum: '', valuta: '', betrag: 0, waehrung: 'EUR', gegenseite: '', gegenIban: '', gegenBic: '', gegenEmail: '', zweck: '', buchungstext: '', referenz: '', zeile: 0, ...o,
});

/** Typen von PayPal, bei denen Geld zwischen eigenen Konten wandert (Auszahlung aufs Bankkonto, Aufladen vom Bankkonto). */
const PAYPAL_UEBERTRAG = /abbuchung|auszahlung|bankgutschrift|aufladung|kontoauffuellung|einzahlung|withdrawal|deposit|transfer to bank|transfer from bank|payout/;
/** Reine Vermerke ohne Wirkung auf das Guthaben oder Umrechnungen innerhalb von PayPal. */
const PAYPAL_VERMERK = /einbehalt|hold|autorisierung|authori[sz]ation|waehrungsumrechnung|currency conversion/;

/**
 * Liest einen Export von PayPal oder Stripe.
 * @param {string} text
 * @param {''|'paypal'|'stripe'} [dienst]  ohne Angabe erkannt
 * @returns {object} wie lib/kontoauszug.js: csvLesen ({ format, umsaetze, uebersprungen, konto, kopf … })
 */
export function zahlungsdienstLesen(text, dienst = '') {
  const trenner = csvTrenner(text);
  const zeilen = csvZeilen(String(text).replace(/^﻿/, ''), trenner);
  let kopfzeile = -1;
  for (let i = 0; i < Math.min(zeilen.length, 20); i++) {
    const d = zahlungsdienstErkennen(zeilen[i]);
    if (d && (!dienst || d === dienst)) { kopfzeile = i; dienst = d; break; }
  }
  if (kopfzeile < 0) throw Object.assign(new Error('Die Datei sieht nicht wie ein Export von PayPal oder Stripe aus.'), { code: 'FORMAT' });
  const kopf = zeilen[kopfzeile].map(zu);
  const sp = spaltenSuchen(kopf, dienst);
  const daten = zeilen.slice(kopfzeile + 1);
  const z = (r, rolle) => (rolle in sp && sp[rolle] < r.length ? zu(r[sp[rolle]]) : '');
  const datum = datumsLeser(daten.map((r) => z(r, 'datum')));
  const name = DIENSTNAME[dienst];
  const umsaetze = [];
  const uebersprungen = [];
  const weg = (nr, r, grund) => uebersprungen.push({ zeile: nr, grund, text: r.map(zu).filter(Boolean).join(' ').slice(0, 80) });

  if (dienst === 'paypal') {
    const dez = dezimalVon(daten.map((r) => z(r, 'brutto')));
    daten.forEach((r, i) => {
      const nr = kopfzeile + i + 2;
      if (r.every((c) => !zu(c))) return;
      const d = datum(z(r, 'datum'));
      const brutto = betragLesen(z(r, 'brutto'), dez);
      if (!d || brutto === null) { weg(nr, r, !d ? 'kein Datum' : 'kein Betrag'); return; }
      const status = norm(z(r, 'status'));
      if (status && !/abgeschlossen|completed|gebucht/.test(status)) { weg(nr, r, `Status „${z(r, 'status')}“, noch nicht abgeschlossen`); return; }
      const typ = z(r, 'typ');
      const wirkung = norm(z(r, 'wirkung'));
      if (wirkung === 'memo' || wirkung === 'vermerk' || PAYPAL_VERMERK.test(norm(typ))) { weg(nr, r, `${typ || 'Vermerk'}, ändert das Guthaben nicht`); return; }
      const waehrung = (z(r, 'waehrung') || 'EUR').toUpperCase().slice(0, 3);
      const code = z(r, 'code');
      const gebuehr = betragLesen(z(r, 'gebuehr'), dez) || 0;
      const ein = brutto > 0;
      const gegen = z(r, 'name');
      const uebertrag = PAYPAL_UEBERTRAG.test(norm(typ));
      const zweck = [z(r, 'betreff'), z(r, 'hinweis'), z(r, 'artikel'), z(r, 'rechnung') ? `Rechnung ${z(r, 'rechnung')}` : ''].filter(Boolean).join(' · ');
      umsaetze.push(umsatz({
        datum: d, betrag: brutto, waehrung, gegenseite: gegen || (uebertrag ? 'Bankkonto' : name),
        gegenEmail: (ein ? z(r, 'von') : z(r, 'an')).toLowerCase(),
        zweck: zweck || typ, buchungstext: typ, referenz: code, zeile: nr, dienst, uebertrag,
      }));
      // PayPal gibt die Gebühr mit Vorzeichen an (−0,85); ohne Vorzeichen ist sie trotzdem eine Ausgabe.
      if (gebuehr) {
        umsaetze.push(umsatz({
          datum: d, betrag: -Math.abs(gebuehr), waehrung, gegenseite: name,
          zweck: `Zahlungsdienstgebühr zu ${gegen || code}${code ? ` (${code})` : ''}`, buchungstext: 'Gebühr', referenz: code ? `${code}-gebuehr` : '', zeile: nr, dienst, gebuehr: true,
        }));
      }
    });
  } else {
    const dez = dezimalVon(daten.map((r) => z(r, 'betrag')));
    daten.forEach((r, i) => {
      const nr = kopfzeile + i + 2;
      if (r.every((c) => !zu(c))) return;
      const d = datum(z(r, 'datum'));
      let betrag = betragLesen(z(r, 'betrag'), dez);
      if (!d || betrag === null) { weg(nr, r, !d ? 'kein Datum' : 'kein Betrag'); return; }
      const status = norm(z(r, 'status'));
      // Zahlungen-Export: „Paid“, „Refunded“ und „Partially refunded“ sind geflossen; „Failed“ und „Canceled“ nicht.
      if (status && !/paid|succeeded|refunded|available|pending payout/.test(status)) { weg(nr, r, `Status „${z(r, 'status')}“, nicht bezahlt`); return; }
      let waehrung = (z(r, 'waehrung') || 'EUR').toUpperCase().slice(0, 3);
      let erstattet = betragLesen(z(r, 'erstattet'), dez) || 0;
      // Stripe rechnet Fremdwährungen selbst in die Auszahlungswährung um; liegt sie in Euro vor, gilt dieser Betrag.
      const umg = betragLesen(z(r, 'umgerechnet'), dez);
      if (waehrung !== 'EUR' && umg !== null && (z(r, 'umgerechnetWaehrung') || 'EUR').toUpperCase() === 'EUR') {
        betrag = umg; waehrung = 'EUR';
        erstattet = betragLesen(z(r, 'umgerechnetErstattet'), dez) || 0;
      }
      const typ = norm(z(r, 'typ'));
      const id = z(r, 'id');
      const gegen = z(r, 'kunde') || z(r, 'email') || '';
      const beschreibung = z(r, 'beschreibung');
      const rechnung = z(r, 'rechnung');
      const uebertrag = /payout|transfer/.test(typ);
      if (typ === 'stripe_fee' || typ === 'application_fee') {
        umsaetze.push(umsatz({ datum: d, betrag: -Math.abs(betrag), waehrung, gegenseite: name, zweck: `Zahlungsdienstgebühr ${beschreibung}`.trim(), buchungstext: 'Gebühr', referenz: id, zeile: nr, dienst, gebuehr: true }));
        return;
      }
      umsaetze.push(umsatz({
        datum: d, betrag: uebertrag ? -Math.abs(betrag) : (typ === 'refund' ? -Math.abs(betrag) : betrag), waehrung,
        gegenseite: uebertrag ? 'Bankkonto' : (gegen || name), gegenEmail: z(r, 'email').toLowerCase(),
        zweck: [beschreibung, rechnung && !beschreibung.includes(rechnung) ? `Rechnung ${rechnung}` : ''].filter(Boolean).join(' · ') || (uebertrag ? 'Auszahlung' : 'Zahlung'),
        buchungstext: z(r, 'typ') || 'Zahlung', referenz: id, zeile: nr, dienst, uebertrag,
      }));
      if (erstattet > 0 && !typ) {
        umsaetze.push(umsatz({ datum: d, betrag: -erstattet, waehrung, gegenseite: gegen || name, gegenEmail: z(r, 'email').toLowerCase(), zweck: `Erstattung ${beschreibung}`.trim(), buchungstext: 'Erstattung', referenz: `${id}-erstattung`, zeile: nr, dienst }));
      }
      const gebuehr = betragLesen(z(r, 'gebuehr'), dez) || 0;
      if (gebuehr && !uebertrag) {
        umsaetze.push(umsatz({ datum: d, betrag: -Math.abs(gebuehr), waehrung: 'EUR', gegenseite: name, zweck: `Zahlungsdienstgebühr zu ${gegen || id}`, buchungstext: 'Gebühr', referenz: `${id}-gebuehr`, zeile: nr, dienst, gebuehr: true }));
      }
    });
  }
  return {
    format: dienst, dienst, trenner, zeilen, kopfzeile, kopf, spalten: sp, erkannt: sp, dezimal: '', signatur: '',
    umsaetze, uebersprungen, konto: { iban: '' },
  };
}

/**
 * Eine Gutschrift auf dem Bankkonto, die wie die Auszahlung eines Zahlungsdienstes aussieht.
 * Nur Eingänge: Abbuchungen von PayPal sind meist Einkäufe und bleiben gewöhnliche Ausgaben.
 */
export function istDienstAuszahlung(u) {
  if (!u || !(u.betrag > 0) || u.dienst) return false;
  const wer = norm(`${u.gegenseite} ${u.buchungstext}`);
  const was = norm(`${u.zweck} ${u.buchungstext}`);
  if (/stripe/.test(wer)) return /payout|auszahlung|stripe/.test(was);
  if (/paypal/.test(wer)) return /auszahlung|abbuchung vom paypal|transfer|payout|withdrawal/.test(was);
  return false;
}
