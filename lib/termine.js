/**
 * Kontovia – Wiederholungen von Terminen auflösen, mehrtägige Termine, Regeln.
 *
 * Ohne Bezug zur Oberfläche, damit Kalender, Aufgaben, Kalenderdateien,
 * Google-Abgleich und scripts/check.js dieselbe Rechnung verwenden.
 *
 * Eine Wiederholung ist `recurrence`:
 *   freq      none | daily | weekly | biweekly | monthly | yearly
 *   interval  Abstand (2 = jeden zweiten Tag, jede zweite Woche …), fehlt: 1
 *   byDay     nur wöchentlich: Wochentage als MO, TU, WE, TH, FR, SA, SU
 *   until     letztes Datum (ISO) oder leer
 *   google    eine Regel aus Google oder einer Kalenderdatei, die Kontovia nicht
 *             abbildet; sie geht beim Zurückschreiben unverändert mit
 * `biweekly` bleibt aus alten Tresoren erhalten und heißt dasselbe wie
 * weekly mit interval 2.
 *
 * Ein Termin über mehrere Tage trägt `endDate` (ISO, nach `date`). Beim
 * Auflösen entsteht je Tag ein Eintrag mit `spanIndex`, `spanLength`,
 * `spanStart` und `spanEnd`, damit ihn der Monat an jedem Tag zeigt.
 */

import { addDays, addMonths, fromISO, toISO } from './util.js';

export const WOCHENTAGE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Wochentag eines ISO-Datums als MO … SU. */
export function wochentag(iso) {
  return WOCHENTAGE[(fromISO(iso).getDay() + 6) % 7];
}

