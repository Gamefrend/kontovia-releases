/** Kontovia – Bedienflächen für Cloud-Abgleich und Programmaktualisierung. */

import { html, raw, esc, $, $$, bytes, fmtDateTime, fmtDate, int } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, err, warn, toast, emptyState } from '../lib/ui.js';
import { store, commit, saveNow, setDb } from '../lib/store.js';
import { syncNow, syncState, onSync, startAutoSync } from '../lib/sync.js';
import { checkUpdates, markNotified } from '../lib/updates.js';
import { refresh } from '../lib/router.js';
import { appInfo } from '../app.js';
import { table, mountTables } from '../lib/table.js';

const api = window.kontovia;
/** Läuft Kontovia im Browser statt in Electron? (src/web/bridge.js) */
const WEB = api.platform === 'web';
/** In der Web-Fassung meldet sich Kontovia per Code an – mit einem anderen Client-Typ. */
const CLIENT_TYP = WEB ? 'Fernseher und Geräte mit eingeschränkter Eingabe' : 'Desktop-App';

/* -------------------------------------------------------------------------- */
/* Cloud                                                                       */
/* -------------------------------------------------------------------------- */

export async function renderCloudCard(root) {
  const status = await api.cloud.status().catch(() => ({ configured: false }));
  const conflicts = store.db.syncConflicts || [];

  let quotaLine = '';
  if (status.linked) {
    try {
      const q = await api.cloud.quota();
      quotaLine = q.limit
        ? `${bytes(q.used)} von ${bytes(q.limit)} in Ihrem Google-Konto belegt`
        : `${bytes(q.used)} belegt`;
    } catch { quotaLine = ''; }
  }

  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h3>${icon('archive', 16)} Cloud-Abgleich</h3>
        <span class="sub">${status.provider === 'drive' ? 'Google Drive' : 'Firebase'}</span>
        <div class="spacer"></div>
        ${status.linked ? raw(`<span class="badge pos">verbunden${status.email ? ' – ' + esc(status.email) : ''}</span>`)
          : status.configured ? raw('<span class="badge warn">eingerichtet, nicht verbunden</span>')
            : raw('<span class="badge">nicht eingerichtet</span>')}
      </div>
      <div class="card-body">
        <div class="notice mb16">
          <strong>Was dabei übertragen wird.</strong> Ausschließlich der bereits
          verschlüsselte Tresor. Gespeichert wird ein Block, der ohne Ihr Passwort
          nicht zu entziffern ist – auch nicht vom Betreiber der Ablage.
          ${status.provider === 'drive' ? raw(`Er landet in einem versteckten, für Kontovia
          reservierten Bereich Ihres Google Drive; auf Ihre übrigen Dateien hat die Anwendung
          keinen Zugriff und kann ihn auch nicht erhalten. Der Platz zählt auf Ihr
          Google-Kontingent, Gebühren entstehen keine.`) : raw(`Er landet in Ihrem
          Firebase-Projekt, in einem Zweig, den die Zugriffsregeln auf Ihr Konto begrenzen.
          Jeder Nutzer kommt ausschließlich an die eigenen Daten.`)}
        </div>

        ${!status.configured ? raw(setupForm(status)) : ''}

        ${status.configured && !status.linked ? raw(`
          <div class="row" style="gap:8px">
            <button class="btn primary" id="btnConnect">${icon('key', 15).__raw} Mit Google verbinden</button>
            <button class="btn ghost" id="btnEditCreds">Zugangsdaten ändern</button>
          </div>
          <p class="small muted mt16 mb0">${WEB
            ? `Kontovia zeigt einen kurzen Code, den Sie auf google.com/device eingeben – auf
          diesem oder einem anderen Gerät. Dort sehen Sie in der Adresszeile, dass Sie Ihr
          Passwort bei Google eingeben und nicht bei Kontovia.`
            : `Es öffnet sich Ihr normaler Browser mit der
          Anmeldeseite von Google. Das ist Absicht: nur dort sehen Sie in der Adresszeile,
          wo Sie Ihr Passwort eingeben.`}</p>`) : ''}

        ${status.linked ? raw(`
          <div class="grid c2">
            <div>
              <table class="data compact">
                <tbody>
                  <tr><td class="muted">Konto</td><td>${esc(status.email || '–')}</td></tr>
                  <tr><td class="muted">Letzter Abgleich</td><td>${status.lastSyncAt ? esc(fmtDateTime(status.lastSyncAt)) : 'noch keiner'}</td></tr>
                  ${quotaLine ? `<tr><td class="muted">Speicher</td><td>${esc(quotaLine)}</td></tr>` : ''}
                  <tr><td class="muted">Dieses Gerät</td><td>${esc(appInfo.deviceName || '')} <span class="tiny muted">${esc((appInfo.deviceId || '').slice(0, 8))}</span></td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div class="field">
                <label class="check"><input type="checkbox" id="cAuto" ${status.autoSync !== false ? 'checked' : ''}> Automatisch abgleichen</label>
                <span class="hint">Nach jeder Änderung mit kurzer Verzögerung, beim Programmstart und regelmäßig.</span>
              </div>
              <div class="field">
                <label>Regelmäßig alle</label>
                <select id="cInterval">
                  ${[5, 15, 30, 60, 240].map((m) => `<option value="${m}" ${Number(status.autoSyncMinutes) === m ? 'selected' : ''}>${m} Minuten</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="row wrap mt16" style="gap:8px">
            <button class="btn primary" id="btnSync">${icon('refresh', 15).__raw} Jetzt abgleichen</button>
            ${conflicts.length ? `<button class="btn" id="btnConflicts">${icon('alert', 15).__raw} ${conflicts.length} Konflikt${conflicts.length > 1 ? 'e' : ''} ansehen</button>` : ''}
            <div class="spacer"></div>
            <button class="btn danger" id="btnUnlink">Verbindung trennen</button>
          </div>
          <div id="syncStatus" class="mt16"></div>`) : ''}
      </div>
    </div>`;

  wireCloud(root, status);
  paintSyncStatus(root);
}

function setupForm(status) {
  const c = store.db.cloud || {};
  const firebase = (status.provider || 'firebase') !== 'drive';
  const built = status.builtIn || {};
  return `
    <div class="field">
      <label>Wohin wird abgeglichen?</label>
      <select id="cProvider">
        <option value="firebase" ${firebase ? 'selected' : ''}>Firebase – ein Projekt, an das sich beliebig viele Geräte anmelden</option>
        <option value="drive" ${firebase ? '' : 'selected'}>Google Drive – jeder Nutzer speichert im eigenen Drive</option>
      </select>
      <span class="hint">${firebase
        ? 'Ihre Nutzer melden sich nur mit Google an, mehr ist von ihnen nicht zu tun. Google führt den Zugriffsbereich als nicht sensibel, daher gibt es weder eine Prüfpflicht noch ein Nutzerlimit.'
        : 'Kostet nichts und Sie halten keine fremden Daten: Der Tresor liegt im Drive jedes Nutzers und zählt gegen dessen Speicherplatz. Google führt den Anwendungsordner als nicht sensibel – keine Prüfpflicht, kein Nutzerlimit. Im Google-Cloud-Projekt muss die Google Drive API eingeschaltet sein.'}</span>
    </div>

    <p class="small mb8" style="color:var(--text-2)">Die vollständige Anleitung mit allen
    Klickwegen steht unter <strong>Hilfe → Cloud einrichten</strong>.</p>

    ${firebase && built.apiKey && built.bucket && !built.clientId ? `
    <div class="notice ok mb16">
      Das Firebase-Projekt ist bereits mitgeliefert – Web-API-Schlüssel und Speicherort
      müssen Sie nicht eintragen. Es fehlt nur noch der OAuth-Client vom Typ
      <strong>${CLIENT_TYP}</strong> aus derselben Google-Cloud-Konsole.
    </div>` : ''}

    <div class="form-grid">
      ${firebase && !built.apiKey ? `
      <div class="field full">
        <label>Firebase Web-API-Schlüssel</label>
        <input id="cApiKey" value="${esc(c.apiKey || '')}" placeholder="AIzaSy…" autocomplete="off">
        <span class="hint">Projekteinstellungen → Allgemein → Web-API-Schlüssel. Dieser Wert ist
        nicht geheim; abgesichert wird über die Zugriffsregeln des Speichers.</span>
      </div>` : ''}
      ${firebase && !built.bucket ? `
      <div class="field full">
        <label>Speicherort (Bucket)</label>
        <input id="cBucket" value="${esc(c.bucket || '')}" placeholder="mein-projekt.firebasestorage.app" autocomplete="off">
      </div>` : ''}
      <div class="field full">
        <label>Google-Client-ID (${CLIENT_TYP})</label>
        <input id="cClientId" value="${esc(c.clientId || '')}" placeholder="1234567890-abcdef.apps.googleusercontent.com" autocomplete="off">
      </div>
      <div class="field full">
        <label>Client-Schlüssel</label>
        <input id="cClientSecret" type="password" placeholder="${c.clientSecret ? '••••••••  (gespeichert)' : 'GOCSPX-…'}" autocomplete="off">
        <span class="hint">Bei diesem Client-Typ gilt der Wert nach Googles eigener
        Festlegung nicht als geheim – er wird trotzdem verschlüsselt im Tresor abgelegt.</span>
      </div>
    </div>
    <button class="btn primary" id="btnSaveCreds">Zugangsdaten speichern</button>`;
}

function wireCloud(root, status) {
  // Beim Wechsel des Anbieters ändern sich die benötigten Felder.
  $('#cProvider', root)?.addEventListener('change', async (e) => {
    await api.cloud.configure({ provider: e.target.value });
    renderCloudCard(root);
  });

  $('#btnSaveCreds', root)?.addEventListener('click', async () => {
    const provider = $('#cProvider', root)?.value || 'firebase';
    const clientId = $('#cClientId', root).value.trim();
    const clientSecret = $('#cClientSecret', root).value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      warn('Die Client-ID sieht nicht richtig aus', 'Sie endet normalerweise auf .apps.googleusercontent.com');
      return;
    }
    const cfg = { provider, clientId };
    // Ein leeres Feld heißt „nicht ändern“, damit ein gespeicherter Schlüssel
    // nicht versehentlich gelöscht wird.
    if (clientSecret) cfg.clientSecret = clientSecret;

    if (provider === 'firebase') {
      // Felder, die bereits mitgeliefert sind, werden gar nicht erst angezeigt.
      const apiKeyEl = $('#cApiKey', root);
      const bucketEl = $('#cBucket', root);
      if (apiKeyEl) {
        const apiKey = apiKeyEl.value.trim();
        if (!/^AIza[\w-]{20,}$/.test(apiKey)) {
          warn('Der Web-API-Schlüssel sieht nicht richtig aus', 'Er beginnt normalerweise mit AIza…');
          return;
        }
        cfg.apiKey = apiKey;
      }
      if (bucketEl) {
        const bucket = bucketEl.value.trim();
        if (!bucket || /\s/.test(bucket)) {
          warn('Bitte den Speicherort eintragen', 'Zum Beispiel mein-projekt.firebasestorage.app');
          return;
        }
        cfg.bucket = bucket;
      }
    }

    await api.cloud.configure(cfg);
    ok('Zugangsdaten gespeichert');
    renderCloudCard(root);
  });

  $('#btnEditCreds', root)?.addEventListener('click', async () => {
    await api.cloud.configure({ clientId: '', clientSecret: '' });
    renderCloudCard(root);
  });

  $('#btnConnect', root)?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    btn.disabled = true;
    btn.textContent = WEB ? 'Warte auf die Anmeldung …' : 'Warte auf den Browser …';
    try {
      const res = await api.cloud.connect();
      ok('Mit Google verbunden', res.email);
      await firstLink(root);
    } catch (ex) {
      err('Verbindung fehlgeschlagen', ex.message);
      renderCloudCard(root);
    }
  });

  $('#cAuto', root)?.addEventListener('change', async (e) => {
    await api.cloud.configure({ autoSync: e.target.checked });
    if (e.target.checked) startAutoSync();
    ok(e.target.checked ? 'Automatik eingeschaltet' : 'Automatik ausgeschaltet');
  });

  $('#cInterval', root)?.addEventListener('change', async (e) => {
    await api.cloud.configure({ autoSyncMinutes: Number(e.target.value) });
    ok('Abstand gespeichert');
  });

  $('#btnSync', root)?.addEventListener('click', async () => {
    await runSync(root);
  });

  $('#btnConflicts', root)?.addEventListener('click', () => openConflicts());

  $('#btnUnlink', root)?.addEventListener('click', async () => {
    const wahl = await askUnlink();
    if (!wahl) return;
    try {
      await api.cloud.disconnect(!wahl.loeschen);
      ok('Verbindung getrennt', wahl.loeschen
        ? 'Tresor und Belege wurden auch in der Cloud gelöscht.'
        : 'Der verschlüsselte Stand bleibt in der Cloud liegen.');
    } catch (e) {
      err('Trennen fehlgeschlagen', e.message);
    }
    renderCloudCard(root);
  });
}

