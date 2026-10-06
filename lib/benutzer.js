/**
 * Kontovia – Benutzer in einem Konto: wählen, wechseln, verwalten.
 *
 * Die Regeln (Rollen, PIN) stehen in lib/rollen.js, die Durchsetzung in
 * commit() (lib/store.js). Hier ist, was Menschen davon sehen: die Frage „Wer
 * arbeitet jetzt?“ nach dem Entsperren, das Menü zum Wechseln in der
 * Seitenleiste, der Hinweis bei „Nur lesen“ und die Verwaltung in den
 * Einstellungen.
 *
 * Gibt es in einem Konto keine Benutzer, bleibt alles wie vor dieser Fassung:
 * keine Rollen, kein Name im Journal.
 */

import { html, raw, esc, $, uid, fmtDate } from './util.js';
import { icon, modal, ok, err, confirmDialog } from './ui.js';
import { store, commit, notify, tomb } from './store.js';
import { openPopover } from './popover.js';
import { navigate } from './router.js';
import { kontoSchluessel } from './zugaenge.js';
import {
  ROLLEN, rolleName, initialen, aktiveBenutzer, benutzerPruefen, pinErzeugen, pinPruefen, pinGueltig, darf, inhaberZahl,
} from './rollen.js';

/** Darf der angemeldete Benutzer Buchungen bearbeiten? (Ohne Benutzer: ja.) */
export const kannSchreiben = () => !store.nutzer || darf(store.nutzer.rolle, 'buchung.anlegen');
/** Ist der angemeldete Benutzer Inhaber? (Ohne Benutzer: ja.) */
export const istInhaber = () => !store.nutzer || store.nutzer.rolle === 'inhaber';

const merker = (konto) => kontoSchluessel('nutzer', konto);

/** Setzt den angemeldeten Benutzer (oder keinen) und sagt es der Oberfläche. */
export function nutzerSetzen(u, konto) {
  store.nutzer = u ? { id: u.id, name: u.name, rolle: u.rolle } : null;
  try { if (u) localStorage.setItem(merker(konto), u.id); else localStorage.removeItem(merker(konto)); } catch { /* ohne Gedächtnis eben nicht */ }
  document.body.dataset.rolle = u ? u.rolle : '';
  notify({ type: 'nutzer' });
}

const bild = (name, klasse = '') => `<span class="konten-bild ${klasse}">${esc(initialen(name))}</span>`;

/* -------------------------------------------------------------------------- */
/* PIN                                                                         */
/* -------------------------------------------------------------------------- */

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let fehlversuche = 0;

