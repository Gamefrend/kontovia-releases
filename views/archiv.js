/**
 * Kontovia – Archiv und Aufbewahrung (Reiter „Archiv“ unter Import & Export).
 *
 * Je Jahr: Umfang, Festschreibung, Archivvermerk, Fristen und der nächste
 * Schritt. Das Jahresarchiv entsteht als ZIP (lib/archivaktionen.js), die
 * Prüfsumme bleibt im Bestand; nach Ablauf der Frist räumt der Löschlauf das
 * Jahr aus dem Programm. Dazu die Fristen (Einstellungen) und die Auskunft zu
 * einer Person nach Art. 15 DSGVO. Regeln und Fristen: lib/archiv.js.
 */

import { html, raw, esc, $, $$, fmtDate, fmtDateTime, todayISO, int, bytes } from '../lib/util.js';
import { icon, modal, ok, err, warn, toast } from '../lib/ui.js';
import { store, sel } from '../lib/store.js';
import { appInfo } from '../app.js';
import { darf, verbotText } from '../lib/rollen.js';
import { jahresuebersicht, fristen, loeschplan, loeschplanText, archivText, GESETZ, FRIST_GRENZEN } from '../lib/archiv.js';
import { jahresarchivErstellen, archivPruefen, jahrLoeschen, fristenSetzen, auskunftDateien } from '../lib/archivaktionen.js';

const api = window.kontovia;

export async function render(root) {
  draw(root);
}

const STAND = {
  offen: ['Frist läuft', ''],
  archivieren: ['Frist abgelaufen, noch kein Archiv', 'neg'],
  loeschbar: ['Frist abgelaufen, Archiv liegt vor', 'pos'],
  geloescht: ['Gelöscht', ''],
};

