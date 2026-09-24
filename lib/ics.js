/**
 * Kontovia – Kalenderdateien im iCalendar-Format (RFC 5545).
 *
 * Der Weg in jeden Kalender, auch ohne Google-Konto und in der Web-Fassung:
 * Eine .ics-Datei lässt sich in Google Kalender, Apple Kalender und Outlook
 * importieren – und umgekehrt aus ihnen nach Kontovia holen.
 *
 * Zeiten werden als „schwebende“ Ortszeit geschrieben (ohne Zeitzone): So
 * legt jedes Kalenderprogramm den Termin um 9 Uhr auch auf 9 Uhr, in der
 * Zeitzone, in der es selbst eingestellt ist.
 */

import { addDays } from './util.js';
import { fromRRule } from './gcal.js';

/* -------------------------------------------------------------------------- */
/* Schreiben                                                                   */
/* -------------------------------------------------------------------------- */

function escText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Zeilen über 75 Byte werden umbrochen; die Folgezeile beginnt mit einem Leerzeichen. */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const d8 = (iso) => String(iso).replace(/-/g, '');
const t6 = (hhmm) => String(hhmm || '00:00').replace(':', '') + '00';

function stampUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function rrule(a) {
  const r = a.recurrence || {};
  const base = { weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }[r.freq || 'none'];
  if (!base) {
    // Eine aus Google übernommene Regel, die Kontovia nicht abbildet, geht unverändert mit.
    const g = Array.isArray(r.google) ? r.google.find((l) => /^RRULE:/i.test(l)) : null;
    return g ? g.slice(6) : '';
  }
  if (!r.until) return base;
  return `${base};UNTIL=${a.allDay || !a.startTime ? d8(r.until) : d8(r.until) + 'T235959'}`;
}

/**
 * Termine als .ics-Text.
 * @param {object[]} appointments  Kontovia-Termine
 * @param {{derived?:object[], name?:string, now?:Date}} opts derived: Einträge aus Buchungen (gcal.derivedEntries)
 */
export function toIcs(appointments, { derived = [], name = 'Kontovia', now = new Date() } = {}) {
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kontovia//Buchhaltung//DE',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escText(name)}`,
  ];
  const stamp = stampUtc(now);
  const event = (uid, a, extra = []) => {
    L.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`);
    if (a.allDay || !a.startTime) {
      L.push(`DTSTART;VALUE=DATE:${d8(a.date)}`, `DTEND;VALUE=DATE:${d8(addDays(a.date, 1))}`);
    } else {
      let endDate = a.date;
      let end = a.endTime;
      if (!end) {
        const [h, m] = a.startTime.split(':').map(Number);
        const total = h * 60 + m + 60;
        end = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        if (total >= 1440) endDate = addDays(a.date, 1);
      } else if (end <= a.startTime) {
        endDate = addDays(a.date, 1);
      }
      L.push(`DTSTART:${d8(a.date)}T${t6(a.startTime)}`, `DTEND:${d8(endDate)}T${t6(end)}`);
    }
    L.push(`SUMMARY:${escText(a.title || '(ohne Titel)')}`);
    if (a.location) L.push(`LOCATION:${escText(a.location)}`);
    if (a.notes) L.push(`DESCRIPTION:${escText(a.notes)}`);
    L.push(...extra, 'END:VEVENT');
  };
  for (const a of appointments || []) {
    const rule = rrule(a);
    event(`${a.id}@kontovia`, a, rule ? [`RRULE:${rule}`] : []);
  }
  for (const d of derived || []) {
    event(`${d.id}@kontovia`, { title: d.title, date: d.date, allDay: true, location: d.location, notes: '' }, ['TRANSP:TRANSPARENT']);
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/* -------------------------------------------------------------------------- */
/* Lesen                                                                       */
/* -------------------------------------------------------------------------- */

function unescText(s) {
  return String(s ?? '').replace(/\\n/gi, '\n').replace(/\\([\\;,])/g, '$1');
}

/** "20260924", "20260924T090000", "20260924T070000Z" → {date, time?} in Ortszeit. */
function parseStamp(value, params) {
  const v = String(value || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  if (!m[4] || params.VALUE === 'DATE') return { date: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  }
  // Schwebende Zeit oder Zeit mit TZID: als Ortszeit übernehmen.
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/**
 * Liest die Termine einer .ics-Datei.
 * @returns {Array<{uid:string,title:string,location:string,notes:string,date:string,allDay:boolean,startTime:string,endTime:string,recurrence:object}>}
 */
export function parseIcs(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  let tiefe = 0; // VALARM und Co. innerhalb eines VEVENT überspringen
  for (const raw of lines) {
    if (!raw) continue;
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const head = raw.slice(0, i);
    const value = raw.slice(i + 1);
    const [nameRaw, ...paramList] = head.split(';');
    const name = nameRaw.toUpperCase();
    if (name === 'BEGIN') {
      if (value.toUpperCase() === 'VEVENT' && !cur) { cur = { props: {} }; tiefe = 0; } else if (cur) tiefe++;
      continue;
    }
    if (name === 'END') {
      if (cur && tiefe > 0) { tiefe--; continue; }
      if (cur && value.toUpperCase() === 'VEVENT') { out.push(cur.props); cur = null; }
      continue;
    }
    if (!cur || tiefe > 0) continue;
    const params = {};
    for (const p of paramList) {
      const [k, v] = p.split('=');
      if (k) params[k.toUpperCase()] = String(v || '').replace(/^"|"$/g, '').toUpperCase();
    }
    if (!(name in cur.props)) cur.props[name] = { value, params };
  }

  const events = [];
  for (const p of out) {
    if ((p.STATUS?.value || '').toUpperCase() === 'CANCELLED') continue;
    // Einzelne geänderte Vorkommen einer Serie kennt Kontovia nicht.
    if (p['RECURRENCE-ID']) continue;
    const start = parseStamp(p.DTSTART?.value, p.DTSTART?.params || {});
    if (!start) continue;
    const end = p.DTEND ? parseStamp(p.DTEND.value, p.DTEND.params || {}) : null;
    const allDay = !!start.allDay;
    events.push({
      uid: String(p.UID?.value || `${start.date}-${p.SUMMARY?.value || ''}`).slice(0, 300),
      title: unescText(p.SUMMARY?.value || '(ohne Titel)').slice(0, 300),
      location: unescText(p.LOCATION?.value || '').slice(0, 300),
      notes: unescText(p.DESCRIPTION?.value || '').slice(0, 4000),
      date: start.date,
      allDay,
      startTime: allDay ? '' : start.time,
      endTime: allDay || !end?.time ? '' : end.time,
      recurrence: p.RRULE ? fromRRule([`RRULE:${p.RRULE.value}`], start.date) : { freq: 'none', until: '' },
    });
  }
  return events;
}

/** Kurzer, stabiler Fingerabdruck (FNV-1a, 64 Bit) – für wiedererkennbare Kennungen. */
export function fingerprint(text) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(String(text))) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Welcher Termin in Kontovia zu einem importierten Ereignis gehört: ein aus
 * Kontovia stammender über seine eigene Kennung, alle anderen über einen
 * Fingerabdruck der UID. Ein zweiter Import derselben Datei legt deshalb
 * nichts doppelt an, sondern aktualisiert.
 */
export function appointmentIdForUid(uid) {
  const m = /^(apt_[0-9a-f]+|gcal_[A-Za-z0-9_-]+|ics_[0-9a-f]{16})@kontovia$/.exec(String(uid));
  return m ? m[1] : 'ics_' + fingerprint(uid);
}
