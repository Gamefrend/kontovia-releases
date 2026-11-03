/**
 * Kontovia – Karte „Belege automatisch holen“ unter Import & Export › Import (SEC-62).
 *
 * Eingangsordner wählen und prüfen, Absender für das Outlook-Postfach festlegen und das Postfach prüfen. Gefundene
 * Belege stehen in einer Liste; „Öffnen“ bringt sie ins Buchungsfenster oder zu den E-Rechnungen, „Ausblenden“ merkt
 * sie als erledigt. Gebucht wird nichts von selbst. Beim Entsperren zeigt `ordnerHinweis` einen Hinweis, wenn im
 * Eingangsordner Neues liegt. Lesen: src/web/belegeingang.js; Merken und Übernehmen: lib/belegeingang.js.
 */

import { html, raw, $, $$, fmtDate, todayISO, addDays } from '../lib/util.js';
import { icon, ok, err, warn, toast } from '../lib/ui.js';
import { kann } from '../lib/lizenz.js';
import { navigate } from '../lib/router.js';
import { einstellung, absenderLesen, absenderSpeichern, gesehenMerken, belegArt, alsDatei } from '../lib/belegeingang.js';

const api = window.kontovia;
/** Gefundene Belege dieser Sitzung (Postfach mit Inhalt, Ordner ohne). Sperren lädt die Seite neu. */
let funde = [];
let seit = addDays(todayISO(), -30);

const groesse = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function belegeingangKarte(host) {
  const [ordner, postfach] = await Promise.all([api.belegeingang.ordnerStatus().catch(() => ({})), api.belegeingang.postfachStatus().catch(() => ({}))]);
  if (!host.isConnected) return;
  const e = einstellung();
  const ordnerText = !ordner.moeglich
    ? 'Dieser Browser kann keinen Ordner lesen. Das geht mit Chrome oder Edge am Computer.'
    : ordner.name ? `Kontovia schaut in „${ordner.name}“ nach neuen PDF-Dateien, Fotos und E-Rechnungen.` : 'Wählen Sie einen Ordner, in dem Ihre Rechnungen landen, etwa den Download-Ordner. Kontovia liest dort nur und zeigt Neues an.';
  host.innerHTML = html`
    <div class="card-head"><h2 data-krone="belegeingang">${icon('folder', 16)} Belege automatisch holen</h2><span class="sub">aus einem Ordner oder aus Outlook</span></div>
    <div class="card-body">
      <h3 class="mt0">Eingangsordner</h3>
      <p class="small muted mt0">${ordnerText}</p>
      ${ordner.moeglich ? raw(html`<div class="row wrap" style="gap:8px">
        <button type="button" class="btn" id="beOrdner" data-premium="belegeingang">${icon('folder', 15)} ${ordner.name ? 'Anderen Ordner wählen' : 'Ordner wählen'}</button>
        ${ordner.name ? raw(html`<button type="button" class="btn ${ordner.zugriff === 'granted' ? '' : 'primary'}" id="beOrdnerPruefen" data-premium="belegeingang">${icon('refresh', 15)} ${ordner.zugriff === 'granted' ? 'Ordner prüfen' : 'Zugriff erlauben und prüfen'}</button>
          <button type="button" class="btn ghost" id="beOrdnerWeg">Nicht mehr verwenden</button>`) : ''}
      </div>`) : ''}
      <h3>Outlook-Postfach</h3>
      ${postfach.verfuegbar ? raw(html`
        <p class="small muted mt0">Kontovia fragt Ihr Outlook-Postfach (Outlook.com oder Microsoft 365) nach E-Mails mit Anhang, aber nur von den Absendern, die Sie hier nennen. Gelesen werden nur die Anhänge. Microsoft fragt beim ersten Mal, ob Sie das erlauben.</p>
        <div class="field"><label for="beAbsender">Absender, eine Adresse oder @domain je Zeile</label>
          <textarea id="beAbsender" rows="3" placeholder="rechnung@lieferant.de&#10;@telekom.de">${e.absender.join('\n')}</textarea></div>
        <div class="row wrap" style="gap:8px;align-items:flex-end">
          <div class="field mb0"><label for="beSeit">E-Mails ab</label><input type="date" id="beSeit" value="${seit}" max="${todayISO()}"></div>
          <button type="button" class="btn" id="bePostfach" data-premium="belegeingang">${icon('refresh', 15)} Postfach prüfen</button>
          ${postfach.bereit ? raw(html`<button type="button" class="btn ghost" id="bePostfachAb">Abmelden${postfach.email ? ` (${postfach.email})` : ''}</button>`) : ''}
        </div>`) : raw(html`<p class="small muted mt0">Der Weg über Outlook ist in Kontovia nicht eingerichtet.</p>`)}
      <div id="beListe" class="mt16"></div>
    </div>`;

  const neu = () => belegeingangKarte(host);
  $('#beOrdner', host)?.addEventListener('click', async () => {
    try { await api.belegeingang.ordnerWaehlen(); ok('Eingangsordner gewählt'); await neu(); await ordnerPruefen(host, true); } catch (x) { if (x.code !== 'ABGEBROCHEN') err('Ordner nicht gewählt', x.message); }
  });
  $('#beOrdnerPruefen', host)?.addEventListener('click', async () => {
    if (ordner.zugriff !== 'granted' && await api.belegeingang.ordnerZugriff() !== 'granted') { warn('Kein Zugriff', 'Ohne Ihre Erlaubnis kann Kontovia den Ordner nicht lesen.'); return; }
    await ordnerPruefen(host, true);
    if (ordner.zugriff !== 'granted') neu();
  });
  $('#beOrdnerWeg', host)?.addEventListener('click', async () => { await api.belegeingang.ordnerVergessen(); funde = funde.filter((f) => f.quelle !== 'ordner'); neu(); });
  $('#beSeit', host)?.addEventListener('change', (ev) => { seit = ev.target.value || seit; });
  $('#bePostfach', host)?.addEventListener('click', () => postfachPruefen(host));
  $('#bePostfachAb', host)?.addEventListener('click', async () => { await api.belegeingang.postfachAbmelden(); neu(); });
  listeZeigen(host);
}

