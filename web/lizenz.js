/**
 * Kontovia – Lizenz: Stufe des Kontos, ohne Netz prüfbar.
 *
 * Eine Lizenz ist ein signierter Schein (ECDSA P-256, SHA-256): `KV1.<Inhalt>.<Signatur>`. Der Inhalt nennt
 * Stufe, Laufzeit und wofür er gilt, die Signatur stammt vom Betreiber. Die App trägt nur den öffentlichen
 * Schlüssel; einen Schein kann niemand ändern oder selbst ausstellen, auch nicht über die Browser-Konsole.
 * Geprüft wird bei jedem Abruf neu; abgelegt ist nur der Schein selbst, nie ein Ergebnis („Pro“ o. Ä.).
 *
 * Zwei Arten von Scheinen:
 *   Gerät   `geraet` = Kennung dieses Geräts; der Nutzer fügt ihn von Hand ein (Lizenzkarte). Ein kopierter
 *           Schein auf einem anderen Gerät wird abgelehnt.
 *   Konto   `email` = Adresse des Google-Kontos. Der Betreiber legt ihn in der Lizenzverwaltung
 *           (lizenzverwaltung.js) unter lizenzen/<email>.json im Cloud-Speicher ab; lesen darf ihn nur, wer mit
 *           genau dieser bestätigten Adresse angemeldet ist (firebase/storage.rules). `abgleichen` holt ihn ab.
 *           Er gilt nur, solange dieselbe Adresse in Kontovia angemeldet ist, und muss alle `PRUEFFRIST_TAGE`
 *           online bestätigt werden: Löscht der Betreiber ihn, fällt das Konto beim nächsten Abgleich zurück,
 *           spätestens nach der Prüffrist, auch wenn das Gerät nie mehr online geht.
 *
 * Die Laufzeit hat eine Schonfrist: Wer länger offline ist, behält seine Stufe, bis sie vorbei ist, und
 * bleibt danach auf „Kostenlos“ – Lesen und Exportieren (CSV, Excel, Sicherung) gehen immer. Wird die Uhr
 * zurückgestellt, zählt der höchste je gesehene Zeitpunkt.
 *
 * Testphase (`TESTPHASE`): Solange sie läuft, hat jedes Konto mindestens die höchste Stufe, ohne Schein und
 * ohne Netz. Das ist bewusst großzügig und kann jeder umgehen: Die Testphase verschenkt nur. Zugewiesene
 * Scheine werden trotzdem abgeholt und angezeigt (`lizenz`) und tragen, sobald `TESTPHASE = false` ist.
 * Nur in der Testphase lässt sich eine kleinere Stufe zum Ausprobieren wählen (`vorschau`).
 *
 * Grenzen des Schutzes: Alles hier läuft auf dem Gerät des Nutzers. Wer den Programmcode verändert oder die
 * Ablage des Browsers von Hand bearbeitet, kommt an jeder Prüfung vorbei; geschützt ist das Fälschen und
 * Weitergeben von Scheinen, nicht ein umgebautes Programm (README, Abschnitt Lizenzen).
 *
 * Die Stufen und was sie enthalten stehen in lib/tarife.js; hier geht es nur um Echtheit und Laufzeit.
 * Die Scheine liegen je Konto im Bereich „dateien“ (nicht im Tresor, nicht im Abgleich).
 */

import * as A from './ablage.js';
import { OEFFENTLICHER_SCHLUESSEL } from './lizenzschluessel.js';

export { OEFFENTLICHER_SCHLUESSEL };

/** Solange wahr, hat jedes Konto die Stufe der Testphase (siehe oben). */
export const TESTPHASE = true;
/** Die Stufe, die die Testphase gibt. */
export const TESTPHASE_STUFE = 'max';

