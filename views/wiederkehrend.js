/**
 * Kontovia – wiederkehrende Buchungen anlegen und verwalten.
 *
 * Die Rechnung steht in lib/wiederkehrend.js. Hier: das Fenster, das fällige
 * Buchungen zum Anlegen anbietet, und die Liste unter Stammdaten.
 */

import { html, raw, esc, money, fmtDate, todayISO, parseMoney, moneyInput, int } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn } from '../lib/ui.js';
import { store, sel, lockedUntil, wiederkehrendeAnlegen, upsertEntity, deleteEntity } from '../lib/store.js';
import { faellige, naechstesDatum, TURNUS } from '../lib/wiederkehrend.js';
import { table } from '../lib/table.js';
import { refresh } from '../lib/router.js';
import { kannSchreiben } from '../lib/benutzer.js';

/** Fällige Vorkommen, die noch nicht als Buchung bestehen. */
export function offeneVorkommen() {
  if (!store.db) return [];
  return faellige(store.db, todayISO(), lockedUntil()).filter((e) => !e.vorhanden);
}

let offen = false;

/**
 * Bietet fällige wiederkehrende Buchungen zum Anlegen an. Angelegt wird nur,
 * was angehakt ist; Abgewähltes und Vorkommen im festgeschriebenen Zeitraum
 * werden übersprungen und nicht wieder angeboten.
 * @returns {Promise<number>} Zahl der angelegten Buchungen
 */
