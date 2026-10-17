/** Kontovia – Buchungen erfassen, suchen, bearbeiten. */

import {
  html, raw, esc, $, money, moneyInput, parseMoney, fmtDate, todayISO, uid,
  sortBy, sum, bytes, splitFromGross, splitFromNet, addDays, int, hueOf, norm, dz,
} from '../lib/util.js';
import { icon, ok, err, warn, modal, confirmDialog, amountCell, emptyState } from '../lib/ui.js';
import { erlaubt } from '../lib/lizenzui.js';
import { kann } from '../lib/lizenz.js';
import {
  store, sel, upsertTransaction, deleteTransaction, voidTransaction, isLockedDate, lockedUntil,
  newTransactionDraft, commit, nextInvoiceNumber, upsertEntity, removeAttachmentRecord, restAusbuchen,
} from '../lib/store.js';
import { defaultPeriod, periodControl } from '../lib/period.js';
import { mountTable, tableState } from '../lib/table.js';
import { router, refresh, navigate } from '../lib/router.js';
import { fokusMerken } from '../lib/fokus.js';
import { vatTreatment, depositInfo, isVoidPart, formLine, formYear, afaMethod, AFA_METHODE, isKleinunternehmer, ohneUst, ohneUstEinstellung } from '../lib/calc.js';
import { neuesAnlagegut, anlageFelder, wireAnlageFelder, anlageAusFeldern } from './anlageform.js';
import { eRechnungLesen, eRechnungAusDatei, xmlAusPdf, richtung } from '../lib/erechnung.js';
import { eRechnungHtml, zeigeERechnung } from './erechnung.js';
import { belegErkennen, lesbar as belegLesbar } from '../lib/belegerkennung.js';
import { WAEHRUNGEN, istFremd, kursGueltig, kursLesen, kursEingabe, inEuro } from '../lib/waehrung.js';
import { regelAusBuchung, TURNUS } from '../lib/wiederkehrend.js';
import { ratenAnzahl, ratenPlan, ratenBuchungen, MAX_RATEN } from '../lib/raten.js';
import { satzBuchungen, satzSumme, weitereTeile, doppelterSatz, SAETZE, MAX_SAETZE } from '../lib/steuersaetze.js';
import {
  EU_SAETZE, ossSaetze, ossRegelsatz, ossLand, ossArt, OSS_ARTEN, differenzSteuer, DIFFERENZ_SATZ, gutscheinEinloesung, privatnutzung, KFZ_ANTRIEB,
  fahrtBetrag, KM_SATZ, FAHRT_ZEILE,
} from '../lib/sonderfaelle.js';
import { LAENDER } from '../lib/rechnung.js';
import { faelligeAnbieten } from './wiederkehrend.js';
import { aufgabenAbschnitt } from './todos.js';
import { projektAuswahl, projektMarke } from '../lib/projektwahl.js';
import { eintragOeffnen } from '../lib/oeffnen.js';
import { journalPdf } from '../lib/reports.js';
import { pdfSpeichern, pdfZeigen, drucken, druckenMoeglich } from '../lib/pdfausgabe.js';

const api = window.kontovia;

/* Zeitraum der Buchungsliste; bleibt beim Ansichtswechsel erhalten. Suche,
   Filter und Sortierung hält der Tabellenbaustein (lib/table.js). */
const period = defaultPeriod();
const TABLE = 'buchungen';

/** Die Zeitraumwahl oben rechts und die Tabelle – beide werden bei „alles zurücksetzen“ gebraucht. */
let periodCtl = null;
let list = null;
/**
 * Eine feste Auswahl von Buchungen, etwa „3 Buchungen ohne Kategorie“ aus der
 * Prüfung in der Übersicht. Sie steht als eigener Filter mit Chip über der
 * Liste und lässt sich wie jeder andere Filter aufheben.
 */
let auswahl = null;

const VAT_TREATMENTS = {
  standard: 'Regelbesteuert',
  steuerfrei: 'Steuerfrei',
  'nicht-steuerbar': 'Nicht steuerbar (kein Entgelt, etwa Mahngebühren)',
  'ig-lieferung': 'Innergemeinschaftliche Lieferung',
  ausfuhr: 'Ausfuhr außerhalb der EU (steuerfrei mit Vorsteuerabzug)',
  'reverse-charge-out': 'Leistung an Unternehmen in der EU (Steuerschuld beim Kunden)',
  'ausland-nicht-steuerbar': 'Leistung an Unternehmen außerhalb der EU (nicht steuerbar)',
  'rc-inland-out': 'Steuerschuld beim Kunden im Inland (§ 13b, etwa Bauleistungen)',
  'ig-erwerb': 'Innergemeinschaftlicher Erwerb',
  'reverse-charge-in': 'Leistung aus dem EU-Ausland (§ 13b, Sie schulden die Steuer)',
  'rc-in-sonstige': 'Andere Leistung nach § 13b (aus dem Nicht-EU-Ausland oder Inland)',
  // Seit 2.41, nur bei Einnahmen (lib/sonderfaelle.js).
  oss: 'Verkauf an Privatkunden in der EU (OSS, Steuer des Ziellandes)',
  differenz: 'Gebrauchtware mit Differenzbesteuerung (§ 25a UStG)',
  'gutschein-mehrzweck': 'Verkauf eines Mehrzweckgutscheins (Steuer erst bei Einlösung)',
  'gutschein-einloesung': 'Einlösung eines Mehrzweckgutscheins (nur die Umsatzsteuer)',
  'ohne-kategorie': 'Noch offen (ohne Kategorie)',
};

/** Behandlungen, die es nur bei Einnahmen gibt. */
const NUR_EINNAHME = new Set(['oss', 'differenz', 'gutschein-mehrzweck', 'gutschein-einloesung']);

/* -------------------------------------------------------------------------- */
/* Ansicht                                                                     */
/* -------------------------------------------------------------------------- */

export async function render(root, params = {}, { actions } = {}) {
  const st = tableState(TABLE, { key: 'date', dir: -1 });
  if (params.focusId) {
    st.q = '';
    Object.assign(period, { preset: 'alles', from: '1900-01-01', to: '2999-12-31' });
  }
  // Aus der Übersicht heraus lässt sich gefiltert hierher springen,
  // etwa „12 Buchungen ohne Beleg anzeigen“.
  // „neu“: alle bisherigen Filter und die Suche vergessen, damit die Liste genau das zeigt, wohin man gesprungen ist.
  if (params.neu) { st.filters = {}; st.q = ''; auswahl = null; }
  if (params.receipt) st.filters.hasReceipt = params.receipt;
  // Der Filter nach Finanzamt-Unterlagen besteht nur, wenn es private Buchungen gibt.
  if (params.listing && sel.transactions().some((t) => t.unlisted)) st.filters.listing = params.listing;
  if (params.status) st.filters.status = params.status;
  if (params.categoryId) st.filters.categoryId = params.categoryId;
  if (params.projektId) st.filters.projektId = params.projektId;
  if (params.type) st.filters.type = params.type;
  if (params.datum) st.filters.datum = params.datum;
  if (params.period) Object.assign(period, params.period);
  if (Array.isArray(params.ids)) {
    auswahl = { ids: new Set(params.ids), titel: String(params.titel || `${params.ids.length} ausgewählte Buchungen`) };
    st.filters.auswahl = 'auswahl';
    // Die Auswahl gilt ohne weitere Einschränkung – auch stornierte Teile, falls sie dazugehören.
    st.q = '';
  }
  // Die Vorgaben gelten einmal, beim Hinspringen. Sonst setzte jedes Neuzeichnen
  // nach dem Speichern einer Buchung (refresh) Filter und Zeitraum zurück, die
  // man inzwischen geändert hatte.
  if (router.params === params) router.params = {};
  // Wurde der letzte Beleg zu einem Ort geändert, fällt der Ort aus der Liste –
  // ein Filter darauf würde sonst unsichtbar weiterwirken.
  if (st.filters.location && !knownLocations().includes(st.filters.location)) delete st.filters.location;

  // Drucken und PDF braucht man am Telefon selten; dort bleiben sie weg (nur-breit, web.css).
  actions.innerHTML = html`<div id="txPeriod"></div>
    <button class="btn" id="txKonto" data-premium="kontoauszug" title="Umsätze aus einer Datei Ihrer Bank übernehmen">${icon('bank', 16)} Kontoauszug einlesen</button>
    <button class="btn nur-breit" id="txUeberweisen" title="Offene Ausgaben als Datei für Ihr Online-Banking">${icon('euro', 16)} Überweisen</button>
    ${druckenMoeglich() ? raw(`<button class="btn nur-breit" id="txDruck">${icon('print', 16).__raw} Drucken</button>`) : ''}
    <button class="btn nur-breit" id="txPdf">${icon('pdf', 16)} Als PDF</button>`;
  periodCtl = periodControl($('#txPeriod', actions), period, () => list?.render());
  $('#txKonto', actions).addEventListener('click', () => navigate('kontoimport'));
  $('#txUeberweisen', actions).addEventListener('click', async () => (await import('../lib/ueberweisungen.js')).ueberweisungenDialog());
  $('#txDruck', actions)?.addEventListener('click', () => listeAusgeben('drucken'));
  $('#txPdf', actions).addEventListener('click', () => listeAusgeben('speichern'));

  root.innerHTML = '<div class="card" id="txCard"></div>';
  list = mountTable($('#txCard', root), listSpec());
  if (params.focusId) setTimeout(() => openTransactionDialog(params.focusId), 60);
}

/**
 * Die Liste, wie sie gerade zu sehen ist (Zeitraum, Filter, Suche, Sortierung), als Buchungsjournal
 * drucken oder als PDF sichern.
 * @param {'drucken'|'speichern'} wie
 */
async function listeAusgeben(wie) {
  const zeilen = list?.rows() || [];
  if (!zeilen.length) { warn('Nichts zu drucken', 'Die Liste ist leer. Ändern Sie Zeitraum oder Filter.'); return; }
  const doc = journalPdf(store.db, period, zeilen);
  doc.titel = 'Buchungen';
  // Der Standardhinweis des Journals gilt für die vollständige Auflistung, nicht für eine gefilterte Liste.
  doc.bloecke = doc.bloecke.filter((b) => b.art !== 'hinweis');
  doc.bloecke.push({ art: 'hinweis', inhalt: [{ t: 'Auszug der Buchungsliste so, wie sie bei Erstellung eingestellt war (Zeitraum, Filter, Suche, Sortierung). Stornierte Buchungen sind durchgestrichen.' }] });
  if (zeilen.some((t) => t.unlisted)) {
    doc.bloecke.push({
      art: 'hinweis',
      inhalt: [{ t: 'Enthält private Buchungen.', fett: true }, { t: ' Diese Liste ist nur für den eigenen Gebrauch; für das Finanzamt gelten die Unterlagen unter „Import & Export“.' }],
    });
  }
  const name = `Buchungen_${todayISO()}.pdf`;
  try {
    if (wie === 'drucken') { await drucken(doc, name); return; }
    const pfad = await pdfSpeichern(doc, name);
    if (pfad) ok('PDF gespeichert', pfad);
  } catch (e) {
    err('PDF konnte nicht erstellt werden', e.message);
  }
}

