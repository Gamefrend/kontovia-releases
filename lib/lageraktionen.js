/**
 * Kontovia – was mit dem Lager geschieht (SEC-66): Zugang erfassen (von Hand oder aus einer erhaltenen E-Rechnung),
 * Inventur zählen, eine Bewegung ändern oder löschen.
 *
 * Jede Änderung geht durch commit() (lib/store.js), Journal `lager.*`. Bei einer Änderung hält das Journal den alten
 * Inhalt fest (`vorher`), beim Löschen bleibt ein Grabstein. Im festgeschriebenen Zeitraum bleibt eine Bewegung, wie
 * sie ist. Abgänge entstehen nicht hier, sondern aus Rechnungen und Lieferscheinen. Rechnen: lib/lager.js.
 */

import { sel, commit, isLockedDate, tomb, store } from './store.js';
import { lagerBewegung, bewegungPruefen } from './lager.js';

const FELDER = ['produktId', 'datum', 'art', 'menge', 'einkauf', 'notiz'];
const gesperrt = 'Diese Lagerbewegung liegt im festgeschriebenen Zeitraum und bleibt, wie sie ist.';
const text = (b) => `${b.datum} · ${b.art === 'inventur' ? 'Inventur' : 'Zugang'} ${String(b.menge).replace('.', ',')} · ${sel.product(b.produktId)?.name || ''}`.trim();

/** Speichert eine Bewegung (neu oder geändert). Wirft bei fehlenden Angaben oder im festgeschriebenen Zeitraum. */
export async function bewegungSpeichern(eingabe) {
  const alt = sel.lager().find((x) => x.id === eingabe.id) || null;
  const b = lagerBewegung({ ...alt, ...eingabe, createdAt: alt?.createdAt });
  const fehler = bewegungPruefen(b, store.db);
  if (fehler.length) throw new Error(fehler[0]);
  if ((alt && isLockedDate(alt.datum)) || isLockedDate(b.datum)) throw Object.assign(new Error(gesperrt), { code: 'FESTGESCHRIEBEN' });
  let vorher = null;
  if (alt) {
    vorher = {};
    for (const k of FELDER) if (JSON.stringify(alt[k] ?? null) !== JSON.stringify(b[k] ?? null)) vorher[k] = alt[k] ?? null;
    if (!Object.keys(vorher).length) return alt;
  }
  return commit(alt ? 'lager.aendern' : 'lager.anlegen', (db) => {
    const i = db.lager.findIndex((x) => x.id === b.id);
    if (i >= 0) db.lager[i] = b; else db.lager.push(b);
    return b;
  }, { entity: 'lager', entityId: b.id, summary: text(b), vorher });
}

/** Mehrere Zugänge auf einmal (aus einer E-Rechnung). Gibt die gespeicherten Bewegungen zurück. */
export async function zugaengeSpeichern(liste, quelle) {
  const out = [];
  for (const z of liste) out.push(await bewegungSpeichern({ ...z, art: 'zugang', quelle: { ...quelle, pos: z.pos || '' } }));
  return out;
}

/** Löscht eine Bewegung; der alte Inhalt bleibt im Journal. */
export async function bewegungLoeschen(id) {
  const b = sel.lager().find((x) => x.id === id);
  if (!b) return;
  if (isLockedDate(b.datum)) throw Object.assign(new Error(gesperrt), { code: 'FESTGESCHRIEBEN' });
  const vorher = Object.fromEntries(FELDER.map((k) => [k, b[k] ?? null]));
  await commit('lager.loeschen', (db) => {
    db.lager = db.lager.filter((x) => x.id !== id);
    tomb(db, 'lager', id);
    return true;
  }, { entity: 'lager', entityId: id, summary: text(b), vorher });
}
