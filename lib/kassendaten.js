/**
 * Kontovia – Kassendaten einer TSE-Kasse (DSFinV-K) einlesen: Tagesabschlüsse ins Kassenbuch (SEC-66).
 *
 * Kontovia ist keine Kasse. Eine Registrierkasse mit TSE gibt ihre Daten als DSFinV-K-Export aus, ein ZIP-Archiv mit
 * CSV-Dateien und einer Beschreibung (index.xml). Gelesen werden nur die Einzelaufzeichnungen der Kassenabschlüsse
 * („Z-Bons“), nicht die einzelnen Bons:
 *   cashpointclosing.csv  Z_KASSE_ID, Z_ERSTELLUNG, Z_NR, Z_BUCHUNGSTAG   ein Abschluss je Zeile
 *   businesscases.csv     … GV_TYP, UST_SCHLUESSEL, Z_UMS_BRUTTO           Umsätze je Geschäftsvorfall und Steuersatz
 *   payment.csv           … ZAHLART_TYP, Z_ZAHLART_BETRAG                   bar, Karte, Zahlungsdienst
 *   vat.csv               … UST_SCHLUESSEL, UST_SATZ                        Steuersätze der Kasse
 *
 * Je Abschluss und Steuersatz entsteht eine Einnahme auf der Barkasse (der Baranteil, bezahlt am Buchungstag) und, wenn
 * Karten oder Zahlungsdienste dabei waren, eine Einnahme auf dem gewählten Konto für Kartenzahlungen. Der unbare Anteil
 * verteilt sich im Verhältnis der Umsätze auf die Steuersätze, auf den Cent genau. Privateinlage, Privatentnahme und
 * Kassendifferenz werden ebenfalls Buchungen der Kasse. Was Kontovia nicht sicher zuordnen kann (Gutscheine,
 * Anzahlungen, Geldtransit zur Bank, Trinkgeld der Angestellten), steht als Hinweis da und wird nicht gebucht.
 * Jeder Abschluss hat eine feste Kennung (Kasse und Z-Nummer); ein zweites Einlesen bucht nichts doppelt.
 *
 * Wie lib/datenimport.js: kein Speicher, keine Oberfläche. Die Vorschläge haben dieselbe Form wie dort und werden in
 * views/datenimport.js geprüft und mit lib/datenimportaktionen.js gebucht. Das Kassenbuch selbst: lib/kasse.js.
 * Grundlage: DSFinV-K 2.x (BMF), § 146a AO.
 */

import { csvTrenner, csvZeilen, datumLesen, betragLesen } from './kontoauszug.js';
import { norm, splitFromGross } from './util.js';
import { ohneUstEinstellung } from './calc.js';
import { buchungsEntwurf, fingerabdruck, aehnlicheMarkieren } from './datenimport.js';

/** Steuersätze der festen UST_SCHLUESSEL (DSFinV-K, Anhang), falls vat.csv fehlt. */
export const UST_SCHLUESSEL = { 1: 19, 2: 7, 3: 10.7, 4: 5.5, 5: 0, 6: 0, 7: 0, 11: 19, 12: 7 };

/** Geschäftsvorfälle, die Umsatz der Kasse sind (mit Umsatzsteuer nach Schlüssel). */
const UMSATZ = new Set(['umsatz', 'pfand', 'pfandrueckzahlung', 'rabatt', 'aufschlag', 'trinkgeldag', 'einzweckgutscheinkauf', 'zuschussecht']);
/** Bewegungen der Kasse ohne Umsatz. */
const PRIVAT = { privateinlage: 'income', privatentnahme: 'expense' };
/** Unbare Zahlarten; alles andere außer „Bar“ und „Keine“ zählt ebenso als unbar. */
const BAR = 'bar';

const klein = (s) => norm(String(s ?? '')).replace(/[^a-z0-9]/g, '');

/** Ist das ein DSFinV-K-Export? Erkannt an den Dateinamen im Archiv. */
export function istDsfinvk(namen) {
  const liste = [...namen];
  return liste.some((n) => /(^|\/)businesscases\.csv$/i.test(n)) && liste.some((n) => /(^|\/)cashpointclosing\.csv$/i.test(n));
}

