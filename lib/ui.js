/**
 * Kontovia – wiederkehrende Oberflächenbausteine:
 * Symbole, Hinweisfenster, Dialoge, kleine Diagramme.
 */

import { html, raw, esc, money, eur, sum, clamp } from './util.js';

/* -------------------------------------------------------------------------- */
/* Symbole                                                                     */
/* -------------------------------------------------------------------------- */

const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  export: '<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  master: '<path d="M3 7h18M3 12h18M3 17h18"/><circle cx="7" cy="7" r="1.6"/><circle cx="13" cy="12" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.7 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  paperclip: '<path d="M21.4 11.05 12.3 20.2a5 5 0 0 1-7.1-7.1l9.2-9.2a3.3 3.3 0 1 1 4.7 4.7l-9.1 9.2a1.7 1.7 0 0 1-2.4-2.4l8.5-8.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.4 8.4-8 9.5C7.4 20.4 4 17 4 12V6z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M18 5l2 2M15 8l2 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.2A6.5 6.5 0 0 1 21.5 20"/>',
  bank: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 17v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.8 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  euro: '<path d="M17 6.5A6.5 6.5 0 0 0 7.5 12 6.5 6.5 0 0 0 17 17.5"/><path d="M4 10.5h9M4 13.5h9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="M5 7 2 14h6zM19 7l-3 7h6z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
  pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  bars: '<path d="M4 20h16"/><path d="M7 16V10M12 16V5M17 16v-4"/>',
  line: '<path d="M4 20h16"/><path d="M4 15l5-5 4 3 7-7"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11"/>',
  sum: '<path d="M4 20h16"/><path d="M4 17l4-3 4 1 8-9"/><path d="M16 6h4v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  hide: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

