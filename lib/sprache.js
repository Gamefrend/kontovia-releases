/**
 * Kontovia – zweite Sprache (Englisch).
 *
 * Der Quelltext bleibt deutsch. Ist Englisch gewählt, lädt dieses Modul das
 * Wörterbuch (sprache/en.js, nur dann) und übersetzt alles, was in der
 * Oberfläche ankommt: Textknoten, übersetzbare Attribute (title, placeholder,
 * aria-label …) und den Seitentitel. Ein MutationObserver erfasst neue und
 * geänderte Knoten, bevor der Browser sie zeichnet.
 *
 * Einheit ist der Text eines Elements. Eingebettete Elemente und eingesetzte
 * Werte stehen im Wörterbuch als {0}, {1} … („Du hast {0} Buchungen“ →
 * „You have {0} transactions“); eingesetzte Werte werden ihrerseits
 * übersetzt, eingebettete Elemente wandern an die Stelle, die die
 * Übersetzung vorsieht. scripts/sprache.js liest dieselben Einheiten aus dem
 * Quelltext, die Prüfung `quelltext` verlangt für jede eine Übersetzung.
 *
 * Nie übersetzt: Eingabefelder, bearbeitbarer Text, Elemente mit
 * translate="no" (Namen, Rechtstexte, eigene Texte der Nutzer). Die Wahl gilt
 * je Gerät (localStorage), denn vor dem Entsperren gibt es keinen Tresor.
 * Formate (Zahlen, Datum) folgen der Sprache: util.js fragt sprache().
 */

const KEY = 'kontovia.sprache';

export const SPRACHEN = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
];

function gespeichert() {
  try { return globalThis.localStorage?.getItem(KEY) || ''; } catch { return ''; }
}

/* Aus der Adresse (?lang=en, etwa von der englischen Abo-Seite) gilt sie als Wahl. */
function ausAdresse() {
  try {
    const p = new URLSearchParams(globalThis.location?.search || '');
    const l = p.get('lang');
    return l === 'en' || l === 'de' ? l : '';
  } catch { return ''; }
}

/** Voreinstellung ohne Wahl: Deutsch, außer der Browser spricht kein Deutsch. */
export function browserSprache() {
  const liste = globalThis.navigator?.languages || [globalThis.navigator?.language || 'de'];
  return liste.some((l) => /^de\b/i.test(String(l))) || !liste.length ? 'de' : 'en';
}

let aktuell = (() => {
  const a = ausAdresse();
  if (a) { try { globalThis.localStorage?.setItem(KEY, a); } catch { /* egal */ } return a; }
  const g = gespeichert();
  if (g === 'de' || g === 'en') return g;
  return globalThis.document ? browserSprache() : 'de';
})();

/** Aktuelle Sprache der Oberfläche: 'de' oder 'en'. */
export function sprache() { return ueberschrieben || aktuell; }
export const istEnglisch = () => sprache() === 'en';

/*
 * Dokumente (Rechnung, Mahnung, E-Mail) haben eine eigene Sprache, unabhängig von der Oberfläche.
 * inSprache führt einen **synchronen** Aufbau in dieser Sprache aus: Zahlen, Datum, Monatsnamen
 * (util.js) und t() folgen ihr nur solange fn läuft. Das Wörterbuch muss vorher da sein (woerterbuchBereit).
 */
let ueberschrieben = '';
const formatHaken = new Set();
/** util.js meldet sich an: Monatsnamen und Tastenbezeichnung neu füllen, wenn die wirksame Sprache wechselt. */
export function beiFormatwechsel(fn) { formatHaken.add(fn); }
export function inSprache(code, fn) {
  if ((code !== 'de' && code !== 'en') || code === sprache()) return fn();
  const alt = ueberschrieben;
  ueberschrieben = code;
  for (const h of formatHaken) h();
  try { return fn(); } finally {
    ueberschrieben = alt;
    for (const h of formatHaken) h();
  }
}

/** Ob jemand die Sprache schon bewusst gewählt hat (sonst gilt die Voreinstellung). */
export function spracheGewaehlt() {
  const g = gespeichert();
  return g === 'de' || g === 'en';
}

/** Merkt die Sprache, ohne umzuschalten (z. B. „bestehendes Konto bleibt deutsch“). */
export function spracheMerken(code) {
  try { globalThis.localStorage?.setItem(KEY, code); } catch { /* privater Modus */ }
}

