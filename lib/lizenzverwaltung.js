/**
 * Kontovia – Lizenzverwaltung im Entwicklermenü (nur für den Betreiber).
 *
 * Zeigt jedes Konto, das sich mit Google angemeldet hat, und jede zugewiesene Lizenz, zusammengeführt nach
 * E-Mail-Adresse. Hier weist der Betreiber einer Adresse einen Tarif mit Laufzeit zu (der Schein wird im
 * Browser mit privat.jwk signiert) oder entzieht ihn. Das Konto holt seinen Schein beim nächsten Öffnen selbst
 * ab (src/web/lizenz.js: abgleichen). Speicher und Regeln: src/web/lizenzverwaltung.js, firebase/storage.rules.
 *
 * Wie das Entwicklermenü wird diese Ansicht nirgends erwähnt (lib/feedback.js).
 */

import { html, raw, $, fmtDate } from './util.js';
import { icon, ok, err, confirmDialog } from './ui.js';
import { lizenzStand } from './lizenz.js';
import { STUFEN_NAME } from './tarife.js';

const api = window.kontovia;

const tag = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : '');

/** Wie es um eine zugewiesene Lizenz steht, als Abzeichen. */
function lizenzAbzeichen(l) {
  if (!l) return raw(html`<span class="badge">keine Lizenz</span>`);
  if (!l.echt) return raw(html`<span class="badge neg">ungültig</span>`);
  if (Date.parse(l.bis) < Date.now()) return raw(html`<span class="badge neg">${STUFEN_NAME[l.stufe] || l.stufe} abgelaufen</span>`);
  return raw(html`<span class="badge pos">${STUFEN_NAME[l.stufe] || l.stufe}</span>`);
}

