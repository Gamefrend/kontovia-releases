/**
 * Kontovia – Kalender mit Google und anderen Programmen abgleichen.
 *
 * Zwei Wege:
 *   Google Kalender  laufender Abgleich in beide Richtungen, mit dem
 *                    eigenen Kalender „Kontovia“ und auf Wunsch mit weiteren
 *                    Kalendern des Kontos (Hauptkalender usw.); mit dem
 *                    Konto geteilte Kalender werden nur angezeigt. In der
 *                    Web-Fassung gilt der Zugriff eine Stunde und wird dann
 *                    mit einem Tipp bestätigt (src/web/gcal.js).
 *   .ics-Datei       Export und Import von Hand, überall – auch für Apple
 *                    Kalender und Outlook
 */

import { html, raw, esc, int, fmtDateTime, todayISO } from '../lib/util.js';
import { icon, modal, confirmDialog, ok, err, warn } from '../lib/ui.js';
import { store, sel, commit, saveNow, applyCalendarChanges } from '../lib/store.js';
import { derivedEntries } from '../lib/gcal.js';
import { toIcs, parseIcs, appointmentIdForUid } from '../lib/ics.js';
import { kalenderListe, kalenderSchluessel, lokaleKalender, googleFarbe } from '../lib/kalender.js';
import {
  calState, syncCalendar, startCalendarSync, stopCalendarSync,
  refreshCalendarStatus, calendarSettings, saveCalendarSettings, timeZone, stillZuruecksetzen,
} from '../lib/gcalsync.js';
import { refresh } from '../lib/router.js';

const api = window.kontovia;

/* -------------------------------------------------------------------------- */
/* Kurzstatus für Kalenderansicht                                              */
/* -------------------------------------------------------------------------- */

export function statusText(st = calState.status) {
  if (calState.running) return 'Google: Abgleich läuft …';
  if (!st?.linked) return '';
  if (st.bestaetigen) return 'Google: bitte kurz bestätigen';
  if (calState.lastError || st.lastError) return 'Google: Fehler beim Abgleich';
  const at = calState.lastAt || st.lastSyncAt;
  return at ? `Google: abgeglichen ${fmtDateTime(at)}` : 'Google: verbunden';
}