/** Fragt die PIN eines Benutzers ab. Liefert true, wenn sie stimmt, false bei Abbruch. */
function pinFrage(u) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: `PIN für ${u.name}`,
      size: 'slim',
      body: html`
        <p class="mt0 muted small" style="line-height:1.6">Dieser Benutzer ist mit einer PIN geschützt, damit nicht jemand anderes in seinem Namen arbeitet.</p>
        <div class="field"><label for="pinEingabe">PIN</label>
          <input id="pinEingabe" type="password" inputmode="numeric" autocomplete="off" maxlength="8" style="letter-spacing:.3em"></div>
        <div class="err small" id="pinFehler" role="alert"></div>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Anmelden</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    const eingabe = m.root.querySelector('#pinEingabe');
    const fehler = m.root.querySelector('#pinFehler');
    const ja = m.root.querySelector('[data-ja]');
    const pruefen = async () => {
      ja.disabled = true;
      fehler.textContent = '';
      // Jeder Fehlversuch macht das Nächste langsamer.
      if (fehlversuche) await warte(Math.min(5000, 500 * fehlversuche));
      if (await pinPruefen(u, eingabe.value)) { fehlversuche = 0; fertig = true; m.close(); resolve(true); return; }
      fehlversuche++;
      fehler.textContent = 'Die PIN stimmt nicht.';
      eingabe.select();
      ja.disabled = false;
    };
    ja.addEventListener('click', pruefen);
    eingabe.addEventListener('keydown', (e) => { if (e.key === 'Enter') pruefen(); });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(false); });
    setTimeout(() => eingabe.focus(), 60);
  });
}

/** Meldet als diesen Benutzer an (mit PIN, falls er eine hat). */
async function anmeldenAls(u, konto) {
  if (u.pin && !await pinFrage(u)) return false;
  nutzerSetzen(u, konto);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Wer arbeitet jetzt?                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Nach dem Entsperren: Hat das Konto Benutzer, wird gefragt, wer arbeitet.
 * Ein einziger Benutzer ohne PIN wird ohne Frage angemeldet. Wartet, bis
 * jemand gewählt ist.
 * @param {{konto?:string, sperren?:()=>unknown}} opts  sperren: wird gerufen, wenn jemand abbricht
 */
export async function nutzerWaehlen({ konto = '', sperren } = {}) {
  const liste = aktiveBenutzer(store.db);
  if (!liste.length) { nutzerSetzen(null, konto); return true; }
  let letzter = '';
  try { letzter = localStorage.getItem(merker(konto)) || ''; } catch { /* egal */ }
  if (liste.length === 1 && !liste[0].pin) { nutzerSetzen(liste[0], konto); return true; }
  const reihe = [...liste].sort((a, b) => (b.id === letzter) - (a.id === letzter));
  return new Promise((resolve) => {
    const m = modal({
      title: 'Wer arbeitet jetzt?',
      size: 'slim',
      closable: false,
      body: `<p class="mt0 small muted" style="line-height:1.6">Wählen Sie Ihren Namen. Kontovia vermerkt ihn im Änderungsjournal bei allem, was Sie ändern.</p>
        <div class="nutzer-liste">${reihe.map((u) => `
          <button type="button" class="menu-opt konten-opt" data-id="${esc(u.id)}">
            ${bild(u.name)}
            <span class="menu-label"><strong>${esc(u.name)}</strong><span class="menu-sub">${esc(rolleName(u.rolle))}${u.pin ? ' · mit PIN' : ''}</span></span>
            ${u.pin ? icon('lock', 14, 'ico').__raw : ''}
          </button>`).join('')}</div>`,
      foot: sperren ? '<button class="btn left" data-sperren>Sperren</button>' : '',
    });
    m.root.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
      const u = reihe.find((x) => x.id === b.dataset.id);
      if (u && await anmeldenAls(u, konto)) { m.close(); resolve(true); }
    }));
    m.root.querySelector('[data-sperren]')?.addEventListener('click', () => { m.close(); resolve(false); sperren(); });
    setTimeout(() => m.root.querySelector('[data-id]')?.focus(), 60);
  });
}

/** Das Menü in der Seitenleiste: Benutzer wechseln, Verwaltung öffnen. */
export function nutzerMenue(anker, { konto = '' } = {}) {
  const liste = aktiveBenutzer(store.db);
  if (!liste.length) return;
  openPopover(anker, {
    label: 'Benutzer',
    className: 'menu konten-menu',
    build: (pop, handle) => {
      pop.innerHTML = `<div class="menu-title">Benutzer in diesem Konto</div>
        ${liste.map((u) => `
          <button type="button" class="menu-opt konten-opt" data-id="${esc(u.id)}" aria-pressed="${u.id === store.nutzer?.id}">
            ${bild(u.name)}
            <span class="menu-label"><strong>${esc(u.name)}</strong><span class="menu-sub">${esc(rolleName(u.rolle))}</span></span>
            ${icon('check', 15, 'ico').__raw}
          </button>`).join('')}
        <div class="menu-sep"></div>
        <button type="button" class="menu-opt konten-opt" data-verwalten>
          <span class="konten-bild neu">${icon('settings', 15).__raw}</span>
          <span class="menu-label"><strong>Benutzer verwalten</strong></span>
        </button>`;
      pop.addEventListener('click', async (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        handle.close();
        if (b.hasAttribute('data-verwalten')) { navigate('settings', { abschnitt: 'benutzer' }); return; }
        const u = liste.find((x) => x.id === b.dataset.id);
        if (u && u.id !== store.nutzer?.id) await anmeldenAls(u, konto);
      });
    },
  });
}

/**
 * Zeigt, wer angemeldet ist: Knopf in der Seitenleiste, Hinweis bei „Nur lesen“.
 * Läuft bei jedem Wechsel des Benutzers und nach jeder Änderung der Benutzerliste.
 */
export function nutzerAnzeigen() {
  const knopf = $('#nutzerBtn');
  const banner = $('#rolleBanner');
  const u = store.nutzer;
  if (knopf) {
    const gibt = aktiveBenutzer(store.db).length > 0;
    knopf.hidden = !gibt || !u;
    if (gibt && u) {
      knopf.innerHTML = `${bild(u.name)}<span class="nutzer-text"><strong>${esc(u.name)}</strong><span>${esc(rolleName(u.rolle))}</span></span>${icon('down', 14).__raw}`;
      knopf.title = 'Benutzer wechseln';
    }
  }
  if (banner) {
    const lesen = u?.rolle === 'lesen';
    banner.hidden = !lesen;
    if (lesen) banner.textContent = `Sie sind als „${u.name}“ mit der Rolle „Nur lesen“ angemeldet: ansehen, auswerten und exportieren geht, ändern nicht.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Verwaltung (Einstellungen)                                                  */
