/**
 * Kontovia – Archiv und Aufbewahrung (reine Logik).
 *
 * Betriebe müssen Bücher, Aufzeichnungen und Belege lange aufheben (§ 147 AO,
 * § 257 HGB, § 14b UStG) und dürfen personenbezogene Daten danach nicht
 * endlos behalten (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO). Diese Datei rechnet,
 * was wann gilt, und stellt zusammen, was ein Jahr ausmacht:
 *
 *   fristen()          die Jahre je Art, aus den Einstellungen oder gesetzlich
 *   loeschbarAb()      der erste Tag, an dem ein Jahr gelöscht werden darf:
 *                      die Frist beginnt mit dem Schluss des Kalenderjahres
 *                      (§ 147 Abs. 4 AO), also Jahr + Frist + 1, am 1. Januar
 *   jahresuebersicht() je Jahr: Umfang, Festschreibung, Archiv, Fristen, Stand
 *   jahresinhalt()     alles, was zu einem Jahr gehört (für das Jahresarchiv)
 *   loeschplan()       was ein Löschlauf entfernt, und was bleiben muss
 *   auskunft()         alles zu einer Person (Art. 15 DSGVO), als Daten und Text
 *
 * Gesetzliche Fristen (Stand 2025, Viertes Bürokratieentlastungsgesetz):
 *   Bücher, Aufzeichnungen, Jahresabschlüsse, Inventare   10 Jahre
 *   Buchungsbelege, Rechnungen (§ 14b UStG)                8 Jahre
 *   Handels- und Geschäftsbriefe                           6 Jahre
 * Kontovia hält Buchungen 10 Jahre und Belege 8 Jahre, beides einstellbar
 * (nach oben, etwa bei laufender Außenprüfung: § 147 Abs. 3 Satz 5 AO).
 *
 * Das Änderungsjournal wird nie gelöscht (Nutzerentscheid 2.26): Es ist der
 * Nachweis, was wann geschah, auch für den Löschlauf selbst.
 *
 * Reine Logik ohne Zugriff auf store oder Oberfläche; der Bestand kommt als
 * Argument. Aktionen (Archiv schreiben, löschen): lib/archivaktionen.js.
 */

import { fmtDate, money, int, todayISO } from './util.js';

/** Gesetzliche Mindestfristen in Jahren. */
export const GESETZ = Object.freeze({ buchhaltung: 10, belege: 8 });
/** Was sich einstellen lässt: nicht unter dem Gesetz, nicht über 30 Jahre. */
export const FRIST_GRENZEN = Object.freeze({ min: GESETZ.belege, max: 30 });

/**
 * Die geltenden Fristen in Jahren.
 * @param {object} settings  settings.aufbewahrungJahre, settings.aufbewahrungBelegeJahre
 */
export function fristen(settings = {}) {
  const lesen = (v, gesetz) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= gesetz && n <= FRIST_GRENZEN.max ? n : gesetz;
  };
  const buchhaltung = lesen(settings.aufbewahrungJahre, GESETZ.buchhaltung);
  // Belege nie länger als die Buchhaltung, die zu ihnen gehört.
  const belege = Math.min(lesen(settings.aufbewahrungBelegeJahre, GESETZ.belege), buchhaltung);
  return { buchhaltung, belege };
}

/** Der erste Tag, ab dem ein Jahr nach `jahre` Jahren Frist gelöscht werden darf (§ 147 Abs. 4 AO). */
export function loeschbarAb(jahr, jahre) {
  return `${Number(jahr) + Number(jahre) + 1}-01-01`;
}

/** Der letzte Tag der Frist, für die Anzeige. */
export function fristEnde(jahr, jahre) {
  return `${Number(jahr) + Number(jahre)}-12-31`;
}

const jahrAus = (iso) => {
  const j = Number(String(iso || '').slice(0, 4));
  return j >= 1900 && j <= 2999 ? j : null;
};

/** Das Jahr einer Buchung: das der letzten Eintragung (Rechnungs- oder Zahlungsdatum, was später ist). */
export function buchungsJahr(t) {
  const spaet = [t.date, t.paidDate].filter(Boolean).sort().at(-1);
  return jahrAus(spaet);
}

/** Eingangsrechnungen tragen ihr Datum unter `gelesen` (views/rechnungen.js). */
const rechnungsJahr = (r) => jahrAus([r.datum || r.gelesen?.datum, r.bezahltAm].filter(Boolean).sort().at(-1));
const mahnungsJahr = (m) => jahrAus(m.datum);
const importJahr = (i) => jahrAus(i.bis || i.ts);
const elsterJahr = (e) => (Number.isInteger(Number(e.jahr)) ? Number(e.jahr) : jahrAus(e.von));

/* -------------------------------------------------------------------------- */
/* Inhalt eines Jahres                                                         */
/* -------------------------------------------------------------------------- */