/* -------------------------------------------------------------------------- */
/* Einstellungen                                                               */
/* -------------------------------------------------------------------------- */

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
      <div class="card-head"><h2 data-krone="kalender">${icon('calendar', 16)} Kalender-Abgleich</h2><span class="sub">Google Kalender und Kalenderdateien</span></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            ${st?.available === false ? raw(`
              <div class="notice">
                <strong>Google Kalender ist gerade nicht erreichbar.</strong> Termine lassen sich
                weiterhin als Kalenderdatei (.ics) übertragen.
              </div>`) : st?.linked ? raw(html`
              <div class="notice ok">
                <strong>Verbunden</strong> mit ${st.email || 'Ihrem Google-Konto'} · Kalender
                „${st.calendarName || 'Kontovia'}“<br>
                <span class="small">${calState.running ? 'Abgleich läuft …' : (st.lastSyncAt ? `Zuletzt abgeglichen ${fmtDateTime(st.lastSyncAt)}` : 'Noch nicht abgeglichen')}${calState.lastSummary ? ` · ${calState.lastSummary}` : ''}</span>
              </div>
              ${st.bestaetigen ? raw(`<div class="notice warn mt8">Der Abgleich wartet auf eine kurze Bestätigung
                bei Google. Im Browser gilt der Zugriff auf den Kalender jeweils eine Stunde; danach genügt ein
                Tipp, meist ohne erneute Anmeldung.</div>`) : ''}
              ${!st.bestaetigen && (st.lastError || calState.lastError) ? raw(`<div class="notice danger mt8">${esc(calState.lastError || st.lastError)}</div>`) : ''}
              <div class="row wrap mt16" style="gap:8px">
                <button class="btn primary" data-cal="sync" data-premium="kalender">${icon('refresh', 15)} ${st.bestaetigen ? 'Bestätigen und abgleichen' : 'Jetzt abgleichen'}</button>
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
              <button class="btn primary" data-cal="connect" data-premium="kalender">${icon('calendar', 15)} Mit Google Kalender verbinden</button>`)}
          </div>
          <div>
            <p class="small mt0" style="line-height:1.6"><strong>Kalenderdatei (.ics):</strong> für
            Apple Kalender, Outlook oder ein zweites Google-Konto. Der Export enthält
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
  el.querySelectorAll('[data-cal-loesen]').forEach((b) => b.addEventListener('click', async () => {
    await kalenderLoesen([b.dataset.calLoesen]);
    rerender();
  }));
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
      Auch Kalender, die andere mit Ihnen geteilt haben, lassen sich so anzeigen (nur lesend).
      Dafür braucht Kontovia einmal zusätzlich Ihre Freigabe bei Google.</p>
      ${namen.length ? `<div class="notice warn small mb8">Ausgewählt sind ${esc(namen.join(', '))}, auf diesem Gerät
        fehlt aber noch die Freigabe.</div>` : ''}
      <button class="btn" data-cal="weitere-freigeben" data-premium="kalender">${icon('calendar', 15).__raw} Weitere Kalender einbeziehen</button>`;
  }
  return `<hr class="sep">
    <strong style="font-size:13px">Weitere Google-Kalender</strong>
    <p class="small mt8 mb8" style="line-height:1.6">${namen.length
      ? 'Eigene Kalender werden in beide Richtungen abgeglichen, mit Ihnen geteilte, nur lesbare Kalender nur angezeigt. Termine ab gut einem Jahr zurück. „Lösen“ beendet den Abgleich eines Kalenders; dabei können Sie die von Kontovia dort angelegten Einträge mit löschen lassen, fremde Termine bleiben immer unberührt.'
      : 'Noch kein weiterer Kalender ausgewählt.'}</p>
    ${cfg.weitere.map((k) => `<div class="row mb8" style="gap:8px"><span style="flex:1;min-width:0" class="truncate"><span class="cal-dot" style="background:${esc(k.color || googleFarbe(k.id))}"></span> ${esc(k.name || k.id)}${k.readOnly ? ' <span class="badge tiny">nur lesen</span>' : ''}</span>
      <button class="btn sm" data-cal-loesen="${esc(k.id)}">Lösen</button></div>`).join('')}
    <label class="check mb8 mt8"><input type="checkbox" data-opt="autoGeteilt" ${cfg.autoGeteilt ? 'checked' : ''}> Neu mit mir geteilte Kalender automatisch anzeigen (nur lesend)</label>
    <button class="btn" data-cal="weitere-waehlen" data-premium="kalender">${icon('calendar', 15).__raw} Kalender auswählen</button>`;
}

/**
 * Kontovia von einem weiteren Google-Kalender lösen. Fragt, ob seine Termine
 * aus Kontovia verschwinden sollen und ob die von Kontovia dort angelegten
 * Einträge in Google gelöscht werden; fremde Termine in Google bleiben immer.
 * @param {string[]} ids  Kalender, die nicht mehr abgeglichen werden
 * @param {{speichern?:boolean}} o  speichern: die Auswahl selbst fortschreiben (sonst tut es der Aufrufer)
 * @returns {Promise<boolean>} false, wenn abgebrochen
 */
export async function kalenderLoesen(ids, { speichern = true } = {}) {
  const cfg = calendarSettings();
  const kalender = ids.map((id) => cfg.weitere.find((k) => k.id === id) || { id, name: id });
  const betroffen = sel.appointments().filter((a) => a.extern && ids.includes(a.extern.calendarId));
  // Von Kontovia angelegt: die Ereigniskennung ist aus der Terminkennung berechnet (kv…), nicht von Google vergeben.
  const eigene = betroffen.filter((a) => String(a.extern.eventId || '').startsWith('kv') && !a.id.startsWith('gcal_') && !a.id.startsWith('gx'));
  const namen = kalender.map((k) => k.name || k.id).join(', ');
  const wahl = await new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: ids.length > 1 ? 'Kalender lösen?' : `Kalender „${namen}“ lösen?`,
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Kontovia gleicht ${ids.length > 1 ? 'diese Kalender' : 'diesen Kalender'} danach nicht mehr ab. Fremde Termine in Google bleiben in jedem Fall unberührt.</p>
        <label class="check mb8"><input type="checkbox" id="l_lokal" ${betroffen.length ? 'checked' : 'disabled'}> ${int(betroffen.length)} Termine aus diesem Kalender aus Kontovia entfernen (in Google bleiben sie)</label>
        <label class="check mb8"><input type="checkbox" id="l_google" ${eigene.length ? '' : 'disabled'}> ${int(eigene.length)} von Kontovia dort angelegte Einträge in Google löschen</label>
        <p class="tiny muted mt8 mb0">Gelöscht werden in Google nur Einträge, die Kontovia selbst angelegt hat. Was Sie oder andere dort eingetragen haben, bleibt.</p>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn danger" data-yes>Lösen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const r = { lokal: m.root.querySelector('#l_lokal').checked, google: m.root.querySelector('#l_google').checked };
      m.close();
      resolve(r);
    });
  });
  if (!wahl) return false;
  let geloescht = 0;
  if (wahl.google && eigene.length) {
    if (calState.status?.bestaetigen && !await bestaetigen()) { warn('Nicht gelöscht', 'Ohne Bestätigung bei Google bleiben die Einträge dort stehen.'); }
    else {
      try {
        const ops = eigene.map((a) => ({ kind: 'delete', calendarId: a.extern.calendarId, eventId: a.extern.eventId, apptId: a.id }));
        const res = await api.gcal.push(ops);
        geloescht = res.filter((r) => r?.ok).length;
        const fehler = res.find((r) => r && !r.ok);
        if (fehler) warn('Nicht alles gelöscht', `${int(res.length - geloescht)} Einträge blieben in Google: ${fehler.error || ''}`);
      } catch (e) {
        err('Löschen in Google fehlgeschlagen', e.message);
      }
    }
  }
  if (wahl.lokal && betroffen.length) {
    await applyCalendarChanges({ removals: betroffen.map((a) => a.id), ohneGrabstein: true, summary: `Google Kalender: ${betroffen.length} Termine gelöster Kalender entfernt` });
  }
  if (speichern) await saveCalendarSettings({ weitere: cfg.weitere.filter((k) => !ids.includes(k.id)) });
  ok('Kalender gelöst', [namen, wahl.lokal && betroffen.length ? `${int(betroffen.length)} Termine aus Kontovia entfernt` : '', geloescht ? `${int(geloescht)} Einträge in Google gelöscht` : ''].filter(Boolean).join(' · '));
  refresh();
  return true;
}

/**
 * Der Browser hat das kleine Fenster von Google blockiert. Statt zu scheitern
 * bietet Kontovia an, für einen Moment ganz zu Google zu wechseln.
 */
async function umleitenFragen(e) {
  if (e?.code !== 'FENSTER_BLOCKIERT') return false;
  return confirmDialog({
    title: 'Fenster blockiert',
    text: 'Ihr Browser hat das kleine Fenster von Google blockiert. Kontovia kann stattdessen für einen Moment '
      + 'zu Google wechseln und danach hierher zurückkehren. Sie entsperren Kontovia dann mit Ihrem Passwort, '
      + 'und es geht dort weiter, wo Sie waren. Möchten Sie das?',
    confirmLabel: 'Zu Google wechseln',
  });
}

/** Holt die zusätzliche Freigabe für weitere Kalender – ein neuer Gang zu Google. */
async function freigebenWeitere(umleiten = false) {
  const ja = await confirmDialog({
    title: 'Weitere Kalender einbeziehen?',
    text: 'Kontovia fragt bei Google zusätzlich das Recht an, Ihre Kalender aufzulisten und Termine darin zu lesen und zu ändern. '
      + 'Abgeglichen werden danach nur die Kalender, die Sie anschließend auswählen. Eigene Kalender laufen in beide Richtungen: Was Sie dort ändern oder löschen, '
      + 'ändert sich hier, und umgekehrt. Mit Ihnen geteilte Kalender zeigt Kontovia nur an. Es öffnet sich die Anmeldung bei Google; danach geht es hier weiter.',
    confirmLabel: 'Weiter zu Google',
  });
  if (!ja) return false;
  try {
    const res = await api.gcal.connect({ calendarIdHint: calendarSettings().calendarId, timeZone: timeZone(), weitere: true, merk: { nurFreigabe: true, andere: true }, umleiten });
    await refreshCalendarStatus();
    if (!res.weitereErlaubt) {
      warn('Nicht freigegeben', 'Im Google-Dialog wurde der Zugriff auf die übrigen Kalender nicht erlaubt. Der Kalender „Kontovia“ wird weiter abgeglichen.');
      return false;
    }
    return true;
  } catch (e) {
    if (await umleitenFragen(e)) return freigebenWeitere(true);
    if (e.code !== 'ABGEBROCHEN') err('Freigabe fehlgeschlagen', e.message);
    return false;
  }
}

/** Auswahl der weiteren Kalender, die abgeglichen werden. */
export async function openKalenderAuswahl() {
  if (calState.status?.bestaetigen && !await bestaetigen()) return false;
  let liste;
  try {
    liste = await api.gcal.calendars();
  } catch (e) {
    err('Kalender nicht abrufbar', e.message);
    return false;
  }
  const cfg = calendarSettings();
  const bisher = new Set(cfg.weitere.map((k) => k.id));
  const frueher = new Map(cfg.weitere.map((k) => [k.id, k]));
  const abgewaehltVorher = new Set(cfg.abgewaehlt);
  // Mit mir geteilte, nur lesbare Kalender sind vorgewählt, solange man sie nicht schon einmal abgewählt hat.
  const vorgewaehlt = (k) => bisher.has(k.id) || (k.geteilt && k.readOnly && !k.sonder && k.angezeigt && !abgewaehltVorher.has(k.id));
  const gruppen = [
    ['Meine Kalender', liste.filter((k) => !k.geteilt && !k.sonder)],
    ['Mit mir geteilt', liste.filter((k) => k.geteilt && !k.sonder)],
    ['Von Google (Feiertage, Geburtstage …)', liste.filter((k) => k.sonder)],
  ].filter(([, l]) => l.length);
  const zeile = (k) => `
    <label class="check cal-wahl">
      <input type="checkbox" value="${esc(k.id)}" ${vorgewaehlt(k) ? 'checked' : ''}>
      <span class="cal-dot" style="background:${esc(k.color || googleFarbe(k.id))}"></span>
      <span class="cal-wahl-name">${esc(k.name)}${k.primary ? ' <span class="muted small">(Hauptkalender)</span>' : ''}</span>
      ${k.readOnly ? '<span class="badge tiny">nur lesen</span>' : k.geteilt ? '<span class="badge tiny">geteilt</span>' : ''}
    </label>`;
  const wahl = await new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Weitere Google-Kalender abgleichen',
      body: html`
        <p class="mt0 small" style="line-height:1.6">Die Termine der gewählten Kalender erscheinen in Kontovia,
        ab gut einem Jahr zurück. Eigene Kalender gleicht Kontovia in beide Richtungen ab: Ändern oder löschen Sie einen
        Termin hier oder in Google, gilt das beim nächsten Abgleich auf beiden Seiten. Mit Ihnen geteilte, nur lesbare
        Kalender zeigt Kontovia nur an und schreibt nie hinein. Wer einen solchen Termin hier löscht, blendet ihn
        nur in Kontovia aus.</p>
        ${liste.length ? raw(gruppen.map(([titel, l]) => `
          <div class="cal-wahl-gruppe"><h3 class="cal-wahl-titel">${esc(titel)}</h3>${l.map(zeile).join('')}</div>`).join('')
          + `<hr class="sep"><label class="check"><input type="checkbox" id="k_auto" ${cfg.autoGesetzt && !cfg.autoGeteilt ? '' : 'checked'}>
          Neu mit mir geteilte Kalender automatisch anzeigen (nur lesend)</label>`)
          : raw('<p class="muted small">Es gibt keine weiteren Kalender, die Kontovia lesen darf.</p>')}`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const ids = new Set([...m.root.querySelectorAll('input[type=checkbox][value]:checked')].map((c) => c.value));
      const auto = !!m.root.querySelector('#k_auto')?.checked;
      m.close();
      const gewaehlt = liste.filter((k) => ids.has(k.id)).map((k) => ({
        id: k.id, name: k.name, color: k.color || '',
        // Ein einmal nur lesend geführter Kalender bleibt es, auch wenn Google inzwischen mehr erlaubt.
        ...(k.readOnly || frueher.get(k.id)?.readOnly ? { readOnly: true } : {}),
      }));
      // Was man sieht und abwählt, soll die Automatik nicht wieder hereinholen.
      const abgewaehlt = [...new Set([...cfg.abgewaehlt.filter((id) => !ids.has(id)), ...liste.filter((k) => !ids.has(k.id)).map((k) => k.id)])];
      resolve({ weitere: gewaehlt, autoGeteilt: auto, abgewaehlt });
    });
  });
  if (!wahl) return false;

  // Abgewählte Kalender: Kontovia löst sich davon, auf Wunsch samt seinen Einträgen dort.
  const weg = [...bisher].filter((id) => !wahl.weitere.some((k) => k.id === id));
  if (weg.length && !await kalenderLoesen(weg, { speichern: false })) return false;
  await saveCalendarSettings(wahl);
  ok('Auswahl gespeichert', wahl.weitere.length ? wahl.weitere.map((k) => k.name).join(', ') : 'Kein weiterer Kalender');
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

/**
 * Web-Fassung: neuer Zugriff für eine Stunde. Muss direkt aus einem Tipp
 * kommen, sonst blockiert der Browser das Fenster von Google.
 */
export async function bestaetigen(umleiten = false) {
  try {
    await api.gcal.bestaetigen({ umleiten });
    stillZuruecksetzen();
    await refreshCalendarStatus();
    return true;
  } catch (e) {
    if (await umleitenFragen(e)) return bestaetigen(true);
    if (e.code !== 'ABGEBROCHEN') err('Bestätigung bei Google fehlgeschlagen', e.message);
    return false;
  }
}

export async function manualSync() {
  try {
    if (calState.status?.bestaetigen && !await bestaetigen()) return null;
    const r = await syncCalendar({ reason: 'manuell' });
    if (r.skipped) {
      warn('Kein Abgleich', r.skipped === 'nicht-verbunden' ? 'Google Kalender ist nicht verbunden.'
        : r.skipped === 'bestaetigen' ? 'Der Abgleich wartet auf eine kurze Bestätigung bei Google.' : r.skipped);
    }
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
          <label class="check"><input type="checkbox" id="g_andere"> Auch meine anderen Google-Kalender einbeziehen, etwa den Hauptkalender (in beide Richtungen) und mit mir geteilte Kalender (nur lesend). Welche, wählen Sie danach</label>
        </div>
        <p class="small muted mt16 mb0" style="line-height:1.6">Es öffnet sich die Anmeldung bei Google,
        meist in einem kleinen Fenster; auf manchen Telefonen wechselt dafür die ganze Seite, und Sie
        entsperren Kontovia danach mit Ihrem Passwort. Dann geht es hier weiter. Erscheint dort der
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
  return verbindenMit(wahl);
}

/**
 * Nach einer Weiterleitung zu Google (Web-Fassung, wo ein zweites Fenster nicht
 * geht): Seite und Tresor sind neu geladen, die Antwort von Google liegt bereit.
 * Läuft nach dem Entsperren, vor dem Start des Abgleichs.
 */
export async function nachWeiterleitung(rm) {
  if (!rm) return;
  const bestaetigung = rm.zweck === 'bestaetigen';
  if (rm.fehler) {
    if (rm.abgebrochen) {
      warn('Bei Google abgebrochen', bestaetigung ? 'Der Kalenderabgleich wartet weiter auf Ihre Bestätigung.' : 'Google Kalender wurde nicht verbunden.');
    } else {
      err(bestaetigung ? 'Bestätigung bei Google fehlgeschlagen' : 'Verbinden fehlgeschlagen', rm.fehler);
    }
    return;
  }
  if (bestaetigung) {
    await refreshCalendarStatus();
    ok('Bei Google bestätigt', 'Der Kalenderabgleich läuft weiter.');
    return;
  }
  await verbindenMit(rm.merk || {}, { zurueck: true });
}

/**
 * Verbinden, nachdem im Dialog gewählt wurde. `zurueck`: Der Gang zu Google ist
 * schon geschehen (Weiterleitung), connect() nimmt die gemerkte Antwort.
 */
async function verbindenMit(wahl, { zurueck = false, umleiten = false } = {}) {
  const hinweis = zurueck || umleiten ? null : modal({
    title: 'Anmeldung bei Google',
    size: 'slim',
    body: `<p class="mt0" style="line-height:1.6">Bitte melden Sie sich bei Google an und
      erlauben Sie den Zugriff auf den Kalender. Dieser Hinweis schließt sich danach von selbst.</p>
      <p class="small muted mb0">Nach fünf Minuten ohne Anmeldung bricht Kontovia den Versuch ab.</p>`,
    foot: '<button class="btn" data-stop>Abbrechen</button><button class="btn" data-x>Ausblenden</button>',
  });
  hinweis?.root.querySelector('[data-x]').addEventListener('click', () => hinweis.close());
  // Wer das Browserfenster geschlossen hat, soll nicht fünf Minuten warten müssen.
  hinweis?.root.querySelector('[data-stop]').addEventListener('click', () => {
    hinweis.close();
    api.gcal.cancel().catch(() => {});
  });
  const { andere, nurFreigabe, ...einstellungen } = wahl;
  try {
    const res = await api.gcal.connect({ calendarIdHint: calendarSettings().calendarId, timeZone: timeZone(), weitere: andere, merk: wahl, umleiten });
    // Nur die Freigabe für weitere Kalender nachgeholt: die Einstellungen bleiben, wie sie sind.
    if (nurFreigabe) {
      await refreshCalendarStatus();
      if (res.weitereErlaubt) await openKalenderAuswahl();
      else warn('Nicht freigegeben', 'Im Google-Dialog wurde der Zugriff auf die übrigen Kalender nicht erlaubt. Der Kalender „Kontovia“ wird weiter abgeglichen.');
      refresh();
      return true;
    }
    await saveCalendarSettings({ ...einstellungen, calendarId: res.calendarId, account: res.email });
    hinweis?.close();
    ok('Google Kalender verbunden', `${res.email} · Kalender „${res.calendarName}“${res.created ? ' angelegt' : ''}`);
    const r = await syncCalendar({ reason: 'erstverbindung' }).catch((e) => { err('Erster Abgleich fehlgeschlagen', e.message); return null; });
    if (r?.summary) ok('Kalender abgeglichen', r.summary);
    await startCalendarSync();
    if (andere && res.weitereErlaubt) await openKalenderAuswahl();
    else if (andere) warn('Weitere Kalender nicht freigegeben', 'Im Google-Dialog wurde der Zugriff auf die übrigen Kalender nicht erlaubt.');
    refresh();
    return true;
  } catch (e) {
    hinweis?.close();
    if (await umleitenFragen(e)) return verbindenMit(wahl, { umleiten: true });
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
  // Web-Fassung: Für das Zurückziehen der Freigabe (und das Löschen des
  // Kalenders) braucht es einen gültigen Zugriff. Ohne ihn wird nur hier getrennt.
  if (calState.status?.bestaetigen) await api.gcal.bestaetigen?.().catch(() => {});
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

/** Welche Kalender in die Datei sollen; bei nur einem Kalender ohne Rückfrage. */
function exportAuswahl() {
  const cfg = calendarSettings();
  const kal = kalenderListe({ settings: sel.settings(), weitere: cfg.weitere, appointments: sel.appointments() });
  if (kal.length < 2) return Promise.resolve({ keys: kal.map((k) => k.key), mitBuchungen: true });
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Welche Kalender exportieren?',
      size: 'slim',
      body: html`
        <p class="mt0 small" style="line-height:1.6">Alle gewählten Kalender kommen in eine Datei. Für je eine Datei pro Kalender wiederholen Sie den Export.</p>
        ${raw(kal.map((k) => `<label class="check mb8"><input type="checkbox" value="${esc(k.key)}" checked> <span class="cal-dot" style="background:${esc(k.color || 'var(--accent)')}"></span> ${esc(k.name)}${k.art === 'google' ? ' <span class="tiny muted">Google</span>' : ''} <span class="tiny muted">(${int(k.anzahl)})</span></label>`).join(''))}
        <hr class="sep">
        <label class="check"><input type="checkbox" id="x_buchungen" checked> Veranstaltungen und Fälligkeiten aus Buchungen mitnehmen</label>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Exportieren</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => {
      settled = true;
      const keys = [...m.root.querySelectorAll('input[type=checkbox][value]:checked')].map((c) => c.value);
      const mitBuchungen = m.root.querySelector('#x_buchungen').checked;
      m.close();
      resolve({ keys, mitBuchungen, kal });
    });
  });
}

