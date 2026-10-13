/**
 * Kontovia – die laufende Stoppuhr eines Projekts in der Kopfleiste, auf jeder Seite.
 *
 * Läuft eine Stoppuhr (lib/projektaktionen.js: laufendeZeit), steht oben neben dem Titel eine Pille mit Zeit und
 * Projekt: ein Klick darauf öffnet das Projekt, der Knopf daneben hält sie an und speichert die Zeit. Ohne laufende
 * Stoppuhr bleibt der Platz leer. Gezeichnet wird nur neu, wenn sich die laufende Zeit ändert; die Sekunden zählt
 * ein Takt, der endet, sobald die Pille nicht mehr im Dokument steht (Sperren, neu gezeichnete Oberfläche).
 */

import { html } from './util.js';
import { icon, ok, err } from './ui.js';
import { store, sel, subscribe } from './store.js';
import { navigate, refresh } from './router.js';
import { dauerText } from './projekte.js';
import { laufendeZeit, stoppuhrAnhalten } from './projektaktionen.js';

let abmelden = null;
let takt = null;

/** „1:05:09“ seit dem Start. */
function seitStart(start) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Hängt die Anzeige an `host` (Platz in der Kopfleiste); ein zweiter Aufruf ersetzt den ersten. */
export function stoppuhrAnzeigeStarten(host) {
  abmelden?.();
  let gezeigt = null;
  const zeichnen = () => {
    if (!host.isConnected) { abmelden?.(); return; }
    const z = store.db ? laufendeZeit() : null;
    const p = z ? sel.projekt(z.projektId) : null;
    const schluessel = z ? `${z.id}|${z.start}|${p?.name || ''}|${z.beschreibung || ''}` : '';
    if (schluessel === gezeigt) return;
    gezeigt = schluessel;
    clearInterval(takt);
    host.hidden = !z;
    if (!z) { host.innerHTML = ''; return; }
    host.innerHTML = html`<div class="uhr-pille" role="group" aria-label="Laufende Stoppuhr">
      <button type="button" class="uhr-ziel" data-uhr-ziel title="${`Stoppuhr läuft: ${p?.name || 'Projekt'}${z.beschreibung ? ` · ${z.beschreibung}` : ''}. Projekt öffnen`}">
        <span class="pj-uhr-punkt" aria-hidden="true"></span>
        <span class="uhr-zeit" data-uhr-zeit>${seitStart(z.start)}</span>
        <span class="uhr-name">${p?.name || 'Projekt'}</span>
      </button>
      <button type="button" class="uhr-stopp" data-uhr-stopp aria-label="Stoppuhr anhalten" title="Stoppuhr anhalten">${icon('stop', 14)}</button>
    </div>`;
    const zeit = host.querySelector('[data-uhr-zeit]');
    takt = setInterval(() => {
      if (!zeit.isConnected) { clearInterval(takt); return; }
      zeit.textContent = seitStart(z.start);
    }, 1000);
    host.querySelector('[data-uhr-ziel]').addEventListener('click', () => navigate('projekte', { id: z.projektId }));
    host.querySelector('[data-uhr-stopp]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const fertig = await stoppuhrAnhalten(z.id);
        ok('Zeit erfasst', fertig ? `${dauerText(fertig.minuten)} Stunden · ${p?.name || ''}` : '');
        refresh();
      } catch (ex) { err('Nicht angehalten', ex.message); }
    });
  };
  const aus = subscribe((ev) => { if (ev?.type === 'change' || ev?.type === 'db') zeichnen(); });
  abmelden = () => { aus(); clearInterval(takt); abmelden = null; };
  zeichnen();
}
