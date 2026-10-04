/**
 * Kontovia – Bedienung auf schmalen Bildschirmen.
 *
 * Auf dem iPhone ist kein Platz für eine feste Seitenleiste. web.css macht sie
 * dort zu einer ausklappbaren Leiste; hier kommt der Knopf dazu, der sie
 * öffnet. Die Oberfläche selbst bleibt unverändert – der Knopf wird in die
 * Kopfzeile gesetzt, sobald sie nach dem Entsperren aufgebaut ist.
 */

const SYMBOL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

function einsetzen() {
  const shell = document.querySelector('.shell');
  const top = shell?.querySelector('.topbar');
  if (!top || top.querySelector('.kv-menu')) return;

  const knopf = document.createElement('button');
  knopf.className = 'icon-btn kv-menu';
  knopf.type = 'button';
  knopf.setAttribute('aria-label', 'Menü öffnen');
  knopf.innerHTML = SYMBOL;
  top.prepend(knopf);

  const hg = document.createElement('div');
  hg.className = 'kv-nav-hg';
  shell.append(hg);

  const zu = () => shell.classList.remove('nav-offen');
  knopf.addEventListener('click', () => shell.classList.toggle('nav-offen'));
  hg.addEventListener('click', zu);
  // Nach der Wahl eines Eintrags wieder einklappen.
  shell.querySelector('.sidebar')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-view], #lockBtn, #updateBtn')) zu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zu(); });
  kopfzeileBeobachten();
  tabsEinsetzen(shell, zu);
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
}

/**
 * Die Aktionszeile der Kopfleiste (Zeitraum, Neu-Knöpfe) nimmt auf dem Telefon
 * ein Fünftel des Bildschirms ein. Beim Hinunterscrollen wird sie ausgeblendet,
 * beim Hinaufscrollen oder ganz oben ist sie wieder da. Nur bei langen Seiten:
 * Sonst würde der gewonnene Platz die Seite so kurz machen, dass sie nicht mehr
 * scrollt und die Zeile hin und her springt.
 */
function kopfzeileBeobachten() {
  const shell = document.querySelector('.shell');
  const inhalt = shell?.querySelector('.content');
  if (!inhalt || inhalt.dataset.kvScroll) return;
  inhalt.dataset.kvScroll = '1';
  let letzte = 0;
  let sperre = false;
  inhalt.addEventListener('scroll', () => {
    if (sperre) return;
    const y = inhalt.scrollTop;
    const delta = y - letzte;
    const eng = matchMedia('(max-width: 820px)').matches;
    const lang = inhalt.scrollHeight - inhalt.clientHeight > 320;
    const kompakt = shell.classList.contains('kv-kompakt');
    if (!eng || !lang || y < 24) {
      if (kompakt) shell.classList.remove('kv-kompakt');
    } else if (!kompakt && delta > 10 && y > 90) {
      shell.classList.add('kv-kompakt');
      sperre = true; // Die Höhenänderung löst selbst ein Scroll-Ereignis aus.
      setTimeout(() => { sperre = false; letzte = inhalt.scrollTop; }, 120);
    } else if (kompakt && delta < -10) {
      shell.classList.remove('kv-kompakt');
      sperre = true;
      setTimeout(() => { sperre = false; letzte = inhalt.scrollTop; }, 120);
    }
    letzte = y;
  }, { passive: true });
  // Eine andere Ansicht (kürzer, oben beginnend) bringt die Zeile zurück.
  new MutationObserver(() => {
    if (inhalt.scrollTop < 24 || inhalt.scrollHeight - inhalt.clientHeight <= 320) shell.classList.remove('kv-kompakt');
    letzte = inhalt.scrollTop;
  }).observe(inhalt, { childList: true });
}

const app = document.getElementById('app');
if (app) new MutationObserver(einsetzen).observe(app, { childList: true });
