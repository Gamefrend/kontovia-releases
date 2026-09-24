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
}

const app = document.getElementById('app');
if (app) new MutationObserver(einsetzen).observe(app, { childList: true });
