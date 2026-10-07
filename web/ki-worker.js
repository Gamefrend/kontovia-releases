/**
 * Kontovia – Rechenwerk des Assistenten (eigener Worker).
 *
 * Hier läuft das Sprachmodell auf dem Grafikchip, abseits der Oberfläche,
 * damit sie beim Rechnen nicht stockt. Der Worker kennt keine Buchhaltung:
 * Er bekommt fertige Nachrichten (lib/assistent.js) und schickt Text zurück.
 * Er sieht nur, was die Oberfläche ihm für eine Frage gibt, und behält nichts
 * davon über ein „vergessen“ hinaus.
 *
 * Netz: Die CSP der Seite gilt in einem Worker nicht. Deshalb ersetzt diese
 * Datei vor allem anderen fetch durch eine Sperre: Nur die Modellquellen aus
 * netz.js (modellAdresseErlaubt) gehen durch, auch nach einer Weiterleitung.
 * Gebraucht wird das Netz nur beim ersten Laden eines Modells; danach liegt
 * alles im Cache des Browsers.
 *
 * Nachrichten (von ki.js):
 *   {art:'laden', id, modell}        lädt oder startet ein Modell aus kimodelle.js
 *   {art:'chat', id, anfrage}        eine Antwort, Stück für Stück ({art:'teil'}), dann {art:'fertig'}
 *                                    mit `nachricht`: der Antwort, wie die Laufzeit sie sich merkt.
 *                                    Beginnt die nächste Anfrage mit genau diesem Verlauf, liest die
 *                                    Laufzeit nur das Neue ein (sonst alles von vorn).
 *   {art:'abbrechen'}                bricht die laufende Antwort ab
 *   {art:'vergessen'}                verwirft den Gesprächsstand im Modell
 *   {art:'entladen', id}             gibt den Grafikspeicher frei
 *   {art:'imCache', id, modelle}     welche Modelle schon auf dem Gerät liegen
 *   {art:'loeschen', id, modell}     entfernt ein Modell vom Gerät
 * Von sich aus meldet er {art:'verloren'}, wenn der Grafikchip abgestürzt
 * und das Modell damit weg ist.
 */

import { modellAdresseErlaubt } from './netz.js';
import { MODELLE, laufzeitKonfiguration } from './kimodelle.js';

