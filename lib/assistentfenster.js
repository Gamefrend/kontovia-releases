/**
 * Kontovia – Assistent: das Fenster.
 *
 * Eine Leiste am rechten Rand (am Telefon bildschirmfüllend), die beim
 * Wechsel der Ansicht offen bleibt, wie die Helfer großer Webseiten: oben
 * Stufe und Denkweise, in der Mitte das Gespräch mit Ergebnis-Karten, unten
 * das Eingabefeld. Jede Antwort zeigt, welche Werkzeuge gelaufen sind, auf
 * Wunsch die Gedanken des Modells, und die Zahlen als Karte aus calc.js.
 *
 * Datenschutz in der Bedienung:
 *  • Das Gespräch lebt nur im Speicher und ist beim Sperren weg.
 *  • Ein Modell lädt nur nach ausdrücklicher Zustimmung, mit Größe und Quelle.
 *  • Anlegen heißt: das gewohnte Fenster öffnet sich ausgefüllt; gespeichert
 *    wird dort, von Hand, mit allen Prüfungen und Rechten wie sonst.
 *
 * Logik: lib/assistent.js (Ablauf), assistentwerkzeuge.js, assistentmodelle.js.
 * Brücke: window.kontovia.ki (src/web/ki.js).
 */

import { esc, todayISO, MOD } from './util.js';
import { icon, modal, toast, warn, err } from './ui.js';
import { store, beimSperren, newTransactionDraft } from './store.js';
import { openPopover, openMenu, closePopover } from './popover.js';
import { prefs, setPref, scope } from './prefs.js';
import { markdownZuHtml } from './markdown.js';
import { zielOeffnen } from './suche.js';
import { kannSchreiben } from './benutzer.js';
import { rolleName } from './rollen.js';
import { beantworten, verlaufKurz } from './assistent.js';
import { STUFEN, stufe, DENKWEISEN, empfehlen, messungBewerten, groesseText } from './assistentmodelle.js';

const api = () => window.kontovia;

/** Tastenkürzel zum Öffnen und Schließen. */
export const ASSISTENT_KUERZEL = `${MOD} J`;

const VORSCHLAEGE = [
  'Was ist noch offen?',
  'Wie viel Umsatz hatte ich diesen Monat?',
  'Wie viel Umsatzsteuer muss ich dieses Quartal zahlen?',
  'Wofür habe ich dieses Jahr am meisten ausgegeben?',
  'Welche Termine habe ich diese Woche?',
  'Erinnere mich morgen an die Belege',
];

const SCHRITT_TEXT = {
  suchen: 'Durchsucht den Bestand', buchungen_auflisten: 'Liest Buchungen', rechnungen_auflisten: 'Liest Rechnungen', kennzahlen: 'Rechnet Einnahmen und Ausgaben',
  nach_kategorie: 'Rechnet nach Kategorien', nach_kontakt: 'Rechnet nach Kunden und Lieferanten', zeitraeume_vergleichen: 'Vergleicht Zeiträume', umsatzsteuer: 'Rechnet die Umsatzsteuer', offene_posten: 'Prüft offene Posten',
  kontostaende: 'Liest Kontostände', termine_auflisten: 'Liest den Kalender', aufgaben_auflisten: 'Liest Aufgaben', kontakt_finden: 'Sucht den Kontakt',
  steuertermine: 'Prüft Steuertermine', rechnen: 'Rechnet', steuer_rechnen: 'Rechnet netto und brutto', oeffnen: 'Öffnet einen Bereich', eintrag_oeffnen: 'Öffnet einen Eintrag',
  buchung_vorschlagen: 'Bereitet eine Buchung vor', aufgabe_vorschlagen: 'Bereitet eine Aufgabe vor', termin_vorschlagen: 'Bereitet einen Termin vor',
  kontakt_vorschlagen: 'Bereitet einen Kontakt vor', rechnung_vorschlagen: 'Bereitet eine Rechnung vor', faehigkeiten: 'Antwortet',
};

/* -------------------------------------------------------------------------- */
/* Zustand (nur im Speicher)                                                   */
/* -------------------------------------------------------------------------- */

const zustand = {
  /** @type {Array<{frage:string, antwort:string, kurz:string}>} */
  verlauf: [],
  laeuft: false,
  abbruch: null,
  geraet: null,
  empfehlung: null,
  imCache: {},
  gestartet: '',
  laedt: false,
  hinweisGezeigt: new Set(),
  /** Läuft gerade die Prüfung, was das Gerät kann und was schon darauf liegt? */
  pruefung: null,
};

let panel = null;
let opener = null;

beimSperren(() => {
  zustand.verlauf = [];
  if (zustand.abbruch) zustand.abbruch.abgebrochen = true;
  zustand.laeuft = false;
  panel = null;
});

const stufeJetzt = () => {
  const s = prefs.kiStufe;
  if (!s || !STUFEN.some((x) => x.id === s)) return 'basis';
  if (zustand.empfehlung && !zustand.empfehlung.moeglich.includes(s)) return 'basis';
  return s;
};
const denkweiseJetzt = () => (DENKWEISEN[prefs.kiDenkweise] ? prefs.kiDenkweise : 'auto');
const modellFuer = (st) => (st.modell && zustand.geraet ? zustand.geraet.f16 === false ? st.modell.replace('q4f16_1', 'q4f32_1') : st.modell : st.modell);
const $p = (sel) => panel?.querySelector(sel);

