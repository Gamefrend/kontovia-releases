/**
 * Kontovia – Assistent: der Ablauf einer Frage.
 *
 *   Frage → (Stufe Basis) feste Regeln → Werkzeug → fertiger Satz
 *         → (Modell)      Anweisung + Verlauf + Frage → Modell wählt Werkzeug(e)
 *                         → Kontovia führt aus → Ergebnis zurück ans Modell
 *                         → Modell schreibt die Antwort (oder Kontovia, bei „Schnell“)
 *
 * Sicherungen gegen ein zu kleines oder verwirrtes Modell:
 *  • Sichere Befehle (Bereich öffnen, Rechnen, Gruß) laufen ohne Modell.
 *  • Antwortet ein Modell mit Beträgen, ohne ein Werkzeug gerufen zu haben,
 *    gilt die Antwort nicht: Es antworten die festen Regeln.
 *  • Ein unlesbarer Werkzeugaufruf wird repariert oder verworfen; dann helfen
 *    ebenfalls die festen Regeln.
 *  • Anlegen ist immer nur ein Vorschlag (assistentwerkzeuge.js).
 *
 *  • Bei „Schnell“ folgt der Werkzeugaufruf einem Schema (werkzeugSchema):
 *    nur bekannte Werkzeuge, nur erlaubte Felder und Werte. Kann die Laufzeit
 *    es nicht übersetzen, geht es für die Sitzung ohne weiter.
 *  • Erkennen die Regeln die Frage sicher, gelten bei kleinen Modellen ihre
 *    Angaben vor denen des Modells; ruft das Modell gar kein Werkzeug, oder
 *    gibt es rohes JSON als Antwort, antworten die Regeln.
 *
 * Schnelligkeit: Die Laufzeit liest nur neu ein, was sich am Gespräch
 * geändert hat, wenn der bisherige Verlauf Zeichen für Zeichen gleich bleibt.
 * Deshalb kommt jede Antwort des Modells wörtlich (`nachricht` aus ki.js)
 * zurück in den Verlauf, und `gespraech` trägt diesen Stand von Frage zu
 * Frage. Passt er nicht mehr in den Kontext, beginnt er neu, mit dem knappen
 * Verlauf aus Fragen und Antworten.
 *
 * Das Modell selbst erreicht diese Datei nur über `motor` (api.ki), und es
 * bekommt nur, was hier für die Frage zusammengestellt wird. Der Verlauf
 * lebt im Speicher der Oberfläche und verschwindet beim Sperren.
 */

import { deuten, folgefrageDeuten, zeitraumLesen, alleZeitraeume, uhrzeitLesen, betragLesen, ohneZeit, aufAnsicht } from './assistentdeutung.js';
import { norm } from './util.js';
import { istEnglisch } from './sprache.js';
import { ausfuehren, eintragBeschreiben, werkzeug } from './assistentwerkzeuge.js';
import { anweisung, tokenSchaetzen, werkzeugSchema, SCHNELL_HINWEIS, LETZTER_SCHRITT } from './assistentwissen.js';
import { stufe, DENKWEISEN, denkweiseWaehlen } from './assistentmodelle.js';

/** Befehle, die ohne Modell schneller und genauer gehen. */
const OHNE_MODELL = new Set(['oeffnen', 'rechnen', 'steuer_rechnen', 'faehigkeiten']);

/** Hat die Laufzeit die Grammatik einmal nicht übersetzen können, bleibt sie für die Sitzung aus. */
let grammatikAus = false;
export const grammatikAn = () => !grammatikAus;

const NICHT_VERSTANDEN = 'Das habe ich nicht verstanden. Fragen Sie zum Beispiel „Was ist noch offen?“, „Umsatz im März“ oder „Finde Rechnung Müller“.';

/* -------------------------------------------------------------------------- */
/* Antwort des Modells zerlegen                                                */
/* -------------------------------------------------------------------------- */

