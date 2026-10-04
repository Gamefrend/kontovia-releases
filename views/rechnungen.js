/**
 * Kontovia – Rechnungen: schreiben, verwalten, (bald) verschicken und
 * empfangen.
 *
 * Reiter:
 *   Rechnungen  ausgehende Rechnungen, Entwürfe, Stornos
 *   Eingang     erhaltene E-Rechnungen ansehen und buchen
 *   Produkte    Leistungen mit Preis, Einheit und Steuersatz
 *   Vorlagen    wiederkehrende Rechnungen als Ausgangspunkt
 *   Gestaltung  Aussehen des PDFs und Angaben, die auf jeder Rechnung stehen
 *
 * Eine Rechnung öffnet sich als eigene Seite (params.id): ein Entwurf im
 * Editor (rechnungseditor.js), eine ausgestellte zum Ansehen.
 */

import { esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO, uid, int, sum } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, err, statCard } from '../lib/ui.js';
import { store, sel, commit, deleteEntity, saveNow } from '../lib/store.js';
import { router, navigate, refresh } from '../lib/router.js';
import { openMenu } from '../lib/popover.js';
import { mountTable } from '../lib/table.js';
import {
  EINHEITEN, LAENDER, berechnen, zustand, ZUSTAENDE, faelligkeit, neueRechnung, profil as profilAus, design as designAus,
  PROFIL_VORGABE, DESIGN_VORGABE, verkaeuferAus, einheitText, einheitAusText, betragText, satzText, titel as titelVon, ibanGueltig,
  neuePosition,
} from '../lib/rechnung.js';
import {
  stornieren, alsBezahlt, kopieAlsEntwurf, ausVorlage, alsVorlage, versandVermerken, produktSpeichern, rechnungSpeichern,
} from '../lib/rechnungsaktionen.js';
import {
  vorschauSvg, pdfSpeichern, pdfZeigen, xmlSpeichern, bildAblegen, bildWaehlen, bilderLaden, base64ZuBytes,
} from '../lib/rechnungsdateien.js';
import { eRechnungAusDatei } from '../lib/erechnung.js';
import { zeigeERechnung } from './erechnung.js';
import { editorZeigen } from './rechnungseditor.js';
import { openTransactionDialog } from './transactions.js';

const api = window.kontovia;

let tab = 'ausgang';
const TABS = {
  ausgang: 'Rechnungen',
  eingang: 'Eingang',
  produkte: 'Produkte',
  vorlagen: 'Vorlagen',
  gestaltung: 'Gestaltung',
};

export async function render(root, params = {}, { actions } = {}) {
  router.leaveGuard = null;
  if (params.tab && TABS[params.tab]) tab = params.tab;

  // Eine einzelne Rechnung oder Vorlage
  if (params.id) {
    const r = sel.invoice(params.id);
    if (!r) { root.innerHTML = '<div class="notice">Diese Rechnung gibt es nicht mehr.</div>'; return; }
    if (r.richtung === 'eingang') { navigate('rechnungen', { tab: 'eingang' }, { ersetzen: true }); return; }
    if (r.status === 'ausgestellt') { await detailZeigen(root, r, actions); return; }
    editorZeigen(root, { rechnung: r }, actions);
    return;
  }
  if (params.neu) {
    const r = params.vorlageId ? ausVorlage(sel.invoiceTemplates().find((v) => v.id === params.vorlageId) || { daten: {} })
      : params.kopieVon ? kopieAlsEntwurf(sel.invoice(params.kopieVon) || {}, params.ueberschreiben || {})
        : neueRechnung(store.db.settings);
    if (params.kontaktId) {
      const { kaeuferAusKontakt } = await import('../lib/rechnung.js');
      r.kaeufer = kaeuferAusKontakt(sel.contact(params.kontaktId));
    }
    editorZeigen(root, { rechnung: r }, actions);
    return;
  }
  if (params.vorlage) {
    const v = sel.invoiceTemplates().find((x) => x.id === params.vorlage) || { id: uid('rv'), name: '', daten: { ...neueRechnung(store.db.settings) } };
    editorZeigen(root, { vorlage: v }, actions);
    return;
  }

  actions.innerHTML = `
    <button class="btn primary" id="reNeu" aria-haspopup="menu">${icon('plus', 16).__raw} Neue Rechnung ${icon('down', 14).__raw}</button>`;
  $('#reNeu', actions).addEventListener('click', (e) => neuMenue(e.currentTarget));

  root.innerHTML = `
    <div class="seg tabs mb16" role="group" aria-label="Bereich">
      ${Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(v)}</button>`).join('')}
    </div>
    <div id="reBody"></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { navigate('rechnungen', { tab: b.dataset.tab }, { ersetzen: true }); }));
  const body = $('#reBody', root);
  ({ ausgang, eingang, produkte, vorlagen, gestaltung }[tab])(body, params);
}

/** „Neue Rechnung“: leer oder aus einer Vorlage. */
function neuMenue(anker) {
  const v = sel.invoiceTemplates();
  if (!v.length) { navigate('rechnungen', { neu: true }); return; }
  openMenu(anker, {
    label: 'Neue Rechnung',
    align: 'end',
    sections: [
      { key: 'n', value: '', options: [{ value: '', label: 'Leere Rechnung' }] },
      { key: 'v', title: 'Aus Vorlage', value: '', search: v.length > 6, options: v.map((x) => ({ value: x.id, label: x.name, sub: x.daten?.kaeufer?.name || '' })) },
    ],
    onPick: (k, id) => navigate('rechnungen', k === 'v' ? { neu: true, vorlageId: id } : { neu: true }),
  });
}

/* -------------------------------------------------------------------------- */
/* Ausgehende Rechnungen                                                       */
/* -------------------------------------------------------------------------- */

function zustandVon(r) {
  const buchungen = (r.transactionIds || []).map(sel.transaction).filter(Boolean);
  return zustand(r, { buchungen });
}

