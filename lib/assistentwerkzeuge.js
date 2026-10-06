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
 * Argument. So laufen die Werkzeuge auch in den Prüfungen.
 */

import { norm, money, fmtDate, addDays, todayISO, splitFromGross, splitFromNet, daysBetween, int } from './util.js';
import { periodReport, openItems, vatReturn, accountBalances, scopeDb, isKleinunternehmer, basisOf, isVoidPart } from './calc.js';
import { berechnen, zustand as rechnungsZustand, ZUSTAENDE, faelligkeit } from './rechnung.js';
import { expandAppointments } from './termine.js';
import { steuertermine } from './fristen.js';
import { sucheIndex } from './suchindex.js';
import { aufgabenText } from './aufgaben.js';
import { zeitraumArgument, bereichFinden, BEREICHE } from './assistentdeutung.js';
import { kategorieVorschlagen, geschichteAufbauen } from './kategorisierung.js';

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

const zahlText = (v) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(Math.round(v * 10000) / 10000);

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

const ZEITRAUM = { type: 'string', description: 'wie gesagt, z. B. "letzte Woche", "März", "Q2 2025"' };

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
    name: 'faehigkeiten', art: 'lesen', kern: false, intern: true,
    beschreibung: 'Was der Assistent kann.',
    parameter: {},
    ausfuehren(db, a) {
      const t = a.dank ? 'Gern. Fragen Sie jederzeit wieder.' : 'Ich finde Buchungen, Rechnungen, Kontakte, Termine und Aufgaben, rechne Ihre Zahlen aus, öffne Bereiche und bereite neue Einträge vor. Fragen Sie zum Beispiel: „Was ist noch offen?“';
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
 * @param {{heute?:string, privat?:boolean}} [k]
 */
export function ausfuehren(db, name, argumente = {}, { heute = todayISO(), privat = false } = {}) {
  const w = werkzeug(name);
  if (!w) return { name, art: 'lesen', daten: { fehler: `Das Werkzeug „${text(name, 40)}“ gibt es nicht.` }, karte: null, text: '' };
  const a = argumente && typeof argumente === 'object' && !Array.isArray(argumente) ? argumente : {};
  try {
    return { name, art: w.art, ...w.ausfuehren(db, a, { heute, privat }) };
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
