/**
 * Kontovia – Kontoauszug einlesen: Datei wählen, Spalten prüfen, Umsätze
 * zuordnen, bestätigen, buchen.
 *
 * Die Datei wird im Browser gelesen. Sie wird nicht hochgeladen und nirgends
 * abgelegt; ihr Inhalt lebt nur im Arbeitsspeicher dieser Ansicht und
 * verschwindet beim Verlassen und beim Sperren. Gebucht wird nichts, bevor
 * der Nutzer bestätigt (lib/importaktionen.js).
 *
 * Gelesen wird in lib/kontoauszug.js, zugeordnet in lib/zuordnung.js.
 */

import { esc, $, $$, money, fmtDate, fmtDateTime, int } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, err } from '../lib/ui.js';
import { store, sel, beimSperren } from '../lib/store.js';
import { navigate, router } from '../lib/router.js';
import { mountTable } from '../lib/table.js';
import { kontoauszugLesen, SPALTENROLLEN, zusammenfassung } from '../lib/kontoauszug.js';
import {
  fingerabdruecke, zuordnungsKontext, zuordnen, vorausgewaehlt, zaehlen, SICHERHEIT,
} from '../lib/zuordnung.js';
import {
  zeilePruefen, importBuchen, regelSpeichern, regelLoeschen, vorlageSpeichern, vorlageLoeschen, vorlageFuer,
} from '../lib/importaktionen.js';

const leer = () => ({
  schritt: 'datei', kontoId: '', name: '', bytes: null, gelesen: null, opt: {}, vorlage: '', vorlageMerken: true, vorlageName: '',
  ctx: null, zeilen: [], filter: 'alle', ergebnis: null, bearbeitet: false,
});
let st = leer();
const neuStart = () => ({ ...leer(), kontoId: st.kontoId, paramsRef: st.paramsRef });
// Beim Sperren bleibt vom eingelesenen Kontoauszug nichts im Speicher.
beimSperren(() => { st = leer(); });

const atmen = () => new Promise((r) => setTimeout(r, 0));
/** Gibt den Zellen jeder Zeile eine Klasse nach ihrer Spalte (für die Kartenansicht am Telefon, web.css). */
const spaltenKlassen = (el, liste) => $$('tbody tr[data-row]', el).forEach((tr) => [...tr.children].forEach((td, i) => { if (liste[i]) td.classList.add(liste[i]); }));
const IBAN_KURZ = (s) => String(s || '').replace(/\s/g, '').toUpperCase();

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params = {}, { actions } = {}) {
  router.leaveGuard = null;
  // Eine neue Navigation (neues Params-Objekt) beginnt von vorn: Von einer früher eingelesenen Datei bleibt nichts
  // im Speicher. Ein Neuzeichnen von außen (refresh) reicht dasselbe Objekt durch und lässt den Stand stehen.
  if (params.neu || params !== st.paramsRef) st = neuStart();
  st.paramsRef = params;
  actions.innerHTML = `<button class="btn" id="kiRegeln">${icon('settings', 15).__raw} Regeln und Vorlagen</button>`;
  $('#kiRegeln', actions).addEventListener('click', () => regelnDialog());
  zeichnen(root);
}

function zeichnen(root) {
  router.leaveGuard = st.schritt === 'pruefen' && st.zeilen.some((z) => z.gewaehlt) ? verlassen : null;
  const schritte = [['datei', 'Datei'], ['spalten', 'Spalten'], ['pruefen', 'Prüfen'], ['fertig', 'Fertig']].filter(([k]) => k !== 'spalten' || st.gelesen?.format === 'csv' || st.schritt === 'spalten');
  const nr = schritte.findIndex(([k]) => k === st.schritt);
  root.innerHTML = `
    <ol class="ki-schritte" aria-label="Schritte">${schritte.map(([k, t], i) => `<li class="${i === nr ? 'aktuell' : i < nr ? 'fertig' : ''}"${i === nr ? ' aria-current="step"' : ''}><span>${i + 1}</span> ${esc(t)}</li>`).join('')}</ol>
    <div id="kiInhalt"></div>`;
  const host = $('#kiInhalt', root);
  ({ datei: schrittDatei, spalten: schrittSpalten, pruefen: schrittPruefen, fertig: schrittFertig }[st.schritt])(host, root);
}

async function verlassen() {
  const n = st.zeilen.filter((z) => z.gewaehlt).length;
  const ja = await confirmDialog({
    title: 'Import verlassen?',
    text: `${n === 1 ? 'Eine Zeile ist' : `${n} Zeilen sind`} ausgewählt, gebucht ist noch nichts. Wenn Sie die Ansicht verlassen, gehen Auswahl und eingelesene Datei verloren.`,
    confirmLabel: 'Verlassen', cancelLabel: 'Hierbleiben', danger: true,
  });
  if (ja) { st = leer(); router.leaveGuard = null; }
  return ja;
}

/* -------------------------------------------------------------------------- */
/* Schritt 1: Datei                                                            */
/* -------------------------------------------------------------------------- */

function kontoOptionen(gewaehlt) {
  const konten = sel.accounts().filter((a) => a.active !== false);
  return konten.map((a) => `<option value="${esc(a.id)}" ${a.id === gewaehlt ? 'selected' : ''}>${esc(a.name)}${a.iban ? ` (${esc(a.iban)})` : ''}</option>`).join('');
}

