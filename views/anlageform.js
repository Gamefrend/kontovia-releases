/**
 * Kontovia – Eingabemaske für ein Anlagegut.
 *
 * Gebraucht beim Erfassen einer Ausgabe („Als Anlagegut abschreiben“) und in
 * den Stammdaten. Bis Fassung 1.7 gab es zwei Masken mit verschiedenen
 * Vorschlägen – in einer stand der Kopierer mit acht statt sieben Jahren, in
 * beiden der Computer mit drei Jahren, obwohl seit 2021 ein Jahr genügt.
 * Seit 2.27 mit Art (Zeile der EÜR) und, bei bestehenden Gütern, dem Abgang
 * (Verkauf, Entnahme, Verschrottung; calc.js: restbuchwert).
 */

import { html, raw, esc, moneyInput, parseMoney, todayISO, fmtDate, money, uid } from '../lib/util.js';
import { confirmDialog, warn } from '../lib/ui.js';
import { store, isLockedDate, lockedUntil } from '../lib/store.js';
import { degressivMoeglich, degressivSatz, DEGRESSIV_FENSTER, isKleinunternehmer, restbuchwert } from '../lib/calc.js';

/** Arten von Anlagegütern, je mit eigener Zeile der Anlage EÜR (calc.js: afaZeile). */
const ARTEN = [
  ['beweglich', 'Beweglich (Geräte, Möbel, Fahrzeuge)'],
  ['immateriell', 'Immateriell (Software, Lizenzen, Rechte)'],
  ['unbeweglich', 'Gebäude und Grundstücksteile'],
];
/** Wie ein Gut ausscheidet (seit 2.27). */
const ABGANG = [['verkauf', 'Verkauft'], ['entnahme', 'Ins Privatvermögen übernommen'], ['verschrottung', 'Verschrottet oder verloren']];

