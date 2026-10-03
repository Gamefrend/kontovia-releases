/**
 * Kontovia – Verbindung zu Google Kalender, Web-Fassung.
 *
 * Kontovia legt im
 * Google-Konto einen eigenen Kalender „Kontovia“ an (Bereich
 * `calendar.app.created`) und nimmt auf Wunsch weitere Kalender dazu
 * (`calendar.events` und `calendar.readonly`). Was zu tun ist, entscheidet
 * die Oberfläche (renderer/lib/gcal.js); hier wird es geprüft und ausgeführt.
 *
 * Anders ist nur die Anmeldung. Die frühere Windows-Fassung hält einen dauerhaften
 * Schlüssel (Refresh-Token) und fragt damit jederzeit neue Zugriffstoken an.
 * Im Browser gibt Google ohne Client-Schlüssel keinen solchen Schlüssel
 * heraus, und die Anmeldung per Code (anmeldung.js) lässt den Kalender nicht
 * zu. Deshalb der Weg, den Google für reine Browser-Apps vorsieht: Ein kleines
 * Fenster bei Google (response_type=token), die Antwort kommt an die
 * Startseite der App zurück und wird von dort an dieses Fenster gereicht.
 *
 * Das Zugriffstoken gilt eine Stunde und steht nur im Arbeitsspeicher, nie
 * im Tresor oder im Browser-Speicher. Ist es abgelaufen, pausiert der
 * Abgleich, bis jemand kurz bestätigt. Das öffnet dasselbe Fenster; Google
 * kennt die Freigabe dann schon und schließt es meist sofort wieder. Ein
 * Fenster öffnen darf eine Seite nur auf einen Tipp hin, deshalb geschieht
 * das nicht von selbst.
 *
 * Im Tresor (Cloud-Block, nur dieses Gerät) stehen wie früher unter Windows
 * Konto, Kalender und der Merkzettel des Abgleichs, aber kein Schlüssel.
 */

import { requestJson, form } from './netz.js';
import { rueckAdresse, readIdToken } from './weiterleitung.js';

const API = 'https://www.googleapis.com/calendar/v3';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
export const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE_LISTE = 'https://www.googleapis.com/auth/calendar.readonly';
export const MARKER = '[kontovia-kalender]';
/** Kalenderkennungen von Google: E-Mail-artig, auch mit # (Feiertagskalender). */
const KALENDER_ID = /^[^\s/?]{1,300}$/;
/* Kontovia vergibt nur Kennungen aus a–v und Ziffern; Ereignisse aus anderen
   Programmen tragen auch andere Zeichen und müssen sich trotzdem ändern lassen. */
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;
const BODY_KEYS = new Set(['id', 'summary', 'location', 'description', 'start', 'end', 'recurrence', 'status', 'transparency', 'extendedProperties']);
/** Fehler, nach denen ein Abgleich nicht weiterlaufen kann. */
const ABBRUCH = ['BESTAETIGEN', 'NICHT_VERBUNDEN', 'SCHNITTSTELLE_AUS', 'KEINE_BERECHTIGUNG'];

/** Kennzeichen der Antworten für den Kalender, damit die Anmeldung per Weiterleitung sie nicht aufgreift. */
const PRAEFIX = 'kal.';
const KANAL = 'kontovia-google';
const FENSTER_MS = 5 * 60 * 1000;

const enc = (s) => encodeURIComponent(String(s));

function zufall() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fehler(text, code) {
  return Object.assign(new Error(text), { code });
}

/* -------------------------------------------------------------------------- */
/* Das Fenster bei Google                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Läuft im kleinen Fenster, wenn Google dorthin zurückkehrt: Reicht die
 * Antwort an das Kontovia-Fenster weiter und entfernt sie aus der Adresse.
 * Liefert true, wenn diese Seite nur dafür geladen wurde; dann startet hier
 * kein Kontovia (es würde dem eigentlichen Fenster den Tresor abnehmen).
 *
 * Weitergereicht wird auf zwei Wegen: an das öffnende Fenster und über einen
 * Kanal derselben Adresse, falls der Browser die Verbindung zum öffnenden
 * Fenster unterwegs gekappt hat. Beides erreicht nur Seiten von Kontovia.
 */
