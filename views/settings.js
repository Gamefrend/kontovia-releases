/** Kontovia – Einstellungen, Sicherheit, Sicherungen, Festschreibung. */

import {
  html, raw, esc, $, $$, money, fmtDate, fmtDateTime, todayISO, int, bytes, uid,
} from '../lib/util.js';
import { icon, modal, confirmDialog, askPassword, ok, err, warn, toast, emptyState } from '../lib/ui.js';
import { store, sel, commit, saveNow, setDb, verifyAudit, lockedUntil } from '../lib/store.js';
import { refresh, navigate, router } from '../lib/router.js';
import { applyTheme, appInfo } from '../app.js';
import { renderCloudCard, renderUpdateCard, openConflicts } from './cloudpanel.js';
import { renderCalendarCard } from './calendarsync.js';
import { table, mountTables } from '../lib/table.js';

const api = window.kontovia;
/** Läuft Kontovia im Browser statt in Electron? (src/web/bridge.js) */
const WEB = api.platform === 'web';

/** Felder, die erst mit „Einstellungen übernehmen“ gelten (das Erscheinungsbild wirkt sofort). */
const FELDER = [
  'companyName', 'ownerName', 'street', 'zip', 'city', 'taxNumber', 'vatId', 'taxOffice', 'email', 'phone',
  'taxMode', 'accountingBasis', 'defaultVatRate', 'vatPeriod', 'chartOfAccounts', 'fiscalYear',
  'autoLockMinutes', 'startView',
];

/* Noch nicht übernommene Eingaben. Sie überstehen ein Neuzeichnen der Seite –
   etwa nachdem der Kalender verbunden wurde –, und wer die Seite verlässt,
   wird gefragt, statt sie still zu verlieren. */
let offen = {};
let seite = null;
const verlassen = async () => {
  const wahl = await askLeave();
  if (wahl === 'apply') { await apply(seite, { neuZeichnen: false }); return true; }
  if (wahl === 'discard') { offen = {}; return true; }
  return false;
};

export async function render(root, params, { actions } = {}) {
  actions.innerHTML = html`<button class="btn" id="btnSaveNow">${icon('save', 16)} Jetzt sichern</button>`;
  actions.querySelector('#btnSaveNow').addEventListener('click', async () => {
    await saveNow();
    ok('Gespeichert');
  });
  draw(root);
}

