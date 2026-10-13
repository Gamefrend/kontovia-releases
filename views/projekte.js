/**
 * Kontovia – Projekte: Zeiten erfassen (Stoppuhr oder von Hand), abrechnen, Einnahmen und Ausgaben je Projekt.
 *
 * Liste aller Projekte mit Stunden, offenem Wert und Budget; ein Projekt öffnet sich als eigene Seite
 * (params.id) mit Stoppuhr, Zeiten, „Abrechnen“ (Rechnungsentwurf aus den offenen Zeiten) und den Buchungen,
 * die dem Projekt zugeordnet sind (Projekt = Kostenstelle). Logik: lib/projekte.js, Speicher:
 * lib/projektaktionen.js. Ab dem Tarif der Funktion „projekte“ (lib/tarife.js).
 */

import { html, raw, esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO, int } from '../lib/util.js';
import { icon, ok, err, warn, modal, confirmDialog, statCard } from '../lib/ui.js';
import { sel } from '../lib/store.js';
import { navigate, refresh } from '../lib/router.js';
import { mountTable } from '../lib/table.js';
import { sperrKarteZeigen } from '../lib/lizenzui.js';
import {
  PROJEKT_STATUS, neuesProjekt, neueZeit, dauerText, dauerLesen, abgerechnet, imEntwurf, projektAuswertung, minutenZwischen,
} from '../lib/projekte.js';
import {
  projektSpeichern, projektLoeschen, zeitSpeichern, zeitLoeschen, laufendeZeit, stoppuhrStarten, stoppuhrAnhalten, abrechnen,
} from '../lib/projektaktionen.js';
import { openTransactionDialog } from './transactions.js';

let filter = 'aktiv';

export async function render(root, params = {}, { actions } = {}) {
  if (sperrKarteZeigen(root, 'projekte')) { actions.innerHTML = ''; return; }
  if (params.id) {
    const p = sel.projekt(params.id);
    if (!p) { root.innerHTML = html`<div class="notice">Dieses Projekt gibt es nicht mehr.</div>`; return; }
    detail(root, p, actions);
    return;
  }
  liste(root, actions);
}

/* -------------------------------------------------------------------------- */
/* Stoppuhr (oben in Liste und Projekt)                                        */
/* -------------------------------------------------------------------------- */

/** Zeigt die laufende Stoppuhr mit Anhalten; zählt jede Sekunde weiter, solange die Seite steht. */
function stoppuhrLeiste(host) {
  const z = laufendeZeit();
  if (!z) { host.innerHTML = ''; return; }
  const p = sel.projekt(z.projektId);
  host.innerHTML = html`<div class="notice pj-uhr mb16" role="status">
    <span class="pj-uhr-punkt" aria-hidden="true"></span>
    <strong id="pjUhrZeit">${dauerText(minutenZwischen(z.start))}</strong>
    <span>${p?.name || 'Projekt'}${z.beschreibung ? ` · ${z.beschreibung}` : ''}</span>
    <span class="spacer"></span>
    <button type="button" class="btn sm primary" id="pjUhrStopp">${icon('stop', 14)} Anhalten</button>
  </div>`;
  const zeit = $('#pjUhrZeit', host);
  const takt = setInterval(() => {
    if (!zeit.isConnected) { clearInterval(takt); return; }
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(z.start)) / 1000));
    zeit.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  $('#pjUhrStopp', host).addEventListener('click', async () => {
    try {
      const fertig = await stoppuhrAnhalten(z.id);
      ok('Zeit erfasst', fertig ? `${dauerText(fertig.minuten)} Stunden` : '');
      refresh();
    } catch (e) { err('Nicht angehalten', e.message); }
  });
}

/* -------------------------------------------------------------------------- */
/* Liste                                                                       */
/* -------------------------------------------------------------------------- */

