/**
 * Kontovia – Reiter „Kassenbuch“ und „Vorschau“ der Auswertungen (views/reports.js).
 *
 * Kassenbuch: je Barkasse die Bewegungen des Zeitraums nach Tagen, mit laufender Nummer, Tagessummen und
 * Bestand, Warnung bei Fehlbestand an einem Tagesende, Kassensturz (gezählten Bestand festhalten, Differenz
 * als Buchung vorschlagen). Rechnung: lib/kasse.js; PDF: lib/reports.js (kassenbuchPdf).
 *
 * Vorschau: Kontostand der nächsten Wochen aus offenen Posten, Wiederkehrendem und Umsatzsteuer
 * (lib/liquiditaet.js), als Wochendiagramm und Liste der erwarteten Zahlungen.
 */

import { html, raw, esc, $, $$, money, moneyInput, parseMoney, fmtDate, todayISO } from '../lib/util.js';
import { icon, ok, err, modal, statCard, emptyState } from '../lib/ui.js';
import { store, commit, newTransactionDraft } from '../lib/store.js';
import { kassen, kassenbuch, zaehlung, bestandAm, STUECKELUNG, zaehlSumme } from '../lib/kasse.js';
import { liquiditaetsVorschau } from '../lib/liquiditaet.js';
import { openTransactionDialog } from './transactions.js';

let kasseId = '';
let horizont = 90;

/** Für das PDF der Auswertungen: die gewählte Kasse und der Zeitraum der Vorschau. */
export const gewaehlteKasse = () => kasseId;
export const vorschauHorizont = () => horizont;

/* -------------------------------------------------------------------------- */
/* Kassenbuch                                                                  */
/* -------------------------------------------------------------------------- */