async function draw(root) {
  const s = store.db.settings;
  const storage = await api.vault.storage().catch(() => null);
  const backups = await api.vault.backups().catch(() => []);
  const until = lockedUntil();

  root.innerHTML = html`
    <div class="grid c2">
      <div class="card">
        <div class="card-head"><h3>${icon('building', 16)} Firmendaten</h3><span class="sub">erscheinen im Kopf jedes Berichts</span></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field full"><label>Firma</label><input id="s_companyName" value="${esc(s.companyName || '')}"></div>
            <div class="field full"><label>Inhaber / Ansprechpartner</label><input id="s_ownerName" value="${esc(s.ownerName || '')}"></div>
            <div class="field full"><label>Straße und Hausnummer</label><input id="s_street" value="${esc(s.street || '')}"></div>
            <div class="field"><label>PLZ</label><input id="s_zip" value="${esc(s.zip || '')}"></div>
            <div class="field"><label>Ort</label><input id="s_city" value="${esc(s.city || '')}"></div>
            <div class="field"><label>Steuernummer</label><input id="s_taxNumber" value="${esc(s.taxNumber || '')}"></div>
            <div class="field"><label>USt-IdNr.</label><input id="s_vatId" value="${esc(s.vatId || '')}"></div>
            <div class="field full"><label>Zuständiges Finanzamt</label><input id="s_taxOffice" value="${esc(s.taxOffice || '')}"></div>
            <div class="field"><label>E-Mail</label><input id="s_email" value="${esc(s.email || '')}"></div>
            <div class="field"><label>Telefon</label><input id="s_phone" value="${esc(s.phone || '')}"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon('euro', 16)} Steuerliche Einstellungen</h3></div>
        <div class="card-body">
          <div class="field">
            <label>Umsatzsteuer</label>
            <select id="s_taxMode">
              <option value="regelbesteuerung" ${s.taxMode === 'regelbesteuerung' ? 'selected' : ''}>Regelbesteuerung</option>
              <option value="kleinunternehmer" ${s.taxMode === 'kleinunternehmer' ? 'selected' : ''}>Kleinunternehmer (§ 19 UStG)</option>
            </select>
            <span class="hint">Ein Wechsel ändert nur die Darstellung und die Auswertungen. Bereits erfasste Steuerbeträge bleiben in den Buchungen gespeichert.</span>
          </div>
          <div class="field">
            <label>Gewinnermittlung</label>
            <select id="s_accountingBasis">
              <option value="ist" ${s.accountingBasis === 'ist' ? 'selected' : ''}>Nach Zahlungsfluss (§ 11 EStG)</option>
              <option value="soll" ${s.accountingBasis === 'soll' ? 'selected' : ''}>Nach Rechnungsdatum</option>
            </select>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Voreingestellter Steuersatz</label>
              <select id="s_defaultVatRate">
                <option value="19" ${Number(s.defaultVatRate) === 19 ? 'selected' : ''}>19 %</option>
                <option value="7" ${Number(s.defaultVatRate) === 7 ? 'selected' : ''}>7 %</option>
                <option value="0" ${Number(s.defaultVatRate) === 0 ? 'selected' : ''}>0 %</option>
              </select>
            </div>
            <div class="field">
              <label>Voranmeldungszeitraum</label>
              <select id="s_vatPeriod">
                <option value="monatlich" ${s.vatPeriod === 'monatlich' ? 'selected' : ''}>monatlich</option>
                <option value="vierteljährlich" ${s.vatPeriod === 'vierteljährlich' ? 'selected' : ''}>vierteljährlich</option>
                <option value="jährlich" ${s.vatPeriod === 'jährlich' ? 'selected' : ''}>jährlich</option>
              </select>
            </div>
            <div class="field">
              <label>Kontenrahmen</label>
              <select id="s_chartOfAccounts">
                <option value="SKR03" ${s.chartOfAccounts === 'SKR03' ? 'selected' : ''}>SKR03</option>
                <option value="SKR04" ${s.chartOfAccounts === 'SKR04' ? 'selected' : ''}>SKR04</option>
              </select>
            </div>
            <div class="field">
              <label>Erstes Buchungsjahr</label>
              <input id="s_fiscalYear" type="number" min="2000" max="2100" value="${esc(s.fiscalYear || new Date().getFullYear())}">
              <span class="hint">Nur zur Orientierung – die Auswertungen richten sich nach dem jeweils gewählten Zeitraum.</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>${icon('shield', 16)} Sicherheit</h3></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            <div class="field">
              <label>Automatisch sperren nach</label>
              <select id="s_autoLockMinutes">
                ${raw([0, 2, 5, 10, 15, 30, 60].map((v) => `<option value="${v}" ${Number(s.autoLockMinutes) === v ? 'selected' : ''}>${v === 0 ? 'nie (nicht empfohlen)' : v + ' Minuten Inaktivität'}</option>`).join(''))}
              </select>
              <span class="hint">Beim Ruhezustand und bei gesperrtem Bildschirm sperrt Kontovia zusätzlich immer sofort.</span>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn" id="btnPw">${icon('key', 15)} Passwort ändern</button>
              <button class="btn" id="btnLock">${icon('lock', 15)} Jetzt sperren</button>
            </div>
          </div>
          <div class="notice">
            <strong>Wie Ihre Daten geschützt sind.</strong><br>
            Die gesamte Buchhaltung liegt in einer einzigen Datei, verschlüsselt mit
            AES-256-GCM. Der Schlüssel wird mit scrypt aus Ihrem Passwort abgeleitet –
            bewusst rechenintensiv, damit Durchprobieren teuer wird. Belege werden
            einzeln verschlüsselt, ihre Dateinamen auf der Platte sind Zufallswerte.
            Eine Wiederherstellung ohne Passwort gibt es nicht. Der freiwillige Cloud-Abgleich
            überträgt ausschließlich den bereits verschlüsselten Tresor.
          </div>
        </div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>${icon('archive', 16)} Sicherung und Speicherort</h3></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            <div class="row wrap" style="gap:8px">
              <button class="btn primary" id="btnBackup">${icon('save', 15)} Vollsicherung erstellen</button>
              <button class="btn" id="btnRestore">${icon('refresh', 15)} Sicherung wiederherstellen</button>
              ${WEB ? '' : raw(`<button class="btn" id="btnFolder">${icon('folder', 15).__raw} Datenordner öffnen</button>`)}
            </div>
            <p class="small muted mt16">
              Die Vollsicherung enthält alle Buchungen <em>und</em> alle Belege in einer
              Datei, verschlüsselt mit einem Passwort Ihrer Wahl. Bewahren Sie sie an
              einem anderen Ort auf als den Arbeitsrechner – eine defekte Festplatte
              nimmt sonst beides mit.
            </p>
          </div>
          <div>
            ${storage ? raw(`<table class="data compact">
              <tbody>
                <tr><td class="muted">Tresordatei</td><td class="num">${esc(bytes(storage.vaultBytes))}</td></tr>
                <tr><td class="muted">Belege</td><td class="num">${int(storage.attachments.count)} Dateien · ${esc(bytes(storage.attachments.bytes))}</td></tr>
                <tr><td class="muted">Automatische Sicherungen</td><td class="num">${int(storage.backups.count)} · ${esc(bytes(storage.backups.bytes))}</td></tr>
                <tr><td class="muted">${WEB ? 'Ort' : 'Ordner'}</td><td class="tiny">${esc(storage.dataDir)}</td></tr>
                ${storage.browser ? `<tr><td class="muted">Vor Räumen geschützt</td><td class="small">${storage.browser.persistent
                  ? 'ja' : 'nein – der Browser darf bei Platzmangel räumen, bitte Cloud-Abgleich nutzen'}</td></tr>` : ''}
              </tbody>
            </table>`) : ''}
            <p class="tiny muted mt8">
              Kontovia legt bei jedem Speichern höchstens alle 30 Minuten eine Kopie der
              vorherigen Tresordatei ab und hält die letzten 25 vor.
              ${backups.length ? `Neueste: ${esc(fmtDateTime(backups[0].mtime))}.` : ''}
            </p>
            <button class="btn sm mt8" id="btnPrune">Verwaiste Belegdateien aufräumen</button>
          </div>
        </div>
      </div>
    </div>

    <div id="cloudCard" class="mt16"></div>
    <div id="calendarCard" class="mt16"></div>
    <div id="updateCard" class="mt16"></div>

    <div class="card mt16">
      <div class="card-head"><h3>${icon('history', 16)} Unveränderbarkeit und Festschreibung</h3><span class="sub">GoBD</span></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            <div class="field">
              <label>Buchungen festschreiben bis einschließlich</label>
              <div class="row" style="gap:8px">
                <input type="date" id="lockDate" value="${until || ''}" style="flex:1">
                <button class="btn" id="btnLockPeriod">Festschreiben</button>
              </div>
              <span class="hint">Festgeschriebene Buchungen lassen sich nicht mehr ändern oder löschen,
              sondern nur noch stornieren. Das ist der übliche Umgang mit einem abgeschlossenen
              und ans Finanzamt gemeldeten Zeitraum.</span>
            </div>
            ${until ? raw(`<div class="notice ok">Festgeschrieben bis <strong>${esc(fmtDate(until))}</strong>.</div>`) : raw('<div class="notice">Bisher ist nichts festgeschrieben.</div>')}
          </div>
          <div>
            <p class="small muted mt0">
              Jede Änderung landet im Änderungsjournal. Die Einträge sind über SHA-256
              miteinander verkettet – wird nachträglich etwas verändert, passen die
              Prüfsummen nicht mehr zusammen.
            </p>
            <div class="row" style="gap:8px">
              <button class="btn" id="btnVerify">${icon('check', 15)} Journal prüfen</button>
              <button class="btn" id="btnJournal">${icon('eye', 15)} Journal ansehen (${int((store.db.auditLog || []).length)})</button>
            </div>
            <div id="verifyResult" class="mt8"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h3>${icon('settings', 16)} Darstellung</h3></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field">
            <label>Erscheinungsbild</label>
            <select id="s_theme">
              <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Wie das Betriebssystem</option>
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Hell</option>
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dunkel</option>
            </select>
            <span class="hint">Wirkt sofort. Schneller geht es mit dem Umschalter links unten in der Seitenleiste.</span>
          </div>
          <div class="field">
            <label>Ansicht beim Start</label>
            <select id="s_startView">
              <option value="dashboard" ${s.startView === 'dashboard' ? 'selected' : ''}>Übersicht</option>
              <option value="transactions" ${s.startView === 'transactions' ? 'selected' : ''}>Buchungen</option>
              <option value="calendar" ${s.startView === 'calendar' ? 'selected' : ''}>Kalender</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="row end mt16 mb16 apply-bar" id="applyBar">
      <span class="muted small" id="saveHint">Firmendaten, Steuer, Sicherheit und Darstellung gelten erst nach dem Übernehmen.</span>
      <button class="btn" id="btnDiscard" hidden>Verwerfen</button>
      <button class="btn primary lg" id="btnApply">Einstellungen übernehmen</button>
    </div>`;

  seite = root;
  wire(root);
  trackChanges(root);
  // Cloud und Updates laden ihre Karten selbst nach – beide fragen den
  // Hauptprozess und sollen die übrige Ansicht nicht aufhalten.
  renderCloudCard($('#cloudCard', root));
  renderCalendarCard($('#calendarCard', root));
  renderUpdateCard($('#updateCard', root));
}

