/**
 * Kontovia – Mahnwesen: Liste der überfälligen Rechnungen, Mahnung erstellen,
 * Verlauf je Rechnung, Mahnkosten als eingegangen buchen.
 *
 * Gerechnet wird in lib/mahnwesen.js, gespeichert in lib/mahnungsaktionen.js.
 * Eine Mahnung ändert die Rechnung nicht und bucht nichts; die Mahnkosten
 * (Mahngebühr und Verzugsaufschlag) werden erst gebucht, wenn das Geld da ist.
 */

import { esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO, int, sum, addDays } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, err, statCard } from '../lib/ui.js';
import { store, sel, lockedUntil } from '../lib/store.js';
import { navigate, refresh } from '../lib/router.js';
import { mountTable } from '../lib/table.js';
import { betragText, titel as titelVon } from '../lib/rechnung.js';
import { isVoidPart } from '../lib/calc.js';
import {
  MAHNSTUFEN, mahneinstellungen, mahnungKurz, mahnverlauf, stufenName, MAHNTEXTE, AUFSCHLAG_ARTEN, KUNDENARTEN, kundenartVon,
} from '../lib/mahnwesen.js';
import {
  mahnungen, ueberfaelligeRechnungen, mahnstand, mahnkostenVon, mahnungVorbereiten, mahnungErstellen, mahnungVerwerfen,
  mahnungPdfLesen, mahnkostenBuchen,
} from '../lib/mahnungsaktionen.js';
import { base64 } from '../lib/pdfausgabe.js';

const api = window.kontovia;
const PDF_FILTER = [{ name: 'PDF-Dokument', extensions: ['pdf'] }];

const sicher = (fn) => async (e) => {
  const knopf = e?.currentTarget;
  if (knopf) knopf.disabled = true;
  try { await fn(); } catch (ex) { err('Das hat nicht geklappt', ex.message); }
  if (knopf?.isConnected) knopf.disabled = false;
};

/* -------------------------------------------------------------------------- */
/* Reiter „Mahnwesen“ in den Rechnungen                                        */
/* -------------------------------------------------------------------------- */