export const STUFEN = ['kostenlos', 'standard', 'pro', 'max'];
/** Gerätelizenz oder Merker der Testphase. */
export const MERKER = 'lizenz';
/** Lizenz des Google-Kontos (aus dem Cloud-Speicher abgeholt). */
export const MERKER_KONTO = 'lizenz-konto';
/** Welche Kontokennung schon in der Kontenliste des Betreibers steht (damit nur einmal gemeldet wird). */
export const MERKER_GEMELDET = 'lizenz-gemeldet';
export const PRAEFIX = 'KV1';
/** So lange gilt eine Kontolizenz ohne erneute Bestätigung durch den Cloud-Speicher. */
export const PRUEFFRIST_TAGE = 30;
/** Wie weit die Uhr zurückgestellt sein darf, bevor sie auffällt, und wie oft der höchste Zeitpunkt festgehalten wird. */
const STUNDE = 60 * 60 * 1000;
const TAG = 24 * STUNDE;

const fehler = (code, text) => Object.assign(new Error(text), { code });
const rang = (stufe) => Math.max(0, STUFEN.indexOf(stufe));

/* -------------------------------------------------------------------------- */
/* E-Mail-Adressen                                                             */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/;

/** Kleingeschrieben und ohne Leerraum; leer, wenn es keine Adresse ist. */
export function emailNorm(text) {
  const e = String(text ?? '').trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : '';
}

/** Google meldet dieselbe Adresse je nach Konto als gmail.com oder googlemail.com: beide Schreibweisen. */
export function emailVarianten(text) {
  const e = emailNorm(text);
  if (!e) return [];
  const [name, domain] = e.split('@');
  if (domain === 'gmail.com') return [e, `${name}@googlemail.com`];
  if (domain === 'googlemail.com') return [e, `${name}@gmail.com`];
  return [e];
}

/** Dieselbe Adresse (gmail.com und googlemail.com gelten gleich)? */
export const emailGleich = (a, b) => !!emailNorm(a) && emailVarianten(a).includes(emailNorm(b));

/* -------------------------------------------------------------------------- */
/* Schein                                                                      */
/* -------------------------------------------------------------------------- */

const zuBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vonBase64Url = (text) => {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

/** Schein bauen und signieren (Lizenzverwaltung, scripts/lizenz-ausstellen.js, Prüfungen). `privat` ist ein CryptoKey zum Signieren. */
export async function scheinAusstellen(inhalt, privat) {
  const kopf = `${PRAEFIX}.${zuBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, ...inhalt })))}`;
  const signatur = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privat, new TextEncoder().encode(kopf));
  return `${kopf}.${zuBase64Url(signatur)}`;
}

/**
 * Prüft einen Schein und gibt seinen Inhalt zurück. Wirft einen Fehler mit `code`, wenn er nicht stimmt:
 * LIZENZ_FORMAT (kein Schein), LIZENZ_SIGNATUR (nicht vom Betreiber oder verändert), LIZENZ_INHALT.
 * Ein Schein gilt entweder für ein Gerät (`geraet`) oder für ein Konto (`email`), nie für beides.
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
  const geraet = typeof inhalt?.geraet === 'string' ? inhalt.geraet : '';
  const email = inhalt?.email === undefined ? '' : emailNorm(inhalt.email);
  if (!inhalt || inhalt.v !== 1 || !STUFEN.includes(inhalt.stufe) || !(typeof inhalt.id === 'string' && inhalt.id)
    || (inhalt.email !== undefined && !email) || !(geraet || email) || (geraet && email) || !(ab > 0) || !(bis > ab)) {
    throw fehler('LIZENZ_INHALT', 'Der Lizenzschein ist unvollständig.');
  }
  return {
    id: inhalt.id, stufe: inhalt.stufe, geraet, email, ab: new Date(ab).toISOString(), bis: new Date(bis).toISOString(),
    schonfristTage: Math.min(60, Math.max(0, Math.floor(Number(inhalt.schonfrist) || 0))),
  };
}

/** Laufzeit eines geprüften Scheins zum (wirksamen) Zeitpunkt. */
function laufzeit(s, jetztWirksam) {
  const bis = Date.parse(s.bis);
  const schonfristBis = bis + s.schonfristTage * TAG;
  const zustand = jetztWirksam < Date.parse(s.ab) ? 'abgelaufen' : jetztWirksam <= bis ? 'lizenziert' : jetztWirksam <= schonfristBis ? 'schonfrist' : 'abgelaufen';
  return { zustand, schonfristBis: new Date(schonfristBis).toISOString() };
}

