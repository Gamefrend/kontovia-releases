/**
 * Kontovia – Anmeldung bei Google per Weiterleitung, Web-Fassung.
 *
 * Der Weg ohne Code: Kontovia leitet zu Google weiter, man meldet sich dort an
 * (meist genügt ein Tipp aufs Konto), und Google leitet zurück in die App.
 * Auf dem iPhone bleibt das innerhalb der App vom Home-Bildschirm; Google
 * erscheint dabei mit eigener Adresszeile, man sieht also, wo man sich
 * anmeldet. Die Anmeldung per Code (anmeldung.js) bleibt als Rückfallweg.
 *
 * Gebraucht wird nur ein ID-Token (OpenID Connect, response_type=id_token):
 * Firebase tauscht es gegen eine eigene, dauerhafte Sitzung (firebase.js).
 * Deshalb kein Client-Schlüssel und kein Zugriffsrecht auf Google-Dienste.
 * Gesichert wird der Weg über `state` (gehört die Antwort zu dieser Anfrage?)
 * und `nonce` (steht im signierten Token, das Firebase prüft).
 *
 * Die Seite lädt dabei neu – der Tresor ist danach gesperrt. Was zur Anfrage
 * gehört (state, nonce, Zweck), überbrückt den Neustart im localStorage; es
 * ist nach 15 Minuten wertlos und wird beim Zurückkommen sofort gelöscht.
 * Das Token selbst steht nur kurz im Anker der Adresse (#…), der nie an einen
 * Server geht, und wird beim Start sofort aus der Adresse entfernt.
 */

import { form } from './netz.js';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const SPEICHER = 'kontovia.weiterleitung';
const GUELTIG_MS = 15 * 60 * 1000;

function zufall() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Nutzdaten eines ID-Tokens. Geprüft wird die Signatur von Firebase beim Eintausch. */
export function readIdToken(idToken) {
  try {
    const p = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return {};
  }
}

/** Wohin Google zurückleitet: die Startseite der App, ohne Datei, Suche und Anker. */
export function rueckAdresse(href) {
  const u = new URL('./', href);
  return u.origin + u.pathname;
}

/**
 * Bereitet die Weiterleitung vor und liefert die Adresse bei Google.
 * @param {{clientId:string, zweck:string, loginHint?:string}} p
 */
export function starten({ clientId, zweck, loginHint = '' }, { speicher = localStorage, href = location.href } = {}) {
  if (!clientId) throw new Error('Für die Anmeldung per Weiterleitung ist kein Client hinterlegt.');
  const state = zufall();
  const nonce = zufall();
  const redirectUri = rueckAdresse(href);
  speicher.setItem(SPEICHER, JSON.stringify({ state, nonce, zweck, ts: Date.now() }));
  return `${AUTH}?${form({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
    login_hint: loginHint,
  })}`;
}

/**
 * Liest die Antwort von Google aus dem Anker der Adresse.
 * @returns {null | {zweck:string, idToken:string, email:string} | {zweck:string, fehler:string, abgebrochen?:boolean}}
 */
export function antwortLesen(hash, gemerkt, jetzt = Date.now()) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (!p.has('state') && !p.has('id_token') && !p.has('error')) return null;
  const zweck = gemerkt?.zweck || '';
  if (!gemerkt || gemerkt.state !== p.get('state') || !(jetzt - Number(gemerkt.ts) < GUELTIG_MS)) {
    return { zweck, fehler: 'Die Antwort von Google passte nicht zur Anfrage. Bitte erneut anmelden.' };
  }
  const error = p.get('error');
  if (error) {
    return {
      zweck,
      abgebrochen: error === 'access_denied',
      fehler: error === 'access_denied' ? 'Die Anmeldung wurde bei Google abgebrochen.' : `Google meldet: ${error}`,
    };
  }
  const idToken = p.get('id_token') || '';
  const claims = readIdToken(idToken);
  if (!idToken || claims.nonce !== gemerkt.nonce) {
    return { zweck, fehler: 'Die Anmeldung ließ sich nicht bestätigen. Bitte erneut anmelden.' };
  }
  return { zweck, idToken, email: String(claims.email || '') };
}

/**
 * Beim Start: Kam gerade eine Antwort von Google? Holt sie aus der Adresse,
 * entfernt sie dort sofort und löscht, was zur Anfrage gemerkt war.
 */
export function antwortAusAdresse({ speicher = localStorage, loc = location, hist = history } = {}) {
  if (!/(^#|&)(state|id_token|error)=/.test(loc.hash || '')) return null;
  let gemerkt = null;
  try { gemerkt = JSON.parse(speicher.getItem(SPEICHER) || 'null'); } catch { gemerkt = null; }
  try { speicher.removeItem(SPEICHER); } catch { /* egal */ }
  const hash = loc.hash;
  try { hist.replaceState(null, '', loc.pathname + loc.search); } catch { /* egal */ }
  return antwortLesen(hash, gemerkt);
}
