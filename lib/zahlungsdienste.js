/**
 * Kontovia – Exporte von Zahlungsdiensten und Marktplätzen lesen: PayPal (Aktivitäten als CSV),
 * Stripe (Zahlungen oder Saldo-Bewegungen als CSV) und, seit SEC-64, Berichte
 * von Shopify, Etsy und Amazon (Abschnitt „Marktplätze“).
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
  for (const [rolle, re] of Object.entries(SPALTEN[dienst] || MARKT_SPALTEN[dienst])) {
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

/* -------------------------------------------------------------------------- */
/* Marktplätze (SEC-64)                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Berichte von Shopify (Zahlungen, „Transaktionen exportieren“), Etsy
 * (Monatsabrechnung als CSV) und Amazon (Transaktionsansicht des
 * Datumsbereichsberichts, deutsch und englisch), in derselben Form:
 *
 *   Verkauf        Brutto als Einnahme, Referenz = Bestellnummer
 *   Gebühr         eigener Umsatz (`gebuehr: true`), Gegenseite = Marktplatz;
 *                  zurückerstattete Gebühren positiv
 *   Erstattung     negativer Umsatz
 *   Auszahlung     `uebertrag: true` (Geld wandert aufs eigene Bankkonto)
 *
 * Das Land des Käufers (`land`, ISO-Code) kommt nur mit, wenn die Datei eine
 * Spalte dafür hat; die üblichen Auszahlungsberichte haben keine. Mit Land
 * bucht lib/importaktionen.js einen Verkauf in ein anderes EU-Land als OSS,
 * sobald der One-Stop-Shop gilt.
 */

/** Spalte mit dem Land des Käufers, falls der Bericht eine hat (alle Marktplätze). */
const LAND = /^(country|land|billing country|shipping country|ship country|ship to country|buyer country|lieferland|versandland|rechnungsland|land des kaeufers)$/;

const MARKT_SPALTEN = {
  shopify: {
    datum: /^transaction date$/,
    typ: /^type$/,
    bestellung: /^order$/,
    status: /^payout status$/,
    auszahlungDatum: /^payout date$/,
    auszahlungId: /^payout id$/,
    betrag: /^amount$/,
    gebuehr: /^fee$/,
    netto: /^net$/,
    waehrung: /^currency$/,
    land: LAND,
  },
  etsy: {
    datum: /^(date|datum)$/,
    typ: /^(type|typ|art)$/,
    titel: /^(title|titel)$/,
    info: /^info$/,
    waehrung: /^(currency|waehrung)$/,
    betrag: /^(amount|betrag)$/,
    gebuehr: /^(fees & taxes|gebuehren & steuern|gebuehren und steuern)$/,
    netto: /^(net|netto)$/,
    land: LAND,
  },
  amazon: {
    datum: /^(date\/time|datum\/uhrzeit)$/,
    typ: /^(type|typ)$/,
    bestellung: /^(order id|bestellnummer)$/,
    beschreibung: /^(description|beschreibung)$/,
    marktplatz: /^(marketplace)$/,
    verkaufsgebuehr: /^(selling fees|verkaufsgebuehren)$/,
    fba: /^(fba fees|gebuehren zu versand durch amazon)$/,
    andereGebuehr: /^(other transaction fees|andere transaktionsgebuehren)$/,
    gesamt: /^(total|gesamt)$/,
    land: LAND,
  },
};

/**
 * Stammt die Kopfzeile aus einem Bericht von Shopify, Etsy oder Amazon?
 * @param {string[]} kopf
 * @returns {''|'shopify'|'etsy'|'amazon'}
 */
export function marktplatzErkennen(kopf) {
  if (!Array.isArray(kopf) || kopf.length < 5) return '';
  const s = spaltenSuchen(kopf, 'shopify');
  if (['datum', 'typ', 'bestellung', 'betrag', 'gebuehr', 'netto', 'auszahlungId'].every((r) => r in s)) return 'shopify';
  const e = spaltenSuchen(kopf, 'etsy');
  if (['datum', 'typ', 'titel', 'betrag', 'gebuehr', 'netto'].every((r) => r in e)) return 'etsy';
  const a = spaltenSuchen(kopf, 'amazon');
  if (['datum', 'typ', 'bestellung', 'verkaufsgebuehr', 'gesamt'].every((r) => r in a)) return 'amazon';
  return '';
}

/** Name des Marktplatzes für Oberfläche und Gegenseite. */
export const MARKTNAME = { shopify: 'Shopify', etsy: 'Etsy', amazon: 'Amazon' };

