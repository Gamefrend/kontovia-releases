/**
 * Kontovia – schlichtes Markdown für die Datenschutzhinweise.
 *
 * Kein vollständiger Markdown-Leser, sondern genau das, was DATENSCHUTZ.md
 * verwendet: Überschriften, Absätze, Aufzählungen mit eingerückten
 * Folgezeilen, eingerückte Blöcke, Zitate, Trennlinien, **fett**, *kursiv*
 * und `Code`. Alles wird zuerst maskiert – aus dem Text kann kein Markup
 * werden, das nicht hier steht. HTML-Kommentare (Hinweise für den Betreiber)
 * fallen weg.
 */

import { esc } from './util.js';

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
}

/** @param {string} md  @returns {string} HTML */
export function markdownZuHtml(md) {
  const zeilen = String(md ?? '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let absatz = [];
  let liste = null;
  let zitat = [];
  let block = [];

  const schliessen = () => {
    if (absatz.length) out.push(`<p>${inline(absatz.join(' '))}</p>`);
    if (liste) out.push(`<ul>${liste.map((p) => `<li>${inline(p)}</li>`).join('')}</ul>`);
    if (zitat.length) out.push(`<blockquote>${inline(zitat.join(' '))}</blockquote>`);
    if (block.length) out.push(`<pre>${esc(block.join('\n'))}</pre>`);
    absatz = [];
    liste = null;
    zitat = [];
    block = [];
  };

  for (const zeile of zeilen) {
    if (!zeile.trim()) { schliessen(); continue; }
    const kopf = /^(#{1,4})\s+(.*)$/.exec(zeile);
    if (kopf) {
      schliessen();
      // Im Fenster trägt der Titel schon die Überschrift – darunter geht es eine Stufe kleiner weiter.
      const stufe = Math.min(5, kopf[1].length + 2);
      out.push(`<h${stufe}>${inline(kopf[2])}</h${stufe}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(zeile)) { schliessen(); out.push('<hr>'); continue; }
    const punkt = /^[*-]\s+(.*)$/.exec(zeile);
    if (punkt) {
      if (!liste) schliessen();
      liste ??= [];
      liste.push(punkt[1]);
      continue;
    }
    if (liste && /^\s+\S/.test(zeile)) { liste[liste.length - 1] += ' ' + zeile.trim(); continue; }
    if (/^>\s?/.test(zeile)) {
      if (!zitat.length) schliessen();
      zitat.push(zeile.replace(/^>\s?/, ''));
      continue;
    }
    if (/^ {4}/.test(zeile) && !absatz.length) {
      if (!block.length) schliessen();
      block.push(zeile.slice(4));
      continue;
    }
    if (liste || zitat.length || block.length) schliessen();
    absatz.push(zeile.trim());
  }
  schliessen();
  return out.join('\n');
}
