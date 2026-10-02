/**
 * Kontovia – Kalender mit Google und anderen Programmen abgleichen.
 *
 * Zwei Wege:
 *   Google Kalender  laufender Abgleich in beide Richtungen, nur in der
 *                    Windows-Fassung (siehe src/web/bridge.js, warum) – mit
 *                    dem eigenen Kalender „Kontovia“ und auf Wunsch mit
 *                    weiteren Kalendern des Kontos (Hauptkalender usw.)
 *   .ics-Datei       Export und Import von Hand, überall – auch für Apple
 *                    Kalender und Outlook
 */

import { html, raw, esc, int, fmtDateTime, todayISO } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, err, warn } from '../lib/ui.js';
import { store, sel, commit, saveNow, applyCalendarChanges } from '../lib/store.js';
import { derivedEntries } from '../lib/gcal.js';
import { toIcs, parseIcs, appointmentIdForUid } from '../lib/ics.js';
import {
  calState, syncCalendar, startCalendarSync, stopCalendarSync,
  refreshCalendarStatus, calendarSettings, timeZone,
} from '../lib/gcalsync.js';
import { refresh } from '../lib/router.js';

const api = window.kontovia;
const WEB = api.platform === 'web';

/* -------------------------------------------------------------------------- */
/* Kurzstatus für Kalenderansicht                                              */
/* -------------------------------------------------------------------------- */

export function statusText(st = calState.status) {
  if (calState.running) return 'Google: Abgleich läuft …';
  if (!st?.linked) return '';
  if (calState.lastError || st.lastError) return 'Google: Fehler beim Abgleich';
  const at = calState.lastAt || st.lastSyncAt;
  return at ? `Google: abgeglichen ${fmtDateTime(at)}` : 'Google: verbunden';
}

/* -------------------------------------------------------------------------- */
/* Einstellungen                                                               */
/* -------------------------------------------------------------------------- */

async function saveCalendarSettings(patch) {
  await commit('einstellung.kalender', (db) => {
    db.settings.googleCalendar = { ...(db.settings.googleCalendar || {}), ...patch };
    db.settings.updatedAt = new Date().toISOString();
  }, { silent: true });
  await saveNow();
}

