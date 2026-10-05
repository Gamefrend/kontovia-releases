/**
 * Kontovia – Mahnungen erstellen, ansehen, verwerfen, Mahnkosten buchen.
 *
 * Eine Mahnung ist ein eigener Datensatz (Sammlung `reminders`) und ein PDF im
 * Tresor, aufbewahrt wie ein Handelsbrief. Sie verändert die Rechnung nie:
 * Weder die Rechnung noch ihre Buchungen noch deren Festschreibung werden
 * angefasst, der Verlauf hängt nur an der Rechnungskennung. Das Erzeugen
 * einer Mahnung bucht nichts.
 *
 * Mahngebühr und Verzugsaufschlag sind keine Umsatzerlöse der Rechnung (siehe
 * lib/mahnwesen.js). Gebucht werden sie erst, wenn das Geld eingegangen ist,
 * als eigene Einnahme mit eigener Kategorie, ohne Umsatzsteuer.
 */

import { uid, todayISO } from './util.js';
import { store, sel, commit, upsertTransaction, isLockedDate, newTransactionDraft } from './store.js';
import { verkaeuferAus, design as designAus, titel as titelVon } from './rechnung.js';
import { mahnungPdf, pdfDateiname } from './rechnungsdruck.js';
import { bilderLaden, base64ZuBytes } from './rechnungsdateien.js';
import { base64 } from './pdfausgabe.js';
import {
  mahneinstellungen, mahnbarkeit, mahnverlauf, mahnungBerechnen, mahnschreiben, mahnkostenStand, stufenName,
} from './mahnwesen.js';

const api = globalThis.window?.kontovia || {};

/** Feste Kennung, damit zwei Geräte dieselbe Kategorie anlegen und sich beim Abgleich treffen. */
export const MAHNKOSTEN_KATEGORIE = 'cat_e_mahn';

export const mahnungen = () => store.db?.reminders || [];

/** Die Kategorie der Mahnkosten, falls es sie gibt (auch eine, die jemand selbst so markiert hat). */
export function mahnkostenKategorie(db = store.db) {
  return (db?.categories || []).find((c) => c.mahnkosten) || (db?.categories || []).find((c) => c.id === MAHNKOSTEN_KATEGORIE) || null;
}

/** Legt die Kategorie an, wenn sie fehlt: nicht steuerbar, EÜR-Zeile 16 (Vordruck 2025). */
export async function mahnkostenKategorieSichern() {
  const da = mahnkostenKategorie();
  if (da) return da;
  const kat = {
    id: MAHNKOSTEN_KATEGORIE,
    kind: 'income',
    name: 'Mahngebühren und Verzugsaufschlag',
    euerLine: 16,
    skr03: '2700',
    skr04: '4830',
    vatRate: 0,
    active: true,
    notTaxable: true,
    mahnkosten: true,
  };
  kat.updatedAt = new Date().toISOString();
  kat.createdAt = kat.updatedAt;
  await commit('kategorie.anlegen', (db) => {
    db.categories.push(kat);
    return kat;
  }, { entity: 'kategorie', entityId: kat.id, summary: kat.name });
  return kat;
}

/* -------------------------------------------------------------------------- */
/* Überfällige Rechnungen                                                      */
/* -------------------------------------------------------------------------- */

const buchungenVon = (r) => (r.transactionIds || []).map((id) => sel.transaction(id)).filter(Boolean);

/** Stand einer Rechnung im Mahnwesen (siehe mahnbarkeit). */
export function mahnstand(r, heute = todayISO()) {
  return mahnbarkeit(r, { buchungen: buchungenVon(r), mahnungen: mahnungen(), heute });
}

/** Alle überfälligen, mahnbaren Rechnungen mit ihrem Stand, die dringendsten zuerst. */
export function ueberfaelligeRechnungen(heute = todayISO()) {
  return sel.invoices()
    .filter((r) => r.richtung !== 'eingang')
    .map((r) => ({ r, s: mahnstand(r, heute) }))
    .filter((x) => x.s.mahnbar)
    .sort((a, b) => b.s.tageUeber - a.s.tageUeber || String(a.r.nummer).localeCompare(String(b.r.nummer)));
}

/** Bereits gebuchte und noch offene Mahnkosten einer Rechnung. */
export function mahnkostenVon(rechnungId) {
  return mahnkostenStand(rechnungId, mahnungen(), sel.transactions());
}