/** Belegkennungen, auf die eine Rechnung oder Mahnung verweist. */
const rechnungsDateien = (r) => [r?.dateien?.pdf, r?.dateien?.xml, r?.pdfId, r?.anhangId].filter(Boolean);
const mahnungsDateien = (m) => [m?.pdfId].filter(Boolean);

/**
 * Alles, was zu einem Jahr gehört. Belege sind die Dateien, auf die Buchungen,
 * Rechnungen und Mahnungen des Jahres verweisen. `journal` sind die
 * Journaleinträge mit Zeitstempel im Jahr (der Bestand sollte dafür das ganze
 * Journal enthalten, api.vault.journal()).
 */
export function jahresinhalt(db, jahr) {
  const j = Number(jahr);
  const transactions = (db.transactions || []).filter((t) => buchungsJahr(t) === j);
  const invoices = (db.invoices || []).filter((r) => rechnungsJahr(r) === j);
  const rechnungsIds = new Set(invoices.map((r) => r.id));
  const reminders = (db.reminders || []).filter((m) => mahnungsJahr(m) === j || rechnungsIds.has(m.invoiceId));
  const belegIds = new Set([
    ...transactions.flatMap((t) => t.attachments || []),
    ...invoices.flatMap(rechnungsDateien),
    ...reminders.flatMap(mahnungsDateien),
  ]);
  const attachments = (db.attachments || []).filter((a) => belegIds.has(a.id));
  const imports = (db.imports || []).filter((i) => importJahr(i) === j);
  const elsterMeldungen = (db.elsterMeldungen || []).filter((e) => elsterJahr(e) === j);
  const kontaktIds = new Set([
    ...transactions.map((t) => t.contactId),
    ...invoices.map((r) => r.kaeufer?.kontaktId),
  ].filter(Boolean));
  const contacts = (db.contacts || []).filter((c) => kontaktIds.has(c.id));
  const kategorieIds = new Set(transactions.map((t) => t.categoryId).filter(Boolean));
  const kontoIds = new Set(transactions.map((t) => t.accountId).filter(Boolean));
  const praefix = `${j}-`;
  const journal = (db.auditLog || []).filter((e) => String(e.ts || '').startsWith(praefix));
  return {
    jahr: j, von: `${j}-01-01`, bis: `${j}-12-31`,
    transactions, invoices, reminders, attachments, imports, elsterMeldungen, contacts,
    categories: (db.categories || []).filter((c) => kategorieIds.has(c.id)),
    accounts: (db.accounts || []).filter((a) => kontoIds.has(a.id)),
    locks: (db.locks || []).filter((l) => jahrAus(l.until) === j),
    journal,
  };
}

/* -------------------------------------------------------------------------- */
/* Übersicht                                                                   */
/* -------------------------------------------------------------------------- */

/** Der neueste Archivvermerk eines Jahres (es kann mehrere geben, wenn das Archiv neu erstellt wurde). */
export function archivVon(db, jahr) {
  return (db.archive || []).filter((a) => Number(a.jahr) === Number(jahr))
    .sort((a, b) => String(b.erstelltAm).localeCompare(String(a.erstelltAm)))[0] || null;
}

/** Bis zu diesem Datum ist festgeschrieben (wie store.js: lockedUntil, hier ohne store). */
export function festgeschriebenBis(db) {
  return (db.locks || []).reduce((acc, l) => (l.until > acc ? l.until : acc), '');
}

/**
 * Je Jahr mit Buchhaltung: Umfang, Festschreibung, Archiv, Fristen und der
 * Stand (`status`): 'offen' (Frist läuft), 'archivieren' (Frist um, kein
 * Archiv), 'loeschbar' (Frist um und archiviert), 'geloescht'.
 * @param {object} db
 * @param {string} [heute]
 */
