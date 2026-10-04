/**
 * Kontovia – Einstieg.
 * Kümmert sich um Einrichtung, Entsperren, Rahmen und Navigation.
 */

import { html, raw, esc, $, int, bytes, fmtDateTime, debounce, MOD, ustIdHinweis, steuernummerHinweis } from './lib/util.js';
import { icon, toast, ok, err, warn, modal, passwordInput, wirePasswordToggles, feldHinweis, obersteSchliessen } from './lib/ui.js';
import { store, setDb, clearDb, subscribe, saveNow, sel, lockedUntil, setDevice, commit } from './lib/store.js';
import { startAutoSync, syncState, onSync, syncNow } from './lib/sync.js';
import { updateState, onUpdate, startUpdateWatch, markNotified } from './lib/updates.js';
import { router, onNavigate, navigate, refresh } from './lib/router.js';
import { closePopover, openPopover } from './lib/popover.js';
import { scope } from './lib/prefs.js';
import { startCalendarSync, stopCalendarSync } from './lib/gcalsync.js';
import { VERSIONEN } from './lib/versionen.js';
import { abmelden, entsperrWege } from './lib/zugaenge.js';
import { feedbackOeffnen, entwicklerKlick } from './lib/feedback.js';
import { sucheOeffnen, SUCHE_KUERZEL } from './lib/suche.js';

import * as viewDashboard from './views/dashboard.js';
import * as viewTransactions from './views/transactions.js';
import * as viewCalendar from './views/calendar.js';
import * as viewTodos from './views/todos.js';
import * as viewRechnungen from './views/rechnungen.js';
import * as viewReports from './views/reports.js';
import * as viewExport from './views/export.js';
import * as viewMaster from './views/master.js';
import * as viewSettings from './views/settings.js';
import * as viewHelp from './views/help.js';

const api = window.kontovia;
const app = document.getElementById('app');
export let appInfo = { version: '1.0.0' };

const VIEWS = {
  dashboard: { title: 'Übersicht', icon: 'dashboard', mod: viewDashboard, key: '1' },
  transactions: { title: 'Buchungen', icon: 'book', mod: viewTransactions, key: '2' },
  calendar: { title: 'Kalender', icon: 'calendar', mod: viewCalendar, key: '3' },
  todos: { title: 'Aufgaben', icon: 'todo', mod: viewTodos, key: '7' },
  rechnungen: { title: 'Rechnungen', icon: 'invoice', mod: viewRechnungen, key: '8' },
  reports: { title: 'Auswertungen', icon: 'chart', mod: viewReports, key: '4' },
  export: { title: 'Export & Finanzamt', icon: 'export', mod: viewExport, key: '5' },
  master: { title: 'Stammdaten', icon: 'master', mod: viewMaster, key: '6' },
  settings: { title: 'Einstellungen', icon: 'settings', mod: viewSettings, key: ',' },
  help: { title: 'Hilfe', icon: 'help', mod: viewHelp },
};

/* -------------------------------------------------------------------------- */
/* Thema                                                                       */
/* -------------------------------------------------------------------------- */

const mql = window.matchMedia('(prefers-color-scheme: dark)');
/* Die Wahl steht im Tresor – der ist beim Sperren zu. Damit der
   Sperrbildschirm nicht grell aufleuchtet, wenn jemand dunkel gewählt hat,
   merkt sich das Gerät die letzte Wahl zusätzlich unverschlüsselt. Sie
   verrät nichts außer „hell“ oder „dunkel“. */
const THEME_KEY = 'kontovia.thema';

function lastTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme(pref) {
  const mode = pref || store.db?.settings?.theme || lastTheme();
  const dark = mode === 'dark' || (mode === 'system' && mql.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (store.db) { try { localStorage.setItem(THEME_KEY, mode); } catch { /* egal */ } }
  renderThemeToggle();
}
mql.addEventListener('change', () => applyTheme());

/** Hell, Dunkel oder wie das System – ein Klick, ohne Umweg über die Einstellungen. */
async function setTheme(mode) {
  await commit('einstellung.darstellung', (db) => {
    db.settings.theme = mode;
    db.settings.updatedAt = new Date().toISOString();
  }, { silent: true });
  applyTheme();
  // Steht die Einstellungsseite offen, zeigte ihre Auswahl sonst den alten
  // Wert und schriebe ihn beim nächsten „Übernehmen“ zurück.
  const auswahl = document.getElementById('s_theme');
  if (auswahl) auswahl.value = mode;
  saveNow();
}

function renderThemeToggle() {
  const slot = document.getElementById('themeSlot');
  if (!slot) return;
  const mode = store.db?.settings?.theme || 'system';
  const opts = [['light', 'Hell', 'sun'], ['dark', 'Dunkel', 'moon'], ['system', 'Auto', 'settings']];
  slot.innerHTML = `<div class="seg sm theme-toggle" role="group" aria-label="Erscheinungsbild">${opts.map(([v, t, ic]) => `
    <button type="button" data-theme-set="${v}" class="${mode === v ? 'active' : ''}" aria-pressed="${mode === v}"
      title="${v === 'system' ? 'Wie das Betriebssystem' : t}">${icon(ic, 14).__raw}<span>${t}</span></button>`).join('')}</div>`;
  slot.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.themeSet !== mode) setTheme(b.dataset.themeSet);
  }));
}

/* -------------------------------------------------------------------------- */
/* Start                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  applyTheme(lastTheme());
  try {
    appInfo = await api.app.info();
    // Ohne Gerätekennung könnte das Änderungsjournal beim Abgleich zweier
    // Rechner nicht mehr geräteweise geprüft werden.
    setDevice(appInfo.deviceId);
  } catch { /* Standardwerte behalten */ }
  const status = await api.vault.status();
  // Web-Fassung: zurück von einer Anmeldung per Weiterleitung zu Google?
  const rm = await api.cloud.rueckmeldung?.().catch(() => null);
  if (rm?.fehler && !rm.abgebrochen) err('Anmeldung bei Google', rm.fehler);
  // Web-Fassung mit Ordner auf dem Gerät: Ohne Zugriff kein Tresor, und ein
  // fehlender Ordner ist kein Grund, still eine neue Buchhaltung anzufangen.
  if (status.speicher?.art === 'ordner' && status.speicher.zugriff !== 'granted') { renderOrdnerZugriff(status.speicher); return; }
  if (status.speicher?.art === 'ordner' && !status.exists) { renderOrdnerFehlt(status.speicher); return; }
  if (!status.exists) { renderSetup(); return; }
  // Eben aus dem Programm heraus aktualisiert: weiter ohne Passwort. Der
  // Startbildschirm sagt schon vorher, was gerade geschieht.
  if (status.fortsetzen) {
    const gate = document.querySelector('.gate-card');
    if (gate) {
      gate.querySelector('h2').textContent = `Kontovia ${appInfo.version} ist installiert`;
      gate.querySelector('.lead').textContent = 'Sie werden gleich angemeldet.';
    }
  }
  if (status.fortsetzen && await nachAktualisierung()) return;
  if (rm?.zweck === 'entsperren') {
    if (rm.fehler) { if (!rm.abgebrochen) { renderUnlock(rm.fehler); return; } }
    else {
      try {
        eintreten(await api.entsperrung.googleFortsetzen());
        return;
      } catch (e) {
        renderUnlock(e.message);
        return;
      }
    }
  }
  renderUnlock(rm?.zweck === 'verbinden' && !rm.fehler
    ? `Bei Google angemeldet als ${rm.email || 'Ihr Konto'}. Entsperren Sie Kontovia, um die Verbindung zu speichern.`
    : status.fortsetzen
      ? 'Kontovia wurde aktualisiert. Bitte melden Sie sich dieses eine Mal mit Ihrem Passwort an.'
      : '');
}

/**
 * Erster Start nach einer Aktualisierung aus dem Programm heraus: Die
 * Web-Schicht hat den Tresorschlüssel für genau diesen Start bekommen
 * (src/web/uebergabe.js). Klappt es nicht, bleibt die Passwortabfrage.
 */