export function icon(name, size = 18, cls = 'ico') {
  const d = P[name] || P.info;
  return raw(`<svg class="${esc(cls)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
}

/* -------------------------------------------------------------------------- */
/* Hinweise                                                                    */
/* -------------------------------------------------------------------------- */

export function toast(title, detail = '', type = '', ms = 3800) {
  const box = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = 'toast ' + type;
  node.innerHTML = html`<div class="t">${title}</div>${detail ? raw(`<div class="d">${esc(detail)}</div>`) : ''}`;
  box.append(node);
  const kill = () => {
    node.style.transition = 'opacity .15s, transform .15s';
    node.style.opacity = '0';
    node.style.transform = 'translateX(12px)';
    setTimeout(() => node.remove(), 160);
  };
  node.addEventListener('click', kill);
  setTimeout(kill, ms);
  // Zurückgegeben, damit der Aufrufer den Hinweis anklickbar machen kann.
  return node;
}

export const ok = (t, d) => toast(t, d, 'ok');
export const err = (t, d) => toast(t, d, 'err', 6500);
export const warn = (t, d) => toast(t, d, 'warn', 5000);

/* -------------------------------------------------------------------------- */
/* Dialoge                                                                     */
/* -------------------------------------------------------------------------- */

/* Offene Fenster, das letzte liegt oben. Nur das oberste reagiert auf Escape
   und hält den Tastaturfokus – sonst schließt ein Escape in einer Rückfrage
   auch den darunterliegenden Erfassungsdialog. */
const stack = [];
let modalSeq = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Öffnet ein modales Fenster.
 *
 * `confirmDismiss` darf eine Funktion sein, die true liefert, wenn ungesicherte
 * Eingaben vorliegen; dann fragt das Fenster vor Escape, Klick daneben oder auf
 * das Kreuz nach, ob die Änderungen verworfen werden sollen. `close()` aus dem
 * eigenen Speichern-Knopf umgeht die Rückfrage.
 *
 * Tastatur: Escape schließt, Strg+Enter löst den Hauptknopf der Fußzeile aus,
 * in schmalen Fenstern reicht Enter in einem Eingabefeld.
 *
 * @returns {{root:HTMLElement, body:HTMLElement, foot:HTMLElement|null, close:Function, dismiss:Function}}
 */
export function modal({ title, body = '', foot = '', size = '', onClose, closable = true, confirmDismiss = null }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const titleId = `modalTitle${++modalSeq}`;
  const opener = document.activeElement;
  backdrop.innerHTML = html`
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head">
        <h3 id="${titleId}">${title}</h3>
        <div class="spacer"></div>
        ${closable ? raw(`<button class="icon-btn" data-close aria-label="Schließen" title="Schließen (Esc)">${icon('x', 18).__raw}</button>`) : ''}
      </div>
      <div class="modal-body">${raw(body)}</div>
      ${foot ? raw(`<div class="modal-foot">${foot}</div>`) : ''}
    </div>`;
  document.getElementById('overlays').append(backdrop);
  stack.push(backdrop);

  const close = (result) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    const i = stack.indexOf(backdrop);
    if (i >= 0) stack.splice(i, 1);
    document.removeEventListener('keydown', onKey, true);
    // Den Fokus dorthin zurückgeben, wo er vor dem Öffnen war – für
    // Tastaturnutzer sonst ein Sprung an den Seitenanfang.
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    if (onClose) onClose(result);
  };

  let asking = false;
  const dismiss = async () => {
    if (!closable || asking) return;
    if (confirmDismiss && confirmDismiss()) {
      asking = true;
      const weg = await confirmDialog({
        title: 'Änderungen verwerfen?',
        text: 'Die Eingaben in diesem Fenster wurden noch nicht gespeichert.',
        confirmLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten', danger: true,
      });
      asking = false;
      if (!weg) return;
    }
    close();
  };

  /* Der Hauptknopf der Fußzeile. In Rückfragen mit Gefahrenhinweis trägt er
     die Klasse „danger“ statt „primary“ – deshalb die zweite Abfrage, und
     zwar getrennt: eine Auswahlliste mit Komma nähme den ersten Knopf im
     Fenster, und das wäre dort, wo beide vorkommen, der Löschknopf. */
  const primary = () => backdrop.querySelector('.modal-foot .btn.primary:not([disabled])')
    || backdrop.querySelector('.modal-foot [data-yes]:not([disabled])');
  const onKey = (e) => {
    if (stack.at(-1) !== backdrop) return;
    if (e.key === 'Escape') { e.stopPropagation(); dismiss(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const p = primary();
      if (p) { e.preventDefault(); p.click(); }
      return;
    }
    if (e.key === 'Enter' && size === 'slim' && !e.shiftKey && !e.altKey
        && e.target instanceof HTMLInputElement && backdrop.contains(e.target)) {
      const p = primary();
      if (p) { e.preventDefault(); p.click(); }
      return;
    }
    if (e.key === 'Tab') {
      const nodes = [...backdrop.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const inside = backdrop.contains(document.activeElement);
      if (!inside) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dismiss(); });
  backdrop.querySelector('[data-close]')?.addEventListener('click', () => dismiss());

  const bodyEl = backdrop.querySelector('.modal-body');
  // Zuerst ins erste echte Eingabefeld, nicht auf einen Umschaltknopf.
  setTimeout(() => {
    const ziel = bodyEl.querySelector('[autofocus]')
      || bodyEl.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
      || backdrop.querySelector(FOCUSABLE);
    ziel?.focus();
  }, 30);
  return { root: backdrop, body: bodyEl, foot: backdrop.querySelector('.modal-foot'), close, dismiss };
}

export function confirmDialog({ title, text, confirmLabel = 'Bestätigen', cancelLabel = 'Abbrechen', danger = false, extra = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title,
      size: 'slim',
      body: html`<p class="mt0" style="line-height:1.6">${text}</p>${raw(extra)}`,
      foot: `<button class="btn" data-no>${esc(cancelLabel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!settled) resolve(false); },
    });
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(false); });
    m.root.querySelector('[data-yes]').addEventListener('click', () => { settled = true; m.close(); resolve(true); });
    setTimeout(() => m.root.querySelector('[data-yes]').focus(), 40);
  });
}

