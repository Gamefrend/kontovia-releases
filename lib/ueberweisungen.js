/**
 * Kontovia – Fenster „Überweisungen vorbereiten“: offene Ausgaben wählen, Datei für das Online-Banking erzeugen.
 *
 * Die Liste kommt aus lib/sepa.js (ueberweisungsVorschlaege), die Datei ebenfalls (pain.001). Kontovia lädt sie nur
 * herunter; hochgeladen und mit TAN freigegeben wird sie im Online-Banking. Danach merkt sich jede Buchung, dass sie
 * in einer Datei war (`tx.ueberweisung {am, datei}`), damit nichts doppelt überwiesen wird; eine IBAN, die der Nutzer
 * eingetragen hat, merkt sich auf Wunsch der Kontakt (`contact.iban`). Bezahlt ist die Buchung erst mit dem Kontoauszug.
 * Geöffnet aus der Buchungsliste und aus Rechnungen › Eingang (jeweils erst beim Klick geladen).
 * Skonto einer Eingangsrechnung zieht lib/sepa.js innerhalb der Frist schon ab; bezahlt wird der Rest mit dem
 * Kontoauszug (lib/importaktionen.js bucht die Differenz als Skonto aus).
 */

import { esc, $, $$, money, moneyInput, parseMoney, todayISO, fmtDate, uid, dz } from './util.js';
import { modal, ok, warn, err, icon } from './ui.js';
import { store, sel, commit } from './store.js';
import { verkaeuferAus, ibanGueltig } from './rechnung.js';
import { base64 } from './pdfausgabe.js';
import {
  ueberweisungsVorschlaege, ueberweisungsDatei, ueberweisungsDateiname, postenFehler, ibanKurz,
} from './sepa.js';

const api = globalThis.window?.kontovia || {};

/** Konten, von denen überwiesen werden kann: Bankkonten mit IBAN, dazu die IBAN auf Ihren Rechnungen. */
function eigeneKonten() {
  const v = verkaeuferAus(store.db.settings);
  const liste = sel.accounts().filter((a) => a.active !== false && ibanGueltig(a.iban))
    .map((a) => ({ iban: ibanKurz(a.iban), name: a.name, bic: ibanKurz(a.iban) === v.iban ? v.bic : '' }));
  if (ibanGueltig(v.iban) && !liste.some((k) => k.iban === v.iban)) liste.unshift({ iban: v.iban, name: 'Konto auf Ihren Rechnungen', bic: v.bic });
  return { liste, inhaber: v.kontoinhaber || v.name };
}

const QUELLE = { kontakt: 'aus dem Kontakt', erechnung: 'aus der E-Rechnung', auszug: 'von einer früheren Zahlung' };

/** Unter dem Namen: „2 % Skonto bis 24.10.2026 (spart 3,00 €)“. */
const skontoHinweis = (s) => `${esc(dz(s.prozent))} % Skonto bis ${esc(fmtDate(s.bis))} (spart ${esc(money(s.abzug))} €)`;