/** Alle bisher vergebenen Orte – als Filterliste und als Eingabevorschlag. */
export function knownLocations() {
  const set = new Set(sel.transactions().map((t) => String(t.location || '').trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

const overdue = (t) => !t.paidDate && !isVoidPart(t) && (t.dueDate || t.date) < todayISO();

/* Eine Buchung gehört in den Zeitraum, wenn ihr Datum oder ihre Zahlung darin
   liegt. Sonst fehlte etwa im September die Zahlung auf eine August-Rechnung,
   obwohl sie in Übersicht und EÜR im September zählt. */
const imZeitraum = (d) => !!d && d >= period.from && d <= period.to;
const gebuchtIm = (t) => imZeitraum(t.date);
const bezahltIm = (t) => imZeitraum(t.paidDate);
/** Reihenfolge beim Sortieren nach Status: was Aufmerksamkeit braucht, zuerst. */
const statusRank = (t) => (isVoidPart(t) ? 3 : overdue(t) ? 0 : !t.paidDate ? 1 : 2);

/** Spalten, Filter und Suche der Buchungsliste. */
function listSpec() {
  const klein = ohneUstEinstellung(store.db.settings);
  const alle = () => true;
  // Hat keine Buchung einen Kontakt, bliebe die Spalte leer und nähme der Beschreibung den Platz.
  const mitKontakt = sel.transactions().some((t) => t.contactId);
  const columns = [
    { key: 'date', label: 'Datum', type: 'date', width: '108px', cls: 'col-datum', tdCls: 'nowrap', cell: dateCell },
    {
      key: 'nr', label: 'Nr.', sortLabel: 'Beleg-Nr.', type: 'text', width: '84px', cls: 'col-nr', tdCls: 'tiny muted nowrap',
      value: (t) => t.invoiceNumber || '', cell: (t) => esc(t.invoiceNumber || ''),
    },
    { key: 'description', label: 'Beschreibung', type: 'text', cls: 'col-text', value: (t) => t.description || '', cell: descriptionCell },
    {
      key: 'category', label: 'Kategorie', type: 'text', width: '146px', cls: 'col-kat', tdCls: 'small truncate',
      value: (t) => sel.categoryName(t.categoryId),
      cell: (t) => {
        const cat = sel.category(t.categoryId);
        return `<span class="dot" style="background:hsl(${cat ? hueOf(cat.name) : 0} 55% 55%);margin-right:6px"></span>${esc(cat?.name || '–')}`;
      },
    },
    ...(mitKontakt ? [{
      key: 'contact', label: 'Kontakt', type: 'text', width: '124px', cls: 'col-kontakt', tdCls: 'small truncate',
      value: (t) => (t.contactId ? sel.contactName(t.contactId) : ''), cell: (t) => esc(sel.contactName(t.contactId)),
    }] : []),
    {
      key: 'status', label: 'Status', type: 'num', align: 'left', width: '132px', cls: 'col-status', value: statusRank, dir: 1,
      dirText: ['Offenes zuerst', 'Bezahltes zuerst'], cell: statusCell,
    },
    ...(klein ? [] : [
      { key: 'net', label: 'Netto', type: 'num', width: '94px', cls: 'col-netto', cell: (t) => esc(money(t.net)) },
      {
        key: 'vat', label: 'USt', type: 'num', width: '74px', cls: 'col-ust', tdCls: 'muted',
        cell: (t) => (t.vat ? esc(money(t.vat)) : '–'),
      },
    ]),
    { key: 'amount', label: 'Brutto', type: 'num', width: '118px', cls: 'col-brutto', value: (t) => t.gross, cell: (t) => amountCell(t.gross, t.type).__raw },
    {
      // Nur Filter: in der schmalen Belegspalte ist kein Platz für einen zweiten Knopf.
      key: 'receipt', label: '', type: 'none', width: '44px', cls: 'center col-beleg',
      value: (t) => (t.attachments || []).length,
      cell: (t) => {
        const n = (t.attachments || []).length;
        return n ? `<span title="${n} Beleg(e)">${icon('paperclip', 14).__raw}</span>` : '';
      },
    },
  ];

  const filters = [
    ...(auswahl ? [{
      key: 'auswahl', column: 'description', title: 'Auswahl', initial: 'alle',
      chip: () => auswahl.titel,
      options: () => [['alle', 'Keine feste Auswahl', alle], ['auswahl', auswahl.titel, (t) => auswahl.ids.has(t.id)]],
    }] : []),
    {
      key: 'datum', column: 'date', title: 'Im Zeitraum liegt', initial: 'alle',
      chip: (v, label) => label,
      options: () => [
        ['alle', 'Buchungs- oder Zahlungsdatum', alle],
        ['zahlung', 'Zahlungen im Zeitraum', bezahltIm],
        ['buchung', 'Buchungsdatum im Zeitraum', gebuchtIm],
        ['fremd', 'Zahlungen zu Buchungen anderer Zeiträume', (t) => bezahltIm(t) && !gebuchtIm(t)],
      ],
    },
    {
      key: 'location', column: 'description', title: 'Ort der Leistung', initial: '', hideEmpty: true,
      chip: (v) => `Ort: ${v}`,
      options: () => {
        const orte = knownLocations();
        return [['', 'Alle Orte', alle], ...orte.map((o) => [o, o, (t) => (t.location || '') === o])];
      },
    },
    {
      key: 'categoryId', column: 'category', title: 'Kategorie', initial: '', hideEmpty: true, search: sel.categories().length > 8,
      options: () => [['', 'Alle Kategorien', alle],
        ...sortBy(sel.categories(), (c) => (c.kind === 'income' ? '0' : '1') + c.name.toLowerCase())
          .map((c) => [c.id, c.name, (t) => t.categoryId === c.id, c.kind === 'income' ? 'Einnahme' : 'Ausgabe'])],
    },
    {
      key: 'contactId', column: mitKontakt ? 'contact' : 'description', title: 'Kontakt', initial: '', hideEmpty: true, search: sel.contacts().length > 8,
      options: () => [['', 'Alle Kontakte', alle],
        ...sortBy(sel.contacts(), (c) => c.name.toLowerCase()).map((c) => [c.id, c.name, (t) => t.contactId === c.id])],
    },
    // Projekte (lib/projekte.js) wirken wie Kostenstellen; der Filter steht nur, wenn es welche gibt.
    ...(sel.projekte().length ? [{
      key: 'projektId', column: 'description', title: 'Projekt', initial: '', hideEmpty: true, search: sel.projekte().length > 8,
      chip: (v, label) => `Projekt: ${label}`,
      options: () => [['', 'Alle Projekte', alle], ['ohne', 'Keinem Projekt zugeordnet', (t) => !t.projektId],
        ...sortBy(sel.projekte(), (p) => String(p.name).toLowerCase()).map((p) => [p.id, p.name, (t) => t.projektId === p.id])],
    }] : []),
    {
      key: 'status', column: 'status', title: 'Zahlung', initial: 'alle',
      chip: (v, label) => `Status: ${label.toLowerCase()}`,
      options: () => [
        ['alle', 'Jeder Zahlstatus', alle],
        ['offen', 'Offen', (t) => !t.paidDate],
        ['bezahlt', 'Bezahlt', (t) => !!t.paidDate],
        ['ueberfaellig', 'Überfällig', overdue],
      ],
    },
    // Nur anbieten, wenn es überhaupt private Buchungen gibt.
    ...(sel.transactions().some((t) => t.unlisted) || tableState(TABLE).filters.listing ? [{
      key: 'listing', column: 'status', title: 'Finanzamt-Unterlagen', initial: 'alle',
      chip: (v, label) => label,
      options: () => [
        ['alle', 'Alle, auch private', alle],
        ['gelistet', 'Ohne private', (t) => !t.unlisted],
        ['privat', 'Nur private', (t) => !!t.unlisted],
      ],
    }] : []),
    {
      // Original und Gegenbuchung eines Stornos heben sich auf; ausgeblendet werden beide.
      key: 'showVoided', column: 'status', title: 'Stornierte Buchungen', initial: 'nein',
      chip: () => 'Mit Stornos',
      options: () => [['nein', 'Ausblenden', (t) => !isVoidPart(t)], ['ja', 'Einblenden (mit Gegenbuchung)', alle]],
    },
    {
      key: 'type', column: 'amount', title: 'Art der Buchung', initial: 'alle', chip: (v, label) => label,
      options: () => [['alle', 'Einnahmen und Ausgaben', alle],
        ['income', 'Nur Einnahmen', (t) => t.type === 'income'], ['expense', 'Nur Ausgaben', (t) => t.type === 'expense']],
    },
    {
      key: 'hasReceipt', column: 'receipt', title: 'Beleg', initial: 'alle', chip: (v, label) => label,
      options: () => [['alle', 'Mit und ohne Beleg', alle],
        ['mit', 'Mit Beleg', (t) => (t.attachments || []).length > 0], ['ohne', 'Ohne Beleg', (t) => !(t.attachments || []).length]],
    },
  ];

  return {
    id: TABLE,
    // tx-list: auf dem Telefon als Kartenliste (web.css).
    cls: 'data fixed tx-list',
    defaultSort: { key: 'date', dir: -1 },
    columns,
    filters,
    rows: () => sel.transactions().filter((t) => gebuchtIm(t) || bezahltIm(t)),
    search: {
      id: 'txSearch',
      placeholder: 'Suchen: Text, Rechnungsnummer, Betrag …',
      label: 'Buchungen durchsuchen',
      // Der Suchtext enthält Kategorie- und Kontaktnamen; ändert sich der Bestand, wird er neu gebildet.
      version: () => store.revision,
      text: (t) => [t.description, t.invoiceNumber, t.reference, t.notes, t.location,
        sel.categoryName(t.categoryId), sel.contactName(t.contactId), t.projektId ? sel.projekt(t.projektId)?.name : '', (t.gross / 100).toFixed(2)].join(' '),
    },
    summary: summaryHtml,
    rowAttrs: (t) => `data-id="${esc(t.id)}"`,
    rowClass: (t) => [t.voided ? 'void' : '', t.unlisted ? 'unlisted' : ''].join(' ').trim(),
    onRowClick: (t) => openTransactionDialog(t.id),
    emptyHtml: () => (sel.transactions().length
      ? emptyState('Keine Buchungen im Zeitraum', 'Wählen Sie oben rechts einen anderen Zeitraum.',
        '<button class="btn mt16" data-period-reset>Zurück zum laufenden Jahr</button>').__raw
      : emptyState('Noch keine Buchungen', 'Erfassen Sie Ihre erste Einnahme oder Ausgabe über den Knopf oben rechts.',
        '<button class="btn primary mt16" data-first>Erste Buchung anlegen</button>').__raw),
    onRender: wireRows,
  };
}

/**
 * Anzahl und Summen der sichtbaren Buchungen. Eingänge und Ausgänge sind,
 * was im Zeitraum tatsächlich bezahlt wurde – dasselbe, was die Übersicht
 * zählt (hier brutto). Offene Rechnungen stehen getrennt daneben.
 */
function summaryHtml(rows) {
  const bezahlt = rows.filter(bezahltIm);
  const sumIncome = sum(bezahlt.filter((t) => t.type === 'income'), (t) => t.gross);
  const sumExpense = sum(bezahlt.filter((t) => t.type === 'expense'), (t) => t.gross);
  const offen = rows.filter((t) => !t.paidDate && !isVoidPart(t));
  const openIncome = sum(offen.filter((t) => t.type === 'income'), (t) => t.gross);
  const openExpense = sum(offen.filter((t) => t.type === 'expense'), (t) => t.gross);
  const unlistedCount = rows.filter((t) => t.unlisted && !isVoidPart(t)).length;
  const offenText = [openIncome ? `${money(openIncome)} € zu erhalten` : '', openExpense ? `${money(openExpense)} € zu zahlen` : ''].filter(Boolean).join(' · ');
  return html`<div class="tx-sum" title="Eingänge und Ausgänge: im Zeitraum bezahlt, nach Zahlungsdatum, brutto">
    <span><strong>${int(rows.length)}</strong> <span class="muted">${rows.length === 1 ? 'Buchung' : 'Buchungen'}</span></span>
    <span><span class="muted">Eingänge</span> <strong class="amount pos">${money(sumIncome)} €</strong></span>
    <span><span class="muted">Ausgänge</span> <strong class="amount neg">${money(sumExpense)} €</strong></span>
    <span><span class="muted">Saldo</span> <strong class="amount ${sumIncome - sumExpense >= 0 ? 'pos' : 'neg'}">${money(sumIncome - sumExpense)} €</strong></span>
    <span class="muted tiny tx-sum-hinweis" title="Alle Zahlungen der Liste mit Umsatzsteuer, auch Privatentnahmen und Zahlungen an das Finanzamt. Die Übersicht zeigt dagegen Betriebseinnahmen und Betriebsausgaben ohne Umsatzsteuer, deshalb weichen die Zahlen dort ab.">brutto, alle Zahlungen</span>
    ${offen.length ? raw(`<span class="badge warn" title="Noch nicht bezahlt, zählt erst am Zahlungstag">${offen.length} offen${offenText ? ': ' + esc(offenText) : ''}</span>`) : ''}
    ${unlistedCount ? raw(`<span class="badge unlisted" title="In den Summen enthalten, in den Unterlagen fürs Finanzamt nicht">${unlistedCount} privat</span>`) : ''}
  </div>`;
}

/**
 * Datum der Buchung. Liegt es außerhalb des Zeitraums, steht die Buchung nur
 * wegen ihrer Zahlung in der Liste – das wird angezeigt statt verschwiegen.
 */
function dateCell(t) {
  if (gebuchtIm(t) || !bezahltIm(t)) return esc(fmtDate(t.date));
  return `<span class="muted" title="Gebucht am ${esc(fmtDate(t.date))}, bezahlt am ${esc(fmtDate(t.paidDate))}. Zählt im gewählten Zeitraum">${esc(fmtDate(t.date))}</span>
    <div class="tiny" style="color:var(--accent)">Zahlung ${esc(tagImJahr(t.paidDate, t.date))}</div>`;
}

/** „28.09.“, wenn das Jahr dasselbe ist wie beim Bezugsdatum, sonst „28.09.2025“. */
function tagImJahr(iso, bezug) {
  return String(iso).slice(0, 4) === String(bezug || '').slice(0, 4) ? fmtDate(iso).slice(0, 6) : fmtDate(iso);
}

function descriptionCell(t) {
  const dep = depositInfo(t);
  return `
    <div class="truncate">${esc(t.description || '(ohne Beschreibung)')}</div>
    ${t.unlisted ? `<span class="badge unlisted tiny" title="Privat: gehört nicht zum Betrieb und steht nicht in EÜR, Umsatzsteuer, DATEV und den Unterlagen fürs Finanzamt">${icon('hide', 11).__raw} privat</span>` : ''}
    ${t.location ? `<div class="tiny muted truncate">${icon('pin', 11).__raw} ${esc(t.location)}</div>` : ''}
    ${dep ? `<span class="badge info tiny" title="${esc(depositTitle(dep))}">Anzahlung${dep.percent ? ' ' + esc(percentText(dep.percent)) + ' %' : ''}</span>` : ''}
    ${t.isReversal ? '<span class="badge tiny">Storno</span>' : ''}
    ${t.assetId ? '<span class="badge info tiny">aktiviert</span>' : ''}
    ${projektMarke(t)}`;
}

function statusCell(t) {
  if (t.voided) return '<span class="badge" title="Durch eine Gegenbuchung aufgehoben">storniert</span>';
  if (t.isReversal) return '<span class="badge" title="Hebt eine stornierte Buchung auf">Gegenbuchung</span>';
  // Am Tag der Buchung bezahlt (der Normalfall) braucht kein zweites Datum.
  const status = t.paidDate
    ? `<span class="badge pos" title="bezahlt am ${esc(fmtDate(t.paidDate))}">bezahlt${t.paidDate === t.date ? '' : ` ${esc(tagImJahr(t.paidDate, t.date))}`}</span>`
    : overdue(t)
      ? '<span class="badge neg">überfällig</span>'
      : '<span class="badge warn">offen</span>';
  return status + (!t.paidDate && !t.voided
    ? `<button class="btn sm ghost" data-pay="${esc(t.id)}" title="Als heute bezahlt markieren" aria-label="Als heute bezahlt markieren">${icon('check', 13).__raw}</button>`
    : '');
}

/** Knöpfe in den Zeilen und im leeren Zustand; wird nach jedem Zeichnen gerufen. */
function wireRows(el) {
  el.querySelector('[data-first]')?.addEventListener('click', () => openTransactionDialog(null, 'expense'));
  el.querySelector('[data-period-reset]')?.addEventListener('click', () => {
    Object.assign(period, defaultPeriod());
    periodCtl?.update();
    list?.render();
  });
  el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tx = sel.transaction(b.dataset.pay);
    // Das Zahlungsdatum bestimmt bei der Ist-Besteuerung, in welchen Zeitraum
    // die Buchung fällt. In einem festgeschriebenen Zeitraum darf es nicht
    // liegen. Eine festgeschriebene, aber noch offene Rechnung lässt sich
    // dagegen weiter als bezahlt vermerken: Die Zahlung heute ändert am
    // abgeschlossenen Zeitraum nichts (siehe nurZahlungNachgetragen).
    if (isLockedDate(todayISO())) {
      err('Zeitraum ist festgeschrieben', 'Das Zahlungsdatum lässt sich hier nicht mehr nachtragen.');
      return;
    }
    await upsertTransaction({ ...tx, paidDate: todayISO() });
    ok('Als bezahlt vermerkt', `${tx.description} · heute`);
    list?.render();
  }));
}

