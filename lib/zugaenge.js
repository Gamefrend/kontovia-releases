/**
 * Kontovia – Konten, Abmelden und die Wege, den Tresor zu öffnen.
 *
 * Auf einem Gerät können mehrere Konten (Buchhaltungen) angemeldet sein. Man
 * wechselt zwischen ihnen mit zwei Klicks; vorher gleicht Kontovia ab, sofern
 * das Konto mit Google verbunden ist. Jedes Konto bleibt dabei verschlüsselt
 * und getrennt von den anderen (src/web/konten.js).
 *
 * Sperren schließt nur den Tresor. Abmelden entfernt das Konto von diesem
 * Gerät, nachdem Kontovia abgeglichen hat. Ohne Abgleich lässt es sich nur
 * mit ausdrücklicher Bestätigung abmelden.
 * Die Wege zum Entsperren (Passwort, Fingerabdruck oder Gesicht, Google-Konto)
 * stehen gleichberechtigt nebeneinander: Jeder öffnet denselben Tresor.
 * Die Technik dahinter steht in src/web/entsperrung.js.
 */

import { html, raw, esc, $, fmtDateTime } from './util.js';
import { icon, modal, ok, err } from './ui.js';
import { store, saveNow } from './store.js';
import { syncNow, syncState } from './sync.js';
import { navigate } from './router.js';
import { openPopover } from './popover.js';

const api = window.kontovia;

/** Wie ein Konto in Listen heißt: Name des Betriebs, sonst die Google-Adresse. */
export const kontoName = (k) => k?.alias || k?.name || k?.email || 'Buchhaltung';

/** Für Merker auf dem Gerät, die zu einem Konto gehören (kontovia.<Name>.<Konto>). */
export const kontoSchluessel = (name, konto) => `kontovia.${name}.${konto || 'haupt'}`;

/* -------------------------------------------------------------------------- */
/* Abgleichen, bevor ein Konto verlassen wird                                  */
/* -------------------------------------------------------------------------- */

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gleicht mit der Cloud ab, wenn das Konto verbunden ist. Meldet ehrlich, ob
 * der Stand danach in der Cloud liegt; „läuft schon“, „Entscheidung nötig“
 * und Fehler zählen nicht als abgeglichen.
 * @returns {Promise<{ok:boolean, verbunden:boolean, grund?:string}>}
 */
async function abgleichen(reason) {
  const st = await api.cloud.status().catch(() => ({}));
  if (!st.linked) return { ok: true, verbunden: false };
  try {
    if (store.dirty) await saveNow();
    for (let versuch = 0; versuch < 3; versuch++) {
      // Läuft gerade ein Abgleich (die Automatik), erst fertig werden lassen:
      // Er kann Änderungen verpasst haben, die eben erst entstanden sind.
      for (let i = 0; i < 300 && syncState.running; i++) await warte(200);
      const r = await syncNow({ reason });
      if (r?.skipped === 'läuft-bereits') continue;
      if (r?.skipped === 'nicht-verbunden') return { ok: true, verbunden: false };
      if (r?.skipped === 'gesperrt') return { ok: false, verbunden: true, grund: 'Kontovia ist gesperrt.' };
      if (r?.needsDecision) {
        return { ok: false, verbunden: true, grund: 'Die Buchhaltung in Ihrem Google-Konto und die auf diesem Gerät passen nicht zusammen. Klären Sie das zuerst in den Einstellungen unter Cloud.' };
      }
      return { ok: true, verbunden: true };
    }
    return { ok: false, verbunden: true, grund: 'Ein anderer Abgleich lief gleichzeitig. Bitte noch einmal versuchen.' };
  } catch (e) {
    return { ok: false, verbunden: true, grund: e.message || 'Der Abgleich hat nicht geklappt.' };
  }
}

const laufbalken = '<div class="bar-track upd-warten mt16"><div class="bar-fill"></div></div>';

/**
 * Das Fenster, das abgleicht und dabei sagt, was geschieht. Klappt es nicht,
 * bleibt die Wahl: noch einmal versuchen, abbrechen oder trotzdem weitermachen.
 * @returns {Promise<'ok'|'trotzdem'|'abbrechen'>}
 */
