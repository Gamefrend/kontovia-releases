/**
 * Kontovia – Einstellungen zum Mahnwesen: Frist und Gebühr je Stufe,
 * Verzugsaufschlag (aus, Prozent pro Jahr, feste Pauschale oder beides).
 *
 * Die Karte speichert für sich (eigener Knopf), nicht mit „Einstellungen
 * übernehmen“: Sie gehört nicht zu den Firmendaten.
 */

import { esc, $, moneyInput, parseMoney } from '../lib/util.js';
import { icon, ok, err } from '../lib/ui.js';
import { store, commit } from '../lib/store.js';
import { refresh } from '../lib/router.js';
import {
  MAHNSTUFEN, AUFSCHLAG_ARTEN, PAUSCHALE_VORGABE, mahneinstellungen, parseSatz,
} from '../lib/mahnwesen.js';

export function mahnKarte(host) {
  const e = mahneinstellungen(store.db.settings);
  const art = e.aufschlag.art;
  host.innerHTML = `
    <div class="card-head"><h3>${icon('alert', 16).__raw} Mahnwesen</h3><span class="sub">Fristen, Gebühren, Verzugsaufschlag</span></div>
    <div class="card-body">
      <p class="small muted mt0">Für Zahlungserinnerung, 1. Mahnung und 2. Mahnung stellen Sie hier die Zahlungsfrist und die Mahngebühr ein. Beim Erstellen jeder einzelnen Mahnung lässt sich beides noch ändern.</p>
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th>Stufe</th><th class="right">Zahlungsfrist in Tagen</th><th class="right">Mahngebühr in €</th></tr></thead>
        <tbody>${[1, 2, 3].map((st) => `<tr>
          <td>${esc(MAHNSTUFEN[st].name)}</td>
          <td class="right"><input id="mw_frist${st}" type="number" min="1" max="90" step="1" value="${e.fristen[st]}" style="width:90px;text-align:right" aria-label="Frist in Tagen, ${esc(MAHNSTUFEN[st].name)}"></td>
          <td class="right"><input id="mw_gebuehr${st}" inputmode="decimal" value="${esc(moneyInput(e.gebuehren[st]))}" style="width:90px;text-align:right" aria-label="Gebühr in Euro, ${esc(MAHNSTUFEN[st].name)}"></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny muted mt8">Eine Gebühr von 0 € steht nicht auf dem Schreiben.</p>

      <div class="field mt16">
        <label for="mw_art">Verzugsaufschlag für verspätete Zahlung</label>
        <select id="mw_art">${Object.entries(AUFSCHLAG_ARTEN).map(([k, t]) => `<option value="${k}" ${art === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <span class="hint">Standardmäßig aus. Wenn Sie ihn einschalten, schlägt Kontovia ihn beim Erstellen einer Mahnung vor, Sie können ihn dort für das einzelne Schreiben aber abwählen. Auf dem Schreiben steht er als „Verzugsaufschlag“ mit Zeitraum, Satz und Betrag.</span>
      </div>
      <div class="form-grid" id="mw_aufschlagFelder">
        <div class="field" id="mw_prozentBox">
          <label for="mw_prozent">Prozent pro Jahr</label>
          <input id="mw_prozent" inputmode="decimal" value="${e.aufschlag.prozent ? esc(String(e.aufschlag.prozent).replace('.', ',')) : ''}" placeholder="z. B. 12,5">
          <span class="hint">Auf den offenen Betrag, tageweise ab Fälligkeit. Bei Geschäftskunden gilt gesetzlich üblich der Basiszinssatz plus 9 Prozentpunkte. Der Basiszinssatz ändert sich halbjährlich (Januar und Juli). Sie tragen den Satz selbst ein und halten ihn aktuell, Kontovia kennt ihn nicht.</span>
        </div>
        <div class="field" id="mw_pauschaleBox">
          <label for="mw_pauschale">Feste Pauschale in €</label>
          <input id="mw_pauschale" inputmode="decimal" value="${esc(moneyInput(e.aufschlag.pauschale))}">
          <span class="hint">Vorgabe 40 €: die gesetzliche Verzugspauschale bei Geschäftskunden (§ 288 Abs. 5 BGB), nur gegenüber Unternehmen. Sie wird höchstens einmal je Rechnung berechnet.</span>
        </div>
        <div class="field">
          <label for="mw_ab">Vorschlagen ab</label>
          <select id="mw_ab">${[1, 2, 3].map((st) => `<option value="${st}" ${e.aufschlag.abStufe === st ? 'selected' : ''}>${esc(MAHNSTUFEN[st].name)}</option>`).join('')}</select>
          <span class="hint">Ab diesem Schreiben ist der Verzugsaufschlag vorausgewählt.</span>
        </div>
      </div>
      <div class="notice mt8">Beim Erstellen einer Mahnung wählen Sie, ob der Kunde ein Unternehmen oder eine Privatperson ist. Bei Privatkunden (Verbrauchern) gilt der Basiszinssatz plus 5 Prozentpunkte, die Pauschale wird <strong>nie</strong> berechnet, und eine Mahngebühr darf nur den tatsächlichen Aufwand abdecken. Verzug setzt außerdem voraus, dass die Zahlungsfrist abgelaufen ist (§ 286 BGB). Welche Beträge Sie verlangen, verantworten Sie selbst. Kontovia rechnet nach Ihren Angaben und ersetzt keine Rechtsberatung.
        Mahngebühr und Verzugsaufschlag sind kein Entgelt für eine Leistung: Sie werden ohne Umsatzsteuer gebucht, erst wenn das Geld eingegangen ist.</div>
      <div class="row end mt16"><button class="btn primary" id="mw_speichern">Mahnwesen speichern</button></div>
    </div>`;

  const sichtbar = () => {
    const a = $('#mw_art', host).value;
    // style statt hidden: .field und .form-grid setzen ein eigenes display
    const zeige = (id, an) => { $(id, host).style.display = an ? '' : 'none'; };
    zeige('#mw_prozentBox', a === 'prozent' || a === 'beides');
    zeige('#mw_pauschaleBox', a === 'pauschale' || a === 'beides');
    zeige('#mw_aufschlagFelder', a !== 'aus');
  };
  $('#mw_art', host).addEventListener('change', sichtbar);
  sichtbar();

  $('#mw_speichern', host).addEventListener('click', async (ev) => {
    const knopf = ev.currentTarget;
    const wert = (id) => $(`#mw_${id}`, host).value;
    const fristen = {}; const gebuehren = {};
    for (const st of [1, 2, 3]) {
      const t = Math.round(Number(wert(`frist${st}`)));
      if (!Number.isFinite(t) || t < 1 || t > 90) { err('Zahlungsfrist prüfen', `${MAHNSTUFEN[st].name}: bitte 1 bis 90 Tage eintragen.`); return; }
      fristen[st] = t;
      const g = wert(`gebuehr${st}`).trim() === '' ? 0 : parseMoney(wert(`gebuehr${st}`));
      if (g < 0) { err('Gebühr prüfen', `${MAHNSTUFEN[st].name}: Die Gebühr darf nicht negativ sein.`); return; }
      gebuehren[st] = g;
    }
    const artNeu = wert('art');
    const satz = wert('prozent').trim() === '' ? 0 : parseSatz(wert('prozent'));
    if (satz === null || satz < 0 || satz > 50) { err('Satz prüfen', 'Bitte einen Satz zwischen 0 und 50 Prozent eintragen.'); return; }
    if ((artNeu === 'prozent' || artNeu === 'beides') && satz === 0) { err('Satz fehlt', 'Für „Prozent pro Jahr“ tragen Sie bitte einen Satz ein, etwa Basiszinssatz plus 9 Prozentpunkte.'); return; }
    const pauschale = wert('pauschale').trim() === '' ? PAUSCHALE_VORGABE : parseMoney(wert('pauschale'));
    if (pauschale < 0) { err('Pauschale prüfen', 'Die Pauschale darf nicht negativ sein.'); return; }
    knopf.disabled = true;
    try {
      await commit('einstellungen.aendern', (db) => {
        db.settings.mahnwesen = {
          fristen, gebuehren,
          aufschlag: { art: artNeu, prozent: satz, pauschale, abStufe: Number(wert('ab')) },
        };
        db.settings.updatedAt = new Date().toISOString();
      }, { entity: 'einstellungen', summary: 'Mahnwesen eingestellt' });
      ok('Mahnwesen gespeichert');
      refresh();
    } catch (ex) { err('Nicht gespeichert', ex.message); }
    knopf.disabled = false;
  });
}