export function jahresuebersicht(db, heute = todayISO()) {
  const f = fristen(db.settings || {});
  const jahre = new Set();
  for (const t of db.transactions || []) { const j = buchungsJahr(t); if (j) jahre.add(j); }
  for (const r of db.invoices || []) { const j = rechnungsJahr(r); if (j) jahre.add(j); }
  for (const a of db.archive || []) if (Number.isInteger(Number(a.jahr))) jahre.add(Number(a.jahr));
  const bis = festgeschriebenBis(db);
  const laufend = Number(heute.slice(0, 4));
  return [...jahre].sort((a, b) => b - a).map((jahr) => {
    const inhalt = jahresinhalt(db, jahr);
    const archiv = archivVon(db, jahr);
    const leer = !inhalt.transactions.length && !inhalt.invoices.length;
    const ab = loeschbarAb(jahr, f.buchhaltung);
    const belegeAb = loeschbarAb(jahr, f.belege);
    const geloescht = !!archiv?.geloeschtAm && leer;
    let status = 'offen';
    if (geloescht) status = 'geloescht';
    else if (heute >= ab) status = archiv ? 'loeschbar' : 'archivieren';
    return {
      jahr,
      laufend: jahr >= laufend,
      buchungen: inhalt.transactions.length,
      rechnungen: inhalt.invoices.length,
      mahnungen: inhalt.reminders.length,
      belege: inhalt.attachments.length,
      journal: inhalt.journal.length,
      festgeschrieben: !!bis && bis >= `${jahr}-12-31`,
      archiv,
      fristEnde: fristEnde(jahr, f.buchhaltung),
      loeschbarAb: ab,
      belegeFristEnde: fristEnde(jahr, f.belege),
      belegeLoeschbarAb: belegeAb,
      belegeFaellig: heute >= belegeAb && !geloescht && inhalt.attachments.length > 0,
      faellig: heute >= ab && !geloescht,
      status,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Löschplan                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Was ein Löschlauf für ein Jahr entfernt. Belege, die auch ein anderes Jahr
 * braucht, bleiben; Kontakte gehen nur mit, wenn danach nichts mehr auf sie
 * verweist (Buchungen, Rechnungen, Termine anderer Jahre).
 * @param {object} db
 * @param {number} jahr
 * @param {{nurBelege?:boolean, kontakte?:boolean}} [opts]  nurBelege: Belegdateien löschen, Buchungen behalten (Frist 8 Jahre)
 */
export function loeschplan(db, jahr, { nurBelege = false, kontakte = true } = {}) {
  const inhalt = jahresinhalt(db, jahr);
  const weg = {
    transactions: nurBelege ? [] : inhalt.transactions.map((t) => t.id),
    invoices: nurBelege ? [] : inhalt.invoices.map((r) => r.id),
    reminders: nurBelege ? [] : inhalt.reminders.map((m) => m.id),
    imports: nurBelege ? [] : inhalt.imports.map((i) => i.id),
    elsterMeldungen: nurBelege ? [] : inhalt.elsterMeldungen.map((e) => e.id),
    attachments: [],
    contacts: [],
  };
  const wegT = new Set(weg.transactions);
  const wegR = new Set(weg.invoices);
  const wegM = new Set(weg.reminders);
  // Belege: nur, wenn kein bleibender Datensatz mehr auf sie verweist.
  const bleibend = new Set();
  for (const t of db.transactions || []) if (!wegT.has(t.id) && (nurBelege ? buchungsJahr(t) !== Number(jahr) : true)) for (const id of t.attachments || []) bleibend.add(id);
  for (const r of db.invoices || []) if (!wegR.has(r.id) && (nurBelege ? rechnungsJahr(r) !== Number(jahr) : true)) for (const id of rechnungsDateien(r)) bleibend.add(id);
  for (const m of db.reminders || []) if (!wegM.has(m.id) && (nurBelege ? mahnungsJahr(m) !== Number(jahr) : true)) for (const id of mahnungsDateien(m)) bleibend.add(id);
  weg.attachments = inhalt.attachments.map((a) => a.id).filter((id) => !bleibend.has(id));
  if (kontakte && !nurBelege) {
    const genutzt = new Set();
    for (const t of db.transactions || []) if (!wegT.has(t.id) && t.contactId) genutzt.add(t.contactId);
    for (const r of db.invoices || []) if (!wegR.has(r.id) && r.kaeufer?.kontaktId) genutzt.add(r.kaeufer.kontaktId);
    for (const a of db.appointments || []) if (a.contactId) genutzt.add(a.contactId);
    for (const w of db.recurring || []) if (w.template?.contactId) genutzt.add(w.template.contactId);
    weg.contacts = inhalt.contacts.map((c) => c.id).filter((id) => !genutzt.has(id));
  }
  return { jahr: Number(jahr), nurBelege, ...weg, anzahl: Object.fromEntries(Object.entries(weg).map(([k, v]) => [k, v.length])) };
}

/** Ein Satz, was ein Löschplan entfernt (für Rückfrage und Journal). */
export function loeschplanText(plan) {
  const teile = [
    [plan.transactions.length, 'Buchung', 'Buchungen'],
    [plan.invoices.length, 'Rechnung', 'Rechnungen'],
    [plan.reminders.length, 'Mahnung', 'Mahnungen'],
    [plan.attachments.length, 'Beleg', 'Belege'],
    [plan.imports.length, 'Kontoauszug-Import', 'Kontoauszug-Importe'],
    [plan.elsterMeldungen.length, 'Voranmeldung', 'Voranmeldungen'],
    [plan.contacts.length, 'Kontakt ohne weitere Vorgänge', 'Kontakte ohne weitere Vorgänge'],
  ].filter(([n]) => n > 0).map(([n, eins, viele]) => `${int(n)} ${n === 1 ? eins : viele}`);
  return teile.length ? teile.join(', ') : 'nichts';
}

/* -------------------------------------------------------------------------- */
/* Auskunft zu einer Person (Art. 15 DSGVO)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Alles, was der Bestand zu einem Kontakt enthält: Stammdaten, Buchungen,
 * Rechnungen, Mahnungen, Termine, wiederkehrende Buchungen und die
 * Journaleinträge, die ihn nennen. `text` ist die lesbare Fassung.
 */
export function auskunft(db, kontaktId, heute = todayISO()) {
  const k = (db.contacts || []).find((c) => c.id === kontaktId);
  if (!k) throw new Error('Diesen Kontakt gibt es nicht.');
  const buchungen = (db.transactions || []).filter((t) => t.contactId === k.id).sort((a, b) => a.date.localeCompare(b.date));
  const rechnungen = (db.invoices || []).filter((r) => r.kaeufer?.kontaktId === k.id).sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  const rIds = new Set(rechnungen.map((r) => r.id));
  const mahnungen = (db.reminders || []).filter((m) => rIds.has(m.invoiceId));
  const termine = (db.appointments || []).filter((a) => a.contactId === k.id);
  const wiederkehrend = (db.recurring || []).filter((w) => w.template?.contactId === k.id);
  const name = String(k.name || '').trim();
  const journal = (db.auditLog || []).filter((e) => e.entityId === k.id || (name && String(e.summary || '').includes(name)));
  const f = fristen(db.settings || {});
  const letztes = [...buchungen.map(buchungsJahr), ...rechnungen.map(rechnungsJahr)].filter(Boolean).sort().at(-1);
  const zeilen = [
    `Datenauskunft nach Art. 15 DSGVO`,
    `Erstellt am ${fmtDate(heute)} aus Kontovia (${db.settings?.companyName || db.settings?.ownerName || 'Betrieb'})`,
    '',
    'Gespeicherte Stammdaten:',
    ...Object.entries(k).filter(([key, v]) => v !== '' && v != null && !['id', 'updatedAt', 'createdAt'].includes(key)).map(([key, v]) => `  ${key}: ${typeof v === 'object' ? JSON.stringify(v) : v}`),
    '',
    `Zweck: Buchführung und Rechnungsstellung (Art. 6 Abs. 1 lit. b und c DSGVO), Aufbewahrung nach § 147 AO.`,
    letztes ? `Letzter Vorgang: ${letztes}. Aufbewahrung bis ${fristEnde(letztes, f.buchhaltung)} (Buchungen) bzw. ${fristEnde(letztes, f.belege)} (Belege); danach Löschung.` : 'Keine Vorgänge: Die Stammdaten können jederzeit gelöscht werden.',
    'Empfänger: Finanzverwaltung und Steuerberatung, soweit gesetzlich vorgesehen. Keine Übermittlung an Dritte durch Kontovia.',
    '',
    `Buchungen (${buchungen.length}):`,
    ...buchungen.map((t) => `  ${fmtDate(t.date)}  ${t.type === 'income' ? 'Einnahme' : 'Ausgabe'}  ${money(t.gross)} €  ${t.description || ''}${t.invoiceNumber ? `  (${t.invoiceNumber})` : ''}${t.paidDate ? `  bezahlt ${fmtDate(t.paidDate)}` : '  offen'}`),
    '',
    `Rechnungen (${rechnungen.length}):`,
    ...rechnungen.map((r) => `  ${fmtDate(r.datum)}  ${r.nummer || 'Entwurf'}  ${r.betreff || ''}`),
    '',
    `Mahnungen (${mahnungen.length}):`,
    ...mahnungen.map((m) => `  ${fmtDate(m.datum)}  Stufe ${m.stufe}  zu ${m.nummer || m.invoiceId}`),
    '',
    `Termine (${termine.length}):`,
    ...termine.map((a) => `  ${fmtDate(a.date)}  ${a.title || ''}`),
    '',
    `Journaleinträge, die diesen Kontakt nennen (${journal.length}): ${journal.length ? journal.map((e) => `${String(e.ts).slice(0, 10)} ${e.action}`).slice(0, 50).join('; ') : 'keine'}`,
  ];
  return {
    daten: { kontakt: k, buchungen, rechnungen, mahnungen, termine, wiederkehrend, journal, erstelltAm: heute },
    text: zeilen.join('\n'),
  };
}

/** Kurzer Text zum Archiv eines Jahres (Karte, Journal). */
export function archivText(a) {
  if (!a) return 'kein Archiv';
  return `${a.dateiName || 'Archiv'} vom ${fmtDate(String(a.erstelltAm).slice(0, 10))}, SHA-256 ${String(a.sha256 || '').slice(0, 12)}…`;
}
