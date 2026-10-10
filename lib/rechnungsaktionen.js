/**
 * Kontovia – was mit einer Rechnung geschieht: speichern, ausstellen,
 * stornieren, als bezahlt markieren, als Vorlage ablegen.
 *
 * Ausstellen heißt (GoBD, § 14 UStG):
 *   - die Nummer wird vergeben, fortlaufend und einmalig
 *   - Verkäuferangaben und Gestaltung werden eingefroren
 *   - PDF (ZUGFeRD) und XRechnung entstehen und liegen ab dann unverändert
 *     und mit Prüfsumme im Tresor (§ 14b UStG: acht Jahre aufbewahren)
 *   - auf Wunsch entsteht die offene Einnahme dazu, je Steuersatz eine
 *     Buchung, mit einer Kopie des PDFs als Beleg. Die Kopie ist Absicht:
 *     Wer die Buchung samt Beleg löscht, löscht nicht die Rechnung.
 * Danach lässt sich die Rechnung nicht mehr ändern, nur stornieren oder
 * korrigieren.
 */

import { uid, todayISO } from './util.js';
import {
  store, sel, commit, upsertEntity, deleteEntity, upsertTransaction, voidTransaction, nextInvoiceNumber, isLockedDate, newTransactionDraft,
} from './store.js';
import {
  berechnen, faelligkeit, verkaeuferAus, design as designAus, profil as profilAus, titel, neueRechnung, aufteilen, istGutschrift, STEUERFAELLE,
  verzugHinweisNoetig,
} from './rechnung.js';
import { ratenAnzahl, ratenBuchungen } from './raten.js';
import { regelAusRechnung } from './rechnungswiederholung.js';
import { dateienErzeugen } from './rechnungsdateien.js';
import { grenzePruefen, rechnungenImMonat, kann } from './lizenz.js';
import { xmlDateiname } from './erechnung-schreiben.js';
import { pdfDateiname } from './rechnungsdruck.js';
import { base64 } from './pdfausgabe.js';

const api = globalThis.window?.kontovia || {};

/** Nummern aller anderen ausgehenden Rechnungen (für die Doppelprüfung). */
export function vergebeneNummern(ausser = '') {
  return new Set(sel.invoices().filter((r) => r.richtung !== 'eingang' && r.id !== ausser && r.nummer).map((r) => String(r.nummer).trim()));
}

export async function rechnungSpeichern(r) {
  r.updatedAt = new Date().toISOString();
  return upsertEntity('invoices', r, 'rechnung');
}

export async function entwurfLoeschen(id) {
  const r = sel.invoice(id);
  if (!r) return;
  if (r.status === 'ausgestellt') throw new Error('Eine ausgestellte Rechnung lässt sich nicht löschen, nur stornieren.');
  await deleteEntity('invoices', id, 'rechnung');
}

/** Passende Einnahmekategorie für einen Steuersatz. */
function kategorieFuer(satz) {
  const cats = sel.activeCategories('income');
  return (cats.find((c) => Number(c.vatRate) === Number(satz)) || cats[0])?.id || '';
}


/**
 * Die Buchungen zu einer Rechnung, je Steuersatz eine.
 * Bereits gezahlte Beträge (Anzahlungen) sind schon gebucht; gebucht wird
 * nur, was noch offen ist, anteilig je Steuersatz.
 * Eine Gutschrift (381) mindert die Einnahmen: Ihre Buchungen sind negativ.
 */