function ausgang(root) {
  const alle = sel.invoices().filter((r) => r.richtung !== 'eingang');
  const mitZustand = alle.map((r) => ({ r, z: zustandVon(r), b: berechnen(r) }));
  const offen = mitZustand.filter((x) => x.z === 'offen' || x.z === 'ueberfaellig');
  const ueber = mitZustand.filter((x) => x.z === 'ueberfaellig');
  const jahr = String(new Date().getFullYear());
  const diesesJahr = mitZustand.filter((x) => x.r.status === 'ausgestellt' && String(x.r.datum).startsWith(jahr) && x.z !== 'storniert' && x.z !== 'storno');
  const entwuerfe = mitZustand.filter((x) => x.z === 'entwurf');

  root.innerHTML = `
    <div class="grid c4 mb16 re-kennzahlen">
      ${statCard({ label: 'Offen', value: `${money(sum(offen, (x) => x.b.zahlbetrag))} €`, foot: `${int(offen.length)} ${offen.length === 1 ? 'Rechnung' : 'Rechnungen'}`, icon: 'clock' }).__raw}
      ${statCard({ label: 'Überfällig', value: `${money(sum(ueber, (x) => x.b.zahlbetrag))} €`, tone: ueber.length ? 'neg' : '', foot: ueber.length ? `${int(ueber.length)} seit dem Fälligkeitstag offen` : 'nichts überfällig', icon: 'alert' }).__raw}
      ${statCard({ label: `Gestellt ${jahr}`, value: `${money(sum(diesesJahr, (x) => x.b.brutto))} €`, foot: `${int(diesesJahr.length)} ausgestellt`, icon: 'chart' }).__raw}
      ${statCard({ label: 'Entwürfe', value: int(entwuerfe.length), foot: entwuerfe.length ? 'noch nicht ausgestellt' : 'keine offenen Entwürfe', icon: 'edit' }).__raw}
    </div>
    <div class="card" id="reListe"></div>`;

  mountTable($('#reListe', root), {
    id: 'rechnungen-ausgang',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: mitZustand,
    unit: ['Rechnung', 'Rechnungen'],
    search: {
      placeholder: 'Nummer, Kunde oder Betreff suchen …',
      text: (x) => [x.r.nummer, x.r.kaeufer?.name, x.r.betreff, x.r.kaeufer?.kundennummer, money(x.b.brutto)].join(' '),
    },
    columns: [
      { key: 'nummer', label: 'Nummer', type: 'text', tdCls: 'strong nowrap', value: (x) => x.r.nummer || '', cell: (x) => (x.r.nummer ? esc(x.r.nummer) : '<span class="muted">Entwurf</span>') },
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (x) => x.r.datum || '', cell: (x) => esc(fmtDate(x.r.datum)) },
      {
        key: 'kunde', label: 'Kunde', type: 'text', value: (x) => x.r.kaeufer?.name || '',
        cell: (x) => `${esc(x.r.kaeufer?.name || '–')}${x.r.betreff ? `<div class="tiny muted truncate">${esc(x.r.betreff)}</div>` : ''}`,
      },
      { key: 'art', label: 'Art', type: 'text', tdCls: 'small muted', value: (x) => titelVon(x.r), cell: (x) => esc(titelVon(x.r)) },
      { key: 'betrag', label: 'Betrag', type: 'num', value: (x) => x.b.brutto, cell: (x) => `${esc(money(x.b.brutto))} €` },
      {
        key: 'faellig', label: 'Fällig', type: 'date', cls: 'num', tdCls: 'nowrap small', value: (x) => (x.r.status === 'ausgestellt' ? faelligkeit(x.r) : ''),
        cell: (x) => (x.r.status === 'ausgestellt' && x.z !== 'bezahlt' && x.z !== 'storniert' && x.z !== 'storno' ? esc(fmtDate(faelligkeit(x.r))) : ''),
      },
      {
        key: 'zustand', label: 'Stand', type: 'text', value: (x) => ZUSTAENDE[x.z]?.name || '',
        cell: (x) => `<span class="badge ${ZUSTAENDE[x.z]?.ton || ''}">${esc(ZUSTAENDE[x.z]?.name || '')}</span>${(x.r.versand || []).length && x.r.status === 'ausgestellt' ? ` <span class="tiny muted" title="versendet">${icon('external', 12).__raw}</span>` : ''}`,
      },
      {
        key: 'actions', label: '', type: 'none', width: '84px', cls: 'right', tdCls: 'nowrap',
        cell: (x) => `<button class="btn sm ghost" data-pdf="${esc(x.r.id)}" title="PDF ansehen" aria-label="PDF ansehen">${icon('pdf', 14).__raw}</button>`,
      },
    ],
    filters: [
      {
        key: 'stand', column: 'zustand', title: 'Stand', initial: 'alle', chip: (v, label) => label,
        options: () => [['alle', 'Alle', () => true], ...Object.entries(ZUSTAENDE).map(([k, z]) => [k, z.name, (x) => x.z === k])],
      },
    ],
    emptyTitle: 'Noch keine Rechnungen',
    emptyText: 'Mit „Neue Rechnung“ schreiben Sie Ihre erste E-Rechnung. Sie entsteht als PDF mit eingebetteten Rechnungsdaten (ZUGFeRD) und als XRechnung.',
    onRowClick: (x) => navigate('rechnungen', { id: x.r.id }),
    onRender: (el) => {
      $$('[data-pdf]', el).forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await pdfZeigen(sel.invoice(b.dataset.pdf)); } catch (ex) { err('PDF nicht erstellt', ex.message); }
      }));
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Eine ausgestellte Rechnung                                                  */
/* -------------------------------------------------------------------------- */

