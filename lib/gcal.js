/**
 * Kontovia – Abgleich der Termine mit Google Kalender: die reine Logik.
 *
 * Kontovia legt im Google-Konto einen eigenen Kalender „Kontovia“ an und
 * gleicht mit genau diesem ab – in beide Richtungen. Auf die übrigen Kalender
 * des Kontos hat Kontovia keinen Zugriff (Bereich calendar.app.created). Wer
 * einen Termin in Google im Kalender „Kontovia“ anlegt, ändert oder löscht,
 * findet das beim nächsten Abgleich in Kontovia wieder, und umgekehrt.
 *
 * Diese Datei kennt weder Netz noch Oberfläche; sie bekommt beide Stände und
 * sagt, was zu tun ist. So lässt sich jede Regel in scripts/check.js prüfen.
 *
 * Die Zuordnung Termin ↔ Google-Ereignis braucht keine Tabelle: Die Kennung
 * des Ereignisses wird aus der Kennung des Termins berechnet und umgekehrt.
 * Zwei Geräte, die denselben Termin gleichzeitig übertragen, erzeugen deshalb
 * kein Doppel – das zweite trifft auf dieselbe Kennung.
 *
 * Wer wann was zuletzt gesehen hat, merkt sich jedes Gerät für sich
 * (`map`: Ereigniskennung → {updated, localAt} bzw. {updated, hash}).
 * Damit lässt sich unterscheiden, auf welcher Seite sich etwas geändert hat.
 */

import { addDays, addMonths, toISO } from './util.js';
import { depositInfo } from './calc.js';

export const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

/* -------------------------------------------------------------------------- */
/* Kennungen                                                                   */
/* -------------------------------------------------------------------------- */

/* Google erlaubt eigene Ereigniskennungen aus Ziffern und den Buchstaben a–v
   (base32hex), 5 bis 1024 Zeichen. Hexadezimal passt da hinein. */

