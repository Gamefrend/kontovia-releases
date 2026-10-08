/**
 * Kontovia – Rechtstexte in der Anwendung: Impressum, Nutzungsbedingungen,
 * Datenschutzhinweise und die Lizenz der mitgelieferten Schrift.
 *
 * Die Texte liegen als Markdown bei den Programmdateien (scripts/recht.js setzt
 * die Angaben des Betreibers ein) und werden hier in einem Fenster angezeigt,
 * auch ohne Netz und schon vor dem Entsperren: Das Impressum muss ohne
 * Anmeldung erreichbar sein.
 *
 * Die Zustimmung zu den Nutzungsbedingungen steht im Tresor (`settings.nutzung`)
 * mit der Fassung, der zugestimmt wurde. Ändert sich der Text inhaltlich, hebt
 * man NUTZUNG_VERSION an, und jedes Konto stimmt beim nächsten Entsperren erneut zu.
 */

import { esc, html } from './util.js';
import { modal } from './ui.js';
import { store, commit } from './store.js';
import { markdownZuHtml } from './markdown.js';

const api = window.kontovia;

/*
 * Hinweis auf die Entwicklungsphase. Steht groß auf Einrichtung und
 * Sperrbildschirm und als feste Leiste über jeder Ansicht; lässt sich
 * absichtlich nicht wegklicken, solange Kontovia nicht fertig ist.
 */
export const ENTWICKLUNG_TITEL = 'Kontovia ist noch in Entwicklung';
export const ENTWICKLUNG_TEXT = 'Diese Fassung ist eine Testversion. Für Ihre Daten, für Datenverlust und für die Richtigkeit von Berechnungen, '
  + 'Auswertungen und Meldungen ans Finanzamt übernehmen wir, soweit gesetzlich zulässig, keine Haftung und keine Gewährleistung. '
  + 'Bewahren Sie Belege und Unterlagen zusätzlich auf, legen Sie regelmäßig Sicherungen an und prüfen Sie Ergebnisse, bevor Sie sie verwenden.';

/** Großer Kasten für Einrichtung und Sperrbildschirm. */
export function entwicklungsKasten() {
  return `<div class="entwicklung-kasten" role="note">
    <strong>${esc(ENTWICKLUNG_TITEL)}</strong>
    <p>${esc(ENTWICKLUNG_TEXT)}</p>
  </div>`;
}

/** Schmale, feste Leiste über den Ansichten. */
export function entwicklungsLeiste() {
  return `<div class="entwicklung-leiste" role="note"><strong>${esc(ENTWICKLUNG_TITEL)}:</strong>
    <span>Testversion ohne Haftung und Gewährleistung für Ihre Daten. Bitte Sicherungen anlegen und Ergebnisse prüfen.</span>
    <a href="#" data-entwicklung-mehr>Mehr dazu</a></div>`;
}

/** Fassung der Nutzungsbedingungen (siehe NUTZUNGSBEDINGUNGEN.md, „Fassung vom …“). */
export const NUTZUNG_VERSION = '2026-10-06';

export const RECHTSTEXTE = {
  impressum: 'Impressum',
  nutzung: 'Nutzungsbedingungen',
  datenschutz: 'Datenschutzhinweise',
  schrift: 'Lizenz der Schrift Geist',
};

/** Der Text als HTML. Wirft, wenn er in dieser Fassung fehlt. */
async function textLaden(welcher) {
  const text = await api.app.legalText(welcher);
  // Die Lizenz der Schrift ist ein englischer Reintext, die anderen sind Markdown.
  return welcher === 'schrift' ? `<pre>${esc(text)}</pre>` : markdownZuHtml(text);
}

/** Zeigt einen Rechtstext in einem Fenster. */
export async function rechtstextZeigen(welcher) {
  const m = modal({
    title: RECHTSTEXTE[welcher] || 'Rechtliches',
    size: 'wide',
    body: '<div class="skeleton" style="height:240px"></div>',
    foot: '<button class="btn primary" data-x>Schließen</button>',
  });
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  try {
    // Rechtstexte gelten in der deutschen Fassung; die Übersetzung (sprache.js) lässt sie aus.
    m.body.innerHTML = `<div class="legal" translate="no" lang="de">${await textLaden(welcher)}</div>`;
  } catch (e) {
    m.body.innerHTML = html`<div class="notice danger">${e.message}</div>`;
  }
  return m;
}

