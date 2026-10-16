/**
 * Kontovia – ein Beleg mit mehreren Steuersätzen.
 *
 * Ein Kassenbon aus dem Supermarkt, die Rechnung eines Cafés oder der Einkauf beim Großhändler trägt oft
 * 7 % und 19 % nebeneinander. Die Auswertung rechnet pro Buchung mit einem Satz, deshalb wird der Beleg
 * in eine Buchung je Steuersatz zerlegt, wie es auch beim Ausstellen einer Rechnung geschieht
 * (`rechnungsaktionen.js: buchungenFuer`): gleiches Datum, gleiche Belegnummer, Kategorie, Kontakt, Konto,
 * Zahlungsdatum und derselbe Beleg an jeder Teilbuchung. Verbunden bleiben sie über `splitId`.
 *
 * Ohne Bezug zur Oberfläche, damit scripts/check.js sie prüfen kann.
 */

import { uid, splitFromGross, splitFromNet } from './util.js';

/** Die Sätze, die das Buchungsfenster anbietet. */
export const SAETZE = [19, 7, 0];

/** Höchstens so viele Steuersätze auf einem Beleg. */
export const MAX_SAETZE = SAETZE.length;

/**
 * Die weiteren Teile eines Belegs, bereinigt: nur bekannte Sätze, Betrag ungleich 0, jeder Satz einmal
 * (auch nicht der des ersten Teils).
 * @param {number} ersterSatz  Satz der Hauptbuchung
 * @param {Array<{satz:number|string, betrag:number}>} extras  `betrag` in Cent, brutto oder netto je nach Eingabeart
 */
export function weitereTeile(ersterSatz, extras) {
  const belegt = new Set([Number(ersterSatz)]);
  const out = [];
  for (const e of extras || []) {
    const satz = Number(e?.satz);
    const betrag = Math.abs(Math.round(Number(e?.betrag) || 0));
    if (!SAETZE.includes(satz) || !betrag || belegt.has(satz)) continue;
    belegt.add(satz);
    out.push({ satz, betrag });
  }
  return out;
}

/** Gibt es einen Satz, der zweimal vorkommt (Hauptbuchung eingeschlossen)? Zeilen ohne Betrag zählen nicht. */
export function doppelterSatz(ersterSatz, extras) {
  const gesehen = new Set([Number(ersterSatz)]);
  for (const e of extras || []) {
    if (!Math.abs(Math.round(Number(e?.betrag) || 0))) continue;
    const s = Number(e.satz);
    if (gesehen.has(s)) return s;
    gesehen.add(s);
  }
  return null;
}

/**
 * Zerlegt einen Beleg in eine Buchung je Steuersatz.
 * @param {object} tx  die Hauptbuchung (Entwurf, Betrag und Satz stehen schon in ihr)
 * @param {Array<{satz:number, betrag:number}>} extras  weitere Sätze mit ihrem Betrag in Cent
 * @param {{netto?:boolean}} opts  `netto`: die Beträge in `extras` sind Nettobeträge
 * @returns {object[]}  mindestens die Buchung selbst; die erste behält die Kennung
 */
export function satzBuchungen(tx, extras, { netto = false } = {}) {
  const teile = weitereTeile(tx.vatRate, extras);
  if (!teile.length) return [tx];
  const splitId = uid('sp');
  const n = teile.length + 1;
  const mitName = (t, satz, nr) => ({ ...t, description: `${tx.description} (${satz} %)`.slice(0, 200), splitId, splitTeil: nr, splitAnzahl: n });
  const erste = mitName(structuredClone(tx), Number(tx.vatRate) || 0, 1);
  return [erste, ...teile.map((t, i) => {
    const teil = netto ? splitFromNet(t.betrag * Math.sign(tx.gross || 1), t.satz) : splitFromGross(t.betrag * Math.sign(tx.gross || 1), t.satz);
    return mitName({
      ...structuredClone(tx),
      id: uid('tx'),
      vatRate: t.satz,
      gross: teil.gross,
      net: teil.net,
      vat: teil.vat,
      attachments: [...(tx.attachments || [])],
    }, t.satz, i + 2);
  })];
}

/** Summe über alle Teile für die Vorschau im Fenster. */
export function satzSumme(tx, extras, opts = {}) {
  const alle = satzBuchungen(tx, extras, opts);
  return { anzahl: alle.length, net: alle.reduce((s, t) => s + t.net, 0), vat: alle.reduce((s, t) => s + t.vat, 0), gross: alle.reduce((s, t) => s + t.gross, 0) };
}
