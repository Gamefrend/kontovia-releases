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

/* Im Fenster die Bruecke zum Hauptprozess; ausserhalb (Pruefskript) leer,
   damit sich die reinen Funktionen dieser Datei ohne Electron pruefen lassen. */
const api = globalThis.window?.kontovia || {};

/** Kennung dieser Installation – wird beim Start aus dem Hauptprozess gesetzt. */
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

export function setDb(db) {
  const { db: geprueft, repariert } = migrate(db);
  store.db = geprueft;
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
 * @returns {{db:object, repariert:number}} Anzahl der ergaenzten Belegeintraege
 */
export function migrate(db) {
  if (!db || typeof db !== 'object') throw new Error('Leerer Datenbestand.');
  db.schema ??= 1;
  db.settings ??= {};
  for (const key of ['accounts', 'categories', 'contacts', 'transactions', 'attachments', 'appointments', 'assets', 'auditLog', 'locks', 'tombstones']) {
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
  return { db, repariert: repairAttachmentIndex(db) };
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
  // Ohne Brücke zum Hauptprozess gibt es nichts zu schreiben – das ist beim
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
 * @param {{entity?:string, entityId?:string, summary?:string, silent?:boolean}} meta
 */
export async function commit(action, mutator, meta = {}) {
  const db = store.db;
  if (!db) throw new Error('Kein Datenbestand geladen.');
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

async function appendAudit(db, entry) {
  // Jedes Gerät führt seine eigene Kette. Beim Zusammenführen zweier Stände
  // werden die Einträge gemischt – jede Kette bleibt für sich prüfbar.
  const prev = [...db.auditLog].reverse().find((e) => (e.device || 'lokal') === deviceId);
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
  assets: () => store.db?.assets || [],
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
function tomb(db, collection, id) {
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
    // Nicht gelistet: nur zur eigenen Übersicht, nie in Finanzamt-Unterlagen.
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
    { entity: 'buchung', entityId: tx.id, summary: `${tx.type === 'income' ? 'Einnahme' : 'Ausgabe'} ${tx.date} ${(tx.gross / 100).toFixed(2)} € – ${tx.description}${tx.unlisted ? ' (nicht gelistet)' : ''}` },
  );
}

export async function deleteTransaction(id) {
  const tx = sel.transaction(id);
  if (!tx) return;
  return commit('buchung.loeschen', (db) => {
    db.transactions = db.transactions.filter((t) => t.id !== id);
    tomb(db, 'transactions', id);
    // Verknüpfungen aus Terminen entfernen
    for (const a of db.appointments) {
      if (a.transactionIds?.includes(id)) a.transactionIds = a.transactionIds.filter((x) => x !== id);
    }
    return true;
  }, { entity: 'buchung', entityId: id, summary: `Gelöscht: ${tx.date} ${(tx.gross / 100).toFixed(2)} € – ${tx.description}` });
}

/** Storno: die Originalbuchung bleibt erhalten, es entsteht eine Gegenbuchung. */
export async function voidTransaction(id, reason) {
  const tx = sel.transaction(id);
  if (!tx) return;
  const counter = {
    ...structuredClone(tx),
    id: uid('tx'),
    gross: -tx.gross,
    net: -tx.net,
    vat: -tx.vat,
    description: `Storno: ${tx.description}`,
    isReversal: true,
    reversalOf: id,
    date: todayISO(),
    paidDate: tx.paidDate ? todayISO() : '',
    attachments: [],
    createdAt: new Date().toISOString(),
  };
  return commit('buchung.stornieren', (db) => {
    const orig = db.transactions.find((t) => t.id === id);
    orig.voided = true;
    orig.voidedAt = new Date().toISOString();
    orig.voidReason = String(reason || '').slice(0, 300);
    orig.reversedBy = counter.id;
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
    return true;
  }, { entity: 'termin', entityId: id });
}

/**
 * Übernimmt das Ergebnis eines Kalenderabgleichs in einem Schritt: neue und
 * geänderte Termine sowie Termine, die im anderen Kalender gelöscht wurden.
 * Ein einziger Journaleintrag je Abgleich statt einer je Termin – sonst
 * füllte ein erster Abgleich das Journal mit hunderten Zeilen.
 */
export async function applyCalendarChanges({ upserts = [], removals = [], summary = '' }) {
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
      tomb(db, 'appointments', id);
    }
    return { upserts: upserts.length, removals: removals.length };
  }, { entity: 'termin', summary: summary || `Kalenderabgleich: ${upserts.length} übernommen, ${removals.length} entfernt` });
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
  }, { entity: label, entityId: item.id, summary: item.name || '' });
}

export async function deleteEntity(collection, id, label) {
  return commit(`${label}.loeschen`, (db) => {
    db[collection] = db[collection].filter((x) => x.id !== id);
    tomb(db, collection, id);
    return true;
  }, { entity: label, entityId: id });
}

/** Nächste freie Rechnungsnummer im Format JAHR-0001. */
export function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const used = new Set(sel.transactions().map((t) => t.invoiceNumber).filter(Boolean));
  let n = store.db.counters.invoice || 1;
  let candidate;
  do {
    candidate = `${year}-${String(n).padStart(4, '0')}`;
    n++;
  } while (used.has(candidate) && n < 100000);
  return candidate;
}

export async function bumpInvoiceCounter() {
  return commit('nummernkreis', (db) => { db.counters.invoice = (db.counters.invoice || 1) + 1; }, { silent: true });
}
