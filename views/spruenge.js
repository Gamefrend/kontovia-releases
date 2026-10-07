/**
 * Kontovia – Sprünge von einem Hinweis zu den Daten dahinter.
 *
 * Gebraucht in Übersicht, Auswertungen und Kalender. Eigenes Modul, damit sich
 * die Ansichten nicht gegenseitig importieren müssen.
 */

import { esc } from '../lib/util.js';
import { navigate } from '../lib/router.js';

/**
 * Ein Hinweis der Plausibilitätsprüfung (healthChecks in calc.js). Nennt er
 * Buchungen, führt „anzeigen“ genau zu ihnen – bis Fassung 1.7 stand dort nur
 * die Zahl, und gesucht werden musste von Hand.
 */
export function checkNotice(k, i) {
  const cls = k.level === 'error' ? 'danger' : k.level === 'warn' ? 'warn' : '';
  const link = k.ids?.length
    ? ` <button type="button" class="stat-link check-link" data-check="${i}">${k.ids.length === 1 ? 'Ansehen' : 'Alle ansehen'}</button>`
    : '';
  return `<div class="notice ${cls} mb8">${esc(k.text)}${link}</div>`;
}

/** Verdrahtet die Knöpfe aus checkNotice(); `periode` ist der Zeitraum der Prüfung. */
export function wireCheckLinks(root, checks, periode) {
  root.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => {
    const k = checks[Number(b.dataset.check)];
    if (!k) return;
    navigate('transactions', {
      ids: k.ids,
      titel: k.text.length > 60 ? `${k.text.slice(0, 57)} …` : k.text,
      period: { preset: periode.preset, from: periode.from, to: periode.to },
      status: 'alle',
    });
  }));
}

/** Ein Steuertermin (lib/fristen.js) führt zu den Zahlen, die dafür gebraucht werden. */
export function oeffneFrist(t) {
  if (!t) return;
  if (t.art === 'zm') navigate('export', { period: t.zeitraum });
  else if (t.art === 'est' || t.art === 'gewst') navigate('reports', { tab: 'guv' });
  else if (t.zeitraum) navigate('reports', { tab: 'ust', period: t.zeitraum });
  else if (t.jahr) navigate('export', { period: { from: `${t.jahr}-01-01`, to: `${t.jahr}-12-31` } });
  else navigate('reports', { tab: 'ust' });
}