/** Karte für Einstellungen → Kalender-Abgleich. */
export async function renderCalendarCard(el) {
  if (!el) return;
  const st = await refreshCalendarStatus();
  const cfg = calendarSettings();
  const optionen = html`
    <div class="stack mt8" style="gap:6px">
      <label class="check"><input type="checkbox" data-opt="includeEvents" ${cfg.includeEvents ? 'checked' : ''}> Veranstaltungstermine aus Anzahlungen mit übertragen</label>
      <label class="check"><input type="checkbox" data-opt="includeDue" ${cfg.includeDue ? 'checked' : ''}> Fälligkeiten offener Rechnungen mit übertragen</label>
      <label class="check"><input type="checkbox" data-opt="sendNotes" ${cfg.sendNotes ? 'checked' : ''}> Notizen der Termine mit übertragen</label>
      <span class="hint small muted">Beträge, Buchungen, Kontakte und Belege gehen nie an Google.</span>
    </div>`;

  el.innerHTML = html`
    <div class="card">
      <div class="card-head"><h3>${icon('calendar', 16)} Kalender-Abgleich</h3><span class="sub">Google Kalender und Kalenderdateien</span></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            ${WEB || st?.available === false ? raw(`
              <div class="notice">
                <strong>Google Kalender gibt es nur in der Windows-Fassung.</strong> Hier übertragen
                Sie Termine als Kalenderdatei (.ics).
              </div>`) : st?.linked ? raw(html`
              <div class="notice ok">
                <strong>Verbunden</strong> mit ${st.email || 'Ihrem Google-Konto'} · Kalender
                „${st.calendarName || 'Kontovia'}“<br>
                <span class="small">${calState.running ? 'Abgleich läuft …' : (st.lastSyncAt ? `Zuletzt abgeglichen ${fmtDateTime(st.lastSyncAt)}` : 'Noch nicht abgeglichen')}${calState.lastSummary ? ` · ${calState.lastSummary}` : ''}</span>
              </div>
              ${st.lastError || calState.lastError ? raw(`<div class="notice danger mt8">${esc(calState.lastError || st.lastError)}</div>`) : ''}
              <div class="row wrap mt16" style="gap:8px">
                <button class="btn primary" data-cal="sync">${icon('refresh', 15)} Jetzt abgleichen</button>
                <button class="btn danger" data-cal="disconnect">Trennen</button>
              </div>
              ${raw(optionen)}
              ${raw(weitereAbschnitt(st, cfg))}`) : raw(html`
              <p class="small mt0" style="line-height:1.6">Kontovia legt in Ihrem Google-Konto einen eigenen
              Kalender <strong>„Kontovia“</strong> an und gleicht Ihre Termine in beide Richtungen damit
              ab. Auf dem Telefon sehen Sie sie in der Google-Kalender-App, und was Sie dort im Kalender
              „Kontovia“ eintragen, erscheint hier. Auf Wunsch kommen Ihre übrigen Kalender dazu, etwa
              der Hauptkalender, ebenfalls in beide Richtungen.</p>
              ${st?.lastError ? raw(`<div class="notice warn mb8">${esc(st.lastError)}</div>`) : ''}
              <button class="btn primary" data-cal="connect">${icon('calendar', 15)} Mit Google Kalender verbinden</button>`)}
          </div>
          <div>
            <p class="small mt0" style="line-height:1.6"><strong>Kalenderdatei (.ics):</strong> für
            Apple Kalender, Outlook, ein zweites Google-Konto oder die Web-Fassung. Der Export enthält
            alle Termine; beim Import werden bereits übernommene Termine erkannt und aktualisiert
            statt doppelt angelegt.</p>
            <div class="row wrap" style="gap:8px">
              <button class="btn" data-cal="ics-export">${icon('export', 15)} Als .ics exportieren</button>
              <button class="btn" data-cal="ics-import">${icon('file', 15)} .ics importieren</button>
            </div>
            <p class="tiny muted mt8 mb0">Aus Google Kalender: Einstellungen → Importieren und exportieren →
            Exportieren. Google liefert eine ZIP-Datei; darin liegt je Kalender eine .ics-Datei.</p>
          </div>
        </div>
      </div>
    </div>`;

  const rerender = () => renderCalendarCard(el);
  el.querySelector('[data-cal="connect"]')?.addEventListener('click', async () => { if (await connectGoogle()) rerender(); });
  el.querySelector('[data-cal="disconnect"]')?.addEventListener('click', async () => { if (await disconnectGoogle()) rerender(); });
  el.querySelector('[data-cal="sync"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    await manualSync();
    rerender();
  });
  el.querySelector('[data-cal="weitere-freigeben"]')?.addEventListener('click', async () => {
    if (await freigebenWeitere()) await openKalenderAuswahl();
    rerender();
  });
  el.querySelector('[data-cal="weitere-waehlen"]')?.addEventListener('click', async () => {
    await openKalenderAuswahl();
    rerender();
  });
  el.querySelector('[data-cal="ics-export"]').addEventListener('click', exportIcs);
  el.querySelector('[data-cal="ics-import"]').addEventListener('click', async () => { if (await importIcs()) rerender(); });
  el.querySelectorAll('[data-opt]').forEach((c) => c.addEventListener('change', async () => {
    await saveCalendarSettings({ [c.dataset.opt]: c.checked });
    ok('Gespeichert', 'Gilt ab dem nächsten Abgleich.');
    syncCalendar({ reason: 'einstellung' }).catch(() => {}).finally(rerender);
  }));
}

