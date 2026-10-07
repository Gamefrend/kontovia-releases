/**
 * Kontovia – Assistent: Sprache ohne Modell.
 *
 * Drei Dinge, die jede Stufe des Assistenten braucht und die feste Regeln
 * besser können als ein Sprachmodell:
 *
 *  • Zeiträume aus Alltagssprache („letzte Woche“, „März“, „Q2 2025“,
 *    „die letzten 30 Tage“) in genaue Daten übersetzen. Die Werkzeuge nehmen
 *    deshalb einen Zeitraum als Text; ein Modell muss das Datum nicht rechnen.
 *  • Beträge, Uhrzeiten und Wochentage lesen.
 *  • Die Stufe „Basis“: eine Frage ohne Modell einem Werkzeug zuordnen
 *    (deuten). Größere Stufen fallen darauf zurück, wenn ein Modell keine
 *    brauchbare Antwort liefert.
 *
 * Alles hier ist reine Logik ohne Bezug zur Oberfläche und läuft so auch in
 * den Prüfungen (Thema assistent).
 */

import { norm, addDays, addMonths, monthStart, monthEnd, quarterRange, fmtDate, MONTHS, parseMoney, fromISO } from './util.js';

/* -------------------------------------------------------------------------- */
/* Zeiträume                                                                   */
/* -------------------------------------------------------------------------- */

const MONATE = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONATE_KURZ = ['jan', 'feb', 'mrz|maer', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep|sept', 'okt', 'nov', 'dez'];
const ZAHLWORTE = { ein: 1, eins: 1, einen: 1, einem: 1, einer: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, vierzehn: 14, zwanzig: 20, dreissig: 30, sechzig: 60, neunzig: 90 };
const WOCHENTAGE = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];

const zahl = (w) => (/^\d+$/.test(w) ? Number(w) : ZAHLWORTE[w] || 0);
const jahrVon = (iso) => Number(String(iso).slice(0, 4));
const zweistellig = (n) => String(n).padStart(2, '0');

/** Montag der Woche, in der `iso` liegt. */
function wochenAnfang(iso) {
  const tag = (fromISO(iso).getDay() + 6) % 7;
  return addDays(iso, -tag);
}

/** Ein Datum wie „5.10.“, „05.10.2026“, „5.10.26“ oder „2026-10-05“; ohne Jahr gilt das von heute. */
function datumLesen(s, heute) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/.exec(s);
  if (!m) return '';
  let j = m[3] ? Number(m[3]) : jahrVon(heute);
  if (j < 100) j += 2000;
  const t = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || t < 1 || t > 31) return '';
  return `${j}-${zweistellig(mo)}-${zweistellig(t)}`;
}

/** Lesbare Bezeichnung eines Zeitraums. */
export function zeitraumText(von, bis) {
  if (!von || !bis) return '';
  if (von === '1900-01-01' && bis === '2999-12-31') return 'gesamter Bestand';
  if (von === bis) return fmtDate(von);
  if (von === monthStart(von) && bis === monthEnd(von)) return `${MONTHS[Number(von.slice(5, 7)) - 1]} ${von.slice(0, 4)}`;
  if (von.slice(5) === '01-01' && bis.slice(5) === '12-31' && von.slice(0, 4) === bis.slice(0, 4)) return `Jahr ${von.slice(0, 4)}`;
  for (let q = 1; q <= 4; q++) {
    const r = quarterRange(jahrVon(von), q);
    if (r.from === von && r.to === bis) return `${q}. Quartal ${von.slice(0, 4)}`;
  }
  return `${fmtDate(von)} bis ${fmtDate(bis)}`;
}

const ergebnis = (von, bis, treffer) => (von && bis ? { von: von <= bis ? von : bis, bis: von <= bis ? bis : von, text: zeitraumText(von <= bis ? von : bis, von <= bis ? bis : von), treffer } : null);

/**
 * Liest einen Zeitraum aus Text. Gibt null zurück, wenn keiner darin steht.
 * @param {string} eingabe  z. B. „letzte Woche“, „im März 2025“, „2026-01-01 bis 2026-03-31“
 * @param {string} heute    ISO-Datum
 * @returns {{von:string, bis:string, text:string, treffer:string}|null}  `treffer` ist die gefundene Stelle (normalisiert)
 */
