/**
 * Kontovia – Benutzer und Rollen innerhalb eines Kontos (reine Regeln).
 *
 * Ein Konto ist eine Buchhaltung mit einem Passwort. Arbeiten mehrere Personen
 * damit, lassen sich in dem Konto Benutzer anlegen. Das hat zwei Zwecke:
 *
 *  - Nachvollziehbarkeit: Das Änderungsjournal vermerkt bei jeder Änderung den
 *    Benutzer (GoBD, Abschnitt Unveränderbarkeit: wer hat wann was geändert).
 *  - Bedienung: Rollen bestimmen, was jemand in der Oberfläche ändern darf,
 *    etwa „nur lesen“ für die Steuerberatung.
 *
 * Rollen sind **keine Zugriffssperre**. Wer das Passwort des Kontos kennt,
 * besitzt den Schlüssel zu allen Daten; die Rollen halten niemanden davon ab,
 * die Buchhaltung außerhalb von Kontovia zu öffnen. Die Oberfläche sagt das
 * auch so. Die Regeln hier gelten an einer einzigen Stelle, in `commit()`
 * (lib/store.js): Jede Änderung der Buchhaltung läuft dort durch.
 */

/**
 * Die Rollen, von der weitreichendsten zur engsten.
 *  inhaber      alles, auch Benutzer, Einstellungen, Festschreibung, Sicherungen
 *  buchhaltung  Buchungen, Rechnungen, Kontakte, Termine, Aufgaben, Kontoauszüge; keine Einstellungen,
 *               keine Festschreibung, keine Wiederherstellung, keine Benutzerverwaltung
 *  lesen        nur ansehen, auswerten und exportieren
 */
export const ROLLEN = {
  inhaber: {
    name: 'Inhaber',
    kurz: 'Alles',
    text: 'Darf alles: Buchungen, Einstellungen, Festschreibung, Sicherungen und die Benutzer verwalten.',
  },
  buchhaltung: {
    name: 'Mitarbeit',
    kurz: 'Buchen',
    text: 'Darf Buchungen, Rechnungen, Kontakte, Termine und Aufgaben bearbeiten. Keine Einstellungen, keine Festschreibung, keine Benutzerverwaltung.',
  },
  lesen: {
    name: 'Nur lesen',
    kurz: 'Ansehen',
    text: 'Darf alles ansehen, auswerten und exportieren, aber nichts ändern. Gedacht für die Steuerberatung.',
  },
};

export const rolleName = (r) => ROLLEN[r]?.name || 'Inhaber';

/** Aktionen, die jede Rolle ausführen darf: persönliche Vorlieben und Rückmeldungen. */
const IMMER = [
  /^nutzung\./,
  /^einstellung\.darstellung$/,
  /^einstellung\.update$/,
  /^feedback\./,
];

/** Aktionen, die die Rolle „Mitarbeit“ nicht ausführen darf. */
const NUR_INHABER = [
  /^einstellung(en)?\./,
  /^festschreibung/,
  /^sicherung\./,
  /^benutzer\./,
  // Ein weiteres Gerät bekommt den Zugang zur ganzen Buchhaltung.
  /^geraet\./,
];

/**
 * Darf diese Rolle diese Aktion ausführen?
 * @param {string} rolle   'inhaber' | 'buchhaltung' | 'lesen' (unbekannt gilt als Inhaber: ohne Benutzer gibt es keine Beschränkung)
 * @param {string} aktion  Name der Änderung, etwa 'buchung.anlegen'
 */
export function darf(rolle, aktion) {
  const a = String(aktion || '');
  if (IMMER.some((re) => re.test(a))) return true;
  if (rolle === 'lesen') return false;
  if (rolle === 'buchhaltung') return !NUR_INHABER.some((re) => re.test(a));
  return true;
}

/** Wenn die Rolle etwas nicht darf: die Meldung dazu. */
export function verbotText(rolle) {
  return rolle === 'lesen'
    ? 'Sie sind als „Nur lesen“ angemeldet und können nichts ändern. Wechseln Sie den Benutzer, wenn Sie etwas ändern möchten.'
    : 'Das darf Ihre Rolle nicht. Einstellungen, Festschreibung, Sicherungen und Benutzer ändert nur ein Inhaber.';
}

/** Initialen für das runde Zeichen neben dem Namen. */
export function initialen(name) {
  const teile = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return '?';
  return (teile.length === 1 ? teile[0].slice(0, 2) : teile[0][0] + teile.at(-1)[0]).toUpperCase();
}

/** Die aktiven Benutzer eines Bestands, nach Namen. */
export function aktiveBenutzer(db) {
  return (db?.users || []).filter((u) => u && !u.deaktiviert).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
}

/** Wie viele Inhaber gibt es (aktive)? Der letzte darf nie wegfallen. */
export const inhaberZahl = (db) => aktiveBenutzer(db).filter((u) => u.rolle === 'inhaber').length;

/**
 * Prüft eine Änderung an der Benutzerliste.
 * @returns {string} Fehlertext oder leer
 */
export function benutzerPruefen(db, { id = '', name, rolle, deaktiviert = false }) {
  const n = String(name ?? '').trim();
  if (!n) return 'Bitte einen Namen eingeben.';
  if (n.length > 60) return 'Der Name ist zu lang (höchstens 60 Zeichen).';
  if (!ROLLEN[rolle]) return 'Bitte eine Rolle wählen.';
  const doppelt = (db?.users || []).some((u) => u.id !== id && String(u.name).trim().toLowerCase() === n.toLowerCase());
  if (doppelt) return 'Diesen Namen gibt es schon. Bitte einen anderen wählen, damit das Journal die Personen auseinanderhält.';
  const bisher = (db?.users || []).find((u) => u.id === id);
  if (bisher && bisher.rolle === 'inhaber' && !bisher.deaktiviert && (rolle !== 'inhaber' || deaktiviert) && inhaberZahl(db) <= 1) {
    return 'Es muss mindestens ein Inhaber bleiben.';
  }
  return '';
}

/* -------------------------------------------------------------------------- */
/* PIN                                                                         */
/* -------------------------------------------------------------------------- */

const PIN_RUNDEN = 150000;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const vonHex = (h) => Uint8Array.from(String(h).match(/../g) || [], (b) => parseInt(b, 16));

async function pinAbleiten(pin, salz, runden = PIN_RUNDEN) {
  const schluessel = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salz, iterations: runden }, schluessel, 256));
}

/** Gültige PIN: vier bis acht Ziffern. */
export const pinGueltig = (pin) => /^\d{4,8}$/.test(String(pin ?? ''));

/** Macht aus einer PIN den Eintrag für den Benutzer (nie die PIN selbst). */
export async function pinErzeugen(pin) {
  const salz = crypto.getRandomValues(new Uint8Array(16));
  return { salz: hex(salz), hash: await pinAbleiten(pin, salz), runden: PIN_RUNDEN };
}

/** Stimmt die PIN? Ohne PIN am Benutzer stimmt jede Eingabe. */
export async function pinPruefen(benutzer, pin) {
  if (!benutzer?.pin) return true;
  const h = await pinAbleiten(String(pin ?? ''), vonHex(benutzer.pin.salz), Number(benutzer.pin.runden) || PIN_RUNDEN);
  // Gleich lang und gleich geprüft, unabhängig von der Stelle des ersten Unterschieds.
  let diff = h.length ^ String(benutzer.pin.hash).length;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ (String(benutzer.pin.hash).charCodeAt(i) || 0);
  return diff === 0;
}
