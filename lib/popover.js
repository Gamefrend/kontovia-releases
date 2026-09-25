/**
 * Kontovia – Aufklappfelder unter einem Knopf.
 *
 * Ein Baustein für alles, was sich über der Seite öffnet, ohne ein ganzes
 * Fenster zu sein: die Zeitraumwahl, die Filter in den Spaltenköpfen der
 * Buchungsliste und das Einblenden-Menü des Kalenders.
 *
 * Das Feld liegt direkt unter seinem Knopf (oder darüber, wenn unten kein
 * Platz ist), passt immer ins Fenster und liegt über Diagrammen und
 * Tabellenköpfen. Es schließt bei Escape, beim Klick daneben, beim Scrollen
 * der Seite und wenn der Fokus es verlässt; Escape gibt den Fokus an den Knopf
 * zurück. Offen ist immer höchstens eines.
 *
 * Anders als früher die ersetzten Auswahllisten funktioniert es mit Maus,
 * Tastatur und Finger gleich – es gibt keinen Sonderweg für Touch-Geräte.
 */

import { esc } from './util.js';
import { icon } from './ui.js';

let offen = null;

/**
 * Öffnet ein Aufklappfeld unter `anchor`.
 *
 * @param {HTMLElement} anchor  der auslösende Knopf
 * @param {object} o
 * @param {(pop:HTMLElement, handle:object) => void} o.build  füllt das Feld
 * @param {string} [o.label]      Name für Screenreader
 * @param {string} [o.className]  zusätzliche Klasse
 * @param {'start'|'end'} [o.align]  linke oder rechte Kante am Knopf ausrichten
 * @param {() => void} [o.onClose]
 * @returns {{el:HTMLElement, close:Function, place:Function}}
 */
export function openPopover(anchor, { build, label = '', className = '', align = 'start', onClose } = {}) {
  // Ein zweiter Klick auf denselben Knopf schließt nur.
  if (offen?.anchor === anchor) { closePopover(); return null; }
  closePopover();

  const pop = document.createElement('div');
  pop.className = `pop ${className}`.trim();
  pop.setAttribute('role', 'dialog');
  if (label) pop.setAttribute('aria-label', label);
  pop.tabIndex = -1;

  const handle = {
    el: pop,
    anchor,
    close: (focusBack = false) => {
      if (offen !== handle) return;
      offen = null;
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('pointerdown', daneben, true);
      window.removeEventListener('scroll', gescrollt, true);
      window.removeEventListener('resize', groesse);
      pop.removeEventListener('focusout', fokusWeg);
      pop.remove();
      anchor.setAttribute('aria-expanded', 'false');
      if (focusBack && anchor.isConnected) anchor.focus();
      onClose?.();
    },
    place: () => place(pop, anchor, align),
  };

  build(pop, handle);
  document.body.append(pop);
  handle.place();
  anchor.setAttribute('aria-expanded', 'true');

  const taste = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handle.close(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!pop.contains(document.activeElement)) return;
      // Pfeiltasten wandern durch die Einträge einer Liste; in Eingabefeldern
      // für Datum und Text bleiben sie dem Feld.
      const opts = [...pop.querySelectorAll('[data-nav]')].filter((n) => !n.hidden && n.offsetParent !== null);
      const i = opts.indexOf(document.activeElement);
      const inFeld = document.activeElement.matches('input:not([type="search"])');
      if (inFeld || !opts.length) return;
      e.preventDefault();
      const ziel = i < 0 ? opts[0] : opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
      ziel.focus();
    }
  };
  const daneben = (e) => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    handle.close();
  };
  const gescrollt = (e) => { if (!pop.contains(e.target)) handle.close(); };
  const groesse = () => handle.close();
  // Wandert der Fokus per Tabulator aus dem Feld hinaus, ist es erledigt.
  const fokusWeg = (e) => {
    const ziel = e.relatedTarget;
    if (ziel && !pop.contains(ziel) && ziel !== anchor) handle.close();
  };

  // Am Fenster in der Einfangphase: vor jedem Dialog, der Escape sonst für
  // sich beanspruchen würde.
  window.addEventListener('keydown', taste, true);
  window.addEventListener('pointerdown', daneben, true);
  window.addEventListener('scroll', gescrollt, true);
  window.addEventListener('resize', groesse);
  pop.addEventListener('focusout', fokusWeg);

  offen = handle;
  const erstes = pop.querySelector('[autofocus]') || pop.querySelector('[aria-pressed="true"][data-nav], .active[data-nav]') || pop.querySelector('[data-nav], button, input');
  (erstes || pop).focus({ preventScroll: true });
  return handle;
}

/** Schließt das offene Aufklappfeld, falls es eines gibt. */
export function closePopover() {
  offen?.close();
}

/** Unter dem Knopf, sonst darüber; nie aus dem Fenster heraus. */
function place(pop, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const rand = 8;
  pop.style.maxHeight = '';
  pop.style.maxWidth = `${window.innerWidth - 2 * rand}px`;
  const hoehe = pop.offsetHeight;
  const breite = pop.offsetWidth;
  const unten = window.innerHeight - r.bottom - rand;
  const oben = r.top - rand;
  const nachUnten = unten >= hoehe || unten >= oben;
  const platz = nachUnten ? unten - 4 : oben - 4;
  pop.style.maxHeight = `${Math.max(140, platz)}px`;
  const h = Math.min(hoehe, Math.max(140, platz));
  pop.style.top = `${Math.round(nachUnten ? r.bottom + 4 : r.top - 4 - h)}px`;
  const links = align === 'end' ? r.right - breite : r.left;
  pop.style.left = `${Math.round(Math.max(rand, Math.min(links, window.innerWidth - breite - rand)))}px`;
}