/** Die bessere von zwei Lizenzen: die mit der höheren wirksamen Stufe, sonst die länger laufende. */
function besser(a, b) {
  if (!a || !b) return a || b;
  if (rang(a.stufe) !== rang(b.stufe)) return rang(a.stufe) > rang(b.stufe) ? a : b;
  return Date.parse(a.bis) >= Date.parse(b.bis) ? a : b;
}

/* -------------------------------------------------------------------------- */
/* Zustand                                                                     */
/* -------------------------------------------------------------------------- */

export class Lizenz {
  /**
   * @param {{geraet:()=>string|Promise<string>, konto?:()=>({email:string, uid?:string}|null|Promise<object|null>),
   *   abruf?:(email:string)=>Promise<{art:string, text?:string, serverZeit?:number}>, melden?:()=>Promise<unknown>,
   *   schluessel?:object, testphase?:boolean, jetzt?:()=>number}} opt
   *   geraet      die Kennung dieses Geräts (an sie ist ein Geräteschein gebunden)
   *   konto       das angemeldete Google-Konto (an seine Adresse ist ein Kontoschein gebunden), sonst null
   *   abruf       holt den Kontoschein aus dem Cloud-Speicher: art 'gefunden' (mit text), 'fehlt' (sicher nicht da),
   *               sonst unklar ('netz', 'anmeldung', 'unklar'); serverZeit = Zeit des Servers
   *   melden      trägt das Konto einmal in die Kontenliste des Betreibers ein
   *   schluessel  öffentlicher Schlüssel (Prüfungen setzen ihren eigenen ein)
   */
  constructor({ geraet, konto = () => null, abruf = null, melden = null, schluessel = OEFFENTLICHER_SCHLUESSEL, testphase = TESTPHASE, jetzt = Date.now } = {}) {
    this.geraet = geraet;
    this.konto = konto;
    this.abruf = abruf;
    this.melden = melden;
    this.schluessel = schluessel;
    this.testphase = testphase;
    this.jetzt = jetzt;
  }

  async #lesen(merker = MERKER) { return A.lesen('dateien', merker).catch(() => null); }