function liste(root, actions) {
  actions.innerHTML = html`<button class="btn primary" id="pjNeu">${icon('plus', 16)} Neues Projekt</button>`;
  $('#pjNeu', actions).addEventListener('click', () => projektDialog(neuesProjekt(), { neu: true }));
  const db = { zeiten: sel.zeiten(), invoices: sel.invoices(), transactions: sel.transactions() };
  const alle = sel.projekte().map((p) => ({ p, a: projektAuswertung(db, p), kunde: sel.contact(p.kontaktId)?.name || '' }));
  const aktiv = alle.filter((x) => x.p.status !== 'abgeschlossen');
  const offenWert = aktiv.reduce((s, x) => s + x.a.offenWert, 0);
  const offenMin = aktiv.reduce((s, x) => s + x.a.offenMinuten, 0);
  const monat = todayISO().slice(0, 7);
  const monatMin = sel.zeiten().filter((z) => !z.laeuft && String(z.datum).startsWith(monat)).reduce((s, z) => s + z.minuten, 0);

  root.innerHTML = html`
    <div id="pjUhr"></div>
    <div class="grid c4 mb16">
      ${statCard({ label: 'Aktive Projekte', value: int(aktiv.length), foot: alle.length - aktiv.length ? `${alle.length - aktiv.length} abgeschlossen` : 'alle laufen', icon: 'folder' })}
      ${statCard({ label: 'Noch nicht abgerechnet', value: `${money(offenWert)} €`, tone: offenWert ? 'warn' : '', foot: `${dauerText(offenMin)} Stunden`, icon: 'clock' })}
      ${statCard({ label: 'Erfasst diesen Monat', value: dauerText(monatMin), foot: 'Stunden', icon: 'history' })}
      ${statCard({ label: 'Ergebnis aller Projekte', value: `${money(alle.reduce((s, x) => s + x.a.ergebnis, 0))} €`, foot: 'Einnahmen minus Ausgaben, netto', icon: 'chart' })}
    </div>
    <div class="card" id="pjListe"></div>`;
  stoppuhrLeiste($('#pjUhr', root));

  mountTable($('#pjListe', root), {
    id: 'projekte',
    cls: 'data',
    defaultSort: { key: 'letzte', dir: -1 },
    rows: alle,
    unit: ['Projekt', 'Projekte'],
    search: { placeholder: 'Projekt oder Kunde suchen …', text: (x) => [x.p.name, x.kunde, x.p.kostenstelle, x.p.notiz].join(' ') },
    columns: [
      { key: 'name', label: 'Projekt', type: 'text', tdCls: 'strong', value: (x) => x.p.name, cell: (x) => `${esc(x.p.name || 'Ohne Namen')}${x.kunde ? `<div class="tiny muted">${esc(x.kunde)}</div>` : ''}` },
      { key: 'stunden', label: 'Stunden', type: 'num', value: (x) => x.a.minuten, cell: (x) => esc(dauerText(x.a.minuten)) },
      { key: 'offen', label: 'Offen', type: 'num', value: (x) => x.a.offenWert, cell: (x) => (x.a.offenMinuten ? `${esc(money(x.a.offenWert))} €<div class="tiny muted">${esc(dauerText(x.a.offenMinuten))} Std.</div>` : '') },
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
    emptyText: 'Ein Projekt sammelt die Zeiten und Buchungen eines Auftrags. Aus den Zeiten wird mit einem Klick die Rechnung.',
    onRowClick: (x) => navigate('projekte', { id: x.p.id }),
  });
}

function budgetZelle(p, a) {
  const anteil = a.budgetAnteil ?? a.stundenAnteil;
  if (anteil === null) return '<span class="muted small">ohne</span>';
  const prozent = Math.round(anteil * 100);
  return `<span class="lz-balken${anteil >= 1 ? ' voll' : ''} pj-balken" style="--anteil:${Math.min(100, prozent)}%" role="img" aria-label="${esc(`${prozent} % des Budgets`)}"><span></span></span><div class="tiny muted">${esc(`${prozent} %`)}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Ein Projekt                                                                 */
/* -------------------------------------------------------------------------- */

function detail(root, p, actions) {
  actions.innerHTML = html`<button class="btn" id="pjZurueck">${icon('left', 16)} Alle Projekte</button>`;
  $('#pjZurueck', actions).addEventListener('click', () => navigate('projekte'));
  const db = { zeiten: sel.zeiten(), invoices: sel.invoices(), transactions: sel.transactions() };
  const a = projektAuswertung(db, p);
  const kunde = sel.contact(p.kontaktId);
  const laeuft = laufendeZeit();
  const zeiten = sel.zeiten().filter((z) => z.projektId === p.id && !z.laeuft);
  const buchungen = sel.transactions().filter((t) => t.projektId === p.id && !t.unlisted);
  const rechnungen = sel.invoices();

  root.innerHTML = html`
    <div id="pjUhr"></div>
    <div class="card mb16"><div class="card-body">
      <div class="row between wrap gap8">
        <div>
          <div class="re-detail-titel">${p.name || 'Ohne Namen'}</div>
          <div class="small muted">${kunde?.name || 'ohne Kunde'}${p.stundensatz ? ` · ${money(p.stundensatz)} € je Stunde` : ''}${p.kostenstelle ? ` · Kostenstelle ${p.kostenstelle}` : ''}</div>
        </div>
        <span class="badge ${p.status === 'aktiv' ? 'pos' : ''}">${PROJEKT_STATUS[p.status] || ''}</span>
      </div>
      <div class="kpi-list mt16">
        <div><div class="k">Stunden</div><div class="v">${dauerText(a.minuten)}</div></div>
        <div><div class="k">Noch nicht abgerechnet</div><div class="v">${money(a.offenWert)} € <span class="small muted">(${dauerText(a.offenMinuten)} Std.)</span></div></div>
        <div><div class="k">Einnahmen netto</div><div class="v">${money(a.einnahmen)} €</div></div>
        <div><div class="k">Ausgaben netto</div><div class="v">${money(a.ausgaben)} €</div></div>
        <div><div class="k">Ergebnis</div><div class="v">${money(a.ergebnis)} €</div></div>
        ${a.budgetAnteil !== null ? raw(html`<div><div class="k">Budget</div><div class="v">${Math.round(a.budgetAnteil * 100)} % von ${money(p.budget)} €</div></div>`) : ''}
        ${a.stundenAnteil !== null ? raw(html`<div><div class="k">Stundenbudget</div><div class="v">${Math.round(a.stundenAnteil * 100)} % von ${p.budgetStunden} Std.</div></div>`) : ''}
      </div>
      ${(a.budgetAnteil ?? 0) >= 0.8 || (a.stundenAnteil ?? 0) >= 0.8 ? raw(html`<div class="notice warn mt16">${(a.budgetAnteil ?? 0) >= 1 || (a.stundenAnteil ?? 0) >= 1 ? 'Das Budget ist ausgeschöpft.' : 'Das Budget ist zu mehr als 80 % verbraucht.'}</div>`) : ''}
      <div class="re-aktionen mt16">
        ${laeuft?.projektId === p.id ? '' : raw(html`<button class="btn primary" id="pjStart">${icon('play', 15)} Stoppuhr starten</button>`)}
        <button class="btn" id="pjZeitNeu">${icon('plus', 15)} Zeit eintragen</button>
        <button class="btn" id="pjAbrechnen" ${raw(a.offenMinuten ? '' : 'disabled')}>${icon('invoice', 15)} Abrechnen</button>
        <button class="btn ghost" id="pjBearbeiten">${icon('edit', 15)} Bearbeiten</button>
      </div>
    </div></div>

    <section class="card mb16">
      <div class="card-head"><h2>${icon('clock', 16)} Zeiten</h2><span class="sub">${zeiten.length === 1 ? '1 Eintrag' : `${zeiten.length} Einträge`}</span></div>
      <div id="pjZeiten"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${icon('book', 16)} Buchungen zu diesem Projekt</h2>
        <span class="sub">${buchungen.length ? `${buchungen.length} Buchungen` : 'Ordnen Sie Buchungen im Buchungsfenster unter „Weitere Angaben“ einem Projekt zu.'}</span></div>
      <div class="card-body">${buchungen.length ? raw(html`<ul class="re-buchungen">${buchungen.sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 50).map((t) => raw(html`
        <li><a href="#" data-tx="${t.id}">${fmtDate(t.date)} · ${t.description || (t.type === 'income' ? 'Einnahme' : 'Ausgabe')}</a>
          <span class="num">${t.type === 'income' ? '' : '−'}${money(Math.abs(t.net || 0))} €</span>
          ${t.voided || t.isReversal ? raw('<span class="badge plain">storniert</span>') : ''}</li>`))}</ul>`) : ''}</div>
    </section>`;

  stoppuhrLeiste($('#pjUhr', root));
  mountTable($('#pjZeiten', root), {
    id: 'projekt-zeiten',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: zeiten,
    unit: ['Zeit', 'Zeiten'],
    columns: [
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (z) => z.datum, cell: (z) => esc(fmtDate(z.datum)) },
      { key: 'dauer', label: 'Dauer', type: 'num', value: (z) => z.minuten, cell: (z) => esc(dauerText(z.minuten)) },
      { key: 'text', label: 'Tätigkeit', type: 'text', value: (z) => z.beschreibung || '', cell: (z) => esc(z.beschreibung || '') },
      {
        key: 'stand', label: 'Stand', type: 'text', value: (z) => zeitStand(z, rechnungen),
        cell: (z) => {
          const st = zeitStand(z, rechnungen);
          const r = z.rechnungId ? rechnungen.find((x) => x.id === z.rechnungId) : null;
          const ton = st === 'abgerechnet' ? 'pos' : st === 'im Entwurf' ? 'info' : st === 'offen' ? 'warn' : '';
          return `<span class="badge ${ton}">${esc(st)}</span>${r && st !== 'offen' ? ` <a href="#" data-re="${esc(r.id)}" class="small">${esc(r.nummer || 'Entwurf')}</a>` : ''}`;
        },
      },
      {
        key: 'actions', label: '', type: 'none', width: '84px', cls: 'right', tdCls: 'nowrap',
        cell: (z) => `<button class="btn sm ghost" data-z-weg="${esc(z.id)}" title="Löschen" aria-label="Zeit löschen">${icon('trash', 14).__raw}</button>`,
      },
    ],
    emptyTitle: 'Noch keine Zeiten',
    emptyText: 'Starten Sie die Stoppuhr oder tragen Sie eine Zeit von Hand ein.',
    onRowClick: (z) => zeitDialog(z, p),
    onRender: (el) => {
      $$('[data-z-weg]', el).forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!await confirmDialog({ title: 'Zeit löschen?', text: 'Der Eintrag wird entfernt.', confirmLabel: 'Löschen', danger: true })) return;
        try { await zeitLoeschen(b.dataset.zWeg); refresh(); } catch (ex) { err('Nicht gelöscht', ex.message); }
      }));
      $$('[data-re]', el).forEach((l) => l.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); navigate('rechnungen', { id: l.dataset.re }); }));
    },
  });

  $$('[data-tx]', root).forEach((l) => l.addEventListener('click', (e) => { e.preventDefault(); openTransactionDialog(l.dataset.tx, 'expense', { onSaved: () => refresh() }); }));
  $('#pjStart', root)?.addEventListener('click', () => startDialog(p));
  $('#pjZeitNeu', root).addEventListener('click', () => zeitDialog(neueZeit(p.id, { minuten: 60 }), p, { neu: true }));
  $('#pjAbrechnen', root).addEventListener('click', () => abrechnenDialog(p, a));
  $('#pjBearbeiten', root).addEventListener('click', () => projektDialog(structuredClone(p)));
}

function zeitStand(z, rechnungen) {
  if (abgerechnet(z, rechnungen)) return 'abgerechnet';
  if (imEntwurf(z, rechnungen)) return 'im Entwurf';
  return z.abrechenbar ? 'offen' : 'nicht abrechenbar';
}

/* -------------------------------------------------------------------------- */
/* Fenster                                                                     */
/* -------------------------------------------------------------------------- */

function kontaktOptionen(gewaehlt) {
  const kunden = [...sel.contacts()].filter((c) => c.kind !== 'supplier').sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  return html`<option value="">Ohne Kunde</option>${kunden.map((c) => raw(html`<option value="${c.id}" ${raw(c.id === gewaehlt ? 'selected' : '')}>${c.name}</option>`))}`;
}

function projektDialog(p, { neu = false } = {}) {
  const m = modal({
    title: neu ? 'Neues Projekt' : 'Projekt bearbeiten',
    body: html`
      <div class="field"><label for="pjName">Name</label><input id="pjName" value="${p.name}" placeholder="z. B. Website-Relaunch Café Sonnenschein" maxlength="120"></div>
      <div class="form-grid">
        <div class="field"><label for="pjKunde">Kunde</label><select id="pjKunde">${raw(kontaktOptionen(p.kontaktId))}</select></div>
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
    if (!await confirmDialog({ title: 'Projekt löschen?', text: 'Das geht nur, solange es keine Zeiten und Buchungen hat. Sonst schließen Sie es ab.', confirmLabel: 'Löschen', danger: true })) return;
    try { await projektLoeschen(p.id); m.close(); ok('Projekt gelöscht'); navigate('projekte'); } catch (e) { err('Nicht gelöscht', e.message); }
  });
  $m('[data-yes]').addEventListener('click', async () => {
    const name = $m('#pjName').value.trim();
    if (!name) { warn('Bitte einen Namen eintragen'); $m('#pjName').focus(); return; }
    Object.assign(p, {
      name, kontaktId: $m('#pjKunde').value, stundensatz: Math.max(0, parseMoney($m('#pjSatz').value) || 0), budget: Math.max(0, parseMoney($m('#pjBudget').value) || 0),
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

function startDialog(p) {
  const m = modal({
    title: 'Stoppuhr starten',
    size: 'slim',
    body: html`<div class="field mb0"><label for="pjTat">Tätigkeit (freiwillig)</label><input id="pjTat" maxlength="200" placeholder="z. B. Entwurf Startseite"></div>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('play', 15)} Starten</button>`,
  });
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    try { await stoppuhrStarten(p.id, m.root.querySelector('#pjTat').value.trim()); m.close(); refresh(); } catch (e) { err('Nicht gestartet', e.message); }
  });
  m.root.querySelector('#pjTat').focus();
}

function zeitDialog(z, _p, { neu = false } = {}) {
  const fest = !neu && abgerechnet(z, sel.invoices());
  const m = modal({
    title: neu ? 'Zeit eintragen' : 'Zeit bearbeiten',
    body: html`
      ${fest ? raw(html`<div class="notice mb16 small">Diese Zeit ist abgerechnet. Ändern lässt sich nur noch die Beschreibung.</div>`) : ''}
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
    if (!fest) Object.assign(neuZ, { datum: $m('#ztDatum').value || todayISO(), abrechenbar: $m('#ztAbr').checked });
    try { await zeitSpeichern(neuZ); m.close(); refresh(); } catch (e) { $m('#ztFehler').textContent = e.message; }
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
