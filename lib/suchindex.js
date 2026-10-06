/**
 * Kontovia – Index und Treffersuche für die globale Suche (Strg+K), ohne
 * Bezug zur Oberfläche.
 *
 * Aus dem Bestand entsteht eine flache Liste von Einträgen. Jeder Eintrag
 * trägt einen Suchtext und ein Ziel (`ziel`), das die Oberfläche öffnet.
 * Gefunden wird, was alle Suchwörter enthält, in beliebiger Reihenfolge.
 */

import { norm, money, fmtDate } from './util.js';
import { aufgabenText } from './aufgaben.js';
import { stufenName } from './mahnwesen.js';

export const ART_NAMEN = {
  aktion: 'Aktionen',
  seite: 'Seiten',
  buchung: 'Buchungen',
  rechnung: 'Rechnungen',
  kontakt: 'Kontakte',
  termin: 'Termine',
  aufgabe: 'Aufgaben',
  stamm: 'Stammdaten',
};

/** Reihenfolge der Gruppen in der Ergebnisliste. */
export const ART_FOLGE = ['aktion', 'seite', 'aufgabe', 'termin', 'buchung', 'rechnung', 'kontakt', 'stamm'];

const SEITEN = [
  ['dashboard', 'Übersicht', 'start startseite dashboard zahlen'],
  ['transactions', 'Buchungen', 'einnahmen ausgaben journal liste'],
  ['kontoimport', 'Kontoauszug einlesen', 'import bank csv camt mt940 umsaetze sparkasse volksbank kontoauszug'],
  ['calendar', 'Kalender', 'termine monat'],
  ['todos', 'Aufgaben', 'todo to-do erledigen'],
  ['rechnungen', 'Rechnungen', 'e-rechnung xrechnung schreiben girocode'],
  ['rechnungen', 'Mahnwesen', 'mahnung zahlungserinnerung ueberfaellig mahngebuehr verzugsaufschlag mahnen', { tab: 'mahnwesen' }],
  ['reports', 'Auswertungen', 'euer ust umsatzsteuer guv berichte'],
  ['export', 'Export & Finanzamt', 'datev elster steuerberater csv excel xlsx vcard zusammenfassende meldung voranmeldung xml', { reiter: 'export' }],
  ['export', 'Daten übernehmen (Import)', 'import einlesen datev elster excel xlsx csv vcard kontakte produkte lexoffice sevdesk umzug wechsel voranmeldung', { reiter: 'import' }],
  ['master', 'Stammdaten', 'kontakte kategorien konten anlagen wiederkehrend'],
  ['settings', 'Einstellungen', 'firma sicherheit cloud darstellung festschreiben'],
  ['help', 'Hilfe', 'anleitung neuigkeiten datenschutz'],
];

const AKTIONEN = [
  ['neu-einnahme', 'Neue Einnahme', 'buchung erfassen'],
  ['neu-ausgabe', 'Neue Ausgabe', 'buchung erfassen beleg'],
  ['neu-aufgabe', 'Neue Aufgabe', 'todo anlegen'],
  ['neu-termin', 'Neuer Termin', 'kalender anlegen'],
  ['neu-rechnung', 'Neue Rechnung', 'schreiben ausstellen'],
  ['neu-kontakt', 'Neuer Kontakt', 'kunde lieferant anlegen'],
  ['sperren', 'Sperren', 'abschliessen sicherheit'],
];

const STAMM_ARTEN = { categories: 'Kategorie', accounts: 'Konto', assets: 'Anlagegut' };

function eintrag(art, id, titel, sub, extra, ziel, mehr = {}) {
  return { art, id, titel: String(titel || ''), sub: String(sub || ''), text: norm(`${titel} ${sub} ${extra}`), titelNorm: norm(titel), ziel, ...mehr };
}

const betrag = (c) => money(c);

