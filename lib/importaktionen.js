/**
 * Kontovia – Umsätze aus Kontoauszügen buchen.
 *
 * Erst wenn der Nutzer bestätigt hat, wird gebucht, und nur, was angehakt ist.
 * Jede Buchung trägt ihre Herkunft: den Fingerabdruck des Umsatzes
 * (`importHash`, schützt vor Doppelbuchung) und `import` mit Dateiname,
 * Zeitpunkt und Gegenseite. Das Journal nennt bei jeder Änderung die Datei.
 *
 * Was möglich ist, bestimmt die Festschreibung (GoBD): Ein festgeschriebener
 * Zeitraum wird nicht verändert. Bei einer festgeschriebenen offenen Rechnung
 * darf nur die Zahlung nachgetragen werden (Zahlungsdatum nach dem Stichtag
 * und Konto), alles andere bleibt gesperrt.
 *
 * Zahlungseingang einer offenen Rechnung: `paidDate` und Konto der offenen
 * Buchung, wie beim Markieren als bezahlt. Mahngebühr und Verzugsaufschlag
 * stehen, wenn sie mit gezahlt wurden, als eigene Einnahme dabei.
 */

import { uid, splitFromGross } from './util.js';
import { store, sel, commit, isLockedDate, newTransactionDraft } from './store.js';
import { buchungAusRegel, buchungsId } from './wiederkehrend.js';
import { mahnkostenBuchung, mahnkostenKategorieSichern } from './mahnungsaktionen.js';
import { mahnkostenStand } from './mahnwesen.js';

const jetzt = () => new Date().toISOString();
const dm = (iso) => String(iso).split('-').reverse().join('.');
const euro = (c) => `${(Math.abs(c) / 100).toFixed(2).replace('.', ',')} €`;

/** Die Herkunft einer importierten Buchung. */
function herkunft(z, meta) {
  return {
    importHash: z.hash,
    import: { id: meta.importId, datei: meta.datei, ts: meta.ts, gegenseite: z.u.gegenseite || '', gegenIban: z.u.gegenIban || '' },
  };
}

/** Ersetzt oder legt eine Buchung an und schreibt das Journal mit Hinweis auf die Datei. */
async function buchungSchreiben(tx, summary, { neu = false, zusatz = null } = {}) {
  tx.updatedAt = jetzt();
  if (neu) tx.createdAt ??= tx.updatedAt;
  return commit(neu ? 'buchung.anlegen' : 'buchung.aendern', (db) => {
    const i = db.transactions.findIndex((t) => t.id === tx.id);
    if (i >= 0) db.transactions[i] = tx; else db.transactions.push(tx);
    zusatz?.(db);
    return tx;
  }, { entity: 'buchung', entityId: tx.id, summary: summary.slice(0, 300) });
}

/* -------------------------------------------------------------------------- */
/* Prüfen                                                                      */
/* -------------------------------------------------------------------------- */

const offeneTx = (ziel) => (ziel.txIds || []).map((id) => sel.transaction(id)).filter((t) => t && !t.voided && !t.isReversal && !t.paidDate);

/**
 * Lässt sich diese Zeile buchen? Gibt den Grund zurück, wenn nicht.
 * @param {object} z  Zeile aus lib/zuordnung.js (mit ggf. vom Nutzer geänderten Feldern)
 * @param {{kontoId:string}} opt
 * @returns {{ok:boolean, grund:string}}
 */
