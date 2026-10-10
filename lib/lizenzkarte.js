/**
 * Kontovia – Karte „Lizenz“ in den Einstellungen.
 *
 * Zeigt die Stufe des Kontos, wie lange die Lizenz gilt, die Kennung dieses Geräts (an sie ist ein
 * Lizenzschein gebunden), das Einlösen eines Scheins und, was jede Stufe enthält. In der Testphase gibt es
 * dazu eine Auswahl, mit der man eine kleinere Stufe ausprobieren kann. Geprüft wird der Schein in der
 * Web-Schicht (src/web/lizenz.js); hier ist nur die Darstellung.
 */

import { html, raw, esc, fmtDate } from './util.js';
import { icon, ok, err, confirmDialog } from './ui.js';
import { store } from './store.js';
import { lizenzStand, lizenzSetzen, lizenzLaden, stufeName, grenze, kann, rechnungenImMonat } from './lizenz.js';
import { tarifeOeffnen, krone } from './lizenzui.js';
import { STUFEN, STUFEN_NAME, FUNKTIONEN, GRENZEN_NAME } from './tarife.js';
import { aktiveBenutzer } from './rollen.js';

const api = window.kontovia;

const tag = (iso) => fmtDate(String(iso).slice(0, 10));

/** Ein Satz zum Zustand der Lizenz. */
function zustandText(s) {
  switch (s.zustand) {
    case 'testphase':
      return s.vorschau
        ? `Testphase: Sie probieren gerade ${STUFEN_NAME[s.vorschau]} aus. Mit „Max“ sind wieder alle Funktionen frei.`
        : 'Testphase: Während Kontovia getestet wird, sind alle Funktionen frei. Eine Lizenz brauchen Sie dafür nicht.';
    case 'lizenziert': return `Lizenz gültig bis ${tag(s.bis)}.`;
    case 'schonfrist': return `Die Lizenz ist am ${tag(s.bis)} abgelaufen und gilt noch bis ${tag(s.schonfristBis)}. Bitte verlängern Sie sie rechtzeitig.`;
    case 'abgelaufen': return `Die Lizenz ist abgelaufen. Das Konto hat jetzt ${STUFEN_NAME.kostenlos}. Ihre Daten bleiben da und lassen sich weiter ansehen und exportieren.`;
    case 'testphase-vorbei': return 'Die Testphase ist vorbei. Mit einem Lizenzschein geht es weiter, ohne ihn gilt der kostenlose Tarif.';
    default: return 'Es liegt kein Lizenzschein vor. Das Konto hat den kostenlosen Tarif.';
  }
}

/** Was jede Stufe zusätzlich enthält, als kurze Liste. */
function funktionsListe() {
  return STUFEN.slice(1).map((st) => {
    const namen = Object.entries(FUNKTIONEN).filter(([, f]) => f.ab === st);
    if (!namen.length) return '';
    return `<div class="lz-stufe"><strong>${esc(STUFEN_NAME[st])}</strong>
      <ul class="lz-liste">${namen.map(([id, f]) => `<li class="${kann(id) ? 'frei' : 'zu'}">${krone(id)} ${esc(f.name)}</li>`).join('')}</ul></div>`;
  }).join('');
}

/** Wie viel von den Grenzen ist belegt? */
function grenzenListe(db) {
  const belegt = {
    rechnungenMonat: rechnungenImMonat(db),
    geraete: null,
    benutzer: aktiveBenutzer(db).length,
    firmen: null,
  };
  return Object.keys(GRENZEN_NAME).map((was) => {
    const g = grenze(was);
    const dazu = belegt[was] !== null && g !== null ? `<span class="muted lz-aktuell">aktuell ${belegt[was]}</span>` : '';
    return `<li><span>${esc(GRENZEN_NAME[was][1])}</span><span class="lz-wert">${g === null ? 'unbegrenzt' : g}${dazu}</span></li>`;
  }).join('');
}