/** Abstand einer Wiederholung, mindestens 1. */
export function intervall(r) {
  if (r?.freq === 'biweekly') return 2;
  const n = Number(r?.interval);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Wochentage einer wöchentlichen Regel, bereinigt und in Wochenreihenfolge. */
export function wochentage(r) {
  if (!Array.isArray(r?.byDay)) return [];
  const set = new Set(r.byDay.map((d) => String(d).toUpperCase()).filter((d) => WOCHENTAGE.includes(d)));
  return WOCHENTAGE.filter((d) => set.has(d));
}

/** Wiederholt sich der Termin (eigene Regel oder eine aus Google)? */
export function wiederholt(a) {
  const r = a?.recurrence || {};
  return (r.freq && r.freq !== 'none') || (Array.isArray(r.google) && r.google.length > 0);
}

/** Letzter Tag eines Termins (mehrtägig: endDate, sonst der Tag selbst). */
export function letzterTag(a) {
  return a.endDate && a.endDate > a.date ? a.endDate : a.date;
}

/** Zahl der Tage, die ein Termin belegt (mindestens 1). */
export function tageDauer(a) {
  return Math.max(1, Math.round((fromISO(letzterTag(a)) - fromISO(a.date)) / 86400000) + 1);
}

/** Anfänge der Vorkommen einer Serie ab dem ersten Termin, bis `bis` oder `until`. */
function anfaenge(a, bis) {
  const r = a.recurrence || {};
  const freq = r.freq || 'none';
  const until = r.until && r.until < bis ? r.until : bis;
  const out = [];
  if (freq === 'none' || !['daily', 'weekly', 'biweekly', 'monthly', 'yearly'].includes(freq)) {
    out.push(a.date);
    return out;
  }
  const n = intervall(r);
  const MAX = 2000;
  if (freq === 'daily') {
    for (let i = 0, d = a.date; d <= until && i < MAX; d = addDays(a.date, n * ++i)) out.push(d);
  } else if (freq === 'weekly' || freq === 'biweekly') {
    const schritt = n;
    const tage = wochentage(r);
    if (!tage.length || (tage.length === 1 && tage[0] === wochentag(a.date))) {
      for (let i = 0, d = a.date; d <= until && i < MAX; d = addDays(a.date, 7 * schritt * ++i)) out.push(d);
    } else {
      // Woche für Woche: der Montag der ersten Woche, dann jeder gewählte Tag ab dem ersten Termin.
      const montag = addDays(a.date, -WOCHENTAGE.indexOf(wochentag(a.date)));
      for (let w = 0; w < MAX; w++) {
        const basis = addDays(montag, 7 * schritt * w);
        if (basis > until) break;
        for (const t of tage) {
          const d = addDays(basis, WOCHENTAGE.indexOf(t));
          if (d >= a.date && d <= until) out.push(d);
        }
      }
    }
  } else if (freq === 'monthly') {
    for (let i = 0, d = a.date; d <= until && i < MAX; d = addMonths(a.date, n * ++i)) out.push(d);
  } else {
    for (let i = 0, d = a.date; d <= until && i < MAX; d = addMonths(a.date, 12 * n * ++i)) out.push(d);
  }
  return out;
}

/**
 * Alle Vorkommen der Termine zwischen `from` und `to` (einschließlich).
 *
 * Monatliche und jährliche Serien werden jedes Mal vom ersten Termin aus
 * gerechnet, nicht vom vorigen Vorkommen: Ein Termin am 31. fällt im Februar
 * auf den 28. und im März wieder auf den 31. Bis Fassung 1.7.0 blieb er ab
 * Februar für immer auf dem 28.
 *
 * Mehrtägige Termine erscheinen an jedem Tag, den sie belegen (`spanIndex`
 * zählt ab 0, `spanLength` ist die Zahl der Tage). `occurrence` ist der
 * jeweilige Tag, `spanStart` der erste Tag des Vorkommens.
 *
 * @returns {Array<object>} Kopien der Termine mit `occurrence` (Datum) und `isRepeat`
 */
export function expandAppointments(appts, from, to) {
  const out = [];
  for (const a of appts) {
    if (!a?.date) continue;
    const dauer = tageDauer(a);
    const starts = anfaenge(a, to);
    starts.forEach((start, n) => {
      const ende = addDays(start, dauer - 1);
      if (ende < from || start > to) return;
      if (dauer === 1) {
        out.push({ ...a, occurrence: start, isRepeat: n > 0 });
        return;
      }
      for (let i = 0; i < dauer; i++) {
        const tag = addDays(start, i);
        if (tag < from || tag > to) continue;
        out.push({ ...a, occurrence: tag, isRepeat: n > 0, spanIndex: i, spanLength: dauer, spanStart: start, spanEnd: ende });
      }
    });
  }
  return out;
}

/**
 * Nur die ersten Tage der Vorkommen, für Listen: ein mehrtägiger Termin steht
 * einmal, mit `spanEnd`.
 */
export function expandForList(appts, from, to) {
  const alle = expandAppointments(appts, addDays(from, -400), to);
  return alle.filter((e) => (e.spanIndex === undefined || e.spanIndex === 0)
    && (e.spanEnd || e.occurrence) >= from && e.occurrence <= to);
}

/**
 * Das nächste Vorkommen eines Termins ab einem Tag (einschließlich), oder null.
 */
export function naechstesVorkommen(a, ab) {
  const liste = expandAppointments([a], ab, addDays(ab, 3700)).filter((e) => (e.spanIndex ?? 0) === 0);
  return liste[0] || null;
}

/* -------------------------------------------------------------------------- */
/* Regeln (RRULE nach RFC 5545) ohne UNTIL                                     */
/* -------------------------------------------------------------------------- */

/**
 * Der Kern einer Regel, etwa „FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE“, ohne
 * UNTIL: Google will das Ende mit Z, Kalenderdateien ohne. Leer, wenn der
 * Termin sich nicht wiederholt oder nur eine fremde Regel trägt.
 */
export function regelKern(a) {
  const r = a?.recurrence || {};
  const freq = r.freq || 'none';
  const FREQ = { daily: 'DAILY', weekly: 'WEEKLY', biweekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[freq];
  if (!FREQ) return '';
  let s = `FREQ=${FREQ}`;
  const n = intervall(r);
  if (n > 1) s += `;INTERVAL=${n}`;
  if (freq === 'weekly') {
    const tage = wochentage(r);
    if (tage.length && !(tage.length === 1 && a.date && tage[0] === wochentag(a.date))) s += `;BYDAY=${tage.join(',')}`;
  }
  return s;
}

/**
 * Eine RRULE (ohne „RRULE:“) in Kontovias Form. Liefert null, wenn sich die
 * Regel nicht abbilden lässt (Ausnahmen, mehrere Monatstage, Position im
 * Monat wie „zweiter Dienstag“ …). UNTIL und COUNT werden zum Enddatum.
 */
export function regelLesen(rule, startDate) {
  const p = {};
  for (const part of String(rule || '').replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = part.split('=');
    if (k) p[k.toUpperCase()] = String(v || '').toUpperCase();
  }
  const erlaubt = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'WKST', 'BYDAY', 'BYMONTHDAY', 'BYMONTH']);
  if (Object.keys(p).some((k) => !erlaubt.has(k))) return null;
  const interval = Number(p.INTERVAL || 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
  const start = fromISO(startDate);
  const byDay = p.BYDAY ? p.BYDAY.split(',').map((d) => d.trim()) : [];
  // „2TU“ (zweiter Dienstag) kennt Kontovia nicht.
  if (byDay.some((d) => !WOCHENTAGE.includes(d))) return null;
  if (p.BYMONTHDAY && Number(p.BYMONTHDAY) !== start.getDate()) return null;
  if (p.BYMONTH && Number(p.BYMONTH) !== start.getMonth() + 1) return null;

  let r = null;
  if (p.FREQ === 'DAILY' && !byDay.length) r = { freq: 'daily', until: '', ...(interval > 1 ? { interval } : {}) };
  else if (p.FREQ === 'WEEKLY') {
    const tage = WOCHENTAGE.filter((d) => byDay.includes(d));
    const eigener = wochentag(startDate);
    const nurEigener = !tage.length || (tage.length === 1 && tage[0] === eigener);
    if (nurEigener && interval === 2) r = { freq: 'biweekly', until: '' };
    else r = { freq: 'weekly', until: '', ...(interval > 1 ? { interval } : {}), ...(nurEigener ? {} : { byDay: tage }) };
  } else if (p.FREQ === 'MONTHLY' && !byDay.length) r = { freq: 'monthly', until: '', ...(interval > 1 ? { interval } : {}) };
  else if (p.FREQ === 'YEARLY' && !byDay.length) r = { freq: 'yearly', until: '', ...(interval > 1 ? { interval } : {}) };
  if (!r) return null;

  if (p.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(p.UNTIL);
    if (m) r.until = `${m[1]}-${m[2]}-${m[3]}`;
  } else if (p.COUNT) {
    // „n-mal“ gibt es in Kontovia nicht; das letzte Datum der Reihe tut es auch.
    const n = Math.max(1, Number(p.COUNT) || 1);
    const liste = anfaenge({ date: startDate, recurrence: { ...r, until: '' } }, addDays(startDate, 36600));
    r.until = liste[Math.min(n, liste.length) - 1] || startDate;
  }
  return r;
}

/** Lesbarer Text einer Wiederholung, etwa „jede zweite Woche am Mo, Mi“. */
export function regelText(a, { tage = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] } = {}) {
  const r = a?.recurrence || {};
  const freq = r.freq || 'none';
  if (freq === 'none') return Array.isArray(r.google) && r.google.length ? 'nach eigener Regel' : 'einmalig';
  const n = intervall(r);
  const einheit = { daily: ['täglich', 'jeden zweiten Tag', 'alle {0} Tage'], weekly: ['wöchentlich', 'alle zwei Wochen', 'alle {0} Wochen'], biweekly: ['wöchentlich', 'alle zwei Wochen', 'alle {0} Wochen'], monthly: ['monatlich', 'alle zwei Monate', 'alle {0} Monate'], yearly: ['jährlich', 'alle zwei Jahre', 'alle {0} Jahre'] }[freq];
  let text = n === 1 ? einheit[0] : n === 2 ? einheit[1] : einheit[2].replace('{0}', String(n));
  const wt = wochentage(r);
  if (freq === 'weekly' && wt.length && !(wt.length === 1 && a.date && wt[0] === wochentag(a.date))) {
    text += ` am ${wt.map((d) => tage[WOCHENTAGE.indexOf(d)]).join(', ')}`;
  }
  return text;
}

/** Heute als ISO, aus einem Date (für Prüfungen mit festem Tag). */
export const tagVon = (d) => toISO(d);
