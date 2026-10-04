/** Kontovia – Export für Finanzamt, Steuerkanzlei, Betriebsprüfung und Archiv. */

import { html, raw, esc, $, $$, money, todayISO, int, sum } from '../lib/util.js';
import { icon, ok, err, warn, modal, confirmDialog } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import {
  euerReport, vatReturn, isKleinunternehmer, basisOf, effectiveDate, listedOnly, unlistedStats,
} from '../lib/calc.js';
import { defaultPeriod, periodControl, periodLabel, setPeriod } from '../lib/period.js';
import { navigate } from '../lib/router.js';
import { appInfo } from '../app.js';
import * as X from '../lib/exports.js';
import * as R from '../lib/reports.js';
import { pdfSpeichern, pdfZeigen, pdfFuerPaket } from '../lib/pdfausgabe.js';

const api = window.kontovia;
const period = defaultPeriod();

export async function render(root, params, { actions } = {}) {
  if (params?.period?.from && params?.period?.to) setPeriod(period, params.period.from, params.period.to);
  actions.innerHTML = '<div id="exPeriod"></div>';
  periodControl($('#exPeriod', actions), period, () => draw(root));
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
  // Unterlagen für Finanzamt und Kanzlei enthalten private Buchungen nie.
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
        <h2>Export für ${periodLabel(period)}</h2>
        <p>${int(rows.length)} Buchungen · ${int(attCount)} Belege · ${e.profit >= 0 ? 'EÜR-Gewinn' : 'EÜR-Verlust'} ${money(e.profit)} €${klein ? '' : ` · Umsatzsteuer-Zahllast ${esc(money(v.kz83))} €`}</p>
      </div>
    </div>

    <div class="notice mb16">
      <strong>Zur Einordnung.</strong> Kontovia übermittelt nichts an die Finanzverwaltung.
      Sie bekommen hier fertig aufbereitete Werte samt Zeilen- und Kennzahlenangabe, die Sie
      in „Mein ELSTER“ nur noch eintragen, dazu Dateien, die eine Steuerkanzlei direkt
      einlesen kann. Die Werte entstehen nach festen Rechenregeln, nicht durch künstliche
      Intelligenz; die Verantwortung für die Erklärung bleibt bei Ihnen.
      <a data-recht>Was das rechtlich bedeutet</a>
    </div>

    ${hidden.count ? raw(`<div class="notice warn mb16">
      <strong>${hidden.count === 1 ? '1 private Buchung' : `${int(hidden.count)} private Buchungen`} im Zeitraum</strong>
      (Einnahmen ${esc(money(hidden.income))} €, Ausgaben ${esc(money(hidden.expense))} €) sind in keinem dieser
      Exporte enthalten, weder in Zahlen noch im Journal, im DATEV-Stapel, im Prüfungsordner oder in den Belegen.
      Nur der Gesamtexport „Alles (JSON)“ enthält den vollständigen Bestand.
    </div>`) : ''}

    <div class="grid c2">
      ${raw(card({
        title: 'Alles für das Finanzamt', sub: 'empfohlen',
        body: `Ein Ordner mit allem, was für die Steuererklärung gebraucht wird:
          EÜR-Zeilen${klein ? '' : ', Umsatzsteuer-Kennzahlen'}, Buchungsjournal, offene Posten,
          Anlagenverzeichnis, DATEV-Stapel und eine Anleitung zum Übertragen nach ELSTER.
          Zusätzlich die vollständigen Berichte als PDF.`,
        button: `<button class="btn primary" id="btnPackAll">${icon('export', 16).__raw} Paket erstellen</button>
                 <button class="btn" id="btnPackCsv">Nur Tabellen (CSV)</button>`,
      }))}

      ${raw(card({
        title: 'Vollständiges Berichtspaket als PDF', sub: 'ein Dokument',
        body: `Gewinn- und Verlustrechnung, Anlage EÜR${klein ? '' : ', Umsatzsteuer-Voranmeldung'},
          Vermögensübersicht, offene Posten und das komplette Buchungsjournal,
          hintereinander in einer PDF-Datei, mit Seitenzahlen und Ihren Firmendaten im Kopf.`,
        button: `<button class="btn primary" id="btnPackPdf">${icon('pdf', 16).__raw} PDF erstellen</button>
                 <button class="btn" id="btnPackPdfPreview">${icon('eye', 16).__raw} Vorschau</button>`,
      }))}

      ${raw(card({
        title: 'Steuerkanzlei (DATEV)', sub: 'EXTF-Format 700',
        body: `Buchungsstapel im DATEV-Importformat, je Wirtschaftsjahr eine Datei.
          Verwendet die Sachkonten des ${esc(db.settings.chartOfAccounts || 'SKR03')} aus Ihren Kategorien und bucht
          ${basisOf(db) === 'soll' && !klein ? 'Rechnungen über Sammeldebitor und -kreditor, Zahlungen aufs Geldkonto' : 'nach Zahlungsdatum gegen das Geldkonto'}.
          Steuerschlüssel für Konten ohne Automatik lassen sich auf Wunsch mitgeben.`,
        button: `<button class="btn primary" id="btnDatev">${icon('file', 16).__raw} Buchungsstapel</button>`,
      }))}

      ${raw(card({
        title: 'Betriebsprüfung (GoBD)', sub: 'Datenträgerüberlassung Z3',
        body: `Alle Daten in maschinell auswertbarer Form mit beschreibender <code>index.xml</code>
          nach dem GDPdU-Beschreibungsstandard, so wie es eine Prüferin oder ein Prüfer
          erwartet. Enthält auch das verkettete Änderungsjournal als Nachweis der
          Unveränderbarkeit.`,
        button: `<button class="btn primary" id="btnGobd">${icon('archive', 16).__raw} Prüfungsordner</button>`,
      }))}

      ${raw(card({
        title: 'Belege ausleiten', sub: `${int(attCount)} Dateien im Zeitraum`,
        body: `Alle hinterlegten Rechnungen und Quittungen des Zeitraums als einzelne Dateien,
          benannt nach Datum, Belegnummer und Beschreibung. Dazu ein Verzeichnis mit
          Prüfsummen, die belegen, dass die Dateien unverändert sind. <strong>Achtung:</strong> Die Dateien liegen danach unverschlüsselt
          im Zielordner.`,
        button: `<button class="btn" id="btnAttach">${icon('paperclip', 16).__raw} Belege exportieren</button>`,
      }))}

      ${raw(card({
        title: 'Rohdaten', sub: 'CSV und JSON',
        body: `Einzelne Tabellen für die Weiterverarbeitung in Excel oder LibreOffice:
          die Buchungen ohne die privaten und die Kontakte. Damit lassen sich eigene Unterlagen auch
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

  $('#btnPackCsv', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const datev = await datevOptions(db);
    if (!datev) return;
    const res = await api.file.saveMany({
      folderLabel: 'Zielordner für die Finanzamt-Unterlagen',
      files: X.taxOfficePack(db, period, appInfo.version, datev),
    });
    if (res) ok('Unterlagen gespeichert', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $('#btnPackAll', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const datev = await datevOptions(db);
    if (!datev) return;
    const files = X.taxOfficePack(db, period, appInfo.version, datev);
    const y = period.from.slice(0, 4);
    const pdfs = [
      [R.guvReport(db, period), `Gewinn-und-Verlust_${y}.pdf`],
      [R.euerPdf(db, period), `Anlage-EUER_${y}.pdf`],
      [R.balancePdf(db, period), `Vermoegensuebersicht_${y}.pdf`],
      [R.journalPdf(db, period), `Buchungsjournal_${y}.pdf`],
    ];
    if (!isKleinunternehmer(db)) pdfs.splice(2, 0, [R.ustvaPdf(db, period), `UStVA_${y}.pdf`]);
    for (const [doc, name] of pdfs) files.push(await pdfFuerPaket(doc, name));
    const res = await api.file.saveMany({ folderLabel: 'Zielordner für die Finanzamt-Unterlagen', files });
    if (res) {
      ok('Unterlagen erstellt', `${res.written.length} Dateien in ${res.dir}`);
      await api.file.reveal(res.written[0]);
    }
  }));

  $('#btnPackPdf', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const pfad = await pdfSpeichern(R.yearPack(db, period), `Jahresunterlagen_${period.from.slice(0, 4)}.pdf`);
    if (pfad) ok('PDF erstellt', pfad);
  }));

  $('#btnPackPdfPreview', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await pdfZeigen(R.yearPack(db, period), `Jahresunterlagen_${period.from.slice(0, 4)}.pdf`);
  }));

  $('#btnDatev', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const opts = await datevNumbersDialog(db, true);
    if (!opts) return;
    const stapel = X.datevFiles(db, period, opts);
    if (stapel.length === 1) {
      const p = await api.file.save({
        defaultName: stapel[0].name,
        filters: [{ name: 'DATEV-Buchungsstapel', extensions: ['csv'] }],
        text: stapel[0].text,
        encoding: 'latin1',
      });
      if (p) ok('Buchungsstapel gespeichert', p);
      return;
    }
    // Ein Stapel darf kein Wirtschaftsjahr überschreiten – je Jahr eine Datei.
    const res = await api.file.saveMany({ folderLabel: 'Zielordner für die DATEV-Stapel', files: stapel });
    if (res) ok(`${stapel.length} Buchungsstapel gespeichert`, `je Wirtschaftsjahr eine Datei in ${res.dir}`);
  }));

  $('#btnGobd', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const res = await api.file.saveMany({
      folderLabel: 'Zielordner für die Datenträgerüberlassung',
      files: X.gobdExport(db, period),
    });
    if (res) ok('Prüfungsordner erstellt', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $('#btnAttach', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const yes = await confirmDialog({
      title: 'Belege unverschlüsselt ausleiten?',
      text: 'Die Dateien werden im Zielordner im Klartext abgelegt. Wählen Sie einen Ort, der ausreichend geschützt ist. Ein ungesicherter Cloud-Ordner oder ein USB-Stick, der herumliegt, ist dafür nicht geeignet.',
      confirmLabel: 'Verstanden, exportieren',
    });
    if (!yes) return;
    const files = [];
    const index = [];
    const vergeben = new Set();
    for (const t of rows) {
      for (const id of t.attachments || []) {
        const meta = sel.attachment(id);
        if (!meta) continue;
        const ext = fileExtension(meta);
        const base = `${t.date}_${(t.invoiceNumber || t.id.slice(-6))}_${t.description}`.replace(/[^A-Za-z0-9äöüÄÖÜß _-]/g, '').slice(0, 90).trim();
        // Mehrere Belege an einer Buchung hießen sonst gleich und überschrieben sich.
        let name = `${base}.${ext}`;
        for (let n = 2; vergeben.has(name.toLowerCase()); n++) name = `${base}_${n}.${ext}`;
        vergeben.add(name.toLowerCase());
        files.push({ name, dataBase64: await api.attach.read(id) });
        index.push([t.date, t.invoiceNumber || '', t.description, money(t.gross), name, meta.sha256]);
      }
    }
    if (!files.length) { warn('Keine Belege im Zeitraum'); return; }
    files.push({ name: '_Belegverzeichnis.csv', text: X.toCsv(['Datum', 'Beleg-Nr', 'Beschreibung', 'Betrag', 'Datei', 'SHA-256'], index) });
    const res = await api.file.saveMany({ folderLabel: 'Zielordner für die Belege', files });
    if (res) ok('Belege exportiert', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $('#btnCsvTx', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const p = await api.file.save({
      defaultName: `Buchungen_${period.from}_${period.to}.csv`,
      filters: [{ name: 'CSV-Tabelle', extensions: ['csv'] }],
      text: X.transactionsCsv(db, rows),
    });
    if (p) ok('Tabelle gespeichert', p);
  }));

  $('#btnCsvContacts', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const p = await api.file.save({ defaultName: 'Kontakte.csv', filters: [{ name: 'CSV-Tabelle', extensions: ['csv'] }], text: X.contactsCsv(db) });
    if (p) ok('Tabelle gespeichert', p);
  }));

  $('#btnJson', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const yes = await confirmDialog({
      title: 'Unverschlüsselten Gesamtexport erstellen?',
      text: 'Die JSON-Datei enthält Ihre komplette Buchhaltung im Klartext, ohne Belege, aber mit allen Beträgen, Kontakten und Notizen. Für eine Sicherung nehmen Sie besser die verschlüsselte Vollsicherung unter Einstellungen.',
      confirmLabel: 'Trotzdem exportieren', danger: true,
    });
    if (!yes) return;
    // Der Gesamtexport ist der vollständige Bestand – auch private Buchungen.
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
    const pfad = await pdfSpeichern(doc, name);
    if (pfad) ok('PDF gespeichert', pfad);
  })));
}

/* -------------------------------------------------------------------------- */

/** Endung für einen ausgeleiteten Beleg – aus dem Dateinamen, sonst aus dem Typ. */
function fileExtension(meta) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(meta.fileName || '');
  if (m) return m[1].toLowerCase();
  return {
    'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp',
    'application/xml': 'xml', 'text/xml': 'xml',
  }[meta.mime] || 'bin';
}

/**
 * DATEV-Angaben für die Pakete: Sind Berater- und Mandantennummer gespeichert
 * und gültig, geht es ohne Rückfrage weiter, sonst fragt derselbe Dialog wie
 * beim einzelnen Stapel.
 */
async function datevOptions(db) {
  const s = db.settings;
  if (X.datevNumbersValid(s.datevBerater, s.datevMandant)) {
    return { beraterNr: s.datevBerater, mandantNr: s.datevMandant, steuerschluessel: !!s.datevSteuerschluessel };
  }
  return datevNumbersDialog(db, false);
}

function datevNumbersDialog(db, einzeln) {
  return new Promise((resolve) => {
    let settled = false;
    const klein = isKleinunternehmer(db);
    const m = modal({
      title: 'Angaben für DATEV',
      size: 'slim',
      body: html`
        <p class="mt0 small muted">Ihre Steuerkanzlei nennt Ihnen Berater- und Mandantennummer.
        Ohne die richtigen Nummern weist DATEV den Stapel ab oder ordnet ihn keinem Mandat zu.</p>
        <div class="field"><label>Beraternummer</label><input id="d_berater" inputmode="numeric" value="${db.settings.datevBerater || ''}" placeholder="1001 bis 9999999"></div>
        <div class="field"><label>Mandantennummer</label><input id="d_mandant" inputmode="numeric" value="${db.settings.datevMandant || ''}" placeholder="1 bis 99999"></div>
        ${klein ? '' : raw(`<label class="check"><input type="checkbox" id="d_bu" ${db.settings.datevSteuerschluessel ? 'checked' : ''}>
          Steuerschlüssel mitgeben (9/8 Vorsteuer, 3/2 Umsatzsteuer). Das ist nur für Konten ohne Automatik gedacht; vorher mit der Kanzlei abstimmen</label>`)}
        <label class="check"><input type="checkbox" id="d_save" checked> Angaben für das nächste Mal merken</label>
        <div class="err small mt8" id="d_err" role="alert"></div>`,
      foot: `<button class="btn" data-no>Abbrechen</button>
        ${einzeln ? '' : '<button class="btn" data-skip>Ohne Nummern weiter</button>'}
        <button class="btn primary" data-yes>${einzeln ? 'Stapel erzeugen' : 'Weiter'}</button>`,
      onClose: () => { if (!settled) resolve(null); },
    });
    const wert = (id) => m.root.querySelector(id)?.value.trim() || '';
    m.root.querySelector('[data-yes]').addEventListener('click', async () => {
      const beraterNr = wert('#d_berater');
      const mandantNr = wert('#d_mandant');
      const steuerschluessel = !!m.root.querySelector('#d_bu')?.checked;
      if (!X.datevNumbersValid(beraterNr, mandantNr)) {
        m.root.querySelector('#d_err').textContent = 'Beraternummer 1001 bis 9999999, Mandantennummer 1 bis 99999, nur Ziffern.';
        return;
      }
      if (m.root.querySelector('#d_save').checked) {
        const { commit } = await import('../lib/store.js');
        await commit('einstellung.datev', (d) => {
          d.settings.datevBerater = beraterNr;
          d.settings.datevMandant = mandantNr;
          d.settings.datevSteuerschluessel = steuerschluessel;
        }, { silent: true });
      }
      settled = true;
      m.close();
      resolve({ beraterNr, mandantNr, steuerschluessel });
    });
    m.root.querySelector('[data-skip]')?.addEventListener('click', () => {
      // Das Paket entsteht trotzdem; LIESMICH.txt weist auf die Platzhalter hin.
      settled = true;
      m.close();
      resolve({ steuerschluessel: false });
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
  });
}
