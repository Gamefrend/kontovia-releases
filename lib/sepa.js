/**
 * Kontovia – Überweisungen als SEPA-Datei (pain.001) für das Online-Banking.
 *
 * Aus offenen Ausgaben (Eingangsrechnungen, Raten, Lieferanten) wird eine Sammelüberweisung, die der Nutzer im
 * Online-Banking seiner Bank hochlädt und dort mit TAN freigibt. Kontovia spricht nie selbst mit der Bank: kein Netz,
 * keine Zugangsdaten. Bezahlt ist eine Ausgabe erst, wenn der Kontoauszug die Zahlung zeigt (lib/zuordnung.js).
 *
 * Format: ISO 20022 pain.001.001.09 nach der Anlage 3 der DFÜ-Vereinbarung der Deutschen Kreditwirtschaft (SEPA,
 * Euro, Entgelt geteilt SLEV). Texte im Zeichensatz des EPC (Buchstaben ohne Umlaute, Ziffern, / - ? : ( ) . , ' +
 * und Leerzeichen): Umlaute werden umschrieben, alles andere wird Leerzeichen. Name höchstens 70, Verwendungszweck
 * höchstens 140, Kennungen höchstens 35 Zeichen. Die BIC darf fehlen (IBAN-only).
 *
 * Lastschriften (SEC-63): offene Einnahmen von Kunden mit Mandat (`contact.mandat`) werden eine Datei pain.008.001.08
 * (SEPA-Basislastschrift CORE, Anlage 3 der DFÜ-Vereinbarung), die der Nutzer genauso im Online-Banking einreicht.
 * Dazu Gläubiger-Identifikationsnummer und Mandatspflichten (Referenz, Unterschrift, 36 Monate ohne Nutzung).
 *
 * Diese Datei kennt keine Oberfläche und keinen Speicher (läuft in den Prüfungen). Fenster: lib/ueberweisungen.js,
 * lib/lastschriften.js.
 */

import { ibanGueltig, glaeubigerIdGueltig } from './rechnung.js';
import { openItems } from './calc.js';
import { todayISO, addDays, addMonths } from './util.js';
import { naechsterWerktag } from './fristen.js';

// „%“ fehlt im Zeichensatz: „2 % Skonto“ wird „2 Prozent Skonto“.
const UMSCHRIFT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '&': '+', '%': ' Prozent ' };

