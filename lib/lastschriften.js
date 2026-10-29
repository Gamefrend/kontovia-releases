/**
 * Kontovia – Fenster „Lastschriften einziehen“: offene Einnahmen von Kunden mit Mandat wählen, Datei für das
 * Online-Banking erzeugen (SEC-63).
 *
 * Die Liste kommt aus lib/sepa.js (lastschriftVorschlaege), die Datei ebenfalls (pain.008). Kontovia lädt sie nur
 * herunter; eingereicht und freigegeben wird sie im Online-Banking. Danach merkt sich jede Buchung, dass sie in einer
 * Datei war (`tx.lastschrift {am, datei, betrag, kennung, einzug}`), und das Mandat seinen letzten Einzug
 * (`contact.mandat.genutzt`, ab dann Folgelastschrift). Bezahlt ist die Buchung erst mit dem Kontoauszug; eine
 * Rücklastschrift erkennt lib/zuordnung.js an der Kennung.
 * Geöffnet aus Rechnungen › Ausgang und über die Suche (jeweils erst beim Klick geladen).
 */

import { esc, $, $$, money, moneyInput, parseMoney, todayISO, fmtDate, uid } from './util.js';
import { modal, ok, warn, err, icon } from './ui.js';
import { store, sel, commit } from './store.js';
import { verkaeuferAus, ibanGueltig } from './rechnung.js';
import { base64 } from './pdfausgabe.js';
import {
  lastschriftVorschlaege, lastschriftDatei, lastschriftDateiname, lastschriftKennung, fruehesterEinzug, glaeubigerIdGueltig, ibanKurz,
} from './sepa.js';

const api = globalThis.window?.kontovia || {};

const ART = { FRST: 'erste Lastschrift', RCUR: 'Folgelastschrift', OOFF: 'einmalige Lastschrift' };

/** Konten, auf die eingezogen werden kann: Bankkonten mit IBAN, dazu die IBAN auf Ihren Rechnungen. */
function eigeneKonten() {
  const v = verkaeuferAus(store.db.settings);
  const liste = sel.accounts().filter((a) => a.active !== false && ibanGueltig(a.iban))
    .map((a) => ({ iban: ibanKurz(a.iban), name: a.name, bic: ibanKurz(a.iban) === v.iban ? v.bic : '' }));
  if (ibanGueltig(v.iban) && !liste.some((k) => k.iban === v.iban)) liste.unshift({ iban: v.iban, name: 'Konto auf Ihren Rechnungen', bic: v.bic });
  return { liste, inhaber: v.kontoinhaber || v.name, glaeubigerId: v.glaeubigerId };
}

