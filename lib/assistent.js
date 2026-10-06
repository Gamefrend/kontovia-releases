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
 * Das Modell selbst erreicht diese Datei nur über `motor` (api.ki), und es
 * bekommt nur, was hier für die Frage zusammengestellt wird. Der Verlauf
 * lebt im Speicher der Oberfläche und verschwindet beim Sperren.
 */

import { deuten, zeitraumLesen, alleZeitraeume, uhrzeitLesen, betragLesen, ohneZeit } from './assistentdeutung.js';
import { norm } from './util.js';
import { ausfuehren } from './assistentwerkzeuge.js';
import { anweisung, tokenSchaetzen } from './assistentwissen.js';
import { stufe, DENKWEISEN, denkweiseWaehlen } from './assistentmodelle.js';

/** Befehle, die ohne Modell schneller und genauer gehen. */
const OHNE_MODELL = new Set(['oeffnen', 'rechnen', 'steuer_rechnen', 'faehigkeiten']);

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
  // Manche kleinen Modelle schreiben den Aufruf ohne Hülle hin.
  if (!aufrufe.length && /^\s*\{[\s\S]*"name"\s*:/.test(text)) {
    const a = aufrufLesen(text);
    if (a) { aufrufe.push(a); text = ''; }
  }
  return { gedanken, aufrufe, text, roh: s.trim() };
}

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

/** Verlauf als Nachrichten, die neuesten zuerst gekürzt, damit alles in den Kontext passt. */
function verlaufNachrichten(verlauf, max) {
  return (verlauf || []).slice(-max).flatMap((v) => [
    { role: 'user', content: v.frage },
    { role: 'assistant', content: `${v.antwort}${v.kurz ? `\n(${v.kurz})` : ''}` },
  ]);
}

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

/**
 * Erdet die Angaben eines Modells an der Frage. Kleine Modelle übernehmen
 * gern Werte aus den Beispielen der Anweisung („letzte Woche“, „morgen“).
 * Zeitangaben, Uhrzeit und Betrag gelten deshalb nur, wenn die Frage sie
 * hergibt; sonst gilt, was in der Frage steht, oder die Vorgabe des Werkzeugs.
 * Suchwörter und Titel bleiben dem Modell (dort helfen andere Schreibweisen).
 */