/**
 * Trennen mit der Wahl, ob die Ablage in der Cloud mitgelöscht wird. Die
 * Datenschutzhinweise sagen diese Möglichkeit zu – deshalb steht sie hier,
 * nicht irgendwo in der Google-Kontoverwaltung.
 */
function askUnlink() {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Verbindung zu Google trennen?',
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Der Zugriff wird bei Google widerrufen. Ihre
        Buchhaltung bleibt vollständig auf diesem ${WEB ? 'Gerät' : 'Rechner'}.</p>
        <label class="check mt16"><input type="checkbox" id="unlinkDelete"> Tresor und Belege
        auch in der Cloud löschen</label>
        <p class="small muted mt8 mb0">Ohne Häkchen bleibt der verschlüsselte Stand dort liegen,
        etwa um sich später wieder zu verbinden. Nach einem erneuten Verbinden lässt er sich
        hier jederzeit löschen.</p>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn danger" data-yes>Trennen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const loeschen = m.root.querySelector('#unlinkDelete').checked;
      m.close();
      resolve({ loeschen });
    });
  });
}

/** Erster Abgleich nach dem Verbinden – hier entscheidet sich, welcher Stand gilt. */
async function firstLink(root) {
  let begin;
  try {
    begin = await api.cloud.begin();
  } catch (e) {
    err('Cloud nicht erreichbar', e.message);
    renderCloudCard(root);
    return;
  }

  if (begin.state === 'leer') {
    toast('Cloud ist noch leer', 'Ihr aktueller Stand wird hochgeladen.');
    await runSync(root);
    return;
  }

  if (begin.state === 'fremd') {
    await decideForeign(root, begin);
    return;
  }

  await runSync(root);
}