export async function faelligeAnbieten() {
  if (!store.db || offen) return 0;
  // Wer nur lesen darf, bekommt nichts angeboten; es legt dann jemand mit Schreibrecht an.
  if (!kannSchreiben()) return 0;
  const alle = faellige(store.db, todayISO(), lockedUntil());
  // Schon da – etwa von einem anderen Gerät über den Abgleich angelegt: nur fortschreiben.
  const schon = alle.filter((e) => e.vorhanden);
  const liste = alle.filter((e) => !e.vorhanden);
  if (!liste.length) {
    if (schon.length) await wiederkehrendeAnlegen([], schon);
    return 0;
  }
  offen = true;
  return new Promise((resolve) => {
    let fertig = false;
    const zeile = (e, i) => {
      const t = e.regel.template || {};
      const grund = e.gesperrt ? 'festgeschrieben, wird übersprungen' : '';
      return `<label class="attach" style="cursor:${grund ? 'default' : 'pointer'}">
        <input type="checkbox" data-i="${i}" ${grund ? 'disabled' : 'checked'}>
        <div class="name">${esc(t.description || '(ohne Beschreibung)')}
          <div class="tiny muted">${esc(fmtDate(e.datum))} · ${esc(TURNUS[e.regel.freq]?.[0] || '')} · ${esc(sel.categoryName(t.categoryId))}${e.regel.paid ? ' · als bezahlt' : ' · offen'}${grund ? ` · ${esc(grund)}` : ''}</div>
        </div>
        <span class="num nowrap ${t.type === 'income' ? 'amount pos' : 'amount neg'}">${t.type === 'income' ? '+' : '−'} ${esc(money(Math.abs(t.gross || 0)))} €</span>
      </label>`;
    };
    const m = modal({
      title: `${liste.length === 1 ? 'Eine wiederkehrende Buchung ist' : `${int(liste.length)} wiederkehrende Buchungen sind`} fällig`,
      body: `<p class="mt0 small muted">Angelegt wird, was angehakt ist. Jede ist eine eigene Buchung, die Sie danach wie jede
        andere ändern oder stornieren können. Nicht Angehaktes wird übersprungen. Belege hängen Sie an die einzelne Buchung an.</p>
        <div style="max-height:52vh;overflow-y:auto">${liste.map(zeile).join('')}</div>`,
      foot: '<button class="btn" data-later>Später</button><button class="btn primary" data-go>Anlegen</button>',
      onClose: () => { offen = false; if (!fertig) resolve(0); },
    });
    m.root.querySelector('[data-later]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-go]').addEventListener('click', async () => {
      const gewaehlt = new Set([...m.root.querySelectorAll('input[data-i]:checked')].map((c) => Number(c.dataset.i)));
      const anlegen = liste.filter((e, i) => gewaehlt.has(i) && !e.gesperrt);
      const ueberspringen = [...schon, ...liste.filter((e, i) => !gewaehlt.has(i) || e.gesperrt)];
      fertig = true;
      m.close();
      const n = await wiederkehrendeAnlegen(anlegen, ueberspringen);
      if (n) ok(n === 1 ? 'Eine Buchung angelegt' : `${int(n)} Buchungen angelegt`, 'Belege lassen sich an jede Buchung einzeln anhängen.');
      refresh();
      resolve(n);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Stammdaten                                                                  */
/* -------------------------------------------------------------------------- */

function status(r) {
  if (r.active === false) return ['pausiert', ''];
  const naechste = naechstesDatum(r);
  if (!naechste) return ['beendet', ''];
  return [naechste <= todayISO() ? 'fällig' : 'aktiv', naechste];
}

/** Liste der Regeln für Stammdaten → Wiederkehrend. */
export function regelTabelle() {
  return table({
    id: 'stamm-wiederkehrend',
    cls: 'data',
    defaultSort: { key: 'next', dir: 1 },
    rows: sel.recurring(),
    unit: ['Regel', 'Regeln'],
    search: sel.recurring().length > 8 ? { placeholder: 'Beschreibung suchen …', text: (r) => r.template?.description || '' } : null,
    columns: [
      { key: 'description', label: 'Beschreibung', type: 'text', tdCls: 'strong', value: (r) => r.template?.description || '', cell: (r) => esc(r.template?.description || '–') },
      {
        key: 'amount', label: 'Betrag', type: 'num', value: (r) => r.template?.gross || 0,
        cell: (r) => `<span class="amount ${r.template?.type === 'income' ? 'pos' : 'neg'}">${r.template?.type === 'income' ? '+' : '−'} ${esc(money(Math.abs(r.template?.gross || 0)))}</span>`,
      },
      { key: 'freq', label: 'Turnus', type: 'text', value: (r) => TURNUS[r.freq]?.[0] || '' },
      { key: 'category', label: 'Kategorie', type: 'text', tdCls: 'small muted', value: (r) => sel.categoryName(r.template?.categoryId) },
      { key: 'next', label: 'Nächste', type: 'date', dir: 1, value: (r) => status(r)[1], cell: (r) => esc(status(r)[1] ? fmtDate(status(r)[1]) : '–') },
      { key: 'until', label: 'Bis', type: 'date', tdCls: 'small muted', cell: (r) => esc(r.until ? fmtDate(r.until) : 'unbefristet') },
      {
        key: 'status', label: 'Status', type: 'text', value: (r) => status(r)[0],
        cell: (r) => { const s = status(r)[0]; return `<span class="badge ${s === 'fällig' ? 'warn' : s === 'aktiv' ? 'pos' : ''}">${esc(s)}</span>`; },
      },
      {
        key: 'actions', label: '', type: 'none', width: '84px', cls: 'right', tdCls: 'nowrap',
        cell: (r) => `<button class="btn sm ghost" data-rec-edit="${esc(r.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
          <button class="btn sm ghost" data-rec-del="${esc(r.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>`,
      },
    ],
    emptyTitle: 'Keine wiederkehrenden Buchungen',
    emptyText: 'Beim Erfassen einer Buchung unter „Weitere Angaben → Wiederholen“ einen Turnus wählen, etwa für Miete, Telefon oder Software-Abos.',
    onRowClick: (r) => regelDialog(r),
    onRender: (el) => {
      el.querySelectorAll('[data-rec-edit]').forEach((b) => b.addEventListener('click', () => regelDialog(sel.recurringRule(b.dataset.recEdit))));
      el.querySelectorAll('[data-rec-del]').forEach((b) => b.addEventListener('click', async () => {
        const r = sel.recurringRule(b.dataset.recDel);
        if (!r) return;
        if (!await confirmDialog({
          title: 'Wiederkehrende Buchung löschen?',
          text: `„${r.template?.description || ''}“ wird nicht mehr angeboten. Bereits angelegte Buchungen bleiben unverändert.`,
          confirmLabel: 'Löschen', danger: true,
        })) return;
        await deleteEntity('recurring', r.id, 'wiederkehrend');
        ok('Gelöscht');
        refresh();
      }));
    },
  });
}

/** Bearbeiten einer Regel: Vorlage, Turnus, nächstes Datum, Ende, Zahlung. */
export function regelDialog(regel) {
  if (!regel) return;
  const r = structuredClone(regel);
  const t = r.template || {};
  const klein = store.db.settings.taxMode === 'kleinunternehmer';
  const cats = sel.activeCategories(t.type || 'expense');
  const m = modal({
    title: 'Wiederkehrende Buchung',
    body: html`
      <div class="field"><label for="w_desc">Beschreibung *</label><input id="w_desc" value="${t.description || ''}"></div>
      <div class="form-grid">
        <div class="field"><label for="w_amount">Betrag (brutto)</label><input class="money-input" id="w_amount" inputmode="decimal" value="${moneyInput(t.gross || 0)}"></div>
        <div class="field"><label for="w_cat">Kategorie</label>
          <select id="w_cat">${raw(cats.map((c) => `<option value="${esc(c.id)}" ${c.id === t.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join(''))}</select></div>
        <div class="field"><label for="w_freq">Turnus</label>
          <select id="w_freq">${raw(Object.entries(TURNUS).map(([k, [name]]) => `<option value="${k}" ${k === r.freq ? 'selected' : ''}>${esc(name)}</option>`).join(''))}</select></div>
        <div class="field"><label for="w_next">Nächste Buchung am</label><input type="date" id="w_next" value="${naechstesDatum(r) || ''}"></div>
        <div class="field"><label for="w_until">Endet am (freiwillig)</label><input type="date" id="w_until" value="${r.until || ''}"></div>
        <div class="field"><label for="w_account">Zahlungskonto</label>
          <select id="w_account"><option value="">Keins</option>${raw(sel.accounts().map((a) => `<option value="${esc(a.id)}" ${a.id === t.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join(''))}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="w_paid" ${r.paid ? 'checked' : ''}> gleich als bezahlt anlegen (etwa bei Lastschrift oder Dauerauftrag)</label>
      <label class="check mt8"><input type="checkbox" id="w_active" ${r.active !== false ? 'checked' : ''}> aktiv (fällige Buchungen werden angeboten)</label>
      <p class="hint mt8">${klein ? 'Als Kleinunternehmer ohne Umsatzsteuer.' : `Umsatzsteuer wie in der Vorlage: ${t.vatRate ?? 0} %.`} Weitere Angaben der Vorlage
      (Kontakt, Notiz) stammen aus der ersten Buchung.</p>`,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
  });
  const g = (id) => m.root.querySelector('#w_' + id);
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    const description = g('desc').value.trim();
    if (!description) { warn('Bitte eine Beschreibung eintragen'); return; }
    const gross = parseMoney(g('amount').value);
    if (!gross) { warn('Der Betrag darf nicht 0 sein'); return; }
    const next = g('next').value;
    if (!next) { warn('Bitte das nächste Datum wählen'); return; }
    const rate = klein ? 0 : Number(t.vatRate) || 0;
    const net = rate ? Math.round(gross / (1 + rate / 100)) : gross;
    const neu = {
      ...r,
      freq: g('freq').value,
      // Ein neues Datum oder ein neuer Turnus beginnt die Reihe dort neu.
      ...(next !== naechstesDatum(r) || g('freq').value !== r.freq ? { start: next, n: 0 } : {}),
      until: g('until').value || '',
      paid: g('paid').checked,
      active: g('active').checked,
      template: { ...t, description, gross, net, vat: gross - net, categoryId: g('cat').value, accountId: g('account').value },
    };
    if (neu.until && neu.until < next) { warn('Das Ende liegt vor der nächsten Buchung'); return; }
    await upsertEntity('recurring', neu, 'wiederkehrend');
    m.close();
    ok('Gespeichert');
    refresh();
  });
}