async function detailZeigen(root, r, actions) {
  const z = zustandVon(r);
  const b = berechnen(r);
  const buchungen = (r.transactionIds || []).map(sel.transaction).filter(Boolean);
  const storno = r.storniertDurch ? sel.invoice(r.storniertDurch) : null;
  const bezug = r.bezug?.id ? sel.invoice(r.bezug.id) : null;
  const offen = z === 'offen' || z === 'ueberfaellig';

  actions.innerHTML = `<button class="btn" id="reZurueck">${icon('left', 16).__raw} Zur Übersicht</button>`;
  $('#reZurueck', actions).addEventListener('click', () => navigate('rechnungen', { tab: 'ausgang' }));

  const anhang = (id) => sel.attachment(id);
  const pdfMeta = anhang(r.dateien?.pdf);
  const xmlMeta = anhang(r.dateien?.xml);
  root.innerHTML = `
    <div class="re-editor re-detail">
      <div class="re-form">
        <div class="card">
          <div class="card-body">
            <div class="row between wrap" style="gap:10px">
              <div>
                <div class="re-detail-titel">${esc(titelVon(r))} ${esc(r.nummer)}</div>
                <div class="small muted">${esc(r.kaeufer?.name || '')}${r.betreff ? ` · ${esc(r.betreff)}` : ''}</div>
              </div>
              <span class="badge ${ZUSTAENDE[z]?.ton || ''}">${esc(ZUSTAENDE[z]?.name || '')}</span>
            </div>
            <div class="kpi-list mt16">
              <div><div class="k">Betrag</div><div class="v">${esc(betragText(b.brutto, r.waehrung))}</div></div>
              <div><div class="k">Rechnungsdatum</div><div class="v">${esc(fmtDate(r.datum))}</div></div>
              ${b.zahlbetrag > 0 ? `<div><div class="k">Fällig</div><div class="v">${esc(fmtDate(faelligkeit(r)))}</div></div>` : ''}
              <div><div class="k">Ausgestellt</div><div class="v">${esc(fmtDate(String(r.ausgestelltAm || '').slice(0, 10)))}</div></div>
            </div>
            ${storno ? `<div class="notice mt16">Storniert durch <a href="#" data-gehe="${esc(storno.id)}">${esc(titelVon(storno))} ${esc(storno.nummer)}</a> vom ${esc(fmtDate(storno.datum))}.</div>` : ''}
            ${bezug ? `<div class="notice mt16">Bezieht sich auf <a href="#" data-gehe="${esc(bezug.id)}">${esc(titelVon(bezug))} ${esc(bezug.nummer)}</a>.</div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon('export', 16).__raw} Verschicken</h3></div>
          <div class="card-body">
            <div class="re-aktionen">
              <button class="btn primary" id="reSenden">${icon('external', 15).__raw} Per E-Mail senden</button>
              <button class="btn" id="rePdfSpeichern">${icon('pdf', 15).__raw} PDF speichern</button>
              <button class="btn" id="reXml">${icon('file', 15).__raw} XRechnung speichern</button>
              <button class="btn ghost" id="rePdfAnsehen">${icon('eye', 15).__raw} PDF ansehen</button>
            </div>
            <p class="small muted mb0 mt8">Das PDF ist eine E-Rechnung nach ZUGFeRD (EN 16931): Es enthält die Rechnungsdaten maschinenlesbar.
              Behörden verlangen meist die XRechnung als eigene Datei.</p>
            ${(r.versand || []).length ? `<p class="small mb0 mt8">${r.versand.map((v) => `Versendet am ${esc(fmtDate(String(v.ts).slice(0, 10)))}${v.an ? ` an ${esc(v.an)}` : ''}${v.art === 'manuell' ? ' (von Hand vermerkt)' : ''}`).join('<br>')}</p>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon('book', 16).__raw} Zahlung und Buchung</h3></div>
          <div class="card-body">
            ${buchungen.length ? `<ul class="re-buchungen">${buchungen.map((t) => `<li><a href="#" data-tx="${esc(t.id)}">${esc(t.description)}</a>
              <span class="num">${esc(money(t.gross))} €</span>
              <span class="badge ${t.voided ? 'plain' : t.paidDate ? 'pos' : 'info'}">${t.voided ? 'storniert' : t.paidDate ? `bezahlt ${esc(fmtDate(t.paidDate))}` : 'offen'}</span></li>`).join('')}</ul>`
              : `<p class="small muted mt0">${r.storno ? 'Die Buchungen der ursprünglichen Rechnung sind storniert.' : 'Zu dieser Rechnung gibt es keine Buchung.'}</p>`}
            <div class="re-aktionen mt8">
              ${offen ? `<button class="btn" id="reBezahlt">${icon('check', 15).__raw} Als bezahlt markieren</button>` : ''}
              ${!buchungen.length && !r.storno && !r.storniertDurch ? `<button class="btn" id="reBuchen">${icon('plus', 15).__raw} Buchung anlegen</button>` : ''}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon('edit', 16).__raw} Ändern</h3></div>
          <div class="card-body">
            <p class="small muted mt0">Eine ausgestellte Rechnung bleibt, wie sie ist. Fehler behebt eine Korrektur: Die Rechnung wird storniert und
              als neuer Entwurf mit Bezug auf die alte geöffnet.</p>
            <div class="re-aktionen">
              ${!r.storno && !r.storniertDurch ? `<button class="btn" id="reKorrigieren">${icon('refresh', 15).__raw} Korrigieren</button>
              <button class="btn danger" id="reStornieren">${icon('x', 15).__raw} Stornieren</button>` : ''}
              <button class="btn" id="reDuplizieren">${icon('copy', 15).__raw} Duplizieren</button>
              <button class="btn ghost" id="reVorlage">${icon('save', 15).__raw} Als Vorlage</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon('archive', 16).__raw} Aufbewahrung</h3></div>
          <div class="card-body small">
            ${[pdfMeta, xmlMeta].filter(Boolean).map((a) => `<div class="re-datei"><span>${esc(a.fileName)}</span><span class="muted">Prüfsumme ${esc(String(a.sha256 || '').slice(0, 12))}…</span></div>`).join('')
              || '<p class="muted mt0 mb0">Die Dateien liegen auf diesem Gerät noch nicht vor.</p>'}
            <p class="muted mb0 mt8">Rechnungen müssen acht Jahre aufbewahrt werden (§ 14b UStG). Kontovia hält beide Dateien unverändert im Tresor
              und gibt sie mit jedem Export und jeder Sicherung mit.</p>
          </div>
        </div>
      </div>
      <aside class="re-seitenspalte">
        <div class="re-vorschau" id="reVorschau" aria-label="Ansicht der Rechnung"><div class="skeleton" style="height:420px"></div></div>
      </aside>
    </div>`;

  vorschauSvg(r).then((svgs) => {
    const host = $('#reVorschau', root);
    if (host) host.innerHTML = svgs.map((svg) => `<div class="re-blatt">${svg}</div>`).join('');
  }).catch(() => { const host = $('#reVorschau', root); if (host) host.innerHTML = ''; });

  const sicher = (fn) => async (e) => {
    const knopf = e?.currentTarget;
    if (knopf) knopf.disabled = true;
    try { await fn(); } catch (ex) { err('Das hat nicht geklappt', ex.message); }
    if (knopf?.isConnected) knopf.disabled = false;
  };

  $$('[data-gehe]', root).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); navigate('rechnungen', { id: a.dataset.gehe }); }));
  $$('[data-tx]', root).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openTransactionDialog(a.dataset.tx, 'income', { onSaved: () => refresh() }); }));
  $('#reSenden', root).addEventListener('click', () => sendenDialog(r));
  $('#rePdfSpeichern', root).addEventListener('click', sicher(async () => { const p = await pdfSpeichern(r); if (p) ok('PDF gespeichert', p); }));
  $('#reXml', root).addEventListener('click', sicher(async () => { const p = await xmlSpeichern(r, 'xrechnung'); if (p) ok('XRechnung gespeichert', p); }));
  $('#rePdfAnsehen', root).addEventListener('click', sicher(() => pdfZeigen(r)));
  $('#reBezahlt', root)?.addEventListener('click', () => bezahltDialog(r));
  $('#reBuchen', root)?.addEventListener('click', sicher(async () => {
    const { buchungenFuer } = await import('../lib/rechnungsaktionen.js');
    const [tx] = buchungenFuer(r);
    tx.attachments = [];
    openTransactionDialog(tx, 'income', {
      onSaved: async (gespeichert) => {
        await commit('rechnung.buchung', (db) => {
          const x = db.invoices.find((i) => i.id === r.id);
          if (x) { x.transactionIds = [...(x.transactionIds || []), gespeichert.id]; x.updatedAt = new Date().toISOString(); }
        }, { entity: 'rechnung', entityId: r.id, summary: `Buchung zu ${r.nummer} angelegt` });
        refresh();
      },
    });
  }));
  $('#reStornieren', root)?.addEventListener('click', () => stornoDialog(r, false));
  $('#reKorrigieren', root)?.addEventListener('click', () => stornoDialog(r, true));
  $('#reDuplizieren', root).addEventListener('click', () => navigate('rechnungen', { neu: true, kopieVon: r.id }));
  $('#reVorlage', root).addEventListener('click', () => vorlageDialog(r));
}

/** Verschicken: noch ohne eigenen Versand. Bis dahin Dateien speichern und den Versand vermerken. */
function sendenDialog(r) {
  const an = r.kaeufer?.email || '';
  const m = modal({
    title: 'Rechnung per E-Mail senden',
    body: `
      <div class="notice mb16">${icon('info', 15).__raw} Der Versand direkt aus Kontovia kommt mit einer der nächsten Versionen.
        Bis dahin speichern Sie das PDF und hängen es an Ihre E-Mail an.</div>
      <div class="field"><label for="reAn">Empfänger</label><input id="reAn" type="email" value="${esc(an)}" placeholder="E-Mail-Adresse des Kunden" disabled></div>
      <div class="field"><label>Anhang</label><div class="small">${esc(`Rechnung_${r.nummer}.pdf`)} (ZUGFeRD, mit E-Rechnung)</div></div>`,
    foot: `<button class="btn left" data-pdf>${icon('pdf', 15).__raw} PDF speichern</button>
      <button class="btn" data-vermerk>Als versendet vermerken</button>
      <button class="btn primary" data-senden disabled title="Kommt in einer der nächsten Versionen">${icon('external', 15).__raw} Senden</button>`,
  });
  m.root.querySelector('[data-pdf]').addEventListener('click', async () => {
    try { const p = await pdfSpeichern(r); if (p) ok('PDF gespeichert', p); } catch (e) { err('PDF nicht gespeichert', e.message); }
  });
  m.root.querySelector('[data-vermerk]').addEventListener('click', async () => {
    await versandVermerken(r.id, 'manuell', an);
    m.close();
    ok('Versand vermerkt');
    refresh();
  });
}

function bezahltDialog(r) {
  const m = modal({
    title: `${titelVon(r)} ${r.nummer} als bezahlt markieren`,
    size: 'slim',
    body: `<div class="field"><label for="reBezDatum">Bezahlt am</label><input type="date" id="reBezDatum" value="${esc(todayISO())}"></div>
      <p class="small muted mb0">Die offene Einnahme bekommt dieses Zahlungsdatum.</p>`,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Bezahlt</button>',
  });
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    try {
      await alsBezahlt(r.id, m.root.querySelector('#reBezDatum').value || todayISO());
      m.close();
      ok('Als bezahlt markiert');
      refresh();
    } catch (e) { err('Nicht markiert', e.message); }
  });
}