/** Prozentwerte werden mit deutschem Dezimalkomma ein- und ausgegeben. */
function parsePercent(input) {
  const n = Number(String(input ?? '').replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function percentText(p) {
  return p ? dz(p) : '';
}

function depositTitle(dep) {
  const teile = [`Anzahlung ${percentText(dep.percent)} % von ${money(dep.total)} €`];
  if (dep.remaining) teile.push(`Restbetrag ${money(dep.remaining)} €`);
  if (dep.eventDate) teile.push(`Termin ${fmtDate(dep.eventDate)}`);
  return teile.join(' · ');
}

/**
 * Kategorien fürs Auswahlfeld. Bei langen Listen stehen die fünf zuletzt
 * benutzten oben in einer eigenen Gruppe, die übrigen in ihrer gewohnten
 * Reihenfolge darunter; jede Kategorie kommt nur einmal vor.
 */
function kategorieOptionen(cats, gewaehlt) {
  const opt = (c) => `<option value="${esc(c.id)}" ${gewaehlt === c.id ? 'selected' : ''}>${esc(c.name)}</option>`;
  const ids = new Set(cats.map((c) => c.id));
  const zuletzt = [];
  if (cats.length > 8) {
    const neueste = sortBy(sel.transactions().filter((t) => ids.has(t.categoryId)), (t) => t.date || '', -1);
    for (const t of neueste) {
      if (!zuletzt.includes(t.categoryId)) zuletzt.push(t.categoryId);
      if (zuletzt.length >= 5) break;
    }
  }
  if (!zuletzt.length) return cats.map(opt).join('');
  const oben = zuletzt.map((id) => cats.find((c) => c.id === id));
  const rest = cats.filter((c) => !zuletzt.includes(c.id));
  return `<optgroup label="Zuletzt verwendet">${oben.map(opt).join('')}</optgroup>
    <optgroup label="Alle weiteren">${rest.map(opt).join('')}</optgroup>`;
}

/** Kontakte fürs Auswahlfeld: bei Einnahmen zuerst die Kunden, bei Ausgaben die Lieferanten. */
function kontaktOptionen(type, gewaehlt) {
  const opt = (c) => `<option value="${esc(c.id)}" ${gewaehlt === c.id ? 'selected' : ''}>${esc(c.name)}</option>`;
  const art = type === 'income' ? 'customer' : 'supplier';
  const alle = sortBy(sel.contacts(), (c) => (c.name || '').toLowerCase());
  const passend = alle.filter((c) => c.kind === art || c.kind === 'both');
  const andere = alle.filter((c) => !passend.includes(c));
  if (!passend.length || !andere.length) return alle.map(opt).join('');
  return `<optgroup label="${type === 'income' ? 'Kunden' : 'Lieferanten'}">${passend.map(opt).join('')}</optgroup>
    <optgroup label="Weitere Kontakte">${andere.map(opt).join('')}</optgroup>`;
}

/* -------------------------------------------------------------------------- */
/* Erfassungsdialog                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Den offenen Rest einer Einnahme ausbuchen (store.js: restAusbuchen): Skonto
 * oder Forderungsausfall, ab einem Tag. Liefert {grund, datum} oder null.
 */
export function ausbuchenFragen(tx) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: 'Offenen Betrag ausbuchen',
      size: 'slim',
      body: html`
        <p class="mt0">${tx.description || 'Einnahme'}: ${money(tx.gross)} € sind offen.</p>
        <label class="check"><input type="radio" name="grund" value="skonto" checked> Skonto oder Nachlass: Der Kunde durfte weniger zahlen</label>
        <label class="check"><input type="radio" name="grund" value="uneinbringlich"> Forderungsausfall: Das Geld ist nicht mehr zu bekommen</label>
        <div class="field mt8"><label for="ausbDatum">Am</label><input type="date" id="ausbDatum" value="${todayISO()}" min="${tx.date}"></div>
        <p class="hint mb0">Umsatzsteuer und Einnahme werden im Zeitraum dieses Tages berichtigt (§ 17 UStG). Die Rechnung gilt danach als erledigt.
        Zahlt der Kunde doch noch, erfassen Sie die Zahlung als neue Einnahme.</p>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Ausbuchen</button>',
      onClose: () => { if (!fertig) resolve(null); },
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(null); });
    m.root.querySelector('[data-ja]').addEventListener('click', () => {
      // Erst lesen, dann schließen: Beim Schließen räumt das Fenster seinen Inhalt ab.
      const datum = m.root.querySelector('#ausbDatum').value;
      const grund = m.root.querySelector('input[name="grund"]:checked')?.value || 'skonto';
      if (!datum) { warn('Bitte ein Datum wählen'); return; }
      fertig = true;
      m.close();
      resolve({ grund, datum });
    });
  });
}

/**
 * @param {string|object|null} id  Kennung, null (neu) oder ein fertiger Entwurf (Duplikat, Restzahlung)
 * @param {'income'|'expense'} type
 * @param {{onSaved?:(tx:object)=>any, wiederholen?:string, dateien?:File[], vorgabe?:object}} opts  onSaved läuft nach dem Speichern,
 *   etwa um die Buchung mit dem Termin zu verknüpfen, aus dem sie angelegt wurde; wiederholen
 *   wählt einen Turnus vor (lib/wiederkehrend.js); dateien hängt Belege gleich beim Öffnen an;
 *   vorgabe füllt Felder vor, bei einer bestehenden Buchung (der Assistent: {paidDate}) wie bei einer neuen (das Projekt:
 *   {projektId, contactId}); gespeichert wird wie sonst erst mit „Speichern“
 */
export function openTransactionDialog(id, type = 'expense', { onSaved = null, wiederholen: turnusVorgabe = '', dateien = null, vorgabe = null } = {}) {
  const draft = id && typeof id === 'object' ? id : null;
  const existing = draft ? null : (id ? sel.transaction(id) : null);
  if (existing) fokusMerken('buchung', existing.id);
  const tx = existing ? { ...structuredClone(existing), ...(vorgabe || {}) } : { ...(draft || newTransactionDraft(type)), ...(vorgabe || {}) };
  const isNew = !existing;
  type = tx.type;
  // Kleinunternehmer oder nicht nach dem Stand am Tag der Buchung (Verlauf in den Einstellungen).
  const klein = ohneUst(store.db, tx.date || todayISO());
  const kleinNur = isKleinunternehmer(store.db, tx.date || todayISO());
  // Festgeschrieben ist eine Buchung, deren Datum oder Zahlung im
  // festgeschriebenen Zeitraum liegt – auch eine Vorauszahlung auf eine
  // spätere Rechnung gehört zum Zeitraum, in dem sie floss.
  const locked = !!existing && (isLockedDate(existing.date) || (!!existing.paidDate && isLockedDate(existing.paidDate)));
  // Offen und festgeschrieben: Die Zahlung darf noch eingetragen werden.
  const zahlungOffen = locked && !existing.paidDate;
  // Original und Gegenbuchung eines Stornos bleiben, wie sie sind – sonst höben
  // sie sich nicht mehr auf.
  const stornoTeil = !!existing && isVoidPart(existing);

  /* Belege, die in diesem Dialog neu hinzugekommen sind – bei Abbruch wieder weg. */
  const addedAttachments = [];
  let attachments = (tx.attachments || []).map(sel.attachment).filter(Boolean);
  let inputMode = 'gross';
  /** Eine E-Rechnung aus einem in diesem Dialog angehängten Beleg (lib/erechnung.js). */
  let erkannt = null;
  /** „Beleg lesen“ (lib/belegerkennung.js): Vorschlag aus PDF-Text oder Foto; leseStand '', 'liest', 'fehler', 'gesperrt'. */
  let gelesen = null;
  let leseStand = '';
  let leseFehler = '';
  /** Wiederholung, die mit dem Speichern als Regel entsteht – gehört nicht zur Buchung selbst. */
  const wiederholung = { freq: TURNUS[turnusVorgabe] ? turnusVorgabe : '', until: '', anzahl: 0 };
  /** Aufteilung in Raten: beim Speichern entstehen daraus mehrere Buchungen (lib/raten.js). */
  const ratenWahl = { anzahl: 0, freq: 'monthly' };
  /** Weitere Steuersätze desselben Belegs: beim Speichern wird daraus je Satz eine Buchung (lib/steuersaetze.js). */
  const satzTeile = [];
  /* Stand nach dem ersten Zeichnen; weicht die Eingabe davon ab, fragt das
     Fenster vor dem Wegklicken nach. */
  let ausgangslage = null;

  const m = modal({
    title: isNew ? (type === 'income' ? 'Neue Einnahme' : 'Neue Ausgabe') : 'Buchung bearbeiten',
    size: 'wide',
    body: '<div id="txForm"></div>',
    foot: `
      <div class="left row" style="gap:8px">
        ${!isNew && !stornoTeil ? `<button class="btn danger sm" id="btnDelete">${icon('trash', 14).__raw} Löschen</button>` : ''}
        ${!isNew && !stornoTeil ? `<button class="btn sm" id="btnVoid">Stornieren</button>` : ''}
        ${!isNew && !stornoTeil && tx.type === 'income' && !tx.paidDate ? '<button class="btn sm" id="btnAusbuchen">Ausbuchen …</button>' : ''}
        ${!isNew ? `<button class="btn sm" id="btnDuplicate">${icon('copy', 14).__raw} Duplizieren</button>` : ''}
      </div>
      <button class="btn" id="btnCancel">Abbrechen</button>
      ${stornoTeil ? '' : `<button class="btn primary" id="btnSave">${isNew ? 'Buchung anlegen' : 'Änderungen speichern'}</button>`}`,
    onClose: () => cleanupUnsaved(),
    confirmDismiss: () => {
      if (ausgangslage === null || saved) return false;
      collect();
      return JSON.stringify(tx) !== ausgangslage || addedAttachments.length > 0
        || wiederholung.freq !== (TURNUS[turnusVorgabe] ? turnusVorgabe : '') || ratenAnzahl(ratenWahl.anzahl) > 1
        || weitereTeile(tx.vatRate, satzExtras()).length > 0;
    },
  });

  async function cleanupUnsaved() {
    for (const a of addedAttachments) {
      if (!saved) { try { await api.attach.remove(a.id); } catch { /* egal */ } }
    }
  }
  let saved = false;

  const form = m.root.querySelector('#txForm');

  function draw() {
    const cats = sel.activeCategories(tx.type);
    const orte = knownLocations();
    const treat = vatTreatment(store.db, tx);
    const linkedAppts = sel.appointments().filter((a) => (a.transactionIds || []).includes(tx.id));
    const asset = tx.assetId ? sel.assets().find((a) => a.id === tx.assetId) : null;

    form.innerHTML = html`
      ${locked ? raw(`<div class="notice warn mb16">Diese Buchung liegt im festgeschriebenen Zeitraum (bis ${esc(fmtDate(lockedUntil()))}). Sie kann nicht mehr geändert, sondern nur noch storniert werden.${zahlungOffen
        ? ' Die Zahlung lässt sich weiterhin eintragen: mit einem Datum nach der Festschreibung, zusammen mit dem Zahlungskonto.' : ''}</div>`) : ''}
      ${tx.voided ? raw(`<div class="notice danger mb16">Diese Buchung wurde${tx.voidedAt ? ` am ${esc(fmtDate(tx.voidedAt.slice(0, 10)))}` : ''} storniert${tx.voidReason ? ` (${esc(tx.voidReason)})` : ''}.
        Eine Gegenbuchung hebt sie auf; beide bleiben unverändert erhalten und lassen sich weder bearbeiten noch löschen.</div>`) : ''}
      ${tx.isReversal ? raw('<div class="notice mb16">Das ist die Gegenbuchung zu einem Storno. Sie hebt die stornierte Buchung auf und lässt sich weder bearbeiten noch löschen.</div>') : ''}
      ${tx.import ? raw(tx.import.quelle
    ? `<div class="notice mb16">Übernommen aus ${esc(tx.import.quelle === 'DATEV' ? 'einer DATEV-Datei' : 'einer Tabelle')}${tx.import.datei ? `: „${esc(tx.import.datei)}“` : ''}${tx.import.konto ? `, Konto ${esc(tx.import.konto)}` : ''}.</div>`
    : `<div class="notice mb16">Aus einem Kontoauszug übernommen: Datei „${esc(tx.import.datei)}“, ${esc(fmtDate(String(tx.import.ts).slice(0, 10)))}.</div>`) : ''}
      ${tx.mahnRechnungId ? raw('<div class="notice mb16">Mahngebühr und Verzugsaufschlag zu einer Rechnung. Das ist kein Entgelt für eine Leistung und deshalb ohne Umsatzsteuer.</div>') : ''}

      <div class="seg mb16">
        <button data-type="expense" class="expense ${tx.type === 'expense' ? 'active' : ''}">Ausgabe</button>
        <button data-type="income" class="income ${tx.type === 'income' ? 'active' : ''}">Einnahme</button>
      </div>

      <div class="beleg-block mb16">
        <div class="row between mb8">
          <strong style="font-size:13px">Belege</strong>
          <span class="muted tiny">Verschlüsselt gespeichert, höchstens 40 MB je Datei</span>
        </div>
        <div id="eInvoiceBox"></div>
        <div id="belegLeseBox"></div>
        <div class="attach-list mb8" id="attachList"></div>
        <div class="dropzone" id="dropzone">
          ${icon('paperclip', 16)} Rechnung oder Quittung hierher ziehen oder <u>Datei auswählen</u>
        </div>
      </div>

      <div class="form-grid">
        <div class="field full">
          <label>Beschreibung *</label>
          <input id="i_description" value="${tx.description}" placeholder="${tx.type === 'income' ? 'z. B. Rechnung 2025-0042, Website-Relaunch' : 'z. B. Bürostühle, Bahnfahrt Berlin'}">
        </div>

        <div class="field">
          <label>${tx.type === 'income' ? 'Rechnungsdatum' : 'Belegdatum'} *</label>
          <input type="date" id="i_date" value="${tx.date}">
        </div>
        <div class="field">
          <label>Kategorie *</label>
          <select id="i_categoryId">
            <option value="">Bitte wählen</option>
            ${raw(kategorieOptionen(cats, tx.categoryId))}
          </select>
          <span class="hint" id="catHint"></span>
        </div>

        <div class="field">
          <label>${tx.type === 'income' ? 'Kunde' : 'Lieferant'}</label>
          <div class="row" style="gap:6px">
            <select id="i_contactId" style="flex:1">
              <option value="">Keiner</option>
              ${raw(kontaktOptionen(tx.type, tx.contactId))}
            </select>
            <button class="btn sm" id="btnNewContact" title="Neuen Kontakt anlegen">${icon('plus', 14)}</button>
          </div>
        </div>
        <div class="field">
          <label>Zahlungskonto</label>
          <select id="i_accountId">
            <option value="">Keins</option>
            ${raw(sel.accounts().map((a) => `<option value="${esc(a.id)}" ${tx.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join(''))}
          </select>
        </div>
        ${tx.type === 'income' ? raw(`
        <div class="field full">
          <label>Ort</label>
          <input id="i_location" list="ortListe" value="${esc(tx.location || '')}" placeholder="z. B. Schloss Elmau, Garmisch">
          <datalist id="ortListe">${orte.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>
          <span class="hint">Wo die Leistung erbracht wurde. Die Liste schlägt bereits verwendete Orte vor; in der Buchungsliste lässt sich danach filtern.</span>
        </div>`) : ''}
      </div>

      <div class="card mt8" style="background:var(--surface-2)">
        <div class="card-body">
          <div class="row between mb8">
            <strong style="font-size:13px">Betrag</strong>
            ${klein ? raw(kleinNur ? '<span class="badge">Kleinunternehmer, keine Umsatzsteuer</span>' : '<span class="badge">Kein Vorsteuerabzug, Beträge ohne Umsatzsteuer</span>') : raw(`
              <div class="seg">
                <button data-mode="gross" class="${inputMode === 'gross' ? 'active' : ''}">Brutto eingeben</button>
                <button data-mode="net" class="${inputMode === 'net' ? 'active' : ''}">Netto eingeben</button>
              </div>`)}
          </div>
          <div class="form-grid c3">
            <div class="field">
              <label>${treat === 'gutschein-einloesung' ? 'Wert des Gutscheins' : klein ? 'Betrag' : inputMode === 'gross' || bruttoPflicht(treat) ? 'Bruttobetrag' : 'Nettobetrag'} *</label>
              <input class="money-input" id="i_amount" value="${moneyInput(treat === 'gutschein-einloesung' ? (tx.gutscheinWert || 0) : inputMode === 'gross' || klein || bruttoPflicht(treat) ? tx.gross : tx.net)}" placeholder="0,00" inputmode="decimal" ${tx.fahrt?.km || tx.privatnutzung?.listenpreis ? 'readonly' : ''}>
            </div>
            ${klein ? '' : raw(`
            <div class="field">
              <label>Umsatzsteuersatz</label>
              <select id="i_vatRate">
                ${satzListe(treat).map((r) => `<option value="${r}" ${Number(tx.vatRate) === r ? 'selected' : ''}>${esc(dz(r))} %</option>`).join('')}
              </select>
            </div>`)}
            <div class="field">
              <label>Rechnungs-/Belegnummer</label>
              <div class="row" style="gap:6px">
                <input id="i_invoiceNumber" value="${tx.invoiceNumber || ''}" style="flex:1">
                ${tx.type === 'income' ? raw('<button class="btn sm" id="btnNextNo" title="Nächste freie Nummer">#</button>') : ''}
              </div>
            </div>
          </div>
          <details class="mt8" id="fremdBox" ${tx.fremd ? 'open' : ''}>
            <summary class="small muted" style="cursor:pointer;padding:4px 0">In fremder Währung</summary>
            <div class="form-grid c3 mt8">
              <div class="field"><label for="i_fremdW">Währung</label>
                <select id="i_fremdW"><option value="">Keine, nur Euro</option>${Object.entries(WAEHRUNGEN).filter(([k]) => k !== 'EUR').map(([k, n]) => raw(html`<option value="${k}" ${raw(tx.fremd?.waehrung === k ? 'selected' : '')}>${k} · ${n}</option>`))}</select></div>
              <div class="field"><label for="i_fremdBetrag">Betrag in dieser Währung</label><input class="money-input" id="i_fremdBetrag" inputmode="decimal" value="${tx.fremd ? moneyInput(tx.fremd.betrag) : ''}"></div>
              <div class="field"><label for="i_fremdKurs">Kurs (1 € = …)</label><input id="i_fremdKurs" inputmode="decimal" value="${tx.fremd ? kursEingabe(tx.fremd.kurs) : ''}" placeholder="z. B. 1,0850"></div>
            </div>
            <span class="hint">Kontovia rechnet den Betrag oben in Euro um und bucht in Euro; Währung, Betrag und Kurs bleiben an der Buchung.</span>
          </details>
          ${raw(fahrtFelder())}
          ${raw(privatFelder())}
          <div class="row" id="amountSummary" style="gap:22px;font-size:13px;padding-top:2px"></div>
          ${raw(satzFelder())}
        </div>
      </div>

      ${tx.type === 'income' ? raw(`
      <div class="card mt8" style="background:var(--surface-2)">
        <div class="card-body">
          <label class="check">
            <input type="checkbox" id="i_isDeposit" ${tx.isDeposit ? 'checked' : ''}>
            <strong style="font-size:13px">Anzahlung auf einen späteren Termin</strong>
          </label>
          <div id="depositBox" ${tx.isDeposit ? '' : 'style="display:none"'}>
            <div class="form-grid mt8">
              <div class="field">
                <label>Termin der Veranstaltung</label>
                <input type="date" id="i_eventDate" value="${esc(tx.eventDate || '')}">
                <span class="hint">Bei Hochzeiten das Hochzeitsdatum. Der Termin erscheint im Kalender.</span>
              </div>
              <div class="field">
                <label>Anteil der Anzahlung</label>
                <div class="row" style="gap:6px">
                  <input id="i_depositPercent" inputmode="decimal" style="flex:1;min-width:60px" value="${esc(percentText(tx.depositPercent))}" placeholder="30">
                  <span class="muted">%</span>
                  ${[20, 30, 50].map((v) => `<button class="btn sm" data-pct="${v}">${v} %</button>`).join('')}
                </div>
                <span class="hint">Anteil am vereinbarten Gesamtbetrag.</span>
              </div>
            </div>
            <div id="depositSummary" class="mt8"></div>
          </div>
        </div>
      </div>`) : ''}

      <div class="form-grid mt16">
        <div class="field">
          <label>Zahlung</label>
          <div class="row" style="gap:8px">
            <label class="check"><input type="checkbox" id="i_isPaid" ${tx.paidDate ? 'checked' : ''}> bezahlt am</label>
            <input type="date" id="i_paidDate" value="${tx.paidDate || todayISO()}" ${tx.paidDate ? '' : 'disabled'} style="flex:1">
          </div>
          <span class="hint">${store.db.settings.accountingBasis === 'soll' && !klein
            ? 'Dieses Datum zählt für die Anlage EÜR; die Umsatzsteuer richtet sich bei Ihnen nach dem Rechnungsdatum.'
            : 'Dieses Datum zählt für die Anlage EÜR und die Umsatzsteuer.'}</span>
        </div>
        <div class="field" id="dueField" ${tx.paidDate ? 'hidden' : ''}>
          <label>Fällig am</label>
          <div class="row" style="gap:6px">
            <input type="date" id="i_dueDate" value="${tx.dueDate || ''}" style="flex:1">
            <button class="btn sm" data-due="14" title="14 Tage ab Belegdatum">+14 Tage</button>
            <button class="btn sm" data-due="30" title="30 Tage ab Belegdatum">+30 Tage</button>
          </div>
        </div>
      </div>

      <div class="mt8">
        <label class="check" title="Eine private Buchung gehört nicht zum Betrieb und steht nicht in EÜR, Umsatzsteuer, DATEV und den Unterlagen fürs Finanzamt">
          <input type="checkbox" id="i_unlisted" ${tx.unlisted ? 'checked' : ''}>
          <span>Privat <span class="muted">(gehört nicht zum Betrieb)</span></span>
        </label>
        <div class="notice warn mt8" id="unlistedHint" ${tx.unlisted ? '' : raw('style="display:none"')}>
          Diese Buchung ist privat. Sie gehört nicht zum Betrieb und steht deshalb nicht in den Unterlagen
          für Finanzamt und Steuerkanzlei (EÜR, Umsatzsteuer, DATEV, Betriebsprüfung). In Übersicht und
          Auswertungen zählt sie nur mit, wenn dort <strong>„Private einbeziehen“</strong> gesetzt ist.
          Betriebliche Einnahmen und Ausgaben dürfen nicht als privat gekennzeichnet werden, sie müssen
          vollständig erklärt werden (§ 146 Abs. 1 AO).
        </div>
      </div>

      <details class="mt8" ${(tx.notes || tx.reference || tx.vatTreatment || tx.projektId || asset || wiederholung.freq || tx.recurringId || tx.ratenId || ratenAnzahl(ratenWahl.anzahl) > 1) ? 'open' : ''}>
        <summary class="small muted" style="cursor:pointer;padding:6px 0">Weitere Angaben</summary>
        <div class="form-grid mt8">
          <div class="field">
            <label>Referenz / Verwendungszweck</label>
            <input id="i_reference" value="${tx.reference || ''}">
          </div>
          ${projektWahl()}
          ${klein ? '' : raw(`
          <div class="field">
            <label>Umsatzsteuerliche Behandlung</label>
            <select id="i_vatTreatment">
              ${Object.entries(VAT_TREATMENTS).filter(([k]) => tx.type === 'income' || !NUR_EINNAHME.has(k)).map(([k, v]) => `<option value="${k}" ${treat === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
            <span class="hint">Bestimmt, in welche Kennzahl der Umsatzsteuer-Voranmeldung der Betrag fließt.</span>
          </div>
          ${sonderFelder(treat)}
          ${tx.type === 'expense' ? `<div class="field full">
            <label class="check"><input type="checkbox" id="i_lieferantIst" ${tx.lieferantIst ? 'checked' : ''}> Auf der Rechnung steht „Versteuerung nach vereinnahmten Entgelten“</label>
            <span class="hint">Ab 2028 zählt die Vorsteuer aus solchen Rechnungen erst, wenn Sie bezahlt haben.</span>
          </div>` : ''}`)}
          <div class="field full">
            <label>Notiz</label>
            <textarea id="i_notes" placeholder="Interne Bemerkung, betrieblicher Anlass bei Bewirtung, …">${tx.notes || ''}</textarea>
          </div>
          ${raw(wiederholungsFelder())}
          ${raw(ratenFelder())}
        </div>

        ${tx.type === 'expense' ? raw(`
        <div class="field">
          <label>Anlagevermögen</label>
          ${asset
            ? `<div class="notice ok">Diese Anschaffung wird über <strong>${esc(asset.name)}</strong> abgeschrieben
                 (${esc(money(asset.cost))} €, ${esc(AFA_METHODE[afaMethod(asset)])}${afaMethod(asset) === 'sofort' ? '' : `, ${esc(asset.usefulLifeYears)} Jahre`}).
                 <button class="btn sm mt8" id="btnUnlinkAsset">Verknüpfung lösen</button></div>`
            : `<div class="row" style="gap:8px">
                 <button class="btn sm" id="btnMakeAsset" data-premium="anlagen">Als Anlagegut abschreiben …</button>
                 <span class="hint">Für Anschaffungen über 800 € netto, die über mehrere Jahre genutzt werden.</span>
               </div>`}
        </div>`) : ''}
      </details>

      ${raw(bezuegeHtml(linkedAppts))}

      ${isNew ? '' : raw('<hr class="sep"><div id="txAufgaben" data-ohne-stand></div>')}`;

    const aufgabenBox = form.querySelector('#txAufgaben');
    if (aufgabenBox) aufgabenAbschnitt(aufgabenBox, 'buchung', tx.id, { titel: 'Aufgaben zu dieser Buchung' });
    drawAttachments();
    drawERechnung();
    drawBelegGelesen();
    updateAmountSummary();
    wireForm();
  }

  /** Unter der Kategorie: in welche Zeile der Anlage EÜR sie im Jahr der Buchung zählt. */
  function kategorieHinweis() {
    const hint = form.querySelector('#catHint');
    if (!hint) return;
    const c = sel.category(form.querySelector('#i_categoryId').value);
    const jahr = Number((form.querySelector('#i_date').value || todayISO()).slice(0, 4));
    const hat = c && c.euerLine !== null && c.euerLine !== undefined && c.euerLine !== '';
    hint.textContent = hat ? `Zeile ${formLine(c.euerLine, jahr)} der Anlage EÜR ${formYear(jahr)}` : c?.private ? 'Privat, zählt nicht zum Gewinn' : '';
    hint.hidden = !hint.textContent;
  }

  /** Felder für die Wiederholung – oder der Hinweis auf die Regel, zu der die Buchung gehört. */
  /** Auswahl des Projekts (Kostenstelle, lib/projekte.js); nur wenn es Projekte gibt. Abgeschlossene nur, wenn gewählt. */
  function projektWahl() {
    return raw(projektAuswahl(tx.projektId || '', { praefix: 'i_', hinweis: 'Zählt in der Auswertung des Projekts, wie eine Kostenstelle.' }));
  }

  /* ---------------------------------------------------------------------- */
  /* Besondere Steuerfälle (lib/sonderfaelle.js)                             */
  /* ---------------------------------------------------------------------- */

  /** Bei Differenzbesteuerung und Gutscheineinlösung ist der Betrag immer brutto. */
  const bruttoPflicht = (t) => t === 'differenz' || t === 'gutschein-einloesung';

  /** Sätze für die Auswahl: beim OSS die des Ziellandes, bei der Differenzbesteuerung nur 19 %, beim Mehrzweckgutschein 0 %. */
  function satzListe(treat) {
    if (treat === 'oss') {
      const s = ossSaetze(tx.oss?.land);
      return s.length ? s : [Number(tx.vatRate) || 19];
    }
    if (treat === 'differenz') return [DIFFERENZ_SATZ];
    if (treat === 'gutschein-mehrzweck') return [0];
    const s = [19, 7, 0];
    return s.includes(Number(tx.vatRate)) ? s : [...s, Number(tx.vatRate)];
  }

  const landName = (k) => LAENDER[k]?.name || k;

  /** Zusätzliche Angaben unter der umsatzsteuerlichen Behandlung. */
  function sonderFelder(treat) {
    if (treat === 'oss') {
      const land = String(tx.oss?.land || '').toUpperCase();
      const laender = Object.keys(EU_SAETZE).sort((a, b) => landName(a).localeCompare(landName(b), 'de'));
      return `<div class="field">
        <label for="i_ossLand">Land des Kunden</label>
        <select id="i_ossLand"><option value="">Bitte wählen</option>${laender.map((k) => `<option value="${k}" ${k === land ? 'selected' : ''}>${esc(landName(k))}</option>`).join('')}</select>
        <span class="hint">Es gilt der Steuersatz dieses Landes (Stand Oktober 2026, bitte prüfen). Der Betrag fehlt in der deutschen Voranmeldung und steht in der OSS-Meldung unter Auswertungen.</span>
      </div>
      <div class="field">
        <label for="i_ossArt">Verkauft wurde</label>
        <select id="i_ossArt">${Object.entries(OSS_ARTEN).map(([k, name]) => `<option value="${k}" ${k === ossArt(tx.oss?.art) ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
        <span class="hint">Die OSS-Meldung führt Warenlieferungen und Dienstleistungen (auch digitale) getrennt.</span>
      </div>`;
    }
    if (treat === 'differenz') {
      return `<div class="field">
        <label for="i_einkauf">Einkaufspreis der Ware</label>
        <input class="money-input" id="i_einkauf" inputmode="decimal" value="${tx.einkauf ? moneyInput(tx.einkauf) : ''}" placeholder="0,00">
        <span class="hint">Was Sie für das Stück bezahlt haben. Umsatzsteuer fällt nur auf den Gewinn an, mit 19 % im Preis enthalten. Auf der Rechnung steht keine Umsatzsteuer, sondern „Gebrauchtgegenstände/Sonderregelung“.</span>
      </div>`;
    }
    if (treat === 'gutschein-mehrzweck') {
      return `<div class="field full"><span class="hint">Ein Gutschein, der für verschiedene Waren oder Leistungen gilt (Mehrzweckgutschein). Der Verkauf ist eine Einnahme ohne Umsatzsteuer. Wird er eingelöst, buchen Sie die Einlösung als eigene Einnahme mit „Einlösung eines Mehrzweckgutscheins“. Gilt der Gutschein nur für eine Sache mit festem Steuersatz (Einzweckgutschein), buchen Sie ihn wie einen gewöhnlichen Verkauf mit Umsatzsteuer.</span></div>`;
    }
    if (treat === 'gutschein-einloesung') {
      return `<div class="field full"><span class="hint">Tragen Sie oben den Wert des eingelösten Gutscheins und den Steuersatz der Ware ein. Gebucht wird nur die Umsatzsteuer: Das Geld kam schon beim Verkauf des Gutscheins, der Gewinn ändert sich nicht.</span></div>`;
    }
    return '';
  }

  /** Kategorie für Fahrten mit einem Auto, das nicht zum Betrieb gehört (EÜR-Zeile 71). */
  const fahrtKategorie = () => sel.activeCategories('expense').find((c) => Number(c.euerLine) === FAHRT_ZEILE) || null;

  /** Kategorie für die private Nutzung des Firmenwagens (EÜR-Zeile 20). */
  const privatKategorie = () => sel.activeCategories('income').find((c) => Number(c.euerLine) === 20) || null;

  /** Ausgabe: Kilometer einer Fahrt mit dem eigenen Auto ergeben den Betrag. */
  function fahrtFelder() {
    if (tx.type !== 'expense' || stornoTeil || tx.splitId) return '';
    const f = tx.fahrt || {};
    const kat = fahrtKategorie();
    return `<details class="mt8" id="fahrtBox" ${f.km ? 'open' : ''}>
      <summary class="small muted" style="cursor:pointer;padding:4px 0">Fahrt mit dem eigenen Auto (Kilometerpauschale)</summary>
      <div class="form-grid mt8">
        <div class="field"><label for="i_fahrtKm">Gefahrene Kilometer</label><input id="i_fahrtKm" inputmode="decimal" value="${f.km ? esc(dz(f.km)) : ''}" placeholder="z. B. 84"></div>
        <div class="field"><label for="i_fahrtStrecke">Strecke und Anlass</label><input id="i_fahrtStrecke" maxlength="200" value="${esc(f.strecke || '')}" placeholder="z. B. Büro bis Kunde Weber, Montage"></div>
      </div>
      <span class="hint">Für Fahrten mit einem Auto, das nicht zum Betrieb gehört: ${esc(dz((KM_SATZ / 100).toFixed(2)))} € je Kilometer, ohne Umsatzsteuer.${kat ? ` Gebucht in „${esc(kat.name)}“.` : ''}</span>
      ${kat ? '' : `<button type="button" class="btn sm mt8" id="fahrtKat">${icon('plus', 14).__raw} Kategorie „Fahrten mit eigenem Auto“ anlegen</button>`}
    </details>`;
  }

  /** Einnahme: private Nutzung des Firmenwagens nach der 1-%-Regel. */
  function privatFelder() {
    if (tx.type !== 'income' || stornoTeil || tx.splitId) return '';
    const p = tx.privatnutzung || {};
    return `<details class="mt8" id="privatBox" ${p.listenpreis ? 'open' : ''}>
      <summary class="small muted" style="cursor:pointer;padding:4px 0">Private Nutzung des Firmenwagens (1-%-Regel)</summary>
      <div class="form-grid mt8">
        <div class="field"><label for="i_listenpreis">Bruttolistenpreis</label><input class="money-input" id="i_listenpreis" inputmode="decimal" value="${p.listenpreis ? moneyInput(p.listenpreis) : ''}" placeholder="z. B. 45.000,00"></div>
        <div class="field"><label for="i_antrieb">Antrieb</label><select id="i_antrieb">${Object.entries(KFZ_ANTRIEB).map(([k, [, name]]) => `<option value="${k}" ${p.antrieb === k ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div>
      </div>
      <span class="hint">Listenpreis des Neuwagens samt Sonderausstattung, auf volle 100 € abgerundet. Ergibt den Wert für einen Monat; wählen Sie unten „monatlich“ wiederholen. Die Umsatzsteuer rechnet immer mit 80 % von 1 %, auch beim Elektroauto. Preisgrenze für 0,25 %: 60.000 € bei Kauf bis 2023, 70.000 € ab 2024, 100.000 € ab Juli 2025.</span>
    </details>`;
  }

  /**
   * Wendet Behandlung und Helfer auf die Beträge an (nach der gewöhnlichen Aufteilung in collect).
   * Die Felder `oss`, `einkauf`, `gutscheinWert`, `fahrt`, `privatnutzung` stehen nur, solange sie gelten.
   */
  function sonderAnwenden(g, amount) {
    const treat = tx.vatTreatment || '';
    if (treat === 'oss' && tx.type === 'income') {
      const land = g('ossLand')?.value ?? tx.oss?.land ?? '';
      tx.oss = { land, art: ossArt(g('ossArt')?.value ?? tx.oss?.art) };
      // Ein Satz, den es im Zielland nicht gibt, wird dessen Regelsatz.
      if (ossLand(land) && !ossSaetze(land).includes(Number(tx.vatRate))) {
        tx.vatRate = ossRegelsatz(land);
        Object.assign(tx, pick(inputMode === 'net' ? splitFromNet(amount, tx.vatRate) : splitFromGross(amount, tx.vatRate)));
      }
    } else delete tx.oss;
    if (treat === 'differenz' && tx.type === 'income') {
      tx.einkauf = Math.max(0, parseMoney(g('einkauf')?.value || ''));
      tx.vatRate = DIFFERENZ_SATZ;
      Object.assign(tx, pick(differenzSteuer(amount, tx.einkauf)));
    } else delete tx.einkauf;
    if (treat === 'gutschein-einloesung' && tx.type === 'income') {
      const e = gutscheinEinloesung(amount, tx.vatRate);
      tx.gutscheinWert = e.wert;
      Object.assign(tx, pick(e));
      // Kein Geldfluss: ohne Konto, eingelöst am Tag der Buchung.
      tx.accountId = '';
      tx.paidDate = tx.paidDate || tx.date;
    } else delete tx.gutscheinWert;
    if (treat === 'gutschein-mehrzweck') { tx.vatRate = 0; Object.assign(tx, { net: tx.gross, vat: 0 }); }
    const km = Number(String(g('fahrtKm')?.value || '').replace(',', '.'));
    if (tx.type === 'expense' && g('fahrtKm') && km > 0) {
      const f = fahrtBetrag(km);
      tx.fahrt = { km: f.km, satz: f.satz, strecke: g('fahrtStrecke')?.value.trim() || '' };
      tx.vatRate = 0;
      Object.assign(tx, pick(f));
    } else if (g('fahrtKm') || tx.type !== 'expense') delete tx.fahrt;
    const lp = parseMoney(g('listenpreis')?.value || '');
    if (tx.type === 'income' && g('listenpreis') && lp > 0) {
      const antrieb = g('antrieb')?.value || 'verbrenner';
      const p = privatnutzung(lp, antrieb);
      tx.privatnutzung = { listenpreis: p.listenpreis, antrieb, prozent: p.prozent, ustBasis: klein ? 0 : p.ustBasis };
      tx.vatRate = klein ? 0 : 19;
      Object.assign(tx, klein ? { gross: p.net, net: p.net, vat: 0 } : pick(p));
    } else if (g('listenpreis') || tx.type !== 'income') delete tx.privatnutzung;
    // Entnahme und Nutzungseinlage bewegen kein Geld: ohne Konto, am Tag der Buchung (lib/sonderfaelle.js: ohneGeldfluss).
    // Sie sind gewöhnlich besteuert; eine besondere Behandlung daneben gilt nicht.
    if (tx.fahrt || tx.privatnutzung) {
      for (const k of ['vatTreatment', 'oss', 'einkauf', 'gutscheinWert']) delete tx[k];
      tx.accountId = '';
      tx.paidDate = tx.paidDate || tx.date;
    }
  }

  const pick = ({ gross, net, vat }) => ({ gross, net, vat });

  function wiederholungsFelder() {
    if (stornoTeil) return '';
    const regel = tx.recurringId ? sel.recurringRule(tx.recurringId) : null;
    if (regel) {
      return `<div class="field full"><label>Wiederholung</label><div class="small">Entstanden aus der wiederkehrenden Buchung
        „${esc(regel.template?.description || '')}“ (${esc(TURNUS[regel.freq]?.[0] || '')}). Turnus und Vorlage ändern Sie unter
        Stammdaten → Wiederkehrend.</div></div>`;
    }
    if (locked) return '';
    return `<div class="field" data-premium="wiederkehrend" data-ohne-krone>
        <label for="i_repeat" data-krone="wiederkehrend">Wiederholen</label>
        <select id="i_repeat">
          <option value="">nicht wiederholen</option>
          ${Object.entries(TURNUS).map(([k, [name]]) => `<option value="${k}" ${wiederholung.freq === k ? 'selected' : ''}>${esc(name)}</option>`).join('')}
        </select>
        <span class="hint">Für Miete, Telefon, Abos: Kontovia bietet die nächsten Buchungen zum Anlegen an, sobald sie fällig sind.</span>
      </div>
      <div class="field" data-premium="wiederkehrend" data-ohne-krone>
        <label for="i_repeatUntil">Wiederholen bis (freiwillig)</label>
        <input type="date" id="i_repeatUntil" value="${esc(wiederholung.until)}" ${wiederholung.freq ? '' : 'disabled'}>
      </div>
      <div class="field" data-premium="wiederkehrend" data-ohne-krone>
        <label for="i_repeatCount">Oder nach so vielen Buchungen (freiwillig)</label>
        <input type="number" min="0" max="999" id="i_repeatCount" value="${wiederholung.anzahl || ''}" ${wiederholung.freq ? '' : 'disabled'}>
        <span class="hint">Diese Buchung zählt mit.</span>
      </div>`;
  }

  /** Mehrere Steuersätze auf einem Beleg: weitere Zeilen mit Satz und Betrag, oder der Hinweis, dass diese Buchung schon ein Teil ist. */
  function satzFelder() {
    if (klein) return '';
    if (tx.splitId) {
      return `<p class="small muted mt8 mb0">Das ist Teil ${esc(String(tx.splitTeil || ''))} von ${esc(String(tx.splitAnzahl || ''))} eines Belegs mit mehreren Steuersätzen. Jede Buchung hat ihren Satz; Datum, Beleg und Konto gelten für alle.</p>`;
    }
    if (!isNew) return '';
    const betragName = inputMode === 'gross' ? 'Bruttobetrag' : 'Nettobetrag';
    const zeilen = satzTeile.map((z, i) => `
      <div class="form-grid c3 mt8" data-satzzeile="${i}">
        <div class="field"><label for="i_satzBetrag${i}">${betragName}, weiterer Satz</label>
          <input class="money-input" id="i_satzBetrag${i}" data-satzbetrag="${i}" inputmode="decimal" value="${esc(z.betrag)}" placeholder="0,00"></div>
        <div class="field"><label for="i_satzSatz${i}">Umsatzsteuersatz</label>
          <select id="i_satzSatz${i}" data-satzsatz="${i}">${SAETZE.map((s) => `<option value="${s}" ${Number(z.satz) === s ? 'selected' : ''}>${s} %</option>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><button type="button" class="btn sm ghost" data-satzweg="${i}" aria-label="Diesen Steuersatz entfernen">${icon('trash', 14).__raw} Entfernen</button></div>
      </div>`).join('');
    return `
      <details class="mt8" id="satzBox" ${satzTeile.length ? 'open' : ''}>
        <summary class="small muted" style="cursor:pointer;padding:4px 0">Mehrere Steuersätze auf demselben Beleg</summary>
        <p class="small muted mt8 mb0">Etwa beim Supermarkt-Bon oder der Rechnung eines Cafés mit 7 % und 19 %. Oben tragen Sie den ersten Satz mit seinem Betrag ein, hier die weiteren. Jeder Satz wird eine eigene Buchung mit demselben Datum, Beleg und Konto.</p>
        ${zeilen}
        ${satzTeile.length < MAX_SAETZE - 1 ? `<button type="button" class="btn sm mt8" id="satzNeu">${icon('plus', 14).__raw} Weiteren Steuersatz hinzufügen</button>` : ''}
        <div class="small mt8" id="satzSumme" aria-live="polite"></div>
      </details>`;
  }

  /** Die Zeilen mit Betrag als Teile in Cent (die Eingabe folgt der Wahl Brutto oder Netto). */
  const satzExtras = () => satzTeile.map((z) => ({ satz: Number(z.satz), betrag: parseMoney(z.betrag) }));

  function satzVorschau() {
    const box = form.querySelector('#satzSumme');
    if (!box) return;
    collect();
    const teile = weitereTeile(tx.vatRate, satzExtras());
    if (!teile.length) { box.textContent = ''; return; }
    const s = satzSumme(tx, satzExtras(), { netto: inputMode === 'net' });
    const doppelt = doppelterSatz(tx.vatRate, satzExtras());
    box.innerHTML = html`<span class="muted">${s.anzahl} Buchungen zusammen:</span> Netto <strong class="num">${money(s.net)} €</strong>, Umsatzsteuer <strong class="num">${money(s.vat)} €</strong>, Brutto <strong class="num">${money(s.gross)} €</strong>${doppelt !== null ? raw(`<div class="neg mt8">Der Satz ${doppelt} % kommt zweimal vor. Jeder Satz darf nur einmal vorkommen.</div>`) : ''}`;
  }

  /** Ratenzahlung: eine neue Buchung in mehrere aufteilen – oder der Hinweis, dass diese schon eine Rate ist. */
  function ratenFelder() {
    if (tx.ratenId) {
      return `<div class="field full"><label>Ratenzahlung</label><div class="small">Das ist Rate ${esc(String(tx.rate || ''))} von ${esc(String(tx.raten || ''))}.
        Jede Rate hat ihre eigene Fälligkeit und wird einzeln als bezahlt eingetragen.</div></div>`;
    }
    if (!isNew || stornoTeil) return '';
    return `<div class="field">
        <label for="i_raten">In Raten aufteilen</label>
        <input type="number" min="0" max="${MAX_RATEN}" id="i_raten" placeholder="keine" value="${ratenWahl.anzahl || ''}">
        <span class="hint" id="ratenHinweis">Für Anschaffungen auf Raten oder Rechnungen mit Zahlungsplan: Jede Rate wird eine eigene Buchung mit eigener Fälligkeit.</span>
      </div>
      <div class="field">
        <label for="i_ratenFreq">Rhythmus der Raten</label>
        <select id="i_ratenFreq">${Object.entries(TURNUS).map(([k, [name]]) => `<option value="${k}" ${ratenWahl.freq === k ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
        <span class="hint">Die erste Rate ist zum Fälligkeitsdatum fällig, sonst zum Datum der Buchung.</span>
      </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* E-Rechnung im Beleg                                                     */
  /* ---------------------------------------------------------------------- */

  /** Der passende Kontakt zur Gegenseite der Rechnung – über USt-IdNr. oder Namen. */
  function passenderKontakt(p) {
    const id = String(p?.ustId || '').replace(/\s/g, '').toUpperCase();
    const name = norm(p?.name);
    return sel.contacts().find((c) => (id && String(c.taxId || '').replace(/\s/g, '').toUpperCase() === id)
      || (name && norm(c.name) === name)) || null;
  }

  const gegenseite = (r) => (tx.type === 'income' ? r.kaeufer : r.verkaeufer);

  /** Hinweis über den Belegen, sobald ein neuer Beleg eine E-Rechnung enthält. */
  function drawERechnung() {
    const box = form.querySelector('#eInvoiceBox');
    if (!box) return;
    if (!erkannt || stornoTeil || (locked && !zahlungOffen)) { box.innerHTML = ''; return; }
    const r = erkannt;
    const saetze = [...new Set(r.steuersaetze.map((s) => s.satz))];
    const partner = gegenseite(r);
    const fehlt = partner?.name && !passenderKontakt(partner);
    box.innerHTML = html`
      <div class="notice ok erech-hinweis mb8">
        <strong>E-Rechnung erkannt</strong> (${r.format}): ${partner?.name || 'ohne Namen'}${r.nummer ? ` · Nr. ${r.nummer}` : ''}
        · ${money(r.brutto ?? r.zahlbetrag ?? 0)} ${istFremd(r.waehrung) ? r.waehrung : '€'} vom ${fmtDate(r.datum)}
        ${saetze.length > 1 ? raw(`<div class="small mt8">Die Rechnung enthält mehrere Steuersätze (${esc(saetze.map((s) => `${s} %`).join(', '))}). Übernommen werden Datum, Nummer und Kontakt; die Beträge bitte je Steuersatz als eigene Buchung erfassen.</div>`) : ''}
        <div class="row wrap mt8">
          ${locked ? '' : raw('<button type="button" class="btn sm primary" data-erech-take>Werte übernehmen</button>')}
          <button type="button" class="btn sm" data-erech-show>Rechnung ansehen</button>
          ${fehlt && !locked ? raw(`<button type="button" class="btn sm" data-erech-contact>Kontakt „${esc(partner.name)}“ anlegen</button>`) : ''}
        </div>
      </div>`;
    box.querySelector('[data-erech-take]')?.addEventListener('click', () => uebernehmen(r));
    box.querySelector('[data-erech-show]').addEventListener('click', () => zeigeERechnung(r, { onUebernehmen: locked ? null : () => uebernehmen(r) }));
    box.querySelector('[data-erech-contact]')?.addEventListener('click', async () => {
      collect();
      const p = gegenseite(r);
      const kontakt = {
        id: uid('con'), name: p.name, kind: tx.type === 'income' ? 'customer' : 'supplier',
        email: p.email || '', phone: '', address: p.anschrift || '', taxId: p.ustId || p.steuernummer || '', notes: '',
      };
      await upsertEntity('contacts', kontakt, 'kontakt');
      tx.contactId = kontakt.id;
      ok('Kontakt angelegt', kontakt.name);
      draw();
    });
  }

  /**
   * Trägt die Werte der E-Rechnung ins Formular ein. Gespeichert wird erst mit
   * „Buchung anlegen“ – vorher lässt sich alles prüfen und ändern.
   */
  function uebernehmen(r) {
    collect();
    const art = richtung(r, store.db.settings);
    if (art && art !== tx.type) {
      tx.type = art;
      const cats = sel.activeCategories(tx.type);
      if (!cats.some((c) => c.id === tx.categoryId)) tx.categoryId = cats[0]?.id || '';
    }
    const partner = gegenseite(r);
    if (!tx.description) tx.description = [partner?.name, r.nummer ? `Rechnung ${r.nummer}` : ''].filter(Boolean).join(', ').slice(0, 200);
    if (r.datum) tx.date = r.datum;
    if (r.faellig) tx.dueDate = r.faellig;
    // Eine neu erfasste Rechnung, deren Fälligkeit noch aussteht, ist in aller Regel noch nicht bezahlt.
    if (isNew && r.faellig && r.faellig > todayISO()) tx.paidDate = '';
    if (r.nummer) tx.invoiceNumber = r.nummer.slice(0, 60);
    if (r.verwendungszweck && !tx.reference) tx.reference = r.verwendungszweck.slice(0, 140);
    const kontakt = passenderKontakt(partner);
    if (kontakt) tx.contactId = kontakt.id;
    const vz = r.gutschrift ? -1 : 1;
    const saetze = [...new Set(r.steuersaetze.map((s) => s.satz))];
    // Ohne Aufschlüsselung nur dann 0 %, wenn die Rechnung auch keine Steuer ausweist.
    const satz = saetze.length === 1 ? saetze[0] : saetze.length === 0 && !r.steuer ? 0 : null;
    if (istFremd(r.waehrung)) {
      // Fremdwährung: Der Betrag steht nicht in Euro. Er kommt ins Feld der Währung; mit dem Kurs rechnet Kontovia um.
      tx.fremd = { waehrung: r.waehrung, betrag: Math.abs(r.brutto ?? r.zahlbetrag ?? 0), kurs: 0 };
      tx.gross = 0; tx.net = 0; tx.vat = 0;
      inputMode = 'gross';
      draw();
      warn(`Rechnung in ${r.waehrung}`, 'Bitte tragen Sie unter „In fremder Währung“ den Kurs ein, dann rechnet Kontovia den Betrag in Euro um.');
      return;
    }
    if (klein) {
      const brutto = Math.abs(r.brutto ?? r.zahlbetrag ?? 0);
      if (brutto) { tx.gross = vz * brutto; tx.net = tx.gross; tx.vat = 0; inputMode = 'gross'; }
    } else if ([19, 7, 0].includes(satz) && r.netto !== null) {
      // Netto eingeben: Die Steuer rechnet sich daraus genau wie auf der Rechnung.
      tx.vatRate = satz;
      tx.net = vz * Math.abs(r.netto);
      inputMode = 'net';
    } else if (saetze.length <= 1) {
      warn('Betrag nicht übernommen', saetze.length
        ? `Die Rechnung nennt ${saetze[0]} %. Bitte Betrag und Satz selbst eintragen.`
        : 'Die Rechnung schlüsselt die Umsatzsteuer nicht auf. Bitte Betrag und Satz selbst eintragen.');
    }
    draw();
    ok('Werte übernommen', 'Bitte prüfen, Kategorie wählen und die Buchung anlegen.');
  }

  /** Prüft neu angehängte Belege auf eine E-Rechnung. */
  async function pruefeERechnung(dateien) {
    for (const { bytes, meta } of dateien) {
      try {
        const r = await eRechnungAusDatei(bytes, meta);
        if (r) { erkannt = r; drawERechnung(); drawBelegGelesen(); return; }
      } catch { /* kein Hinweis – der Beleg bleibt trotzdem angehängt */ }
    }
  }

  /**
   * „Beleg lesen“: Ohne E-Rechnung liest Kontovia den Beleg selbst (PDF-Text, sonst Texterkennung des Fotos,
   * alles auf dem Gerät) und bietet die Werte an. Übernommen wird erst auf Klick.
   */
  async function belegLesen(dateien) {
    if (erkannt || locked) return;
    const datei = dateien.find((d) => belegLesbar(d.meta));
    if (!datei) return;
    if (!kann('beleglesen')) { leseStand = 'gesperrt'; drawBelegGelesen(); return; }
    leseStand = 'liest';
    gelesen = null;
    drawBelegGelesen();
    try {
      gelesen = await belegErkennen(datei.bytes, datei.meta);
      leseStand = gelesen ? '' : 'fehler';
      leseFehler = gelesen ? '' : 'Auf dem Beleg war kein Betrag und kein Datum zu erkennen. Bitte tragen Sie die Angaben von Hand ein.';
    } catch (e) {
      leseStand = 'fehler';
      leseFehler = e.message;
    }
    if (form.isConnected) drawBelegGelesen();
  }

  function drawBelegGelesen() {
    const box = form.querySelector('#belegLeseBox');
    if (!box) return;
    if (erkannt || stornoTeil || locked || !leseStand && !gelesen) { box.innerHTML = ''; return; }
    if (leseStand === 'gesperrt') {
      box.innerHTML = html`<div class="small mb8"><button type="button" class="btn sm ghost" data-premium="beleglesen">${icon('search', 14)} Beleg automatisch lesen</button></div>`;
      return;
    }
    if (leseStand === 'liest') {
      box.innerHTML = html`<div class="notice mb8 small" role="status"><span class="dreht">${icon('refresh', 14)}</span> Beleg wird gelesen … Das bleibt auf diesem Gerät.</div>`;
      return;
    }
    if (leseStand === 'fehler') {
      box.innerHTML = html`<div class="notice mb8 small">${leseFehler}</div>`;
      return;
    }
    const v = gelesen.vorschlag;
    const teile = [
      v.lieferant,
      v.brutto !== null ? `${money(v.brutto)} €` : '',
      v.datum ? `vom ${fmtDate(v.datum)}` : '',
      v.saetze.length > 1 ? `USt ${v.saetze.join(' und ')} %` : v.satz !== null ? `USt ${v.satz} %` : '',
      v.nummer ? `Nr. ${v.nummer}` : '',
      v.kategorieId && sel.category(v.kategorieId) ? `Kategorie ${sel.category(v.kategorieId).name}` : '',
    ].filter(Boolean);
    const quelle = { pdf: 'aus dem PDF', scan: 'aus dem Scan', foto: 'aus dem Foto' }[gelesen.quelle] || '';
    box.innerHTML = html`
      <div class="notice ok erech-hinweis mb8">
        <strong>Beleg gelesen</strong> ${quelle ? `(${quelle})` : ''}: ${teile.join(' · ')}
        ${v.saetze.length > 1 ? raw(html`<div class="small mt8">Der Beleg nennt mehrere Steuersätze. Übernommen wird der Gesamtbetrag mit ${v.satz} %; teilen Sie ihn bei Bedarf auf.</div>`) : ''}
        <div class="small muted mt8">Bitte prüfen Sie die Werte, bevor Sie die Buchung anlegen.</div>
        <div class="row wrap mt8">
          <button type="button" class="btn sm primary" data-gelesen-take>Werte übernehmen</button>
          <button type="button" class="btn sm" data-gelesen-text>Gelesenen Text ansehen</button>
        </div>
      </div>`;
    box.querySelector('[data-gelesen-take]').addEventListener('click', () => gelesenUebernehmen(v));
    box.querySelector('[data-gelesen-text]').addEventListener('click', () => {
      const m = modal({
        title: 'Gelesener Text',
        body: html`<p class="small muted mt0">So hat Kontovia den Beleg gelesen. Fehler beim Lesen sind bei Fotos möglich.</p>
          <pre class="beleg-text" translate="no">${gelesen.text}</pre>`,
        foot: html`<button class="btn" data-no>Schließen</button>`,
      });
      m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    });
  }

  /** Trägt den Vorschlag ein: nur, was gelesen wurde; Beschreibung nur, wenn sie noch leer ist. */
  function gelesenUebernehmen(v) {
    collect();
    if (!tx.description) tx.description = [v.lieferant, v.nummer ? `Rechnung ${v.nummer}` : ''].filter(Boolean).join(', ').slice(0, 200);
    if (v.datum) tx.date = v.datum;
    if (v.faellig) tx.dueDate = v.faellig;
    if (isNew && v.faellig && v.faellig > todayISO()) tx.paidDate = '';
    if (v.nummer && !tx.invoiceNumber) tx.invoiceNumber = v.nummer.slice(0, 60);
    if (v.kontaktId) tx.contactId = v.kontaktId;
    // Kategorie nur, wenn noch keine gewählt ist und sie zur Art der Buchung passt.
    const kat = v.kategorieId && sel.category(v.kategorieId);
    if (kat && !tx.categoryId && kat.kind === tx.type) tx.categoryId = kat.id;
    if (v.brutto !== null && v.brutto > 0) {
      const vz = tx.gross < 0 ? -1 : 1;
      if (!klein && [19, 7, 0].includes(v.satz)) tx.vatRate = v.satz;
      tx.gross = vz * v.brutto;
      const rate = klein ? 0 : Number(tx.vatRate) || 0;
      tx.net = Math.round(tx.gross / (1 + rate / 100));
      tx.vat = tx.gross - tx.net;
      inputMode = 'gross';
    }
    draw();
    ok('Werte übernommen', 'Bitte prüfen, Kategorie wählen und die Buchung anlegen.');
  }

  /* ---------------------------------------------------------------------- */

  function collect() {
    const g = (id) => form.querySelector('#i_' + id);
    tx.description = g('description').value.trim();
    tx.date = g('date').value || todayISO();
    tx.categoryId = g('categoryId').value;
    tx.contactId = g('contactId').value;
    tx.accountId = g('accountId').value;
    tx.invoiceNumber = g('invoiceNumber').value.trim();
    tx.dueDate = g('dueDate').value;
    tx.paidDate = g('isPaid').checked ? (g('paidDate').value || todayISO()) : '';
    tx.reference = g('reference')?.value.trim() || '';
    if (g('projektId')) tx.projektId = g('projektId').value;
    tx.notes = g('notes')?.value.trim() || '';
    tx.unlisted = !!g('unlisted')?.checked;
    if (g('repeat')) {
      wiederholung.freq = g('repeat').value;
      wiederholung.until = wiederholung.freq ? (g('repeatUntil')?.value || '') : '';
      wiederholung.anzahl = wiederholung.freq ? Math.max(0, Math.round(Number(g('repeatCount')?.value) || 0)) : 0;
    }
    if (g('raten')) {
      ratenWahl.anzahl = Math.max(0, Math.round(Number(g('raten').value) || 0));
      ratenWahl.freq = g('ratenFreq')?.value || 'monthly';
    }
    // Ort und Anzahlung gibt es nur bei Einnahmen; wechselt die Art, fallen sie weg.
    if (tx.type === 'income') {
      tx.location = g('location') ? g('location').value.trim() : (tx.location || '');
      tx.isDeposit = !!g('isDeposit')?.checked;
      tx.depositPercent = tx.isDeposit ? parsePercent(g('depositPercent')?.value) : 0;
      tx.eventDate = tx.isDeposit ? (g('eventDate')?.value || '') : '';
    } else {
      tx.location = '';
      tx.isDeposit = false;
      tx.depositPercent = 0;
      tx.eventDate = '';
    }
    if (!klein) {
      tx.vatRate = Number(g('vatRate').value);
      // Festgehalten wird nur eine bewusste Wahl. Bis 2.26 stand hier immer der
      // abgeleitete Wert, auch „steuerfrei“ ohne Kategorie (Kennzahl 48).
      const tv = g('vatTreatment')?.value;
      const ohne = { ...tx };
      delete ohne.vatTreatment;
      if (tv && tv !== 'ohne-kategorie' && tv !== vatTreatment(store.db, ohne)) tx.vatTreatment = tv;
      else delete tx.vatTreatment;
      if (tx.type === 'expense' && g('lieferantIst')?.checked) tx.lieferantIst = true;
      else delete tx.lieferantIst;
    } else {
      tx.vatRate = 0;
    }
    const amount = parseMoney(g('amount').value);
    const split = (inputMode === 'net' && !klein) ? splitFromNet(amount, tx.vatRate) : splitFromGross(amount, klein ? 0 : tx.vatRate);
    tx.gross = split.gross;
    tx.net = split.net;
    tx.vat = split.vat;
    sonderAnwenden(g, amount);
    // Fremdwährung (lib/waehrung.js): nur mit Währung, Betrag und gültigem Kurs; `netto`, wenn der Betrag netto eingegeben wurde.
    const fw = g('fremdW')?.value || '';
    const fk = kursLesen(g('fremdKurs')?.value);
    const fb = parseMoney(g('fremdBetrag')?.value || '');
    if (istFremd(fw) && kursGueltig(fk) && fb) tx.fremd = { waehrung: fw, betrag: Math.abs(fb), kurs: fk, ...(inputMode === 'net' && !klein ? { netto: true } : {}) };
    else delete tx.fremd;
    tx.attachments = attachments.map((a) => a.id);
  }

  function updateAmountSummary() {
    collect();
    const box = form.querySelector('#amountSummary');
    if (!box) return;
    // Kilometer und Listenpreis bestimmen den Betrag; das Betragsfeld zeigt das Ergebnis.
    const amt = form.querySelector('#i_amount');
    if (amt && (tx.fahrt || tx.privatnutzung)) {
      amt.value = moneyInput(inputMode === 'net' && !klein ? tx.net : tx.gross);
      amt.readOnly = true;
    } else if (amt) amt.readOnly = false;
    const t = tx.vatTreatment || '';
    if (!klein && t === 'differenz') {
      const d = differenzSteuer(tx.gross, tx.einkauf);
      box.innerHTML = html`
        <span><span class="muted">Verkauf</span> <strong class="num">${money(tx.gross)} €</strong></span>
        <span><span class="muted">Gewinn</span> <strong class="num">${money(d.marge)} €</strong></span>
        <span><span class="muted">darin Umsatzsteuer 19 %</span> <strong class="num">${money(tx.vat)} €</strong></span>`;
      updateDepositSummary();
      return;
    }
    if (!klein && t === 'gutschein-einloesung') {
      box.innerHTML = html`
        <span><span class="muted">Gutschein</span> <strong class="num">${money(tx.gutscheinWert || 0)} €</strong></span>
        <span><span class="muted">darin Umsatzsteuer ${dz(tx.vatRate)} %</span> <strong class="num">${money(tx.vat)} €</strong></span>
        <span class="badge">Kein Geldfluss</span>`;
      updateDepositSummary();
      return;
    }
    if (tx.privatnutzung) {
      box.innerHTML = html`
        <span><span class="muted">Wert im Monat</span> <strong class="num">${money(tx.net)} €</strong></span>
        ${klein ? '' : raw(html`<span><span class="muted">Umsatzsteuer auf ${money(tx.privatnutzung.ustBasis)} €</span> <strong class="num">${money(tx.vat)} €</strong></span>`)}
        <span class="badge">Kein Geldfluss</span>`;
      updateDepositSummary();
      return;
    }
    box.innerHTML = klein
      ? html`<span class="muted">Betrag:</span> <strong class="num">${money(tx.gross)} €</strong>`
      : html`
        <span><span class="muted">Netto</span> <strong class="num">${money(tx.net)} €</strong></span>
        <span><span class="muted">Umsatzsteuer ${tx.vatRate} %</span> <strong class="num">${money(tx.vat)} €</strong></span>
        <span><span class="muted">Brutto</span> <strong class="num">${money(tx.gross)} €</strong></span>
        ${tx.type === 'expense' && tx.vat ? raw('<span class="badge info">Vorsteuer abziehbar</span>') : ''}`;
    updateDepositSummary();
  }

  /**
   * Zeigt, was sich aus Anzahlung und Prozentsatz ergibt: der vereinbarte
   * Gesamtbetrag und der Rest, der zum Veranstaltungstag noch aussteht.
   */
  function updateDepositSummary() {
    const box = form.querySelector('#depositSummary');
    if (!box) return;
    collect();
    const dep = depositInfo(tx);
    if (!dep) { box.innerHTML = ''; return; }
    if (!dep.percent || !dep.total) {
      box.innerHTML = html`<p class="muted small mb0">Sobald der Anteil eingetragen ist, rechnet Kontovia den Gesamtbetrag und den offenen Rest aus.</p>`;
      return;
    }
    box.innerHTML = html`
      <div class="notice">
        <div class="row wrap" style="gap:18px;font-size:13px">
          <span><span class="muted">Anzahlung</span> <strong class="num">${money(tx.gross)} €</strong></span>
          <span><span class="muted">Gesamtbetrag</span> <strong class="num">${money(dep.total)} €</strong></span>
          <span><span class="muted">Restbetrag</span> <strong class="num">${money(dep.remaining)} €</strong></span>
          ${dep.eventDate ? raw(`<span><span class="muted">fällig zum</span> <strong>${esc(fmtDate(dep.eventDate))}</strong></span>`) : ''}
        </div>
        ${dep.remaining > 0 ? raw('<button class="btn sm mt8" id="btnRest">Restzahlung als offene Buchung vorbereiten</button>') : ''}
      </div>`;
    box.querySelector('#btnRest')?.addEventListener('click', createRemainder);
  }

  /**
   * Legt aus dem offenen Rest eine zweite, noch unbezahlte Buchung an –
   * datiert auf den Veranstaltungstag. Die Anzahlung selbst wird vorher
   * gespeichert, damit beim Wechsel in den zweiten Dialog nichts verloren geht.
   */
  async function createRemainder() {
    collect();
    const dep = depositInfo(tx);
    if (!dep || dep.remaining <= 0) { warn('Kein offener Restbetrag'); return; }
    if (!await saveTransaction()) return;
    const rest = {
      ...newTransactionDraft('income'),
      description: `Restzahlung: ${tx.description}`,
      categoryId: tx.categoryId,
      contactId: tx.contactId,
      accountId: tx.accountId,
      location: tx.location,
      reference: tx.reference,
      vatRate: tx.vatRate,
      date: dep.eventDate || todayISO(),
      dueDate: dep.eventDate || '',
      paidDate: '',
      notes: `Restbetrag nach Anzahlung vom ${fmtDate(tx.date)} (${percentText(dep.percent)} % von ${money(dep.total)} €).`,
      ...splitFromGross(dep.remaining, klein ? 0 : tx.vatRate),
    };
    m.close();
    ok('Anzahlung gespeichert', 'Der Restbetrag ist vorbereitet. Bitte noch prüfen und anlegen.');
    refresh();
    setTimeout(() => openTransactionDialog(rest), 60);
  }

  function drawAttachments() {
    const list = form.querySelector('#attachList');
    if (!attachments.length) {
      list.innerHTML = tx.type === 'income'
        ? '<p class="muted tiny mb0">Noch kein Beleg. Eine Kopie jeder eigenen Rechnung gehört in Ihre Unterlagen.</p>'
        : '<p class="muted tiny mb0">Noch kein Beleg. Hängen Sie ihn am besten gleich an, das Finanzamt fragt danach.</p>';
      return;
    }
    list.innerHTML = attachments.map((a) => `
      <div class="attach" data-att="${esc(a.id)}">
        <div class="thumb">${a.recovered ? '?' : esc((a.fileName.split('.').pop() || '?').slice(0, 4).toUpperCase())}</div>
        <div class="name" title="${esc(a.fileName)}">${esc(a.fileName)}<div class="tiny muted">${a.recovered
          ? 'aus einer älteren Fassung wiederhergestellt, Name und Prüfsumme fehlen'
          : `${esc(bytes(a.size))} · Prüfsumme ${esc(String(a.sha256 || '').slice(0, 10))}…`}</div></div>
        <button class="btn sm ghost" data-view-att="${esc(a.id)}" title="Ansehen">${icon('eye', 14).__raw}</button>
        <button class="btn sm ghost" data-save-att="${esc(a.id)}" title="Speichern unter">${icon('save', 14).__raw}</button>
        <button class="btn sm ghost" data-del-att="${esc(a.id)}" title="Entfernen">${icon('trash', 14).__raw}</button>
      </div>`).join('');

    list.querySelectorAll('[data-view-att]').forEach((b) => b.addEventListener('click', () => {
      // Ein gerade erst angehängter Beleg steht noch nicht im Bestand – seine
      // Angaben kommen deshalb aus diesem Dialog.
      previewAttachment(b.dataset.viewAtt, attachments.find((x) => x.id === b.dataset.viewAtt));
    }));
    list.querySelectorAll('[data-save-att]').forEach((b) => b.addEventListener('click', async () => {
      const a = attachments.find((x) => x.id === b.dataset.saveAtt);
      const p = await api.attach.saveAs(a.id, a.fileName);
      if (p) ok('Beleg gespeichert', p);
    }));
    list.querySelectorAll('[data-del-att]').forEach((b) => b.addEventListener('click', async () => {
      const id2 = b.dataset.delAtt;
      if (!await confirmDialog({ title: 'Beleg entfernen?', text: 'Die Datei wird endgültig aus dem Tresor gelöscht.', confirmLabel: 'Entfernen', danger: true })) return;
      attachments = attachments.filter((x) => x.id !== id2);
      await api.attach.remove(id2);
      const i = addedAttachments.findIndex((x) => x.id === id2);
      if (i >= 0) addedAttachments.splice(i, 1);
      // War der Beleg bereits gespeichert, muss sein Eintrag mit Grabstein
      // verschwinden – sonst holt ihn der nächste Abgleich zurück.
      else await removeAttachmentRecord(id2);
      drawAttachments();
    }));
  }

  async function addFiles(files) {
    const neu = [];
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        const meta = await api.attach.add(f.name, f.type || 'application/octet-stream', b64);
        attachments.push(meta);
        addedAttachments.push(meta);
        neu.push({ bytes: new Uint8Array(buf), meta });
      } catch (e) {
        err('Beleg konnte nicht gespeichert werden', e.message);
      }
    }
    drawAttachments();
    pruefeERechnung(neu).then(() => belegLesen(neu));
  }

  /**
   * „Gehört zu“: Rechnung (auch die gemahnte bei Mahnkosten), Projekt, Kontakt und verknüpfte Termine einer
   * gespeicherten Buchung, je ein Sprung dorthin (lib/oeffnen.js). Vorher schließt das Fenster, mit Rückfrage bei
   * ungespeicherten Änderungen.
   */
  function bezuegeHtml(termine) {
    if (isNew) return '';
    const rechnung = sel.invoices().find((r) => (r.transactionIds || []).includes(tx.id)) || (tx.mahnRechnungId ? sel.invoice(tx.mahnRechnungId) : null);
    const mahnungen = rechnung ? (store.db.reminders || []).filter((x) => x.invoiceId === rechnung.id).length : 0;
    const projekt = tx.projektId ? sel.projekt(tx.projektId) : null;
    const kontakt = tx.contactId ? sel.contact(tx.contactId) : null;
    // Namen und Nummern stehen in eigenen Elementen: Sie bleiben, wie sie sind, die Beschriftung drumherum wird übersetzt.
    const name = (x) => `<span translate="no">${esc(x)}</span>`;
    const ziele = [
      ...(rechnung ? [['rechnung', rechnung.id, 'invoice', rechnung.richtung === 'eingang' ? `Eingangsrechnung ${name(rechnung.nummer || '')}`
        : `${rechnung.nummer ? `Rechnung ${name(rechnung.nummer)}` : 'Rechnungsentwurf'}${mahnungen ? `, ${mahnungen === 1 ? '1 Mahnung' : `${mahnungen} Mahnungen`}` : ''}`]] : []),
      ...(projekt ? [['projekt', projekt.id, 'folder', `Projekt ${name(projekt.name)}`]] : []),
      ...(kontakt ? [['kontakt', kontakt.id, 'users', name(kontakt.name)]] : []),
      ...termine.map((a) => ['termin', a.id, 'calendar', `${name(a.title)} · ${esc(fmtDate(a.date))}`]),
    ];
    if (!ziele.length) return '';
    return `<hr class="sep">
      <div class="row between mb8"><strong style="font-size:13px">Gehört zu</strong></div>
      <div class="bezuege">${ziele.map(([art, id, sym, inhalt]) => `<button type="button" class="chip bezug-chip" data-bezug="${esc(art)}:${esc(id)}">${icon(sym, 13).__raw}<span class="truncate">${inhalt}</span></button>`).join('')}</div>`;
  }

  function wireForm() {
    form.querySelectorAll('[data-bezug]').forEach((b) => b.addEventListener('click', async () => {
      const [art, id] = b.dataset.bezug.split(':');
      await m.dismiss();
      if (!m.root.isConnected) eintragOeffnen(art, id);
    }));
    form.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
      collect();
      tx.type = b.dataset.type;
      const cats = sel.activeCategories(tx.type);
      if (!cats.some((c) => c.id === tx.categoryId)) tx.categoryId = cats[0]?.id || '';
      draw();
    }));
    form.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      collect();
      inputMode = b.dataset.mode;
      draw();
    }));
    const amt = form.querySelector('#i_amount');
    amt.addEventListener('input', updateAmountSummary);
    // Fremdwährung: Betrag und Kurs ergeben den Euro-Betrag oben.
    const umrechnen = () => {
      const k = kursLesen(form.querySelector('#i_fremdKurs').value);
      const b = parseMoney(form.querySelector('#i_fremdBetrag').value || '');
      if (istFremd(form.querySelector('#i_fremdW').value) && kursGueltig(k) && b) { amt.value = moneyInput(inEuro(Math.abs(b), k)); updateAmountSummary(); }
    };
    for (const id of ['#i_fremdW', '#i_fremdBetrag', '#i_fremdKurs']) form.querySelector(id)?.addEventListener('input', umrechnen);
    amt.addEventListener('focus', () => amt.select());
    amt.addEventListener('blur', () => { if (amt.value.trim()) { amt.value = moneyInput(parseMoney(amt.value)); updateAmountSummary(); } });
    form.querySelector('#i_vatRate')?.addEventListener('change', () => { updateAmountSummary(); satzVorschau(); });
    // Besondere Steuerfälle: Behandlung und Zielland bestimmen die Sätze, darum neu zeichnen.
    const sonderNeu = () => {
      collect();
      const t = tx.vatTreatment || '';
      if (t === 'oss') {
        // Vorgabe: das Land des Kunden, wenn es eines aus der EU ist.
        const kunde = tx.contactId ? sel.contacts().find((c) => c.id === tx.contactId) : null;
        if (!tx.oss?.land && ossLand(kunde?.country)) tx.oss = { land: String(kunde.country).toUpperCase() };
        if (!ossSaetze(tx.oss?.land).includes(Number(tx.vatRate))) tx.vatRate = ossRegelsatz(tx.oss?.land) ?? tx.vatRate;
      } else if (t === 'differenz') tx.vatRate = DIFFERENZ_SATZ;
      else if (t === 'gutschein-mehrzweck') tx.vatRate = 0;
      else if (![19, 7, 0].includes(Number(tx.vatRate))) tx.vatRate = 19;
      if (bruttoPflicht(t)) inputMode = 'gross';
      draw();
    };
    form.querySelector('#i_vatTreatment')?.addEventListener('change', sonderNeu);
    form.querySelector('#i_ossLand')?.addEventListener('change', sonderNeu);
    form.querySelector('#i_einkauf')?.addEventListener('input', updateAmountSummary);
    for (const id of ['#i_fahrtKm', '#i_fahrtStrecke', '#i_listenpreis']) form.querySelector(id)?.addEventListener('input', updateAmountSummary);
    form.querySelector('#i_antrieb')?.addEventListener('change', updateAmountSummary);
    // Mit Kilometern oder Listenpreis passt die Kategorie gleich mit (EÜR-Zeile 71 bzw. 20).
    form.querySelector('#i_fahrtKm')?.addEventListener('change', () => {
      const k = fahrtKategorie();
      if (k && tx.fahrt) { form.querySelector('#i_categoryId').value = k.id; kategorieHinweis(); }
    });
    form.querySelector('#i_listenpreis')?.addEventListener('change', () => {
      const k = privatKategorie();
      if (k && tx.privatnutzung) { form.querySelector('#i_categoryId').value = k.id; kategorieHinweis(); }
      if (tx.privatnutzung && !wiederholung.freq && isNew) { wiederholung.freq = 'monthly'; const r = form.querySelector('#i_repeat'); if (r) { r.value = 'monthly'; r.dispatchEvent(new Event('change')); } }
    });
    form.querySelector('#fahrtKat')?.addEventListener('click', async () => {
      collect();
      const kat = {
        id: uid('cat'), kind: 'expense', name: 'Fahrten mit eigenem Auto (Kilometerpauschale)', euerLine: FAHRT_ZEILE,
        skr03: '4673', skr04: '6673', vatRate: 0, active: true,
      };
      try { await upsertEntity('categories', kat, 'kategorie'); } catch (e) { err('Kategorie nicht angelegt', e.message); return; }
      tx.categoryId = kat.id;
      ok('Kategorie angelegt', kat.name);
      draw();
    });
    amt.addEventListener('input', satzVorschau);
    form.querySelector('#satzNeu')?.addEventListener('click', () => {
      collect();
      const belegt = new Set([Number(tx.vatRate), ...satzTeile.map((z) => Number(z.satz))]);
      satzTeile.push({ satz: SAETZE.find((s) => !belegt.has(s)) ?? 0, betrag: '' });
      draw();
      form.querySelector(`#i_satzBetrag${satzTeile.length - 1}`)?.focus();
    });
    form.querySelectorAll('[data-satzweg]').forEach((b) => b.addEventListener('click', () => {
      collect();
      satzTeile.splice(Number(b.dataset.satzweg), 1);
      draw();
    }));
    form.querySelectorAll('[data-satzbetrag]').forEach((el) => {
      el.addEventListener('input', () => { satzTeile[Number(el.dataset.satzbetrag)].betrag = el.value; satzVorschau(); });
      el.addEventListener('blur', () => { if (el.value.trim()) { el.value = moneyInput(parseMoney(el.value)); satzTeile[Number(el.dataset.satzbetrag)].betrag = el.value; satzVorschau(); } });
    });
    form.querySelectorAll('[data-satzsatz]').forEach((el) => el.addEventListener('change', () => { satzTeile[Number(el.dataset.satzsatz)].satz = Number(el.value); satzVorschau(); }));
    satzVorschau();
    form.querySelector('#i_categoryId').addEventListener('change', (e) => {
      const c = sel.category(e.target.value);
      if (c && !klein && c.vatRate !== undefined && c.vatRate !== null) {
        const rateSel = form.querySelector('#i_vatRate');
        // Nur einen Satz, den die Auswahl kennt: Beim OSS stehen dort die Sätze des Ziellandes (lib/sonderfaelle.js).
        if (rateSel && [...rateSel.options].some((o) => Number(o.value) === Number(c.vatRate))) { rateSel.value = String(c.vatRate); updateAmountSummary(); }
      }
      kategorieHinweis();
    });
    form.querySelector('#i_date').addEventListener('change', kategorieHinweis);
    kategorieHinweis();
    form.querySelector('#i_isPaid').addEventListener('change', (e) => {
      form.querySelector('#i_paidDate').disabled = !e.target.checked;
      // Eine Fälligkeit braucht nur, was noch offen ist; ein eingetragenes Datum bleibt erhalten.
      form.querySelector('#dueField').hidden = e.target.checked;
    });
    form.querySelector('#i_repeat')?.addEventListener('change', (e) => {
      for (const id of ['#i_repeatUntil', '#i_repeatCount']) {
        const feld = form.querySelector(id);
        if (feld) feld.disabled = !e.target.value;
      }
    });
    // Eine Vorschau der Raten, damit man vor dem Speichern sieht, was gebucht wird.
    const ratenVorschau = () => {
      const h = form.querySelector('#ratenHinweis');
      if (!h) return;
      // Raten gibt es nur für Offenes: Wer Raten wählt, nimmt „bezahlt“ damit zurück (die Fälligkeit erscheint).
      const bezahlt = form.querySelector('#i_isPaid');
      if (Number(form.querySelector('#i_raten')?.value) > 1 && bezahlt?.checked) {
        bezahlt.checked = false;
        bezahlt.dispatchEvent(new Event('change'));
      }
      collect();
      const plan = ratenPlan(tx.gross, { anzahl: ratenWahl.anzahl, freq: ratenWahl.freq, start: tx.dueDate || tx.date });
      h.textContent = plan.length
        ? `${plan.length} Raten zu ${money(plan[0].betrag)} €, die erste am ${fmtDate(plan[0].datum)}, die letzte am ${fmtDate(plan[plan.length - 1].datum)}.`
        : 'Für Anschaffungen auf Raten oder Rechnungen mit Zahlungsplan: Jede Rate wird eine eigene Buchung mit eigener Fälligkeit.';
    };
    form.querySelector('#i_raten')?.addEventListener('input', ratenVorschau);
    form.querySelector('#i_ratenFreq')?.addEventListener('change', ratenVorschau);
    form.querySelector('#i_unlisted').addEventListener('change', (e) => {
      form.querySelector('#unlistedHint').style.display = e.target.checked ? '' : 'none';
    });
    form.querySelector('#i_isDeposit')?.addEventListener('change', (e) => {
      const box = form.querySelector('#depositBox');
      if (box) box.style.display = e.target.checked ? '' : 'none';
      const pct = form.querySelector('#i_depositPercent');
      // Ein üblicher Satz als Vorgabe, damit das Feld nicht leer bleibt.
      if (e.target.checked && pct && !pct.value.trim()) pct.value = '30';
      updateDepositSummary();
    });
    form.querySelector('#i_depositPercent')?.addEventListener('input', updateDepositSummary);
    form.querySelector('#i_eventDate')?.addEventListener('change', updateDepositSummary);
    form.querySelectorAll('[data-pct]').forEach((b) => b.addEventListener('click', () => {
      form.querySelector('#i_depositPercent').value = b.dataset.pct;
      updateDepositSummary();
    }));
    form.querySelectorAll('[data-due]').forEach((b) => b.addEventListener('click', () => {
      form.querySelector('#i_dueDate').value = addDays(form.querySelector('#i_date').value || todayISO(), Number(b.dataset.due));
    }));
    form.querySelector('#btnNextNo')?.addEventListener('click', () => {
      // Die Nummernfolge beginnt jedes Jahr neu – maßgeblich ist das Jahr der Rechnung.
      const jahr = Number((form.querySelector('#i_date').value || todayISO()).slice(0, 4));
      form.querySelector('#i_invoiceNumber').value = nextInvoiceNumber(jahr);
    });
    form.querySelector('#btnNewContact')?.addEventListener('click', async () => {
      const created = await quickContactDialog(tx.type === 'income' ? 'customer' : 'supplier');
      if (created) { collect(); tx.contactId = created.id; draw(); }
    });
    form.querySelector('#btnMakeAsset')?.addEventListener('click', async () => {
      collect();
      if (!tx.net) { warn('Bitte zuerst einen Betrag eintragen'); return; }
      const created = await assetDialog({ name: tx.description, cost: klein ? tx.gross : tx.net, purchaseDate: tx.date });
      if (created) { tx.assetId = created.id; draw(); }
    });
    form.querySelector('#btnUnlinkAsset')?.addEventListener('click', () => { tx.assetId = ''; draw(); });

    const dz = form.querySelector('#dropzone');
    dz.addEventListener('click', async () => {
      const metas = await api.attach.pick();
      if (metas?.length) {
        attachments.push(...metas);
        addedAttachments.push(...metas);
        drawAttachments();
        // Nur Dateien, die eine Rechnung enthalten können, werden dafür noch einmal gelesen.
        const kandidaten = metas.filter((a) => /pdf|xml/i.test(a.mime || '') || /\.(pdf|xml)$/i.test(a.fileName || ''));
        const dateien = [];
        for (const a of kandidaten) {
          try { dateien.push({ bytes: base64ToUint8(await api.attach.read(a.id)), meta: a }); } catch { /* egal */ }
        }
        pruefeERechnung(dateien);
      }
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      // Sonst nimmt das Fenster darunter (siehe unten) dieselbe Datei ein zweites Mal an.
      e.stopPropagation();
      dz.classList.remove('over');
      addFiles([...e.dataTransfer.files]);
    });
  }

  /**
   * Bei einer festgeschriebenen, noch offenen Buchung: Wurde nur die Zahlung
   * eingetragen – mit einem Datum nach der Festschreibung, samt Zahlungskonto –
   * und sonst nichts verändert? Das ist ein neuer Vorgang im offenen Zeitraum
   * und lässt den abgeschlossenen, wie er erklärt wurde. Ohne diese Ausnahme
   * blieb jede zum Stichtag offene Rechnung für immer offen.
   */
  function nurZahlungNachgetragen() {
    if (!zahlungOffen || !tx.paidDate || isLockedDate(tx.paidDate) || ausgangslage === null) return false;
    const ohneZahlung = ({ paidDate, accountId, ...rest }) => JSON.stringify(rest);
    return ohneZahlung(tx) === ohneZahlung(JSON.parse(ausgangslage));
  }

  /** Prüft die Eingaben und schreibt die Buchung. Gibt zurück, ob gespeichert wurde. */
  async function saveTransaction() {
    collect();
    if (!tx.description) { fieldError(form.querySelector('#i_description'), 'Bitte eine Beschreibung eintragen.'); return false; }
    if (!tx.categoryId) { fieldError(form.querySelector('#i_categoryId'), 'Bitte eine Kategorie wählen.'); return false; }
    if (!tx.gross && !(tx.vatTreatment === 'gutschein-einloesung' && tx.gutscheinWert)) { fieldError(form.querySelector('#i_amount'), 'Der Betrag darf nicht 0 sein.'); return false; }
    if (tx.vatTreatment === 'oss' && !ossLand(tx.oss?.land)) { fieldError(form.querySelector('#i_ossLand'), 'Bitte das Land des Kunden wählen.'); return false; }
    // Besondere Fälle sind je eine Buchung: nicht mit weiteren Steuersätzen, Raten oder Fremdwährung.
    const sonder = ['oss', 'differenz', 'gutschein-mehrzweck', 'gutschein-einloesung'].includes(tx.vatTreatment) || tx.fahrt || tx.privatnutzung;
    if (sonder && isNew && (weitereTeile(tx.vatRate, satzExtras()).length || ratenAnzahl(ratenWahl.anzahl) > 1 || tx.fremd)) {
      err('Nicht kombinierbar', 'Dieser Steuerfall lässt sich nicht mit mehreren Steuersätzen, Raten oder fremder Währung verbinden. Bitte erfassen Sie ihn als eigene Buchung.');
      return false;
    }
    if (tx.isDeposit && (tx.depositPercent <= 0 || tx.depositPercent > 100)) {
      fieldError(form.querySelector('#i_depositPercent'), 'Bitte einen Wert zwischen 1 und 100 Prozent eintragen.');
      return false;
    }
    if (stornoTeil) { err('Teil eines Stornos', 'Stornierte Buchungen und Gegenbuchungen bleiben unverändert. Duplizieren Sie die Buchung, um sie neu zu erfassen.'); return false; }
    if (locked) {
      if (!nurZahlungNachgetragen()) {
        err('Zeitraum ist festgeschrieben', zahlungOffen
          ? 'Eintragen lässt sich nur noch die Zahlung (Datum nach der Festschreibung, Zahlungskonto). Alles andere bitte stornieren und neu erfassen.'
          : 'Bitte stornieren Sie die Buchung statt sie zu ändern.');
        return false;
      }
    } else if (isLockedDate(tx.date) || (tx.paidDate && isLockedDate(tx.paidDate))) {
      // Auch in die andere Richtung sperren: eine Buchung nachträglich in einen
      // abgeschlossenen Zeitraum zurückzudatieren, würde eine festgeschriebene
      // Periode verändern – gleich, ob die Buchung neu ist oder nur umdatiert
      // wird. Dasselbe gilt für das Zahlungsdatum, das bei der Ist-Besteuerung
      // über die Periodenzuordnung entscheidet.
      err('Zeitraum ist festgeschrieben',
        'Für diesen Zeitraum sind keine neuen Buchungen mehr möglich. Wählen Sie ein Datum nach der Festschreibung.');
      return false;
    }
    if (wiederholung.freq && wiederholung.until && wiederholung.until < tx.date) {
      fieldError(form.querySelector('#i_repeatUntil'), 'Das Ende liegt vor dem Datum der Buchung.');
      return false;
    }
    const inRaten = isNew && ratenAnzahl(ratenWahl.anzahl) > 1;
    if (inRaten) {
      const feld = form.querySelector('#i_raten');
      if (wiederholung.freq) { fieldError(feld, 'Raten und Wiederholen lassen sich nicht verbinden. Wählen Sie eines davon.'); return false; }
      if (tx.paidDate) { fieldError(feld, 'Eine bezahlte Buchung lässt sich nicht in Raten aufteilen. Nehmen Sie das Häkchen „bezahlt“ heraus; jede Rate tragen Sie einzeln ein.'); return false; }
      if (tx.assetId) { fieldError(feld, 'Eine Buchung mit Anlagegut lässt sich nicht in Raten aufteilen.'); return false; }
      if (tx.isDeposit) { fieldError(feld, 'Eine Anzahlung lässt sich nicht in Raten aufteilen.'); return false; }
    }
    // Mehrere Steuersätze auf einem Beleg: je Satz eine Buchung. Mit Raten, Wiederholung, Anlagegut, Anzahlung
    // und Fremdwährung lässt sich das nicht verbinden (jede Teilbuchung bräuchte dort ihre eigene Rechnung).
    const extraTeile = isNew && !klein ? weitereTeile(tx.vatRate, satzExtras()) : [];
    if (isNew && !klein) {
      const doppelt = doppelterSatz(tx.vatRate, satzExtras());
      if (doppelt !== null) { fieldError(form.querySelector('[data-satzsatz]') || form.querySelector('#i_vatRate'), `Der Satz ${doppelt} % kommt zweimal vor. Jeder Satz darf nur einmal vorkommen.`); return false; }
      if (satzTeile.some((z) => String(z.betrag).trim() !== '' && !parseMoney(z.betrag))) { fieldError(form.querySelector('[data-satzbetrag]'), 'Bitte einen Betrag eintragen oder die Zeile entfernen.'); return false; }
    }
    if (extraTeile.length) {
      const feld = form.querySelector('[data-satzbetrag]');
      if (inRaten) { fieldError(feld, 'Mehrere Steuersätze und Raten lassen sich nicht verbinden. Wählen Sie eines davon.'); return false; }
      if (wiederholung.freq) { fieldError(feld, 'Mehrere Steuersätze und Wiederholen lassen sich nicht verbinden. Wählen Sie eines davon.'); return false; }
      if (tx.assetId) { fieldError(feld, 'Eine Buchung mit Anlagegut lässt sich nicht auf mehrere Steuersätze aufteilen.'); return false; }
      if (tx.isDeposit) { fieldError(feld, 'Eine Anzahlung lässt sich nicht auf mehrere Steuersätze aufteilen.'); return false; }
      if (tx.fremd) { fieldError(feld, 'Bei einem Betrag in fremder Währung lassen sich nicht mehrere Steuersätze eintragen.'); return false; }
    }
    // Eine Betriebseinnahme als „privat“ zu kennzeichnen, hielte sie aus EÜR und Umsatzsteuer heraus. Dann
    // fragt Kontovia einmal nach, bevor es geschieht (§ 146 Abs. 1 AO).
    if (tx.unlisted && !existing?.unlisted && tx.type === 'income' && !sel.category(tx.categoryId)?.private) {
      const weiter = await confirmDialog({
        title: 'Ist diese Einnahme wirklich privat?',
        text: 'Als „privat“ gekennzeichnet steht sie weder in der EÜR noch in der Umsatzsteuer noch in den Unterlagen fürs Finanzamt. Das ist nur richtig, wenn sie nicht zum Betrieb gehört, etwa beim Verkauf eigener Privatsachen. Einnahmen aus Ihrer betrieblichen Tätigkeit müssen vollständig erklärt werden (§ 146 Abs. 1 AO).',
        confirmLabel: 'Ja, sie ist privat', cancelLabel: 'Zurück',
      });
      if (!weiter) return false;
    }
    saved = true;
    // Eine neue Wiederholung: Diese Buchung ist ihr erstes Vorkommen.
    const regel = wiederholung.freq && !tx.recurringId ? regelAusBuchung(tx, wiederholung.freq, { id: uid('rec'), until: wiederholung.until, anzahl: wiederholung.anzahl }) : null;
    if (regel) tx.recurringId = regel.id;
    if (inRaten) {
      // Jede Rate eine Buchung; die erste behält Kennung und Belege.
      const raten = ratenBuchungen(tx, { anzahl: ratenWahl.anzahl, freq: ratenWahl.freq });
      for (const [i, rate] of raten.entries()) await upsertTransaction(rate, i === 0 ? attachments : []);
      if (onSaved) await onSaved(raten[0]);
      return true;
    }
    if (extraTeile.length) {
      // Jeder Satz eine Buchung; der Beleg hängt an allen, die Metadaten dazu legt die erste an.
      const teile = satzBuchungen(tx, satzExtras(), { netto: inputMode === 'net' });
      for (const [i, teil] of teile.entries()) await upsertTransaction(teil, i === 0 ? attachments : []);
      if (onSaved) await onSaved(teile[0]);
      return true;
    }
    await upsertTransaction(tx, attachments);
    if (regel && kann('wiederkehrend')) await upsertEntity('recurring', regel, 'wiederkehrend');
    if (onSaved) await onSaved(tx);
    return true;
  }

  /* Fußzeile */
  m.root.querySelector('#btnCancel').addEventListener('click', () => m.dismiss());
  m.root.querySelector('#btnSave')?.addEventListener('click', async () => {
    const b = m.root.querySelector('#btnSave');
    if (b.disabled) return;
    b.disabled = true;
    try {
      if (!await saveTransaction()) return;
    } finally { b.disabled = false; }
    m.close();
    ok(isNew ? 'Buchung angelegt' : 'Buchung gespeichert', `${tx.description} · ${money(tx.gross)} €`);
    refresh();
    // Beginnt eine neue Wiederholung in der Vergangenheit, sind weitere Termine schon fällig.
    if (wiederholung.freq) faelligeAnbieten();
  });
  m.root.querySelector('#btnDelete')?.addEventListener('click', async () => {
    if (locked) { err('Festgeschriebene Buchungen dürfen nicht gelöscht werden', 'Nutzen Sie stattdessen „Stornieren“.'); return; }
    const yes = await confirmDialog({
      title: 'Buchung löschen?',
      text: 'Die Buchung wird endgültig entfernt. Der Vorgang wird im Änderungsjournal vermerkt.',
      confirmLabel: 'Endgültig löschen', danger: true,
    });
    if (!yes) return;
    // Erst die Buchung – scheitert das (etwa weil inzwischen festgeschrieben
    // wurde), sind die Belege noch da. Bisher waren sie in diesem Fall schon weg.
    try {
      await deleteTransaction(tx.id);
    } catch (e) {
      err('Buchung nicht gelöscht', e.message);
      return;
    }
    saved = true;
    const belege = attachments.map((a) => a.id);
    for (const id of belege) await api.attach.remove(id).catch(() => {});
    await commit('beleg.aufraeumen', (db) => {
      db.attachments = db.attachments.filter((a) => !belege.includes(a.id));
      for (const aid of belege) {
        if (!db.tombstones.some((t) => t.collection === 'attachments' && t.id === aid)) {
          db.tombstones.push({ collection: 'attachments', id: aid, deletedAt: new Date().toISOString() });
        }
      }
    }, { silent: true });
    m.close();
    ok('Buchung gelöscht');
    refresh();
  });
  m.root.querySelector('#btnVoid')?.addEventListener('click', async () => {
    const reason = await askText('Storno', 'Warum wird diese Buchung storniert?', 'z. B. doppelt erfasst');
    if (reason === null) return;
    saved = true;
    await voidTransaction(tx.id, reason);
    m.close();
    ok('Buchung storniert', 'Original und Gegenbuchung bleiben nachvollziehbar erhalten.');
    refresh();
  });
  m.root.querySelector('#btnAusbuchen')?.addEventListener('click', async () => {
    const wahl = await ausbuchenFragen(tx);
    if (!wahl) return;
    try {
      await restAusbuchen(tx.id, wahl);
    } catch (e) { err('Nicht ausgebucht', e.message); return; }
    saved = true;
    m.close();
    ok(wahl.grund === 'skonto' ? 'Skonto ausgebucht' : 'Forderungsausfall ausgebucht', 'Die Umsatzsteuer wird im Zeitraum des Ausbuchens berichtigt.');
    refresh();
  });
  m.root.querySelector('#btnDuplicate')?.addEventListener('click', () => {
    saved = true;
    m.close();
    const copy = { ...structuredClone(tx), id: uid('tx'), date: todayISO(), paidDate: '', invoiceNumber: '', attachments: [], voided: false, isReversal: false, createdAt: new Date().toISOString() };
    // Die Kopie ist eine neue, eigenständige Buchung – ohne Storno-Verweise und Termine.
    for (const k of ['reversalOf', 'reversedBy', 'voidedAt', 'voidReason', 'updatedAt', 'assetId', 'recurringId', 'ratenId', 'rate', 'raten', 'splitId', 'splitTeil', 'splitAnzahl']) delete copy[k];
    copy.appointmentIds = [];
    if (copy.isReversal === false && tx.isReversal) { copy.gross = -copy.gross; copy.net = -copy.net; copy.vat = -copy.vat; copy.description = copy.description.replace(/^Storno: /, ''); }
    setTimeout(() => openTransactionDialog(copy), 60);
  });

  draw();
  collect();
  ausgangslage = JSON.stringify(tx);
  // Belege dürfen auch von außerhalb des Dialogs fallen gelassen werden.
  m.root.addEventListener('dragover', (e) => e.preventDefault());
  m.root.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
  // „Neue Buchung → Aus Beleg“: die gewählten Dateien hängen sofort an, eine E-Rechnung wird erkannt.
  if (dateien?.length) addFiles(dateien);
}

/* -------------------------------------------------------------------------- */
/* Hilfsdialoge                                                                */
/* -------------------------------------------------------------------------- */

export function askText(title, label, placeholder = '') {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title, size: 'slim',
      body: html`<div class="field"><label>${label}</label><input id="txt" placeholder="${placeholder}"></div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    const input = m.root.querySelector('#txt');
    const done = () => { settled = true; const v = input.value.trim(); m.close(); resolve(v); };
    m.root.querySelector('[data-yes]').addEventListener('click', done);
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}

/**
 * Markiert ein Pflichtfeld als fehlerhaft und setzt den Fokus hinein. Die
 * Markierung verschwindet mit der nächsten Eingabe.
 */
function fieldError(input, text) {
  const field = input?.closest('.field');
  if (!field) return;
  field.classList.add('error');
  let hint = field.querySelector('.err');
  if (!hint) { hint = document.createElement('span'); hint.className = 'err'; field.append(hint); }
  hint.textContent = text;
  const weg = () => { field.classList.remove('error'); hint.remove(); };
  input.addEventListener('input', weg, { once: true });
  input.addEventListener('change', weg, { once: true });
  input.focus();
}

export function quickContactDialog(kind = 'customer') {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Neuer Kontakt',
      size: 'slim',
      body: html`
        <div class="field"><label>Name *</label><input id="c_name"></div>
        <div class="field"><label>Art</label>
          <select id="c_kind">
            <option value="customer" ${kind === 'customer' ? 'selected' : ''}>Kunde</option>
            <option value="supplier" ${kind === 'supplier' ? 'selected' : ''}>Lieferant</option>
            <option value="both">Beides</option>
          </select>
        </div>
        <div class="field"><label>E-Mail</label><input id="c_email"></div>
        <div class="field"><label>Anschrift</label><textarea id="c_address"></textarea></div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Anlegen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const name = m.root.querySelector('#c_name').value.trim();
      if (!name) { warn('Bitte einen Namen eintragen'); return; }
      const contact = {
        id: uid('con'), name,
        kind: m.root.querySelector('#c_kind').value,
        email: m.root.querySelector('#c_email').value.trim(),
        address: m.root.querySelector('#c_address').value.trim(),
        taxId: '', notes: '',
      };
      settled = true;
      await upsertEntity('contacts', contact, 'kontakt');
      m.close();
      resolve(contact);
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}

export function assetDialog(preset = {}) {
  return new Promise((resolve) => {
    if (!erlaubt('anlagen')) { resolve(null); return; }
    let settled = false;
    const entwurf = neuesAnlagegut(preset);
    const m = modal({
      title: 'Anlagegut abschreiben',
      size: 'slim',
      body: html`
        <p class="mt0 small muted">Anschaffungen über 800 € netto werden nicht sofort abgezogen,
        sondern über die betriebsgewöhnliche Nutzungsdauer verteilt (AfA, § 7 EStG).</p>
        ${raw(anlageFelder(entwurf))}`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Anlegen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    wireAnlageFelder(m.root);
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const asset = await anlageAusFeldern(m.root, entwurf);
      if (!asset) return;
      settled = true;
      await upsertEntity('assets', asset, 'anlage');
      m.close();
      resolve(asset);
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}

/* -------------------------------------------------------------------------- */
/* Belegvorschau                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Erkennt den Dateityp an den ersten Bytes. Gebraucht für Belege aus älteren
 * Fassungen, deren Angaben nicht mehr vorliegen.
 */
function sniffMime(bytes) {
  const b = bytes;
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

export async function previewAttachment(id, metaHint = null) {
  const meta = { ...(sel.attachment(id) || { fileName: 'Beleg', mime: '' }), ...(metaHint || {}) };
  let b64;
  try {
    b64 = await api.attach.read(id);
  } catch (e) {
    err('Beleg kann nicht gelesen werden', e.message);
    return;
  }
  const daten = base64ToUint8(b64);
  // Bei wiederhergestellten Belegen fehlt die Typangabe – dann entscheidet
  // der Dateiinhalt, sonst gäbe es keine Vorschau.
  const mime = meta.mime || sniffMime(daten) || 'application/octet-stream';
  const blob = new Blob([daten], { type: mime });
  const url = URL.createObjectURL(blob);

  const isImage = /^image\//.test(mime);
  const isPdf = /pdf$/i.test(mime) || /\.pdf$/i.test(meta.fileName);
  const isText = !isImage && !isPdf && (/^text\/|xml|json|csv/i.test(mime) || /\.(xml|txt|csv|json)$/i.test(meta.fileName || ''));
  // Eine E-Rechnung (XRechnung, ZUGFeRD) wird lesbar gezeigt statt als XML.
  const textInhalt = isText ? new TextDecoder('utf-8').decode(daten.subarray(0, 400000)) : '';
  const eRechnung = isText ? eRechnungLesen(textInhalt) : null;

  const m = modal({
    title: meta.fileName,
    size: 'wide',
    body: eRechnung
      ? `<div id="prevLesbar">${eRechnungHtml(eRechnung)}</div><pre class="preview-text" id="prevRoh" hidden>${esc(textInhalt)}</pre>`
      : isImage
        ? `<img class="preview-img" src="${url}" alt="Beleg">`
        : isPdf
          ? `<iframe class="preview-frame" src="${url}"></iframe>`
          : isText
            ? `<pre class="preview-text">${esc(textInhalt)}${daten.length > 400000 ? '\n…' : ''}</pre>`
            : `<div class="empty"><p class="empty-titel">Keine Vorschau möglich</p><p class="small">Diese Datei kann Kontovia nicht selbst anzeigen. Sie können den Beleg speichern oder extern öffnen.</p></div>`,
    foot: `<span class="left muted tiny">${meta.sha256
      ? `${esc(bytes(meta.size || 0))} · Prüfsumme ${esc(String(meta.sha256).slice(0, 16))}…`
      : esc(bytes(daten.length))}</span>
           ${eRechnung ? '<button class="btn" data-roh>XML anzeigen</button>' : ''}
           <button class="btn" data-erech hidden>${icon('file', 14).__raw} E-Rechnung anzeigen</button>
           <button class="btn" data-ext>${icon('external', 14).__raw} Extern öffnen</button>
           <button class="btn primary" data-save>${icon('save', 14).__raw} Speichern unter</button>`,
    onClose: () => URL.revokeObjectURL(url),
  });
  m.root.querySelector('[data-save]').addEventListener('click', async () => {
    const p = await api.attach.saveAs(id, meta.fileName);
    if (p) ok('Beleg gespeichert', p);
  });
  m.root.querySelector('[data-ext]').addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Extern öffnen?',
      text: 'Der Beleg wird entschlüsselt in einem neuen Browser-Tab geöffnet. Was der Browser nicht anzeigen kann, wird stattdessen zum Sichern angeboten.',
      confirmLabel: 'Öffnen',
    });
    if (!yes) return;
    await api.attach.openExternal(id, meta.fileName);
  });
  m.root.querySelector('[data-roh]')?.addEventListener('click', (e) => {
    const roh = m.root.querySelector('#prevRoh');
    roh.hidden = !roh.hidden;
    m.root.querySelector('#prevLesbar').hidden = !roh.hidden;
    e.currentTarget.textContent = roh.hidden ? 'XML anzeigen' : 'Rechnung anzeigen';
  });
  // ZUGFeRD / Factur-X: Die maschinenlesbare Rechnung steckt im PDF.
  if (isPdf) {
    xmlAusPdf(daten).then((xml) => {
      const r = xml && eRechnungLesen(xml);
      const knopf = m.root.querySelector('[data-erech]');
      if (!r || !knopf || !m.root.isConnected) return;
      knopf.hidden = false;
      knopf.addEventListener('click', () => zeigeERechnung(r));
    }).catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */

export function arrayBufferToBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode.apply(null, b.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToUint8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

