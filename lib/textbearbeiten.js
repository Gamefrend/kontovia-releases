/**
 * Kontovia – Text direkt auf der Vorschau ändern (Doppelklick).
 *
 * Legt ein Eingabefeld genau über den Text auf dem Blatt, in derselben
 * Schriftgröße. Jede Eingabe geht sofort an den Aufrufer, der den Wert dort
 * ablegt, wo er hingehört, und die übrigen Felder mit demselben Wert
 * nachzieht (Fenster am Teil, Karte links, Rechnungsformular). Die
 * Vorschau wird dabei laufend neu gezeichnet.
 *
 * Fertig ist es mit einem Klick daneben oder Strg+Enter; Escape verwirft
 * die Änderung und stellt den alten Text wieder her.
 */

/**
 * @param {HTMLElement} host  positionierter Rahmen um das Blatt (position: relative)
 * @param {object} o
 * @param {number} o.x o.y o.b o.h  Lage und Größe des Textes im Rahmen (Pixel)
 * @param {number} o.schrift  Schriftgröße in Pixel
 * @param {string} o.text  Ausgangstext
 * @param {string} [o.farbe] [o.ausrichtung] [o.fett]
 * @param {(text:string) => void} o.beiAenderung  bei jeder Eingabe
 * @param {(abbruch:boolean, urspruenglich:string) => void} [o.beiEnde]
 * @param {string} [o.label]  Name für Screenreader
 * @returns {{feld:HTMLTextAreaElement, ende:(abbruch?:boolean)=>void}}
 */
export function textDirektBearbeiten(host, { x, y, b, h, schrift, text, farbe = '#14181d', ausrichtung = 'left', fett = false, beiAenderung, beiEnde, label = 'Text' }) {
  const urspruenglich = String(text ?? '');
  const feld = document.createElement('textarea');
  feld.className = 're-inline';
  feld.value = urspruenglich;
  feld.setAttribute('aria-label', `${label}: direkt bearbeiten. Strg+Enter oder Klick daneben beendet, Escape verwirft.`);
  feld.spellcheck = true;
  const breite = Math.max(b, 160);
  Object.assign(feld.style, {
    left: `${Math.max(0, Math.min(x, host.clientWidth - Math.min(breite, host.clientWidth)))}px`,
    top: `${Math.max(0, y)}px`,
    width: `${Math.min(breite, host.clientWidth)}px`,
    minHeight: `${Math.max(h, schrift * 1.6)}px`,
    fontSize: `${Math.max(9, schrift)}px`,
    color: farbe,
    textAlign: ausrichtung === 'mitte' ? 'center' : ausrichtung === 'rechts' ? 'right' : 'left',
    fontWeight: fett ? '700' : '400',
  });
  host.append(feld);

  const anpassen = () => {
    feld.style.height = 'auto';
    feld.style.height = `${Math.max(feld.scrollHeight + 2, h)}px`;
  };
  let fertig = false;
  const ende = (abbruch = false) => {
    if (fertig) return;
    fertig = true;
    feld.remove();
    if (abbruch) beiAenderung(urspruenglich);
    beiEnde?.(abbruch, urspruenglich);
  };
  feld.addEventListener('input', () => { anpassen(); beiAenderung(feld.value); });
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ende(true); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ende(false); }
    e.stopPropagation();
  });
  feld.addEventListener('blur', () => ende(false));
  anpassen();
  feld.focus({ preventScroll: true });
  feld.setSelectionRange(feld.value.length, feld.value.length);
  return { feld, ende };
}

/** Bilddateien aus der Zwischenablage (Strg+V), etwa ein Bildschirmfoto. */
export function bilderAusZwischenablage(ev) {
  const dateien = [...(ev.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
  if (dateien.length) return dateien;
  return [...(ev.clipboardData?.items || [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
}