async function nachAktualisierung() {
  const db = await api.vault.resume().catch(() => null);
  if (!db) return false;
  ebenAktualisiert = true;
  eintreten(db);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Neuigkeiten nach einem Update                                               */
/* -------------------------------------------------------------------------- */

/** Welche Version auf diesem Gerät zuletzt geöffnet wurde. */
const VERSION_KEY = 'kontovia.version';
/** Eben aus dem Programm heraus aktualisiert – der Hinweis sagt dann auch das. */
let ebenAktualisiert = false;
/** Eben eingerichtet oder aus der Cloud geladen – dann ist nichts „neu“. */
let ohneNeuigkeiten = false;

/**
 * Nach dem ersten Öffnen einer neuen Version einmal auf die Neuigkeiten
 * hinweisen. Gemerkt wird je Gerät, nicht im Tresor: Jedes Gerät wird für
 * sich aktualisiert.
 */
function neuigkeitenHinweis() {
  let vorher = null;
  try {
    vorher = localStorage.getItem(VERSION_KEY);
    localStorage.setItem(VERSION_KEY, appInfo.version);
  } catch {
    // Ohne Gedächtnis auf dem Gerät nur dann, wenn das Update eben selbst lief.
    vorher = ebenAktualisiert ? '' : appInfo.version;
  }
  const ueberspringen = ohneNeuigkeiten;
  ohneNeuigkeiten = false;
  if (ueberspringen || vorher === appInfo.version) return;
  const v = VERSIONEN.find((e) => e.version === appInfo.version);
  const text = (ebenAktualisiert ? 'Sie sind weiterhin angemeldet. ' : '')
    + (v ? `${v.titel}. ` : '') + 'Hier klicken für alle Neuigkeiten.';
  toast(ebenAktualisiert ? `Aktualisierung abgeschlossen: Version ${appInfo.version}` : `Neu in Kontovia ${appInfo.version}`, text, 'ok', 12000)
    ?.addEventListener('click', () => navigate('help', { tab: 'neu' }));
  ebenAktualisiert = false;
}

/** Öffnet die Buchhaltung, sobald der Tresor entsperrt ist. */
function eintreten(db) {
  setDb(db);
  applyTheme();
  renderShell();
  navigate(db.settings.startView || 'dashboard', {}, { ersetzen: true });
  afterUnlock();
}

/* -------------------------------------------------------------------------- */
/* Einrichtung                                                                 */
/* -------------------------------------------------------------------------- */

function passwordScore(pw) {
  if (!pw) return { score: 0, label: 'zu kurz', color: 'var(--neg)' };
  let pool = 0;
  if (/[a-zäöüß]/.test(pw)) pool += 26;
  if (/[A-ZÄÖÜ]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const uniq = new Set(pw).size;
  const bits = Math.log2(Math.max(pool, 2)) * pw.length * Math.min(1, (uniq + 4) / pw.length);
  if (pw.length < 10) return { score: 12, label: 'zu kurz (mind. 10 Zeichen)', color: 'var(--neg)' };
  if (bits < 55) return { score: 33, label: 'schwach', color: 'var(--neg)' };
  if (bits < 75) return { score: 60, label: 'brauchbar', color: 'var(--warn)' };
  if (bits < 100) return { score: 82, label: 'stark', color: 'var(--pos)' };
  return { score: 100, label: 'sehr stark', color: 'var(--pos)' };
}

function renderSetup() {
  let step = 0;
  const data = {
    companyName: '', ownerName: '', street: '', zip: '', city: '',
    taxNumber: '', vatId: '', taxOffice: '',
    taxMode: 'regelbesteuerung', accountingBasis: 'ist', defaultVatRate: 19,
    vatPeriod: 'vierteljährlich', chartOfAccounts: 'SKR03',
    // Bewusst ohne Vorgabe: eine vorausgewählte Zustimmung wäre keine.
    updateCheckOnStart: undefined,
  };

  const stepsHtml = () => `<div class="steps">${[0, 1, 2].map((i) => `<i class="${i <= step ? 'done' : ''}"></i>`).join('')}</div>`;

  /* Anmeldung mit Google, bevor es einen Tresor gibt. Liegt im Konto schon
     eine Buchhaltung, wird sie geladen (renderCloudLaden); sonst verbindet
     die Web-Schicht den neuen Tresor beim Anlegen mit dem Konto. */
  let anmeldenMoeglich = false;
  /** Web-Fassung: Anmeldung per Weiterleitung statt Code möglich? */
  let weiterleitung = false;
  /** …und der Code als Rückfallweg? */
  let mitCodeMoeglich = false;
  let anmeldung = null;
  let wartet = false;
  let abgebrochen = false;

  /** Chrome und Edge: eine Buchhaltung öffnen, die schon in einem Ordner liegt (etwa von Windows). */
  let ordnerMoeglich = false;
  const ordnerKasten = () => (step !== 0 || !ordnerMoeglich || anmeldung ? '' : `<div class="signin-box mb16">
      <div><strong>Buchhaltung in einem Ordner?</strong>
      <div class="small muted">Haben Sie Kontovia unter Windows oder schon in einem Ordner auf diesem Gerät
      benutzt? Öffnen Sie diesen Ordner; Kontovia arbeitet dann direkt darin.</div></div>
      <button class="btn" id="o_oeffnen">${icon('folder', 15).__raw} Ordner öffnen</button></div>`);

  const anmeldeKasten = () => {
    if (anmeldung && !anmeldung.vorhanden) {
      return `<div class="signin-box ok mb16">
        <div>Angemeldet als <strong>${esc(anmeldung.email || 'Google-Konto')}</strong>
        <div class="small muted">Ihre Buchhaltung wird nach dem Anlegen verschlüsselt in Ihrem Konto
        gesichert und lässt sich auf weiteren Geräten laden.</div></div>
        <button class="btn ghost sm" id="g_abmelden">Abmelden</button></div>`;
    }
    if (step !== 0 || !anmeldenMoeglich) return '';
    if (wartet) {
      return `<div class="signin-box mb16">
        <div><strong>${wartet === 'weiterleitung' ? 'Weiter zu Google …' : 'Warte auf die Anmeldung …'}</strong>
        <div class="small muted">${wartet === 'weiterleitung' ? 'Nach der Anmeldung kommen Sie hierher zurück.'
          : 'Geben Sie den angezeigten Code bei Google ein.'}</div></div>
        <button class="btn sm" id="g_abbrechen">Abbrechen</button></div>`;
    }
    return `<div class="signin-box mb16">
      <div><strong>Kontovia schon auf einem anderen Gerät?</strong>
      <div class="small muted">Mit Google anmelden und Ihre Buchhaltung aus der Cloud laden, oder
      eine neue gleich verschlüsselt in Ihrem Konto sichern. Das geht auch später in den Einstellungen.</div></div>
      <div class="stack" style="gap:4px;align-items:flex-end">
        <button class="btn" id="g_anmelden">${icon('key', 15).__raw} Mit Google anmelden</button>
        ${weiterleitung && mitCodeMoeglich ? '<button class="btn ghost sm" id="g_code">Stattdessen mit Code</button>' : ''}
      </div></div>`;
  };

  /* Der Kasten zeichnet sich allein neu – Eingaben in den Feldern darunter
     bleiben dabei unberührt, auch wenn die Antwort mitten im Tippen kommt. */
  function kastenZeichnen() {
    const box = $('#g_box');
    if (!box) return;
    box.innerHTML = anmeldeKasten() + ordnerKasten();
    $('#o_oeffnen', box)?.addEventListener('click', () => vorhandenenOrdnerOeffnen());
    $('#g_anmelden', box)?.addEventListener('click', () => anmelden());
    $('#g_code', box)?.addEventListener('click', () => anmelden({ mitCode: true }));
    $('#g_abbrechen', box)?.addEventListener('click', () => {
      abgebrochen = true;
      wartet = false;
      api.cloud.signinCancel().catch(() => {});
      kastenZeichnen();
    });
    $('#g_abmelden', box)?.addEventListener('click', () => {
      anmeldung = null;
      api.cloud.signinCancel().catch(() => {});
      kastenZeichnen();
    });
  }

  async function anmelden({ mitCode = false } = {}) {
    // Per Weiterleitung verlässt die Seite Kontovia und lädt danach neu;
    // weiter geht es dann unten bei signinStatus().
    wartet = weiterleitung && !mitCode ? 'weiterleitung' : true;
    abgebrochen = false;
    kastenZeichnen();
    try {
      const st = await api.cloud.signin({ mitCode });
      wartet = false;
      // Abgebrochen, während die Antwort unterwegs war: nichts zurückbehalten.
      if (abgebrochen) { api.cloud.signinCancel().catch(() => {}); return; }
      anmeldung = st;
      if (st.vorhanden) {
        collect();
        renderCloudLaden(st, {
          neu: () => { anmeldung = null; draw(); },
        });
        return;
      }
      ok('Mit Google angemeldet', st.email || '');
    } catch (e) {
      wartet = false;
      if (e.code !== 'ABGEBROCHEN' && !abgebrochen) err('Anmeldung fehlgeschlagen', e.message);
    }
    kastenZeichnen();
  }

  const bodies = [
    () => html`
      <h2>Willkommen bei Kontovia</h2>
      <p class="lead">Ihre Buchhaltung bleibt auf diesem Gerät, verschlüsselt mit
      Ihrem Passwort. Es gibt kein Benutzerkonto beim Hersteller und keine Telemetrie; Ihre
      Buchhaltung verlässt das Gerät nur, wenn Sie den Cloud-Abgleich einschalten. Zuerst ein
      paar Angaben zu Ihrem Betrieb. Sie lassen sich später ändern.</p>
      <div class="form-grid">
        <div class="field full"><label>Firma / Name des Betriebs</label><input id="f_companyName" value="${data.companyName}" placeholder="z. B. Musterbau GmbH oder Ihr Name"></div>
        <div class="field full"><label>Inhaber / Ansprechpartner</label><input id="f_ownerName" value="${data.ownerName}"></div>
        <div class="field full"><label>Straße und Hausnummer</label><input id="f_street" value="${data.street}"></div>
        <div class="field"><label>PLZ</label><input id="f_zip" value="${data.zip}"></div>
        <div class="field"><label>Ort</label><input id="f_city" value="${data.city}"></div>
        <div class="field"><label>Steuernummer</label><input id="f_taxNumber" value="${data.taxNumber}" placeholder="12/345/67890"></div>
        <div class="field"><label>Umsatzsteuer-Identifikationsnummer</label><input id="f_vatId" value="${data.vatId}" placeholder="DE123456789"></div>
        <div class="field full"><label>Zuständiges Finanzamt</label><input id="f_taxOffice" value="${data.taxOffice}"></div>
      </div>`,

    () => html`
      <h2>Steuerliche Einstellungen</h2>
      <p class="lead">Diese Einstellungen bestimmen, wie Kontovia rechnet. Wenn Sie
      unsicher sind: Die Voreinstellung passt für die meisten Selbstständigen und
      kleinen Betriebe. Die Anlage EÜR folgt immer dem Zahlungsfluss.</p>
      <div class="field">
        <label>Umsatzsteuer</label>
        <select id="f_taxMode">
          <option value="regelbesteuerung" ${data.taxMode === 'regelbesteuerung' ? 'selected' : ''}>Regelbesteuerung (ich weise Umsatzsteuer aus)</option>
          <option value="kleinunternehmer" ${data.taxMode === 'kleinunternehmer' ? 'selected' : ''}>Kleinunternehmer nach § 19 UStG (keine Umsatzsteuer)</option>
        </select>
        <span class="hint">Als Kleinunternehmer rechnet Kontovia durchgehend mit Bruttobeträgen und blendet alle Umsatzsteuerfelder aus.</span>
      </div>
      <div class="field" id="f_vatBlock" ${data.taxMode === 'kleinunternehmer' ? 'hidden' : ''}>
        <label>Umsatzsteuer berechnen nach</label>
        <select id="f_accountingBasis">
          <option value="ist" ${data.accountingBasis === 'ist' ? 'selected' : ''}>Zahlungseingang (Ist-Versteuerung, § 20 UStG, auf Antrag)</option>
          <option value="soll" ${data.accountingBasis === 'soll' ? 'selected' : ''}>Rechnungsdatum (Soll-Versteuerung, gesetzlicher Regelfall)</option>
        </select>
        <span class="hint">Steht in Ihrem Steuerbescheid oder im Fragebogen zur steuerlichen Erfassung.
        Selbstständige und Betriebe bis 800.000 € Umsatz bekommen die Ist-Versteuerung meist auf Antrag.
        Die Anlage EÜR rechnet in beiden Fällen nach Zahlungsfluss (§ 11 EStG).</span>
      </div>
      <div class="form-grid">
        <div class="field" ${data.taxMode === 'kleinunternehmer' ? 'hidden' : ''} data-vat-only>
          <label>Voreingestellter Steuersatz</label>
          <select id="f_defaultVatRate">
            ${raw(['19', '7', '0'].map((v) => `<option value="${v}" ${String(data.defaultVatRate) === v ? 'selected' : ''}>${v} %</option>`).join(''))}
          </select>
        </div>
        <div class="field" ${data.taxMode === 'kleinunternehmer' ? 'hidden' : ''} data-vat-only>
          <label>Voranmeldungszeitraum</label>
          <select id="f_vatPeriod">
            ${raw(['monatlich', 'vierteljährlich', 'jährlich'].map((v) => `<option value="${v}" ${data.vatPeriod === v ? 'selected' : ''}>${v}</option>`).join(''))}
          </select>
        </div>
        <div class="field full">
          <label>Kontenrahmen für den DATEV-Export</label>
          <select id="f_chartOfAccounts">
            <option value="SKR03" ${data.chartOfAccounts !== 'SKR04' ? 'selected' : ''}>SKR03 (Prozessgliederung, am weitesten verbreitet)</option>
            <option value="SKR04" ${data.chartOfAccounts === 'SKR04' ? 'selected' : ''}>SKR04 (Abschlussgliederung)</option>
          </select>
        </div>
      </div>`,

    () => html`
      <h2>Passwort festlegen</h2>
      <p class="lead">Ihre gesamte Buchhaltung wird mit diesem Passwort verschlüsselt.
      Ohne das Passwort sind die Daten unwiederbringlich verloren. Es gibt keine
      Hintertür und keine Zurücksetzfunktion.</p>
      <div class="field">
        <label>Passwort</label>
        ${passwordInput('f_pw1', { autocomplete: 'new-password' })}
        <div class="pw-meter"><i id="pwbar"></i></div>
        <span class="hint" id="pwhint">Mindestens 10 Zeichen. Eine Folge aus vier zufälligen Wörtern ist leichter zu merken und sicherer als „Sommer2024!“.</span>
      </div>
      <div class="field">
        <label>Passwort wiederholen</label>
        ${passwordInput('f_pw2', { autocomplete: 'new-password' })}
      </div>
      <div class="notice warn mt8">
        <strong>Bitte notieren Sie das Passwort an einem sicheren Ort.</strong>
        Ein Passwortmanager oder ein Zettel im Safe ist besser, als sich aufs Gedächtnis
        zu verlassen. Legen Sie außerdem regelmäßig Vollsicherungen an
        (Einstellungen → Sicherung und Speicherort).
      </div>
      <div class="field mt16">
        <label>Soll Kontovia nach neuen Programmversionen suchen?</label>
        <div class="row wrap" style="gap:16px">
          <label class="check"><input type="radio" name="f_updateCheckOnStart" value="ja" ${data.updateCheckOnStart === true ? 'checked' : ''}> Ja, beim Start und alle sechs Stunden</label>
          <label class="check"><input type="radio" name="f_updateCheckOnStart" value="nein" ${data.updateCheckOnStart === false ? 'checked' : ''}> Nein</label>
        </div>
        <span class="hint">Dafür ruft Kontovia eine kleine Versionsdatei ab; der Betreiber des
        Servers sieht dabei Ihre IP-Adresse, sonst nichts. Installiert wird nur nach Ihrer
        Bestätigung. Ohne Antwort fragt Kontovia beim ersten Entsperren noch einmal. Jederzeit
        unter Einstellungen → Programmaktualisierung änderbar.</span>
      </div>
      <div class="err small mt8" id="pwerr"></div>`,
  ];

  function draw() {
    app.innerHTML = html`
      <div class="gate">
        <div class="gate-card wide">
          <div class="gate-logo">K</div>
          ${raw(stepsHtml())}
          <div id="g_box"></div>
          ${raw(bodies[step]())}
          <div class="row end mt24" style="gap:8px">
            ${step > 0 ? raw('<button class="btn" id="back">Zurück</button>') : ''}
            <div class="spacer"></div>
            <button class="btn primary lg" id="next">${step === 2 ? 'Tresor anlegen' : 'Weiter'}</button>
          </div>
        </div>
      </div>`;

    kastenZeichnen();
    feldHinweis($('#f_taxNumber'), steuernummerHinweis);
    feldHinweis($('#f_vatId'), ustIdHinweis);
    $('#f_taxMode')?.addEventListener('change', (e) => {
      const klein = e.target.value === 'kleinunternehmer';
      app.querySelectorAll('#f_vatBlock, [data-vat-only]').forEach((n) => { n.hidden = klein; });
    });

    if (step === 2) {
      wirePasswordToggles(app);
      const pw1 = $('#f_pw1');
      const bar = $('#pwbar');
      const hint = $('#pwhint');
      pw1.addEventListener('input', () => {
        const s = passwordScore(pw1.value);
        bar.style.width = s.score + '%';
        bar.style.background = s.color;
        hint.textContent = pw1.value ? `Einschätzung: ${s.label}` : 'Mindestens 10 Zeichen.';
      });
    }

    $('#back')?.addEventListener('click', () => { collect(); step--; draw(); });
    $('#next').addEventListener('click', async () => {
      collect();
      if (step < 2) { step++; draw(); return; }
      const pw1 = $('#f_pw1').value;
      const pw2 = $('#f_pw2').value;
      const errEl = $('#pwerr');
      if (pw1.length < 10) { errEl.textContent = 'Das Passwort muss mindestens 10 Zeichen haben.'; return; }
      if (pw1 !== pw2) { errEl.textContent = 'Die beiden Eingaben stimmen nicht überein.'; return; }
      const btn = $('#next');
      btn.disabled = true;
      btn.textContent = 'Verschlüssele …';
      try {
        const db = await api.vault.create(pw1, { ...data, defaultVatRate: Number(data.defaultVatRate) });
        setDb(db);
        applyTheme();
        renderShell();
        navigate('dashboard', {}, { ersetzen: true });
        ohneNeuigkeiten = true;
        afterUnlock();
        toast('Tresor angelegt', 'Ihre Daten liegen verschlüsselt in ' + (appInfo.dataDir || 'Ihrem Benutzerordner')
          + (anmeldung ? ' und werden gleich in Ihrem Google-Konto gesichert.' : ''), 'ok', 7000);
      } catch (e) {
        errEl.textContent = e.message;
        btn.disabled = false;
        btn.textContent = 'Tresor anlegen';
      }
    });

    app.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#next').click();
    }));
  }

  function collect() {
    for (const key of Object.keys(data)) {
      const node = $('#f_' + key);
      if (node) data[key] = node.type === 'checkbox' ? node.checked : node.value;
    }
    // Die Update-Frage ist eine echte Wahl: ohne Antwort bleibt sie offen und
    // wird beim ersten Entsperren erneut gestellt.
    const wahl = $('input[name="f_updateCheckOnStart"]:checked');
    if (wahl) data.updateCheckOnStart = wahl.value === 'ja';
  }

  draw();
  api.speicher?.status().then((sp) => { ordnerMoeglich = !!sp?.moeglich; kastenZeichnen(); }).catch(() => {});
  // Ob sich diese Fassung bei Google anmelden kann, steht erst nach der Abfrage fest.
  api.cloud.signinStatus?.().then((st) => {
    anmeldenMoeglich = !!st?.moeglich;
    weiterleitung = !!st?.weiterleitung;
    mitCodeMoeglich = !!st?.code;
    // Zurück von Google (Web-Fassung): die Anmeldung steht schon.
    if (st?.angemeldet && !anmeldung) {
      anmeldung = st;
      if (st.vorhanden && app.querySelector('.gate-card')) {
        collect();
        renderCloudLaden(st, { neu: () => { anmeldung = null; draw(); } });
        return;
      }
      ok('Mit Google angemeldet', st.email || '');
    }
    kastenZeichnen();
  }).catch(() => {});
}

