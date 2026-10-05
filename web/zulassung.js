/**
 * Kontovia – befristete Zulassung eines mit Google verbundenen Geräts.
 *
 * Wer Kontovia mit einem Google-Konto verbunden hat, bestätigt dem
 * Cloud-Speicher spätestens alle 30 Tage, dass das Konto noch zugelassen ist.
 * Das Gerät liest dafür ein kleines Objekt: zulassung/<uid>.json (nur Lesen
 * für das eigene Konto, Schreiben nur durch den Betreiber in der
 * Firebase-Konsole; firebase/storage.rules). Es werden keine Nutzungsdaten
 * übertragen, nur die Anmeldung und dieses Lesen.
 *
 * Gedacht ist das für verlorene, gestohlene oder nicht mehr berechtigte
 * Geräte. Es ist keine harte Garantie: Wer das Gerät nie öffnet oder das
 * Browserprofil kopiert, entkommt der Frist (der Zeitpunkt der letzten
 * Bestätigung liegt außerhalb des Tresors, damit er vor dem Entsperren
 * lesbar ist, und lässt sich dort verändern).
 *
 * DER GRUNDSATZ: Niemand darf sich dadurch aus der eigenen Buchhaltung
 * aussperren oder sie verlieren. Gelöscht wird nur nach einer eindeutigen,
 * positiven Antwort „gesperrt“, zweimal im Abstand von mindestens einem
 * Tag bestätigt, und nur, wenn die Buchhaltung vorher gesichert in der
 * Cloud liegt. Alles andere (kein Netz, Fehler, abgelaufene Anmeldung,
 * unlesbare Antwort, verstellte Uhr, fehlende Regeln) ist nie ein Grund zu
 * löschen. Die Uhr des Geräts entscheidet nie über das Löschen; dafür zählt
 * allein die Zeit des Servers (die Ausstellungszeit eines frischen Tokens).
 *
 * Dieses Modul enthält nur Entscheidungen und das Merkbuch außerhalb des
 * Tresors; Netz und Löschen liegen in firebase.js, cloud.js und bridge.js.
 */

import * as A from './ablage.js';

export const DAY = 24 * 60 * 60 * 1000;
export const FRIST_TAGE = 30;
/** Zwischen der ersten und der zweiten Beobachtung „gesperrt“ muss mindestens so viel Zeit liegen. */
export const BEOBACHTUNG_ABSTAND_MS = DAY;
/** Zwei Antworten kurz hintereinander zählen als eine Beobachtung. */
const GLEICHE_BEOBACHTUNG_MS = 5 * 60 * 1000;
const MERKER = 'zulassung';

/* -------------------------------------------------------------------------- */
/* Einordnen der Antwort                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Was bedeutet die Antwort des Speichers?
 *   zugelassen  eindeutig: das Objekt fehlt (404) oder sagt „zugelassen“
 *   gesperrt    eindeutig: das Objekt sagt „gesperrt“
 *   unklar      alles andere (403, 5xx, kein JSON, unbekannter Zustand …)
 * @param {number} status  HTTP-Status
 * @param {string} text    Antworttext
 */
export function einordnen(status, text) {
  if (status === 404) return 'zugelassen';
  if (status !== 200) return 'unklar';
  let j;
  try { j = JSON.parse(String(text)); } catch { return 'unklar'; }
  if (j?.v !== 1) return 'unklar';
  if (j.zustand === 'zugelassen') return 'zugelassen';
  if (j.zustand === 'gesperrt') return 'gesperrt';
  return 'unklar';
}

/* -------------------------------------------------------------------------- */
/* Merkbuch (außerhalb des Tresors)                                            */
/* -------------------------------------------------------------------------- */

export const lesen = () => A.lesen('dateien', MERKER).catch(() => null);
export const schreiben = (rec) => A.schreiben('dateien', MERKER, rec);
export const vergessen = () => A.loeschen('dateien', MERKER).catch(() => {});

