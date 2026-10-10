/**
 * Kontovia – Lizenz in der Oberfläche: Krone, Sperre, Hinweisfenster.
 *
 * Premium-Funktionen sind mit einer Krone gekennzeichnet. Im Quelltext genügt ein Attribut:
 *   data-krone="mahnwesen"    nur die Krone (Reiter, Seitenleiste; die Ansicht zeigt selbst die Sperrkarte)
 *   data-premium="datev"      Krone und Sperre: Ein Klick auf das Element oder etwas darin öffnet das
 *                             Hinweisfenster, statt die Funktion auszuführen
 *   data-ohne-krone           bei einem Behälter mit data-premium: keine Krone anhängen (sie steht an der Überschrift)
 * Eine Beobachtung hängt die Krone an und hält sie aktuell, auch wenn die Ansicht später neu zeichnet oder
 * sich die Stufe ändert. Gesperrt wird zusätzlich dort, wo es zählt: in `commit()` (lib/store.js).
 *
 * Der Stand der Lizenz und die Tabelle stehen in lib/lizenz.js und lib/tarife.js.
 */

import { esc, raw } from './util.js';
import { icon, modal } from './ui.js';
import { kann, lizenzStand, stufe as aktuelleStufe, stufeName, platz, grenzeMeldung, beiLizenz } from './lizenz.js';
import { FUNKTIONEN, STUFEN_NAME, stufeFuer } from './tarife.js';
import { navigate } from './router.js';

const abName = (funktion) => STUFEN_NAME[stufeFuer(funktion)];

/** Titel der Krone: Wofür sie steht, und ob die Funktion gerade gesperrt ist. */
const kronenTitel = (funktion) => (kann(funktion) ? `Premium · ab ${abName(funktion)}` : `Gesperrt · ab ${abName(funktion)}`);

/** Die Krone als Text zum Einbauen in eine Vorlage. */
export function krone(funktion) {
  const zu = !kann(funktion);
  return `<span class="krone${zu ? ' zu' : ''}" data-krone-fuer="${esc(funktion)}" role="img" aria-label="${esc(kronenTitel(funktion))}" title="${esc(kronenTitel(funktion))}">${icon('crown', 13, 'ico krone-ico').__raw}</span>`;
}

/* -------------------------------------------------------------------------- */
/* Hinweisfenster                                                              */
/* -------------------------------------------------------------------------- */

/** Zu den Tarifen (eigene Seite, neuer Tab). */
export function tarifeOeffnen() {
  window.open(new URL('abo/', document.baseURI).href, '_blank', 'noopener');
}

/** Zur Lizenz in den Einstellungen. */
export function lizenzOeffnen() {
  navigate('settings', { abschnitt: 'lizenz' });
}

/** Wie das Konto gerade dasteht, für die Fenster. */
function standText() {
  const s = lizenzStand();
  if (s?.zustand === 'testphase' && s.vorschau) return `Sie probieren in der Testphase gerade ${stufeName()} aus.`;
  if (s?.zustand === 'abgelaufen') return `Die Lizenz ist abgelaufen. Ihr Konto hat jetzt ${stufeName()}.`;
  return `Ihr Konto hat ${stufeName()}.`;
}

function fenster({ titel, text }) {
  const m = modal({
    title: raw(`<span class="sperr-titel">${icon('crown', 18, 'ico krone-ico').__raw}${esc(titel)}</span>`),
    size: 'slim',
    body: `<p>${esc(text)}</p><p class="small muted mt8">${esc(standText())}</p>`,
    foot: `<button class="btn" data-zu>Schließen</button>
      <button class="btn" data-lizenz>Lizenz eingeben</button>
      <button class="btn primary" data-tarife>Tarife ansehen</button>`,
  });
  m.foot.querySelector('[data-zu]').addEventListener('click', () => m.close());
  m.foot.querySelector('[data-lizenz]').addEventListener('click', () => { m.close(); lizenzOeffnen(); });
  m.foot.querySelector('[data-tarife]').addEventListener('click', () => { tarifeOeffnen(); });
  return m;
}

/** Hinweis: Diese Funktion ist in der Stufe nicht enthalten. */
export function gesperrtFenster(funktion) {
  const f = FUNKTIONEN[funktion];
  return fenster({
    titel: 'Premium-Funktion',
    text: `${f?.name || funktion} gibt es ab dem Tarif ${abName(funktion)}.`,
  });
}

/** Ist die Funktion frei? Sonst erscheint das Hinweisfenster und es kommt `false` zurück. */
export function erlaubt(funktion) {
  if (kann(funktion)) return true;
  gesperrtFenster(funktion);
  return false;
}

/** Ist unter der Grenze noch Platz? Sonst erscheint das Hinweisfenster und es kommt `false` zurück. */
export function platzFrei(was, aktuell) {
  if (platz(was, aktuell).ok) return true;
  fenster({ titel: 'Grenze des Tarifs erreicht', text: grenzeMeldung(was, aktuell) });
  return false;
}

/** Eine Änderung wurde von `commit()` abgelehnt, weil die Lizenz sie nicht enthält: das Hinweisfenster zeigen. */
export function lizenzFehlerZeigen(e) {
  if (e?.funktion) { gesperrtFenster(e.funktion); return true; }
  if (e?.grenze) { fenster({ titel: 'Grenze des Tarifs erreicht', text: e.message }); return true; }
  return false;
}

