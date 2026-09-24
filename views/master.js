/** Kontovia – Stammdaten: Kategorien, Kontakte, Konten, Anlagevermögen. */

import {
  html, raw, esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO, uid, int, sum, sortBy,
} from '../lib/util.js';
import { icon, modal, confirmDialog, ok, warn, err, emptyState } from '../lib/ui.js';
import { store, sel, upsertEntity, deleteEntity } from '../lib/store.js';
import { depreciationPlan, depreciationInRange, bookValue } from '../lib/calc.js';
import { refresh } from '../lib/router.js';


let tab = 'categories';

const TABS = {
  categories: 'Kategorien',
  contacts: 'Kunden & Lieferanten',
  accounts: 'Zahlungskonten',
  assets: 'Anlagevermögen',
};

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = html`<button class="btn primary" id="btnNew">${icon('plus', 16)} Neu</button>`;
  actions.querySelector('#btnNew').addEventListener('click', () => openDialog(tab, null));
  draw(root);
}

function draw(root) {
  root.innerHTML = html`
    <div class="seg mb16">
      ${raw(Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(v)}</button>`).join(''))}
    </div>
    <div id="body"></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(root); }));
  ({ categories, contacts, accounts, assets }[tab])($('#body', root));
}

function usageCount(field, id) {
  return sel.transactions().filter((t) => t[field] === id).length;
}

/* -------------------------------------------------------------------------- */
/* Kategorien                                                                  */
/* -------------------------------------------------------------------------- */

