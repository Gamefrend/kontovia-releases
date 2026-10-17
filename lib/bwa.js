/**
 * Kontovia – Betriebswirtschaftliche Auswertung (BWA), Summen- und Saldenliste, Umsatzsteuer-Jahresübersicht.
 *
 * BWA: in der Gliederung der kurzfristigen Erfolgsrechnung (Umsatz, Material, Rohertrag, Kostenarten,
 * Betriebsergebnis), abgeleitet aus den Zeilen der Anlage EÜR (calc.js: euerReport). So passt sie immer zur EÜR,
 * nur ohne die Umsatzsteuer-Zeilen (17, 18, 57, 58) und mit den vollen Kosten (die Kürzung etwa der Bewirtung ist
 * eine Steuerfrage). Zahlen nach Zahlungstag, wie die EÜR.
 *
 * Summen- und Saldenliste: je Sachkonto des gewählten Kontenrahmens (SKR03/SKR04 an Kategorien und Konten) Soll,
 * Haben und Saldo im Zeitraum, nach Zahlungstag gebucht wie der DATEV-Export bei Ist-Versteuerung (Bank an Erlös und
 * Umsatzsteuer, Aufwand und Vorsteuer an Bank), dazu die Abschreibung. Eine vereinfachte Liste aus Kontovias
 * Buchungen, kein Ersatz für die Buchführung der Kanzlei.
 *
 * Umsatzsteuer-Jahresübersicht: die Werte des Jahres in den Kennzahlen der Voranmeldung (gerundet wie ELSTER), die
 * Summe der Voranmeldungen (eingelesene Meldungen haben Vorrang vor der eigenen Rechnung) und was danach bleibt.
 *
 * Rein rechnend, ohne Oberfläche (Prüfung `rechenkern`).
 */

import { euerReport, vatReturn, vatPeriods, ohneUst, isEffective, depreciationInRange } from './calc.js';
import { elsterWerte, KENNZAHLEN } from './elster.js';
import { todayISO } from './util.js';

/* -------------------------------------------------------------------------- */
/* BWA                                                                         */
/* -------------------------------------------------------------------------- */

/** Zeilen der Anlage EÜR (Vordruck 2025, wie gespeichert) je Posten der BWA. */
const UST_ZEILEN = new Set([17, 18, 57, 58]);
const UMSATZ = new Set([12, 13, 15, 16]);
const MATERIAL = new Set([27, 29]);
const ZINSEN = new Set([55, 56]);
export const BWA_KOSTEN = [
  ['personal', 'Personalkosten', [30]],
  ['raum', 'Raumkosten', [39, 40, 41, 65, 66]],
  ['versicherung', 'Versicherungen, Beiträge und Abgaben', [49]],
  ['kfz', 'Fahrzeugkosten', [68, 69, 70, 71]],
  ['werbung', 'Werbe- und Reisekosten', [44, 54, 62, 63, 64]],
  ['abschreibung', 'Abschreibungen', [31, 32, 33, 36, 37, 38]],
  ['instandhaltung', 'Reparatur und Instandhaltung', [48]],
  ['sonstige', 'Sonstige Kosten', []],
];

/**
 * BWA für einen Zeitraum.
 * @returns {{from:string, to:string, zeilen:Array<{key:string, label:string, art:'posten'|'summe'|'ergebnis', betrag:number, anteil:number|null}>,
 *   umsatz:number, gesamtkosten:number, betriebsergebnis:number, ergebnis:number, gekuerzt:number, ohneKategorie:string[]}}
 */