/**
 * Neues Gerät: Im Google-Konto liegt schon eine Buchhaltung. Sie wird mit
 * ihrem Passwort geladen – geprüft, bevor auf dem Gerät etwas entsteht.
 */
function renderCloudLaden(st, { neu }) {
  app.innerHTML = html`
    <div class="gate">
      <div class="gate-card">
        <div class="gate-logo">K</div>
        <h2>Buchhaltung aus der Cloud laden</h2>
        <p class="lead">Angemeldet als <strong>${st.email || 'Google-Konto'}</strong>. In Ihrem Konto
        liegt eine Kontovia-Buchhaltung${st.stand ? raw(`, Stand ${esc(fmtDateTime(st.stand))}`) : ''}${st.groesse ? raw(` (${esc(bytes(st.groesse))})`) : ''}.
        Sie ist mit dem Passwort verschlüsselt, das Sie auf Ihrem anderen Gerät festgelegt haben.</p>
        <div class="field">
          <label>Passwort der Buchhaltung</label>
          ${passwordInput('cloudPw', { autocomplete: 'current-password' })}
        </div>
        <div class="err small mb16" id="cloudErr"></div>
        <button class="btn primary lg block" id="cloudLaden">Laden und entsperren</button>
        ${st.schluessel ? raw('<button class="btn lg block mt8" id="cloudOhnePw">Ohne Passwort laden (Anmeldung bei Google genügt)</button>') : ''}
        <p class="tiny muted mt16" style="text-align:center">Die Belege kommen danach im Hintergrund nach.</p>
        <details class="forgot small mt8">
          <summary>Passwort vergessen?</summary>
          <p>Ohne das Passwort lässt sich die Buchhaltung nicht öffnen, weder von Kontovia noch
          von Google. Ist sie auf einem anderen Gerät noch entsperrt, ändern Sie dort unter
          <em>Einstellungen → Sicherheit</em> das Passwort und gleichen ab; danach gilt hier das neue.</p>
        </details>
        <div class="row mt16" style="gap:8px;justify-content:space-between">
          <button class="btn ghost sm" id="cloudAbmelden">Abmelden</button>
          <button class="btn ghost sm" id="cloudNeu">Stattdessen neu anfangen</button>
        </div>
      </div>
    </div>`;

  const pw = $('#cloudPw');
  const btn = $('#cloudLaden');
  const errEl = $('#cloudErr');
  wirePasswordToggles(app);
  pw.focus();

  const geladen = (db) => {
    setDb(db);
    applyTheme();
    renderShell();
    navigate(db.settings?.startView || 'dashboard', {}, { ersetzen: true });
    ohneNeuigkeiten = true;
    afterUnlock();
    toast('Buchhaltung geladen', 'Dieses Gerät ist jetzt mit Ihrem Google-Konto verbunden. Belege werden im Hintergrund geholt.', 'ok', 8000);
  };
  $('#cloudOhnePw')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    btn.disabled = true;
    errEl.textContent = '';
    try { geladen(await api.entsperrung.googleLaden()); } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      ev.currentTarget.disabled = false;
    }
  });
  const laden = async () => {
    if (!pw.value) return;
    btn.disabled = true;
    btn.textContent = 'Lade und entschlüssele …';
    errEl.textContent = '';
    try {
      const db = await api.cloud.signinLoad(pw.value);
      pw.value = '';
      geladen(db);
    } catch (e) {
      errEl.textContent = e.code === 'BAD_PASSWORD' ? 'Das Passwort passt nicht zu dieser Buchhaltung.' : e.message;
      btn.disabled = false;
      btn.textContent = 'Laden und entsperren';
      pw.select();
    }
  };
  btn.addEventListener('click', laden);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') laden(); });

  // Ohne Laden zurück in die Einrichtung. Die Buchhaltung im Konto bleibt
  // unberührt; verbinden lässt sich später in den Einstellungen.
  const zurueck = async (text) => {
    await api.cloud.signinCancel().catch(() => {});
    neu();
    if (text) toast(text[0], text[1], '', 9000);
  };
  $('#cloudAbmelden').addEventListener('click', () => zurueck());
  $('#cloudNeu').addEventListener('click', () => zurueck(['Neue Buchhaltung',
    'Die Buchhaltung in Ihrem Google-Konto bleibt unberührt. Wenn Sie dieses Gerät später in den Einstellungen verbinden, fragt Kontovia, welche gelten soll.']));
}