/* -------------------------------------------------------------------------- */
/* Öffnen, schließen                                                           */
/* -------------------------------------------------------------------------- */

export function assistentOffen() { return !!panel?.isConnected && !panel.hidden; }

/** Öffnet oder schließt die Leiste; mit `frage` wird sie gleich gestellt. */
export function assistentUmschalten(frage = '') {
  if (assistentOffen() && !frage) assistentSchliessen();
  else assistentOeffnen(frage);
}

export async function assistentOeffnen(frage = '') {
  if (!store.db) return;
  const shell = document.querySelector('.shell');
  if (!shell) return;
  if (!panel || !panel.isConnected) {
    panel = bauen();
    shell.append(panel);
    verdrahten();
    zeichneVerlauf();
    zustand.pruefung = geraetPruefen();
  }
  opener = document.activeElement;
  panel.hidden = false;
  shell.classList.add('as-offen');
  document.querySelectorAll('[data-as-knopf]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
  const feld = $p('#asText');
  if (frage) { feld.value = frage; senden(); } else setTimeout(() => feld?.focus(), 30);
}

export function assistentSchliessen() {
  if (!panel) return;
  panel.hidden = true;
  document.querySelector('.shell')?.classList.remove('as-offen');
  document.querySelectorAll('[data-as-knopf]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
}

function bauen() {
  const el = document.createElement('aside');
  el.className = 'as-panel';
  el.id = 'asPanel';
  el.setAttribute('aria-labelledby', 'asTitel');
  el.hidden = true;
  el.innerHTML = `
    <header class="as-kopf">
      <span class="as-logo">${icon('sparkle', 18).__raw}</span>
      <div class="as-titelblock">
        <div class="as-titelzeile"><h2 id="asTitel">Assistent</h2><span class="badge tiny as-test" title="Der Assistent ist neu und wird noch erprobt.">Test</span></div>
        <span class="as-lokal">${icon('lock', 12).__raw} Läuft nur auf diesem Gerät</span>
      </div>
      <button type="button" class="icon-btn" data-as-info aria-label="So funktioniert der Assistent" title="So funktioniert der Assistent">${icon('info', 18).__raw}</button>
      <button type="button" class="icon-btn" data-as-neu aria-label="Neues Gespräch" title="Neues Gespräch">${icon('edit', 18).__raw}</button>
      <button type="button" class="icon-btn" data-as-zu aria-label="Assistent schließen" title="Schließen (Esc)">${icon('x', 18).__raw}</button>
    </header>
    <div class="as-wahl">
      <button type="button" class="as-pille" data-as-stufe aria-haspopup="menu" title="Stufe wählen: wie viel der Assistent versteht">
        ${icon('chip', 15).__raw}<span id="asStufeName"></span>${icon('down', 13).__raw}
      </button>
      <button type="button" class="as-pille" data-as-denken aria-haspopup="menu" title="Denkweise wählen: schneller oder gründlicher">
        ${icon('bolt', 15).__raw}<span id="asDenkName"></span>${icon('down', 13).__raw}
      </button>
      <span class="as-zustand" id="asZustand" role="status"></span>
    </div>
    <div class="as-laden" id="asLaden" hidden>
      <div class="as-laden-text"><span id="asLadenText">Wird vorbereitet …</span><span id="asLadenProzent"></span></div>
      <div class="as-balken" role="progressbar" aria-label="Modell wird geladen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="asLadenBalken"></i></div>
    </div>
    <div class="as-verlauf" id="asVerlauf" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Gespräch"></div>
    <form class="as-eingabe" id="asForm">
      <div class="as-feld">
        <textarea id="asText" rows="1" placeholder="Fragen Sie etwas zu Ihrer Buchhaltung …" aria-label="Frage an den Assistenten" enterkeyhint="send"></textarea>
        <button type="submit" class="as-senden" id="asSenden" aria-label="Senden" title="Senden (Enter)">${icon('arrowUp', 18).__raw}</button>
      </div>
      <p class="as-hinweis">Der Assistent kann sich irren. Zahlen kommen immer aus Ihren Buchungen. <button type="button" class="link-btn" data-as-info>Wie das funktioniert</button></p>
    </form>`;
  return el;
}

function verdrahten() {
  panel.querySelector('[data-as-zu]').addEventListener('click', assistentSchliessen);
  panel.querySelector('[data-as-neu]').addEventListener('click', neuesGespraech);
  panel.querySelectorAll('[data-as-info]').forEach((b) => b.addEventListener('click', infoOeffnen));
  panel.querySelector('[data-as-stufe]').addEventListener('click', (e) => stufenMenue(e.currentTarget));
  panel.querySelector('[data-as-denken]').addEventListener('click', (e) => denkMenue(e.currentTarget));
  const feld = $p('#asText');
  const hoehe = () => { feld.style.height = 'auto'; feld.style.height = `${Math.min(feld.scrollHeight, 160)}px`; };
  feld.addEventListener('input', hoehe);
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); senden(); }
  });
  $p('#asForm').addEventListener('submit', (e) => { e.preventDefault(); if (zustand.laeuft) stoppen(); else senden(); });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .pop')) return;
    e.preventDefault();
    if (zustand.laeuft) stoppen(); else assistentSchliessen();
  });
  panel.querySelector('#asVerlauf').addEventListener('click', klickImVerlauf);
  wahlZeigen();
}

