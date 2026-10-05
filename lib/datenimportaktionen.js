/**
 * Kontovia – Übernommene Daten in den Bestand schreiben.
 *
 * Die Vorschläge entstehen in lib/datenimport.js (Buchungen, Kontakte,
 * Produkte) und lib/elster.js (Meldungen). Hier wird nach der Bestätigung
 * gebucht: jede Buchung, jeder Kontakt und jedes Produkt mit eigenem
 * Journaleintrag (wie beim Erfassen von Hand), dazu am Ende ein Eintrag für
 * die Datei. Festgeschriebene Tage bleiben unberührt; was dort läge, steht
 * als Fehler im Ergebnis. Rollen prüft commit() wie überall.
 */

import { store, sel, commit, isLockedDate, tomb } from './store.js';
import { uid } from './util.js';

const jetzt = () => new Date().toISOString();
const dm = (iso) => String(iso).split('-').reverse().join('.');
const euro = (c) => `${(Math.abs(c) / 100).toFixed(2).replace('.', ',')} €`;

/**
 * Bucht die gewählten Vorschläge. Neue Kontakte entstehen nur, wenn eine
 * gewählte Buchung sie braucht.
 * @param {object[]} vorschlaege  aus datevZuBuchungen/tabelleZuBuchungen (nur die gewählten)
 * @param {{datei:string, quelle:string, neueKontakte?:object[], fortschritt?:Function}} opt
 */
export async function buchungenUebernehmen(vorschlaege, { datei, quelle, neueKontakte = [], fortschritt = null }) {
  const erg = { gebucht: 0, bezahlt: 0, kontakte: 0, fehler: [] };
  const offeneKontakte = new Map(neueKontakte.map((k) => [k.id, k]));
  const herkunft = `${quelle}-Import ${datei}`;
  let n = 0;
  for (const v of vorschlaege) {
    n++;
    try {
      if (v.art === 'zahlung' && v.bestandTxId) {
        const alt = sel.transaction(v.bestandTxId);
        if (!alt || alt.paidDate) throw new Error('Die Buchung ist inzwischen bezahlt oder gelöscht.');
        if (isLockedDate(v.datum)) throw new Error(`Der ${dm(v.datum)} ist festgeschrieben.`);
        await commit('buchung.aendern', (db) => {
          const t = db.transactions.find((x) => x.id === alt.id);
          t.paidDate = v.datum;
          if (v.geldkontoId) t.accountId = v.geldkontoId;
          t.updatedAt = jetzt();
          return t;
        }, { entity: 'buchung', entityId: alt.id, summary: `Bezahlt am ${dm(v.datum)}: ${alt.description}, ${euro(alt.gross)} (${herkunft})`.slice(0, 300) });
        erg.bezahlt++;
      } else if (v.art === 'buchung' && v.tx) {
        const tx = { ...v.tx, updatedAt: jetzt() };
        tx.createdAt ??= tx.updatedAt;
        if (isLockedDate(tx.date) || (tx.paidDate && isLockedDate(tx.paidDate))) throw new Error(`Der ${dm(isLockedDate(tx.date) ? tx.date : tx.paidDate)} ist festgeschrieben.`);
        if (store.db.transactions.some((t) => t.importHash && t.importHash === tx.importHash)) throw new Error('Diese Zeile wurde schon übernommen.');
        const kontakt = tx.contactId && offeneKontakte.get(tx.contactId);
        await commit('buchung.anlegen', (db) => {
          if (kontakt && !db.contacts.some((c) => c.id === kontakt.id)) {
            db.contacts.push({ ...kontakt, createdAt: jetzt(), updatedAt: jetzt() });
          }
          db.transactions.push(tx);
          return tx;
        }, {
          entity: 'buchung', entityId: tx.id,
          summary: `${tx.type === 'income' ? 'Einnahme' : 'Ausgabe'} ${tx.date} ${euro(tx.gross)}, ${tx.description} (${herkunft})`.slice(0, 300),
        });
        if (kontakt) { offeneKontakte.delete(kontakt.id); erg.kontakte++; }
        erg.gebucht++;
      }
    } catch (e) {
      erg.fehler.push({ nr: v.nr, text: `${dm(v.datum)} ${euro(v.betrag)} ${v.text || ''}`.trim(), grund: e.message });
      if (e.code === 'ROLLE') break;
    }
    if (fortschritt && (n % 25 === 0 || n === vorschlaege.length)) await fortschritt(n, vorschlaege.length);
  }
  if (erg.gebucht || erg.bezahlt) {
    await commit('import.datei', () => null, {
      entity: 'import', entityId: '',
      summary: `${herkunft}: ${erg.gebucht} Buchungen übernommen${erg.bezahlt ? `, ${erg.bezahlt} Zahlungen zugeordnet` : ''}${erg.kontakte ? `, ${erg.kontakte} Kontakte angelegt` : ''}${erg.fehler.length ? `, ${erg.fehler.length} nicht übernommen` : ''}`,
    });
  }
  return erg;
}

