/**
 * Kontovia – Eingabemaske für ein Anlagegut.
 *
 * Gebraucht beim Erfassen einer Ausgabe („Als Anlagegut abschreiben“) und in
 * den Stammdaten. Bis Fassung 1.7 gab es zwei Masken mit verschiedenen
 * Vorschlägen – in einer stand der Kopierer mit acht statt sieben Jahren, in
 * beiden der Computer mit drei Jahren, obwohl seit 2021 ein Jahr genügt.
 */

import { html, raw, esc, moneyInput, parseMoney, todayISO, fmtDate, money, uid } from '../lib/util.js';
import { confirmDialog, warn } from '../lib/ui.js';
import { store, isLockedDate, lockedUntil } from '../lib/store.js';
import { degressivMoeglich, degressivSatz, DEGRESSIV_VON, DEGRESSIV_BIS } from '../lib/calc.js';

/**
 * Übliche Nutzungsdauern nach der amtlichen AfA-Tabelle für allgemein
 * verwendbare Anlagegüter – bewusst nur solche, die sich dort eindeutig
 * nachlesen lassen. „sofort“ ist die Regel für Computerhardware und Software
 * (BMF-Schreiben vom 22.02.2022): ein Jahr, auf Wunsch voll im Anschaffungsjahr.
 */
const TYPISCH = [
  ['sofort', 'Computer, Notebook, Tablet, Drucker, Software (1 Jahr)'],
  ['5', 'Mobiltelefon (5 Jahre)'],
  ['6', 'Pkw (6 Jahre)'],
  ['7', 'Kopiergerät (7 Jahre)'],
  ['13', 'Büromöbel (13 Jahre)'],
];

export function neuesAnlagegut(preset = {}) {
  return { id: uid('ass'), name: '', cost: 0, purchaseDate: todayISO(), usefulLifeYears: 3, method: 'linear', ...preset };
}

/**
 * Liegt die Anschaffung im festgeschriebenen Zeitraum? Dann stehen Kosten,
 * Datum und Abschreibung fest: Jede Änderung verschöbe die Abschreibung
 * erklärter Jahre, und die Anlage EÜR eines abgeschlossenen Jahres sähe
 * nachträglich anders aus.
 */
export function anlageGesperrt(a) {
  return !!a?.purchaseDate && isLockedDate(a.purchaseDate);
}

/** HTML der Felder. `bestehend`: ein schon gespeichertes Anlagegut. */
export function anlageFelder(a, { bestehend = false } = {}) {
  const klein = store.db.settings.taxMode === 'kleinunternehmer';
  const gesperrt = bestehend && anlageGesperrt(a);
  const zu = gesperrt ? 'disabled' : '';
  const methode = a.method === 'sofort' || a.method === 'degressiv' ? a.method : 'linear';
  return html`
    ${gesperrt ? raw(`<div class="notice warn mb16">Die Anschaffung liegt im festgeschriebenen Zeitraum
      (bis ${esc(fmtDate(lockedUntil()))}). Kosten, Datum und Abschreibung bleiben deshalb so, wie sie
      erklärt wurden; nur die Bezeichnung lässt sich noch ändern.</div>`) : ''}
    <div class="field"><label for="a_name">Bezeichnung *</label><input id="a_name" value="${a.name || ''}"></div>
    <div class="form-grid">
      <div class="field">
        <label for="a_cost">Anschaffungskosten (${klein ? 'brutto' : 'netto'})</label>
        <input class="money-input" id="a_cost" inputmode="decimal" value="${moneyInput(a.cost || 0)}" ${zu}>
      </div>
      <div class="field">
        <label for="a_date">Anschaffungsdatum</label>
        <input type="date" id="a_date" value="${a.purchaseDate || todayISO()}" ${zu}>
      </div>
    </div>
    <div class="field">
      <label for="a_typ">Übliche Werte</label>
      <select id="a_typ" ${zu}>
        <option value="">Wirtschaftsgut wählen, um die Nutzungsdauer zu übernehmen</option>
        ${raw(TYPISCH.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join(''))}
      </select>
      <span class="hint">Nach der amtlichen AfA-Tabelle; für anderes dort nachschlagen oder mit der Steuerberatung klären.</span>
    </div>
    <div class="form-grid">
      <div class="field">
        <label for="a_method">Abschreibung</label>
        <select id="a_method" ${zu}>
          <option value="linear" ${methode === 'linear' ? 'selected' : ''}>linear (gleiche Beträge)</option>
          <option value="degressiv" ${methode === 'degressiv' ? 'selected' : ''}>degressiv (fallend, höchstens 30 %)</option>
          <option value="sofort" ${methode === 'sofort' ? 'selected' : ''}>1 Jahr (voll im Anschaffungsjahr)</option>
        </select>
      </div>
      <div class="field">
        <label for="a_life">Nutzungsdauer in Jahren</label>
        <input type="number" id="a_life" min="1" max="50" step="1" value="${methode === 'sofort' ? 1 : (a.usefulLifeYears || 1)}" ${zu}>
      </div>
    </div>
    <p class="hint mt0" id="a_hint" aria-live="polite"></p>`;
}

