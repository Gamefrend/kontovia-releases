/**
 * Kontovia – der Bestand in SQLite: Schema und verlustfreie Zerlegung.
 *
 * Jede Sammlung (transactions, invoices, …) ist eine Tabelle. Jeder Datensatz
 * liegt darin unverändert als JSON-Text (Spalte `daten`), an seiner Stelle in
 * der Liste (Spalte `ord`). Abgeleitete Spalten (Datum, Betrag, Kategorie …)
 * rechnet SQLite aus `daten`; sie dienen nur Abfragen und Indizes. So geht
 * nichts verloren: fehlende Felder, false, null und '' bleiben, wie sie waren,
 * unbekannte Felder und Sammlungen einer künftigen Fassung ebenso. Alles, was
 * keine Sammlung ist (settings, counters, cloud …), steht in `werte`.
 *
 * Die „Zeilenform“ ist der Zwischenschritt zwischen dem Bestand im Speicher
 * (ein Objekt) und den Tabellen:
 *   { reihenfolge: [[schlüssel, 't'|'w'], …]   oberste Schlüssel, in ihrer Reihenfolge
 *     werte:    {schlüssel: JSON-Text}          alles, was keine Tabelle ist
 *     tabellen: {sammlung: [JSON-Text, …]} }    je Datensatz ein Text, in Reihenfolge
 *
 * Gewähr (Prüfung `umstellung`): JSON.stringify(zusammensetzen(zerlegen(db)))
 * ist Zeichen für Zeichen JSON.stringify(db). Jeder Text ist genau der, den
 * JSON.stringify für diesen Teil des Bestands erzeugt. Das Journal (auditLog)
 * braucht das: Seine Prüfsummen hängen an der Reihenfolge der Schlüssel.
 *
 * Wer eine Sammlung, ein Feld oder das Schema ändert: docs/sql-umstellung.md
 * nachziehen und `node scripts/check.js umstellung` laufen lassen.
 *
 * Ohne Abhängigkeiten: läuft im Rechenwerk der Datenbank (sqlwerk.js), in der
 * Web-Schicht und in den Prüfungen unter Node.
 */

/** Fassung des Schemas (PRAGMA user_version und meta.schema). Verlauf in docs/sql-umstellung.md. */
export const SCHEMA_FASSUNG = 1;

/** Das Journal: Einträge werden nur angefügt, nie geändert oder gelöscht (sqlkern.js). */
export const JOURNAL = 'auditLog';

/** So viele Journaleinträge (die neuesten) bekommt die Oberfläche; alle übrigen bleiben im Archiv der Datenbank. */
export const JOURNAL_FENSTER = 50000;

const T = 'TEXT';
const I = 'INTEGER';
const N = 'NUMERIC';

/**
 * Sammlungen mit eigener Tabelle. `spalten`: abgeleitete Spalte → [Typ, JSON-Pfad];
 * `indizes`: Spaltenlisten. Geld ist INTEGER (Cent), nie REAL.
 */