/* -------------------------------------------------------------------------- */
/* Speicherort: Ordner auf dem Gerät (Web-Fassung)                             */
/* -------------------------------------------------------------------------- */

/** Unter Windows liegt der Datenordner hier; der Browser gibt ihn nicht direkt frei. */
const WINDOWS_ORDNER = '%APPDATA%\\Kontovia\\daten';

/**
 * Einen Ordner wählen, in dem schon eine Buchhaltung liegt, und mit ihm
 * weiterarbeiten. Aus der Einrichtung und aus den Hinweisen zu einem
 * fehlenden Ordner.
 */
async function vorhandenenOrdnerOeffnen() {
  let wahl;
  try {
    wahl = await api.speicher.ordnerWaehlen({ zweck: 'oeffnen' });
  } catch (e) {
    err('Ordner nicht geöffnet', e.message);
    return;
  }
  if (!wahl) return;
  if (!wahl.tresor) {
    toast('Keine Buchhaltung gefunden', `Im Ordner „${wahl.pfad}“ liegt keine Kontovia-Buchhaltung. Unter Windows liegt sie im Ordner ${WINDOWS_ORDNER}. `
      + 'Den gibt der Browser nicht direkt frei: Kopieren Sie ihn zum Beispiel in Ihre Dokumente und wählen Sie dann die Kopie.', 'err', 20000);
    return;
  }
  try {
    const sp = await api.speicher.ordnerOeffnen();
    renderUnlock(`Die Buchhaltung im Ordner „${sp.name}“ ist bereit. Entsperren Sie sie mit ihrem Passwort. `
      + 'Arbeitet Kontovia unter Windows mit demselben Ordner, öffnen Sie bitte nie beide gleichzeitig.');
  } catch (e) {
    toast('Ordner nicht übernommen', e.message, 'err', 15000);
  }
}

