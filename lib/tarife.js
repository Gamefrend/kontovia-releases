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
  angebote: { ab: 'standard', name: 'Angebote, Auftragsbestätigungen und Lieferscheine' },
  beleglesen: { ab: 'standard', name: 'Belege automatisch lesen' },
  projekte: { ab: 'pro', name: 'Projekte und Zeiterfassung' },
  kassenbuch: { ab: 'standard', name: 'Kassenbuch mit Kassensturz' },
  liquiditaet: { ab: 'standard', name: 'Liquiditätsvorschau' },
  kanzleipaket: { ab: 'standard', name: 'Paket für die Kanzlei mit Belegen' },
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

/**
 * Ganze Bereiche der Seitenleiste, die sich hinter einen Tarif legen lassen. Voreinstellung: alle frei
 * (`kostenlos`); der Betreiber stellt im Admin-Bereich ein, ab welcher Stufe ein Bereich gilt.
 *   view  Schlüssel in `VIEWS` (app.js)
 * Einstellungen und Hilfe fehlen mit Absicht: Ohne sie käme niemand mehr an die Lizenz.
 */
export const BEREICHE = {
  bereich_dashboard: { ab: 'kostenlos', name: 'Übersicht', view: 'dashboard' },
  bereich_transactions: { ab: 'kostenlos', name: 'Buchungen', view: 'transactions' },
  bereich_rechnungen: { ab: 'kostenlos', name: 'Rechnungen', view: 'rechnungen' },
  bereich_calendar: { ab: 'kostenlos', name: 'Kalender', view: 'calendar' },
  bereich_todos: { ab: 'kostenlos', name: 'Aufgaben', view: 'todos' },
  bereich_reports: { ab: 'kostenlos', name: 'Auswertungen', view: 'reports' },
  bereich_export: { ab: 'kostenlos', name: 'Import & Export', view: 'export' },
  bereich_master: { ab: 'kostenlos', name: 'Stammdaten', view: 'master' },
};

/** Welche Funktion sperrt diesen Bereich? (leer = keine) Der Kontoauszug ist schon eine Funktion. */
export function bereichFunktion(view) {
  if (view === 'kontoimport') return 'kontoauszug';
  if (view === 'projekte') return 'projekte';
  return Object.keys(BEREICHE).find((k) => BEREICHE[k].view === view) || '';
}

/** Eintrag zu einem Schlüssel aus `FUNKTIONEN` oder `BEREICHE`. */
const eintrag = (funktion) => FUNKTIONEN[funktion] || BEREICHE[funktion];

/** Anzeigename einer Funktion oder eines Bereichs. */
export const funktionName = (funktion) => eintrag(funktion)?.name || funktion;

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
export const stufeFuer = (funktion) => eintrag(funktion)?.ab || 'kostenlos';

/** Ist die Funktion oder der Bereich für alle frei? Dann gibt es weder Krone noch Sperre. */
export const istFrei = (funktion) => stufeFuer(funktion) === 'kostenlos';

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
  [/^angebot\.(anlegen|aendern|ausstellen)$/, 'angebote'],
  [/^(projekt|zeit)\.(anlegen|aendern|start|abrechnen)$/, 'projekte'],
  [/^kasse\.zaehlung$/, 'kassenbuch'],
];

/**
 * Schreibende Aktionen je Bereich: Liegt ein Bereich hinter einem Tarif, sperrt `commit()` auch diese, sonst ginge
 * es über Umwege weiter (Neue Buchung oben, Suche, Assistent, Kacheln). Löschen, Stornieren und Bezahlen bleiben
 * wie bei den Funktionen frei, damit nach einem Tarifwechsel nichts hängen bleibt.
 */
export const AKTION_BEREICH = [
  [/^buchung\.(anlegen|aendern|ausbuchen)$/, 'bereich_transactions'],
  [/^(rechnung|rechnungsvorlage|produkt|angebot)\.(anlegen|aendern|ausstellen|eingang)$/, 'bereich_rechnungen'],
  [/^mahnung\.erstellen$/, 'bereich_rechnungen'],
  [/^termin\.(anlegen|aendern)$/, 'bereich_calendar'],
  [/^aufgabe\.(anlegen|aendern)$/, 'bereich_todos'],
  [/^(kontakt|kategorie|konto)\.(anlegen|aendern)$/, 'bereich_master'],
  [/^elster\.(einlesen|ersetzen)$/, 'bereich_export'],
];

/* -------------------------------------------------------------------------- */
/* Einstellbar durch den Betreiber (Admin-Bereich)                             */
/* -------------------------------------------------------------------------- */

const KOPIE = (o) => JSON.parse(JSON.stringify(o));
/** Die eingebauten Werte; darauf fällt alles zurück, wenn keine Einstellung gilt. */
const BASIS = { funktionen: {}, bereiche: {}, grenzen: KOPIE(GRENZEN) };
for (const [k, v] of Object.entries(FUNKTIONEN)) BASIS.funktionen[k] = v.ab;
for (const [k, v] of Object.entries(BEREICHE)) BASIS.bereiche[k] = v.ab;

