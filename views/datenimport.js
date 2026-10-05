/**
 * Kontovia – Daten übernehmen: Buchungen aus DATEV-Dateien und Tabellen
 * (CSV, Excel), Umsatzsteuer-Voranmeldungen aus ELSTER-Dateien, Kontakte
 * (vCard, CSV, DATEV) und Produkte. Dazu der Weg zu Kontoauszug,
 * E-Rechnung und Kalenderdatei, die eigene Abläufe haben.
 *
 * Eine Datei, hierher gezogen oder gewählt, wird am Inhalt erkannt und nur
 * im Browser gelesen; nichts wird hochgeladen. Übernommen wird erst nach
 * Bestätigung (lib/datenimportaktionen.js). Lesen und Übersetzen:
 * lib/datenimport.js, lib/elster.js, lib/xlsx.js.
 */

import { esc, $, $$, money, fmtDate, fmtDateTime, int, sum } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, err } from '../lib/ui.js';
import { store, sel, beimSperren } from '../lib/store.js';
import { navigate, router } from '../lib/router.js';
import { mountTable } from '../lib/table.js';
import { textAusBytes } from '../lib/kontoauszug.js';
import * as I from '../lib/datenimport.js';
import { elsterLesen, meldungVergleichen, zeitraumText } from '../lib/elster.js';
import { xlsxLesen, alsCsv } from '../lib/xlsx.js';
import { base64 } from '../lib/pdfausgabe.js';
import {
  buchungenUebernehmen, kontakteUebernehmen, produkteUebernehmen, meldungenSpeichern, meldungLoeschen,
} from '../lib/datenimportaktionen.js';

const MAX_BYTES = 40 * 1024 * 1024;
const atmen = () => new Promise((r) => setTimeout(r, 0));

const leer = () => ({
  schritt: 'start', name: '', quelle: '', art: '', stapel: null, tabelle: null,
  vorschlaege: [], neueKontakte: [], liste: [], meldungen: [], hinweise: [], kontoId: '', filter: 'alle', ergebnis: null,
});
let st = leer();
beimSperren(() => { st = leer(); });

export async function render(root, params = {}, { actions } = {}) {
  if (actions) actions.innerHTML = '';
  // Wer die Seite erneut aufruft, will die nächste Datei übernehmen, nicht das alte Ergebnis sehen.
  if (st.schritt === 'fertig') st = leer();
  zeichnen(root);
}

function zeichnen(root) {
  router.leaveGuard = st.schritt === 'pruefen' && auswahl().length ? verlassen : null;
  if (st.schritt === 'start') return start(root);
  if (st.schritt === 'fertig') return fertig(root);
  if (st.art === 'buchungen') return pruefenBuchungen(root);
  if (st.art === 'kontakte' || st.art === 'produkte') return pruefenStamm(root);
  if (st.art === 'elster') return pruefenElster(root);
  st = leer();
  return start(root);
}

const auswahl = () => (st.art === 'buchungen' ? st.vorschlaege : st.art === 'elster' ? [] : st.liste).filter((x) => x.gewaehlt);