/** Passwortabfrage. Liefert den Text oder null bei Abbruch. */
export function askPassword({ title, text, label = 'Passwort', confirmLabel = 'Weiter', repeat = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title,
      size: 'slim',
      body: html`
        ${text ? raw(`<p class="mt0 muted small" style="line-height:1.6">${esc(text)}</p>`) : ''}
        <div class="field"><label>${label}</label>${passwordInput('pw1')}</div>
        ${repeat ? raw(`<div class="field"><label>Wiederholen</label>${passwordInput('pw2').__raw}</div>`) : ''}
        <div class="err small" id="pwerr"></div>`,
      foot: `<button class="btn" data-no>Abbrechen</button><button class="btn primary" data-yes>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!settled) resolve(null); },
    });
    const p1 = m.root.querySelector('#pw1');
    const p2 = m.root.querySelector('#pw2');
    const errEl = m.root.querySelector('#pwerr');
    const submit = () => {
      const v = p1.value;
      if (v.length < 10) { errEl.textContent = 'Mindestens 10 Zeichen.'; return; }
      if (repeat && v !== p2.value) { errEl.textContent = 'Die Eingaben stimmen nicht überein.'; return; }
      settled = true; m.close(); resolve(v);
    };
    m.root.querySelector('[data-yes]').addEventListener('click', submit);
    m.root.querySelector('[data-no]').addEventListener('click', () => { settled = true; m.close(); resolve(null); });
    wirePasswordToggles(m.root);
  });
}

/* -------------------------------------------------------------------------- */
/* Passwortfelder                                                              */
/* -------------------------------------------------------------------------- */

/** Passwortfeld mit Knopf zum Anzeigen. Danach `wirePasswordToggles(root)` rufen. */
export function passwordInput(id, { autocomplete = 'off' } = {}) {
  return raw(`<div class="pw-wrap">
    <input type="password" id="${esc(id)}" autocomplete="${esc(autocomplete)}">
    <button type="button" class="icon-btn pw-toggle" data-pw-toggle="${esc(id)}" aria-label="Passwort anzeigen" title="Passwort anzeigen" tabindex="-1">${icon('eye', 16).__raw}</button>
    <span class="pw-caps tiny" aria-live="polite">Feststelltaste ist aktiv</span>
  </div>`);
}

/** Verdrahtet die Anzeigen-Knöpfe und den Hinweis auf eine aktive Feststelltaste. */
export function wirePasswordToggles(root) {
  root.querySelectorAll('[data-pw-toggle]').forEach((b) => {
    const input = root.querySelector('#' + b.dataset.pwToggle);
    if (!input) return;
    b.addEventListener('click', () => {
      const zeigen = input.type === 'password';
      input.type = zeigen ? 'text' : 'password';
      b.setAttribute('aria-label', zeigen ? 'Passwort verbergen' : 'Passwort anzeigen');
      b.title = zeigen ? 'Passwort verbergen' : 'Passwort anzeigen';
      b.classList.toggle('active', zeigen);
      input.focus();
    });
    // Feststelltaste: die häufigste Ursache für „falsches Passwort“.
    input.addEventListener('keyup', (e) => {
      if (typeof e.getModifierState !== 'function') return;
      input.parentElement.classList.toggle('capslock', e.getModifierState('CapsLock'));
    });
    input.addEventListener('blur', () => input.parentElement.classList.remove('capslock'));
  });
}

/* -------------------------------------------------------------------------- */
/* Kleine Darstellungshelfer                                                   */
/* -------------------------------------------------------------------------- */

export function amountCell(cents, type) {
  const cls = type === 'income' ? 'pos' : 'neg';
  const sign = type === 'income' ? '+' : '−';
  return raw(`<span class="amount ${cls}">${sign} ${esc(money(Math.abs(cents)))}</span>`);
}

export function signedAmount(cents) {
  const cls = cents > 0 ? 'pos' : cents < 0 ? 'neg' : '';
  return raw(`<span class="amount ${cls}">${cents > 0 ? '+' : cents < 0 ? '−' : ''} ${esc(money(Math.abs(cents)))}</span>`);
}

export function deltaBadge(fraction) {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return raw('<span class="delta flat">–</span>');
  }
  const cls = fraction > 0.001 ? 'up' : fraction < -0.001 ? 'down' : 'flat';
  const arrow = fraction > 0.001 ? '▲' : fraction < -0.001 ? '▼' : '■';
  const v = Math.abs(fraction * 100);
  const txt = v > 999 ? '>999' : v.toFixed(v < 10 ? 1 : 0).replace('.', ',');
  return raw(`<span class="delta ${cls}">${arrow} ${txt} %</span>`);
}

export function statCard({ label, value, foot = '', tone = '', icon: ic }) {
  return raw(html`
    <div class="card stat">
      <div class="label">${ic ? icon(ic, 14) : ''}${label}</div>
      <div class="value ${tone}">${raw(value)}</div>
      ${foot ? raw(`<div class="foot">${foot}</div>`) : ''}
    </div>`);
}

export function emptyState(title, text, actionHtml = '') {
  return raw(html`
    <div class="empty">
      <div class="big">◍</div>
      <h4>${title}</h4>
      <p class="small">${text}</p>
      ${raw(actionHtml)}
    </div>`);
}

/* -------------------------------------------------------------------------- */
/* Diagramme (reines SVG, keine Fremdbibliothek)                               */
/* -------------------------------------------------------------------------- */

/*
 * Diagramme stehen nicht als fertiges SVG im Seitentext, sondern als
 * Platzhalter, den mountCharts() nach dem Einfügen in der tatsächlichen Breite
 * zeichnet – und bei jeder Größenänderung neu. Das frühere, auf eine feste
 * Breite gerechnete und dann gestreckte SVG verzerrte die Beschriftung, je
 * nach Fensterbreite mal gestaucht, mal in die Breite gezogen.
 */

let chartSeq = 0;
const pendingCharts = new Map();

/**
 * Platzhalter für ein Diagramm; gezeichnet wird er von mountCharts().
 *
 *   bars        Säulen Einnahmen/Ausgaben je Monat, Ergebnis als Linie
 *   lines       dieselben drei Größen als Linien
 *   cumulative  aufgelaufene Summen seit Beginn des Zeitraums
 *   pie         Anteile als Ring, höchstens sechs Stücke
 *
 * @param {'bars'|'lines'|'cumulative'|'pie'} kind
 */
export function chart(kind, data, opts = {}) {
  const id = 'ch' + (++chartSeq);
  pendingCharts.set(id, { kind, data, opts });
  // Vorab die Höhe, damit die Seite beim Zeichnen nicht springt.
  const style = kind === 'pie' ? '' : ` style="min-height:${(opts.height || 220) + 30}px"`;
  return raw(`<div class="chart-host" data-chart="${id}"${style}></div>`);
}

/** Säulendiagramm – bleibt als Name für bestehende Aufrufe erhalten. */
export function barChart(series, opts = {}) {
  return chart('bars', series, opts);
}

/** Zeichnet alle Diagramm-Platzhalter unterhalb von root. */
export function mountCharts(root) {
  for (const host of root.querySelectorAll('.chart-host[data-chart]')) {
    const spec = pendingCharts.get(host.dataset.chart);
    pendingCharts.delete(host.dataset.chart);
    host.removeAttribute('data-chart');
    if (!spec) continue;
    host.__chart = spec;
    paintChart(host);
    wireTooltip(host);
    if (typeof ResizeObserver === 'function') {
      let last = host.clientWidth;
      const ro = new ResizeObserver(() => {
        if (!host.isConnected) { ro.disconnect(); return; }
        if (Math.abs(host.clientWidth - last) < 4) return;
        last = host.clientWidth;
        paintChart(host);
      });
      ro.observe(host);
    }
  }
  // Platzhalter einer Ansicht, die nie eingefügt wurde, nicht ewig aufheben.
  if (pendingCharts.size > 40) pendingCharts.clear();
}

function paintChart(host) {
  const { kind, data, opts } = host.__chart;
  const width = Math.max(240, Math.round(host.clientWidth || 640));
  const draw = { bars: renderBars, lines: renderLines, cumulative: renderCumulative, pie: renderPie }[kind];
  host.innerHTML = draw ? draw(data, { ...opts, width }) : '';
}

/** Hinweisfeld beim Überfahren: jedes Element mit data-tip liefert den Text. */
function wireTooltip(host) {
  const hide = () => { const tip = host.querySelector('.chart-tip'); if (tip) tip.hidden = true; };
  host.addEventListener('pointerleave', hide);
  host.addEventListener('pointermove', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (!target || !host.contains(target)) { hide(); return; }
    let tip = host.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'tooltip');
      host.append(tip);
    }
    const [kopf, ...zeilen] = target.dataset.tip.split('\n');
    tip.replaceChildren();
    const k = document.createElement('div');
    k.className = 'chart-tip-head';
    k.textContent = kopf;
    tip.append(k);
    for (const z of zeilen) {
      const d = document.createElement('div');
      d.textContent = z;
      tip.append(d);
    }
    tip.hidden = false;
    const box = host.getBoundingClientRect();
    const x = e.clientX - box.left;
    const links = x + 14 + tip.offsetWidth > box.width ? x - 14 - tip.offsetWidth : x + 14;
    tip.style.left = Math.max(0, links) + 'px';
    tip.style.top = Math.max(0, e.clientY - box.top - tip.offsetHeight - 10) + 'px';
  });
}

const NO_DATA = () => emptyState('Keine Daten', 'Für diesen Zeitraum gibt es keine Buchungen.').__raw;

/**
 * Gemeinsamer Rahmen der Verlaufsdiagramme: Wertebereich, Hilfslinien,
 * Monatsbeschriftung und die Trefferflächen für das Hinweisfeld.
 */
function frame(series, values, { width, height = 220, labelFor = (s) => s.ym, padR = 14 }) {
  const w = width;
  const h = height;
  const padL = 52, padT = 12, padB = 26;
  const iw = Math.max(40, w - padL - padR);
  const ih = h - padT - padB;
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  // Runde Schritte, damit die Achse 0, 5k, 10k … zeigt statt krummer Werte.
  const step = niceCeil(Math.max(1, (hi - lo) / 4));
  const top = Math.max(step, Math.ceil(hi / step) * step);
  const bottom = Math.floor(lo / step) * step;
  const span = top - bottom || 1;
  const y = (v) => padT + ih - ((v - bottom) / span) * ih;
  const slot = iw / series.length;
  const x = (i) => padL + slot * i + slot / 2;

  let grid = '';
  for (let v = bottom; v <= top + step / 2; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${padL + iw}" y2="${yy}"/>`;
    grid += `<text x="${padL - 8}" y="${(Number(yy) + 3.5).toFixed(1)}" text-anchor="end">${esc(shortMoney(v))}</text>`;
  }
  grid += `<line class="axis" x1="${padL}" y1="${y(0).toFixed(1)}" x2="${padL + iw}" y2="${y(0).toFixed(1)}"/>`;

  // Nur so viele Monatsnamen, wie nebeneinander Platz haben.
  const every = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(iw / 58))));
  let labels = '';
  series.forEach((s, i) => {
    if (i % every === 0) labels += `<text x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(labelFor(s))}</text>`;
  });

  const hits = (tipFor) => series.map((s, i) => `<rect class="hit" x="${(padL + slot * i).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${ih}" data-tip="${esc(tipFor(s, i))}"/>`).join('');

  return { w, h, padL, padT, iw, ih, y, x, slot, grid, labels, hits };
}