export function buchungenFuer(r, { kontoId = '', bezahlt = '' } = {}) {
  const b = berechnen(r);
  const fall = STEUERFAELLE[r.steuerfall] || STEUERFAELLE.standard;
  const gruppen = b.steuern.length ? b.steuern : [{ satz: 0, basis: 0, steuer: 0 }];
  const brutto = gruppen.map((g) => g.basis + g.steuer);
  const anteile = b.bereitsGezahlt ? aufteilen(b.zahlbetrag, brutto) : brutto;
  const kunde = r.kaeufer?.name || '';
  const vz = istGutschrift(r) ? -1 : 1;
  // Der Steuerfall bestimmt die Kennzahl der Voranmeldung: EU-Lieferung 41, Ausfuhr 43,
  // Steuerschuld beim Kunden in der EU 21, im Inland 60, Leistung außerhalb der EU 45;
  // ohne Angabe gilt der Steuersatz (0 % = steuerfrei, Kennzahl 48).
  const behandlung = fall.behandlung || '';
  const basis = gruppen.map((g, i) => {
    const gross = vz * anteile[i];
    const net = vz * (b.bereitsGezahlt ? Math.round(anteile[i] / (1 + g.satz / 100)) : g.basis);
    const tx = newTransactionDraft('income');
    Object.assign(tx, {
      id: uid('tx'),
      date: r.datum,
      description: `${titel(r)} ${r.nummer}${kunde ? `, ${kunde}` : ''}${gruppen.length > 1 ? ` (${g.satz} %)` : ''}`.slice(0, 200),
      categoryId: kategorieFuer(g.satz),
      contactId: r.kaeufer?.kontaktId || '',
      accountId: kontoId || tx.accountId,
      gross,
      net,
      vat: gross - net,
      vatRate: g.satz,
      paidDate: bezahlt || '',
      dueDate: faelligkeit(r),
      invoiceNumber: r.nummer,
      reference: r.nummer,
      reverseCharge: fall.kategorie === 'AE',
      ...(behandlung ? { vatTreatment: behandlung } : {}),
      attachments: [],
      invoiceId: r.id,
    });
    return tx;
  });
  // Zahlung in Raten: je Steuersatz und Rate eine Buchung, die erste zur Fälligkeit der Rechnung.
  // Ein „Schon bezahlt am“ gilt dann für die erste Rate (etwa die Anzahlung bei Vertragsbeginn).
  if (ratenAnzahl(r.raten?.anzahl) < 2 || istGutschrift(r)) return basis;
  const start = faelligkeit(r) || r.datum;
  return basis.flatMap((tx) => ratenBuchungen(tx, { anzahl: r.raten.anzahl, freq: r.raten.freq, start }))
    .map((tx) => (tx.rate === 1 && bezahlt ? { ...tx, paidDate: bezahlt } : tx));
}

/**
 * Stellt eine Rechnung aus. Rückgabe: die ausgestellte Rechnung.
 * @param {object} entwurf
 * @param {{buchen?:boolean, kontoId?:string, bezahlt?:string}} opts
 */