/** Nach einem Neustart fragt der Browser, ob Kontovia wieder auf den Ordner zugreifen darf. */
function renderOrdnerZugriff(sp) {
  app.innerHTML = html`
    <div class="gate">
      <div class="gate-card">
        <div class="gate-logo">K</div>
        <h2>Zugriff auf Ihren Ordner</h2>
        <p class="lead">Ihre Buchhaltung liegt im Ordner <strong>„${sp.name}“</strong> auf diesem Gerät.
        Der Browser fragt nach einem Neustart, ob Kontovia wieder darauf zugreifen darf.</p>
        ${sp.zugriff === 'denied' ? raw(`<div class="notice warn mb16">Der Zugriff wurde abgelehnt. Ohne ihn kann
          Kontovia die Buchhaltung nicht öffnen. Erlauben Sie ihn, oder setzen Sie die Berechtigung in den
          Website-Einstellungen des Browsers zurück.</div>`) : ''}
        <div class="err small mb16" id="ordnerErr"></div>
        <button class="btn primary lg block" id="ordnerErlauben">${icon('folder', 16)} Zugriff erlauben</button>
        <p class="tiny muted mt16" style="text-align:center">Wählen Sie im Browser „Bei jedem Besuch zulassen“,
        wenn er es anbietet. Dann entfällt die Frage künftig.</p>
        <details class="forgot small mt8">
          <summary>Ordner verschoben oder anderen verwenden?</summary>
          <p>Wurde der Ordner verschoben oder umbenannt, wählen Sie ihn neu aus.</p>
          <div class="row wrap" style="gap:8px">
            <button type="button" class="btn sm" id="ordnerNeu">Ordner neu wählen</button>
            <button type="button" class="btn sm ghost" id="ordnerWeg">Ordner nicht mehr verwenden</button>
          </div>
        </details>
      </div>
    </div>`;
  $('#ordnerErlauben').addEventListener('click', async () => {
    const z = await api.speicher.zugriffErlauben().catch(() => 'denied');
    if (z === 'granted') boot();
    else $('#ordnerErr').textContent = 'Ohne Zugriff kann Kontovia die Buchhaltung nicht öffnen.';
  });
  ordnerAuswegeVerdrahten(sp);
}

/** Der gemerkte Ordner ist erreichbar, aber ohne Buchhaltung: verschoben, umbenannt oder geleert. */
function renderOrdnerFehlt(sp) {
  app.innerHTML = html`
    <div class="gate">
      <div class="gate-card">
        <div class="gate-logo">K</div>
        <h2>Buchhaltung nicht gefunden</h2>
        <p class="lead">Kontovia speichert Ihre Buchhaltung im Ordner <strong>„${sp.name}“</strong>, aber dort
        liegt sie nicht mehr. Wurde der Ordner verschoben, umbenannt oder geleert?</p>
        <div class="row wrap mt16" style="gap:8px">
          <button class="btn primary" id="ordnerNeu">${icon('folder', 15)} Ordner neu wählen</button>
          <button class="btn ghost" id="ordnerWeg">Ordner nicht mehr verwenden</button>
        </div>
        <p class="small muted mt16 mb0">Ohne Ordner beginnt Kontovia mit dem leeren Speicher dieses Browsers.
        Dort lässt sich eine Vollsicherung einspielen oder die Buchhaltung aus der Cloud laden.</p>
      </div>
    </div>`;
  ordnerAuswegeVerdrahten(sp);
}