export function kassenbuchZeigen(root, db, period, neuZeichnen) {
  const liste = kassen(db);
  if (!liste.length) {
    root.innerHTML = html`${emptyState('Keine Kasse angelegt', 'Legen Sie unter Stammdaten ein Konto der Art „Kasse“ an. Dann führt Kontovia hier das Kassenbuch.')}`;
    return;
  }
  if (!liste.some((k) => k.id === kasseId)) kasseId = liste[0].id;
  const kasse = liste.find((k) => k.id === kasseId);
  const kb = kassenbuch(db, kasse, period.from, period.to);
  const offen = kb.zaehlungen.filter((z) => z.differenz !== 0);

  root.innerHTML = html`
    ${liste.length > 1 ? raw(html`<div class="seg mb16" role="group" aria-label="Kasse" id="kbKassen">${liste.map((k) => raw(html`<button type="button" data-kasse="${k.id}" class="${k.id === kasseId ? 'active' : ''}" aria-pressed="${k.id === kasseId}">${k.name}</button>`))}</div>`) : ''}
    <div class="grid c4 mb16">
      ${statCard({ label: `Anfangsbestand ${fmtDate(period.from)}`, value: `${money(kb.opening)} €`, icon: 'euro' })}
      ${statCard({ label: 'Einnahmen', value: `${money(kb.einnahmen)} €`, tone: 'pos', icon: 'plus' })}
      ${statCard({ label: 'Ausgaben', value: `${money(kb.ausgaben)} €`, tone: 'neg', icon: 'minus' })}
      ${statCard({ label: `Endbestand ${fmtDate(period.to)}`, value: `${money(kb.closing)} €`, tone: kb.closing < 0 ? 'neg' : '', icon: 'euro' })}
    </div>
    ${kb.fehltage.length ? raw(html`<div class="notice warn mb16"><strong>Fehlbestand.</strong> ${kb.fehltage.length === 1
    ? `Am ${fmtDate(kb.fehltage[0])} lag der Bestand am Abend unter null.`
    : `An ${kb.fehltage.length} Tagen lag der Bestand am Abend unter null, zuerst am ${fmtDate(kb.fehltage[0])}.`}
      Eine Kasse kann nicht weniger als nichts enthalten; meist fehlt eine Einnahme oder eine Einlage, oder eine Ausgabe ging über das Bankkonto.</div>`) : ''}
    ${offen.length ? raw(html`<div class="notice warn mb16">Beim Zählen am ${fmtDate(offen[offen.length - 1].datum)} wich der Bestand um ${money(offen[offen.length - 1].differenz)} € vom Kassenbuch ab.</div>`) : ''}
    <div class="row wrap gap8 mb16">
      <button type="button" class="btn" id="kbZaehlen">${icon('sum', 15)} Kasse zählen</button>
      <button type="button" class="btn ghost" id="kbNeu">${icon('plus', 15)} Barbewegung erfassen</button>
    </div>
    <div class="card">
      <div class="card-head"><h2>${kasse.name}</h2><span class="sub">Kassenbuch, ${kb.tage.length === 1 ? '1 Tag mit Bewegungen' : `${kb.tage.length} Tage mit Bewegungen`}</span></div>
      <div class="table-wrap"><table class="data compact kb-tabelle">
        <thead><tr><th class="num">Nr.</th><th>Datum</th><th>Vorgang</th><th>Beleg</th><th class="num">Einnahme</th><th class="num">Ausgabe</th><th class="num">Bestand</th></tr></thead>
        <tbody>
          <tr><td></td><td colspan="5" class="muted">Anfangsbestand am ${fmtDate(period.from)}</td><td class="num">${money(kb.opening)}</td></tr>
          ${kb.tage.map((t) => raw(html`
            ${t.zeilen.map((z) => raw(html`<tr class="clickable" data-tx="${z.tx.id}">
              <td class="num muted">${z.nr}</td><td class="nowrap">${fmtDate(t.datum)}</td>
              <td class="truncate kb-text">${z.tx.description || ''}</td>
              <td class="small muted">${z.tx.invoiceNumber || (z.tx.attachments?.length ? 'Beleg' : '')}</td>
              <td class="num amount pos">${z.ein ? money(z.ein) : ''}</td><td class="num amount neg">${z.aus ? money(z.aus) : ''}</td>
              <td class="num">${money(z.bestand)}</td></tr>`))}
            <tr class="kb-tag ${t.endbestand < 0 ? 'neg' : ''}"><td></td><td colspan="3">${`Tagesabschluss ${fmtDate(t.datum)}`}</td>
              <td class="num">${money(t.ein)}</td><td class="num">${money(t.aus)}</td><td class="num strong">${money(t.endbestand)}</td></tr>`))}
        </tbody>
        <tfoot><tr><td></td><td colspan="5">Endbestand am ${fmtDate(period.to)}</td><td class="num">${money(kb.closing)}</td></tr></tfoot>
      </table></div>
      ${kb.zaehlungen.length ? raw(html`<div class="card-body"><h3 class="mt0">Gezählt</h3><ul class="re-buchungen">${kb.zaehlungen.map((z) => raw(html`<li><span>${fmtDate(z.datum)}${z.notiz ? ` · ${z.notiz}` : ''}</span>
        <span class="num">${money(z.gezaehlt)} €</span><span class="badge ${z.differenz ? 'warn' : 'pos'}">${z.differenz ? `Differenz ${money(z.differenz)} €` : 'stimmt'}</span></li>`))}</ul></div>`) : ''}
      <div class="card-body small muted">Kasseneinnahmen und -ausgaben sollen täglich festgehalten werden (§ 146 Abs. 1 AO). Ein Fehler wird nicht gelöscht, sondern storniert; das Journal hält jede Änderung fest.</div>
    </div>`;

  $$('[data-kasse]', root).forEach((b) => b.addEventListener('click', () => { kasseId = b.dataset.kasse; neuZeichnen(); }));
  $$('[data-tx]', root).forEach((tr) => tr.addEventListener('click', () => openTransactionDialog(tr.dataset.tx, 'expense', { onSaved: neuZeichnen })));
  $('#kbNeu', root).addEventListener('click', () => {
    const tx = newTransactionDraft('expense');
    tx.accountId = kasse.id;
    openTransactionDialog(tx, 'expense', { onSaved: neuZeichnen });
  });
  $('#kbZaehlen', root).addEventListener('click', () => zaehlenDialog(kasse, neuZeichnen));
}