function categories(root) {
  const rows = sel.categories();
  const group = (kind, title) => {
    const list = sortBy(rows.filter((c) => c.kind === kind), 'name');
    return `
      <div class="card mb16">
        <div class="card-head"><h3>${esc(title)}</h3><div class="spacer"></div><span class="badge">${list.length}</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Name</th><th class="num">EÜR-Zeile</th><th class="num">SKR03</th><th class="num">SKR04</th>
            <th class="num">USt</th><th class="num">Buchungen</th><th>Besonderheit</th><th style="width:80px"></th>
          </tr></thead>
          <tbody>
            ${list.map((c) => `<tr class="${c.active === false ? 'void' : ''}">
              <td class="strong">${esc(c.name)}</td>
              <td class="num">${c.euerLine ?? '<span class="muted">–</span>'}</td>
              <td class="num muted">${esc(c.skr03 || '')}</td>
              <td class="num muted">${esc(c.skr04 || '')}</td>
              <td class="num">${c.vatRate ?? 0} %</td>
              <td class="num muted">${int(usageCount('categoryId', c.id))}</td>
              <td class="small">${flags(c)}</td>
              <td class="right nowrap">
                <button class="btn sm ghost" data-edit="${esc(c.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
                <button class="btn sm ghost" data-del="${esc(c.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  };

  root.innerHTML = html`
    <div class="notice mb16">
      Die Kategorie einer Buchung entscheidet, in welche Zeile der Anlage EÜR und auf welches
      Konto im DATEV-Export sie fließt. Die mitgelieferte Zuordnung folgt der Anlage EÜR
      2024/2025 und dem ${esc(store.db.settings.chartOfAccounts || 'SKR03')} – prüfen Sie sie einmal mit Ihrer Steuerberatung
      und passen Sie sie hier an, wenn sich das Formular ändert.
    </div>
    ${raw(group('income', 'Einnahmen'))}
    ${raw(group('expense', 'Ausgaben'))}`;

  wireRowButtons(root, 'categories', 'categoryId', 'kategorie');
}

function flags(c) {
  const out = [];
  if (c.private) out.push('<span class="badge">privat, kein Betriebsvorgang</span>');
  if (c.depreciation) out.push('<span class="badge info">Abschreibung</span>');
  if (c.vatNeutral) out.push('<span class="badge">Finanzamt-Verrechnung</span>');
  if (c.deductibleRate && c.deductibleRate < 1) out.push(`<span class="badge warn">nur ${Math.round(c.deductibleRate * 100)} % abziehbar</span>`);
  if (c.intraEu) out.push('<span class="badge">innergemeinschaftlich</span>');
  if (c.reverseCharge) out.push('<span class="badge">Reverse Charge</span>');
  if (c.active === false) out.push('<span class="badge">ausgeblendet</span>');
  return out.join(' ');
}

/* -------------------------------------------------------------------------- */
/* Kontakte                                                                    */
/* -------------------------------------------------------------------------- */

function contacts(root) {
  const rows = sortBy(sel.contacts(), 'name');
  root.innerHTML = html`
    <div class="card">
      <div class="card-head"><h3>Kunden und Lieferanten</h3><div class="spacer"></div><span class="badge">${rows.length}</span></div>
      <div class="table-wrap">
        ${rows.length ? raw(`<table class="data">
          <thead><tr><th>Name</th><th>Art</th><th>Kontakt</th><th>Steuernummer / USt-IdNr.</th><th class="num">Buchungen</th><th class="num">Umsatz</th><th style="width:80px"></th></tr></thead>
          <tbody>
            ${rows.map((c) => {
              const txs = sel.liveTransactions().filter((t) => t.contactId === c.id);
              const vol = sum(txs, (t) => t.gross);
              return `<tr>
                <td class="strong">${esc(c.name)}</td>
                <td><span class="badge">${esc({ customer: 'Kunde', supplier: 'Lieferant', both: 'Kunde & Lieferant' }[c.kind] || c.kind)}</span></td>
                <td class="small muted">${esc(c.email || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</td>
                <td class="small muted">${esc(c.taxId || '')}</td>
                <td class="num">${int(txs.length)}</td>
                <td class="num">${esc(money(vol))} €</td>
                <td class="right nowrap">
                  <button class="btn sm ghost" data-edit="${esc(c.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
                  <button class="btn sm ghost" data-del="${esc(c.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`) : emptyState('Noch keine Kontakte', 'Kontakte helfen beim Auswerten: Wer bringt Umsatz, wo geben Sie am meisten aus.')}
      </div>
    </div>`;
  wireRowButtons(root, 'contacts', 'contactId', 'kontakt');
}

/* -------------------------------------------------------------------------- */
/* Konten                                                                      */
/* -------------------------------------------------------------------------- */

function accounts(root) {
  const rows = sel.accounts();
  // Die Kontospalte zeigt den Kontenrahmen, der auch im DATEV-Export verwendet wird.
  const skr = store.db.settings.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03';
  root.innerHTML = html`
    <div class="notice mb16">
      Zahlungskonten bilden Ihre Bankkonten und Ihre Bargeldkasse ab. Der Anfangsbestand
      ist der Saldo an dem Tag, ab dem Sie mit Kontovia buchen – damit stimmen die
      Kontostände in der Übersicht.
    </div>
    <div class="card">
      <div class="card-head"><h3>Zahlungskonten</h3><div class="spacer"></div><span class="badge">${rows.length}</span></div>
      <div class="table-wrap">
        ${rows.length ? raw(`<table class="data">
          <thead><tr><th>Name</th><th>Art</th><th>IBAN</th><th class="num">Anfangsbestand</th><th class="num">Gültig ab</th><th class="num">Konto ${esc(skr.toUpperCase())}</th><th class="num">Buchungen</th><th style="width:80px"></th></tr></thead>
          <tbody>
            ${rows.map((a) => `<tr>
              <td class="strong">${esc(a.name)}</td>
              <td>${esc(a.kind === 'bank' ? 'Bankkonto' : a.kind === 'cash' ? 'Kasse' : 'Sonstiges')}</td>
              <td class="small muted">${esc(a.iban || '')}</td>
              <td class="num">${esc(money(a.openingBalance))} €</td>
              <td class="num small muted">${esc(fmtDate(a.openingDate))}</td>
              <td class="num muted">${esc(a[skr] || '')}</td>
              <td class="num">${int(usageCount('accountId', a.id))}</td>
              <td class="right nowrap">
                <button class="btn sm ghost" data-edit="${esc(a.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
                <button class="btn sm ghost" data-del="${esc(a.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`) : emptyState('Keine Konten', 'Legen Sie mindestens ein Bankkonto an.')}
      </div>
    </div>`;
  wireRowButtons(root, 'accounts', 'accountId', 'konto');
}

/* -------------------------------------------------------------------------- */
/* Anlagevermögen                                                              */
/* -------------------------------------------------------------------------- */

function assets(root) {
  const rows = sortBy(sel.assets(), 'purchaseDate', -1);
  const year = new Date().getFullYear();
  root.innerHTML = html`
    <div class="notice mb16">
      Wirtschaftsgüter über 800 € netto werden nicht sofort abgezogen, sondern über
      ihre Nutzungsdauer verteilt (lineare AfA, § 7 EStG). Kontovia rechnet monatsgenau
      ab dem Anschaffungsmonat und übernimmt den Betrag automatisch in Ihre
      Betriebsausgaben und in Zeile 31 der Anlage EÜR.
    </div>
    <div class="card">
      <div class="card-head"><h3>Anlagenverzeichnis</h3><div class="spacer"></div>
        <span class="badge">Restbuchwert ${esc(money(sum(rows, (a) => bookValue(a, todayISO()))))} €</span></div>
      <div class="table-wrap">
        ${rows.length ? raw(`<table class="data">
          <thead><tr><th>Wirtschaftsgut</th><th class="num">Anschaffung</th><th class="num">Kosten</th><th class="num">Nutzungsdauer</th><th class="num">AfA ${year}</th><th class="num">Restbuchwert heute</th><th style="width:80px"></th></tr></thead>
          <tbody>
            ${rows.map((a) => `<tr>
              <td class="strong">${esc(a.name)}</td>
              <td class="num nowrap">${esc(fmtDate(a.purchaseDate))}</td>
              <td class="num">${esc(money(a.cost))} €</td>
              <td class="num">${esc(a.usefulLifeYears)} Jahre</td>
              <td class="num">${esc(money(depreciationInRange(a, `${year}-01-01`, `${year}-12-31`)))} €</td>
              <td class="num">${esc(money(bookValue(a, todayISO())))} €</td>
              <td class="right nowrap">
                <button class="btn sm ghost" data-plan="${esc(a.id)}" title="Abschreibungsplan">${icon('chart', 14).__raw}</button>
                <button class="btn sm ghost" data-edit="${esc(a.id)}" title="Bearbeiten" aria-label="Bearbeiten">${icon('edit', 14).__raw}</button>
                <button class="btn sm ghost" data-del="${esc(a.id)}" title="Löschen" aria-label="Löschen">${icon('trash', 14).__raw}</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`) : emptyState('Kein Anlagevermögen', 'Beim Erfassen einer Ausgabe können Sie „Als Anlagegut abschreiben“ wählen.')}
      </div>
    </div>`;

  $$('[data-plan]', root).forEach((b) => b.addEventListener('click', () => showPlan(b.dataset.plan)));
  wireRowButtons(root, 'assets', 'assetId', 'anlage');
}

function showPlan(id) {
  const a = sel.assets().find((x) => x.id === id);
  const plan = depreciationPlan(a);
  const byYear = new Map();
  for (const e of plan) {
    const y = e.ym.slice(0, 4);
    byYear.set(y, (byYear.get(y) || 0) + e.amount);
  }
  let rest = a.cost;
  modal({
    title: `Abschreibungsplan – ${a.name}`,
    body: html`
      <p class="mt0 small muted">Anschaffungskosten ${money(a.cost)} € · ${a.usefulLifeYears} Jahre linear ·
      ab ${fmtDate(a.purchaseDate)} · monatsgenau nach § 7 Abs. 1 Satz 4 EStG</p>
      <table class="data compact">
        <thead><tr><th>Jahr</th><th class="num">Abschreibung</th><th class="num">Restbuchwert am Jahresende</th></tr></thead>
        <tbody>${raw([...byYear.entries()].map(([y, amount]) => {
          rest -= amount;
          return `<tr><td>${esc(y)}</td><td class="num">${esc(money(amount))} €</td><td class="num">${esc(money(Math.max(0, rest)))} €</td></tr>`;
        }).join(''))}</tbody>
        <tfoot><tr><td>Summe</td><td class="num">${money(a.cost)} €</td><td></td></tr></tfoot>
      </table>`,
    foot: '<button class="btn primary" data-x>Schließen</button>',
  }).root.querySelector('[data-x]').addEventListener('click', (e) => e.target.closest('.modal-backdrop').remove());
}

/* -------------------------------------------------------------------------- */
/* Bearbeiten und Löschen                                                      */
/* -------------------------------------------------------------------------- */

function wireRowButtons(root, collection, usageField, label) {
  $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => openDialog(collection, b.dataset.edit)));
  $$('[data-del]', root).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.del;
    const used = sel.transactions().filter((t) => t[usageField] === id).length;
    if (used) {
      err('Wird noch verwendet', `${used} Buchungen verweisen darauf. Ändern Sie diese zuerst oder blenden Sie den Eintrag nur aus.`);
      return;
    }
    if (!await confirmDialog({ title: 'Wirklich löschen?', text: 'Der Eintrag wird entfernt.', confirmLabel: 'Löschen', danger: true })) return;
    await deleteEntity(collection, id, label);
    ok('Gelöscht');
    refresh();
  }));
}

function openDialog(collection, id) {
  const item = id ? store.db[collection].find((x) => x.id === id) : null;
  const forms = {
    categories: categoryForm,
    contacts: contactForm,
    accounts: accountForm,
    assets: assetForm,
  };
  forms[collection](item ? structuredClone(item) : null);
}

function baseDialog({ title, body, onSave, wide = false }) {
  const m = modal({
    title,
    size: wide ? '' : 'slim',
    body,
    foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Speichern</button>',
  });
  m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-yes]').addEventListener('click', async () => {
    const done = await onSave(m.root);
    if (done !== false) { m.close(); refresh(); }
  });
  return m;
}

