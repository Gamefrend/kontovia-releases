/**
 * Kontovia – Mahnwesen: Stufen, Fristen, Gebühren und Verzugsaufschlag.
 *
 * Diese Datei rechnet und formuliert nur. Sie kennt weder Oberfläche noch
 * Speicher und läuft deshalb auch in den Prüfungen (scripts/pruefungen).
 * Gespeichert wird in lib/mahnungsaktionen.js.
 *
 * Drei Stufen: Zahlungserinnerung, 1. Mahnung, 2. Mahnung (letzte Frist). Je
 * Stufe sind Zahlungsfrist in Tagen und Mahngebühr einstellbar. Dazu kommt
 * auf Wunsch ein Verzugsaufschlag: Prozent pro Jahr auf den offenen Betrag
 * (tageweise ab Fälligkeit), eine feste Pauschale (höchstens einmal je
 * Rechnung) oder beides.
 *
 * Steuerliche Behandlung (Entscheidung, bitte mit der Steuerberatung
 * abstimmen): Mahngebühren, Verzugszinsen und die Verzugspauschale sind
 * Schadensersatz und kein Entgelt für eine Leistung (Abschn. 1.3 UStAE). Sie
 * unterliegen deshalb nicht der Umsatzsteuer und stehen in keiner Kennzahl
 * der Voranmeldung, sind aber Betriebseinnahmen. Sie gehören darum weder in
 * die Rechnung (keine Änderung ihrer Summen, ihrer Steuer oder ihrer
 * Festschreibung) noch unter einen ihrer Steuersätze. Gebucht werden sie erst,
 * wenn das Geld da ist, als eigene Einnahme mit eigener Kategorie und der
 * Behandlung „nicht steuerbar“ (lib/mahnungsaktionen.js, lib/calc.js).
 */

import { addDays, daysBetween, todayISO } from './util.js';
import { berechnen, faelligkeit, zustand, rund, betragText } from './rechnung.js';

/** Die Stufen. `kurz` steht in Listen, `titel` auf dem Schreiben. */
export const MAHNSTUFEN = {
  1: { nr: 1, name: 'Zahlungserinnerung', kurz: 'Erinnerung', titel: 'Zahlungserinnerung', dateiname: 'Zahlungserinnerung' },
  2: { nr: 2, name: '1. Mahnung', kurz: '1. Mahnung', titel: '1. Mahnung', dateiname: 'Mahnung_1' },
  3: { nr: 3, name: '2. Mahnung (letzte Frist)', kurz: '2. Mahnung', titel: '2. Mahnung (letzte Frist)', dateiname: 'Mahnung_2' },
};

export const stufenName = (s) => MAHNSTUFEN[s]?.name || '';

/** Arten des Verzugsaufschlags. */
export const AUFSCHLAG_ARTEN = {
  aus: 'Kein Verzugsaufschlag',
  prozent: 'Prozent pro Jahr',
  pauschale: 'Feste Pauschale',
  beides: 'Beides zusammen',
};

/** Gesetzliche Verzugspauschale bei Geschäftskunden: 40 € (§ 288 Abs. 5 BGB). */
export const PAUSCHALE_VORGABE = 4000;

export const MAHN_VORGABE = {
  fristen: { 1: 7, 2: 7, 3: 7 },
  gebuehren: { 1: 0, 2: 0, 3: 0 },
  // Standardmäßig aus. abStufe: ab welchem Schreiben der Aufschlag vorgeschlagen wird (1 bis 3).
  aufschlag: { art: 'aus', prozent: 0, pauschale: PAUSCHALE_VORGABE, abStufe: 2 },
};

const zahl = (n, lo, hi, vorgabe) => {
  const x = Number(n);
  return n === '' || n === null || n === undefined || !Number.isFinite(x) ? vorgabe : Math.min(hi, Math.max(lo, x));
};

