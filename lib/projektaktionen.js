/**
 * Kontovia – was mit Projekten und Zeiten geschieht: anlegen, ändern, löschen, Stoppuhr, abrechnen.
 *
 * Jede Änderung geht durch commit() (lib/store.js), Journal `projekt.*` und `zeit.*`. Abrechnen legt einen
 * Rechnungsentwurf mit den offenen Zeiten als Positionen an (lib/projekte.js: zeitenAlsPositionen) und hängt die
 * Zeiten an diesen Entwurf; erst mit dem Ausstellen der Rechnung gelten sie als abgerechnet. Ein Projekt mit
 * Zeiten, Buchungen, Rechnungen oder Angeboten lässt sich nur abschließen, nicht löschen (die Auswertung bliebe
 * sonst ohne Namen). `projektZuordnen` hängt eine Rechnung, ein Angebot oder eine Buchung nachträglich an ein
 * Projekt (Journal `projekt.zuordnen`) und gibt die Zuordnung an alles weiter, was daraus entstanden ist und noch
 * keinem anderen Projekt gehört; `projektAusAngebot` legt aus einem Angebot ein Projekt an und ordnet es zu.
 */

import { fmtDate } from './util.js';
import { store, sel, commit, upsertEntity, deleteEntity } from './store.js';
import { neueZeit, minutenZwischen, offeneZeiten, zeitenAlsPositionen, projektAusBeleg } from './projekte.js';
import { neueRechnung, neuePosition, kaeuferAusKontakt, berechnen, titel as titelVon } from './rechnung.js';
import { rechnungSpeichern } from './rechnungsaktionen.js';

export const projektSpeichern = (p) => upsertEntity('projekte', p, 'projekt');

export async function projektLoeschen(id) {
  const benutzt = sel.zeiten().some((z) => z.projektId === id) || sel.transactions().some((t) => t.projektId === id)
    || sel.invoices().some((r) => r.projektId === id) || sel.angebote().some((b) => b.projektId === id);
  if (benutzt) throw new Error('Zu diesem Projekt gibt es Zeiten, Buchungen oder Belege. Schließen Sie es ab, dann bleibt die Auswertung erhalten.');
  await deleteEntity('projekte', id, 'projekt');
}

/**
 * Was eine Zuordnung mitnimmt. Rechnung: ihre Buchungen. Angebot, Auftragsbestätigung, Lieferschein: die Belege,
 * die daraus entstanden sind (Kette über `bezug`), die Rechnungen daraus (`ausBeleg`) und deren Buchungen.
 * @returns {{rechnungen:Set<string>, belege:Set<string>, buchungen:Set<string>}}
 */
export function zuordnungsKette(db, art, id) {
  const rechnungen = new Set();
  const belege = new Set();
  const buchungen = new Set();
  if (art === 'buchung') buchungen.add(id);
  if (art === 'beleg') {
    const offen = [id];
    while (offen.length) {
      const b = offen.pop();
      if (belege.has(b)) continue;
      belege.add(b);
      for (const x of db.angebote || []) if (x.bezug?.id === b) offen.push(x.id);
      for (const r of db.invoices || []) if (r.ausBeleg?.id === b) rechnungen.add(r.id);
    }
  }
  if (art === 'rechnung') rechnungen.add(id);
  for (const r of db.invoices || []) if (rechnungen.has(r.id)) for (const t of r.transactionIds || []) buchungen.add(t);
  return { rechnungen, belege, buchungen };
}

/**
 * Rechnung (`rechnung`), Angebot/Lieferschein (`beleg`) oder Buchung (`buchung`) einem Projekt zuordnen; leere
 * projektId löst die Zuordnung. Der Eintrag selbst bekommt immer die neue Zuordnung; was daraus entstanden ist, nur,
 * wenn es noch keinem oder demselben bisherigen Projekt gehörte. Ändert keine Beträge (auch festgeschrieben erlaubt).
 */
export async function projektZuordnen(art, id, projektId = '') {
  if (!['rechnung', 'beleg', 'buchung'].includes(art)) throw new Error('Unbekannte Art.');
  if (projektId && !sel.projekt(projektId)) throw new Error('Dieses Projekt gibt es nicht mehr.');
  const liste = { rechnung: 'invoices', beleg: 'angebote', buchung: 'transactions' }[art];
  const eintrag = (store.db[liste] || []).find((x) => x.id === id);
  if (!eintrag) throw new Error('Diesen Eintrag gibt es nicht mehr.');
  const vorher = eintrag.projektId || '';
  const kette = zuordnungsKette(store.db, art, id);
  const name = projektId ? sel.projekt(projektId).name : '';
  let anzahl = 0;
  await commit('projekt.zuordnen', (db) => {
    const jetzt = new Date().toISOString();
    const setzen = (x) => {
      if (!x || (x.id !== id && (x.projektId || '') !== vorher)) return;
      if ((x.projektId || '') === projektId) return;
      x.projektId = projektId;
      x.updatedAt = jetzt;
      anzahl += 1;
    };
    for (const r of db.invoices || []) if (kette.rechnungen.has(r.id)) setzen(r);
    for (const b of db.angebote || []) if (kette.belege.has(b.id)) setzen(b);
    for (const t of db.transactions || []) if (kette.buchungen.has(t.id)) setzen(t);
  }, { entity: 'projekt', entityId: projektId || vorher, summary: projektId ? `Zugeordnet: ${name}` : 'Zuordnung zum Projekt gelöst' });
  return anzahl;
}