function categoryForm(c) {
  const isNew = !c;
  c = c || { id: uid('cat'), kind: 'expense', name: '', euerLine: null, skr03: '', skr04: '', vatRate: 19, active: true };
  const lineOptions = Object.entries(store.db.euerLines || {})
    .map(([k, v]) => `<option value="${k}" ${String(c.euerLine) === k ? 'selected' : ''}>${esc(k)} – ${esc(v)}</option>`).join('');

  baseDialog({
    title: isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten',
    wide: true,
    body: html`
      <div class="form-grid">
        <div class="field full"><label>Name *</label><input id="f_name" value="${esc(c.name)}"></div>
        <div class="field">
          <label>Art</label>
          <select id="f_kind">
            <option value="income" ${c.kind === 'income' ? 'selected' : ''}>Einnahme</option>
            <option value="expense" ${c.kind === 'expense' ? 'selected' : ''}>Ausgabe</option>
          </select>
        </div>
        <div class="field">
          <label>Voreingestellter Steuersatz</label>
          <select id="f_vatRate">
            <option value="19" ${c.vatRate === 19 ? 'selected' : ''}>19 %</option>
            <option value="7" ${c.vatRate === 7 ? 'selected' : ''}>7 %</option>
            <option value="0" ${!c.vatRate ? 'selected' : ''}>0 %</option>
          </select>
        </div>
        <div class="field full">
          <label>Zeile der Anlage EÜR</label>
          <select id="f_euerLine">
            <option value="">– keine Zuordnung (nicht steuerwirksam) –</option>
            ${raw(lineOptions)}
          </select>
          <span class="hint">Bestimmt, wo der Betrag in der EÜR-Auswertung erscheint.</span>
        </div>
        <div class="field"><label>Konto SKR03</label><input id="f_skr03" value="${esc(c.skr03 || '')}"></div>
        <div class="field"><label>Konto SKR04</label><input id="f_skr04" value="${esc(c.skr04 || '')}"></div>
        <div class="field full">
          <label>Abziehbarer Anteil</label>
          <select id="f_deductibleRate">
            <option value="1" ${!c.deductibleRate || c.deductibleRate === 1 ? 'selected' : ''}>100 % – voll abziehbar</option>
            <option value="0.7" ${c.deductibleRate === 0.7 ? 'selected' : ''}>70 % – Bewirtungskosten</option>
            <option value="0.5" ${c.deductibleRate === 0.5 ? 'selected' : ''}>50 %</option>
            <option value="0" ${c.deductibleRate === 0 ? 'selected' : ''}>0 % – nicht abziehbar</option>
          </select>
        </div>
        <div class="field full">
          <label class="check"><input type="checkbox" id="f_private" ${c.private ? 'checked' : ''}> Privatvorgang (Entnahme/Einlage – wirkt nicht auf den Gewinn)</label>
          <label class="check mt8"><input type="checkbox" id="f_active" ${c.active !== false ? 'checked' : ''}> in der Auswahl anzeigen</label>
        </div>
      </div>`,
    onSave: async (rootEl) => {
      const g = (k) => rootEl.querySelector('#f_' + k);
      const name = g('name').value.trim();
      if (!name) { warn('Bitte einen Namen eintragen'); return false; }
      const next = {
        ...c,
        name,
        kind: g('kind').value,
        vatRate: Number(g('vatRate').value),
        euerLine: g('euerLine').value ? Number(g('euerLine').value) : null,
        skr03: g('skr03').value.trim(),
        skr04: g('skr04').value.trim(),
        deductibleRate: Number(g('deductibleRate').value),
        private: g('private').checked,
        active: g('active').checked,
      };
      await upsertEntity('categories', next, 'kategorie');
      ok('Kategorie gespeichert');
    },
  });
}

