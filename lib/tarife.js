/**
 * Kontovia – Tarife: welche Funktion ab welcher Stufe gilt und welche Grenzen es gibt (reine Regeln).
 *
 * Die Stufen sind dieselben wie auf der Abo-Seite (abo/config.json): Kostenlos, Standard, Pro, Max.
 * Jede Stufe enthält alles der darunter. Eine Funktion, die ab Standard gilt, trägt in der
 * Oberfläche eine Krone und ist darunter gesperrt. Die Prüfung `webfassung` hält diese Datei
 * und die Vergleichstabelle der Abo-Seite zusammen: Wer eine Zeile dort ändert, ändert sie auch hier.
 *
 * Wer ob und was darf, entscheidet `lib/lizenz.js` (aktueller Stand der Lizenz); diese Datei
 * kennt nur die Tabelle.
 */

/** Von der kleinsten zur größten Stufe. */
export const STUFEN = ['kostenlos', 'standard', 'pro', 'max'];

export const STUFEN_NAME = { kostenlos: 'Kostenlos', standard: 'Standard', pro: 'Pro', max: 'Max' };

/** Rang einer Stufe; Unbekanntes zählt wie Kostenlos. */
export const rang = (stufe) => Math.max(0, STUFEN.indexOf(stufe));

export const gueltigeStufe = (stufe) => STUFEN.includes(stufe);

/**
 * Premium-Funktionen.
 *   ab    kleinste Stufe, die die Funktion enthält
 *   name  Bezeichnung für die Sperrmeldung
 */
export const FUNKTIONEN = {
  wiederkehrend: { ab: 'standard', name: 'Wiederkehrende Buchungen' },
  kontoauszug: { ab: 'standard', name: 'Kontoauszug einlesen' },
  anlagen: { ab: 'standard', name: 'Anlagen und Abschreibungen' },
  gestaltung: { ab: 'standard', name: 'Eigenes Logo und freie Gestaltung' },
  vorlagen: { ab: 'standard', name: 'Produkte und Vorlagen' },
  elster: { ab: 'standard', name: 'Voranmeldung als ELSTER-Datei' },
  euer: { ab: 'standard', name: 'Anlage EÜR nach amtlichem Vordruck' },
  jahresvergleich: { ab: 'standard', name: 'Jahresvergleich' },
  steuertermine: { ab: 'standard', name: 'Steuertermine' },
  datev: { ab: 'standard', name: 'Export für DATEV' },
  finanzamt: { ab: 'standard', name: 'Paket fürs Finanzamt' },
  cloud: { ab: 'standard', name: 'Verschlüsselte Cloud-Sicherung' },
  koppeln: { ab: 'standard', name: 'Zweites Gerät koppeln' },
  mahnwesen: { ab: 'pro', name: 'Mahnwesen' },
  mailDirekt: { ab: 'pro', name: 'Direkt aus Gmail oder Outlook senden' },
  zm: { ab: 'pro', name: 'Zusammenfassende Meldung' },
  pruefungsordner: { ab: 'pro', name: 'Datenträger für die Betriebsprüfung' },
  kalender: { ab: 'pro', name: 'Google Kalender abgleichen' },
  assistent: { ab: 'pro', name: 'Assistent auf dem Gerät' },
};

/** Grenzen je Stufe. `null` heißt: unbegrenzt. */
export const GRENZEN = {
  kostenlos: { rechnungenMonat: 5, geraete: 1, benutzer: 1, firmen: 1 },
  standard: { rechnungenMonat: null, geraete: 2, benutzer: 1, firmen: 1 },
  pro: { rechnungenMonat: null, geraete: 5, benutzer: 3, firmen: 1 },
  max: { rechnungenMonat: null, geraete: null, benutzer: 10, firmen: 5 },
};

/** Bezeichnung der Grenzen für Meldungen (Mehrzahl nach der Zahl). */
export const GRENZEN_NAME = {
  rechnungenMonat: ['Rechnung im Monat', 'Rechnungen im Monat'],
  geraete: ['Gerät', 'Geräte'],
  benutzer: ['Benutzer', 'Benutzer'],
  firmen: ['Firma', 'Firmen'],
};

/** Ab welcher Stufe gilt die Funktion? Unbekannte Funktionen sind frei. */
export const stufeFuer = (funktion) => FUNKTIONEN[funktion]?.ab || 'kostenlos';

/** Enthält diese Stufe die Funktion? */
export const enthaelt = (stufe, funktion) => rang(stufe) >= rang(stufeFuer(funktion));

/** Wie viel erlaubt die Stufe? `null` = unbegrenzt. */
export function grenzeFuer(stufe, was) {
  const g = GRENZEN[gueltigeStufe(stufe) ? stufe : 'kostenlos'];
  return g && was in g ? g[was] : null;
}

/** Die kleinste Stufe, die mindestens so viel erlaubt (für den Hinweis „ab Pro“). */
export function stufeFuerGrenze(was, anzahl) {
  return STUFEN.find((s) => { const g = grenzeFuer(s, was); return g === null || g >= anzahl; }) || 'max';
}

/**
 * Aktionen im Journal (`commit()`), die eine Funktion voraussetzen. So gilt die Sperre an der einen
 * Stelle, an der jede Änderung der Buchhaltung durchläuft, nicht nur in den Fenstern.
 * Was fehlt, ist frei. Der Automatik-Lauf (`meta.system`) bleibt unberührt, damit nichts halb endet.
 */
export const AKTION_FUNKTION = [
  // Anlegen und Ändern ist gesperrt; Löschen und Ansehen bleiben, damit nach einem Tarifwechsel nichts hängen bleibt.
  [/^wiederkehrend\.(anlegen|aendern)$/, 'wiederkehrend'],
  [/^import\.(datei|abschluss)$/, 'kontoauszug'],
  [/^importregel\.(anlegen|aendern)$/, 'kontoauszug'],
  [/^importvorlage\.(anlegen|aendern)$/, 'kontoauszug'],
  [/^anlage\.(anlegen|aendern)$/, 'anlagen'],
  [/^mahnung\.erstellen$/, 'mahnwesen'],
  [/^(produkt|rechnungsvorlage)\.(anlegen|aendern)$/, 'vorlagen'],
];

/** Welche Funktion setzt diese Aktion voraus? (leer = keine) */
export function funktionFuerAktion(aktion) {
  const a = String(aktion || '');
  return AKTION_FUNKTION.find(([re]) => re.test(a))?.[1] || '';
}
