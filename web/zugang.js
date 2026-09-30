// Erzeugt aus src/main/zugang.js – dort ändern, nicht hier.
const module = { exports: {} };
(function (module, exports) {
'use strict';
/**
 * Kontovia – was von den Zugangsdaten die Oberfläche und die Sicherungen sehen.
 *
 * Der Cloud-Block im Bestand hält die Anmeldemerkmale für den Cloud-Abgleich
 * und für Google Kalender. Gebraucht werden sie nur dort, wo die Verbindungen
 * laufen: im Hauptprozess bzw. in der Web-Schicht. Die Oberfläche bekommt eine
 * Kopie ohne sie – was sie nicht hat, kann auch in keinem Export landen. Bis
 * Fassung 1.7 stand das Aktualisierungsmerkmal von Google im Klartext im
 * JSON-Gesamtexport, und jede Vollsicherung trug es mit.
 *
 * Ohne Abhängigkeiten, damit die Web-Fassung dieselbe Datei verwendet
 * (scripts/build-web.js macht daraus web/zugang.js).
 */

/** Felder, die eine Verbindung öffnen. */
const GEHEIM = new Set(['refreshToken', 'googleRefreshToken', 'clientSecret', 'webClientSecret']);

/**
 * Kopie ohne Anmeldemerkmale.
 * @param {any} wert  der Cloud-Block oder ein Teil davon
 * @param {{markieren?:boolean}} opts  markieren: statt des Werts nur `true`
 *   stehen lassen, damit die Oberfläche weiß, dass etwas hinterlegt ist
 */
function ohneZugangsdaten(wert, { markieren = true } = {}) {
  if (Array.isArray(wert)) return wert.map((v) => ohneZugangsdaten(v, { markieren }));
  if (!wert || typeof wert !== 'object') return wert;
  const out = {};
  for (const [k, v] of Object.entries(wert)) {
    if (GEHEIM.has(k)) {
      if (markieren && v) out[k] = true;
      continue;
    }
    out[k] = ohneZugangsdaten(v, { markieren });
  }
  return out;
}

/** Der Bestand, wie ihn die Oberfläche bekommt. */
function fuerOberflaeche(db) {
  if (!db || typeof db !== 'object' || !db.cloud) return db;
  return { ...db, cloud: ohneZugangsdaten(db.cloud) };
}

/** Der Bestand, wie er in eine Vollsicherung geht: ohne jedes Anmeldemerkmal. */
function fuerSicherung(db) {
  if (!db || typeof db !== 'object' || !db.cloud) return db;
  return { ...db, cloud: ohneZugangsdaten(db.cloud, { markieren: false }) };
}

/**
 * Beim Einspielen einer Sicherung bleibt die Verbindung dieses Geräts, wie sie
 * ist. Die Sicherung kann Wochen alt sein; ihr Cloud-Block stammt womöglich
 * von einem anderen Gerät. Nur wo hier noch nichts eingerichtet ist, gilt die
 * (merkmalfreie) Einrichtung aus der Sicherung.
 */
function cloudNachEinspielen(aktuell, ausSicherung) {
  if (aktuell && typeof aktuell === 'object' && Object.keys(aktuell).length) return aktuell;
  return ohneZugangsdaten(ausSicherung || {}, { markieren: false });
}

module.exports = { ohneZugangsdaten, fuerOberflaeche, fuerSicherung, cloudNachEinspielen };

})(module, module.exports);
export const { ohneZugangsdaten, fuerOberflaeche, fuerSicherung, cloudNachEinspielen } = module.exports;
