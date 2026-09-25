/** Winziger Router – hält die aktuelle Ansicht und benachrichtigt die Hülle. */

/**
 * `leaveGuard` setzt eine Ansicht mit ungesicherten Eingaben (etwa die
 * Einstellungen). Vor jedem Wechsel wird sie gefragt; liefert sie false,
 * bleibt die Ansicht stehen. Beim Sperren wird sie verworfen.
 */
export const router = { view: 'dashboard', params: {}, handler: null, leaveGuard: null };

export function onNavigate(fn) { router.handler = fn; }

export async function navigate(view, params = {}) {
  if (router.leaveGuard) {
    const guard = router.leaveGuard;
    if (!(await guard())) return;
    if (router.leaveGuard === guard) router.leaveGuard = null;
  }
  router.view = view;
  router.params = params;
  if (router.handler) router.handler(view, params);
}

export function refresh() {
  if (router.handler) router.handler(router.view, router.params);
}
