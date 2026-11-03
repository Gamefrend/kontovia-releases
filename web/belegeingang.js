/**
 * Kontovia – Belege automatisch holen (SEC-62): aus einem Eingangsordner auf dem Gerät und aus dem Outlook-Postfach.
 *
 * Hier wird nur gelesen und nichts gebucht. Die Oberfläche (lib/belegeingang.js, views/belegeingang.js) zeigt, was neu
 * ist; erst ein Klick öffnet den Beleg im Buchungsfenster oder die E-Rechnung. Was schon gezeigt und übernommen oder
 * ausgeblendet wurde, steht im Tresor (`settings.belegeingang.gesehen`) und kommt nicht wieder.
 *
 *   Eingangsordner  Ein Ordner, den der Nutzer einmal wählt (File System Access, nur lesen). Den Zugriff merkt sich der
 *                   Browser je Konto unter `dateien/eingangsordner` (ablage.js: NUR_IM_BROWSER, gehört zum Gerät).
 *                   Gelesen werden nur Dateien direkt darin: PDF, Bilder und XML, höchstens 20 MB.
 *   Postfach        Microsoft Graph mit dem Bereich `Mail.Read`, eigenes Fenster wie beim Senden (mailversand.js:
 *                   Code mit PKCE). Das Token steht nur im Arbeitsspeicher, Sperren vergisst es. Gefragt werden nur
 *                   E-Mails mit Anhang seit einem Tag und nur von Absendern, die der Nutzer genannt hat; geladen werden
 *                   nur Anhänge (PDF, Bilder, XML), nie Text oder andere E-Mails. Nichts geht an Microsoft außer der
 *                   Anfrage selbst. Gmail fehlt mit Absicht: Lesen ist dort ein eingeschränkter Bereich (SEC-62).
 */

import { requestJson, form } from './netz.js';
import { readIdToken } from './weiterleitung.js';
import { msFensterOeffnen, MS_TOKEN } from './mailversand.js';
import * as A from './ablage.js';

export const POSTFACH_SCOPES = ['openid', 'profile', 'email', 'https://graph.microsoft.com/Mail.Read'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MERKER = 'eingangsordner';
export const MAX_DATEI = 20 * 1024 * 1024;
const ENDUNGEN = /\.(pdf|xml|jpe?g|png|webp|heic|heif|tiff?)$/i;
const MAX_NACHRICHTEN = 50;

const fehler = (text, code) => Object.assign(new Error(text), { code });

function base64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Kennung einer Datei im Ordner: Name, Größe und Änderungszeit (eine geänderte Datei gilt als neu). */
export const ordnerKennung = (f) => 'o:' + [f.name, f.size, f.lastModified].join('|');
/** Kennung eines Anhangs im Postfach. */
export const postfachKennung = (nachrichtId, anhangId) => 'm:' + [nachrichtId, anhangId].join('|');

/* -------------------------------------------------------------------------- */
/* Eingangsordner                                                              */
/* -------------------------------------------------------------------------- */

export class Eingangsordner {
  /** @param {{ablage?:object, waehler?:() => Promise<FileSystemDirectoryHandle>}} opt  Prüfungen setzen beides ein. */
  constructor({ ablage = A, waehler = () => globalThis.showDirectoryPicker({ id: 'kontovia-eingang', mode: 'read' }) } = {}) {
    this.ablage = ablage;
    this.waehler = waehler;
  }

  async #merker() { return this.ablage.lesen('dateien', MERKER).catch(() => null); }

  /** @returns {Promise<{moeglich:boolean, name:string, zugriff:string|null}>} */
  async status() {
    const m = await this.#merker();
    if (!m?.handle) return { moeglich: typeof globalThis.showDirectoryPicker === 'function', name: '', zugriff: null };
    let zugriff = 'granted';
    try { zugriff = (await m.handle.queryPermission?.({ mode: 'read' })) ?? 'granted'; } catch { zugriff = 'denied'; }
    return { moeglich: true, name: String(m.name || m.handle.name || ''), zugriff };
  }

  /** Den Ordner wählen (aus einem Klick heraus). */
  async waehlen() {
    let handle;
    try { handle = await this.waehler(); } catch (err) {
      if (err?.name === 'AbortError') throw fehler('Abgebrochen.', 'ABGEBROCHEN');
      throw err;
    }
    await this.ablage.schreiben('dateien', MERKER, { v: 1, handle, name: handle.name, seit: new Date().toISOString() });
    return this.status();
  }

  async vergessen() {
    await this.ablage.loeschen('dateien', MERKER);
    return this.status();
  }

  /** Zugriff erneut erbitten (der Browser fragt nach jedem Neustart einmal, aus einem Klick heraus). */
  async zugriffErbitten() {
    const m = await this.#merker();
    if (!m?.handle) return 'denied';
    try { return (await m.handle.requestPermission?.({ mode: 'read' })) ?? 'granted'; } catch { return 'denied'; }
  }

  async #dateien() {
    const m = await this.#merker();
    if (!m?.handle) throw fehler('Es ist kein Eingangsordner gewählt.', 'KEIN_ORDNER');
    const out = [];
    try {
      for await (const [name, h] of m.handle.entries()) {
        if (h.kind !== 'file' || !ENDUNGEN.test(name) || name.startsWith('.')) continue;
        out.push(h);
      }
    } catch (err) {
      throw fehler(`Der Ordner „${m.name}“ lässt sich nicht lesen. Bitte erlauben Sie den Zugriff erneut.`, err?.name === 'NotAllowedError' ? 'KEIN_ZUGRIFF' : 'ORDNER');
    }
    return out;
  }

  /**
   * Neue Dateien im Ordner (ohne die schon gesehenen), neueste zuerst.
   * @param {string[]} gesehen  Kennungen aus settings.belegeingang.gesehen
   * @returns {Promise<{kennung:string, name:string, groesse:number, datum:string, typ:string}[]>}
   */
  async neue(gesehen = []) {
    const schon = new Set(gesehen);
    const out = [];
    for (const h of await this.#dateien()) {
      const f = await h.getFile();
      const kennung = ordnerKennung(f);
      if (schon.has(kennung) || f.size > MAX_DATEI || !f.size) continue;
      out.push({ kennung, name: f.name, groesse: f.size, datum: new Date(f.lastModified).toISOString(), typ: f.type || '' });
    }
    return out.sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 200);
  }

  /** Eine Datei lesen: {name, typ, dataBase64}. */
  async lesen(kennung) {
    for (const h of await this.#dateien()) {
      const f = await h.getFile();
      if (ordnerKennung(f) !== kennung) continue;
      if (f.size > MAX_DATEI) throw fehler('Die Datei ist zu groß.', 'ZU_GROSS');
      return { name: f.name, typ: f.type || '', dataBase64: base64(new Uint8Array(await f.arrayBuffer())) };
    }
    throw fehler('Die Datei liegt nicht mehr im Ordner.', 'FEHLT');
  }
}

