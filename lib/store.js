/**
 * Kontovia – Datenhaltung im Renderer.
 *
 * Der gesamte Bestand liegt als ein Objekt im Speicher und wird nach jeder
 * Änderung verschlüsselt auf die Platte geschrieben (verzögert gebündelt,
 * damit Tippen im Formular nicht bei jedem Zeichen die Datei neu schreibt).
 *
 * Jede Änderung erzeugt zusätzlich einen Eintrag im Änderungsjournal. Die
 * Einträge sind über SHA-256 verkettet: verändert jemand nachträglich einen
 * Eintrag, passen alle folgenden Prüfsummen nicht mehr. Das ist die technische
 * Grundlage für die von der GoBD geforderte Unveränderbarkeit.
 */

import { uid, sha256Hex, todayISO, debounce } from './util.js';
import { migrateEuerLines } from './euer.js';
import { buchungAusRegel, buchungsId } from './wiederkehrend.js';
import { darf, verbotText } from './rollen.js';

/* Im Fenster die Brücke zur Web-Schicht (src/web/bridge.js); außerhalb
   (Prüfungen) leer, damit sich die reinen Funktionen dieser Datei für sich prüfen lassen. */
const api = globalThis.window?.kontovia || {};

/** Kennung dieser Installation – wird beim Start aus der Web-Schicht gesetzt. */
let deviceId = 'lokal';
export function setDevice(id) { if (id) deviceId = String(id); }
export function getDevice() { return deviceId; }

const listeners = new Set();

