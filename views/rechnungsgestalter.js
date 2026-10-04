/**
 * Kontovia – Rechnungen gestalten (Reiter „Gestaltung“).
 *
 * Rechts die erste Seite als Vorschau. Alles, was zu einem Teil der Rechnung
 * gehört, ändern Sie direkt dort: Anklicken öffnet ein kleines Fenster am
 * Teil (Farbe, Größe, Tabellenstil, Spalten, Texte …), Ziehen verschiebt,
 * Rechtsklick zeigt weitere Möglichkeiten. Am Telefon: antippen, dann
 * ziehen; das Fenster liegt dann am unteren Rand.
 *
 * Links stehen nur die Dinge, die für die ganze Rechnung gelten: Stil,
 * Farbe, Schrift, Logo und Briefpapier und Ihre Angaben (Bank, Register,
 * Vorgaben für neue Rechnungen).
 *
 * Geändert wird ein Entwurf; erst „Übernehmen“ schreibt in die Einstellungen.
 * Ausgestellte Rechnungen behalten ihre Gestaltung (lib/rechnungsaktionen.js).
 * Gezeichnet wird mit derselben Engine wie das PDF (lib/rechnungsdruck.js).
 * Die Engine sorgt dafür, dass keine Gestaltung eine Pflichtangabe verdecken
 * oder unlesbar machen kann; der Gestalter zeigt die Seite so, wie sie
 * gedruckt wird (Teile, die sich überlappen würden, rücken zur Seite).
 */

import { esc, $, $$, uid, clamp } from '../lib/util.js';
import { icon, confirmDialog, ok, err } from '../lib/ui.js';
import { store, sel, commit, saveNow } from '../lib/store.js';
import { router, navigate } from '../lib/router.js';
import {
  LAENDER, neueRechnung, neuePosition, verkaeuferAus, designVoll, design as designAus, profil as profilAus, PROFIL_VORGABE,
  FLUSS_BAUSTEINE, ELEMENT_VORGABE, PLATZHALTER, ibanGueltig,
} from '../lib/rechnung.js';
import { vorschauDaten, bildAblegen, bildWaehlen, bildHolen } from '../lib/rechnungsdateien.js';
import { pixelProMm } from '../lib/rechnungsdruck.js';
import { textDirektBearbeiten, bilderAusZwischenablage } from '../lib/textbearbeiten.js';

const PT = 72 / 25.4; // Punkt je mm
const SEITE = { b: 595.28, h: 841.89 };
const FARBEN = [['#3446e0', 'Blau'], ['#0f766e', 'Petrol'], ['#b45309', 'Bernstein'], ['#be123c', 'Rot'], ['#7c3aed', 'Violett'], ['#1f2937', 'Anthrazit'], ['#0369a1', 'Hellblau'], ['#4d7c0f', 'Grün']];
const SCHRIFTFARBEN = [['#14181d', 'Schwarz'], ['#1f2937', 'Anthrazit'], ['#0f172a', 'Nachtblau'], ['#374151', 'Dunkelgrau']];
const ELEMENTFARBEN = [['#14181d', 'Schwarz'], ['#5b6270', 'Grau'], ['#ffffff', 'Weiß'], ...FARBEN.slice(0, 5)];
const NAMEN = {
  kopf: 'Kopf', anschrift: 'Anschrift', info: 'Rechnungsangaben', inhalt: 'Titel', tabelle: 'Tabelle und Summen', kopftext: 'Text oben',
  hinweise: 'Zahlung und Hinweise', schlusstext: 'Text unten', bilder: 'Bilder der Rechnung', bild: 'Zusatzbild', fuss: 'Fußzeile',
};
const ELEMENT_NAMEN = { text: 'Text', bild: 'Bild', flaeche: 'Fläche', linie: 'Linie' };
const SPALTEN = { nr: 'Pos.', name: 'Bezeichnung', menge: 'Menge', einheit: 'Einheit', preis: 'Einzelpreis', satz: 'USt', netto: 'Gesamt netto' };
const RAENDER = { schmal: [18, 14], normal: [25, 20], breit: [32, 26] };
const SCHRIFTEN = [[8.5, 'Klein'], [9.5, 'Normal'], [10.5, 'Groß']];
const TEXTGROESSEN = [8, 9, 10, 12, 14, 18, 24, 36];

const mm = (pt) => Math.round((pt / PT) * 2) / 2;
const halb = (x) => Math.round(Number(x) * 2) / 2;
const farbeOk = (f) => /^#[0-9a-f]{6}$/i.test(String(f || ''));

/** Eine Musterrechnung für die Vorschau, wenn es noch keine echte gibt. */
function musterRechnung() {
  const s = store.db.settings;
  const letzte = [...sel.invoices()].filter((r) => r.richtung !== 'eingang').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if (letzte) return { ...structuredClone(letzte), status: 'entwurf' };
  const r = neueRechnung(s, {
    nummer: `${new Date().getFullYear()}-0001`,
    betreff: 'Beispiel für Ihre Rechnung',
    kaeufer: { kontaktId: '', name: 'Muster GmbH', zusatz: 'z. Hd. Frau Beispiel', strasse: 'Hauptstraße 1', plz: '12345', ort: 'Musterstadt', land: 'DE', ustId: '', email: '', leitwegId: '', kundennummer: 'K-1001' },
  });
  r.positionen = [
    neuePosition(s, { name: 'Beratung', beschreibung: 'Erstgespräch und Konzept', menge: 3, einheit: 'HUR', preis: 9500 }),
    neuePosition(s, { name: 'Umsetzung', menge: 1, einheit: 'LS', preis: 120000 }),
  ];
  return r;
}

const seg = (feld, paare, wert, attr = 'data-seg', num = false) => `<div class="seg sm" role="group" ${attr}="${esc(feld)}" ${num ? 'data-num' : ''}>${paare.map(([k, t]) => `<button type="button" data-wert="${esc(k)}" class="${String(wert) === String(k) ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>`;
const haken = (feld, wert, text, hint = '') => `<label class="check"><input type="checkbox" data-d="${esc(feld)}" ${wert ? 'checked' : ''}> <span>${text}${hint ? ` <span class="muted">${hint}</span>` : ''}</span></label>`;

/** Farbfelder zum Anklicken; fz = „d:akzent“ (Gestaltung) oder „e:farbe“ (gewähltes Element). */
function farbwahl(fz, aktuell, liste, { ohne = false } = {}) {
  const a = String(aktuell || '').toLowerCase();
  const vorgabe = liste.some(([f]) => f.toLowerCase() === a);
  return `<div class="re-farben" role="group" aria-label="Farbe">
    ${ohne ? `<button type="button" class="re-farbe ohne ${!a ? 'active' : ''}" data-fz="${fz}" data-wert="" title="Keine" aria-label="Keine Farbe"></button>` : ''}
    ${liste.map(([f, n]) => `<button type="button" class="re-farbe ${f.toLowerCase() === a ? 'active' : ''}" data-fz="${fz}" data-wert="${f}" style="background:${f}" title="${esc(n)}" aria-label="${esc(n)}"></button>`).join('')}
    <label class="re-farbe-eigen ${a && !vorgabe ? 'active' : ''}" title="Eigene Farbe wählen"><input type="color" data-fz="${fz}" value="${farbeOk(aktuell) ? esc(aktuell) : '#3446e0'}" aria-label="Eigene Farbe wählen"></label>
  </div>`;
}

/** Kleine Skizzen für die Kacheln „Stil“ und „Tabelle“. */
const STIL_BILD = {
  klassisch: '<rect x="30" y="5" width="14" height="6" rx="1" class="k"/><rect x="5" y="20" width="18" height="8" rx="1" class="g"/><rect x="30" y="20" width="14" height="8" rx="1" class="g"/><rect x="5" y="36" width="40" height="3" class="k"/><rect x="5" y="42" width="40" height="2" class="g"/><rect x="5" y="47" width="40" height="2" class="g"/>',
  modern: '<rect x="0" y="0" width="50" height="4" class="k"/><rect x="5" y="9" width="12" height="5" rx="1" class="g"/><rect x="5" y="22" width="22" height="4" class="k"/><rect x="5" y="32" width="40" height="3" class="k"/><rect x="5" y="38" width="40" height="2" class="g"/><rect x="5" y="43" width="40" height="2" class="g"/>',
  schlicht: '<rect x="5" y="6" width="14" height="3" class="g"/><rect x="5" y="20" width="18" height="6" rx="1" class="g"/><rect x="5" y="34" width="40" height="1" class="d"/><rect x="5" y="40" width="40" height="1" class="g"/><rect x="5" y="46" width="40" height="1" class="g"/>',
  flaeche: '<rect x="2" y="3" width="60" height="9" rx="1.5" class="k"/><rect x="2" y="17" width="60" height="1.2" class="g"/><rect x="2" y="26" width="60" height="1.2" class="g"/><rect x="2" y="35" width="60" height="1.2" class="g"/>',
  linien: '<rect x="2" y="6" width="22" height="3" class="g"/><rect x="2" y="12" width="60" height="1.8" class="d"/><rect x="2" y="22" width="60" height="1" class="g"/><rect x="2" y="31" width="60" height="1" class="g"/><rect x="2" y="40" width="60" height="1" class="g"/>',
  streifen: '<rect x="2" y="3" width="60" height="9" rx="1.5" class="k"/><rect x="2" y="21" width="60" height="9" class="z"/><rect x="2" y="39" width="60" height="9" class="z"/>',
  raster: '<rect x="2" y="3" width="60" height="42" fill="none" class="r"/><rect x="2" y="14" width="60" height="1" class="r2"/><rect x="2" y="25" width="60" height="1" class="r2"/><rect x="2" y="35" width="60" height="1" class="r2"/><rect x="26" y="3" width="1" height="42" class="r2"/><rect x="44" y="3" width="1" height="42" class="r2"/>',
};
const kachel = (art, wert, text, aktiv) => `<button type="button" class="re-kachel ${art} ${aktiv ? 'active' : ''}" data-wert="${esc(wert)}" aria-pressed="${aktiv ? 'true' : 'false'}">
  <svg viewBox="0 0 ${art === 'stil' ? '50 56' : '64 52'}" aria-hidden="true">${STIL_BILD[wert]}</svg><span>${esc(text)}</span></button>`;

