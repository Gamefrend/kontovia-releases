/**
 * Kontovia – Projekte: Zeiten erfassen (Stoppuhr oder von Hand), abrechnen und alles sehen, was zu einem Auftrag gehört.
 *
 * Reiter „Projekte“ (alle Projekte mit Stunden, offenem Wert, Forderungen und Budget) und „Zeiten“ (alle Zeiten
 * über alle Projekte, mit Woche und Monat). Ein Projekt öffnet sich als eigene Seite (params.id) mit Kennzahlen,
 * Stoppuhr, „Abrechnen“ (Rechnungsentwurf aus den offenen Zeiten), „Neu“ (Rechnung, Angebot, Einnahme, Ausgabe,
 * Aufgabe, jeweils mit dem Projekt vorbelegt) und den Reitern Zeiten, Rechnungen und Angebote, Buchungen, Aufgaben
 * (params.reiter). Die Fenster sind exportiert: Suche, Übersicht, Kopfleiste, Rechnungen, Angebote und Kontakte
 * öffnen sie von dort (projektNeu, stoppuhrDialog, zeitEintragen, zuordnenMenue, ausAngebotAnlegen).
 * Logik: lib/projekte.js, Speicher: lib/projektaktionen.js, Stoppuhr in der Kopfleiste: lib/stoppuhranzeige.js.
 * Ab dem Tarif der Funktion „projekte“ (lib/tarife.js).
 */

import { html, raw, esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO, int, addDays } from '../lib/util.js';
import { icon, ok, err, warn, modal, confirmDialog, statCard } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import { navigate, refresh, router } from '../lib/router.js';
import { bereichEin } from '../lib/bewegung.js';
import { mountTable } from '../lib/table.js';
import { openMenu } from '../lib/popover.js';
import { sperrKarteZeigen, erlaubt } from '../lib/lizenzui.js';
import { kann } from '../lib/lizenz.js';
import {
  PROJEKT_STATUS, neuesProjekt, neueZeit, dauerText, dauerLesen, abgerechnet, imEntwurf, projektAuswertung, projektBezuege, minutenImZeitraum,
} from '../lib/projekte.js';
import {
  projektSpeichern, projektLoeschen, zeitSpeichern, zeitLoeschen, laufendeZeit, stoppuhrStarten, abrechnen, projektZuordnen, projektAusAngebot,
} from '../lib/projektaktionen.js';
import { berechnen, zustand, ZUSTAENDE, titel as titelVon } from '../lib/rechnung.js';
import { belegZustand, BELEG_ZUSTAENDE } from '../lib/angebote.js';
import { openTransactionDialog } from './transactions.js';
import { aufgabenAbschnitt, openTodoDialog } from './todos.js';

let filter = 'aktiv';
let listenReiter = 'projekte';
const REITER = { zeiten: 'Zeiten', belege: 'Rechnungen und Angebote', buchungen: 'Buchungen', aufgaben: 'Aufgaben' };
const ALLES = { preset: 'alles', from: '1900-01-01', to: '2999-12-31' };

export async function render(root, params = {}, { actions } = {}) {
  if (sperrKarteZeigen(root, 'projekte')) { actions.innerHTML = ''; return; }
  if (params.id) {
    const p = sel.projekt(params.id);
    if (!p) { root.innerHTML = html`<div class="notice">Dieses Projekt gibt es nicht mehr.</div>`; return; }
    detail(root, p, actions, REITER[params.reiter] ? params.reiter : 'zeiten');
    return;
  }
  if (params.reiter === 'zeiten' || params.reiter === 'projekte') listenReiter = params.reiter;
  liste(root, actions);
}

/* -------------------------------------------------------------------------- */
/* Gemeinsames                                                                 */
/* -------------------------------------------------------------------------- */

const bestand = () => ({ zeiten: sel.zeiten(), invoices: sel.invoices(), transactions: sel.transactions() });
const laufende = () => sel.projekte().filter((p) => p.status !== 'abgeschlossen');
const nachName = (a, b) => String(a.name).localeCompare(String(b.name), 'de');

/** Auswahl eines Projekts; abgeschlossene nur, wenn gewählt. */
function projektOptionen(gewaehlt = '', { leer = '' } = {}) {
  const liste = sel.projekte().filter((p) => p.status !== 'abgeschlossen' || p.id === gewaehlt).sort(nachName);
  return html`${leer ? raw(html`<option value="">${leer}</option>`) : ''}${liste.map((p) => raw(html`<option value="${p.id}" ${raw(p.id === gewaehlt ? 'selected' : '')}>${p.name}${p.kontaktId && sel.contact(p.kontaktId) ? ` · ${sel.contact(p.kontaktId).name}` : ''}</option>`))}`;
}

function zeitStand(z, rechnungen) {
  if (abgerechnet(z, rechnungen)) return 'abgerechnet';
  if (imEntwurf(z, rechnungen)) return 'im Entwurf';
  return z.abrechenbar ? 'offen' : 'nicht abrechenbar';
}

/** Zelle „Stand“ einer Zeit, mit Verweis auf die Rechnung. */
function zeitStandZelle(z, rechnungen) {
  const st = zeitStand(z, rechnungen);
  const r = z.rechnungId ? rechnungen.find((x) => x.id === z.rechnungId) : null;
  const ton = st === 'abgerechnet' ? 'pos' : st === 'im Entwurf' ? 'info' : st === 'offen' ? 'warn' : '';
  return `<span class="badge ${ton}">${esc(st)}</span>${r && st !== 'offen' ? ` <a href="#" data-re="${esc(r.id)}" class="small">${esc(r.nummer || 'Entwurf')}</a>` : ''}`;
}

function zeitLoeschenVerdrahten(el) {
  $$('[data-z-weg]', el).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!await confirmDialog({ title: 'Zeit löschen?', text: 'Der Eintrag wird entfernt.', confirmLabel: 'Löschen', danger: true })) return;
    try { await zeitLoeschen(b.dataset.zWeg); refresh(); } catch (ex) { err('Nicht gelöscht', ex.message); }
  }));
  $$('[data-re]', el).forEach((l) => l.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigate('rechnungen', { id: l.dataset.re }); }));
}

