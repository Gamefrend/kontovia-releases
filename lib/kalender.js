/**
 * Kontovia – Kalender als Fachlogik: mehrere Kalender, Tags, Filter,
 * Schnelleingabe, Erinnerungszeitpunkte, Verschieben.
 *
 * Ohne Oberfläche und ohne Bestand, damit scripts/check.js jede Regel prüft.
 *
 * Kalender:
 *   Lokale Kalender stehen in den Einstellungen (`settings.kalender`:
 *   [{id, name, color}]) und gelten für alle Geräte. Der Standardkalender hat
 *   die Kennung '' (Termine ohne `calendarId`). Jeder Termin trägt höchstens
 *   einen lokalen Kalender (`calendarId`).
 *   Termine aus weiteren Google-Kalendern tragen `extern.calendarId`; in der
 *   Ansicht sind sie eigene Kalender mit dem Schlüssel „g:<calendarId>“. Mit dem
 *   Konto geteilte Kalender sind nur lesbar (`readOnly`): Kontovia zeigt sie an
 *   und schreibt nie hinein.
 *
 * Tags: `tags` ist eine Liste kurzer Wörter ohne Raute, klein geschrieben
 * wird nicht erzwungen, verglichen wird aber ohne Groß- und Kleinschreibung.
 */

import { addDays, addMonths, fromISO, toISO } from './util.js';
import { expandAppointments, tageDauer, WOCHENTAGE } from './termine.js';

/** Farben zur Auswahl für Kalender und Termine (Name, Wert). */
export const FARBEN = [
  ['Blau', '#2563eb'], ['Grün', '#16a34a'], ['Orange', '#ea580c'], ['Rot', '#dc2626'],
  ['Violett', '#7c3aed'], ['Rosa', '#db2777'], ['Türkis', '#0d9488'], ['Braun', '#92400e'],
  ['Grau', '#6b7280'], ['Gelb', '#ca8a04'],
];

export const STANDARD_KALENDER_NAME = 'Allgemein';

/** Schlüssel eines Termins in der Kalenderliste: lokaler Kalender oder „g:…“ für Google. */
export function kalenderSchluessel(a) {
  if (a?.extern?.calendarId) return 'g:' + a.extern.calendarId;
  return String(a?.calendarId || '');
}

/** Lokale Kalender aus den Einstellungen, bereinigt, der Standardkalender immer zuerst. */
export function lokaleKalender(settings) {
  const liste = Array.isArray(settings?.kalender) ? settings.kalender : [];
  const out = [{ id: '', name: settings?.kalenderStandardName || STANDARD_KALENDER_NAME, color: settings?.kalenderStandardFarbe || '' }];
  const gesehen = new Set(['']);
  for (const k of liste) {
    if (!k || typeof k.id !== 'string' || !k.id || gesehen.has(k.id)) continue;
    gesehen.add(k.id);
    out.push({ id: k.id, name: String(k.name || 'Kalender'), color: typeof k.color === 'string' ? k.color : '' });
  }
  return out;
}

/**
 * Farbe für einen Google-Kalender, den Google ohne Farbe liefert (oder dessen
 * Auswahl noch aus der Zeit vor den Farben stammt): immer dieselbe zur selben
 * Kennung, damit zwei geteilte Kalender nicht gleich aussehen.
 */
export function googleFarbe(id) {
  let h = 0;
  for (const c of String(id)) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return FARBEN[h % FARBEN.length][1];
}

/**
 * Alle Kalender der Ansicht: lokale und (abgeglichene oder noch vorhandene)
 * Google-Kalender, mit Zahl der Termine. `readOnly`: Der Kalender ist mit dem
 * Konto geteilt und nur lesbar; Kontovia zeigt ihn an, schreibt aber nie hinein.
 * @param {{settings:object, weitere?:Array<{id:string,name?:string,color?:string,readOnly?:boolean}>, appointments?:Array}} p
 * @returns {Array<{key:string, art:'lokal'|'google', id:string, name:string, color:string, readOnly:boolean, anzahl:number}>}
 */
