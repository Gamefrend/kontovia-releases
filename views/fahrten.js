/**
 * Kontovia – Fahrten und Reisen (SEC-65): Fahrtenbuch für den Firmenwagen und Dienstreisen mit Pauschalen.
 *
 * Oben die Wahl von Fahrzeug und Jahr mit der Auswertung (Kilometer je Art, privater Anteil an den Kosten gegen die
 * 1-%-Regel), darunter die Fahrten. Fenster: Fahrt eintragen oder ändern, Fahrzeuge, Dienstreise (Verpflegung nach
 * Tagen, gestellte Mahlzeiten, Fahrt mit dem eigenen Auto; ergibt Buchungen). Das Fahrtenbuch lässt sich als CSV
 * speichern. Rechnen: lib/fahrtenbuch.js, Speichern: lib/fahrtenaktionen.js.
 */

import { html, raw, esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO } from '../lib/util.js';
import { icon, ok, err, modal, confirmDialog, statCard, emptyState } from '../lib/ui.js';
import { sel } from '../lib/store.js';
import { refresh } from '../lib/router.js';
import { mountTable } from '../lib/table.js';
import { kannSchreiben } from '../lib/benutzer.js';
import { KFZ_ANTRIEB, KM_SATZ } from '../lib/sonderfaelle.js';
import {
  FAHRT_ARTEN, fahrtArt, fahrtKm, fahrtPruefen, fahrtenSortiert, fahrtenAuswertung, fahrtenCsv, neueFahrt,
  verpflegung, reiseTage, VERPFLEGUNG_INLAND,
} from '../lib/fahrtenbuch.js';
import {
  fahrtSpeichern, fahrtLoeschen, fahrzeuge, fahrzeugSpeichern, fahrzeugLoeschen, kfzKostenVorschlag, reiseBuchen,
} from '../lib/fahrtenaktionen.js';

const api = window.kontovia;

/** Was gewählt ist: Fahrzeug, Jahr, Kosten von Hand (Cent, null = Vorschlag aus den Buchungen), Monate mit dem Wagen. */
const wahl = { fahrzeugId: null, jahr: Number(todayISO().slice(0, 4)), kosten: null, monate: 12 };

const MAHLZEITEN = [['fruehstueck', 'Frühstück'], ['mittag', 'Mittagessen'], ['abend', 'Abendessen']];
const fahrzeugName = (fz) => [fz?.name, fz?.kennzeichen].filter(Boolean).join(' · ') || 'Fahrzeug';
const kmText = (n) => `${String(Math.round(Number(n || 0) * 10) / 10).replace('.', ',')} km`;
const prozent = (a) => `${Math.round(a * 1000) / 10} %`.replace('.', ',');

function aktuellesFahrzeug() {
  const liste = fahrzeuge();
  if (!liste.some((f) => f.id === wahl.fahrzeugId)) wahl.fahrzeugId = liste[0]?.id || '';
  return liste.find((f) => f.id === wahl.fahrzeugId) || null;
}

