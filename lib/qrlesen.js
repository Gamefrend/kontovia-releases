/**
 * Kontovia – QR-Codes mit der Kamera lesen.
 *
 * Wo der Browser einen eigenen Strichcode-Leser hat (BarcodeDetector: Chrome,
 * Edge, Android), liest der. Sonst, etwa in Safari auf dem iPhone und in
 * Firefox, liest der eigene Leser aus lib/qrdecoder.js (reines JavaScript,
 * keine Abhängigkeit): Das Kamerabild wird verkleinert auf eine Leinwand
 * gezeichnet, die nie im Fenster erscheint, und dort gelesen. Abwechselnd mit
 * dem ganzen Bild wird die Bildmitte in voller Auflösung gelesen, damit auch
 * ein kleiner oder ferner Code klappt. Gelesen wird einige Male je Sekunde,
 * nicht in jedem Kamerabild, damit das Handy kühl bleibt.
 *
 * Bleibt die Kamera aus, gibt es weiter die Kamera-App des Handys, die die
 * Adresse aus dem QR-Code öffnet, und die Eingabe von Hand (lib/koppeln.js).
 *
 * Das Videobild bleibt im Gerät: Es geht nur in das Video-Element und den
 * Leser, wird nicht gespeichert und nicht gesendet. Der gelesene Text geht nur
 * an `beiCode`, nie in Meldungen oder Protokolle.
 */

import { qrLesen } from './qrdecoder.js';

/** Längste Seite des verkleinerten Kamerabilds für den eigenen Leser. */
const MAX_SEITE = 640;

/** Kann dieser Browser die Kamera ansprechen? (Lesen kann Kontovia dann immer, notfalls selbst.) */
export async function scannerMoeglich() {
  try {
    return typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function';
  } catch { return false; }
}

/** Den Leser des Browsers, wenn er QR-Codes kann; sonst null. */
async function browserLeser() {
  try {
    const BD = globalThis.BarcodeDetector;
    if (typeof BD !== 'function') return null;
    const formate = await BD.getSupportedFormats?.();
    if (formate && !formate.includes('qr_code')) return null;
    return new BD({ formats: ['qr_code'] });
  } catch { return null; }
}

const kameraFehler = (e) => {
  const name = e?.name || '';
  const code = name === 'NotAllowedError' || name === 'SecurityError' ? 'KAMERA_VERWEIGERT'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'KEINE_KAMERA'
      : name === 'NotReadableError' ? 'KAMERA_BELEGT' : 'KAMERA_FEHLER';
  return Object.assign(new Error(e?.message || 'Die Kamera lässt sich nicht öffnen.'), { code });
};

/**
 * Der eigene Leser: zeichnet das Kamerabild auf eine Leinwand außerhalb des
 * Fensters und liest dort. Gerade Runden das ganze Bild (verkleinert),
 * ungerade die Mitte in voller Auflösung.
 */
function eigenerLeser(video) {
  let leinwand = null;
  let ctx = null;
  let runde = 0;
  return {
    lesen() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return [];
      if (!leinwand) {
        leinwand = globalThis.document.createElement('canvas');
        ctx = leinwand.getContext('2d', { willReadFrequently: true });
      }
      const mitte = runde++ % 2 === 1 && Math.max(vw, vh) > MAX_SEITE;
      let w;
      let h;
      if (mitte) {
        w = Math.min(vw, MAX_SEITE);
        h = Math.min(vh, MAX_SEITE);
      } else {
        const f = Math.min(1, MAX_SEITE / Math.max(vw, vh));
        w = Math.round(vw * f);
        h = Math.round(vh * f);
      }
      if (leinwand.width !== w) leinwand.width = w;
      if (leinwand.height !== h) leinwand.height = h;
      if (mitte) ctx.drawImage(video, Math.round((vw - w) / 2), Math.round((vh - h) / 2), w, h, 0, 0, w, h);
      else ctx.drawImage(video, 0, 0, w, h);
      const text = qrLesen(ctx.getImageData(0, 0, w, h));
      return text ? [text] : [];
    },
    /** Die Leinwand leeren, damit kein Bild zurückbleibt. */
    leeren() {
      if (!leinwand) return;
      try { leinwand.width = 0; leinwand.height = 0; } catch { /* egal */ }
      leinwand = null;
      ctx = null;
    },
  };
}

/**
 * Öffnet die Kamera (hinten, wenn es sie gibt) und ruft `beiCode` mit dem Text jedes
 * erkannten QR-Codes auf, bis `stoppen()` aufgerufen wird. Liefert false aus `beiCode`
 * zurück, um weiterzusuchen; alles andere beendet das Suchen.
 * @param {HTMLVideoElement} video
 * @param {(text:string)=>unknown} beiCode
 * @param {{abgebrochen?:()=>boolean}} [opt]  wird nach dem Start der Kamera gefragt (Fenster inzwischen zu?)
 * @returns {Promise<{stoppen:()=>void, leser:'browser'|'eigener'|'keiner'}>}
 */