function ordnerAuswegeVerdrahten(sp) {
  $('#ordnerNeu')?.addEventListener('click', async () => {
    try { await api.speicher.ordnerVergessen(); } catch (e) { err('Ordner', e.message); return; }
    await vorhandenenOrdnerOeffnen();
    const st = await api.speicher.status().catch(() => null);
    if (st?.art !== 'ordner') boot();
  });
  $('#ordnerWeg')?.addEventListener('click', async () => {
    const m = modal({
      title: 'Ordner nicht mehr verwenden?',
      size: 'slim',
      body: html`<p class="mt0">Kontovia vergisst den Ordner „${sp.name}“. Die Dateien darin bleiben unberührt;
        Sie können den Ordner später wieder öffnen.</p>
        <p class="mb0">Danach startet Kontovia mit dem Speicher dieses Browsers.</p>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Nicht mehr verwenden</button>',
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-ja]').addEventListener('click', async () => {
      m.close();
      try { await api.speicher.ordnerVergessen(); } catch (e) { err('Ordner', e.message); return; }
      boot();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Entsperren                                                                  */
/* -------------------------------------------------------------------------- */

function renderUnlock(message = '') {
  app.innerHTML = html`
    <div class="gate">
      <div class="gate-card">
        <div class="gate-logo">K</div>
        <h2>Kontovia ist gesperrt</h2>
        <p class="lead">Geben Sie Ihr Passwort ein, um die Buchhaltung zu entschlüsseln.</p>
        ${message ? raw(`<div class="notice mb16">${esc(message)}</div>`) : ''}
        <div class="field">
          <label>Passwort</label>
          ${passwordInput('pw', { autocomplete: 'current-password' })}
        </div>
        <div class="err small mb16" id="unlockerr"></div>
        <button class="btn primary lg block" id="unlock">Entsperren</button>
        <div id="entWege" class="mt16"></div>
        <p class="tiny muted mt16" style="text-align:center">
          Das Entschlüsseln dauert etwa eine Sekunde. Das bremst Angreifer,
          die Passwörter durchprobieren.
        </p>
        <details class="forgot small mt8">
          <summary>Passwort vergessen?</summary>
          <p>Ohne Passwort lässt sich der Tresor nicht öffnen, auch nicht vom Hersteller. Das
          schützt Ihre Buchhaltung, falls jemand die Datei in die Hände bekommt.</p>
          <p>Haben Sie eine <strong>Vollsicherung (.kvbak)</strong>, deren Passwort Sie kennen:
          In den Einstellungen des Browsers die Website-Daten dieser Seite löschen, Kontovia neu laden, einen neuen
          Tresor anlegen und unter <em>Einstellungen → Sicherung wiederherstellen</em> einspielen.</p>
          <p class="muted">Die automatischen Sicherungen sind mit dem Tresorpasswort verschlüsselt, das zu ihrer Zeit galt.</p>
        </details>
        <div class="row mt16" style="justify-content:center">
          <button class="btn ghost sm" id="unlockAbmelden">${icon('logout', 14)} Von diesem Gerät abmelden</button>
        </div>
      </div>
    </div>`;

  const pw = $('#pw');
  const errEl = $('#unlockerr');
  const btn = $('#unlock');
  wirePasswordToggles(app);
  pw.focus();

  const submit = async () => {
    if (!pw.value) return;
    btn.disabled = true;
    btn.textContent = 'Entschlüssele …';
    errEl.textContent = '';
    try {
      const db = await api.vault.unlock(pw.value);
      pw.value = '';
      eintreten(db);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Entsperren';
      pw.select();
    }
  };
  btn.addEventListener('click', submit);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('#unlockAbmelden').addEventListener('click', () => abmelden({ gesperrt: true }));
  entsperrWege($('#entWege'), { eintreten, melde: (t) => { errEl.textContent = t; } });
}


/**
 * Sagt einmal an, was die Schemapflege beim Laden umgestellt hat, und
 * vermerkt es im Änderungsjournal – eine Umdatierung von Buchungen soll dort
 * nachvollziehbar stehen wie jede andere Änderung.
 */
async function announceMigrations() {
  const hinweise = store.hinweise || [];
  store.hinweise = [];
  const ART = {
    storno: ['Stornos korrigiert', 'korrektur.storno'],
    euer: ['EÜR-Zeilen umgestellt', 'korrektur.euer'],
    sonderzeichen: ['Sonderzeichen wiederhergestellt', 'korrektur.sonderzeichen'],
  };
  for (const h of hinweise) {
    const [titel, aktion] = ART[h.art] || ART.euer;
    toast(titel, h.text, 'warn', 20000);
    await commit(aktion, () => null, { entity: 'bestand', summary: h.text });
  }
}

/** Ob dieses Gerät mit der Cloud verbunden ist (null: unbekannt) – für die Statusleiste. */
let cloudVerbunden = null;
export function setCloudVerbunden(wert) {
  cloudVerbunden = wert;
  updateStatus();
}

/**
 * Web-Fassung: Liegt die Buchhaltung nur im Speicher des Browsers, ohne
 * Cloud-Sicherung und ohne Vollsicherung im letzten Monat, erinnert Kontovia
 * höchstens einmal je Woche daran. Den Speicher darf der Browser räumen.
 */
async function sicherungsHinweis() {
  const tag = 864e5;
  const jetzt = Date.now();
  if (jetzt - (Date.parse(store.db?.createdAt || '') || 0) < 7 * tag) return;
  const sp = await api.speicher?.status().catch(() => null);
  if (sp?.art !== 'browser') return;
  const st = await api.cloud.status().catch(() => ({}));
  if (st.linked) return;
  let zuletzt = 0;
  let gezeigt = 0;
  try {
    zuletzt = Number(localStorage.getItem('kontovia.vollsicherung')) || 0;
    gezeigt = Number(localStorage.getItem('kontovia.sicherungshinweis')) || 0;
  } catch { return; }
  if (jetzt - zuletzt < 30 * tag || jetzt - gezeigt < 7 * tag) return;
  try { localStorage.setItem('kontovia.sicherungshinweis', String(jetzt)); } catch { /* egal */ }
  toast('Ihre Buchhaltung liegt nur in diesem Browser',
    `Den Speicher darf der Browser bei Platzmangel räumen. ${sp.moeglich ? 'Verschieben Sie sie in einen Ordner, schalten' : 'Schalten'} Sie die Cloud-Sicherung ein oder legen Sie eine Vollsicherung an. Hier klicken.`,
    'warn', 15000)?.addEventListener('click', () => navigate('settings', { abschnitt: 'speicher' }));
}

/** Läuft nach jedem erfolgreichen Entsperren. */
async function afterUnlock() {
  api.cloud.status().then((st) => setCloudVerbunden(st.configured ? !!st.linked : null)).catch(() => {});
  // Web-Fassung: eben per Weiterleitung verbunden – der erste Abgleich entscheidet, welcher Stand gilt.
  api.cloud.rueckmeldung?.().then((rm) => {
    if (rm?.ebenVerbunden) import('./views/cloudpanel.js').then((m) => m.nachWeiterleitung(rm.email));
  }).catch(() => {});
  announceMigrations().catch((e) => console.error('Hinweise der Schemapflege:', e));
  api.entsperrung?.googleAuffrischen?.().catch(() => {});
  neuigkeitenHinweis();
  sicherungsHinweis().catch(() => {});
  try { await startAutoSync(); } catch (e) { console.error("Cloud-Automatik:", e); }
  onSync(updateStatus);
  // Eben von Google zurück (Weiterleitung statt kleinem Fenster)? Das erst abschließen, dann abgleichen.
  try {
    const rm = await api.gcal?.rueckmeldung?.();
    if (rm) {
      const fertig = import('./views/calendarsync.js').then((m) => m.nachWeiterleitung(rm));
      // Das Verbinden fragt weiter nach (Kalenderauswahl) und startet den Abgleich selbst.
      if (rm.zweck === 'verbinden' && !rm.fehler) fertig.catch((e) => console.error('Verbinden nach Weiterleitung:', e));
      else await fertig;
    }
  } catch (e) { console.error('Rückkehr von Google Kalender:', e); }
  // Der Kalenderabgleich läuft nur, wenn auf diesem Gerät ein Google-Konto verbunden ist.
  startCalendarSync().catch((e) => console.error('Kalenderabgleich:', e));
  await setupUpdateWatch();
  // Fällige wiederkehrende Buchungen erst nach der Frage zur Update-Prüfung anbieten.
  import('./views/wiederkehrend.js').then((m) => m.faelligeAnbieten()).catch((e) => console.error('Wiederkehrende Buchungen:', e));
}

/* -------------------------------------------------------------------------- */
/* Programmaktualisierung                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fragt einmalig nach der Zustimmung und startet danach die Überwachung.
 *
 * Die Frage ist kein Selbstzweck: Die Prüfung ist der einzige Netzzugriff
 * außerhalb des Cloud-Abgleichs, und die Datenschutzhinweise sagen zu, dass
 * ohne Zustimmung nichts hinausgeht. Genau einmal zu fragen ist der einzige
 * Weg, der beides erfüllt – die Zusage bleibt wahr, und wer zustimmt, wird
 * von da an von selbst benachrichtigt.
 */
let updateAngemeldet = false;

async function setupUpdateWatch() {
  const s = store.db?.settings || {};
  if (!(s.updateFeedUrl || appInfo.defaultUpdateFeed)) return;

  // Der Zuhörer wird unabhängig von der Einstellung angemeldet – sonst bliebe
  // ein Fund unsichtbar, wenn jemand die Prüfung erst in den Einstellungen
  // einschaltet und bis zum nächsten Entsperren weiterarbeitet.
  if (!updateAngemeldet) {
    updateAngemeldet = true;
    onUpdate(onUpdateFound);
  }

  if (s.updateCheckOnStart === undefined) {
    const ja = await askUpdateConsent();
    // Wer das Fenster nur wegklickt, hat nichts entschieden – dann wird beim
    // nächsten Entsperren erneut gefragt, statt die Prüfung stillschweigend
    // für immer abzuschalten.
    if (ja === null) return;
    await commitUpdateConsent(ja);
    if (!ja) return;
  } else if (s.updateCheckOnStart !== true) {
    return;
  }

  startUpdateWatch();
}

/**
 * Fragt einmal nach der Zustimmung.
 * @returns {Promise<boolean|null>} true/false bei echter Wahl, null bei Wegklicken
 */
function askUpdateConsent() {
  return new Promise((resolve) => {
    let entschieden = false;
    const m = modal({
      title: 'Nach neuen Versionen suchen?',
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Kontovia kann Sie darauf hinweisen, wenn eine neue
        Fassung vorliegt, und sie auf Wunsch direkt installieren. Sie müssen dann nichts im
        Internet suchen.</p>
        <p style="line-height:1.6">Dafür wird beim Start und danach alle sechs Stunden eine kleine
        Versionsdatei abgerufen. Der Betreiber des Servers sieht dabei Ihre IP-Adresse. Angaben zu
        Ihrem Gerät oder Ihrer Buchhaltung werden nicht mitgesendet, und installiert wird nur nach
        Ihrer ausdrücklichen Bestätigung.</p>
        <p class="small muted mb0">Jederzeit änderbar unter
        <strong>Einstellungen → Programmaktualisierung</strong>.</p>`,
      foot: '<button class="btn" data-no>Nein, danke</button>'
        + '<button class="btn primary" data-yes>Ja, danach suchen</button>',
      onClose: () => { if (!entschieden) resolve(null); },
    });
    const antwort = (wert) => { entschieden = true; m.close(); resolve(wert); };
    m.root.querySelector('[data-no]').addEventListener('click', () => antwort(false));
    m.root.querySelector('[data-yes]').addEventListener('click', () => antwort(true));
  });
}

async function commitUpdateConsent(ja) {
  await commit('einstellung.update', (db) => { db.settings.updateCheckOnStart = ja; }, { silent: true });
  await saveNow();
}

/** Wird gerufen, sobald eine neue Fassung gefunden oder wieder gültig wird. */
function onUpdateFound(state, neu) {
  renderUpdateButton();
  if (!state.info || !neu) return;
  markNotified(state.info.version);
  toast(`Version ${state.info.version} ist verfügbar`,
    'Klicken Sie hier oder auf den Knopf links unten, um sie zu installieren.', 'warn', 12000)
    ?.addEventListener('click', openUpdate);
}

/** Öffnet das Fenster zum Herunterladen – aus der Seitenleiste oder dem Hinweis. */
async function openUpdate() {
  if (!updateState.info) return;
  const { openUpdateDialog } = await import('./views/cloudpanel.js');
  openUpdateDialog(updateState.info);
}

/**
 * Der dauerhafte Hinweis in der Seitenleiste. Ein Toast verschwindet nach ein
 * paar Sekunden; wer gerade an einer Buchung sitzt, soll die neue Fassung
 * später trotzdem wiederfinden.
 */