async function ordnerPruefen(host, meldung) {
  try {
    const liste = await api.belegeingang.ordnerNeue(einstellung().gesehen);
    funde = [...funde.filter((f) => f.quelle !== 'ordner'), ...liste.map((f) => ({ ...f, quelle: 'ordner' }))];
    if (meldung) ok(liste.length ? `${liste.length} neue ${liste.length === 1 ? 'Datei' : 'Dateien'} im Ordner` : 'Nichts Neues im Ordner');
  } catch (x) { err('Ordner nicht lesbar', x.message); }
  listeZeigen(host);
}

function postfachPruefen(host) {
  const gelesen = absenderLesen($('#beAbsender', host)?.value);
  if (gelesen.fehler) { warn('Absender prüfen', gelesen.fehler); return; }
  if (!gelesen.liste.length) { warn('Kein Absender', 'Nennen Sie mindestens eine Adresse, von der Ihre Rechnungen kommen.'); return; }
  // Das Fenster bei Microsoft muss im selben Zug wie der Klick aufgehen: zuerst die Anfrage starten, dann speichern.
  const anfrage = api.belegeingang.postfachHolen({ absender: gelesen.liste, seit, gesehen: einstellung().gesehen });
  (async () => {
    // Die Absender bleiben, auch wenn die Anmeldung scheitert.
    if (JSON.stringify(gelesen.liste) !== JSON.stringify(einstellung().absender)) await absenderSpeichern(gelesen.liste).catch((x) => err('Absender nicht gespeichert', x.message));
    try {
      const liste = await anfrage;
      funde = [...funde.filter((f) => f.quelle !== 'postfach'), ...liste.map((f) => ({ ...f, quelle: 'postfach' }))];
      ok(liste.length ? `${liste.length} neue ${liste.length === 1 ? 'Beleg' : 'Belege'} in Outlook` : 'Nichts Neues in Outlook');
    } catch (x) {
      if (x.code !== 'ABGEBROCHEN') err('Postfach nicht geprüft', x.message);
    }
    belegeingangKarte(host);
  })();
}