export async function ueberweisungenDialog() {
  // Erst hier geladen: benutzer.js zieht Konten und Abgleich nach.
  const { kannSchreiben } = await import('./benutzer.js');
  if (!kannSchreiben()) { warn('Nur lesen', 'Mit Ihrer Rolle lassen sich keine Überweisungen vorbereiten.'); return; }
  const heute = todayISO();
  const zeilen = ueberweisungsVorschlaege(store.db, { heute });
  const { liste: konten, inhaber } = eigeneKonten();
  if (!zeilen.length) { ok('Nichts zu überweisen', 'Es gibt keine offenen Ausgaben in Euro.'); return; }
  if (!konten.length) {
    warn('Keine IBAN für Ihr Konto', 'Tragen Sie unter Stammdaten › Konten die IBAN Ihres Geschäftskontos ein, dann erstellt Kontovia die Datei für Ihr Online-Banking.');
    return;
  }
  // Vorausgewählt: mit IBAN, noch nicht in einer Datei, fällig in den nächsten 14 Tagen oder schon überfällig.
  const bald = new Date(Date.parse(heute) + 14 * 86400000).toISOString().slice(0, 10);
  const vorgewaehlt = (z) => !!z.iban && !z.vorbereitet && z.faellig <= bald;
  const zeile = (z, i) => `
    <tr data-i="${i}">
      <td><input type="checkbox" data-wahl aria-label="${esc(`Überweisung an ${z.name} auswählen`)}" ${vorgewaehlt(z) ? 'checked' : ''}></td>
      <td><div class="strong truncate">${esc(z.name)}</div><div class="tiny muted">${z.skonto ? skontoHinweis(z.skonto) : `fällig ${esc(fmtDate(z.faellig))}`}${z.vorbereitet ? ` · schon in einer Datei vom ${esc(fmtDate(z.vorbereitet))}` : ''}</div></td>
      <td><input data-iban value="${esc(z.iban)}" placeholder="IBAN" aria-label="${esc(`IBAN von ${z.name}`)}" spellcheck="false" autocomplete="off">
        <div class="tiny muted" data-hinweis>${esc(z.iban ? QUELLE[z.quelle] || '' : '')}</div></td>
      <td><input data-betrag inputmode="decimal" value="${esc(moneyInput(z.betrag))}" aria-label="${esc(`Betrag an ${z.name}`)}"></td>
      <td><input data-zweck value="${esc(z.zweck)}" maxlength="140" aria-label="${esc(`Verwendungszweck für ${z.name}`)}"></td>
    </tr>`;
  const m = modal({
    title: 'Überweisungen vorbereiten',
    size: 'wide',
    body: `<p class="small muted mt0">Kontovia erstellt eine Datei für Ihr Online-Banking. Dort laden Sie sie hoch, meist unter „Sammelüberweisung“
        oder „SEPA-Datei“, und geben sie mit Ihrer TAN frei. Kontovia hat keinen Zugang zu Ihrem Konto. Als bezahlt gilt eine Ausgabe,
        sobald Sie den Kontoauszug einlesen.</p>
      <div class="form-grid">
        <div class="field"><label for="ubKonto">Von Konto</label><select id="ubKonto">${konten.map((k, i) => `<option value="${i}">${esc(`${k.name} · ${k.iban.replace(/(.{4})/g, '$1 ').trim()}`)}</option>`).join('')}</select></div>
        <div class="field"><label for="ubDatum">Ausführen am</label><input type="date" id="ubDatum" value="${heute}" min="${heute}"></div>
      </div>
      <div class="table-wrap ub-liste"><table class="data">
        <thead><tr><th></th><th>Empfänger</th><th>IBAN</th><th class="right">Betrag</th><th>Verwendungszweck</th></tr></thead>
        <tbody>${zeilen.map(zeile).join('')}</tbody>
      </table></div>
      <p class="small mt8 mb0" id="ubSumme" aria-live="polite"></p>
      <label class="check mt8"><input type="checkbox" id="ubMerken" checked> Eingetragene IBAN beim Kontakt merken</label>`,
    foot: `<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('export', 15).__raw} Datei erstellen</button>`,
  });
  const reihen = () => $$('tbody tr', m.root);
  const lesen = (tr) => {
    const z = zeilen[Number(tr.dataset.i)];
    return {
      z,
      wahl: $('[data-wahl]', tr).checked,
      posten: {
        id: `KV${String(z.tx.id).replace(/^tx_/, '').slice(0, 30)}`,
        name: z.name,
        iban: ibanKurz($('[data-iban]', tr).value),
        bic: ibanKurz($('[data-iban]', tr).value) === z.iban ? z.bic : '',
        betrag: parseMoney($('[data-betrag]', tr).value),
        zweck: $('[data-zweck]', tr).value,
      },
    };
  };
  const summe = () => {
    const gew = reihen().map(lesen).filter((x) => x.wahl);
    $('#ubSumme', m.root).textContent = gew.length === 1
      ? `1 Überweisung über ${money(gew[0].posten.betrag)} €`
      : `${gew.length} Überweisungen über zusammen ${money(gew.reduce((s, x) => s + x.posten.betrag, 0))} €`;
  };
  m.root.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && e.target.matches('[data-iban]')) {
      const ib = ibanKurz(e.target.value);
      $('[data-hinweis]', tr).textContent = !ib ? '' : ibanGueltig(ib) ? (ib === zeilen[Number(tr.dataset.i)].iban ? QUELLE[zeilen[Number(tr.dataset.i)].quelle] || '' : '') : 'IBAN ungültig';
      if (ibanGueltig(ib)) $('[data-wahl]', tr).checked = true;
    }
    summe();
  });
  summe();
  $('[data-no]', m.root).addEventListener('click', () => m.close());
  $('[data-yes]', m.root).addEventListener('click', async (e) => {
    const gew = reihen().map(lesen).filter((x) => x.wahl);
    if (!gew.length) { warn('Bitte mindestens eine Überweisung wählen'); return; }
    const fehler = gew.map((x) => [x, postenFehler(x.posten)]).find(([, f]) => f);
    if (fehler) { warn(`${fehler[0].z.name}: ${fehler[1]}`, 'Bitte korrigieren oder die Zeile abwählen.'); return; }
    const konto = konten[Number($('#ubKonto', m.root).value)] || konten[0];
    const ausfuehrung = $('#ubDatum', m.root).value || heute;
    const knopf = e.currentTarget;
    knopf.disabled = true;
    try {
      const datei = ueberweisungsDatei({
        auftraggeber: { name: inhaber, iban: konto.iban, bic: konto.bic },
        ausfuehrung: ausfuehrung < heute ? heute : ausfuehrung,
        posten: gew.map((x) => x.posten),
        msgId: `KV-${uid('ub').slice(3, 21)}`,
      });
      const name = ueberweisungsDateiname(ausfuehrung);
      await api.file.download({ dataBase64: base64(new TextEncoder().encode(datei)), defaultName: name });
      await vermerken(gew, { datei: name, merken: $('#ubMerken', m.root).checked });
      m.close();
      ok(gew.length === 1 ? 'Datei mit 1 Überweisung erstellt' : `Datei mit ${gew.length} Überweisungen erstellt`, 'Laden Sie sie jetzt im Online-Banking hoch und geben Sie sie dort frei.');
    } catch (ex) {
      err('Datei nicht erstellt', ex.message);
      if (knopf.isConnected) knopf.disabled = false;
    }
  });
}

/** Hält an jeder Buchung fest, dass sie in einer Datei war; merkt neue IBANs am Kontakt, wenn gewünscht und dort noch keine steht. */
async function vermerken(gew, { datei, merken }) {
  const am = todayISO();
  const summe = gew.reduce((s, x) => s + x.posten.betrag, 0);
  await commit('ueberweisung.vorbereiten', (db) => {
    for (const { z, posten } of gew) {
      const tx = db.transactions.find((t) => t.id === z.tx.id);
      if (tx) { tx.ueberweisung = { am, datei, betrag: posten.betrag }; tx.updatedAt = new Date().toISOString(); }
      const k = merken && z.kontaktId ? db.contacts.find((c) => c.id === z.kontaktId) : null;
      if (k && !ibanGueltig(k.iban) && ibanGueltig(posten.iban)) { k.iban = posten.iban; k.updatedAt = new Date().toISOString(); }
    }
  }, { entity: 'buchung', entityId: gew[0].z.tx.id, summary: `Überweisungsdatei ${datei}: ${gew.length === 1 ? '1 Überweisung' : `${gew.length} Überweisungen`}, ${(summe / 100).toFixed(2)} €` });
}