/** Die Links „Impressum · Datenschutz · Nutzungsbedingungen“ für den Fuß einer Seite. */
export function rechtsfuss(klasse = 'rechtsfuss') {
  return `<nav class="${klasse}" aria-label="Rechtliches">
    <a href="#" data-recht="impressum">Impressum</a><span aria-hidden="true">·</span>
    <a href="#" data-recht="datenschutz">Datenschutz</a><span aria-hidden="true">·</span>
    <a href="#" data-recht="nutzung">Nutzungsbedingungen</a></nav>`;
}

/** Macht jedes `[data-recht]` unterhalb von `root` zum Link auf den jeweiligen Text. */
export function rechtslinks(root) {
  root.querySelectorAll('[data-recht]').forEach((a) => {
    if (a.dataset.rechtVerdrahtet) return;
    a.dataset.rechtVerdrahtet = '1';
    a.addEventListener('click', (e) => { e.preventDefault(); rechtstextZeigen(a.dataset.recht); });
  });
}

/* -------------------------------------------------------------------------- */
/* Zustimmung                                                                  */
/* -------------------------------------------------------------------------- */

/** Hat dieses Konto der aktuellen Fassung zugestimmt? */
export function nutzungAngenommen(db = store.db) {
  return db?.settings?.nutzung?.version === NUTZUNG_VERSION;
}

/** Hält die Zustimmung zur aktuellen Fassung im Tresor fest (und im Änderungsjournal). */
export async function nutzungVermerken(appVersion = '') {
  await commit('nutzung.zustimmen', (db) => {
    db.settings.nutzung = { version: NUTZUNG_VERSION, am: new Date().toISOString(), programm: String(appVersion || '') };
    db.settings.updatedAt = new Date().toISOString();
  }, { entity: 'einstellungen', summary: `Nutzungsbedingungen, Fassung ${NUTZUNG_VERSION}, zugestimmt` });
}

/**
 * Fragt nach der Zustimmung, wenn dieses Konto der aktuellen Fassung noch nicht
 * zugestimmt hat (bestehende Konten beim ersten Start mit dieser Version, oder
 * nach einer inhaltlichen Änderung). Wartet, bis entschieden ist.
 * @param {{sperren?:()=>unknown, appVersion?:string}} opts  sperren: wird bei „Ablehnen“ aufgerufen
 * @returns {Promise<boolean>} wurde zugestimmt?
 */
export function nutzungPruefen({ sperren, appVersion = '' } = {}) {
  if (!store.db || nutzungAngenommen()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let fertig = false;
    const ende = (wert) => { if (!fertig) { fertig = true; resolve(wert); } };
    const frueher = store.db.settings?.nutzung?.version;
    const m = modal({
      title: 'Nutzungsbedingungen',
      size: 'wide',
      body: `<p class="mt0 small muted">${frueher ? 'Die Nutzungsbedingungen haben sich geändert.' : 'Bitte lesen Sie die Nutzungsbedingungen, bevor Sie Kontovia weiter verwenden.'}
        Die wichtigsten Punkte: Kontovia ersetzt keine Steuerberatung; Sie sind für Ihre Angaben, Ihr Passwort und Ihre Sicherungen verantwortlich;
        Ihre Daten bleiben verschlüsselt bei Ihnen. Auch die <a href="#" data-recht="datenschutz">Datenschutzhinweise</a> stehen zur Ansicht bereit.</p>
        <div class="legal" id="nutzungText"><div class="skeleton" style="height:240px"></div></div>`,
      foot: '<button class="btn" data-nein>Ablehnen und sperren</button><button class="btn primary" data-ja>Einverstanden</button>',
      // Ohne Entscheidung lässt sich das Fenster nicht wegklicken.
      closable: false,
    });
    rechtslinks(m.root);
    textLaden('nutzung')
      .then((h) => { const z = m.root.querySelector('#nutzungText'); if (z) z.innerHTML = h; })
      .catch((e) => { const z = m.root.querySelector('#nutzungText'); if (z) z.innerHTML = html`<div class="notice danger">${e.message}</div>`; });
    m.root.querySelector('[data-nein]').addEventListener('click', () => { ende(false); m.close(); sperren?.(); });
    m.root.querySelector('[data-ja]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await nutzungVermerken(appVersion); } catch { /* der nächste Start fragt noch einmal */ }
      ende(true);
      m.close();
    });
  });
}
