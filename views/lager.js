/**
 * Kontovia – Reiter „Lager“ der Auswertungen (views/reports.js, SEC-66).
 *
 * Bestand je Produkt am Ende des Zeitraums, Wert zum gleitenden Durchschnittspreis, Zugänge, Abgänge und Wareneinsatz
 * im Zeitraum. Zugang von Hand oder aus einer erhaltenen E-Rechnung, Inventur zählen, Inventurliste als CSV. Abgänge
 * kommen aus Rechnungen und Lieferscheinen. Rechnung: lib/lager.js; Speichern: lib/lageraktionen.js; PDF: lib/reports.js.
 */

import { html, raw, $, $$, money, parseMoney, fmtDate, todayISO, dz } from '../lib/util.js';
import { icon, ok, err, warn, modal, statCard, emptyState, confirmDialog } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import { lagerbestand, zugangAusEingang, inventurliste, menge3 } from '../lib/lager.js';
import { bewegungSpeichern, zugaengeSpeichern, bewegungLoeschen } from '../lib/lageraktionen.js';
import { eRechnungAusDatei } from '../lib/erechnung.js';
import { base64ZuBytes } from '../lib/rechnungsdateien.js';

const api = window.kontovia;
const mengeText = (m) => dz(String(menge3(m)));
const QUELLE = { rechnung: 'Rechnung', lieferschein: 'Lieferschein', eingang: 'E-Rechnung' };

export function lagerZeigen(root, db, period, neuZeichnen) {
  const produkte = (db.products || []).filter((p) => p.active !== false);
  if (!produkte.length) {
    root.innerHTML = html`${emptyState('Noch keine Produkte', 'Das Lager führt einen Bestand für Ihre Produkte. Legen Sie zuerst unter Rechnungen › Produkte welche an.')}`;
    return;
  }
  const b = lagerbestand(db, { von: period.from, bis: period.to });
  const fehl = b.zeilen.filter((z) => z.menge < 0 || z.fehlbestand);
  root.innerHTML = html`
    <div class="grid c4 mb16">
      ${statCard({ label: `Lagerwert am ${fmtDate(period.to)}`, value: `${money(b.wert)} €`, icon: 'euro' })}
      ${statCard({ label: 'Wareneinsatz im Zeitraum', value: `${money(b.einsatz)} €`, tone: 'neg', icon: 'minus' })}
      ${statCard({ label: 'Produkte im Lager', value: String(b.zeilen.length), icon: 'tag' })}
      ${statCard({ label: 'Mit Fehlbestand', value: String(fehl.length), tone: fehl.length ? 'neg' : '', icon: 'alert' })}
    </div>
    ${fehl.length ? raw(html`<div class="notice warn mb16"><strong>Fehlbestand.</strong> Bei ${fehl.length === 1 ? 'einem Produkt' : `${fehl.length} Produkten`} ging mehr hinaus, als eingegangen war. Meist fehlt ein Zugang oder eine Inventur.</div>`) : ''}
    <div class="row wrap gap8 mb16">
      <button type="button" class="btn primary" id="lgZugang">${icon('plus', 15)} Zugang erfassen</button>
      <button type="button" class="btn" id="lgEingang">${icon('invoice', 15)} Zugang aus E-Rechnung</button>
      <button type="button" class="btn" id="lgInventur">${icon('sum', 15)} Inventur zählen</button>
      <button type="button" class="btn ghost" id="lgCsv">${icon('export', 15)} Inventurliste als CSV</button>
    </div>
    <div class="card">
      <div class="card-head"><h2>Bestand am ${fmtDate(period.to)}</h2><span class="sub">gleitender Durchschnittspreis</span></div>
      ${b.zeilen.length ? raw(html`<div class="table-wrap"><table class="data compact">
        <thead><tr><th>Produkt</th><th class="num">Bestand</th><th class="num">Ø Einkauf €</th><th class="num">Wert €</th><th class="num">Zugang</th><th class="num">Abgang</th><th class="num">Wareneinsatz €</th></tr></thead>
        <tbody>${b.zeilen.map((z) => raw(html`<tr class="clickable" data-produkt="${z.produkt.id}" tabindex="0">
          <td><strong>${z.produkt.name || 'Produkt'}</strong>${z.produkt.artikelnummer ? raw(html` <span class="small muted">${z.produkt.artikelnummer}</span>`) : ''}</td>
          <td class="num ${z.menge < 0 ? 'neg' : ''}">${mengeText(z.menge)}</td><td class="num">${money(z.durchschnitt)}</td><td class="num">${money(z.wert)}</td>
          <td class="num">${z.zugang ? mengeText(z.zugang) : ''}</td><td class="num">${z.abgang ? mengeText(z.abgang) : ''}</td><td class="num">${z.einsatz ? money(z.einsatz) : ''}</td></tr>`))}</tbody>
        <tfoot><tr><td colspan="3">Summe</td><td class="num">${money(b.wert)}</td><td colspan="2"></td><td class="num">${money(b.einsatz)}</td></tr></tfoot>
      </table></div>`) : raw(html`<div class="card-body">${emptyState('Noch nichts im Lager', 'Erfassen Sie einen Zugang oder zählen Sie eine Inventur. Ab dann zieht Kontovia verkaufte Mengen aus Rechnungen und Lieferscheinen ab.')}</div>`)}
      <div class="card-body small muted">Abgänge zählen aus ausgestellten Rechnungen und Lieferscheinen mit diesem Produkt. Eine Rechnung zu einem Lieferschein zählt nicht noch einmal.
        Der Wareneinkauf zählt in der Einnahmen-Überschuss-Rechnung, wenn Sie ihn bezahlen. Bestand und Wareneinsatz sind eine Übersicht, keine Buchung.</div>
    </div>`;

  $('#lgZugang', root).addEventListener('click', () => bewegungDialog('zugang', '', neuZeichnen));
  $('#lgInventur', root).addEventListener('click', () => bewegungDialog('inventur', '', neuZeichnen));
  $('#lgEingang', root).addEventListener('click', () => eingangDialog(neuZeichnen));
  $('#lgCsv', root).addEventListener('click', () => csvSpeichern(period.to));
  $$('[data-produkt]', root).forEach((tr) => {
    const oeffnen = () => bewegungenDialog(tr.dataset.produkt, period, neuZeichnen);
    tr.addEventListener('click', oeffnen);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') oeffnen(); });
  });
}

