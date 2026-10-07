/** Kontovia – Bedienflächen für Cloud-Abgleich und Programmaktualisierung. */

import { html, raw, esc, $, $$, bytes, fmtDateTime, fmtDate, int } from '../lib/util.js';
import { icon, modal, confirmDialog, askPassword, ok, err, toast, emptyState } from '../lib/ui.js';
import { store, commit, saveNow, setDb } from '../lib/store.js';
import { syncNow, syncState, onSync, startAutoSync } from '../lib/sync.js';
import { checkUpdates, markNotified } from '../lib/updates.js';
import { refresh, navigate } from '../lib/router.js';
import { appInfo, setCloudVerbunden } from '../app.js';
import { table, mountTables } from '../lib/table.js';

const api = window.kontovia;
/** Wie SICHERUNG_BEHALTEN in src/web/cloud.js. */
const SICHERUNGEN_BEHALTEN = 30;

/* -------------------------------------------------------------------------- */
/* Cloud                                                                       */
/* -------------------------------------------------------------------------- */

export async function renderCloudCard(root) {
  const status = await api.cloud.status().catch(() => ({ configured: false }));
  const conflicts = store.db.syncConflicts || [];
  setCloudVerbunden(status.configured ? !!status.linked : null);

  let quotaLine = '';
  /** „Mit Google entsperren“: nur hier, bei der Google-Verbindung, an- und abzuschalten. */
  let google = null;
  if (status.linked) {
    const [q, s] = await Promise.all([api.cloud.quota().catch(() => null), api.entsperrung.status().catch(() => null)]);
    if (q) {
      quotaLine = q.limit
        ? `${bytes(q.used)} von ${bytes(q.limit)} in Ihrem Google-Konto belegt`
        : `${bytes(q.used)} belegt`;
    }
    google = s?.google?.moeglich ? s.google : null;
  }

  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h2>${icon('archive', 16)} Cloud-Abgleich und Sicherung</h2>
        <div class="spacer"></div>
        ${status.linked ? raw(`<span class="badge pos">verbunden${status.email ? ': ' + esc(status.email) : ''}</span>`)
          : raw('<span class="badge">nicht verbunden</span>')}
      </div>
      <div class="card-body">
        <div class="notice mb16">
          <strong>Was dabei übertragen wird.</strong> Ausschließlich Ihre bereits
          verschlüsselte Buchhaltung. ${google?.eingerichtet
    ? raw('<strong>Weil „Mit Google entsperren“ eingeschaltet ist, liegt dort auch der Schlüssel dazu</strong> (siehe unten).')
    : 'Ohne Ihr Passwort lässt sie sich nicht lesen, weder von Google noch vom Hersteller von Kontovia.'} Sie liegt im Cloud-Speicher von
          Kontovia bei Google, in einem Bereich, an den nur Ihr Google-Konto herankommt.
          Kosten entstehen Ihnen keine. Daneben bleiben bis zu ${SICHERUNGEN_BEHALTEN} ältere
          Stände als Sicherung dort liegen.
        </div>

        ${status.umgestellt ? raw(`<div class="notice warn mb16">${status.umgestellt === 'drive'
          ? 'Ihre Cloud-Sicherung lief bisher über Google Drive. Diesen Weg gibt es nicht mehr.'
          : 'Ihre Cloud-Sicherung lief bisher über ein eigenes Google-Projekt. Das lässt sich nicht mehr einstellen.'}
          Ihre Buchhaltung auf diesem Gerät ist vollständig. Verbinden Sie die Cloud-Sicherung
          bitte einmal neu, dann ist sie wieder auf dem aktuellen Stand.</div>`) : ''}

        ${!status.configured ? raw(`<div class="notice warn">In dieser Fassung ist kein Cloud-Abgleich
          verfügbar. Ihre Buchhaltung bleibt auf diesem Gerät; sichern Sie sie
          regelmäßig mit einer Vollsicherung.</div>`) : ''}

        ${status.configured && !status.linked ? raw(`
          <div class="row wrap" style="gap:8px">
            <button class="btn primary" id="btnConnect">${icon('key', 15).__raw} Mit Google verbinden</button>
            ${status.weiterleitung ? '<button class="btn ghost" id="btnConnectCode">Klappt nicht? Mit Code verbinden</button>' : ''}
          </div>
          <p class="small muted mt16 mb0">${status.weiterleitung
            ? `Sie werden zu Google weitergeleitet und kommen nach der Anmeldung hierher zurück. Kontovia
          ist dann gesperrt. Entsperren Sie es einmal mit Ihrem Passwort, dann steht die Verbindung.`
            : `Kontovia zeigt einen kurzen Code, den Sie auf google.com/device eingeben, auf
          diesem oder einem anderen Gerät. Dort sehen Sie in der Adresszeile, dass Sie Ihr
          Passwort bei Google eingeben und nicht bei Kontovia.`} Ihre Buchhaltung bleibt dabei, wie sie ist. Ist das
          Konto noch leer, wird sie hochgeladen; liegt dort schon eine, fragt Kontovia, welche gelten soll.</p>
          <p class="small muted mt8 mb0">Mit der Verbindung bestätigt dieses Gerät alle 30 Tage von selbst bei Ihrem Konto, dass es noch zugelassen ist.
          Dabei wird nur gelesen, es gehen keine Angaben zu Ihrer Buchhaltung hinaus.</p>`) : ''}

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
          <div id="syncStatus" class="mt16"></div>

          <h3 class="mt24 mb8" style="font-size:14px">Sicherungen in der Cloud</h3>
          <p class="small muted mt0">Einmal am Tag legt der Abgleich zusätzlich eine Kopie des
          verschlüsselten Tresors in Ihrem Konto ab, außerdem vor jedem Überschreiben und jeder
          Wiederherstellung. Die ${SICHERUNGEN_BEHALTEN} neuesten bleiben erhalten. So lässt sich
          auch ein Stand zurückholen, den alle Geräte schon übernommen haben, etwa nach einem
          versehentlichen Löschen.</p>
          ${status.cloudBackupError ? `<div class="notice warn mb8 small">Die letzte Sicherung in der Cloud ist fehlgeschlagen: ${esc(status.cloudBackupError)}</div>` : ''}
          <div class="row wrap" style="gap:8px">
            <button class="btn" id="btnCloudBackup">${icon('save', 15).__raw} Jetzt in der Cloud sichern</button>
            <button class="btn" id="btnCloudBackups">${icon('history', 15).__raw} Sicherungen ansehen</button>
            <span class="small muted">${status.lastCloudBackupAt ? `Zuletzt ${esc(fmtDateTime(status.lastCloudBackupAt))}` : 'Noch keine Sicherung von diesem Gerät'}</span>
          </div>
          ${googleBlock(google)}`) : ''}
      </div>
    </div>`;

  wireCloud(root, status);
  wireGoogle(root, google);
  paintSyncStatus(root);
}