/** Erstes vollständiges {…} in einem Text, auch wenn davor oder danach Unsinn steht. */
function jsonObjekt(s) {
  const a = s.indexOf('{');
  if (a < 0) return null;
  let tiefe = 0;
  let inText = false;
  for (let i = a; i < s.length; i++) {
    const c = s[i];
    if (inText) {
      if (c === '\\') i++;
      else if (c === '"') inText = false;
      continue;
    }
    if (c === '"') inText = true;
    else if (c === '{') tiefe++;
    else if (c === '}' && --tiefe === 0) return s.slice(a, i + 1);
  }
  return null;
}

/** Liest einen Werkzeugaufruf, so gut es geht. */
export function aufrufLesen(roh) {
  const kandidat = jsonObjekt(String(roh || ''));
  if (!kandidat) return null;
  const versuche = [kandidat, kandidat.replace(/,\s*([}\]])/g, '$1'), kandidat.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1')];
  for (const v of versuche) {
    try {
      const o = JSON.parse(v);
      const name = String(o.name || o.function || o.tool || '').trim();
      let args = o.arguments ?? o.parameters ?? o.args ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      if (name) return { name, argumente: args && typeof args === 'object' ? args : {} };
    } catch { /* nächster Versuch */ }
  }
  return null;
}

/**
 * Zerlegt eine Modellantwort in Gedanken, Werkzeugaufrufe und Text.
 * @returns {{gedanken:string, aufrufe:Array<{name:string, argumente:object}>, text:string, roh:string}}
 */
export function zerlegen(ausgabe) {
  let s = String(ausgabe || '');
  let gedanken = '';
  const t = /<think>([\s\S]*?)(<\/think>|$)/.exec(s);
  if (t) { gedanken = t[1].trim(); s = s.replace(t[0], ''); }
  const aufrufe = [];
  const re = /<tool_call>([\s\S]*?)(<\/tool_call>|$)/g;
  let m;
  while ((m = re.exec(s))) {
    const a = aufrufLesen(m[1]);
    if (a) aufrufe.push(a);
  }
  let text = s.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '').trim();
  // Ohne Hülle: Qwen schreibt <tool_call> als Sondertoken, das die Laufzeit nicht als Text
  // herausgibt; der Aufruf kommt als blankes JSON, manchmal mitten im Text.
  if (!aufrufe.length) {
    let rest = text;
    for (let i = 0; i < 3; i++) {
      const pos = rest.search(/\{\s*"(name|function|tool)"\s*:/);
      if (pos < 0) break;
      const stueck = jsonObjekt(rest.slice(pos));
      const a = stueck ? aufrufLesen(stueck) : null;
      if (!a) break;
      aufrufe.push(a);
      rest = `${rest.slice(0, pos)}${rest.slice(pos + stueck.length)}`;
    }
    if (aufrufe.length) text = rest.trim();
  }
  return { gedanken, aufrufe, text, roh: s.trim() };
}