export function renderUpdateButton() {
  const slot = $('#updateSlot');
  if (!slot) return;
  const info = updateState.info;
  if (!info) { slot.innerHTML = ''; return; }
  slot.innerHTML = html`
    <button class="btn block mb8" id="updateBtn"
      style="border-color:var(--warn);color:var(--warn);justify-content:flex-start">
      ${icon('refresh', 16)} Version ${info.version} verfügbar
    </button>`;
  slot.querySelector('#updateBtn').addEventListener('click', openUpdate);
}
/* -------------------------------------------------------------------------- */
/* Hülle                                                                       */
/* -------------------------------------------------------------------------- */

function navItem(key) {
  const v = VIEWS[key];
  return html`
    <div class="nav-item ${router.view === key ? 'active' : ''}" data-view="${key}" role="button" tabindex="0" aria-current="${router.view === key ? 'page' : 'false'}"${v.key ? raw(` title="${esc(v.title)} (${MOD}+${esc(v.key)})"`) : ''}>
      ${icon(v.icon, 18)}<span>${v.title}</span>
    </div>`;
}

let neuHoerer = null;

/** Der eine Hauptknopf der Seitenleiste: eine neue Buchung, Einnahme oder Ausgabe. */
export function neueBuchungMenue(anker) {
  openPopover(anker, {
    label: 'Neue Buchung',
    className: 'menu neu-menu',
    build: (pop, handle) => {
      pop.innerHTML = `
        <button type="button" class="menu-opt neu-opt" data-nav data-art="income">
          <span class="neu-ico pos">${icon('arrowDown', 16, 'neu-svg').__raw}</span>
          <span class="menu-label"><strong>Einnahme</strong><span class="menu-sub">Geld, das Sie erhalten</span></span>
        </button>
        <button type="button" class="menu-opt neu-opt" data-nav data-art="expense">
          <span class="neu-ico">${icon('arrowUp', 16, 'neu-svg').__raw}</span>
          <span class="menu-label"><strong>Ausgabe</strong><span class="menu-sub">Geld, das Sie bezahlen</span></span>
        </button>`;
      pop.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-art]');
        if (!b) return;
        handle.close();
        const m = await import('./views/transactions.js');
        m.openTransactionDialog(null, b.dataset.art);
      });
    },
  });
}

function renderShell() {
  app.innerHTML = html`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">K</div>
          <div>
            <div class="brand-name">Kontovia</div>
            <div class="brand-sub" id="brandSub"></div>
          </div>
        </div>
        <button class="cta" id="newTxBtn" type="button" aria-haspopup="menu">
          ${icon('plus', 18)}<span class="grow">Neue Buchung</span>${icon('down', 15)}
        </button>
        <button class="such-knopf" id="searchBtn" type="button" aria-haspopup="dialog" title="Alles durchsuchen (${SUCHE_KUERZEL})">
          ${icon('search', 16)}<span class="grow">Suchen</span><kbd>${SUCHE_KUERZEL}</kbd>
        </button>
        <nav class="nav" id="nav" aria-label="Hauptnavigation">
          <div class="nav-group">
            ${raw(['dashboard', 'transactions', 'rechnungen', 'calendar', 'todos'].map(navItem).join(''))}
          </div>
          <div class="nav-sep"></div>
          <div class="nav-group">
            ${raw(['reports', 'export'].map(navItem).join(''))}
          </div>
          <div class="nav-spacer"></div>
          <div class="nav-group">
            ${raw(['master', 'settings', 'help'].map(navItem).join(''))}
          </div>
        </nav>
        <div class="sidebar-foot">
          <div id="updateSlot"></div>
          <div id="themeSlot"></div>
          <button class="btn ghost block" id="feedbackBtn" title="Rückmeldung geben, auf Wunsch mit Bildschirmfoto">${icon('chat', 16)} Feedback</button>
          <div class="foot-knoepfe">
            <button class="btn ghost" id="lockBtn" title="Sperren (${MOD}+L)">${icon('lock', 16)} Sperren</button>
            <button class="btn ghost" id="logoutBtn" title="Von diesem Gerät abmelden, um ein anderes Konto zu verwenden">${icon('logout', 16)} Abmelden</button>
          </div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <h1 id="viewTitle">Übersicht</h1>
          <button class="icon-btn top-suche" id="topSearch" type="button" aria-label="Suchen" title="Alles durchsuchen">${icon('search', 20)}</button>
          <div class="spacer"></div>
          <div id="topActions" class="row"></div>
        </header>
        <div class="content" id="content"></div>
        <div class="statusbar">
          <span class="row" style="gap:6px"><i class="save-dot" id="saveDot"></i><span id="saveText">gespeichert</span></span>
          <span class="sep"></span>
          <span id="statCounts"></span>
          <span class="sep"></span>
          <span id="statLock"></span>
          <span class="sep"></span>
          <span id="statSync" style="cursor:pointer" title="Cloud-Abgleich"></span>
          <span class="spacer"></span>
          <span id="versionLabel" data-version="${appInfo.version || ''}">Kontovia ${appInfo.version || ''}</span>
        </div>
      </main>
    </div>`;

  $('#nav').addEventListener('click', (e) => {
    const item = e.target.closest('[data-view]');
    if (item) navigate(item.dataset.view);
  });
  // Die Seitenleiste ist auch ohne Maus bedienbar: Tab zum Eintrag, Enter oder Leertaste öffnet.
  $('#nav').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('[data-view]');
    if (item) { e.preventDefault(); navigate(item.dataset.view); }
  });
  $('#lockBtn').addEventListener('click', () => lockNow());
  $('#logoutBtn').addEventListener('click', () => abmelden());
  $('#feedbackBtn').addEventListener('click', () => feedbackOeffnen());
  entwicklerKlick($('#versionLabel'));
  $('#newTxBtn').addEventListener('click', (e) => neueBuchungMenue(e.currentTarget));
  $('#searchBtn').addEventListener('click', () => sucheOeffnen({ sperren: lockNow }));
  $('#topSearch').addEventListener('click', () => { $('.shell')?.classList.remove('nav-offen'); sucheOeffnen({ sperren: lockNow }); });
  // Die Schnellleiste der Telefonansicht (src/web/mobil.js) öffnet dasselbe Menü an ihrem Knopf.
  if (!neuHoerer) {
    neuHoerer = (e) => neueBuchungMenue(e.detail.anker);
    document.addEventListener('kontovia:neue-buchung', neuHoerer);
  }
  // Die Hülle wird beim Entsperren neu aufgebaut – ein bereits bekannter Fund
  // muss danach wieder sichtbar sein.
  renderUpdateButton();
  renderThemeToggle();
  $('#statSync').addEventListener('click', async () => {
    const st = await api.cloud.status().catch(() => ({}));
    if (!st.linked || syncState.lastErrorCode === 'NEU_ANMELDEN') { navigate('settings', { abschnitt: 'cloud' }); return; }
    try { const r = await syncNow({ reason: 'statusleiste' }); ok('Abgleich abgeschlossen', r.summary || ''); }
    catch (e) { err('Abgleich fehlgeschlagen', e.message); }
  });

  updateStatus();
  subscribe(updateStatus);
}

function updateStatus() {
  const dot = $('#saveDot');
  if (!dot) return;
  const text = $('#saveText');
  dot.className = 'save-dot ' + (store.status === 'saving' ? 'saving' : store.status === 'error' ? 'error' : store.dirty ? '' : 'saved');
  text.textContent = store.status === 'saving' ? 'speichere …'
    : store.status === 'error' ? 'Fehler: ' + (store.error || '')
      : store.dirty ? 'ungespeicherte Änderungen'
        : store.lastSaved ? 'gespeichert ' + fmtDateTime(store.lastSaved) : 'gespeichert';

  const s = sel.settings();
  $('#brandSub').textContent = s.companyName || s.ownerName || 'Buchhaltung';
  const offeneAufgaben = sel.todos().filter((t) => !t.done).length;
  $('#statCounts').textContent = `${int(sel.transactions().length)} Buchungen · ${int(sel.appointments().length)} Termine`
    + (offeneAufgaben ? ` · ${int(offeneAufgaben)} ${offeneAufgaben === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}` : '');
  const until = lockedUntil();
  $('#statLock').textContent = until ? `festgeschrieben bis ${until.split('-').reverse().join('.')}` : 'keine Festschreibung';

  const syncEl = document.getElementById("statSync");
  if (syncEl) {
    if (syncState.running) syncEl.textContent = "Cloud: Abgleich läuft …";
    // Ohne Verbindung (nie eingerichtet oder eben getrennt) zählt kein früherer
    // Abgleich mehr – ein leiser Hinweis, dass sich jederzeit verbinden lässt.
    else if (cloudVerbunden === false) syncEl.textContent = 'Cloud-Sicherung einrichten';
    else if (syncState.lastErrorCode === 'NEU_ANMELDEN') syncEl.textContent = 'Cloud: bitte neu anmelden';
    else if (syncState.lastError) syncEl.textContent = "Cloud: " + syncState.lastError.slice(0, 60);
    else if (syncState.lastAt) syncEl.textContent = "Cloud: abgeglichen " + fmtDateTime(syncState.lastAt);
    else syncEl.textContent = "";
  }

  const activeItem = document.querySelector('.nav-item.active');
  if (activeItem?.dataset.view !== router.view) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === router.view));
  }
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