export function zeitraumLesen(eingabe, heute) {
  const t = ` ${norm(eingabe).replace(/[?!,;]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (!t.trim()) return null;
  const y = jahrVon(heute);
  const mo = Number(heute.slice(5, 7));
  const q = Math.floor((mo - 1) / 3) + 1;
  let m;

  // Von … bis …, mit Datumsangaben.
  const D = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)`;
  m = new RegExp(String.raw` (?:vom |von |ab |zwischen )?${D} ?(?:bis|und|-|–) ?(?:zum )?${D} `).exec(t);
  if (m) {
    const b = datumLesen(m[2], heute);
    let a = datumLesen(m[1], heute);
    // „1.3. bis 15.3.2025“: das Jahr des Endes gilt auch für den Anfang.
    if (a && b && !/\.\d{2,4}$/.test(m[1]) && /^\d/.test(m[1])) a = `${b.slice(0, 4)}${a.slice(4)}`;
    return ergebnis(a, b, m[0].trim());
  }

  if ((m = / (gesamt|insgesamt|alles|alle zeit|gesamten bestand|seit beginn|bisher insgesamt) /.exec(t))) return ergebnis('1900-01-01', '2999-12-31', m[1]);
  if ((m = / (vorgestern) /.exec(t))) { const d = addDays(heute, -2); return ergebnis(d, d, m[1]); }
  if ((m = / (gestern) /.exec(t))) { const d = addDays(heute, -1); return ergebnis(d, d, m[1]); }
  if ((m = / (uebermorgen) /.exec(t))) { const d = addDays(heute, 2); return ergebnis(d, d, m[1]); }
  if ((m = / (morgen) /.exec(t)) && !/ morgens? (um|frueh)/.test(t)) { const d = addDays(heute, 1); return ergebnis(d, d, m[1]); }
  if ((m = / (heute) /.exec(t))) return ergebnis(heute, heute, m[1]);

  // Die letzten / nächsten N Tage, Wochen, Monate.
  m = / ((?:in den |die |der |seit den )?(letzten|vergangenen|naechsten|kommenden) (\d+|[a-z]+) (tage?n?|wochen?|monate?n?|jahren?|jahre))/.exec(t);
  if (m && zahl(m[3])) {
    const n = zahl(m[3]);
    const vor = /naechst|kommend/.test(m[2]);
    const einheit = m[4].startsWith('tag') ? 'tag' : m[4].startsWith('woch') ? 'woche' : m[4].startsWith('mon') ? 'monat' : 'jahr';
    const schritt = (d, k) => (einheit === 'tag' ? addDays(d, k) : einheit === 'woche' ? addDays(d, 7 * k) : addMonths(d, einheit === 'monat' ? k : 12 * k));
    return vor ? ergebnis(heute, schritt(heute, n), m[1]) : ergebnis(addDays(schritt(heute, -n), 1), heute, m[1]);
  }
  m = / (seit (\d+|[a-z]+) (tage?n?|wochen?|monate?n?))/.exec(t);
  if (m && zahl(m[2])) {
    const n = zahl(m[2]);
    const von = m[3].startsWith('tag') ? addDays(heute, -n) : m[3].startsWith('woch') ? addDays(heute, -7 * n) : addMonths(heute, -n);
    return ergebnis(von, heute, m[1]);
  }

  // Woche.
  if ((m = / ((diese|dieser|diesen|aktuelle|aktuellen|laufende|laufenden) woche)/.exec(t))) { const a = wochenAnfang(heute); return ergebnis(a, addDays(a, 6), m[1]); }
  if ((m = / ((letzte|letzten|letzter|vergangene|vergangenen|vorige|vorigen|vorherige) woche|vorwoche)/.exec(t))) { const a = addDays(wochenAnfang(heute), -7); return ergebnis(a, addDays(a, 6), m[1]); }
  if ((m = / ((naechste|naechsten|kommende|kommenden) woche)/.exec(t))) { const a = addDays(wochenAnfang(heute), 7); return ergebnis(a, addDays(a, 6), m[1]); }

  // Monat.
  if ((m = / ((dieser|diesen|diesem|aktuelle|aktuellen|laufende|laufenden) monat)/.exec(t))) return ergebnis(monthStart(heute), monthEnd(heute), m[1]);
  if ((m = / ((letzte|letzten|letzter|vergangene|vergangenen|vorige|vorigen) monat|vormonat)/.exec(t))) { const a = addMonths(monthStart(heute), -1); return ergebnis(a, monthEnd(a), m[1]); }
  if ((m = / ((naechste|naechsten|kommende|kommenden) monat)/.exec(t))) { const a = addMonths(monthStart(heute), 1); return ergebnis(a, monthEnd(a), m[1]); }

  // Quartal.
  const quartal = (jj, qq, tr) => { const r = quarterRange(jj, qq); return ergebnis(r.from, r.to, tr); };
  if ((m = / ((dieses|diesem|aktuelle|aktuellen|laufende|laufenden) quartal)/.exec(t))) return quartal(y, q, m[1]);
  if ((m = / ((letzte|letzten|letztes|vergangene|vergangenen|vorige|vorigen|vorheriges) quartal|vorquartal)/.exec(t))) return q === 1 ? quartal(y - 1, 4, m[1]) : quartal(y, q - 1, m[1]);
  if ((m = / ((naechste|naechsten|naechstes|kommende|kommenden|kommendes) quartal)/.exec(t))) return q === 4 ? quartal(y + 1, 1, m[1]) : quartal(y, q + 1, m[1]);
  m = / (q([1-4])|([1-4])\. ?quartal|(erste|ersten|zweite|zweiten|dritte|dritten|vierte|vierten)s? quartal)(?: (\d{4}))?/.exec(t);
  if (m) {
    const nr = m[2] || m[3] || ({ erste: 1, ersten: 1, zweite: 2, zweiten: 2, dritte: 3, dritten: 3, vierte: 4, vierten: 4 }[m[4]]);
    return quartal(m[5] ? Number(m[5]) : y, Number(nr), m[0].trim());
  }

  // Jahr.
  if ((m = / ((dieses|diesem|aktuelle|aktuellen|laufende|laufenden) jahr(es)?|jahr bisher)/.exec(t))) return ergebnis(`${y}-01-01`, `${y}-12-31`, m[1]);
  if ((m = / (seit (jahres)?anfang( des jahres)?|seit jahresbeginn|ytd)/.exec(t))) return ergebnis(`${y}-01-01`, heute, m[1]);
  if ((m = / ((letzte|letzten|letztes|vergangene|vergangenen|vergangenes|vorige|voriges) jahr(es)?|vorjahr(es)?)/.exec(t))) return ergebnis(`${y - 1}-01-01`, `${y - 1}-12-31`, m[1]);
  if ((m = / ((naechste|naechsten|naechstes|kommende|kommendes) jahr(es)?)/.exec(t))) return ergebnis(`${y + 1}-01-01`, `${y + 1}-12-31`, m[1]);

  // „seit März“
  m = new RegExp(String.raw` (seit (anfang )?(${MONATE.join('|')}))`).exec(t);
  if (m) { const mi = MONATE.indexOf(m[3]); const a = `${mi + 1 > mo ? y - 1 : y}-${zweistellig(mi + 1)}-01`; return ergebnis(a, heute, m[1]); }

  // Monatsname, vielleicht mit Jahr: „im März“, „März 2025“, „mrz 25“.
  const monRe = MONATE.map((n, i) => `${n}|${MONATE_KURZ[i]}`).join('|');
  m = new RegExp(String.raw` ((?:im |in |fuer |von |vom )?(${monRe})\.?(?: (\d{4}|\d{2}))?) `).exec(t);
  if (m) {
    const i = MONATE.findIndex((n, k) => new RegExp(`^(${n}|${MONATE_KURZ[k]})$`).test(m[2]));
    if (i >= 0) {
      let jj = m[3] ? Number(m[3]) : y;
      if (jj < 100) jj += 2000;
      const a = `${jj}-${zweistellig(i + 1)}-01`;
      return ergebnis(a, monthEnd(a), m[1].trim());
    }
  }

  // Jahreszeit: „im Sommer“, „letzten Winter“. Ohne Angabe die jüngste, die schon begonnen hat.
  m = / ((?:im |in |den |diesen |letzten |vergangenen )?(fruehling|fruehjahr|sommer|herbst|winter)(?: (\d{4}))?) /.exec(t);
  if (m) {
    const beginn = { fruehling: 3, fruehjahr: 3, sommer: 6, herbst: 9, winter: 12 }[m[2]];
    let jj = m[3] ? Number(m[3]) : y;
    if (!m[3] && `${jj}-${zweistellig(beginn)}-01` > heute) jj -= 1;
    // „letzten Sommer“: der zuletzt ganz vergangene.
    if (!m[3] && /letzt|vergangen/.test(m[1]) && monthEnd(addMonths(`${jj}-${zweistellig(beginn)}-01`, 2)) >= heute) jj -= 1;
    const a = `${jj}-${zweistellig(beginn)}-01`;
    return ergebnis(a, monthEnd(addMonths(a, 2)), m[1]);
  }

  // Wochentag: „am Freitag“, „nächsten Montag“, „letzten Dienstag“.
  m = new RegExp(String.raw` ((?:am |(letzten|vergangenen|naechsten|kommenden) )?(${WOCHENTAGE.join('|')}))`).exec(t);
  if (m) {
    const ziel = WOCHENTAGE.indexOf(m[3]);
    const jetzt = (fromISO(heute).getDay() + 6) % 7;
    let d;
    if (/letzt|vergangen/.test(m[2] || '')) d = addDays(heute, -(((jetzt - ziel + 7) % 7) || 7));
    else d = addDays(heute, ((ziel - jetzt + 7) % 7) || (m[2] ? 7 : 0) || 7);
    return ergebnis(d, d, m[1]);
  }

  // Einzelnes Datum.
  m = new RegExp(String.raw` (?:am |zum |bis |vom )?${D} `).exec(t);
  if (m) { const d = datumLesen(m[1], heute); return ergebnis(d, d, m[0].trim()); }

  // Jahreszahl allein.
  m = / ((?:im jahr |im |in |fuer )?((?:19|20)\d{2})) /.exec(t);
  if (m) return ergebnis(`${m[2]}-01-01`, `${m[2]}-12-31`, m[1]);
  return null;
}

/** Alle Zeitangaben eines Textes, höchstens drei („September“ und „August“ in einer Frage). */
export function alleZeitraeume(text, heute) {
  const out = [];
  let rest = String(text || '');
  for (let i = 0; i < 3; i++) {
    const z = zeitraumLesen(rest, heute);
    if (!z) break;
    out.push(z);
    rest = norm(rest).replace(z.treffer, ' ');
  }
  return out;
}

/**
 * Zeitraum aus einem Werkzeugargument: Alltagssprache oder „JJJJ-MM-TT bis JJJJ-MM-TT“.
 * Ohne brauchbare Angabe gilt `vorgabe` (ein Text wie „dieses Jahr“).
 */
export function zeitraumArgument(wert, heute, vorgabe = 'dieses Jahr') {
  const z = (wert && zeitraumLesen(String(wert), heute)) || (vorgabe ? zeitraumLesen(vorgabe, heute) : null);
  return z ? { von: z.von, bis: z.bis, text: z.text } : null;
}

/* -------------------------------------------------------------------------- */
/* Beträge, Uhrzeiten                                                          */
/* -------------------------------------------------------------------------- */

/** Erster Geldbetrag im Text in Cent, z. B. „49,90 €“, „1.200 Euro“, „€ 12“; sonst null. */
export function betragLesen(text) {
  const s = String(text || '');
  const m = /(?:€\s?|eur\s)?(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euro\b)?/i.exec(s);
  if (!m) return null;
  // Nur, wenn es wie Geld aussieht: Währung dabei, Nachkommastellen oder eine Zahl ohne Datum drumherum.
  const geld = /€|eur/i.test(m[0]) || /[.,]\d{2}$/.test(m[1]) || !/\d\.\d{1,2}\./.test(s.slice(m.index, m.index + m[0].length + 3));
  return geld ? parseMoney(m[1]) : null;
}

