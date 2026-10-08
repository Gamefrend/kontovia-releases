/**
 * Kontovia Abo-Seite: Tarife und Vergleich anzeigen, Lizenz anfragen, Programm installieren, Bewegung.
 *
 * Die Seite ist reines Schaufenster und gehört nicht zur App: sie liest nur
 * abo/config.json (Tarife, Preise, Vergleichstabelle, Anbindungen) und kennt keine Buchhaltungsdaten.
 * Ein Tarif mit preisMonat 0 braucht keine Anmeldung, sein Knopf öffnet die App. Für die übrigen
 * entscheidet die Konfiguration, was beim Absenden passiert:
 *   1. anmeldeEndpunkt gesetzt: die Angaben gehen per POST dorthin (die Seiten-CSP
 *      erlaubt genau diesen Host, gebaut aus der Konfiguration).
 *   2. nur kasse gesetzt: Weiterleitung zur Bezahlseite des Anbieters, ohne dass
 *      persönliche Angaben in der Adresse stehen.
 *   3. beides leer: Vorbestellung, der Besucher bekommt eine vorbereitete
 *      E-Mail an den Betreiber. Es wird nichts an Dritte gesendet.
 *   4. dazu nur eine Platzhalter-Adresse in betreiber.json (example.org, heute): Testbetrieb,
 *      die Seite nimmt keine Anmeldung an und verweist auf den kostenlosen Tarif.
 * Texte werden nie als HTML eingesetzt, nur als Text.
 *
 * Bewegung: Einblenden beim Scrollen, Zahlen zählen hoch, die App-Vorschau richtet sich beim Scrollen auf,
 * die Funktionskarten spielen ihren Ablauf einmal ab (Assistent und Verschlüsselung laufen, solange sichtbar).
 * Bei „Bewegung reduzieren“ steht alles still und zeigt gleich den Endzustand.
 * Kein import/export und kein await auf oberster Ebene: die Prüfung „quelltext“ liest die Datei als CommonJS.
 */

const $ = (id) => document.getElementById(id);
const eur = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
const zahlDe = (stellen) => (n) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(n);

const zustand = { cfg: null, zyklus: 'monat', tarif: '' };

function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text != null) e.textContent = text;
  return e;
}

/** Symbol aus dem Satz im HTML (<symbol id="i-…">). */
function icon(name, klasse = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', `i ${klasse}`.trim());
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}

function tarif(id) { return zustand.cfg.tarife.find((t) => t.id === id); }
const istFrei = (t) => !t.preisMonat;
const bezahlte = () => zustand.cfg.tarife.filter((t) => !istFrei(t));

/** Monatspreis im gewählten Zyklus; beim Jahrestarif zählen die Gratismonate heraus. */
function preisProMonat(t) {
  const gratis = zustand.cfg.jahresMonateGratis || 0;
  return zustand.zyklus === 'jahr' ? (t.preisMonat * (12 - gratis)) / 12 : t.preisMonat;
}
const preisProJahr = (t) => t.preisMonat * (12 - (zustand.cfg.jahresMonateGratis || 0));
const ersparnis = (t) => t.preisMonat * 12 - preisProJahr(t);

function kasseLink(id) { return zustand.cfg.kasse?.[id]?.[zustand.zyklus] || ''; }
const hatAnbindung = () => Boolean(zustand.cfg.anmeldeEndpunkt) || bezahlte().some((t) => kasseLink(t.id));
/** Ohne Anbindung und ohne echte Betreiber-Adresse (Platzhalter in betreiber.json) nimmt die Seite keine Anmeldungen an. */
const anmeldungOffen = () => hatAnbindung() || /^[^\s@]+@(?!example\.(?:org|com|net)$)[^\s@]+\.[^\s@]{2,}$/i.test(zustand.cfg.kontakt || '');

/* ---------- Bewegung ---------- */

const ruhig = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sanft = (x) => 1 - Math.pow(1 - x, 4);
const warten = (ms) => new Promise((r) => setTimeout(r, ms));