export const TABELLEN = Object.freeze({
  transactions: {
    spalten: {
      type: [T, '$.type'], date: [T, '$.date'], paidDate: [T, '$.paidDate'], dueDate: [T, '$.dueDate'],
      gross: [I, '$.gross'], net: [I, '$.net'], vat: [I, '$.vat'], vatRate: [N, '$.vatRate'],
      categoryId: [T, '$.categoryId'], accountId: [T, '$.accountId'], contactId: [T, '$.contactId'],
      invoiceNumber: [T, '$.invoiceNumber'], recurringId: [T, '$.recurringId'], importHash: [T, '$.importHash'],
      voided: [I, '$.voided'], unlisted: [I, '$.unlisted'], isReversal: [I, '$.isReversal'], updatedAt: [T, '$.updatedAt'],
    },
    indizes: [['date'], ['paidDate'], ['categoryId'], ['contactId'], ['importHash']],
  },
  invoices: {
    spalten: {
      richtung: [T, '$.richtung'], status: [T, '$.status'], nummer: [T, '$.nummer'], datum: [T, '$.datum'],
      faellig: [T, '$.faellig'], kontaktId: [T, '$.kaeufer.contactId'], updatedAt: [T, '$.updatedAt'],
    },
    indizes: [['datum'], ['nummer']],
  },
  reminders: { spalten: { invoiceId: [T, '$.invoiceId'], stufe: [I, '$.stufe'], datum: [T, '$.datum'] }, indizes: [['invoiceId']] },
  recurring: { spalten: { type: [T, '$.template.type'], updatedAt: [T, '$.updatedAt'] }, indizes: [] },
  assets: { spalten: { name: [T, '$.name'], updatedAt: [T, '$.updatedAt'] }, indizes: [] },
  attachments: { spalten: { fileName: [T, '$.fileName'], mime: [T, '$.mime'], size: [I, '$.size'], sha256: [T, '$.sha256'] }, indizes: [] },
  imports: { spalten: { datei: [T, '$.datei'], updatedAt: [T, '$.updatedAt'] }, indizes: [] },
  bankRules: { spalten: {}, indizes: [] },
  bankTemplates: { spalten: {}, indizes: [] },
  elsterMeldungen: { spalten: { art: [T, '$.art'], jahr: [I, '$.jahr'], zeitraum: [T, '$.zeitraum'] }, indizes: [] },
  accounts: { spalten: { name: [T, '$.name'] }, indizes: [] },
  categories: { spalten: { name: [T, '$.name'], kind: [T, '$.kind'] }, indizes: [] },
  contacts: { spalten: { name: [T, '$.name'], updatedAt: [T, '$.updatedAt'] }, indizes: [['name']] },
  products: { spalten: { name: [T, '$.name'] }, indizes: [] },
  invoiceTemplates: { spalten: {}, indizes: [] },
  appointments: { spalten: { title: [T, '$.title'], start: [T, '$.start'], updatedAt: [T, '$.updatedAt'] }, indizes: [['start']] },
  todos: { spalten: { title: [T, '$.title'], done: [I, '$.done'], due: [T, '$.due'], updatedAt: [T, '$.updatedAt'] }, indizes: [] },
  locks: { spalten: { until: [T, '$.until'] }, indizes: [] },
  users: { spalten: { name: [T, '$.name'] }, indizes: [] },
  feedback: { spalten: {}, indizes: [] },
  [JOURNAL]: {
    spalten: {
      device: [T, '$.device'], seq: [I, '$.seq'], ts: [T, '$.ts'], action: [T, '$.action'],
      entity: [T, '$.entity'], entityId: [T, '$.entityId'], hash: [T, '$.hash'],
    },
    indizes: [['schluessel'], ['ts', 'device', 'seq']],
  },
  tombstones: { spalten: { collection: [T, '$.collection'], deletedAt: [T, '$.deletedAt'] }, indizes: [] },
});

/** Tabellennamen müssen schlichte Bezeichner sein (sie kommen auch aus fremden Abbildern). */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Kennung eines Journaleintrags: dieselbe wie beim Zusammenführen (merge.js: mergeAuditLogs). */
export function journalSchluessel(e) {
  return String(e?.hash || (e?.device + '#' + e?.seq));
}

/**
 * Die Anweisungen, die das Schema anlegen (wiederholbar). `schema`: 'main' oder ein angehängter Name.
 * Ein Abbild (Cloud, Sicherungen) braucht keine Indizes: Beim Einlesen entstehen sie neu, und ohne sie ist es viel kleiner.
 */
