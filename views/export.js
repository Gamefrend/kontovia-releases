/** Kontovia – Export für Finanzamt, Steuerkanzlei, Betriebsprüfung und Archiv. */

import { html, raw, esc, $, $$, money, fmtDate, todayISO, int, bytes, sum } from '../lib/util.js';
import { icon, ok, err, warn, modal, confirmDialog, askPassword } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import {
  euerReport, vatReturn, isKleinunternehmer, basisOf, effectiveDate, listedOnly, unlistedStats,
} from '../lib/calc.js';
import { defaultPeriod, periodPickerHtml, wirePeriodPicker, periodLabel } from '../lib/period.js';
import { navigate } from '../lib/router.js';
import { appInfo } from '../app.js';
import * as X from '../lib/exports.js';
import * as R from '../lib/reports.js';

const api = window.kontovia;
/** Läuft Kontovia im Browser statt in Electron? (src/web/bridge.js) */
const WEB = api.platform === 'web';
const period = defaultPeriod();

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = raw(periodPickerHtml(period, 'ex')).__raw;
  wirePeriodPicker(actions, period, () => draw(root), 'ex');
  draw(root);
}

function card({ id, title, sub, body, button, tone = '' }) {
  return `
    <div class="card">
      <div class="card-head"><h3>${esc(title)}</h3><span class="sub">${esc(sub)}</span></div>
      <div class="card-body">
        <div class="small" style="color:var(--text-2);line-height:1.6">${body}</div>
        <div class="row mt16" style="gap:8px">${button}</div>
      </div>
    </div>`;
}