/* -------------------------------------------------------------------------- */

/** Wie die Rollen in der Auswahl erklärt werden. */
const rollenAuswahl = (aktuell) => Object.entries(ROLLEN).map(([k, r]) => `
  <label class="rolle-wahl"><input type="radio" name="bd_rolle" value="${k}" ${k === aktuell ? 'checked' : ''}>
    <span><strong>${esc(r.name)}</strong><span class="small muted">${esc(r.text)}</span></span></label>`).join('');

/**
 * Das Fenster zum Anlegen und Bearbeiten.
 * @param {object|null} u  der Benutzer, oder null für einen neuen
 * @param {{erster?:boolean, konto?:string, danach?:()=>void}} opt  erster: der erste Benutzer des Kontos (wird Inhaber)
 */
function benutzerDialog(u, { erster = false, konto = '', danach } = {}) {
  const neu = !u;
  const vorname = erster ? (store.db.settings.ownerName || store.db.settings.companyName || '') : '';
  const m = modal({
    title: erster ? 'Benutzer einrichten' : neu ? 'Benutzer hinzufügen' : `${u.name} bearbeiten`,
    size: 'slim',
    body: html`
      ${erster ? raw(`<p class="mt0 small muted" style="line-height:1.6">Legen Sie zuerst sich selbst als Inhaber an. Danach können Sie weitere Personen hinzufügen,
        etwa Mitarbeitende oder die Steuerberatung. Ab dann fragt Kontovia nach dem Entsperren, wer arbeitet, und das Journal vermerkt den Namen.</p>`) : ''}
      <div class="field"><label for="bd_name">Name</label><input id="bd_name" value="${u?.name || vorname}" maxlength="60" autocomplete="off"></div>
      ${erster ? '' : raw(`<div class="field"><label>Rolle</label><div class="stack" style="gap:6px">${rollenAuswahl(u?.rolle || 'buchhaltung')}</div></div>`)}
      <div class="field"><label for="bd_pin">PIN (freiwillig)</label>
        <input id="bd_pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="${u?.pin ? 'leer lassen, um sie zu behalten' : '4 bis 8 Ziffern'}" style="letter-spacing:.3em">
        <span class="hint">Mit einer PIN kann niemand ohne sie als dieser Benutzer arbeiten. Sie schützt nicht die Daten: Wer das Passwort des Kontos kennt, kommt ohnehin an alles.</span>
        ${u?.pin ? raw('<label class="check mt8"><input type="checkbox" id="bd_pinWeg"> PIN entfernen</label>') : ''}</div>
      ${neu ? '' : raw(`<label class="check"><input type="checkbox" id="bd_aus" ${u.deaktiviert ? 'checked' : ''}> Deaktiviert (taucht bei „Wer arbeitet jetzt?“ nicht mehr auf)</label>`)}
      <div class="err small mt8" id="bd_fehler" role="alert"></div>`,
    foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Speichern</button>',
  });
  const g = (id) => m.root.querySelector(`#bd_${id}`);
  m.root.querySelector('[data-nein]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-ja]').addEventListener('click', async (ev) => {
    const knopf = ev.currentTarget;
    const fehler = g('fehler');
    fehler.textContent = '';
    const name = g('name').value.trim();
    const rolle = erster ? 'inhaber' : m.root.querySelector('input[name=bd_rolle]:checked')?.value;
    const deaktiviert = !!g('aus')?.checked;
    const pin = g('pin').value;
    const text = benutzerPruefen(store.db, { id: u?.id || '', name, rolle, deaktiviert });
    if (text) { fehler.textContent = text; return; }
    if (pin && !pinGueltig(pin)) { fehler.textContent = 'Die PIN besteht aus vier bis acht Ziffern.'; return; }
    knopf.disabled = true;
    try {
      const pinEintrag = pin ? await pinErzeugen(pin) : (g('pinWeg')?.checked ? null : (u?.pin || null));
      const jetzt = new Date().toISOString();
      const item = {
        id: u?.id || uid('bn'), name, rolle, ...(deaktiviert ? { deaktiviert: true } : {}), ...(pinEintrag ? { pin: pinEintrag } : {}),
        createdAt: u?.createdAt || jetzt, updatedAt: jetzt,
      };
      await commit(neu ? 'benutzer.anlegen' : 'benutzer.aendern', (db) => {
        db.users ??= [];
        const i = db.users.findIndex((x) => x.id === item.id);
        if (i >= 0) db.users[i] = item; else db.users.push(item);
        db.tombstones = (db.tombstones || []).filter((t) => !(t.collection === 'users' && t.id === item.id));
        return item;
      }, { entity: 'benutzer', entityId: item.id, summary: `${neu ? 'Benutzer angelegt' : 'Benutzer geändert'}: ${name} (${rolleName(rolle)})` });
      // Der erste Benutzer ist sofort angemeldet; wer sich selbst ändert, bleibt es mit den neuen Angaben.
      if (erster || item.id === store.nutzer?.id) nutzerSetzen(item.deaktiviert ? null : item, konto);
      m.close();
      ok(neu ? 'Benutzer angelegt' : 'Gespeichert', name);
      nutzerAnzeigen();
      danach?.();
    } catch (e) {
      fehler.textContent = e.message;
      knopf.disabled = false;
    }
  });
  setTimeout(() => g('name').focus(), 60);
}

