/** Kontovia – Einstellungen, Sicherheit, Sicherungen, Festschreibung. */

import {
  html, raw, esc, $, $$, fmtDate, fmtDateTime, todayISO, int, bytes, uid, ustIdHinweis, steuernummerHinweis,
} from '../lib/util.js';
import { icon, modal, confirmDialog, askPassword, ok, err, warn, toast, feldHinweis } from '../lib/ui.js';
import { store, sel, commit, saveNow, setDb, verifyAudit, lockedUntil } from '../lib/store.js';
import { refresh, navigate, router } from '../lib/router.js';
import { applyTheme, lockNow, appInfo, VIEWS, navNeuZeichnen } from '../app.js';
import {
  NAV_GRUPPEN, navFolge, istVersteckt, istAngepasst, verbergbar, verbergen, zeigen, verschieben, zuruecksetzen,
} from '../lib/seitenleiste.js';
import { abmelden, zugaengeKarte, kontenKarte, kontoSchluessel } from '../lib/zugaenge.js';
import { geraeteKarte } from '../lib/koppeln.js';
import { zulassungKarte } from '../lib/zulassung.js';
import { benutzerKarte } from '../lib/benutzer.js';
import { renderCloudCard, renderUpdateCard } from './cloudpanel.js';
import { renderCalendarCard } from './calendarsync.js';
import { mahnKarte } from './mahneinstellungen.js';
import { table, mountTables } from '../lib/table.js';
import { bereichEin, markierung } from '../lib/bewegung.js';

const api = window.kontovia;

/** Felder, die erst mit „Einstellungen übernehmen“ gelten (das Erscheinungsbild wirkt sofort). */
const FELDER = [
  'companyName', 'ownerName', 'street', 'zip', 'city', 'taxNumber', 'vatId', 'taxOffice', 'email', 'phone',
  'taxMode', 'accountingBasis', 'defaultVatRate', 'vatPeriod', 'vatDeadline', 'chartOfAccounts', 'fiscalYear',
  'autoLockMinutes', 'startView',
];

/**
 * Die Einstellungen sind in vier Bereiche geteilt, die nebeneinander (am Telefon
 * als Reiterzeile) zur Wahl stehen. Alle Karten liegen immer in der Seite, nur der
 * gewählte Bereich ist zu sehen; so behalten Eingaben und Verdrahtung ihren Platz.
 */
const BEREICHE = [
  { id: 'firma', icon: 'building', titel: 'Firma & Steuern', sub: 'Firmendaten, Steuer, Mahnwesen, Festschreibung' },
  { id: 'sicherheit', icon: 'shield', titel: 'Sicherheit & Zugang', sub: 'Sperre, Geräte, Benutzer, Konten' },
  { id: 'daten', icon: 'archive', titel: 'Daten & Cloud', sub: 'Sicherung, Speicherort, Abgleich, Kalender' },
  { id: 'darstellung', icon: 'settings', titel: 'Darstellung & Update', sub: 'Erscheinungsbild, Start, Programmfassung' },
];
/** Wohin ein Sprung aus anderen Ansichten (`abschnitt`) führt. */
const ABSCHNITT_BEREICH = { cloud: 'daten', speicher: 'daten', mahnwesen: 'firma', benutzer: 'sicherheit', konten: 'sicherheit' };
const HINWEIS = 'Firmendaten, Steuer, Sicherheit und Darstellung gelten erst nach dem Übernehmen.';
let bereich = BEREICHE[0].id;

/** Zeigt einen Bereich und merkt ihn sich für das nächste Öffnen der Seite. */
function bereichZeigen(root, id, { animiert = false } = {}) {
  if (!BEREICHE.some((b) => b.id === id)) id = BEREICHE[0].id;
  bereich = id;
  for (const p of $$('[data-panel]', root)) p.hidden = p.dataset.panel !== id;
  for (const t of $$('.set-tab', root)) {
    const an = t.dataset.tab === id;
    t.classList.toggle('active', an);
    t.setAttribute('aria-selected', String(an));
    t.tabIndex = an ? 0 : -1;
  }
  $('#setSub', root).textContent = BEREICHE.find((b) => b.id === id).sub;
  if (animiert) bereichEin($('#panel_' + id, root));
}