/** Uhrzeit „14:30“, „14.30 Uhr“, „9 Uhr“, „um 9“ → „09:00“; sonst ''. */
export function uhrzeitLesen(text) {
  const t = norm(text);
  // „14:30“ immer; „14.30“ nur mit „Uhr“ dahinter, sonst ist es ein Datum wie „12.10.“.
  let m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t) || /\b([01]?\d|2[0-3])\.([0-5]\d)\s?uhr\b/.exec(t);
  if (m) return `${zweistellig(m[1])}:${m[2]}`;
  m = /\b(?:um\s)?([01]?\d|2[0-3])\s?uhr\b/.exec(t) || /\bum\s([01]?\d|2[0-3])\b(?![.,:]\d)/.exec(t);
  return m ? `${zweistellig(m[1])}:00` : '';
}

/* -------------------------------------------------------------------------- */
/* Bereiche der Anwendung                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Wohin der Assistent führen kann: Bereich, Reiter und die Wörter, an denen
 * man ihn erkennt (normalisiert). Die Reihenfolge zählt: Spezielleres zuerst.
 */
export const BEREICHE = [
  { bereich: 'rechnungen', reiter: 'mahnwesen', name: 'Mahnungen', woerter: ['mahnungen', 'mahnung', 'mahnwesen', 'zahlungserinnerung'] },
  { bereich: 'rechnungen', reiter: 'eingang', name: 'Eingangsrechnungen', woerter: ['eingangsrechnungen', 'e-rechnungen', 'erechnungen', 'rechnungseingang'] },
  { bereich: 'rechnungen', reiter: 'vorlagen', name: 'Rechnungsvorlagen', woerter: ['rechnungsvorlagen', 'vorlagen'] },
  { bereich: 'rechnungen', reiter: 'produkte', name: 'Produkte', woerter: ['produkte', 'artikel', 'leistungen'] },
  { bereich: 'rechnungen', reiter: 'gestaltung', name: 'Rechnungsgestaltung', woerter: ['rechnungsgestaltung', 'rechnungsdesign', 'gestaltung', 'gestalter', 'briefpapier'] },
  { bereich: 'rechnungen', reiter: 'ausgang', name: 'Rechnungen', woerter: ['rechnungen', 'ausgangsrechnungen', 'rechnung'] },
  { bereich: 'reports', reiter: 'guv', name: 'Gewinn und Verlust', woerter: ['gewinn und verlust', 'guv', 'gewinn- und verlust'] },
  { bereich: 'reports', reiter: 'euer', name: 'Anlage EÜR', woerter: ['anlage euer', 'euer', 'einnahmen-ueberschuss-rechnung', 'einnahmenueberschussrechnung'] },
  { bereich: 'reports', reiter: 'ust', name: 'Umsatzsteuer', woerter: ['umsatzsteuer-auswertung', 'umsatzsteuerauswertung', 'ust-auswertung', 'voranmeldung', 'ustva'] },
  { bereich: 'reports', reiter: 'bilanz', name: 'Vermögen', woerter: ['vermoegensuebersicht', 'vermoegen', 'bilanz'] },
  { bereich: 'reports', reiter: 'opos', name: 'Offene Posten', woerter: ['offene posten', 'opos', 'offene-posten-liste'] },
  { bereich: 'reports', reiter: 'konten', name: 'Kontostände', woerter: ['kontostaende', 'kontostand', 'kontenuebersicht'] },
  { bereich: 'reports', reiter: 'anlagen', name: 'Abschreibungen', woerter: ['abschreibungen', 'abschreibung', 'afa'] },
  { bereich: 'reports', reiter: 'vergleich', name: 'Jahresvergleich', woerter: ['jahresvergleich'] },
  { bereich: 'reports', reiter: '', name: 'Auswertungen', woerter: ['auswertungen', 'auswertung', 'berichte', 'bericht', 'reports'] },
  { bereich: 'export', reiter: 'import', name: 'Daten übernehmen', woerter: ['daten uebernehmen', 'import', 'importieren', 'datenimport'] },
  { bereich: 'export', reiter: 'export', name: 'Export', woerter: ['export', 'exportieren', 'datev-export', 'datev', 'steuerberater-export'] },
  { bereich: 'kontoimport', reiter: '', name: 'Kontoauszug', woerter: ['kontoauszug', 'kontoauszuege', 'bankimport', 'umsaetze einlesen'] },
  { bereich: 'master', reiter: 'contacts', name: 'Kunden und Lieferanten', woerter: ['kontakte', 'kunden', 'lieferanten', 'adressbuch'] },
  { bereich: 'master', reiter: 'categories', name: 'Kategorien', woerter: ['kategorien', 'kategorie'] },
  { bereich: 'master', reiter: 'accounts', name: 'Zahlungskonten', woerter: ['zahlungskonten', 'bankkonten', 'konten', 'kasse'] },
  { bereich: 'master', reiter: 'assets', name: 'Anlagevermögen', woerter: ['anlagevermoegen', 'anlagegueter', 'anlagen'] },
  { bereich: 'master', reiter: 'recurring', name: 'Wiederkehrende Buchungen', woerter: ['wiederkehrende buchungen', 'wiederkehrend', 'dauerauftraege', 'abos'] },
  { bereich: 'master', reiter: '', name: 'Stammdaten', woerter: ['stammdaten'] },
  { bereich: 'transactions', reiter: '', name: 'Buchungen', woerter: ['buchungen', 'buchungsliste', 'journal', 'einnahmen und ausgaben'] },
  { bereich: 'calendar', reiter: '', name: 'Kalender', woerter: ['kalender', 'terminkalender'] },
  { bereich: 'todos', reiter: '', name: 'Aufgaben', woerter: ['aufgaben', 'aufgabenliste', 'to-dos', 'todos', 'todo-liste'] },
  { bereich: 'settings', reiter: '', name: 'Einstellungen', woerter: ['einstellungen', 'optionen', 'firmendaten'] },
  { bereich: 'help', reiter: 'neu', name: 'Neuigkeiten', woerter: ['neuigkeiten', 'was ist neu'] },
  { bereich: 'help', reiter: '', name: 'Hilfe', woerter: ['hilfe', 'anleitung', 'handbuch'] },
  { bereich: 'dashboard', reiter: '', name: 'Übersicht', woerter: ['uebersicht', 'startseite', 'dashboard', 'start'] },
];

/** Bereich zu einem Wort oder einer Angabe des Modells („rechnungen“, „reports/ust“, „Umsatzsteuer“). */
export function bereichFinden(eingabe, reiter = '') {
  const t = norm(eingabe).trim();
  if (!t) return null;
  const r = norm(reiter).trim();
  const direkt = BEREICHE.filter((b) => b.bereich === t);
  if (direkt.length) return direkt.find((b) => b.reiter === r) || direkt.find((b) => !b.reiter) || direkt[direkt.length - 1];
  const [b0, r0] = t.split('/');
  if (r0) return bereichFinden(b0, r0);
  return BEREICHE.find((b) => norm(b.name) === t)
    || BEREICHE.find((b) => b.woerter.some((w) => t === w))
    || BEREICHE.find((b) => b.woerter.some((w) => new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(t)))
    || null;
}

/* -------------------------------------------------------------------------- */
/* Stufe „Basis“: Frage → Werkzeug                                             */
/* -------------------------------------------------------------------------- */