export async function ausstellen(entwurf, { buchen = true, kontoId = '', bezahlt = '' } = {}) {
  const s = store.db.settings;
  // Der kostenlose Tarif schreibt höchstens eine Handvoll Rechnungen im Monat (lib/tarife.js: GRENZEN). Stornos zählen nicht.
  if (!entwurf.storno) grenzePruefen('rechnungenMonat', rechnungenImMonat(store.db));
  const r = structuredClone(entwurf);
  if (!r.datum) r.datum = todayISO();
  if (isLockedDate(r.datum)) throw new Error('Das Rechnungsdatum liegt im festgeschriebenen Zeitraum. Bitte ein späteres Datum wählen.');
  if (r.leistungArt !== 'zeitraum' && !r.leistungsdatum) r.leistungsdatum = r.datum;
  if (!String(r.nummer || '').trim()) r.nummer = nextInvoiceNumber(Number(r.datum.slice(0, 4)), profilAus(s).praefix);
  r.nummer = String(r.nummer).trim();
  if (vergebeneNummern(r.id).has(r.nummer)) throw new Error(`Die Rechnungsnummer ${r.nummer} ist schon vergeben.`);
  r.faellig = faelligkeit(r);
  r.positionen = r.positionen.filter((p) => String(p.name || '').trim() || String(p.beschreibung || '').trim() || Number(p.preis));
  r.verkaeufer = verkaeuferAus(s);
  r.gestaltung = designAus(s);
  // Ob der Hinweis auf den Verzug nach 30 Tagen auf der Rechnung steht (§ 286 Abs. 3 BGB); das Mahnwesen rechnet damit.
  r.verzugsHinweis = verzugHinweisNoetig(r);

  const { pdf, xmlX } = await dateienErzeugen(r, { v: r.verkaeufer, d: r.gestaltung });
  const xmlBytes = new TextEncoder().encode(xmlX);
  const metaPdf = await api.attach.add(pdfDateiname(r), 'application/pdf', base64(pdf));
  const metaXml = await api.attach.add(xmlDateiname(r, 'xrechnung'), 'application/xml', base64(xmlBytes));
  r.dateien = { pdf: metaPdf.id, xml: metaXml.id };
  r.status = 'ausgestellt';
  r.ausgestelltAm = new Date().toISOString();

  let buchungen = [];
  if (buchen) {
    buchungen = buchungenFuer(r, { kontoId, bezahlt });
    // Beleg zur Buchung: eine eigene Kopie des PDFs (siehe oben).
    const kopie = await api.attach.add(pdfDateiname(r), 'application/pdf', base64(pdf));
    buchungen[0].attachments = [kopie.id];
    for (const [i, tx] of buchungen.entries()) await upsertTransaction(tx, i === 0 ? [kopie] : []);
    r.transactionIds = buchungen.map((t) => t.id);
  }
  if (r.bezahltAm === undefined && bezahlt && !buchen) r.bezahltAm = bezahlt;

  // „Rechnung wiederholen“: Diese Rechnung ist das erste Vorkommen der neuen Regel.
  const regel = r.wiederholung?.freq && kann('wiederkehrend') && !r.storno && String(r.art) === '380' && !r.wiederkehrendId
    ? regelAusRechnung(r, r.wiederholung, { id: uid('rec') }) : null;
  if (regel) r.wiederkehrendId = regel.id;

  await commit('rechnung.ausstellen', (db) => {
    for (const meta of [metaPdf, metaXml]) {
      if (!db.attachments.some((a) => a.id === meta.id)) db.attachments.push(meta);
    }
    r.updatedAt = new Date().toISOString();
    const i = db.invoices.findIndex((x) => x.id === r.id);
    if (i >= 0) db.invoices[i] = r; else db.invoices.push(r);
    // Die Bezugsrechnung erfährt von ihrer Stornierung.
    if (r.storno && r.bezug?.id) {
      const orig = db.invoices.find((x) => x.id === r.bezug.id);
      if (orig) { orig.storniertDurch = r.id; orig.updatedAt = r.updatedAt; }
    }
    return r;
  }, { entity: 'rechnung', entityId: r.id, summary: `${titel(r)} ${r.nummer} ausgestellt, ${(berechnen(r).brutto / 100).toFixed(2)} €, ${r.kaeufer?.name || ''}` });
  if (regel) await upsertEntity('recurring', regel, 'wiederkehrend');
  return r;
}

/** Eine neue Rechnung aus einer bestehenden (Duplikat, Korrektur, Vorlage). */
export function kopieAlsEntwurf(quelle, ueberschreiben = {}) {
  const s = store.db.settings;
  const r = neueRechnung(s);
  const felder = ['art', 'steuerfall', 'befreiungsgrund', 'kaeufer', 'betreff', 'bestellnummer', 'kopftext', 'schlusstext', 'zahlungsart',
    'zahlungsbedingungen', 'skontoTage', 'skontoProzent', 'zahlungszielTage', 'leistungArt', 'waehrung', 'hinweisAufbewahrung', 'bilder'];
  for (const f of felder) if (quelle[f] !== undefined) r[f] = structuredClone(quelle[f]);
  r.positionen = (quelle.positionen || []).map((p) => ({ ...structuredClone(p), id: uid('pos') }));
  if (!r.positionen.length) r.positionen = neueRechnung(s).positionen;
  if (r.leistungArt === 'zeitraum') { r.leistungVon = ''; r.leistungBis = ''; }
  return Object.assign(r, ueberschreiben);
}

/**
 * Storniert eine ausgestellte Rechnung: Es entsteht eine Stornorechnung
 * (Korrekturrechnung mit umgekehrten Mengen) mit eigener Nummer, die sich
 * auf das Original bezieht, und die Buchungen werden storniert.
 * @returns {Promise<object>} die Stornorechnung
 */