// Die Zurück-Taste des Browsers schließt zuerst ein offenes Fenster.
router.vorZurueck = obersteSchliessen;

onNavigate(async (view, params) => {
  const conf = VIEWS[view] || VIEWS.dashboard;
  const content = $('#content');
  if (!content) return;
  closePopover();
  document.querySelectorAll('.nav-item').forEach((n) => {
    const aktiv = n.dataset.view === view;
    n.classList.toggle('active', aktiv);
    n.setAttribute('aria-current', aktiv ? 'page' : 'false');
  });
  $('#viewTitle').textContent = conf.title;
  $('#topActions').innerHTML = '';
  content.scrollTop = 0;
  content.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    await conf.mod.render(content, params, { actions: $('#topActions') });
  } catch (e) {
    console.error(e);
    content.innerHTML = html`<div class="notice danger">Die Ansicht konnte nicht dargestellt werden: ${e.message}</div>`;
  }
  updateStatus();
});

/* -------------------------------------------------------------------------- */
/* Sperre, Menü, Tastatur                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Sperren auf Knopfdruck. Änderungen der letzten Augenblicke stehen womöglich
 * noch zum Schreiben an (gespeichert wird leicht verzögert gebündelt) – nach
 * dem Sperren ginge das nicht mehr, sie wären verloren.
 */
export async function lockNow() {
  if (store.dirty) await saveNow();
  await api.vault.lock();
}

api.on.locked(async ({ reason }) => {
  document.getElementById('overlays').innerHTML = '';
  // Ungesicherte Eingaben einer Ansicht sind mit dem Sperren verworfen.
  router.leaveGuard = null;
  closePopover();
  // Nach dem Entsperren gelten wieder die Zahlen ohne private Buchungen.
  scope.includeUnlisted = false;
  stopCalendarSync();
  clearDb();
  const texts = {
    inaktiv: 'Kontovia wurde wegen Inaktivität gesperrt.',
    standby: 'Das Gerät war im Ruhezustand, deshalb wurde Kontovia gesperrt.',
    bildschirmsperre: 'Der Bildschirm wurde gesperrt, deshalb wurde auch Kontovia gesperrt.',
    hintergrund: 'Kontovia war einige Minuten im Hintergrund und wurde deshalb gesperrt.',
    'anderes-fenster': 'Kontovia wurde in einem anderen Fenster geöffnet und hier gesperrt. Laden Sie diese Seite neu, um hier weiterzuarbeiten.',
    aktualisierung: 'Die neue Fassung wird geladen …',
    'cloud-uebernahme': 'Der Stand aus der Cloud ist übernommen. Entsperren Sie ihn mit dem Passwort, das auf Ihrem anderen Gerät gilt.',
    'sicherung-uebernommen': 'Die Sicherung gehörte zu einer anderen Buchhaltung und ist jetzt geladen. Entsperren Sie sie mit dem Passwort der Sicherung.',
    manuell: '',
  };
  renderUnlock(texts[reason] ?? '');
});

api.on.menu(async (payload) => {
  if (!store.db) return;
  switch (payload.action) {
    case 'lock': await lockNow(); break;
    case 'view': navigate(payload.view, payload.params || {}); break;
    case 'check-update': await checkUpdateFromMenu(); break;
    case 'new-transaction': {
      const m = await import('./views/transactions.js');
      m.openTransactionDialog(null, 'expense');
      break;
    }
    case 'new-appointment': {
      const m = await import('./views/calendar.js');
      m.openAppointmentDialog(null);
      break;
    }
    case 'new-todo': {
      const m = await import('./views/todos.js');
      m.openTodoDialog(null);
      break;
    }
    case 'save':
      await saveNow();
      ok('Gespeichert');
      break;
    case 'backup': {
      const m = await import('./views/settings.js');
      m.runBackup();
      break;
    }
    case 'search':
      if (router.view !== 'transactions') navigate('transactions');
      setTimeout(() => document.querySelector('#txSearch')?.focus(), 120);
      break;
    case 'about': showAbout(); break;
  }
});

/**
 * Menü „Hilfe → Nach neuer Version suchen“: prüft sofort und meldet das
 * Ergebnis. Der Klick ist eine ausdrückliche Anweisung – er gilt unabhängig
 * davon, ob die regelmäßige Prüfung eingeschaltet ist.
 */
async function checkUpdateFromMenu() {
  const { checkUpdates } = await import('./lib/updates.js');
  toast('Suche nach neuer Version …');
  let info;
  try {
    info = await checkUpdates({ silent: false });
  } catch (e) {
    err('Update-Prüfung fehlgeschlagen', e.message);
    return;
  }
  if (!info?.configured) { warn('Keine Update-Suche möglich', 'In dieser Fassung ist keine Update-Adresse hinterlegt.'); return; }
  if (info.reachable === false) { warn('Update-Server nicht erreichbar', info.error || ''); return; }
  if (info.available) { openUpdate(); return; }
  ok('Keine neue Version', `Sie verwenden bereits die neueste Fassung (${info.current}).`);
}

function showAbout() {
  const m = modal({
    title: 'Über Kontovia',
    size: 'slim',
    body: html`
      <p class="mt0"><strong>Kontovia ${appInfo.version}</strong>: Buchhaltung, die auf Ihrem Rechner bleibt.</p>
      <table class="data compact mt16">
        <tbody>
          <tr><td class="muted">Datenordner</td><td class="tiny">${appInfo.dataDir || '–'}</td></tr>
          <tr><td class="muted">Verschlüsselung</td><td>AES-256, der Schlüssel entsteht aus Ihrem Passwort</td></tr>
        </tbody>
      </table>
      <p class="small muted mt16">Kontovia ersetzt keine Steuerberatung. Die Zuordnungen zu
      EÜR-Zeilen, Kennzahlen und Konten sind Vorschläge, die Sie prüfen sollten.</p>`,
    foot: `<button class="btn left" data-neu>${icon('history', 15).__raw} Neuigkeiten</button>
           <button class="btn" data-recht>${icon('file', 15).__raw} Rechtliches und Lizenzen</button>
           <button class="btn primary" data-close-modal>Schließen</button>`,
  });
  m.root.querySelector('[data-close-modal]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-neu]').addEventListener('click', () => { m.close(); navigate('help', { tab: 'neu' }); });
  m.root.querySelector('[data-recht]').addEventListener('click', () => { m.close(); navigate('help', { tab: 'recht' }); });
}

/* Tastenkürzel, die das native Menü nicht abdeckt */
document.addEventListener('keydown', (e) => {
  if (!store.db) return;
  if (e.key === 'Escape') return;
  // Strg+K (am Mac ⌘K) öffnet die Suche von überall, auch aus einem Eingabefeld heraus.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    sucheOeffnen({ sperren: lockNow });
    return;
  }
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || !!document.activeElement?.isContentEditable;
  if (!inField && e.key === '?') { navigate('help'); }
});

/* Aktivität melden, damit die automatische Sperre nicht mitten im Tippen greift.
   pointerdown und touchstart zählen auch Antippen und Wischen auf Telefon und
   Tablet – dort gibt es kein wheel, und wer nur liest und scrollt, wurde sonst
   mitten im Lesen gesperrt. */
const ping = debounce(() => api.app.activity(), 800);
for (const evt of ['pointerdown', 'touchstart', 'keydown', 'wheel']) {
  document.addEventListener(evt, ping, { passive: true });
}

/* Ungespeicherte Änderungen beim Schließen noch wegschreiben */
window.addEventListener('beforeunload', (e) => {
  if (store.dirty) saveNow();
  // Die Seite fragt vor dem Schließen, wenn Eingaben nicht übernommen sind.
  if (router.leaveGuard) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && store.dirty) saveNow(); });

boot();
