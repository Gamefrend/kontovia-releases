/**
 * Kontovia – Auswertungen, Reiter „Kosten“: wofür das Geld ausgegeben wurde, in Prozent.
 *
 * Kein eigener Bereich: Zeitraum, private Buchungen, Druck und Rechte kommen
 * aus den Auswertungen (views/reports.js). Hier stehen die Anteile je
 * Kostenart (lib/kostenarten.js), die Buchungen dahinter zum Nachsehen und
 * Umordnen, und auf Wunsch die KI des Assistenten für alles, was die festen
 * Stichwörter nicht erkennen.
 *
 * Die KI läuft nur, wenn ihr Modell schon auf diesem Gerät liegt; von hier
 * aus wird nichts heruntergeladen. Sie startet ohne Netz (api.ki.laden mit
 * `ohneNetz`), und beim Antworten ist das Netz in ihrem Rechenwerk ganz zu
 * (src/web/ki-worker.js). Was sie vorschlägt, gilt sofort für die Übersicht,
 * ist als „KI“ gekennzeichnet und lässt sich je Buchung ändern. Steuerlich
 * ändert sich nichts.
 */

import { html, raw, esc, $, $$, money, fmtDate, int, dz } from '../lib/util.js';
import { icon, statCard, emptyState, chart, modal, ok, warn, err } from '../lib/ui.js';
import { store, commit } from '../lib/store.js';
import { scopeDb } from '../lib/calc.js';
import { table } from '../lib/table.js';
import { kannSchreiben } from '../lib/benutzer.js';
import { kann } from '../lib/lizenz.js';
import { prefs, scope } from '../lib/prefs.js';
import { stufe as kiStufe } from '../lib/assistentmodelle.js';
import { eintragOeffnen } from '../lib/oeffnen.js';
import {
  KOSTENARTEN, KOSTEN_STAPEL, kostenUebersicht, kostenartName, kostenSchluessel, kostenAnfrage, kostenAntwortLesen, kostenartenSetzen,
} from '../lib/kostenarten.js';

const QUELLE = { hand: 'Von Ihnen', ki: 'KI', regel: 'Stichwort', '': 'Offen' };
const BADGE = { hand: 'info', ki: 'warn', regel: 'plain', '': 'plain' };

/** Läuft die KI gerade? Gilt über ein Neuzeichnen hinweg. */
const ki = { laeuft: false, status: '' };

const kiAngeboten = () => !!kiStufe(prefs.kiStufe).modell && kann('assistent') && !!window.kontovia?.ki;
const prozent = (v) => `${dz(v.toFixed(1))} %`;

/**
 * Zeichnet den Reiter.
 * @param {HTMLElement} root
 * @param {object} db  Bestand nach der Wahl „private Buchungen“ (scopeDb)
 * @param {{from:string, to:string}} period
 * @param {() => void} neu  zeichnet die Auswertungen neu
 */