export async function lastschriftenDialog() {
  // Erst hier geladen: benutzer.js zieht Konten und Abgleich nach.
  const { kannSchreiben } = await import('./benutzer.js');
  if (!kannSchreiben()) { warn('Nur lesen', 'Mit Ihrer Rolle lassen sich keine Lastschriften vorbereiten.'); return; }
  const heute = todayISO();
  const { liste: konten, inhaber, glaeubigerId } = eigeneKonten();
  if (!glaeubigerIdGueltig(glaeubigerId)) {
    warn(glaeubigerId ? 'Gläubiger-Identifikationsnummer ungültig' : 'Gläubiger-Identifikationsnummer fehlt',
      'Für Lastschriften brauchen Sie eine Gläubiger-Identifikationsnummer der Bundesbank. Tragen Sie sie unter Rechnungen › Gestaltung bei Ihren Angaben ein.');
    return;
  }
  if (!konten.length) {
    warn('Keine IBAN für Ihr Konto', 'Tragen Sie unter Stammdaten › Konten die IBAN Ihres Geschäftskontos ein, dann erstellt Kontovia die Datei für Ihr Online-Banking.');
    return;
  }
  const zeilen = lastschriftVorschlaege(store.db, { heute });
  if (!zeilen.some((z) => z.mandat)) {
    ok('Keine Kunden mit Lastschriftmandat', 'Tragen Sie das Mandat beim Kontakt ein: Mandatsreferenz und den Tag, an dem Ihr Kunde es unterschrieben hat.');
    return;
  }
  const frueh = fruehesterEinzug(heute);
  // Vorausgewählt: Mandat in Ordnung, noch nicht in einer Datei, fällig bis zum frühesten Einzug plus 14 Tage.
  const bald = new Date(Date.parse(frueh) + 14 * 86400000).toISOString().slice(0, 10);
  const vorgewaehlt = (z) => !z.fehler && !z.vorbereitet && z.faellig <= bald;
  // Ohne Mandat stehen sie nur da, wenn der Kunde überhaupt eines hat (etwa ein abgelaufenes); alle anderen fehlen.
  const sichtbar = zeilen.filter((z) => z.mandat);
  const zeile = (z, i) => `
    <tr data-i="${i}">
      <td><input type="checkbox" data-wahl aria-label="${esc(`Lastschrift von ${z.name} auswählen`)}" ${vorgewaehlt(z) ? 'checked' : ''} ${z.fehler ? 'disabled' : ''}></td>
      <td><div class="strong truncate">${esc(z.name)}</div><div class="tiny muted">${esc(`fällig ${fmtDate(z.faellig)}`)}${z.vorbereitet ? esc(` · schon in einer Datei vom ${fmtDate(z.vorbereitet)}`) : ''}</div>
        ${z.fehler ? `<div class="tiny warn-text">${esc(z.fehler)}</div>` : `<div class="tiny muted">${esc(`Mandat ${z.mandat.referenz} · ${ART[z.sequenz]}`)}</div>`}</td>
      <td class="small nowrap">${esc(z.iban.replace(/(.{4})/g, '$1 ').trim())}</td>
      <td><input data-betrag inputmode="decimal" value="${esc(moneyInput(z.betrag))}" aria-label="${esc(`Betrag von ${z.name}`)}" ${z.fehler ? 'disabled' : ''}></td>
      <td><input data-zweck value="${esc(z.zweck)}" maxlength="140" aria-label="${esc(`Verwendungszweck für ${z.name}`)}" ${z.fehler ? 'disabled' : ''}></td>
    </tr>`;
  const m = modal({
    title: 'Lastschriften einziehen',
    size: 'wide',
    body: `<p class="small muted mt0">Kontovia erstellt eine Datei für Ihr Online-Banking. Dort laden Sie sie hoch, meist unter „Sammellastschrift“
        oder „SEPA-Datei“, und geben sie mit Ihrer TAN frei. Ihre Kunden müssen jede Lastschrift vorher kennen, normalerweise 14 Tage
        vorher. Steht auf der Rechnung die Zahlungsart Lastschrift, ist das schon erledigt.</p>
      <div class="form-grid">
        <div class="field"><label for="lsKonto">Auf Konto</label><select id="lsKonto">${konten.map((k, i) => `<option value="${i}">${esc(`${k.name} · ${k.iban.replace(/(.{4})/g, '$1 ').trim()}`)}</option>`).join('')}</select></div>
        <div class="field"><label for="lsDatum">Einziehen am</label><input type="date" id="lsDatum" value="${frueh}" min="${frueh}"></div>
      </div>
      <div class="table-wrap ub-liste"><table class="data">
        <thead><tr><th></th><th>Kunde</th><th>IBAN</th><th class="right">Betrag</th><th>Verwendungszweck</th></tr></thead>
        <tbody>${sichtbar.map(zeile).join('')}</tbody>
      </table></div>
      <p class="small mt8 mb0" id="lsSumme" aria-live="polite"></p>`,
    foot: `<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${icon('export', 15).__raw} Datei erstellen</button>`,
  });
  const reihen = () => $$('tbody tr', m.root);
  const lesen = (tr) => {
    const z = sichtbar[Number(tr.dataset.i)];
    return {
      z,
      wahl: $('[data-wahl]', tr).checked,
      posten: {
        id: lastschriftKennung(z.tx),
        name: z.name,
        iban: z.iban,
        bic: z.bic,
        betrag: parseMoney($('[data-betrag]', tr).value),
        zweck: $('[data-zweck]', tr).value,
        mandat: z.mandat,
        sequenz: z.sequenz,
      },
    };
  };
  const summe = () => {
    const gew = reihen().map(lesen).filter((x) => x.wahl);
    $('#lsSumme', m.root).textContent = gew.length === 1
      ? `1 Lastschrift über ${money(gew[0].posten.betrag)} €`
      : `${gew.length} Lastschriften über zusammen ${money(gew.reduce((s, x) => s + x.posten.betrag, 0))} €`;
  };
  m.root.addEventListener('input', summe);
  summe();
  $('[data-no]', m.root).addEventListener('click', () => m.close());
  $('[data-yes]', m.root).addEventListener('click', async (e) => {
    const gew = reihen().map(lesen).filter((x) => x.wahl);
    if (!gew.length) { warn('Bitte mindestens eine Lastschrift wählen'); return; }
    const zuViel = gew.find((x) => x.posten.betrag > x.z.betrag);
    if (zuViel) { warn(`${zuViel.z.name}: Betrag höher als offen`, 'Eingezogen werden darf höchstens, was die Rechnung noch offen hat.'); return; }
    const konto = konten[Number($('#lsKonto', m.root).value)] || konten[0];
    const datum = $('#lsDatum', m.root).value || frueh;
    const einzug = datum < frueh ? frueh : datum;
    const knopf = e.currentTarget;
    knopf.disabled = true;
    try {
      const datei = lastschriftDatei({
        glaeubiger: { name: inhaber, iban: konto.iban, bic: konto.bic, id: glaeubigerId },
        einzug,
        posten: gew.map((x) => x.posten),
        msgId: `KV-${uid('ls').slice(3, 21)}`,
      });
      const name = lastschriftDateiname(einzug);
      await api.file.download({ dataBase64: base64(new TextEncoder().encode(datei)), defaultName: name });
      await vermerken(gew, { datei: name, einzug });
      m.close();
      ok(gew.length === 1 ? 'Datei mit 1 Lastschrift erstellt' : `Datei mit ${gew.length} Lastschriften erstellt`, 'Laden Sie sie jetzt im Online-Banking hoch und geben Sie sie dort frei.');
    } catch (ex) {
      err('Datei nicht erstellt', ex.message);
      if (knopf.isConnected) knopf.disabled = false;
    }
  });
}

