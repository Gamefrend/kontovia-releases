/**
 * Kontovia – Editor für formatierten Text (Aufgaben).
 *
 * Der Editor ist ein beschreibbares Feld mit einer kleinen Werkzeugleiste:
 * fett, kursiv, unterstrichen, Überschrift, Listen, Link, Bild. Eingefügter
 * Text und alles, was gespeichert wird, läuft durch `bereinigen`
 * (lib/richtext.js). Bilder liegen als Beleg im Tresor; im Text steht nur
 * ihre Kennung.
 */

import { esc } from './util.js';
import { icon, err } from './ui.js';
import { commit, removeAttachmentRecord, sel } from './store.js';
import { bereinigen, linkErlaubt, klartext, bildIds, aufgabenHtml } from './richtext.js';
import { bildAblegen, bildWaehlen, bildHolen } from './rechnungsdateien.js';
import { bilderAusZwischenablage } from './textbearbeiten.js';

const api = globalThis.window?.kontovia || {};

/* -------------------------------------------------------------------------- */
/* Bilder                                                                      */
/* -------------------------------------------------------------------------- */

/** Setzt die Adresse in alle Bilder unterhalb von `root`. */
export function bilderEinsetzen(root) {
  for (const img of root.querySelectorAll('img[data-att]')) {
    if (img.getAttribute('src')) continue;
    img.classList.add('rt-laedt');
    bildHolen(img.dataset.att).then((b) => {
      img.classList.remove('rt-laedt');
      if (b?.url && img.isConnected) img.src = b.url;
      else if (img.isConnected) {
        img.classList.add('rt-fehlt');
        img.alt = 'Bild nicht verfügbar';
        img.title = 'Das Bild liegt nicht auf diesem Gerät. Nach dem nächsten Abgleich erscheint es hier.';
      }
    });
  }
}

/**
 * Entfernt Bilder, die keine Aufgabe mehr zeigt (Beleg und Datei).
 * @param {string[]} ids
 */
