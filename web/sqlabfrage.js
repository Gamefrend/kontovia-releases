/**
 * Kontovia – Lese-Abfragen an die Datenbank (nur SELECT), abgesichert.
 *
 * Der Assistent (lib/assistentwerkzeuge.js: Werkzeug „abfrage“) und wer sonst
 * eine freie Frage an den Bestand hat, bekommt hier SQL ausgeführt, ohne dass
 * etwas schiefgehen kann:
 *
 *   • Nur eine Anweisung, und nur SELECT oder WITH. Die Anweisung muss laut
 *     SQLite selbst reine Lesung sein (sqlite3_stmt_readonly).
 *   • Ein Authorizer (sqlite3_set_authorizer) lässt beim Übersetzen nur Lesen,
 *     Funktionen und rekursive WITH zu; PRAGMA, ATTACH, Schreiben, Transaktionen
 *     und alles andere lehnt SQLite ab, bevor etwas läuft. Die Tabellen `werte`
 *     (Anmeldemerkmale der Cloud), `meta`, `users` (PIN-Prüfwerte) und
 *     `feedback` sind gesperrt.
 *   • Private Buchungen (`unlisted`) bleiben außen vor, solange der Aufrufer
 *     sie nicht ausdrücklich sehen will: Eine Sicht im Schema `temp`
 *     überdeckt die Tabelle `transactions` (SQLite löst Namen zuerst in `temp`
 *     auf), ebenso die Belege dieser Buchungen; direkte Griffe auf
 *     `main.transactions` lehnt der Authorizer ab.
 *   • Eine Zeitgrenze (sqlite3_progress_handler) bricht lange Abfragen ab,
 *     eine Zeilengrenze kürzt große Ergebnisse, lange Texte werden gestutzt.
 *
 * Läuft im Rechenwerk (sqlwerk.js) und unter Node (sql.js) mit derselben
 * SQLite. Nichts hier verändert die Datenbank; die Sichten verschwinden nach
 * jeder Abfrage wieder.
 */

/** Tabellen, die eine Abfrage nie lesen darf. */
const GESPERRT = new Set(['werte', 'meta', 'users', 'feedback']);

/**
 * Sichten, die private Buchungen und ihre Belege ausblenden. Sie heißen wie die
 * Tabellen, die sie überdecken, und liegen im Schema `temp`.
 */
const OHNE_PRIVATES = {
  transactions: 'SELECT * FROM main."transactions" WHERE coalesce(unlisted, 0) = 0',
  attachments: `SELECT a.* FROM main."attachments" a WHERE NOT EXISTS (
    SELECT 1 FROM main."transactions" t, json_each(t.daten, '$.attachments') j
    WHERE coalesce(t.unlisted, 0) <> 0 AND j.value = a.id)`,
};

export const ABFRAGE_GRENZEN = Object.freeze({ zeichen: 4000, zeilen: 200, zeitMs: 3000, zellenZeichen: 2000 });

const fehler = (text, code = 'ABFRAGE') => Object.assign(new Error(text), { code });

/** Der Text ohne Zeichenketten und Kommentare: darin darf kein Semikolon mehr stehen. */
function ohneTexte(s) {
  return s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function zelle(v, max) {
  if (v instanceof Uint8Array) return `(Datei, ${v.length} Byte)`;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.length > max) return `${v.slice(0, max)}…`;
  return v;
}

/**
 * @param {object} sqlite3  die geladene SQLite
 * @param {object} d        die offene Datenbank (oo1.DB)
 * @param {{sql:string, parameter?:Array|object, privat?:boolean, maxZeilen?:number, zeitMs?:number}} a
 * @returns {{spalten:string[], zeilen:Array<Array>, gekuerzt:boolean, dauerMs:number}}
 */