export function kalenderListe({ settings, weitere = [], appointments = [] }) {
  const zaehler = new Map();
  for (const a of appointments) {
    const k = kalenderSchluessel(a);
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  const out = lokaleKalender(settings).map((k) => ({ key: k.id, art: 'lokal', id: k.id, name: k.name, color: k.color, readOnly: false, anzahl: zaehler.get(k.id) || 0 }));
  const google = new Map();
  for (const w of weitere) if (w?.id) google.set(w.id, { id: w.id, name: w.name || w.id, color: w.color || googleFarbe(w.id), readOnly: w.readOnly === true });
  // Termine aus einem nicht mehr abgeglichenen Google-Kalender bleiben sichtbar.
  for (const a of appointments) {
    const id = a?.extern?.calendarId;
    if (id && !google.has(id)) google.set(id, { id, name: a.extern.calendarName || 'weiterer Kalender', color: googleFarbe(id), readOnly: false });
  }
  for (const g of google.values()) {
    out.push({ key: 'g:' + g.id, art: 'google', id: g.id, name: g.name, color: g.color, readOnly: g.readOnly, anzahl: zaehler.get('g:' + g.id) || 0 });
  }
  return out;
}

/**
 * Gleicht die gewählten Google-Kalender mit der aktuellen Kalenderliste des
 * Kontos ab: Name, Farbe und Schreibschutz werden nachgeführt. Auf Wunsch
 * (`auto`) kommen Kalender, die jemand mit dem Konto geteilt hat, von selbst
 * dazu, und zwar nur lesend; abgewählte und die von Google gelieferten
 * Sammelkalender (Feiertage, Geburtstage) bleiben außen vor.
 * @param {{weitere?:Array, liste?:Array<{id:string,name:string,color?:string,readOnly?:boolean,geteilt?:boolean,sonder?:boolean,angezeigt?:boolean}>, auto?:boolean, abgewaehlt?:string[]}} p
 * @returns {{weitere:Array, neu:Array, geaendert:boolean}}
 */
export function geteilteAbgleichen({ weitere = [], liste = [], auto = false, abgewaehlt = [] }) {
  const aus = new Set(abgewaehlt);
  const bekannt = new Set(weitere.map((k) => k.id));
  const kern = (k) => JSON.stringify([k.id, k.name, k.color || '', k.readOnly === true]);
  let geaendert = false;
  const out = weitere.map((k) => {
    const n = liste.find((x) => x.id === k.id);
    if (!n) return k;
    // Schreibschutz kommt dazu, wenn Google die Rechte einschränkt; ein ausdrücklich nur lesend gewählter Kalender bleibt es.
    const neu = { id: k.id, name: n.name || k.name, color: n.color || k.color || '', ...(k.readOnly === true || n.readOnly === true ? { readOnly: true } : {}) };
    if (kern(neu) !== kern(k)) geaendert = true;
    return neu;
  });
  const neu = [];
  if (auto) {
    for (const n of liste) {
      if (bekannt.has(n.id) || aus.has(n.id) || !n.geteilt || n.sonder || n.angezeigt === false) continue;
      const k = { id: n.id, name: n.name || n.id, color: n.color || '', readOnly: true };
      out.push(k);
      neu.push(k);
      geaendert = true;
    }
  }
  return { weitere: out, neu, geaendert };
}

/** Farbe eines Termins: eigene Farbe, sonst die seines Kalenders, sonst leer. */
export function terminFarbe(a, kalender) {
  if (a?.color) return a.color;
  const key = kalenderSchluessel(a);
  return (kalender || []).find((k) => k.key === key)?.color || '';
}

/** Neue Kennung für einen lokalen Kalender. */
export function neueKalenderId(settings) {
  const ids = new Set(lokaleKalender(settings).map((k) => k.id));
  for (let i = 1; i < 1000; i++) if (!ids.has(`kal_${i}`)) return `kal_${i}`;
  return `kal_${Date.now()}`;
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

/** „#Kunde, steuer; Büro“ → ['Kunde', 'steuer', 'Büro'], ohne Doppel und Raute. */
export function tagsLesen(text) {
  const out = [];
  const gesehen = new Set();
  for (const roh of String(text || '').split(/[,;\s]+/)) {
    const t = roh.replace(/^#+/, '').trim().slice(0, 40);
    if (!t) continue;
    const k = t.toLowerCase();
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push(t);
  }
  return out.slice(0, 20);
}

/** Alle Tags der Termine mit Häufigkeit, die häufigsten zuerst. */
export function alleTags(appointments) {
  const z = new Map();
  for (const a of appointments || []) {
    for (const t of a.tags || []) {
      const k = String(t).toLowerCase();
      const e = z.get(k) || { tag: String(t), anzahl: 0 };
      e.anzahl++;
      z.set(k, e);
    }
  }
  return [...z.values()].sort((x, y) => y.anzahl - x.anzahl || x.tag.localeCompare(y.tag, 'de'));
}

function hatTag(a, tag) {
  const k = String(tag).toLowerCase();
  return (a.tags || []).some((t) => String(t).toLowerCase() === k);
}

/* -------------------------------------------------------------------------- */
/* Filter                                                                      */
/* -------------------------------------------------------------------------- */

/** Stammt der Termin aus einem weiteren Google-Kalender? Alles andere liegt in Kontovia (auch der Kalender „Kontovia“ bei Google). */
export const ausGoogle = (a) => !!a?.extern?.calendarId;

/** Passt die Herkunft eines Termins zur Wahl „Kontovia“, „Meine Termine“, „Google“? */
export function herkunftZeigen(a, herkunft = {}) {
  if (ausGoogle(a)) return herkunft.google !== false;
  return herkunft.kontovia !== false && herkunft.termine !== false;
}

/**
 * Passt ein Termin zum Filter?
 * @param {object} a  Termin (auch ein aufgelöstes Vorkommen)
 * @param {{kalenderAus?:Iterable<string>, nurKalender?:string|null, tags?:Iterable<string>, suche?:string, kontaktName?:Function}} f
 *   kalenderAus  ausgeblendete Kalender (Schlüssel)
 *   nurKalender  nur dieser Kalender (Reiter); null oder undefined: alle
 *   tags         mindestens einer dieser Tags muss vorkommen; leer: egal
 *   suche        Text in Titel, Ort, Notiz, Tags oder Kontaktname
 *   herkunft     { kontovia, termine, google } (jeweils false = ausblenden, fehlt = zeigen):
 *                kontovia  alles, was aus Kontovia stammt (aus: nur Google, „privat“)
 *                termine   die in Kontovia angelegten Termine
 *                google    Termine aus weiteren Google-Kalendern
 */
export function passtTermin(a, f = {}) {
  if (!herkunftZeigen(a, f.herkunft)) return false;
  const key = kalenderSchluessel(a);
  if (f.nurKalender !== null && f.nurKalender !== undefined && f.nurKalender !== key) return false;
  if (f.kalenderAus && [...f.kalenderAus].includes(key)) return false;
  const tags = f.tags ? [...f.tags] : [];
  if (tags.length && !tags.some((t) => hatTag(a, t))) return false;
  if (f.suche && !trefferText(a, f).includes(String(f.suche).toLowerCase().trim())) return false;
  return true;
}

function trefferText(a, f) {
  const kontakt = a.contactId && typeof f.kontaktName === 'function' ? f.kontaktName(a.contactId) : '';
  return [a.title, a.location, a.notes, ...(a.tags || []), kontakt].filter(Boolean).join(' ').toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Schnelleingabe                                                              */
/* -------------------------------------------------------------------------- */

const TAGE_KURZ = { mo: 0, di: 1, mi: 2, do: 3, fr: 4, sa: 5, so: 6, montag: 0, dienstag: 1, mittwoch: 2, donnerstag: 3, freitag: 4, samstag: 5, sonntag: 6 };
const ZEIT = /^(\d{1,2})(?::(\d{2}))?(?:\s*uhr)?$/i;
const SPANNE = /^(\d{1,2})(?::(\d{2}))?\s*(?:-|–|bis)\s*(\d{1,2})(?::(\d{2}))?(?:\s*uhr)?$/i;

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;

/**
 * „morgen 14:00 Steuerberater“, „Fr 9-10 Zahnarzt #privat“, „15.11. Messe
 * Köln“, „jeden Montag 8:00 Teambesprechung“, „3.–5.12. Fortbildung“.
 * Liefert, was sich lesen ließ; der Rest ist der Titel. Nichts wird gespeichert.
 *
 * @param {string} text
 * @param {{heute?:string}} [o]  heute als ISO-Datum (Prüfungen)
 * @returns {{title:string, date:string, endDate:string, allDay:boolean, startTime:string, endTime:string, tags:string[], recurrence:object, erkannt:string[]}}
 */
export function schnellEingabe(text, { heute = toISO(new Date()) } = {}) {
  const out = { title: '', date: heute, endDate: '', allDay: true, startTime: '', endTime: '', tags: [], recurrence: { freq: 'none', until: '' }, erkannt: [] };
  const woerter = String(text || '').trim().split(/\s+/).filter(Boolean);
  const rest = [];
  const jahr = Number(heute.slice(0, 4));
  let datumGesetzt = false;

  const datumAus = (d, m, y) => {
    const yy = y ? (y < 100 ? 2000 + y : y) : jahr;
    let iso = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (Number.isNaN(fromISO(iso).getTime()) || fromISO(iso).getDate() !== d) return null;
    // Ohne Jahr: ein Datum, das schon vorbei ist, meint das nächste Jahr.
    if (!y && iso < heute) iso = `${yy + 1}-${iso.slice(5)}`;
    return iso;
  };

  for (let i = 0; i < woerter.length; i++) {
    const w = woerter[i];
    const k = w.toLowerCase().replace(/[.,;]+$/, '');
    let m;
    if (w.startsWith('#') && w.length > 1) { out.tags.push(...tagsLesen(w)); out.erkannt.push('tag'); continue; }
    if (!datumGesetzt && (k === 'heute' || k === 'morgen' || k === 'übermorgen')) {
      out.date = addDays(heute, k === 'heute' ? 0 : k === 'morgen' ? 1 : 2);
      datumGesetzt = true; out.erkannt.push('datum'); continue;
    }
    if (!datumGesetzt && k in TAGE_KURZ && !(k === 'so' && i > 0)) {
      const ziel = TAGE_KURZ[k];
      const heutig = (fromISO(heute).getDay() + 6) % 7;
      let diff = (ziel - heutig + 7) % 7;
      if (diff === 0) diff = 7;
      out.date = addDays(heute, diff);
      datumGesetzt = true; out.erkannt.push('datum'); continue;
    }
    if ((k === 'jeden' || k === 'jede' || k === 'jedes') && woerter[i + 1]) {
      const n = woerter[i + 1].toLowerCase().replace(/[.,;]+$/, '');
      if (n in TAGE_KURZ) {
        out.recurrence = { freq: 'weekly', until: '', byDay: [WOCHENTAGE[TAGE_KURZ[n]]] };
        if (!datumGesetzt) {
          const heutig = (fromISO(heute).getDay() + 6) % 7;
          out.date = addDays(heute, (TAGE_KURZ[n] - heutig + 7) % 7);
          datumGesetzt = true;
        }
        i++; out.erkannt.push('wiederholung'); continue;
      }
      if (n === 'tag') { out.recurrence = { freq: 'daily', until: '' }; i++; out.erkannt.push('wiederholung'); continue; }
      if (n === 'woche') { out.recurrence = { freq: 'weekly', until: '' }; i++; out.erkannt.push('wiederholung'); continue; }
      if (n === 'monat') { out.recurrence = { freq: 'monthly', until: '' }; i++; out.erkannt.push('wiederholung'); continue; }
      if (n === 'jahr') { out.recurrence = { freq: 'yearly', until: '' }; i++; out.erkannt.push('wiederholung'); continue; }
    }
    if (k === 'täglich') { out.recurrence = { freq: 'daily', until: '' }; out.erkannt.push('wiederholung'); continue; }
    if (k === 'wöchentlich') { out.recurrence = { freq: 'weekly', until: '' }; out.erkannt.push('wiederholung'); continue; }
    if (k === 'monatlich') { out.recurrence = { freq: 'monthly', until: '' }; out.erkannt.push('wiederholung'); continue; }
    if (k === 'jährlich') { out.recurrence = { freq: 'yearly', until: '' }; out.erkannt.push('wiederholung'); continue; }
    if (k === 'werktags') { out.recurrence = { freq: 'weekly', until: '', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }; out.erkannt.push('wiederholung'); continue; }
    // 3.-5.12. oder 3.12.-5.12.
    if (!datumGesetzt && (m = /^(\d{1,2})\.(?:(\d{1,2})\.)?\s*(?:-|–|bis)\s*(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(w))) {
      const monat = Number(m[2] || m[4]);
      const von = datumAus(Number(m[1]), monat, m[5] ? Number(m[5]) : 0);
      const bis = datumAus(Number(m[3]), Number(m[4]), m[5] ? Number(m[5]) : 0);
      if (von && bis && bis >= von) { out.date = von; out.endDate = bis; datumGesetzt = true; out.erkannt.push('datum'); continue; }
    }
    if (!datumGesetzt && (m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(w))) {
      const iso = datumAus(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0);
      if (iso) { out.date = iso; datumGesetzt = true; out.erkannt.push('datum'); continue; }
    }
    if (!datumGesetzt && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w))) {
      out.date = w; datumGesetzt = true; out.erkannt.push('datum'); continue;
    }
    // 9-10, 14:00-15:30, 9 Uhr
    const mitUhr = woerter[i + 1]?.toLowerCase() === 'uhr';
    const zeitWort = mitUhr ? `${w} uhr` : w;
    if (!out.startTime && (m = SPANNE.exec(zeitWort)) && Number(m[1]) < 24 && Number(m[3]) < 24) {
      out.startTime = hhmm(m[1], m[2]); out.endTime = hhmm(m[3], m[4]); out.allDay = false;
      if (mitUhr) i++;
      out.erkannt.push('zeit'); continue;
    }
    if (!out.startTime && (m = ZEIT.exec(zeitWort)) && (m[2] || mitUhr || /uhr$/i.test(w)) && Number(m[1]) < 24) {
      out.startTime = hhmm(m[1], m[2]); out.allDay = false;
      if (mitUhr) i++;
      out.erkannt.push('zeit'); continue;
    }
    if (k === 'ganztägig' || k === 'ganztags') { out.allDay = true; out.startTime = ''; out.endTime = ''; out.erkannt.push('zeit'); continue; }
    rest.push(w);
  }
  if (out.startTime && !out.endTime) {
    const [h, mi] = out.startTime.split(':').map(Number);
    const t = h * 60 + mi + 60;
    out.endTime = t >= 1440 ? '23:59' : hhmm(Math.floor(t / 60), t % 60);
  }
  // „um“ und „am“ am Rand des Titels stören nur.
  while (rest.length && /^(um|am|von|ab)$/i.test(rest[rest.length - 1])) rest.pop();
  while (rest.length && /^(um|am)$/i.test(rest[0])) rest.shift();
  out.title = rest.join(' ').replace(/\s+/g, ' ').trim();
  return out;
}

/* -------------------------------------------------------------------------- */
/* Erinnerungen                                                                */
/* -------------------------------------------------------------------------- */

/** Erinnerungen vor einem Termin mit Uhrzeit, in Minuten. */
export const ERINNERUNG_ZEIT = [
  [0, 'keine'], [5, '5 Minuten vorher'], [10, '10 Minuten vorher'], [15, '15 Minuten vorher'], [30, '30 Minuten vorher'],
  [60, '1 Stunde vorher'], [120, '2 Stunden vorher'], [1440, '1 Tag vorher'], [2880, '2 Tage vorher'], [10080, '1 Woche vorher'],
];

/**
 * Erinnerungen für ganztägige Termine: gerechnet ab 0 Uhr des Tages, negativ
 * heißt nach Mitternacht (am Tag selbst um 8 Uhr: -480).
 */
export const ERINNERUNG_GANZTAGS = [
  [0, 'keine'], [-480, 'am Tag selbst um 8 Uhr'], [360, 'am Vortag um 18 Uhr'], [900, 'am Vortag um 9 Uhr'],
  [1440 * 7 - 540, 'eine Woche vorher um 9 Uhr'],
];

/** Zeitpunkt der Erinnerung für ein Vorkommen als Date (Ortszeit), oder null. */
export function erinnerungZeitpunkt(a, occurrence = a?.date) {
  const min = Number(a?.reminderMinutes || 0);
  if (!min || !occurrence) return null;
  const start = fromISO(occurrence);
  if (!a.allDay && a.startTime) {
    const [h, m] = a.startTime.split(':').map(Number);
    start.setHours(h || 0, m || 0, 0, 0);
  }
  return new Date(start.getTime() - min * 60000);
}

/** Lesbare Beschreibung der Erinnerung („30 Minuten vorher“). */
export function erinnerungText(a) {
  const min = Number(a?.reminderMinutes || 0);
  if (!min) return 'keine';
  const liste = a.allDay || !a.startTime ? ERINNERUNG_GANZTAGS : ERINNERUNG_ZEIT;
  return liste.find(([m]) => m === min)?.[1] || `${min} Minuten vorher`;
}

/**
 * Welche Erinnerungen zwischen `von` (ausschließlich) und `bis`
 * (einschließlich) fällig sind. Wiederholungen werden aufgelöst, erledigte
 * Termine ausgelassen.
 * @returns {Array<{key:string, id:string, occurrence:string, at:Date, title:string, termin:object}>}
 */
export function faelligeErinnerungen(appointments, { von, bis }) {
  const out = [];
  const tagVon = addDays(toISO(von), -1);
  const tagBis = addDays(toISO(bis), 8);
  const mit = (appointments || []).filter((a) => Number(a.reminderMinutes || 0) && !a.done);
  for (const e of expandAppointments(mit, tagVon, tagBis)) {
    if ((e.spanIndex ?? 0) !== 0) continue;
    const at = erinnerungZeitpunkt(e, e.occurrence);
    if (!at || at <= von || at > bis) continue;
    out.push({ key: `${e.id}|${e.occurrence}`, id: e.id, occurrence: e.occurrence, at, title: e.title || 'Termin', termin: e });
  }
  return out.sort((x, y) => x.at - y.at);
}

/* -------------------------------------------------------------------------- */
/* Verschieben                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Termin auf einen anderen Tag (und auf Wunsch eine andere Anfangszeit)
 * legen. Dauer und Zahl der Tage bleiben; die Wiederholung wandert mit.
 * `vonTag` ist der Tag des gezogenen Vorkommens: Bei einer Serie wird der
 * Abstand auf den ersten Termin übertragen.
 */
export function verschoben(a, { aufTag, startTime, vonTag = a.date }) {
  const diff = Math.round((fromISO(aufTag) - fromISO(vonTag)) / 86400000);
  const out = { ...a, date: addDays(a.date, diff) };
  if (a.endDate) out.endDate = addDays(a.endDate, diff);
  if (a.recurrence?.until) out.recurrence = { ...a.recurrence, until: addDays(a.recurrence.until, diff) };
  if (startTime && !a.allDay) {
    const [h1, m1] = (a.startTime || '00:00').split(':').map(Number);
    const [h2, m2] = startTime.split(':').map(Number);
    const dauer = a.endTime ? ((() => { const [eh, em] = a.endTime.split(':').map(Number); const d = (eh * 60 + em) - (h1 * 60 + m1); return d > 0 ? d : d + 1440; })()) : 60;
    const start = h2 * 60 + m2;
    const ende = start + dauer;
    out.startTime = startTime;
    out.endTime = ende >= 1440 ? `${String(Math.floor(ende / 60) % 24).padStart(2, '0')}:${String(ende % 60).padStart(2, '0')}` : `${String(Math.floor(ende / 60)).padStart(2, '0')}:${String(ende % 60).padStart(2, '0')}`;
  }
  return out;
}

/** Montag der Woche eines Tages. */
export function wochenStart(iso) {
  return addDays(iso, -((fromISO(iso).getDay() + 6) % 7));
}

/** Anfang und Ende des sichtbaren Bereichs je Darstellung. */
export function zeitraum(mode, cursor) {
  if (mode === 'day') return { from: cursor, to: cursor };
  if (mode === 'week') { const s = wochenStart(cursor); return { from: s, to: addDays(s, 6) }; }
  const first = cursor.slice(0, 8) + '01';
  const start = wochenStart(first);
  return { from: start, to: addDays(start, 41) };
}

/** Der nächste oder vorige Ausschnitt. */
export function blaettern(mode, cursor, richtung) {
  if (mode === 'day') return addDays(cursor, richtung);
  if (mode === 'week') return addDays(cursor, 7 * richtung);
  return addMonths(cursor.slice(0, 8) + '01', richtung);
}

/** Minuten seit Mitternacht einer „HH:MM“-Zeit. */
export function minuten(hhmmText) {
  const [h, m] = String(hhmmText || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Lage der Termine mit Uhrzeit in einer Tagesspalte: Spalte und Spaltenzahl,
 * damit sich Überschneidungen nebeneinander zeigen.
 * @returns {Array<{e:object, von:number, bis:number, spalte:number, spalten:number}>}
 */
export function tagesLage(eintraege) {
  const items = eintraege
    .filter((e) => !e.allDay && e.startTime)
    .map((e) => {
      const von = minuten(e.startTime);
      let bis = e.endTime ? minuten(e.endTime) : von + 60;
      if (bis <= von) bis = e.spanLength > 1 ? 1440 : von + 60;
      return { e, von, bis: Math.min(1440, Math.max(bis, von + 20)), spalte: 0, spalten: 1 };
    })
    .sort((x, y) => x.von - y.von || y.bis - x.bis);
  // Gruppen überlappender Einträge: Spalten werden innerhalb einer Gruppe vergeben.
  let gruppe = [];
  let gruppenEnde = -1;
  const abschliessen = () => {
    const spalten = Math.max(1, ...gruppe.map((x) => x.spalte + 1));
    for (const x of gruppe) x.spalten = spalten;
    gruppe = [];
  };
  for (const it of items) {
    if (gruppe.length && it.von >= gruppenEnde) abschliessen();
    const belegt = new Set(gruppe.filter((x) => x.bis > it.von).map((x) => x.spalte));
    let s = 0;
    while (belegt.has(s)) s++;
    it.spalte = s;
    gruppe.push(it);
    gruppenEnde = Math.max(gruppenEnde, it.bis);
  }
  if (gruppe.length) abschliessen();
  return items;
}

/** Zahl der Tage eines Termins, für Prüfungen und Anzeigen. */
export { tageDauer };