export function antwortWeiterreichen({ loc = location, hist = history, opener = globalThis.opener, Kanal = globalThis.BroadcastChannel } = {}) {
  const p = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
  if (!String(p.get('state') || '').startsWith(PRAEFIX)) return false;
  const nachricht = { typ: KANAL, hash: String(loc.hash) };
  try { hist.replaceState(null, '', loc.pathname + loc.search); } catch { /* egal */ }
  try { opener?.postMessage(nachricht, loc.origin); } catch { /* der Kanal reicht */ }
  try {
    const k = new Kanal(KANAL);
    k.postMessage(nachricht);
    k.close();
  } catch { /* ältere Browser: dann eben nur über das öffnende Fenster */ }
  return true;
}

/**
 * Liest die Antwort von Google aus dem Anker der Adresse.
 * @returns {null | {accessToken:string, expiresAt:number, scope:string, email:string}}
 *   null, wenn die Antwort zu einer anderen Anfrage gehört.
 */
export function antwortLesen(hash, { state, nonce }, jetzt = Date.now()) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (p.get('state') !== state) return null;
  const err = p.get('error');
  if (err === 'access_denied') throw fehler('Die Freigabe wurde bei Google abgebrochen.', 'ABGEBROCHEN');
  if (err) throw new Error(`Google meldet: ${err}`);
  const accessToken = p.get('access_token') || '';
  const claims = readIdToken(p.get('id_token') || '');
  if (!accessToken || claims.nonce !== nonce) {
    throw new Error('Die Antwort von Google ließ sich nicht bestätigen. Bitte erneut versuchen.');
  }
  return {
    accessToken,
    // Eine Minute Reserve, damit kein Auftrag mit einem gerade ablaufenden Token startet.
    expiresAt: jetzt + (Number(p.get('expires_in')) || 3600) * 1000 - 60000,
    scope: String(p.get('scope') || ''),
    email: String(claims.email || ''),
  };
}

/**
 * Öffnet das Fenster bei Google und wartet auf die Antwort. Muss direkt aus
 * einem Tipp heraus aufgerufen werden, sonst blockiert der Browser das Fenster.
 * @returns {{ergebnis: Promise<object>, abbrechen: () => void}}
 */
export function fensterOeffnen({ clientId, scopes, loginHint = '', prompt = '' }, {
  href = location.href, oeffnen = (u, n, f) => window.open(u, n, f), ziel = window,
  Kanal = globalThis.BroadcastChannel, wartezeit = FENSTER_MS,
} = {}) {
  if (!clientId) throw new Error('Für Google Kalender ist kein Client hinterlegt.');
  const erwartet = { state: PRAEFIX + zufall(), nonce: zufall() };
  const url = `${AUTH}?${form({
    client_id: clientId,
    redirect_uri: rueckAdresse(href),
    response_type: 'token id_token',
    scope: scopes.join(' '),
    include_granted_scopes: 'true',
    state: erwartet.state,
    nonce: erwartet.nonce,
    login_hint: loginHint,
    prompt,
  })}`;
  const w = oeffnen(url, 'kontovia-google', 'popup,width=520,height=680');
  if (!w) {
    throw fehler('Der Browser hat das Fenster für Google blockiert. Bitte erlauben Sie Pop-ups für Kontovia und versuchen Sie es erneut.', 'FENSTER_BLOCKIERT');
  }

  let fertig;
  let abbrechen = () => {};
  const ergebnis = new Promise((resolve, reject) => {
    const start = Date.now();
    let kanal = null;
    let getrennt = false;
    let zuSeit = 0;
    const aufraeumen = () => {
      ziel.removeEventListener('message', annehmen);
      try { kanal?.close(); } catch { /* egal */ }
      clearInterval(wache);
      clearTimeout(frist);
      try { w.close(); } catch { /* egal */ }
    };
    fertig = (fn, wert) => { aufraeumen(); fn(wert); };
    function annehmen(e) {
      const d = e?.data;
      if (e?.origin !== undefined && e.origin !== new URL(href).origin) return;
      if (!d || d.typ !== KANAL) return;
      try {
        const antwort = antwortLesen(d.hash, erwartet);
        if (antwort) fertig(resolve, antwort);
      } catch (err) {
        fertig(reject, err);
      }
    }
    ziel.addEventListener('message', annehmen);
    try {
      kanal = new Kanal(KANAL);
      kanal.onmessage = (e) => annehmen({ data: e.data });
    } catch { kanal = null; }
    // Fenster geschlossen, ohne dass eine Antwort kam? Kurz warten, sie kann
    // noch unterwegs sein. Meldet der Browser das Fenster schon im ersten
    // Moment als geschlossen, hat er nur die Verbindung gekappt; dann
    // bleiben Antwort, Abbrechen-Knopf und Frist.
    const wache = setInterval(() => {
      if (getrennt || !w.closed) return;
      if (Date.now() - start < 1500) { getrennt = true; return; }
      zuSeit ||= Date.now();
      if (Date.now() - zuSeit > 1500) fertig(reject, fehler('Die Anmeldung wurde abgebrochen.', 'ABGEBROCHEN'));
    }, 400);
    const frist = setTimeout(() => fertig(reject, new Error('Die Anmeldung bei Google hat zu lange gedauert. Bitte erneut versuchen.')), wartezeit);
    abbrechen = () => fertig(reject, fehler('Die Anmeldung wurde abgebrochen.', 'ABGEBROCHEN'));
  });
  return { ergebnis, abbrechen: () => abbrechen() };
}