/** Waagerechte Bezugslinie für einen Durchschnitt, gestrichelt und rechts beschriftet. */
function avgLine(f, value, cls) {
  if (!Number.isFinite(value) || !value) return '';
  const yy = f.y(value).toFixed(1);
  return `<line class="avg-line ${cls}" x1="${f.padL}" y1="${yy}" x2="${f.padL + f.iw}" y2="${yy}"/>`
    + `<text class="avg-label" x="${f.padL + f.iw + 4}" y="${(Number(yy) + 3.5).toFixed(1)}">Ø ${esc(shortMoney(value))}</text>`;
}

function legend(items) {
  return `<div class="chart-legend">${items.map(([color, text, dashed]) => `<span><i class="${dashed ? 'dash' : 'dot'}" style="${dashed ? 'border-color' : 'background'}:${color}"></i> ${esc(text)}</span>`).join('')}</div>`;
}

const monthTip = (s, label) => `${label}\nEinnahmen ${money(s.income)} €\nAusgaben ${money(s.expense)} €\nErgebnis ${money(s.profit)} €`;

/**
 * Linien enden beim laufenden Monat. Für Monate, die noch nicht begonnen
 * haben, gibt es kein Ergebnis – eine Linie, die dort auf null fällt, sähe
 * aus wie ein Einbruch.
 */