function stornoDialog(r, korrigieren) {
  const m = modal({
    title: korrigieren ? `${titelVon(r)} ${r.nummer} korrigieren` : `${titelVon(r)} ${r.nummer} stornieren`,
    body: `<p class="mt0">${korrigieren
      ? 'Kontovia storniert die Rechnung mit einer Stornorechnung und öffnet eine Kopie als neuen Entwurf. Die neue Rechnung bekommt beim Ausstellen eine eigene Nummer.'
      : 'Es entsteht eine Stornorechnung mit eigener Nummer, die die Rechnung in voller Höhe aufhebt. Die Buchungen dazu werden storniert.'}</p>
      <div class="field mb0"><label for="reGrund">Grund (steht auf der Stornorechnung)</label><input id="reGrund" placeholder="z. B. falscher Rechnungsempfänger"></div>`,
    foot: `<button class="btn" data-no>Abbrechen</button><button class="btn danger" data-yes>${korrigieren ? 'Stornieren und neu erstellen' : 'Stornieren'}</button>`,
  });
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const st = await stornieren(r.id, m.root.querySelector('#reGrund').value.trim());
      m.close();
      ok(`Stornorechnung ${st.nummer} ausgestellt`);
      if (korrigieren) {
        const neu = kopieAlsEntwurf(r, { bezug: { id: r.id, nummer: r.nummer, datum: r.datum }, bereitsGezahlt: r.bereitsGezahlt || 0 });
        await rechnungSpeichern(neu);
        navigate('rechnungen', { id: neu.id });
      } else refresh();
    } catch (ex) {
      e.currentTarget.disabled = false;
      err('Nicht storniert', ex.message);
    }
  });
}