/** Verdrahtet Vorschläge und Hinweistext. */
export function wireAnlageFelder(root) {
  const g = (id) => root.querySelector('#a_' + id);
  const hinweis = () => {
    const methode = g('method').value;
    const jahre = Math.max(1, Number(g('life').value) || 1);
    const datum = g('date').value;
    g('life').disabled = g('method').disabled || methode === 'sofort';
    let text;
    if (methode === 'sofort') {
      text = 'Computerhardware und Software: ein Jahr Nutzungsdauer, der volle Betrag im Anschaffungsjahr (BMF-Schreiben vom 22.02.2022).';
    } else if (methode === 'degressiv') {
      const satz = Math.round(degressivSatz(jahre) * 1000) / 10;
      text = degressivMoeglich(datum)
        ? `${String(satz).replace('.', ',')} % vom jeweiligen Restwert, im ersten Jahr anteilig nach Monaten; sobald die lineare Rate höher ist, wechselt Kontovia zu ihr (§ 7 Abs. 2 und 3 EStG).`
          + (jahre < 4 ? ' Bei unter vier Jahren Nutzungsdauer bringt degressiv nichts, es bleibt praktisch linear.' : '')
        : `Degressiv nur für Anschaffungen vom ${fmtDate(DEGRESSIV_VON)} bis ${fmtDate(DEGRESSIV_BIS)} (bewegliche Wirtschaftsgüter).`;
    } else {
      text = `${String(Math.round(1000 / jahre) / 10).replace('.', ',')} % je Jahr, monatsgenau ab dem Anschaffungsmonat (§ 7 Abs. 1 EStG).`;
    }
    g('hint').textContent = text;
  };
  g('typ').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    if (v === 'sofort') { g('method').value = 'sofort'; g('life').value = '1'; }
    else {
      if (g('method').value === 'sofort') g('method').value = 'linear';
      g('life').value = v;
    }
    hinweis();
  });
  for (const id of ['method', 'life', 'date']) {
    g(id).addEventListener('input', hinweis);
    g(id).addEventListener('change', hinweis);
  }
  hinweis();
}

/**
 * Liest die Felder und prüft sie. Liefert das Anlagegut oder null, wenn etwas
 * fehlt oder die Nutzerin den Vorgang abbricht.
 */
export async function anlageAusFeldern(root, a, { bestehend = false } = {}) {
  const g = (id) => root.querySelector('#a_' + id);
  const name = g('name').value.trim();
  if (!name) { warn('Bitte eine Bezeichnung eintragen'); g('name').focus(); return null; }
  // Festgeschrieben: nur der Name darf sich ändern.
  if (bestehend && anlageGesperrt(a)) return { ...a, name };

  const cost = parseMoney(g('cost').value);
  const purchaseDate = g('date').value || todayISO();
  const method = g('method').value;
  const usefulLifeYears = method === 'sofort' ? 1 : Math.max(1, Math.min(50, Math.round(Number(g('life').value) || 1)));
  if (cost <= 0) { warn('Bitte die Anschaffungskosten eintragen'); g('cost').focus(); return null; }
  if (isLockedDate(purchaseDate)) {
    warn('Zeitraum ist festgeschrieben', `Bis ${fmtDate(lockedUntil())} lässt sich kein Anlagegut mehr anschaffen. Bitte ein späteres Datum wählen.`);
    return null;
  }
  if (method === 'degressiv' && !degressivMoeglich(purchaseDate)) {
    warn('Degressiv hier nicht möglich', `Nur für Anschaffungen vom ${fmtDate(DEGRESSIV_VON)} bis ${fmtDate(DEGRESSIV_BIS)}.`);
    return null;
  }
  if (cost <= 80000 && method !== 'sofort') {
    const trotzdem = await confirmDialog({
      title: 'Bis 800 € netto',
      text: `Das Wirtschaftsgut kostet ${money(cost)} €. Wirtschaftsgüter bis 800 € netto dürfen als geringwertiges Wirtschaftsgut sofort in voller Höhe abgezogen werden (§ 6 Abs. 2 EStG). Trotzdem über mehrere Jahre abschreiben?`,
      confirmLabel: 'Trotzdem abschreiben',
    });
    if (!trotzdem) return null;
  }
  return { ...a, name, cost, purchaseDate, usefulLifeYears, method };
}