/** Zahl in einem Textknoten von `von` nach `nach` laufen lassen; `form` setzt den Text. */
function zaehlen(knoten, von, nach, form, dauer = 900) {
  if (ruhig || von === nach) { knoten.textContent = form(nach); return; }
  const t0 = performance.now();
  const schritt = (jetzt) => {
    const x = Math.min(1, (jetzt - t0) / dauer);
    knoten.textContent = form(von + (nach - von) * sanft(x));
    if (x < 1) requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
}

/** Zähler im Bereich: data-cent (Betrag in Cent, data-stellen Nachkommastellen) oder data-zahl. */
function zaehler(wurzel) {
  return [...wurzel.querySelectorAll('[data-cent], [data-zahl]')].map((n) => n.dataset.cent != null
    ? { n, wert: Number(n.dataset.cent) / 100, form: zahlDe(Number(n.dataset.stellen ?? 2)) }
    : { n, wert: Number(n.dataset.zahl), form: zahlDe(0) });
}
function aufNull(wurzel) { if (!ruhig) zaehler(wurzel).forEach(({ n, form }) => { n.textContent = form(0); }); }
function hochzaehlen(wurzel, dauer = 1400) { zaehler(wurzel).forEach(({ n, wert, form }) => zaehlen(n, 0, wert, form, dauer)); }

/** Kopf: Linie beim Scrollen; die Marke im Menü folgt dem Bereich, der gerade zu sehen ist. */
function kopfBeobachten() {
  const kopf = $('kopf');
  const linie = () => kopf.classList.toggle('gescrollt', scrollY > 8);
  addEventListener('scroll', linie, { passive: true });
  linie();

  const menue = $('menue');
  const links = [...menue.querySelectorAll('a')];
  let aktiv = null;
  const setzen = () => {
    links.forEach((l) => l.classList.toggle('aktiv', l === aktiv));
    menue.classList.toggle('hat-aktiv', Boolean(aktiv));
    if (!aktiv) return;
    menue.style.setProperty('--x', `${aktiv.offsetLeft}px`);
    menue.style.setProperty('--w', `${aktiv.offsetWidth}px`);
  };
  if (!('IntersectionObserver' in window)) return;
  const im = new Map();
  const io = new IntersectionObserver((eintraege) => {
    for (const e of eintraege) im.set(e.target.id, e.isIntersecting);
    aktiv = links.find((l) => im.get(l.hash.slice(1))) || null;
    setzen();
  }, { rootMargin: '-40% 0px -55% 0px' });
  links.forEach((l) => { const s = document.getElementById(l.hash.slice(1)); if (s) io.observe(s); });
  addEventListener('resize', setzen);
  document.fonts?.ready.then(setzen);
}

/** Funktionskarten mit eigenem Ablauf; die übrigen zählen nur ihre Zahlen hoch. */
const DEMOS = {
  rechnung: (k) => setTimeout(() => hochzaehlen(k, 1200), 700),
};
function demoStarten(z) {
  const art = z.dataset.demo;
  if (DEMOS[art]) DEMOS[art](z);
  else hochzaehlen(z);
}

/** Bereiche blenden beim Scrollen ein und starten dabei ihre Animation. */
function einblenden() {
  const ziele = document.querySelectorAll('.reveal');
  if (ruhig || !('IntersectionObserver' in window)) {
    ziele.forEach((z) => { z.classList.add('sichtbar'); demoStarten(z); });
    return;
  }
  ziele.forEach(aufNull);
  const io = new IntersectionObserver((eintraege) => {
    for (const e of eintraege) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('sichtbar');
      io.unobserve(e.target);
      demoStarten(e.target);
    }
  }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  ziele.forEach((z) => io.observe(z));
}

/** App-Vorschau oben: liegt erst schräg und richtet sich beim Scrollen auf; Säulen wachsen, Zahlen zählen. */
function vorschauStarten() {
  const r = $('vorschau');
  if (ruhig) { r.classList.add('vorschau-an'); return; }
  aufNull(r);
  // Erst wenn die Bühne eingeblendet ist (.a5 im CSS, 0,8 s).
  setTimeout(() => { r.classList.add('vorschau-an'); hochzaehlen(r, 1600); }, 900);
  let geplant = false;
  const kippen = () => {
    geplant = false;
    const oben = r.getBoundingClientRect().top;
    const p = Math.min(1, Math.max(0, (oben - innerHeight * 0.12) / (innerHeight * 0.55)));
    r.style.setProperty('--kipp', p.toFixed(3));
  };
  addEventListener('scroll', () => { if (!geplant) { geplant = true; requestAnimationFrame(kippen); } }, { passive: true });
  addEventListener('resize', kippen);
  kippen();
}

/** Lichtschein unter dem Zeiger auf Karten (nur mit Maus). */
function glanzVerfolgen() {
  if (ruhig || !matchMedia('(hover: hover)').matches) return;
  document.addEventListener('pointermove', (e) => {
    const k = e.target instanceof Element ? e.target.closest('.glanz') : null;
    if (!k) return;
    const r = k.getBoundingClientRect();
    k.style.setProperty('--mx', `${e.clientX - r.left}px`);
    k.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

/** Laufband der Formate: die Liste doppelt, damit es nahtlos weiterläuft. */
function laufband() {
  const spur = $('bandSpur');
  if (ruhig || !spur) return;
  const kopie = spur.querySelector('.band-liste').cloneNode(true);
  kopie.setAttribute('aria-hidden', 'true');
  spur.append(kopie);
  spur.classList.add('laeuft');
}

/** Kleiner Monat im Kalender-Beispiel (November 2026) mit Steuertermin, Fälligkeit und Termin. */
function kalenderBauen() {
  const raster = $('kalRaster');
  const besonders = { 10: 'steuer', 16: 'faellig', 24: 'termin' };
  const leer = (new Date(2026, 10, 1).getDay() + 6) % 7;
  const felder = [];
  for (let i = 0; i < leer; i++) felder.push(el('span'));
  for (let t = 1; t <= 30; t++) felder.push(el('span', besonders[t] || '', String(t)));
  felder.forEach((f, i) => f.style.setProperty('--i', String(i)));
  raster.replaceChildren(...felder);
}

/** Assistent: Frage tippen, kurz nachdenken, Antwort tippen; läuft, solange die Karte zu sehen ist. */
function assistentSpielen(karte) {
  if (!karte || ruhig || !('IntersectionObserver' in window)) return;
  const [frage, antwort] = karte.querySelectorAll('[data-tippen]');
  const blase = antwort.parentElement;
  const denkt = karte.querySelector('.denkt');
  let lauf = 0;
  let sichtbar = false;

  async function tippen(knoten, text, tempo, nr) {
    knoten.classList.add('tippt');
    for (let i = 1; i <= text.length; i++) {
      if (nr !== lauf) return false;
      knoten.textContent = text.slice(0, i);
      await warten(tempo + Math.random() * tempo);
    }
    knoten.classList.remove('tippt');
    return nr === lauf;
  }
  async function runde(nr) {
    while (nr === lauf) {
      frage.textContent = '';
      antwort.textContent = '';
      blase.classList.add('leer');
      await warten(600);
      if (!await tippen(frage, frage.dataset.tippen, 26, nr)) return;
      await warten(300);
      if (nr !== lauf) return;
      blase.classList.remove('leer');
      denkt.classList.add('an');
      await warten(1300);
      denkt.classList.remove('an');
      if (!await tippen(antwort, antwort.dataset.tippen, 13, nr)) return;
      await warten(4500);
    }
  }
  function ganz() {
    for (const k of [frage, antwort]) { k.textContent = k.dataset.tippen; k.classList.remove('tippt'); }
    denkt.classList.remove('an');
    blase.classList.remove('leer');
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting === sichtbar) return;
    sichtbar = e.isIntersecting;
    lauf++;
    if (sichtbar) runde(lauf); else ganz();
  }, { threshold: 0.35 }).observe(karte);
}

/** Verschlüsselung: rechts steht dieselbe Rechnung als Zeichensalat, der ständig flimmert. */
function tresorSpielen(karte) {
  if (!karte) return;
  const klar = [...$('tresorKlar').children].map((li) => li.textContent);
  const salat = [...$('tresorSalat').children];
  const zeichen = '0123456789abcdef';
  const zufall = () => zeichen[(Math.random() * 16) | 0];
  salat.forEach((li, i) => {
    li.textContent = Array.from({ length: klar[i].length + 2 }, (_, k) => (k % 5 === 4 ? '·' : zufall())).join('');
  });
  if (ruhig || !('IntersectionObserver' in window)) return;
  let uhr = null;
  const tick = () => salat.forEach((li) => {
    const t = [...li.textContent];
    for (let k = 0; k < 3; k++) {
      const p = (Math.random() * t.length) | 0;
      if (t[p] !== '·') t[p] = zufall();
    }
    li.textContent = t.join('');
  });
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !uhr) uhr = setInterval(tick, 80);
    else if (!e.isIntersecting && uhr) { clearInterval(uhr); uhr = null; }
  }).observe(karte);
}

