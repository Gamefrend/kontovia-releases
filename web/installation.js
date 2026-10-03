/**
 * Kontovia – als App auf dem Gerät ablegen (Android, Chrome, Edge).
 *
 * Chrome meldet der Seite, sobald sie sich installieren lässt
 * (`beforeinstallprompt`). Dieses Ereignis wird hier festgehalten und erst auf
 * einen Tipp hin ausgelöst: Auf dem Telefon erscheint dann das Fenster
 * „Kontovia installieren“ des Systems, und die App landet auf dem
 * Startbildschirm. Ein Knopf sitzt in der Seitenleiste und auf dem
 * Entsperrbildschirm; einmal in zwei Wochen weist ein Hinweis darauf hin.
 *
 * Wo der Browser kein solches Ereignis liefert (Samsung Internet, Firefox,
 * Chrome, wenn die Seite schon einmal abgelehnt wurde), zeigt der Knopf den
 * Weg über das Browsermenü. iPhone und iPad haben ihren eigenen Hinweis in
 * bridge.js. Der Kontovia-Code kommt dabei weder von einer Fremdadresse noch
 * wird etwas übertragen: Installieren ist reine Browsersache.
 */

const SYMBOL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
const HINWEIS_KEY = 'kontovia.installhinweis';
const ABSTAND_MS = 14 * 24 * 3600 * 1000;

export const MENUE_ANLEITUNG = 'Tippen Sie im Browser oben rechts auf das Menü (drei Punkte) und dann auf „App installieren“ '
  + 'oder „Zum Startbildschirm hinzufügen“. Danach startet Kontovia wie jede andere App und funktioniert auch ohne Netz.';

let angebot = null;
let toastFn = null;
let gemerkt = false;

export const istAppFenster = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const istAndroid = (ua = globalThis.navigator?.userAgent || '') => /Android/i.test(ua);

/** Bietet der Browser gerade die Installation an? */
export const installierbar = () => !!angebot;

/** Soll es einen Installationsknopf geben? Nicht in der installierten App, nicht auf dem iPhone. */
export function knopfSinnvoll({ standalone = istAppFenster(), android = istAndroid(), angeboten = !!angebot } = {}) {
  if (standalone) return false;
  return angeboten || android;
}

/**
 * Löst die Installation aus (nur aus einem Tipp heraus).
 * @returns {Promise<'installiert'|'abgelehnt'|'anleitung'>}
 */
export async function installieren() {
  const a = angebot;
  if (!a) {
    toastFn?.('Als App installieren', MENUE_ANLEITUNG, '', 16000);
    return 'anleitung';
  }
  // Ein Angebot lässt sich nur einmal auslösen.
  angebot = null;
  einsetzen();
  try {
    await a.prompt();
    const { outcome } = await a.userChoice;
    return outcome === 'accepted' ? 'installiert' : 'abgelehnt';
  } catch {
    return 'abgelehnt';
  }
}

function knopf(klasse, text) {
  const k = document.createElement('button');
  k.type = 'button';
  k.className = klasse;
  k.innerHTML = `${SYMBOL} <span>${text}</span>`;
  k.addEventListener('click', () => { installieren(); });
  return k;
}

/** Setzt die Knöpfe ein bzw. nimmt sie weg, je nach Stand. Läuft nach jedem Neuaufbau der Seite. */
export function einsetzen() {
  if (typeof document === 'undefined') return;
  const gewuenscht = knopfSinnvoll();
  const foot = document.querySelector('.sidebar-foot');
  if (foot) {
    const da = foot.querySelector('#kvInstall');
    if (gewuenscht && !da) {
      const k = knopf('btn block mb8', 'App installieren');
      k.id = 'kvInstall';
      k.style.justifyContent = 'flex-start';
      foot.querySelector('#lockBtn')?.before(k) ?? foot.append(k);
    } else if (!gewuenscht && da) da.remove();
  }
  for (const karte of document.querySelectorAll('.gate-card')) {
    const da = karte.querySelector('.kv-install-gate');
    if (gewuenscht && !da) {
      const k = knopf('btn ghost block kv-install-gate', 'Kontovia als App installieren');
      k.style.marginTop = '14px';
      karte.append(k);
    } else if (!gewuenscht && da) da.remove();
  }
}

function hinweisZeigen() {
  if (!toastFn || gemerkt || !angebot) return;
  try {
    const zuletzt = Number(localStorage.getItem(HINWEIS_KEY)) || 0;
    if (Date.now() - zuletzt < ABSTAND_MS) return;
    localStorage.setItem(HINWEIS_KEY, String(Date.now()));
  } catch { /* privater Modus: dann bei jedem Start, aber nur einmal je Sitzung */ }
  gemerkt = true;
  toastFn('Kontovia als App installieren',
    'Dann startet es wie jede andere App vom Startbildschirm und funktioniert auch ohne Netz. Hier tippen.',
    '', 14000)?.addEventListener('click', () => { installieren(); });
}

/**
 * Beginnt zu lauschen. Muss früh aufgerufen werden, das Ereignis kommt nur
 * einmal. `toast` ist die Meldung der Oberfläche.
 */
export function starten({ toast = null, ziel = globalThis.window } = {}) {
  toastFn = toast;
  if (!ziel) return;
  ziel.addEventListener('beforeinstallprompt', (e) => {
    // Chrome zeigt sonst von sich aus eine Leiste; Kontovia bietet den Knopf selbst an.
    e.preventDefault();
    angebot = e;
    einsetzen();
    setTimeout(hinweisZeigen, 2500);
  });
  ziel.addEventListener('appinstalled', () => {
    angebot = null;
    einsetzen();
    toastFn?.('Kontovia ist installiert', 'Sie finden die App jetzt auf dem Startbildschirm.', 'ok', 8000);
  });
  const app = ziel.document?.getElementById('app');
  if (app) new MutationObserver(einsetzen).observe(app, { childList: true });
}