/* -------------------------------------------------------------------------- */
/* Wörterbuch                                                                  */
/* -------------------------------------------------------------------------- */

const BUCHSTABE = /[A-Za-zÄÖÜäöüß]/;
const KURZ = 6;                  // so viele feste Zeichen braucht ein Muster mit freien Werten
const MARKE = '\uE000';          // eingebettetes Element im Text einer Einheit
const MARKE_RE = /\uE000(\d+)\uE001/g;

let genau = null;                // Map deutsch → englisch (ohne Platzhalter)
let muster = null;               // Map Ankerwort → [{re, frei, en, fest}]
let teile = null;                // Map Ankerwort → [deutsch] (Einträge ohne Platzhalter, für Teiltreffer)
const cache = new Map();

function regexText(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const WORT = /[A-Za-zÄÖÜäöüß]{2,}/g;
function anker(s) {
  const woerter = s.replace(/\{\d+\}/g, ' ').match(WORT) || [];
  return woerter.length ? woerter.reduce((a, b) => (b.length > a.length ? b : a)) : '';
}
function merken(map, k, v) {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
}

/** Wörterbuch einlesen (Objekt deutsch → englisch). Auch für Prüfungen unter Node. */
export function woerterbuchSetzen(wb) {
  genau = new Map();
  muster = new Map();
  teile = new Map();
  cache.clear();
  for (const [de, en] of Object.entries(wb || {})) {
    if (typeof en !== 'string') continue;
    const a = anker(de);
    if (!/\{\d+\}/.test(de)) {
      genau.set(de, en);
      if (a) merken(teile, a, de);
      continue;
    }
    if (!a) continue;
    const stuecke = de.split(/\{(\d+)\}/);
    let re = '';
    let reT = ''; // wie re, aber Platzhalter am Rand sind ein einzelnes Wort (für Teiltreffer mitten im Satz)
    let fest = 0;
    const reihenfolge = [];
    stuecke.forEach((st, idx) => {
      if (idx % 2) {
        // Direkt aneinandergereihte Platzhalter („{1}{2}{3}“) sind ein Wert: sonst teilt die Suche ihn willkürlich auf.
        if (idx > 1 && stuecke[idx - 1] === '') { reihenfolge[reihenfolge.length - 1].push(Number(st)); return; }
        // Ein Platzhalter, der an festem Text klebt („übermitteln{0};“), darf leer sein; einer mit Leerzeichen drumherum nicht.
        const klebt = (stuecke[idx - 1] !== '' && !/\s$/.test(stuecke[idx - 1])) || (stuecke[idx + 1] !== '' && !/^\s/.test(stuecke[idx + 1]));
        re += klebt ? '([\\s\\S]*?)' : '([\\s\\S]+?)';
        const anfang = idx === 1 && stuecke[0].trim() === '';
        const ende = idx === stuecke.length - 2 && stuecke[stuecke.length - 1].trim() === '';
        reT += anfang ? '(?<![^\\s])(\\S+)' : ende ? '(\\S+?)(?=[:;,.!?]*(?:\\s|$))' : '([\\s\\S]+?)';
        reihenfolge.push([Number(st)]);
        return;
      }
      fest += st.replace(/\s/g, '').length;
      const fester = regexText(st).replace(/ +/g, '\\s+');
      re += fester;
      reT += fester;
    });
    // Freie Werte (Namen, Nutzertexte) nur bei genug festem Text; steht ein Platzhalter am
    // Rand, braucht es mindestens zwei feste Wörter („{0} als erledigt abhaken“, nicht „{0} Buchungen“).
    // Stehen an beiden Rändern Platzhalter, braucht es drei.
    const rand = (/^\s*\{\d+\}/.test(de) ? 1 : 0) + (/\{\d+\}\s*$/.test(de) ? 1 : 0);
    const woerter = (de.replace(/\{\d+\}/g, ' ').match(WORT) || []).length;
    const offen = fest >= KURZ && woerter >= [1, 2, 3][rand];
    // Platzhalter an beiden Rändern bei wenig festem Text („{0}. Quartal {1}“): nur kurze Einzelwerte, sonst passt es auf jeden Satz.
    merken(muster, a, { re: new RegExp('^' + re + '$'), ohneAnker: new RegExp(reT), en, fest, reihenfolge, offen, kurzeWerte: rand === 2 && fest < 16 });
  }
}

/*
 * Muster mit wenig festem Text („{0} oder {1}“, „am {0}“, „{0} Buchungen“) passen
 * auf fast jeden Satz. Sie gelten nur, wenn die eingesetzten Werte neutral oder
 * selbst übersetzbar sind; sonst blieben Nutzertexte halb deutsch, halb englisch.
 */
function werteTragbar(r, tiefe) {
  for (let k = 1; k < r.length; k++) {
    const v = String(r[k] ?? '').replace(/\uE000\d+\uE001/g, ' ').trim();
    if (NEUTRAL.test(v)) continue;
    if (kernUebersetzen(v, tiefe + 1) === null) return false;
  }
  return true;
}

/**
 * Sucht ein Muster, das auf den ganzen Text passt; liefert {en, werte} (werte nach
 * Platzhalternummer). frei: auch Muster, deren Werte unübersetzbar bleiben dürfen.
 */
function musterSuchen(text, tiefe = 0, frei = true, minFest = 0) {
  const woerter = new Set(text.match(/[A-Za-zÄÖÜäöüß]{2,}/g) || []);
  let best = null;
  for (const w of woerter) {
    const liste = muster.get(w);
    if (!liste) continue;
    for (const m of liste) {
      if ((best && m.fest <= best.m.fest) || m.fest < minFest) continue;
      const r = m.re.exec(text);
      // Ein Wert über eine Satzgrenze hinweg ist kein Treffer, sondern ein zweiter Satz.
      if (!r || r.slice(1).some((v) => SATZ.test(v || ''))) continue;
      if (m.kurzeWerte && r.slice(1).some((v) => !/^\S+(?: \S+)?$/.test(v || '') || (v || '').length > 24)) continue;
      if ((frei && m.offen) || werteTragbar(r, tiefe)) best = { m, r };
    }
  }
  if (!best) return null;
  const werte = [];
  best.m.reihenfolge.forEach((nrn, k) => nrn.forEach((nr, j) => { werte[nr] = j ? '' : best.r[k + 1]; }));
  return { en: best.m.en, werte };
}

/**
 * Übersetzt den Kern eines Textes (ohne Ränder). null = nicht im Wörterbuch.
 * Platzhalterwerte werden selbst übersetzt (Mehrzahl, Zustände, Monatsnamen …).
 */
function kernUebersetzen(kern, tiefe = 0) {
  const norm = kern.replace(/\s+/g, ' ');
  if (cache.has(norm)) return cache.get(norm);
  let out = genau.get(norm) ?? null;
  const einsetzen = (t) => t.en.replace(/\{(\d+)\}/g, (_, k) => wertUebersetzen(t.werte[Number(k)] ?? '', tiefe + 1));
  // Reihenfolge: ganz übersetzbare Muster, dann Teile für sich, dann Muster mit freien
  // Werten (Namen bleiben), zuletzt Teiltreffer.
  if (out === null && tiefe < 4) {
    const t = musterSuchen(kern, tiefe, false);
    if (t) out = einsetzen(t);
  }
  // Ganze lange Sätze mit freien Werten (Namen) vor dem Zerlegen: „Müller GmbH, Telefon …. Einnahmen in …“
  if (out === null && tiefe < 4) {
    const t = musterSuchen(kern, tiefe, true, 30);
    if (t) out = einsetzen(t);
  }
  // Aufzählungen mit Mittelpunkt („11:00 · Studio · in 5 Tagen“) und aneinandergehängte
  // Sätze: jeder Teil für sich, unübersetzbare Teile (Namen, Orte) bleiben stehen.
  if (out === null && tiefe < 4) {
    for (const trenner of [' · ', SATZ]) {
      const stuecke = norm.split(trenner);
      if (stuecke.length < 2) continue;
      const neu = stuecke.map((st) => (NEUTRAL.test(st) ? st : kernUebersetzen(st.trim(), tiefe + 1) ?? st));
      if (neu.some((st, i) => st !== stuecke[i])) { out = neu.join(typeof trenner === 'string' ? trenner : ' '); break; }
    }
  }
  if (out === null && tiefe < 4) {
    const t = musterSuchen(kern, tiefe, true);
    if (t) out = einsetzen(t);
  }
  if (out === null && tiefe < 4) out = teiltreffer(norm, tiefe);
  // Beschriftung mit Doppelpunkt („Kontovia ist noch in Entwicklung:“)
  if (out === null && /[^:]:$/.test(norm)) {
    const ohne = kernUebersetzen(norm.slice(0, -1), tiefe + 1);
    if (ohne !== null) out = ohne + ':';
  }
  if (cache.size > 20000) cache.clear();
  cache.set(norm, out);
  return out;
}

const NEUTRAL = /^[^A-Za-zÄÖÜäöüß]*$/;
/* Satzgrenze: Punkt, Frage- oder Ausrufezeichen und ein Großbuchstabe danach; „3. Quartal“ (Ordnungszahl) ist keine. */
const SATZ = /(?<=(?:[^\d\s]|\d{3,})[.!?])\s+(?=[A-ZÄÖÜ„"(])/;
const RAND = /[A-Za-zÄÖÜäöüß0-9]/;
const mehrwortig = (de) => (de.match(WORT) || []).length >= 2 && de.replace(/[^A-Za-zÄÖÜäöüß]/g, '').length >= 10;

/**
 * Teiltreffer: Der Quelltext setzt Werte oft an den Rand eines Satzes („5 Buchungen“,
 * „Eine Änderung ist“ + „noch nicht übernommen.“); im Wörterbuch steht der feste Teil.
 * Gesucht wird der längste Eintrag, der als ganze Wörter im Text steht. Der Rest davor
 * und dahinter muss neutral (Zahlen, Zeichen) oder selbst übersetzbar sein. Ein Eintrag
 * aus mehreren Wörtern („als erledigt abhaken“) darf einen Nutzertext neben sich haben.
 */
function teiltreffer(text, tiefe) {
  const woerter = new Set(text.match(WORT) || []);
  if (!woerter.size) return null;
  let best = null;
  const pruefen = (von, bis, laenge, en, mehrwortig) => {
    if (best && laenge <= best.laenge) return;
    if (von > 0 && RAND.test(text[von - 1]) && RAND.test(text[von])) return;
    if (bis < text.length && RAND.test(text[bis]) && RAND.test(text[bis - 1])) return;
    const vorne = text.slice(0, von);
    const hinten = text.slice(bis);
    // Nutzertexte nicht halb übersetzen: der Rest muss neutral oder ganz übersetzbar sein.
    // Ausnahme: hinter einer Beschriftung mit Doppelpunkt („Aufgabe: …“) darf alles stehen.
    const rest = (s, frei) => {
      if (NEUTRAL.test(s) || frei) return s;
      // Was sich selbst übersetzen lässt („25 offene Aufgaben“ vor einem Satzrest), wird übersetzt.
      const r = wertUebersetzen(s, tiefe + 1);
      if (r !== s) return r;
      return mehrwortig && tiefe === 0 ? s : null;
    };
    const v = rest(vorne, false);
    if (v === null) return;
    const h = rest(hinten, /:\s*$/.test(en) || /:$/.test(text.slice(0, bis)));
    if (h === null) return;
    best = { laenge, out: v + en + h };
  };
  for (const w of woerter) {
    for (const de of teile.get(w) || []) {
      if (de.length >= text.length) continue;
      let i = text.indexOf(de);
      while (i >= 0) {
        pruefen(i, i + de.length, de.replace(/\s/g, '').length, genau.get(de), mehrwortig(de));
        i = text.indexOf(de, i + 1);
      }
    }
    for (const m of muster.get(w) || []) {
      const r = m.ohneAnker.exec(text);
      if (!r || r[0].length >= text.length || (!m.offen && !werteTragbar(r, tiefe))) continue;
      if (m.kurzeWerte && r.slice(1).some((v) => !/^\S+(?: \S+)?$/.test(v || '') || (v || '').length > 24)) continue;
      const werte = [];
      m.reihenfolge.forEach((nrn, k) => nrn.forEach((nr, j) => { werte[nr] = j ? '' : r[k + 1]; }));
      pruefen(r.index, r.index + r[0].length, m.fest,
        m.en.replace(/\{(\d+)\}/g, (_, k) => wertUebersetzen(werte[Number(k)] ?? '', tiefe + 1)), m.offen);
    }
  }
  return best ? best.out : null;
}

function wertUebersetzen(wert, tiefe) {
  if (!BUCHSTABE.test(wert) || wert.includes(MARKE)) return wert;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(wert);
  let r = kernUebersetzen(m[2], tiefe);
  // Angehängte Satzteile („, Einnahmen {0}, Ausgaben {1}“): jeder für sich.
  if (r === null && tiefe < 4 && /^, /.test(m[2])) {
    const teile = m[2].split(/(?=, )/);
    if (teile.length > 1) {
      const neu = teile.map((t) => kernUebersetzen(t, tiefe + 1) ?? t);
      if (neu.some((t, i) => t !== teile[i])) r = neu.join('');
    }
  }
  // Aufzählung mit „und“ („Zahlung und Stornierte Buchungen“): nur, wenn jedes Glied bekannt ist.
  if (r === null && tiefe < 4 && / und /.test(m[2])) {
    const glieder = m[2].split(' und ');
    const neu = glieder.map((g) => kernUebersetzen(g, tiefe + 1));
    if (neu.every((g) => g !== null)) r = neu.join(' and ');
  }
  return r === null ? wert : m[1] + r + m[3];
}

/**
 * Übersetzt einen Text der Oberfläche in die gewählte Sprache. Ohne Treffer
 * oder auf Deutsch: unverändert. Für Stellen außerhalb des DOM (PDF-Berichte,
 * Seitentitel, Dateinamen).
 */
export function t(text, { sprache: ziel = sprache() } = {}) {
  if (ziel !== 'en' || !genau || text === null || text === undefined) return text;
  const s = String(text);
  if (!BUCHSTABE.test(s)) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const r = kernUebersetzen(m[2]);
  return r === null ? s : m[1] + r + m[3];
}

/* -------------------------------------------------------------------------- */
/* DOM                                                                         */
/* -------------------------------------------------------------------------- */

const ATTRIBUTE = ['title', 'placeholder', 'aria-label', 'alt', 'label', 'data-tip', 'aria-description', 'aria-roledescription', 'data-hinweis'];
const AUSLASSEN = 'script,style,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate';
/* Eingaben: der Inhalt gehört den Nutzern, nur Platzhalter und Beschriftung werden übersetzt. */
const NUR_ATTRIBUTE = 'input,textarea';

const geschrieben = new WeakMap();   // Textknoten → von uns geschriebener Text
const original = new WeakMap();      // Textknoten → deutscher Text
const attrOriginal = new WeakMap();  // Element → {attr: [deutsch, englisch]}
const kinderOriginal = new WeakMap(); // Element → ursprüngliche Kinder (bei umgestellten Einheiten)
let beobachter = null;

function ausgelassen(el) {
  return !el || el.nodeType !== 1 || !!el.closest?.(AUSLASSEN);
}

function textSetzen(node, wert) {
  if (!original.has(node)) original.set(node, node.data);
  geschrieben.set(node, wert);
  node.data = wert;
}

function attributeUebersetzen(el) {
  for (const a of ATTRIBUTE) {
    if (!el.hasAttribute(a)) continue;
    const v = el.getAttribute(a);
    const merk = attrOriginal.get(el)?.[a];
    if (merk && merk[1] === v) continue;
    const e = t(v);
    if (e === v) continue;
    const m = attrOriginal.get(el) || {};
    m[a] = [v, e];
    attrOriginal.set(el, m);
    el.setAttribute(a, e);
  }
}

/** Text eines Elements als Einheit übersetzen. */
function einheitUebersetzen(el) {
  const kinder = Array.from(el.childNodes);
  let textDa = false;
  let elemente = 0;
  for (const k of kinder) {
    if (k.nodeType === 3) {
      if (BUCHSTABE.test(k.data) && geschrieben.get(k) !== k.data) textDa = true;
    } else if (k.nodeType === 1) elemente++;
  }
  if (!textDa) return;

  const texte = kinder.filter((k) => k.nodeType === 3);
  if (!elemente) {
    const ganz = texte.map((k) => k.data).join('');
    const e = t(ganz);
    if (e !== ganz) {
      textSetzen(texte[0], e);
      for (const k of texte.slice(1)) textSetzen(k, '');
      return;
    }
    if (texte.length > 1) for (const k of texte) einzeln(k);
    return;
  }

  // Gemischt: Elemente werden zu Marken, Ränder ohne Marken
  const glieder = kinder.filter((k) => k.nodeType === 3 || k.nodeType === 1);
  let a = 0, b = glieder.length;
  const leer = (k) => k.nodeType === 1 || !k.data.trim();
  while (a < b && leer(glieder[a])) a++;
  while (b > a && leer(glieder[b - 1])) b--;
  const mitte = glieder.slice(a, b);
  const els = [];
  let sig = '';
  for (const k of mitte) {
    if (k.nodeType === 3) sig += k.data;
    else { sig += MARKE + els.length + '\uE001'; els.push(k); }
  }
  if (els.length && genau) {
    const kern = sig.trim();
    const norm = kern.replace(/\s+/g, ' ').replace(MARKE_RE, (_, i) => `{${i}}`);
    let en = genau.get(norm) ?? null;
    let werte = null;
    if (en === null) {
      const r = musterSuchen(kern);
      if (r) { en = r.en; werte = r.werte; }
    } else {
      // Treffer ohne Muster: Marken in Reihenfolge
      werte = els.map((_, i) => `${MARKE}${i}\uE001`);
    }
    if (en !== null) {
      umstellen(el, mitte, sig, en, werte, els);
      return;
    }
  }
  for (const k of texte) einzeln(k);
}

function umstellen(el, mitte, sig, en, werte, els) {
  if (!kinderOriginal.has(el)) kinderOriginal.set(el, Array.from(el.childNodes));
  const vorne = /^\s*/.exec(sig)[0];
  const hinten = /\s*$/.exec(sig)[0];
  const neu = [];
  const text = (s) => {
    if (!s) return;
    const n = document.createTextNode(s);
    geschrieben.set(n, s);
    neu.push(n);
  };
  const benutzt = new Set();
  const wertEinsetzen = (w) => {
    // w: Text mit Marken
    let rest = w;
    let m;
    const re = /\uE000(\d+)\uE001/g;
    let pos = 0;
    while ((m = re.exec(rest))) {
      text(wertUebersetzen(rest.slice(pos, m.index), 1));
      const e = els[Number(m[1])];
      if (e && !benutzt.has(e)) { neu.push(e); benutzt.add(e); }
      pos = m.index + m[0].length;
    }
    text(wertUebersetzen(rest.slice(pos), 1));
  };
  const teile = (vorne + en + hinten).split(/\{(\d+)\}/);
  teile.forEach((st, idx) => {
    if (idx % 2) wertEinsetzen(werte?.[Number(st)] ?? '');
    else text(st);
  });
  // Elemente, die die Übersetzung nicht vorsieht, bleiben hinten erhalten
  for (const e of els) if (!benutzt.has(e)) neu.push(e);
  const anker = mitte[mitte.length - 1].nextSibling;
  for (const k of mitte) if (k.parentNode === el && !neu.includes(k)) el.removeChild(k);
  for (const n of neu) el.insertBefore(n, anker);
}

function einzeln(node) {
  if (geschrieben.get(node) === node.data) return;
  const e = t(node.data);
  if (e !== node.data) textSetzen(node, e);
}

function elementUebersetzen(el, geprueft = false) {
  if (!geprueft && ausgelassen(el)) return;
  attributeUebersetzen(el);
  if (el.matches?.(NUR_ATTRIBUTE)) return;
  einheitUebersetzen(el);
  for (const k of Array.from(el.children)) {
    if (k.matches?.(AUSLASSEN)) continue;
    elementUebersetzen(k, true);
  }
}

function verarbeiten(records) {
  const els = new Set();
  for (const r of records) {
    if (r.type === 'childList') {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1) els.add(n);
        else if (n.nodeType === 3 && n.parentElement) els.add(n.parentElement);
      }
    } else if (r.type === 'characterData') {
      const n = r.target;
      if (geschrieben.get(n) !== n.data && n.parentElement) els.add(n.parentElement);
    } else if (r.type === 'attributes') {
      els.add(r.target);
    }
  }
  for (const el of els) {
    if (!el.isConnected) continue;
    if (el.closest?.(AUSLASSEN)) continue;
    elementUebersetzen(el);
  }
}

function titelUebersetzen() {
  const ti = document.querySelector('title');
  if (ti) elementUebersetzen(ti);
}

function starten() {
  document.documentElement.lang = 'en';
  elementUebersetzen(document.head?.querySelector('title') || document.createElement('i'));
  if (document.body) elementUebersetzen(document.body);
  if (!beobachter) {
    beobachter = new MutationObserver(verarbeiten);
    beobachter.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTE,
    });
  }
  titelUebersetzen();
}

