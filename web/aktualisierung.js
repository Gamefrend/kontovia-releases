/**
 * Kontovia – Programmaktualisierung der Web-Fassung.
 *
 * Das Versprechen: nachgesehen wird nur mit Zustimmung, geladen und gewechselt nur nach
 * ausdrücklicher Bestätigung, und jede Datei wird vorher gegen die
 * Prüfsumme aus der Versionsdatei geprüft.
 *
 * Ablauf:
 *   pruefen()        version.json vom eigenen Server, Versionsvergleich
 *   herunterladen()  alle Dateien der neuen Fassung in einen eigenen Cache,
 *                    jede gegen ihre SHA-256-Prüfsumme geprüft; was sich nicht
 *                    geändert hat (gleiche Prüfsumme wie in der laufenden
 *                    Fassung), wird vom Gerät übernommen statt neu geladen
 *   installieren()   den Zeiger auf die neue Fassung setzen und neu laden –
 *                    ab da liefert der Service Worker (sw.js) sie aus
 *
 * Was die Prüfsummen leisten und was nicht: Sie stellen sicher, dass genau
 * die Dateien ankommen, die in der Versionsdatei stehen. Wer den Server
 * übernimmt, kann Versionsdatei und Dateien zusammen austauschen – dagegen
 * hilft nur, das Konto, von dem veröffentlicht wird, gut zu schützen.
 */

import { compareVersions } from './updateinfo.js';

/** Wird beim Bauen eingesetzt (scripts/build-web.js). */
export const VERSION = '2.48.1';

const META = 'kontovia-meta';
const PREFIX = 'kontovia-app-';
const APP = new URL('../', import.meta.url);
export const QUELLE = new URL('version.json', APP).href;
const zeigerUrl = () => new URL('__kontovia/zeiger', APP).href;

const HEX64 = /^[a-f0-9]{64}$/;

export const offlineFaehig = () => 'serviceWorker' in navigator && 'caches' in self && isSecureContext;

/** Meldet den Service Worker an. Ohne ihn läuft Kontovia nur mit Netz. */
export async function registrieren() {
  if (!offlineFaehig()) return null;
  try {
    return await navigator.serviceWorker.register(new URL('sw.js', APP), { scope: APP.pathname, updateViaCache: 'none' });
  } catch (err) {
    console.warn('Offline-Betrieb nicht verfügbar:', err.message);
    return null;
  }
}

/**
 * Prüft eine Versionsdatei, bevor irgendetwas geladen wird.
 * Wie validateManifest in der Windows-Fassung: Fehlendes geht nicht als „egal“ durch.
 */
export function manifestPruefen(m) {
  if (!m || typeof m !== 'object') throw new Error('Der Server hat keine gültige Versionsdatei geliefert.');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) {
    throw new Error('Die Versionsdatei enthält keine gültige Versionsnummer.');
  }
  if (!Array.isArray(m.files) || !m.files.length) throw new Error('Die Versionsdatei nennt keine Programmdateien.');
  const files = m.files.map((f) => {
    const p = String(f?.path || '');
    // Nur schlichte relative Pfade innerhalb der Anwendung.
    if (!p || p.startsWith('/') || p.includes('..') || p.includes('\\') || /^[a-z]+:/i.test(p)) {
      throw new Error(`Unzulässiger Pfad in der Versionsdatei: ${p.slice(0, 80)}`);
    }
    if (!HEX64.test(String(f.sha256 || ''))) throw new Error(`Für ${p} fehlt eine gültige Prüfsumme. Das Update wurde abgebrochen.`);
    return { path: p, sha256: String(f.sha256), size: Number(f.size) || 0 };
  });
  if (!files.some((f) => f.path === 'index.html')) throw new Error('Die Versionsdatei nennt keine Startseite.');
  return {
    version: m.version,
    notes: String(m.notes || '').slice(0, 4000),
    released: String(m.released || ''),
    files,
  };
}

