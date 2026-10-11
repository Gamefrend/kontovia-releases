/**
 * Kontovia – Wer ist der Betreiber? Nur für die Seitenleiste und die Admin-Ansicht.
 *
 * Der Admin-Bereich erscheint, wenn das Cloud-Konto des Geräts mit einer der Adressen des Betreibers
 * angemeldet ist (Google meldet sie je nach Konto als gmail.com oder googlemail.com). Das ist nur eine
 * Frage der Anzeige: Was der Bereich ändert (Tarife, Lizenzen, Rückmeldungen), erlauben allein die
 * Speicherregeln (firebase/storage.rules: `istBetreiber()`), dort steht dieselbe Liste.
 */

export const BETREIBER_ADRESSEN = ['eni.avdovic@googlemail.com', 'eni.avdovic@gmail.com'];

const api = () => globalThis.window?.kontovia;

/** Ist das Cloud-Konto dieses Geräts das des Betreibers? Ohne Verbindung: nein. */
export async function istBetreiber() {
  try {
    const st = await api().cloud.status();
    return !!(st?.linked && BETREIBER_ADRESSEN.includes(String(st.email || '').trim().toLowerCase()));
  } catch {
    return false;
  }
}