function abgleichFenster({ titel, laeuft, weiter, weiterGefahr = false, fehlerHinweis, reason }) {
  return new Promise((resolve) => {
    let fertig = false;
    let abgebrochen = false;
    const ende = (wert) => { if (fertig) return; fertig = true; resolve(wert); };
    const m = modal({ title: titel, size: 'slim', body: '', foot: ' ', onClose: () => { abgebrochen = true; ende('abbrechen'); } });
    const zeigen = (body, foot) => { m.body.innerHTML = body; m.foot.innerHTML = foot; };

    async function lauf() {
      zeigen(`<p class="mt0" style="line-height:1.6">${esc(laeuft)}</p>${laufbalken}`, '');
      const r = await abgleichen(reason);
      if (abgebrochen || fertig) return;
      if (r.ok) { ende('ok'); m.close(); return; }
      const st = await api.cloud.status().catch(() => ({}));
      zeigen(`<div class="notice warn mb0"><strong>Der Abgleich hat nicht geklappt.</strong><br>${esc(r.grund)}
        ${fehlerHinweis ? `<br><br>${fehlerHinweis(st.lastSyncAt ? fmtDateTime(st.lastSyncAt) : '')}` : ''}</div>`,
      `<button class="btn" data-abbrechen>Abbrechen</button><button class="btn" data-nochmal>Noch einmal versuchen</button>
       <button class="btn ${weiterGefahr ? 'danger' : 'primary'}" data-weiter>${esc(weiter)}</button>`);
      m.foot.querySelector('[data-abbrechen]').addEventListener('click', () => { ende('abbrechen'); m.close(); });
      m.foot.querySelector('[data-nochmal]').addEventListener('click', () => lauf());
      m.foot.querySelector('[data-weiter]').addEventListener('click', () => { ende('trotzdem'); m.close(); });
    }
    lauf();
  });
}

/* -------------------------------------------------------------------------- */
/* Abmelden                                                                    */
/* -------------------------------------------------------------------------- */

/** Merkt eine Nachricht für den Start nach dem Neuladen (hier: nach dem Abmelden oder Wechseln). */
function nachrichtMerken(text) {
  try { sessionStorage.setItem('kontovia.nachricht', text); } catch { /* dann eben ohne */ }
}

/** Die Nachricht aus dem Vorgang davor, einmalig. */
export function nachrichtHolen() {
  try {
    const t = sessionStorage.getItem('kontovia.nachricht') || '';
    sessionStorage.removeItem('kontovia.nachricht');
    return t;
  } catch { return ''; }
}

/**
 * Meldet das offene Konto von diesem Gerät ab: Buchhaltung, Belege, Sicherungen
 * und alle Zugänge werden hier entfernt, die anderen Konten bleiben. Ist das
 * Konto mit Google verbunden, gleicht Kontovia vorher ab; klappt das nicht,
 * bleibt es stehen, außer man entscheidet sich ausdrücklich dagegen.
 * @param {{gesperrt?:boolean}} opts  vom Sperrbildschirm aus: ohne Abgleich
 * @returns {Promise<boolean>} wurde abgemeldet?
 */