const echtesFetch = self.fetch.bind(self);
self.fetch = async (eingabe, init = {}) => {
  const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe?.url;
  if (!modellAdresseErlaubt(url)) throw new Error(`Diese Gegenstelle ist nicht freigegeben: ${url}`);
  const res = await echtesFetch(eingabe, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (res.redirected && !modellAdresseErlaubt(res.url)) throw new Error('Weiterleitung zu einer nicht freigegebenen Gegenstelle.');
  return res;
};

/** Die Laufzeit (6 MB) erst laden, wenn sie gebraucht wird. */
let laufzeit = null;
const webllm = () => (laufzeit ??= import('./vendor/web-llm.js'));

let motor = null;
let geladen = '';

const melden = (nachricht) => self.postMessage(nachricht);
const fehler = (id, e) => melden({ art: 'fehler', id, text: String(e?.message || e || 'Unbekannter Fehler'), name: e?.name || '', code: e?.code || '' });

/**
 * Hängt der Grafikchip, setzt der Treiber ihn zurück (Windows nach gut 2 s,
 * AMD zeigt dazu einen eigenen Fehlerbericht). Der Browser meldet das Gerät
 * dann als verloren, und WebLLM räumt das Modell weg, auch mitten in einer
 * Antwort („Tokenizer instance already deleted“, danach „Model not loaded“).
 * Damit das erkennbar ist, bekommt jedes Gerät, das die Laufzeit holt, einen
 * Wächter. „destroyed“ ist das eigene Aufräumen (entladen, Modellwechsel).
 */
let verloren = false;
const echtesGeraet = self.GPUAdapter?.prototype?.requestDevice;
if (echtesGeraet) {
  self.GPUAdapter.prototype.requestDevice = async function (...args) {
    const geraet = await echtesGeraet.apply(this, args);
    geraet.lost.then((info) => {
      if (info?.reason === 'destroyed') return;
      verloren = true;
      geladen = '';
      melden({ art: 'verloren' });
    });
    return geraet;
  };
}

/** Nach einem Absturz nicht gleich nochmal rechnen (das träfe den Treiber wieder); das Modell startet bei der nächsten Frage neu. */
const absturz = () => Object.assign(new Error('Der Grafikchip hat die Berechnung abgebrochen.'), { code: 'KI_ABSTURZ' });

async function laden(id, modell) {
  if (!MODELLE[modell]) throw new Error('Dieses Modell kennt Kontovia nicht.');
  const W = await webllm();
  if (!motor) {
    motor = new W.MLCEngine({
      appConfig: laufzeitKonfiguration(),
      logLevel: 'WARN',
      initProgressCallback: (p) => melden({ art: 'fortschritt', id, anteil: Number(p.progress) || 0, text: String(p.text || ''), sekunden: Number(p.timeElapsed) || 0 }),
    });
  }
  if (geladen !== modell) {
    await motor.reload(modell);
    geladen = modell;
    verloren = false;
  }
  melden({ art: 'geladen', id, modell });
}

/** Die gerade laufende Antwort. WebLLM sperrt `resetChat` nicht dagegen: Mitten in einer Antwort räumt es deren Zwischenwerte weg („Object has already been disposed“). */
let laufend = null;

const entsorgt = (e) => /already been disposed|instance already deleted/i.test(String(e?.message || e));

async function chat(id, anfrage) {
  if (!motor || !geladen) throw verloren ? absturz() : new Error('Es ist kein Modell gestartet.');
  let gesendet = false;
  const einmal = async () => {
    const strom = await motor.chat.completions.create({ ...anfrage, stream: true, stream_options: { include_usage: true } });
    let nutzung = null;
    let ende = '';
    for await (const stueck of strom) {
      const text = stueck.choices?.[0]?.delta?.content || '';
      if (text) { gesendet = true; melden({ art: 'teil', id, text }); }
      if (stueck.choices?.[0]?.finish_reason) ende = stueck.choices[0].finish_reason;
      if (stueck.usage) nutzung = stueck.usage;
    }
    return { nutzung, ende };
  };
  let ergebnis;
  try {
    ergebnis = await einmal();
  } catch (e) {
    // Der Verlust des Geräts und der Fehler in der Antwort kommen nicht immer in fester Reihenfolge an.
    if (!verloren) await new Promise((r) => setTimeout(r, 100));
    if (verloren) throw absturz();
    if (!entsorgt(e)) throw e;
    // Die Laufzeit ist beschädigt: Modell neu starten (kommt aus dem Cache), und wenn noch nichts gesendet wurde, nochmal versuchen.
    await motor.reload(geladen);
    if (gesendet) throw e;
    ergebnis = await einmal();
  }
  const { nutzung, ende } = ergebnis;
  // Die Antwort genau so, wie sie im Gesprächsstand der Laufzeit steht (samt leerem
  // Denkblock). Nur wer sie wörtlich zurückgibt, bekommt das schon Eingelesene wieder.
  const nachricht = await motor.getMessage().catch(() => null);
  melden({
    art: 'fertig', id, ende, nachricht: typeof nachricht === 'string' ? nachricht : null,
    nutzung: nutzung ? {
      prompt: nutzung.prompt_tokens || 0,
      antwort: nutzung.completion_tokens || 0,
      einlesenProSek: Number(nutzung.extra?.prefill_tokens_per_s) || 0,
      schreibenProSek: Number(nutzung.extra?.decode_tokens_per_s) || 0,
    } : null,
  });
}

self.addEventListener('message', async (ev) => {
  const n = ev.data || {};
  try {
    if (n.art === 'laden') await laden(n.id, n.modell);
    else if (n.art === 'chat') {
      laufend = chat(n.id, n.anfrage);
      try { await laufend; } finally { laufend = null; }
    }
    else if (n.art === 'abbrechen') motor?.interruptGenerate();
    else if (n.art === 'vergessen') {
      if (laufend) await laufend.catch(() => {});
      if (motor && geladen) await motor.resetChat();
    }
    else if (n.art === 'entladen') {
      if (motor) await motor.unload();
      geladen = '';
      melden({ art: 'entladen', id: n.id });
    } else if (n.art === 'imCache') {
      const W = await webllm();
      const cfg = laufzeitKonfiguration();
      const da = {};
      for (const m of n.modelle || []) {
        if (MODELLE[m]) da[m] = await W.hasModelInCache(m, cfg).catch(() => false);
      }
      melden({ art: 'imCache', id: n.id, da });
    } else if (n.art === 'loeschen') {
      if (!MODELLE[n.modell]) throw new Error('Dieses Modell kennt Kontovia nicht.');
      if (geladen === n.modell && motor) { await motor.unload(); geladen = ''; }
      const W = await webllm();
      await W.deleteModelAllInfoInCache(n.modell, laufzeitKonfiguration()).catch(() => {});
      // Reste eines abgebrochenen oder unvollständigen Downloads gehören auch dazu.
      for (const name of ['webllm/model', 'webllm/config', 'webllm/wasm']) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (req.url.includes(`/${n.modell}/`) || req.url.endsWith(`/${MODELLE[n.modell].lib}`)) await cache.delete(req);
        }
      }
      melden({ art: 'geloescht', id: n.id });
    }
  } catch (e) {
    fehler(n.id, e);
  }
});
