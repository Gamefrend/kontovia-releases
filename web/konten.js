/**
 * Kontovia – mehrere Konten auf einem Gerät, Web-Fassung.
 *
 * Ein Konto ist eine Buchhaltung mit eigenem Passwort und eigener Verbindung
 * zu Google. Jedes Konto hat seine eigene Datenbank im Browser (ablage.js);
 * hier steht nur die Liste: welche Konten es auf diesem Gerät gibt und welches
 * gerade offen ist. Die Liste liegt, wie die Gerätekennung, im Klartext, denn
 * sie wird vor dem Entsperren gebraucht. Pro Konto steht darin ein Name zur
 * Wiedererkennung (Name des Betriebs, sonst die Google-Adresse), auf Wunsch
 * eine eigene Bezeichnung, und wann es zuletzt geöffnet war; sonst nichts.
 *
 * Gewechselt wird mit einem Neustart der Seite: Der Browser liest dann
 * ausschließlich die Datenbank des gewählten Kontos. So kann nichts von einem
 * Konto in das andere gelangen.
 *
 * Ein neues Konto taucht in der Liste erst auf, wenn seine Buchhaltung
 * wirklich da ist (angelegt, aus der Cloud geladen oder aus einem Ordner
 * geöffnet). Wer das Einrichten abbricht, hinterlässt keine Spur.
 */

import * as K from './kern.js';
import * as A from './ablage.js';

const EINTRAG = 'konten';
const ID = /^[a-z0-9]{1,16}$/;
const kurz = (v, max = 120) => String(v ?? '').trim().slice(0, max);

/** @type {{aktiv:string, zuletzt:string, liste:{id:string,name:string,alias:string,email:string,seit:string,geoeffnet:number}[]}} */
let stand = { aktiv: A.HAUPTKONTO, zuletzt: '', liste: [] };

async function speichern() {
  await A.schreiben('dateien', EINTRAG, structuredClone(stand));
}

const eintrag = (id) => stand.liste.find((k) => k.id === id);

/**
 * Liest die Liste und stellt das Konto ein, das zuletzt offen war. Gehört vor
 * jeden anderen Zugriff auf die Ablage.
 */
export async function laden() {
  let e = null;
  try { e = await A.lesen('dateien', EINTRAG); } catch { /* wie ein frisches Gerät */ }
  if (e && typeof e === 'object' && Array.isArray(e.liste)) {
    const liste = [];
    for (const k of e.liste) {
      if (!k || typeof k.id !== 'string' || !ID.test(k.id) || liste.some((x) => x.id === k.id)) continue;
      liste.push({ id: k.id, name: kurz(k.name), alias: kurz(k.alias, 60), email: kurz(k.email), seit: kurz(k.seit, 40), geoeffnet: Number(k.geoeffnet) || 0 });
    }
    const aktiv = typeof e.aktiv === 'string' && ID.test(e.aktiv) ? e.aktiv : (liste[0]?.id || A.HAUPTKONTO);
    stand = { aktiv, zuletzt: typeof e.zuletzt === 'string' && ID.test(e.zuletzt) ? e.zuletzt : '', liste };
  } else {
    stand = { aktiv: A.HAUPTKONTO, zuletzt: '', liste: [] };
  }
  A.kontoSetzen(stand.aktiv);
  return uebersicht();
}

export const aktivId = () => stand.aktiv;

/** Was die Oberfläche über die Konten wissen darf: Kennung und Name, nichts Geheimes. */
export function uebersicht() {
  return {
    aktiv: stand.aktiv,
    /** Das offene Konto hat noch keine Buchhaltung: gerade wird eines hinzugefügt. */
    ausstehend: !eintrag(stand.aktiv),
    zuletzt: eintrag(stand.zuletzt) ? stand.zuletzt : '',
    konten: stand.liste.map((k) => ({
      id: k.id,
      name: k.name,
      alias: k.alias,
      email: k.email,
      seit: k.seit,
      geoeffnet: k.geoeffnet,
      aktiv: k.id === stand.aktiv,
    })),
  };
}

/**
 * Trägt das offene Konto ein oder frischt seinen Namen auf. Läuft nach jedem
 * Entsperren und jedem Speichern; geschrieben wird nur, was sich ändert.
 * @param {{name?:string, email?:string}} angaben
 * @param {{geoeffnet?:boolean}} opts  das Konto wurde eben geöffnet
 */
export async function beschriften({ name, email } = {}, { geoeffnet = false } = {}) {
  let k = eintrag(stand.aktiv);
  let neu = false;
  if (!k) {
    k = { id: stand.aktiv, name: '', alias: '', email: '', seit: new Date().toISOString(), geoeffnet: 0 };
    stand.liste.push(k);
    neu = true;
  }
  const n = kurz(name);
  const m = kurz(email);
  let geaendert = neu;
  // Ein leerer Name überschreibt keinen vorhandenen (etwa kurz nach dem Anlegen).
  if (n && n !== k.name) { k.name = n; geaendert = true; }
  if (email !== undefined && m !== k.email) { k.email = m; geaendert = true; }
  if (geoeffnet) { k.geoeffnet = Date.now(); geaendert = true; }
  if (geaendert) await speichern();
}

