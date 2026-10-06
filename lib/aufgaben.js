/**
 * Kontovia – Rechnen und Ordnen rund um Aufgaben, ohne Bezug zur Oberfläche.
 *
 * Unteraufgaben, Verknüpfungen mit Buchungen, Kontakten und Rechnungen, der
 * frei wählbare Vorschauzeitraum. Alles bekommt den Bestand (`db`) übergeben,
 * damit scripts/check.js es ohne Oberfläche prüfen kann.
 */

import { addDays, addMonths, daysBetween, uid } from './util.js';
import { aufgabenHtml, klartext } from './richtext.js';

/* -------------------------------------------------------------------------- */
/* Unteraufgaben                                                               */
/* -------------------------------------------------------------------------- */

export function teilaufgaben(todo) {
  return Array.isArray(todo?.subtasks) ? todo.subtasks.filter((s) => s && s.id) : [];
}

export function neueTeilaufgabe(title = '') {
  return { id: uid('sub'), title: String(title).trim().slice(0, 300), done: false };
}

/** @returns {{fertig:number, gesamt:number}} */
export function fortschritt(todo) {
  const liste = teilaufgaben(todo);
  return { fertig: liste.filter((s) => s.done).length, gesamt: liste.length };
}

/* -------------------------------------------------------------------------- */
/* Verknüpfungen                                                               */
/* -------------------------------------------------------------------------- */

export const VERKNUEPFUNG_ARTEN = {
  buchung: 'Buchung',
  kontakt: 'Kontakt',
  rechnung: 'Rechnung',
};

export function verknuepfungenRoh(todo) {
  return (Array.isArray(todo?.links) ? todo.links : [])
    .filter((l) => l && VERKNUEPFUNG_ARTEN[l.typ] && l.id);
}

