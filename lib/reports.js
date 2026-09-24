/**
 * Kontovia – druckfertige Berichte.
 *
 * Erzeugt vollständige HTML-Dokumente, die der Hauptprozess in einem
 * unsichtbaren Fenster rendert und als PDF ausgibt. Das Dokument enthält
 * keinerlei Skripte; alle Diagramme sind reines SVG.
 */

import { esc, money, fmtDate, fmtDateLong, todayISO, int, sum, ymLabel } from './util.js';
import {
  periodReport, euerReport, vatReturn, balanceSheet, openItems, accountBalances,
  isKleinunternehmer, basisOf, depreciationInRange, bookValue, depositInfo, averages,
} from './calc.js';
import { periodLabel } from './period.js';

const CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5pt; color: #14181d; margin: 0; line-height: 1.45; }
  h1 { font-size: 18pt; margin: 0 0 2mm; letter-spacing: -.3px; }
  h2 { font-size: 12pt; margin: 8mm 0 2mm; padding-bottom: 1.5mm; border-bottom: 1.2pt solid #14181d; }
  h3 { font-size: 10.5pt; margin: 5mm 0 1.5mm; color: #333; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2pt solid #14181d; padding-bottom: 3mm; margin-bottom: 4mm; }
  .doc-head .who { font-size: 9pt; color: #444; text-align: right; line-height: 1.4; }
  .doc-head .who strong { color: #14181d; font-size: 10pt; }
  .sub { color: #555; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .03em; color: #555; border-bottom: .8pt solid #999; padding: 1.6mm 2mm; }
  td { padding: 1.5mm 2mm; border-bottom: .4pt solid #dfe3e9; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { border-top: 1pt solid #14181d; border-bottom: 2.4pt double #14181d; font-weight: 700; padding-top: 2mm; }
  tr.sub-total td { border-top: .8pt solid #999; font-weight: 600; }
  tr.group td { background: #f1f3f6; font-weight: 600; }
  .kpis { display: flex; gap: 4mm; margin: 4mm 0; }
  .kpi { flex: 1; border: .8pt solid #cfd5dd; border-radius: 2mm; padding: 3mm; }
  .kpi .l { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: .04em; }
  .kpi .v { font-size: 14pt; font-weight: 700; margin-top: 1mm; font-variant-numeric: tabular-nums; }
  .pos { color: #0d7a52; } .neg { color: #b83c34; }
  .note { font-size: 8.5pt; color: #555; border-left: 2pt solid #cfd5dd; padding: 1.5mm 0 1.5mm 3mm; margin: 4mm 0; line-height: 1.5; }
  .note strong { color: #14181d; }
  .sig { margin-top: 14mm; display: flex; gap: 14mm; }
  .sig div { flex: 1; border-top: .6pt solid #666; padding-top: 1.5mm; font-size: 8.5pt; color: #555; }
  .muted { color: #666; }
  .small { font-size: 8.5pt; }
  .avoid-break { break-inside: avoid; }
  .pagebreak { break-before: page; }
`;

function docHead(settings, title, subtitle) {
  const addr = [settings.companyName, settings.ownerName, settings.street, [settings.zip, settings.city].filter(Boolean).join(' ')]
    .filter(Boolean).map(esc).join('<br>');
  const tax = [
    settings.taxNumber ? `Steuernummer: ${esc(settings.taxNumber)}` : '',
    settings.vatId ? `USt-IdNr.: ${esc(settings.vatId)}` : '',
  ].filter(Boolean).join('<br>');
  return `
    <div class="doc-head">
      <div>
        <h1>${esc(title)}</h1>
        <div class="sub">${esc(subtitle)}</div>
      </div>
      <div class="who"><strong>${addr || 'Ohne Firmenangabe'}</strong>${tax ? '<br>' + tax : ''}</div>
    </div>`;
}

function shell(settings, title, subtitle, bodyHtml, footNote = '') {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
    <body>
      ${docHead(settings, title, subtitle)}
      ${bodyHtml}
      <div class="note">
        Erstellt am ${esc(fmtDateLong(todayISO()))} mit Kontovia, berechnet aus den erfassten
        Buchungen nach festen Rechenregeln; an der Berechnung wirkt keine künstliche Intelligenz
        mit. Eine Arbeitshilfe – bitte vor der Übernahme prüfen.
        ${footNote}
      </div>
    </body></html>`;
}

const row = (label, value, cls = '') =>
  `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(money(value))}</td></tr>`;

/* -------------------------------------------------------------------------- */
/* Gewinn- und Verlustrechnung                                                 */
/* -------------------------------------------------------------------------- */

export function guvReport(db, period) {
  const s = db.settings;
  const klein = isKleinunternehmer(db);
  const r = periodReport(db, period.from, period.to);
  const basisText = basisOf(db) === 'ist' ? 'Zufluss-/Abflussprinzip (§ 11 EStG)' : 'Sollversteuerung nach Rechnungsdatum';

  const incomeRows = r.byCategory.filter((c) => c.kind === 'income');
  const expenseRows = r.byCategory.filter((c) => c.kind === 'expense');

  const body = `
    <div class="kpis">
      <div class="kpi"><div class="l">Betriebseinnahmen</div><div class="v pos">${esc(money(r.incomeForProfit))} €</div></div>
      <div class="kpi"><div class="l">Betriebsausgaben</div><div class="v neg">${esc(money(r.expenseForProfit))} €</div></div>
      <div class="kpi"><div class="l">${r.profit >= 0 ? 'Gewinn' : 'Verlust'}</div><div class="v ${r.profit >= 0 ? 'pos' : 'neg'}">${esc(money(r.profit))} €</div></div>
    </div>

    <h2>Betriebseinnahmen</h2>
    <table>
      <thead><tr><th>Kategorie</th><th class="num">Anzahl</th>${klein ? '' : '<th class="num">Umsatzsteuer</th>'}<th class="num">${klein ? 'Betrag' : 'Netto'}</th></tr></thead>
      <tbody>
        ${incomeRows.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${int(c.count)}</td>${klein ? '' : `<td class="num muted">${esc(money(c.vat))}</td>`}<td class="num">${esc(money(c.amount))}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">Keine Einnahmen im Zeitraum</td></tr>'}
        <tr class="total"><td>Summe Betriebseinnahmen</td><td class="num">${int(r.countIncome)}</td>${klein ? '' : `<td class="num">${esc(money(r.incomeVat))}</td>`}<td class="num">${esc(money(r.incomeForProfit))}</td></tr>
      </tbody>
    </table>

    <h2>Betriebsausgaben</h2>
    <table>
      <thead><tr><th>Kategorie</th><th class="num">Anzahl</th>${klein ? '' : '<th class="num">Vorsteuer</th>'}<th class="num">${klein ? 'Betrag' : 'Netto'}</th></tr></thead>
      <tbody>
        ${expenseRows.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${int(c.count)}</td>${klein ? '' : `<td class="num muted">${esc(money(c.vat))}</td>`}<td class="num">${esc(money(c.amount))}</td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">Keine Ausgaben im Zeitraum</td></tr>'}
        ${r.depreciation ? `<tr><td>Abschreibungen (AfA)</td><td class="num">${int((db.assets || []).length)}</td>${klein ? '' : '<td class="num muted">–</td>'}<td class="num">${esc(money(r.depreciation))}</td></tr>` : ''}
        <tr class="total"><td>Summe Betriebsausgaben</td><td class="num">${int(r.countExpense)}</td>${klein ? '' : `<td class="num">${esc(money(r.expenseVat))}</td>`}<td class="num">${esc(money(r.expenseForProfit))}</td></tr>
      </tbody>
    </table>

    <h2>Ergebnis</h2>
    <table>
      <tbody>
        ${row('Betriebseinnahmen', r.incomeForProfit)}
        ${row('abzüglich Betriebsausgaben', -r.expenseForProfit)}
        <tr class="total"><td>${r.profit >= 0 ? 'Gewinn' : 'Verlust'} vor Steuern</td><td class="num">${esc(money(r.profit))}</td></tr>
        ${r.expenseDeductible !== r.expenseForProfit
          ? `<tr class="sub-total"><td>Steuerlich abziehbare Ausgaben (nach Kürzung, z. B. Bewirtung 70 %)</td><td class="num">${esc(money(r.expenseDeductible))}</td></tr>
             <tr class="total"><td>Steuerliches Ergebnis</td><td class="num">${esc(money(r.taxableProfit))}</td></tr>` : ''}
      </tbody>
    </table>

    ${r.privateIn || r.privateOut ? `
    <h3>Nachrichtlich: Privatvorgänge (nicht im Ergebnis enthalten)</h3>
    <table><tbody>
      ${row('Privateinlagen', r.privateIn)}
      ${row('Privatentnahmen', r.privateOut)}
    </tbody></table>` : ''}

    ${r.vatRemitted || r.vatRefunded ? `
    <h3>Nachrichtlich: Umsatzsteuer-Verrechnung mit dem Finanzamt</h3>
    <table><tbody>
      ${row('Im Zeitraum an das Finanzamt gezahlt', r.vatRemitted)}
      ${r.vatRefunded ? row('Vom Finanzamt erstattet', r.vatRefunded) : ''}
      ${row('Danach noch offene Zahllast des Zeitraums', r.vatOutstanding)}
    </tbody></table>
    <div class="note">
      Diese Zahlungen gleichen nur das Umsatzsteuerkonto aus und sind in der
      Nettobetrachtung weder Ertrag noch Aufwand. In der Anlage EÜR erscheinen
      sie dagegen in eigenen Zeilen (55 und 56).
    </div>` : ''}

    ${monthTable(r)}

    <div class="note">
      <strong>Wie diese Zahlen zustande kommen.</strong>
      Grundlage ist das ${esc(basisText)}.
      ${klein
        ? 'Als Kleinunternehmer nach § 19 UStG wird durchgehend mit Bruttobeträgen gerechnet; ein Vorsteuerabzug findet nicht statt.'
        : 'Einnahmen und Ausgaben sind netto ausgewiesen. Die Umsatzsteuer ist ein durchlaufender Posten und in der Umsatzsteuer-Voranmeldung abgebildet.'}
      Anschaffungen über 800 € netto gehen nicht sofort, sondern über die Abschreibung in das Ergebnis ein.
    </div>`;

  return shell(s, 'Gewinn- und Verlustrechnung', periodLabel(period), body,
    'Diese Aufstellung ist eine betriebswirtschaftliche Auswertung und ersetzt keine Steuererklärung.');
}

function monthTable(r) {
  if (r.months.length < 2) return '';
  const avg = averages(r);
  return `
    <h2 class="avoid-break">Monatsübersicht</h2>
    <table class="avoid-break">
      <thead><tr><th>Monat</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num">Ergebnis</th></tr></thead>
      <tbody>
        ${r.months.map((m) => `<tr>
          <td>${esc(ymLabel(m.ym))}</td>
          <td class="num">${esc(money(m.income))}</td>
          <td class="num">${esc(money(m.expense))}</td>
          <td class="num ${m.profit >= 0 ? 'pos' : 'neg'}">${esc(money(m.profit))}</td>
        </tr>`).join('')}
        <tr class="total">
          <td>Summe</td>
          <td class="num">${esc(money(sum(r.months, (m) => m.income)))}</td>
          <td class="num">${esc(money(sum(r.months, (m) => m.expense)))}</td>
          <td class="num">${esc(money(sum(r.months, (m) => m.profit)))}</td>
        </tr>
        ${avg.months ? `<tr class="sub-total">
          <td>Durchschnitt je Monat <span class="muted small">(${avg.months} Monate)</span></td>
          <td class="num">${esc(money(avg.income))}</td>
          <td class="num">${esc(money(avg.expense))}</td>
          <td class="num">${esc(money(avg.profit))}</td>
        </tr>` : ''}
      </tbody>
    </table>`;
}

/* -------------------------------------------------------------------------- */
/* Anlage EÜR                                                                  */
/* -------------------------------------------------------------------------- */

export function euerPdf(db, period) {
  const e = euerReport(db, period.from, period.to);
  const body = `
    <div class="note">
      <strong>So übertragen Sie die Werte.</strong> Die linke Spalte nennt die Zeilennummer
      der amtlichen Anlage EÜR. Öffnen Sie in „Mein ELSTER“ das Formular
      „Einnahmenüberschussrechnung (Anlage EÜR)“ und tragen Sie die Beträge in die
      gleichnamigen Zeilen ein. Prüfen Sie die Zeilennummern gegen das Formular
      des jeweiligen Jahres – sie ändern sich gelegentlich.
    </div>

    <h2>Betriebseinnahmen</h2>
    <table>
      <thead><tr><th style="width:16mm">Zeile</th><th>Bezeichnung</th><th class="num" style="width:32mm">Betrag in €</th></tr></thead>
      <tbody>
        ${e.income.map((r) => `<tr><td class="num">${r.line}</td><td>${esc(r.label)}</td><td class="num">${esc(money(r.amount))}</td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">Keine Einnahmen im Zeitraum</td></tr>'}
        <tr class="total"><td class="num">22</td><td>Summe Betriebseinnahmen</td><td class="num">${esc(money(e.incomeTotal))}</td></tr>
      </tbody>
    </table>

    <h2>Betriebsausgaben</h2>
    <table>
      <thead><tr><th style="width:16mm">Zeile</th><th>Bezeichnung</th><th class="num" style="width:32mm">Betrag in €</th></tr></thead>
      <tbody>
        ${e.expense.map((r) => `<tr><td class="num">${r.line}</td><td>${esc(r.label)}</td><td class="num">${esc(money(r.amount))}</td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">Keine Ausgaben im Zeitraum</td></tr>'}
        <tr class="total"><td class="num">71</td><td>Summe Betriebsausgaben</td><td class="num">${esc(money(e.expenseTotal))}</td></tr>
      </tbody>
    </table>

    <h2>Ergebnis</h2>
    <table><tbody>
      <tr class="total"><td class="num" style="width:16mm">72</td><td>${e.profit >= 0 ? 'Steuerpflichtiger Gewinn' : 'Verlust'}</td><td class="num" style="width:32mm">${esc(money(e.profit))}</td></tr>
    </tbody></table>

    ${!e.kleinunternehmer && e.reconciliation.vatFlow ? `
    <h3>Überleitung zum Ergebnis der Gewinn- und Verlustrechnung</h3>
    <table><tbody>
      ${row('Ergebnis ohne Umsatzsteuer (Nettobetrachtung)', e.reconciliation.netResult)}
      ${row('zuzüglich vereinnahmte Umsatzsteuer (Zeile 16)', e.reconciliation.vatCollected)}
      ${e.reconciliation.vatRefunded ? row('zuzüglich Erstattung vom Finanzamt (Zeile 17)', e.reconciliation.vatRefunded) : ''}
      ${row('abzüglich gezahlte Vorsteuer (Zeile 55)', -e.reconciliation.vatDeducted)}
      ${row('abzüglich an das Finanzamt gezahlte Umsatzsteuer (Zeile 56)', -e.reconciliation.vatRemitted)}
      <tr class="total"><td>Gewinn laut Anlage EÜR</td><td class="num">${esc(money(e.profit))}</td></tr>
    </tbody></table>
    <div class="note">
      In der Einnahmen-Überschuss-Rechnung ist die Umsatzsteuer ein durchlaufender Posten,
      der zeitversetzt wirkt: Sie erhöht den Gewinn, bis die Zahllast an das Finanzamt
      überwiesen und als Betriebsausgabe erfasst ist. Über das Jahr gleicht sich das aus.
    </div>` : ''}

    ${assetTable(db, period)}`;

  return shell(db.settings, 'Anlage EÜR – Zeilenzuordnung', periodLabel(period), body,
    'Kontovia übermittelt nichts an die Finanzverwaltung. Die Übertragung nach ELSTER nehmen Sie selbst vor.');
}

/** Anlagenverzeichnis als eigenständiger Bericht. */
export function assetsPdf(db, period) {
  const assets = db.assets || [];
  const body = assets.length
    ? assetTable(db, period, false)
    : '<p class="muted">Kein Anlagevermögen erfasst.</p>';
  return shell(db.settings, 'Anlagenverzeichnis', periodLabel(period), body,
    'Lineare Abschreibung, monatsgenau ab dem Anschaffungsmonat (§ 7 Abs. 1 Satz 4 EStG). Maßgeblich sind die amtlichen AfA-Tabellen.');
}

function assetTable(db, period, pagebreak = true) {
  const assets = db.assets || [];
  if (!assets.length) return '';
  return `
    <h2${pagebreak ? ' class="pagebreak"' : ''}>Anlagenverzeichnis (§ 4 Abs. 3 Satz 5 EStG)</h2>
    <table>
      <thead><tr>
        <th>Wirtschaftsgut</th><th class="num">Anschaffung</th><th class="num">Kosten</th>
        <th class="num">Nutzungsdauer</th><th class="num">AfA im Zeitraum</th><th class="num">Restbuchwert</th>
      </tr></thead>
      <tbody>
        ${assets.map((a) => `<tr>
          <td>${esc(a.name)}</td>
          <td class="num">${esc(fmtDate(a.purchaseDate))}</td>
          <td class="num">${esc(money(a.cost))}</td>
          <td class="num">${esc(a.usefulLifeYears)} J.</td>
          <td class="num">${esc(money(depreciationInRange(a, period.from, period.to)))}</td>
          <td class="num">${esc(money(bookValue(a, period.to)))}</td>
        </tr>`).join('')}
        <tr class="total">
          <td colspan="2">Summe</td>
          <td class="num">${esc(money(sum(assets, (a) => a.cost)))}</td>
          <td></td>
          <td class="num">${esc(money(sum(assets, (a) => depreciationInRange(a, period.from, period.to))))}</td>
          <td class="num">${esc(money(sum(assets, (a) => bookValue(a, period.to))))}</td>
        </tr>
      </tbody>
    </table>`;
}

/* -------------------------------------------------------------------------- */
/* Umsatzsteuer-Voranmeldung                                                   */
/* -------------------------------------------------------------------------- */

export function ustvaPdf(db, period) {
  const v = vatReturn(db, period.from, period.to);
  if (v.kleinunternehmer) {
    return shell(db.settings, 'Umsatzsteuer', periodLabel(period),
      `<div class="note"><strong>Kleinunternehmerregelung.</strong> Sie führen nach § 19 UStG keine
       Umsatzsteuer ab und melden keine Voranmeldungen. In Ihren Rechnungen darf keine
       Umsatzsteuer ausgewiesen sein.</div>`);
  }

  const line = (kz, label, value, bold = false) =>
    `<tr class="${bold ? 'sub-total' : ''}"><td class="num" style="width:16mm">${kz}</td><td>${esc(label)}</td><td class="num" style="width:32mm">${esc(money(value))}</td></tr>`;

  const body = `
    <div class="note">
      <strong>Übertragung nach ELSTER.</strong> Die Nummern links sind die amtlichen
      Kennzahlen des Formulars „Umsatzsteuer-Voranmeldung“. Tragen Sie die Beträge in
      die gleichnamigen Felder ein. Bemessungsgrundlagen werden ohne Nachkommastellen
      abgerundet erwartet, Steuerbeträge mit zwei Nachkommastellen.
    </div>

    <h2>Steuerpflichtige Umsätze (Bemessungsgrundlagen)</h2>
    <table><tbody>
      ${line(81, 'Umsätze zum Steuersatz von 19 %', v.kz81net)}
      ${line(86, 'Umsätze zum Steuersatz von 7 %', v.kz86net)}
      ${v.kz35net ? line(35, 'Umsätze zu anderen Steuersätzen', v.kz35net) : ''}
      ${v.kz41 ? line(41, 'Innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.', v.kz41) : ''}
      ${v.kz21 ? line(21, 'Nicht steuerbare sonstige Leistungen (§ 18b Satz 1 Nr. 2 UStG)', v.kz21) : ''}
      ${v.kz48 ? line(48, 'Steuerfreie Umsätze ohne Vorsteuerabzug', v.kz48) : ''}
      ${v.kz89net ? line(89, 'Innergemeinschaftliche Erwerbe zum Steuersatz von 19 %', v.kz89net) : ''}
      ${v.kz46net ? line(46, 'Leistungen, für die der Leistungsempfänger die Steuer schuldet (§ 13b)', v.kz46net) : ''}
    </tbody></table>

    <h2>Steuerbeträge</h2>
    <table><tbody>
      ${line('', 'Umsatzsteuer auf Umsätze 19 %', v.kz81tax)}
      ${line('', 'Umsatzsteuer auf Umsätze 7 %', v.kz86tax)}
      ${v.kz36tax ? line(36, 'Umsatzsteuer zu anderen Steuersätzen', v.kz36tax) : ''}
      ${v.kz89tax ? line('', 'Umsatzsteuer aus innergemeinschaftlichen Erwerben', v.kz89tax) : ''}
      ${v.kz47tax ? line(47, 'Umsatzsteuer aus Leistungen nach § 13b', v.kz47tax) : ''}
      <tr class="sub-total"><td></td><td>Umsatzsteuer gesamt</td><td class="num">${esc(money(v.umsatzsteuer))}</td></tr>
    </tbody></table>

    <h2>Abziehbare Vorsteuer</h2>
    <table><tbody>
      ${line(66, 'Vorsteuerbeträge aus Rechnungen von anderen Unternehmern', v.kz66)}
      ${v.kz61 ? line(61, 'Vorsteuer aus innergemeinschaftlichen Erwerben', v.kz61) : ''}
      ${v.kz67 ? line(67, 'Vorsteuer aus Leistungen nach § 13b', v.kz67) : ''}
      <tr class="sub-total"><td></td><td>Vorsteuer gesamt</td><td class="num">${esc(money(v.vorsteuer))}</td></tr>
    </tbody></table>

    <h2>Ergebnis</h2>
    <table><tbody>
      <tr class="total"><td class="num" style="width:16mm">83</td>
        <td>${v.kz83 >= 0 ? 'Verbleibende Umsatzsteuer-Vorauszahlung (an das Finanzamt)' : 'Verbleibender Überschuss (Erstattung durch das Finanzamt)'}</td>
        <td class="num" style="width:32mm">${esc(money(v.kz83))}</td></tr>
    </tbody></table>

    <div class="note">
      Berechnet nach dem ${basisOf(db) === 'ist' ? 'Ist-Prinzip (Besteuerung nach vereinnahmten Entgelten, § 20 UStG)' : 'Soll-Prinzip (vereinbarte Entgelte)'}.
      Die Voranmeldung ist bis zum 10. Tag nach Ablauf des Voranmeldungszeitraums zu übermitteln;
      bei genehmigter Dauerfristverlängerung einen Monat später.
    </div>`;

  return shell(db.settings, 'Umsatzsteuer-Voranmeldung', periodLabel(period), body);
}

/* -------------------------------------------------------------------------- */
/* Vermögensübersicht                                                          */
/* -------------------------------------------------------------------------- */

export function balancePdf(db, period) {
  const b = balanceSheet(db, period.to);
  const body = `
    <div class="kpis">
      <div class="kpi"><div class="l">Vermögen</div><div class="v">${esc(money(b.activa.total))} €</div></div>
      <div class="kpi"><div class="l">Schulden</div><div class="v neg">${esc(money(b.passiva.payables + b.passiva.vatLiability))} €</div></div>
      <div class="kpi"><div class="l">Reinvermögen</div><div class="v ${b.passiva.equity >= 0 ? 'pos' : 'neg'}">${esc(money(b.passiva.equity))} €</div></div>
    </div>

    <h2>Vermögen (Aktiva)</h2>
    <table><tbody>
      <tr class="group"><td colspan="2">Anlagevermögen</td></tr>
      ${(b.activa.assets || []).map((a) => `<tr><td>${esc(a.name)} <span class="muted small">(Anschaffung ${esc(fmtDate(a.purchaseDate))})</span></td><td class="num">${esc(money(a.bookValue))}</td></tr>`).join('')
        || '<tr><td class="muted">Kein Anlagevermögen erfasst</td><td class="num">0,00</td></tr>'}
      <tr class="sub-total"><td>Summe Anlagevermögen</td><td class="num">${esc(money(b.activa.fixedAssets))}</td></tr>

      <tr class="group"><td colspan="2">Umlaufvermögen</td></tr>
      ${row('Forderungen aus Lieferungen und Leistungen', b.activa.receivables)}
      ${(b.activa.accounts || []).map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${esc(money(a.balance))}</td></tr>`).join('')}
      <tr class="sub-total"><td>Summe Umlaufvermögen</td><td class="num">${esc(money(b.activa.receivables + b.activa.cash))}</td></tr>

      <tr class="total"><td>Summe Vermögen</td><td class="num">${esc(money(b.activa.total))}</td></tr>
    </tbody></table>

    <h2>Schulden und Reinvermögen (Passiva)</h2>
    <table><tbody>
      ${row('Verbindlichkeiten aus Lieferungen und Leistungen', b.passiva.payables)}
      ${b.passiva.vatLiability ? row('Umsatzsteuer-Zahllast (laufendes Jahr)', b.passiva.vatLiability) : ''}
      ${b.passiva.vatClaim ? row('nachrichtlich: Vorsteuer-Erstattungsanspruch', b.passiva.vatClaim) : ''}
      <tr class="sub-total"><td>Summe Schulden</td><td class="num">${esc(money(b.passiva.payables + b.passiva.vatLiability))}</td></tr>
      <tr><td>Reinvermögen (Eigenkapital)</td><td class="num">${esc(money(b.passiva.equity))}</td></tr>
      <tr class="total"><td>Summe Passiva</td><td class="num">${esc(money(b.passiva.total))}</td></tr>
    </tbody></table>

    <h2>Entwicklung des Eigenkapitals im laufenden Jahr</h2>
    <table><tbody>
      ${row('Ergebnis seit Jahresbeginn', b.equityDevelopment.profitYtd)}
      ${row('Privateinlagen', b.equityDevelopment.deposits)}
      ${row('Privatentnahmen', -b.equityDevelopment.withdrawals)}
      <tr class="total"><td>Veränderung</td><td class="num">${esc(money(b.equityDevelopment.profitYtd + b.equityDevelopment.deposits - b.equityDevelopment.withdrawals))}</td></tr>
    </tbody></table>

    <div class="note">
      <strong>Was diese Übersicht ist – und was nicht.</strong>
      Bei einer Einnahmen-Überschuss-Rechnung besteht keine Pflicht zur Bilanzierung.
      Diese Gegenüberstellung zeigt, was dem Betrieb zum Stichtag gehört und was er schuldet.
      Sie folgt nicht der Gliederung des § 266 HGB und ersetzt keine handelsrechtliche Bilanz.
      Das Reinvermögen ergibt sich rechnerisch als Vermögen abzüglich Schulden.
    </div>`;

  return shell(db.settings, 'Vermögensübersicht', `Stichtag ${fmtDateLong(period.to)}`, body);
}

/* -------------------------------------------------------------------------- */
/* Journal und offene Posten                                                   */
/* -------------------------------------------------------------------------- */

/** Ort und Anzahlung stehen im Journal als Zusatz hinter der Beschreibung. */
function journalHints(t) {
  const teile = [];
  if (t.location) teile.push(t.location);
  const dep = depositInfo(t);
  if (dep?.percent) {
    teile.push(`Anzahlung ${String(dep.percent).replace('.', ',')} %`
      + (dep.eventDate ? `, Termin ${fmtDate(dep.eventDate)}` : ''));
  }
  return teile.length ? ` <span class="muted small">· ${esc(teile.join(' · '))}</span>` : '';
}

export function journalPdf(db, period, rows) {
  const klein = isKleinunternehmer(db);
  const list = rows || db.transactions
    .filter((t) => t.date >= period.from && t.date <= period.to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));

  const totalIn = sum(list.filter((t) => t.type === 'income' && !t.voided), (t) => t.gross);
  const totalOut = sum(list.filter((t) => t.type === 'expense' && !t.voided), (t) => t.gross);

  const body = `
    <table>
      <thead><tr>
        <th style="width:18mm">Datum</th><th style="width:20mm">Beleg-Nr.</th><th>Beschreibung</th>
        <th>Kategorie</th><th style="width:18mm">Zahlung</th>
        ${klein ? '' : '<th class="num" style="width:20mm">Netto</th><th class="num" style="width:18mm">USt</th>'}
        <th class="num" style="width:22mm">Brutto</th>
      </tr></thead>
      <tbody>
        ${list.map((t) => `<tr${t.voided ? ' style="opacity:.5;text-decoration:line-through"' : ''}>
          <td class="num">${esc(fmtDate(t.date))}</td>
          <td class="small">${esc(t.invoiceNumber || '')}</td>
          <td>${esc(t.description)}${journalHints(t)}${(t.attachments || []).length ? ' <span class="muted small">[Beleg]</span>' : ''}</td>
          <td class="small">${esc(catName(db, t.categoryId))}</td>
          <td class="small num">${t.paidDate ? esc(fmtDate(t.paidDate)) : '<span class="muted">offen</span>'}</td>
          ${klein ? '' : `<td class="num">${esc(money(t.net))}</td><td class="num muted">${esc(money(t.vat))}</td>`}
          <td class="num ${t.type === 'income' ? 'pos' : 'neg'}">${t.type === 'income' ? '+' : '−'} ${esc(money(Math.abs(t.gross)))}</td>
        </tr>`).join('') || `<tr><td colspan="8" class="muted">Keine Buchungen im Zeitraum</td></tr>`}
        <tr class="total">
          <td colspan="${klein ? 5 : 7}">Summe Einnahmen ${esc(money(totalIn))} € · Summe Ausgaben ${esc(money(totalOut))} €</td>
          <td class="num">${esc(money(totalIn - totalOut))}</td>
        </tr>
      </tbody>
    </table>
    <div class="note">
      Vollständige Auflistung aller Geschäftsvorfälle im Zeitraum in zeitlicher Reihenfolge
      (Grundbuchfunktion). Stornierte Buchungen sind durchgestrichen dargestellt und bleiben
      zusammen mit ihrer Gegenbuchung nachvollziehbar erhalten.
    </div>`;

  return shell(db.settings, 'Buchungsjournal', periodLabel(period), body);
}

function catName(db, id) {
  return db.categories.find((c) => c.id === id)?.name || '–';
}

export function openItemsPdf(db, asOf = todayISO()) {
  const o = openItems(db, asOf);
  const tbl = (items, title, kind) => `
    <h2>${title}</h2>
    <table>
      <thead><tr><th style="width:18mm">Datum</th><th style="width:20mm">Beleg-Nr.</th><th>Beschreibung</th><th>${kind === 'income' ? 'Kunde' : 'Lieferant'}</th><th style="width:18mm">Fällig</th><th class="num" style="width:16mm">Tage</th><th class="num" style="width:22mm">Betrag</th></tr></thead>
      <tbody>
        ${items.map((t) => `<tr>
          <td class="num">${esc(fmtDate(t.date))}</td>
          <td class="small">${esc(t.invoiceNumber || '')}</td>
          <td>${esc(t.description)}</td>
          <td class="small">${esc(db.contacts.find((c) => c.id === t.contactId)?.name || '')}</td>
          <td class="num">${esc(fmtDate(t.dueDate))}</td>
          <td class="num ${t.overdue ? 'neg' : ''}">${t.overdue ? '+' + t.overdueDays : '–'}</td>
          <td class="num">${esc(money(t.gross))}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="muted">Nichts offen</td></tr>'}
        <tr class="total"><td colspan="6">Summe</td><td class="num">${esc(money(sum(items, (t) => t.gross)))}</td></tr>
      </tbody>
    </table>`;

  const aging = (a, title) => `
    <h3>${title}</h3>
    <table><tbody>
      ${row('nicht fällig', a.current)}
      ${row('1 – 30 Tage überfällig', a.d30)}
      ${row('31 – 60 Tage überfällig', a.d60)}
      ${row('61 – 90 Tage überfällig', a.d90)}
      ${row('über 90 Tage überfällig', a.older)}
    </tbody></table>`;

  const body = tbl(o.receivables, 'Forderungen – von Kunden noch nicht bezahlt', 'income')
    + aging(o.receivableAging, 'Altersstruktur der Forderungen')
    + tbl(o.payables, 'Verbindlichkeiten – von Ihnen noch nicht bezahlt', 'expense')
    + aging(o.payableAging, 'Altersstruktur der Verbindlichkeiten');

  return shell(db.settings, 'Offene Posten', `Stichtag ${fmtDateLong(asOf)}`, body);
}

/* -------------------------------------------------------------------------- */
/* Kontenblatt                                                                 */
/* -------------------------------------------------------------------------- */

export function accountsPdf(db, period) {
  const accounts = accountBalances(db, period.to);
  const body = accounts.map((acc) => {
    const rows = db.transactions
      .filter((t) => !t.voided && t.accountId === acc.id && t.paidDate && t.paidDate >= period.from && t.paidDate <= period.to)
      .sort((a, b) => a.paidDate.localeCompare(b.paidDate));
    let running = Number(acc.openingBalance) || 0;
    for (const t of db.transactions) {
      if (t.voided || t.accountId !== acc.id || !t.paidDate || t.paidDate >= period.from) continue;
      running += t.type === 'income' ? t.gross : -t.gross;
    }
    const opening = running;
    return `
      <h2 class="avoid-break">${esc(acc.name)} <span class="muted small">(${esc(acc.kind === 'bank' ? 'Bankkonto' : 'Kasse')}${acc.iban ? ', ' + esc(acc.iban) : ''})</span></h2>
      <table>
        <thead><tr><th style="width:18mm">Datum</th><th>Vorgang</th><th class="num" style="width:22mm">Eingang</th><th class="num" style="width:22mm">Ausgang</th><th class="num" style="width:24mm">Saldo</th></tr></thead>
        <tbody>
          <tr class="group"><td colspan="4">Anfangsbestand am ${esc(fmtDate(period.from))}</td><td class="num">${esc(money(opening))}</td></tr>
          ${rows.map((t) => {
            running += t.type === 'income' ? t.gross : -t.gross;
            return `<tr>
              <td class="num">${esc(fmtDate(t.paidDate))}</td>
              <td>${esc(t.description)}</td>
              <td class="num pos">${t.type === 'income' ? esc(money(t.gross)) : ''}</td>
              <td class="num neg">${t.type === 'expense' ? esc(money(t.gross)) : ''}</td>
              <td class="num">${esc(money(running))}</td>
            </tr>`;
          }).join('')}
          <tr class="total"><td colspan="4">Endbestand am ${esc(fmtDate(period.to))}</td><td class="num">${esc(money(running))}</td></tr>
        </tbody>
      </table>`;
  }).join('');

  return shell(db.settings, 'Kontenblätter', periodLabel(period), body || '<p class="muted">Keine Konten angelegt.</p>');
}

/* -------------------------------------------------------------------------- */
/* Kompletter Jahresbericht                                                    */
/* -------------------------------------------------------------------------- */

export function yearPackPdf(db, period) {
  const parts = [
    guvReport(db, period),
    euerPdf(db, period),
    ustvaPdf(db, period),
    balancePdf(db, period),
    openItemsPdf(db, period.to),
    journalPdf(db, period),
  ];
  // Nur der Körper der Folgeseiten wird übernommen, jeweils auf neuer Seite.
  const bodies = parts.map((p, i) => {
    const inner = p.replace(/^[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*$/, '');
    return i === 0 ? inner : `<div class="pagebreak"></div>${inner}`;
  });
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Jahresunterlagen</title><style>${CSS}</style></head><body>${bodies.join('\n')}</body></html>`;
}