export function erden(name, argumente, frage, heute, deutung = null) {
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
 * @returns {Promise<{text:string, ergebnisse:Array<object>, denkweise:string, rueckfall:boolean, schritte:number, quelle:'regeln'|'modell'}>}
 */
export async function beantworten({ frage, verlauf = [], stufeId, denkweise = 'auto', db, heute, privat = false, nutzer = {}, motor = null, melden = () => {}, abbruch = { abgebrochen: false } }) {
  const st = stufe(stufeId);
  const d = deuten(frage, { heute, db });
  const ergebnisse = [];
  const werkzeugLaufen = (name, argumente) => {
    const e = ausfuehren(db, name, argumente, { heute, privat });
    ergebnisse.push(e);
    melden({ typ: 'werkzeug', name, argumente, ergebnis: e });
    return e;
  };
  const regelAntwort = (rueckfall) => {
    if (!d) return { text: NICHT_VERSTANDEN, ergebnisse, denkweise: 'regeln', rueckfall, schritte: 0, quelle: 'regeln' };
    const e = werkzeugLaufen(d.werkzeug, d.argumente);
    return { text: e.text || NICHT_VERSTANDEN, ergebnisse, denkweise: 'regeln', rueckfall, schritte: 1, quelle: 'regeln' };
  };

  // Stufe Basis, oder kein Modell bereit.
  if (!st.modell || !motor) return regelAntwort(false);

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
  if (d?.sicher && OHNE_MODELL.has(d.werkzeug) && weise !== 'gruendlich') return { ...regelAntwort(false), denkweise: weise };
  if (auto && regelnSicher && weise === 'schnell') return { ...regelAntwort(false), denkweise: weise };
  // Kleine Modelle: Widerspricht ihr Werkzeug einer sicheren Regel, gilt die Regel.
  const regelnVorrang = regelnSicher && (st.kern || st.id === 'standard');

  const kontext = st.kontext;
  const maxErgebnis = st.kern ? 1100 : 2400;
  const sys = anweisung({ stufeId: st.id, heute, settings: db.settings || {}, rolle: nutzer.rolle || '', kannSchreiben: nutzer.kannSchreiben !== false, schnell: !w.antwort });
  const nachrichten = [{ role: 'system', content: sys }, ...verlaufNachrichten(verlauf, st.kern ? 1 : st.id === 'standard' ? 2 : 4), { role: 'user', content: frage }];
  // Passt es nicht in den Kontext, fällt der älteste Verlauf weg.
  while (nachrichten.length > 2 && tokenSchaetzen(nachrichten.map((n) => n.content).join('')) + w.token + 200 > kontext) nachrichten.splice(1, 2);

  let schritte = 0;
  let antwortText = '';
  let werkzeugGerufen = false;
  for (let i = 0; i < w.schritte + 1 && !abbruch.abgebrochen; i++) {
    const letzter = i === w.schritte;
    schritte++;
    let ausgabe = '';
    const leser = stromLeser(melden);
    const r = await motor.antworten({
      messages: letzter ? [...nachrichten, { role: 'user', content: 'Antworte jetzt kurz mit dem, was du hast, ohne weitere Werkzeuge.' }] : nachrichten,
      temperature: w.denken ? 0.6 : 0.2,
      top_p: 0.9,
      max_tokens: w.token,
      extra_body: { enable_thinking: !!w.denken && !letzter },
    }, (stueck) => { ausgabe += stueck; leser(stueck); });
    if (r?.nutzung) melden({ typ: 'messung', nutzung: r.nutzung });
    if (abbruch.abgebrochen) break;
    const z = zerlegen(ausgabe);
    if (z.gedanken) melden({ typ: 'gedanken', text: z.gedanken });

    if (z.aufrufe.length && !letzter) {
      werkzeugGerufen = true;
      if (i === 0 && regelnVorrang && !z.aufrufe.some((a) => a.name === d.werkzeug)) {
        melden({ typ: 'rueckfall' });
        return { ...regelAntwort(true), denkweise: weise, schritte };
      }
      // Was das Modell an Zeit, Datum, Uhrzeit und Betrag nennt, muss aus der Frage stammen.
      const aufrufe = z.aufrufe.slice(0, 3).map((a) => ({ ...a, argumente: erden(a.name, a.argumente, frage, heute, d) }));
      z.aufrufe = aufrufe;
      const runde = aufrufe.map((a) => werkzeugLaufen(a.name, a.argumente));
      nachrichten.push({ role: 'assistant', content: z.aufrufe.slice(0, 3).map((a) => `<tool_call>\n${JSON.stringify({ name: a.name, arguments: a.argumente })}\n</tool_call>`).join('\n') });
      nachrichten.push({ role: 'user', content: runde.map((e) => antwortFuerModell(e, maxErgebnis)).join('\n') });
      // Vorschläge und Sprünge brauchen keinen weiteren Satz vom Modell; bei „Schnell“ schreibt Kontovia die Antwort.
      if (runde.every((e) => e.art !== 'lesen') || !w.antwort) {
        antwortText = runde.map((e) => e.text).filter(Boolean).join(' ');
        break;
      }
      continue;
    }

    antwortText = z.text;
    break;
  }

  if (abbruch.abgebrochen) return { text: antwortText || 'Abgebrochen.', ergebnisse, denkweise: weise, rueckfall: false, schritte, quelle: 'modell' };

  // Kein Werkzeug, aber Beträge in der Antwort: erfunden. Oder gar keine Antwort. Dann die festen Regeln.
  if ((!werkzeugGerufen && (hatBetrag(antwortText) || !antwortText.trim())) || (!antwortText.trim() && !ergebnisse.length)) {
    if (d) {
      melden({ typ: 'rueckfall' });
      const r = regelAntwort(true);
      return { ...r, denkweise: weise, schritte };
    }
    if (!antwortText.trim()) antwortText = NICHT_VERSTANDEN;
  }
  if (!antwortText.trim()) antwortText = ergebnisse.map((e) => e.text).filter(Boolean).join(' ') || NICHT_VERSTANDEN;
  // Beträge, die in keinem Ergebnis stehen, sind erfunden: Dann zählen nur die geprüften Sätze der Werkzeuge.
  if (werkzeugGerufen && fremdeBetraege(antwortText, ergebnisse).length) {
    melden({ typ: 'rueckfall' });
    const geprueft = ergebnisse.map((e) => e.text).filter(Boolean).join(' ');
    return { text: `${geprueft}\n\nDie Antwort des Modells enthielt Beträge, die nicht aus Ihren Buchungen stammen. Sie sehen deshalb nur die geprüften Werte.`, ergebnisse, denkweise: weise, rueckfall: true, schritte, quelle: 'regeln' };
  }
  return { text: antwortText.trim(), ergebnisse, denkweise: weise, rueckfall: false, schritte, quelle: 'modell' };
}

/** Kurzfassung der Ergebnisse für den Verlauf (damit „und im April?“ verstanden wird). */
export function verlaufKurz(ergebnisse) {
  return ergebnisse.map((e) => `${e.name}: ${e.text}`).join(' ').slice(0, 400);
}
