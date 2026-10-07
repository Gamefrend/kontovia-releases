/**
 * Kontovia – Auswertungen.
 *
 * Zwei Begriffe, die man beim Lesen auseinanderhalten muss:
 *
 *  Zuflussprinzip ("ist"):  Eine Buchung zählt in dem Zeitraum, in dem das Geld
 *                           tatsächlich geflossen ist. Das ist der Regelfall der
 *                           Einnahmen-Überschuss-Rechnung (§ 11 EStG).
 *  Sollprinzip ("soll"):    Eine Buchung zählt am Rechnungsdatum, unabhängig
 *                           davon, wann bezahlt wurde.
 *
 * Und die zweite Weiche: Kleinunternehmer nach § 19 UStG rechnen brutto (keine
 * Umsatzsteuer, kein Vorsteuerabzug), alle anderen netto.
 *
 * Beide Weichen gelten seit 2.27 je Tag: Wer sie umstellt, tut das ab einem
 * Datum, und frühere Zeiträume bleiben, wie sie waren (steuerStand).
 */

import { ym, monthStart, monthEnd, addMonths, addDays, monthsBetween, todayISO, daysBetween, sum, groupBy, fmtDate, money } from './util.js';
import { EUER, EUER_ZEILEN, formLine, formLines, formYear } from './euer.js';
import { istEuLand } from './rechnung.js';

export { EUER, EUER_ZEILEN, formLine, formLines, formYear };

/* -------------------------------------------------------------------------- */
/* Grundlagen                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Die Einstellung „accountingBasis“ ist die Versteuerungsart der Umsatzsteuer:
 * „ist“ = nach vereinnahmten Entgelten (§ 20 UStG), „soll“ = nach vereinbarten
 * Entgelten (§ 13 Abs. 1 Nr. 1 a UStG). Sie bestimmt die Voranmeldung und die
 * Umsatzsteuer-Angaben in Übersicht und GuV.
 *
 * Einnahmen, Ausgaben und Gewinn zählen dagegen überall am Zahlungstag
 * (PROFIT_BASIS) – wie in der Anlage EÜR (§ 4 Abs. 3, § 11 EStG), eine EÜR nach
 * Rechnungsdatum gibt es nicht. Bis Fassung 1.6 folgten Übersicht und GuV bei
 * Soll-Versteuerung dem Rechnungsdatum; eine Zahlung im September auf eine
 * August-Rechnung fehlte dann im September.
 */
export function basisOf(db, datum = '') { return steuerStand(db, datum).accountingBasis === 'soll' ? 'soll' : 'ist'; }

/** Grundlage für Einnahmen, Ausgaben und Gewinn: immer der Zahlungstag. */
export const PROFIT_BASIS = 'ist';
export function isKleinunternehmer(db, datum = '') { return steuerStand(db, datum).taxMode === 'kleinunternehmer'; }

/**
 * Steuerliche Grundeinstellungen mit Verlauf (seit 2.27). Wer etwa die
 * Kleinunternehmerregelung verlässt, stellt das ab einem Tag um; frühere
 * Zeiträume rechnen weiter mit dem, was damals galt. Bis 2.26 galt eine
 * Umstellung rückwirkend für alle Jahre.
 *
 * `settings.steuerVerlauf`: Liste `{ab, taxMode, accountingBasis, vatPeriod,
 * vatDeadline}`, `ab` leer = von Anfang an; der jüngste Eintrag gleicht den
 * Einstellungen selbst. Ohne Verlauf gelten die Einstellungen für jeden Tag.
 * Ohne Datum gilt der heutige Stand.
 */
export const STEUER_FELDER = ['taxMode', 'accountingBasis', 'vatPeriod', 'vatDeadline'];

export function steuerStand(db, datum = '') {
  const s = db?.settings || {};
  const out = {};
  for (const k of STEUER_FELDER) out[k] = s[k];
  const verlauf = Array.isArray(s.steuerVerlauf) ? s.steuerVerlauf.filter(Boolean) : [];
  if (!datum || !verlauf.length) return out;
  let treffer = null;
  for (const e of verlauf) {
    const ab = String(e.ab || '');
    if (ab <= datum && (!treffer || ab >= String(treffer.ab || ''))) treffer = e;
  }
  // Vor dem ersten Eintrag gilt, was der erste sagt.
  treffer ??= verlauf.reduce((a, e) => (String(e.ab || '') < String(a.ab || '') ? e : a));
  for (const k of STEUER_FELDER) if (treffer[k] !== undefined && treffer[k] !== '') out[k] = treffer[k];
  return out;
}

/** War der Betrieb an jedem Tag Kleinunternehmer (heute und laut Verlauf)? */
export function nurKleinunternehmer(db) {
  if (!isKleinunternehmer(db)) return false;
  return (db?.settings?.steuerVerlauf || []).every((e) => !e || !e.taxMode || e.taxMode === 'kleinunternehmer');
}

/**
 * Ab wann die Vorsteuer einer Ausgabe zählt. Abziehbar ist sie, sobald Leistung
 * und Rechnung da sind, auch bei Ist-Versteuerung (§ 15 Abs. 1 Satz 1 Nr. 1
 * UStG; § 20 UStG betrifft nur die eigene Umsatzsteuer). Bis 2.26 zählte bei
 * Ist auch die Vorsteuer erst am Zahlungstag. Ab 2028 gilt für Rechnungen
 * eines Lieferanten, der selbst nach Ist versteuert, der Zahlungstag
 * (Jahressteuergesetz 2024; die Rechnung trägt dann den Vermerk
 * „Versteuerung nach vereinnahmten Entgelten“): `tx.lieferantIst`.
 */
export const IST_VERMERK_AB = '2028-01-01';
export function vorsteuerDatum(tx) {
  if (tx?.lieferantIst && String(tx.date || '') >= IST_VERMERK_AB) return tx.paidDate || '';
  return tx?.date || '';
}

/** Datum, unter dem eine Buchung in der Erfolgsrechnung erscheint. */
export function effectiveDate(tx, basis) {
  return basis === 'soll' ? tx.date : (tx.paidDate || '');
}

/**
 * Storno nach GoBD: Die Originalbuchung bleibt stehen und wird als storniert
 * markiert, dazu kommt eine Gegenbuchung mit umgekehrtem Vorzeichen. Beide
 * zählen, jede an ihrem Datum – im selben Zeitraum ergeben sie zusammen null.
 * Liegt das Original in einem festgeschriebenen Zeitraum, trägt die
 * Gegenbuchung das Datum des Stornos; der abgeschlossene Zeitraum bleibt dann,
 * wie er erklärt wurde, und die Korrektur wirkt im offenen.
 *
 * Bis Fassung 1.5 wurde das Original übergangen, die Gegenbuchung aber
 * gezählt – ein Storno über 119 € ergab so −119 € statt null.
 *
 * Nur eine als storniert markierte Buchung ohne Gegenbuchung zählt nicht.
 */
export function isEffective(tx) { return !tx.voided || !!tx.reversedBy; }

/** Stornierte Buchung oder Gegenbuchung – gehört in keine Liste offener Vorgänge. */
export function isVoidPart(tx) { return !!tx.voided || !!tx.isReversal; }

/** Zählt die Buchung im Zeitraum für die Gewinnermittlung? */
export function countsForProfit(tx, from, to, basis) {
  if (!isEffective(tx)) return false;
  const d = effectiveDate(tx, basis);
  return !!d && d >= from && d <= to;
}

/** Einnahmenzeilen, die als Kleinunternehmer alle in Zeile 12 zusammenfallen. */
const UMSATZ_ZEILEN = new Set([EUER.steuerpflichtig, EUER.steuerfrei]);

/** Der für den Gewinn maßgebliche Betrag einer Buchung. */
export function profitAmount(tx, kleinunternehmer) {
  return kleinunternehmer ? tx.gross : tx.net;
}

function catOf(db, tx) {
  return db.categories.find((c) => c.id === tx.categoryId) || null;
}

/* -------------------------------------------------------------------------- */
/* Private Buchungen                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Eine Buchung lässt sich als „privat“ kennzeichnen – für Vorgänge,
 * die nur der eigenen Übersicht dienen und steuerlich nicht zum Betrieb
 * gehören. Solche Buchungen fehlen in allen Unterlagen für Finanzamt und
 * Steuerkanzlei. In Übersicht und Auswertungen kommen sie nur hinzu, wenn
 * dort das Häkchen „Private einbeziehen“ gesetzt ist.
 *
 * Gefiltert wird einmal am Eingang: Alle Rechenfunktionen bekommen einen
 * Bestand, in dem die Buchungen schon passend ausgewählt sind. So kann keine
 * einzelne Auswertung das Filtern vergessen.
 */

export function isUnlisted(tx) { return !!tx?.unlisted; }

/** Der Bestand ohne private Buchungen – Grundlage jedes Exports. */
export function listedOnly(db) {
  if (!db || !(db.transactions || []).some(isUnlisted)) return db;
  return { ...db, transactions: db.transactions.filter((t) => !isUnlisted(t)) };
}

/** Der Bestand, wie ihn eine Auswertung je nach Häkchen sehen soll. */
export function scopeDb(db, includeUnlisted = false) {
  return includeUnlisted ? db : listedOnly(db);
}

/**
 * Private Buchungen eines Zeitraums, für den Hinweis neben dem
 * Häkchen. Maßgeblich ist dasselbe Datum wie in der Auswertung; offene
 * Rechnungen zählen mit ihrem Rechnungsdatum.
 */
export function unlistedStats(db, from, to) {
  const out = { count: 0, income: 0, expense: 0 };
  for (const t of db?.transactions || []) {
    if (!isUnlisted(t) || isVoidPart(t)) continue;
    const d = effectiveDate(t, PROFIT_BASIS) || t.date;
    if (!d || d < from || d > to) continue;
    out.count++;
    if (t.type === 'income') out.income += t.gross; else out.expense += t.gross;
  }
  return out;
}

/** Privatentnahmen/-einlagen sind kein Betriebsergebnis. */
function isPrivate(cat) { return !!cat?.private; }

/** Anschaffungen, die über die AfA laufen, sind keine Sofortausgabe. */
function isCapitalised(tx) { return !!tx.assetId; }