export async function exportIcs() {
  const wahl = await exportAuswahl();
  if (!wahl) return;
  const cfg = calendarSettings();
  const keys = new Set(wahl.keys);
  const termine = sel.appointments().filter((a) => keys.has(kalenderSchluessel(a)));
  const derived = wahl.mitBuchungen ? derivedEntries(store.db, { events: cfg.includeEvents, due: cfg.includeDue }) : [];
  const einer = wahl.keys.length === 1 ? (wahl.kal || kalenderListe({ settings: sel.settings(), weitere: cfg.weitere })).find((k) => k.key === wahl.keys[0]) : null;
  const firma = store.db.settings.companyName ? `Kontovia: ${store.db.settings.companyName}` : 'Kontovia';
  const text = toIcs(termine, { derived, name: einer ? `${firma} · ${einer.name}` : firma, color: einer?.color || '' });
  try {
    const p = await api.file.save({
      defaultName: `Kontovia-Termine${einer ? '_' + einer.name.replace(/[^\wäöüÄÖÜß-]+/g, '_') : ''}_${todayISO()}.ics`,
      filters: [{ name: 'Kalenderdatei', extensions: ['ics'] }],
      text,
    });
    if (p) ok('Kalenderdatei gespeichert', `${int(termine.length + derived.length)} Termine · ${p}`);
  } catch (e) {
    err('Export fehlgeschlagen', e.message);
  }
}

