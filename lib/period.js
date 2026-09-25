/**
 * Zeitraumauswahl – von Übersicht, Buchungen, Auswertungen und Exporten
 * gemeinsam genutzt.
 *
 * Früher standen dafür drei Felder nebeneinander: eine Auswahlliste und zwei
 * Datumsfelder, die meist gesperrt waren. Jetzt ist es ein einziger Knopf mit
 * dem Zeitraum als Beschriftung („Jahr 2026“, „3. Quartal 2026“) und zwei
 * Pfeilen, die um genau diese Länge vor- und zurückblättern. Ein Klick auf den
 * Knopf öffnet die Schnellwahl, ein Raster aus Jahr, Quartalen und Monaten und
 * darunter einen frei wählbaren Zeitraum.
 */

import {
  html, raw, esc, todayISO, monthStart, monthEnd, addMonths, addDays, quarterRange, fmtDate,
  daysBetween, MONTHS, MONTHS_SHORT,
} from './util.js';
import { icon } from './ui.js';
import { openPopover } from './popover.js';

export const PRESETS = [
  'dieser-monat', 'letzter-monat', 'dieses-quartal', 'letztes-quartal',
  'dieses-jahr', 'letztes-jahr', 'alles', 'benutzerdefiniert',
];

const LABELS = {
  'dieser-monat': 'Dieser Monat',
  'letzter-monat': 'Letzter Monat',
  'dieses-quartal': 'Dieses Quartal',
  'letztes-quartal': 'Letztes Quartal',
  'dieses-jahr': 'Dieses Jahr',
  'letztes-jahr': 'Letztes Jahr',
  alles: 'Gesamter Bestand',
  benutzerdefiniert: 'Eigener Zeitraum',
};

export function resolvePreset(preset, today = todayISO()) {
  const y = Number(today.slice(0, 4));
  const q = Math.floor(Number(today.slice(5, 7) - 1) / 3) + 1;
  switch (preset) {
    case 'dieser-monat': return { from: monthStart(today), to: monthEnd(today) };
    case 'letzter-monat': {
      const p = addMonths(monthStart(today), -1);
      return { from: monthStart(p), to: monthEnd(p) };
    }
    case 'dieses-quartal': return quarterRange(y, q);
    case 'letztes-quartal': return q === 1 ? quarterRange(y - 1, 4) : quarterRange(y, q - 1);
    case 'dieses-jahr': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'letztes-jahr': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'alles': return { from: '1900-01-01', to: '2999-12-31' };
    default: return null;
  }
}

export function defaultPeriod() {
  const preset = 'dieses-jahr';
  return { preset, ...resolvePreset(preset) };
}

/** Welche Schnellwahl ergibt genau diesen Zeitraum? Sonst „benutzerdefiniert“. */
export function matchPreset(from, to) {
  for (const k of PRESETS) {
    const r = resolvePreset(k);
    if (r && r.from === from && r.to === to) return k;
  }
  return 'benutzerdefiniert';
}

/** Setzt einen Zeitraum und bestimmt die passende Schnellwahl dazu. */
export function setPeriod(p, from, to) {
  if (from > to) [from, to] = [to, from];
  p.from = from;
  p.to = to;
  p.preset = matchPreset(from, to);
  return p;
}

