/**
 * Kontovia – Berichte drucken und als PDF sichern, Web-Fassung.
 *
 * Die Windows-Fassung rendert den Bericht in einem unsichtbaren Fenster und
 * schreibt die PDF-Datei selbst. Einen PDF-Erzeuger hat ein Browser nicht –
 * aber jeder Druckdialog kann „Als PDF sichern“, auf dem iPhone über das
 * Teilen-Menü im Druckfenster. Das Ergebnis ist ein echtes PDF mit
 * markierbarem Text, kein Bildschirmfoto.
 *
 * Gedruckt wird die Seite selbst: der Bericht wird in einen Schattenbaum
 * eingesetzt, damit sich seine Formatierung und die der Anwendung nicht
 * gegenseitig verändern, und alles andere wird für den Druck ausgeblendet.
 * Ein unsichtbarer Rahmen wäre einfacher, druckt auf dem iPhone aber die
 * ganze Seite statt seines Inhalts.
 */

let laufend = null;

/**
 * @param {string} html  vollständiges Berichtsdokument aus lib/reports.js
 * @param {{landscape?:boolean, titel?:string}} opts
 * @returns {Promise<void>} erfüllt, sobald der Druckdialog geschlossen ist
 */
export function drucken(html, { landscape = false, titel = 'Bericht' } = {}) {
  laufend?.();

  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    // Das Seitenformat gilt nur im Hauptdokument, siehe unten.
    .replace(/@page\s*\{[^}]*\}/g, '')
    // Im Schattenbaum gibt es kein body; der Wirt übernimmt dessen Rolle.
    .replace(/(^|[\s,}])body(?=[\s,{.:#[])/g, '$1:host');

  const host = document.createElement('div');
  host.id = 'kv-druck';
  const root = host.attachShadow({ mode: 'open' });
  // Der Bericht enthält keine Skripte; die Richtlinie der Seite (script-src
  // 'self') verhindert ohnehin, dass eingebettete Anweisungen ausgeführt würden.
  root.innerHTML = `<style>:host{display:block;background:#fff;color:#14181d}${css}</style>${doc.body.innerHTML}`;
  document.body.append(host);

  const seite = document.createElement('style');
  seite.id = 'kv-druck-seite';
  seite.textContent = `@page {
    size: A4 ${landscape ? 'landscape' : 'portrait'};
    margin: 14mm 12.7mm 15mm;
    @bottom-left { content: "Erstellt mit Kontovia"; font: 8px system-ui, sans-serif; color: #8a8f98; }
    @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 8px system-ui, sans-serif; color: #8a8f98; }
  }`;
  document.head.append(seite);

  // Chrome und Safari schlagen den Seitentitel als Dateinamen vor.
  const alterTitel = document.title;
  document.title = String(titel).replace(/\.pdf$/i, '');

  return new Promise((resolve) => {
    const aufraeumen = () => {
      window.removeEventListener('afterprint', aufraeumen);
      document.title = alterTitel;
      seite.remove();
      host.remove();
      laufend = null;
      resolve();
    };
    laufend = aufraeumen;
    window.addEventListener('afterprint', aufraeumen);
    // Erst nach dem nächsten Bildaufbau drucken – Safari hat das eingesetzte
    // Dokument sonst noch nicht gesetzt und druckt leere Seiten.
    requestAnimationFrame(() => setTimeout(() => window.print(), 60));
  });
}