/* ---------- Tarife ---------- */

const karten = new Map();
const gezeigt = new Map();

function tarifeZeichnen() {
  const wurzel = $('tarife');
  wurzel.replaceChildren();
  karten.clear();
  for (const t of zustand.cfg.tarife) {
    const k = el('article', `tarif glanz${t.empfohlen ? ' empfohlen' : ''}`);
    if (t.empfohlen) {
      const p = el('span', 'plakette');
      p.append(icon('funke'), 'Beliebt');
      k.append(p);
    }
    k.append(el('h3', '', t.name), el('p', 'fuer', t.fuer));

    const preis = el('div', 'preis');
    const statt = el('s');
    statt.append(el('span', 'sr', 'bisher '), eur(t.preisMonat));
    const betrag = el('b');
    preis.append(statt, betrag, el('span', '', istFrei(t) ? 'für immer' : 'im Monat'));
    const unter = el('p', 'preis-unter');
    k.append(preis, unter);

    const a = el('a', `knopf ${t.empfohlen ? 'akzent' : istFrei(t) ? '' : 'zweit'}`.trim(), istFrei(t) ? 'Kostenlos starten' : `${t.name} wählen`);
    if (istFrei(t)) a.href = '../';
    else {
      a.href = '#anmelden';
      a.addEventListener('click', () => tarifWaehlen(t.id));
    }
    k.append(a);

    if (t.basis) k.append(el('p', 'basis', t.basis));
    const liste = el('ul');
    for (const p of t.punkte) {
      const li = el('li');
      li.append(icon('haken'), el('span', '', p));
      liste.append(li);
    }
    k.append(liste);
    wurzel.append(k);
    karten.set(t.id, { statt, betrag, unter });
  }
}