/** Die Einstellungen mit allen Vorgaben und bereinigt. Wirft nie. */
export function mahneinstellungen(settings = {}) {
  const s = settings?.mahnwesen && typeof settings.mahnwesen === 'object' ? settings.mahnwesen : {};
  const fristen = {}; const gebuehren = {};
  for (const st of [1, 2, 3]) {
    fristen[st] = Math.round(zahl(s.fristen?.[st], 1, 90, MAHN_VORGABE.fristen[st]));
    gebuehren[st] = Math.round(zahl(s.gebuehren?.[st], 0, 100000000, MAHN_VORGABE.gebuehren[st]));
  }
  const a = s.aufschlag && typeof s.aufschlag === 'object' ? s.aufschlag : {};
  return {
    fristen,
    gebuehren,
    aufschlag: {
      art: Object.hasOwn(AUFSCHLAG_ARTEN, a.art) ? a.art : 'aus',
      prozent: Math.round(zahl(a.prozent, 0, 50, 0) * 100) / 100,
      pauschale: Math.round(zahl(a.pauschale, 0, 100000000, PAUSCHALE_VORGABE)),
      abStufe: Math.round(zahl(a.abStufe, 1, 3, 2)),
    },
  };
}

/** „9,5“ oder „9.5“ → 9.5 (Prozent). Leer oder Unsinn → null. */
export function parseSatz(text) {
  const s = String(text ?? '').replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const d8 = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');
const satzText = (p) => `${String(Math.round(Number(p) * 100) / 100).replace('.', ',')}`;
const tageText = (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`;

/* -------------------------------------------------------------------------- */
/* Offener Betrag und Mahnfähigkeit                                            */
/* -------------------------------------------------------------------------- */

/**
 * Was von der Rechnung noch offen ist, in Cent (brutto).
 * Maßgeblich sind die Buchungen der Rechnung: offene Buchungen zählen, bezahlte
 * nicht. Eine Teilzahlung, die als eigene bezahlte Buchung abgetrennt ist
 * (lib/importaktionen.js), mindert so den Rest. Ohne Buchung gilt der
 * Zahlbetrag der Rechnung, es sei denn, sie ist als bezahlt vermerkt.
 */
export function rechnungsRest(r, buchungen = []) {
  const live = (buchungen || []).filter((t) => t && !t.voided && !t.isReversal);
  if (live.length) return Math.max(0, live.filter((t) => !t.paidDate).reduce((n, t) => n + (Number(t.gross) || 0), 0));
  if (r?.bezahltAm) return 0;
  return Math.max(0, berechnen(r).zahlbetrag);
}

/** Die gültigen (nicht verworfenen) Mahnungen einer Rechnung, älteste zuerst. */
export function mahnverlauf(mahnungen, rechnungId) {
  return (mahnungen || [])
    .filter((m) => m && m.invoiceId === rechnungId && !m.verworfen)
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || a.stufe - b.stufe || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Kann und soll diese Rechnung gemahnt werden, und mit welcher Stufe?
 *
 * Nicht gemahnt werden Entwürfe, Gutschriften, Storno- und Korrekturrechnungen,
 * stornierte und bezahlte Rechnungen, außerdem erhaltene (Eingang) und noch
 * nicht fällige. Bei Teilzahlung ist der offene Rest maßgeblich.
 *
 * @returns {{mahnbar:boolean, grund:string, rest:number, faellig:string, tageUeber:number,
 *   letzte:object|null, vorschlag:number, alleDurch:boolean, fristLaeuft:boolean, fristBis:string}}
 */
export function mahnbarkeit(r, { buchungen = [], mahnungen = [], heute = todayISO() } = {}) {
  const verlauf = mahnverlauf(mahnungen, r?.id);
  const letzte = verlauf.length ? verlauf.reduce((a, m) => (m.stufe >= a.stufe ? m : a)) : null;
  const faellig = r ? faelligkeit(r) : '';
  const rest = r ? rechnungsRest(r, buchungen) : 0;
  const tageUeber = faellig ? Math.max(0, daysBetween(faellig, heute)) : 0;
  const aus = (grund) => ({
    mahnbar: false, grund, rest, faellig, tageUeber, letzte, vorschlag: 0, alleDurch: false, fristLaeuft: false, fristBis: '',
  });
  if (!r || r.richtung === 'eingang') return aus('Nur eigene Rechnungen werden gemahnt.');
  if (r.status !== 'ausgestellt') return aus('Ein Entwurf wird nicht gemahnt.');
  if (String(r.art) === '381') return aus('Eine Gutschrift wird nicht gemahnt.');
  if (r.storno || String(r.art) === '384') return aus('Eine Stornorechnung wird nicht gemahnt.');
  const z = zustand(r, { buchungen, heute });
  if (z === 'storniert') return aus('Die Rechnung ist storniert.');
  if (z === 'bezahlt' || rest <= 0) return aus('Die Rechnung ist bezahlt.');
  if (r.zahlungsart === 'bar') return aus('Eine Barzahlung wird nicht gemahnt.');
  if (!faellig || faellig >= heute) return aus(faellig ? `Noch nicht fällig (fällig am ${d8(faellig)}).` : 'Es ist keine Fälligkeit angegeben.');
  const vorschlag = Math.min(3, (letzte?.stufe || 0) + 1);
  const fristBis = letzte?.frist || '';
  return {
    mahnbar: true, grund: '', rest, faellig, tageUeber, letzte, vorschlag, alleDurch: (letzte?.stufe || 0) >= 3,
    fristLaeuft: !!fristBis && fristBis >= heute, fristBis,
  };
}

/* -------------------------------------------------------------------------- */
/* Verzugsaufschlag und Gesamtforderung                                        */
/* -------------------------------------------------------------------------- */

/**
 * Der Aufschlag nach Prozent: Betrag × Satz ÷ 100 × Tage ÷ 365, auf Cent
 * gerundet. Gezählt wird jeder Tag nach der Fälligkeit bis einschließlich des
 * Mahndatums.
 * @returns {{tage:number, aufschlag:number, von:string, bis:string}}
 */
export function prozentAufschlag(betrag, prozent, faellig, bis) {
  const tage = faellig && bis ? Math.max(0, daysBetween(faellig, bis)) : 0;
  const cent = Math.round(Number(betrag) || 0);
  const p = Number(prozent) || 0;
  return { tage, aufschlag: tage > 0 && p > 0 && cent > 0 ? rund((cent * p * tage) / 36500) : 0, von: tage > 0 ? addDays(faellig, 1) : '', bis: tage > 0 ? bis : '' };
}

/**
 * Bereits gebuchte Mahnkosten einer Rechnung und was davon noch aussteht.
 * `transaktionen`: alle Buchungen; gezählt werden die lebenden mit `mahnRechnungId`.
 */
export function mahnkostenStand(rechnungId, mahnungen, transaktionen) {
  const verlauf = mahnverlauf(mahnungen, rechnungId);
  const letzte = verlauf.length ? verlauf.reduce((a, m) => (m.stufe >= a.stufe ? m : a)) : null;
  const gesamt = letzte ? Number(letzte.nebenGesamt) || 0 : 0;
  const bezahlt = (transaktionen || [])
    .filter((t) => t && t.mahnRechnungId === rechnungId && !t.voided && !t.isReversal && t.paidDate)
    .reduce((n, t) => n + (Number(t.gross) || 0), 0);
  return { gesamt, bezahlt, offen: Math.max(0, gesamt - bezahlt), letzte };
}

/**
 * Rechnet ein Mahnschreiben.
 *
 * @param {{r:object, buchungen?:object[], mahnungen?:object[], stufe:number, datum?:string,
 *   einstellungen?:object, frist?:string, gebuehr?:number, prozent?:boolean, pauschale?:boolean,
 *   bezahlteMahnkosten?:number}} p
 *   gebuehr: Cent, überschreibt die Vorgabe der Stufe (0 erlaubt)
 *   prozent / pauschale: schalten den jeweiligen Teil des Verzugsaufschlags ein oder aus; ohne Angabe
 *   gilt die Einstellung (Art und „ab Stufe“)
 * @returns {object} alle Beträge in Cent
 */
export function mahnungBerechnen({
  r, buchungen = [], mahnungen = [], stufe, datum = todayISO(), einstellungen = null, frist = '', gebuehr = null,
  prozent = null, pauschale = null, bezahlteMahnkosten = 0,
}) {
  const e = einstellungen || mahneinstellungen({});
  const st = [1, 2, 3].includes(Number(stufe)) ? Number(stufe) : 1;
  const rest = rechnungsRest(r, buchungen);
  const faellig = faelligkeit(r);
  const frueher = mahnverlauf(mahnungen, r.id);

  const gebuehrFrueher = frueher.reduce((n, m) => n + (Number(m.gebuehr) || 0), 0);
  const gebuehrNeu = Math.round(zahl(gebuehr, 0, 100000000, e.gebuehren[st]));

  const art = e.aufschlag.art;
  const ab = st >= e.aufschlag.abStufe;
  const prozentAn = prozent === null || prozent === undefined ? (art === 'prozent' || art === 'beides') && ab : !!prozent;
  const pauschaleAn = pauschale === null || pauschale === undefined ? (art === 'pauschale' || art === 'beides') && ab : !!pauschale;
  const satz = e.aufschlag.prozent;
  const pz = prozentAn ? prozentAufschlag(rest, satz, faellig, datum) : { tage: 0, aufschlag: 0, von: '', bis: '' };

  // Die Pauschale gibt es höchstens einmal je Rechnung: Wer sie schon berechnet hat, behält sie in der Forderung.
  const pauschaleFrueher = frueher.reduce((n, m) => Math.max(n, Number(m.aufschlag?.pauschale) || 0), 0);
  const pauschaleBetrag = pauschaleFrueher > 0 ? pauschaleFrueher : (pauschaleAn ? e.aufschlag.pauschale : 0);
  const pauschaleNeu = pauschaleFrueher === 0 && pauschaleBetrag > 0;

  const nebenGesamt = gebuehrFrueher + gebuehrNeu + pz.aufschlag + pauschaleBetrag;
  const bezahlt = Math.max(0, Math.round(Number(bezahlteMahnkosten) || 0));
  const nebenOffen = Math.max(0, nebenGesamt - bezahlt);
  const fristNeu = frist || addDays(datum, e.fristen[st]);

  const warnungen = [];
  if (prozentAn && satz <= 0) warnungen.push('Für den Verzugsaufschlag in Prozent ist kein Satz eingestellt.');
  if (prozentAn && satz > 0 && pz.tage > 0 && pz.aufschlag === 0) warnungen.push('Der Verzugsaufschlag in Prozent ist so klein, dass er auf null Cent rundet.');
  if (fristNeu <= datum) warnungen.push('Die Zahlungsfrist liegt nicht nach dem Datum des Schreibens.');
  if (rest <= 0) warnungen.push('Es ist nichts mehr offen.');

  return {
    stufe: st, datum, frist: fristNeu, rest, faellig,
    gebuehrFrueher, gebuehr: gebuehrNeu,
    aufschlag: {
      prozentAn, satz: prozentAn ? satz : 0, tage: pz.tage, von: pz.von, bis: pz.bis, basis: rest, zins: pz.aufschlag,
      pauschaleAn: pauschaleBetrag > 0, pauschale: pauschaleBetrag, pauschaleNeu,
    },
    nebenGesamt, nebenBezahlt: bezahlt, nebenOffen,
    gesamt: rest + nebenOffen,
    warnungen,
  };
}

/* -------------------------------------------------------------------------- */
/* Schreiben                                                                   */
/* -------------------------------------------------------------------------- */

/** Standardtexte je Stufe; {frist} und {betrag} werden eingesetzt. */
export const MAHNTEXTE = {
  1: {
    kopf: 'Sehr geehrte Damen und Herren,\n\nbei der Durchsicht unserer Buchhaltung ist uns aufgefallen, dass die unten genannte Rechnung noch nicht bezahlt ist. Vielleicht ist die Zahlung nur untergegangen. Wir bitten Sie, {betrag} bis zum {frist} zu überweisen.',
    schluss: 'Sollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\nMit freundlichen Grüßen',
  },
  2: {
    kopf: 'Sehr geehrte Damen und Herren,\n\nden Betrag der unten genannten Rechnung haben wir trotz Fälligkeit bisher nicht erhalten. Wir bitten Sie, {betrag} bis zum {frist} zu überweisen.',
    schluss: 'Sollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\nMit freundlichen Grüßen',
  },
  3: {
    kopf: 'Sehr geehrte Damen und Herren,\n\nunsere bisherigen Schreiben blieben ohne Zahlung. Wir setzen Ihnen deshalb eine letzte Frist: Bitte überweisen Sie {betrag} bis zum {frist}.',
    schluss: 'Nach Ablauf der Frist behalten wir uns vor, die Forderung gerichtlich geltend zu machen. Dadurch entstehen Ihnen weitere Kosten.\nSollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\nMit freundlichen Grüßen',
  },
};

const einsetzen = (text, werte) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in werte ? werte[k] : m));

/**
 * Die Daten des Schreibens für die Seitensetzung (lib/rechnungsdruck.js, Feld
 * `mahnung` der Rechnung).
 * @param {object} r Rechnung
 * @param {object} b Ergebnis von mahnungBerechnen
 * @param {{kopf?:string, schluss?:string}} [texte] eigene Texte statt der Standardtexte
 */
export function mahnschreiben(r, b, texte = {}) {
  const st = MAHNSTUFEN[b.stufe];
  const w = r.waehrung || 'EUR';
  const brutto = berechnen(r).brutto;
  const zeilen = [];
  zeilen.push({ label: `Rechnung ${r.nummer} vom ${d8(r.datum)}, fällig am ${d8(b.faellig)}`, wert: brutto });
  if (brutto > b.rest) zeilen.push({ label: 'abzüglich bereits gezahlt', wert: -(brutto - b.rest), grau: true });
  if (b.gebuehrFrueher > 0 || b.gebuehr > 0 || b.aufschlag.zins > 0 || b.aufschlag.pauschale > 0 || b.nebenBezahlt > 0) {
    zeilen.push({ label: 'Offener Rechnungsbetrag', wert: b.rest, fett: false, linie: false });
  }
  if (b.gebuehrFrueher > 0) zeilen.push({ label: 'Mahngebühren früherer Schreiben', wert: b.gebuehrFrueher });
  if (b.gebuehr > 0) zeilen.push({ label: `Mahngebühr (${st.kurz})`, wert: b.gebuehr });
  if (b.aufschlag.zins > 0) {
    zeilen.push({
      label: `Verzugsaufschlag: ${satzText(b.aufschlag.satz)} % pro Jahr auf ${betragText(b.aufschlag.basis, w)} vom ${d8(b.aufschlag.von)} bis ${d8(b.aufschlag.bis)} (${tageText(b.aufschlag.tage)})`,
      wert: b.aufschlag.zins,
    });
  }
  if (b.aufschlag.pauschale > 0) {
    zeilen.push({ label: b.aufschlag.pauschaleNeu ? 'Verzugsaufschlag (Pauschale)' : 'Verzugsaufschlag (Pauschale, bereits früher berechnet)', wert: b.aufschlag.pauschale });
  }
  if (b.nebenBezahlt > 0) zeilen.push({ label: 'abzüglich bereits gezahlter Mahnkosten', wert: -b.nebenBezahlt, grau: true });
  zeilen.push({ label: `Zu zahlen bis ${d8(b.frist)}`, wert: b.gesamt, fett: true, linie: true });

  const werte = { frist: d8(b.frist), betrag: `den Gesamtbetrag von ${betragText(b.gesamt, w)}` };
  const standard = MAHNTEXTE[b.stufe];
  return {
    stufe: b.stufe,
    titel: st.titel,
    dateiname: st.dateiname,
    betreff: `Rechnung ${r.nummer} vom ${d8(r.datum)}`,
    datum: b.datum,
    frist: b.frist,
    kopftext: einsetzen(texte.kopf ?? standard.kopf, werte),
    schlusstext: einsetzen(texte.schluss ?? standard.schluss, werte),
    gesamt: b.gesamt,
    zeilen,
  };
}

/** Kurzfassung für Liste und Verlauf: „Zahlungserinnerung vom 04.10.2026, Gebühr 5,00 €, Aufschlag 1,20 €“. */
export function mahnungKurz(m) {
  const teile = [`${stufenName(m.stufe)} vom ${d8(m.datum)}`];
  if (Number(m.gebuehr) > 0) teile.push(`Gebühr ${betragText(m.gebuehr)}`);
  const auf = (Number(m.aufschlag?.zins) || 0) + (m.aufschlag?.pauschaleNeu ? Number(m.aufschlag?.pauschale) || 0 : 0);
  if (auf > 0) teile.push(`Aufschlag ${betragText(auf)}`);
  return teile.join(', ');
}
