/**
 * Kontovia – befristete Zulassung (Oberfläche).
 *
 * Ein mit Google verbundenes Gerät bestätigt alle 30 Tage, dass sein Konto
 * noch zugelassen ist. Das geschieht von selbst, beim Entsperren und danach
 * alle sechs Stunden, solange Kontovia offen ist. Ist das Konto beim
 * Betreiber nicht mehr zugelassen, wird die Buchhaltung von diesem Gerät
 * entfernt, aber erst nach zweifach bestätigter Sperre und nachdem sie
 * gesichert in der Cloud liegt. Wo etwas unklar ist (kein Netz, Fehler),
 * passiert nie etwas außer einem freundlichen Hinweis. Die Entscheidungen
 * fallen in src/web (zulassung.js, cloud.js); hier ist, was man sieht, und
 * der Ablauf „sichern, dann entfernen“.
 */

import { html, esc, $, fmtDate, fmtDateTime } from './util.js';
import { icon, modal, ok, err, toast } from './ui.js';
import { store, saveNow } from './store.js';
import { syncNow } from './sync.js';
import { navigate } from './router.js';

const api = window.kontovia;

const SECHS_STUNDEN = 6 * 60 * 60 * 1000;
/**
 * Ist die Frist überfällig und das Gerät kommt gar nicht ins Netz (keine Antwort des Speichers, auch keine
 * Fehlermeldung), sperrt es sich nach dem Entsperren wieder, bis eine Prüfung gelingt. Das gibt der Frist Gewicht
 * gegen ein abhandengekommenes Gerät ohne Internet. Auf false gestellt, passiert nach der Frist nur noch ein Hinweis.
 */
const OFFLINE_NACH_FRIST_SPERREN = true;
const HINWEIS_KEY = 'kontovia.hinweis.zulassung';
let zeitplan = null;
let laeuft = false;

/* -------------------------------------------------------------------------- */
/* Der Hinweis nach dem Entfernen                                              */
/* -------------------------------------------------------------------------- */

/** Merkt für die Anmeldeseite, was geschehen ist. Einmal gezeigt, dann weg. */
function hinweisMerken(art) {
  try { localStorage.setItem(HINWEIS_KEY, JSON.stringify({ art, am: new Date().toISOString() })); } catch { /* dann ohne */ }
}

/** Der Kasten für die Anmeldeseite, oder leer. Schließen entfernt ihn für immer. */
export function hinweisKasten() {
  let h = null;
  try { h = JSON.parse(localStorage.getItem(HINWEIS_KEY) || 'null'); } catch { h = null; }
  if (!h) return '';
  return `<div class="notice warn mb16" id="zulassungHinweis" role="status">
    <strong>Dieses Gerät wurde vom Betreiber abgemeldet.</strong><br>
    Ihr Konto ist für Kontovia nicht mehr zugelassen. Deshalb wurde die Buchhaltung am ${esc(fmtDate(String(h.am).slice(0, 10)))} von diesem Gerät entfernt.
    <strong>In der Cloud ist sie vollständig erhalten.</strong> Ist das ein Irrtum, wenden Sie sich an den Betreiber. Sobald Ihr Konto wieder zugelassen ist,
    melden Sie sich unten mit Google an. Ihre Buchhaltung wird dann geladen, mit dem Passwort oder mit dem QR-Code von einem anderen Gerät.
    <div class="mt8"><button class="btn sm" type="button" data-hinweis-weg>Verstanden</button></div></div>`;
}

export function hinweisVerdrahten(root, neuZeichnen) {
  $('[data-hinweis-weg]', root)?.addEventListener('click', () => {
    try { localStorage.removeItem(HINWEIS_KEY); } catch { /* egal */ }
    neuZeichnen();
  });
}

/* -------------------------------------------------------------------------- */
/* Beim Entsperren und danach                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Nach dem Entsperren. Ist die Frist überfällig und das Gerät kommt nicht ins Netz, sperrt es sich
 * wieder (der Nutzer bleibt nicht ausgesperrt, sobald es eine Verbindung gibt). Sonst läuft alles im Hintergrund.
 * @returns {Promise<boolean>} false, wenn wieder gesperrt wurde
 */