/* -------------------------------------------------------------------------- */
/* Gerät, Stufe, Denkweise                                                     */
/* -------------------------------------------------------------------------- */

async function geraetPruefen() {
  try {
    zustand.geraet = await api().ki.geraet();
    zustand.empfehlung = empfehlen(zustand.geraet);
    const modelle = STUFEN.filter((s) => s.modell).map((s) => modellFuer(s));
    if (zustand.geraet.grafik) zustand.imCache = await api().ki.imCache(modelle).catch(() => ({}));
    const st = await api().ki.status().catch(() => ({}));
    zustand.gestartet = st.gestartet || '';
  } catch {
    zustand.empfehlung = empfehlen(null);
  }
  wahlZeigen();
}

function wahlZeigen() {
  if (!panel) return;
  const st = stufe(stufeJetzt());
  $p('#asStufeName').textContent = st.name;
  $p('#asDenkName').textContent = DENKWEISEN[denkweiseJetzt()].name;
  const denkKnopf = panel.querySelector('[data-as-denken]');
  denkKnopf.disabled = !st.modell;
  denkKnopf.title = st.modell ? 'Denkweise wählen: schneller oder gründlicher' : 'Die Stufe Basis arbeitet mit festen Regeln und denkt nicht nach.';
  const z = $p('#asZustand');
  if (zustand.laedt) z.textContent = '';
  else if (!st.modell) z.textContent = 'Feste Regeln';
  else if (zustand.gestartet === modellFuer(st)) z.innerHTML = `<i class="as-punkt an"></i>Bereit`;
  else if (zustand.imCache[modellFuer(st)]) z.innerHTML = `<i class="as-punkt"></i>Auf dem Gerät`;
  else z.textContent = '';
}

const istAufGeraet = (s) => !s.modell || !!zustand.imCache[modellFuer(s)];

async function stufenMenue(anker) {
  // Erst wissen, was schon auf dem Gerät liegt: sonst stünde „Download“ bei einem geladenen Modell.
  await zustand.pruefung;
  const emp = zustand.empfehlung || { moeglich: ['basis'], empfohlen: 'basis', grund: '' };
  const aktiv = stufeJetzt();
  openPopover(anker, {
    label: 'Stufe wählen',
    className: 'menu as-menu',
    build: (pop, handle) => {
      pop.innerHTML = `
        <div class="menu-title">Stufe: wie viel der Assistent versteht</div>
        ${STUFEN.map((s) => {
          const geht = emp.moeglich.includes(s.id);
          const status = !s.modell ? 'sofort bereit' : istAufGeraet(s) ? 'auf dem Gerät' : `Download ${groesseText(s.downloadMB)}`;
          return `<button type="button" class="menu-opt as-stufe-opt" data-nav data-stufe="${s.id}" aria-pressed="${s.id === aktiv}" ${geht ? '' : 'disabled'}>
            ${icon('check', 14).__raw}
            <span class="menu-label"><strong>${esc(s.name)}${s.id === emp.empfohlen ? ' <span class="badge tiny as-empf">empfohlen</span>' : ''}</strong>
              <span class="menu-sub">${esc(s.beschreibung)}</span>
              <span class="menu-sub as-stufe-meta">${esc(s.fuer)} · ${esc(geht ? status : 'nicht auf diesem Gerät')}</span></span>
          </button>`;
        }).join('')}
        <div class="menu-sep"></div>
        <p class="as-menu-fuss">${esc(emp.grund || '')}</p>`;
      pop.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-stufe]');
        if (!b || b.disabled) return;
        handle.close();
        await stufeWaehlen(b.dataset.stufe);
      });
    },
  });
}

function denkMenue(anker) {
  const st = stufe(stufeJetzt());
  openMenu(anker, {
    label: 'Denkweise',
    sections: [{
      key: 'denken', title: 'Denkweise', value: denkweiseJetzt(),
      options: Object.entries(DENKWEISEN).map(([k, v]) => ({
        value: k, label: v.name, sub: k === 'gruendlich' && !st.denken ? 'Bei Mini nicht möglich, wirkt wie Ausgewogen' : v.beschreibung,
      })),
    }],
    onPick: (_, wert) => { setPref('kiDenkweise', wert); wahlZeigen(); },
  });
}

async function stufeWaehlen(id) {
  const st = stufe(id);
  if (!st.modell) { setPref('kiStufe', 'basis'); wahlZeigen(); return; }
  await zustand.pruefung;
  if (zustand.gestartet !== modellFuer(st) && !istAufGeraet(st)) {
    const ja = await downloadFragen(st);
    if (!ja) return;
  }
  setPref('kiStufe', st.id);
  wahlZeigen();
  await modellStarten(st);
}