/* -------------------------------------------------------------------------- */
/* Mit Google entsperren (src/web/entsperrung.js)                              */
/* -------------------------------------------------------------------------- */

/**
 * Der Schalter für „Mit Google entsperren“. Er steht nur hier, bei der
 * Google-Verbindung, und sagt am Knopf deutlich, was er kostet: Der Schlüssel
 * liegt dann unverschlüsselt im Cloud-Speicher, das Kontovia-Passwort schützt
 * nicht mehr.
 */
function googleBlock(g) {
  if (!g) return '';
  return `
    <h3 class="mt24 mb8" style="font-size:14px">Mit Google entsperren, ohne Passwort</h3>
    ${g.eingerichtet ? `
      <div class="notice danger mb8"><strong>Eingeschaltet. Das ist ein großes Sicherheitsrisiko.</strong>
      Wer sich mit ${esc(g.email || 'Ihrem Google-Konto')} bei Google anmeldet, öffnet Ihre Buchhaltung ohne Ihr
      Kontovia-Passwort, auf jedem Gerät. Ihre Daten sind damit nur noch durch das Passwort Ihres Google-Kontos geschützt.</div>
      <button class="btn primary" id="btnGoogleSchluessel">Ausschalten</button>`
    : `
      <p class="small muted mt0">Auf Wunsch öffnet Kontovia Ihre Buchhaltung auf jedem Gerät allein mit der Anmeldung bei Google.</p>
      <div class="notice danger mb8"><strong>Großes Sicherheitsrisiko.</strong> Dafür liegt der Schlüssel zu Ihrer Buchhaltung
      unverschlüsselt in Ihrem Cloud-Speicher. Ihre Daten sind dann nur noch durch das Passwort Ihres Google-Kontos geschützt,
      nicht mehr durch Ihr Kontovia-Passwort: Wer Ihr Google-Konto übernimmt, kann Ihre ganze Buchhaltung lesen. Technisch
      kämen dann auch Google und der Hersteller von Kontovia an sie heran. Wir raten davon ab.</div>
      <button class="btn danger" id="btnGoogleSchluessel">Trotzdem einschalten …</button>`}`;
}

