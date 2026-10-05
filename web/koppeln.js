/**
 * Kontovia – ein weiteres Gerät koppeln, Web-Fassung.
 *
 * Ein Gerät, auf dem Kontovia offen ist (Geber), übergibt den Datenschlüssel
 * an ein neues Gerät (Nehmer), das sich bei demselben Google-Konto angemeldet
 * hat, ohne dass der Betreiber, Google oder jemand mit Zugriff auf den
 * Cloud-Speicher ihn je erfährt. Zwei voneinander unabhängige Dinge müssen
 * zusammenkommen: das Google-Konto (Zugang zu den Dateien) und der QR-Code
 * (das Geheimnis S). Keines von beiden allein genügt.
 *
 *   Geber                                        Nehmer
 *   S = 128 Bit Zufall, nur im QR-Code ──(Kamera)──▶ S
 *                                                    erzeugt ein kurzlebiges Schlüsselpaar (ECDH P-256)
 *                                                    legt <id>.anfrage ab: Name und öffentlicher Teil,
 *                                                    mit einem Schlüssel aus S verschlossen
 *   liest die Anfrage, zeigt den Gerätenamen,
 *   der Nutzer bestätigt
 *   erzeugt ein eigenes kurzlebiges Paar
 *   legt <id>.antwort ab: der Datenschlüssel,
 *   verpackt mit HKDF(ECDH-Ergebnis | S)  ──(Cloud)──▶ öffnet sie, löscht beide Dateien
 *
 * Was in der Cloud liegt, ist ohne S wertlos: Die Anfrage ist mit einem aus S
 * abgeleiteten Schlüssel verschlossen (der Gerätename steht nie im Klartext
 * dort), die Antwort zusätzlich mit dem Ergebnis des Schlüsselaustauschs.
 * Wer nur das Google-Konto hat, kann keine gültige Anfrage stellen und keine
 * Antwort lesen. Wer nur den QR-Code hat, kommt nicht an die Dateien. Wer
 * beides hat, würde als Gerät mit seinem Namen auf dem Bildschirm des Gebers
 * erscheinen, wo der Nutzer es ablehnt.
 *
 * Das Geheimnis wird nie über das Netz gesendet, nie in eine Adresse vor dem
 * Anker (#) geschrieben, nie protokolliert. Die Dateien liegen höchstens
 * wenige Minuten; weil es keinen eigenen Server gibt, räumen die Geräte selbst
 * auf (aufraeumen). Alles Netz geht durch den Ablage-Baustein (firebase.js);
 * hier steht nur Logik, die sich mit einer nachgebildeten Cloud prüfen lässt.
 */

import * as K from './kern.js';

export const INFO = 'kontovia/koppeln/v1';
/** So lange gilt ein Code, vom Anzeigen an. */
export const GUELTIG_MS = 5 * 60 * 1000;
/** Uhren von Handy und Rechner gehen nie ganz gleich. */
const TOLERANZ_MS = 10 * 60 * 1000;
/** Nach dieser Zeit (zusätzlich zur Gültigkeit) gilt ein liegengebliebenes Paket als Rest. */
const REST_MS = 15 * 60 * 1000;
const ABFRAGE_MS = 1500;
const MAX_NETZFEHLER = 12;
/** So oft muss der Geber nach der Freigabe beide Dateien weg sehen, bevor er „fehlgeschlagen“ meldet. */
const LEER_BIS_MISSERFOLG = 4;

/** Ohne 0, 1, I und O, damit sich nichts verwechseln lässt. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LAENGE = 26;
export const DATEI_RE = /^[a-f0-9]{20}\.(anfrage|antwort)$/;

const fehler = (code, text) => Object.assign(new Error(text), { code });
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* Code                                                                        */
/* -------------------------------------------------------------------------- */

function nachBase32(bytes) {
  let bits = 0;
  let wert = 0;
  let out = '';
  for (const b of bytes) {
    wert = (wert << 8) | b;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(wert >>> (bits - 5)) & 31]; bits -= 5; }
    wert &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(wert << (5 - bits)) & 31];
  return out;
}

/** Ein frisches Geheimnis: 16 Zufallsbyte (128 Bit). */
export const geheimnisErzeugen = () => K.randomBytes(16);

/** Das Geheimnis als Text für QR-Code und Eingabe: 26 Zeichen. */
export const codeText = (geheimnis) => nachBase32(geheimnis);

/** Zum Vorlesen und Abtippen in Vierergruppen. */
export const codeAnzeige = (code) => String(code).match(/.{1,4}/g)?.join('-') || '';

