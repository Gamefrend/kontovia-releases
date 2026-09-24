/**
 * Kontovia – Aufklappliste für Werkzeug- und Filterleisten.
 *
 * Die Auswahlliste des Betriebssystems legt ihre Liste selbst über die Seite:
 * lang, ohne Rücksicht auf das Diagramm darunter und je nach
 * Bildschirmskalierung sogar versetzt. Genau das fiel beim Testen auf – die
 * aufgeklappte Liste lag über der Grafik. Diese Liste hier liegt direkt unter
 * ihrem Knopf, ist in der Höhe begrenzt, klappt nach oben, wenn unten kein
 * Platz ist, und schließt beim Scrollen, statt über fremdem Inhalt zu hängen.
 *
 * Das ursprüngliche <select> bleibt unsichtbar bestehen und ist weiter die
 * einzige Quelle für den Wert: Die Ansichten lesen `.value`, setzen es und
 * hören auf `change` wie bisher. Nur die Anzeige ist ersetzt.
 *
 * Auf Touch-Geräten bleibt es bei der Liste des Systems – das Auswahlrad von
 * iPhone und iPad ist dort die bessere Bedienung.
 */

import { icon } from './ui.js';

/** Wo ersetzt wird: Leisten über Inhalten, nicht die Felder in Dialogen. */
const ORTE = '#topActions select, .filters select, .card-head select';

let offen = null;
let seq = 0;

/** Ersetzt die Anzeige eines <select> durch Knopf und eigene Liste. */
export function enhanceSelect(select) {
  if (select.dataset.dd || select.multiple || select.size > 1) return;
  select.dataset.dd = '1';
  const name = select.getAttribute('aria-label') || select.title || '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="dd-label"></span>${icon('down', 14).__raw}`;
  select.after(btn);
  select.classList.add('dd-native');

  const sync = () => {
    const opt = select.options[select.selectedIndex];
    const text = opt ? opt.textContent : '';
    btn.querySelector('.dd-label').textContent = text;
    btn.disabled = select.disabled;
    btn.setAttribute('aria-label', name ? `${name}: ${text}` : text);
    if (select.title) btn.title = select.title;
  };

  // Setzt eine Ansicht den Wert selbst (select.value = …), muss der Knopf
  // das zeigen – ein solches Setzen löst kein Ereignis aus.
  const proto = HTMLSelectElement.prototype;
  for (const prop of ['value', 'selectedIndex', 'disabled']) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(select, prop, {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { d.set.call(this, v); sync(); },
    });
  }
  select.addEventListener('change', sync);
  // Ein select.focus() aus einer Ansicht landet beim Knopf.
  select.focus = () => btn.focus();
  sync();

  btn.addEventListener('click', () => (offen?.btn === btn ? schliessen() : oeffnen(select, btn)));
  btn.addEventListener('keydown', (e) => {
    if (offen?.btn === btn) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      oeffnen(select, btn);
    }
  });
}

