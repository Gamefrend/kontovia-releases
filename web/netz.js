/**
 * Kontovia – ausgehende Verbindungen der Web-Fassung.
 *
 * Gegenstück zu src/main/net.js. Im Browser gibt es keinen getrennten
 * Hauptprozess; die Liste der erlaubten Gegenstellen steht deshalb zweimal:
 * hier und in der Content-Security-Policy der Seite (connect-src). Was dort
 * nicht steht, lässt schon der Browser nicht hinaus – auch nicht über eine
 * Weiterleitung.
 */

const ERLAUBT = new Set([
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
]);

export const HOSTS = [...ERLAUBT];

const MAX_BODY = 300 * 1024 * 1024;

function pruefen(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Ungültige Adresse.'); }
  if (u.protocol !== 'https:') throw new Error('Nur verschlüsselte Verbindungen sind erlaubt.');
  if (!ERLAUBT.has(u.hostname)) throw new Error(`Diese Gegenstelle ist nicht freigegeben: ${u.hostname}`);
  return u;
}

/**
 * HTTPS-Anfrage mit Zeitlimit, Größenbegrenzung und Fortschrittsmeldung.
 * @returns {Promise<{status:number, headers:object, body:Uint8Array}>}
 */
export async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 60000, onProgress = null, maxBytes = MAX_BODY } = opts;
  pruefen(url);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Keine Internetverbindung.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung bei der Verbindung.');
    throw new Error('Keine Verbindung zum Server.');
  }

  try {
    // Auch das Ziel einer Weiterleitung muss freigegeben sein.
    if (res.redirected) pruefen(res.url);
    const total = Number(res.headers.get('content-length') || 0);
    const chunks = [];
    let received = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          ctrl.abort();
          throw new Error('Antwort ist unerwartet groß – abgebrochen.');
        }
        chunks.push(value);
        if (onProgress) onProgress(received, total);
      }
    }
    const out = new Uint8Array(received);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    const flat = {};
    res.headers.forEach((v, k) => { flat[k.toLowerCase()] = v; });
    return { status: res.status, headers: flat, body: out };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung bei der Verbindung.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  const text = new TextDecoder().decode(res.body);
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  if (res.status >= 400) {
    const msg = data?.error?.message || data?.error_description || data?.message
      || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function form(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