/** Eine Tabelle des Exports als Liste von Objekten (Spaltennamen groß). */
function tabelle(text, trenner) {
  if (!text) return [];
  const roh = csvZeilen(String(text).replace(/^﻿/, ''), trenner || csvTrenner(text));
  if (roh.length < 1) return [];
  const kopf = roh[0].map((k) => String(k).trim().toUpperCase());
  return roh.slice(1).filter((r) => r.some((z) => String(z).trim())).map((r) => Object.fromEntries(kopf.map((k, i) => [k, String(r[i] ?? '').trim()])));
}

/**
 * Liest die Dateien eines DSFinV-K-Exports.
 * @param {Map<string,string>} dateien  Name im Archiv → Text
 * @returns {{abschluesse:object[], hinweise:string[]}}
 *   abschluesse  je Z-Bon: {kasse, nr, datum, umsaetze:[{satz, brutto, typ}], zahlarten:[{typ, name, betrag}], sonstige:[{typ, name, brutto}]}
 */
export function dsfinvkLesen(dateien) {
  const holen = (name) => [...dateien.entries()].find(([n]) => new RegExp(`(^|/)${name}$`, 'i').test(n))?.[1] || '';
  const index = holen('index.xml');
  const trenner = /<ColumnDelimiter>(.*?)<\/ColumnDelimiter>/i.exec(index)?.[1]?.replace('&#59;', ';') || '';
  const dezimal = /<DecimalSymbol>\s*,\s*<\/DecimalSymbol>/i.test(index) ? 'komma' : 'punkt';
  const geld = (s) => betragLesen(s, dezimal) ?? 0;
  const hinweise = [];

  const saetze = new Map();
  for (const r of tabelle(holen('vat.csv'), trenner)) {
    const satz = Number(String(r.UST_SATZ).replace(',', '.'));
    if (r.UST_SCHLUESSEL && Number.isFinite(satz)) saetze.set(`${r.Z_KASSE_ID}|${r.Z_NR}|${r.UST_SCHLUESSEL}`, satz).set(`*|${r.UST_SCHLUESSEL}`, satz);
  }
  const satzFuer = (r) => saetze.get(`${r.Z_KASSE_ID}|${r.Z_NR}|${r.UST_SCHLUESSEL}`) ?? saetze.get(`*|${r.UST_SCHLUESSEL}`) ?? UST_SCHLUESSEL[Number(r.UST_SCHLUESSEL)];

  const abschluesse = new Map();
  for (const r of tabelle(holen('cashpointclosing.csv'), trenner)) {
    const datum = datumLesen(r.Z_BUCHUNGSTAG) || datumLesen(r.Z_ERSTELLUNG);
    if (!r.Z_NR || !datum) { hinweise.push(`Kassenabschluss ohne Nummer oder Datum übersprungen (Kasse ${r.Z_KASSE_ID || '?'}).`); continue; }
    abschluesse.set(`${r.Z_KASSE_ID}|${r.Z_NR}`, { kasse: r.Z_KASSE_ID || '', nr: r.Z_NR, datum, umsaetze: [], zahlarten: [], sonstige: [] });
  }
  const zu = (r, art) => {
    const a = abschluesse.get(`${r.Z_KASSE_ID}|${r.Z_NR}`);
    if (!a) hinweise.push(`${art} zu unbekanntem Abschluss ${r.Z_NR || '?'} (Kasse ${r.Z_KASSE_ID || '?'}) übersprungen.`);
    return a;
  };
  for (const r of tabelle(holen('businesscases.csv'), trenner)) {
    const a = zu(r, 'Geschäftsvorfall');
    if (!a) continue;
    const typ = klein(r.GV_TYP);
    const brutto = geld(r.Z_UMS_BRUTTO);
    if (!brutto) continue;
    if (UMSATZ.has(typ)) {
      const satz = satzFuer(r);
      if (satz === undefined) { a.sonstige.push({ typ: r.GV_TYP, name: r.GV_NAME || '', brutto, grund: `unbekannter Steuerschlüssel ${r.UST_SCHLUESSEL}` }); continue; }
      a.umsaetze.push({ satz, brutto, typ: r.GV_TYP });
    } else {
      a.sonstige.push({ typ: r.GV_TYP, name: r.GV_NAME || '', brutto });
    }
  }
  for (const r of tabelle(holen('payment.csv'), trenner)) {
    const a = zu(r, 'Zahlart');
    if (a) a.zahlarten.push({ typ: klein(r.ZAHLART_TYP), name: r.ZAHLART_NAME || r.ZAHLART_TYP || '', betrag: geld(r.Z_ZAHLART_BETRAG) });
  }
  if (!abschluesse.size) throw Object.assign(new Error('In den Kassendaten steht kein Kassenabschluss.'), { code: 'LEER' });
  return { abschluesse: [...abschluesse.values()].sort((x, y) => x.datum.localeCompare(y.datum) || x.kasse.localeCompare(y.kasse) || Number(x.nr) - Number(y.nr)), hinweise };
}