export function ddl(schema = 'main', { indizes = true } = {}) {
  if (!NAME_RE.test(schema)) throw new Error('Ungültiger Name eines Schemas.');
  const s = `"${schema}".`;
  const out = [
    `CREATE TABLE IF NOT EXISTS ${s}meta (schluessel TEXT PRIMARY KEY, wert TEXT)`,
    `CREATE TABLE IF NOT EXISTS ${s}werte (schluessel TEXT PRIMARY KEY, daten TEXT NOT NULL CHECK (json_valid(daten)))`,
  ];
  for (const name of Object.keys(TABELLEN)) out.push(...tabelleDdl(name, schema, { indizes }));
  return out;
}

/**
 * Eine Tabelle samt Indizes. Sammlungen, die diese Fassung nicht kennt (aus dem
 * Abbild einer künftigen Fassung), bekommen dieselbe Grundform ohne abgeleitete Spalten.
 */
export function tabelleDdl(name, schema = 'main', { indizes = true } = {}) {
  if (!NAME_RE.test(name) || !NAME_RE.test(schema)) throw new Error('Ungültiger Name einer Tabelle.');
  const s = `"${schema}".`;
  const t = TABELLEN[name] || { spalten: {}, indizes: [] };
  const spalten = [
    'ord INTEGER PRIMARY KEY',
    'daten TEXT NOT NULL CHECK (json_valid(daten))',
    "id GENERATED ALWAYS AS (json_extract(daten, '$.id')) VIRTUAL",
  ];
  if (name === JOURNAL) spalten.push('schluessel TEXT');
  for (const [sp, [typ, pfad]] of Object.entries(t.spalten)) {
    spalten.push(`"${sp}" ${typ} GENERATED ALWAYS AS (json_extract(daten, '${pfad}')) VIRTUAL`);
  }
  const out = [`CREATE TABLE IF NOT EXISTS ${s}"${name}" (${spalten.join(', ')})`];
  if (!indizes) return out;
  out.push(`CREATE INDEX IF NOT EXISTS ${s}"${name}_id" ON "${name}" (id)`);
  for (const ix of t.indizes) {
    out.push(`CREATE INDEX IF NOT EXISTS ${s}"${name}_${ix.join('_')}" ON "${name}" (${ix.map((c) => `"${c}"`).join(', ')})`);
  }
  return out;
}

/** Text eines Teils, wie JSON.stringify ihn im Ganzen schriebe (in Listen wird undefined zu null). */
const text = (wert) => JSON.stringify(wert) ?? 'null';

/**
 * Bestand → Zeilenform. Sammlungen mit Tabelle werden zu Zeilen, alles andere
 * (auch Sammlungen, die diese Fassung nicht kennt) bleibt als Ganzes ein Wert.
 * Was JSON.stringify auslässt (undefined, Funktionen), fehlt auch hier.
 */
export function zerlegen(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('Leerer oder ungültiger Bestand.');
  // Was JSON.stringify über toJSON ersetzt, ersetzt es hier genauso.
  const quelle = typeof db.toJSON === 'function' ? db.toJSON('') : db;
  const reihenfolge = [];
  // Ohne Prototyp: auch ein Schlüssel „__proto__“ bleibt ein gewöhnlicher Eintrag.
  const werte = Object.create(null);
  const tabellen = Object.create(null);
  for (const k of Object.keys(quelle)) {
    let v = quelle[k];
    if (v && typeof v.toJSON === 'function') v = v.toJSON(k);
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    if (Object.hasOwn(TABELLEN, k) && Array.isArray(v)) {
      const zeilen = new Array(v.length);
      for (let i = 0; i < v.length; i++) zeilen[i] = text(v[i]);
      tabellen[k] = zeilen;
      reihenfolge.push([k, 't']);
    } else {
      werte[k] = JSON.stringify(v);
      reihenfolge.push([k, 'w']);
    }
  }
  return { reihenfolge, werte, tabellen };
}