export function abfrageAusfuehren(sqlite3, d, { sql, parameter = [], privat = false, maxZeilen = ABFRAGE_GRENZEN.zeilen, zeitMs = ABFRAGE_GRENZEN.zeitMs } = {}) {
  const { capi } = sqlite3;
  const text = String(sql || '').trim().replace(/;\s*$/, '');
  if (!text) throw fehler('Die Abfrage ist leer.');
  if (text.length > ABFRAGE_GRENZEN.zeichen) throw fehler(`Die Abfrage ist zu lang (höchstens ${ABFRAGE_GRENZEN.zeichen} Zeichen).`);
  if (!/^(select|with)\b/i.test(text)) throw fehler('Erlaubt ist nur eine Lese-Abfrage, die mit SELECT oder WITH beginnt.');
  if (/;/.test(ohneTexte(text))) throw fehler('Erlaubt ist nur eine einzige Anweisung.');
  const grenze = Math.max(1, Math.min(Number(maxZeilen) || ABFRAGE_GRENZEN.zeilen, 2000));
  const frist = Math.max(100, Math.min(Number(zeitMs) || ABFRAGE_GRENZEN.zeitMs, 20000));

  const sichten = privat ? [] : Object.keys(OHNE_PRIVATES);
  for (const n of sichten) d.exec(`CREATE TEMP VIEW "${n}" AS ${OHNE_PRIVATES[n]}`);
  const sichtNamen = new Set(sichten);

  // Beim Übersetzen fragt SQLite für jeden Griff nach: Nur Lesen geht durch.
  const auth = (pV, code, s0, s1, s2, s3) => {
    if (code === capi.SQLITE_SELECT || code === capi.SQLITE_FUNCTION || code === capi.SQLITE_RECURSIVE) return capi.SQLITE_OK;
    if (code !== capi.SQLITE_READ) return capi.SQLITE_DENY;
    if (GESPERRT.has(String(s0))) return capi.SQLITE_DENY;
    // Eine überdeckte Tabelle darf nur die eigene Sicht lesen (s3 = Name der Sicht), nicht die Abfrage selbst.
    if (s2 === 'main' && sichtNamen.has(String(s0)) && !s3) return capi.SQLITE_DENY;
    return capi.SQLITE_OK;
  };
  const start = Date.now();
  const frist_ = start + frist;
  let st = null;
  try {
    capi.sqlite3_set_authorizer(d.pointer, auth, 0);
    capi.sqlite3_progress_handler(d.pointer, 500, () => (Date.now() > frist_ ? 1 : 0), 0);
    try {
      st = d.prepare(text);
    } catch (e) {
      if (/SQLITE_AUTH|not authorized|prohibited/i.test(String(e?.message))) {
        throw fehler('Die Abfrage darf nur lesen: kein Schreiben, keine Einstellungen der Datenbank, keine gesperrten Tabellen (werte, meta, users, feedback) und kein direkter Griff auf main.transactions.');
      }
      throw fehler(`SQLite versteht die Abfrage nicht: ${String(e?.message || e).replace(/^SQLITE_\w+: sqlite3 result code \d+: /, '')}`);
    }
    if (!capi.sqlite3_stmt_readonly(st.pointer)) throw fehler('Die Abfrage darf nur lesen.');
    if (parameter && (Array.isArray(parameter) ? parameter.length : Object.keys(parameter).length)) st.bind(parameter);
    const spalten = st.getColumnNames();
    const zeilen = [];
    let gekuerzt = false;
    try {
      while (st.step()) {
        if (zeilen.length >= grenze) { gekuerzt = true; break; }
        zeilen.push(st.get([]).map((v) => zelle(v, ABFRAGE_GRENZEN.zellenZeichen)));
      }
    } catch (e) {
      if (/SQLITE_INTERRUPT|interrupted/i.test(String(e?.message))) throw fehler(`Die Abfrage dauerte länger als ${(frist / 1000).toFixed(1).replace('.', ',')} Sekunden und wurde abgebrochen. Bitte enger eingrenzen.`, 'ABFRAGE_ZEIT');
      throw fehler(`Die Abfrage scheiterte: ${String(e?.message || e).replace(/^SQLITE_\w+: sqlite3 result code \d+: /, '')}`);
    }
    return { spalten, zeilen, gekuerzt, dauerMs: Date.now() - start };
  } finally {
    try { st?.finalize(); } catch { /* schon zu */ }
    capi.sqlite3_progress_handler(d.pointer, 0, 0, 0);
    capi.sqlite3_set_authorizer(d.pointer, 0, 0);
    for (const n of sichten) { try { d.exec(`DROP VIEW IF EXISTS temp."${n}"`); } catch { /* nie halb */ } }
  }
}
