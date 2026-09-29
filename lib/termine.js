/**
 * Kontovia – Wiederholungen von Terminen auflösen.
 *
 * Ohne Bezug zur Oberfläche, damit Kalender, Aufgaben und scripts/check.js
 * dieselbe Rechnung verwenden.
 */

import { addDays, addMonths } from './util.js';

/**
 * Alle Vorkommen der Termine zwischen `from` und `to` (einschließlich).
 *
 * Monatliche und jährliche Serien werden jedes Mal vom ersten Termin aus
 * gerechnet, nicht vom vorigen Vorkommen: Ein Termin am 31. fällt im Februar
 * auf den 28. und im März wieder auf den 31. Bis Fassung 1.7.0 blieb er ab
 * Februar für immer auf dem 28.
 *
 * @returns {Array<object>} Kopien der Termine mit `occurrence` (Datum) und `isRepeat`
 */
export function expandAppointments(appts, from, to) {
  const out = [];
  for (const a of appts) {
    const freq = a.recurrence?.freq || 'none';
    if (freq === 'none') {
      if (a.date >= from && a.date <= to) out.push({ ...a, occurrence: a.date });
      continue;
    }
    const naechstes = {
      weekly: (n) => addDays(a.date, 7 * n),
      biweekly: (n) => addDays(a.date, 14 * n),
      monthly: (n) => addMonths(a.date, n),
      yearly: (n) => addMonths(a.date, 12 * n),
    }[freq];
    if (!naechstes) {
      if (a.date >= from && a.date <= to) out.push({ ...a, occurrence: a.date });
      continue;
    }
    const until = a.recurrence?.until || to;
    for (let n = 0, d = a.date; d <= to && d <= until && n < 1200; d = naechstes(++n)) {
      if (d >= from) out.push({ ...a, occurrence: d, isRepeat: n > 0 });
    }
  }
  return out;
}