/** Kassensturz: gezählten Bestand eintragen (gesamt oder nach Stückelung), festhalten, Differenz anbieten. */
function zaehlenDialog(kasse, neuZeichnen) {
  const heute = todayISO();
  const name = (w) => (w >= 100 ? `${w / 100} €` : `${w} ct`);
  const m = modal({
    title: `${kasse.name} zählen`,
    body: html`
      <div class="form-grid">
        <div class="field"><label for="kzDatum">Datum</label><input id="kzDatum" type="date" value="${heute}" max="${heute}"></div>
        <div class="field"><label for="kzBetrag">Gezählter Bestand €</label><input id="kzBetrag" inputmode="decimal" placeholder="0,00"></div>
      </div>
      <details class="mehr-details mb16"><summary>Nach Scheinen und Münzen zählen</summary>
        <div class="kz-stueck mt8">${STUECKELUNG.map((w) => raw(html`<label class="kz-feld"><span class="small muted">${name(w)}</span><input type="number" min="0" max="100000" data-wert="${w}" aria-label="${`Anzahl ${name(w)}`}"></label>`))}</div>
      </details>
      <div class="field"><label for="kzNotiz">Notiz (freiwillig)</label><input id="kzNotiz" maxlength="200" placeholder="z. B. Tagesabschluss"></div>
      <p class="small mb0" id="kzVergleich" role="status"></p>`,
    foot: html`<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Zählung festhalten</button>`,
  });
  const $m = (s) => m.root.querySelector(s);
  const buch = () => bestandAm(store.db, kasse, $m('#kzDatum').value || heute);
  const gezaehlt = () => parseMoney($m('#kzBetrag').value) || 0;
  const zeigen = () => {
    const d = gezaehlt() - buch();
    $m('#kzVergleich').textContent = d === 0 ? `Laut Kassenbuch: ${money(buch())} €. Der Bestand stimmt.` : `Laut Kassenbuch: ${money(buch())} €. Differenz: ${money(d)} €.`;
  };
  $$('[data-wert]', m.root).forEach((f) => f.addEventListener('input', () => {
    const anzahl = Object.fromEntries($$('[data-wert]', m.root).map((x) => [x.dataset.wert, x.value]));
    $m('#kzBetrag').value = moneyInput(zaehlSumme(anzahl));
    zeigen();
  }));
  $m('#kzBetrag').addEventListener('input', zeigen);
  $m('#kzDatum').addEventListener('input', zeigen);
  zeigen();
  $m('[data-no]').addEventListener('click', () => m.close());
  $m('[data-yes]').addEventListener('click', async () => {
    const datum = $m('#kzDatum').value || heute;
    const z = zaehlung(datum, gezaehlt(), $m('#kzNotiz').value.trim());
    const differenz = z.betrag - buch();
    try {
      await commit('kasse.zaehlung', (db) => {
        const k = db.accounts.find((a) => a.id === kasse.id);
        if (!k) return;
        k.zaehlungen = [...(k.zaehlungen || []), z];
        k.updatedAt = new Date().toISOString();
      }, { entity: 'konto', entityId: kasse.id, summary: differenz ? `Kasse gezählt am ${datum}: ${money(z.betrag)} €, Differenz ${money(differenz)} €` : `Kasse gezählt am ${datum}: ${money(z.betrag)} €` });
      m.close();
      if (!differenz) { ok('Zählung festgehalten', 'Der Bestand stimmt.'); neuZeichnen(); return; }
      ok('Zählung festgehalten', `Differenz ${money(differenz)} €`);
      // Die Differenz als Buchung vorschlagen: Fehlbetrag als Ausgabe, Überschuss als Einnahme; der Nutzer prüft und speichert.
      const art = differenz < 0 ? 'expense' : 'income';
      const tx = newTransactionDraft(art);
      Object.assign(tx, { accountId: kasse.id, date: datum, paidDate: datum, description: 'Kassendifferenz', gross: Math.abs(differenz), net: Math.abs(differenz), vat: 0, vatRate: 0 });
      openTransactionDialog(tx, art, { onSaved: neuZeichnen });
    } catch (e) { err('Nicht festgehalten', e.message); }
  });
}

/* -------------------------------------------------------------------------- */
/* Vorschau                                                                    */
/* -------------------------------------------------------------------------- */

