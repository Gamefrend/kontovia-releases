/**
 * Kontovia – Lizenzverwaltung im Admin-Bereich (nur für den Betreiber).
 *
 * Oben die Liste: jedes Konto, das sich mit Google angemeldet hat, und jede zugewiesene Lizenz, zusammengeführt
 * nach E-Mail-Adresse, mit Filter nach Zustand, Suche und Sortierung. Aus der Zeile heraus lässt sich eine Lizenz
 * verlängern (ab dem bisherigen Ende), ändern (Tarif, Ende) oder entziehen; „Lizenz zuweisen“ und „Geräteschein“
 * öffnen je ein Fenster. Der Schein wird im Browser mit privat.jwk signiert; das Konto holt ihn beim nächsten
 * Öffnen selbst ab (src/web/lizenz.js: abgleichen), ein Geräteschein wird nur angezeigt und weitergegeben.
 *
 * Darunter, eingeklappt, die Einrichtung: Signierschlüssel (Datei oder Cloud mit Passphrase) und die automatische
 * Lizenz der Cloud Function (Schlüssel auf dem Server, Testbetrieb). Speicher und Regeln: src/web/lizenzverwaltung.js,
 * firebase/storage.rules.
 *
 * Wie das Entwicklermenü wird diese Ansicht nirgends erwähnt (lib/feedback.js).
 */

import { html, raw, esc, $, $$, fmtDate, todayISO, addDays, daysBetween } from './util.js';
import { icon, ok, err, confirmDialog, modal } from './ui.js';
import { openMenu } from './popover.js';
import { lizenzStand } from './lizenz.js';
import { STUFEN_NAME } from './tarife.js';

const api = window.kontovia;

const tag = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : '');
const BEZAHLT = ['standard', 'pro', 'max'];
/** So viele Tage vor dem Ende gilt eine Lizenz als „läuft bald ab“ (steht so auch im Text der Kennzahlen). */
const BALD_TAGE = 30;

/** Laufzeiten zur Auswahl im Fenster (Tage ab dem Beginn). */
const LAUFZEITEN = [[30, '30 Tage'], [90, '3 Monate'], [365, '1 Jahr'], [730, '2 Jahre']];

/** Zustand eines Eintrags für Filter und Abzeichen. */
function zustandVon(e, heute = todayISO()) {
  const l = e.lizenz;
  if (!l) return 'ohne';
  if (l.entzogen) return 'entzogen';
  if (!l.echt) return 'ungueltig';
  const ende = String(l.bis || '').slice(0, 10);
  if (!ende || ende < heute) return 'abgelaufen';
  return daysBetween(heute, ende) <= BALD_TAGE ? 'bald' : 'gueltig';
}

const FILTER = [
  ['alle', 'Alle'], ['gueltig', 'Gültig'], ['bald', 'Läuft bald ab'], ['abgelaufen', 'Abgelaufen'],
  ['ohne', 'Ohne Lizenz'], ['auto', 'Automatisch'], ['entzogen', 'Entzogen'],
];

function passt(e, filter) {
  const z = zustandVon(e);
  if (filter === 'alle') return true;
  if (filter === 'gueltig') return z === 'gueltig' || z === 'bald';
  if (filter === 'auto') return !!e.lizenz?.automatisch;
  if (filter === 'abgelaufen') return z === 'abgelaufen' || z === 'ungueltig';
  return z === filter;
}

/** Wie es um eine zugewiesene Lizenz steht, als Abzeichen. */
function lizenzAbzeichen(e) {
  const l = e.lizenz;
  const name = STUFEN_NAME[l?.stufe] || l?.stufe || '';
  const auto = l?.automatisch ? html` <span class="badge">automatisch</span>` : '';
  switch (zustandVon(e)) {
    case 'ohne': return html`<span class="badge">keine Lizenz</span>`;
    case 'entzogen': return html`<span class="badge neg">entzogen</span>`;
    case 'ungueltig': return html`<span class="badge neg">ungültig</span>`;
    case 'abgelaufen': return html`<span class="badge neg">${name} abgelaufen</span>${raw(auto)}`;
    case 'bald': return html`<span class="badge warn">${name}</span>${raw(auto)}`;
    default: return html`<span class="badge pos">${name}</span>${raw(auto)}`;
  }
}

/** „noch 12 Tage“ / „seit 3 Tagen abgelaufen“ unter dem Datum. */
function restText(e) {
  const ende = String(e.lizenz?.bis || '').slice(0, 10);
  if (!ende || !e.lizenz?.echt || e.lizenz.entzogen) return '';
  const n = daysBetween(todayISO(), ende);
  if (n === -1) return 'seit 1 Tag abgelaufen';
  if (n < 0) return `seit ${-n} Tagen abgelaufen`;
  if (n === 0) return 'endet heute';
  return n === 1 ? 'noch 1 Tag' : `noch ${n} Tage`;
}

