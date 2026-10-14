/**
 * Kontovia – Nutzungsmessung: die Frage nach der Zustimmung und die Karte in den Einstellungen.
 *
 * Die Frage kommt einmal je Gerät (danach steht die Antwort in prefs.js und lässt sich in den Einstellungen ändern).
 * „Teilen“ und „Nicht teilen“ sehen gleich aus, das Fenster lässt sich nicht wegklicken, und eine Ablehnung hat keine
 * Folgen. Die Karte zeigt, was gemessen wird, was nie, und was gerade gesendet würde (Vorschau); der Schalter wirkt
 * sofort. Die Messung selbst steht in lib/messung.js, der Server in functions/messunglogik.js.
 */

import { html, esc, raw } from './util.js';
import { icon, modal, ok } from './ui.js';
import { prefs } from './prefs.js';
import { rechtslinks } from './recht.js';
import { messungAn, messungErlauben, vorschau, beispielPaket } from './messung.js';

const WAS = [
  'In welchem Bereich Sie sind und wie lange, in groben Stufen (zum Beispiel „unter 30 Sekunden“).',
  'Wo schnell mehrfach hintereinander geklickt wird: nur der Bereich und die Art der Stelle (zum Beispiel „Knopf“), nie ihr Inhalt.',
  'Wie lange das Laden dauert, ebenfalls in groben Stufen.',
  'Ein Fehlercode, wenn etwas schiefgeht, ohne Text.',
  'Die Version, ob Handy oder Computer, und ob dieses Gerät heute schon gezählt wurde.',
];
const NIE = 'Beträge, Namen, Rechnungen, Buchungen, Texte, Dateien, Ihre E-Mail-Adresse oder eine Kennung, an der man Sie wiedererkennt.';

const listeHtml = () => `<ul class="small">${WAS.map((z) => `<li>${esc(z)}</li>`).join('')}</ul>`;

const paketText = (paket) => JSON.stringify(paket, null, 2);

/** Zeigt, wie ein Paket aussieht (Beispiel oder, bei laufender Messung, das echte aktuelle). */
export function vorschauZeigen() {
  const v = vorschau();
  const m = modal({
    title: 'Was würde gesendet?',
    size: 'wide',
    body: `<p class="mt0 small muted">${v.beispiel
      ? 'So sieht ein Paket aus. Die Zahlen sind ein Beispiel; solange die Messung aus ist, wird nichts gesendet.'
      : 'Das ist der Inhalt des nächsten Pakets, genau so, wie er hinausginge. Er enthält nur Stufen, Bereichsnamen und Codes, nie Inhalte aus Ihrer Buchhaltung.'}</p>
      <pre class="messung-paket" tabindex="0" translate="no">${esc(paketText(v.paket))}</pre>`,
    foot: '<button class="btn" data-zu>Schließen</button>',
  });
  m.root.querySelector('[data-zu]').addEventListener('click', () => m.close());
}

/**
 * Fragt einmal nach der Zustimmung (nur, wenn auf diesem Gerät noch nicht entschieden wurde).
 * @returns {Promise<boolean>} wurde zugestimmt?
 */
export function einwilligungFragen({ version = '' } = {}) {
  if (prefs.messung === 'ja') return Promise.resolve(true);
  if (prefs.messung === 'nein') return Promise.resolve(false);
  return new Promise((resolve) => {
    const m = modal({
      title: 'Kontovia verbessern helfen?',
      size: 'wide',
      body: `<p class="mt0">Wenn Sie möchten, sendet Kontovia anonyme Zahlen darüber, wie das Programm benutzt wird. Damit finden wir Stellen, an denen es hakt: lange Ladezeiten, Fehler oder Knöpfe, auf die man mehrfach klickt.</p>
        <h3 class="mt16">Was gemessen wird</h3>
        ${listeHtml()}
        <h3>Was nie gesendet wird</h3>
        <p class="small">${esc(NIE)}</p>
        <p class="small muted">Die Angaben sind nicht verschlüsselt, weil sie nichts Persönliches enthalten. Es gibt keine Kennung, die Sie über mehrere Besuche hinweg erkennt. Ohne Ihre Zustimmung wird nichts gesendet. Sie können jederzeit widersprechen: Einstellungen › Daten &amp; Cloud › Nutzungsmessung. Mehr steht in den <a href="#" data-recht="datenschutz">Datenschutzhinweisen</a>.</p>
        <details class="mehr-details"><summary>So sieht ein Paket aus</summary>
          <pre class="messung-paket" tabindex="0" translate="no">${esc(paketText(beispielPaket()))}</pre>
        </details>`,
      foot: '<button class="btn" data-nein>Nicht teilen</button><button class="btn" data-ja>Teilen</button>',
      // Ohne Entscheidung lässt sich das Fenster nicht wegklicken; „Nicht teilen“ hat keine Folgen.
      closable: false,
    });
    rechtslinks(m.root);
    const fertig = (ja) => { messungErlauben(ja, { version }); m.close(); resolve(ja); };
    m.root.querySelector('[data-nein]').addEventListener('click', () => fertig(false));
    m.root.querySelector('[data-ja]').addEventListener('click', () => fertig(true));
  });
}

/** Die Karte „Nutzungsmessung“ in den Einstellungen (Bereich Daten & Cloud). */
export function messungKarte(host, { version = '' } = {}) {
  const zeichnen = () => {
    const an = messungAn();
    const stand = prefs.messung === '' ? 'Noch nicht entschieden. Solange das so ist, wird nichts gesendet.' : an ? 'Eingeschaltet auf diesem Gerät.' : 'Ausgeschaltet. Es wird nichts gesendet.';
    host.innerHTML = html`<div class="card">
      <div class="card-head"><h2>${icon('chart', 16)} Nutzungsmessung</h2><span class="sub">gilt für dieses Gerät</span></div>
      <div class="card-body">
        <p class="muted small mt0">Hilft uns zu sehen, wo Kontovia hakt, und sagt nichts über Ihre Buchhaltung. Gemessen wird nur, wie das Programm benutzt wird, nie was darin steht.</p>
        <label class="check"><input type="checkbox" id="messungAn" ${an ? 'checked' : ''}> Anonyme Nutzungsmessung erlauben</label>
        <p class="small muted" id="messungStand" role="status">${stand}</p>
        <h3 class="mt16">Was gemessen wird</h3>
        ${raw(listeHtml())}
        <h3>Was nie gesendet wird</h3>
        <p class="small">${NIE}</p>
        <div class="row mt16"><button type="button" class="btn" id="messungVorschau">${icon('eye', 15)} Was würde gesendet?</button></div>
      </div>
    </div>`;
    host.querySelector('#messungAn').addEventListener('change', (e) => {
      messungErlauben(e.target.checked, { version });
      zeichnen();
      host.querySelector('#messungAn')?.focus();
      ok(e.target.checked ? 'Nutzungsmessung ist an' : 'Nutzungsmessung ist aus', e.target.checked ? 'Danke, das hilft uns. Sie können es hier jederzeit ausschalten.' : 'Es wird nichts mehr gesendet.');
    });
    host.querySelector('#messungVorschau').addEventListener('click', vorschauZeigen);
  };
  zeichnen();
}