export async function lizenzKarte(host) {
  if (!lizenzStand()) await lizenzLaden();
  const s = lizenzStand();
  if (!host.isConnected || !s) return;
  const nochNeu = () => lizenzKarte(host);

  host.innerHTML = html`
    <div class="card-head"><h2>${icon('crown', 16)} Lizenz</h2><span class="sub">Tarif dieses Kontos</span></div>
    <div class="card-body">
      <div class="lz-kopf">
        <span class="lz-stufe-name"><span class="krone">${icon('crown', 18, 'ico krone-ico')}</span>${stufeName()}</span>
        ${s.zustand === 'testphase' ? raw('<span class="badge warn">Testphase</span>') : ''}
        ${s.zustand === 'lizenziert' ? raw('<span class="badge pos">gültig</span>') : ''}
        ${s.zustand === 'schonfrist' || s.zustand === 'abgelaufen' ? raw('<span class="badge neg">abgelaufen</span>') : ''}
      </div>
      <p class="mt8" style="line-height:1.6">${zustandText(s)}</p>
      ${s.testphase ? raw(`
        <div class="field mt16">
          <label id="lzVorschauName">Tarif ausprobieren</label>
          <div class="seg" role="group" aria-labelledby="lzVorschauName" id="lzVorschau">
            ${STUFEN.map((st) => `<button type="button" data-stufe="${st}" class="${(s.vorschau || 'max') === st ? 'active' : ''}" aria-pressed="${(s.vorschau || 'max') === st}">${esc(st === 'max' ? 'Max (alles)' : STUFEN_NAME[st])}</button>`).join('')}
          </div>
          <span class="hint">Nur in der Testphase: So sehen Sie, was in einem kleineren Tarif gesperrt ist. Premium-Funktionen tragen eine Krone.</span>
        </div>`) : ''}
      <div class="lz-spalten mt16">
        <div>
          <h3 class="lz-h">In diesem Tarif</h3>
          <ul class="lz-liste lz-grenzen">${raw(grenzenListe(store.db))}</ul>
        </div>
        <div>
          <h3 class="lz-h">Premium-Funktionen</h3>
          ${raw(funktionsListe())}
        </div>
      </div>
      <div class="field mt16">
        <label for="lzGeraet">Kennung dieses Geräts</label>
        <div class="row" style="gap:8px">
          <input id="lzGeraet" readonly value="${s.geraet}" style="font-family:var(--mono, monospace)" translate="no">
          <button type="button" class="btn" id="lzKopieren">${icon('copy', 15)} Kopieren</button>
        </div>
        <span class="hint">Ein Lizenzschein gilt für ein Gerät. Für den Schein brauchen wir diese Kennung.</span>
      </div>
      <div class="field">
        <label for="lzSchein">Lizenzschein</label>
        <textarea id="lzSchein" rows="3" placeholder="KV1.…" spellcheck="false" autocomplete="off" translate="no"></textarea>
        <div class="err small" id="lzFehler" role="alert"></div>
      </div>
      <div class="row wrap" style="gap:8px">
        <button type="button" class="btn primary" id="lzEinloesen">Lizenzschein einlösen</button>
        <button type="button" class="btn" id="lzTarife">Tarife ansehen</button>
        ${s.zustand === 'lizenziert' || s.zustand === 'schonfrist' || s.zustand === 'abgelaufen'
    ? raw('<button type="button" class="btn ghost" id="lzEntfernen">Lizenzschein entfernen</button>') : ''}
      </div>
    </div>`;

  host.querySelector('#lzTarife').addEventListener('click', tarifeOeffnen);
  host.querySelector('#lzKopieren').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(s.geraet); ok('Kennung kopiert'); } catch { host.querySelector('#lzGeraet').select(); err('Nicht kopiert', 'Markieren Sie die Kennung und kopieren Sie sie von Hand.'); }
  });
  host.querySelector('#lzEinloesen').addEventListener('click', async (e) => {
    const feld = host.querySelector('#lzSchein');
    const fehler = host.querySelector('#lzFehler');
    fehler.textContent = '';
    if (!feld.value.trim()) { fehler.textContent = 'Bitte den Lizenzschein einfügen.'; feld.focus(); return; }
    e.currentTarget.disabled = true;
    try {
      lizenzSetzen(await api.lizenz.aktivieren(feld.value));
      ok('Lizenz eingelöst', `Tarif: ${stufeName()}`);
      nochNeu();
    } catch (ex) {
      fehler.textContent = ex.message;
      e.currentTarget.disabled = false;
    }
  });
  host.querySelector('#lzEntfernen')?.addEventListener('click', async () => {
    if (!await confirmDialog({
      title: 'Lizenzschein entfernen?',
      text: 'Das Konto fällt danach auf den kostenlosen Tarif. Ihre Daten bleiben erhalten. Mit dem Schein können Sie es jederzeit wieder freischalten.',
      confirmLabel: 'Entfernen', danger: true,
    })) return;
    try { lizenzSetzen(await api.lizenz.entfernen()); nochNeu(); } catch (ex) { err('Nicht entfernt', ex.message); }
  });
  host.querySelectorAll('#lzVorschau [data-stufe]').forEach((b) => b.addEventListener('click', async () => {
    try {
      lizenzSetzen(await api.lizenz.vorschau(b.dataset.stufe === 'max' ? '' : b.dataset.stufe));
      nochNeu();
    } catch (ex) { err('Nicht möglich', ex.message); }
  }));
}
