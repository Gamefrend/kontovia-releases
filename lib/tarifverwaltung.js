/**
 * Kontovia – Tarife einstellen (Admin-Bereich, nur für den Betreiber).
 *
 * Für jeden Bereich der Seitenleiste und jede Premium-Funktion wählt der Betreiber, ab welchem Tarif sie gelten
 * (Kostenlos = für alle frei), und für jede Stufe die Grenzen (Rechnungen im Monat, Geräte, Benutzer, Firmen).
 * Veröffentlicht wird eine kleine, mit dem Lizenzschlüssel signierte Datei im Cloud-Speicher (lib/tarifkonfig.js);
 * jedes Konto holt sie beim Lizenzabgleich oder mit der Update-Prüfung. Bis dahin arbeitet man an einem Entwurf, den
 * man auf diesem Gerät ansehen kann.
 * Die eingebauten Werte stehen in lib/tarife.js und gelten, wenn nichts veröffentlicht ist.
 */

import { html, raw, esc, $, $$ } from './util.js';
import { icon, ok, err, confirmDialog } from './ui.js';
import { STUFEN, STUFEN_NAME, FUNKTIONEN, BEREICHE, GRENZEN_NAME, GRENZEN_ARTEN, konfigEingebaut, konfigStand, konfigVoll } from './tarife.js';
import {
  tarifkonfigVeroeffentlichen, tarifkonfigEntfernen, tarifkonfigVeroeffentlicht, tarifkonfigVorschau,
} from './tarifkonfig.js';
import { lizenzStand, lizenzSetzen } from './lizenz.js';

