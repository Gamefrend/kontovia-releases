/**
 * Kontovia – Assistent: die Werkzeuge.
 *
 * Alles, was der Assistent tun kann, steht hier als Werkzeug: suchen,
 * auflisten, auswerten, rechnen, zu einem Bereich springen und Neues
 * vorschlagen. Jede Stufe nutzt dieselben Werkzeuge; die Modelle wählen nur
 * aus, welches mit welchen Angaben läuft. Die Zahlen kommen immer aus
 * calc.js, nie aus einem Modell.
 *
 * Arten:
 *   lesen      liest nur und darf ohne Rückfrage laufen
 *   sprung     wechselt die Ansicht (führt die Oberfläche aus)
 *   vorschlag  legt nichts an: Es entsteht ein Vorschlag, den man im
 *              gewohnten Fenster prüft und selbst speichert
 *
 * Jedes Werkzeug liefert
 *   daten  knapp und mit fertig formatierten Beträgen, für das Modell
 *   karte  was die Oberfläche als Ergebnis zeigt (lib/assistentfenster.js)
 *   text   ein fertiger Antwortsatz für die Stufe ohne Modell
 *
 * Reine Logik: kein Zugriff auf store oder Oberfläche, der Bestand kommt als
 * Argument. So laufen die Werkzeuge auch in den Prüfungen. Was nicht im
 * Bestand steht, reicht die Oberfläche im Umfeld `k` mit: `hilfe` (die
 * Abschnitte der Kurzanleitung, views/help.js: hilfeAbschnitte) und `ansicht`
 * (der Eintrag, den man gerade vor sich hat, für „diese Rechnung“).
 */

import { norm, money, fmtDate, addDays, todayISO, splitFromGross, splitFromNet, daysBetween, int, MONTHS, monthEnd, gebiet } from './util.js';
import {
  periodReport, openItems, vatReturn, accountBalances, scopeDb, isKleinunternehmer, basisOf, isVoidPart,
  healthChecks, euerReport, monthlySeries, depreciationInRange, bookValue, smallBusinessChecks, jahresumsatz, AFA_METHODE, afaMethod,
} from './calc.js';
import { berechnen, zustand as rechnungsZustand, ZUSTAENDE, faelligkeit } from './rechnung.js';
import { expandAppointments } from './termine.js';
import { steuertermine } from './fristen.js';
import { sucheIndex } from './suchindex.js';
import { aufgabenText } from './aufgaben.js';
import { zeitraumArgument, bereichFinden, BEREICHE } from './assistentdeutung.js';
import { kategorieVorschlagen, geschichteAufbauen } from './kategorisierung.js';
import { mahnbarkeit, stufenName } from './mahnwesen.js';
import { faellige } from './wiederkehrend.js';

/* -------------------------------------------------------------------------- */
/* Hilfen                                                                      */
/* -------------------------------------------------------------------------- */

const euro = (cent) => `${money(cent)} €`;
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const zahlOder = (v, sonst = null) => {
  if (v === null || v === undefined || v === '') return sonst;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : sonst;
};
const anzahl = (n, eins, viele) => `${int(n)} ${n === 1 ? eins : viele}`;
const datumOder = (v, heute) => {
  const z = v ? zeitraumArgument(v, heute, '') : null;
  return z?.von || '';
};
/** Ein Datumsfeld eines Werkzeugs: ISO oder Alltagssprache, sonst leer. */
const tag = (v, heute) => {
  const s = text(v, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s ? datumOder(s, heute) : '';
};
/** Grober Wortstamm: „hochzeiten“ findet „Hochzeitsreportage“, „rechnungen“ die „Rechnung“. */
const stamm = (w) => (w.length > 6 ? w.replace(/(en|er|es|e|n|s)$/, '') : w);
const passt = (heuhaufen, nadel) => {
  if (!nadel) return true;
  const h = norm(heuhaufen);
  return norm(nadel).split(/\s+/).filter(Boolean).every((w) => h.includes(w) || h.includes(stamm(w)));
};

function kontaktSuchen(db, name) {
  const n = norm(name).trim();
  if (!n) return null;
  const alle = db.contacts || [];
  return alle.find((c) => norm(c.name) === n) || alle.find((c) => norm(c.name).includes(n)) || alle.find((c) => n.includes(norm(c.name)) && norm(c.name).length > 3) || null;
}
function kategorieSuchen(db, name, typ = '') {
  const n = norm(name).trim();
  if (!n) return null;
  const alle = (db.categories || []).filter((c) => !typ || c.kind === typ);
  return alle.find((c) => norm(c.name) === n) || alle.find((c) => norm(c.name).includes(n)) || alle.find((c) => n.includes(norm(c.name))) || null;
}
/*
 * Alltagswörter, wie man sie sagt („Tanken“), zu Kategorien, wie sie heißen
 * („Kfz-Kosten, laufend“). Die Liste der Kontoauszüge (kategorisierung.js)
 * kennt Händlernamen; hier geht es um die Wörter einer Frage.
 */
const ALLTAG = [
  [/tank|benzin|diesel|sprit|kraftstoff|werkstatt|reifen|kfz|\bauto\b/, /kfz|fahrzeug/],
  [/bahn|\bzug|flug|hotel|taxi|reise|uebernachtung/, /reise/],
  [/porto|briefmarke|paket|versand/, /porto|versand/],
  [/software|\babo\b|lizenz|cloud/, /software|lizenz|edv/],
  [/telefon|handy|internet|mobilfunk/, /telefon|internet/],
  [/werbung|anzeige|flyer|marketing/, /werbung|marketing/],
  [/buero|papier|toner|patrone/, /buero/],
  [/fortbildung|seminar|kurs|fachbuch|fachliteratur/, /fortbildung|fachliteratur/],
  [/steuerberat|anwalt/, /beratung/],
  [/bewirtung|geschaeftsessen|restaurant/, /bewirtung/],
];
function kategorieAusAlltag(db, beschreibung, typ) {
  const t = norm(beschreibung);
  const regel = t && ALLTAG.find(([wort]) => wort.test(t));
  if (!regel) return null;
  return (db.categories || []).find((c) => c.kind === typ && c.active !== false && regel[1].test(norm(c.name))) || null;
}

const kontaktName = (db, id) => (db.contacts || []).find((c) => c.id === id)?.name || '';
const kategorieName = (db, id) => (db.categories || []).find((c) => c.id === id)?.name || 'Ohne Kategorie';
const TYP = { einnahme: 'income', ausgabe: 'expense', income: 'income', expense: 'expense' };

/** Buchung knapp für Modell und Karte. */
function buchungKurz(db, t, heute) {
  const offen = !t.paidDate && !isVoidPart(t);
  const faellig = t.dueDate || t.date;
  const ueberfaellig = offen && faellig < heute;
  return {
    daten: {
      id: t.id, art: t.type === 'income' ? 'Einnahme' : 'Ausgabe', datum: t.date, betrag: euro(t.gross), text: text(t.description, 80),
      kontakt: kontaktName(db, t.contactId) || undefined, kategorie: kategorieName(db, t.categoryId),
      bezahlt: t.paidDate || (ueberfaellig ? `offen, seit ${fmtDate(faellig)} fällig` : 'offen'), beleg: (t.attachments || []).length ? 'ja' : 'nein',
      privat: t.unlisted ? 'ja' : undefined, storniert: t.voided ? 'ja' : undefined,
    },
    eintrag: {
      titel: t.description || (t.type === 'income' ? 'Einnahme' : 'Ausgabe'),
      sub: [fmtDate(t.date), kontaktName(db, t.contactId), kategorieName(db, t.categoryId), offen ? (ueberfaellig ? 'überfällig' : 'offen') : ''].filter(Boolean).join(' · '),
      betrag: `${t.type === 'income' ? '+' : '-'}${euro(t.gross)}`, ton: t.type === 'income' ? 'pos' : '',
      ziel: { art: 'buchung', id: t.id },
    },
  };
}

function rechnungKurz(db, r, heute) {
  const buchungen = (r.transactionIds || []).map((id) => (db.transactions || []).find((t) => t.id === id)).filter(Boolean);
  const z = r.richtung === 'eingang' ? (r.bezahltAm ? 'bezahlt' : 'abgelegt') : rechnungsZustand(r, { buchungen, heute });
  const b = berechnen(r);
  const name = r.kaeufer?.name || r.gelesen?.verkaeufer || '';
  return {
    zustand: z,
    daten: {
      id: r.id, nummer: r.nummer || 'Entwurf', richtung: r.richtung === 'eingang' ? 'Eingang' : 'Ausgang', datum: r.datum, kunde: name || undefined,
      betrag: euro(b.brutto), zustand: ZUSTAENDE[z]?.name || z, faellig: r.richtung !== 'eingang' && r.status === 'ausgestellt' ? faelligkeit(r) || undefined : undefined,
      betreff: text(r.betreff, 80) || undefined, positionen: (r.positionen || []).map((p) => text(p.name, 50)).filter(Boolean).slice(0, 3).join(', ') || undefined,
    },
    eintrag: {
      titel: `${r.nummer || 'Entwurf'}${name ? ` · ${name}` : ''}`,
      sub: [r.richtung === 'eingang' ? 'Eingang' : 'Ausgang', fmtDate(r.datum), ZUSTAENDE[z]?.name || (z === 'abgelegt' ? 'abgelegt' : z)].filter(Boolean).join(' · '),
      betrag: euro(b.brutto), ton: z === 'ueberfaellig' ? 'neg' : z === 'bezahlt' ? 'pos' : '',
      ziel: { art: 'rechnung', id: r.id },
    },
  };
}

const sprungZiel = (view, params = {}) => ({ art: 'seite', view, params });

/** Bis wann festgeschrieben ist ('' = gar nicht); wie store.js: lockedUntil, aber aus dem übergebenen Bestand. */
const gesperrtBis = (db) => (db.locks || []).reduce((a, l) => (l.until > a ? l.until : a), '');
const rechnungZu = (db, txId) => (db.invoices || []).find((r) => (r.transactionIds || []).includes(txId)) || null;
const buchungenZu = (db, r) => (r.transactionIds || []).map((id) => (db.transactions || []).find((t) => t.id === id)).filter(Boolean);
const QUELLEN = { buchung: 'transactions', rechnung: 'invoices', kontakt: 'contacts', termin: 'appointments', aufgabe: 'todos' };

/**
 * Ein Eintrag als kurzer Text, z. B. für die Zeile „Geöffnet: …“ an das Modell.
 * @param {{art:string, id:string}|null} a
 * @returns {string} '' wenn es den Eintrag nicht gibt
 */
export function eintragBeschreiben(db, a) {
  const x = a?.art && a.id ? (db[QUELLEN[a.art]] || []).find((y) => y.id === a.id) : null;
  if (!x) return '';
  if (a.art === 'buchung') return `${x.type === 'income' ? 'Einnahme' : 'Ausgabe'} „${text(x.description, 60) || 'ohne Text'}“ vom ${fmtDate(x.date)} über ${euro(x.gross)}${kontaktName(db, x.contactId) ? ` (${kontaktName(db, x.contactId)})` : ''}`;
  if (a.art === 'rechnung') return `Rechnung ${x.nummer || 'Entwurf'}${x.kaeufer?.name ? ` an ${x.kaeufer.name}` : ''} über ${euro(berechnen(x).brutto)}`;
  if (a.art === 'kontakt') return `${x.kind === 'supplier' ? 'Lieferant' : 'Kunde'} ${x.name}`;
  if (a.art === 'termin') return `Termin „${text(x.title, 60)}“ am ${fmtDate(x.date)}`;
  return `Aufgabe „${text(x.title, 60)}“`;
}

const monatText = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const prozent = (neu, alt) => (alt ? Math.round(((neu - alt) / Math.abs(alt)) * 100) : null);

/* Wörter, die in der Hilfe anders heißen als in der Frage. */
const HILFE_WORTE = [
  [/^(erstell|anleg|mach|schreib)/, 'schreiben ausstellen anlegen entwurf'],
  [/^(importier|einles|einspiel|hochlad)/, 'einlesen uebernehmen import'],
  [/^(exportier|abgeb|steuerberat)/, 'export'],
  [/^(loesch|entfern)/, 'loeschen entfernen'],
  [/^(aender|bearbeit|korrigier)/, 'bearbeiten korrigieren aendern'],
  [/^(sicher|backup)/, 'sicherung sichern'],
  [/^(handy|telefon|smartphone|iphone|android)/, 'telefon geraet'],
  [/^(passwort|kennwort)/, 'passwort entsperren'],
  [/^(bank|konto)auszug/, 'kontoauszug'],
];

/**
 * Sucht in den Abschnitten der Hilfe. Jeder Absatz zählt für sich; ein Treffer
 * in der Überschrift zählt mehr.
 * @param {Array<{titel:string, kennung:string, tab:string, absaetze:string[]}>} hilfe
 * @returns {Array<{abschnitt:object, punkte:number, absaetze:string[]}>} die besten zuerst
 */
export function hilfeFinden(hilfe, frage) {
  // Je Wort der Frage eine Gruppe aus ihm und seinen anderen Wörtern; jede Gruppe zählt höchstens einmal.
  const gruppen = [...new Set(norm(frage).replace(/[^a-z0-9-]+/g, ' ').split(' ').filter((w) => w.length > 2 && !HILFE_FUELL.has(w)))]
    .map((w) => [w, ...(HILFE_WORTE.find(([re]) => re.test(w))?.[1].split(' ') || [])]);
  if (!gruppen.length) return [];
  const treffer = (s) => {
    const h = norm(s);
    return gruppen.filter((g) => g.some((w) => h.includes(w) || h.includes(stamm(w)) || (w.length > 7 && h.includes(w.slice(0, 6))))).length;
  };
  return (hilfe || []).map((a) => {
    // Der erste Absatz gibt meist den Überblick: Bei gleich vielen Treffern geht er vor.
    const absaetze = (a.absaetze || []).map((t, i) => ({ t, p: treffer(t) && treffer(t) + (i === 0 ? 0.5 : 0) })).sort((x, y) => y.p - x.p);
    const punkte = treffer(a.titel) * 3 + (absaetze[0]?.p || 0) * 2 + (absaetze[1]?.p || 0);
    return { abschnitt: a, punkte, absaetze: absaetze.filter((x) => x.p > 0).slice(0, 2).map((x) => x.t) };
  }).filter((x) => x.punkte >= 2).sort((x, y) => y.punkte - x.punkte);
}
const HILFE_FUELL = new Set('wie was wo wer wann kann koennen ich mir mich mein meine meinen sie die der das den dem des ein eine einen einem und oder mit fuer von bei auf aus ist sind gibt geht bitte noch mal einer dieser diese hier dort funktioniert mache machen man soll sollte muss'.split(' '));

/** Der Anfang eines Textes bis zum Satzende, höchstens etwa `max` Zeichen. */
function satzAnfang(s, max = 320) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const ende = t.slice(0, max).lastIndexOf('. ');
  return ende > 80 ? t.slice(0, ende + 1) : `${t.slice(0, max).replace(/\s+\S*$/, '')} …`;
}