function contactForm(c) {
  const isNew = !c;
  c = c || { id: uid('con'), name: '', kind: 'customer', email: '', phone: '', address: '', taxId: '', notes: '' };
  baseDialog({
    title: isNew ? 'Neuer Kontakt' : 'Kontakt bearbeiten',
    body: html`
      <div class="field"><label>Name *</label><input id="f_name" value="${esc(c.name)}"></div>
      <div class="field"><label>Art</label>
        <select id="f_kind">
          <option value="customer" ${c.kind === 'customer' ? 'selected' : ''}>Kunde</option>
          <option value="supplier" ${c.kind === 'supplier' ? 'selected' : ''}>Lieferant</option>
          <option value="both" ${c.kind === 'both' ? 'selected' : ''}>Kunde und Lieferant</option>
        </select>
      </div>
      <div class="field"><label>E-Mail</label><input id="f_email" value="${esc(c.email || '')}"></div>
      <div class="field"><label>Telefon</label><input id="f_phone" value="${esc(c.phone || '')}"></div>
      <div class="field"><label>Anschrift</label><textarea id="f_address">${esc(c.address || '')}</textarea></div>
      <div class="field"><label>Steuernummer / USt-IdNr.</label><input id="f_taxId" value="${esc(c.taxId || '')}"></div>
      <div class="field"><label>Notiz</label><textarea id="f_notes">${esc(c.notes || '')}</textarea></div>`,
    onSave: async (rootEl) => {
      const g = (k) => rootEl.querySelector('#f_' + k).value.trim();
      if (!g('name')) { warn('Bitte einen Namen eintragen'); return false; }
      await upsertEntity('contacts', {
        ...c, name: g('name'), kind: rootEl.querySelector('#f_kind').value,
        email: g('email'), phone: g('phone'), address: g('address'), taxId: g('taxId'), notes: g('notes'),
      }, 'kontakt');
      ok('Kontakt gespeichert');
    },
  });
}

