/**
 * Kontovia – Einstieg.
 * Kümmert sich um Einrichtung, Entsperren, Rahmen und Navigation.
 */

import { html, raw, esc, $, int, fmtDateTime, debounce } from './lib/util.js';
import { icon, toast, ok, err, warn, modal, passwordInput, wirePasswordToggles } from './lib/ui.js';
import { store, setDb, subscribe, saveNow, sel, lockedUntil, setDevice, commit } from './lib/store.js';
import { startAutoSync, syncState, onSync, syncNow } from './lib/sync.js';
import { updateState, onUpdate, startUpdateWatch, markNotified } from './lib/updates.js';
import { router, onNavigate, navigate, refresh } from './lib/router.js';
import { closePopover } from './lib/popover.js';
import { scope } from './lib/prefs.js';
import { startCalendarSync, stopCalendarSync } from './lib/gcalsync.js';

import * as viewDashboard from './views/dashboard.js';
import * as viewTransactions from './views/transactions.js';
import * as viewCalendar from './views/calendar.js';
import * as viewReports from './views/reports.js';
import * as viewExport from './views/export.js';
import * as viewMaster from './views/master.js';
import * as viewSettings from './views/settings.js';
import * as viewHelp from './views/help.js';

const api = window.kontovia;
const app = document.getElementById('app');
/** Läuft Kontovia im Browser statt in Electron? (src/web/bridge.js) */
const WEB = api.platform === 'web';

export let appInfo = { version: '1.0.0' };

const VIEWS = {
  dashboard: { title: 'Übersicht', icon: 'dashboard', mod: viewDashboard, key: '1' },
  transactions: { title: 'Buchungen', icon: 'book', mod: viewTransactions, key: '2' },
  calendar: { title: 'Kalender', icon: 'calendar', mod: viewCalendar, key: '3' },
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
  if (!status.exists) renderSetup();
  else renderUnlock();
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

  const bodies = [
    () => html`
      <h2>Willkommen bei Kontovia</h2>
      ${WEB ? raw(`<p class="lead">Ihre Buchhaltung bleibt auf diesem Gerät, verschlüsselt mit
      Ihrem Passwort. Es gibt kein Benutzerkonto beim Hersteller und keine Telemetrie; Ihre
      Buchhaltung verlässt das Gerät nur, wenn Sie den Cloud-Abgleich einschalten. Zuerst ein
      paar Angaben zu Ihrem Betrieb – alles später änderbar.</p>`) : raw(`<p class="lead">Ihre Buchhaltung bleibt auf diesem Rechner, verschlüsselt mit Ihrem
      Passwort. Es gibt kein Benutzerkonto beim Hersteller und keine Telemetrie; ohne Ihre
      ausdrückliche Zustimmung baut Kontovia keine Verbindung auf. Zuerst ein paar Angaben
      zu Ihrem Betrieb – alles später änderbar.</p>`)}
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
      <p class="lead">Diese beiden Weichen bestimmen, wie Kontovia rechnet. Wenn Sie
      unsicher sind: Die Voreinstellung passt für die meisten Selbstständigen und
      kleinen Betriebe.</p>
      <div class="field">
        <label>Umsatzsteuer</label>
        <select id="f_taxMode">
          <option value="regelbesteuerung" ${data.taxMode === 'regelbesteuerung' ? 'selected' : ''}>Regelbesteuerung – ich weise Umsatzsteuer aus</option>
          <option value="kleinunternehmer" ${data.taxMode === 'kleinunternehmer' ? 'selected' : ''}>Kleinunternehmer nach § 19 UStG – keine Umsatzsteuer</option>
        </select>
        <span class="hint">Als Kleinunternehmer rechnet Kontovia durchgehend mit Bruttobeträgen und blendet alle Umsatzsteuerfelder aus.</span>
      </div>
      <div class="field">
        <label>Gewinnermittlung</label>
        <select id="f_accountingBasis">
          <option value="ist" ${data.accountingBasis === 'ist' ? 'selected' : ''}>Nach Zahlungsfluss (Einnahmen-Überschuss-Rechnung, § 11 EStG)</option>
          <option value="soll" ${data.accountingBasis === 'soll' ? 'selected' : ''}>Nach Rechnungsdatum (Sollversteuerung)</option>
        </select>
        <span class="hint">Beim Zahlungsfluss zählt eine Buchung erst, wenn das Geld tatsächlich geflossen ist. Das ist der Regelfall der EÜR.</span>
      </div>
      <div class="form-grid">
        <div class="field">
          <label>Voreingestellter Steuersatz</label>
          <select id="f_defaultVatRate">
            <option value="19" ${data.defaultVatRate === 19 ? 'selected' : ''}>19 %</option>
            <option value="7" ${data.defaultVatRate === 7 ? 'selected' : ''}>7 %</option>
            <option value="0">0 %</option>
          </select>
        </div>
        <div class="field">
          <label>Voranmeldungszeitraum</label>
          <select id="f_vatPeriod">
            <option value="monatlich">monatlich</option>
            <option value="vierteljährlich" selected>vierteljährlich</option>
            <option value="jährlich">jährlich</option>
          </select>
        </div>
        <div class="field full">
          <label>Kontenrahmen für den DATEV-Export</label>
          <select id="f_chartOfAccounts">
            <option value="SKR03" selected>SKR03 (Prozessgliederung – am weitesten verbreitet)</option>
            <option value="SKR04">SKR04 (Abschlussgliederung)</option>
          </select>
        </div>
      </div>`,

    () => html`
      <h2>Passwort festlegen</h2>
      <p class="lead">Ihre gesamte Buchhaltung wird mit diesem Passwort verschlüsselt
      (AES-256 mit scrypt-Schlüsselableitung). Ohne das Passwort sind die Daten
      unwiederbringlich verloren – es gibt bewusst keine Hintertür und keine
      Zurücksetzfunktion.</p>
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
        Ein Passwortmanager oder ein Zettel im Safe – beides ist besser als Vertrauen
        aufs Gedächtnis. Legen Sie außerdem regelmäßig Vollsicherungen an
        (Datei → Vollsicherung erstellen).
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
          ${raw(bodies[step]())}
          <div class="row end mt24" style="gap:8px">
            ${step > 0 ? raw('<button class="btn" id="back">Zurück</button>') : ''}
            <div class="spacer"></div>
            <button class="btn primary lg" id="next">${step === 2 ? 'Tresor anlegen' : 'Weiter'}</button>
          </div>
        </div>
      </div>`;

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
        navigate('dashboard');
        afterUnlock();
        toast('Tresor angelegt', 'Ihre Daten liegen verschlüsselt in ' + (appInfo.dataDir || 'Ihrem Benutzerordner'), 'ok', 7000);
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
        <p class="tiny muted mt16" style="text-align:center">
          Die Entschlüsselung dauert bewusst rund eine Sekunde – das bremst
          Angreifer beim Durchprobieren von Passwörtern erheblich aus.
        </p>
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
      setDb(db);
      applyTheme();
      renderShell();
      navigate(db.settings.startView || 'dashboard');
      afterUnlock();
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Entsperren';
      pw.select();
    }
  };
  btn.addEventListener('click', submit);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}