/* -------------------------------------------------------------------------- */
/* Abschreibungen                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Drei Abschreibungsarten:
 *
 *   linear     gleiche Raten über die Nutzungsdauer, monatsgenau ab dem
 *              Anschaffungsmonat (§ 7 Abs. 1 Satz 4 EStG)
 *   degressiv  fallende Raten vom Restwert, nur für bewegliche Wirtschaftsgüter
 *              aus den Zeitfenstern in DEGRESSIV_FENSTER (§ 7 Abs. 2 EStG), je
 *              mit eigenem Höchstsatz und Vielfachem des linearen Satzes. Sobald
 *              die lineare Rate auf den Restwert höher ist, wird zu ihr
 *              gewechselt (§ 7 Abs. 3 EStG). Bis 2.26 kannte Kontovia nur das
 *              Fenster ab 07/2025; ältere Anlagen wurden still linear.
 *   sofort     Computerhardware und Software mit einem Jahr Nutzungsdauer, voll
 *              im Anschaffungsjahr (BMF-Schreiben vom 22.02.2022)
 *
 * Scheidet ein Gut aus (`abgang: {datum, art, erloes}`, seit 2.27), endet die
 * AfA mit dem Monat des Abgangs; der Rest ist der Restbuchwert (restbuchwert()).
 */
export const DEGRESSIV_FENSTER = [
  // Corona-Steuerhilfegesetz
  { von: '2020-01-01', bis: '2022-12-31', satz: 0.25, faktor: 2.5 },
  // Wachstumschancengesetz
  { von: '2024-04-01', bis: '2024-12-31', satz: 0.2, faktor: 2 },
  // Investitionssofortprogramm
  { von: '2025-07-01', bis: '2027-12-31', satz: 0.3, faktor: 3 },
];
export const DEGRESSIV_VON = '2025-07-01';
export const DEGRESSIV_BIS = '2027-12-31';

/** Das Zeitfenster der degressiven AfA für ein Anschaffungsdatum, sonst null. */
export function degressivFenster(purchaseDate) {
  const d = String(purchaseDate || '');
  return DEGRESSIV_FENSTER.find((f) => d >= f.von && d <= f.bis) || null;
}

/** Darf ein Wirtschaftsgut mit diesem Anschaffungsdatum degressiv abgeschrieben werden? */
export function degressivMoeglich(purchaseDate) {
  return !!degressivFenster(purchaseDate);
}

/** Die tatsächlich angewandte Methode – degressiv nur im begünstigten Zeitraum. */
export function afaMethod(asset) {
  if (asset?.method === 'sofort') return 'sofort';
  if (asset?.method === 'degressiv' && degressivMoeglich(asset.purchaseDate)) return 'degressiv';
  return 'linear';
}

/**
 * Jährlicher Satz der degressiven AfA: das Vielfache des linearen Satzes, höchstens
 * der Satz des Zeitfensters (ohne Datum das jüngste: dreifach, höchstens 30 %).
 */
export function degressivSatz(usefulLifeYears, purchaseDate = '') {
  const n = Math.max(1, Number(usefulLifeYears) || 1);
  const f = degressivFenster(purchaseDate) || DEGRESSIV_FENSTER[DEGRESSIV_FENSTER.length - 1];
  return Math.min(f.satz, f.faktor / n);
}

/** Zeile der Anlage EÜR für die AfA eines Guts: Gebäude 31, immaterielle (Software, Rechte) 32, sonst 33. */
export function afaZeile(asset) {
  if (asset?.art === 'unbeweglich') return EUER.afaUnbeweglich;
  if (asset?.art === 'immateriell') return EUER.afaImmateriell;
  return EUER.afaBeweglich;
}

export const AFA_METHODE = {
  linear: 'linear',
  degressiv: 'degressiv (§ 7 Abs. 2 EStG)',
  sofort: 'Nutzungsdauer 1 Jahr (BMF 22.02.2022)',
};

/** Verteilt einen Jahresbetrag auf Monate; der Rundungsrest geht in den letzten. */
function aufMonate(out, start, monate, betrag) {
  const base = Math.floor(betrag / monate);
  const rest = betrag - base * monate;
  for (let i = 0; i < monate; i++) out.push({ ym: ym(addMonths(start, i)), amount: base + (i === monate - 1 ? rest : 0) });
}

/**
 * Abschreibungsplan in Monatsraten. Die Summe aller Raten ist immer genau
 * gleich den Anschaffungskosten; nach einem Abgang endet er mit dessen Monat,
 * der Rest steht dann als Restbuchwert für sich.
 */
export function depreciationPlan(asset) {
  const plan = vollerPlan(asset);
  const bis = abgangYm(asset);
  return bis ? plan.filter((e) => e.ym <= bis) : plan;
}

