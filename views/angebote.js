/**
 * Kontovia – Angebote, Auftragsbestätigungen und Lieferscheine (Reiter „Angebote“ unter Rechnungen).
 *
 * Liste mit Kennzahlen und Filter nach Art und Stand; ein ausgestellter Beleg öffnet sich als eigene Seite mit
 * Vorschau, Versand und dem nächsten Schritt: annehmen oder ablehnen, Auftragsbestätigung, Lieferschein oder
 * Rechnung daraus erstellen. Ein Entwurf öffnet sich im Rechnungseditor (views/rechnungseditor.js), der die
 * Belegart kennt. Logik und Speicher: lib/angebote.js, lib/angebotsaktionen.js.
 */

import { html, raw, esc, $, $$, money, fmtDate, todayISO, addDays, int, sum } from '../lib/util.js';
import { icon, ok, err, statCard } from '../lib/ui.js';
import { sel } from '../lib/store.js';
import { navigate, refresh } from '../lib/router.js';
import { openMenu } from '../lib/popover.js';
import { mountTable } from '../lib/table.js';
import { berechnen, betragText, titel as titelVon } from '../lib/rechnung.js';
import { BELEGARTEN, BELEG_ZUSTAENDE, belegZustand, rechnungenZu } from '../lib/angebote.js';
import { ergebnisSetzen, folgebelegAnlegen, rechnungAnlegen, belegVersandVermerken } from '../lib/angebotsaktionen.js';
import { vorschauSvg, pdfSpeichern, pdfZeigen } from '../lib/rechnungsdateien.js';
import { projektMarke } from '../lib/projektwahl.js';
import { projektZeile, projektZeileVerdrahten } from './projekte.js';
import { projektAusAngebot } from '../lib/projektaktionen.js';
import { erlaubt } from '../lib/lizenzui.js';

const zustandVon = (b) => belegZustand(b, { rechnungen: sel.invoices() });

/** „Neues Angebot“: eine der drei Belegarten. */
export function neuBelegMenue(anker) {
  if (!erlaubt('angebote')) return;
  openMenu(anker, {
    label: 'Neuer Beleg',
    align: 'end',
    sections: [{
      key: 'b', value: '',
      options: Object.entries(BELEGARTEN).map(([k, a]) => ({ value: k, label: a.titel })),
    }],
    onPick: (_k, art) => navigate('rechnungen', { neuBeleg: art }),
  });
}

/* -------------------------------------------------------------------------- */
/* Liste                                                                       */
/* -------------------------------------------------------------------------- */

