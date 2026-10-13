/**
 * Kontovia – Rechenwerk der Texterkennung (eigener Worker, als klassisches Skript, nicht als Modul).
 *
 * Hier liest Tesseract.js (vendor/tesseract/, unverändert, HERKUNFT.md) den Text aus dem Foto eines Belegs.
 * Das Bild kommt von ocr.js, der Text geht dorthin zurück; der Worker behält nichts und kennt keine Buchhaltung.
 * Klassisch, weil Tesseract seinen Rechenkern mit importScripts lädt (das gibt es in Modul-Workern nicht).
 *
 * Netz: Die CSP der Seite gilt in einem Worker nicht. Deshalb ersetzt diese Datei vor allem anderen fetch und
 * importScripts durch eine Sperre: Durch kommen nur die eigenen Dateien unter vendor/tesseract/ (Rechenkern und
 * Sprachpakete Deutsch und Englisch, alle liegen mit jeder Fassung im Zwischenspeicher). XMLHttpRequest, WebSocket, EventSource und
 * WebTransport gibt es hier nicht. Ohne Netz und ohne Zwischenspeicher im Browser (cacheMethod 'none' in ocr.js).
 */

'use strict';

(() => {
  const BASIS = new URL('./vendor/tesseract/', self.location.href).href;
  const eigen = (adresse) => {
    try {
      const u = new URL(String(adresse), self.location.href);
      return u.origin === self.location.origin && u.href.startsWith(BASIS);
    } catch {
      return false;
    }
  };
  const echtesFetch = self.fetch.bind(self);
  self.fetch = (eingabe, init = {}) => {
    const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe?.url;
    if (!eigen(url)) return Promise.reject(new Error('Die Texterkennung arbeitet ohne Netz.'));
    return echtesFetch(eingabe, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }).then((res) => {
      if (res.redirected && !eigen(res.url)) throw new Error('Die Texterkennung arbeitet ohne Netz.');
      return res;
    });
  };
  const echtesImport = self.importScripts.bind(self);
  self.importScripts = (...adressen) => {
    if (!adressen.every(eigen)) throw new Error('Die Texterkennung lädt nur eigene Dateien.');
    return echtesImport(...adressen);
  };
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) {
    try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch { /* gibt es hier nicht */ }
  }
})();

self.importScripts('./vendor/tesseract/worker.min.js');
