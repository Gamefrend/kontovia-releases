/**
 * Kontovia – Archiv und Aufbewahrung: die Handlungen.
 *
 *   jahresarchivDateien()   stellt das Jahresarchiv zusammen (Dateiliste)
 *   jahresarchivErstellen() packt es als ZIP, bietet es zum Speichern an und
 *                           vermerkt Prüfsumme und Umfang im Bestand (`archive`)
 *   archivPruefen()         vergleicht eine gewählte Datei mit dem Vermerk
 *   jahrLoeschen()          der Löschlauf: entfernt ein Jahr (oder nur dessen
 *                           Belegdateien) mit Grabsteinen und Journaleintrag
 *   fristenSetzen()         die Aufbewahrungsfristen in den Einstellungen
 *   auskunftDateien()       die Datenauskunft zu einer Person als Dateien
 *
 * Das Jahresarchiv ist ein gewöhnliches ZIP, das jedes Betriebssystem öffnet,
 * ohne Kontovia und ohne Passwort: Es soll in zehn Jahren noch lesbar sein.
 * Darum gehört es an einen geschützten Ort (verschlüsselter Datenträger,
 * Tresorordner der Kanzlei). Inhalt:
 *   LIESMICH.txt            was das ist, wie man es prüft, Verfahrensdokumentation kurz
 *   MANIFEST.sha256         Prüfsumme jeder Datei
 *   bestand.json            jeder Datensatz des Jahres unverändert, samt Stammdaten
 *   buchungen.csv           alle Buchungen des Jahres (auch private, deutlich markiert)
 *   journal.jsonl           die Journaleinträge des Jahres mit Prüfsummen und Kette
 *   finanzamt/              Anlage EÜR, Umsatzsteuer, offene Posten, Anlagen (ohne Privates)
 *   gobd/                   Datenträgerüberlassung Z3 des Jahres (ohne Privates)
 *   berichte/               die Berichte des Jahres als PDF
 *   belege/, rechnungen/    die Belegdateien und Rechnungs-PDFs
 *
 * Der Löschlauf greift absichtlich an der Festschreibung vorbei (der Zeitraum
 * ist nach Ablauf der Frist nicht mehr zu bewahren) und ist darum nur für den
 * Inhaber (rollen.js: archiv.*). Jede Löschung hinterlässt Grabsteine für den
 * Abgleich und einen Journaleintrag mit Umfang und Archiv-Prüfsumme; das
 * Journal selbst wird nie gelöscht.
 */

import { uid, todayISO, fmtDate, money } from './util.js';
import { store, commit, tomb, saveNow } from './store.js';
import { isKleinunternehmer, listedOnly } from './calc.js';
import * as X from './exports.js';
import { jahresinhalt, loeschplan, loeschplanText, archivVon, fristen, FRIST_GRENZEN, GESETZ, auskunft } from './archiv.js';

const api = globalThis.window?.kontovia || {};

const te = new TextEncoder();