function upToNow(series) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let n = series.length;
  while (n > 1 && series[n - 1].ym > ym) n--;
  return n;
}

/**
 * Säulen: Einnahmen und Ausgaben je Monat, Ergebnis als Linie darüber.
 * opts.avg = {income, expense} blendet die Monatsdurchschnitte ein.
 */
function renderBars(series, opts) {
  if (!series.length) return NO_DATA();
  const labelFor = opts.labelFor || ((s) => s.ym);
  const avg = opts.avg || null;
  const f = frame(series, series.flatMap((s) => [s.income, s.expense, s.profit]), { ...opts, labelFor, padR: avg ? 52 : 14 });
  const bw = Math.max(2, Math.min(24, f.slot * 0.34));
  let bars = '';
  const pts = [];
  series.forEach((s, i) => {
    const cx = f.x(i);
    // 2 px Abstand zwischen den beiden Säulen eines Monats.
    bars += barPath('bar-pos', cx - bw - 1, f.y(0), f.y(s.income), bw);
    bars += barPath('bar-neg', cx + 1, f.y(0), f.y(s.expense), bw);
    pts.push([cx, f.y(s.profit)]);
  });
  const bis = pts.slice(0, upToNow(series));
  const line = `<polyline class="line-profit" points="${bis.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}"/>`;
  const dots = series.length <= 24 ? bis.map(([a, b]) => `<circle class="pt pt-profit" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3.5"/>`).join('') : '';
  return `
    <svg class="chart" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="Einnahmen, Ausgaben und Ergebnis je Monat">
      ${f.grid}${bars}
      ${avg ? avgLine(f, avg.income, 'pos') + avgLine(f, avg.expense, 'neg') : ''}
      ${line}${dots}${f.labels}${f.hits((s) => monthTip(s, labelFor(s)))}
    </svg>
    ${legend([
      ['var(--pos)', 'Einnahmen'], ['var(--neg)', 'Ausgaben'], ['var(--accent)', 'Ergebnis'],
      ...(avg ? [['var(--muted)', `Ø je Monat (${avg.months} Monate)`, true]] : []),
    ])}`;
}

