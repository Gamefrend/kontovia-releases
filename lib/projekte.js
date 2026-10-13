/**
 * Kontovia – Projekte und Zeiterfassung (reine Regeln, ohne Speicher und Oberfläche).
 *
 * Ein Projekt (`projekte`, Id-Präfix `prj_`) gehört meist zu einem Kunden, hat einen Stundensatz und auf Wunsch ein
 * Budget (Geld oder Stunden). Zeiten (`zeiten`, `zt_`) gehören zu einem Projekt: Datum, Minuten, Beschreibung,
 * abrechenbar ja/nein. Eine laufende Stoppuhr ist eine Zeit mit `start` (Zeitstempel) und `laeuft: true`; beim
 * Anhalten werden daraus Minuten. Abgerechnete Zeiten tragen die Rechnung (`rechnungId`); als abgerechnet gilt eine
 * Zeit erst, wenn diese Rechnung ausgestellt ist (ein gelöschter Entwurf gibt sie wieder frei).
 *
 * Projekte sind zugleich Kostenstellen: Buchungen und Rechnungen tragen `projektId`. Die Auswertung je Projekt
 * zählt Einnahmen und Ausgaben netto (ohne Storno-Paare, ohne private Buchungen) und die Stunden.
 */

import { uid, todayISO } from './util.js';

export const PROJEKT_STATUS = { aktiv: 'Aktiv', pausiert: 'Pausiert', abgeschlossen: 'Abgeschlossen' };

export function neuesProjekt(vorgabe = {}) {
  const jetzt = new Date().toISOString();
  return {
    id: uid('prj'),
    name: '',
    kontaktId: '',
    stundensatz: 0, // Cent je Stunde, netto
    budget: 0, // Cent netto, 0 = ohne
    budgetStunden: 0, // 0 = ohne
    status: 'aktiv',
    kostenstelle: '', // kurzes Kürzel für DATEV (KOST1), frei
    notiz: '',
    createdAt: jetzt,
    updatedAt: jetzt,
    ...vorgabe,
  };
}

export function neueZeit(projektId, vorgabe = {}) {
  const jetzt = new Date().toISOString();
  return {
    id: uid('zt'),
    projektId,
    datum: todayISO(),
    minuten: 0,
    beschreibung: '',
    abrechenbar: true,
    rechnungId: '',
    start: '',
    laeuft: false,
    createdAt: jetzt,
    updatedAt: jetzt,
    ...vorgabe,
  };
}

/** Minuten zwischen zwei Zeitstempeln, auf ganze Minuten gerundet, höchstens 24 Stunden. */
export function minutenZwischen(start, ende = new Date().toISOString()) {
  const ms = Date.parse(ende) - Date.parse(start);
  if (!(ms > 0)) return 0;
  return Math.min(24 * 60, Math.round(ms / 60000));
}

/** „1:30“ aus 90 Minuten. */
export function dauerText(minuten) {
  const m = Math.max(0, Math.round(Number(minuten) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** „1:30“, „1,5“, „90m“, „1h 30“ → Minuten (oder null). */
export function dauerLesen(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)\s*(?:h|std\.?)\s*(\d+)\s*(?:m|min\.?)?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)\s*(?:m|min\.?)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:[.,]\d+)?)\s*(?:h|std\.?)?$/.exec(t);
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 60);
  return null;
}

/** Ist die Zeit schon abgerechnet? (Rechnung vorhanden und ausgestellt, nicht storniert) */
export function abgerechnet(z, rechnungen = []) {
  if (!z?.rechnungId) return false;
  const r = rechnungen.find((x) => x.id === z.rechnungId);
  return !!r && r.status === 'ausgestellt' && !r.storniertDurch;
}

/** Hängt die Zeit an einem Rechnungsentwurf (noch nicht ausgestellt)? */
export const imEntwurf = (z, rechnungen = []) => !!z?.rechnungId && rechnungen.some((x) => x.id === z.rechnungId && x.status !== 'ausgestellt');

/** Zeiten, die sich abrechnen lassen: abrechenbar, nicht laufend, nicht abgerechnet, nicht in einem Entwurf. */
export const offeneZeiten = (zeiten, rechnungen = []) => zeiten.filter((z) => z.abrechenbar && !z.laeuft && z.minuten > 0 && !abgerechnet(z, rechnungen) && !imEntwurf(z, rechnungen));

