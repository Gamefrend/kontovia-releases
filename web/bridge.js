/**
 * Kontovia – Brücke der Web-Fassung.
 *
 * Stellt `window.kontovia` bereit: dieselbe feste Liste benannter Funktionen
 * wie src/preload/preload.js in der Windows-Fassung. Die Oberfläche merkt
 * nicht, ob hinter ihr Electron oder der Browser arbeitet – sie ist in beiden
 * Fassungen dieselbe, jede Neuerung dort kommt in beiden an.
 *
 * Was in Electron der Hauptprozess erledigt, geschieht hier in derselben
 * Seite: Verschlüsselung (kern.js), Ablage (ablage.js, tresor.js),
 * Cloud-Abgleich (cloud.js), Dateien (dateien.js), Druck (druck.js) und
 * Aktualisierung (aktualisierung.js). Die Oberfläche bekommt – wie über die
 * IPC-Grenze – nur Kopien der Daten, nie die Objekte selbst.
 */

import * as K from './kern.js';
import * as A from './ablage.js';
import { Vault, MAX_ATTACHMENT_BYTES } from './tresor.js';
import { Cloud } from './cloud.js';
import * as D from './dateien.js';
import { drucken } from './druck.js';
import * as U from './aktualisierung.js';
import { makeSeed } from './seed.js';
import { modal, toast } from '../lib/ui.js';
import './mobil.js';

const vault = new Vault(U.VERSION);
const cloud = new Cloud(vault, { zeigeCode });
const device = { id: '', name: '' };

let autoLockMinutes = 10;
let lockTimer = null;
let failedUnlocks = 0;

const kopie = (v) => (v === undefined ? v : structuredClone(v));
const str = (v, max = 500) => String(v ?? '').slice(0, max);

/* -------------------------------------------------------------------------- */
/* Ereignisse                                                                  */
/* -------------------------------------------------------------------------- */

const hoerer = { locked: new Set(), updateProgress: new Set(), cloudProgress: new Set(), cloudTick: new Set(), menu: new Set() };

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
 * Wie `handle` im Hauptprozess: gesperrt heißt gesperrt, und die Oberfläche
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
 * Jede Installation bekommt eine zufällige Kennung – sie steht wie in der
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
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = null;
  restartAutoSync();
  send('locked', { reason });
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
/* Tastenkürzel (in Electron über das Anwendungsmenü)                          */
/* -------------------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  const views = { 1: 'dashboard', 2: 'transactions', 3: 'calendar', 4: 'reports', 5: 'export', 6: 'master', ',': 'settings' };
  let action = null;
  if (k === 'l') { if (!vault.isLocked) { e.preventDefault(); doLock('manuell'); } return; }
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
        <li>Öffnen Sie <strong>${url.replace(/^https:\/\//, '').replace(/[<>&"]/g, '')}</strong> – hier oder auf einem anderen Gerät.</li>
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
/* Die Brücke                                                                  */
/* -------------------------------------------------------------------------- */