/** Säule mit abgerundetem Ende weg von der Nulllinie, flach an der Nulllinie. */
function barPath(cls, x, y0, yv, w) {
  const h = Math.abs(y0 - yv);
  if (h < 0.5) return '';
  const r = Math.min(3, w / 2, h);
  const up = yv < y0;
  const t = up ? yv : y0;
  const b = up ? y0 : yv;
  const d = up
    ? `M${x},${b} V${t + r} Q${x},${t} ${x + r},${t} H${x + w - r} Q${x + w},${t} ${x + w},${t + r} V${b} Z`
    : `M${x},${t} V${b - r} Q${x},${b} ${x + r},${b} H${x + w - r} Q${x + w},${b} ${x + w},${b - r} V${t} Z`;
  return `<path class="${cls}" d="${d}"/>`;
}

function polyline(f, values, cls, withDots) {
  const pts = values.map((v, i) => [f.x(i), f.y(v)]);
  const l = `<polyline class="line ${cls}" points="${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}"/>`;
  const d = withDots ? pts.map(([a, b]) => `<circle class="pt ${cls}" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3.5"/>`).join('') : '';
  return l + d;
}

/** Linien: Einnahmen, Ausgaben und Ergebnis je Monat. */
function renderLines(series, opts) {
  if (!series.length) return NO_DATA();
  const labelFor = opts.labelFor || ((s) => s.ym);
  const avg = opts.avg || null;
  const f = frame(series, series.flatMap((s) => [s.income, s.expense, s.profit]), { ...opts, labelFor, padR: avg ? 52 : 14 });
  const dots = series.length <= 24;
  return `
    <svg class="chart" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="Verlauf von Einnahmen, Ausgaben und Ergebnis">
      ${f.grid}
      ${avg ? avgLine(f, avg.income, 'pos') + avgLine(f, avg.expense, 'neg') : ''}
      ${polyline(f, series.slice(0, upToNow(series)).map((s) => s.income), 'l-pos', dots)}
      ${polyline(f, series.slice(0, upToNow(series)).map((s) => s.expense), 'l-neg', dots)}
      ${polyline(f, series.slice(0, upToNow(series)).map((s) => s.profit), 'l-acc', dots)}
      ${f.labels}${f.hits((s) => monthTip(s, labelFor(s)))}
    </svg>
    ${legend([
      ['var(--pos)', 'Einnahmen'], ['var(--neg)', 'Ausgaben'], ['var(--accent)', 'Ergebnis'],
      ...(avg ? [['var(--muted)', `Ø je Monat (${avg.months} Monate)`, true]] : []),
    ])}`;
}

/** Aufgelaufene Summen: wo steht der Zeitraum nach jedem Monat? */
function renderCumulative(series, opts) {
  if (!series.length) return NO_DATA();
  const labelFor = opts.labelFor || ((s) => s.ym);
  let i = 0, e = 0;
  const run = series.map((s) => {
    i += s.income; e += s.expense;
    return { ym: s.ym, income: i, expense: e, profit: i - e };
  });
  const f = frame(run, run.flatMap((s) => [s.income, s.expense, s.profit]), { ...opts, labelFor });
  const dots = run.length <= 24;
  return `
    <svg class="chart" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="Aufgelaufene Einnahmen, Ausgaben und Ergebnis">
      ${f.grid}
      ${polyline(f, run.slice(0, upToNow(run)).map((s) => s.income), 'l-pos', dots)}
      ${polyline(f, run.slice(0, upToNow(run)).map((s) => s.expense), 'l-neg', dots)}
      ${polyline(f, run.slice(0, upToNow(run)).map((s) => s.profit), 'l-acc', dots)}
      ${f.labels}${f.hits((s) => `bis einschließlich ${labelFor(s)}\nEinnahmen ${money(s.income)} €\nAusgaben ${money(s.expense)} €\nErgebnis ${money(s.profit)} €`)}
    </svg>
    ${legend([['var(--pos)', 'Einnahmen aufgelaufen'], ['var(--neg)', 'Ausgaben aufgelaufen'], ['var(--accent)', 'Ergebnis aufgelaufen']])}`;
}

