/**
 * Kontovia – globale Suche (Strg+K).
 *
 * Ein Fenster mit Eingabefeld und Trefferliste über der ganzen Anwendung. Es
 * durchsucht Buchungen, Rechnungen, Kontakte, Termine, Aufgaben und
 * Stammdaten, bietet Seiten und häufige Aktionen an und öffnet den Treffer
 * dort, wo er hingehört. Index und Trefferlogik stehen in lib/suchindex.js.
 */

import { esc, todayISO, MOD } from './util.js';
import { icon, modal } from './ui.js';
import { store, sel } from './store.js';
import { navigate } from './router.js';
import { sucheIndex, suchen, sucheStart, ART_NAMEN } from './suchindex.js';

const ICONS = { aktion: 'plus', seite: 'right', buchung: 'book', rechnung: 'invoice', kontakt: 'users', termin: 'calendar', aufgabe: 'todo', stamm: 'tag' };

let offen = null;

/** Hebt die Suchwörter im Text hervor, soweit sie dort in dieser Schreibweise stehen. */
function markieren(text, woerter) {
  let out = esc(text);
  for (const w of woerter) {
    if (w.length < 2 || /^(amp|lt|gt|quot|#?d+)$/i.test(w)) continue;
    const rx = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    out = out.replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) => (tag ? tag : txt.replace(rx, '<mark>$1</mark>')));
  }
  return out;
}

/** Führt das Ziel eines Treffers aus. Die Ansichten werden erst jetzt geladen. */
async function oeffnen(e, { sperren } = {}) {
  const z = e.ziel;
  if (z.art === 'seite') { navigate(z.view, z.params || {}); return; }
  if (z.art === 'aktion') {
    if (z.id === 'neu-einnahme') (await import('../views/transactions.js')).openTransactionDialog(null, 'income');
    else if (z.id === 'neu-ausgabe') (await import('../views/transactions.js')).openTransactionDialog(null, 'expense');
    else if (z.id === 'neu-aufgabe') (await import('../views/todos.js')).openTodoDialog(null);
    else if (z.id === 'neu-termin') (await import('../views/calendar.js')).openAppointmentDialog(null, { date: todayISO() });
    else if (z.id === 'neu-rechnung') navigate('rechnungen', { neu: true });
    else if (z.id === 'neu-kontakt') (await import('../views/master.js')).openStammdatum('contacts', null);
    else if (z.id === 'sperren') sperren?.();
    return;
  }
  if (z.art === 'buchung') (await import('../views/transactions.js')).openTransactionDialog(z.id);
  else if (z.art === 'termin') (await import('../views/calendar.js')).openAppointmentDialog(z.id);
  else if (z.art === 'aufgabe') (await import('../views/todos.js')).openTodoDialog(z.id);
  else if (z.art === 'kontakt') (await import('../views/master.js')).openStammdatum('contacts', z.id);
  else if (z.art === 'stamm') (await import('../views/master.js')).openStammdatum(z.tab, z.id);
  else if (z.art === 'rechnung') {
    if (sel.invoice(z.id)?.richtung === 'eingang') navigate('rechnungen', { tab: 'eingang' });
    else navigate('rechnungen', { id: z.id });
  }
}

