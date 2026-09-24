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
 */

import { ym, monthStart, monthEnd, addMonths, monthsBetween, todayISO, daysBetween, sum, groupBy } from './util.js';

/* -------------------------------------------------------------------------- */
/* Grundlagen                                                                  */
/* -------------------------------------------------------------------------- */

export function basisOf(db) { return db?.settings?.accountingBasis === 'soll' ? 'soll' : 'ist'; }
export function isKleinunternehmer(db) { return db?.settings?.taxMode === 'kleinunternehmer'; }

/** Datum, unter dem eine Buchung in der Erfolgsrechnung erscheint. */
export function effectiveDate(tx, basis) {
  return basis === 'soll' ? tx.date : (tx.paidDate || '');
}

/** Zählt die Buchung im Zeitraum für die Gewinnermittlung? */
export function countsForProfit(tx, from, to, basis) {
  if (tx.voided) return false;
  const d = effectiveDate(tx, basis);
  return !!d && d >= from && d <= to;
}

/** Der für den Gewinn maßgebliche Betrag einer Buchung. */
export function profitAmount(tx, kleinunternehmer) {
  return kleinunternehmer ? tx.gross : tx.net;
}

function catOf(db, tx) {
  return db.categories.find((c) => c.id === tx.categoryId) || null;
}

/* -------------------------------------------------------------------------- */
/* Nicht gelistete Buchungen                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Eine Buchung lässt sich als „nicht gelistet“ kennzeichnen – für Vorgänge,
 * die nur der eigenen Übersicht dienen und steuerlich nicht zum Betrieb
 * gehören. Solche Buchungen fehlen in allen Unterlagen für Finanzamt und
 * Steuerkanzlei. In Übersicht und Auswertungen kommen sie nur hinzu, wenn
 * dort das Häkchen „Nicht gelistete einbeziehen“ gesetzt ist.
 *
 * Gefiltert wird einmal am Eingang: Alle Rechenfunktionen bekommen einen
 * Bestand, in dem die Buchungen schon passend ausgewählt sind. So kann keine
 * einzelne Auswertung das Filtern vergessen.
 */

export function isUnlisted(tx) { return !!tx?.unlisted; }

/** Der Bestand ohne nicht gelistete Buchungen – Grundlage jedes Exports. */
export function listedOnly(db) {
  if (!db || !(db.transactions || []).some(isUnlisted)) return db;
  return { ...db, transactions: db.transactions.filter((t) => !isUnlisted(t)) };
}

/** Der Bestand, wie ihn eine Auswertung je nach Häkchen sehen soll. */
export function scopeDb(db, includeUnlisted = false) {
  return includeUnlisted ? db : listedOnly(db);
}

/**
 * Nicht gelistete Buchungen eines Zeitraums, für den Hinweis neben dem
 * Häkchen. Maßgeblich ist dasselbe Datum wie in der Auswertung; offene
 * Rechnungen zählen mit ihrem Rechnungsdatum.
 */