export function kostenZeigen(root, db, period, neu) {
  const u = kostenUebersicht(db, period.from, period.to);
  if (!u.anzahl) {
    root.innerHTML = html`<div class="card"><div class="card-body">${emptyState('Keine Ausgaben im Zeitraum', 'Hier steht, wofür Sie Geld ausgegeben haben, sobald im Zeitraum Ausgaben bezahlt wurden.')}</div></div>`;
    return;
  }
  const schreiben = kannSchreiben();
  const groesste = u.arten.find((a) => a.id !== 'offen');
  const eingeordnet = u.anzahl - u.offen.length;
  const kiMoeglich = kiAngeboten() && schreiben;

  root.innerHTML = html`
    <div class="grid c3 mb16">
      ${statCard({ label: 'Ausgaben im Zeitraum', value: `${esc(money(u.summe))} €`, tone: 'neg', foot: `<span>${esc(int(u.anzahl))} ${u.anzahl === 1 ? 'Buchung' : 'Buchungen'}</span>` })}
      ${statCard({ label: 'Größter Posten', value: groesste ? esc(prozent(groesste.anteil)) : '–', foot: groesste ? `<span>${esc(groesste.name)}, ${esc(money(groesste.betrag))} €</span>` : '' })}
      ${statCard({ label: 'Eingeordnet', value: `${esc(int(eingeordnet))} von ${esc(int(u.anzahl))}`, foot: `<span>${u.offen.length ? `${esc(int(u.offen.length))} noch offen` : 'Alles eingeordnet'}</span>` })}
    </div>

    <div class="grid c2 mb16">
      <div class="card">
        <div class="card-head"><h2>Aufteilung nach Kostenart</h2></div>
        <div class="card-body">${chart('pie', u.arten.map((a) => ({ name: a.name, amount: a.betrag })), { centerLabel: 'Ausgaben', label: 'Aufteilung nach Kostenart' })}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Einordnen</h2></div>
        <div class="card-body">
          <p class="small mt0">Jede Ausgabe bekommt eine Kostenart. Vieles erkennt Kontovia an Stichwörtern in Beschreibung, Gegenseite und Kategorie. Klicken Sie auf eine Kostenart, um die Buchungen zu sehen und eine andere zu wählen. Kategorien, Steuer und Buchungen bleiben dabei, wie sie sind.</p>
          ${raw(kiMoeglich ? `
            <p class="small">Den Rest kann die KI des Assistenten einordnen. Sie läuft nur auf diesem Gerät und hat dabei keinen Zugang zum Internet. Ihre Wahl ist mit „KI“ gekennzeichnet und lässt sich jederzeit ändern.</p>
            <div class="row wrap" style="gap:8px">
              <button class="btn sm" id="koKi" ${ki.laeuft || !u.offen.length ? 'disabled' : ''}>${icon('sparkle', 14).__raw} Mit der KI einordnen (${esc(int(u.offen.length))})</button>
              ${u.quellen.ki ? `<button class="btn sm ghost" id="koKiWeg" ${ki.laeuft ? 'disabled' : ''}>Einordnung der KI zurücksetzen (${esc(int(u.quellen.ki))})</button>` : ''}
            </div>
            <p class="small muted mb0 mt8" id="koKiStatus" role="status">${esc(ki.status)}</p>`
    : `<p class="small muted mb0">${schreiben ? 'Mit einer Stufe des Assistenten ab „Mini“ ordnet auch die KI auf diesem Gerät den Rest ein, ohne Internet.' : 'Ihre Rolle kann hier nur lesen.'}</p>`)}
        </div>
      </div>
    </div>

    <div class="card mb16">
      <div class="card-head"><h2>Kostenarten</h2><span class="sub">Gezählt wird, was im Zeitraum bezahlt wurde, auch Anschaffungen, die abgeschrieben werden.</span></div>
      ${table({
    id: 'kostenarten',
    cls: 'data',
    toolbar: false,
    defaultSort: { key: 'betrag', dir: -1 },
    rows: u.arten,
    columns: [
      { key: 'name', label: 'Kostenart', type: 'text', cell: (a) => esc(a.name) },
      { key: 'anzahl', label: 'Anzahl', type: 'num', tdCls: 'muted', cell: (a) => esc(int(a.anzahl)) },
      { key: 'betrag', label: 'Betrag', type: 'num', cell: (a) => esc(money(a.betrag)) },
      { key: 'anteil', label: 'Anteil', type: 'num', tdCls: 'muted', cell: (a) => esc(prozent(a.anteil)) },
    ],
    onRowClick: (a) => buchungenZeigen(period, a.id, neu),
    rowClickable: () => true,
    emptyTitle: 'Keine Ausgaben',
    foot: () => `<tr><td>Summe</td><td class="num">${esc(int(u.anzahl))}</td><td class="num">${esc(money(u.summe))}</td><td></td></tr>`,
  })}
    </div>`;

  $('#koKi', root)?.addEventListener('click', () => kiEinordnen(db, period, neu));
  $('#koKiWeg', root)?.addEventListener('click', async () => {
    const weg = u.buchungen.filter((b) => b.quelle === 'ki').map((b) => [kostenSchluessel(b.tx), '']);
    await speichern(weg, 'hand', `Einordnung der KI zurückgesetzt (${weg.length})`);
    neu();
  });
}