function listeZeigen(host) {
  const ziel = $('#beListe', host);
  if (!ziel) return;
  if (!funde.length) { ziel.innerHTML = ''; return; }
  ziel.innerHTML = html`
    <h3 class="mt0">Neu gefunden</h3>
    <div class="nutzer-tabelle">${funde.map((f, i) => raw(html`
      <div class="zugang-zeile">
        <div><strong>${f.name}</strong>
          <div class="small muted">${f.quelle === 'postfach' ? `Outlook, von ${f.von}${f.betreff ? `: ${f.betreff}` : ''}` : 'Eingangsordner'} · ${fmtDate(String(f.datum).slice(0, 10))} · ${groesse(f.groesse)}</div></div>
        <div class="row" style="gap:6px"><button type="button" class="btn sm primary" data-oeffnen="${i}">Öffnen</button><button type="button" class="btn sm ghost" data-aus="${i}">Ausblenden</button></div>
      </div>`))}</div>`;
  $$('[data-oeffnen]', ziel).forEach((b) => b.addEventListener('click', () => oeffnen(funde[Number(b.dataset.oeffnen)], host)));
  $$('[data-aus]', ziel).forEach((b) => b.addEventListener('click', async () => {
    const f = funde[Number(b.dataset.aus)];
    await gesehenMerken([f.kennung], `Beleg ausgeblendet: ${f.name}`).catch((x) => err('Nicht gemerkt', x.message));
    funde = funde.filter((x) => x !== f);
    listeZeigen(host);
  }));
}

async function oeffnen(f, host) {
  if (!f) return;
  if (!kann('belegeingang')) return;
  try {
    const voll = f.dataBase64 ? f : { ...f, ...(await api.belegeingang.ordnerLesen(f.kennung)) };
    const art = belegArt(voll);
    if (!art) { warn('Kein Beleg', 'Diese Datei ist weder ein PDF noch ein Foto noch eine E-Rechnung.'); return; }
    await gesehenMerken([f.kennung], `Beleg übernommen: ${f.name}${f.quelle === 'postfach' ? ` (Outlook, ${f.von})` : ' (Eingangsordner)'}`);
    funde = funde.filter((x) => x !== f);
    listeZeigen(host);
    if (art === 'erechnung') {
      const { eingangHinzufuegen } = await import('./rechnungen.js');
      await eingangHinzufuegen({ name: voll.name, dataBase64: voll.dataBase64 });
      // Das Hinzufügen zeichnet die Ansicht neu; zurück zum Reiter Import, damit die übrigen Funde sichtbar bleiben.
      navigate('export', { reiter: 'import' });
    } else {
      const { openTransactionDialog } = await import('./transactions.js');
      openTransactionDialog(null, 'expense', { dateien: [alsDatei(voll)] });
    }
  } catch (x) { err('Nicht geöffnet', x.message); }
}

/** Beim Entsperren: Liegt im Eingangsordner Neues (und ist der Zugriff schon erlaubt), ein kurzer Hinweis. */
export async function ordnerHinweis() {
  if (!api?.belegeingang || !kann('belegeingang')) return;
  const st = await api.belegeingang.ordnerStatus().catch(() => null);
  if (!st?.name || st.zugriff !== 'granted') return;
  const liste = await api.belegeingang.ordnerNeue(einstellung().gesehen).catch(() => []);
  if (!liste.length) return;
  toast('Neue Belege', `Im Eingangsordner ${liste.length === 1 ? 'liegt eine neue Datei' : `liegen ${liste.length} neue Dateien`}. Sie finden sie unter Import & Export › Import.`, '', 9000);
}
