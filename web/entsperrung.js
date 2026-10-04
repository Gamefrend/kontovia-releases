/**
 * Kontovia – weitere Wege, den Tresor zu öffnen, Web-Fassung.
 *
 * Der Tresor hat einen Datenschlüssel (DEK). Das Passwort verpackt ihn im
 * Kopf der Tresordatei; das Format bleibt, wie es ist. Hier kommen weitere
 * „Schlüsselplätze“ dazu, jeder für sich ausreichend (entweder … oder):
 *
 *   Fingerabdruck / Gesicht (nur dieses Gerät)
 *     Das Handy oder der Rechner gibt nach der Bestätigung per Biometrie ein
 *     geheimes Merkmal heraus (WebAuthn, Erweiterung „prf“). Daraus entsteht
 *     ein Schlüssel, der den Datenschlüssel umhüllt. Die Hülle liegt nur in
 *     diesem Browser; das Merkmal verlässt das Gerät nie. Das ist so sicher
 *     wie das Passwort, nur bequemer.
 *
 *   Google-Konto (jedes Gerät, das sich bei Google anmelden kann)
 *     Eine Datei im eigenen Zweig des Cloud-Speichers (entsperrung.kv) enthält
 *     den Datenschlüssel. Wer sich mit dem Google-Konto anmeldet, bekommt sie.
 *     Das ist bequem, aber nicht mehr „nur Sie haben den Schlüssel“: Wer das
 *     Google-Konto übernimmt, kommt an die Buchhaltung. Deshalb nur auf
 *     ausdrücklichen Wunsch, abschaltbar, und das Passwort bleibt gültig.
 *
 * Ohne Abhängigkeiten außer kern.js und ablage.js; die Schnittstellen des
 * Browsers werden hineingereicht, damit die Prüfungen sie nachbilden können.
 */

import * as K from './kern.js';
import * as A from './ablage.js';

const BIO = 'biometrie';
const BIO_AAD = K.utf8('kontovia/entsperrung/biometrie/v1');
const BIO_INFO = 'kontovia/biometrie/v1';
export const GOOGLE_MERKER = 'entsperrung-google';
export const GOOGLE_DATEI = 'entsperrung.kv';

const fehler = (code, text) => Object.assign(new Error(text), { code });

/* -------------------------------------------------------------------------- */
/* Fingerabdruck / Gesicht                                                     */
/* -------------------------------------------------------------------------- */

/** Kennt dieser Browser WebAuthn und läuft die Seite in einem sicheren Kontext? */
export function biometrieMoeglich(g = globalThis) {
  return !!(g.PublicKeyCredential && g.navigator?.credentials?.create && g.navigator?.credentials?.get && g.isSecureContext !== false);
}

/** Gibt es auf diesem Gerät eine Entsperrung per Gesicht oder Fingerabdruck? */
async function plattform(g) {
  try { return (await g.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) ?? false; } catch { return false; }
}

export async function biometrieStatus(g = globalThis) {
  const moeglich = biometrieMoeglich(g);
  const eintrag = await A.lesen('dateien', BIO).catch(() => null);
  return { moeglich, geraet: moeglich ? await plattform(g) : false, eingerichtet: !!eintrag?.wrapped };
}

const bytesVon = (b) => new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);

function prfErgebnis(cred) {
  const r = cred?.getClientExtensionResults?.()?.prf?.results?.first;
  return r ? bytesVon(r) : null;
}

function webauthnFehler(e) {
  if (e?.code) return e;
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return fehler('ABGEBROCHEN', 'Die Bestätigung wurde abgebrochen.');
  if (e?.name === 'InvalidStateError') return fehler('BIO_VORHANDEN', 'Für dieses Gerät ist schon ein Zugang eingerichtet.');
  return fehler('BIO_FEHLER', e?.message || 'Die Bestätigung per Fingerabdruck oder Gesicht hat nicht geklappt.');
}

/**
 * Richtet die Entsperrung per Biometrie ein. Verlangt zweimal eine
 * Bestätigung (Anlegen, Prüfen), wenn das Gerät das Merkmal nicht schon beim
 * Anlegen herausgibt.
 * @param {Uint8Array} dek  der Datenschlüssel des offenen Tresors
 */