function schrittDatei(host, root) {
  const konten = sel.accounts().filter((a) => a.active !== false);
  if (!st.kontoId || !konten.some((a) => a.id === st.kontoId)) st.kontoId = (konten.find((a) => a.kind === 'bank') || konten[0])?.id || '';
  const importe = (store.db.imports || []).slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  host.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="field" style="max-width:420px">
          <label for="kiKonto">Zahlungskonto</label>
          <select id="kiKonto">${kontoOptionen(st.kontoId)}</select>
          <span class="hint">Auf dieses Konto werden die Umsätze gebucht. Kontovia wählt es selbst, wenn die IBAN in der Datei zu einem Konto passt.</span>
        </div>
        <div class="ki-drop" id="kiDrop">
          ${icon('bank', 28).__raw}
          <strong>Kontoauszug hierher ziehen oder auswählen</strong>
          <span class="small muted">CSV (Sparkasse, Volksbank, ING, DKB und andere), CAMT.053 (XML) und MT940</span>
          <button class="btn primary mt8" id="kiWahl" type="button">${icon('plus', 15).__raw} Datei wählen</button>
          <input type="file" id="kiDatei" hidden accept=".csv,.txt,.tsv,.xml,.sta,.mt940,.940,.camt,.stm">
        </div>
        <p class="small muted mb0 mt16" id="kiStatus" role="status">Die Datei wird nur auf diesem Gerät gelesen. Sie wird nicht hochgeladen und nirgends gespeichert. Gebucht wird erst, wenn Sie es bestätigen.</p>
      </div>
    </div>
    ${importe.length ? '<div class="card mt16"><div class="card-head"><h2>Frühere Importe</h2></div><div id="kiFrueher"></div></div>' : ''}`;

  $('#kiKonto', host).addEventListener('change', (e) => { st.kontoId = e.currentTarget.value; });
  const input = $('#kiDatei', host);
  $('#kiWahl', host).addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  // Ein Klick irgendwo in die Fläche wählt ebenfalls; mit der Tastatur geht es über den Knopf darin.
  $('#kiDrop', host).addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files?.[0]) dateiLesen(input.files[0], root); });
  const drop = $('#kiDrop', host);
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('ueber'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('ueber'); });
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) dateiLesen(f, root); });

  if (importe.length) {
    mountTable($('#kiFrueher', host), {
      id: 'kontoimport-frueher',
      cls: 'data',
      rows: importe,
      unit: ['Import', 'Importe'],
      columns: [
        { key: 'ts', label: 'Wann', type: 'date', tdCls: 'nowrap', value: (i) => i.ts, cell: (i) => esc(fmtDateTime(i.ts)) },
        { key: 'datei', label: 'Datei', type: 'text', tdCls: 'strong', value: (i) => i.datei, cell: (i) => esc(i.datei) },
        { key: 'konto', label: 'Konto', type: 'text', cls: 'col-mh-opt', tdCls: 'small col-mh-opt', value: (i) => sel.accountName(i.kontoId), cell: (i) => esc(sel.accountName(i.kontoId)) },
        { key: 'zeit', label: 'Zeitraum', type: 'text', cls: 'col-mh-opt', tdCls: 'small nowrap col-mh-opt', value: (i) => i.von, cell: (i) => (i.von ? `${esc(fmtDate(i.von))} bis ${esc(fmtDate(i.bis))}` : '') },
        { key: 'n', label: 'Gebucht', type: 'num', value: (i) => (i.gebucht || 0) + (i.bezahlt || 0), cell: (i) => `${int(i.gebucht || 0)} neu, ${int(i.bezahlt || 0)} zugeordnet` },
      ],
    });
  }
}

async function dateiLesen(datei, root) {
  const status = $('#kiStatus', root);
  const meld = (t) => { if (status) status.textContent = t; };
  meld('Die Datei wird gelesen …');
  await atmen();
  try {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    let res = kontoauszugLesen(bytes, datei.name);
    st.vorlage = '';
    st.opt = {};
    if (res.format === 'csv' && res.signatur) {
      const v = vorlageFuer(res.signatur, res.kopf);
      if (v) {
        st.opt = { trenner: v.trenner, spalten: v.spalten, dezimal: v.dezimal };
        res = kontoauszugLesen(bytes, datei.name, st.opt);
        st.vorlage = v.vorlage.name;
        st.vorlageMerken = false;
      } else { st.vorlageMerken = true; }
    }
    if (!res.umsaetze.length && res.format !== 'csv') throw new Error('In der Datei stehen keine Umsätze.');
    st.bytes = bytes; st.name = datei.name; st.gelesen = res;
    const iban = IBAN_KURZ(res.konto?.iban);
    const passend = iban && sel.accounts().find((a) => IBAN_KURZ(a.iban) === iban);
    if (passend) st.kontoId = passend.id;
    st.vorlageName = st.vorlageName || datei.name.replace(/\.[^.]+$/, '').slice(0, 40);
    if (res.format === 'csv') { st.schritt = 'spalten'; zeichnen(root); return; }
    await weiterZuPruefen(root);
  } catch (e) {
    st.bytes = null; st.gelesen = null;
    meld('');
    err('Die Datei lässt sich nicht lesen', e.message || 'Unbekanntes Format.');
  }
}

/* -------------------------------------------------------------------------- */
/* Schritt 2: Spalten (nur CSV)                                                */
/* -------------------------------------------------------------------------- */

function neuLesen(root) {
  try {
    st.gelesen = kontoauszugLesen(st.bytes, st.name, st.opt);
  } catch (e) { err('Nicht lesbar', e.message); }
  zeichnen(root);
}

function schrittSpalten(host, root) {
  const g = st.gelesen;
  const rolleVon = (i) => Object.entries(g.spalten).find(([, n]) => n === i)?.[0] || '';
  const proben = (i) => g.zeilen.slice(g.kopfzeile + 1).map((z) => String(z[i] ?? '').trim()).filter(Boolean).slice(0, 3);
  const z = zusammenfassung(g.umsaetze);
  const fehlt = ['datum', 'betrag'].filter((k) => !(k in g.spalten) && !(k === 'betrag' && ('soll' in g.spalten || 'haben' in g.spalten)));
  const trennerName = { ';': 'Semikolon', ',': 'Komma', '\t': 'Tabulator', '|': 'Senkrechter Strich' };
  host.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>${icon('table', 16).__raw} ${esc(st.name)}</h2><span class="sub">${esc(g.kodierung)}</span></div>
      <div class="card-body">
        ${st.vorlage ? `<div class="notice ok mb16">Die gemerkte Zuordnung „${esc(st.vorlage)}“ wurde angewendet.</div>` : ''}
        <p class="mt0">${z.anzahl ? `<strong>${int(z.anzahl)} Umsätze</strong> erkannt, vom ${esc(fmtDate(z.von))} bis ${esc(fmtDate(z.bis))}: Eingänge ${esc(money(z.eingang))} €, Ausgänge ${esc(money(Math.abs(z.ausgang)))} €.` : '<strong>Noch keine Umsätze erkannt.</strong> Bitte ordnen Sie unten mindestens Buchungstag und Betrag zu.'}
          ${g.uebersprungen.length ? ` ${int(g.uebersprungen.length)} ${g.uebersprungen.length === 1 ? 'Zeile wurde' : 'Zeilen wurden'} übersprungen.` : ''}</p>
        ${fehlt.length ? `<div class="notice warn mb16">Es fehlt noch: ${fehlt.map((k) => esc(SPALTENROLLEN[k])).join(', ')}.</div>` : ''}
        <div class="form-grid">
          <div class="field"><label for="kiTrenner">Trennzeichen</label><select id="kiTrenner">${Object.entries(trennerName).map(([k, t]) => `<option value="${esc(k)}" ${g.trenner === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label for="kiDez">Dezimalzeichen bei Beträgen</label><select id="kiDez">${[['komma', 'Komma (1.234,56)'], ['punkt', 'Punkt (1,234.56)']].map(([k, t]) => `<option value="${k}" ${g.dezimal === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label for="kiKopf">Zeile mit den Überschriften</label><input id="kiKopf" type="number" min="1" value="${g.kopfzeile >= 0 ? g.kopfzeile + 1 : 1}"><span class="hint">Zeilen davor, etwa Angaben der Bank, werden übersprungen.</span></div>
        </div>
        <div class="table-wrap mt16"><table class="data compact ki-spalten">
          <thead><tr><th>Überschrift in der Datei</th><th>Bedeutung</th><th class="col-mh-opt">Beispiele</th></tr></thead>
          <tbody>${g.kopf.map((k, i) => `<tr>
            <td class="strong">${esc(k || `Spalte ${i + 1}`)}</td>
            <td><select data-spalte="${i}" aria-label="Bedeutung der Spalte ${esc(k || i + 1)}"><option value="">Nicht verwenden</option>${Object.entries(SPALTENROLLEN).map(([r, t]) => `<option value="${r}" ${rolleVon(i) === r ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
            <td class="small muted col-mh-opt">${proben(i).map(esc).join(' · ')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Keine Überschriften gefunden. Geben Sie oben die Zeile der Überschriften an.</td></tr>'}</tbody>
        </table></div>
        ${g.umsaetze.length ? `<h3 class="mt16 mb8">So sehen die ersten Umsätze aus</h3>
        <div class="table-wrap"><table class="data compact"><thead><tr><th>Datum</th><th>Gegenseite</th><th class="col-mh-opt">Verwendungszweck</th><th class="right">Betrag</th></tr></thead><tbody>
          ${g.umsaetze.slice(0, 6).map((u) => `<tr><td class="nowrap">${esc(fmtDate(u.datum))}</td><td>${esc(u.gegenseite)}</td><td class="small muted col-mh-opt truncate">${esc(u.zweck)}</td><td class="right num ${u.betrag < 0 ? 'neg' : 'pos'}">${esc(money(u.betrag))} €</td></tr>`).join('')}
        </tbody></table></div>` : ''}
        ${g.uebersprungen.length ? `<details class="mt16"><summary>Übersprungene Zeilen (${int(g.uebersprungen.length)})</summary><ul class="small mt8">${g.uebersprungen.slice(0, 30).map((u) => `<li>Zeile ${u.zeile}: ${esc(u.grund)}${u.text ? `, „${esc(u.text)}“` : ''}</li>`).join('')}</ul></details>` : ''}
        <div class="row wrap mt16" style="gap:10px;align-items:center">
          <label class="check"><input type="checkbox" id="kiMerken" ${st.vorlageMerken ? 'checked' : ''}> <span>Diese Zuordnung für künftige Dateien dieser Bank merken</span></label>
          <input id="kiVorName" value="${esc(st.vorlageName)}" style="max-width:240px" aria-label="Name der Vorlage" placeholder="Name der Vorlage">
        </div>
      </div>
    </div>
    <div class="row end mt16 mb16" style="gap:8px">
      <button class="btn" id="kiZurueck">${icon('left', 15).__raw} Andere Datei</button>
      <button class="btn primary" id="kiWeiter" ${g.umsaetze.length ? '' : 'disabled'}>Weiter zum Prüfen</button>
    </div>`;

  const aendern = (fn) => { st.opt = fn({ ...st.opt }); neuLesen(root); };
  $('#kiTrenner', host).addEventListener('change', (e) => aendern((o) => ({ ...o, trenner: e.currentTarget.value, spalten: undefined, kopfzeile: undefined })));
  $('#kiDez', host).addEventListener('change', (e) => aendern((o) => ({ ...o, dezimal: e.currentTarget.value })));
  $('#kiKopf', host).addEventListener('change', (e) => aendern((o) => ({ ...o, kopfzeile: Math.max(0, Number(e.currentTarget.value) - 1), spalten: undefined })));
  $$('[data-spalte]', host).forEach((s) => s.addEventListener('change', () => {
    const i = Number(s.dataset.spalte);
    const neu = s.value;
    const soll = { ...g.spalten };
    for (const r of Object.keys(soll)) if (soll[r] === i) delete soll[r];
    if (neu) soll[neu] = i;
    const opt = {};
    for (const r of Object.keys(SPALTENROLLEN)) opt[r] = r in soll ? soll[r] : (r in g.erkannt ? -1 : undefined);
    for (const r of Object.keys(opt)) if (opt[r] === undefined) delete opt[r];
    aendern((o) => ({ ...o, spalten: opt }));
  }));
  $('#kiMerken', host).addEventListener('change', (e) => { st.vorlageMerken = e.currentTarget.checked; });
  $('#kiVorName', host).addEventListener('input', (e) => { st.vorlageName = e.currentTarget.value; });
  $('#kiZurueck', host).addEventListener('click', () => { st = neuStart(); zeichnen(root); });
  $('#kiWeiter', host).addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (st.vorlageMerken && g.signatur) {
        await vorlageSpeichern({ name: st.vorlageName, signatur: g.signatur, trenner: g.trenner, spalten: g.spalten, kopf: g.kopf, dezimal: g.dezimal });
      }
      await weiterZuPruefen(root);
    } catch (ex) { err('Das hat nicht geklappt', ex.message); e.currentTarget.disabled = false; }
  });
}

/* -------------------------------------------------------------------------- */
/* Schritt 3: Prüfen                                                           */
/* -------------------------------------------------------------------------- */

async function weiterZuPruefen(root) {
  st.schritt = 'pruefen';
  st.zeilen = [];
  zeichnen(root);
  const status = $('#kiPrueflauf', root);
  const meld = (t) => { if (status) status.textContent = t; };
  await atmen();
  const umsaetze = st.gelesen.umsaetze;
  const hashes = await fingerabdruecke(umsaetze, st.kontoId, async (n, gesamt) => { meld(`Umsätze werden geprüft: ${int(n)} von ${int(gesamt)} …`); await atmen(); });
  meld('Umsätze werden zugeordnet …');
  await atmen();
  st.ctx = zuordnungsKontext(store.db, { kontoId: st.kontoId });
  st.zeilen = await zuordnen(umsaetze, hashes, st.ctx, { atmen });
  for (const z of st.zeilen) z.gewaehlt = vorausgewaehlt(z) && pruefen(z).ok;
  st.filter = 'alle';
  zeichnen(root);
}

const pruefen = (z) => zeilePruefen(z, { kontoId: st.kontoId });

const FILTER = [
  ['alle', 'Alle', () => true],
  ['sicher', 'Sicher', (z) => !z.schonImportiert && z.sicherheit === 'sicher'],
  ['pruefen', 'Zu prüfen', (z) => !z.schonImportiert && (z.sicherheit === 'wahrscheinlich' || z.sicherheit === 'unsicher')],
  ['regel', 'Eigene Regel', (z) => !z.schonImportiert && (z.sicherheit === 'regel' || z.sicherheit === 'hand')],
  ['vorschlag', 'Kategorie-Vorschlag', (z) => !z.schonImportiert && z.sicherheit === 'vorschlag'],
  ['keine', 'Ohne Zuordnung', (z) => !z.schonImportiert && z.sicherheit === 'keine'],
  ['dublette', 'Mögliche Dublette', (z) => !z.schonImportiert && !!z.dublette],
  ['schon', 'Schon importiert', (z) => z.schonImportiert],
];

const kategorieName = (id) => sel.category(id)?.name || 'Ohne Kategorie';

function zielText(z) {
  if (z.art === 'rechnung') {
    const r = z.ziele.map((t) => `Rechnung ${t.nummer}${t.kunde ? ` (${t.kunde})` : ''}`).join(', ');
    return `${r}${z.mahnkosten ? `, dazu Mahnkosten ${money(z.mahnkosten)} €` : ''}${z.hinweis ? `, ${z.hinweis}` : ''}`;
  }
  if (z.art === 'ausgabe') return `Offene Ausgabe: ${sel.transaction(z.txId)?.description || ''}`;
  if (z.art === 'wiederkehrend') return `Wiederkehrende Buchung ${sel.recurringRule(z.wiederkehrendId)?.template?.description || ''}`;
  if (z.art === 'regel' || z.art === 'neu') {
    const was = z.u.betrag > 0 ? 'Einnahme' : 'Ausgabe';
    if (!z.kategorieId) return `Neue ${was}, ohne Kategorie`;
    return `Neue ${was}, Kategorie ${kategorieName(z.kategorieId)}${z.sicherheit === 'vorschlag' && z.gruppe && z.gruppe !== kategorieName(z.kategorieId) ? ` (erkannt: ${z.gruppe})` : ''}`;
  }
  return 'Bitte zuordnen, eine Kategorie wählen oder ohne Kategorie buchen';
}

const BADGE = { sicher: 'pos', wahrscheinlich: 'info', unsicher: 'warn', regel: 'info', vorschlag: 'info', hand: 'info', keine: 'plain' };

/** Zeilen, die ohne Zuordnung dastehen und sich im Eiltempo ohne Kategorie buchen lassen. */
const ohneZuordnung = (z) => !z.schonImportiert && !z.dublette && !z.ausgeschlossen && z.art === 'keine' && pruefen({ ...z, art: 'neu', ohneKategorie: true }).ok;
const vorschlaege = (z) => !z.schonImportiert && !z.dublette && z.sicherheit === 'vorschlag' && pruefen(z).ok;

function schrittPruefen(host, root) {
  const g = st.gelesen;
  if (!st.zeilen.length) {
    host.innerHTML = `<div class="card"><div class="card-body"><p class="mt0" id="kiPrueflauf" role="status">Die Umsätze werden geprüft …</p></div></div>`;
    return;
  }
  const z = zusammenfassung(g.umsaetze);
  const n = zaehlen(st.zeilen);
  const konto = sel.account(st.kontoId);
  host.innerHTML = `
    <div class="card mb16"><div class="card-body">
      <div class="row between wrap" style="gap:10px">
        <div><strong>${esc(st.name)}</strong><div class="small muted">${esc(g.format === 'csv' ? 'CSV' : g.format === 'camt' ? 'CAMT.053' : 'MT940')}, ${int(z.anzahl)} Umsätze vom ${esc(fmtDate(z.von))} bis ${esc(fmtDate(z.bis))}, Konto ${esc(konto?.name || '')}</div></div>
        <button class="btn sm" id="kiAnders">${icon('left', 14).__raw} Andere Datei</button>
      </div>
      <p class="small mb0 mt8">Nichts ist gebucht. Ausgewählt sind nur sichere Treffer und Ihre eigenen Regeln. Kategorie-Vorschläge entstehen auf diesem Gerät aus Ihren früheren Buchungen und bekannten Händlernamen, nichts davon wird übertragen. Prüfen Sie den Rest und haken Sie an, was gebucht werden soll. Wer es eilig hat, bucht den Rest auch ohne Kategorie und ordnet später zu.</p>
    </div></div>
    <div class="ki-filter mb8" role="group" aria-label="Anzeige">${FILTER.map(([k, t, f]) => {
    const anz = k === 'alle' ? n.gesamt : st.zeilen.filter(f).length;
    return `<button type="button" class="chip ${st.filter === k ? 'active' : ''}" data-filter="${k}" ${anz || k === 'alle' ? '' : 'disabled'}>${esc(t)} <span class="muted">${int(anz)}</span></button>`;
  }).join('')}</div>
    <div class="row wrap mb8" style="gap:8px">
      <button class="btn sm" id="kiSichere">Alle sicheren auswählen</button>
      <button class="btn sm" id="kiVorschlaege" ${st.zeilen.some(vorschlaege) ? '' : 'disabled'}>Vorschläge auswählen (${int(st.zeilen.filter(vorschlaege).length)})</button>
      <button class="btn sm" id="kiOhne" ${st.zeilen.some(ohneZuordnung) ? '' : 'disabled'} title="Bucht diese Umsätze ohne Kategorie. Die Kategorie lässt sich später in der Buchungsliste ergänzen.">Rest ohne Kategorie auswählen (${int(st.zeilen.filter(ohneZuordnung).length)})</button>
      <button class="btn sm ghost" id="kiNichts">Auswahl aufheben</button>
    </div>
    <div class="card" id="kiTabelle"></div>
    <div class="row between wrap mt16 mb16 apply-bar dirty" id="kiFuss" style="gap:10px"><span id="kiSumme" class="small"></span>
      <button class="btn primary lg" id="kiBuchen">Buchen</button></div>`;

  $('#kiAnders', host).addEventListener('click', async () => {
    if (st.zeilen.some((x) => x.gewaehlt) && !(await verlassen())) return;
    st = neuStart();
    zeichnen(root);
  });
  $$('[data-filter]', host).forEach((b) => b.addEventListener('click', () => { st.filter = b.dataset.filter; schrittPruefen(host, root); }));
  $('#kiSichere', host).addEventListener('click', () => { for (const x of st.zeilen) if (vorausgewaehlt(x) && pruefen(x).ok) x.gewaehlt = true; schrittPruefen(host, root); });
  $('#kiVorschlaege', host).addEventListener('click', () => { for (const x of st.zeilen) if (vorschlaege(x)) x.gewaehlt = true; schrittPruefen(host, root); });
  $('#kiOhne', host).addEventListener('click', () => {
    for (const x of st.zeilen) {
      if (!ohneZuordnung(x)) continue;
      Object.assign(x, { art: 'neu', ohneKategorie: true, kategorieId: '', sicherheit: 'hand', gruende: ['Von Ihnen gewählt: ohne Kategorie'], gewaehlt: true });
    }
    schrittPruefen(host, root);
  });
  $('#kiNichts', host).addEventListener('click', () => { for (const x of st.zeilen) x.gewaehlt = false; schrittPruefen(host, root); });
  $('#kiBuchen', host).addEventListener('click', () => buchenFrage(root));

  const filter = FILTER.find(([k]) => k === st.filter)[2];
  const summe = () => {
    const gew = st.zeilen.filter((x) => x.gewaehlt);
    const zahlungen = gew.filter((x) => x.art === 'rechnung' || x.art === 'ausgabe').length;
    const neu = gew.length - zahlungen;
    const ein = gew.filter((x) => x.u.betrag > 0).reduce((s, x) => s + x.u.betrag, 0);
    const aus = gew.filter((x) => x.u.betrag < 0).reduce((s, x) => s + x.u.betrag, 0);
    $('#kiSumme', host).innerHTML = gew.length
      ? `<strong>${int(gew.length)} ausgewählt:</strong> ${int(zahlungen)} ${zahlungen === 1 ? 'Zahlung' : 'Zahlungen'} zu offenen Posten, ${int(neu)} neue ${neu === 1 ? 'Buchung' : 'Buchungen'}. Eingänge ${esc(money(ein))} €, Ausgänge ${esc(money(Math.abs(aus)))} €.`
      : 'Nichts ausgewählt.';
    $('#kiBuchen', host).disabled = !gew.length;
    $('#kiBuchen', host).textContent = gew.length ? `${int(gew.length)} ${gew.length === 1 ? 'Umsatz' : 'Umsätze'} buchen …` : 'Buchen';
    router.leaveGuard = gew.length ? verlassen : null;
  };
  summe();

  mountTable($('#kiTabelle', host), {
    id: 'kontoimport-pruefen',
    cls: 'data ki-list',
    defaultSort: { key: 'datum', dir: 1 },
    rows: st.zeilen.filter(filter),
    unit: ['Umsatz', 'Umsätze'],
    search: { placeholder: 'Name, Verwendungszweck oder Betrag suchen …', text: (x) => [x.u.gegenseite, x.u.zweck, x.u.gegenIban, money(x.u.betrag)].join(' ') },
    columns: [
      {
        key: 'wahl', label: '', type: 'none', width: '44px',
        cell: (x) => { const p = x.schonImportiert && !x.trotzdem ? { ok: false } : pruefen(x); return `<input type="checkbox" data-wahl="${x.index}" ${x.gewaehlt ? 'checked' : ''} ${p.ok ? '' : 'disabled'} aria-label="Umsatz vom ${esc(fmtDate(x.u.datum))} buchen" ${p.ok ? '' : `title="${esc(x.schonImportiert ? 'Schon importiert' : p.grund)}"`}>`; },
      },
      { key: 'datum', label: 'Datum', type: 'date', tdCls: 'nowrap', value: (x) => x.u.datum, cell: (x) => esc(fmtDate(x.u.datum)) },
      {
        key: 'text', label: 'Gegenseite und Verwendungszweck', type: 'text', value: (x) => x.u.gegenseite,
        cell: (x) => `<span class="strong">${esc(x.u.gegenseite || '–')}</span><div class="tiny muted truncate" style="max-width:340px">${esc(x.u.zweck)}</div>`,
      },
      { key: 'betrag', label: 'Betrag', type: 'num', value: (x) => x.u.betrag, cell: (x) => `<span class="${x.u.betrag < 0 ? 'neg' : 'pos'} nowrap">${esc(money(x.u.betrag, { sign: true }))} €</span>` },
      {
        key: 'zuordnung', label: 'Zuordnung', type: 'text', value: (x) => (x.schonImportiert ? 'zzz' : x.sicherheit),
        cell: (x) => {
          if (x.schonImportiert) return '<span class="badge plain">Schon importiert</span>';
          const p = pruefen(x);
          return `<span class="badge ${BADGE[x.sicherheit] || 'plain'}" title="${esc(x.gruende.join('. '))}">${esc(SICHERHEIT[x.sicherheit] || 'Von Ihnen gewählt')}</span>
            <span class="small">${esc(zielText(x))}</span>
            ${x.dublette ? `<div class="tiny" style="color:var(--warn)">Mögliche Dublette: ${esc(x.dublette.text)}</div>` : ''}
            ${!p.ok && x.art !== 'keine' ? `<div class="tiny neg">${esc(p.grund)}</div>` : ''}`;
        },
      },
      { key: 'aktion', label: '', type: 'none', width: '90px', cls: 'right', tdCls: 'nowrap', cell: (x) => `<button class="btn sm" data-aendern="${x.index}">Ändern</button>` },
    ],
    emptyTitle: 'Keine Umsätze in dieser Ansicht',
    emptyText: 'Wählen Sie oben eine andere Anzeige.',
    onRender: (el) => {
      spaltenKlassen(el, ['ki-wahl', 'ki-datum', 'ki-text', 'ki-betrag', 'ki-zu', 'ki-akt']);
      $$('[data-wahl]', el).forEach((c) => c.addEventListener('change', () => { st.zeilen[Number(c.dataset.wahl)].gewaehlt = c.checked; summe(); }));
      $$('[data-aendern]', el).forEach((b) => b.addEventListener('click', () => zeileDialog(st.zeilen[Number(b.dataset.aendern)], () => schrittPruefen(host, root))));
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Zeile ändern                                                                */
/* -------------------------------------------------------------------------- */

function kategorieOptionen(art, gewaehlt) {
  const kind = art > 0 ? 'income' : 'expense';
  return sel.activeCategories(kind).map((c) => `<option value="${esc(c.id)}" ${c.id === gewaehlt ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function zeileDialog(z, fertig) {
  const u = z.u;
  const ein = u.betrag > 0;
  const rechnungen = st.ctx.rechnungen;
  const ausgaben = st.ctx.ausgaben;
  let modus = z.art === 'rechnung' || z.art === 'ausgabe' ? 'zuordnen' : (z.art === 'neu' || z.art === 'regel' ? 'neu' : (z.art === 'wiederkehrend' ? 'wiederkehrend' : 'neu'));
  if (z.art === 'keine') modus = 'neu';
  const kontakte = sel.contacts();
  const m = modal({
    title: 'Umsatz zuordnen',
    body: `
      <p class="mt0 small"><strong>${esc(fmtDate(u.datum))}</strong> · <span class="${ein ? 'pos' : 'neg'}">${esc(money(u.betrag, { sign: true }))} €</span> · ${esc(u.gegenseite)}<br><span class="muted">${esc(u.zweck)}</span></p>
      ${z.dublette ? `<div class="notice warn mb16">Mögliche Dublette: ${esc(z.dublette.text)}. Haken Sie den Umsatz nur an, wenn es eine andere Zahlung ist.</div>` : ''}
      ${z.schonImportiert ? `<div class="notice warn mb16">Dieser Umsatz ist schon importiert. <label class="check mt8"><input type="checkbox" id="zdTrotzdem" ${z.trotzdem ? 'checked' : ''}> <span>Trotzdem noch einmal buchen</span></label></div>` : ''}
      <div class="seg mb16" role="group" aria-label="Zuordnung">
        <button type="button" data-modus="zuordnen" class="${modus === 'zuordnen' ? 'active' : ''}">${ein ? 'Zu einer offenen Rechnung' : 'Zu einer offenen Ausgabe'}</button>
        <button type="button" data-modus="neu" class="${modus === 'neu' ? 'active' : ''}">Als neue Buchung</button>
        <button type="button" data-modus="aus" class="${modus === 'aus' ? 'active' : ''}">Nicht buchen</button>
      </div>
      <div id="zdZuordnen" ${modus === 'zuordnen' ? '' : 'hidden'}>
        <div class="field"><label for="zdZiel">${ein ? 'Offene Rechnung' : 'Offene Ausgabe'}</label>
          <select id="zdZiel"><option value="">Bitte wählen</option>${ein
    ? rechnungen.map((r) => `<option value="${esc(r.id)}" ${z.ziele?.[0]?.rechnungId === r.id ? 'selected' : ''}>${esc(r.nummer)} · ${esc(r.kunde)} · offen ${esc(money(r.rest))} €${r.nebenOffen ? ` + Mahnkosten ${esc(money(r.nebenOffen))} €` : ''}</option>`).join('')
    : ausgaben.map((a) => `<option value="${esc(a.txId)}" ${z.txId === a.txId ? 'selected' : ''}>${esc(a.text || a.nummer)} · ${esc(money(a.gross))} € · ${esc(fmtDate(a.datum))}</option>`).join('')}</select></div>
        <label class="check" id="zdKostenBox" hidden><input type="checkbox" id="zdKosten"> <span id="zdKostenText"></span></label>
        <p class="small mb0 mt8" id="zdPruefung"></p>
      </div>
      <div id="zdNeu" ${modus === 'neu' ? '' : 'hidden'}>
        <div class="form-grid">
          <div class="field full"><label for="zdKat">Kategorie</label><select id="zdKat"><option value="">Ohne Kategorie buchen (später zuordnen)</option>${kategorieOptionen(u.betrag, z.kategorieId)}</select>
            <span class="hint" id="zdKatHinweis" ${z.kategorieId ? 'hidden' : ''}>Ohne Kategorie zählt die Buchung in der Steuerübersicht (EÜR) noch nicht mit und wird ohne Umsatzsteuer gebucht. Die Kategorie lässt sich in der Buchungsliste jederzeit ergänzen.</span></div>
          <div class="field"><label for="zdKontakt">Kontakt</label><select id="zdKontakt"><option value="">Keiner</option>${kontakte.map((c) => `<option value="${esc(c.id)}" ${z.kontaktId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="zdText">Beschreibung</label><input id="zdText" value="${esc(z.beschreibung || '')}" placeholder="${esc([u.gegenseite, u.zweck].filter(Boolean).join(': ').slice(0, 80))}"></div>
        </div>
        <label class="check mt8"><input type="checkbox" id="zdRegel"> <span>Für ähnliche Umsätze künftig so vorschlagen (Regel merken)</span></label>
        <div class="form-grid mt8" id="zdRegelFelder" hidden>
          <div class="field"><label for="zdRegelFeld">Wenn</label><select id="zdRegelFeld"><option value="gegenseite">die Gegenseite</option><option value="zweck">der Verwendungszweck</option><option value="alle">irgendein Text</option></select></div>
          <div class="field"><label for="zdRegelText">enthält</label><input id="zdRegelText" value="${esc(u.gegenseite)}"></div>
        </div>
      </div>`,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
  });
  const g = (id) => m.root.querySelector(`#${id}`);
  const zeigen = () => {
    g('zdZuordnen').hidden = modus !== 'zuordnen';
    g('zdNeu').hidden = modus !== 'neu';
    $$('[data-modus]', m.root).forEach((b) => b.classList.toggle('active', b.dataset.modus === modus));
  };
  const kopie = () => ({ ...z, ziele: z.ziele ? [...z.ziele] : [] });
  /** Die Zeile so, wie sie nach „Übernehmen“ aussähe, damit der Dialog gleich sagt, ob es geht. */
  const entwurf = () => {
    const k = kopie();
    k.trotzdem = g('zdTrotzdem') ? g('zdTrotzdem').checked : z.trotzdem;
    k.restSkonto = g('zdSkonto') ? g('zdSkonto').checked : !!z.restSkonto;
    if (modus === 'zuordnen') {
      if (ein) {
        const r = rechnungen.find((x) => x.id === g('zdZiel').value);
        k.art = 'rechnung'; k.txId = '';
        k.ziele = r ? [{ rechnungId: r.id, nummer: r.nummer, kunde: r.kunde, rest: r.rest, nebenOffen: r.nebenOffen, txIds: r.offeneTxIds }] : [];
        k.mahnkosten = r && g('zdKosten').checked ? r.nebenOffen : 0;
      } else { k.art = 'ausgabe'; k.txId = g('zdZiel').value; k.ziele = []; k.mahnkosten = 0; }
    } else if (modus === 'neu') {
      k.art = 'neu'; k.ziele = []; k.txId = ''; k.mahnkosten = 0; k.kategorieId = g('zdKat').value; k.ohneKategorie = !k.kategorieId; k.kontaktId = g('zdKontakt').value; k.beschreibung = g('zdText').value.trim();
    } else { k.art = 'keine'; k.ziele = []; k.txId = ''; k.mahnkosten = 0; }
    if (modus !== 'neu') k.ohneKategorie = false;
    return k;
  };
  const aktualisieren = () => {
    if (ein && modus === 'zuordnen') {
      const r = rechnungen.find((x) => x.id === g('zdZiel').value);
      g('zdKostenBox').hidden = !(r && r.nebenOffen > 0);
      if (r && r.nebenOffen > 0) {
        g('zdKostenText').textContent = `Mahnkosten ${money(r.nebenOffen)} € sind mit gezahlt`;
        if (!g('zdKosten').dataset.beruehrt) g('zdKosten').checked = u.betrag === r.rest + r.nebenOffen;
      }
    }
    const k = entwurf();
    const p = modus === 'zuordnen' ? (k.ziele.length || k.txId ? pruefen(k) : { ok: false, grund: 'Bitte wählen.' }) : { ok: true };
    g('zdPruefung').innerHTML = modus === 'zuordnen' ? (p.ok ? (p.teilzahlung ? `<span class="muted">Das ist eine Teilzahlung: ${esc(money(u.betrag))} € werden verbucht, der Rest bleibt offen.</span>
      <label class="check mt8"><input type="checkbox" id="zdSkonto" ${k.restSkonto ? 'checked' : ''}> Den Rest als Skonto ausbuchen (der Kunde durfte weniger zahlen)</label>` : '<span class="pos">Passt.</span>') : `<span class="neg">${esc(p.grund)}</span>`) : '';
  };
  $$('[data-modus]', m.root).forEach((b) => b.addEventListener('click', () => { modus = b.dataset.modus; zeigen(); aktualisieren(); }));
  g('zdZiel')?.addEventListener('change', () => { g('zdKosten').dataset.beruehrt = ''; aktualisieren(); });
  g('zdKosten').addEventListener('change', () => { g('zdKosten').dataset.beruehrt = '1'; aktualisieren(); });
  g('zdRegel').addEventListener('change', () => { g('zdRegelFelder').hidden = !g('zdRegel').checked; });
  g('zdKat').addEventListener('change', () => { g('zdKatHinweis').hidden = !!g('zdKat').value; });
  g('zdTrotzdem')?.addEventListener('change', aktualisieren);
  if (modus === 'zuordnen') aktualisieren();

  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    const k = entwurf();
    if (modus === 'neu') {
      if (g('zdRegel').checked) {
        if (!k.kategorieId) { warn('Für eine Regel bitte eine Kategorie wählen'); return; }
        try {
          await regelSpeichern({ name: g('zdRegelText').value.trim(), feld: g('zdRegelFeld').value, enthaelt: g('zdRegelText').value.trim(), richtung: ein ? 'ein' : 'aus', kategorieId: k.kategorieId, kontaktId: k.kontaktId, beschreibung: k.beschreibung });
          ok('Regel gemerkt', `Wenn „${g('zdRegelText').value.trim()}“ vorkommt, schlägt Kontovia diese Kategorie vor.`);
        } catch (ex) { err('Regel nicht gespeichert', ex.message); return; }
      }
    }
    if (modus === 'zuordnen' && !(k.ziele.length || k.txId)) { warn('Bitte wählen'); return; }
    Object.assign(z, k);
    z.sicherheit = modus === 'aus' ? 'keine' : 'hand';
    z.gruppe = '';
    z.ausgeschlossen = modus === 'aus';
    z.gruende = modus === 'aus' ? [] : [k.ohneKategorie ? 'Von Ihnen gewählt: ohne Kategorie' : 'Von Ihnen gewählt'];
    z.regel = null; z.hinweis = '';
    z.gewaehlt = modus !== 'aus' && pruefen(z).ok && (!z.schonImportiert || !!z.trotzdem);
    m.close();
    fertig();
  });
}

/* -------------------------------------------------------------------------- */
/* Buchen                                                                      */
/* -------------------------------------------------------------------------- */

async function buchenFrage(root) {
  const gew = st.zeilen.filter((x) => x.gewaehlt);
  const zahlungen = gew.filter((x) => x.art === 'rechnung' || x.art === 'ausgabe');
  const neu = gew.filter((x) => !(x.art === 'rechnung' || x.art === 'ausgabe'));
  const unsicher = gew.filter((x) => ['unsicher', 'wahrscheinlich'].includes(x.sicherheit)).length;
  const ohneKat = neu.filter((x) => !x.kategorieId && (x.art === 'neu' || x.art === 'regel')).length;
  const ja = await confirmDialog({
    title: `${int(gew.length)} ${gew.length === 1 ? 'Umsatz' : 'Umsätze'} buchen?`,
    text: `${int(zahlungen.length)} ${zahlungen.length === 1 ? 'Zahlung wird' : 'Zahlungen werden'} offenen Rechnungen und Ausgaben zugeordnet, ${int(neu.length)} neue ${neu.length === 1 ? 'Buchung wird' : 'Buchungen werden'} angelegt, jeweils mit Hinweis auf die Datei „${st.name}“.${unsicher ? ` ${int(unsicher)} davon ${unsicher === 1 ? 'ist' : 'sind'} nicht sicher zugeordnet, Sie haben ${unsicher === 1 ? 'sie' : 'sie'} selbst angehakt.` : ''} ${ohneKat ? ` ${int(ohneKat)} ${ohneKat === 1 ? 'Buchung bekommt' : 'Buchungen bekommen'} keine Kategorie: ${ohneKat === 1 ? 'Sie zählt' : 'Sie zählen'} in der Steuerübersicht erst mit, wenn Sie eine Kategorie ergänzen.` : ''} Eine Buchung lässt sich danach nur noch stornieren.`,
    confirmLabel: 'Jetzt buchen',
  });
  if (!ja) return;
  const fenster = modal({
    title: 'Es wird gebucht',
    closable: false,
    body: '<p class="mt0" id="kbText" role="status">Einen Moment …</p><div class="progress" style="height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden"><div id="kbBalken" style="height:100%;width:0;background:var(--accent)"></div></div>',
  });
  await atmen();
  const z = zusammenfassung(st.gelesen.umsaetze);
  let erg;
  try {
    erg = await importBuchen(gew, {
      kontoId: st.kontoId, datei: st.name, format: st.gelesen.format, kodierung: st.gelesen.kodierung, gesamt: st.gelesen.umsaetze.length, von: z.von, bis: z.bis,
      fortschritt: async (n, gesamt) => {
        const t = $('#kbText', fenster.root); const b = $('#kbBalken', fenster.root);
        if (t) t.textContent = `${int(n)} von ${int(gesamt)} gebucht …`;
        if (b) b.style.width = `${Math.round((n / gesamt) * 100)}%`;
        await atmen();
      },
    });
  } catch (e) {
    fenster.close();
    err('Beim Buchen ist ein Fehler aufgetreten', e.message);
    return;
  }
  fenster.close();
  st.ergebnis = { ...erg, datei: st.name, ausgewaehlt: gew.length };
  // Von der Datei bleibt nichts im Speicher.
  st.bytes = null; st.gelesen = null; st.zeilen = []; st.ctx = null;
  st.schritt = 'fertig';
  router.leaveGuard = null;
  zeichnen(root);
}

function schrittFertig(host, root) {
  const e = st.ergebnis;
  if (!e) { st = leer(); zeichnen(root); return; }
  host.innerHTML = `
    <div class="card"><div class="card-body">
      <h2 class="mt0">${icon('check', 18).__raw} ${e.fehler.length ? 'Fertig, mit Hinweisen' : 'Fertig'}</h2>
      <p>Aus „${esc(e.datei)}“ ${e.ausgewaehlt === 1 ? 'wurde ein Umsatz' : `wurden ${int(e.ausgewaehlt)} Umsätze`} bearbeitet:
        <strong>${int(e.bezahlt)}</strong> ${e.bezahlt === 1 ? 'Zahlung' : 'Zahlungen'} zu offenen Posten zugeordnet, <strong>${int(e.gebucht)}</strong> neue ${e.gebucht === 1 ? 'Buchung' : 'Buchungen'} angelegt${e.mahnkosten ? `, davon ${int(e.mahnkosten)} für Mahnkosten` : ''}.</p>
      ${e.fehler.length ? `<div class="notice warn"><strong>${int(e.fehler.length)} ${e.fehler.length === 1 ? 'Umsatz wurde' : 'Umsätze wurden'} nicht gebucht:</strong><ul class="mb0">${e.fehler.map((f) => `<li>${esc(f.text)}: ${esc(f.grund)}</li>`).join('')}</ul></div>` : ''}
      <p class="small muted">Jede Buchung nennt die Datei als Herkunft, auch im Änderungsjournal. Dieselbe Datei noch einmal einzulesen, bucht nichts doppelt.</p>
      <div class="row wrap mt16" style="gap:8px">
        <button class="btn primary" id="kfBuchungen">Zu den Buchungen</button>
        <button class="btn" id="kfNoch">Weitere Datei einlesen</button>
      </div>
    </div></div>`;
  $('#kfBuchungen', host).addEventListener('click', () => { st = leer(); navigate('transactions'); });
  $('#kfNoch', host).addEventListener('click', () => { st = neuStart(); zeichnen(root); });
}

/* -------------------------------------------------------------------------- */
/* Regeln und Vorlagen                                                         */
/* -------------------------------------------------------------------------- */

const FELDNAME = { zweck: 'der Verwendungszweck', gegenseite: 'die Gegenseite', iban: 'die IBAN', alle: 'irgendein Text' };
const RICHTUNG = { ein: 'bei Eingängen', aus: 'bei Ausgängen', beide: 'bei Ein- und Ausgängen' };

export function regelnDialog() {
  const m = modal({ title: 'Regeln und Vorlagen für Kontoauszüge', size: 'wide', body: '<div id="rgInhalt"></div>', foot: '<button class="btn primary" data-x>Schließen</button>' });
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  const zeichneListe = () => {
    const regeln = (store.db.bankRules || []).slice().sort((a, b) => (Number(a.ordnung) || 0) - (Number(b.ordnung) || 0));
    const vorlagen = store.db.bankTemplates || [];
    $('#rgInhalt', m.root).innerHTML = `
      <p class="small muted mt0">Eine Regel schlägt für Umsätze, die zu keiner Rechnung passen, eine Kategorie vor: „Wenn der Verwendungszweck oder die Gegenseite … enthält, dann Kategorie …“. Es gilt die erste passende Regel von oben. Die Regeln liegen verschlüsselt in Ihrem Tresor.</p>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>Regel</th><th>Wenn</th><th>Dann</th><th></th></tr></thead><tbody>
        ${regeln.map((r) => `<tr><td class="strong">${esc(r.name)}${r.aktiv === false ? ' <span class="badge plain">aus</span>' : ''}</td>
          <td class="small">${esc(FELDNAME[r.feld] || '')} enthält „${esc(r.enthaelt)}“, ${esc(RICHTUNG[r.richtung] || '')}</td>
          <td class="small">${esc(kategorieName(r.kategorieId))}</td>
          <td class="right nowrap"><button class="btn sm ghost" data-edit="${esc(r.id)}" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button><button class="btn sm ghost" data-del="${esc(r.id)}" aria-label="Löschen">${icon('trash', 14).__raw}</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Noch keine Regeln.</td></tr>'}
      </tbody></table></div>
      <button class="btn mt8" id="rgNeu">${icon('plus', 14).__raw} Neue Regel</button>
      <h3 class="mt16 mb8">Gemerkte Spaltenzuordnungen</h3>
      <div class="table-wrap"><table class="data compact"><tbody>
        ${vorlagen.map((v) => `<tr><td class="strong">${esc(v.name)}</td><td class="small muted">${Object.keys(v.spalten || {}).length} Spalten zugeordnet</td><td class="right"><button class="btn sm ghost" data-vdel="${esc(v.id)}" aria-label="Löschen">${icon('trash', 14).__raw}</button></td></tr>`).join('') || '<tr><td class="muted">Noch keine gemerkt. Beim Einlesen einer CSV-Datei lässt sich die Zuordnung merken.</td></tr>'}
      </tbody></table></div>`;
    $('#rgNeu', m.root).addEventListener('click', () => regelBearbeiten(null, zeichneListe));
    $$('[data-edit]', m.root).forEach((b) => b.addEventListener('click', () => regelBearbeiten((store.db.bankRules || []).find((r) => r.id === b.dataset.edit), zeichneListe)));
    $$('[data-del]', m.root).forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Regel löschen?', text: 'Schon gebuchte Umsätze bleiben, wie sie sind.', confirmLabel: 'Löschen', danger: true })) return;
      await regelLoeschen(b.dataset.del); zeichneListe();
    }));
    $$('[data-vdel]', m.root).forEach((b) => b.addEventListener('click', async () => { await vorlageLoeschen(b.dataset.vdel); zeichneListe(); }));
  };
  zeichneListe();
}

function regelBearbeiten(regel, fertig) {
  const r = regel || { feld: 'alle', richtung: 'beide', aktiv: true };
  const kategorien = (kind) => sel.activeCategories(kind).map((c) => `<option value="${esc(c.id)}" ${c.id === r.kategorieId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const m = modal({
    title: regel ? 'Regel bearbeiten' : 'Neue Regel',
    size: 'slim',
    body: `<div class="form-grid">
      <div class="field full"><label for="rgName">Name</label><input id="rgName" value="${esc(r.name || '')}" placeholder="z. B. Software-Abos"></div>
      <div class="field"><label for="rgFeld">Wenn</label><select id="rgFeld">${Object.entries(FELDNAME).map(([k, t]) => `<option value="${k}" ${r.feld === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label for="rgText">enthält</label><input id="rgText" value="${esc(r.enthaelt || '')}" placeholder="z. B. Adobe"></div>
      <div class="field"><label for="rgRicht">Gilt</label><select id="rgRicht">${Object.entries(RICHTUNG).map(([k, t]) => `<option value="${k}" ${r.richtung === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label for="rgKat">Dann Kategorie</label><select id="rgKat"><option value="">Bitte wählen</option><optgroup label="Einnahmen">${kategorien('income')}</optgroup><optgroup label="Ausgaben">${kategorien('expense')}</optgroup></select></div>
      <div class="field"><label for="rgKontakt">Kontakt (optional)</label><select id="rgKontakt"><option value="">Keiner</option>${sel.contacts().map((c) => `<option value="${esc(c.id)}" ${r.kontaktId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="rgBeschr">Beschreibung (optional)</label><input id="rgBeschr" value="${esc(r.beschreibung || '')}"></div>
      <label class="check full"><input type="checkbox" id="rgAktiv" ${r.aktiv === false ? '' : 'checked'}> <span>Regel ist eingeschaltet</span></label>
    </div>`,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
  });
  const g = (id) => m.root.querySelector(`#${id}`);
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    try {
      await regelSpeichern({ ...(regel || {}), name: g('rgName').value, feld: g('rgFeld').value, enthaelt: g('rgText').value, richtung: g('rgRicht').value, kategorieId: g('rgKat').value, kontaktId: g('rgKontakt').value, beschreibung: g('rgBeschr').value.trim(), aktiv: g('rgAktiv').checked });
      m.close(); fertig();
    } catch (e) { err('Regel nicht gespeichert', e.message); }
  });
}