async function verlassen() {
  return confirmDialog({
    title: 'Nichts übernommen',
    text: 'Die gewählten Einträge sind noch nicht übernommen. Wenn Sie die Seite verlassen, geht die Auswahl verloren.',
    confirmLabel: 'Verlassen', danger: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Start                                                                       */
/* -------------------------------------------------------------------------- */

const KARTEN = [
  ['buchungen', 'book', 'Buchungen aus einem anderen Programm', 'DATEV-Format (von der Kanzlei, aus Lexware Office, sevDesk und anderen), Excel-Tabelle oder CSV. Kategorien werden am Sachkonto oder am Namen erkannt.'],
  ['elster', 'euro', 'Umsatzsteuer-Voranmeldung aus ELSTER', 'XML-Datei einer Voranmeldung, etwa aus Ihrem bisherigen Programm. Kontovia stellt sie neben die eigene Berechnung und zeigt Abweichungen.'],
  ['kontakte', 'users', 'Kunden und Lieferanten', 'Visitenkarten (vCard) aus Outlook, Google oder vom Telefon, Tabellen mit Adressen oder DATEV-Debitoren und -Kreditoren.'],
  ['produkte', 'tag', 'Produkte und Leistungen', 'Tabelle mit Bezeichnung, Preis, Einheit und Steuersatz, zum Beispiel aus Ihrem bisherigen Rechnungsprogramm.'],
  ['kontoauszug', 'bank', 'Kontoauszug', 'CSV, CAMT.053 oder MT940 von Ihrer Bank. Zahlungen werden offenen Rechnungen zugeordnet.'],
  ['erechnung', 'invoice', 'E-Rechnung erhalten', 'XRechnung oder ZUGFeRD-PDF eines Lieferanten. Kontovia zeigt sie lesbar an und bereitet die Buchung vor.'],
  ['kalender', 'calendar', 'Termine', 'Kalenderdatei (.ics) aus Outlook, Google oder Apple Kalender.'],
];

function start(root) {
  const meldungen = (store.db.elsterMeldungen || []).slice().sort((a, b) => `${b.jahr}${b.zeitraum}`.localeCompare(`${a.jahr}${a.zeitraum}`));
  root.innerHTML = `
    <p class="mt0 mb16 muted">Aus einem anderen Programm, von Ihrer Steuerkanzlei oder aus ELSTER. Die Datei wird nur auf diesem Gerät gelesen und nirgends hochgeladen. Übernommen wird erst, wenn Sie es bestätigen.</p>
    <div class="card"><div class="card-body">
      <div class="ki-drop" id="diDrop" tabindex="0" role="button" aria-label="Datei zum Übernehmen auswählen" style="margin-top:0">
        ${icon('folder', 28).__raw}
        <strong>Datei hierher ziehen oder auswählen</strong>
        <span class="small muted">Kontovia erkennt das Format selbst: DATEV, Excel, CSV, ELSTER-XML, vCard, Kalenderdatei, E-Rechnung und Kontoauszug.</span>
        <button class="btn primary mt8" id="diWahl" type="button">${icon('plus', 15).__raw} Datei wählen</button>
        <input type="file" id="diDatei" hidden accept=".csv,.txt,.tsv,.xlsx,.xml,.vcf,.vcard,.ics,.pdf,.sta,.940,.mt940">
      </div>
      <p class="small muted mb0 mt8" id="diStatus" role="status"></p>
    </div></div>
    <div class="grid c2 mt16">
      ${KARTEN.map(([id, ic, titel, text]) => `
        <div class="card">
          <div class="card-head"><h3>${icon(ic, 16).__raw} ${esc(titel)}</h3></div>
          <div class="card-body">
            <p class="small muted mt0">${esc(text)}</p>
            <button class="btn" data-ziel="${id}" type="button">${id === 'kontoauszug' ? 'Zum Kontoauszug' : 'Datei wählen'}</button>
          </div>
        </div>`).join('')}
    </div>
    ${meldungen.length ? '<div class="card mt16"><div class="card-head"><h3>Eingelesene Voranmeldungen</h3><span class="sub" id="diSumme"></span></div><div id="diMeldungen"></div></div>' : ''}`;

  const input = $('#diDatei', root);
  let ziel = '';
  const waehlen = (z) => { ziel = z; input.value = ''; input.click(); };
  $('#diWahl', root).addEventListener('click', (e) => { e.stopPropagation(); waehlen(''); });
  const drop = $('#diDrop', root);
  drop.addEventListener('click', () => waehlen(''));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehlen(''); } });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('ueber'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('ueber'); });
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) dateiLesen(f, root, ''); });
  input.addEventListener('change', () => { if (input.files?.[0]) dateiLesen(input.files[0], root, ziel); });
  $$('[data-ziel]', root).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.ziel === 'kontoauszug') { navigate('kontoimport'); return; }
    const accept = {
      buchungen: '.csv,.txt,.tsv,.xlsx', elster: '.xml', kontakte: '.vcf,.vcard,.csv,.txt,.xlsx', produkte: '.csv,.txt,.xlsx', erechnung: '.xml,.pdf', kalender: '.ics',
    }[b.dataset.ziel];
    input.setAttribute('accept', accept);
    waehlen(b.dataset.ziel);
    input.setAttribute('accept', '.csv,.txt,.tsv,.xlsx,.xml,.vcf,.vcard,.ics,.pdf,.sta,.940,.mt940');
  }));

  if (meldungen.length) meldungenTabelle(root, meldungen);
}

/** Liste der gespeicherten Voranmeldungen mit Abgleich gegen die eigenen Zahlen. */
function meldungenTabelle(root, meldungen) {
  const vergleich = new Map(meldungen.map((m) => [m.id, meldungVergleichen(store.db, m)]));
  const jahre = [...new Set(meldungen.map((m) => m.jahr))].sort().reverse();
  const summen = jahre.slice(0, 2).map((j) => `${j}: ${money(sum(meldungen.filter((m) => m.jahr === j), (m) => m.werte?.kz83 || 0))} €`);
  $('#diSumme', root).textContent = `Summe Kennzahl 83 ${summen.join(', ')}`;
  mountTable($('#diMeldungen', root), {
    id: 'datenimport-meldungen',
    cls: 'data',
    defaultSort: { key: 'zeit', dir: -1 },
    rows: meldungen,
    unit: ['Voranmeldung', 'Voranmeldungen'],
    columns: [
      { key: 'zeit', label: 'Zeitraum', type: 'text', tdCls: 'strong nowrap', value: (m) => `${m.jahr}${m.zeitraum}`, cell: (m) => `${esc(zeitraumText(m.jahr, m.zeitraum))}${m.berichtigt ? ' <span class="badge tiny">berichtigt</span>' : ''}` },
      { key: 'kz83', label: 'Kennzahl 83', type: 'num', value: (m) => m.werte?.kz83 || 0, cell: (m) => `<span class="nowrap">${esc(money(m.werte?.kz83 || 0))} €</span>` },
      {
        key: 'stand', label: 'Abgleich mit Kontovia', type: 'text', value: (m) => (vergleich.get(m.id).stimmt ? 0 : 1),
        cell: (m) => {
          const v = vergleich.get(m.id);
          if (v.kleinunternehmer) return '<span class="badge">Kleinunternehmer</span>';
          if (v.stimmt) return '<span class="badge pos">stimmt überein</span>';
          const d = v.zeilen.find((z) => z.kz === 'kz83')?.abweichung || 0;
          return `<span class="badge warn">weicht ab</span> <span class="small">${d ? `Kennzahl 83 um ${esc(money(d, { sign: true }))} €` : 'bei einzelnen Kennzahlen'}</span>`;
        },
      },
      { key: 'datei', label: 'Datei', type: 'text', cls: 'col-mh-opt', tdCls: 'small muted col-mh-opt', value: (m) => m.datei, cell: (m) => `${esc(m.datei || '')}<div class="tiny">${esc(fmtDateTime(m.eingelesen))}</div>` },
      { key: 'aktion', label: '', type: 'none', width: '150px', cls: 'right', tdCls: 'nowrap right', cell: (m) => `<button class="btn sm" data-ansehen="${esc(m.id)}">Ansehen</button> <button class="icon-btn" data-weg="${esc(m.id)}" title="Entfernen" aria-label="Entfernen">${icon('trash', 15).__raw}</button>` },
    ],
    onRender: (el) => {
      $$('[data-ansehen]', el).forEach((b) => b.addEventListener('click', () => meldungZeigen(meldungen.find((m) => m.id === b.dataset.ansehen))));
      $$('[data-weg]', el).forEach((b) => b.addEventListener('click', async () => {
        const m = meldungen.find((x) => x.id === b.dataset.weg);
        const ja = await confirmDialog({ title: 'Voranmeldung entfernen?', text: `Die eingelesene Voranmeldung für ${zeitraumText(m.jahr, m.zeitraum)} wird aus Kontovia entfernt. Beim Finanzamt ändert sich dadurch nichts.`, confirmLabel: 'Entfernen', danger: true });
        if (!ja) return;
        try { await meldungLoeschen(m.id); } catch (e) { err('Nicht entfernt', e.message); return; }
        start(root);
      }));
    },
  });
}