/** Rohes JSON oder ein halber Aufruf ist keine Antwort für Menschen (gemessen: Qwen3 1,7B gab Ergebnisse als JSON aus). */
export const istRohesJson = (s) => /^\s*[[{]/.test(String(s || '')) || /"(name|arguments)"\s*:/.test(String(s || ''));

/* -------------------------------------------------------------------------- */
/* Strom: Gedanken und Text schon beim Schreiben zeigen                        */
/* -------------------------------------------------------------------------- */

/** Teilt den entstehenden Text in Gedanken und sichtbare Antwort; ein Werkzeugaufruf bleibt verborgen. */
function stromLeser(melden) {
  let alles = '';
  let gezeigt = 0;
  let gedankenGezeigt = 0;
  return (stueck) => {
    alles += stueck;
    const auf = alles.indexOf('<think>');
    const zu = alles.indexOf('</think>');
    if (auf >= 0 && zu < 0) {
      const g = alles.slice(auf + 7);
      if (g.length > gedankenGezeigt) { melden({ typ: 'denken', text: g.slice(gedankenGezeigt) }); gedankenGezeigt = g.length; }
      return;
    }
    if (auf >= 0 && zu >= 0 && gedankenGezeigt < zu - auf - 7) {
      const g = alles.slice(auf + 7, zu);
      melden({ typ: 'denken', text: g.slice(gedankenGezeigt) });
      gedankenGezeigt = g.length;
    }
    const nach = zu >= 0 ? alles.slice(zu + 8) : auf >= 0 ? '' : alles;
    const rein = nach.replace(/^\s+/, '');
    if (!rein || '<tool_call>'.startsWith(rein.slice(0, 11)) || rein.startsWith('<tool_call>') || rein.startsWith('{')) return;
    const sichtbar = rein.split('<tool_call>')[0];
    if (sichtbar.length > gezeigt) { melden({ typ: 'text', text: sichtbar.slice(gezeigt) }); gezeigt = sichtbar.length; }
  };
}

/* -------------------------------------------------------------------------- */
/* Ablauf                                                                      */
/* -------------------------------------------------------------------------- */

/** Ergebnis für das Modell: knapp, mit Obergrenze. */
function antwortFuerModell(e, max) {
  let j = JSON.stringify({ name: e.name, ergebnis: e.daten });
  if (j.length > max) {
    const d = { ...e.daten };
    for (const k of Object.keys(d)) if (Array.isArray(d[k])) d[k] = d[k].slice(0, 3);
    j = JSON.stringify({ name: e.name, ergebnis: d, gekuerzt: true });
  }
  return `<tool_response>\n${j.slice(0, max)}\n</tool_response>`;
}

/** Ergebnisse, die das Modell nicht mehr gesehen hat (Kontovia hat die Antwort geschrieben): kurz für die nächste Frage. */
const nachtragVon = (runde) => runde.map((e) => `<tool_response>\n${JSON.stringify({ name: e.name, ergebnis: e.text || e.daten })}\n</tool_response>`).join('\n').slice(0, 1200);

/** Verlauf als Nachrichten, die neuesten zuerst gekürzt, damit alles in den Kontext passt. */
function verlaufNachrichten(verlauf, max) {
  return (verlauf || []).slice(-max).flatMap((v) => [
    { role: 'user', content: v.frage },
    { role: 'assistant', content: `${v.antwort}${v.kurz ? `\n(${v.kurz})` : ''}` },
  ]);
}

/** Die Frage, wie das Modell sie bekommt: davor, was es noch nicht weiß, und der geöffnete Eintrag. */
const frageText = (frage, { nachtrag = '', ansicht = '', schnell = false } = {}) => [nachtrag, ansicht && `[Geöffnet: ${ansicht}]`, frage, schnell && SCHNELL_HINWEIS].filter(Boolean).join('\n');

/** Der Denkblock einer Antwort fällt weg, wenn der Platz knapp wird. */
const ohneGedanken = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '');

const hatBetrag = (s) => /\d[\d.,]*\s?€|\d+,\d{2}\b/.test(s);

/**
 * Beträge eines Textes, vereinheitlicht: „1.234,50 €“, „€13.293,48“, „140 Euro“
 * und jede Zahl mit zwei Nachkommastellen („13.293,48“) → „13293.48“.
 */
function betraege(s) {
  const out = [];
  const re = /(€\s?|eur\s|euro\s)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(\s?(?:€|euro\b|eur\b))?/gi;
  for (const m of String(s || '').matchAll(re)) {
    const waehrung = !!(m[1] || m[4]);
    if (!waehrung && !(m[3] && m[3].length === 2)) continue; // Prozente, Jahre, Anzahlen
    out.push(`${Number(m[2].replace(/\./g, ''))}.${(m[3] || '0').padEnd(2, '0')}`);
  }
  return out;
}

/**
 * Stammt jeder Betrag einer Modellantwort aus einem Werkzeugergebnis? Gemessen
 * mit Qwen3 4B (06.10.2026): Es erfand den Gewinn eines Monats, den kein
 * Werkzeug geliefert hatte, samt Begründung. Solche Antworten gelten nicht.
 * @returns {string[]} die Beträge ohne Herkunft
 */
export function fremdeBetraege(text, ergebnisse) {
  const bekannt = new Set(ergebnisse.flatMap((e) => betraege(JSON.stringify(e.daten || {}))));
  return betraege(text).filter((b) => !bekannt.has(b));
}

const ZEIT_FELDER = { zeitraum: 'raum', datum: 'tag', faellig: 'tag' };
/* Hier legt ein erfundener Betrag etwas an oder sucht damit; er gilt nur, wenn er in der Frage steht. */
const BETRAG_NUR_AUS_FRAGE = new Set(['buchung_vorschlagen', 'zahlung_vorschlagen']);
const woerterVon = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((x) => x.length > 3));

