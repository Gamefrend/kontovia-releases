/**
 * Kontovia – Lizenz in der Oberfläche: der aktuelle Stand und die Fragen daran (ohne Darstellung).
 *
 * Den Stand liefert die Web-Schicht (`window.kontovia.lizenz`, src/web/lizenz.js), die den Lizenzschein
 * prüft; hier wird er gemerkt und mit der Tabelle aus lib/tarife.js verglichen. Die Fragen sind
 * synchron (`kann`, `grenze`), damit Ansichten und `commit()` (lib/store.js) nicht warten müssen.
 * Die Sperren gelten an zwei Stellen: in den Ansichten (Krone, Sperrkarte, Fenster, lib/lizenzui.js) und in
 * `commit()`, durch das jede Änderung der Buchhaltung läuft.
 *
 * Solange noch kein Stand geladen ist (Sperrbildschirm, Prüfungen ohne Brücke), wird nichts gesperrt.
 * Die App lädt ihn gleich nach dem Entsperren; schlägt das fehl, gilt „Kostenlos“.
 */

import { enthaelt, grenzeFuer, stufeFuer, stufeFuerGrenze, funktionFuerAktion, FUNKTIONEN, STUFEN_NAME, GRENZEN_NAME, rang } from './tarife.js';

/** Stand der Lizenz oder `null`, solange er nicht geladen ist. */
let stand = null;
const hoerer = new Set();

const api = () => globalThis.window?.kontovia;

export const lizenzStand = () => stand;

/** Setzt den Stand (nach dem Laden, nach dem Einlösen eines Scheins) und benachrichtigt die Hörer. */
export function lizenzSetzen(neu) {
  stand = neu ? { ...neu } : null;
  for (const fn of hoerer) { try { fn(stand); } catch (e) { console.error('[lizenz]', e); } }
}

/** Auf Änderungen hören (Seitenleiste, Einstellungen). Gibt die Abmeldung zurück. */
export function beiLizenz(fn) { hoerer.add(fn); return () => hoerer.delete(fn); }

/** Holt den Stand von der Web-Schicht. Ohne Brücke oder bei einem Fehler: Kostenlos. */
export async function lizenzLaden() {
  try {
    const s = await api().lizenz.status();
    lizenzSetzen(s);
  } catch (e) {
    console.error(e);
    lizenzSetzen({ zustand: 'keine', stufe: 'kostenlos', gebucht: 'kostenlos', testphase: false, bis: null, schonfristBis: null, id: '', geraet: '', vorschau: null });
  }
  return stand;
}

/** Beim Sperren vergessen: Der nächste Konto-Zugang lädt neu. */
export const lizenzVergessen = () => lizenzSetzen(null);

/** Die gültige Stufe: kostenlos, standard, pro oder max. Ungeladen: max (nichts gesperrt). */
export const stufe = () => (stand ? stand.stufe : 'max');
export const stufeName = (s = stufe()) => STUFEN_NAME[s] || STUFEN_NAME.kostenlos;

/** Darf das Konto diese Funktion nutzen? */
export const kann = (funktion) => (stand ? enthaelt(stand.stufe, funktion) : true);

/** Ab welcher Stufe gilt die Funktion (Name)? */
export const stufeNamenFuer = (funktion) => STUFEN_NAME[stufeFuer(funktion)];

/** Wie viel erlaubt die Stufe? `null` = unbegrenzt. */
export const grenze = (was) => (stand ? grenzeFuer(stand.stufe, was) : null);

/**
 * Ist noch Platz? `aktuell` ist die Zahl, die schon da ist.
 * @returns {{ok:boolean, grenze:number|null, ab:string}} ab = kleinste Stufe mit mehr Platz (nur wenn nicht ok)
 */
export function platz(was, aktuell) {
  const g = grenze(was);
  if (g === null || aktuell < g) return { ok: true, grenze: g, ab: '' };
  return { ok: false, grenze: g, ab: stufeFuerGrenze(was, aktuell + 1) };
}

/** Text zu einer Grenze: „5 Rechnungen im Monat“. */
export function grenzeText(was, n) {
  const [eins, viele] = GRENZEN_NAME[was] || ['', ''];
  return `${n} ${n === 1 ? eins : viele}`;
}

/** Meldung, wenn eine Grenze erreicht ist: Wie viel die Stufe erlaubt und was die nächste bietet. */
export function grenzeMeldung(was, anzahl) {
  const p = platz(was, anzahl);
  if (p.ok) return '';
  return `${stufeName()} enthält höchstens ${grenzeText(was, p.grenze)}. Ab ${STUFEN_NAME[p.ab]} gibt es mehr.`;
}

/** Text für „gesperrt“: welche Funktion und ab welcher Stufe. */
export const sperrText = (funktion) => `${FUNKTIONEN[funktion]?.name || funktion} gibt es ab dem Tarif ${stufeNamenFuer(funktion)}. Ihr Konto hat ${stufeName()}.`;

/** Wirft für `commit()`, wenn die Aktion eine Funktion braucht, die die Stufe nicht enthält. */
export function aktionPruefen(aktion) {
  const f = funktionFuerAktion(aktion);
  if (!f || kann(f)) return;
  const e = new Error(sperrText(f));
  e.code = 'LIZENZ';
  e.funktion = f;
  throw e;
}

/** Wirft, wenn die Grenze erreicht ist (Meldung nennt die Grenze und die nächste Stufe). */
export function grenzePruefen(was, aktuell) {
  if (platz(was, aktuell).ok) return;
  const e = new Error(grenzeMeldung(was, aktuell));
  e.code = 'LIZENZ';
  e.grenze = was;
  throw e;
}

/** Wie viele Rechnungen wurden in diesem Monat ausgestellt (ohne Stornos, ohne Eingang)? Für die Grenze „Rechnungen im Monat“. */
export function rechnungenImMonat(db, jetzt = new Date()) {
  const gleich = (iso) => { const d = new Date(iso); return d.getFullYear() === jetzt.getFullYear() && d.getMonth() === jetzt.getMonth(); };
  return (db?.invoices || []).filter((r) => r.richtung !== 'eingang' && r.status === 'ausgestellt' && !r.storno && r.ausgestelltAm && gleich(r.ausgestelltAm)).length;
}

/** Ist das ein Fehler wegen der Lizenz (damit die Oberfläche das Aufwertungsfenster zeigen kann)? */
export const istLizenzFehler = (e) => e?.code === 'LIZENZ' || /^LIZENZ_/.test(e?.code || '');

export { rang };