/* -------------------------------------------------------------------------- */
/* Kalender                                                                    */
/* -------------------------------------------------------------------------- */

export class GoogleCalendar {
  /**
   * @param {import('./tresor.js').Vault} vault
   * @param {{clientId:string, fenster?:Function, anfrage?:Function}} opts
   *   fenster und anfrage ersetzen in Prüfungen das Fenster bei Google und das Netz.
   */
  constructor(vault, { clientId, fenster = fensterOeffnen, anfrage = requestJson } = {}) {
    this.vault = vault;
    this.clientId = clientId;
    this.fenster = fenster;
    this.anfrage = anfrage;
    this.token = null; // { accessToken, expiresAt, scope } – nur im Arbeitsspeicher
    this.offen = null; // das Fenster bei Google, solange es offen ist
  }

  state() {
    const db = this.vault.db;
    if (!db) throw new Error('Der Tresor ist gesperrt.');
    db.cloud ??= {};
    db.cloud.gcal ??= {};
    return db.cloud.gcal;
  }

  tokenGueltig() {
    return !!this.token && this.token.expiresAt > Date.now();
  }

  /** Gesperrt heißt: auch der Zugriff auf Google ist weg. */
  vergessen() {
    this.token = null;
    this.abbrechen();
  }

  abbrechen() {
    this.offen?.abbrechen();
    this.offen = null;
  }