const zeitLoeschKnopf = (z) => `<button class="btn sm ghost" data-z-weg="${esc(z.id)}" title="Löschen" aria-label="Zeit löschen">${icon('trash', 14).__raw}</button>`;

function budgetZelle(p, a) {
  const anteil = a.budgetAnteil ?? a.stundenAnteil;
  if (anteil === null) return '<span class="muted small">ohne</span>';
  const prozent = Math.round(anteil * 100);
  return `<span class="lz-balken${anteil >= 1 ? ' voll' : ''} pj-balken" style="--anteil:${Math.min(100, prozent)}%" role="img" aria-label="${esc(`${prozent} % des Budgets`)}"><span></span></span><div class="tiny muted">${esc(`${prozent} %`)}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Liste: Projekte und Zeiten                                                  */
/* -------------------------------------------------------------------------- */

function liste(root, actions) {
  actions.innerHTML = html`
    ${laufende().length ? raw(html`<button class="btn" id="pjUhrNeu">${icon('play', 15)} Stoppuhr</button>
      <button class="btn" id="pjZeitNeu">${icon('clock', 15)} Zeit eintragen</button>`) : ''}
    <button class="btn primary" id="pjNeu">${icon('plus', 16)} Neues Projekt</button>`;
  $('#pjNeu', actions).addEventListener('click', () => projektNeu());
  $('#pjUhrNeu', actions)?.addEventListener('click', () => stoppuhrDialog());
  $('#pjZeitNeu', actions)?.addEventListener('click', () => zeitEintragen());

  const db = bestand();
  const alle = sel.projekte().map((p) => ({ p, a: projektAuswertung(db, p), kunde: sel.contact(p.kontaktId)?.name || '' }));
  const aktiv = alle.filter((x) => x.p.status !== 'abgeschlossen');
  const offenWert = aktiv.reduce((s, x) => s + x.a.offenWert, 0);
  const offenMin = aktiv.reduce((s, x) => s + x.a.offenMinuten, 0);
  const forderung = alle.reduce((s, x) => s + x.a.offenForderung, 0);
  const heute = todayISO();
  const wocheVon = addDays(heute, -((new Date(`${heute}T12:00:00`).getDay() + 6) % 7));
  const wocheMin = minutenImZeitraum(sel.zeiten(), wocheVon, heute);
  const monatMin = minutenImZeitraum(sel.zeiten(), `${heute.slice(0, 7)}-01`, heute);

  root.innerHTML = html`
    <div class="grid c4 mb16">
      ${statCard({ label: 'Aktive Projekte', value: int(aktiv.length), foot: alle.length - aktiv.length ? `${alle.length - aktiv.length} abgeschlossen` : 'alle laufen', icon: 'folder' })}
      ${statCard({ label: 'Noch nicht abgerechnet', value: `${money(offenWert)} €`, tone: offenWert ? 'warn' : '', foot: `${dauerText(offenMin)} Stunden`, icon: 'clock' })}
      ${statCard({ label: 'Offene Forderungen', value: `${money(forderung)} €`, foot: 'gestellt, noch nicht bezahlt', icon: 'invoice' })}
      ${statCard({ label: 'Erfasst diese Woche', value: dauerText(wocheMin), foot: `${dauerText(monatMin)} Stunden im Monat`, icon: 'history' })}
    </div>
    <div class="seg tabs mb16" role="group" aria-label="Bereich">
      <button data-liste="projekte" class="${listenReiter === 'projekte' ? 'active' : ''}">Projekte</button>
      <button data-liste="zeiten" class="${listenReiter === 'zeiten' ? 'active' : ''}">Zeiten</button>
    </div>
    <div class="card" id="pjListe"></div>`;
  $$('[data-liste]', root).forEach((b) => b.addEventListener('click', () => navigate('projekte', { reiter: b.dataset.liste }, { ersetzen: true })));
  if (listenReiter === 'zeiten') { alleZeiten($('#pjListe', root)); return; }

  mountTable($('#pjListe', root), {
    id: 'projekte',
    cls: 'data',
    defaultSort: { key: 'letzte', dir: -1 },
    rows: alle,
    unit: ['Projekt', 'Projekte'],
    search: { placeholder: 'Projekt oder Kunde suchen …', text: (x) => [x.p.name, x.kunde, x.p.kostenstelle, x.p.notiz].join(' ') },
    columns: [
      { key: 'name', label: 'Projekt', type: 'text', tdCls: 'strong', value: (x) => x.p.name, cell: (x) => `${laufendeZeit()?.projektId === x.p.id ? `<span class="pj-uhr-punkt klein" title="Stoppuhr läuft" aria-label="Stoppuhr läuft"></span> ` : ''}${esc(x.p.name || 'Ohne Namen')}${x.kunde ? `<div class="tiny muted">${esc(x.kunde)}</div>` : ''}` },
      { key: 'stunden', label: 'Stunden', type: 'num', value: (x) => x.a.minuten, cell: (x) => esc(dauerText(x.a.minuten)) },
      { key: 'offen', label: 'Nicht abgerechnet', type: 'num', value: (x) => x.a.offenWert, cell: (x) => (x.a.offenMinuten ? `${esc(money(x.a.offenWert))} €<div class="tiny muted">${esc(dauerText(x.a.offenMinuten))} Std.</div>` : '') },
      { key: 'forderung', label: 'Offene Forderung', type: 'num', value: (x) => x.a.offenForderung, cell: (x) => (x.a.offenForderung ? `${esc(money(x.a.offenForderung))} €` : '') },
      { key: 'ergebnis', label: 'Ergebnis', type: 'num', value: (x) => x.a.ergebnis, cell: (x) => `${esc(money(x.a.ergebnis))} €` },
      { key: 'budget', label: 'Budget', type: 'num', value: (x) => x.a.budgetAnteil ?? x.a.stundenAnteil ?? -1, cell: (x) => budgetZelle(x.p, x.a) },
      { key: 'letzte', label: 'Zuletzt', type: 'date', cls: 'num', tdCls: 'nowrap small', value: (x) => x.a.letzte, cell: (x) => esc(x.a.letzte ? fmtDate(x.a.letzte) : '') },
      { key: 'status', label: 'Stand', type: 'text', value: (x) => PROJEKT_STATUS[x.p.status] || '', cell: (x) => `<span class="badge ${x.p.status === 'aktiv' ? 'pos' : ''}">${esc(PROJEKT_STATUS[x.p.status] || '')}</span>` },
    ],
    filters: [{
      key: 'stand', column: 'status', title: 'Stand', initial: filter, chip: (v, label) => label,
      options: () => [['aktiv', 'Laufend', (x) => x.p.status !== 'abgeschlossen'], ['alle', 'Alle', () => true], ...Object.entries(PROJEKT_STATUS).map(([k, t]) => [k, t, (x) => x.p.status === k])],
    }],
    emptyTitle: 'Noch keine Projekte',
    emptyText: 'Ein Projekt sammelt alles zu einem Auftrag: Zeiten, Angebote, Rechnungen, Buchungen und Aufgaben. Aus den Zeiten wird mit einem Klick die Rechnung.',
    onRowClick: (x) => navigate('projekte', { id: x.p.id }),
  });
}

/** Alle Zeiten über alle Projekte. */
function alleZeiten(host) {
  const rechnungen = sel.invoices();
  const zeiten = sel.zeiten().filter((z) => !z.laeuft);
  const name = (z) => sel.projekt(z.projektId)?.name || 'Projekt gelöscht';
  mountTable(host, {
    id: 'projekte-zeiten',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: zeiten,
    unit: ['Zeit', 'Zeiten'],
    search: { placeholder: 'Tätigkeit oder Projekt suchen …', text: (z) => [z.beschreibung, name(z)].join(' ') },
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (z) => z.datum, cell: (z) => esc(fmtDate(z.datum)) },
      { key: 'projekt', label: 'Projekt', type: 'text', tdCls: 'strong', value: name, cell: (z) => esc(name(z)) },
      { key: 'text', label: 'Tätigkeit', type: 'text', value: (z) => z.beschreibung || '', cell: (z) => esc(z.beschreibung || '') },
      { key: 'dauer', label: 'Dauer', type: 'num', value: (z) => z.minuten, cell: (z) => esc(dauerText(z.minuten)) },
      { key: 'stand', label: 'Stand', type: 'text', value: (z) => zeitStand(z, rechnungen), cell: (z) => zeitStandZelle(z, rechnungen) },
      { key: 'actions', label: '', type: 'none', width: '64px', cls: 'right', tdCls: 'nowrap', cell: zeitLoeschKnopf },
    ],
    filters: [
      {
        key: 'projekt', column: 'projekt', title: 'Projekt', initial: '', hideEmpty: true, search: sel.projekte().length > 8,
        options: () => [['', 'Alle Projekte', () => true], ...[...sel.projekte()].sort(nachName).map((p) => [p.id, p.name, (z) => z.projektId === p.id])],
      },
      {
        key: 'stand', column: 'stand', title: 'Stand', initial: 'alle', chip: (v, label) => label,
        options: () => [['alle', 'Jeder Stand', () => true], ...['offen', 'im Entwurf', 'abgerechnet', 'nicht abrechenbar'].map((s) => [s, s, (z) => zeitStand(z, rechnungen) === s])],
      },
    ],
    emptyTitle: 'Noch keine Zeiten',
    emptyText: 'Starten Sie die Stoppuhr oder tragen Sie eine Zeit von Hand ein.',
    onRowClick: (z) => zeitDialog(z),
    onRender: zeitLoeschenVerdrahten,
  });
}

/* -------------------------------------------------------------------------- */
/* Ein Projekt                                                                 */
/* -------------------------------------------------------------------------- */

function detail(root, p, actions, reiter) {
  actions.innerHTML = html`<button class="btn" id="pjZurueck">${icon('left', 16)} Alle Projekte</button>`;
  $('#pjZurueck', actions).addEventListener('click', () => navigate('projekte'));
  const a = projektAuswertung(store.db, p);
  const b = projektBezuege(store.db, p.id);
  const kunde = sel.contact(p.kontaktId);
  const laeuft = laufendeZeit();
  const angebot = p.angebotId ? sel.angebot(p.angebotId) : null;
  const anzahl = { zeiten: b.zeiten.length, belege: b.rechnungen.length + b.belege.length, buchungen: b.buchungen.length, aufgaben: b.aufgaben.filter((t) => !t.done).length };

  root.innerHTML = html`
    <div class="card mb16"><div class="card-body">
      <div class="row between wrap gap8">
        <div>
          <div class="re-detail-titel">${p.name || 'Ohne Namen'}</div>
          <div class="small muted">${kunde ? raw(html`<a href="#" id="pjKunde">${kunde.name}</a>`) : 'ohne Kunde'}${p.stundensatz ? ` · ${money(p.stundensatz)} € je Stunde` : ''}${p.kostenstelle ? ` · Kostenstelle ${p.kostenstelle}` : ''}</div>
        </div>
        <span class="badge ${p.status === 'aktiv' ? 'pos' : ''}">${PROJEKT_STATUS[p.status] || ''}</span>
      </div>
      <div class="kpi-list mt16">
        <div><div class="k">Stunden</div><div class="v">${dauerText(a.minuten)}</div></div>
        <div><div class="k">Noch nicht abgerechnet</div><div class="v">${money(a.offenWert)} € <span class="small muted">(${dauerText(a.offenMinuten)} Std.)</span></div></div>
        <div><div class="k">Offene Forderungen</div><div class="v">${money(a.offenForderung)} €</div></div>
        <div><div class="k">Einnahmen netto</div><div class="v">${money(a.einnahmen)} €</div></div>
        <div><div class="k">Ausgaben netto</div><div class="v">${money(a.ausgaben)} €</div></div>
        <div><div class="k">Ergebnis</div><div class="v">${money(a.ergebnis)} €</div></div>
        ${a.budgetAnteil !== null ? raw(html`<div><div class="k">Budget</div><div class="v">${Math.round(a.budgetAnteil * 100)} % von ${money(p.budget)} €</div></div>`) : ''}
        ${a.stundenAnteil !== null ? raw(html`<div><div class="k">Stundenbudget</div><div class="v">${Math.round(a.stundenAnteil * 100)} % von ${p.budgetStunden} Std.</div></div>`) : ''}
      </div>
      ${(a.budgetAnteil ?? 0) >= 0.8 || (a.stundenAnteil ?? 0) >= 0.8 ? raw(html`<div class="notice warn mt16">${(a.budgetAnteil ?? 0) >= 1 || (a.stundenAnteil ?? 0) >= 1 ? 'Das Budget ist ausgeschöpft.' : 'Das Budget ist zu mehr als 80 % verbraucht.'}</div>`) : ''}
      ${a.entwuerfe ? raw(html`<div class="notice mt16">${a.entwuerfe === 1 ? 'Ein Rechnungsentwurf wartet auf das Ausstellen.' : `${a.entwuerfe} Rechnungsentwürfe warten auf das Ausstellen.`} <a href="#" data-reiter-sprung="belege">Ansehen</a></div>`) : ''}
      ${angebot ? raw(html`<p class="small muted mb0 mt16">Entstanden aus <a href="#" id="pjAngebot">${titelVon(angebot)} ${angebot.nummer || ''}</a>.</p>`) : ''}
      <div class="re-aktionen mt16">
        ${laeuft?.projektId === p.id ? '' : raw(html`<button class="btn primary" id="pjStart">${icon('play', 15)} Stoppuhr starten</button>`)}
        <button class="btn" id="pjZeitNeu">${icon('clock', 15)} Zeit eintragen</button>
        <button class="btn" id="pjAbrechnen" ${raw(a.offenMinuten ? '' : 'disabled')}>${icon('invoice', 15)} Abrechnen</button>
        <button class="btn" id="pjNeuMenue" aria-haspopup="menu">${icon('plus', 15)} Neu ${icon('down', 13)}</button>
        <button class="btn ghost" id="pjBearbeiten">${icon('edit', 15)} Bearbeiten</button>
      </div>
    </div></div>

    <div class="seg tabs mb16" role="group" aria-label="Bereich des Projekts">
      ${Object.entries(REITER).map(([k, t]) => raw(html`<button data-reiter="${k}" class="${k === reiter ? 'active' : ''}">${t}${anzahl[k] ? raw(html` <span class="muted">${anzahl[k]}</span>`) : ''}</button>`))}
    </div>
    <div id="pjReiter"></div>`;

  const host = $('#pjReiter', root);
  // Reiterwechsel zeichnet nur den Reiter darunter neu; Kopf und Leiste bleiben stehen, die Marke gleitet.
  let aktuell = reiter;
  const reiterZeigen = (neu) => {
    if (neu === aktuell) return;
    aktuell = neu;
    router.params = { ...router.params, id: p.id, reiter: neu };
    $$('[data-reiter]', root).forEach((x) => {
      x.classList.toggle('active', x.dataset.reiter === neu);
      x.setAttribute('aria-pressed', String(x.dataset.reiter === neu));
    });
    reiterInhalt(host, p, b, neu);
    bereichEin(host);
  };
  $$('[data-reiter]', root).forEach((k) => k.addEventListener('click', () => reiterZeigen(k.dataset.reiter)));
  $$('[data-reiter-sprung]', root).forEach((l) => l.addEventListener('click', (e) => { e.preventDefault(); reiterZeigen(l.dataset.reiterSprung); }));
  $('#pjKunde', root)?.addEventListener('click', async (e) => { e.preventDefault(); (await import('./master.js')).openStammdatum('contacts', p.kontaktId); });
  $('#pjAngebot', root)?.addEventListener('click', (e) => { e.preventDefault(); navigate('rechnungen', { beleg: angebot.id }); });
  $('#pjStart', root)?.addEventListener('click', () => stoppuhrDialog(p.id));
  $('#pjZeitNeu', root).addEventListener('click', () => zeitEintragen(p.id));
  $('#pjAbrechnen', root).addEventListener('click', () => abrechnenDialog(p, a));
  $('#pjNeuMenue', root).addEventListener('click', (e) => neuMenue(e.currentTarget, p));
  $('#pjBearbeiten', root).addEventListener('click', () => projektDialog(structuredClone(p)));

  reiterInhalt(host, p, b, reiter);
}

function reiterInhalt(host, p, b, reiter) {
  if (reiter === 'zeiten') zeitenReiter(host, p, b.zeiten);
  else if (reiter === 'belege') belegeReiter(host, p, b);
  else if (reiter === 'buchungen') buchungenReiter(host, p, b.buchungen);
  else aufgabenReiter(host, p);
}

/** „Neu“ im Projekt: alles, was entsteht, gehört gleich zum Projekt. */
function neuMenue(anker, p) {
  openMenu(anker, {
    label: 'Neu im Projekt',
    align: 'end',
    sections: [{
      key: 'neu', value: '',
      options: [
        { value: 'rechnung', label: 'Rechnung', sub: p.kontaktId ? 'mit Kunde des Projekts' : '' },
        { value: 'angebot', label: 'Angebot' },
        { value: 'income', label: 'Einnahme' },
        { value: 'expense', label: 'Ausgabe', sub: 'etwa Material oder Fremdleistung' },
        { value: 'aufgabe', label: 'Aufgabe' },
      ],
    }],
    onPick: (_k, was) => {
      const kunde = p.kontaktId && sel.contact(p.kontaktId) ? { kontaktId: p.kontaktId } : {};
      if (was === 'rechnung') navigate('rechnungen', { neu: true, projektId: p.id, ...kunde });
      else if (was === 'angebot') { if (erlaubt('angebote')) navigate('rechnungen', { neuBeleg: 'angebot', projektId: p.id, ...kunde }); }
      else if (was === 'income' || was === 'expense') {
        openTransactionDialog(null, was, { vorgabe: { projektId: p.id, ...(was === 'income' && kunde.kontaktId ? { contactId: kunde.kontaktId } : {}) }, onSaved: () => refresh() });
      } else if (was === 'aufgabe') openTodoDialog(null, { links: [{ typ: 'projekt', id: p.id }] }, { nachSpeichern: () => refresh() });
    },
  });
}

function zeitenReiter(host, p, zeiten) {
  const rechnungen = sel.invoices();
  host.innerHTML = html`<div class="card" id="pjZeiten"></div>`;
  mountTable($('#pjZeiten', host), {
    id: 'projekt-zeiten',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: zeiten,
    unit: ['Zeit', 'Zeiten'],
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (z) => z.datum, cell: (z) => esc(fmtDate(z.datum)) },
      { key: 'dauer', label: 'Dauer', type: 'num', value: (z) => z.minuten, cell: (z) => esc(dauerText(z.minuten)) },
      { key: 'text', label: 'Tätigkeit', type: 'text', value: (z) => z.beschreibung || '', cell: (z) => esc(z.beschreibung || '') },
      { key: 'stand', label: 'Stand', type: 'text', value: (z) => zeitStand(z, rechnungen), cell: (z) => zeitStandZelle(z, rechnungen) },
      { key: 'actions', label: '', type: 'none', width: '64px', cls: 'right', tdCls: 'nowrap', cell: zeitLoeschKnopf },
    ],
    emptyTitle: 'Noch keine Zeiten',
    emptyText: 'Starten Sie die Stoppuhr oder tragen Sie eine Zeit von Hand ein.',
    onRowClick: (z) => zeitDialog(z, { projektId: p.id }),
    onRender: zeitLoeschenVerdrahten,
  });
}

/** Rechnungen (auch Entwürfe) und Angebote, Auftragsbestätigungen, Lieferscheine des Projekts. */
function belegeReiter(host, p, b) {
  const zeilen = [
    ...b.rechnungen.map((r) => {
      const buchungen = (r.transactionIds || []).map(sel.transaction).filter(Boolean);
      const z = zustand(r, { buchungen });
      return { art: 'rechnung', x: r, titel: titelVon(r), stand: ZUSTAENDE[z] || {}, betrag: berechnen(r).brutto };
    }),
    ...b.belege.map((x) => {
      const z = belegZustand(x, { rechnungen: sel.invoices() });
      return { art: 'beleg', x, titel: titelVon(x), stand: BELEG_ZUSTAENDE[z] || {}, betrag: x.belegart === 'lieferschein' ? null : berechnen(x).brutto };
    }),
  ];
  host.innerHTML = html`<div class="card">
    <div class="card-head"><h2>${icon('invoice', 16)} Rechnungen und Angebote</h2><div class="spacer"></div>
      <button class="btn sm" id="pjZuordnen">${icon('link', 14)} Vorhandene zuordnen</button></div>
    <div id="pjBelege"></div></div>`;
  $('#pjZuordnen', host).addEventListener('click', (e) => belegWahl(e.currentTarget, p));
  mountTable($('#pjBelege', host), {
    id: 'projekt-belege',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: zeilen,
    unit: ['Beleg', 'Belege'],
    columns: [
      { key: 'nummer', label: 'Beleg', type: 'text', tdCls: 'strong nowrap', value: (z) => z.x.nummer || '', cell: (z) => `${esc(z.titel)} ${z.x.nummer ? esc(z.x.nummer) : '<span class="muted">Entwurf</span>'}${z.x.betreff ? `<div class="tiny muted truncate">${esc(z.x.betreff)}</div>` : ''}` },
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (z) => z.x.datum || '', cell: (z) => esc(fmtDate(z.x.datum)) },
      { key: 'betrag', label: 'Betrag', type: 'num', value: (z) => z.betrag ?? 0, cell: (z) => (z.betrag === null ? '' : `${esc(money(z.betrag))} €`) },
      { key: 'stand', label: 'Stand', type: 'text', value: (z) => z.stand.name || '', cell: (z) => `<span class="badge ${z.stand.ton || ''}">${esc(z.stand.name || '')}</span>` },
      { key: 'actions', label: '', type: 'none', width: '64px', cls: 'right', tdCls: 'nowrap', cell: (z) => `<button class="btn sm ghost" data-loesen="${esc(z.art)}:${esc(z.x.id)}" title="Vom Projekt lösen" aria-label="Vom Projekt lösen">${icon('x', 14).__raw}</button>` },
    ],
    emptyTitle: 'Noch keine Rechnungen oder Angebote',
    emptyText: 'Über „Neu“ schreiben Sie eine Rechnung oder ein Angebot für dieses Projekt. „Abrechnen“ macht aus den offenen Zeiten eine Rechnung.',
    onRowClick: (z) => navigate('rechnungen', z.art === 'rechnung' ? { id: z.x.id } : { beleg: z.x.id }),
    onRender: (el) => $$('[data-loesen]', el).forEach((k) => k.addEventListener('click', async (e) => {
      e.stopPropagation();
      const [art, id] = k.dataset.loesen.split(':');
      try { await projektZuordnen(art, id, ''); ok('Vom Projekt gelöst'); refresh(); } catch (ex) { err('Nicht gelöst', ex.message); }
    })),
  });
}

/** Rechnung oder Angebot ohne Projekt auswählen und zuordnen; bevorzugt die des Kunden. */
function belegWahl(anker, p) {
  const vomKunden = (x) => !!p.kontaktId && x.kaeufer?.kontaktId === p.kontaktId;
  const frei = (liste, art) => liste.filter((x) => !x.projektId && x.richtung !== 'eingang')
    .sort((a, b) => Number(vomKunden(b)) - Number(vomKunden(a)) || String(b.datum || '').localeCompare(String(a.datum || '')))
    .map((x) => ({ value: `${art}:${x.id}`, label: `${titelVon(x)} ${x.nummer || 'Entwurf'}`, sub: [x.kaeufer?.name, x.datum ? fmtDate(x.datum) : ''].filter(Boolean).join(' · ') }));
  const optionen = [...frei(sel.invoices(), 'rechnung'), ...frei(sel.angebote(), 'beleg')];
  if (!optionen.length) {
    const gibt = sel.invoices().some((x) => x.richtung !== 'eingang') || sel.angebote().length;
    warn('Nichts zum Zuordnen', gibt ? 'Alle Rechnungen und Angebote gehören schon zu einem Projekt.' : 'Es gibt noch keine Rechnungen oder Angebote.');
    return;
  }
  openMenu(anker, {
    label: 'Zuordnen',
    align: 'end',
    sections: [{ key: 'b', value: '', search: optionen.length > 6, options: optionen }],
    onPick: async (_k, wert) => {
      const [art, id] = wert.split(':');
      try {
        const n = await projektZuordnen(art, id, p.id);
        ok('Zugeordnet', n > 1 ? `${n} Einträge gehören jetzt zum Projekt` : p.name);
        refresh();
      } catch (ex) { err('Nicht zugeordnet', ex.message); }
    },
  });
}

function buchungenReiter(host, p, buchungen) {
  host.innerHTML = html`<div class="card">
    <div class="card-head"><h2>${icon('book', 16)} Buchungen</h2><div class="spacer"></div>
      <button class="btn sm" id="pjInListe">${icon('right', 14)} In der Buchungsliste zeigen</button></div>
    <div id="pjBuchungen"></div></div>`;
  $('#pjInListe', host).addEventListener('click', () => navigate('transactions', { neu: true, projektId: p.id, period: ALLES, datum: 'alle' }));
  mountTable($('#pjBuchungen', host), {
    id: 'projekt-buchungen',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: buchungen,
    unit: ['Buchung', 'Buchungen'],
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (t) => t.date, cell: (t) => esc(fmtDate(t.date)) },
      { key: 'text', label: 'Beschreibung', type: 'text', value: (t) => t.description || '', cell: (t) => `${esc(t.description || (t.type === 'income' ? 'Einnahme' : 'Ausgabe'))}${t.voided || t.isReversal ? ' <span class="badge plain tiny">storniert</span>' : ''}<div class="tiny muted truncate">${esc(sel.categoryName(t.categoryId))}</div>` },
      { key: 'netto', label: 'Netto', type: 'num', value: (t) => (t.type === 'income' ? 1 : -1) * (t.net || 0), cell: (t) => `<span class="amount ${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '' : '−'}${esc(money(Math.abs(t.net || 0)))} €</span>` },
      { key: 'stand', label: 'Zahlung', type: 'text', value: (t) => (t.paidDate ? 'bezahlt' : 'offen'), cell: (t) => (t.voided || t.isReversal ? '' : t.paidDate ? `<span class="badge pos">bezahlt</span>` : '<span class="badge warn">offen</span>') },
    ],
    emptyTitle: 'Noch keine Buchungen',
    emptyText: 'Rechnungen des Projekts buchen von selbst hierher. Ausgaben ordnen Sie über „Neu“ oder im Buchungsfenster unter „Weitere Angaben“ zu.',
    onRowClick: (t) => openTransactionDialog(t.id, t.type, { onSaved: () => refresh() }),
  });
}