function accountForm(a) {
  const isNew = !a;
  a = a || { id: uid('acc'), name: '', kind: 'bank', iban: '', openingBalance: 0, openingDate: `${new Date().getFullYear()}-01-01`, skr03: '1200', skr04: '1800', active: true };
  baseDialog({
    title: isNew ? 'Neues Zahlungskonto' : 'Konto bearbeiten',
    body: html`
      <div class="field"><label>Name *</label><input id="f_name" value="${esc(a.name)}" placeholder="z. B. Geschäftskonto Sparkasse"></div>
      <div class="field"><label>Art</label>
        <select id="f_kind">
          <option value="bank" ${a.kind === 'bank' ? 'selected' : ''}>Bankkonto</option>
          <option value="cash" ${a.kind === 'cash' ? 'selected' : ''}>Kasse (Bargeld)</option>
          <option value="other" ${a.kind === 'other' ? 'selected' : ''}>Sonstiges (PayPal, Kreditkarte …)</option>
        </select>
      </div>
      <div class="field"><label>IBAN</label><input id="f_iban" value="${esc(a.iban || '')}"></div>
      <div class="form-grid">
        <div class="field"><label>Anfangsbestand</label><input class="money-input" id="f_openingBalance" value="${moneyInput(a.openingBalance)}"></div>
        <div class="field"><label>Gültig ab</label><input type="date" id="f_openingDate" value="${a.openingDate || ''}"></div>
        <div class="field"><label>Konto SKR03</label><input id="f_skr03" value="${esc(a.skr03 || '')}"></div>
        <div class="field"><label>Konto SKR04</label><input id="f_skr04" value="${esc(a.skr04 || '')}"></div>
      </div>`,
    onSave: async (rootEl) => {
      const g = (k) => rootEl.querySelector('#f_' + k);
      if (!g('name').value.trim()) { warn('Bitte einen Namen eintragen'); return false; }
      await upsertEntity('accounts', {
        ...a, name: g('name').value.trim(), kind: g('kind').value, iban: g('iban').value.trim(),
        openingBalance: parseMoney(g('openingBalance').value), openingDate: g('openingDate').value,
        skr03: g('skr03').value.trim(), skr04: g('skr04').value.trim(),
      }, 'konto');
      ok('Konto gespeichert');
    },
  });
}