export function zeilePruefen(z, { kontoId }) {
  const u = z.u;
  const nein = (grund) => ({ ok: false, grund });
  if (!kontoId || !sel.account(kontoId)) return nein('Bitte ein Zahlungskonto wählen.');
  if (z.schonImportiert && !z.trotzdem) return nein('Dieser Umsatz ist schon importiert.');
  if (u.waehrung && u.waehrung !== 'EUR') return nein(`Die Währung ${u.waehrung} lässt sich nicht buchen, nur Euro.`);
  if (isLockedDate(u.datum)) return nein('Das Datum liegt im festgeschriebenen Zeitraum.');
  if (z.art === 'rechnung') {
    if (!z.ziele?.length) return nein('Es ist keine Rechnung gewählt.');
    let summe = 0;
    for (const t of z.ziele) {
      const r = sel.invoice(t.rechnungId);
      if (!r) return nein('Die Rechnung gibt es nicht mehr.');
      const offen = offeneTx(t);
      const rest = offen.reduce((n, x) => n + x.gross, 0);
      summe += rest;
      if (!offen.length && !z.mahnkosten) return nein(`Rechnung ${r.nummer} hat nichts mehr offen.`);
    }
    const kosten = Number(z.mahnkosten) || 0;
    const neben = kosten && z.ziele.length === 1 ? mahnkostenStand(z.ziele[0].rechnungId, store.db.reminders, store.db.transactions).offen : 0;
    if (kosten > neben && z.ziele.length === 1) return nein('Die Mahnkosten sind höher als offen.');
    if (z.u.betrag !== summe + kosten) {
      // Teilzahlung: nur bei einer einzigen offenen Buchung, die nicht festgeschrieben ist
      const t = z.ziele[0];
      const offen = offeneTx(t);
      if (z.ziele.length === 1 && offen.length === 1 && !kosten && u.betrag > 0 && u.betrag < offen[0].gross) {
        if (isLockedDate(offen[0].date) || (offen[0].paidDate && isLockedDate(offen[0].paidDate))) return nein('Teilzahlung nicht möglich: Die Rechnung liegt im festgeschriebenen Zeitraum.');
        return { ok: true, grund: '', teilzahlung: true };
      }
      if (z.ziele.length === 1 && offen.length > 1 && u.betrag < summe) return nein('Teilzahlung nicht möglich: Die Rechnung hat mehrere offene Buchungen (mehrere Steuersätze). Bitte die Zahlung in der Rechnung vermerken.');
      return nein(`Der Betrag ${euro(u.betrag)} passt nicht zu den offenen ${euro(summe + kosten)}.`);
    }
    return { ok: true, grund: '' };
  }
  if (z.art === 'ausgabe') {
    const t = sel.transaction(z.txId);
    if (!t || t.voided || t.paidDate) return nein('Die offene Buchung gibt es nicht mehr oder ist schon bezahlt.');
    if (t.gross !== Math.abs(u.betrag)) return nein(`Der Betrag ${euro(u.betrag)} passt nicht zu ${euro(t.gross)}.`);
    return { ok: true, grund: '' };
  }
  if (z.art === 'wiederkehrend') {
    const regel = sel.recurringRule(z.wiederkehrendId);
    if (!regel) return nein('Die wiederkehrende Buchung gibt es nicht mehr.');
    if (sel.transaction(buchungsId(regel, z.wiederkehrendDatum))) return nein('Zu diesem Termin gibt es die Buchung schon.');
    if (isLockedDate(z.wiederkehrendDatum)) return nein('Der Termin liegt im festgeschriebenen Zeitraum.');
    return { ok: true, grund: '' };
  }
  if (z.art === 'neu' || z.art === 'regel') {
    // Ausdrücklich ohne Kategorie buchen ist erlaubt (schnell erfassen, später zuordnen); stillschweigend nicht.
    if (!z.kategorieId && z.ohneKategorie) return { ok: true, grund: '' };
    const kat = sel.category(z.kategorieId);
    if (!kat) return nein('Bitte eine Kategorie wählen.');
    if (kat.kind !== (u.betrag > 0 ? 'income' : 'expense')) return nein(`Die Kategorie passt nicht: ${u.betrag > 0 ? 'Eingänge brauchen eine Einnahme-Kategorie' : 'Ausgänge brauchen eine Ausgaben-Kategorie'}.`);
    return { ok: true, grund: '' };
  }
  return nein('Bitte zuordnen oder eine Kategorie wählen.');
}

/* -------------------------------------------------------------------------- */
/* Buchen                                                                      */
/* -------------------------------------------------------------------------- */

function neueBuchung(z, kontoId, meta) {
  const u = z.u;
  const kat = sel.category(z.kategorieId);
  const einnahme = u.betrag > 0;
  const tx = newTransactionDraft(einnahme ? 'income' : 'expense');
  const klein = store.db.settings.taxMode === 'kleinunternehmer';
  const gross = Math.abs(u.betrag);
  const rate = klein ? 0 : Number(kat?.vatRate) || 0;
  const t = splitFromGross(gross, rate);
  const beschreibung = String(z.beschreibung || '').trim() || [u.gegenseite, u.zweck].filter(Boolean).join(': ');
  Object.assign(tx, {
    id: uid('tx'),
    date: u.datum,
    paidDate: u.datum,
    description: (beschreibung || (einnahme ? 'Zahlungseingang' : 'Zahlungsausgang')).slice(0, 200),
    categoryId: z.kategorieId || '',
    contactId: z.kontaktId || '',
    accountId: kontoId,
    gross: t.gross, net: t.net, vat: t.vat, vatRate: rate,
    reference: String(u.referenz || '').slice(0, 60),
    notes: '',
    attachments: [],
    ...(kat?.notTaxable ? { vatTreatment: 'nicht-steuerbar' } : {}),
    ...herkunft(z, meta),
  });
  return tx;
}