/** Preise im gewählten Zyklus; beim Wechsel läuft jeder Betrag von der alten zur neuen Zahl. */
function preiseSetzen() {
  for (const t of zustand.cfg.tarife) {
    const { statt, betrag, unter } = karten.get(t.id);
    const neu = preisProMonat(t);
    const alt = gezeigt.get(t.id);
    zaehlen(betrag, alt ?? neu, neu, (n) => eur(Math.round(n * 100) / 100), 600);
    gezeigt.set(t.id, neu);
    statt.hidden = istFrei(t) || neu === t.preisMonat;
    unter.replaceChildren();
    if (istFrei(t)) unter.textContent = 'Ohne Anmeldung, ohne Zahlungsdaten';
    else if (zustand.zyklus === 'jahr') unter.append(`${eur(preisProJahr(t))} im Jahr · `, el('strong', '', `Sie sparen ${eur(ersparnis(t))}`));
    else unter.textContent = `Monatlich kündbar · ${zustand.cfg.testTage} Tage gratis`;
  }
}

/** Tabelle „Alle Funktionen vergleichen“ aus config.json (vergleich). */
function vergleichZeichnen() {
  const cfg = zustand.cfg;
  if (!cfg.vergleich?.length) { $('vergleichKnopf').parentElement.hidden = true; return; }
  const tab = el('table', 'vtab');
  tab.append(el('caption', 'sr', 'Alle Funktionen der Tarife im Vergleich'));
  const kopf = el('thead');
  const zeile = el('tr');
  const ecke = el('th');
  ecke.scope = 'col';
  ecke.append(el('span', 'sr', 'Funktion'));
  zeile.append(ecke);
  for (const t of cfg.tarife) {
    const th = el('th', t.empfohlen ? 'hervor' : '');
    th.scope = 'col';
    th.append(t.name, el('small', '', istFrei(t) ? '0 €' : `${eur(t.preisMonat)} im Monat`));
    zeile.append(th);
  }
  kopf.append(zeile);
  tab.append(kopf);
  for (const g of cfg.vergleich) {
    const rumpf = el('tbody');
    const gz = el('tr', 'gruppe');
    const gth = el('th', '', g.gruppe);
    gth.scope = 'rowgroup';
    gth.colSpan = cfg.tarife.length + 1;
    gz.append(gth);
    rumpf.append(gz);
    for (const z of g.zeilen) {
      const tr = el('tr');
      const th = el('th', '', z.name);
      th.scope = 'row';
      tr.append(th);
      for (const t of cfg.tarife) {
        const w = z.werte?.[t.id];
        const td = el('td', t.empfohlen ? 'hervor' : '');
        if (w === true) td.append(icon('haken', 'ja'), el('span', 'sr', 'enthalten'));
        else if (!w) td.append(el('span', 'nein'), el('span', 'sr', 'nicht enthalten'));
        else td.textContent = String(w);
        tr.append(td);
      }
      rumpf.append(tr);
    }
    tab.append(rumpf);
  }
  $('vergleich').replaceChildren(tab);
}

