/**
 * Kontovia – Umsätze aus Kontoauszügen offenen Rechnungen und Buchungen zuordnen.
 *
 * Ohne Oberfläche und ohne Speicher, damit scripts/pruefungen sie prüfen kann.
 *
 * Es gelten feste, nachlesbare Regeln und kein Lernverfahren: gleiche Eingabe,
 * gleiche Ausgabe (COMPLIANCE.md, Abschnitt 1). Jeder Vorschlag nennt seine
 * Gründe und eine Sicherheitsstufe:
 *
 *   sicher          Rechnungsnummer im Verwendungszweck und passender Betrag
 *   wahrscheinlich  passender Betrag und derselbe Name oder eine bekannte IBAN
 *   unsicher        nur die Nummer, nur der Betrag, ein abweichender Betrag
 *   Regel           eine eigene Regel des Nutzers („wenn … enthält …“)
 *   Vorschlag       nur eine Kategorie, erkannt aus Ihrer Geschichte oder an
 *                   bekannten Händlern (lib/kategorisierung.js); nichts Offenes
 *
 * Nur „sicher“ und eigene Regeln sind vorausgewählt. Gebucht wird nichts, bevor
 * der Nutzer bestätigt (lib/importaktionen.js).
 *
 * Dublettenschutz: Aus Datum, Betrag, Gegenseite, Verwendungszweck und Konto
 * entsteht ein Fingerabdruck (SHA-256). Er steht an jeder importierten
 * Buchung; derselbe Umsatz wird nie zweimal gebucht, auch bei überlappenden
 * Zeiträumen. Bereits vorhandene Buchungen, auch von Hand erfasste, melden
 * sich als mögliche Dublette.
 */

import { norm, sha256Hex, daysBetween } from './util.js';
import { rechnungsRest, mahnkostenStand } from './mahnwesen.js';
import { naechstesDatum } from './wiederkehrend.js';
import { geschichteAufbauen, kategorieVorschlagen } from './kategorisierung.js';

/* -------------------------------------------------------------------------- */
/* Fingerabdruck                                                               */
/* -------------------------------------------------------------------------- */

const kern = (s) => norm(s).replace(/[^a-z0-9]/g, '');

/**
 * Fingerabdrücke für eine Liste von Umsätzen. Gleiche Umsätze innerhalb der
 * Datei (zwei Kaffee zum selben Preis am selben Tag) bekommen die laufende
 * Nummer als Zusatz („….2“), damit der zweite nicht als Dublette des ersten
 * gilt; beim erneuten Einlesen derselben Datei ergibt sich dasselbe.
 *
 * @param {Array<object>} umsaetze
 * @param {string} kontoId
 * @param {(fertig:number, gesamt:number)=>Promise<void>|void} [fortschritt]  wird alle 300 Umsätze gerufen, damit die Oberfläche atmen kann
 * @returns {Promise<string[]>}
 */
