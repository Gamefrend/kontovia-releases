/**
 * Kontovia – was mit einem Angebot, einer Auftragsbestätigung oder einem Lieferschein geschieht: speichern,
 * ausstellen, annehmen oder ablehnen, Folgebeleg oder Rechnung daraus machen, Versand vermerken.
 *
 * Ausstellen vergibt die Nummer im Kreis der Belegart (lib/angebote.js: naechsteNummer), friert Ihre Angaben und
 * die Gestaltung ein und legt das PDF unverändert im Tresor ab. Es entsteht keine Buchung und keine E-Rechnung.
 * Aus einem Beleg wird eine Rechnung als Entwurf, der wie jede Rechnung geprüft und ausgestellt wird.
 * Jede Änderung geht durch commit() (lib/store.js), Sammlung `angebote`, Journal `angebot.*`.
 */

import { todayISO } from './util.js';
import { store, commit, upsertEntity, deleteEntity } from './store.js';
import { BELEGARTEN, naechsteNummer, belegAusBeleg, rechnungAusBeleg } from './angebote.js';
import { verkaeuferAus, design as designAus, titel, berechnen } from './rechnung.js';
import { dateienErzeugen } from './rechnungsdateien.js';
import { pdfDateiname } from './rechnungsdruck.js';
import { base64 } from './pdfausgabe.js';
import { rechnungSpeichern } from './rechnungsaktionen.js';

const api = globalThis.window?.kontovia || {};

export const belege = () => store.db?.angebote || [];
export const beleg = (id) => belege().find((b) => b.id === id) || null;

/** Nummern aller anderen Belege (für die Doppelprüfung). */
export function vergebeneBelegNummern(ausser = '') {
  return new Set(belege().filter((b) => b.id !== ausser && b.nummer).map((b) => String(b.nummer).trim()));
}

export async function belegSpeichern(b) {
  b.updatedAt = new Date().toISOString();
  return upsertEntity('angebote', b, 'angebot');
}

export async function belegLoeschen(id) {
  const b = beleg(id);
  if (!b) return;
  if (b.status === 'ausgestellt') throw new Error('Ein ausgestellter Beleg bleibt erhalten. Ein Angebot lässt sich als abgelehnt markieren.');
  await deleteEntity('angebote', id, 'angebot');
}

/** Stellt den Beleg aus: Nummer, eingefrorene Angaben, PDF im Tresor. @returns {Promise<object>} */
export async function belegAusstellen(entwurf) {
  const s = store.db.settings;
  const b = structuredClone(entwurf);
  if (!b.datum) b.datum = todayISO();
  if (b.leistungArt !== 'zeitraum' && !b.leistungsdatum && b.belegart !== 'angebot') b.leistungsdatum = b.datum;
  if (!String(b.nummer || '').trim()) b.nummer = naechsteNummer(belege(), b.belegart, Number(b.datum.slice(0, 4)));
  b.nummer = String(b.nummer).trim();
  if (vergebeneBelegNummern(b.id).has(b.nummer)) throw new Error(`Die Nummer ${b.nummer} ist schon vergeben.`);
  b.positionen = b.positionen.filter((p) => String(p.name || '').trim() || String(p.beschreibung || '').trim() || Number(p.preis));
  b.verkaeufer = verkaeuferAus(s);
  b.gestaltung = designAus(s);
  const { pdf } = await dateienErzeugen(b, { v: b.verkaeufer, d: b.gestaltung });
  const meta = await api.attach.add(pdfDateiname(b), 'application/pdf', base64(pdf));
  b.dateien = { pdf: meta.id };
  b.status = 'ausgestellt';
  b.ausgestelltAm = new Date().toISOString();
  const kunde = b.kaeufer?.name || '';
  const summary = b.belegart === 'lieferschein'
    ? `${titel(b)} ${b.nummer} ausgestellt, ${kunde}`
    : `${titel(b)} ${b.nummer} ausgestellt, ${(berechnen(b).brutto / 100).toFixed(2)} €, ${kunde}`;
  await commit('angebot.ausstellen', (db) => {
    if (!db.attachments.some((a) => a.id === meta.id)) db.attachments.push(meta);
    b.updatedAt = new Date().toISOString();
    const i = db.angebote.findIndex((x) => x.id === b.id);
    if (i >= 0) db.angebote[i] = b; else db.angebote.push(b);
    // Die Quelle (etwa das Angebot) erfährt von ihrem Folgebeleg.
    const q = b.bezug?.id && db.angebote.find((x) => x.id === b.bezug.id);
    if (q) {
      q.folge = [...(q.folge || []).filter((f) => f.id !== b.id), { id: b.id, belegart: b.belegart, nummer: b.nummer }];
      if (q.belegart === 'angebot' && !q.ergebnis && b.belegart === 'auftrag') { q.ergebnis = 'angenommen'; q.ergebnisAm = b.datum; }
      q.updatedAt = b.updatedAt;
    }
    return b;
  }, { entity: 'angebot', entityId: b.id, summary });
  return b;
}

/** Angebot angenommen, abgelehnt oder wieder offen (''). */
export async function ergebnisSetzen(id, ergebnis, datum = todayISO()) {
  if (!['', 'angenommen', 'abgelehnt'].includes(ergebnis)) throw new Error('Unbekanntes Ergebnis.');
  const b = beleg(id);
  if (!b || b.belegart !== 'angebot' || b.status !== 'ausgestellt') throw new Error('Nur ein ausgestelltes Angebot lässt sich annehmen oder ablehnen.');
  await commit('angebot.ergebnis', (db) => {
    const x = db.angebote.find((i) => i.id === id);
    if (!x) return;
    x.ergebnis = ergebnis;
    x.ergebnisAm = ergebnis ? datum : '';
    x.updatedAt = new Date().toISOString();
  }, { entity: 'angebot', entityId: id, summary: ergebnis === 'angenommen' ? `${b.nummer} angenommen` : ergebnis === 'abgelehnt' ? `${b.nummer} abgelehnt` : `${b.nummer} wieder offen` });
}

export async function belegVersandVermerken(id, art = 'manuell', an = '') {
  await commit('angebot.versand', (db) => {
    const x = db.angebote.find((i) => i.id === id);
    if (!x) return;
    x.versand = [...(x.versand || []), { ts: new Date().toISOString(), art, an }];
    x.updatedAt = new Date().toISOString();
  }, { entity: 'angebot', entityId: id, summary: `Versand vermerkt (${art})` });
}

/** Folgebeleg als Entwurf anlegen und speichern (Angebot → Auftragsbestätigung → Lieferschein). */
export async function folgebelegAnlegen(quelleId, belegart) {
  const q = beleg(quelleId);
  if (!q) throw new Error('Diesen Beleg gibt es nicht mehr.');
  if (!BELEGARTEN[belegart]) throw new Error('Unbekannte Belegart.');
  const neu = belegAusBeleg(q, belegart, store.db.settings);
  await belegSpeichern(neu);
  return neu;
}

/** Rechnungsentwurf aus einem Beleg anlegen und speichern. */
export async function rechnungAnlegen(quelleId) {
  const q = beleg(quelleId);
  if (!q) throw new Error('Diesen Beleg gibt es nicht mehr.');
  const r = rechnungAusBeleg(q, store.db.settings);
  await rechnungSpeichern(r);
  return r;
}
