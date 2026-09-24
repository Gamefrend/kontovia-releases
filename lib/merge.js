/**
 * Kontovia – Zusammenführen zweier Datenstände.
 *
 * Wenn dasselbe Konto auf zwei Rechnern benutzt wird, entstehen zwangsläufig
 * abweichende Stände. Ein einfaches „der neuere gewinnt“ auf Dateiebene würde
 * dabei ganze Arbeitstage verschlucken. Deshalb wird nicht die Datei, sondern
 * jeder einzelne Datensatz verglichen – und zwar gegen den letzten Stand, den
 * beide Seiten gemeinsam hatten (die „Basis“).
 *
 * Daraus ergeben sich vier Fälle je Datensatz:
 *
 *   nur lokal geändert      -> lokale Fassung
 *   nur in der Cloud        -> Cloud-Fassung
 *   auf beiden Seiten       -> die zuletzt bearbeitete gewinnt, die andere
 *                              wird als Konflikt festgehalten und bleibt
 *                              einsehbar
 *   auf einer Seite gelöscht-> gelöscht wird nur, wenn die andere Seite den
 *                              Datensatz seit der Basis nicht angefasst hat.
 *                              Eine Buchung geht niemals stillschweigend
 *                              verloren, nur weil ein anderes Gerät sie
 *                              gelöscht hat.
 *
 * Belege sind unveränderlich (Inhalt steht fest, sobald die Datei liegt) und
 * werden deshalb nur vereinigt, nie verglichen.
 */

/** Sammlungen, die datensatzweise zusammengeführt werden. */
export const SYNCED_COLLECTIONS = [
  'transactions', 'appointments', 'contacts', 'categories',
  'accounts', 'assets', 'attachments', 'locks',
];

/* -------------------------------------------------------------------------- */
/* Hilfsmittel                                                                 */
/* -------------------------------------------------------------------------- */

/** Stabile Textfassung eines Objekts – Schlüsselreihenfolge spielt keine Rolle. */
export function stableString(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(stableString).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableString(value[k])).join(',') + '}';
}

function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return stableString(a) === stableString(b);
}

/** Zeitpunkt der letzten Bearbeitung, mit Rückfallebenen. */
function touchedAt(item) {
  return String(item?.updatedAt || item?.createdAt || item?.ts || '');
}

function byId(list) {
  const m = new Map();
  for (const item of list || []) if (item && item.id) m.set(item.id, item);
  return m;
}

/** Grabsteine: {collection, id, deletedAt}. */
function tombstoneSet(db) {
  const m = new Map();
  for (const t of db?.tombstones || []) m.set(t.collection + '/' + t.id, t);
  return m;
}

function label(collection) {
  return {
    transactions: 'Buchung', appointments: 'Termin', contacts: 'Kontakt',
    categories: 'Kategorie', accounts: 'Konto', assets: 'Anlagegut',
    attachments: 'Beleg', locks: 'Festschreibung',
  }[collection] || collection;
}

function describe(collection, item) {
  if (!item) return '';
  if (collection === 'transactions') {
    return `${item.date || ''} ${((item.gross || 0) / 100).toFixed(2)} € – ${item.description || ''}`.trim();
  }
  return item.title || item.name || item.fileName || item.id;
}

/* -------------------------------------------------------------------------- */
/* Zusammenführen                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @param {object|null} base    Stand beim letzten erfolgreichen Abgleich
 * @param {object} local        aktueller Stand auf diesem Gerät
 * @param {object} remote       Stand aus der Cloud
 * @returns {{merged:object, conflicts:Array, stats:object}}
 */
