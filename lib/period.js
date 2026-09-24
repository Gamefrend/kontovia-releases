/** Zeitraumauswahl – von Buchungen, Auswertungen und Exporten gemeinsam genutzt. */

import { html, raw, esc, todayISO, monthStart, monthEnd, addMonths, quarterRange, fmtDate, MONTHS } from './util.js';

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

export function periodPickerHtml(p, idPrefix = 'per') {
  return html`
    <select id="${idPrefix}Preset" title="Zeitraum">
      ${raw(PRESETS.map((k) => `<option value="${k}" ${p.preset === k ? 'selected' : ''}>${esc(LABELS[k])}</option>`).join(''))}
    </select>
    <input type="date" id="${idPrefix}From" value="${p.from}" ${p.preset !== 'benutzerdefiniert' ? 'disabled' : ''} title="von">
    <input type="date" id="${idPrefix}To" value="${p.to}" ${p.preset !== 'benutzerdefiniert' ? 'disabled' : ''} title="bis">`;
}

/** Verdrahtet die Auswahl. onChange bekommt das aktualisierte Objekt. */
export function wirePeriodPicker(root, p, onChange, idPrefix = 'per') {
  const presetEl = root.querySelector('#' + idPrefix + 'Preset');
  const fromEl = root.querySelector('#' + idPrefix + 'From');
  const toEl = root.querySelector('#' + idPrefix + 'To');
  if (!presetEl) return;

  presetEl.addEventListener('change', () => {
    p.preset = presetEl.value;
    const r = resolvePreset(p.preset);
    if (r) { p.from = r.from; p.to = r.to; fromEl.value = r.from; toEl.value = r.to; }
    const custom = p.preset === 'benutzerdefiniert';
    fromEl.disabled = !custom;
    toEl.disabled = !custom;
    onChange(p);
  });
  const upd = () => {
    p.from = fromEl.value || p.from;
    p.to = toEl.value || p.to;
    if (p.from > p.to) [p.from, p.to] = [p.to, p.from];
    onChange(p);
  };
  fromEl.addEventListener('change', upd);
  toEl.addEventListener('change', upd);
}