function anhalten() {
  if (beobachter) { beobachter.disconnect(); beobachter = null; }
  document.documentElement.lang = 'de';
  // Bestmöglich zurück: Texte und Attribute; umgestellte Einheiten in alter Reihenfolge
  const alle = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
  for (const el of alle) {
    const ko = kinderOriginal.get(el);
    if (ko) {
      for (const k of Array.from(el.childNodes)) if (k.nodeType === 3 && !ko.includes(k)) el.removeChild(k);
      for (const k of ko) el.appendChild(k);
      kinderOriginal.delete(el);
    }
    const ao = attrOriginal.get(el);
    if (ao) {
      for (const [a, [de, en]] of Object.entries(ao)) if (el.getAttribute(a) === en) el.setAttribute(a, de);
      attrOriginal.delete(el);
    }
    for (const k of el.childNodes) {
      if (k.nodeType === 3 && original.has(k) && geschrieben.get(k) === k.data) {
        k.data = original.get(k);
        original.delete(k);
        geschrieben.delete(k);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Umschalter für Sperr- und Einrichtungsbildschirm                            */
/* -------------------------------------------------------------------------- */

/** Kleiner Umschalter Deutsch/English; die Namen bleiben in ihrer eigenen Sprache. */
export function sprachWahl() {
  return `<div class="sprach-wahl" translate="no" role="group" aria-label="Sprache / Language">${SPRACHEN.map((l) => `<button type="button" class="${l.code === aktuell ? 'aktiv' : ''}" data-sprache="${l.code}" lang="${l.code}" aria-pressed="${l.code === aktuell}">${l.name}</button>`).join('')}</div>`;
}

/** Verdrahtet alle Umschalter unterhalb von root. */
export function sprachWahlVerdrahten(root = globalThis.document) {
  root.querySelectorAll('.sprach-wahl [data-sprache]').forEach((b) => b.addEventListener('click', async () => {
    await spracheSetzen(b.dataset.sprache);
    root.querySelectorAll('.sprach-wahl [data-sprache]').forEach((x) => {
      const an = x.dataset.sprache === aktuell;
      x.classList.toggle('aktiv', an);
      x.setAttribute('aria-pressed', String(an));
    });
  }));
}

/* -------------------------------------------------------------------------- */
/* Start und Umschalten                                                        */
/* -------------------------------------------------------------------------- */

let laden = null;
/** Ist das englische Wörterbuch schon geladen? */
export const woerterbuchDa = () => !!genau;
/** Das englische Wörterbuch laden, ohne die Oberfläche umzustellen (für Dokumente auf Englisch). */
export async function woerterbuchBereit() { await woerterbuchLaden(); }
async function woerterbuchLaden() {
  if (genau) return;
  if (!laden) laden = import('./sprache/en.js').then((m) => woerterbuchSetzen(m.default));
  await laden;
}

const hoerer = new Set();
/** Meldet einen Sprachwechsel (z. B. Ansicht neu zeichnen). */
export function beiSprachwechsel(fn) { hoerer.add(fn); return () => hoerer.delete(fn); }

/** Beim Start, vor dem ersten Zeichnen: Englisch laden und den Beobachter anwerfen. */
export async function spracheStarten() {
  if (aktuell !== 'en' || !globalThis.document) return;
  try {
    await woerterbuchLaden();
    starten();
  } catch (err) {
    console.warn('Wörterbuch nicht geladen', err);
    aktuell = 'de';
  }
}

/** Wechselt die Sprache sofort und merkt sie auf diesem Gerät. */
export async function spracheSetzen(code) {
  if (code !== 'de' && code !== 'en') return;
  spracheMerken(code);
  if (code === aktuell) return;
  if (code === 'en') {
    await woerterbuchLaden();
    aktuell = 'en';
    if (globalThis.document) starten();
  } else {
    aktuell = 'de';
    if (globalThis.document) anhalten();
  }
  for (const fn of hoerer) { try { fn(code); } catch (err) { console.warn(err); } }
}