/* -------------------------------------------------------------------------- */

/**
 * Vergleicht die Felder mit dem Stand beim Zeichnen. Bei offenen Änderungen
 * bleibt die Leiste mit „Übernehmen“ unten im Bild, und ein Wechsel der
 * Ansicht fragt nach.
 */
function trackChanges(root) {
  const start = Object.fromEntries(FELDER.map((id) => [id, $('#s_' + id, root)?.value ?? '']));
  // Neu gezeichnet, während noch Eingaben offen waren: wieder einsetzen.
  if (router.leaveGuard === verlassen) {
    for (const [id, v] of Object.entries(offen)) { const el = $('#s_' + id, root); if (el) el.value = v; }
  } else {
    offen = {};
  }
  const bar = $('#applyBar', root);
  const hint = $('#saveHint', root);
  const update = () => {
    offen = {};
    for (const id of FELDER) {
      const el = $('#s_' + id, root);
      if (el && el.value !== start[id]) offen[id] = el.value;
    }
    const n = Object.keys(offen).length;
    bar.classList.toggle('dirty', n > 0);
    $('#btnDiscard', root).hidden = n === 0;
    hint.textContent = n
      ? `${n === 1 ? 'Eine Änderung ist' : `${n} Änderungen sind`} noch nicht übernommen.`
      : 'Firmendaten, Steuer, Sicherheit und Darstellung gelten erst nach dem Übernehmen.';
    router.leaveGuard = n ? verlassen : null;
  };
  for (const id of FELDER) {
    const el = $('#s_' + id, root);
    el?.addEventListener('input', update);
    el?.addEventListener('change', update);
  }
  $('#btnDiscard', root).addEventListener('click', () => {
    for (const id of FELDER) { const el = $('#s_' + id, root); if (el) el.value = start[id]; }
    update();
  });
  update();
}