const FUELLWOERTER = new Set(('ich mir mich mein meine meinen meinem meiner wir uns unser unsere du dir dein die der das den dem des ein eine einen einem einer und oder '
  + 'von vom zu zum zur im in am an auf aus bei mit nach fuer ueber unter um was wie wo wer wann welche welcher welches welchen wieso warum ist sind war waren '
  + 'wird werden hat habe hatte hab haben gibt gab es bitte mal noch schon alle alles zeig zeige zeigen finde finden such suche suchen gesucht kannst koenntest '
  + 'kann bitte nicht kein keine da dort stand steht stehen irgendwas irgendetwas etwas was dabei drin drinnen glaube glaub denke weiss mehr genau so ja nein '
  + 'hatten gehabt letzte letzten letzter vergangene woche monat jahr heute gestern morgen dass damit dann denn doch nur auch sich sie er es man wo ').split(' '));

/** Wörter, nach denen sich zu suchen lohnt (ohne Füllwörter, Zeitangabe und Zahlen). */
export function suchwoerter(text, ohne = '') {
  let t = norm(text);
  if (ohne) t = t.replace(ohne, ' ');
  return t.replace(/[^a-z0-9äöüß@.-]+/g, ' ').split(' ')
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length > 2 && !FUELLWOERTER.has(w) && !/^\d+([.,]\d+)?$/.test(w));
}

/** Kontakt, dessen Name im Text vorkommt (längster Treffer zuerst). */
function kontaktImText(db, t) {
  let best = null;
  for (const c of db?.contacts || []) {
    const n = norm(c.name).trim();
    if (n.length < 3) continue;
    const kern = n.replace(/\b(gmbh|ug|ag|kg|ohg|gbr|e\.?k\.?|mbh|co|und|&)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const passt = t.includes(n) || (kern.length >= 4 && t.includes(kern)) || (kern.split(' ')[0]?.length >= 5 && t.includes(kern.split(' ')[0]));
    if (passt && (!best || n.length > norm(best.name).length)) best = c;
  }
  return best;
}

const hat = (t, re) => re.test(t);

/* „Diesen Monat“, „dieses Jahr“: ein Zeitraum, kein Bezug auf den geöffneten Eintrag. */
const ZEITWORT = / dies(e|en|em|er|es) (woche|monat|monats|jahr|jahres|quartal|quartals|sommer|winter|fruehling|herbst|zeitraum|zeitraums) /g;
/**
 * Bezieht sich die Frage auf das, was gerade offen ist („diese Rechnung“, „hier“)?
 * @param {string} frage
 */
export function aufAnsicht(frage) {
  const t = ` ${norm(frage).replace(/[^a-z0-9]+/g, ' ')} `.replace(ZEITWORT, ' ');
  return / (dies|diese|dieser|diesen|diesem|dieses|hier|die da|der da|das da|aktuelle|aktuellen|geoeffnete|geoeffneten|angezeigte|angezeigten) /.test(t);
}

/* Wörter, die bei Fragen nach Einnahmen und Ausgaben kein Thema sind („Was hat mich das Auto gekostet?“ → „auto“). */
const KEIN_THEMA = /^(umsatz|umsaetze|einnahmen|ausgaben|gewinn|verlust|verdient|verdiene|eingenommen|ausgegeben|kosten|gekostet|ueberschuss|ergebnis|laeuft|lief|stehe|steht|zahlen|geschaeft|geschaefte|insgesamt|gesamt|irgendwas|hatte|hab|viel|wieviel|meinem|meinen|meine|mein|hast|habe|kunde|kunden|lieferant|lieferanten|geld|buchung|buchungen|monat|jahr|quartal|woche|kostet|pro|jaehrlich|monatlich|entwickelt|entwickeln|entwicklung|verlauf|trend|schnitt|durchschnitt|durchschnittlich|haben|sich)$/;

/** Rechnungsnummer im Text („2026-0007“, „RE-2026-12“), aber kein Datum wie „2026-10-05“. */
const nummerImText = (roh) => /\b([a-z]{1,5}-?\d{4}-\d{2,6}|\d{4}-\d{3,6})\b(?!-\d)/i.exec(roh)?.[1] || '';

/** Ein Betrag nur, wenn er wie Geld aussieht (€, Euro oder Nachkommastellen), nicht etwa die Rechnungsnummer. */
const geldImText = (roh, ohne = '') => {
  const s = ohne ? roh.replace(ohne, ' ') : roh;
  return /€|\beuro\b|\beur\b|\d,\d{2}\b/i.test(s) ? betragLesen(s) : null;
};

/** Aus „anzurufen“ wird „anrufen“, aus „Steuer zu machen“ „Steuer machen“: Aufgaben heißen wie Befehle. */
const ohneZu = (s) => s.replace(/\b(an|auf|ab|aus|ein|mit|nach|vor|zurueck|zurück|weg|durch|her|hin|los|fest|um|zu)zu(\w{2,}en)\b/gi, '$1$2').replace(/\s+zu\s+(\w+en)\s*$/i, ' $1');

/** Muster für die gefundene Zeitangabe im ursprünglichen Text (dort stehen Umlaute statt ae, oe, ue). */
export function ohneZeit(z) {
  return z.treffer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ae/g, '(?:ae|ä)').replace(/oe/g, '(?:oe|ö)').replace(/ue/g, '(?:ue|ü)').replace(/ss/g, '(?:ss|ß)').replace(/ /g, '\\s+');
}

/**
 * Ordnet eine Frage ohne Modell einem Werkzeug zu.
 * @param {string} frage
 * @param {{heute:string, db?:object, ansicht?:{art:string, id:string}|null}} k  ansicht: der geöffnete Eintrag („diese Rechnung“)
 * @returns {{werkzeug:string, argumente:object, sicher:boolean}|null}
 */