/** Fragt vor dem ersten Laden: Größe, Quelle, was nicht gesendet wird. */
async function downloadFragen(st) {
  let frei = 0;
  try { frei = (await api().ki.speicher()).frei; } catch { /* unbekannt */ }
  const zuWenig = frei && frei < st.downloadMB * 1.05 * 1e6;
  const knapp = !zuWenig && frei && frei < st.downloadMB * 1.3 * 1e6;
  return new Promise((aufloesen) => {
    let fertig = false;
    const m = modal({
      title: `Stufe ${st.name} herunterladen?`,
      size: 'slim',
      body: `
        <p class="mt0">Das Sprachmodell für die Stufe ${esc(st.name)} wird <strong>einmalig</strong> heruntergeladen und bleibt danach auf diesem Gerät. Ab dann arbeitet der Assistent auch ohne Internet.</p>
        <table class="data compact as-dl">
          <tbody>
            <tr><td class="muted">Größe</td><td>${esc(groesseText(st.downloadMB))}</td></tr>
            <tr><td class="muted">Speicher auf dem Grafikchip</td><td>etwa ${esc(groesseText(st.grafikMB))}</td></tr>
            <tr><td class="muted">Quelle</td><td>Hugging Face und GitHub, in genau dieser geprüften Fassung</td></tr>
            ${frei ? `<tr><td class="muted">Frei im Browser</td><td>${esc(groesseText(Math.round(frei / 1e6)))}</td></tr>` : ''}
          </tbody>
        </table>
        <p class="small"><strong>Ihre Daten werden dabei nicht gesendet.</strong> Geladen werden nur die Dateien des Modells. Der Anbieter sieht wie bei jedem Download Ihre IP-Adresse. Ihre Fragen und Ihre Buchhaltung bleiben auf dem Gerät.</p>
        ${knapp ? '<p class="small warn-text">Der freie Speicher ist knapp. Der Download kann scheitern.</p>' : ''}
        ${zuWenig ? '<p class="small warn-text"><strong>Im Browser ist nicht genug Speicher frei.</strong> Entfernen Sie ein anderes Modell unter „So funktioniert der Assistent“ oder wählen Sie eine kleinere Stufe.</p>' : ''}
        ${zustand.geraet?.telefon ? '<p class="small muted">Tipp: am besten im WLAN laden.</p>' : ''}`,
      foot: `<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja ${zuWenig ? 'disabled' : ''}>Herunterladen und starten</button>`,
      onClose: () => { if (!fertig) aufloesen(false); },
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-ja]').addEventListener('click', () => { fertig = true; m.close(); aufloesen(true); });
  });
}

/** Lädt das Modell der Stufe (aus dem Cache oder dem Netz) und zeigt den Fortschritt. */
async function modellStarten(st) {
  const modell = modellFuer(st);
  if (!modell || zustand.gestartet === modell) return true;
  const box = $p('#asLaden');
  zustand.laedt = true;
  wahlZeigen();
  if (box) box.hidden = false;
  const zeigen = ({ anteil, text }) => {
    if (!panel) return;
    const p = Math.round((Number(anteil) || 0) * 100);
    $p('#asLadenBalken').style.width = `${p}%`;
    $p('.as-balken').setAttribute('aria-valuenow', String(p));
    $p('#asLadenProzent').textContent = `${p} %`;
    // „Fetching param cache“ ist der Download, „Loading model from cache“ und die Shader das Starten.
    $p('#asLadenText').textContent = /from cache|Finish loading|shader|GPU/i.test(text || '') || zustand.imCache[modell]
      ? `Stufe ${st.name} wird gestartet …` : `Stufe ${st.name} wird heruntergeladen …`;
  };
  zeigen({ anteil: 0, text: '' });
  try {
    const warSchonDa = !!zustand.imCache[modell];
    await api().ki.laden(modell, zeigen);
    zustand.gestartet = modell;
    // Hat der Browser die Dateien wirklich behalten? Bei knappem Speicher legt er sie still nicht ab.
    zustand.imCache[modell] = !!(await api().ki.imCache([modell]).catch(() => ({})))[modell];
    if (!warSchonDa && !zustand.imCache[modell]) {
      warn('Nur für diese Sitzung geladen', `Der Browser hat die Stufe ${st.name} nicht dauerhaft gespeichert, meist aus Platzmangel. Sie läuft jetzt, muss nach dem nächsten Start aber erneut geladen werden.`);
    }
    return true;
  } catch (e) {
    const grund = e.code === 'KI_GRAFIK' ? 'Der Grafikchip hat das Modell nicht geschafft. Wählen Sie eine kleinere Stufe.'
      : e.code === 'KI_NETZ' ? 'Keine Verbindung zum Download. Prüfen Sie das Internet und versuchen Sie es erneut.'
        : e.code === 'KI_PRUEFSUMME' ? 'Die geladenen Dateien stimmen nicht mit der geprüften Fassung überein. Aus Sicherheitsgründen startet das Modell nicht.'
          : e.message;
    err('Modell konnte nicht starten', grund);
    setPref('kiStufe', 'basis');
    return false;
  } finally {
    zustand.laedt = false;
    if (box) box.hidden = true;
    wahlZeigen();
  }
}

/* -------------------------------------------------------------------------- */
/* Gespräch                                                                    */
/* -------------------------------------------------------------------------- */

function neuesGespraech() {
  if (zustand.laeuft) stoppen();
  zustand.verlauf = [];
  api()?.ki?.vergessen?.().catch?.(() => {});
  zeichneVerlauf();
  $p('#asText')?.focus();
}

function zeichneVerlauf() {
  const box = $p('#asVerlauf');
  if (!box) return;
  if (!zustand.verlauf.length) {
    box.innerHTML = `
      <div class="as-leer">
        <span class="as-leer-logo">${icon('sparkle', 26).__raw}</span>
        <p class="as-leer-titel">Wie kann ich helfen?</p>
        <p class="as-leer-text">Ich suche, rechne und öffne für Sie, mit Ihrer Buchhaltung. Alles bleibt auf diesem Gerät.</p>
        <div class="as-vorschlaege">${VORSCHLAEGE.map((v) => `<button type="button" class="as-vorschlag" data-frage="${esc(v)}">${esc(v)}</button>`).join('')}</div>
      </div>`;
    return;
  }
  box.innerHTML = '';
}

function stoppen() {
  if (zustand.abbruch) zustand.abbruch.abgebrochen = true;
  api()?.ki?.abbrechen?.().catch?.(() => {});
}

function sendenKnopf() {
  const b = $p('#asSenden');
  if (!b) return;
  b.innerHTML = zustand.laeuft ? icon('stop', 18).__raw : icon('arrowUp', 18).__raw;
  b.setAttribute('aria-label', zustand.laeuft ? 'Antwort anhalten' : 'Senden');
  b.title = zustand.laeuft ? 'Anhalten (Esc)' : 'Senden (Enter)';
  b.classList.toggle('stopp', zustand.laeuft);
}

/** Stellt die Frage aus dem Eingabefeld. */
async function senden() {
  const feld = $p('#asText');
  const frage = (feld?.value || '').trim();
  if (!frage || zustand.laeuft) return;
  feld.value = '';
  feld.style.height = 'auto';
  const box = $p('#asVerlauf');
  if (!zustand.verlauf.length) box.innerHTML = '';

  box.insertAdjacentHTML('beforeend', `<div class="as-nachricht as-nutzer"><div class="as-blase">${esc(frage)}</div></div>`);
  const antwort = document.createElement('div');
  antwort.className = 'as-nachricht as-antwort';
  antwort.innerHTML = `
    <div class="as-arbeit"><span class="as-dreht" aria-hidden="true"></span><span class="as-arbeit-text">Überlegt …</span></div>
    <details class="as-gedanken" hidden><summary>Gedanken</summary><div class="as-gedanken-text"></div></details>
    <ol class="as-schritte" hidden></ol>
    <div class="as-text"></div>
    <div class="as-karten"></div>
    <div class="as-fuss" hidden></div>`;
  box.append(antwort);
  box.scrollTop = box.scrollHeight;

  const st = stufe(stufeJetzt());
  zustand.laeuft = true;
  const abbruch = { abgebrochen: false };
  zustand.abbruch = abbruch;
  sendenKnopf();
  const t0 = performance.now();
  let motor = null;
  if (st.modell) {
    // Liegt das Modell nicht (mehr) auf dem Gerät, etwa weil der Browser Platz gebraucht hat,
    // wird vor dem Laden wieder gefragt. Sonst antwortet die Stufe Basis.
    await zustand.pruefung;
    const darf = zustand.gestartet === modellFuer(st) || istAufGeraet(st) || await downloadFragen(st);
    const bereit = darf && await modellStarten(st);
    if (bereit) motor = { antworten: (anfrage, beiTeil) => api().ki.antworten(anfrage, beiTeil) };
  }

  let rohText = '';
  let gedanken = '';
  let messung = null;
  const textEl = antwort.querySelector('.as-text');
  const arbeitText = antwort.querySelector('.as-arbeit-text');
  // Die Ansicht folgt der Antwort, bis man selbst nach oben scrollt.
  let folgen = true;
  const loslassen = (e) => {
    if (e.type === 'touchmove' || e.deltaY < 0) folgen = false;
    else if (box.scrollHeight - box.scrollTop - box.clientHeight < 60) folgen = true;
  };
  box.addEventListener('wheel', loslassen, { passive: true });
  box.addEventListener('touchmove', loslassen, { passive: true });
  const nachUnten = () => { if (folgen) box.scrollTop = box.scrollHeight; };
  const melden = (ev) => {
    if (ev.typ === 'denken') {
      gedanken += ev.text;
      const g = antwort.querySelector('.as-gedanken');
      g.hidden = false;
      g.querySelector('.as-gedanken-text').textContent = gedanken;
      arbeitText.textContent = 'Denkt nach …';
    } else if (ev.typ === 'text') {
      rohText += ev.text;
      textEl.textContent = rohText;
      arbeitText.textContent = 'Schreibt …';
    } else if (ev.typ === 'werkzeug') {
      schrittZeigen(antwort, ev);
      karteZeigen(antwort, ev.ergebnis);
      arbeitText.textContent = SCHRITT_TEXT[ev.name] ? `${SCHRITT_TEXT[ev.name]} …` : 'Arbeitet …';
      rohText = '';
      textEl.textContent = '';
    } else if (ev.typ === 'messung') {
      messung = ev.nutzung;
    } else if (ev.typ === 'denkweise') {
      arbeitText.textContent = ev.denkweise === 'gruendlich' ? 'Denkt nach …' : 'Überlegt …';
    }
    nachUnten();
  };

  let r;
  try {
    r = await beantworten({
      frage, verlauf: zustand.verlauf, stufeId: motor ? st.id : 'basis', denkweise: denkweiseJetzt(),
      db: store.db, heute: todayISO(), privat: !!scope.includeUnlisted,
      nutzer: { rolle: store.nutzer ? rolleName(store.nutzer.rolle) : '', kannSchreiben: kannSchreiben() },
      motor, melden, abbruch,
    });
  } catch (e) {
    r = { text: `Das hat nicht geklappt: ${e.message}`, ergebnisse: [], denkweise: '', rueckfall: false, schritte: 0 };
  }
  box.removeEventListener('wheel', loslassen);
  box.removeEventListener('touchmove', loslassen);
  if (!panel?.isConnected) return; // gesperrt oder geschlossen während der Antwort

  antwort.querySelector('.as-arbeit').remove();
  textEl.innerHTML = markdownZuHtml(r.text);
  const sek = ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',');
  const fuss = antwort.querySelector('.as-fuss');
  fuss.hidden = false;
  fuss.innerHTML = `
    <span>${r.quelle === 'modell' ? 'Antwort einer KI · ' : 'Feste Regeln · '}${esc(motor ? st.name : 'Basis')}${r.quelle === 'modell' && DENKWEISEN[r.denkweise] ? ` · ${esc(DENKWEISEN[r.denkweise].name)}` : ''} · ${sek} s</span>
    ${r.rueckfall ? '<span class="as-rueckfall" title="Das Modell hat keine brauchbare Antwort geliefert. Diese Antwort kommt aus den festen Regeln.">feste Regeln</span>' : ''}
    <button type="button" class="icon-btn as-kopieren" aria-label="Antwort kopieren" title="Antwort kopieren">${icon('copy', 14).__raw}</button>`;
  fuss.querySelector('.as-kopieren').addEventListener('click', () => {
    navigator.clipboard?.writeText(r.text).then(() => toast('Kopiert'), () => {});
  });
  if (abbruch.abgebrochen) fuss.insertAdjacentHTML('afterbegin', '<span class="as-rueckfall">angehalten</span>');

  zustand.verlauf.push({ frage, antwort: r.text, kurz: verlaufKurz(r.ergebnisse) });
  if (zustand.verlauf.length > 12) zustand.verlauf.shift();
  zustand.laeuft = false;
  zustand.abbruch = null;
  sendenKnopf();
  nachUnten();
  if (messung?.schreibenProSek && motor) messungMerken(st, messung.schreibenProSek, antwort);
}

