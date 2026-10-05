/**
 * Kontovia – E-Mails direkt senden, über das Konto des Nutzers bei Google
 * (Gmail) oder Microsoft (Outlook.com, Microsoft 365).
 *
 * Kontovia hat keinen Mailserver. Gesendet wird mit der Schnittstelle des
 * Anbieters, im Namen des Nutzers und erst nach seiner Freigabe dort; die
 * E-Mail liegt danach in seinem Ordner „Gesendet“. Was gesendet wird, baut die
 * Oberfläche (lib/emailversand.js): für Gmail die fertige Nachricht (MIME),
 * für Microsoft die Nachricht als JSON. Hier wird es geprüft und abgeschickt.
 *
 * Anmeldung wie bei Google Kalender (gcal.js): ein kleines Fenster beim
 * Anbieter, das Zugriffstoken gilt rund eine Stunde und steht nur im
 * Arbeitsspeicher, nie im Tresor oder im Browser-Speicher. Sperren vergisst
 * es. Im Tresor (Cloud-Block, nur dieses Gerät) steht nur, mit welchem Konto
 * zuletzt gesendet wurde, als Vorschlag für das nächste Mal.
 *
 *   Google     Fenster aus gcal.js mit dem Bereich `gmail.send` (nur senden,
 *              kein Lesen). Google fügt ihn der bestehenden Freigabe hinzu;
 *              „Kalender trennen“ widerruft deshalb auch das Senden.
 *   Microsoft  Anmeldung mit Code und PKCE (response_mode=fragment), Tausch
 *              des Codes gegen das Token direkt aus dem Browser; die
 *              Rückkehradresse ist bei Microsoft als „Single-Page-Anwendung“
 *              eingetragen. Bereich `Mail.Send`.
 *
 * Abmelden vergisst Token und Konto, widerruft aber nichts: Ein Widerruf bei
 * Google träfe die ganze Freigabe, auch den Kalender auf anderen Geräten.
 */

import { requestJson, request, form } from './netz.js';
import { rueckAdresse, readIdToken } from './weiterleitung.js';
import { fensterOeffnen as googleFensterOeffnen, istApple } from './gcal.js';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_SENDEN = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
/* Gmail nimmt Nachrichten bis 35 MB an. */
const GMAIL_MAX = 35 * 1024 * 1024;

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_SENDEN = 'https://graph.microsoft.com/v1.0/me/sendMail';
export const MS_SCOPES = ['openid', 'profile', 'email', 'https://graph.microsoft.com/Mail.Send'];
/* Eine Anfrage an Microsoft darf höchstens 4 MB groß sein; Base64 macht Anhänge um ein Drittel größer. */
const MS_MAX = 4 * 1024 * 1024;

const MS_PRAEFIX = 'ms.';
const MS_KANAL = 'kontovia-microsoft';
const FENSTER_MS = 5 * 60 * 1000;

export const ANBIETER = ['google', 'microsoft'];

function fehler(text, code) {
  return Object.assign(new Error(text), { code });
}