/** Öffnet die Suche; ein zweiter Aufruf schließt sie wieder. */
export function sucheOeffnen(optionen = {}) {
  if (offen) { offen.close(); return; }
  if (!store.db) return;
  const index = sucheIndex(store.db);
  let treffer = [];
  let aktiv = 0;

  const m = modal({
    title: 'Suche',
    size: 'suche',
    body: `
      <div class="such">
        <div class="such-feld">
          ${icon('search', 18).__raw}
          <input id="sq" type="search" role="combobox" aria-expanded="true" aria-controls="sl" aria-autocomplete="list" autocomplete="off" spellcheck="false"
            placeholder="Buchungen, Rechnungen, Kontakte, Termine, Aufgaben …" aria-label="Suche">
          <kbd>Esc</kbd>
        </div>
        <div class="such-liste" id="sl" role="listbox" aria-label="Treffer"></div>
        <div class="such-fuss"><span><kbd>↑</kbd> <kbd>↓</kbd> wählen</span><span><kbd>Enter</kbd> öffnen</span><span class="such-tipp">Mehrere Wörter grenzen ein, auch Beträge und Datum</span></div>
      </div>`,
    onClose: () => { offen = null; },
  });
  offen = m;
  const eingabe = m.root.querySelector('#sq');
  const liste = m.root.querySelector('#sl');

  const zeichnen = () => {
    const q = eingabe.value;
    const woerter = q.trim().split(/\s+/).filter(Boolean);
    treffer = woerter.length ? suchen(index, q) : sucheStart(index);
    aktiv = Math.min(aktiv, Math.max(0, treffer.length - 1));
    if (!treffer.length) {
      liste.innerHTML = `<div class="such-leer">${woerter.length ? `Nichts gefunden für „${esc(q.trim())}“.` : ''}</div>`;
      eingabe.removeAttribute('aria-activedescendant');
      return;
    }
    let art = '';
    liste.innerHTML = treffer.map((e, i) => {
      const kopf = e.art !== art ? `<div class="such-gruppe" role="presentation">${esc(woerter.length || e.art === 'aktion' ? ART_NAMEN[e.art] : (e.art === 'seite' ? 'Gehe zu' : ART_NAMEN[e.art]))}</div>` : '';
      art = e.art;
      const naechster = treffer[i + 1];
      const mehr = e.weitere > 0 && (!naechster || naechster.art !== e.art)
        ? `<div class="such-mehr">und ${e.weitere} weitere. Mit mehr Wörtern wird die Liste kürzer.</div>` : '';
      const marken = [
        e.privat ? '<span class="badge unlisted tiny" title="Privat: erscheint nicht in Unterlagen fürs Finanzamt">privat</span>' : '',
        e.storniert ? '<span class="badge tiny">storniert</span>' : '',
        e.erledigt ? '<span class="badge pos tiny">erledigt</span>' : '',
      ].join('');
      return `${kopf}<button type="button" class="such-treffer${i === aktiv ? ' aktiv' : ''}" role="option" id="st${i}" data-i="${i}" aria-selected="${i === aktiv}">
        <span class="such-ico">${icon(e.ziel?.id === 'sperren' ? 'lock' : ICONS[e.art] || 'info', 16).__raw}</span>
        <span class="such-text"><span class="such-titel">${markieren(e.titel, woerter)}</span>${e.sub ? `<span class="such-sub">${markieren(e.sub, woerter)}</span>` : ''}</span>
        ${marken}
      </button>${mehr}`;
    }).join('');
    eingabe.setAttribute('aria-activedescendant', `st${aktiv}`);
  };

  const waehlen = (i) => {
    aktiv = i;
    liste.querySelectorAll('.such-treffer').forEach((b) => {
      const an = Number(b.dataset.i) === aktiv;
      b.classList.toggle('aktiv', an);
      b.setAttribute('aria-selected', String(an));
      if (an) b.scrollIntoView({ block: 'nearest' });
    });
    eingabe.setAttribute('aria-activedescendant', `st${aktiv}`);
  };

  const ausfuehren = (i) => {
    const e = treffer[i];
    if (!e) return;
    m.close();
    oeffnen(e, optionen);
  };

  eingabe.addEventListener('input', () => { aktiv = 0; zeichnen(); });
  eingabe.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (treffer.length) waehlen((aktiv + 1) % treffer.length); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (treffer.length) waehlen((aktiv - 1 + treffer.length) % treffer.length); }
    else if (ev.key === 'Home' && !eingabe.value) { ev.preventDefault(); waehlen(0); }
    else if (ev.key === 'End' && !eingabe.value) { ev.preventDefault(); waehlen(Math.max(0, treffer.length - 1)); }
    else if (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); ev.stopPropagation(); ausfuehren(aktiv); }
  });
  liste.addEventListener('mousemove', (ev) => {
    const b = ev.target.closest('.such-treffer');
    if (b && Number(b.dataset.i) !== aktiv) waehlen(Number(b.dataset.i));
  });
  liste.addEventListener('click', (ev) => {
    const b = ev.target.closest('.such-treffer');
    if (b) ausfuehren(Number(b.dataset.i));
  });
  zeichnen();
  setTimeout(() => eingabe.focus(), 0);
  return m;
}

/** Beschriftung des Tastenkürzels, z. B. „Strg K“. */
export const SUCHE_KUERZEL = `${MOD} K`;
