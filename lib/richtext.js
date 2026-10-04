/**
 * Kontovia – formatierter Text für Aufgaben, ohne Bezug zur Oberfläche.
 *
 * Der Text einer Aufgabe liegt als schlichtes HTML im Bestand. Damit daraus
 * nie Schadcode wird (auch nicht aus einem eingefügten Text oder einem Stand
 * vom anderen Gerät), läuft jeder Text vor dem Speichern und vor dem Anzeigen
 * durch `bereinigen`: Es bleiben nur ein paar Formatierungen übrig, alle
 * anderen Tags fallen weg, Attribute sind auf das Nötigste beschränkt.
 *
 * Bilder stehen als <img data-att="Belegkennung">. Die Datei liegt verschlüsselt
 * im Tresor wie jeder Beleg; erst die Anzeige setzt eine Adresse ein.
 */

const MAX_ZEICHEN = 200000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Wandelt Zeichenverweise (&amp;, &#39;, &#x27;) in Text zurück. */
function entschluesseln(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] === '#') {
      const code = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[k.toLowerCase()] ?? m;
  });
}

const maskieren = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Gleichbedeutende Tags auf die erlaubten abbilden. */
const UMBENENNEN = {
  b: 'strong', i: 'em', strike: 's', del: 's', div: 'p', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4',
};
const ERLAUBT = new Set(['p', 'br', 'strong', 'em', 'u', 's', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a', 'img']);
const LEER = new Set(['br', 'hr', 'img']);
/** Tags, deren Inhalt samt Tag verschwindet. */
const VERWERFEN = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'noscript', 'textarea', 'select', 'svg', 'math', 'head', 'title']);

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attribute(roh) {
  const out = {};
  for (const m of String(roh).matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = entschluesseln(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Nur Web-, Mail- und Telefonadressen sind als Link erlaubt. */
export function linkErlaubt(href) {
  // Zeichen, die ein Browser beim Lesen der Adresse übergeht, vorher entfernen.
  const s = [...String(href ?? '')].filter((c) => {
    const k = c.codePointAt(0);
    return k > 32 && !(k >= 127 && k <= 159) && !(k >= 0x200b && k <= 0x200f) && k !== 0x2028 && k !== 0x2029 && k !== 0xfeff;
  }).join('');
  return /^(https?:\/\/|mailto:|tel:)[^\s]+$/i.test(s) ? String(href).trim() : '';
}

function textStueck(s) {
  return s.replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Lässt von einem HTML-Text nur die erlaubten Formatierungen übrig.
 * @param {string} eingabe
 * @returns {string}
 */
export function bereinigen(eingabe) {
  const text = String(eingabe ?? '').slice(0, MAX_ZEICHEN);
  const out = [];
  const offen = [];
  let pos = 0;
  let verwerfen = null;

  for (const m of text.matchAll(TAG)) {
    const stueck = text.slice(pos, m.index);
    pos = m.index + m[0].length;
    if (!verwerfen && stueck) out.push(textStueck(stueck));
    if (m[0].startsWith('<!--')) continue;

    const schliessend = m[1] === '/';
    let name = m[2].toLowerCase();
    if (verwerfen) {
      if (schliessend && name === verwerfen) verwerfen = null;
      continue;
    }
    if (VERWERFEN.has(name)) {
      if (!schliessend && !/\/\s*$/.test(m[3])) verwerfen = name;
      continue;
    }
    name = UMBENENNEN[name] || name;
    if (!ERLAUBT.has(name)) continue;

    if (schliessend) {
      const i = offen.lastIndexOf(name);
      if (i < 0 || LEER.has(name)) continue;
      while (offen.length > i) out.push(`</${offen.pop()}>`);
      continue;
    }

    const a = attribute(m[3]);
    if (name === 'img') {
      const id = String(a['data-att'] || '');
      if (!/^[\w-]{1,80}$/.test(id)) continue;
      const w = Math.round(Number(a['data-w']));
      out.push(`<img data-att="${id}"${w >= 10 && w <= 100 ? ` data-w="${w}"` : ''} alt="${maskieren(String(a.alt || '').slice(0, 200))}">`);
      continue;
    }
    if (name === 'a') {
      const href = linkErlaubt(a.href);
      // Ohne brauchbares Ziel bleibt nur der Text.
      if (!href) continue;
      out.push(`<a href="${maskieren(href)}" target="_blank" rel="noopener noreferrer">`);
      offen.push('a');
      continue;
    }
    if (LEER.has(name)) { out.push(`<${name}>`); continue; }
    out.push(`<${name}>`);
    offen.push(name);
  }
  if (!verwerfen) {
    const rest = text.slice(pos);
    if (rest) out.push(textStueck(rest));
  }
  while (offen.length) out.push(`</${offen.pop()}>`);
  return out.join('');
}

const BLOCK_ENDE = /<\/(p|div|li|h[1-6]|blockquote|pre|ul|ol)>|<br\s*\/?>|<hr\s*\/?>/gi;

/** Der Text ohne jede Formatierung, Absätze als Zeilen. */
export function klartext(html) {
  const mitUmbruch = String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(BLOCK_ENDE, '\n')
    .replace(/<[^>]*>/g, '');
  return entschluesseln(mitUmbruch).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Kennungen der Bilder, die ein Text zeigt. */
export function bildIds(html) {
  const ids = [];
  for (const m of String(html ?? '').matchAll(/<img\b[^>]*\bdata-att\s*=\s*["']?([\w-]{1,80})/gi)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

/** Hat der Text weder Zeichen noch Bild? */
export function istLeer(html) {
  return !klartext(html) && !bildIds(html).length;
}

/** Schlichten Text (frühere Notiz) als Absätze. */
export function ausKlartext(text) {
  const zeilen = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  while (zeilen.length && !zeilen.at(-1).trim()) zeilen.pop();
  return zeilen.map((z) => (z.trim() ? `<p>${maskieren(z).replace(/&quot;/g, '"')}</p>` : '<p><br></p>')).join('');
}

/** Der Text einer Aufgabe als bereinigtes HTML, auch wenn nur die alte Notiz da ist. */
export function aufgabenHtml(todo) {
  if (typeof todo?.body === 'string' && todo.body) return bereinigen(todo.body);
  return todo?.notes ? ausKlartext(todo.notes) : '';
}
