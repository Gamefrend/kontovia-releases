/**
 * Kontovia – Rechnungen: schreiben, verwalten, per E-Mail verschicken (über
 * das E-Mail-Programm des Nutzers, lib/emailversand.js) und empfangen.
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
import { store, sel, commit, deleteEntity } from '../lib/store.js';
import { router, navigate, refresh } from '../lib/router.js';
import { openMenu } from '../lib/popover.js';
import { mountTable } from '../lib/table.js';
import {
  EINHEITEN, berechnen, zustand, ZUSTAENDE, faelligkeit, neueRechnung, neuePosition, einheitText, einheitAusText, betragText, satzText, titel as titelVon,
} from '../lib/rechnung.js';
import {
  stornieren, alsBezahlt, kopieAlsEntwurf, ausVorlage, alsVorlage, versandVermerken, produktSpeichern, rechnungSpeichern,
} from '../lib/rechnungsaktionen.js';
import {
  vorschauSvg, pdfSpeichern, pdfZeigen, xmlSpeichern, base64ZuBytes, versandDateien,
} from '../lib/rechnungsdateien.js';
import { eRechnungAusDatei } from '../lib/erechnung.js';
import {
  WEGE, DIREKT, STANDARD, PLATZHALTER, mailFuer, vorlageAus, adressen, adresseOk, emlBauen, mailtoAdresse, graphNachricht,
} from '../lib/emailversand.js';
import { base64 } from '../lib/pdfausgabe.js';
import { prefs, setPref } from '../lib/prefs.js';
import { zeigeERechnung } from './erechnung.js';
import { editorZeigen } from './rechnungseditor.js';
import { gestaltungZeigen } from './rechnungsgestalter.js';
import { openTransactionDialog } from './transactions.js';
import { aufgabenAbschnitt } from './todos.js';
import { mahnwesenZeigen, mahnungenKarte } from './mahnwesen.js';

const api = window.kontovia;

let tab = 'ausgang';
/* Vorn, was täglich gebraucht wird; dahinter, was man einmal einrichtet. */
const TABS = {
  ausgang: 'Ausgang',
  eingang: 'Eingang',
  mahnwesen: 'Mahnungen',
  vorlagen: 'Vorlagen',
  produkte: 'Produkte',
  gestaltung: 'Gestaltung',
};
const TAB_TITEL = {
  ausgang: 'Rechnungen, die Sie schreiben',
  eingang: 'E-Rechnungen, die Sie erhalten',
  mahnwesen: 'Überfällige Rechnungen und Mahnungen',
  vorlagen: 'Positionen und Texte, aus denen mit einem Klick eine neue Rechnung entsteht',
  produkte: 'Leistungen und Waren, die Sie öfter berechnen',
  gestaltung: 'Aussehen der Rechnung, Bankverbindung und Voreinstellungen',
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
    // `vorgabe`: Betreff und Positionen, die der Assistent vorbereitet hat (Preise in Cent, netto).
    const vorgabe = params.vorgabe ? {
      betreff: String(params.vorgabe.betreff || ''),
      ...(params.vorgabe.positionen?.length ? { positionen: params.vorgabe.positionen.map((p) => neuePosition(store.db.settings, { name: String(p.name || ''), menge: Number(p.menge) || 1, preis: Math.round(Number(p.preis) || 0) })) } : {}),
    } : {};
    const r = params.vorlageId ? ausVorlage(sel.invoiceTemplates().find((v) => v.id === params.vorlageId) || { daten: {} })
      : params.kopieVon ? kopieAlsEntwurf(sel.invoice(params.kopieVon) || {}, params.ueberschreiben || {})
        : neueRechnung(store.db.settings, vorgabe);
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
      ${Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}" title="${esc(TAB_TITEL[k])}">${esc(v)}</button>`).join('')}
    </div>
    <div id="reBody"></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { navigate('rechnungen', { tab: b.dataset.tab }, { ersetzen: true }); }));
  const body = $('#reBody', root);
  ({ ausgang, eingang, produkte, vorlagen, mahnwesen: mahnwesenZeigen, gestaltung }[tab])(body, params);
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
    ${ueber.length ? `<div class="notice warn mb16">${icon('alert', 15).__raw} ${int(ueber.length)} ${ueber.length === 1 ? 'Rechnung ist' : 'Rechnungen sind'} überfällig.
      <button class="btn sm ml8" id="reZuMahnwesen">Zum Mahnwesen</button></div>` : ''}
    <div class="card" id="reListe"></div>`;
  $('#reZuMahnwesen', root)?.addEventListener('click', () => navigate('rechnungen', { tab: 'mahnwesen' }));

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
    emptyText: 'Mit „Neue Rechnung“ schreiben Sie Ihre erste Rechnung. Sie entsteht als PDF, das zugleich als E-Rechnung gilt.',
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
          <div class="card-head"><h2>${icon('export', 16).__raw} Verschicken</h2></div>
          <div class="card-body">
            <div class="re-aktionen">
              <button class="btn primary" id="reSenden">${icon('external', 15).__raw} Per E-Mail senden</button>
              <button class="btn" id="rePdfSpeichern">${icon('pdf', 15).__raw} PDF speichern</button>
              <button class="btn" id="reXml">${icon('file', 15).__raw} XRechnung speichern</button>
              <button class="btn ghost" id="rePdfAnsehen">${icon('eye', 15).__raw} PDF ansehen</button>
            </div>
            <p class="small muted mb0 mt8">Das PDF ist eine E-Rechnung nach ZUGFeRD (EN 16931): Es enthält die Rechnungsdaten maschinenlesbar.
              Behörden verlangen meist die XRechnung als eigene Datei.</p>
            ${(r.versand || []).length ? `<p class="small mb0 mt8">${r.versand.map((v) => `Versendet am ${esc(fmtDate(String(v.ts).slice(0, 10)))}${v.an ? ` an ${esc(v.an)}` : ''}${VERSANDART[v.art] ? ` (${VERSANDART[v.art]})` : ''}`).join('<br>')}</p>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('book', 16).__raw} Zahlung und Buchung</h2></div>
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
          <div class="card-head"><h2>${icon('alert', 16).__raw} Mahnungen</h2></div>
          <div class="card-body" id="reMahnungen"></div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('todo', 16).__raw} Aufgaben</h2></div>
          <div class="card-body" id="reAufgaben"></div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('edit', 16).__raw} Ändern</h2></div>
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
          <div class="card-head"><h2>${icon('archive', 16).__raw} Aufbewahrung</h2></div>
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
  mahnungenKarte($('#reMahnungen', root), r);
  aufgabenAbschnitt($('#reAufgaben', root), 'rechnung', r.id, { titel: 'Zu dieser Rechnung', vorgabe: offen ? `Zahlungseingang prüfen: ${r.nummer}` : '' });
  $('#reSenden', root).addEventListener('click', () => sendenDialog(r, { offen }));
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