const zufall = (n = 16) => crypto.getRandomValues(new Uint8Array(n));
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
function base64url(u8) {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function vonBase64(b64) {
  const s = atob(String(b64 || ''));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/* -------------------------------------------------------------------------- */
/* Fenster bei Microsoft                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Läuft im kleinen Fenster, wenn Microsoft dorthin zurückkehrt: wie
 * gcal.js: antwortWeiterreichen, nur mit eigenem Kennzeichen und Kanal.
 * Liefert true, wenn diese Seite nur dafür geladen wurde.
 */
export function msAntwortWeiterreichen({ loc = location, hist = history, opener = globalThis.opener, Kanal = globalThis.BroadcastChannel } = {}) {
  const p = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
  if (!String(p.get('state') || '').startsWith(MS_PRAEFIX)) return false;
  const nachricht = { typ: MS_KANAL, hash: String(loc.hash) };
  try { hist.replaceState(null, '', loc.pathname + loc.search); } catch { /* egal */ }
  try { opener?.postMessage(nachricht, loc.origin); } catch { /* der Kanal reicht */ }
  try {
    const k = new Kanal(MS_KANAL);
    k.postMessage(nachricht);
    k.close();
  } catch { /* ältere Browser: dann eben nur über das öffnende Fenster */ }
  return true;
}

/**
 * Liest die Antwort von Microsoft aus dem Anker.
 * @returns {null | {code:string}} null, wenn sie zu einer anderen Anfrage gehört
 */
export function msAntwortLesen(hash, { state }) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (p.get('state') !== state) return null;
  const err = p.get('error');
  // AADSTS65004: Zustimmung abgelehnt.
  if (err === 'access_denied' || /AADSTS65004/.test(p.get('error_description') || '')) {
    throw fehler('Die Freigabe wurde bei Microsoft abgebrochen.', 'ABGEBROCHEN');
  }
  if (err) throw fehler(`Microsoft meldet: ${String(p.get('error_description') || err).split(/\r?\n/)[0]}`, 'ANBIETER');
  const code = p.get('code') || '';
  if (!code) throw new Error('Die Antwort von Microsoft ließ sich nicht lesen. Bitte erneut versuchen.');
  return { code };
}

/** Die Adresse bei Microsoft. */
export function msAnfrageAdresse({ clientId, href, state, nonce, challenge, loginHint = '', prompt = '' }) {
  return `${MS_AUTH}?${form({
    client_id: clientId,
    response_type: 'code',
    response_mode: 'fragment',
    redirect_uri: rueckAdresse(href),
    scope: MS_SCOPES.join(' '),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    login_hint: loginHint,
    prompt,
  })}`;
}

/**
 * Öffnet das Fenster bei Microsoft und wartet auf den Code. Das Fenster geht
 * sofort auf (leer), damit der Browser es dem Klick zuordnet; die Adresse
 * folgt, sobald die Prüfsumme für PKCE berechnet ist.
 * @returns {{ergebnis: Promise<{code:string, verifier:string, nonce:string, redirectUri:string}>, abbrechen: () => void}}
 */
export function msFensterOeffnen({ clientId, loginHint = '', prompt = '' }, {
  href = location.href, oeffnen = (u, n, f) => window.open(u, n, f), ziel = window,
  Kanal = globalThis.BroadcastChannel, wartezeit = FENSTER_MS,
} = {}) {
  if (!clientId) throw new Error('Für Microsoft ist in Kontovia noch nichts hinterlegt.');
  const w = oeffnen('', 'kontovia-microsoft', 'popup,width=520,height=680');
  if (!w) {
    throw fehler('Der Browser hat das Fenster für Microsoft blockiert. Bitte erlauben Sie Pop-ups für Kontovia und versuchen Sie es erneut.', 'FENSTER_BLOCKIERT');
  }
  const erwartet = { state: MS_PRAEFIX + hex(zufall()), nonce: hex(zufall()) };
  const verifier = base64url(zufall(32));

  let abbrechen = () => {};
  const ergebnis = new Promise((resolve, reject) => {
    const start = Date.now();
    let kanal = null;
    let getrennt = false;
    let zuSeit = 0;
    let wache = null;
    let frist = null;
    const fertig = (fn, wert) => {
      ziel.removeEventListener('message', annehmen);
      try { kanal?.close(); } catch { /* egal */ }
      clearInterval(wache);
      clearTimeout(frist);
      try { w.close(); } catch { /* egal */ }
      fn(wert);
    };
    function annehmen(e) {
      const d = e?.data;
      if (e?.origin !== undefined && e.origin !== new URL(href).origin) return;
      if (!d || d.typ !== MS_KANAL) return;
      try {
        const antwort = msAntwortLesen(d.hash, erwartet);
        if (antwort) fertig(resolve, { ...antwort, verifier, nonce: erwartet.nonce, redirectUri: rueckAdresse(href) });
      } catch (err) {
        fertig(reject, err);
      }
    }
    ziel.addEventListener('message', annehmen);
    try {
      kanal = new Kanal(MS_KANAL);
      kanal.onmessage = (e) => annehmen({ data: e.data });
    } catch { kanal = null; }
    wache = setInterval(() => {
      if (getrennt || !w.closed) return;
      if (Date.now() - start < 1500) { getrennt = true; return; }
      zuSeit ||= Date.now();
      if (Date.now() - zuSeit > 1500) fertig(reject, fehler('Die Anmeldung wurde abgebrochen.', 'ABGEBROCHEN'));
    }, 400);
    frist = setTimeout(() => fertig(reject, new Error('Die Anmeldung bei Microsoft hat zu lange gedauert. Bitte erneut versuchen.')), wartezeit);
    abbrechen = () => fertig(reject, fehler('Die Anmeldung wurde abgebrochen.', 'ABGEBROCHEN'));

    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then((h) => {
      const url = msAnfrageAdresse({ clientId, href, ...erwartet, challenge: base64url(new Uint8Array(h)), loginHint, prompt });
      try { w.location.href = url; } catch (err) { fertig(reject, err); }
    }, (err) => fertig(reject, err));
  });
  return { ergebnis, abbrechen: () => abbrechen() };
}

/* -------------------------------------------------------------------------- */
/* Versand                                                                     */
/* -------------------------------------------------------------------------- */

/** Nur diese Teile einer Nachricht an Microsoft; alles andere fällt weg. */
function msNachrichtPruefen(n) {
  const adressen = (liste) => (Array.isArray(liste) ? liste : [])
    .map((x) => String(x?.emailAddress?.address || '').trim())
    .filter((a) => /^[^\s@<>]+@[^\s@<>]+$/.test(a))
    .map((address) => ({ emailAddress: { address } }));
  const an = adressen(n?.toRecipients);
  if (!an.length) throw fehler('Bitte eine Empfängeradresse eingeben.', 'KEIN_EMPFAENGER');
  const anhaenge = (Array.isArray(n?.attachments) ? n.attachments : []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: String(a?.name || 'anhang').slice(0, 255),
    contentType: String(a?.contentType || 'application/octet-stream').slice(0, 120),
    contentBytes: String(a?.contentBytes || '').replace(/[^A-Za-z0-9+/=]/g, ''),
  }));
  return {
    subject: String(n?.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 900),
    body: { contentType: 'Text', content: String(n?.body?.content || '') },
    toRecipients: an,
    ...(anhaenge.length ? { attachments: anhaenge } : {}),
  };
}