/** Läuft nach jedem erfolgreichen Entsperren. */
async function afterUnlock() {
  try { await startAutoSync(); } catch (e) { console.error("Cloud-Automatik:", e); }
  onSync(updateStatus);
  // Der Kalenderabgleich läuft nur, wenn auf diesem Gerät ein Google-Konto verbunden ist.
  startCalendarSync().catch((e) => console.error('Kalenderabgleich:', e));
  await setupUpdateWatch();
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
        Fassung vorliegt, und sie auf Wunsch direkt installieren – Sie müssen dann nichts im
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
      ${icon('refresh', 16)} Version ${esc(info.version)} verfügbar
    </button>`;
  slot.querySelector('#updateBtn').addEventListener('click', openUpdate);
}
/* -------------------------------------------------------------------------- */
/* Hülle                                                                       */
/* -------------------------------------------------------------------------- */

function navItem(key) {
  const v = VIEWS[key];
  return html`
    <div class="nav-item ${router.view === key ? 'active' : ''}" data-view="${key}" role="button" tabindex="0" aria-current="${router.view === key ? 'page' : 'false'}">
      ${icon(v.icon, 18)}<span>${v.title}</span>
      ${v.key ? raw(`<span class="kbd">Strg+${esc(v.key)}</span>`) : ''}
    </div>`;
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
        <nav class="nav" id="nav">
          <div class="nav-group">
            ${raw(['dashboard', 'transactions', 'calendar'].map(navItem).join(''))}
          </div>
          <div class="nav-group">
            <div class="nav-group-title">Auswerten</div>
            ${raw(['reports', 'export'].map(navItem).join(''))}
          </div>
          <div class="nav-group">
            <div class="nav-group-title">Verwaltung</div>
            ${raw(['master', 'settings', 'help'].map(navItem).join(''))}
          </div>
        </nav>
        <div class="sidebar-foot">
          <div id="updateSlot"></div>
          <div id="themeSlot"></div>
          <button class="btn ghost block" id="lockBtn">${icon('lock', 16)} Sperren <span class="kbd" style="margin-left:auto;font-size:10px;color:var(--muted)">Strg+L</span></button>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <h1 id="viewTitle">Übersicht</h1>
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
          <span>Kontovia ${esc(appInfo.version || '')}</span>
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
  $('#lockBtn').addEventListener('click', () => api.vault.lock());
  // Die Hülle wird beim Entsperren neu aufgebaut – ein bereits bekannter Fund
  // muss danach wieder sichtbar sein.
  renderUpdateButton();
  renderThemeToggle();
  $('#statSync').addEventListener('click', async () => {
    const st = await api.cloud.status().catch(() => ({}));
    if (!st.linked) { navigate('settings'); return; }
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
  $('#statCounts').textContent = `${int(sel.transactions().length)} Buchungen · ${int(sel.appointments().length)} Termine`;
  const until = lockedUntil();
  $('#statLock').textContent = until ? `festgeschrieben bis ${until.split('-').reverse().join('.')}` : 'keine Festschreibung';

  const syncEl = document.getElementById("statSync");
  if (syncEl) {
    if (syncState.running) syncEl.textContent = "Cloud: Abgleich läuft …";
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

api.on.locked(async ({ reason }) => {
  document.getElementById('overlays').innerHTML = '';
  closePopover();
  // Nach dem Entsperren gelten wieder die Zahlen ohne nicht gelistete Buchungen.
  scope.includeUnlisted = false;
  stopCalendarSync();
  const texts = {
    inaktiv: 'Kontovia wurde wegen Inaktivität gesperrt.',
    standby: 'Der Rechner ging in den Ruhezustand – Kontovia wurde gesperrt.',
    bildschirmsperre: 'Der Bildschirm wurde gesperrt – Kontovia wurde ebenfalls gesperrt.',
    hintergrund: 'Kontovia war einige Minuten im Hintergrund und wurde deshalb gesperrt.',
    'anderes-fenster': 'Kontovia wurde in einem anderen Fenster geöffnet und hier gesperrt. Laden Sie diese Seite neu, um hier weiterzuarbeiten.',
    aktualisierung: 'Die neue Fassung wird geladen …',
    manuell: '',
  };
  renderUnlock(texts[reason] ?? '');
});

api.on.menu(async (payload) => {
  if (!store.db) return;
  switch (payload.action) {
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
  if (!info?.configured) { warn('Keine Update-Adresse hinterlegt', 'Unter Einstellungen → Programmaktualisierung eintragen.'); return; }
  if (info.reachable === false) { warn('Update-Server nicht erreichbar', info.error || ''); return; }
  if (info.available) { openUpdate(); return; }
  ok('Keine neue Version', `Sie verwenden bereits die neueste Fassung (${info.current}).`);
}

function showAbout() {
  const m = modal({
    title: 'Über Kontovia',
    size: 'slim',
    body: html`
      <p class="mt0"><strong>Kontovia ${appInfo.version}</strong> – Buchhaltung, die auf Ihrem Rechner bleibt.</p>
      <table class="data compact mt16">
        <tbody>
          <tr><td class="muted">Datenordner</td><td class="tiny">${appInfo.dataDir || '–'}</td></tr>
          <tr><td class="muted">Verschlüsselung</td><td>AES-256-GCM, Schlüssel über scrypt</td></tr>
          <tr><td class="muted">Electron</td><td>${appInfo.electron || '–'}</td></tr>
          <tr><td class="muted">Chromium</td><td>${appInfo.chrome || '–'}</td></tr>
        </tbody>
      </table>
      <p class="small muted mt16">Kontovia ersetzt keine Steuerberatung. Die Zuordnung zu
      EÜR-Zeilen, Kennzahlen und Konten sind Vorschläge, die Sie prüfen sollten.</p>`,
    foot: `<button class="btn" data-recht>${icon('file', 15).__raw} Rechtliches und Lizenzen</button>
           <button class="btn primary" data-close-modal>Schließen</button>`,
  });
  m.root.querySelector('[data-close-modal]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-recht]').addEventListener('click', () => { m.close(); navigate('help', { tab: 'recht' }); });
}

/* Tastenkürzel, die das native Menü nicht abdeckt */
document.addEventListener('keydown', (e) => {
  if (!store.db) return;
  if (e.key === 'Escape') return;
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (!inField && e.key === '?') { navigate('help'); }
});

/* Aktivität melden, damit die automatische Sperre nicht mitten im Tippen greift */
const ping = debounce(() => api.app.activity(), 800);
for (const evt of ['mousedown', 'keydown', 'wheel']) {
  document.addEventListener(evt, ping, { passive: true });
}

/* Ungespeicherte Änderungen beim Schließen noch wegschreiben */
window.addEventListener('beforeunload', () => { if (store.dirty) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && store.dirty) saveNow(); });

boot();