export function angeboteListe(root) {
  const heute = todayISO();
  const jahr = heute.slice(0, 4);
  const alle = sel.angebote().map((b) => ({ b, z: zustandVon(b), s: berechnen(b) }));
  const offen = alle.filter((x) => x.b.belegart === 'angebot' && x.z === 'offen');
  const bald = offen.filter((x) => x.b.gueltigBis && x.b.gueltigBis <= addDays(heute, 7));
  const angenommen = alle.filter((x) => x.b.belegart === 'angebot' && ['angenommen', 'berechnet'].includes(x.z) && String(x.b.ergebnisAm || x.b.datum).startsWith(jahr));
  const angeboteJahr = alle.filter((x) => x.b.belegart === 'angebot' && x.b.status === 'ausgestellt' && String(x.b.datum).startsWith(jahr));
  const quote = angeboteJahr.length ? Math.round((angenommen.length / angeboteJahr.length) * 100) : null;
  const entwuerfe = alle.filter((x) => x.z === 'entwurf');

  root.innerHTML = html`
    <div class="grid c4 mb16 re-kennzahlen">
      ${statCard({ label: 'Offene Angebote', value: `${money(sum(offen, (x) => x.s.brutto))} €`, foot: offen.length === 1 ? '1 Angebot' : `${int(offen.length)} Angebote`, icon: 'clock' })}
      ${statCard({ label: `Angenommen ${jahr}`, value: `${money(sum(angenommen, (x) => x.s.brutto))} €`, tone: angenommen.length ? 'pos' : '', foot: quote === null ? 'noch keine Angebote' : `${quote} % der Angebote`, icon: 'check' })}
      ${statCard({ label: 'Läuft bald ab', value: int(bald.length), tone: bald.length ? 'warn' : '', foot: bald.length ? 'in den nächsten 7 Tagen' : 'nichts dringend', icon: 'alert' })}
      ${statCard({ label: 'Entwürfe', value: int(entwuerfe.length), foot: entwuerfe.length ? 'noch nicht ausgestellt' : 'keine offenen Entwürfe', icon: 'edit' })}
    </div>
    <div class="card" id="anListe"></div>`;

  mountTable($('#anListe', root), {
    id: 'angebote',
    cls: 'data',
    defaultSort: { key: 'datum', dir: -1 },
    rows: alle,
    unit: ['Beleg', 'Belege'],
    search: {
      placeholder: 'Nummer, Kunde oder Betreff suchen …',
      text: (x) => [x.b.nummer, x.b.kaeufer?.name, x.b.betreff, money(x.s.brutto)].join(' '),
    },
    columns: [
      { key: 'nummer', label: 'Nummer', type: 'text', tdCls: 'strong nowrap', value: (x) => x.b.nummer || '', cell: (x) => (x.b.nummer ? esc(x.b.nummer) : '<span class="muted">Entwurf</span>') },
      { key: 'art', label: 'Art', type: 'text', tdCls: 'small muted', value: (x) => titelVon(x.b), cell: (x) => esc(titelVon(x.b)) },
      { key: 'datum', label: 'Datum', type: 'date', cls: 'num', tdCls: 'nowrap', value: (x) => x.b.datum || '', cell: (x) => esc(fmtDate(x.b.datum)) },
      {
        key: 'kunde', label: 'Kunde', type: 'text', value: (x) => x.b.kaeufer?.name || '',
        cell: (x) => `${esc(x.b.kaeufer?.name || '–')}${x.b.betreff ? `<div class="tiny muted truncate">${esc(x.b.betreff)}</div>` : ''}${projektMarke(x.b)}`,
      },
      { key: 'betrag', label: 'Betrag', type: 'num', value: (x) => (x.b.belegart === 'lieferschein' ? 0 : x.s.brutto), cell: (x) => (x.b.belegart === 'lieferschein' ? '' : `${esc(money(x.s.brutto))} €`) },
      {
        key: 'gueltig', label: 'Gültig bis', type: 'date', cls: 'num', tdCls: 'nowrap small', value: (x) => x.b.gueltigBis || '',
        cell: (x) => (x.b.belegart === 'angebot' && x.z === 'offen' ? esc(fmtDate(x.b.gueltigBis)) : ''),
      },
      {
        key: 'zustand', label: 'Stand', type: 'text', value: (x) => BELEG_ZUSTAENDE[x.z]?.name || '',
        cell: (x) => `<span class="badge ${BELEG_ZUSTAENDE[x.z]?.ton || ''}">${esc(BELEG_ZUSTAENDE[x.z]?.name || '')}</span>`,
      },
      {
        key: 'actions', label: '', type: 'none', width: '84px', cls: 'right', tdCls: 'nowrap',
        cell: (x) => `<button class="btn sm ghost" data-pdf="${esc(x.b.id)}" title="PDF ansehen" aria-label="PDF ansehen">${icon('pdf', 14).__raw}</button>`,
      },
    ],
    filters: [
      {
        key: 'art', column: 'art', title: 'Art', initial: 'alle', chip: (v, label) => label,
        options: () => [['alle', 'Alle', () => true], ...Object.entries(BELEGARTEN).map(([k, a]) => [k, a.mehrzahl, (x) => x.b.belegart === k])],
      },
      {
        key: 'stand', column: 'zustand', title: 'Stand', initial: 'alle', chip: (v, label) => label,
        options: () => [['alle', 'Alle', () => true], ...Object.entries(BELEG_ZUSTAENDE).map(([k, z]) => [k, z.name, (x) => x.z === k])],
      },
    ],
    emptyTitle: 'Noch keine Angebote',
    emptyText: 'Mit „Neues Angebot“ schreiben Sie ein Angebot, eine Auftragsbestätigung oder einen Lieferschein. Daraus wird mit einem Klick die Rechnung.',
    onRowClick: (x) => navigate('rechnungen', { beleg: x.b.id }),
    onRender: (el) => {
      $$('[data-pdf]', el).forEach((b) => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await pdfZeigen(sel.angebot(b.dataset.pdf)); } catch (ex) { err('PDF nicht erstellt', ex.message); }
      }));
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Ein ausgestellter Beleg                                                     */
/* -------------------------------------------------------------------------- */

const VERSANDART = {
  manuell: 'von Hand vermerkt', google: 'über Gmail', microsoft: 'über Outlook', eml: 'per E-Mail-Programm', teilen: 'geteilt', mailto: 'per E-Mail-Programm',
};

export async function belegDetail(root, b, actions) {
  const z = zustandVon(b);
  const s = berechnen(b);
  const ls = b.belegart === 'lieferschein';
  const quelle = b.bezug?.id ? sel.angebot(b.bezug.id) : null;
  const folge = (b.folge || []).map((f) => (f.belegart === 'rechnung' ? { ...f, x: sel.invoice(f.id) } : { ...f, x: sel.angebot(f.id) })).filter((f) => f.x);
  const rechnungen = rechnungenZu(b, sel.invoices());
  // Entwürfe von Rechnungen aus diesem Beleg (noch ohne Nummer) stehen auch dabei.
  const rechnungsEntwuerfe = sel.invoices().filter((r) => r.ausBeleg?.id === b.id && r.status !== 'ausgestellt');

  actions.innerHTML = html`<button class="btn" id="anZurueck">${icon('left', 16)} Zur Übersicht</button>`;
  $('#anZurueck', actions).addEventListener('click', () => navigate('rechnungen', { tab: 'angebote' }));

  const verweis = (x, art) => html`<a href="#" data-gehe="${x.id}" data-art="${art}">${art === 'rechnung' ? titelVon(x) : BELEGARTEN[art]?.titel || ''} ${x.nummer || 'Entwurf'}</a>`;
  const naechste = [];
  if (b.belegart === 'angebot') naechste.push(['auftrag', 'Auftragsbestätigung erstellen']);
  if (b.belegart !== 'lieferschein') naechste.push(['lieferschein', 'Lieferschein erstellen']);
  const entstanden = [...folge.map((f) => verweis(f.x, f.belegart)), ...rechnungsEntwuerfe.map((r) => verweis(r, 'rechnung'))];
  const versandZeile = (v) => html`${`Versendet am ${fmtDate(String(v.ts).slice(0, 10))}${v.an ? ` an ${v.an}` : ''}${VERSANDART[v.art] ? ` (${VERSANDART[v.art]})` : ''}`}`;

  root.innerHTML = html`
    <div class="re-editor re-detail">
      <div class="re-form">
        <div class="card">
          <div class="card-body">
            <div class="row between wrap gap8">
              <div>
                <div class="re-detail-titel">${titelVon(b)} ${b.nummer}</div>
                <div class="small muted">${b.kaeufer?.name || ''}${b.betreff ? ` · ${b.betreff}` : ''}</div>
              </div>
              <span class="badge ${BELEG_ZUSTAENDE[z]?.ton || ''}">${BELEG_ZUSTAENDE[z]?.name || ''}</span>
            </div>
            <div class="kpi-list mt16">
              ${ls ? '' : raw(html`<div><div class="k">Betrag</div><div class="v">${betragText(s.brutto, b.waehrung)}</div></div>`)}
              <div><div class="k">Datum</div><div class="v">${fmtDate(b.datum)}</div></div>
              ${b.belegart === 'angebot' && b.gueltigBis ? raw(html`<div><div class="k">Gültig bis</div><div class="v">${fmtDate(b.gueltigBis)}</div></div>`) : ''}
              <div><div class="k">Ausgestellt</div><div class="v">${fmtDate(String(b.ausgestelltAm || '').slice(0, 10))}</div></div>
            </div>
            ${quelle ? raw(html`<div class="notice mt16">Entstanden aus ${raw(verweis(quelle, quelle.belegart))}.</div>`) : ''}
            ${entstanden.length ? raw(html`<div class="notice mt16">Daraus entstanden: ${raw(entstanden.join(', '))}.</div>`) : ''}
            ${raw(projektZeile('beleg', b))}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('check', 16)} Nächster Schritt</h2></div>
          <div class="card-body">
            ${b.belegart === 'angebot' ? raw(html`<div class="re-aktionen mb8">
              ${z === 'angenommen' || z === 'abgelehnt' ? raw(html`<button class="btn" data-ergebnis="">${icon('refresh', 15)} Wieder offen</button>`)
    : raw(html`<button class="btn" data-ergebnis="angenommen">${icon('check', 15)} Angenommen</button>
                 <button class="btn" data-ergebnis="abgelehnt">${icon('x', 15)} Abgelehnt</button>`)}
            </div>`) : ''}
            <div class="re-aktionen">
              <button class="btn primary" id="anRechnung">${icon('invoice', 15)} Rechnung erstellen</button>
              ${naechste.map(([art, text]) => raw(html`<button class="btn" data-folge="${art}">${icon('plus', 15)} ${text}</button>`))}
              ${b.belegart !== 'lieferschein' && !b.projektId && z !== 'abgelehnt' ? raw(html`<button class="btn" id="anProjekt" data-krone="projekte" title="Zeiten, Ausgaben und Rechnungen zu diesem Auftrag an einer Stelle sammeln">${icon('folder', 15)} Projekt anlegen</button>`) : ''}
            </div>
            <p class="small muted mb0 mt8">${rechnungen.length
    ? (rechnungen.length === 1 ? 'Zu diesem Beleg gibt es schon eine Rechnung. Eine weitere, etwa eine Teilrechnung, ist möglich.'
      : `Zu diesem Beleg gibt es schon ${rechnungen.length} Rechnungen. Eine weitere, etwa eine Teilrechnung, ist möglich.`)
    : 'Die Rechnung entsteht als Entwurf mit Kunde und Positionen dieses Belegs. Sie prüfen sie und stellen sie selbst aus.'}</p>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('export', 16)} Verschicken</h2></div>
          <div class="card-body">
            <div class="re-aktionen">
              <button class="btn" id="anSenden">${icon('external', 15)} Per E-Mail senden</button>
              <button class="btn" id="anPdfSpeichern">${icon('pdf', 15)} PDF speichern</button>
              <button class="btn ghost" id="anPdfAnsehen">${icon('eye', 15)} PDF ansehen</button>
            </div>
            ${(b.versand || []).length ? raw(html`<p class="small mb0 mt8">${raw(b.versand.map(versandZeile).join('<br>'))}</p>`) : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('copy', 16)} Ändern</h2></div>
          <div class="card-body">
            <p class="small muted mt0">Ein ausgestellter Beleg bleibt, wie er ist. Für eine geänderte Fassung legen Sie eine Kopie an; sie bekommt eine neue Nummer.</p>
            <div class="re-aktionen"><button class="btn" id="anDuplizieren">${icon('copy', 15)} Duplizieren</button></div>
          </div>
        </div>
      </div>
      <aside class="re-seitenspalte">
        <div class="re-vorschau" id="anVorschau" aria-label="Ansicht des Belegs"><div class="skeleton" style="height:420px"></div></div>
      </aside>
    </div>`;

  vorschauSvg(b).then((svgs) => {
    const host = $('#anVorschau', root);
    // Die Seiten baut der eigene Druck (lib/rechnungsdruck.js → pdfvorschau.js), jeder Text darin ist schon maskiert.
    if (host) host.innerHTML = html`${raw(svgs.map((svg) => `<div class="re-blatt">${svg}</div>`).join(''))}`;
  }).catch(() => { const host = $('#anVorschau', root); if (host) host.innerHTML = ''; });

  const sicher = (fn) => async (e) => {
    const knopf = e?.currentTarget;
    if (knopf) knopf.disabled = true;
    try { await fn(); } catch (ex) { err('Das hat nicht geklappt', ex.message); }
    if (knopf?.isConnected) knopf.disabled = false;
  };

  $$('[data-gehe]', root).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('rechnungen', a.dataset.art === 'rechnung' ? { id: a.dataset.gehe } : { beleg: a.dataset.gehe });
  }));
  projektZeileVerdrahten(root, 'beleg', b);
  $('#anProjekt', root)?.addEventListener('click', sicher(async () => {
    if (!erlaubt('projekte')) return;
    const p = await projektAusAngebot(b.id);
    ok('Projekt angelegt', p.name);
    navigate('projekte', { id: p.id });
  }));
  $$('[data-ergebnis]', root).forEach((k) => k.addEventListener('click', sicher(async () => {
    await ergebnisSetzen(b.id, k.dataset.ergebnis);
    ok(k.dataset.ergebnis === 'angenommen' ? 'Als angenommen vermerkt' : k.dataset.ergebnis === 'abgelehnt' ? 'Als abgelehnt vermerkt' : 'Wieder offen');
    refresh();
  })));
  $$('[data-folge]', root).forEach((k) => k.addEventListener('click', sicher(async () => {
    const neu = await folgebelegAnlegen(b.id, k.dataset.folge);
    navigate('rechnungen', { beleg: neu.id });
  })));
  $('#anRechnung', root).addEventListener('click', sicher(async () => {
    const r = await rechnungAnlegen(b.id);
    ok('Rechnungsentwurf angelegt', 'Bitte prüfen und ausstellen.');
    navigate('rechnungen', { id: r.id });
  }));
  // Das Sendefenster gehört zu den Rechnungen; geladen wird es erst jetzt (Rechnungen zeigen ihrerseits die Angebote).
  $('#anSenden', root).addEventListener('click', async () => (await import('./rechnungen.js')).sendenDialog(b, { offen: false, vermerk: belegVersandVermerken }));
  $('#anPdfSpeichern', root).addEventListener('click', sicher(async () => { const p = await pdfSpeichern(b); if (p) ok('PDF gespeichert', p); }));
  $('#anPdfAnsehen', root).addEventListener('click', sicher(() => pdfZeigen(b)));
  $('#anDuplizieren', root).addEventListener('click', () => navigate('rechnungen', { neuBeleg: b.belegart, kopieVonBeleg: b.id }));
}
