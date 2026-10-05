/**
 * Kontovia – QR-Codes mit der Kamera lesen.
 *
 * Es gibt keine Bibliothek (keine Abhängigkeiten); gelesen wird mit dem
 * Strichcode-Leser des Browsers (BarcodeDetector). Den haben Chrome, Edge und
 * Android; Safari auf dem iPhone und Firefox haben ihn nicht. Dort gilt der
 * Weg über die Kamera-App des Handys, die die Adresse aus dem QR-Code öffnet,
 * oder die Eingabe des Codes von Hand (siehe lib/koppeln.js). Ein eigener
 * Leser wäre möglich, aber eine eigene Fehlerkorrektur samt Bilderkennung ist
 * viel Code für einen Weg, den es schon zweimal anders gibt.
 *
 * Das Videobild bleibt im Gerät: Es geht nur in das Video-Element und den
 * Leser, wird nicht gespeichert und nicht gesendet.
 */

/** Kann dieser Browser die Kamera ansprechen und QR-Codes lesen? */
export async function scannerMoeglich() {
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof window.BarcodeDetector !== 'function') return false;
    const formate = await window.BarcodeDetector.getSupportedFormats?.();
    return !formate || formate.includes('qr_code');
  } catch { return false; }
}

const kameraFehler = (e) => {
  const name = e?.name || '';
  const code = name === 'NotAllowedError' || name === 'SecurityError' ? 'KAMERA_VERWEIGERT'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'KEINE_KAMERA'
      : name === 'NotReadableError' ? 'KAMERA_BELEGT' : 'KAMERA_FEHLER';
  return Object.assign(new Error(e?.message || 'Die Kamera lässt sich nicht öffnen.'), { code });
};

/**
 * Öffnet die Kamera (hinten, wenn es sie gibt) und ruft `beiCode` mit dem Text jedes
 * erkannten QR-Codes auf, bis `stoppen()` aufgerufen wird. Liefert false aus `beiCode`
 * zurück, um weiterzusuchen; alles andere beendet das Suchen.
 * @param {HTMLVideoElement} video
 * @param {(text:string)=>unknown} beiCode
 * @returns {Promise<{stoppen:()=>void}>}
 */
export async function scannerStarten(video, beiCode) {
  let strom;
  try {
    strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) { throw kameraFehler(e); }
  const leser = new window.BarcodeDetector({ formats: ['qr_code'] });
  let aktiv = true;
  const stoppen = () => {
    aktiv = false;
    strom.getTracks().forEach((t) => t.stop());
    try { video.srcObject = null; } catch { /* egal */ }
  };
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = strom;
  try { await video.play(); } catch { /* ohne Wiedergabe kein Bild; der Leser prüft es unten */ }

  const runde = async () => {
    if (!aktiv) return;
    try {
      if (video.readyState >= 2) {
        const treffer = await leser.detect(video);
        for (const t of treffer) {
          if (t.rawValue && (await beiCode(t.rawValue)) !== false) { stoppen(); return; }
        }
      }
    } catch { /* ein misslungenes Bild: das nächste */ }
    if (aktiv) setTimeout(runde, 220);
  };
  runde();
  return { stoppen };
}