/**
 * Erdet die Angaben eines Modells an der Frage. Kleine Modelle übernehmen
 * gern Werte aus den Beispielen der Anweisung („letzte Woche“, „morgen“,
 * „Müller Bau“, „2024-0815“). Zeitangaben, Uhrzeit, Betrag, Rechnungsnummer
 * und Namen gelten deshalb nur, wenn die Frage (oder bei Namen: der Verlauf
 * davor, `bezug`) sie hergibt; sonst gilt, was in der Frage steht, oder die
 * Vorgabe des Werkzeugs. Suchwörter und Titel bleiben dem Modell (dort
 * helfen andere Schreibweisen).
 */
export function erden(name, argumente, frage, heute, deutung = null, bezug = '') {
  const a = { ...(argumente || {}) };
  if (name === 'zeitraeume_vergleichen') return a;
  const zf = zeitraumLesen(frage, heute);
  const alle = alleZeitraeume(frage, heute);
  for (const [feld, art] of Object.entries(ZEIT_FELDER)) {
    if (!(feld in a) || !a[feld]) continue;
    const zm = zeitraumLesen(String(a[feld]), heute) || (/^\d{4}-\d{2}-\d{2}$/.test(String(a[feld])) ? { von: a[feld], bis: a[feld] } : null);
    // Steht dieser Zeitraum irgendwo in der Frage („September … als im August“), bleibt er.
    if (zm && alle.some((z) => z.von === zm.von && z.bis === zm.bis)) continue;
    if (zf) a[feld] = art === 'raum' ? zf.text : zf.von;
    else delete a[feld];
  }
  if ('uhrzeit' in a) {
    const u = uhrzeitLesen(zf ? frage.replace(new RegExp(ohneZeit(zf), 'i'), ' ') : frage);
    if (u) a.uhrzeit = u; else delete a.uhrzeit;
  }
  if ('betrag' in a) {
    const b = betragLesen(frage);
    if (b !== null) a.betrag = b / 100;
    else if (BETRAG_NUR_AUS_FRAGE.has(name)) delete a.betrag;
  }
  if (a.rechnung && !norm(frage).replace(/\s+/g, '').includes(norm(a.rechnung).replace(/\s+/g, ''))) {
    if (deutung?.werkzeug === name && deutung.argumente?.rechnung) a.rechnung = deutung.argumente.rechnung; else delete a.rechnung;
  }
  // Namen, und beim Eintragen einer Zahlung auch das Stichwort (sonst sucht sie nach „Tanken“ aus einem Beispiel).
  for (const feld of name === 'zahlung_vorschlagen' ? ['kontakt', 'kunde', 'text'] : ['kontakt', 'kunde']) {
    if (!a[feld] || typeof a[feld] !== 'string') continue;
    const da = woerterVon(`${frage} ${bezug}`);
    if ([...woerterVon(a[feld])].some((w) => da.has(w) || [...da].some((d) => d.startsWith(w.slice(0, 5))))) continue;
    if (deutung?.werkzeug === name && deutung.argumente?.[feld]) a[feld] = deutung.argumente[feld]; else delete a[feld];
  }
  // Titel ohne ein einziges Wort aus der Frage: dann der aus den festen Regeln, wenn sie einen haben.
  if (a.titel && deutung?.werkzeug === name && deutung.argumente?.titel) {
    const woerter = new Set(norm(frage).split(/[^a-z0-9]+/).filter((x) => x.length > 3));
    if (!norm(a.titel).split(/[^a-z0-9]+/).some((x) => woerter.has(x))) a.titel = deutung.argumente.titel;
  }
  return a;
}