/** Empfänger aus den Kopfzeilen einer MIME-Nachricht (nur zum Prüfen und Melden). */
function mimeEmpfaenger(mime) {
  const kopf = new TextDecoder().decode(mime.subarray(0, Math.min(mime.length, 16384))).split('\r\n\r\n')[0];
  const zeile = /^To: (.*)$/m.exec(kopf)?.[1] || '';
  return zeile.split(',').map((s) => s.trim()).filter(Boolean);
}

export class MailVersand {
  /**
   * @param {import('./tresor.js').Vault} vault
   * @param {{googleClientId?:string, microsoftClientId?:string, googleFenster?:Function, msFenster?:Function, anfrage?:Function, roh?:Function, appleApp?:() => boolean}} opts
   *   googleFenster, msFenster, anfrage und roh ersetzen in Prüfungen die Fenster und das Netz.
   */
  constructor(vault, {
    googleClientId = '', microsoftClientId = '', googleFenster = googleFensterOeffnen, msFenster = msFensterOeffnen,
    anfrage = requestJson, roh = request,
    appleApp = () => istApple() && (globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true),
  } = {}) {
    this.vault = vault;
    this.clientIds = { google: googleClientId, microsoft: microsoftClientId };
    this.fenster = { google: googleFenster, microsoft: msFenster };
    this.anfrage = anfrage;
    this.roh = roh;
    this.appleApp = appleApp;
    this.token = { google: null, microsoft: null }; // { accessToken, expiresAt, email } – nur im Arbeitsspeicher
    this.offen = null;
  }

  zustand() {
    const db = this.vault.db;
    if (!db) throw new Error('Der Tresor ist gesperrt.');
    db.cloud ??= {};
    db.cloud.mail ??= {};
    return db.cloud.mail;
  }

  tokenGueltig(anbieter) {
    const t = this.token[anbieter];
    return !!t && t.expiresAt > Date.now();
  }

  /** Welche Wege es gibt und mit welchem Konto zuletzt gesendet wurde. */
  status() {
    const m = this.vault.db?.cloud?.mail || {};
    // Die App auf dem Home-Bildschirm von iPhone und iPad kann kein zweites Fenster offen halten.
    const fensterGeht = !this.appleApp();
    const eintrag = (a) => ({
      verfuegbar: !!this.clientIds[a] && fensterGeht,
      email: m[a]?.email || '',
      bereit: this.tokenGueltig(a),
    });
    return { google: eintrag('google'), microsoft: eintrag('microsoft') };
  }