/** Abschnitt „Weitere Google-Kalender“ in der verbundenen Karte. */
function weitereAbschnitt(st, cfg) {
  const namen = cfg.weitere.map((k) => k.name || k.id);
  if (!st.weitereErlaubt) {
    return `<hr class="sep">
      <strong style="font-size:13px">Weitere Google-Kalender</strong>
      <p class="small mt8" style="line-height:1.6">Termine aus Ihrem Hauptkalender und anderen Kalendern
      in Kontovia sehen und bearbeiten. Änderungen und Löschungen gehen in beide Richtungen.
      Dafür braucht Kontovia einmal zusätzlich Ihre Freigabe bei Google.</p>
      ${namen.length ? `<div class="notice warn small mb8">Ausgewählt sind ${esc(namen.join(', '))}, auf diesem Gerät
        fehlt aber noch die Freigabe.</div>` : ''}
      <button class="btn" data-cal="weitere-freigeben">${icon('calendar', 15).__raw} Weitere Kalender einbeziehen</button>`;
  }
  return `<hr class="sep">
    <strong style="font-size:13px">Weitere Google-Kalender</strong>
    <p class="small mt8 mb8" style="line-height:1.6">${namen.length
      ? `In beide Richtungen abgeglichen: <strong>${esc(namen.join(', '))}</strong>. Termine ab gut einem Jahr zurück.`
      : 'Noch kein weiterer Kalender ausgewählt.'}</p>
    <button class="btn" data-cal="weitere-waehlen">${icon('calendar', 15).__raw} Kalender auswählen</button>`;
}

/** Holt die zusätzliche Freigabe für weitere Kalender – ein neuer Gang zu Google. */
async function freigebenWeitere() {
  const ja = await confirmDialog({
    title: 'Weitere Kalender einbeziehen?',
    text: 'Kontovia fragt bei Google zusätzlich das Recht an, Ihre Kalender aufzulisten und Termine darin zu lesen und zu ändern. '
      + 'Abgeglichen werden danach nur die Kalender, die Sie anschließend auswählen, und zwar in beide Richtungen: Was Sie dort ändern oder löschen, '
      + 'ändert sich hier, und umgekehrt. Es öffnet sich Ihr Browser mit der Anmeldung bei Google; Kontovia kommt danach von selbst wieder nach vorn.',
    confirmLabel: 'Weiter zu Google',
  });
  if (!ja) return false;
  try {
    const res = await api.gcal.connect({ calendarIdHint: calendarSettings().calendarId, timeZone: timeZone(), weitere: true });
    await refreshCalendarStatus();
    if (!res.weitereErlaubt) {
      warn('Nicht freigegeben', 'Im Google-Dialog wurde der Zugriff auf die übrigen Kalender nicht erlaubt. Der Kalender „Kontovia“ wird weiter abgeglichen.');
      return false;
    }
    return true;
  } catch (e) {
    if (e.code !== 'ABGEBROCHEN') err('Freigabe fehlgeschlagen', e.message);
    return false;
  }
}

/** Auswahl der weiteren Kalender, die abgeglichen werden. */
export async function openKalenderAuswahl() {
  let liste;
  try {
    liste = await api.gcal.calendars();
  } catch (e) {
    err('Kalender nicht abrufbar', e.message);
    return false;
  }
  const bisher = new Set(calendarSettings().weitere.map((k) => k.id));
  const wahl = await new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Weitere Google-Kalender abgleichen',
      body: html`
        <p class="mt0 small" style="line-height:1.6">Die Termine der gewählten Kalender erscheinen in Kontovia,
        ab gut einem Jahr zurück. Ändern oder löschen Sie einen davon hier oder in Google, gilt das beim
        nächsten Abgleich auf beiden Seiten. Neue Termine können Sie in Kontovia direkt einem dieser Kalender
        zuordnen.</p>
        ${liste.length ? raw(liste.map((k) => `
          <label class="check mb8"><input type="checkbox" value="${esc(k.id)}" ${bisher.has(k.id) ? 'checked' : ''}>
          ${k.color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(k.color)}"></span>` : ''}
          ${esc(k.name)}${k.primary ? ' <span class="muted small">(Hauptkalender)</span>' : ''}</label>`).join(''))
          : raw('<p class="muted small">Es gibt keine weiteren Kalender, in die Kontovia schreiben darf.</p>')}`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const ids = [...m.root.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
      m.close();
      resolve(liste.filter((k) => ids.includes(k.id)).map((k) => ({ id: k.id, name: k.name })));
    });
  });
  if (!wahl) return false;

  // Abgewählte Kalender: ihre Termine verschwinden aus Kontovia – in Google bleiben sie.
  const weg = [...bisher].filter((id) => !wahl.some((k) => k.id === id));
  const betroffen = sel.appointments().filter((a) => a.extern && weg.includes(a.extern.calendarId));
  if (betroffen.length) {
    const entfernen = await confirmDialog({
      title: 'Termine abgewählter Kalender',
      text: `${int(betroffen.length)} Termine stammen aus Kalendern, die nicht mehr abgeglichen werden. Aus Kontovia entfernen? In Google bleiben sie unverändert.`,
      confirmLabel: 'Aus Kontovia entfernen', cancelLabel: 'Behalten',
    });
    if (entfernen) {
      await applyCalendarChanges({ removals: betroffen.map((a) => a.id), ohneGrabstein: true, summary: `Google Kalender: ${betroffen.length} Termine abgewählter Kalender entfernt` });
    }
  }
  await saveCalendarSettings({ weitere: wahl });
  ok('Auswahl gespeichert', wahl.length ? wahl.map((k) => k.name).join(', ') : 'Kein weiterer Kalender');
  const r = await syncCalendar({ reason: 'auswahl' }).catch((e) => { err('Kalenderabgleich fehlgeschlagen', e.message); return null; });
  if (r?.summary) ok('Kalender abgeglichen', r.summary);
  refresh();
  return true;
}

