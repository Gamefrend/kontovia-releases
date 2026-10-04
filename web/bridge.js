/**
 * Kontovia – Brücke der Web-Fassung.
 *
 * Stellt `window.kontovia` bereit: eine feste Liste benannter Funktionen,
 * über die die Oberfläche (src/renderer) alles erreicht, was nicht reine
 * Darstellung ist: Verschlüsselung (kern.js), Ablage (ablage.js, tresor.js),
 * Cloud-Abgleich (cloud.js), Google Kalender (gcal.js), Dateien (dateien.js),
 * Druck (druck.js), Sperre (sperre.js) und Aktualisierung (aktualisierung.js,
 * uebergabe.js). Die Oberfläche bekommt nur Kopien der Daten, nie die Objekte
 * selbst, und nie die Anmeldemerkmale (zugang.js).
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { Vault, MAX_ATTACHMENT_BYTES } from './tresor.js';
import { Cloud } from './cloud.js';
import * as W from './weiterleitung.js';
import * as G from './gcal.js';
import * as Z from './sperre.js';
import * as UE from './uebergabe.js';
import BUILTIN from './cloudconfig.js';
import * as D from './dateien.js';
import { drucken } from './druck.js';
import * as U from './aktualisierung.js';
import { makeSeed } from './seed.js';
import { fuerOberflaeche } from './zugang.js';
import { modal, toast } from '../lib/ui.js';
import './mobil.js';
import * as I from './installation.js';

/* Läuft diese Seite nur als kleines Fenster für Google Kalender? Dann reicht
   sie die Antwort an das eigentliche Kontovia-Fenster weiter und schließt
   sich (gcal.js). Das geschieht vor allem anderen, auch vor der Anmeldung
   per Weiterleitung, die sonst die Antwort für sich hielte. */
const nurGoogleFenster = G.antwortWeiterreichen();
/* Kam die Antwort von Google, nachdem Kontovia selbst dorthin weitergeleitet hatte? Auch diese
   Antwort verlässt die Adresse sofort; sonst hielte die Anmeldung zur Cloud sie für ihre. */
const googleRueckkehr = nurGoogleFenster ? null : G.rueckkehrAusAdresse();

/* Android und Chrome: das Angebot, Kontovia zu installieren, früh festhalten. */
if (!nurGoogleFenster) I.starten({ toast });

const vault = new Vault(U.VERSION);
const cloud = new Cloud(vault, { zeigeCode });
const gcal = new G.GoogleCalendar(vault, { clientId: BUILTIN.googleWeb?.clientId || '' });
gcal.rueckkehr(googleRueckkehr);

/* Zurück von einer Anmeldung per Weiterleitung? Die Antwort von Google steht
   im Anker der Adresse; sie wird sofort entfernt und im Hintergrund bei
   Firebase eingetauscht. Wer den Stand der Anmeldung braucht, wartet darauf. */
const rueckkehrFertig = (() => {
  const antwort = W.antwortAusAdresse();
  return antwort ? cloud.rueckkehr(antwort).catch((e) => console.error('Anmeldung nach Weiterleitung:', e)) : Promise.resolve();
})();
const device = { id: '', name: '' };

let autoLockMinutes = 10;
/** Tresorschlüssel aus der Übergabe nach einer Aktualisierung (uebergabe.js), nur für diesen Start. */
let fortsetzen = null;
let lockTimer = null;
let failedUnlocks = 0;

const kopie = (v) => (v === undefined ? v : structuredClone(v));
const str = (v, max = 500) => String(v ?? '').slice(0, max);

/* -------------------------------------------------------------------------- */
/* Ereignisse                                                                  */
/* -------------------------------------------------------------------------- */

const hoerer = { locked: new Set(), updateProgress: new Set(), cloudProgress: new Set(), cloudTick: new Set(), menu: new Set(), speicher: new Set() };

function send(kanal, payload) {
  for (const fn of hoerer[kanal]) {
    try { fn(payload); } catch (err) { console.error(`[${kanal}]`, err); }
  }
}
const anmelden = (kanal) => (cb) => { hoerer[kanal].add(cb); return () => hoerer[kanal].delete(cb); };

/* -------------------------------------------------------------------------- */
/* Einheitliche Fehlerbehandlung                                               */
/* -------------------------------------------------------------------------- */

/**
 * Einheitlich für jede Funktion: gesperrt heißt gesperrt, und die Oberfläche
 * bekommt eine Meldung mit Code statt eines Stacktraces.
 */