/* Verschicken: direkt über Gmail oder Outlook, sonst über das E-Mail-Programm des Nutzers (lib/emailversand.js). */
const VERSANDART = {
  manuell: 'von Hand vermerkt', google: 'über Gmail', microsoft: 'über Outlook', eml: 'per E-Mail-Programm', teilen: 'geteilt', mailto: 'per E-Mail-Programm',
};
const WEG_TEXT = {
  google: {
    name: 'Mit Gmail senden', knopf: 'Senden',
    text: (email) => (email
      ? `Kontovia sendet die E-Mail direkt über Ihr Google-Konto ${email}. Sie steht danach in Gmail unter „Gesendet“.`
      : 'Kontovia sendet die E-Mail direkt über Ihr Google-Konto. Beim ersten Mal fragt Google in einem kleinen Fenster, ob Kontovia E-Mails in Ihrem Namen senden darf. Die E-Mail steht danach in Gmail unter „Gesendet“.'),
  },
  microsoft: {
    name: 'Mit Outlook senden (Outlook.com oder Microsoft 365)', knopf: 'Senden',
    text: (email) => (email
      ? `Kontovia sendet die E-Mail direkt über Ihr Microsoft-Konto ${email}. Sie steht danach in Outlook unter „Gesendete Elemente“.`
      : 'Kontovia sendet die E-Mail direkt über Ihr Microsoft-Konto. Beim ersten Mal fragt Microsoft in einem kleinen Fenster, ob Kontovia E-Mails in Ihrem Namen senden darf. Die E-Mail steht danach in Outlook unter „Gesendete Elemente“.'),
  },
  eml: { name: 'E-Mail-Datei für Outlook, Thunderbird oder Apple Mail', knopf: 'E-Mail erstellen', text: () => 'Kontovia legt die fertige E-Mail mit Anhang in Ihren Download-Ordner. Ein Klick darauf in der Download-Leiste des Browsers öffnet sie in Ihrem E-Mail-Programm, dort senden Sie sie ab.' },
  teilen: { name: 'Teilen', knopf: 'Teilen', text: () => 'Übergibt Anhang und Text an Mail, Outlook, Gmail oder eine andere App auf diesem Gerät. Die Empfängeradresse kopiert Kontovia vorher, Sie fügen sie dort ein.' },
  mailto: { name: 'Nur den Text übergeben', knopf: 'E-Mail-Programm öffnen', text: () => 'Öffnet Ihr E-Mail-Programm mit Empfänger, Betreff und Text. Den Anhang fügen Sie dort selbst hinzu, vorher speichern Sie ihn mit „PDF speichern“.' },
};
/* Microsoft nimmt Anfragen bis 4 MB an; Base64 macht Anhänge um ein Drittel größer. */
const MS_ANHANG_MAX = 2.8 * 1024 * 1024;