export function vorschauZeigen(root, db, neuZeichnen) {
  const v = liquiditaetsVorschau(db, { tage: horizont });
  const ueber = v.posten.filter((p) => p.ueberfaellig);
  root.innerHTML = html`
    <div class="row wrap gap8 mb16">
      <div class="seg" role="group" aria-label="Zeitraum der Vorschau" id="lqH">
        ${[[30, '30 Tage'], [90, '3 Monate'], [180, '6 Monate']].map(([n, t]) => raw(html`<button type="button" data-h="${n}" class="${n === horizont ? 'active' : ''}" aria-pressed="${n === horizont}">${t}</button>`))}
      </div>
    </div>
    <div class="grid c4 mb16">
      ${statCard({ label: 'Heute auf allen Konten', value: `${money(v.start)} €`, icon: 'bank' })}
      ${statCard({ label: 'Erwartete Eingänge', value: `${money(v.einnahmen)} €`, tone: 'pos', icon: 'plus' })}
      ${statCard({ label: 'Erwartete Ausgänge', value: `${money(v.ausgaben)} €`, tone: 'neg', icon: 'minus' })}
      ${statCard({ label: `Stand am ${fmtDate(v.wochen[v.wochen.length - 1]?.bis || todayISO())}`, value: `${money(v.ende)} €`, tone: v.ende < 0 ? 'neg' : '', icon: 'chart' })}
    </div>
    ${v.tiefpunkt.bestand < 0 ? raw(html`<div class="notice warn mb16"><strong>Engpass absehbar.</strong> Am ${fmtDate(v.tiefpunkt.datum)} läge der Stand bei ${money(v.tiefpunkt.bestand)} €. Fordern Sie offene Beträge an oder verschieben Sie Ausgaben.</div>`)
    : v.tiefpunkt.bestand < v.start ? raw(html`<div class="notice mb16">Tiefster Stand: ${money(v.tiefpunkt.bestand)} € am ${fmtDate(v.tiefpunkt.datum)}.</div>`) : ''}
    ${ueber.length ? raw(html`<div class="notice mb16 small">${ueber.length === 1 ? 'Ein überfälliger Betrag ist in einer Woche eingeplant. Ob er kommt, ist offen.' : `${ueber.length} überfällige Beträge sind in einer Woche eingeplant. Ob sie kommen, ist offen.`}</div>`) : ''}
    <div class="card mb16"><div class="card-head"><h2>Stand je Woche</h2><span class="sub">Säule: Stand am Ende der Woche</span></div>
      <div class="card-body">${raw(wochenDiagramm(v.wochen))}</div></div>
    <div class="card"><div class="card-head"><h2>Erwartete Zahlungen</h2><span class="sub">${v.posten.length === 1 ? '1 Posten' : `${v.posten.length} Posten`}</span></div>
      ${v.posten.length ? raw(html`<div class="table-wrap"><table class="data compact">
        <thead><tr><th>Datum</th><th>Vorgang</th><th>Art</th><th class="num">Betrag</th><th class="num">Stand danach</th></tr></thead>
        <tbody>${v.posten.slice(0, 300).map((p) => raw(html`<tr>
          <td class="nowrap">${fmtDate(p.datum)}${p.ueberfaellig ? raw(' <span class="badge warn">überfällig</span>') : ''}</td>
          <td class="truncate">${p.text}</td><td class="small muted">${ART[p.art] || ''}</td>
          <td class="num amount ${p.betrag < 0 ? 'neg' : 'pos'}">${money(p.betrag)}</td><td class="num ${p.bestand < 0 ? 'neg' : ''}">${money(p.bestand)}</td></tr>`))}</tbody>
      </table></div>`) : raw(html`<div class="card-body muted">Keine offenen Posten, nichts Wiederkehrendes und keine Steuerzahlung in diesem Zeitraum.</div>`)}
      <div class="card-body small muted">Gerechnet wird nur mit dem, was in Kontovia steht: offene Einnahmen und Ausgaben zu ihrer Fälligkeit, wiederkehrende Buchungen und Rechnungen, die Umsatzsteuer-Zahllast der Voranmeldungen. Neue Aufträge kennt die Vorschau nicht.</div>
    </div>`;
  $$('[data-h]', root).forEach((b) => b.addEventListener('click', () => { horizont = Number(b.dataset.h); neuZeichnen(); }));
}

const ART = { forderung: 'offene Einnahme', verbindlichkeit: 'offene Ausgabe', wiederkehrend: 'wiederkehrend', steuer: 'Umsatzsteuer' };

/** Kleines Säulendiagramm (SVG) des Stands am Ende jeder Woche; negative Wochen in Rot. */
function wochenDiagramm(wochen) {
  if (!wochen.length) return '';
  const W = 720;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 26 };
  const werte = wochen.map((w) => w.bestand);
  const max = Math.max(0, ...werte);
  const min = Math.min(0, ...werte);
  const spanne = max - min || 1;
  const y = (v) => pad.t + ((max - v) / spanne) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / wochen.length;
  const bw = Math.max(3, Math.min(28, slot * 0.6));
  const jede = Math.max(1, Math.ceil(wochen.length / 9));
  let s = `<line class="lq-null" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  wochen.forEach((w, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    const y0 = y(0);
    const y1 = y(w.bestand);
    s += `<rect class="lq-saeule${w.bestand < 0 ? ' neg' : ''}" x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="2"><title>${esc(`${fmtDate(w.von)} bis ${fmtDate(w.bis)}: ${money(w.bestand)} €`)}</title></rect>`;
    if (i % jede === 0) s += `<text class="lq-achse" x="${(pad.l + slot * i + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(fmtDate(w.von).slice(0, 6))}</text>`;
  });
  return `<svg class="chart lq-diagramm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc('Kontostand am Ende jeder Woche')}">${s}</svg>`;
}