/** Dialog aus der Kalenderansicht heraus – dieselbe Karte, im Fenster. */
export function openCalendarSyncDialog() {
  const m = modal({
    title: 'Kalender abgleichen',
    size: 'wide',
    body: '<div id="calSyncBody"></div>',
    foot: '<button class="btn primary" data-x>Schließen</button>',
    onClose: () => refresh(),
  });
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  renderCalendarCard(m.root.querySelector('#calSyncBody'));
}

/* -------------------------------------------------------------------------- */
/* Verbinden, trennen, abgleichen                                              */
/* -------------------------------------------------------------------------- */

export async function manualSync() {
  try {
    const r = await syncCalendar({ reason: 'manuell' });
    if (r.skipped) warn('Kein Abgleich', r.skipped === 'nicht-verbunden' ? 'Google Kalender ist nicht verbunden.' : r.skipped);
    else ok('Kalender abgeglichen', r.summary);
    return r;
  } catch (e) {
    err('Kalenderabgleich fehlgeschlagen', e.message);
    return null;
  }
}

function connectDialog() {
  const cfg = calendarSettings();
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Mit Google Kalender verbinden',
      body: html`
        <p class="mt0" style="line-height:1.6">Kontovia legt in Ihrem Google-Konto einen eigenen Kalender
        <strong>„Kontovia“</strong> an und gleicht Ihre Termine in beide Richtungen damit ab. Auf Ihre
        übrigen Kalender greift Kontovia nur zu, wenn Sie das unten ankreuzen.</p>
        <div class="notice warn">
          <strong>Was dafür an Google geht:</strong> Titel, Datum, Uhrzeit, Ort und Wiederholung Ihrer
          Termine, auf Wunsch auch die Notiz. Das geschieht unverschlüsselt, sonst könnte Google die
          Termine nicht anzeigen. <strong>Nicht</strong> übertragen werden Beträge, Buchungen, Kontakte und Belege.
          Stehen Namen von Kunden im Titel, gibt Kontovia sie damit an Google weiter; für die
          geschäftliche Nutzung ist ein Google-Konto mit Auftragsverarbeitungsvertrag
          (Google Workspace) die saubere Lösung.
        </div>
        <div class="stack mt16" style="gap:6px">
          <label class="check"><input type="checkbox" id="g_events" ${cfg.includeEvents ? 'checked' : ''}> Veranstaltungstermine aus Anzahlungen mit übertragen (ohne Beträge)</label>
          <label class="check"><input type="checkbox" id="g_due" ${cfg.includeDue ? 'checked' : ''}> Fälligkeiten offener Rechnungen mit übertragen (ohne Beträge)</label>
          <label class="check"><input type="checkbox" id="g_notes" ${cfg.sendNotes ? 'checked' : ''}> Notizen der Termine mit übertragen</label>
          <label class="check"><input type="checkbox" id="g_andere"> Auch meine anderen Google-Kalender einbeziehen (z. B. den Hauptkalender), in beide Richtungen. Welche, wählen Sie danach</label>
        </div>
        <p class="small muted mt16 mb0" style="line-height:1.6">Es öffnet sich Ihr Browser mit der
        Anmeldung bei Google; danach kommt Kontovia von selbst wieder nach vorn. Erscheint dort der
        Hinweis „Google hat diese App nicht überprüft“, geht es über <em>Erweitert</em> und den Link
        darunter weiter. Die Verbindung lässt sich jederzeit unter Einstellungen → Kalender-Abgleich
        trennen.</p>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Mit Google verbinden</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const wahl = {
        includeEvents: m.root.querySelector('#g_events').checked,
        includeDue: m.root.querySelector('#g_due').checked,
        sendNotes: m.root.querySelector('#g_notes').checked,
        andere: m.root.querySelector('#g_andere').checked,
      };
      m.close();
      resolve(wahl);
    });
  });
}

export async function connectGoogle() {
  const wahl = await connectDialog();
  if (!wahl) return false;
  const hinweis = modal({
    title: 'Anmeldung bei Google',
    size: 'slim',
    body: `<p class="mt0" style="line-height:1.6">Bitte melden Sie sich im geöffneten Browserfenster an und
      erlauben Sie den Zugriff auf den Kalender. Dieses Fenster schließt sich danach von selbst.</p>
      <p class="small muted mb0">Nach fünf Minuten ohne Anmeldung bricht Kontovia den Versuch ab.</p>`,
    foot: '<button class="btn" data-stop>Abbrechen</button><button class="btn" data-x>Ausblenden</button>',
  });
  hinweis.root.querySelector('[data-x]').addEventListener('click', () => hinweis.close());
  // Wer das Browserfenster geschlossen hat, soll nicht fünf Minuten warten müssen.
  hinweis.root.querySelector('[data-stop]').addEventListener('click', () => {
    hinweis.close();
    api.cloud.signinCancel?.().catch(() => {});
  });
  const { andere, ...einstellungen } = wahl;
  try {
    const res = await api.gcal.connect({ calendarIdHint: calendarSettings().calendarId, timeZone: timeZone(), weitere: andere });
    await saveCalendarSettings({ ...einstellungen, calendarId: res.calendarId, account: res.email });
    hinweis.close();
    ok('Google Kalender verbunden', `${res.email} · Kalender „${res.calendarName}“${res.created ? ' angelegt' : ''}`);
    const r = await syncCalendar({ reason: 'erstverbindung' }).catch((e) => { err('Erster Abgleich fehlgeschlagen', e.message); return null; });
    if (r?.summary) ok('Kalender abgeglichen', r.summary);
    await startCalendarSync();
    if (andere && res.weitereErlaubt) await openKalenderAuswahl();
    else if (andere) warn('Weitere Kalender nicht freigegeben', 'Im Google-Dialog wurde der Zugriff auf die übrigen Kalender nicht erlaubt.');
    refresh();
    return true;
  } catch (e) {
    hinweis.close();
    if (e.code !== 'ABGEBROCHEN') err('Verbinden fehlgeschlagen', e.message);
    return false;
  }
}

function disconnectDialog() {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Google Kalender trennen?',
      size: 'slim',
      body: `<p class="mt0" style="line-height:1.6">Kontovia gleicht danach nicht mehr mit Google ab, und die
        Freigabe im Google-Konto wird zurückgezogen. Ihre Termine in Kontovia bleiben unverändert.
        Ist Google Kalender auch auf einem anderen Gerät verbunden, muss er dort danach neu verbunden
        werden.</p>
        <label class="check"><input type="checkbox" id="g_delete"> Auch den Kalender „Kontovia“ in Google löschen</label>
        <p class="tiny muted mt8 mb0">Nur ankreuzen, wenn kein anderes Gerät mehr mit diesem Kalender arbeitet.</p>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn danger" data-yes>Trennen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const loeschen = m.root.querySelector('#g_delete').checked;
      m.close();
      resolve({ loeschen });
    });
  });
}

