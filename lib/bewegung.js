/**
 * Kontovia – Bewegung.
 *
 * Alle Animationen der Oberfläche an einer Stelle, ohne fremde Bibliothek: Die
 * Sicherheitsregeln erlauben nur eigene Skripte, und die Browser können mit der
 * Web Animations API und CSS-Kurven längst alles, was hier gebraucht wird.
 *
 * Leitlinien:
 *  - Bewegung erklärt, sie schmückt nicht: Neues kommt von unten ins Bild,
 *    Fenster wachsen aus ihrer Mitte, Zahlen laufen auf ihren Wert.
 *  - Federn (leichtes Überschwingen) nur dort, wo etwas „landet“; Verschiebungen
 *    der Seitenleiste und Verläufe laufen weich aus.
 *  - Wer „Bewegung reduzieren“ eingestellt hat, sieht nichts davon: jede
 *    Funktion hier tut dann nichts und lässt den Endzustand stehen.
 *  - Nie verzögert Bewegung eine Eingabe: Zustände im DOM stimmen sofort, die
 *    Animation läuft nur darüber (Fenster werden zum Beispiel als Abbild
 *    ausgeblendet, das echte Fenster ist längst weg).
 */

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
/** Hat jemand Bewegung abgestellt? */
export const ruhig = () => !!mq?.matches;

const kannLinear = typeof CSS !== 'undefined' && !!CSS.supports?.('animation-timing-function', 'linear(0, 1)');

/**
 * Gedämpfte Feder als CSS-Kurve `linear(…)`. `zeta` ist die Dämpfung (1 =
 * kein Überschwingen, 0,7 ≈ 5 %), `dauer` die Zeit bis zur Ruhe in Millisekunden.
 */
function feder(zeta, dauer, punkte = 56) {
  const w0 = 4 / (zeta * (dauer / 1000));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const werte = [];
  for (let i = 0; i <= punkte; i++) {
    const t = (i / punkte) * (dauer / 1000);
    const x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
    werte.push(i === punkte ? 1 : Math.round(x * 1000) / 1000);
  }
  return `linear(${werte.join(', ')})`;
}

/** Landen mit leichtem Überschwingen: Fenster, Karten, Marke der Navigation. */
export const FEDER = kannLinear ? feder(0.66, 620) : 'cubic-bezier(.2, .9, .3, 1.12)';
/** Fast ohne Überschwingen: Verschiebungen, die ruhig bleiben sollen. */
export const FEDER_WEICH = kannLinear ? feder(0.86, 560) : 'cubic-bezier(.22, 1, .36, 1)';
/** Schnell los, lang aus: Einblenden, Zahlen, Diagramme. */
export const AUS = 'cubic-bezier(.16, 1, .3, 1)';

if (typeof document !== 'undefined') {
  const st = document.documentElement.style;
  st.setProperty('--feder', FEDER);
  st.setProperty('--feder-weich', FEDER_WEICH);
  st.setProperty('--aus', AUS);
}

/** Animation starten, wenn Bewegung erwünscht ist; sonst null. */
export function animieren(el, keyframes, opts = {}) {
  if (!el || ruhig() || typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, { duration: 400, easing: AUS, fill: 'backwards', ...opts });
  } catch { return null; }
}

/* -------------------------------------------------------------------------- */
/* Ansicht betreten                                                             */
/* -------------------------------------------------------------------------- */

const ZIELE = ':scope > *, .dash > .dash-item, .grid > *, .page-head, .re-editor > *';

/**
 * Lässt die Bausteine einer frisch gezeichneten Ansicht nacheinander von unten
 * einblenden. Nur die obersten Bausteine, höchstens zwölf: Mehr ginge als
 * Wartezeit durch.
 */