  status() {
    const g = this.vault.db?.cloud?.gcal || {};
    const linked = !!(g.calendarId && g.linkedAt);
    const scopes = String(this.token?.scope || g.scope || '').split(/\s+/);
    return {
      available: true,
      configured: !!this.clientId,
      linked,
      // Ohne gültiges Zugriffstoken wartet der Abgleich auf eine kurze Bestätigung.
      bestaetigen: linked && !this.tokenGueltig(),
      weitereErlaubt: linked && scopes.includes(SCOPE_EVENTS) && scopes.includes(SCOPE_LISTE),
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

  /** Holt ein Zugriffstoken über das Fenster bei Google. */
  async anfordern({ weitere = false, loginHint = '', prompt = '' } = {}) {
    this.abbrechen();
    const scopes = ['openid', 'email', SCOPE, ...(weitere ? [SCOPE_EVENTS, SCOPE_LISTE] : [])];
    const offen = this.fenster({ clientId: this.clientId, scopes, loginHint, prompt });
    this.offen = offen;
    try {
      const auth = await offen.ergebnis;
      // Den Kalender im Google-Dialog abgewählt? Kein Widerruf: Google
      // widerriefe die ganze Freigabe des Kontos, auch die anderer Geräte.
      if (auth.scope && !auth.scope.split(/\s+/).includes(SCOPE)) {
        throw new Error('Der Zugriff auf den Kalender wurde im Google-Dialog nicht erlaubt. Bitte erneut verbinden und das Häkchen beim Kalender setzen.');
      }
      return auth;
    } finally {
      if (this.offen === offen) this.offen = null;
    }
  }

  async connect({ calendarIdHint = '', timeZone = 'Europe/Berlin', weitere = false } = {}) {
    const g = this.state();
    const auth = await this.anfordern({ weitere, prompt: 'select_account' });
    const vorher = g.calendarId;
    this.token = { accessToken: auth.accessToken, expiresAt: auth.expiresAt, scope: auth.scope };
    let cal;
    try {
      cal = await this.ensureCalendar({ hint: String(calendarIdHint || vorher || ''), timeZone: String(timeZone || 'Europe/Berlin') });
    } catch (err) {
      this.token = null;
      if (err.code === 'BESTAETIGEN') throw new Error('Google hat den Zugriff auf den Kalender nicht angenommen. Bitte erneut verbinden.');
      throw err;
    }
    // Ein anderer Kalender heißt: der Merkzettel gilt nicht mehr.
    if (cal.id !== vorher) g.map = {};
    // Ein Schlüssel aus der Windows-Fassung hat hier keinen Nutzen mehr.
    delete g.refreshToken;
    g.email = auth.email || '';
    g.scope = auth.scope;
    g.calendarId = cal.id;
    g.calendarName = cal.summary || 'Kontovia';
    g.linkedAt = new Date().toISOString();
    g.lastError = null;
    await this.vault.save(this.vault.db);
    const granted = auth.scope.split(/\s+/);
    return {
      email: g.email, calendarId: g.calendarId, calendarName: g.calendarName, created: !!cal.created,
      weitereErlaubt: granted.includes(SCOPE_EVENTS) && granted.includes(SCOPE_LISTE),
    };
  }

  /** Neues Zugriffstoken für eine bestehende Verbindung, nach einem Tipp. */
  async bestaetigen() {
    const g = this.state();
    if (!(g.calendarId && g.linkedAt)) throw fehler('Google Kalender ist auf diesem Gerät nicht verbunden.', 'NICHT_VERBUNDEN');
    const weitere = String(g.scope || '').split(/\s+/).includes(SCOPE_EVENTS);
    const auth = await this.anfordern({ weitere, loginHint: g.email || '' });
    if (g.email && auth.email && auth.email.toLowerCase() !== g.email.toLowerCase()) {
      throw new Error(`Bitte mit dem Google-Konto ${g.email} bestätigen. Für ein anderes Konto Google Kalender erst trennen und neu verbinden.`);
    }
    this.token = { accessToken: auth.accessToken, expiresAt: auth.expiresAt, scope: auth.scope };
    delete g.refreshToken;
    g.scope = auth.scope || g.scope;
    if (/bestätigen/.test(g.lastError || '')) g.lastError = null;
    await this.vault.save(this.vault.db);
    return this.status();
  }

  /**
   * Trennen. Mit gültigem Token wird die Freigabe bei Google zurückgezogen;
   * das gilt dort für die ganze Web-Fassung, auf allen Geräten. Die Sitzung
   * des Cloud-Abgleichs übersteht es (Firebase hat eine eigene).
   */
  async disconnect({ deleteCalendar = false } = {}) {
    const g = this.state();
    let geloescht = false;
    let widerrufen = false;
    if (this.tokenGueltig()) {
      if (deleteCalendar && g.calendarId) {
        try {
          await this.api('DELETE', `/calendars/${enc(g.calendarId)}`);
          geloescht = true;
        } catch { /* getrennt wird trotzdem */ }
      }
      try {
        await this.anfrage(REVOKE, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({ token: this.token.accessToken }),
          timeoutMs: 15000,
        });
        widerrufen = true;
      } catch { /* lokal wird ohnehin getrennt */ }
    }
    this.vault.db.cloud.gcal = {};
    this.token = null;
    await this.vault.save(this.vault.db);
    return { deletedCalendar: geloescht, widerrufen };
  }

  accessToken() {
    // Beim Verbinden gibt es schon ein Token, aber noch keinen Kalender.
    if (this.tokenGueltig()) return this.token.accessToken;
    this.token = null;
    const g = this.state();
    if (!(g.calendarId && g.linkedAt)) throw fehler('Google Kalender ist auf diesem Gerät nicht verbunden.', 'NICHT_VERBUNDEN');
    throw fehler('Der Kalenderabgleich wartet auf eine kurze Bestätigung bei Google.', 'BESTAETIGEN');
  }

  /* ---------------------------------------------------------------------- */
  /* Schnittstelle                                                           */
  /* ---------------------------------------------------------------------- */

  async api(method, path, body = null, query = null) {
    const qs = query
      ? '?' + Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')
      : '';
    for (let versuch = 0; ; versuch++) {
      const token = this.accessToken();
      try {
        return await this.anfrage(API + path + qs, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : null,
          timeoutMs: 30000,
        });
      } catch (err) {
        const grund = err.data?.error?.errors?.[0]?.reason || '';
        if ((err.status === 429 || /rateLimitExceeded|userRateLimitExceeded/.test(grund)) && versuch < 3) {
          await new Promise((r) => setTimeout(r, 800 * 2 ** versuch));
          continue;
        }
        // Token abgelaufen oder bei Google zurückgezogen: neu bestätigen lassen.
        if (err.status === 401) {
          this.token = null;
          throw fehler('Der Kalenderabgleich wartet auf eine kurze Bestätigung bei Google.', 'BESTAETIGEN');
        }
        throw verstaendlich(err, grund);
      }
    }
  }