function wireGoogle(root, g) {
  $('#btnGoogleSchluessel', root)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!g.eingerichtet && !await googleEinschaltenFrage(g.email)) return;
    btn.disabled = true;
    try {
      if (g.eingerichtet) {
        await api.entsperrung.googleEntfernen();
        ok('Ausgeschaltet', 'Der Schlüssel ist aus Ihrem Cloud-Speicher gelöscht. Kontovia öffnet sich wieder nur mit Ihrem Passwort oder Fingerabdruck.');
      } else {
        await api.entsperrung.googleEinrichten();
        ok('Eingeschaltet', 'Kontovia lässt sich jetzt mit Ihrem Google-Konto öffnen, ohne Passwort. Auf Ihren anderen Geräten erscheint der Knopf nach dem nächsten Entsperren.');
      }
    } catch (ex) { err('Nicht geklappt', ex.message); }
    renderCloudCard(root);
  });
}

/** Einschalten nur nach einem Häkchen: Wer es tut, soll gelesen haben, was es bedeutet. */
function googleEinschaltenFrage(email) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: 'Mit Google entsperren einschalten?',
      size: 'slim',
      body: html`
        <div class="notice danger mt0"><strong>Das ist ein großes Sicherheitsrisiko.</strong></div>
        <ul class="small" style="line-height:1.6;padding-left:18px">
          <li>Der Schlüssel zu Ihrer Buchhaltung liegt dann unverschlüsselt in Ihrem Cloud-Speicher.</li>
          <li>Ihre Daten sind nur noch durch das Passwort Ihres Google-Kontos${email ? ` (${email})` : ''} geschützt. Ihr Kontovia-Passwort schützt sie dann nicht mehr.</li>
          <li>Wer Ihr Google-Konto übernimmt, kann Ihre ganze Buchhaltung lesen, auf jedem Gerät. Technisch kämen auch Google und der Hersteller von Kontovia an sie heran.</li>
          <li>Ausschalten löscht den Schlüssel dort wieder. Wer ihn vorher kopiert hat, kann Ihre Buchhaltung aber weiter öffnen, auch mit allen späteren Änderungen.</li>
        </ul>
        <p class="small muted">Sicherer: ein neues Gerät mit dem QR-Code verbinden (Sicherheit & Zugang, Weitere Geräte) und dort Fingerabdruck oder Gesicht einschalten.</p>
        <label class="check mt16"><input type="checkbox" id="gsOk"> <span>Ich habe verstanden, dass meine Buchhaltung dann nur noch durch mein Google-Konto geschützt ist.</span></label>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn danger" data-ja disabled>Trotzdem einschalten</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    const feld = m.root.querySelector('#gsOk');
    const ja = m.root.querySelector('[data-ja]');
    feld.addEventListener('change', () => { ja.disabled = !feld.checked; });
    ja.addEventListener('click', () => { fertig = true; m.close(); resolve(true); });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(false); });
    setTimeout(() => m.root.querySelector('[data-nein]').focus(), 60);
  });
}

function wireCloud(root, status) {
  const verbinden = async (e, { mitCode = false } = {}) => {
    const btn = e.target.closest('button');
    btn.disabled = true;
    const weiter = status.weiterleitung && !mitCode;
    btn.textContent = weiter ? 'Weiter zu Google …' : 'Warte auf die Anmeldung …';
    // Die Weiterleitung verlässt die Seite – vorher alles speichern.
    if (weiter && store.dirty) await saveNow();
    try {
      const res = await api.cloud.connect({ mitCode });
      ok('Mit Google verbunden', res.email);
      await firstLink(root);
    } catch (ex) {
      if (ex.code !== 'ABGEBROCHEN') err('Verbindung fehlgeschlagen', ex.message);
      renderCloudCard(root);
    }
  };
  $('#btnConnect', root)?.addEventListener('click', (e) => verbinden(e));
  $('#btnConnectCode', root)?.addEventListener('click', (e) => verbinden(e, { mitCode: true }));

  $('#btnCloudBackup', root)?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      if (store.dirty) await saveNow();
      const res = await api.cloud.backupNow();
      ok('In der Cloud gesichert', `${fmtDateTime(res.at)} · ${bytes(res.size)}`);
    } catch (ex) {
      err('Sicherung fehlgeschlagen', ex.message);
    }
    renderCloudCard(root);
  });

  $('#btnCloudBackups', root)?.addEventListener('click', () => openCloudBackups(root));

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
        ? 'Tresor, Belege, Sicherungen und Ihr Anmeldekonto wurden auch in der Cloud gelöscht.'
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
      title: 'Verbindung zur Cloud trennen?',
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Dieses Gerät meldet sich von der Cloud ab. Ihre
        Buchhaltung bleibt vollständig auf diesem Gerät, und Ihre anderen
        Geräte bleiben verbunden.</p>
        <label class="check mt16"><input type="checkbox" id="unlinkDelete"> Tresor, Belege und
        Sicherungen auch in der Cloud löschen, samt Ihrem Anmeldekonto dort (E-Mail-Adresse)</label>
        <p class="small muted mt8 mb0">Ohne Häkchen bleibt der verschlüsselte Stand dort liegen,
        etwa für Ihre anderen Geräte oder um sich später wieder zu verbinden. Den Zugriff von
        Kontovia auf Ihr Google-Konto entfernen Sie ganz unter myaccount.google.com/connections.</p>`,
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

