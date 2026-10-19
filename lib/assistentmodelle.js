/**
 * Kontovia – Assistent: Stufen, Denkweisen und welche zum Gerät passt.
 *
 * Die Stufen reichen von „Basis“ (feste Regeln, kein Download, jedes Gerät)
 * bis „Maximal“ (größtes Modell, nur für starke Rechner). Alle Modelle
 * stammen aus einer Familie (Qwen3): dieselbe Anleitung, dieselben Werkzeuge,
 * nur mehr oder weniger Verständnis. Die genauen Fassungen und Prüfsummen
 * stehen in src/web/kimodelle.js.
 *
 * Denkweise: „Schnell“ wählt nur das Werkzeug, die Antwort schreibt Kontovia
 * selbst; „Ausgewogen“ lässt das Modell die Antwort formulieren; „Gründlich“
 * lässt es vorher nachdenken und mehrere Schritte gehen. „Automatisch“
 * entscheidet je Frage.
 *
 * Welche Stufe ein Gerät schafft, wird geschätzt (empfehlen) und nach dem
 * ersten Start gemessen (messungBewerten). Beides bleibt nur auf dem Gerät
 * (prefs.js), nicht im Tresor: Jedes Gerät hat seine eigene Stufe.
 */

/**
 * @typedef {{id:string, name:string, kurz:string, beschreibung:string, modell:string|null, downloadMB:number,
 *   grafikMB:number, kontext:number, denken:boolean, kern:boolean, sql?:boolean, fuer:string}} Stufe
 */

import { dz } from './util.js';

/** @type {Stufe[]} */
export const STUFEN = [
  {
    id: 'basis', name: 'Basis', kurz: 'Ohne Download', modell: null, downloadMB: 0, grafikMB: 0, kontext: 0, denken: false, kern: true,
    fuer: 'Jedes Gerät',
    beschreibung: 'Versteht feste Fragen und Befehle wie „Was ist offen?“ oder „Öffne Mahnungen“. Sofort bereit, ohne Download.',
  },
  {
    id: 'mini', name: 'Mini', kurz: '0,6 Mrd. Parameter', modell: 'Qwen3-0.6B-q4f16_1-MLC', downloadMB: 350, grafikMB: 1400, kontext: 4096, denken: false, kern: true,
    fuer: 'Telefon, Tablet, ältere Rechner',
    beschreibung: 'Versteht freie Formulierungen bei einfachen Fragen. Klein und schnell, aber leicht zu verwirren.',
  },
  {
    id: 'standard', name: 'Standard', kurz: '1,7 Mrd. Parameter', modell: 'Qwen3-1.7B-q4f16_1-MLC', downloadMB: 990, grafikMB: 2500, kontext: 8192, denken: true, kern: false,
    fuer: 'Die meisten Laptops und PCs',
    beschreibung: 'Der beste Kompromiss: versteht die meisten Fragen, sucht mit eigenen Worten und schreibt kurze Antworten.',
  },
  {
    id: 'gross', name: 'Groß', kurz: '4 Mrd. Parameter', modell: 'Qwen3-4B-q4f16_1-MLC', downloadMB: 2290, grafikMB: 4050, kontext: 8192, denken: true, kern: false, sql: true,
    fuer: 'PCs mit eigener Grafikkarte, neuere Macs',
    beschreibung: 'Versteht auch verschachtelte Fragen, verbindet mehrere Schritte und erklärt Ergebnisse besser.',
  },
  {
    id: 'maximal', name: 'Maximal', kurz: '8 Mrd. Parameter', modell: 'Qwen3-8B-q4f16_1-MLC', downloadMB: 4640, grafikMB: 6450, kontext: 8192, denken: true, kern: false, sql: true,
    fuer: 'Starke Grafikkarten ab 8 GB',
    beschreibung: 'Das gründlichste Modell. Lohnt sich nur auf sehr starken Rechnern, sonst wird es langsam.',
  },
];

export const stufe = (id) => STUFEN.find((s) => s.id === id) || STUFEN[0];
export const STUFEN_REIHE = STUFEN.map((s) => s.id);