function vergleichHtml(m) {
  const v = meldungVergleichen(store.db, m);
  if (v.kleinunternehmer) return '<div class="notice">In Kontovia ist die Kleinunternehmerregelung eingestellt; einen Vergleich gibt es deshalb nicht.</div>';
  const zeilen = v.zeilen.map((z) => `<tr><td><span class="muted tiny">Kz ${esc(z.nr)}</span><div class="small">${esc(z.label)}</div></td>
    <td class="right nowrap num">${esc(money(z.gemeldet))} €</td><td class="right nowrap num">${esc(money(z.berechnet))} €</td>
    <td class="right nowrap num ${z.abweichung ? 'neg' : 'muted'}">${z.abweichung ? `${esc(money(z.abweichung, { sign: true }))} €` : '✓'}</td></tr>`).join('');
  return `
    <p class="small mt0">${v.stimmt ? `${icon('check', 14).__raw} Die Werte stimmen mit den Buchungen in Kontovia überein.` : 'Wo die Werte abweichen, fehlt meist eine Buchung, oder eine Buchung liegt in einem anderen Zeitraum oder hat einen anderen Steuersatz.'}
      Bemessungsgrundlagen zählen wie in ELSTER in vollen Euro.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Kennzahl</th><th class="right">Datei</th><th class="right">Kontovia</th><th class="right" title="Unterschied">±</th></tr></thead>
    <tbody>${zeilen || '<tr><td colspan="4" class="muted">Keine Beträge.</td></tr>'}</tbody></table></div>`;
}

function meldungZeigen(m) {
  if (!m) return;
  const f = modal({
    title: `Voranmeldung ${zeitraumText(m.jahr, m.zeitraum)}`,
    size: 'wide',
    body: `${m.steuernummer ? `<p class="small muted mt0">Steuernummer ${esc(m.steuernummer)} · Datei ${esc(m.datei || '')}</p>` : ''}${vergleichHtml(m)}`,
    foot: `<button class="btn" data-buchungen>Buchungen des Zeitraums</button><button class="btn primary" data-zu>Schließen</button>`,
  });
  f.root.querySelector('[data-zu]').addEventListener('click', () => f.close());
  f.root.querySelector('[data-buchungen]').addEventListener('click', () => { f.close(); navigate('transactions', { period: { from: m.von, to: m.bis } }); });
}

/* -------------------------------------------------------------------------- */
/* Datei lesen                                                                 */
/* -------------------------------------------------------------------------- */

async function dateiLesen(datei, root, ziel) {
  const meld = (t) => { const s = $('#diStatus', root); if (s) s.textContent = t; };
  if (datei.size > MAX_BYTES) { warn('Datei zu groß', 'Bitte eine kleinere Datei wählen oder sie aufteilen.'); return; }
  meld(`„${datei.name}“ wird gelesen …`);
  await atmen();
  let bytes;
  try { bytes = new Uint8Array(await datei.arrayBuffer()); } catch (e) { err('Datei nicht lesbar', e.message); meld(''); return; }
  const name = datei.name;
  const weiter = { name, dataBase64: '' };
  try {
    // Excel: erst in Zeilen, dann wie eine CSV-Datei.
    if (/\.xlsx$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      const text = alsCsv(await xlsxLesen(bytes));
      return tabelleOeffnen(text, name, ziel, root, 'Excel-Tabelle');
    }
    if (/\.pdf$/i.test(name) || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
      if (ziel === 'erechnung' || ziel === '') {
        const { eingangHinzufuegen } = await import('./rechnungen.js');
        weiter.dataBase64 = base64(bytes);
        meld('');
        return eingangHinzufuegen(weiter);
      }
      warn('PDF lässt sich nicht übernehmen', 'Aus einem PDF lassen sich keine Daten lesen, auch nicht aus dem Ausdruck von „Mein ELSTER“. E-Rechnungen im ZUGFeRD-Format übernehmen Sie unter „E-Rechnung erhalten“.');
      meld('');
      return;
    }
    const { text } = textAusBytes(bytes);
    const art = I.dateiArt(text, name);
    if (art === 'ics') { const { importIcs } = await import('./calendarsync.js'); meld(''); weiter.dataBase64 = base64(bytes); return importIcs(weiter); }
    if (art === 'erechnung') { const { eingangHinzufuegen } = await import('./rechnungen.js'); meld(''); weiter.dataBase64 = base64(bytes); return eingangHinzufuegen(weiter); }
    if (art === 'kontoauszug') {
      meld('');
      ok('Kontoauszug erkannt', 'Kontoauszüge lesen Sie unter „Kontoauszug“ ein; dort werden Zahlungen offenen Rechnungen zugeordnet.');
      navigate('kontoimport');
      return;
    }
    if (art === 'elster') return elsterOeffnen(text, name, root);
    if (art === 'vcard') return stammOeffnen('kontakte', I.vcardLesen(text), name, root, 'vCard');
    if (art === 'datev') {
      const stapel = I.datevLesen(text);
      if (stapel.kategorie === 16) return stammOeffnen('kontakte', I.datevKontakte(stapel), name, root, 'DATEV', stapel.hinweise);
      st = { ...leer(), schritt: 'pruefen', art: 'buchungen', quelle: 'DATEV', name, stapel, hinweise: stapel.hinweise };
      st.kontoId = standardKonto();
      vorschlaegeBerechnen();
      return zeichnen(root);
    }
    if (art === 'csv') return tabelleOeffnen(text, name, ziel, root, 'CSV');
    throw Object.assign(new Error('Das Format dieser Datei kennt Kontovia nicht.'), { code: 'FORMAT' });
  } catch (e) {
    meld('');
    err('Datei nicht übernommen', e.message);
  }
}