/** Legt Kontakte an; jeder bekommt seinen Journaleintrag. */
export async function kontakteUebernehmen(kontakte, { datei = '' } = {}) {
  let n = 0;
  for (const k of kontakte) {
    const c = { ...k, id: k.id || uid('con'), createdAt: jetzt(), updatedAt: jetzt() };
    await commit('kontakt.anlegen', (db) => { db.contacts.push(c); return c; }, { entity: 'kontakt', entityId: c.id, summary: `${c.name} (aus ${datei})`.slice(0, 300) });
    n++;
  }
  return n;
}

/** Legt Produkte an. */
export async function produkteUebernehmen(produkte, { datei = '' } = {}) {
  let n = 0;
  for (const p of produkte) {
    const x = { ...p, id: p.id || uid('prod'), createdAt: jetzt(), updatedAt: jetzt() };
    await commit('produkt.anlegen', (db) => { db.products.push(x); return x; }, { entity: 'produkt', entityId: x.id, summary: `${x.name} (aus ${datei})`.slice(0, 300) });
    n++;
  }
  return n;
}

/**
 * Speichert eingelesene ELSTER-Meldungen. Eine ältere Meldung für denselben
 * Zeitraum und dieselbe Steuernummer wird ersetzt; die jüngste Datei gilt.
 * @returns {{neu:number, ersetzt:number}}
 */
export async function meldungenSpeichern(meldungen, { datei = '' } = {}) {
  const erg = { neu: 0, ersetzt: 0 };
  for (const m of meldungen) {
    const alt = (store.db.elsterMeldungen || []).find((x) => x.art === m.art && x.jahr === m.jahr && x.zeitraum === m.zeitraum
      && (!x.steuernummer || !m.steuernummer || x.steuernummer === m.steuernummer));
    const rec = { ...m, id: alt?.id || uid('elm'), datei, eingelesen: jetzt(), createdAt: alt?.createdAt || jetzt(), updatedAt: jetzt() };
    await commit(alt ? 'elster.ersetzen' : 'elster.einlesen', (db) => {
      db.elsterMeldungen ??= [];
      const i = db.elsterMeldungen.findIndex((x) => x.id === rec.id);
      if (i >= 0) db.elsterMeldungen[i] = rec; else db.elsterMeldungen.push(rec);
      return rec;
    }, { entity: 'elster', entityId: rec.id, summary: `Umsatzsteuer-Voranmeldung ${m.jahr}/${m.zeitraum} aus ${datei}, Kennzahl 83: ${euro(m.werte.kz83 || 0)}${(m.werte.kz83 || 0) < 0 ? ' Überschuss' : ''}`.slice(0, 300) });
    if (alt) erg.ersetzt++; else erg.neu++;
  }
  return erg;
}

export async function meldungLoeschen(id) {
  return commit('elster.loeschen', (db) => {
    db.elsterMeldungen = (db.elsterMeldungen || []).filter((x) => x.id !== id);
    tomb(db, 'elsterMeldungen', id);
    return true;
  }, { entity: 'elster', entityId: id });
}