const MONATE = { jan: 1, feb: 2, mar: 3, mae: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

/** Datum auch mit Monatsnamen („Sep 12, 2026“, „12 Sep 2026“, „12. September 2026“), wie Etsy und Amazon es schreiben. */
export function datumMitMonat(s) {
  const t = zu(s).replace(/[T ]\d{1,2}:\d{2}.*$/, '');
  const d = datumLesen(t);
  if (d) return d;
  let m = /^(\d{1,2})\.?\s+([a-zäöü]+)\.?,?\s+(\d{4})$/i.exec(t);
  let tag; let name; let jahr;
  if (m) [, tag, name, jahr] = m;
  else if ((m = /^([a-zäöü]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(t))) [, name, tag, jahr] = m;
  else return null;
  const monat = MONATE[norm(name).slice(0, 3)];
  return monat ? datumLesen(`${tag}.${monat}.${jahr}`) : null;
}

/** EU-Länder mit Namen (englisch und deutsch, klein, ohne Umlaute) → ISO-Code. */
const LAENDER = {
  austria: 'AT', oesterreich: 'AT', belgium: 'BE', belgien: 'BE', bulgaria: 'BG', bulgarien: 'BG', croatia: 'HR', kroatien: 'HR',
  cyprus: 'CY', zypern: 'CY', czechia: 'CZ', 'czech republic': 'CZ', tschechien: 'CZ', denmark: 'DK', daenemark: 'DK',
  estonia: 'EE', estland: 'EE', finland: 'FI', finnland: 'FI', france: 'FR', frankreich: 'FR', germany: 'DE', deutschland: 'DE',
  greece: 'GR', griechenland: 'GR', hungary: 'HU', ungarn: 'HU', ireland: 'IE', irland: 'IE', italy: 'IT', italien: 'IT',
  latvia: 'LV', lettland: 'LV', lithuania: 'LT', litauen: 'LT', luxembourg: 'LU', luxemburg: 'LU', malta: 'MT',
  netherlands: 'NL', 'the netherlands': 'NL', niederlande: 'NL', poland: 'PL', polen: 'PL', portugal: 'PT',
  romania: 'RO', rumaenien: 'RO', slovakia: 'SK', slowakei: 'SK', slovenia: 'SI', slowenien: 'SI', spain: 'ES', spanien: 'ES',
  sweden: 'SE', schweden: 'SE',
};

/** Land als ISO-Code (zwei Buchstaben oder EU-Name), sonst leer. Griechenland heißt auch EL. */
export function landCode(s) {
  const t = zu(s);
  if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase() === 'EL' ? 'GR' : t.toUpperCase();
  return LAENDER[norm(t)] || '';
}

/** Amazon nennt keine Währung, nur den Marktplatz; die Abrechnung läuft in dessen Landeswährung. */
const amazonWaehrung = (m) => {
  const t = norm(m);
  return /\.co\.uk$/.test(t) ? 'GBP' : /\.com$/.test(t) ? 'USD' : /\.se$/.test(t) ? 'SEK' : /\.pl$/.test(t) ? 'PLN' : 'EUR';
};

/** Etsy schreibt Beträge mit Währungszeichen und „--“ für leer; als Zahl oder null. */
const etsyBetrag = (s, dez) => (/^-+$/.test(zu(s)) ? null : betragLesen(zu(s).replace(/[A-Z]{3}$/, ''), dez));

/**
 * Liest einen Bericht von Shopify, Etsy oder Amazon.
 * @param {string} text
 * @param {''|'shopify'|'etsy'|'amazon'} [quelle]  ohne Angabe erkannt
 * @returns {object} wie lib/kontoauszug.js: csvLesen ({ format, umsaetze, uebersprungen, konto, kopf … })
 */
export function marktplatzLesen(text, quelle = '') {
  const roh = String(text).replace(/^﻿/, '');
  // Das Trennzeichen an der Kopfzeile: Amazon schreibt Erklärtext darüber, der die Zählung stört.
  let trenner = csvTrenner(roh);
  for (const zeile of roh.split(/\r?\n/).slice(0, 20)) {
    const t = [',', ';', '\t'].find((x) => marktplatzErkennen(csvZeilen(zeile, x)[0] || []));
    if (t) { trenner = t; break; }
  }
  const zeilen = csvZeilen(roh, trenner);
  let kopfzeile = -1;
  for (let i = 0; i < Math.min(zeilen.length, 20); i++) {
    const q = marktplatzErkennen(zeilen[i]);
    if (q && (!quelle || q === quelle)) { kopfzeile = i; quelle = q; break; }
  }
  if (kopfzeile < 0) throw Object.assign(new Error('Die Datei sieht nicht wie ein Bericht von Shopify, Etsy oder Amazon aus.'), { code: 'FORMAT' });
  const kopf = zeilen[kopfzeile].map(zu);
  const sp = spaltenSuchen(kopf, quelle);
  const daten = zeilen.slice(kopfzeile + 1);
  const z = (r, rolle) => (rolle in sp && sp[rolle] < r.length ? zu(r[sp[rolle]]) : '');
  const name = MARKTNAME[quelle];
  const umsaetze = [];
  const uebersprungen = [];
  const weg = (nr, r, grund) => uebersprungen.push({ zeile: nr, grund, text: r.map(zu).filter(Boolean).join(' ').slice(0, 80) });
  const gebuehrZeile = (o) => umsatz({ gegenseite: name, buchungstext: 'Gebühr', dienst: quelle, gebuehr: true, ...o });

  if (quelle === 'shopify') {
    const dez = dezimalVon(daten.map((r) => z(r, 'betrag')));
    /** Je Auszahlung die Summe der Nettobeträge: Das ist der Übertrag aufs Bankkonto. */
    const auszahlungen = new Map();
    daten.forEach((r, i) => {
      const nr = kopfzeile + i + 2;
      if (r.every((c) => !zu(c))) return;
      const d = datumMitMonat(z(r, 'datum'));
      const betrag = betragLesen(z(r, 'betrag'), dez);
      if (!d || betrag === null) { weg(nr, r, !d ? 'kein Datum' : 'kein Betrag'); return; }
      const typ = norm(z(r, 'typ'));
      const waehrung = (z(r, 'waehrung') || 'EUR').toUpperCase().slice(0, 3);
      const bestellung = z(r, 'bestellung');
      const gebuehr = betragLesen(z(r, 'gebuehr'), dez) || 0;
      const netto = betragLesen(z(r, 'netto'), dez) ?? betrag - gebuehr;
      if (typ === 'payout') {
        umsaetze.push(umsatz({ datum: d, betrag: -Math.abs(betrag), waehrung, gegenseite: 'Bankkonto', zweck: 'Auszahlung', buchungstext: 'Auszahlung', referenz: z(r, 'auszahlungId'), zeile: nr, dienst: quelle, uebertrag: true }));
        return;
      }
      const erstattung = typ === 'refund';
      const land = landCode(z(r, 'land'));
      umsaetze.push(umsatz({
        datum: d, betrag, waehrung, gegenseite: name,
        zweck: `${erstattung ? 'Erstattung' : typ === 'charge' ? 'Verkauf' : z(r, 'typ')}${bestellung ? ` Bestellung ${bestellung}` : ''}`,
        buchungstext: erstattung ? 'Erstattung' : typ === 'charge' || !typ ? 'Verkauf' : z(r, 'typ'), referenz: bestellung ? `${bestellung}-${typ}` : '', zeile: nr, dienst: quelle,
        ...(land ? { land } : {}),
      }));
      // Shopify führt die Gebühr ohne Vorzeichen; Netto = Betrag − Gebühr.
      if (gebuehr) umsaetze.push(gebuehrZeile({ datum: d, betrag: -gebuehr, waehrung, zweck: `Marktplatzgebühr zu Bestellung ${bestellung}`.trim(), referenz: bestellung ? `${bestellung}-${typ}-gebuehr` : '', zeile: nr }));
      const id = z(r, 'auszahlungId');
      if (id && norm(z(r, 'status')) === 'paid') {
        const a = auszahlungen.get(id) || { summe: 0, datum: datumMitMonat(z(r, 'auszahlungDatum')) || d, waehrung, zeile: nr };
        a.summe += netto;
        auszahlungen.set(id, a);
      }
    });
    // Steht die Auszahlung schon als eigene Zeile in der Datei, gilt sie; sonst die Summe je Auszahlung.
    const eigene = umsaetze.some((u) => u.uebertrag);
    for (const [id, a] of eigene ? [] : auszahlungen) {
      if (!a.summe) continue;
      umsaetze.push(umsatz({ datum: a.datum, betrag: -a.summe, waehrung: a.waehrung, gegenseite: 'Bankkonto', zweck: 'Auszahlung', buchungstext: 'Auszahlung', referenz: id, zeile: a.zeile, dienst: quelle, uebertrag: true }));
    }
  } else if (quelle === 'etsy') {
    const dez = dezimalVon(daten.flatMap((r) => [z(r, 'betrag'), z(r, 'netto'), z(r, 'gebuehr')]));
    daten.forEach((r, i) => {
      const nr = kopfzeile + i + 2;
      if (r.every((c) => !zu(c))) return;
      const d = datumMitMonat(z(r, 'datum'));
      if (!d) { weg(nr, r, 'kein Datum'); return; }
      const typ = norm(z(r, 'typ'));
      const titel = z(r, 'titel');
      const info = z(r, 'info');
      const waehrung = (z(r, 'waehrung') || 'EUR').toUpperCase().slice(0, 3);
      const betrag = etsyBetrag(z(r, 'betrag'), dez);
      const gebuehr = etsyBetrag(z(r, 'gebuehr'), dez);
      const netto = etsyBetrag(z(r, 'netto'), dez);
      const bestellung = (/#\s?(\d+)/.exec(`${titel} ${info}`) || [])[1] || '';
      if (/^(deposit|auszahlung|einzahlung)$/.test(typ)) {
        // Der Betrag einer Auszahlung steht bei Etsy im Titel („€150.00 sent to your bank account“).
        const wert = netto ?? betrag ?? betragLesen((/[-−]?\s?[€$£]?\s?\d[\d.,]*/.exec(titel) || [''])[0], dez);
        if (!wert) { weg(nr, r, 'kein Betrag'); return; }
        umsaetze.push(umsatz({ datum: d, betrag: -Math.abs(wert), waehrung, gegenseite: 'Bankkonto', zweck: titel || 'Auszahlung', buchungstext: 'Auszahlung', referenz: `etsy-${d}-${Math.abs(wert)}`, zeile: nr, dienst: quelle, uebertrag: true }));
        return;
      }
      // Umsatzsteuer, die Etsy selbst beim Käufer erhebt und abführt, berührt das Guthaben nicht.
      if (/^(tax|steuer)$/.test(typ)) { weg(nr, r, 'Steuer, die Etsy selbst abführt'); return; }
      if (/^(sale|verkauf|refund|erstattung|rueckerstattung)$/.test(typ)) {
        if (betrag === null) { weg(nr, r, 'kein Betrag'); return; }
        const erstattung = betrag < 0;
        const land = landCode(z(r, 'land'));
        umsaetze.push(umsatz({
          datum: d, betrag, waehrung, gegenseite: name, zweck: titel || (erstattung ? 'Erstattung' : 'Verkauf'),
          buchungstext: erstattung ? 'Erstattung' : 'Verkauf', referenz: bestellung ? `${bestellung}-${erstattung ? 'erstattung' : 'verkauf'}` : '', zeile: nr, dienst: quelle,
          ...(land ? { land } : {}),
        }));
        // Bei einer Erstattung schreibt Etsy einen Teil der Gebühren gut (positiv).
        if (gebuehr) umsaetze.push(gebuehrZeile({ datum: d, betrag: gebuehr, waehrung, zweck: `Marktplatzgebühr zu Bestellung ${bestellung}`.trim(), referenz: bestellung ? `${bestellung}-gebuehr-${nr}` : '', zeile: nr }));
        return;
      }
      // Alles andere sind Kosten bei Etsy: Gebühren, Werbung, Versandetiketten, Umsatzsteuer auf Gebühren.
      const wert = netto ?? gebuehr ?? betrag;
      if (!wert) { weg(nr, r, 'kein Betrag'); return; }
      umsaetze.push(gebuehrZeile({ datum: d, betrag: wert, waehrung, zweck: [titel, info].filter(Boolean).join(' · ') || z(r, 'typ'), buchungstext: z(r, 'typ') || 'Gebühr', referenz: `etsy-${d}-${nr}`, zeile: nr }));
    });
  } else {
    const dez = dezimalVon(daten.map((r) => z(r, 'gesamt')));
    daten.forEach((r, i) => {
      const nr = kopfzeile + i + 2;
      if (r.every((c) => !zu(c))) return;
      const d = datumMitMonat(z(r, 'datum'));
      const gesamt = betragLesen(z(r, 'gesamt'), dez);
      if (!d || gesamt === null) { weg(nr, r, !d ? 'kein Datum' : 'kein Betrag'); return; }
      const typ = norm(z(r, 'typ'));
      const bestellung = z(r, 'bestellung');
      const beschreibung = z(r, 'beschreibung');
      const waehrung = amazonWaehrung(z(r, 'marktplatz'));
      if (/^(transfer|uebertrag)$/.test(typ)) {
        umsaetze.push(umsatz({ datum: d, betrag: -Math.abs(gesamt), waehrung, gegenseite: 'Bankkonto', zweck: beschreibung || 'Auszahlung', buchungstext: 'Auszahlung', referenz: `amazon-${d}-${Math.abs(gesamt)}`, zeile: nr, dienst: quelle, uebertrag: true }));
        return;
      }
      if (/^(order|bestellung|refund|erstattung)$/.test(typ)) {
        // Gesamt = Verkauf (mit Versand, Geschenkverpackung, Rabatten, Steuer) + Gebühren; die Gebühren werden eine eigene Ausgabe.
        const gebuehr = ['verkaufsgebuehr', 'fba', 'andereGebuehr'].reduce((n, k) => n + (betragLesen(z(r, k), dez) || 0), 0);
        const verkauf = gesamt - gebuehr;
        const erstattung = /refund|erstattung/.test(typ);
        const land = landCode(z(r, 'land'));
        umsaetze.push(umsatz({
          datum: d, betrag: verkauf, waehrung, gegenseite: name, zweck: [erstattung ? 'Erstattung' : 'Verkauf', bestellung ? `Bestellung ${bestellung}` : '', beschreibung].filter(Boolean).join(' · '),
          buchungstext: erstattung ? 'Erstattung' : 'Verkauf', referenz: bestellung ? `${bestellung}-${erstattung ? 'erstattung' : 'verkauf'}-${nr}` : '', zeile: nr, dienst: quelle,
          ...(land ? { land } : {}),
        }));
        if (gebuehr) umsaetze.push(gebuehrZeile({ datum: d, betrag: gebuehr, waehrung, zweck: `Marktplatzgebühr zu Bestellung ${bestellung}`.trim(), referenz: bestellung ? `${bestellung}-gebuehr-${nr}` : '', zeile: nr }));
        return;
      }
      // Servicegebühren, Lagerkosten, Werbung, Anpassungen: eine Zeile mit dem Gesamtbetrag.
      umsaetze.push(umsatz({
        datum: d, betrag: gesamt, waehrung, gegenseite: name, zweck: beschreibung || z(r, 'typ'), buchungstext: z(r, 'typ') || 'Gebühr', referenz: `amazon-${d}-${nr}`, zeile: nr, dienst: quelle,
        ...(gesamt < 0 ? { gebuehr: true } : {}),
      }));
    });
  }
  return {
    format: quelle, dienst: quelle, trenner, zeilen, kopfzeile, kopf, spalten: sp, erkannt: sp, dezimal: '', signatur: '',
    umsaetze, uebersprungen, konto: { iban: '' },
  };
}

/**
 * Sucht in den ersten Zeilen eines CSV-Textes die Kopfzeile eines Dienstes oder Marktplatzes
 * (Marktplätze, unten). Jede Zeile einzeln mit jedem Trennzeichen: Amazon schreibt Erklärtext darüber.
 */
export function dienstImText(text) {
  const anfang = String(text).replace(/^﻿/, '').split(/\r?\n/).slice(0, 20);
  for (const zeile of anfang) {
    for (const t of [',', ';', '\t']) {
      const [z] = csvZeilen(zeile, t);
      const d = zahlungsdienstErkennen(z) || marktplatzErkennen(z);
      if (d) return d;
    }
  }
  return '';
}

/** Dienste und Marktplätze, deren Name ein Konto als ihres ausweist. */
const DIENSTE = /paypal|stripe|shopify|etsy|amazon/;

/**
 * Ein eigenes Konto für einen Zahlungsdienst oder Marktplatz: die Art „Zahlungsdienst“ oder (aus Zeiten vor
 * dieser Art) ein Konto, das PayPal oder Stripe heißt. `dienst` grenzt auf einen Dienst ein.
 */
export function istDienstKonto(a, dienst = '') {
  if (!a || a.active === false) return false;
  const name = norm(a.name);
  if (dienst) return name.includes(dienst) || (a.kind === 'zahlungsdienst' && !DIENSTE.test(name));
  return a.kind === 'zahlungsdienst' || /paypal|stripe/.test(name);
}

/** Name des Dienstes für Oberfläche und Gegenseite. */
export const DIENSTNAME = { paypal: 'PayPal', stripe: 'Stripe', ...MARKTNAME };

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
  if (dienst in MARKTNAME || (!dienst && MARKTNAME[dienstImText(text)])) return marktplatzLesen(text, dienst);
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
  // Marktplätze; Erstattungen von Einkäufen bei Amazon kommen ohne diese Wörter.
  if (/shopify|etsy/.test(wer)) return /payout|auszahlung|deposit|shopify|etsy/.test(was);
  if (/amazon/.test(wer)) return /settlement|abrechnung|auszahlung|payout|marketplace|seller/.test(was);
  return false;
}