/** Zeichnet die Verwaltung in `host`. */
export async function lizenzVerwaltung(host) {
  let daten = null;
  let fehlerText = '';
  let suche = '';
  const testphase = !!lizenzStand()?.testphase;

  let cloud = { vorhanden: false, seit: '', fehler: '' };

  /** Liegt ein verschlüsselter Schlüssel in der Cloud? Ohne Anmeldung des Betreibers bleibt die Meldung stehen. */
  async function cloudStand() {
    try { cloud = { ...(await api.lizenz.verwaltung.schluesselCloud()), fehler: '' }; } catch (ex) { cloud = { vorhanden: false, seit: '', fehler: ex.message }; }
  }

  /** Schlüsselbereich neu zeichnen: Stand, Passphrase und die Wege (aus der Cloud, aus der Datei, in der Cloud sichern). */
  async function schluesselZeichnen() {
    const feld = $('#lvSchluesselBereich', host);
    if (!feld) return;
    const da = await api.lizenz.verwaltung.schluesselDa().catch(() => false);
    const stand = da
      ? html`<span class="badge pos">geladen</span> <span class="small muted">bis zum Sperren</span>`
      : html`<span class="badge warn">nicht geladen</span> <span class="small muted">Ohne ihn lassen sich keine Lizenzen zuweisen.</span>`;
    const cloudText = cloud.fehler
      ? html`<span class="small muted">${cloud.fehler}</span>`
      : cloud.vorhanden
        ? html`<span class="badge pos">in der Cloud gesichert</span> <span class="small muted">${tag(cloud.seit)}, verschlüsselt mit deiner Passphrase</span>`
        : html`<span class="badge">noch nicht in der Cloud</span>`;
    feld.innerHTML = html`
      <div class="row wrap mb16" style="gap:8px">${raw(stand)}</div>
      <div class="row wrap mb16" style="gap:8px">${raw(cloudText)}</div>
      <div class="form-grid">
        <div class="field full"><label for="lvPass">Passphrase für den Schlüssel in der Cloud</label>
          <input id="lvPass" type="password" autocomplete="off" spellcheck="false" minlength="12" placeholder="mindestens 12 Zeichen"></div>
      </div>
      <input type="file" id="lvDatei" accept=".jwk,application/json" hidden>
      <input type="file" id="lvDateiSichern" accept=".jwk,application/json" hidden>
      <div class="row wrap mb16" style="gap:8px">
        ${cloud.vorhanden ? raw(html`<button type="button" class="btn sm primary" id="lvAusCloud">${icon('key', 14)} Aus der Cloud laden</button>`) : ''}
        <button type="button" class="btn sm" id="lvDateiSichernWaehlen">${icon('key', 14)} ${cloud.vorhanden ? 'Datei wählen und in der Cloud ersetzen' : 'Datei wählen und in der Cloud sichern'}</button>
        <button type="button" class="btn sm ghost" id="lvDateiWaehlen">Nur diese Sitzung: Schlüsseldatei wählen</button>
        ${cloud.vorhanden ? raw('<button type="button" class="btn sm ghost danger-text" id="lvCloudLoeschen">Aus der Cloud löschen</button>') : ''}
      </div>
      <p class="small muted mt0">Die Datei privat.jwk aus scripts/lizenz-schluessel.js. Der Schlüssel liegt in der Cloud nur verschlüsselt und nur für das Konto des Betreibers; ohne die Passphrase ist er unbrauchbar. Sie wird nirgends gespeichert, vergessen heißt: Datei erneut sichern. Im Programm bleibt der Schlüssel nur im Arbeitsspeicher bis zum Sperren. Die Datei privat.jwk zusätzlich offline sichern.</p>`;
    bindSchluessel();
  }

  function bindSchluessel() {
    const pass = () => $('#lvPass', host).value;
    const fertig = async () => { await cloudStand(); await schluesselZeichnen(); };
    const mit = (f) => async () => { try { await f(); } catch (ex) { err('Schlüssel nicht geladen', ex.message); } };

    const datei = $('#lvDatei', host);
    $('#lvDateiWaehlen', host).addEventListener('click', () => datei.click());
    datei.addEventListener('change', mit(async () => {
      const f = datei.files?.[0];
      datei.value = '';
      if (!f) return;
      await api.lizenz.verwaltung.schluessel(await f.text());
      ok('Schlüssel geladen');
      await fertig();
    }));

    const sichern = $('#lvDateiSichern', host);
    $('#lvDateiSichernWaehlen', host).addEventListener('click', () => {
      if ([...pass()].length < 12) { err('Passphrase fehlt', 'Bitte zuerst eine Passphrase mit mindestens 12 Zeichen eintragen.'); $('#lvPass', host).focus(); return; }
      sichern.click();
    });
    sichern.addEventListener('change', mit(async () => {
      const f = sichern.files?.[0];
      sichern.value = '';
      if (!f) return;
      await api.lizenz.verwaltung.schluesselSichern(await f.text(), pass());
      $('#lvPass', host).value = '';
      ok('Schlüssel in der Cloud gesichert', 'Verschlüsselt, nur mit deiner Passphrase zu öffnen');
      await fertig();
    }));

    $('#lvAusCloud', host)?.addEventListener('click', mit(async () => {
      await api.lizenz.verwaltung.schluesselHolen(pass());
      $('#lvPass', host).value = '';
      ok('Schlüssel geladen');
      await fertig();
    }));

    $('#lvCloudLoeschen', host)?.addEventListener('click', mit(async () => {
      if (!await confirmDialog({
        title: 'Schlüssel aus der Cloud löschen?',
        text: 'Danach brauchst du die Datei privat.jwk, um Lizenzen zuzuweisen. Ohne sie lassen sich keine neuen Scheine mehr ausstellen.',
        confirmLabel: 'Löschen', danger: true,
      })) return;
      await api.lizenz.verwaltung.schluesselCloudLoeschen();
      ok('Schlüssel aus der Cloud gelöscht');
      await fertig();
    }));
  }

  function liste() {
    const feld = $('#lvListe', host);
    if (!feld) return;
    if (fehlerText) {
      feld.innerHTML = html`<div class="notice warn mb16">${fehlerText}</div>`;
      return;
    }
    if (!daten) { feld.innerHTML = html`<p class="muted small">Lade …</p>`; return; }
    const s = suche.trim().toLowerCase();
    const zeilen = daten.eintraege.filter((e) => !s || e.email.includes(s) || (e.lizenz?.notiz || '').toLowerCase().includes(s));
    const mitLizenz = daten.eintraege.filter((e) => e.lizenz?.echt && Date.parse(e.lizenz.bis) >= Date.now()).length;
    feld.innerHTML = html`
      <p class="small muted mt0">${daten.eintraege.length} Adressen, davon ${mitLizenz} mit gültiger Lizenz.</p>
      ${zeilen.length ? raw(html`
        <div class="table-wrap"><table class="data compact">
          <thead><tr><th>E-Mail-Adresse</th><th>Angemeldet seit</th><th>Lizenz</th><th>Gültig bis</th><th>Notiz</th><th class="right">Aktionen</th></tr></thead>
          <tbody>${zeilen.map((e) => raw(html`
            <tr data-email="${e.email}">
              <td translate="no">${e.email}</td>
              <td class="nowrap">${e.konten.length ? tag(e.konten.map((k) => k.seit).sort()[0]) : raw('<span class="muted">noch nicht</span>')}</td>
              <td>${lizenzAbzeichen(e.lizenz)}</td>
              <td class="nowrap">${e.lizenz ? tag(e.lizenz.bis) : ''}</td>
              <td class="small">${e.lizenz?.notiz || ''}</td>
              <td class="right nowrap">
                <button type="button" class="btn sm ghost" data-lv-waehlen>${e.lizenz ? 'Ändern' : 'Zuweisen'}</button>
                ${e.lizenz ? raw('<button type="button" class="btn sm ghost danger-text" data-lv-entziehen>Entziehen</button>') : ''}
                ${e.konten.length && !e.lizenz ? raw('<button type="button" class="btn sm ghost" data-lv-konto>Aus der Liste entfernen</button>') : ''}
              </td>
            </tr>`))}</tbody>
        </table></div>`) : raw(html`<p class="muted">${s ? 'Nichts gefunden.' : 'Noch hat sich niemand angemeldet.'}</p>`)}`;
  }

  async function laden() {
    daten = null;
    fehlerText = '';
    liste();
    try { daten = await api.lizenz.verwaltung.laden(); } catch (ex) { fehlerText = ex.message; }
    liste();
  }

  host.innerHTML = html`
    <div class="notice mb16">${testphase
    ? 'Testphase: Jedes Konto hat Max, auch ohne Lizenz. Zugewiesene Lizenzen werden schon jetzt übernommen und gelten nach der Testphase.'
    : 'Konten ohne Lizenz haben den kostenlosen Tarif. Eine zugewiesene Lizenz übernimmt das Konto beim nächsten Öffnen, eine entzogene fällt dann weg (ohne Netz spätestens nach 30 Tagen).'}</div>

    <h2 class="mt0">Signierschlüssel</h2>
    <div id="lvSchluesselBereich"></div>

    <h2>Lizenz zuweisen</h2>
    <div class="form-grid">
      <div class="field"><label for="lvEmail">E-Mail-Adresse</label><input id="lvEmail" type="email" autocomplete="off" spellcheck="false" placeholder="name@beispiel.de"></div>
      <div class="field"><label for="lvStufe">Tarif</label><select id="lvStufe">
        <option value="standard">${STUFEN_NAME.standard}</option><option value="pro">${STUFEN_NAME.pro}</option><option value="max" selected>${STUFEN_NAME.max}</option>
      </select></div>
      <div class="field"><label for="lvTage">Laufzeit in Tagen</label><input id="lvTage" type="number" min="1" max="3660" value="365"></div>
      <div class="field"><label for="lvSchonfrist">Schonfrist in Tagen</label><input id="lvSchonfrist" type="number" min="0" max="60" value="14"></div>
      <div class="field full"><label for="lvNotiz">Notiz</label><input id="lvNotiz" maxlength="200" placeholder="z. B. Rechnung 2026-014"></div>
    </div>
    <div class="err small" id="lvFehler" role="alert"></div>
    <div class="row mb16" style="gap:8px"><button type="button" class="btn primary" id="lvZuweisen">Lizenz zuweisen</button></div>
    <p class="small muted mt0">Eine bestehende Lizenz derselben Adresse wird ersetzt. Bei Gmail gilt sie für gmail.com und googlemail.com.</p>

    <div class="row between wrap mb16" style="gap:8px">
      <h2 class="m0">Konten und Lizenzen</h2>
      <div class="row" style="gap:8px">
        <input id="lvSuche" type="search" placeholder="Adresse oder Notiz suchen …" aria-label="Adresse oder Notiz suchen">
        <button type="button" class="btn sm" id="lvNeu">${icon('refresh', 14)} Neu laden</button>
      </div>
    </div>
    <div id="lvListe"></div>`;

  $('#lvZuweisen', host).addEventListener('click', async (e) => {
    const knopf = e.currentTarget;
    const feld = $('#lvFehler', host);
    feld.textContent = '';
    const angaben = {
      email: $('#lvEmail', host).value, stufe: $('#lvStufe', host).value, tage: Number($('#lvTage', host).value),
      schonfrist: Number($('#lvSchonfrist', host).value), notiz: $('#lvNotiz', host).value,
    };
    knopf.disabled = true;
    try {
      const r = await api.lizenz.verwaltung.zuweisen(angaben);
      ok('Lizenz zugewiesen', `${STUFEN_NAME[r.stufe]} für ${r.email} bis ${tag(r.bis)}`);
      $('#lvNotiz', host).value = '';
      await laden();
    } catch (ex) {
      feld.textContent = ex.message;
    } finally {
      knopf.disabled = false;
    }
  });

  $('#lvSuche', host).addEventListener('input', (e) => { suche = e.target.value; liste(); });
  $('#lvNeu', host).addEventListener('click', laden);

  host.addEventListener('click', async (e) => {
    const zeile = e.target.closest('tr[data-email]');
    if (!zeile) return;
    const eintrag = daten?.eintraege.find((x) => x.email === zeile.dataset.email);
    if (!eintrag) return;
    if (e.target.closest('[data-lv-waehlen]')) {
      $('#lvEmail', host).value = eintrag.email;
      if (eintrag.lizenz?.stufe && eintrag.lizenz.stufe !== 'kostenlos') $('#lvStufe', host).value = eintrag.lizenz.stufe;
      $('#lvNotiz', host).value = eintrag.lizenz?.notiz || '';
      $('#lvEmail', host).scrollIntoView({ block: 'center', behavior: 'smooth' });
      $('#lvEmail', host).focus();
    } else if (e.target.closest('[data-lv-entziehen]')) {
      if (!await confirmDialog({
        title: 'Lizenz entziehen?',
        text: `${eintrag.email} fällt beim nächsten Öffnen auf den kostenlosen Tarif zurück, ohne Netz spätestens nach 30 Tagen.`,
        confirmLabel: 'Entziehen', danger: true,
      })) return;
      try { await api.lizenz.verwaltung.entziehen(eintrag.email); ok('Lizenz entzogen', eintrag.email); await laden(); } catch (ex) { err('Nicht entzogen', ex.message); }
    } else if (e.target.closest('[data-lv-konto]')) {
      if (!await confirmDialog({
        title: 'Aus der Liste entfernen?',
        text: `Der Eintrag zu ${eintrag.email} wird aus der Liste gelöscht.`,
        confirmLabel: 'Entfernen', danger: true,
      })) return;
      try {
        for (const k of eintrag.konten) await api.lizenz.verwaltung.kontoEntfernen(k.uid);
        await laden();
      } catch (ex) { err('Nicht entfernt', ex.message); }
    }
  });

  await schluesselZeichnen();
  await cloudStand();
  await schluesselZeichnen();
  await laden();
}