export function unlistedStats(db, from, to) {
  const basis = basisOf(db);
  const out = { count: 0, income: 0, expense: 0 };
  for (const t of db?.transactions || []) {
    if (!isUnlisted(t) || t.voided) continue;
    const d = effectiveDate(t, basis) || t.date;
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

/**
 * Linearer Abschreibungsplan, monatsgenau ab dem Anschaffungsmonat
 * (§ 7 Abs. 1 Satz 4 EStG). Rundungsrest landet in der letzten Rate, damit die
 * Summe aller Raten exakt den Anschaffungskosten entspricht.
 */
export function depreciationPlan(asset) {
  const months = Math.max(1, Math.round((Number(asset.usefulLifeYears) || 1) * 12));
  const cost = Math.round(Number(asset.cost) || 0);
  const base = Math.floor(cost / months);
  const rest = cost - base * months;
  const start = monthStart(asset.purchaseDate || todayISO());
  const out = [];
  for (let i = 0; i < months; i++) {
    out.push({ ym: ym(addMonths(start, i)), amount: base + (i === months - 1 ? rest : 0) });
  }
  return out;
}

export function depreciationInRange(asset, from, to) {
  const a = ym(from), b = ym(to);
  return sum(depreciationPlan(asset).filter((e) => e.ym >= a && e.ym <= b), (e) => e.amount);
}

export function bookValue(asset, asOf) {
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
 */
export function periodReport(db, from, to, opts = {}) {
  const basis = opts.basis || basisOf(db);
  const klein = opts.kleinunternehmer ?? isKleinunternehmer(db);
  const txs = db.transactions.filter((t) => countsForProfit(t, from, to, basis));

  const r = {
    from, to, basis, kleinunternehmer: klein,
    incomeGross: 0, incomeNet: 0, incomeVat: 0,
    expenseGross: 0, expenseNet: 0, expenseVat: 0,
    expenseDeductible: 0,
    capitalisedGross: 0,
    privateIn: 0, privateOut: 0,
    vatRemitted: 0, vatRefunded: 0,
    countIncome: 0, countExpense: 0,
    byCategory: [],
    byContact: [],
    months: [],
    transactions: txs,
  };

  const catAgg = new Map();
  const contactAgg = new Map();

  for (const tx of txs) {
    const cat = catOf(db, tx);
    const amount = profitAmount(tx, klein);

    if (isPrivate(cat)) {
      if (tx.type === 'income') r.privateIn += tx.gross;
      else r.privateOut += tx.gross;
      continue;
    }

    // Zahlungen an das oder vom Finanzamt gleichen nur das Umsatzsteuerkonto
    // aus. In der Nettobetrachtung sind sie weder Ertrag noch Aufwand – sonst
    // würde die abgeführte Umsatzsteuer den Gewinn ein zweites Mal mindern.
    // In der Anlage EÜR erscheinen sie dagegen in eigenen Zeilen (55/56).
    if (cat?.vatNeutral) {
      if (tx.type === 'income') r.vatRefunded += tx.gross;
      else r.vatRemitted += tx.gross;
      continue;
    }

    if (tx.type === 'income') {
      r.incomeGross += tx.gross;
      r.incomeNet += tx.net;
      r.incomeVat += tx.vat;
      r.countIncome++;
    } else {
      r.expenseVat += tx.vat; // Vorsteuer fällt auch bei aktivierten Gütern an
      if (isCapitalised(tx)) {
        r.capitalisedGross += tx.gross;
        continue; // wirkt nur über die Abschreibung
      }
      r.expenseGross += tx.gross;
      r.expenseNet += tx.net;
      r.expenseDeductible += Math.round(amount * (cat?.deductibleRate ?? 1));
      r.countExpense++;
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

  // Kleinunternehmer: brutto = netto, Vorsteuer ist kein Abzugsposten.
  r.incomeForProfit = klein ? r.incomeGross : r.incomeNet;
  r.expenseForProfit = (klein ? r.expenseGross : r.expenseNet) + r.depreciation;
  r.expenseDeductible += r.depreciation;

  r.profit = r.incomeForProfit - r.expenseForProfit;
  r.taxableProfit = r.incomeForProfit - r.expenseDeductible;
  r.vatPayable = r.incomeVat - r.expenseVat;
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
  const basis = opts.basis || basisOf(db);
  const klein = opts.kleinunternehmer ?? isKleinunternehmer(db);
  const range = seriesRange(db, from, to, basis);
  const keys = monthsBetween(range.from, range.to);
  const idx = new Map(keys.map((k) => [k, { ym: k, income: 0, expense: 0, profit: 0, vat: 0 }]));

  for (const tx of db.transactions) {
    if (tx.voided) continue;
    const d = effectiveDate(tx, basis);
    if (!d || d < from || d > to) continue;
    const cat = catOf(db, tx);
    if (isPrivate(cat) || cat?.vatNeutral) continue;
    const bucket = idx.get(ym(d));
    if (!bucket) continue;
    const amount = profitAmount(tx, klein);
    if (tx.type === 'income') { bucket.income += amount; bucket.vat += tx.vat; }
    else if (!isCapitalised(tx)) { bucket.expense += amount; bucket.vat -= tx.vat; }
    else bucket.vat -= tx.vat;
  }

  // Abschreibungen monatsweise ergänzen
  for (const asset of db.assets || []) {
    for (const e of depreciationPlan(asset)) {
      const bucket = idx.get(e.ym);
      if (bucket) bucket.expense += e.amount;
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
export function seriesRange(db, from, to, basis = basisOf(db)) {
  if (monthsBetween(from, to).length <= 36) return { from, to };
  let first = '';
  let last = '';
  const take = (d) => {
    if (!d || d < from || d > to) return;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  };
  for (const t of db.transactions || []) if (!t.voided) take(effectiveDate(t, basis));
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
      if (tx.voided || tx.accountId !== acc.id) continue;
      const d = tx.paidDate;
      if (!d || d > asOf) continue;
      if (d < (acc.openingDate || '0000-01-01')) continue;
      if (tx.type === 'income') { balance += tx.gross; inflow += tx.gross; }
      else { balance -= tx.gross; outflow += tx.gross; }
    }
    return { ...acc, balance, inflow, outflow };
  });
}

export function cashFlow(db, from, to) {
  let inflow = 0, outflow = 0;
  for (const tx of db.transactions) {
    if (tx.voided) continue;
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
    if (tx.voided || tx.paidDate) continue;
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
  const assets = (db.assets || []).map((a) => ({ ...a, bookValue: bookValue(a, asOf) }));
  const fixedAssets = sum(assets, (a) => a.bookValue);

  const yearStart = `${String(asOf).slice(0, 4)}-01-01`;
  const ytd = periodReport(db, yearStart, asOf, opts);
  const vatOpen = ytd.vatOutstanding;

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

/** Leitet die umsatzsteuerliche Behandlung einer Buchung ab. */
export function vatTreatment(db, tx) {
  if (tx.vatTreatment) return tx.vatTreatment;
  const cat = catOf(db, tx);
  if (cat?.intraEu) return tx.type === 'income' ? 'ig-lieferung' : 'ig-erwerb';
  if (cat?.reverseCharge || tx.reverseCharge) return tx.type === 'income' ? 'reverse-charge-out' : 'reverse-charge-in';
  if ((tx.vatRate || 0) === 0) return 'steuerfrei';
  return 'standard';
}

/**
 * Kennzahlen der Umsatzsteuer-Voranmeldung.
 * Die Nummern entsprechen den amtlichen Kennzahlen des Formulars.
 */
export function vatReturn(db, from, to) {
  const basis = basisOf(db);
  const k = {
    kz81net: 0, kz81tax: 0,   // 19 %
    kz86net: 0, kz86tax: 0,   // 7 %
    kz35net: 0, kz36tax: 0,   // andere Steuersätze
    kz41: 0,                  // innergemeinschaftliche Lieferungen
    kz21: 0,                  // nicht steuerbare sonstige Leistungen (§ 18b)
    kz48: 0,                  // steuerfreie Umsätze ohne Vorsteuerabzug
    kz89net: 0, kz89tax: 0,   // innergemeinschaftliche Erwerbe 19 %
    kz46net: 0, kz47tax: 0,   // Leistungen nach § 13b (Empfänger)
    kz66: 0,                  // Vorsteuer aus Rechnungen
    kz61: 0,                  // Vorsteuer aus i.g. Erwerben
    kz67: 0,                  // Vorsteuer aus § 13b
    kz83: 0,                  // verbleibende Vorauszahlung
  };
  if (isKleinunternehmer(db)) return { ...k, kleinunternehmer: true, from, to };

  for (const tx of db.transactions) {
    if (tx.voided) continue;
    const d = effectiveDate(tx, basis);
    if (!d || d < from || d > to) continue;
    const cat = catOf(db, tx);
    if (cat?.private || cat?.vatNeutral) continue;
    const t = vatTreatment(db, tx);
    const rate = Number(tx.vatRate) || 0;

    if (tx.type === 'income') {
      if (t === 'ig-lieferung') k.kz41 += tx.net;
      else if (t === 'reverse-charge-out') k.kz21 += tx.net;
      else if (t === 'steuerfrei') k.kz48 += tx.net;
      else if (rate === 19) { k.kz81net += tx.net; k.kz81tax += tx.vat; }
      else if (rate === 7) { k.kz86net += tx.net; k.kz86tax += tx.vat; }
      else if (rate > 0) { k.kz35net += tx.net; k.kz36tax += tx.vat; }
    } else {
      if (t === 'ig-erwerb') {
        k.kz89net += tx.net;
        const tax = Math.round((tx.net * (rate || 19)) / 100);
        k.kz89tax += tax;
        k.kz61 += tax; // gleichzeitig als Vorsteuer abziehbar
      } else if (t === 'reverse-charge-in') {
        k.kz46net += tx.net;
        const tax = Math.round((tx.net * (rate || 19)) / 100);
        k.kz47tax += tax;
        k.kz67 += tax;
      } else {
        k.kz66 += tx.vat;
      }
    }
  }

  k.umsatzsteuer = k.kz81tax + k.kz86tax + k.kz36tax + k.kz89tax + k.kz47tax;
  k.vorsteuer = k.kz66 + k.kz61 + k.kz67;
  k.kz83 = k.umsatzsteuer - k.vorsteuer;
  return { ...k, from, to, kleinunternehmer: false };
}

/** Alle Voranmeldungszeiträume eines Jahres. */
export function vatPeriods(db, year) {
  const mode = db.settings.vatPeriod || 'vierteljährlich';
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
 * Ordnet den Zeitraum den Zeilen der Anlage EÜR zu.
 * Rückgabe: { income:[{line,label,amount}], expense:[...], totals }
 */
export function euerReport(db, from, to) {
  const klein = isKleinunternehmer(db);
  const basis = basisOf(db);
  const lines = db.euerLines || {};
  const income = new Map();
  const expense = new Map();

  const add = (map, line, amount) => {
    if (line === null || line === undefined) return;
    if (!map.has(line)) map.set(line, 0);
    map.set(line, map.get(line) + amount);
  };

  let vatCollected = 0;
  let vatPaid = 0;

  for (const tx of db.transactions) {
    if (tx.voided) continue;
    const d = effectiveDate(tx, basis);
    if (!d || d < from || d > to) continue;
    const cat = catOf(db, tx);
    if (!cat || cat.private) continue;

    if (cat.vatNeutral) {
      // Zahlungen an das bzw. vom Finanzamt stehen in eigenen Zeilen.
      add(tx.type === 'income' ? income : expense, cat.euerLine, tx.gross);
      continue;
    }

    if (tx.type === 'income') {
      vatCollected += tx.vat;
      add(income, cat.euerLine ?? (klein ? 11 : 14), klein ? tx.gross : tx.net);
    } else {
      vatPaid += tx.vat;
      if (tx.assetId) continue; // wirkt über die AfA
      const amount = Math.round((klein ? tx.gross : tx.net) * (cat.deductibleRate ?? 1));
      add(expense, cat.euerLine ?? 57, amount);
    }
  }

  const afa = totalDepreciation(db, from, to);
  if (afa) add(expense, 31, afa);

  if (!klein) {
    if (vatCollected) add(income, 16, vatCollected);
    if (vatPaid) add(expense, 55, vatPaid);
  }

  const toRows = (map) => [...map.entries()]
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([line, amount]) => ({ line: Number(line), label: lines[line] || `Zeile ${line}`, amount }));

  const incomeRows = toRows(income);
  const expenseRows = toRows(expense);
  const incomeTotal = sum(incomeRows, (r) => r.amount);
  const expenseTotal = sum(expenseRows, (r) => r.amount);
  const profit = incomeTotal - expenseTotal;

  // Überleitung: In der EÜR läuft die Umsatzsteuer als Betriebseinnahme bzw.
  // -ausgabe mit (Zeilen 16, 17, 55, 56). Der EÜR-Gewinn weicht deshalb vom
  // Nettoergebnis der GuV ab, solange die Zahllast noch nicht überwiesen ist.
  const at = (rows, line) => rows.find((r) => r.line === line)?.amount || 0;
  const vatFlow = at(incomeRows, 16) + at(incomeRows, 17) - at(expenseRows, 55) - at(expenseRows, 56);

  return {
    from, to, kleinunternehmer: klein, basis,
    income: incomeRows,
    expense: expenseRows,
    incomeTotal,
    expenseTotal,
    profit,
    reconciliation: {
      netResult: profit - vatFlow,
      vatCollected: at(incomeRows, 16),
      vatRefunded: at(incomeRows, 17),
      vatDeducted: at(expenseRows, 55),
      vatRemitted: at(expenseRows, 56),
      vatFlow,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Kennzahlen für die Übersicht                                                */
/* -------------------------------------------------------------------------- */

export function compareRanges(db, from, to) {
  const days = daysBetween(from, to);
  const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(prevTo).getTime() - days * 86400000).toISOString().slice(0, 10);
  return { current: periodReport(db, from, to), previous: periodReport(db, prevFrom, prevTo), prevFrom, prevTo };
}

export function trend(current, previous) {
  if (!previous) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

/** Größte Ausgabenblöcke, für die "Wo geht das Geld hin"-Ansicht. */
export function topCategories(report, kind, limit = 8) {
  return report.byCategory.filter((c) => c.kind === kind).slice(0, limit);
}

/** Belegdichte: Anteil der Buchungen mit hinterlegtem Beleg. */
export function receiptCoverage(db, from, to) {
  const basis = basisOf(db);
  const txs = db.transactions.filter((t) => countsForProfit(t, from, to, basis) && !t.isReversal);
  const withDoc = txs.filter((t) => (t.attachments || []).length > 0);
  return { total: txs.length, withDoc: withDoc.length, ratio: txs.length ? withDoc.length / txs.length : 1, missing: txs.filter((t) => !(t.attachments || []).length) };
}

/** Einfache Plausibilitätsprüfungen vor dem Jahresabschluss. */
export function healthChecks(db, from, to) {
  const issues = [];
  const basis = basisOf(db);
  const txs = db.transactions.filter((t) => !t.voided);

  const noCategory = txs.filter((t) => !t.categoryId && countsForProfit(t, from, to, basis));
  if (noCategory.length) issues.push({ level: 'warn', text: `${noCategory.length} Buchungen ohne Kategorie`, ids: noCategory.map((t) => t.id) });

  const noAccount = txs.filter((t) => t.paidDate && !t.accountId);
  if (noAccount.length) issues.push({ level: 'warn', text: `${noAccount.length} bezahlte Buchungen ohne Konto – die Kontostände stimmen dadurch nicht`, ids: noAccount.map((t) => t.id) });

  const cov = receiptCoverage(db, from, to);
  if (cov.missing.length) issues.push({ level: 'info', text: `${cov.missing.length} Buchungen ohne Beleg`, ids: cov.missing.map((t) => t.id) });

  const mismatch = txs.filter((t) => Math.abs((t.net + t.vat) - t.gross) > 1);
  if (mismatch.length) issues.push({ level: 'error', text: `${mismatch.length} Buchungen, bei denen Netto + Steuer nicht dem Bruttobetrag entspricht`, ids: mismatch.map((t) => t.id) });

  const future = txs.filter((t) => t.paidDate && t.paidDate > todayISO());
  if (future.length) issues.push({ level: 'info', text: `${future.length} Zahlungen mit Datum in der Zukunft`, ids: future.map((t) => t.id) });

  const dupes = [];
  const seen = new Map();
  for (const t of txs) {
    const key = `${t.date}|${t.gross}|${(t.description || '').toLowerCase().trim()}`;
    if (seen.has(key)) dupes.push(t.id); else seen.set(key, t.id);
  }
  if (dupes.length) issues.push({ level: 'warn', text: `${dupes.length} mögliche Doppelerfassungen (gleiches Datum, gleicher Betrag, gleicher Text)`, ids: dupes });

  const gwg = (db.assets || []).filter((a) => (a.cost || 0) <= 80000);
  if (gwg.length) issues.push({ level: 'info', text: `${gwg.length} Anlagegüter unter 800 € – diese sind als geringwertige Wirtschaftsgüter meist sofort abziehbar`, ids: [] });

  return issues;
}

export { groupBy };