/** Zeilenform → Bestand. Auch `__proto__` als Schlüssel bleibt ein gewöhnliches Feld. */
export function zusammensetzen(zf) {
  const db = {};
  for (const [k, art] of zf.reihenfolge) {
    let v;
    if (art === 't') {
      const zeilen = zf.tabellen[k] || [];
      v = new Array(zeilen.length);
      for (let i = 0; i < zeilen.length; i++) v[i] = JSON.parse(zeilen[i]);
    } else {
      v = JSON.parse(zf.werte[k]);
    }
    Object.defineProperty(db, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return db;
}

/**
 * Was sich zwischen zwei Zeilenformen geändert hat, als Aufträge für sqlkern.js: anwenden.
 * Sammlungen werden Zeile für Zeile verglichen (Stelle = ord). Das Journal wird nur
 * ergänzt: Einträge, die im alten Stand fehlen, kommen hinzu; was im neuen fehlt,
 * bleibt in der Datenbank (Archiv).
 */
export function unterschiede(alt, neu) {
  const ops = { reihenfolge: null, werte: [], tabellen: {}, journal: [] };
  if (JSON.stringify(alt.reihenfolge) !== JSON.stringify(neu.reihenfolge)) ops.reihenfolge = neu.reihenfolge;
  for (const k of Object.keys(neu.werte)) if (alt.werte[k] !== neu.werte[k]) ops.werte.push([k, neu.werte[k]]);
  for (const k of Object.keys(alt.werte)) if (!Object.hasOwn(neu.werte, k)) ops.werte.push([k, null]);
  for (const [name, zeilen] of Object.entries(neu.tabellen)) {
    if (name === JOURNAL) {
      const bekannt = new Set(alt.tabellen[JOURNAL] || []);
      for (const z of zeilen) if (!bekannt.has(z)) ops.journal.push(z);
      continue;
    }
    const vorher = alt.tabellen[name] || [];
    const setzen = [];
    for (let i = 0; i < zeilen.length; i++) if (zeilen[i] !== vorher[i]) setzen.push([i, zeilen[i]]);
    if (setzen.length || vorher.length !== zeilen.length) ops.tabellen[name] = { setzen, laenge: zeilen.length };
  }
  for (const name of Object.keys(alt.tabellen)) {
    if (name !== JOURNAL && !Object.hasOwn(neu.tabellen, name)) ops.tabellen[name] = { setzen: [], laenge: 0 };
  }
  return ops;
}

/** Hat ein Auftrag aus unterschiede() überhaupt etwas zu tun? */
export function leer(ops) {
  return !ops.reihenfolge && !ops.werte.length && !ops.journal.length && !Object.keys(ops.tabellen).length;
}

/**
 * Vergleicht zwei Zeilenformen genau. Rückgabe: null, wenn gleich, sonst eine
 * kurze Beschreibung der ersten Abweichung (für Fehlermeldungen und Prüfungen).
 */
export function abweichung(a, b) {
  if (JSON.stringify(a.reihenfolge) !== JSON.stringify(b.reihenfolge)) return 'Reihenfolge der Bereiche';
  const wa = Object.keys(a.werte).sort();
  const wb = Object.keys(b.werte).sort();
  if (JSON.stringify(wa) !== JSON.stringify(wb)) return 'Bereiche ohne Tabelle';
  for (const k of wa) if (a.werte[k] !== b.werte[k]) return `Wert ${k}`;
  const ta = Object.keys(a.tabellen).sort();
  const tb = Object.keys(b.tabellen).sort();
  if (JSON.stringify(ta) !== JSON.stringify(tb)) return 'Tabellen';
  for (const k of ta) {
    const x = a.tabellen[k];
    const y = b.tabellen[k];
    if (x.length !== y.length) return `${k}: ${x.length} statt ${y.length} Zeilen`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}: Zeile ${i}`;
  }
  return null;
}

/** Anzahl der Zeilen je Tabelle und der Werte (für Prüfungen und Meldungen). */
export function umfang(zf) {
  const out = { werte: Object.keys(zf.werte).length };
  for (const [k, z] of Object.entries(zf.tabellen)) out[k] = z.length;
  return out;
}