/**
 * Denkweisen. `schritte`: wie oft das Modell nacheinander Werkzeuge rufen darf;
 * `antwort`: ob das Modell die Antwort schreibt (sonst Kontovia aus dem Ergebnis);
 * `denken`: Nachdenken vor der Antwort; `token`: höchstens so viel Text je Schritt.
 *
 * `werkzeug` und `satz` sind die Abtastwerte (Sampling) für die Schritte, in
 * denen das Modell ein Werkzeug wählt, und für den Satz am Ende. Werkzeug-
 * aufrufe sind JSON: Dort soll das Modell kaum würfeln (niedrige Temperatur,
 * kein Wiederholungsabschlag, der Anführungszeichen und Doppelpunkte träfe).
 * Beim Nachdenken gelten die Werte, die Qwen3 für den Denkmodus empfiehlt
 * (Temperatur 0,6, top_p 0,95, ein Anwesenheitsabschlag gegen Endlosschleifen);
 * ohne Nachdenken etwas kühler als die Empfehlung (0,7), weil die Antworten
 * Zahlen tragen und keine Prosa sind. Gemessen 06./07.10.2026 mit Qwen3 1,7B
 * und 4B: Bei 0,2 und darunter trifft der Werkzeugaufruf fast immer, bei 0,7
 * tauchen erfundene Zeiträume und Beträge auf.
 */
export const DENKWEISEN = {
  auto: { name: 'Automatisch', beschreibung: 'Entscheidet je Frage: einfache schnell, schwierige gründlich.' },
  schnell: {
    name: 'Schnell', beschreibung: 'Wählt nur das passende Werkzeug. Die Antwort kommt direkt aus Ihren Zahlen.', schritte: 1, antwort: false, denken: false, token: 320,
    werkzeug: { temperature: 0.1, top_p: 0.8 }, satz: { temperature: 0.1, top_p: 0.8 },
  },
  ausgewogen: {
    name: 'Ausgewogen', beschreibung: 'Formuliert eine kurze Antwort und darf zwei, drei Schritte gehen.', schritte: 3, antwort: true, denken: false, token: 480,
    werkzeug: { temperature: 0.2, top_p: 0.8 }, satz: { temperature: 0.5, top_p: 0.9, presence_penalty: 0.3 },
  },
  gruendlich: {
    name: 'Gründlich', beschreibung: 'Denkt vorher nach und geht bis zu sechs Schritte. Langsamer.', schritte: 6, antwort: true, denken: true, token: 1400,
    werkzeug: { temperature: 0.6, top_p: 0.95, presence_penalty: 0.4 }, satz: { temperature: 0.6, top_p: 0.95, presence_penalty: 0.4 },
  },
};

/**
 * Nach dem Ende eines Werkzeugaufrufs darf das Modell aufhören: Der Rest wäre
 * Füllwerk (gemessen: kleine Modelle hängen gern einen Satz an, den niemand
 * sieht). Der Leser (assistent.js: zerlegen) kommt ohne die schließende Hülle aus.
 */
export const STOPP_NACH_WERKZEUG = Object.freeze(['</tool_call>']);

const SCHWIERIG = /\b(warum|wieso|weshalb|vergleich|vergleiche|unterschied|erkläre|erklaer|analys|bewerte|empfiehl|empfehlung|wie kann ich|was bedeutet|was heißt|plane|planung|prognose|entwicklung|trend|und dann|danach|außerdem|ausserdem)\b/i;

/**
 * Welche Denkweise „Automatisch“ für eine Frage wählt.
 * @param {string} frage
 * @param {{stufe:string, deutungSicher?:boolean}} k
 */
export function denkweiseWaehlen(frage, { stufe: s, deutungSicher = false }) {
  const st = stufe(s);
  const lang = String(frage || '').length > 140 || (String(frage).match(/\?/g) || []).length > 1;
  if (SCHWIERIG.test(frage) || lang) return st.denken && st.id !== 'standard' ? 'gruendlich' : 'ausgewogen';
  if (deutungSicher) return 'schnell';
  return 'ausgewogen';
}

/**
 * Schätzt aus den Angaben des Geräts (api.ki.geraet), welche Stufen gehen
 * und welche sich empfiehlt. Ohne Grafikchip bleibt nur „Basis“.
 * @param {{grafik:boolean, f16:boolean, ersatz:boolean, telefon:boolean, speicherGB:number|null, hersteller:string, bauart:string}} g
 * @returns {{moeglich:string[], empfohlen:string, grund:string}}
 */