/** Projekt aus einem Angebot (oder einer Auftragsbestätigung) anlegen und den Beleg samt Folgen zuordnen. */
export async function projektAusAngebot(belegId) {
  const b = sel.angebot(belegId);
  if (!b) throw new Error('Diesen Beleg gibt es nicht mehr.');
  const p = projektAusBeleg(b, { netto: berechnen(b).netto, titel: titelVon(b) });
  if (p.kontaktId && !sel.contact(p.kontaktId)) p.kontaktId = '';
  await projektSpeichern(p);
  await projektZuordnen('beleg', b.id, p.id);
  return p;
}

export async function zeitSpeichern(z) {
  const neu = !sel.zeiten().some((x) => x.id === z.id);
  z.updatedAt = new Date().toISOString();
  return commit(neu ? 'zeit.anlegen' : 'zeit.aendern', (db) => {
    const i = db.zeiten.findIndex((x) => x.id === z.id);
    if (i >= 0) db.zeiten[i] = z; else db.zeiten.push(z);
    return z;
  }, { entity: 'zeit', entityId: z.id, summary: `${z.datum} · ${z.minuten} Min.${z.person ? ` · ${z.person}` : ''} · ${z.beschreibung || ''}`.trim() });
}

export async function zeitLoeschen(id) {
  const z = sel.zeiten().find((x) => x.id === id);
  if (!z) return;
  if (z.rechnungId && sel.invoice(z.rechnungId)?.status === 'ausgestellt') throw new Error('Diese Zeit ist schon abgerechnet und bleibt deshalb erhalten.');
  await deleteEntity('zeiten', id, 'zeit');
}

/** Die laufende Stoppuhr (höchstens eine). */
export const laufendeZeit = () => sel.zeiten().find((z) => z.laeuft) || null;

/** Stoppuhr starten; eine schon laufende wird vorher angehalten. */
export async function stoppuhrStarten(projektId, beschreibung = '', person = '') {
  const alt = laufendeZeit();
  if (alt) await stoppuhrAnhalten(alt.id);
  const z = neueZeit(projektId, { start: new Date().toISOString(), laeuft: true, beschreibung, person: String(person || '').trim().slice(0, 80) });
  await commit('zeit.start', (db) => { db.zeiten.push(z); return z; }, { entity: 'zeit', entityId: z.id, summary: 'Stoppuhr gestartet' });
  return z;
}

/** Stoppuhr anhalten: aus dem Start werden Minuten (mindestens eine), das Datum ist der Tag des Starts. */
export async function stoppuhrAnhalten(id, jetzt = new Date().toISOString()) {
  const z = sel.zeiten().find((x) => x.id === id);
  if (!z || !z.laeuft) return null;
  const minuten = Math.max(1, minutenZwischen(z.start, jetzt));
  let fertig = null;
  await commit('zeit.stopp', (db) => {
    const x = db.zeiten.find((i) => i.id === id);
    if (!x) return;
    x.laeuft = false;
    x.minuten = minuten;
    x.datum = String(x.start || '').slice(0, 10) || x.datum;
    x.ende = jetzt;
    x.updatedAt = jetzt;
    fertig = x;
  }, { entity: 'zeit', entityId: id, summary: `Stoppuhr angehalten, ${minuten} Min.` });
  return fertig;
}

/**
 * Offene Zeiten eines Projekts als Rechnungsentwurf. Gibt den Entwurf zurück (gespeichert).
 * @param {{art?:'einzeln'|'tag'|'gesamt', zeitIds?:string[]}} opt  zeitIds: nur diese Zeiten
 */
export async function abrechnen(projektId, { art = 'tag', zeitIds = null } = {}) {
  const p = sel.projekt(projektId);
  if (!p) throw new Error('Dieses Projekt gibt es nicht mehr.');
  let zeiten = offeneZeiten(sel.zeiten().filter((z) => z.projektId === projektId), sel.invoices());
  if (zeitIds) zeiten = zeiten.filter((z) => zeitIds.includes(z.id));
  if (!zeiten.length) throw new Error('Es gibt keine offenen, abrechenbaren Zeiten.');
  const s = store.db.settings;
  const r = neueRechnung(s, { projektId, betreff: p.name });
  if (p.kontaktId && sel.contact(p.kontaktId)) r.kaeufer = kaeuferAusKontakt(sel.contact(p.kontaktId));
  r.positionen = zeitenAlsPositionen(zeiten, p, { art, fmtDate }).map((x) => neuePosition(s, x));
  const tage = zeiten.map((z) => z.datum).sort();
  if (tage[0] !== tage[tage.length - 1]) Object.assign(r, { leistungArt: 'zeitraum', leistungVon: tage[0], leistungBis: tage[tage.length - 1] });
  else r.leistungsdatum = tage[0];
  await rechnungSpeichern(r);
  const ids = new Set(zeiten.map((z) => z.id));
  await commit('zeit.abrechnen', (db) => {
    for (const z of db.zeiten) if (ids.has(z.id)) { z.rechnungId = r.id; z.updatedAt = new Date().toISOString(); }
  }, { entity: 'projekt', entityId: projektId, summary: `${ids.size} Zeiten in einen Rechnungsentwurf übernommen` });
  return r;
}