const ANLASS = {
  auto: 'täglich',
  manuell: 'von Hand',
  'vor-ueberschreiben': 'vor dem Überschreiben',
  'vor-wiederherstellung': 'vor einer Wiederherstellung',
  'vor-cloud-uebernahme': 'vor dem Übernehmen',
  'vor-umstellung': 'Stand vor Version 2.26',
  nachzuegler: 'von einem Gerät mit älterer Version',
};

/** Die Sicherungen in der Cloud – ansehen und einzeln wiederherstellen. */
async function openCloudBackups(root) {
  const m = modal({
    title: 'Sicherungen in der Cloud',
    size: 'wide',
    body: '<div class="skeleton" style="height:120px"></div>',
    foot: '<button class="btn primary" data-x>Schließen</button>',
  });
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  const body = m.body;

  let liste;
  try {
    liste = await api.cloud.backups();
  } catch (e) {
    body.innerHTML = html`<div class="notice danger">Die Liste ließ sich nicht laden: ${e.message}</div>`;
    return;
  }
  if (!liste.length) {
    body.innerHTML = emptyState('Noch keine Sicherung', 'Die erste entsteht beim nächsten Abgleich oder mit „Jetzt in der Cloud sichern“.').__raw;
    return;
  }
  body.innerHTML = html`
    <p class="mt0 small muted">Eine Sicherung ersetzt beim Wiederherstellen den Bestand dieses Geräts;
    der nächste Abgleich bringt ihn zu Ihren anderen Geräten. Der jetzige Stand wird vorher
    gesichert, und zwar hier in der Liste und im Sicherungsordner dieses Geräts.</p>
    <table class="data compact">
      <thead><tr><th>Zeitpunkt</th><th>Anlass</th><th class="num">Größe</th><th></th></tr></thead>
      <tbody>${raw(liste.map((s, i) => `<tr>
        <td class="nowrap">${esc(fmtDateTime(s.at))}</td>
        <td><span class="badge">${esc(ANLASS[s.anlass] || s.anlass || '')}</span></td>
        <td class="num">${esc(bytes(s.size))}</td>
        <td class="right"><button class="btn sm" data-restore="${i}">Wiederherstellen</button></td>
      </tr>`).join(''))}</tbody>
    </table>`;
  body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
    m.close();
    restoreCloudBackup(root, liste[Number(b.dataset.restore)]);
  }));
}

