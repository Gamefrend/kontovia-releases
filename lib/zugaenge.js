/**
 * Kontovia – Anmelden, Abmelden und die Wege, den Tresor zu öffnen.
 *
 * Sperren schließt nur den Tresor; Abmelden räumt dieses Gerät auf, damit
 * man sich hier mit einem anderen Konto anmelden oder neu anfangen kann.
 * Die Wege zum Entsperren (Passwort, Fingerabdruck oder Gesicht, Google-Konto)
 * stehen gleichberechtigt nebeneinander: Jeder öffnet denselben Tresor.
 * Die Technik dahinter steht in src/web/entsperrung.js.
 */

import { html, raw, esc, $, fmtDateTime } from './util.js';
import { icon, modal, ok, err } from './ui.js';
import { store, saveNow } from './store.js';
import { syncNow } from './sync.js';
import { navigate } from './router.js';

const api = window.kontovia;

const BESTAETIGUNG = 'ABMELDEN';

/**
 * Fragt nach und meldet dieses Gerät ab: Buchhaltung, Belege, Sicherungen und
 * alle Zugänge werden hier entfernt. Ist der Tresor offen und mit Google
 * verbunden, wird vorher abgeglichen; klappt das nicht, bleibt alles stehen.
 * @param {{gesperrt?:boolean}} opts  vom Sperrbildschirm aus: ohne Abgleich
 * @returns {Promise<boolean>} wurde abgemeldet?
 */