/** Fragt beim Verlassen mit offenen Änderungen. @returns {Promise<'apply'|'discard'|null>} */
function askLeave() {
  return new Promise((resolve) => {
    let entschieden = false;
    const n = Object.keys(offen).length;
    const m = modal({
      title: 'Einstellungen übernehmen?',
      size: 'slim',
      body: html`<p class="mt0" style="line-height:1.6">${n === 1 ? 'Eine Änderung' : `${n} Änderungen`} in den Einstellungen
        ${n === 1 ? 'ist' : 'sind'} noch nicht übernommen.</p>`,
      foot: '<button class="btn left" data-stay>Weiter bearbeiten</button>'
        + '<button class="btn danger" data-discard>Verwerfen</button>'
        + '<button class="btn primary" data-apply>Übernehmen</button>',
      onClose: () => { if (!entschieden) resolve(null); },
    });
    const wahl = (v) => { entschieden = true; m.close(); resolve(v); };
    m.root.querySelector('[data-stay]').addEventListener('click', () => wahl(null));
    m.root.querySelector('[data-discard]').addEventListener('click', () => wahl('discard'));
    m.root.querySelector('[data-apply]').addEventListener('click', () => wahl('apply'));
  });
}

async function apply(root, { neuZeichnen = true } = {}) {
  const val = (id) => $('#s_' + id, root)?.value ?? '';
  await commit('einstellungen.aendern', (db) => {
    Object.assign(db.settings, {
      companyName: val('companyName'), ownerName: val('ownerName'), street: val('street'),
      zip: val('zip'), city: val('city'), taxNumber: val('taxNumber'), vatId: val('vatId'),
      taxOffice: val('taxOffice'), email: val('email'), phone: val('phone'),
      taxMode: val('taxMode'), accountingBasis: val('accountingBasis'),
      defaultVatRate: Number(val('defaultVatRate')), vatPeriod: val('vatPeriod'),
      chartOfAccounts: val('chartOfAccounts'), fiscalYear: Number(val('fiscalYear')),
      autoLockMinutes: Number(val('autoLockMinutes')),
      theme: val('theme'), startView: val('startView'),
      // Zeitstempel entscheidet beim Cloud-Abgleich, welche Fassung gilt.
      updatedAt: new Date().toISOString(),
    });
  }, { entity: 'einstellungen', summary: 'Einstellungen geändert' });
  await api.app.setAutoLock(store.db.settings.autoLockMinutes);
  applyTheme();
  await saveNow();
  offen = {};
  router.leaveGuard = null;
  ok('Einstellungen übernommen');
  if (neuZeichnen) refresh();
}