function tabsVerdrahten(root) {
  const nav = $('#setNav', root);
  nav.addEventListener('click', (e) => {
    const t = e.target.closest('.set-tab');
    if (!t) return;
    if (t.dataset.tab !== bereich) bereichZeigen(root, t.dataset.tab, { animiert: true });
    t.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  // Pfeiltasten wechseln zwischen den Reitern, wie bei einer Reiterleiste üblich.
  nav.addEventListener('keydown', (e) => {
    const schritt = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!schritt) return;
    e.preventDefault();
    const i = BEREICHE.findIndex((b) => b.id === bereich);
    const neu = BEREICHE[(i + schritt + BEREICHE.length) % BEREICHE.length].id;
    bereichZeigen(root, neu, { animiert: true });
    $('#tab_' + neu, root).focus();
  });
  bereichZeigen(root, bereich);
  // Der Strich unter dem gewählten Reiter gleitet zum neuen Bereich.
  markierung(nav, { aktiv: '.set-tab.active' });
}

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
  if (ABSCHNITT_BEREICH[params?.abschnitt]) bereich = ABSCHNITT_BEREICH[params.abschnitt];
  await draw(root);
  // Aus der Statusleiste („Cloud-Sicherung einrichten“) direkt zur Cloud-Karte.
  const ZIEL = { cloud: '#cloudCard', speicher: '#speicherCard', mahnwesen: '#mahnCard', benutzer: '#benutzerCard', konten: '#kontenCard' };
  if (ZIEL[params?.abschnitt]) $(ZIEL[params.abschnitt], root)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function draw(root) {
  const s = store.db.settings;
  const storage = await api.vault.storage().catch(() => null);
  const backups = await api.vault.backups().catch(() => []);
  const until = lockedUntil();

  root.innerHTML = html`
    <div class="set-layout">
    <nav class="set-nav" id="setNav" role="tablist" aria-label="Bereiche der Einstellungen">
      ${raw(BEREICHE.map((b) => `<button type="button" class="set-tab" role="tab" id="tab_${b.id}" data-tab="${b.id}" aria-controls="panel_${b.id}">
        ${icon(b.icon, 16).__raw}<span class="set-tab-name">${esc(b.titel)}</span></button>`).join(''))}
    </nav>
    <div class="set-body">
    <p class="set-sub" id="setSub"></p>
    <section class="set-panel" id="panel_firma" data-panel="firma" role="tabpanel" aria-labelledby="tab_firma">
      <div class="card">
        <div class="card-head"><h2>${icon('building', 16)} Firmendaten</h2><span class="sub">erscheinen im Kopf jedes Berichts</span></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field full"><label>Firma</label><input id="s_companyName" value="${s.companyName || ''}"></div>
            <div class="field full"><label>Inhaber / Ansprechpartner</label><input id="s_ownerName" value="${s.ownerName || ''}"></div>
            <div class="field full"><label>Straße und Hausnummer</label><input id="s_street" value="${s.street || ''}"></div>
            <div class="field"><label>PLZ</label><input id="s_zip" value="${s.zip || ''}"></div>
            <div class="field"><label>Ort</label><input id="s_city" value="${s.city || ''}"></div>
            <div class="field"><label>Steuernummer</label><input id="s_taxNumber" value="${s.taxNumber || ''}"></div>
            <div class="field"><label>USt-IdNr.</label><input id="s_vatId" value="${s.vatId || ''}"></div>
            <div class="field full"><label>Zuständiges Finanzamt</label><input id="s_taxOffice" value="${s.taxOffice || ''}"></div>
            <div class="field"><label>E-Mail</label><input id="s_email" value="${s.email || ''}"></div>
            <div class="field"><label>Telefon</label><input id="s_phone" value="${s.phone || ''}"></div>
          </div>
          <p class="small muted mt8 mb0">Bankverbindung, Handelsregister und Website für Ihre Rechnungen stehen unter
            <a href="#" data-zu-gestaltung>Rechnungen → Gestaltung</a>.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>${icon('euro', 16)} Steuerliche Einstellungen</h2></div>
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
            <label>Umsatzsteuer berechnen nach</label>
            <select id="s_accountingBasis">
              <option value="ist" ${s.accountingBasis === 'ist' ? 'selected' : ''}>Zahlungseingang (Ist-Versteuerung, § 20 UStG)</option>
              <option value="soll" ${s.accountingBasis === 'soll' ? 'selected' : ''}>Rechnungsdatum (Soll-Versteuerung)</option>
            </select>
            <span class="hint">Gilt für die Voranmeldung und die Umsatzsteuer-Angaben in der Übersicht.
            Einnahmen, Ausgaben und Gewinn zählen überall am Zahlungstag, wie in der Anlage EÜR (§ 11 EStG).</span>
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
              <label>Abgabe der Voranmeldung</label>
              <select id="s_vatDeadline">
                <option value="normal" ${s.vatDeadline !== 'dauerfrist' ? 'selected' : ''}>bis zum 10. des Folgemonats</option>
                <option value="dauerfrist" ${s.vatDeadline === 'dauerfrist' ? 'selected' : ''}>mit Dauerfristverlängerung (+1 Monat)</option>
              </select>
              <span class="hint">Für die Steuertermine in Übersicht und Kalender. Die Dauerfristverlängerung beantragen Sie beim Finanzamt (§ 46 UStDV).</span>
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
              <input id="s_fiscalYear" type="number" min="2000" max="2100" value="${s.fiscalYear || new Date().getFullYear()}">
              <span class="hint">Nur zur Orientierung. Die Auswertungen richten sich nach dem jeweils gewählten Zeitraum.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card" id="mahnCard"></div>

      <div class="card">
        <div class="card-head"><h2>${icon('history', 16)} Unveränderbarkeit und Festschreibung</h2><span class="sub">GoBD</span></div>
        <div class="card-body">
          <div class="grid c2">
            <div>
              <div class="field">
                <label>Buchungen festschreiben bis einschließlich</label>
                <div class="row" style="gap:8px">
                  <input type="date" id="lockDate" value="${until || ''}" max="${todayISO()}" style="flex:1">
                  <button class="btn" id="btnLockPeriod">Festschreiben</button>
                </div>
                <span class="hint">Festgeschriebene Buchungen lassen sich nicht mehr ändern oder löschen,
                sondern nur noch stornieren. Das ist der übliche Umgang mit einem abgeschlossenen
                und ans Finanzamt gemeldeten Zeitraum. Noch offene Rechnungen daraus lassen sich
                weiterhin als bezahlt vermerken.</span>
              </div>
              ${until ? raw(`<div class="notice ok">Festgeschrieben bis <strong>${esc(fmtDate(until))}</strong>.</div>`) : raw('<div class="notice">Bisher ist nichts festgeschrieben.</div>')}
            </div>
            <div>
              <p class="small muted mt0">
                Jede Änderung landet im Änderungsjournal. Die Einträge sind über Prüfsummen
                miteinander verkettet. Wird nachträglich etwas verändert, passen sie nicht
                mehr zusammen.
              </p>
              <div class="row wrap" style="gap:8px">
                <button class="btn" id="btnVerify">${icon('check', 15)} Journal prüfen</button>
                <button class="btn" id="btnJournal">${icon('eye', 15)} Journal ansehen (${int((store.db.auditLog || []).length)})</button>
              </div>
              <div id="verifyResult" class="mt8"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="set-panel" id="panel_sicherheit" data-panel="sicherheit" role="tabpanel" aria-labelledby="tab_sicherheit" hidden>
      <div class="card">
      <div class="card-head"><h2>${icon('shield', 16)} Sicherheit</h2></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            <div class="field">
              <label>Automatisch sperren nach</label>
              <select id="s_autoLockMinutes">
                ${raw([0, 2, 5, 10, 15, 30, 60].map((v) => `<option value="${v}" ${Number(s.autoLockMinutes) === v ? 'selected' : ''}>${v === 0 ? 'nie (nicht empfohlen)' : v + ' Minuten Inaktivität'}</option>`).join(''))}
              </select>
              <span class="hint">Nach dem Ruhezustand des Geräts und nach drei Minuten im Hintergrund sperrt Kontovia zusätzlich sofort.</span>
            </div>
            <div id="bildschirmBox"></div>
            <div class="row" style="gap:8px">
              <button class="btn" id="btnPw">${icon('key', 15)} Passwort ändern</button>
              <button class="btn" id="btnLock">${icon('lock', 15)} Jetzt sperren</button>
              <button class="btn" id="btnAbmelden">${icon('logout', 15)} Von diesem Gerät entfernen</button>
            </div>
          </div>
          <div class="notice">
            <strong>Wie Ihre Daten geschützt sind.</strong><br>
            Die gesamte Buchhaltung ist mit Ihrem Passwort verschlüsselt (AES-256).
            Das Entschlüsseln ist bewusst aufwendig, damit niemand Passwörter in großer
            Zahl durchprobieren kann. Belege werden einzeln verschlüsselt und tragen auf
            der Festplatte keine sprechenden Namen. Eine Wiederherstellung ohne Passwort
            gibt es nicht, außer über Wege, die Sie selbst einschalten: Fingerabdruck oder Gesicht (unten) und
            „Mit Google entsperren“ (unter Daten & Cloud, ein großes Sicherheitsrisiko). Der freiwillige Cloud-Abgleich überträgt ausschließlich die
            bereits verschlüsselte Buchhaltung.
          </div>
        </div>
      </div>
    </div>

    <div class="card" id="zugaengeCard"></div>

    <div class="card" id="geraeteCard"></div>

    <div class="card" id="zulassungCard"></div>

    <div class="card" id="benutzerCard"></div>

    <div class="card" id="kontenCard"></div>
    </section>

    <section class="set-panel" id="panel_daten" data-panel="daten" role="tabpanel" aria-labelledby="tab_daten" hidden>
    <div class="card" id="speicherCard">
      <div class="card-head"><h2>${icon('archive', 16)} Sicherung und Speicherort</h2></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            <div class="row wrap" style="gap:8px">
              <button class="btn primary" id="btnBackup">${icon('save', 15)} Vollsicherung erstellen</button>
              <button class="btn" id="btnRestore">${icon('refresh', 15)} Sicherung wiederherstellen</button>
            </div>
            <p class="small muted mt16">
              Die Vollsicherung enthält alle Buchungen <em>und</em> alle Belege in einer
              Datei, verschlüsselt mit einem Passwort Ihrer Wahl. Bewahren Sie sie an
              einem anderen Ort auf als den Arbeitsrechner. Eine defekte Festplatte
              nimmt sonst beides mit.
            </p>
            ${raw(speicherortBlock(storage?.speicher, storage?.browser?.persistent))}
          </div>
          <div>
            ${storage ? raw(`<table class="data compact">
              <tbody>
                <tr><td class="muted">Tresordatei</td><td class="num">${esc(bytes(storage.vaultBytes))}</td></tr>
                <tr><td class="muted">Belege</td><td class="num">${int(storage.attachments.count)} Dateien · ${esc(bytes(storage.attachments.bytes))}</td></tr>
                <tr><td class="muted">Automatische Sicherungen</td><td class="num">${int(storage.backups.count)} · ${esc(bytes(storage.backups.bytes))}</td></tr>
                <tr><td class="muted">Ort</td><td class="tiny">${esc(storage.dataDir)}</td></tr>
                ${storage.browser ? `<tr><td class="muted">Vor dem Löschen geschützt</td><td class="small">${storage.browser.persistent
                  ? 'ja' : 'nein, der Browser darf bei Platzmangel löschen'}</td></tr>` : ''}
              </tbody>
            </table>`) : ''}
            <p class="tiny muted mt8">
              Kontovia legt bei jedem Speichern höchstens alle 30 Minuten eine Kopie der
              vorherigen Tresordatei ab und hält die letzten 25 vor.
              ${backups.length ? `Neueste: ${esc(fmtDateTime(backups[0].mtime))}.` : ''}
            </p>
            <button class="btn sm mt8" id="btnPrune">Nicht mehr benötigte Belegdateien löschen</button>
          </div>
        </div>
      </div>
    </div>

    <div id="cloudCard"></div>
    <div id="calendarCard"></div>
    </section>

    <section class="set-panel" id="panel_darstellung" data-panel="darstellung" role="tabpanel" aria-labelledby="tab_darstellung" hidden>
    <div class="card">
      <div class="card-head"><h2>${icon('settings', 16)} Darstellung</h2></div>
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
              <option value="todos" ${s.startView === 'todos' ? 'selected' : ''}>Aufgaben</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div id="leistenCard"></div>
    <div id="updateCard"></div>
    </section>

    <div class="row end mt16 mb16 apply-bar" id="applyBar">
      <span class="muted small" id="saveHint">${HINWEIS}</span>
      <button class="btn" id="btnDiscard" hidden>Verwerfen</button>
      <button class="btn primary lg" id="btnApply">Einstellungen übernehmen</button>
    </div>
    </div>
    </div>`;

  seite = root;
  wire(root);
  tabsVerdrahten(root);
  trackChanges(root);
  // Cloud und Updates laden ihre Karten selbst nach – beide fragen den
  // Web-Schicht und sollen die übrige Ansicht nicht aufhalten.
  mahnKarte($('#mahnCard', root));
  renderCloudCard($('#cloudCard', root));
  renderCalendarCard($('#calendarCard', root));
  renderUpdateCard($('#updateCard', root));
  leistenKarte($('#leistenCard', root));
}

/**
 * Welche Bereiche die Seitenleiste zeigt und in welcher Reihenfolge. Wirkt sofort
 * und gilt nur für dieses Gerät; dasselbe geht in der Leiste selbst per Rechtsklick.
 */
function leistenKarte(host) {
  const zeile = (id, i, n) => {
    const v = VIEWS[id];
    const aus = istVersteckt(id);
    return `<div class="leiste-zeile${aus ? ' aus' : ''}" data-id="${id}">
      <span class="leiste-name">${icon(v.icon, 16).__raw}<span>${esc(v.title)}</span></span>
      <label class="check leiste-an"><input type="checkbox" data-an="${id}" ${aus ? '' : 'checked'} ${verbergbar(id) ? '' : 'disabled'}> Anzeigen</label>
      <button type="button" class="icon-btn" data-schieb="-1" data-id="${id}" ${aus || i === 0 ? 'disabled' : ''} aria-label="${esc(v.title)} nach oben" title="Nach oben">${icon('arrowUp', 15).__raw}</button>
      <button type="button" class="icon-btn" data-schieb="1" data-id="${id}" ${aus || i === n - 1 ? 'disabled' : ''} aria-label="${esc(v.title)} nach unten" title="Nach unten">${icon('arrowDown', 15).__raw}</button>
    </div>`;
  };
  const zeichnen = (fokus) => {
    host.innerHTML = `<div class="card">
      <div class="card-head"><h2>${icon('sidebar', 16).__raw} Seitenleiste</h2><span class="sub">gilt für dieses Gerät</span></div>
      <div class="card-body">
        <p class="muted small mt0">Blenden Sie Bereiche aus, die Sie nicht brauchen, und ordnen Sie die übrigen an. In der Seitenleiste selbst geht das auch per Rechtsklick; mit der Maus lassen sich Einträge nach kurzem Halten verschieben. Ausgeblendete Bereiche finden Sie weiterhin über die Suche.</p>
        ${NAV_GRUPPEN.map((_, g) => {
          const folge = navFolge(g);
          const sichtbar = folge.filter((id) => !istVersteckt(id));
          return `<div class="leiste-gruppe">${folge.map((id) => zeile(id, sichtbar.indexOf(id), sichtbar.length)).join('')}</div>`;
        }).join('')}
        <div class="row mt16"><button type="button" class="btn" id="leisteReset" ${istAngepasst() ? '' : 'disabled'}>${icon('refresh', 15).__raw} Voreinstellung</button></div>
      </div>
    </div>`;
    // Mehrere Wünsche in Reihenfolge: der erste, der noch bedienbar ist, bekommt den Fokus.
    for (const f of [fokus].flat().filter(Boolean)) {
      const n = host.querySelector(f);
      if (n && !n.disabled) { n.focus(); break; }
    }
  };
  const geaendert = (fokus) => { navNeuZeichnen(); zeichnen(fokus); };
  host.addEventListener('change', (e) => {
    const c = e.target.closest('[data-an]');
    if (!c) return;
    if (c.checked) zeigen(c.dataset.an); else verbergen(c.dataset.an);
    geaendert(`[data-an="${c.dataset.an}"]`);
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-schieb]');
    if (b) {
      const d = Number(b.dataset.schieb);
      verschieben(b.dataset.id, d);
      // Der Fokus bleibt beim Pfeil; ist die Grenze erreicht, wechselt er zum Gegenpfeil.
      geaendert([`[data-schieb="${d}"][data-id="${b.dataset.id}"]`, `[data-schieb="${-d}"][data-id="${b.dataset.id}"]`]);
      return;
    }
    if (e.target.closest('#leisteReset')) { zuruecksetzen(); geaendert(); ok('Seitenleiste zurückgesetzt'); }
  });
  zeichnen();
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
      : HINWEIS;
    // Ein Punkt am Reiter verrät, in welchem Bereich noch etwas offen ist.
    const betroffen = new Set(Object.keys(offen).map((id) => $('#s_' + id, root)?.closest('[data-panel]')?.dataset.panel));
    for (const t of $$('.set-tab', root)) t.classList.toggle('geaendert', betroffen.has(t.dataset.tab));
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

/**
 * Web-Fassung: Sperren bei gesperrtem Bildschirm. Chrome und Edge melden das
 * nur mit Erlaubnis; die gilt für dieses Gerät, deshalb nicht im Tresor.
 */
async function bildschirmKasten(el) {
  if (!el || !api.app.bildschirmsperre) return;
  const st = await api.app.bildschirmsperre().catch(() => null);
  if (!st) return;
  if (!st.moeglich) {
    el.innerHTML = '<p class="hint mb8">Eine Bildschirmsperre kann dieser Browser nicht melden. Dafür gelten die Sperre nach Inaktivität, '
      + 'nach dem Ruhezustand und nach drei Minuten im Hintergrund.</p>';
    return;
  }
  const an = st.an && st.erlaubnis === 'granted';
  el.innerHTML = html`
    <label class="check mb8"><input type="checkbox" id="bildschirmsperre" ${an ? 'checked' : ''}>
      Auch sperren, sobald der Bildschirm gesperrt wird</label>
    <p class="hint mt0 mb8">Gilt für diesen Browser. Er fragt dafür einmal, ob Kontovia erkennen darf, wann das Gerät
      benutzt wird.${st.an && st.erlaubnis === 'denied' ? ' Die Erlaubnis wurde verweigert; sie lässt sich in den Website-Einstellungen des Browsers geben.' : ''}</p>`;
  el.querySelector('#bildschirmsperre').addEventListener('change', async (e) => {
    try {
      await api.app.bildschirmsperreSetzen(e.target.checked);
      ok(e.target.checked ? 'Sperre bei Bildschirmsperre an' : 'Sperre bei Bildschirmsperre aus');
    } catch (x) {
      e.target.checked = false;
      err('Nicht eingeschaltet', x.message);
    }
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
      defaultVatRate: Number(val('defaultVatRate')), vatPeriod: val('vatPeriod'), vatDeadline: val('vatDeadline'),
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

/**
 * Web-Fassung: Wo die Buchhaltung liegt. Im Speicher des Browsers darf der
 * Browser bei Platzmangel räumen; in Chrome und Edge lässt sie sich deshalb in
 * einen Ordner auf dem Gerät verschieben, sonst bleibt der Rat zu Cloud und
 * Vollsicherung.
 */
function speicherortBlock(sp, geschuetzt = false) {
  if (!sp) return '';
  if (sp.art === 'ordner') {
    return `<div class="notice ok mt16 mb8"><strong>Ihre Buchhaltung liegt im Ordner „${esc(sp.name)}“ auf diesem Gerät.</strong>
      Tresor, Belege und Sicherungen stehen dort als Dateien, verschlüsselt wie immer. Sichern Sie den Ordner
      mit Ihren übrigen Dateien.</div>
      <button class="btn sm" id="btnInBrowser">${icon('refresh', 14).__raw} Zurück in den Browser …</button>`;
  }
  if (sp.moeglich) {
    return `<div class="notice ${geschuetzt ? '' : 'warn '}mt16 mb8"><strong>Ihre Buchhaltung liegt im Speicher dieses Browsers.</strong>
      ${geschuetzt ? 'Der Browser hat zugesagt, ihn nicht von selbst zu leeren.' : 'Den darf der Browser bei Platzmangel löschen.'} Sicherer liegt sie in einem Ordner auf diesem Gerät: Dort
      sehen Sie die Dateien und sichern sie mit Ihren übrigen Dateien.</div>
      <button class="btn sm" id="btnInOrdner">${icon('folder', 14).__raw} In einen Ordner verschieben …</button>`;
  }
  return `<div class="notice warn mt16 mb0"><strong>Ihre Buchhaltung liegt im Speicher dieses Browsers</strong>, und
    den darf der Browser bei Platzmangel löschen. Schalten Sie deshalb die Cloud-Sicherung ein oder legen Sie
    regelmäßig eine Vollsicherung an. In Chrome oder Edge lässt sich die Buchhaltung stattdessen in einem
    Ordner auf dem Gerät speichern.</div>`;
}

/** Fortschritt eines Umzugs im Hinweis; gibt eine Funktion zum Abmelden zurück. */
function umzugAnzeigen(titel) {
  const node = toast(titel, 'Kopiere …', '', 600000);
  const d = node?.querySelector('.d');
  const ab = api.on.speicher?.((p) => { if (d) d.textContent = `${p.fertig} von ${p.gesamt} Dateien kopiert und geprüft`; });
  return () => { ab?.(); node?.click(); };
}

async function inOrdnerVerschieben() {
  let wahl;
  try {
    wahl = await api.speicher.ordnerWaehlen({ zweck: 'umziehen' });
  } catch (e) {
    err('Ordner nicht geöffnet', e.message);
    return;
  }
  if (!wahl) return;
  if (wahl.tresor) {
    err('Dort liegt schon eine Buchhaltung', `Im Ordner „${wahl.pfad}“ liegt bereits eine Kontovia-Buchhaltung. Wählen Sie einen anderen Ordner.`);
    return;
  }
  const yes = await confirmDialog({
    title: 'In den Ordner verschieben?',
    text: `Kontovia kopiert Ihre Buchhaltung samt Belegen und Sicherungen nach „${wahl.pfad}“, liest jede Datei zur Kontrolle zurück und `
      + 'löscht erst danach den Speicher im Browser. Ab dann arbeitet Kontovia in diesem Ordner. Nach einem Neustart des Browsers '
      + 'fragt er einmal, ob Kontovia wieder darauf zugreifen darf.',
    confirmLabel: 'Verschieben',
  });
  if (!yes) return;
  if (store.dirty) await saveNow();
  const fertig = umzugAnzeigen('Buchhaltung wird verschoben');
  try {
    const res = await api.speicher.inOrdner();
    fertig();
    ok('Buchhaltung verschoben', `${int(res.dateien)} Dateien liegen jetzt in „${res.pfad}“.`);
  } catch (e) {
    fertig();
    err('Nicht verschoben', `${e.message} Ihre Buchhaltung liegt unverändert im Browser.`);
  }
  refresh();
}

async function zurueckInDenBrowser() {
  const st = await api.speicher.status().catch(() => null);
  const yes = await confirmDialog({
    title: 'Zurück in den Browser?',
    text: `Kontovia kopiert die Buchhaltung aus dem Ordner „${st?.name || ''}“ in den Speicher dieses Browsers und prüft jede Datei. `
      + 'Die Dateien im Ordner bleiben liegen. Arbeiten Sie danach nicht mehr mit ihnen, sonst gibt es zwei Stände; löschen Sie den Ordner, wenn Sie ihn nicht mehr brauchen.',
    confirmLabel: 'Zurück in den Browser',
  });
  if (!yes) return;
  if (store.dirty) await saveNow();
  const fertig = umzugAnzeigen('Buchhaltung wird zurückgeholt');
  try {
    const res = await api.speicher.inBrowser();
    fertig();
    ok('Buchhaltung im Browser', `${int(res.dateien)} Dateien kopiert. Der Ordner „${res.name}“ wird nicht mehr verwendet.`);
  } catch (e) {
    fertig();
    err('Nicht zurückgeholt', `${e.message} Ihre Buchhaltung liegt unverändert im Ordner.`);
  }
  refresh();
}

function wire(root) {
  $('#btnApply', root).addEventListener('click', () => apply(root));
  $('#btnInOrdner', root)?.addEventListener('click', () => inOrdnerVerschieben());
  $('#btnInBrowser', root)?.addEventListener('click', () => zurueckInDenBrowser());
  feldHinweis($('#s_taxNumber', root), steuernummerHinweis);
  feldHinweis($('#s_vatId', root), ustIdHinweis);

  // Das Erscheinungsbild wirkt sofort – ausprobieren soll ohne „Übernehmen“ gehen.
  $('#s_theme', root).addEventListener('change', async (e) => {
    await commit('einstellung.darstellung', (db) => {
      db.settings.theme = e.target.value;
      db.settings.updatedAt = new Date().toISOString();
    }, { silent: true });
    applyTheme();
    saveNow();
  });

  $('#btnLock', root).addEventListener('click', () => lockNow());
  $('#btnAbmelden', root).addEventListener('click', () => abmelden());
  $('[data-zu-gestaltung]', root)?.addEventListener('click', (e) => { e.preventDefault(); navigate('rechnungen', { tab: 'gestaltung' }); });
  bildschirmKasten($('#bildschirmBox', root));
  zugaengeKarte($('#zugaengeCard', root));
  geraeteKarte($('#geraeteCard', root));
  zulassungKarte($('#zulassungCard', root));
  benutzerKarte($('#benutzerCard', root), { konto: appInfo.konto });
  kontenKarte($('#kontenCard', root));

  $('#btnPw', root).addEventListener('click', async () => {
    const oldPw = await askPassword({ title: 'Passwort ändern', text: 'Zuerst zur Sicherheit das aktuelle Passwort.', label: 'Aktuelles Passwort', confirmLabel: 'Weiter' });
    if (!oldPw) return;
    const newPw = await askPassword({
      title: 'Neues Passwort',
      text: 'Mindestens 10 Zeichen. Es gibt keine Wiederherstellung, notieren Sie es deshalb an einem sicheren Ort.',
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
      text: 'Der aktuelle Datenbestand wird vollständig durch den Inhalt der Sicherung ersetzt. Erstellen Sie vorher eine Sicherung des jetzigen Standes, wenn Sie ihn behalten wollen.'
        + ' Ist der Cloud-Abgleich eingerichtet, gilt der wiederhergestellte Stand beim nächsten Abgleich auch für Ihre anderen Geräte: Was nach der Sicherung angelegt und schon abgeglichen wurde, verschwindet dann auch dort. Die Verbindungen dieses Geräts (Cloud, Google Kalender) bleiben bestehen.',
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
      // Wie beim Wiederherstellen aus der Cloud: Der Vorgang steht im Journal.
      await commit('sicherung.eingespielt', () => null, {
        entity: 'bestand', summary: `Vollsicherung eingespielt (${res.transactions} Buchungen, ${res.attachments} Belege)`,
      });
      await saveNow();
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
      title: 'Nicht mehr benötigte Belegdateien löschen?',
      text: `Entfernt werden nur Dateien, die zu keiner Buchung mehr gehören. ${int(known.size)} verknüpfte Belege bleiben unangetastet.`,
      confirmLabel: 'Löschen', danger: true,
    });
    if (!yes) return;
    const n = await api.attach.prune([...known]);
    ok(n ? `${n} nicht mehr benötigte Dateien gelöscht` : 'Nichts zu löschen');
    refresh();
  });

  $('#btnLockPeriod', root).addEventListener('click', async () => {
    const date = $('#lockDate', root).value;
    const bisher = lockedUntil();
    if (!date) { warn('Bitte ein Datum wählen'); return; }
    // Festgeschrieben wird Abgeschlossenes. Ein Datum in der Zukunft sperrte
    // Zeiträume, in denen noch gebucht werden muss – und das für immer.
    if (date > todayISO()) { warn('Datum liegt in der Zukunft', 'Festschreiben lässt sich nur ein Zeitraum, der schon vorbei ist, höchstens bis heute.'); return; }
    if (bisher && date <= bisher) { warn('Schon festgeschrieben', `Bis zum ${fmtDate(bisher)} ist bereits festgeschrieben. Wählen Sie ein späteres Datum.`); return; }
    const affected = sel.transactions().filter((t) => t.date <= date && (!bisher || t.date > bisher)).length;
    const yes = await confirmDialog({
      title: 'Zeitraum festschreiben?',
      text: `${affected} ${bisher ? 'weitere ' : ''}Buchungen bis zum ${fmtDate(date)} lassen sich danach nicht mehr ändern oder löschen, nur noch stornieren. Offene Rechnungen lassen sich weiterhin als bezahlt vermerken. Das Festschreiben lässt sich nicht zurücknehmen.`,
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
    text: 'Die Sicherung enthält alle Buchungen und Belege. Wählen Sie ein Passwort. Sie können dasselbe wie für den Tresor nehmen oder ein eigenes.',
    label: 'Passwort für die Sicherung', confirmLabel: 'Sicherung erstellen', repeat: true,
  });
  if (!pw) return;
  toast('Sicherung wird erstellt …', 'Bei vielen Belegen kann das einen Moment dauern.');
  try {
    const res = await api.backup.export(pw);
    if (res) {
      ok('Sicherung erstellt', `${bytes(res.bytes)} · ${res.path}`);
      // Für den Hinweis nach dem Entsperren (app.js): wann zuletzt gesichert wurde, je Gerät.
      try { localStorage.setItem(kontoSchluessel('vollsicherung', appInfo.konto), String(Date.now())); } catch { /* ohne Gedächtnis eben nicht */ }
    }
  } catch (e) {
    err('Sicherung fehlgeschlagen', e.message);
  }
}

/*
 * Vorgänge im Journal in Worten. Gespeichert (und für die Betriebsprüfung
 * exportiert) bleibt die feste Kennung wie „buchung.anlegen“; unbekannte
 * Kennungen erscheinen, wie sie sind.
 */
const DINGE = {
  buchung: 'Buchung', termin: 'Termin', aufgabe: 'Aufgabe', kategorie: 'Kategorie', kontakt: 'Kontakt',
  konto: 'Konto', anlage: 'Anlagegut', wiederkehrend: 'Wiederkehrende Buchung', beleg: 'Beleg',
};
const TUN = {
  anlegen: 'angelegt', aendern: 'geändert', loeschen: 'gelöscht', stornieren: 'storniert', entfernen: 'entfernt',
};
const VORGAENGE = {
  festschreibung: 'Zeitraum festgeschrieben',
  'einstellungen.aendern': 'Einstellungen geändert',
  'einstellung.update': 'Update-Suche geändert',
  'einstellung.darstellung': 'Darstellung geändert',
  'einstellung.kalender': 'Kalender-Abgleich eingestellt',
  'einstellung.datev': 'DATEV-Angaben geändert',
  'konflikte.geleert': 'Konfliktliste geleert',
  'sicherung.eingespielt': 'Vollsicherung eingespielt',
  'sicherung.wiederhergestellt': 'Cloud-Sicherung wiederhergestellt',
  'korrektur.storno': 'Korrektur: Stornos',
  'korrektur.euer': 'Korrektur: EÜR-Zeilen',
  'korrektur.sonderzeichen': 'Korrektur: Sonderzeichen',
  'termin.kalenderabgleich': 'Kalenderabgleich',
  'beleg.aufraeumen': 'Belege aufgeräumt',
  'feedback.neu': 'Rückmeldung gespeichert',
  'feedback.aendern': 'Rückmeldung geändert',
  'feedback.geloescht': 'Rückmeldung gelöscht',
  'wiederkehrend.fortschreiben': 'Wiederkehrende Buchungen angelegt',
  'testdaten.ergaenzen': 'Vorführdaten ergänzt',
  'benutzer.anlegen': 'Benutzer angelegt',
  'benutzer.aendern': 'Benutzer geändert',
  'benutzer.loeschen': 'Benutzer gelöscht',
  'benutzer.abschalten': 'Benutzer abgeschaltet',
  'nutzung.zustimmen': 'Nutzungsbedingungen zugestimmt',
};

export function vorgangText(action) {
  if (VORGAENGE[action]) return VORGAENGE[action];
  const [ding, tun] = String(action || '').split('.');
  return DINGE[ding] && TUN[tun] ? `${DINGE[ding]} ${TUN[tun]}` : String(action || '');
}

function showJournal() {
  const log = [...(store.db.auditLog || [])].reverse().slice(0, 800);
  const vorgaenge = [...new Set(log.map((e) => e.action))].sort((a, b) => vorgangText(a).localeCompare(vorgangText(b), 'de'));
  const m = modal({
    title: 'Änderungsjournal',
    size: 'wide',
    body: html`
      <p class="mt0 small muted">Die letzten ${int(log.length)} von ${int((store.db.auditLog || []).length)} Einträgen.
      Jeder Eintrag enthält die Prüfsumme des vorherigen. So lässt sich nachträgliches Verändern erkennen.</p>
      ${table({
        id: 'journal',
        cls: 'data compact',
        maxHeight: '56vh',
        defaultSort: { key: 'seq', dir: -1 },
        rows: log,
        search: { placeholder: 'Vorgang, Benutzer oder Beschreibung suchen …', text: (e) => [vorgangText(e.action), e.action, e.summary, e.user, e.seq].join(' ') },
        columns: [
          { key: 'seq', label: 'Nr.', type: 'num', tdCls: 'muted' },
          { key: 'ts', label: 'Zeitpunkt', type: 'date', tdCls: 'nowrap small', cell: (e) => esc(fmtDateTime(e.ts)) },
          {
            key: 'action', label: 'Vorgang', type: 'text', tdCls: 'small', value: (e) => vorgangText(e.action),
            cell: (e) => `<span class="badge">${esc(vorgangText(e.action))}</span>`,
          },
          ...(log.some((e) => e.user) ? [{ key: 'user', label: 'Benutzer', type: 'text', tdCls: 'small nowrap', value: (e) => e.user || '', cell: (e) => esc(e.user || '') }] : []),
          { key: 'summary', label: 'Beschreibung', type: 'text', tdCls: 'small', cell: (e) => `<span class="truncate" style="display:block;max-width:340px">${esc(e.summary || '')}</span>` },
          { key: 'hash', label: 'Prüfsumme', type: 'none', tdCls: 'tiny muted', cell: (e) => `<span style="font-family:var(--mono)">${esc((e.hash || '').slice(0, 12))}…</span>` },
        ],
        filters: vorgaenge.length > 1 ? [{
          key: 'vorgang', column: 'action', title: 'Vorgang', initial: '', search: vorgaenge.length > 8,
          options: () => [['', 'Alle Vorgänge', () => true], ...vorgaenge.map((v) => [v, vorgangText(v), (e) => e.action === v])],
        }] : [],
        emptyTitle: 'Noch keine Einträge',
      })}`,
    foot: '<button class="btn primary" data-x>Schließen</button>',
  });
  mountTables(m.root);
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
}
