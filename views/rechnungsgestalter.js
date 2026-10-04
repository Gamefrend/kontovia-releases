/**
 * Kontovia – Rechnungen gestalten (Reiter „Gestaltung“).
 *
 * Rechts die erste Seite als Vorschau. Jeder Teil darauf lässt sich anklicken
 * und mit der Maus (am Telefon: antippen, dann ziehen) oder den Pfeiltasten
 * verschieben: Kopf mit Logo, Anschrift, Rechnungsangaben, Beginn des
 * Inhalts und eigene Elemente (Texte, Bilder, Flächen, Linien). Links stehen
 * Stil, Farben, Tabelle, Reihenfolge, Briefpapier und die Angaben, die auf
 * jeder Rechnung stehen.
 *
 * Geändert wird ein Entwurf; erst „Übernehmen“ schreibt in die Einstellungen.
 * Ausgestellte Rechnungen behalten ihre Gestaltung (lib/rechnungsaktionen.js).
 * Gezeichnet wird mit derselben Engine wie das PDF (lib/rechnungsdruck.js).
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

const PT = 72 / 25.4; // Punkt je mm
const SEITE = { b: 595.28, h: 841.89 };
const FARBEN = ['#3446e0', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#1f2937', '#0369a1', '#4d7c0f'];
const NAMEN = { kopf: 'Kopf', anschrift: 'Anschrift', info: 'Rechnungsangaben', inhalt: 'Titel und Inhalt' };
const ELEMENT_NAMEN = { text: 'Text', bild: 'Bild', flaeche: 'Fläche', linie: 'Linie' };
const SPALTEN = { nr: 'Pos.', name: 'Bezeichnung', menge: 'Menge', einheit: 'Einheit', preis: 'Einzelpreis', satz: 'USt', netto: 'Gesamt netto' };

const mm = (pt) => Math.round((pt / PT) * 2) / 2;
const halb = (x) => Math.round(Number(x) * 2) / 2;

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

const seg = (feld, paare, wert, attr = 'data-seg') => `<div class="seg sm" role="group" ${attr}="${esc(feld)}">${paare.map(([k, t]) => `<button type="button" data-wert="${esc(k)}" class="${String(wert) === String(k) ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>`;
const haken = (feld, wert, text, hint = '') => `<label class="check"><input type="checkbox" data-d="${esc(feld)}" ${wert ? 'checked' : ''}> <span>${text}${hint ? ` <span class="muted">${hint}</span>` : ''}</span></label>`;

export async function gestaltungZeigen(root, params = {}) {
  const s = store.db.settings;
  const v = verkaeuferAus(s);
  const entwurf = { design: structuredClone(designAus(s)), profil: { ...profilAus(s) } };
  const D = () => entwurf.design;
  let gespeichert = JSON.stringify(entwurf);
  const muster = musterRechnung();
  let auswahl = null;
  let bereiche = [];
  const fehlt = [!v.name && 'Firmenname', !(v.strasse && v.plz && v.ort) && 'Anschrift', !(v.ustId || v.steuernummer) && 'Steuernummer oder USt-IdNr.'].filter(Boolean);

  router.leaveGuard = async () => {
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
        <section class="card" id="gsTabelle"></section>
        <section class="card" id="gsReihenfolge"></section>
        <section class="card" id="gsKopfFuss"></section>
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
            <button type="button" class="icon-btn" id="gsZurueck" title="Rückgängig (Strg+Z)" aria-label="Rückgängig">${icon('left', 16).__raw}</button>
            <button type="button" class="icon-btn" id="gsVor" title="Wiederholen (Strg+Y)" aria-label="Wiederholen">${icon('right', 16).__raw}</button>
          </div>
          <div id="gsAuswahl"></div>
        </div>
        <div class="re-vorschau" id="reVorschau">
          <div class="re-blatt re-gestalter-blatt" id="gsBlatt"><div id="gsSvg"></div><div class="re-ziele" id="gsZiele"></div></div>
          <div id="gsWeitere" class="re-vorschau"></div>
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
    if (panels) { auswahlZeichnen(); }
    zeichnenBald();
  }

  /* ------------------------------------------------------------------------ */
  /* Linke Spalte                                                             */
  /* ------------------------------------------------------------------------ */

  function aussehenZeichnen() {
    const d = D();
    $('#gsAussehen', root).innerHTML = `
      <div class="card-head"><h3>${icon('layout', 16).__raw} Aussehen</h3><span class="sub">gilt für alle neuen Rechnungen</span></div>
      <div class="card-body">
        <div class="field"><label>Stil</label>${seg('layout', [['klassisch', 'Klassisch'], ['modern', 'Modern'], ['schlicht', 'Schlicht']], d.layout)}</div>
        <div class="field"><label>Akzentfarbe</label>
          <div class="row wrap re-farben">
            ${FARBEN.map((f) => `<button type="button" class="re-farbe ${f === d.akzent ? 'active' : ''}" data-farbe="${f}" style="background:${f}" aria-label="Farbe ${f}"></button>`).join('')}
            <label class="re-farbe-eigen" title="Eigene Farbe"><input type="color" data-d="akzent" value="${esc(d.akzent)}" aria-label="Eigene Akzentfarbe"></label>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="gs_text">Textfarbe</label><input type="color" id="gs_text" class="re-farbfeld" data-d="textfarbe" value="${esc(d.textfarbe || '#14181d')}"></div>
          <div class="field"><label for="gs_groesse">Schriftgröße</label><select id="gs_groesse" data-d="schriftgroesse" data-num>
            ${[[8.5, 'Klein'], [9, 'Etwas kleiner'], [9.5, 'Normal'], [10, 'Etwas größer'], [10.5, 'Groß'], [11, 'Sehr groß']].map(([g, t]) => `<option value="${g}" ${Number(d.schriftgroesse) === g ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label for="gs_titel">Größe des Titels</label><select id="gs_titel" data-d="titelGroesse" data-num>
            ${[[0, 'Nach Stil'], [12, 'Klein'], [15, 'Normal'], [19, 'Groß'], [24, 'Sehr groß']].map(([g, t]) => `<option value="${g}" ${Number(d.titelGroesse) === g ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Seitenränder links und rechts</label>
            <div class="row" style="gap:6px"><input type="number" min="8" max="45" step="1" data-d="randLinks" data-num value="${esc(d.randLinks)}" aria-label="Rand links in mm">
              <input type="number" min="8" max="45" step="1" data-d="randRechts" data-num value="${esc(d.randRechts)}" aria-label="Rand rechts in mm"><span class="small muted">mm</span></div></div>
        </div>
        <p class="small muted mb0">Die Gestaltung ändert nur die Ansicht. Pflichtangaben bleiben immer auf der Rechnung, und die Daten im PDF bleiben eine gültige E-Rechnung.</p>
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
              ${logo ? `<div class="row wrap">${seg('logoPosition', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], d.logoPosition)}
                <label class="re-regler">Breite <input type="range" min="15" max="80" step="1" data-d="logoBreite" data-num value="${esc(d.logoBreite)}"> <span data-wert-von="logoBreite">${esc(d.logoBreite)} mm</span></label></div>`
                : '<span class="hint">PNG, JPG oder SVG. Ohne Logo steht Ihr Firmenname im Kopf.</span>'}
            </div></div></div>
        <div class="field"><label>Briefpapier</label>
          <div class="re-bildwahl">${feld(brief, 'Briefpapier', 'keines')}
            <div class="stack">${knoepfe('briefpapierId', brief, 'Briefpapier hochladen', 'Anderes Briefpapier')}
              ${brief ? seg('briefpapierSeiten', [['erste', 'Nur erste Seite'], ['alle', 'Alle Seiten']], d.briefpapierSeiten)
                : '<span class="hint">Ein Bild Ihres Briefbogens im Format A4, etwa als JPG oder PNG. Es liegt hinter der ganzen Rechnung.</span>'}
              ${brief ? '<span class="hint">Steht Ihr Name schon auf dem Briefpapier, blenden Sie unten Kopf und Fußzeile aus.</span>' : ''}
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

  function tabelleZeichnen() {
    const d = D();
    $('#gsTabelle', root).innerHTML = `
      <div class="card-head"><h3>${icon('table', 16).__raw} Tabelle der Positionen</h3></div>
      <div class="card-body">
        <div class="field"><label>Stil der Tabelle</label>${seg('tabellenstil', [['auto', 'Nach Stil'], ['flaeche', 'Fläche'], ['linien', 'Linien'], ['streifen', 'Streifen'], ['raster', 'Raster']], d.tabellenstil)}</div>
        ${haken('tabellenkopfFarbig', d.tabellenkopfFarbig, 'Tabellenkopf in der Akzentfarbe')}
        ${haken('spalteNr', d.spalteNr, 'Spalte mit der Positionsnummer')}
        ${haken('spalteEinheit', d.spalteEinheit, 'Eigene Spalte für die Einheit', '(sonst steht sie bei der Menge)')}
        ${haken('spalteSatz', d.spalteSatz, 'Spalte mit dem Steuersatz', '(bei mehreren Steuersätzen immer)')}
        <details class="re-check-mehr mt8"><summary>Spaltenüberschriften ändern</summary>
          <div class="form-grid mt8">${Object.entries(SPALTEN).map(([k, t]) => `<div class="field mb0"><label for="gs_sp_${k}">${esc(t)}</label>
            <input id="gs_sp_${k}" data-st="${k}" value="${esc(d.spaltenTitel?.[k] || '')}" placeholder="${esc(t)}"></div>`).join('')}</div>
        </details>
      </div>`;
  }

  function reihenfolgeZeichnen() {
    const liste = D().reihenfolge;
    $('#gsReihenfolge', root).innerHTML = `
      <div class="card-head"><h3>${icon('sort', 16).__raw} Reihenfolge</h3><span class="sub">was unter dem Titel nacheinander kommt</span></div>
      <div class="card-body">
        <ol class="re-reihe">${liste.map((k, i) => `<li><span class="re-reihe-nr">${i + 1}</span><span class="re-reihe-name">${esc(FLUSS_BAUSTEINE[k])}</span>
          <button type="button" class="icon-btn" data-rf="${k}" data-rf-dir="-1" ${i === 0 ? 'disabled' : ''} title="Nach oben" aria-label="${esc(FLUSS_BAUSTEINE[k])} nach oben">${icon('up', 15).__raw}</button>
          <button type="button" class="icon-btn" data-rf="${k}" data-rf-dir="1" ${i === liste.length - 1 ? 'disabled' : ''} title="Nach unten" aria-label="${esc(FLUSS_BAUSTEINE[k])} nach unten">${icon('down', 15).__raw}</button></li>`).join('')}</ol>
      </div>`;
  }

  function kopfFussZeichnen() {
    const d = D();
    $('#gsKopfFuss', root).innerHTML = `
      <div class="card-head"><h3>${icon('file', 16).__raw} Kopf und Fuß</h3></div>
      <div class="card-body">
        ${haken('firmenkopf', d.firmenkopf, 'Firmenname im Kopf', '(wenn kein Logo da ist)')}
        ${haken('absenderzeile', d.absenderzeile, 'Absender in kleiner Schrift über der Anschrift')}
        ${haken('fusszeile', d.fusszeile, 'Fußzeile mit Kontakt, Bank und Steuernummer')}
        ${haken('falzmarken', d.falzmarken, 'Falzmarken für den Fensterumschlag')}
        ${haken('hinweisERechnung', d.hinweisERechnung, 'Hinweis auf die enthaltene E-Rechnung')}
        <p class="small muted mb0 mt8">Ohne Fußzeile setzt Kontovia Steuernummer, Anschrift und Registerangaben an eine andere Stelle, weil sie auf jeder Rechnung stehen müssen.</p>
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
  /* Auswahl                                                                  */
  /* ------------------------------------------------------------------------ */

  const element = (key) => (String(key || '').startsWith('el:') ? D().elemente.find((e) => e.id === key.slice(3)) : null);
  const bereich = (key) => bereiche.find((b) => b.key === key);

  function auswahlZeichnen() {
    const box = $('#gsAuswahl', root);
    const b = bereich(auswahl);
    if (!auswahl || (!b && !element(auswahl))) {
      auswahl = null;
      box.innerHTML = `<p class="small muted mb0 re-auswahl-tipp">${icon('move', 14).__raw} Klicken Sie auf einen Teil der Rechnung, um ihn zu verschieben oder zu ändern.
        Ziehen am Eck ändert die Größe. Pfeiltasten verschieben um 1 mm, mit Umschalt um 5 mm.</p>`;
      return;
    }
    const e = element(auswahl);
    const d = D();
    const x = e ? halb(e.x) : mm(b.anker.x);
    const y = e ? halb(e.y) : mm(b.anker.y);
    const zahl = (attr, wert, label, { min = -20, max = 300, step = 0.5 } = {}) => `<label class="re-mini"><span>${label}</span><input type="number" ${attr} value="${esc(wert)}" min="${min}" max="${max}" step="${step}"></label>`;
    const farbe = (feld, wert, label, ohne = false) => `<label class="re-mini"><span>${label}</span><span class="row" style="gap:6px">
      <input type="color" class="re-farbfeld" data-e="${feld}" value="${esc(/^#[0-9a-f]{6}$/i.test(wert || '') ? wert : '#3446e0')}" ${ohne && !wert ? 'disabled' : ''}>
      ${ohne ? `<label class="check small"><input type="checkbox" data-ohne="${feld}" ${!wert ? 'checked' : ''}> keine</label>` : ''}</span></label>`;
    let felder = '';
    let extra = '';
    if (e) {
      felder = `${zahl('data-e="x"', x, 'Links (mm)')}${zahl('data-e="y"', y, 'Oben (mm)')}`;
      if (e.art === 'text') {
        felder += `${zahl('data-e="b"', halb(e.b), 'Breite (mm)', { min: 5, max: 210 })}${zahl('data-e="groesse"', e.groesse, 'Schriftgröße', { min: 5, max: 60, step: 0.5 })}${farbe('farbe', e.farbe, 'Farbe')}`;
        extra = `<textarea data-e="text" rows="3" aria-label="Text">${esc(e.text || '')}</textarea>
          <div class="row wrap" style="gap:8px">${seg('ausrichtung', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], e.ausrichtung || 'links', 'data-eseg')}
            <label class="check small"><input type="checkbox" data-e="fett" ${e.fett ? 'checked' : ''}> fett</label></div>
          <div class="re-platzhalter small"><span class="muted">Einfügen:</span> ${Object.entries(PLATZHALTER).map(([k, t]) => `<button type="button" class="re-chip" data-platzhalter="${k}" title="${esc(t)}">{${k}}</button>`).join('')}</div>`;
      } else if (e.art === 'bild') {
        felder += zahl('data-e="b"', halb(e.b), 'Breite (mm)', { min: 3, max: 210 });
        extra = `<div class="row wrap" style="gap:8px"><button type="button" class="btn sm" data-aw="bild">${icon('image', 13).__raw} ${e.bildId ? 'Anderes Bild' : 'Bild wählen'}</button></div>`;
      } else if (e.art === 'flaeche') {
        felder += `${zahl('data-e="b"', halb(e.b), 'Breite (mm)', { min: 0.5, max: 297 })}${zahl('data-e="h"', halb(e.h), 'Höhe (mm)', { min: 0.5, max: 297 })}
          ${farbe('fuellung', e.fuellung, 'Füllung', true)}${farbe('rand', e.rand, 'Rand', true)}`;
      } else if (e.art === 'linie') {
        felder += `${zahl('data-e="b"', halb(e.b), 'Länge (mm)', { min: 1, max: 297 })}${zahl('data-e="staerke"', e.staerke, 'Stärke (pt)', { min: 0.1, max: 10, step: 0.1 })}${farbe('farbe', e.farbe, 'Farbe')}`;
        extra = seg('richtung', [['waagerecht', 'Waagerecht'], ['senkrecht', 'Senkrecht']], e.richtung || 'waagerecht', 'data-eseg');
      }
      extra += `<div class="row wrap" style="gap:8px">
          <select data-e="seiten" aria-label="Auf welchen Seiten">${[['erste', 'Nur erste Seite'], ['alle', 'Alle Seiten']].map(([k, t]) => `<option value="${k}" ${e.seiten === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select data-e="ebene" aria-label="Ebene">${[['hinten', 'Hinter dem Inhalt'], ['vorne', 'Über dem Inhalt']].map(([k, t]) => `<option value="${k}" ${(e.ebene || 'hinten') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <span class="spacer"></span>
          <button type="button" class="btn sm ghost" data-aw="kopie">${icon('copy', 13).__raw} Duplizieren</button>
          <button type="button" class="btn sm ghost danger-text" data-aw="weg">${icon('trash', 13).__raw} Entfernen</button></div>`;
    } else {
      const verschoben = !!d.positionen?.[auswahl];
      felder = auswahl === 'inhalt' ? zahl('data-pos="y"', y, 'Oben (mm)') : `${zahl('data-pos="x"', x, 'Links (mm)')}${zahl('data-pos="y"', y, 'Oben (mm)')}`;
      if (auswahl === 'kopf' && b.logo) {
        extra = `<div class="row wrap" style="gap:8px">${seg('logoPosition', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], d.logoPosition)}
          <label class="re-regler">Breite <input type="range" min="15" max="80" step="1" data-d="logoBreite" data-num value="${esc(d.logoBreite)}"> <span data-wert-von="logoBreite">${esc(d.logoBreite)} mm</span></label></div>`;
      } else if (auswahl === 'kopf') {
        extra = `<div class="row wrap" style="gap:8px">${seg('logoPosition', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], d.logoPosition)}</div>`;
      } else if (auswahl === 'anschrift') {
        extra = `${haken('absenderzeile', d.absenderzeile, 'Absender in kleiner Schrift darüber')}
          ${verschoben ? '<p class="small muted mb0">Außerhalb der Standardstelle passt die Anschrift nicht mehr ins Fenster eines Umschlags.</p>' : ''}`;
      } else if (auswahl === 'inhalt') {
        extra = `<label class="re-mini"><span>Größe des Titels</span><select data-d="titelGroesse" data-num>${[[0, 'Nach Stil'], [12, 'Klein'], [15, 'Normal'], [19, 'Groß'], [24, 'Sehr groß']].map(([g, t]) => `<option value="${g}" ${Number(d.titelGroesse) === g ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
      }
      if (verschoben) extra += `<div class="row"><button type="button" class="btn sm ghost" data-aw="standard">${icon('refresh', 13).__raw} Zurück an die Standardstelle</button></div>`;
    }
    box.innerHTML = `
      <div class="re-auswahl">
        <div class="re-auswahl-kopf"><strong>${esc(e ? ELEMENT_NAMEN[e.art] : NAMEN[auswahl] || '')}</strong><span class="spacer"></span>
          <button type="button" class="icon-btn" data-aw="zu" title="Auswahl aufheben" aria-label="Auswahl aufheben">${icon('x', 15).__raw}</button></div>
        <div class="re-auswahl-felder">${felder}</div>
        ${extra ? `<div class="stack">${extra}</div>` : ''}
      </div>`;
  }

  /** Eingaben im Auswahlfeld schreiben die Zahlen zurück, ohne das Feld neu zu zeichnen. */
  function positionSetzen(key, xMm, yMm) {
    const x = clamp(halb(xMm), -20, 210);
    const y = clamp(halb(yMm), -20, 297);
    const e = element(key);
    if (e) { e.x = x; e.y = y; return; }
    D().positionen ||= {};
    D().positionen[key] = key === 'inhalt' ? { y } : { x, y };
  }

  function auswahlFelderAuffrischen() {
    const box = $('#gsAuswahl', root);
    const e = element(auswahl);
    const b = bereich(auswahl);
    const setze = (sel2, wert) => { const f = box.querySelector(sel2); if (f && document.activeElement !== f) f.value = wert; };
    if (e) { setze('[data-e="x"]', halb(e.x)); setze('[data-e="y"]', halb(e.y)); setze('[data-e="b"]', halb(e.b)); setze('[data-e="h"]', halb(e.h)); }
    else if (b) { setze('[data-pos="x"]', mm(b.anker.x)); setze('[data-pos="y"]', mm(b.anker.y)); }
  }

  /* ------------------------------------------------------------------------ */
  /* Vorschau und Rahmen                                                      */
  /* ------------------------------------------------------------------------ */

  let laeuft = 0;
  async function zeichnen() {
    const nr = ++laeuft;
    const rahmen = { v: verkaeuferAus({ ...s, rechnung: { ...(s.rechnung || {}), profil: entwurf.profil } }), d: designVoll(D()) };
    let daten;
    try { daten = await vorschauDaten(muster, rahmen); } catch (ex) {
      $('#gsSvg', root).innerHTML = `<div class="notice small">Die Vorschau ließ sich nicht erstellen: ${esc(ex.message)}</div>`;
      return;
    }
    if (nr !== laeuft || !root.isConnected) return;
    bereiche = daten.bereiche;
    $('#gsSvg', root).innerHTML = daten.svgs[0] || '';
    $('#gsWeitere', root).innerHTML = daten.svgs.slice(1).map((svg, i) => `<div class="re-blatt" title="Seite ${i + 2}">${svg}</div>`).join('');
    zieleZeichnen();
    auswahlFelderAuffrischen();
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
      const name = e ? ELEMENT_NAMEN[e.art] : NAMEN[b.key];
      const groesse = !!e || (b.key === 'kopf' && b.logo);
      if (!n) {
        n = document.createElement('div');
        n.className = 're-ziel';
        n.dataset.key = b.key;
        n.tabIndex = 0;
        n.setAttribute('role', 'button');
        host.append(n);
      }
      n.setAttribute('aria-label', `${name} verschieben`);
      const inhalt = `<span class="re-ziel-name">${esc(name)}</span>${groesse ? '<span class="re-griff" data-griff aria-hidden="true"></span>' : ''}`;
      if (n.dataset.inhalt !== inhalt) { n.innerHTML = inhalt; n.dataset.inhalt = inhalt; }
      n.classList.toggle('leer', !!b.leer);
      n.classList.toggle('aktiv', auswahl === b.key);
      Object.assign(n.style, {
        left: `${(b.x / SEITE.b) * 100}%`, top: `${(b.y / SEITE.h) * 100}%`,
        width: `${Math.max(4, b.b) / SEITE.b * 100}%`, height: `${Math.max(4, b.h) / SEITE.h * 100}%`,
      });
      da.delete(b.key);
    }
    for (const n of da.values()) n.remove();
  }

  function waehlen(key) {
    auswahl = key;
    $$('.re-ziel', root).forEach((n) => n.classList.toggle('aktiv', n.dataset.key === key));
    auswahlZeichnen();
  }

  // Ziehen: verschieben am Rahmen, Größe am Eck.
  const ziele = $('#gsZiele', root);
  ziele.addEventListener('pointerdown', (ev) => {
    const n = ev.target.closest('.re-ziel');
    if (!n) return;
    const key = n.dataset.key;
    const schonGewaehlt = auswahl === key;
    if (!schonGewaehlt) waehlen(key);
    n.focus({ preventScroll: true });
    // Am Telefon wählt das erste Antippen nur aus; so bleibt die Seite scrollbar.
    if (ev.pointerType === 'touch' && !schonGewaehlt) return;
    const b = bereich(key);
    if (!b) return;
    ev.preventDefault();
    const groesse = !!ev.target.closest('[data-griff]');
    const skala = $('#gsBlatt', root).clientWidth / SEITE.b / PT; // Pixel je mm
    const start = { x: ev.clientX, y: ev.clientY };
    const e = element(key);
    const anfang = { x: b.anker.x / PT, y: b.anker.y / PT, b: e ? Number(e.b) : Number(D().logoBreite), h: Number(e?.h) || 0 };
    let bewegt = false;
    try { n.setPointerCapture(ev.pointerId); } catch { /* ohne Fang geht es auch, nur nicht über den Rand hinaus */ }
    const bewegen = (m) => {
      const dx = (m.clientX - start.x) / skala;
      const dy = (m.clientY - start.y) / skala;
      if (!bewegt && Math.hypot(m.clientX - start.x, m.clientY - start.y) < 3) return;
      bewegt = true;
      if (!groesse) positionSetzen(key, anfang.x + dx, anfang.y + dy);
      else if (e) {
        e.b = clamp(halb(anfang.b + dx), 1, 297);
        if (e.art === 'flaeche') e.h = clamp(halb(anfang.h + dy), 0.5, 297);
      } else D().logoBreite = clamp(Math.round(anfang.b + dx), 15, 80);
      zeichnenBald();
    };
    const los = () => {
      window.removeEventListener('pointermove', bewegen);
      window.removeEventListener('pointerup', los);
      window.removeEventListener('pointercancel', los);
      if (bewegt) { merken(); auswahlZeichnen(); }
    };
    window.addEventListener('pointermove', bewegen);
    window.addEventListener('pointerup', los);
    window.addEventListener('pointercancel', los);
  });
  ziele.addEventListener('keydown', (ev) => {
    const n = ev.target.closest('.re-ziel');
    if (!n) return;
    const key = n.dataset.key;
    const schritte = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (schritte[ev.key]) {
      ev.preventDefault();
      if (auswahl !== key) waehlen(key);
      const b = bereich(key);
      if (!b) return;
      const f = ev.shiftKey ? 5 : 1;
      positionSetzen(key, b.anker.x / PT + schritte[ev.key][0] * f, b.anker.y / PT + schritte[ev.key][1] * f);
      geaendert();
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && element(key)) {
      ev.preventDefault();
      elementEntfernen(key);
    } else if (ev.key === 'Escape') {
      waehlen(null);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      waehlen(key);
    }
  });
  $('#gsBlatt', root).addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.re-ziel')) waehlen(null); });

  /* ------------------------------------------------------------------------ */
  /* Elemente                                                                 */
  /* ------------------------------------------------------------------------ */

  async function elementNeu(art) {
    const e = { ...structuredClone(ELEMENT_VORGABE[art]), id: uid('el') };
    if (art === 'flaeche' || art === 'linie') { e.fuellung = e.fuellung && D().akzent; e.farbe = e.farbe && D().akzent; }
    if (art === 'text') e.farbe = D().textfarbe || e.farbe;
    if (art === 'bild') {
      const id = await bildHochladen();
      if (!id) return;
      e.bildId = id;
    }
    D().elemente.push(e);
    auswahl = `el:${e.id}`;
    merken();
    await zeichnen();
    auswahlZeichnen();
    $(`.re-ziel[data-key="${CSS.escape(auswahl)}"]`, root)?.focus({ preventScroll: true });
  }

  function elementEntfernen(key) {
    const e = element(key);
    if (!e) return;
    D().elemente = D().elemente.filter((x) => x !== e);
    auswahl = null;
    geaendert({ panels: true });
  }

  async function bildHochladen({ maxPixel = 1600 } = {}) {
    const datei = await bildWaehlen();
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

  /* ------------------------------------------------------------------------ */
  /* Eingaben                                                                 */
  /* ------------------------------------------------------------------------ */

  const wertAus = (el) => {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.num !== undefined || el.type === 'number' || el.type === 'range') return Number(el.value);
    return el.value;
  };

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.d && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      D()[el.dataset.d] = wertAus(el);
      $$(`[data-wert-von="${el.dataset.d}"]`, root).forEach((x) => { x.textContent = `${el.value} mm`; });
      if (el.dataset.d === 'akzent') $$('[data-farbe]', root).forEach((x) => x.classList.toggle('active', x.dataset.farbe === el.value));
      geaendert();
    } else if (el.dataset.st) {
      D().spaltenTitel = { ...D().spaltenTitel, [el.dataset.st]: el.value };
      geaendert();
    } else if (el.dataset.p) {
      entwurf.profil[el.dataset.p] = el.dataset.p === 'zahlungszielTage' ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value;
      profilHinweise();
      zeichnenBald();
    } else if (el.dataset.e && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      const e = element(auswahl);
      if (!e) return;
      if (el.type === 'number' && el.value === '') return;
      e[el.dataset.e] = wertAus(el);
      geaendert();
    } else if (el.dataset.pos) {
      const b = bereich(auswahl);
      if (!b || el.value === '') return;
      const x = el.dataset.pos === 'x' ? Number(el.value) : b.anker.x / PT;
      const y = el.dataset.pos === 'y' ? Number(el.value) : b.anker.y / PT;
      positionSetzen(auswahl, x, y);
      geaendert();
    }
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.d && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      D()[el.dataset.d] = wertAus(el);
      // Dasselbe Feld kann an zwei Stellen stehen (Auswahl und Karte).
      $$(`[data-d="${el.dataset.d}"]`, root).forEach((x) => { if (x !== el) { if (x.type === 'checkbox') x.checked = el.checked; else x.value = el.value; } });
      geaendert();
    } else if (el.dataset.p && el.tagName === 'SELECT') {
      entwurf.profil[el.dataset.p] = el.value;
      zeichnenBald();
    } else if (el.dataset.e && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      const e = element(auswahl);
      if (!e) return;
      e[el.dataset.e] = wertAus(el);
      geaendert();
    } else if (el.dataset.ohne) {
      const e = element(auswahl);
      if (!e) return;
      const farbfeld = $(`[data-e="${el.dataset.ohne}"]`, $('#gsAuswahl', root));
      e[el.dataset.ohne] = el.checked ? '' : farbfeld.value;
      farbfeld.disabled = el.checked;
      geaendert();
    }
  });

  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button, a');
    if (!t || !root.contains(t)) return;
    // Umschalter (Stil, Ausrichtung …)
    const wert = t.dataset.wert;
    const gruppe = t.parentElement;
    if (wert !== undefined && gruppe?.dataset.seg) {
      D()[gruppe.dataset.seg] = wert;
      if (gruppe.dataset.seg === 'logoPosition' && D().positionen?.kopf) delete D().positionen.kopf;
      $$(`[data-seg="${gruppe.dataset.seg}"] [data-wert]`, root).forEach((x) => x.classList.toggle('active', x.dataset.wert === wert));
      geaendert();
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
    if (t.dataset.farbe) {
      D().akzent = t.dataset.farbe;
      $$('[data-d="akzent"]', root).forEach((x) => { x.value = t.dataset.farbe; });
      $$('[data-farbe]', root).forEach((x) => x.classList.toggle('active', x === t));
      geaendert();
      return;
    }
    if (t.dataset.rf) {
      const liste = D().reihenfolge;
      const i = liste.indexOf(t.dataset.rf);
      const j = i + Number(t.dataset.rfDir);
      if (i < 0 || j < 0 || j >= liste.length) return;
      [liste[i], liste[j]] = [liste[j], liste[i]];
      reihenfolgeZeichnen();
      geaendert();
      return;
    }
    if (t.dataset.platzhalter) {
      const feld = $('[data-e="text"]', $('#gsAuswahl', root));
      const e = element(auswahl);
      if (!feld || !e) return;
      const a = feld.selectionStart ?? feld.value.length;
      feld.value = `${feld.value.slice(0, a)}{${t.dataset.platzhalter}}${feld.value.slice(feld.selectionEnd ?? a)}`;
      e.text = feld.value;
      feld.focus();
      geaendert();
      return;
    }
    if (t.dataset.bildNeu) {
      const feld = t.dataset.bildNeu;
      const id = await bildHochladen({ maxPixel: feld === 'briefpapierId' ? 2480 : 1600 });
      if (!id) return;
      D()[feld] = id;
      if (feld === 'logoId' && D().positionen?.kopf) delete D().positionen.kopf;
      ok(feld === 'logoId' ? 'Logo übernommen' : feld === 'briefpapierId' ? 'Briefpapier übernommen' : 'Bild übernommen', 'Mit „Übernehmen“ gilt es für neue Rechnungen.');
      await bilderKarteZeichnen();
      geaendert();
      return;
    }
    if (t.dataset.bildWeg) {
      // Das alte Bild bleibt im Tresor: Ausgestellte Rechnungen zeigen es weiterhin.
      D()[t.dataset.bildWeg] = '';
      await bilderKarteZeichnen();
      geaendert();
      return;
    }
    if (t.dataset.zuEinst !== undefined) { ev.preventDefault(); navigate('settings'); return; }
    const aw = t.dataset.aw;
    if (!aw) return;
    const e = element(auswahl);
    if (aw === 'zu') waehlen(null);
    else if (aw === 'standard') { delete D().positionen[auswahl]; geaendert({ panels: true }); }
    else if (aw === 'weg') elementEntfernen(auswahl);
    else if (aw === 'kopie' && e) {
      const kopie = { ...structuredClone(e), id: uid('el'), x: halb(Number(e.x) + 5), y: halb(Number(e.y) + 5) };
      D().elemente.push(kopie);
      auswahl = `el:${kopie.id}`;
      geaendert({ panels: true });
    } else if (aw === 'bild' && e) {
      const id = await bildHochladen();
      if (id) { e.bildId = id; geaendert(); }
    }
  });

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
      text: 'Verschobene Teile kommen an ihre Standardstelle, eigene Texte, Bilder, Flächen und Linien werden entfernt, Reihenfolge und Spalten wie am Anfang. Logo, Farben und Ihre Angaben bleiben.',
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
    tabelleZeichnen();
    reihenfolgeZeichnen();
    kopfFussZeichnen();
    auswahlZeichnen();
    zeichnen().then(auswahlZeichnen);
  }

  allesZeichnen();
  angabenZeichnen();
  verlaufKnoepfe();
  if (params.abschnitt === 'angaben') setTimeout(() => $('#gsAngaben', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