async function benutzerLoeschen(u, danach) {
  if (u.id === store.nutzer?.id) { err('Nicht möglich', 'Sie sind gerade als dieser Benutzer angemeldet. Wechseln Sie zuerst zu einem anderen.'); return; }
  if (u.rolle === 'inhaber' && !u.deaktiviert && inhaberZahl(store.db) <= 1) { err('Nicht möglich', 'Es muss mindestens ein Inhaber bleiben.'); return; }
  const weg = await confirmDialog({
    title: `${u.name} löschen?`,
    text: 'Der Benutzer verschwindet aus der Liste. Im Änderungsjournal bleibt sein Name bei allem, was er geändert hat, stehen. Das lässt sich nicht rückgängig machen.',
    confirmLabel: 'Löschen', danger: true,
  });
  if (!weg) return;
  try {
    await commit('benutzer.loeschen', (db) => {
      db.users = (db.users || []).filter((x) => x.id !== u.id);
      tomb(db, 'users', u.id);
    }, { entity: 'benutzer', entityId: u.id, summary: `Benutzer gelöscht: ${u.name}` });
    ok('Benutzer gelöscht', u.name);
    danach();
  } catch (e) { err('Nicht gelöscht', e.message); }
}

async function benutzerAbschalten(konto, danach) {
  const weg = await confirmDialog({
    title: 'Benutzer abschalten?',
    text: 'Alle Benutzer werden gelöscht. Kontovia arbeitet danach wie zuvor: ohne Rollen und ohne Namen im Journal. Die bisherigen Einträge im Journal behalten ihre Namen.',
    confirmLabel: 'Abschalten', danger: true,
  });
  if (!weg) return;
  try {
    await commit('benutzer.abschalten', (db) => {
      for (const x of db.users || []) tomb(db, 'users', x.id);
      db.users = [];
    }, { entity: 'benutzer', summary: 'Benutzer abgeschaltet' });
    nutzerSetzen(null, konto);
    nutzerAnzeigen();
    ok('Benutzer abgeschaltet');
    danach();
  } catch (e) { err('Nicht abgeschaltet', e.message); }
}

