/** Winziger Router – hält die aktuelle Ansicht und benachrichtigt die Hülle. */

/**
 * `leaveGuard` setzt eine Ansicht mit ungesicherten Eingaben (etwa die
 * Einstellungen). Vor jedem Wechsel wird sie gefragt; liefert sie false,
 * bleibt die Ansicht stehen. Beim Sperren wird sie verworfen.
 *
 * `vorZurueck` wird bei der Zurück-Taste des Browsers zuerst gefragt (die
 * Hülle schließt damit ein offenes Fenster); liefert sie true, war das der
 * ganze Schritt.
 */
export const router = { view: 'dashboard', params: {}, handler: null, leaveGuard: null, vorZurueck: null };

export function onNavigate(fn) { router.handler = fn; }

/*
 * Zurück-Taste des Browsers.
 *
 * Kontovia ist eine einzige Seite. Ohne eigene Einträge im Browserverlauf
 * führte „Zurück“ aus ihr hinaus, etwa zurück zu Google. Darum legt jeder
 * Ansichtswechsel einen Eintrag an; „Zurück“ und „Vor“ gehen dann einen
 * Schritt in Kontovia. Die Einträge tragen nur eine Nummer (history.state);
 * Ansicht und Angaben dazu bleiben im Speicher, denn sie dürfen Funktionen
 * enthalten, die sich nicht im Verlauf ablegen lassen.
 *
 * Eintrag 0 ist ein Anschlag vor der ersten Ansicht: Wer ihn erreicht, hat
 * die Taste einmal zu oft gedrückt und bleibt in der aktuellen Ansicht.
 */
const sitzung = Math.random().toString(36).slice(2);
/** eintraege[n] = { view, params }; Eintrag 0 ist der Anschlag. */
let eintraege = [null];
let pos = -1;
/** Anzahl der Verlaufsschritte, die wir selbst ausgelöst haben und überhören. */
let ueberhoeren = 0;

const hatVerlauf = () => typeof history !== 'undefined' && typeof addEventListener === 'function' && typeof history.pushState === 'function';
const marke = (n) => ({ kv: n, s: sitzung });
const gleich = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

function verlaufAnlegen(ersetzen) {
  if (!hatVerlauf()) return;
  try {
    if (pos < 0) {
      // Erster Aufruf dieser Seite: der geladene Eintrag wird zum Anschlag, darauf folgt die Ansicht.
      history.replaceState(marke(0), '');
      history.pushState(marke(1), '');
      eintraege = [null, { view: router.view, params: router.params }];
      pos = 1;
      return;
    }
    if (ersetzen) {
      history.replaceState(marke(pos), '');
      eintraege[pos] = { view: router.view, params: router.params };
    } else {
      eintraege.length = pos + 1;
      history.pushState(marke(pos + 1), '');
      eintraege.push({ view: router.view, params: router.params });
      pos += 1;
    }
  } catch { /* ohne Verlauf bleibt es bei der alten Bedienung */ }
}

async function zurueckgegangen(e) {
  if (ueberhoeren > 0) { ueberhoeren -= 1; return; }
  const st = e.state;
  const n = st && st.s === sitzung && Number.isInteger(st.kv) ? st.kv : 0;

  // Ein offenes Fenster schließt zuerst; die Ansicht dahinter bleibt, wo sie ist.
  if (router.vorZurueck?.()) {
    if (n !== pos) { ueberhoeren += 1; history.go(pos - n); }
    return;
  }

  // Anschlag erreicht oder ein Eintrag aus einer früheren Sitzung dieser Seite: in Kontovia bleiben.
  if (n === 0 || !eintraege[n]) {
    eintraege = [null, { view: router.view, params: router.params }];
    pos = 1;
    try { history.pushState(marke(1), ''); } catch { /* egal */ }
    return;
  }

  const ziel = eintraege[n];
  if (router.leaveGuard) {
    const guard = router.leaveGuard;
    if (!(await guard())) {
      // Der Schritt wird zurückgenommen; die Ansicht bleibt stehen.
      ueberhoeren += 1;
      history.go(pos - n);
      return;
    }
    if (router.leaveGuard === guard) router.leaveGuard = null;
  }
  pos = n;
  router.view = ziel.view;
  router.params = ziel.params;
  if (router.handler) router.handler(ziel.view, ziel.params);
}

if (hatVerlauf()) addEventListener('popstate', zurueckgegangen);

/**
 * @param {string} view
 * @param {object} [params]
 * @param {{ersetzen?: boolean}} [opts]  `ersetzen`: den aktuellen Verlaufseintrag
 *   überschreiben statt einen neuen anzulegen (Start, Entsperren).
 */
export async function navigate(view, params = {}, { ersetzen = false } = {}) {
  if (router.leaveGuard) {
    const guard = router.leaveGuard;
    if (!(await guard())) return;
    if (router.leaveGuard === guard) router.leaveGuard = null;
  }
  // Dieselbe Ansicht noch einmal anzusteuern (etwa über den Menüpunkt) legt keinen Eintrag an.
  const wiederholung = pos > 0 && view === router.view && gleich(params, router.params);
  router.view = view;
  router.params = params;
  verlaufAnlegen(ersetzen || wiederholung);
  if (router.handler) router.handler(view, params);
}

export function refresh() {
  if (router.handler) router.handler(router.view, router.params);
}