/** Offene Posten, die zu den Angaben passen, die besten zuerst (für zahlung_vorschlagen). */
function offeneSuchen(db, a, ansicht) {
  const offen = (db.transactions || []).filter((t) => !t.paidDate && !isVoidPart(t) && !t.ausgebucht);
  const imBlick = ansicht?.art === 'buchung' ? offen.find((t) => t.id === ansicht.id)
    : ansicht?.art === 'rechnung' ? offen.find((t) => (db.invoices || []).find((r) => r.id === ansicht.id)?.transactionIds?.includes(t.id)) : null;
  const hinweis = a.kontakt || a.rechnung || a.text || a.betrag;
  if (imBlick && !hinweis) return [{ t: imBlick, p: 10 }];
  const kon = a.kontakt ? kontaktSuchen(db, a.kontakt) : null;
  const cent = zahlOder(a.betrag, null) !== null ? Math.round(Math.abs(zahlOder(a.betrag, 0)) * 100) : null;
  const typ = TYP[a.art] || '';
  const nummer = norm(a.rechnung).replace(/\s+/g, '');
  const liste = [];
  for (const t of offen) {
    let p = 0;
    const r = rechnungZu(db, t.id);
    if (nummer && (norm(t.invoiceNumber).replace(/\s+/g, '') === nummer || norm(r?.nummer).replace(/\s+/g, '') === nummer)) p += 6;
    if (kon && t.contactId === kon.id) p += 4;
    else if (a.kontakt && passt(`${kontaktName(db, t.contactId)} ${r?.kaeufer?.name || ''} ${t.description}`, a.kontakt)) p += 3;
    if (cent !== null && Math.abs(t.gross - cent) <= 1) p += 3;
    if (a.text && passt(`${t.description} ${t.notes || ''} ${r?.betreff || ''}`, a.text)) p += 2;
    if (imBlick && t.id === imBlick.id) p += 2;
    if (!p) continue;
    if (typ && t.type !== typ) p -= 2;
    liste.push({ t, p });
  }
  // Bei gleich guten Treffern zuerst der älteste: Wer nur den Kunden nennt, meint meist die längst fällige Rechnung.
  return liste.filter((x) => x.p > 0).sort((x, y) => y.p - x.p || String(x.t.dueDate || x.t.date).localeCompare(String(y.t.dueDate || y.t.date)));
}

/* -------------------------------------------------------------------------- */
/* Rechnen ohne eval                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Rechnet einen Ausdruck mit + - * / ^ und Klammern, deutschen Zahlen
 * („1.234,56“) und Prozent („19 % von 250“, „250 + 19 %“). Kein eval.
 */