  /** Findet den Kontovia-Kalender oder legt ihn an (wie früher unter Windows). */
  async ensureCalendar({ hint, timeZone }) {
    if (hint) {
      try {
        const c = await this.api('GET', `/calendars/${enc(hint)}`);
        return { id: c.id, summary: c.summary };
      } catch (err) {
        if (![403, 404, 410].includes(err.status)) throw err;
      }
    }
    try {
      const list = await this.api('GET', '/users/me/calendarList', null, { minAccessRole: 'owner', maxResults: 250 });
      const found = (list?.items || []).find((c) => String(c.description || '').includes(MARKER));
      if (found) return { id: found.id, summary: found.summary };
    } catch (err) {
      if (![403, 404].includes(err.status)) throw err;
    }
    const c = await this.api('POST', '/calendars', {
      summary: 'Kontovia',
      description: `Termine aus der Buchhaltung Kontovia. Änderungen hier kommen beim nächsten Abgleich in Kontovia an. ${MARKER}`,
      timeZone,
    });
    return { id: c.id, summary: c.summary, created: true };
  }

  async ereignisse(calendarId, timeMin) {
    const events = [];
    let pageToken;
    do {
      const r = await this.api('GET', `/calendars/${enc(calendarId)}/events`, null, {
        showDeleted: 'true', singleEvents: 'false', maxResults: 2500, timeMin, pageToken,
      });
      for (const e of r?.items || []) events.push(knapp(e));
      pageToken = r?.nextPageToken;
    } while (pageToken && events.length < 20000);
    return events;
  }

  /** Alle Ereignisse des Kontovia-Kalenders, auch gelöschte. */
  async pull({ timeZone = 'Europe/Berlin' } = {}) {
    const g = this.state();
    if (!g.calendarId) throw new Error('Es ist noch kein Kontovia-Kalender angelegt. Bitte neu verbinden.');
    let neu = false;
    let events;
    try {
      events = await this.ereignisse(g.calendarId);
    } catch (err) {
      if (err.status !== 404 && err.status !== 410) throw err;
      // Der Kalender wurde in Google gelöscht: neu anlegen, alles neu übertragen.
      const cal = await this.ensureCalendar({ hint: '', timeZone });
      g.calendarId = cal.id;
      g.calendarName = cal.summary || 'Kontovia';
      g.map = {};
      neu = true;
      await this.vault.save(this.vault.db);
      events = await this.ereignisse(g.calendarId);
    }
    return { calendarId: g.calendarId, events, map: g.map || {}, recreated: neu };
  }