export async function render(root, params = {}, { actions } = {}) {
  const schreiben = kannSchreiben();
  actions.innerHTML = html`${schreiben ? raw(html`
    <button class="btn" id="frFahrzeuge">${icon('settings', 15)} Fahrzeuge</button>
    <button class="btn" id="frReise">${icon('pin', 15)} Dienstreise</button>
    <button class="btn primary" id="frNeu">${icon('plus', 16)} Fahrt eintragen</button>`) : ''}`;
  $('#frFahrzeuge', actions)?.addEventListener('click', () => fahrzeugDialog());
  $('#frReise', actions)?.addEventListener('click', () => reiseDialog());
  $('#frNeu', actions)?.addEventListener('click', () => fahrtNeu());
  if (params.neu === 'reise') reiseDialog();

  const fz = aktuellesFahrzeug();
  if (!fz) {
    root.innerHTML = html`<div class="card">${emptyState('Noch kein Fahrzeug',
      'Legen Sie Ihren Firmenwagen an, dann führen Sie hier das Fahrtenbuch. Dienstreisen mit Verpflegungspauschalen buchen Sie auch ohne Fahrzeug.',
      schreiben ? html`<button class="btn primary" id="frErstes">${icon('plus', 15)} Fahrzeug anlegen</button>` : '')}</div>`;
    $('#frErstes', root)?.addEventListener('click', () => fahrzeugDialog());
    return;
  }

  const alle = sel.fahrten();
  const jahre = [...new Set([wahl.jahr, Number(todayISO().slice(0, 4)), ...alle.filter((f) => f.fahrzeugId === fz.id).map((f) => Number(String(f.datum).slice(0, 4)))])]
    .filter(Number.isFinite).sort((a, b) => b - a);
  const vorschlag = kfzKostenVorschlag(wahl.jahr);
  const kosten = wahl.kosten ?? vorschlag;
  const a = fahrtenAuswertung(alle, { jahr: wahl.jahr, fahrzeugId: fz.id, kosten, listenpreis: fz.listenpreis, antrieb: fz.antrieb, monate: wahl.monate });

  const ergebnis = !a.km.gesamt ? 'Noch keine Fahrten in diesem Jahr.'
    : !a.pauschalErlaubt ? 'Höchstens die Hälfte der Kilometer war betrieblich. Die 1-%-Regel ist dann nicht erlaubt, es gilt das Fahrtenbuch.'
      : !fz.listenpreis ? 'Tragen Sie beim Fahrzeug den Bruttolistenpreis ein, dann vergleicht Kontovia mit der 1-%-Regel.'
        : !kosten ? 'Tragen Sie die Kosten des Fahrzeugs im Jahr ein, dann vergleicht Kontovia mit der 1-%-Regel.'
          : a.guenstiger === 'fahrtenbuch' ? `Nach dem Fahrtenbuch versteuern Sie ${money(a.privatKosten)} € statt ${money(a.pauschal)} € nach der 1-%-Regel.`
            : `Die 1-%-Regel ist günstiger: ${money(a.pauschal)} € statt ${money(a.privatKosten)} € nach dem Fahrtenbuch.`;

  root.innerHTML = html`
    <div class="card mb16">
      <div class="form-grid">
        <div class="field"><label for="frFz">Fahrzeug</label>
          <select id="frFz">${fahrzeuge().map((x) => raw(html`<option value="${x.id}" ${raw(x.id === fz.id ? 'selected' : '')}>${fahrzeugName(x)}</option>`))}</select></div>
        <div class="field"><label for="frJahr">Jahr</label>
          <select id="frJahr">${jahre.map((j) => raw(html`<option value="${j}" ${raw(j === wahl.jahr ? 'selected' : '')}>${j}</option>`))}</select></div>
      </div>
    </div>
    <div class="grid c4 mb16">
      ${statCard({ label: 'Kilometer', value: kmText(a.km.gesamt), foot: `${a.fahrten} Fahrten` })}
      ${statCard({ label: 'Betrieblich', value: kmText(a.km.betrieblich), foot: a.km.gesamt ? prozent(a.km.betrieblich / a.km.gesamt) : '' })}
      ${statCard({ label: 'Privat', value: kmText(a.km.privat), foot: a.km.gesamt ? prozent(a.anteilPrivat) : '' })}
      ${statCard({ label: 'Wohnung und Betrieb', value: kmText(a.km.arbeitsweg), foot: a.km.gesamt ? prozent(a.anteilArbeitsweg) : '' })}
    </div>
    <div class="card mb16">
      <h2>Fahrtenbuch oder 1-%-Regel</h2>
      <div class="form-grid">
        <div class="field"><label for="frKosten">Kosten des Fahrzeugs ${wahl.jahr} (netto, mit Abschreibung)</label>
          <input id="frKosten" class="money-input" inputmode="decimal" value="${moneyInput(kosten)}">
          <span class="hint">Vorschlag aus Ihren Buchungen der Kfz-Kategorien: ${money(vorschlag)} €. Abschreibung und Leasing bitte prüfen.</span></div>
        <div class="field"><label for="frMonate">Monate mit diesem Fahrzeug</label>
          <input id="frMonate" type="number" min="1" max="12" value="${wahl.monate}"></div>
      </div>
      <p class="mb0" id="frErgebnis">${ergebnis}</p>
      ${a.km.arbeitsweg ? raw(html`<p class="small muted mb0">Fahrten zwischen Wohnung und Betrieb (${prozent(a.anteilArbeitsweg)}, ${money(a.arbeitswegKosten)} € der Kosten) sind nur mit der Entfernungspauschale abziehbar. Sie stehen nicht im Vergleich.</p>`) : ''}
      ${a.luecken.length ? raw(html`<div class="notice warn small mt8">Im Kilometerstand fehlen ${a.luecken.length === 1 ? 'eine Strecke' : `${a.luecken.length} Strecken`} (${a.luecken.map((l) => kmText(Math.abs(l.km))).join(', ')}). Ein Fahrtenbuch muss lückenlos sein.</div>`) : ''}
      <p class="small muted mb0 mt8">Das ist eine Orientierung, keine Steuerberatung.</p>
    </div>
    <div class="card">
      <div class="row mb8"><h2 class="mb0">Fahrten ${wahl.jahr}</h2><div class="spacer"></div>
        <button class="btn sm" id="frCsv">${icon('export', 14)} Als CSV speichern</button></div>
      <div id="frListe"></div>
    </div>`;

  $('#frFz', root).addEventListener('change', (e) => { wahl.fahrzeugId = e.target.value; refresh(); });
  $('#frJahr', root).addEventListener('change', (e) => { wahl.jahr = Number(e.target.value); wahl.kosten = null; refresh(); });
  $('#frKosten', root).addEventListener('change', (e) => { wahl.kosten = Math.max(0, parseMoney(e.target.value) || 0); refresh(); });
  $('#frMonate', root).addEventListener('change', (e) => { wahl.monate = Math.min(12, Math.max(1, Number(e.target.value) || 12)); refresh(); });
  $('#frCsv', root).addEventListener('click', async () => {
    try {
      const p = await api.file.save({ defaultName: `Fahrtenbuch_${(fz.kennzeichen || fz.name || 'Fahrzeug').replace(/[^\w-]+/g, '_')}_${wahl.jahr}.csv`,
        filters: [{ name: 'CSV-Tabelle', extensions: ['csv'] }], text: fahrtenCsv(alle, fz.id, { jahr: wahl.jahr }) });
      if (p) ok('Fahrtenbuch gespeichert', p);
    } catch (e) { err('Nicht gespeichert', e.message); }
  });

  const liste = fahrtenSortiert(alle, fz.id).filter((f) => String(f.datum).startsWith(String(wahl.jahr)));
  mountTable($('#frListe', root), {
    id: 'fahrten',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: liste,
    unit: ['Fahrt', 'Fahrten'],
    search: { placeholder: 'Ziel oder Anlass suchen …', text: (f) => [f.start, f.ziel, f.anlass, f.partner].join(' ') },
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (f) => `${f.datum}${String(f.kmStart || 0).padStart(9, '0')}`, cell: (f) => esc(fmtDate(f.datum)) },
      { key: 'stand', label: 'Kilometerstand', type: 'text', tdCls: 'nowrap', value: (f) => Number(f.kmStart) || 0, cell: (f) => (f.kmStart && f.kmEnde ? esc(`${f.kmStart} bis ${f.kmEnde}`) : '<span class="muted">–</span>') },
      { key: 'km', label: 'Kilometer', type: 'num', value: (f) => fahrtKm(f), cell: (f) => esc(kmText(fahrtKm(f))) },
      { key: 'art', label: 'Art', type: 'text', value: (f) => FAHRT_ARTEN[fahrtArt(f.art)], cell: (f) => esc(FAHRT_ARTEN[fahrtArt(f.art)]) },
      { key: 'ziel', label: 'Ziel', type: 'text', tdCls: 'strong', value: (f) => f.ziel || '', cell: (f) => esc([f.start, f.ziel].filter(Boolean).join(' nach ')) },
      { key: 'anlass', label: 'Anlass', type: 'text', value: (f) => f.anlass || '', cell: (f) => esc([f.anlass, f.partner].filter(Boolean).join(', ')) },
      ...(schreiben ? [{ key: 'actions', label: '', type: 'none', width: '64px', cls: 'right', tdCls: 'nowrap',
        cell: (f) => `<button class="btn sm ghost" data-fr-weg="${esc(f.id)}" title="Löschen" aria-label="Fahrt löschen">${icon('trash', 14).__raw}</button>` }] : []),
    ],
    filters: [{
      key: 'art', column: 'art', title: 'Art', initial: 'alle', chip: (v, label) => label,
      options: () => [['alle', 'Jede Art', () => true], ...Object.entries(FAHRT_ARTEN).map(([k, t]) => [k, t, (f) => fahrtArt(f.art) === k])],
    }],
    emptyTitle: 'Noch keine Fahrten',
    emptyText: 'Tragen Sie jede Fahrt mit Kilometerstand, Ziel und Anlass ein, am besten am selben Tag.',
    onRowClick: schreiben ? (f) => fahrtDialog(f) : null,
    onRender: (el) => $$('[data-fr-weg]', el).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await confirmDialog({ title: 'Fahrt löschen?', text: 'Die Fahrt verschwindet aus dem Fahrtenbuch. Das Änderungsjournal behält, was dort stand.', confirmLabel: 'Löschen', danger: true })) return;
      try { await fahrtLoeschen(b.dataset.frWeg); refresh(); } catch (ex) { err('Nicht gelöscht', ex.message); }
    })),
  });
}