export function ausrechnen(ausdruck) {
  let s = norm(ausdruck).replace(/€|euro|eur\b/g, '').replace(/×|\bmal\b/g, '*').replace(/÷|\bgeteilt durch\b|\bdurch\b/g, '/')
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\bhoch\b/g, '^').replace(/(\d)\s*x\s*(\d)/g, '$1*$2').replace(/(\d)\s*:\s*(\d)/g, '$1/$2');
  // „19 % von 250“ → (19/100*250); „250 + 19 %“ → 250*(1+19/100)
  s = s.replace(/(\d[\d.,]*)\s*%\s*(von|aus|vom)\s*(\d[\d.,]*)/g, '($1/100*$3)');
  s = s.replace(/(\d[\d.,]*)\s*([+-])\s*(\d[\d.,]*)\s*%/g, '($1*(1$2$3/100))');
  s = s.replace(/(\d[\d.,]*)\s*%/g, '($1/100)');
  const zahlen = [];
  s = s.replace(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g, (z) => {
    const deutsch = /,/.test(z) || /^\d{1,3}(\.\d{3})+$/.test(z);
    zahlen.push(deutsch ? Number(z.replace(/\./g, '').replace(',', '.')) : Number(z));
    return ` #${zahlen.length - 1} `;
  });
  const tokens = s.match(/#\d+|[-+*/^()]/g) || [];
  if (s.replace(/#\d+|[-+*/^()\s]/g, '').trim()) throw new Error('Der Ausdruck enthält etwas, das sich nicht rechnen lässt.');
  let i = 0;
  const vorne = () => tokens[i];
  const nimm = () => tokens[i++];
  const ausdruckLesen = () => {
    let v = termLesen();
    while (vorne() === '+' || vorne() === '-') v = nimm() === '+' ? v + termLesen() : v - termLesen();
    return v;
  };
  const termLesen = () => {
    let v = potenzLesen();
    while (vorne() === '*' || vorne() === '/') {
      const op = nimm();
      const r = potenzLesen();
      if (op === '/' && r === 0) throw new Error('Durch null lässt sich nicht teilen.');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const potenzLesen = () => {
    const b = einerLesen();
    return vorne() === '^' ? (nimm(), b ** potenzLesen()) : b;
  };
  const einerLesen = () => {
    const t = nimm();
    if (t === '-') return -einerLesen();
    if (t === '+') return einerLesen();
    if (t === '(') { const v = ausdruckLesen(); if (nimm() !== ')') throw new Error('Eine Klammer ist nicht geschlossen.'); return v; }
    if (t && t[0] === '#') return zahlen[Number(t.slice(1))];
    throw new Error('Der Ausdruck ist unvollständig.');
  };
  if (!tokens.length) throw new Error('Kein Rechenausdruck gefunden.');
  const v = ausdruckLesen();
  if (i < tokens.length) throw new Error('Der Ausdruck ist nicht vollständig lesbar.');
  if (!Number.isFinite(v)) throw new Error('Das Ergebnis ist keine Zahl.');
  return v;
}

const zahlText = (v) => new Intl.NumberFormat(gebiet(), { maximumFractionDigits: 4 }).format(Math.round(v * 10000) / 10000);

/* -------------------------------------------------------------------------- */
/* Suche über alles                                                            */
/* -------------------------------------------------------------------------- */

const SUCHART = { buchung: ['buchung'], rechnung: ['rechnung', 'buchung'], kontakt: ['kontakt'], termin: ['termin'], aufgabe: ['aufgabe'] };

/**
 * Sucht mit mehreren Wörtern oder Schreibweisen („fotoshooting|shooting garten“):
 * je mehr Wörter passen, desto weiter oben. Ein Zeitraum hebt Treffer darin
 * nach vorn, schließt die übrigen aber nicht aus: Das Datum einer Rechnung
 * liegt oft nach dem Tag, um den es geht.
 */
function suchenIn(db, { text: suchtext, art = 'alle', zeitraum = '' }, heute) {
  const gruppen = String(suchtext || '').split(/[\s,;]+/).filter(Boolean)
    .map((g) => [...new Set(g.split('|').map((w) => norm(w).trim()).filter((w) => w.length > 1).flatMap((w) => [w, stamm(w)]))]).filter((g) => g.length);
  if (!gruppen.length) return [];
  const z = zeitraum ? zeitraumArgument(zeitraum, heute, '') : null;
  const arten = SUCHART[art] || null;
  const treffer = [];
  for (const e of sucheIndex(db)) {
    if (e.art === 'aktion' || e.art === 'seite' || e.art === 'stamm') continue;
    if (arten && !arten.includes(e.art)) continue;
    let p = 0;
    for (const g of gruppen) {
      const w = g.find((x) => e.text.includes(x));
      if (w) p += e.titelNorm.includes(w) ? 3 : 2;
    }
    if (!p) continue;
    if (z && e.datum) {
      if (e.datum >= z.von && e.datum <= z.bis) p += 3;
      else if (e.datum >= addDays(z.von, -14) && e.datum <= addDays(z.bis, 45)) p += 1;
    }
    if (art === 'rechnung' && e.art === 'rechnung') p += 1;
    treffer.push({ e, p });
  }
  treffer.sort((a, b) => b.p - a.p || (a.e.storniert ? 1 : 0) - (b.e.storniert ? 1 : 0) || String(b.e.datum || '').localeCompare(String(a.e.datum || '')));
  return treffer;
}

/* -------------------------------------------------------------------------- */
/* Die Werkzeuge                                                               */
/* -------------------------------------------------------------------------- */

/* Ohne eigene Beschreibung: Wie Zeiträume anzugeben sind, steht einmal in den Regeln (assistentwissen.js). */
const ZEITRAUM = { type: 'string' };

/**
 * @typedef {{name:string, art:'lesen'|'sprung'|'vorschlag', kern:boolean, intern?:boolean, beschreibung:string,
 *   parameter:object, pflicht?:string[], ausfuehren:(db:object, a:object, k:{heute:string, privat:boolean})=>{daten:any, karte:object, text:string}}} Werkzeug
 */

/** @type {Werkzeug[]} */
export const WERKZEUGE = [
  {
    name: 'suchen', art: 'lesen', kern: true,
    beschreibung: 'Sucht Buchungen, Rechnungen, Kontakte, Termine, Aufgaben. Schreibweisen mit | trennen.',
    parameter: {
      text: { type: 'string', description: 'z. B. "fotoshooting|shooting garten"' },
      art: { type: 'string', enum: ['alle', 'buchung', 'rechnung', 'kontakt', 'termin', 'aufgabe'] },
      zeitraum: ZEITRAUM,
    },
    pflicht: ['text'],
    ausfuehren(db, a, { heute }) {
      const liste = suchenIn(db, { text: a.text, art: a.art, zeitraum: a.zeitraum }, heute).slice(0, 8);
      const daten = { treffer: liste.length, eintraege: liste.map(({ e }) => ({ id: e.id, art: e.art, titel: e.titel, info: e.sub, datum: e.datum || undefined })) };
      return {
        daten,
        karte: { art: 'liste', titel: 'Gefunden', eintraege: liste.map(({ e }) => ({ titel: e.titel, sub: e.sub, ziel: e.ziel, art: e.art })), leer: 'Dazu habe ich nichts gefunden.' },
        text: liste.length ? `Ich habe ${anzahl(liste.length, 'Treffer', 'Treffer')} zu „${text(a.text, 60).replace(/\|/g, ' oder ')}“ gefunden.` : `Zu „${text(a.text, 60).replace(/\|/g, ' oder ')}“ habe ich nichts gefunden. Versuchen Sie es mit einem anderen Wort.`,
      };
    },
  },
  {
    name: 'buchungen_auflisten', art: 'lesen', kern: true,
    beschreibung: 'Buchungen mit Filtern, mit Summen.',
    parameter: {
      typ: { type: 'string', enum: ['alle', 'einnahme', 'ausgabe'] },
      zeitraum: ZEITRAUM,
      status: { type: 'string', enum: ['alle', 'offen', 'bezahlt', 'ueberfaellig'] },
      kategorie: { type: 'string' },
      kontakt: { type: 'string' },
      text: { type: 'string' },
      ohne_beleg: { type: 'boolean' },
      sortierung: { type: 'string', enum: ['neueste', 'groesste'] },
    },
    ausfuehren(db, a, { heute, privat }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const typ = TYP[a.typ] || '';
      const kat = a.kategorie ? kategorieSuchen(db, a.kategorie, typ) || kategorieAusAlltag(db, a.kategorie, typ || 'expense') : null;
      // „Auto“ steht in keiner Beschreibung, aber die Kategorie heißt „Kfz-Kosten“: auch die zählt.
      const katText = a.text ? kategorieAusAlltag(db, a.text, typ || 'expense') : null;
      const kon = a.kontakt ? kontaktSuchen(db, a.kontakt) : null;
      let liste = (scopeDb(db, privat).transactions || []).filter((t) => !isVoidPart(t))
        .filter((t) => t.date >= z.von && t.date <= z.bis)
        .filter((t) => !typ || t.type === typ)
        .filter((t) => !kat || t.categoryId === kat.id)
        .filter((t) => !kon || t.contactId === kon.id)
        .filter((t) => !a.text || passt(`${t.description} ${t.notes} ${t.reference} ${t.invoiceNumber}`, a.text) || (katText && t.categoryId === katText.id))
        .filter((t) => !a.ohne_beleg || !(t.attachments || []).length)
        .filter((t) => {
          if (!a.status || a.status === 'alle') return true;
          if (a.status === 'bezahlt') return !!t.paidDate;
          if (a.status === 'offen') return !t.paidDate;
          return !t.paidDate && (t.dueDate || t.date) < heute;
        });
      liste = a.sortierung === 'groesste' ? liste.sort((x, y) => y.gross - x.gross) : liste.sort((x, y) => y.date.localeCompare(x.date));
      const ein = liste.filter((t) => t.type === 'income').reduce((s, t) => s + t.gross, 0);
      const aus = liste.filter((t) => t.type === 'expense').reduce((s, t) => s + t.gross, 0);
      const kurz = liste.slice(0, 8).map((t) => buchungKurz(db, t, heute));
      const titel = a.ohne_beleg ? 'Buchungen ohne Beleg' : typ === 'income' ? 'Einnahmen' : typ === 'expense' ? 'Ausgaben' : 'Buchungen';
      return {
        daten: { zeitraum: z.text, anzahl: liste.length, summe_einnahmen: euro(ein), summe_ausgaben: euro(aus), filter: [kat?.name, kon?.name].filter(Boolean).join(', ') || undefined, eintraege: kurz.map((k) => k.daten) },
        karte: {
          art: 'liste', titel, zeitraum: z.text,
          zahlen: [{ name: 'Anzahl', wert: int(liste.length) }, ...(ein ? [{ name: 'Einnahmen', wert: euro(ein), ton: 'pos' }] : []), ...(aus ? [{ name: 'Ausgaben', wert: euro(aus) }] : [])],
          eintraege: kurz.map((k) => k.eintrag),
          mehr: liste.length ? { text: liste.length > 8 ? `Alle ${int(liste.length)} in Buchungen zeigen` : 'In Buchungen zeigen', ziel: sprungZiel('transactions', { ids: liste.map((t) => t.id), titel: `${titel}, ${z.text}` }) } : null,
          leer: 'Keine passenden Buchungen.',
        },
        text: liste.length ? `${anzahl(liste.length, 'Buchung', 'Buchungen')} im Zeitraum ${z.text}${ein ? `, Einnahmen ${euro(ein)}` : ''}${aus ? `, Ausgaben ${euro(aus)}` : ''}.` : `Im Zeitraum ${z.text} gibt es keine passenden Buchungen.`,
      };
    },
  },
  {
    name: 'rechnungen_auflisten', art: 'lesen', kern: true,
    beschreibung: 'Rechnungen: geschriebene (ausgang) oder erhaltene (eingang).',
    parameter: {
      richtung: { type: 'string', enum: ['ausgang', 'eingang'] },
      zustand: { type: 'string', enum: ['alle', 'entwurf', 'offen', 'ueberfaellig', 'bezahlt', 'storniert'] },
      kunde: { type: 'string' },
      zeitraum: ZEITRAUM,
      text: { type: 'string' },
    },
    ausfuehren(db, a, { heute }) {
      const z = a.zeitraum ? zeitraumArgument(a.zeitraum, heute, '') : null;
      const kon = a.kunde ? kontaktSuchen(db, a.kunde) : null;
      const richtung = a.richtung === 'eingang' ? 'eingang' : 'ausgang';
      let liste = (db.invoices || []).filter((r) => (r.richtung || 'ausgang') === richtung)
        .map((r) => rechnungKurz(db, r, heute))
        .filter((x) => !a.zustand || a.zustand === 'alle' || x.zustand === a.zustand || (a.zustand === 'offen' && x.zustand === 'ueberfaellig'))
        .filter((x) => !z || (x.daten.datum >= z.von && x.daten.datum <= z.bis));
      if (a.kunde) liste = liste.filter((x) => (kon && norm(x.daten.kunde) === norm(kon.name)) || passt(x.daten.kunde, a.kunde));
      if (a.text) liste = liste.filter((x) => passt(`${x.daten.betreff || ''} ${x.daten.positionen || ''} ${x.daten.nummer}`, a.text));
      liste.sort((x, y) => String(y.daten.datum).localeCompare(String(x.daten.datum)));
      const summe = liste.reduce((s, x) => s + berechnen((db.invoices || []).find((r) => r.id === x.daten.id)).zahlbetrag, 0);
      const titel = a.zustand === 'offen' ? 'Offene Rechnungen' : a.zustand === 'ueberfaellig' ? 'Überfällige Rechnungen' : a.zustand === 'entwurf' ? 'Rechnungsentwürfe' : richtung === 'eingang' ? 'Eingangsrechnungen' : 'Rechnungen';
      return {
        daten: { anzahl: liste.length, summe: euro(summe), zeitraum: z?.text, rechnungen: liste.slice(0, 8).map((x) => x.daten) },
        karte: {
          art: 'liste', titel, zeitraum: z?.text,
          zahlen: [{ name: 'Anzahl', wert: int(liste.length) }, { name: 'Summe', wert: euro(summe) }],
          eintraege: liste.slice(0, 8).map((x) => x.eintrag),
          mehr: { text: 'Rechnungen öffnen', ziel: sprungZiel('rechnungen', { tab: richtung }) },
          leer: 'Keine passenden Rechnungen.',
        },
        text: liste.length ? `${anzahl(liste.length, 'Rechnung', 'Rechnungen')}${kon ? ` für ${kon.name}` : ''}, zusammen ${euro(summe)}.` : `Keine passenden Rechnungen${kon ? ` für ${kon.name}` : ''}.`,
      };
    },
  },
  {
    name: 'kennzahlen', art: 'lesen', kern: true,
    beschreibung: 'Umsatz, Einnahmen, Ausgaben, Gewinn eines Zeitraums.',
    parameter: { zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute, privat }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const r = periodReport(scopeDb(db, privat), z.von, z.bis);
      const klein = isKleinunternehmer(db);
      const zusatz = klein ? '' : ' (netto)';
      return {
        daten: {
          zeitraum: z.text, einnahmen: euro(r.incomeForProfit), ausgaben: euro(r.expenseForProfit), gewinn: euro(r.profit),
          buchungen: r.countIncome + r.countExpense, noch_offen_einnahmen: euro(r.unpaid.income), noch_offen_ausgaben: euro(r.unpaid.expense),
          hinweis: klein ? 'Kleinunternehmer: Beträge ohne Umsatzsteuer' : 'Beträge netto, gezählt am Zahlungstag',
        },
        karte: {
          art: 'zahlen', titel: 'Einnahmen und Ausgaben', zeitraum: z.text,
          zahlen: [
            { name: `Einnahmen${zusatz}`, wert: euro(r.incomeForProfit), ton: 'pos' },
            { name: `Ausgaben${zusatz}`, wert: euro(r.expenseForProfit), ton: 'neg' },
            { name: r.profit >= 0 ? 'Gewinn' : 'Verlust', wert: euro(Math.abs(r.profit)), ton: r.profit >= 0 ? 'pos' : 'neg', gross: true },
            ...(r.unpaid.incomeCount ? [{ name: 'Noch nicht bezahlt', wert: euro(r.unpaid.income) }] : []),
          ],
          mehr: { text: 'Auswertung öffnen', ziel: sprungZiel('reports', { tab: 'guv', period: { preset: 'benutzerdefiniert', from: z.von, to: z.bis } }) },
        },
        text: `${z.text}: Einnahmen ${euro(r.incomeForProfit)}, Ausgaben ${euro(r.expenseForProfit)}, ${r.profit >= 0 ? 'Gewinn' : 'Verlust'} ${euro(Math.abs(r.profit))}${klein ? '' : ', jeweils netto'}.`,
      };
    },
  },
  {
    name: 'nach_kategorie', art: 'lesen', kern: false,
    beschreibung: 'Summen je Kategorie, größte zuerst.',
    parameter: { typ: { type: 'string', enum: ['ausgabe', 'einnahme'] }, zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute, privat }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const typ = TYP[a.typ] || 'expense';
      const r = periodReport(scopeDb(db, privat), z.von, z.bis);
      const zeilen = r.byCategory.filter((c) => c.kind === typ).slice(0, 8);
      const gesamt = r.byCategory.filter((c) => c.kind === typ).reduce((s, c) => s + c.amount, 0);
      const anteil = (c) => (gesamt ? `${Math.round((c.amount / gesamt) * 100)} %` : '');
      return {
        daten: { zeitraum: z.text, art: typ === 'income' ? 'Einnahmen' : 'Ausgaben', gesamt: euro(gesamt), kategorien: zeilen.map((c) => ({ name: c.name, summe: euro(c.amount), anteil: anteil(c), buchungen: c.count })) },
        karte: {
          art: 'liste', titel: typ === 'income' ? 'Einnahmen nach Kategorie' : 'Ausgaben nach Kategorie', zeitraum: z.text,
          eintraege: zeilen.map((c) => ({ titel: c.name, sub: `${anzahl(c.count, 'Buchung', 'Buchungen')} · ${anteil(c)}`, betrag: euro(c.amount), balken: gesamt ? c.amount / gesamt : 0,
            ziel: sprungZiel('transactions', { categoryId: c.categoryId || '', type: typ, period: { preset: 'benutzerdefiniert', from: z.von, to: z.bis } }) })),
          leer: 'Im Zeitraum gibt es keine Buchungen dieser Art.',
        },
        text: zeilen.length ? `Größter Posten ${z.text}: ${zeilen[0].name} mit ${euro(zeilen[0].amount)} (${anteil(zeilen[0])}).` : 'Im Zeitraum gibt es keine Buchungen dieser Art.',
      };
    },
  },
  {
    name: 'nach_kontakt', art: 'lesen', kern: false,
    beschreibung: 'Rangliste der Kunden (einnahme) oder Lieferanten (ausgabe) nach Betrag.',
    parameter: { typ: { type: 'string', enum: ['einnahme', 'ausgabe'] }, zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute, privat }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const typ = TYP[a.typ] || 'income';
      const r = periodReport(scopeDb(db, privat), z.von, z.bis);
      const feld = typ === 'income' ? 'income' : 'expense';
      const zeilen = r.byContact.filter((c) => c[feld] > 0).sort((x, y) => y[feld] - x[feld]).slice(0, 8);
      const gesamt = typ === 'income' ? r.incomeForProfit : r.expenseForProfit;
      const name = (c) => kontaktName(db, c.contactId) || 'Unbekannt';
      return {
        daten: { zeitraum: z.text, art: typ === 'income' ? 'Kunden' : 'Lieferanten', rangliste: zeilen.map((c) => ({ name: name(c), summe: euro(c[feld]), buchungen: c.count })) },
        karte: {
          art: 'liste', titel: typ === 'income' ? 'Kunden nach Umsatz' : 'Lieferanten nach Ausgaben', zeitraum: z.text,
          eintraege: zeilen.map((c) => ({ titel: name(c), sub: anzahl(c.count, 'Buchung', 'Buchungen'), betrag: euro(c[feld]), balken: gesamt ? c[feld] / gesamt : 0, ziel: { art: 'kontakt', id: c.contactId } })),
          leer: 'Keine Buchungen mit Kontakt in diesem Zeitraum.',
        },
        text: zeilen.length ? `${typ === 'income' ? 'Stärkster Kunde' : 'Größter Lieferant'} ${z.text}: ${name(zeilen[0])} mit ${euro(zeilen[0][feld])}.` : 'Im Zeitraum gibt es keine Buchungen mit Kontakt.',
      };
    },
  },
  {
    name: 'zeitraeume_vergleichen', art: 'lesen', kern: false,
    beschreibung: 'Vergleicht zwei Zeiträume.',
    parameter: { zeitraum: ZEITRAUM, zeitraum2: ZEITRAUM },
    pflicht: ['zeitraum', 'zeitraum2'],
    ausfuehren(db, a, { heute, privat }) {
      const z1 = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const z2 = zeitraumArgument(a.zeitraum2, heute, 'letztes Jahr');
      const s = scopeDb(db, privat);
      const r1 = periodReport(s, z1.von, z1.bis);
      const r2 = periodReport(s, z2.von, z2.bis);
      const diff = (x, y) => `${x - y >= 0 ? '+' : '-'}${euro(Math.abs(x - y))}${y ? ` (${x - y >= 0 ? '+' : '-'}${Math.round(Math.abs((x - y) / y) * 100)} %)` : ''}`;
      const zeile = (n, x, y) => ({ titel: n, sub: `${z1.text}: ${euro(x)} · ${z2.text}: ${euro(y)}`, betrag: diff(x, y), ton: x >= y ? 'pos' : 'neg' });
      return {
        daten: {
          [z1.text]: { einnahmen: euro(r1.incomeForProfit), ausgaben: euro(r1.expenseForProfit), gewinn: euro(r1.profit) },
          [z2.text]: { einnahmen: euro(r2.incomeForProfit), ausgaben: euro(r2.expenseForProfit), gewinn: euro(r2.profit) },
          unterschied_gewinn: diff(r1.profit, r2.profit),
        },
        karte: { art: 'liste', titel: 'Vergleich', zeitraum: `${z1.text} gegenüber ${z2.text}`, eintraege: [zeile('Einnahmen', r1.incomeForProfit, r2.incomeForProfit), zeile('Ausgaben', r1.expenseForProfit, r2.expenseForProfit), zeile('Gewinn', r1.profit, r2.profit)] },
        text: `Gewinn ${z1.text}: ${euro(r1.profit)}, ${z2.text}: ${euro(r2.profit)}, Unterschied ${diff(r1.profit, r2.profit)}.`,
      };
    },
  },
  {
    name: 'umsatzsteuer', art: 'lesen', kern: true,
    beschreibung: 'Nur die Steuer: Umsatzsteuer, Vorsteuer, Zahllast. Für Umsatz: kennzahlen.',
    parameter: { zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Quartal');
      const v = vatReturn(scopeDb(db, false), z.von, z.bis);
      if (v.kleinunternehmer) {
        return {
          daten: { zeitraum: z.text, kleinunternehmer: true, hinweis: 'Als Kleinunternehmer fällt keine Umsatzsteuer an und es gibt keine Voranmeldung.' },
          karte: { art: 'text', titel: 'Umsatzsteuer', text: 'Sie sind als Kleinunternehmer eingestellt: Es fällt keine Umsatzsteuer an.' },
          text: 'Sie sind als Kleinunternehmer eingestellt. Es fällt keine Umsatzsteuer an, eine Voranmeldung gibt es nicht.',
        };
      }
      const zahl = v.kz83;
      return {
        daten: { zeitraum: z.text, umsatzsteuer: euro(v.umsatzsteuer), vorsteuer: euro(v.vorsteuer), zahllast: euro(zahl), bedeutung: zahl >= 0 ? 'an das Finanzamt zu zahlen' : 'Erstattung vom Finanzamt', versteuerung: basisOf(db) === 'soll' ? 'Soll (Rechnungsdatum)' : 'Ist (Zahlungstag)' },
        karte: {
          art: 'zahlen', titel: 'Umsatzsteuer', zeitraum: z.text,
          zahlen: [
            { name: 'Umsatzsteuer', wert: euro(v.umsatzsteuer) },
            { name: 'Vorsteuer', wert: euro(v.vorsteuer) },
            { name: zahl >= 0 ? 'Zahllast' : 'Erstattung', wert: euro(Math.abs(zahl)), ton: zahl >= 0 ? 'neg' : 'pos', gross: true },
          ],
          mehr: { text: 'Umsatzsteuer öffnen', ziel: sprungZiel('reports', { tab: 'ust', period: { preset: 'benutzerdefiniert', from: z.von, to: z.bis } }) },
        },
        text: zahl >= 0 ? `${z.text}: ${euro(zahl)} Umsatzsteuer an das Finanzamt (${euro(v.umsatzsteuer)} Umsatzsteuer minus ${euro(v.vorsteuer)} Vorsteuer).`
          : `${z.text}: ${euro(-zahl)} Erstattung vom Finanzamt, weil die Vorsteuer (${euro(v.vorsteuer)}) höher ist als die Umsatzsteuer (${euro(v.umsatzsteuer)}).`,
      };
    },
  },
  {
    name: 'offene_posten', art: 'lesen', kern: true,
    beschreibung: 'Noch nicht bezahlt: was Kunden schulden (forderungen), was der Nutzer schuldet (verbindlichkeiten).',
    parameter: { art: { type: 'string', enum: ['beide', 'forderungen', 'verbindlichkeiten'] }, nur_ueberfaellige: { type: 'boolean' } },
    ausfuehren(db, a, { heute, privat }) {
      const o = openItems(scopeDb(db, privat), heute);
      const art = a.art === 'forderungen' || a.art === 'verbindlichkeiten' ? a.art : 'beide';
      let liste = [...(art !== 'verbindlichkeiten' ? o.receivables : []), ...(art !== 'forderungen' ? o.payables : [])];
      if (a.nur_ueberfaellige) liste = liste.filter((t) => t.overdue);
      liste.sort((x, y) => y.overdueDays - x.overdueDays || y.gross - x.gross);
      const ueber = liste.filter((t) => t.overdue);
      return {
        daten: {
          forderungen: art !== 'verbindlichkeiten' ? { anzahl: o.receivables.length, summe: euro(o.receivableTotal) } : undefined,
          verbindlichkeiten: art !== 'forderungen' ? { anzahl: o.payables.length, summe: euro(o.payableTotal) } : undefined,
          ueberfaellig: { anzahl: ueber.length, summe: euro(ueber.reduce((s, t) => s + t.gross, 0)) },
          posten: liste.slice(0, 8).map((t) => ({ ...buchungKurz(db, t, heute).daten, tage_ueberfaellig: t.overdueDays || undefined })),
        },
        karte: {
          art: 'liste', titel: a.nur_ueberfaellige ? 'Überfällig' : 'Noch offen',
          zahlen: [
            ...(art !== 'verbindlichkeiten' ? [{ name: 'Forderungen', wert: euro(o.receivableTotal), ton: 'pos' }] : []),
            ...(art !== 'forderungen' ? [{ name: 'Verbindlichkeiten', wert: euro(o.payableTotal), ton: 'neg' }] : []),
            ...(ueber.length ? [{ name: 'Davon überfällig', wert: `${int(ueber.length)} · ${euro(ueber.reduce((s, t) => s + t.gross, 0))}`, ton: 'neg' }] : []),
          ],
          eintraege: liste.slice(0, 8).map((t) => {
            const k = buchungKurz(db, t, heute).eintrag;
            return { ...k, sub: `${k.sub}${t.overdue ? ` · ${t.overdueDays} Tage über der Frist` : ''}`, ton: t.overdue ? 'neg' : k.ton };
          }),
          mehr: { text: 'Offene Posten öffnen', ziel: sprungZiel('reports', { tab: 'opos' }) },
          leer: 'Alles bezahlt.',
        },
        text: liste.length
          ? `${art !== 'verbindlichkeiten' ? `Kunden schulden Ihnen ${euro(o.receivableTotal)} (${anzahl(o.receivables.length, 'Posten', 'Posten')})` : ''}${art === 'beide' ? ', ' : ''}${art !== 'forderungen' ? `Sie schulden ${euro(o.payableTotal)} (${anzahl(o.payables.length, 'Posten', 'Posten')})` : ''}.${ueber.length ? ` ${anzahl(ueber.length, 'Posten ist', 'Posten sind')} überfällig.` : ''}`
          : 'Es ist nichts offen. Alles bezahlt.',
      };
    },
  },
  {
    name: 'kontostaende', art: 'lesen', kern: false,
    beschreibung: 'Stand der Bank- und Kassenkonten.',
    parameter: {},
    ausfuehren(db, a, { heute }) {
      const k = accountBalances(db, heute);
      return {
        daten: { stichtag: heute, konten: k.map((x) => ({ name: x.name, stand: euro(x.balance) })) },
        karte: { art: 'liste', titel: 'Kontostände', zeitraum: `am ${fmtDate(heute)}`, eintraege: k.map((x) => ({ titel: x.name, sub: x.iban || '', betrag: euro(x.balance), ton: x.balance < 0 ? 'neg' : '', ziel: sprungZiel('reports', { tab: 'konten' }) })), leer: 'Es sind keine Zahlungskonten angelegt.' },
        text: k.length ? k.map((x) => `${x.name}: ${euro(x.balance)}`).join(', ') + '.' : 'Es sind keine Zahlungskonten angelegt.',
      };
    },
  },
  {
    name: 'termine_auflisten', art: 'lesen', kern: true,
    beschreibung: 'Termine im Kalender.',
    parameter: { zeitraum: ZEITRAUM, text: { type: 'string' } },
    ausfuehren(db, a, { heute }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'die nächsten 14 Tage');
      const liste = expandAppointments(db.appointments || [], z.von, z.bis)
        .filter((x) => !a.text || passt(`${x.title} ${x.notes} ${x.location} ${kontaktName(db, x.contactId)}`, a.text))
        .sort((x, y) => `${x.occurrence} ${x.startTime || ''}`.localeCompare(`${y.occurrence} ${y.startTime || ''}`));
      const zeit = (x) => (x.allDay ? 'ganztägig' : `${x.startTime || ''}${x.endTime ? `–${x.endTime}` : ''}`);
      return {
        daten: { zeitraum: z.text, anzahl: liste.length, termine: liste.slice(0, 10).map((x) => ({ id: x.id, titel: x.title, datum: x.occurrence, zeit: zeit(x), ort: x.location || undefined, kontakt: kontaktName(db, x.contactId) || undefined })) },
        karte: { art: 'liste', titel: 'Termine', zeitraum: z.text, eintraege: liste.slice(0, 10).map((x) => ({ titel: x.title || 'Termin', sub: [fmtDate(x.occurrence), zeit(x), x.location].filter(Boolean).join(' · '), ziel: { art: 'termin', id: x.id } })), mehr: { text: 'Kalender öffnen', ziel: sprungZiel('calendar') }, leer: 'Keine Termine in diesem Zeitraum.' },
        text: liste.length ? `${anzahl(liste.length, 'Termin', 'Termine')} im Zeitraum ${z.text}.` : `Im Zeitraum ${z.text} stehen keine Termine im Kalender.`,
      };
    },
  },
  {
    name: 'aufgaben_auflisten', art: 'lesen', kern: true,
    beschreibung: 'Aufgaben.',
    parameter: { status: { type: 'string', enum: ['offen', 'ueberfaellig', 'erledigt', 'alle'] }, text: { type: 'string' } },
    ausfuehren(db, a, { heute }) {
      const status = a.status || 'offen';
      const liste = (db.todos || [])
        .filter((t) => status === 'alle' || (status === 'erledigt' ? t.done : !t.done))
        .filter((t) => status !== 'ueberfaellig' || (t.dueDate && t.dueDate < heute))
        .filter((t) => !a.text || passt(`${t.title} ${aufgabenText(t)}`, a.text))
        .sort((x, y) => (x.dueDate || '9999').localeCompare(y.dueDate || '9999'));
      return {
        daten: { anzahl: liste.length, aufgaben: liste.slice(0, 10).map((t) => ({ id: t.id, titel: t.title, faellig: t.dueDate || undefined, erledigt: t.done || undefined })) },
        karte: { art: 'liste', titel: status === 'erledigt' ? 'Erledigte Aufgaben' : status === 'ueberfaellig' ? 'Überfällige Aufgaben' : 'Aufgaben', eintraege: liste.slice(0, 10).map((t) => ({ titel: t.title || '(ohne Titel)', sub: t.done ? 'erledigt' : t.dueDate ? `fällig ${fmtDate(t.dueDate)}${t.dueDate < heute ? ', überfällig' : ''}` : 'ohne Datum', ton: !t.done && t.dueDate && t.dueDate < heute ? 'neg' : '', ziel: { art: 'aufgabe', id: t.id } })), mehr: { text: 'Aufgaben öffnen', ziel: sprungZiel('todos') }, leer: 'Keine Aufgaben.' },
        text: liste.length ? `${anzahl(liste.length, status === 'erledigt' ? 'erledigte Aufgabe' : 'offene Aufgabe', status === 'erledigt' ? 'erledigte Aufgaben' : 'offene Aufgaben')}${liste[0]?.dueDate ? `, als Nächstes fällig: „${liste[0].title}“ am ${fmtDate(liste[0].dueDate)}` : ''}.` : 'Keine Aufgaben in dieser Liste.',
      };
    },
  },
  {
    name: 'kontakt_finden', art: 'lesen', kern: false,
    beschreibung: 'Kunde oder Lieferant mit Angaben, Umsatz, Offenem.',
    parameter: { name: { type: 'string' } },
    pflicht: ['name'],
    ausfuehren(db, a, { heute }) {
      const c = kontaktSuchen(db, a.name);
      if (!c) return { daten: { gefunden: false }, karte: { art: 'text', titel: 'Kontakt', text: `Kein Kontakt „${text(a.name, 60)}“ gefunden.` }, text: `Ich finde keinen Kontakt „${text(a.name, 60)}“.` };
      const seit = addDays(heute, -365);
      const tx = (db.transactions || []).filter((t) => t.contactId === c.id && !isVoidPart(t));
      const umsatz = tx.filter((t) => t.type === 'income' && t.paidDate && t.paidDate >= seit).reduce((s, t) => s + t.gross, 0);
      const ausgaben = tx.filter((t) => t.type === 'expense' && t.paidDate && t.paidDate >= seit).reduce((s, t) => s + t.gross, 0);
      const offen = tx.filter((t) => !t.paidDate);
      const anschrift = [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || c.address || '';
      return {
        daten: { id: c.id, name: c.name, art: c.kind === 'supplier' ? 'Lieferant' : 'Kunde', email: c.email || undefined, telefon: c.phone || undefined, anschrift: anschrift || undefined, einnahmen_12_monate: euro(umsatz), ausgaben_12_monate: ausgaben ? euro(ausgaben) : undefined, offen: offen.length ? euro(offen.reduce((s, t) => s + t.gross, 0)) : 'nichts' },
        karte: {
          art: 'liste', titel: c.name,
          zahlen: [{ name: 'Einnahmen 12 Monate', wert: euro(umsatz), ton: 'pos' }, ...(offen.length ? [{ name: 'Offen', wert: euro(offen.reduce((s, t) => s + t.gross, 0)), ton: 'neg' }] : [])],
          eintraege: [
            ...(c.email ? [{ titel: c.email, sub: 'E-Mail' }] : []), ...(c.phone ? [{ titel: c.phone, sub: 'Telefon' }] : []), ...(anschrift ? [{ titel: anschrift, sub: 'Anschrift' }] : []),
          ],
          mehr: { text: 'Kontakt öffnen', ziel: { art: 'kontakt', id: c.id } },
        },
        text: `${c.name}${c.phone ? `, Telefon ${c.phone}` : ''}${c.email ? `, ${c.email}` : ''}. Einnahmen in den letzten 12 Monaten: ${euro(umsatz)}${offen.length ? `, offen: ${euro(offen.reduce((s, t) => s + t.gross, 0))}` : ''}.`,
      };
    },
  },
  {
    name: 'steuertermine', art: 'lesen', kern: false,
    beschreibung: 'Fristen beim Finanzamt.',
    parameter: { zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'die nächsten 90 Tage');
      const liste = steuertermine(db.settings || {}, z.von, z.bis);
      return {
        daten: { zeitraum: z.text, termine: liste.slice(0, 8).map((f) => ({ datum: f.datum, was: f.titel, in_tagen: daysBetween(heute, f.datum) })) },
        karte: { art: 'liste', titel: 'Steuertermine', zeitraum: z.text, eintraege: liste.slice(0, 8).map((f) => ({ titel: f.titel, sub: f.hinweis || '', betrag: fmtDate(f.datum), ton: daysBetween(heute, f.datum) <= 7 ? 'neg' : '' })), leer: 'Keine Fristen in diesem Zeitraum.' },
        text: liste.length ? `Nächste Frist: ${liste[0].titel} am ${fmtDate(liste[0].datum)}.` : `Im Zeitraum ${z.text} stehen keine Fristen an.`,
      };
    },
  },
  {
    name: 'eintrag_lesen', art: 'lesen', kern: false,
    beschreibung: 'Alle Angaben zu einem Eintrag (id aus einem Ergebnis oder dem geöffneten Eintrag).',
    parameter: { art: { type: 'string', enum: ['buchung', 'rechnung', 'kontakt', 'termin', 'aufgabe'] }, id: { type: 'string' } },
    ausfuehren(db, a, { heute, ansicht }) {
      const ziel = a.id ? { art: a.art || Object.keys(QUELLEN).find((k) => (db[QUELLEN[k]] || []).some((y) => y.id === a.id)), id: a.id } : ansicht;
      const x = ziel?.art ? (db[QUELLEN[ziel.art]] || []).find((y) => y.id === ziel.id) : null;
      if (!x) return { daten: { fehler: 'Diesen Eintrag finde ich nicht.' }, karte: { art: 'text', titel: 'Eintrag', text: 'Welchen Eintrag meinen Sie? Öffnen Sie ihn oder nennen Sie ihn genauer.' }, text: 'Welchen Eintrag meinen Sie? Öffnen Sie ihn oder nennen Sie ihn genauer.' };
      let daten;
      let felder;
      if (ziel.art === 'buchung') {
        const k = buchungKurz(db, x, heute).daten;
        const r = rechnungZu(db, x.id);
        daten = { ...k, netto: euro(x.net), umsatzsteuer: x.vat ? `${euro(x.vat)} (${x.vatRate} %)` : undefined, faellig: !x.paidDate ? x.dueDate || x.date : undefined,
          konto: (db.accounts || []).find((c) => c.id === x.accountId)?.name, rechnung: r?.nummer || x.invoiceNumber || undefined, notiz: text(x.notes, 200) || undefined };
        felder = [['Betrag', `${euro(x.gross)}${x.vat ? `, darin ${euro(x.vat)} Umsatzsteuer` : ''}`], ['Datum', fmtDate(x.date)], ['Bezahlt', isVoidPart(x) ? 'storniert' : x.paidDate ? fmtDate(x.paidDate) : k.bezahlt], ['Kategorie', k.kategorie],
          ...(k.kontakt ? [['Kontakt', k.kontakt]] : []), ...(daten.rechnung ? [['Rechnung', daten.rechnung]] : []), ['Beleg', k.beleg]];
      } else if (ziel.art === 'rechnung') {
        const k = rechnungKurz(db, x, heute);
        const b = berechnen(x);
        const m = x.richtung !== 'eingang' ? mahnbarkeit(x, { buchungen: buchungenZu(db, x), mahnungen: db.reminders || [], heute }) : null;
        daten = { ...k.daten, netto: euro(b.netto), umsatzsteuer: euro(b.brutto - b.netto), positionen: (x.positionen || []).slice(0, 8).map((p) => `${zahlText(Number(p.menge) || 0)} × ${text(p.name, 50)} zu ${euro(p.preis)}`),
          noch_offen: m && m.rest > 0 && k.zustand !== 'bezahlt' ? euro(m.rest) : undefined, gemahnt: m?.letzte ? stufenName(m.letzte.stufe) : undefined };
        felder = [['Nummer', x.nummer || 'Entwurf'], ['Kunde', k.daten.kunde || '–'], ['Betrag', `${euro(b.brutto)} (netto ${euro(b.netto)})`], ['Zustand', k.daten.zustand],
          ...(k.daten.faellig ? [['Fällig', fmtDate(k.daten.faellig)]] : []), ...(daten.gemahnt ? [['Zuletzt gemahnt', daten.gemahnt]] : [])];
      } else if (ziel.art === 'kontakt') {
        return WERKZEUGE.find((w) => w.name === 'kontakt_finden').ausfuehren(db, { name: x.name }, { heute });
      } else if (ziel.art === 'termin') {
        daten = { id: x.id, titel: x.title, datum: x.date, zeit: x.allDay ? 'ganztägig' : `${x.startTime || ''}${x.endTime ? `–${x.endTime}` : ''}`, ort: x.location || undefined, kontakt: kontaktName(db, x.contactId) || undefined, notiz: text(x.notes, 200) || undefined };
        felder = [['Datum', fmtDate(x.date)], ['Zeit', daten.zeit], ...(daten.ort ? [['Ort', daten.ort]] : []), ...(daten.kontakt ? [['Kontakt', daten.kontakt]] : [])];
      } else {
        daten = { id: x.id, titel: x.title, faellig: x.dueDate || undefined, erledigt: x.done ? 'ja' : 'nein', text: text(aufgabenText(x), 300) || undefined };
        felder = [['Fällig', x.dueDate ? fmtDate(x.dueDate) : 'ohne Datum'], ['Erledigt', daten.erledigt]];
      }
      const name = eintragBeschreiben(db, ziel);
      return {
        daten,
        karte: { art: 'liste', titel: name, eintraege: felder.map(([n, w]) => ({ titel: w, sub: n })), mehr: { text: 'Öffnen', ziel } },
        text: `${name}.${ziel.art === 'buchung' ? ` ${isVoidPart(x) ? 'Storniert' : x.paidDate ? `Bezahlt am ${fmtDate(x.paidDate)}` : `Noch offen${x.dueDate ? `, fällig am ${fmtDate(x.dueDate)}` : ''}`}.` : ''}${ziel.art === 'rechnung' ? ` Zustand: ${daten.zustand}${daten.noch_offen ? `, offen ${daten.noch_offen}` : ''}.` : ''}`,
      };
    },
  },
  {
    name: 'tagesueberblick', art: 'lesen', kern: true,
    beschreibung: 'Was heute ansteht.',
    parameter: {},
    ausfuehren(db, a, { heute, privat }) {
      const s = scopeDb(db, privat);
      const o = openItems(s, heute);
      const ueber = o.receivables.filter((t) => t.overdue);
      const zahlen = o.payables.filter((t) => t.dueDate <= addDays(heute, 7));
      const mahnbar = (db.invoices || []).filter((r) => r.richtung !== 'eingang' && r.status === 'ausgestellt' && mahnbarkeit(r, { buchungen: buchungenZu(db, r), mahnungen: db.reminders || [], heute }).mahnbar);
      const fristen = steuertermine(db.settings || {}, heute, addDays(heute, 14));
      const termine = expandAppointments(db.appointments || [], heute, addDays(heute, 1)).sort((x, y) => `${x.occurrence} ${x.startTime || ''}`.localeCompare(`${y.occurrence} ${y.startTime || ''}`));
      const aufgaben = (db.todos || []).filter((t) => !t.done && t.dueDate && t.dueDate <= heute);
      const wiederkehrend = faellige(db, heute, gesperrtBis(db)).filter((f) => !f.vorhanden && !f.gesperrt);
      const jahr = heute.slice(0, 4);
      const hinweise = healthChecks(s, `${jahr}-01-01`, heute).filter((h) => h.level !== 'info');
      const zeilen = [];
      if (termine.length) zeilen.push({ titel: anzahl(termine.length, 'Termin heute oder morgen', 'Termine heute und morgen'), sub: termine.slice(0, 3).map((x) => `${x.occurrence === heute ? 'heute' : 'morgen'}${x.allDay ? '' : ` ${x.startTime || ''}`} ${x.title || 'Termin'}`).join(' · '), ziel: sprungZiel('calendar') });
      if (aufgaben.length) zeilen.push({ titel: anzahl(aufgaben.length, 'Aufgabe fällig', 'Aufgaben fällig'), sub: aufgaben.slice(0, 3).map((t) => t.title).join(' · '), ton: aufgaben.some((t) => t.dueDate < heute) ? 'neg' : '', ziel: sprungZiel('todos') });
      if (fristen.length) zeilen.push({ titel: fristen[0].titel, sub: fristen.length > 1 ? `und ${anzahl(fristen.length - 1, 'weitere Frist', 'weitere Fristen')} in 14 Tagen` : 'Frist beim Finanzamt', betrag: fmtDate(fristen[0].datum), ton: daysBetween(heute, fristen[0].datum) <= 3 ? 'neg' : '' });
      if (ueber.length) zeilen.push({ titel: anzahl(ueber.length, 'Kundenrechnung überfällig', 'Kundenrechnungen überfällig'), sub: mahnbar.length ? `${int(mahnbar.length)} davon lassen sich mahnen` : 'Kunden schulden Ihnen Geld', betrag: euro(ueber.reduce((x, t) => x + t.gross, 0)), ton: 'neg', ziel: sprungZiel('reports', { tab: 'opos' }) });
      if (zahlen.length) zeilen.push({ titel: anzahl(zahlen.length, 'eigene Rechnung zu zahlen', 'eigene Rechnungen zu zahlen'), sub: 'fällig in den nächsten 7 Tagen oder schon fällig', betrag: euro(zahlen.reduce((x, t) => x + t.gross, 0)), ziel: sprungZiel('reports', { tab: 'opos' }) });
      if (wiederkehrend.length) zeilen.push({ titel: anzahl(wiederkehrend.length, 'wiederkehrende Buchung fällig', 'wiederkehrende Buchungen fällig'), sub: 'noch nicht gebucht', ziel: sprungZiel('master', { tab: 'recurring' }) });
      for (const h of hinweise.slice(0, 3)) zeilen.push({ titel: satzAnfang(h.text, 110), sub: 'Hinweis zur Buchhaltung', ton: h.level === 'error' ? 'neg' : '', ziel: h.ids?.length ? sprungZiel('transactions', { ids: h.ids, titel: 'Hinweis' }) : null });
      const teile = [
        termine.length && anzahl(termine.length, 'Termin heute oder morgen', 'Termine heute und morgen'),
        aufgaben.length && anzahl(aufgaben.length, 'fällige Aufgabe', 'fällige Aufgaben'),
        fristen.length && `${fristen[0].titel} am ${fmtDate(fristen[0].datum)}`,
        ueber.length && `${anzahl(ueber.length, 'überfällige Kundenrechnung', 'überfällige Kundenrechnungen')} über ${euro(ueber.reduce((x, t) => x + t.gross, 0))}`,
        zahlen.length && `${anzahl(zahlen.length, 'eigene Rechnung', 'eigene Rechnungen')} bald zu zahlen`,
        wiederkehrend.length && anzahl(wiederkehrend.length, 'wiederkehrende Buchung zu buchen', 'wiederkehrende Buchungen zu buchen'),
        hinweise.length && anzahl(hinweise.length, 'Hinweis zur Buchhaltung', 'Hinweise zur Buchhaltung'),
      ].filter(Boolean);
      return {
        daten: {
          heute, termine: termine.slice(0, 5).map((x) => ({ titel: x.title, datum: x.occurrence, zeit: x.allDay ? 'ganztägig' : x.startTime })),
          aufgaben: aufgaben.slice(0, 5).map((t) => ({ titel: t.title, faellig: t.dueDate })), fristen: fristen.slice(0, 3).map((f) => ({ was: f.titel, datum: f.datum })),
          ueberfaellige_rechnungen: { anzahl: ueber.length, summe: euro(ueber.reduce((x, t) => x + t.gross, 0)), mahnbar: mahnbar.length },
          bald_zu_zahlen: { anzahl: zahlen.length, summe: euro(zahlen.reduce((x, t) => x + t.gross, 0)) },
          wiederkehrend_offen: wiederkehrend.length, hinweise: hinweise.slice(0, 3).map((h) => satzAnfang(h.text, 160)),
        },
        karte: { art: 'liste', titel: 'Was ansteht', zeitraum: `am ${fmtDate(heute)}`, eintraege: zeilen, leer: 'Heute steht nichts Dringendes an.' },
        text: teile.length ? `Heute wichtig: ${teile.join(', ')}.` : 'Heute steht nichts Dringendes an.',
      };
    },
  },
  {
    name: 'entwicklung', art: 'lesen', kern: false,
    beschreibung: 'Verlauf Monat für Monat: Einnahmen, Ausgaben oder Gewinn, auch einer Kategorie.',
    parameter: { wert: { type: 'string', enum: ['einnahmen', 'ausgaben', 'gewinn'] }, zeitraum: ZEITRAUM, kategorie: { type: 'string' } },
    ausfuehren(db, a, { heute, privat }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'die letzten 12 Monate');
      const s = scopeDb(db, privat);
      const wert = ['einnahmen', 'ausgaben', 'gewinn'].includes(a.wert) ? a.wert : 'einnahmen';
      const typ = wert === 'einnahmen' ? 'income' : 'expense';
      const kat = a.kategorie && wert !== 'gewinn' ? kategorieSuchen(db, a.kategorie, typ) || kategorieAusAlltag(db, a.kategorie, typ) : null;
      let monate = monthlySeries(s, z.von, z.bis).slice(-36).map((m) => ({ ym: m.ym, betrag: wert === 'einnahmen' ? m.income : wert === 'ausgaben' ? m.expense : m.profit }));
      if (kat) {
        monate = monate.map((m) => {
          const von = `${m.ym}-01`;
          const bis = monthEnd(von);
          const r = periodReport(s, von < z.von ? z.von : von, bis > z.bis ? z.bis : bis);
          return { ym: m.ym, betrag: r.byCategory.find((c) => c.categoryId === kat.id)?.amount || 0 };
        });
      }
      if (!monate.length) return { daten: { zeitraum: z.text, monate: [] }, karte: { art: 'text', titel: 'Verlauf', text: 'In diesem Zeitraum gibt es keine Buchungen.' }, text: 'In diesem Zeitraum gibt es keine Buchungen.' };
      const summe = monate.reduce((x, m) => x + m.betrag, 0);
      const schnitt = Math.round(summe / monate.length);
      const hoch = monate.reduce((x, m) => (m.betrag > x.betrag ? m : x));
      const tief = monate.reduce((x, m) => (m.betrag < x.betrag ? m : x));
      const n = Math.min(3, Math.floor(monate.length / 2));
      const jetzt = n ? monate.slice(-n).reduce((x, m) => x + m.betrag, 0) : 0;
      const davor = n ? monate.slice(-2 * n, -n).reduce((x, m) => x + m.betrag, 0) : 0;
      const trend = n ? prozent(jetzt, davor) : null;
      const name = kat ? kat.name : { einnahmen: 'Einnahmen', ausgaben: 'Ausgaben', gewinn: 'Gewinn' }[wert];
      const max = Math.max(1, ...monate.map((m) => Math.abs(m.betrag)));
      const trendText = trend === null ? '' : ` Die letzten ${n} Monate liegen ${trend === 0 ? 'gleichauf mit' : `${Math.abs(trend)} % ${trend > 0 ? 'über' : 'unter'}`} den ${n} davor.`;
      return {
        daten: { zeitraum: z.text, wert: name, summe: euro(summe), schnitt_je_monat: euro(schnitt), hoechster: `${monatText(hoch.ym)}: ${euro(hoch.betrag)}`, niedrigster: `${monatText(tief.ym)}: ${euro(tief.betrag)}`, trend_prozent: trend ?? undefined, monate: monate.map((m) => ({ monat: monatText(m.ym), betrag: euro(m.betrag) })) },
        karte: {
          art: 'liste', titel: `${name} je Monat`, zeitraum: z.text,
          zahlen: [{ name: 'Zusammen', wert: euro(summe) }, { name: 'Schnitt je Monat', wert: euro(schnitt) }, ...(trend !== null ? [{ name: `Letzte ${n} Monate`, wert: `${trend >= 0 ? '+' : ''}${trend} %`, ton: (trend >= 0) === (wert !== 'ausgaben') ? 'pos' : 'neg' }] : [])],
          eintraege: monate.map((m) => ({ titel: monatText(m.ym), betrag: euro(m.betrag), balken: Math.abs(m.betrag) / max, ton: m.betrag < 0 ? 'neg' : '' })),
          mehr: { text: 'Jahresvergleich öffnen', ziel: sprungZiel('reports', { tab: 'vergleich' }) },
        },
        text: `${name} ${z.text}: zusammen ${euro(summe)}, im Schnitt ${euro(schnitt)} je Monat. Am meisten im ${monatText(hoch.ym)} (${euro(hoch.betrag)}), am wenigsten im ${monatText(tief.ym)} (${euro(tief.betrag)}).${trendText}`,
      };
    },
  },
  {
    name: 'jahrespruefung', art: 'lesen', kern: false,
    beschreibung: 'Prüft ein Jahr vor der Steuer: was fehlt oder nicht stimmt.',
    parameter: { zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const liste = healthChecks(scopeDb(db, false), z.von, z.bis < heute ? z.bis : heute);
      const STUFE = { error: 'Fehler', warn: 'Bitte prüfen', info: 'Hinweis' };
      const rang = { error: 0, warn: 1, info: 2 };
      liste.sort((x, y) => rang[x.level] - rang[y.level]);
      const fehler = liste.filter((h) => h.level === 'error').length;
      return {
        daten: { zeitraum: z.text, punkte: liste.length, fehler, hinweise: liste.slice(0, 8).map((h) => ({ art: STUFE[h.level], text: satzAnfang(h.text, 220), buchungen: h.ids?.length || undefined })) },
        karte: {
          art: 'liste', titel: 'Prüfung', zeitraum: z.text,
          eintraege: liste.slice(0, 8).map((h) => ({ titel: satzAnfang(h.text, 140), sub: STUFE[h.level], ton: h.level === 'error' ? 'neg' : '', ziel: h.ids?.length ? sprungZiel('transactions', { ids: h.ids, titel: satzAnfang(h.text, 60) }) : null })),
          leer: 'Nichts gefunden, das fehlt oder nicht stimmt.',
        },
        text: liste.length ? `Für ${z.text} habe ich ${anzahl(liste.length, 'Punkt', 'Punkte')} gefunden${fehler ? `, davon ${anzahl(fehler, 'Fehler', 'Fehler')}` : ''}. ${satzAnfang(liste[0].text, 200).replace(/([^.!?…])$/, '$1.')}`
          : `Für ${z.text} habe ich nichts gefunden, das fehlt oder nicht stimmt. Offene Rechnungen und Belege aus anderen Jahren sind darin nicht geprüft.`,
      };
    },
  },
  {
    name: 'euer', art: 'lesen', kern: false,
    beschreibung: 'Zeilen der Anlage EÜR eines Jahres mit Beträgen.',
    parameter: { zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute }) {
      const z = zeitraumArgument(a.zeitraum || a.jahr, heute, 'letztes Jahr');
      const jahr = z.bis.slice(0, 4);
      const r = euerReport(scopeDb(db, false), `${jahr}-01-01`, `${jahr}-12-31`);
      const zeilen = [...r.income.map((x) => ({ ...x, art: 'Einnahme' })), ...r.expense.map((x) => ({ ...x, art: 'Ausgabe' }))].filter((x) => x.amount);
      const groesste = [...r.expense].sort((x, y) => y.amount - x.amount)[0];
      return {
        daten: { jahr, einnahmen: euro(r.incomeTotal), ausgaben: euro(r.expenseTotal), gewinn: euro(r.profit), ohne_kategorie: r.ohneKategorie.length || undefined,
          zeilen: zeilen.slice(0, 20).map((x) => ({ zeile: x.line, bezeichnung: x.label, betrag: euro(x.amount) })) },
        karte: {
          art: 'liste', titel: 'Anlage EÜR', zeitraum: `Jahr ${jahr}`,
          zahlen: [{ name: 'Einnahmen', wert: euro(r.incomeTotal), ton: 'pos' }, { name: 'Ausgaben', wert: euro(r.expenseTotal), ton: 'neg' }, { name: r.profit >= 0 ? 'Gewinn' : 'Verlust', wert: euro(Math.abs(r.profit)), ton: r.profit >= 0 ? 'pos' : 'neg', gross: true }],
          eintraege: zeilen.slice(0, 20).map((x) => ({ titel: x.label, sub: `Zeile ${x.line} · ${x.art}`, betrag: euro(x.amount) })),
          mehr: { text: 'Anlage EÜR öffnen', ziel: sprungZiel('reports', { tab: 'euer', period: { preset: 'benutzerdefiniert', from: `${jahr}-01-01`, to: `${jahr}-12-31` } }) },
          leer: 'In diesem Jahr gibt es keine Buchungen für die Anlage EÜR.',
        },
        text: `Anlage EÜR ${jahr}: Betriebseinnahmen ${euro(r.incomeTotal)}, Betriebsausgaben ${euro(r.expenseTotal)}, ${r.profit >= 0 ? 'Gewinn' : 'Verlust'} ${euro(Math.abs(r.profit))}.${groesste?.amount ? ` Größte Ausgabenzeile: Zeile ${groesste.line} (${groesste.label}) mit ${euro(groesste.amount)}.` : ''}${r.ohneKategorie.length ? ` ${anzahl(r.ohneKategorie.length, 'Buchung hat', 'Buchungen haben')} noch keine Kategorie und fehlt darin.` : ''}`,
      };
    },
  },
  {
    name: 'abschreibungen', art: 'lesen', kern: false,
    beschreibung: 'Abschreibungen (AfA) der Anlagegüter in einem Zeitraum.',
    parameter: { zeitraum: ZEITRAUM },
    ausfuehren(db, a, { heute }) {
      const z = zeitraumArgument(a.zeitraum, heute, 'dieses Jahr');
      const gueter = (db.assets || []).map((g) => ({ g, betrag: depreciationInRange(g, z.von, z.bis), rest: bookValue(g, z.bis) }))
        .filter((x) => x.betrag > 0 || (x.rest > 0 && !x.g.abgang?.datum)).sort((x, y) => y.betrag - x.betrag);
      const summe = gueter.reduce((x, y) => x + y.betrag, 0);
      return {
        daten: { zeitraum: z.text, summe: euro(summe), anlagegueter: gueter.slice(0, 10).map((x) => ({ name: x.g.name, afa: euro(x.betrag), restwert: euro(x.rest), methode: AFA_METHODE[afaMethod(x.g)] || afaMethod(x.g) })) },
        karte: {
          art: 'liste', titel: 'Abschreibungen', zeitraum: z.text, zahlen: [{ name: 'Zusammen', wert: euro(summe), gross: true }],
          eintraege: gueter.slice(0, 10).map((x) => ({ titel: x.g.name, sub: `Restwert ${euro(x.rest)}`, betrag: euro(x.betrag) })),
          mehr: { text: 'Anlagevermögen öffnen', ziel: sprungZiel('reports', { tab: 'anlagen' }) },
          leer: 'Es sind keine Anlagegüter erfasst.',
        },
        text: gueter.length ? `Abschreibungen ${z.text}: ${euro(summe)} für ${anzahl(gueter.filter((x) => x.betrag > 0).length, 'Anlagegut', 'Anlagegüter')}.${gueter[0].betrag ? ` Am meisten: ${gueter[0].g.name} mit ${euro(gueter[0].betrag)}.` : ''}`
          : 'Es sind keine Anlagegüter erfasst, die abgeschrieben werden.',
      };
    },
  },
  {
    name: 'kleinunternehmer', art: 'lesen', kern: false,
    beschreibung: 'Umsatz im Vergleich zu den Grenzen der Kleinunternehmerregelung.',
    parameter: {},
    ausfuehren(db, a, { heute }) {
      const jahr = Number(heute.slice(0, 4));
      const jetzt = jahresumsatz(db, jahr);
      const vorjahr = jahresumsatz(db, jahr - 1);
      const klein = isKleinunternehmer(db, heute);
      const hinweise = smallBusinessChecks(db, heute);
      const luft = Math.max(0, 10000000 - jetzt);
      return {
        daten: { kleinunternehmer: klein ? 'ja' : 'nein', [`umsatz_${jahr}`]: euro(jetzt), [`umsatz_${jahr - 1}`]: euro(vorjahr), grenze_vorjahr: '25.000,00 €', grenze_laufendes_jahr: '100.000,00 €', hinweise: hinweise.map((h) => satzAnfang(h.text, 240)) },
        karte: {
          art: 'liste', titel: 'Kleinunternehmerregelung', zeitraum: klein ? 'eingestellt' : 'nicht eingestellt',
          zahlen: [{ name: `Umsatz ${jahr - 1}`, wert: euro(vorjahr), ton: vorjahr > 2500000 ? 'neg' : '' }, { name: `Umsatz ${jahr} bisher`, wert: euro(jetzt), ton: jetzt > 10000000 ? 'neg' : '' }],
          eintraege: [{ titel: 'Grenze für das Vorjahr', betrag: '25.000,00 €' }, { titel: 'Grenze im laufenden Jahr', betrag: '100.000,00 €' }, ...hinweise.map((h) => ({ titel: satzAnfang(h.text, 140), ton: 'neg' }))],
          mehr: { text: 'Einstellungen öffnen', ziel: sprungZiel('settings') },
        },
        text: `${klein ? 'Sie sind als Kleinunternehmer eingestellt.' : 'Sie sind nicht als Kleinunternehmer eingestellt.'} Umsatz ${jahr - 1}: ${euro(vorjahr)} (Grenze 25.000 €), ${jahr} bisher: ${euro(jetzt)} (Grenze 100.000 €${klein && luft ? `, noch ${euro(luft)} Luft` : ''}).${hinweise.length ? ` ${satzAnfang(hinweise[0].text, 200)}` : ''}`,
      };
    },
  },
  {
    name: 'hilfe_suchen', art: 'lesen', kern: true,
    beschreibung: 'Anleitung: wie etwas geht, wo es steht, was ein Begriff heißt.',
    parameter: { frage: { type: 'string' } },
    pflicht: ['frage'],
    ausfuehren(db, a, { hilfe }) {
      if (!hilfe?.length) return { daten: { fehler: 'Die Anleitung ist gerade nicht geladen.' }, karte: { art: 'sprung', titel: 'Hilfe', ziel: sprungZiel('help') }, text: 'Ich öffne die Hilfe.' };
      const t = hilfeFinden(hilfe, a.frage).slice(0, 3);
      const ziel = (x) => sprungZiel('help', { ...(x.abschnitt.tab && x.abschnitt.tab !== 'anleitung' ? { tab: x.abschnitt.tab } : {}), abschnitt: x.abschnitt.kennung });
      if (!t.length) {
        return { daten: { treffer: 0 }, karte: { art: 'liste', titel: 'In der Hilfe', eintraege: [], mehr: { text: 'Hilfe öffnen', ziel: sprungZiel('help') }, leer: 'Dazu steht in der Hilfe nichts.' }, text: 'Dazu steht in der Hilfe nichts. Versuchen Sie es mit einem anderen Wort.' };
      }
      return {
        daten: { treffer: t.length, abschnitte: t.map((x, i) => ({ titel: x.abschnitt.titel, text: i === 0 ? satzAnfang(x.absaetze.join(' '), 900) : satzAnfang(x.absaetze[0], 200) })) },
        karte: { art: 'liste', titel: 'In der Hilfe', eintraege: t.map((x) => ({ titel: x.abschnitt.titel, sub: satzAnfang(x.absaetze[0], 140), ziel: ziel(x) })) },
        text: `In der Hilfe unter „${t[0].abschnitt.titel}“: ${satzAnfang(t[0].absaetze[0], 360)}`,
      };
    },
  },
  {
    name: 'rechnen', art: 'lesen', kern: true,
    beschreibung: 'Rechnet genau, z. B. "(120+80)*1,19", "19 % von 250".',
    parameter: { ausdruck: { type: 'string' } },
    pflicht: ['ausdruck'],
    ausfuehren(db, a) {
      try {
        const v = ausrechnen(a.ausdruck);
        return { daten: { ausdruck: text(a.ausdruck, 120), ergebnis: zahlText(v) }, karte: { art: 'zahlen', titel: 'Rechnung', zahlen: [{ name: text(a.ausdruck, 60), wert: zahlText(v), gross: true }] }, text: `${text(a.ausdruck, 80)} = ${zahlText(v)}` };
      } catch (e) {
        return { daten: { fehler: e.message }, karte: { art: 'text', titel: 'Rechnung', text: e.message }, text: e.message };
      }
    },
  },
  {
    name: 'steuer_rechnen', art: 'lesen', kern: true,
    beschreibung: 'Netto, Steuer, brutto aus einem Betrag.',
    parameter: { betrag: { type: 'number', description: 'Euro' }, satz: { type: 'number', description: 'Prozent, meist 19' }, von: { type: 'string', enum: ['netto', 'brutto'] } },
    pflicht: ['betrag'],
    ausfuehren(db, a) {
      const cent = Math.round((zahlOder(a.betrag, 0)) * 100);
      const satz = zahlOder(a.satz, 19);
      const s = a.von === 'netto' ? splitFromNet(cent, satz) : splitFromGross(cent, satz);
      return {
        daten: { netto: euro(s.net), umsatzsteuer: euro(s.vat), brutto: euro(s.gross), satz: `${satz} %` },
        karte: { art: 'zahlen', titel: `Umsatzsteuer ${zahlText(satz)} %`, zahlen: [{ name: 'Netto', wert: euro(s.net) }, { name: 'Umsatzsteuer', wert: euro(s.vat) }, { name: 'Brutto', wert: euro(s.gross), gross: true }] },
        text: `Netto ${euro(s.net)} + ${zahlText(satz)} % Umsatzsteuer ${euro(s.vat)} = brutto ${euro(s.gross)}.`,
      };
    },
  },
  {
    name: 'oeffnen', art: 'sprung', kern: true,
    beschreibung: `Öffnet einen Bereich: ${[...new Set(BEREICHE.map((b) => b.bereich))].join(', ')}. Reiter: rechnungen (ausgang, eingang, mahnwesen, vorlagen, produkte), reports (guv, euer, ust, bilanz, opos, konten, anlagen, vergleich), master (contacts, categories, accounts, assets, recurring), export (export, import).`,
    parameter: { bereich: { type: 'string' }, reiter: { type: 'string' } },
    pflicht: ['bereich'],
    ausfuehren(db, a) {
      const b = bereichFinden(a.bereich, a.reiter) || bereichFinden(`${a.bereich} ${a.reiter || ''}`);
      if (!b) return { daten: { fehler: `Bereich „${text(a.bereich, 40)}“ gibt es nicht.` }, karte: { art: 'text', titel: 'Öffnen', text: 'Diesen Bereich kenne ich nicht.' }, text: 'Diesen Bereich kenne ich nicht.' };
      const params = !b.reiter ? {} : b.bereich === 'reports' || b.bereich === 'master' || b.bereich === 'rechnungen' || b.bereich === 'help' ? { tab: b.reiter } : b.bereich === 'export' ? { reiter: b.reiter } : {};
      return { daten: { geoeffnet: b.name }, karte: { art: 'sprung', titel: b.name, ziel: sprungZiel(b.bereich, params) }, text: `Ich öffne ${b.name}.` };
    },
  },
  {
    name: 'eintrag_oeffnen', art: 'sprung', kern: false,
    beschreibung: 'Öffnet einen Eintrag mit seiner id aus einem Ergebnis.',
    parameter: { art: { type: 'string', enum: ['buchung', 'rechnung', 'kontakt', 'termin', 'aufgabe'] }, id: { type: 'string' } },
    pflicht: ['art', 'id'],
    ausfuehren(db, a) {
      const quelle = { buchung: db.transactions, rechnung: db.invoices, kontakt: db.contacts, termin: db.appointments, aufgabe: db.todos }[a.art];
      const x = (quelle || []).find((y) => y.id === a.id);
      if (!x) return { daten: { fehler: 'Diesen Eintrag gibt es nicht.' }, karte: { art: 'text', titel: 'Öffnen', text: 'Diesen Eintrag finde ich nicht.' }, text: 'Diesen Eintrag finde ich nicht.' };
      const name = x.description || x.nummer || x.name || x.title || 'Eintrag';
      return { daten: { geoeffnet: name }, karte: { art: 'sprung', titel: name, ziel: { art: a.art, id: a.id } }, text: `Ich öffne „${name}“.` };
    },
  },

  /* Vorschläge: Es wird nichts gespeichert. Die Oberfläche öffnet das gewohnte Fenster, ausgefüllt. */
  {
    name: 'buchung_vorschlagen', art: 'vorschlag', kern: true,
    beschreibung: 'Bereitet eine Einnahme oder Ausgabe vor (Nutzer speichert).',
    parameter: {
      typ: { type: 'string', enum: ['ausgabe', 'einnahme'] }, betrag: { type: 'number', description: 'brutto, Euro' }, beschreibung: { type: 'string' },
      datum: { type: 'string', description: 'z. B. "gestern"' }, kategorie: { type: 'string' }, kontakt: { type: 'string' }, bezahlt: { type: 'boolean' },
      ust_satz: { type: 'number' },
    },
    pflicht: ['typ', 'betrag'],
    ausfuehren(db, a, { heute }) {
      const typ = TYP[a.typ] || 'expense';
      const cent = Math.round(Math.abs(zahlOder(a.betrag, 0)) * 100);
      const datum = tag(a.datum, heute) || heute;
      const kon = a.kontakt ? kontaktSuchen(db, a.kontakt) : null;
      // Genannte Kategorie, sonst der lokale Vorschlag wie beim Kontoauszug (eigene Geschichte, dann Stichwörter).
      let kat = kategorieSuchen(db, a.kategorie, typ);
      let geraten = false;
      if (!kat) {
        const kategorien = new Map((db.categories || []).map((c) => [c.id, c]));
        const v = kategorieVorschlagen(
          { betrag: typ === 'income' ? cent : -cent, gegenseite: kon?.name || text(a.beschreibung, 80), zweck: text(a.beschreibung, 120) },
          { kategorien, geschichte: geschichteAufbauen(db.transactions || [], new Map((db.contacts || []).map((c) => [c.id, c]))) },
        );
        kat = v ? kategorien.get(v.kategorieId) : kategorieSuchen(db, a.beschreibung, typ) || kategorieAusAlltag(db, a.beschreibung, typ);
        geraten = !!kat;
      }
      const klein = isKleinunternehmer(db);
      const satz = klein ? 0 : zahlOder(a.ust_satz, Number(db.settings?.defaultVatRate ?? 19));
      const teile = splitFromGross(cent, satz);
      const daten = { typ, datum, beschreibung: text(a.beschreibung, 120), gross: teile.gross, net: teile.net, vat: teile.vat, vatRate: satz, categoryId: kat?.id || '', contactId: kon?.id || '', paidDate: a.bezahlt === false ? '' : datum };
      return {
        daten: { vorgeschlagen: true, art: typ === 'income' ? 'Einnahme' : 'Ausgabe', betrag: euro(cent), datum, kategorie: kat ? `${kat.name}${geraten ? ' (Vorschlag)' : ''}` : 'bitte wählen', hinweis: 'Noch nicht gespeichert: Der Nutzer prüft im Fenster und speichert selbst.' },
        karte: {
          art: 'vorschlag', titel: typ === 'income' ? 'Neue Einnahme' : 'Neue Ausgabe', vorschlag: 'buchung', daten,
          felder: [['Betrag', euro(cent)], ['Datum', fmtDate(datum)], ['Beschreibung', daten.beschreibung || '–'], ['Kategorie', kat ? `${kat.name}${geraten ? ', Vorschlag' : ''}` : 'bitte wählen'], ...(kon ? [['Kontakt', kon.name]] : []), ['Bezahlt', daten.paidDate ? 'ja' : 'noch offen']],
        },
        text: `Ich habe ${typ === 'income' ? 'eine Einnahme' : 'eine Ausgabe'} über ${euro(cent)} vorbereitet. Prüfen Sie die Angaben und speichern Sie.`,
      };
    },
  },
  {
    name: 'aufgabe_vorschlagen', art: 'vorschlag', kern: true,
    beschreibung: 'Bereitet eine Aufgabe vor.',
    parameter: { titel: { type: 'string' }, faellig: { type: 'string', description: 'z. B. "morgen"' }, notiz: { type: 'string' } },
    pflicht: ['titel'],
    ausfuehren(db, a, { heute }) {
      const faellig = tag(a.faellig, heute);
      const daten = { title: text(a.titel, 200), dueDate: faellig, notes: text(a.notiz, 1000) };
      return {
        daten: { vorgeschlagen: true, titel: daten.title, faellig: faellig || 'ohne Datum', hinweis: 'Noch nicht gespeichert.' },
        karte: { art: 'vorschlag', titel: 'Neue Aufgabe', vorschlag: 'aufgabe', daten, felder: [['Aufgabe', daten.title], ['Fällig', faellig ? fmtDate(faellig) : 'ohne Datum'], ...(daten.notes ? [['Notiz', daten.notes]] : [])] },
        text: `Ich habe die Aufgabe „${daten.title}“${faellig ? ` für ${fmtDate(faellig)}` : ''} vorbereitet.`,
      };
    },
  },
  {
    name: 'termin_vorschlagen', art: 'vorschlag', kern: true,
    beschreibung: 'Bereitet einen Termin vor.',
    parameter: { titel: { type: 'string' }, datum: { type: 'string', description: 'z. B. "Montag"' }, uhrzeit: { type: 'string', description: 'HH:MM' }, dauer_minuten: { type: 'number' }, ort: { type: 'string' } },
    pflicht: ['titel', 'datum'],
    ausfuehren(db, a, { heute }) {
      const datum = tag(a.datum, heute) || heute;
      const beginn = /^\d{1,2}:\d{2}$/.test(text(a.uhrzeit, 5)) ? text(a.uhrzeit, 5).padStart(5, '0') : '';
      const dauer = Math.max(15, Math.min(24 * 60, zahlOder(a.dauer_minuten, 60)));
      const ende = beginn ? (() => { const [h, m] = beginn.split(':').map(Number); const e = Math.min(23 * 60 + 59, h * 60 + m + dauer); return `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`; })() : '';
      const daten = { title: text(a.titel, 200), date: datum, allDay: !beginn, startTime: beginn || '09:00', endTime: ende || '10:00', location: text(a.ort, 200) };
      return {
        daten: { vorgeschlagen: true, titel: daten.title, datum, zeit: beginn ? `${beginn}–${ende}` : 'ganztägig', hinweis: 'Noch nicht gespeichert.' },
        karte: { art: 'vorschlag', titel: 'Neuer Termin', vorschlag: 'termin', daten, felder: [['Titel', daten.title], ['Datum', fmtDate(datum)], ['Zeit', beginn ? `${beginn}–${ende}` : 'ganztägig'], ...(daten.location ? [['Ort', daten.location]] : [])] },
        text: `Ich habe den Termin „${daten.title}“ am ${fmtDate(datum)}${beginn ? ` um ${beginn}` : ''} vorbereitet.`,
      };
    },
  },
  {
    name: 'kontakt_vorschlagen', art: 'vorschlag', kern: false,
    beschreibung: 'Bereitet einen Kontakt vor.',
    parameter: { name: { type: 'string' }, email: { type: 'string' }, telefon: { type: 'string' }, art: { type: 'string', enum: ['kunde', 'lieferant'] } },
    pflicht: ['name'],
    ausfuehren(db, a) {
      const doppelt = kontaktSuchen(db, a.name);
      const daten = { name: text(a.name, 200), email: text(a.email, 200), phone: text(a.telefon, 60), kind: a.art === 'lieferant' ? 'supplier' : 'customer' };
      return {
        daten: { vorgeschlagen: true, name: daten.name, gibt_es_schon: doppelt ? doppelt.name : undefined, hinweis: 'Noch nicht gespeichert.' },
        karte: { art: 'vorschlag', titel: a.art === 'lieferant' ? 'Neuer Lieferant' : 'Neuer Kunde', vorschlag: 'kontakt', daten, felder: [['Name', daten.name], ...(daten.email ? [['E-Mail', daten.email]] : []), ...(daten.phone ? [['Telefon', daten.phone]] : [])], warnung: doppelt ? `Es gibt schon „${doppelt.name}“.` : '' },
        text: doppelt ? `Achtung: „${doppelt.name}“ gibt es schon. Ich habe den neuen Kontakt trotzdem vorbereitet.` : `Ich habe den Kontakt „${daten.name}“ vorbereitet.`,
      };
    },
  },
  {
    name: 'rechnung_vorschlagen', art: 'vorschlag', kern: false,
    beschreibung: 'Bereitet eine Rechnung vor.',
    parameter: {
      kunde: { type: 'string' },
      positionen: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, menge: { type: 'number' }, preis: { type: 'number', description: 'netto, Euro' } } } },
      betreff: { type: 'string' },
    },
    ausfuehren(db, a) {
      const kon = a.kunde ? kontaktSuchen(db, a.kunde) : null;
      const positionen = (Array.isArray(a.positionen) ? a.positionen : []).slice(0, 30).map((p) => ({ name: text(p?.name, 200) || 'Leistung', menge: zahlOder(p?.menge, 1), preis: Math.round(zahlOder(p?.preis, 0) * 100) }));
      const netto = positionen.reduce((s, p) => s + Math.round(p.menge * p.preis), 0);
      const daten = { kontaktId: kon?.id || '', kundeText: kon ? '' : text(a.kunde, 200), betreff: text(a.betreff, 200), positionen };
      return {
        daten: { vorgeschlagen: true, kunde: kon?.name || text(a.kunde, 100) || 'bitte wählen', netto: euro(netto), positionen: positionen.length, hinweis: 'Ein Entwurf entsteht erst, wenn der Nutzer ihn öffnet und speichert.' },
        karte: { art: 'vorschlag', titel: 'Neue Rechnung', vorschlag: 'rechnung', daten, felder: [['Kunde', kon?.name || text(a.kunde, 100) || 'bitte wählen'], ...positionen.slice(0, 5).map((p) => [p.name, `${zahlText(p.menge)} × ${euro(p.preis)}`]), ['Netto', euro(netto)]], warnung: a.kunde && !kon ? 'Diesen Kunden gibt es noch nicht als Kontakt.' : '' },
        text: `Ich habe eine Rechnung${kon ? ` an ${kon.name}` : ''} vorbereitet${netto ? ` über ${euro(netto)} netto` : ''}.`,
      };
    },
  },
  {
    name: 'zahlung_vorschlagen', art: 'vorschlag', kern: true,
    beschreibung: 'Offener Posten wurde bezahlt ("X hat bezahlt"); Nutzer bestätigt.',
    parameter: {
      kontakt: { type: 'string' }, rechnung: { type: 'string' }, betrag: { type: 'number' },
      text: { type: 'string' }, datum: { type: 'string' }, art: { type: 'string', enum: ['einnahme', 'ausgabe'] },
    },
    ausfuehren(db, a, { heute, ansicht }) {
      const liste = offeneSuchen(db, a, ansicht);
      const wer = [a.kontakt, a.rechnung, a.text].filter(Boolean).map((x) => text(x, 40)).join(', ');
      if (!liste.length) {
        const t = `Ich finde keinen offenen Posten${wer ? ` zu „${wer}“` : ''}. Vielleicht ist er schon als bezahlt eingetragen.`;
        return { daten: { gefunden: false }, karte: { art: 'text', titel: 'Zahlung', text: t }, text: t };
      }
      const t = liste[0].t;
      const r = rechnungZu(db, t.id);
      const datum = tag(a.datum, heute) || heute;
      const sperre = gesperrtBis(db);
      // Mehrere Buchungen einer Rechnung (je Steuersatz) werden zusammen bezahlt.
      const teile = r && r.status === 'ausgestellt' ? buchungenZu(db, r).filter((x) => !x.paidDate && !isVoidPart(x)) : [t];
      const betrag = teile.reduce((x, y) => x + y.gross, 0);
      const titel = r?.nummer ? `Rechnung ${r.nummer}` : text(t.description, 60) || (t.type === 'income' ? 'Einnahme' : 'Ausgabe');
      const kontakt = kontaktName(db, t.contactId) || r?.kaeufer?.name || '';
      const weitere = liste.slice(1, 4).filter((x) => x.p === liste[0].p);
      const daten = { txId: t.id, rechnungId: r?.status === 'ausgestellt' ? r.id : '', datum };
      return {
        daten: { vorgeschlagen: true, posten: titel, kontakt: kontakt || undefined, betrag: euro(betrag), bezahlt_am: datum, weitere_passende: weitere.length || undefined, hinweis: 'Noch nicht eingetragen: Der Nutzer bestätigt im Fenster.' },
        karte: {
          art: 'vorschlag', titel: t.type === 'income' ? 'Zahlung eingegangen' : 'Zahlung geleistet', vorschlag: 'zahlung', knopf: 'Prüfen und eintragen', daten,
          felder: [['Posten', titel], ...(kontakt ? [['Kontakt', kontakt]] : []), ['Betrag', euro(betrag)], ['Fällig war', fmtDate(t.dueDate || t.date)], ['Bezahlt am', fmtDate(datum)]],
          warnung: sperre && datum <= sperre ? `Der ${fmtDate(datum)} liegt im festgeschriebenen Zeitraum.` : weitere.length ? `Es passen noch ${anzahl(weitere.length, 'weiterer offener Posten', 'weitere offene Posten')}: ${weitere.map((x) => `${text(x.t.description, 30)} (${euro(x.t.gross)})`).join(', ')}.` : '',
        },
        text: `Ich habe die Zahlung zu „${titel}“${kontakt ? ` von ${kontakt}` : ''} über ${euro(betrag)} vorbereitet, bezahlt am ${fmtDate(datum)}. Prüfen und bestätigen Sie im Fenster.`,
      };
    },
  },
  {
    name: 'mahnung_vorschlagen', art: 'vorschlag', kern: false,
    beschreibung: 'Bereitet eine Mahnung zu einer überfälligen Rechnung vor (Nutzer prüft).',
    parameter: { kunde: { type: 'string' }, rechnung: { type: 'string', description: 'Rechnungsnummer' } },
    ausfuehren(db, a, { heute, ansicht }) {
      const kon = a.kunde ? kontaktSuchen(db, a.kunde) : null;
      const nummer = norm(a.rechnung).replace(/\s+/g, '');
      const imBlick = ansicht?.art === 'rechnung' ? ansicht.id : ansicht?.art === 'buchung' ? rechnungZu(db, ansicht.id)?.id : '';
      const alle = (db.invoices || []).filter((r) => r.richtung !== 'eingang' && r.status === 'ausgestellt')
        .filter((r) => (!a.kunde && !nummer && !imBlick) || (nummer && norm(r.nummer).replace(/\s+/g, '') === nummer) || (kon && r.kaeufer?.name && norm(r.kaeufer.name) === norm(kon.name))
          || (a.kunde && passt(r.kaeufer?.name || '', a.kunde)) || (!a.kunde && !nummer && r.id === imBlick))
        .map((r) => ({ r, m: mahnbarkeit(r, { buchungen: buchungenZu(db, r), mahnungen: db.reminders || [], heute }) }));
      const mahnbar = alle.filter((x) => x.m.mahnbar).sort((x, y) => y.m.tageUeber - x.m.tageUeber);
      const wer = [a.kunde, a.rechnung].filter(Boolean).map((x) => text(x, 40)).join(', ');
      if (!mahnbar.length) {
        const t = alle.length ? `${alle[0].r.nummer}: ${alle[0].m.grund}` : `Ich finde keine überfällige Rechnung${wer ? ` zu „${wer}“` : ''}.`;
        return { daten: { mahnbar: false, grund: t }, karte: { art: 'text', titel: 'Mahnung', text: t }, text: t };
      }
      const { r, m } = mahnbar[0];
      const stufe = stufenName(m.vorschlag);
      return {
        daten: { vorgeschlagen: true, rechnung: r.nummer, kunde: r.kaeufer?.name || undefined, offen: euro(m.rest), tage_ueberfaellig: m.tageUeber, stufe, weitere_mahnbare: mahnbar.length - 1 || undefined, hinweis: 'Noch nichts erstellt: Der Nutzer prüft im Mahnungsfenster.' },
        karte: {
          art: 'vorschlag', titel: stufe, vorschlag: 'mahnung', knopf: 'Mahnung vorbereiten', daten: { rechnungId: r.id },
          felder: [['Rechnung', r.nummer], ['Kunde', r.kaeufer?.name || '–'], ['Offen', euro(m.rest)], ['Fällig war', `${fmtDate(m.faellig)} (${int(m.tageUeber)} Tage)`], ...(m.letzte ? [['Zuletzt', stufenName(m.letzte.stufe)]] : [])],
          warnung: m.fristLaeuft ? `Die Frist der letzten Mahnung läuft noch bis ${fmtDate(m.fristBis)}.` : mahnbar.length > 1 ? `Außerdem mahnbar: ${mahnbar.slice(1, 4).map((x) => x.r.nummer).join(', ')}.` : '',
        },
        text: `Rechnung ${r.nummer}${r.kaeufer?.name ? ` an ${r.kaeufer.name}` : ''} ist seit ${anzahl(m.tageUeber, 'Tag', 'Tagen')} überfällig, offen ${euro(m.rest)}. Ich habe die ${stufe} vorbereitet; prüfen Sie sie im Fenster.`,
      };
    },
  },
  {
    name: 'faehigkeiten', art: 'lesen', kern: false, intern: true,
    beschreibung: 'Was der Assistent kann.',
    parameter: {},
    ausfuehren(db, a) {
      const t = a.dank ? 'Gern. Fragen Sie jederzeit wieder.' : 'Ich finde Buchungen, Rechnungen, Kontakte, Termine und Aufgaben, rechne Ihre Zahlen aus, erkläre die Bedienung, öffne Bereiche und bereite neue Einträge, Zahlungen und Mahnungen vor. Fragen Sie zum Beispiel: „Was steht heute an?“';
      return { daten: {}, karte: null, text: t };
    },
  },
];