  /** Die Kalender, in die Kontovia schreiben darf, ohne den eigenen. */
  async kalenderListe() {
    const g = this.state();
    const out = [];
    let pageToken;
    do {
      const r = await this.api('GET', '/users/me/calendarList', null, { minAccessRole: 'writer', maxResults: 250, pageToken });
      for (const c of r?.items || []) {
        if (!c?.id || c.id === g.calendarId || String(c.description || '').includes(MARKER) || c.deleted) continue;
        if (c.accessRole && !['owner', 'writer'].includes(c.accessRole)) continue;
        out.push({
          id: String(c.id), name: String(c.summaryOverride || c.summary || c.id).slice(0, 200),
          primary: !!c.primary, color: String(c.backgroundColor || '').slice(0, 20),
        });
      }
      pageToken = r?.nextPageToken;
    } while (pageToken && out.length < 500);
    return out.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name, 'de'));
  }

  /** Ereignisse der ausgewählten weiteren Kalender ab `timeMin`, auch gelöschte. */
  async pullWeitere({ ids = [], timeMin = '' } = {}) {
    const g = this.state();
    const liste = (Array.isArray(ids) ? ids : []).map(String).filter((id) => KALENDER_ID.test(id) && id !== g.calendarId).slice(0, 20);
    const ab = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(timeMin)) ? String(timeMin) : undefined;
    const out = [];
    for (const id of liste) {
      try {
        out.push({ calendarId: id, events: await this.ereignisse(id, ab), map: g.weitere?.[id]?.map || {} });
      } catch (err) {
        if (ABBRUCH.includes(err.code)) throw err;
        out.push({ calendarId: id, error: err.status === 404 ? 'Der Kalender ist nicht mehr erreichbar.' : err.message, map: g.weitere?.[id]?.map || {} });
      }
    }
    return out;
  }

  /** Führt die Aufträge aus der Oberfläche aus, jeden für sich geprüft. */
  async push(ops) {
    const g = this.state();
    const pfad = (op) => `/calendars/${enc(op?.calendarId && KALENDER_ID.test(String(op.calendarId)) ? op.calendarId : g.calendarId)}/events`;
    const list = Array.isArray(ops) ? ops.slice(0, 5000) : [];
    const out = new Array(list.length);
    let abbruch = null;

    const one = async (op) => {
      if (!op || !['insert', 'patch', 'delete'].includes(op.kind) || !EVENT_ID.test(String(op.eventId || ''))) {
        return { eventId: String(op?.eventId || ''), ok: false, error: 'Ungültiger Auftrag.' };
      }
      const id = String(op.eventId);
      const cal = pfad(op);
      const body = saubererKoerper(op.body);
      try {
        let ev = null;
        if (op.kind === 'delete') {
          try { await this.api('DELETE', `${cal}/${enc(id)}`); } catch (err) { if (![404, 410].includes(err.status)) throw err; }
        } else if (op.kind === 'insert') {
          try {
            ev = await this.api('POST', cal, { ...body, id });
          } catch (err) {
            // Die Kennung gibt es schon: überschreiben und wiederbeleben.
            if (err.status !== 409) throw err;
            const { id: _drop, ...rest } = body;
            ev = await this.api('PATCH', `${cal}/${enc(id)}`, rest);
          }
        } else {
          try {
            const { id: _drop, ...rest } = body;
            ev = await this.api('PATCH', `${cal}/${enc(id)}`, rest);
          } catch (err) {
            if (![404, 410].includes(err.status)) throw err;
            ev = await this.api('POST', cal, { ...body, id });
          }
        }
        return { eventId: id, ok: true, updated: ev?.updated || null };
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
      for (const [id, m] of Object.entries(weitere).slice(0, 20)) {
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

/** Nur die Felder, die der Abgleich braucht. */
function knapp(e) {
  return {
    id: e.id,
    status: e.status,
    updated: e.updated,
    created: e.created,
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: e.start,
    end: e.end,
    recurrence: e.recurrence,
    recurringEventId: e.recurringEventId,
    extendedProperties: e.extendedProperties?.private ? { private: e.extendedProperties.private } : undefined,
  };
}

/** Nur erlaubte Felder, begrenzte Längen: der Auftrag kommt aus der Oberfläche. */
function saubererKoerper(b) {
  const out = {};
  if (!b || typeof b !== 'object') return out;
  for (const [k, v] of Object.entries(b)) {
    if (!BODY_KEYS.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, k === 'description' ? 8000 : 1024);
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => String(x).slice(0, 500));
    else if (v && typeof v === 'object') {
      const text = JSON.stringify(v);
      if (text.length <= 4000) out[k] = JSON.parse(text);
    } else out[k] = v;
  }
  return out;
}

/** Googles Fehlermeldungen in etwas, womit man etwas anfangen kann. */
function verstaendlich(err, grund) {
  const text = `${err.message} ${grund}`;
  let e = err;
  if (err.status === 403 && /accessNotConfigured|has not been used|is disabled|SERVICE_DISABLED/i.test(text)) {
    e = new Error('Google Kalender steht für Kontovia gerade nicht zur Verfügung. Bitte versuchen Sie es später noch einmal; '
      + 'bleibt es dabei, melden Sie es bitte dem Hersteller.');
    e.code = 'SCHNITTSTELLE_AUS';
  } else if (err.status === 403 && /insufficient|scope/i.test(text)) {
    e = new Error('Kontovia fehlt die Berechtigung für den Kalender. Bitte trennen und neu verbinden und dabei den Kalenderzugriff erlauben.');
    e.code = 'KEINE_BERECHTIGUNG';
  }
  e.status = err.status;
  return e;
}