export async function abmelden({ gesperrt = false } = {}) {
  const [st, stand] = await Promise.all([
    gesperrt ? {} : api.cloud.status().catch(() => ({})),
    api.konten.liste().catch(() => ({ konten: [] })),
  ]);
  const verbunden = !gesperrt && !!st.linked;
  const ich = stand.konten.find((k) => k.aktiv);
  const andere = stand.konten.filter((k) => !k.aktiv);

  const folge = andere.length
    ? `Ihre anderen Konten bleiben erhalten. Danach öffnet Kontovia „${esc(kontoName(andere[0]))}“.`
    : 'Danach können Sie sich hier mit einem anderen Konto anmelden oder neu anfangen.';
  const hinweis = verbunden
    ? `<div class="notice mb0">Kontovia gleicht jetzt noch einmal mit Ihrem Google-Konto${st.email ? ` (${esc(st.email)})` : ''} ab${st.lastSyncAt ? `, zuletzt war das ${esc(fmtDateTime(st.lastSyncAt))}` : ''}.
        Danach können Sie die Buchhaltung hier oder auf einem anderen Gerät wieder laden.</div>`
    : gesperrt
      ? `<div class="notice warn mb0">Kontovia ist gesperrt und kann deshalb nicht mehr abgleichen. Was Sie seit dem letzten Abgleich geändert haben, geht verloren.
          Möchten Sie vorher abgleichen, entsperren Sie Kontovia zuerst. Ohne Cloud-Sicherung oder Vollsicherung ist die Buchhaltung nach dem Abmelden unwiederbringlich weg.</div>`
      : `<div class="notice warn mb0"><strong>Diese Buchhaltung liegt nur auf diesem Gerät.</strong> Nach dem Abmelden ist sie weg, wenn Sie keine Vollsicherung
          oder Cloud-Sicherung haben. <a href="#" data-zu-sicherung>Zur Sicherung</a></div>`;

  const bestaetigt = await new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: ich ? `„${kontoName(ich)}“ abmelden?` : 'Abmelden?',
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Kontovia entfernt dieses Konto mit Buchhaltung, Belegen und allen Zugängen (Fingerabdruck, Google-Verbindung) von diesem Gerät.
        ${raw(folge)}</p>
        ${raw(hinweis)}`,
      foot: `<button class="btn" data-nein>Abbrechen</button>
        <button class="btn ${verbunden ? 'primary' : 'danger'}" data-ja>${verbunden ? 'Abgleichen und abmelden' : gesperrt ? 'Trotzdem abmelden' : 'Abmelden'}</button>`,
      onClose: () => { if (!fertig) resolve(false); },
    });
    m.root.querySelector('[data-zu-sicherung]')?.addEventListener('click', (e) => {
      e.preventDefault();
      fertig = true;
      m.close();
      resolve(false);
      navigate('settings', { abschnitt: 'speicher' });
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(false); });
    m.root.querySelector('[data-ja]').addEventListener('click', () => { fertig = true; m.close(); resolve(true); });
    setTimeout(() => m.root.querySelector('[data-ja]').focus(), 40);
  });
  if (!bestaetigt) return false;

  if (verbunden && store.db) {
    const weg = await abgleichFenster({
      titel: 'Abmelden',
      laeuft: 'Kontovia gleicht mit Ihrem Google-Konto ab …',
      weiter: 'Trotzdem abmelden',
      weiterGefahr: true,
      fehlerHinweis: (zuletzt) => `Melden Sie sich trotzdem ab, gehen die Änderungen seit dem letzten Abgleich${zuletzt ? ` (${esc(zuletzt)})` : ''} verloren.
        Ihr Konto ist sonst unverändert; Sie können es später noch einmal versuchen.`,
      reason: 'abmelden',
    });
    if (weg === 'abbrechen') return false;
  } else if (store.db && store.dirty) {
    // Ohne Cloud gibt es nichts abzugleichen; die letzten Änderungen schreibt Kontovia noch auf das Gerät.
    await saveNow().catch(() => {});
  }

  try {
    await api.app.abmelden();
  } catch (e) {
    err('Abmelden nicht möglich', e.message);
    return false;
  }
  nachrichtMerken(ich ? `„${kontoName(ich)}“ ist von diesem Gerät abgemeldet.` : 'Sie sind abgemeldet.');
  // Neu laden: Der Start zeigt das nächste Konto oder die Einrichtung.
  location.reload();
  return true;
}

/* -------------------------------------------------------------------------- */
/* Konten wechseln und hinzufügen                                              */
/* -------------------------------------------------------------------------- */

/**
 * Verlässt das offene Konto: gleicht ab (falls verbunden), sperrt und lädt neu.
 * Die Daten bleiben dabei auf dem Gerät; ein misslungener Abgleich ist hier
 * deshalb nur ein Hinweis, kein Hindernis.
 * @param {() => Promise<unknown>} umschalten  stellt das andere Konto ein
 * @param {string} nachricht  was nach dem Neuladen gesagt wird
 */
async function kontoVerlassen(umschalten, nachricht) {
  if (store.db) {
    const antwort = await abgleichFenster({
      titel: 'Konto wechseln',
      laeuft: 'Kontovia gleicht dieses Konto ab, bevor es wechselt …',
      weiter: 'Trotzdem wechseln',
      fehlerHinweis: () => 'Ihre Daten bleiben auf diesem Gerät. Der Abgleich holt bei der nächsten Gelegenheit nach, was fehlt.',
      reason: 'konto-wechsel',
    });
    if (antwort === 'abbrechen') return false;
    if (store.dirty) await saveNow().catch(() => {});
  }
  try {
    await umschalten();
  } catch (e) {
    err('Wechsel nicht möglich', e.message);
    return false;
  }
  if (nachricht) nachrichtMerken(nachricht);
  location.reload();
  return true;
}

/** Zu einem anderen Konto auf diesem Gerät wechseln. */
export function kontoWechseln(konto) {
  return kontoVerlassen(() => api.konten.wechseln(konto.id), '');
}

/** Ein weiteres Konto hinzufügen: eine neue Buchhaltung anlegen oder eine aus Google laden. */
export function kontoHinzufuegen() {
  return kontoVerlassen(() => api.konten.hinzufuegen(), '');
}

/** Das Auswahlfeld in der Seitenleiste: alle Konten, das offene markiert, dazu „Konto hinzufügen“. */
export async function kontenMenue(anker) {
  const stand = await api.konten.liste().catch(() => null);
  if (!stand) return;
  openPopover(anker, {
    label: 'Konten',
    className: 'menu konten-menu',
    build: (pop, handle) => {
      pop.innerHTML = `<div class="menu-title">Konten auf diesem Gerät</div>
        ${stand.konten.map((k) => `
          <button type="button" class="menu-opt konten-opt" data-konto="${esc(k.id)}" aria-pressed="${k.aktiv}">
            <span class="konten-bild">${esc(kontoName(k).trim().charAt(0).toUpperCase())}</span>
            <span class="menu-label"><strong>${esc(kontoName(k))}</strong>${k.name && k.email ? `<span class="menu-sub">${esc(k.email)}</span>` : ''}</span>
            ${icon('check', 15, 'ico').__raw}
          </button>`).join('')}
        <div class="menu-sep"></div>
        <button type="button" class="menu-opt konten-opt" data-neu>
          <span class="konten-bild neu">${icon('plus', 15).__raw}</span>
          <span class="menu-label"><strong>Konto hinzufügen</strong></span>
        </button>`;
      pop.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        handle.close();
        if (b.hasAttribute('data-neu')) { kontoHinzufuegen(); return; }
        const k = stand.konten.find((x) => x.id === b.dataset.konto);
        if (k && !k.aktiv) kontoWechseln(k);
      });
    },
  });
}

/**
 * Unten auf dem Sperrbildschirm: die Konten dieses Geräts zum Wechseln, dazu
 * „Konto hinzufügen“ und „Konto entfernen“. Setzt auch den Namen des Kontos
 * in die Überschrift (`#unlockKonto`), damit klar ist, wofür das Passwort gilt.
 */
export async function kontenAufSperrbildschirm(host) {
  const stand = await api.konten.liste().catch(() => null);
  if (!stand || !host.isConnected) return;
  const ich = stand.konten.find((k) => k.aktiv);
  const kopf = $('#unlockKonto');
  if (kopf && ich && stand.konten.length > 1) kopf.textContent = `Konto „${kontoName(ich)}“`;
  // Wer das Gerät mit anderen teilt (etwa eine Kanzlei mit mehreren Mandanten), soll vor dem Entsperren nicht
  // die Namen aller Konten sehen: Die Liste klappt erst auf Wunsch auf.
  host.innerHTML = `
    ${stand.konten.length > 1 ? `<div class="row" style="justify-content:center">
      <button type="button" class="btn ghost sm" id="unlockAndere" aria-expanded="false" aria-controls="unlockKontenListe">${icon('users', 14).__raw} Konto wechseln</button></div>
    <div class="konten-wahl mt8" id="unlockKontenListe" role="group" aria-label="Konten auf diesem Gerät" hidden>
      ${stand.konten.map((k) => `<button type="button" class="konten-chip" data-konto="${esc(k.id)}" aria-pressed="${k.aktiv}"${k.aktiv ? ' disabled' : ''}>
        <span class="konten-bild">${esc(kontoName(k).trim().charAt(0).toUpperCase())}</span><span>${esc(kontoName(k))}</span></button>`).join('')}
    </div>` : ''}
    <div class="row" style="justify-content:center;gap:4px;flex-wrap:wrap">
      <button type="button" class="btn ghost sm" id="unlockHinzu">${icon('plus', 14).__raw} Konto hinzufügen</button>
      <button type="button" class="btn ghost sm" id="unlockAbmelden">${icon('logout', 14).__raw} Dieses Konto entfernen</button>
    </div>`;
  host.querySelectorAll('[data-konto]').forEach((b) => b.addEventListener('click', () => {
    const k = stand.konten.find((x) => x.id === b.dataset.konto);
    if (k && !k.aktiv) kontoWechseln(k);
  }));
  $('#unlockAndere', host)?.addEventListener('click', (e) => {
    const liste = $('#unlockKontenListe', host);
    liste.hidden = !liste.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!liste.hidden));
  });
  $('#unlockHinzu', host).addEventListener('click', () => kontoHinzufuegen());
  $('#unlockAbmelden', host).addEventListener('click', () => abmelden({ gesperrt: true }));
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