export function bwa(db, from, to) {
  const e = euerReport(db, from, to);
  const z = { umsatz: 0, erloese: 0, material: 0, zinsen: 0 };
  const kosten = Object.fromEntries(BWA_KOSTEN.map(([k]) => [k, 0]));
  for (const r of e.income) {
    if (UST_ZEILEN.has(r.canon)) continue;
    if (UMSATZ.has(r.canon)) z.umsatz += r.amount; else z.erloese += r.amount;
  }
  let gekuerzt = 0;
  for (const r of e.expense) {
    if (UST_ZEILEN.has(r.canon)) continue;
    // Volle Kosten: Die EÜR kürzt etwa die Bewirtung auf 70 %, die BWA zeigt, was ausgegeben wurde.
    const betrag = r.amount + (r.nonDeductible || 0);
    gekuerzt += r.nonDeductible || 0;
    if (MATERIAL.has(r.canon)) z.material += betrag;
    else if (ZINSEN.has(r.canon)) z.zinsen += betrag;
    else kosten[(BWA_KOSTEN.find(([, , zeilen]) => zeilen.includes(r.canon)) || ['sonstige'])[0]] += betrag;
  }
  const rohertrag = z.umsatz - z.material;
  const betrieblich = rohertrag + z.erloese;
  const gesamtkosten = Object.values(kosten).reduce((s, v) => s + v, 0);
  const betriebsergebnis = betrieblich - gesamtkosten;
  const ergebnis = betriebsergebnis - z.zinsen;
  const anteil = (v) => (z.umsatz ? v / z.umsatz : null);
  const zeile = (key, label, betrag, art = 'posten') => ({ key, label, art, betrag, anteil: anteil(betrag) });
  const zeilen = [
    zeile('umsatz', 'Umsatzerlöse', z.umsatz),
    zeile('material', 'Material, Waren und Fremdleistungen', z.material),
    zeile('rohertrag', 'Rohertrag', rohertrag, 'summe'),
    zeile('erloese', 'Sonstige betriebliche Erlöse', z.erloese),
    zeile('betrieblich', 'Betrieblicher Rohertrag', betrieblich, 'summe'),
    ...BWA_KOSTEN.map(([k, label]) => zeile(k, label, kosten[k])),
    zeile('gesamtkosten', 'Gesamtkosten', gesamtkosten, 'summe'),
    zeile('betriebsergebnis', 'Betriebsergebnis', betriebsergebnis, 'ergebnis'),
    zeile('zinsen', 'Zinsen', z.zinsen),
    zeile('ergebnis', 'Ergebnis vor Steuern', ergebnis, 'ergebnis'),
  ];
  return { from, to, zeilen, umsatz: z.umsatz, gesamtkosten, betriebsergebnis, ergebnis, gekuerzt, ohneKategorie: e.ohneKategorie };
}

/* -------------------------------------------------------------------------- */
/* Summen- und Saldenliste                                                     */
/* -------------------------------------------------------------------------- */

/** Feste Konten je Kontenrahmen. */
const FEST = {
  skr03: {
    erloese: ['8400', 'Erlöse'], aufwand: ['4900', 'Sonstige betriebliche Aufwendungen'], geld: ['1200', 'Bank'],
    ust19: ['1776', 'Umsatzsteuer 19 %'], ust7: ['1771', 'Umsatzsteuer 7 %'], ust: ['1770', 'Umsatzsteuer'],
    vst19: ['1576', 'Abziehbare Vorsteuer 19 %'], vst7: ['1571', 'Abziehbare Vorsteuer 7 %'], vst: ['1570', 'Abziehbare Vorsteuer'],
    anlagen: ['0490', 'Sonstige Betriebs- und Geschäftsausstattung'], afa: ['4830', 'Abschreibungen auf Sachanlagen'],
  },
  skr04: {
    erloese: ['4400', 'Erlöse'], aufwand: ['6300', 'Sonstige betriebliche Aufwendungen'], geld: ['1800', 'Bank'],
    ust19: ['3806', 'Umsatzsteuer 19 %'], ust7: ['3801', 'Umsatzsteuer 7 %'], ust: ['3800', 'Umsatzsteuer'],
    vst19: ['1406', 'Abziehbare Vorsteuer 19 %'], vst7: ['1401', 'Abziehbare Vorsteuer 7 %'], vst: ['1400', 'Abziehbare Vorsteuer'],
    anlagen: ['0690', 'Sonstige Betriebs- und Geschäftsausstattung'], afa: ['6220', 'Abschreibungen auf Sachanlagen'],
  },
};

/**
 * Summen- und Saldenliste eines Zeitraums.
 * @returns {{rahmen:'SKR03'|'SKR04', konten:Array<{nr:string, name:string, soll:number, haben:number, saldo:number}>, soll:number, haben:number}}
 */