const api = window.kontovia;
const kopie = (o) => JSON.parse(JSON.stringify(o));
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Zeichnet den Editor in `host`. */
export async function tarifVerwaltung(host) {
  const eingebaut = konfigEingebaut();
  let bezug = konfigStand(); // was veröffentlicht ist (oder eingebaut), nicht eine Vorschau auf diesem Gerät
  let entwurf = kopie(bezug);
  let veroeffentlicht = null; // Antwort des Speichers: Datei oder null
  let fehlerText = '';
  let suche = '';
  let nurGeaendert = false;

  /** Bezeichnung einer Grenze im Singular ohne Zahl: „Rechnungen im Monat“. */
  const grenzeName = (was) => (GRENZEN_NAME[was] || [was, was])[1];
  const nameVon = (k) => (FUNKTIONEN[k] || BEREICHE[k])?.name || k;

  /** Was der Entwurf gegenüber `gegen` ändert, als lesbare Zeilen („Mahnwesen: Pro → Standard“). */
  function aenderungen(gegen) {
    const out = [];
    for (const k of Object.keys(entwurf.funktionen)) {
      if (entwurf.funktionen[k] !== gegen.funktionen[k]) out.push(`${nameVon(k)}: ${STUFEN_NAME[gegen.funktionen[k]]} → ${STUFEN_NAME[entwurf.funktionen[k]]}`);
    }
    const zahl = (n) => (n === null ? 'unbegrenzt' : String(n));
    for (const was of GRENZEN_ARTEN) {
      for (const s of STUFEN) {
        if (entwurf.grenzen[s][was] !== gegen.grenzen[s][was]) out.push(`${grenzeName(was)} (${STUFEN_NAME[s]}): ${zahl(gegen.grenzen[s][was])} → ${zahl(entwurf.grenzen[s][was])}`);
      }
    }
    return out;
  }

  /** Zeile sichtbar? Suche nach Namen, „nur geänderte“ gegenüber den eingebauten Werten. */
  const sichtbar = (name, geaendert) => (!nurGeaendert || geaendert) && (!suche || name.toLowerCase().includes(suche.toLowerCase()));

  const zeileStufe = (schluessel, name, art) => {
    const aktuell = entwurf.funktionen[schluessel];
    const geaendert = aktuell !== eingebaut.funktionen[schluessel];
    return `<div class="tv-zeile${geaendert ? ' geaendert' : ''}" data-schluessel="${esc(schluessel)}" data-name="${esc(name)}" ${sichtbar(name, geaendert) ? '' : 'hidden'}>
      <div class="tv-name">
        <span class="tv-titel">${esc(name)}</span>
        <span class="small muted tv-art">${esc(art)}${geaendert ? ` · eingebaut: ${esc(STUFEN_NAME[eingebaut.funktionen[schluessel]])}` : ''}</span>
      </div>
      <div class="seg tv-stufen" role="group" aria-label="${esc(`Ab welchem Tarif: ${name}`)}">
        ${STUFEN.map((s) => `<button type="button" data-stufe="${s}" class="${s === aktuell ? 'active' : ''}" aria-pressed="${s === aktuell}">${esc(STUFEN_NAME[s])}</button>`).join('')}
      </div>
    </div>`;
  };

  const grenzeZeile = (was) => {
    const geaendert = STUFEN.some((s) => entwurf.grenzen[s][was] !== eingebaut.grenzen[s][was]);
    return `<div class="tv-zeile tv-grenze${geaendert ? ' geaendert' : ''}" data-grenze="${esc(was)}" data-name="${esc(grenzeName(was))}" ${sichtbar(grenzeName(was), geaendert) ? '' : 'hidden'}>
      <div class="tv-name"><span class="tv-titel">${esc(grenzeName(was))}</span><span class="small muted tv-art">leer = unbegrenzt</span></div>
      <div class="tv-zahlen">
        ${STUFEN.map((s) => `<label class="tv-zahl"><span class="small muted">${esc(STUFEN_NAME[s])}</span>
          <input type="number" min="0" max="100000" step="1" inputmode="numeric" data-grenze-stufe="${s}" placeholder="unbegrenzt"
            value="${entwurf.grenzen[s][was] === null ? '' : entwurf.grenzen[s][was]}"></label>`).join('')}
      </div>
    </div>`;
  };

  const abweichungen = () => !gleich(entwurf, bezug);
  const vomEingebauten = () => !gleich(entwurf, eingebaut);

  /**
   * Die Abo-Seite zeigt immer die eingebauten Werte (die Prüfung `lizenz` hält beide gleich). Weicht der Entwurf
   * davon ab, steht dort etwas anderes als im Programm; das soll vor dem Veröffentlichen klar sein.
   */
  function aboHinweis() {
    const liste = aenderungen(eingebaut);
    if (!liste.length) return '';
    const mehr = liste.length > 8 ? `<li>${esc(`und ${liste.length - 8} weitere`)}</li>` : '';
    return `<strong>${esc('Die Abo-Seite zeigt noch die eingebauten Werte.')}</strong>
      ${esc('Für Besucher steht dort bei diesen Punkten etwas anderes als im Programm:')}
      <ul>${liste.slice(0, 8).map((z) => `<li>${esc(z)}</li>`).join('')}${mehr}</ul>
      <span class="small">${esc('Passen Sie dafür die Vergleichstabelle der Abo-Seite an und veröffentlichen Sie die Seite neu.')}</span>`;
  }

  function stand() {
    // Läuft auf diesem Gerät noch „Hier ansehen“, soll das nicht wie veröffentlicht aussehen.
    const vorschau = !gleich(konfigStand(), bezug) ? '<span class="badge warn">Vorschau auf diesem Gerät</span>' : '';
    if (veroeffentlicht?.unsigniert) return `<span class="badge neg">Ohne gültige Signatur, gilt nicht</span>${vorschau}`;
    if (veroeffentlicht) return `<span class="badge pos">Veröffentlicht</span>${vorschau}`;
    return `<span class="badge">Nur eingebaute Werte</span>${vorschau}`;
  }

  function zeichnen() {
    const testphase = !!lizenzStand()?.testphase;
    const gesperrteBereiche = Object.keys(BEREICHE).filter((k) => entwurf.funktionen[k] !== 'kostenlos').length;
    host.innerHTML = html`
      <div class="notice mb16">Legen Sie fest, ab welchem Tarif ein Bereich oder eine Funktion gilt. Wer den Tarif nicht hat,
        sieht dort eine Erklärung mit der Krone; die Daten bleiben unverändert. Veröffentlichte Änderungen holt jedes Konto
        beim nächsten Abgleich mit der Cloud oder bei der nächsten Suche nach Updates. Signiert wird auf dem Server; dafür muss
        dort einmal der Signierschlüssel liegen (Reiter Lizenzen, Einrichtung). Die Tabelle auf der Abo-Seite ändert sich dadurch nicht.</div>
      ${fehlerText ? raw(html`<div class="notice warn mb16">${fehlerText}</div>`) : ''}
      <div class="tv-leiste mb16">
        <div class="tv-leiste-stand">${raw(stand())}
          ${abweichungen() ? raw('<span class="badge warn">Nicht veröffentlicht</span>') : ''}</div>
        <div class="tv-leiste-knoepfe">
          <button type="button" class="btn primary" id="tvVeroeffentlichen" ${abweichungen() ? '' : 'disabled'}>${icon('save', 15)} Veröffentlichen</button>
          <button type="button" class="btn" id="tvAnsehen" ${abweichungen() ? '' : 'disabled'} title="Gilt nur hier und nur bis zum nächsten Start">Hier ansehen</button>
          <button type="button" class="btn ghost" id="tvVerwerfen" ${abweichungen() ? '' : 'disabled'}>Verwerfen</button>
        </div>
      </div>
      <div class="notice warn mb16 tv-hinweis" id="tvAbo" ${raw(aboHinweis() ? '' : 'hidden')}>${raw(aboHinweis())}</div>
      <div class="tv-filter mb16">
        <input id="tvSuche" type="search" placeholder="Bereich, Funktion oder Grenze suchen …" aria-label="Bereich, Funktion oder Grenze suchen" value="${suche}">
        <label class="check"><input type="checkbox" id="tvNurGeaendert" ${raw(nurGeaendert ? 'checked' : '')}> Nur geänderte</label>
      </div>
      ${testphase ? raw(html`<div class="card mb16"><div class="card-body">
        <h3 class="m0 mb8">Mit einem Tarif ansehen</h3>
        <p class="small muted mt0">Sie haben in der Testphase die volle Stufe. So sehen Sie, was ein Konto mit einem kleineren Tarif sieht:</p>
        <div class="seg tv-vorschau" role="group" aria-label="Tarif ausprobieren">
          ${raw(STUFEN.map((s) => `<button type="button" data-vorschau="${s}" class="${(lizenzStand()?.vorschau || 'max') === s ? 'active' : ''}">${esc(STUFEN_NAME[s])}</button>`).join(''))}
        </div></div></div>`) : ''}
      <section class="card mb16">
        <div class="card-head"><h2>Bereiche</h2><span class="sub">ganze Seiten der Seitenleiste${gesperrteBereiche ? ` · ${gesperrteBereiche} hinter einem Tarif` : ''}</span></div>
        <div class="card-body tv-liste">
          ${raw(Object.entries(BEREICHE).map(([k, b]) => zeileStufe(k, b.name, 'Bereich')).join(''))}
          <p class="small muted mb0">Einstellungen und Hilfe bleiben immer frei, sonst käme niemand an die Lizenz.</p>
        </div>
      </section>
      <section class="card mb16">
        <div class="card-head"><h2>Funktionen</h2><span class="sub">einzelne Premium-Funktionen</span></div>
        <div class="card-body tv-liste">
          ${raw(Object.entries(FUNKTIONEN).map(([k, f]) => zeileStufe(k, f.name, 'Funktion')).join(''))}
        </div>
      </section>
      <section class="card mb16">
        <div class="card-head"><h2>Grenzen</h2><span class="sub">je Tarif</span></div>
        <div class="card-body tv-liste">
          ${raw(GRENZEN_ARTEN.map(grenzeZeile).join(''))}
        </div>
      </section>
      <div class="row wrap tv-fuss" style="gap:8px">
        <button type="button" class="btn ghost" id="tvEingebaut" ${vomEingebauten() ? '' : 'disabled'}>Auf die eingebauten Werte zurücksetzen</button>
        <button type="button" class="btn ghost danger-text" id="tvEntfernen" ${veroeffentlicht ? '' : 'disabled'}>Veröffentlichung entfernen</button>
      </div>`;
  }

  /** Suche und „Nur geänderte“ anwenden; Karten ohne sichtbare Zeile verschwinden mit. */
  function filtern() {
    $$('.tv-zeile', host).forEach((z) => { z.hidden = !sichtbar(z.dataset.name || '', z.classList.contains('geaendert')); });
    $$('section.card', host).forEach((karte) => {
      const zeilen = $$('.tv-zeile', karte);
      if (zeilen.length) karte.hidden = zeilen.every((z) => z.hidden);
    });
  }

  /** Nur Zeilen und Knöpfe auffrischen, ohne das Eingabefeld zu verlieren, in dem gerade getippt wird. */
  function auffrischen() {
    $$('.tv-zeile[data-schluessel]', host).forEach((z) => {
      const k = z.dataset.schluessel;
      const geaendert = entwurf.funktionen[k] !== eingebaut.funktionen[k];
      z.classList.toggle('geaendert', geaendert);
      $$('[data-stufe]', z).forEach((b) => { const an = b.dataset.stufe === entwurf.funktionen[k]; b.classList.toggle('active', an); b.setAttribute('aria-pressed', String(an)); });
      const art = $('.tv-art', z);
      const bez = k in BEREICHE ? 'Bereich' : 'Funktion';
      if (art) art.textContent = `${bez}${geaendert ? ` · eingebaut: ${STUFEN_NAME[eingebaut.funktionen[k]]}` : ''}`;
    });
    $$('.tv-grenze', host).forEach((z) => z.classList.toggle('geaendert', STUFEN.some((s) => entwurf.grenzen[s][z.dataset.grenze] !== eingebaut.grenzen[s][z.dataset.grenze])));
    filtern();
    const abo = $('#tvAbo', host);
    const text = aboHinweis();
    abo.hidden = !text;
    abo.innerHTML = html`${raw(text)}`;
    const ab = abweichungen();
    ['tvVeroeffentlichen', 'tvAnsehen', 'tvVerwerfen'].forEach((id) => { $(`#${id}`, host).disabled = !ab; });
    $('#tvEingebaut', host).disabled = !vomEingebauten();
    $('.tv-leiste-stand', host).innerHTML = html`${raw(stand())}${raw(ab ? '<span class="badge warn">Nicht veröffentlicht</span>' : '')}`;
  }

  async function laden() {
    fehlerText = '';
    try {
      veroeffentlicht = await tarifkonfigVeroeffentlicht();
    } catch (ex) {
      veroeffentlicht = null;
      fehlerText = ex.message;
    }
    bezug = fehlerText ? konfigStand() : konfigVoll(veroeffentlicht?.unsigniert ? null : veroeffentlicht);
    entwurf = kopie(bezug);
    zeichnen();
  }

  host.addEventListener('click', async (e) => {
    const stufe = e.target.closest('[data-stufe]');
    if (stufe) {
      entwurf.funktionen[stufe.closest('.tv-zeile').dataset.schluessel] = stufe.dataset.stufe;
      auffrischen();
      return;
    }
    const vorschau = e.target.closest('[data-vorschau]');
    if (vorschau) {
      try {
        await lizenzSetzen(await api.lizenz.vorschau(vorschau.dataset.vorschau === 'max' ? '' : vorschau.dataset.vorschau));
        $$('[data-vorschau]', host).forEach((b) => b.classList.toggle('active', b === vorschau));
      } catch (ex) { err('Nicht möglich', ex.message); }
      return;
    }
    if (e.target.closest('#tvAnsehen')) {
      tarifkonfigVorschau(entwurf);
      auffrischen();
      ok('Entwurf wird angezeigt', 'Nur auf diesem Gerät und nur bis zum nächsten Start.');
    } else if (e.target.closest('#tvVerwerfen')) {
      entwurf = kopie(bezug);
      tarifkonfigVorschau(bezug);
      zeichnen();
    } else if (e.target.closest('#tvEingebaut')) {
      entwurf = kopie(eingebaut);
      zeichnen();
    } else if (e.target.closest('#tvVeroeffentlichen')) {
      const liste = aenderungen(bezug);
      if (!await confirmDialog({
        title: 'Für alle Konten veröffentlichen?',
        text: 'Die Änderung gilt für jedes Konto, sobald es sich das nächste Mal mit der Cloud abgleicht oder nach Updates sucht. Wer einen Bereich oder eine Funktion dadurch nicht mehr hat, sieht eine Erklärung; die Daten bleiben erhalten.',
        extra: `<div class="tv-hinweis small"><strong>${esc(liste.length === 1 ? '1 Änderung' : `${liste.length} Änderungen`)}</strong>
          <ul>${liste.slice(0, 12).map((z) => `<li>${esc(z)}</li>`).join('')}${liste.length > 12 ? `<li>${esc(`und ${liste.length - 12} weitere`)}</li>` : ''}</ul></div>`,
        confirmLabel: 'Veröffentlichen',
      })) return;
      try {
        await tarifkonfigVeroeffentlichen(entwurf);
        ok('Veröffentlicht', 'Jedes Konto holt die Änderung beim nächsten Abgleich.');
        await laden();
      } catch (ex) { err('Nicht veröffentlicht', ex.message); }
    } else if (e.target.closest('#tvEntfernen')) {
      if (!await confirmDialog({ title: 'Veröffentlichung entfernen?', text: 'Danach gelten für alle Konten wieder die eingebauten Werte.', confirmLabel: 'Entfernen', danger: true })) return;
      try {
        await tarifkonfigEntfernen();
        ok('Entfernt', 'Es gelten wieder die eingebauten Werte.');
        await laden();
      } catch (ex) { err('Nicht entfernt', ex.message); }
    }
  });

  host.addEventListener('change', (e) => {
    if (e.target.id === 'tvNurGeaendert') { nurGeaendert = e.target.checked; filtern(); }
  });

  host.addEventListener('input', (e) => {
    if (e.target.id === 'tvSuche') { suche = e.target.value.trim(); filtern(); return; }
    const feld = e.target.closest('[data-grenze-stufe]');
    if (!feld) return;
    const was = feld.closest('.tv-grenze').dataset.grenze;
    const t = feld.value.trim();
    const n = Number(t);
    const gueltig = t === '' || (Number.isInteger(n) && n >= 0 && n <= 100000);
    // Ungültiges bleibt sichtbar markiert; im Entwurf steht weiter der letzte gültige Wert.
    feld.setAttribute('aria-invalid', String(!gueltig));
    feld.title = gueltig ? '' : 'Bitte eine ganze Zahl ab 0 eingeben oder leer lassen.';
    if (gueltig) entwurf.grenzen[feld.dataset.grenzeStufe][was] = t === '' ? null : n;
    auffrischen();
  });

  host.innerHTML = html`<p class="muted small">Lade …</p>`;
  await laden();
}
