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
