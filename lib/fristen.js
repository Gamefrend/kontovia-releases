/**
 * Kontovia – Steuertermine.
 *
 * Wann die Umsatzsteuer-Voranmeldung fällig ist und bis wann die
 * Jahreserklärungen abzugeben sind – berechnet aus den Einstellungen, ohne
 * Bezug zur Oberfläche (scripts/check.js prüft die Rechnung).
 *
 * Grundlagen:
 *  - Voranmeldung bis zum 10. Tag nach Ablauf des Voranmeldungszeitraums
 *    (§ 18 Abs. 1 UStG), mit Dauerfristverlängerung einen Monat später
 *    (§ 46 UStDV). Monatszahler zahlen dafür eine Sondervorauszahlung von
 *    einem Elftel der Vorjahressumme, fällig am 10. Februar (§ 47 UStDV).
 *  - Fällt das Fristende auf einen Samstag, Sonntag oder Feiertag, endet die
 *    Frist am nächsten Werktag (§ 108 Abs. 3 AO). Berücksichtigt sind die
 *    bundesweiten Feiertage; Landesfeiertage können die Frist zusätzlich
 *    verschieben.
 *  - Steuererklärungen (Einkommensteuer mit Anlage EÜR, Umsatzsteuer) bis zum
 *    31. Juli des Folgejahres (§ 149 Abs. 2 AO); mit Steuerberatung später
 *    (§ 149 Abs. 3 AO, Übergangsregel Art. 97 § 36 EGAO).
 */

import { addDays, addMonths, monthEnd, MONTHS } from './util.js';

const pad = (n) => String(n).padStart(2, '0');

