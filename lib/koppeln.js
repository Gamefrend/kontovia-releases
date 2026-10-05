/**
 * Kontovia – ein weiteres Gerät verbinden (Oberfläche).
 *
 * Am offenen Gerät (meist der PC): „Neues Gerät hinzufügen“ zeigt einen
 * QR-Code. Am neuen Gerät (meist das Handy), nach der Anmeldung bei Google:
 * den Code scannen, am offenen Gerät bestätigen, fertig. Die Buchhaltung
 * kommt über die Cloud, der Zugang nur über den QR-Code; beides zusammen
 * braucht es, das Google-Konto allein genügt nicht. Die Technik steht in
 * src/web/koppeln.js; hier ist nur, was man sieht.
 *
 * Alles, was den QR-Code zeigt, trägt `data-ohne-foto`: Das Bildschirmfoto
 * der Rückmeldung (lib/bildschirmfoto.js) lässt es weg.
 */

import { html, raw, esc, $, fmtDateTime } from './util.js';
import { icon, modal, ok, err } from './ui.js';
import { store, commit } from './store.js';
import { darf, verbotText } from './rollen.js';
import { qrCode, laeufe } from './qr.js';
import { scannerMoeglich, scannerStarten } from './qrlesen.js';

const api = window.kontovia;

/** Die Meldung zu einem Fehler der Kopplung, mit dem nächsten Schritt. */
export function koppelnFehlerText(e) {
  switch (e?.code) {
    case 'KAMERA_VERWEIGERT': return 'Kontovia darf die Kamera nicht benutzen. Erlauben Sie es in den Einstellungen Ihres Browsers, oder geben Sie den Code von Hand ein.';
    case 'KEINE_KAMERA': return 'Dieses Gerät hat keine Kamera, die Kontovia öffnen kann. Geben Sie den Code von Hand ein.';
    case 'KAMERA_BELEGT': return 'Die Kamera wird gerade von einer anderen App benutzt. Schließen Sie diese und versuchen Sie es noch einmal, oder geben Sie den Code von Hand ein.';
    case 'KAMERA_FEHLER': return 'Die Kamera lässt sich nicht öffnen. Geben Sie den Code von Hand ein.';
    case 'KOPPELN_CODE': return 'Dieser Code stimmt nicht. Bitte prüfen Sie ihn oder scannen Sie den QR-Code noch einmal.';
    case 'KOPPELN_BELEGT': return 'Dieser Code wurde schon benutzt. Zeigen Sie auf dem anderen Gerät einen neuen an.';
    case 'KOPPELN_ABGELAUFEN': return 'Auf dem anderen Gerät wurde nichts bestätigt, und der Code ist abgelaufen. '
      + 'Prüfen Sie, dass Sie sich auf beiden Geräten mit demselben Google-Konto angemeldet haben und dass das andere Gerät entsperrt ist und Internet hat. Dann zeigen Sie dort einen neuen Code an.';
    case 'KOPPELN_FALSCH': return 'Die Antwort des anderen Geräts passt nicht zu diesem Code. Zeigen Sie dort einen neuen Code an und scannen Sie ihn noch einmal.';
    case 'NEU_ANMELDEN': return 'Die Anmeldung bei Google gilt nicht mehr. Melden Sie sich bitte neu an; Ihre Daten bleiben dabei, wie sie sind.';
    default: return e?.message || 'Das Verbinden hat nicht geklappt.';
  }
}

