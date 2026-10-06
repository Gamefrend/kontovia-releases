/**
 * Kontovia – feste Fassungen der Sprachmodelle für den Assistenten.
 *
 * Jedes Modell ist auf einen Stand gepinnt: die Gewichte auf einen Commit bei
 * Hugging Face (eine Fassung dort ändert sich nie), der Programmteil (WebGPU-
 * Bibliothek) auf einen Commit bei GitHub. Konfiguration, Tokenizer und
 * Programmteil prüft die Laufzeit zusätzlich gegen die Prüfsummen hier (SRI);
 * weicht eine ab, lädt das Modell nicht. Was nicht in dieser Liste steht,
 * lädt das Rechenwerk gar nicht (ki-worker.js).
 *
 * Wer die Modelle später von einem eigenen Server in der EU ausliefert,
 * ändert nur QUELLE und BIBLIOTHEK (und trägt den Host in netz.js:
 * MODELLQUELLEN ein). Die Prüfsummen bleiben gleich, solange die Dateien
 * dieselben sind.
 *
 * Familie: Qwen3 (Apache 2.0), quantisiert auf 4 Bit. q4f16 braucht einen
 * Grafikchip mit 16-Bit-Gleitkomma (shader-f16), sonst gilt q4f32.
 */

const QUELLE = 'https://huggingface.co/mlc-ai/';
const BIBLIOTHEK = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/';
const TOKENIZER = 'sha256-rrEzB6cazY/oGGHZStVKtonfdzMYgJ7tPL55S0SS2uQ=';

/**
 * Speicherbedarf auf dem Grafikchip in MB bei 4096 Zeichen Kontext (Angabe
 * von WebLLM); `kontext` erweitert ihn für die größeren Modelle.
 * @type {Record<string, {rev:string, lib:string, config:string, model_lib:string, vram:number, kontext:number}>}
 */
export const MODELLE = {
  'Qwen3-0.6B-q4f16_1-MLC': { rev: '8c14ce481d4c692769976ad52afea453a102df19', lib: 'Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm', config: 'sha256-GQpRxWuaB6jYchJm+ORZvNGxaJvN/ylHlc0r/6ID/y0=', model_lib: 'sha256-TbgAskEZIE4aA4booS4ITVASqmD3fFv/rTYvIEmN+RI=', vram: 1403, kontext: 4096 },
  'Qwen3-0.6B-q4f32_1-MLC': { rev: '9b4f0b05b08c692ea86fe151ea878406ad22f428', lib: 'Qwen3-0.6B-q4f32_1_cs1k-webgpu.wasm', config: 'sha256-5S/NMvOOqp2Ihv0+ng8PEzNCJnhKn9j02yrP//AWU88=', model_lib: 'sha256-Nh8TEK5haGO8y8Y48HX3SEgWtF6zD/7PCFOScqGyrh4=', vram: 1925, kontext: 4096 },
  'Qwen3-1.7B-q4f16_1-MLC': { rev: '80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc', lib: 'Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm', config: 'sha256-9ecmtQNj/6roPwY61A3bZzlOfaCQ0lHPVJpp1fiZ1Yo=', model_lib: 'sha256-gWGqpLQLzPGfztsvLowiHrnvty0hmGgfGVjJweBaaC8=', vram: 2037, kontext: 8192 },
  'Qwen3-1.7B-q4f32_1-MLC': { rev: 'bddd4d584cabe19113f7e4ff46fd9e73b4d3dc89', lib: 'Qwen3-1.7B-q4f32_1_cs1k-webgpu.wasm', config: 'sha256-8zsy82cfjzivLUXJwSXXSa/qqrhi0uYClW/t9bYPJXs=', model_lib: 'sha256-qAyg0kXtnOSSSXkYr9IewdQ904c7Y1kSVbAb2cQa32U=', vram: 2635, kontext: 8192 },
  'Qwen3-4B-q4f16_1-MLC': { rev: 'a5c9fab855e3ccbdfed2e7e69683d75f30332161', lib: 'Qwen3-4B-q4f16_1_cs1k-webgpu.wasm', config: 'sha256-lyasfbzZBHX4BFYEvghi7xtIN+QyxQBNoguKbjSDMNo=', model_lib: 'sha256-qYalPJJXlxTrfsNoVgBPX7dScsn2kJHxTrayCG7qREA=', vram: 3432, kontext: 8192 },
  'Qwen3-4B-q4f32_1-MLC': { rev: 'b7e4eb1ba80728187fb5df44055cc1a7c32310e0', lib: 'Qwen3-4B-q4f32_1_cs1k-webgpu.wasm', config: 'sha256-/RNSioxgB2ccVQdqcYHEykQbE16/vNJGCNsK8H9IXKM=', model_lib: 'sha256-1K1rFCkC9V1yRIDHhSdFFs/HLivxZ4xalBhFxCfcd7I=', vram: 4328, kontext: 8192 },
  'Qwen3-8B-q4f16_1-MLC': { rev: 'b3d55c289eae58f77095f5b68c895eeea358ee09', lib: 'Qwen3-8B-q4f16_1_cs1k-webgpu.wasm', config: 'sha256-l7y+KOBlgNQQ9dXaHAQ+wP0+9RPD2FP8IkIN24mmYJg=', model_lib: 'sha256-v2OE2bMNauHspWfGWokyhK4iKP1XpDLDt5XQaoA9m3I=', vram: 5696, kontext: 8192 },
  'Qwen3-8B-q4f32_1-MLC': { rev: '34026572351006ba1865d11319309b151d9ccf16', lib: 'Qwen3-8B-q4f32_1_cs1k-webgpu.wasm', config: 'sha256-y2QgyLTp4/BzsYHLWPlAOvbpJ3e55uKffmoG04VsQtY=', model_lib: 'sha256-fM+0bb1lgT7GdGsZIP1WusAfY3jqVaChidvEH3vJ5u4=', vram: 6853, kontext: 8192 },
};

/** Ein Eintrag im Format der Laufzeit (WebLLM: ModelRecord). */
export function modellEintrag(id) {
  const m = MODELLE[id];
  if (!m) return null;
  return {
    model: `${QUELLE}${id}/resolve/${m.rev}/`,
    model_id: id,
    model_lib: BIBLIOTHEK + m.lib,
    vram_required_MB: m.vram,
    low_resource_required: m.vram < 2500,
    overrides: { context_window_size: m.kontext },
    integrity: { config: m.config, model_lib: m.model_lib, tokenizer: { 'tokenizer.json': TOKENIZER }, onFailure: 'error' },
  };
}

/** Die Konfiguration für die Laufzeit: nur die Modelle dieser Liste, Ablage im Cache des Browsers. */
export function laufzeitKonfiguration() {
  return { model_list: Object.keys(MODELLE).map(modellEintrag), cacheBackend: 'cache' };
}