const mitTouch = () => globalThis.matchMedia?.('(pointer: coarse)').matches;

async function sendenDialog(r, { offen = true } = {}) {
  const an = r.kaeufer?.email || (r.kaeufer?.kontaktId && sel.contact(r.kaeufer.kontaktId))?.email || '';
  const mail = mailFuer(r, store.db.settings, { offen });
  const behoerde = !!String(r.kaeufer?.leitwegId || '').trim();
  const m = modal({
    title: `${titelVon(r)} ${r.nummer} per E-Mail senden`,
    body: `
      <div class="field"><label for="reAn">An</label><input id="reAn" type="email" multiple value="${esc(an)}" placeholder="E-Mail-Adresse des Kunden" autocomplete="email"></div>
      <div class="field"><label for="reBetreff">Betreff</label><input id="reBetreff" value="${esc(mail.betreff)}"></div>
      <div class="field"><label for="reText">Nachricht</label><textarea id="reText" rows="9">${esc(mail.text)}</textarea>
        <span class="hint"><a href="#" id="reVorlageText">Standardtext ändern</a></span></div>
      <div class="field"><label>Anhang</label>
        <label class="check"><input type="checkbox" id="reMitPdf" checked> PDF mit E-Rechnung (ZUGFeRD)</label>
        <label class="check"><input type="checkbox" id="reMitXml" ${behoerde ? 'checked' : ''}> XRechnung als eigene Datei${behoerde ? '' : ' (meist nur für Behörden nötig)'}</label></div>
      <div class="field mb0"><label>Weg</label><div id="reWege"></div>
        <span class="hint"><span id="reWegText"></span> <a href="#" id="reKontoWechseln" hidden>Anderes Konto</a></span></div>`,
    foot: `<button class="btn left ghost" data-vermerk title="Wenn Sie die Rechnung anders verschickt haben">Als versendet vermerken</button>
      <button class="btn" data-pdf>${icon('pdf', 15).__raw} PDF speichern</button>
      <button class="btn primary" data-senden disabled>${icon('external', 15).__raw} <span>Wird vorbereitet …</span></button>`,
  });
  const $m = (s) => m.root.querySelector(s);

  // Die Anhänge entstehen gleich beim Öffnen: Teilen verlangt, dass es direkt auf den Klick folgt.
  let dateien = null;
  try {
    dateien = await versandDateien(r);
  } catch (e) {
    m.close();
    err('Die Rechnung ließ sich nicht vorbereiten', e.message);
    return;
  }
  if (!m.root.isConnected) return;

  const gewaehlt = () => [$m('#reMitPdf').checked && dateien.pdf, $m('#reMitXml').checked && dateien.xml].filter(Boolean);
  const teilbar = {};
  for (const liste of [[dateien.pdf], [dateien.xml], [dateien.pdf, dateien.xml]]) {
    teilbar[liste.map((d) => d.name).join('|')] = await api.file.canShare(liste.map(({ name, mime }) => ({ name, mime }))).catch(() => false);
  }
  const kannTeilen = (liste) => liste.length > 0 && !!teilbar[liste.map((d) => d.name).join('|')];
  // Gmail und Outlook gibt es nur, wenn Kontovia dafür eingerichtet ist und das Gerät das Anmeldefenster kann.
  let konten = await api.mail.status().catch(() => null);
  if (!m.root.isConnected) return;

  const wege = WEGE.filter((w) => (DIREKT.includes(w) ? !!konten?.[w]?.verfuegbar : w !== 'teilen' || kannTeilen([dateien.pdf])));
  const vorschlag = () => DIREKT.find((w) => wege.includes(w) && konten?.[w]?.email)
    || (mitTouch() && wege.includes('teilen') ? 'teilen' : 'eml');
  let weg = wege.includes(prefs.mailWeg) ? prefs.mailWeg : vorschlag();

  const zeigen = () => {
    $m('#reWege').innerHTML = wege.map((w) => `<label class="check"><input type="radio" name="reWeg" value="${w}" ${w === weg ? 'checked' : ''}> ${esc(WEG_TEXT[w].name)}</label>`).join('');
    const liste = gewaehlt();
    const email = konten?.[weg]?.email || '';
    let hinweis = WEG_TEXT[weg].text(email);
    let gesperrt = weg !== 'mailto' && !liste.length;
    if (weg === 'teilen' && liste.length && !kannTeilen(liste)) {
      hinweis = 'Dieses Gerät kann die XRechnung nicht teilen. Nehmen Sie sie aus dem Anhang oder wählen Sie einen anderen Weg.';
      gesperrt = true;
    }
    if (weg === 'microsoft' && sum(liste, (d) => d.bytes.length) > MS_ANHANG_MAX) {
      hinweis = 'Der Anhang ist für Outlook zu groß. Wählen Sie einen anderen Weg, etwa die E-Mail-Datei.';
      gesperrt = true;
    }
    $m('#reWegText').textContent = hinweis;
    $m('#reKontoWechseln').hidden = !(DIREKT.includes(weg) && email);
    const knopf = $m('[data-senden]');
    knopf.querySelector('span').textContent = WEG_TEXT[weg].knopf;
    knopf.disabled = gesperrt;
  };
  zeigen();
  $m('#reWege').addEventListener('change', (e) => { if (e.target.name === 'reWeg') { weg = e.target.value; setPref('mailWeg', weg); zeigen(); } });
  $m('#reKontoWechseln').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      konten = await api.mail.abmelden(weg);
      zeigen();
      ok('Beim nächsten Senden wählen Sie das Konto neu');
    } catch (ex) { err('Das hat nicht geklappt', ex.message); }
  });
  $m('#reMitPdf').addEventListener('change', zeigen);
  $m('#reMitXml').addEventListener('change', zeigen);

  $m('#reVorlageText').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!await mailVorlageDialog()) return;
    const neu = mailFuer(r, store.db.settings, { offen });
    $m('#reBetreff').value = neu.betreff;
    $m('#reText').value = neu.text;
  });

  $m('[data-pdf]').addEventListener('click', async () => {
    try { const p = await pdfSpeichern(r); if (p) ok('PDF gespeichert', p); } catch (e) { err('PDF nicht gespeichert', e.message); }
  });

  const vermerken = async (art, empfaenger) => {
    try {
      await versandVermerken(r.id, art, empfaenger);
      m.close();
      ok('Versand vermerkt');
      refresh();
    } catch (e) { err('Nicht vermerkt', e.message); }
  };
  $m('[data-vermerk]').addEventListener('click', () => vermerken('manuell', adressen($m('#reAn').value).join(', ')));

  /* Ob die Mail wirklich abging, weiß Kontovia nicht. Deshalb fragt es danach. */
  const nachfragen = (art, empfaenger, hinweis) => {
    m.body.innerHTML = `<div class="notice mb16">${icon('info', 15).__raw} ${esc(hinweis)}</div>
      <p class="mt0 mb0">Haben Sie die E-Mail abgeschickt? Dann vermerkt Kontovia den Versand bei der Rechnung.</p>`;
    m.foot.innerHTML = '<button class="btn" data-no>Noch nicht</button><button class="btn primary" data-yes>Ja, als versendet vermerken</button>';
    $m('[data-no]').addEventListener('click', () => m.close());
    $m('[data-yes]').addEventListener('click', () => vermerken(art, empfaenger));
  };

  $m('[data-senden]').addEventListener('click', async (e) => {
    const knopf = e.currentTarget;
    const ziel = adressen($m('#reAn').value);
    const falsch = ziel.filter((a) => !adresseOk(a));
    if (falsch.length) { warn('Bitte die Adresse prüfen', falsch.join(', ')); $m('#reAn').focus(); return; }
    if (!ziel.length && weg !== 'teilen') { warn('Bitte eine Empfängeradresse eingeben'); $m('#reAn').focus(); return; }
    const betreff = $m('#reBetreff').value.trim();
    const text = $m('#reText').value;
    const liste = gewaehlt();
    const empfaenger = ziel.join(', ');
    knopf.disabled = true;
    try {
      if (DIREKT.includes(weg)) {
        // Ohne Freigabe öffnet api.mail.senden das Fenster beim Anbieter: Das muss im selben Zug wie der Klick geschehen.
        const auftrag = weg === 'google'
          ? api.mail.senden({ anbieter: 'google', mimeBase64: base64(emlBauen({ an: ziel, betreff, text, anhaenge: liste }, { entwurf: false })) })
          : api.mail.senden({ anbieter: 'microsoft', nachricht: graphNachricht({ an: ziel, betreff, text, anhaenge: liste }) });
        knopf.querySelector('span').textContent = konten?.[weg]?.bereit ? 'Wird gesendet …' : 'Bitte im Fenster bestätigen …';
        const erg = await auftrag;
        m.close();
        ok('E-Mail gesendet', erg.von ? `über ${erg.von}` : '');
        // Hier weiß Kontovia, dass die E-Mail abging: gleich vermerken.
        try { await versandVermerken(r.id, weg, (erg.an || ziel).join(', ')); } catch (ex) { warn('Gesendet, aber nicht vermerkt', ex.message); }
        refresh();
        return;
      }
      if (weg === 'teilen') {
        // Das Teilen-Menü kennt keinen Empfänger: die Adresse liegt dann in der Zwischenablage.
        // Nicht abwarten: Das Teilen-Menü muss ohne Umweg auf den Klick folgen.
        if (empfaenger) navigator.clipboard?.writeText(empfaenger).catch(() => {});
        const geteilt = await api.file.share({ files: liste.map((d) => ({ name: d.name, mime: d.mime, dataBase64: base64(d.bytes) })), title: betreff, text });
        if (geteilt) nachfragen('teilen', empfaenger, empfaenger ? `Die Adresse ${empfaenger} ist kopiert. Fügen Sie sie in der E-Mail als Empfänger ein.` : 'Die Dateien sind übergeben.');
      } else if (weg === 'eml') {
        const eml = emlBauen({ an: ziel, betreff, text, anhaenge: liste });
        const name = await api.file.download({ dataBase64: base64(eml), defaultName: `E-Mail_${String(r.nummer).replace(/[^\w.-]+/g, '_')}.eml` });
        if (name) nachfragen('eml', empfaenger, `„${name}“ liegt in Ihrem Download-Ordner. Klicken Sie in der Download-Leiste des Browsers darauf, dann öffnet sich die E-Mail in Ihrem E-Mail-Programm. Prüfen Sie sie dort und senden Sie sie ab.`);
      } else {
        const { url, gekuerzt } = mailtoAdresse({ an: ziel, betreff, text });
        if (gekuerzt) navigator.clipboard?.writeText(text).catch(() => {});
        const a = document.createElement('a');
        a.href = url;
        a.click();
        nachfragen('mailto', empfaenger, gekuerzt
          ? 'Der Text war für diesen Weg zu lang und ist gekürzt. Der ganze Text liegt in der Zwischenablage. Den Anhang fügen Sie selbst hinzu.'
          : 'Ihr E-Mail-Programm sollte sich geöffnet haben. Den Anhang fügen Sie dort selbst hinzu.');
      }
    } catch (ex) {
      if (ex.code === 'ABGEBROCHEN') warn('Nicht gesendet', ex.message);
      else if (ex.code === 'ERNEUT') warn('Bitte noch einmal senden', ex.message);
      else err('Nicht gesendet', ex.message);
      if (DIREKT.includes(weg)) konten = await api.mail.status().catch(() => konten);
    }
    if (knopf.isConnected) { knopf.disabled = false; zeigen(); }
  });
}

