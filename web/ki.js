/**
 * Kontovia – Assistent: Verbindung zum Rechenwerk und Blick auf das Gerät.
 *
 * Startet den Worker (ki-worker.js) erst, wenn der Assistent ein Modell
 * braucht, und reicht Anfragen hin und Text zurück. Dazu die Einschätzung, was
 * das Gerät kann (Grafikchip, 16-Bit-Rechnen, Telefon, Arbeitsspeicher), und
 * wie viel Platz die Modelle im Browser belegen.
 *
 * Hier liegen keine Daten: Was das Modell zu sehen bekommt, stellt
 * lib/assistent.js für jede Frage neu zusammen.
 */

import { MODELLE } from './kimodelle.js';

let worker = null;
let naechste = 1;
/** Offene Aufträge: id → {aufloesen, ablehnen, beiTeil, beiFortschritt} */
const auftraege = new Map();
let gestartet = '';
let laedt = null;

function werk() {
  if (worker) return worker;
  worker = new Worker(new URL('./ki-worker.js', import.meta.url), { type: 'module', name: 'kontovia-assistent' });
  worker.addEventListener('message', (ev) => {
    const n = ev.data || {};
    const a = auftraege.get(n.id);
    if (!a) return;
    if (n.art === 'teil') a.beiTeil?.(n.text);
    else if (n.art === 'fortschritt') a.beiFortschritt?.({ anteil: n.anteil, text: n.text, sekunden: n.sekunden });
    else if (n.art === 'fehler') {
      auftraege.delete(n.id);
      const e = new Error(n.text);
      e.code = /WebGPU|GPU|adapter|device/i.test(n.text) ? 'KI_GRAFIK' : /Integrity|integrity/i.test(n.text) ? 'KI_PRUEFSUMME'
        : /fetch|network|Gegenstelle|Failed to fetch/i.test(n.text) ? 'KI_NETZ' : 'KI_FEHLER';
      a.ablehnen(e);
    } else {
      auftraege.delete(n.id);
      a.aufloesen(n);
    }
  });
  worker.addEventListener('error', (ev) => {
    // Bricht der Worker ganz ab, scheitern alle offenen Aufträge; der nächste startet ihn neu.
    for (const a of auftraege.values()) a.ablehnen(new Error(ev.message || 'Der Assistent ist abgestürzt.'));
    auftraege.clear();
    worker = null;
    gestartet = '';
  });
  return worker;
}

function auftrag(nachricht, rueckrufe = {}) {
  const id = naechste++;
  return new Promise((aufloesen, ablehnen) => {
    auftraege.set(id, { aufloesen, ablehnen, ...rueckrufe });
    werk().postMessage({ ...nachricht, id });
  });
}

/* -------------------------------------------------------------------------- */
/* Gerät                                                                       */
/* -------------------------------------------------------------------------- */

let geraetGemerkt = null;

/**
 * Was das Gerät für den Assistenten mitbringt. Lädt nichts herunter.
 * @returns {Promise<{grafik:boolean, f16:boolean, ersatz:boolean, telefon:boolean, speicherGB:number|null,
 *   hersteller:string, bauart:string, puffer:number, kerne:number, sparen:boolean}>}
 */
export async function geraet() {
  if (geraetGemerkt) return geraetGemerkt;
  const ua = navigator.userAgent || '';
  const telefon = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const g = {
    grafik: false, f16: false, ersatz: false, telefon: !!telefon,
    speicherGB: Number(navigator.deviceMemory) || null,
    hersteller: '', bauart: '', puffer: 0,
    kerne: Number(navigator.hardwareConcurrency) || 0,
    sparen: !!navigator.connection?.saveData,
  };
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter) {
      g.grafik = true;
      g.f16 = adapter.features.has('shader-f16');
      g.ersatz = !!(adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter);
      g.hersteller = String(adapter.info?.vendor || '');
      g.bauart = String(adapter.info?.architecture || '');
      g.puffer = Number(adapter.limits?.maxBufferSize) || 0;
    }
  } catch { /* ohne Grafikchip bleibt der Assistent bei festen Regeln */ }
  geraetGemerkt = g;
  return g;
}

/** Welche Fassung eines Modells zu diesem Gerät passt (16 oder 32 Bit). */
export function fassung(modell, f16) {
  const id = f16 ? modell : modell.replace('q4f16_1', 'q4f32_1');
  return MODELLE[id] ? id : modell;
}

/* -------------------------------------------------------------------------- */
/* Modelle                                                                     */
/* -------------------------------------------------------------------------- */

/** Welche der genannten Modelle schon auf dem Gerät liegen: {id: true|false}. */
export async function imCache(modelle) {
  const r = await auftrag({ art: 'imCache', modelle: modelle.filter((m) => MODELLE[m]) });
  return r.da || {};
}

/**
 * Lädt ein Modell (beim ersten Mal aus dem Netz) und startet es.
 * @param {string} modell  Kennung aus kimodelle.js
 * @param {(p:{anteil:number, text:string, sekunden:number})=>void} [beiFortschritt]
 */
export async function laden(modell, beiFortschritt) {
  if (!MODELLE[modell]) throw new Error('Dieses Modell kennt Kontovia nicht.');
  if (gestartet === modell) return { modell };
  if (laedt) await laedt.catch(() => {});
  // Ein Modell ist groß und teuer neu zu laden: den Browser bitten, es nicht bei Platzmangel zu räumen.
  try { await navigator.storage?.persist?.(); } catch { /* dann eben ohne Zusage */ }
  laedt = auftrag({ art: 'laden', modell }, { beiFortschritt });
  try {
    await laedt;
    gestartet = modell;
  } finally {
    laedt = null;
  }
  return { modell };
}

/**
 * Eine Antwort des gestarteten Modells.
 * @param {object} anfrage  {messages, temperature, top_p, max_tokens, extra_body}
 * @param {(text:string)=>void} [beiTeil]  jedes neue Stück Text
 * @returns {Promise<{ende:string, nutzung:object|null}>}
 */
export async function antworten(anfrage, beiTeil) {
  if (!gestartet) throw Object.assign(new Error('Es ist kein Modell gestartet.'), { code: 'KI_NICHT_GESTARTET' });
  const r = await auftrag({ art: 'chat', anfrage }, { beiTeil });
  return { ende: r.ende || '', nutzung: r.nutzung || null };
}

export function abbrechen() { worker?.postMessage({ art: 'abbrechen' }); }

/** Verwirft den Gesprächsstand im Modell, etwa beim Sperren. */
export function vergessen() { worker?.postMessage({ art: 'vergessen' }); }

/** Gibt den Grafikspeicher frei; das Modell bleibt auf dem Gerät. */
export async function entladen() {
  if (!worker) return;
  await auftrag({ art: 'entladen' }).catch(() => {});
  gestartet = '';
}

/** Entfernt ein Modell vom Gerät. */
export async function loeschen(modell) {
  await auftrag({ art: 'loeschen', modell });
  if (gestartet === modell) gestartet = '';
}

export const status = () => ({ gestartet, laedt: !!laedt });

/** Belegter und verfügbarer Speicher des Browsers für diese Seite, in Bytes. */
export async function speicher() {
  try {
    const s = await navigator.storage?.estimate?.();
    return { belegt: Number(s?.usage) || 0, frei: Math.max(0, (Number(s?.quota) || 0) - (Number(s?.usage) || 0)) };
  } catch {
    return { belegt: 0, frei: 0 };
  }
}
