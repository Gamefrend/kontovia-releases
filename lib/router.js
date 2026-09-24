/** Winziger Router – hält die aktuelle Ansicht und benachrichtigt die Hülle. */

export const router = { view: 'dashboard', params: {}, handler: null };

export function onNavigate(fn) { router.handler = fn; }

export function navigate(view, params = {}) {
  router.view = view;
  router.params = params;
  if (router.handler) router.handler(view, params);
}

export function refresh() {
  if (router.handler) router.handler(router.view, router.params);
}
