/**
 * Kontovia – was mit dem Fahrtenbuch und Dienstreisen geschieht (SEC-65): Fahrt eintragen, ändern, löschen,
 * Fahrzeuge pflegen, eine Dienstreise buchen.
 *
 * Jede Änderung geht durch commit() (lib/store.js), Journal `fahrt.*`, `fahrzeug.*` und `reise.buchen`. Ein
 * Fahrtenbuch muss zeigen, was nachträglich geändert wurde: Das Journal hält bei jeder Änderung den alten Inhalt der
 * Fahrt fest (`vorher`). Im festgeschriebenen Zeitraum bleibt eine Fahrt, wie sie ist (GoBD, wie Buchungen).
 * Rechnen: lib/fahrtenbuch.js.
 */

import { uid } from './util.js';
import { sel, commit, isLockedDate, tomb, upsertTransaction, upsertEntity } from './store.js';
import { fahrtKm, fahrtArt, fahrtPruefen, reiseBuchungen, VERPFLEGUNG_ZEILE } from './fahrtenbuch.js';
import { FAHRT_ZEILE } from './sonderfaelle.js';

/** Felder einer Fahrt, deren alter Wert bei einer Änderung ins Journal kommt. */
const FELDER = ['fahrzeugId', 'datum', 'kmStart', 'kmEnde', 'km', 'art', 'start', 'ziel', 'anlass', 'partner'];

const gesperrt = 'Diese Fahrt liegt im festgeschriebenen Zeitraum und bleibt, wie sie ist.';

/** Speichert eine Fahrt (neu oder geändert). Wirft bei fehlenden Pflichtangaben oder im festgeschriebenen Zeitraum. */
export async function fahrtSpeichern(eingabe) {
  const alt = sel.fahrten().find((x) => x.id === eingabe.id) || null;
  const f = { ...eingabe, id: eingabe.id || uid('fahrt'), art: fahrtArt(eingabe.art) };
  f.km = fahrtKm(f);
  const fehlt = fahrtPruefen(f).filter((x) => x.stufe === 'pflicht');
  if (fehlt.length) throw Object.assign(new Error(fehlt[0].text), { feld: fehlt[0].feld });
  if ((alt && isLockedDate(alt.datum)) || isLockedDate(f.datum)) throw Object.assign(new Error(gesperrt), { code: 'FESTGESCHRIEBEN' });
  const jetzt = new Date().toISOString();
  f.createdAt = alt?.createdAt || jetzt;
  f.updatedAt = jetzt;
  let vorher = null;
  if (alt) {
    vorher = {};
    for (const k of FELDER) if (JSON.stringify(alt[k] ?? null) !== JSON.stringify(f[k] ?? null)) vorher[k] = alt[k] ?? null;
    if (!Object.keys(vorher).length) return alt;
  }
  return commit(alt ? 'fahrt.aendern' : 'fahrt.anlegen', (db) => {
    const i = db.fahrten.findIndex((x) => x.id === f.id);
    if (i >= 0) db.fahrten[i] = f; else db.fahrten.push(f);
    return f;
  }, { entity: 'fahrt', entityId: f.id, summary: `${f.datum} · ${f.km} km · ${f.ziel || f.start || ''}`.trim(), vorher });
}

/** Löscht eine Fahrt; der alte Inhalt bleibt im Journal. */
export async function fahrtLoeschen(id) {
  const f = sel.fahrten().find((x) => x.id === id);
  if (!f) return;
  if (isLockedDate(f.datum)) throw Object.assign(new Error(gesperrt), { code: 'FESTGESCHRIEBEN' });
  const vorher = Object.fromEntries(FELDER.map((k) => [k, f[k] ?? null]));
  await commit('fahrt.loeschen', (db) => {
    db.fahrten = db.fahrten.filter((x) => x.id !== id);
    tomb(db, 'fahrten', id);
    return true;
  }, { entity: 'fahrt', entityId: id, summary: `${f.datum} · ${f.km} km · ${f.ziel || ''}`.trim(), vorher });
}

/** Die Fahrzeuge (settings.fahrzeuge). */
export const fahrzeuge = () => (Array.isArray(sel.settings().fahrzeuge) ? sel.settings().fahrzeuge : []);

