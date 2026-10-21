/**
 * Kontovia – Einstellungen → Kalender: eigene Kalender und Erinnerungen.
 *
 * Der Abgleich mit Google und Kalenderdateien hat seine eigene Karte
 * (calendarsync.js). Hier stehen die Dinge, die nur Kontovia betreffen: die
 * Liste der eigenen Kalender und ob Erinnerungen als Benachrichtigung des
 * Geräts kommen dürfen.
 */

import { html, raw, esc, int } from '../lib/util.js';
import { icon, ok, warn } from '../lib/ui.js';
import { sel } from '../lib/store.js';
import { lokaleKalender } from '../lib/kalender.js';
import { erinnerungenStatus, geraetEinschalten, erinnerungenSetzen, erinnerungenStarten } from '../lib/erinnerungen.js';

const kalender = () => import('./calendar.js');

/** Karte für Einstellungen → Daten & Cloud. */
export function renderKalenderKarte(el) {
  if (!el) return;
  const liste = lokaleKalender(sel.settings());
  const st = erinnerungenStatus();
  const anzahl = (id) => sel.appointments().filter((a) => !a.extern && (a.calendarId || '') === id).length;
  const erinnerungText = st.aus ? 'Erinnerungen sind ausgeschaltet.'
    : st.geraet ? 'Erinnerungen kommen als Benachrichtigung dieses Geräts und als Hinweis im Programm.'
      : st.gewuenscht && st.erlaubnis === 'denied' ? 'Der Browser erlaubt Kontovia keine Benachrichtigungen. Erinnerungen erscheinen als Hinweis im Programm. Die Erlaubnis lässt sich in den Einstellungen des Browsers für diese Seite wieder erteilen.'
        : 'Erinnerungen erscheinen als Hinweis im Programm, solange Kontovia geöffnet ist.';
  el.innerHTML = html`
    <div class="card">
      <div class="card-head"><h2>${icon('calendar', 16)} Kalender</h2><span class="sub">Eigene Kalender und Erinnerungen</span></div>
      <div class="card-body">
        <div class="grid c2">
          <div>
            <strong style="font-size:13px">Meine Kalender</strong>
            <div class="stack mt8" style="gap:4px">
              ${raw(liste.map((k) => `<div class="row" style="gap:8px"><span class="cal-dot" style="background:${esc(k.color || 'var(--accent)')}"></span><span style="flex:1">${esc(k.name)}</span><span class="tiny muted">${int(anzahl(k.id))} Termine</span></div>`).join(''))}
            </div>
            <p class="small muted" style="line-height:1.6">Mehrere Kalender trennen Berufliches und Privates, Standorte oder Personen. Im Kalender sehen Sie alle zusammen oder jeden einzeln.</p>
            <button class="btn" id="kalVerwalten">${icon('settings', 15)} Kalender verwalten</button>
          </div>
          <div>
            <strong style="font-size:13px">Erinnerungen</strong>
            <p class="small mt8" style="line-height:1.6">${erinnerungText}</p>
            <p class="tiny muted" style="line-height:1.6">Erinnerungen gibt es, solange Kontovia geöffnet und entsperrt ist, auch im Hintergrund. Bei geschlossenem Programm kann Kontovia nicht erinnern: Dafür bräuchte es einen Dienst im Netz, und den gibt es bewusst nicht. Wer das braucht, nimmt die Termine per Kalenderdatei in einen anderen Kalender mit; die Erinnerungen gehen mit. Zu Google Kalender gehen Erinnerungen nicht, dort stellen Sie sie selbst ein.</p>
            <div class="row wrap" style="gap:8px">
              ${!st.aus && !st.geraet && st.moeglich && st.erlaubnis !== 'denied' ? raw(`<button class="btn primary" id="erinGeraet">${icon('bolt', 15).__raw} Benachrichtigungen des Geräts erlauben</button>`) : ''}
              ${st.geraet ? raw(`<button class="btn" id="erinNurProgramm">Nur im Programm</button>`) : ''}
              ${!st.aus ? raw(`<button class="btn" id="erinAus">Ausschalten</button>`) : raw(`<button class="btn primary" id="erinAn">Einschalten</button>`)}
            </div>
            ${!st.moeglich && !st.aus ? raw('<p class="tiny muted mt8 mb0">Dieser Browser kennt keine Benachrichtigungen.</p>') : ''}
          </div>
        </div>
      </div>
    </div>`;
  const neu = () => renderKalenderKarte(el);
  el.querySelector('#kalVerwalten').addEventListener('click', async () => {
    const m = await kalender();
    await m.openKalenderVerwaltung();
    neu();
  });
  el.querySelector('#erinGeraet')?.addEventListener('click', async () => {
    const erlaubnis = await geraetEinschalten();
    if (erlaubnis === 'granted') { ok('Benachrichtigungen erlaubt', 'Erinnerungen kommen jetzt auch als Benachrichtigung dieses Geräts.'); erinnerungenStarten(); }
    else if (erlaubnis === 'denied') warn('Nicht erlaubt', 'Der Browser hat Benachrichtigungen für Kontovia abgelehnt. Erinnerungen erscheinen weiter im Programm.');
    neu();
  });
  el.querySelector('#erinNurProgramm')?.addEventListener('click', () => { erinnerungenSetzen(''); ok('Gespeichert', 'Erinnerungen erscheinen nur noch im Programm.'); neu(); });
  el.querySelector('#erinAus')?.addEventListener('click', () => { erinnerungenSetzen('aus'); ok('Erinnerungen ausgeschaltet'); neu(); });
  el.querySelector('#erinAn')?.addEventListener('click', () => { erinnerungenSetzen(''); erinnerungenStarten(); ok('Erinnerungen eingeschaltet'); neu(); });
}
