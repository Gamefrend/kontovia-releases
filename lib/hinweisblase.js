/**
 * Kontovia – Hinweisblase: eine kurze Anleitung in Schritten an einem Knopf.
 *
 * Eine Sprechblase mit Pfeil zeigt auf ihren Knopf und erklärt Schritt für
 * Schritt („2 von 5“, Zurück, Weiter). Anders als ein Aufklappfeld
 * (popover.js) bleibt sie offen, wenn man daneben klickt, scrollt oder das
 * Fenster wechselt: Wer eine Adresse kopiert und im Browser einfügt, findet
 * sie beim Zurückkommen am selben Schritt. Sie schließt mit dem Kreuz, mit
 * Escape, mit „Fertig“ und wenn ihr Knopf verschwindet.
 *
 * Ein Schritt: {titel, text, adresse?, eintrag?, wert?, zusatz?}. Adresse,
 * Eintrag und Zusatz stehen in eigenen Zeilen mit Knopf zum Kopieren.
 * Offen ist immer höchstens eine Blase. Genutzt vom Assistenten
 * (lib/grafikhilfe.js, lib/assistentfenster.js).
 */

import { esc } from './util.js';
import { icon, toast } from './ui.js';
import { ruhig } from './bewegung.js';

let offen = null;

/**
 * Öffnet die Hinweisblase an `anker`.
 * @param {HTMLElement} anker
 * @param {{schritte:object[], label?:string, start?:number, fokus?:boolean, onClose?:(schritt:number)=>void}} o
 *   fokus: gleich in die Blase springen (aus, wenn sie von selbst erscheint und niemand gefragt hat)
 * @returns {{el:HTMLElement, close:Function}}
 */
export function hinweisblase(anker, { schritte, label = 'Anleitung', start = 0, fokus = true, onClose } = {}) {
  hinweisblaseSchliessen();
  if (!schritte?.length) return null;
  let i = Math.max(0, Math.min(start, schritte.length - 1));

  const el = document.createElement('div');
  el.className = 'hb';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-describedby', 'hbText');
  el.tabIndex = -1;
  document.body.append(el);

  const zeile = (beschriftung, inhalt, wert = '') => `
    <div class="hb-zeile">
      <span class="hb-art">${esc(beschriftung)}${wert ? `<span class="hb-wert">Wert: <strong>${esc(wert)}</strong></span>` : ''}</span>
      <code class="hb-code">${esc(inhalt)}</code>
      <button type="button" class="btn sm hb-kopieren" data-kopieren="${esc(inhalt)}" aria-label="${esc(`${beschriftung} kopieren`)}">${icon('copy', 14).__raw}<span>Kopieren</span></button>
    </div>`;

  const zeichnen = () => {
    const s = schritte[i];
    const letzter = i === schritte.length - 1;
    el.innerHTML = `
      <i class="hb-pfeil" aria-hidden="true"></i>
      <div class="hb-kopf">
        <span class="hb-zaehler">${schritte.length > 1 ? `Schritt ${i + 1} von ${schritte.length}` : ''}</span>
        <button type="button" class="icon-btn hb-zu" data-hb-zu aria-label="Anleitung schließen" title="Schließen (Esc)">${icon('x', 16).__raw}</button>
      </div>
      <p class="hb-titel" id="hbTitel">${esc(s.titel)}</p>
      <p class="hb-text" id="hbText">${esc(s.text)}</p>
      ${s.adresse ? zeile('Adresse', s.adresse) : ''}
      ${s.eintrag ? zeile('Eintrag', s.eintrag, s.wert) : ''}
      ${s.zusatz ? zeile('Zusatz', s.zusatz) : ''}
      <div class="hb-fuss">
        <span class="hb-punkte" aria-hidden="true">${schritte.length > 1 ? schritte.map((_, n) => `<i class="${n === i ? 'an' : ''}"></i>`).join('') : ''}</span>
        ${i > 0 ? '<button type="button" class="btn sm" data-hb-zurueck>Zurück</button>' : ''}
        <button type="button" class="btn sm primary" data-hb-weiter>${letzter ? 'Fertig' : 'Weiter'}</button>
      </div>`;
    el.setAttribute('aria-labelledby', 'hbTitel');
    platzieren();
  };

  const platzieren = () => {
    if (!anker.isConnected || anker.offsetParent === null) { handle.close(); return; }
    const r = anker.getBoundingClientRect();
    const rand = 8;
    const breite = el.offsetWidth;
    const hoehe = el.offsetHeight;
    const unten = window.innerHeight - r.bottom - rand;
    const nachUnten = unten >= hoehe + 12 || unten >= r.top;
    const mitte = r.left + r.width / 2;
    const links = Math.max(rand, Math.min(mitte - breite / 2, window.innerWidth - breite - rand));
    el.style.left = `${Math.round(links)}px`;
    el.style.top = `${Math.round(nachUnten ? r.bottom + 10 : Math.max(rand, r.top - 10 - hoehe))}px`;
    el.classList.toggle('oben', !nachUnten);
    el.style.setProperty('--hb-pfeil', `${Math.round(Math.max(16, Math.min(mitte - links, breite - 16)))}px`);
  };

  const handle = {
    el,
    close: (fokusZurueck = false) => {
      if (offen !== handle) return;
      offen = null;
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('resize', platzieren);
      window.removeEventListener('scroll', platzieren, true);
      el.remove();
      if (fokusZurueck && anker.isConnected) anker.focus();
      onClose?.(i);
    },
  };

  const wechseln = (n) => {
    i = Math.max(0, Math.min(n, schritte.length - 1));
    zeichnen();
    (el.querySelector('[data-hb-weiter]') || el).focus({ preventScroll: true });
  };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-hb-zu]')) { handle.close(true); return; }
    if (e.target.closest('[data-hb-zurueck]')) { wechseln(i - 1); return; }
    if (e.target.closest('[data-hb-weiter]')) {
      if (i < schritte.length - 1) wechseln(i + 1); else handle.close(true);
      return;
    }
    const k = e.target.closest('[data-kopieren]');
    if (k) {
      const text = k.dataset.kopieren;
      const fertig = () => {
        k.querySelector('span').textContent = 'Kopiert';
        setTimeout(() => { if (k.isConnected) k.querySelector('span').textContent = 'Kopieren'; }, 1800);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(fertig, () => markieren(k));
      else markieren(k);
    }
  });

  // Ohne Zugriff auf die Zwischenablage: den Text markieren, Strg+C erledigt den Rest.
  const markieren = (k) => {
    const code = k.parentElement.querySelector('.hb-code');
    const auswahl = window.getSelection();
    const bereich = document.createRange();
    bereich.selectNodeContents(code);
    auswahl.removeAllRanges();
    auswahl.addRange(bereich);
    toast('Markiert', 'Mit Strg+C oder Befehl+C kopieren.');
  };

  // In der Einfangphase am Fenster: Escape schließt zuerst die Blase, nicht das Fenster darunter.
  const taste = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .pop')) return;
    e.preventDefault();
    e.stopPropagation();
    handle.close(true);
  };
  window.addEventListener('keydown', taste, true);
  window.addEventListener('resize', platzieren);
  window.addEventListener('scroll', platzieren, true);

  offen = handle;
  zeichnen();
  if (offen !== handle) return null;
  if (!ruhig()) el.classList.add('ein');
  if (fokus) (el.querySelector('[data-hb-weiter]') || el).focus({ preventScroll: true });
  return handle;
}

export function hinweisblaseSchliessen() { offen?.close(); }

export const hinweisblaseOffen = () => !!offen;
