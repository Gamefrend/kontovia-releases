/**
 * Kontovia – Admin-Bereich, Reiter „Nutzung“: Auswertung der Nutzungsmessung.
 *
 * Liest die Tageszähler aus dem Cloud-Speicher (api.messung.lesen, nur mit dem Konto des Betreibers; die Speicherregeln
 * entscheiden) und zeigt sie als Karten und Tabellen. Gerechnet wird in lib/nutzungsauswertung.js. Gezeigt wird nur, was
 * die Messung kennt: Bereiche, Stufen, Codes, Zähler. Keine Personen, keine Inhalte. Unter MINDEST_SITZUNGEN Sitzungen im
 * Zeitraum bleiben die Einzelheiten verborgen.
 */

import { html, raw, esc, int } from './util.js';
import { icon, err } from './ui.js';
import { VIEWS } from '../app.js';
import { STUFENNAMEN } from './messung.js';
import {
  MINDEST_SITZUNGEN, bereiche, ladezeiten, frustKlicks, fehlerCodes, liste, aboSeite, aktiveGeraete, verlauf, DAUER_REIHE,
} from './nutzungsauswertung.js';

const api = window.kontovia;

const ZEITRAEUME = [[7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage']];
const LADEART = {
  start: 'Start der Seite', entsperren: 'Entsperren', ansicht: 'Bereich öffnen', inp: 'Langsamste Reaktion auf Eingaben', ruckeln: 'Hängt kurz',
};
const ABOEREIGNIS = {
  aufruf: 'Seitenaufrufe', installieren: 'Klick auf Installieren', anmelden: 'Klick auf Anmelden', anmeldung: 'Anmeldung abgeschickt', vergleich: 'Vergleichstabelle geöffnet', 'app-oeffnen': 'Klick auf App öffnen',
};

const bereichName = (a) => VIEWS[a]?.title || a;
const prozent = (x) => `${Math.round(x * 100)} %`;
const tabelle = (kopf, zeilen) => `<div class="table-wrap"><table class="data compact"><thead><tr>${kopf.map((k) => `<th${k.zahl ? ' class="num"' : ''}>${esc(k.t)}</th>`).join('')}</tr></thead><tbody>${zeilen.join('')}</tbody></table></div>`;
const zeile = (zellen) => `<tr>${zellen.map((z) => `<td${z.zahl ? ' class="num"' : ''}>${z.roh ? z.t : esc(z.t)}</td>`).join('')}</tr>`;
const karte = (titel, inhalt, sub = '') => `<div class="card"><div class="card-head"><h2>${esc(titel)}</h2>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div><div class="card-body">${inhalt}</div></div>`;
const stat = (label, wert) => `<div class="card stat"><div class="label">${esc(label)}</div><div class="value">${esc(wert)}</div></div>`;

/** Balken je Tag für die aktiven Geräte (Breite in Prozent als Attributwert, ohne Stilangabe im Text). */
function verlaufHtml(reihe) {
  const v = verlauf(reihe);
  const max = Math.max(1, ...v.map((t) => t.geraete));
  return `<div class="nu-verlauf" role="img" aria-label="Aktive Geräte je Tag">${v.map((t) => `<div class="nu-balken" title="${esc(`${t.tag}: ${t.geraete} Geräte, ${t.sitzungen} Sitzungen`)}"><span data-h="${Math.round((t.geraete / max) * 100)}"></span></div>`).join('')}</div>`;
}

/** Der Inhalt des Reiters für gegebene Daten ({reihe, summe}); getrennt vom Laden, damit er sich ohne Cloud ansehen und prüfen lässt. */
export function ansichtHtml(daten) {
  const { reihe, summe } = daten;
  if (!reihe.length) {
    return `<div class="notice">Noch keine Daten. Sobald Nutzer der Messung zustimmen, erscheinen hier die ersten Zahlen. Die Funktion „messung“ muss dafür veröffentlicht sein (README, Abschnitt Nutzungsmessung).</div>`;
  }
  const akt = aktiveGeraete(reihe);
  const kopf = `<div class="grid c4 mb16">
    ${stat('Aktive Geräte, letzter Tag', int(akt.tag))}
    ${stat('Aktive Geräte, diese Woche', int(akt.woche))}
    ${stat('Aktive Geräte, dieser Monat', int(akt.monat))}
    ${stat('Sitzungen im Zeitraum', int(summe.sitzungen))}
  </div>
  <p class="small muted mt0">Gezählt werden nur Geräte, deren Nutzer zugestimmt haben. Das ist ein Ausschnitt, kein Gesamtbild. Ein Gerät zählt pro Tag, Woche und Monat einmal, ohne Kennung. Stand des letzten Tages: ${esc(akt.datum)}.</p>
  ${karte('Aktive Geräte je Tag', verlaufHtml(reihe), `${reihe.length} Tage`)}`;
  if (summe.sitzungen < MINDEST_SITZUNGEN) {
    const wenig = summe.sitzungen === 1
      ? `Bisher nur 1 Sitzung. Einzelheiten erscheinen ab ${MINDEST_SITZUNGEN} Sitzungen im Zeitraum, damit aus wenigen Besuchen keine Aussagen über „die Nutzer“ entstehen.`
      : `Bisher nur ${int(summe.sitzungen)} Sitzungen. Einzelheiten erscheinen ab ${MINDEST_SITZUNGEN} Sitzungen im Zeitraum, damit aus wenigen Besuchen keine Aussagen über „die Nutzer“ entstehen.`;
    return `${kopf}<div class="notice mt16">${esc(wenig)}</div>${aboKarte(summe)}`;
  }

  const b = bereiche(summe);
  const bereichTab = tabelle([{ t: 'Bereich' }, { t: 'Besuche', zahl: true }, { t: 'Typische Verweildauer' }, { t: 'Verteilung' }],
    b.slice(0, 20).map((z) => zeile([
      { t: bereichName(z.a) }, { t: int(z.n), zahl: true }, { t: STUFENNAMEN[z.median] || '' },
      { t: DAUER_REIHE.map((s) => `${STUFENNAMEN[s]}: ${int(z.stufen[s] || 0)}`).join(' · ') },
    ])));

  const l = ladezeiten(summe).filter((z) => z.n >= 3);
  const ladeTab = l.length ? tabelle([{ t: 'Was' }, { t: 'Bereich' }, { t: 'Messungen', zahl: true }, { t: 'Davon langsam (ab 3 s)', zahl: true }, { t: 'Typisch' }],
    l.slice(0, 20).map((z) => zeile([
      { t: LADEART[z.m] || z.m }, { t: z.a ? bereichName(z.a) : '' }, { t: int(z.n), zahl: true }, { t: prozent(z.anteil), zahl: true }, { t: STUFENNAMEN[z.median] || '' },
    ]))) : '<p class="muted small">Noch zu wenige Messungen.</p>';

  const f = frustKlicks(summe);
  const frustTab = f.length ? tabelle([{ t: 'Bereich' }, { t: 'Stelle' }, { t: 'Frust-Klicks', zahl: true }],
    f.slice(0, 20).map((z) => zeile([{ t: bereichName(z.a) }, { t: z.e }, { t: int(z.n), zahl: true }])))
    : '<p class="muted small">Keine Frust-Klicks gemeldet.</p>';

  const fe = fehlerCodes(summe);
  const fehlerTab = fe.length ? tabelle([{ t: 'Fehlercode' }, { t: 'Bereich' }, { t: 'Anzahl', zahl: true }],
    fe.slice(0, 20).map((z) => zeile([{ t: z.c }, { t: z.a ? bereichName(z.a) : '' }, { t: int(z.n), zahl: true }])))
    : '<p class="muted small">Keine Fehler gemeldet.</p>';

  const ver = liste(summe.version);
  const ger = liste(summe.geraet);
  const umfeld = `<div class="grid c2 start">
    ${karte('Versionen', ver.length ? tabelle([{ t: 'Version' }, { t: 'Sitzungen', zahl: true }], ver.slice(0, 15).map((z) => zeile([{ t: z.name }, { t: int(z.n), zahl: true }]))) : '<p class="muted small">Keine Angaben.</p>')}
    ${karte('Geräte', ger.length ? tabelle([{ t: 'Art' }, { t: 'Sitzungen', zahl: true }], ger.map((z) => zeile([{ t: z.name === 'handy' ? 'Handy' : 'Computer' }, { t: int(z.n), zahl: true }]))) : '<p class="muted small">Keine Angaben.</p>')}
  </div>`;

  const hinweis = summe.verworfen ? `<p class="small muted">${int(summe.verworfen)} Angaben hat der Server verworfen, weil sie nicht zur Erlaubnisliste passten.</p>` : '';
  return `${kopf}
    <div class="mt16">${karte('Bereiche', bereichTab, 'Besuche und Verweildauer')}</div>
    <div class="grid c2 start mt16">
      ${karte('Ladezeiten', ladeTab, 'langsamste zuerst')}
      ${karte('Frust-Klicks', frustTab, 'dreimal schnell an derselben Stelle')}
    </div>
    <div class="mt16">${karte('Fehler', fehlerTab)}</div>
    <div class="mt16">${umfeld}</div>
    ${aboKarte(summe)}
    ${hinweis}`;
}

function aboKarte(summe) {
  const a = aboSeite(summe);
  if (!a.length) return '';
  const zeilen = a.map((z) => {
    const einzel = [...Object.entries(z.sprachen).map(([k, n]) => `${k}: ${int(n)}`), ...Object.entries(z.tarife).map(([k, n]) => `${k}: ${int(n)}`)].join(' · ');
    return zeile([{ t: ABOEREIGNIS[z.e] || z.e }, { t: int(z.n), zahl: true }, { t: einzel }]);
  });
  return `<div class="mt16">${karte('Abo-Seite', tabelle([{ t: 'Ereignis' }, { t: 'Anzahl', zahl: true }, { t: 'Aufgeschlüsselt' }], zeilen), 'Aufrufe und Klicks, keine Besucher')}</div>`;
}

/**
 * Zeichnet den Reiter in `host`.
 * @param {HTMLElement} host
 */
export function nutzungsAnsicht(host) {
  let tage = 30;
  const zeichnen = async () => {
    host.innerHTML = html`<div class="row between wrap mb16" style="gap:8px">
        <div class="seg" role="group" aria-label="Zeitraum" id="nuZeitraum">${raw(ZEITRAEUME.map(([n, t]) => `<button type="button" data-tage="${n}" class="${n === tage ? 'active' : ''}" aria-pressed="${n === tage}">${esc(t)}</button>`).join(''))}</div>
        <button class="btn sm" id="nuNeu">${icon('refresh', 14)} Neu laden</button>
      </div>
      <div id="nuInhalt"><p class="muted small">Lade …</p></div>`;
    host.querySelectorAll('[data-tage]').forEach((b) => b.addEventListener('click', () => { tage = Number(b.dataset.tage); zeichnen(); }));
    host.querySelector('#nuNeu').addEventListener('click', zeichnen);
    const feld = host.querySelector('#nuInhalt');
    try {
      const daten = await api.messung.lesen({ tage });
      feld.innerHTML = html`${raw(ansichtHtml(daten))}`;
      // Balkenhöhen als Eigenschaft setzen (die Seite erlaubt keine Stilangaben im Text).
      feld.querySelectorAll('[data-h]').forEach((s) => { s.style.height = `${s.dataset.h}%`; });
    } catch (ex) {
      feld.innerHTML = html`<div class="notice warn">${ex.message}</div>`;
      err('Nutzung', ex.message);
    }
  };
  zeichnen();
}