function vergleichUmschalten() {
  const knopf = $('vergleichKnopf'), text = $('vergleichText'), huelle = $('vergleichHuelle'), innen = $('vergleichInnen');
  knopf.addEventListener('click', () => {
    const auf = knopf.getAttribute('aria-expanded') !== 'true';
    knopf.setAttribute('aria-expanded', String(auf));
    text.textContent = auf ? 'Vergleich schließen' : 'Alle Funktionen vergleichen';
    innen.inert = !auf;
    huelle.classList.remove('ganz');
    huelle.classList.toggle('offen', auf);
    if (ruhig && auf) huelle.classList.add('ganz');
    if (!auf && knopf.getBoundingClientRect().top < 0) knopf.scrollIntoView({ block: 'center', behavior: ruhig ? 'auto' : 'smooth' });
  });
  // Erst ganz offen darf der Inhalt überstehen: dann klebt der Tabellenkopf beim Scrollen oben.
  huelle.addEventListener('transitionend', (e) => {
    if (e.target === huelle && e.propertyName === 'grid-template-rows' && huelle.classList.contains('offen')) huelle.classList.add('ganz');
  });
}

function umschalterMarke() {
  const u = $('umschalter');
  const b = u.querySelector('button.aktiv');
  if (!b || !b.offsetWidth) return;
  u.style.setProperty('--x', `${b.offsetLeft}px`);
  u.style.setProperty('--w', `${b.offsetWidth}px`);
}

function tarifAuswahlZeichnen() {
  const wurzel = $('tarifWahl');
  wurzel.replaceChildren();
  for (const t of bezahlte()) {
    const l = el('label');
    const i = el('input');
    i.type = 'radio'; i.name = 'tarif'; i.value = t.id; i.checked = t.id === zustand.tarif;
    i.addEventListener('change', () => tarifWaehlen(t.id));
    const s = el('span');
    s.append(el('b', '', t.name), el('small', '', ''));
    l.append(i, s);
    wurzel.append(l);
  }
}

/** Preise in der Tarifauswahl des Formulars; ohne neu zu zeichnen, damit der Fokus bleibt. */
function auswahlPreiseSetzen() {
  for (const i of $('tarifWahl').querySelectorAll('input')) {
    i.checked = i.value === zustand.tarif;
    i.nextElementSibling.querySelector('small').textContent = `${eur(preisProMonat(tarif(i.value)))} im Monat`;
  }
}

function tarifWaehlen(id) {
  zustand.tarif = id;
  auswahlPreiseSetzen();
  knopfTextSetzen();
}

function zyklusWaehlen(z) {
  zustand.zyklus = z;
  document.querySelectorAll('[data-zyklus]').forEach((b) => {
    const an = b.dataset.zyklus === z;
    b.classList.toggle('aktiv', an);
    b.setAttribute('aria-pressed', String(an));
  });
  umschalterMarke();
  preiseSetzen();
  auswahlPreiseSetzen();
  knopfTextSetzen();
}