export async function bilderEntfernen(ids) {
  if (!ids?.length) return;
  const gebraucht = new Set(sel.todos().flatMap((t) => bildIds(aufgabenHtml(t))));
  for (const id of ids) {
    if (gebraucht.has(id)) continue;
    try {
      await removeAttachmentRecord(id);
      await api.attach?.remove?.(id);
    } catch { /* eine nicht entfernbare Datei stört nicht; „Aufräumen“ in den Einstellungen findet sie */ }
  }
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */

const BEFEHLE = [
  { cmd: 'bold', label: '<b>B</b>', titel: 'Fett (Strg+B)', zustand: 'bold' },
  { cmd: 'italic', label: '<i>I</i>', titel: 'Kursiv (Strg+I)', zustand: 'italic' },
  { cmd: 'underline', label: '<u>U</u>', titel: 'Unterstrichen (Strg+U)', zustand: 'underline' },
  { cmd: 'ueberschrift', label: 'Überschrift', titel: 'Zwischenüberschrift' },
  { cmd: 'insertUnorderedList', label: 'Liste', titel: 'Aufzählung', zustand: 'insertUnorderedList' },
  { cmd: 'insertOrderedList', label: '1. 2. 3.', titel: 'Nummerierte Liste', zustand: 'insertOrderedList' },
  { cmd: 'link', label: `${icon('link', 14).__raw} Link`, titel: 'Link einfügen' },
  { cmd: 'bild', label: `${icon('image', 14).__raw} Bild`, titel: 'Bild einfügen (auch per Strg+V oder Ziehen ins Feld)' },
  { cmd: 'removeFormat', label: 'Tx', titel: 'Formatierung entfernen' },
];

/**
 * @param {HTMLElement} host  Platz für Leiste und Feld
 * @param {object} o
 * @param {string} [o.html]  Ausgangstext
 * @param {string} [o.placeholder]
 * @param {() => void} [o.beiAenderung]
 * @param {(id:string) => void} [o.beiNeuemBild]  ein Bild wurde neu abgelegt
 * @returns {{feld:HTMLElement, html:() => string, fokus:() => void}}
 */
export function richEditor(host, { html = '', placeholder = 'Beschreibung, Notizen, Links, Bilder …', beiAenderung, beiNeuemBild } = {}) {
  host.classList.add('rt');
  host.innerHTML = `
    <div class="rt-leiste" role="toolbar" aria-label="Textformat">
      ${BEFEHLE.map((b) => `<button type="button" class="rt-knopf" data-cmd="${b.cmd}" title="${esc(b.titel)}" aria-label="${esc(b.titel)}"${b.zustand ? ' aria-pressed="false"' : ''}>${b.label}</button>`).join('')}
    </div>
    <div class="rt-linkzeile" hidden>
      <input type="url" class="sm" placeholder="https://…" aria-label="Adresse des Links">
      <button type="button" class="btn sm primary" data-link-ok>Übernehmen</button>
      <button type="button" class="btn sm ghost" data-link-weg>Link entfernen</button>
    </div>
    <div class="rt-feld" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Beschreibung" data-placeholder="${esc(placeholder)}" spellcheck="true"></div>`;
  const leiste = host.querySelector('.rt-leiste');
  const linkzeile = host.querySelector('.rt-linkzeile');
  const linkFeld = linkzeile.querySelector('input');
  const feld = host.querySelector('.rt-feld');

  feld.innerHTML = bereinigen(html);
  bilderEinsetzen(feld);
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, false);
  } catch { /* ohne diese Voreinstellung genügt die Bereinigung */ }

  const leerPruefen = () => feld.toggleAttribute('data-leer', !klartext(feld.innerHTML) && !feld.querySelector('img'));
  const aenderung = () => { leerPruefen(); beiAenderung?.(); };
  leerPruefen();

  /* Auswahl merken, damit Leiste, Link und Bilddialog sie nicht verlieren. */
  let gemerkt = null;
  const merken = () => {
    const s = getSelection();
    if (s.rangeCount && feld.contains(s.getRangeAt(0).commonAncestorContainer)) gemerkt = s.getRangeAt(0).cloneRange();
  };
  const wiederherstellen = () => {
    feld.focus({ preventScroll: true });
    const s = getSelection();
    if (gemerkt) { s.removeAllRanges(); s.addRange(gemerkt); return; }
    const r = document.createRange();
    r.selectNodeContents(feld);
    r.collapse(false);
    s.removeAllRanges();
    s.addRange(r);
  };
  feld.addEventListener('keyup', merken);
  feld.addEventListener('mouseup', merken);
  feld.addEventListener('blur', merken);

  const zustaende = () => {
    for (const b of BEFEHLE) {
      if (!b.zustand) continue;
      let an = false;
      try { an = document.queryCommandState(b.zustand); } catch { /* egal */ }
      leiste.querySelector(`[data-cmd="${b.cmd}"]`)?.setAttribute('aria-pressed', String(an));
    }
  };
  const beiAuswahl = () => {
    if (!feld.isConnected) { document.removeEventListener('selectionchange', beiAuswahl); return; }
    if (feld.contains(getSelection().anchorNode)) zustaende();
  };
  document.addEventListener('selectionchange', beiAuswahl);

  async function bildEinfuegen(datei) {
    try {
      const meta = await bildAblegen(datei);
      await commit('beleg.bild', (db) => { db.attachments.push(meta); }, { silent: true });
      beiNeuemBild?.(meta.id);
      wiederherstellen();
      document.execCommand('insertHTML', false, `<img data-att="${esc(meta.id)}" alt=""><p><br></p>`);
      bilderEinsetzen(feld);
      merken();
      aenderung();
    } catch (e) {
      err('Bild nicht übernommen', e.message);
    }
  }

  leiste.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  leiste.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'link') {
      merken();
      linkzeile.hidden = !linkzeile.hidden;
      if (!linkzeile.hidden) {
        const a = getSelection().anchorNode?.parentElement?.closest('a');
        linkFeld.value = a?.getAttribute('href') || '';
        linkFeld.focus();
      } else wiederherstellen();
      return;
    }
    if (cmd === 'bild') {
      merken();
      const datei = await bildWaehlen();
      if (datei) await bildEinfuegen(datei);
      return;
    }
    wiederherstellen();
    if (cmd === 'ueberschrift') {
      const jetzt = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      document.execCommand('formatBlock', false, jetzt === 'h3' ? 'p' : 'h3');
    } else {
      document.execCommand(cmd, false, null);
    }
    merken();
    zustaende();
    aenderung();
  });

  const linkSetzen = () => {
    let url = linkFeld.value.trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
    const ok = linkErlaubt(url);
    if (!ok) { linkFeld.classList.add('invalid'); linkFeld.focus(); return; }
    linkFeld.classList.remove('invalid');
    wiederherstellen();
    const s = getSelection();
    if (s.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(ok)}">${esc(ok)}</a>&nbsp;`);
    else document.execCommand('createLink', false, ok);
    linkzeile.hidden = true;
    merken();
    aenderung();
  };
  linkzeile.querySelector('[data-link-ok]').addEventListener('click', linkSetzen);
  linkzeile.querySelector('[data-link-weg]').addEventListener('click', () => {
    wiederherstellen();
    document.execCommand('unlink', false, null);
    linkzeile.hidden = true;
    aenderung();
  });
  linkFeld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); linkSetzen(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); linkzeile.hidden = true; wiederherstellen(); }
  });

  feld.addEventListener('input', aenderung);
  feld.addEventListener('paste', async (e) => {
    const bilder = bilderAusZwischenablage(e);
    if (bilder.length) {
      e.preventDefault();
      for (const b of bilder) await bildEinfuegen(b);
      return;
    }
    e.preventDefault();
    const h = e.clipboardData?.getData('text/html');
    if (h) document.execCommand('insertHTML', false, bereinigen(h));
    else document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
    aenderung();
  });
  feld.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  feld.addEventListener('drop', async (e) => {
    const bilder = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
    if (!bilder.length) return;
    e.preventDefault();
    for (const b of bilder) await bildEinfuegen(b);
  });
  // Ein Klick auf ein Bild markiert es; Entf löscht es.
  feld.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (!img) return;
    const r = document.createRange();
    r.selectNode(img);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    merken();
  });
  // Links lassen sich im Editor nicht versehentlich öffnen.
  feld.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });

  return {
    feld,
    html: () => {
      const kopie = feld.cloneNode(true);
      kopie.querySelectorAll('img').forEach((i) => i.removeAttribute('src'));
      const h = bereinigen(kopie.innerHTML);
      return klartext(h) || bildIds(h).length ? h : '';
    },
    fokus: () => { feld.focus(); },
  };
}