/* -------------------------------------------------------------------------- */
/* Outlook-Postfach                                                            */
/* -------------------------------------------------------------------------- */

export class Postfach {
  /**
   * @param {{microsoftClientId?:string, fenster?:Function, anfrage?:Function}} opt  Prüfungen ersetzen Fenster und Netz.
   */
  constructor({ microsoftClientId = '', fenster = msFensterOeffnen, anfrage = requestJson } = {}) {
    this.clientId = microsoftClientId;
    this.fenster = fenster;
    this.anfrage = anfrage;
    this.token = null; // { accessToken, expiresAt, email } – nur im Arbeitsspeicher
    this.offen = null;
  }

  bereit() { return !!this.token && this.token.expiresAt > Date.now(); }

  status() {
    return { verfuegbar: !!this.clientId, bereit: this.bereit(), email: this.token?.email || '' };
  }

  vergessen() {
    this.token = null;
    this.offen?.abbrechen();
    this.offen = null;
  }

  /** Öffnet das Fenster bei Microsoft (synchron im Klick) und liefert das Token. */
  anmelden(loginHint = '') {
    if (!this.clientId) throw fehler('Für Microsoft ist in Kontovia noch nichts hinterlegt.', 'NICHT_EINGERICHTET');
    this.offen?.abbrechen();
    const offen = this.fenster({ clientId: this.clientId, loginHint, prompt: loginHint ? '' : 'select_account', scopes: POSTFACH_SCOPES });
    this.offen = offen;
    return (async () => {
      try {
        const a = await offen.ergebnis;
        const d = await this.anfrage(MS_TOKEN, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({ client_id: this.clientId, grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirectUri, code_verifier: a.verifier, scope: POSTFACH_SCOPES.join(' ') }),
        }).catch((err) => { throw fehler(`Microsoft hat die Anmeldung nicht angenommen: ${err.message}`, 'ANBIETER'); });
        const claims = readIdToken(d?.id_token || '');
        if (!d?.access_token || claims.nonce !== a.nonce) throw new Error('Die Antwort von Microsoft ließ sich nicht bestätigen. Bitte erneut versuchen.');
        if (!/(^|\s)(https:\/\/graph\.microsoft\.com\/)?Mail\.Read(\s|$)/i.test(String(d.scope || ''))) throw fehler('Das Lesen wurde bei Microsoft nicht erlaubt.', 'NICHT_ERLAUBT');
        this.token = { accessToken: d.access_token, expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000 - 60000, email: String(claims.email || claims.preferred_username || '') };
        return this.token;
      } finally {
        if (this.offen === offen) this.offen = null;
      }
    })();
  }

  async #graph(pfad) {
    try {
      return await this.anfrage(`${GRAPH}${pfad}`, { headers: { authorization: `Bearer ${this.token.accessToken}` }, timeoutMs: 60000, maxBytes: 40 * 1024 * 1024 });
    } catch (err) {
      if (err.status === 401) { this.token = null; throw Object.assign(fehler('Die Freigabe für Outlook ist abgelaufen. Bitte noch einmal auf „Postfach prüfen“ klicken.', 'ERNEUT'), { status: 401 }); }
      if (err.status === 403) throw fehler('Microsoft erlaubt diesem Konto das Lesen nicht. Bei Firmenkonten muss das oft die IT freigeben.', 'KEINE_BERECHTIGUNG');
      if (err.status === 429) throw fehler('Outlook nimmt gerade keine Anfragen an. Bitte später erneut versuchen.', 'ZU_VIELE');
      throw fehler(`Outlook hat nicht geantwortet: ${err.message}`, 'ANBIETER');
    }
  }

  /**
   * Anhänge neuer E-Mails der genannten Absender. Ohne gültiges Token öffnet sich zuerst das Fenster (im Klick aufrufen).
   * @param {{absender:string[], seit:string, gesehen?:string[]}} p  seit: Tag (JJJJ-MM-TT), ab dem gesucht wird
   * @returns {Promise<{kennung:string, name:string, groesse:number, datum:string, typ:string, von:string, betreff:string, dataBase64:string}[]>}
   */
  async holen({ absender = [], seit, gesehen = [] } = {}) {
    const liste = [...new Set(absender.map((a) => String(a).trim().toLowerCase()).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$|^@[^\s@]+\.[^\s@]+$/.test(a)))];
    if (!liste.length) throw fehler('Bitte nennen Sie mindestens einen Absender, etwa die Adresse, von der Ihre Rechnungen kommen.', 'KEIN_ABSENDER');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(seit || ''))) throw fehler('Bitte einen Tag wählen, ab dem gesucht wird.', 'ZEITRAUM');
    if (!this.bereit()) await this.anmelden();
    const schon = new Set(gesehen);
    const passt = (adresse) => {
      const a = String(adresse || '').toLowerCase();
      return liste.some((x) => (x.startsWith('@') ? a.endsWith(x) : a === x));
    };
    // Graph verlangt die Sortierspalte zuerst im Filter. Die Teile stehen einzeln, sie sind Schlüssel, kein Text.
    const ab = new Date(seit).toISOString();
    const abfrage = {
      $filter: ['receivedDateTime', 'ge', ab, 'and', 'hasAttachments', 'eq', 'true'].join(' '),
      $select: ['id', 'subject', 'from', 'receivedDateTime'].join(','),
      $orderby: ['receivedDateTime', 'desc'].join(' '),
      $top: MAX_NACHRICHTEN,
    };
    const d = await this.#graph('/me/messages?' + Object.entries(abfrage).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'));
    const out = [];
    for (const n of Array.isArray(d?.value) ? d.value : []) {
      const von = n?.from?.emailAddress?.address || '';
      if (!passt(von)) continue;
      const anh = await this.#graph(`/me/messages/${encodeURIComponent(n.id)}/attachments`);
      for (const x of Array.isArray(anh?.value) ? anh.value : []) {
        if (x['@odata.type'] !== '#microsoft.graph.fileAttachment' || x.isInline || !ENDUNGEN.test(String(x.name || ''))) continue;
        const kennung = postfachKennung(n.id, x.id);
        if (schon.has(kennung) || !(Number(x.size) > 0) || Number(x.size) > MAX_DATEI || typeof x.contentBytes !== 'string') continue;
        out.push({
          kennung, name: String(x.name).slice(0, 200), groesse: Number(x.size), datum: String(n.receivedDateTime || ''), typ: String(x.contentType || ''),
          von, betreff: String(n.subject || '').slice(0, 200), dataBase64: x.contentBytes,
        });
      }
    }
    return out;
  }
}
