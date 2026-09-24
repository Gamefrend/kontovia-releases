/**
 * Kontovia – Service Worker der Web-Fassung.
 *
 * Er macht aus der Webseite ein Programm auf dem Gerät: Alle Dateien einer
 * Fassung liegen im Cache des Browsers, Kontovia startet ohne Netz, und der
 * Server wird für den Betrieb nicht mehr gebraucht.
 *
 * Wichtiger noch ist, was er *nicht* tut: Er tauscht die Fassung nie von
 * selbst aus. Welche Fassung läuft, steht in einem Zeiger im Cache, und den
 * setzt ausschließlich die Anwendung – nachdem jemand „Aktualisieren“
 * bestätigt und die neuen Dateien gegen ihre Prüfsummen geprüft hat
 * (siehe aktualisierung.js). So gilt auch hier die Zusage der Windows-
 * Fassung: installiert wird nur nach ausdrücklicher Zustimmung.
 *
 * Diese Datei ändert sich deshalb von Fassung zu Fassung nicht. Der Browser
 * sieht keinen Grund, sie zu ersetzen, und nichts wird im Hintergrund
 * ausgetauscht.
 */

const META = 'kontovia-meta';
const ZEIGER = 'zeiger';
const PREFIX = 'kontovia-app-';

const scope = () => new URL(self.registration.scope);
const zeigerUrl = () => new URL(`__kontovia/${ZEIGER}`, scope()).href;

async function zeigerLesen() {
  const cache = await caches.open(META);
  const res = await cache.match(zeigerUrl());
  if (!res) return null;
  try { return (await res.json()).version || null; } catch { return null; }
}

async function zeigerSetzen(version) {
  const cache = await caches.open(META);
  await cache.put(zeigerUrl(), new Response(JSON.stringify({ version, gesetzt: new Date().toISOString() }), {
    headers: { 'content-type': 'application/json' },
  }));
}

/**
 * Erstinstallation: die Fassung ablegen, die der Server gerade ausliefert.
 * Liegt schon eine Fassung vor, bleibt sie – auch wenn der Server eine neuere hat.
 */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (await zeigerLesen()) return;
    const res = await fetch(new URL('version.json', scope()), { cache: 'no-store' });
    const info = await res.json();
    const cache = await caches.open(PREFIX + info.version);
    for (const f of info.files || []) {
      const url = new URL(f.path, scope());
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${f.path}: HTTP ${r.status}`);
      await cache.put(url, r);
    }
    await zeigerSetzen(info.version);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const s = scope();
  if (url.origin !== s.origin || !url.pathname.startsWith(s.pathname)) return;
  // Versionsdatei und Worker kommen immer frisch vom Server – ebenso die
  // Dateien einer neuen Fassung, die gerade geladen und geprüft wird.
  const rel = url.pathname.slice(s.pathname.length);
  if (rel === 'version.json' || rel === 'sw.js' || url.searchParams.has('kv-neu')) return;

  event.respondWith((async () => {
    const version = await zeigerLesen();
    if (version) {
      const cache = await caches.open(PREFIX + version);
      // Aufrufe der Startseite – auch mit Parametern – bekommen index.html.
      const ziel = req.mode === 'navigate' || rel === '' ? new URL('index.html', s).href : url.origin + url.pathname;
      const hit = await cache.match(ziel);
      if (hit) return hit;
    }
    return fetch(req);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'aufraeumen') {
    // Alte Fassungen entfernen, sobald die neue läuft.
    event.waitUntil((async () => {
      const aktiv = await zeigerLesen();
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== PREFIX + aktiv) await caches.delete(name);
      }
    })());
  }
});
