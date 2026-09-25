/**
 * Kontovia – Tabellen mit Sortieren, Filtern und Suche.
 *
 * Ein Baustein für alle Datenlisten, damit sie sich gleich bedienen lassen:
 *
 *   • Jede sortierbare Spalte hat im Kopf einen Sortierknopf. Ein Klick sortiert
 *     nach dieser Spalte, ein zweiter kehrt die Richtung um; der Pfeil zeigt,
 *     wonach und in welche Richtung gerade sortiert ist.
 *   • Größere Listen haben darüber eine Leiste mit Suche und dem Knopf
 *     „Sortieren“, der Spalte und Richtung in Worten nennt und beides zur Wahl
 *     stellt – auch dort, wo die Spaltenköpfe auf dem Telefon aus dem Bild ragen.
 *   • Spalten mit Filter tragen zusätzlich einen Trichter. Neben jeder
 *     Möglichkeit steht, wie viele Zeilen sie ergibt; gesetzte Filter stehen als
 *     Chips über der Tabelle.
 *   • Auf schmalen Bildschirmen, wo Spaltenköpfe wegfallen, bündelt der Knopf
 *     „Filter“ in der Leiste alle Filter der Tabelle in einem Menü.
 *   • Leere Werte stehen beim Sortieren immer am Ende, gleich in welcher
 *     Richtung; bei gleichen Werten bleibt die ursprüngliche Reihenfolge.
 *
 * Aufstellungen mit vorgegebener Reihenfolge – Zeilen der Anlage EÜR,
 * Kennzahlen der Umsatzsteuer, Kontenblätter mit laufendem Saldo – nutzen den
 * Baustein bewusst nicht: umsortiert verlören sie ihren Sinn.
 *
 * Die gewählte Sortierung bleibt auf diesem Gerät (wie die Diagrammwahl),
 * Suche und Filter gelten bis zum Neustart.
 */

import { esc, norm, debounce } from './util.js';
import { icon } from './ui.js';
import { openMenu } from './popover.js';

/**
 * @typedef {object} Column
 * @property {string} key
 * @property {string} label          Überschrift; leer bei reinen Symbolspalten
 * @property {'text'|'num'|'date'|'none'} [type]  bestimmt Vergleich und Wortlaut; 'none' = nicht sortierbar
 * @property {(r:any)=>any} [value]  Sortierwert (Standard: r[key])
 * @property {(r:any)=>string} [cell] HTML der Zelle (Standard: maskierter Wert)
 * @property {string} [cls]          Klassen für Kopf und Zellen, etwa zum Ausblenden bei schmalem Fenster
 * @property {string} [tdCls]        zusätzliche Klassen nur für die Zellen
 * @property {string} [width]
 * @property {string} [sortLabel]    Name im Sortiermenü, falls die Überschrift leer oder knapp ist
 * @property {1|-1} [dir]            Richtung beim ersten Klick (Standard: Text aufsteigend, Zahl und Datum absteigend)
 * @property {[string,string]} [dirText] Wortlaut für aufsteigend und absteigend, wenn der übliche nicht passt
 * @property {'left'} [align]       linksbündig trotz type 'num', etwa bei einer Rangfolge
 *
 * @typedef {object} Filter
 * @property {string} key
 * @property {string} column         in welchem Spaltenkopf der Trichter sitzt
 * @property {string} title
 * @property {string} initial        Wert ohne Filter – auf ihn setzt „zurücksetzen“ zurück
 * @property {(rows:any[]) => Array<[string,string,(r:any)=>boolean,string?]>} options  [Wert, Beschriftung, Test, Zusatz]
 * @property {(value:string, label:string)=>string} [chip]  Text des Chips
 * @property {boolean} [search]      Suchfeld über einer langen Liste
 * @property {boolean} [hideEmpty]   Möglichkeiten ohne Treffer erst bei Suche zeigen
 *
 * Weitere Angaben der Tabelle: id (merkt sich Sortierung und Filter), columns,
 * filters, rows (Liste oder Funktion), defaultSort, search {text, placeholder, id},
 * toolbar (Leiste mit Suche und „Sortieren“; Standard bei Suche oder bei mehr als zehn
 * Zeilen und drei sortierbaren Spalten), summary, onRowClick, rowClickable, rowAttrs, rowClass,
 * foot, emptyTitle/emptyText/emptyHtml, onRender, unit ([Einzahl, Mehrzahl]), maxHeight
 * (eigener Scrollbereich, etwa in Fenstern – die Spaltenköpfe bleiben dann stehen).
 */