const fensterText = () => DEGRESSIV_FENSTER.map((f) => `${fmtDate(f.von)} bis ${fmtDate(f.bis)} (höchstens ${Math.round(f.satz * 100)} %)`).join(', ');

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
  const klein = isKleinunternehmer(store.db, a.purchaseDate || todayISO());
  const gesperrt = bestehend && anlageGesperrt(a);
  const zu = gesperrt ? 'disabled' : '';
  const methode = a.method === 'sofort' || a.method === 'degressiv' ? a.method : 'linear';
  const abgangFest = !!a.abgang?.datum && isLockedDate(a.abgang.datum);
  return html`
    ${gesperrt ? raw(`<div class="notice warn mb16">Die Anschaffung liegt im festgeschriebenen Zeitraum
      (bis ${esc(fmtDate(lockedUntil()))}). Kosten, Datum und Abschreibung bleiben deshalb so, wie sie
      erklärt wurden; nur die Bezeichnung und ein späterer Abgang lassen sich noch eintragen.</div>`) : ''}
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
    <p class="hint mt0" id="a_hint" aria-live="polite"></p>
    <div class="field">
      <label for="a_art">Art des Wirtschaftsguts</label>
      <select id="a_art" ${zu}>${raw(ARTEN.map(([v, t]) => `<option value="${v}" ${(a.art || 'beweglich') === v ? 'selected' : ''}>${esc(t)}</option>`).join(''))}</select>
      <span class="hint">Bestimmt die Zeile der Anlage EÜR für die Abschreibung.</span>
    </div>
    ${bestehend ? raw(`<details class="mt8" ${a.abgang?.datum ? 'open' : ''}>
      <summary class="small" style="cursor:pointer;padding:6px 0">Verkauft, entnommen oder verschrottet?</summary>
      ${abgangFest ? `<div class="notice warn mt8">Der Abgang liegt im festgeschriebenen Zeitraum und bleibt so.</div>` : ''}
      <div class="form-grid mt8">
        <div class="field"><label for="a_abgangDatum">Ausgeschieden am</label><input type="date" id="a_abgangDatum" value="${esc(a.abgang?.datum || '')}" ${abgangFest ? 'disabled' : ''}></div>
        <div class="field"><label for="a_abgangArt">Wie</label><select id="a_abgangArt" ${abgangFest ? 'disabled' : ''}>${ABGANG.map(([v, t]) => `<option value="${v}" ${a.abgang?.art === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <p class="hint mt0">Abgeschrieben wird bis einschließlich des Monats, in dem das Gut ausscheidet. Was übrig ist, steht als Restbuchwert in der Anlage EÜR.
      Den Verkaufserlös oder bei einer Übernahme ins Privatvermögen den Wert buchen Sie als Einnahme in der Kategorie „Verkauf von Anlagevermögen“.
      ${a.abgang?.datum && restbuchwert(a) ? `Restbuchwert: ${esc(money(restbuchwert(a).amount))} €.` : ''}</p>
    </details>`) : ''}`;
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
      const satz2 = Math.round(degressivSatz(jahre, datum) * 1000) / 10;
      text = degressivMoeglich(datum)
        ? `${String(satz2).replace('.', ',')} % vom jeweiligen Restwert, im ersten Jahr anteilig nach Monaten; sobald die lineare Rate höher ist, wechselt Kontovia zu ihr (§ 7 Abs. 2 und 3 EStG).`
          + (jahre < 4 ? ' Bei unter vier Jahren Nutzungsdauer bringt degressiv nichts, es bleibt praktisch linear.' : '')
        : `Degressiv nur für bewegliche Wirtschaftsgüter, angeschafft ${fensterText()}.`;
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
  const abgang = abgangAusFeldern(g, a);
  if (abgang === false) return null;
  // Festgeschrieben: nur der Name und ein späterer Abgang dürfen sich ändern.
  if (bestehend && anlageGesperrt(a)) return mitAbgang({ ...a, name }, abgang);

  const cost = parseMoney(g('cost').value);
  const purchaseDate = g('date').value || todayISO();
  const method = g('method').value;
  const art = g('art')?.value || 'beweglich';
  const usefulLifeYears = method === 'sofort' ? 1 : Math.max(1, Math.min(50, Math.round(Number(g('life').value) || 1)));
  if (cost <= 0) { warn('Bitte die Anschaffungskosten eintragen'); g('cost').focus(); return null; }
  if (isLockedDate(purchaseDate)) {
    warn('Zeitraum ist festgeschrieben', `Bis ${fmtDate(lockedUntil())} lässt sich kein Anlagegut mehr anschaffen. Bitte ein späteres Datum wählen.`);
    return null;
  }
  if (method === 'degressiv' && (art !== 'beweglich' || !degressivMoeglich(purchaseDate))) {
    warn('Degressiv hier nicht möglich', `Nur für bewegliche Wirtschaftsgüter, angeschafft ${fensterText()}.`);
    return null;
  }
  if (abgang && abgang.datum < purchaseDate) { warn('Abgang vor der Anschaffung', 'Bitte das Datum des Abgangs prüfen.'); return null; }
  // Die Grenze gilt netto, auch für Kleinunternehmer, die brutto erfassen (R 9b Abs. 2 EStR); dort mit 19 % herausgerechnet.
  const netto = isKleinunternehmer(store.db, purchaseDate) ? Math.round(cost / 1.19) : cost;
  if (netto <= 80000 && method !== 'sofort') {
    const trotzdem = await confirmDialog({
      title: 'Bis 800 € netto',
      text: `Das Wirtschaftsgut kostet ${money(cost)} €. Wirtschaftsgüter bis 800 € netto dürfen als geringwertiges Wirtschaftsgut sofort in voller Höhe abgezogen werden (§ 6 Abs. 2 EStG). Trotzdem über mehrere Jahre abschreiben?`,
      confirmLabel: 'Trotzdem abschreiben',
    });
    if (!trotzdem) return null;
  }
  return mitAbgang({ ...a, name, cost, purchaseDate, usefulLifeYears, method, art }, abgang);
}

/** Der Abgang aus den Feldern: null = keiner, false = ungültig (Hinweis gezeigt). */
function abgangAusFeldern(g, a) {
  const feld = g('abgangDatum');
  if (!feld) return a.abgang?.datum ? a.abgang : null;
  if (feld.disabled) return a.abgang;
  const datum = feld.value;
  if (!datum) return null;
  if (isLockedDate(datum)) {
    warn('Zeitraum ist festgeschrieben', `Bis ${fmtDate(lockedUntil())} lässt sich kein Abgang mehr eintragen. Bitte ein späteres Datum wählen.`);
    return false;
  }
  return { datum, art: g('abgangArt')?.value || 'verkauf' };
}

function mitAbgang(x, abgang) {
  if (abgang) x.abgang = abgang;
  else delete x.abgang;
  return x;
}