export async function gestaltungZeigen(root, params = {}) {
  const s = store.db.settings;
  const v = verkaeuferAus(s);
  const entwurf = { design: structuredClone(designAus(s)), profil: { ...profilAus(s) } };
  const D = () => entwurf.design;
  let gespeichert = JSON.stringify(entwurf);
  const muster = musterRechnung();
  let auswahl = null; // Schlüssel eines Teils, „el:<id>“ oder „seite“
  let ort = null; // wo auf der Seite geklickt wurde (mm), für „Hier einfügen“
  let bereiche = [];
  let zieht = false;
  let spur = null; // beim Ziehen: wohin der Zeiger den Teil gezogen hat (pt), auch wenn er dort nicht stehen darf
  const fehlt = [!v.name && 'Firmenname', !(v.strasse && v.plz && v.ort) && 'Anschrift', !(v.ustId || v.steuernummer) && 'Steuernummer oder USt-IdNr.'].filter(Boolean);

  router.leaveGuard = async () => {
    schliesseMenue();
    if (JSON.stringify(entwurf) === gespeichert) return true;
    return confirmDialog({ title: 'Änderungen verwerfen?', text: 'Die Gestaltung ist noch nicht übernommen.', confirmLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten', danger: true });
  };

  /* ------------------------------------------------------------------------ */
  /* Gerüst                                                                   */
  /* ------------------------------------------------------------------------ */

  root.innerHTML = `
    <div class="re-editor re-gestaltung">
      <div class="re-form">
        <section class="card" id="gsAussehen"></section>
        <section class="card" id="gsBilder"></section>
        <section class="card" id="gsAngaben"></section>
        <section class="card" id="gsVorgaben"></section>
        <div class="row end wrap" style="gap:8px">
          <button class="btn ghost" id="gsZuruecksetzen">${icon('refresh', 15).__raw} Freie Gestaltung zurücksetzen</button>
          <button class="btn primary" id="gsSpeichern">${icon('save', 15).__raw} Übernehmen</button>
        </div>
      </div>
      <aside class="re-seitenspalte re-gestalter">
        <div class="re-werkzeuge card">
          <div class="re-werkzeuge-zeile">
            <span class="small muted">Hinzufügen</span>
            <button type="button" class="btn sm" data-neu="text">${icon('type', 14).__raw} Text</button>
            <button type="button" class="btn sm" data-neu="bild">${icon('image', 14).__raw} Bild</button>
            <button type="button" class="btn sm" data-neu="flaeche">${icon('square', 14).__raw} Fläche</button>
            <button type="button" class="btn sm" data-neu="linie">${icon('minus', 14).__raw} Linie</button>
            <span class="spacer"></span>
            <button type="button" class="btn sm" id="gsSeite">${icon('layout', 14).__raw} Seite</button>
            <span class="re-undo">
              <button type="button" class="icon-btn" id="gsZurueck" title="Rückgängig (Strg+Z)" aria-label="Rückgängig">${icon('undo', 16).__raw}</button>
              <button type="button" class="icon-btn" id="gsVor" title="Wiederholen (Strg+Y)" aria-label="Wiederholen">${icon('redo', 16).__raw}</button>
            </span>
          </div>
          <p class="small muted mb0 re-tipp">${icon('move', 14).__raw}<span>Klicken Sie auf einen Teil der Rechnung, um ihn zu ändern, und ziehen Sie ihn an eine andere Stelle. Ein Rechtsklick (am Telefon: länger drücken) zeigt weitere Möglichkeiten. Tabelle und Texte ordnen Sie durch Ziehen nach oben oder unten.</span></p>
        </div>
        <div class="re-vorschau" id="reVorschau">
          <div class="re-blattwrap" id="gsWrap">
            <div class="re-blatt re-gestalter-blatt" id="gsBlatt"><div id="gsSvg"></div><div class="re-ziele" id="gsZiele"></div></div>
            <div class="re-pop" id="gsPop" role="dialog" aria-label="Einstellungen" hidden></div>
          </div>
          <div id="gsWeitere" class="re-vorschau"></div>
          <p class="small muted re-garantie">${icon('shield', 14).__raw}<span>Pflichtangaben und die Daten der E-Rechnung bleiben immer erhalten, egal wie Sie gestalten. Teile, die sich überlappen würden, rücken von selbst zur Seite.</span></p>
        </div>
      </aside>
    </div>`;

  /* ------------------------------------------------------------------------ */
  /* Verlauf (Rückgängig)                                                     */
  /* ------------------------------------------------------------------------ */

  const verlauf = [JSON.stringify(D())];
  let zeiger = 0;
  let merkZeit = null;
  /** Merkt den Stand; schnelle Folgen (Tippen, Ziehen) zählen als ein Schritt. */
  function merken() {
    clearTimeout(merkZeit);
    merkZeit = setTimeout(() => {
      const jetzt = JSON.stringify(D());
      if (jetzt === verlauf[zeiger]) return;
      verlauf.splice(zeiger + 1);
      verlauf.push(jetzt);
      if (verlauf.length > 80) verlauf.shift();
      zeiger = verlauf.length - 1;
      verlaufKnoepfe();
    }, 350);
  }
  function verlaufKnoepfe() {
    $('#gsZurueck', root).disabled = zeiger <= 0;
    $('#gsVor', root).disabled = zeiger >= verlauf.length - 1;
  }
  function springe(schritt) {
    clearTimeout(merkZeit);
    const jetzt = JSON.stringify(D());
    if (jetzt !== verlauf[zeiger]) { verlauf.splice(zeiger + 1); verlauf.push(jetzt); zeiger = verlauf.length - 1; }
    const ziel = zeiger + schritt;
    if (ziel < 0 || ziel >= verlauf.length) return;
    zeiger = ziel;
    entwurf.design = JSON.parse(verlauf[zeiger]);
    if (auswahl?.startsWith('el:') && !element(auswahl)) auswahl = null;
    allesZeichnen();
    verlaufKnoepfe();
  }
  $('#gsZurueck', root).addEventListener('click', () => springe(-1));
  $('#gsVor', root).addEventListener('click', () => springe(1));
  const tasten = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', tasten); return; }
    if (!(e.ctrlKey || e.metaKey) || e.target.matches('input, textarea, select')) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); springe(-1); }
    else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); springe(1); }
  };
  document.addEventListener('keydown', tasten);

  /** Nach jeder Änderung: Vorschau neu, Stand merken. */
  function geaendert({ panels = false } = {}) {
    merken();
    if (panels) popZeichnen();
    zeichnenBald();
  }

  /* ------------------------------------------------------------------------ */
  /* Linke Spalte                                                             */
  /* ------------------------------------------------------------------------ */

  function aussehenZeichnen() {
    const d = D();
    const naechste = SCHRIFTEN.reduce((a, c) => (Math.abs(c[0] - Number(d.schriftgroesse)) < Math.abs(a[0] - Number(d.schriftgroesse)) ? c : a));
    $('#gsAussehen', root).innerHTML = `
      <div class="card-head"><h3>${icon('layout', 16).__raw} Stil und Farbe</h3><span class="sub">gilt für alle neuen Rechnungen</span></div>
      <div class="card-body">
        <div class="field"><label>Stil</label>
          <div class="re-kacheln" data-seg="layout" role="group" aria-label="Stil">${[['klassisch', 'Klassisch'], ['modern', 'Modern'], ['schlicht', 'Schlicht']].map(([k, t]) => kachel('stil', k, t, d.layout === k)).join('')}</div></div>
        <div class="field"><label>Farbe</label>${farbwahl('d:akzent', d.akzent, FARBEN)}
          <span class="hint">Für Titel, Tabellenkopf und Linien. Eine zu helle Farbe dunkelt Kontovia in der Schrift ab, damit die Rechnung lesbar bleibt.</span></div>
        <div class="field mb0"><label>Schrift</label>
          <div class="row wrap" style="gap:10px 16px">${seg('schriftgroesse', SCHRIFTEN, naechste[0], 'data-seg', true)}
            <span class="row" style="gap:8px"><span class="small muted">Farbe</span>${farbwahl('d:textfarbe', d.textfarbe || '#14181d', SCHRIFTFARBEN)}</span></div></div>
      </div>`;
  }

  async function bilderKarteZeichnen() {
    const d = D();
    const [logo, bild, brief] = await Promise.all([bildHolen(d.logoId), bildHolen(d.bildId), bildHolen(d.briefpapierId)]);
    const feld = (b, alt, leer) => `<div class="re-bildfeld">${b ? `<img src="${esc(b.url)}" alt="${esc(alt)}">` : `<span class="small muted">${leer}</span>`}</div>`;
    const knoepfe = (art, da, neu, anders) => `<div class="row wrap"><button type="button" class="btn sm" data-bild-neu="${art}">${icon('plus', 13).__raw} ${da ? anders : neu}</button>
      ${da ? `<button type="button" class="btn sm ghost" data-bild-weg="${art}">${icon('trash', 13).__raw} Entfernen</button>` : ''}</div>`;
    $('#gsBilder', root).innerHTML = `
      <div class="card-head"><h3>${icon('image', 16).__raw} Logo, Briefpapier und Bild</h3></div>
      <div class="card-body">
        <div class="field"><label>Logo</label>
          <div class="re-bildwahl">${feld(logo, 'Logo', 'kein Logo')}
            <div class="stack">${knoepfe('logoId', logo, 'Logo hochladen', 'Anderes Logo')}
              <span class="hint">${logo ? 'Position und Größe stellen Sie in der Vorschau ein: Logo anklicken.' : 'PNG, JPG oder SVG. Ohne Logo steht Ihr Firmenname im Kopf.'}</span>
            </div></div></div>
        <div class="field"><label>Briefpapier</label>
          <div class="re-bildwahl">${feld(brief, 'Briefpapier', 'keines')}
            <div class="stack">${knoepfe('briefpapierId', brief, 'Briefpapier hochladen', 'Anderes Briefpapier')}
              ${brief ? seg('briefpapierSeiten', [['erste', 'Nur erste Seite'], ['alle', 'Alle Seiten']], d.briefpapierSeiten)
                : '<span class="hint">Ein Bild Ihres Briefbogens im Format A4, etwa als JPG oder PNG. Es liegt hinter der ganzen Rechnung.</span>'}
              ${brief ? '<span class="hint">Steht Ihr Name schon auf dem Briefpapier, blenden Sie in der Vorschau die Fußzeile aus: Fußzeile anklicken.</span>' : ''}
            </div></div></div>
        <div class="field mb0"><label>Zusätzliches Bild</label>
          <div class="re-bildwahl">${feld(bild, 'Zusatzbild', 'kein Bild')}
            <div class="stack">${knoepfe('bildId', bild, 'Bild hochladen', 'Anderes Bild')}
              ${bild ? `<div class="row wrap">${seg('bildPosition', [['schluss', 'Im Text'], ['fuss', 'Über der Fußzeile']], d.bildPosition)}
                <label class="re-regler">Breite <input type="range" min="15" max="120" step="1" data-d="bildBreite" data-num value="${esc(d.bildBreite)}"> <span data-wert-von="bildBreite">${esc(d.bildBreite)} mm</span></label></div>`
                : '<span class="hint">Etwa Ihre Unterschrift oder ein Siegel. Frei platzieren lassen sich Bilder mit „Hinzufügen: Bild“ über der Vorschau.</span>'}
            </div></div></div>
      </div>`;
  }

  function angabenZeichnen() {
    const p = entwurf.profil;
    $('#gsAngaben', root).innerHTML = `
      <div class="card-head"><h3>${icon('building', 16).__raw} Ihre Angaben auf Rechnungen</h3></div>
      <div class="card-body">
        ${fehlt.length ? `<div class="notice warn mb16">In den Einstellungen fehlen noch: ${esc(fehlt.join(', '))}. Diese Angaben müssen auf jeder Rechnung stehen.
          <a href="#" class="check-link" data-zu-einst>Zu den Firmendaten</a></div>`
          : `<div class="notice mb16">Name, Anschrift und Steuernummer kommen aus den Einstellungen: <strong>${esc(v.name)}</strong>, ${esc([v.strasse, `${v.plz} ${v.ort}`].join(', '))}.
          <a href="#" class="check-link" data-zu-einst>Firmendaten ändern</a></div>`}
        <div class="form-grid">
          <div class="field full"><label for="gp_iban">IBAN</label><input id="gp_iban" data-p="iban" value="${esc(p.iban)}" placeholder="DE00 0000 0000 0000 0000 00" autocomplete="off"><span class="hint" id="gp_ibanHinweis"></span></div>
          <div class="field"><label for="gp_bic">BIC</label><input id="gp_bic" data-p="bic" value="${esc(p.bic)}"></div>
          <div class="field"><label for="gp_bank">Bank</label><input id="gp_bank" data-p="bank" value="${esc(p.bank)}"></div>
          <div class="field"><label for="gp_inhaber">Kontoinhaber</label><input id="gp_inhaber" data-p="kontoinhaber" value="${esc(p.kontoinhaber)}" placeholder="${esc(v.name || '')}"></div>
          <div class="field"><label for="gp_land">Land Ihres Betriebs</label><select id="gp_land" data-p="land">
            ${Object.entries(LAENDER).map(([c, l]) => `<option value="${c}" ${c === p.land ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="gp_register">Handelsregister</label><input id="gp_register" data-p="register" value="${esc(p.register)}" placeholder="z. B. Amtsgericht München HRB 12345"></div>
          <div class="field"><label for="gp_gf">Geschäftsführung</label><input id="gp_gf" data-p="geschaeftsfuehrung" value="${esc(p.geschaeftsfuehrung)}" placeholder="bei GmbH und UG Pflicht"></div>
          <div class="field full"><label for="gp_web">Website</label><input id="gp_web" data-p="web" value="${esc(p.web)}"></div>
        </div>
      </div>`;
    $('#gsVorgaben', root).innerHTML = `
      <div class="card-head"><h3>${icon('settings', 16).__raw} Voreinstellungen für neue Rechnungen</h3></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label for="gp_praefix">Vor der Nummer</label><input id="gp_praefix" data-p="praefix" value="${esc(p.praefix)}" placeholder="z. B. RE-"><span class="hint" id="gp_nummerBeispiel"></span></div>
          <div class="field"><label for="gp_ziel">Zahlungsziel in Tagen</label><input id="gp_ziel" data-p="zahlungszielTage" type="number" min="0" max="365" value="${esc(p.zahlungszielTage)}"></div>
          <div class="field full"><label for="gp_kopf">Text vor den Positionen</label><textarea id="gp_kopf" data-p="kopftext" rows="3">${esc(p.kopftext)}</textarea></div>
          <div class="field full mb0"><label for="gp_schluss">Text am Ende</label><textarea id="gp_schluss" data-p="schlusstext" rows="3">${esc(p.schlusstext)}</textarea></div>
        </div>
      </div>`;
    profilHinweise();
  }

  function profilHinweise() {
    const iban = String(entwurf.profil.iban || '').replace(/\s/g, '');
    const h = $('#gp_ibanHinweis', root);
    if (h) h.textContent = iban && !ibanGueltig(iban) ? 'Diese IBAN ist ungültig. Bitte auf Zahlendreher prüfen.' : '';
    const nr = $('#gp_nummerBeispiel', root);
    if (nr) nr.textContent = `Erste Nummer: ${entwurf.profil.praefix || ''}${new Date().getFullYear()}-0001`;
  }

  /* ------------------------------------------------------------------------ */
  /* Auswahl und das Fenster am Teil                                          */
  /* ------------------------------------------------------------------------ */

  const element = (key) => (String(key || '').startsWith('el:') ? D().elemente.find((e) => e.id === key.slice(3)) : null);
  const bereich = (key) => bereiche.find((b) => b.key === key);
  const istFluss = (key) => bereich(key)?.art === 'fluss';
  const anzeigeName = (key) => {
    const e = element(key);
    if (e) return ELEMENT_NAMEN[e.art];
    if (key === 'kopf') return bereich('kopf')?.logo ? 'Logo' : 'Firmenname';
    if (key === 'seite') return 'Seite';
    return NAMEN[key] || '';
  };

  const stilWirksam = () => (D().tabellenstil !== 'auto' ? D().tabellenstil : (D().layout === 'schlicht' ? 'linien' : 'flaeche'));
  const zahl = (attr, wert, label, { min = -20, max = 300, step = 0.5 } = {}) => `<label class="re-mini"><span>${label}</span><input type="number" ${attr} value="${esc(wert)}" min="${min}" max="${max}" step="${step}"></label>`;
  const feld = (label, inhalt) => `<div class="re-pop-feld"><span class="re-pop-label">${label}</span>${inhalt}</div>`;
  const kopfHtml = (titel, hilfe = '') => `<div class="re-pop-kopf"><strong>${esc(titel)}</strong><span class="spacer"></span>
    <button type="button" class="icon-btn" data-aw="zu" title="Schließen (Esc)" aria-label="Schließen">${icon('x', 15).__raw}</button></div>${hilfe ? `<p class="small muted re-pop-hilfe">${hilfe}</p>` : ''}`;
  const reihenKnoepfe = (key) => {
    const i = D().reihenfolge.indexOf(key);
    return feld('Reihenfolge', `<div class="row" style="gap:6px">
      <button type="button" class="btn sm" data-rf="${key}" data-rf-dir="-1" ${i <= 0 ? 'disabled' : ''}>${icon('up', 13).__raw} Nach oben</button>
      <button type="button" class="btn sm" data-rf="${key}" data-rf-dir="1" ${i < 0 || i >= D().reihenfolge.length - 1 ? 'disabled' : ''}>${icon('down', 13).__raw} Nach unten</button></div>`);
  };
  const genauePosition = (inhalt) => `<details class="re-check-mehr re-pop-mehr"><summary>Genaue Maße</summary><div class="re-pop-felder">${inhalt}</div></details>`;
  const zurueck = (key) => (D().positionen?.[key] ? `<button type="button" class="btn sm ghost" data-aw="standard">${icon('refresh', 13).__raw} Zurück an die Standardstelle</button>` : '');

  function popHtml() {
    const d = D();
    const e = element(auswahl);
    const b = bereich(auswahl);
    if (auswahl === 'seite') return seitePop();
    if (e) return elementPop(e, b);
    if (!b) return '';
    const x = mm(b.anker?.x ?? b.x);
    const y = mm(b.anker?.y ?? b.y);
    const pos = (inhaltY) => genauePosition(inhaltY ? zahl('data-pos="y"', y, 'Oben (mm)') : `${zahl('data-pos="x"', x, 'Links (mm)')}${zahl('data-pos="y"', y, 'Oben (mm)')}`);
    switch (auswahl) {
      case 'kopf':
        return `${kopfHtml(anzeigeName('kopf'), b.logo ? 'Ziehen Sie das Logo an eine andere Stelle oder am Eck größer und kleiner.' : 'Ohne Logo steht Ihr Firmenname im Kopf.')}
          ${feld('Position', seg('logoPosition', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], d.logoPosition))}
          ${b.logo ? feld('Breite', `<label class="re-regler"><input type="range" min="15" max="80" step="1" data-d="logoBreite" data-num value="${esc(d.logoBreite)}"> <span data-wert-von="logoBreite">${esc(d.logoBreite)} mm</span></label>`)
            : haken('firmenkopf', d.firmenkopf, 'Firmenname im Kopf zeigen')}
          <div class="row wrap" style="gap:6px"><button type="button" class="btn sm" data-bild-neu="logoId">${icon('plus', 13).__raw} ${d.logoId ? 'Anderes Logo' : 'Logo hochladen'}</button>
            ${d.logoId ? `<button type="button" class="btn sm ghost" data-bild-weg="logoId">${icon('trash', 13).__raw} Entfernen</button>` : ''}${zurueck('kopf')}</div>${pos()}`;
      case 'anschrift':
        return `${kopfHtml('Anschrift', 'Am Standardplatz sitzt sie im Fenster eines Briefumschlags. Anderswo passt sie nicht mehr ins Fenster.')}
          ${haken('absenderzeile', d.absenderzeile, 'Absender in kleiner Schrift darüber')}
          <div class="row wrap" style="gap:6px">${zurueck('anschrift')}</div>${pos()}`;
      case 'info':
        return `${kopfHtml('Rechnungsangaben', 'Nummer, Datum, Leistungszeitraum und weitere Angaben. Sie stehen immer auf der Rechnung.')}
          <div class="row wrap" style="gap:6px">${zurueck('info')}</div>${pos()}`;
      case 'inhalt':
        return `${kopfHtml('Titel', 'Ziehen Sie den Titel nach oben oder unten, um zu bestimmen, wo der Inhalt beginnt.')}
          ${feld('Größe des Titels', `<select data-d="titelGroesse" data-num>${[[0, 'Nach Stil'], [12, 'Klein'], [15, 'Normal'], [19, 'Groß'], [24, 'Sehr groß']].map(([g, t]) => `<option value="${g}" ${Number(d.titelGroesse) === g ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
          <div class="row wrap" style="gap:6px">${zurueck('inhalt')}</div>${pos(true)}`;
      case 'tabelle': {
        const stil = stilWirksam();
        const spalte = (k, optional, hint = '') => `<div class="re-spalte"><label class="check" ${optional ? '' : 'title="Diese Spalte gehört immer dazu"'}>
            <input type="checkbox" ${optional ? `data-d="${k === 'nr' ? 'spalteNr' : k === 'einheit' ? 'spalteEinheit' : 'spalteSatz'}"` : 'checked disabled'} ${optional && (k === 'nr' ? d.spalteNr : k === 'einheit' ? d.spalteEinheit : d.spalteSatz) !== false ? 'checked' : ''}>
            <span class="sr-only">${esc(SPALTEN[k])} anzeigen</span></label>
          <input data-st="${k}" maxlength="24" value="${esc(d.spaltenTitel?.[k] || '')}" placeholder="${esc(SPALTEN[k])}" aria-label="Überschrift ${esc(SPALTEN[k])}">${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;
        return `${kopfHtml('Tabelle und Summen', 'Ziehen Sie die Tabelle nach oben oder unten, um die Reihenfolge zu ändern.')}
          ${feld('Stil der Tabelle', `<div class="re-kacheln klein" data-seg="tabellenstil" role="group" aria-label="Stil der Tabelle">${[['flaeche', 'Farbfläche'], ['linien', 'Linien'], ['streifen', 'Streifen'], ['raster', 'Raster']].map(([k, t]) => kachel('tabelle', k, t, stil === k)).join('')}</div>`)}
          ${stil === 'flaeche' || stil === 'streifen' ? haken('tabellenkopfFarbig', d.tabellenkopfFarbig, 'Kopfzeile in der Farbe') : ''}
          <details class="re-check-mehr re-pop-mehr"><summary>Spalten und Überschriften</summary>
            <div class="re-spalten mt8">${spalte('nr', true)}${spalte('name', false)}${spalte('menge', false)}${spalte('einheit', true, 'sonst bei der Menge')}${spalte('preis', false)}${spalte('satz', true, 'bei mehreren Sätzen immer')}${spalte('netto', false)}</div>
            <span class="hint">Haken: Spalte zeigen. Feld daneben: eigene Überschrift.</span></details>
          ${reihenKnoepfe('tabelle')}`;
      }
      case 'kopftext':
      case 'schlusstext': {
        const k = auswahl;
        return `${kopfHtml(NAMEN[k], 'Das ist die Vorgabe für neue Rechnungen. Jede Rechnung können Sie einzeln ändern.')}
          <textarea data-p="${k}" rows="5" aria-label="${esc(NAMEN[k])}">${esc(entwurf.profil[k])}</textarea>${reihenKnoepfe(k)}`;
      }
      case 'hinweise':
        return `${kopfHtml('Zahlung und Hinweise', 'Bankverbindung, Zahlungsziel und Steuerhinweise stehen immer auf der Rechnung.')}
          ${haken('girocode', d.girocode, 'GiroCode zum Bezahlen mit der Banking-App', 'Erscheint bei Überweisung, wenn eine gültige IBAN eingetragen ist.')}${reihenKnoepfe('hinweise')}`;
      case 'bilder':
        return `${kopfHtml('Bilder der Rechnung', 'Diese Bilder wählen Sie in der Rechnung selbst, etwa Fotos Ihrer Arbeit.')}${reihenKnoepfe('bilder')}`;
      case 'bild':
        return `${kopfHtml('Zusatzbild')}${seg('bildPosition', [['schluss', 'Im Text'], ['fuss', 'Über der Fußzeile']], d.bildPosition)}
          ${feld('Breite', `<label class="re-regler"><input type="range" min="15" max="120" step="1" data-d="bildBreite" data-num value="${esc(d.bildBreite)}"> <span data-wert-von="bildBreite">${esc(d.bildBreite)} mm</span></label>`)}
          <div class="row wrap" style="gap:6px"><button type="button" class="btn sm" data-bild-neu="bildId">${icon('plus', 13).__raw} Anderes Bild</button>
            <button type="button" class="btn sm ghost" data-bild-weg="bildId">${icon('trash', 13).__raw} Entfernen</button></div>${reihenKnoepfe('bild')}`;
      case 'fuss':
        return `${kopfHtml('Fußzeile', 'Kontakt, Bank und Steuernummer. Ohne Fußzeile setzt Kontovia Steuernummer, Anschrift und Registerangaben an eine andere Stelle, weil sie auf jeder Rechnung stehen müssen.')}
          ${haken('fusszeile', d.fusszeile, 'Fußzeile anzeigen')}`;
      default:
        return '';
    }
  }

  function seitePop() {
    const d = D();
    const rand = Object.entries(RAENDER).reduce((a, c) => (Math.abs(c[1][0] - Number(d.randLinks)) < Math.abs(RAENDER[a][0] - Number(d.randLinks)) ? c[0] : a), 'normal');
    return `${kopfHtml('Seite', 'Einstellungen für die ganze Seite.')}
      ${feld('Seitenränder', `<div class="seg sm" role="group" data-rand>${[['schmal', 'Schmal'], ['normal', 'Normal'], ['breit', 'Breit']].map(([k, t]) => `<button type="button" data-wert="${k}" class="${rand === k ? 'active' : ''}">${t}</button>`).join('')}</div>`)}
      ${haken('falzmarken', d.falzmarken, 'Falzmarken für den Fensterumschlag')}
      ${haken('hinweisERechnung', d.hinweisERechnung, 'Hinweis auf die enthaltene E-Rechnung')}
      ${feld('Briefpapier', `<div class="row wrap" style="gap:6px"><button type="button" class="btn sm" data-bild-neu="briefpapierId">${icon('plus', 13).__raw} ${d.briefpapierId ? 'Anderes Briefpapier' : 'Briefpapier hochladen'}</button>
        ${d.briefpapierId ? `<button type="button" class="btn sm ghost" data-bild-weg="briefpapierId">${icon('trash', 13).__raw} Entfernen</button>` : ''}</div>
        ${d.briefpapierId ? seg('briefpapierSeiten', [['erste', 'Nur erste Seite'], ['alle', 'Alle Seiten']], d.briefpapierSeiten) : ''}`)}
      ${ort ? feld('Hier einfügen', `<div class="row wrap" style="gap:6px">${[['text', 'type', 'Text'], ['bild', 'image', 'Bild'], ['flaeche', 'square', 'Fläche'], ['linie', 'minus', 'Linie']].map(([a, ic, t]) => `<button type="button" class="btn sm" data-neu-hier="${a}">${icon(ic, 13).__raw} ${t}</button>`).join('')}</div>`) : ''}`;
  }

  function elementPop(e, b) {
    const d = D();
    const farbfeld = (label, fzFeld, wert, { ohne = false, liste = ELEMENTFARBEN } = {}) => feld(label, farbwahl(`e:${fzFeld}`, wert, liste, { ohne }));
    let inhalt = '';
    if (e.art === 'text') {
      const gr = [...new Set([...TEXTGROESSEN, Math.round(Number(e.groesse) || 10)])].sort((p, q) => p - q);
      inhalt = `<textarea data-e="text" rows="3" aria-label="Text">${esc(e.text || '')}</textarea>
        <div class="re-platzhalter small"><span class="muted">Einfügen:</span> ${Object.entries(PLATZHALTER).map(([k, t]) => `<button type="button" class="re-chip" data-platzhalter="${k}">${esc(t)}</button>`).join('')}</div>
        <div class="row wrap" style="gap:8px">
          <label class="re-mini"><span>Größe</span><select data-e="groesse" data-num>${gr.map((g) => `<option value="${g}" ${Math.round(Number(e.groesse)) === g ? 'selected' : ''}>${g} pt</option>`).join('')}</select></label>
          ${seg('ausrichtung', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], e.ausrichtung || 'links', 'data-eseg')}
          <label class="check small"><input type="checkbox" data-e="fett" ${e.fett ? 'checked' : ''}> fett</label></div>
        ${farbfeld('Farbe', 'farbe', e.farbe)}`;
    } else if (e.art === 'bild') {
      inhalt = `${feld('Breite', `<label class="re-regler"><input type="range" min="10" max="210" step="1" data-e="b" data-num value="${esc(halb(e.b))}"> <span data-wert-von-e="b">${esc(halb(e.b))} mm</span></label>`)}
        <div class="row"><button type="button" class="btn sm" data-aw="bild">${icon('image', 13).__raw} ${e.bildId ? 'Anderes Bild' : 'Bild wählen'}</button></div>`;
    } else if (e.art === 'flaeche') {
      inhalt = `${farbfeld('Füllung', 'fuellung', e.fuellung, { ohne: true })}${farbfeld('Rand', 'rand', e.rand, { ohne: true })}
        <p class="small muted mb0">Unter Text hellt Kontovia die Fläche bei Bedarf auf, damit der Text lesbar bleibt.</p>`;
    } else if (e.art === 'linie') {
      inhalt = `${feld('Richtung', seg('richtung', [['waagerecht', 'Waagerecht'], ['senkrecht', 'Senkrecht']], e.richtung || 'waagerecht', 'data-eseg'))}
        ${feld('Stärke', `<select data-e="staerke" data-num>${[[0.4, 'Dünn'], [0.8, 'Normal'], [1.6, 'Dick'], [3, 'Sehr dick']].map(([w, t]) => `<option value="${w}" ${Math.abs(Number(e.staerke) - w) < 0.3 ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
        ${farbfeld('Farbe', 'farbe', e.farbe)}`;
    }
    const maße = `${zahl('data-e="x"', halb(e.x), 'Links (mm)')}${zahl('data-e="y"', halb(e.y), 'Oben (mm)')}${e.art !== 'bild' ? zahl('data-e="b"', halb(e.b), e.art === 'linie' ? 'Länge (mm)' : 'Breite (mm)', { min: 0.5, max: 297 }) : ''}${e.art === 'flaeche' ? zahl('data-e="h"', halb(e.h), 'Höhe (mm)', { min: 0.5, max: 297 }) : ''}`;
    return `${kopfHtml(ELEMENT_NAMEN[e.art], b?.keinPlatz ? '' : 'Ziehen verschiebt, das Eck ändert die Größe. Eigene Elemente liegen immer hinter dem Inhalt der Rechnung.')}
      ${b?.keinPlatz ? '<div class="notice warn small">Hier ist kein Platz: Das Element würde Inhalt der Rechnung berühren und wird deshalb nicht gedruckt. Ziehen Sie es an eine freie Stelle.</div>' : ''}
      ${inhalt}
      ${feld('Auf welchen Seiten', seg('seiten', [['erste', 'Nur erste Seite'], ['alle', 'Alle Seiten']], e.seiten === 'alle' ? 'alle' : 'erste', 'data-eseg'))}
      ${genauePosition(maße)}
      <div class="row wrap" style="gap:6px"><button type="button" class="btn sm ghost" data-aw="kopie">${icon('copy', 13).__raw} Duplizieren</button>
        <button type="button" class="btn sm ghost danger-text" data-aw="weg">${icon('trash', 13).__raw} Entfernen</button></div>`;
  }

  /** Zeichnet das Fenster am gewählten Teil neu. */
  function popZeichnen() {
    const pop = $('#gsPop', root);
    if (auswahl && auswahl !== 'seite' && !bereich(auswahl) && !element(auswahl)) auswahl = null;
    const html = auswahl ? popHtml() : '';
    if (!html) { pop.hidden = true; pop.innerHTML = ''; return; }
    pop.innerHTML = html;
    pop.hidden = false;
    popPlatzieren();
  }

  /** Das Fenster liegt unter dem gewählten Teil, sonst darüber; am Telefon als Blatt am unteren Rand. */
  function popPlatzieren() {
    const pop = $('#gsPop', root);
    if (pop.hidden) return;
    const klein = window.matchMedia('(max-width: 1080px)').matches;
    pop.classList.toggle('blatt', klein);
    if (klein) { pop.style.left = ''; pop.style.top = ''; return; }
    const wrap = $('#gsWrap', root);
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const b = bereich(auswahl);
    const px = (SEITE.b ? W / SEITE.b : 1);
    const r = b ? { l: b.x * px, t: b.y * px, r: (b.x + b.b) * px, u: (b.y + b.h) * px } : ort ? { l: ort.x * PT * px, t: ort.y * PT * px, r: ort.x * PT * px, u: ort.y * PT * px } : { l: 0, t: 0, r: W, u: 0 };
    pop.style.width = `${Math.min(330, W - 8)}px`;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    // Kandidaten: unter dem Teil, über dem Teil, ganz oben, ganz unten. Genommen wird der erste, der ihn nicht verdeckt und auf die Seite passt.
    const kandidaten = [r.u + 10, r.t - ph - 10, 4, H - ph - 4];
    const verdeckt = (top) => Math.max(0, Math.min(top + ph, r.u) - Math.max(top, r.t));
    let top = kandidaten.find((k) => k >= 0 && k + ph <= H + 6 && verdeckt(k) === 0);
    if (top === undefined) top = kandidaten.filter((k) => k >= 0 && k + ph <= H + 6).sort((p, q) => verdeckt(p) - verdeckt(q))[0];
    if (top === undefined) top = Math.max(4, Math.min(r.t + 10, H - ph - 4));
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(clamp(r.l, 4, Math.max(4, W - pw - 4)))}px`;
  }

  /** Eingaben im Fenster schreiben die Zahlen zurück, ohne es neu zu zeichnen. */
  function positionSetzen(key, xMm, yMm) {
    const x = clamp(halb(xMm), -20, 210);
    const y = clamp(halb(yMm), -20, 297);
    const e = element(key);
    if (e) { e.x = x; e.y = y; return; }
    D().positionen ||= {};
    D().positionen[key] = key === 'inhalt' ? { y } : { x, y };
  }

  function zahlenAuffrischen() {
    const pop = $('#gsPop', root);
    if (pop.hidden) return;
    const e = element(auswahl);
    const b = bereich(auswahl);
    const setze = (sel2, wert) => { const f = pop.querySelector(sel2); if (f && document.activeElement !== f) f.value = wert; };
    if (e) { setze('[data-e="x"]', halb(e.x)); setze('[data-e="y"]', halb(e.y)); setze('[data-e="b"]', halb(e.b)); setze('[data-e="h"]', halb(e.h)); }
    else if (b?.anker) { setze('[data-pos="x"]', mm(b.anker.x)); setze('[data-pos="y"]', mm(b.anker.y)); }
  }

  /* ------------------------------------------------------------------------ */
  /* Vorschau und Rahmen                                                      */
  /* ------------------------------------------------------------------------ */

  let laeuft = 0;
  async function zeichnen() {
    const nr = ++laeuft;
    const rahmen = { v: verkaeuferAus({ ...s, rechnung: { ...(s.rechnung || {}), profil: entwurf.profil } }), d: designVoll(D()) };
    // Die Texte zeigen die Vorgaben aus den Einstellungen, damit Änderungen sofort sichtbar sind.
    const rechnung = { ...muster, kopftext: entwurf.profil.kopftext, schlusstext: entwurf.profil.schlusstext };
    let daten;
    try { daten = await vorschauDaten(rechnung, rahmen); } catch (ex) {
      $('#gsSvg', root).innerHTML = `<div class="notice small">Die Vorschau ließ sich nicht erstellen: ${esc(ex.message)}</div>`;
      return;
    }
    if (nr !== laeuft || !root.isConnected) return;
    bereiche = daten.bereiche;
    $('#gsSvg', root).innerHTML = daten.svgs[0] || '';
    $('#gsWeitere', root).innerHTML = daten.svgs.slice(1).map((svg, i) => `<div class="re-blatt" title="Seite ${i + 2}">${svg}</div>`).join('');
    zieleZeichnen();
    zahlenAuffrischen();
  }
  let geplant = false;
  function zeichnenBald() {
    if (geplant) return;
    geplant = true;
    // setTimeout statt requestAnimationFrame: läuft auch, wenn das Fenster gerade nicht zeichnet.
    setTimeout(() => { geplant = false; zeichnen(); }, 16);
  }

  function zieleZeichnen() {
    const host = $('#gsZiele', root);
    const da = new Map($$('.re-ziel', host).map((n) => [n.dataset.key, n]));
    for (const b of bereiche) {
      let n = da.get(b.key);
      const e = element(b.key);
      const name = anzeigeName(b.key);
      const groesse = !!e || (b.key === 'kopf' && b.logo);
      if (!n) {
        n = document.createElement('div');
        n.className = 're-ziel';
        n.dataset.key = b.key;
        n.tabIndex = 0;
        n.setAttribute('role', 'button');
        host.append(n);
      }
      n.dataset.art = b.art || 'frei';
      n.setAttribute('aria-label', `${name}: anklicken zum Ändern${b.art === 'fest' ? '' : ', ziehen zum Verschieben'}`);
      const inhalt = `<span class="re-ziel-name">${esc(name)}</span>${groesse ? '<span class="re-griff" data-griff aria-hidden="true"></span>' : ''}`;
      if (n.dataset.inhalt !== inhalt) { n.innerHTML = inhalt; n.dataset.inhalt = inhalt; }
      n.classList.toggle('leer', !!b.leer);
      n.classList.toggle('kein-platz', !!b.keinPlatz);
      n.classList.toggle('aktiv', auswahl === b.key);
      // Beim Ziehen folgt der Rahmen dem Zeiger genau; steht der Teil dort nicht erlaubt, zeigt er das an.
      const folgt = spur && spur.key === b.key;
      const bx = folgt ? spur.x : b.x;
      const by = folgt ? spur.y : b.y;
      n.classList.toggle('weicht', !!folgt && Math.hypot(spur.x - b.x, spur.y - b.y) > 2 * PT);
      Object.assign(n.style, {
        left: `${(bx / SEITE.b) * 100}%`, top: `${(by / SEITE.h) * 100}%`,
        width: `${Math.max(4, b.b) / SEITE.b * 100}%`, height: `${Math.max(4, b.h) / SEITE.h * 100}%`,
      });
      da.delete(b.key);
    }
    for (const n of da.values()) n.remove();
  }

  function waehlen(key, { hier = null, still = false } = {}) {
    auswahl = key;
    ort = hier;
    $$('.re-ziel', root).forEach((n) => n.classList.toggle('aktiv', n.dataset.key === key));
    if (still) { $('#gsPop', root).hidden = true; return; }
    popZeichnen();
    // Am Telefon liegt das Fenster über der unteren Hälfte: der Teil wandert nach oben ins Bild.
    const n = key && key !== 'seite' ? $(`.re-ziel[data-key="${CSS.escape(key)}"]`, root) : null;
    if (n && window.matchMedia('(max-width: 1080px)').matches) {
      const r = n.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.4 || r.top < 70) n.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  /** Stelle auf der Seite (mm) zu einem Mausereignis. */
  function seitenOrt(ev) {
    const r = $('#gsZiele', root).getBoundingClientRect();
    return { x: halb(((ev.clientX - r.left) / r.width) * (SEITE.b / PT)), y: halb(((ev.clientY - r.top) / r.height) * (SEITE.h / PT)) };
  }

  /* Text direkt auf der Vorschau ändern (Doppelklick, F2). Der Wert geht dorthin, wo er hingehört,
     und alle Felder mit demselben Wert (Fenster am Teil, Karte links) ziehen mit. */
  let direkt = null;
  const textFaehig = (key) => element(key)?.art === 'text' || key === 'kopftext' || key === 'schlusstext';

  function textBearbeiten(key) {
    const b = bereich(key);
    if (!b) return false;
    if (key === 'tabelle') {
      // Die Überschriften der Spalten stehen im Fenster; es öffnet sich dort, wo sie sind.
      waehlen('tabelle');
      const det = $('#gsPop details', root);
      if (det) { det.open = true; popPlatzieren(); $('[data-st="name"]', det)?.focus(); }
      return true;
    }
    if (!textFaehig(key)) { waehlen(key); return false; }
    direkt?.ende(false);
    const e = element(key);
    const px = $('#gsWrap', root).clientWidth / SEITE.b;
    const d = D();
    const setzen = e
      ? (v) => { e.text = v; $$('[data-e="text"]', root).forEach((x) => { if (x.value !== v) x.value = v; }); }
      : (v) => { entwurf.profil[key] = v; $$(`[data-p="${key}"]`, root).forEach((x) => { if (x.value !== v) x.value = v; }); profilHinweise(); };
    const pt = e ? Number(e.groesse) || 10 : Number(d.schriftgroesse) || 9.5;
    waehlen(key, { still: true });
    direkt = textDirektBearbeiten($('#gsWrap', root), {
      x: b.x * px, y: b.y * px, b: b.b * px, h: b.h * px, schrift: pt * px,
      text: e ? e.text || '' : entwurf.profil[key] || '',
      farbe: (e ? e.farbe : d.textfarbe) || '#14181d', fett: !!e?.fett, ausrichtung: e?.ausrichtung || 'links',
      label: anzeigeName(key),
      beiAenderung: (v) => { setzen(v); geaendert(); },
      beiEnde: () => { direkt = null; popZeichnen(); },
    });
    return true;
  }

  /** Verschiebt einen Teil im Fluss um einen Platz (springt über leere Teile). */
  function flussVerschieben(key, richtung) {
    const liste = D().reihenfolge;
    const i = liste.indexOf(key);
    if (i < 0) return false;
    let j = i + richtung;
    while (j >= 0 && j < liste.length && !bereich(liste[j])) j += richtung;
    if (j < 0 || j >= liste.length) j = i + richtung;
    if (j < 0 || j >= liste.length) return false;
    liste.splice(i, 1);
    liste.splice(j, 0, key);
    return true;
  }

  // Ziehen: verschieben am Rahmen, Größe am Eck, im Fluss die Reihenfolge.
  const ziele = $('#gsZiele', root);
  ziele.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    const n = ev.target.closest('.re-ziel');
    if (!n) return;
    const key = n.dataset.key;
    const schonGewaehlt = auswahl === key;
    // Ist ein Fenster offen, schließt der Klick auf ein anderes Teil nur dieses; erst der nächste Klick wählt aus.
    if (auswahl && !schonGewaehlt && !$('#gsPop', root).hidden) { ev.preventDefault(); waehlen(null); return; }
    if (!schonGewaehlt) waehlen(key);
    n.focus({ preventScroll: true });
    // Am Telefon wählt das erste Antippen nur aus; so bleibt die Seite scrollbar.
    if (ev.pointerType === 'touch' && !schonGewaehlt) return;
    const b = bereich(key);
    if (!b || b.art === 'fest') return;
    ev.preventDefault();
    const groesse = !!ev.target.closest('[data-griff]');
    // Pixel je Millimeter: die Seite ist 210 mm breit und so breit wie das Feld. Gemessen wird am Feld selbst,
    // nicht an Annahmen über Zoom oder Spaltenbreite.
    const flaeche = ziele.getBoundingClientRect();
    const skala = pixelProMm(flaeche.width);
    const start = { x: ev.clientX, y: ev.clientY };
    const e = element(key);
    const anfang = b.anker ? { x: b.anker.x / PT, y: b.anker.y / PT, b: e ? Number(e.b) : Number(D().logoBreite), h: Number(e?.h) || 0 } : null;
    let bewegt = false;
    try { n.setPointerCapture(ev.pointerId); } catch { /* ohne Fang geht es auch, nur nicht über den Rand hinaus */ }
    const bewegen = (m) => {
      if (!bewegt && Math.hypot(m.clientX - start.x, m.clientY - start.y) < 3) return;
      if (!bewegt) { bewegt = true; zieht = true; $('#gsPop', root).hidden = true; }
      const dx = (m.clientX - start.x) / skala;
      const dy = (m.clientY - start.y) / skala;
      if (b.art === 'fluss') {
        // Der Zeiger entscheidet, zwischen welchen Teilen der Fluss-Teil steht.
        const seitenY = ((m.clientY - flaeche.top) / flaeche.height) * SEITE.h;
        const ziel = bereiche.find((q) => q.art === 'fluss' && q.key !== key && seitenY >= q.y && seitenY <= q.y + q.h);
        if (ziel) {
          const i = D().reihenfolge.indexOf(key);
          const j = D().reihenfolge.indexOf(ziel.key);
          const mitte = ziel.y + ziel.h / 2;
          if ((i < j && seitenY > mitte) || (i > j && seitenY < mitte)) {
            D().reihenfolge.splice(i, 1);
            D().reihenfolge.splice(j, 0, key);
            zeichnenBald();
          }
        }
        return;
      }
      if (!anfang) return;
      if (!groesse) {
        positionSetzen(key, anfang.x + dx, anfang.y + dy);
        spur = { key, x: (anfang.x + dx) * PT, y: (anfang.y + dy) * PT };
        // Sofort mitziehen, ohne auf die neu gesetzte Seite zu warten.
        n.style.left = `${(spur.x / SEITE.b) * 100}%`;
        n.style.top = `${(spur.y / SEITE.h) * 100}%`;
      } else if (e) {
        e.b = clamp(halb(anfang.b + dx), 1, 297);
        if (e.art === 'flaeche') e.h = clamp(halb(anfang.h + dy), 0.5, 297);
      } else D().logoBreite = clamp(Math.round(anfang.b + dx), 15, 80);
      zeichnenBald();
    };
    const los = async () => {
      window.removeEventListener('pointermove', bewegen);
      window.removeEventListener('pointerup', los);
      window.removeEventListener('pointercancel', los);
      zieht = false;
      if (!bewegt) { popZeichnen(); return; }
      spur = null;
      // Die Vorschau zeigt den Teil dort, wo er wirklich steht (nach dem Ausweichen); das merkt sich der Entwurf.
      await zeichnen();
      const jetzt = bereich(key);
      if (jetzt?.anker && !groesse && b.art !== 'fluss') positionSetzen(key, jetzt.anker.x / PT, jetzt.anker.y / PT);
      merken();
      popZeichnen();
    };
    window.addEventListener('pointermove', bewegen);
    window.addEventListener('pointerup', los);
    window.addEventListener('pointercancel', los);
  });
  ziele.addEventListener('keydown', (ev) => {
    const n = ev.target.closest('.re-ziel');
    if (!n) return;
    const key = n.dataset.key;
    const b = bereich(key);
    const schritte = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (schritte[ev.key]) {
      ev.preventDefault();
      if (auswahl !== key) waehlen(key);
      if (!b || b.art === 'fest') return;
      if (b.art === 'fluss') {
        if (schritte[ev.key][1] && flussVerschieben(key, schritte[ev.key][1])) geaendert({ panels: true });
        return;
      }
      const f = ev.shiftKey ? 5 : 1;
      positionSetzen(key, b.anker.x / PT + schritte[ev.key][0] * f, b.anker.y / PT + schritte[ev.key][1] * f);
      geaendert();
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && element(key)) {
      ev.preventDefault();
      elementEntfernen(key);
    } else if (ev.key === 'Escape') {
      waehlen(null);
    } else if (ev.key === 'F2') {
      ev.preventDefault();
      textBearbeiten(key);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      waehlen(key);
    } else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
      ev.preventDefault();
      const r = n.getBoundingClientRect();
      menueOeffnen({ clientX: r.left + 12, clientY: r.top + 12 }, key);
    }
  });
  ziele.addEventListener('dblclick', (ev) => {
    const n = ev.target.closest('.re-ziel');
    if (n) textBearbeiten(n.dataset.key);
  });
  // Ein Klick auf das leere Blatt öffnet die Seiteneinstellungen an dieser Stelle.
  $('#gsBlatt', root).addEventListener('click', (ev) => {
    if (ev.target.closest('.re-ziel') || zieht) return;
    // Wie bei den Teilen: Ist ein Fenster offen, schließt der Klick auf das leere Blatt nur dieses.
    if (auswahl && !$('#gsPop', root).hidden) { waehlen(null); return; }
    waehlen('seite', { hier: seitenOrt(ev) });
  });
  $('#gsSeite', root).addEventListener('click', () => waehlen(auswahl === 'seite' ? null : 'seite'));

  /* ------------------------------------------------------------------------ */
  /* Rechtsklick-Menü                                                         */
  /* ------------------------------------------------------------------------ */

  let menue = null;
  function schliesseMenue() {
    if (!menue) return;
    menue.remove();
    menue = null;
    window.removeEventListener('pointerdown', menueDaneben, true);
    window.removeEventListener('keydown', menueTaste, true);
    window.removeEventListener('scroll', schliesseMenue, true);
    window.removeEventListener('resize', schliesseMenue);
  }
  /**
   * Ein Linksklick neben das Menü schließt nur das Menü. Der Klick selbst
   * gehört nicht mehr dem Teil darunter: Er öffnet dort kein nächstes Fenster
   * und beginnt kein Ziehen. Ein Rechtsklick woanders öffnet gleich das Menü dort.
   */
  const menueDaneben = (e) => {
    if (!menue || menue.contains(e.target)) return;
    schliesseMenue();
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const schlucken = (k) => { k.stopPropagation(); k.preventDefault(); };
    window.addEventListener('click', schlucken, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', schlucken, true), 600);
  };
  const menueTaste = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); schliesseMenue(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const punkte = $$('button:not(:disabled)', menue);
      const i = punkte.indexOf(document.activeElement);
      punkte[(i + (e.key === 'ArrowDown' ? 1 : -1) + punkte.length) % punkte.length]?.focus();
    }
  };

  /** Welche Farben sich für einen Teil im Menü einstellen lassen: [Ziel, Name, Wert, Vorgaben, ohne]. */
  function farbZeilen(key) {
    const d = D();
    const e = element(key);
    if (e) {
      if (e.art === 'text' || e.art === 'linie') return [['e:farbe', 'Farbe', e.farbe, ELEMENTFARBEN, false]];
      if (e.art === 'flaeche') return [['e:fuellung', 'Füllung', e.fuellung, ELEMENTFARBEN, true], ['e:rand', 'Rand', e.rand, ELEMENTFARBEN, true]];
      return [];
    }
    const akzent = ['d:akzent', 'Akzentfarbe', d.akzent, FARBEN, false];
    const schrift = ['d:textfarbe', 'Schriftfarbe', d.textfarbe || '#14181d', SCHRIFTFARBEN, false];
    if (!key) return [akzent, schrift];
    if (key === 'tabelle') return [akzent, schrift];
    if (['kopf', 'inhalt', 'fuss'].includes(key)) return [akzent];
    if (['anschrift', 'info', 'kopftext', 'schlusstext', 'hinweise'].includes(key)) return [schrift];
    return [];
  }

  /** Menü an der Maus; key ist der Teil darunter oder null für das leere Blatt. */
  function menueOeffnen(ev, key) {
    schliesseMenue();
    const hier = key ? null : seitenOrt(ev);
    const e = element(key);
    const b = bereich(key);
    const eintraege = [];
    const punkt = (text, ic, aktion, { gefahr = false, aus = false } = {}) => eintraege.push({ text, ic, aktion, gefahr, aus });
    const farben = (key2) => { for (const [fz, label, wert, liste, ohne] of farbZeilen(key2)) eintraege.push({ farbe: { fz, label, wert, liste, ohne } }); };
    const trenner = () => { if (eintraege.length && eintraege[eintraege.length - 1] !== '-') eintraege.push('-'); };
    if (key && b) {
      punkt(`${anzeigeName(key)} bearbeiten`, 'edit', () => waehlen(key));
      if (textFaehig(key)) punkt('Text direkt ändern (Doppelklick)', 'type', () => textBearbeiten(key));
      if (farbZeilen(key).length) { trenner(); farben(key); trenner(); }
      if (b.art === 'fluss') {
        const i = D().reihenfolge.indexOf(key);
        punkt('Nach oben schieben', 'up', () => { if (flussVerschieben(key, -1)) geaendert({ panels: true }); }, { aus: i <= 0 });
        punkt('Nach unten schieben', 'down', () => { if (flussVerschieben(key, 1)) geaendert({ panels: true }); }, { aus: i < 0 || i >= D().reihenfolge.length - 1 });
      }
      if (D().positionen?.[key]) punkt('Zurück an die Standardstelle', 'refresh', () => { delete D().positionen[key]; geaendert({ panels: true }); });
      if (key === 'fuss') punkt(D().fusszeile === false ? 'Fußzeile einschalten' : 'Fußzeile ausschalten', D().fusszeile === false ? 'eye' : 'hide', () => { D().fusszeile = D().fusszeile === false; geaendert({ panels: true }); });
      if (key === 'anschrift') punkt(D().absenderzeile === false ? 'Absenderzeile einschalten' : 'Absenderzeile ausschalten', D().absenderzeile === false ? 'eye' : 'hide', () => { D().absenderzeile = D().absenderzeile === false; geaendert({ panels: true }); });
      if (e) {
        trenner();
        punkt('Duplizieren', 'copy', () => elementKopieren(key));
        punkt('Entfernen', 'trash', () => elementEntfernen(key), { gefahr: true });
      }
    } else {
      for (const [a, ic, t] of [['text', 'type', 'Text'], ['bild', 'image', 'Bild'], ['flaeche', 'square', 'Fläche'], ['linie', 'minus', 'Linie']]) punkt(`${t} hier einfügen`, ic, () => elementNeu(a, hier));
      trenner();
      farben(null);
      trenner();
      punkt('Seite einrichten', 'layout', () => waehlen('seite', { hier }));
    }
    menue = document.createElement('div');
    menue.className = 're-menue';
    menue.setAttribute('role', 'menu');
    menue.innerHTML = eintraege.map((p, i) => (p === '-' ? '<div class="re-menue-strich" role="separator"></div>'
      : p.farbe ? `<div class="re-menue-farbe" role="group" aria-label="${esc(p.farbe.label)}"><span class="re-menue-label">${esc(p.farbe.label)}</span>${farbwahl(p.farbe.fz, p.farbe.wert, p.farbe.liste, { ohne: p.farbe.ohne })}</div>`
      : `<button type="button" role="menuitem" data-i="${i}" class="${p.gefahr ? 'danger-text' : ''}" ${p.aus ? 'disabled' : ''}>${icon(p.ic, 14).__raw}<span>${esc(p.text)}</span></button>`)).join('');
    document.body.append(menue);
    const br = menue.offsetWidth;
    const ho = menue.offsetHeight;
    menue.style.left = `${Math.max(4, Math.min(ev.clientX, window.innerWidth - br - 4))}px`;
    menue.style.top = `${Math.max(4, Math.min(ev.clientY, window.innerHeight - ho - 4))}px`;
    // Farben wirken sofort; das Menü bleibt offen, damit man mehrere ausprobieren kann.
    menue.addEventListener('click', (k) => {
      const f = k.target.closest('button[data-fz]');
      if (f) farbeSetzen(f.dataset.fz, f.dataset.wert ?? '');
    });
    menue.addEventListener('input', (k) => { if (k.target.dataset?.fz) farbeSetzen(k.target.dataset.fz, k.target.value); });
    menue.addEventListener('click', (k) => {
      const t = k.target.closest('button[data-i]');
      if (!t) return;
      const p = eintraege[Number(t.dataset.i)];
      schliesseMenue();
      p.aktion();
    });
    window.addEventListener('pointerdown', menueDaneben, true);
    window.addEventListener('keydown', menueTaste, true);
    window.addEventListener('scroll', schliesseMenue, true);
    window.addEventListener('resize', schliesseMenue);
    menue.querySelector('button:not(:disabled)')?.focus();
  }
  $('#gsBlatt', root).addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const n = ev.target.closest('.re-ziel');
    if (n) { if (auswahl !== n.dataset.key) waehlen(n.dataset.key, { still: true }); menueOeffnen(ev, n.dataset.key); } else menueOeffnen(ev, null);
  });
  root.addEventListener('pointerdown', (ev) => { if (menue && !menue.contains(ev.target)) schliesseMenue(); });

  /* ------------------------------------------------------------------------ */
  /* Elemente                                                                 */
  /* ------------------------------------------------------------------------ */

  async function elementNeu(art, hier = null, { datei = null } = {}) {
    const e = { ...structuredClone(ELEMENT_VORGABE[art]), id: uid('el') };
    if (art === 'flaeche') { e.x = 25; e.y = 100; e.b = 60; e.h = 20; e.rand = ''; e.seiten = 'erste'; }
    if (art === 'flaeche' || art === 'linie') { e.fuellung = e.fuellung && D().akzent; e.farbe = e.farbe && D().akzent; }
    if (art === 'text') e.farbe = D().textfarbe || e.farbe;
    if (art === 'bild') {
      const id = await bildHochladen({ datei });
      if (!id) return;
      e.bildId = id;
    }
    if (hier) { e.x = clamp(hier.x, 0, 190); e.y = clamp(hier.y, 0, 280); }
    D().elemente.push(e);
    auswahl = `el:${e.id}`;
    ort = null;
    merken();
    await zeichnen();
    popZeichnen();
    $(`.re-ziel[data-key="${CSS.escape(auswahl)}"]`, root)?.focus({ preventScroll: true });
    return true;
  }

  function elementEntfernen(key) {
    const e = element(key);
    if (!e) return;
    D().elemente = D().elemente.filter((x) => x !== e);
    auswahl = null;
    geaendert({ panels: true });
  }

  function elementKopieren(key) {
    const e = element(key);
    if (!e) return;
    const kopie = { ...structuredClone(e), id: uid('el'), x: halb(Number(e.x) + 5), y: halb(Number(e.y) + 5) };
    D().elemente.push(kopie);
    auswahl = `el:${kopie.id}`;
    geaendert({ panels: true });
  }

  async function bildHochladen({ maxPixel = 1600, datei: vorgabe = null } = {}) {
    const datei = vorgabe || await bildWaehlen();
    if (!datei) return '';
    try {
      const meta = await bildAblegen(datei, { maxPixel });
      await commit('beleg.bild', (db) => { db.attachments.push(meta); }, { silent: true });
      return meta.id;
    } catch (ex) {
      err('Bild nicht übernommen', ex.message);
      return '';
    }
  }

  $$('[data-neu]', root).forEach((b) => b.addEventListener('click', () => elementNeu(b.dataset.neu)));

  // Strg+V mit einem Bild in der Zwischenablage (etwa ein Bildschirmfoto): neues Bild auf der Seite,
  // dort, wo der Zeiger zuletzt war, sonst an einer freien Stelle.
  let zeigerOrt = null;
  $('#gsBlatt', root).addEventListener('pointermove', (ev) => { zeigerOrt = seitenOrt(ev); });
  const einfuegen = (ev) => {
    if (!root.isConnected) { document.removeEventListener('paste', einfuegen); return; }
    const bilder = bilderAusZwischenablage(ev);
    if (!bilder.length) return;
    ev.preventDefault();
    direkt?.ende(false);
    schliesseMenue();
    elementNeu('bild', zeigerOrt && zeigerOrt.x >= 0 && zeigerOrt.x <= 200 ? { x: zeigerOrt.x, y: zeigerOrt.y } : null, { datei: bilder[0] })
      .then((erstellt) => { if (erstellt) ok('Bild eingefügt', 'Verschieben und Größe ändern gehen wie bei jedem Teil.'); });
  };
  document.addEventListener('paste', einfuegen);

  /* ------------------------------------------------------------------------ */
  /* Eingaben                                                                 */
  /* ------------------------------------------------------------------------ */

  const wertAus = (el) => {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.num !== undefined || el.type === 'number' || el.type === 'range') return Number(el.value);
    return el.value;
  };

  /** Farbwahl: Ziel „d:feld“ (Gestaltung) oder „e:feld“ (gewähltes Element). */
  function farbeSetzen(fz, wert) {
    const [bereichArt, f] = fz.split(':');
    if (bereichArt === 'e') {
      const e = element(auswahl);
      if (!e) return;
      e[f] = wert;
    } else D()[f] = wert;
    [...$$(`[data-fz="${fz}"]`, root), ...(menue ? $$(`[data-fz="${fz}"]`, menue) : [])].forEach((x) => {
      if (x.type === 'color') { if (wert) x.value = wert; x.closest('label')?.classList.toggle('active', !!wert && !x.closest('.re-farben')?.querySelector(`button[data-wert="${wert.toLowerCase()}" i]`)); }
      else x.classList.toggle('active', (x.dataset.wert || '').toLowerCase() === (wert || '').toLowerCase());
    });
    geaendert();
  }

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.fz) { farbeSetzen(el.dataset.fz, el.value); return; }
    if (el.dataset.d && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      D()[el.dataset.d] = wertAus(el);
      $$(`[data-wert-von="${el.dataset.d}"]`, root).forEach((x) => { x.textContent = `${el.value} mm`; });
      geaendert();
    } else if (el.dataset.st) {
      D().spaltenTitel = { ...D().spaltenTitel, [el.dataset.st]: el.value };
      geaendert();
    } else if (el.dataset.p) {
      entwurf.profil[el.dataset.p] = el.dataset.p === 'zahlungszielTage' ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value;
      // Dieselben Texte stehen links und im Fenster am Teil.
      if (el.dataset.p === 'kopftext' || el.dataset.p === 'schlusstext') $$(`[data-p="${el.dataset.p}"]`, root).forEach((x) => { if (x !== el) x.value = el.value; });
      profilHinweise();
      zeichnenBald();
    } else if (el.dataset.e && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      const e = element(auswahl);
      if (!e) return;
      if (el.type === 'number' && el.value === '') return;
      e[el.dataset.e] = wertAus(el);
      $$(`[data-wert-von-e="${el.dataset.e}"]`, root).forEach((x) => { x.textContent = `${el.value} mm`; });
      geaendert();
    } else if (el.dataset.pos) {
      const b = bereich(auswahl);
      if (!b || el.value === '') return;
      const x = el.dataset.pos === 'x' ? Number(el.value) : (b.anker?.x ?? b.x) / PT;
      const y = el.dataset.pos === 'y' ? Number(el.value) : (b.anker?.y ?? b.y) / PT;
      positionSetzen(auswahl, x, y);
      geaendert();
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.d && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      D()[el.dataset.d] = wertAus(el);
      // Dasselbe Feld kann an zwei Stellen stehen (Fenster und Karte).
      $$(`[data-d="${el.dataset.d}"]`, root).forEach((x) => { if (x !== el) { if (x.type === 'checkbox') x.checked = el.checked; else x.value = el.value; } });
      geaendert({ panels: ['spalteNr', 'spalteEinheit', 'spalteSatz', 'fusszeile', 'tabellenkopfFarbig'].includes(el.dataset.d) });
    } else if (el.dataset.p && el.tagName === 'SELECT') {
      entwurf.profil[el.dataset.p] = el.value;
      zeichnenBald();
    } else if (el.dataset.e && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      const e = element(auswahl);
      if (!e) return;
      e[el.dataset.e] = wertAus(el);
      geaendert();
    }
  });

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button, a');
    if (!t || !root.contains(t)) return;
    if (t.dataset.fz) { farbeSetzen(t.dataset.fz, t.dataset.wert ?? ''); return; }
    // Umschalter und Kacheln (Stil, Ausrichtung, Tabellenstil …)
    const wert = t.dataset.wert;
    const gruppe = t.closest('[data-seg], [data-eseg], [data-rand]') || t.parentElement;
    if (wert !== undefined && gruppe?.dataset.rand !== undefined) {
      const [l, r] = RAENDER[wert] || RAENDER.normal;
      D().randLinks = l;
      D().randRechts = r;
      $$('[data-wert]', gruppe).forEach((x) => x.classList.toggle('active', x === t));
      geaendert();
      return;
    }
    if (wert !== undefined && gruppe?.dataset.seg) {
      const feldName = gruppe.dataset.seg;
      D()[feldName] = gruppe.dataset.num !== undefined ? Number(wert) : wert;
      if (feldName === 'logoPosition' && D().positionen?.kopf) delete D().positionen.kopf;
      $$(`[data-seg="${feldName}"] [data-wert]`, root).forEach((x) => { x.classList.toggle('active', x.dataset.wert === wert); x.setAttribute?.('aria-pressed', x.dataset.wert === wert ? 'true' : 'false'); });
      geaendert({ panels: feldName === 'tabellenstil' });
      return;
    }
    if (wert !== undefined && gruppe?.dataset.eseg) {
      const e = element(auswahl);
      if (!e) return;
      e[gruppe.dataset.eseg] = wert;
      $$('[data-wert]', gruppe).forEach((x) => x.classList.toggle('active', x === t));
      geaendert();
      return;
    }
    if (t.dataset.rf) {
      if (flussVerschieben(t.dataset.rf, Number(t.dataset.rfDir))) geaendert({ panels: true });
      return;
    }
    if (t.dataset.platzhalter) {
      const f = $('[data-e="text"]', $('#gsPop', root));
      const e = element(auswahl);
      if (!f || !e) return;
      const a = f.selectionStart ?? f.value.length;
      f.value = `${f.value.slice(0, a)}{${t.dataset.platzhalter}}${f.value.slice(f.selectionEnd ?? a)}`;
      e.text = f.value;
      f.focus();
      geaendert();
      return;
    }
    if (t.dataset.neuHier) { elementNeu(t.dataset.neuHier, ort); return; }
    if (t.dataset.bildNeu) {
      const feldName = t.dataset.bildNeu;
      const id = await bildHochladen({ maxPixel: feldName === 'briefpapierId' ? 2480 : 1600 });
      if (!id) return;
      D()[feldName] = id;
      if (feldName === 'logoId' && D().positionen?.kopf) delete D().positionen.kopf;
      ok(feldName === 'logoId' ? 'Logo übernommen' : feldName === 'briefpapierId' ? 'Briefpapier übernommen' : 'Bild übernommen', 'Mit „Übernehmen“ gilt es für neue Rechnungen.');
      await bilderKarteZeichnen();
      geaendert({ panels: true });
      return;
    }
    if (t.dataset.bildWeg) {
      // Das alte Bild bleibt im Tresor: Ausgestellte Rechnungen zeigen es weiterhin.
      D()[t.dataset.bildWeg] = '';
      await bilderKarteZeichnen();
      geaendert({ panels: true });
      return;
    }
    if (t.dataset.zuEinst !== undefined) { ev.preventDefault(); navigate('settings'); return; }
    const aw = t.dataset.aw;
    if (!aw) return;
    const e = element(auswahl);
    if (aw === 'zu') waehlen(null);
    else if (aw === 'standard') { delete D().positionen[auswahl]; geaendert({ panels: true }); }
    else if (aw === 'weg') elementEntfernen(auswahl);
    else if (aw === 'kopie') elementKopieren(auswahl);
    else if (aw === 'bild' && e) {
      const id = await bildHochladen();
      if (id) { e.bildId = id; geaendert(); }
    }
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !menue && ev.target.closest('#gsPop')) { ev.stopPropagation(); waehlen(null); }
  });
  const groesseGeaendert = () => {
    if (!root.isConnected) { window.removeEventListener('resize', groesseGeaendert); schliesseMenue(); return; }
    popPlatzieren();
  };
  window.addEventListener('resize', groesseGeaendert);
  // Klappt etwas im Fenster auf oder zu, ändert sich seine Höhe.
  $('#gsPop', root).addEventListener('toggle', () => popPlatzieren(), true);

  /* ------------------------------------------------------------------------ */
  /* Speichern                                                                */
  /* ------------------------------------------------------------------------ */

  async function speichern() {
    const p = entwurf.profil;
    await commit('einstellungen.rechnung', (db) => {
      db.settings.rechnung = {
        ...(db.settings.rechnung || {}),
        profil: { ...PROFIL_VORGABE, ...p, iban: String(p.iban || '').replace(/\s/g, '').toUpperCase(), bic: String(p.bic || '').replace(/\s/g, '').toUpperCase() },
        design: designVoll(D()),
      };
      db.settings.updatedAt = new Date().toISOString();
    }, { entity: 'einstellungen', summary: 'Rechnungsgestaltung und -angaben geändert' });
    await saveNow();
    gespeichert = JSON.stringify(entwurf);
    ok('Übernommen', 'Gilt für alle Rechnungen, die Sie ab jetzt ausstellen.');
  }
  $('#gsSpeichern', root).addEventListener('click', () => speichern().catch((ex) => err('Nicht übernommen', ex.message)));
  $('#gsZuruecksetzen', root).addEventListener('click', async () => {
    const ja = await confirmDialog({
      title: 'Freie Gestaltung zurücksetzen?',
      text: 'Verschobene Teile kommen an ihre Standardstelle, eigene Texte, Bilder, Flächen und Linien werden entfernt, Reihenfolge, Spalten und Ränder wie am Anfang. Logo, Farben und Ihre Angaben bleiben.',
      confirmLabel: 'Zurücksetzen', danger: true,
    });
    if (!ja) return;
    Object.assign(D(), { positionen: {}, elemente: [], reihenfolge: Object.keys(FLUSS_BAUSTEINE), spaltenTitel: {}, spalteNr: true, spalteEinheit: true, spalteSatz: true, tabellenstil: 'auto', randLinks: 25, randRechts: 20, titelGroesse: 0 });
    auswahl = null;
    allesZeichnen();
    merken();
  });

  function allesZeichnen() {
    aussehenZeichnen();
    bilderKarteZeichnen();
    zeichnen().then(popZeichnen);
  }

  allesZeichnen();
  angabenZeichnen();
  verlaufKnoepfe();
  if (params.abschnitt === 'angaben') setTimeout(() => $('#gsAngaben', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
