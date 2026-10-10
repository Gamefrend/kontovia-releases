/**
 * Kontovia – Lizenz: Stufe des Kontos, ohne Netz prüfbar.
 *
 * Eine Lizenz ist ein signierter Schein (ECDSA P-256, SHA-256): `KV1.<Inhalt>.<Signatur>`. Der Inhalt nennt
 * Stufe, Gerät und Laufzeit, die Signatur stammt vom Betreiber. Die App trägt nur den öffentlichen Schlüssel;
 * einen Schein kann niemand ändern oder selbst ausstellen, auch nicht über die Browser-Konsole. Der Schein
 * gilt für die Kennung dieses Geräts, ein kopierter Schein auf einem anderen Gerät wird abgelehnt.
 * Geprüft wird bei jedem Abruf neu; abgelegt ist nur der Schein selbst, nie ein Ergebnis („Pro“ o. Ä.).
 *
 * Die Laufzeit hat eine Schonfrist: Wer länger offline ist, behält seine Stufe, bis sie vorbei ist, und
 * bleibt danach auf „Kostenlos“ – Lesen und Exportieren (CSV, Excel, Sicherung) gehen immer. Wird die Uhr
 * zurückgestellt, zählt der höchste je gesehene Zeitpunkt.
 *
 * Testphase (`TESTPHASE`): Solange sie läuft, bekommt jedes Konto ohne Schein beim Anmelden selbst die
 * höchste Stufe, ohne Schein und ohne Netz. Das ist bewusst großzügig und kann jeder umgehen: Die
 * Testphase verschenkt nur. Mit `TESTPHASE = false` fällt alles ohne gültigen Schein auf „Kostenlos“.
 * Nur in der Testphase lässt sich eine kleinere Stufe zum Ausprobieren wählen (`vorschau`).
 *
 * Die Stufen und was sie enthalten stehen in lib/tarife.js; hier geht es nur um Echtheit und Laufzeit.
 * Der Schein liegt je Konto im Bereich „dateien“ (nicht im Tresor, nicht im Abgleich).
 */

import * as A from './ablage.js';
import { OEFFENTLICHER_SCHLUESSEL } from './lizenzschluessel.js';

export { OEFFENTLICHER_SCHLUESSEL };

/** Solange wahr, lizenziert sich jedes Konto beim Anmelden selbst (siehe oben). */
export const TESTPHASE = true;
/** Die Stufe, die die Testphase gibt. */
export const TESTPHASE_STUFE = 'max';

export const STUFEN = ['kostenlos', 'standard', 'pro', 'max'];
export const MERKER = 'lizenz';
export const PRAEFIX = 'KV1';
/** Wie weit die Uhr zurückgestellt sein darf, bevor sie auffällt, und wie oft der höchste Zeitpunkt festgehalten wird. */
const STUNDE = 60 * 60 * 1000;
const TAG = 24 * STUNDE;

const fehler = (code, text) => Object.assign(new Error(text), { code });

/* -------------------------------------------------------------------------- */
/* Schein                                                                      */
/* -------------------------------------------------------------------------- */

const zuBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vonBase64Url = (text) => {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

/** Schein bauen und signieren (Betreiber-Werkzeug scripts/lizenz-ausstellen.js und Prüfungen). `privat` ist ein CryptoKey zum Signieren. */
export async function scheinAusstellen(inhalt, privat) {
  const kopf = `${PRAEFIX}.${zuBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, ...inhalt })))}`;
  const signatur = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privat, new TextEncoder().encode(kopf));
  return `${kopf}.${zuBase64Url(signatur)}`;
}

/**
 * Prüft einen Schein und gibt seinen Inhalt zurück. Wirft einen Fehler mit `code`, wenn er nicht stimmt:
 * LIZENZ_FORMAT (kein Schein), LIZENZ_SIGNATUR (nicht vom Betreiber oder verändert), LIZENZ_INHALT.
 */
export async function scheinPruefen(text, schluessel = OEFFENTLICHER_SCHLUESSEL) {
  const teile = String(text || '').trim().split('.');
  if (teile.length !== 3 || teile[0] !== PRAEFIX) throw fehler('LIZENZ_FORMAT', 'Das ist kein Lizenzschein von Kontovia.');
  let echt = false;
  try {
    const key = await crypto.subtle.importKey('jwk', schluessel, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    echt = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, vonBase64Url(teile[2]), new TextEncoder().encode(`${teile[0]}.${teile[1]}`));
  } catch { echt = false; }
  if (!echt) throw fehler('LIZENZ_SIGNATUR', 'Der Lizenzschein ist nicht echt oder wurde verändert.');
  let inhalt;
  try { inhalt = JSON.parse(new TextDecoder().decode(vonBase64Url(teile[1]))); } catch { inhalt = null; }
  const ab = Date.parse(inhalt?.ab);
  const bis = Date.parse(inhalt?.bis);
  if (!inhalt || inhalt.v !== 1 || !STUFEN.includes(inhalt.stufe) || !(typeof inhalt.id === 'string' && inhalt.id) || !(typeof inhalt.geraet === 'string' && inhalt.geraet)
    || !(ab > 0) || !(bis > ab)) {
    throw fehler('LIZENZ_INHALT', 'Der Lizenzschein ist unvollständig.');
  }
  return {
    id: inhalt.id, stufe: inhalt.stufe, geraet: inhalt.geraet, ab: new Date(ab).toISOString(), bis: new Date(bis).toISOString(),
    schonfristTage: Math.min(60, Math.max(0, Math.floor(Number(inhalt.schonfrist) || 0))),
  };
}