  vergessen() {
    this.token = { google: null, microsoft: null };
    this.abbrechen();
  }

  abbrechen() {
    this.offen?.abbrechen();
    this.offen = null;
  }

  /** Token und gemerktes Konto vergessen; beim nächsten Senden fragt der Anbieter nach dem Konto. */
  async abmelden(anbieter) {
    if (!ANBIETER.includes(anbieter)) throw new Error('Unbekannter Anbieter.');
    this.token[anbieter] = null;
    const m = this.zustand();
    delete m[anbieter];
    await this.vault.save(this.vault.db);
    return this.status();
  }

  /**
   * Sendet eine E-Mail. Muss direkt aus einem Klick heraus aufgerufen werden:
   * Ohne gültige Freigabe öffnet sich zuerst das Fenster beim Anbieter.
   * @param {{anbieter:'google'|'microsoft', mimeBase64?:string, nachricht?:object}} p
   * @returns {Promise<{anbieter:string, von:string, an:string[], id:string}>}
   */
  async senden({ anbieter, mimeBase64 = '', nachricht = null } = {}) {
    if (!ANBIETER.includes(anbieter)) throw new Error('Unbekannter Anbieter.');
    if (!this.clientIds[anbieter]) throw fehler('Dieser Weg ist in Kontovia nicht eingerichtet.', 'NICHT_EINGERICHTET');
    const m = this.zustand();
    // Erst prüfen, dann anmelden: Eine fehlerhafte Nachricht soll kein Fenster öffnen.
    let inhalt;
    if (anbieter === 'google') {
      inhalt = vonBase64(mimeBase64);
      if (!inhalt.length) throw new Error('Die E-Mail ist leer.');
      if (inhalt.length > GMAIL_MAX) throw fehler('Die E-Mail ist für Gmail zu groß (höchstens 35 MB).', 'ZU_GROSS');
      if (!mimeEmpfaenger(inhalt).length) throw fehler('Bitte eine Empfängeradresse eingeben.', 'KEIN_EMPFAENGER');
    } else {
      inhalt = JSON.stringify({ message: msNachrichtPruefen(nachricht), saveToSentItems: true });
      if (inhalt.length > MS_MAX) throw fehler('Die E-Mail ist für Microsoft zu groß (mit Anhang höchstens etwa 3 MB). Bitte einen anderen Weg wählen.', 'ZU_GROSS');
    }

    // Das Fenster muss im selben Zug wie der Klick aufgehen, also vor jedem await.
    const freigabe = this.tokenGueltig(anbieter) ? Promise.resolve(this.token[anbieter]) : this.anmelden(anbieter, m[anbieter]?.email || '');
    const t = await freigabe;
    try {
      const antwort = anbieter === 'google' ? await this.gmailSenden(t, inhalt) : await this.outlookSenden(t, inhalt);
      m[anbieter] = { email: t.email || m[anbieter]?.email || '' };
      await this.vault.save(this.vault.db);
      return { anbieter, von: m[anbieter].email, an: anbieter === 'google' ? mimeEmpfaenger(inhalt) : JSON.parse(inhalt).message.toRecipients.map((x) => x.emailAddress.address), id: antwort?.id || '' };
    } catch (err) {
      // Abgelaufen oder entzogen: beim nächsten Klick neu anmelden.
      if (err.status === 401 || err.code === 'ERNEUT') this.token[anbieter] = null;
      throw err;
    }
  }

  /** Öffnet das Fenster beim Anbieter (synchron) und liefert das Token. */
  anmelden(anbieter, loginHint) {
    this.abbrechen();
    const prompt = loginHint ? '' : 'select_account';
    const offen = anbieter === 'google'
      ? this.fenster.google({ clientId: this.clientIds.google, scopes: ['openid', 'email', GMAIL_SCOPE], loginHint, prompt })
      : this.fenster.microsoft({ clientId: this.clientIds.microsoft, loginHint, prompt });
    this.offen = offen;
    return (async () => {
      try {
        const antwort = await offen.ergebnis;
        const t = anbieter === 'google' ? this.googleAngenommen(antwort) : await this.msEintauschen(antwort);
        this.token[anbieter] = t;
        return t;
      } finally {
        if (this.offen === offen) this.offen = null;
      }
    })();
  }