  async #kontoJetzt() {
    try {
      const k = await this.konto();
      const email = emailNorm(k?.email);
      return email ? { email, uid: String(k.uid || '') } : null;
    } catch { return null; }
  }

  /** Uhr zurückgestellt? Dann gilt der höchste Zeitpunkt, der je gesehen wurde; ab und zu festhalten. */
  async #wirksam(merker, rec, jetzt) {
    if (jetzt > (Number(rec.zuletzt) || 0) + STUNDE) await A.schreiben('dateien', merker, { ...rec, zuletzt: jetzt }).catch(() => {});
    return Math.max(jetzt, Number(rec.zuletzt) || 0);
  }

  /** Geräteschein, wenn er echt ist und für dieses Gerät ausgestellt wurde. */
  async #geraeteLizenz(rec, geraet, jetzt) {
    if (rec?.art !== 'lizenz') return null;
    let s = null;
    try { s = await scheinPruefen(rec.schein, this.schluessel); } catch { s = null; }
    if (!s || !s.geraet || s.geraet !== geraet) return null;
    const { zustand, schonfristBis } = laufzeit(s, await this.#wirksam(MERKER, rec, jetzt));
    return { quelle: 'geraet', zustand, id: s.id, gebucht: s.stufe, stufe: zustand === 'abgelaufen' ? 'kostenlos' : s.stufe, bis: s.bis, schonfristBis, bestaetigtBis: null };
  }

  /** Kontoschein, wenn er echt ist, zur angemeldeten Adresse gehört und nicht zu lange unbestätigt ist. */
  async #kontoLizenz(konto, jetzt) {
    const rec = await this.#lesen(MERKER_KONTO);
    if (rec?.art !== 'konto' || !konto) return null;
    let s = null;
    try { s = await scheinPruefen(rec.schein, this.schluessel); } catch { s = null; }
    if (!s || !s.email || !emailGleich(s.email, konto.email)) return null;
    const jetztWirksam = await this.#wirksam(MERKER_KONTO, rec, jetzt);
    let { zustand, schonfristBis } = laufzeit(s, jetztWirksam);
    const bestaetigtBis = (Number(rec.bestaetigt) || 0) + PRUEFFRIST_TAGE * TAG;
    if (zustand !== 'abgelaufen' && jetztWirksam > bestaetigtBis) zustand = 'unbestaetigt';
    const gilt = zustand === 'lizenziert' || zustand === 'schonfrist';
    return {
      quelle: 'email', zustand, id: s.id, gebucht: s.stufe, stufe: gilt ? s.stufe : 'kostenlos', bis: s.bis, schonfristBis,
      bestaetigtBis: new Date(bestaetigtBis).toISOString(), lizenzEmail: s.email,
    };
  }

  /**
   * Der Stand dieses Kontos. Fehlt ein Schein und läuft die Testphase, wird das Konto hier lizenziert.
   * @returns {Promise<{zustand:string, stufe:string, gebucht:string, bis:string|null, schonfristBis:string|null,
   *   id:string, testphase:boolean, geraet:string, vorschau:string|null, email:string, quelle:string,
   *   bestaetigtBis:string|null, lizenz:object|null}>}
   *   zustand  testphase, lizenziert, schonfrist, abgelaufen, unbestaetigt (Kontoschein zu lange nicht bestätigt),
   *            testphase-vorbei, keine
   *   email    angemeldetes Google-Konto ('' = keins)
   *   lizenz   die beste zugewiesene Lizenz (auch in der Testphase, dort nur zur Anzeige)
   */
  async status() {
    const geraet = String(await this.geraet());
    const konto = await this.#kontoJetzt();
    const jetzt = this.jetzt();
    let rec = await this.#lesen();
    const basis = {
      testphase: this.testphase, geraet, email: konto?.email || '', bis: null, schonfristBis: null, bestaetigtBis: null,
      id: '', vorschau: null, gebucht: 'kostenlos', quelle: '', lizenz: null,
    };

    const g = await this.#geraeteLizenz(rec, geraet, jetzt);
    if (rec?.art === 'lizenz' && !g) rec = null;
    const beste = besser(g, await this.#kontoLizenz(konto, jetzt));
    const kurz = beste && { quelle: beste.quelle, zustand: beste.zustand, stufe: beste.gebucht, bis: beste.bis, id: beste.id };

    if (this.testphase) {
      // Mindestens die Stufe der Testphase; der Merker gibt die Kennung und die gewählte Vorschau.
      if (!g && rec?.art !== 'testphase') {
        rec = { v: 1, art: 'testphase', id: crypto.randomUUID(), seit: new Date(jetzt).toISOString(), vorschau: '' };
        await A.schreiben('dateien', MERKER, rec).catch(() => {});
      }
      const vorschau = rec?.art === 'testphase' && STUFEN.includes(rec.vorschau) ? rec.vorschau : null;
      const voll = beste && rang(beste.stufe) > rang(TESTPHASE_STUFE) ? beste.stufe : TESTPHASE_STUFE;
      return {
        ...basis, zustand: 'testphase', id: rec?.art === 'testphase' ? rec.id : beste?.id || '', gebucht: voll, stufe: vorschau || voll, vorschau,
        lizenz: kurz,
      };
    }

    if (beste) {
      const { lizenzEmail: _e, ...rest } = beste;
      return { ...basis, ...rest, lizenz: kurz };
    }

    // Die Testphase ist vorbei: wer sie hatte, steht jetzt ohne Schein da.
    return { ...basis, zustand: rec?.art === 'testphase' ? 'testphase-vorbei' : 'keine', id: rec?.id || '', stufe: 'kostenlos' };
  }

  /**
   * Fragt den Cloud-Speicher nach dem Schein des angemeldeten Kontos und meldet das Konto einmal in der
   * Kontenliste des Betreibers. Ohne Konto oder Netz ändert sich nichts.
   * @returns {Promise<{ergebnis:string, status:object}>}
   *   ergebnis  ohne-konto, gefunden, fehlt (entzogen oder nie zugewiesen), ungueltig (Schein passt nicht), netz,
   *             anmeldung, unklar
   */
  async abgleichen() {
    const konto = await this.#kontoJetzt();
    if (!konto || typeof this.abruf !== 'function') return { ergebnis: 'ohne-konto', status: await this.status() };
    if (typeof this.melden === 'function') {
      const gemeldet = await this.#lesen(MERKER_GEMELDET);
      const schluessel = `${konto.uid}|${konto.email}`;
      if (gemeldet?.konto !== schluessel) {
        try {
          await this.melden(konto);
          await A.schreiben('dateien', MERKER_GEMELDET, { v: 1, konto: schluessel });
        } catch { /* beim nächsten Abgleich wieder */ }
      }
    }
    let a;
    try { a = await this.abruf(konto.email); } catch { a = { art: 'netz' }; }
    let ergebnis = ['gefunden', 'fehlt', 'netz', 'anmeldung'].includes(a?.art) ? a.art : 'unklar';
    const jetzt = this.jetzt();
    if (ergebnis === 'gefunden') {
      let s = null;
      try { s = await scheinPruefen(a.text, this.schluessel); } catch { s = null; }
      if (s?.email && emailGleich(s.email, konto.email)) {
        const alt = await this.#lesen(MERKER_KONTO);
        await A.schreiben('dateien', MERKER_KONTO, {
          v: 1, art: 'konto', schein: String(a.text).trim(), email: s.email,
          bestaetigt: Number(a.serverZeit) > 0 ? Number(a.serverZeit) : jetzt,
          zuletzt: Math.max(jetzt, Number(alt?.zuletzt) || 0),
        });
      } else {
        ergebnis = 'ungueltig';
      }
    } else if (ergebnis === 'fehlt') {
      // Der Speicher sagt sicher „nicht da“: Der Betreiber hat die Lizenz entzogen.
      await A.loeschen('dateien', MERKER_KONTO).catch(() => {});
    }
    return { ergebnis, status: await this.status() };
  }

  /** Einen Geräteschein einlösen. Wirft bei einem unechten, fremden oder bereits abgelaufenen Schein. */
  async aktivieren(text) {
    const s = await scheinPruefen(text, this.schluessel);
    if (s.email) throw fehler('LIZENZ_KONTO', 'Diese Lizenz gehört zu einem Google-Konto. Melden Sie sich mit diesem Konto an, dann wird sie von selbst übernommen.');
    const geraet = String(await this.geraet());
    if (s.geraet !== geraet) throw fehler('LIZENZ_GERAET', 'Dieser Lizenzschein gehört zu einem anderen Gerät. Er muss für die Kennung dieses Geräts ausgestellt werden.');
    const jetzt = this.jetzt();
    if (jetzt > Date.parse(s.bis) + s.schonfristTage * TAG) throw fehler('LIZENZ_ABGELAUFEN', 'Dieser Lizenzschein ist abgelaufen.');
    await A.schreiben('dateien', MERKER, { v: 1, art: 'lizenz', schein: String(text).trim(), zuletzt: jetzt, eingeloest: new Date(jetzt).toISOString() });
    return this.status();
  }

  /** Den Geräteschein entfernen. In der Testphase lizenziert sich das Konto danach von selbst neu. */
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
