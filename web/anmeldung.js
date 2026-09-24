/**
 * Kontovia – Anmeldung bei Google in der Web-Fassung.
 *
 * Die Windows-Fassung öffnet den Systembrowser und nimmt die Antwort über
 * einen kurzlebigen Server auf 127.0.0.1 entgegen. Das geht im Browser nicht.
 * Eine Umleitung zurück in die Seite wäre die übliche Lösung – als App auf
 * dem Home-Bildschirm eines iPhones läuft sie aber in einem eigenen
 * Browserfenster mit eigenem Speicher und findet den Rückweg nicht
 * zuverlässig.
 *
 * Deshalb der Geräte-Ablauf (RFC 8628), wie ihn auch Fernseher nutzen:
 * Kontovia zeigt einen kurzen Code, man gibt ihn auf google.com/device ein
 * – auf demselben oder einem anderen Gerät – und Kontovia fragt so lange
 * nach, bis die Freigabe erteilt ist. Keine Umleitung, kein Popup, und die
 * Google-Seite mit ihrer echten Adresszeile sieht man trotzdem.
 *
 * Dafür braucht es in der Google-Cloud-Konsole einen OAuth-Client vom Typ
 * „Fernseher und Geräte mit eingeschränkter Eingabe“. Wie beim Typ
 * „Desktop-App“ gilt dessen Client-Schlüssel nach Googles eigener Festlegung
 * nicht als geheim.
 */

import { requestJson, form } from './netz.js';

const DEVICE_ENDPOINT = 'https://oauth2.googleapis.com/device/code';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email'];

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

function readIdToken(idToken) {
  try {
    const p = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
}

/**
 * Nur Adressen von Google werden geöffnet – die Antwort kommt zwar über TLS
 * von Google, aber geöffnet wird ausschließlich, was dorthin gehört.
 */
function sichereAdresse(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && /(^|\.)google\.com$/.test(u.hostname)) return u.toString();
  } catch { /* unten */ }
  return 'https://www.google.com/device';
}

/**
 * Führt die Anmeldung durch.
 * @param {{clientId:string, clientSecret:string, scopes:string[],
 *          zeigeCode:(info:{code:string, url:string, gueltigBis:number}) => {schliessen:()=>void, abgebrochen:Promise<void>}}} opts
 */
export async function authorize({ clientId, clientSecret, scopes, zeigeCode }) {
  if (!clientId) throw new Error('Es ist keine Google-Client-ID für die Web-Fassung hinterlegt.');
  let start;
  try {
    start = await requestJson(DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: clientId, scope: (scopes || DRIVE_SCOPES).join(' ') }),
      timeoutMs: 30000,
    });
  } catch (err) {
    if (err.data?.error === 'invalid_client') {
      throw new Error('Google kennt diese Client-ID für die Anmeldung per Code nicht. Sie muss vom Typ „Fernseher und Geräte mit eingeschränkter Eingabe“ sein.');
    }
    throw err;
  }

  const gueltigBis = Date.now() + (Number(start.expires_in) || 1800) * 1000;
  let intervall = Math.max(5, Number(start.interval) || 5) * 1000;
  let abgebrochen = false;
  const anzeige = zeigeCode({
    code: String(start.user_code || ''),
    url: sichereAdresse(start.verification_url || start.verification_uri),
    gueltigBis,
  });
  anzeige.abgebrochen.then(() => { abgebrochen = true; });

  try {
    while (!abgebrochen) {
      if (Date.now() > gueltigBis) throw new Error('Der Code ist abgelaufen. Bitte die Anmeldung neu starten.');
      await schlafen(intervall);
      if (abgebrochen) break;
      let data;
      try {
        data = await requestJson(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form({
            client_id: clientId,
            client_secret: clientSecret,
            device_code: start.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          timeoutMs: 30000,
        });
      } catch (err) {
        const code = err.data?.error;
        if (code === 'authorization_pending') continue;
        if (code === 'slow_down') { intervall += 5000; continue; }
        if (code === 'access_denied') throw new Error('Die Freigabe wurde abgelehnt.');
        if (code === 'expired_token') throw new Error('Der Code ist abgelaufen. Bitte die Anmeldung neu starten.');
        // Kurzer Netzaussetzer – etwa, weil das iPhone kurz zu Safari gewechselt
        // hat – ist kein Grund aufzugeben, solange der Code gilt.
        if (!err.status) continue;
        throw new Error(`Google meldet: ${err.message}`);
      }
      if (!data?.refresh_token) {
        throw new Error('Google hat kein dauerhaftes Zugriffsrecht erteilt. Bitte in den Google-Kontoeinstellungen den Zugriff für Kontovia entfernen und erneut anmelden.');
      }
      return {
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000,
        email: readIdToken(data.id_token).email || '',
        idToken: data.id_token || '',
      };
    }
    throw new Error('Die Anmeldung wurde abgebrochen.');
  } finally {
    anzeige.schliessen();
  }
}

/** Holt ein frisches Zugriffstoken. */
export async function refresh({ clientId, clientSecret, refreshToken }) {
  const data = await requestJson(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    timeoutMs: 30000,
  });
  if (!data?.access_token) throw new Error('Google hat kein neues Zugriffstoken geliefert.');
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000,
  };
}

/** Zieht die Freigabe zurück – der Zugriff endet sofort, auch bei Google. */
export async function revoke(token) {
  if (!token) return;
  try {
    await requestJson(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ token }),
      timeoutMs: 15000,
    });
  } catch { /* Auch wenn Google nicht antwortet: lokal wird ohnehin gelöscht. */ }
}
