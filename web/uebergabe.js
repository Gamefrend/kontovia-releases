/**
 * Kontovia – angemeldet bleiben über eine Aktualisierung, Web-Fassung.
 *
 * Gegenstück zu src/main/uebergabe.js. Dort schützt die Datenschutz-API von
 * Windows den Tresorschlüssel über den Neustart. Der Browser hat nichts
 * Vergleichbares; deshalb wird der Schlüssel geteilt:
 *
 *   - Ein frischer Zufallsschlüssel umhüllt den Tresorschlüssel. Das Ergebnis
 *     liegt mit Ablaufzeit (zwei Minuten) in der Ablage des Browsers.
 *   - Der Zufallsschlüssel selbst liegt nur im Namen des Browserfensters
 *     (window.name). Der übersteht das Neuladen desselben Tabs, steht aber auf
 *     keinem Datenträger und wird beim Wechsel zu einer fremden Seite geleert.
 *
 * Wer nur die Ablage auf dem Datenträger in die Hände bekommt, hat damit
 * nichts; wer nur den Tab hat, auch nicht. Beim Start wird beides sofort
 * gelöscht, ob es passt oder nicht. Jedes Sperren aus einem anderen Grund
 * verwirft die Übergabe. Klappt etwas nicht, fragt Kontovia wie gewohnt nach
 * dem Passwort.
 */

import * as K from './kern.js';
import * as A from './ablage.js';

const PRAEFIX = 'kontovia-uebergabe:';
const AAD = K.utf8('kontovia/uebergabe/v1');
export const GUELTIG_MS = 2 * 60 * 1000;

const vonHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));

/** Legt die Übergabe für den Start der Fassung `version` ab. */
export async function ablegen(dek, { version, fenster = globalThis.window, jetzt = Date.now() } = {}) {
  const schluessel = K.randomBytes(32);
  try {
    const blob = await K.seal(schluessel, dek, AAD);
    await A.schreiben('dateien', 'uebergabe', { blob, version: String(version || ''), bis: jetzt + GUELTIG_MS });
    fenster.name = PRAEFIX + K.toHex(schluessel);
  } finally {
    K.wipe(schluessel);
  }
}

/**
 * Beim Start: Holt den Tresorschlüssel, wenn beide Hälften da sind, die Zeit
 * nicht abgelaufen ist und die Fassung stimmt. Löscht in jedem Fall beides.
 * @returns {Promise<Uint8Array|null>}
 */
export async function abholen({ version, fenster = globalThis.window, jetzt = Date.now() } = {}) {
  const name = String(fenster?.name || '');
  const hatName = name.startsWith(PRAEFIX);
  if (hatName) fenster.name = '';
  let eintrag = null;
  try { eintrag = await A.lesen('dateien', 'uebergabe'); } catch { eintrag = null; }
  if (eintrag) await A.loeschen('dateien', 'uebergabe').catch(() => {});
  if (!hatName || !eintrag?.blob) return null;
  const rest = Number(eintrag.bis) - jetzt;
  if (!(rest > 0 && rest <= GUELTIG_MS)) return null;
  if (version && eintrag.version !== String(version)) return null;
  const schluessel = vonHex(name.slice(PRAEFIX.length));
  try {
    if (schluessel.length !== 32) return null;
    return await K.open(schluessel, eintrag.blob, AAD);
  } catch {
    return null;
  } finally {
    K.wipe(schluessel);
  }
}

/** Verwirft eine noch offene Übergabe (etwa beim Sperren aus einem anderen Grund). */
export async function verwerfen({ fenster = globalThis.window } = {}) {
  if (!String(fenster?.name || '').startsWith(PRAEFIX)) return;
  fenster.name = '';
  await A.loeschen('dateien', 'uebergabe').catch(() => {});
}