/** @param {{name:string, dataBase64:string}|null} gewaehlt  schon gewählte Datei (Daten übernehmen), sonst fragt ein Dialog. */
export async function importIcs(gewaehlt = null) {
  let file = gewaehlt;
  try {
    file ??= await api.file.pickImport([{ name: 'Kalenderdatei', extensions: ['ics'] }]);
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
      title: e.title, date: e.date, endDate: e.endDate || '', allDay: e.allDay, startTime: e.startTime, endTime: e.endTime,
      location: e.location, notes: e.notes, recurrence: e.recurrence, tags: e.tags || [], reminderMinutes: e.reminderMinutes || 0,
    };
    if (alt) {
      const gleich = Object.entries(felder).every(([k, v]) => JSON.stringify(alt[k] ?? (Array.isArray(v) ? [] : typeof v === 'number' ? 0 : '')) === JSON.stringify(v ?? ''));
      if (gleich) continue;
      upserts.push({ ...alt, ...felder, updatedAt: now });
      geaendert++;
    } else {
      upserts.push({
        id, ...felder, contactId: '', color: '', calendarId: '', done: false, transactionIds: [],
        createdAt: now, updatedAt: now,
      });
      neu++;
    }
  }
  if (!upserts.length) { ok('Nichts Neues', `Alle ${int(events.length)} Termine der Datei sind schon in Kontovia.`); return false; }
  const lokale = lokaleKalender(sel.settings());
  const ziel = await new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title: 'Termine übernehmen?',
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">${file.name}: ${int(neu)} neue Termine${geaendert ? ` und ${int(geaendert)} geänderte` : ''} aus ${int(events.length)} Einträgen.</p>
        ${lokale.length > 1 && neu ? raw(`<div class="field"><label>Neue Termine in den Kalender</label><select id="i_kalender">${lokale.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select></div>`) : ''}`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>Übernehmen</button>',
      onClose: () => { if (!settled) resolve(null); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => { settled = true; const k = m.root.querySelector('#i_kalender')?.value || ''; m.close(); resolve(k); });
  });
  if (ziel === null) return false;
  for (const u of upserts) if (!sel.appointment(u.id)) u.calendarId = ziel;
  await applyCalendarChanges({ upserts, summary: `Kalenderdatei ${file.name}: ${neu} neu, ${geaendert} geändert` });
  await saveNow();
  ok('Termine übernommen', `${int(neu)} neu, ${int(geaendert)} geändert`);
  refresh();
  return true;
}
