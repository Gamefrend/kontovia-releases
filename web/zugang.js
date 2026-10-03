/**
 * Kontovia – was von den Zugangsdaten die Oberfläche und die Sicherungen sehen.
 *
 * Der Cloud-Block im Bestand hält die Anmeldemerkmale für den Cloud-Abgleich
 * und für Google Kalender. Gebraucht werden sie nur dort, wo die Verbindungen
 * laufen: in der Web-Schicht. Die Oberfläche bekommt eine
 * Kopie ohne sie – was sie nicht hat, kann auch in keinem Export landen. Bis
 * Fassung 1.7 stand das Aktualisierungsmerkmal von Google im Klartext im
 * JSON-Gesamtexport, und jede Vollsicherung trug es mit.
 *
 * Ohne Abhängigkeiten, damit die Web-Fassung dieselbe Datei verwendet
 * (scripts/build-web.js macht daraus web/zugang.js).
 */

/** Felder, die eine Verbindung öffnen. */
const GEHEIM = new Set(['refreshToken', 'googleRefreshToken', 'clientSecret', 'webClientSecret']);

/**
 * Kopie ohne Anmeldemerkmale.
 * @param {any} wert  der Cloud-Block oder ein Teil davon
 * @param {{markieren?:boolean}} opts  markieren: statt des Werts nur `true`
 *   stehen lassen, damit die Oberfläche weiß, dass etwas hinterlegt ist
 */
function ohneZugangsdaten(wert, { markieren = true } = {}) {
  if (Array.isArray(wert)) return wert.map((v) => ohneZugangsdaten(v, { markieren }));
  if (!wert || typeof wert !== 'object') return wert;
  const out = {};
  for (const [k, v] of Object.entries(wert)) {
    if (GEHEIM.has(k)) {
      if (markieren && v) out[k] = true;
      continue;
    }
    out[k] = ohneZugangsdaten(v, { markieren });
  }
  return out;
}

/** Der Bestand, wie ihn die Oberfläche bekommt. */
function fuerOberflaeche(db) {
  if (!db || typeof db !== 'object' || !db.cloud) return db;
  return { ...db, cloud: ohneZugangsdaten(db.cloud) };
}

/** Der Bestand, wie er in eine Vollsicherung geht: ohne jedes Anmeldemerkmal. */
function fuerSicherung(db) {
  if (!db || typeof db !== 'object' || !db.cloud) return db;
  return { ...db, cloud: ohneZugangsdaten(db.cloud, { markieren: false }) };
}

/**
 * Beim Einspielen einer Sicherung bleibt die Verbindung dieses Geräts, wie sie
 * ist. Die Sicherung kann Wochen alt sein; ihr Cloud-Block stammt womöglich
 * von einem anderen Gerät. Nur wo hier noch nichts eingerichtet ist, gilt die
 * (merkmalfreie) Einrichtung aus der Sicherung.
 */
function cloudNachEinspielen(aktuell, ausSicherung) {
  if (aktuell && typeof aktuell === 'object' && Object.keys(aktuell).length) return aktuell;
  return ohneZugangsdaten(ausSicherung || {}, { markieren: false });
}

/**
 * Das Änderungsjournal nach dem Einspielen einer Sicherung.
 *
 * Jedes Gerät führt darin eine eigene verkettete Folge (seq, prev, hash).
 * Würde das Journal auf den Stand der Sicherung zurückgesetzt, zählte dieses
 * Gerät von dort aus weiter – und der nächste Abgleich brächte die jüngeren
 * Einträge derselben Kette aus der Cloud zurück: dieselbe Nummer zweimal, und
 * „Journal prüfen“ meldete eine Veränderung von außen. Das Journal ist ohnehin
 * Geschichte, auch über eine Wiederherstellung hinweg.
 *
 * Gehören beide Journale zu derselben Geschichte (keine Nummer mit zwei
 * verschiedenen Einträgen), bleibt deshalb alles erhalten. Sonst – etwa eine
 * Sicherung aus einem früheren Tresor in einem frisch angelegten – gilt wie
 * bisher das Journal der Sicherung.
 */
function journalNachEinspielen(aktuell, ausSicherung) {
  const sicherung = Array.isArray(ausSicherung) ? ausSicherung : [];
  const gesehen = new Map();
  for (const e of [...(Array.isArray(aktuell) ? aktuell : []), ...sicherung]) {
    if (!e || typeof e !== 'object') continue;
    const key = `${e.device || 'lokal'}#${e.seq}`;
    const vorher = gesehen.get(key);
    if (vorher && vorher.hash !== e.hash) return sicherung;
    gesehen.set(key, e);
  }
  return [...gesehen.values()].sort((x, y) => String(x.ts).localeCompare(String(y.ts))
    || String(x.device).localeCompare(String(y.device)) || (x.seq - y.seq));
}

/**
 * Bis 1.13 ließ sich die Cloud-Ablage auf Google Drive umstellen, und jedes
 * Zugangsdatum war überschreibbar (eigenes Projekt). Beides gibt es nicht mehr.
 * Hier wird ein Cloud-Block aus dieser Zeit aufgeräumt: Wer auf Drive oder mit
 * einem anderen Firebase-Projekt verbunden war, ist danach nicht mehr verbunden
 * und bekommt in der Cloud-Karte einen Hinweis (`umgestellt`). Widerrufen wird
 * dabei nichts, die Buchhaltung bleibt, wie sie ist.
 *
 * @param {object} c  der Cloud-Block
 * @param {{apiKey:string, bucket:string}} mitgeliefert  das eingebaute Projekt
 * @returns {boolean} ob etwas geändert wurde
 */
const ALTLASTEN = ['apiKey', 'bucket', 'clientId', 'clientSecret', 'webClientId', 'webClientSecret'];

function altlastenEntfernen(c, mitgeliefert) {
  if (!c || typeof c !== 'object') return false;
  const drive = c.provider === 'drive';
  // Ein anderes Projekt erkennt man an Schlüssel oder Speicherort; eine
  // eigene Client-ID allein ändert an der Sitzung nichts.
  const anderesProjekt = !!((c.apiKey && c.apiKey !== mitgeliefert.apiKey)
    || (c.bucket && String(c.bucket).replace(/^gs:\/\//, '') !== mitgeliefert.bucket));
  const etwasDa = drive || !!c.state?.drive || ALTLASTEN.some((k) => c[k] !== undefined)
    || (c.provider !== undefined && c.provider !== 'firebase');
  if (!etwasDa) return false;
  const warVerbunden = drive ? !!c.state?.drive?.refreshToken : (anderesProjekt && !!c.state?.firebase?.refreshToken);
  for (const k of ALTLASTEN) delete c[k];
  if (c.state && typeof c.state === 'object') {
    delete c.state.drive;
    // Die Sitzung eines anderen Projekts gilt in diesem nicht.
    if (anderesProjekt || drive) delete c.state.firebase;
  }
  c.provider = 'firebase';
  if (warVerbunden) {
    c.umgestellt = { grund: drive ? 'drive' : 'eigenes-projekt', am: new Date().toISOString() };
    delete c.remoteVersion;
    delete c.lastSyncAt;
    delete c.linkedAt;
  }
  return true;
}

export { ohneZugangsdaten, fuerOberflaeche, fuerSicherung, cloudNachEinspielen, journalNachEinspielen, altlastenEntfernen };