export async function fingerabdruecke(umsaetze, kontoId, fortschritt = null) {
  const zaehler = new Map();
  const out = [];
  for (let i = 0; i < umsaetze.length; i++) {
    const u = umsaetze[i];
    const basis = await sha256Hex([u.datum, u.betrag, kern(u.gegenseite), kern(u.zweck), kontoId].join('|'));
    const n = (zaehler.get(basis) || 0) + 1;
    zaehler.set(basis, n);
    out.push(n > 1 ? `${basis}.${n}` : basis);
    if (fortschritt && (i + 1) % 300 === 0) await fortschritt(i + 1, umsaetze.length);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Namen und Nummern                                                           */
/* -------------------------------------------------------------------------- */

const FORMEN = new Set(['gmbh', 'mbh', 'kg', 'ag', 'ug', 'ohg', 'gbr', 'ek', 'e', 'k', 'ev', 'co', 'und', 'the', 'inc', 'ltd', 'llc', 'sarl', 'bv', 'nv', 'se', 'haftungsbeschraenkt', 'eingetragener', 'kaufmann', 'kauffrau', 'herr', 'frau', 'fa', 'firma', 'ireland', 'deutschland', 'germany']);

const TEILE = new Map();
function namensTeile(s) {
  const key = String(s ?? '');
  let t = TEILE.get(key);
  if (!t) {
    t = new Set(norm(key).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((x) => x && !FORMEN.has(x)));
    if (TEILE.size > 50000) TEILE.clear();
    TEILE.set(key, t);
  }
  return t;
}
/** Schlüssel eines Namens für die Suche nach bekannten IBAN: seine Wörter, sortiert. */
const nameKey = (name) => [...namensTeile(name)].sort().join(' ');

/** Wie ähnlich zwei Namen sind (0 bis 1): Anteil gemeinsamer Wörter ohne Rechtsformen, bezogen auf den kürzeren Namen. */
export function namenAehnlich(a, b) {
  const x = namensTeile(a); const y = namensTeile(b);
  if (!x.size || !y.size) return 0;
  let gemeinsam = 0;
  for (const t of x) if (y.has(t)) gemeinsam++;
  const kleiner = Math.min(x.size, y.size);
  const groesser = Math.max(x.size, y.size);
  // Ein Name, der im anderen vollständig steckt, zählt fast voll; gleiche Wortmenge voll.
  return gemeinsam === kleiner ? (kleiner === groesser ? 1 : 0.9) : gemeinsam / groesser;
}

/**
 * Steht die Rechnungsnummer im Text? „2026-0003“ findet sich auch als
 * „2026 0003“ oder „RE2026-0003“; Teil einer längeren Zahl („2026-00031“) zählt nicht.
 */
const MUSTER = new Map();
export function enthaeltNummer(text, nummer) {
  const n = String(nummer || '').trim();
  let m = MUSTER.get(n);
  if (m === undefined) {
    m = null;
    if (n.replace(/[^0-9A-Za-z]/g, '').length >= 3) {
      const teile = n.match(/[A-Za-zÄÖÜäöüß]+|\d+/g);
      if (teile) {
        const bau = (liste) => new RegExp(`(?<![A-Za-z0-9])${liste.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-_/.]*')}(?![0-9])`, 'i');
        // Zweites Muster ohne führenden Buchstabenteil („RE-2026-0003“ als „2026-0003“), wenn genug Ziffern bleiben
        m = { voll: bau(teile), kurz: teile.length > 2 && /^[A-Za-z]+$/.test(teile[0]) && teile.slice(1).join('').length >= 6 ? bau(teile.slice(1)) : null };
      }
    }
    if (MUSTER.size > 20000) MUSTER.clear();
    MUSTER.set(n, m);
  }
  if (!m) return false;
  const s = String(text || '');
  return m.voll.test(s) || (!!m.kurz && m.kurz.test(s));
}

/* -------------------------------------------------------------------------- */
/* Kontext aus dem Bestand                                                     */
/* -------------------------------------------------------------------------- */

const lebend = (t) => t && !t.voided && !t.isReversal;

/**
 * Was zum Zuordnen bereitsteht, aus dem Bestand gezogen.
 * @param {object} db
 * @param {{kontoId:string, hashes?:Iterable<string>}} opt
 */
export function zuordnungsKontext(db, { kontoId, hashes = null } = {}) {
  const txs = db.transactions || [];
  const byId = new Map(txs.map((t) => [t.id, t]));
  const kontakte = new Map((db.contacts || []).map((c) => [c.id, c]));
  const reminders = db.reminders || [];

  // Offene Ausgangsrechnungen
  const rechnungen = [];
  for (const r of db.invoices || []) {
    if (r.richtung === 'eingang' || r.status !== 'ausgestellt' || r.storno || r.storniertDurch || ['381', '384'].includes(String(r.art))) continue;
    const buchungen = (r.transactionIds || []).map((id) => byId.get(id)).filter(Boolean);
    const rest = rechnungsRest(r, buchungen);
    const neben = mahnkostenStand(r.id, reminders, txs);
    if (rest <= 0 && neben.offen <= 0) continue;
    rechnungen.push({
      id: r.id, nummer: r.nummer, kunde: r.kaeufer?.name || '', kontaktId: r.kaeufer?.kontaktId || '',
      rest, nebenOffen: neben.offen, offeneTxIds: buchungen.filter((t) => lebend(t) && !t.paidDate).map((t) => t.id), faellig: r.faellig || '',
    });
  }

  // Offene Eingangsrechnungen und offene Ausgaben
  const ausgaben = txs.filter((t) => lebend(t) && t.type === 'expense' && !t.paidDate && !t.unlisted && t.gross > 0).map((t) => ({
    txId: t.id, gross: t.gross, text: t.description || '', nummer: t.invoiceNumber || '', referenz: t.reference || '',
    name: kontakte.get(t.contactId)?.name || '', datum: t.date,
  }));

  // Bekannte IBAN je Kundenname aus früheren Importen
  const ibans = new Map();
  for (const t of txs) {
    const ib = t.import?.gegenIban;
    if (!ib || !lebend(t)) continue;
    const name = kontakte.get(t.contactId)?.name || t.import?.gegenseite || '';
    if (!name) continue;
    const k = nameKey(name);
    if (!ibans.has(k)) ibans.set(k, new Set());
    ibans.get(k).add(ib);
  }

  const bekannt = new Set(hashes || []);
  for (const t of txs) if (t.importHash) bekannt.add(t.importHash);

  return {
    kontoId,
    rechnungen,
    ausgaben,
    wiederkehrend: (db.recurring || []).filter((r) => r.active !== false && r.template),
    regeln: (db.bankRules || []).filter((r) => r.aktiv !== false).slice().sort((a, b) => (Number(a.ordnung) || 0) - (Number(b.ordnung) || 0) || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id))),
    kategorien: new Map((db.categories || []).map((c) => [c.id, c])),
    kontakte: db.contacts || [],
    ibans,
    geschichte: geschichteAufbauen(txs, kontakte),
    bekannt,
    vorhanden: txs.filter((t) => lebend(t) && t.paidDate && !t.importHash && !t.unlisted),
  };
}