const eurText = (cent) => `${(Number(cent || 0) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * Beschriftung eines Verknüpfungsziels. Fehlt das Ziel (gelöscht, oder auf
 * diesem Gerät noch nicht angekommen), gibt es `null`: Eine Aufgabe zeigt
 * dann nichts Totes an.
 */
export function zielBeschriftung(db, typ, id) {
  if (typ === 'buchung') {
    const t = (db.transactions || []).find((x) => x.id === id);
    return t ? { titel: t.description || 'Buchung', sub: `${t.date || ''} · ${eurText(t.gross)}` } : null;
  }
  if (typ === 'kontakt') {
    const c = (db.contacts || []).find((x) => x.id === id);
    return c ? { titel: c.name || 'Kontakt', sub: c.email || c.phone || '' } : null;
  }
  if (typ === 'rechnung') {
    const r = (db.invoices || []).find((x) => x.id === id);
    return r ? { titel: `${r.nummer || 'Entwurf'} · ${r.kaeufer?.name || r.gelesen?.verkaeufer || ''}`.replace(/ · $/, ''), sub: r.richtung === 'eingang' ? 'Eingang' : (r.status === 'ausgestellt' ? 'ausgestellt' : 'Entwurf') } : null;
  }
  return null;
}

/** Die Verknüpfungen einer Aufgabe, die es noch gibt. */
export function verknuepfungen(db, todo) {
  const out = [];
  for (const l of verknuepfungenRoh(todo)) {
    const b = zielBeschriftung(db, l.typ, l.id);
    if (b) out.push({ typ: l.typ, id: l.id, ...b });
  }
  return out;
}

/** Fügt eine Verknüpfung hinzu (ohne Doppelte). Gibt die neue Liste zurück. */
export function verknuepfungHinzu(todo, typ, id) {
  const liste = verknuepfungenRoh(todo);
  return liste.some((l) => l.typ === typ && l.id === id) ? liste : [...liste, { typ, id }];
}

/**
 * Alle Aufgaben zu einem Ziel: Termin (wie bisher über appointmentId), Buchung,
 * Kontakt oder Rechnung.
 */
export function aufgabenZu(db, typ, id) {
  if (!id) return [];
  return (db.todos || []).filter((t) => (typ === 'termin'
    ? t.appointmentId === id
    : verknuepfungenRoh(t).some((l) => l.typ === typ && l.id === id)));
}

/* -------------------------------------------------------------------------- */
/* Zeitraum der Vorschau                                                       */
/* -------------------------------------------------------------------------- */

export const EINHEITEN = { tage: ['Tag', 'Tage', 365], wochen: ['Woche', 'Wochen', 104], monate: ['Monat', 'Monate', 24] };
export const HORIZONT_STANDARD = { n: 7, einheit: 'tage' };

/** Bringt eine Eingabe in eine gültige Form (ganze Zahl ab 1, bekannte Einheit). */
export function horizontNormal(h) {
  const einheit = EINHEITEN[h?.einheit] ? h.einheit : 'tage';
  const n = Math.round(Number(h?.n));
  if (!Number.isFinite(n) || n < 1) return { ...HORIZONT_STANDARD };
  return { n: Math.min(n, EINHEITEN[einheit][2]), einheit };
}

/** Letzter Tag des Zeitraums, gerechnet ab `heute`. */
export function horizontEnde(heute, h) {
  const { n, einheit } = horizontNormal(h);
  if (einheit === 'monate') return addMonths(heute, n);
  return addDays(heute, einheit === 'wochen' ? n * 7 : n);
}

/** „7 Tage“, „1 Monat“, „4 Wochen“. */
export function horizontText(h) {
  const { n, einheit } = horizontNormal(h);
  const [eins, viele] = EINHEITEN[einheit];
  return `${n} ${n === 1 ? eins : viele}`;
}

/** Überschrift der Gruppe: „Nächste 7 Tage“, „Nächster Monat“. */
export function horizontTitel(h) {
  const { n, einheit } = horizontNormal(h);
  if (n === 1) return einheit === 'tage' ? 'Nächster Tag' : einheit === 'wochen' ? 'Nächste Woche' : 'Nächster Monat';
  return `Nächste ${horizontText({ n, einheit })}`;
}

/* -------------------------------------------------------------------------- */
/* Art der Aufgabe: einfach, Ziel mit Fortschritt, Wiederholung                */
/* -------------------------------------------------------------------------- */

export const ARTEN = { einfach: 'Aufgabe', ziel: 'Ziel', wiederholend: 'Wiederholt sich' };

export function aufgabenArt(todo) {
  return todo?.art === 'ziel' || todo?.art === 'wiederholend' ? todo.art : 'einfach';
}

const zahl = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Menge eines Ziels in deutscher Schreibweise, höchstens eine Nachkommastelle. */
export function mengeText(n) {
  return zahl(n).toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

/**
 * Das Ziel einer Aufgabe in gültiger Form: Gesamtmenge ab 1, Stand ab 0, Beginn.
 * @returns {{gesamt:number, einheit:string, stand:number, start:string}}
 */
export function zielNormal(todo, heute) {
  const z = todo?.ziel || {};
  return {
    gesamt: Math.max(1, zahl(z.gesamt) || 1),
    einheit: String(z.einheit || '').trim().slice(0, 30),
    stand: Math.max(0, zahl(z.stand)),
    start: /^\d{4}-\d{2}-\d{2}$/.test(z.start || '') ? z.start : String(todo?.createdAt || heute).slice(0, 10),
  };
}

/**
 * Rechnet ein Ziel durch: Soll nach Plan, was heute noch zu schaffen ist, wie
 * schnell es bisher ging und wo man damit am Ende landet.
 * Der Tag des Fälligkeitsdatums zählt mit; „heute“ ist noch zu schaffen.
 */
export function zielRechnung(todo, heute) {
  const z = zielNormal(todo, heute);
  const ende = todo?.dueDate || '';
  const rest = Math.max(0, z.gesamt - z.stand);
  const anteil = Math.min(1, z.stand / z.gesamt);
  if (!ende) return { ...z, ende, rest, anteil, status: z.stand >= z.gesamt ? 'geschafft' : 'ohneDatum' };
  const gesamtTage = Math.max(1, daysBetween(z.start, ende) + 1);
  const vergangen = Math.min(gesamtTage, Math.max(0, daysBetween(z.start, heute)));
  const tageUebrig = Math.max(0, daysBetween(heute, ende) + 1);
  const planProTag = z.gesamt / gesamtTage;
  const soll = planProTag * vergangen;
  const tempo = vergangen > 0 ? z.stand / vergangen : null;
  let status;
  if (z.stand >= z.gesamt) status = 'geschafft';
  else if (tageUebrig === 0) status = 'verfehlt';
  else status = z.stand + 1e-9 >= soll ? 'imPlan' : 'hinten';
  return {
    ...z, ende, rest, anteil, status, gesamtTage, vergangen, tageUebrig, planProTag, soll,
    vorsprung: z.stand - soll,
    nochProTag: tageUebrig ? rest / tageUebrig : rest,
    tempo,
    prognose: tempo === null ? null : Math.min(z.gesamt * 10, tempo * gesamtTage),
  };
}

/**
 * Wann das Ziel beim bisherigen Tempo erreicht ist und wie viele Tage das nach
 * der Frist liegt. Heute zählt als erster Tag. Null ohne Frist, ohne Tempo
 * oder wenn schon entschieden ist (geschafft, Frist vorbei).
 * @returns {{fertig:string, verzug:number}|null}
 */
export function zielPrognose(todo, heute) {
  const r = zielRechnung(todo, heute);
  if (!r.tempo || r.status === 'geschafft' || r.status === 'verfehlt' || r.status === 'ohneDatum') return null;
  const tage = Math.min(3650, Math.max(1, Math.ceil(r.rest / r.tempo - 1e-9)));
  const fertig = addDays(heute, tage - 1);
  return { fertig, verzug: Math.max(0, daysBetween(r.ende, fertig)) };
}

/** Was nach dem Stand noch zu sagen ist: wie viel fehlt und was pro Tag nötig ist. */
export function zielRest(todo, heute) {
  const r = zielRechnung(todo, heute);
  const e = r.einheit ? ` ${r.einheit}` : '';
  if (r.status === 'geschafft') return 'geschafft';
  if (r.status === 'ohneDatum') return `noch ${mengeText(r.rest)}${e}`;
  if (r.status === 'verfehlt') return `Frist vorbei, es fehlen ${mengeText(r.rest)}${e}`;
  const tage = `${r.tageUebrig} ${r.tageUebrig === 1 ? 'Tag' : 'Tagen'}`;
  return `noch ${mengeText(r.rest)}${e} in ${tage}: ${mengeText(r.nochProTag)}${e} pro Tag`;
}

/** Beschreibung des Standes in einem Satz, für Liste und Fenster. */
export function zielSatz(todo, heute) {
  const r = zielRechnung(todo, heute);
  const e = r.einheit ? ` ${r.einheit}` : '';
  return `${mengeText(r.stand)} von ${mengeText(r.gesamt)}${e}, ${zielRest(todo, heute)}`;
}

export const WIEDERHOLUNG_EINHEITEN = { daily: ['Tag', 'Tage'], weekly: ['Woche', 'Wochen'], monthly: ['Monat', 'Monate'], yearly: ['Jahr', 'Jahre'] };

export function wiederholungNormal(w) {
  const freq = WIEDERHOLUNG_EINHEITEN[w?.freq] ? w.freq : 'weekly';
  const n = Math.round(Number(w?.n));
  return { freq, n: Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 1 };
}

/** „jeden Tag“, „alle 2 Wochen“, „jeden Monat“. */
export function wiederholungText(w) {
  const { freq, n } = wiederholungNormal(w);
  if (n === 1) return { daily: 'jeden Tag', weekly: 'jede Woche', monthly: 'jeden Monat', yearly: 'jedes Jahr' }[freq];
  return `alle ${n} ${WIEDERHOLUNG_EINHEITEN[freq][1]}`;
}

function einenSchritt(iso, { freq, n }) {
  if (freq === 'daily') return addDays(iso, n);
  if (freq === 'weekly') return addDays(iso, 7 * n);
  return addMonths(iso, freq === 'yearly' ? 12 * n : n);
}

/**
 * Der nächste Fälligkeitstag nach dem Abhaken: vom bisherigen Datum aus in
 * Schritten, bis er nach heute liegt. Wer zu spät abhakt, bekommt nicht eine
 * Reihe längst vergangener Termine, und wer früh abhakt, behält den Rhythmus.
 */
export function naechsteFaelligkeit(todo, heute) {
  const w = wiederholungNormal(todo?.wiederholung);
  let tag = todo?.dueDate || heute;
  let i = 0;
  do tag = einenSchritt(tag, w); while (tag <= heute && ++i < 4000);
  return tag;
}

/* -------------------------------------------------------------------------- */
/* Suche                                                                       */
/* -------------------------------------------------------------------------- */

/** Alles, was zu einer Aufgabe durchsucht werden soll, als ein Text. */
export function aufgabenText(todo) {
  return [
    todo.title,
    klartext(aufgabenHtml(todo)),
    teilaufgaben(todo).map((s) => s.title).join(' '),
  ].filter(Boolean).join(' ');
}
