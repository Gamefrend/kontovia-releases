/**
 * Kontovia – Bildschirmfoto der aktuellen Seite, ohne Rückfrage des Browsers.
 *
 * Der Browser erlaubt einer Seite nicht, den Bildschirm abzufotografieren,
 * ohne dass der Nutzer jedes Mal eine Freigabe erteilt (und auf dem Handy
 * gar nicht). Deshalb zeichnet Kontovia die eigene Seite selbst nach:
 * Die sichtbare Seite wird kopiert, die Stile und Schriften werden
 * mitgegeben, Bilder und Eingaben fest eingetragen, und das Ganze als SVG
 * mit eingebettetem HTML in ein Bild verwandelt. Es verlässt dabei nichts
 * das Gerät und es wird nichts nachgeladen.
 *
 * Aufgenommen wird, was im Fenster zu sehen ist, ohne Fenster und Hinweise
 * von Kontovia selbst (Elemente mit `data-ohne-foto`).
 */

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const WURZEL = 'kv-foto-wurzel';

const schriftCache = new Map();

function base64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const alsDatenUrl = (blob) => new Promise((ok, nein) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => nein(r.error);
  r.readAsDataURL(blob);
});

/** Jede url(...) in einer Regel durch die Daten der Datei ersetzen (Schriften, Hintergrundbilder). */
async function urlsEinbetten(css, basis) {
  const treffer = [...css.matchAll(/url\(\s*(['"]?)(?!data:)([^'")]+)\1\s*\)/g)];
  let aus = css;
  for (const t of treffer) {
    const adresse = new URL(t[2], basis).href;
    let daten = schriftCache.get(adresse);
    if (!daten) {
      try {
        const res = await fetch(adresse);
        if (!res.ok) continue;
        daten = await alsDatenUrl(await res.blob());
        schriftCache.set(adresse, daten);
      } catch { continue; }
    }
    aus = aus.split(t[0]).join(`url("${daten}")`);
  }
  return aus;
}

/** Alle Stilregeln der Seite als Text; :root und html werden zur Wurzel des Fotos. */
async function stileSammeln() {
  const teile = [];
  for (const blatt of Array.from(document.styleSheets)) {
    let regeln;
    try { regeln = Array.from(blatt.cssRules); } catch { continue; }
    const basis = blatt.href || location.href;
    for (const r of regeln) {
      let text = r.cssText;
      if (/url\(/.test(text)) text = await urlsEinbetten(text, basis);
      teile.push(text);
    }
  }
  return teile.join('\n')
    .replace(/:root/g, `.${WURZEL}`)
    .replace(/(^|[},\s])html(?=[\s.{[:,>+~])/g, `$1.${WURZEL}`);
}

/** Bild oder Zeichenfläche als Datenadresse. */
function bildDaten(el) {
  try {
    const c = document.createElement('canvas');
    c.width = el.naturalWidth || el.width || 1;
    c.height = el.naturalHeight || el.height || 1;
    c.getContext('2d').drawImage(el, 0, 0);
    return c.toDataURL('image/png');
  } catch { return ''; }
}

/** Kopiert den Zustand, den ein Klon nicht von selbst hat: Eingaben, Bilder, Scrollstand. */
function zustandUebertragen(orig, klon) {
  const paare = [[orig, klon]];
  while (paare.length) {
    const [o, k] = paare.pop();
    if (o.nodeType !== 1) continue;
    const tag = o.tagName;
    if (tag === 'INPUT') {
      if (o.type === 'checkbox' || o.type === 'radio') { if (o.checked) k.setAttribute('checked', ''); else k.removeAttribute('checked'); }
      else if (o.type !== 'password' && o.type !== 'file') k.setAttribute('value', o.value);
      else k.setAttribute('value', '•'.repeat(o.value.length));
    } else if (tag === 'TEXTAREA') {
      k.textContent = o.value;
    } else if (tag === 'SELECT') {
      Array.from(k.options).forEach((opt, i) => { if (o.options[i]?.selected) opt.setAttribute('selected', ''); else opt.removeAttribute('selected'); });
    } else if (tag === 'CANVAS') {
      const d = bildDaten(o);
      if (d) { const img = document.createElement('img'); img.src = d; img.width = o.width; img.height = o.height; img.style.cssText = o.style.cssText; img.className = o.className; k.replaceWith(img); }
      continue;
    } else if (tag === 'IMG') {
      const d = bildDaten(o);
      if (d) k.setAttribute('src', d);
      k.removeAttribute('srcset');
      k.removeAttribute('loading');
      continue;
    } else if (tag === 'VIDEO' || tag === 'IFRAME' || tag === 'SCRIPT') {
      k.remove();
      continue;
    }
    // Gescrollte Bereiche: den Inhalt um den Scrollweg verschieben, der Rahmen schneidet ihn ab.
    if ((o.scrollTop || o.scrollLeft) && k.childNodes.length) {
      const innen = document.createElement('div');
      innen.style.cssText = `transform:translate(${-o.scrollLeft}px,${-o.scrollTop}px);`;
      while (k.firstChild) innen.append(k.firstChild);
      k.append(innen);
      // Die Kinder stecken jetzt im neuen Knoten; die Zuordnung läuft über seine Kinder weiter.
      const okinder = Array.from(o.childNodes);
      const kkinder = Array.from(innen.childNodes);
      okinder.forEach((c, i) => kkinder[i] && paare.push([c, kkinder[i]]));
      continue;
    }
    const okinder = Array.from(o.childNodes);
    const kkinder = Array.from(k.childNodes);
    okinder.forEach((c, i) => kkinder[i] && paare.push([c, kkinder[i]]));
  }
}

/**
 * Fotografiert die sichtbare Seite.
 * @param {{qualitaet?:number, maxBreite?:number}} opts
 * @returns {Promise<Blob|null>} JPEG, oder null, wenn der Browser es nicht zulässt
 */
export async function seiteAufnehmen({ qualitaet = 0.82, maxBreite = 1600 } = {}) {
  try {
    const B = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const klon = document.body.cloneNode(true);
    zustandUebertragen(document.body, klon);
    klon.querySelectorAll('[data-ohne-foto], #toasts').forEach((n) => n.remove());
    klon.querySelectorAll('script, noscript, link, style').forEach((n) => n.remove());
    const stile = await stileSammeln();

    const wurzel = document.createElement('div');
    for (const a of Array.from(document.documentElement.attributes)) if (a.name !== 'class' && a.name !== 'style') wurzel.setAttribute(a.name, a.value);
    wurzel.className = `${document.documentElement.className} ${WURZEL}`.trim();
    wurzel.style.cssText = `width:${B}px;height:${H}px;overflow:hidden;position:relative;`;
    wurzel.setAttribute('xmlns', XHTML);
    const st = document.createElement('style');
    st.textContent = stile;
    wurzel.append(st, klon);

    const xml = new XMLSerializer().serializeToString(wurzel);
    const svg = `<svg xmlns="${SVG}" width="${B}" height="${H}" viewBox="0 0 ${B} ${H}"><foreignObject x="0" y="0" width="100%" height="100%">${xml}</foreignObject></svg>`;
    // Als Daten-Adresse, nicht als Blob: Aus einer Blob-Adresse gilt die Zeichenfläche als verunreinigt und lässt sich nicht auslesen.
    const url = `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svg))}`;
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, nein) => { img.onload = ok; img.onerror = () => nein(new Error('Bild konnte nicht erzeugt werden.')); img.src = url; });
    const faktor = Math.min(1, maxBreite / B);
    const c = document.createElement('canvas');
    c.width = Math.round(B * faktor);
    c.height = Math.round(H * faktor);
    const ctx = c.getContext('2d');
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, nein) => c.toBlob((b) => (b ? ok(b) : nein(new Error('Die Zeichenfläche lässt sich nicht auslesen.'))), 'image/jpeg', qualitaet));
  } catch (e) {
    console.warn('Bildschirmfoto nicht möglich:', e.message);
    return null;
  }
}