function oeffnen(select, btn) {
  schliessen();
  const pop = document.createElement('div');
  pop.className = 'dd-pop';
  pop.setAttribute('role', 'listbox');
  const popId = `ddpop${++seq}`;
  pop.id = popId;
  const optionen = [...select.options];
  optionen.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'dd-opt';
    d.id = `${popId}o${i}`;
    d.setAttribute('role', 'option');
    d.setAttribute('aria-selected', String(i === select.selectedIndex));
    if (o.disabled) d.setAttribute('aria-disabled', 'true');
    d.dataset.i = String(i);
    d.innerHTML = icon('check', 14).__raw;
    const t = document.createElement('span');
    t.textContent = o.textContent;
    d.append(t);
    pop.append(d);
  });
  document.body.append(pop);

  // Unter dem Knopf, sonst darüber; nie aus dem Fenster heraus.
  const r = btn.getBoundingClientRect();
  pop.style.minWidth = `${Math.round(r.width)}px`;
  const hoehe = pop.offsetHeight;
  const unten = window.innerHeight - r.bottom - 8;
  const top = unten >= hoehe || unten >= r.top - 8 ? r.bottom + 4 : r.top - 4 - hoehe;
  pop.style.top = `${Math.max(8, Math.round(top))}px`;
  pop.style.maxHeight = `${Math.max(120, Math.min(300, unten >= hoehe ? unten : r.top - 12))}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)))}px`;

  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', popId);

  let aktiv = Math.max(0, select.selectedIndex);
  const markieren = (i, scroll = true) => {
    const nodes = pop.children;
    if (!nodes.length) return;
    aktiv = Math.max(0, Math.min(nodes.length - 1, i));
    for (const n of nodes) n.classList.toggle('active', Number(n.dataset.i) === aktiv);
    btn.setAttribute('aria-activedescendant', nodes[aktiv].id);
    if (scroll) nodes[aktiv].scrollIntoView({ block: 'nearest' });
  };
  markieren(aktiv);

  const waehlen = (i) => {
    if (optionen[i]?.disabled) return;
    const neu = select.selectedIndex !== i;
    schliessen();
    btn.focus();
    if (neu) {
      select.selectedIndex = i;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  pop.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus bleibt am Knopf
  pop.addEventListener('click', (e) => {
    const o = e.target.closest('.dd-opt');
    if (o) waehlen(Number(o.dataset.i));
  });
  pop.addEventListener('mousemove', (e) => {
    const o = e.target.closest('.dd-opt');
    if (o) markieren(Number(o.dataset.i), false);
  });

  let suche = '';
  let sucheZeit = 0;
  const taste = (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); schliessen(); btn.focus(); return; }
    if (k === 'Tab') { schliessen(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); markieren(aktiv + 1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); markieren(aktiv - 1); return; }
    if (k === 'Home') { e.preventDefault(); markieren(0); return; }
    if (k === 'End') { e.preventDefault(); markieren(optionen.length - 1); return; }
    if (k === 'PageDown') { e.preventDefault(); markieren(aktiv + 8); return; }
    if (k === 'PageUp') { e.preventDefault(); markieren(aktiv - 8); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); waehlen(aktiv); return; }
    // Tippen springt zum ersten passenden Eintrag, wie in der Liste des Systems.
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const jetzt = Date.now();
      suche = jetzt - sucheZeit > 700 ? k.toLowerCase() : suche + k.toLowerCase();
      sucheZeit = jetzt;
      const treffer = optionen.findIndex((o) => o.textContent.trim().toLowerCase().startsWith(suche));
      if (treffer >= 0) markieren(treffer);
    }
  };
  const daneben = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) schliessen(); };
  const gescrollt = (e) => { if (!pop.contains(e.target)) schliessen(); };

  // Am Fenster in der Einfangphase: vor jedem Dialog, der Escape sonst für
  // sich beanspruchen würde.
  window.addEventListener('keydown', taste, true);
  window.addEventListener('pointerdown', daneben, true);
  window.addEventListener('scroll', gescrollt, true);
  window.addEventListener('resize', schliessen);
  window.addEventListener('blur', schliessen);

  offen = {
    btn,
    ende() {
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('pointerdown', daneben, true);
      window.removeEventListener('scroll', gescrollt, true);
      window.removeEventListener('resize', schliessen);
      window.removeEventListener('blur', schliessen);
      pop.remove();
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
    },
  };
}

export function schliessen() {
  const o = offen;
  offen = null;
  o?.ende();
}

/**
 * Ersetzt ab jetzt jede passende Auswahlliste, sobald sie in die Seite kommt.
 * Nur bei Maus oder Trackpad; auf Touch-Geräten bleibt die Liste des Systems.
 */
export function startDropdowns(root = document.body) {
  if (!globalThis.matchMedia?.('(pointer: fine)').matches) return;
  let geplant = false;
  const lauf = () => {
    geplant = false;
    for (const s of root.querySelectorAll(ORTE)) enhanceSelect(s);
  };
  new MutationObserver(() => {
    if (geplant) return;
    geplant = true;
    queueMicrotask(lauf);
  }).observe(root, { childList: true, subtree: true });
  lauf();
}
