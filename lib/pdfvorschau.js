/**
 * Kontovia – Vorschau einer PDF-Seite als SVG.
 *
 * Nicht jedes Gerät zeigt ein PDF im Fenster an (am Telefon fast keines).
 * Die Seiten aus lib/pdfa.js führen deshalb neben den PDF-Befehlen eine
 * Liste derselben Elemente; hier wird daraus ein SVG. Schrift (Geist, über
 * styles.css geladen), Maße und Positionen sind dieselben wie im PDF.
 */

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const z = (n) => Math.round(n * 100) / 100;

/**
 * @param {import('./pdfa.js').Seite} seite
 * @param {Object<string,string>} bilder  Name → Adresse (data:/blob:)
 * @returns {string} SVG-Markup
 */
export function seiteAlsSvg(seite, bilder = {}) {
  const teile = [];
  for (const e of seite.elemente || []) {
    if (e.art === 'text') {
      teile.push(`<text x="${z(e.x)}" y="${z(e.y)}" font-size="${z(e.groesse)}" font-weight="${e.schrift === 'fett' ? 700 : 400}" fill="${x(e.farbe)}">${x(e.text)}</text>`);
    } else if (e.art === 'linie') {
      teile.push(`<line x1="${z(e.x1)}" y1="${z(e.y1)}" x2="${z(e.x2)}" y2="${z(e.y2)}" stroke="${x(e.farbe)}" stroke-width="${z(e.staerke)}"/>`);
    } else if (e.art === 'rechteck') {
      teile.push(`<rect x="${z(e.x)}" y="${z(e.y)}" width="${z(e.b)}" height="${z(e.h)}" fill="${e.fuellung ? x(e.fuellung) : 'none'}"${e.rand ? ` stroke="${x(e.rand)}" stroke-width="${z(e.staerke)}"` : ''}/>`);
    } else if (e.art === 'bild' && bilder[e.name]) {
      teile.push(`<image href="${x(bilder[e.name])}" x="${z(e.x)}" y="${z(e.y)}" width="${z(e.b)}" height="${z(e.h)}" preserveAspectRatio="none"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${z(seite.breite)} ${z(seite.hoehe)}" class="re-seite" role="img" aria-label="Seitenvorschau">`
    + `<rect width="100%" height="100%" fill="#ffffff"/><g font-family="Geist, system-ui, sans-serif" xml:space="preserve">${teile.join('')}</g></svg>`;
}
