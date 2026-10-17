/**
 * Kontovia – besondere Steuerfälle einer Buchung (seit 2.41).
 *
 * Rein rechnend, ohne Oberfläche (Prüfung rechenkern). Jede Funktion liefert
 * Beträge in Cent; die Buchung bleibt eine gewöhnliche Buchung mit
 * gross = net + vat, damit Übersicht, Konten und Exporte nichts Neues lernen
 * müssen. Nur die Voranmeldung (calc.js: vatReturn), die Anlage EÜR
 * (calc.js: euerReport) und die OSS-Meldung (ossMeldung) lesen die Felder.
 *
 *  - OSS (One-Stop-Shop, § 18j UStG): Verkäufe an Privatkunden in anderen
 *    EU-Ländern mit dem Steuersatz des Ziellandes. `vatTreatment: 'oss'`,
 *    `oss: {land}`, `vatRate` = Satz des Landes. Fehlt in der deutschen
 *    Voranmeldung, steht in der OSS-Meldung je Land und Satz.
 *  - Differenzbesteuerung (§ 25a UStG, Gebrauchtwaren, Einzeldifferenz):
 *    `vatTreatment: 'differenz'`, `einkauf` (Cent). Umsatzsteuer nur auf den
 *    Gewinn (Verkauf − Einkauf), immer mit 19 %, enthalten im Preis.
 *  - Mehrzweckgutschein (§ 3 Abs. 15 UStG): Der Verkauf ist nicht steuerbar
 *    (`gutschein-mehrzweck`), die Steuer entsteht erst bei der Einlösung
 *    (`gutschein-einloesung`, `gutscheinWert`). Die Einlösung bringt kein
 *    Geld: gross 0, net = −vat. In der EÜR wandert der Wert aus der Zeile der
 *    steuerfreien Einnahmen in die steuerpflichtigen, die Summe bleibt.
 *    Einzweckgutscheine sind gewöhnliche Verkäufe mit Umsatzsteuer.
 *  - Private Nutzung des Firmenwagens (1-%-Regel, § 6 Abs. 1 Nr. 4 EStG):
 *    `privatnutzung: {listenpreis, prozent, ustBasis}`. Gewinn: Prozent des auf
 *    volle 100 € abgerundeten Bruttolistenpreises je Monat; Umsatzsteuer:
 *    80 % von 1 % (auch bei Elektro- und Hybridautos), 19 %.
 *  - Fahrt mit dem eigenen Auto (Kilometerpauschale, § 9 Abs. 1 Nr. 4a EStG
 *    i. V. m. BRKG): `fahrt: {km, satz}`, ohne Umsatzsteuer, EÜR-Zeile 71.
 */

/**
 * Umsatzsteuersätze der EU-Länder ohne Deutschland, erster Wert = Regelsatz.
 * Stand 16.10.2026 (Europäische Kommission, Datenbank „Taxes in Europe“).
 * Sätze ändern sich; in der Oberfläche steht deshalb „bitte prüfen“.
 */
export const EU_SAETZE = {
  AT: [20, 13, 10], BE: [21, 12, 6], BG: [20, 9], CY: [19, 9, 5, 3], CZ: [21, 12], DK: [25],
  EE: [24, 13, 9], ES: [21, 10, 4], FI: [25.5, 14, 13.5, 10], FR: [20, 10, 5.5, 2.1], GR: [24, 13, 6],
  HR: [25, 13, 5], HU: [27, 18, 5], IE: [23, 13.5, 9, 4.8], IT: [22, 10, 5, 4], LT: [21, 9, 5],
  LU: [17, 14, 8, 3], LV: [21, 12, 5], MT: [18, 7, 5], NL: [21, 9], PL: [23, 8, 5], PT: [23, 13, 6],
  RO: [21, 11], SE: [25, 12, 6], SI: [22, 9.5, 5], SK: [23, 19, 5],
};

/** Lieferschwelle für Verkäufe an Privatkunden in der EU (§ 3c Abs. 4 UStG), netto im Jahr. */
export const OSS_SCHWELLE = 1000000;

/** Sätze, die für ein Zielland in Frage kommen (leer, wenn das Land nicht in der Liste steht). */
export const ossSaetze = (land) => EU_SAETZE[String(land || '').toUpperCase()] || [];

/** Der Regelsatz eines EU-Landes, sonst null. */
export const ossRegelsatz = (land) => ossSaetze(land)[0] ?? null;