const SCHLUESSEL_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const GRENZEN_ARTEN = Object.keys(GRENZEN.kostenlos);

/**
 * Macht aus beliebigem Eingang eine saubere Einstellung: nur bekannte Funktionen, Bereiche und Grenzen, nur
 * gültige Stufen, Grenzen als ganze Zahl ab 0 oder `null`. Alles andere fällt weg (die Datei im Cloud-Speicher
 * ist von außen beschreibbar, so weit die Regeln es erlauben, und wird nie ungeprüft übernommen).
 * @returns {{funktionen:Object<string,string>, grenzen:Object<string,Object<string,number|null>>}}
 */
export function konfigBereinigen(roh) {
  const aus = { funktionen: {}, grenzen: {} };
  const f = roh && typeof roh === 'object' ? roh.funktionen : null;
  if (f && typeof f === 'object') {
    for (const [k, v] of Object.entries(f)) {
      if (!SCHLUESSEL_RE.test(k) || !(k in BASIS.funktionen || k in BASIS.bereiche)) continue;
      if (gueltigeStufe(v)) aus.funktionen[k] = v;
    }
  }
  const g = roh && typeof roh === 'object' ? roh.grenzen : null;
  if (g && typeof g === 'object') {
    for (const stufe of STUFEN) {
      const zeile = g[stufe];
      if (!zeile || typeof zeile !== 'object') continue;
      for (const was of GRENZEN_ARTEN) {
        if (!(was in zeile)) continue;
        const n = zeile[was];
        if (n === null) (aus.grenzen[stufe] ??= {})[was] = null;
        else if (Number.isInteger(n) && n >= 0 && n <= 100000) (aus.grenzen[stufe] ??= {})[was] = n;
      }
    }
  }
  return aus;
}

/** Stellt zuerst die eingebauten Werte her und legt die Einstellung darüber. Gibt zurück, was sich geändert hat. */
export function konfigAnwenden(roh) {
  const k = konfigBereinigen(roh);
  for (const [name, ab] of Object.entries(BASIS.funktionen)) FUNKTIONEN[name].ab = k.funktionen[name] || ab;
  for (const [name, ab] of Object.entries(BASIS.bereiche)) BEREICHE[name].ab = k.funktionen[name] || ab;
  for (const s of STUFEN) Object.assign(GRENZEN[s], BASIS.grenzen[s], k.grenzen[s] || {});
  return k;
}

/** Die gerade geltende Einstellung als Ganzes (alle Werte, auch die eingebauten). */
export function konfigStand() {
  return {
    funktionen: Object.fromEntries([...Object.entries(FUNKTIONEN), ...Object.entries(BEREICHE)].map(([k, v]) => [k, v.ab])),
    grenzen: KOPIE(GRENZEN),
  };
}

/** Die eingebauten Werte im selben Format wie `konfigStand` (für „zurücksetzen“ und den Vergleich im Admin-Bereich). */
export const konfigEingebaut = () => ({ funktionen: { ...BASIS.funktionen, ...BASIS.bereiche }, grenzen: KOPIE(BASIS.grenzen) });

/** Was mit dieser Einstellung (Abweichungen) gelten würde, im Format von `konfigStand`, ohne sie anzuwenden. */
export function konfigVoll(roh) {
  const k = konfigBereinigen(roh);
  const voll = konfigEingebaut();
  Object.assign(voll.funktionen, k.funktionen);
  for (const s of STUFEN) Object.assign(voll.grenzen[s], k.grenzen[s] || {});
  return voll;
}

/**
 * Nur die Abweichungen von den eingebauten Werten: so klein bleibt die Datei im Cloud-Speicher, und neue
 * Funktionen späterer Fassungen behalten ihre eingebaute Stufe, solange der Betreiber sie nicht anfasst.
 */
export function konfigAbweichungen(stand = konfigStand()) {
  const b = konfigEingebaut();
  const aus = { funktionen: {}, grenzen: {} };
  for (const [k, ab] of Object.entries(stand.funktionen)) if (ab !== b.funktionen[k]) aus.funktionen[k] = ab;
  for (const s of STUFEN) for (const was of GRENZEN_ARTEN) {
    if (stand.grenzen?.[s]?.[was] !== b.grenzen[s][was]) (aus.grenzen[s] ??= {})[was] = stand.grenzen[s][was];
  }
  return aus;
}

/** Welche Funktion setzt diese Aktion voraus? (leer = keine) */
export function funktionFuerAktion(aktion) {
  const a = String(aktion || '');
  return AKTION_FUNKTION.find(([re]) => re.test(a))?.[1] || '';
}

/** Alles, was diese Aktion voraussetzt: die Funktion und den Bereich, zu dem sie gehört. */
export function funktionenFuerAktion(aktion) {
  const a = String(aktion || '');
  return [...AKTION_FUNKTION, ...AKTION_BEREICH].filter(([re]) => re.test(a)).map(([, f]) => f);
}
