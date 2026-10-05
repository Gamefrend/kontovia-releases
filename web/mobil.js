/**
 * Kontovia – Bedienung auf schmalen Bildschirmen.
 *
 * Auf dem iPhone ist kein Platz für eine feste Seitenleiste. web.css macht sie
 * dort zu einem Blatt von unten: „Mehr“ in der Leiste unten öffnet es, mit allen
 * Bereichen als Kacheln und darunter Konto, Erscheinungsbild und Sperren. Die
 * Oberfläche selbst bleibt unverändert; Leiste und Hintergrund werden eingesetzt,
 * sobald die Hülle nach dem Entsperren aufgebaut ist.
 */

import { markierung } from '../lib/bewegung.js';

function einsetzen() {
  const shell = document.querySelector('.shell');
  const top = shell?.querySelector('.topbar');
  if (!top || shell.querySelector('.kv-nav-hg')) return;

  const hg = document.createElement('div');
  hg.className = 'kv-nav-hg';
  shell.append(hg);

  const zu = () => shell.classList.remove('nav-offen');
  hg.addEventListener('click', zu);
  // Nach der Wahl eines Eintrags wieder einklappen.
  const blatt = shell.querySelector('.sidebar');
  blatt?.addEventListener('click', (e) => {
    if (e.target.closest('[data-view], #lockBtn, #updateBtn')) zu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zu(); });
  if (blatt) blattWegwischen(blatt, shell, zu);
  kopfzeileBeobachten();
  tabsEinsetzen(shell, zu);
}

/**
 * Das Blatt folgt dem Finger nach unten und schließt, wenn man weit genug gezogen
 * hat. Nur wenn es ganz oben steht: Sonst gehört die Bewegung dem Scrollen darin.
 */
function blattWegwischen(blatt, shell, zu) {
  let start = null;
  let weg = 0;
  blatt.addEventListener('touchstart', (e) => {
    start = blatt.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    weg = 0;
  }, { passive: true });
  blatt.addEventListener('touchmove', (e) => {
    if (start === null) return;
    weg = e.touches[0].clientY - start;
    if (weg <= 0) { blatt.style.transform = ''; return; }
    blatt.style.transition = 'none';
    blatt.style.transform = `translateY(${weg}px)`;
    e.preventDefault();
  }, { passive: false });
  const ende = () => {
    if (start === null) return;
    start = null;
    blatt.style.transition = '';
    blatt.style.transform = '';
    if (weg > 90) zu();
    weg = 0;
  };
  blatt.addEventListener('touchend', ende);
  blatt.addEventListener('touchcancel', ende);
}

const SVG = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TABS = [
  ['dashboard', 'Übersicht', '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>'],
  ['transactions', 'Buchungen', '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'],
  null,
  ['calendar', 'Kalender', '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['mehr', 'Mehr', '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'],
];

/**
 * Auf dem Telefon liegt die wichtigste Bedienung unten, wo der Daumen ist:
 * Übersicht, Buchungen, „Neue Buchung“ in der Mitte, Kalender und „Mehr“, das
 * die Seitenleiste mit dem Rest öffnet. Die Leiste bedient die Einträge der
 * Seitenleiste, statt eigene Wege zu kennen.
 */
function tabsEinsetzen(shell, zu) {
  if (shell.querySelector('.kv-tabs')) return;
  const nav = document.createElement('nav');
  nav.className = 'kv-tabs';
  nav.setAttribute('aria-label', 'Schnellzugriff');
  nav.innerHTML = TABS.map((t) => t
    ? `<button type="button" class="kv-tab" data-tab="${t[0]}">${SVG(t[2])}<span>${t[1]}</span></button>`
    : `<button type="button" class="kv-tab-plus" data-tab="neu" aria-label="Neue Buchung" aria-haspopup="menu">${SVG('<path d="M12 5v14M5 12h14"/>')}</button>`).join('');
  shell.append(nav);

  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const ziel = b.dataset.tab;
    if (ziel === 'mehr') { zu(); shell.classList.add('nav-offen'); return; }
    if (ziel === 'neu') { document.dispatchEvent(new CustomEvent('kontovia:neue-buchung', { detail: { anker: b } })); return; }
    shell.querySelector(`.nav-item[data-view="${ziel}"]`)?.click();
  });

  const abgleichen = () => {
    const aktiv = shell.querySelector('.nav-item.active')?.dataset.view;
    nav.querySelectorAll('.kv-tab').forEach((b) => {
      const an = b.dataset.tab === aktiv || (b.dataset.tab === 'mehr' && !TABS.some((t) => t && t[0] === aktiv));
      b.classList.toggle('active', an);
      if (an) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  };
  const leiste = shell.querySelector('#nav');
  if (leiste) new MutationObserver(abgleichen).observe(leiste, { subtree: true, attributes: true, attributeFilter: ['class'] });
  abgleichen();
  // Die Marke oben an der Leiste gleitet zum gewählten Eintrag.
  markierung(nav, { aktiv: '.kv-tab.active', achse: 'x', breite: 28 });
}

/**
 * Die Kopfleiste (Menü, Titel, Suche) ist am Telefon immer gleich hoch. Beim
 * Scrollen ändert sich an ihr nichts außer einer feinen Linie am unteren Rand,
 * die zeigt, dass darunter Inhalt vorbeizieht. Frühere Fassungen klappten
 * beim Hinunterscrollen eine Zeile weg und machten die Leiste kleiner; die
 * Höhe sprang, und alles in der Leiste rückte zusammen. Zeitraum und Neu-Knöpfe
 * scrollen jetzt einfach mit dem Inhalt (siehe web.css).
 *
 * Ein Tipp auf den Titel bringt die Seite nach oben, wie auf dem iPhone üblich.
 */
function kopfzeileBeobachten() {
  const shell = document.querySelector('.shell');
  const spalte = shell?.querySelector('.main');
  if (!spalte || spalte.dataset.kvScroll) return;
  spalte.dataset.kvScroll = '1';
  let an = false;
  spalte.addEventListener('scroll', () => {
    const jetzt = spalte.scrollTop > 6;
    if (jetzt !== an) { an = jetzt; shell.classList.toggle('gescrollt', jetzt); }
  }, { passive: true });
  shell.querySelector('#viewTitle')?.addEventListener('click', () => {
    if (matchMedia('(max-width: 820px)').matches) spalte.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

const app = document.getElementById('app');
if (app) new MutationObserver(einsetzen).observe(app, { childList: true });