/* Feste Farbfolge für Anteile. Nie zyklisch: ab dem sechsten Stück wird der
   Rest zu „Sonstige“ zusammengefasst, das immer grau bleibt. */
const SLICES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const SLICE_OTHER = 'var(--c-other)';

/** Fasst eine Anteilsliste auf höchstens sechs Stücke zusammen. */
export function pieSlices(rows, max = 6) {
  const clean = rows
    .map((r) => ({ name: r.name, amount: Number(r.amount) || 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (clean.length <= max) return clean.map((r, i) => ({ ...r, color: SLICES[i] }));
  const head = clean.slice(0, max - 1).map((r, i) => ({ ...r, color: SLICES[i] }));
  const rest = clean.slice(max - 1);
  return [...head, { name: `Sonstige (${rest.length})`, amount: sum(rest, (r) => r.amount), color: SLICE_OTHER, other: true }];
}

/** Ring mit Anteilen, Summe in der Mitte, Legende mit Betrag und Prozent. */
function renderPie(rows, opts) {
  const slices = pieSlices(rows);
  if (!slices.length) return '<p class="muted small">Keine Daten vorhanden.</p>';
  const total = sum(slices, (s) => s.amount);
  const size = Math.round(Math.min(168, Math.max(120, opts.width * 0.4)));
  const c = size / 2;
  const ro = c - 2;
  const ri = ro * 0.6;
  let a0 = -Math.PI / 2;
  const paths = slices.map((s) => {
    const frac = s.amount / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const d = frac >= 0.9999 ? ringPath(c, ro, ri) : slicePath(c, ro, ri, a0, a1);
    a0 = a1;
    const tip = `${s.name}\n${money(s.amount)} €\n${(frac * 100).toFixed(1).replace('.', ',')} % von ${money(total)} €`;
    return `<path class="slice" d="${d}" style="fill:${s.color}" data-tip="${esc(tip)}"/>`;
  }).join('');
  const items = slices.map((s) => `
    <li data-tip="${esc(`${s.name}\n${money(s.amount)} €`)}">
      <i class="dot" style="background:${s.color}"></i>
      <span class="truncate" title="${esc(s.name)}">${esc(s.name)}</span>
      <span class="num nowrap">${esc(money(s.amount))} <span class="muted tiny">${Math.round((s.amount / total) * 100)} %</span></span>
    </li>`).join('');
  return `
    <div class="pie-wrap">
      <svg class="chart pie" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(opts.label || 'Anteile')}">
        ${paths}
        <text class="pie-total" x="${c}" y="${c - 2}" text-anchor="middle">${esc(shortMoney(total))}</text>
        <text class="pie-sub" x="${c}" y="${c + 13}" text-anchor="middle">${esc(opts.centerLabel || 'gesamt')}</text>
      </svg>
      <ul class="pie-legend">${items}</ul>
    </div>`;
}

function slicePath(c, ro, ri, a0, a1) {
  const p = (r, a) => `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(ro, a0)} A${ro},${ro} 0 ${big} 1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${big} 0 ${p(ri, a0)} Z`;
}

function ringPath(c, ro, ri) {
  return `M${c - ro},${c} a${ro},${ro} 0 1 0 ${ro * 2},0 a${ro},${ro} 0 1 0 ${-ro * 2},0 Z `
    + `M${c - ri},${c} a${ri},${ri} 0 1 1 ${ri * 2},0 a${ri},${ri} 0 1 1 ${-ri * 2},0 Z`;
}

/**
 * Monatstabelle mit Summe und Durchschnitt – die Tabellenansicht zum
 * Verlaufsdiagramm, damit sich jeder Wert auch ohne Farbe ablesen lässt.
 */
export function monthTableHtml(series, { labelFor = (s) => s.ym, avg = null } = {}) {
  if (!series.length) return NO_DATA();
  const cell = (v, cls = '') => `<td class="num ${cls}">${esc(money(v))}</td>`;
  const tone = (v) => (v > 0 ? 'amount pos' : v < 0 ? 'amount neg' : '');
  return `
    <div class="table-wrap"><table class="data compact">
      <thead><tr><th>Monat</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num">Ergebnis</th></tr></thead>
      <tbody>${series.map((s) => `<tr><td>${esc(labelFor(s))}</td>${cell(s.income)}${cell(s.expense)}${cell(s.profit, tone(s.profit))}</tr>`).join('')}</tbody>
      <tfoot>
        <tr><td>Summe</td>${cell(sum(series, (s) => s.income))}${cell(sum(series, (s) => s.expense))}${cell(sum(series, (s) => s.profit))}</tr>
        ${avg && avg.months ? `<tr class="avg-row"><td>Ø je Monat <span class="muted tiny">(${avg.months} Monate)</span></td>${cell(avg.income)}${cell(avg.expense)}${cell(avg.profit, tone(avg.profit))}</tr>` : ''}
      </tfoot>
    </table></div>`;
}

/**
 * Umschalter aus Knöpfen, etwa für die Darstellungsart eines Diagramms.
 * Bewusst getrennt von der Zeitraumauswahl: Umschalten ändert nur das Bild,
 * nie die Zahlen.
 * @param {Array<[string,string,string?]>} options [Wert, Beschriftung, Symbol]
 */
export function segToggle(group, options, active, label = '') {
  return raw(`<div class="seg sm" role="group" aria-label="${esc(label)}" data-seg="${esc(group)}">${options.map(([v, text, ic]) => `
    <button type="button" data-val="${esc(v)}" class="${v === active ? 'active' : ''}" aria-pressed="${v === active}" title="${esc(text)}">${ic ? icon(ic, 14).__raw : ''}<span>${esc(text)}</span></button>`).join('')}</div>`);
}

/** Verdrahtet alle Umschalter einer Gruppe; onChange bekommt den neuen Wert. */
export function wireSeg(root, group, onChange) {
  root.querySelectorAll(`[data-seg="${group}"] [data-val]`).forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('active')) return;
    onChange(b.dataset.val);
  }));
}