/** Den Standardtext für E-Mails zu Rechnungen ändern. @returns {Promise<boolean>} gespeichert */
function mailVorlageDialog() {
  const v = vorlageAus(store.db.settings);
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: 'Standardtext für E-Mails',
      body: `
        <p class="mt0 small muted">Gilt für jede Rechnung, die Sie per E-Mail senden. Die Wörter in geschweiften Klammern ersetzt Kontovia durch die Angaben der Rechnung.</p>
        <div class="field"><label for="mvBetreff">Betreff</label><input id="mvBetreff" value="${esc(v.betreff)}"></div>
        <div class="field"><label for="mvText">Nachricht</label><textarea id="mvText" rows="11">${esc(v.text)}</textarea></div>
        <div class="small">${PLATZHALTER.map(([k, t]) => `<div><code>{${esc(k)}}</code> <span class="muted">${esc(t)}</span></div>`).join('')}</div>`,
      foot: '<button class="btn left ghost" data-zurueck>Ursprünglichen Text nehmen</button><button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    const $m = (s) => m.root.querySelector(s);
    $m('[data-zurueck]').addEventListener('click', () => { $m('#mvBetreff').value = STANDARD.betreff; $m('#mvText').value = STANDARD.text; });
    $m('[data-no]').addEventListener('click', () => m.close());
    $m('[data-yes]').addEventListener('click', async () => {
      const betreff = $m('#mvBetreff').value.trim();
      const text = $m('#mvText').value.replace(/\r\n?/g, '\n').trim();
      try {
        await commit('rechnung.mailtext', (db) => {
          db.settings.mailVorlagen = { ...(db.settings.mailVorlagen || {}), rechnung: betreff === STANDARD.betreff && text === STANDARD.text ? null : { betreff, text } };
        }, { entity: 'einstellungen', summary: 'Standardtext für E-Mails zu Rechnungen geändert' });
        fertig = true;
        m.close();
        ok('Standardtext gespeichert');
        resolve(true);
      } catch (e) { err('Nicht gespeichert', e.message); }
    });
  });
}

