/**
 * Kontovia – Admin-Bereich des Betreibers: Tarife einstellen, Lizenzen verwalten, Rückmeldungen lesen.
 *
 * Erscheint in der Seitenleiste nur, wenn das Cloud-Konto des Geräts das des Betreibers ist (lib/admin.js)
 * und ersetzt dort den Knopf „Feedback“. Was die Reiter ändern, erlauben allein die Speicherregeln
 * (firebase/storage.rules); die Anzeige hier ist nur eine Bequemlichkeit. Inhalt: lib/feedback.js
 * (`entwicklerInhalt`), lib/tarifverwaltung.js, lib/lizenzverwaltung.js.
 */

import { html } from '../lib/util.js';
import { istBetreiber } from '../lib/admin.js';
import { entwicklerInhalt } from '../lib/feedback.js';

export async function render(root, params) {
  if (!await istBetreiber()) {
    root.innerHTML = html`<div class="card sperr-karte"><div class="card-body">
      <h2>Nur für den Betreiber</h2>
      <p class="lead">Dieser Bereich ist für das Konto des Betreibers gedacht.</p>
      <p class="small muted">Melden Sie sich dafür unter Einstellungen › Daten &amp; Cloud mit dem Google-Konto des Betreibers an.</p>
    </div></div>`;
    return;
  }
  // Frischer Behälter bei jedem Zeichnen, damit sich keine Hörer anhäufen.
  const host = document.createElement('div');
  host.className = 'admin';
  root.replaceChildren(host);
  entwicklerInhalt(host, { start: ['lizenzen', 'nutzung', 'rueck'].includes(params?.reiter) ? params.reiter : 'tarife' });
}