function draw(root) {
  const db = store.db;
  const heute = todayISO();
  const f = fristen(db.settings || {});
  const jahre = jahresuebersicht(db, heute);
  const faellig = jahre.filter((j) => j.faellig && j.status !== 'geloescht');
  const kontakte = (sel.contacts() || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  const inhaber = !store.nutzer || darf(store.nutzer.rolle, 'archiv.loeschen');

  root.innerHTML = html`
    <div class="notice mb16">
      <strong>Aufbewahren, dann löschen.</strong> Buchungen und Belege müssen Sie lange aufheben, danach dürfen Sie
      personenbezogene Daten nicht endlos behalten. Kontovia rechnet die Fristen je Jahr, packt jedes Jahr auf Wunsch
      in ein Archiv mit Prüfsumme und räumt es nach Ablauf der Frist aus dem Programm. Das Änderungsjournal bleibt
      immer erhalten und hält auch fest, was wann gelöscht wurde.
    </div>

    ${faellig.length ? raw(`<div class="notice warn mb16">
      <strong>${faellig.length === 1 ? 'Ein Jahr hat' : `${faellig.length} Jahre haben`} die Aufbewahrungsfrist hinter sich:</strong>
      ${esc(faellig.map((j) => j.jahr).join(', '))}. ${faellig.some((j) => !j.archiv) ? 'Erstellen Sie zuerst das Jahresarchiv und legen Sie es an einem sicheren Ort ab, dann löschen Sie das Jahr.' : 'Das Archiv liegt vor. Sie können das Jahr jetzt löschen.'}
    </div>`) : ''}

    <div class="grid c2">
      <div class="card">
        <div class="card-head"><h2>${icon('archive', 16)} Aufbewahrungsfristen</h2></div>
        <div class="card-body">
          <div class="grid c2">
            <div class="field"><label for="arJahre">Buchungen und Rechnungen (Jahre)</label>
              <input id="arJahre" type="number" min="${GESETZ.buchhaltung}" max="${FRIST_GRENZEN.max}" step="1" value="${f.buchhaltung}" ${inhaber ? '' : 'disabled'}></div>
            <div class="field"><label for="arBelege">Belegdateien (Jahre)</label>
              <input id="arBelege" type="number" min="${GESETZ.belege}" max="${FRIST_GRENZEN.max}" step="1" value="${f.belege}" ${inhaber ? '' : 'disabled'}></div>
          </div>
          <p class="small muted">
            Gesetzlich: Bücher und Aufzeichnungen ${GESETZ.buchhaltung} Jahre, Buchungsbelege und Rechnungen ${GESETZ.belege} Jahre
            (§ 147 AO, § 14b UStG). Die Frist beginnt mit dem Ende des Jahres, in dem die letzte Eintragung stand.
            Länger als nötig sollten Sie nichts behalten; bei einer laufenden Betriebsprüfung läuft die Frist weiter.
          </p>
          ${inhaber ? raw('<button class="btn" id="btnFristen">Fristen übernehmen</button>') : raw('<p class="small muted">Fristen ändert nur ein Inhaber.</p>')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>${icon('users', 16)} Auskunft zu einer Person</h2></div>
        <div class="card-body">
          <p class="small muted mt0">Alles, was Kontovia zu einem Kunden oder Lieferanten gespeichert hat, als lesbare
            Datei und als vollständige Daten. Für eine Anfrage nach Art. 15 DSGVO oder zum Prüfen vor dem Löschen.</p>
          <div class="field"><label for="arKontakt">Kontakt</label>
            <select id="arKontakt">${kontakte.length ? raw(kontakte.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')) : raw('<option value="">Keine Kontakte</option>')}</select></div>
          <button class="btn" id="btnAuskunft" ${kontakte.length ? '' : 'disabled'}>${icon('export', 15)} Auskunft erstellen</button>
        </div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h2>${icon('calendar', 16)} Jahre</h2><span class="sub">${int(jahre.length)} ${jahre.length === 1 ? 'Jahr' : 'Jahre'}</span></div>
      <div class="card-body">
        ${jahre.length ? raw(`<div class="table-wrap"><table class="data compact">
          <thead><tr><th>Jahr</th><th class="num">Buchungen</th><th class="num">Rechnungen</th><th class="num">Belege</th><th>Festgeschrieben</th><th>Archiv</th><th>Frist bis</th><th>Stand</th><th></th></tr></thead>
          <tbody>${jahre.map((j) => zeile(j, inhaber)).join('')}</tbody>
        </table></div>`) : '<p class="muted">Noch keine Buchungen.</p>'}
        <p class="tiny muted mt8">Das Archiv ist ein gewöhnliches ZIP ohne Passwort, damit es in vielen Jahren noch lesbar ist.
          Legen Sie es an einem geschützten Ort ab. „Prüfen“ vergleicht eine Datei mit der gespeicherten Prüfsumme.
          Löschen geht nur nach Ablauf der Frist und mit Archiv; Belegdateien lassen sich schon nach ihrer kürzeren Frist entfernen.</p>
      </div>
    </div>`;
  wire(root, jahre);
}

function zeile(j, inhaber) {
  const [standText, ton] = STAND[j.status] || ['', ''];
  const archiv = j.archiv
    ? `<span class="nowrap" title="${esc(archivText(j.archiv))}">${esc(fmtDate(String(j.archiv.erstelltAm).slice(0, 10)))}</span>
       <button class="btn sm" data-pruefen="${j.jahr}" title="Eine Archivdatei mit der gespeicherten Prüfsumme vergleichen">Prüfen</button>`
    : '<span class="muted">keins</span>';
  const knoepfe = [];
  if (j.status !== 'geloescht' && (j.buchungen || j.rechnungen)) knoepfe.push(`<button class="btn sm" data-archiv="${j.jahr}">${j.archiv ? 'Archiv neu erstellen' : 'Archiv erstellen'}</button>`);
  if (inhaber && j.archiv && j.belegeFaellig && !j.faellig) knoepfe.push(`<button class="btn sm" data-belege="${j.jahr}" title="Nur die Belegdateien dieses Jahres löschen, die Buchungen bleiben">Belege löschen</button>`);
  if (inhaber && j.status === 'loeschbar') knoepfe.push(`<button class="btn sm danger" data-loeschen="${j.jahr}">Jahr löschen</button>`);
  const frist = j.status === 'geloescht' ? `gelöscht ${esc(fmtDate(String(j.archiv?.geloeschtAm || '').slice(0, 10)))}` : `${esc(fmtDate(j.fristEnde))}${j.belegeFristEnde !== j.fristEnde ? `<br><span class="tiny muted">Belege ${esc(fmtDate(j.belegeFristEnde))}</span>` : ''}`;
  return `<tr>
    <td><strong>${j.jahr}</strong>${j.laufend ? ' <span class="tiny muted">laufend</span>' : ''}</td>
    <td class="num">${int(j.buchungen)}</td>
    <td class="num">${int(j.rechnungen)}</td>
    <td class="num">${int(j.belege)}${j.archiv?.belegeGeloeschtAm ? '<br><span class="tiny muted">Dateien gelöscht</span>' : ''}</td>
    <td>${j.festgeschrieben ? '<span class="badge pos">ja</span>' : '<span class="muted">nein</span>'}</td>
    <td>${archiv}</td>
    <td class="nowrap small">${frist}</td>
    <td><span class="badge ${ton}">${esc(standText)}</span></td>
    <td class="right nowrap">${knoepfe.join(' ')}</td>
  </tr>`;
}

function wire(root, jahre) {
  const busy = async (btn, fn, fehlerTitel = 'Das hat nicht geklappt') => {
    const vorher = [...btn.childNodes];
    btn.disabled = true;
    btn.textContent = 'Arbeite …';
    try { await fn((t) => { btn.textContent = t; }); } catch (e) { err(fehlerTitel, e.message); }
    btn.disabled = false;
    btn.replaceChildren(...vorher);
  };

  $('#btnFristen', root)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await fristenSetzen({ buchhaltung: $('#arJahre', root).value, belege: $('#arBelege', root).value });
    ok('Fristen übernommen', `Buchungen ${r.buchhaltung} Jahre, Belege ${r.belege} Jahre.`);
    draw(root);
  }));

  $('#btnAuskunft', root)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const id = $('#arKontakt', root).value;
    if (!id) return;
    const files = await auskunftDateien(id);
    const res = await api.file.saveMany({ folderLabel: 'Zielordner für die Auskunft', files, zipName: files[0].name.replace(/\.txt$/, '') });
    if (res) ok('Auskunft erstellt', `${res.written.length} Dateien in ${res.dir}`);
  }));

  $$('[data-archiv]', root).forEach((b) => b.addEventListener('click', (e) => busy(e.currentTarget, async (melden) => {
    const jahr = Number(b.dataset.archiv);
    const r = await jahresarchivErstellen(jahr, { version: appInfo.version, melden });
    if (!r.gespeichert) { toast('Nicht gespeichert', 'Das Archiv wurde nicht abgelegt.'); return; }
    ok(`Jahresarchiv ${jahr} erstellt`, `${r.dateiName}. Legen Sie die Datei an einem geschützten Ort ab; die Prüfsumme ist gespeichert.`);
    draw(root);
  }, 'Archiv nicht erstellt')));

  $$('[data-pruefen]', root).forEach((b) => b.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await archivPruefen(Number(b.dataset.pruefen));
    if (!r) return;
    if (r.passt) ok('Archiv unverändert', `${r.datei.name} (${bytes(r.datei.size)}) stimmt mit dem Vermerk vom ${fmtDateTime(r.vermerk.erstelltAm)} überein.`);
    else err('Archiv weicht ab', `${r.datei.name} hat nicht die gespeicherte Prüfsumme. Entweder ist es eine andere Datei, oder sie wurde verändert.`);
  })));

  $$('[data-belege], [data-loeschen]', root).forEach((b) => b.addEventListener('click', async () => {
    const nurBelege = 'belege' in b.dataset;
    const jahr = Number(nurBelege ? b.dataset.belege : b.dataset.loeschen);
    if (store.nutzer && !darf(store.nutzer.rolle, 'archiv.loeschen')) { err('Nicht erlaubt', verbotText(store.nutzer.rolle)); return; }
    const j = jahre.find((x) => x.jahr === jahr);
    const plan = loeschplan(store.db, jahr, { nurBelege });
    const weiter = await loeschenBestaetigen(j, plan, nurBelege);
    if (!weiter) return;
    try {
      const r = await jahrLoeschen(jahr, { nurBelege, kontakte: weiter.kontakte });
      ok(nurBelege ? `Belegdateien ${jahr} gelöscht` : `Jahr ${jahr} gelöscht`, `${r.text}. Der Eintrag im Änderungsjournal nennt das Archiv und seine Prüfsumme.`);
    } catch (e) {
      err('Löschen fehlgeschlagen', e.message);
    }
    draw(root);
  }));
}

