/**
 * Kontovia – Seitenleiste nach eigenem Geschmack: einklappen, Bereiche aus- und
 * wieder einblenden, Reihenfolge ändern.
 *
 * Die Wahl gehört zum Gerät (prefs.js, nicht Tresor, nicht Abgleich): Am Telefon
 * passt eine andere Leiste als am großen Bildschirm. Die Gruppen der Leiste
 * (Arbeit, Auswertung, Verwaltung) bleiben fest; verschoben wird innerhalb einer
 * Gruppe. Bedienung: Rechtsklick (am Telefon langes Drücken) öffnet ein Menü,
 * mit der Maus lässt sich ein Eintrag nach kurzem Halten auch ziehen, mit der
 * Tastatur verschiebt Alt+Pfeil. Ausgeblendete Bereiche bleiben über die Suche
 * und die Tastenkürzel erreichbar und stehen im Menü zum Einblenden bereit.
 */

import { prefs, setPref } from './prefs.js';
import { openPopover, closePopover } from './popover.js';
import { icon } from './ui.js';
import { esc } from './util.js';

/** Die festen Gruppen der Leiste, in der Reihenfolge der Voreinstellung. */
export const NAV_GRUPPEN = [
  ['dashboard', 'transactions', 'kontoimport', 'rechnungen', 'calendar', 'todos'],
  ['reports', 'export'],
  ['master', 'settings', 'help'],
];
/** Ohne Einstellungen käme man nicht mehr zurück zu den Werkzeugen für diese Leiste. */
const IMMER_SICHTBAR = new Set(['settings']);

const gruppeVon = (id) => NAV_GRUPPEN.findIndex((g) => g.includes(id));
export const verbergbar = (id) => !IMMER_SICHTBAR.has(id);
export const istVersteckt = (id) => verbergbar(id) && (prefs.navVersteckt || []).includes(id);
export const istAngepasst = () => (prefs.navVersteckt || []).length > 0 || (prefs.navReihenfolge || []).length > 0;

/** Alle Einträge einer Gruppe in der gewählten Reihenfolge, ausgeblendete eingeschlossen. */
export function navFolge(g) {
  const gemerkt = prefs.navReihenfolge || [];
  const basis = NAV_GRUPPEN[g];
  const rang = (id) => { const i = gemerkt.indexOf(id); return i >= 0 ? i : 1000 + basis.indexOf(id); };
  return [...basis].sort((a, b) => rang(a) - rang(b));
}

/** Die sichtbaren Einträge einer Gruppe. */
export const navSichtbar = (g) => navFolge(g).filter((id) => !istVersteckt(id));

/** Alle Einträge, die im Moment ausgeblendet sind, in der Reihenfolge der Gruppen. */
export const navVerborgene = () => NAV_GRUPPEN.flatMap((_, g) => navFolge(g)).filter(istVersteckt);

const speichereFolge = (folgen) => setPref('navReihenfolge', folgen.flat());

function folgenAlle() { return NAV_GRUPPEN.map((_, g) => navFolge(g)); }

export function verbergen(id) {
  if (!verbergbar(id) || istVersteckt(id)) return;
  setPref('navVersteckt', [...(prefs.navVersteckt || []), id]);
}

export function zeigen(id) {
  setPref('navVersteckt', (prefs.navVersteckt || []).filter((x) => x !== id));
}

/** Tauscht einen Eintrag mit dem nächsten sichtbaren Nachbarn seiner Gruppe. @returns {boolean} ob sich etwas bewegt hat */
export function verschieben(id, richtung) {
  const g = gruppeVon(id);
  if (g < 0) return false;
  const folgen = folgenAlle();
  const folge = folgen[g];
  const i = folge.indexOf(id);
  let j = i + richtung;
  while (j >= 0 && j < folge.length && istVersteckt(folge[j])) j += richtung;
  if (j < 0 || j >= folge.length) return false;
  [folge[i], folge[j]] = [folge[j], folge[i]];
  speichereFolge(folgen);
  return true;
}

/** Übernimmt die Reihenfolge der sichtbaren Einträge einer Gruppe (nach dem Ziehen); ausgeblendete behalten ihren Platz dazwischen. */
function folgeSetzen(g, sichtbar) {
  const folgen = folgenAlle();
  let k = 0;
  folgen[g] = folgen[g].map((id) => (istVersteckt(id) ? id : sichtbar[k++]));
  speichereFolge(folgen);
}

export function zuruecksetzen() {
  setPref('navReihenfolge', []);
  setPref('navVersteckt', []);
}

export const istSchmal = () => !!prefs.navSchmal;
export const schmalSetzen = (an) => setPref('navSchmal', !!an);

/* -------------------------------------------------------------------------- */
/* Menü                                                                        */
/* -------------------------------------------------------------------------- */

/** Ein Anker ohne Element: das Menü öffnet sich an der Stelle des Zeigers. */
function punktAnker(x, y) {
  return {
    getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }),
    setAttribute() {}, contains: () => false, focus() {}, isConnected: false,
  };
}

/**
 * Öffnet das Menü für einen Eintrag (`id`) oder die freie Fläche der Leiste (null).
 * @param {{titel:(id:string)=>string, symbol:(id:string)=>string, neu:()=>void}} h
 */