/* -------------------------------------------------------------------------- */
/* Auswahlmenü                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Menü aus Abschnitten mit je einer Auswahl, etwa ein Spaltenfilter.
 *
 * Ein Abschnitt: { key, title?, value, options: [{ value, label, sub?, count?, hint?, on? }], search?, hideEmpty? }
 * `search: true` blendet über der Liste ein Suchfeld ein. `hideEmpty` lässt
 * Einträge ohne Treffer weg, bis danach gesucht wird – lange Listen wie die
 * Kategorien zeigen so nur, was im Zeitraum tatsächlich vorkommt. Mit `on`
 * an den Einträgen wird der Abschnitt zur Liste einzeln abhakbarer Punkte.
 *
 * Ohne `keepOpen` schließt das Menü nach der Wahl – ein Klick, fertig.
 * Mit `keepOpen` bleibt es offen und zeichnet sich neu; `sections` ist dann
 * eine Funktion, die den aktuellen Stand liefert.
 */
export function openMenu(anchor, { label = '', sections, onPick, keepOpen = false, align = 'start' }) {
  const liste = () => (typeof sections === 'function' ? sections() : sections).filter(Boolean);
  let suche = '';

  const zeichnen = (pop) => {
    const teile = liste();
    pop.innerHTML = teile.map((s, si) => `
      <div class="menu-sec" role="group" aria-label="${esc(s.title || label)}"${s.hideEmpty ? ' data-hide-empty' : ''}>
        ${s.title ? `<div class="menu-title">${esc(s.title)}</div>` : ''}
        ${s.search ? `<input type="search" class="menu-search" data-sec="${si}" placeholder="Suchen …" value="${esc(suche)}" aria-label="${esc((s.title || label) + ' durchsuchen')}" autofocus>` : ''}
        ${s.options.map((o) => {
          // `on` steht für Einträge, die sich einzeln an- und abhaken lassen.
          const an = o.on !== undefined ? !!o.on : String(o.value) === String(s.value);
          const leer = o.count === 0 && !an;
          return `<button type="button" class="menu-opt${leer ? ' empty' : ''}" aria-pressed="${an}" data-nav
            data-key="${esc(s.key)}" data-val="${esc(o.value)}" data-text="${esc(`${o.label} ${o.sub || ''}`.toLowerCase())}"${o.hint ? ` title="${esc(o.hint)}"` : ''}>
            ${icon('check', 14).__raw}<span class="menu-label">${esc(o.label)}${o.sub ? `<span class="menu-sub">${esc(o.sub)}</span>` : ''}</span>${o.count !== undefined ? `<span class="menu-count">${esc(o.count)}</span>` : ''}
          </button>`;
        }).join('')}
        ${s.hideEmpty ? '<div class="menu-more tiny muted" hidden></div>' : ''}
      </div>`).join('<div class="menu-sep"></div>');
    filtern(pop);
  };

  // Das Suchfeld blendet nur Einträge aus; die erste Zeile („Alle …“) bleibt.
  const filtern = (pop) => {
    const q = suche.trim().toLowerCase();
    pop.querySelectorAll('.menu-sec').forEach((sec) => {
      const opts = [...sec.querySelectorAll('.menu-opt')];
      const ohneTreffer = sec.hasAttribute('data-hide-empty') && !q;
      let versteckt = 0;
      opts.forEach((b, i) => {
        const leer = ohneTreffer && i > 0 && b.classList.contains('empty');
        if (leer) versteckt++;
        b.hidden = i > 0 && (leer || (!!q && !b.dataset.text.includes(q)));
      });
      const mehr = sec.querySelector('.menu-more');
      if (mehr) {
        mehr.hidden = !versteckt;
        mehr.textContent = `${versteckt} weitere ohne Treffer${sec.querySelector('.menu-search') ? ' – über die Suche erreichbar' : ''}`;
      }
    });
  };

  return openPopover(anchor, {
    label,
    className: 'menu',
    align,
    build: (pop, handle) => {
      zeichnen(pop);
      pop.addEventListener('input', (e) => {
        if (!e.target.matches('.menu-search')) return;
        suche = e.target.value;
        filtern(pop);
      });
      pop.addEventListener('keydown', (e) => {
        // Enter im Suchfeld nimmt den ersten sichtbaren Treffer.
        if (e.key !== 'Enter' || !e.target.matches('.menu-search')) return;
        e.preventDefault();
        const sec = e.target.closest('.menu-sec');
        const treffer = [...sec.querySelectorAll('.menu-opt')].filter((b) => !b.hidden);
        (treffer.find((b, i) => i > 0 || treffer.length === 1) || treffer[0])?.click();
      });
      pop.addEventListener('click', (e) => {
        const b = e.target.closest('.menu-opt');
        if (!b) return;
        const { key, val } = b.dataset;
        if (!keepOpen) handle.close(true);
        onPick(key, val);
        if (keepOpen && pop.isConnected) {
          zeichnen(pop);
          pop.querySelector(`.menu-opt[data-key="${CSS.escape(key)}"][data-val="${CSS.escape(val)}"]`)?.focus();
        }
      });
    },
  });
}