/**
 * Baut die Eintragsliste.
 * @param {object} db  der Bestand
 * @returns {Array<object>}
 */
export function sucheIndex(db) {
  const out = [];
  for (const [id, titel, wort] of AKTIONEN) out.push(eintrag('aktion', id, titel, '', wort, { art: 'aktion', id }));
  for (const [view, titel, wort, params] of SEITEN) out.push(eintrag('seite', params ? `${view}/${params.tab || params.reiter}` : view, titel, '', wort, { art: 'seite', view, ...(params ? { params } : {}) }));

  const kontakte = new Map((db.contacts || []).map((c) => [c.id, c]));
  const kategorien = new Map((db.categories || []).map((c) => [c.id, c]));

  for (const t of db.todos || []) {
    const sub = t.done ? 'erledigt' : (t.dueDate ? `fällig ${fmtDate(t.dueDate)}` : 'ohne Datum');
    out.push(eintrag('aufgabe', t.id, t.title || '(ohne Titel)', sub, aufgabenText(t), { art: 'aufgabe', id: t.id }, { datum: t.dueDate || t.createdAt || '', erledigt: !!t.done }));
  }

  for (const a of db.appointments || []) {
    const kontakt = kontakte.get(a.contactId)?.name || '';
    out.push(eintrag('termin', a.id, a.title || 'Termin', `${fmtDate(a.date)}${a.startTime && !a.allDay ? ' ' + a.startTime : ''}${a.location ? ' · ' + a.location : ''}`,
      `${a.notes || ''} ${a.location || ''} ${kontakt} ${a.date || ''}`, { art: 'termin', id: a.id }, { datum: a.date || '' }));
  }

  for (const t of db.transactions || []) {
    const kontakt = kontakte.get(t.contactId)?.name || '';
    const kat = kategorien.get(t.categoryId)?.name || '';
    const datum = t.date || '';
    const sub = [fmtDate(datum), `${t.type === 'income' ? '+' : '-'}${betrag(t.gross)} €`, kontakt, kat].filter(Boolean).join(' · ');
    const extra = [t.invoiceNumber, t.reference, t.notes, kontakt, kat, betrag(t.gross), datum, fmtDate(datum), t.paidDate ? fmtDate(t.paidDate) : '',
      t.unlisted ? 'privat' : '', t.voided ? 'storniert' : ''].filter(Boolean).join(' ');
    out.push(eintrag('buchung', t.id, t.description || (t.type === 'income' ? 'Einnahme' : 'Ausgabe'), sub, extra, { art: 'buchung', id: t.id },
      { datum, privat: !!t.unlisted, storniert: !!t.voided }));
  }

  for (const r of db.invoices || []) {
    const name = r.kaeufer?.name || r.gelesen?.verkaeufer || '';
    const pos = (r.positionen || []).map((p) => `${p.name || ''} ${p.beschreibung || ''}`).join(' ');
    out.push(eintrag('rechnung', r.id, `${r.nummer || 'Entwurf'}${name ? ' · ' + name : ''}`,
      `${r.richtung === 'eingang' ? 'Eingang' : 'Ausgang'} · ${r.status === 'ausgestellt' ? 'ausgestellt' : r.richtung === 'eingang' ? 'abgelegt' : 'Entwurf'}${r.datum ? ' · ' + fmtDate(r.datum) : ''}`,
      `${r.betreff || ''} ${r.bestellnummer || ''} ${r.kaeufer?.kundennummer || ''} ${pos}`, { art: 'rechnung', id: r.id }, { datum: r.datum || '' }));
  }

  // Mahnungen führen zur Rechnung, zu der sie gehören.
  for (const m of db.reminders || []) {
    out.push(eintrag('rechnung', m.id, `${stufenName(m.stufe)} · ${m.nummer}`, `Mahnung · ${fmtDate(m.datum)} · ${money(m.gesamt)} €${m.verworfen ? ' · zurückgenommen' : ''}`,
      `${m.kunde || ''} mahnung mahnen zahlungserinnerung mahngebuehr verzugsaufschlag ${m.nummer || ''}`, { art: 'rechnung', id: m.invoiceId }, { datum: m.datum || '', storniert: !!m.verworfen }));
  }

  for (const c of db.contacts || []) {
    out.push(eintrag('kontakt', c.id, c.name || 'Kontakt', c.email || c.phone || '',
      `${c.email || ''} ${c.phone || ''} ${c.taxId || ''} ${c.address || ''} ${c.street || ''} ${c.zip || ''} ${c.city || ''} ${c.notes || ''}`, { art: 'kontakt', id: c.id }));
  }

  const stamm = [['categories', db.categories], ['accounts', db.accounts], ['assets', db.assets]];
  for (const [tab, liste] of stamm) {
    for (const x of liste || []) {
      out.push(eintrag('stamm', x.id, x.name || STAMM_ARTEN[tab], STAMM_ARTEN[tab], `${x.iban || ''} ${x.skr03 || ''} ${x.skr04 || ''}`, { art: 'stamm', tab, id: x.id }));
    }
  }
  return out;
}