/** Legt ein Fahrzeug an oder ändert es. Listenpreis in Cent. */
export async function fahrzeugSpeichern(fz) {
  const neu = { id: fz.id || uid('kfz'), name: String(fz.name || '').trim(), kennzeichen: String(fz.kennzeichen || '').trim(),
    listenpreis: Math.max(0, Math.round(Number(fz.listenpreis) || 0)), antrieb: fz.antrieb || 'verbrenner' };
  if (!neu.name && !neu.kennzeichen) throw new Error('Geben Sie dem Fahrzeug einen Namen oder ein Kennzeichen.');
  return commit('fahrzeug.speichern', (db) => {
    const liste = Array.isArray(db.settings.fahrzeuge) ? db.settings.fahrzeuge : [];
    const i = liste.findIndex((x) => x.id === neu.id);
    if (i >= 0) liste[i] = neu; else liste.push(neu);
    db.settings.fahrzeuge = liste;
    return neu;
  }, { entity: 'fahrzeug', entityId: neu.id, summary: [neu.name, neu.kennzeichen].filter(Boolean).join(' · ') });
}

/** Entfernt ein Fahrzeug ohne Fahrten (mit Fahrten bliebe das Fahrtenbuch ohne Namen). */
export async function fahrzeugLoeschen(id) {
  if (sel.fahrten().some((f) => f.fahrzeugId === id)) throw new Error('Zu diesem Fahrzeug gibt es Fahrten. Es bleibt deshalb stehen.');
  return commit('fahrzeug.loeschen', (db) => {
    db.settings.fahrzeuge = (db.settings.fahrzeuge || []).filter((x) => x.id !== id);
    return true;
  }, { entity: 'fahrzeug', entityId: id });
}

/**
 * Kosten des Fahrzeugs im Jahr als Vorschlag: Ausgaben der Kategorien mit den Kfz-Zeilen der EÜR (68 bis 70), netto,
 * ohne private und stornierte Buchungen. Abschreibung und Leasing anderer Fahrzeuge kann Kontovia nicht zuordnen.
 */
export function kfzKostenVorschlag(jahr) {
  const kat = new Set(sel.categories().filter((c) => [68, 69, 70].includes(Number(c.euerLine))).map((c) => c.id));
  return sel.transactions().filter((t) => t.type === 'expense' && kat.has(t.categoryId) && !t.unlisted && !t.voided && !t.fahrt
    && String(t.date || '').startsWith(String(jahr))).reduce((s, t) => s + (Number(t.net) || 0), 0);
}

/** Kategorien für die Buchungen einer Dienstreise: nach EÜR-Zeile, sonst leer. */
export function reiseKategorien() {
  const k = (zeile) => sel.activeCategories('expense').find((c) => Number(c.euerLine) === zeile)?.id || '';
  return { verpflegungKategorie: k(VERPFLEGUNG_ZEILE), fahrtKategorie: k(FAHRT_ZEILE) };
}

/** Fehlende Kategorien legt Kontovia an, wie das Buchungsfenster für die Kilometerpauschale (views/transactions.js). */
const KATEGORIEN = {
  verpflegungKategorie: { name: 'Verpflegungsmehraufwand (Pauschale)', euerLine: VERPFLEGUNG_ZEILE, skr03: '4668', skr04: '6674' },
  fahrtKategorie: { name: 'Fahrten mit eigenem Auto (Kilometerpauschale)', euerLine: FAHRT_ZEILE, skr03: '4673', skr04: '6673' },
};

/** Bucht eine Dienstreise (lib/fahrtenbuch.js: reiseBuchungen). Gibt die angelegten Buchungen zurück. */
export async function reiseBuchen(reise) {
  const kat = reiseKategorien();
  const brauche = { verpflegungKategorie: Number(reise.verpflegung?.summe) > 0, fahrtKategorie: Number(reise.km) > 0 };
  for (const [k, vorlage] of Object.entries(KATEGORIEN)) {
    if (kat[k] || !brauche[k]) continue;
    const neu = { id: uid('cat'), kind: 'expense', ...vorlage, vatRate: 0, active: true };
    await upsertEntity('categories', neu, 'kategorie');
    kat[k] = neu.id;
  }
  const txs = reiseBuchungen(reise, { ...kat, id: uid });
  if (!txs.length) throw new Error('Für diese Reise gibt es nichts zu buchen.');
  const out = [];
  for (const tx of txs) out.push(await upsertTransaction(tx));
  return out;
}
