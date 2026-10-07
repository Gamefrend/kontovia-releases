/**
 * Kontovia – welcher Eintrag gerade im Blick ist.
 *
 * Die Fenster für Buchung, Aufgabe, Termin und Kontakt melden hier, was sie
 * öffnen. Der Assistent versteht damit „diese Rechnung“ oder „ist die
 * bezahlt?“ (lib/assistentfenster.js: ansichtJetzt). Gemerkt wird nur die
 * Kennung, nur im Arbeitsspeicher, und nur so lange man in derselben Ansicht
 * bleibt und es nicht lange her ist: Wer weiterklickt, meint mit „dies“
 * etwas anderes.
 */

import { router } from './router.js';

/** So lange gilt ein geöffneter Eintrag als „dieser“. */
const GILT_MS = 20 * 60 * 1000;

let stand = null;

/** Merkt sich den Eintrag, den ein Fenster gerade zeigt. */
export function fokusMerken(art, id) {
  stand = id && typeof id === 'string' ? { art, id, view: router.view, zeit: Date.now() } : null;
}

/** Der zuletzt geöffnete Eintrag dieser Ansicht, sonst null. */
export function fokus() {
  return stand && stand.view === router.view && Date.now() - stand.zeit < GILT_MS ? { art: stand.art, id: stand.id } : null;
}

export function fokusVergessen() { stand = null; }