function wire(root) {
  $('#btnApply', root).addEventListener('click', () => apply(root));

  // Das Erscheinungsbild wirkt sofort – ausprobieren soll ohne „Übernehmen“ gehen.
  $('#s_theme', root).addEventListener('change', async (e) => {
    await commit('einstellung.darstellung', (db) => {
      db.settings.theme = e.target.value;
      db.settings.updatedAt = new Date().toISOString();
    }, { silent: true });
    applyTheme();
    saveNow();
  });

  $('#btnLock', root).addEventListener('click', () => api.vault.lock());
  $('#btnFolder', root)?.addEventListener('click', () => api.app.openDataFolder());

  $('#btnPw', root).addEventListener('click', async () => {
    const oldPw = await askPassword({ title: 'Passwort ändern', text: 'Zuerst zur Sicherheit das aktuelle Passwort.', label: 'Aktuelles Passwort', confirmLabel: 'Weiter' });
    if (!oldPw) return;
    const newPw = await askPassword({
      title: 'Neues Passwort',
      text: 'Mindestens 10 Zeichen. Es gibt keine Wiederherstellung – notieren Sie es an einem sicheren Ort.',
      label: 'Neues Passwort', confirmLabel: 'Passwort ändern', repeat: true,
    });
    if (!newPw) return;
    try {
      await api.vault.changePassword(oldPw, newPw);
      ok('Passwort geändert', 'Die Tresordatei wurde mit dem neuen Passwort neu verschlüsselt.');
    } catch (e) {
      err('Passwort nicht geändert', e.message);
    }
  });

  $('#btnBackup', root).addEventListener('click', () => runBackup());

  $('#btnRestore', root).addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Sicherung wiederherstellen?',
      text: 'Der aktuelle Datenbestand wird vollständig durch den Inhalt der Sicherung ersetzt. Erstellen Sie vorher eine Sicherung des jetzigen Standes, wenn Sie ihn behalten wollen.',
      confirmLabel: 'Weiter zur Auswahl', danger: true,
    });
    if (!yes) return;
    const pw = await askPassword({ title: 'Passwort der Sicherung', label: 'Passwort', confirmLabel: 'Wiederherstellen' });
    if (!pw) return;
    try {
      const res = await api.backup.import(pw);
      if (!res) return;
      const db = await api.vault.read();
      setDb(db);
      ok('Sicherung eingespielt', `${res.transactions} Buchungen, ${res.attachments} Belege`);
      navigate('dashboard');
    } catch (e) {
      err('Wiederherstellung fehlgeschlagen', e.message);
    }
  });

  $('#btnPrune', root).addEventListener('click', async () => {
    // Als bekannt gilt, was im Belegverzeichnis steht und was eine Buchung
    // verknüpft hat. Beides zusammen – denn eine der beiden Quellen allein
    // war in älteren Fassungen leer, und dann hätte dieser Knopf sämtliche
    // Belege gelöscht.
    const known = new Set((store.db.attachments || []).map((a) => a.id));
    for (const t of store.db.transactions || []) {
      for (const id of t.attachments || []) known.add(id);
    }
    const yes = await confirmDialog({
      title: 'Verwaiste Belegdateien entfernen?',
      text: `Entfernt werden nur Dateien, die zu keiner Buchung mehr gehören. ${int(known.size)} verknüpfte Belege bleiben unangetastet.`,
      confirmLabel: 'Aufräumen', danger: true,
    });
    if (!yes) return;
    const n = await api.attach.prune([...known]);
    ok(n ? `${n} verwaiste Dateien entfernt` : 'Nichts aufzuräumen');
    refresh();
  });

  $('#btnLockPeriod', root).addEventListener('click', async () => {
    const date = $('#lockDate', root).value;
    if (!date) { warn('Bitte ein Datum wählen'); return; }
    const affected = sel.transactions().filter((t) => t.date <= date).length;
    const yes = await confirmDialog({
      title: 'Zeitraum festschreiben?',
      text: `${affected} Buchungen bis zum ${fmtDate(date)} lassen sich danach nicht mehr ändern oder löschen – nur noch stornieren. Das lässt sich nicht zurücknehmen.`,
      confirmLabel: 'Festschreiben', danger: true,
    });
    if (!yes) return;
    await commit('festschreibung', (db) => {
      db.locks.push({ id: uid('lock'), until: date, ts: new Date().toISOString() });
    }, { entity: 'festschreibung', summary: `Festgeschrieben bis ${date} (${affected} Buchungen)` });
    await saveNow();
    ok('Zeitraum festgeschrieben', `bis ${fmtDate(date)}`);
    refresh();
  });

  $('#btnVerify', root).addEventListener('click', async () => {
    const box = $('#verifyResult', root);
    box.innerHTML = '<div class="skeleton" style="height:40px"></div>';
    const res = await verifyAudit();
    box.innerHTML = res.ok
      ? html`<div class="notice ok">Die Prüfsummenkette ist unversehrt. ${int(res.count)} Einträge geprüft.</div>`
      : html`<div class="notice danger">Die Kette bricht bei Eintrag Nr. ${res.seq}. Der Datenbestand wurde außerhalb von Kontovia verändert.</div>`;
  });

  $('#btnJournal', root).addEventListener('click', () => showJournal());
}