/* -------------------------------------------------------------------------- */
/* Einstellungen → Konten auf diesem Gerät                                     */
/* -------------------------------------------------------------------------- */

const kontoBild = (k, aktiv) => `<span class="konten-bild ${aktiv ? 'aktiv' : ''}">${esc(kontoName(k).trim().charAt(0).toUpperCase())}</span>`;

/** Eine Zeile Kleingedrucktes zu einem Konto: Betrieb, Google-Adresse, zuletzt geöffnet. */
function kontoDetails(k) {
  const teile = [];
  if (k.alias && k.name && k.alias !== k.name) teile.push(k.name);
  if (k.email) teile.push(`Google: ${k.email}`);
  teile.push(k.aktiv ? 'gerade offen' : k.geoeffnet ? `zuletzt geöffnet ${fmtDateTime(k.geoeffnet)}` : 'noch nie geöffnet');
  return teile.join(' · ');
}

/** Fragt nach einer neuen Bezeichnung. Liefert den Text (leer: zurück zum Namen des Betriebs) oder null bei Abbruch. */
function bezeichnungFrage(k) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: 'Konto umbenennen',
      size: 'slim',
      body: html`
        <p class="mt0 small muted" style="line-height:1.6">Die Bezeichnung erscheint in den Listen, auch auf dem Sperrbildschirm. Die Buchhaltung selbst ändert sich nicht.</p>
        <div class="field"><label for="kbName">Bezeichnung</label>
          <input id="kbName" value="${k.alias || ''}" maxlength="60" placeholder="${k.name || k.email || 'Buchhaltung'}" autocomplete="off">
          <span class="hint">Leer lassen, um wieder den Namen des Betriebs zu zeigen.</span></div>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Speichern</button>',
      onClose: () => { if (!fertig) resolve(null); },
    });
    const feld = m.root.querySelector('#kbName');
    const ja = () => { fertig = true; m.close(); resolve(feld.value.trim()); };
    m.root.querySelector('[data-ja]').addEventListener('click', ja);
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(null); });
    feld.addEventListener('keydown', (e) => { if (e.key === 'Enter') ja(); });
    setTimeout(() => { feld.focus(); feld.select(); }, 60);
  });
}

/**
 * Ein anderes Konto von diesem Gerät entfernen. Es ist nicht entsperrt; Kontovia
 * kann es deshalb weder abgleichen noch lesen. Wer es entfernt, bestätigt
 * zur Sicherheit mit einem Häkchen, dass es nicht rückgängig zu machen ist.
 */
function kontoEntfernenFrage(k) {
  return new Promise((resolve) => {
    let fertig = false;
    const name = kontoName(k);
    const m = modal({
      title: `„${name}“ von diesem Gerät entfernen?`,
      size: 'slim',
      body: html`
        <p class="mt0" style="line-height:1.6">Buchhaltung, Belege, Sicherungen und alle Zugänge dieses Kontos (Fingerabdruck, Google-Verbindung) werden von diesem Gerät gelöscht.
        Ihre anderen Konten bleiben, wie sie sind.</p>
        <div class="notice warn">Dieses Konto ist gerade nicht entsperrt, Kontovia kann es deshalb nicht noch einmal abgleichen. <strong>Was nicht in der Cloud oder in einer Vollsicherung liegt, ist danach weg.</strong></div>
        <label class="check mt16"><input type="checkbox" id="keOk"> <span>Ich weiß, dass sich das nicht rückgängig machen lässt.</span></label>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn danger" data-ja disabled>Entfernen</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    const feld = m.root.querySelector('#keOk');
    const ja = m.root.querySelector('[data-ja]');
    feld.addEventListener('change', () => { ja.disabled = !feld.checked; });
    ja.addEventListener('click', () => { fertig = true; m.close(); resolve(true); });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(false); });
    setTimeout(() => feld.focus(), 60);
  });
}