function base64ZuBytes(b64) {
  const s = atob(String(b64 || ''));
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function bytesZuBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sha256(u8) {
  const buf = await crypto.subtle.digest('SHA-256', u8);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Wie dateien.js: keine Pfade, keine Steuerzeichen; hier zusätzlich kurz. */
const sicher = (s) => String(s || 'datei').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'datei';

/** Der Bestand mit dem ganzen Journal (auch dem Archiv in der Datenbank), gespeichert. */
export async function bestandMitJournal() {
  if (store.dirty) await saveNow();
  const journal = api.vault?.journal ? await api.vault.journal() : store.db.auditLog;
  return { ...store.db, auditLog: journal };
}

/* -------------------------------------------------------------------------- */
/* Jahresarchiv                                                                */
/* -------------------------------------------------------------------------- */

function liesmich(db, inhalt, { version, erstelltAm, fristen: f }) {
  const s = db.settings || {};
  const j = inhalt.jahr;
  return `KONTOVIA: JAHRESARCHIV ${j}
=============================

Betrieb:       ${s.companyName || s.ownerName || '(ohne Angabe)'}
Steuernummer:  ${s.taxNumber || '(ohne Angabe)'}
Erstellt am:   ${erstelltAm.slice(0, 10)} mit Kontovia ${version || ''}
Zeitraum:      ${inhalt.von} bis ${inhalt.bis}
Umfang:        ${inhalt.transactions.length} Buchungen, ${inhalt.invoices.length} Rechnungen, ${inhalt.reminders.length} Mahnungen,
               ${inhalt.attachments.length} Belegdateien, ${inhalt.journal.length} Journaleinträge

WAS DAS IST
Dieses Archiv enthält alles, was Kontovia zum Jahr ${j} gespeichert hat, so wie
es zum Zeitpunkt der Erstellung war. Es dient der Aufbewahrung nach § 147 AO
(Buchungen und Aufzeichnungen ${f.buchhaltung} Jahre, Belege ${f.belege} Jahre, Frist ab Ende
des Jahres ${j}: Buchungen bis ${j + f.buchhaltung}-12-31, Belege bis ${j + f.belege}-12-31)
und ersetzt den Bestand im Programm, wenn das Jahr dort nach Ablauf der Frist
gelöscht wird. Ein ZIP, kein eigenes Format: Jedes Betriebssystem öffnet es.

Das Archiv ist nicht verschlüsselt. Bewahren Sie es an einem geschützten Ort
auf (verschlüsselter Datenträger, Ablage der Steuerkanzlei).

INHALT
  LIESMICH.txt        diese Datei
  MANIFEST.sha256     Prüfsumme (SHA-256) jeder Datei in diesem Archiv
  bestand.json        jeder Datensatz des Jahres unverändert, dazu die
                      verwendeten Kontakte, Kategorien und Zahlungskonten
  buchungen.csv       alle Buchungen des Jahres als Tabelle, auch private
                      (Spalte Beschreibung beginnt dann mit „PRIVAT:“)
  journal.jsonl       die Einträge des Änderungsjournals aus dem Jahr, eine
                      Zeile je Eintrag, mit Prüfsumme und Vorgänger (Kette)
  finanzamt/          Anlage EÜR, Umsatzsteuer, offene Posten, Anlagen
  gobd/               Datenträgerüberlassung nach GoBD (Format Z3)
  berichte/           die Berichte des Jahres als PDF
  belege/             die Belegdateien, benannt nach Datum, Buchung und Name
  rechnungen/         die Rechnungen und Mahnungen als PDF (und XML)
Unterlagen für das Finanzamt enthalten keine privaten Buchungen; bestand.json
und buchungen.csv enthalten alles.

PRÜFEN
Die Prüfsumme der ZIP-Datei steht in Kontovia im Archivvermerk des Jahres
(Import & Export › Archiv). Dort lässt sich die Datei jederzeit gegenprüfen.
Innerhalb des Archivs prüft MANIFEST.sha256 jede Datei, etwa mit
  sha256sum -c MANIFEST.sha256
Die Kette des Journals: Jeder Eintrag trägt die Prüfsumme (SHA-256) seiner
Felder (ohne „hash“) und in „prev“ die Prüfsumme des Vorgängers desselben
Geräts.

VERFAHREN (kurz)
Kontovia ist eine Buchhaltung, die vollständig auf dem Gerät läuft. Jede
Änderung geht durch ein verkettetes Journal; festgeschriebene Zeiträume
lassen sich nur stornieren. Dieses Archiv entstand aus dem Bestand des
Programms ohne Veränderung der Daten. Beträge in bestand.json sind Cent.
`;
}

function manifest(eintraege) {
  return `${eintraege.map(([hash, name]) => `${hash}  ${name}`).join('\n')}\n`;
}

/** Die Buchungen des Jahres als Tabelle, private mit deutlichem Hinweis. */
function buchungenCsv(db, transactions) {
  const rows = transactions.map((t) => (t.unlisted ? { ...t, description: `PRIVAT: ${t.description || ''}` } : t));
  return X.transactionsCsv(db, rows);
}

/**
 * Die Dateien des Jahresarchivs: [{name, text}] oder [{name, dataBase64}].
 * @param {object} db  der Bestand mit dem ganzen Journal (bestandMitJournal)
 * @param {number} jahr
 * @param {{version?:string, melden?:(text:string)=>void, belegLesen?:(id:string)=>Promise<string>, berichte?:boolean}} [opts]
 *   belegLesen liefert Base64 (Vorgabe: api.attach.read); berichte: PDFs beilegen (braucht die Oberfläche)
 */
export async function jahresarchivDateien(db, jahr, { version = '', melden = () => {}, belegLesen = null, berichte = true } = {}) {
  const inhalt = jahresinhalt(db, jahr);
  const erstelltAm = new Date().toISOString();
  const period = { from: inhalt.von, to: inhalt.bis };
  const f = fristen(db.settings || {});
  const offen = listedOnly(db);
  const files = [];
  melden('Stellt Buchungen und Journal zusammen …');
  files.push({ name: 'bestand.json', text: JSON.stringify({
    kind: 'kontovia-jahresarchiv', version: 1, jahr: inhalt.jahr, von: inhalt.von, bis: inhalt.bis, erstelltAm, app: version,
    betrieb: { name: db.settings?.companyName || '', inhaber: db.settings?.ownerName || '', steuernummer: db.settings?.taxNumber || '', ustId: db.settings?.vatId || '' },
    hinweis: 'Beträge in Cent. Jeder Datensatz so, wie Kontovia ihn gespeichert hat.',
    transactions: inhalt.transactions, invoices: inhalt.invoices, reminders: inhalt.reminders, attachments: inhalt.attachments,
    imports: inhalt.imports, elsterMeldungen: inhalt.elsterMeldungen, locks: inhalt.locks,
    contacts: inhalt.contacts, categories: inhalt.categories, accounts: inhalt.accounts,
  }, null, 1) });
  files.push({ name: 'buchungen.csv', text: buchungenCsv(db, inhalt.transactions) });
  files.push({ name: 'journal.jsonl', text: `${inhalt.journal.map((e) => JSON.stringify(e)).join('\n')}\n` });
  melden('Rechnet die Unterlagen fürs Finanzamt …');
  files.push({ name: 'finanzamt/Anlage-EUER.csv', text: X.euerCsv(offen, period) });
  if (!isKleinunternehmer(db)) files.push({ name: 'finanzamt/Umsatzsteuer.csv', text: X.ustvaCsv(offen, period) });
  files.push({ name: 'finanzamt/Offene-Posten.csv', text: X.openItemsCsv(offen, period.to) });
  files.push({ name: 'finanzamt/Anlagenverzeichnis.csv', text: X.assetsCsv(offen, period) });
  for (const g of X.gobdExport(db, period)) files.push({ name: `gobd/${g.name}`, text: g.text });
  if (berichte) {
    melden('Schreibt die Berichte als PDF …');
    // Erst hier laden: Berichte und PDF-Schreiber sind groß und nur dafür nötig.
    const [R, P] = await Promise.all([import('./reports.js'), import('./pdfausgabe.js')]);
    files.push(await P.pdfFuerPaket(R.yearPack(offen, period), `berichte/Jahresunterlagen_${inhalt.jahr}.pdf`));
  }
  const lesen = belegLesen || ((id) => api.attach.read(id));
  const vergeben = new Set();
  const eindeutig = (name) => {
    let n = name;
    let i = 2;
    while (vergeben.has(n)) { const p = name.lastIndexOf('.'); n = p > 0 ? `${name.slice(0, p)} (${i})${name.slice(p)}` : `${name} (${i})`; i++; }
    vergeben.add(n);
    return n;
  };
  const belegIndex = [];
  const rechnungsBelege = new Map();
  for (const r of inhalt.invoices) {
    for (const [art, id] of Object.entries(r.dateien || {})) if (id) rechnungsBelege.set(id, `rechnungen/${sicher(r.nummer || r.id)}${art === 'xml' ? '.xml' : '.pdf'}`);
    if (r.anhangId) rechnungsBelege.set(r.anhangId, `rechnungen/eingang_${sicher(r.nummer || r.gelesen?.nummer || r.id)}`);
  }
  for (const m of inhalt.reminders) if (m.pdfId) rechnungsBelege.set(m.pdfId, `rechnungen/mahnung_${sicher(m.nummer || m.invoiceId)}_stufe${m.stufe || ''}.pdf`);
  const buchungVon = new Map();
  for (const t of inhalt.transactions) for (const id of t.attachments || []) if (!buchungVon.has(id)) buchungVon.set(id, t);
  let n = 0;
  for (const a of inhalt.attachments) {
    n++;
    melden(`Liest Belege (${n} von ${inhalt.attachments.length}) …`);
    let dataBase64;
    try {
      dataBase64 = await lesen(a.id);
    } catch (e) {
      belegIndex.push([a.id, a.fileName, 'FEHLT', String(e?.message || e)]);
      continue;
    }
    const t = buchungVon.get(a.id);
    const name = rechnungsBelege.get(a.id)
      ? eindeutig(rechnungsBelege.get(a.id))
      : eindeutig(`belege/${t ? `${t.date}_${sicher(t.description || t.id).slice(0, 40)}_` : ''}${sicher(a.fileName)}`);
    files.push({ name, dataBase64 });
    belegIndex.push([a.id, a.fileName, name, a.sha256 || '']);
  }
  files.push({ name: 'belege/verzeichnis.csv', text: X.toCsv(['Kennung', 'Dateiname', 'Im Archiv', 'SHA-256 der Datei'], belegIndex) });
  melden('Rechnet Prüfsummen …');
  const eintraege = [];
  for (const f_ of files) eintraege.push([await sha256(f_.dataBase64 ? base64ZuBytes(f_.dataBase64) : te.encode(f_.text ?? '')), f_.name]);
  files.unshift({ name: 'MANIFEST.sha256', text: manifest(eintraege) });
  files.unshift({ name: 'LIESMICH.txt', text: liesmich(db, inhalt, { version, erstelltAm, fristen: f }) });
  return { files, inhalt, erstelltAm };
}

/** Der Archivvermerk, wie er in `archive` steht. */
export function archivVermerk({ inhalt, erstelltAm, version, dateiName, sha256: hash, groesse }) {
  return {
    id: uid('arc'),
    jahr: inhalt.jahr, von: inhalt.von, bis: inhalt.bis,
    erstelltAm, app: version || '',
    dateiName, sha256: hash, groesse: Number(groesse) || 0,
    anzahl: { buchungen: inhalt.transactions.length, rechnungen: inhalt.invoices.length, mahnungen: inhalt.reminders.length, belege: inhalt.attachments.length, journal: inhalt.journal.length },
    journalLetzterHash: inhalt.journal.at(-1)?.hash || '',
    geloeschtAm: '', geloescht: null, belegeGeloeschtAm: '',
    updatedAt: erstelltAm,
  };
}

/**
 * Das Jahresarchiv erstellen, speichern und vermerken.
 * @returns {Promise<{gespeichert:boolean, vermerk:object|null, dateiName:string}>}
 */
export async function jahresarchivErstellen(jahr, { version = '', melden = () => {} } = {}) {
  const db = await bestandMitJournal();
  const { files, inhalt, erstelltAm } = await jahresarchivDateien(db, jahr, { version, melden });
  const dateiName = `Kontovia-Archiv-${inhalt.jahr}.zip`;
  melden('Packt das Archiv …');
  const r = await api.file.archiv({ name: dateiName, files });
  if (!r?.gespeichert) return { gespeichert: false, vermerk: null, dateiName };
  const vermerk = archivVermerk({ inhalt, erstelltAm, version, dateiName: r.name || dateiName, sha256: r.sha256, groesse: r.groesse });
  await commit('archiv.anlegen', (d) => { d.archive ??= []; d.archive.push(vermerk); return vermerk; }, {
    entity: 'archiv', entityId: vermerk.id,
    summary: `Jahresarchiv ${inhalt.jahr}: ${vermerk.dateiName}, ${inhalt.transactions.length} Buchungen, ${inhalt.attachments.length} Belege, SHA-256 ${vermerk.sha256}`,
  });
  return { gespeichert: true, vermerk, dateiName: vermerk.dateiName };
}

/** Eine gewählte Datei mit dem Archivvermerk des Jahres vergleichen. */
export async function archivPruefen(jahr) {
  const vermerk = archivVon(store.db, jahr);
  if (!vermerk) throw new Error('Zu diesem Jahr gibt es keinen Archivvermerk.');
  const datei = await api.file.pruefsumme([{ name: 'Jahresarchiv', extensions: ['zip'] }]);
  if (!datei) return null;
  return { passt: datei.sha256 === vermerk.sha256, datei, vermerk };
}

/* -------------------------------------------------------------------------- */
/* Löschlauf                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Entfernt ein Jahr aus dem Bestand (oder nur seine Belegdateien). Vorher
 * muss ein Archivvermerk da sein und die Frist abgelaufen; die Oberfläche
 * fragt doppelt nach. Dateien werden nach dem Eintrag gelöscht; was dabei
 * scheitert, räumt „Nicht mehr benötigte Belegdateien löschen“ später weg.
 * @param {number} jahr
 * @param {{nurBelege?:boolean, kontakte?:boolean, heute?:string, belegLoeschen?:(id:string)=>Promise<any>}} [opts]
 */
export async function jahrLoeschen(jahr, { nurBelege = false, kontakte = true, heute = todayISO(), belegLoeschen = null } = {}) {
  const db = store.db;
  const vermerk = archivVon(db, jahr);
  if (!vermerk) throw new Error('Erst das Jahresarchiv erstellen, dann löschen.');
  const f = fristen(db.settings || {});
  const ab = `${Number(jahr) + (nurBelege ? f.belege : f.buchhaltung) + 1}-01-01`;
  if (heute < ab) throw new Error(`Die Aufbewahrungsfrist für ${jahr} läuft noch bis ${fmtDate(`${ab.slice(0, 4) - 1}-12-31`)}.`);
  const plan = loeschplan(db, jahr, { nurBelege, kontakte });
  const text = loeschplanText(plan);
  const weg = (liste, ids) => { const s = new Set(ids); return (liste || []).filter((x) => !s.has(x.id)); };
  await commit(nurBelege ? 'archiv.belegeLoeschen' : 'archiv.loeschen', (d) => {
    const jetzt = new Date().toISOString();
    for (const [sammlung, ids] of Object.entries({ transactions: plan.transactions, invoices: plan.invoices, reminders: plan.reminders, imports: plan.imports, elsterMeldungen: plan.elsterMeldungen, attachments: plan.attachments, contacts: plan.contacts })) {
      if (!ids.length) continue;
      d[sammlung] = weg(d[sammlung], ids);
      for (const id of ids) tomb(d, sammlung, id);
    }
    if (nurBelege) {
      // Die Buchungen bleiben; der Verweis auf die Datei geht, damit nichts ins Leere zeigt.
      const s = new Set(plan.attachments);
      for (const t of d.transactions || []) if ((t.attachments || []).some((id) => s.has(id))) t.attachments = t.attachments.filter((id) => !s.has(id));
    } else {
      for (const a of d.appointments || []) if (a.transactionIds?.some((id) => plan.transactions.includes(id))) a.transactionIds = a.transactionIds.filter((id) => !plan.transactions.includes(id));
    }
    const v = (d.archive || []).find((a) => a.id === vermerk.id);
    if (v) {
      if (nurBelege) v.belegeGeloeschtAm = jetzt;
      else { v.geloeschtAm = jetzt; v.geloescht = plan.anzahl; }
      v.updatedAt = jetzt;
    }
    return plan;
  }, {
    entity: 'archiv', entityId: vermerk.id,
    summary: `${nurBelege ? 'Belegdateien' : 'Jahr'} ${jahr} nach Ablauf der Aufbewahrungsfrist gelöscht: ${text}. Archiv ${vermerk.dateiName}, SHA-256 ${vermerk.sha256}`,
  });
  const loeschen = belegLoeschen || ((id) => api.attach.remove(id));
  let dateien = 0;
  for (const id of plan.attachments) {
    try { await loeschen(id); dateien++; } catch (e) { console.error('Belegdatei löschen:', e?.message); }
  }
  return { plan, text, dateien };
}

/** Die Aufbewahrungsfristen setzen (nur Inhaber: einstellung.*). */
export async function fristenSetzen({ buchhaltung, belege }) {
  const b = Math.max(GESETZ.buchhaltung, Math.min(FRIST_GRENZEN.max, Number(buchhaltung) || GESETZ.buchhaltung));
  const be = Math.max(GESETZ.belege, Math.min(b, Number(belege) || GESETZ.belege));
  await commit('einstellung.aufbewahrung', (d) => {
    d.settings.aufbewahrungJahre = b;
    d.settings.aufbewahrungBelegeJahre = be;
  }, { entity: 'einstellungen', summary: `Aufbewahrung: Buchungen ${b} Jahre, Belege ${be} Jahre` });
  return { buchhaltung: b, belege: be };
}

/* -------------------------------------------------------------------------- */
/* Datenauskunft                                                               */
/* -------------------------------------------------------------------------- */

/** Die Auskunft zu einer Person als zwei Dateien: lesbar (.txt) und vollständig (.json). */
export async function auskunftDateien(kontaktId, heute = todayISO()) {
  const db = await bestandMitJournal();
  const a = auskunft(db, kontaktId, heute);
  const name = sicher(a.daten.kontakt.name || 'kontakt').replace(/\s+/g, '-');
  return [
    { name: `Auskunft_${name}_${heute}.txt`, text: a.text },
    { name: `Auskunft_${name}_${heute}.json`, text: JSON.stringify({ kind: 'kontovia-auskunft', version: 1, ...a.daten }, null, 1) },
  ];
}

export { money, bytesZuBase64 };