/**
 * Bucht eine Zeile. Wirft bei einem Fehler, bevor etwas verändert wird,
 * soweit sich das vorab prüfen lässt (zeilePruefen).
 * @param {object} z  Zeile
 * @param {{kontoId:string, importId:string, datei:string, ts:string}} meta
 * @returns {Promise<{buchungen:number, bezahlt:number, mahnkosten:number}>}
 */
export async function zeileBuchen(z, { kontoId, importId, datei, ts }) {
  const meta = { importId, datei, ts };
  const p = zeilePruefen(z, { kontoId });
  if (!p.ok) throw new Error(p.grund);
  const u = z.u;
  const quelle = `Kontoauszug-Import ${datei}`;
  const out = { buchungen: 0, bezahlt: 0, mahnkosten: 0 };
  // Mehrfach gebuchter, absichtlich trotzdem übernommener Umsatz: der Fingerabdruck bleibt eindeutig.
  const zeile = z.trotzdem && z.schonImportiert ? { ...z, hash: `${z.hash}~${Date.now().toString(36)}` } : z;

  if (z.art === 'rechnung') {
    for (const ziel of z.ziele) {
      const r = sel.invoice(ziel.rechnungId);
      const offen = offeneTx(ziel);
      if (p.teilzahlung) {
        const tx = offen[0];
        const rate = Number(tx.vatRate) || 0;
        const betrag = u.betrag;
        const netto = rate ? Math.round(betrag / (1 + rate / 100)) : betrag;
        const bezahlt = { ...structuredClone(tx), gross: betrag, net: netto, vat: betrag - netto, paidDate: u.datum, accountId: kontoId, description: `${tx.description} (Teilzahlung)`.slice(0, 200), ...herkunft(zeile, meta) };
        const rest = {
          ...structuredClone(tx), id: uid('tx'), gross: tx.gross - betrag, net: tx.net - netto, vat: tx.vat - (betrag - netto), paidDate: '',
          description: `${tx.description} (Rest)`.slice(0, 200), attachments: [], createdAt: jetzt(), updatedAt: jetzt(), isDeposit: false, partOf: tx.id,
        };
        delete rest.importHash; delete rest.import;
        await buchungSchreiben(bezahlt, `Teilzahlung ${euro(betrag)} zu Rechnung ${r.nummer} am ${dm(u.datum)}, offen bleiben ${euro(rest.gross)} (${quelle})`, {
          zusatz: (db) => {
            db.transactions.push(rest);
            const x = db.invoices.find((i) => i.id === r.id);
            if (x) { x.transactionIds = [...(x.transactionIds || []), rest.id]; x.updatedAt = jetzt(); }
          },
        });
        out.buchungen++; out.bezahlt++;
        continue;
      }
      for (const tx of offen) {
        const neu = { ...structuredClone(tx), paidDate: u.datum, accountId: kontoId, ...herkunft(zeile, meta) };
        await buchungSchreiben(neu, `Rechnung ${r.nummer} bezahlt am ${dm(u.datum)}, ${euro(tx.gross)} (${quelle})`);
        out.bezahlt++;
      }
      // Wie „als bezahlt markieren“: die Rechnung merkt sich das Zahlungsdatum.
      if (offeneTx(ziel).length === 0) {
        await commit('rechnung.bezahlt', (db) => {
          const x = db.invoices.find((i) => i.id === r.id);
          if (x) { x.bezahltAm = u.datum; x.updatedAt = jetzt(); }
        }, { entity: 'rechnung', entityId: r.id, summary: `${r.nummer} bezahlt am ${u.datum} (${quelle})` });
      }
    }
    if (z.mahnkosten > 0) {
      const kat = await mahnkostenKategorieSichern();
      // Bei einer Sammelzahlung bucht jede Rechnung ihre eigenen Mahnkosten, bei einer einzelnen der angegebene Betrag.
      for (const ziel of z.ziele) {
        const r = sel.invoice(ziel.rechnungId);
        const stand = mahnkostenStand(r.id, store.db.reminders, store.db.transactions);
        const betrag = z.ziele.length === 1 ? z.mahnkosten : Math.min(stand.offen, Number(ziel.nebenOffen) || 0);
        if (!(betrag > 0) || !stand.letzte) continue;
        const tx = mahnkostenBuchung(r, { betrag, datum: u.datum, kontoId, mahnungId: stand.letzte.id, kategorieId: kat.id });
        Object.assign(tx, herkunft(zeile, meta));
        await buchungSchreiben(tx, `Mahnkosten ${euro(betrag)} zu Rechnung ${r.nummer}, eingegangen am ${dm(u.datum)} (${quelle})`, { neu: true });
        out.buchungen++; out.mahnkosten++;
      }
    }
    return out;
  }

  if (z.art === 'ausgabe') {
    const tx = sel.transaction(z.txId);
    const neu = { ...structuredClone(tx), paidDate: u.datum, accountId: kontoId, ...herkunft(zeile, meta) };
    await buchungSchreiben(neu, `Ausgabe bezahlt am ${dm(u.datum)}: ${tx.description}, ${euro(tx.gross)} (${quelle})`);
    out.bezahlt++;
    return out;
  }

  if (z.art === 'wiederkehrend') {
    const regel = sel.recurringRule(z.wiederkehrendId);
    const tx = { ...buchungAusRegel(regel, z.wiederkehrendDatum), paidDate: u.datum, accountId: kontoId, ...herkunft(zeile, meta) };
    await buchungSchreiben(tx, `Wiederkehrende Buchung ${tx.description} vom ${dm(tx.date)}, bezahlt am ${dm(u.datum)}, ${euro(tx.gross)} (${quelle})`, {
      neu: true,
      zusatz: (db) => {
        const rg = db.recurring.find((x) => x.id === regel.id);
        if (rg) { rg.n = Math.max(Number(rg.n) || 0, (Number(regel.n) || 0) + 1); rg.updatedAt = jetzt(); }
      },
    });
    out.buchungen++;
    return out;
  }

  const tx = neueBuchung(zeile, kontoId, meta);
  await buchungSchreiben(tx, `${u.betrag > 0 ? 'Einnahme' : 'Ausgabe'} ${dm(u.datum)} ${euro(u.betrag)}, ${tx.description} (${quelle})`, { neu: true });
  out.buchungen++;
  return out;
}