/** Wie gut ein Eintrag zu den Suchwörtern passt; 0 heißt: passt nicht. */
function punkte(e, woerter) {
  let summe = 0;
  for (const w of woerter) {
    if (!e.text.includes(w)) return 0;
    if (e.titelNorm.startsWith(w)) summe += 6;
    else if (e.titelNorm.includes(` ${w}`)) summe += 5;
    else if (e.titelNorm.includes(w)) summe += 3;
    else summe += 1;
  }
  return summe;
}

/**
 * Passende Einträge, beste zuerst. Bei gleicher Güte kommt zuerst, was
 * offen ist, danach das Neuere.
 * @param {Array<object>} index
 * @param {string} anfrage
 * @param {{pro?:number}} [opt]  höchstens so viele Treffer je Gruppe
 */
export function suchen(index, anfrage, { pro = 8 } = {}) {
  const woerter = norm(anfrage).split(/\s+/).filter(Boolean);
  if (!woerter.length) return [];
  const treffer = [];
  for (const e of index) {
    const p = punkte(e, woerter);
    if (p) treffer.push({ e, p });
  }
  treffer.sort((a, b) => b.p - a.p
    || (a.e.erledigt ? 1 : 0) - (b.e.erledigt ? 1 : 0)
    || (a.e.storniert ? 1 : 0) - (b.e.storniert ? 1 : 0)
    || String(b.e.datum || '').localeCompare(String(a.e.datum || ''))
    || a.e.titel.localeCompare(b.e.titel, 'de'));
  const zaehler = {};
  const gruppen = new Map(ART_FOLGE.map((a) => [a, { punkte: 0, liste: [] }]));
  for (const { e, p } of treffer) {
    zaehler[e.art] = (zaehler[e.art] || 0) + 1;
    const g = gruppen.get(e.art);
    if (!g) continue;
    g.punkte = Math.max(g.punkte, p);
    if (zaehler[e.art] <= pro) g.liste.push(e);
  }
  // Die Gruppe mit dem besten Treffer steht oben; bei Gleichstand gilt die feste Reihenfolge.
  return [...gruppen.entries()]
    .map(([art, g], i) => ({ art, g, i }))
    .filter((x) => x.g.liste.length)
    .sort((x, y) => y.g.punkte - x.g.punkte || x.i - y.i)
    .flatMap(({ art, g }) => g.liste.map((e) => ({ ...e, weitere: Math.max(0, (zaehler[art] || 0) - pro) })));
}

/** Vorschläge ohne Eingabe: die Aktionen und Seiten. */
export function sucheStart(index) {
  return index.filter((e) => e.art === 'aktion' || e.art === 'seite').map((e) => ({ ...e, weitere: 0 }));
}