async function restoreCloudBackup(root, s) {
  const yes = await confirmDialog({
    title: `Stand vom ${fmtDateTime(s.at)} wiederherstellen?`,
    text: 'Der Bestand dieses Geräts wird durch die Sicherung ersetzt, und beim nächsten Abgleich gilt sie auch für Ihre anderen Geräte: '
      + 'Was nach diesem Zeitpunkt angelegt oder geändert wurde, ist danach überall auf dem Stand der Sicherung. '
      + 'Der jetzige Stand wird vorher in der Cloud und auf diesem Gerät gesichert. Die Verbindungen dieses Geräts bleiben bestehen.',
    confirmLabel: 'Wiederherstellen', danger: true,
  });
  if (!yes) return;
  try {
    if (store.dirty) await saveNow();
    let res = await api.cloud.restoreBackup(s.name);
    if (res.state === 'passwort') {
      // Die Sicherung stammt aus einem anderen Tresor, etwa dem Stand vor „Cloud überschreiben“.
      const pw = await askPassword({
        title: 'Passwort dieser Sicherung',
        text: 'Diese Sicherung gehört zu einer anderen Buchhaltung als der auf diesem Gerät, etwa dem Stand, der vor einem „Cloud überschreiben“ dort lag. '
          + 'Mit ihrem Passwort wird sie zur Buchhaltung dieses Geräts; die jetzige kommt vorher in den Sicherungsordner.',
        label: 'Passwort', confirmLabel: 'Laden',
      });
      if (!pw) return;
      res = await api.cloud.restoreBackup(s.name, pw);
    }
    // Bei „übernommen“ ist Kontovia jetzt gesperrt und fragt nach dem Passwort der Sicherung.
    if (res.state !== 'eingespielt') return;
    setDb(await api.vault.read());
    await commit('sicherung.wiederhergestellt', () => null, {
      entity: 'bestand', summary: `Stand der Cloud-Sicherung vom ${fmtDateTime(s.at)} wiederhergestellt`,
    });
    await saveNow();
    ok('Sicherung wiederhergestellt', `${int(res.transactions)} Buchungen. Der Abgleich bringt den Stand jetzt zu Ihren anderen Geräten.`);
    navigate('dashboard');
    syncNow({ silent: true, reason: 'wiederherstellung' });
  } catch (e) {
    err('Wiederherstellung fehlgeschlagen', e.code === 'BAD_PASSWORD' ? 'Das Passwort passt nicht zu dieser Sicherung.' : e.message);
    renderCloudCard(root);
  }
}

/**
 * Web-Fassung: zurück von Google und entsperrt – die Verbindung steht. Wie
 * nach dem Verbinden ohne Weiterleitung entscheidet der erste Abgleich, welcher
 * Stand gilt (bei einer anderen Buchhaltung in der Cloud fragt Kontovia).
 */