/** Text im SEPA-Zeichensatz, höchstens `max` Zeichen. */
export function sepaText(s, max = 140) {
  const t = String(s ?? '')
    .replace(/[äöüÄÖÜß&%]/g, (c) => UMSCHRIFT[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, max).trim();
}

export const ibanKurz = (s) => String(s || '').replace(/\s/g, '').toUpperCase();
export const bicGueltig = (s) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(ibanKurz(s));
const betrag = (cent) => (Math.round(cent) / 100).toFixed(2);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const el = (name, inhalt) => `<${name}>${inhalt}</${name}>`;

/**
 * Skonto einer Eingangsrechnung (`invoices` mit `richtung: 'eingang'`, Felder `skontoTage`, `skontoProzent` wie bei der
 * Ausgangsrechnung) für ihre offene Buchung: Frist ab Rechnungsdatum, Abzug in Cent vom Bruttobetrag der Buchung oder,
 * wenn die E-Rechnung einen kleineren Basisbetrag nennt (`skontoBasis`, Cent, etwa nach einer Anzahlung), von diesem.
 * @returns {{prozent:number, tage:number, bis:string, abzug:number}|null}  null ohne Skonto
 */
export function skontoEingang(e, tx) {
  const prozent = Number(e?.skontoProzent) || 0;
  const tage = Math.round(Number(e?.skontoTage) || 0);
  const bis = skontoFristEnde(e, tx);
  if (!(prozent > 0 && prozent < 100) || !bis || !(tx?.gross > 0)) return null;
  const basisAngabe = Math.round(Number(e?.skontoBasis) || 0);
  const basis = basisAngabe > 0 && basisAngabe <= tx.gross ? basisAngabe : tx.gross;
  return { prozent, tage, bis, abzug: Math.round((basis * prozent) / 100) };
}

/** Letzter Tag der Skontofrist: Rechnungsdatum (aus der E-Rechnung, sonst das der Buchung) plus Tage; ohne Frist ''. */
export function skontoFristEnde(e, tx) {
  const tage = Math.round(Number(e?.skontoTage) || 0);
  const start = e?.gelesen?.datum || tx?.date || '';
  return tage > 0 && Number(e?.skontoProzent) > 0 && start ? addDays(start, tage) : '';
}

/** „abzüglich 2 % Skonto“ (Prozent mit Komma, wie auf der Rechnung). */
export const skontoZweck = (prozent) => `abzüglich ${String(prozent).replace('.', ',')} % Skonto`;

/**
 * Offene Ausgaben, die sich überweisen lassen, mit dem Empfänger, so gut Kontovia ihn kennt.
 * IBAN: am Kontakt, sonst aus der E-Rechnung des Lieferanten, sonst von einer früheren Zahlung laut Kontoauszug.
 * Nicht dabei: Gutschriften (negativ), Beträge in fremder Währung (SEPA ist Euro), Privates.
 * Skonto der Eingangsrechnung: bis zum Ende der Frist der gekürzte Betrag mit „abzüglich x % Skonto“ im Zweck und die
 * Frist als Fälligkeit, danach der volle Betrag.
 * @returns {Array<{tx:object, name:string, iban:string, bic:string, quelle:string, betrag:number, zweck:string, faellig:string, vorbereitet:string, kontaktId:string, skonto:object|null}>}
 */
export function ueberweisungsVorschlaege(db, { heute = todayISO() } = {}) {
  const kontakte = new Map((db.contacts || []).map((c) => [c.id, c]));
  const eingang = new Map((db.invoices || []).filter((i) => i.richtung === 'eingang' && i.transactionId).map((i) => [i.transactionId, i]));
  // Zuletzt bekannte IBAN je Kontakt aus eingelesenen Kontoauszügen (bezahlte Ausgaben).
  const frueher = new Map();
  for (const t of [...(db.transactions || [])].sort((a, b) => String(a.paidDate || a.date).localeCompare(String(b.paidDate || b.date)))) {
    const ib = ibanKurz(t.import?.gegenIban);
    if (t.type === 'expense' && t.contactId && ib && ibanGueltig(ib)) frueher.set(t.contactId, ib);
  }
  // Auch künftige Fälligkeiten: offen ist, was gebucht und nicht bezahlt ist, egal wann es fällig wird.
  const offen = openItems(db, '9999-12-31').payables;
  return offen
    .filter((t) => t.gross > 0 && !t.fremd && !t.unlisted)
    .map((t) => {
      const k = kontakte.get(t.contactId) || null;
      const e = eingang.get(t.id) || null;
      const kandidaten = [[k?.iban, 'kontakt'], [e?.gelesen?.iban, 'erechnung'], [frueher.get(t.contactId), 'auszug']]
        .map(([ib, q]) => [ibanKurz(ib), q]).filter(([ib]) => ib && ibanGueltig(ib));
      const [iban, quelle] = kandidaten[0] || ['', ''];
      const nummer = String(t.invoiceNumber || e?.gelesen?.nummer || '').trim();
      const rate = t.rate && t.raten ? ` Rate ${t.rate}/${t.raten}` : '';
      let zweck = (String(e?.gelesen?.zweck || '').trim() || (nummer ? `Rechnung ${nummer}${rate}` : `${t.reference || t.description || ''}${rate}`)).trim();
      const faellig = t.dueDate || t.date || heute;
      // Skonto nur innerhalb der Frist (bis einschließlich zum letzten Tag).
      const sk = skontoEingang(e, t);
      const skonto = sk && heute <= sk.bis ? sk : null;
      if (skonto) {
        // Platz für den Zusatz so, wie er in der Datei steht („abzueglich 2 Prozent Skonto“); nur ein zu langer Zweck wird gekürzt.
        const zusatz = skontoZweck(skonto.prozent);
        const platz = 140 - sepaText(zusatz).length - 1;
        if (sepaText(zweck, 1000).length > platz) zweck = sepaText(zweck, platz);
        zweck = `${zweck} ${zusatz}`.trim();
      }
      return {
        tx: t,
        kontaktId: k?.id || '',
        name: k?.name || e?.gelesen?.verkaeufer || t.description || '',
        iban,
        bic: quelle === 'kontakt' && bicGueltig(k?.bic) ? ibanKurz(k.bic) : '',
        quelle,
        betrag: skonto ? t.gross - skonto.abzug : t.gross,
        zweck,
        faellig: skonto && skonto.bis < faellig ? skonto.bis : faellig,
        vorbereitet: t.ueberweisung?.am || '',
        skonto,
      };
    })
    .sort((a, b) => a.faellig.localeCompare(b.faellig) || a.name.localeCompare(b.name));
}

/**
 * Was an einem Posten fehlt, bevor er in die Datei darf.
 * @returns {string} leer, wenn alles passt
 */
export function postenFehler(p) {
  if (!sepaText(p.name, 70)) return 'Name des Empfängers fehlt';
  if (!ibanGueltig(p.iban)) return p.iban ? 'IBAN ungültig' : 'IBAN fehlt';
  if (p.bic && !bicGueltig(p.bic)) return 'BIC ungültig';
  if (!(Math.round(p.betrag) > 0)) return 'Betrag fehlt';
  if (Math.round(p.betrag) > 99999999999) return 'Betrag zu hoch';
  return '';
}

/**
 * Die Datei pain.001.001.09 als Text.
 * @param {{auftraggeber:{name:string, iban:string, bic?:string}, ausfuehrung:string, posten:Array<{name:string, iban:string, bic?:string, betrag:number, zweck:string, id:string}>, msgId:string, jetzt?:Date}} a
 */
export function ueberweisungsDatei({ auftraggeber, ausfuehrung, posten, msgId, jetzt = new Date() }) {
  if (!ibanGueltig(auftraggeber?.iban)) throw new Error('Die IBAN Ihres Kontos ist ungültig.');
  if (!sepaText(auftraggeber?.name, 70)) throw new Error('Ihr Name oder Firmenname fehlt.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ausfuehrung || ''))) throw new Error('Das Ausführungsdatum fehlt.');
  if (!posten?.length) throw new Error('Keine Überweisung ausgewählt.');
  for (const p of posten) {
    const f = postenFehler(p);
    if (f) throw new Error(`${p.name || 'Ein Posten'}: ${f}.`);
  }
  const summe = posten.reduce((s, p) => s + Math.round(p.betrag), 0);
  const id = sepaText(msgId, 35).replace(/ /g, '-');
  const zeit = new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const bank = (bic) => (bicGueltig(bic) ? el('FinInstnId', el('BICFI', ibanKurz(bic))) : el('FinInstnId', el('Othr', el('Id', 'NOTPROVIDED'))));
  const name = xml(sepaText(auftraggeber.name, 70));
  const tx = posten.map((p) => el('CdtTrfTxInf', [
    el('PmtId', el('EndToEndId', xml(sepaText(p.id, 35).replace(/ /g, '-') || 'NOTPROVIDED'))),
    el('Amt', `<InstdAmt Ccy="EUR">${betrag(p.betrag)}</InstdAmt>`),
    bicGueltig(p.bic) ? el('CdtrAgt', bank(p.bic)) : '',
    el('Cdtr', el('Nm', xml(sepaText(p.name, 70)))),
    el('CdtrAcct', el('Id', el('IBAN', ibanKurz(p.iban)))),
    sepaText(p.zweck, 140) ? el('RmtInf', el('Ustrd', xml(sepaText(p.zweck, 140)))) : '',
  ].join(''))).join('');
  const doc = el('CstmrCdtTrfInitn', [
    el('GrpHdr', [el('MsgId', xml(id)), el('CreDtTm', zeit), el('NbOfTxs', String(posten.length)), el('CtrlSum', betrag(summe)), el('InitgPty', el('Nm', name))].join('')),
    el('PmtInf', [
      el('PmtInfId', xml(id)), el('PmtMtd', 'TRF'), el('BtchBookg', 'true'), el('NbOfTxs', String(posten.length)), el('CtrlSum', betrag(summe)),
      el('PmtTpInf', el('SvcLvl', el('Cd', 'SEPA'))),
      el('ReqdExctnDt', el('Dt', ausfuehrung)),
      el('Dbtr', el('Nm', name)),
      el('DbtrAcct', el('Id', el('IBAN', ibanKurz(auftraggeber.iban)))),
      el('DbtrAgt', bank(auftraggeber.bic)),
      el('ChrgBr', 'SLEV'),
      tx,
    ].join('')),
  ].join(''));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${doc}</Document>\n`;
}

/** Dateiname: Ueberweisungen_2026-10-20.xml */
export const ueberweisungsDateiname = (ausfuehrung) => `Ueberweisungen_${ausfuehrung}.xml`;

/* -------------------------------------------------------------------------- */
/* Lastschriften (pain.008)                                                    */
/* -------------------------------------------------------------------------- */

export { glaeubigerIdGueltig };

/** Mandatsreferenz: höchstens 35 Zeichen, nur Buchstaben ohne Umlaute, Ziffern und + ? / - : ( ) . , ' (ohne Leerzeichen). */
export const mandatsreferenzGueltig = (s) => /^[A-Za-z0-9+?/\-:().,']{1,35}$/.test(String(s || ''));

/** Wie lange ein Mandat ohne Lastschrift gilt (EPC-Regelwerk): 36 Monate nach der letzten Nutzung oder der Unterschrift. */
export const MANDAT_MONATE = 36;

/** Bis wann ein Mandat gilt; leer ohne Unterschriftsdatum. */
export function mandatGueltigBis(m) {
  const ab = [m?.genutzt, m?.datum].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))).sort().pop();
  return ab ? addMonths(ab, MANDAT_MONATE) : '';
}

/**
 * Was am Mandat eines Kontakts fehlt, bevor eingezogen werden darf.
 * @param {object} c  Kontakt mit `mandat {referenz, datum, einmalig, genutzt}`, `iban`, `name`
 * @returns {string} leer, wenn alles passt
 */
export function mandatFehler(c, { heute = todayISO() } = {}) {
  const m = c?.mandat;
  if (!m?.referenz) return 'Kein Lastschriftmandat';
  if (!mandatsreferenzGueltig(m.referenz)) return 'Mandatsreferenz ungültig';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.datum || ''))) return 'Datum der Unterschrift fehlt';
  if (m.datum > heute) return 'Mandat ist erst ab dem Tag der Unterschrift gültig';
  if (m.widerrufen) return 'Mandat ist widerrufen';
  if (m.einmalig && m.genutzt) return 'Mandat für eine einzige Lastschrift ist schon genutzt';
  if (mandatGueltigBis(m) < heute) return `Mandat seit ${MANDAT_MONATE} Monaten nicht genutzt und damit erloschen`;
  if (!ibanGueltig(c.iban)) return c.iban ? 'IBAN des Kunden ungültig' : 'IBAN des Kunden fehlt';
  return '';
}

/** Lastschriftart je Mandat: einmalig OOFF, erste FRST, danach RCUR. */
export const sequenz = (m) => (m?.einmalig ? 'OOFF' : m?.genutzt ? 'RCUR' : 'FRST');

/** Frühester Tag, an dem eine Lastschrift eingezogen werden kann: der nächste Bankarbeitstag nach heute. */
export const fruehesterEinzug = (heute = todayISO()) => naechsterWerktag(addDays(heute, 1));

/** Kennung einer Lastschrift in der Datei und später auf dem Kontoauszug des Kunden (Ende-zu-Ende-Referenz). */
export const lastschriftKennung = (tx) => `KV${String(tx?.id || '').replace(/^tx_/, '').slice(0, 30)}`;

/**
 * Offene Einnahmen, die sich per Lastschrift einziehen lassen: Kunde mit Kontakt, alles in Euro.
 * Ohne gültiges Mandat bleiben sie in der Liste, mit dem Grund (`fehler`), damit der Nutzer sieht, was fehlt.
 * Nicht dabei: Gutschriften (negativ), Beträge in fremder Währung, Privates, Buchungen ohne Kontakt.
 * @returns {Array<{tx:object, kontaktId:string, name:string, iban:string, bic:string, betrag:number, zweck:string, faellig:string, vorbereitet:string, mandat:object|null, sequenz:string, fehler:string}>}
 */
export function lastschriftVorschlaege(db, { heute = todayISO() } = {}) {
  const kontakte = new Map((db.contacts || []).map((c) => [c.id, c]));
  const rechnungZu = new Map();
  for (const r of db.invoices || []) if (r.richtung !== 'eingang') for (const id of r.transactionIds || []) rechnungZu.set(id, r);
  return openItems(db, '9999-12-31').receivables
    .filter((t) => t.gross > 0 && !t.fremd && !t.unlisted && t.contactId && kontakte.has(t.contactId))
    .map((t) => {
      const k = kontakte.get(t.contactId);
      const r = rechnungZu.get(t.id);
      const nummer = String(r?.nummer || t.invoiceNumber || '').trim();
      const rate = t.rate && t.raten ? ` Rate ${t.rate}/${t.raten}` : '';
      return {
        tx: t,
        kontaktId: k.id,
        name: k.name || '',
        iban: ibanKurz(k.iban),
        bic: bicGueltig(k.bic) ? ibanKurz(k.bic) : '',
        betrag: t.gross,
        zweck: `${nummer ? `Rechnung ${nummer}` : t.reference || t.description || ''}${rate}`.trim(),
        faellig: t.dueDate || t.date || heute,
        vorbereitet: t.lastschrift?.am || '',
        mandat: k.mandat?.referenz ? k.mandat : null,
        sequenz: sequenz(k.mandat),
        fehler: mandatFehler(k, { heute }),
      };
    })
    .sort((a, b) => a.faellig.localeCompare(b.faellig) || a.name.localeCompare(b.name));
}

/**
 * Die Datei pain.008.001.08 als Text. Je Lastschriftart (FRST, RCUR, OOFF) ein Auftrag, wie die Banken es verlangen.
 * @param {{glaeubiger:{name:string, iban:string, bic?:string, id:string}, einzug:string, posten:Array<{id:string, name:string, iban:string, bic?:string, betrag:number, zweck:string, mandat:{referenz:string, datum:string}, sequenz:string}>, msgId:string, jetzt?:Date}} a
 */
export function lastschriftDatei({ glaeubiger, einzug, posten, msgId, jetzt = new Date() }) {
  if (!ibanGueltig(glaeubiger?.iban)) throw new Error('Die IBAN Ihres Kontos ist ungültig.');
  if (!sepaText(glaeubiger?.name, 70)) throw new Error('Ihr Name oder Firmenname fehlt.');
  if (!glaeubigerIdGueltig(glaeubiger?.id)) throw new Error(glaeubiger?.id ? 'Ihre Gläubiger-Identifikationsnummer ist ungültig.' : 'Ihre Gläubiger-Identifikationsnummer fehlt.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(einzug || ''))) throw new Error('Das Datum für den Einzug fehlt.');
  if (!posten?.length) throw new Error('Keine Lastschrift ausgewählt.');
  for (const p of posten) {
    const f = postenFehler(p) || (!mandatsreferenzGueltig(p.mandat?.referenz) ? 'Mandatsreferenz ungültig' : '')
      || (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.mandat?.datum || '')) ? 'Datum der Unterschrift fehlt' : '')
      || (!['FRST', 'RCUR', 'OOFF'].includes(p.sequenz) ? 'Lastschriftart fehlt' : '');
    if (f) throw new Error(`${p.name || 'Ein Posten'}: ${f}.`);
  }
  const summe = (liste) => liste.reduce((s, p) => s + Math.round(p.betrag), 0);
  const id = sepaText(msgId, 35).replace(/ /g, '-');
  const zeit = new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const bank = (bic) => (bicGueltig(bic) ? el('FinInstnId', el('BICFI', ibanKurz(bic))) : el('FinInstnId', el('Othr', el('Id', 'NOTPROVIDED'))));
  const name = xml(sepaText(glaeubiger.name, 70));
  const auftraege = ['FRST', 'RCUR', 'OOFF'].map((seq) => [seq, posten.filter((p) => p.sequenz === seq)]).filter(([, l]) => l.length).map(([seq, liste]) => el('PmtInf', [
    el('PmtInfId', xml(`${id.slice(0, 30)}-${seq}`)), el('PmtMtd', 'DD'), el('BtchBookg', 'true'), el('NbOfTxs', String(liste.length)), el('CtrlSum', betrag(summe(liste))),
    el('PmtTpInf', [el('SvcLvl', el('Cd', 'SEPA')), el('LclInstrm', el('Cd', 'CORE')), el('SeqTp', seq)].join('')),
    el('ReqdColltnDt', einzug),
    el('Cdtr', el('Nm', name)),
    el('CdtrAcct', el('Id', el('IBAN', ibanKurz(glaeubiger.iban)))),
    el('CdtrAgt', bank(glaeubiger.bic)),
    el('ChrgBr', 'SLEV'),
    el('CdtrSchmeId', el('Id', el('PrvtId', el('Othr', el('Id', ibanKurz(glaeubiger.id)) + el('SchmeNm', el('Prtry', 'SEPA')))))),
    liste.map((p) => el('DrctDbtTxInf', [
      el('PmtId', el('EndToEndId', xml(sepaText(p.id, 35).replace(/ /g, '-') || 'NOTPROVIDED'))),
      `<InstdAmt Ccy="EUR">${betrag(p.betrag)}</InstdAmt>`,
      el('DrctDbtTx', el('MndtRltdInf', el('MndtId', xml(p.mandat.referenz)) + el('DtOfSgntr', p.mandat.datum))),
      el('DbtrAgt', bank(p.bic)),
      el('Dbtr', el('Nm', xml(sepaText(p.name, 70)))),
      el('DbtrAcct', el('Id', el('IBAN', ibanKurz(p.iban)))),
      sepaText(p.zweck, 140) ? el('RmtInf', el('Ustrd', xml(sepaText(p.zweck, 140)))) : '',
    ].join(''))).join(''),
  ].join(''))).join('');
  const doc = el('CstmrDrctDbtInitn', [
    el('GrpHdr', [el('MsgId', xml(id)), el('CreDtTm', zeit), el('NbOfTxs', String(posten.length)), el('CtrlSum', betrag(summe(posten))), el('InitgPty', el('Nm', name))].join('')),
    auftraege,
  ].join(''));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${doc}</Document>\n`;
}

/** Dateiname: Lastschriften_2026-11-02.xml */
export const lastschriftDateiname = (einzug) => `Lastschriften_${einzug}.xml`;

/**
 * Liest eine Lastschriftdatei zurück (für die Prüfung und zum Nachsehen): Kopf, Aufträge, Lastschriften.
 * @returns {{msgId:string, anzahl:number, summe:number, auftraege:Array<{seq:string, einzug:string, glaeubigerId:string, iban:string, posten:Array<{id:string, betrag:number, mandat:string, datum:string, name:string, iban:string, zweck:string}>}>}}
 */
export function lastschriftDateiLesen(text) {
  const s = String(text || '');
  if (!s.includes('urn:iso:std:iso:20022:tech:xsd:pain.008.001.08')) throw new Error('Keine Lastschriftdatei (pain.008.001.08).');
  const ein = (t, name) => (t.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1] || '';
  const alle = (t, name) => [...t.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
  const cent = (v) => Math.round(Number(v) * 100);
  const kopf = alle(s, 'GrpHdr')[0] || '';
  return {
    msgId: ein(kopf, 'MsgId'),
    anzahl: Number(ein(kopf, 'NbOfTxs')),
    summe: cent(ein(kopf, 'CtrlSum')),
    auftraege: alle(s, 'PmtInf').map((a) => ({
      seq: ein(a, 'SeqTp'),
      einzug: ein(a, 'ReqdColltnDt'),
      anzahl: Number(ein(a, 'NbOfTxs')),
      summe: cent(ein(a, 'CtrlSum')),
      glaeubigerId: ein(alle(a, 'CdtrSchmeId')[0] || '', 'Id'),
      iban: ein(alle(a, 'CdtrAcct')[0] || '', 'IBAN'),
      posten: alle(a, 'DrctDbtTxInf').map((p) => ({
        id: ein(p, 'EndToEndId'),
        betrag: cent((p.match(/<InstdAmt Ccy="EUR">([^<]*)<\/InstdAmt>/) || [])[1]),
        mandat: ein(p, 'MndtId'),
        datum: ein(p, 'DtOfSgntr'),
        name: ein(alle(p, 'Dbtr')[0] || '', 'Nm'),
        iban: ein(alle(p, 'DbtrAcct')[0] || '', 'IBAN'),
        zweck: ein(p, 'Ustrd'),
      })),
    })),
  };
}