/** Für den Assistenten (lib/assistentfenster.js): „X hat bezahlt“ öffnet dieses Fenster mit dem genannten Tag. */
export function bezahltFragen(id, { datum = '' } = {}) {
  const r = sel.invoice(id);
  if (!r) { warn('Diese Rechnung gibt es nicht mehr'); return; }
  bezahltDialog(r, datum);
}

function bezahltDialog(r, datum = '') {
  const m = modal({
    title: `${titelVon(r)} ${r.nummer} als bezahlt markieren`,
    size: 'slim',
    body: `<div class="field"><label for="reBezDatum">Bezahlt am</label><input type="date" id="reBezDatum" value="${esc(datum || todayISO())}"></div>
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
          <p class="small muted mt0 mb8">Seit 2025 muss jedes Unternehmen E-Rechnungen annehmen können. Speichern Sie eine erhaltene
            E-Rechnung aus Ihrem Postfach und fügen Sie sie hier hinzu. Kontovia zeigt sie lesbar an und bereitet die Buchung vor.</p>
          <div class="row wrap">
            <button class="btn primary" id="reHinzu">${icon('plus', 15).__raw} E-Rechnung hinzufügen</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card" id="reEingangListe"></div>`;
  $('#reHinzu', root).addEventListener('click', eingangHinzufuegen);

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
    emptyText: 'Fügen Sie eine E-Rechnung hinzu, als XML-Datei oder als PDF mit eingebetteten Daten.',
    onRowClick: (r) => eingangAnsehen(r),
    onRender: (el) => {
      $$('[data-buchen]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); eingangBuchen(sel.invoice(b.dataset.buchen)); }));
      $$('[data-weg]', el).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); eingangEntfernen(sel.invoice(b.dataset.weg)); }));
    },
  });
}

/** @param {{name:string, dataBase64:string}|null} gewaehlt  schon gewählte Datei (Daten übernehmen), sonst fragt ein Dialog. */
export async function eingangHinzufuegen(gewaehlt = null) {
  const datei = gewaehlt?.dataBase64 ? gewaehlt : await api.file.pickImport([{ name: 'E-Rechnung', extensions: ['xml', 'pdf'] }]).catch(() => null);
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
  // Ab 2028: Versteuert der Lieferant nach Ist, zählt die Vorsteuer erst mit der Zahlung (calc.js: vorsteuerDatum).
  if ((daten?.hinweise || []).some((h) => /vereinnahmten Entgelten/i.test(h))) tx.lieferantIst = true;
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
/* Gestaltung und Angaben (views/rechnungsgestalter.js)                        */
/* -------------------------------------------------------------------------- */

function gestaltung(root, params = {}) {
  return gestaltungZeigen(root, params);
}