/** Ist das ein Land für den OSS (EU, nicht Deutschland)? */
export const ossLand = (land) => ossSaetze(land).length > 0;

/**
 * Art eines OSS-Umsatzes (`tx.oss.art`, `r.ossArt`): Die Meldung trennt Dienstleistungen von Warenlieferungen.
 * Ohne Angabe (Buchungen vor 2.43) zählt ein Umsatz als Warenlieferung.
 */
export const OSS_ARTEN = { ware: 'Warenlieferung', dienst: 'Dienstleistung' };
export const ossArt = (a) => (a === 'dienst' ? 'dienst' : 'ware');

/**
 * Die OSS-Meldung als Datei für den Upload im BZSt-Online-Portal (Steuererklärung OSS-EU, Version 2.0):
 * erste Zeile `#v2.0`, Satzart 1 je Land, Satzart 2 Dienstleistungen, Satzart 3 Warenlieferungen vom Inland aus,
 * je Land, Steuertyp (STANDARD = Regelsatz, sonst REDUCED) und Satz; Komma als Trenner, Punkt als Dezimalzeichen,
 * UTF-8, höchstens 6000 Zeilen. Null und negative Summen nimmt das Portal nicht an: Solche Zeilen fehlen in der
 * Datei und stehen in `fehler` (eine Gutschrift größer als die Verkäufe gehört als Berichtigung ins Portal).
 * Griechenland heißt dort EL statt GR.
 * @param {{zeilen:Array<{land:string, art?:string, satz:number, netto:number, steuer:number}>}} meldung  calc.js: ossMeldung
 * @returns {{text:string, zeilen:number, fehler:string[]}}
 */
export function ossDatei(meldung) {
  const code = (land) => (land === 'GR' ? 'EL' : land);
  const betrag = (cent) => (Math.round(cent) / 100).toFixed(2);
  const fehler = [];
  const posten = [];
  for (const z of meldung?.zeilen || []) {
    if (z.netto <= 0 || z.steuer <= 0) { fehler.push(`${code(z.land)} ${z.satz} %: Summe nicht positiv`); continue; }
    const typ = Number(z.satz) === ossRegelsatz(z.land) ? 'STANDARD' : 'REDUCED';
    posten.push([ossArt(z.art) === 'dienst' ? 2 : 3, code(z.land), typ, Number(z.satz).toFixed(2), betrag(z.netto), betrag(z.steuer)].join(','));
  }
  const laender = [...new Set(posten.map((p) => p.split(',')[1]))].sort();
  const zeilen = [...laender.map((l) => `1,${l}`), ...posten.sort()];
  if (zeilen.length > 6000) fehler.push('Mehr als 6000 Zeilen');
  return { text: `#v2.0\n${zeilen.join('\n')}\n`, zeilen: zeilen.length, fehler };
}

/** Netto und Steuer aus einem Bruttobetrag und einem (auch krummen) Satz. */
export function ausBrutto(gross, satz) {
  const g = Math.round(Number(gross) || 0);
  const net = Math.round(g / (1 + (Number(satz) || 0) / 100));
  return { gross: g, net, vat: g - net };
}

/* -------------------------------------------------------------------------- */
/* Differenzbesteuerung                                                        */
/* -------------------------------------------------------------------------- */

/** Satz der Differenzbesteuerung: immer der Regelsatz (§ 25a Abs. 5 UStG), auch bei Büchern oder Lebensmitteln. */
export const DIFFERENZ_SATZ = 19;

/**
 * Steuer auf den Gewinn eines Gebrauchtwarenverkaufs (Einzeldifferenz).
 * Ein Verlust ergibt keine Steuer, wird aber auch nicht verrechnet (§ 25a Abs. 3 UStG).
 * @returns {{gross:number, net:number, vat:number, marge:number}} net = gross − vat (für die EÜR)
 */
export function differenzSteuer(gross, einkauf) {
  const g = Math.round(Number(gross) || 0);
  const vz = g < 0 ? -1 : 1;
  const marge = vz * Math.max(0, Math.abs(g) - Math.max(0, Math.round(Number(einkauf) || 0)));
  const vat = Math.round((marge * DIFFERENZ_SATZ) / (100 + DIFFERENZ_SATZ));
  return { gross: g, net: g - vat, vat, marge };
}

/** Bemessungsgrundlage einer differenzbesteuerten Buchung für die Voranmeldung (Kennzahl 81). */
export function differenzBasis(tx) {
  const { marge, vat } = differenzSteuer(tx.gross, tx.einkauf);
  return marge - vat;
}