const NACH_NAME = new Map(WERKZEUGE.map((w) => [w.name, w]));
export const werkzeug = (name) => NACH_NAME.get(name) || null;

/**
 * Führt ein Werkzeug aus. Unbekannte Werkzeuge und Fehler werden zu einem
 * Ergebnis mit `fehler`, damit ein Modell es noch einmal versuchen kann.
 * @param {object} db
 * @param {string} name
 * @param {object} argumente
 * @param {{heute?:string, privat?:boolean, hilfe?:Array<object>|null, ansicht?:{art:string, id:string}|null}} [k]
 */
export function ausfuehren(db, name, argumente = {}, { heute = todayISO(), privat = false, hilfe = null, ansicht = null } = {}) {
  const w = werkzeug(name);
  if (!w) return { name, art: 'lesen', daten: { fehler: `Das Werkzeug „${text(name, 40)}“ gibt es nicht.` }, karte: null, text: '' };
  const a = argumente && typeof argumente === 'object' && !Array.isArray(argumente) ? argumente : {};
  try {
    return { name, art: w.art, ...w.ausfuehren(db, a, { heute, privat, hilfe, ansicht }) };
  } catch (e) {
    return { name, art: w.art, daten: { fehler: String(e?.message || e) }, karte: { art: 'text', titel: 'Fehler', text: 'Das hat nicht geklappt.' }, text: 'Das hat nicht geklappt.' };
  }
}

/**
 * Die Werkzeuge als Funktionsbeschreibung für ein Modell (Format von Qwen:
 * {type:'function', function:{name, description, parameters}}).
 * @param {{nurKern?:boolean}} [opt]  nurKern: die kleine Auswahl für das kleinste Modell
 */
export function werkzeugBeschreibungen({ nurKern = false } = {}) {
  return WERKZEUGE.filter((w) => !w.intern && (!nurKern || w.kern)).map((w) => ({
    type: 'function',
    function: {
      name: w.name,
      description: w.beschreibung,
      parameters: { type: 'object', properties: w.parameter, ...(w.pflicht?.length ? { required: w.pflicht } : {}) },
    },
  }));
}