function menueOeffnen(x, y, id, h) {
  const verborgen = navVerborgene();
  if (!id && !verborgen.length && !istAngepasst()) return;
  const zeile = (aktion, ic, text, extra = '') => `<button type="button" class="menu-opt nav-menue-opt" data-nav data-aktion="${aktion}"${extra}>${icon(ic, 15).__raw}<span class="menu-label">${text}</span></button>`;
  openPopover(punktAnker(x, y), {
    label: 'Seitenleiste anpassen',
    className: 'menu nav-menue',
    build: (pop, handle) => {
      let teile = '';
      if (id) {
        const g = gruppeVon(id);
        const sicht = navSichtbar(g);
        const i = sicht.indexOf(id);
        teile += `<div class="menu-title">${esc(h.titel(id))}</div>`;
        teile += zeile('hoch', 'arrowUp', 'Nach oben', i <= 0 ? ' disabled' : '');
        teile += zeile('runter', 'arrowDown', 'Nach unten', i >= sicht.length - 1 ? ' disabled' : '');
        if (verbergbar(id)) teile += zeile('weg', 'hide', 'Ausblenden');
      }
      if (verborgen.length) {
        if (teile) teile += '<div class="menu-sep"></div>';
        teile += '<div class="menu-title">Ausgeblendet</div>';
        teile += verborgen.map((v) => zeile(`zeigen:${v}`, h.symbol(v), `${esc(h.titel(v))} einblenden`)).join('');
      }
      if (istAngepasst()) {
        if (teile) teile += '<div class="menu-sep"></div>';
        teile += zeile('zurueck', 'refresh', 'Leiste zurücksetzen');
      }
      pop.innerHTML = teile;
      pop.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-aktion]');
        if (!b || b.disabled) return;
        const [aktion, ziel] = b.dataset.aktion.split(':');
        handle.close();
        if (aktion === 'hoch') verschieben(id, -1);
        else if (aktion === 'runter') verschieben(id, 1);
        else if (aktion === 'weg') verbergen(id);
        else if (aktion === 'zeigen') zeigen(ziel);
        else if (aktion === 'zurueck') zuruecksetzen();
        h.neu();
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Verdrahtung                                                                 */
/* -------------------------------------------------------------------------- */

const HALTEN_MS = 200;
const WEG_PX = 6;

/**
 * Hängt Menü, Ziehen und Tastatur an die Leiste. Alles hängt an `nav` selbst, nicht
 * an den Einträgen, und übersteht daher das Neuzeichnen der Einträge.
 */
export function seitenleisteVerdrahten(nav, h) {
  nav.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const item = e.target.closest('.nav-item');
    menueOeffnen(e.clientX, e.clientY, item?.dataset.view || null, h);
  });

  nav.addEventListener('keydown', (e) => {
    const item = e.target.closest?.('.nav-item');
    if (!item || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = item.dataset.view;
    if (!verschieben(id, e.key === 'ArrowUp' ? -1 : 1)) return;
    h.neu();
    nav.querySelector(`.nav-item[data-view="${id}"]`)?.focus();
  });

  // Ziehen mit der Maus nach kurzem Halten. Am Telefon gilt stattdessen das Menü (langes Drücken).
  let warten = null;
  let zug = null;
  let start = null;
  let nachklick = false;
  const abbrechen = () => { clearTimeout(warten); warten = null; start = null; };

  nav.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const item = e.target.closest('.nav-item');
    if (!item) return;
    start = { x: e.clientX, y: e.clientY };
    warten = setTimeout(() => {
      warten = null;
      const gruppe = item.parentElement;
      if (gruppe.querySelectorAll('.nav-item').length < 2) return;
      zug = { item, gruppe };
      closePopover();
      item.classList.add('zieht');
      nav.classList.add('zieht-aktiv');
      try { nav.setPointerCapture(e.pointerId); } catch { /* der Zeiger ist schon weg */ }
    }, HALTEN_MS);
  });

  nav.addEventListener('pointermove', (e) => {
    if (warten && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > WEG_PX) abbrechen();
    if (!zug) return;
    // Nur innerhalb der Gruppe: das Element unter dem Zeiger entscheidet, vor oder hinter welchem Eintrag es landet.
    const ziel = [...zug.gruppe.querySelectorAll('.nav-item')].find((n) => {
      const r = n.getBoundingClientRect();
      return n !== zug.item && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!ziel) return;
    const r = ziel.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) ziel.before(zug.item);
    else ziel.after(zug.item);
  });

  const loslassen = (abgebrochen) => {
    abbrechen();
    if (!zug) return;
    const { item, gruppe } = zug;
    zug = null;
    item.classList.remove('zieht');
    nav.classList.remove('zieht-aktiv');
    // Der Klick, der auf das Loslassen folgt, soll den Eintrag nicht öffnen.
    nachklick = true;
    setTimeout(() => { nachklick = false; }, 0);
    if (abgebrochen) { h.neu(); return; }
    const ids = [...gruppe.querySelectorAll('.nav-item')].map((n) => n.dataset.view);
    const g = gruppeVon(ids[0]);
    if (g >= 0) folgeSetzen(g, ids);
    h.neu();
  };
  nav.addEventListener('pointerup', () => loslassen(false));
  nav.addEventListener('pointercancel', () => loslassen(true));
  nav.addEventListener('lostpointercapture', () => { if (zug) loslassen(true); });
  nav.addEventListener('click', (e) => { if (nachklick) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Beim Ziehen soll der Browser keinen Text markieren.
  nav.addEventListener('selectstart', (e) => { if (zug || warten) e.preventDefault(); });
}