export async function pruefen({ silent = false } = {}) {
  let m;
  try {
    const res = await fetch(`${QUELLE}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    m = await res.json();
  } catch (err) {
    if (silent) return { configured: true, reachable: false, error: err.message };
    throw new Error(`Der Server ist nicht erreichbar: ${err.message}`);
  }
  const info = manifestPruefen(m);
  return {
    configured: true,
    reachable: true,
    current: VERSION,
    version: info.version,
    available: compareVersions(info.version, VERSION) > 0,
    notes: info.notes,
    released: info.released,
    mandatory: false,
    size: info.files.reduce((n, f) => n + f.size, 0),
    sha512: '',
    url: QUELLE,
    fileName: `Kontovia-${info.version}`,
    web: true,
    files: info.files,
  };
}

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** So oft wird eine Datei nach einem vorübergehenden Fehler des Servers (5xx, 429, Netz) noch einmal geholt. */
const WIEDERHOLUNGEN = 4;
const warten = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Holt eine Datei der neuen Fassung. Der Server (GitHub Pages) antwortet gelegentlich kurz mit 503; dann hilft
 * nur Warten und Wiederholen, mit wachsendem Abstand (0,5 / 1 / 2 / 4 s). Ein endgültiger Fehler (etwa 404)
 * wird nicht wiederholt. Jede Wiederholung bekommt eine eigene Adresse, damit kein Zwischenspeicher die
 * Fehlerantwort noch einmal ausliefert.
 */
export async function dateiHolen(url, version, pfad) {
  let letzter = null;
  for (let i = 0; i <= WIEDERHOLUNGEN; i++) {
    try {
      const adresse = new URL(url.href);
      adresse.searchParams.set('kv-neu', version);
      if (i) adresse.searchParams.set('kv-v', String(i));
      const res = await fetch(adresse.href, { cache: 'no-store', credentials: 'omit' });
      if (res.ok) return res;
      letzter = new Error(`${pfad} konnte nicht geladen werden (HTTP ${res.status}).`);
      if (res.status < 500 && res.status !== 429 && res.status !== 408) break;
    } catch (err) {
      letzter = err;
    }
    if (i < WIEDERHOLUNGEN) await warten(500 * 2 ** i);
  }
  throw letzter;
}

/**
 * Liegt diese Datei unverändert in der laufenden Fassung? Dann gibt es ihre Bytes zurück, sonst null.
 * Sicher, weil die Bytes des Geräts gegen dieselbe Prüfsumme aus der neuen Versionsdatei geprüft werden
 * wie ein Download: Was nicht genau stimmt (beschädigt, verändert), wird einfach neu geladen.
 */
export async function ausAlterFassung(alterCache, url, sha256) {
  if (!alterCache) return null;
  try {
    const hit = await alterCache.match(url.href);
    if (!hit) return null;
    const buf = await hit.arrayBuffer();
    if (await sha256Hex(buf) !== sha256) return null;
    return { buf, typ: hit.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

/** Cache der laufenden Fassung, falls es eine gibt (sonst null: dann wird alles geladen). */
async function alterCacheOeffnen(neueVersion) {
  try {
    const meta = await caches.open(META);
    const res = await meta.match(zeigerUrl());
    const v = res ? (await res.json()).version : null;
    if (!v || v === neueVersion || !/^\d+\.\d+\.\d+$/.test(v)) return null;
    return await caches.open(PREFIX + v);
  } catch {
    return null;
  }
}

/**
 * Lädt die Dateien der neuen Fassung und prüft jede einzeln. Unveränderte Dateien kommen von der
 * laufenden Fassung auf dem Gerät (gleiche Prüfsumme) und werden nicht noch einmal geladen.
 * Das Ergebnis nennt, wie viele Bytes tatsächlich übers Netz kamen (`geladen`) und wie viele nicht (`gespart`).
 * `info` kommt aus der Oberfläche zurück und wird deshalb erneut geprüft.
 */
export async function herunterladen(info, onProgress = () => {}) {
  if (!offlineFaehig()) throw new Error('Dieser Browser kann Kontovia nicht auf dem Gerät ablegen. Laden Sie die Seite einfach neu.');
  const neu = manifestPruefen({ version: info?.version, files: info?.files, notes: info?.notes });
  const name = PREFIX + neu.version;
  await caches.delete(name);
  const cache = await caches.open(name);
  const total = neu.files.reduce((n, f) => n + f.size, 0);
  const alt = await alterCacheOeffnen(neu.version);
  let received = 0;
  let geladen = 0;
  let gespart = 0;
  try {
    for (const f of neu.files) {
      const url = new URL(f.path, APP);
      const lokal = await ausAlterFassung(alt, url, f.sha256);
      if (lokal) {
        await cache.put(url, new Response(lokal.buf, { headers: { 'content-type': lokal.typ } }));
        received += lokal.buf.byteLength;
        gespart += lokal.buf.byteLength;
        onProgress({ received, total });
        continue;
      }
      // Am Service Worker vorbei (er lieferte die laufende Fassung) und am
      // Zwischenspeicher des Servers vorbei (er könnte noch die alte haben).
      const res = await dateiHolen(url, neu.version, f.path);
      const buf = await res.arrayBuffer();
      if (await sha256Hex(buf) !== f.sha256) {
        throw new Error(`Die Prüfsumme von ${f.path} stimmt nicht. Die neue Fassung wurde verworfen.`);
      }
      await cache.put(url, new Response(buf, { headers: { 'content-type': res.headers.get('content-type') || '' } }));
      received += buf.byteLength;
      geladen += buf.byteLength;
      onProgress({ received, total });
    }
  } catch (err) {
    await caches.delete(name);
    throw err;
  }
  return { path: neu.version, bytes: received, geladen, gespart };
}

/** Schaltet auf die geprüfte Fassung um. Die Seite lädt danach neu. */
export async function installieren(version) {
  const v = String(version || '');
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('Ungültige Version.');
  const cache = await caches.open(PREFIX + v);
  if (!(await cache.match(new URL('index.html', APP).href))) {
    throw new Error('Die neue Fassung liegt nicht vollständig vor. Bitte erneut herunterladen.');
  }
  const meta = await caches.open(META);
  await meta.put(zeigerUrl(), new Response(JSON.stringify({ version: v, gesetzt: new Date().toISOString() }), {
    headers: { 'content-type': 'application/json' },
  }));
  setTimeout(() => location.reload(), 400);
  return true;
}

/** Entfernt ältere Fassungen, sobald die aktuelle läuft. */
export async function aufraeumen() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    reg?.active?.postMessage({ type: 'aufraeumen' });
  } catch { /* nicht wichtig */ }
}