/** Ostersonntag nach der Gaußschen Osterformel (gregorianisch). */
export function osterSonntag(jahr) {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${pad(monat)}-${pad(tag)}`;
}

/** Die bundesweiten gesetzlichen Feiertage eines Jahres. */
export function bundesFeiertage(jahr) {
  const ostern = osterSonntag(jahr);
  return new Set([
    `${jahr}-01-01`,
    addDays(ostern, -2), // Karfreitag
    addDays(ostern, 1), // Ostermontag
    `${jahr}-05-01`,
    addDays(ostern, 39), // Christi Himmelfahrt
    addDays(ostern, 50), // Pfingstmontag
    `${jahr}-10-03`,
    `${jahr}-12-25`,
    `${jahr}-12-26`,
  ]);
}

/** Verschiebt ein Fristende auf den nächsten Werktag (§ 108 Abs. 3 AO). */
export function naechsterWerktag(iso) {
  let d = iso;
  for (let i = 0; i < 10; i++) {
    const tag = new Date(`${d}T12:00:00`).getDay();
    if (tag !== 0 && tag !== 6 && !bundesFeiertage(Number(d.slice(0, 4))).has(d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** Name eines Voranmeldungszeitraums, etwa „September 2026“ oder „3. Quartal 2026“. */
function zeitraumName(from, to) {
  const y = from.slice(0, 4);
  if (from.slice(5, 7) === to.slice(5, 7)) return `${MONTHS[Number(from.slice(5, 7)) - 1]} ${y}`;
  if (from.endsWith('-01-01') && to.endsWith('-12-31')) return `Jahr ${y}`;
  return `${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1}. Quartal ${y}`;
}

/** Voranmeldungszeiträume, deren Frist zwischen `von` und `bis` liegt. */
function voranmeldungen(settings, von, bis) {
  if (settings?.taxMode === 'kleinunternehmer') return [];
  const art = settings?.vatPeriod || 'vierteljährlich';
  // Jährlich heißt: keine Voranmeldung, nur die Jahreserklärung.
  if (art === 'jährlich') return [];
  const schritt = art === 'monatlich' ? 1 : 3;
  const dauerfrist = settings?.vatDeadline === 'dauerfrist';
  const out = [];
  // Zeiträume ab gut einem Jahr vor `von`, damit auch späte Fristen erfasst sind.
  let beginn = `${Number(von.slice(0, 4)) - 1}-01-01`;
  for (let n = 0; n < 60; n++) {
    const ende = monthEnd(addMonths(beginn, schritt - 1));
    const frist = naechsterWerktag(addMonths(`${ende.slice(0, 8)}10`, dauerfrist ? 2 : 1));
    if (frist > bis) break;
    if (frist >= von) {
      out.push({
        datum: frist,
        art: 'ustva',
        titel: `Umsatzsteuer-Voranmeldung ${zeitraumName(beginn, ende)}`,
        zeitraum: { from: beginn, to: ende },
        hinweis: dauerfrist ? 'mit Dauerfristverlängerung (§ 46 UStDV)' : 'bis zum 10. nach Ablauf des Zeitraums (§ 18 UStG)',
      });
    }
    beginn = addMonths(beginn, schritt);
  }
  if (dauerfrist && art === 'monatlich') {
    for (let y = Number(von.slice(0, 4)); y <= Number(bis.slice(0, 4)); y++) {
      const frist = naechsterWerktag(`${y}-02-10`);
      if (frist >= von && frist <= bis) {
        out.push({
          datum: frist,
          art: 'sondervorauszahlung',
          titel: `Sondervorauszahlung ${y} und Antrag auf Dauerfristverlängerung`,
          hinweis: 'ein Elftel der Vorauszahlungen des Vorjahres (§ 47 UStDV)',
        });
      }
    }
  }
  return out;
}

/**
 * Verlängerte Fristen der Jahre 2020 bis 2024 (Art. 97 § 36 Abs. 3 EGAO, zuletzt
 * Viertes Corona-Steuerhilfegesetz): [ohne Beratung, mit Beratung]. Ab dem
 * Steuerjahr 2025 gelten wieder die regulären Fristen des § 149 AO.
 */
const UEBERGANG = {
  2020: ['2021-10-31', '2022-08-31'],
  2021: ['2022-10-31', '2023-08-31'],
  2022: ['2023-09-30', '2024-07-31'],
  2023: ['2024-08-31', '2025-05-31'],
  2024: ['2025-07-31', '2026-04-30'],
};

/**
 * Frist der Jahreserklärungen für ein Steuerjahr. Ohne Beratung der 31. Juli
 * des Folgejahres (§ 149 Abs. 2 AO), mit Beratung der letzte Tag des Februars
 * im übernächsten Jahr (§ 149 Abs. 3 AO); für 2020 bis 2024 die verlängerten
 * Fristen der Übergangsregel. Fällt das Ende auf ein Wochenende oder einen
 * Feiertag, rückt es auf den nächsten Werktag.
 */
export function erklaerungsfrist(steuerjahr, { beraten = false } = {}) {
  const y = Number(steuerjahr);
  const sonder = UEBERGANG[y];
  if (sonder) return naechsterWerktag(sonder[beraten ? 1 : 0]);
  if (!beraten) return naechsterWerktag(`${y + 1}-07-31`);
  return naechsterWerktag(monthEnd(`${y + 2}-02-01`));
}

function jahreserklaerungen(settings, von, bis) {
  const out = [];
  for (let y = Number(von.slice(0, 4)) - 2; y <= Number(bis.slice(0, 4)); y++) {
    const frist = erklaerungsfrist(y);
    if (frist < von || frist > bis) continue;
    const teile = ['Einkommensteuer mit Anlage EÜR'];
    if (settings?.taxMode !== 'kleinunternehmer') teile.push('Umsatzsteuer');
    out.push({
      datum: frist,
      art: 'jahreserklaerung',
      titel: `Steuererklärungen ${y}`,
      hinweis: `${teile.join(' und ')}, mit Steuerberatung bis ${erklaerungsfrist(y, { beraten: true }).split('-').reverse().join('.')}`,
      jahr: y,
    });
  }
  return out;
}

/**
 * Alle Steuertermine mit Frist zwischen `von` und `bis`, nach Datum sortiert.
 * @returns {Array<{datum:string, art:string, titel:string, hinweis:string, zeitraum?:{from:string,to:string}, jahr?:number}>}
 */
export function steuertermine(settings, von, bis) {
  return [...voranmeldungen(settings, von, bis), ...jahreserklaerungen(settings, von, bis)]
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.titel.localeCompare(b.titel, 'de'));
}