export async function beimEntsperren() {
  let s;
  try { s = await api.zulassung.status(); } catch { return true; }
  if (!s.aktiv && s.zustand !== 'lokal-gesperrt') { bannerZeigen(s); return true; }
  if (s.zustand === 'lokal-gesperrt') { bannerZeigen(s); return true; }

  if (s.zustand === 'ueberfaellig') {
    // Erst prüfen: bis dahin deckt ein Fenster die Buchhaltung ab.
    const m = modal({ title: 'Einen Moment', size: 'slim', closable: false,
      body: '<p class="mt0" style="line-height:1.6">Kontovia prüft, ob Ihr Konto noch zugelassen ist …</p><div class="bar-track upd-warten mt16"><div class="bar-fill"></div></div>', foot: ' ' });
    const r = await pruefenUndHandeln('entsperren');
    m.close();
    if (r?.netz && OFFLINE_NACH_FRIST_SPERREN) {
      await api.zulassung.fristSperre().catch(() => {});
      return false;
    }
  } else {
    pruefenUndHandeln('entsperren');
  }
  if (!zeitplan) {
    zeitplan = setInterval(() => { if (store.db) pruefenUndHandeln('zeitplan'); }, SECHS_STUNDEN);
    window.addEventListener('online', () => { if (store.db) pruefenUndHandeln('wieder-online'); });
  }
  return true;
}

/** Fragt nach, zeigt den Stand und handelt, wenn (und nur wenn) die Sperre feststeht. */
export async function pruefenUndHandeln(anlass = 'manuell') {
  if (laeuft) return null;
  laeuft = true;
  try {
    const r = await api.zulassung.pruefen();
    bannerZeigen(r);
    if (r.aktion === 'loeschen') await entfernenAblauf();
    return r;
  } catch (e) {
    // Ein Fehler hier ist nie ein Grund, etwas zu tun.
    console.warn('Zulassung nicht geprüft:', e.message);
    return { netz: false, fehler: e.message, anlass };
  } finally { laeuft = false; }
}

/* -------------------------------------------------------------------------- */
/* Hinweisleiste                                                               */
/* -------------------------------------------------------------------------- */

const tagText = (n) => (n === 1 ? 'noch 1 Tag' : `noch ${n} Tage`);

/** Zeigt oder versteckt die Leiste unter der Kopfzeile. Ruhig bei Tag 20, deutlicher danach, nie ein Schreckensbild. */
export function bannerZeigen(s) {
  const b = $('#zulassungBanner');
  if (!b) return;
  let text = '';
  let knopf = '';
  const bis = s?.bis ? fmtDate(s.bis.slice(0, 10)) : '';
  if (s?.zustand === 'lokal-gesperrt') {
    text = 'Dieses Gerät ist vom Cloud-Abgleich getrennt, weil das Konto beim Betreiber gesperrt wurde. Ihre Buchhaltung liegt weiter hier und öffnet sich mit dem Passwort. '
      + 'In der Cloud ist sie unverändert. Legen Sie jetzt eine Vollsicherung an.';
    knopf = '<button class="btn sm" data-zu-sicherung>Zur Sicherung</button>';
  } else if (s?.zustand === 'gesperrt-beobachtet') {
    text = `Das Konto ist beim Betreiber gesperrt. Ihre Buchhaltung bleibt vorerst hier. Frühestens ab ${s.loeschenAb ? fmtDateTime(s.loeschenAb) : 'morgen'} entfernt Kontovia sie von diesem Gerät, `
      + 'nachdem sie noch einmal in der Cloud gesichert wurde. In der Cloud bleibt sie erhalten. Ist das ein Irrtum, wenden Sie sich an den Betreiber. Eine Vollsicherung schadet jetzt nicht.';
    knopf = '<button class="btn sm" data-zu-sicherung>Zur Sicherung</button><button class="btn sm" data-bestaetigen>Erneut prüfen</button>';
  } else if (s?.aktiv && s.stufe >= 1) {
    const rest = s.tageRest;
    text = s.stufe === 4
      ? 'Die Bestätigung Ihres Kontos ist überfällig. Verbinden Sie dieses Gerät mit dem Internet und tippen Sie auf „Jetzt bestätigen“. Ihre Buchhaltung bleibt dabei, wie sie ist.'
      : `Bitte bestätigen Sie bis zum ${bis} (${tagText(rest)}), dass Ihr Konto noch zugelassen ist. Das geschieht von selbst, sobald dieses Gerät Internet hat. `
        + 'Ihre Daten in der Cloud bleiben in jedem Fall erhalten.';
    knopf = '<button class="btn sm" data-bestaetigen>Jetzt bestätigen</button>';
  }
  b.hidden = !text;
  b.innerHTML = text ? `<span>${esc(text)}</span> <span class="zulassung-knoepfe">${knopf}</span>` : '';
  b.querySelector('[data-zu-sicherung]')?.addEventListener('click', () => navigate('settings', { abschnitt: 'speicher' }));
  b.querySelector('[data-bestaetigen]')?.addEventListener('click', (ev) => { ev.currentTarget.disabled = true; manuellPruefen(); });
}