function assetForm(a) {
  const isNew = !a;
  a = a || { id: uid('ass'), name: '', cost: 0, purchaseDate: todayISO(), usefulLifeYears: 3, method: 'linear' };
  baseDialog({
    title: isNew ? 'Neues Anlagegut' : 'Anlagegut bearbeiten',
    body: html`
      <div class="field"><label>Bezeichnung *</label><input id="f_name" value="${esc(a.name)}"></div>
      <div class="field"><label>Anschaffungskosten (netto)</label><input class="money-input" id="f_cost" value="${moneyInput(a.cost)}"></div>
      <div class="field"><label>Anschaffungsdatum</label><input type="date" id="f_purchaseDate" value="${a.purchaseDate}"></div>
      <div class="field"><label>Nutzungsdauer in Jahren</label>
        <input type="number" id="f_usefulLifeYears" min="1" max="50" step="1" value="${a.usefulLifeYears}">
        <span class="hint">Übliche Werte: Computer 3, Maschinen 5–8, Pkw 6, Büromöbel 13 Jahre.
        Verbindlich sind die AfA-Tabellen des Bundesfinanzministeriums.</span>
      </div>`,
    onSave: async (rootEl) => {
      const g = (k) => rootEl.querySelector('#f_' + k);
      const name = g('name').value.trim();
      const cost = parseMoney(g('cost').value);
      if (!name || !cost) { warn('Bezeichnung und Kosten werden benötigt'); return false; }
      if (cost <= 80000) {
        const yes = await confirmDialog({
          title: 'Unter 800 € netto',
          text: 'Wirtschaftsgüter bis 800 € netto dürfen als geringwertiges Wirtschaftsgut sofort in voller Höhe abgezogen werden. Wollen Sie es trotzdem über mehrere Jahre abschreiben?',
          confirmLabel: 'Trotzdem abschreiben',
        });
        if (!yes) return false;
      }
      await upsertEntity('assets', {
        ...a, name, cost,
        purchaseDate: g('purchaseDate').value || todayISO(),
        usefulLifeYears: Math.max(1, Number(g('usefulLifeYears').value) || 1),
      }, 'anlage');
      ok('Anlagegut gespeichert');
    },
  });
}