/* -------------------------------------------------------------------------- */
/* Fahrt                                                                       */
/* -------------------------------------------------------------------------- */

/** Neue Fahrt: Fahrzeug wie gewählt, Kilometerstand am Anfang dort, wo die letzte Fahrt endete. */
export function fahrtNeu(vorgabe = {}) {
  const fz = aktuellesFahrzeug();
  if (!fz) { fahrzeugDialog(); return; }
  const letzte = fahrtenSortiert(sel.fahrten(), fz.id).filter((f) => Number(f.kmEnde) > 0).at(-1);
  fahrtDialog(neueFahrt({ fahrzeugId: fz.id, datum: todayISO(), kmStart: letzte ? letzte.kmEnde : '', ...vorgabe }), { neu: true });
}

function fahrtDialog(f, { neu = false } = {}) {
  const m = modal({
    title: neu ? 'Fahrt eintragen' : 'Fahrt ändern',
    body: html`
      ${neu ? '' : raw(html`<p class="small muted">Jede Änderung steht mit dem alten Inhalt im Änderungsjournal.</p>`)}
      <div class="form-grid">
        <div class="field"><label for="ftFz">Fahrzeug</label>
          <select id="ftFz">${fahrzeuge().map((x) => raw(html`<option value="${x.id}" ${raw(x.id === f.fahrzeugId ? 'selected' : '')}>${fahrzeugName(x)}</option>`))}</select></div>
        <div class="field"><label for="ftDatum">Datum</label><input id="ftDatum" type="date" value="${f.datum}"></div>
        <div class="field"><label for="ftArt">Art der Fahrt</label>
          <select id="ftArt">${Object.entries(FAHRT_ARTEN).map(([k, t]) => raw(html`<option value="${k}" ${raw(k === fahrtArt(f.art) ? 'selected' : '')}>${t}</option>`))}</select></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="ftStart">Kilometerstand am Anfang</label><input id="ftStart" inputmode="numeric" value="${f.kmStart ?? ''}"></div>
        <div class="field"><label for="ftEnde">Kilometerstand am Ende</label><input id="ftEnde" inputmode="numeric" value="${f.kmEnde ?? ''}"></div>
        <div class="field"><label for="ftKm">Kilometer</label><input id="ftKm" inputmode="decimal" value="${fahrtKm(f) || ''}">
          <span class="hint">Aus den Ständen gerechnet, sonst von Hand.</span></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="ftVon">Start</label><input id="ftVon" maxlength="120" value="${f.start || ''}" placeholder="z. B. Büro"></div>
        <div class="field"><label for="ftZiel">Ziel</label><input id="ftZiel" maxlength="160" value="${f.ziel || ''}" placeholder="z. B. Kunde Weber, Hauptstraße 5, Köln"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="ftAnlass">Anlass</label><input id="ftAnlass" maxlength="200" value="${f.anlass || ''}" placeholder="z. B. Montage, Angebot besprechen"></div>
        <div class="field"><label for="ftPartner">Geschäftspartner</label><input id="ftPartner" maxlength="120" value="${f.partner || ''}"></div>
      </div>
      <div class="small muted" id="ftHinweis"></div>
      <div class="err small" id="ftFehler" role="alert"></div>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  const lesen = () => ({
    ...structuredClone(f), fahrzeugId: $m('#ftFz').value, datum: $m('#ftDatum').value, art: $m('#ftArt').value,
    kmStart: $m('#ftStart').value.trim() === '' ? '' : Number($m('#ftStart').value.replace(/\D/g, '')),
    kmEnde: $m('#ftEnde').value.trim() === '' ? '' : Number($m('#ftEnde').value.replace(/\D/g, '')),
    km: $m('#ftKm').value, start: $m('#ftVon').value.trim(), ziel: $m('#ftZiel').value.trim(),
    anlass: $m('#ftAnlass').value.trim(), partner: $m('#ftPartner').value.trim(),
  });
  const zeigen = () => {
    const x = lesen();
    if (Number(x.kmStart) > 0 && Number(x.kmEnde) > Number(x.kmStart)) $m('#ftKm').value = String(fahrtKm(x)).replace('.', ',');
    $m('#ftHinweis').textContent = fahrtPruefen(x).filter((h) => h.stufe === 'hinweis').map((h) => h.text).join(' ');
  };
  for (const id of ['#ftStart', '#ftEnde']) $m(id).addEventListener('input', zeigen);
  zeigen();
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async () => {
    try {
      await fahrtSpeichern(lesen());
      m.close();
      if (neu) ok('Fahrt eingetragen', kmText(fahrtKm(lesen())));
      refresh();
    } catch (e) {
      $m('#ftFehler').textContent = e.message;
      const feld = { datum: '#ftDatum', km: '#ftKm', kmEnde: '#ftEnde', ziel: '#ftZiel', anlass: '#ftAnlass' }[e.feld];
      if (feld) $m(feld).focus();
    }
  });
  $m(neu ? '#ftEnde' : '#ftZiel').focus();
}

/* -------------------------------------------------------------------------- */
/* Fahrzeuge                                                                   */
/* -------------------------------------------------------------------------- */

function fahrzeugDialog(fz = null) {
  const liste = fahrzeuge();
  const f = fz || { id: '', name: '', kennzeichen: '', listenpreis: 0, antrieb: 'verbrenner' };
  const m = modal({
    title: fz ? 'Fahrzeug ändern' : 'Fahrzeuge',
    body: html`
      ${!fz && liste.length ? raw(html`<div class="mb16">${liste.map((x) => raw(html`<div class="row mb8">
        <span class="strong">${fahrzeugName(x)}</span><div class="spacer"></div>
        <button class="btn sm" data-fz-edit="${x.id}">${icon('edit', 14)} Ändern</button>
        <button class="btn sm ghost" data-fz-weg="${x.id}" aria-label="Fahrzeug entfernen" title="Entfernen">${icon('trash', 14)}</button></div>`))}</div>
        <h3>Neues Fahrzeug</h3>`) : ''}
      <div class="form-grid">
        <div class="field"><label for="fzName">Name</label><input id="fzName" maxlength="80" value="${f.name}" placeholder="z. B. Kombi"></div>
        <div class="field"><label for="fzKz">Kennzeichen</label><input id="fzKz" maxlength="20" value="${f.kennzeichen}" placeholder="z. B. B-KV 123"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="fzLp">Bruttolistenpreis</label><input id="fzLp" class="money-input" inputmode="decimal" value="${f.listenpreis ? moneyInput(f.listenpreis) : ''}" placeholder="0,00">
          <span class="hint">Für den Vergleich mit der 1-%-Regel.</span></div>
        <div class="field"><label for="fzAntrieb">Antrieb</label>
          <select id="fzAntrieb">${Object.entries(KFZ_ANTRIEB).map(([k, [, t]]) => raw(html`<option value="${k}" ${raw(k === f.antrieb ? 'selected' : '')}>${t}</option>`))}</select></div>
      </div>
      <div class="err small" id="fzFehler" role="alert"></div>`,
    foot: html`<button class="btn" data-no>Schließen</button><button class="btn primary" data-yes>${fz ? 'Speichern' : 'Fahrzeug anlegen'}</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  $m('[data-no]').addEventListener('click', () => m.close());
  $$('[data-fz-edit]', m.root).forEach((b) => b.addEventListener('click', () => { m.close(); fahrzeugDialog(liste.find((x) => x.id === b.dataset.fzEdit)); }));
  $$('[data-fz-weg]', m.root).forEach((b) => b.addEventListener('click', async () => {
    try { await fahrzeugLoeschen(b.dataset.fzWeg); m.close(); refresh(); } catch (e) { $m('#fzFehler').textContent = e.message; }
  }));
  $m('[data-yes]').addEventListener('click', async () => {
    try {
      const neu = await fahrzeugSpeichern({ ...f, name: $m('#fzName').value, kennzeichen: $m('#fzKz').value, listenpreis: parseMoney($m('#fzLp').value) || 0, antrieb: $m('#fzAntrieb').value });
      wahl.fahrzeugId = neu.id;
      m.close();
      ok('Fahrzeug gespeichert', fahrzeugName(neu));
      refresh();
    } catch (e) { $m('#fzFehler').textContent = e.message; }
  });
  $m('#fzName').focus();
}

/* -------------------------------------------------------------------------- */
/* Dienstreise                                                                 */
/* -------------------------------------------------------------------------- */

export function reiseDialog() {
  if (!kannSchreiben()) return;
  const heute = todayISO();
  const r = { von: heute, bis: heute, stunden: 9, ziel: '', anlass: '', land: 'DE', voll: VERPFLEGUNG_INLAND.voll, teil: VERPFLEGUNG_INLAND.teil, km: '', mahlzeiten: {} };
  const m = modal({
    title: 'Dienstreise buchen',
    size: 'wide',
    body: html`
      <div class="form-grid">
        <div class="field"><label for="drVon">Abreise</label><input id="drVon" type="date" value="${r.von}"></div>
        <div class="field"><label for="drBis">Rückkehr</label><input id="drBis" type="date" value="${r.bis}"></div>
        <div class="field" id="drStundenFeld"><label for="drStunden">Stunden unterwegs</label><input id="drStunden" type="number" min="0" max="24" step="0.5" value="${r.stunden}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="drZiel">Ziel</label><input id="drZiel" maxlength="120" placeholder="z. B. Hamburg"></div>
        <div class="field"><label for="drAnlass">Anlass</label><input id="drAnlass" maxlength="160" placeholder="z. B. Messe, Kundentermin"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="drLand">Reise</label>
          <select id="drLand"><option value="DE">Im Inland</option><option value="AUSLAND">Ins Ausland</option></select></div>
        <div class="field" hidden id="drSaetze"><label for="drVoll">Pauschale für volle Tage</label><input id="drVoll" class="money-input" inputmode="decimal" value="">
          <label for="drTeil" class="mt8">für An- und Abreisetag</label><input id="drTeil" class="money-input" inputmode="decimal" value="">
          <span class="hint">Aus der Tabelle des Bundesfinanzministeriums für das Land und Jahr.</span></div>
        <div class="field"><label for="drKm">Mit dem eigenen Auto gefahren (km)</label><input id="drKm" inputmode="decimal" placeholder="z. B. 580">
          <span class="hint">Nur ein privates Auto, nicht der Firmenwagen: ${money(KM_SATZ)} € je km.</span></div>
      </div>
      <h3>Gestellte Mahlzeiten</h3>
      <p class="small muted">Bekommen Sie Essen gestellt (etwa Frühstück im Hotel), sinkt die Pauschale.</p>
      <div id="drTage"></div>
      <div class="notice small mt8" id="drSumme" aria-live="polite"></div>
      <p class="small muted mb0">Übernachtung und Fahrkarten buchen Sie mit der Rechnung als gewöhnliche Ausgabe.</p>
      <div class="err small" id="drFehler" role="alert"></div>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Buchen</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  const lesen = () => {
    r.von = $m('#drVon').value; r.bis = $m('#drBis').value || r.von;
    r.stunden = Number($m('#drStunden').value) || 0;
    r.ziel = $m('#drZiel').value.trim(); r.anlass = $m('#drAnlass').value.trim();
    r.land = $m('#drLand').value;
    if (r.land === 'DE') Object.assign(r, VERPFLEGUNG_INLAND);
    else Object.assign(r, { voll: parseMoney($m('#drVoll').value) || 0, teil: parseMoney($m('#drTeil').value) || 0 });
    r.km = $m('#drKm').value;
    for (const t of reiseTage(r.von, r.bis)) {
      r.mahlzeiten[t] = Object.fromEntries(['fruehstueck', 'mittag', 'abend'].map((k) => [k, !!m.root.querySelector(`[data-mz="${t}|${k}"]`)?.checked]));
    }
    return verpflegung({ von: r.von, bis: r.bis, stunden: r.stunden, mahlzeiten: r.mahlzeiten, satz: { voll: r.voll, teil: r.teil } });
  };
  const tageZeichnen = () => {
    const tage = reiseTage(r.von, r.bis);
    $m('#drStundenFeld').hidden = tage.length !== 1;
    $m('#drSaetze').hidden = r.land === 'DE';
    $m('#drTage').innerHTML = html`${tage.length > 31 ? raw(html`<p class="small muted">Bei mehr als 31 Tagen bitte die Mahlzeiten in mehreren Reisen erfassen.</p>`)
      : raw(html`<table class="data compact"><thead><tr><th scope="col">Tag</th><th scope="col">Frühstück</th><th scope="col">Mittagessen</th><th scope="col">Abendessen</th></tr></thead><tbody>
        ${tage.map((t) => raw(html`<tr><td>${fmtDate(t)}</td>${MAHLZEITEN.map(([k, name]) => raw(html`<td><input type="checkbox" data-mz="${t}|${k}" aria-label="${name}, ${fmtDate(t)}" ${raw(r.mahlzeiten[t]?.[k] ? 'checked' : '')}></td>`))}</tr>`))}
      </tbody></table>`)}`;
    $$('[data-mz]', m.root).forEach((c) => c.addEventListener('change', summe));
  };
  const summe = () => {
    const v = lesen();
    const km = Number(String(r.km || '').replace(',', '.')) || 0;
    const fahrt = Math.round(km * KM_SATZ);
    $m('#drSumme').innerHTML = html`Verpflegung: <strong>${money(v.summe)} €</strong> (${v.tage.filter((t) => t.betrag > 0).length} Tage)${km ? raw(html`, Fahrt: <strong>${money(fahrt)} €</strong>`) : ''}${v.hinweise.length ? raw(html`<br>${v.hinweise.join(' ')}`) : ''}`;
    return v;
  };
  for (const id of ['#drVon', '#drBis', '#drLand']) $m(id).addEventListener('change', () => { lesen(); tageZeichnen(); summe(); });
  for (const id of ['#drStunden', '#drVoll', '#drTeil', '#drKm']) $m(id).addEventListener('input', summe);
  lesen(); tageZeichnen(); summe();
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async (e) => {
    const v = summe();
    if (!r.ziel) { $m('#drFehler').textContent = 'Bitte das Ziel der Reise eintragen.'; $m('#drZiel').focus(); return; }
    if (r.land !== 'DE' && !(r.voll > 0)) { $m('#drFehler').textContent = 'Bitte die Pauschalen des Landes eintragen.'; $m('#drVoll').focus(); return; }
    e.currentTarget.disabled = true;
    try {
      const txs = await reiseBuchen({ von: r.von, bis: r.bis, ziel: r.ziel, anlass: r.anlass, land: r.land === 'DE' ? 'DE' : '', km: r.km, verpflegung: v });
      m.close();
      ok('Dienstreise gebucht', `${txs.length === 1 ? 'Eine Buchung' : `${txs.length} Buchungen`}, zusammen ${money(txs.reduce((s, t) => s + t.gross, 0))} €`);
      refresh();
    } catch (ex) { e.currentTarget.disabled = false; $m('#drFehler').textContent = ex.message; }
  });
  $m('#drZiel').focus();
}