/**
 * Die Rückfrage vor dem Löschlauf, zweifach: Häkchen für Archiv und Prüfung,
 * dazu das Jahr eintippen. Liefert null oder {kontakte}.
 */
function loeschenBestaetigen(j, plan, nurBelege) {
  return new Promise((resolve) => {
    let fertig = false;
    const m = modal({
      title: nurBelege ? `Belegdateien ${j.jahr} löschen?` : `Jahr ${j.jahr} endgültig löschen?`,
      body: html`
        <p class="mt0" style="line-height:1.6">
          ${nurBelege
            ? `Die Belegdateien des Jahres ${j.jahr} werden vom Gerät und beim nächsten Abgleich aus der Cloud entfernt. Die Buchungen bleiben.`
            : `Das Jahr ${j.jahr} wird aus Kontovia entfernt, auch auf Ihren anderen Geräten beim nächsten Abgleich. Das lässt sich nicht rückgängig machen; es bleibt nur das Archiv.`}
        </p>
        <p class="small"><strong>Gelöscht wird:</strong> ${loeschplanText(plan)}.</p>
        <p class="small"><strong>Archiv:</strong> ${archivText(j.archiv)}</p>
        <label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="lbArchiv" style="margin-top:3px">
          <span>Das Archiv liegt an einem sicheren Ort, und ich habe es mit „Prüfen“ gegen die Prüfsumme verglichen.</span></label>
        <label class="row small mt8" style="gap:8px;align-items:flex-start"><input type="checkbox" id="lbPruefung" style="margin-top:3px">
          <span>Für dieses Jahr läuft keine Betriebsprüfung, kein Einspruch und kein Verfahren, das die Frist verlängert.</span></label>
        ${nurBelege ? '' : raw(`<label class="row small mt8" style="gap:8px;align-items:flex-start"><input type="checkbox" id="lbKontakte" checked style="margin-top:3px">
          <span>Kontakte mitlöschen, auf die danach nichts mehr verweist (${int(plan.contacts.length)}).</span></label>`)}
        <div class="field mt16"><label for="lbJahr">Zur Bestätigung das Jahr eintippen</label><input id="lbJahr" inputmode="numeric" autocomplete="off" placeholder="${j.jahr}"></div>`,
      foot: '<button class="btn" data-no>Abbrechen</button><button class="btn danger" data-yes disabled>Endgültig löschen</button>',
      onClose: () => { if (!fertig) resolve(null); },
    });
    const ja = m.root.querySelector('[data-yes]');
    const pruefen = () => {
      ja.disabled = !(m.body.querySelector('#lbArchiv').checked && m.body.querySelector('#lbPruefung').checked && m.body.querySelector('#lbJahr').value.trim() === String(j.jahr));
    };
    m.body.addEventListener('input', pruefen);
    m.body.addEventListener('change', pruefen);
    m.root.querySelector('[data-no]').addEventListener('click', () => { fertig = true; m.close(); resolve(null); });
    ja.addEventListener('click', () => {
      if (ja.disabled) return;
      fertig = true;
      const kontakte = nurBelege ? false : !!m.body.querySelector('#lbKontakte')?.checked;
      m.close();
      resolve({ kontakte });
    });
  });
}

export { warn };