/** Waagerechte Balken, z.B. „größte Ausgabenblöcke“. */
export function rankBars(rows, { color = 'var(--neg)', total = null } = {}) {
  if (!rows.length) return raw('<p class="muted small">Keine Daten vorhanden.</p>');
  const max = Math.max(...rows.map((r) => Math.abs(r.amount)), 1);
  const grand = total ?? sum(rows, (r) => Math.abs(r.amount));
  return raw(rows.map((r) => {
    const w = clamp((Math.abs(r.amount) / max) * 100, 1.5, 100);
    const share = grand ? (Math.abs(r.amount) / grand) * 100 : 0;
    return `<div class="bar-row">
        <div class="truncate" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w.toFixed(1)}%;background:${color}"></div></div>
        <div class="num nowrap" style="min-width:110px;text-align:right">${esc(money(Math.abs(r.amount)))} <span class="muted tiny">${share.toFixed(0)} %</span></div>
      </div>`;
  }).join(''));
}

/** Ring für Anteile (z. B. Belegquote). */
export function donut(fraction, { size = 96, color = 'var(--accent)', label = '' } = {}) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const f = clamp(fraction || 0, 0, 1);
  return raw(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="8"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
              stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" stroke-linecap="round"
              transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="50%" text-anchor="middle" dy="5" style="fill:var(--text);font-size:16px;font-weight:650">${Math.round(f * 100)}%</text>
      ${label ? `<title>${esc(label)}</title>` : ''}
    </svg>`);
}

/** Kompakter Verlauf ohne Achsen. */
export function sparkline(values, { width = 120, height = 32, color = 'var(--accent)' } = {}) {
  if (!values.length) return raw('');
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`);
  return raw(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/></svg>`);
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

function shortMoney(cents) {
  const v = cents / 100;
  const a = Math.abs(v);
  if (a >= 1000000) return (v / 1000000).toFixed(1).replace('.', ',') + ' Mio';
  if (a >= 1000) return Math.round(v / 1000) + 'k';
  return Math.round(v).toString();
}

export { eur };