export const store = {
  db: null,
  status: 'idle', // idle | saving | saved | error
  lastSaved: null,
  error: null,
  dirty: false,
  /* Zaehlt jede fachliche Aenderung. Der Cloud-Abgleich merkt sich den Stand
     vor dem Hochladen: ist er danach hoeher, wurde waehrenddessen gearbeitet
     und der Bestand darf nicht als „gesichert“ gelten. */
  revision: 0,
  /* Was die Schemapflege beim letzten Laden umgestellt hat – die Oberfläche
     sagt es einmal an und vermerkt es im Journal (siehe app.js). */
  hinweise: [],
  /* Wer gerade arbeitet: {id, name, rolle}, wenn das Konto Benutzer hat (lib/benutzer.js),
     sonst null. Ohne Benutzer gibt es weder Rollen noch einen Vermerk im Journal. */
  nutzer: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(event = {}) {
  for (const fn of listeners) {
    try { fn(event); } catch (err) { console.error('Listener-Fehler', err); }
  }
}

/** Wer beim Sperren etwas vergessen muss (etwa den Inhalt eines eingelesenen Kontoauszugs), meldet sich hier an. */
const sperrHaken = new Set();
export function beimSperren(fn) { sperrHaken.add(fn); return () => sperrHaken.delete(fn); }

/**
 * Beim Sperren: Der entschlüsselte Bestand hat im Speicher der Oberfläche
 * nichts mehr verloren. Bis Fassung 1.7.0 blieb er stehen – und über das Menü
 * (Strg+N) ließ sich über dem Sperrbildschirm ein Buchungsfenster mit allen
 * Kategorien, Kontakten und Konten öffnen.
 */
export function clearDb() {
  for (const f of sperrHaken) { try { f(); } catch (e) { console.error('Sperr-Haken:', e); } }
  store.db = null;
  store.dirty = false;
  store.status = 'idle';
  store.error = null;
  store.hinweise = [];
  store.nutzer = null;
}

export function setDb(db) {
  const { db: geprueft, repariert, hinweise } = migrate(db);
  store.db = geprueft;
  store.hinweise = hinweise;
  // Eine Reparatur ist eine echte Aenderung am Bestand und muss geschrieben
  // werden – sonst liefe sie bei jedem Start erneut ins Leere.
  store.dirty = repariert > 0;
  if (repariert > 0) scheduleSave();
  notify({ type: 'db' });
}

/* -------------------------------------------------------------------------- */
/* Schemapflege                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Bringt einen geladenen Bestand auf den erwarteten Stand.
 * @returns {{db:object, repariert:number, hinweise:Array<{art:string, text:string}>}}
 *   repariert: Anzahl der Änderungen, die geschrieben werden müssen
 */
export function migrate(db) {
  if (!db || typeof db !== 'object') throw new Error('Leerer Datenbestand.');
  db.schema ??= 1;
  db.settings ??= {};
  for (const key of ['accounts', 'categories', 'contacts', 'transactions', 'attachments', 'appointments', 'todos', 'assets', 'recurring',
    'invoices', 'products', 'invoiceTemplates', 'feedback', 'reminders', 'bankRules', 'bankTemplates', 'imports', 'users', 'auditLog', 'locks', 'tombstones']) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  db.counters ??= { invoice: 1 };
  db.cloud ??= {};
  // Grabsteine älter als ein Jahr können weg: so lange hat jedes Gerät
  // längst abgeglichen, und die Liste soll nicht endlos wachsen.
  const grenze = new Date(Date.now() - 365 * 86400000).toISOString();
  db.tombstones = db.tombstones.filter((t) => String(t.deletedAt) > grenze);
  db.euerLines ??= {};
  db.settings.accountingBasis ??= 'ist';
  db.settings.taxMode ??= 'regelbesteuerung';
  db.settings.autoLockMinutes ??= 10;
  db.settings.theme ??= 'system';
  db.settings.currency ??= 'EUR';
  db.settings.chartOfAccounts ??= 'SKR03';
  const hinweise = [];
  let repariert = repairAttachmentIndex(db);

  const euer = migrateEuerLines(db);
  if (euer) {
    repariert += euer.geaendert || 1;
    hinweise.push({
      art: 'euer',
      text: `Die EÜR-Zeilen folgen jetzt den amtlichen Vordrucken 2025 und 2026${euer.geaendert ? ` (${euer.geaendert} Kategorien umgestellt)` : ''}.`
        + (euer.eigene.length ? ` Bitte die eigene Zuordnung prüfen: ${euer.eigene.join(', ')}.` : ''),
    });
  }

  const text = repairEscapedText(db);
  if (text.geaendert) {
    repariert += text.geaendert;
    hinweise.push({
      art: 'sonderzeichen',
      text: `Sonderzeichen wie ' & " < > wurden bis Fassung 1.6 beim Bearbeiten mehrfach umgeschrieben (etwa &amp;#39; statt '). `
        + `${text.geaendert === 1 ? 'Ein Eintrag ist' : `${text.geaendert} Einträge sind`} wiederhergestellt.`
        + (text.gesperrt ? ` ${text.gesperrt === 1 ? 'Eine festgeschriebene oder stornierte Buchung bleibt' : `${text.gesperrt} festgeschriebene oder stornierte Buchungen bleiben`} unverändert.` : ''),
    });
  }

  if (db.schema < 2) {
    const verschoben = migrateStornoDates(db);
    db.schema = 2;
    repariert++;
    if (verschoben) {
      hinweise.push({
        art: 'storno',
        text: `${verschoben === 1 ? 'Eine Gegenbuchung' : `${verschoben} Gegenbuchungen`} aus einem Storno trägt jetzt das Datum `
          + 'der stornierten Buchung. Bisher zählte ein Storno doppelt, die Auswertungen stimmen jetzt.',
      });
    }
  }
  return { db, repariert, hinweise };
}

/**
 * Bis Fassung 1.5 trug die Gegenbuchung eines Stornos das Datum des Stornos,
 * und gezählt wurde nur sie – ein Storno über 119 € ergab −119 € statt null.
 * Seit 1.6 zählen Original und Gegenbuchung beide. Damit der Zeitraum des
 * Originals so bleibt, wie er bisher aussah (ohne die Buchung), bekommt die
 * Gegenbuchung dessen Datum.
 *
 * Ausgenommen sind Stornos, deren Original beim Stornieren schon
 * festgeschrieben war: Dort ist der abgeschlossene Zeitraum mit der Buchung
 * erklärt worden, und die Korrektur gehört in den Zeitraum des Stornos.
 *
 * @returns {number} Anzahl der umdatierten Gegenbuchungen
 */
export function migrateStornoDates(db) {
  const byId = new Map((db.transactions || []).map((t) => [t.id, t]));
  const jetzt = new Date().toISOString();
  let n = 0;
  for (const c of db.transactions || []) {
    if (!c.isReversal || !c.reversalOf) continue;
    const orig = byId.get(c.reversalOf);
    if (!orig || (c.date === orig.date && (c.paidDate || '') === (orig.paidDate || ''))) continue;
    const vorher = String(c.createdAt || jetzt);
    const warGesperrt = (db.locks || []).some((l) => String(l.ts || '') <= vorher
      && (String(orig.date) <= l.until || (!!orig.paidDate && String(orig.paidDate) <= l.until)));
    if (warGesperrt) continue;
    c.date = orig.date;
    c.paidDate = orig.paidDate ? orig.paidDate : '';
    c.updatedAt = jetzt;
    n++;
  }
  return n;
}

/**
 * Bis Fassung 1.6 maskierten viele Formulare ihre Vorbelegung doppelt: aus
 * „Kunde's“ wurde im Eingabefeld „Kunde&#39;s“, und jedes weitere Speichern
 * legte eine Schicht dazu („&amp;#39;“, „&amp;amp;#39;“ …). Hier werden die
 * Schichten in genau den Feldern dieser Formulare wieder abgetragen.
 *
 * Festgeschriebene und stornierte Buchungen bleiben, wie sie sind: Sie lassen
 * sich auch von Hand nicht mehr ändern, und so bleibt es beim Stand, der
 * erklärt oder exportiert wurde.
 *
 * Läuft bei jedem Laden: Ein anderes Gerät mit älterer Fassung kann über den
 * Abgleich neue Schichten liefern. Der Bearbeitungszeitpunkt rückt vor, damit
 * die Reparatur beim Abgleich und im Google-Kalender ankommt.
 *
 * @returns {{geaendert:number, gesperrt:number}}
 */
export function repairEscapedText(db) {
  const FELDER = {
    appointments: ['title', 'location', 'notes'],
    todos: ['title', 'notes'],
    transactions: ['description', 'invoiceNumber', 'reference', 'notes'],
    contacts: ['name', 'email', 'phone', 'address', 'taxId', 'notes'],
    categories: ['name', 'skr03', 'skr04'],
    accounts: ['name', 'iban', 'skr03', 'skr04'],
    assets: ['name'],
  };
  const bis = (db.locks || []).reduce((acc, l) => (String(l.until || '') > acc ? String(l.until) : acc), '');
  const gesperrt = (t) => t.voided || t.isReversal
    || (!!bis && (String(t.date) <= bis || (!!t.paidDate && String(t.paidDate) <= bis)));
  const jetzt = new Date().toISOString();
  let geaendert = 0;
  let uebergangen = 0;

  const reparieren = (item, felder) => {
    const neu = {};
    for (const f of felder) {
      if (typeof item[f] !== 'string' || !ENTITY.test(item[f])) continue;
      const klar = unescapeText(item[f]);
      if (klar !== item[f]) neu[f] = klar;
    }
    return Object.keys(neu).length ? neu : null;
  };

  for (const [sammlung, felder] of Object.entries(FELDER)) {
    for (const item of db[sammlung] || []) {
      const neu = reparieren(item, felder);
      if (!neu) continue;
      if (sammlung === 'transactions' && gesperrt(item)) { uebergangen++; continue; }
      Object.assign(item, neu, { updatedAt: jetzt });
      geaendert++;
    }
  }
  const s = db.settings || {};
  const neu = reparieren(s, ['companyName', 'ownerName', 'street', 'zip', 'city', 'taxNumber', 'vatId', 'taxOffice', 'email', 'phone']);
  if (neu) {
    Object.assign(s, neu, { updatedAt: jetzt });
    geaendert++;
  }
  return { geaendert, gesperrt: uebergangen };
}

/** Die fünf Zeichen, die esc() maskiert. */
const ENTITY = /&(?:amp|lt|gt|quot|#39);/;
const ENTITY_ALL = /&(amp|lt|gt|quot|#39);/g;
const KLARTEXT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/** Trägt alle Maskierungsschichten ab: „&amp;amp;#39;“ → „'“. */
export function unescapeText(s) {
  let out = String(s);
  for (let i = 0; i < 20; i++) {
    const next = out.replace(ENTITY_ALL, (_, k) => KLARTEXT[k]);
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Bis einschliesslich Fassung 1.1.6 wurde zu einem angehaengten Beleg zwar die
 * verschluesselte Datei geschrieben, aber kein Eintrag in `db.attachments`.
 * Ohne diesen Eintrag hielt das Aufraeumen die Datei fuer verwaist, der
 * Cloud-Abgleich lud sie nie hoch, und beim naechsten Speichern verlor die
 * Buchung ihre Verknuepfung.
 *
 * Fuer jede noch verknuepfte Kennung wird deshalb ein Ersatzeintrag angelegt.
 * Dateiname, Groesse und Pruefsumme sind nicht mehr herstellbar – die Datei
 * selbst bleibt aber lesbar und bekommt beim Ansehen ihren Typ zurueck.
 *
 * @returns {number} Anzahl der ergaenzten Eintraege
 */
export function repairAttachmentIndex(db) {
  const bekannt = new Set((db.attachments || []).map((a) => a.id));
  // Ein Beleg, der andernorts geloescht wurde, darf nicht zurueckkehren.
  const begraben = new Set((db.tombstones || [])
    .filter((t) => t.collection === 'attachments').map((t) => t.id));
  let ergaenzt = 0;
  for (const t of db.transactions || []) {
    for (const id of t.attachments || []) {
      if (!/^[a-f0-9]{32}$/.test(String(id)) || bekannt.has(id) || begraben.has(id)) continue;
      bekannt.add(id);
      db.attachments.push({
        id,
        fileName: 'Beleg (Name nicht mehr bekannt)',
        mime: '',
        size: 0,
        sha256: '',
        createdAt: t.createdAt || new Date().toISOString(),
        recovered: true,
      });
      ergaenzt++;
    }
  }
  return ergaenzt;
}

/* -------------------------------------------------------------------------- */
/* Speichern                                                                   */
/* -------------------------------------------------------------------------- */

let savePromise = Promise.resolve();

export async function saveNow() {
  // Ohne Brücke zur Web-Schicht gibt es nichts zu schreiben – das ist beim
  // Prüfen der reinen Funktionen dieser Datei der Normalfall.
  if (!store.db || !api.vault) return;
  store.status = 'saving';
  notify({ type: 'status' });
  const run = async () => {
    try {
      const res = await api.vault.write(store.db);
      store.status = 'saved';
      store.lastSaved = res.savedAt;
      store.error = null;
      store.dirty = false;
    } catch (err) {
      store.status = 'error';
      store.error = err.message;
      // Nicht still scheitern: ungespeicherte Buchhaltung ist ein echtes Problem.
      console.error('Speichern fehlgeschlagen', err);
    }
    notify({ type: 'status' });
  };
  savePromise = savePromise.then(run, run);
  return savePromise;
}

const scheduleSave = debounce(() => { saveNow(); }, 700);

/* -------------------------------------------------------------------------- */
/* Änderungen                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Führt eine Änderung aus, schreibt sie ins Journal und stößt das Speichern an.
 * @param {string} action  z.B. 'buchung.anlegen'
 * @param {(db:object)=>any} mutator
 * @param {{entity?:string, entityId?:string, summary?:string, silent?:boolean, system?:boolean}} meta
 *   system: die Änderung geschieht von selbst (Abgleich, Schemapflege) und ist keine Handlung des Benutzers;
 *   Rollen beschränken sie nicht
 */
export async function commit(action, mutator, meta = {}) {
  const db = store.db;
  if (!db) throw new Error('Kein Datenbestand geladen.');
  // Die einzige Stelle, an der Rollen gelten: Jede Änderung läuft hier durch, bevor sie etwas verändert.
  if (!meta.system && store.nutzer && !darf(store.nutzer.rolle, action)) {
    const e = new Error(verbotText(store.nutzer.rolle));
    e.code = 'ROLLE';
    throw e;
  }
  const result = mutator(db);
  if (!meta.silent) {
    await appendAudit(db, {
      action,
      entity: meta.entity || '',
      entityId: meta.entityId || (result && result.id) || '',
      summary: meta.summary || '',
    });
  }
  store.dirty = true;
  store.revision++;
  notify({ type: 'change', action, result });
  scheduleSave();
  return result;
}

/*
 * Einträge werden nacheinander angehängt. Die Prüfsumme entsteht asynchron
 * (WebCrypto); ohne Warteschlange konnten zwei schnelle Änderungen – etwa
 * zwei Klicks auf „als bezahlt“ – denselben Vorgänger lesen, dieselbe Nummer
 * bekommen und die Kette sichtbar brechen („außerhalb verändert“).
 */
let auditQueue = Promise.resolve();

function appendAudit(db, entry) {
  const run = () => appendAuditNow(db, entry);
  auditQueue = auditQueue.then(run, run);
  return auditQueue;
}

async function appendAuditNow(db, entry) {
  // Jedes Gerät führt seine eigene Kette. Beim Zusammenführen zweier Stände
  // werden die Einträge gemischt – jede Kette bleibt für sich prüfbar.
  let prev = null;
  for (let i = db.auditLog.length - 1; i >= 0; i--) {
    if ((db.auditLog[i].device || 'lokal') === deviceId) { prev = db.auditLog[i]; break; }
  }
  const rec = {
    seq: (prev?.seq || 0) + 1,
    device: deviceId,
    ts: new Date().toISOString(),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    summary: String(entry.summary || '').slice(0, 300),
    prev: prev?.hash || 'GENESIS',
  };
  // Mit Benutzern vermerkt das Journal, wer es war. Ohne Benutzer fehlt das Feld ganz,
  // der Eintrag und seine Prüfsumme bleiben so, wie frühere Fassungen sie schrieben.
  if (store.nutzer?.name) rec.user = String(store.nutzer.name).slice(0, 60);
  rec.hash = await sha256Hex(JSON.stringify(rec));
  db.auditLog.push(rec);
  // Obergrenze, damit die Datei nicht unbegrenzt wächst. Die Verkettung bleibt
  // ab dem ältesten verbliebenen Eintrag prüfbar.
  if (db.auditLog.length > 50000) db.auditLog.splice(0, db.auditLog.length - 50000);
}

/** Prüft die Verkettung des Änderungsjournals. */
export async function verifyAudit() {
  const log = store.db?.auditLog || [];
  const chains = new Map();
  for (const e of log) {
    const dev = e.device || 'lokal';
    if (!chains.has(dev)) chains.set(dev, []);
    chains.get(dev).push(e);
  }
  for (const [dev, entries] of chains) {
    entries.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < entries.length; i++) {
      const { hash, ...rest } = entries[i];
      if (await sha256Hex(JSON.stringify(rest)) !== hash) {
        return { ok: false, device: dev, seq: entries[i].seq, reason: 'pruefsumme' };
      }
      if (i > 0 && entries[i].prev !== entries[i - 1].hash) {
        return { ok: false, device: dev, seq: entries[i].seq, reason: 'kette' };
      }
    }
  }
  return { ok: true, count: log.length, devices: chains.size };
}

/* -------------------------------------------------------------------------- */
/* Zugriffshelfer                                                              */
/* -------------------------------------------------------------------------- */

export const sel = {
  settings: () => store.db?.settings || {},
  categories: (kind) => (store.db?.categories || []).filter((c) => (!kind || c.kind === kind)),
  activeCategories: (kind) => sel.categories(kind).filter((c) => c.active !== false),
  category: (id) => (store.db?.categories || []).find((c) => c.id === id) || null,
  categoryName: (id) => sel.category(id)?.name || 'Ohne Kategorie',
  accounts: () => store.db?.accounts || [],
  account: (id) => (store.db?.accounts || []).find((a) => a.id === id) || null,
  accountName: (id) => sel.account(id)?.name || '–',
  contacts: () => store.db?.contacts || [],
  contact: (id) => (store.db?.contacts || []).find((c) => c.id === id) || null,
  contactName: (id) => sel.contact(id)?.name || '',
  transactions: () => store.db?.transactions || [],
  liveTransactions: () => (store.db?.transactions || []).filter((t) => !t.voided),
  transaction: (id) => (store.db?.transactions || []).find((t) => t.id === id) || null,
  appointments: () => store.db?.appointments || [],
  appointment: (id) => (store.db?.appointments || []).find((a) => a.id === id) || null,
  todos: () => store.db?.todos || [],
  todo: (id) => (store.db?.todos || []).find((t) => t.id === id) || null,
  todosOf: (appointmentId) => (store.db?.todos || []).filter((t) => appointmentId && t.appointmentId === appointmentId),
  recurring: () => store.db?.recurring || [],
  recurringRule: (id) => (store.db?.recurring || []).find((r) => r.id === id) || null,
  assets: () => store.db?.assets || [],
  invoices: () => store.db?.invoices || [],
  invoice: (id) => (store.db?.invoices || []).find((r) => r.id === id) || null,
  products: () => store.db?.products || [],
  product: (id) => (store.db?.products || []).find((p) => p.id === id) || null,
  invoiceTemplates: () => store.db?.invoiceTemplates || [],
  attachment: (id) => (store.db?.attachments || []).find((a) => a.id === id) || null,
  attachmentsOf: (tx) => (tx?.attachments || []).map(sel.attachment).filter(Boolean),
};

/** Bis zu diesem Datum sind Buchungen festgeschrieben und nur stornierbar. */
export function lockedUntil() {
  const locks = store.db?.locks || [];
  return locks.reduce((acc, l) => (l.until > acc ? l.until : acc), '');
}

export function isLockedDate(date) {
  const until = lockedUntil();
  return !!until && String(date) <= until;
}

/**
 * Beim Löschen bleibt ein Grabstein zurück. Ohne ihn könnte der Abgleich
 * nicht unterscheiden, ob ein Datensatz auf diesem Gerät gelöscht wurde
 * oder auf dem anderen gerade erst entstanden ist – gelöschte Buchungen
 * kämen bei jedem Abgleich zurück.
 */
export function tomb(db, collection, id) {
  db.tombstones ??= [];
  if (!db.tombstones.some((t) => t.collection === collection && t.id === id)) {
    db.tombstones.push({ collection, id, deletedAt: new Date().toISOString(), device: deviceId });
  }
}

/* -------------------------------------------------------------------------- */
/* Fachliche Operationen                                                       */
/* -------------------------------------------------------------------------- */

export function newTransactionDraft(type = 'expense') {
  const s = sel.settings();
  const cats = sel.activeCategories(type);
  return {
    id: uid('tx'),
    type,
    date: todayISO(),
    description: '',
    categoryId: cats[0]?.id || '',
    contactId: '',
    accountId: sel.accounts()[0]?.id || '',
    gross: 0,
    net: 0,
    vat: 0,
    vatRate: s.taxMode === 'kleinunternehmer' ? 0 : Number(s.defaultVatRate ?? 19),
    paidDate: todayISO(),
    dueDate: '',
    invoiceNumber: '',
    reference: '',
    notes: '',
    location: '',
    // Anzahlung: der Prozentsatz bezieht sich auf den vereinbarten Gesamtbetrag,
    // das Veranstaltungsdatum ist der Tag, an dem der Rest fällig wird.
    isDeposit: false,
    depositPercent: 0,
    eventDate: '',
    // Privat: nur zur eigenen Übersicht, nie in Finanzamt-Unterlagen.
    unlisted: false,
    attachments: [],
    appointmentIds: [],
    reverseCharge: false,
    voided: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Schreibt eine Buchung.
 *
 * @param {object} tx
 * @param {Array<object>} attachmentMetas Belegdaten der angehaengten Dateien.
 *   Sie gehoeren in den Bestand, nicht nur an die Buchung: Abgleich, Export
 *   und das Aufraeumen verwaister Dateien arbeiten mit diesem Verzeichnis.
 */
export async function upsertTransaction(tx, attachmentMetas = []) {
  const isNew = !sel.transaction(tx.id);
  tx.updatedAt = new Date().toISOString();
  tx.createdAt ??= tx.updatedAt;
  return commit(
    isNew ? 'buchung.anlegen' : 'buchung.aendern',
    (db) => {
      for (const meta of attachmentMetas) {
        if (!meta?.id) continue;
        const j = db.attachments.findIndex((a) => a.id === meta.id);
        const eintrag = { ...(j >= 0 ? db.attachments[j] : {}), ...meta };
        // Ein Eintrag mit echter Prüfsumme ist kein Notbehelf aus einer
        // älteren Fassung mehr und soll auch nicht mehr so beschriftet werden.
        if (eintrag.sha256) delete eintrag.recovered;
        if (j >= 0) db.attachments[j] = eintrag;
        else db.attachments.push(eintrag);
        // Ein frueher geloeschter Beleg mit derselben Kennung soll nicht
        // durch seinen alten Grabstein wieder verschwinden.
        db.tombstones = (db.tombstones || []).filter((t) => !(t.collection === 'attachments' && t.id === meta.id));
      }
      const i = db.transactions.findIndex((t) => t.id === tx.id);
      if (i >= 0) db.transactions[i] = tx;
      else db.transactions.push(tx);
      return tx;
    },
    { entity: 'buchung', entityId: tx.id, summary: `${tx.type === 'income' ? 'Einnahme' : 'Ausgabe'} ${tx.date} ${(tx.gross / 100).toFixed(2)} €, ${tx.description}${tx.unlisted ? ' (privat)' : ''}` },
  );
}

export async function deleteTransaction(id) {
  const tx = sel.transaction(id);
  if (!tx) return;
  // Original und Gegenbuchung eines Stornos gehören zusammen; fehlt eine der
  // beiden, stimmt keine Auswertung mehr.
  if (tx.voided || tx.isReversal) throw new Error('Eine stornierte Buchung und ihre Gegenbuchung lassen sich nicht löschen.');
  // Auch hier und nicht nur im Dialog: Wer auch immer löscht, darf einen
  // festgeschriebenen Zeitraum nicht verändern (GoBD Rz. 107 ff.).
  if (isLockedDate(tx.date) || (!!tx.paidDate && isLockedDate(tx.paidDate))) {
    throw new Error('Die Buchung liegt im festgeschriebenen Zeitraum und lässt sich nur noch stornieren.');
  }
  return commit('buchung.loeschen', (db) => {
    db.transactions = db.transactions.filter((t) => t.id !== id);
    tomb(db, 'transactions', id);
    // Verknüpfungen aus Terminen entfernen
    for (const a of db.appointments) {
      if (a.transactionIds?.includes(id)) a.transactionIds = a.transactionIds.filter((x) => x !== id);
    }
    return true;
  }, { entity: 'buchung', entityId: id, summary: `Gelöscht: ${tx.date} ${(tx.gross / 100).toFixed(2)} €, ${tx.description}` });
}

/**
 * Storno: die Originalbuchung bleibt erhalten, es entsteht eine Gegenbuchung.
 *
 * Die Gegenbuchung trägt die Daten des Originals, damit sich beide im selben
 * Zeitraum aufheben. Ist das Original schon festgeschrieben, bekommt sie das
 * heutige Datum: Der abgeschlossene Zeitraum bleibt dann, wie er erklärt wurde,
 * und die Korrektur wirkt im offenen (siehe isEffective in calc.js).
 */
export async function voidTransaction(id, reason) {
  const tx = sel.transaction(id);
  if (!tx) return;
  if (tx.voided || tx.isReversal) throw new Error('Diese Buchung ist bereits Teil eines Stornos.');
  const gesperrt = isLockedDate(tx.date) || (!!tx.paidDate && isLockedDate(tx.paidDate));
  const counter = {
    ...structuredClone(tx),
    id: uid('tx'),
    gross: -tx.gross,
    net: -tx.net,
    vat: -tx.vat,
    description: `Storno: ${tx.description}`,
    isReversal: true,
    reversalOf: id,
    date: gesperrt ? todayISO() : tx.date,
    paidDate: tx.paidDate ? (gesperrt ? todayISO() : tx.paidDate) : '',
    dueDate: gesperrt ? '' : tx.dueDate,
    attachments: [],
    // Die Gegenbuchung ist keine eigene Anzahlung und hängt an keinem Termin –
    // sonst erschiene im Kalender ein Restbetrag mit negativem Vorzeichen.
    appointmentIds: [],
    isDeposit: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return commit('buchung.stornieren', (db) => {
    const orig = db.transactions.find((t) => t.id === id);
    orig.voided = true;
    orig.voidedAt = new Date().toISOString();
    orig.voidReason = String(reason || '').slice(0, 300);
    orig.reversedBy = counter.id;
    orig.updatedAt = orig.voidedAt;
    db.transactions.push(counter);
    return counter;
  }, { entity: 'buchung', entityId: id, summary: `Storniert: ${tx.description} (${reason || 'ohne Angabe'})` });
}

/**
 * Entfernt einen Beleg aus dem Verzeichnis und hinterlaesst einen Grabstein,
 * damit er beim Abgleich nicht vom anderen Geraet zurueckkommt.
 */
export async function removeAttachmentRecord(id) {
  return commit('beleg.entfernen', (db) => {
    db.attachments = db.attachments.filter((a) => a.id !== id);
    for (const t of db.transactions) {
      if (t.attachments?.includes(id)) t.attachments = t.attachments.filter((x) => x !== id);
    }
    tomb(db, 'attachments', id);
    return true;
  }, { entity: 'beleg', entityId: id, silent: true });
}

export async function upsertAppointment(appt) {
  const isNew = !sel.appointment(appt.id);
  appt.updatedAt = new Date().toISOString();
  return commit(isNew ? 'termin.anlegen' : 'termin.aendern', (db) => {
    const i = db.appointments.findIndex((a) => a.id === appt.id);
    if (i >= 0) db.appointments[i] = appt;
    else db.appointments.push(appt);
    return appt;
  }, { entity: 'termin', entityId: appt.id, summary: `${appt.date} ${appt.title}` });
}

export async function deleteAppointment(id) {
  return commit('termin.loeschen', (db) => {
    db.appointments = db.appointments.filter((a) => a.id !== id);
    tomb(db, 'appointments', id);
    unlinkTodos(db, [id]);
    return true;
  }, { entity: 'termin', entityId: id });
}

/**
 * Aufgaben eines weggefallenen Termins bleiben bestehen, nur ohne Termin –
 * wer eine Aufgabe notiert hat, will sie nicht mit dem Termin verlieren.
 */
function unlinkTodos(db, appointmentIds) {
  const weg = new Set(appointmentIds);
  const jetzt = new Date().toISOString();
  for (const t of db.todos || []) {
    if (t.appointmentId && weg.has(t.appointmentId)) {
      t.appointmentId = '';
      t.updatedAt = jetzt;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Aufgaben                                                                    */
/* -------------------------------------------------------------------------- */

export function newTodoDraft(preset = {}) {
  return {
    id: uid('todo'),
    title: '',
    // Schlichter Text der Beschreibung; `body` ist dieselbe als formatierter Text
    // (lib/richtext.js), `notes` bleibt für Suche, Export und ältere Fassungen.
    notes: '',
    body: '',
    // Unteraufgaben: { id, title, done }
    subtasks: [],
    // Verknüpfungen mit Buchungen, Kontakten und Rechnungen: { typ, id }
    links: [],
    dueDate: '',
    // Optional: ein Termin, zu dem die Aufgabe gehört (bei Serien die ganze Serie).
    appointmentId: '',
    done: false,
    doneAt: '',
    createdAt: new Date().toISOString(),
    ...preset,
  };
}

function todoSummary(t) {
  return `${t.done ? '✓ ' : ''}${t.title}${t.dueDate ? ` (bis ${t.dueDate})` : ''}`;
}

export async function upsertTodo(todo) {
  const isNew = !sel.todo(todo.id);
  todo.updatedAt = new Date().toISOString();
  todo.createdAt ??= todo.updatedAt;
  return commit(isNew ? 'aufgabe.anlegen' : 'aufgabe.aendern', (db) => {
    const i = db.todos.findIndex((t) => t.id === todo.id);
    if (i >= 0) db.todos[i] = todo;
    else db.todos.push(todo);
    return todo;
  }, { entity: 'aufgabe', entityId: todo.id, summary: todoSummary(todo) });
}

/** Abhaken und wieder öffnen – mit Zeitpunkt, damit „Erledigt“ sortierbar ist. */
export async function setTodoDone(id, done) {
  const t = sel.todo(id);
  if (!t) return null;
  return upsertTodo({ ...t, done: !!done, doneAt: done ? new Date().toISOString() : '' });
}

export async function deleteTodo(id) {
  const t = sel.todo(id);
  return commit('aufgabe.loeschen', (db) => {
    db.todos = db.todos.filter((x) => x.id !== id);
    tomb(db, 'todos', id);
    return true;
  }, { entity: 'aufgabe', entityId: id, summary: t ? todoSummary(t) : '' });
}

/**
 * Übernimmt die Aufgaben aus dem Termindialog in einem Schritt: Dort wird
 * erst mit „Speichern“ geschrieben, wie beim Termin selbst.
 */
export async function applyTodoChanges({ upserts = [], removals = [] }) {
  if (!upserts.length && !removals.length) return null;
  const jetzt = new Date().toISOString();
  return commit('aufgabe.aendern', (db) => {
    for (const t of upserts) {
      t.updatedAt = jetzt;
      t.createdAt ??= jetzt;
      const i = db.todos.findIndex((x) => x.id === t.id);
      if (i >= 0) db.todos[i] = t;
      else db.todos.push(t);
    }
    for (const id of removals) {
      db.todos = db.todos.filter((x) => x.id !== id);
      tomb(db, 'todos', id);
    }
    return { upserts: upserts.length, removals: removals.length };
  }, { entity: 'aufgabe', summary: `Aufgaben am Termin: ${upserts.length} gespeichert, ${removals.length} entfernt` });
}

/**
 * Übernimmt das Ergebnis eines Kalenderabgleichs in einem Schritt: neue und
 * geänderte Termine sowie Termine, die im anderen Kalender gelöscht wurden.
 * Ein einziger Journaleintrag je Abgleich statt einer je Termin – sonst
 * füllte ein erster Abgleich das Journal mit hunderten Zeilen.
 */
/**
 * @param {{upserts?:Array, removals?:string[], summary?:string, ohneGrabstein?:boolean}} p
 *   ohneGrabstein: nur hier aus dem Bestand nehmen, ohne Löschvermerk – etwa
 *   wenn ein weiterer Google-Kalender abgewählt wird. Ein Grabstein hieße beim
 *   nächsten Auswählen „in Kontovia gelöscht“ und löschte die Termine in Google.
 */
export async function applyCalendarChanges({ upserts = [], removals = [], summary = '', ohneGrabstein = false }) {
  if (!upserts.length && !removals.length) return null;
  return commit('termin.kalenderabgleich', (db) => {
    for (const a of upserts) {
      const i = db.appointments.findIndex((x) => x.id === a.id);
      if (i >= 0) db.appointments[i] = a;
      else db.appointments.push(a);
      db.tombstones = (db.tombstones || []).filter((t) => !(t.collection === 'appointments' && t.id === a.id));
    }
    for (const id of removals) {
      db.appointments = db.appointments.filter((a) => a.id !== id);
      if (!ohneGrabstein) tomb(db, 'appointments', id);
    }
    unlinkTodos(db, removals);
    return { upserts: upserts.length, removals: removals.length };
  }, { entity: 'termin', system: true, summary: summary || `Kalenderabgleich: ${upserts.length} übernommen, ${removals.length} entfernt` });
}

/**
 * Legt fällige wiederkehrende Buchungen an (lib/wiederkehrend.js) und schreibt
 * die Regeln fort. Jede Buchung entsteht einzeln mit eigenem Journaleintrag.
 * @param {Array<{regel:object, datum:string, index:number}>} anlegen
 * @param {Array<{regel:object, datum:string, index:number}>} ueberspringen  gesperrte oder abgewählte Vorkommen
 * @returns {Promise<number>} Zahl der neu angelegten Buchungen
 */
export async function wiederkehrendeAnlegen(anlegen = [], ueberspringen = []) {
  let neu = 0;
  for (const e of anlegen) {
    if (sel.transaction(buchungsId(e.regel, e.datum)) || isLockedDate(e.datum)) continue;
    await upsertTransaction(buchungAusRegel(e.regel, e.datum));
    neu++;
  }
  const bis = new Map();
  for (const e of [...anlegen, ...ueberspringen]) bis.set(e.regel.id, Math.max(bis.get(e.regel.id) ?? -1, e.index));
  if (bis.size) {
    const jetzt = new Date().toISOString();
    await commit('wiederkehrend.fortschreiben', (db) => {
      for (const r of db.recurring || []) {
        if (!bis.has(r.id)) continue;
        r.n = Math.max(Number(r.n) || 0, bis.get(r.id) + 1);
        r.updatedAt = jetzt;
      }
    }, { entity: 'wiederkehrend', summary: `${neu} wiederkehrende Buchungen angelegt, ${ueberspringen.length} übersprungen` });
  }
  return neu;
}

export async function upsertEntity(collection, item, label) {
  const isNew = !(store.db[collection] || []).some((x) => x.id === item.id);
  // Ohne Bearbeitungszeitpunkt kann der Abgleich bei beidseitiger Aenderung
  // nicht entscheiden, welche Fassung die juengere ist – dann gewaenne immer
  // stur die lokale.
  item.updatedAt = new Date().toISOString();
  item.createdAt ??= item.updatedAt;
  return commit(isNew ? `${label}.anlegen` : `${label}.aendern`, (db) => {
    const i = db[collection].findIndex((x) => x.id === item.id);
    if (i >= 0) db[collection][i] = item;
    else db[collection].push(item);
    return item;
  }, { entity: label, entityId: item.id, summary: item.name || item.template?.description || '' });
}

export async function deleteEntity(collection, id, label) {
  return commit(`${label}.loeschen`, (db) => {
    db[collection] = db[collection].filter((x) => x.id !== id);
    tomb(db, collection, id);
    return true;
  }, { entity: label, entityId: id });
}

/**
 * Nächste freie Rechnungsnummer im Format JAHR-0001: eins über der höchsten
 * Nummer dieses Jahres. Jedes Jahr beginnt bei 0001 – der Zähler lief bis
 * Fassung 1.7 über den Jahreswechsel weiter („2027-0153“). Aus den Buchungen
 * selbst gerechnet, damit zwei abgeglichene Geräte dieselbe Folge sehen.
 */
export function nextInvoiceNumber(year = new Date().getFullYear(), praefix = '') {
  const p = String(praefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const muster = new RegExp(`^${p}${year}-(\\d{1,6})$`);
  let hoechste = 0;
  // Auch die Nummern der Rechnungen zählen (Bereich Rechnungen), samt Entwürfen
  // mit von Hand vergebener Nummer – sonst bekäme die nächste dieselbe.
  const nummern = [...sel.transactions().map((t) => t.invoiceNumber), ...sel.invoices().filter((r) => r.richtung !== 'eingang').map((r) => r.nummer)];
  for (const n of nummern) {
    const m = muster.exec(String(n || '').trim());
    if (m) hoechste = Math.max(hoechste, Number(m[1]));
  }
  return `${praefix || ''}${year}-${String(hoechste + 1).padStart(4, '0')}`;
}