/**
 * Beantwortet eine Frage.
 *
 * @param {object} p
 * @param {string} p.frage
 * @param {Array<{frage:string, antwort:string, kurz?:string}>} [p.verlauf]
 * @param {string} p.stufeId          'basis' | 'mini' | 'standard' | 'gross' | 'maximal'
 * @param {string} [p.denkweise]      'auto' | 'schnell' | 'ausgewogen' | 'gruendlich'
 * @param {object} p.db               der Bestand (store.db)
 * @param {string} p.heute
 * @param {boolean} [p.privat]        private Buchungen mitzählen (wie das Häkchen in den Auswertungen)
 * @param {{rolle?:string, kannSchreiben?:boolean}} [p.nutzer]
 * @param {{antworten:Function, abbrechen?:Function}|null} [p.motor]  null: nur feste Regeln
 * @param {(ev:object)=>void} [p.melden]  Ereignisse für die Oberfläche
 * @param {{abgebrochen:boolean}} [p.abbruch]
 * @param {object|null} [p.gespraech]  `gespraech` aus der Antwort davor (wörtlicher Stand der Laufzeit), sonst null
 * @param {Array<object>|null} [p.hilfe]  Abschnitte der Kurzanleitung (views/help.js: hilfeAbschnitte)
 * @param {{art:string, id:string}|null} [p.ansicht]  der Eintrag, den man gerade vor sich hat
 * @returns {Promise<{text:string, ergebnisse:Array<object>, denkweise:string, rueckfall:boolean, schritte:number, quelle:'regeln'|'modell',
 *   gespraech:object|null}>}  gespraech: für die nächste Frage weitergeben
 */
