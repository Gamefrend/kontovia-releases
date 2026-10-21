/**
 * Kontovia – Erinnerungen an Termine: als Hinweis im Programm und, nach
 * Zustimmung, als Benachrichtigung des Geräts.
 *
 * Läuft nur, solange Kontovia geöffnet und entsperrt ist, auch als Reiter im
 * Hintergrund oder minimiert. Es gibt keinen Server, der die Seite weckt;
 * eine Benachrichtigung bei geschlossenem Programm bräuchte einen solchen
 * Dienst und bleibt eine Entscheidung des Betreibers.
 *
 * Benachrichtigungen des Geräts erscheinen nur, wenn das auf diesem Gerät
 * eingeschaltet ist (prefs.erinnerungen = 'geraet') und der Browser es
 * erlaubt hat. Sonst gibt es den Hinweis im Programm. Was schon erinnert
 * wurde, merkt sich dieses Gerät (localStorage), damit nach dem Entsperren
 * nichts doppelt kommt. Ins Netz geht dabei nichts.
 */

import { store, sel } from './store.js';
import { faelligeErinnerungen } from './kalender.js';
import { prefs, setPref } from './prefs.js';
import { toast } from './ui.js';
import { fmtDateShort } from './util.js';
import { t } from './sprache.js';
import { eintragOeffnen } from './oeffnen.js';

const KEY = 'kontovia.erinnert';
const TAKT_MS = 30 * 1000;
const RUECKBLICK_MS = 12 * 60 * 60 * 1000;
const MERKEN_MS = 3 * 24 * 60 * 60 * 1000;

let timer = null;
let zuletzt = null;

function speicher() {
  try { return globalThis.localStorage; } catch { return null; }
}

/** Schon gezeigte Erinnerungen (Schlüssel → Zeitpunkt), alte fallen heraus. */
function gemerkt() {
  try {
    const roh = JSON.parse(speicher()?.getItem(KEY) || '{}');
    const grenze = Date.now() - MERKEN_MS;
    const out = {};
    for (const [k, v] of Object.entries(roh)) if (Number(v) > grenze) out[k] = Number(v);
    return out;
  } catch {
    return {};
  }
}

function merken(map) {
  try { speicher()?.setItem(KEY, JSON.stringify(map)); } catch { /* egal */ }
}

/** Kann dieses Gerät überhaupt Benachrichtigungen zeigen? */
export function benachrichtigungMoeglich() {
  return typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function';
}

/** Stand auf diesem Gerät: Programmhinweise immer, Gerät nur nach Zustimmung. */
export function erinnerungenStatus() {
  const erlaubnis = benachrichtigungMoeglich() ? Notification.permission : 'unsupported';
  return {
    moeglich: benachrichtigungMoeglich(),
    erlaubnis, // granted | denied | default | unsupported
    geraet: prefs.erinnerungen === 'geraet' && erlaubnis === 'granted',
    gewuenscht: prefs.erinnerungen === 'geraet',
    aus: prefs.erinnerungen === 'aus',
  };
}

/**
 * Benachrichtigungen des Geräts einschalten. Muss direkt aus einem Tipp
 * kommen, sonst fragt der Browser nicht. Liefert die Erlaubnis.
 */
export async function geraetEinschalten() {
  if (!benachrichtigungMoeglich()) return 'unsupported';
  let erlaubnis = Notification.permission;
  if (erlaubnis === 'default') {
    try { erlaubnis = await Notification.requestPermission(); } catch { erlaubnis = Notification.permission; }
  }
  setPref('erinnerungen', erlaubnis === 'granted' ? 'geraet' : prefs.erinnerungen || '');
  return erlaubnis;
}

/** Benachrichtigungen des Geräts aus (Hinweise im Programm bleiben) oder alles aus. */
export function erinnerungenSetzen(modus) {
  setPref('erinnerungen', modus === 'aus' ? 'aus' : modus === 'geraet' ? 'geraet' : '');
}

/** Zeigt eine Benachrichtigung des Geräts; auf dem Telefon über den Service Worker. */
async function geraetZeigen(titel, text, tag) {
  const optionen = { body: text, tag, icon: new URL('icons/icon-192.png', document.baseURI).href, badge: new URL('icons/icon-192.png', document.baseURI).href, data: { url: document.baseURI } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) { await reg.showNotification(titel, optionen); return true; }
  } catch { /* dann direkt */ }
  try {
    const n = new Notification(titel, optionen);
    n.onclick = () => { try { window.focus(); } catch { /* egal */ } n.close(); };
    return true;
  } catch {
    return false;
  }
}

/** Eine fällige Erinnerung zeigen: im Programm, dazu auf Wunsch am Gerät. */
async function zeigen(e) {
  const a = e.termin;
  const wann = a.allDay || !a.startTime ? t('ganztägig') : a.startTime;
  const text = `${fmtDateShort(e.occurrence)}, ${wann}${a.location ? ' · ' + a.location : ''}`;
  const node = toast(`${t('Erinnerung')}: ${e.title}`, text, 'info', 12000);
  node.style.cursor = 'pointer';
  node.addEventListener('click', () => { eintragOeffnen('termin', e.id).catch(() => {}); });
  if (erinnerungenStatus().geraet) await geraetZeigen(e.title, text, e.key);
}

/** Prüft, was seit dem letzten Mal fällig wurde, und zeigt es (höchstens fünf auf einmal). */
export async function erinnerungenPruefen({ jetzt = new Date() } = {}) {
  if (!store.db || prefs.erinnerungen === 'aus') return [];
  const von = zuletzt || new Date(jetzt.getTime() - RUECKBLICK_MS);
  zuletzt = jetzt;
  const schon = gemerkt();
  const faellig = faelligeErinnerungen(sel.appointments(), { von, bis: jetzt }).filter((e) => !schon[e.key]);
  const zeigenJetzt = faellig.slice(-5);
  for (const e of faellig) schon[e.key] = jetzt.getTime();
  merken(schon);
  for (const e of zeigenJetzt) await zeigen(e);
  return zeigenJetzt;
}

/** Nach dem Entsperren: regelmäßig nachsehen, zuerst gleich einmal. */
export function erinnerungenStarten() {
  erinnerungenStoppen();
  zuletzt = null;
  const lauf = () => erinnerungenPruefen().catch((e) => console.warn('Erinnerungen:', e.message));
  timer = setInterval(lauf, TAKT_MS);
  setTimeout(lauf, 1500);
}

export function erinnerungenStoppen() {
  clearInterval(timer);
  timer = null;
  zuletzt = null;
}
