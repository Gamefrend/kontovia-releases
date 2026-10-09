/**
 * Kontovia – wiederkehrende Rechnungen.
 *
 * Wer jeden Monat dieselbe Rechnung schreibt (Wartung, Hosting, Miete,
 * Betreuung), stellt sie einmal aus und wählt „Rechnung wiederholen“. Aus der
 * ausgestellten Rechnung wird eine Regel (Sammlung `recurring`, `art:
 * 'rechnung'`). Ist ein Termin erreicht, bietet Kontovia ihn an wie eine
 * wiederkehrende Buchung (lib/wiederkehrend.js, views/wiederkehrend.js) und
 * legt einen **Entwurf** an, keine fertige Rechnung: Datum und Nummer folgen
 * erst beim Ausstellen, Beträge lassen sich vorher anpassen, und eine
 * ausgestellte Rechnung ist nach GoBD unveränderlich. Der Entwurf ist wie jeder
 * andere: prüfen, ausstellen, versenden.
 *
 * Bei Rechnungen über einen Zeitraum rückt der Leistungszeitraum mit: Er reicht
 * vom Termin bis zum Tag vor dem nächsten.
 *
 * Die Kennung des Entwurfs folgt aus Regel und Datum, wie bei Buchungen: Zwei
 * abgeglichene Geräte legen denselben Entwurf an, kein Doppel.
 */

import { uid, addDays } from './util.js';
import { berechnen, neueRechnung } from './rechnung.js';
import { TURNUS, vorkommen, rechnungsId } from './wiederkehrend.js';

/** Felder der Rechnung, die in die Regel wandern: alles, was sich beim nächsten Mal wiederholt. */
const RECHNUNG_FELDER = ['art', 'sprache', 'steuerfall', 'befreiungsgrund', 'kaeufer', 'betreff', 'bestellnummer', 'kopftext', 'schlusstext',
  'zahlungsart', 'zahlungsbedingungen', 'skontoTage', 'skontoProzent', 'zahlungszielTage', 'leistungArt', 'waehrung', 'hinweisAufbewahrung',
  'bilder', 'raten'];

/**
 * Legt aus einer ausgestellten Rechnung die Regel an; die Rechnung selbst ist das erste Vorkommen.
 * @param {object} r  die Rechnung
 * @param {{freq:string, bis?:string, anzahl?:number}} wdh  Wahl aus dem Editor
 * @param {{id:string}} opts
 */
export function regelAusRechnung(r, wdh, { id }) {
  const daten = {};
  for (const f of RECHNUNG_FELDER) if (r[f] !== undefined && r[f] !== null) daten[f] = structuredClone(r[f]);
  daten.positionen = (r.positionen || []).map((p) => ({ ...structuredClone(p), id: uid('pos') }));
  const brutto = berechnen(r).brutto;
  return {
    id,
    art: 'rechnung',
    active: true,
    freq: TURNUS[wdh.freq] ? wdh.freq : 'monthly',
    start: r.datum,
    n: 1,
    until: wdh.bis || '',
    anzahl: Math.max(0, Math.round(Number(wdh.anzahl) || 0)),
    paid: false,
    // Die Liste der Regeln zeigt Name und Betrag aus der Vorlage; gebucht wird nichts davon.
    template: {
      type: 'income',
      description: `${r.betreff || r.kaeufer?.name || 'Rechnung'}`.slice(0, 120),
      gross: brutto,
      categoryId: '',
    },
    rechnung: daten,
    createdAt: new Date().toISOString(),
  };
}

/** Der Rechnungsentwurf zum Vorkommen `index` einer Rechnungsregel. */
export function rechnungAusRegel(regel, datum, index, settings = {}) {
  const daten = structuredClone(regel.rechnung || {});
  const vorgabe = {
    ...daten,
    id: rechnungsId(regel, datum),
    status: 'entwurf',
    nummer: '',
    datum,
    faellig: '',
    bereitsGezahlt: 0,
    leistungsdatum: datum,
    positionen: (daten.positionen || []).map((p) => ({ ...p, id: uid('pos') })),
    wiederkehrendId: regel.id,
    // Fest aus dem Datum: Zwei Geräte erzeugen denselben Entwurf gleich.
    createdAt: `${datum}T00:00:00.000Z`,
  };
  if (daten.leistungArt === 'zeitraum') {
    vorgabe.leistungVon = datum;
    vorgabe.leistungBis = addDays(vorkommen(regel, index + 1), -1);
  }
  return neueRechnung(settings, vorgabe);
}