/** Betrag `gesamt` im Verhältnis der Gewichte aufteilen, Rest zum größten Anteil (Summe stimmt auf den Cent). */
export function verteilen(gesamt, gewichte) {
  const summe = gewichte.reduce((s, g) => s + g, 0);
  if (!summe) return gewichte.map(() => 0);
  const teile = gewichte.map((g) => Math.trunc((gesamt * g) / summe));
  const rest = gesamt - teile.reduce((s, t) => s + t, 0);
  let gross = 0;
  gewichte.forEach((g, i) => { if (Math.abs(g) > Math.abs(gewichte[gross])) gross = i; });
  teile[gross] += rest;
  return teile;
}

/**
 * Tagesabschlüsse in Buchungsvorschläge übersetzen (Form wie datevZuBuchungen).
 * @param {{abschluesse:object[]}} gelesen  aus dsfinvkLesen
 * @param {object} db  Bestand (nur gelesen)
 * @param {{kontoId?:string, datei?:string}} opt  kontoId: Konto für Kartenzahlungen (sonst das erste Bankkonto)
 */
export function dsfinvkZuBuchungen(gelesen, db, opt = {}) {
  const s = db.settings || {};
  const ohneUst = ohneUstEinstellung(s);
  const konten = (db.accounts || []).filter((a) => a.active !== false);
  const kasse = konten.find((a) => a.kind === 'cash');
  const karte = konten.find((a) => a.id === opt.kontoId && a.kind !== 'cash') || konten.find((a) => a.kind === 'bank') || null;
  const kats = (db.categories || []).filter((c) => c.active !== false);
  const erloes = (satz) => (ohneUst
    ? kats.find((c) => c.kind === 'income' && /§\s?19/.test(c.name))
    : kats.find((c) => c.kind === 'income' && Number(c.vatRate) === satz && !c.intraEu && !c.reverseCharge && !c.private && !c.vatNeutral)) || null;
  const privat = (art) => kats.find((c) => c.kind === art && c.private) || null;
  const vorhanden = new Set((db.transactions || []).map((t) => t.importHash).filter(Boolean));
  const out = [];
  let nr = 0;

  const vorschlag = (a, { teil, type, gross, satz, kat, konto, text, grund = '' }) => {
    const hash = 'kasse:' + fingerabdruck([a.kasse, a.nr, ...teil].join('|'));
    const v = { nr: ++nr, datum: a.datum, betrag: Math.abs(gross), text, beleg: `Z ${a.nr}`, konto: '', gegenkonto: '', hash, doppelt: vorhanden.has(hash) };
    if (!konto) return { ...v, art: 'aus', grund: grund || 'Kein passendes Konto vorhanden.' };
    const t = splitFromGross(Math.abs(gross), ohneUst ? 0 : satz);
    // Rückzahlungen und Rabatte über dem Umsatz ergeben einen negativen Betrag: als Gegenbuchung der anderen Art.
    const art = gross < 0 ? (type === 'income' ? 'expense' : 'income') : type;
    return {
      ...v, art: 'buchung', offen: false, person: '', grund: grund || (kat ? '' : 'Keine passende Kategorie; die Buchung kommt ohne Kategorie.'),
      tx: buchungsEntwurf({
        type: art, date: a.datum, paidDate: a.datum, description: text.slice(0, 200), categoryId: kat?.id || '', accountId: konto.id,
        gross: t.gross, net: t.net, vat: t.vat, vatRate: ohneUst ? 0 : satz, invoiceNumber: `Z ${a.nr}`.slice(0, 36),
        importHash: hash, import: { quelle: 'Kasse', datei: opt.datei || '', kasse: a.kasse, z: a.nr },
      }),
    };
  };

  for (const a of gelesen.abschluesse) {
    const tag = a.datum.split('-').reverse().join('.');
    const kopf = `Kasse${a.kasse ? ` ${a.kasse}` : ''}, Z-Bon ${a.nr} vom ${tag}`;
    // Umsätze je Steuersatz zusammenfassen.
    const jeSatz = new Map();
    for (const u of a.umsaetze) jeSatz.set(u.satz, (jeSatz.get(u.satz) || 0) + u.brutto);
    const saetze = [...jeSatz.keys()].sort((x, y) => y - x);
    const umsatz = saetze.reduce((s, k) => s + jeSatz.get(k), 0);
    const unbar = a.zahlarten.filter((z) => z.typ !== BAR && z.typ !== 'keine').reduce((s, z) => s + z.betrag, 0);
    const unbarTeil = Math.max(0, Math.min(unbar, umsatz));
    const unbarJe = verteilen(unbarTeil, saetze.map((k) => jeSatz.get(k)));
    const kartenNamen = [...new Set(a.zahlarten.filter((z) => z.typ !== BAR && z.typ !== 'keine' && z.betrag).map((z) => z.name))].join(', ');
    saetze.forEach((satz, i) => {
      const brutto = jeSatz.get(satz);
      const karteBetrag = unbarJe[i];
      const barBetrag = brutto - karteBetrag;
      const satzText = `${String(satz).replace('.', ',')} %`;
      if (barBetrag) {
        out.push(vorschlag(a, { teil: ['bar', satz], type: 'income', gross: barBetrag, satz, kat: erloes(satz), konto: kasse, text: `${kopf}: Barumsatz ${satzText}`,
          grund: kasse ? '' : 'Es gibt keine Barkasse. Legen Sie unter Stammdaten › Zahlungskonten eine Kasse an.' }));
      }
      if (karteBetrag) {
        out.push(vorschlag(a, { teil: ['unbar', satz], type: 'income', gross: karteBetrag, satz, kat: erloes(satz), konto: karte, text: `${kopf}: ${kartenNamen || 'Kartenzahlung'} ${satzText}` }));
      }
    });
    if (unbar > umsatz) {
      out.push({ nr: ++nr, datum: a.datum, betrag: unbar - umsatz, text: `${kopf}: unbare Zahlungen über dem Umsatz`, beleg: `Z ${a.nr}`, konto: '', gegenkonto: '', hash: '', doppelt: false, art: 'aus',
        grund: 'Die Kasse meldet mehr Kartenzahlungen als Umsatz (etwa Gutscheine oder Anzahlungen). Bitte von Hand prüfen.' });
    }
    for (const x of a.sonstige) {
      const typ = klein(x.typ);
      if (PRIVAT[typ]) {
        const art = PRIVAT[typ];
        out.push(vorschlag(a, { teil: [typ, x.name], type: art, gross: Math.abs(x.brutto), satz: 0, kat: privat(art), konto: kasse, text: `${kopf}: ${art === 'income' ? 'Privateinlage' : 'Privatentnahme'}` }));
      } else if (typ === 'differenzsollist') {
        out.push(vorschlag(a, { teil: ['differenz', x.name], type: x.brutto > 0 ? 'income' : 'expense', gross: Math.abs(x.brutto), satz: 0,
          kat: kats.find((c) => c.kind === (x.brutto > 0 ? 'income' : 'expense') && /sonstige/i.test(c.name)) || null, konto: kasse, text: `${kopf}: Kassendifferenz` }));
      } else {
        out.push({ nr: ++nr, datum: a.datum, betrag: Math.abs(x.brutto), text: `${kopf}: ${x.name || x.typ}`, beleg: `Z ${a.nr}`, konto: '', gegenkonto: '', hash: '', doppelt: false, art: 'aus',
          grund: x.grund ? `Nicht übernommen: ${x.grund}.` : `Geschäftsvorfall „${x.typ}“ bucht Kontovia nicht selbst (etwa Gutschein, Anzahlung, Geldtransit zur Bank). Bitte von Hand erfassen.` });
      }
    }
  }
  return aehnlicheMarkieren(out, db);
}