export async function stornieren(id, grund = '') {
  const orig = sel.invoice(id);
  if (!orig || orig.status !== 'ausgestellt') throw new Error('Nur eine ausgestellte Rechnung lässt sich stornieren.');
  if (orig.storno) throw new Error('Eine Stornorechnung lässt sich nicht stornieren.');
  if (orig.storniertDurch) throw new Error('Diese Rechnung ist bereits storniert.');
  const st = kopieAlsEntwurf(orig, {
    art: '384',
    storno: true,
    datum: todayISO(),
    leistungArt: orig.leistungArt,
    leistungsdatum: orig.leistungsdatum,
    leistungVon: orig.leistungVon,
    leistungBis: orig.leistungBis,
    bezug: { id: orig.id, nummer: orig.nummer, datum: orig.datum },
    betreff: `Storno der Rechnung ${orig.nummer}${grund ? `: ${grund}` : ''}`,
    kopftext: `Hiermit stornieren wir die Rechnung ${orig.nummer} vom ${String(orig.datum).split('-').reverse().join('.')} in voller Höhe.`,
    schlusstext: '',
    zahlungsbedingungen: 'Der Betrag wird mit der ursprünglichen Rechnung verrechnet.',
    bereitsGezahlt: -Number(orig.bereitsGezahlt || 0),
    zahlungszielTage: 0,
  });
  st.positionen = st.positionen.map((p) => ({ ...p, menge: -Number(p.menge || 0) }));
  // Die Buchungen werden storniert statt gegengebucht: So heben sie sich auf.
  const ausgestellt = await ausstellen(st, { buchen: false });
  for (const txId of orig.transactionIds || []) {
    const tx = sel.transaction(txId);
    if (tx && !tx.voided && !tx.isReversal) await voidTransaction(txId, `Storno durch Rechnung ${ausgestellt.nummer}`);
  }
  return ausgestellt;
}

/** Als bezahlt markieren: die offenen Buchungen bekommen das Zahlungsdatum. */
export async function alsBezahlt(id, datum = todayISO()) {
  const r = sel.invoice(id);
  if (!r) return;
  const offen = (r.transactionIds || []).map(sel.transaction).filter((t) => t && !t.voided && !t.paidDate);
  for (const t of offen) {
    if (isLockedDate(datum)) throw new Error('Das Zahlungsdatum liegt im festgeschriebenen Zeitraum.');
    await upsertTransaction({ ...structuredClone(t), paidDate: datum });
  }
  await commit('rechnung.bezahlt', (db) => {
    const x = db.invoices.find((i) => i.id === id);
    if (x) { x.bezahltAm = datum; x.updatedAt = new Date().toISOString(); }
  }, { entity: 'rechnung', entityId: id, summary: `${r.nummer} bezahlt am ${datum}` });
}

/** Versand vermerken (bis zum echten Versand: von Hand). */
export async function versandVermerken(id, art = 'manuell', an = '') {
  await commit('rechnung.versand', (db) => {
    const x = db.invoices.find((i) => i.id === id);
    if (!x) return;
    x.versand = [...(x.versand || []), { ts: new Date().toISOString(), art, an }];
    x.updatedAt = new Date().toISOString();
  }, { entity: 'rechnung', entityId: id, summary: `Versand vermerkt (${art})` });
}

/* -------------------------------------------------------------------------- */
/* Vorlagen und Produkte                                                       */
/* -------------------------------------------------------------------------- */

export async function alsVorlage(r, { name, mitKunde = false } = {}) {
  const daten = {};
  for (const f of ['art', 'steuerfall', 'befreiungsgrund', 'betreff', 'kopftext', 'schlusstext', 'zahlungsart', 'zahlungsbedingungen',
    'skontoTage', 'skontoProzent', 'zahlungszielTage', 'leistungArt', 'bestellnummer', 'hinweisAufbewahrung', 'bilder']) daten[f] = structuredClone(r[f]);
  daten.positionen = (r.positionen || []).filter((p) => String(p.name || '').trim() || Number(p.preis)).map((p) => ({ ...structuredClone(p), id: uid('pos') }));
  if (mitKunde) daten.kaeufer = structuredClone(r.kaeufer);
  const v = { id: uid('rv'), name: String(name || '').trim() || 'Vorlage', daten };
  await upsertEntity('invoiceTemplates', v, 'rechnungsvorlage');
  return v;
}

export function ausVorlage(v) {
  return kopieAlsEntwurf({ ...neueRechnung(store.db.settings), ...structuredClone(v.daten || {}) });
}

export async function produktSpeichern(p) {
  return upsertEntity('products', p, 'produkt');
}