/** Hält an jeder Buchung fest, dass sie in einer Datei war, und am Mandat den Tag des Einzugs (danach Folgelastschrift). */
export async function vermerken(gew, { datei, einzug, am = todayISO() }) {
  const summe = gew.reduce((s, x) => s + x.posten.betrag, 0);
  await commit('lastschrift.vorbereiten', (db) => {
    const jetzt = new Date().toISOString();
    for (const { z, posten } of gew) {
      const tx = db.transactions.find((t) => t.id === z.tx.id);
      if (tx) { tx.lastschrift = { am, datei, einzug, betrag: posten.betrag, kennung: posten.id, mandat: posten.mandat.referenz }; tx.updatedAt = jetzt; }
      const k = db.contacts.find((c) => c.id === z.kontaktId);
      if (k?.mandat?.referenz === posten.mandat.referenz && String(k.mandat.genutzt || '') < einzug) { k.mandat = { ...k.mandat, genutzt: einzug }; k.updatedAt = jetzt; }
    }
  }, { entity: 'buchung', entityId: gew[0].z.tx.id, summary: `Lastschriftdatei ${datei}: ${gew.length === 1 ? '1 Lastschrift' : `${gew.length} Lastschriften`}, ${(summe / 100).toFixed(2)} €, Einzug am ${einzug}` });
}