function produktAuswahl(id, gewaehlt = '', label = '') {
  const liste = sel.products().filter((p) => p.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  return html`<select id="${id}" ${label ? raw(html`aria-label="${label}"`) : ''}><option value="">Bitte wählen</option>${liste.map((p) => raw(html`<option value="${p.id}" ${p.id === gewaehlt ? 'selected' : ''}>${p.name}${p.artikelnummer ? ` (${p.artikelnummer})` : ''}</option>`))}</select>`;
}

/** Zugang oder Inventur für ein Produkt erfassen (oder eine gespeicherte Bewegung ändern). */
function bewegungDialog(art, produktId, neuZeichnen, alt = null) {
  const heute = todayISO();
  const zugang = art === 'zugang';
  const m = modal({
    title: alt ? 'Lagerbewegung ändern' : zugang ? 'Zugang erfassen' : 'Inventur zählen',
    body: html`
      <div class="field"><label for="lgProdukt">Produkt</label>${raw(produktAuswahl('lgProdukt', alt?.produktId || produktId))}</div>
      <div class="form-grid">
        <div class="field"><label for="lgDatum">Datum</label><input id="lgDatum" type="date" value="${alt?.datum || heute}"></div>
        <div class="field"><label for="lgMenge">${zugang ? 'Menge' : 'Gezählter Bestand'}</label><input id="lgMenge" inputmode="decimal" value="${alt ? mengeText(alt.menge) : ''}" placeholder="0"></div>
        ${zugang ? raw(html`<div class="field"><label for="lgPreis">Einkaufspreis je Einheit, netto €</label><input id="lgPreis" inputmode="decimal" value="${alt ? money(alt.einkauf) : ''}" placeholder="0,00"></div>`) : ''}
      </div>
      <div class="field"><label for="lgNotiz">Notiz (freiwillig)</label><input id="lgNotiz" maxlength="200" value="${alt?.notiz || ''}" placeholder="${zugang ? 'z. B. Lieferant oder Rechnungsnummer' : 'z. B. Inventur zum Jahresende'}"></div>
      ${zugang ? '' : raw(html`<p class="small muted mb0">Kontovia vergleicht die Zählung mit dem Bestand laut Lager. Die Differenz zählt als Zu- oder Abgang an diesem Tag.</p>`)}`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    const menge = Number(String($m('#lgMenge').value).replace(/\./g, '').replace(',', '.'));
    try {
      await bewegungSpeichern({
        id: alt?.id, art, produktId: $m('#lgProdukt').value, datum: $m('#lgDatum').value, menge: Number.isFinite(menge) ? menge : NaN,
        einkauf: zugang ? parseMoney($m('#lgPreis').value) || 0 : 0, notiz: $m('#lgNotiz').value, quelle: alt?.quelle || null,
      });
      m.close();
      ok(zugang ? 'Zugang gespeichert' : 'Inventur gespeichert');
      neuZeichnen();
    } catch (e) { err('Nicht gespeichert', e.message); }
  });
}

/** Zugang aus einer erhaltenen E-Rechnung: Positionen den Produkten zuordnen. */
async function eingangDialog(neuZeichnen) {
  const eingaenge = sel.invoices().filter((r) => r.richtung === 'eingang' && r.anhangId && !r.gelesen?.gutschrift)
    .sort((a, b) => String(b.gelesen?.datum || '').localeCompare(String(a.gelesen?.datum || '')));
  if (!eingaenge.length) { warn('Keine E-Rechnung vorhanden', 'Fügen Sie die E-Rechnung Ihres Lieferanten zuerst unter Rechnungen › Eingang hinzu.'); return; }
  const m = modal({
    title: 'Zugang aus E-Rechnung',
    size: 'wide',
    body: html`
      <div class="field"><label for="lgRe">Erhaltene E-Rechnung</label><select id="lgRe">${eingaenge.map((r) => raw(html`<option value="${r.id}">${r.gelesen?.verkaeufer || ''} · ${r.gelesen?.nummer || ''} · ${fmtDate(r.gelesen?.datum || '')}</option>`))}</select></div>
      <div id="lgPos" class="mt8"></div>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes disabled>Zugänge speichern</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  let vorschlaege = [];
  let rechnung = null;
  const laden = async () => {
    rechnung = eingaenge.find((r) => r.id === $m('#lgRe').value);
    $m('#lgPos').innerHTML = html`<p class="small muted">Wird gelesen …</p>`;
    try {
      const bytes = base64ZuBytes(await api.attach.read(rechnung.anhangId));
      const gelesen = await eRechnungAusDatei(bytes, sel.attachment(rechnung.anhangId) || {});
      vorschlaege = zugangAusEingang(gelesen, { products: sel.products() });
    } catch (e) { vorschlaege = []; err('E-Rechnung nicht lesbar', e.message); }
    $m('#lgPos').innerHTML = html`${vorschlaege.length ? raw(html`
      <p class="small mt0">Ordnen Sie jede Position einem Produkt zu. Positionen ohne Produkt (etwa Versand) bleiben außen vor.</p>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>Position</th><th class="num">Menge</th><th class="num">Einkauf je Einheit €</th><th>Produkt</th></tr></thead>
      <tbody>${vorschlaege.map((v, i) => raw(html`<tr><td>${v.name}</td><td class="num">${mengeText(v.menge)} ${v.einheit}</td><td class="num">${money(v.einkauf)}</td>
        <td>${raw(produktAuswahl(`lgPos${i}`, v.produktId, `Produkt für ${v.name}`))}</td></tr>`))}</tbody></table></div>`)
    : raw(html`<p class="small muted">Diese E-Rechnung hat keine Positionen mit Menge.</p>`)}`;
    $m('[data-yes]').disabled = !vorschlaege.length;
  };
  $m('#lgRe').addEventListener('change', laden);
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async () => {
    const liste = vorschlaege.map((v, i) => ({ ...v, produktId: $m(`#lgPos${i}`).value, datum: rechnung.gelesen?.datum || todayISO(), notiz: `${rechnung.gelesen?.verkaeufer || ''} ${rechnung.gelesen?.nummer || ''}`.trim() }))
      .filter((v) => v.produktId);
    if (!liste.length) { warn('Kein Produkt gewählt', 'Wählen Sie mindestens für eine Position ein Produkt.'); return; }
    try {
      await zugaengeSpeichern(liste, { art: 'eingang', id: rechnung.id, nummer: rechnung.gelesen?.nummer || '' });
      m.close();
      ok('Zugänge gespeichert', `${liste.length} ${liste.length === 1 ? 'Position' : 'Positionen'}`);
      neuZeichnen();
    } catch (e) { err('Nicht gespeichert', e.message); }
  });
  laden();
}

/** Bewegungen eines Produkts im Zeitraum, gespeicherte mit Ändern und Löschen. */
function bewegungenDialog(produktId, period, neuZeichnen) {
  const p = sel.product(produktId);
  const zeile = lagerbestand(store.db, { bis: period.to }).zeilen.find((z) => z.produkt.id === produktId);
  const liste = (zeile?.bewegungen || []).filter((b) => b.datum >= period.from).reverse();
  const art = (b) => (b.art === 'abgang' ? `Abgang (${QUELLE[b.quelle?.art] || ''} ${b.quelle?.nummer || ''})`.replace(' )', ')') : b.art === 'inventur' ? 'Inventur' : b.quelle?.art === 'eingang' ? `Zugang (E-Rechnung ${b.quelle.nummer || ''})` : 'Zugang');
  const m = modal({
    title: p?.name || 'Produkt',
    size: 'wide',
    body: liste.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>Datum</th><th>Vorgang</th><th class="num">Menge</th><th class="num">Bestand danach</th><th></th></tr></thead>
      <tbody>${liste.map((b) => raw(html`<tr><td class="nowrap">${fmtDate(b.datum)}</td><td>${art(b)}${b.notiz ? raw(html`<div class="small muted">${b.notiz}</div>`) : ''}</td>
        <td class="num">${b.art === 'abgang' ? `−${mengeText(b.menge)}` : b.art === 'inventur' ? `= ${mengeText(b.menge)}` : `+${mengeText(b.menge)}`}</td><td class="num">${mengeText(b.bestand)}</td>
        <td class="nowrap">${b.art === 'abgang' ? '' : raw(html`<button class="btn sm ghost" data-aendern="${b.id}">Ändern</button> <button class="btn sm ghost" data-loeschen="${b.id}">Löschen</button>`)}</td></tr>`))}</tbody></table></div>`
      : html`<p class="muted">Im Zeitraum gab es keine Bewegung.</p>`,
    foot: html`<button class="btn primary" data-zu>Schließen</button>`,
  });
  m.root.querySelector('[data-zu]').addEventListener('click', () => m.close());
  m.root.querySelectorAll('[data-aendern]').forEach((b) => b.addEventListener('click', () => {
    const alt = sel.lager().find((x) => x.id === b.dataset.aendern);
    m.close();
    if (alt) bewegungDialog(alt.art, alt.produktId, neuZeichnen, alt);
  }));
  m.root.querySelectorAll('[data-loeschen]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Lagerbewegung löschen?', text: 'Der Bestand wird ohne sie neu gerechnet. Das Journal behält den alten Inhalt.', confirmLabel: 'Löschen', danger: true })) return;
    try {
      await bewegungLoeschen(b.dataset.loeschen);
      m.close();
      ok('Gelöscht');
      neuZeichnen();
    } catch (e) { err('Nicht gelöscht', e.message); }
  }));
}

async function csvSpeichern(stichtag) {
  const { kopf, daten, summe } = inventurliste(store.db, stichtag);
  const zelle = (s) => (/[;"\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
  const text = `﻿${[kopf, ...daten, ['', 'Summe', '', '', '', (summe / 100).toFixed(2).replace('.', ',')]].map((r) => r.map(zelle).join(';')).join('\r\n')}\r\n`;
  try {
    const pfad = await api.file.save({ defaultName: `Inventurliste_${stichtag}.csv`, filters: [{ name: 'CSV-Tabelle', extensions: ['csv'] }], text });
    if (pfad) ok('Inventurliste gespeichert', pfad);
  } catch (e) { err('Nicht gespeichert', e.message); }
}