/** Cloud-Datei gehört zu einem anderen Tresor – das muss der Mensch entscheiden. */
async function decideForeign(root, begin) {
  const m = modal({
    title: 'In der Cloud liegt bereits eine andere Buchhaltung',
    body: html`
      <div class="notice warn">
        In Ihrem Google-Konto liegt schon ein Kontovia-Tresor, der sich mit dem Passwort
        dieses Geräts nicht öffnen lässt. Das ist der normale Fall, wenn Sie Kontovia
        vorher auf einem anderen Rechner eingerichtet haben.
      </div>
      <p class="small">Cloud-Stand: ${esc(bytes(begin.size || 0))}, zuletzt geändert
      ${esc(fmtDateTime(begin.modifiedTime))}.</p>
      <p class="small">Auf diesem Gerät: ${int(store.db.transactions.length)} Buchungen,
      ${int(store.db.appointments.length)} Termine.</p>
      <h4 style="margin:20px 0 6px;font-size:14px">Wie möchten Sie weitermachen?</h4>
      <div class="stack" style="gap:12px">
        <div class="notice">
          <strong>Cloud-Stand übernehmen</strong> – der empfohlene Weg, wenn dieses Gerät neu
          dazukommt. Ihr hiesiger Tresor wird vorher gesichert, dann durch den Cloud-Stand
          ersetzt. Danach melden Sie sich mit dem Passwort des anderen Geräts an, und ab da
          arbeiten beide Geräte auf demselben Bestand.
        </div>
        <div class="notice">
          <strong>Cloud überschreiben</strong> – nur, wenn der Cloud-Stand veraltet oder ein
          Fehlversuch war. <span class="strong" style="color:var(--neg)">Was dort liegt, ist
          danach weg.</span>
        </div>
      </div>`,
    foot: `<button class="btn" data-cancel>Später entscheiden</button>
           <button class="btn danger" data-overwrite>Cloud überschreiben</button>
           <button class="btn primary" data-adopt>Cloud-Stand übernehmen</button>`,
  });

  m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); renderCloudCard(root); });

  m.root.querySelector('[data-adopt]').addEventListener('click', async () => {
    m.close();
    const yes = await confirmDialog({
      title: 'Cloud-Stand übernehmen?',
      text: 'Der Tresor dieses Geräts wird zuvor in den Sicherungsordner kopiert und dann ersetzt. Anschließend werden Sie nach dem Passwort des Cloud-Tresors gefragt.',
      confirmLabel: 'Übernehmen',
    });
    if (!yes) { renderCloudCard(root); return; }
    try {
      await api.cloud.adoptRemote();
      // Der Hauptprozess sperrt danach – die Anmeldemaske erscheint von selbst.
    } catch (e) {
      err('Übernahme fehlgeschlagen', e.message);
      renderCloudCard(root);
    }
  });

  m.root.querySelector('[data-overwrite]').addEventListener('click', async () => {
    m.close();
    const yes = await confirmDialog({
      title: 'Cloud-Stand unwiderruflich überschreiben?',
      text: 'Die Buchhaltung, die derzeit in Ihrem Google-Konto liegt, wird durch den Stand dieses Geräts ersetzt und ist danach nicht wiederherstellbar.',
      confirmLabel: 'Überschreiben', danger: true,
    });
    if (!yes) { renderCloudCard(root); return; }
    try {
      await api.cloud.overwriteRemote();
      ok('Cloud-Stand ersetzt');
    } catch (e) {
      err('Fehlgeschlagen', e.message);
    }
    renderCloudCard(root);
  });
}