function draw(root) {
  // Unterlagen für Finanzamt und Kanzlei enthalten nicht gelistete Buchungen nie.
  const db = listedOnly(store.db);
  const hidden = unlistedStats(store.db, period.from, period.to);
  const klein = isKleinunternehmer(db);
  const e = euerReport(db, period.from, period.to);
  const v = vatReturn(db, period.from, period.to);
  const rows = db.transactions.filter((t) => {
    const d = effectiveDate(t, basisOf(db)) || t.date;
    return d >= period.from && d <= period.to;
  });
  const attCount = sum(rows, (t) => (t.attachments || []).length);

  root.innerHTML = html`
    <div class="page-head">
      <div>
        <h2>Export für ${esc(periodLabel(period))}</h2>
        <p>${int(rows.length)} Buchungen · ${int(attCount)} Belege · ${e.profit >= 0 ? 'EÜR-Gewinn' : 'EÜR-Verlust'} ${esc(money(e.profit))} €${klein ? '' : ` · Umsatzsteuer-Zahllast ${esc(money(v.kz83))} €`}</p>
      </div>
    </div>

    <div class="notice mb16">
      <strong>Zur Einordnung.</strong> Kontovia übermittelt nichts an die Finanzverwaltung.
      Eine direkte Abgabe über ELSTER setzt die amtliche ERiC-Schnittstelle samt
      Zertifikat voraus. Was Sie hier bekommen, sind fertig aufbereitete Werte samt
      Zeilen- und Kennzahlenangabe, die Sie in „Mein ELSTER“ nur noch eintragen –
      sowie Dateien, die eine Steuerkanzlei direkt einlesen kann. Die Werte entstehen nach
      festen Rechenregeln, nicht durch künstliche Intelligenz; einen KI-Hinweis braucht es dafür
      nicht, die Verantwortung für die Erklärung bleibt aber bei Ihnen.
      <a data-recht>Was das rechtlich bedeutet</a>
    </div>

    ${hidden.count ? raw(`<div class="notice warn mb16">
      <strong>${hidden.count === 1 ? '1 nicht gelistete Buchung' : `${int(hidden.count)} nicht gelistete Buchungen`} im Zeitraum</strong>
      (Einnahmen ${esc(money(hidden.income))} €, Ausgaben ${esc(money(hidden.expense))} €) sind in keinem dieser
      Exporte enthalten – weder in Zahlen noch in Journal, DATEV-Stapel, Prüfungsordner oder Belegen.
      Nur der Gesamtexport „Alles (JSON)“ enthält den vollständigen Bestand.
    </div>`) : ''}

    <div class="grid c2">
      ${raw(card({
        title: 'Alles für das Finanzamt', sub: 'empfohlen',
        body: `Ein Ordner mit allem, was für die Steuererklärung gebraucht wird:
          EÜR-Zeilen${klein ? '' : ', Umsatzsteuer-Kennzahlen'}, Buchungsjournal, offene Posten,
          Anlagenverzeichnis, DATEV-Stapel und eine Anleitung zum Übertragen nach ELSTER.
          ${WEB ? 'Zusätzlich die vollständigen Berichte als druckfertige Seiten, die jeder Browser öffnet und als PDF sichert.' : 'Zusätzlich die vollständigen Berichte als PDF.'}`,
        button: `<button class="btn primary" id="btnPackAll">${icon('export', 16).__raw} ${WEB ? 'Paket erstellen' : 'Ordner erstellen'}</button>
                 <button class="btn" id="btnPackCsv">Nur Tabellen (CSV)</button>`,
      }))}

      ${raw(card({
        title: 'Vollständiges Berichtspaket als PDF', sub: 'ein Dokument',
        body: `Gewinn- und Verlustrechnung, Anlage EÜR${klein ? '' : ', Umsatzsteuer-Voranmeldung'},
          Vermögensübersicht, offene Posten und das komplette Buchungsjournal –
          hintereinander in einer PDF-Datei, mit Seitenzahlen und Ihren Firmendaten im Kopf.`,
        button: `<button class="btn primary" id="btnPackPdf">${icon('pdf', 16).__raw} PDF erstellen</button>
                 <button class="btn" id="btnPackPdfPreview">${icon('eye', 16).__raw} Vorschau</button>`,
      }))}

      ${raw(card({
        title: 'Steuerkanzlei (DATEV)', sub: 'EXTF-Format 700',
        body: `Buchungsstapel im DATEV-Importformat, kodiert in ISO-8859-1.
          Verwendet die Sachkonten des ${esc(db.settings.chartOfAccounts || 'SKR03')} aus Ihren Kategorien.
          Steuerschlüssel werden bewusst nicht gesetzt – so entscheidet die Kanzlei,
          statt dass eine falsche Automatik durchläuft.`,
        button: `<button class="btn primary" id="btnDatev">${icon('file', 16).__raw} Buchungsstapel</button>`,
      }))}

      ${raw(card({
        title: 'Betriebsprüfung (GoBD)', sub: 'Datenträgerüberlassung Z3',
        body: `Alle Daten in maschinell auswertbarer Form mit beschreibender <code>index.xml</code>
          nach dem GDPdU-Beschreibungsstandard – so, wie es eine Prüferin oder ein Prüfer
          erwartet. Enthält auch das verkettete Änderungsjournal als Nachweis der
          Unveränderbarkeit.`,
        button: `<button class="btn primary" id="btnGobd">${icon('archive', 16).__raw} Prüfungsordner</button>`,
      }))}

      ${raw(card({
        title: 'Belege ausleiten', sub: `${int(attCount)} Dateien im Zeitraum`,
        body: `Alle hinterlegten Rechnungen und Quittungen des Zeitraums als einzelne Dateien,
          benannt nach Datum, Belegnummer und Beschreibung. Dazu ein Verzeichnis mit
          SHA-256-Prüfsummen. <strong>Achtung:</strong> Die Dateien liegen danach unverschlüsselt
          im Zielordner.`,
        button: `<button class="btn" id="btnAttach">${icon('paperclip', 16).__raw} Belege exportieren</button>`,
      }))}

      ${raw(card({
        title: 'Rohdaten', sub: 'CSV und JSON',
        body: `Einzelne Tabellen für die Weiterverarbeitung in Excel oder LibreOffice –
          die gelisteten Buchungen und die Kontakte. Damit lassen sich eigene Unterlagen auch
          selbst zusammenstellen. Der JSON-Export enthält den kompletten Bestand, falls Sie die
          Daten je in ein anderes Programm übernehmen wollen.`,
        button: `<button class="btn" id="btnCsvTx">Buchungen (CSV)</button>
                 <button class="btn" id="btnCsvContacts">Kontakte (CSV)</button>
                 <button class="btn" id="btnJson">Alles (JSON)</button>`,
      }))}
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>Einzelne Berichte als PDF</h3></div>
      <div class="card-body">
        <div class="row wrap" style="gap:8px">
          <button class="btn" data-pdf="guv">${icon('chart', 15)} Gewinn & Verlust</button>
          <button class="btn" data-pdf="euer">${icon('file', 15)} Anlage EÜR</button>
          ${klein ? '' : raw(`<button class="btn" data-pdf="ust">${icon('euro', 15).__raw} Umsatzsteuer-Voranmeldung</button>`)}
          <button class="btn" data-pdf="bilanz">${icon('scale', 15)} Vermögensübersicht</button>
          <button class="btn" data-pdf="opos">${icon('clock', 15)} Offene Posten</button>
          <button class="btn" data-pdf="konten">${icon('bank', 15)} Kontenblätter</button>
          <button class="btn" data-pdf="journal">${icon('book', 15)} Buchungsjournal</button>
        </div>
      </div>
    </div>`;

  wire(root, db, rows);
}

/* -------------------------------------------------------------------------- */