export async function scannerStarten(video, beiCode, { abgebrochen } = {}) {
  let strom;
  try {
    strom = await globalThis.navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) { throw kameraFehler(e); }
  // Während der Rechte-Abfrage wurde abgebrochen: Kamera gleich wieder aus, kein Bild lesen.
  if (abgebrochen?.()) {
    strom.getTracks().forEach((t) => t.stop());
    return { stoppen: () => {}, leser: 'keiner' };
  }
  let browser = await browserLeser();
  const eigener = eigenerLeser(video);
  let aktiv = true;
  let timer = null;
  const stoppen = () => {
    if (!aktiv) return;
    aktiv = false;
    clearTimeout(timer);
    strom.getTracks().forEach((t) => t.stop());
    try { video.srcObject = null; } catch { /* egal */ }
    eigener.leeren();
  };
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = strom;
  try { await video.play(); } catch { /* ohne Wiedergabe kein Bild; der Leser prüft es unten */ }

  const runde = async () => {
    if (!aktiv) return;
    const start = Date.now();
    try {
      if (video.readyState >= 2) {
        let texte;
        if (browser) {
          try {
            texte = (await browser.detect(video)).map((t) => t.rawValue);
          } catch {
            // Manche Geräte melden den Leser, können dann aber nicht lesen: ab jetzt der eigene.
            browser = null;
            texte = [];
          }
        } else texte = eigener.lesen();
        for (const t of texte) {
          if (!aktiv) return;
          if (t && (await beiCode(t)) !== false) { stoppen(); return; }
        }
      }
    } catch { /* ein misslungenes Bild: das nächste */ }
    // Der eigene Leser rechnet auf dem Gerät: nach jeder Runde mindestens doppelt so lange Pause.
    if (aktiv) timer = setTimeout(runde, browser ? 220 : Math.max(120, 2 * (Date.now() - start)));
  };
  runde();
  return { stoppen, leser: browser ? 'browser' : 'eigener' };
}

/* -------------------------------------------------------------------------- */
/* Kopplung: nur Kontovia-Codes, jederzeit abbrechbar                          */
/* -------------------------------------------------------------------------- */

/** Dasselbe Alphabet wie src/web/koppeln.js (ohne I, O, 0, 1). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = new RegExp(`^(?:[^#\\s]*#koppeln=)?([${ALPHABET}]{26})$`);

/**
 * Ist das ein Kopplungscode? So streng wie `codeLesen` in src/web/koppeln.js:
 * genau die Adresse mit `#koppeln=` und 26 Zeichen aus dem Alphabet (oder die
 * 26 Zeichen allein), die zwei überzähligen Bits am Ende null. Alles andere
 * (fremde QR-Codes, Werbung, WLAN) wird übergangen, das Scannen sucht weiter.
 */
export function istKopplungsCode(text) {
  const m = CODE.exec(String(text ?? ''));
  return !!m && ALPHABET.indexOf(m[1][25]) % 4 === 0;
}

/**
 * Ein Scan für das Kopplungsfenster. Startet die Kamera, reicht nur
 * Kopplungscodes weiter (einmal) und meldet nach `hinweisNachMs` ohne Treffer,
 * dass ein Tipp angebracht ist. `beenden()` gilt jederzeit, auch während die
 * Kamera noch startet (Rechte-Abfrage): Sie wird dann sofort wieder
 * ausgeschaltet, und es kommt kein Rückruf mehr.
 * @param {HTMLVideoElement} video
 * @param {{beiCode:(text:string)=>void, beiHinweis?:()=>void, hinweisNachMs?:number}} opt
 * @returns {{beenden:()=>void, bereit:Promise<void>}} `bereit` scheitert mit dem Kamerafehler
 */
export function kopplungScannen(video, { beiCode, beiHinweis, hinweisNachMs = 20000 }) {
  let beendet = false;
  let leser = null;
  let timer = null;
  const beenden = () => {
    if (beendet) return;
    beendet = true;
    clearTimeout(timer);
    leser?.stoppen();
    leser = null;
  };
  const bereit = (async () => {
    const l = await scannerStarten(video, (text) => {
      if (beendet) return true;
      if (!istKopplungsCode(text)) return false;
      // Dasselbe Bild kann mehrmals erkannt werden: weitergereicht wird nur einmal.
      beenden();
      beiCode(text);
      return true;
    }, { abgebrochen: () => beendet });
    if (beendet) { l.stoppen(); return; }
    leser = l;
    if (beiHinweis) timer = setTimeout(() => { if (!beendet) beiHinweis(); }, hinweisNachMs);
  })();
  return { beenden, bereit };
}