  googleAngenommen(auth) {
    if (!String(auth.scope || '').split(/\s+/).includes(GMAIL_SCOPE)) {
      throw fehler('Das Senden wurde im Google-Fenster nicht erlaubt. Bitte erneut versuchen und das Häkchen bei „E-Mails senden“ setzen.', 'NICHT_ERLAUBT');
    }
    return { accessToken: auth.accessToken, expiresAt: auth.expiresAt, email: auth.email || '' };
  }

  async msEintauschen({ code, verifier, nonce, redirectUri }) {
    const d = await this.anfrage(MS_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: this.clientIds.microsoft, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: MS_SCOPES.join(' ') }),
    }).catch((err) => {
      throw fehler(`Microsoft hat die Anmeldung nicht angenommen: ${err.message}`, 'ANBIETER');
    });
    const claims = readIdToken(d?.id_token || '');
    if (!d?.access_token || claims.nonce !== nonce) throw new Error('Die Antwort von Microsoft ließ sich nicht bestätigen. Bitte erneut versuchen.');
    if (!/(^|\s)(https:\/\/graph\.microsoft\.com\/)?Mail\.Send(\s|$)/i.test(String(d.scope || ''))) {
      throw fehler('Das Senden wurde bei Microsoft nicht erlaubt.', 'NICHT_ERLAUBT');
    }
    return {
      accessToken: d.access_token,
      // Eine Minute Reserve, damit keine E-Mail mit einem gerade ablaufenden Token startet.
      expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000 - 60000,
      email: String(claims.email || claims.preferred_username || ''),
    };
  }

  async gmailSenden(t, mime) {
    const res = await this.roh(GMAIL_SENDEN, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'message/rfc822', accept: 'application/json' },
      body: mime,
      timeoutMs: 120000,
    });
    let d = null;
    try { d = JSON.parse(new TextDecoder().decode(res.body)); } catch { /* kein JSON */ }
    if (res.status < 400) return { id: String(d?.id || '') };
    const grund = String(d?.error?.message || '');
    const status = d?.error?.status || '';
    if (res.status === 401) throw Object.assign(fehler('Die Freigabe für Gmail ist abgelaufen. Bitte noch einmal auf Senden klicken.', 'ERNEUT'), { status: 401 });
    if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(grund + status)) {
      throw fehler('Der Versand über Gmail ist für Kontovia noch nicht freigeschaltet. Bitte einen anderen Weg wählen.', 'SCHNITTSTELLE_AUS');
    }
    if (res.status === 403) throw Object.assign(fehler('Google erlaubt Kontovia das Senden nicht. Bitte noch einmal auf Senden klicken und das Senden erlauben.', 'ERNEUT'), { status: 401 });
    if (res.status === 429) throw fehler('Gmail nimmt gerade keine weiteren E-Mails an. Bitte später erneut versuchen.', 'ZU_VIELE');
    throw fehler(`Gmail hat die E-Mail nicht angenommen${grund ? `: ${grund}` : ''}.`, 'ANBIETER');
  }

  async outlookSenden(t, json) {
    try {
      await this.anfrage(MS_SENDEN, {
        method: 'POST',
        headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'application/json' },
        body: json,
        timeoutMs: 120000,
      });
      return { id: '' };
    } catch (err) {
      if (err.status === 401) throw Object.assign(fehler('Die Freigabe für Microsoft ist abgelaufen. Bitte noch einmal auf Senden klicken.', 'ERNEUT'), { status: 401 });
      if (err.status === 403) throw fehler('Microsoft erlaubt diesem Konto das Senden nicht. Bei Firmenkonten muss das oft die IT freigeben.', 'KEINE_BERECHTIGUNG');
      if (err.status === 413) throw fehler('Die E-Mail ist für Microsoft zu groß. Bitte einen anderen Weg wählen.', 'ZU_GROSS');
      if (err.status === 429) throw fehler('Microsoft nimmt gerade keine weiteren E-Mails an. Bitte später erneut versuchen.', 'ZU_VIELE');
      throw fehler(`Microsoft hat die E-Mail nicht angenommen: ${err.message}`, 'ANBIETER');
    }
  }
}