function wire(root, db, rows) {
  const busy = async (btn, fn) => {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Arbeite …';
    try { await fn(); } catch (e) { err('Export fehlgeschlagen', e.message); }
    btn.disabled = false;
    btn.innerHTML = label;
  };

  const recht = $('[data-recht]', root);
  recht.style.cursor = 'pointer';
  recht.style.color = 'var(--accent)';
  recht.setAttribute('role', 'link');
  recht.setAttribute('tabindex', '0');
  recht.addEventListener('click', () => navigate('help', { tab: 'recht', anker: 'export' }));

  $('#btnPackCsv', root).addEventListener('click', (e) => busy(e.target, async () => {
    const res = await api.file.saveMany({
      folderLabel: 'Zielordner für die Finanzamt-Unterlagen',
      files: X.taxOfficePack(db, period, appInfo.version),
    });
    if (res) ok('Unterlagen gespeichert', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $('#btnPackAll', root).addEventListener('click', (e) => busy(e.target, async () => {
    const files = X.taxOfficePack(db, period, appInfo.version);
    const y = period.from.slice(0, 4);
    const pdfs = [
      [R.guvReport(db, period), `Gewinn-und-Verlust_${y}.pdf`],
      [R.euerPdf(db, period), `Anlage-EUER_${y}.pdf`],
      [R.balancePdf(db, period), `Vermoegensuebersicht_${y}.pdf`],
      [R.journalPdf(db, period), `Buchungsjournal_${y}.pdf`],
    ];
    if (!isKleinunternehmer(db)) pdfs.splice(2, 0, [R.ustvaPdf(db, period), `UStVA_${y}.pdf`]);
    for (const [doc, name] of pdfs) {
      const res = await api.pdf.create({ html: doc, defaultName: name, returnBase64: true });
      // Die Web-Fassung liefert eine druckfertige HTML-Seite statt einer PDF-Datei.
      if (res?.dataBase64) files.push({ name: res.fileName || name, dataBase64: res.dataBase64 });
    }
    const res = await api.file.saveMany({ folderLabel: 'Zielordner für die Finanzamt-Unterlagen', files });
    if (res) {
      ok('Unterlagen erstellt', `${res.written.length} Dateien in ${res.dir}`);
      await api.file.reveal(res.written[0]);
    }
  }));

  $('#btnPackPdf', root).addEventListener('click', (e) => busy(e.target, async () => {
    const res = await api.pdf.create({
      html: R.yearPackPdf(db, period),
      defaultName: `Jahresunterlagen_${period.from.slice(0, 4)}.pdf`,
    });
    if (res?.path) ok('PDF erstellt', res.path);
  }));

  $('#btnPackPdfPreview', root).addEventListener('click', (e) => busy(e.target, async () => {
    await api.pdf.create({ html: R.yearPackPdf(db, period), defaultName: 'Jahresunterlagen.pdf', preview: true });
  }));

  $('#btnDatev', root).addEventListener('click', (e) => busy(e.target, async () => {
    const nums = await datevNumbersDialog(db);
    if (!nums) return;
    const text = X.datevBuchungsstapel(db, period, nums);
    const p = await api.file.save({
      defaultName: `EXTF_Buchungsstapel_${period.from.replace(/-/g, '')}_${period.to.replace(/-/g, '')}.csv`,
      filters: [{ name: 'DATEV-Buchungsstapel', extensions: ['csv'] }],
      text,
      encoding: 'latin1',
    });
    if (p) ok('Buchungsstapel gespeichert', p);
  }));

  $('#btnGobd', root).addEventListener('click', (e) => busy(e.target, async () => {
    const res = await api.file.saveMany({
      folderLabel: 'Zielordner für die Datenträgerüberlassung',
      files: X.gobdExport(db, period),
    });
    if (res) ok('Prüfungsordner erstellt', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $('#btnAttach', root).addEventListener('click', (e) => busy(e.target, async () => {
    const yes = await confirmDialog({
      title: 'Belege unverschlüsselt ausleiten?',
      text: 'Die Dateien werden im Zielordner im Klartext abgelegt. Wählen Sie einen Ort, der ausreichend geschützt ist – kein ungesicherter Cloud-Ordner und kein USB-Stick, der herumliegt.',
      confirmLabel: 'Verstanden, exportieren',
    });
    if (!yes) return;
    const files = [];
    const index = [];
    for (const t of rows) {
      for (const id of t.attachments || []) {
        const meta = sel.attachment(id);
        if (!meta) continue;
        const ext = (meta.fileName.split('.').pop() || 'bin').toLowerCase();
        const base = `${t.date}_${(t.invoiceNumber || t.id.slice(-6))}_${t.description}`.replace(/[^A-Za-z0-9äöüÄÖÜß _-]/g, '').slice(0, 90).trim();
        const name = `${base}.${ext}`;
        files.push({ name, dataBase64: await api.attach.read(id) });
        index.push([t.date, t.invoiceNumber || '', t.description, money(t.gross), name, meta.sha256]);
      }
    }
    if (!files.length) { warn('Keine Belege im Zeitraum'); return; }
    files.push({ name: '_Belegverzeichnis.csv', text: X.toCsv(['Datum', 'Beleg-Nr', 'Beschreibung', 'Betrag', 'Datei', 'SHA-256'], index) });
    const res = await api.file.saveMany({ folderLabel: 'Zielordner für die Belege', files });
    if (res) ok('Belege exportiert', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $('#btnCsvTx', root).addEventListener('click', (e) => busy(e.target, async () => {
    const p = await api.file.save({
      defaultName: `Buchungen_${period.from}_${period.to}.csv`,
      filters: [{ name: 'CSV-Tabelle', extensions: ['csv'] }],
      text: X.transactionsCsv(db, rows),
    });
    if (p) ok('Tabelle gespeichert', p);
  }));

  $('#btnCsvContacts', root).addEventListener('click', (e) => busy(e.target, async () => {
    const p = await api.file.save({ defaultName: 'Kontakte.csv', filters: [{ name: 'CSV-Tabelle', extensions: ['csv'] }], text: X.contactsCsv(db) });
    if (p) ok('Tabelle gespeichert', p);
  }));

  $('#btnJson', root).addEventListener('click', (e) => busy(e.target, async () => {
    const yes = await confirmDialog({
      title: 'Unverschlüsselten Gesamtexport erstellen?',
      text: 'Die JSON-Datei enthält Ihre komplette Buchhaltung im Klartext – ohne Belege, aber mit allen Beträgen, Kontakten und Notizen. Für eine Sicherung nehmen Sie besser die verschlüsselte Vollsicherung unter Einstellungen.',
      confirmLabel: 'Trotzdem exportieren', danger: true,
    });
    if (!yes) return;
    // Der Gesamtexport ist der vollständige Bestand – auch nicht gelistete Buchungen.
    const p = await api.file.save({ defaultName: `Kontovia-Daten_${todayISO()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }], text: X.jsonExport(store.db) });
    if (p) ok('Export gespeichert', p);
  }));

  $$('[data-pdf]', root).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const y = period.from.slice(0, 4);
    const map = {
      guv: [R.guvReport(db, period), `Gewinn-und-Verlust_${y}.pdf`],
      euer: [R.euerPdf(db, period), `Anlage-EUER_${y}.pdf`],
      ust: [R.ustvaPdf(db, period), `UStVA_${period.from}_${period.to}.pdf`],
      bilanz: [R.balancePdf(db, period), `Vermoegensuebersicht_${period.to}.pdf`],
      opos: [R.openItemsPdf(db, todayISO()), `Offene-Posten_${todayISO()}.pdf`],
      konten: [R.accountsPdf(db, period), `Kontenblaetter_${y}.pdf`],
      journal: [R.journalPdf(db, period), `Buchungsjournal_${y}.pdf`],
    };
    const [doc, name] = map[b.dataset.pdf];
    const res = await api.pdf.create({ html: doc, defaultName: name });
    if (res?.path) ok('PDF gespeichert', res.path);
  })));
}

/* -------------------------------------------------------------------------- */

function datevNumbersDialog(db) {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Angaben für DATEV',
      size: 'slim',
      body: html`
        <p class="mt0 small muted">Ihre Steuerkanzlei nennt Ihnen Berater- und Mandantennummer.
        Ohne die richtigen Nummern lässt sich der Stapel dort nicht dem Mandat zuordnen.</p>
        <div class="field"><label>Beraternummer</label><input id="d_berater" value="${esc(db.settings.datevBerater || '')}" placeholder="z. B. 12345"></div>
        <div class="field"><label>Mandantennummer</label><input id="d_mandant" value="${esc(db.settings.datevMandant || '')}" placeholder="z. B. 6789"></div>
        <label class="check"><input type="checkbox" id="d_save" checked> Nummern für das nächste Mal merken</label>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Stapel erzeugen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const beraterNr = m.root.querySelector('#d_berater').value.trim() || '1';
      const mandantNr = m.root.querySelector('#d_mandant').value.trim() || '1';
      if (m.root.querySelector('#d_save').checked) {
        const { commit } = await import('../lib/store.js');
        await commit('einstellung.datev', (d) => { d.settings.datevBerater = beraterNr; d.settings.datevMandant = mandantNr; }, { silent: true });
      }
      settled = true;
      m.close();
      resolve({ beraterNr, mandantNr });
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}