/** Die Karte „Benutzer in diesem Konto“ für die Einstellungen. */
export function benutzerKarte(host, { konto = '' } = {}) {
  const zeichnen = () => benutzerKarte(host, { konto });
  const liste = [...(store.db.users || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  const darfVerwalten = istInhaber();
  host.innerHTML = `
    <div class="card-head"><h2>${icon('users', 16).__raw} Benutzer in diesem Konto</h2><span class="sub">wer was ändern darf und im Journal steht</span></div>
    <div class="card-body">
      ${liste.length ? `
        <div class="nutzer-tabelle">${liste.map((u) => `
          <div class="zugang-zeile" data-id="${esc(u.id)}">
            <div class="row" style="gap:10px;min-width:0">${bild(u.name, u.id === store.nutzer?.id ? 'aktiv' : '')}
              <div style="min-width:0"><strong>${esc(u.name)}</strong>${u.id === store.nutzer?.id ? ' <span class="badge info">angemeldet</span>' : ''}${u.deaktiviert ? ' <span class="badge">deaktiviert</span>' : ''}
                <div class="small muted">${esc(rolleName(u.rolle))}${u.pin ? ' · mit PIN' : ''} · seit ${esc(fmtDate(String(u.createdAt).slice(0, 10)))}</div></div></div>
            ${darfVerwalten ? `<div class="row" style="gap:6px"><button class="btn sm" data-bearbeiten>Bearbeiten</button>
              <button class="btn sm ghost" data-loeschen>Löschen</button></div>` : ''}
          </div>`).join('')}</div>
        ${darfVerwalten ? `<div class="row wrap mt16" style="gap:8px">
          <button class="btn" id="bdNeu">${icon('plus', 15).__raw} Benutzer hinzufügen</button>
          <button class="btn ghost" id="bdAus">Benutzer abschalten</button></div>`
    : '<p class="small muted mt16 mb0">Benutzer ändern darf nur ein Inhaber.</p>'}`
    : `<p class="mt0" style="line-height:1.6">Arbeiten mehrere Personen mit dieser Buchhaltung, oder soll die Steuerberatung nur mitlesen? Mit Benutzern fragt Kontovia nach dem Entsperren,
        wer arbeitet. Das Änderungsjournal vermerkt dann bei jeder Änderung den Namen (das erwartet die GoBD), und Rollen bestimmen, was jemand ändern darf.</p>
      <button class="btn" id="bdErst">${icon('plus', 15).__raw} Benutzer einrichten</button>`}
      <div class="notice mt16 mb0"><strong>Rollen sind keine Zugriffssperre.</strong> Wer das Passwort dieses Kontos kennt, besitzt den Schlüssel zu allen Daten. Die Rollen regeln die Bedienung
        in Kontovia und den Namen im Journal. Wer wirklich getrennte Daten braucht, legt ein eigenes Konto mit eigenem Passwort an (Menü an der Marke links oben).</div>
    </div>`;
  const danach = () => zeichnen();
  host.querySelector('#bdErst')?.addEventListener('click', () => benutzerDialog(null, { erster: true, konto, danach }));
  host.querySelector('#bdNeu')?.addEventListener('click', () => benutzerDialog(null, { konto, danach }));
  host.querySelector('#bdAus')?.addEventListener('click', () => benutzerAbschalten(konto, danach));
  host.querySelectorAll('[data-id]').forEach((z) => {
    const u = liste.find((x) => x.id === z.dataset.id);
    z.querySelector('[data-bearbeiten]')?.addEventListener('click', () => benutzerDialog(u, { konto, danach }));
    z.querySelector('[data-loeschen]')?.addEventListener('click', () => benutzerLoeschen(u, danach));
  });
}

export { inhaberZahl };
