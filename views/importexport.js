/**
 * Kontovia – Import und Export in einem Bereich der Seitenleiste.
 *
 * Zwei Reiter: „Export“ (views/export.js, Unterlagen für Finanzamt und Kanzlei)
 * und „Import“ (views/datenimport.js, Daten aus anderen Programmen). Die Leiste
 * bleibt beim Wechsel stehen, damit die Marke gleiten kann; neu gezeichnet wird
 * nur der Reiter darunter. Der frühere Bereich `datenimport` leitet hierher
 * (Umleitung in app.js).
 */

import { $, $$, esc } from '../lib/util.js';
import { router } from '../lib/router.js';
import { markierung, bereichEin } from '../lib/bewegung.js';
import * as exportAnsicht from './export.js';
import * as importAnsicht from './datenimport.js';

const REITER = {
  export: ['Export', exportAnsicht],
  import: ['Import', importAnsicht],
};
let reiter = 'export';

export async function render(root, params = {}, { actions } = {}) {
  // Ohne Angabe (Seitenleiste, Tastenkürzel) öffnet der Export; der Import behält seinen Stand trotzdem.
  reiter = REITER[params?.reiter] ? params.reiter : 'export';
  root.innerHTML = `
    <div class="seg tabs mb16" role="group" aria-label="Import oder Export">
      ${Object.entries(REITER).map(([k, [titel]]) => `<button type="button" data-reiter="${k}" class="${reiter === k ? 'active' : ''}" aria-pressed="${reiter === k}">${esc(titel)}</button>`).join('')}
    </div>
    <div id="ieBody"></div>`;
  markierung($('.seg.tabs', root), { aktiv: 'button.active' });
  $$('[data-reiter]', root).forEach((b) => b.addEventListener('click', async () => {
    if (reiter === b.dataset.reiter) return;
    // Der Import fragt nach, wenn eine Auswahl noch nicht übernommen ist.
    if (router.leaveGuard) {
      const guard = router.leaveGuard;
      if (!(await guard())) return;
      if (router.leaveGuard === guard) router.leaveGuard = null;
    }
    reiter = b.dataset.reiter;
    $$('[data-reiter]', root).forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    await zeigen(root, {}, actions);
    bereichEin($('#ieBody', root));
  }));
  await zeigen(root, params, actions);
}

async function zeigen(root, params, actions) {
  if (actions) actions.innerHTML = '';
  await REITER[reiter][1].render($('#ieBody', root), params, { actions });
}