export function empfehlen(g) {
  if (!g?.grafik || g.ersatz) {
    return { moeglich: ['basis'], empfohlen: 'basis', grund: 'Dieser Browser gibt den Grafikchip nicht frei. Ein Sprachmodell läuft hier nicht, die Stufe Basis schon.' };
  }
  const ram = Number(g.speicherGB) || 0;
  const herst = String(g.hersteller || '').toLowerCase();
  const eigeneKarte = /nvidia/.test(herst) || (/amd/.test(herst) && /rdna|gcn|vega/.test(String(g.bauart || '').toLowerCase()));
  const apple = /apple/.test(herst);
  if (g.telefon) {
    if (ram && ram <= 4) return { moeglich: ['basis', 'mini'], empfohlen: 'mini', grund: 'Telefon mit wenig Arbeitsspeicher: Mini passt.' };
    return { moeglich: ['basis', 'mini', 'standard'], empfohlen: 'mini', grund: 'Auf Telefonen ist Mini am flüssigsten. Standard geht auf neueren Geräten.' };
  }
  if (ram && ram <= 4) return { moeglich: ['basis', 'mini', 'standard'], empfohlen: 'mini', grund: 'Wenig Arbeitsspeicher: Mini läuft sicher, Standard mit Glück.' };
  if (eigeneKarte) return { moeglich: STUFEN_REIHE, empfohlen: 'gross', grund: 'Eigene Grafikkarte erkannt: Groß sollte flüssig laufen.' };
  if (apple) return { moeglich: STUFEN_REIHE, empfohlen: 'standard', grund: 'Mac mit eigenem Chip: Standard läuft flüssig, Groß meist auch.' };
  return { moeglich: STUFEN_REIHE, empfohlen: 'standard', grund: 'Für die meisten Rechner ist Standard der beste Kompromiss.' };
}

/**
 * Bewertet die gemessene Schreibgeschwindigkeit (Wörter je Sekunde, genauer:
 * Token) eines Modells: passt es, oder lohnt eine Stufe höher oder tiefer?
 * @returns {{urteil:'zu-langsam'|'passt'|'reserve', vorschlag:string|null, text:string}}
 */
export function messungBewerten(stufeId, tokenProSek) {
  const reihe = STUFEN_REIHE;
  const i = reihe.indexOf(stufeId);
  const v = Number(tokenProSek) || 0;
  if (!v || i < 1) return { urteil: 'passt', vorschlag: null, text: '' };
  if (v < 6) return { urteil: 'zu-langsam', vorschlag: reihe[i - 1] === 'basis' ? null : reihe[i - 1], text: 'Das Modell schreibt auf diesem Gerät sehr langsam. Eine kleinere Stufe antwortet schneller.' };
  if (v >= 35 && i < reihe.length - 1) return { urteil: 'reserve', vorschlag: reihe[i + 1], text: `Ihr Gerät hat Reserven. Die Stufe ${stufe(reihe[i + 1]).name} versteht mehr und sollte flüssig laufen.` };
  return { urteil: 'passt', vorschlag: null, text: '' };
}

/** „1,0 GB“ oder „350 MB“ */
export function groesseText(mb) {
  if (!mb) return 'kein Download';
  return mb >= 1000 ? `${dz((mb / 1000).toFixed(1))} GB` : `${mb} MB`;
}

/**
 * Mit dieser Leitung rechnet Kontovia die Dauer eines Downloads: übliches
 * Internet zu Hause (DSL oder Kabel). Eine Schätzung, kein Messwert.
 */
export const LEITUNG_MBIT = 50;

/** Wie lange der Download ungefähr dauert: „etwa 3 Minuten“ (bei LEITUNG_MBIT), ohne Download ''. */
export function downloadDauer(mb, mbit = LEITUNG_MBIT) {
  if (!mb) return '';
  const minuten = Math.max(1, Math.round((mb * 8) / mbit / 60));
  return minuten === 1 ? 'etwa 1 Minute' : `etwa ${minuten} Minuten`;
}