async function runSync(root) {
  const box = $('#syncStatus', root);
  if (box) box.innerHTML = '<div class="skeleton" style="height:44px"></div>';
  try {
    const res = await syncNow({ reason: 'manuell' });
    if (res.needsDecision) { await decideForeign(root, res); return; }
    if (res.skipped) { toast('Nichts zu tun', res.skipped); }
    else ok('Abgleich abgeschlossen', res.summary || '');
  } catch (e) {
    err('Abgleich fehlgeschlagen', e.message);
  }
  renderCloudCard(root);
}

function paintSyncStatus(root) {
  const box = $('#syncStatus', root);
  if (!box) return;
  const s = syncState;
  if (s.running) {
    box.innerHTML = html`<div class="notice">Abgleich läuft …${s.progress ? raw(` <span class="muted">${esc(String(s.progress.phase || ''))}</span>`) : ''}</div>`;
  } else if (s.lastError) {
    box.innerHTML = html`<div class="notice danger">Letzter Versuch fehlgeschlagen: ${s.lastError}</div>`;
  } else if (s.lastResult) {
    box.innerHTML = html`<div class="notice ok">Zuletzt ${fmtDateTime(s.lastAt)}: ${s.lastResult.summary}.
      ${s.lastResult.attachments ? raw(`<span class="muted">Belege: ${s.lastResult.attachments.hochgeladen} hoch, ${s.lastResult.attachments.heruntergeladen} runter.</span>`) : ''}</div>`;
  } else {
    box.innerHTML = '';
  }
}