/* -------------------------------------------------------------------------- */
/* Erstellen                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Berechnung und Schreiben zu den Wahlen im Dialog, ohne etwas zu speichern.
 * @param {string} rechnungId
 * @param {{stufe:number, datum?:string, frist?:string, gebuehr?:number, prozent?:boolean, pauschale?:boolean,
 *   kundenart?:string, kopf?:string, schluss?:string}} wahl
 */
export function mahnungVorbereiten(rechnungId, wahl) {
  const r = sel.invoice(rechnungId);
  if (!r) throw new Error('Diese Rechnung gibt es nicht mehr.');
  const buchungen = buchungenVon(r);
  const stand = mahnkostenStand(r.id, mahnungen(), sel.transactions());
  const datum = wahl.datum || todayISO();
  const mb = mahnbarkeit(r, { buchungen, mahnungen: mahnungen(), heute: datum });
  const b = mahnungBerechnen({
    r, buchungen, mahnungen: mahnungen(), stufe: wahl.stufe, datum, einstellungen: mahneinstellungen(store.db.settings),
    frist: wahl.frist || '', gebuehr: wahl.gebuehr ?? null, prozent: wahl.prozent ?? null, pauschale: wahl.pauschale ?? null,
    bezahlteMahnkosten: stand.bezahlt, kundenart: wahl.kundenart || null,
  });
  const brief = mahnschreiben(r, b, { kopf: wahl.kopf, schluss: wahl.schluss });
  return { r, mahnbarkeit: mb, berechnung: b, brief };
}

/** Rechnung mit dem Feld `mahnung`, wie die Seitensetzung sie erwartet. Das Schreiben trägt Absender und Gestaltung von heute. */
function schreibenRechnung(r, brief) {
  return { ...r, mahnung: brief, zahlungsart: 'ueberweisung', bilder: [], storno: false, bezug: null, betreff: '' };
}

/** PDF-Bytes zu einem Schreiben. */
export async function mahnungPdfErzeugen(r, brief) {
  const s = store.db.settings;
  const v = verkaeuferAus(s);
  const d = designAus(s);
  const bilder = await bilderLaden(d, null);
  return mahnungPdf(schreibenRechnung(r, brief), v, d, { bilder });
}

/**
 * Erstellt die Mahnung: PDF im Tresor, Datensatz mit Beträgen, Eintrag im Journal.
 * Gebucht wird nichts; die Rechnung bleibt unverändert.
 * @returns {Promise<object>} der Datensatz der Mahnung
 */
export async function mahnungErstellen(rechnungId, wahl) {
  const { r, mahnbarkeit: mb, berechnung: b, brief } = mahnungVorbereiten(rechnungId, wahl);
  if (!mb.mahnbar) throw new Error(mb.grund || 'Diese Rechnung lässt sich nicht mahnen.');
  if (b.rest <= 0) throw new Error('Es ist nichts mehr offen.');
  if (b.warnungen.some((w) => w.startsWith('Die Zahlungsfrist liegt nicht'))) throw new Error('Die Zahlungsfrist muss nach dem Datum des Schreibens liegen.');

  const pdf = await mahnungPdfErzeugen(r, brief);
  const meta = await api.attach.add(pdfDateiname(schreibenRechnung(r, brief)), 'application/pdf', base64(pdf));
  const jetzt = new Date().toISOString();
  const m = {
    id: uid('mh'),
    invoiceId: r.id,
    nummer: r.nummer,
    kunde: r.kaeufer?.name || '',
    kundenart: b.kundenart,
    stufe: b.stufe,
    datum: b.datum,
    frist: b.frist,
    rest: b.rest,
    gebuehr: b.gebuehr,
    aufschlag: b.aufschlag,
    nebenGesamt: b.nebenGesamt,
    gesamt: b.gesamt,
    pdfId: meta.id,
    createdAt: jetzt,
    updatedAt: jetzt,
  };
  await commit('mahnung.erstellen', (db) => {
    if (!db.attachments.some((a) => a.id === meta.id)) db.attachments.push(meta);
    db.reminders ??= [];
    db.reminders.push(m);
    return m;
  }, {
    entity: 'mahnung',
    entityId: m.id,
    summary: `${stufenName(m.stufe)} zu ${titelVon(r)} ${r.nummer}, ${(m.gesamt / 100).toFixed(2)} €, Gebühr ${(m.gebuehr / 100).toFixed(2)} €, Verzugsaufschlag ${((Number(m.aufschlag.zins) + (m.aufschlag.pauschaleNeu ? Number(m.aufschlag.pauschale) : 0)) / 100).toFixed(2)} €`,
  });
  return m;
}