export function mergeDb(base, local, remote) {
  const b = base || { tombstones: [] };
  const conflicts = [];
  const stats = { fromLocal: 0, fromRemote: 0, deleted: 0, conflicts: 0, unchanged: 0 };

  const merged = {
    ...structuredClone(local),
    schema: Math.max(local.schema || 1, remote.schema || 1),
  };

  const tsBase = tombstoneSet(b);
  const tsLocal = tombstoneSet(local);
  const tsRemote = tombstoneSet(remote);

  /* --- Grabsteine vereinigen, jeweils der frühere Zeitpunkt zählt --- */
  const tsAll = new Map();
  for (const src of [tsBase, tsLocal, tsRemote]) {
    for (const [key, t] of src) {
      const prev = tsAll.get(key);
      if (!prev || String(t.deletedAt) < String(prev.deletedAt)) tsAll.set(key, t);
    }
  }

  /* --- Sammlungen --- */
  for (const collection of SYNCED_COLLECTIONS) {
    const B = byId(b[collection]);
    const L = byId(local[collection]);
    const R = byId(remote[collection]);
    const out = [];
    const ids = new Set([...L.keys(), ...R.keys(), ...B.keys()]);

    for (const id of ids) {
      const key = collection + '/' + id;
      const bi = B.get(id);
      const li = L.get(id);
      const ri = R.get(id);

      // Belege sind unveränderlich: einmal da, bleibt die Fassung, die es gibt.
      if (collection === 'attachments') {
        const keep = li || ri;
        if (keep && !(tsLocal.has(key) || tsRemote.has(key))) out.push(keep);
        else if (keep) stats.deleted++;
        continue;
      }

      const lGone = !li && (tsLocal.has(key) || (bi && !li));
      const rGone = !ri && (tsRemote.has(key) || (bi && !ri));

      /* Auf beiden Seiten vorhanden */
      if (li && ri) {
        if (same(li, ri)) { out.push(li); stats.unchanged++; continue; }
        const lChanged = !bi || !same(li, bi);
        const rChanged = !bi || !same(ri, bi);

        if (lChanged && !rChanged) { out.push(li); stats.fromLocal++; continue; }
        if (!lChanged && rChanged) { out.push(ri); stats.fromRemote++; continue; }

        // Beide Seiten haben denselben Datensatz verändert.
        const winner = touchedAt(li) >= touchedAt(ri) ? li : ri;
        const loser = winner === li ? ri : li;
        out.push(winner);
        stats.conflicts++;
        conflicts.push({
          id, collection, kind: 'beide-geaendert',
          label: label(collection),
          text: describe(collection, winner),
          kept: winner === li ? 'lokal' : 'cloud',
          keptAt: touchedAt(winner),
          discardedAt: touchedAt(loser),
          discarded: loser,
        });
        continue;
      }

      /* Nur lokal vorhanden */
      if (li && !ri) {
        if (!bi) { out.push(li); stats.fromLocal++; continue; } // hier neu angelegt
        if (same(li, bi)) { stats.deleted++; continue; }        // dort gelöscht, hier unverändert
        out.push(li);
        stats.conflicts++;
        conflicts.push({
          id, collection, kind: 'geloescht-aber-geaendert',
          label: label(collection),
          text: describe(collection, li),
          kept: 'lokal',
          note: 'Auf dem anderen Gerät gelöscht, hier aber geändert – der Datensatz bleibt erhalten.',
        });
        continue;
      }

      /* Nur in der Cloud vorhanden */
      if (!li && ri) {
        if (!bi) {
          if (tsLocal.has(key)) { stats.deleted++; continue; }   // hier gelöscht, dort noch da
          out.push(ri); stats.fromRemote++; continue;
        }
        if (same(ri, bi)) { stats.deleted++; continue; }
        out.push(ri);
        stats.conflicts++;
        conflicts.push({
          id, collection, kind: 'geloescht-aber-geaendert',
          label: label(collection),
          text: describe(collection, ri),
          kept: 'cloud',
          note: 'Hier gelöscht, auf dem anderen Gerät aber geändert – der Datensatz kommt zurück.',
        });
        continue;
      }

      /* Auf keiner Seite mehr vorhanden */
      if (bi) stats.deleted++;
    }

    // Ein wiederhergestellter Datensatz darf nicht durch einen alten Grabstein
    // gleich wieder verschwinden.
    for (const item of out) tsAll.delete(collection + '/' + item.id);
    merged[collection] = out;
  }

  merged.tombstones = [...tsAll.values()];

  /* --- Einstellungen: als Block, nach Bearbeitungszeitpunkt --- */
  const ls = local.settings || {};
  const rs = remote.settings || {};
  const bs = b.settings || {};
  const lSet = !same(ls, bs);
  const rSet = !same(rs, bs);
  if (rSet && !lSet) merged.settings = structuredClone(rs);
  else if (lSet && rSet && !same(ls, rs)) {
    const takeRemote = String(rs.updatedAt || '') > String(ls.updatedAt || '');
    merged.settings = structuredClone(takeRemote ? rs : ls);
    stats.conflicts++;
    conflicts.push({
      id: 'settings', collection: 'settings', kind: 'beide-geaendert',
      label: 'Einstellungen', text: 'Firmendaten oder steuerliche Einstellungen',
      kept: takeRemote ? 'cloud' : 'lokal',
      discarded: takeRemote ? ls : rs,
    });
  }

  /* --- Zählwerke: der höhere Stand gilt, damit keine Nummer doppelt vergeben wird --- */
  merged.counters = { ...(remote.counters || {}), ...(local.counters || {}) };
  for (const k of Object.keys(merged.counters)) {
    merged.counters[k] = Math.max(Number(local.counters?.[k] || 0), Number(remote.counters?.[k] || 0));
  }

  /* --- EÜR-Zeilentexte: geänderte Seite gewinnt --- */
  if (!same(remote.euerLines, b.euerLines) && same(local.euerLines, b.euerLines)) {
    merged.euerLines = structuredClone(remote.euerLines);
  }

  /* --- Änderungsjournal: Vereinigung, je Gerät eine eigene Kette --- */
  merged.auditLog = mergeAuditLogs(local.auditLog, remote.auditLog);

  return { merged, conflicts, stats };
}

/**
 * Die Einträge beider Seiten werden vereinigt, doppelte über die Prüfsumme
 * erkannt. Jedes Gerät führt seine eigene Kette – dadurch bleibt jede Kette
 * für sich prüfbar, obwohl die Einträge gemischt vorliegen.
 */
export function mergeAuditLogs(a = [], c = []) {
  const seen = new Set();
  const out = [];
  for (const e of [...(a || []), ...(c || [])]) {
    const key = e.hash || (e.device + '#' + e.seq);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((x, y) => String(x.ts).localeCompare(String(y.ts)) || String(x.device).localeCompare(String(y.device)) || (x.seq - y.seq));
  return out.length > 50000 ? out.slice(out.length - 50000) : out;
}

/* -------------------------------------------------------------------------- */
/* Zusammenfassung für die Oberfläche                                          */
/* -------------------------------------------------------------------------- */

export function summarizeMerge(stats, conflicts) {
  const parts = [];
  if (stats.fromRemote) parts.push(`${stats.fromRemote} aus der Cloud übernommen`);
  if (stats.fromLocal) parts.push(`${stats.fromLocal} lokale Änderungen behalten`);
  if (stats.deleted) parts.push(`${stats.deleted} gelöscht`);
  if (conflicts.length) parts.push(`${conflicts.length} Konflikt${conflicts.length > 1 ? 'e' : ''}`);
  return parts.length ? parts.join(', ') : 'nichts zu tun';
}
