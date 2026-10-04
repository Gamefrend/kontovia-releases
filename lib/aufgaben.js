/**
 * Kontovia – Rechnen und Ordnen rund um Aufgaben, ohne Bezug zur Oberfläche.
 *
 * Unteraufgaben, Verknüpfungen mit Buchungen, Kontakten und Rechnungen, der
 * frei wählbare Vorschauzeitraum. Alles bekommt den Bestand (`db`) übergeben,
 * damit scripts/check.js es ohne Oberfläche prüfen kann.
 */

import { addDays, addMonths, uid } from './util.js';
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