export async function runBackup() {
  const pw = await askPassword({
    title: 'Vollsicherung erstellen',
    text: 'Die Sicherung enthält alle Buchungen und Belege. Wählen Sie ein Passwort – Sie können dasselbe wie für den Tresor nehmen oder ein eigenes.',
    label: 'Passwort für die Sicherung', confirmLabel: 'Sicherung erstellen', repeat: true,
  });
  if (!pw) return;
  toast('Sicherung wird erstellt …', 'Bei vielen Belegen kann das einen Moment dauern.');
  try {
    const res = await api.backup.export(pw);
    if (res) ok('Sicherung erstellt', `${bytes(res.bytes)} · ${res.path}`);
  } catch (e) {
    err('Sicherung fehlgeschlagen', e.message);
  }
}

function showJournal() {
  const log = [...(store.db.auditLog || [])].reverse().slice(0, 800);
  const vorgaenge = [...new Set(log.map((e) => e.action))].sort((a, b) => a.localeCompare(b, 'de'));
  const m = modal({
    title: 'Änderungsjournal',
    size: 'wide',
    body: html`
      <p class="mt0 small muted">Die letzten ${int(log.length)} von ${int((store.db.auditLog || []).length)} Einträgen.
      Jeder Eintrag enthält die Prüfsumme des vorherigen – dadurch lässt sich nachträgliches Verändern erkennen.</p>
      ${table({
        id: 'journal',
        cls: 'data compact',
        maxHeight: '56vh',
        defaultSort: { key: 'seq', dir: -1 },
        rows: log,
        search: { placeholder: 'Vorgang oder Beschreibung suchen …', text: (e) => [e.action, e.summary, e.seq].join(' ') },
        columns: [
          { key: 'seq', label: 'Nr.', type: 'num', tdCls: 'muted' },
          { key: 'ts', label: 'Zeitpunkt', type: 'date', tdCls: 'nowrap small', cell: (e) => esc(fmtDateTime(e.ts)) },
          { key: 'action', label: 'Vorgang', type: 'text', tdCls: 'small', cell: (e) => `<span class="badge">${esc(e.action)}</span>` },
          { key: 'summary', label: 'Beschreibung', type: 'text', tdCls: 'small', cell: (e) => `<span class="truncate" style="display:block;max-width:340px">${esc(e.summary || '')}</span>` },
          { key: 'hash', label: 'Prüfsumme', type: 'none', tdCls: 'tiny muted', cell: (e) => `<span style="font-family:var(--mono)">${esc((e.hash || '').slice(0, 12))}…</span>` },
        ],
        filters: vorgaenge.length > 1 ? [{
          key: 'vorgang', column: 'action', title: 'Vorgang', initial: '', search: vorgaenge.length > 8,
          options: () => [['', 'Alle Vorgänge', () => true], ...vorgaenge.map((v) => [v, v, (e) => e.action === v])],
        }] : [],
        emptyTitle: 'Noch keine Einträge',
      })}`,
    foot: '<button class="btn primary" data-x>Schließen</button>',
  });
  mountTables(m.root);
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
}