export async function abmelden({ gesperrt = false } = {}) {
  let st = {};
  if (!gesperrt) st = await api.cloud.status().catch(() => ({}));
  const verbunden = !gesperrt && !!st.linked;

  const hinweis = verbunden
    ? `<div class="notice mb16">Ihre Buchhaltung liegt verschlüsselt in Ihrem Google-Konto${st.email ? ` (${esc(st.email)})` : ''}${st.lastSyncAt ? `, zuletzt abgeglichen ${esc(fmtDateTime(st.lastSyncAt))}` : ''}.
        Vor dem Abmelden gleicht Kontovia noch einmal ab. Danach können Sie sie hier oder auf einem anderen Gerät wieder laden.</div>`
    : gesperrt
      ? `<div class="notice warn mb16">Kontovia ist gesperrt und kann nicht mehr abgleichen. Was Sie seit dem letzten Abgleich geändert haben, geht verloren.
          Liegt Ihre Buchhaltung nicht in der Cloud und haben Sie keine Vollsicherung, ist sie nach dem Abmelden unwiederbringlich weg.</div>`
      : `<div class="notice warn mb16"><strong>Ihre Buchhaltung liegt nur auf diesem Gerät.</strong> Nach dem Abmelden ist sie weg, wenn Sie keine Vollsicherung
          oder Cloud-Sicherung haben. <a href="#" data-zu-sicherung>Zur Sicherung</a></div>`;
  const brauchtBestaetigung = !verbunden;

  const ja = await new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: 'Von diesem Gerät abmelden?',
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Kontovia entfernt Ihre Buchhaltung, die Belege und alle Zugänge (Fingerabdruck, Google-Verbindung)
        von diesem Gerät. Danach können Sie sich hier mit einem anderen Konto anmelden oder neu anfangen.</p>
        ${raw(hinweis)}
        ${raw(brauchtBestaetigung ? `<div class="field mb0"><label for="abmBest">Zur Bestätigung ${esc(BESTAETIGUNG)} eintippen</label>
          <input id="abmBest" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>` : '')}`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn danger" data-ja>Abmelden</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    const knopf = m.root.querySelector('[data-ja]');
    const feld = m.root.querySelector('#abmBest');
    const pruefen = () => { knopf.disabled = brauchtBestaetigung && String(feld.value).trim().toUpperCase() !== BESTAETIGUNG; };
    pruefen();
    feld?.addEventListener('input', pruefen);
    m.root.querySelector('[data-zu-sicherung]')?.addEventListener('click', (e) => {
      e.preventDefault();
      fertig = true;
      m.close();
      resolve(false);
      navigate('settings', { abschnitt: 'speicher' });
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(false); });
    knopf.addEventListener('click', () => { fertig = true; m.close(); resolve(true); });
    setTimeout(() => (feld || m.root.querySelector('[data-nein]')).focus(), 40);
  });
  if (!ja) return false;

  try {
    if (!gesperrt) {
      if (store.dirty) await saveNow();
      if (verbunden) await syncNow({ reason: 'abmelden' });
    }
  } catch (e) {
    err('Nicht abgemeldet', `Der Abgleich mit der Cloud hat nicht geklappt: ${e.message} Ihre Buchhaltung ist unverändert geblieben.`);
    return false;
  }
  try {
    await api.app.abmelden();
  } catch (e) {
    err('Abmelden nicht möglich', e.message);
    return false;
  }
  // Neu laden: Der Start zeigt die Einrichtung, in der man ein anderes Konto wählen kann.
  location.reload();
  return true;
}

/* -------------------------------------------------------------------------- */
/* Entsperr-Bildschirm                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Die Knöpfe für Fingerabdruck/Gesicht und Google unter dem Passwortfeld.
 * Zeichnet sich selbst; `eintreten` bekommt den geöffneten Bestand.
 */
export async function entsperrWege(host, { eintreten, melde }) {
  let s;
  try { s = await api.entsperrung.status(); } catch { return; }
  const bio = s.biometrie?.eingerichtet && s.biometrie.moeglich;
  const google = s.google?.moeglich;
  if (!bio && !google) return;
  host.innerHTML = `<div class="entsperr-oder"><span>oder</span></div>
    <div class="stack" style="gap:8px">
      ${bio ? `<button type="button" class="btn lg block" id="entBio">${icon('fingerprint', 18).__raw} Mit Fingerabdruck oder Gesicht entsperren</button>` : ''}
      ${google ? `<button type="button" class="btn ${bio ? '' : 'lg'} block" id="entGoogle">${icon('key', 16).__raw} Mit Google entsperren</button>` : ''}
    </div>
    ${google ? '<p class="tiny muted mt8 mb0" style="text-align:center">Das geht, wenn Sie es in den Einstellungen unter Sicherheit eingeschaltet haben.</p>' : ''}`;
  const sperren = (an) => host.querySelectorAll('button').forEach((b) => { b.disabled = an; });
  $('#entBio', host)?.addEventListener('click', async () => {
    sperren(true);
    melde('');
    try {
      eintreten(await api.entsperrung.biometrieEntsperren());
    } catch (e) {
      sperren(false);
      if (e.code !== 'ABGEBROCHEN') melde(e.message);
    }
  });
  $('#entGoogle', host)?.addEventListener('click', async () => {
    sperren(true);
    melde('');
    try {
      // Verlässt die Seite; weiter geht es nach der Rückkehr im Start (app.js).
      await api.entsperrung.googleEntsperren();
    } catch (e) {
      sperren(false);
      melde(e.message);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Einstellungen → Sicherheit                                                  */
/* -------------------------------------------------------------------------- */

/** Der Abschnitt „Weitere Wege zum Entsperren“ für die Einstellungen. */
export function zugaengeKarte(host) {
  async function zeichnen() {
    let s;
    try { s = await api.entsperrung.status(); } catch (e) { host.innerHTML = ''; return; }
    const bio = s.biometrie || {};
    const g = s.google || {};
    const bioText = !bio.moeglich ? 'Dieser Browser kann das nicht.'
      : bio.eingerichtet ? 'Eingerichtet. Auf dem Sperrbildschirm erscheint ein Knopf dafür.'
        : bio.geraet === false ? 'Auf diesem Gerät ist keine Bildschirmsperre mit Fingerabdruck oder Gesicht eingerichtet.'
          : 'Öffnet Kontovia nach einer Bestätigung mit Fingerabdruck oder Gesicht. Gilt nur für dieses Gerät.';
    host.innerHTML = `
      <div class="card-head"><h3>${icon('fingerprint', 16).__raw} Weitere Wege zum Entsperren</h3><span class="sub">Ihr Passwort bleibt immer gültig</span></div>
      <div class="card-body">
        <div class="zugang-zeile">
          <div><strong>Fingerabdruck oder Gesicht</strong><div class="small muted">${esc(bioText)}</div></div>
          ${bio.moeglich ? `<button class="btn ${bio.eingerichtet ? 'ghost' : ''}" id="zgBio">${bio.eingerichtet ? 'Ausschalten' : 'Einschalten'}</button>` : ''}
        </div>
        <div class="zugang-zeile">
          <div><strong>Google-Konto</strong>
            <div class="small muted">${!g.moeglich ? 'In dieser Fassung nicht eingerichtet.'
    : g.eingerichtet ? `Eingeschaltet${g.email ? ` für ${esc(g.email)}` : ''}. Wer sich mit diesem Google-Konto anmeldet, kann Kontovia ohne Passwort öffnen, auf jedem Gerät.`
      : g.verbunden === false ? 'Verbinden Sie zuerst Kontovia mit Ihrem Google-Konto (Einstellungen, Cloud).'
        : 'Anmelden mit Google öffnet Kontovia ohne Passwort, auf jedem Gerät.'}</div>
            ${g.moeglich && !g.eingerichtet && g.verbunden !== false ? `<div class="small mt8" style="color:var(--warn-text, inherit)">
              Bedenken Sie: Dafür liegt der Schlüssel zu Ihrer Buchhaltung in Ihrem Google-Konto. Wer Ihr Google-Konto übernimmt, kommt auch an die Buchhaltung.
              Ohne diese Option hat nur Ihr Passwort den Schlüssel.</div>` : ''}</div>
          ${g.moeglich && g.verbunden !== false ? `<button class="btn ${g.eingerichtet ? 'ghost' : ''}" id="zgGoogle">${g.eingerichtet ? 'Ausschalten' : 'Einschalten'}</button>` : ''}
        </div>
      </div>`;
    $('#zgBio', host)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        if (bio.eingerichtet) { await api.entsperrung.biometrieEntfernen(); ok('Ausgeschaltet', 'Auf diesem Gerät entsperren Sie wieder nur mit dem Passwort.'); }
        else { await api.entsperrung.biometrieEinrichten(); ok('Eingeschaltet', 'Beim nächsten Sperren können Sie mit Fingerabdruck oder Gesicht entsperren.'); }
      } catch (ex) { if (ex.code !== 'ABGEBROCHEN') err('Nicht geklappt', ex.message); }
      zeichnen();
    });
    $('#zgGoogle', host)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        if (g.eingerichtet) { await api.entsperrung.googleEntfernen(); ok('Ausgeschaltet', 'Mit Google lässt sich Kontovia nicht mehr ohne Passwort öffnen.'); }
        else { await api.entsperrung.googleEinrichten(); ok('Eingeschaltet', 'Sie können Kontovia jetzt mit Ihrem Google-Konto entsperren.'); }
      } catch (ex) { err('Nicht geklappt', ex.message); }
      zeichnen();
    });
  }
  zeichnen();
}