export function seite(wurzel) {
  if (!wurzel || ruhig()) return;
  const alle = [...wurzel.querySelectorAll(ZIELE)]
    .filter((el) => el.nodeType === 1 && !el.hidden && el.offsetHeight > 8 && !el.classList.contains('skeleton'));
  // Wer andere Ziele enthält, bleibt still – sonst bewegte sich alles doppelt.
  const ziele = alle.filter((el) => !alle.some((o) => o !== el && el.contains(o))).slice(0, 12);
  const hoehe = window.innerHeight;
  ziele.forEach((el, i) => {
    // Was ohnehin unter dem Bildrand liegt, braucht keine Bühne.
    if (el.getBoundingClientRect().top > hoehe * 1.2) return;
    animieren(el, [
      { opacity: 0, transform: 'translateY(14px) scale(.992)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 520, delay: 40 + i * 45, easing: AUS });
  });
}

/* -------------------------------------------------------------------------- */
/* Zahlen, die auf ihren Wert laufen                                            */
/* -------------------------------------------------------------------------- */

const ZAHL = /^(\s*[−\-+]?\s*)(\d{1,3}(?:\.\d{3})+|\d+)(,\d+)?([\s\S]*)$/;
const letzteWerte = new Map();

/** Beim Wechsel der Ansicht zählen Zahlen wieder von null, nicht vom Wert der vorigen Ansicht. */
export function seitenwechsel() { letzteWerte.clear(); }

function formatZahl(wert, stellen) {
  const fest = Math.abs(wert).toFixed(stellen);
  const [ganz, rest] = fest.split('.');
  const mitPunkt = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return rest ? `${mitPunkt},${rest}` : mitPunkt;
}

function zahlLaufen(el, verzoegerung = 0) {
  if (ruhig()) return;
  const knoten = [...el.childNodes].find((n) => n.nodeType === 3 && ZAHL.test(n.nodeValue));
  if (!knoten) return;
  const [, vor, ganz, dezimal = '', nach] = ZAHL.exec(knoten.nodeValue);
  const stellen = dezimal ? dezimal.length - 1 : 0;
  const ziel = Number(ganz.replace(/./g, '') + (dezimal ? '.' + dezimal.slice(1) : ''));
  if (!Number.isFinite(ziel)) return;
  const schluessel = (el.closest('.stat')?.querySelector('.label')?.textContent || '').trim() || knoten.nodeValue;
  const von = letzteWerte.has(schluessel) ? letzteWerte.get(schluessel) : 0;
  letzteWerte.set(schluessel, ziel);
  if (von === ziel) return;
  // Der echte Text bleibt unangetastet stehen: Kopieren, Vorlesen und jede
  // Abfrage sehen immer den Endwert. Die laufende Zahl liegt als Pseudo-Element
  // darüber (siehe .zahl im Stylesheet).
  const huelle = document.createElement('span');
  huelle.className = 'zahl';
  huelle.style.setProperty('--zf', getComputedStyle(el).color);
  knoten.replaceWith(huelle);
  huelle.append(knoten);
  const dauer = von === 0 ? 1000 : 420;
  const start = performance.now() + verzoegerung;
  const zeigen = (wert) => huelle.setAttribute('data-lauf', vor + formatZahl(wert, stellen) + nach);
  zeigen(von);
  const schritt = (jetzt) => {
    if (!huelle.isConnected) return;
    const t = Math.min(1, Math.max(0, (jetzt - start) / dauer));
    // Schnell los, ruhig aus: 1 - (1 - t)^4.
    const k = 1 - (1 - t) ** 4;
    if (t >= 1) { huelle.removeAttribute('data-lauf'); return; }
    zeigen(von + (ziel - von) * k);
    requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
}

/* -------------------------------------------------------------------------- */
/* Neu eingefügte Bausteine: Zahlen, Balken, Ringe, Diagramme                   */
/* -------------------------------------------------------------------------- */

function balkenEin(el, i) {
  if (el.closest('.upd-warten')) return;
  animieren(el, [{ transform: 'scaleX(0)', transformOrigin: '0 50%' }, { transform: 'scaleX(1)', transformOrigin: '0 50%' }],
    { duration: 800, delay: 120 + i * 60, easing: AUS });
}

function ringEin(el) {
  const muster = el.getAttribute('stroke-dasharray');
  if (!muster) return;
  const [a, b] = muster.split(/[ ,]+/);
  animieren(el, [{ strokeDasharray: `0 ${b}` }, { strokeDasharray: `${a} ${b}` }], { duration: 1100, delay: 160, easing: AUS });
}

/** Zeichnet ein frisch gemaltes Diagramm von der Nulllinie aus. */
export function diagramm(host) {
  if (!host || ruhig()) return;
  const svg = host.querySelector('svg.chart');
  if (!svg) return;
  const breite = svg.viewBox?.baseVal?.width || 1;
  svg.querySelectorAll('.bar-pos, .bar-neg').forEach((p) => {
    const runter = p.classList.contains('dn');
    const ursprung = runter ? '50% 0%' : '50% 100%';
    // Von links nach rechts nacheinander, als wüchse das Jahr.
    const x = p.getBBox?.().x ?? 0;
    animieren(p, [{ transform: 'scaleY(0)', transformOrigin: ursprung }, { transform: 'scaleY(1)', transformOrigin: ursprung }],
      { duration: 700, delay: 60 + (x / breite) * 380, easing: FEDER_WEICH });
  });
  svg.querySelectorAll('polyline.line, polyline.line-profit').forEach((l, i) => {
    l.setAttribute('pathLength', '1');
    animieren(l, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
      { duration: 1100, delay: 120 + i * 90, easing: AUS });
  });
  svg.querySelectorAll('circle.pt').forEach((c) => {
    const x = Number(c.getAttribute('cx')) || 0;
    animieren(c, [{ opacity: 0, transform: 'scale(.2)', transformOrigin: 'center', transformBox: 'fill-box' }, { opacity: 1, transform: 'scale(1)', transformOrigin: 'center', transformBox: 'fill-box' }],
      { duration: 420, delay: 500 + (x / breite) * 600, easing: FEDER });
  });
  svg.querySelectorAll('.avg-line, .avg-label').forEach((a) => animieren(a, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 700 }));
  svg.querySelectorAll('.slice').forEach((s, i) => {
    animieren(s, [
      { opacity: 0, transform: 'rotate(-28deg) scale(.86)', transformOrigin: '50% 50%', transformBox: 'view-box' },
      { opacity: 1, transform: 'rotate(0) scale(1)', transformOrigin: '50% 50%', transformBox: 'view-box' },
    ], { duration: 760, delay: 40 + i * 70, easing: FEDER_WEICH });
  });
  svg.querySelectorAll('.pie-total, .pie-sub').forEach((t) => animieren(t, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 300 }));
  host.querySelectorAll('.pie-legend li').forEach((li, i) => animieren(li, [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 200 + i * 55 }));
}

function eingefuegt(el) {
  if (el.nodeType !== 1) return;
  const werte = el.matches('.stat .value') ? [el] : [...el.querySelectorAll('.stat .value')];
  werte.forEach((w, i) => zahlLaufen(w, 120 + i * 70));
  const balken = el.matches('.bar-track .bar-fill') ? [el] : [...el.querySelectorAll('.bar-track .bar-fill')];
  balken.forEach(balkenEin);
  const ringe = el.matches('.donut-fill') ? [el] : [...el.querySelectorAll('.donut-fill')];
  ringe.forEach(ringEin);
}

/** Beobachtet die Ansicht: Was neu hineinkommt, bekommt seine Bewegung. */
export function beobachten(wurzel) {
  if (!wurzel || wurzel.__bewegung || typeof MutationObserver !== 'function') return;
  wurzel.__bewegung = new MutationObserver((liste) => {
    if (ruhig()) return;
    for (const m of liste) m.addedNodes.forEach(eingefuegt);
  });
  wurzel.__bewegung.observe(wurzel, { childList: true, subtree: true });
}

/* -------------------------------------------------------------------------- */
/* Fenster, Aufklappfelder, Hinweise                                            */
/* -------------------------------------------------------------------------- */

const schmal = () => matchMedia('(max-width: 820px)').matches;

/** Fenster auf: Hintergrund blendet ein, das Fenster federt aus der Mitte (am Telefon von unten) herauf. */
export function fensterAuf(backdrop) {
  const fenster = backdrop.querySelector('.modal');
  if (!fenster || ruhig()) return;
  animieren(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  if (schmal()) {
    animieren(fenster, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 520, easing: FEDER_WEICH });
  } else {
    animieren(fenster, [{ opacity: 0, transform: 'translateY(18px) scale(.95)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: FEDER });
  }
}

/**
 * Fenster zu. Das echte Fenster ist schon aus dem DOM; was hier verschwindet,
 * ist ein Abbild ohne Kennungen und ohne Bedienbarkeit.
 */
export function fensterZu(backdrop) {
  if (ruhig() || !backdrop?.isConnected || backdrop.querySelector('iframe, object, embed')) return;
  const fenster = backdrop.querySelector('.modal');
  if (!fenster) return;
  const abbild = backdrop.cloneNode(true);
  abbild.className = 'modal-geist';
  abbild.setAttribute('aria-hidden', 'true');
  abbild.inert = true;
  // Weder Kennungen noch Datenattribute noch die Klasse „modal“ bleiben stehen:
  // Das Abbild soll von keiner Abfrage der Anwendung (oder eines Tests) als
  // offenes Fenster oder als Knopf gefunden werden. Das Stylesheet kennt
  // dafür .modal-abbild.
  abbild.querySelectorAll('*').forEach((n) => {
    n.removeAttribute('id'); n.removeAttribute('autofocus'); n.removeAttribute('for');
    for (const a of n.getAttributeNames()) if (a.startsWith('data-')) n.removeAttribute(a);
  });
  abbild.querySelector('.modal')?.classList.replace('modal', 'modal-abbild');
  // Eingaben im Abbild zeigen, was eingegeben war.
  const quelle = backdrop.querySelectorAll('input, textarea, select');
  abbild.querySelectorAll('input, textarea, select').forEach((n, i) => { if (quelle[i] && 'value' in n && n.type !== 'file') n.value = quelle[i].value; });
  document.body.append(abbild);
  const innen = abbild.querySelector('.modal-abbild');
  animieren(abbild, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
  const von = getComputedStyle(innen).transform;
  const a = animieren(innen, schmal()
    ? [{ transform: von && von !== 'none' ? von : 'none' }, { transform: 'translateY(100%)' }]
    : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.97)' }],
  { duration: 200, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
  const weg = () => abbild.remove();
  if (a) a.finished.then(weg, weg); else weg();
  setTimeout(weg, 400);
}

/**
 * Am Telefon lässt sich das Fenster am Kopf nach unten wegziehen, wie ein
 * Blatt. Weit oder schnell genug gezogen, schließt es (über `schliessen`,
 * also mit der Rückfrage bei ungesicherten Eingaben); sonst federt es zurück.
 */
export function blattZiehen(backdrop, schliessen) {
  const fenster = backdrop.querySelector('.modal');
  const kopf = fenster?.querySelector('.modal-head');
  if (!kopf) return;
  let y0 = null;
  let dy = 0;
  let t0 = 0;
  kopf.style.touchAction = 'none';
  kopf.addEventListener('pointerdown', (e) => {
    if (!schmal() || e.target.closest('button, a, input, select, textarea')) return;
    y0 = e.clientY; dy = 0; t0 = performance.now();
    kopf.setPointerCapture?.(e.pointerId);
  });
  kopf.addEventListener('pointermove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    fenster.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0.3, 1 - dy / (fenster.offsetHeight * 1.1)));
  });
  const ende = async () => {
    if (y0 === null) return;
    const schnell = dy / Math.max(1, performance.now() - t0) > 0.6 && dy > 30;
    const weit = dy > Math.min(160, fenster.offsetHeight * 0.3);
    const pos = dy;
    y0 = null; dy = 0;
    if (schnell || weit) await schliessen();
    if (backdrop.isConnected) {
      fenster.style.transform = '';
      backdrop.style.opacity = '';
      animieren(fenster, [{ transform: `translateY(${pos}px)` }, { transform: 'none' }], { duration: 480, easing: FEDER });
      animieren(backdrop, [{ opacity: Number(backdrop.style.opacity) || 0.6 }, { opacity: 1 }], { duration: 300 });
    }
  };
  kopf.addEventListener('pointerup', ende);
  kopf.addEventListener('pointercancel', ende);
}

/** Aufklappfeld: wächst aus der Ecke, an der der Knopf sitzt. */
export function popoverAuf(pop, anker, nachUnten) {
  if (ruhig()) return;
  const r = anker.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const x = Math.max(0, Math.min(p.width, r.left + r.width / 2 - p.left));
  const ursprung = `${Math.round(x)}px ${nachUnten ? '0' : '100%'}`;
  // Nur skalieren, nicht verschieben: Die Kante am Knopf bleibt dort, wo sie hingehört.
  animieren(pop, [
    { opacity: 0, transform: 'scale(.93)', transformOrigin: ursprung },
    { opacity: 1, transform: 'none', transformOrigin: ursprung },
  ], { duration: 340, easing: FEDER });
}

/** Hinweis gleitet von rechts (am Telefon von unten) herein. */
export function toastEin(node) {
  if (ruhig()) return;
  animieren(node, schmal()
    ? [{ opacity: 0, transform: 'translateY(24px) scale(.97)' }, { opacity: 1, transform: 'none' }]
    : [{ opacity: 0, transform: 'translateX(28px) scale(.96)' }, { opacity: 1, transform: 'none' }],
  { duration: 520, easing: FEDER });
}

/** Hinweis geht: kurz zusammenrücken, dann ist er weg; die Nachbarn rutschen weich nach. */
export function toastAus(node, fertig) {
  const weg = () => { node.remove(); fertig?.(); };
  if (ruhig() || typeof node.animate !== 'function') { weg(); return; }
  const h = node.offsetHeight;
  node.style.pointerEvents = 'none';
  const a = node.animate([
    { opacity: 1, transform: 'none', maxHeight: `${h}px`, marginBottom: '0px' },
    { opacity: 0, transform: schmal() ? 'translateY(16px) scale(.97)' : 'translateX(24px) scale(.97)', maxHeight: `${h}px`, marginBottom: '0px', offset: 0.55 },
    { opacity: 0, transform: schmal() ? 'translateY(16px) scale(.97)' : 'translateX(24px) scale(.97)', maxHeight: '0px', marginBottom: `-8px` },
  ], { duration: 360, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
  a.finished.then(weg, weg);
}

/** Wackeln für „Passwort falsch“ und ähnliche Fehlversuche. */
export function schuetteln(el) {
  animieren(el, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' },
    { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' },
  ], { duration: 420, easing: 'ease-in-out', fill: 'none' });
}

/* -------------------------------------------------------------------------- */
/* Marke, die zum gewählten Eintrag gleitet                                     */
/* -------------------------------------------------------------------------- */

/**
 * Setzt in `box` eine Marke hinter (oder unter) den aktiven Eintrag und lässt
 * sie zu jedem neuen aktiven Eintrag gleiten. Die Box muss `position` haben.
 * Die Stellung steht in CSS-Variablen (--mx, --my, --mw, --mh); wie die Marke
 * aussieht, steht im Stylesheet.
 *
 * @param {HTMLElement} box
 * @param {{aktiv:string, achse?:'x'|'y', breite?:number}} o  aktiv = Auswahl des aktiven Eintrags
 */
export function markierung(box, { aktiv, achse = 'y', breite = 0 }) {
  if (!box || box.__marke) return box?.__marke;
  const marke = document.createElement('span');
  marke.className = 'marke ohne-weg';
  marke.setAttribute('aria-hidden', 'true');
  box.prepend(marke);
  box.classList.add('hat-marke');
  let erst = true;
  const setzen = () => {
    const el = box.querySelector(aktiv);
    if (!el || !el.offsetParent) { marke.style.opacity = '0'; return; }
    const w = breite || el.offsetWidth;
    const x = achse === 'x' ? el.offsetLeft + (el.offsetWidth - w) / 2 : el.offsetLeft;
    const st = marke.style;
    st.setProperty('--mx', `${Math.round(x)}px`);
    st.setProperty('--my', `${el.offsetTop}px`);
    st.setProperty('--mw', `${w}px`);
    st.setProperty('--mh', `${el.offsetHeight}px`);
    st.opacity = '1';
    if (erst) {
      // Erste Stellung ohne Weg: die Marke soll nicht von links oben anfliegen.
      void marke.offsetWidth;
      marke.classList.remove('ohne-weg');
      erst = false;
    }
  };
  const nachlauf = () => requestAnimationFrame(setzen);
  new MutationObserver(nachlauf).observe(box, { subtree: true, attributes: true, attributeFilter: ['class'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(nachlauf).observe(box);
  document.fonts?.ready?.then(setzen);
  setzen();
  box.__marke = marke;
  return marke;
}

/* -------------------------------------------------------------------------- */
/* Hell/Dunkel mit Kreisüberblendung                                            */
/* -------------------------------------------------------------------------- */

/**
 * Wechselt das Erscheinungsbild als Kreis, der vom Knopf aus über die Seite
 * wächst (View Transitions). Wo das nicht geht, schaltet es einfach um.
 */
export function themaWechsel(umschalten, ausgang) {
  if (ruhig() || typeof document.startViewTransition !== 'function') { umschalten(); return; }
  const r = ausgang?.getBoundingClientRect?.();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  let vt;
  try { vt = document.startViewTransition(umschalten); } catch { umschalten(); return; }
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 700, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  }).catch(() => {});
}