function hex(text) {
  return Array.from(new TextEncoder().encode(String(text)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(h) {
  try {
    const bytes = new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Ereigniskennung zu einem Termin. */
export function eventIdFor(apptId) {
  const id = String(apptId);
  if (id.startsWith('gcal_')) return id.slice(5);
  return 'kv' + hex(id);
}

/** Terminkennung zu einem Ereignis – das Gegenstück zu eventIdFor. */
export function apptIdFor(eventId) {
  const e = String(eventId);
  if (/^kv(?:[0-9a-f]{2})+$/.test(e)) {
    const id = unhex(e.slice(2));
    if (id && /^[\w-]{3,80}$/.test(id)) return id;
  }
  return 'gcal_' + e;
}

/** Kennung für Einträge, die aus Buchungen entstehen (Veranstaltung, Zahlung). */
export function derivedEventId(quelle, txId) {
  return 'kd' + (quelle === 'zahlung' ? '1' : '0') + hex(txId);
}

/* -------------------------------------------------------------------------- */
/* Zeiten                                                                      */
/* -------------------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/** "HH:MM" plus Minuten; liefert die neue Uhrzeit und ob ein Tag dazukam. */
function plusMinutes(time, minutes) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const total = (h || 0) * 60 + (m || 0) + minutes;
  return { time: `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`, days: Math.floor(total / 1440) };
}

/** Ende eines Termins: ohne Endzeit eine Stunde nach Beginn, vor Beginn heißt „am Folgetag“. */
function endOf(a) {
  if (!a.endTime) {
    const p = plusMinutes(a.startTime, 60);
    return { date: addDays(a.date, p.days), time: p.time };
  }
  if (a.endTime <= a.startTime) return { date: addDays(a.date, 1), time: a.endTime };
  return { date: a.date, time: a.endTime };
}

function localParts(dateTime) {
  const d = new Date(dateTime);
  return { date: toISO(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/* -------------------------------------------------------------------------- */
/* Wiederholungen                                                              */
/* -------------------------------------------------------------------------- */

const FREQ_RULE = { weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' };

/** Kontovias Wiederholung als RRULE für Google. */
export function toRRule(a) {
  const r = a.recurrence || {};
  const freq = r.freq || 'none';
  // Eine Regel aus Google, die Kontovia nicht abbilden kann, geht unverändert zurück.
  if (freq === 'none') return Array.isArray(r.google) ? r.google : [];
  let rule = FREQ_RULE[freq];
  if (!rule) return [];
  if (r.until) {
    const d = r.until.replace(/-/g, '');
    rule += `;UNTIL=${a.allDay || !a.startTime ? d : d + 'T235959Z'}`;
  }
  return ['RRULE:' + rule];
}

const WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Google-Wiederholung in Kontovias Form. Was sich nicht abbilden lässt
 * (täglich, mehrere Wochentage, Ausnahmen …), bleibt als Regel erhalten und
 * geht beim Zurückschreiben unverändert mit; im Kontovia-Kalender erscheint
 * dann nur der erste Termin der Reihe.
 */
export function fromRRule(list, startDate) {
  const lines = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!lines.length) return { freq: 'none', until: '' };
  const keep = { freq: 'none', until: '', google: lines };
  if (lines.length !== 1 || !/^RRULE:/i.test(lines[0])) return keep;
  const p = {};
  for (const part of lines[0].slice(6).split(';')) {
    const [k, v] = part.split('=');
    if (k) p[k.toUpperCase()] = String(v || '').toUpperCase();
  }
  const interval = Number(p.INTERVAL || 1);
  const start = new Date(`${startDate}T12:00:00`);
  const allowed = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'WKST', 'BYDAY', 'BYMONTHDAY', 'BYMONTH']);
  if (Object.keys(p).some((k) => !allowed.has(k))) return keep;
  if (p.BYDAY && p.BYDAY !== WEEKDAY[start.getDay()]) return keep;
  if (p.BYMONTHDAY && Number(p.BYMONTHDAY) !== start.getDate()) return keep;
  if (p.BYMONTH && Number(p.BYMONTH) !== start.getMonth() + 1) return keep;

  let freq = null;
  if (p.FREQ === 'WEEKLY' && interval === 1) freq = 'weekly';
  else if (p.FREQ === 'WEEKLY' && interval === 2) freq = 'biweekly';
  else if (p.FREQ === 'MONTHLY' && interval === 1 && !p.BYDAY) freq = 'monthly';
  else if (p.FREQ === 'YEARLY' && interval === 1 && !p.BYDAY) freq = 'yearly';
  if (!freq) return keep;

  let until = '';
  if (p.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(p.UNTIL);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  } else if (p.COUNT) {
    // „n-mal“ gibt es in Kontovia nicht – das letzte Datum der Reihe tut es auch.
    const n = Math.max(1, Number(p.COUNT) || 1) - 1;
    until = freq === 'weekly' ? addDays(startDate, 7 * n)
      : freq === 'biweekly' ? addDays(startDate, 14 * n)
        : freq === 'monthly' ? addMonths(startDate, n)
          : addMonths(startDate, 12 * n);
  }
  return { freq, until };
}

/* -------------------------------------------------------------------------- */
/* Umwandlung                                                                  */
/* -------------------------------------------------------------------------- */

/** Beschreibungen aus dem Google-Kalender enthalten oft HTML – hier wird Text daraus. */
export function plainText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Ein Termin als Google-Ereignis. Die jeweils nicht benutzte Zeitangabe wird
 * ausdrücklich geleert: Beim Ändern führt Google sonst ganztägig und
 * uhrzeitgebunden zusammen und lehnt das Ergebnis ab.
 */
export function toGoogle(a, { timeZone = 'Europe/Berlin', sendNotes = true } = {}) {
  const body = {
    summary: a.title || '(ohne Titel)',
    location: a.location || '',
    recurrence: toRRule(a),
    status: 'confirmed',
    extendedProperties: { private: { kontoviaId: a.id, kontoviaQuelle: 'termin' } },
  };
  if (sendNotes) body.description = a.notes || '';
  if (a.allDay || !a.startTime) {
    body.start = { date: a.date, dateTime: null, timeZone: null };
    body.end = { date: addDays(a.date, 1), dateTime: null, timeZone: null };
  } else {
    const e = endOf(a);
    body.start = { dateTime: `${a.date}T${a.startTime}:00`, timeZone, date: null };
    body.end = { dateTime: `${e.date}T${e.time}:00`, timeZone, date: null };
  }
  return body;
}

/** Die Felder eines Google-Ereignisses, die ein Kontovia-Termin kennt. */
export function fromGoogle(ev, { sendNotes = true } = {}) {
  const out = { title: ev.summary || '(ohne Titel)', location: ev.location || '' };
  if (sendNotes) out.notes = plainText(ev.description);
  if (ev.start?.date) {
    Object.assign(out, { allDay: true, date: ev.start.date, startTime: '', endTime: '' });
  } else {
    const s = localParts(ev.start?.dateTime || Date.now());
    const e = ev.end?.dateTime ? localParts(ev.end.dateTime) : null;
    Object.assign(out, { allDay: false, date: s.date, startTime: s.time, endTime: e ? e.time : '' });
  }
  out.recurrence = fromRRule(ev.recurrence, out.date);
  return out;
}

/** Vergleichbare Fassung eines Termins – egal, ob aus Kontovia oder aus Google. */
function comparable(x, sendNotes) {
  const allDay = !!x.allDay || !x.startTime;
  return JSON.stringify({
    title: x.title || '(ohne Titel)',
    date: x.date,
    allDay,
    start: allDay ? '' : x.startTime,
    end: allDay ? '' : endOf(x).time,
    location: x.location || '',
    notes: sendNotes ? String(x.notes || '').trim() : '',
    freq: x.recurrence?.freq || 'none',
    until: (x.recurrence?.freq || 'none') === 'none' ? '' : (x.recurrence?.until || ''),
  });
}

export function sameContent(appt, ev, sendNotes = true) {
  return comparable(appt, sendNotes) === comparable(fromGoogle(ev, { sendNotes }), sendNotes);
}

/* -------------------------------------------------------------------------- */
/* Einträge aus Buchungen                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Veranstaltungstermine aus Anzahlungen und – auf Wunsch – Fälligkeiten
 * offener Rechnungen. Sie gehen nur in eine Richtung: Kontovia pflegt sie
 * aus der Buchung. Beträge gehen bewusst nicht mit – im Google-Kalender
 * steht, was ansteht, nicht was es kostet.
 */
export function derivedEntries(db, { events = true, due = false } = {}) {
  const out = [];
  for (const t of db?.transactions || []) {
    if (t.voided) continue;
    if (events) {
      const dep = depositInfo(t);
      if (dep?.eventDate) {
        out.push({
          id: derivedEventId('veranstaltung', t.id), quelle: 'veranstaltung', txId: t.id,
          title: t.description + (t.location ? ` · ${t.location}` : ''), date: dep.eventDate, location: t.location || '',
        });
      }
    }
    if (due && !t.paidDate && (t.dueDate || t.date)) {
      out.push({
        id: derivedEventId('zahlung', t.id), quelle: 'zahlung', txId: t.id,
        title: `${t.type === 'income' ? 'Zahlungseingang erwartet' : 'Zahlung fällig'}: ${t.description}`,
        date: t.dueDate || t.date, location: '',
      });
    }
  }
  return out;
}

export function derivedHash(d) {
  return JSON.stringify([d.title, d.date, d.location]);
}

export function derivedBody(d) {
  return {
    summary: d.title,
    location: d.location || '',
    description: d.quelle === 'zahlung'
      ? 'Aus Kontovia: Fälligkeit einer offenen Rechnung. Wird aus der Buchung gepflegt.'
      : 'Aus Kontovia: Termin der Veranstaltung zu einer Anzahlung. Wird aus der Buchung gepflegt.',
    start: { date: d.date, dateTime: null, timeZone: null },
    end: { date: addDays(d.date, 1), dateTime: null, timeZone: null },
    transparency: 'transparent',
    status: 'confirmed',
    extendedProperties: { private: { kontoviaQuelle: d.quelle, kontoviaTx: d.txId } },
  };
}

function derivedMatches(ev, d) {
  return (ev.summary || '') === d.title && ev.start?.date === d.date && (ev.location || '') === (d.location || '');
}

/* -------------------------------------------------------------------------- */
/* Abgleich planen                                                             */
/* -------------------------------------------------------------------------- */

const stamp = (a) => String(a.updatedAt || a.createdAt || '');

/**
 * Vergleicht beide Seiten und sagt, was zu tun ist.
 *
 * Regeln je Termin:
 *   nur in Kontovia geändert       → nach Google
 *   nur in Google geändert         → nach Kontovia
 *   auf beiden Seiten geändert     → die jüngere Fassung gewinnt
 *   in Google gelöscht, hier unverändert → auch hier gelöscht
 *   in Google gelöscht, hier geändert    → kommt in Google zurück
 *   in Kontovia gelöscht           → in Google gelöscht
 *   neu in Google                  → neuer Termin in Kontovia
 *
 * @returns {{ops:Array, upserts:Array, removals:string[], links:object}}
 *   ops      Aufträge an Google: insert | patch | delete
 *   upserts  Termine, die hier neu entstehen oder sich ändern
 *   removals Termine, die hier wegfallen
 *   links    Merkzettel-Einträge, die unverändert gelten
 */
export function planSync({
  appointments = [], tombstones = [], events = [], map = {}, derived = [],
  timeZone = 'Europe/Berlin', sendNotes = true, now = new Date().toISOString(),
}) {
  const ops = [];
  const upserts = [];
  const removals = [];
  const links = {};
  // Einzelne geänderte Vorkommen einer Serie führt Google als eigene
  // Ereignisse; Kontovia kennt keine Ausnahmen und lässt sie aus.
  const list = events.filter((e) => !e.recurringEventId);
  const byId = new Map(list.map((e) => [e.id, e]));
  const begraben = new Set(tombstones.filter((t) => t.collection === 'appointments').map((t) => t.id));
  const seen = new Set();
  const opts = { timeZone, sendNotes };

  const push = (kind, a) => ops.push({ kind, eventId: eventIdFor(a.id), apptId: a.id, localAt: stamp(a), body: { ...toGoogle(a, opts), ...(kind === 'insert' ? { id: eventIdFor(a.id) } : {}) } });
  const takeRemote = (a, ev) => upserts.push({ ...a, ...fromGoogle(ev, { sendNotes }), updatedAt: now, _remoteUpdated: ev.updated });

  for (const a of appointments) {
    const eid = eventIdFor(a.id);
    seen.add(eid);
    const ev = byId.get(eid);
    const m = map[eid];
    const lokalGeaendert = !m || stamp(a) !== m.localAt;

    if (!ev || ev.status === 'cancelled') {
      // In Google gelöscht und hier seither nicht angefasst: auch hier weg.
      if (m && !lokalGeaendert) removals.push(a.id);
      else push(ev ? 'patch' : 'insert', a);
      continue;
    }

    const fernGeaendert = !m || ev.updated !== m.updated;
    if (!m) {
      // Beide Seiten kennen den Termin, dieses Gerät hat aber noch nie
      // abgeglichen – etwa weil ein anderes Gerät ihn übertragen hat.
      if (sameContent(a, ev, sendNotes)) links[eid] = { updated: ev.updated, localAt: stamp(a) };
      else if (stamp(a) > String(ev.updated || '')) push('patch', a);
      else takeRemote(a, ev);
      continue;
    }
    if (lokalGeaendert && fernGeaendert) {
      if (stamp(a) >= String(ev.updated || '')) push('patch', a);
      else takeRemote(a, ev);
    } else if (lokalGeaendert) {
      push('patch', a);
    } else if (fernGeaendert) {
      // Nur die Farbe oder eine Erinnerung in Google geändert: nichts zu übernehmen.
      if (sameContent(a, ev, sendNotes)) links[eid] = { updated: ev.updated, localAt: stamp(a) };
      else takeRemote(a, ev);
    } else {
      links[eid] = m;
    }
  }

  for (const ev of list) {
    if (seen.has(ev.id) || ev.status === 'cancelled') continue;
    const quelle = ev.extendedProperties?.private?.kontoviaQuelle;
    if (quelle === 'veranstaltung' || quelle === 'zahlung') continue;
    const aid = apptIdFor(ev.id);
    // In Kontovia gelöscht (Grabstein) oder schon einmal abgeglichen und hier
    // nicht mehr vorhanden: in Google ebenfalls löschen.
    if (begraben.has(aid) || map[ev.id]) {
      ops.push({ kind: 'delete', eventId: ev.id, apptId: aid });
      continue;
    }
    upserts.push({
      id: aid,
      ...fromGoogle(ev, { sendNotes: true }),
      contactId: '', color: '', done: false, transactionIds: [], reminderMinutes: 0,
      createdAt: ev.created || now, updatedAt: now, _remoteUpdated: ev.updated,
    });
  }

  /* Einträge aus Buchungen: Kontovia pflegt sie, Google zeigt sie an. Wer
     einen davon in Google löscht oder ändert, dem wird das nicht bei jedem
     Abgleich überschrieben – erst wieder, wenn sich die Buchung ändert. */
  const gewollt = new Set(derived.map((d) => d.id));
  for (const d of derived) {
    const ev = byId.get(d.id);
    const m = map[d.id];
    const h = derivedHash(d);
    if (m && m.hash === h) { links[d.id] = { ...m, updated: ev?.updated || m.updated }; continue; }
    if (ev && ev.status !== 'cancelled' && derivedMatches(ev, d)) { links[d.id] = { updated: ev.updated, hash: h }; continue; }
    ops.push({
      kind: ev ? 'patch' : 'insert', eventId: d.id, hash: h, derived: true,
      body: { ...derivedBody(d), ...(ev ? {} : { id: d.id }) },
    });
  }
  for (const ev of list) {
    const quelle = ev.extendedProperties?.private?.kontoviaQuelle;
    if ((quelle === 'veranstaltung' || quelle === 'zahlung') && !gewollt.has(ev.id) && ev.status !== 'cancelled') {
      ops.push({ kind: 'delete', eventId: ev.id, derived: true });
    }
  }

  return { ops, upserts, removals, links };
}