function standardKonto() {
  const konten = sel.accounts().filter((a) => a.active !== false);
  return (konten.find((a) => a.kind === 'bank') || konten[0])?.id || '';
}

/** Tabelle (CSV oder Excel): Inhalt erkennen, im Zweifel fragen. */
async function tabelleOeffnen(text, name, ziel, root, quelle) {
  let art = ['buchungen', 'kontakte', 'produkte'].includes(ziel) ? ziel : I.tabellenArt(text);
  if (!art) art = await artFragen(name);
  if (!art) { const s = $('#diStatus', root); if (s) s.textContent = ''; return; }
  if (art === 'kontoauszug') { navigate('kontoimport'); return; }
  if (art === 'kontakte') return stammOeffnen('kontakte', I.kontakteCsvLesen(text), name, root, quelle);
  if (art === 'produkte') {
    const s = store.db.settings;
    return stammOeffnen('produkte', I.produkteCsvLesen(text, { standardSatz: s.taxMode === 'kleinunternehmer' ? 0 : Number(s.defaultVatRate ?? 19) }), name, root, quelle);
  }
  const tabelle = I.buchungenCsvLesen(text);
  st = { ...leer(), schritt: 'pruefen', art: 'buchungen', quelle: 'Tabelle', name, tabelle, hinweise: tabelle.hinweise };
  st.kontoId = standardKonto();
  vorschlaegeBerechnen();
  zeichnen(root);
}

function artFragen(name) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: 'Was steht in der Tabelle?',
      size: 'slim',
      body: `<p class="mt0 small">An den Überschriften von „${esc(name)}“ ist das nicht sicher zu erkennen.</p>
        ${[['buchungen', 'Buchungen (Einnahmen und Ausgaben)'], ['kontakte', 'Kunden und Lieferanten'], ['produkte', 'Produkte und Leistungen'], ['kontoauszug', 'Umsätze eines Bankkontos']]
    .map(([k, t], i) => `<label class="check"><input type="radio" name="diArt" value="${k}" ${i === 0 ? 'checked' : ''}> ${esc(t)}</label>`).join('')}`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Weiter</button>',
      onClose: () => { if (!fertig) resolve(''); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { fertig = true; m.close(); resolve(''); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      fertig = true;
      const v = m.root.querySelector('input[name="diArt"]:checked')?.value || '';
      m.close();
      resolve(v);
    });
  });
}

function vorschlaegeBerechnen() {
  const gewaehltVorher = new Set(st.vorschlaege.filter((v) => v.gewaehlt).map((v) => v.hash));
  const nochNie = !st.vorschlaege.length;
  let liste;
  if (st.stapel) {
    liste = I.datevZuBuchungen(st.stapel, store.db, { kontoId: st.kontoId, datei: st.name });
    st.neueKontakte = [];
  } else {
    const r = I.tabelleZuBuchungen(st.tabelle, store.db, { kontoId: st.kontoId, datei: st.name });
    liste = r.vorschlaege;
    st.neueKontakte = r.neueKontakte;
  }
  st.vorschlaege = liste.map((v, i) => ({
    ...v, index: i,
    gewaehlt: waehlbar(v) && (nochNie ? !v.aehnlich : gewaehltVorher.has(v.hash)),
  }));
}

/* -------------------------------------------------------------------------- */
/* Buchungen prüfen                                                            */
/* -------------------------------------------------------------------------- */

const FILTER = [
  ['alle', 'Alle', () => true],
  ['gewaehlt', 'Ausgewählt', (v) => v.gewaehlt],
  ['ohneKat', 'Ohne Kategorie', (v) => v.art === 'buchung' && !v.tx?.categoryId],
  ['doppelt', 'Schon übernommen', (v) => v.doppelt],
  ['aehnlich', 'Mögliche Dubletten', (v) => !!v.aehnlich],
  ['aus', 'Nicht übernehmbar', (v) => v.art === 'aus'],
];

const waehlbar = (v) => (v.art === 'buchung' || v.art === 'zahlung') && !v.doppelt;

function artText(v) {
  if (v.art === 'zahlung' || v.art === 'enthalten') return 'Zahlung';
  if (v.art === 'aus') return '–';
  return v.tx.type === 'income' ? 'Einnahme' : 'Ausgabe';
}