/* -------------------------------------------------------------------------- */
/* Entscheiden                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Verarbeitet das Ergebnis einer Prüfung. Reine Funktion: gibt das neue Merkbuch
 * und die Aktion zurück, tut selbst nichts.
 *
 * @param {object|null} rec  bisheriges Merkbuch
 * @param {string} uid       Kennung des verbundenen Kontos
 * @param {{art:'zugelassen'|'gesperrt'|'unklar'|'netz'|'anmeldung', serverZeit?:number}} antwort
 * @param {number} jetzt     Zeit dieses Geräts (nur für Warnungen, nie fürs Löschen)
 * @returns {{rec:object, aktion:'nichts'|'loeschen'}}
 */
export function verarbeiten(rec, uid, antwort, jetzt = Date.now()) {
  // Ein anderes Konto: die Uhr beginnt neu.
  const alt = rec && rec.uid === uid ? rec : null;
  const basis = { v: 1, uid, ok: alt?.ok || null, okLokal: alt?.okLokal || 0, beobachtet: alt?.beobachtet || [] };

  if (antwort.art === 'zugelassen' && antwort.serverZeit > 0) {
    return { rec: { ...basis, ok: new Date(antwort.serverZeit).toISOString(), okLokal: jetzt, beobachtet: [], versuch: jetzt }, aktion: 'nichts' };
  }

  if (antwort.art === 'gesperrt' && antwort.serverZeit > 0) {
    const t = antwort.serverZeit;
    const b = [...basis.beobachtet];
    if (!b.length || t - b[b.length - 1] >= GLEICHE_BEOBACHTUNG_MS) b.push(t);
    const beobachtet = b.slice(-5);
    const geprueft = beobachtet.length >= 2 && beobachtet[beobachtet.length - 1] - beobachtet[0] >= BEOBACHTUNG_ABSTAND_MS;
    return { rec: { ...basis, beobachtet, versuch: jetzt }, aktion: geprueft ? 'loeschen' : 'nichts' };
  }

  // Kein Netz, Fehler, abgelaufene Anmeldung, unlesbare Antwort, fehlende Zeit des Servers: nichts ändert sich.
  return { rec: { ...basis, versuch: jetzt, letzterFehler: antwort.art || 'unklar' }, aktion: 'nichts' };
}

/**
 * Wann ist es soweit? Nur für die Anzeige. Die Uhr des Geräts kann falsch gehen;
 * das beeinflusst höchstens Warnungen, nie das Löschen.
 * stufe: 0 alles ruhig, 1 ab 20 Tagen (noch 10), 2 noch 3 Tage, 3 noch 1 Tag, 4 überfällig
 */
export function stand(rec, jetzt = Date.now()) {
  if (rec?.lokalGesperrt) return { zustand: 'lokal-gesperrt', seit: rec.lokalGesperrt.seit || null, stufe: 0 };
  if (!rec || !rec.okLokal) {
    return { zustand: rec?.beobachtet?.length ? 'gesperrt-beobachtet' : 'neu', zuletzt: null, bis: null, tageRest: null, stufe: 0, ...beobachtung(rec) };
  }
  const bis = rec.okLokal + FRIST_TAGE * DAY;
  const vergangen = jetzt - rec.okLokal;
  const uhrZurueck = vergangen < 0;
  const rest = (bis - jetzt) / DAY;
  const stufe = uhrZurueck ? 0 : rest <= 0 ? 4 : rest <= 1 ? 3 : rest <= 3 ? 2 : rest <= 10 ? 1 : 0;
  const gesperrt = rec.beobachtet?.length ? 'gesperrt-beobachtet' : null;
  return {
    zustand: gesperrt || (stufe === 4 ? 'ueberfaellig' : stufe > 0 ? 'faellig' : 'ok'),
    zuletzt: new Date(rec.okLokal).toISOString(),
    bis: new Date(bis).toISOString(),
    tageRest: uhrZurueck ? null : Math.max(0, Math.ceil(rest)),
    stufe,
    uhrZurueck,
    letzterFehler: rec.letzterFehler || '',
    ...beobachtung(rec),
  };
}

function beobachtung(rec) {
  const b = rec?.beobachtet || [];
  if (!b.length) return {};
  return { gesperrtSeit: new Date(b[0]).toISOString(), loeschenAb: new Date(b[0] + BEOBACHTUNG_ABSTAND_MS).toISOString() };
}