export async function beantworten({
  frage, verlauf = [], gespraech = null, stufeId, denkweise = 'auto', db, heute, privat = false, nutzer = {}, motor = null,
  melden = () => {}, abbruch = { abgebrochen: false }, hilfe = null, ansicht = null,
}) {
  const st = stufe(stufeId);
  const blick = ansicht?.id ? ansicht : null;
  // Eine Rückfrage („und bei Lidl?“) gilt vor einer bloßen Suche; eine sicher erkannte eigene Frage vor der Rückfrage.
  const eigen = deuten(frage, { heute, db, ansicht: blick });
  const folge = folgefrageDeuten(frage, verlauf, { heute, db });
  const d = folge && !(eigen?.sicher && eigen.werkzeug !== 'suchen') ? folge : eigen || folge;
  const ergebnisse = [];
  const werkzeugLaufen = (name, argumente) => {
    const e = ausfuehren(db, name, argumente, { heute, privat, hilfe, ansicht: blick });
    ergebnisse.push(e);
    melden({ typ: 'werkzeug', name, argumente, ergebnis: e });
    return e;
  };
  const regelAntwort = (rueckfall) => {
    if (!d) return { text: NICHT_VERSTANDEN, ergebnisse, denkweise: 'regeln', rueckfall, schritte: 0, quelle: 'regeln', gespraech: null };
    const e = werkzeugLaufen(d.werkzeug, d.argumente);
    return { text: e.text || NICHT_VERSTANDEN, ergebnisse, denkweise: 'regeln', rueckfall, schritte: 1, quelle: 'regeln', gespraech: null };
  };
  // Ohne Modell bleibt der Stand der Laufzeit, wie er war: Frage und Antwort kommen als Nachtrag vor die nächste Frage.
  const ohneModellWeiter = (r) => {
    if (!gespraech?.nachrichten) return r;
    const nachtrag = [gespraech.nachtrag, `Frage: ${frage}\nAntwort von Kontovia: ${r.text}`].filter(Boolean).join('\n');
    return { ...r, gespraech: nachtrag.length <= 1500 ? { ...gespraech, nachtrag } : null };
  };

  // Stufe Basis, oder kein Modell bereit.
  if (!st.modell || !motor) return ohneModellWeiter(regelAntwort(false));

  const auto = !(denkweise in DENKWEISEN) || denkweise === 'auto';
  const regelnSicher = !!d?.sicher && d.werkzeug !== 'suchen';
  let weise = auto ? denkweiseWaehlen(frage, { stufe: st.id, deutungSicher: regelnSicher }) : denkweise;
  // Mini formuliert keine eigenen Sätze (gemessen: es wiederholt Beispiele und
  // verwechselt Begriffe); es wählt nur das Werkzeug. Ohne Denkmodus kein Nachdenken.
  if (st.kern) weise = 'schnell';
  if (weise === 'gruendlich' && !st.denken) weise = 'ausgewogen';
  melden({ typ: 'denkweise', denkweise: weise });
  const w = DENKWEISEN[weise];

  // Sichere Befehle gehen schneller ohne Modell; bei „Automatisch“ auch jede
  // Frage, die die festen Regeln sicher erkennen (sofort und genau).
  if (d?.sicher && OHNE_MODELL.has(d.werkzeug) && weise !== 'gruendlich') return ohneModellWeiter({ ...regelAntwort(false), denkweise: weise });
  if (auto && regelnSicher && weise === 'schnell') return ohneModellWeiter({ ...regelAntwort(false), denkweise: weise });
  // Kleine Modelle: Widerspricht ihr Werkzeug einer sicheren Regel, gilt die Regel.
  const regelnVorrang = regelnSicher && (st.kern || st.id === 'standard');

  const kontext = st.kontext;
  const maxErgebnis = st.kern ? 1100 : 2400;
  const sys = anweisung({ stufeId: st.id, heute, settings: db.settings || {}, rolle: nutzer.rolle || '', kannSchreiben: nutzer.kannSchreiben !== false });
  // Die Schätzung ist grob (Werkzeuglisten zerfallen in mehr Token als Fließtext), daher mit Aufschlag.
  const zuLang = (liste) => Math.ceil(tokenSchaetzen(liste.map((n) => n.content).join('')) * 1.1) + 8 * liste.length + w.token + 120 > kontext;
  const ansichtZeile = blick && aufAnsicht(frage) && eintragBeschreiben(db, blick) ? `${eintragBeschreiben(db, blick)} (${blick.art}, id ${blick.id})` : '';
  const sys0 = { role: 'system', content: sys };
  // Weiter im wörtlichen Stand der Laufzeit, wenn er zu dieser Anweisung gehört und noch passt.
  const alt = gespraech?.system === sys && gespraech.stufe === st.id && Array.isArray(gespraech.nachrichten) ? gespraech : null;
  let nachrichten = alt ? [sys0, ...alt.nachrichten, { role: 'user', content: frageText(frage, { nachtrag: alt.nachtrag, ansicht: ansichtZeile, schnell: !w.antwort }) }] : null;
  if (!nachrichten || zuLang(nachrichten)) {
    nachrichten = [sys0, ...verlaufNachrichten(verlauf, st.kern ? 1 : st.id === 'standard' ? 2 : 4), { role: 'user', content: frageText(frage, { ansicht: ansichtZeile, schnell: !w.antwort }) }];
    // Passt es nicht in den Kontext, fällt der älteste Verlauf weg.
    while (nachrichten.length > 2 && zuLang(nachrichten)) nachrichten.splice(1, 2);
  }
  const bezug = verlauf.length ? `${verlauf.at(-1).frage} ${verlauf.at(-1).antwort}` : '';

  let schritte = 0;
  let antwortText = '';
  let werkzeugGerufen = false;
  /** Was die Laufzeit nach dem letzten Schritt kennt: die gesendeten Nachrichten und ihre Antwort. */
  let stand = null;
  /** Ergebnisse, die das Modell nicht mehr gesehen hat; sie stehen vor der nächsten Frage. */
  let nachtrag = '';
  let ende = '';
  // Springen die Regeln ein, bleibt der Stand der Laufzeit trotzdem gültig: Ihre Antwort kommt als Nachtrag vor die nächste Frage.
  const mitRueckfall = (r) => ({
    ...r, denkweise: weise, schritte,
    gespraech: stand ? { system: sys, stufe: st.id, nachrichten: stand.slice(1), nachtrag: `Antwort von Kontovia: ${r.text}`.slice(0, 1200) } : null,
  });
  for (let i = 0; i < w.schritte + 1 && !abbruch.abgebrochen; i++) {
    const letzter = i === w.schritte;
    // Wird es eng, fallen die Gedanken früherer Schritte weg; dann liest die Laufzeit einmal alles neu.
    if (zuLang(nachrichten)) nachrichten = nachrichten.map((n) => (n.role === 'assistant' ? { ...n, content: ohneGedanken(n.content) } : n));
    if (i > 0 && zuLang(nachrichten)) break;
    schritte++;
    const senden = letzter ? [...nachrichten, { role: 'user', content: LETZTER_SCHRITT[istEnglisch() ? 'en' : 'de'] }] : [...nachrichten];
    // Bei „Schnell“ ist die Antwort ein Werkzeugaufruf und sonst nichts: dann mit Schema.
    const format = !w.antwort && !letzter && !grammatikAus ? JSON.stringify(werkzeugSchema({ nurKern: st.kern })) : null;
    const anfrage = { messages: senden, temperature: w.denken ? 0.6 : 0.2, top_p: 0.9, max_tokens: w.token, extra_body: { enable_thinking: !!w.denken && !letzter } };
    let ausgabe = '';
    let leser = stromLeser(melden);
    const strom = (stueck) => { ausgabe += stueck; leser(stueck); };
    let r;
    try {
      r = await motor.antworten(format ? { ...anfrage, response_format: { type: 'json_object', schema: format } } : anfrage, strom);
    } catch (e) {
      if (!format || e?.code !== 'KI_GRAMMATIK') throw e;
      // Die Laufzeit kann die Grammatik nicht übersetzen: für diese Sitzung ohne, die Aufrufe repariert dann aufrufLesen.
      grammatikAus = true;
      ausgabe = '';
      leser = stromLeser(melden);
      r = await motor.antworten(anfrage, strom);
    }
    if (r?.nutzung) melden({ typ: 'messung', nutzung: r.nutzung });
    // Wörtlich, wie die Laufzeit die Antwort kennt (samt leerem Denkblock), sonst liest sie beim nächsten Mal alles neu.
    const roh = typeof r?.nachricht === 'string' ? r.nachricht : ausgabe;
    stand = [...senden, { role: 'assistant', content: roh }];
    if (abbruch.abgebrochen) break;
    const z = zerlegen(roh);
    if (z.gedanken) melden({ typ: 'gedanken', text: z.gedanken });

    if (z.aufrufe.length && !letzter) {
      werkzeugGerufen = true;
      if (i === 0 && regelnVorrang && !z.aufrufe.some((a) => a.name === d.werkzeug)) {
        melden({ typ: 'rueckfall' });
        return mitRueckfall(regelAntwort(true));
      }
      // Was das Modell an Zeit, Datum, Uhrzeit, Betrag und Namen nennt, muss aus der Frage stammen.
      // Kleine Modelle: Hat die sichere Regel dasselbe Werkzeug, gelten ihre Angaben (gemessen: „Café hat bezahlt“ → Name und Nummer aus dem Beispiel).
      const aufrufe = z.aufrufe.slice(0, 3).map((a) => {
        // Felder, die das Werkzeug nicht kennt, fallen weg (gemessen: „datum“ beim Tagesüberblick).
        const bekannt = werkzeug(a.name)?.parameter;
        const nurBekannte = bekannt ? Object.fromEntries(Object.entries(a.argumente || {}).filter(([k]) => k in bekannt)) : a.argumente;
        const geerdet = erden(a.name, nurBekannte, frage, heute, d, bezug);
        if (!(regelnVorrang && a.name === d.werkzeug)) return { ...a, argumente: geerdet };
        return { ...a, argumente: { ...d.argumente, ...Object.fromEntries(Object.entries(geerdet).filter(([k]) => !(k in d.argumente))) } };
      });
      const runde = aufrufe.map((a) => werkzeugLaufen(a.name, a.argumente));
      nachrichten.push({ role: 'assistant', content: roh });
      // Vorschläge und Sprünge brauchen keinen weiteren Satz vom Modell; bei „Schnell“ schreibt Kontovia die Antwort.
      if (runde.every((e) => e.art !== 'lesen') || !w.antwort) {
        antwortText = runde.map((e) => e.text).filter(Boolean).join(' ');
        nachtrag = nachtragVon(runde);
        ende = 'werkzeug';
        break;
      }
      nachrichten.push({ role: 'user', content: runde.map((e) => antwortFuerModell(e, maxErgebnis)).join('\n') });
      continue;
    }

    antwortText = z.text;
    ende = 'text';
    break;
  }

  if (abbruch.abgebrochen) return { text: antwortText || 'Abgebrochen.', ergebnisse, denkweise: weise, rueckfall: false, schritte, quelle: 'modell', gespraech: null };

  // Rohes JSON ist keine Antwort: dann die geprüften Sätze der Werkzeuge, ohne Werkzeug die Regeln.
  if (istRohesJson(antwortText)) antwortText = werkzeugGerufen ? ergebnisse.map((e) => e.text).filter(Boolean).join(' ') : '';
  // Kein Werkzeug, aber Beträge in der Antwort: erfunden. Oder gar keine Antwort. Oder eine sicher
  // erkannte Frage ganz ohne Werkzeug beantwortet (gemessen: Kontostände aus dem Kopf). Dann die festen Regeln.
  if ((!werkzeugGerufen && (hatBetrag(antwortText) || !antwortText.trim() || regelnSicher)) || (!antwortText.trim() && !ergebnisse.length)) {
    if (d) {
      melden({ typ: 'rueckfall' });
      return mitRueckfall(regelAntwort(true));
    }
    if (!antwortText.trim()) antwortText = NICHT_VERSTANDEN;
  }
  if (!antwortText.trim()) antwortText = ergebnisse.map((e) => e.text).filter(Boolean).join(' ') || NICHT_VERSTANDEN;
  // Beträge, die in keinem Ergebnis stehen, sind erfunden: Dann zählen nur die geprüften Sätze der Werkzeuge.
  if (werkzeugGerufen && fremdeBetraege(antwortText, ergebnisse).length) {
    melden({ typ: 'rueckfall' });
    const geprueft = ergebnisse.map((e) => e.text).filter(Boolean).join(' ');
    return mitRueckfall({ text: `${geprueft}\n\nDie Antwort des Modells enthielt Beträge, die nicht aus Ihren Buchungen stammen. Sie sehen deshalb nur die geprüften Werte.`, ergebnisse, rueckfall: true, quelle: 'regeln' });
  }
  const weiter = ende && stand ? { system: sys, stufe: st.id, nachrichten: stand.slice(1), nachtrag } : null;
  return { text: antwortText.trim(), ergebnisse, denkweise: weise, rueckfall: false, schritte, quelle: 'modell', gespraech: weiter };
}

/** Kurzfassung der Ergebnisse für den Verlauf (damit „und im April?“ verstanden wird). */
export function verlaufKurz(ergebnisse) {
  return ergebnisse.map((e) => `${e.name}: ${e.text}`).join(' ').slice(0, 400);
}