function aufgabenReiter(host, p) {
  host.innerHTML = html`<div class="card"><div class="card-body" id="pjAufgaben"></div></div>`;
  aufgabenAbschnitt($('#pjAufgaben', host), 'projekt', p.id, { titel: 'Aufgaben zu diesem Projekt' });
}

/* -------------------------------------------------------------------------- */
/* Fenster (auch von anderen Bereichen geöffnet)                               */
/* -------------------------------------------------------------------------- */

function kontaktOptionen(gewaehlt) {
  const kunden = [...sel.contacts()].filter((c) => c.kind !== 'supplier' || c.id === gewaehlt).sort(nachName);
  return html`<option value="">Ohne Kunde</option>${kunden.map((c) => raw(html`<option value="${c.id}" ${raw(c.id === gewaehlt ? 'selected' : '')}>${c.name}</option>`))}`;
}

/** Neues Projekt, auf Wunsch mit Vorgaben (etwa dem Kunden aus dem Kontaktfenster). */
export function projektNeu(vorgabe = {}) {
  if (!erlaubt('projekte')) return;
  projektDialog(neuesProjekt(vorgabe), { neu: true });
}

function projektDialog(p, { neu = false } = {}) {
  const m = modal({
    title: neu ? 'Neues Projekt' : 'Projekt bearbeiten',
    body: html`
      <div class="field"><label for="pjName">Name</label><input id="pjName" value="${p.name}" placeholder="z. B. Website-Relaunch Café Sonnenschein" maxlength="120"></div>
      <div class="form-grid">
        <div class="field"><label for="pjKundeWahl">Kunde</label><select id="pjKundeWahl">${raw(kontaktOptionen(p.kontaktId))}</select></div>
        <div class="field"><label for="pjSatz">Stundensatz netto €</label><input id="pjSatz" inputmode="decimal" value="${p.stundensatz ? moneyInput(p.stundensatz) : ''}" placeholder="z. B. 85,00"></div>
        <div class="field"><label for="pjBudget">Budget netto € (freiwillig)</label><input id="pjBudget" inputmode="decimal" value="${p.budget ? moneyInput(p.budget) : ''}"></div>
        <div class="field"><label for="pjStunden">Stundenbudget (freiwillig)</label><input id="pjStunden" type="number" min="0" max="100000" value="${p.budgetStunden || ''}"></div>
        <div class="field"><label for="pjKst">Kostenstelle (freiwillig)</label><input id="pjKst" maxlength="20" value="${p.kostenstelle || ''}" placeholder="z. B. 1001">
          <span class="hint">Kurzes Kürzel, wie es Ihre Kanzlei verwendet.</span></div>
        <div class="field"><label for="pjStatus">Stand</label><select id="pjStatus">${Object.entries(PROJEKT_STATUS).map(([k, t]) => raw(html`<option value="${k}" ${raw(k === p.status ? 'selected' : '')}>${t}</option>`))}</select></div>
      </div>
      <div class="field"><label for="pjNotiz">Notiz</label><textarea id="pjNotiz" rows="2" maxlength="2000">${p.notiz || ''}</textarea></div>`,
    foot: html`${neu ? '' : raw('<button class="btn left ghost danger-text" data-weg>Löschen</button>')}<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-weg]')?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Projekt löschen?', text: 'Das geht nur, solange nichts dazugehört. Sonst schließen Sie es ab.', confirmLabel: 'Löschen', danger: true })) return;
    try { await projektLoeschen(p.id); m.close(); ok('Projekt gelöscht'); navigate('projekte'); } catch (e) { err('Nicht gelöscht', e.message); }
  });
  $m('[data-yes]').addEventListener('click', async () => {
    const name = $m('#pjName').value.trim();
    if (!name) { warn('Bitte einen Namen eintragen'); $m('#pjName').focus(); return; }
    Object.assign(p, {
      name, kontaktId: $m('#pjKundeWahl').value, stundensatz: Math.max(0, parseMoney($m('#pjSatz').value) || 0), budget: Math.max(0, parseMoney($m('#pjBudget').value) || 0),
      budgetStunden: Math.max(0, Math.round(Number($m('#pjStunden').value) || 0)), kostenstelle: $m('#pjKst').value.trim(), status: $m('#pjStatus').value, notiz: $m('#pjNotiz').value.trim(),
    });
    try {
      await projektSpeichern(p);
      m.close();
      ok(neu ? 'Projekt angelegt' : 'Projekt gespeichert', name);
      if (neu) navigate('projekte', { id: p.id }); else refresh();
    } catch (e) { err('Nicht gespeichert', e.message); }
  });
  $m('#pjName').focus();
}

/** Ohne Projekt ein Auswahlfeld, sonst nichts. */
function projektFeld(projektId) {
  if (projektId) return '';
  return raw(html`<div class="field"><label for="ztProjekt">Projekt</label><select id="ztProjekt">${raw(projektOptionen(''))}</select></div>`);
}

/** Stoppuhr starten; ohne projektId mit Auswahl des Projekts (Suche, Kopfleiste, Übersicht). */
export function stoppuhrDialog(projektId = '') {
  if (!erlaubt('projekte')) return;
  if (!projektId && !laufende().length) { projektNeu(); return; }
  const p = projektId ? sel.projekt(projektId) : null;
  const m = modal({
    title: p ? `Stoppuhr für ${p.name}` : 'Stoppuhr starten',
    size: 'slim',
    body: html`${projektFeld(projektId)}<div class="field mb0"><label for="pjTat">Tätigkeit (freiwillig)</label><input id="pjTat" maxlength="200" placeholder="z. B. Entwurf Startseite"></div>
      ${laufendeZeit() ? raw(html`<p class="small muted mb0 mt8">Die laufende Stoppuhr wird dabei angehalten und ihre Zeit gespeichert.</p>`) : ''}`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('play', 15)} Starten</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async () => {
    const id = projektId || $m('#ztProjekt').value;
    try { await stoppuhrStarten(id, $m('#pjTat').value.trim()); m.close(); ok('Stoppuhr läuft', sel.projekt(id)?.name || ''); refresh(); } catch (e) { err('Nicht gestartet', e.message); }
  });
  $m('#pjTat').focus();
}

/** Zeit von Hand eintragen; ohne projektId mit Auswahl des Projekts. */
export function zeitEintragen(projektId = '') {
  if (!erlaubt('projekte')) return;
  if (!projektId && !laufende().length) { projektNeu(); return; }
  zeitDialog(neueZeit(projektId, { minuten: 60 }), { neu: true, projektId });
}

function zeitDialog(z, { neu = false, projektId = z.projektId } = {}) {
  const fest = !neu && abgerechnet(z, sel.invoices());
  const m = modal({
    title: neu ? 'Zeit eintragen' : 'Zeit bearbeiten',
    body: html`
      ${fest ? raw(html`<div class="notice mb16 small">Diese Zeit ist abgerechnet. Ändern lässt sich nur noch die Beschreibung.</div>`) : ''}
      ${projektFeld(projektId)}
      <div class="form-grid">
        <div class="field"><label for="ztDatum">Datum</label><input id="ztDatum" type="date" value="${z.datum}" ${raw(fest ? 'disabled' : '')}></div>
        <div class="field"><label for="ztDauer">Dauer</label><input id="ztDauer" value="${dauerText(z.minuten)}" placeholder="1:30 oder 1,5" ${raw(fest ? 'disabled' : '')}>
          <span class="hint">Stunden:Minuten, Stunden mit Komma oder Minuten („45m“)</span></div>
      </div>
      <div class="field"><label for="ztText">Tätigkeit</label><input id="ztText" value="${z.beschreibung || ''}" maxlength="200" placeholder="z. B. Abstimmung mit dem Kunden"></div>
      <label class="check"><input type="checkbox" id="ztAbr" ${raw(z.abrechenbar ? 'checked' : '')} ${raw(fest ? 'disabled' : '')}> Abrechenbar</label>
      <div class="err small" id="ztFehler" role="alert"></div>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async () => {
    const min = fest ? z.minuten : dauerLesen($m('#ztDauer').value);
    if (!fest && !(min > 0 && min <= 24 * 60)) { $m('#ztFehler').textContent = 'Bitte eine Dauer zwischen einer Minute und 24 Stunden eintragen, etwa 1:30.'; $m('#ztDauer').focus(); return; }
    const neuZ = { ...structuredClone(z), minuten: min, beschreibung: $m('#ztText').value.trim() };
    if (!projektId) neuZ.projektId = $m('#ztProjekt').value;
    if (!fest) Object.assign(neuZ, { datum: $m('#ztDatum').value || todayISO(), abrechenbar: $m('#ztAbr').checked });
    try {
      await zeitSpeichern(neuZ);
      m.close();
      if (neu) ok('Zeit erfasst', `${dauerText(min)} Stunden · ${sel.projekt(neuZ.projektId)?.name || ''}`);
      refresh();
    } catch (e) { $m('#ztFehler').textContent = e.message; }
  });
  $m(fest ? '#ztText' : '#ztDauer').focus();
}

function abrechnenDialog(p, a) {
  let art = 'tag';
  const ARTEN = [['tag', 'Je Tag eine Position'], ['einzeln', 'Jede Zeit einzeln'], ['gesamt', 'Eine Position für alles']];
  const m = modal({
    title: 'Zeiten abrechnen',
    body: html`
      <div class="kpi-list mb16">
        <div><div class="k">Offene Stunden</div><div class="v">${dauerText(a.offenMinuten)}</div></div>
        <div><div class="k">Stundensatz</div><div class="v">${money(p.stundensatz)} €</div></div>
        <div><div class="k">Netto</div><div class="v">${money(a.offenWert)} €</div></div>
      </div>
      <div class="field"><label id="abArtName">Positionen auf der Rechnung</label>
        <div class="seg" role="group" aria-labelledby="abArtName" id="abArt">${ARTEN.map(([k, t]) => raw(html`<button type="button" data-art="${k}" class="${k === art ? 'active' : ''}" aria-pressed="${k === art}">${t}</button>`))}</div></div>
      ${p.stundensatz ? '' : raw(html`<div class="notice warn small">Das Projekt hat keinen Stundensatz. Die Positionen entstehen ohne Preis; tragen Sie ihn in der Rechnung ein.</div>`)}
      ${p.kontaktId ? '' : raw(html`<div class="notice small">Das Projekt hat keinen Kunden. Tragen Sie ihn in der Rechnung ein.</div>`)}
      <p class="small muted mb0">Es entsteht ein Rechnungsentwurf. Die Zeiten gelten als abgerechnet, sobald Sie die Rechnung ausstellen.</p>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('invoice', 15)} Rechnungsentwurf anlegen</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  $$('[data-art]', m.root).forEach((b) => b.addEventListener('click', () => {
    art = b.dataset.art;
    $$('[data-art]', m.root).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  }));
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await abrechnen(p.id, { art });
      m.close();
      ok('Rechnungsentwurf angelegt', 'Bitte prüfen und ausstellen.');
      navigate('rechnungen', { id: r.id });
    } catch (ex) { e.currentTarget.disabled = false; err('Nicht abgerechnet', ex.message); }
  });
}

/**
 * Menü „Projekt“ an Rechnung, Angebot oder Buchung: einem Projekt zuordnen, ein neues daraus anlegen (nur Angebot)
 * oder die Zuordnung lösen. `art`: rechnung | beleg | buchung.
 */
export function zuordnenMenue(anker, art, id, aktuell = '', { nachher = refresh } = {}) {
  if (!erlaubt('projekte')) return;
  const optionen = [
    ...(art === 'beleg' && !aktuell ? [{ value: 'neu', label: 'Neues Projekt daraus', sub: 'Kunde, Name und Budget aus dem Angebot' }] : []),
    ...(aktuell ? [{ value: 'loesen', label: 'Vom Projekt lösen' }] : []),
  ];
  const projekte = laufende().filter((p) => p.id !== aktuell).sort(nachName).map((p) => ({ value: p.id, label: p.name, sub: sel.contact(p.kontaktId)?.name || '' }));
  openMenu(anker, {
    label: 'Projekt',
    align: 'end',
    sections: [
      optionen.length ? { key: 'a', value: '', options: optionen } : null,
      projekte.length ? { key: 'p', title: 'Zuordnen zu', value: '', search: projekte.length > 6, options: projekte } : null,
    ],
    onPick: async (k, wert) => {
      try {
        if (k === 'a' && wert === 'neu') { const p = await projektAusAngebot(id); ok('Projekt angelegt', p.name); navigate('projekte', { id: p.id }); return; }
        const n = await projektZuordnen(art, id, k === 'a' ? '' : wert);
        ok(k === 'a' ? 'Vom Projekt gelöst' : 'Zugeordnet', n > 1 ? `${n} Einträge` : '');
        nachher();
      } catch (ex) { err('Nicht zugeordnet', ex.message); }
    },
  });
}

/** Kleine Zeile „Projekt: Name“ mit Menü, für die Seiten von Rechnung und Angebot. */
export function projektZeile(art, eintrag) {
  const p = eintrag.projektId ? sel.projekt(eintrag.projektId) : null;
  if (!p && (!kann('projekte') || (!sel.projekte().length && art !== 'beleg'))) return '';
  return html`<div class="small mt8 pj-zeile">${icon('folder', 13)} ${p
    ? raw(html`Projekt <a href="#" data-pj-gehe="${p.id}">${p.name}</a>`)
    : 'Keinem Projekt zugeordnet'} <button type="button" class="btn sm ghost" data-pj-menue data-krone="projekte">${p ? 'Ändern' : 'Zuordnen'}</button></div>`;
}

/** Verdrahtet projektZeile() nach dem Zeichnen. */
export function projektZeileVerdrahten(root, art, eintrag) {
  root.querySelector('[data-pj-gehe]')?.addEventListener('click', (e) => { e.preventDefault(); navigate('projekte', { id: e.currentTarget.dataset.pjGehe }); });
  root.querySelector('[data-pj-menue]')?.addEventListener('click', (e) => zuordnenMenue(e.currentTarget, art, eintrag.id, eintrag.projektId || ''));
}
