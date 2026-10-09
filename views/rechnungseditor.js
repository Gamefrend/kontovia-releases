/**
 * Kontovia – eine Rechnung oder Vorlage bearbeiten.
 *
 * Alles lässt sich frei eintragen: Kunde und Positionen müssen nicht aus den
 * Stammdaten kommen, Einheiten nicht aus der Liste. Pflichtangaben stehen
 * rechts als Liste; speichern geht immer, ausstellen nach Rückfrage auch mit
 * Lücken (etwa wenn eine Angabe noch fehlt und später korrigiert wird).
 *
 * Links das Formular, rechts die Vorschau. Die Vorschau ist dieselbe Seite
 * wie im PDF (lib/rechnungsdruck.js → lib/pdfvorschau.js).
 */

import { esc, html, raw, $, $$, money, moneyInput, parseMoney, todayISO, uid, debounce, daysBetween, dz, fmtDate } from '../lib/util.js';
import { TURNUS } from '../lib/wiederkehrend.js';
import { ratenPlan, ratenAnzahl, MAX_RATEN } from '../lib/raten.js';
import { sprache } from '../lib/sprache.js';
import { icon, modal, confirmDialog, ok, warn, err } from '../lib/ui.js';
import { store, sel, commit, upsertEntity, nextInvoiceNumber } from '../lib/store.js';
import { router, navigate } from '../lib/router.js';
import { openMenu } from '../lib/popover.js';
import {
  EINHEITEN, ARTEN, STEUERFAELLE, ZAHLUNGSARTEN, LAENDER, laenderSortiert, berechnen, pruefen, vollstaendig, verkaeuferAus, neuePosition,
  einheitAusText, einheitText, positionLeer, anschriftAusText, kaeuferAusKontakt, faelligkeit, zahlungsText, betragText, satzText,
  titel as titelVon, profil as profilAus, istGutschrift,
} from '../lib/rechnung.js';
import {
  rechnungSpeichern, entwurfLoeschen, ausstellen, vergebeneNummern, alsVorlage, produktSpeichern,
} from '../lib/rechnungsaktionen.js';
import { vorschauDaten, pdfZeigen, bildWaehlen, bildAblegen, bildHolen, rahmenVon } from '../lib/rechnungsdateien.js';
import { DOKUMENT_SPRACHEN } from '../lib/dokumenttexte.js';
import { textDirektBearbeiten, bilderAusZwischenablage } from '../lib/textbearbeiten.js';

const BEREICH_TITEL = { kaeufer: 'Kunde', rechnung: 'Rechnung', positionen: 'Positionen', zahlung: 'Zahlung', verkaeufer: 'Ihre Angaben' };

/** Wert unter einem Pfad wie „kaeufer.name“ lesen und setzen. */
const lesen = (o, pfad) => pfad.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setzen(o, pfad, wert) {
  const teile = pfad.split('.');
  const letzter = teile.pop();
  const ziel = teile.reduce((x, k) => (x[k] ??= {}), o);
  ziel[letzter] = wert;
}

