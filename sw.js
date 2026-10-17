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
 * Ausnahme: Die Abo-Seite unter abo/ ist eine normale Webseite und kommt immer frisch vom Server.
 * Dazu nimmt er Dateien an, die jemand über „Teilen“ an Kontovia schickt (seit 2.43, siehe teilenAnnehmen).
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

/*
 * Teilen an Kontovia (share_target im Manifest): Das Gerät schickt die Dateien
 * als Formular an „teilen“. Einen Server dafür gibt es nicht; der Worker legt sie
 * in einen eigenen Zwischenspeicher und öffnet die App. Die App holt sie nach
 * dem Entsperren ab und löscht den Speicher (web/eingang.js, gleicher Name).
 * Bis dahin liegen sie dort unverschlüsselt, wie in der App, aus der sie kommen;
 * jedes neue Teilen ersetzt das vorige.
 */
const GETEILT = 'kontovia-geteilt';
const GETEILT_HOECHSTENS = 20;
const GETEILT_GROESSE = 40 * 1024 * 1024;

async function teilenAnnehmen(req) {
  try {
    const form = await req.formData();
    const dateien = form.getAll('dateien')
      .filter((f) => f && typeof f === 'object' && f.size > 0 && f.size <= GETEILT_GROESSE)
      .slice(0, GETEILT_HOECHSTENS);
    await caches.delete(GETEILT);
    const cache = await caches.open(GETEILT);
    for (const [i, f] of dateien.entries()) {
      await cache.put(new URL(`__kontovia/geteilt/${i}`, scope()).href, new Response(f, {
        headers: { 'content-type': f.type || 'application/octet-stream', 'x-kontovia-name': encodeURIComponent(f.name || 'Datei') },
      }));
    }
  } catch { /* Ohne lesbare Dateien öffnet Kontovia einfach. */ }
  return Response.redirect(new URL('./?geteilt=1', scope()).href, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const s = scope();
  if (url.origin !== s.origin || !url.pathname.startsWith(s.pathname)) return;
  const rel = url.pathname.slice(s.pathname.length);
  if (req.method === 'POST' && rel === 'teilen') {
    event.respondWith(teilenAnnehmen(req));
    return;
  }
  if (req.method !== 'GET') return;
  // Versionsdatei und Worker kommen immer frisch vom Server – ebenso die
  // Dateien einer neuen Fassung, die gerade geladen und geprüft wird.
  if (rel === 'version.json' || rel === 'sw.js' || url.searchParams.has('kv-neu')) return;

  // Die Abo-Seite ist eine gewöhnliche Webseite und gehört nicht zum installierten Programm:
  // immer vom Server (mit Rückfrage, ob sich etwas geändert hat), nie aus dem Zwischenspeicher der Fassung.
  if (rel === 'abo' || rel.startsWith('abo/')) {
    event.respondWith(fetch(req, { cache: 'no-cache' }));
    return;
  }

  event.respondWith((async () => {
    const version = await zeigerLesen();
    if (version) {
      const cache = await caches.open(PREFIX + version);
      // Aufrufe der Startseite – auch mit Parametern – bekommen index.html. Eine eigene Seite der
      // Fassung (etwa recht/impressum.html) bekommt sich selbst; nur was es nicht gibt, fällt auf die Startseite zurück.
      const start = new URL('index.html', s).href;
      let hit = await cache.match(rel === '' ? start : url.origin + url.pathname);
      if (!hit && req.mode === 'navigate') hit = await cache.match(start);
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