function vorlageDialog(r) {
  const m = modal({
    title: 'Als Vorlage speichern',
    size: 'slim',
    body: `<div class="field"><label for="reVName">Name der Vorlage</label><input id="reVName" value="${esc(r.betreff || '')}"></div>
      <label class="check"><input type="checkbox" id="reVKunde" checked> Kunde mit speichern</label>`,
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

/* -------------------------------------------------------------------------- */
/* Eingang                                                                     */
/* -------------------------------------------------------------------------- */

function eingang(root) {
  const liste = sel.invoices().filter((r) => r.richtung === 'eingang');
  root.innerHTML = `
    <div class="card mb16 re-empfang">
      <div class="card-body row wrap" style="gap:14px;align-items:flex-start">
        <div class="re-empfang-ico">${icon('archive', 22).__raw}</div>
        <div style="flex:1;min-width:220px">
          <strong>E-Rechnungen empfangen</strong>
          <p class="small muted mt0 mb8">Seit 2025 muss jedes Unternehmen E-Rechnungen annehmen können. Bald erhalten Sie dafür eine eigene
            Empfangsadresse, an die Lieferanten ihre Rechnungen schicken; sie erscheinen dann hier von selbst.
            Bis dahin fügen Sie erhaltene XRechnungen und ZUGFeRD-PDFs hier hinzu.</p>
          <div class="row wrap">
            <button class="btn primary" id="reHinzu">${icon('plus', 15).__raw} E-Rechnung hinzufügen</button>
            <button class="btn" id="reEmpfang">${icon('settings', 15).__raw} Empfang einrichten</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card" id="reEingangListe"></div>`;
  $('#reHinzu', root).addEventListener('click', eingangHinzufuegen);
  $('#reEmpfang', root).addEventListener('click', () => {
    const m = modal({
      title: 'Empfang einrichten',
      size: 'slim',
      body: `<p class="mt0">Der automatische Empfang kommt mit einer der nächsten Versionen. Sie bekommen dann eine eigene Adresse für
        E-Rechnungen, die Sie Ihren Lieferanten nennen.</p><p class="small muted mb0">Bis dahin: E-Rechnungen aus Ihrem Postfach speichern und
        hier mit „E-Rechnung hinzufügen“ ablegen. Kontovia liest sie und bereitet die Buchung vor.</p>`,
      foot: '<button class="btn primary" data-x>Verstanden</button>',
    });
    m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  });

  mountTable($('#reEingangListe', root), {
    id: 'rechnungen-eingang',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: liste,
    unit: ['Rechnung', 'Rechnungen'],
    search: liste.length > 8 ? { placeholder: 'Absender oder Nummer suchen …', text: (r) => [r.gelesen?.verkaeufer, r.gelesen?.nummer].join(' ') } : null,
    columns: [
      { key: 'absender', label: 'Absender', type: 'text', tdCls: 'strong', value: (r) => r.gelesen?.verkaeufer || '', cell: (r) => esc(r.gelesen?.verkaeufer || '–') },
      { key: 'nummer', label: 'Nummer', type: 'text', tdCls: 'small', value: (r) => r.gelesen?.nummer || '', cell: (r) => esc(r.gelesen?.nummer || '') },
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (r) => r.gelesen?.datum || '', cell: (r) => esc(fmtDate(r.gelesen?.datum)) },
      { key: 'betrag', label: 'Betrag', type: 'num', value: (r) => r.gelesen?.brutto || 0, cell: (r) => `${esc(money(r.gelesen?.brutto || 0))} €` },
      { key: 'faellig', label: 'Fällig', type: 'date', cls: 'num', tdCls: 'nowrap small', value: (r) => r.gelesen?.faellig || '', cell: (r) => esc(r.gelesen?.faellig ? fmtDate(r.gelesen.faellig) : '') },
      {
        key: 'stand', label: 'Stand', type: 'text', value: (r) => (r.transactionId && sel.transaction(r.transactionId) ? 'gebucht' : 'neu'),
        cell: (r) => (r.transactionId && sel.transaction(r.transactionId) ? '<span class="badge pos">gebucht</span>' : '<span class="badge info">neu</span>'),
      },
      {
        key: 'actions', label: '', type: 'none', width: '120px', cls: 'right', tdCls: 'nowrap',
        cell: (r) => `${r.transactionId && sel.transaction(r.transactionId) ? '' : `<button class="btn sm" data-buchen="${esc(r.id)}">Buchen</button>`}
          <button class="btn sm ghost" data-weg="${esc(r.id)}" title="Entfernen" aria-label="Entfernen">${icon('trash', 14).__raw}</button>`,
      },
    ],
    emptyTitle: 'Noch keine erhaltenen E-Rechnungen',
    emptyText: 'Fügen Sie eine XRechnung (XML) oder ein ZUGFeRD-PDF hinzu. Kontovia zeigt sie lesbar an und bereitet die Buchung vor.',
    onRowClick: (r) => eingangAnsehen(r),
    onRender: (el) => {
      $$('[data-buchen]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); eingangBuchen(sel.invoice(b.dataset.buchen)); }));
      $$('[data-weg]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); eingangEntfernen(sel.invoice(b.dataset.weg)); }));
    },
  });
}

async function eingangHinzufuegen() {
  const datei = await api.file.pickImport([{ name: 'E-Rechnung', extensions: ['xml', 'pdf'] }]).catch(() => null);
  if (!datei) return;
  const bytes = base64ZuBytes(datei.dataBase64);
  const mime = /\.pdf$/i.test(datei.name) ? 'application/pdf' : 'application/xml';
  const gelesen = await eRechnungAusDatei(bytes, { fileName: datei.name, mime }).catch(() => null);
  if (!gelesen) {
    warn('Keine E-Rechnung gefunden', 'Die Datei enthält keine lesbaren Rechnungsdaten. Eine gewöhnliche Rechnung als PDF hängen Sie direkt an eine Buchung.');
    return;
  }
  const meta = await api.attach.add(datei.name, mime, datei.dataBase64);
  const eintrag = {
    id: uid('re'),
    richtung: 'eingang',
    anhangId: meta.id,
    gelesen: {
      format: gelesen.format, nummer: gelesen.nummer, datum: gelesen.datum, faellig: gelesen.faellig, waehrung: gelesen.waehrung,
      verkaeufer: gelesen.verkaeufer?.name || '', brutto: gelesen.brutto ?? gelesen.zahlbetrag ?? 0, gutschrift: !!gelesen.gutschrift,
    },
    transactionId: '',
    createdAt: new Date().toISOString(),
  };
  await commit('rechnung.eingang', (db) => {
    db.attachments.push(meta);
    db.invoices.push(eintrag);
    return eintrag;
  }, { entity: 'rechnung', entityId: eintrag.id, summary: `E-Rechnung erhalten: ${eintrag.gelesen.verkaeufer} ${eintrag.gelesen.nummer}` });
  ok('E-Rechnung hinzugefügt', `${eintrag.gelesen.verkaeufer}, ${money(eintrag.gelesen.brutto)} €`);
  refresh();
  eingangAnsehen(eintrag, gelesen);
}

async function eingangLesen(r) {
  const bytes = base64ZuBytes(await api.attach.read(r.anhangId));
  const meta = sel.attachment(r.anhangId) || {};
  return eRechnungAusDatei(bytes, meta);
}

async function eingangAnsehen(r, gelesen = null) {
  try {
    const daten = gelesen || await eingangLesen(r);
    if (!daten) { warn('Die Datei lässt sich nicht mehr lesen'); return; }
    const gebucht = r.transactionId && sel.transaction(r.transactionId);
    zeigeERechnung(daten, { onUebernehmen: gebucht ? null : () => eingangBuchen(r, daten) });
  } catch (e) {
    err('Rechnung nicht lesbar', e.message);
  }
}

async function eingangBuchen(r, gelesen = null) {
  let daten = gelesen;
  try { daten ??= await eingangLesen(r); } catch { daten = null; }
  const { newTransactionDraft } = await import('../lib/store.js');
  const tx = newTransactionDraft('expense');
  const g = r.gelesen || {};
  const vz = g.gutschrift ? -1 : 1;
  tx.date = g.datum || todayISO();
  tx.dueDate = g.faellig || '';
  if (g.faellig && g.faellig > todayISO()) tx.paidDate = '';
  tx.invoiceNumber = String(g.nummer || '').slice(0, 60);
  tx.description = [g.verkaeufer, g.nummer ? `Rechnung ${g.nummer}` : ''].filter(Boolean).join(', ').slice(0, 200);
  tx.attachments = [r.anhangId];
  const kontakt = sel.contacts().find((c) => String(c.name).trim().toLowerCase() === String(g.verkaeufer || '').trim().toLowerCase());
  if (kontakt) tx.contactId = kontakt.id;
  const saetze = [...new Set((daten?.steuersaetze || []).map((s) => s.satz))];
  if (daten && saetze.length <= 1) {
    const satz = saetze[0] ?? 0;
    tx.vatRate = store.db.settings.taxMode === 'kleinunternehmer' ? 0 : satz;
    tx.gross = vz * Math.abs(daten.brutto ?? daten.zahlbetrag ?? 0);
    tx.net = vz * Math.abs(daten.netto ?? tx.gross);
    tx.vat = tx.gross - tx.net;
    const cat = sel.activeCategories('expense').find((c) => Number(c.vatRate) === Number(satz));
    if (cat) tx.categoryId = cat.id;
  } else {
    tx.gross = vz * Math.abs(g.brutto || 0);
  }
  openTransactionDialog(tx, 'expense', {
    onSaved: async (gespeichert) => {
      await commit('rechnung.eingang.gebucht', (db) => {
        const x = db.invoices.find((i) => i.id === r.id);
        if (x) { x.transactionId = gespeichert.id; x.updatedAt = new Date().toISOString(); }
      }, { entity: 'rechnung', entityId: r.id, summary: `Erhaltene Rechnung ${g.nummer || ''} gebucht` });
      refresh();
    },
  });
}

async function eingangEntfernen(r) {
  const gebucht = r.transactionId && sel.transaction(r.transactionId);
  const yes = await confirmDialog({
    title: 'Aus dem Eingang entfernen?',
    text: gebucht ? 'Die Rechnung bleibt als Beleg an ihrer Buchung. Nur der Eintrag im Eingang verschwindet.' : 'Die Datei wird aus dem Tresor gelöscht.',
    confirmLabel: 'Entfernen', danger: !gebucht,
  });
  if (!yes) return;
  if (!gebucht) await api.attach.remove(r.anhangId).catch(() => {});
  await commit('rechnung.eingang.entfernen', (db) => {
    db.invoices = db.invoices.filter((x) => x.id !== r.id);
    db.tombstones.push({ collection: 'invoices', id: r.id, deletedAt: new Date().toISOString() });
    if (!gebucht) {
      db.attachments = db.attachments.filter((a) => a.id !== r.anhangId);
      db.tombstones.push({ collection: 'attachments', id: r.anhangId, deletedAt: new Date().toISOString() });
    }
  }, { entity: 'rechnung', entityId: r.id, summary: 'Erhaltene Rechnung entfernt' });
  refresh();
}

/* -------------------------------------------------------------------------- */
/* Produkte                                                                    */
/* -------------------------------------------------------------------------- */

function produkte(root) {
  const liste = sel.products();
  root.innerHTML = `
    <div class="row wrap mb16" style="gap:10px">
      <p class="small muted mt0 mb0" style="flex:1;min-width:240px">Leistungen und Waren, die Sie öfter berechnen. In der Rechnung fügen Sie sie mit einem Klick ein
        und können jede Angabe dort noch ändern.</p>
      <button class="btn primary" id="reProdNeu">${icon('plus', 15).__raw} Neues Produkt</button>
    </div>
    <div class="card" id="reProdListe"></div>`;
  $('#reProdNeu', root).addEventListener('click', () => produktDialog(null));
  const kategorien = [...new Set(liste.map((p) => String(p.kategorie || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  mountTable($('#reProdListe', root), {
    id: 'rechnungen-produkte',
    cls: 'data',
    defaultSort: { key: 'name', dir: 1 },
    rows: liste,
    unit: ['Produkt', 'Produkte'],
    search: { placeholder: 'Name, Nummer oder Kategorie suchen …', text: (p) => [p.name, p.artikelnummer, p.kategorie, p.beschreibung].join(' ') },
    columns: [
      { key: 'name', label: 'Bezeichnung', type: 'text', tdCls: 'strong', cell: (p) => `${esc(p.name)}${p.beschreibung ? `<div class="tiny muted truncate">${esc(p.beschreibung)}</div>` : ''}` },
      { key: 'kategorie', label: 'Kategorie', type: 'text', tdCls: 'small muted', cell: (p) => esc(p.kategorie || '') },
      { key: 'artikelnummer', label: 'Nummer', type: 'text', tdCls: 'small muted', cell: (p) => esc(p.artikelnummer || '') },
      { key: 'preis', label: 'Preis netto', type: 'num', cell: (p) => `${esc(money(p.preis))} €` },
      { key: 'einheit', label: 'je', type: 'text', tdCls: 'small', value: (p) => einheitText(p), cell: (p) => esc(einheitText(p)) },
      { key: 'satz', label: 'USt', type: 'num', tdCls: 'small', cell: (p) => esc(satzText(p.satz ?? 19)) },
      {
        key: 'actions', label: '', type: 'none', width: '84px', cls: 'right', tdCls: 'nowrap',
        cell: (p) => `<button class="btn sm ghost" data-edit="${esc(p.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
          <button class="btn sm ghost" data-del="${esc(p.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>`,
      },
    ],
    filters: kategorien.length ? [{
      key: 'kat', column: 'kategorie', title: 'Kategorie', initial: 'alle', chip: (v, label) => label,
      options: () => [['alle', 'Alle Kategorien', () => true], ...kategorien.map((k) => [k, k, (p) => String(p.kategorie || '').trim() === k]), ['ohne', 'Ohne Kategorie', (p) => !String(p.kategorie || '').trim()]],
    }] : [],
    emptyTitle: 'Noch keine Produkte',
    emptyText: 'Legen Sie Leistungen mit Preis und Einheit an, etwa „Beratung, 95 € je Stunde“ oder „Wartungspauschale, 120 € je Monat“.',
    onRowClick: (p) => produktDialog(p),
    onRender: (el) => {
      $$('[data-edit]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); produktDialog(sel.product(b.dataset.edit)); }));
      $$('[data-del]', el).forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const p = sel.product(b.dataset.del);
        if (!await confirmDialog({ title: 'Produkt löschen?', text: `„${p.name}“ verschwindet aus der Liste. Rechnungen, die es schon enthalten, bleiben unverändert.`, confirmLabel: 'Löschen', danger: true })) return;
        await deleteEntity('products', p.id, 'produkt');
        refresh();
      }));
    },
  });
}

function produktDialog(p) {
  const neu = !p;
  const s = store.db.settings;
  const x = p ? structuredClone(p) : { id: uid('prod'), name: '', beschreibung: '', kategorie: '', artikelnummer: '', einheit: 'C62', einheitText: '', preis: 0, satz: s.taxMode === 'kleinunternehmer' ? 0 : Number(s.defaultVatRate ?? 19), active: true };
  const kategorien = [...new Set(sel.products().map((q) => String(q.kategorie || '').trim()).filter(Boolean))];
  const m = modal({
    title: neu ? 'Neues Produkt' : 'Produkt bearbeiten',
    body: `
      <div class="form-grid">
        <div class="field full"><label for="pp_name">Bezeichnung</label><input id="pp_name" value="${esc(x.name)}" placeholder="z. B. Beratung"></div>
        <div class="field full"><label for="pp_beschr">Beschreibung</label><textarea id="pp_beschr" rows="2">${esc(x.beschreibung || '')}</textarea></div>
        <div class="field"><label for="pp_preis">Preis netto €</label><input id="pp_preis" inputmode="decimal" value="${esc(moneyInput(x.preis))}"></div>
        <div class="field"><label for="pp_einheit">je Einheit</label><input id="pp_einheit" list="ppEinheiten" value="${esc(einheitText(x))}" autocomplete="off">
          <datalist id="ppEinheiten">${EINHEITEN.map((e) => `<option value="${esc(e.kurz)}">${esc(e.name)}</option>`).join('')}</datalist>
          <span class="hint" id="pp_einheitHinweis"></span></div>
        <div class="field"><label for="pp_satz">Umsatzsteuer</label><select id="pp_satz">
          ${[[19, '19 %'], [7, '7 %'], [0, '0 %']].map(([v, t]) => `<option value="${v}" ${Number(x.satz) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="pp_nr">Artikelnummer</label><input id="pp_nr" value="${esc(x.artikelnummer || '')}" placeholder="optional"></div>
        <div class="field full"><label for="pp_kat">Kategorie</label><input id="pp_kat" list="ppKategorien" value="${esc(x.kategorie || '')}" placeholder="z. B. Beratung, Material, Wartung" autocomplete="off">
          <datalist id="ppKategorien">${kategorien.map((k) => `<option value="${esc(k)}"></option>`).join('')}</datalist></div>
      </div>`,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
  });
  const hinweis = () => {
    const e = einheitAusText(m.root.querySelector('#pp_einheit').value);
    m.root.querySelector('#pp_einheitHinweis').textContent = e.bekannt ? '' : 'Diese Einheit steht in der E-Rechnung als Stück.';
  };
  m.root.querySelector('#pp_einheit').addEventListener('input', hinweis);
  hinweis();
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    const g = (id) => m.root.querySelector(id).value.trim();
    if (!g('#pp_name')) { warn('Bitte eine Bezeichnung eintragen'); return; }
    const e = einheitAusText(g('#pp_einheit'));
    await produktSpeichern({
      ...x, name: g('#pp_name'), beschreibung: g('#pp_beschr'), preis: parseMoney(g('#pp_preis')), einheit: e.code, einheitText: e.text,
      satz: Number(g('#pp_satz')), artikelnummer: g('#pp_nr'), kategorie: g('#pp_kat'),
    });
    m.close();
    ok('Produkt gespeichert');
    refresh();
  });
}

/* -------------------------------------------------------------------------- */
/* Vorlagen                                                                    */
/* -------------------------------------------------------------------------- */

function vorlagen(root) {
  const liste = sel.invoiceTemplates();
  root.innerHTML = `
    <div class="row wrap mb16" style="gap:10px">
      <p class="small muted mt0 mb0" style="flex:1;min-width:240px">Eine Vorlage hält Positionen, Texte und Zahlungsbedingungen fest, auf Wunsch auch den Kunden.
        Daraus entsteht mit einem Klick eine neue Rechnung. Speichern lässt sich jede Rechnung als Vorlage.</p>
      <button class="btn primary" id="reVorlageNeu">${icon('plus', 15).__raw} Neue Vorlage</button>
    </div>
    <div class="card" id="reVorlagenListe"></div>`;
  $('#reVorlageNeu', root).addEventListener('click', () => navigate('rechnungen', { vorlage: uid('rv') }));
  mountTable($('#reVorlagenListe', root), {
    id: 'rechnungen-vorlagen',
    cls: 'data',
    defaultSort: { key: 'name', dir: 1 },
    rows: liste,
    unit: ['Vorlage', 'Vorlagen'],
    columns: [
      { key: 'name', label: 'Name', type: 'text', tdCls: 'strong', cell: (v) => esc(v.name) },
      { key: 'kunde', label: 'Kunde', type: 'text', value: (v) => v.daten?.kaeufer?.name || '', cell: (v) => esc(v.daten?.kaeufer?.name || '–') },
      { key: 'pos', label: 'Positionen', type: 'num', value: (v) => (v.daten?.positionen || []).length, cell: (v) => int((v.daten?.positionen || []).length) },
      { key: 'betrag', label: 'Betrag', type: 'num', value: (v) => berechnen({ ...v.daten }).brutto, cell: (v) => `${esc(money(berechnen({ ...v.daten }).brutto))} €` },
      {
        key: 'actions', label: '', type: 'none', width: '200px', cls: 'right', tdCls: 'nowrap',
        cell: (v) => `<button class="btn sm" data-nutzen="${esc(v.id)}">${icon('plus', 13).__raw} Rechnung</button>
          <button class="btn sm ghost" data-edit="${esc(v.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
          <button class="btn sm ghost" data-del="${esc(v.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>`,
      },
    ],
    emptyTitle: 'Noch keine Vorlagen',
    emptyText: 'Legen Sie eine Vorlage an oder speichern Sie eine fertige Rechnung als Vorlage, etwa für monatliche Wartung oder ein Standardpaket.',
    onRowClick: (v) => navigate('rechnungen', { neu: true, vorlageId: v.id }),
    onRender: (el) => {
      $$('[data-nutzen]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); navigate('rechnungen', { neu: true, vorlageId: b.dataset.nutzen }); }));
      $$('[data-edit]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); navigate('rechnungen', { vorlage: b.dataset.edit }); }));
      $$('[data-del]', el).forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const v = sel.invoiceTemplates().find((x) => x.id === b.dataset.del);
        if (!await confirmDialog({ title: 'Vorlage löschen?', text: `„${v.name}“ wird entfernt. Rechnungen daraus bleiben unverändert.`, confirmLabel: 'Löschen', danger: true })) return;
        await deleteEntity('invoiceTemplates', v.id, 'rechnungsvorlage');
        refresh();
      }));
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Gestaltung und Angaben                                                      */
/* -------------------------------------------------------------------------- */

const FARBEN = ['#3446e0', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#1f2937', '#0369a1', '#4d7c0f'];

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

async function gestaltung(root, params = {}) {
  const s = store.db.settings;
  const d = designAus(s);
  const p = profilAus(s);
  const v = verkaeuferAus(s);
  const fehlt = [!v.name && 'Firmenname', !(v.strasse && v.plz && v.ort) && 'Anschrift', !(v.ustId || v.steuernummer) && 'Steuernummer oder USt-IdNr.'].filter(Boolean);
  const bilder = await bilderLaden(d);
  const auswahl = (name, paare, wert) => `<div class="seg sm" role="group" data-seg="${name}">${paare.map(([k, t]) => `<button type="button" data-wert="${esc(k)}" class="${String(wert) === String(k) ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>`;

  root.innerHTML = `
    <div class="re-editor re-gestaltung">
      <div class="re-form">
        <section class="card">
          <div class="card-head"><h3>${icon('layout', 16).__raw} Aussehen</h3><span class="sub">gilt für alle neuen Rechnungen</span></div>
          <div class="card-body">
            <div class="field"><label>Stil</label>${auswahl('layout', [['klassisch', 'Klassisch'], ['modern', 'Modern'], ['schlicht', 'Schlicht']], d.layout)}</div>
            <div class="field"><label>Akzentfarbe</label>
              <div class="row wrap re-farben">
                ${FARBEN.map((f) => `<button type="button" class="re-farbe ${f === d.akzent ? 'active' : ''}" data-farbe="${f}" style="background:${f}" aria-label="Farbe ${f}"></button>`).join('')}
                <label class="re-farbe-eigen" title="Eigene Farbe"><input type="color" id="gs_farbe" value="${esc(d.akzent)}" aria-label="Eigene Farbe"></label>
              </div>
            </div>
            <div class="field"><label>Logo</label>
              <div class="re-bildwahl">
                <div class="re-bildfeld">${bilder.logo ? `<img src="${esc(bilder.logo.url)}" alt="Logo">` : '<span class="small muted">kein Logo</span>'}</div>
                <div class="stack">
                  <div class="row wrap"><button type="button" class="btn sm" id="gs_logo">${icon('plus', 13).__raw} ${bilder.logo ? 'Anderes Logo' : 'Logo hochladen'}</button>
                    ${bilder.logo ? `<button type="button" class="btn sm ghost" id="gs_logoWeg">${icon('trash', 13).__raw} Entfernen</button>` : ''}</div>
                  ${bilder.logo ? `<div class="row wrap">${auswahl('logoPosition', [['links', 'Links'], ['mitte', 'Mitte'], ['rechts', 'Rechts']], d.logoPosition)}
                    <label class="re-regler">Breite <input type="range" min="15" max="80" step="1" id="gs_logoBreite" value="${esc(d.logoBreite)}"> <span id="gs_logoBreiteW">${esc(d.logoBreite)} mm</span></label></div>` : '<span class="hint">PNG, JPG oder SVG. Ohne Logo steht Ihr Firmenname im Kopf.</span>'}
                </div>
              </div>
            </div>
            <div class="field"><label>Zusätzliches Bild</label>
              <div class="re-bildwahl">
                <div class="re-bildfeld">${bilder.bild ? `<img src="${esc(bilder.bild.url)}" alt="Zusatzbild">` : '<span class="small muted">kein Bild</span>'}</div>
                <div class="stack">
                  <div class="row wrap"><button type="button" class="btn sm" id="gs_bild">${icon('plus', 13).__raw} ${bilder.bild ? 'Anderes Bild' : 'Bild hochladen'}</button>
                    ${bilder.bild ? `<button type="button" class="btn sm ghost" id="gs_bildWeg">${icon('trash', 13).__raw} Entfernen</button>` : ''}</div>
                  ${bilder.bild ? `<div class="row wrap">${auswahl('bildPosition', [['schluss', 'Unter dem Text'], ['fuss', 'Über der Fußzeile']], d.bildPosition)}
                    <label class="re-regler">Breite <input type="range" min="15" max="120" step="1" id="gs_bildBreite" value="${esc(d.bildBreite)}"> <span id="gs_bildBreiteW">${esc(d.bildBreite)} mm</span></label></div>` : '<span class="hint">Etwa Ihre Unterschrift, ein Siegel oder Partnerlogos.</span>'}
                </div>
              </div>
            </div>
            <div class="form-grid">
              <div class="field"><label for="gs_groesse">Schriftgröße</label><select id="gs_groesse">
                ${[[8.5, 'Klein'], [9.5, 'Normal'], [10.5, 'Groß']].map(([g, t]) => `<option value="${g}" ${Number(d.schriftgroesse) === g ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            </div>
            <label class="check"><input type="checkbox" id="gs_kopf" ${d.tabellenkopfFarbig ? 'checked' : ''}> Tabellenkopf in der Akzentfarbe</label>
            <label class="check"><input type="checkbox" id="gs_fuss" ${d.fusszeile ? 'checked' : ''}> Fußzeile mit Kontakt, Bank und Steuernummer</label>
            <label class="check"><input type="checkbox" id="gs_falz" ${d.falzmarken ? 'checked' : ''}> Falzmarken für den Fensterumschlag</label>
            <label class="check"><input type="checkbox" id="gs_hinweis" ${d.hinweisERechnung ? 'checked' : ''}> Hinweis auf die enthaltene E-Rechnung</label>
            <p class="small muted mb0 mt8">Die Gestaltung ändert nur die Ansicht. Die Rechnungsdaten im PDF bleiben immer eine gültige, maschinenlesbare E-Rechnung.</p>
          </div>
        </section>

        <section class="card" id="gsAngaben">
          <div class="card-head"><h3>${icon('building', 16).__raw} Ihre Angaben auf Rechnungen</h3></div>
          <div class="card-body">
            ${fehlt.length ? `<div class="notice warn mb16">In den Einstellungen fehlen noch: ${esc(fehlt.join(', '))}. Diese Angaben müssen auf jeder Rechnung stehen.
              <a href="#" class="check-link" id="gs_zuEinst">Zu den Firmendaten</a></div>`
              : `<div class="notice mb16">Name, Anschrift und Steuernummer kommen aus den Einstellungen: <strong>${esc(v.name)}</strong>, ${esc([v.strasse, `${v.plz} ${v.ort}`].join(', '))}.
              <a href="#" class="check-link" id="gs_zuEinst">Firmendaten ändern</a></div>`}
            <div class="form-grid">
              <div class="field full"><label for="gp_iban">IBAN</label><input id="gp_iban" value="${esc(p.iban)}" placeholder="DE00 0000 0000 0000 0000 00" autocomplete="off"><span class="hint" id="gp_ibanHinweis"></span></div>
              <div class="field"><label for="gp_bic">BIC</label><input id="gp_bic" value="${esc(p.bic)}"></div>
              <div class="field"><label for="gp_bank">Bank</label><input id="gp_bank" value="${esc(p.bank)}"></div>
              <div class="field"><label for="gp_inhaber">Kontoinhaber</label><input id="gp_inhaber" value="${esc(p.kontoinhaber)}" placeholder="${esc(v.name || '')}"></div>
              <div class="field"><label for="gp_land">Land Ihres Betriebs</label><select id="gp_land">
                ${Object.entries(LAENDER).map(([c, l]) => `<option value="${c}" ${c === p.land ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
              <div class="field"><label for="gp_register">Handelsregister</label><input id="gp_register" value="${esc(p.register)}" placeholder="z. B. Amtsgericht München HRB 12345"></div>
              <div class="field"><label for="gp_gf">Geschäftsführung</label><input id="gp_gf" value="${esc(p.geschaeftsfuehrung)}" placeholder="bei GmbH und UG Pflicht"></div>
              <div class="field full"><label for="gp_web">Website</label><input id="gp_web" value="${esc(p.web)}"></div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h3>${icon('settings', 16).__raw} Voreinstellungen für neue Rechnungen</h3></div>
          <div class="card-body">
            <div class="form-grid">
              <div class="field"><label for="gp_praefix">Vor der Nummer</label><input id="gp_praefix" value="${esc(p.praefix)}" placeholder="z. B. RE-"><span class="hint" id="gp_nummerBeispiel"></span></div>
              <div class="field"><label for="gp_ziel">Zahlungsziel in Tagen</label><input id="gp_ziel" type="number" min="0" max="365" value="${esc(p.zahlungszielTage)}"></div>
              <div class="field full"><label for="gp_kopf">Text vor den Positionen</label><textarea id="gp_kopf" rows="3">${esc(p.kopftext)}</textarea></div>
              <div class="field full mb0"><label for="gp_schluss">Text am Ende</label><textarea id="gp_schluss" rows="3">${esc(p.schlusstext)}</textarea></div>
            </div>
          </div>
        </section>
        <div class="row end"><button class="btn primary" id="gsSpeichern">${icon('save', 15).__raw} Übernehmen</button></div>
      </div>
      <aside class="re-seitenspalte">
        <div class="small muted mb8">Vorschau${sel.invoices().some((r) => r.richtung !== 'eingang') ? ' mit Ihrer zuletzt bearbeiteten Rechnung' : ' mit einer Beispielrechnung'}</div>
        <div class="re-vorschau" id="reVorschau"></div>
      </aside>
    </div>`;

  // Entwurf der Einstellungen; erst „Übernehmen“ schreibt.
  const entwurf = { design: { ...d }, profil: { ...p } };
  const muster = musterRechnung();
  let gespeichert = JSON.stringify(entwurf);
  router.leaveGuard = async () => {
    if (JSON.stringify(entwurf) === gespeichert) return true;
    return confirmDialog({ title: 'Änderungen verwerfen?', text: 'Die Gestaltung ist noch nicht übernommen.', confirmLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten', danger: true });
  };

  const vorschau = async () => {
    const svgs = await vorschauSvg(muster, { v: { ...verkaeuferAus({ ...s, rechnung: entwurf }) }, d: { ...DESIGN_VORGABE, ...entwurf.design } });
    const host = $('#reVorschau', root);
    if (host) host.innerHTML = svgs.map((svg) => `<div class="re-blatt">${svg}</div>`).join('');
  };
  let zeitgeber = null;
  const neu = () => { clearTimeout(zeitgeber); zeitgeber = setTimeout(vorschau, 200); };

  $$('[data-seg]', root).forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wert]');
    if (!b) return;
    entwurf.design[g.dataset.seg] = b.dataset.wert;
    $$('[data-wert]', g).forEach((x) => x.classList.toggle('active', x === b));
    neu();
  }));
  $$('[data-farbe]', root).forEach((b) => b.addEventListener('click', () => {
    entwurf.design.akzent = b.dataset.farbe;
    $('#gs_farbe', root).value = b.dataset.farbe;
    $$('[data-farbe]', root).forEach((x) => x.classList.toggle('active', x === b));
    neu();
  }));
  $('#gs_farbe', root).addEventListener('input', (e) => {
    entwurf.design.akzent = e.target.value;
    $$('[data-farbe]', root).forEach((x) => x.classList.toggle('active', x.dataset.farbe === e.target.value));
    neu();
  });
  const regler = (id, feld) => {
    const el = $(id, root);
    el?.addEventListener('input', () => { entwurf.design[feld] = Number(el.value); $(`${id}W`, root).textContent = `${el.value} mm`; neu(); });
  };
  regler('#gs_logoBreite', 'logoBreite');
  regler('#gs_bildBreite', 'bildBreite');
  $('#gs_groesse', root).addEventListener('change', (e) => { entwurf.design.schriftgroesse = Number(e.target.value); neu(); });
  for (const [id, feld] of [['#gs_kopf', 'tabellenkopfFarbig'], ['#gs_fuss', 'fusszeile'], ['#gs_falz', 'falzmarken'], ['#gs_hinweis', 'hinweisERechnung']]) {
    $(id, root).addEventListener('change', (e) => { entwurf.design[feld] = e.target.checked; neu(); });
  }
  const profilFelder = { '#gp_iban': 'iban', '#gp_bic': 'bic', '#gp_bank': 'bank', '#gp_inhaber': 'kontoinhaber', '#gp_land': 'land', '#gp_register': 'register', '#gp_gf': 'geschaeftsfuehrung', '#gp_web': 'web', '#gp_praefix': 'praefix', '#gp_ziel': 'zahlungszielTage', '#gp_kopf': 'kopftext', '#gp_schluss': 'schlusstext' };
  const ibanHinweis = () => {
    const iban = entwurf.profil.iban.replace(/\s/g, '');
    $('#gp_ibanHinweis', root).textContent = iban && !ibanGueltig(iban) ? 'Diese IBAN ist ungültig. Bitte auf Zahlendreher prüfen.' : '';
    const nr = `${entwurf.profil.praefix || ''}${new Date().getFullYear()}-0001`;
    $('#gp_nummerBeispiel', root).textContent = `Erste Nummer: ${nr}`;
  };
  for (const [id, feld] of Object.entries(profilFelder)) {
    const el = $(id, root);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      entwurf.profil[feld] = feld === 'zahlungszielTage' ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value;
      ibanHinweis();
      neu();
    });
  }
  ibanHinweis();
  $('#gs_zuEinst', root).addEventListener('click', (e) => { e.preventDefault(); navigate('settings'); });

  const speichern = async ({ still = false } = {}) => {
    await commit('einstellungen.rechnung', (db) => {
      db.settings.rechnung = {
        profil: { ...PROFIL_VORGABE, ...entwurf.profil, iban: entwurf.profil.iban.replace(/\s/g, '').toUpperCase(), bic: entwurf.profil.bic.replace(/\s/g, '').toUpperCase() },
        design: { ...DESIGN_VORGABE, ...entwurf.design },
      };
      db.settings.updatedAt = new Date().toISOString();
    }, { entity: 'einstellungen', summary: 'Rechnungsgestaltung und -angaben geändert' });
    await saveNow();
    gespeichert = JSON.stringify(entwurf);
    if (!still) ok('Übernommen', 'Gilt für alle Rechnungen, die Sie ab jetzt ausstellen.');
  };
  $('#gsSpeichern', root).addEventListener('click', () => speichern());

  const bildSetzen = async (feld) => {
    const datei = await bildWaehlen();
    if (!datei) return;
    try {
      const meta = await bildAblegen(datei);
      entwurf.design[feld] = meta.id;
      await commit('beleg.bild', (db) => { db.attachments.push(meta); }, { silent: true });
      await speichern({ still: true });
      ok(feld === 'logoId' ? 'Logo übernommen' : 'Bild übernommen');
      refresh();
    } catch (e) {
      err('Bild nicht übernommen', e.message);
    }
  };
  $('#gs_logo', root).addEventListener('click', () => bildSetzen('logoId'));
  $('#gs_bild', root).addEventListener('click', () => bildSetzen('bildId'));
  // Das alte Bild bleibt im Tresor: Ausgestellte Rechnungen zeigen es weiterhin.
  $('#gs_logoWeg', root)?.addEventListener('click', async () => { entwurf.design.logoId = ''; await speichern({ still: true }); refresh(); });
  $('#gs_bildWeg', root)?.addEventListener('click', async () => { entwurf.design.bildId = ''; await speichern({ still: true }); refresh(); });

  vorschau();
  if (params.abschnitt === 'angaben') setTimeout(() => $('#gsAngaben', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
