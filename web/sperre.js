/**
 * Kontovia – Sperre bei Ruhezustand und Bildschirmsperre, Web-Fassung.
 *
 * Die Windows-Fassung erfährt beides vom Betriebssystem. Ein Browser sagt es
 * einer Seite nicht direkt, deshalb zwei Wege:
 *
 * Ruhezustand: Ein Zeitgeber tickt alle paar Sekunden. Schläft das Gerät,
 * tickt er nicht; beim Aufwachen klafft zwischen zwei Ticks eine große
 * Lücke, und Kontovia sperrt. Die Grenze liegt bei zwei Minuten, weil Chrome
 * die Zeitgeber von Tabs im Hintergrund auf einmal pro Minute bremst; das
 * soll nicht als Ruhezustand gelten.
 *
 * Bildschirmsperre: Chrome und Edge melden sie über die Idle Detection API,
 * aber nur mit Erlaubnis, um die der Browser einmal fragt. Deshalb ist das
 * ein Schalter in den Einstellungen, der nur auf diesem Gerät gilt. Safari
 * und Firefox kennen die Schnittstelle nicht; dort bleiben Inaktivität,
 * Hintergrund und Ruhezustand.
 */

const SCHALTER = 'kontovia.bildschirmsperre';

/**
 * Beobachtet die Uhr und meldet große Sprünge.
 * @returns {() => void} beendet die Beobachtung
 */
export function zeitsprungWaechter(beiSprung, { jetzt = () => Date.now(), intervall = 5000, luecke = 120000, setI = setInterval, clearI = clearInterval } = {}) {
  let zuletzt = jetzt();
  const id = setI(() => {
    const t = jetzt();
    const sprung = t - zuletzt;
    zuletzt = t;
    if (sprung > luecke) beiSprung(sprung);
  }, intervall);
  return () => clearI(id);
}

/** Kann dieser Browser eine Bildschirmsperre melden? */
export const bildschirmMoeglich = () => typeof globalThis.IdleDetector === 'function';

export function bildschirmGewuenscht(speicher = globalThis.localStorage) {
  try { return speicher?.getItem(SCHALTER) === '1'; } catch { return false; }
}

function merken(an, speicher = globalThis.localStorage) {
  try {
    if (an) speicher.setItem(SCHALTER, '1');
    else speicher.removeItem(SCHALTER);
  } catch { /* privater Modus: gilt dann nur bis zum Neuladen */ }
}

/** 'granted', 'denied', 'prompt' oder '' (nicht abfragbar). */
export async function bildschirmErlaubnis() {
  try {
    return (await navigator.permissions.query({ name: 'idle-detection' })).state;
  } catch {
    return '';
  }
}

let laufend = null; // AbortController des laufenden Beobachters

/** Beobachtet die Bildschirmsperre, wenn gewünscht und erlaubt. Ruft beiSperre auf, sobald gesperrt. */
export async function bildschirmBeobachten(beiSperre) {
  bildschirmBeenden();
  if (!bildschirmMoeglich() || !bildschirmGewuenscht()) return false;
  if (await bildschirmErlaubnis() !== 'granted') return false;
  const ctrl = new AbortController();
  laufend = ctrl;
  try {
    const d = new globalThis.IdleDetector();
    d.addEventListener('change', () => { if (d.screenState === 'locked') beiSperre(); });
    // Die kürzeste erlaubte Schwelle; gebraucht wird ohnehin nur der Bildschirmzustand.
    await d.start({ threshold: 60000, signal: ctrl.signal });
    return true;
  } catch (err) {
    if (laufend === ctrl) laufend = null;
    console.warn('Bildschirmsperre nicht beobachtbar:', err?.message || err);
    return false;
  }
}

export function bildschirmBeenden() {
  laufend?.abort();
  laufend = null;
}

/**
 * Schaltet die Sperre bei gesperrtem Bildschirm ein. Muss aus einem Tipp
 * heraus kommen, sonst fragt der Browser nicht nach der Erlaubnis.
 */
export async function bildschirmEinschalten(beiSperre) {
  if (!bildschirmMoeglich()) throw new Error('Dieser Browser kann eine Bildschirmsperre nicht melden.');
  const erlaubnis = await globalThis.IdleDetector.requestPermission();
  if (erlaubnis !== 'granted') {
    merken(false);
    throw Object.assign(new Error('Der Browser hat die Erlaubnis nicht erteilt. Sie lässt sich in den Website-Einstellungen des Browsers nachträglich geben.'), { code: 'NICHT_ERLAUBT' });
  }
  merken(true);
  return bildschirmBeobachten(beiSperre);
}

export function bildschirmAusschalten() {
  merken(false);
  bildschirmBeenden();
}

export async function bildschirmStatus() {
  return {
    moeglich: bildschirmMoeglich(),
    an: bildschirmGewuenscht(),
    erlaubnis: await bildschirmErlaubnis(),
    aktiv: !!laufend,
  };
}
