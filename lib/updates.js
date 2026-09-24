/**
 * Kontovia – Überwachung auf neue Programmversionen.
 *
 * Bewusst ohne Bezug zur Oberfläche: hier steht nur, *ob* und *wann* gefragt
 * wird und was dabei herauskam. Wie das Ergebnis aussieht, entscheiden die
 * Ansichten – die Seitenleiste zeigt einen Knopf, die Einstellungen eine Karte.
 *
 * Zwei Dinge sind Absicht:
 *
 *  - Es wird nichts abgefragt, solange die Nutzerin oder der Nutzer die
 *    Prüfung nicht eingeschaltet hat. Die Zustimmung wird einmal abgefragt
 *    (siehe `askUpdateConsent` in app.js) und im Tresor festgehalten.
 *  - Ein Fund wird höchstens einmal je Version gemeldet. Wer „Später“ wählt,
 *    soll nicht alle sechs Stunden dasselbe Fenster sehen; der Knopf in der
 *    Seitenleiste bleibt aber stehen, damit die neue Fassung auffindbar ist.
 */

const api = window.kontovia;

/** Abstand zwischen zwei Prüfungen, solange das Programm offen ist. */
const INTERVALL_MS = 6 * 60 * 60 * 1000;

export const updateState = {
  /** Angaben zur verfügbaren Fassung, sonst null. */
  info: null,
  /** Zeitpunkt der letzten erfolgreichen Prüfung. */
  lastCheck: null,
  /** Version, zu der bereits ein Hinweis angezeigt wurde. */
  notified: null,
  running: false,
};

const watchers = new Set();

/** Meldet sich auf Funde an und gibt die Abmeldefunktion zurück. */
export function onUpdate(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function emit(neu) {
  for (const fn of watchers) {
    try { fn(updateState, neu); } catch (err) { console.error('Update-Hinweis:', err); }
  }
}

/**
 * Fragt beim Update-Server nach.
 *
 * Zurück kommt immer die vollständige Antwort – auch „schon aktuell“ und
 * „Server nicht erreichbar“, weil die Karte unter „Einstellungen“ beides
 * anzeigen muss. Der Zustand hier merkt sich nur den Fall, der einen Hinweis
 * rechtfertigt.
 *
 * @param {{silent?:boolean}} opts  silent unterdrückt Fehler bei fehlendem Netz
 * @returns {Promise<object|null>}  Antwort des Servers, null nur bei Fehler
 */
export async function checkUpdates({ silent = true } = {}) {
  updateState.running = true;
  try {
    const info = await api.update.check(silent);
    updateState.lastCheck = new Date().toISOString();
    const hatte = !!updateState.info;
    if (info?.available) {
      updateState.info = info;
      emit(updateState.notified !== info.version);
    } else {
      // Auch der Rückweg zählt: nach einer Aktualisierung verschwindet der
      // Hinweis von selbst, ohne dass jemand das Programm neu starten muss.
      updateState.info = null;
      if (hatte) emit(false);
    }
    return info;
  } catch (err) {
    if (!silent) throw err;
    return null;
  } finally {
    updateState.running = false;
  }
}

/** Merkt sich, dass zu dieser Fassung bereits ein Hinweis kam. */
export function markNotified(version) {
  updateState.notified = version || updateState.info?.version || null;
}

let timer = null;

/**
 * Startet die wiederkehrende Prüfung. Mehrfaches Aufrufen ist unschädlich –
 * die Funktion läuft nach jedem Entsperren erneut.
 */
export function startUpdateWatch() {
  stopUpdateWatch();
  checkUpdates({ silent: true });
  timer = setInterval(() => checkUpdates({ silent: true }), INTERVALL_MS);
}

export function stopUpdateWatch() {
  if (timer) clearInterval(timer);
  timer = null;
}