function pruefenBuchungen(root) {
  const n = (f) => st.vorschlaege.filter(f).length;
  const konten = sel.accounts().filter((a) => a.active !== false);
  const v = st.vorschlaege;
  const von = v.map((x) => x.datum).sort()[0];
  const bis = v.map((x) => x.datum).sort().at(-1);
  const k = st.stapel?.kopf;
  root.innerHTML = `
    <div class="card mb16"><div class="card-body">
      <div class="row between wrap" style="gap:10px">
        <div><strong>${esc(st.name)}</strong>
          <div class="small muted">${esc(st.quelle === 'DATEV' ? `DATEV-Buchungsstapel${k?.berater ? `, Berater ${k.berater}, Mandant ${k.mandant}` : ''}${k?.rahmen ? `, ${k.rahmen.toUpperCase()}` : ''}` : 'Tabelle')}, ${int(v.length)} Zeilen${von ? ` vom ${esc(fmtDate(von))} bis ${esc(fmtDate(bis))}` : ''}</div></div>
        <button class="btn sm" id="diAnders">${icon('left', 14).__raw} Andere Datei</button>
      </div>
      <div class="field mt8" style="max-width:420px">
        <label for="diKonto">${st.quelle === 'DATEV' ? 'Zahlungskonto, wenn die Datei keines nennt' : 'Zahlungskonto'}</label>
        <select id="diKonto">${konten.map((a) => `<option value="${esc(a.id)}" ${a.id === st.kontoId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      </div>
      <p class="small mb0">Nichts ist übernommen. Ausgewählt ist, was sich eindeutig übernehmen lässt. Zeilen, die schon einmal übernommen wurden, bleiben aus. ${st.neueKontakte.length ? `${int(st.neueKontakte.length)} ${st.neueKontakte.length === 1 ? 'Kontakt wird' : 'Kontakte werden'} dabei neu angelegt.` : ''}</p>
      ${st.hinweise.length ? `<details class="mt8"><summary class="small">${int(st.hinweise.length)} ${st.hinweise.length === 1 ? 'Hinweis' : 'Hinweise'} zur Datei</summary><ul class="small">${st.hinweise.slice(0, 50).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></details>` : ''}
    </div></div>
    <div class="ki-filter mb8" role="group" aria-label="Anzeige">${FILTER.map(([key, t, f]) => `<button type="button" class="chip ${st.filter === key ? 'active' : ''}" data-filter="${key}" ${n(f) || key === 'alle' ? '' : 'disabled'}>${esc(t)} <span class="muted">${int(n(f))}</span></button>`).join('')}</div>
    <div class="row wrap mb8" style="gap:8px">
      <button class="btn sm" id="diAlle">Alle übernehmbaren auswählen</button>
      ${n((x) => x.aehnlich && waehlbar(x)) ? `<button class="btn sm" id="diAehnlich">Mögliche Dubletten auch auswählen (${int(n((x) => x.aehnlich && waehlbar(x)))})</button>` : ''}
      <button class="btn sm ghost" id="diKeine">Auswahl aufheben</button>
    </div>
    <div class="card" id="diTabelle"></div>
    <div class="row between wrap mt16 mb16 apply-bar dirty" style="gap:10px"><span id="diFuss" class="small"></span>
      <button class="btn primary lg" id="diLos">Übernehmen</button></div>`;

  $('#diAnders', root).addEventListener('click', async () => { if (auswahl().length && !(await verlassen())) return; st = leer(); zeichnen(root); });
  $('#diKonto', root).addEventListener('change', (e) => { st.kontoId = e.currentTarget.value; vorschlaegeBerechnen(); pruefenBuchungen(root); });
  $$('[data-filter]', root).forEach((b) => b.addEventListener('click', () => { st.filter = b.dataset.filter; pruefenBuchungen(root); }));
  $('#diAlle', root).addEventListener('click', () => { for (const x of st.vorschlaege) x.gewaehlt = waehlbar(x) && !x.aehnlich; pruefenBuchungen(root); });
  $('#diAehnlich', root)?.addEventListener('click', () => { for (const x of st.vorschlaege) if (x.aehnlich && waehlbar(x)) x.gewaehlt = true; pruefenBuchungen(root); });
  $('#diKeine', root).addEventListener('click', () => { for (const x of st.vorschlaege) x.gewaehlt = false; pruefenBuchungen(root); });
  $('#diLos', root).addEventListener('click', () => buchungenFrage(root));

  const fuss = () => {
    const g = auswahl();
    const ein = sum(g.filter((x) => x.art === 'buchung' && x.tx.type === 'income'), (x) => x.tx.gross);
    const aus = sum(g.filter((x) => x.art === 'buchung' && x.tx.type === 'expense'), (x) => x.tx.gross);
    const zahl = g.filter((x) => x.art === 'zahlung').length;
    $('#diFuss', root).innerHTML = g.length
      ? `<strong>${int(g.length)} ausgewählt:</strong> Einnahmen ${esc(money(ein))} €, Ausgaben ${esc(money(aus))} €${zahl ? `, ${int(zahl)} ${zahl === 1 ? 'Zahlung' : 'Zahlungen'} zu vorhandenen Buchungen` : ''}.`
      : 'Nichts ausgewählt.';
    const los = $('#diLos', root);
    los.disabled = !g.length;
    los.textContent = g.length ? `${int(g.length)} übernehmen …` : 'Übernehmen';
    router.leaveGuard = g.length ? verlassen : null;
  };
  fuss();

  const filter = FILTER.find(([key]) => key === st.filter)?.[2] || (() => true);
  mountTable($('#diTabelle', root), {
    id: 'datenimport-buchungen',
    cls: 'data',
    defaultSort: { key: 'nr', dir: 1 },
    rows: st.vorschlaege.filter(filter),
    unit: ['Zeile', 'Zeilen'],
    search: { placeholder: 'Text, Beleg oder Betrag suchen …', text: (x) => [x.text, x.beleg, money(x.betrag), x.konto, x.gegenkonto].join(' ') },
    columns: [
      {
        key: 'wahl', label: '', type: 'none', width: '44px',
        cell: (x) => `<input type="checkbox" data-wahl="${x.index}" ${x.gewaehlt ? 'checked' : ''} ${waehlbar(x) ? '' : 'disabled'} aria-label="Zeile ${x.nr} übernehmen">`,
      },
      { key: 'nr', label: 'Zeile', type: 'num', cls: 'col-mh-opt', tdCls: 'small muted col-mh-opt', value: (x) => x.nr, cell: (x) => int(x.nr) },
      { key: 'datum', label: 'Datum', type: 'date', tdCls: 'nowrap', value: (x) => x.datum, cell: (x) => esc(fmtDate(x.datum)) },
      {
        key: 'text', label: 'Beschreibung', type: 'text', value: (x) => x.text,
        cell: (x) => `<span class="strong">${esc(x.text || x.tx?.description || '–')}</span>
          <div class="tiny muted">${[x.beleg ? `Beleg ${esc(x.beleg)}` : '', x.konto ? `Konto ${esc(x.konto)} an ${esc(x.gegenkonto)}` : ''].filter(Boolean).join(' · ')}</div>
          ${x.grund ? `<div class="tiny ${x.art === 'aus' ? 'neg' : 'muted'}">${esc(x.grund)}</div>` : ''}`,
      },
      {
        key: 'kat', label: 'Kategorie', type: 'text', cls: 'col-mh-opt', tdCls: 'small col-mh-opt',
        value: (x) => (x.tx?.categoryId ? sel.categoryName(x.tx.categoryId) : ''),
        cell: (x) => (x.art !== 'buchung' ? '' : x.tx.categoryId ? esc(sel.categoryName(x.tx.categoryId)) : '<span class="muted">ohne</span>'),
      },
      {
        key: 'betrag', label: 'Betrag', type: 'num', value: (x) => x.betrag,
        cell: (x) => `<span class="nowrap ${x.art === 'buchung' ? (x.tx.type === 'income' ? 'pos' : 'neg') : ''}">${esc(money(x.betrag))} €</span>
          <div class="tiny muted nowrap">${esc(artText(x))}${x.art === 'buchung' && x.tx.vatRate ? `, ${x.tx.vatRate} %` : ''}${x.art === 'buchung' && !x.tx.paidDate ? ', offen' : ''}</div>`,
      },
      {
        key: 'stand', label: '', type: 'none', width: '120px', cls: 'right', tdCls: 'right',
        cell: (x) => (x.doppelt ? '<span class="badge">schon übernommen</span>' : x.art === 'aus' ? '<span class="badge warn">bleibt aus</span>'
          : x.art === 'enthalten' ? '<span class="badge info">in der Rechnung</span>' : x.aehnlich ? '<span class="badge warn">mögliche Dublette</span>' : x.tx && !x.tx.categoryId ? '<span class="badge">ohne Kategorie</span>' : '<span class="badge pos">bereit</span>'),
      },
    ],
    emptyTitle: 'Keine Zeilen in dieser Ansicht',
    emptyText: 'Wählen Sie oben eine andere Anzeige.',
    onRender: (el) => {
      $$('[data-wahl]', el).forEach((c) => c.addEventListener('change', () => { st.vorschlaege[Number(c.dataset.wahl)].gewaehlt = c.checked; fuss(); }));
    },
  });
}

async function buchungenFrage(root) {
  const g = auswahl();
  const ohneKat = g.filter((x) => x.art === 'buchung' && !x.tx.categoryId).length;
  const ja = await confirmDialog({
    title: `${int(g.length)} ${g.length === 1 ? 'Zeile' : 'Zeilen'} übernehmen?`,
    text: `Jede Buchung nennt „${st.name}“ als Herkunft, auch im Änderungsjournal.${ohneKat ? ` ${int(ohneKat)} ${ohneKat === 1 ? 'Buchung kommt' : 'Buchungen kommen'} ohne Kategorie und ${ohneKat === 1 ? 'zählt' : 'zählen'} erst in der Steuerübersicht, wenn Sie eine Kategorie ergänzen.` : ''} Übernommene Buchungen lassen sich wie jede andere ändern oder stornieren.`,
    confirmLabel: 'Jetzt übernehmen',
  });
  if (!ja) return;
  const fenster = fortschrittsFenster();
  let erg;
  try {
    erg = await buchungenUebernehmen(g, { datei: st.name, quelle: st.quelle, neueKontakte: st.neueKontakte, fortschritt: fenster.stand });
  } catch (e) {
    fenster.close();
    err('Beim Übernehmen ist ein Fehler aufgetreten', e.message);
    return;
  }
  fenster.close();
  st = { ...leer(), schritt: 'fertig', ergebnis: { art: 'buchungen', datei: st.name, ...erg, ausgewaehlt: g.length } };
  zeichnen(root);
}

function fortschrittsFenster() {
  const f = modal({
    title: 'Wird übernommen',
    closable: false,
    body: '<p class="mt0" id="diFText" role="status">Einen Moment …</p><div style="height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden"><div id="diFBalken" style="height:100%;width:0;background:var(--accent)"></div></div>',
  });
  return {
    close: () => f.close(),
    stand: async (n, gesamt) => {
      const t = $('#diFText', f.root); const b = $('#diFBalken', f.root);
      if (t) t.textContent = `${int(n)} von ${int(gesamt)} …`;
      if (b) b.style.width = `${Math.round((n / gesamt) * 100)}%`;
      await atmen();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Kontakte und Produkte                                                       */
/* -------------------------------------------------------------------------- */

function stammOeffnen(art, liste, name, root, quelle, hinweise = []) {
  if (!liste.length) { warn('Nichts gefunden', art === 'kontakte' ? 'Die Datei enthält keine lesbaren Kontakte.' : 'Die Datei enthält keine lesbaren Produkte.'); return; }
  const geprueft = art === 'kontakte' ? I.kontakteAbgleichen(liste, store.db) : I.produkteAbgleichen(liste, store.db);
  st = {
    ...leer(), schritt: 'pruefen', art, name, quelle, hinweise,
    liste: geprueft.map((x, i) => ({ ...x, index: i, gewaehlt: !x.doppelt && !x.wiederholt })),
  };
  zeichnen(root);
}

function pruefenStamm(root) {
  const kontakte = st.art === 'kontakte';
  const KIND = { customer: 'Kunde', supplier: 'Lieferant', both: 'Kunde & Lieferant' };
  root.innerHTML = `
    <div class="card mb16"><div class="card-body">
      <div class="row between wrap" style="gap:10px">
        <div><strong>${esc(st.name)}</strong><div class="small muted">${esc(st.quelle)}, ${int(st.liste.length)} ${kontakte ? 'Kontakte' : 'Produkte'}</div></div>
        <button class="btn sm" id="diAnders">${icon('left', 14).__raw} Andere Datei</button>
      </div>
      <p class="small mb0 mt8">Nichts ist übernommen. Was es in Kontovia schon gibt (gleicher Name${kontakte ? ' oder gleiche E-Mail' : ' oder gleiche Artikelnummer'}), ist nicht ausgewählt.</p>
      ${kontakte ? `<div class="field mt8" style="max-width:320px"><label for="diKind">Neue Kontakte sind</label>
        <select id="diKind"><option value="">wie in der Datei</option><option value="customer">Kunden</option><option value="supplier">Lieferanten</option><option value="both">Kunden und Lieferanten</option></select></div>` : ''}
    </div></div>
    <div class="card" id="diTabelle"></div>
    <div class="row between wrap mt16 mb16 apply-bar dirty" style="gap:10px"><span id="diFuss" class="small"></span>
      <button class="btn primary lg" id="diLos">Übernehmen</button></div>`;
  $('#diAnders', root).addEventListener('click', async () => { if (auswahl().length && !(await verlassen())) return; st = leer(); zeichnen(root); });
  const fuss = () => {
    const g = auswahl();
    $('#diFuss', root).innerHTML = g.length ? `<strong>${int(g.length)} ausgewählt.</strong>` : 'Nichts ausgewählt.';
    $('#diLos', root).disabled = !g.length;
    $('#diLos', root).textContent = g.length ? `${int(g.length)} übernehmen` : 'Übernehmen';
    router.leaveGuard = g.length ? verlassen : null;
  };
  fuss();
  $('#diLos', root).addEventListener('click', async () => {
    const g = auswahl();
    const kind = $('#diKind', root)?.value || '';
    const fenster = fortschrittsFenster();
    try {
      const n = kontakte
        ? await kontakteUebernehmen(g.map((x) => ({ ...x.kontakt, ...(kind ? { kind } : {}) })), { datei: st.name })
        : await produkteUebernehmen(g.map((x) => x.produkt), { datei: st.name });
      fenster.close();
      st = { ...leer(), schritt: 'fertig', ergebnis: { art: st.art, datei: st.name, anzahl: n, fehler: [] } };
      zeichnen(root);
    } catch (e) {
      fenster.close();
      err('Nicht übernommen', e.message);
    }
  });

  const spalten = kontakte ? [
    { key: 'name', label: 'Name', type: 'text', tdCls: 'strong', value: (x) => x.kontakt.name, cell: (x) => `${esc(x.kontakt.name)}${x.grund ? `<div class="tiny muted">${esc(x.grund)}</div>` : ''}` },
    { key: 'kind', label: 'Art', type: 'text', cls: 'col-mh-opt', tdCls: 'small col-mh-opt', value: (x) => KIND[x.kontakt.kind] || '', cell: (x) => esc(KIND[x.kontakt.kind] || '') },
    { key: 'mail', label: 'E-Mail und Telefon', type: 'text', tdCls: 'small', value: (x) => x.kontakt.email, cell: (x) => `${esc(x.kontakt.email || '')}${x.kontakt.phone ? `<div class="tiny muted">${esc(x.kontakt.phone)}</div>` : ''}` },
    { key: 'ort', label: 'Anschrift', type: 'text', cls: 'col-mh-opt', tdCls: 'small col-mh-opt', value: (x) => x.kontakt.city, cell: (x) => esc([x.kontakt.street, [x.kontakt.zip, x.kontakt.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')) },
  ] : [
    { key: 'name', label: 'Bezeichnung', type: 'text', tdCls: 'strong', value: (x) => x.produkt.name, cell: (x) => `${esc(x.produkt.name)}${x.produkt.artikelnummer ? `<div class="tiny muted">${esc(x.produkt.artikelnummer)}</div>` : ''}${x.grund ? `<div class="tiny muted">${esc(x.grund)}</div>` : ''}` },
    { key: 'preis', label: 'Preis netto', type: 'num', value: (x) => x.produkt.preis, cell: (x) => `<span class="nowrap">${esc(money(x.produkt.preis))} €</span><div class="tiny muted">je ${esc(x.produkt.einheitText || x.produkt.einheit)}</div>` },
    { key: 'satz', label: 'USt', type: 'num', value: (x) => x.produkt.satz, cell: (x) => `${esc(x.produkt.satz)} %` },
    { key: 'kat', label: 'Kategorie', type: 'text', cls: 'col-mh-opt', tdCls: 'small col-mh-opt', value: (x) => x.produkt.kategorie, cell: (x) => esc(x.produkt.kategorie || '') },
  ];
  mountTable($('#diTabelle', root), {
    id: `datenimport-${st.art}`,
    cls: 'data',
    rows: st.liste,
    unit: kontakte ? ['Kontakt', 'Kontakte'] : ['Produkt', 'Produkte'],
    columns: [
      { key: 'wahl', label: '', type: 'none', width: '44px', cell: (x) => `<input type="checkbox" data-wahl="${x.index}" ${x.gewaehlt ? 'checked' : ''} aria-label="${esc((x.kontakt || x.produkt).name)} übernehmen">` },
      ...spalten,
    ],
    onRender: (el) => {
      $$('[data-wahl]', el).forEach((c) => c.addEventListener('change', () => { st.liste[Number(c.dataset.wahl)].gewaehlt = c.checked; fuss(); }));
    },
  });
}

/* -------------------------------------------------------------------------- */
/* ELSTER                                                                      */
/* -------------------------------------------------------------------------- */

function elsterOeffnen(text, name, root) {
  const { meldungen, hinweise } = elsterLesen(text);
  st = { ...leer(), schritt: 'pruefen', art: 'elster', name, meldungen, hinweise };
  zeichnen(root);
}

function pruefenElster(root) {
  const vorhanden = store.db.elsterMeldungen || [];
  root.innerHTML = `
    <div class="card mb16"><div class="card-body">
      <div class="row between wrap" style="gap:10px">
        <div><strong>${esc(st.name)}</strong><div class="small muted">ELSTER-Datei, ${int(st.meldungen.length)} ${st.meldungen.length === 1 ? 'Umsatzsteuer-Voranmeldung' : 'Umsatzsteuer-Voranmeldungen'}</div></div>
        <button class="btn sm" id="diAnders">${icon('left', 14).__raw} Andere Datei</button>
      </div>
      <p class="small mb0 mt8">Kontovia vergleicht die gemeldeten Werte mit den Buchungen desselben Zeitraums. Gespeichert wird die Meldung als Nachweis, was beim Finanzamt angegeben ist; Buchungen entstehen daraus nicht.</p>
      ${st.hinweise.length ? `<ul class="small">${st.hinweise.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    </div></div>
    ${st.meldungen.map((m) => {
    const alt = vorhanden.find((x) => x.jahr === m.jahr && x.zeitraum === m.zeitraum);
    return `<div class="card mb16"><div class="card-head"><h3>${esc(zeitraumText(m.jahr, m.zeitraum))}${m.berichtigt ? ' <span class="badge tiny">berichtigt</span>' : ''}</h3>
      <span class="sub">${m.steuernummer ? `Steuernummer ${esc(m.steuernummer)}` : ''}${alt ? ' · ersetzt die früher eingelesene' : ''}</span></div>
      <div class="card-body">${vergleichHtml(m)}</div></div>`;
  }).join('')}
    <div class="row between wrap mt16 mb16 apply-bar dirty" style="gap:10px"><span class="small">${int(st.meldungen.length)} ${st.meldungen.length === 1 ? 'Meldung' : 'Meldungen'} speichern, um sie später wieder zu vergleichen.</span>
      <button class="btn primary lg" id="diLos">Speichern</button></div>`;
  $('#diAnders', root).addEventListener('click', () => { st = leer(); zeichnen(root); });
  $('#diLos', root).addEventListener('click', async () => {
    try {
      const erg = await meldungenSpeichern(st.meldungen, { datei: st.name });
      ok('Voranmeldungen gespeichert', `${int(erg.neu)} neu${erg.ersetzt ? `, ${int(erg.ersetzt)} ersetzt` : ''}`);
      st = leer();
      zeichnen(root);
    } catch (e) {
      err('Nicht gespeichert', e.message);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Fertig                                                                      */
/* -------------------------------------------------------------------------- */

function fertig(root) {
  const e = st.ergebnis;
  router.leaveGuard = null;
  const text = e.art === 'buchungen'
    ? `<strong>${int(e.gebucht)}</strong> ${e.gebucht === 1 ? 'Buchung' : 'Buchungen'} übernommen${e.bezahlt ? `, <strong>${int(e.bezahlt)}</strong> ${e.bezahlt === 1 ? 'Zahlung' : 'Zahlungen'} zu vorhandenen Buchungen eingetragen` : ''}${e.kontakte ? `, ${int(e.kontakte)} ${e.kontakte === 1 ? 'Kontakt' : 'Kontakte'} angelegt` : ''}.`
    : `<strong>${int(e.anzahl)}</strong> ${e.art === 'kontakte' ? (e.anzahl === 1 ? 'Kontakt' : 'Kontakte') : (e.anzahl === 1 ? 'Produkt' : 'Produkte')} übernommen.`;
  root.innerHTML = `
    <div class="card"><div class="card-body">
      <h3 class="mt0">${icon('check', 18).__raw} ${e.fehler?.length ? 'Fertig, mit Hinweisen' : 'Fertig'}</h3>
      <p>Aus „${esc(e.datei)}“: ${text}</p>
      ${e.fehler?.length ? `<div class="notice warn"><strong>${int(e.fehler.length)} ${e.fehler.length === 1 ? 'Zeile wurde' : 'Zeilen wurden'} nicht übernommen:</strong><ul class="mb0">${e.fehler.slice(0, 100).map((f) => `<li>${esc(f.text)}: ${esc(f.grund)}</li>`).join('')}</ul></div>` : ''}
      ${e.art === 'buchungen' ? '<p class="small muted">Dieselbe Datei noch einmal einzulesen, übernimmt nichts doppelt.</p>' : ''}
      <div class="row wrap mt16" style="gap:8px">
        <button class="btn primary" id="diZiel">${e.art === 'buchungen' ? 'Zu den Buchungen' : e.art === 'kontakte' ? 'Zu den Kontakten' : 'Zu den Produkten'}</button>
        <button class="btn" id="diNoch">Weitere Datei übernehmen</button>
      </div>
    </div></div>`;
  $('#diZiel', root).addEventListener('click', () => {
    const art = e.art;
    st = leer();
    if (art === 'buchungen') navigate('transactions');
    else if (art === 'kontakte') navigate('master', { tab: 'contacts' });
    else navigate('rechnungen', { tab: 'produkte' });
  });
  $('#diNoch', root).addEventListener('click', () => { st = leer(); zeichnen(root); });
}