export async function biometrieEinrichten(dek, g = globalThis) {
  if (!biometrieMoeglich(g)) throw fehler('BIO_NICHT_MOEGLICH', 'Dieser Browser kann keine Anmeldung per Fingerabdruck oder Gesicht.');
  const creds = g.navigator.credentials;
  const salt = K.randomBytes(32);
  const host = g.location?.hostname || 'localhost';
  let cred;
  try {
    cred = await creds.create({
      publicKey: {
        challenge: K.randomBytes(32),
        rp: { name: 'Kontovia', id: host },
        user: { id: K.randomBytes(16), name: 'kontovia', displayName: 'Kontovia auf diesem Gerät' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', userVerification: 'required' },
        timeout: 120000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (e) { throw webauthnFehler(e); }
  const rawId = bytesVon(cred.rawId);
  let geheim = prfErgebnis(cred);
  if (!geheim) {
    if (cred.getClientExtensionResults?.()?.prf?.enabled === false) {
      throw fehler('BIO_NICHT_MOEGLICH', 'Dieses Gerät kann den Tresor nicht per Fingerabdruck oder Gesicht öffnen. Das Passwort funktioniert weiterhin.');
    }
    geheim = await geheimHolen(g, rawId, salt);
  }
  const kek = await K.subKey(geheim, BIO_INFO);
  try {
    const wrapped = await K.seal(kek, dek, BIO_AAD);
    await A.schreiben('dateien', BIO, { v: 1, id: K.toBase64(rawId), salt: K.toBase64(salt), wrapped, host, seit: new Date().toISOString() });
  } finally { K.wipe(kek); K.wipe(geheim); }
  return true;
}

async function geheimHolen(g, rawId, salt) {
  let cred;
  try {
    cred = await g.navigator.credentials.get({
      publicKey: {
        challenge: K.randomBytes(32),
        rpId: g.location?.hostname || 'localhost',
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        timeout: 120000,
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch (e) { throw webauthnFehler(e); }
  const geheim = prfErgebnis(cred);
  if (!geheim) throw fehler('BIO_NICHT_MOEGLICH', 'Dieses Gerät kann den Tresor nicht per Fingerabdruck oder Gesicht öffnen. Das Passwort funktioniert weiterhin.');
  return geheim;
}

/** Holt den Datenschlüssel nach der Bestätigung per Biometrie. */
export async function biometrieOeffnen(g = globalThis) {
  const e = await A.lesen('dateien', BIO);
  if (!e?.wrapped) throw fehler('BIO_FEHLT', 'Auf diesem Gerät ist keine Entsperrung per Fingerabdruck oder Gesicht eingerichtet.');
  const geheim = await geheimHolen(g, K.fromBase64(e.id), K.fromBase64(e.salt));
  const kek = await K.subKey(geheim, BIO_INFO);
  try {
    return await K.open(kek, e.wrapped instanceof Uint8Array ? e.wrapped : new Uint8Array(e.wrapped), BIO_AAD);
  } catch {
    throw fehler('BAD_KEY', 'Der gespeicherte Zugang passt nicht mehr. Bitte mit dem Passwort entsperren und neu einrichten.');
  } finally { K.wipe(kek); K.wipe(geheim); }
}

export const biometrieEntfernen = () => A.loeschen('dateien', BIO);

/* -------------------------------------------------------------------------- */
/* Google-Konto                                                                */
/* -------------------------------------------------------------------------- */

/** Der Inhalt von entsperrung.kv. */
export function googlePaket(dek, jetzt = new Date()) {
  return K.utf8(JSON.stringify({ v: 1, dek: K.toBase64(dek), erstellt: jetzt.toISOString() }));
}

/** Liest den Datenschlüssel aus entsperrung.kv; null, wenn die Datei nicht passt. */
export function googleSchluessel(bytes) {
  try {
    const j = JSON.parse(K.fromUtf8(bytes));
    if (j?.v !== 1 || typeof j.dek !== 'string') return null;
    const dek = K.fromBase64(j.dek);
    return dek.length === 32 ? dek : null;
  } catch { return null; }
}

export const googleMerken = (email) => A.schreiben('dateien', GOOGLE_MERKER, { email: String(email || ''), seit: new Date().toISOString() });
export const googleMerker = () => A.lesen('dateien', GOOGLE_MERKER).catch(() => null);
export const googleVergessen = () => A.loeschen('dateien', GOOGLE_MERKER);