const seitVon = (e) => (e.konten.length ? e.konten.map((k) => k.seit).sort()[0] : '');

const SORTIERUNG = {
  email: (a, b) => a.email.localeCompare(b.email),
  seit: (a, b) => String(seitVon(b)).localeCompare(String(seitVon(a))),
  lizenz: (a, b) => (BEZAHLT.indexOf(b.lizenz?.stufe) - BEZAHLT.indexOf(a.lizenz?.stufe)) || a.email.localeCompare(b.email),
  bis: (a, b) => String(a.lizenz?.bis || '9999').localeCompare(String(b.lizenz?.bis || '9999')),
};

/** Zeichnet die Verwaltung in `host`. */
export async function lizenzVerwaltung(host) {
  let daten = null;
  let fehlerText = '';
  let suche = '';
  let filter = 'alle';
  let sortierung = 'seit';
  const testphase = !!lizenzStand()?.testphase;

  let schluesselDa = false;
  let cloud = { vorhanden: false, seit: '', fehler: '' };
  let server = { schluessel: false, schluesselSeit: '', testbetrieb: true, fehler: '' };

  async function standLaden() {
    const [da, c, s] = await Promise.all([
      api.lizenz.verwaltung.schluesselDa().catch(() => false),
      api.lizenz.verwaltung.schluesselCloud().then((x) => ({ ...x, fehler: '' }), (ex) => ({ vorhanden: false, seit: '', fehler: ex.message })),
      api.lizenz.verwaltung.serverStand().then((x) => ({ ...x, fehler: '' }), (ex) => ({ schluessel: false, schluesselSeit: '', testbetrieb: true, fehler: ex.message })),
    ]);
    schluesselDa = da;
    cloud = c;
    server = s;
  }

  /* ------------------------------ Kopfleiste ------------------------------ */

  function leisteZeichnen() {
    const feld = $('#lvLeiste', host);
    if (!feld) return;
    feld.innerHTML = html`
      <div class="lv-stand">
        <span class="lv-stand-teil"><span class="small muted">Signierschlüssel</span>
          ${raw(schluesselDa ? html`<span class="badge pos">geladen</span>` : html`<span class="badge warn">nicht geladen</span>`)}</span>
        <span class="lv-stand-teil"><span class="small muted">Automatische Lizenz</span>
          ${raw(server.fehler ? html`<span class="badge">unbekannt</span>` : server.schluessel ? html`<span class="badge pos">bereit</span>` : html`<span class="badge warn">ohne Schlüssel</span>`)}</span>
        <span class="lv-stand-teil"><span class="small muted">Testbetrieb</span>
          ${raw(server.testbetrieb ? html`<span class="badge warn">an: Max</span>` : html`<span class="badge">aus: Standard</span>`)}</span>
      </div>
      <div class="lv-knoepfe">
        <button type="button" class="btn primary" id="lvZuweisen">${icon('plus', 15)} Lizenz zuweisen</button>
        <button type="button" class="btn" id="lvGeraet">${icon('key', 15)} Geräteschein</button>
      </div>`;
    $('#lvZuweisen', feld).addEventListener('click', () => zuweisenDialog({ modus: 'neu' }));
    $('#lvGeraet', feld).addEventListener('click', geraetDialog);
  }

  /* ------------------------------ Einrichtung ----------------------------- */

  function schluesselZeichnen() {
    const feld = $('#lvSchluesselBereich', host);
    if (!feld) return;
    const cloudText = cloud.fehler
      ? html`<span class="small muted">${cloud.fehler}</span>`
      : cloud.vorhanden
        ? html`<span class="badge pos">in der Cloud gesichert</span> <span class="small muted">${tag(cloud.seit)}, verschlüsselt mit Ihrer Passphrase</span>`
        : html`<span class="badge">noch nicht in der Cloud</span>`;
    feld.innerHTML = html`
      <div class="row wrap gap8 mb8">${raw(schluesselDa
    ? html`<span class="badge pos">geladen</span> <span class="small muted">bis zum Sperren</span>`
    : html`<span class="badge warn">nicht geladen</span> <span class="small muted">Ohne ihn lassen sich keine Lizenzen zuweisen.</span>`)}</div>
      <div class="row wrap gap8 mb16">${raw(cloudText)}</div>
      <div class="form-grid">
        <div class="field full"><label for="lvPass">Passphrase für den Schlüssel in der Cloud</label>
          <input id="lvPass" type="password" autocomplete="off" spellcheck="false" minlength="12" placeholder="mindestens 12 Zeichen"></div>
      </div>
      <input type="file" id="lvDatei" accept=".jwk,application/json" hidden>
      <input type="file" id="lvDateiSichern" accept=".jwk,application/json" hidden>
      <div class="row wrap gap8 mb16">
        ${cloud.vorhanden ? raw(html`<button type="button" class="btn sm primary" id="lvAusCloud">${icon('key', 14)} Aus der Cloud laden</button>`) : ''}
        <button type="button" class="btn sm" id="lvDateiSichernWaehlen">${icon('key', 14)} ${cloud.vorhanden ? 'Datei wählen und in der Cloud ersetzen' : 'Datei wählen und in der Cloud sichern'}</button>
        <button type="button" class="btn sm ghost" id="lvDateiWaehlen">Nur diese Sitzung: Schlüsseldatei wählen</button>
        ${cloud.vorhanden ? raw('<button type="button" class="btn sm ghost danger-text" id="lvCloudLoeschen">Aus der Cloud löschen</button>') : ''}
      </div>
      <p class="small muted mt0">Die Schlüsseldatei aus der Einrichtung der Lizenzen. In der Cloud liegt sie nur verschlüsselt und nur für das Konto des Betreibers; ohne die Passphrase ist sie unbrauchbar. Die Passphrase wird nirgends gespeichert. Im Programm bleibt der Schlüssel nur im Arbeitsspeicher bis zum Sperren. Bewahren Sie die Datei zusätzlich offline auf.</p>`;

    const pass = () => $('#lvPass', host).value;
    const fertig = async () => { await standLaden(); allesStandZeichnen(); };
    const mit = (f) => async () => { try { await f(); } catch (ex) { err('Schlüssel nicht geladen', ex.message); } };

    const datei = $('#lvDatei', feld);
    $('#lvDateiWaehlen', feld).addEventListener('click', () => datei.click());
    datei.addEventListener('change', mit(async () => {
      const f = datei.files?.[0];
      datei.value = '';
      if (!f) return;
      await api.lizenz.verwaltung.schluessel(await f.text());
      ok('Schlüssel geladen');
      await fertig();
    }));

    const sichern = $('#lvDateiSichern', feld);
    $('#lvDateiSichernWaehlen', feld).addEventListener('click', () => {
      if ([...pass()].length < 12) { err('Passphrase fehlt', 'Bitte zuerst eine Passphrase mit mindestens 12 Zeichen eintragen.'); $('#lvPass', host).focus(); return; }
      sichern.click();
    });
    sichern.addEventListener('change', mit(async () => {
      const f = sichern.files?.[0];
      sichern.value = '';
      if (!f) return;
      await api.lizenz.verwaltung.schluesselSichern(await f.text(), pass());
      ok('Schlüssel in der Cloud gesichert', 'Verschlüsselt, nur mit Ihrer Passphrase zu öffnen');
      await fertig();
    }));

    $('#lvAusCloud', feld)?.addEventListener('click', mit(async () => {
      await api.lizenz.verwaltung.schluesselHolen(pass());
      ok('Schlüssel geladen');
      await fertig();
    }));

    $('#lvCloudLoeschen', feld)?.addEventListener('click', mit(async () => {
      if (!await confirmDialog({
        title: 'Schlüssel aus der Cloud löschen?',
        text: 'Danach brauchen Sie die Schlüsseldatei, um Lizenzen zuzuweisen. Ohne sie lassen sich keine neuen Scheine mehr ausstellen.',
        confirmLabel: 'Löschen', danger: true,
      })) return;
      await api.lizenz.verwaltung.schluesselCloudLoeschen();
      ok('Schlüssel aus der Cloud gelöscht');
      await fertig();
    }));
  }

  function serverZeichnen() {
    const feld = $('#lvServerBereich', host);
    if (!feld) return;
    const stand = server.fehler
      ? html`<span class="small muted">${server.fehler}</span>`
      : server.schluessel
        ? html`<span class="badge pos">Schlüssel auf dem Server</span> <span class="small muted">${tag(server.schluesselSeit)}</span>`
        : html`<span class="badge warn">kein Schlüssel auf dem Server</span> <span class="small muted">Ohne ihn vergibt der Server keine Lizenzen.</span>`;
    feld.innerHTML = html`
      <div class="row wrap gap8 mb16">${raw(stand)}</div>
      <input type="file" id="lvServerDatei" accept=".jwk,application/json" hidden>
      <div class="row wrap gap8 mb16">
        <button type="button" class="btn sm" id="lvServerHoch">${icon('key', 14)} ${server.schluessel ? 'Schlüsseldatei wählen und auf dem Server ersetzen' : 'Schlüsseldatei wählen und zum Server hochladen'}</button>
        ${server.schluessel ? raw('<button type="button" class="btn sm ghost danger-text" id="lvServerLoeschen">Vom Server löschen</button>') : ''}
      </div>
      <div class="field">
        <label id="lvModusName">Testbetrieb</label>
        <div class="seg" role="group" aria-labelledby="lvModusName" id="lvModus">
          <button type="button" data-modus="an" class="${server.testbetrieb ? 'active' : ''}" aria-pressed="${server.testbetrieb}">An: Konten ohne Lizenz bekommen Max</button>
          <button type="button" data-modus="aus" class="${server.testbetrieb ? '' : 'active'}" aria-pressed="${!server.testbetrieb}">Aus: Konten ohne Lizenz bekommen Standard</button>
        </div>
      </div>
      <p class="small muted mt0">Wer sich mit Google anmeldet und keine Lizenz hat, bekommt vom Server einen echten, signierten Schein. Von Hand zugewiesene Lizenzen bleiben, wie sie sind. Ein Konto wechselt beim nächsten Anmelden, wenn sich der Modus ändert. Der Schlüssel auf dem Server lässt sich nicht mehr auslesen, nur ersetzen oder löschen. Die Testphase im Programm selbst stellt der Betreiber getrennt um.</p>`;
    const datei = $('#lvServerDatei', feld);
    const mit = (f, titel) => async () => { try { await f(); } catch (ex) { err(titel, ex.message); } };
    const neu = async () => { await standLaden(); allesStandZeichnen(); };
    $('#lvServerHoch', feld).addEventListener('click', () => datei.click());
    datei.addEventListener('change', mit(async () => {
      const f = datei.files?.[0];
      datei.value = '';
      if (!f) return;
      await api.lizenz.verwaltung.serverSchluessel(await f.text());
      ok('Schlüssel auf dem Server gespeichert');
      await neu();
    }, 'Schlüssel nicht hochgeladen'));
    $('#lvServerLoeschen', feld)?.addEventListener('click', mit(async () => {
      if (!await confirmDialog({
        title: 'Schlüssel vom Server löschen?',
        text: 'Danach vergibt der Server keine Lizenzen mehr, bis wieder ein Schlüssel hochgeladen ist. Vorhandene Lizenzen bleiben gültig.',
        confirmLabel: 'Löschen', danger: true,
      })) return;
      await api.lizenz.verwaltung.serverSchluesselLoeschen();
      ok('Schlüssel vom Server gelöscht');
      await neu();
    }, 'Nicht gelöscht'));
    $$('[data-modus]', feld).forEach((b) => b.addEventListener('click', mit(async () => {
      const an = b.dataset.modus === 'an';
      if (an === server.testbetrieb) return;
      if (!await confirmDialog({
        title: an ? 'Testbetrieb einschalten?' : 'Testbetrieb ausschalten?',
        text: an
          ? 'Konten ohne zugewiesene Lizenz bekommen beim nächsten Anmelden Max.'
          : 'Konten ohne zugewiesene Lizenz bekommen beim nächsten Anmelden Standard statt Max.',
        confirmLabel: an ? 'Einschalten' : 'Ausschalten',
      })) return;
      await api.lizenz.verwaltung.serverModus(an);
      ok('Modus gespeichert', an ? 'Testbetrieb: Max' : 'Kein Testbetrieb: Standard');
      await neu();
    }, 'Modus nicht gespeichert')));
  }

  function allesStandZeichnen() {
    leisteZeichnen();
    schluesselZeichnen();
    serverZeichnen();
  }

  /* -------------------------------- Liste --------------------------------- */

  function kennzahlen() {
    const e = daten.eintraege;
    const gueltig = e.filter((x) => ['gueltig', 'bald'].includes(zustandVon(x)));
    const je = BEZAHLT.map((s) => [s, gueltig.filter((x) => x.lizenz.stufe === s).length]).filter(([, n]) => n);
    const bald = e.filter((x) => zustandVon(x) === 'bald').length;
    return html`<div class="lv-zahlen">
      <span><strong>${e.length}</strong> ${e.length === 1 ? 'Adresse' : 'Adressen'}</span>
      <span><strong>${gueltig.length}</strong> mit gültiger Lizenz</span>
      ${je.map(([s, n]) => raw(html`<span class="badge">${STUFEN_NAME[s]} ${n}</span>`))}
      ${bald ? raw(html`<span class="badge warn">${bald === 1 ? '1 Lizenz läuft in 30 Tagen ab' : `${bald} Lizenzen laufen in 30 Tagen ab`}</span>`) : ''}
    </div>`;
  }

  function liste() {
    const feld = $('#lvListe', host);
    if (!feld) return;
    if (fehlerText) { feld.innerHTML = html`<div class="notice warn mb16">${fehlerText}</div>`; return; }
    if (!daten) { feld.innerHTML = html`<p class="muted small">Lade …</p>`; return; }
    const s = suche.trim().toLowerCase();
    const zeilen = daten.eintraege
      .filter((e) => passt(e, filter))
      .filter((e) => !s || e.email.includes(s) || (e.lizenz?.notiz || '').toLowerCase().includes(s) || (e.lizenz?.id || '').toLowerCase().includes(s))
      .sort(SORTIERUNG[sortierung]);
    const kopf = (key, text) => html`<th ${raw(sortierung === key ? `aria-sort="${key === 'bis' || key === 'email' ? 'ascending' : 'descending'}"` : '')}>
      <button type="button" class="th-sort" data-sort="${key}">${text}${sortierung === key ? raw(icon('down', 12, 'ico th-arrow')) : ''}</button></th>`;
    feld.innerHTML = html`
      ${raw(kennzahlen())}
      ${zeilen.length ? raw(html`
        <div class="table-wrap"><table class="data compact lv-tabelle">
          <thead><tr>${raw(kopf('email', 'E-Mail-Adresse'))}${raw(kopf('seit', 'Angemeldet seit'))}${raw(kopf('lizenz', 'Lizenz'))}${raw(kopf('bis', 'Gültig bis'))}<th>Notiz</th><th class="right">Aktionen</th></tr></thead>
          <tbody>${zeilen.map((e) => raw(html`
            <tr data-email="${e.email}">
              <td translate="no">${e.email}</td>
              <td class="nowrap">${seitVon(e) ? tag(seitVon(e)) : raw('<span class="muted">noch nicht</span>')}</td>
              <td>${raw(lizenzAbzeichen(e))}</td>
              <td class="nowrap">${e.lizenz?.bis ? tag(e.lizenz.bis) : ''}${restText(e) ? raw(html`<div class="small muted">${restText(e)}</div>`) : ''}</td>
              <td class="small">${e.lizenz?.notiz || ''}${e.lizenz?.id ? raw(html`<div class="muted" translate="no">${e.lizenz.id}</div>`) : ''}</td>
              <td class="right nowrap">
                ${e.lizenz?.echt && !e.lizenz.entzogen ? raw('<button type="button" class="btn sm" data-lv-verlaengern>Verlängern</button>') : raw(`<button type="button" class="btn sm" data-lv-aendern>${e.lizenz?.entzogen ? 'Neu zuweisen' : 'Zuweisen'}</button>`)}
                <button type="button" class="icon-btn" data-lv-menue aria-haspopup="menu" aria-label="${`Weitere Aktionen für ${e.email}`}" title="Weitere Aktionen">${icon('more', 16)}</button>
              </td>
            </tr>`))}</tbody>
        </table></div>`) : raw(html`<p class="muted">${s || filter !== 'alle' ? 'Nichts gefunden.' : 'Noch hat sich niemand angemeldet.'}</p>`)}`;
  }

  async function laden() {
    daten = null;
    fehlerText = '';
    liste();
    try { daten = await api.lizenz.verwaltung.laden(); } catch (ex) { fehlerText = ex.message; }
    liste();
  }

  /* ------------------------------- Fenster -------------------------------- */

  /** Hinweis im Fenster, wenn der Schlüssel fehlt; mit einem Knopf, der zur Einrichtung springt. */
  const ohneSchluessel = () => (schluesselDa ? '' : html`<div class="notice warn mb16">Der Signierschlüssel ist nicht geladen. Laden Sie ihn unter „Einrichtung“, dann lässt sich die Lizenz ausstellen.
    <div class="mt8"><button type="button" class="btn sm" data-zur-einrichtung>Zur Einrichtung</button></div></div>`);

  function zurEinrichtung(m) {
    m.close();
    const d = $('#lvEinrichtung', host);
    d.open = true;
    d.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('#lvPass', host)?.focus();
  }

  /** Teil der Fenster für Tarif und Laufzeit. Gibt eine Funktion zurück, die {stufe, bis, schonfrist} liest. */
  function laufzeitTeil(wurzel, { stufe = 'max', basis = todayISO(), bis = '', schonfrist = 14 }) {
    const vorgabe = bis ? 'datum' : '365';
    wurzel.innerHTML = html`
      <div class="field"><label id="lvdStufeName">Tarif</label>
        <div class="seg" role="group" aria-labelledby="lvdStufeName" id="lvdStufe">
          ${BEZAHLT.map((s) => raw(html`<button type="button" data-stufe="${s}" class="${s === stufe ? 'active' : ''}" aria-pressed="${s === stufe}">${STUFEN_NAME[s]}</button>`))}
        </div></div>
      <div class="field"><label id="lvdLaufName">${basis !== todayISO() ? `Laufzeit ab ${tag(basis)}` : 'Laufzeit'}</label>
        <div class="seg" role="group" aria-labelledby="lvdLaufName" id="lvdLauf">
          ${LAUFZEITEN.map(([n, t]) => raw(html`<button type="button" data-lauf="${n}" class="${String(n) === vorgabe ? 'active' : ''}" aria-pressed="${String(n) === vorgabe}">${t}</button>`))}
          <button type="button" data-lauf="datum" class="${vorgabe === 'datum' ? 'active' : ''}" aria-pressed="${vorgabe === 'datum'}">Bis Datum</button>
        </div></div>
      <div class="form-grid">
        <div class="field" id="lvdDatumFeld" ${raw(vorgabe === 'datum' ? '' : 'hidden')}><label for="lvdDatum">Gültig bis</label>
          <input id="lvdDatum" type="date" min="${addDays(todayISO(), 1)}" max="${addDays(todayISO(), 3650)}" value="${bis || addDays(basis, 365)}"></div>
        <div class="field"><label for="lvdSchonfrist">Schonfrist in Tagen</label><input id="lvdSchonfrist" type="number" min="0" max="60" value="${schonfrist}"></div>
      </div>
      <p class="small mt0" id="lvdErgebnis" role="status"></p>`;
    let lauf = vorgabe;
    let st = stufe;
    const ende = () => (lauf === 'datum' ? $('#lvdDatum', wurzel).value : addDays(basis, Number(lauf)));
    const zeigen = () => {
      const e = ende();
      const n = e ? daysBetween(todayISO(), e) : 0;
      $('#lvdErgebnis', wurzel).textContent = e && n > 0 ? `${STUFEN_NAME[st]} gilt bis ${tag(e)}, das sind ${n} Tage ab heute.` : 'Bitte ein Datum in der Zukunft wählen.';
    };
    $$('[data-stufe]', wurzel).forEach((b) => b.addEventListener('click', () => {
      st = b.dataset.stufe;
      $$('[data-stufe]', wurzel).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      zeigen();
    }));
    $$('[data-lauf]', wurzel).forEach((b) => b.addEventListener('click', () => {
      lauf = b.dataset.lauf;
      $$('[data-lauf]', wurzel).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      $('#lvdDatumFeld', wurzel).hidden = lauf !== 'datum';
      zeigen();
    }));
    $('#lvdDatum', wurzel).addEventListener('input', zeigen);
    zeigen();
    return () => ({ stufe: st, bis: ende(), schonfrist: Number($('#lvdSchonfrist', wurzel).value) });
  }

  /**
   * Lizenz zuweisen, ändern oder verlängern.
   *   neu         leere Adresse, ein Jahr ab heute
   *   aendern     Tarif und Ende der bestehenden Lizenz vorbelegt
   *   verlaengern Laufzeit ab dem bisherigen Ende (nie vor heute)
   */
  function zuweisenDialog({ modus = 'neu', eintrag = null }) {
    const l = eintrag?.lizenz?.echt && !eintrag.lizenz.entzogen ? eintrag.lizenz : null;
    const altesEnde = String(l?.bis || '').slice(0, 10);
    const basis = modus === 'verlaengern' && altesEnde > todayISO() ? altesEnde : todayISO();
    const titel = { neu: 'Lizenz zuweisen', aendern: 'Lizenz ändern', verlaengern: 'Lizenz verlängern' }[modus];
    const m = modal({
      title: titel,
      body: html`${raw(ohneSchluessel())}
        <div class="field"><label for="lvdEmail">E-Mail-Adresse</label>
          <input id="lvdEmail" type="email" autocomplete="off" spellcheck="false" placeholder="name@beispiel.de" value="${eintrag?.email || ''}" ${raw(eintrag ? 'readonly' : '')}></div>
        ${l ? raw(html`<p class="small muted mt0">Bisher: ${STUFEN_NAME[l.stufe] || l.stufe} bis ${tag(l.bis)}. Die neue Lizenz ersetzt sie.</p>`) : ''}
        <div id="lvdLaufzeit"></div>
        <div class="field"><label for="lvdNotiz">Notiz</label><input id="lvdNotiz" maxlength="200" placeholder="z. B. Rechnung 2026-014" value="${l?.notiz || ''}"></div>
        <p class="small muted mt0">Das Konto übernimmt die Lizenz beim nächsten Öffnen. Bei Gmail gilt sie für gmail.com und googlemail.com.</p>
        <div class="err small" id="lvdFehler" role="alert"></div>`,
      foot: html`<button type="button" class="btn" data-no>Abbrechen</button><button type="button" class="btn primary" data-yes>${titel}</button>`,
    });
    const lesen = laufzeitTeil($('#lvdLaufzeit', m.root), {
      stufe: l?.stufe || 'max', basis, bis: modus === 'aendern' ? altesEnde : '', schonfrist: l?.schonfristTage ?? 14,
    });
    m.root.querySelector('[data-zur-einrichtung]')?.addEventListener('click', () => zurEinrichtung(m));
    m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-yes]').addEventListener('click', async (e) => {
      const knopf = e.currentTarget;
      const fehler = $('#lvdFehler', m.root);
      fehler.textContent = '';
      knopf.disabled = true;
      try {
        const r = await api.lizenz.verwaltung.zuweisen({ email: $('#lvdEmail', m.root).value, ...lesen(), notiz: $('#lvdNotiz', m.root).value });
        m.close();
        ok(modus === 'verlaengern' ? 'Lizenz verlängert' : 'Lizenz zugewiesen', `${STUFEN_NAME[r.stufe]} für ${r.email} bis ${tag(r.bis)}`);
        await laden();
      } catch (ex) {
        fehler.textContent = ex.message;
        knopf.disabled = false;
      }
    });
    (eintrag ? m.root.querySelector('[data-yes]') : $('#lvdEmail', m.root)).focus();
  }

  /** Geräteschein: gilt für die Kennung eines Geräts ohne Google-Konto; der Text wird nur angezeigt. */
  function geraetDialog() {
    const m = modal({
      title: 'Geräteschein ausstellen',
      body: html`${raw(ohneSchluessel())}
        <p class="small muted mt0">Für Kunden ohne Google-Konto. Die Kennung steht in deren Lizenzkarte unter „Lizenzschein ohne Google-Konto“. Der Schein gilt nur auf diesem Gerät.</p>
        <div class="field"><label for="lvdGeraet">Kennung des Geräts</label>
          <input id="lvdGeraet" autocomplete="off" spellcheck="false" placeholder="16 Zeichen, etwa 3fa9c01e7b2d4a58" translate="no"></div>
        <div id="lvdLaufzeit"></div>
        <div class="err small" id="lvdFehler" role="alert"></div>
        <div id="lvdSchein" hidden>
          <div class="field"><label for="lvdScheinText">Lizenzschein</label>
            <textarea id="lvdScheinText" rows="4" readonly spellcheck="false" translate="no"></textarea></div>
          <p class="small muted mt0" id="lvdScheinInfo"></p>
        </div>`,
      foot: html`<button type="button" class="btn" data-no>Schließen</button>
        <button type="button" class="btn" data-kopieren hidden>${icon('copy', 15)} Kopieren</button>
        <button type="button" class="btn primary" data-yes>Ausstellen</button>`,
    });
    const lesen = laufzeitTeil($('#lvdLaufzeit', m.root), { stufe: 'standard' });
    m.root.querySelector('[data-zur-einrichtung]')?.addEventListener('click', () => zurEinrichtung(m));
    m.root.querySelector('[data-no]').addEventListener('click', () => m.close());
    m.root.querySelector('[data-kopieren]').addEventListener('click', async () => {
      const t = $('#lvdScheinText', m.root);
      try { await navigator.clipboard.writeText(t.value); ok('Schein kopiert'); } catch { t.select(); err('Nicht kopiert', 'Markieren Sie den Schein und kopieren Sie ihn von Hand.'); }
    });
    m.root.querySelector('[data-yes]').addEventListener('click', async (e) => {
      const knopf = e.currentTarget;
      const fehler = $('#lvdFehler', m.root);
      fehler.textContent = '';
      knopf.disabled = true;
      try {
        const r = await api.lizenz.verwaltung.geraetSchein({ geraet: $('#lvdGeraet', m.root).value, ...lesen() });
        $('#lvdSchein', m.root).hidden = false;
        $('#lvdScheinText', m.root).value = r.schein;
        $('#lvdScheinInfo', m.root).textContent = `${STUFEN_NAME[r.stufe]} für das Gerät ${r.geraet} bis ${tag(r.bis)}, Nummer ${r.id}. Notieren Sie die Nummer, der Schein wird nirgends gespeichert.`;
        m.root.querySelector('[data-kopieren]').hidden = false;
        $('#lvdScheinText', m.root).select();
      } catch (ex) {
        fehler.textContent = ex.message;
      } finally {
        knopf.disabled = false;
      }
    });
    $('#lvdGeraet', m.root).focus();
  }

  async function entziehen(eintrag) {
    if (!await confirmDialog({
      title: 'Lizenz entziehen?',
      text: testphase
        ? `${eintrag.email} verliert die zugewiesene Lizenz. Solange die Testphase läuft, hat das Konto danach wieder Max wie jedes Konto ohne Lizenz, danach den kostenlosen Tarif. Eine automatische Lizenz bekommt es nicht mehr.`
        : `${eintrag.email} fällt beim nächsten Öffnen auf den kostenlosen Tarif zurück, ohne Netz spätestens nach 30 Tagen. Eine automatische Lizenz bekommt das Konto dann nicht mehr.`,
      confirmLabel: 'Entziehen', danger: true,
    })) return;
    try { await api.lizenz.verwaltung.entziehen(eintrag.email); ok('Lizenz entzogen', eintrag.email); await laden(); } catch (ex) { err('Nicht entzogen', ex.message); }
  }

  async function zuruecksetzen(eintrag) {
    try { await api.lizenz.verwaltung.entziehen(eintrag.email, true); ok('Zurückgesetzt', 'Das Konto bekommt beim nächsten Anmelden wieder die automatische Lizenz'); await laden(); } catch (ex) { err('Nicht zurückgesetzt', ex.message); }
  }

  async function ausListe(eintrag) {
    if (!await confirmDialog({
      title: 'Aus der Liste entfernen?',
      text: `Der Eintrag zu ${eintrag.email} wird aus der Liste gelöscht. Meldet sich das Konto wieder an, steht es wieder hier.`,
      confirmLabel: 'Entfernen', danger: true,
    })) return;
    try {
      for (const k of eintrag.konten) await api.lizenz.verwaltung.kontoEntfernen(k.uid);
      await laden();
    } catch (ex) { err('Nicht entfernt', ex.message); }
  }

  function zeilenMenue(anker, eintrag) {
    const gilt = eintrag.lizenz?.echt && !eintrag.lizenz.entzogen;
    const optionen = [
      gilt && { value: 'verlaengern', label: 'Verlängern', sub: 'ab dem bisherigen Ende' },
      { value: 'aendern', label: gilt ? 'Tarif oder Ende ändern' : 'Lizenz zuweisen' },
      eintrag.lizenz && !eintrag.lizenz.entzogen && { value: 'entziehen', label: 'Entziehen' },
      eintrag.lizenz?.entzogen && { value: 'zurueck', label: 'Zurücksetzen', sub: 'wieder automatische Lizenz' },
      eintrag.konten.length && !gilt && { value: 'liste', label: 'Aus der Liste entfernen' },
      { value: 'kopieren', label: 'Adresse kopieren' },
    ].filter(Boolean);
    openMenu(anker, {
      label: eintrag.email,
      align: 'end',
      sections: [{ key: 'a', value: '', options: optionen }],
      onPick: (_, wahl) => {
        if (wahl === 'verlaengern') zuweisenDialog({ modus: 'verlaengern', eintrag });
        else if (wahl === 'aendern') zuweisenDialog({ modus: gilt ? 'aendern' : 'neu', eintrag });
        else if (wahl === 'entziehen') entziehen(eintrag);
        else if (wahl === 'zurueck') zuruecksetzen(eintrag);
        else if (wahl === 'liste') ausListe(eintrag);
        else if (wahl === 'kopieren') navigator.clipboard.writeText(eintrag.email).then(() => ok('Adresse kopiert'), () => err('Nicht kopiert', eintrag.email));
      },
    });
  }

  /* ------------------------------- Aufbau --------------------------------- */

  host.innerHTML = html`
    <div class="tv-leiste lv-leiste mb16" id="lvLeiste"></div>
    <div class="notice mb16">${testphase
    ? 'Testphase: Jedes Konto ohne Lizenz hat Max. Zugewiesene Lizenzen gelten sofort, auch eine kleinere Stufe.'
    : 'Konten ohne Lizenz haben den kostenlosen Tarif. Eine zugewiesene Lizenz übernimmt das Konto beim nächsten Öffnen, eine entzogene fällt dann weg (ohne Netz spätestens nach 30 Tagen).'}</div>

    <section class="card mb16">
      <div class="card-head"><h2>Konten und Lizenzen</h2>
        <button type="button" class="btn sm ghost" id="lvNeu">${icon('refresh', 14)} Neu laden</button></div>
      <div class="card-body">
        <div class="lv-filter mb16">
          <div class="seg" role="group" aria-label="Nach Zustand filtern" id="lvFilter">
            ${FILTER.map(([k, t]) => raw(html`<button type="button" data-filter="${k}" class="${k === filter ? 'active' : ''}" aria-pressed="${k === filter}">${t}</button>`))}
          </div>
          <input id="lvSuche" type="search" placeholder="Adresse, Notiz oder Nummer suchen …" aria-label="Adresse, Notiz oder Nummer suchen">
        </div>
        <div id="lvListe"></div>
      </div>
    </section>

    <details class="card lv-einrichtung" id="lvEinrichtung">
      <summary class="card-head"><h2>Einrichtung</h2><span class="sub">Signierschlüssel und automatische Lizenz</span></summary>
      <div class="card-body">
        <h3 class="mt0">Signierschlüssel</h3>
        <div id="lvSchluesselBereich"></div>
        <h3>Automatische Lizenz</h3>
        <div id="lvServerBereich"></div>
      </div>
    </details>`;

  $('#lvSuche', host).addEventListener('input', (e) => { suche = e.target.value; liste(); });
  $('#lvNeu', host).addEventListener('click', laden);
  $$('[data-filter]', host).forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    $$('[data-filter]', host).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    liste();
  }));

  $('#lvListe', host).addEventListener('click', (e) => {
    const sort = e.target.closest('[data-sort]');
    if (sort) { sortierung = sort.dataset.sort; liste(); return; }
    const zeile = e.target.closest('tr[data-email]');
    const eintrag = zeile && daten?.eintraege.find((x) => x.email === zeile.dataset.email);
    if (!eintrag) return;
    if (e.target.closest('[data-lv-verlaengern]')) zuweisenDialog({ modus: 'verlaengern', eintrag });
    else if (e.target.closest('[data-lv-aendern]')) zuweisenDialog({ modus: 'neu', eintrag });
    else if (e.target.closest('[data-lv-menue]')) zeilenMenue(e.target.closest('[data-lv-menue]'), eintrag);
  });

  // Liste und Stand der Einrichtung laden gleichzeitig; die Liste wartet nicht auf den Server.
  liste();
  const stand = standLaden().then(() => {
    allesStandZeichnen();
    if (!schluesselDa) $('#lvEinrichtung', host).open = true;
  });
  await Promise.all([laden(), stand]);
}