/**
 * Bucht alle angehakten Zeilen nacheinander und legt den Import-Eintrag an.
 * Ein Fehler bei einer Zeile hält die übrigen nicht auf; er steht im Ergebnis.
 *
 * @param {object[]} zeilen  die zu buchenden Zeilen
 * @param {{kontoId:string, datei:string, format:string, kodierung:string, gesamt:number, von?:string, bis?:string,
 *   fortschritt?:(fertig:number, gesamt:number)=>Promise<void>|void}} opt
 */
export async function importBuchen(zeilen, { kontoId, datei, format, kodierung = '', gesamt = 0, von = '', bis = '', fortschritt = null }) {
  const importId = uid('imp');
  const ts = jetzt();
  const meta = { kontoId, importId, datei, ts };
  const erg = { importId, gebucht: 0, bezahlt: 0, mahnkosten: 0, fehler: [], uebersprungen: 0 };
  let n = 0;
  for (const z of zeilen) {
    try {
      const r = await zeileBuchen(z, meta);
      erg.gebucht += r.buchungen; erg.bezahlt += r.bezahlt; erg.mahnkosten += r.mahnkosten;
    } catch (e) {
      erg.fehler.push({ zeile: z.u.zeile, text: `${dm(z.u.datum)} ${euro(z.u.betrag)} ${z.u.gegenseite}`.trim(), grund: e.message });
    }
    n++;
    if (fortschritt && (n % 25 === 0 || n === zeilen.length)) await fortschritt(n, zeilen.length);
  }
  const rec = {
    id: importId, datei, format, kodierung, ts, kontoId, anzahl: gesamt, von, bis,
    gebucht: erg.gebucht, bezahlt: erg.bezahlt, mahnkosten: erg.mahnkosten, fehler: erg.fehler.length, createdAt: ts, updatedAt: ts,
  };
  await commit('import.abschluss', (db) => { db.imports ??= []; db.imports.push(rec); return rec; }, {
    entity: 'import', entityId: importId,
    summary: `Kontoauszug ${datei} (${format.toUpperCase()}): ${erg.gebucht} neue Buchungen, ${erg.bezahlt} Zahlungen zugeordnet${erg.fehler.length ? `, ${erg.fehler.length} nicht gebucht` : ''}`,
  });
  return erg;
}