const api = {
  platform: 'web',
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
      throw new Error('Die Web-Fassung legt ihre Daten im Speicher des Browsers ab – einen Ordner dafür gibt es nicht.');
    }, { needsUnlock: false }),
    openLicense: handle(async (which) => {
      const datei = { compliance: 'COMPLIANCE.html', datenschutz: 'DATENSCHUTZ.html' }[String(which)];
      if (!datei) throw new Error('Die Web-Fassung enthält weder Electron noch Chromium; es gelten die Lizenzbedingungen Ihres Browsers.');
      window.open(new URL(`../recht/${datei}`, import.meta.url).href, '_blank', 'noopener');
      return datei;
    }, { needsUnlock: false }),
    activity: async () => { resetLockTimer(); return true; },
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
    status: handle(async () => ({ exists: await vault.exists(), locked: vault.isLocked, autoLockMinutes }), { needsUnlock: false }),
    create: handle(async (password, settings) => {
      if (typeof password !== 'string' || password.length < 10) throw new Error('Das Passwort muss mindestens 10 Zeichen haben.');
      const db = makeSeed(settings && typeof settings === 'object' ? kopie(settings) : {});
      await vault.create(password, db);
      autoLockMinutes = db.settings.autoLockMinutes;
      resetLockTimer();
      A.dauerhaftAnfordern();
      return kopie(db);
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
        restartAutoSync();
        A.dauerhaftAnfordern();
        return kopie(db);
      } catch (err) {
        failedUnlocks++;
        throw err;
      }
    }, { needsUnlock: false }),
    lock: handle(async () => { doLock('manuell'); return true; }, { needsUnlock: false }),
    read: handle(async () => kopie(vault.db)),
    write: handle(async (db) => {
      if (!db || typeof db !== 'object' || !Array.isArray(db.transactions)) {
        throw new Error('Ungültiger Datenbestand – Speichern abgebrochen.');
      }
      const neu = kopie(db);
      // Der Cloud-Block wird ausschließlich hier geführt (wie im Hauptprozess);
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
    storage: handle(async () => vault.storageStats(), { needsUnlock: false }),
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

  update: {
    check: handle(async (silent) => U.pruefen({ silent: !!silent }), { needsUnlock: false }),
    download: handle(async (info) => U.herunterladen(info, (p) => send('updateProgress', p)), { needsUnlock: false }),
    install: handle(async (version) => {
      doLock('aktualisierung');
      return U.installieren(version);
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
    connect: handle(async () => {
      const res = await cloud.connect();
      restartAutoSync();
      return res;
    }),
    disconnect: handle(async (keepRemote) => {
      const res = await cloud.disconnect({ keepRemote: keepRemote !== false });
      restartAutoSync();
      return res;
    }),
    begin: handle(async (opts = {}) => kopie(await cloud.begin({ force: !!opts.force, dirty: opts.dirty !== false }))),
    commit: handle(async (db) => {
      if (!db || typeof db !== 'object' || !Array.isArray(db.transactions)) {
        throw new Error('Ungültiger Datenbestand – Abgleich abgebrochen.');
      }
      return cloud.commit(kopie(db), (p) => send('cloudProgress', p));
    }),
    adoptRemote: handle(async () => {
      await cloud.adoptRemote();
      doLock('cloud-uebernahme');
      return true;
    }),
    overwriteRemote: handle(async () => cloud.overwriteRemote()),
    quota: handle(async () => cloud.quota()),
  },

  /* Google Kalender: Die Web-Fassung meldet sich per Code an (RFC 8628), und
     für diesen Weg lässt Google den Kalenderzugriff nicht zu – nur Anmeldung,
     Drive-Dateien und YouTube. Deshalb gibt es den Abgleich nur in der
     Windows-Fassung; hier helfen Kalenderdateien (.ics) in beide Richtungen. */
  gcal: (() => {
    const nurWindows = handle(async () => {
      throw new Error('Den Abgleich mit Google Kalender gibt es nur in der Windows-Fassung. In der Web-Fassung lassen sich Termine als Kalenderdatei (.ics) übertragen.');
    });
    return {
      status: handle(async () => ({ available: false, reason: 'web', linked: false }), { needsUnlock: false }),
      connect: nurWindows, disconnect: nurWindows, pull: nurWindows, push: nurWindows, finish: nurWindows,
    };
  })(),

  pdf: {
    create: handle(async ({ html, defaultName, landscape, returnBase64 } = {}) => {
      if (returnBase64) {
        // Ohne Druckdialog lässt sich im Browser kein PDF erzeugen. Für Pakete
        // mit vielen Berichten gehen sie deshalb als druckfertige HTML-Seiten
        // mit – jeder Browser öffnet und druckt sie.
        const name = String(defaultName || 'bericht.pdf').replace(/\.pdf$/i, '.html');
        const bytes = K.utf8(String(html ?? ''));
        return { dataBase64: K.toBase64(bytes), bytes: bytes.length, fileName: name };
      }
      toast('Druckansicht', D.istMobilesApple()
        ? 'Im Druckfenster über „Teilen“ lässt sich der Bericht als PDF sichern.'
        : 'Als Drucker „Als PDF speichern“ wählen, um eine PDF-Datei zu erhalten.', '', 6000);
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
    return 'Der Browser erlaubt Kontovia nicht, Daten abzulegen – das ist im privaten Modus üblich. Bitte in einem normalen Fenster öffnen.';
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

const fehlt = await voraussetzungen();
if (fehlt) {
  startFehler(fehlt);
} else {
  Object.assign(device, await geraetLaden());
  einzigesFenster();
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
