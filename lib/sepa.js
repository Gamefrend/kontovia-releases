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
 * Diese Datei kennt keine Oberfläche und keinen Speicher (läuft in den Prüfungen). Fenster: lib/ueberweisungen.js.
 */

import { ibanGueltig } from './rechnung.js';
import { openItems } from './calc.js';
import { todayISO } from './util.js';

const UMSCHRIFT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '&': '+' };

/** Text im SEPA-Zeichensatz, höchstens `max` Zeichen. */
export function sepaText(s, max = 140) {
  const t = String(s ?? '')
    .replace(/[äöüÄÖÜß&]/g, (c) => UMSCHRIFT[c])
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
 * Offene Ausgaben, die sich überweisen lassen, mit dem Empfänger, so gut Kontovia ihn kennt.
 * IBAN: am Kontakt, sonst aus der E-Rechnung des Lieferanten, sonst von einer früheren Zahlung laut Kontoauszug.
 * Nicht dabei: Gutschriften (negativ), Beträge in fremder Währung (SEPA ist Euro), Privates.
 * @returns {Array<{tx:object, name:string, iban:string, bic:string, quelle:string, betrag:number, zweck:string, faellig:string, vorbereitet:string, kontaktId:string}>}
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
      const zweck = String(e?.gelesen?.zweck || '').trim() || (nummer ? `Rechnung ${nummer}${rate}` : `${t.reference || t.description || ''}${rate}`);
      return {
        tx: t,
        kontaktId: k?.id || '',
        name: k?.name || e?.gelesen?.verkaeufer || t.description || '',
        iban,
        bic: quelle === 'kontakt' && bicGueltig(k?.bic) ? ibanKurz(k.bic) : '',
        quelle,
        betrag: t.gross,
        zweck: zweck.trim(),
        faellig: t.dueDate || t.date || heute,
        vorbereitet: t.ueberweisung?.am || '',
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