function knopfTextSetzen() {
  const t = tarif(zustand.tarif);
  if (!t) return;
  const test = zustand.cfg.testTage;
  $('sendenKnopf').textContent = hatAnbindung() ? `${t.name} ${test} Tage testen` : `${t.name} vormerken`;
  $('formHinweis').textContent = hatAnbindung()
    ? `${t.name}, ${eur(preisProMonat(t))} im Monat${zustand.zyklus === 'jahr' ? ' bei jährlicher Zahlung' : ''}. Die ersten ${test} Tage sind kostenlos.`
    : anmeldungOffen()
      ? 'Die Anmeldung ist noch nicht freigeschaltet. Sie schicken uns eine E-Mail, wir melden uns, sobald es losgeht.'
      : 'Im Testbetrieb nehmen wir noch keine Anmeldungen an. Kostenlos können Sie Kontovia schon jetzt ausprobieren.';
}

/* ---------- Formular ---------- */

function fehlerZeigen(feldId, text) {
  const f = $(feldId), m = $(feldId + 'Fehler');
  if (text) { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', m.id); }
  else { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); }
  m.hidden = !text;
  m.textContent = text || '';
}

function pruefen() {
  const name = $('fName').value.trim();
  const mail = $('fMail').value.trim();
  const fehler = {};
  if (name.length < 2) fehler.fName = 'Bitte tragen Sie Ihren Namen ein.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) fehler.fMail = 'Bitte prüfen Sie die E-Mail-Adresse.';
  if (!$('fZustimmung').checked) fehler.fZustimmung = 'Bitte bestätigen Sie die Nutzungsbedingungen und die Datenschutzhinweise.';
  for (const id of ['fName', 'fMail', 'fZustimmung']) fehlerZeigen(id, fehler[id]);
  const erster = Object.keys(fehler)[0];
  if (erster) $(erster).focus();
  return erster ? null : { name, email: mail, firma: $('fFirma').value.trim() };
}

function meldung(art, text, link) {
  const m = $('formMeldung');
  m.className = 'meldung ' + art;
  m.replaceChildren(document.createTextNode(text));
  if (link) {
    const a = el('a', '', link.text);
    a.href = link.href;
    m.append(' ', a);
  }
  m.hidden = false;
  m.scrollIntoView({ block: 'nearest', behavior: ruhig ? 'auto' : 'smooth' });
}