export function deuten(frage, { heute, db = null, ansicht = null } = {}) {
  const roh = String(frage || '').trim();
  const t = ` ${norm(roh).replace(/[?!]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (!t.trim()) return null;
  const z = zeitraumLesen(roh, heute);
  const zeitraum = z ? z.text : '';
  const kontakt = db ? kontaktImText(db, t) : null;
  const imBlick = !!ansicht?.id && aufAnsicht(roh);
  const nummer = nummerImText(roh);
  const oeffnenVerb = /^ (bitte )?(oeffne|oeffnen|geh|gehe|wechsel|wechsle|wechsele|navigiere|bring|bringe|spring|springe) /.test(t);
  const istFrage = /\?\s*$/.test(roh) || /^ (ist|sind|wurde|wurden|hat|haben|hatte|gibt|gab|wann|wer|was|welche|welcher|welches|wie|ob) /.test(t);

  // Rechnen: nur Zahlen und Rechenzeichen, „19 % von 250“, „brutto/netto“.
  const formel = t.replace(/ (was ist|was sind|was ergibt|rechne|berechne|wie viel ist|wieviel ist|ergibt) /g, ' ').replace(/=/g, ' ').trim();
  if (/^[\d\s.,+\-*/x×÷:()%^]+$/.test(formel) && /\d/.test(formel) && /[+\-*/x×÷:%^]/.test(formel.replace(/^\s*-/, ''))) {
    return { werkzeug: 'rechnen', argumente: { ausdruck: formel }, sicher: true };
  }
  if ((/ (\d[\d.,]*) ?% (von|aus) (\d[\d.,]*)/.test(t)) && !/ (umsatz|einnahmen|ausgaben|gewinn) /.test(t)) {
    return { werkzeug: 'rechnen', argumente: { ausdruck: t.replace(/ (was ist|was sind|rechne|berechne|wie viel sind|wieviel sind|wie viel ist) /g, ' ').trim() }, sicher: true };
  }
  if (/ (netto|brutto|mwst|mehrwertsteuer|umsatzsteuer|ust) /.test(t) && betragLesen(roh) !== null && / (von|aus|bei|in|zu|auf|sind|ist|enthalten|rechne|berechne) /.test(t)
    && !/ (meine|mein|zahlen|zahllast|quartal|monat|jahr|voranmeldung|finanzamt) /.test(t)) {
    const satz = /(\d{1,2}) ?%/.exec(t)?.[1];
    // Welches Wort gehört zum Betrag? „119 € brutto“, „netto 100 €“; sonst: wer nach netto fragt, gibt brutto an.
    const B = String.raw`\d[\d.,]*\s?(?:€|euro|eur)?`;
    const von = new RegExp(`${B} (netto|zzgl|zuzueglich|plus)|(netto|nettobetrag) (von |aus )?${B}`).test(t) ? 'netto'
      : new RegExp(`${B} (brutto|inkl|inklusive)|(brutto|bruttobetrag) (von |aus )?${B}`).test(t) ? 'brutto'
        : / (wie viel|wieviel|was ist|was sind)( das| der)? brutto/.test(t) ? 'netto' : 'brutto';
    return { werkzeug: 'steuer_rechnen', argumente: { betrag: betragLesen(roh) / 100, satz: satz ? Number(satz) : 19, von }, sicher: true };
  }

  // Gruß, Dank, „Was kannst du?“
  if (/^ (hallo|hi|hey|moin|servus|guten (morgen|tag|abend)|danke|vielen dank|dankeschoen|super|ok|okay|hilfe|was kannst du|wer bist du|wie funktionierst du)( .{0,30})? $/.test(t)
    && !/ (umsatz|rechnung|offen|termin|aufgabe|buchung|steuer) /.test(t)) {
    return { werkzeug: 'faehigkeiten', argumente: { dank: / (danke|dank|super|ok|okay) /.test(t) }, sicher: true };
  }

  // Anlegen.
  if (hat(t, /^ (neue aufgabe|neuer aufgabe|aufgabe anlegen|aufgabe erstellen|aufgabe:|erinnere mich|erinner mich|notiere|notier|merk dir|merke dir|to-?do:?) /)) {
    const titel = ohneZu(roh.replace(/^(neue aufgabe|aufgabe anlegen|aufgabe erstellen|aufgabe:|erinnere mich|erinner mich|notiere|notier|merk dir|merke dir|to-?do:?)\s*(daran,?\s*|an\s+)?/i, '')
      .replace(z ? new RegExp(ohneZeit(z), 'i') : /$^/, '').replace(/\s+(zu|dass)\s*$/i, '').replace(/^\s*(an|daran)\s+(die|den|das|der)?\s*/i, '')
      // „Erinnere mich morgen, den Steuerberater anzurufen“: Komma und Artikel vorn weg.
      .replace(/^[\s,;:.-]+/, '').replace(/^(den|die|das|der|dem)\s+/i, '')
      .replace(/\s+/g, ' ').trim());
    return { werkzeug: 'aufgabe_vorschlagen', argumente: { titel: titel ? titel[0].toUpperCase() + titel.slice(1) : roh, faellig: z?.von || '' }, sicher: true };
  }
  if (hat(t, /^ (neuer termin|neuen termin|termin anlegen|termin eintragen|termin:|trag .* ein|trage .* ein|plane) /) || / (in den kalender|als termin) /.test(t)) {
    const ohneDatum = z ? roh.replace(new RegExp(ohneZeit(z), 'i'), ' ') : roh;
    const zeit = uhrzeitLesen(ohneDatum);
    const titel = ohneDatum.replace(/^(neuer termin|neuen termin|termin anlegen|termin eintragen|termin:|trag(e)?|plane)\s*/i, '')
      .replace(/\s*(in den kalender|als termin)( ein)?\s*$/i, '').replace(/\s*ein\s*$/i, '')
      .replace(/\s*(um\s*)?\d{1,2}([:.]\d{2})?\s*uhr/i, '').replace(/\s+um\s+\d{1,2}([:.]\d{2})?\b/i, '').replace(/\s+/g, ' ').trim()
      // „Trag mir für Dienstag einen Termin mit dem Steuerberater ein“ → „Termin mit dem Steuerberater“
      .replace(/^(mir|uns)\s+/i, '').replace(/^(für|fuer)\s+/i, '').replace(/^(einen|den|ein)\s+/i, '').replace(/\s+/g, ' ').trim();
    const titelSchoen = /^termin\b/i.test(titel) ? `Termin${titel.slice(6)}` : /^(mit|beim|bei|zum|zur)\b/i.test(titel) ? `Termin ${titel}` : titel;
    return { werkzeug: 'termin_vorschlagen', argumente: { titel: titelSchoen || 'Termin', datum: z?.von || heute, uhrzeit: zeit }, sicher: true };
  }
  if (hat(t, /^ (neuer kontakt|neuen kontakt|kontakt anlegen|neuer kunde|neuen kunden|neuer lieferant|neuen lieferanten|kunde anlegen|lieferant anlegen) /)) {
    const rest = roh.replace(/^(neuer kontakt|neuen kontakt|kontakt anlegen|neuer kunde|neuen kunden|neuer lieferant|neuen lieferanten|kunde anlegen|lieferant anlegen)\s*:?\s*/i, '');
    const email = /[^\s<>]+@[^\s<>]+\.[a-z]{2,}/i.exec(rest)?.[0] || '';
    const telefon = /(\+?\d[\d\s/-]{6,}\d)/.exec(rest)?.[1] || '';
    const name = rest.replace(email, '').replace(telefon, '').replace(/[,;]+/g, ' ').replace(/\s+(mit|e-?mail|telefon|tel\.?)\s*$/i, '').replace(/\s+/g, ' ').trim();
    return { werkzeug: 'kontakt_vorschlagen', argumente: { name, email, telefon, art: / lieferant/.test(t) ? 'lieferant' : 'kunde' }, sicher: !!name };
  }
  if (hat(t, /^ (neue rechnung|rechnung schreiben|rechnung erstellen|rechnung anlegen|schreib eine rechnung|schreibe eine rechnung|erstelle eine rechnung) /)) {
    const betrag = betragLesen(roh);
    const leistung = /(?:fuer|über|ueber)\s+(?:\d[\d.,]*\s?(?:€|euro)?\s*(?:fuer\s+)?)?([^\d].*)$/i.exec(roh.replace(/^.*?(rechnung)\s*/i, '').replace(/^(an|für)\s+\S+(\s+\S+)?\s*/i, ''))?.[1] || '';
    const name = leistung.replace(/^\s*(für|fuer)\s+/i, '').trim();
    return { werkzeug: 'rechnung_vorschlagen', argumente: { kunde: kontakt?.name || /(?:an|für|fuer)\s+([^,]+?)(?:\s+(?:über|ueber|fuer|für|mit)\s|$)/i.exec(roh)?.[1] || '', positionen: betrag !== null ? [{ name: name || 'Leistung', menge: 1, preis: betrag / 100 }] : [] }, sicher: true };
  }
  const ausgabeVerb = / (ausgegeben|bezahlt|gezahlt|gekauft|bezahle|zahle|getankt) /.test(t);
  const einnahmeVerb = / (erhalten|bekommen|eingenommen|eingegangen|kassiert|verdient hab|ueberwiesen bekommen) /.test(t);
  if ((hat(t, /^ (neue|eine|buche|buch|erfasse|erfass)? ?(ausgabe|einnahme|buchung)( von| ueber| mit| fuer)? /) || ((ausgabeVerb || einnahmeVerb) && /^ ich (habe|hab) /.test(t)))
    && betragLesen(roh) !== null && !/ (wie viel|wieviel|wann|wo|welche|was habe ich) /.test(t)) {
    const typ = / einnahme/.test(t) || (einnahmeVerb && !ausgabeVerb) ? 'einnahme' : 'ausgabe';
    const beschreibung = roh.replace(/^(neue|eine|buche|buch|erfasse|erfass)?\s*(ausgabe|einnahme|buchung)?\s*(von|über|ueber|mit)?\s*/i, '')
      .replace(/^ich\s+(habe|hab)\s*/i, '').replace(/-?\d{1,3}(\.\d{3})*(,\d{1,2})?\s?(€|euro|eur)?|-?\d+([.,]\d{1,2})?\s?(€|euro|eur)?/i, '')
      .replace(z ? new RegExp(ohneZeit(z), 'i') : /$^/, '')
      .replace(/(^|\s)(fürs|fuers|für das|für den|für die|für|fuer|an|bei|ausgegeben|bezahlt|gezahlt|gekauft|erhalten|bekommen|eingenommen)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
    return { werkzeug: 'buchung_vorschlagen', argumente: { typ, betrag: betragLesen(roh) / 100, beschreibung, datum: z?.von || heute, kontakt: kontakt?.name || '' }, sicher: true };
  }

  // Zahlung eingegangen oder geleistet: „Müller hat bezahlt“, „Rechnung 2026-0007 ist bezahlt“, „als bezahlt markieren“.
  const bezahltSatz = / (hat|haben|habe|hab) (.{0,50} )?(bezahlt|gezahlt|ueberwiesen|beglichen) /.test(t)
    || / (ist|sind|wurde|wurden) (jetzt |heute |gestern |endlich |schon |inzwischen )?(bezahlt|beglichen|eingegangen|ueberwiesen)/.test(t)
    || / als bezahlt /.test(t) || / (zahlung|geld|ueberweisung) (von|vom|fuer|zu|zur) .*(erhalten|eingegangen|bekommen|angekommen|da) /.test(t);
  if (bezahltSatz && !istFrage && !/ (nicht|nie|kein|keine) /.test(t)) {
    const ich = /^ ich (habe|hab) /.test(t);
    const woerter = suchwoerter(roh, z?.treffer).filter((w) => !/^(bezahlt|gezahlt|ueberwiesen|beglichen|eingegangen|rechnung|zahlung|markiere|markieren|endlich|inzwischen|jetzt|als|geld|erhalten|bekommen|angekommen)$/.test(w) && !norm(nummer).includes(w));
    const betrag = geldImText(roh, nummer);
    return {
      werkzeug: 'zahlung_vorschlagen',
      argumente: {
        ...(kontakt ? { kontakt: kontakt.name } : {}), ...(nummer ? { rechnung: nummer } : {}), ...(betrag !== null ? { betrag: betrag / 100 } : {}),
        ...(!kontakt && !nummer && woerter.length ? { text: woerter.join(' ') } : {}), datum: z?.von || '', art: ich ? 'ausgabe' : 'einnahme',
      },
      sicher: !!(kontakt || nummer || imBlick || /^ (markiere|trag|trage) /.test(t)),
    };
  }
  // Mahnen: „Mahne das Weingut“, „Schick der Kanzlei eine Mahnung“; „Welche kann ich mahnen?“ ist eine Liste.
  if (/ (mahne|mahnen|anmahnen|mahnung|mahnungen|zahlungserinnerung|erinnerung) /.test(t) && !/ (aufgabe|termin|erinnere mich|erinner mich) /.test(t) && !oeffnenVerb) {
    if (/ welche /.test(t)) return { werkzeug: 'offene_posten', argumente: { art: 'forderungen', nur_ueberfaellige: true }, sicher: true };
    const tun = / (mahne|mahnen|anmahnen) /.test(t) || / (schick|schicke|sende|schreib|schreibe|erstell|erstelle|mach|mache|bereite|verschick|verschicke) .*(mahnung|zahlungserinnerung|erinnerung)/.test(t);
    if (tun || kontakt || nummer || imBlick) {
      return { werkzeug: 'mahnung_vorschlagen', argumente: { ...(kontakt ? { kunde: kontakt.name } : {}), ...(nummer ? { rechnung: nummer } : {}) }, sicher: true };
    }
  }

  // Bedienung: „Wie erstelle ich …“, „Wo finde ich …“, „Was bedeutet …“ beantwortet die Hilfe.
  const anleitung = /^ (und )?(wie|womit) (erstelle|erstellt|mache|macht|kann|koennen|lege|legt|stelle|stellt|richte|richtet|importiere|importiert|exportiere|exportiert|loesche|loescht|aendere|aendert|finde|findet|geht|funktioniert|funktionieren|bekomme|bekommt|schreibe|schreibt|buche|bucht|verbinde|verbindet|sichere|sichert|drucke|druckt|sende|sendet|verschicke|verschickt|trage|traegt|gebe|gibt|lade|laedt|scanne|teile|melde|aktiviere|deaktiviere|schalte|verknuepfe|storniere|korrigiere|erfasse|nutze|benutze|komme|kommt|hinterlege|wechsle|wechsele|uebernehme|uebertrage|kopiere|setze|binde|verwalte|lese|spiele|richtet man|installiere|entsperre|sperre|aendert man|lerne) /.test(t)
    || /^ (und )?wo (finde|findet|kann|koennen|stelle|stellt|sehe|sieht|ist|sind|steht|stehen|trage|lege|gebe|aendere) /.test(t)
    || (/^ (und )?was (bedeutet|bedeuten|heisst|heissen|ist eine?|ist der|ist die|ist das|sind) /.test(t) && !/ (mein|meine|meinen|meinem|meiner|noch offen|offen|viel|aktuell|heute|gerade) /.test(t))
    || / (anleitung|erklaer mir|erklaere mir|hilfe zu|hilfe bei|wie funktioniert|wie geht das|geht das|kann man) /.test(t);
  if (anleitung && !/ (wie viel|wieviel|wie hoch|wie lange) /.test(t)) {
    return { werkzeug: 'hilfe_suchen', argumente: { frage: roh }, sicher: true };
  }

  // Der geöffnete Eintrag: „Wann ist diese Rechnung fällig?“, „Was steht hier?“
  if (imBlick && !/ (umsatz|einnahmen|ausgaben|gewinn|verlust|umsatzsteuer) /.test(t)) {
    return { werkzeug: 'eintrag_lesen', argumente: { art: ansicht.art, id: ansicht.id }, sicher: true };
  }

  // Was heute ansteht.
  if (/ (was steht (heute |morgen |jetzt |gerade |diese woche |als naechstes |so )?an|was liegt (heute |gerade |so )?an|was ist (heute|gerade) (los|wichtig|dran|zu tun)|was ist zu tun|was gibt es (heute |neues )?zu tun|was muss ich (heute |jetzt |als naechstes |noch )?(tun|machen|erledigen)|was soll ich (heute |jetzt )?(tun|machen)|tagesueberblick|ueberblick|zusammenfassung|briefing|was ist wichtig|womit soll ich anfangen|guten morgen was) /.test(t)
    && !/ (termin|termine|aufgabe|aufgaben|umsatz|ausgaben|einnahmen|rechnung|rechnungen) /.test(t)) {
    return { werkzeug: 'tagesueberblick', argumente: {}, sicher: true };
  }

  // Prüfen, Steuerjahr, Abschreibung, Kleinunternehmer.
  if (/ (fertig fuer die steuer|bereit fuer die steuer|fertig fuer die steuererklaerung|steuerfertig|jahresabschluss|abschluss|was fehlt|fehlt (noch )?(etwas|was)|ist alles (in ordnung|vollstaendig|richtig|komplett|gebucht)|alles vollstaendig|pruefe? (mein|meine|das|die|den) (jahr|buchhaltung|buchungen|zahlen)|plausibilitaet|plausibel|ungereimtheiten|auffaelligkeiten) /.test(t)
    && !/ (aufgabe|termin) /.test(t)) {
    return { werkzeug: 'jahrespruefung', argumente: { zeitraum: zeitraum || 'dieses Jahr' }, sicher: true };
  }
  if ((/ (anlage euer|euer|einnahmenueberschussrechnung|einnahmen-ueberschuss-rechnung|einnahmen ueberschuss rechnung) /.test(t) || / zeile \d{1,3} /.test(t)) && !oeffnenVerb) {
    return { werkzeug: 'euer', argumente: { zeitraum: zeitraum || 'letztes Jahr' }, sicher: true };
  }
  if ((/ (abschreibung|abschreibungen|afa|abschreiben|restbuchwert|restwert|anlagegueter|anlagevermoegen) /.test(t) || / schreib(e)? ich .*ab /.test(t))
    && !oeffnenVerb && !/ (anlegen|erfassen|neues|neue) /.test(t)) {
    return { werkzeug: 'abschreibungen', argumente: { zeitraum: zeitraum || 'dieses Jahr' }, sicher: true };
  }
  if (/ (kleinunternehmer|kleinunternehmerin|kleinunternehmergrenze|kleinunternehmerregelung|umsatzgrenze|umsatzgrenzen|25\.?000|100\.?000|22\.?000) /.test(t) && !/ (rechnung|hinweis) /.test(t)) {
    return { werkzeug: 'kleinunternehmer', argumente: {}, sicher: true };
  }
  if (/ (kontostand|kontostaende|guthaben|liquiditaet|auf der bank|wie viel geld (habe|hab|ist)|wie viel ist auf|geld auf (meinen|meinem|dem|den|der) (konten|konto|bank)|auf (meinen|meinem) (konten|konto)) /.test(t) && !oeffnenVerb) {
    return { werkzeug: 'kontostaende', argumente: {}, sicher: true };
  }
  // Buchungen ohne Beleg (vor den Summen: „Welche Ausgaben haben keinen Beleg?“ ist keine Summe).
  if (/ (ohne beleg|ohne belege|ohne quittung|keinen beleg|kein beleg|keine belege|beleg fehlt|belege fehlen|fehlende belege|fehlenden belege) /.test(t)) {
    return { werkzeug: 'buchungen_auflisten', argumente: { ohne_beleg: true, zeitraum: zeitraum || 'dieses Jahr', ...(/ (einnahme|einnahmen) /.test(t) ? { typ: 'einnahme' } : / (ausgabe|ausgaben) /.test(t) ? { typ: 'ausgabe' } : {}) }, sicher: true };
  }
  // Verlauf Monat für Monat.
  if (/ (entwicklung|entwickelt|entwickeln|entwickelte|verlauf|trend|monatlich|pro monat|je monat|im monat|monat fuer monat|jeden monat|nach monaten|monatsweise|durchschnittlich|im schnitt|durchschnitt) /.test(t)
    && / (umsatz|umsaetze|einnahmen|ausgaben|kosten|gewinn|verdient|verdiene|geschaeft|ergebnis|ueberschuss|eingenommen|ausgegeben) /.test(t)) {
    const wert = / (ausgaben|kosten|ausgegeben) /.test(t) ? 'ausgaben' : / (gewinn|geschaeft|ergebnis|ueberschuss) /.test(t) ? 'gewinn' : 'einnahmen';
    const thema = suchwoerter(roh, z?.treffer).filter((w) => !KEIN_THEMA.test(w) && !/^(monat|monate|monaten|letzten|naechsten|zwoelf|\d+)$/.test(w));
    return { werkzeug: 'entwicklung', argumente: { wert, zeitraum: zeitraum || 'die letzten 12 Monate', ...(thema[0] ? { kategorie: thema[0] } : {}) }, sicher: true };
  }

  // Auswertungen.
  if (/ (umsatzsteuer|ust|mwst|mehrwertsteuer|vorsteuer|zahllast|voranmeldung|ustva) /.test(t) || / (ans|an das) finanzamt (zahlen|abfuehren|ueberweisen) /.test(t)) {
    if (/ (frist|faellig|wann|abgeben|termin) /.test(t)) return { werkzeug: 'steuertermine', argumente: { zeitraum: zeitraum || 'die nächsten 60 Tage' }, sicher: true };
    return { werkzeug: 'umsatzsteuer', argumente: { zeitraum: zeitraum || 'dieses Quartal' }, sicher: true };
  }
  if (/ (frist|fristen|steuertermin|steuertermine|abgabetermin|abgabefrist|steuererklaerung) /.test(t)) {
    return { werkzeug: 'steuertermine', argumente: { zeitraum: zeitraum || 'die nächsten 90 Tage' }, sicher: true };
  }
  const offen = / (offen|offene|offenen|offener|unbezahlt|unbezahlte|unbezahlten|ausstehend|ausstehende|ueberfaellig|ueberfaellige|ueberfaelligen|noch nicht bezahlt|schuldet|schulden|forderung|forderungen|verbindlichkeit|verbindlichkeiten) /.test(t);
  if (offen && !/ (aufgabe|aufgaben|todo|to-do|termin) /.test(t)) {
    const art = / (verbindlichkeit|verbindlichkeiten|muss ich (noch )?(be)?zahlen|schulde ich|meine schulden|eingangsrechnung|eingangsrechnungen|lieferant|lieferanten) /.test(t) ? 'verbindlichkeiten'
      : / (forderung|forderungen|kunde|kunden|schuldet|schulden mir|ausgangsrechnung|rechnung|rechnungen|zahlungseingang) /.test(t) ? 'forderungen' : 'beide';
    if (kontakt) return { werkzeug: 'rechnungen_auflisten', argumente: { zustand: / ueberfaellig/.test(t) ? 'ueberfaellig' : 'offen', kunde: kontakt.name }, sicher: true };
    return { werkzeug: 'offene_posten', argumente: { art, nur_ueberfaellige: / ueberfaellig/.test(t) }, sicher: true };
  }
  // Zahlungsmoral: „Welche Kunden zahlen am schlechtesten / zu spät?“
  if (/ (zahlungsmoral|saeumig|saeumige|schlechtesten|zu spaet|spaet|verspaetet|nicht puenktlich) /.test(t) && / (zahlen|zahlt|bezahlen|bezahlt|kunde|kunden|zahlungsmoral|saeumig|saeumige) /.test(t)) {
    return { werkzeug: 'offene_posten', argumente: { art: 'forderungen', nur_ueberfaellige: true }, sicher: true };
  }
  // Rangliste: „Welcher Kunde hat am meisten gebracht?“, „größte Lieferanten“
  if (/ (kunde|kunden|kundin|lieferant|lieferanten|auftraggeber) /.test(t) && / (meisten|meiste|groessten|groesste|beste|besten|top|wichtigste|wichtigsten|rangliste) /.test(t)) {
    return { werkzeug: 'nach_kontakt', argumente: { typ: / (lieferant|lieferanten) /.test(t) ? 'ausgabe' : 'einnahme', zeitraum: zeitraum || 'dieses Jahr' }, sicher: true };
  }
  if (/ (wofuer|wo ?fuer|wohin|meisten|groessten|groesste|teuerste|top|kategorien|kategorie|aufteilung|verteilung) /.test(t) && / (ausgabe|ausgaben|ausgegeben|kosten|geld|einnahmen|umsatz|verdient) /.test(t)) {
    return { werkzeug: 'nach_kategorie', argumente: { typ: / (einnahmen|umsatz|verdient) /.test(t) ? 'einnahme' : 'ausgabe', zeitraum: zeitraum || 'dieses Jahr' }, sicher: true };
  }
  // Rechnungen an oder von einem bekannten Kontakt („Finde die Rechnung an das Weingut“).
  if (kontakt && / (rechnung|rechnungen) /.test(t) && !/ (zahlung|zahlungen|bezahlt|gezahlt|ueberwiesen|ueberweisung|geld|buchung|buchungen) /.test(t)) {
    return { werkzeug: 'rechnungen_auflisten', argumente: { richtung: kontakt.kind === 'supplier' ? 'eingang' : 'ausgang', zustand: 'alle', kunde: kontakt.name, ...(zeitraum ? { zeitraum } : {}) }, sicher: true };
  }
  // Zahlungen an oder von einem bekannten Kontakt.
  if (kontakt && / (zahlung|zahlungen|bezahlt|gezahlt|ueberwiesen|ueberweisung|buchung|buchungen|rechnung|rechnungen|eingang|geld) /.test(t)) {
    return { werkzeug: 'buchungen_auflisten', argumente: { kontakt: kontakt.name, zeitraum: zeitraum || 'insgesamt' }, sicher: true };
  }
  if (/ (umsatz|umsaetze|einnahmen|ausgaben|gewinn|verlust|verdient|eingenommen|ausgegeben|kosten|kostet|gekostet|ueberschuss|ergebnis|wie laeuft|wie lief|wie stehe|wie steht|meine zahlen|die zahlen|geschaeft|geschaefte) /.test(t) && !/ (aufgabe|termin) /.test(t)) {
    if (/ (vergleich|vergleiche|verglichen|gegenueber|vs|versus) /.test(t)) {
      const z2 = zeitraumLesen(norm(roh).replace(z?.treffer || '§', ' '), heute);
      if (z && z2) return { werkzeug: 'zeitraeume_vergleichen', argumente: { zeitraum: z.text, zeitraum2: z2.text }, sicher: true };
      // Nur ein Zeitraum genannt („im Vergleich zum letzten Jahr“): der laufende gleicher Länge gegen ihn.
      const tage = z ? (fromISO(z.bis) - fromISO(z.von)) / 864e5 : 365;
      const jetzt = tage > 100 ? 'dieses Jahr' : tage > 40 ? 'dieses Quartal' : 'dieser Monat';
      return { werkzeug: 'zeitraeume_vergleichen', argumente: { zeitraum: jetzt, zeitraum2: z ? z.text : 'letztes Jahr' }, sicher: true };
    }
    if (kontakt) return { werkzeug: 'kontakt_finden', argumente: { name: kontakt.name }, sicher: true };
    // Ein Thema dabei („mit Hochzeiten verdient“): Buchungen mit diesem Wort statt der Summe über alles.
    const thema = suchwoerter(roh, z?.treffer).filter((w) => !KEIN_THEMA.test(w));
    if (thema.length) {
      const proJahr = / (im jahr|pro jahr|jaehrlich|jahreskosten) /.test(t);
      return { werkzeug: 'buchungen_auflisten', argumente: { typ: / (ausgaben|ausgegeben|kosten|kostet|gekostet) /.test(t) ? 'ausgabe' : 'einnahme', text: thema[0], zeitraum: zeitraum || (proJahr ? 'die letzten 12 Monate' : 'insgesamt') }, sicher: true };
    }
    return { werkzeug: 'kennzahlen', argumente: { zeitraum: zeitraum || 'dieses Jahr' }, sicher: true };
  }
  if (/ (termin|termine|meeting|meetings|was steht an|was habe ich|was hab ich|verabredung) /.test(t) && !/ (aufgabe|aufgaben) /.test(t)) {
    return { werkzeug: 'termine_auflisten', argumente: { zeitraum: zeitraum || 'die nächsten 14 Tage', text: suchwoerter(roh, z?.treffer).filter((w) => !/^termin|^meeting|^steht|^kalender/.test(w)).join(' ') }, sicher: true };
  }
  if (/ (aufgabe|aufgaben|todo|todos|to-do|to-dos|erledigen|was muss ich) /.test(t)) {
    return { werkzeug: 'aufgaben_auflisten', argumente: { status: / (ueberfaellig|verpasst|liegen geblieben) /.test(t) ? 'ueberfaellig' : / (erledigt|erledigte|geschafft) /.test(t) ? 'erledigt' : 'offen' }, sicher: true };
  }

  // Buchungen mit Merkmalen.
  if (/ (ohne beleg|ohne belege|beleg fehlt|belege fehlen|fehlende belege|fehlenden belege) /.test(t)) {
    return { werkzeug: 'buchungen_auflisten', argumente: { ohne_beleg: true, zeitraum: zeitraum || 'dieses Jahr' }, sicher: true };
  }

  // Kontakt erfragt.
  if (kontakt && /(wer ist|kontakt|telefon|nummer|e-?mail|mail|adresse|anschrift|kunde|kundin|lieferant|umsatz mit)/.test(t)) {
    return { werkzeug: 'kontakt_finden', argumente: { name: kontakt.name }, sicher: true };
  }

  // Bereich öffnen: Verb und Bereichsname, oder nur der Name.
  const verb = /^ (oeffne|oeffnen|zeig|zeige|geh|gehe|wechsel|wechsle|wechsele|navigiere|bring mich|bringe mich|zu|zur|zum|springe?|ruf|rufe) /.test(t);
  const ohneVerb = t.replace(/^ (bitte )?(oeffne|oeffnen|zeig( mir)?|zeige( mir)?|geh(e)?( mal)?( zu| zur| zum| in| auf)?|wechsel(e)?( zu| zur| zum| in)?|wechsle( zu| zur| zum| in)?|navigiere( zu| zur| zum)?|bring(e)? mich( zu| zur| zum| in)?|springe?( zu| zur| zum| in)?|ruf(e)?|zu|zur|zum) /, ' ')
    .replace(/ (die|den|das|der|meine|mein|bitte|auf|an|mal|seite|bereich|ansicht|reiter) /g, ' ').replace(/\s+/g, ' ').trim();
  const b = bereichFinden(ohneVerb);
  // Was nach dem Bereichsnamen übrig bleibt, darf höchstens ein Wort sein; sonst ist es eine Frage, kein Wechsel.
  const rest = b ? ` ${ohneVerb} `.replace(new RegExp(` (${[norm(b.name), ...b.woerter].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}) `), ' ').trim() : '';
  if (b && (verb || !rest) && rest.split(' ').filter(Boolean).length <= 1) {
    return { werkzeug: 'oeffnen', argumente: { bereich: b.bereich, reiter: b.reiter }, sicher: true };
  }

  if (/ (rechnungsentwuerfe|entwuerfe|entwurf) /.test(t)) {
    return { werkzeug: 'rechnungen_auflisten', argumente: { zustand: 'entwurf' }, sicher: true };
  }

  // Sonst: suchen, mit den Wörtern, die übrig bleiben.
  const woerter = suchwoerter(roh, z?.treffer).filter((w) => !/^(rechnung|rechnungen|buchung|buchungen|beleg|belege|termin|kontakt)$/.test(w));
  if (!woerter.length) return null;
  const art = / (rechnung|rechnungen) /.test(t) ? 'rechnung' : / (buchung|buchungen|zahlung|ueberweisung) /.test(t) ? 'buchung'
    : / (kontakt|kunde|kundin|lieferant) /.test(t) ? 'kontakt' : / (termin|termine) /.test(t) ? 'termin' : / (aufgabe|aufgaben) /.test(t) ? 'aufgabe' : 'alle';
  return { werkzeug: 'suchen', argumente: { text: woerter.join(' '), art, zeitraum }, sicher: woerter.length <= 4 };
}

/**
 * Kurze Rückfrage zur Frage davor: mit neuem Zeitraum („Und 2023?“, „Und im
 * April?“) oder mit einem anderen Namen oder Stichwort („Und bei Lidl?“, „Was
 * ist mit der Kanzlei Weber?“). Ergebnis ist die letzte verstandene Frage aus
 * dem Verlauf, mit dem Neuen an der passenden Stelle. Sonst null (dann gilt
 * `deuten` allein).
 */
export function folgefrageDeuten(frage, verlauf, { heute, db = null } = {}) {
  const roh = String(frage || '').trim();
  const t = ` ${norm(roh).replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const z = zeitraumLesen(roh, heute);
  const woerter = suchwoerter(roh, z?.treffer).filter((w) => !KEIN_THEMA.test(w) && !/^(und|bei|fuer|mit|von|davon|dazu|dort|damit|denn|eigentlich|sieht|summe|betrag)$/.test(w));
  const und = /^ (und|und was ist mit|und wie ist es mit|was ist mit|wie ist es mit|wie sieht es (mit|bei|fuer)) /.test(t);
  if (!z && !und) return null;
  if (!und && woerter.length) return null; // „Umsatz im März“ ist eine eigene Frage
  if (woerter.length > 3) return null;
  for (const v of [...(verlauf || [])].reverse().slice(0, 4)) {
    const d = deuten(v.frage, { heute, db });
    if (!d) continue; // selbst eine Rückfrage: weiter zurück
    const a = { ...d.argumente };
    if (z) {
      if (!('zeitraum' in a) || 'zeitraum2' in a) return null;
      a.zeitraum = z.text;
    }
    if (woerter.length) {
      const feld = ['kontakt', 'kunde', 'name', 'text'].find((f) => f in a);
      if (!feld) return null;
      const kontakt = db ? kontaktImText(db, t) : null;
      a[feld] = kontakt && feld !== 'text' ? kontakt.name : woerter.join(' ');
    }
    return z || woerter.length ? { ...d, argumente: a } : null;
  }
  return null;
}

/** Für Prüfungen und Anzeigen: Werkzeugaufruf als kurzer Text. */
export function deutungText(d) {
  if (!d) return '';
  return `${d.werkzeug}(${Object.entries(d.argumente || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')})`;
}