/** Schreibt Einordnungen über commit() (Rollen, Journal, Speichern). */
async function speichern(eintraege, quelle, zusammenfassung) {
  if (!eintraege.length) return 0;
  try {
    let n = 0;
    await commit('kostenart.zuordnen', (db) => { n = kostenartenSetzen(db, eintraege, quelle); }, { entity: 'kostenart', summary: zusammenfassung });
    return n;
  } catch (e) {
    err('Nicht gespeichert', e?.message || String(e));
    return 0;
  }
}

/** Die Buchungen einer Kostenart, mit Wahl einer anderen je Buchung. Nach jeder Wahl steht die Liste neu da. */
function buchungenZeigen(period, artId, neu) {
  const schreiben = kannSchreiben();
  // Nach einer Wahl gilt der neue Bestand, mit derselben Wahl für private Buchungen wie die Ansicht.
  const liste = () => kostenUebersicht(scopeDb(store.db, scope.includeUnlisted), period.from, period.to).buchungen.filter((b) => (b.art || 'offen') === artId);
  const optionen = (b) => [
    `<option value="" ${b.quelle === 'hand' ? '' : 'selected'}>Automatisch${b.quelle !== 'hand' && b.art ? ` (${esc(kostenartName(b.art))})` : ''}</option>`,
    ...KOSTENARTEN.map((k) => `<option value="${esc(k.id)}" ${b.quelle === 'hand' && b.art === k.id ? 'selected' : ''}>${esc(k.name)}</option>`),
  ].join('');
  const koerper = (l) => (l.length ? `<p class="small mt0">Die Kostenart gilt nur für diese Übersicht. Kategorie und Steuer der Buchung bleiben.</p>
    <div class="table-wrap"><table class="data compact">
      <thead><tr><th>Bezahlt</th><th>Beschreibung</th><th class="num">Betrag</th><th>Woher</th><th>Kostenart</th></tr></thead>
      <tbody>${l.map((b) => `<tr>
        <td class="nowrap">${esc(fmtDate(b.tx.paidDate || b.tx.date))}</td>
        <td><a href="#" data-tx="${esc(b.tx.id)}">${esc(b.tx.description || 'Ohne Beschreibung')}</a>${b.grund ? `<div class="tiny muted">${esc(b.grund)}</div>` : ''}</td>
        <td class="num nowrap">${esc(money(b.betrag))} €</td>
        <td><span class="badge ${BADGE[b.quelle]}">${esc(QUELLE[b.quelle])}</span></td>
        <td>${schreiben ? `<select data-art="${esc(kostenSchluessel(b.tx))}" aria-label="Kostenart">${optionen(b)}</select>` : esc(kostenartName(b.art) || 'Offen')}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Hier ist nichts mehr. Die Buchungen stehen jetzt bei ihrer neuen Kostenart.</p>');
  const titel = artId === 'offen' ? 'Noch nicht eingeordnet' : kostenartName(artId);
  const m = modal({ title: titel, size: 'wide', body: koerper(liste()), onClose: neu });
  const zeichnen = () => {
    m.body.innerHTML = html`${raw(koerper(liste()))}`;
    $$('[data-tx]', m.body).forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); eintragOeffnen('buchung', a.dataset.tx); }));
    $$('[data-art]', m.body).forEach((s) => s.addEventListener('change', async () => {
      await speichern([[s.dataset.art, s.value]], 'hand', s.value ? `Kostenart „${kostenartName(s.value)}“ gewählt` : 'Kostenart wieder automatisch');
      zeichnen();
    }));
  };
  zeichnen();
}

