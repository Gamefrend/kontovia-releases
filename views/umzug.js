/**
 * Kontovia – Umzug von Windows in den Browser.
 *
 * Nur in der Windows-Fassung, und zwar in ihrer letzten Version: Ein ruhiger
 * Hinweis nach dem Entsperren und eine Karte unter Hilfe → Neuigkeiten
 * erklären die drei Schritte. Der Hinweis kommt bei jedem Start wieder, bis
 * jemand „Erledigt“ wählt; das gilt je Gerät.
 */

import { icon, modal, ok, err } from '../lib/ui.js';
import { saveNow } from '../lib/store.js';

const api = window.kontovia;
const WEB = api.platform === 'web';
const ERLEDIGT = 'kontovia.umzug-erledigt';
export const WEB_ADRESSE = 'gamefrend.github.io/kontovia-releases';

/** Der Inhalt, gleich für Hinweis und Karte. */
function inhalt() {
  return `
    <p class="mt0" style="line-height:1.6">Diese Windows-Fassung ist die letzte. Kontovia geht im Browser
    weiter: auf diesem Rechner genauso wie auf Telefon und Tablet, auch ohne Internet, und in Chrome
    oder Edge als eigene App mit Symbol. Ihre Buchhaltung nehmen Sie in drei Schritten mit.</p>
    <ol style="padding-left:20px;line-height:1.7">
      <li><strong>Vollsicherung erstellen.</strong> Sie enthält Buchungen, Belege und Einstellungen.
        <div class="mt8"><button class="btn sm" data-umzug="sicherung">${icon('archive', 14).__raw} Vollsicherung erstellen</button></div></li>
      <li><strong>Kontovia im Browser öffnen:</strong> <code>${WEB_ADRESSE}</code>
        <div class="mt8"><button class="btn sm" data-umzug="web">${icon('external', 14).__raw} Im Browser öffnen</button></div></li>
      <li><strong>Dort die Buchhaltung übernehmen.</strong> Mit Cloud-Abgleich: beim ersten Start mit Google
        anmelden, die Buchhaltung kommt von selbst. Sonst eine neue Buchhaltung anlegen und unter
        Einstellungen → Sicherung wiederherstellen die Vollsicherung einspielen.</li>
    </ol>
    <div class="notice small" style="line-height:1.6"><strong>In Chrome und Edge geht es auch ohne Sicherung:</strong>
      Kontovia legt eine Kopie Ihres Datenordners unter Dokumente an. Im Browser wählen Sie beim ersten Start
      <em>Ordner öffnen</em> und dann diese Kopie; Kontovia arbeitet danach direkt darin.
      <div class="mt8"><button class="btn sm" data-umzug="ordner">${icon('folder', 14).__raw} Ordner für den Browser anlegen</button></div></div>
    <p class="small muted mb0" style="line-height:1.6">Arbeiten Sie danach bitte nur noch im Browser weiter. Mit
    Cloud-Abgleich bleiben beide auf demselben Stand; ohne ihn entstünden zwei getrennte Buchhaltungen.
    Diese Fassung bleibt installiert, bis Sie sie selbst entfernen.</p>`;
}

function verdrahten(el) {
  el.querySelector('[data-umzug="sicherung"]')?.addEventListener('click', async () => {
    const m = await import('./settings.js');
    m.runBackup();
  });
  el.querySelector('[data-umzug="web"]')?.addEventListener('click', () => {
    api.app.webOeffnen().catch((e) => err('Browser nicht geöffnet', e.message));
  });
  el.querySelector('[data-umzug="ordner"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await saveNow();
      const ziel = await api.app.datenFuerWeb();
      ok('Ordner angelegt', `${ziel}. Im Browser beim ersten Start „Ordner öffnen“ wählen und diesen Ordner nehmen.`);
    } catch (x) {
      err('Ordner nicht angelegt', x.message);
    } finally {
      e.target.disabled = false;
    }
  });
}

/** Nach dem Entsperren: der Hinweis, solange er nicht erledigt ist. */
export function umzugHinweis() {
  if (WEB || !api.app.webOeffnen) return;
  try { if (localStorage.getItem(ERLEDIGT)) return; } catch { /* dann eben zeigen */ }
  const m = modal({
    title: 'Kontovia zieht in den Browser um',
    body: inhalt(),
    foot: '<button class="btn" data-spaeter>Später erinnern</button><button class="btn primary" data-fertig>Erledigt</button>',
  });
  verdrahten(m.root);
  m.root.querySelector('[data-spaeter]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-fertig]').addEventListener('click', () => {
    try { localStorage.setItem(ERLEDIGT, new Date().toISOString()); } catch { /* egal */ }
    m.close();
  });
}

/** Karte für Hilfe → Neuigkeiten. */
export function umzugKarte() {
  if (WEB || !api.app.webOeffnen) return '';
  return `<div class="card mb16" id="umzugKarte"><div class="card-body">
    <h3 class="mt0">${icon('info', 16).__raw} Kontovia zieht in den Browser um</h3>${inhalt()}</div></div>`;
}

export function umzugKarteVerdrahten(root) {
  const el = root.querySelector('#umzugKarte');
  if (el) verdrahten(el);
}