const SORT_KEY = 'kontovia.sortierung';
const states = new Map();
const pending = new Map();
let seq = 0;

function savedSorts() {
  try { return JSON.parse(globalThis.localStorage?.getItem(SORT_KEY) || '{}') || {}; } catch { return {}; }
}

function saveSort(id, sort) {
  try {
    const all = savedSorts();
    all[id] = sort;
    globalThis.localStorage?.setItem(SORT_KEY, JSON.stringify(all));
  } catch { /* dann eben nur bis zum Neustart */ }
}

/**
 * Zustand einer Tabelle: Sortierung, Filterwerte, Suchtext. Ansichten setzen
 * darüber Filter von außen, etwa „Buchungen ohne Beleg“ aus der Übersicht.
 */
export function tableState(id, defaultSort = null) {
  if (!states.has(id)) states.set(id, { sort: savedSorts()[id] || defaultSort, filters: {}, q: '' });
  return states.get(id);
}

const isSortable = (c) => c.type !== 'none' && !!(c.label || c.sortLabel);
const firstDir = (c) => c.dir ?? (c.type === 'num' || c.type === 'date' ? -1 : 1);
const valueOf = (c, r) => (c.value ? c.value(r) : r[c.key]);
/** Zahlenspalten stehen rechtsbündig – außer sie sortieren nur nach einer Rangfolge (align: 'left'). */
const isNum = (c) => c.type === 'num' && c.align !== 'left';
const leer = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Wortlaut der Richtung, passend zur Art der Spalte. */
function dirText(c, dir) {
  if (c.dirText) return c.dirText[dir === 1 ? 0 : 1];
  if (c.type === 'num') return dir === 1 ? 'kleinste zuerst' : 'größte zuerst';
  if (c.type === 'date') return dir === 1 ? 'älteste zuerst' : 'neueste zuerst';
  return dir === 1 ? 'A bis Z' : 'Z bis A';
}

function compare(a, b, type) {
  if (type === 'num') return Number(a) - Number(b);
  if (type === 'date') return a < b ? -1 : a > b ? 1 : 0;
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
}

/** Sortiert stabil; leere Werte immer ans Ende. */
export function sortRows(rows, columns, sort) {
  const c = sort && columns.find((x) => x.key === sort.key && isSortable(x));
  if (!c) return rows;
  return rows
    .map((r, i) => ({ r, i, v: valueOf(c, r) }))
    .sort((x, y) => {
      const lx = leer(x.v);
      const ly = leer(y.v);
      if (lx || ly) return lx === ly ? x.i - y.i : lx ? 1 : -1;
      return compare(x.v, y.v, c.type) * sort.dir || x.i - y.i;
    })
    .map((x) => x.r);
}

/**
 * Platzhalter für eine Tabelle; eingesetzt wird sie von mountTables(), sobald
 * das HTML auf der Seite steht – wie bei den Diagrammen.
 */
export function table(spec) {
  const id = `dt${++seq}`;
  pending.set(id, spec);
  return { __raw: `<div class="dt-host" data-dt="${id}"></div>` };
}

/** Setzt alle Tabellen-Platzhalter unterhalb von root ein. */
export function mountTables(root) {
  for (const host of root.querySelectorAll('.dt-host[data-dt]')) {
    const spec = pending.get(host.dataset.dt);
    pending.delete(host.dataset.dt);
    host.removeAttribute('data-dt');
    if (spec) mountTable(host, spec);
  }
  if (pending.size > 60) pending.clear();
}

/**
 * Setzt eine Tabelle in `host` und verdrahtet sie.
 * @returns {{render: Function, state: object, rows: () => any[]}}
 */