export async function disconnectGoogle() {
  const wahl = await disconnectDialog();
  if (!wahl) return false;
  const loeschen = wahl.loeschen;
  try {
    stopCalendarSync();
    const res = await api.gcal.disconnect({ deleteCalendar: loeschen });
    if (res.deletedCalendar) await saveCalendarSettings({ calendarId: '' });
    calState.lastError = null;
    calState.lastSummary = '';
    await refreshCalendarStatus();
    ok('Google Kalender getrennt', res.deletedCalendar ? 'Der Kalender „Kontovia“ wurde in Google gelöscht.' : '');
    return true;
  } catch (e) {
    err('Trennen fehlgeschlagen', e.message);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Kalenderdateien                                                             */
/* -------------------------------------------------------------------------- */

export async function exportIcs() {
  const cfg = calendarSettings();
  const derived = derivedEntries(store.db, { events: cfg.includeEvents, due: cfg.includeDue });
  const text = toIcs(sel.appointments(), { derived, name: store.db.settings.companyName ? `Kontovia: ${store.db.settings.companyName}` : 'Kontovia' });
  try {
    const p = await api.file.save({
      defaultName: `Kontovia-Termine_${todayISO()}.ics`,
      filters: [{ name: 'Kalenderdatei', extensions: ['ics'] }],
      text,
    });
    if (p) ok('Kalenderdatei gespeichert', `${int(sel.appointments().length + derived.length)} Termine · ${p}`);
  } catch (e) {
    err('Export fehlgeschlagen', e.message);
  }
}

export async function importIcs() {
  let file;
  try {
    file = await api.file.pickImport([{ name: 'Kalenderdatei', extensions: ['ics'] }]);
  } catch (e) {
    err('Datei nicht lesbar', e.message);
    return false;
  }
  if (!file) return false;
  let text;
  try {
    const bin = atob(file.dataBase64);
    text = new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    err('Datei nicht lesbar', 'Die Datei ist keine gültige Kalenderdatei.');
    return false;
  }
  // Aus Buchungen erzeugte Einträge (Veranstaltung, Fälligkeit) kommen nicht als Termine zurück.
  const events = parseIcs(text).filter((e) => !/^kd[01][0-9a-f]+@kontovia$/.test(e.uid));
  if (!events.length) { warn('Keine Termine gefunden', 'Die Datei enthält keine Termine, die Kontovia übernehmen kann.'); return false; }

  const now = new Date().toISOString();
  const upserts = [];
  let neu = 0;
  let geaendert = 0;
  for (const e of events) {
    const id = appointmentIdForUid(e.uid);
    const alt = sel.appointment(id);
    const felder = {
      title: e.title, date: e.date, allDay: e.allDay, startTime: e.startTime, endTime: e.endTime,
      location: e.location, notes: e.notes, recurrence: e.recurrence,
    };
    if (alt) {
      const gleich = Object.entries(felder).every(([k, v]) => JSON.stringify(alt[k] ?? '') === JSON.stringify(v ?? ''));
      if (gleich) continue;
      upserts.push({ ...alt, ...felder, updatedAt: now });
      geaendert++;
    } else {
      upserts.push({
        id, ...felder, contactId: '', color: '', done: false, transactionIds: [],
        reminderMinutes: 0, createdAt: now, updatedAt: now,
      });
      neu++;
    }
  }
  if (!upserts.length) { ok('Nichts Neues', `Alle ${int(events.length)} Termine der Datei sind schon in Kontovia.`); return false; }
  const yes = await confirmDialog({
    title: 'Termine übernehmen?',
    text: `${file.name}: ${int(neu)} neue Termine${geaendert ? ` und ${int(geaendert)} geänderte` : ''} aus ${int(events.length)} Einträgen.`,
    confirmLabel: 'Übernehmen',
  });
  if (!yes) return false;
  await applyCalendarChanges({ upserts, summary: `Kalenderdatei ${file.name}: ${neu} neu, ${geaendert} geändert` });
  await saveNow();
  ok('Termine übernommen', `${int(neu)} neu, ${int(geaendert)} geändert`);
  refresh();
  return true;
}