/** Die Karte „Konten auf diesem Gerät“: wechseln, umbenennen, andere entfernen, hinzufügen. */
export async function kontenKarte(host) {
  const stand = await api.konten.liste().catch(() => null);
  if (!stand || !host.isConnected) return;
  const konten = [...stand.konten].sort((a, b) => (b.aktiv - a.aktiv) || (b.geoeffnet - a.geoeffnet));
  host.innerHTML = `
    <div class="card-head"><h3>${icon('users', 16).__raw} Konten auf diesem Gerät</h3><span class="sub">jedes mit eigenem Passwort und eigener Buchhaltung</span></div>
    <div class="card-body">
      <div class="nutzer-tabelle">${konten.map((k) => `
        <div class="zugang-zeile" data-konto="${esc(k.id)}">
          <div class="row" style="gap:10px;min-width:0">${kontoBild(k, k.aktiv)}
            <div style="min-width:0"><strong>${esc(kontoName(k))}</strong>${k.aktiv ? ' <span class="badge info">offen</span>' : ''}
              <div class="small muted">${esc(kontoDetails(k))}</div></div></div>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            ${k.aktiv ? '' : '<button class="btn sm" data-wechseln>Wechseln</button>'}
            <button class="btn sm ghost" data-umbenennen>Umbenennen</button>
            ${k.aktiv ? '' : '<button class="btn sm ghost" data-entfernen>Entfernen</button>'}
          </div>
        </div>`).join('')}</div>
      <div class="row wrap mt16" style="gap:8px">
        <button class="btn" id="kkHinzu">${icon('plus', 15).__raw} Konto hinzufügen</button>
        <button class="btn ghost" id="kkAbmelden">${icon('logout', 15).__raw} Offenes Konto abmelden</button>
      </div>
      <p class="small muted mt16 mb0" style="line-height:1.6">Jedes Konto liegt für sich im Speicher des Browsers; beim Wechseln lädt Kontovia neu, damit nichts von einem Konto ins andere gelangt.
        Auf dem Sperrbildschirm erscheinen nur auf Wunsch die Namen der anderen Konten.
        „Abmelden“ gleicht ab und entfernt das offene Konto von diesem Gerät; ein anderes entfernen Sie hier.</p>
    </div>`;
  const neu = () => kontenKarte(host);
  host.querySelector('#kkHinzu').addEventListener('click', () => kontoHinzufuegen());
  host.querySelector('#kkAbmelden').addEventListener('click', () => abmelden());
  host.querySelectorAll('[data-konto]').forEach((z) => {
    const k = konten.find((x) => x.id === z.dataset.konto);
    z.querySelector('[data-wechseln]')?.addEventListener('click', () => kontoWechseln(k));
    z.querySelector('[data-umbenennen]')?.addEventListener('click', async () => {
      const text = await bezeichnungFrage(k);
      if (text === null) return;
      try { await api.konten.umbenennen(k.id, text); ok('Gespeichert', text || 'Es gilt wieder der Name des Betriebs.'); } catch (e) { err('Nicht gespeichert', e.message); }
      neu();
    });
    z.querySelector('[data-entfernen]')?.addEventListener('click', async () => {
      if (!await kontoEntfernenFrage(k)) return;
      try { await api.konten.entfernen(k.id); ok('Konto entfernt', kontoName(k)); } catch (e) { err('Nicht entfernt', e.message); }
      neu();
    });
  });
}