export function mountTable(host, spec) {
  const st = tableState(spec.id, spec.defaultSort || null);
  const filters = spec.filters || [];
  const sortable = spec.columns.filter(isSortable);
  // Eine gemerkte Sortierung nach einer Spalte, die es hier nicht (mehr) gibt –
  // etwa „USt“ nach dem Wechsel zum Kleinunternehmer –, fällt auf die Voreinstellung zurück.
  if (st.sort && !sortable.some((c) => c.key === st.sort.key)) st.sort = spec.defaultSort || null;
  const allRows = () => (typeof spec.rows === 'function' ? spec.rows() : spec.rows) || [];
  // Kleine Listen kommen ohne Leiste aus; dort genügen die Knöpfe in den Spaltenköpfen.
  const bar = spec.toolbar ?? (!!spec.search || (sortable.length > 3 && allRows().length > 10));
  let visible = [];
  let optionCache = new Map();

  host.innerHTML = `
    <div class="dt">
      ${bar ? `<div class="filters dt-bar">
        ${spec.search ? `<input type="search" class="search dt-search"${spec.search.id ? ` id="${esc(spec.search.id)}"` : ''}
          placeholder="${esc(spec.search.placeholder || 'Suchen …')}" aria-label="${esc(spec.search.label || spec.search.placeholder || 'Suchen')}" value="${esc(st.q)}">` : ''}
        ${sortable.length ? `<button type="button" class="btn sm dt-sort" aria-haspopup="dialog" aria-expanded="false"></button>` : ''}
        ${filters.length ? `<button type="button" class="btn sm dt-filter-all" aria-haspopup="dialog" aria-expanded="false"></button>` : ''}
        <div class="spacer"></div>
        <div class="dt-sum" aria-live="polite"></div>
      </div>` : ''}
      <div class="dt-chips"></div>
      <div class="table-wrap dt-wrap"${spec.maxHeight ? ` style="max-height:${esc(spec.maxHeight)};overflow:auto"` : ''}></div>
    </div>`;
  const el = host.firstElementChild;

  const optionsOf = (f) => {
    if (!optionCache.has(f.key)) optionCache.set(f.key, f.options(allRows()));
    return optionCache.get(f.key);
  };
  const valueFor = (f) => st.filters[f.key] ?? f.initial;
  const isActive = (f) => String(valueFor(f)) !== String(f.initial);
  const passes = (r, except = '') => {
    for (const f of filters) {
      if (f.key === except) continue;
      const opt = optionsOf(f).find((o) => String(o[0]) === String(valueFor(f)));
      if (opt && !opt[2](r)) return false;
    }
    if (spec.search && st.q && !norm(spec.search.text(r)).includes(norm(st.q))) return false;
    return true;
  };

  const sortButtonText = () => {
    const c = st.sort && sortable.find((x) => x.key === st.sort.key);
    return c ? `${c.sortLabel || c.label}: ${dirText(c, st.sort.dir)}` : 'Sortieren';
  };

  function th(c) {
    const aktiv = st.sort?.key === c.key;
    const fs = filters.filter((f) => f.column === c.key);
    const an = fs.some(isActive);
    const cls = [c.cls || '', isNum(c) ? 'num' : ''].join(' ').trim();
    const name = c.sortLabel || c.label;
    const sortBtn = isSortable(c)
      ? `<button type="button" class="th-sort${aktiv ? ' on' : ''}" data-sort="${esc(c.key)}"
          title="${esc(`Nach ${name} sortieren${aktiv ? ` – jetzt ${dirText(c, st.sort.dir)}` : ''}`)}">${c.label ? `<span>${esc(c.label)}</span>` : ''}${
          icon(aktiv ? (st.sort.dir === 1 ? 'arrowUp' : 'arrowDown') : 'sort', 13, 'ico th-arrow').__raw}</button>`
      : (c.label ? `<span class="th-label">${esc(c.label)}</span>` : '');
    const filterBtn = fs.length
      ? `<button type="button" class="th-filter${an ? ' on' : ''}" data-filter="${esc(c.key)}" aria-haspopup="dialog" aria-expanded="false"
          aria-label="${esc(`Nach ${fs.map((f) => f.title).join(' und ')} filtern${an ? ' (aktiv)' : ''}`)}"
          title="${esc(`Nach ${fs.map((f) => f.title).join(' und ')} filtern`)}">${icon('filter', 13).__raw}</button>`
      : '';
    const sortAttr = aktiv ? ` aria-sort="${st.sort.dir === 1 ? 'ascending' : 'descending'}"` : '';
    return `<th class="${cls}"${sortAttr}${c.width ? ` style="width:${c.width}"` : ''}><div class="th">${sortBtn}${filterBtn}</div></th>`;
  }

  function td(c, r) {
    const cls = [c.cls || '', c.tdCls || '', isNum(c) ? 'num' : ''].join(' ').trim();
    const v = c.cell ? c.cell(r) : esc(valueOf(c, r) ?? '');
    return `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;
  }

  function render(fokus = null) {
    optionCache = new Map();
    const rows = allRows();
    visible = sortRows(rows.filter((r) => passes(r)), spec.columns, st.sort);
    const aktiv = filters.filter(isActive);
    const gefiltert = aktiv.length > 0 || !!st.q;

    const sum = el.querySelector('.dt-sum');
    if (sum) {
      sum.innerHTML = spec.summary
        ? spec.summary(visible, rows)
        : `<span class="muted small">${gefiltert ? `${visible.length} von ${rows.length}` : rows.length} ${rows.length === 1 ? (spec.unit?.[0] || 'Eintrag') : (spec.unit?.[1] || 'Einträge')}</span>`;
    }
    const sb = el.querySelector('.dt-sort');
    if (sb) {
      sb.innerHTML = `${icon('sort', 14).__raw}<span>${esc(sortButtonText())}</span>${icon('down', 13).__raw}`;
      sb.title = 'Sortierung wählen';
    }

    const fa = el.querySelector('.dt-filter-all');
    if (fa) fa.innerHTML = `${icon('filter', 14).__raw}<span>Filter${aktiv.length ? ` (${aktiv.length})` : ''}</span>`;

    const chips = el.querySelector('.dt-chips');
    chips.innerHTML = aktiv.length ? `
      <div class="filter-chips" role="group" aria-label="Gesetzte Filter">
        <span class="muted small">${icon('filter', 13).__raw} Gefiltert:</span>
        ${aktiv.map((f) => {
          const v = valueFor(f);
          const label = optionsOf(f).find((o) => String(o[0]) === String(v))?.[1] ?? v;
          const text = f.chip ? f.chip(v, label) : `${f.title}: ${label}`;
          return `<span class="chip active">${esc(text)}<button type="button" class="chip-x" data-clear="${esc(f.key)}" aria-label="Filter „${esc(text)}“ entfernen" title="Filter entfernen">${icon('x', 12).__raw}</button></span>`;
        }).join('')}
        ${aktiv.length > 1 || st.q ? '<button type="button" class="btn sm ghost" data-reset-filters>Alle Filter zurücksetzen</button>' : ''}
      </div>` : '';

    const cols = spec.columns;
    const leerZeile = () => {
      const inhalt = !rows.length && spec.emptyHtml
        ? spec.emptyHtml()
        : `<div class="empty"><div class="big">◍</div><h4>${rows.length ? 'Keine Treffer' : esc(spec.emptyTitle || 'Keine Einträge')}</h4>
            <p class="small">${rows.length ? 'Keine Zeile passt zu Suche und Filtern.' : esc(spec.emptyText || '')}</p>
            ${gefiltert ? '<button type="button" class="btn mt16" data-reset-filters>Filter zurücksetzen</button>' : ''}</div>`;
      return `<tr class="empty-row"><td colspan="${cols.length}">${inhalt}</td></tr>`;
    };
    const klick = (r) => !!spec.onRowClick && (!spec.rowClickable || spec.rowClickable(r));
    const foot = spec.foot ? spec.foot(visible, rows) : '';
    el.querySelector('.dt-wrap').innerHTML = `
      <table class="${esc(spec.cls || 'data')}">
        <thead><tr>${cols.map(th).join('')}</tr></thead>
        <tbody>${visible.length ? visible.map((r, i) => {
          const extra = spec.rowAttrs ? spec.rowAttrs(r) : '';
          const cls = [klick(r) ? 'clickable' : '', spec.rowClass ? spec.rowClass(r) : ''].join(' ').trim();
          return `<tr data-row="${i}"${cls ? ` class="${cls}"` : ''}${klick(r) ? ' tabindex="0"' : ''}${extra ? ' ' + extra : ''}>${cols.map((c) => td(c, r)).join('')}</tr>`;
        }).join('') : leerZeile()}</tbody>
        ${foot ? `<tfoot>${foot}</tfoot>` : ''}
      </table>`;

    spec.onRender?.(el, visible);
    if (fokus) el.querySelector(fokus)?.focus();
  }

  const filterMenu = (btn) => {
    const col = btn.dataset.filter;
    // Ohne Spalte: der Knopf „Filter“ in der Leiste, dann alle Filter der Tabelle –
    // die kurzen zuerst, damit lange Listen wie Kategorien sie nicht aus dem Bild schieben.
    const fs = col
      ? filters.filter((f) => f.column === col)
      : [...filters].sort((a, b) => optionsOf(a).length - optionsOf(b).length);
    openMenu(btn, {
      label: col ? fs.map((f) => f.title).join(', ') : 'Filter',
      align: !col || btn.closest('th')?.classList.contains('num') || btn.closest('th')?.classList.contains('center') ? 'end' : 'start',
      sections: fs.map((f) => {
        const basis = allRows().filter((r) => passes(r, f.key));
        return {
          key: f.key,
          title: f.title,
          value: valueFor(f),
          search: f.search,
          hideEmpty: f.hideEmpty,
          options: optionsOf(f).map(([value, label, test, sub]) => ({ value, label, sub, count: basis.filter(test).length })),
        };
      }),
      onPick: (key, val) => {
        st.filters[key] = val;
        render(col ? `[data-filter="${CSS.escape(col)}"]` : '.dt-filter-all');
      },
    });
  };

  const sortMenu = (btn) => openMenu(btn, {
    label: 'Sortieren',
    align: 'end',
    keepOpen: true,
    sections: () => {
      const c = st.sort && sortable.find((x) => x.key === st.sort.key);
      return [
        { key: 'col', title: 'Sortieren nach', value: c?.key ?? '', options: sortable.map((x) => ({ value: x.key, label: x.sortLabel || x.label })) },
        c && {
          key: 'dir', title: 'Reihenfolge', value: String(st.sort.dir),
          options: [{ value: '1', label: dirText(c, 1) }, { value: '-1', label: dirText(c, -1) }],
        },
      ];
    },
    onPick: (key, val) => {
      if (key === 'col') {
        const c = sortable.find((x) => x.key === val);
        st.sort = { key: val, dir: st.sort?.key === val ? st.sort.dir : firstDir(c) };
      } else {
        st.sort = { ...st.sort, dir: Number(val) };
      }
      saveSort(spec.id, st.sort);
      render();
    },
  });

  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]');
    if (s && el.contains(s)) {
      const key = s.dataset.sort;
      const c = sortable.find((x) => x.key === key);
      st.sort = st.sort?.key === key ? { key, dir: -st.sort.dir } : { key, dir: firstDir(c) };
      saveSort(spec.id, st.sort);
      render(`[data-sort="${CSS.escape(key)}"]`);
      return;
    }
    const f = e.target.closest('[data-filter]');
    if (f && el.contains(f)) { filterMenu(f); return; }
    if (e.target.closest('.dt-sort')) { sortMenu(e.target.closest('.dt-sort')); return; }
    if (e.target.closest('.dt-filter-all')) { filterMenu(e.target.closest('.dt-filter-all')); return; }
    const x = e.target.closest('[data-clear]');
    if (x && el.contains(x)) {
      const fl = filters.find((y) => y.key === x.dataset.clear);
      if (fl) st.filters[fl.key] = fl.initial;
      render('.chip-x');
      if (!el.querySelector('.chip-x')) (el.querySelector('.dt-search') || el.querySelector('th button'))?.focus();
      return;
    }
    if (e.target.closest('[data-reset-filters]')) {
      st.filters = {};
      st.q = '';
      const inp = el.querySelector('.dt-search');
      if (inp) inp.value = '';
      render();
      (inp || el.querySelector('th button'))?.focus();
      return;
    }
    if (!spec.onRowClick) return;
    const tr = e.target.closest('tbody tr[data-row]');
    // Knöpfe und Verweise in einer Zeile haben ihre eigene Aufgabe.
    if (!tr || !tr.classList.contains('clickable') || e.target.closest('button, a, input, select, label')) return;
    spec.onRowClick(visible[Number(tr.dataset.row)], e);
  });
  el.addEventListener('keydown', (e) => {
    if (!spec.onRowClick || (e.key !== 'Enter' && e.key !== ' ')) return;
    const tr = e.target.closest?.('tbody tr[data-row]');
    if (!tr || e.target !== tr || !tr.classList.contains('clickable')) return;
    e.preventDefault();
    spec.onRowClick(visible[Number(tr.dataset.row)], e);
  });
  el.querySelector('.dt-search')?.addEventListener('input', debounce((e) => {
    st.q = e.target.value;
    render();
  }, 120));

  render();
  return { el, render, state: st, rows: () => visible };
}