export function summenSalden(db, from, to) {
  const skr = db.settings?.chartOfAccounts === 'SKR04' ? 'skr04' : 'skr03';
  const F = FEST[skr];
  const konten = new Map();
  const buche = ([nr, name], betrag) => {
    if (!betrag) return;
    const k = konten.get(nr) || { nr, name, soll: 0, haben: 0 };
    if (betrag > 0) k.soll += betrag; else k.haben -= betrag;
    konten.set(nr, k);
  };
  const steuerKonto = (art, satz) => F[`${art}${Number(satz) === 19 ? '19' : Number(satz) === 7 ? '7' : ''}`];
  const afaKat = (db.categories || []).find((c) => c.depreciation && c[skr]);
  const afa = afaKat ? [afaKat[skr], afaKat.name] : F.afa;

  for (const t of db.transactions || []) {
    if (!isEffective(t) || !t.gross || !t.paidDate || t.paidDate < from || t.paidDate > to) continue;
    const cat = (db.categories || []).find((c) => c.id === t.categoryId);
    const acc = (db.accounts || []).find((a) => a.id === t.accountId);
    const einnahme = t.type === 'income';
    const geld = acc?.[skr] ? [acc[skr], acc.name] : F.geld;
    let sach = cat?.[skr] ? [cat[skr], cat.name] : (einnahme ? F.erloese : F.aufwand);
    if (!einnahme && t.assetId) sach = F.anlagen;
    const steuer = ohneUst(db, t.paidDate) || cat?.vatNeutral || cat?.private ? 0 : (Number(t.vat) || 0);
    if (einnahme) {
      buche(geld, t.gross);
      buche(sach, -(t.gross - steuer));
      buche(steuerKonto('ust', t.vatRate), -steuer);
    } else {
      buche(sach, t.gross - steuer);
      buche(steuerKonto('vst', t.vatRate), steuer);
      buche(geld, -t.gross);
    }
  }
  for (const a of db.assets || []) {
    const x = depreciationInRange(a, from, to);
    if (!x) continue;
    buche(afa, x);
    buche(F.anlagen, -x);
  }
  const liste = [...konten.values()]
    .map((k) => ({ ...k, saldo: k.soll - k.haben }))
    .sort((a, b) => a.nr.localeCompare(b.nr, 'de', { numeric: true }));
  return {
    rahmen: skr === 'skr04' ? 'SKR04' : 'SKR03',
    konten: liste,
    soll: liste.reduce((s, k) => s + k.soll, 0),
    haben: liste.reduce((s, k) => s + k.haben, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Umsatzsteuer-Jahresübersicht                                                */
/* -------------------------------------------------------------------------- */

/**
 * Das Jahr in den Kennzahlen der Voranmeldung, die Voranmeldungen und der Rest.
 * Je Zeitraum gilt eine eingelesene ELSTER-Meldung (`elsterMeldungen`, die zuletzt eingelesene), sonst Kontovias
 * Rechnung. Die Sondervorauszahlung zählt zu den Vorauszahlungen (in der Dezember-Meldung abgezogen, vorher gezahlt).
 * @returns {{jahr:number, ohneUst:boolean, kennzahlen:Array<{kz:string, nr:string, label:string, wert:number, basis:boolean}>,
 *   jahressteuer:number, perioden:Array<{label:string, from:string, to:string, angemeldet:number, quelle:'meldung'|'berechnet', laeuft:boolean}>,
 *   vorauszahlungen:number, rest:number, ohneKategorie:string[]}}
 */
export function ustJahr(db, jahr, { heute = todayISO() } = {}) {
  const y = Number(jahr);
  const v = vatReturn(db, `${y}-01-01`, `${y}-12-31`);
  if (v.kleinunternehmer) {
    return { jahr: y, ohneUst: true, kennzahlen: [], jahressteuer: 0, perioden: [], vorauszahlungen: 0, rest: 0, ohneKategorie: v.ohneKategorie };
  }
  const w = elsterWerte(v);
  const kennzahlen = KENNZAHLEN
    .filter(([kz]) => kz !== 'kz39' && kz !== 'kz83')
    .map(([kz, nr, label, basis]) => ({ kz, nr, label, basis, wert: basis ? (w[kz] || 0) * 100 : (w[kz] || 0) }))
    .filter((k) => k.wert);
  const jahressteuer = w.kz83;
  const meldungen = (db.elsterMeldungen || []).filter((m) => m.art !== 'jahr');
  const perioden = vatPeriods(db, y).map((p) => {
    const m = meldungen.filter((x) => x.von === p.from && x.bis === p.to).sort((a, b) => String(a.eingelesen || '').localeCompare(String(b.eingelesen || ''))).at(-1);
    const angemeldet = m ? (Number(m.werte?.kz83) || 0) + (Number(m.werte?.kz39) || 0) : elsterWerte(p.result).kz83 + (p.result.kz39 || 0);
    return { label: p.label, from: p.from, to: p.to, angemeldet, quelle: m ? 'meldung' : 'berechnet', laeuft: p.to >= heute };
  });
  const vorauszahlungen = perioden.reduce((s, p) => s + p.angemeldet, 0);
  return { jahr: y, ohneUst: false, kennzahlen, jahressteuer, perioden, vorauszahlungen, rest: jahressteuer - vorauszahlungen, ohneKategorie: v.ohneKategorie };
}