export async function nachWeiterleitung(email) {
  await navigate('settings', { abschnitt: 'cloud' });
  let root = null;
  for (let i = 0; i < 100 && !root; i++) {
    root = document.querySelector('#cloudCard');
    if (!root?.querySelector('.card')) { root = null; await new Promise((r) => setTimeout(r, 100)); }
  }
  ok('Mit Google verbunden', email || '');
  if (root) await firstLink(root);
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
      <p class="small">Cloud-Stand: ${bytes(begin.size || 0)}, zuletzt geändert
      ${fmtDateTime(begin.modifiedTime)}.</p>
      <p class="small">Auf diesem Gerät: ${int(store.db.transactions.length)} Buchungen,
      ${int(store.db.appointments.length)} Termine.</p>
      <h3 style="margin:20px 0 6px;font-size:14px">Wie möchten Sie weitermachen?</h3>
      <div class="stack" style="gap:12px">
        <div class="notice">
          <strong>Cloud-Stand übernehmen</strong> ist der empfohlene Weg, wenn dieses Gerät neu
          dazukommt. Ihr hiesiger Tresor wird vorher gesichert, dann durch den Cloud-Stand
          ersetzt. Danach melden Sie sich mit dem Passwort des anderen Geräts an, und ab da
          arbeiten beide Geräte auf demselben Bestand.
        </div>
        <div class="notice">
          <strong>Cloud überschreiben</strong> brauchen Sie nur, wenn der Cloud-Stand veraltet oder ein
          Fehlversuch war. Was dort liegt, wird vorher als Sicherung abgelegt und lässt sich
          unter <em>Sicherungen ansehen</em> mit seinem Passwort zurückholen.
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
      // Die Web-Schicht sperrt danach – die Anmeldemaske erscheint von selbst.
    } catch (e) {
      err('Übernahme fehlgeschlagen', e.message);
      renderCloudCard(root);
    }
  });

  m.root.querySelector('[data-overwrite]').addEventListener('click', async () => {
    m.close();
    const yes = await confirmDialog({
      title: 'Cloud-Stand überschreiben?',
      text: 'Die Buchhaltung, die derzeit in Ihrem Google-Konto liegt, wird durch den Stand dieses Geräts ersetzt. Vorher legt Kontovia sie als Sicherung ab; sie bleibt dort, bis 30 neuere Sicherungen sie verdrängen, und lässt sich mit ihrem Passwort zurückholen.',
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
  } else if (s.lastErrorCode === 'NEU_ANMELDEN') {
    // Sitzung abgelaufen oder widerrufen: neu anmelden, dann gleich weiter abgleichen.
    box.innerHTML = html`<div class="notice warn row wrap" style="gap:12px;justify-content:space-between">
      <span>${s.lastError}</span>
      <button class="btn primary sm" id="btnReauth">${icon('key', 14)} Neu anmelden</button></div>`;
    $('#btnReauth', box).addEventListener('click', async (e) => {
      e.target.closest('button').disabled = true;
      try {
        const res = await api.cloud.connect();
        ok('Wieder angemeldet', res.email || '');
        await runSync(root);
      } catch (ex) {
        if (ex.code !== 'ABGEBROCHEN') err('Anmeldung fehlgeschlagen', ex.message);
        renderCloudCard(root);
      }
    });
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
      Fassung und legt die andere hier ab. Es geht nichts verloren.</p>
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
  // Die Update-Adresse ist eingebaut (version.json neben der App).
  const wirksam = appInfo.defaultUpdateFeed || '';
  root.innerHTML = html`
    <div class="card">
      <div class="card-head">
        <h2>${icon('refresh', 16)} Programmaktualisierung</h2>
        <div class="spacer"></div>
        <span class="badge">Version ${appInfo.version || ''}</span>
      </div>
      <div class="card-body">
        <p class="small mt0" style="color:var(--text-2);line-height:1.6">Kontovia liegt vollständig
          auf diesem Gerät und läuft auch ohne Netz. Eine neue Version wird erst geladen, wenn Sie es
          hier bestätigen.</p>
        <div class="row wrap" style="gap:8px">
          <button class="btn primary" id="uCheck" ${wirksam ? '' : 'disabled'}>${icon('refresh', 15)} Nach Updates suchen</button>
          <label class="check"><input type="checkbox" id="uAuto" ${store.db.settings.updateCheckOnStart === true ? 'checked' : ''}> regelmäßig von selbst suchen</label>
          <button class="btn ghost" id="uNeu">${icon('history', 15)} Neuigkeiten</button>
        </div>
        <div id="uResult" class="mt16"></div>
        <p class="small muted mt16 mb0">Gesucht wird nur, wenn Sie es auslösen oder oben einschalten.
        Der Server sieht dabei Ihre IP-Adresse; Angaben zu Ihrem Gerät oder Ihrer Buchhaltung werden
        nicht mitgesendet. Bevor eine neue Version eingesetzt wird, prüft Kontovia, dass sie
        vollständig und unverändert angekommen ist, und installiert sie erst nach Ihrer Bestätigung.</p>
      </div>
    </div>`;

  $('#uNeu', root).addEventListener('click', () => navigate('help', { tab: 'neu' }));

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

const knopf = () => 'Jetzt aktualisieren';

/**
 * Was vor dem Klick gesagt wird: Wer weiß, dass das Fenster verschwindet und
 * wann es wiederkommt, hält es nicht für einen Absturz.
 */
function vorabText() {
  return 'Kontovia lädt die neue Version, prüft sie und lädt sich dann neu. Ihre Daten bleiben, wie sie sind, und Sie bleiben angemeldet.';
}

/**
 * Ältere Versionshinweise waren für den Editor von Hand umbrochen. Im Fenster
 * bricht der Text selbst um, sonst stehen Satzreste eingerückt auf eigenen
 * Zeilen. Absätze (Leerzeile) und Aufzählungspunkte bleiben.
 */
const versionshinweise = (text) => String(text || '')
  .replace(/\r\n/g, '\n')
  .replace(/([^\n])\n(?![\n*•-])[ \t]*/g, '$1 ')
  .replace(/^[*-] /gm, '• ');

/**
 * Zeigt die gefundene Fassung als eigenes Fenster, der Weg aus der
 * Seitenleiste und aus dem Hinweis beim Start. Die Kennungen `uGo` und
 * `uProgress` sind dieselben wie in der Karte unter „Einstellungen“, damit
 * `runUpdate` beide Wege ohne Sonderfall bedienen kann.
 */
export function openUpdateDialog(info) {
  markNotified(info.version);
  const m = modal({
    title: `Version ${info.version} ist verfügbar`,
    size: 'slim',
    body: html`
      <p class="mt0">Sie verwenden Version ${info.current}.
      ${info.released ? raw(`Die neue Fassung wurde am ${esc(fmtDate(String(info.released).slice(0, 10)))} veröffentlicht.`) : ''}</p>
      ${info.notes ? raw(`<div class="notice mt16" style="white-space:pre-wrap">${esc(versionshinweise(info.notes))}</div>`) : ''}
      <p class="small muted mt16">${vorabText(info)}</p>
      <div id="uProgress" class="mt8"></div>`,
    foot: `<button class="btn" data-later>Später erinnern</button>
           <button class="btn primary" id="uGo">${icon('export', 15).__raw} ${knopf(info)}</button>`,
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
        <strong>Version ${info.version} ist verfügbar.</strong> Sie haben Version ${info.current}.
        ${info.released ? raw(`<span class="muted"> Veröffentlicht am ${esc(fmtDate(String(info.released).slice(0, 10)))}.</span>`) : ''}
        ${info.notes ? raw(`<div class="mt8" style="white-space:pre-wrap">${esc(versionshinweise(info.notes))}</div>`) : ''}
        <p class="small muted mt16 mb0">${vorabText(info)}</p>
        <div class="row mt16" style="gap:8px">
          <button class="btn primary" id="uGo">${icon('export', 15)} ${knopf(info)}</button>
          <span class="muted small">${bytes(info.size)}</span>
        </div>
        <div id="uProgress" class="mt8"></div>
      </div>`;
    box.querySelector('#uGo').addEventListener('click', () => runUpdate(info, box));
  }
  return info;
}

/** Die Schritte des Ablaufs, damit sichtbar bleibt, wo man gerade ist. */
function schritte(info, aktiv) {
  const namen = ['Herunterladen', 'Prüfen', 'Neu laden'];
  return `<ol class="upd-steps">${namen.map((n, i) => `<li class="${i < aktiv ? 'done' : i === aktiv ? 'now' : ''}">${n}</li>`).join('')}</ol>`;
}

/**
 * Das letzte Bild vor dem Neustart. Es füllt das ganze Fenster, damit nichts
 * mehr anzuklicken ist, und sieht aus wie der Startbildschirm, der nach dem
 * Neustart folgt: Das Fenster verschwindet, kommt wieder, und beide Male steht
 * dasselbe Logo da.
 */
function neustartBild(info) {
  const text = `Version ${esc(info.version)} ist geladen. Die Seite lädt sich gleich neu, und Sie bleiben angemeldet.`;
  const o = document.createElement('div');
  o.className = 'gate upd-vollbild';
  o.setAttribute('role', 'alert');
  o.innerHTML = `<div class="gate-card">
      <div class="gate-logo">K</div>
      <h1>Kontovia wird neu geladen</h1>
      <p class="lead">${text}</p>
      <div class="bar-track upd-warten"><div class="bar-fill"></div></div>
      ${schritte(info, 2)}
    </div>`;
  document.getElementById('overlays').append(o);
  return o;
}

async function runUpdate(info, box) {
  const btn = box.querySelector('#uGo');
  const prog = box.querySelector('#uProgress');
  btn.disabled = true;
  // Wer das Fenster jetzt vertagt, bricht den Vorgang nicht ab: Er läuft hier
  // weiter und würde Kontovia unerwartet neu starten. Deshalb ist der Knopf aus.
  const spaeter = box.querySelector('[data-later]');
  if (spaeter) spaeter.disabled = true;

  const zeige = (aktiv, inhalt) => { prog.innerHTML = schritte(info, aktiv) + inhalt; };
  const balken = (received, total) => {
    const pct = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
    // Voll angekommen: Jetzt wird die Prüfsumme gerechnet, der Server meldet erst danach.
    if (total && received >= total) {
      zeige(1, '<div class="tiny muted mt8">Die Datei wird geprüft …</div>');
      return;
    }
    zeige(0, `<div class="bar-track mt8"><div class="bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>
      <div class="tiny muted mt8">${received ? bytes(received) : 'Verbindung wird aufgebaut …'}${total && received ? ` von ${bytes(total)} · ${pct} %` : ''}</div>`);
  };
  balken(0, 0);
  // Im Fenster stehen darüber die Versionshinweise, der Fortschritt soll trotzdem zu sehen sein.
  prog.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  // Die Größe aus der Versionsdatei gilt; die Web-Schicht meldet sie mit.
  const off = api.on.updateProgress((p) => balken(p.received, p.total || info.size || 0));

  let bild = null;
  try {
    if (store.dirty) await saveNow();
    const file = await api.update.download(info);
    off();
    // Während des Ladens vertagt oder weggeklickt: nichts mehr gegen den Willen starten.
    if (!box.isConnected) {
      toast('Update heruntergeladen', 'Es wurde noch nicht installiert. Sie finden es weiterhin unter „Version verfügbar“.', 'warn', 8000);
      return;
    }
    // Was während des Downloads noch eingetragen wurde, kommt mit.
    if (store.dirty) await saveNow();
    bild = neustartBild(info);
    // Einen Moment zum Lesen, bevor die Seite neu lädt.
    await new Promise((r) => setTimeout(r, 1200));
    await api.update.install(file.path);
  } catch (e) {
    off();
    bild?.remove();
    btn.disabled = false;
    if (spaeter) spaeter.disabled = false;
    prog.innerHTML = html`<div class="notice danger">${e.message}</div>`;
  }
}
