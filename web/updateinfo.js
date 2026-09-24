// Erzeugt aus src/main/updateinfo.js – dort ändern, nicht hier.
const module = { exports: {} };
(function (module, exports) {
'use strict';
/**
 * Kontovia – Auswertung der Versionsdatei.
 *
 * Bewusst ohne jede Abhängigkeit zu Electron: Das hier ist die einzige Stelle,
 * an der Kontovia entscheidet, ob fremder Code heruntergeladen und ausgeführt
 * wird. Als reine Funktion lässt sie sich ohne Fenster und ohne Netz prüfen –
 * und genau das tut scripts/check.js.
 */

/** Vergleicht zwei Versionen nach dem Muster MAJOR.MINOR.PATCH. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Prüft eine Versionsdatei, bevor irgendetwas heruntergeladen wird.
 *
 * Streng nach dem Grundsatz, dass Fehlendes nicht als „egal" durchgeht:
 * ohne wohlgeformte SHA-512-Prüfsumme und ohne HTTPS-Adresse wird abgebrochen.
 * Ein Manifest ohne Prüfsumme dürfte sonst dazu führen, dass eine ungeprüfte
 * Datei gestartet wird.
 */
function validateManifest(manifest, currentVersion) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Der Update-Server hat keine gültige Versionsdatei geliefert.');
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Die Versionsdatei enthält keine gültige Versionsnummer.');
  }
  const setup = manifest.setup || {};
  if (!setup.url || !/^https:\/\/[^\s]+$/.test(String(setup.url))) {
    throw new Error('Die Versionsdatei enthält keine gültige Download-Adresse.');
  }
  if (!/^[a-f0-9]{128}$/i.test(String(setup.sha512 || ''))) {
    throw new Error('Die Versionsdatei enthält keine gültige SHA-512-Prüfsumme – Abbruch.');
  }
  return {
    configured: true,
    reachable: true,
    current: currentVersion,
    version: manifest.version,
    available: compareVersions(manifest.version, currentVersion) > 0,
    notes: String(manifest.notes || '').slice(0, 4000),
    released: manifest.released || '',
    mandatory: !!manifest.mandatory,
    size: Number(setup.size) || 0,
    sha512: String(setup.sha512).toLowerCase(),
    url: String(setup.url),
    // Der Dateiname landet im Dateisystem – alles außer Buchstaben, Ziffern,
    // Punkt und Bindestrich wird ersetzt, damit kein Pfad daraus wird.
    fileName: String(setup.file || 'Kontovia-Setup.exe').replace(/[^\w.-]/g, '_'),
  };
}

module.exports = { compareVersions, validateManifest };

})(module, module.exports);
export const { compareVersions, validateManifest } = module.exports;