/** Ordnet die offenen Buchungen mit der KI des Assistenten ein, stapelweise, ohne Netz. */
async function kiEinordnen(db, period, neu) {
  if (ki.laeuft) return;
  const api = window.kontovia.ki;
  const s = kiStufe(prefs.kiStufe);
  const melden = (t) => { ki.status = t; const el = document.getElementById('koKiStatus'); if (el) el.textContent = t; };
  ki.laeuft = true;
  const knopf = document.getElementById('koKi');
  if (knopf) knopf.disabled = true;
  const gefunden = new Map();
  let abgebrochen = false;
  try {
    const g = await api.geraet();
    if (!g.grafik || g.ersatz) { warn('Hier geht das nicht', 'Dieser Browser gibt den Grafikchip nicht frei. Die KI des Assistenten läuft hier nicht.'); return; }
    const modell = await api.fassung(s.modell, g.f16);
    const da = (await api.imCache([modell]).catch(() => ({})))[modell] || (await api.status().catch(() => ({}))).gestartet === modell;
    if (!da) { warn('Erst im Assistenten laden', `Die Stufe ${s.name} liegt noch nicht auf diesem Gerät. Laden Sie sie einmal im Assistenten, dann geht es auch hier.`); return; }
    melden('Die KI startet …');
    await api.laden(modell, null, { ohneNetz: true });
    const offen = kostenUebersicht(db, period.from, period.to).offen;
    for (let i = 0; i < offen.length; i += KOSTEN_STAPEL) {
      melden(`Die KI ordnet ein: ${int(Math.min(i + KOSTEN_STAPEL, offen.length))} von ${int(offen.length)} …`);
      const stapel = offen.slice(i, i + KOSTEN_STAPEL);
      const { messages, schema } = kostenAnfrage(db, stapel);
      const anfrage = { messages, temperature: 0.1, top_p: 0.8, max_tokens: 60 + 24 * stapel.length, extra_body: { enable_thinking: false } };
      let text = '';
      const teil = (t) => { text += t; };
      try {
        await api.antworten({ ...anfrage, response_format: { type: 'json_object', schema } }, teil, 'kosten');
      } catch (e) {
        // Kann die Laufzeit die Grammatik nicht übersetzen, geht es ohne; geprüft wird die Antwort ohnehin.
        if (e?.code !== 'KI_GRAMMATIK') throw e;
        text = '';
        await api.antworten(anfrage, teil, 'kosten');
      }
      for (const [k, v] of kostenAntwortLesen(text, stapel)) gefunden.set(k, v);
    }
  } catch (e) {
    // Gesperrt: still aufhören. Was bis dahin eingeordnet ist, bleibt.
    if (e?.code === 'KI_ABGEBROCHEN') abgebrochen = true;
    else if (e?.code === 'KI_OHNE_NETZ') warn('Erst im Assistenten laden', 'Die KI liegt nicht vollständig auf diesem Gerät. Laden Sie die Stufe einmal im Assistenten, dann geht es hier ohne Internet.');
    else err('Die KI konnte nicht helfen', e?.message || String(e));
  } finally {
    ki.laeuft = false;
    ki.status = '';
  }
  if (abgebrochen || !store.db) return;
  const n = await speichern([...gefunden], 'ki', `Kostenarten von der KI eingeordnet (${gefunden.size})`);
  if (n) ok(n === 1 ? 'Eine Buchung eingeordnet' : `${int(n)} Buchungen eingeordnet`, 'Die Wahl der KI ist gekennzeichnet. Klicken Sie auf eine Kostenart, um sie zu prüfen.');
  else if (gefunden.size === 0) warn('Nichts eingeordnet', 'Die KI hat für diese Buchungen keine passende Kostenart gefunden.');
  neu();
}

