/**
 * Kontovia – Verfahrensdokumentation (Reiter „Verfahren“ unter Import & Export).
 *
 * Erstellt die Beschreibung der Buchführung als PDF (lib/verfahrensdoku.js,
 * lib/dokument.js) und nimmt die eigenen Abläufe des Betriebs als Freitext
 * auf (settings.verfahrensdoku, nur Inhaber: Aktion einstellung.verfahrensdoku).
 * Das Dokument erscheint in der Sprache der Oberfläche, die eigenen Texte so,
 * wie sie geschrieben wurden.
 */

import { html, raw, esc, $, todayISO, fmtDateTime } from '../lib/util.js';
import { icon, ok, err } from '../lib/ui.js';
import { store, commit, verifyAudit } from '../lib/store.js';
import { appInfo } from '../app.js';
import { darf } from '../lib/rollen.js';
import { FELDER, MAX_TEXT, ergaenzungen, ausgefuellt, verfahrensdokuPdf } from '../lib/verfahrensdoku.js';
import { pdfSpeichern, pdfZeigen, drucken, druckenMoeglich } from '../lib/pdfausgabe.js';

const api = window.kontovia;

export async function render(root) {
  draw(root);
}

function draw(root) {
  const s = store.db?.settings || {};
  const e = ergaenzungen(s);
  const inhaber = !store.nutzer || darf(store.nutzer.rolle, 'einstellung.verfahrensdoku');
  const n = ausgefuellt(s);

  root.innerHTML = html`
    <div class="notice mb16">
      <strong>Wie Ihre Buchführung läuft, auf einen Blick.</strong> Bei einer Betriebsprüfung fragt das Finanzamt,
      wie Belege ankommen, gebucht und aufbewahrt werden. Kontovia schreibt diese Beschreibung aus Ihren Einstellungen
      und Daten. Ergänzen Sie unten Ihre eigenen Abläufe; das Dokument ist eine Vorlage und keine Rechtsberatung.
    </div>

    <div class="card">
      <div class="card-head"><h2>${icon('file', 16)} Verfahrensdokumentation</h2></div>
      <div class="card-body">
        <p class="small muted mt0">Enthält Firma und Steuerstatus, Programmfassung, Benutzer und Rollen, Konten und Kontenrahmen,
          den Weg vom Beleg zur Buchung, Festschreibung und Änderungsjournal, Sicherung und Cloud, Archiv und Fristen
          sowie Ihre Ergänzungen und ein Feld für die Freigabe.</p>
        <p class="small">${n === FELDER.length ? 'Alle Ergänzungen sind ausgefüllt.' : `Ausgefüllt: ${n} von ${FELDER.length} Ergänzungen.`}</p>
        <div class="row wrap" style="gap:8px">
          <button class="btn primary" id="vdSpeichern">${icon('export', 15)} Als PDF speichern</button>
          <button class="btn" id="vdZeigen">${icon('eye', 15)} Ansehen</button>
          ${druckenMoeglich() ? raw(`<button class="btn" id="vdDrucken">${icon('print', 15).__raw} Drucken</button>`) : ''}
        </div>
      </div>
    </div>

    <div class="card mt16">
      <div class="card-head"><h2>${icon('save', 16)} Ihre Abläufe</h2></div>
      <div class="card-body">
        <p class="small muted mt0">Was Kontovia nicht wissen kann, beschreiben Sie hier in eigenen Worten. Ein leeres Feld
          erscheint im Dokument als Frage, die noch offen ist.</p>
        ${raw(FELDER.map((f) => `<div class="field"><label for="vd_${f.id}">${esc(f.titel)}</label>
          <textarea id="vd_${f.id}" rows="4" maxlength="${MAX_TEXT}" placeholder="${esc(f.frage)}" ${inhaber ? '' : 'disabled'}>${esc(e[f.id])}</textarea></div>`).join(''))}
        ${inhaber
          ? raw('<button class="btn" id="vdUebernehmen">Ergänzungen übernehmen</button>')
          : raw('<p class="small muted">Die Ergänzungen ändert nur ein Inhaber.</p>')}
        ${e.geaendertAm ? raw(`<p class="tiny muted mt8">${esc(`Zuletzt geändert: ${fmtDateTime(e.geaendertAm)}`)}</p>`) : ''}
      </div>
    </div>`;
  wire(root);
}

/** Das Dokument mit allem, was nur die Oberfläche weiß. */
async function dokument() {
  const [storage, cloud, journal] = await Promise.all([
    api.vault.storage().catch(() => null),
    api.cloud.status().catch(() => null),
    verifyAudit().catch(() => null),
  ]);
  return verfahrensdokuPdf(store.db, { heute: todayISO(), version: appInfo.version, storage, cloud, journal });
}

function wire(root) {
  const name = () => `Verfahrensdokumentation_${todayISO()}.pdf`;
  const ausgeben = async (wie) => {
    try {
      const doc = await dokument();
      if (wie === 'drucken') { await drucken(doc, name()); return; }
      if (wie === 'zeigen') { await pdfZeigen(doc, name()); return; }
      const pfad = await pdfSpeichern(doc, name());
      if (pfad) ok('PDF gespeichert', pfad);
    } catch (e) {
      err('PDF konnte nicht erstellt werden', e.message);
    }
  };
  $('#vdSpeichern', root)?.addEventListener('click', () => ausgeben('speichern'));
  $('#vdZeigen', root)?.addEventListener('click', () => ausgeben('zeigen'));
  $('#vdDrucken', root)?.addEventListener('click', () => ausgeben('drucken'));

  $('#vdUebernehmen', root)?.addEventListener('click', async () => {
    const neu = {};
    for (const f of FELDER) neu[f.id] = String($(`#vd_${f.id}`, root).value || '').trim().slice(0, MAX_TEXT);
    try {
      await ergaenzungenSetzen(neu);
      ok('Ergänzungen übernommen', 'Sie stehen ab jetzt in der Verfahrensdokumentation.');
      draw(root);
    } catch (e) {
      err('Nicht übernommen', e.message);
    }
  });
}

/** Speichert die Freitexte in settings.verfahrensdoku (nur Inhaber: einstellung.*). */
export async function ergaenzungenSetzen(texte) {
  const felder = FELDER.filter((f) => texte[f.id] !== undefined).map((f) => f.titel);
  await commit('einstellung.verfahrensdoku', (d) => {
    const v = {};
    for (const f of FELDER) v[f.id] = String(texte[f.id] ?? '').slice(0, MAX_TEXT);
    v.geaendertAm = new Date().toISOString();
    d.settings.verfahrensdoku = v;
  }, { entity: 'einstellungen', summary: `Verfahrensdokumentation: ${felder.length} Ergänzungen` });
}