/** Der QR-Code als Zeichnung: immer schwarz auf weiß mit Rand, auch im dunklen Thema, damit Kameras ihn sicher lesen. */
function qrZeichnung(text, beschreibung) {
  const qr = qrCode(text, { stufe: 'M' });
  const ruhe = 4;
  const n = qr.groesse + 2 * ruhe;
  const rects = laeufe(qr.module).map((l) => `<rect x="${l.x + ruhe}" y="${l.y + ruhe}" width="${l.b}" height="1"/>`).join('');
  return `<svg class="kopplung-qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${esc(beschreibung)}">
    <rect width="${n}" height="${n}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

const minutenText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* -------------------------------------------------------------------------- */
/* Am offenen Gerät: QR-Code zeigen                                            */
/* -------------------------------------------------------------------------- */

/**
 * „Neues Gerät hinzufügen“. Zeigt den QR-Code, wartet auf das neue Gerät, lässt
 * den Nutzer es erkennen und bestätigen. Ein Ende, egal wie, löscht alles.
 * @returns {Promise<{name:string}|null>} das verbundene Gerät, sonst null
 */
export async function geraetHinzufuegen() {
  if (store.nutzer && !darf(store.nutzer.rolle, 'geraet.koppeln')) { err('Nicht erlaubt', verbotText(store.nutzer.rolle)); return null; }
  const st = await api.cloud.status().catch(() => ({}));
  if (!st.linked) { err('Noch nicht mit Google verbunden', 'Verbinden Sie Kontovia zuerst in den Einstellungen unter Cloud mit Ihrem Google-Konto.'); return null; }

  return new Promise((resolve) => {
    let ergebnis = null;
    let timer = null;
    let tick = null;
    let bis = 0;
    let beendet = false;
    let bestaetigt = false;
    const m = modal({
      title: 'Neues Gerät hinzufügen',
      size: 'slim',
      body: '<p class="mt0 muted">Einen Moment …</p>',
      foot: '<button class="btn" data-abbrechen>Abbrechen</button>',
      onClose: () => { beendet = true; clearInterval(timer); clearInterval(tick); api.koppeln.abbrechen().catch(() => {}); resolve(ergebnis); },
    });
    // Das Bildschirmfoto der Rückmeldung soll den Code nie erfassen.
    m.root.setAttribute('data-ohne-foto', '');
    const zeigen = (body, foot) => { m.body.innerHTML = body; m.foot.innerHTML = foot; };
    const schliessen = () => m.close();
    const fussAbbrechen = '<button class="btn" data-abbrechen>Abbrechen</button>';
    const verdrahten = () => {
      m.foot.querySelector('[data-abbrechen]')?.addEventListener('click', schliessen);
      m.foot.querySelector('[data-fertig]')?.addEventListener('click', schliessen);
      m.foot.querySelector('[data-neu]')?.addEventListener('click', () => starten());
    };
    const fehler = (text) => {
      clearInterval(timer); clearInterval(tick);
      zeigen(`<div class="notice warn mb0" role="alert">${esc(text)}</div>`,
        '<button class="btn" data-abbrechen>Schließen</button><button class="btn primary" data-neu>Neuen Code anzeigen</button>');
      verdrahten();
    };

    async function starten() {
      clearInterval(timer); clearInterval(tick);
      zeigen('<p class="mt0 muted">Einen Moment …</p>', fussAbbrechen);
      verdrahten();
      let r;
      try { r = await api.koppeln.start(); } catch (e) { if (!beendet) fehler(e.message); return; }
      if (beendet) { api.koppeln.abbrechen().catch(() => {}); return; }
      bis = r.gueltigBis;
      zeigen(html`
        <ol class="kopplung-schritte">
          <li>Öffnen Sie Kontovia auf dem neuen Gerät und melden Sie sich mit demselben Google-Konto an${st.email ? raw(` (<strong>${esc(st.email)}</strong>)`) : ''}.</li>
          <li>Scannen Sie dort diesen Code mit der Kamera, in Kontovia über „QR-Code scannen“ oder mit der Kamera-App Ihres Handys.</li>
        </ol>
        ${raw(qrZeichnung(r.adresse, `QR-Code zum Verbinden eines neuen Geräts. Alternativ der Code ${r.anzeige}`))}
        <p class="small muted mt8" style="text-align:center;margin-bottom:4px">Oder den Code von Hand eingeben:</p>
        <div class="kopplung-code" id="kpCode">${raw(esc(r.anzeige))}</div>
        <p class="small muted mt8 mb0" style="text-align:center">Der Code gilt noch <strong id="kpRest">${raw(minutenText(bis - Date.now()))}</strong>.
        Zeigen Sie ihn niemandem und fotografieren Sie ihn nicht.</p>
        <div class="sr-only" role="status" aria-live="polite" id="kpStatus">Warte auf das neue Gerät.</div>`,
      fussAbbrechen);
      verdrahten();
      tick = setInterval(() => {
        const rest = $('#kpRest', m.body);
        if (rest) rest.textContent = minutenText(bis - Date.now());
      }, 1000);
      timer = setInterval(abfragen, 2000);
    }

    let laeuft = false;
    async function abfragen() {
      if (laeuft || beendet) return;
      laeuft = true;
      try {
        const s = await api.koppeln.abfragen();
        if (beendet) return;
        if (s.zustand === 'anfrage') anfrageZeigen(s);
        else if (s.zustand === 'fertig') await fertigZeigen(s);
        else if (s.zustand === 'abgelaufen') fehler('Der Code ist abgelaufen. Zeigen Sie einen neuen an.');
        else if (s.zustand === 'fehlgeschlagen') unklar(s.name);
        else if (s.zustand === 'keiner') fehler('Die Verbindung wurde unterbrochen, zum Beispiel weil Kontovia zwischendurch gesperrt war. Zeigen Sie einen neuen Code an.');
        else if (s.zustand === 'ungueltig') fehler('Eine Anfrage passte nicht zu diesem Code. Zur Sicherheit wurde alles gelöscht. Prüfen Sie auch Datum und Uhrzeit beider Geräte und zeigen Sie dann einen neuen Code an.');
      } catch (e) {
        if (e.code === 'GESPERRT') { m.close(); return; }
        // Nach der Freigabe hängt der Erfolg am neuen Gerät: ein einzelner Aussetzer ist kein Grund, abzubrechen.
        if (!bestaetigt) fehler(koppelnFehlerText(e));
      } finally { laeuft = false; }
    }

    /**
     * Das neue Gerät hat sich nicht eindeutig zurückgemeldet. Das heißt nicht, dass es misslang: Oft
     * hat das Gerät die Buchhaltung schon geladen. Der Nutzer sieht dort nach und sagt es uns.
     */
    function unklar(name) {
      clearInterval(timer); clearInterval(tick);
      zeigen(html`
        <div class="notice warn" role="alert"><strong>Kontovia konnte nicht sicher feststellen, ob es geklappt hat.</strong></div>
        <p style="line-height:1.6">Sehen Sie auf dem neuen Gerät nach. Zeigt es Ihre Buchhaltung, ist es verbunden, und Sie können es hier in die Liste aufnehmen. Zeigt es sie nicht, zeigen Sie einen neuen Code an.</p>`,
      '<button class="btn" data-neu>Neuen Code anzeigen</button><button class="btn primary" data-doch>Ja, es ist verbunden</button>');
      verdrahten();
      m.foot.querySelector('[data-doch]').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          const g = await api.koppeln.vermerken(name || 'Neues Gerät');
          await fertigZeigen({ geraet: g, name: g.name });
        } catch (e) { fehler(koppelnFehlerText(e)); }
      });
    }

    let angezeigt = '';
    function anfrageZeigen(s) {
      clearInterval(tick);
      if (angezeigt === s.seit) return;
      angezeigt = s.seit;
      zeigen(html`
        <p class="mt0" style="line-height:1.6">Ein Gerät möchte sich mit Ihrer Buchhaltung verbinden:</p>
        <div class="signin-box mb16"><div><strong>${s.name}</strong>
          <div class="small muted">meldet sich seit ${fmtDateTime(s.seit)}</div></div></div>
        <p class="small muted mb0" style="line-height:1.6">Ist das Ihr Gerät, das Sie gerade in der Hand haben? Dann bestätigen Sie. Das Gerät kann danach Ihre
        gesamte Buchhaltung öffnen. Kennen Sie es nicht, wählen Sie „Das bin nicht ich“.</p>
        <div class="sr-only" role="status" aria-live="assertive">Ein Gerät möchte sich verbinden: ${s.name}</div>`,
      '<button class="btn danger" data-nein>Das bin nicht ich</button><button class="btn primary" data-ja>Ja, verbinden</button>');
      m.foot.querySelector('[data-nein]').addEventListener('click', schliessen);
      m.foot.querySelector('[data-ja]').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          await api.koppeln.bestaetigen();
          bestaetigt = true;
          zeigen(html`<p class="mt0" style="line-height:1.6">Bestätigt. Das neue Gerät lädt jetzt Ihre Buchhaltung …</p>${raw('<div class="bar-track upd-warten mt16"><div class="bar-fill"></div></div>')}
            <div class="sr-only" role="status" aria-live="polite">Bestätigt. Das neue Gerät lädt.</div>`, fussAbbrechen);
          verdrahten();
        } catch (e) { fehler(koppelnFehlerText(e)); }
      });
      m.foot.querySelector('[data-ja]').focus();
    }

    async function fertigZeigen(s) {
      clearInterval(timer); clearInterval(tick);
      const g = s.geraet || { id: '', name: s.name };
      ergebnis = { name: g.name };
      // Ins Änderungsjournal: wer wann welches Gerät verbunden hat. Nichts Geheimes.
      try { await commit('geraet.koppeln', () => null, { entity: 'geraet', entityId: g.id, summary: `Gerät „${g.name}“ verbunden` }); } catch { /* das Verbinden gilt trotzdem */ }
      zeigen(html`
        <div class="notice ok" role="status"><strong>Fertig, „${g.name}“ ist verbunden.</strong><br>
        Das Gerät hat Ihre Buchhaltung geladen. Künftig gleichen beide Geräte über Ihr Google-Konto ab.</div>
        <p class="small muted mb0" style="line-height:1.6">Bedenken Sie: Ein verbundenes Gerät kann Ihre Buchhaltung dauerhaft öffnen, solange es entsperrt ist.
        Schützen Sie es mit einer Bildschirmsperre. Geht es verloren, lässt sich sein Zugang derzeit nicht einzeln zurückrufen.</p>`,
      '<button class="btn primary" data-fertig>Fertig</button>');
      verdrahten();
    }

    verdrahten();
    starten();
  });
}

/* -------------------------------------------------------------------------- */
/* Am neuen Gerät: Code scannen oder eingeben                                  */
/* -------------------------------------------------------------------------- */

/**
 * Das Fenster am neuen Gerät. Liefert den geöffneten Bestand, oder null, wenn der
 * Nutzer abbricht (dann bleibt das Passwort als Weg).
 * @returns {Promise<object|null>}
 */
export async function mitCodeVerbinden() {
  let [info, bereit, kamera] = await Promise.all([
    api.app.info().catch(() => ({})),
    api.koppeln.codeBereit().catch(() => false),
    scannerMoeglich(),
  ]);
  return new Promise((resolve) => {
    let fertig = false;
    let leser = null;
    let laeuft = false;
    const ende = (wert) => { if (fertig) return; fertig = true; leser?.stoppen(); resolve(wert); };
    const m = modal({
      title: 'Mit Ihrem anderen Gerät verbinden',
      size: 'slim',
      body: '',
      foot: ' ',
      onClose: () => { leser?.stoppen(); if (laeuft) api.koppeln.verbindenAbbrechen().catch(() => {}); ende(null); },
    });
    m.root.setAttribute('data-ohne-foto', '');
    const zeigen = (body, foot) => { m.body.innerHTML = body; m.foot.innerHTML = foot; };
    const fussPasswort = '<button class="btn" data-passwort>Stattdessen Passwort eingeben</button>';
    const passwortWeg = () => m.foot.querySelector('[data-passwort]')?.addEventListener('click', () => m.close());

    async function verbinden(code) {
      if (laeuft) return;
      const name = ($('#kpName', m.body)?.value || '').trim() || info.browser || 'Neues Gerät';
      leser?.stoppen();
      leser = null;
      laeuft = true;
      zeigen(html`
        <p class="mt0" style="line-height:1.6"><strong>Bestätigen Sie jetzt auf Ihrem anderen Gerät</strong>, dass sich „${name}“ verbinden darf.</p>
        <div class="bar-track upd-warten mt16"><div class="bar-fill"></div></div>
        <p class="small muted mt16 mb0" style="line-height:1.6">Das dauert höchstens ein paar Minuten. Das andere Gerät muss entsperrt sein und Internet haben.</p>
        <div class="sr-only" role="status" aria-live="polite">Warte auf die Bestätigung am anderen Gerät.</div>`,
      '<button class="btn" data-stop>Abbrechen</button>');
      m.foot.querySelector('[data-stop]').addEventListener('click', () => { api.koppeln.verbindenAbbrechen().catch(() => {}); });
      try {
        const db = await api.koppeln.verbinden({ code, name });
        laeuft = false;
        ende(db);
        m.close();
      } catch (e) {
        laeuft = false;
        if (fertig) return;
        if (e.code === 'ABGEBROCHEN') { start(); return; }
        // Ein endgültig misslungener Code ist in der Web-Schicht schon vergessen.
        if (/^KOPPELN_/.test(e.code || '')) bereit = false;
        start(koppelnFehlerText(e));
      }
    }

    function eingabeAbsenden() {
      const wert = ($('#kpEingabe', m.body)?.value || '').trim();
      if (!wert) return;
      verbinden(wert);
    }

    function start(meldung = '') {
      zeigen(html`
        ${meldung ? raw(`<div class="notice warn" role="alert">${esc(meldung)}</div>`) : ''}
        <p class="mt0" style="line-height:1.6">Auf Ihrem anderen Gerät, auf dem Kontovia schon läuft: <strong>Einstellungen, Sicherheit, „Neues Gerät hinzufügen“</strong>.
        Dort erscheint ein QR-Code.</p>
        <div class="field"><label for="kpName">Name dieses Geräts</label>
          <input id="kpName" value="${info.browser || ''}" maxlength="40" autocomplete="off">
          <span class="hint">Damit erkennen Sie dieses Gerät auf dem anderen wieder. Er wird nur verschlüsselt übertragen.</span></div>
        <div id="kpKamera"></div>
        <details class="forgot small mt8" ${kamera ? '' : 'open'}>
          <summary>Code von Hand eingeben</summary>
          <div class="field mt8"><label for="kpEingabe">Code vom anderen Gerät</label>
            <input id="kpEingabe" placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WX" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-family:var(--mono);letter-spacing:.06em">
          </div>
          <button class="btn mt8" id="kpAbsenden">Verbinden</button>
        </details>`,
      fussPasswort);
      passwortWeg();
      $('#kpAbsenden', m.body).addEventListener('click', eingabeAbsenden);
      $('#kpEingabe', m.body).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); eingabeAbsenden(); } });
      const kasten = $('#kpKamera', m.body);
      if (bereit) {
        kasten.innerHTML = `<div class="notice ok"><strong>Der Code liegt bereit.</strong> Ihre Kamera-App hat ihn an Kontovia übergeben.</div>
          <button class="btn primary block" id="kpGeschafft">Jetzt verbinden</button>`;
        $('#kpGeschafft', m.body).addEventListener('click', () => verbinden(''));
      } else if (kamera) {
        kasten.innerHTML = `<button class="btn primary block" id="kpScan">${icon('eye', 16).__raw} QR-Code scannen</button>`;
        $('#kpScan', m.body).addEventListener('click', kameraAn);
      } else {
        kasten.innerHTML = `<div class="notice">Dieser Browser kann den QR-Code nicht selbst lesen. Öffnen Sie die <strong>Kamera-App</strong> Ihres Handys und halten Sie sie auf den Code:
          Sie öffnet Kontovia mit dem Code. Oder geben Sie den Code unten von Hand ein.</div>`;
      }
    }

    async function kameraAn() {
      const kasten = $('#kpKamera', m.body);
      kasten.innerHTML = `<video class="kopplung-video" id="kpVideo" aria-label="Kamerabild zum Scannen des QR-Codes" playsinline muted></video>
        <p class="small muted mt8 mb0" style="text-align:center">Halten Sie die Kamera auf den QR-Code auf Ihrem anderen Gerät.</p>`;
      try {
        leser = await scannerStarten($('#kpVideo', m.body), (text) => {
          // Nur Kontovia-Codes zählen; alles andere wird übergangen und weiter gesucht.
          if (!/koppeln=|^[A-Za-z2-9-\s]{26,40}$/.test(text)) return false;
          // Dasselbe Bild kann mehrmals erkannt werden: verbunden wird nur einmal.
          if (!laeuft) verbinden(text);
          return true;
        });
      } catch (e) {
        start(koppelnFehlerText(e));
      }
    }

    start();
  });
}

/**
 * Nach dem Verbinden am neuen Gerät: Entsperren ohne Scannen. Bevorzugt Fingerabdruck oder
 * Gesicht; sonst gilt das Passwort. Es wird nie etwas Ungeschütztes auf dem Gerät abgelegt.
 */
export async function nachDemVerbinden() {
  const s = await api.entsperrung.status().catch(() => null);
  const bio = s?.biometrie;
  const kannBio = !!(bio?.moeglich && bio.geraet !== false && !bio.eingerichtet);
  return new Promise((resolve) => {
    const m = modal({
      title: 'Fertig, dieses Gerät ist verbunden',
      size: 'slim',
      body: html`<p class="mt0" style="line-height:1.6">Ihre Buchhaltung liegt jetzt auf diesem Gerät. Sie müssen den Code nicht noch einmal scannen.</p>
        <p class="small muted mb0" style="line-height:1.6">${kannBio
    ? 'Beim nächsten Start können Sie Kontovia mit Fingerabdruck oder Gesicht öffnen, wenn Sie das jetzt einschalten. Sonst geben Sie das Passwort ein.'
    : 'Beim nächsten Start geben Sie das Passwort Ihrer Buchhaltung ein.'}</p>`,
      foot: kannBio
        ? '<button class="btn" data-spaeter>Später</button><button class="btn primary" data-bio>Mit Fingerabdruck oder Gesicht öffnen</button>'
        : '<button class="btn primary" data-spaeter>Weiter</button>',
      onClose: () => resolve(),
    });
    m.foot.querySelector('[data-spaeter]').addEventListener('click', () => m.close());
    m.foot.querySelector('[data-bio]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try { await api.entsperrung.biometrieEinrichten(); ok('Eingeschaltet', 'Beim nächsten Sperren können Sie mit Fingerabdruck oder Gesicht entsperren.'); m.close(); } catch (e) {
        ev.currentTarget.disabled = false;
        if (e.code !== 'ABGEBROCHEN') err('Nicht geklappt', `${e.message} Das Passwort funktioniert weiterhin.`);
      }
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Einstellungen → Weitere Geräte                                              */
/* -------------------------------------------------------------------------- */

/** Die Karte „Weitere Geräte“: hinzufügen und die Liste der verbundenen Geräte. */
export async function geraeteKarte(host) {
  const [st, liste] = await Promise.all([
    api.cloud.status().catch(() => ({})),
    api.koppeln.geraete().catch(() => []),
  ]);
  if (!host.isConnected) return;
  const verbunden = !!st.linked;
  host.innerHTML = `
    <div class="card-head"><h3>${icon('users', 16).__raw} Weitere Geräte</h3><span class="sub">Handy, Tablet oder zweiter Rechner</span></div>
    <div class="card-body">
      <p class="mt0 small muted" style="line-height:1.6">${verbunden
    ? 'Öffnen Sie Ihre Buchhaltung auch auf einem anderen Gerät: Dort melden Sie sich mit demselben Google-Konto an und scannen einen QR-Code, den Sie hier anzeigen. Weder wir noch Google können Ihre Buchhaltung dabei lesen.'
    : 'Verbinden Sie Kontovia zuerst in den Einstellungen unter Cloud mit Ihrem Google-Konto. Danach können Sie hier weitere Geräte hinzufügen.'}</p>
      ${liste.length ? `<div class="nutzer-tabelle mb16">${liste.map((g) => `
        <div class="zugang-zeile" data-geraet="${esc(g.id)}">
          <div><strong>${esc(g.name)}</strong><div class="small muted">verbunden am ${esc(fmtDateTime(g.seit))}</div></div>
          <button class="btn sm ghost" data-entfernen>Aus der Liste entfernen</button>
        </div>`).join('')}</div>` : ''}
      <div class="row wrap" style="gap:8px">
        <button class="btn ${liste.length ? '' : 'primary'}" id="kgNeu" ${verbunden ? '' : 'disabled'}>${icon('plus', 15).__raw} Neues Gerät hinzufügen</button>
      </div>
      <div class="notice warn mt16 mb0">
        <strong>Gut zu wissen.</strong> Ein verbundenes Gerät kann Ihre Buchhaltung dauerhaft öffnen, solange es entsperrt ist. Auch wenn Sie es hier aus der Liste nehmen:
        Das Gerät behält, was es schon geladen hat. Einen einzelnen Zugang zurückrufen kann Kontovia derzeit nicht. Schützen Sie Ihre Geräte deshalb mit einer
        Bildschirmsperre. Die Liste zeigt nur Geräte, die Sie von diesem Gerät aus verbunden haben.
      </div>
    </div>`;
  $('#kgNeu', host)?.addEventListener('click', async () => {
    await geraetHinzufuegen();
    geraeteKarte(host);
  });
  host.querySelectorAll('[data-geraet]').forEach((z) => {
    const g = liste.find((x) => x.id === z.dataset.geraet);
    z.querySelector('[data-entfernen]').addEventListener('click', async () => {
      if (!await entfernenFrage(g)) return;
      try {
        await api.koppeln.geraetEntfernen(g.id);
        await commit('geraet.entfernen', () => null, { entity: 'geraet', entityId: g.id, summary: `Gerät „${g.name}“ aus der Liste entfernt` });
        ok('Aus der Liste entfernt', g.name);
      } catch (e) { err('Nicht entfernt', e.message); }
      geraeteKarte(host);
    });
  });
}

function entfernenFrage(g) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: `„${g.name}“ aus der Liste entfernen?`,
      size: 'slim',
      body: html`<p class="mt0" style="line-height:1.6">Das Gerät verschwindet nur aus dieser Liste. Es kann seine geladene Buchhaltung weiter öffnen und sich weiter mit Ihrem Google-Konto abgleichen.</p>
        <div class="notice warn mb0">Ist das Gerät verloren oder gestohlen, schützt es nur seine eigene Sperre (Passwort, Fingerabdruck, Bildschirmsperre). Einen einzelnen Zugang zurückrufen kann Kontovia derzeit nicht.</div>`,
      foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn danger" data-ja>Aus der Liste entfernen</button>',
      onClose: () => { if (!fertig) resolve(false); },
    });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { fertig = true; m.close(); resolve(false); });
    m.root.querySelector('[data-ja]').addEventListener('click', () => { fertig = true; m.close(); resolve(true); });
  });
}