/* -------------------------------------------------------------------------- */
/* Zuordnen                                                                    */
/* -------------------------------------------------------------------------- */

const STUFEN = { sicher: 3, wahrscheinlich: 2, unsicher: 1, keine: 0 };
export const SICHERHEIT = {
  sicher: 'Sicher',
  wahrscheinlich: 'Wahrscheinlich',
  unsicher: 'Unsicher',
  regel: 'Regel',
  vorschlag: 'Vorschlag',
  hand: 'Von Ihnen gewählt',
  keine: 'Keine Zuordnung',
};

const abstand = (a, b) => Math.abs(daysBetween(a, b));

/** Passt eine eigene Regel zu diesem Umsatz? */
export function regelPasst(regel, u, kategorien) {
  if (!regel || !String(regel.enthaelt || '').trim()) return false;
  const richtung = regel.richtung || 'beide';
  if (richtung === 'ein' && u.betrag <= 0) return false;
  if (richtung === 'aus' && u.betrag >= 0) return false;
  const nadel = norm(regel.enthaelt).replace(/\s+/g, ' ').trim();
  const heu = (s) => norm(s).replace(/\s+/g, ' ');
  const felder = regel.feld === 'zweck' ? [u.zweck]
    : regel.feld === 'gegenseite' ? [u.gegenseite]
      : regel.feld === 'iban' ? [u.gegenIban]
        : [u.zweck, u.gegenseite, u.gegenIban, u.buchungstext];
  if (!felder.some((f) => heu(f).includes(nadel))) return false;
  // Die Kategorie muss zur Richtung passen: Einnahme für Eingänge, Ausgabe für Ausgänge.
  const kat = kategorien?.get(regel.kategorieId);
  if (kategorien && (!kat || kat.active === false || kat.kind !== (u.betrag > 0 ? 'income' : 'expense'))) return false;
  return true;
}