/* -------------------------------------------------------------------------- */
/* Mehrzweckgutschein                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Einlösung eines Mehrzweckgutscheins im Wert `wert` (brutto) zum Satz `satz`.
 * Gebucht wird nur die Steuer: kein Geldfluss, Gewinn unverändert.
 */
export function gutscheinEinloesung(wert, satz) {
  const w = Math.round(Number(wert) || 0);
  const vat = w - Math.round(w / (1 + (Number(satz) || 0) / 100));
  return { gross: 0, net: -vat, vat, wert: w };
}

/* -------------------------------------------------------------------------- */
/* Private Nutzung des Firmenwagens                                            */
/* -------------------------------------------------------------------------- */

/**
 * Prozent je Monat nach Antrieb (§ 6 Abs. 1 Nr. 4 Satz 2 EStG). Die Preisgrenze
 * für 0,25 % hängt vom Kauf ab: 60.000 € bis 2023, 70.000 € ab 2024,
 * 100.000 € ab Juli 2025.
 */
export const KFZ_ANTRIEB = {
  verbrenner: [1, 'Verbrenner (1 %)'],
  hybrid: [0.5, 'Plug-in-Hybrid (0,5 %)'],
  elektro: [0.25, 'Elektroauto unter der Preisgrenze (0,25 %)'],
  elektroTeuer: [0.5, 'Elektroauto über der Preisgrenze (0,5 %)'],
};

/**
 * Monatlicher Wert der privaten Nutzung nach der 1-%-Regel.
 * @param {number} listenpreis  Bruttolistenpreis in Cent (wird auf volle 100 € abgerundet)
 * @param {string} antrieb      Schlüssel aus KFZ_ANTRIEB
 * @returns {{gross:number, net:number, vat:number, ustBasis:number, listenpreis:number, prozent:number}}
 */
export function privatnutzung(listenpreis, antrieb = 'verbrenner') {
  const lp = Math.floor(Math.max(0, Number(listenpreis) || 0) / 10000) * 10000;
  const prozent = (KFZ_ANTRIEB[antrieb] || KFZ_ANTRIEB.verbrenner)[0];
  const net = Math.round((lp * prozent) / 100);
  // Für die Umsatzsteuer gilt immer 1 % des vollen Listenpreises, davon 80 % (ohne Kosten ohne Vorsteuer).
  const ustBasis = Math.round((lp * 0.8) / 100);
  const vat = Math.round((ustBasis * 19) / 100);
  return { gross: net + vat, net, vat, ustBasis, listenpreis: lp, prozent };
}

/* -------------------------------------------------------------------------- */
/* Fahrt mit dem eigenen Auto                                                  */
/* -------------------------------------------------------------------------- */

/** Kilometerpauschale für Dienstfahrten mit einem privaten Auto: 0,30 € je km. */
export const KM_SATZ = 30;

/** EÜR-Zeile für Fahrten mit Fahrzeugen, die nicht zum Betrieb gehören (Vordruck 2025). */
export const FAHRT_ZEILE = 71;

/** Betrag einer Fahrt: Kilometer × Satz (Cent je km), ohne Umsatzsteuer. */
export function fahrtBetrag(km, satz = KM_SATZ) {
  const k = Math.max(0, Number(km) || 0);
  const gross = Math.round(k * (Number(satz) || KM_SATZ));
  return { gross, net: gross, vat: 0, km: k, satz: Number(satz) || KM_SATZ };
}

/* -------------------------------------------------------------------------- */
/* Auswertung                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Buchungen ohne Geldfluss: Gutscheineinlösung, private Kfz-Nutzung (Entnahme)
 * und Fahrten mit dem eigenen Auto (Einlage). Sie brauchen kein Zahlungskonto
 * und gelten am Tag der Buchung als bezahlt.
 */
export const ohneGeldfluss = (tx) => tx?.vatTreatment === 'gutschein-einloesung' || !!tx?.privatnutzung || !!tx?.fahrt;

/**
 * Bemessungsgrundlage einer Einnahme für die Voranmeldung, wenn sie vom Netto
 * abweicht; sonst null (dann gilt tx.net).
 */
export function sonderBasis(tx, behandlung) {
  if (behandlung === 'differenz') return differenzBasis(tx);
  if (behandlung === 'gutschein-einloesung') return (Number(tx.gutscheinWert) || 0) - (Number(tx.vat) || 0);
  if (tx.privatnutzung) return Number(tx.privatnutzung.ustBasis) || 0;
  return null;
}