/* -------------------------------------------------------------------------- */
/* Zustand                                                                     */
/* -------------------------------------------------------------------------- */

export class Lizenz {
  /**
   * @param {{geraet:()=>string|Promise<string>, schluessel?:object, testphase?:boolean, jetzt?:()=>number}} opt
   *   geraet      die Kennung dieses Geräts (an sie ist der Schein gebunden)
   *   schluessel  öffentlicher Schlüssel (Prüfungen setzen ihren eigenen ein)
   */
  constructor({ geraet, schluessel = OEFFENTLICHER_SCHLUESSEL, testphase = TESTPHASE, jetzt = Date.now } = {}) {
    this.geraet = geraet;
    this.schluessel = schluessel;
    this.testphase = testphase;
    this.jetzt = jetzt;
  }

  async #lesen() { return A.lesen('dateien', MERKER).catch(() => null); }

  /**
   * Der Stand dieses Kontos. Fehlt ein Schein und läuft die Testphase, wird das Konto hier lizenziert.
   * @returns {Promise<{zustand:string, stufe:string, gebucht:string, bis:string|null, schonfristBis:string|null,
   *   id:string, testphase:boolean, geraet:string, vorschau:string|null}>}
   */
  async status() {
    const geraet = String(await this.geraet());
    const jetzt = this.jetzt();
    let rec = await this.#lesen();
    const basis = { testphase: this.testphase, geraet, bis: null, schonfristBis: null, id: '', vorschau: null, gebucht: 'kostenlos' };

    // Ein Schein zählt nur, wenn er noch echt ist und für dieses Gerät ausgestellt wurde.
    if (rec?.art === 'lizenz') {
      let s = null;
      try { s = await scheinPruefen(rec.schein, this.schluessel); } catch { s = null; }
      if (s && s.geraet === geraet) {
        // Uhr zurückgestellt? Dann gilt der höchste Zeitpunkt, der je gesehen wurde.
        const jetztWirksam = Math.max(jetzt, Number(rec.zuletzt) || 0);
        if (jetzt > (Number(rec.zuletzt) || 0) + STUNDE) await A.schreiben('dateien', MERKER, { ...rec, zuletzt: jetzt }).catch(() => {});
        const bis = Date.parse(s.bis);
        const schonfristBis = bis + s.schonfristTage * TAG;
        const zustand = jetztWirksam < Date.parse(s.ab) ? 'abgelaufen' : jetztWirksam <= bis ? 'lizenziert' : jetztWirksam <= schonfristBis ? 'schonfrist' : 'abgelaufen';
        return {
          ...basis, zustand, id: s.id, gebucht: s.stufe, bis: s.bis, schonfristBis: new Date(schonfristBis).toISOString(),
          stufe: zustand === 'abgelaufen' ? 'kostenlos' : s.stufe,
        };
      }
      rec = null;
    }

    if (this.testphase) {
      if (rec?.art !== 'testphase') {
        rec = { v: 1, art: 'testphase', id: crypto.randomUUID(), seit: new Date(jetzt).toISOString(), vorschau: '' };
        await A.schreiben('dateien', MERKER, rec).catch(() => {});
      }
      const vorschau = STUFEN.includes(rec.vorschau) ? rec.vorschau : null;
      return { ...basis, zustand: 'testphase', id: rec.id, gebucht: TESTPHASE_STUFE, stufe: vorschau || TESTPHASE_STUFE, vorschau };
    }

    // Die Testphase ist vorbei: wer sie hatte, steht jetzt ohne Schein da.
    return { ...basis, zustand: rec?.art === 'testphase' ? 'testphase-vorbei' : 'keine', id: rec?.id || '', stufe: 'kostenlos' };
  }

  /** Einen Schein einlösen. Wirft bei einem unechten, fremden oder bereits abgelaufenen Schein. */
  async aktivieren(text) {
    const s = await scheinPruefen(text, this.schluessel);
    const geraet = String(await this.geraet());
    if (s.geraet !== geraet) throw fehler('LIZENZ_GERAET', 'Dieser Lizenzschein gehört zu einem anderen Gerät. Er muss für die Kennung dieses Geräts ausgestellt werden.');
    const jetzt = this.jetzt();
    if (jetzt > Date.parse(s.bis) + s.schonfristTage * TAG) throw fehler('LIZENZ_ABGELAUFEN', 'Dieser Lizenzschein ist abgelaufen.');
    await A.schreiben('dateien', MERKER, { v: 1, art: 'lizenz', schein: String(text).trim(), zuletzt: jetzt, eingeloest: new Date(jetzt).toISOString() });
    return this.status();
  }

  /** Den Schein entfernen. In der Testphase lizenziert sich das Konto danach von selbst neu. */
  async entfernen() {
    await A.loeschen('dateien', MERKER).catch(() => {});
    return this.status();
  }

  /** Nur in der Testphase: eine kleinere Stufe zum Ausprobieren wählen (leer = die volle). */
  async vorschauSetzen(stufe) {
    if (!this.testphase) throw fehler('LIZENZ_TESTPHASE', 'Das gibt es nur in der Testphase.');
    const wahl = STUFEN.includes(stufe) && stufe !== TESTPHASE_STUFE ? stufe : '';
    await this.status();
    const rec = await this.#lesen();
    if (rec?.art === 'testphase') await A.schreiben('dateien', MERKER, { ...rec, vorschau: wahl });
    return this.status();
  }
}