/**
 * Ordnet Umsätze zu. Das Ergebnis hat je Umsatz einen Eintrag in derselben Reihenfolge.
 *
 * @param {Array<object>} umsaetze  aus lib/kontoauszug.js
 * @param {string[]} hashes  Fingerabdrücke je Umsatz (fingerabdruecke)
 * @param {object} ctx  zuordnungsKontext
 * @returns {Array<object>}
 */
export async function zuordnen(umsaetze, hashes, ctx, { atmen = null } = {}) {
  let schritte = 0;
  const pause = async () => { if (atmen && ++schritte % 120 === 0) await atmen(); };
  const zeilen = umsaetze.map((u, i) => ({
    index: i, u, hash: hashes[i] || '', schonImportiert: ctx.bekannt.has(hashes[i]),
    art: 'keine', sicherheit: 'keine', gruende: [], ziele: [], mahnkosten: 0, txId: '', regel: null, kategorieId: '', kontaktId: '', gruppe: '', ohneKategorie: false,
    beschreibung: '', dublette: null, hinweis: '', regelId: '', wiederkehrendId: '', wiederkehrendDatum: '',
  }));
  const frei = zeilen.filter((z) => !z.schonImportiert);

  const belegtR = new Set(); // Rechnungen, die schon eine Zeile für sich hat
  const belegtA = new Set(); // offene Ausgaben

  /* ---------------- Eingänge gegen offene Rechnungen ---------------- */
  // Je Umsatz einmal gerechnet und gemerkt. Nur Rechnungen mit Nummer oder Betrag können einen Treffer ergeben,
  // alles andere (nur ein ähnlicher Name) bleibt „keine“ und fällt gleich weg: bei tausenden Umsätzen und hunderten
  // offenen Rechnungen spart das fast die ganze Rechenzeit.
  const merkeEin = new Map();
  const kandidatenEin = (z) => {
    let fest = merkeEin.get(z.index);
    if (!fest) {
      const u = z.u;
      const text = `${u.zweck} ${u.referenz} ${u.buchungstext}`;
      fest = [];
      for (const r of ctx.rechnungen) {
        const nummer = enthaeltNummer(text, r.nummer);
        const betragRest = r.rest > 0 && u.betrag === r.rest;
        const betragMitKosten = r.rest > 0 && r.nebenOffen > 0 && u.betrag === r.rest + r.nebenOffen;
        const nurKosten = r.rest <= 0 && r.nebenOffen > 0 && u.betrag === r.nebenOffen;
        const betrag = betragRest || betragMitKosten || nurKosten;
        if (!nummer && !betrag) continue;
        const ae = namenAehnlich(u.gegenseite, r.kunde);
        const iban = !!u.gegenIban && !!ctx.ibans.get(nameKey(r.kunde))?.has(u.gegenIban);
        fest.push({ r, nummer, betrag, betragRest, betragMitKosten, nurKosten, name: ae, nameStark: ae >= 0.8, nameSchwach: ae >= 0.5, iban });
      }
      merkeEin.set(z.index, fest);
    }
    return fest.filter((c) => !belegtR.has(c.r.id));
  };

  const stufeVon = (c, einzigerBetrag) => {
    if (c.nummer && c.betrag) return 'sicher';
    if (!c.nummer && c.betrag && (c.nameStark || c.iban)) return 'wahrscheinlich';
    if (c.nummer || (c.betrag && (einzigerBetrag || c.nameSchwach))) return 'unsicher';
    return 'keine';
  };

  const gruendeVon = (c, u) => {
    const g = [];
    if (c.nummer) g.push(`Rechnungsnummer ${c.r.nummer} steht im Verwendungszweck`);
    if (c.betragRest) g.push('Betrag stimmt mit dem offenen Betrag überein');
    if (c.betragMitKosten) g.push('Betrag entspricht Rechnung plus Mahnkosten');
    if (c.nurKosten) g.push('Betrag entspricht den offenen Mahnkosten');
    if (c.nameStark) g.push(`Name passt (${c.r.kunde})`);
    else if (c.nameSchwach) g.push(`Name ähnelt ${c.r.kunde}`);
    if (c.iban) g.push('IBAN kennt Kontovia von früheren Zahlungen');
    if (c.nummer && !c.betrag) g.push(`Betrag weicht ab: offen sind ${cent(c.r.rest + c.r.nebenOffen)}, überwiesen wurden ${cent(u.betrag)}`);
    return g;
  };

  const ziel = (c) => ({ rechnungId: c.r.id, nummer: c.r.nummer, kunde: c.r.kunde, rest: c.r.rest, nebenOffen: c.r.nebenOffen, txIds: c.r.offeneTxIds });

  // Sammelzahlung: mehrere Rechnungsnummern im Zweck, Summe der offenen Beträge stimmt
  for (const z of frei.filter((x) => x.u.betrag > 0)) {
    await pause();
    const mit = kandidatenEin(z).filter((c) => c.nummer);
    if (mit.length < 2) continue;
    const summeRest = mit.reduce((s, c) => s + c.r.rest, 0);
    const summeAlles = mit.reduce((s, c) => s + c.r.rest + c.r.nebenOffen, 0);
    if (z.u.betrag === summeRest || z.u.betrag === summeAlles) {
      z.art = 'rechnung'; z.sicherheit = 'sicher';
      z.ziele = mit.map(ziel);
      z.mahnkosten = z.u.betrag === summeAlles ? mit.reduce((s, c) => s + c.r.nebenOffen, 0) : 0;
      z.gruende = [`${mit.length} Rechnungsnummern im Verwendungszweck`, 'Summe der offenen Beträge stimmt'];
      for (const c of mit) belegtR.add(c.r.id);
    }
  }

  // Drei Durchgänge: erst die sicheren, dann die wahrscheinlichen, dann die unsicheren Treffer; ein Treffer wird nie doppelt vergeben.
  for (const stufe of ['sicher', 'wahrscheinlich', 'unsicher']) {
    for (const z of frei.filter((x) => x.u.betrag > 0 && x.art === 'keine')) {
      await pause();
      const alle = kandidatenEin(z);
      const einzigerBetrag = alle.filter((c) => c.betrag).length === 1;
      const treffer = alle.map((c) => ({ c, s: stufeVon(c, einzigerBetrag) })).filter((x) => x.s === stufe);
      if (!treffer.length) continue;
      // Beste zuerst: Nummer, Betrag, Name, älteste Fälligkeit, Nummer als letzter Halt (feste Reihenfolge, kein Zufall)
      treffer.sort((a, b) => (b.c.nummer - a.c.nummer) || (b.c.betrag - a.c.betrag) || (b.c.name - a.c.name)
        || String(a.c.r.faellig).localeCompare(String(b.c.r.faellig)) || String(a.c.r.nummer).localeCompare(String(b.c.r.nummer)));
      const c = treffer[0].c;
      z.art = 'rechnung';
      // Passen mehrere gleich gut, ist es höchstens „unsicher“.
      const gleich = treffer.filter((x) => x.c.nummer === c.nummer && x.c.betrag === c.betrag && x.c.name === c.name).length > 1;
      z.sicherheit = gleich && stufe !== 'sicher' ? 'unsicher' : stufe;
      z.ziele = [ziel(c)];
      z.mahnkosten = c.betragMitKosten ? c.r.nebenOffen : (c.nurKosten ? c.r.nebenOffen : 0);
      z.gruende = gruendeVon(c, z.u);
      if (gleich) z.gruende.push('Mehrere offene Rechnungen passen gleich gut');
      // Abweichender Betrag: Teilzahlung oder Überzahlung ist keine Zuordnung zum Selbstlauf.
      if (c.nummer && !c.betrag) {
        z.hinweis = z.u.betrag < c.r.rest ? 'Teilzahlung' : 'Betrag höher als offen';
        z.ziele[0].teilzahlung = z.u.betrag > 0 && z.u.betrag < c.r.rest;
      }
      belegtR.add(c.r.id);
    }
  }

  /* ---------------- Ausgänge gegen offene Eingangsrechnungen ---------------- */
  for (const stufe of ['sicher', 'wahrscheinlich', 'unsicher']) {
    for (const z of frei.filter((x) => x.u.betrag < 0 && x.art === 'keine')) {
      await pause();
      const u = z.u;
      const text = `${u.zweck} ${u.referenz} ${u.buchungstext}`;
      const betrag = Math.abs(u.betrag);
      const alle = ctx.ausgaben.filter((a) => !belegtA.has(a.txId)).map((a) => {
        const nummer = (a.nummer && enthaeltNummer(text, a.nummer)) || (a.referenz && a.referenz.length >= 5 && enthaeltNummer(text, a.referenz));
        const b = a.gross === betrag;
        const nameWert = Math.max(namenAehnlich(u.gegenseite, a.name), namenAehnlich(u.gegenseite, a.text));
        return { a, nummer, betrag: b, name: nameWert, nameStark: nameWert >= 0.8, nameSchwach: nameWert >= 0.5 };
      });
      const einzigerBetrag = alle.filter((c) => c.betrag).length === 1;
      const s = (c) => (c.nummer && c.betrag ? 'sicher' : (!c.nummer && c.betrag && c.nameStark ? 'wahrscheinlich' : (c.nummer || (c.betrag && (einzigerBetrag || c.nameSchwach)) ? 'unsicher' : 'keine')));
      const treffer = alle.map((c) => ({ c, s: s(c) })).filter((x) => x.s === stufe);
      if (!treffer.length) continue;
      treffer.sort((a, b) => (b.c.nummer ? 1 : 0) - (a.c.nummer ? 1 : 0) || (b.c.name - a.c.name) || String(a.c.a.datum).localeCompare(String(b.c.a.datum)) || String(a.c.a.txId).localeCompare(String(b.c.a.txId)));
      const c = treffer[0].c;
      z.art = 'ausgabe'; z.sicherheit = stufe; z.txId = c.a.txId;
      z.gruende = [
        ...(c.nummer ? [`Rechnungsnummer steht im Verwendungszweck`] : []),
        ...(c.betrag ? ['Betrag stimmt mit der offenen Eingangsrechnung überein'] : [`Betrag weicht ab: offen sind ${cent(c.a.gross)}`]),
        ...(c.nameStark ? [`Name passt (${c.a.name || c.a.text})`] : []),
      ];
      belegtA.add(c.a.txId);
    }
  }

  /* ---------------- Eigene Regeln für den Rest ---------------- */
  for (const z of frei.filter((x) => x.art === 'keine' || STUFEN[x.sicherheit] < 2)) {
    const r = ctx.regeln.find((x) => regelPasst(x, z.u, ctx.kategorien));
    if (!r) continue;
    // Eine Regel überstimmt nur Treffer, die höchstens „unsicher“ sind.
    if (z.art !== 'keine') { for (const id of z.ziele.map((t) => t.rechnungId)) belegtR.delete(id); belegtA.delete(z.txId); z.ziele = []; z.txId = ''; z.mahnkosten = 0; z.hinweis = ''; }
    z.art = 'regel'; z.sicherheit = 'regel'; z.regel = { id: r.id, name: r.name || r.enthaelt };
    z.kategorieId = r.kategorieId; z.kontaktId = r.kontaktId || ''; z.beschreibung = r.beschreibung || '';
    z.gruende = [`Regel „${r.name || r.enthaelt}“: ${r.feld === 'zweck' ? 'Verwendungszweck' : r.feld === 'gegenseite' ? 'Gegenseite' : r.feld === 'iban' ? 'IBAN' : 'Text'} enthält „${r.enthaelt}“`];
  }

  /* ---------------- Wiederkehrende Buchungen ---------------- */
  for (const z of frei.filter((x) => x.art === 'keine' && x.u.betrag < 0)) {
    const u = z.u;
    const text = `${u.zweck} ${u.gegenseite}`;
    for (const regel of ctx.wiederkehrend) {
      const t = regel.template || {};
      if (t.type !== 'expense' || Number(t.gross) !== Math.abs(u.betrag)) continue;
      const faellig = naechstesDatum(regel);
      if (!faellig || abstand(faellig, u.datum) > 10) continue;
      const nameWert = Math.max(namenAehnlich(u.gegenseite, (ctx.kontakte.find((c) => c.id === t.contactId) || {}).name || ''), namenAehnlich(text, t.description || ''));
      if (nameWert < 0.5) continue;
      z.art = 'wiederkehrend'; z.sicherheit = 'wahrscheinlich'; z.wiederkehrendId = regel.id; z.wiederkehrendDatum = faellig;
      z.gruende = [`Passt zur wiederkehrenden Buchung „${t.description}“ (Betrag, Name, Termin ${faellig.split('-').reverse().join('.')})`];
      break;
    }
  }

  /* ---------------- Kategorie vorschlagen (lokal, aus Ihrer Geschichte und bekannten Händlern) ---------------- */
  for (const z of frei.filter((x) => x.art === 'keine')) {
    await pause();
    const v = kategorieVorschlagen(z.u, ctx);
    if (!v) continue;
    z.art = 'neu'; z.sicherheit = 'vorschlag'; z.kategorieId = v.kategorieId; z.gruppe = v.gruppe;
    z.gruende = [v.grund];
  }

  /* ---------------- Mögliche Dubletten unter den vorhandenen Buchungen ---------------- */
  const genommen = new Set();
  // Nach Betrag geordnet, damit bei tausenden Buchungen nur die mit gleichem Betrag verglichen werden.
  const nachBetrag = new Map();
  for (const t of ctx.vorhanden) { const l = nachBetrag.get(t.gross); if (l) l.push(t); else nachBetrag.set(t.gross, [t]); }
  for (const z of frei) {
    await pause();
    const u = z.u;
    const art = u.betrag > 0 ? 'income' : 'expense';
    const treffer = (nachBetrag.get(Math.abs(u.betrag)) || [])
      .filter((t) => !genommen.has(t.id) && t.type === art && (!t.accountId || !ctx.kontoId || t.accountId === ctx.kontoId) && abstand(t.paidDate, u.datum) <= 3)
      .sort((a, b) => abstand(a.paidDate, u.datum) - abstand(b.paidDate, u.datum) || String(a.id).localeCompare(String(b.id)));
    if (treffer.length) {
      const t = treffer[0];
      genommen.add(t.id);
      z.dublette = { txId: t.id, text: `${t.description || 'Buchung'} vom ${t.paidDate.split('-').reverse().join('.')}` };
    }
  }

  /* ---------------- Kontakt für neue Buchungen ---------------- */
  for (const z of zeilen) {
    if (z.kontaktId) continue;
    const name = norm(z.u.gegenseite);
    const k = name && ctx.kontakte.find((c) => norm(c.name) === name);
    if (k) z.kontaktId = k.id;
  }
  return zeilen;
}

const cent = (c) => `${(Math.abs(c) / 100).toFixed(2).replace('.', ',')} €`;

/** Ist die Zeile von sich aus angehakt? Nur sichere Treffer und eigene Regeln, nie Dubletten. */
export function vorausgewaehlt(z) {
  if (z.schonImportiert || z.dublette) return false;
  if (z.art === 'keine') return false;
  return z.sicherheit === 'sicher' || z.sicherheit === 'regel' || z.sicherheit === 'hand';
}

/** Zusammenzählen für die Kopfzeile der Prüfansicht. */
export function zaehlen(zeilen) {
  const n = { gesamt: zeilen.length, sicher: 0, wahrscheinlich: 0, unsicher: 0, regel: 0, vorschlag: 0, keine: 0, schon: 0, dubletten: 0 };
  for (const z of zeilen) {
    if (z.schonImportiert) { n.schon++; continue; }
    n[z.sicherheit] = (n[z.sicherheit] || 0) + 1;
    if (z.dublette) n.dubletten++;
  }
  return n;
}