function handle(fn, { needsUnlock = true } = {}) {
  return async (...args) => {
    try {
      if (needsUnlock) vault.assertUnlocked();
      return await fn(...args);
    } catch (err) {
      const e = new Error(err?.message || 'Der Vorgang ist fehlgeschlagen.');
      if (err?.code) e.code = err.code;
      throw e;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Gerät                                                                       */
/* -------------------------------------------------------------------------- */

function geraeteName() {
  const ua = navigator.userAgent;
  const system = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
      : /Android/.test(ua) ? 'Android'
        : /Mac/.test(ua) ? 'Mac'
          : /Windows/.test(ua) ? 'Windows'
            : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${system} · ${browser}`;
}

/**
 * Jede Installation bekommt eine zufällige Kennung – sie steht wie in der früheren
 * Windows-Fassung im Klartext und verrät nichts über den Inhalt. Gebraucht
 * wird sie, damit das Änderungsjournal geräteweise prüfbar bleibt.
 */
async function geraetLaden() {
  try {
    const d = await A.lesen('dateien', 'geraet');
    if (d && typeof d.id === 'string' && d.id.length === 16) return d;
  } catch { /* wird neu angelegt */ }
  const d = { id: K.toHex(K.randomBytes(8)), name: geraeteName(), createdAt: new Date().toISOString() };
  await A.schreiben('dateien', 'geraet', d).catch(() => {});
  return d;
}

export const istAppFenster = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* -------------------------------------------------------------------------- */
/* Automatische Sperre                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Timer laufen in einem Tab im Hintergrund nicht verlässlich, auf dem iPhone
 * gar nicht. Maßgeblich ist deshalb die Uhrzeit der letzten Aktivität; der
 * Timer ist nur der Anlass, sie zu prüfen.
 */
let letzteAktivitaet = Date.now();
let verstecktSeit = 0;
/** Wer länger als so lange eine andere App benutzt, muss wieder entsperren. */
const HINTERGRUND_MS = 3 * 60 * 1000;

function resetLockTimer() {
  letzteAktivitaet = Date.now();
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = null;
  if (!autoLockMinutes || vault.isLocked) return;
  lockTimer = setTimeout(pruefeSperre, autoLockMinutes * 60 * 1000 + 500);
}

function pruefeSperre() {
  if (vault.isLocked || !autoLockMinutes) return;
  if (Date.now() - letzteAktivitaet >= autoLockMinutes * 60 * 1000) doLock('inaktiv');
  else lockTimer = setTimeout(pruefeSperre, 15000);
}

function doLock(reason) {
  if (vault.isLocked) return;
  vault.lock();
  nachSperre(reason);
}

/** Was dem Sperren folgt – auch, wenn cloud.js beim Übernehmen schon gesperrt hat. */
function nachSperre(reason) {
  if (reason !== 'aktualisierung') UE.verwerfen().catch(() => {});
  gcal.vergessen();
  Z.bildschirmBeenden();
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = null;
  restartAutoSync();
  send('locked', { reason });
}

/* Ruhezustand und Bildschirmsperre (sperre.js). */
function sperreBeobachten() {
  Z.bildschirmBeobachten(() => doLock('bildschirmsperre'));
}

/** Startet erst mit Kontovia selbst, nicht im kleinen Fenster für Google. */
function ruhezustandBeobachten() {
  Z.zeitsprungWaechter(() => doLock('standby'));
  // Legt der Browser die Seite auf Eis (Zurück-Speicher, eingefrorener Tab),
  // kommt sie gesperrt wieder.
  window.addEventListener('pagehide', (e) => { if (e.persisted) doLock('hintergrund'); });
  document.addEventListener('freeze', () => doLock('hintergrund'));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    verstecktSeit = Date.now();
    return;
  }
  if (vault.isLocked) return;
  if (verstecktSeit && Date.now() - verstecktSeit >= HINTERGRUND_MS) doLock('hintergrund');
  else pruefeSperre();
  verstecktSeit = 0;
});

/* -------------------------------------------------------------------------- */
/* Nur ein Fenster zur Zeit                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Zwei offene Tabs würden sich gegenseitig den Tresor überschreiben. Die
 * Windows-Fassung verhindert einen zweiten Start; hier hält das zuletzt
 * geöffnete Fenster die Sperre, und das ältere sperrt sich.
 */
function einzigesFenster() {
  if (!navigator.locks?.request) return;
  const halten = () => navigator.locks.request('kontovia-fenster', { steal: true }, () => new Promise(() => {}))
    .catch(() => {
      // Ein anderes Fenster hat übernommen.
      doLock('anderes-fenster');
      anderesFenster = true;
    });
  halten();
}
let anderesFenster = false;

/* -------------------------------------------------------------------------- */
/* Tastenkürzel                                                               */
/* -------------------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  const views = { 1: 'dashboard', 2: 'transactions', 3: 'calendar', 4: 'reports', 5: 'export', 6: 'master', 7: 'todos', 8: 'rechnungen', ',': 'settings' };
  let action = null;
  if (k === 'l') {
    if (vault.isLocked) return;
    e.preventDefault();
    // Die Oberfläche schreibt zuerst ihre letzten Änderungen und sperrt dann selbst.
    if (hoerer.menu.size) send('menu', { action: 'lock' }); else doLock('manuell');
    return;
  }
  if (views[k] && !e.shiftKey) action = { action: 'view', view: views[k] };
  else if (k === 's' && !e.shiftKey) action = { action: 'save' };
  else if (k === 'f' && !e.shiftKey) action = { action: 'search' };
  else if (k === 'n') action = { action: e.shiftKey ? 'new-appointment' : 'new-transaction' };
  if (!action || vault.isLocked) return;
  e.preventDefault();
  send('menu', action);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F1' && !vault.isLocked) {
    e.preventDefault();
    send('menu', { action: 'view', view: 'help', params: { tab: 'anleitung' } });
  }
});

/* -------------------------------------------------------------------------- */
/* Anmeldecode von Google anzeigen                                             */
/* -------------------------------------------------------------------------- */

function zeigeCode({ code, url, gueltigBis }) {
  let abbrechen;
  const abgebrochen = new Promise((r) => { abbrechen = r; });
  const minuten = Math.max(1, Math.round((gueltigBis - Date.now()) / 60000));
  const m = modal({
    title: 'Mit Google anmelden',
    size: 'slim',
    body: `
      <ol style="padding-left:20px;line-height:1.7;margin-top:0">
        <li>Öffnen Sie <strong>${url.replace(/^https:\/\//, '').replace(/[<>&"]/g, '')}</strong>, hier oder auf einem anderen Gerät.</li>
        <li>Melden Sie sich mit Ihrem Google-Konto an und geben Sie diesen Code ein:</li>
      </ol>
      <div style="font:600 28px/1.2 var(--mono);letter-spacing:.12em;text-align:center;padding:14px;border:1px dashed var(--border-strong);border-radius:10px;user-select:all" id="kvCode">${code.replace(/[<>&"]/g, '')}</div>
      <p class="small muted mt16 mb0">Bestätigen Sie danach die Freigabe. Dieses Fenster schließt sich
      von selbst, sobald Google die Anmeldung meldet. Der Code gilt ${minuten} Minuten.</p>`,
    foot: `<button class="btn" data-abbrechen>Abbrechen</button>
           <button class="btn" data-kopieren>Code kopieren</button>
           <button class="btn primary" data-oeffnen>Google öffnen</button>`,
    onClose: () => abbrechen(),
  });
  m.root.querySelector('[data-abbrechen]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-kopieren]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); toast('Code kopiert'); } catch { /* markierbar bleibt er */ }
  });
  m.root.querySelector('[data-oeffnen]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* nicht schlimm */ }
    window.open(url, '_blank', 'noopener');
  });
  return { schliessen: () => m.close(), abgebrochen };
}

/* -------------------------------------------------------------------------- */
/* Zeitgesteuerter Abgleich                                                    */
/* -------------------------------------------------------------------------- */

let autoSyncTimer = null;

function restartAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
  if (vault.isLocked) return;
  const st = cloud.status();
  if (!st.linked || st.autoSync === false) return;
  const minutes = Math.min(720, Math.max(5, Number(st.autoSyncMinutes) || 15));
  autoSyncTimer = setInterval(() => {
    if (!vault.isLocked && !document.hidden) send('cloudTick', { reason: 'zeitplan' });
  }, minutes * 60 * 1000);
}

// Kommt das Gerät wieder ins Netz oder die App in den Vordergrund, gleich abgleichen.
window.addEventListener('online', () => { if (!vault.isLocked) send('cloudTick', { reason: 'wieder-online' }); });

/* -------------------------------------------------------------------------- */
/* Hilfen                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Wie Buffer.from(text, 'latin1') in Node: je Zeichen das untere Byte. So
 * entsteht der DATEV-Stapel in beiden Fassungen Byte für Byte gleich.
 */
function latin1(text) {
  const s = String(text ?? '');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

const bytesAus = ({ dataBase64, text, encoding }) => (dataBase64
  ? K.fromBase64(dataBase64)
  : encoding === 'latin1' ? latin1(text) : K.utf8(text ?? ''));

const BELEG_FILTER = [{ name: 'Belege', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'xml', 'csv', 'zip', 'eml', 'docx', 'xlsx'] }];

function zipName(folderLabel, files) {
  const jahr = String(files?.[0]?.name || '').match(/(20\d\d)/)?.[1] || new Date().getFullYear();
  const l = String(folderLabel || '');
  if (/Finanzamt/i.test(l)) return `Kontovia-Finanzamt_${jahr}`;
  if (/Datenträger|Prüfung/i.test(l)) return `Kontovia-Datentraegerueberlassung_${jahr}`;
  if (/Beleg/i.test(l)) return `Kontovia-Belege_${jahr}`;
  return `Kontovia-Export_${jahr}`;
}

/* -------------------------------------------------------------------------- */
/* Speicherort: Browser oder Ordner                                            */
/* -------------------------------------------------------------------------- */

/** Der zuletzt gewählte Ordner, bis die Oberfläche bestätigt, was damit geschehen soll. */
let gewaehlt = null;

/** Wie der Speicherort heißt, für Einstellungen und „Über Kontovia“. */
async function ortBeschreiben() {
  const sp = await A.speicherort();
  vault.dataDir = sp.art === 'ordner' ? `Ordner „${sp.name}“ auf diesem Gerät` : 'Speicher dieses Browsers';
  return sp;
}

/* -------------------------------------------------------------------------- */
/* Die Brücke                                                                  */
/* -------------------------------------------------------------------------- */

const api = {
  app: {
    info: handle(async () => ({
      version: U.VERSION,
      platform: 'web',
      web: true,
      browser: geraeteName(),
      standalone: istAppFenster(),
      offline: U.offlineFaehig(),
      dataDir: vault.dataDir,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      defaultUpdateFeed: U.QUELLE,
      isDev: false,
      deviceId: device.id,
      deviceName: device.name,
    }), { needsUnlock: false }),
    openDataFolder: handle(async () => {
      throw new Error('Einen Ordner öffnet der Browser nicht selbst. Wo Ihre Buchhaltung liegt, steht unter Einstellungen → Sicherung und Speicherort.');
    }, { needsUnlock: false }),
    openLicense: handle(async () => {
      throw new Error('Die Web-Fassung läuft in Ihrem Browser; es gelten dessen Lizenzbedingungen.');
    }, { needsUnlock: false }),
    /** Die Datenschutzhinweise als Text – Kontovia zeigt sie selbst an. */
    legalText: handle(async (which) => {
      if (String(which) !== 'datenschutz') throw new Error('Unbekanntes Dokument.');
      const res = await fetch(new URL('../recht/DATENSCHUTZ.md', import.meta.url).href, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Die Datenschutzhinweise sind in dieser Fassung nicht enthalten.');
      return res.text();
    }, { needsUnlock: false }),
    activity: async () => { resetLockTimer(); return true; },
    bildschirmsperre: handle(async () => Z.bildschirmStatus(), { needsUnlock: false }),
    bildschirmsperreSetzen: handle(async (an) => {
      if (an) await Z.bildschirmEinschalten(() => doLock('bildschirmsperre'));
      else Z.bildschirmAusschalten();
      return Z.bildschirmStatus();
    }),
    setAutoLock: handle(async (minutes) => {
      const m = Number(minutes);
      autoLockMinutes = Number.isFinite(m) && m >= 0 && m <= 480 ? m : 10;
      resetLockTimer();
      return autoLockMinutes;
    }, { needsUnlock: false }),
    copy: handle(async (text, clearAfterSeconds) => {
      await navigator.clipboard.writeText(str(text, 5000));
      const secs = Number(clearAfterSeconds);
      // Lesen darf eine Webseite die Zwischenablage nicht ohne Rückfrage;
      // geleert wird deshalb nur, solange Kontovia vorn ist.
      if (Number.isFinite(secs) && secs > 0) {
        setTimeout(() => { if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {}); }, secs * 1000);
      }
      return true;
    }, { needsUnlock: false }),
  },

  vault: {
    status: handle(async () => {
      await rueckkehrFertig;
      const speicher = await ortBeschreiben();
      // Ohne Zugriff auf den Ordner lässt sich nicht sagen, ob dort ein Tresor liegt.
      const exists = speicher.art === 'ordner' && speicher.zugriff !== 'granted' ? null : await vault.exists();
      return { exists, locked: vault.isLocked, autoLockMinutes, speicher, fortsetzen: !!fortsetzen };
    }, { needsUnlock: false }),
    create: handle(async (password, settings) => {
      if (typeof password !== 'string' || password.length < 10) throw new Error('Das Passwort muss mindestens 10 Zeichen haben.');
      const db = makeSeed(settings && typeof settings === 'object' ? kopie(settings) : {});
      await vault.create(password, db);
      autoLockMinutes = db.settings.autoLockMinutes;
      resetLockTimer();
      A.dauerhaftAnfordern();
      sperreBeobachten();
      // Wer sich beim Einrichten mit Google angemeldet hat, ist ab jetzt verbunden.
      if (await cloud.anmeldungEintragen().catch(() => false)) restartAutoSync();
      return kopie(fuerOberflaeche(vault.db));
    }, { needsUnlock: false }),
    unlock: handle(async (password) => {
      if (anderesFenster) throw new Error('Kontovia ist in einem anderen Fenster geöffnet. Bitte dort weiterarbeiten oder dieses Fenster neu laden.');
      if (failedUnlocks > 0) {
        const wait = Math.min(8000, 250 * 2 ** Math.min(failedUnlocks, 5));
        await new Promise((r) => setTimeout(r, wait));
      }
      try {
        const db = await vault.unlock(String(password ?? ''));
        failedUnlocks = 0;
        autoLockMinutes = Number(db?.settings?.autoLockMinutes ?? 10);
        resetLockTimer();
        // Eben übernommener Tresor: Die Verbindung dieses Geräts wieder einsetzen.
        await cloud.nachEntsperren().catch((e) => console.error('Verbindung nach Übernahme:', e));
        // Eben per Weiterleitung bei Google angemeldet: jetzt mit dem Tresor verbinden.
        await cloud.anmeldungVerbinden().catch((e) => console.error('Verbinden nach Weiterleitung:', e));
        restartAutoSync();
        A.dauerhaftAnfordern();
        sperreBeobachten();
        // Die Anmeldemerkmale bleiben in der Web-Schicht (zugang.js).
        return kopie(fuerOberflaeche(vault.db));
      } catch (err) {
        failedUnlocks++;
        throw err;
      }
    }, { needsUnlock: false }),
    // Entsperren mit dem Schlüssel aus der Übergabe (uebergabe.js), einmal,
    // direkt nach dem Neuladen in die neue Fassung. Sonst: Passwort wie immer.
    resume: handle(async () => {
      const dek = fortsetzen;
      fortsetzen = null;
      if (!dek) return null;
      if (!vault.isLocked || anderesFenster) { K.wipe(dek); return null; }
      let db;
      try {
        db = await vault.unlockWithKey(dek);
      } catch (err) {
        K.wipe(dek);
        console.error('Anmeldung nach der Aktualisierung:', err.message);
        return null;
      }
      failedUnlocks = 0;
      autoLockMinutes = Number(db?.settings?.autoLockMinutes ?? 10);
      resetLockTimer();
      restartAutoSync();
      A.dauerhaftAnfordern();
      sperreBeobachten();
      return kopie(fuerOberflaeche(vault.db));
    }, { needsUnlock: false }),
    lock: handle(async () => { doLock('manuell'); return true; }, { needsUnlock: false }),
    read: handle(async () => kopie(fuerOberflaeche(vault.db))),
    write: handle(async (db) => {
      if (!db || typeof db !== 'object' || !Array.isArray(db.transactions)) {
        throw new Error('Ungültiger Datenbestand. Speichern abgebrochen.');
      }
      const neu = kopie(db);
      // Der Cloud-Block wird ausschließlich hier geführt;
      // die Kopie der Oberfläche darf ihn nicht überschreiben.
      neu.cloud = vault.db?.cloud || neu.cloud || {};
      const res = await vault.save(neu);
      autoLockMinutes = Number(neu?.settings?.autoLockMinutes ?? autoLockMinutes);
      resetLockTimer();
      return res;
    }),
    changePassword: handle(async (oldPassword, newPassword) => {
      if (typeof newPassword !== 'string' || newPassword.length < 10) throw new Error('Das neue Passwort muss mindestens 10 Zeichen haben.');
      return vault.changePassword(String(oldPassword ?? ''), newPassword);
    }),
    storage: handle(async () => ({ ...(await vault.storageStats()), speicher: await ortBeschreiben() }), { needsUnlock: false }),
    backups: handle(async () => vault.listBackups(), { needsUnlock: false }),
  },

  attach: {
    pick: handle(async () => {
      const files = await D.waehlen({ multiple: true, filters: BELEG_FILTER, accept: 'image/*,.pdf,.txt,.xml,.csv,.zip,.eml,.docx,.xlsx' });
      const out = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        out.push(await vault.addAttachment(bytes, { fileName: str(f.name, 260), mime: f.type || D.mimeFuer(f.name) }));
      }
      return out;
    }),
    add: handle(async (fileName, mime, dataBase64) => vault.addAttachment(
      K.fromBase64(String(dataBase64 || '')), { fileName: str(fileName, 260), mime: str(mime, 120) })),
    read: handle(async (id) => K.toBase64(await vault.readAttachment(String(id)))),
    remove: handle(async (id) => vault.deleteAttachment(String(id))),
    saveAs: handle(async (id, fileName) => D.anbieten(await vault.readAttachment(String(id)), fileName || 'beleg')),
    openExternal: handle(async (id, fileName) => {
      const meta = (vault.db?.attachments || []).find((a) => a.id === id);
      return D.oeffnen(await vault.readAttachment(String(id)), fileName || 'beleg', meta?.mime || D.mimeFuer(fileName || ''));
    }),
    prune: handle(async (ids) => vault.pruneOrphanAttachments(Array.isArray(ids) ? ids : [])),
  },

  file: {
    save: handle(async (opts = {}) => D.anbieten(bytesAus(opts), opts.defaultName || 'export', { filters: opts.filters })),
    saveMany: handle(async ({ folderLabel, files, zipName: name } = {}) => {
      const list = (files || []).map((f) => ({ name: D.sichererName(f.name), data: bytesAus(f) }));
      return D.mehrereAnbieten(list, { zipName: name || zipName(folderLabel, files) });
    }),
    // Im Browser gibt es keinen Ordner, der sich zeigen ließe.
    reveal: handle(async () => true),
    /** Eine erzeugte Datei anzeigen, etwa einen Bericht als PDF: im Browser ein neuer Tab. */
    open: handle(async ({ dataBase64, defaultName, mime } = {}) => {
      const name = str(defaultName, 180) || 'datei';
      return D.oeffnen(K.fromBase64(String(dataBase64 || '')), name, str(mime, 80) || D.mimeFuer(name));
    }),
    pickImport: handle(async (filters) => {
      const [f] = await D.waehlen({ multiple: false, filters: Array.isArray(filters) ? filters : [] });
      if (!f) return null;
      const bytes = new Uint8Array(await f.arrayBuffer());
      return { name: f.name, dataBase64: K.toBase64(bytes), size: bytes.length };
    }, { needsUnlock: false }),
  },

  backup: {
    export: handle(async (password) => {
      if (typeof password !== 'string' || password.length < 10) {
        throw new Error('Für die Sicherung ist ein Passwort mit mindestens 10 Zeichen nötig.');
      }
      const buf = await vault.exportFullBackup(password);
      const stamp = new Date().toISOString().slice(0, 10);
      const name = await D.anbieten(buf, `Kontovia-Sicherung-${stamp}.kvbak`, {
        mime: 'application/octet-stream',
        filters: [{ name: 'Kontovia-Sicherung', extensions: ['kvbak'] }],
      });
      return name ? { path: name, bytes: buf.length } : null;
    }),
    import: handle(async (password) => {
      const [f] = await D.waehlen({ multiple: false, filters: [{ name: 'Kontovia-Sicherung', extensions: ['kvbak'] }] });
      if (!f) return null;
      return vault.importFullBackup(new Uint8Array(await f.arrayBuffer()), String(password ?? ''));
    }),
  },

  /* Speicherort: im Browser (IndexedDB) oder in einem Ordner auf dem Gerät (ablage.js). */
  speicher: {
    status: handle(async () => ortBeschreiben(), { needsUnlock: false }),
    /** Nach einem Neustart fragt der Browser erneut; braucht einen Klick unmittelbar davor. */
    zugriffErlauben: handle(async () => {
      const z = await A.zugriffErbitten();
      await ortBeschreiben();
      return z;
    }, { needsUnlock: false }),
    /**
     * Lässt einen Ordner wählen (oder nimmt einen übergebenen, für den Selbsttest)
     * und sagt, was darin liegt. Geschehen tut damit noch nichts.
     * @param {{zweck?:'oeffnen'|'umziehen', ordner?:FileSystemDirectoryHandle}} opts
     */
    ordnerWaehlen: handle(async (opts = {}) => {
      let dir = opts?.ordner;
      if (!(typeof FileSystemDirectoryHandle !== 'undefined' && dir instanceof FileSystemDirectoryHandle)) {
        if (!A.ordnerMoeglich()) throw new Error('Dieser Browser kann nicht in einen Ordner auf dem Gerät speichern. Das geht in Chrome und Edge.');
        try {
          dir = await window.showDirectoryPicker({ id: 'kontovia-speicher', mode: 'readwrite', startIn: 'documents' });
        } catch (err) {
          if (err?.name === 'AbortError') return null;
          throw new Error(err?.name === 'SecurityError' || err?.name === 'NotAllowedError'
            ? 'Diesen Ordner gibt der Browser nicht frei. Wählen Sie einen Ordner zum Beispiel unter Dokumente.'
            : err?.message || 'Der Ordner ließ sich nicht öffnen.');
        }
      }
      if ((await dir.requestPermission?.({ mode: 'readwrite' }) ?? 'granted') !== 'granted') {
        throw new Error('Ohne Erlaubnis zum Schreiben kann Kontovia den Ordner nicht verwenden.');
      }
      const info = await A.ordnerPruefen(dir, { anlegen: opts?.zweck === 'umziehen' });
      gewaehlt = info;
      return { name: info.name, pfad: info.pfad, tresor: info.tresor };
    }, { needsUnlock: false }),
    /** Den eben gewählten Ordner mit seiner Buchhaltung verwenden (solange im Browser keine liegt). */
    ordnerOeffnen: handle(async () => {
      if (!gewaehlt?.tresor) throw new Error('Im gewählten Ordner liegt keine Kontovia-Buchhaltung.');
      if (!vault.isLocked || await vault.exists()) {
        throw new Error('In diesem Browser gibt es schon eine Buchhaltung. Ziehen Sie sie in den Einstellungen in einen Ordner um, oder öffnen Sie den Ordner in einem anderen Browser.');
      }
      await A.ordnerVerwenden(gewaehlt.handle);
      gewaehlt = null;
      return ortBeschreiben();
    }, { needsUnlock: false }),
    /** Die offene Buchhaltung samt Belegen und Sicherungen in den gewählten Ordner umziehen. */
    inOrdner: handle(async () => {
      if (!gewaehlt) throw new Error('Bitte zuerst einen Ordner wählen.');
      if (gewaehlt.tresor) throw new Error(`Im Ordner „${gewaehlt.pfad}“ liegt schon eine Kontovia-Buchhaltung. Wählen Sie einen anderen Ordner.`);
      await vault.saving?.catch(() => {});
      const res = await A.inOrdnerUmziehen(gewaehlt.handle, { pruefen: (s, k, b) => vault.kopiePruefen(s, k, b), fortschritt: (p) => send('speicher', p) });
      res.pfad = gewaehlt.pfad;
      gewaehlt = null;
      await ortBeschreiben();
      return res;
    }),
    /** Zurück in den Speicher des Browsers; die Dateien im Ordner bleiben liegen. */
    inBrowser: handle(async () => {
      await vault.saving?.catch(() => {});
      const res = await A.inBrowserUmziehen({ pruefen: (s, k, b) => vault.kopiePruefen(s, k, b), fortschritt: (p) => send('speicher', p) });
      await ortBeschreiben();
      return res;
    }),
    /** Den Ordner nicht mehr verwenden (nur gesperrt, etwa wenn er fehlt). Die Dateien darin bleiben. */
    ordnerVergessen: handle(async () => {
      if (!vault.isLocked) throw new Error('Bitte zuerst sperren.');
      await A.ordnerVergessen();
      return ortBeschreiben();
    }, { needsUnlock: false }),
  },

  update: {
    check: handle(async (silent) => {
      const info = await U.pruefen({ silent: !!silent });
      // Als App installiert: ein Punkt am Symbol, solange eine neue Fassung wartet
      // (wie der Fortschritt in der Windows-Taskleiste). Reiner Zusatz.
      if (info?.reachable) {
        try { await (info.available ? navigator.setAppBadge?.() : navigator.clearAppBadge?.()); } catch { /* nicht unterstützt */ }
      }
      return info;
    }, { needsUnlock: false }),
    download: handle(async (info) => U.herunterladen(info, (p) => send('updateProgress', p)), { needsUnlock: false }),
    install: handle(async (version) => {
      // Angemeldet bleiben: den Schlüssel für genau den nächsten Start übergeben.
      if (!vault.isLocked) {
        await vault.saving?.catch(() => {});
        await UE.ablegen(vault.dek, { version: str(version, 20) }).catch((e) => console.error('Übergabe:', e));
      }
      doLock('aktualisierung');
      try { await navigator.clearAppBadge?.(); } catch { /* nicht unterstützt */ }
      try {
        return await U.installieren(version);
      } catch (err) {
        await UE.verwerfen();
        throw err;
      }
    }, { needsUnlock: false }),
  },

  cloud: {
    status: handle(async () => (vault.isLocked ? { configured: false } : cloud.status()), { needsUnlock: false }),
    configure: handle(async (opts = {}) => {
      cloud.configure(opts);
      await vault.save(vault.db);
      restartAutoSync();
      return cloud.status();
    }),
    connect: handle(async (opts = {}) => {
      // Ohne Code: zu Google und zurück. Vorher alles Ungespeicherte schreiben –
      // die Seite lädt dabei neu.
      if (!opts?.mitCode && cloud.weiterleitungMoeglich()) {
        await vault.saving?.catch(() => {});
        return cloud.weiterleiten('verbinden');
      }
      const res = await cloud.connect();
      restartAutoSync();
      return res;
    }),
    disconnect: handle(async (keepRemote) => {
      const res = await cloud.disconnect({ keepRemote: keepRemote !== false });
      restartAutoSync();
      return res;
    }),
    begin: handle(async (opts = {}) => {
      const res = kopie(await cloud.begin({ force: !!opts.force, dirty: opts.dirty !== false }));
      if (res.remote) res.remote = fuerOberflaeche(res.remote);
      if (res.base) res.base = fuerOberflaeche(res.base);
      return res;
    }),
    commit: handle(async (db) => {
      if (!db || typeof db !== 'object' || !Array.isArray(db.transactions)) {
        throw new Error('Ungültiger Datenbestand. Abgleich abgebrochen.');
      }
      return cloud.commit(kopie(db), (p) => send('cloudProgress', p));
    }),
    adoptRemote: handle(async () => {
      await cloud.adoptRemote();
      nachSperre('cloud-uebernahme');
      return true;
    }),
    overwriteRemote: handle(async () => cloud.overwriteRemote()),
    quota: handle(async () => cloud.quota()),
    backups: handle(async () => kopie(await cloud.sicherungen())),
    backupNow: handle(async () => cloud.jetztSichern()),
    restoreBackup: handle(async (name, password) => {
      const res = await cloud.sicherungEinspielen(str(name, 80), password ? String(password) : '');
      if (res.state === 'uebernommen') nachSperre('sicherung-uebernommen');
      return res;
    }),
    signinStatus: handle(async () => { await rueckkehrFertig; return cloud.anmeldeStatus(); }, { needsUnlock: false }),
    signin: handle(async (opts = {}) => {
      if (!opts?.mitCode && cloud.weiterleitungMoeglich()) return cloud.weiterleiten('erststart');
      return cloud.anmelden();
    }, { needsUnlock: false }),
    rueckmeldung: handle(async () => { await rueckkehrFertig; return kopie(cloud.rueckmeldung()); }, { needsUnlock: false }),
    signinCancel: handle(async () => cloud.anmeldungVerwerfen(), { needsUnlock: false }),
    signinLoad: handle(async (password) => {
      if (anderesFenster) throw new Error('Kontovia ist in einem anderen Fenster geöffnet. Bitte dort weiterarbeiten oder dieses Fenster neu laden.');
      if (failedUnlocks > 0) {
        const wait = Math.min(8000, 250 * 2 ** Math.min(failedUnlocks, 5));
        await new Promise((r) => setTimeout(r, wait));
      }
      try {
        const db = await cloud.ausCloudLaden(String(password ?? ''));
        failedUnlocks = 0;
        autoLockMinutes = Number(db?.settings?.autoLockMinutes ?? 10);
        resetLockTimer();
        restartAutoSync();
        A.dauerhaftAnfordern();
        sperreBeobachten();
        return kopie(fuerOberflaeche(db));
      } catch (err) {
        if (err?.code === 'BAD_PASSWORD') failedUnlocks++;
        throw err;
      }
    }, { needsUnlock: false }),
  },

  /* Google Kalender (gcal.js): Abgleich in beide Richtungen.
     Die Anmeldung läuft über ein kleines Fenster bei Google, der Zugriff gilt
     eine Stunde und wird danach mit einem Tipp erneuert (bestaetigen). */
  gcal: {
    status: handle(async () => (vault.isLocked ? { available: true, linked: false } : gcal.status()), { needsUnlock: false }),
    connect: handle(async (opts = {}) => gcal.connect({
      calendarIdHint: str(opts.calendarIdHint, 300), timeZone: str(opts.timeZone, 80), weitere: !!opts.weitere, merk: opts.merk, umleiten: !!opts.umleiten,
    })),
    bestaetigen: handle(async (opts = {}) => gcal.bestaetigen({ umleiten: !!opts?.umleiten })),
    rueckmeldung: handle(async () => kopie(await gcal.rueckmeldung())),
    cancel: handle(async () => gcal.abbrechen(), { needsUnlock: false }),
    disconnect: handle(async (opts = {}) => gcal.disconnect({ deleteCalendar: !!opts.deleteCalendar })),
    pull: handle(async (opts = {}) => kopie(await gcal.pull({ timeZone: str(opts.timeZone, 80) }))),
    calendars: handle(async () => kopie(await gcal.kalenderListe())),
    pullWeitere: handle(async (opts = {}) => kopie(await gcal.pullWeitere(opts))),
    push: handle(async (ops) => kopie(await gcal.push(ops))),
    finish: handle(async (opts = {}) => kopie(await gcal.finish(opts))),
  },

  /* Die PDF-Dateien entstehen in der Oberfläche (lib/pdfausgabe.js). Hier
     bleibt der Druckdialog als Zusatzweg für die druckfertige Seite. */
  pdf: {
    create: handle(async ({ html, defaultName, landscape } = {}) => {
      await drucken(html, { landscape: !!landscape, titel: defaultName || 'Bericht' });
      return { printed: true };
    }),
  },

  on: {
    locked: anmelden('locked'),
    updateProgress: anmelden('updateProgress'),
    cloudProgress: anmelden('cloudProgress'),
    cloudTick: anmelden('cloudTick'),
    menu: anmelden('menu'),
    speicher: anmelden('speicher'),
  },
};

/* -------------------------------------------------------------------------- */
/* Start                                                                       */
/* -------------------------------------------------------------------------- */

/** Was fehlt, damit Kontovia hier laufen kann – oder null. */
async function voraussetzungen() {
  if (!isSecureContext || !crypto?.subtle) {
    return 'Kontovia braucht eine verschlüsselte Verbindung (https). Über eine unverschlüsselte Adresse gibt der Browser die Verschlüsselungsfunktionen nicht frei.';
  }
  if (typeof CompressionStream === 'undefined' || typeof structuredClone === 'undefined' || !window.indexedDB) {
    return 'Dieser Browser ist zu alt für Kontovia. Nötig ist mindestens iOS bzw. Safari 16.4, Chrome 103 oder Firefox 113.';
  }
  try {
    await A.lesen('dateien', 'geraet');
  } catch {
    return 'Der Browser erlaubt Kontovia nicht, Daten abzulegen. Das ist im privaten Modus üblich. Bitte in einem normalen Fenster öffnen.';
  }
  return null;
}

function startFehler(text) {
  document.getElementById('app').innerHTML = `
    <div class="gate"><div class="gate-card">
      <div class="gate-logo">K</div>
      <h2>Kontovia kann hier nicht starten</h2>
      <p class="lead">${text}</p>
    </div></div>`;
}

const fehlt = nurGoogleFenster ? null : await voraussetzungen();
if (nurGoogleFenster) {
  // Fenster, die ein Skript geöffnet hat, darf es auch schließen. Bleibt es
  // doch offen (etwa, wenn der Browser die Verbindung gekappt hat), steht hier,
  // was zu tun ist.
  document.getElementById('app').innerHTML = `
    <div class="gate"><div class="gate-card">
      <div class="gate-logo">K</div>
      <h2>Fertig</h2>
      <p class="lead">Kontovia hat die Antwort von Google erhalten. Sie können dieses Fenster schließen.</p>
    </div></div>`;
  setTimeout(() => window.close(), 50);
} else if (fehlt) {
  startFehler(fehlt);
} else {
  Object.assign(device, await geraetLaden());
  await A.speicherortLaden().catch((e) => console.error('Speicherort:', e));
  fortsetzen = await UE.abholen({ version: U.VERSION }).catch(() => null);
  // Nur für den Start gedacht: wer nicht gleich weitermacht, braucht das Passwort.
  if (fortsetzen) setTimeout(() => { if (fortsetzen) { K.wipe(fortsetzen); fortsetzen = null; } }, UE.GUELTIG_MS);
  await ortBeschreiben().catch(() => {});
  einzigesFenster();
  ruhezustandBeobachten();
  window.kontovia = Object.freeze(api);

  U.registrieren().then(() => U.aufraeumen());

  // Auf iPhone und iPad einmal zeigen, wie Kontovia zur App auf dem Gerät wird.
  if (D.istMobilesApple() && !istAppFenster()) {
    try {
      if (!sessionStorage.getItem('kv-hinweis')) {
        sessionStorage.setItem('kv-hinweis', '1');
        setTimeout(() => toast('Als App installieren',
          'In Safari auf „Teilen“ und dann „Zum Home-Bildschirm“ tippen. Kontovia startet dann wie eine App und funktioniert offline.',
          '', 14000), 1500);
      }
    } catch { /* privater Modus */ }
  }

  // Die Oberfläche erst jetzt laden: sie liest window.kontovia beim Start.
  await import('../app.js');
}