const optionen = (paare, wert) => paare.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(wert) ? 'selected' : ''}>${esc(t)}</option>`).join('');

/**
 * @param {HTMLElement} root
 * @param {{rechnung?:object, vorlage?:object}} quelle  eine Rechnung (Entwurf) oder eine Vorlage {id, name, daten}
 * @param {HTMLElement} actions  Platz für Knöpfe in der Kopfzeile
 */
export function editorZeigen(root, { rechnung = null, vorlage = null }, actions) {
  const istVorlage = !!vorlage;
  const s = store.db.settings;
  // Arbeitskopie: Geändert wird erst mit „Speichern“.
  const r = istVorlage
    ? { ...structuredClone(vorlage.daten || {}), kaeufer: structuredClone(vorlage.daten?.kaeufer || {}), positionen: structuredClone(vorlage.daten?.positionen || []) }
    : structuredClone(rechnung);
  if (!Array.isArray(r.positionen)) r.positionen = [];
  if (!Array.isArray(r.bilder)) r.bilder = [];
  r.kaeufer ??= {};
  r.kaeufer.land ??= 'DE';
  if (!r.positionen.length) r.positionen.push(neuePosition(s));
  let vorlageName = vorlage?.name || '';
  let gespeichert = JSON.stringify(r);
  const geaendert = () => JSON.stringify(r) !== gespeichert || (istVorlage && vorlageName !== (vorlage?.name || ''));

  router.leaveGuard = async () => {
    if (!geaendert()) return true;
    const wahl = await fragenVerlassen();
    if (wahl === 'speichern') { await speichern({ still: true }); return true; }
    return wahl === 'verwerfen';
  };

  actions.innerHTML = `<button class="btn" id="reZurueck">${icon('left', 16).__raw} Zur Übersicht</button>`;
  $('#reZurueck', actions).addEventListener('click', () => navigate('rechnungen', { tab: istVorlage ? 'vorlagen' : 'ausgang' }));

  const kontakte = [...sel.contacts()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  const steuerfrei = () => !!(STEUERFAELLE[r.steuerfall] || STEUERFAELLE.standard).kategorie;

  /* ------------------------------------------------------------------------ */
  /* Gerüst                                                                   */
  /* ------------------------------------------------------------------------ */

  root.innerHTML = `
    <div class="re-editor">
      <div class="re-form">
        ${istVorlage ? `<div class="card"><div class="card-body">
          <div class="field mb0"><label for="reVorlageName">Name der Vorlage</label>
          <input id="reVorlageName" value="${esc(vorlageName)}" placeholder="z. B. Monatliche Wartung"></div></div></div>` : ''}
        <section class="card" id="reKunde" data-bereich="kaeufer"></section>
        <section class="card" id="reAngaben" data-bereich="rechnung"></section>
        <section class="card" id="rePositionen" data-bereich="positionen"></section>
        <section class="card" id="reTexte"></section>
        <section class="card" id="reBilder"></section>
        <section class="card" id="reZahlung" data-bereich="zahlung"></section>
        ${istVorlage ? '' : '<section class="card" id="reWiederholung"></section>'}
      </div>
      <aside class="re-seitenspalte">
        <div class="card re-check" id="reCheck"></div>
        <div class="row between re-vorschau-kopf"><span class="small muted">Vorschau</span>
          <button type="button" class="btn sm ghost" id="reZurGestaltung">${icon('layout', 14).__raw} Aussehen ändern</button></div>
        <div class="re-vorschau" id="reVorschau" aria-label="Vorschau"></div>
      </aside>
    </div>
    <div class="re-leiste" id="reLeiste"></div>`;

  if (istVorlage) $('#reVorlageName', root).addEventListener('input', (e) => { vorlageName = e.target.value; });
  $('#reZurGestaltung', root).addEventListener('click', () => navigate('rechnungen', { tab: 'gestaltung' }));

  /* ------------------------------------------------------------------------ */
  /* Kunde                                                                    */
  /* ------------------------------------------------------------------------ */

  function kundeZeichnen() {
    const k = r.kaeufer;
    const laender = laenderSortiert().map(([c, l]) => [c, `${l.name}`]);
    if (k.land && !LAENDER[k.land]) laender.push([k.land, k.land]);
    const kontakt = k.kontaktId ? sel.contact(k.kontaktId) : null;
    $('#reKunde', root).innerHTML = `
      <div class="card-head"><h2>${icon('users', 16).__raw} Kunde</h2><div class="spacer"></div>
        <button type="button" class="btn sm" id="reKontaktWahl">${icon('search', 14).__raw} Aus Kontakten</button>
        <button type="button" class="btn sm ghost" id="reAnschriftText" title="Eine Anschrift aus einer E-Mail oder einem Dokument einfügen">${icon('copy', 14).__raw} Anschrift einfügen</button>
      </div>
      <div class="card-body">
        ${kontakt ? `<div class="re-kontakt-chip"><span>Aus Kontakt <strong>${esc(kontakt.name)}</strong></span>
          <button type="button" class="btn sm ghost" id="reKontaktLos" title="Verbindung zum Kontakt lösen">${icon('x', 13).__raw}</button></div>` : ''}
        <div class="form-grid">
          <div class="field full"><label for="rk_name">Name oder Firma <span class="re-pflicht">Pflicht</span></label>
            <input id="rk_name" data-f="kaeufer.name" value="${esc(k.name || '')}" autocomplete="off"></div>
          <div class="field full"><label for="rk_zusatz">Zusatz <span class="hint">z. Hd., Abteilung</span></label>
            <input id="rk_zusatz" data-f="kaeufer.zusatz" value="${esc(k.zusatz || '')}"></div>
          <div class="field full"><label for="rk_strasse">Straße und Hausnummer <span class="re-pflicht">Pflicht</span></label>
            <input id="rk_strasse" data-f="kaeufer.strasse" value="${esc(k.strasse || '')}"></div>
          <div class="re-plzort full">
            <div class="field"><label for="rk_plz">PLZ <span class="re-pflicht">Pflicht</span></label><input id="rk_plz" data-f="kaeufer.plz" value="${esc(k.plz || '')}" inputmode="numeric"></div>
            <div class="field"><label for="rk_ort">Ort <span class="re-pflicht">Pflicht</span></label><input id="rk_ort" data-f="kaeufer.ort" value="${esc(k.ort || '')}"></div>
          </div>
          <div class="field"><label for="rk_land">Land</label><select id="rk_land" data-f="kaeufer.land">${optionen(laender, k.land || 'DE')}</select></div>
          <div class="field"><label for="rk_email">E-Mail für Rechnungen</label><input id="rk_email" type="email" data-f="kaeufer.email" value="${esc(k.email || '')}"></div>
          <div class="field"><label for="rk_ustId">USt-IdNr.</label><input id="rk_ustId" data-f="kaeufer.ustId" value="${esc(k.ustId || '')}" placeholder="nur bei Firmenkunden"></div>
          <div class="field"><label for="rk_kundennummer">Kundennummer</label><input id="rk_kundennummer" data-f="kaeufer.kundennummer" value="${esc(k.kundennummer || '')}"></div>
          <div class="field full"><label for="rk_leitwegId">Leitweg-ID</label><input id="rk_leitwegId" data-f="kaeufer.leitwegId" value="${esc(k.leitwegId || '')}" placeholder="nur bei Behörden, z. B. 04011000-12345-67">
            <span class="hint">Öffentliche Auftraggeber nennen sie im Auftrag. Mit ihr entsteht eine XRechnung.</span></div>
        </div>
        <div class="row wrap mt8"><button type="button" class="btn sm ghost" id="reKontaktSpeichern">${icon('save', 14).__raw} ${kontakt ? 'Kontakt aktualisieren' : 'Als Kontakt speichern'}</button></div>
      </div>`;
    $('#reKontaktWahl', root).addEventListener('click', (e) => kontaktWaehlen(e.currentTarget));
    $('#reAnschriftText', root).addEventListener('click', anschriftEinfuegen);
    $('#reKontaktLos', root)?.addEventListener('click', () => { r.kaeufer.kontaktId = ''; kundeZeichnen(); aktualisieren(); });
    $('#reKontaktSpeichern', root).addEventListener('click', kontaktSpeichern);
  }

  function kontaktWaehlen(anker) {
    if (!kontakte.length) { warn('Noch keine Kontakte', 'Tragen Sie den Kunden einfach direkt ein. Mit „Als Kontakt speichern“ steht er beim nächsten Mal hier.'); return; }
    const kunden = kontakte.filter((c) => c.kind !== 'supplier');
    const andere = kontakte.filter((c) => c.kind === 'supplier');
    const opt = (c) => ({ value: c.id, label: c.name, sub: [c.city || anschriftAusText(c.address || '').ort, c.email].filter(Boolean).join(' · ') });
    openMenu(anker, {
      label: 'Kontakt wählen',
      sections: [
        { key: 'k', title: 'Kunden', value: r.kaeufer.kontaktId, search: true, options: [{ value: '', label: 'Freie Eingabe ohne Kontakt' }, ...kunden.map(opt)] },
        andere.length ? { key: 'k', title: 'Lieferanten', value: r.kaeufer.kontaktId, options: andere.map(opt) } : null,
      ],
      onPick: (_k, id) => {
        if (!id) { r.kaeufer.kontaktId = ''; kundeZeichnen(); aktualisieren(); return; }
        const neu = kaeuferAusKontakt(sel.contact(id));
        r.kaeufer = { ...neu, leitwegId: neu.leitwegId || r.kaeufer.leitwegId || '' };
        kundeZeichnen();
        aktualisieren();
      },
    });
  }

  function anschriftEinfuegen() {
    const m = modal({
      title: 'Anschrift einfügen',
      body: `<p class="mt0 small muted">Fügen Sie die Anschrift ein, wie sie in einer E-Mail, einer Bestellung oder einer Signatur steht.
        Kontovia verteilt sie auf die Felder; prüfen Sie das Ergebnis danach.</p>
        <textarea id="reAnschriftRoh" rows="7" placeholder="Muster GmbH&#10;z. Hd. Frau Beispiel&#10;Hauptstraße 1&#10;12345 Musterstadt"></textarea>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      const a = anschriftAusText(m.root.querySelector('#reAnschriftRoh').value);
      for (const f of ['name', 'zusatz', 'strasse', 'plz', 'ort', 'land', 'email', 'ustId']) if (a[f]) r.kaeufer[f] = a[f];
      m.close();
      kundeZeichnen();
      aktualisieren();
    });
  }

  async function kontaktSpeichern() {
    const k = r.kaeufer;
    if (!String(k.name || '').trim()) { warn('Bitte zuerst einen Namen eintragen'); return; }
    const alt = k.kontaktId ? sel.contact(k.kontaktId) : null;
    const anschrift = [k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' '), k.land && k.land !== 'DE' ? LAENDER[k.land]?.name || k.land : '']
      .filter(Boolean).join('\n');
    const c = {
      ...(alt ? structuredClone(alt) : { id: uid('con'), kind: 'customer', phone: '', notes: '' }),
      name: k.name.trim(),
      email: k.email || alt?.email || '',
      address: anschrift,
      addressExtra: k.zusatz || '',
      street: k.strasse || '',
      zip: k.plz || '',
      city: k.ort || '',
      country: k.land || 'DE',
      vatId: k.ustId || '',
      taxId: alt?.taxId || k.ustId || '',
      buyerReference: k.leitwegId || '',
      customerNumber: k.kundennummer || '',
    };
    await upsertEntity('contacts', c, 'kontakt');
    r.kaeufer.kontaktId = c.id;
    if (!kontakte.some((x) => x.id === c.id)) kontakte.push(c);
    ok(alt ? 'Kontakt aktualisiert' : 'Kontakt gespeichert', c.name);
    kundeZeichnen();
  }

  /* ------------------------------------------------------------------------ */
  /* Angaben                                                                  */
  /* ------------------------------------------------------------------------ */

  function angabenZeichnen() {
    const bezugNoetig = r.art === '384' || r.art === '381' || r.storno;
    const p = profilAus(s);
    const vorschlag = istVorlage ? '' : `wird beim Ausstellen vergeben${p.praefix ? ` (${p.praefix}…)` : ''}`;
    $('#reAngaben', root).innerHTML = `
      <div class="card-head"><h2>${icon('file', 16).__raw} Rechnung</h2></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label for="ra_art">Art</label><select id="ra_art" data-f="art">${optionen(['380', '326', '384', '381'].map((k) => [k, ARTEN[k]]), r.art || '380')}</select></div>
          <div class="field"><label for="ra_steuerfall">Umsatzsteuer</label><select id="ra_steuerfall" data-f="steuerfall">
            ${optionen(Object.entries(STEUERFAELLE).map(([k, f]) => [k, f.name]), r.steuerfall || 'standard')}</select></div>
          <div class="field"><label for="ra_sprache">Sprache der Rechnung</label><select id="ra_sprache" data-f="sprache">${optionen(DOKUMENT_SPRACHEN.map((l) => [l.code, l.name]), r.sprache === 'en' ? 'en' : 'de')}</select></div>
          ${r.steuerfall === 'steuerfrei' ? `<div class="field full"><label for="ra_grund">Grund der Steuerbefreiung <span class="re-pflicht">Pflicht</span></label>
            <input id="ra_grund" data-f="befreiungsgrund" value="${esc(r.befreiungsgrund || '')}" placeholder="z. B. Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG"></div>` : ''}
          ${istVorlage ? '' : `
          <div class="field"><label for="ra_nummer">Rechnungsnummer</label><input id="ra_nummer" data-f="nummer" value="${esc(r.nummer || '')}" placeholder="${esc(vorschlag)}"></div>
          <div class="field"><label for="ra_datum">Rechnungsdatum <span class="re-pflicht">Pflicht</span></label><input id="ra_datum" type="date" data-f="datum" value="${esc(r.datum || '')}"></div>`}
          <div class="field full">
            <label>Leistung erbracht <span class="re-pflicht">Pflicht</span></label>
            <div class="row wrap" style="gap:8px">
              <div class="seg sm" role="group" aria-label="Leistungsdatum oder Zeitraum">
                <button type="button" data-leistung="datum" class="${r.leistungArt !== 'zeitraum' ? 'active' : ''}">am</button>
                <button type="button" data-leistung="zeitraum" class="${r.leistungArt === 'zeitraum' ? 'active' : ''}">im Zeitraum</button>
              </div>
              ${istVorlage ? '<span class="small muted">Das Datum kommt beim Erstellen der Rechnung dazu.</span>' : (r.leistungArt === 'zeitraum'
                ? `<input type="date" data-f="leistungVon" value="${esc(r.leistungVon || '')}" aria-label="von" class="re-datum"> <span class="muted">bis</span>
                   <input type="date" data-f="leistungBis" value="${esc(r.leistungBis || '')}" aria-label="bis" class="re-datum">`
                : `<input type="date" data-f="leistungsdatum" value="${esc(r.leistungsdatum || '')}" aria-label="Leistungsdatum" class="re-datum">`)}
            </div>
          </div>
          <div class="field full"><label for="ra_betreff">Betreff</label><input id="ra_betreff" data-f="betreff" value="${esc(r.betreff || '')}" placeholder="z. B. Website-Relaunch, Projekt Herbst"></div>
          <div class="field"><label for="ra_bestellung">Bestellnummer des Kunden</label><input id="ra_bestellung" data-f="bestellnummer" value="${esc(r.bestellnummer || '')}"></div>
          ${bezugNoetig ? `
          <div class="field"><label for="ra_bezug">Bezieht sich auf Rechnung</label><input id="ra_bezug" data-f="bezug.nummer" value="${esc(r.bezug?.nummer || '')}" placeholder="Nummer der ursprünglichen Rechnung"></div>
          <div class="field"><label for="ra_bezugDatum">vom</label><input id="ra_bezugDatum" type="date" data-f="bezug.datum" value="${esc(r.bezug?.datum || '')}"></div>` : ''}
        </div>
        <label class="check mt8" title="Pflicht bei Arbeiten an Haus oder Grundstück für Privatkunden (§ 14 Abs. 4 Nr. 9 UStG)">
          <input type="checkbox" id="ra_aufbewahrung" ${r.hinweisAufbewahrung ? 'checked' : ''}>
          <span>Arbeiten an Haus oder Grundstück für einen Privatkunden <span class="muted">(Hinweis auf die Aufbewahrungspflicht)</span></span>
        </label>
      </div>`;
    $('#ra_aufbewahrung', root).addEventListener('change', (e) => { r.hinweisAufbewahrung = e.target.checked; aktualisieren(); });
    $$('[data-leistung]', root).forEach((b) => b.addEventListener('click', () => {
      r.leistungArt = b.dataset.leistung;
      if (r.leistungArt === 'datum' && !r.leistungsdatum) r.leistungsdatum = r.datum || todayISO();
      angabenZeichnen();
      aktualisieren();
    }));
  }

  /* ------------------------------------------------------------------------ */
  /* Positionen                                                               */
  /* ------------------------------------------------------------------------ */

  const einheitenListe = `<datalist id="reEinheiten">${EINHEITEN.map((e) => `<option value="${esc(e.kurz)}">${esc(e.name)}</option>`).join('')}</datalist>`;

  function positionenZeichnen() {
    const ohneSteuer = steuerfrei();
    const zeilen = r.positionen.map((p, i) => {
      const netto = Math.round((Number(p.menge) || 0) * (Number(p.preis) || 0));
      return `
      <div class="re-pos" data-pos="${esc(p.id)}">
        <div class="re-pos-nr">${i + 1}</div>
        <div class="re-pos-haupt">
          <div class="re-pos-name">
            <input data-p="name" value="${esc(p.name || '')}" placeholder="Bezeichnung, z. B. Beratung" aria-label="Bezeichnung Position ${i + 1}" autocomplete="off">
            <button type="button" class="btn sm ghost" data-produkt="${esc(p.id)}" title="Aus Produkten wählen" aria-label="Aus Produkten wählen">${icon('tag', 14).__raw}</button>
          </div>
          <textarea data-p="beschreibung" rows="1" placeholder="Beschreibung (optional)" aria-label="Beschreibung Position ${i + 1}">${esc(p.beschreibung || '')}</textarea>
          <div class="re-pos-zahlen">
            <label class="re-mini"><span>Menge</span><input data-p="menge" inputmode="decimal" value="${esc(dz(p.menge ?? ''))}"></label>
            <label class="re-mini"><span>Einheit</span><input data-p="einheit" list="reEinheiten" value="${esc(einheitText(p))}" autocomplete="off"></label>
            <label class="re-mini"><span>Preis netto €</span><input data-p="preis" inputmode="decimal" value="${esc(moneyInput(p.preis))}"></label>
            ${ohneSteuer ? '' : `<label class="re-mini"><span>USt</span><select data-p="satz">${optionen([[19, '19 %'], [7, '7 %'], [0, '0 %']].concat([19, 7, 0].includes(Number(p.satz)) ? [] : [[p.satz, satzText(p.satz)]]), Number(p.satz))}</select></label>`}
            <div class="re-mini re-pos-summe"><span>Gesamt</span><strong data-summe="${esc(p.id)}">${esc(money(netto))} €</strong></div>
          </div>
        </div>
        <div class="re-pos-menue">
          <button type="button" class="icon-btn" data-pos-menue="${esc(p.id)}" title="Mehr" aria-label="Weitere Aktionen für Position ${i + 1}">${icon('more', 16).__raw}</button>
        </div>
      </div>`;
    }).join('');
    $('#rePositionen', root).innerHTML = `
      <div class="card-head"><h2>${icon('book', 16).__raw} Positionen</h2><div class="spacer"></div>
        <span class="small muted" id="rePosAnzahl"></span></div>
      <div class="card-body">
        <div class="re-positionen">${zeilen}</div>
        ${einheitenListe}
        <div class="row wrap mt8">
          <button type="button" class="btn sm" id="rePosNeu">${icon('plus', 14).__raw} Position</button>
          <button type="button" class="btn sm" id="rePosProdukt">${icon('tag', 14).__raw} Aus Produkten</button>
        </div>
        <div class="re-summen" id="reSummen"></div>
      </div>`;
    $$('#rePositionen textarea', root).forEach(hoeheAnpassen);
    $('#rePosNeu', root).addEventListener('click', () => {
      r.positionen.push(neuePosition(s, { satz: r.positionen.at(-1)?.satz ?? neuePosition(s).satz }));
      positionenZeichnen();
      aktualisieren();
      $$('#rePositionen [data-p="name"]', root).at(-1)?.focus();
    });
    $('#rePosProdukt', root).addEventListener('click', (e) => produktWaehlen(e.currentTarget, null));
    $$('[data-produkt]', root).forEach((b) => b.addEventListener('click', () => produktWaehlen(b, b.dataset.produkt)));
    $$('[data-pos-menue]', root).forEach((b) => b.addEventListener('click', () => positionMenue(b, b.dataset.posMenue)));
    summenZeichnen();
  }

  function hoeheAnpassen(t) {
    t.style.height = 'auto';
    t.style.height = `${Math.min(220, t.scrollHeight + 2)}px`;
  }

  /** Produkte zum Einfügen: neu als Position oder in eine bestehende Zeile. */
  function produktWaehlen(anker, posId) {
    const produkte = sel.products().filter((p) => p.active !== false);
    if (!produkte.length) {
      warn('Noch keine Produkte', 'Unter Rechnungen → Produkte legen Sie Leistungen mit Preis und Einheit an. Oder: Position ausfüllen und im Menü der Zeile „Als Produkt speichern“.');
      return;
    }
    const gruppen = new Map();
    for (const p of [...produkte].sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'))) {
      const g = String(p.kategorie || '').trim() || 'Ohne Kategorie';
      if (!gruppen.has(g)) gruppen.set(g, []);
      gruppen.get(g).push(p);
    }
    const namen = [...gruppen.keys()].sort((a, b) => (a === 'Ohne Kategorie') - (b === 'Ohne Kategorie') || a.localeCompare(b, 'de'));
    openMenu(anker, {
      label: 'Produkt wählen',
      sections: namen.map((g, i) => ({
        key: 'p', title: g, value: '', search: i === 0,
        options: gruppen.get(g).map((p) => ({
          value: p.id, label: p.name,
          sub: `${betragText(p.preis)} je ${einheitText(p)}${p.artikelnummer ? ` · ${p.artikelnummer}` : ''}`,
        })),
      })),
      onPick: (_k, id) => {
        const p = sel.product(id);
        if (!p) return;
        const werte = {
          produktId: p.id, name: p.name, beschreibung: p.beschreibung || '', einheit: p.einheit || 'C62', einheitText: p.einheitText || '',
          preis: Number(p.preis) || 0, artikelnummer: p.artikelnummer || '',
          ...(steuerfrei() ? {} : { satz: Number(p.satz ?? 19) }),
        };
        const ziel = posId ? r.positionen.find((x) => x.id === posId) : r.positionen.find((x) => positionLeer(x));
        if (ziel) Object.assign(ziel, werte, { menge: ziel.menge || 1 });
        else r.positionen.push(neuePosition(s, { ...werte, menge: 1 }));
        positionenZeichnen();
        aktualisieren();
      },
    });
  }

  function positionMenue(anker, posId) {
    const i = r.positionen.findIndex((p) => p.id === posId);
    const p = r.positionen[i];
    if (!p) return;
    openMenu(anker, {
      label: 'Position',
      align: 'end',
      sections: [{
        key: 'a', value: '',
        options: [
          i > 0 ? { value: 'hoch', label: 'Nach oben' } : null,
          i < r.positionen.length - 1 ? { value: 'runter', label: 'Nach unten' } : null,
          { value: 'kopie', label: 'Duplizieren' },
          { value: 'produkt', label: p.produktId && sel.product(p.produktId) ? 'Produkt aktualisieren' : 'Als Produkt speichern' },
          { value: 'weg', label: 'Entfernen' },
        ].filter(Boolean),
      }],
      onPick: async (_k, was) => {
        if (was === 'hoch' || was === 'runter') {
          const j = was === 'hoch' ? i - 1 : i + 1;
          [r.positionen[i], r.positionen[j]] = [r.positionen[j], r.positionen[i]];
        } else if (was === 'kopie') {
          r.positionen.splice(i + 1, 0, { ...structuredClone(p), id: uid('pos') });
        } else if (was === 'weg') {
          r.positionen.splice(i, 1);
          if (!r.positionen.length) r.positionen.push(neuePosition(s));
        } else if (was === 'produkt') {
          await positionAlsProdukt(p);
          return;
        }
        positionenZeichnen();
        aktualisieren();
      },
    });
  }

  async function positionAlsProdukt(p) {
    if (!String(p.name || '').trim()) { warn('Bitte zuerst eine Bezeichnung eintragen'); return; }
    const alt = p.produktId ? sel.product(p.produktId) : null;
    const prod = {
      ...(alt ? structuredClone(alt) : { id: uid('prod'), kategorie: '', active: true }),
      name: p.name.trim(), beschreibung: p.beschreibung || '', einheit: p.einheit || 'C62', einheitText: p.einheitText || '',
      preis: Number(p.preis) || 0, satz: Number(p.satz ?? 19), artikelnummer: p.artikelnummer || alt?.artikelnummer || '',
    };
    await produktSpeichern(prod);
    p.produktId = prod.id;
    ok(alt ? 'Produkt aktualisiert' : 'Als Produkt gespeichert', prod.name);
  }

  function summenZeichnen() {
    const b = berechnen(r);
    const w = r.waehrung || 'EUR';
    const zeilen = [];
    if (!steuerfrei()) {
      zeilen.push(['Summe netto', betragText(b.netto, w)]);
      for (const g of b.steuern) if (g.satz) zeilen.push([`USt ${satzText(g.satz)} auf ${betragText(g.basis, w)}`, betragText(g.steuer, w), 'muted']);
    }
    zeilen.push(['Gesamtbetrag', betragText(b.brutto, w), 'strong']);
    if (b.bereitsGezahlt) zeilen.push(['Noch zu zahlen', betragText(b.zahlbetrag, w), 'strong']);
    const box = $('#reSummen', root);
    if (box) box.innerHTML = zeilen.map(([l, v, c]) => `<div class="re-summe ${c || ''}"><span>${esc(l)}</span><span class="num">${esc(v)}</span></div>`).join('');
    const n = b.zeilen.length;
    const anz = $('#rePosAnzahl', root);
    if (anz) anz.textContent = n === 1 ? '1 Position' : `${n} Positionen`;
    for (const p of r.positionen) {
      const el = root.querySelector(`[data-summe="${CSS.escape(p.id)}"]`);
      if (el) el.textContent = `${money(Math.round((Number(p.menge) || 0) * (Number(p.preis) || 0)))} €`;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Texte und Zahlung                                                        */
  /* ------------------------------------------------------------------------ */

  function texteZeichnen() {
    $('#reTexte', root).innerHTML = `
      <div class="card-head"><h2>${icon('edit', 16).__raw} Texte</h2><span class="sub">stehen auf dem PDF über und unter den Positionen</span></div>
      <div class="card-body">
        <div class="field"><label for="rt_kopf">Text vor den Positionen</label><textarea id="rt_kopf" data-f="kopftext" rows="3">${esc(r.kopftext || '')}</textarea></div>
        <div class="field mb0"><label for="rt_schluss">Text am Ende</label><textarea id="rt_schluss" data-f="schlusstext" rows="3">${esc(r.schlusstext || '')}</textarea></div>
      </div>`;
    $$('#reTexte textarea', root).forEach(hoeheAnpassen);
  }

  /** Schnelltasten wie in der Buchung: Zahlungsziel in Tagen ab Rechnungsdatum. */
  const SCHNELL = [[0, 'Sofort', 'Zahlbar sofort'], [14, '+14 T', '14 Tage ab Rechnungsdatum'], [30, '+30 T', '30 Tage ab Rechnungsdatum']];
  const schnelltasten = () => SCHNELL.map(([t, label, title]) => `<button type="button" class="btn sm${Number(r.zahlungszielTage) === t && !r.faellig ? ' active' : ''}" data-ziel="${t}" title="${esc(title)}">${esc(label)}</button>`).join('');

  /** Fälligkeit und Zahlungsziel hängen zusammen; geändert wird immer beides. */
  function faelligZeigen() {
    const f = faelligkeit(r);
    const feld = $('#rz_faellig', root);
    if (feld && document.activeElement !== feld) feld.value = f || '';
    const ziel = $('#rz_ziel', root);
    if (ziel && document.activeElement !== ziel) ziel.value = r.zahlungszielTage ?? '';
    const hint = $('#rz_faelligHinweis', root);
    if (hint) hint.textContent = r.faellig ? 'liegt vor dem Rechnungsdatum' : f && r.datum ? `${Number(r.zahlungszielTage) || 0} Tage nach dem Rechnungsdatum` : '';
    $$('[data-ziel]', root).forEach((b) => b.classList.toggle('active', Number(b.dataset.ziel) === Number(r.zahlungszielTage) && !r.faellig));
  }

  function zahlungZeichnen() {
    const gut = istGutschrift(r);
    $('#reZahlung', root).innerHTML = `
      <div class="card-head"><h2>${icon('euro', 16).__raw} Zahlung</h2>${gut ? '<span class="sub">Gutschrift: Sie zahlen an den Kunden</span>' : ''}</div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field"><label for="rz_art">Zahlungsart</label><select id="rz_art" data-f="zahlungsart">${optionen(Object.entries(ZAHLUNGSARTEN).map(([k, z]) => [k, z.name]), r.zahlungsart || 'ueberweisung')}</select></div>
          <div class="field"><label for="rz_ziel">Zahlungsziel in Tagen</label><input id="rz_ziel" type="number" min="0" max="365" data-f="zahlungszielTage" data-zahl value="${esc(r.zahlungszielTage ?? '')}"></div>
          <div class="field full"><label for="rz_faellig">Fällig am</label>
            <div class="row" style="gap:6px">
              ${istVorlage ? '<span class="small muted" style="flex:1">ergibt sich aus dem Rechnungsdatum</span>' : `<input id="rz_faellig" type="date" value="${esc(faelligkeit(r) || '')}" style="flex:1">`}
              ${schnelltasten()}
            </div>
            <span class="hint" id="rz_faelligHinweis"></span></div>
          <div class="field"><label for="rz_bereits">Bereits gezahlt (Anzahlung) €</label><input id="rz_bereits" inputmode="decimal" data-f="bereitsGezahlt" data-geld value="${esc(r.bereitsGezahlt ? moneyInput(r.bereitsGezahlt) : '')}"></div>
          <div class="field"><label for="rz_skontoT">Skonto: innerhalb von Tagen</label><input id="rz_skontoT" type="number" min="0" max="365" data-f="skontoTage" data-zahl value="${esc(r.skontoTage || '')}"></div>
          <div class="field"><label for="rz_skontoP">Skonto in %</label><input id="rz_skontoP" inputmode="decimal" data-f="skontoProzent" data-prozent value="${esc(r.skontoProzent ? dz(r.skontoProzent) : '')}"></div>
          ${gut || istVorlage ? '' : `
          <div class="field"><label for="rz_raten">Zahlung in Raten</label>
            <input id="rz_raten" type="number" min="0" max="${MAX_RATEN}" data-f="raten.anzahl" data-zahl placeholder="keine" value="${esc(r.raten?.anzahl || '')}"></div>
          <div class="field"><label for="rz_ratenFreq">Rhythmus der Raten</label>
            <select id="rz_ratenFreq" data-f="raten.freq">${optionen(Object.entries(TURNUS).map(([k, t]) => [k, t[0]]), r.raten?.freq || 'monthly')}</select></div>
          <div class="field full"><span class="hint" id="rz_ratenHinweis"></span></div>`}
          <div class="field full mb0"><label for="rz_text">Zahlungsbedingungen</label>
            <textarea id="rz_text" data-f="zahlungsbedingungen" rows="2" placeholder="${esc(zahlungsText({ ...r, zahlungsbedingungen: '' }) || 'Werden aus Zahlungsziel und Skonto gebildet')}">${esc(r.zahlungsbedingungen || '')}</textarea>
            <span class="hint">Leer lassen, dann bildet Kontovia den Text aus Zahlungsziel und Skonto.</span></div>
        </div>
      </div>`;
    $$('[data-ziel]', root).forEach((b) => b.addEventListener('click', () => {
      r.zahlungszielTage = Number(b.dataset.ziel);
      r.faellig = '';
      faelligZeigen();
      zahlungsPlatzhalter();
      aktualisieren();
    }));
    $('#rz_faellig', root)?.addEventListener('change', (e) => {
      const wert = e.target.value;
      if (!wert) r.faellig = '';
      else if (r.datum && wert >= r.datum) { r.zahlungszielTage = daysBetween(r.datum, wert); r.faellig = ''; }
      else r.faellig = wert;
      faelligZeigen();
      zahlungsPlatzhalter();
      aktualisieren();
    });
    faelligZeigen();
  }

  function zahlungsPlatzhalter() {
    const t = $('#rz_text', root);
    if (t) t.placeholder = zahlungsText({ ...r, zahlungsbedingungen: '' }) || 'Werden aus Zahlungsziel und Skonto gebildet';
    ratenZeigen();
  }

  /** Was die Raten ergeben: Zahl, Betrag und erster Termin, damit man vor dem Ausstellen sieht, was gebucht wird. */
  function ratenZeigen() {
    const h = $('#rz_ratenHinweis', root);
    if (!h) return;
    const plan = ratenPlan(berechnen(r).zahlbetrag, { anzahl: r.raten?.anzahl, freq: r.raten?.freq, start: faelligkeit(r) || r.datum });
    h.textContent = plan.length
      ? `${plan.length} Raten zu ${money(plan[0].betrag)} €, die erste am ${fmtDate(plan[0].datum)}, die letzte am ${fmtDate(plan[plan.length - 1].datum)}. Jede wird eine eigene Buchung.`
      : 'Leer lassen für eine Zahlung auf einmal. Mit Raten wird jede Rate eine eigene Buchung mit eigener Fälligkeit.';
  }

  /* ------------------------------------------------------------------------ */
  /* Wiederholung                                                             */
  /* ------------------------------------------------------------------------ */

  function wiederholungZeichnen() {
    const box = $('#reWiederholung', root);
    if (!box) return;
    // Eine ausgestellte Wiederholung steht in der Regel; diese Rechnung gehört schon zu ihr.
    const regel = r.wiederkehrendId ? sel.recurringRule(r.wiederkehrendId) : null;
    const w = r.wiederholung || {};
    const aus = !w.freq;
    const turnusOptionen = optionen(Object.entries(TURNUS).map(([k, t]) => [k, t[0]]), w.freq || '');
    const formular = html`
        <div class="form-grid">
          <div class="field"><label for="rw_freq">Rechnung wiederholen</label>
            <select id="rw_freq" data-f="wiederholung.freq"><option value="">nicht wiederholen</option>${raw(turnusOptionen)}</select></div>
          <div class="field"><label for="rw_bis">Endet am (freiwillig)</label>
            <input id="rw_bis" type="date" data-f="wiederholung.bis" value="${w.bis || ''}" ${aus ? 'disabled' : ''}></div>
          <div class="field"><label for="rw_anzahl">Oder nach so vielen Rechnungen (freiwillig)</label>
            <input id="rw_anzahl" type="number" min="0" max="999" data-f="wiederholung.anzahl" data-zahl value="${w.anzahl || ''}" ${aus ? 'disabled' : ''}>
            <span class="hint">Diese Rechnung zählt mit.</span></div>
        </div>
        <p class="hint mt8 mb0">Beim Ausstellen merkt sich Kontovia die Rechnung als Vorlage. Ist der nächste Termin erreicht, legt es einen
          Entwurf an, den Sie prüfen und selbst ausstellen. Nichts wird von allein verschickt.</p>`;
    box.innerHTML = html`
      <div class="card-head"><h2>${icon('refresh', 16)} Wiederholung</h2><span class="sub">für gleichbleibende Rechnungen, etwa Wartung oder Miete</span></div>
      <div class="card-body">${raw(regel
    ? html`<div class="notice small mb0">Diese Rechnung gehört zu einer wiederkehrenden Rechnung (${TURNUS[regel.freq]?.[0] || ''}).
          Den Turnus ändern Sie unter Stammdaten → Wiederkehrend.</div>`
    : formular)}</div>`;
  }

  /* ------------------------------------------------------------------------ */
  /* Bilder dieser Rechnung                                                   */
  /* ------------------------------------------------------------------------ */

  function bilderZeichnen() {
    const box = $('#reBilder', root);
    const liste = r.bilder;
    box.innerHTML = `
      <div class="card-head"><h2>${icon('image', 16).__raw} Bilder</h2><span class="sub">etwa Fotos der Arbeit oder ein Lageplan</span><div class="spacer"></div>
        <button type="button" class="btn sm" id="reBildNeu">${icon('plus', 14).__raw} Bild</button></div>
      ${liste.length ? `<div class="card-body re-bilderliste">${liste.map((e) => `
        <div class="re-rbild" data-rbild="${esc(e.id)}">
          <div class="re-bildfeld"><span class="small muted">lädt …</span></div>
          <div class="stack" style="flex:1;min-width:0">
            <input data-rb="text" value="${esc(e.text || '')}" placeholder="Bildunterschrift (optional)" aria-label="Bildunterschrift">
            <label class="re-regler">Breite <input type="range" min="20" max="165" step="1" data-rb="breite" value="${esc(e.breite || 60)}"> <span data-rbw>${esc(e.breite || 60)} mm</span></label>
          </div>
          <div class="re-rbild-knoepfe">
            <button type="button" class="icon-btn" data-rb-hoch title="Weiter nach vorne" aria-label="Weiter nach vorne">${icon('up', 15).__raw}</button>
            <button type="button" class="icon-btn" data-rb-weg title="Entfernen" aria-label="Bild entfernen">${icon('trash', 15).__raw}</button>
          </div>
        </div>`).join('')}
        <p class="small muted mb0">Die Bilder stehen auf der Rechnung unter den Positionen. Die Stelle legen Sie unter Gestaltung fest.</p></div>` : ''}`;
    $('#reBildNeu', box).addEventListener('click', () => bildHinzufuegen());
    for (const e of liste) {
      const zeile = box.querySelector(`[data-rbild="${CSS.escape(e.id)}"]`);
      bildHolen(e.bildId).then((b) => {
        const feld = zeile?.querySelector('.re-bildfeld');
        if (feld) feld.innerHTML = b ? `<img src="${esc(b.url)}" alt="">` : '<span class="small muted">fehlt</span>';
      });
      zeile.querySelector('[data-rb="text"]').addEventListener('input', (ev) => { e.text = ev.target.value; aktualisieren(); });
      zeile.querySelector('[data-rb="breite"]').addEventListener('input', (ev) => {
        e.breite = Number(ev.target.value);
        zeile.querySelector('[data-rbw]').textContent = `${e.breite} mm`;
        aktualisieren();
      });
      zeile.querySelector('[data-rb-weg]').addEventListener('click', () => { r.bilder = r.bilder.filter((x) => x !== e); bilderZeichnen(); aktualisieren(); });
      zeile.querySelector('[data-rb-hoch]').addEventListener('click', () => {
        const i = r.bilder.indexOf(e);
        if (i > 0) [r.bilder[i - 1], r.bilder[i]] = [r.bilder[i], r.bilder[i - 1]];
        bilderZeichnen();
        aktualisieren();
      });
    }
  }

  async function bildHinzufuegen(vorgabe = null) {
    const datei = vorgabe || await bildWaehlen();
    if (!datei) return;
    try {
      const meta = await bildAblegen(datei);
      await commit('beleg.bild', (db) => { db.attachments.push(meta); }, { silent: true });
      r.bilder.push({ id: uid('rb'), bildId: meta.id, breite: 60, text: '' });
      bilderZeichnen();
      aktualisieren();
    } catch (e) {
      err('Bild nicht übernommen', e.message);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Eingaben                                                                 */
  /* ------------------------------------------------------------------------ */

  function wertAus(el) {
    if (el.dataset.geld !== undefined) return parseMoney(el.value);
    if (el.dataset.zahl !== undefined) return el.value === '' ? 0 : Math.max(0, Math.round(Number(el.value) || 0));
    if (el.dataset.prozent !== undefined) return Math.max(0, Number(String(el.value).replace(',', '.')) || 0);
    return el.value;
  }

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('textarea')) hoeheAnpassen(el);
    if (el.dataset.f) {
      setzen(r, el.dataset.f, wertAus(el));
      if (el.dataset.f === 'zahlungszielTage') r.faellig = '';
      if (el.dataset.f === 'zahlungszielTage' || el.dataset.f === 'datum') { faelligZeigen(); zahlungsPlatzhalter(); }
      if (el.dataset.f.startsWith('raten.')) zahlungsPlatzhalter();
      aktualisieren();
      return;
    }
    const zeile = el.closest('[data-pos]');
    if (zeile && el.dataset.p) {
      const p = r.positionen.find((x) => x.id === zeile.dataset.pos);
      if (!p) return;
      const k = el.dataset.p;
      if (k === 'menge') p.menge = Number(sprache() === 'en' ? String(el.value).replace(/,/g, '') : String(el.value).replace(/\./g, '').replace(',', '.')) || 0;
      else if (k === 'preis') p.preis = parseMoney(el.value);
      else if (k === 'satz') p.satz = Number(el.value);
      else if (k === 'einheit') { const e2 = einheitAusText(el.value); p.einheit = e2.code; p.einheitText = e2.text; }
      else p[k] = el.value;
      summenZeichnen();
      aktualisieren({ summen: false });
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.f === 'steuerfall' || el.dataset.f === 'art') {
      if (el.dataset.f === 'steuerfall' && steuerfrei()) for (const p of r.positionen) p.satz = 0;
      if (el.dataset.f === 'steuerfall' && !steuerfrei()) for (const p of r.positionen) if (!p.satz) p.satz = Number(s.defaultVatRate ?? 19);
      angabenZeichnen();
      positionenZeichnen();
      aktualisieren();
    }
    if (el.dataset.f === 'zahlungsart' || el.dataset.f === 'art') zahlungZeichnen();
    if (el.dataset.f === 'wiederholung.freq') {
      for (const id of ['#rw_bis', '#rw_anzahl']) { const f = $(id, root); if (f) f.disabled = !el.value; }
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Prüfung, Vorschau, Leiste                                                */
  /* ------------------------------------------------------------------------ */

  function pruefliste() {
    const liste = pruefen(r, verkaeuferAus(s), { nummern: istVorlage ? null : vergebeneNummern(r.id) });
    // In einer Vorlage fehlen Daten und Kunde naturgemäß.
    return istVorlage ? liste.filter((x) => x.bereich === 'positionen' || x.bereich === 'verkaeufer') : liste;
  }

  function pruefungZeichnen() {
    const liste = pruefliste();
    const pflicht = liste.filter((x) => x.stufe === 'pflicht');
    const hinweise = liste.filter((x) => x.stufe === 'hinweis');
    const xr = liste.filter((x) => x.stufe === 'xrechnung');
    const behoerde = !!String(r.kaeufer?.leitwegId || '').trim();
    const zeile = (x) => `<li><button type="button" class="re-check-link" data-springe="${esc(x.bereich)}">${esc(x.text)}</button></li>`;
    const box = $('#reCheck', root);
    box.innerHTML = `
      <div class="re-check-kopf ${pflicht.length ? 'warn' : 'gut'}">
        ${icon(pflicht.length ? 'alert' : 'check', 16).__raw}
        <strong>${pflicht.length ? `${pflicht.length === 1 ? 'Eine Pflichtangabe fehlt' : `${pflicht.length} Pflichtangaben fehlen`}` : 'Alle Pflichtangaben sind da'}</strong>
      </div>
      ${pflicht.length ? `<ul class="re-check-liste">${pflicht.map(zeile).join('')}</ul>` : `<p class="small muted mt0 mb0">${istVorlage ? 'Positionen und Ihre Angaben sind vollständig. Kunde und Datum kommen beim Erstellen der Rechnung dazu.' : 'Die Rechnung erfüllt § 14 UStG und ergibt eine gültige E-Rechnung.'}</p>`}
      ${hinweise.length ? `<details class="re-check-mehr"><summary>${hinweise.length === 1 ? 'Ein Hinweis' : `${hinweise.length} Hinweise`}</summary><ul class="re-check-liste">${hinweise.map(zeile).join('')}</ul></details>` : ''}
      ${xr.length && (behoerde || !pflicht.length) ? `<details class="re-check-mehr"${behoerde ? ' open' : ''}><summary>Für eine XRechnung an Behörden ${xr.length === 1 ? 'fehlt eine Angabe' : `fehlen ${xr.length} Angaben`}</summary>
        <ul class="re-check-liste">${xr.map(zeile).join('')}</ul></details>` : ''}`;
    $$('[data-springe]', box).forEach((b) => b.addEventListener('click', () => springen(b.dataset.springe)));
    return liste;
  }

  function springen(bereich) {
    if (bereich === 'verkaeufer') { navigate('rechnungen', { tab: 'gestaltung', abschnitt: 'angaben' }); return; }
    const ziel = root.querySelector(`[data-bereich="${CSS.escape(bereich)}"]`);
    ziel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => ziel?.querySelector('input:not([type="hidden"]), select, textarea')?.focus({ preventScroll: true }), 300);
  }

  let vorschauLaeuft = 0;
  /** Die Teile der ersten Seite (Lage in Punkt), damit ein Doppelklick auf einen Text weiß, was er trifft. */
  let vorschauBereiche = [];
  const vorschauNeu = debounce(async () => {
    const nr = ++vorschauLaeuft;
    const host = $('#reVorschau', root);
    if (!host) return;
    try {
      const { svgs, bereiche } = await vorschauDaten(istVorlage ? { ...r, nummer: '', datum: todayISO(), leistungsdatum: todayISO() } : r);
      if (nr !== vorschauLaeuft || !host.isConnected) return;
      vorschauBereiche = bereiche;
      host.innerHTML = svgs.map((svg, i) => `<div class="re-blatt" title="Seite ${i + 1}">${svg}</div>`).join('');
    } catch (e) {
      host.innerHTML = `<div class="notice small">Die Vorschau ließ sich nicht erstellen: ${esc(e.message)}</div>`;
    }
  }, 350);

  function leisteZeichnen() {
    const liste = pruefliste();
    const b = berechnen(r);
    $('#reLeiste', root).innerHTML = `
      <div class="re-leiste-info">
        <strong class="num">${esc(betragText(b.brutto, r.waehrung))}</strong>
        <span class="small muted">${istVorlage ? 'Vorlage' : vollstaendig(liste) ? 'vollständig' : 'Pflichtangaben fehlen'}</span>
      </div>
      <div class="spacer"></div>
      ${!istVorlage && sel.invoice(r.id) ? `<button type="button" class="btn ghost danger-text" id="reLoeschen" title="Entwurf löschen">${icon('trash', 15).__raw}<span class="re-weg-schmal">Löschen</span></button>` : ''}
      ${istVorlage ? '' : `<button type="button" class="btn" id="reAlsVorlage">${icon('copy', 15).__raw}<span class="re-weg-schmal">Als Vorlage</span></button>
      <button type="button" class="btn" id="rePdf">${icon('pdf', 15).__raw}<span class="re-weg-schmal">PDF</span></button>`}
      <button type="button" class="btn" id="reSpeichern">${icon('save', 15).__raw} Speichern</button>
      ${istVorlage ? '' : `<button type="button" class="btn primary" id="reAusstellen">${icon('check', 15).__raw} Ausstellen</button>`}`;
    $('#reSpeichern', root).addEventListener('click', () => speichern());
    $('#reLoeschen', root)?.addEventListener('click', loeschen);
    $('#reAlsVorlage', root)?.addEventListener('click', vorlageAnlegen);
    $('#rePdf', root)?.addEventListener('click', async () => {
      try { await pdfZeigen(r); } catch (e) { err('PDF nicht erstellt', e.message); }
    });
    $('#reAusstellen', root)?.addEventListener('click', ausstellenFragen);
  }

  function aktualisieren({ summen = true } = {}) {
    if (summen) summenZeichnen();
    ratenZeigen();
    pruefungZeichnen();
    leisteZeichnen();
    vorschauNeu();
  }

  /* ------------------------------------------------------------------------ */
  /* Speichern, Ausstellen                                                    */
  /* ------------------------------------------------------------------------ */

  async function speichern({ still = false } = {}) {
    if (istVorlage) {
      const daten = structuredClone(r);
      daten.positionen = daten.positionen.filter((p) => !positionLeer(p));
      if (!String(daten.kaeufer?.name || '').trim()) delete daten.kaeufer;
      await upsertEntity('invoiceTemplates', { ...structuredClone(vorlage), name: vorlageName.trim() || 'Vorlage', daten }, 'rechnungsvorlage');
      vorlage.name = vorlageName.trim() || 'Vorlage';
    } else {
      await rechnungSpeichern(structuredClone(r));
    }
    gespeichert = JSON.stringify(r);
    if (!still) ok(istVorlage ? 'Vorlage gespeichert' : 'Entwurf gespeichert');
    leisteZeichnen();
  }

  async function loeschen() {
    const yes = await confirmDialog({ title: 'Entwurf löschen?', text: 'Der Entwurf wird entfernt. Eine Nummer wurde noch nicht vergeben.', confirmLabel: 'Löschen', danger: true });
    if (!yes) return;
    await entwurfLoeschen(r.id);
    router.leaveGuard = null;
    ok('Entwurf gelöscht');
    navigate('rechnungen', { tab: 'ausgang' });
  }

  function vorlageAnlegen() {
    const m = modal({
      title: 'Als Vorlage speichern',
      size: 'slim',
      body: `<div class="field"><label for="reVName">Name der Vorlage</label><input id="reVName" value="${esc(r.betreff || '')}" placeholder="z. B. Monatliche Wartung"></div>
        <label class="check"><input type="checkbox" id="reVKunde" ${r.kaeufer?.name ? 'checked' : ''}> Kunde mit speichern</label>
        <p class="small muted mb0">Gespeichert werden Positionen, Texte und Zahlungsbedingungen. Datum und Nummer kommen beim Erstellen der Rechnung neu dazu.</p>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const name = m.root.querySelector('#reVName').value.trim();
      if (!name) { warn('Bitte einen Namen eintragen'); return; }
      await alsVorlage(r, { name, mitKunde: m.root.querySelector('#reVKunde').checked });
      m.close();
      ok('Vorlage gespeichert', name);
    });
  }

  async function ausstellenFragen() {
    const liste = pruefliste();
    const pflicht = liste.filter((x) => x.stufe === 'pflicht');
    if (pflicht.length) {
      const weiter = await new Promise((resolve) => {
        let antwort = false;
        const m = modal({
          title: pflicht.length === 1 ? 'Eine Pflichtangabe fehlt' : `${pflicht.length} Pflichtangaben fehlen`,
          body: `<p class="mt0">Ohne diese Angaben erfüllt die Rechnung die gesetzlichen Vorgaben nicht, und die E-Rechnung kann beim Empfänger abgelehnt werden:</p>
            <ul class="re-check-liste">${pflicht.map((x) => `<li>${esc(BEREICH_TITEL[x.bereich] || '')}: ${esc(x.text)}</li>`).join('')}</ul>
            <p class="small muted mb0">Sie können trotzdem ausstellen, etwa wenn eine Angabe noch nicht bekannt ist. Nachtragen lässt sich das dann
            mit einer Korrektur der Rechnung.</p>`,
          foot: '<button class="btn" data-no>Zurück zur Rechnung</button><button class="btn danger" data-yes>Trotzdem ausstellen</button>',
          onClose: () => resolve(antwort),
        });
        m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
        m.root.querySelector('[data-yes]').addEventListener('click', () => { antwort = true; m.close(); });
      });
      if (!weiter) return;
    }
    const b = berechnen(r);
    const konten = sel.accounts();
    const p = profilAus(s);
    const raten = ratenAnzahl(r.raten?.anzahl) > 1 && !istGutschrift(r);
    let antwort = null;
    const m = modal({
      title: `${titelVon(r)} ausstellen`,
      body: `
        <div class="kpi-list mb16">
          <div><div class="k">Nummer</div><div class="v">${esc(String(r.nummer || '').trim() || nextInvoiceNumber(Number(String(r.datum || todayISO()).slice(0, 4)), p.praefix))}</div></div>
          <div><div class="k">Kunde</div><div class="v">${esc(r.kaeufer?.name || '–')}</div></div>
          <div><div class="k">Betrag</div><div class="v">${esc(betragText(b.brutto, r.waehrung))}</div></div>
        </div>
        <p class="mt0">Danach steht die Rechnung fest: Kontovia legt das PDF mit der E-Rechnung und die XRechnung unverändert ab.
          Ändern lässt sie sich dann nur noch durch Stornieren oder Korrigieren.</p>
        <label class="check"><input type="checkbox" id="reBuchen" checked> ${istGutschrift(r) ? 'Als Minderung der Einnahmen buchen' : 'Als offene Einnahme buchen'}${raten ? ` (je Rate eine Buchung${b.steuern.length > 1 ? ' und Steuersatz' : ''})` : (b.steuern.length > 1 ? ` (je Steuersatz eine Buchung)` : '')}</label>
        <div id="reBuchenOpt" class="form-grid mt8">
          <div class="field"><label for="reKonto">Zahlungskonto</label><select id="reKonto">${optionen(konten.map((k) => [k.id, k.name]), konten[0]?.id || '')}</select></div>
          <div class="field"><label for="reBezahlt">Schon bezahlt am</label><input type="date" id="reBezahlt" value="${r.zahlungsart === 'bar' ? esc(r.datum || todayISO()) : ''}">
            <span class="hint">${raten ? 'gilt für die erste Rate; leer lassen, wenn sie noch aussteht' : 'leer lassen, wenn die Zahlung noch aussteht'}</span></div>
        </div>`,
      foot: `<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('check', 15).__raw} Rechnung ausstellen</button>`,
      onClose: () => {},
    });
    const opt = m.root.querySelector('#reBuchenOpt');
    m.root.querySelector('#reBuchen').addEventListener('change', (e) => { opt.hidden = !e.target.checked; });
    m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-yes]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      antwort = {
        buchen: m.root.querySelector('#reBuchen').checked,
        kontoId: m.root.querySelector('#reKonto')?.value || '',
        bezahlt: m.root.querySelector('#reBezahlt')?.value || '',
      };
      try {
        const fertig = await ausstellen(r, antwort);
        m.close();
        gespeichert = JSON.stringify(r);
        router.leaveGuard = null;
        ok(`${titelVon(fertig)} ${fertig.nummer} ausgestellt`, antwort.buchen ? 'Die Einnahme ist gebucht.' : '');
        navigate('rechnungen', { id: fertig.id }, { ersetzen: true });
      } catch (ex) {
        e.currentTarget.disabled = false;
        err('Nicht ausgestellt', ex.message);
      }
    });
  }

  /* ------------------------------------------------------------------------ */

  // Strg+V mit einem Bild in der Zwischenablage: es kommt zu den Bildern dieser Rechnung.
  const einfuegen = (ev) => {
    if (!root.isConnected) { document.removeEventListener('paste', einfuegen); return; }
    const bilder = bilderAusZwischenablage(ev);
    if (!bilder.length) return;
    ev.preventDefault();
    bildHinzufuegen(bilder[0]).then(() => ok('Bild eingefügt', 'Es steht unter den Positionen.'));
  };
  document.addEventListener('paste', einfuegen);

  /* Doppelklick auf den Text vor oder nach den Positionen: direkt auf der Vorschau ändern.
     Der Wert steht danach in der Rechnung selbst, im Textfeld links und in der E-Rechnung,
     denn alle drei kommen aus denselben Daten (r). */
  let direkt = null;
  $('#reVorschau', root).addEventListener('dblclick', (ev) => {
    const blatt = ev.target.closest('.re-blatt');
    if (!blatt || blatt !== $('#reVorschau .re-blatt', root)) return;
    const rect = blatt.getBoundingClientRect();
    const px = rect.width / 595.28;
    const x = (ev.clientX - rect.left) / px;
    const y = (ev.clientY - rect.top) / px;
    const b = vorschauBereiche.find((q) => (q.key === 'kopftext' || q.key === 'schlusstext') && x >= q.x && x <= q.x + q.b && y >= q.y && y <= q.y + q.h);
    if (!b) return;
    const feldName = b.key;
    const host = $('.re-seitenspalte', root);
    const vorher = host.style.position;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const hr = host.getBoundingClientRect();
    direkt?.ende(false);
    direkt = textDirektBearbeiten(host, {
      x: rect.left - hr.left + host.scrollLeft + b.x * px, y: rect.top - hr.top + host.scrollTop + b.y * px, b: b.b * px, h: b.h * px,
      schrift: (Number(rahmenVon(r).d.schriftgroesse) || 9.5) * px,
      text: r[feldName] || '',
      farbe: rahmenVon(r).d.textfarbe || '#14181d',
      label: feldName === 'kopftext' ? 'Text vor den Positionen' : 'Text am Ende',
      beiAenderung: (v) => {
        r[feldName] = v;
        const f = root.querySelector(`[data-f="${feldName}"]`);
        if (f) { f.value = v; hoeheAnpassen(f); }
        aktualisieren();
      },
      beiEnde: () => { direkt = null; host.style.position = vorher; },
    });
  });

  kundeZeichnen();
  angabenZeichnen();
  positionenZeichnen();
  texteZeichnen();
  bilderZeichnen();
  zahlungZeichnen();
  wiederholungZeichnen();
  aktualisieren();
}

/** Rückfrage beim Verlassen mit ungespeicherten Änderungen. */
function fragenVerlassen() {
  return new Promise((resolve) => {
    let wahl = null;
    const m = modal({
      title: 'Änderungen speichern?',
      size: 'slim',
      body: '<p class="mt0">Die Rechnung hat Änderungen, die noch nicht gespeichert sind.</p>',
      foot: '<button class="btn left" data-stay>Weiter bearbeiten</button><button class="btn danger" data-weg>Verwerfen</button><button class="btn primary" data-save>Speichern</button>',
      onClose: () => resolve(wahl),
    });
    m.root.querySelector('[data-stay]').addEventListener('click', () => { wahl = null; m.close(); });
    m.root.querySelector('[data-weg]').addEventListener('click', () => { wahl = 'verwerfen'; m.close(); });
    m.root.querySelector('[data-save]').addEventListener('click', () => { wahl = 'speichern'; m.close(); });
  });
}