/** „Jetzt bestätigen“: prüft und sagt in einfachen Worten, wie es ausging. */
export async function manuellPruefen() {
  const r = await pruefenUndHandeln('manuell');
  if (!r) { toast('Einen Moment', 'Eine Prüfung läuft schon.'); return r; }
  if (r.aktion === 'loeschen') return r;
  if (r.netz) toast('Keine Verbindung', 'Kontovia kommt gerade nicht an den Cloud-Speicher. Versuchen Sie es mit Internet noch einmal. Ihre Daten sind nicht betroffen.', 'warn', 7000);
  else if (r.zustand === 'ok' || r.zustand === 'neu') ok('Bestätigt', r.bis ? `Nächste Bestätigung bis ${fmtDate(r.bis.slice(0, 10))}.` : '');
  else if (r.zustand === 'gesperrt-beobachtet') toast('Konto gesperrt', 'Das Konto ist beim Betreiber gesperrt. Details stehen oben im Fenster.', 'warn', 8000);
  else toast('Nicht eindeutig', 'Die Prüfung hat kein klares Ergebnis gebracht, zum Beispiel wegen einer Störung. Ihre Daten sind nicht betroffen. Versuchen Sie es später noch einmal.', 'warn', 8000);
  return r;
}

/* -------------------------------------------------------------------------- */
/* Sichern, dann entfernen (oder nur sperren)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Die Sperre steht fest (zweimal im Abstand von mindestens einem Tag bestätigt). Zuerst wird
 * die Buchhaltung gesichert in der Cloud abgelegt. Geht das, wird sie von diesem Gerät entfernt;
 * sonst wird das Gerät nur gesperrt (Cloud-Verbindung, Fingerabdruck und Google-Zugang weg, die
 * Datei bleibt, das Passwort öffnet sie weiter). Nichts in der Cloud wird angefasst.
 */
async function entfernenAblauf() {
  const m = modal({ title: 'Konto nicht mehr zugelassen', size: 'slim', closable: false,
    body: html`<p class="mt0" style="line-height:1.6">Dieses Konto ist beim Betreiber nicht mehr zugelassen. Kontovia sichert Ihre Buchhaltung jetzt noch einmal in der Cloud
      und entfernt sie dann von diesem Gerät. <strong>In der Cloud bleibt sie erhalten.</strong></p><div class="bar-track upd-warten mt16"><div class="bar-fill"></div></div>`, foot: ' ' });
  let gesichert = false;
  try {
    if (store.dirty) await saveNow();
    const r = await syncNow({ reason: 'zulassung' });
    gesichert = !!r?.ok && !r.needsDecision;
  } catch { gesichert = false; }

  if (gesichert) {
    try {
      const r = await api.zulassung.loeschen();
      if (r.geloescht) {
        hinweisMerken('geloescht');
        location.reload();
        return;
      }
    } catch { /* dann wird gesperrt */ }
  }

  // Nicht sicher gesichert oder nicht erlaubt: nichts löschen, nur das Gerät vom Abgleich trennen.
  try { await api.zulassung.sperren(); } catch (e) { m.close(); err('Nicht möglich', e.message); return; }
  m.body.innerHTML = html`<div class="notice warn" role="alert"><strong>Das Gerät ist gesperrt, Ihre Buchhaltung ist noch da.</strong><br>
    Kontovia konnte sie nicht sicher in der Cloud ablegen und hat deshalb nichts gelöscht. Sie liegt weiter auf diesem Gerät und öffnet sich mit Ihrem Passwort.
    Die Verbindung zur Cloud, der Fingerabdruck und der Google-Zugang dieses Geräts sind entfernt.</div>
    <p class="mb0" style="line-height:1.6">Legen Sie jetzt eine <strong>Vollsicherung</strong> an: Einstellungen, Sicherung und Speicherort. Die Cloud-Kopie bleibt unverändert erhalten.</p>`;
  m.foot.innerHTML = '<button class="btn" data-weiter>Später</button><button class="btn primary" data-sichern>Zur Sicherung</button>';
  m.foot.querySelector('[data-weiter]').addEventListener('click', () => m.close());
  m.foot.querySelector('[data-sichern]').addEventListener('click', () => { m.close(); navigate('settings', { abschnitt: 'speicher' }); });
  bannerZeigen({ zustand: 'lokal-gesperrt', aktiv: false });
}