/** Lesbarer Titel, z. B. „März 2025“ oder „01.04.2025 – 30.06.2025“. */
export function periodLabel(p) {
  if (p.preset === 'alles') return 'Gesamter Bestand';
  if (p.from.slice(0, 4) === p.to.slice(0, 4)) {
    const y = p.from.slice(0, 4);
    if (p.from.endsWith('-01-01') && p.to.endsWith('-12-31')) return `Jahr ${y}`;
    if (p.from === monthStart(p.from) && p.to === monthEnd(p.from) && p.from.slice(5, 7) === p.to.slice(5, 7)) {
      return `${MONTHS[Number(p.from.slice(5, 7)) - 1]} ${y}`;
    }
    const q = quarterRange(Number(y), Math.floor((Number(p.from.slice(5, 7)) - 1) / 3) + 1);
    if (q.from === p.from && q.to === p.to) return `${Math.floor((Number(p.from.slice(5, 7)) - 1) / 3) + 1}. Quartal ${y}`;
  }
  return `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
}

/**
 * Der Zeitraum davor oder danach, gleich lang: aus einem Monat wird der
 * Vormonat, aus einem Quartal das Vorquartal, aus einem Jahr das Vorjahr.
 * Umfasst der Zeitraum ganze Monate, wird monatsweise geblättert, sonst
 * tageweise. Für den gesamten Bestand gibt es kein Davor.
 */
export function stepPeriod(p, dir) {
  if (p.preset === 'alles') return null;
  const ganzeMonate = p.from === monthStart(p.from) && p.to === monthEnd(p.to);
  if (ganzeMonate) {
    const n = (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12
      + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1;
    const from = addMonths(p.from, dir * n);
    return { from, to: monthEnd(addMonths(monthStart(p.to), dir * n)) };
  }
  const tage = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, dir * tage), to: addDays(p.to, dir * tage) };
}

/* -------------------------------------------------------------------------- */
/* Bedienelement                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Setzt die Zeitraumwahl in `container` und verdrahtet sie. `onChange` wird
 * nach jeder Änderung von `p` gerufen.
 * @returns {{update: Function}} zeichnet den Knopf neu, wenn `p` von außen geändert wurde
 */
export function periodControl(container, p, onChange) {
  container.classList.add('period');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Zeitraum');

  const paint = () => {
    const vor = stepPeriod(p, -1);
    const nach = stepPeriod(p, 1);
    container.innerHTML = html`
      <button type="button" class="btn period-step" data-step="-1" ${vor ? '' : raw('disabled')}
        aria-label="${vor ? `Vorheriger Zeitraum: ${periodLabel({ ...vor, preset: '' })}` : 'Vorheriger Zeitraum'}"
        title="${vor ? periodLabel({ ...vor, preset: '' }) : ''}">${icon('left', 15)}</button>
      <button type="button" class="btn period-btn" aria-haspopup="dialog" aria-expanded="false"
        title="Zeitraum wählen – ${LABELS[p.preset] || 'Eigener Zeitraum'}">
        ${icon('calendar', 15)}<span class="period-label">${periodLabel(p)}</span>${icon('down', 14)}
      </button>
      <button type="button" class="btn period-step" data-step="1" ${nach ? '' : raw('disabled')}
        aria-label="${nach ? `Nächster Zeitraum: ${periodLabel({ ...nach, preset: '' })}` : 'Nächster Zeitraum'}"
        title="${nach ? periodLabel({ ...nach, preset: '' }) : ''}">${icon('right', 15)}</button>`;
  };

  const apply = (from, to, preset) => {
    if (preset) { p.preset = preset; p.from = from; p.to = to; } else setPeriod(p, from, to);
    paint();
    onChange(p);
  };

  container.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const r = stepPeriod(p, Number(step.dataset.step));
      if (r) apply(r.from, r.to);
      container.querySelector(`[data-step="${step.dataset.step}"]`)?.focus();
      return;
    }
    const btn = e.target.closest('.period-btn');
    if (btn) openPicker(btn, p, apply);
  });

  paint();
  return { update: paint };
}

/** Das aufgeklappte Feld: Schnellwahl links, Jahresraster rechts, eigener Zeitraum unten. */
function openPicker(anchor, p, apply) {
  let jahr = Number((p.preset === 'alles' ? todayISO() : p.to).slice(0, 4));
  const heute = todayISO();

  const presetList = () => PRESETS.filter((k) => k !== 'benutzerdefiniert').map((k) => {
    const r = resolvePreset(k);
    const an = p.preset === k;
    return `<button type="button" class="pp-preset${an ? ' active' : ''}" data-nav data-preset="${k}" aria-pressed="${an}">
      <span>${esc(LABELS[k])}</span>${k === 'alles' ? '' : `<span class="pp-hint">${esc(periodLabel({ ...r, preset: k }))}</span>`}
    </button>`;
  }).join('');

  const cell = (from, to, text, title, cls = '') => {
    const an = p.from === from && p.to === to;
    const zukunft = from > heute;
    return `<button type="button" class="pp-cell ${cls}${an ? ' active' : ''}${zukunft ? ' future' : ''}" data-nav
      data-from="${from}" data-to="${to}" aria-pressed="${an}" title="${esc(title)}">${esc(text)}</button>`;
  };

  const raster = () => {
    const y = jahr;
    const quartale = [1, 2, 3, 4].map((q) => {
      const r = quarterRange(y, q);
      return cell(r.from, r.to, `Q${q}`, `${q}. Quartal ${y}`);
    }).join('');
    const monate = MONTHS_SHORT.map((m, i) => {
      const from = `${y}-${String(i + 1).padStart(2, '0')}-01`;
      return cell(from, monthEnd(from), m, `${MONTHS[i]} ${y}`);
    }).join('');
    return `
      <div class="pp-year">
        <button type="button" class="icon-btn" data-year="-1" aria-label="Jahr ${y - 1}">${icon('left', 15).__raw}</button>
        <strong>${y}</strong>
        <button type="button" class="icon-btn" data-year="1" aria-label="Jahr ${y + 1}">${icon('right', 15).__raw}</button>
      </div>
      ${cell(`${y}-01-01`, `${y}-12-31`, 'Ganzes Jahr', `Jahr ${y}`, 'wide')}
      <div class="pp-grid q">${quartale}</div>
      <div class="pp-grid m">${monate}</div>`;
  };

  openPopover(anchor, {
    label: 'Zeitraum wählen',
    className: 'pp',
    build: (pop, handle) => {
      const eigen = p.preset === 'alles' ? resolvePreset('dieses-jahr') : p;
      pop.innerHTML = `
        <div class="pp-main">
          <div class="pp-presets" role="group" aria-label="Schnellwahl">
            <div class="menu-title">Schnellwahl</div>
            ${presetList()}
          </div>
          <div class="pp-cal" role="group" aria-label="Jahr, Quartal oder Monat">${raster()}</div>
        </div>
        <form class="pp-custom">
          <div class="menu-title">Eigener Zeitraum</div>
          <div class="pp-custom-row">
            <label><span>von</span><input type="date" name="from" value="${esc(eigen.from)}" required></label>
            <label><span>bis</span><input type="date" name="to" value="${esc(eigen.to)}" required></label>
            <button type="submit" class="btn sm primary">Übernehmen</button>
          </div>
        </form>`;

      const fertig = (from, to, preset) => { handle.close(true); apply(from, to, preset); };
      pop.addEventListener('click', (e) => {
        const pre = e.target.closest('[data-preset]');
        if (pre) { const r = resolvePreset(pre.dataset.preset); fertig(r.from, r.to, pre.dataset.preset); return; }
        const c = e.target.closest('[data-from]');
        if (c) { fertig(c.dataset.from, c.dataset.to); return; }
        const y = e.target.closest('[data-year]');
        if (y) {
          jahr += Number(y.dataset.year);
          pop.querySelector('.pp-cal').innerHTML = raster();
          pop.querySelector(`[data-year="${y.dataset.year}"]`)?.focus();
        }
      });
      pop.querySelector('.pp-custom').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.from.value || !f.to.value) return;
        fertig(f.from.value, f.to.value);
      });
    },
  });
}
