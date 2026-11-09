/**
 * Kontovia – Verbindung zu Outlook Kalender (Microsoft 365, Outlook.com), Web-Fassung.
 *
 * Das Gegenstück zu gcal.js für die Schnittstelle von Microsoft (Graph). Kontovia
 * legt im Konto einen eigenen Kalender „Kontovia“ an und nimmt auf Wunsch weitere
 * Kalender dazu, auch solche, die nur lesbar mit dem Konto geteilt sind. Was zu tun
 * ist, entscheidet dieselbe Logik wie bei Google (renderer/lib/gcal.js: planSync,
 * planWeitere). Damit sie nichts über Microsoft wissen muss, spricht diese Datei
 * nach außen die Sprache von Google: Ereignisse kommen in der Form von Google an
 * (Titel, Beginn, Ende, Wiederholung als RRULE) und gehen aus ihr wieder zurück.
 *
 * Anmeldung wie beim E-Mail-Senden (mailversand.js): ein kleines Fenster bei
 * Microsoft, Code mit PKCE, Tausch des Codes direkt aus dem Browser. Der Bereich
 * ist `Calendars.ReadWrite`; er wird erst auf Klick angefragt, getrennt vom Bereich
 * zum Senden und zum Lesen des Postfachs. Das Zugriffstoken gilt rund eine
 * Stunde und steht nur im Arbeitsspeicher, nie im Tresor oder im Browser-Speicher.
 * Ist es abgelaufen, wartet der Abgleich auf einen Tipp (bestaetigen). Eine stille
 * Erneuerung gibt es hier nicht. Im Tresor (Cloud-Block, nur dieses Gerät) stehen
 * Konto, Kalender und der Merkzettel des Abgleichs, aber kein Schlüssel.
 *
 * Kennungen: Microsoft vergibt die Kennung eines Ereignisses selbst. Was Kontovia
 * anlegt, trägt deshalb seine eigene Kennung (kv…, kd…) in einer erweiterten
 * Eigenschaft des Ereignisses; nach außen gilt diese als Kennung. Fremde Ereignisse
 * zeigen die Kennung von Microsoft ohne Auffüllzeichen.
 *
 * Ohne Löschmarken: Gelöschte Ereignisse liefert Microsoft nicht mit. Was beim
 * Abruf fehlt, gilt wie bei Google als gelöscht (planSync / planWeitere).
 */

import { requestJson, form } from './netz.js';
import { readIdToken } from './weiterleitung.js';
import { msFensterOeffnen, MS_TOKEN } from './mailversand.js';
import { istApple } from './gcal.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const CAL_SCOPE = 'https://graph.microsoft.com/Calendars.ReadWrite';
export const CAL_SCOPES = ['openid', 'profile', 'email', CAL_SCOPE];
export const KALENDER_NAME = 'Kontovia';
/** Erweiterte Eigenschaft, in der Kontovia die eigene Kennung eines Ereignisses ablegt. */
const PROP = 'String {7c6e9f0b-2d4a-4b1e-9f53-5a1d0c3b8e42} Name KontoviaKennung';
const EIGENE_KENNUNG = /^k[vd][0-9a-f]+$/;
/* Kennungen nach außen: Kontovias eigene und die von Microsoft, URL-sicher und ohne „=“. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;
const KALENDER_ID = /^[A-Za-z0-9_=+/.-]{1,512}$/;
const BODY_KEYS = new Set(['summary', 'location', 'description', 'start', 'end', 'recurrence', 'transparency']);
const ABBRUCH = ['BESTAETIGEN', 'NICHT_VERBUNDEN', 'KEINE_BERECHTIGUNG'];
const FELDER = ['id', 'subject', 'body', 'location', 'start', 'end', 'isAllDay', 'isCancelled', 'recurrence', 'type', 'seriesMasterId', 'showAs', 'lastModifiedDateTime', 'createdDateTime'].join(',');
const TAGE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const TAGE_NAME = { MO: 'monday', TU: 'tuesday', WE: 'wednesday', TH: 'thursday', FR: 'friday', SA: 'saturday', SU: 'sunday' };

const enc = (s) => encodeURIComponent(String(s));

function fehler(text, code) {
  return Object.assign(new Error(text), { code });
}

function systemZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'; } catch { return 'Europe/Berlin'; }
}

/* -------------------------------------------------------------------------- */
/* Umwandlung zwischen Graph und der Sprache von Google                        */
/* -------------------------------------------------------------------------- */