/* -------------------------------------------------------------------------- */
/* Konflikte                                                                   */
/* -------------------------------------------------------------------------- */

export function openConflicts() {
  const list = [...(store.db.syncConflicts || [])].reverse().map((c, i) => ({ ...c, nr: i }));
  const arten = [...new Set(list.map((c) => c.label))];
  const m = modal({
    title: 'Konflikte beim Abgleich',
    size: 'wide',
    body: html`
      <p class="mt0 small muted">Ein Konflikt entsteht, wenn derselbe Datensatz auf zwei
      Geräten unterschiedlich geändert wurde. Kontovia behält die zuletzt bearbeitete
      Fassung und legt die andere hier ab – verloren geht nichts.</p>
      ${list.length ? table({
        id: 'konflikte',
        cls: 'data compact',
        maxHeight: '56vh',
        toolbar: list.length > 8,
        defaultSort: { key: 'at', dir: -1 },
        rows: list,
        unit: ['Konflikt', 'Konflikte'],
        columns: [
          { key: 'at', label: 'Zeitpunkt', type: 'date', tdCls: 'nowrap small', cell: (c) => esc(fmtDateTime(c.at)) },
          { key: 'label', label: 'Art', type: 'text', cell: (c) => `<span class="badge">${esc(c.label)}</span>` },
          {
            key: 'text', label: 'Datensatz', type: 'text', value: (c) => c.text || c.id,
            cell: (c) => `<span class="truncate" style="display:block;max-width:280px">${esc(c.text || c.id)}</span>${c.note ? `<div class="tiny muted">${esc(c.note)}</div>` : ''}`,
          },
          {
            key: 'kept', label: 'Behalten', type: 'text', value: (c) => (c.kept === 'lokal' ? 'dieses Gerät' : 'Cloud'),
            cell: (c) => (c.kept === 'lokal' ? '<span class="badge info">dieses Gerät</span>' : '<span class="badge">Cloud</span>'),
          },
          {
            key: 'actions', label: '', type: 'none', width: '150px', cls: 'right',
            cell: (c) => (c.discarded ? `<button class="btn sm" data-show="${c.nr}">Verworfene Fassung</button>` : ''),
          },
        ],
        filters: [
          ...(arten.length > 1 ? [{
            key: 'art', column: 'label', title: 'Art', initial: '',
            options: () => [['', 'Alle Arten', () => true], ...arten.map((a) => [a, a, (c) => c.label === a])],
          }] : []),
          {
            key: 'behalten', column: 'kept', title: 'Behalten', initial: 'alle', chip: (v, label) => `Behalten: ${label}`,
            options: () => [['alle', 'Beide', () => true], ['lokal', 'dieses Gerät', (c) => c.kept === 'lokal'], ['cloud', 'Cloud', (c) => c.kept !== 'lokal']],
          },
        ],
        onRender: (el) => el.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => zeigeVerworfen(list[Number(b.dataset.show)]))),
      }) : emptyState('Keine Konflikte', 'Bisher gab es beim Abgleich nichts zu entscheiden.')}`,
    foot: `${list.length ? '<button class="btn left" data-clear>Liste leeren</button>' : ''}
           <button class="btn primary" data-x>Schließen</button>`,
  });

  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-clear]')?.addEventListener('click', async () => {
    await commit('konflikte.geleert', (db) => { db.syncConflicts = []; }, { entity: 'abgleich', summary: 'Konfliktliste geleert' });
    await saveNow();
    m.close();
    ok('Liste geleert');
    refresh();
  });
  mountTables(m.root);
}

