/**
 * Kontovia – Grundbausteine der Oberfläche.
 *
 * Geldbeträge werden im gesamten Programm als ganzzahlige Cent geführt.
 * Fließkommazahlen haben in einer Buchhaltung nichts verloren: 0.1 + 0.2 ist
 * dort nicht 0.3, und genau solche Abweichungen summieren sich über ein Jahr
 * zu Differenzen, die man später mühsam sucht.
 */

/* -------------------------------------------------------------------------- */
/* HTML sicher zusammensetzen                                                  */
/* -------------------------------------------------------------------------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export function raw(value) {
  return { __raw: String(value ?? '') };
}

function part(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && '__raw' in v) return v.__raw;
  return esc(v);
}

/** Tagged Template. Alle eingesetzten Werte werden maskiert, außer raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return out;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegierter Event-Handler: on(root, 'click', '[data-act="x"]', fn) */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (ev) => {
    const target = ev.target.closest(selector);
    if (target && root.contains(target)) handler(ev, target);
  });
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* Geld                                                                        */
/* -------------------------------------------------------------------------- */

const nfMoney = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfMoneyCur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const nfInt = new Intl.NumberFormat('de-DE');
const nfPct = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Cent → "1.234,56" */
export function money(cents, { sign = false, currency = false } = {}) {
  const n = (Number(cents) || 0) / 100;
  const s = currency ? nfMoneyCur.format(n) : nfMoney.format(n);
  return sign && n > 0 ? '+' + s : s;
}

export function eur(cents, opts) {
  return money(cents, { currency: true, ...opts });
}

export function int(n) {
  return nfInt.format(Number(n) || 0);
}

export function pct(fraction) {
  if (!Number.isFinite(fraction)) return '–';
  return nfPct.format(fraction * 100) + ' %';
}

/** "1.234,56" / "1234.56" / "1234" → Cent (ganzzahlig). */
export function parseMoney(input) {
  if (typeof input === 'number') return Math.round(input * 100);
  let s = String(input ?? '').trim();
  if (!s) return 0;
  s = s.replace(/[€\s ']/g, '');
  const neg = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[()-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Das hintere Zeichen ist das Dezimaltrennzeichen.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Komma ist Dezimaltrenner, außer es steht als Tausenderzeichen (1,234)
    s = s.length - lastComma === 4 && /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

/** Cent → Eingabefeld-Wert "1234,56" */
export function moneyInput(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  return ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
}

/* Umsatzsteuer – kaufmännisch gerundet, Brutto ist immer Netto + Steuer. */

export function splitFromGross(grossCents, rate) {
  const r = Number(rate) || 0;
  if (!r) return { net: grossCents, vat: 0, gross: grossCents };
  const net = Math.round(grossCents / (1 + r / 100));
  return { net, vat: grossCents - net, gross: grossCents };
}

export function splitFromNet(netCents, rate) {
  const r = Number(rate) || 0;
  const vat = Math.round((netCents * r) / 100);
  return { net: netCents, vat, gross: netCents + vat };
}

/* -------------------------------------------------------------------------- */
/* Datum – intern immer ISO "YYYY-MM-DD"                                       */
/* -------------------------------------------------------------------------- */

export function todayISO() {
  return toISO(new Date());
}

export function toISO(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function fromISO(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export function fmtDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

/** Kurzform DD.MM.JJ – für enge Tabellenspalten. */
export function fmtDateShort(iso) {
  if (!iso) return '–';
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

export function fmtDateLong(iso) {
  if (!iso) return '–';
  return fromISO(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function fmtDateTime(isoTs) {
  if (!isoTs) return '–';
  return new Date(isoTs).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function addMonths(iso, n) {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function monthStart(iso) { return String(iso).slice(0, 8) + '01'; }

export function monthEnd(iso) {
  const d = fromISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function yearStart(y) { return `${y}-01-01`; }
export function yearEnd(y) { return `${y}-12-31`; }

export function quarterOf(iso) { return Math.floor(Number(String(iso).slice(5, 7)) / 3.0001) + 1; }

export function quarterRange(year, q) {
  const m0 = (q - 1) * 3;
  const from = `${year}-${String(m0 + 1).padStart(2, '0')}-01`;
  return { from, to: monthEnd(`${year}-${String(m0 + 3).padStart(2, '0')}-01`) };
}

export function ym(iso) { return String(iso).slice(0, 7); }

export function ymLabel(ymStr) {
  const [y, m] = ymStr.split('-');
  return `${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

/** Liste aller Monatsschlüssel zwischen zwei Daten (einschließlich). */
export function monthsBetween(from, to) {
  const out = [];
  let cur = monthStart(from);
  const end = ym(to);
  let guard = 0;
  while (ym(cur) <= end && guard++ < 600) {
    out.push(ym(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

/** ISO-Kalenderwoche */
export function isoWeek(iso) {
  const d = fromISO(iso);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNr + 3);
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  const diff = t - firstThursday;
  return 1 + Math.round(diff / 604800000);
}

export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

export function relativeDays(iso) {
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  if (diff > 0) return `in ${diff} Tagen`;
  return `vor ${-diff} Tagen`;
}

/* -------------------------------------------------------------------------- */
/* Sonstiges                                                                   */
/* -------------------------------------------------------------------------- */

export function uid(prefix = 'id') {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return prefix + '_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function bytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}

/** Sortier-/Suchfreundliche Normalisierung (ohne Umlaut-Stolpern). */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function sortBy(arr, key, dir = 1) {
  const f = typeof key === 'function' ? key : (o) => o[key];
  return [...arr].sort((a, b) => {
    const x = f(a), y = f(b);
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'de')) * dir;
  });
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

export function sum(arr, f = (x) => x) {
  let t = 0;
  for (const x of arr) t += f(x) || 0;
  return t;
}

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** Farbwert aus einem Text – stabil, für Kategorie-/Kontaktpunkte. */
export function hueOf(text) {
  let h = 0;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