/**
 * Platzhalter für eine ganze Ansicht oder einen Reiter, die die Stufe nicht enthält.
 * Danach `sperrKarteVerdrahten(root)` aufrufen.
 */
export function sperrKarte(funktion) {
  const f = FUNKTIONEN[funktion];
  return `
    <div class="card sperr-karte">
      <div class="card-body">
        <div class="sperr-krone">${icon('crown', 28, 'ico').__raw}</div>
        <h2>${esc(f?.name || funktion)}</h2>
        <p class="lead">Diese Funktion gibt es ab dem Tarif ${esc(abName(funktion))}.</p>
        <p class="small muted">${esc(standText())}</p>
        <div class="row wrap mt16 sperr-knoepfe">
          <button class="btn primary" data-tarife>Tarife ansehen</button>
          <button class="btn" data-lizenz>Lizenz eingeben</button>
        </div>
      </div>
    </div>`;
}

/** Kurzer Hinweis für kleine Flächen (Kachel der Übersicht); der Knopf wird von lizenzOberflaeche() bedient. */
export function sperrHinweis(funktion) {
  const f = FUNKTIONEN[funktion];
  return `<div class="sperr-klein">
    <p class="small muted">${esc(f?.name || funktion)} gibt es ab dem Tarif ${esc(abName(funktion))}.</p>
    <button type="button" class="btn sm" data-tarife-oeffnen>Tarife ansehen</button>
  </div>`;
}

export function sperrKarteVerdrahten(root) {
  root.querySelector('.sperr-karte [data-tarife]')?.addEventListener('click', tarifeOeffnen);
  root.querySelector('.sperr-karte [data-lizenz]')?.addEventListener('click', lizenzOeffnen);
}

/** Zeigt die Sperrkarte statt der Funktion, wenn sie fehlt. @returns {boolean} true = gesperrt, nichts weiter zeichnen */
export function sperrKarteZeigen(root, funktion) {
  if (kann(funktion)) return false;
  root.innerHTML = sperrKarte(funktion);
  sperrKarteVerdrahten(root);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Krone anhängen und Klicks abfangen                                          */
/* -------------------------------------------------------------------------- */

const KENNUNGEN = ['[data-krone]', '[data-premium]'].join(',');
const eigeneKrone = (el) => [...el.children].filter((k) => k.classList.contains('krone'));

function markieren(el) {
  const f = el.dataset.premium || el.dataset.krone;
  if (!f) return;
  const zu = !kann(f);
  if (!el.hasAttribute('data-ohne-krone') && !eigeneKrone(el).length) {
    el.insertAdjacentHTML('beforeend', krone(f));
  }
  eigeneKrone(el).forEach((k) => {
    k.classList.toggle('zu', zu);
    k.setAttribute('title', kronenTitel(f));
    k.setAttribute('aria-label', kronenTitel(f));
  });
  const sperrt = zu && el.hasAttribute('data-premium');
  el.classList.toggle('premium-zu', sperrt);
  if (el.matches('button, a, [role="button"], input, select')) {
    if (sperrt) el.setAttribute('aria-disabled', 'true'); else if (el.getAttribute('aria-disabled') === 'true') el.removeAttribute('aria-disabled');
  }
}

/** Alle Markierungen unterhalb von `wurzel` (und sie selbst) auf den Stand bringen. */
export function kronenAktualisieren(wurzel = document) {
  if (wurzel.matches?.(KENNUNGEN)) markieren(wurzel);
  wurzel.querySelectorAll?.(KENNUNGEN).forEach(markieren);
}

let verdrahtet = false;

/**
 * Einmal beim Start: beobachtet die Seite, hängt Kronen an neue Elemente, fängt Klicks auf gesperrte
 * Funktionen ab (noch vor deren eigenen Hörern) und zieht bei einem Wechsel der Stufe alles nach.
 */
export function lizenzOberflaeche() {
  if (verdrahtet) return;
  verdrahtet = true;
  const beobachter = new MutationObserver((liste) => {
    for (const m of liste) for (const n of m.addedNodes) if (n.nodeType === 1) kronenAktualisieren(n);
  });
  beobachter.observe(document.body, { childList: true, subtree: true });
  kronenAktualisieren(document);
  beiLizenz(() => kronenAktualisieren(document));

  const abfangen = (e) => {
    const el = e.target?.closest?.('[data-premium]');
    if (!el || !el.classList.contains('premium-zu')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    gesperrtFenster(el.dataset.premium);
  };
  document.addEventListener('click', abfangen, true);
  document.addEventListener('click', (e) => { if (e.target?.closest?.('[data-tarife-oeffnen]')) tarifeOeffnen(); });
  // Tastatur: Navigieren (Tab, Pfeile, Escape, Umschalttasten) bleibt frei; Zeichen, Eingabe, Löschen in einer gesperrten Funktion öffnen das Fenster.
  document.addEventListener('keydown', (e) => { if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') abfangen(e); }, true);
  // Formulare schickt der Browser auch ohne Klick ab (Eingabetaste im Feld).
  document.addEventListener('submit', abfangen, true);
}

export { aktuelleStufe };