function zeigeVerworfen(c) {
  const f = modal({
    title: 'Verworfene Fassung',
    body: html`<p class="mt0 small muted">Diese Fassung wurde beim Abgleich zurückgestellt.
      Sie können die Werte von Hand übernehmen, wenn sie die richtigen waren.</p>
      <pre style="background:var(--surface-2);padding:14px;border-radius:8px;overflow-x:auto;font-size:12px;user-select:text">${JSON.stringify(c.discarded, null, 2)}</pre>`,
    foot: '<button class="btn primary" data-y>Schließen</button>',
  });
  f.root.querySelector('[data-y]').addEventListener('click', () => f.close());
}

/* -------------------------------------------------------------------------- */
/* Programmaktualisierung                                                      */
/* -------------------------------------------------------------------------- */

export async function renderUpdateCard(root) {
  const feed = store.db.settings.updateFeedUrl || '';
  // Ist nichts eingetragen, greift die mitgelieferte Adresse. Sie wird
  // angezeigt, damit sichtbar ist, wohin die Prüfung ginge – abgefragt wird
  // sie erst, wenn jemand auf „Nach Updates suchen“ drückt oder die Prüfung
  // beim Start ausdrücklich einschaltet.
  const eingebaut = appInfo.defaultUpdateFeed || '';
  const wirksam = feed || eingebaut;
  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h3>${icon('refresh', 16)} Programmaktualisierung</h3>
        <div class="spacer"></div>
        <span class="badge">Version ${esc(appInfo.version || '')}</span>
      </div>
      <div class="card-body">
        ${WEB ? raw(`<p class="small mt0" style="color:var(--text-2);line-height:1.6">Die Web-Fassung
          liegt vollständig auf diesem Gerät und läuft auch ohne Netz. Eine neue Fassung wird erst
          geladen und eingesetzt, wenn Sie es hier bestätigen – vorher prüft Kontovia jede Datei
          gegen ihre SHA-256-Prüfsumme.</p>`) : raw(`<div class="field">
          <label>Adresse der Versionsdatei</label>
          <div class="row" style="gap:8px">
            <input id="uFeed" value="${esc(feed)}" placeholder="${esc(eingebaut || 'https://…/update.json')}" style="flex:1">
            <button class="btn" id="uSave">Speichern</button>
          </div>
          <span class="hint">Zeigt auf eine kleine JSON-Datei mit Versionsnummer, Download-Adresse
          und SHA-512-Prüfsumme des Installationspakets.${eingebaut && !feed
            ? ' Solange das Feld leer bleibt, wird die mitgelieferte Adresse verwendet.' : ''}</span>
        </div>`)}
        <div class="row" style="gap:8px">
          <button class="btn primary" id="uCheck" ${wirksam ? '' : 'disabled'}>${icon('refresh', 15)} Nach Updates suchen</button>
          <label class="check"><input type="checkbox" id="uAuto" ${store.db.settings.updateCheckOnStart === true ? 'checked' : ''}> beim Programmstart prüfen</label>
        </div>
        <div id="uResult" class="mt16"></div>
        ${WEB ? raw(`<p class="small muted mt16 mb0">Außerhalb des Cloud-Abgleichs ruft Kontovia nur
        hier etwas ab, und nur, wenn Sie es auslösen oder oben einschalten. Unabhängig davon
        fragt der Browser beim Öffnen von sich aus nach, ob sich die kleine Steuerdatei
        <code>sw.js</code> geändert hat – das lässt sich bei Web-Apps nicht abschalten, tauscht
        aber nichts aus. Der Betreiber des Servers sieht dabei jeweils Ihre IP-Adresse; Angaben
        zu Ihrem Gerät oder Ihrer Buchhaltung werden nicht mitgesendet. Stimmt die Prüfsumme
        einer neuen Datei nicht, wird die ganze neue Fassung verworfen.</p>`) : raw(`<p class="small muted mt16 mb0">Die Prüfung ist der einzige Netzzugriff außerhalb des
        Cloud-Abgleichs und findet nur statt, wenn Sie sie auslösen oder oben einschalten.
        Der Betreiber des Servers sieht dabei Ihre IP-Adresse; Angaben zu Ihrem Gerät oder
        Ihrer Buchhaltung werden nicht mitgesendet. Vor der Installation wird die
        heruntergeladene Datei gegen die Prüfsumme aus der Versionsdatei geprüft. Stimmt sie
        nicht, wird die Datei verworfen. Installiert wird erst nach Ihrer ausdrücklichen
        Bestätigung.</p>`)}
      </div>
    </div>`;

  $('#uSave', root)?.addEventListener('click', async () => {
    const url = $('#uFeed', root).value.trim();
    if (url && !/^https:\/\//.test(url)) { warn('Die Adresse muss mit https:// beginnen'); return; }
    await commit('einstellung.update', (db) => { db.settings.updateFeedUrl = url; }, { silent: true });
    await saveNow();
    ok('Gespeichert');
    renderUpdateCard(root);
  });

  $('#uAuto', root).addEventListener('change', async (e) => {
    const an = e.target.checked;
    await commit('einstellung.update', (db) => { db.settings.updateCheckOnStart = an; }, { silent: true });
    await saveNow();
    // Sofort wirksam werden lassen, statt bis zum nächsten Entsperren zu warten.
    const { startUpdateWatch, stopUpdateWatch } = await import('../lib/updates.js');
    if (an) startUpdateWatch(); else stopUpdateWatch();
    ok(an ? 'Prüfung eingeschaltet' : 'Prüfung ausgeschaltet');
  });

  $('#uCheck', root).addEventListener('click', () => checkForUpdate($('#uResult', root)));
}

/**
 * Zeigt die gefundene Fassung als eigenes Fenster – der Weg, der aus der
 * Seitenleiste und aus dem Hinweis beim Start führt. Die Kennungen `uGo` und
 * `uProgress` sind dieselben wie in der Karte unter „Einstellungen“, damit
 * `runUpdate` beide Wege ohne Sonderfall bedienen kann.
 */
export function openUpdateDialog(info) {
  markNotified(info.version);
  const m = modal({
    title: `Version ${info.version} ist verfügbar`,
    size: 'slim',
    body: html`
      <p class="mt0">Sie verwenden Version ${esc(info.current)}.
      ${info.released ? raw(`Die neue Fassung wurde am ${esc(fmtDate(String(info.released).slice(0, 10)))} veröffentlicht.`) : ''}</p>
      ${info.notes ? raw(`<div class="notice mt16" style="white-space:pre-wrap">${esc(info.notes)}</div>`) : ''}
      <p class="small muted mt16">${WEB
        ? 'Kontovia lädt die neuen Programmdateien und prüft jede gegen ihre SHA-256-Prüfsumme. Ihre Buchhaltung bleibt dabei unberührt.'
        : 'Kontovia lädt das Installationspaket herunter und prüft es gegen die hinterlegte SHA-512-Prüfsumme. Ihre Buchhaltung bleibt dabei unberührt – der Datenordner wird von der Installation nicht angefasst.'}</p>
      <div id="uProgress" class="mt8"></div>`,
    foot: `<button class="btn" data-later>Später erinnern</button>
           <button class="btn primary" id="uGo">${icon('export', 15).__raw} ${WEB ? 'Aktualisieren' : 'Herunterladen und installieren'}</button>`,
  });
  m.root.querySelector('[data-later]').addEventListener('click', () => m.close());
  m.root.querySelector('#uGo').addEventListener('click', () => runUpdate(info, m.root));
  return m;
}

export async function checkForUpdate(box, { silent = false } = {}) {
  if (box) box.innerHTML = '<div class="skeleton" style="height:40px"></div>';
  let info;
  try {
    info = await checkUpdates({ silent });
  } catch (e) {
    if (box) box.innerHTML = html`<div class="notice danger">${e.message}</div>`;
    else if (!silent) err('Update-Prüfung fehlgeschlagen', e.message);
    return null;
  }

  // Bei stiller Prüfung schluckt checkUpdates den Fehler und liefert nichts.
  if (!info) {
    if (box) box.innerHTML = html`<div class="notice warn">Die Prüfung war nicht erfolgreich.</div>`;
    return null;
  }
  if (!info.configured) {
    if (box) box.innerHTML = html`<div class="notice">Es ist keine Update-Adresse hinterlegt.</div>`;
    return null;
  }
  if (info.reachable === false) {
    if (box) box.innerHTML = html`<div class="notice warn">Der Update-Server ist gerade nicht erreichbar.</div>`;
    return null;
  }
  if (!info.available) {
    if (box) box.innerHTML = html`<div class="notice ok">Sie verwenden bereits die neueste Version (${info.current}).</div>`;
    return null;
  }

  if (box) {
    box.innerHTML = html`
      <div class="notice warn">
        <strong>Version ${info.version} ist verfügbar</strong> – Sie haben ${info.current}.
        ${info.released ? raw(`<span class="muted"> Veröffentlicht am ${esc(fmtDate(String(info.released).slice(0, 10)))}.</span>`) : ''}
        ${info.notes ? raw(`<div class="mt8" style="white-space:pre-wrap">${esc(info.notes)}</div>`) : ''}
        <div class="row mt16" style="gap:8px">
          <button class="btn primary" id="uGo">${icon('export', 15)} ${WEB ? 'Aktualisieren' : 'Herunterladen und installieren'}</button>
          <span class="muted small">${esc(bytes(info.size))}</span>
        </div>
        <div id="uProgress" class="mt8"></div>
      </div>`;
    box.querySelector('#uGo').addEventListener('click', () => runUpdate(info, box));
  }
  return info;
}

async function runUpdate(info, box) {
  const yes = await confirmDialog(WEB ? {
    title: `Auf Version ${info.version} wechseln?`,
    text: 'Kontovia lädt die neuen Programmdateien, prüft jede gegen ihre Prüfsumme und lädt sich dann neu. Ungespeicherte Änderungen werden vorher gesichert; danach melden Sie sich wieder mit Ihrem Passwort an.',
    confirmLabel: 'Aktualisieren',
  } : {
    title: `Version ${info.version} installieren?`,
    text: 'Kontovia lädt das Installationspaket herunter, prüft die Prüfsumme und startet dann das Installationsprogramm. Die Anwendung wird dabei beendet – ungespeicherte Änderungen werden vorher gesichert.',
    confirmLabel: 'Herunterladen',
    extra: `<div class="notice mt16 tiny" style="font-family:var(--mono);word-break:break-all">SHA-512: ${esc(info.sha512)}</div>`,
  });
  if (!yes) return;

  const btn = box.querySelector('#uGo');
  const prog = box.querySelector('#uProgress');
  btn.disabled = true;
  const off = api.on.updateProgress((p) => {
    const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
    prog.innerHTML = `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>
      <div class="tiny muted mt8">${bytes(p.received)}${p.total ? ' von ' + bytes(p.total) : ''}</div>`;
  });

  try {
    if (store.dirty) await saveNow();
    const file = await api.update.download(info);
    off();
    prog.innerHTML = WEB
      ? '<div class="notice ok">Alle Prüfsummen stimmen. Kontovia wird neu geladen …</div>'
      : '<div class="notice ok">Prüfsumme stimmt. Das Installationsprogramm wird gestartet …</div>';
    await api.update.install(file.path);
  } catch (e) {
    off();
    btn.disabled = false;
    prog.innerHTML = html`<div class="notice danger">${e.message}</div>`;
  }
}