/** Monat des Abgangs (`YYYY-MM`) oder ''. */
function abgangYm(asset) {
  const d = String(asset?.abgang?.datum || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(0, 7) : '';
}

/**
 * Restbuchwert eines ausgeschiedenen Guts: was nach der AfA bis einschließlich
 * des Abgangsmonats übrig ist. In der Anlage EÜR Zeile 38 (Restbuchwerte
 * ausgeschiedener Anlagegüter); der Erlös oder der Wert der Entnahme ist eine
 * eigene Einnahme in Zeile 19.
 * @returns {{datum:string, amount:number}|null}
 */
export function restbuchwert(asset) {
  if (!abgangYm(asset)) return null;
  const cost = Math.round(Number(asset.cost) || 0);
  return { datum: asset.abgang.datum, amount: Math.max(0, cost - sum(depreciationPlan(asset), (e) => e.amount)) };
}

/** Summe der Restbuchwerte aller Abgänge im Zeitraum. */
export function restbuchwerte(db, from, to) {
  let n = 0;
  for (const a of db.assets || []) {
    const r = restbuchwert(a);
    if (r && r.datum >= from && r.datum <= to) n += r.amount;
  }
  return n;
}

function vollerPlan(asset) {
  const cost = Math.round(Number(asset.cost) || 0);
  const start = monthStart(asset.purchaseDate || todayISO());
  const methode = afaMethod(asset);
  if (methode === 'sofort') return [{ ym: ym(start), amount: cost }];

  const months = Math.max(1, Math.round((Number(asset.usefulLifeYears) || 1) * 12));
  const out = [];
  if (methode === 'linear') {
    aufMonate(out, start, months, cost);
    return out;
  }

  // Degressiv: Jahr für Jahr vom Restwert, im ersten Jahr zeitanteilig.
  const satz = degressivSatz(asset.usefulLifeYears, asset.purchaseDate);
  let rest = cost;
  let uebrig = months;
  let monat = start;
  while (uebrig > 0) {
    const imJahr = Math.min(13 - Number(monat.slice(5, 7)), uebrig);
    let betrag;
    if (imJahr >= uebrig) {
      betrag = rest;
    } else {
      const fallend = Math.round((rest * satz * imJahr) / 12);
      const gleich = Math.round((rest * imJahr) / uebrig);
      betrag = Math.min(rest, Math.max(fallend, gleich));
    }
    aufMonate(out, monat, imJahr, betrag);
    rest -= betrag;
    uebrig -= imJahr;
    monat = addMonths(monat, imJahr);
  }
  return out;
}

export function depreciationInRange(asset, from, to) {
  const a = ym(from), b = ym(to);
  return sum(depreciationPlan(asset).filter((e) => e.ym >= a && e.ym <= b), (e) => e.amount);
}

export function bookValue(asset, asOf) {
  if (asset?.abgang?.datum && String(asOf) >= asset.abgang.datum) return 0;
  const b = ym(asOf);
  const done = sum(depreciationPlan(asset).filter((e) => e.ym <= b), (e) => e.amount);
  return Math.max(0, (Number(asset.cost) || 0) - done);
}

export function totalDepreciation(db, from, to) {
  return sum(db.assets || [], (a) => depreciationInRange(a, from, to));
}

/* -------------------------------------------------------------------------- */
/* Erfolgsrechnung (Gewinn und Verlust)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Vollständige Auswertung eines Zeitraums.
 * Alle Beträge in Cent.
 *
 * Einnahmen, Ausgaben und Gewinn zählen am Zahlungstag (PROFIT_BASIS); die
 * Umsatzsteuer (vatIncome, vatExpense, vatPayable) nach der Versteuerungsart.
 * incomeVat/expenseVat sind die Steueranteile der gezählten Zahlungen – sie
 * gehören zu den Kategoriezeilen der GuV.
 */
export function periodReport(db, from, to, opts = {}) {
  const basis = opts.basis || PROFIT_BASIS;
  const vatBasis = opts.vatBasis || basisOf(db, from);
  const klein = opts.kleinunternehmer ?? isKleinunternehmer(db, to);
  // Brutto oder netto je Buchung nach dem Stand an ihrem Tag (Verlauf, steuerStand).
  const kleinAm = opts.kleinunternehmer !== undefined ? () => opts.kleinunternehmer : (d) => isKleinunternehmer(db, d);
  let inP = 0;
  let exP = 0;
  const txs = db.transactions.filter((t) => countsForProfit(t, from, to, basis));

  const r = {
    from, to, basis, vatBasis, kleinunternehmer: klein,
    incomeGross: 0, incomeNet: 0, incomeVat: 0,
    expenseGross: 0, expenseNet: 0, expenseVat: 0,
    expenseDeductible: 0,
    capitalisedGross: 0,
    privateIn: 0, privateOut: 0,
    vatRemitted: 0, vatRefunded: 0,
    countIncome: 0, countExpense: 0,
    // Gezählte Zahlungen zu Buchungen, deren Datum außerhalb des Zeitraums
    // liegt – etwa eine Dezember-Rechnung, die im Januar bezahlt wird, oder die
    // Restzahlung einer Anzahlung, die vor dem Veranstaltungstag eingeht.
    otherPeriod: { income: 0, expense: 0, incomeCount: 0, expenseCount: 0 },
    // Rechnungen und Belege des Zeitraums, die noch nicht bezahlt sind. Sie
    // zählen erst an ihrem Zahlungstag.
    unpaid: { income: 0, expense: 0, incomeCount: 0, expenseCount: 0 },
    byCategory: [],
    byContact: [],
    months: [],
    transactions: txs,
  };

  const catAgg = new Map();
  const contactAgg = new Map();

  for (const tx of txs) {
    const cat = catOf(db, tx);
    const amount = profitAmount(tx, kleinAm(effectiveDate(tx, basis)));

    if (isPrivate(cat)) {
      if (tx.type === 'income') r.privateIn += tx.gross;
      else r.privateOut += tx.gross;
      continue;
    }

    // Zahlungen an das oder vom Finanzamt gleichen nur das Umsatzsteuerkonto
    // aus. In der Nettobetrachtung sind sie weder Ertrag noch Aufwand – sonst
    // würde die abgeführte Umsatzsteuer den Gewinn ein zweites Mal mindern.
    // In der Anlage EÜR erscheinen sie dagegen in eigenen Zeilen (EUER.ustErstattet/ustGezahlt).
    if (cat?.vatNeutral) {
      if (tx.type === 'income') r.vatRefunded += tx.gross;
      else r.vatRemitted += tx.gross;
      continue;
    }

    if (tx.type === 'income') {
      r.incomeGross += tx.gross;
      r.incomeNet += tx.net;
      r.incomeVat += tx.vat;
      inP += amount;
      r.countIncome++;
    } else {
      r.expenseVat += tx.vat; // Vorsteuer fällt auch bei aktivierten Gütern an
      if (isCapitalised(tx)) {
        r.capitalisedGross += tx.gross;
        continue; // wirkt nur über die Abschreibung
      }
      r.expenseGross += tx.gross;
      r.expenseNet += tx.net;
      exP += amount;
      r.expenseDeductible += Math.round(amount * (cat?.deductibleRate ?? 1));
      r.countExpense++;
    }

    if (tx.date < from || tx.date > to) {
      const o = r.otherPeriod;
      if (tx.type === 'income') { o.income += amount; o.incomeCount++; } else { o.expense += amount; o.expenseCount++; }
    }

    const key = tx.categoryId || '∅';
    if (!catAgg.has(key)) catAgg.set(key, { categoryId: tx.categoryId, name: cat?.name || 'Ohne Kategorie', kind: tx.type, euerLine: cat?.euerLine ?? null, amount: 0, gross: 0, vat: 0, count: 0 });
    const ca = catAgg.get(key);
    ca.amount += amount; ca.gross += tx.gross; ca.vat += tx.vat; ca.count++;

    if (tx.contactId) {
      if (!contactAgg.has(tx.contactId)) contactAgg.set(tx.contactId, { contactId: tx.contactId, income: 0, expense: 0, count: 0 });
      const co = contactAgg.get(tx.contactId);
      if (tx.type === 'income') co.income += amount; else co.expense += amount;
      co.count++;
    }
  }

  r.depreciation = totalDepreciation(db, from, to);
  // Restbuchwerte ausgeschiedener Anlagegüter mindern den Gewinn im Jahr des Abgangs.
  r.restbuchwerte = restbuchwerte(db, from, to);

  // Kleinunternehmer: brutto = netto, Vorsteuer ist kein Abzugsposten.
  r.incomeForProfit = inP;
  r.expenseForProfit = exP + r.depreciation + r.restbuchwerte;
  r.expenseDeductible += r.depreciation + r.restbuchwerte;

  r.profit = r.incomeForProfit - r.expenseForProfit;
  r.taxableProfit = r.incomeForProfit - r.expenseDeductible;

  // Umsatzsteuer nach der Versteuerungsart – bei Soll am Rechnungsdatum; die
  // Vorsteuer mit der Rechnung (vorsteuerDatum). Als Kleinunternehmer keine.
  r.vatIncome = 0;
  r.vatExpense = 0;
  for (const tx of db.transactions) {
    if (!isEffective(tx)) continue;
    const d = tx.type === 'income' ? effectiveDate(tx, vatBasis) : vorsteuerDatum(tx);
    if (!d || d < from || d > to || kleinAm(d)) continue;
    const cat = catOf(db, tx);
    if (isPrivate(cat) || cat?.vatNeutral) continue;
    if (tx.type === 'income') r.vatIncome += tx.vat; else r.vatExpense += tx.vat;
  }
  r.vatPayable = r.vatIncome - r.vatExpense;

  for (const tx of db.transactions) {
    if (isVoidPart(tx) || tx.paidDate || tx.date < from || tx.date > to) continue;
    const cat = catOf(db, tx);
    if (isPrivate(cat) || cat?.vatNeutral || isCapitalised(tx)) continue;
    const u = r.unpaid;
    const amount = profitAmount(tx, kleinAm(tx.date));
    if (tx.type === 'income') { u.income += amount; u.incomeCount++; } else { u.expense += amount; u.expenseCount++; }
  }
  // Was davon noch offen ist: abzüglich der im Zeitraum bereits überwiesenen
  // Vorauszahlungen, zuzüglich erhaltener Erstattungen.
  r.vatOutstanding = r.vatPayable - r.vatRemitted + r.vatRefunded;
  r.margin = r.incomeForProfit > 0 ? r.profit / r.incomeForProfit : null;

  r.byCategory = [...catAgg.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  r.byContact = [...contactAgg.values()].sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
  r.months = monthlySeries(db, from, to, { basis, kleinunternehmer: klein });

  return r;
}

/** Monatsreihe für Verlaufsdarstellungen. */
export function monthlySeries(db, from, to, opts = {}) {
  const basis = opts.basis || PROFIT_BASIS;
  const kleinAm = opts.kleinunternehmer !== undefined ? () => opts.kleinunternehmer : (d) => isKleinunternehmer(db, d);
  const range = seriesRange(db, from, to, basis);
  const keys = monthsBetween(range.from, range.to);
  const idx = new Map(keys.map((k) => [k, { ym: k, income: 0, expense: 0, profit: 0, vat: 0 }]));

  for (const tx of db.transactions) {
    if (!isEffective(tx)) continue;
    const d = effectiveDate(tx, basis);
    if (!d || d < from || d > to) continue;
    const cat = catOf(db, tx);
    if (isPrivate(cat) || cat?.vatNeutral) continue;
    const bucket = idx.get(ym(d));
    if (!bucket) continue;
    const amount = profitAmount(tx, kleinAm(d));
    if (tx.type === 'income') { bucket.income += amount; bucket.vat += tx.vat; }
    else if (!isCapitalised(tx)) { bucket.expense += amount; bucket.vat -= tx.vat; }
    else bucket.vat -= tx.vat;
  }

  // Abschreibungen und Restbuchwerte ausgeschiedener Güter monatsweise ergänzen
  for (const asset of db.assets || []) {
    for (const e of depreciationPlan(asset)) {
      const bucket = idx.get(e.ym);
      if (bucket) bucket.expense += e.amount;
    }
    const rest = restbuchwert(asset);
    if (rest && rest.datum >= from && rest.datum <= to) {
      const bucket = idx.get(ym(rest.datum));
      if (bucket) bucket.expense += rest.amount;
    }
  }

  const out = [...idx.values()];
  for (const m of out) m.profit = m.income - m.expense;
  return out;
}

/**
 * Welche Monate eine Verlaufsreihe zeigt.
 *
 * Ein Jahr oder Quartal wird immer vollständig gezeigt, auch mit leeren
 * Monaten – sonst ließe sich nicht erkennen, wo nichts los war. Bei sehr
 * langen Zeiträumen („Gesamter Bestand“ reicht von 1900 bis 2999) wird auf die
 * Monate mit Buchungen oder Abschreibungen eingekürzt, höchstens bis heute
 * bzw. bis zur letzten Buchung. Ohne diese Kürzung zeigte der Verlauf
 * 600 leere Monate ab Januar 1900.
 */
export function seriesRange(db, from, to, basis = PROFIT_BASIS) {
  if (monthsBetween(from, to).length <= 36) return { from, to };
  let first = '';
  let last = '';
  const take = (d) => {
    if (!d || d < from || d > to) return;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  };
  for (const t of db.transactions || []) if (isEffective(t)) take(effectiveDate(t, basis));
  for (const a of db.assets || []) take(a.purchaseDate);
  if (!first) return { from: monthStart(todayISO()), to: monthEnd(todayISO()) };
  const today = todayISO();
  const end = last > today ? last : (today <= to ? today : last);
  return { from: first > from ? monthStart(first) : from, to: end < to ? monthEnd(end) : to };
}

/**
 * Durchschnittswerte eines Zeitraums.
 *
 * Gemittelt wird über die Monate, die schon begonnen haben: Wer im September
 * „Dieses Jahr“ auswertet, will den Schnitt über neun Monate sehen, nicht
 * über zwölf, von denen drei noch leer sind.
 *
 * @param {object} report  Ergebnis von periodReport()
 * @returns {{months:number, income:number, expense:number, profit:number,
 *   perIncome:number|null, perExpense:number|null, best:object|null, worst:object|null}}
 */
export function averages(report, today = todayISO()) {
  const now = ym(today);
  const months = (report.months || []).filter((m) => m.ym <= now);
  const n = months.length;
  const avg = (v) => (n ? Math.round(v / n) : 0);
  const income = sum(months, (m) => m.income);
  const expense = sum(months, (m) => m.expense);
  let best = null;
  let worst = null;
  for (const m of months) {
    if (!best || m.profit > best.profit) best = m;
    if (!worst || m.profit < worst.profit) worst = m;
  }
  return {
    months: n,
    income: avg(income),
    expense: avg(expense),
    profit: avg(income - expense),
    // Je Buchung: nur echte Buchungen, ohne die rechnerische Abschreibung.
    perIncome: report.countIncome ? Math.round(report.incomeForProfit / report.countIncome) : null,
    perExpense: report.countExpense
      ? Math.round((report.expenseForProfit - (report.depreciation || 0)) / report.countExpense)
      : null,
    best: n > 1 ? best : null,
    worst: n > 1 ? worst : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Liquidität und Konten                                                       */
/* -------------------------------------------------------------------------- */

/** Kontostände zum Stichtag: Anfangsbestand plus alle bezahlten Bewegungen. */
export function accountBalances(db, asOf) {
  return (db.accounts || []).map((acc) => {
    let balance = Number(acc.openingBalance) || 0;
    let inflow = 0, outflow = 0;
    for (const tx of db.transactions) {
      if (!isEffective(tx) || tx.accountId !== acc.id) continue;
      const d = tx.paidDate;
      if (!d || d > asOf) continue;
      if (d < (acc.openingDate || '0000-01-01')) continue;
      if (tx.type === 'income') { balance += tx.gross; inflow += tx.gross; }
      else { balance -= tx.gross; outflow += tx.gross; }
    }
    return { ...acc, balance, inflow, outflow };
  });
}

/**
 * Kontenblatt eines Zeitraums: Anfangsbestand, die bezahlten Bewegungen nach
 * Zahlungstag und der laufende Saldo. Es gilt dieselbe Regel wie für die
 * Kontostände – Bewegungen vor dem Stichtag des Anfangsbestands stecken schon
 * in ihm. Bis Fassung 1.7.0 zählte das Kontenblatt sie ein zweites Mal, und
 * sein Endbestand wich vom Kontostand ab.
 *
 * @returns {{opening:number, rows:Array<{tx:object, balance:number}>, closing:number}}
 */
export function accountLedger(db, acc, from, to) {
  const start = acc.openingDate || '0000-01-01';
  let balance = Number(acc.openingBalance) || 0;
  const bewegt = [];
  for (const t of db.transactions || []) {
    const d = t.paidDate;
    if (!isEffective(t) || t.accountId !== acc.id || !d || d < start || d > to) continue;
    if (d < from) balance += t.type === 'income' ? t.gross : -t.gross;
    else bewegt.push(t);
  }
  const opening = balance;
  const rows = bewegt
    .sort((a, b) => a.paidDate.localeCompare(b.paidDate))
    .map((tx) => {
      balance += tx.type === 'income' ? tx.gross : -tx.gross;
      return { tx, balance };
    });
  return { opening, rows, closing: balance };
}

/**
 * Kassen (Konten der Art „cash“), deren Bestand im Zeitraum unter null fällt –
 * je Kasse der erste solche Tag. Gerechnet wird mit dem Stand am Tagesende,
 * damit eine Einnahme und eine Ausgabe am selben Tag nicht je nach
 * Reihenfolge einen Fehlbetrag vortäuschen.
 */
export function negativeCash(db, from, to) {
  const out = [];
  for (const acc of (db.accounts || []).filter((a) => a.kind === 'cash')) {
    const start = acc.openingDate || '0000-01-01';
    const byDay = new Map();
    for (const tx of db.transactions || []) {
      const d = tx.paidDate;
      if (!isEffective(tx) || tx.accountId !== acc.id || !d || d < start || d > to) continue;
      const day = byDay.get(d) || { delta: 0, ids: [] };
      day.delta += tx.type === 'income' ? tx.gross : -tx.gross;
      if (tx.type !== 'income') day.ids.push(tx.id);
      byDay.set(d, day);
    }
    let balance = Number(acc.openingBalance) || 0;
    for (const d of [...byDay.keys()].sort()) {
      balance += byDay.get(d).delta;
      if (balance < 0 && d >= from) {
        out.push({ accountId: acc.id, name: acc.name || 'Kasse', date: d, balance, ids: byDay.get(d).ids });
        break;
      }
    }
  }
  return out;
}

export function cashFlow(db, from, to) {
  let inflow = 0, outflow = 0;
  for (const tx of db.transactions) {
    if (!isEffective(tx)) continue;
    const d = tx.paidDate;
    if (!d || d < from || d > to) continue;
    if (tx.type === 'income') inflow += tx.gross; else outflow += tx.gross;
  }
  return { inflow, outflow, net: inflow - outflow };
}

/* -------------------------------------------------------------------------- */
/* Offene Posten                                                               */
/* -------------------------------------------------------------------------- */

export function openItems(db, asOf = todayISO()) {
  const receivables = [];
  const payables = [];
  for (const tx of db.transactions) {
    if (isVoidPart(tx) || tx.paidDate) continue;
    if (tx.date > asOf) continue;
    const cat = catOf(db, tx);
    if (isPrivate(cat)) continue;
    const dueDate = tx.dueDate || tx.date;
    const overdueDays = Math.max(0, daysBetween(dueDate, asOf));
    const item = { ...tx, dueDate, overdueDays, overdue: overdueDays > 0 };
    if (tx.type === 'income') receivables.push(item); else payables.push(item);
  }
  const bucket = (items) => {
    const b = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
    for (const i of items) {
      if (!i.overdue) b.current += i.gross;
      else if (i.overdueDays <= 30) b.d30 += i.gross;
      else if (i.overdueDays <= 60) b.d60 += i.gross;
      else if (i.overdueDays <= 90) b.d90 += i.gross;
      else b.older += i.gross;
    }
    return b;
  };
  return {
    receivables: receivables.sort((a, b) => b.overdueDays - a.overdueDays),
    payables: payables.sort((a, b) => b.overdueDays - a.overdueDays),
    receivableTotal: sum(receivables, (t) => t.gross),
    payableTotal: sum(payables, (t) => t.gross),
    receivableAging: bucket(receivables),
    payableAging: bucket(payables),
  };
}

/* -------------------------------------------------------------------------- */
/* Vermögensübersicht ("Bilanz" für die EÜR-Welt)                              */
/* -------------------------------------------------------------------------- */

/**
 * Wer eine EÜR macht, ist nicht bilanzierungspflichtig. Trotzdem will man
 * wissen, was einem gehört und was man schuldet. Diese Übersicht stellt
 * Vermögen und Schulden gegenüber; das Eigenkapital ergibt sich als Differenz.
 * Sie ersetzt keine handelsrechtliche Bilanz nach § 266 HGB.
 */
export function balanceSheet(db, asOf, opts = {}) {
  const accounts = accountBalances(db, asOf);
  const cash = sum(accounts, (a) => a.balance);
  const open = openItems(db, asOf);
  // Ausgeschiedene Güter gehören nicht mehr zum Vermögen.
  const assets = (db.assets || [])
    .filter((a) => !a.abgang?.datum || a.abgang.datum > String(asOf))
    .map((a) => ({ ...a, bookValue: bookValue(a, asOf) }));
  const fixedAssets = sum(assets, (a) => a.bookValue);

  const yearStart = `${String(asOf).slice(0, 4)}-01-01`;
  const ytd = periodReport(db, yearStart, asOf, opts);
  // Über alle Jahre: Die Schuld aus dem vierten Quartal bleibt über den
  // Jahreswechsel stehen, bis sie im Januar bezahlt ist. Bis 2.26 rechnete
  // die Übersicht nur das laufende Jahr und zeigte nach der Januarzahlung
  // eine Forderung, die es nicht gab.
  const vatOpen = ustSaldo(db, asOf);

  const activaTotal = fixedAssets + open.receivableTotal + cash;
  const passivaDebt = open.payableTotal + Math.max(0, vatOpen);
  const equity = activaTotal - passivaDebt;

  return {
    asOf,
    activa: {
      fixedAssets, assets,
      receivables: open.receivableTotal,
      cash, accounts,
      total: activaTotal,
    },
    passiva: {
      payables: open.payableTotal,
      vatLiability: Math.max(0, vatOpen),
      vatClaim: Math.max(0, -vatOpen),
      equity,
      total: passivaDebt + equity,
    },
    equityDevelopment: {
      profitYtd: ytd.profit,
      withdrawals: ytd.privateOut,
      deposits: ytd.privateIn,
    },
  };
}

/**
 * Stand des Umsatzsteuerkontos zum Stichtag über alle Jahre: Umsatzsteuer
 * (nach der Versteuerungsart, die am Tag der Buchung galt) minus Vorsteuer,
 * minus Zahlungen an das Finanzamt, plus Erstattungen. Positiv = Schuld.
 */
export function ustSaldo(db, bis) {
  let saldo = 0;
  for (const tx of db.transactions || []) {
    if (!isEffective(tx)) continue;
    const cat = catOf(db, tx);
    if (isPrivate(cat)) continue;
    if (cat?.vatNeutral) {
      if (tx.paidDate && tx.paidDate <= bis) saldo += tx.type === 'income' ? tx.gross : -tx.gross;
      continue;
    }
    const d = tx.type === 'income' ? effectiveDate(tx, basisOf(db, tx.date)) : vorsteuerDatum(tx);
    if (!d || d > bis || isKleinunternehmer(db, d)) continue;
    saldo += tx.type === 'income' ? tx.vat : -tx.vat;
  }
  return saldo;
}

/* -------------------------------------------------------------------------- */
/* Anzahlungen                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Rechnet eine Anzahlung auf den vereinbarten Gesamtbetrag hoch.
 *
 * Erfasst wird die tatsächlich geflossene Anzahlung; der Prozentsatz sagt,
 * welcher Anteil des Auftrags damit beglichen ist. Daraus ergeben sich der
 * Gesamtbetrag und der noch offene Restbetrag – die Zahl, die zum
 * Veranstaltungstag fällig wird.
 *
 * @returns {{percent:number, total:number, remaining:number, eventDate:string}|null}
 */
export function depositInfo(tx) {
  if (!tx || !tx.isDeposit) return null;
  const percent = Number(tx.depositPercent) || 0;
  if (percent <= 0 || percent > 100) return { percent, total: 0, remaining: 0, eventDate: tx.eventDate || '' };
  const total = Math.round((Number(tx.gross) || 0) * 100 / percent);
  return { percent, total, remaining: total - (Number(tx.gross) || 0), eventDate: tx.eventDate || '' };
}

/* -------------------------------------------------------------------------- */
/* Umsatzsteuer-Voranmeldung                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Leitet die umsatzsteuerliche Behandlung einer Buchung ab. Eine Rechnung gibt
 * ihren Steuerfall beim Ausstellen mit (`tx.vatTreatment`, lib/rechnungsaktionen.js):
 * so landen innergemeinschaftliche Lieferungen in Kennzahl 41 und Ausfuhren in 43,
 * nicht in 48 (steuerfrei ohne Vorsteuerabzug).
 *
 * Seit 2.27:
 *  - Ohne Kategorie und ohne Steuersatz ist eine Buchung nicht „steuerfrei“
 *    (Kennzahl 48), sondern 'ohne-kategorie': Sie fehlt in jeder Kennzahl,
 *    und Voranmeldung, EÜR und Exporte weisen auf sie hin.
 *  - Steuerschuld beim Kunden richtet sich nach seinem Land (kontaktLand):
 *    Unternehmen in der EU Kennzahl 21 und Zusammenfassende Meldung,
 *    außerhalb der EU nicht steuerbar in Kennzahl 45, mit deutscher
 *    USt-IdNr. Inland-§ 13b in Kennzahl 60. Beim Empfänger gehören
 *    Leistungen aus der EU in 46/47, alle übrigen nach § 13b in 84/85.
 */
export function vatTreatment(db, tx) {
  const cat = catOf(db, tx);
  let t = tx.vatTreatment || grundBehandlung(cat, tx);
  // Bis 2.26 schrieb das Buchungsfenster „steuerfrei“ auch ohne Kategorie fest.
  if (t === 'steuerfrei' && !cat) t = 'ohne-kategorie';
  if (t === 'reverse-charge-out') return steuerschuldKunde(db, tx);
  if (t === 'reverse-charge-in') return steuerschuldSelbst(db, tx);
  return t;
}

function grundBehandlung(cat, tx) {
  // Mahngebühren und Verzugsaufschlag sind Schadensersatz, kein Entgelt: nicht steuerbar, in keiner Kennzahl (siehe lib/mahnwesen.js).
  if (cat?.notTaxable) return 'nicht-steuerbar';
  if (cat?.intraEu) return tx.type === 'income' ? 'ig-lieferung' : 'ig-erwerb';
  if (cat?.reverseCharge || tx.reverseCharge) return tx.type === 'income' ? 'reverse-charge-out' : 'reverse-charge-in';
  if ((tx.vatRate || 0) === 0) return cat ? 'steuerfrei' : 'ohne-kategorie';
  return 'standard';
}

/**
 * Land des Geschäftspartners einer Buchung: aus der USt-IdNr. (sicher), sonst
 * aus dem Land beim Kontakt. `ausUstId` sagt, ob es aus der USt-IdNr. stammt –
 * das Land beim Kontakt steht ohne Auswahl auf Deutschland.
 */
export function kontaktLand(db, tx) {
  const k = tx?.contactId ? (db.contacts || []).find((c) => c.id === tx.contactId) : null;
  if (!k) return { land: '', ausUstId: false };
  const id = String(k.vatId || k.taxId || '').replace(/[\s.-]/g, '').toUpperCase();
  const m = /^([A-Z]{2})[0-9A-Z+*]{2,12}$/.exec(id);
  if (m) return { land: m[1] === 'EL' ? 'GR' : m[1], ausUstId: true };
  return { land: String(k.country || '').toUpperCase(), ausUstId: false };
}

/** Liegt das Land sicher außerhalb der EU? (XI = Nordirland zählt für Waren zur EU.) */
const ausserhalbEu = (land) => !!land && land !== 'XI' && !istEuLand(land);

function steuerschuldKunde(db, tx) {
  const { land, ausUstId } = kontaktLand(db, tx);
  if (ausserhalbEu(land)) return 'ausland-nicht-steuerbar';
  if (ausUstId && land === 'DE') return 'rc-inland-out';
  return 'reverse-charge-out';
}

function steuerschuldSelbst(db, tx) {
  const { land, ausUstId } = kontaktLand(db, tx);
  if (ausserhalbEu(land) || (ausUstId && land === 'DE')) return 'rc-in-sonstige';
  return 'reverse-charge-in';
}

/**
 * Kennzahlen der Umsatzsteuer-Voranmeldung.
 * Die Nummern entsprechen den amtlichen Kennzahlen des Formulars.
 *
 * Es gilt der steuerliche Stand des Zeitraums (steuerStand): die
 * Versteuerungsart am ersten Tag, Kleinunternehmer je Buchung an ihrem Tag.
 * `ohneKategorie`: Kennungen der Buchungen ohne Kategorie im Zeitraum; solange
 * es sie gibt, ist die Voranmeldung nicht verlässlich.
 * Kennzahl 50 (Minderung wegen Forderungsausfall, in 81/86 schon enthalten)
 * steht nur zur Anzeige und geht nicht in die XML-Datei.
 */
export function vatReturn(db, from, to) {
  const basis = basisOf(db, from);
  const ohneKategorie = [];
  const k = {
    kz81net: 0, kz81tax: 0,   // 19 %
    kz86net: 0, kz86tax: 0,   // 7 %
    kz35net: 0, kz36tax: 0,   // andere Steuersätze
    kz41: 0,                  // innergemeinschaftliche Lieferungen
    kz21: 0,                  // nicht steuerbare sonstige Leistungen (§ 18b)
    kz43: 0,                  // steuerfreie Umsätze mit Vorsteuerabzug (Ausfuhr, § 4 Nr. 1a UStG u. a.)
    kz48: 0,                  // steuerfreie Umsätze ohne Vorsteuerabzug
    kz89net: 0, kz89tax: 0,   // innergemeinschaftliche Erwerbe 19 %
    kz93net: 0, kz93tax: 0,   // innergemeinschaftliche Erwerbe 7 %
    kz46net: 0, kz47tax: 0,   // Leistungen nach § 13b Abs. 1 aus dem übrigen EU-Gebiet (Empfänger)
    kz84net: 0, kz85tax: 0,   // andere Leistungen nach § 13b (Drittland, Inland; Empfänger)
    kz45: 0,                  // nicht steuerbare Leistungen außerhalb der EU (Leistungsort im Ausland)
    kz60: 0,                  // steuerpflichtige Umsätze, für die der Kunde die Steuer schuldet (Inland-§ 13b)
    kz50: 0,                  // davon Minderung wegen Forderungsausfall (§ 17 Abs. 2 Nr. 1), nur zur Anzeige
    kz66: 0,                  // Vorsteuer aus Rechnungen
    kz61: 0,                  // Vorsteuer aus i.g. Erwerben
    kz67: 0,                  // Vorsteuer aus § 13b
    kz39: 0,                  // Sondervorauszahlung (Dauerfristverlängerung), in der Dezember-Voranmeldung
    kz83: 0,                  // verbleibende Vorauszahlung
  };
  if (isKleinunternehmer(db, from) && isKleinunternehmer(db, to)) return { ...k, ohneKategorie, kleinunternehmer: true, from, to };

  for (const tx of db.transactions) {
    if (!isEffective(tx)) continue;
    const d = tx.type === 'income' ? effectiveDate(tx, basis) : vorsteuerDatum(tx);
    if (!d || d < from || d > to) continue;
    // Umsätze aus der Zeit als Kleinunternehmer gehören in keine Voranmeldung.
    if (isKleinunternehmer(db, d)) continue;
    const cat = catOf(db, tx);
    if (cat?.private || cat?.vatNeutral) continue;
    if (!cat) ohneKategorie.push(tx.id);
    const t = vatTreatment(db, tx);
    if (t === 'nicht-steuerbar' || t === 'ohne-kategorie') continue; // keine Kennzahl der Voranmeldung, aber Betriebseinnahme (euerReport)
    const rate = Number(tx.vatRate) || 0;

    if (tx.type === 'income') {
      if (t === 'ig-lieferung') k.kz41 += tx.net;
      else if (t === 'reverse-charge-out') k.kz21 += tx.net;
      else if (t === 'ausland-nicht-steuerbar') k.kz45 += tx.net;
      else if (t === 'rc-inland-out') k.kz60 += tx.net;
      else if (t === 'ausfuhr') k.kz43 += tx.net;
      else if (t === 'steuerfrei') k.kz48 += tx.net;
      else if (rate === 19) { k.kz81net += tx.net; k.kz81tax += tx.vat; }
      else if (rate === 7) { k.kz86net += tx.net; k.kz86tax += tx.vat; }
      else if (rate > 0) { k.kz35net += tx.net; k.kz36tax += tx.vat; }
      // Forderungsausfall bei Soll: steckt schon in 81/86, steht zusätzlich in Kennzahl 50.
      if (tx.ausbuchung === 'uneinbringlich' && basis === 'soll' && rate > 0) k.kz50 += tx.net;
    } else {
      if (t === 'ig-erwerb') {
        // Zu 7 % in Kennzahl 93, sonst 89 – bis Fassung 1.7 landete alles in 89 (19 %).
        const tax = Math.round((tx.net * (rate || 19)) / 100);
        if (rate === 7) { k.kz93net += tx.net; k.kz93tax += tax; } else { k.kz89net += tx.net; k.kz89tax += tax; }
        k.kz61 += tax; // gleichzeitig als Vorsteuer abziehbar
      } else if (t === 'reverse-charge-in' || t === 'rc-in-sonstige') {
        const tax = Math.round((tx.net * (rate || 19)) / 100);
        if (t === 'reverse-charge-in') { k.kz46net += tx.net; k.kz47tax += tax; } else { k.kz84net += tx.net; k.kz85tax += tax; }
        k.kz67 += tax;
      } else {
        k.kz66 += tx.vat;
      }
    }
  }

  // Sondervorauszahlung: Monatszahler mit Dauerfristverlängerung ziehen sie in
  // der Voranmeldung für Dezember ab (§ 48 Abs. 4 UStDV).
  const jahr = String(from).slice(0, 4);
  const st = steuerStand(db, from);
  if (from === `${jahr}-12-01` && to === `${jahr}-12-31` && st.vatPeriod === 'monatlich' && st.vatDeadline === 'dauerfrist') {
    k.kz39 = Math.max(0, Math.round(Number(db.settings?.sondervorauszahlungen?.[jahr]) || 0));
  }

  k.umsatzsteuer = k.kz81tax + k.kz86tax + k.kz36tax + k.kz89tax + k.kz93tax + k.kz47tax + k.kz85tax;
  k.vorsteuer = k.kz66 + k.kz61 + k.kz67;
  k.kz83 = k.umsatzsteuer - k.vorsteuer - k.kz39;
  return { ...k, ohneKategorie, from, to, kleinunternehmer: false };
}

/** Alle Voranmeldungszeiträume eines Jahres (Rhythmus wie am 1. Januar eingestellt). */
export function vatPeriods(db, year) {
  const mode = steuerStand(db, `${year}-01-01`).vatPeriod || 'vierteljährlich';
  const p = (from, to, label) => ({ from, to, label, result: vatReturn(db, from, to) });
  if (mode === 'jährlich') return [p(`${year}-01-01`, `${year}-12-31`, 'Jahr')];
  if (mode === 'monatlich') {
    return Array.from({ length: 12 }, (_, i) => {
      const from = `${year}-${String(i + 1).padStart(2, '0')}-01`;
      return p(from, monthEnd(from), ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][i]);
    });
  }
  return Array.from({ length: 4 }, (_, q) => {
    const from = `${year}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    const to = monthEnd(`${year}-${String(q * 3 + 3).padStart(2, '0')}-01`);
    return p(from, to, `${q + 1}. Quartal`);
  });
}

/* -------------------------------------------------------------------------- */
/* Anlage EÜR                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 10-Tage-Regel (§ 11 Abs. 1 Satz 2 und Abs. 2 Satz 2 EStG): Regelmäßig
 * wiederkehrende Einnahmen und Ausgaben, die kurz vor oder nach dem
 * Jahreswechsel (22.12. bis 10.01.) fällig und gezahlt werden, gehören in das
 * Jahr, zu dem sie wirtschaftlich gehören.
 *
 * Regelmäßig wiederkehrend sind Buchungen aus einer wiederkehrenden Regel
 * (`recurringId`), aus einer Kategorie mit `regelmaessig` und von selbst die
 * Umsatzsteuer-Vorauszahlung an das Finanzamt: Eine Zahlung vom 1. bis
 * 10. Januar ist die für Dezember, das vierte Quartal oder (mit
 * Dauerfristverlängerung) November, fällig am 10. Januar. Die für Dezember mit
 * Dauerfristverlängerung ist erst am 10. Februar fällig und fällt nicht darunter.
 * Wirtschaftlich zugehörig ist das Jahr des Buchungsdatums, fällig die
 * Fälligkeit oder sonst das Buchungsdatum.
 *
 * @returns {string} der Tag, unter dem die Zahlung in der EÜR zählt
 */
export function zehnTageDatum(db, tx) {
  const bezahlt = tx?.paidDate || '';
  if (!bezahlt) return bezahlt;
  const cat = catOf(db, tx);
  const ustZahlung = tx.type === 'expense' && !!cat?.vatNeutral && Number(cat.euerLine) === EUER.ustGezahlt;
  if (!ustZahlung && !tx.recurringId && !cat?.regelmaessig) return bezahlt;
  const y = Number(bezahlt.slice(0, 4));
  const md = bezahlt.slice(5);
  const faellig = String(tx.dueDate || tx.date || '');
  const datum = String(tx.date || '');
  if (md <= '01-10') {
    if (ustZahlung) return `${y - 1}-12-31`;
    if (faellig >= `${y - 1}-12-22` && faellig <= `${y}-01-10` && datum.startsWith(`${y - 1}-`)) return `${y - 1}-12-31`;
  } else if (md >= '12-22') {
    if (faellig >= `${y}-12-22` && faellig <= `${y + 1}-01-10` && datum.startsWith(`${y + 1}-`)) return `${y + 1}-01-01`;
  }
  return bezahlt;
}

/**
 * Ordnet den Zeitraum den Zeilen der Anlage EÜR zu.
 *
 * Maßgeblich ist immer der Zahlungsfluss (§ 11 EStG), auch wer die
 * Umsatzsteuer nach vereinbarten Entgelten (Soll) versteuert.
 *
 * Beschränkt abziehbare Ausgaben (Bewirtung zu 70 %) stehen im Formular in
 * zwei Spalten; `nonDeductible` ist der Teil für die linke Spalte, `amount`
 * der abziehbare, der in die Summe eingeht.
 *
 * Die Zeilennummern folgen dem Vordruck des Jahres, in dem der Zeitraum endet
 * (`form`, samt den festen Zeilen in dessen Nummern); `canon` ist die
 * gespeicherte Zuordnung nach dem Vordruck 2025.
 *
 * Seit 2.27: Buchungen ohne Kategorie fallen nicht mehr heraus, sondern stehen
 * in Zeile 15 (als Kleinunternehmer 12) bzw. 60 und werden in `ohneKategorie`
 * gemeldet. Regelmäßig wiederkehrende Zahlungen um den Jahreswechsel zählen nach
 * der 10-Tage-Regel (zehnTageDatum, Liste in `zehnTage`). Die AfA steht je Gut
 * in Zeile 31, 32 oder 33, Restbuchwerte ausgeschiedener Güter in Zeile 38.
 * Kleinunternehmer oder nicht gilt je Buchung an ihrem Tag (steuerStand).
 *
 * Rückgabe: { income:[{line,canon,label,amount,nonDeductible}], expense:[...], form, totals }
 */
export function euerReport(db, from, to) {
  const klein = isKleinunternehmer(db, to);
  const basis = 'ist';
  const ohneKategorie = [];
  const zehnTage = [];
  const lines = db.euerLines || {};
  const income = new Map();
  const expense = new Map();
  const nonDeductible = new Map();

  const add = (map, line, amount) => {
    if (line === null || line === undefined || line === '') return;
    const key = Number(line);
    map.set(key, (map.get(key) || 0) + amount);
  };

  let vatCollected = 0;
  let vatPaid = 0;

  for (const tx of db.transactions) {
    if (!isEffective(tx)) continue;
    const gezahlt = effectiveDate(tx, basis);
    if (!gezahlt) continue;
    const d = zehnTageDatum(db, tx);
    const drin = d >= from && d <= to;
    if (d !== gezahlt && drin !== (gezahlt >= from && gezahlt <= to)) zehnTage.push({ id: tx.id, bezahlt: gezahlt, zugeordnet: d, hinein: drin });
    if (!drin) continue;
    const cat = catOf(db, tx);
    if (cat?.private) continue;
    const kl = isKleinunternehmer(db, d);

    if (cat?.vatNeutral) {
      // Zahlungen an das bzw. vom Finanzamt stehen in eigenen Zeilen.
      add(tx.type === 'income' ? income : expense, cat.euerLine, tx.gross);
      continue;
    }
    // Ohne Kategorie: nicht weglassen, sondern in die allgemeine Zeile und melden.
    if (!cat) ohneKategorie.push(tx.id);

    if (tx.type === 'income') {
      if (!kl) vatCollected += tx.vat;
      let line = cat?.euerLine ?? (kl ? EUER.kleinunternehmer : EUER.steuerpflichtig);
      // Als Kleinunternehmer gehören alle Umsätze in Zeile 12, gleich welcher
      // Kategorie sie zugeordnet sind; nur Anlagenverkäufe und Entnahmen
      // (Zeilen 19 bis 21) stehen weiter für sich.
      if (kl && UMSATZ_ZEILEN.has(Number(line))) line = EUER.kleinunternehmer;
      add(income, line, kl ? tx.gross : tx.net);
    } else {
      if (!kl) vatPaid += tx.vat;
      if (tx.assetId) continue; // wirkt über die AfA
      const full = kl ? tx.gross : tx.net;
      const amount = Math.round(full * (cat?.deductibleRate ?? 1));
      const line = cat?.euerLine ?? EUER.uebrigeAusgaben;
      add(expense, line, amount);
      if (amount !== full) add(nonDeductible, line, full - amount);
    }
  }

  for (const a of db.assets || []) {
    const afa = depreciationInRange(a, from, to);
    if (afa) add(expense, afaZeile(a), afa);
  }
  const rest = restbuchwerte(db, from, to);
  if (rest) add(expense, EUER.restbuchwerte, rest);

  if (vatCollected) add(income, EUER.ustVereinnahmt, vatCollected);
  if (vatPaid) add(expense, EUER.vorsteuer, vatPaid);

  const jahr = Number(String(to).slice(0, 4));
  const toRows = (map) => [...map.entries()]
    .filter(([line, v]) => v !== 0 || nonDeductible.get(line))
    .sort((a, b) => a[0] - b[0])
    .map(([canon, amount]) => ({
      line: formLine(canon, jahr), canon,
      label: EUER_ZEILEN[canon] || lines[canon] || `Zeile ${canon}`, amount, nonDeductible: nonDeductible.get(canon) || 0,
    }));

  const incomeRows = toRows(income);
  const expenseRows = toRows(expense);
  const incomeTotal = sum(incomeRows, (r) => r.amount);
  const expenseTotal = sum(expenseRows, (r) => r.amount);
  const profit = incomeTotal - expenseTotal;

  // Überleitung: In der EÜR läuft die Umsatzsteuer als Betriebseinnahme bzw.
  // -ausgabe mit (Zeilen 17, 18, 57, 58). Der EÜR-Gewinn weicht deshalb vom
  // Nettoergebnis der GuV ab, solange die Zahllast noch nicht überwiesen ist.
  const at = (rows, canon) => rows.find((r) => r.canon === canon)?.amount || 0;
  const vatFlow = at(incomeRows, EUER.ustVereinnahmt) + at(incomeRows, EUER.ustErstattet)
    - at(expenseRows, EUER.vorsteuer) - at(expenseRows, EUER.ustGezahlt);

  return {
    from, to, kleinunternehmer: klein, basis,
    form: formLines(jahr),
    income: incomeRows,
    expense: expenseRows,
    incomeTotal,
    expenseTotal,
    profit,
    ohneKategorie,
    zehnTage,
    reconciliation: {
      netResult: profit - vatFlow,
      vatCollected: at(incomeRows, EUER.ustVereinnahmt),
      vatRefunded: at(incomeRows, EUER.ustErstattet),
      vatDeducted: at(expenseRows, EUER.vorsteuer),
      vatRemitted: at(expenseRows, EUER.ustGezahlt),
      vatFlow,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Kennzahlen für die Übersicht                                                */
/* -------------------------------------------------------------------------- */

/**
 * Zeitraum und Vergleichszeitraum.
 *
 * Verglichen wird mit dem Zeitraum unmittelbar davor – bei ganzen Monaten
 * kalendergenau: März mit Februar, ein Quartal mit dem Vorquartal, ein Jahr
 * mit dem Vorjahr. Früher wurde nur um die Zahl der Tage zurückgerechnet;
 * aus dem März wurde so der 29.01.–28.02.
 *
 * Läuft der Zeitraum noch, zählen beide Seiten nur bis zum gleichen Stand:
 * 01.01.–25.09. gegen 01.01.–25.09. des Vorjahres. Sonst stünde ein
 * angebrochenes Jahr gegen ein volles und zeigte im September einen Rückgang,
 * den es nicht gibt. `current` bleibt der ganze Zeitraum (für die angezeigten
 * Summen), `currentToDate` ist die Seite, die in den Vergleich eingeht.
 */
export function compareRanges(db, from, to, today = todayISO()) {
  const ganzeMonate = from === monthStart(from) && to === monthEnd(to);
  const n = ganzeMonate
    ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1
    : 0;
  const tage = daysBetween(from, to) + 1;
  const zurueck = (iso) => (ganzeMonate ? addMonths(iso, -n) : addDays(iso, -tage));
  const prevFrom = zurueck(from);
  const prevEnd = ganzeMonate ? monthEnd(addMonths(monthStart(to), -n)) : zurueck(to);
  const laufend = from <= today && today < to;
  // Der Vormonat kann kürzer sein (31. März → 28. Februar); dann gilt sein Ende.
  const prevTo = laufend ? [zurueck(today), prevEnd].sort()[0] : prevEnd;
  const current = periodReport(db, from, to);
  return {
    current,
    currentToDate: laufend ? periodReport(db, from, today) : current,
    previous: periodReport(db, prevFrom, prevTo),
    prevFrom,
    prevTo,
    toDate: laufend ? today : null,
  };
}

export function trend(current, previous) {
  if (!previous) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

/* -------------------------------------------------------------------------- */
/* Jahresvergleich                                                             */
/* -------------------------------------------------------------------------- */

/** Letzter Tag eines Vergleichsjahres: das Jahresende, oder derselbe Tag (MM-TT) wie im Stichjahr. */
function vergleichsEnde(jahr, bis) {
  if (!bis) return `${jahr}-12-31`;
  // Der 29. Februar gibt es nicht in jedem Jahr: dann gilt der 28.
  const ende = monthEnd(`${jahr}-${bis.slice(0, 2)}-01`);
  return bis > ende.slice(5) ? ende : `${jahr}-${bis}`;
}

/**
 * Dieselbe Kategorie oder dieselben Gesamtzahlen über mehrere Jahre nebeneinander.
 * Zählweise wie überall (Zahlungstag, Kleinunternehmer brutto, Private nur, wenn der
 * Bestand sie enthält), damit die Zahlen mit GuV und Übersicht übereinstimmen.
 *
 * @param {object} db
 * @param {{jahre:number[], art?:'expense'|'income', bis?:string|null}} opts
 *   bis: 'MM-TT' vergleicht jedes Jahr nur bis zu diesem Tag (fair für das laufende Jahr), sonst ganze Jahre
 * @returns {{jahre:number[], art:string, bis:string|null, summen:object, ergebnis:object, kategorien:object[], vorjahr:object|null}}
 */
export function jahresvergleich(db, { jahre, art = 'expense', bis = null } = {}) {
  const liste = [...new Set((jahre || []).map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
  const berichte = new Map(liste.map((y) => [y, periodReport(db, `${y}-01-01`, vergleichsEnde(y, bis))]));
  const summen = {};
  const ergebnis = {};
  const zeilen = new Map();
  const ausgaben = art === 'expense';
  for (const y of liste) {
    const r = berichte.get(y);
    summen[y] = ausgaben ? r.expenseForProfit : r.incomeForProfit;
    ergebnis[y] = r.profit;
    for (const c of r.byCategory.filter((x) => x.kind === art)) {
      const key = c.categoryId || '∅';
      if (!zeilen.has(key)) zeilen.set(key, { id: key === '∅' ? '' : key, name: c.name, werte: {}, anzahl: {} });
      const z = zeilen.get(key);
      z.werte[y] = (z.werte[y] || 0) + c.amount;
      z.anzahl[y] = (z.anzahl[y] || 0) + c.count;
    }
    if (ausgaben && r.depreciation) {
      if (!zeilen.has('afa')) zeilen.set('afa', { id: 'afa', name: 'Abschreibungen (AfA)', werte: {}, anzahl: {} });
      zeilen.get('afa').werte[y] = r.depreciation;
    }
  }
  const letztes = liste.at(-1);
  const kategorien = [...zeilen.values()].map((z) => {
    for (const y of liste) z.werte[y] ||= 0;
    const vor = liste.length > 1 ? z.werte[liste.at(-2)] : null;
    return {
      ...z,
      summe: sum(liste, (y) => z.werte[y]),
      // Veränderung des letzten Jahres gegenüber dem davor
      diff: vor === null ? null : z.werte[letztes] - vor,
      trend: vor === null ? null : trend(z.werte[letztes], vor),
    };
  }).sort((a, b) => Math.abs(b.werte[letztes] || 0) - Math.abs(a.werte[letztes] || 0) || Math.abs(b.summe) - Math.abs(a.summe));
  const vorjahr = liste.length > 1 ? liste.at(-2) : null;
  return {
    jahre: liste, art, bis, summen, ergebnis, kategorien, vorjahr,
    veraenderung: vorjahr === null ? null : { diff: summen[letztes] - summen[vorjahr], trend: trend(summen[letztes], summen[vorjahr]) },
  };
}

/**
 * Monatswerte (Jan bis Dez) je Jahr für den Verlauf im Jahresvergleich: alle Ausgaben bzw. Einnahmen,
 * eine Kategorie (categoryId) oder die Abschreibungen ('afa').
 * @returns {Object<number, number[]>} Jahr → zwölf Beträge in Cent
 */
export function jahresMonate(db, { jahre, art = 'expense', categoryId = '', bis = null } = {}) {
  const aus = {};
  for (const y of jahre || []) {
    const werte = new Array(12).fill(0);
    const ende = vergleichsEnde(y, bis);
    if (categoryId !== 'afa') {
      for (const tx of db.transactions) {
        if (tx.type !== art || !isEffective(tx)) continue;
        const d = effectiveDate(tx, PROFIT_BASIS);
        if (!d || d < `${y}-01-01` || d > ende) continue;
        const cat = catOf(db, tx);
        if (isPrivate(cat) || cat?.vatNeutral || isCapitalised(tx)) continue;
        if (categoryId && (tx.categoryId || '') !== categoryId) continue;
        werte[Number(d.slice(5, 7)) - 1] += profitAmount(tx, isKleinunternehmer(db, d));
      }
    }
    if (art === 'expense' && (!categoryId || categoryId === 'afa')) {
      for (const asset of db.assets || []) {
        for (const e of depreciationPlan(asset)) {
          if (e.ym.startsWith(`${y}-`) && `${e.ym}-01` <= ende) werte[Number(e.ym.slice(5, 7)) - 1] += e.amount;
        }
      }
    }
    aus[y] = werte;
  }
  return aus;
}

/** Größte Ausgabenblöcke, für die "Wo geht das Geld hin"-Ansicht. */
export function topCategories(report, kind, limit = 8) {
  return report.byCategory.filter((c) => c.kind === kind).slice(0, limit);
}

/** Belegdichte: Anteil der Buchungen mit hinterlegtem Beleg. */
export function receiptCoverage(db, from, to) {
  const txs = db.transactions.filter((t) => countsForProfit(t, from, to, PROFIT_BASIS) && !isVoidPart(t));
  const withDoc = txs.filter((t) => (t.attachments || []).length > 0);
  return { total: txs.length, withDoc: withDoc.length, ratio: txs.length ? withDoc.length / txs.length : 1, missing: txs.filter((t) => !(t.attachments || []).length) };
}

/** Einfache Plausibilitätsprüfungen vor dem Jahresabschluss. */
export function healthChecks(db, from, to) {
  const issues = [];
  const basis = PROFIT_BASIS;
  // Stornierte Buchungen und ihre Gegenbuchungen heben sich auf und brauchen
  // weder Beleg noch Konto. Geprüft wird, was im Zeitraum entstanden oder
  // bezahlt worden ist.
  const inPeriod = (t) => (t.date >= from && t.date <= to) || (!!t.paidDate && t.paidDate >= from && t.paidDate <= to);
  const txs = db.transactions.filter((t) => !isVoidPart(t) && inPeriod(t));

  // Anzahl samt passender Einzahl oder Mehrzahl.
  const anz = (k, eins, viele) => `${k} ${k === 1 ? eins : viele}`;

  const noCategory = txs.filter((t) => !t.categoryId && countsForProfit(t, from, to, basis));
  if (noCategory.length) issues.push({ level: 'warn', text: `${anz(noCategory.length, 'Buchung', 'Buchungen')} ohne Kategorie. Voranmeldung und Anlage EÜR stimmen erst, wenn alles zugeordnet ist`, ids: noCategory.map((t) => t.id) });

  const noAccount = txs.filter((t) => t.paidDate && !t.accountId);
  if (noAccount.length) issues.push({ level: 'warn', text: `${anz(noAccount.length, 'bezahlte Buchung', 'bezahlte Buchungen')} ohne Konto, die Kontostände stimmen dadurch nicht`, ids: noAccount.map((t) => t.id) });

  const cov = receiptCoverage(db, from, to);
  if (cov.missing.length) issues.push({ level: 'info', text: `${anz(cov.missing.length, 'Buchung', 'Buchungen')} ohne Beleg`, ids: cov.missing.map((t) => t.id) });

  const mismatch = txs.filter((t) => Math.abs((t.net + t.vat) - t.gross) > 1);
  if (mismatch.length) issues.push({ level: 'error', text: `${anz(mismatch.length, 'Buchung', 'Buchungen')}, bei denen Netto und Steuer zusammen nicht den Bruttobetrag ergeben`, ids: mismatch.map((t) => t.id) });

  const future = txs.filter((t) => t.paidDate && t.paidDate > todayISO());
  if (future.length) issues.push({ level: 'info', text: `${anz(future.length, 'Zahlung', 'Zahlungen')} mit Datum in der Zukunft`, ids: future.map((t) => t.id) });

  const dupes = [];
  const seen = new Map();
  for (const t of txs) {
    const key = `${t.date}|${t.gross}|${(t.description || '').toLowerCase().trim()}`;
    if (seen.has(key)) dupes.push(t.id); else seen.set(key, t.id);
  }
  if (dupes.length) issues.push({ level: 'warn', text: `${anz(dupes.length, 'mögliche Doppelerfassung', 'mögliche Doppelerfassungen')} (gleiches Datum, gleicher Betrag, gleicher Text)`, ids: dupes });

  for (const k of negativeCash(db, from, to)) {
    issues.push({
      level: 'error',
      text: `${k.name} steht am ${fmtDate(k.date)} bei ${money(k.balance)} €. Eine Kasse kann nicht ins Minus gehen. `
        + 'Bei einer Betriebsprüfung gilt das als Hinweis auf fehlende Einnahmen. Meist lief eine Ausgabe in Wahrheit über die Bank, '
        + 'oder eine Bareinnahme fehlt.',
      ids: k.ids,
    });
  }

  // Die Grenze von 800 € gilt immer netto, auch für Kleinunternehmer, deren
  // Anschaffungskosten brutto erfasst sind (R 9b Abs. 2 EStR); dort rechnet
  // Kontovia mit 19 % heraus.
  const gwg = (db.assets || []).filter((a) => !a.abgang?.datum && a.method !== 'sofort'
    && (isKleinunternehmer(db, a.purchaseDate) ? Math.round((a.cost || 0) / 1.19) : (a.cost || 0)) <= 80000);
  if (gwg.length) issues.push({ level: 'info', text: `${anz(gwg.length, 'Anlagegut', 'Anlagegüter')} unter 800 € netto: Solche geringwertigen Anschaffungen lassen sich meist sofort voll absetzen`, ids: [] });

  for (const d of doppelteRechnungsnummern(db)) {
    issues.push({
      level: 'error',
      text: `Die Rechnungsnummer ${d.nummer} ist mehrfach vergeben. Jede Nummer darf nur einmal vorkommen. Das passiert meist, wenn auf zwei Geräten ohne Verbindung Rechnungen geschrieben wurden. Stornieren Sie eine der Rechnungen und stellen Sie sie mit neuer Nummer neu aus.`,
      ids: d.ids,
    });
  }

  // Ist-Versteuerung nur bis 800.000 € Umsatz im Vorjahr (§ 20 Satz 1 Nr. 1 UStG); Freiberufler dürfen auch darüber.
  const jahr = Number(String(to).slice(0, 4));
  if (!isKleinunternehmer(db, to) && basisOf(db, to) === 'ist') {
    const vorjahr = jahresumsatz(db, jahr - 1, (t) => t.net);
    if (vorjahr > 80000000) {
      issues.push({ level: 'warn', ids: [], text: `Umsatz ${jahr - 1}: ${money(vorjahr)} € netto, damit über 800.000 €. Nach Zahlungseingang dürfen Sie die Umsatzsteuer dann nur noch als Freiberufler oder mit Erlaubnis des Finanzamts berechnen. Bitte mit der Steuerberatung klären.` });
    }
  }

  // Erinnerung an die Festschreibung: Ist die Voranmeldung abgegeben, gehört der Zeitraum festgeschrieben (GoBD).
  const erklaert = letzterErklaerterZeitraum(db);
  const gesperrt = (db.locks || []).reduce((a, l) => (l.until > a ? l.until : a), '');
  if (erklaert && gesperrt < erklaert && (db.transactions || []).some((t) => t.date <= erklaert && t.date > (gesperrt || '0000'))) {
    issues.push({ level: 'info', ids: [], text: `Die Voranmeldung bis ${fmtDate(erklaert)} ist abgegeben, der Zeitraum aber noch nicht festgeschrieben. Schreiben Sie ihn fest, damit er sich nicht mehr unbemerkt ändert (Einstellungen › Firma & Steuern).` });
  }

  const falsch = misassignedEuerLines(db);
  if (falsch.length) {
    issues.push({
      level: 'warn',
      text: `EÜR-Zeile prüfen: ${falsch.map((c) => `„${c.name}“ (Zeile ${formLine(c.euerLine, String(to).slice(0, 4))})`).join(', ')}. Diese Zeile ist im Formular `
        + 'eine Summe oder passt nicht zur Art der Kategorie. Anpassen unter Stammdaten → Kategorien.',
      ids: [],
    });
  }

  issues.push(...smallBusinessChecks(db, to));
  return issues;
}

/**
 * Kategorien, deren EÜR-Zeile es im Formular 2025 nicht als Eingabezeile
 * gibt: Summen- und Übertragszeilen, Zeilen außerhalb der Einnahmen und
 * Ausgaben oder eine Ausgabenzeile an einer Einnahmekategorie (und umgekehrt).
 */
export function misassignedEuerLines(db) {
  const SUMMEN = new Set([EUER.summeEinnahmen, EUER.zwischensumme, EUER.summeUnbeschraenkt, EUER.summeAusgaben]);
  return (db.categories || []).filter((c) => {
    if (c.private || c.euerLine === null || c.euerLine === undefined || c.euerLine === '') return false;
    const z = Number(c.euerLine);
    if (!Number.isInteger(z) || SUMMEN.has(z) || z < EUER.kleinunternehmer || z > EUER.letzteAusgabe) return true;
    return c.kind === 'income' ? z > EUER.letzteEinnahme : z < EUER.ersteAusgabe;
  });
}

/** Umsatz eines Jahres nach Zahlungseingang, ohne Privates, Finanzamt, Anlagenverkäufe und nicht steuerbare Einnahmen. */
function jahresumsatz(db, y, betrag = (t) => t.gross) {
  let total = 0;
  for (const t of db.transactions || []) {
    if (!isEffective(t) || t.type !== 'income' || !t.paidDate || !t.paidDate.startsWith(`${y}-`)) continue;
    const cat = catOf(db, t);
    if (cat?.private || cat?.vatNeutral || cat?.notTaxable || Number(cat?.euerLine) === EUER.veraeusserung) continue;
    total += betrag(t);
  }
  return total;
}

/**
 * Kleinunternehmerregelung seit 2025 (§ 19 UStG): höchstens 25.000 € Umsatz im
 * Vorjahr und 100.000 € im laufenden Jahr. Wer die 100.000 € überschreitet,
 * ist ab genau diesem Umsatz regelbesteuert – nicht erst ab dem Folgejahr.
 * Im Jahr, in dem die Tätigkeit beginnt (`settings.taetigSeit`), gilt schon
 * im laufenden Jahr die Grenze von 25.000 €, ebenfalls ab dem Umsatz, der sie
 * überschreitet. Gerechnet wird mit den vereinnahmten Betriebseinnahmen ohne
 * Verkäufe von Anlagevermögen und ohne nicht steuerbare Einnahmen wie
 * Mahngebühren; das ist eine Näherung und ersetzt keine Prüfung.
 */
export function smallBusinessChecks(db, asOf = todayISO()) {
  if (!isKleinunternehmer(db, asOf)) return [];
  const year = Number(String(asOf).slice(0, 4));
  const jetzt = jahresumsatz(db, year);
  const vorjahr = jahresumsatz(db, year - 1);
  const seit = String(db.settings?.taetigSeit || '');
  const gruendungsjahr = /^\d{4}/.test(seit) && Number(seit.slice(0, 4)) === year;
  const out = [];
  if (vorjahr > 2500000) {
    out.push({ level: 'error', ids: [], text: `Umsatz ${year - 1}: ${money(vorjahr)} €, damit über 25.000 €. Die Kleinunternehmerregelung `
      + `gilt ${year} damit nicht; Umsatzsteuer ist auszuweisen. Bitte mit der Steuerberatung klären und unter Einstellungen umstellen.` });
  }
  if (jetzt > 10000000) {
    out.push({ level: 'error', ids: [], text: `Umsatz ${year}: ${money(jetzt)} €, damit über 100.000 €. Ab dem Umsatz, mit dem die Grenze `
      + 'überschritten wurde, gilt die Regelbesteuerung (§ 19 Abs. 1 UStG). Bitte umgehend mit der Steuerberatung klären.' });
  } else if (jetzt > 2500000 && gruendungsjahr) {
    out.push({ level: 'error', ids: [], text: `Umsatz ${year}: ${money(jetzt)} €, damit über 25.000 €. Im Jahr, in dem die Tätigkeit beginnt, `
      + 'gilt diese Grenze schon im laufenden Jahr: Ab dem Umsatz, mit dem sie überschritten wurde, gilt die Regelbesteuerung (§ 19 UStG). '
      + 'Bitte umgehend mit der Steuerberatung klären.' });
  } else if (jetzt > 2500000 && vorjahr <= 2500000) {
    out.push({ level: 'warn', ids: [], text: `Umsatz ${year}: ${money(jetzt)} €, damit über 25.000 €. Im Jahr ${year + 1} gilt die `
      + 'Kleinunternehmerregelung damit nicht mehr.'
      + (!seit && !vorjahr ? ' Hat Ihre Tätigkeit erst in diesem Jahr begonnen, gilt die Regelbesteuerung schon ab dem Umsatz, mit dem die 25.000 € '
        + 'überschritten wurden. Den Beginn tragen Sie in den Einstellungen ein.' : '') });
  }
  return out;
}

/**
 * Doppelt vergebene Nummern ausgestellter Rechnungen (§ 14 Abs. 4 Nr. 4 UStG
 * verlangt eine einmalige Nummer). Entsteht vor allem, wenn auf zwei Geräten
 * ohne Verbindung Rechnungen geschrieben werden; der Abgleich behält beide.
 * @returns {Array<{nummer:string, ids:string[]}>} ids: Buchungen der Rechnungen
 */
export function doppelteRechnungsnummern(db) {
  const je = new Map();
  const merken = (nr, ids) => {
    const n = String(nr || '').trim();
    if (!n) return;
    if (!je.has(n)) je.set(n, []);
    je.get(n).push(ids);
  };
  for (const r of db.invoices || []) {
    if (r.richtung === 'eingang' || r.status !== 'ausgestellt') continue;
    merken(r.nummer, r.transactionIds || []);
  }
  // Einnahmen mit eigener Rechnungsnummer, die nicht aus dem Bereich Rechnungen stammen.
  for (const t of db.transactions || []) {
    if (t.type !== 'income' || t.invoiceId || isVoidPart(t) || t.mahnRechnungId) continue;
    merken(t.invoiceNumber, [t.id]);
  }
  return [...je].filter(([, l]) => l.length > 1).map(([nummer, l]) => ({ nummer, ids: l.flat() }));
}

/**
 * Ende des letzten Voranmeldungszeitraums, dessen Abgabefrist vorbei ist
 * (10. des Folgemonats, mit Dauerfristverlängerung einen Monat später), oder ''.
 */
export function letzterErklaerterZeitraum(db, heute = todayISO()) {
  for (let i = 1; i <= 15; i++) {
    const ende = monthEnd(addMonths(monthStart(heute), -i));
    const st = steuerStand(db, ende);
    if (st.taxMode === 'kleinunternehmer') return '';
    const monat = Number(ende.slice(5, 7));
    const art = st.vatPeriod || 'vierteljährlich';
    if (art === 'vierteljährlich' && monat % 3 !== 0) continue;
    if (art === 'jährlich' && monat !== 12) continue;
    let frist = addDays(ende, 10);
    if (st.vatDeadline === 'dauerfrist') frist = addMonths(frist, 1);
    if (frist < heute) return ende;
  }
  return '';
}

export { groupBy };