/** Buchungen, die zählen: nicht privat, keine Storno-Paare (Original storniert und Gegenbuchung heben sich auf). */
const zaehlt = (t) => !t.unlisted && !t.voided && !t.isReversal;

/**
 * Auswertung eines Projekts.
 * @returns {{minuten:number, offenMinuten:number, abgerechnetMinuten:number, offenWert:number, einnahmen:number,
 *   ausgaben:number, ergebnis:number, budgetAnteil:number|null, stundenAnteil:number|null, letzte:string}}
 */
export function projektAuswertung(db, projekt) {
  const zeiten = (db.zeiten || []).filter((z) => z.projektId === projekt.id && !z.laeuft);
  const rechnungen = db.invoices || [];
  const minuten = zeiten.reduce((s, z) => s + (Number(z.minuten) || 0), 0);
  const offen = offeneZeiten(zeiten, rechnungen);
  const offenMinuten = offen.reduce((s, z) => s + z.minuten, 0);
  const abgerechnetMinuten = zeiten.filter((z) => abgerechnet(z, rechnungen)).reduce((s, z) => s + z.minuten, 0);
  const txs = (db.transactions || []).filter((t) => t.projektId === projekt.id && zaehlt(t));
  const einnahmen = txs.filter((t) => t.type === 'income').reduce((s, t) => s + (Number(t.net) || 0), 0);
  const ausgaben = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + (Number(t.net) || 0), 0);
  // Budget in Geld: verbraucht ist, was abgerechnet ist, plus der Wert der offenen Stunden.
  const offenWert = Math.round((offenMinuten / 60) * (Number(projekt.stundensatz) || 0));
  const verbraucht = einnahmen + offenWert;
  const letzte = [...zeiten.map((z) => z.datum), ...txs.map((t) => t.date)].sort().pop() || '';
  return {
    minuten, offenMinuten, abgerechnetMinuten, offenWert, einnahmen, ausgaben, ergebnis: einnahmen - ausgaben,
    budgetAnteil: projekt.budget > 0 ? verbraucht / projekt.budget : null,
    stundenAnteil: projekt.budgetStunden > 0 ? minuten / 60 / projekt.budgetStunden : null,
    letzte,
  };
}

/**
 * Positionen für eine Rechnung aus Zeiten. `art`: 'einzeln' (je Zeit eine Position mit Datum),
 * 'tag' (je Tag eine Position), 'gesamt' (eine Position für alles). Einheit Stunde, Menge auf zwei Stellen.
 * @returns {Array<{name:string, beschreibung:string, menge:number, einheit:'HUR', preis:number}>}
 */
export function zeitenAlsPositionen(zeiten, projekt, { art = 'tag', fmtDate = (d) => d } = {}) {
  const satz = Number(projekt?.stundensatz) || 0;
  const stunden = (min) => Math.round((min / 60) * 100) / 100;
  const sortiert = [...zeiten].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  if (!sortiert.length) return [];
  if (art === 'gesamt') {
    const min = sortiert.reduce((s, z) => s + z.minuten, 0);
    const von = sortiert[0].datum;
    const bis = sortiert[sortiert.length - 1].datum;
    return [{ name: projekt?.name || 'Leistungen', beschreibung: von === bis ? fmtDate(von) : `${fmtDate(von)} bis ${fmtDate(bis)}`, menge: stunden(min), einheit: 'HUR', preis: satz }];
  }
  if (art === 'einzeln') {
    return sortiert.map((z) => ({ name: z.beschreibung || projekt?.name || 'Leistung', beschreibung: fmtDate(z.datum), menge: stunden(z.minuten), einheit: 'HUR', preis: satz }));
  }
  const tage = new Map();
  for (const z of sortiert) {
    const t = tage.get(z.datum) || { min: 0, texte: [] };
    t.min += z.minuten;
    if (z.beschreibung && !t.texte.includes(z.beschreibung)) t.texte.push(z.beschreibung);
    tage.set(z.datum, t);
  }
  return [...tage].map(([datum, t]) => ({ name: `${projekt?.name || 'Leistung'}, ${fmtDate(datum)}`, beschreibung: t.texte.join('; '), menge: stunden(t.min), einheit: 'HUR', preis: satz }));
}
