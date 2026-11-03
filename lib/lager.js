/**
 * Kontovia – Lager und Wareneinsatz (SEC-66), reine Rechnung ohne Speicher und Oberfläche.
 *
 * Kontovia ist keine Warenwirtschaft. Es führt für Produkte, die Sie einlagern, einen Bestand:
 *   Zugang     von Hand oder aus einer erhaltenen E-Rechnung, mit Einkaufspreis je Einheit (Cent, netto)
 *   Abgang     aus ausgestellten Rechnungen und Lieferscheinen (Positionen mit Produkt), nicht gespeichert, sondern
 *              jedes Mal aus den Belegen abgeleitet. Eine Rechnung, die aus einem Lieferschein entstand, zählt nicht noch
 *              einmal. Eine stornierte Rechnung und ihr Storno zählen beide nicht.
 *   Inventur   der gezählte Bestand an einem Tag; die Differenz zum Buchbestand ist ein Zu- oder Abgang
 * Gespeichert sind nur Zugänge und Inventuren, in der Sammlung `lager` (Schema 5, docs/sql-umstellung.md).
 * Ein Produkt gilt als Lagerware, sobald es eine gespeicherte Bewegung hat; Leistungen ohne Bewegung bleiben außen vor.
 *
 * Bewertet wird mit dem gleitenden Durchschnittspreis (R 6.8 Abs. 4 EStR): Jeder Zugang mischt seinen Einkaufspreis in
 * den Durchschnitt, Abgänge und Fehlmengen gehen zum aktuellen Durchschnitt ab. Der Wareneinsatz eines Zeitraums ist
 * der Wert der Abgänge und Inventurfehlmengen darin. In der Einnahmen-Überschuss-Rechnung zählt der Wareneinkauf beim
 * Bezahlen; Bestand und Wareneinsatz sind hier eine Übersicht (Rohertrag, Inventurliste zum Stichtag), keine Buchung.
 *
 * Mengen sind Zahlen mit bis zu drei Nachkommastellen (kein Geld), Werte ganzzahlige Cent.
 * Prüfung: scripts/pruefungen/bestand.test.js (Thema Lager) und rechenkern.test.js.
 */

import { uid } from './util.js';

export const LAGER_ARTEN = ['zugang', 'inventur'];

/** Menge auf drei Nachkommastellen. */
export const menge3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;

/**
 * Eine gespeicherte Bewegung (Zugang oder Inventur).
 * @param {{produktId:string, datum:string, art:'zugang'|'inventur', menge:number, einkauf?:number, quelle?:object|null, notiz?:string}} f
 */
export function lagerBewegung(f) {
  const jetzt = new Date().toISOString();
  const art = LAGER_ARTEN.includes(f.art) ? f.art : 'zugang';
  return {
    id: f.id || uid('lg'),
    produktId: String(f.produktId || ''),
    datum: String(f.datum || jetzt.slice(0, 10)).slice(0, 10),
    art,
    menge: menge3(f.menge),
    einkauf: art === 'zugang' ? Math.max(0, Math.round(Number(f.einkauf) || 0)) : 0,
    quelle: f.quelle ? { art: String(f.quelle.art || ''), id: String(f.quelle.id || ''), nummer: String(f.quelle.nummer || '').slice(0, 60), pos: String(f.quelle.pos || '') } : null,
    notiz: String(f.notiz || '').slice(0, 200),
    createdAt: f.createdAt || jetzt,
    updatedAt: jetzt,
  };
}