/* -------------------------------------------------------------------------- */
/* Regeln und Vorlagen                                                         */
/* -------------------------------------------------------------------------- */

/** Speichert eine Regel „wenn … enthält …, dann Kategorie …“ im Tresor. */
export async function regelSpeichern(regel) {
  const r = { aktiv: true, richtung: 'beide', feld: 'alle', ordnung: 0, ...regel, id: regel.id || uid('rg') };
  r.name = String(r.name || '').trim() || String(r.enthaelt || '').trim();
  r.enthaelt = String(r.enthaelt || '').trim();
  if (!r.enthaelt) throw new Error('Bitte einen Suchtext eintragen.');
  if (!sel.category(r.kategorieId)) throw new Error('Bitte eine Kategorie wählen.');
  r.updatedAt = jetzt();
  r.createdAt ??= r.updatedAt;
  await commit((store.db.bankRules || []).some((x) => x.id === r.id) ? 'importregel.aendern' : 'importregel.anlegen', (db) => {
    db.bankRules ??= [];
    const i = db.bankRules.findIndex((x) => x.id === r.id);
    if (i >= 0) db.bankRules[i] = r; else { r.ordnung = r.ordnung || (Math.max(0, ...db.bankRules.map((x) => Number(x.ordnung) || 0)) + 1); db.bankRules.push(r); }
    return r;
  }, { entity: 'importregel', entityId: r.id, summary: `Regel „${r.name}“: ${r.feld} enthält „${r.enthaelt}“` });
  return r;
}

export async function regelLoeschen(id) {
  await commit('importregel.loeschen', (db) => {
    db.bankRules = (db.bankRules || []).filter((x) => x.id !== id);
    db.tombstones ??= [];
    db.tombstones.push({ collection: 'bankRules', id, deletedAt: jetzt() });
  }, { entity: 'importregel', entityId: id, summary: 'Regel gelöscht' });
}

/** Merkt sich die Spaltenzuordnung zu einer Kopfzeile (nach Überschriften, nicht nach Nummern). */
export async function vorlageSpeichern({ name, signatur, trenner, spalten, kopf, dezimal }) {
  const spaltenNachName = {};
  for (const [rolle, i] of Object.entries(spalten)) if (kopf[i] !== undefined) spaltenNachName[rolle] = kopf[i];
  const bestehende = (store.db.bankTemplates || []).find((v) => v.signatur === signatur);
  const v = {
    ...(bestehende || {}), id: bestehende?.id || uid('bv'), name: String(name || '').trim() || 'Kontoauszug', signatur, trenner, dezimal,
    spalten: spaltenNachName, updatedAt: jetzt(),
  };
  v.createdAt ??= v.updatedAt;
  await commit(bestehende ? 'importvorlage.aendern' : 'importvorlage.anlegen', (db) => {
    db.bankTemplates ??= [];
    const i = db.bankTemplates.findIndex((x) => x.id === v.id);
    if (i >= 0) db.bankTemplates[i] = v; else db.bankTemplates.push(v);
    return v;
  }, { entity: 'importvorlage', entityId: v.id, summary: `Vorlage „${v.name}“ für Kontoauszüge` });
  return v;
}

export async function vorlageLoeschen(id) {
  await commit('importvorlage.loeschen', (db) => {
    db.bankTemplates = (db.bankTemplates || []).filter((x) => x.id !== id);
    db.tombstones ??= [];
    db.tombstones.push({ collection: 'bankTemplates', id, deletedAt: jetzt() });
  }, { entity: 'importvorlage', entityId: id, summary: 'Vorlage gelöscht' });
}

/** Die gemerkte Zuordnung zu einer Kopfzeile als Spaltennummern, falls es eine gibt. */
export function vorlageFuer(signatur, kopf) {
  const v = (store.db?.bankTemplates || []).find((x) => x.signatur === signatur);
  if (!v) return null;
  const spalten = {};
  for (const [rolle, name] of Object.entries(v.spalten || {})) { const i = kopf.indexOf(name); if (i >= 0) spalten[rolle] = i; }
  return { vorlage: v, spalten, trenner: v.trenner, dezimal: v.dezimal };
}
