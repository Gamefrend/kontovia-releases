/**
 * Kontovia – Tarif-Einstellung des Betreibers: holen, merken, anwenden.
 *
 * Welche Funktion und welcher Bereich zu welchem Tarif gehört, und die Grenzen je Tarif, stehen eingebaut in
 * lib/tarife.js. Der Betreiber kann sie im Admin-Bereich ändern; die Änderung liegt als kleine, mit seinem
 * Lizenzschlüssel signierte Datei `konfig/tarife.json` im Cloud-Speicher (nur die Abweichungen von den eingebauten
 * Werten). Geholt wird sie beim Lizenzabgleich eines mit Google angemeldeten Kontos und, ohne Cloud-Konto, mit der
 * erlaubten Update-Prüfung (lib/updates.js). Ohne beides fragt das Gerät nie nach (kein Netz ohne Zustimmung).
 *
 * Gemerkt wird im Browser-Speicher nur der signierte Text; beim Start prüft die Brücke die Signatur, bevor etwas
 * gilt (src/web/lizenz.js: tarifePruefenSigniert). Eine selbst geschriebene Einstellung schaltet also nichts frei.
 * Gegen veränderten Programmcode hilft das nicht (README › Lizenzen verwalten).
 */

import { konfigAnwenden, konfigAbweichungen, konfigStand } from './tarife.js';
import { lizenzNeuMelden } from './lizenz.js';

const KEY = 'kontovia.tarifkonfig';
const api = () => globalThis.window?.kontovia;

/** Merkt den signierten Text (leer = keine Einstellung veröffentlicht). */
function merken(signiert) {
  try {
    if (signiert) localStorage.setItem(KEY, signiert);
    else localStorage.removeItem(KEY);
  } catch { /* ohne Speicher eben nicht */ }
}

/** Beim Start: den zuletzt gemerkten, signierten Stand anwenden, damit Sperren auch offline gelten. */
export async function tarifkonfigAusCache() {
  let text = '';
  try { text = localStorage.getItem(KEY) || ''; } catch { /* kein Speicher: eingebaute Werte */ }
  if (!text) return;
  try {
    konfigAnwenden(await api().lizenz.tarifePruefen(text));
  } catch {
    // Nicht signiert (ältere Fassung oder von Hand geschrieben): eingebaute Werte, und weg damit.
    konfigAnwenden(null);
    merken('');
  }
}

/**
 * Holt die Einstellung des Betreibers. `fehlt` heißt: Es gibt keine, also gelten die eingebauten Werte.
 * Bei `netz`/`unklar`/`ungueltig` bleibt der bisherige Stand.
 * @param {{ohneKonto?:boolean}} [opt] ohneKonto: auch ohne Cloud-Konto holen (nur aus der erlaubten Update-Prüfung)
 * @returns {Promise<string>} gefunden, fehlt, ohne-konto, netz, unklar, ungueltig
 */
export async function tarifkonfigHolen(opt = {}) {
  const r = await api().lizenz.tarife(opt);
  if (r?.art === 'gefunden') { konfigAnwenden(r.konfig); merken(r.signiert); } else if (r?.art === 'fehlt') { konfigAnwenden(null); merken(''); }
  return r?.art || 'unklar';
}

/** Für die Update-Prüfung: holen und, wenn sich etwas geändert hat, Kronen und offene Ansicht neu zeichnen. */
export async function tarifkonfigBeiUpdatePruefung() {
  const vorher = JSON.stringify(konfigStand());
  await tarifkonfigHolen({ ohneKonto: true });
  if (JSON.stringify(konfigStand()) !== vorher) lizenzNeuMelden();
}

/** Nur zum Ansehen auf diesem Gerät, ohne Veröffentlichung und ohne Merken (der nächste Start gilt wieder wie zuvor). */
export function tarifkonfigVorschau(stand) {
  konfigAnwenden(stand ? konfigAbweichungen(stand) : null);
  lizenzNeuMelden();
}

/** Der Betreiber veröffentlicht seinen Entwurf (alle Werte); signiert und gespeichert werden nur die Abweichungen. */
export async function tarifkonfigVeroeffentlichen(stand) {
  const abw = konfigAbweichungen(stand);
  const r = await api().lizenz.verwaltung.tarifeSetzen(abw);
  konfigAnwenden(abw);
  merken(r?.signiert || '');
  lizenzNeuMelden();
  return abw;
}

/** Die Veröffentlichung entfernen: Es gelten wieder die eingebauten Werte. */
export async function tarifkonfigEntfernen() {
  await api().lizenz.verwaltung.tarifeLoeschen();
  konfigAnwenden(null);
  merken('');
  lizenzNeuMelden();
}

/** Was der Cloud-Speicher gerade veröffentlicht hat (nur für den Betreiber). `null` = nichts, `{unsigniert:true}` = gilt nicht. */
export async function tarifkonfigVeroeffentlicht() {
  return api().lizenz.verwaltung.tarifeLesen();
}

export { konfigStand };
