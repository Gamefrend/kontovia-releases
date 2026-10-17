/**
 * Kontovia – Dateien, die von außen kommen.
 *
 * Zwei Wege, beide ohne Netz und nur in der installierten App:
 *  - „Öffnen mit“ (file_handlers im Manifest, Chrome und Edge am Computer): Der Browser
 *    reicht die Dateien über `launchQueue` an das offene Fenster.
 *  - „Teilen“ (share_target, Android): sw.js nimmt die Dateien an, legt sie in den
 *    Zwischenspeicher `kontovia-geteilt` und öffnet die App mit `?geteilt=1`.
 *
 * Hier warten sie, bis der Tresor offen ist; `abholen` gibt sie einmal heraus und
 * löscht den Zwischenspeicher. Verteilt wird in der Oberfläche (lib/dateieingang.js).
 */

/** Derselbe Name wie in sw.js. */
export const GETEILT = 'kontovia-geteilt';

/** Dateien aus „Öffnen mit“, nur im Speicher dieser Seite. */
let wartend = [];

/**
 * Hört auf „Öffnen mit“ und räumt `?geteilt=1` aus der Adresse.
 * @param {(anzahl: number) => void} gemeldet  läuft, sobald Dateien warten
 */
export function beobachten(gemeldet) {
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('geteilt')) {
      url.searchParams.delete('geteilt');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
  } catch { /* Adresse bleibt, wie sie ist */ }
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    const griffe = params?.files || [];
    if (!griffe.length) return;
    const dateien = [];
    for (const g of griffe) {
      try { if (g.kind === 'file') dateien.push(await g.getFile()); } catch { /* Datei nicht mehr da */ }
    }
    if (!dateien.length) return;
    wartend.push(...dateien);
    gemeldet(dateien.length);
  });
}

/** Wie viele Dateien warten (auch geteilte im Zwischenspeicher), ohne sie herauszugeben. */
export async function anzahl() {
  let n = wartend.length;
  try {
    if (typeof caches !== 'undefined' && await caches.has(GETEILT)) n += (await (await caches.open(GETEILT)).keys()).length;
  } catch { /* kein Zwischenspeicher */ }
  return n;
}

/** Gibt alle wartenden Dateien einmal heraus (File-Objekte) und vergisst sie. */
export async function abholen() {
  const dateien = wartend;
  wartend = [];
  try {
    if (typeof caches !== 'undefined' && await caches.has(GETEILT)) {
      const cache = await caches.open(GETEILT);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (!res) continue;
        let name = 'Datei';
        try { name = decodeURIComponent(res.headers.get('x-kontovia-name') || '') || name; } catch { /* Name unlesbar */ }
        const blob = await res.blob();
        dateien.push(new File([blob], name, { type: blob.type || res.headers.get('content-type') || '' }));
      }
      await caches.delete(GETEILT);
    }
  } catch (e) { console.error('Geteilte Dateien:', e); }
  return dateien;
}