/* -------------------------------------------------------------------------- */
/* Einstellungen                                                               */
/* -------------------------------------------------------------------------- */

/** Die Karte „Zulassung dieses Geräts“ in den Einstellungen. */
export async function zulassungKarte(host) {
  const s = await api.zulassung.status().catch(() => null);
  if (!s || !host.isConnected) return;
  const kopf = `<div class="card-head"><h3>${icon('shield', 16).__raw} Zulassung dieses Geräts</h3><span class="sub">alle 30 Tage, von selbst</span></div>`;
  if (!s.aktiv && s.zustand !== 'lokal-gesperrt') {
    host.innerHTML = `${kopf}<div class="card-body"><p class="mt0 mb0 small muted" style="line-height:1.6">Dieses Gerät ist nicht mit einem Google-Konto verbunden. Dann gibt es nichts zu bestätigen.</p></div>`;
    return;
  }
  const zeile = (name, wert) => `<div class="zugang-zeile"><div><strong>${name}</strong></div><div class="small">${wert}</div></div>`;
  const lokal = s.zustand === 'lokal-gesperrt';
  host.innerHTML = `${kopf}<div class="card-body">
    ${lokal ? `<div class="notice warn">Dieses Gerät ist vom Cloud-Abgleich getrennt, weil das Konto beim Betreiber gesperrt wurde. Ihre Buchhaltung liegt weiter hier. Legen Sie eine Vollsicherung an.</div>` : `
    ${zeile('Zuletzt bestätigt', s.zuletzt ? esc(fmtDateTime(s.zuletzt)) : 'noch nicht (die erste Bestätigung folgt von selbst)')}
    ${zeile('Nächste Bestätigung bis', s.bis ? `${esc(fmtDate(s.bis.slice(0, 10)))}${s.tageRest != null ? ` <span class="muted">(${esc(tagText(s.tageRest))})</span>` : ''}` : '–')}
    ${s.zustand === 'gesperrt-beobachtet' ? `<div class="notice warn mt16">Das Konto ist beim Betreiber gesperrt. Frühestens ab ${esc(s.loeschenAb ? fmtDateTime(s.loeschenAb) : 'morgen')} wird die Buchhaltung von diesem Gerät entfernt, nachdem sie in der Cloud gesichert wurde.</div>` : ''}
    <div class="row wrap mt16" style="gap:8px"><button class="btn" id="zlJetzt">Jetzt bestätigen</button></div>`}
    <p class="small muted mt16 mb0" style="line-height:1.6">Mit Google verbundene Geräte fragen alle 30 Tage bei Ihrem Konto im Cloud-Speicher nach, ob es noch zugelassen ist. Dabei wird nur gelesen;
      es gehen keine Daten über Ihre Buchhaltung hinaus. So kann der Betreiber ein verlorenes oder nicht mehr berechtigtes Gerät vom Konto trennen.
      Wird die Frist überschritten, passiert nichts außer Hinweisen. Entfernt wird nichts, außer das Konto ist ausdrücklich gesperrt, und auch dann erst, wenn Ihre Buchhaltung gesichert in der Cloud liegt.
      Wer „Cloud trennen“ wählt, ist davon nicht mehr betroffen. Das ist kein vollständiger Schutz: Wer ein Gerät nie öffnet, wird auch nicht gefragt.</p></div>`;
  $('#zlJetzt', host)?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    await manuellPruefen();
    zulassungKarte(host);
  });
}