/**
 * Liest einen eingetippten oder gescannten Code. Leerzeichen, Striche und
 * Kleinbuchstaben sind egal; auch eine ganze Adresse mit #koppeln=… geht.
 * @returns {Uint8Array|null} das Geheimnis, oder null, wenn der Code nicht stimmt
 */
export function codeLesen(eingabe) {
  let s = String(eingabe ?? '');
  const m = /[#&?]koppeln=([^&\s]+)/i.exec(s);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LAENGE) return null;
  let bits = 0;
  let wert = 0;
  const out = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    wert = (wert << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((wert >>> (bits - 8)) & 255); bits -= 8; }
    wert &= (1 << bits) - 1;
  }
  // 26 Zeichen tragen 130 Bit; die zwei überzähligen müssen null sein (fängt Tippfehler am Ende).
  if (out.length !== 16 || wert !== 0) return null;
  return Uint8Array.from(out);
}

/** Die Adresse im QR-Code. Das Geheimnis steht hinter dem #, den der Browser nie sendet. */
export const kopplungsAdresse = (basis, code) => `${String(basis).replace(/[#?].*$/, '')}#koppeln=${code}`;

/** Ein Code in der Adresse der Seite? Holt ihn und entfernt ihn dort sofort. */
export function codeAusAdresse({ loc = globalThis.location, hist = globalThis.history } = {}) {
  const m = /(?:^#|&)koppeln=([^&]+)/.exec(loc?.hash || '');
  if (!m) return null;
  const rest = String(loc.hash).replace(/^#/, '').split('&').filter((t) => !t.startsWith('koppeln=')).join('&');
  try { hist.replaceState(null, '', loc.pathname + loc.search + (rest ? `#${rest}` : '')); } catch { /* egal */ }
  return decodeURIComponent(m[1]);
}

/* -------------------------------------------------------------------------- */
/* Ableitungen                                                                 */
/* -------------------------------------------------------------------------- */

async function ableiten(geheimnis) {
  const [id, anfrage] = await Promise.all([
    K.subKey(geheimnis, `${INFO}/id`, 10),
    K.subKey(geheimnis, `${INFO}/anfrage`),
  ]);
  return { pid: K.toHex(id), kAnfrage: anfrage };
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const schluesselpaar = () => crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
const oeffentlich = async (paar) => new Uint8Array(await crypto.subtle.exportKey('raw', paar.publicKey));

async function gemeinsam(privat, rohOeffentlich) {
  let pub;
  try { pub = await crypto.subtle.importKey('raw', rohOeffentlich, ECDH, false, []); } catch { throw fehler('KOPPELN_UNGUELTIG', 'Die Anfrage des Geräts ist unlesbar.'); }
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privat, 256));
}

const aadAnfrage = (uid, pid, ts) => K.utf8(`${INFO}|anfrage|${uid}|${pid}|${ts}`);
const aadAntwort = (uid, pid, exp, pubNehmer, pubGeber) => K.utf8(`${INFO}|antwort|${uid}|${pid}|${exp}|${pubNehmer}|${pubGeber}`);
const wickelSchluessel = (gemeinsames, geheimnis) => K.subKey(K.concat(gemeinsames, geheimnis), `${INFO}/antwort`);

/** Ein Gerätename aus fremder Hand: kurz, ohne Steuerzeichen und Tags. */
export function geraeteNameBereinigen(name, ersatz = 'Neues Gerät') {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return s || ersatz;
}

const lesenJson = (bytes) => { try { return JSON.parse(K.fromUtf8(bytes)); } catch { return null; } };

/* -------------------------------------------------------------------------- */
/* Geber: das Gerät, auf dem Kontovia offen ist                                */
/* -------------------------------------------------------------------------- */

export class Geber {
  /**
   * @param {{backend:object, uid:string, dekHolen:()=>Uint8Array, jetzt?:()=>number}} p
   *   backend: koppelnLesen, koppelnSchreiben, koppelnLoeschen, koppelnListe (firebase.js)
   */
  constructor({ backend, uid, dekHolen, jetzt = () => Date.now() }) {
    this.backend = backend;
    this.uid = String(uid || '');
    this.dekHolen = dekHolen;
    this.jetzt = jetzt;
    this.geheimnis = null;
    this.pid = '';
    this.kAnfrage = null;
    this.bis = 0;
    this.zustand = 'neu';
    this.anfrage = null;
    this.ende = '';
    this.netzfehler = 0;
    this.leer = 0;
  }

  /** Erzeugt Geheimnis und Kennung. Es geht noch nichts ins Netz. @returns {{code:string, gueltigBis:number}} */
  async starten() {
    if (!this.uid) throw fehler('NICHT_VERBUNDEN', 'Dazu muss Kontovia mit Ihrem Google-Konto verbunden sein.');
    this.geheimnis = geheimnisErzeugen();
    const a = await ableiten(this.geheimnis);
    this.pid = a.pid;
    this.kAnfrage = a.kAnfrage;
    this.bis = this.jetzt() + GUELTIG_MS;
    this.zustand = 'wartet';
    return { code: codeText(this.geheimnis), gueltigBis: this.bis };
  }

  /** Der Stand für die Oberfläche; nie etwas Geheimes. */
  stand() {
    return {
      zustand: this.ende || this.zustand,
      gueltigBis: this.bis,
      name: this.anfrage?.name || '',
      seit: this.anfrage?.seit || '',
    };
  }

  /** Fragt die Cloud, ob sich ein Gerät gemeldet hat (und später, ob es die Antwort geholt hat). */
  async abfragen() {
    if (this.ende) return this.stand();
    if (this.jetzt() > this.bis) { await this.beenden('abgelaufen'); return this.stand(); }
    try {
      if (this.zustand === 'wartet') {
        const roh = await this.backend.koppelnLesen(`${this.pid}.anfrage`);
        this.netzfehler = 0;
        if (roh) await this.anfrageLesen(roh);
      } else if (this.zustand === 'bereit') {
        const roh = await this.backend.koppelnLesen(`${this.pid}.antwort`);
        this.netzfehler = 0;
        // Der Nehmer löscht die Antwort, sobald er sie hat. Bleibt seine Anfrage stehen, hat es geklappt;
        // hat er auch sie entfernt, brach er ab oder die Antwort passte nicht. Ein einzelner leerer Blick
        // zählt nicht als Misserfolg (Verzögerungen im Speicher): erst mehrere hintereinander.
        if (roh) this.leer = 0;
        else {
          const anfrageNoch = await this.backend.koppelnLesen(`${this.pid}.anfrage`);
          if (anfrageNoch) await this.beenden('fertig');
          else if (++this.leer >= LEER_BIS_MISSERFOLG) await this.beenden('fehlgeschlagen');
        }
      }
    } catch (e) {
      // Kurze Netzausfälle beenden nichts; die Gültigkeit läuft ohnehin ab.
      if (e?.code === 'KOPPELN_UNGUELTIG') await this.beenden('ungueltig');
      else this.netzfehler++;
    }
    return this.stand();
  }

  async anfrageLesen(roh) {
    const j = lesenJson(roh);
    if (j?.v !== 1 || typeof j.ts !== 'string' || typeof j.ct !== 'string') throw fehler('KOPPELN_UNGUELTIG', 'Die Anfrage ist unlesbar.');
    const ts = Date.parse(j.ts);
    // Eine Anfrage muss zu diesem Code passen: nach dem Anzeigen entstanden, nicht aus der Zukunft.
    if (!(ts >= this.bis - GUELTIG_MS - TOLERANZ_MS) || ts > this.jetzt() + TOLERANZ_MS) throw fehler('KOPPELN_UNGUELTIG', 'Die Anfrage passt nicht zu diesem Code.');
    let inhalt;
    try {
      inhalt = lesenJson(await K.open(this.kAnfrage, K.fromBase64(j.ct), aadAnfrage(this.uid, this.pid, j.ts)));
    } catch { throw fehler('KOPPELN_UNGUELTIG', 'Die Anfrage passt nicht zu diesem Code.'); }
    const pub = inhalt?.pub ? K.fromBase64(inhalt.pub) : null;
    if (!pub || pub.length !== 65 || pub[0] !== 4) throw fehler('KOPPELN_UNGUELTIG', 'Die Anfrage ist unlesbar.');
    this.anfrage = { name: geraeteNameBereinigen(inhalt.name), pub, pubText: inhalt.pub, seit: j.ts };
    this.zustand = 'anfrage';
  }

  /** Der Nutzer hat das Gerät erkannt: den Datenschlüssel verpackt für genau dieses Gerät ablegen. */
  async bestaetigen() {
    if (this.zustand !== 'anfrage' || this.ende) throw fehler('KOPPELN_ZUSTAND', 'Im Moment wartet kein Gerät auf die Freigabe.');
    if (this.jetzt() > this.bis) { await this.beenden('abgelaufen'); throw fehler('KOPPELN_ABGELAUFEN', 'Der Code ist abgelaufen. Bitte starten Sie noch einmal neu.'); }
    const dek = this.dekHolen();
    const paar = await schluesselpaar();
    const eigen = await oeffentlich(paar);
    const eigenText = K.toBase64(eigen);
    const gemeinsames = await gemeinsam(paar.privateKey, this.anfrage.pub);
    const kWickel = await wickelSchluessel(gemeinsames, this.geheimnis);
    try {
      const exp = new Date(this.bis).toISOString();
      const ct = await K.seal(kWickel, dek, aadAntwort(this.uid, this.pid, exp, this.anfrage.pubText, eigenText));
      await this.backend.koppelnSchreiben(`${this.pid}.antwort`, K.utf8(JSON.stringify({ v: 1, exp, pub: eigenText, ct: K.toBase64(ct) })));
    } finally { K.wipe(gemeinsames); K.wipe(kWickel); }
    this.zustand = 'bereit';
    return this.stand();
  }

  /** „Das bin nicht ich“ oder Abbruch: alles löschen, Geheimnis überschreiben. */
  async beenden(grund = 'abgebrochen') {
    if (this.ende) return this.stand();
    this.ende = grund;
    const geheimnis = this.geheimnis;
    this.geheimnis = null;
    if (geheimnis) K.wipe(geheimnis);
    if (this.kAnfrage) K.wipe(this.kAnfrage);
    this.kAnfrage = null;
    this.rest = false;
    if (this.pid) {
      for (const d of ['anfrage', 'antwort']) {
        try { await this.backend.koppelnLoeschen(`${this.pid}.${d}`); } catch { this.rest = true; }
      }
    }
    return this.stand();
  }
}

/* -------------------------------------------------------------------------- */
/* Nehmer: das neue Gerät                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Meldet das neue Gerät beim Geber an und wartet auf den Datenschlüssel.
 * @param {{backend:object, uid:string, code:string, name:string, jetzt?:()=>number, warten?:(ms:number)=>Promise, abbruch?:AbortSignal, onStand?:Function}} p
 * @returns {Promise<Uint8Array>} der Datenschlüssel (der Aufrufer überschreibt ihn nach Gebrauch)
 */
export async function verbinden({ backend, uid, code, name, jetzt = () => Date.now(), warten = schlafen, abbruch = null, onStand = () => {} }) {
  const geheimnis = codeLesen(code);
  if (!geheimnis) throw fehler('KOPPELN_CODE', 'Dieser Code stimmt nicht. Bitte prüfen Sie ihn oder scannen Sie den QR-Code noch einmal.');
  if (!uid) throw fehler('NICHT_VERBUNDEN', 'Bitte melden Sie sich zuerst bei Google an.');
  const { pid, kAnfrage } = await ableiten(geheimnis);
  const paar = await schluesselpaar();
  const eigen = await oeffentlich(paar);
  const eigenText = K.toBase64(eigen);
  const anfrageDatei = `${pid}.anfrage`;
  const antwortDatei = `${pid}.antwort`;
  let angelegt = false;
  let erfolg = false;
  try {
    if (await backend.koppelnLesen(anfrageDatei)) throw fehler('KOPPELN_BELEGT', 'Dieser Code wurde schon benutzt. Bitte zeigen Sie auf dem anderen Gerät einen neuen an.');
    const ts = new Date(jetzt()).toISOString();
    const ct = await K.seal(kAnfrage, K.utf8(JSON.stringify({ pub: eigenText, name: geraeteNameBereinigen(name) })), aadAnfrage(uid, pid, ts));
    angelegt = true;
    await backend.koppelnSchreiben(anfrageDatei, K.utf8(JSON.stringify({ v: 1, ts, ct: K.toBase64(ct) })));
    onStand({ zustand: 'wartet' });

    const frist = jetzt() + GUELTIG_MS + TOLERANZ_MS;
    let netzfehler = 0;
    for (;;) {
      if (abbruch?.aborted) throw fehler('ABGEBROCHEN', 'Das Verbinden wurde abgebrochen.');
      if (jetzt() > frist) throw fehler('KOPPELN_ABGELAUFEN', 'Auf dem anderen Gerät wurde nichts bestätigt. Bitte starten Sie dort noch einmal neu.');
      let roh = null;
      try { roh = await backend.koppelnLesen(antwortDatei); netzfehler = 0; } catch (e) {
        if (++netzfehler >= MAX_NETZFEHLER) throw e;
      }
      if (roh) {
        const dek = await antwortOeffnen(roh, { uid, pid, geheimnis, privat: paar.privateKey, eigenText, jetzt });
        erfolg = true;
        return dek;
      }
      await warten(ABFRAGE_MS);
    }
  } finally {
    K.wipe(geheimnis);
    K.wipe(kAnfrage);
    // Nur eigene Dateien: Lag schon eine Anfrage da, gehört sie jemand anderem. Nach dem Erfolg bleibt die
    // Anfrage (Name und öffentlicher Teil, verschlossen) als Quittung für den Geber, der sie dann entfernt.
    if (angelegt) {
      for (const d of erfolg ? [antwortDatei] : [antwortDatei, anfrageDatei]) { try { await backend.koppelnLoeschen(d); } catch { /* räumt aufraeumen() später */ } }
    }
  }
}

async function antwortOeffnen(roh, { uid, pid, geheimnis, privat, eigenText, jetzt }) {
  const j = lesenJson(roh);
  if (j?.v !== 1 || typeof j.exp !== 'string' || typeof j.pub !== 'string' || typeof j.ct !== 'string') throw fehler('KOPPELN_FALSCH', 'Die Antwort des anderen Geräts ist unlesbar.');
  if (!(Date.parse(j.exp) + TOLERANZ_MS >= jetzt())) throw fehler('KOPPELN_ABGELAUFEN', 'Der Code ist abgelaufen. Bitte zeigen Sie auf dem anderen Gerät einen neuen an.');
  let gemeinsames;
  let kWickel;
  try {
    const pubGeber = K.fromBase64(j.pub);
    if (pubGeber.length !== 65 || pubGeber[0] !== 4) throw new Error('Schlüssel');
    gemeinsames = await gemeinsam(privat, pubGeber);
    kWickel = await wickelSchluessel(gemeinsames, geheimnis);
    const dek = await K.open(kWickel, K.fromBase64(j.ct), aadAntwort(uid, pid, j.exp, eigenText, j.pub));
    if (dek.length !== 32) throw new Error('Länge');
    return dek;
  } catch (e) {
    if (e?.code) throw e;
    throw fehler('KOPPELN_FALSCH', 'Die Antwort passt nicht zu diesem Code. Bitte zeigen Sie auf dem anderen Gerät einen neuen an.');
  } finally {
    if (gemeinsames) K.wipe(gemeinsames);
    if (kWickel) K.wipe(kWickel);
  }
}

/* -------------------------------------------------------------------------- */
/* Aufräumen                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Entfernt liegengebliebene Pakete (Abbruch, Absturz, kein Netz beim Löschen).
 * Der Cloud-Speicher kennt keine Ablaufzeit; das Gerät räumt selbst auf.
 * @returns {Promise<number>} wie viele Dateien entfernt wurden
 */
export async function aufraeumen(backend, jetzt = () => Date.now()) {
  const liste = await backend.koppelnListe();
  let n = 0;
  for (const e of liste) {
    const t = Date.parse(e.updated || '') || 0;
    // Ohne verlässliches Datum bleibt die Datei liegen: Lieber ein Rest mehr als ein Paket mitten im Verbinden weg.
    if (!t || jetzt() - t <= GUELTIG_MS + REST_MS) continue;
    try { await backend.koppelnLoeschen(e.name); n++; } catch { /* beim nächsten Mal */ }
  }
  return n;
}

/* -------------------------------------------------------------------------- */
/* Code aus der Kamera-App des Handys                                          */
/* -------------------------------------------------------------------------- */
/*
 * Öffnet die Kamera-App die Adresse aus dem QR-Code, steht der Code im Anker
 * der Seite. Bis die Anmeldung bei Google (mit Neuladen der Seite) durch ist,
 * hält ihn der Tab im sessionStorage: nur dieser Tab, nur wenige Minuten,
 * nach dem Gebrauch oder beim Sperren gelöscht.
 */

const MERKER = 'kontovia.koppelcode';
const MERK_MS = 15 * 60 * 1000;

export function codeMerken(code, { speicher = globalThis.sessionStorage, jetzt = Date.now } = {}) {
  const geheimnis = codeLesen(code);
  if (!geheimnis) return false;
  K.wipe(geheimnis);
  try { speicher.setItem(MERKER, JSON.stringify({ code: String(code).toUpperCase().replace(/[\s-]/g, ''), bis: jetzt() + MERK_MS })); return true; } catch { return false; }
}

/** Der gemerkte Code, solange er gilt; sonst leer. */
export function codeGemerkt({ speicher = globalThis.sessionStorage, jetzt = Date.now } = {}) {
  try {
    const j = JSON.parse(speicher.getItem(MERKER) || 'null');
    if (j?.code && Number(j.bis) > jetzt()) return String(j.code);
    speicher.removeItem(MERKER);
  } catch { /* nichts gemerkt */ }
  return '';
}

export function codeVergessen({ speicher = globalThis.sessionStorage } = {}) {
  try { speicher.removeItem(MERKER); } catch { /* egal */ }
}