async function absenden(e) {
  e.preventDefault();
  if (!anmeldungOffen()) {
    meldung('info', 'Im Testbetrieb nehmen wir noch keine Anmeldungen an, Ihre Angaben wurden nicht gesendet. Kontovia können Sie schon jetzt kostenlos ausprobieren.',
      { text: 'Kontovia öffnen', href: '../' });
    return;
  }
  const daten = pruefen();
  if (!daten) return;
  const t = tarif(zustand.tarif);
  const knopf = $('sendenKnopf');

  if (zustand.cfg.anmeldeEndpunkt) {
    knopf.disabled = true;
    try {
      const r = await fetch(zustand.cfg.anmeldeEndpunkt, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...daten, tarif: t.id, zyklus: zustand.zyklus, zustimmung: true }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const kasse = kasseLink(t.id);
      meldung('gut', 'Vielen Dank! Wir haben Ihnen eine E-Mail geschickt. Schauen Sie bitte auch im Spam-Ordner nach.',
        kasse ? { text: 'Weiter zur Zahlung', href: kasse } : null);
      $('anmeldeForm').reset();
      tarifWaehlen(t.id);
    } catch {
      meldung('fehl', 'Das hat leider nicht geklappt. Bitte versuchen Sie es gleich noch einmal oder schreiben Sie uns eine E-Mail.');
    } finally {
      knopf.disabled = false;
    }
    return;
  }

  const kasse = kasseLink(t.id);
  if (kasse) { location.href = kasse; return; }

  // Vorbestellung: die E-Mail wird im Mailprogramm des Besuchers vorbereitet und von ihm selbst abgeschickt.
  const betreff = `Kontovia ${t.name}: Anmeldung`;
  const text = [
    'Guten Tag,', '',
    `ich möchte Kontovia ${t.name} (${zustand.zyklus === 'jahr' ? 'jährlich' : 'monatlich'}) ausprobieren.`, '',
    `Name: ${daten.name}`, `E-Mail: ${daten.email}`, daten.firma ? `Firma: ${daten.firma}` : '', '',
    'Ich habe die Nutzungsbedingungen und die Datenschutzhinweise gelesen.',
  ].filter((z, i, a) => z !== '' || a[i - 1] !== '').join('\n');
  const ziel = zustand.cfg.kontakt;
  if (ziel) location.href = `mailto:${ziel}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
  meldung('gut', 'Ihr Mailprogramm sollte sich jetzt mit einer vorbereiteten Nachricht öffnen. Schicken Sie sie ab, dann sind Sie vorgemerkt. Bis es losgeht, können Sie Kontovia schon kostenlos nutzen.',
    { text: 'Kontovia öffnen', href: '../' });
}

/* ---------- Installieren ---------- */

let installAngebot = null;

function geraetErkennen() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function installierenVorbereiten() {
  const art = geraetErkennen();
  document.querySelector(`.geraet[data-plattform="${art}"]`)?.classList.add('passt');

  const knopf = $('installKnopf'), hinweis = $('installHinweis');
  const schonApp = matchMedia('(display-mode: standalone)').matches;
  if (schonApp) { knopf.hidden = true; hinweis.hidden = false; hinweis.textContent = 'Kontovia läuft hier bereits als App.'; }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installAngebot = e; });
  window.addEventListener('appinstalled', () => {
    installAngebot = null; knopf.hidden = true;
    hinweis.hidden = false; hinweis.textContent = 'Fertig! Kontovia ist jetzt installiert.';
  });
  knopf.addEventListener('click', async () => {
    if (installAngebot) {
      installAngebot.prompt();
      await installAngebot.userChoice.catch(() => {});
      installAngebot = null;
      return;
    }
    hinweis.hidden = false;
    hinweis.textContent = art === 'desktop'
      ? 'Öffnen Sie Kontovia in Chrome oder Edge. In der Adressleiste erscheint dann ein Symbol zum Installieren, oder wählen Sie im Browsermenü „App installieren“.'
      : 'Öffnen Sie Kontovia und wählen Sie im Browsermenü „App installieren“.';
    const a = el('a', '', ' Kontovia öffnen');
    a.href = '../';
    hinweis.append(a);
  });
}

/* ---------- Start ---------- */

async function start() {
  kopfBeobachten();
  kalenderBauen();
  einblenden();
  vorschauStarten();
  glanzVerfolgen();
  laufband();
  assistentSpielen(document.querySelector('[data-demo="assistent"]'));
  tresorSpielen(document.querySelector('[data-demo="tresor"]'));
  installierenVorbereiten();
  vergleichUmschalten();

  let cfg;
  try {
    const r = await fetch('config.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    cfg = await r.json();
  } catch {
    $('tarife').replaceChildren(el('p', 'fein mitte', 'Die Preise konnten gerade nicht geladen werden. Bitte laden Sie die Seite neu.'));
    return;
  }
  zustand.cfg = cfg;
  const bezahlt = bezahlte();
  zustand.tarif = (bezahlt.find((t) => t.empfohlen) || bezahlt[0])?.id || '';

  $('testTage').textContent = String(cfg.testTage);
  if (cfg.jahresMonateGratis) $('jahrRabatt').textContent = `${cfg.jahresMonateGratis} Monate gratis`;
  else document.querySelector('[data-zyklus="jahr"]').hidden = true;
  $('preisHinweis').textContent = cfg.preisHinweis || '';

  tarifeZeichnen();
  vergleichZeichnen();
  if (zustand.tarif) {
    tarifAuswahlZeichnen();
    $('anmeldeForm').addEventListener('submit', absenden);
    ['fName', 'fMail', 'fZustimmung'].forEach((id) => $(id).addEventListener('input', () => fehlerZeigen(id, '')));
  }
  document.querySelectorAll('[data-zyklus]').forEach((b) => b.addEventListener('click', () => zyklusWaehlen(b.dataset.zyklus)));
  zyklusWaehlen('monat');
  addEventListener('resize', umschalterMarke);
  document.fonts?.ready.then(umschalterMarke);
}

start();