function neueKennung() {
  for (;;) {
    const id = K.toHex(K.randomBytes(4));
    if (!eintrag(id) && id !== stand.aktiv) return id;
  }
}

/**
 * Ein neues, leeres Konto öffnen. Es erscheint erst in der Liste, wenn seine
 * Buchhaltung steht; bis dahin führt ausstehendVerwerfen() zurück.
 */
export async function neu() {
  const alt = stand.aktiv;
  const verwaist = !eintrag(alt) && alt !== A.HAUPTKONTO;
  if (eintrag(alt)) stand.zuletzt = alt;
  stand.aktiv = neueKennung();
  // Die Ablage zeigt ab jetzt auf das neue Konto; Nachzügler (etwa eine Abfrage des Sperrbildschirms)
  // dürfen die Datenbank des alten nicht neu anlegen.
  A.kontoSetzen(stand.aktiv);
  if (verwaist) await A.kontoLoeschen(alt).catch(() => {});
  await speichern();
  return stand.aktiv;
}

/** Zu einem vorhandenen Konto wechseln. Der Aufrufer lädt die Seite danach neu. */
export async function wechseln(id) {
  const k = eintrag(String(id));
  if (!k) throw new Error('Dieses Konto gibt es auf diesem Gerät nicht (mehr).');
  const alt = stand.aktiv;
  const verwaist = k.id !== alt && !eintrag(alt) && alt !== A.HAUPTKONTO;
  if (eintrag(alt)) stand.zuletzt = alt;
  stand.aktiv = k.id;
  A.kontoSetzen(k.id);
  if (verwaist) await A.kontoLoeschen(alt).catch(() => {});
  await speichern();
  return k.id;
}

/** Das zuletzt benutzte Konto, optional ohne eines bestimmtes. */
function juengstes(ausser = '') {
  return [...stand.liste].filter((k) => k.id !== ausser).sort((a, b) => b.geoeffnet - a.geoeffnet)[0] || null;
}

/** Das Hinzufügen abbrechen und zum Konto davor zurückkehren. */
export async function ausstehendVerwerfen() {
  if (eintrag(stand.aktiv)) return stand.aktiv;
  const ziel = eintrag(stand.zuletzt) || juengstes();
  if (!ziel) throw new Error('Es gibt kein anderes Konto, zu dem Kontovia zurückkehren könnte.');
  const alt = stand.aktiv;
  stand.aktiv = ziel.id;
  stand.zuletzt = '';
  A.kontoSetzen(ziel.id);
  if (alt !== A.HAUPTKONTO) await A.kontoLoeschen(alt).catch(() => {});
  await speichern();
  return ziel.id;
}

/**
 * Das offene Konto ist von diesem Gerät abgemeldet (seine Daten sind schon
 * gelöscht): aus der Liste nehmen und zum nächsten wechseln.
 * @returns {Promise<string|null>} das Konto, das als nächstes offen ist
 */
export async function aktivEntfernen() {
  const id = stand.aktiv;
  stand.liste = stand.liste.filter((k) => k.id !== id);
  const weiter = juengstes();
  stand.aktiv = weiter?.id || A.HAUPTKONTO;
  stand.zuletzt = '';
  // Erst umstellen, dann löschen: Sonst legte der nächste Zugriff die gelöschte Datenbank wieder an.
  A.kontoSetzen(stand.aktiv);
  if (id !== A.HAUPTKONTO) await A.kontoLoeschen(id).catch(() => {});
  await speichern();
  return weiter?.id || null;
}

/**
 * Gibt einem Konto eine eigene Bezeichnung für die Listen (leer: wieder der Name
 * des Betriebs). Berührt die Buchhaltung selbst nicht.
 */
export async function umbenennen(id, alias) {
  const k = eintrag(String(id));
  if (!k) throw new Error('Dieses Konto gibt es auf diesem Gerät nicht (mehr).');
  k.alias = kurz(alias, 60);
  await speichern();
  return uebersicht();
}

/**
 * Entfernt ein anderes als das offene Konto von diesem Gerät: Buchhaltung, Belege,
 * Sicherungen und Zugänge. Das offene Konto geht nur über „Abmelden“ (abgleichen, dann entfernen).
 * Erst aus der Liste, dann die Daten: Bleibt etwas zurück, ist es unsichtbar und nur Speicherplatz.
 */
export async function entfernen(id) {
  const kennung = String(id);
  if (kennung === stand.aktiv) throw new Error('Das offene Konto lässt sich nur mit „Abmelden“ entfernen.');
  if (!eintrag(kennung)) throw new Error('Dieses Konto gibt es auf diesem Gerät nicht (mehr).');
  stand.liste = stand.liste.filter((k) => k.id !== kennung);
  if (stand.zuletzt === kennung) stand.zuletzt = '';
  await speichern();
  await A.kontoLoeschen(kennung);
  return uebersicht();
}

/** Hat ein anderes Konto auf diesem Gerät schon dieses Google-Konto? Gibt dessen Namen zurück. */
export function googleBelegt(email) {
  const e = kurz(email).toLowerCase();
  if (!e) return null;
  const k = stand.liste.find((x) => x.id !== stand.aktiv && x.email.toLowerCase() === e);
  return k ? (k.name || k.email) : null;
}