/** Prüft eine Bewegung, bevor sie gespeichert wird; gibt Fehlertexte zurück (leer = in Ordnung). */
export function bewegungPruefen(b, db) {
  const f = [];
  if (!(db.products || []).some((p) => p.id === b.produktId)) f.push('Bitte ein Produkt wählen.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.datum)) f.push('Bitte ein Datum eintragen.');
  if (b.art === 'zugang' && !(b.menge > 0)) f.push('Die Menge muss größer als null sein.');
  if (b.art === 'inventur' && !(b.menge >= 0)) f.push('Der gezählte Bestand darf nicht negativ sein.');
  return f;
}

const datumDes = (r) => String(r.leistungsdatum || r.datum || r.ausgestelltAm || '').slice(0, 10);

/**
 * Abgänge aus den Belegen: ausgestellte Rechnungen (ohne Eingang, ohne Storno-Paare, ohne die aus Lieferscheinen)
 * und ausgestellte Lieferscheine, je Position mit Produkt und Menge über null.
 */
export function abgaengeAusBelegen(db) {
  const out = [];
  const add = (beleg, art) => {
    for (const p of beleg.positionen || []) {
      if (!p?.produktId || !(Number(p.menge) > 0)) continue;
      out.push({ id: `${beleg.id}:${p.id}`, produktId: p.produktId, datum: datumDes(beleg), art: 'abgang', menge: menge3(p.menge), quelle: { art, id: beleg.id, nummer: beleg.nummer || '' } });
    }
  };
  for (const r of db.invoices || []) {
    if (r.richtung === 'eingang' || r.status !== 'ausgestellt' || r.storno || r.storniertDurch) continue;
    if (r.ausBeleg?.belegart === 'lieferschein') continue;
    add(r, 'rechnung');
  }
  for (const b of db.angebote || []) {
    if (b.belegart === 'lieferschein' && b.status === 'ausgestellt' && !b.storniert) add(b, 'lieferschein');
  }
  return out;
}

/** Produkte mit gespeicherter Bewegung (Lagerware). */
export const lagerProdukte = (db) => {
  const ids = new Set((db.lager || []).map((b) => b.produktId));
  return (db.products || []).filter((p) => ids.has(p.id));
};

/**
 * Bestand und Werte je Lagerprodukt bis zu einem Tag, dazu der Wareneinsatz eines Zeitraums.
 * @param {object} db
 * @param {{bis?:string, von?:string}} [zeit]  bis = Stichtag (einschließlich); von/bis = Zeitraum des Wareneinsatzes
 * @returns {{zeilen:Array<{produkt:object, menge:number, durchschnitt:number, wert:number, zugang:number, abgang:number,
 *   differenz:number, einsatz:number, fehlbestand:boolean, bewegungen:object[]}>, wert:number, einsatz:number}}
 */
export function lagerbestand(db, { bis = '9999-12-31', von = '0000-01-01' } = {}) {
  const ids = new Set((db.lager || []).map((b) => b.produktId));
  const alle = [...(db.lager || []), ...abgaengeAusBelegen(db).filter((a) => ids.has(a.produktId))]
    .filter((b) => b.datum && b.datum <= bis)
    // Am selben Tag: erst Zugänge, dann Abgänge, zuletzt die Inventur (sie zählt den Stand am Abend).
    .sort((a, b) => a.datum.localeCompare(b.datum) || RANG[a.art] - RANG[b.art] || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const je = new Map();
  for (const p of db.products || []) if (ids.has(p.id)) je.set(p.id, { produkt: p, menge: 0, wertRoh: 0, zugang: 0, abgang: 0, differenz: 0, einsatz: 0, fehlbestand: false, bewegungen: [] });
  for (const b of alle) {
    const z = je.get(b.produktId);
    if (!z) continue;
    const schnitt = z.menge > 0 ? z.wertRoh / z.menge : 0;
    const imZeitraum = b.datum >= von;
    let delta = 0;
    let wertDelta = 0;
    if (b.art === 'zugang') {
      delta = b.menge;
      wertDelta = b.menge * b.einkauf;
      if (imZeitraum) z.zugang = menge3(z.zugang + b.menge);
    } else if (b.art === 'abgang') {
      delta = -b.menge;
      wertDelta = -b.menge * schnitt;
      if (imZeitraum) { z.abgang = menge3(z.abgang + b.menge); z.einsatz += b.menge * schnitt; }
    } else {
      delta = menge3(b.menge - z.menge);
      // Mehrmengen gehen zum Durchschnitt zu, Fehlmengen zum Durchschnitt ab (bei Bestand null: zum letzten Preis).
      const preis = schnitt || z.letzterPreis || 0;
      wertDelta = delta * preis;
      if (imZeitraum) { z.differenz = menge3(z.differenz + delta); if (delta < 0) z.einsatz += -delta * preis; }
    }
    if (b.art === 'zugang') z.letzterPreis = b.einkauf;
    z.menge = menge3(z.menge + delta);
    z.wertRoh = z.menge > 0 ? z.wertRoh + wertDelta : 0;
    if (z.menge < 0) z.fehlbestand = true;
    z.bewegungen.push({ ...b, bestand: z.menge });
  }
  const zeilen = [...je.values()].map((z) => {
    const { wertRoh, letzterPreis, ...rest } = z;
    void letzterPreis;
    return { ...rest, wert: Math.round(Math.max(0, wertRoh)), durchschnitt: z.menge > 0 ? Math.round(wertRoh / z.menge) : 0, einsatz: Math.round(z.einsatz) };
  }).sort((a, b) => String(a.produkt.name || '').localeCompare(String(b.produkt.name || ''), 'de'));
  return { zeilen, wert: zeilen.reduce((s, z) => s + z.wert, 0), einsatz: zeilen.reduce((s, z) => s + z.einsatz, 0) };
}

const RANG = { zugang: 0, abgang: 1, inventur: 2 };

/**
 * Vorschläge für einen Zugang aus einer erhaltenen E-Rechnung: je Position das passende Produkt (gleiche
 * Artikelnummer, sonst gleicher Name), Menge und Einkaufspreis je Einheit (netto).
 * @param {{positionen:object[]}} gelesen  lib/erechnung.js
 */
export function zugangAusEingang(gelesen, db) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const produkte = db.products || [];
  return (gelesen?.positionen || []).filter((p) => Number(p.menge) > 0).map((p) => {
    const treffer = produkte.find((x) => x.artikelnummer && norm(x.artikelnummer) === norm(p.artikelnummer))
      || produkte.find((x) => norm(x.name) === norm(p.name)) || null;
    const einkauf = p.einzelpreis || (p.menge ? Math.round(p.netto / p.menge) : 0);
    return { pos: String(p.nr || ''), name: p.name || '', menge: menge3(p.menge), einheit: p.einheit || '', einkauf, produktId: treffer?.id || '' };
  });
}

/** Inventurliste zum Stichtag als Zeilen für CSV (Exporte bleiben deutsch). */
export function inventurliste(db, stichtag) {
  const { zeilen, wert } = lagerbestand(db, { bis: stichtag });
  const euro = (c) => (c / 100).toFixed(2).replace('.', ',');
  const kopf = ['Artikelnummer', 'Bezeichnung', 'Menge', 'Einheit', 'Durchschnittspreis (EUR)', 'Wert (EUR)'];
  const daten = zeilen.map((z) => [z.produkt.artikelnummer || '', z.produkt.name || '', String(z.menge).replace('.', ','), z.produkt.einheitText || z.produkt.einheit || '', euro(z.durchschnitt), euro(z.wert)]);
  return { kopf, daten, summe: wert };
}