/**
 * Nimmt eine Mahnung zurück (etwa weil sie irrtümlich erstellt wurde und nicht
 * verschickt ist). Sie bleibt mit ihrem PDF im Verlauf sichtbar, zählt aber
 * nicht mehr für die nächste Stufe und die Mahnkosten.
 */
export async function mahnungVerwerfen(id, grund = '') {
  const m = mahnungen().find((x) => x.id === id);
  if (!m) throw new Error('Diese Mahnung gibt es nicht mehr.');
  if (m.verworfen) return m;
  const gebucht = sel.transactions().some((t) => t.mahnungId === id && !t.voided && !t.isReversal);
  if (gebucht) throw new Error('Zu dieser Mahnung sind schon Mahnkosten gebucht. Bitte zuerst die Buchung stornieren.');
  return commit('mahnung.verwerfen', (db) => {
    const x = db.reminders.find((q) => q.id === id);
    x.verworfen = { am: new Date().toISOString(), grund: String(grund || '').slice(0, 200) };
    x.updatedAt = x.verworfen.am;
    return x;
  }, { entity: 'mahnung', entityId: id, summary: `${stufenName(m.stufe)} zu ${m.nummer} verworfen${grund ? `: ${grund}` : ''}` });
}

/** Die abgelegte PDF-Datei einer Mahnung. */
export async function mahnungPdfLesen(m) {
  if (!m?.pdfId) return null;
  return base64ZuBytes(await api.attach.read(m.pdfId));
}

/* -------------------------------------------------------------------------- */
/* Mahnkosten buchen                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Die Buchung der Mahnkosten (Entwurf, noch nicht gespeichert): eigene
 * Einnahme, nicht steuerbar, gleicher Betrag brutto wie netto. Das Datum ist
 * der Tag des Zahlungseingangs, denn der Anspruch entsteht erst mit der Mahnung
 * und zählt als Betriebseinnahme, sobald das Geld da ist (§ 11 EStG).
 */
export function mahnkostenBuchung(r, { betrag, datum, kontoId = '', mahnungId = '', kategorieId = '' }) {
  const tx = newTransactionDraft('income');
  const kunde = r.kaeufer?.name || '';
  Object.assign(tx, {
    id: uid('tx'),
    date: datum,
    paidDate: datum,
    description: `Mahnkosten zu Rechnung ${r.nummer}${kunde ? `, ${kunde}` : ''}`.slice(0, 200),
    categoryId: kategorieId || mahnkostenKategorie()?.id || '',
    contactId: r.kaeufer?.kontaktId || '',
    accountId: kontoId || tx.accountId,
    gross: betrag,
    net: betrag,
    vat: 0,
    vatRate: 0,
    vatTreatment: 'nicht-steuerbar',
    reverseCharge: false,
    invoiceNumber: r.nummer,
    reference: r.nummer,
    dueDate: '',
    attachments: [],
    mahnRechnungId: r.id,
    mahnungId,
    notes: 'Mahngebühr und Verzugsaufschlag: kein Entgelt für eine Leistung, deshalb ohne Umsatzsteuer.',
  });
  return tx;
}

/**
 * Bucht die noch offenen Mahnkosten einer Rechnung als eingegangen.
 * @param {string} rechnungId
 * @param {{datum?:string, kontoId?:string, betrag?:number}} [opt]  betrag: weniger als der offene Stand ist möglich
 * @returns {Promise<object>} die Buchung
 */
export async function mahnkostenBuchen(rechnungId, { datum = todayISO(), kontoId = '', betrag = null } = {}) {
  const r = sel.invoice(rechnungId);
  if (!r) throw new Error('Diese Rechnung gibt es nicht mehr.');
  const stand = mahnkostenVon(rechnungId);
  if (!stand.letzte || stand.offen <= 0) throw new Error('Es stehen keine Mahnkosten mehr offen.');
  const summe = betrag === null ? stand.offen : Math.round(Number(betrag));
  if (!(summe > 0) || summe > stand.offen) throw new Error('Der Betrag passt nicht zu den offenen Mahnkosten.');
  if (isLockedDate(datum)) throw new Error('Das Zahlungsdatum liegt im festgeschriebenen Zeitraum.');
  const kat = await mahnkostenKategorieSichern();
  const tx = mahnkostenBuchung(r, { betrag: summe, datum, kontoId, mahnungId: stand.letzte.id, kategorieId: kat.id });
  await upsertTransaction(tx);
  return tx;
}

export { mahnverlauf };