/** Kennung von Microsoft → nach außen (URL-sicher, ohne Auffüllzeichen). */
export function aussenId(graphId) {
  return String(graphId || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Das Gegenstück, wenn die Zuordnung aus dem Abruf nicht zur Hand ist. */
export function graphId(aussen) {
  const s = String(aussen).replace(/-/g, '+').replace(/_/g, '/');
  // Microsoft führt seine Kennungen mit Auffüllzeichen auf ein Vielfaches von vier.
  return s + '='.repeat((4 - (s.length % 4)) % 4);
}

const hexText = (text) => Array.from(new TextEncoder().encode(String(text)), (b) => b.toString(16).padStart(2, '0')).join('');
const zufallshex = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

function rruleDatum(t) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(t || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Wiederholung von Microsoft als RRULE-Zeile; undefined, wenn sich die Regel nicht abbilden lässt. */
export function graphZuRegel(rec) {
  const p = rec?.pattern;
  const r = rec?.range || {};
  if (!p) return undefined;
  const n = Math.max(1, Number(p.interval) || 1);
  let s;
  if (p.type === 'daily') s = 'FREQ=DAILY';
  else if (p.type === 'weekly') {
    const tage = (p.daysOfWeek || []).map((d) => Object.keys(TAGE_NAME).find((k) => TAGE_NAME[k] === String(d).toLowerCase())).filter(Boolean);
    s = 'FREQ=WEEKLY' + (tage.length ? `;BYDAY=${tage.join(',')}` : '');
  } else if (p.type === 'absoluteMonthly') s = `FREQ=MONTHLY;BYMONTHDAY=${Number(p.dayOfMonth) || 1}`;
  else if (p.type === 'absoluteYearly') s = `FREQ=YEARLY;BYMONTH=${Number(p.month) || 1};BYMONTHDAY=${Number(p.dayOfMonth) || 1}`;
  else return undefined;
  if (n > 1) s += `;INTERVAL=${n}`;
  if (r.type === 'endDate' && r.endDate) s += `;UNTIL=${String(r.endDate).replace(/-/g, '')}`;
  else if (r.type === 'numbered' && Number(r.numberOfOccurrences) > 0) s += `;COUNT=${Number(r.numberOfOccurrences)}`;
  return ['RRULE:' + s];
}

/** RRULE-Zeilen als Wiederholung für Microsoft; null, wenn leer oder nicht abbildbar. */
export function regelZuGraph(zeilen, startDatum) {
  const zeile = (Array.isArray(zeilen) ? zeilen : []).find((z) => /^RRULE:/i.test(String(z)));
  if (!zeile || !/^\d{4}-\d{2}-\d{2}$/.test(String(startDatum))) return null;
  const p = {};
  for (const teil of zeile.slice(6).split(';')) {
    const [k, v] = teil.split('=');
    if (k) p[k.toUpperCase()] = String(v || '').toUpperCase();
  }
  const interval = Math.max(1, Math.min(99, Number(p.INTERVAL) || 1));
  const start = new Date(`${startDatum}T12:00:00Z`);
  const tag = Number(p.BYMONTHDAY) || start.getUTCDate();
  let pattern;
  if (p.FREQ === 'DAILY') pattern = { type: 'daily', interval };
  else if (p.FREQ === 'WEEKLY') {
    const tage = (p.BYDAY ? p.BYDAY.split(',') : [TAGE[start.getUTCDay()]]).filter((d) => TAGE_NAME[d]);
    if (!tage.length) return null;
    pattern = { type: 'weekly', interval, daysOfWeek: tage.map((d) => TAGE_NAME[d]), firstDayOfWeek: 'monday' };
  } else if (p.FREQ === 'MONTHLY' && !p.BYDAY) pattern = { type: 'absoluteMonthly', interval, dayOfMonth: tag };
  else if (p.FREQ === 'YEARLY' && !p.BYDAY) pattern = { type: 'absoluteYearly', interval, dayOfMonth: tag, month: Number(p.BYMONTH) || start.getUTCMonth() + 1 };
  else return null;
  let range = { type: 'noEnd', startDate: startDatum };
  const bis = rruleDatum(p.UNTIL);
  if (bis) range = { type: 'endDate', startDate: startDatum, endDate: bis };
  else if (Number(p.COUNT) > 0) range = { type: 'numbered', startDate: startDatum, numberOfOccurrences: Number(p.COUNT) };
  return { pattern, range };
}

/** Ein Ereignis von Microsoft in der Form von Google (nur die Felder, die der Abgleich braucht). */
export function graphZuEreignis(e) {
  const ganz = e.isAllDay === true;
  const zeit = (x) => {
    const t = String(x?.dateTime || '');
    return ganz ? { date: t.slice(0, 10) } : { dateTime: t.slice(0, 19) };
  };
  const eigene = e.singleValueExtendedProperties?.find?.((x) => x?.id === PROP)?.value;
  const id = EIGENE_KENNUNG.test(String(eigene || '')) ? String(eigene) : aussenId(e.id);
  const quelle = id.startsWith('kd1') ? 'zahlung' : id.startsWith('kd0') ? 'veranstaltung' : '';
  const start = zeit(e.start);
  const serie = e.type === 'occurrence' || e.type === 'exception';
  return {
    id,
    status: e.isCancelled ? 'cancelled' : 'confirmed',
    updated: e.lastModifiedDateTime ? new Date(e.lastModifiedDateTime).toISOString() : undefined,
    created: e.createdDateTime ? new Date(e.createdDateTime).toISOString() : undefined,
    summary: e.subject || '',
    description: e.body?.content || '',
    location: e.location?.displayName || '',
    start,
    end: zeit(e.end),
    recurrence: e.recurrence ? graphZuRegel(e.recurrence) : undefined,
    recurringEventId: serie ? aussenId(e.seriesMasterId || e.id) : undefined,
    extendedProperties: quelle ? { private: { kontoviaQuelle: quelle } } : undefined,
    _graphId: e.id,
  };
}

/**
 * Der Auftrag in der Form von Google als Körper für Microsoft. Nur Felder, die im
 * Auftrag stehen, gehen mit: Ein Teil-Auftrag ändert nur diese Felder.
 * @param {object} b  Körper nach Google-Art
 * @param {string} zone  Zeitzone für Termine mit Uhrzeit und ganztägige
 * @param {string} [startDatum]  Beginn des Ereignisses, wenn der Auftrag nur die Wiederholung ändert
 */
export function ereignisZuGraph(b, zone, startDatum = '') {
  const out = {};
  if ('summary' in b) out.subject = String(b.summary ?? '');
  if ('location' in b) out.location = { displayName: String(b.location ?? '') };
  if ('description' in b) out.body = { contentType: 'text', content: String(b.description ?? '') };
  if ('transparency' in b) out.showAs = b.transparency === 'transparent' ? 'free' : 'busy';
  let datum = startDatum;
  if (b.start && b.end) {
    const ganz = !!b.start.date;
    const t = (x) => (ganz ? { dateTime: `${x.date}T00:00:00`, timeZone: zone } : { dateTime: String(x.dateTime).slice(0, 19), timeZone: x.timeZone || zone });
    out.isAllDay = ganz;
    out.start = t(b.start);
    out.end = t(b.end);
    datum = ganz ? b.start.date : String(b.start.dateTime).slice(0, 10);
  }
  if ('recurrence' in b) out.recurrence = regelZuGraph(b.recurrence, datum);
  return { body: out, datum };
}

/* -------------------------------------------------------------------------- */
/* Outlook Kalender                                                            */
/* -------------------------------------------------------------------------- */

export class OutlookCalendar {
  /**
   * @param {import('./tresor.js').Vault} vault
   * @param {{clientId:string, fenster?:Function, anfrage?:Function, appleApp?:() => boolean}} opts
   *   fenster und anfrage ersetzen in Prüfungen das Fenster bei Microsoft und das Netz.
   */
  constructor(vault, {
    clientId = '', fenster = msFensterOeffnen, anfrage = requestJson,
    appleApp = () => istApple() && (globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true),
  } = {}) {
    this.vault = vault;
    this.clientId = clientId;
    this.fenster = fenster;
    this.anfrage = anfrage;
    this.appleApp = appleApp;
    this.token = null; // { accessToken, expiresAt, scope } – nur im Arbeitsspeicher
    this.offen = null;
    this.zone = systemZone();
    this.ids = new Map(); // „Kalender\nAußenkennung“ → Kennung von Microsoft, aus dem letzten Abruf
  }

  state() {
    const db = this.vault.db;
    if (!db) throw new Error('Der Tresor ist gesperrt.');
    db.cloud ??= {};
    db.cloud.mscal ??= {};
    return db.cloud.mscal;
  }

  tokenGueltig() {
    return !!this.token && this.token.expiresAt > Date.now();
  }

  zoneMerken(zone) {
    if (typeof zone === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) this.zone = zone;
  }

  /** Gesperrt heißt: auch der Zugriff auf Microsoft ist weg. */
  vergessen() {
    this.token = null;
    this.ids.clear();
    this.abbrechen();
  }

  abbrechen() {
    this.offen?.abbrechen();
    this.offen = null;
  }

  status() {
    const g = this.vault.db?.cloud?.mscal || {};
    const linked = !!(g.calendarId && g.linkedAt);
    return {
      available: !!this.clientId && !this.appleApp(),
      configured: !!this.clientId,
      linked,
      anbieter: 'microsoft',
      // Ohne gültiges Zugriffstoken wartet der Abgleich auf eine kurze Bestätigung.
      bestaetigen: linked && !this.tokenGueltig(),
      laeuftBaldAb: false,
      // Der Bereich gilt für alle Kalender des Kontos, eine zweite Freigabe gibt es nicht.
      weitereErlaubt: linked,
      email: g.email || '',
      calendarId: g.calendarId || '',
      calendarName: g.calendarName || '',
      linkedAt: g.linkedAt || null,
      lastSyncAt: g.lastSyncAt || null,
      lastError: g.lastError || null,
      busy: !!this.offen,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Anmeldung                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Öffnet das Fenster bei Microsoft (synchron, direkt im Tipp) und liefert das Zugriffstoken.
   * @param {{loginHint?:string, prompt?:string}} p
   */
  anfordern({ loginHint = '', prompt = '' } = {}) {
    if (!this.clientId) throw fehler('Für Microsoft ist in Kontovia noch nichts hinterlegt.', 'NICHT_EINGERICHTET');
    if (this.appleApp()) throw fehler('Auf iPhone und iPad lässt sich Outlook Kalender in der App vom Home-Bildschirm nicht verbinden. Bitte im Browser öffnen oder den Weg über Kalenderdateien (.ics) nehmen.', 'NICHT_MOEGLICH');
    this.abbrechen();
    const offen = this.fenster({ clientId: this.clientId, loginHint, prompt, scopes: CAL_SCOPES });
    this.offen = offen;
    return (async () => {
      try {
        const a = await offen.ergebnis;
        const d = await this.anfrage(MS_TOKEN, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({ client_id: this.clientId, grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri, code_verifier: a.verifier, scope: CAL_SCOPES.join(' ') }),
        }).catch((err) => { throw fehler(`Microsoft hat die Anmeldung nicht angenommen: ${err.message}`, 'ANBIETER'); });
        const claims = readIdToken(d?.id_token || '');
        if (!d?.access_token || claims.nonce !== a.nonce) throw new Error('Die Antwort von Microsoft ließ sich nicht bestätigen. Bitte erneut versuchen.');
        if (!/(^|\s)(https:\/\/graph\.microsoft\.com\/)?Calendars\.ReadWrite(\s|$)/i.test(String(d.scope || ''))) {
          throw fehler('Der Zugriff auf den Kalender wurde bei Microsoft nicht erlaubt. Bitte erneut verbinden und den Kalenderzugriff erlauben.', 'NICHT_ERLAUBT');
        }
        return {
          accessToken: d.access_token,
          // Eine Minute Reserve, damit kein Auftrag mit einem gerade ablaufenden Token startet.
          expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000 - 60000,
          scope: String(d.scope || ''),
          email: String(claims.email || claims.preferred_username || ''),
        };
      } finally {
        if (this.offen === offen) this.offen = null;
      }
    })();
  }

  async connect({ calendarIdHint = '', timeZone = '', merk = null } = {}) {
    void merk;
    this.zoneMerken(timeZone);
    const g = this.state();
    const auth = await this.anfordern({ prompt: 'select_account' });
    const vorher = g.calendarId;
    this.token = { accessToken: auth.accessToken, expiresAt: auth.expiresAt, scope: auth.scope };
    let cal;
    try {
      cal = await this.ensureCalendar({ hint: String(calendarIdHint || vorher || ''), email: auth.email });
    } catch (err) {
      this.token = null;
      throw err;
    }
    // Ein anderer Kalender oder ein anderes Konto heißt: der Merkzettel gilt nicht mehr.
    if (cal.id !== vorher || (g.email && auth.email && g.email.toLowerCase() !== auth.email.toLowerCase())) { g.map = {}; g.weitere = {}; }
    g.email = auth.email || '';
    g.scope = auth.scope;
    g.calendarId = cal.id;
    g.calendarName = cal.name || KALENDER_NAME;
    g.linkedAt = new Date().toISOString();
    g.lastError = null;
    await this.vault.save(this.vault.db);
    return { email: g.email, calendarId: g.calendarId, calendarName: g.calendarName, created: !!cal.created, weitereErlaubt: true };
  }

  /** Neues Zugriffstoken für eine bestehende Verbindung, nach einem Tipp. */
  async bestaetigen() {
    const g = this.state();
    if (!(g.calendarId && g.linkedAt)) throw fehler('Outlook Kalender ist auf diesem Gerät nicht verbunden.', 'NICHT_VERBUNDEN');
    const auth = await this.anfordern({ loginHint: g.email || '' });
    if (g.email && auth.email && auth.email.toLowerCase() !== g.email.toLowerCase()) {
      throw new Error(`Bitte mit dem Konto ${g.email} bestätigen. Für ein anderes Konto Outlook Kalender erst trennen und neu verbinden.`);
    }
    this.token = { accessToken: auth.accessToken, expiresAt: auth.expiresAt, scope: auth.scope };
    if (/bestätigen/.test(g.lastError || '')) g.lastError = null;
    await this.vault.save(this.vault.db);
    return this.status();
  }

  /**
   * Trennen. Microsoft kennt hier keinen Widerruf per Aufruf; die Freigabe lässt sich im Konto
   * unter „Apps und Dienste“ entziehen. Mit gültigem Zugriff löscht Kontovia auf Wunsch seinen Kalender.
   */
  async disconnect({ deleteCalendar = false } = {}) {
    const g = this.state();
    let geloescht = false;
    if (deleteCalendar && g.calendarId && this.tokenGueltig()) {
      try {
        await this.api('DELETE', `/me/calendars/${enc(g.calendarId)}`);
        geloescht = true;
      } catch { /* getrennt wird trotzdem */ }
    }
    this.vault.db.cloud.mscal = {};
    this.token = null;
    this.ids.clear();
    await this.vault.save(this.vault.db);
    return { deletedCalendar: geloescht, widerrufen: false };
  }

  accessToken() {
    if (this.tokenGueltig()) return this.token.accessToken;
    this.token = null;
    const g = this.state();
    if (!(g.calendarId && g.linkedAt)) throw fehler('Outlook Kalender ist auf diesem Gerät nicht verbunden.', 'NICHT_VERBUNDEN');
    throw fehler('Der Kalenderabgleich wartet auf eine kurze Bestätigung bei Microsoft.', 'BESTAETIGEN');
  }

  /* ---------------------------------------------------------------------- */
  /* Schnittstelle                                                           */
  /* ---------------------------------------------------------------------- */

  async api(method, pfad, body = null, query = null, kopf = {}) {
    const qs = query
      ? '?' + Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${enc(v)}`).join('&')
      : '';
    const url = /^https:/.test(pfad) ? pfad : GRAPH + pfad + qs;
    for (let versuch = 0; ; versuch++) {
      const token = this.accessToken();
      try {
        return await this.anfrage(url, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...kopf },
          body: body ? JSON.stringify(body) : null,
          timeoutMs: 30000,
        });
      } catch (err) {
        if ((err.status === 429 || err.status === 503 || err.status === 504) && versuch < 3) {
          await new Promise((r) => setTimeout(r, 800 * 2 ** versuch));
          continue;
        }
        // Token abgelaufen oder bei Microsoft zurückgezogen: neu bestätigen lassen.
        if (err.status === 401) {
          this.token = null;
          throw fehler('Der Kalenderabgleich wartet auf eine kurze Bestätigung bei Microsoft.', 'BESTAETIGEN');
        }
        throw verstaendlich(err);
      }
    }
  }

  lesekopf() {
    return { prefer: `outlook.timezone="${this.zone}", outlook.body-content-type="text"` };
  }

  /** Alle Kalender des Kontos. */
  async kalender() {
    const out = [];
    let pfad = '/me/calendars';
    let query = { $top: 100 };
    do {
      const r = await this.api('GET', pfad, null, query);
      out.push(...(r?.value || []));
      pfad = r?.['@odata.nextLink'] || '';
      query = null;
    } while (pfad && out.length < 500);
    return out;
  }

  /** Findet den Kalender „Kontovia“ oder legt ihn an. */
  async ensureCalendar({ hint }) {
    if (hint && KALENDER_ID.test(hint)) {
      try {
        const c = await this.api('GET', `/me/calendars/${enc(hint)}`);
        return { id: c.id, name: c.name };
      } catch (err) {
        if (![403, 404].includes(err.status)) throw err;
      }
    }
    const gefunden = (await this.kalender()).find((c) => c.name === KALENDER_NAME && !c.isDefaultCalendar && c.canEdit !== false);
    if (gefunden) return { id: gefunden.id, name: gefunden.name };
    const c = await this.api('POST', '/me/calendars', { name: KALENDER_NAME });
    return { id: c.id, name: c.name || KALENDER_NAME, created: true };
  }

  /**
   * Ereignisse eines Kalenders (Einzeltermine und Serien, keine einzelnen Vorkommen).
   * Ein Zeitraum (`ab`, `bis` als Zeitpunkt) beschränkt, was behalten wird: ohne Ende
   * vor `ab` und, wo `bis` gilt, ohne Beginn nach `bis`; Serien bleiben.
   */
  async ereignisse(calendarId, ab, bis, { adoptieren = false } = {}) {
    const out = [];
    let pfad = `/me/calendars/${enc(calendarId)}/events`;
    let query = { $top: 100, $select: FELDER, $expand: `singleValueExtendedProperties($filter=id eq '${PROP}')` };
    do {
      const r = await this.api('GET', pfad, null, query, this.lesekopf());
      for (const e of r?.value || []) {
        const ev = graphZuEreignis(e);
        // Ein Ereignis, das jemand selbst im Kalender „Kontovia“ angelegt hat, bekommt eine Kontovia-Kennung
        // (in der erweiterten Eigenschaft), damit es hier und in Google denselben Termin meint.
        if (adoptieren && !EIGENE_KENNUNG.test(ev.id) && !ev.recurringEventId) {
          const kennung = 'kv' + hexText('mscal_' + zufallshex());
          try {
            const neu = await this.api('PATCH', `/me/calendars/${enc(calendarId)}/events/${enc(e.id)}`, { singleValueExtendedProperties: [{ id: PROP, value: kennung }] });
            ev.id = kennung;
            if (neu?.lastModifiedDateTime) ev.updated = new Date(neu.lastModifiedDateTime).toISOString();
          } catch (err) {
            if (ABBRUCH.includes(err.code)) throw err;
            continue; // beim nächsten Abgleich noch einmal
          }
        }
        this.ids.set(`${calendarId}\n${ev.id}`, e.id);
        const ende = ev.end.date || ev.end.dateTime || '';
        const beginn = ev.start.date || ev.start.dateTime || '';
        const serie = !!ev.recurrence || e.type === 'seriesMaster';
        if (!serie && ab && ende && ende.slice(0, 10) < ab.slice(0, 10)) continue;
        if (!serie && bis && beginn && beginn.slice(0, 10) > bis.slice(0, 10)) continue;
        const { _graphId, ...knapp } = ev;
        out.push(knapp);
      }
      pfad = r?.['@odata.nextLink'] || '';
      query = null;
    } while (pfad && out.length < 20000);
    return out;
  }

  /** Alle Ereignisse des Kontovia-Kalenders. */
  async pull({ timeZone = '' } = {}) {
    this.zoneMerken(timeZone);
    const g = this.state();
    if (!g.calendarId) throw new Error('Es ist noch kein Kontovia-Kalender angelegt. Bitte neu verbinden.');
    let neu = false;
    let events;
    try {
      events = await this.ereignisse(g.calendarId, undefined, undefined, { adoptieren: true });
    } catch (err) {
      if (err.status !== 404) throw err;
      // Der Kalender wurde bei Microsoft gelöscht: neu anlegen, alles neu übertragen.
      const cal = await this.ensureCalendar({ hint: '' });
      g.calendarId = cal.id;
      g.calendarName = cal.name || KALENDER_NAME;
      g.map = {};
      neu = true;
      await this.vault.save(this.vault.db);
      events = await this.ereignisse(g.calendarId, undefined, undefined, { adoptieren: true });
    }
    return { calendarId: g.calendarId, events, map: g.map || {}, recreated: neu };
  }

  /**
   * Die Kalender des Kontos, die Kontovia lesen darf, ohne den eigenen. `readOnly`: nur
   * lesbar. `geteilt`: gehört jemand anderem und wurde mit dem Konto geteilt.
   */
  async kalenderListe() {
    const g = this.state();
    const ich = String(g.email || '').toLowerCase();
    const out = [];
    for (const c of await this.kalender()) {
      if (!c?.id || c.id === g.calendarId) continue;
      const besitzer = String(c.owner?.address || '').toLowerCase();
      const geteilt = !c.isDefaultCalendar && !!besitzer && !!ich && besitzer !== ich;
      out.push({
        id: String(c.id), name: String(c.name || c.id).slice(0, 200), primary: !!c.isDefaultCalendar,
        color: /^#[0-9a-f]{6}$/i.test(String(c.hexColor || '')) ? c.hexColor : '',
        readOnly: c.canEdit === false, geteilt, sonder: false, importiert: false, angezeigt: true,
      });
    }
    return out.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Ereignisse der ausgewählten weiteren Kalender ab `timeMin`. Für die nur lesbaren (`lesen`)
   * gilt zusätzlich `timeMax`.
   */
  async pullWeitere({ ids = [], timeMin = '', timeMax = '', lesen = [], timeZone = '' } = {}) {
    this.zoneMerken(timeZone);
    const g = this.state();
    const liste = (Array.isArray(ids) ? ids : []).map(String).filter((id) => KALENDER_ID.test(id) && id !== g.calendarId).slice(0, 30);
    const zeit = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    const ab = zeit.test(String(timeMin)) ? String(timeMin) : undefined;
    const bis = zeit.test(String(timeMax)) ? String(timeMax) : undefined;
    const nurLesen = new Set((Array.isArray(lesen) ? lesen : []).map(String));
    const out = new Array(liste.length);
    let abbruch = null;
    let next = 0;
    const arbeiter = async () => {
      while (next < liste.length && !abbruch) {
        const i = next++;
        const id = liste[i];
        try {
          out[i] = { calendarId: id, events: await this.ereignisse(id, ab, nurLesen.has(id) ? bis : undefined), map: g.weitere?.[id]?.map || {} };
        } catch (err) {
          // Ein einzelner Kalender ohne Leserecht hält die übrigen nicht auf.
          if (['BESTAETIGEN', 'NICHT_VERBUNDEN'].includes(err.code)) { abbruch = err; return; }
          out[i] = { calendarId: id, error: err.status === 404 ? 'Der Kalender ist nicht mehr erreichbar.' : err.message, map: g.weitere?.[id]?.map || {} };
        }
      }
    };
    await Promise.all([arbeiter(), arbeiter(), arbeiter()]);
    if (abbruch) throw abbruch;
    return out;
  }

  /** Kennung von Microsoft zu einer Außenkennung; null, wenn es das Ereignis nicht gibt. */
  async graphIdFinden(kalender, eventId) {
    const bekannt = this.ids.get(`${kalender}\n${eventId}`);
    if (bekannt) return bekannt;
    if (EIGENE_KENNUNG.test(eventId)) {
      const r = await this.api('GET', `/me/calendars/${enc(kalender)}/events`, null, {
        $top: 1, $select: 'id', $filter: `singleValueExtendedProperties/any(ep: ep/id eq '${PROP}' and ep/value eq '${eventId}')`,
      });
      const id = r?.value?.[0]?.id || null;
      if (id) this.ids.set(`${kalender}\n${eventId}`, id);
      return id;
    }
    return graphId(eventId);
  }

  /** Führt die Aufträge aus der Oberfläche aus, jeden für sich geprüft. */
  async push(ops) {
    const g = this.state();
    const list = Array.isArray(ops) ? ops.slice(0, 5000) : [];
    const out = new Array(list.length);
    let abbruch = null;
    const zone = this.zone;

    const one = async (op) => {
      if (!op || !['insert', 'patch', 'delete'].includes(op.kind) || !EVENT_ID.test(String(op.eventId || ''))) {
        return { eventId: String(op?.eventId || ''), ok: false, error: 'Ungültiger Auftrag.' };
      }
      const id = String(op.eventId);
      const kal = op?.calendarId && KALENDER_ID.test(String(op.calendarId)) ? String(op.calendarId) : g.calendarId;
      const pfad = `/me/calendars/${enc(kal)}/events`;
      const roh = {};
      for (const [k, v] of Object.entries(op.body && typeof op.body === 'object' ? op.body : {})) if (BODY_KEYS.has(k)) roh[k] = v;
      const merken = (ev) => { if (ev?.id) this.ids.set(`${kal}\n${id}`, ev.id); return ev; };
      const neuAnlegen = async () => {
        const { body } = ereignisZuGraph(roh, zone);
        if (body.recurrence === null) delete body.recurrence;
        const kopf = { ...body, transactionId: id };
        if (EIGENE_KENNUNG.test(id)) kopf.singleValueExtendedProperties = [{ id: PROP, value: id }];
        return merken(await this.api('POST', pfad, kopf));
      };
      try {
        let ev = null;
        if (op.kind === 'delete') {
          const gid = await this.graphIdFinden(kal, id);
          if (gid) {
            try { await this.api('DELETE', `${pfad}/${enc(gid)}`); } catch (err) { if (![404, 410].includes(err.status)) throw err; }
          }
          this.ids.delete(`${kal}\n${id}`);
        } else if (op.kind === 'insert') {
          ev = await neuAnlegen();
        } else {
          const gid = await this.graphIdFinden(kal, id);
          if (!gid) {
            ev = await neuAnlegen();
          } else {
            let startDatum = '';
            // Ändert der Auftrag nur die Wiederholung, braucht Microsoft den Beginn dazu.
            if ('recurrence' in roh && !roh.start) {
              const alt = await this.api('GET', `${pfad}/${enc(gid)}`, null, { $select: 'start' }, this.lesekopf());
              startDatum = String(alt?.start?.dateTime || '').slice(0, 10);
            }
            const { body } = ereignisZuGraph(roh, zone, startDatum);
            try {
              ev = merken(await this.api('PATCH', `${pfad}/${enc(gid)}`, body));
            } catch (err) {
              if (![404, 410].includes(err.status)) throw err;
              ev = await neuAnlegen();
            }
          }
        }
        return { eventId: id, ok: true, updated: ev?.lastModifiedDateTime ? new Date(ev.lastModifiedDateTime).toISOString() : null };
      } catch (err) {
        if (ABBRUCH.includes(err.code)) abbruch = err;
        return { eventId: id, ok: false, error: err.message };
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < list.length && !abbruch) {
        const i = next++;
        out[i] = await one(list[i]);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (abbruch) throw abbruch;
    return out.map((r, i) => r || { eventId: String(list[i]?.eventId || ''), ok: false, error: 'Nicht ausgeführt.' });
  }

  /** Merkzettel und Zeitpunkt nach einem Abgleich festhalten. */
  async finish({ map = {}, error = null, weitere = null } = {}) {
    const g = this.state();
    if (map && typeof map === 'object') g.map = sauberesMerkblatt(map);
    if (weitere && typeof weitere === 'object') {
      const neu = {};
      for (const [id, m] of Object.entries(weitere).slice(0, 30)) {
        if (KALENDER_ID.test(id) && m && typeof m === 'object') neu[id] = { map: sauberesMerkblatt(m) };
      }
      g.weitere = neu;
    }
    if (error) {
      g.lastError = String(error).slice(0, 300);
    } else {
      g.lastSyncAt = new Date().toISOString();
      g.lastError = null;
    }
    await this.vault.save(this.vault.db);
    return this.status();
  }
}

function sauberesMerkblatt(map) {
  const sauber = {};
  for (const [k, v] of Object.entries(map)) {
    if (!EVENT_ID.test(k) || !v || typeof v !== 'object') continue;
    sauber[k] = {
      updated: String(v.updated || '').slice(0, 40),
      ...(v.localAt !== undefined ? { localAt: String(v.localAt).slice(0, 40) } : {}),
      ...(v.hash !== undefined ? { hash: String(v.hash).slice(0, 600) } : {}),
    };
  }
  return sauber;
}

/** Fehlermeldungen von Microsoft in etwas, womit man etwas anfangen kann. */
function verstaendlich(err) {
  let e = err;
  if (err.status === 403) {
    e = new Error('Microsoft erlaubt Kontovia den Zugriff auf diesen Kalender nicht. Bei Firmenkonten muss das oft die IT freigeben.');
    e.code = 'KEINE_BERECHTIGUNG';
  }
  e.status = err.status;
  return e;
}