export function mahnwesenZeigen(root) {
  const heute = todayISO();
  const liste = ueberfaelligeRechnungen(heute);
  const alle = mahnungen().filter((m) => !m.verworfen);
  const jahr = String(new Date().getFullYear());
  const ohneMahnung = liste.filter((x) => !x.s.letzte);
  const mahnkostenOffen = sel.invoices().filter((r) => r.richtung !== 'eingang')
    .map((r) => ({ r, k: mahnkostenVon(r.id) })).filter((x) => x.k.offen > 0);
  // Überfällige Einnahmen, die ohne Rechnung aus Kontovia gebucht sind (etwa aus einem anderen
  // Programm übernommen). Mahnen lässt sich nur eine Rechnung von hier; der Hinweis führt zu ihnen.
  const ohneRechnung = sel.transactions().filter((t) => t.type === 'income' && !t.paidDate && !t.invoiceId
    && !t.unlisted && !isVoidPart(t) && (t.dueDate || t.date) < heute);

  root.innerHTML = `
    ${ohneRechnung.length ? `<div class="notice mb16">
      ${ohneRechnung.length === 1 ? 'Eine überfällige Einnahme ist' : `${int(ohneRechnung.length)} überfällige Einnahmen sind`}
      ohne Rechnung aus Kontovia gebucht (zusammen ${esc(money(sum(ohneRechnung, (t) => t.gross)))} €). Mahnen lässt sich hier nur,
      was Sie in Kontovia geschrieben haben. <button type="button" class="stat-link" id="mwOhneRechnung">In den Buchungen ansehen</button>
    </div>` : ''}
    <div class="grid c4 mb16 re-kennzahlen">
      ${statCard({ label: 'Überfällig', value: `${money(sum(liste, (x) => x.s.rest))} €`, tone: liste.length ? 'neg' : '', foot: `${int(liste.length)} ${liste.length === 1 ? 'Rechnung' : 'Rechnungen'}`, icon: 'alert' }).__raw}
      ${statCard({ label: 'Noch nicht gemahnt', value: int(ohneMahnung.length), foot: ohneMahnung.length ? 'Zahlungserinnerung fehlt noch' : 'alle überfälligen sind gemahnt', icon: 'clock' }).__raw}
      ${statCard({ label: 'Mahnkosten offen', value: `${money(sum(mahnkostenOffen, (x) => x.k.offen))} €`, foot: 'Gebühr und Verzugsaufschlag, noch nicht eingegangen', icon: 'euro' }).__raw}
      ${statCard({ label: `Mahnungen ${jahr}`, value: int(alle.filter((m) => String(m.datum).startsWith(jahr)).length), foot: 'erstellt', icon: 'file' }).__raw}
    </div>
    <div class="card mb16">
      <div class="card-head"><h2>${icon('alert', 16).__raw} Überfällige Rechnungen</h2>
        <button class="btn sm" id="mwEinst">${icon('settings', 14).__raw} Fristen, Gebühren und Verzugsaufschlag</button></div>
      <div id="mwListe"></div>
    </div>
    ${mahnkostenOffen.length ? `<div class="card mb16"><div class="card-head"><h2>${icon('euro', 16).__raw} Mahnkosten, die noch nicht eingegangen sind</h2></div><div id="mwKosten"></div></div>` : ''}
    <div class="card"><div class="card-head"><h2>${icon('history', 16).__raw} Alle Mahnungen</h2></div><div id="mwVerlauf"></div></div>`;

  $('#mwEinst', root).addEventListener('click', () => navigate('settings', { abschnitt: 'mahnwesen' }));
  $('#mwOhneRechnung', root)?.addEventListener('click', () => navigate('transactions', {
    ids: ohneRechnung.map((t) => t.id),
    titel: 'Überfällige Einnahmen ohne Rechnung',
    period: { preset: 'alles', from: '1900-01-01', to: '2999-12-31' },
    status: 'alle',
  }));

  const stand = (x) => {
    const m = x.s.letzte;
    if (!m) return '<span class="muted">noch nicht gemahnt</span>';
    return `${esc(stufenName(m.stufe))} am ${esc(fmtDate(m.datum))}<div class="tiny ${x.s.fristLaeuft ? 'muted' : 'neg'}">Frist bis ${esc(fmtDate(m.frist))}${x.s.fristLaeuft ? ' läuft noch' : ' abgelaufen'}</div>`;
  };
  mountTable($('#mwListe', root), {
    id: 'mahnwesen-ueberfaellig',
    cls: 'data mw-list',
    defaultSort: { key: 'faellig', dir: 1 },
    rows: liste,
    unit: ['Rechnung', 'Rechnungen'],
    search: { placeholder: 'Nummer oder Kunde suchen …', text: (x) => [x.r.nummer, x.r.kaeufer?.name, x.r.betreff].join(' ') },
    columns: [
      { key: 'nummer', label: 'Nummer', type: 'text', tdCls: 'strong nowrap', value: (x) => x.r.nummer, cell: (x) => esc(x.r.nummer) },
      { key: 'kunde', label: 'Kunde', type: 'text', value: (x) => x.r.kaeufer?.name || '', cell: (x) => esc(x.r.kaeufer?.name || '–') },
      { key: 'faellig', label: 'Fällig am', type: 'date', tdCls: 'nowrap small', value: (x) => x.s.faellig, cell: (x) => `${esc(fmtDate(x.s.faellig))}<div class="tiny muted">seit ${int(x.s.tageUeber)} Tagen</div>` },
      { key: 'offen', label: 'Offen', type: 'num', value: (x) => x.s.rest, cell: (x) => `${esc(money(x.s.rest))} €` },
      { key: 'stand', label: 'Letzte Mahnung', type: 'text', value: (x) => (x.s.letzte ? x.s.letzte.stufe : 0), cell: stand },
      {
        key: 'vorschlag', label: 'Als Nächstes', type: 'num', value: (x) => (x.s.alleDurch ? 4 : x.s.vorschlag),
        cell: (x) => (x.s.alleDurch ? '<span class="badge plain">alle Stufen durchlaufen</span>' : `<span class="badge ${x.s.vorschlag === 1 ? 'info' : 'warn'}">${esc(MAHNSTUFEN[x.s.vorschlag].kurz)}</span>`),
      },
      {
        key: 'aktion', label: '', type: 'none', width: '120px', cls: 'right', tdCls: 'nowrap',
        cell: (x) => `<button class="btn sm ${x.s.fristLaeuft ? '' : 'primary'}" data-mahnen="${esc(x.r.id)}">${x.s.alleDurch ? 'Erneut mahnen' : 'Mahnen'}</button>`,
      },
    ],
    filters: [{
      key: 'frist', column: 'stand', title: 'Stand', initial: 'alle', chip: (v, label) => label,
      options: () => [
        ['alle', 'Alle', () => true],
        ['neu', 'Noch nicht gemahnt', (x) => !x.s.letzte],
        ['laeuft', 'Frist läuft noch', (x) => x.s.fristLaeuft],
        ['abgelaufen', 'Frist abgelaufen', (x) => !!x.s.letzte && !x.s.fristLaeuft],
      ],
    }],
    emptyTitle: 'Nichts überfällig',
    emptyText: 'Sobald eine ausgestellte Rechnung nach ihrer Fälligkeit noch offen ist, erscheint sie hier mit dem Vorschlag für die nächste Stufe.',
    onRowClick: (x) => navigate('rechnungen', { id: x.r.id }),
    onRender: (el) => {
      $$('tbody tr[data-row]', el).forEach((tr) => [...tr.children].forEach((td, i) => { const k = ['mw-nr', 'mw-kunde', 'mw-faellig', 'mw-offen', 'mw-stand', 'mw-vor', 'mw-akt'][i]; if (k) td.classList.add(k); }));
      $$('[data-mahnen]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); mahnungDialog(b.dataset.mahnen, { onFertig: refresh }); }));
    },
  });

  if (mahnkostenOffen.length) {
    mountTable($('#mwKosten', root), {
      id: 'mahnwesen-kosten',
      cls: 'data mw-list',
      rows: mahnkostenOffen,
      unit: ['Rechnung', 'Rechnungen'],
      columns: [
        { key: 'nummer', label: 'Rechnung', type: 'text', tdCls: 'strong nowrap', value: (x) => x.r.nummer, cell: (x) => esc(x.r.nummer) },
        { key: 'kunde', label: 'Kunde', type: 'text', value: (x) => x.r.kaeufer?.name || '', cell: (x) => esc(x.r.kaeufer?.name || '–') },
        { key: 'stufe', label: 'Letzte Mahnung', type: 'text', value: (x) => x.k.letzte?.stufe || 0, cell: (x) => esc(mahnungKurz(x.k.letzte)) },
        { key: 'offen', label: 'Offen', type: 'num', value: (x) => x.k.offen, cell: (x) => `${esc(money(x.k.offen))} €` },
        { key: 'aktion', label: '', type: 'none', width: '150px', cls: 'right', tdCls: 'nowrap', cell: (x) => `<button class="btn sm" data-kosten="${esc(x.r.id)}">Eingang buchen</button>` },
      ],
      onRowClick: (x) => navigate('rechnungen', { id: x.r.id }),
      onRender: (el) => {
        $$('tbody tr[data-row]', el).forEach((tr) => [...tr.children].forEach((td, i) => { const k = ['mw-nr', 'mw-kunde', 'mw-stand', 'mw-offen', 'mw-akt'][i]; if (k) td.classList.add(k); }));
        $$('[data-kosten]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); mahnkostenDialog(b.dataset.kosten, { onFertig: refresh }); }));
      },
    });
  }

  mountTable($('#mwVerlauf', root), {
    id: 'mahnwesen-verlauf',
    cls: 'data mw-hist',
    defaultSort: { key: 'datum', dir: -1 },
    rows: mahnungen(),
    unit: ['Mahnung', 'Mahnungen'],
    search: { placeholder: 'Nummer oder Kunde suchen …', text: (m) => [m.nummer, m.kunde, stufenName(m.stufe)].join(' ') },
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', tdCls: 'nowrap', value: (m) => m.datum, cell: (m) => esc(fmtDate(m.datum)) },
      { key: 'nummer', label: 'Rechnung', type: 'text', tdCls: 'strong nowrap', value: (m) => m.nummer, cell: (m) => esc(m.nummer) },
      { key: 'kunde', label: 'Kunde', type: 'text', cls: 'col-mh-opt', tdCls: 'col-mh-opt', value: (m) => m.kunde, cell: (m) => esc(m.kunde || '–') },
      { key: 'stufe', label: 'Stufe', type: 'num', value: (m) => m.stufe, cell: (m) => `${esc(stufenName(m.stufe))}${m.verworfen ? ' <span class="badge plain">verworfen</span>' : ''}` },
      { key: 'gebuehr', label: 'Gebühr', type: 'num', cls: 'col-mh-opt', tdCls: 'num col-mh-opt', value: (m) => m.gebuehr, cell: (m) => (m.gebuehr ? `${esc(money(m.gebuehr))} €` : '') },
      { key: 'aufschlag', label: 'Verzugsaufschlag', type: 'num', cls: 'col-mh-opt', tdCls: 'num col-mh-opt', value: (m) => aufschlagSumme(m), cell: (m) => (aufschlagSumme(m) ? `${esc(money(aufschlagSumme(m)))} €` : '') },
      { key: 'gesamt', label: 'Gefordert', type: 'num', value: (m) => m.gesamt, cell: (m) => `${esc(money(m.gesamt))} €` },
      {
        key: 'aktion', label: '', type: 'none', width: '96px', cls: 'right', tdCls: 'nowrap',
        cell: (m) => `<button class="btn sm ghost" data-pdf="${esc(m.id)}" title="PDF ansehen" aria-label="PDF ansehen">${icon('pdf', 14).__raw}</button>`,
      },
    ],
    emptyTitle: 'Noch keine Mahnungen',
    emptyText: 'Erstellte Zahlungserinnerungen und Mahnungen stehen hier mit ihrem PDF.',
    onRowClick: (m) => navigate('rechnungen', { id: m.invoiceId }),
    onRender: (el) => {
      $$('tbody tr[data-row]', el).forEach((tr) => [...tr.children].forEach((td, i) => { const k = ['mh-datum', 'mh-nr', 'mh-kunde', 'mh-stufe', 'mh-gebuehr', 'mh-aufschlag', 'mh-gesamt', 'mh-akt'][i]; if (k) td.classList.add(k); }));
      $$('[data-pdf]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); mahnungAnsehen(mahnungen().find((m) => m.id === b.dataset.pdf)); }));
    },
  });
}

/** Der Aufschlag, den ein Schreiben zusätzlich zum bisherigen verlangt (Anteil nach Tagen und eine neu berechnete Pauschale). */
function aufschlagSumme(m) {
  return (Number(m.aufschlag?.zins) || 0) + (m.aufschlag?.pauschaleNeu ? Number(m.aufschlag?.pauschale) || 0 : 0);
}

/* -------------------------------------------------------------------------- */
/* Verlauf in der Rechnung                                                     */
/* -------------------------------------------------------------------------- */

/** Karte „Mahnungen“ in der Ansicht einer ausgestellten Rechnung. */
export function mahnungenKarte(host, r) {
  const stand = mahnstand(r);
  const verlauf = mahnverlauf(mahnungen(), r.id);
  const verworfene = mahnungen().filter((m) => m.invoiceId === r.id && m.verworfen);
  const kosten = mahnkostenVon(r.id);
  if (!stand.mahnbar && !verlauf.length && !verworfene.length) { host.closest('.card')?.remove(); return; }

  host.innerHTML = `
    ${stand.mahnbar ? `<div class="notice ${stand.fristLaeuft ? '' : 'warn'} mb8">
      Seit ${int(stand.tageUeber)} Tagen überfällig, ${esc(money(stand.rest))} € offen.
      ${stand.letzte ? `Letzte Mahnung: ${esc(stufenName(stand.letzte.stufe))} am ${esc(fmtDate(stand.letzte.datum))}, Frist bis ${esc(fmtDate(stand.letzte.frist))}${stand.fristLaeuft ? ' (läuft noch)' : ' (abgelaufen)'}.` : 'Noch nicht gemahnt.'}
    </div>` : ''}
    ${[...verlauf, ...verworfene].sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || a.stufe - b.stufe).map((m) => `
      <div class="re-datei" data-mid="${esc(m.id)}">
        <span>${esc(mahnungKurz(m))}${m.verworfen ? ' <span class="badge plain">verworfen</span>' : ''}<div class="tiny muted">Gefordert ${esc(money(m.gesamt))} € bis ${esc(fmtDate(m.frist))}</div></span>
        <span class="row" style="gap:4px">
          <button class="btn sm ghost" data-pdf="${esc(m.id)}" title="PDF ansehen" aria-label="PDF ansehen">${icon('pdf', 14).__raw}</button>
          ${m.verworfen ? '' : `<button class="btn sm ghost" data-weg="${esc(m.id)}" title="Mahnung zurücknehmen" aria-label="Mahnung zurücknehmen">${icon('x', 14).__raw}</button>`}
        </span>
      </div>`).join('')}
    ${kosten.gesamt > 0 ? `<p class="small mt8 mb0">Mahnkosten (Gebühr und Verzugsaufschlag): ${esc(money(kosten.gesamt))} €${kosten.bezahlt ? `, davon ${esc(money(kosten.bezahlt))} € eingegangen` : ''}.
      ${kosten.offen > 0 ? `Noch offen: <strong>${esc(money(kosten.offen))} €</strong>. Gebucht wird erst, wenn das Geld eingegangen ist.` : 'Alles eingegangen.'}</p>` : ''}
    <div class="re-aktionen mt8">
      ${stand.mahnbar ? `<button class="btn ${stand.fristLaeuft ? '' : 'primary'}" id="mhNeu">${icon('plus', 15).__raw} ${stand.alleDurch ? 'Mahnung erneut erstellen' : `${esc(MAHNSTUFEN[stand.vorschlag].name)} erstellen`}</button>` : ''}
      ${kosten.offen > 0 ? `<button class="btn" id="mhKosten">${icon('check', 15).__raw} Mahnkosten als eingegangen buchen</button>` : ''}
    </div>`;

  $('#mhNeu', host)?.addEventListener('click', () => mahnungDialog(r.id, { onFertig: refresh }));
  $('#mhKosten', host)?.addEventListener('click', () => mahnkostenDialog(r.id, { onFertig: refresh }));
  $$('[data-pdf]', host).forEach((b) => b.addEventListener('click', sicher(() => mahnungAnsehen(mahnungen().find((m) => m.id === b.dataset.pdf)))));
  $$('[data-weg]', host).forEach((b) => b.addEventListener('click', async () => {
    const m = mahnungen().find((x) => x.id === b.dataset.weg);
    const yes = await confirmDialog({
      title: 'Mahnung zurücknehmen?',
      text: `${stufenName(m.stufe)} vom ${fmtDate(m.datum)} bleibt mit ihrem PDF im Verlauf stehen, zählt aber nicht mehr für die nächste Stufe und die Mahnkosten. Das ist für ein Schreiben gedacht, das Sie noch nicht verschickt haben.`,
      confirmLabel: 'Zurücknehmen', danger: true,
    });
    if (!yes) return;
    try { await mahnungVerwerfen(m.id); ok('Mahnung zurückgenommen'); refresh(); } catch (ex) { err('Nicht zurückgenommen', ex.message); }
  }));
}

/** Das PDF einer Mahnung zeigen. */
async function mahnungAnsehen(m) {
  const bytes = await mahnungPdfLesen(m);
  if (!bytes) { warn('Die PDF-Datei liegt auf diesem Gerät nicht vor'); return; }
  return api.file.open({ dataBase64: base64(bytes), defaultName: `${stufenName(m.stufe)}_${m.nummer}.pdf`, mime: 'application/pdf' });
}

/** Das PDF einer Mahnung speichern. */
async function mahnungSpeichern(m) {
  const bytes = await mahnungPdfLesen(m);
  if (!bytes) { warn('Die PDF-Datei liegt auf diesem Gerät nicht vor'); return null; }
  return api.file.save({ dataBase64: base64(bytes), defaultName: `${MAHNSTUFEN[m.stufe]?.dateiname || 'Mahnung'}_${String(m.nummer).replace(/[^\w.-]+/g, '_')}.pdf`, filters: PDF_FILTER });
}

/* -------------------------------------------------------------------------- */
/* Dialog: Mahnung erstellen                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} rechnungId
 * @param {{onFertig?:Function}} [opt]
 */
export function mahnungDialog(rechnungId, { onFertig } = {}) {
  const r = sel.invoice(rechnungId);
  if (!r) { warn('Diese Rechnung gibt es nicht mehr'); return; }
  const einst = mahneinstellungen(store.db.settings);
  const stand0 = mahnstand(r);
  if (!stand0.mahnbar) { warn('Nicht mahnbar', stand0.grund); return; }

  const stufeStart = stand0.vorschlag;
  const stufenHtml = [1, 2, 3].map((st) => `<option value="${st}" ${st === stufeStart ? 'selected' : ''}>${esc(MAHNSTUFEN[st].name)}</option>`).join('');
  const kundenName = r.kaeufer?.name || '';
  const kundenart0 = kundenartVon(r, mahnungen());
  const satzOk = einst.aufschlag.prozent > 0;
  const m = modal({
    title: `Mahnung zu ${titelVon(r)} ${r.nummer}`,
    body: `
      <p class="small muted mt0">${esc(kundenName)} · ${esc(money(stand0.rest))} € offen · fällig war ${esc(fmtDate(stand0.faellig))} (${int(stand0.tageUeber)} Tage her)</p>
      ${stand0.fristLaeuft ? `<div class="notice mb16">Die Frist der letzten Mahnung läuft noch bis ${esc(fmtDate(stand0.fristBis))}.</div>` : ''}
      <div class="form-grid">
        <div class="field"><label for="mh_stufe">Stufe</label><select id="mh_stufe">${stufenHtml}</select></div>
        <div class="field"><label for="mh_kundenart">Der Kunde ist</label><select id="mh_kundenart">${Object.entries(KUNDENARTEN).map(([k, t]) => `<option value="${k}" ${k === kundenart0 ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <span class="hint" id="mh_kundenartHinweis"></span></div>
        <div class="field"><label for="mh_datum">Datum des Schreibens</label><input type="date" id="mh_datum" value="${esc(todayISO())}"></div>
        <div class="field"><label for="mh_frist">Zahlen bis</label><input type="date" id="mh_frist"></div>
        <div class="field"><label for="mh_gebuehr">Mahngebühr €</label><input id="mh_gebuehr" inputmode="decimal" autocomplete="off">
          <span class="hint">0 oder leer: keine Gebühr, sie steht dann nicht auf dem Schreiben.</span></div>
      </div>
      <div class="field mt8" id="mh_aufschlag">
        <label>Verzugsaufschlag</label>
        <label class="check"><input type="checkbox" id="mh_prozent"> <span id="mh_prozentText"></span></label>
        <label class="check"><input type="checkbox" id="mh_pauschale"> <span id="mh_pauschaleText"></span></label>
        <span class="hint" id="mh_aufschlagHinweis"></span>
      </div>
      <div class="card mt16" style="box-shadow:none"><div class="card-body" id="mh_summe"></div></div>
      <details class="mt16"><summary>Text des Schreibens anpassen</summary>
        <div class="field mt8"><label for="mh_kopf">Text vor der Aufstellung</label><textarea id="mh_kopf" rows="5"></textarea></div>
        <div class="field mb0"><label for="mh_schluss">Text am Ende</label><textarea id="mh_schluss" rows="4"></textarea>
          <span class="hint">{frist} und {betrag} werden eingesetzt.</span></div>
      </details>
      <p class="tiny muted mt16 mb0">Das Schreiben erscheint mit Ihrer Vorlage, Ihrem Absender und dem GiroCode als PDF. Gebucht wird erst, wenn Gebühr und Verzugsaufschlag eingegangen sind. Die Rechnung selbst bleibt unverändert.
        Gebühr und Verzugsaufschlag verantworten Sie selbst, bei Privatkunden gelten andere Regeln als bei Geschäftskunden.</p>`,
    foot: `<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('pdf', 15).__raw} Mahnung erstellen</button>`,
  });
  const g = (id) => m.root.querySelector(`#mh_${id}`);
  let fristVonHand = false;
  let gebuehrVonHand = false;
  let textVonHand = false;
  let prozentVonHand = false;
  let pauschaleVonHand = false;

  const stufe = () => Number(g('stufe').value);
  const wahl = () => ({
    stufe: stufe(),
    datum: g('datum').value || todayISO(),
    frist: g('frist').value || '',
    gebuehr: g('gebuehr').value.trim() === '' ? 0 : Math.max(0, parseMoney(g('gebuehr').value)),
    prozent: g('prozent').checked,
    pauschale: g('pauschale').checked,
    kundenart: g('kundenart').value,
    kopf: textVonHand ? g('kopf').value : undefined,
    schluss: textVonHand ? g('schluss').value : undefined,
  });

  function vorgabenSetzen() {
    const st = stufe();
    const datum = g('datum').value || todayISO();
    if (!fristVonHand) g('frist').value = addDays(datum, einst.fristen[st]);
    if (!gebuehrVonHand) g('gebuehr').value = einst.gebuehren[st] ? moneyInput(einst.gebuehren[st]) : '';
    // Verzugsaufschlag: Vorschlag aus den Einstellungen, bis jemand selbst wählt
    const art = einst.aufschlag.art;
    const ab = st >= einst.aufschlag.abStufe;
    if (!prozentVonHand) g('prozent').checked = (art === 'prozent' || art === 'beides') && ab && satzOk;
    if (!pauschaleVonHand) g('pauschale').checked = (art === 'pauschale' || art === 'beides') && ab && g('kundenart').value === 'unternehmen';
    if (!textVonHand) {
      g('kopf').value = MAHNTEXTE[st].kopf;
      g('schluss').value = MAHNTEXTE[st].schluss;
    }
  }

  function zeichnen() {
    const w = wahl();
    let v;
    try { v = mahnungVorbereiten(r.id, w); } catch (ex) { g('summe').innerHTML = `<span class="neg">${esc(ex.message)}</span>`; return; }
    const b = v.berechnung;
    const pauschaleSchon = b.aufschlag.pauschale > 0 && !b.aufschlag.pauschaleNeu;
    g('prozentText').textContent = satzOk ? `Prozent pro Jahr (${String(einst.aufschlag.prozent).replace('.', ',')} %), tageweise ab Fälligkeit` : 'Prozent pro Jahr (in den Einstellungen ist noch kein Satz eingetragen)';
    g('prozent').disabled = !satzOk;
    g('pauschaleText').textContent = pauschaleSchon ? `Pauschale (${money(b.aufschlag.pauschale)} €, schon früher berechnet, bleibt in der Forderung)` : `Feste Pauschale (${money(einst.aufschlag.pauschale)} €, höchstens einmal je Rechnung)`;
    // Gegenüber Privatpersonen gibt es keine Pauschale (§ 288 Abs. 5 BGB).
    const privat = b.kundenart === 'privat';
    g('kundenartHinweis').textContent = privat
      ? 'Verbraucher: Basiszinssatz plus 5 Prozentpunkte, keine Pauschale, Mahngebühr nur für tatsächlichen Aufwand. Wählen Sie „Unternehmen“, wenn der Kunde gewerblich bestellt hat.'
      : 'Unternehmen: Basiszinssatz plus 9 Prozentpunkte, dazu die Pauschale von 40 € (§ 288 BGB).';
    if (privat && !pauschaleSchon) g('pauschale').checked = false;
    g('pauschale').disabled = pauschaleSchon || privat;
    if (pauschaleSchon) g('pauschale').checked = true;
    g('aufschlagHinweis').textContent = einst.aufschlag.art === 'aus' && !g('prozent').checked && !g('pauschale').checked
      ? 'In den Einstellungen ist der Verzugsaufschlag ausgeschaltet. Hier lässt er sich für dieses eine Schreiben einschalten.' : '';
    const zeile = (l, wert, fett = false) => `<div class="row between" style="gap:12px;${fett ? 'font-weight:600;border-top:1px solid var(--border);padding-top:6px;margin-top:4px' : ''}"><span>${l}</span><span class="num">${wert}</span></div>`;
    g('summe').innerHTML = `
      ${zeile('Offener Rechnungsbetrag', `${esc(money(b.rest))} €`)}
      ${b.gebuehrFrueher ? zeile('Mahngebühren früherer Schreiben', `${esc(money(b.gebuehrFrueher))} €`) : ''}
      ${b.gebuehr ? zeile(`Mahngebühr (${esc(MAHNSTUFEN[b.stufe].kurz)})`, `${esc(money(b.gebuehr))} €`) : ''}
      ${b.aufschlag.zins ? zeile(`Verzugsaufschlag ${esc(String(b.aufschlag.satz).replace('.', ','))} % für ${int(b.aufschlag.tage)} Tage`, `${esc(money(b.aufschlag.zins))} €`) : ''}
      ${b.aufschlag.pauschale ? zeile('Verzugsaufschlag (Pauschale)', `${esc(money(b.aufschlag.pauschale))} €`) : ''}
      ${b.nebenBezahlt ? zeile('abzüglich bereits gezahlter Mahnkosten', `−${esc(money(b.nebenBezahlt))} €`) : ''}
      ${zeile(`Zu zahlen bis ${esc(fmtDate(b.frist))}`, `${esc(money(b.gesamt))} €`, true)}
      ${b.warnungen.map((x) => `<div class="small neg mt8">${esc(x)}</div>`).join('')}`;
  }

  g('stufe').addEventListener('change', () => { vorgabenSetzen(); zeichnen(); });
  g('kundenart').addEventListener('change', () => { vorgabenSetzen(); zeichnen(); });
  g('datum').addEventListener('change', () => { vorgabenSetzen(); zeichnen(); });
  g('frist').addEventListener('input', () => { fristVonHand = true; zeichnen(); });
  g('gebuehr').addEventListener('input', () => { gebuehrVonHand = true; zeichnen(); });
  g('prozent').addEventListener('change', () => { prozentVonHand = true; zeichnen(); });
  g('pauschale').addEventListener('change', () => { pauschaleVonHand = true; zeichnen(); });
  g('kopf').addEventListener('input', () => { textVonHand = true; zeichnen(); });
  g('schluss').addEventListener('input', () => { textVonHand = true; zeichnen(); });
  vorgabenSetzen();
  zeichnen();

  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async (e) => {
    const knopf = e.currentTarget;
    knopf.disabled = true;
    try {
      const mh = await mahnungErstellen(r.id, wahl());
      m.close();
      ok(`${stufenName(mh.stufe)} erstellt`, `${betragText(mh.gesamt)} bis ${fmtDate(mh.frist)}`);
      onFertig?.();
      await mahnungAnsehen(mh).catch(() => {});
    } catch (ex) {
      knopf.disabled = false;
      err('Mahnung nicht erstellt', ex.message);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Dialog: Mahnkosten als eingegangen buchen                                   */
/* -------------------------------------------------------------------------- */

export function mahnkostenDialog(rechnungId, { onFertig } = {}) {
  const r = sel.invoice(rechnungId);
  const k = mahnkostenVon(rechnungId);
  if (!r || k.offen <= 0) { warn('Es stehen keine Mahnkosten offen'); return; }
  const konten = sel.accounts().filter((a) => a.active !== false);
  const m = modal({
    title: `Mahnkosten zu ${r.nummer} buchen`,
    size: 'slim',
    body: `
      <p class="mt0">Gebühr und Verzugsaufschlag sind kein Entgelt für eine Leistung. Sie werden deshalb ohne Umsatzsteuer als eigene Einnahme gebucht, und zwar an dem Tag, an dem das Geld eingegangen ist.</p>
      <div class="form-grid">
        <div class="field"><label for="mk_betrag">Betrag €</label><input id="mk_betrag" inputmode="decimal" value="${esc(moneyInput(k.offen))}"><span class="hint">Offen sind ${esc(money(k.offen))} €.</span></div>
        <div class="field"><label for="mk_datum">Eingegangen am</label><input type="date" id="mk_datum" value="${esc(todayISO())}"></div>
        <div class="field full"><label for="mk_konto">Zahlungskonto</label><select id="mk_konto">${konten.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
      </div>
      ${lockedUntil() ? `<p class="small muted mb0">Festgeschrieben bis ${esc(fmtDate(lockedUntil()))}: Das Datum muss danach liegen.</p>` : ''}`,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Buchen</button>',
  });
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', sicher(async () => {
    const betrag = parseMoney(m.root.querySelector('#mk_betrag').value);
    await mahnkostenBuchen(rechnungId, { datum: m.root.querySelector('#mk_datum').value || todayISO(), kontoId: m.root.querySelector('#mk_konto').value, betrag });
    m.close();
    ok('Mahnkosten gebucht');
    onFertig?.();
  }));
}

export { mahnungSpeichern, AUFSCHLAG_ARTEN };