/** Merkt die Geschwindigkeit und rät einmal je Sitzung zu einer anderen Stufe, wenn es sich lohnt. */
function messungMerken(st, proSek, antwort) {
  const alt = prefs.kiMessung?.[st.id];
  const neu = alt ? Math.round((alt * 2 + proSek) / 3) : Math.round(proSek);
  setPref('kiMessung', { ...(prefs.kiMessung || {}), [st.id]: neu });
  const b = messungBewerten(st.id, neu);
  if (!b.vorschlag || zustand.hinweisGezeigt.has(st.id) || !zustand.empfehlung?.moeglich.includes(b.vorschlag)) return;
  zustand.hinweisGezeigt.add(st.id);
  const ziel = stufe(b.vorschlag);
  antwort.insertAdjacentHTML('beforeend', `
    <div class="as-tipp">${icon('info', 15).__raw}<span>${esc(b.text)}</span>
      <button type="button" class="btn sm" data-stufe-wechsel="${ziel.id}">Zu ${esc(ziel.name)} wechseln</button></div>`);
}

/* -------------------------------------------------------------------------- */
/* Schritte und Karten                                                         */
/* -------------------------------------------------------------------------- */

function schrittZeigen(antwort, ev) {
  const ol = antwort.querySelector('.as-schritte');
  ol.hidden = false;
  const fehler = ev.ergebnis?.daten?.fehler;
  const anzahl = ev.ergebnis?.daten?.treffer ?? ev.ergebnis?.daten?.anzahl;
  const details = Object.entries(ev.argumente || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(', ');
  ol.insertAdjacentHTML('beforeend', `
    <li class="${fehler ? 'fehler' : ''}">${icon(fehler ? 'alert' : 'check', 13).__raw}
      <span>${esc(SCHRITT_TEXT[ev.name] || ev.name)}${anzahl !== undefined ? ` · ${esc(String(anzahl))} ${anzahl === 1 ? 'Treffer' : 'Treffer'}` : ''}${fehler ? ` · ${esc(fehler)}` : ''}</span>
      ${details ? `<span class="as-schritt-details">${esc(details)}</span>` : ''}</li>`);
}

/** Merkt sich Karten-Daten, damit Klicks darauf ihr Ziel finden. */
const kartenDaten = new WeakMap();

function karteZeigen(antwort, e) {
  const k = e?.karte;
  if (!k) return;
  const box = antwort.querySelector('.as-karten');
  const el = document.createElement('div');
  el.className = `as-karte as-karte-${k.art}`;
  const kopf = `<div class="as-karte-kopf"><strong>${esc(k.titel || '')}</strong>${k.zeitraum ? `<span>${esc(k.zeitraum)}</span>` : ''}</div>`;
  const ziele = [];
  const zielAttr = (z) => { if (!z) return ''; ziele.push(z); return ` data-ziel="${ziele.length - 1}"`; };
  const zahlen = (k.zahlen || []).length ? `<div class="as-zahlen">${k.zahlen.map((z) => `
      <div class="as-zahl${z.gross ? ' gross' : ''}"><span>${esc(z.name)}</span><strong class="${z.ton ? `ton-${z.ton}` : ''}">${esc(z.wert)}</strong></div>`).join('')}</div>` : '';

  if (k.art === 'sprung') {
    el.innerHTML = `<button type="button" class="as-sprung"${zielAttr(k.ziel)}>${icon('right', 15).__raw}<span>Geöffnet: ${esc(k.titel)}</span></button>`;
    // Ein Sprung geschieht sofort; am Telefon schließt die Leiste dafür.
    setTimeout(() => { zielOeffnen(k.ziel); if (window.matchMedia('(max-width: 820px)').matches) assistentSchliessen(); }, 120);
  } else if (k.art === 'vorschlag') {
    const darf = kannSchreiben();
    el.innerHTML = `${kopf}
      <dl class="as-felder">${(k.felder || []).map(([n, w]) => `<dt>${esc(n)}</dt><dd>${esc(w)}</dd>`).join('')}</dl>
      ${k.warnung ? `<p class="as-warnung">${icon('alert', 14).__raw}${esc(k.warnung)}</p>` : ''}
      <div class="as-karte-knoepfe">
        ${darf ? `<button type="button" class="btn primary sm" data-vorschlag>${icon('edit', 14).__raw} Prüfen und speichern</button>` : '<span class="small muted">Mit Ihrer Rolle lässt sich nichts anlegen.</span>'}
        <button type="button" class="btn sm" data-verwerfen>Verwerfen</button>
      </div>
      <p class="as-karte-fuss">Noch nicht gespeichert. Das Fenster öffnet sich ausgefüllt.</p>`;
  } else if (k.art === 'text') {
    el.innerHTML = `${kopf}<p class="as-karte-text">${esc(k.text || '')}</p>`;
  } else {
    const eintraege = (k.eintraege || []).map((x) => {
      const inhalt = `<span class="as-eintrag-text"><span class="as-eintrag-titel">${esc(x.titel)}</span>${x.sub ? `<span class="as-eintrag-sub">${esc(x.sub)}</span>` : ''}
        ${x.balken ? `<span class="as-eintrag-balken"><i style="width:${Math.max(2, Math.round(x.balken * 100))}%"></i></span>` : ''}</span>
        ${x.betrag ? `<span class="as-eintrag-betrag${x.ton ? ` ton-${x.ton}` : ''}">${esc(x.betrag)}</span>` : ''}`;
      return x.ziel ? `<button type="button" class="as-eintrag"${zielAttr(x.ziel)}>${inhalt}</button>` : `<div class="as-eintrag">${inhalt}</div>`;
    }).join('');
    const leer = !(k.eintraege || []).length && !(k.zahlen || []).length ? `<p class="as-karte-text muted">${esc(k.leer || 'Nichts gefunden.')}</p>` : '';
    el.innerHTML = `${kopf}${zahlen}${eintraege ? `<div class="as-eintraege">${eintraege}</div>` : ''}${leer}
      ${k.mehr ? `<button type="button" class="link-btn as-mehr"${zielAttr(k.mehr.ziel)}>${esc(k.mehr.text)} ${icon('right', 13).__raw}</button>` : ''}`;
  }
  kartenDaten.set(el, { ziele, ergebnis: e });
  box.append(el);
}

async function klickImVerlauf(ev) {
  const frage = ev.target.closest('[data-frage]');
  if (frage) { $p('#asText').value = frage.dataset.frage; senden(); return; }
  const wechsel = ev.target.closest('[data-stufe-wechsel]');
  if (wechsel) { wechsel.closest('.as-tipp')?.remove(); await stufeWaehlen(wechsel.dataset.stufeWechsel); return; }
  const karte = ev.target.closest('.as-karte');
  const info = karte && kartenDaten.get(karte);
  if (!info) return;
  const z = ev.target.closest('[data-ziel]');
  if (z) {
    await zielOeffnen(info.ziele[Number(z.dataset.ziel)]);
    if (window.matchMedia('(max-width: 820px)').matches) assistentSchliessen();
    return;
  }
  if (ev.target.closest('[data-verwerfen]')) {
    karte.classList.add('verworfen');
    karte.querySelector('.as-karte-knoepfe').innerHTML = '<span class="small muted">Verworfen.</span>';
    return;
  }
  if (ev.target.closest('[data-vorschlag]')) {
    await vorschlagOeffnen(info.ergebnis.karte);
    karte.querySelector('.as-karte-fuss').textContent = 'Im Fenster geöffnet. Gespeichert wird dort.';
  }
}

/** Öffnet das gewohnte Fenster, ausgefüllt mit dem Vorschlag. */
async function vorschlagOeffnen(k) {
  const d = k.daten || {};
  if (window.matchMedia('(max-width: 820px)').matches) assistentSchliessen();
  if (k.vorschlag === 'buchung') {
    const tx = { ...newTransactionDraft(d.typ), date: d.datum, description: d.beschreibung, gross: d.gross, net: d.net, vat: d.vat, vatRate: d.vatRate, paidDate: d.paidDate };
    if (d.categoryId) tx.categoryId = d.categoryId;
    if (d.contactId) tx.contactId = d.contactId;
    (await import('../views/transactions.js')).openTransactionDialog(tx, d.typ);
  } else if (k.vorschlag === 'aufgabe') {
    (await import('../views/todos.js')).openTodoDialog(null, { title: d.title, dueDate: d.dueDate || '', notes: d.notes || '' });
  } else if (k.vorschlag === 'termin') {
    (await import('../views/calendar.js')).openAppointmentDialog(null, d);
  } else if (k.vorschlag === 'kontakt') {
    (await import('../views/master.js')).openStammdatum('contacts', null, d);
  } else if (k.vorschlag === 'rechnung') {
    const { navigate } = await import('./router.js');
    navigate('rechnungen', { neu: true, ...(d.kontaktId ? { kontaktId: d.kontaktId } : {}), vorgabe: { betreff: d.betreff || '', positionen: d.positionen || [] } });
    if (d.kundeText) warn('Kunde fehlt noch', `„${d.kundeText}“ gibt es noch nicht als Kontakt. Tragen Sie den Kunden in der Rechnung ein.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Erklärung                                                                   */
/* -------------------------------------------------------------------------- */

async function infoOeffnen() {
  closePopover();
  await zustand.pruefung;
  const emp = zustand.empfehlung;
  let belegt = 0;
  try { belegt = (await api().ki.speicher()).belegt; } catch { /* unbekannt */ }
  const aufGeraet = STUFEN.filter((s) => s.modell && istAufGeraet(s));
  const m = modal({
    title: 'So funktioniert der Assistent',
    body: `
      <p class="mt0"><strong>Der Assistent ist neu und noch in Erprobung.</strong> Er beantwortet Fragen zu Ihrer Buchhaltung, sucht Einträge, rechnet und öffnet Bereiche. Neue Buchungen, Aufgaben, Termine, Kontakte und Rechnungen bereitet er vor; speichern tun Sie selbst, im gewohnten Fenster.</p>
      <h3>Ihre Daten bleiben hier</h3>
      <ul class="as-liste">
        <li>Das Sprachmodell läuft auf dem Grafikchip <strong>dieses Geräts</strong>. Fragen, Antworten und Ihre Buchhaltung werden nirgendwohin gesendet.</li>
        <li>Das Internet braucht es nur einmal, um ein Modell herunterzuladen. Danach geht alles offline.</li>
        <li>Das Modell lernt nichts dazu und verändert sich nicht. Es ist eine feste, geprüfte Fassung.</li>
        <li>Das Gespräch steht nur im Arbeitsspeicher. Beim Sperren oder mit „Neues Gespräch“ ist es weg.</li>
      </ul>
      <h3>Stufen</h3>
      <table class="data compact">
        <thead><tr><th>Stufe</th><th>Für</th><th class="num">Download</th></tr></thead>
        <tbody>${STUFEN.map((s) => `<tr><td><strong>${esc(s.name)}</strong>${emp?.empfohlen === s.id ? ' <span class="badge tiny as-empf">empfohlen</span>' : ''}<div class="small muted">${esc(s.beschreibung)}</div></td><td>${esc(s.fuer)}</td><td class="num">${esc(groesseText(s.downloadMB))}</td></tr>`).join('')}</tbody>
      </table>
      ${emp?.grund ? `<p class="small muted">${esc(emp.grund)}</p>` : ''}
      <h3>Denkweise</h3>
      <ul class="as-liste">${Object.values(DENKWEISEN).map((d) => `<li><strong>${esc(d.name)}:</strong> ${esc(d.beschreibung)}</li>`).join('')}</ul>
      <h3>Wo die Grenzen liegen</h3>
      <ul class="as-liste">
        <li>Zahlen rechnet immer Kontovia selbst. Das Modell sucht nur aus, was gerechnet wird. Trotzdem kann es eine Frage falsch verstehen: Unter jeder Antwort steht, was gelaufen ist.</li>
        <li>Steuerberatung ersetzt der Assistent nicht.</li>
        <li>Kleine Stufen verwechseln schneller etwas. Klappt eine Antwort nicht, springt die Stufe Basis mit festen Regeln ein.</li>
      </ul>
      <h3>Auf diesem Gerät</h3>
      ${aufGeraet.length ? `<div class="as-geladen">${aufGeraet.map((s) => `
        <div class="row"><span><strong>${esc(s.name)}</strong> <span class="muted small">${esc(groesseText(s.downloadMB))}</span></span>
          <button type="button" class="btn sm" data-entfernen="${s.id}">${icon('trash', 14).__raw} Entfernen</button></div>`).join('')}</div>`
        : '<p class="small muted">Noch kein Modell heruntergeladen.</p>'}
      ${belegt ? `<p class="small muted">Kontovia belegt im Browser zusammen ${esc(groesseText(Math.round(belegt / 1e6)))}.</p>` : ''}
      <p class="small muted">Tastenkürzel: ${esc(ASSISTENT_KUERZEL)} öffnet und schließt den Assistenten.</p>`,
    foot: '<button class="btn primary" data-close-modal>Verstanden</button>',
  });
  m.root.querySelector('[data-close-modal]').addEventListener('click', () => m.close());
  m.root.querySelectorAll('[data-entfernen]').forEach((b) => b.addEventListener('click', async () => {
    const s = stufe(b.dataset.entfernen);
    try {
      await api().ki.loeschen(modellFuer(s));
      zustand.imCache[modellFuer(s)] = false;
      if (zustand.gestartet === modellFuer(s)) zustand.gestartet = '';
      if (stufeJetzt() === s.id) setPref('kiStufe', 'basis');
      b.closest('.row').remove();
      wahlZeigen();
      toast(`Stufe ${s.name} entfernt`);
    } catch (e) {
      err('Entfernen fehlgeschlagen', e.message);
    }
  }));
}

