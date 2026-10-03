/**
 * Kontovia – Berichte als neutrales Dokument.
 *
 * Ein Bericht (reports.js) beschreibt nur, was darin steht: Überschriften,
 * Kennzahlen, Tabellen mit Spaltenbreite und Ausrichtung, Summenzeilen,
 * Hinweise. Daraus entstehen zwei Ausgaben:
 *
 *   alsHtml()  die druckfertige Seite (Anzeige, Druckdialog)
 *   alsPdf()   eine echte PDF-Datei (pdf.js): markierbarer Text, Kopf auf
 *              jeder Tabellenseite, Seitenzahlen, Hoch- oder Querformat
 *
 * Aufbau:
 *   { titel, untertitel, firma: settings, quer?, fuss?, bloecke: [
 *       { art: 'h2', text, neueSeite?, zusammen? }   zusammen: mit der folgenden
 *                                                     Tabelle auf eine Seite
 *       { art: 'h3', text }
 *       { art: 'kennzahlen', werte: [{ label, wert, ton? }] }
 *       { art: 'tabelle', spalten: [{ titel?, rechts?, breite? (mm) }],
 *         zeilen: [{ zellen: [Zelle], art?: 'summe'|'zwischen'|'gruppe'|'storno' }],
 *         leer?: Text, wenn es keine Zeilen gibt }
 *       { art: 'hinweis', inhalt: Text }
 *       { art: 'absatz', inhalt: Text, gedaempft? }
 *       { art: 'seitenumbruch' } ] }
 *
 * Text ist eine Zeichenkette oder eine Liste von Läufen
 * { t, fett?, klein?, gedaempft?, umbruch? (neue Zeile davor) }.
 * Eine Zelle ist Text oder { inhalt: Text, rechts?, spalten? (verbunden),
 * ton?: 'pos'|'neg', gedaempft? }.
 */

import { esc, fmtDateLong, todayISO } from './util.js';
import { Seite, MM, textBreite, pdfDatei } from './pdf.js';

/** Der Herkunftsvermerk unter jedem Bericht. */
export function herkunft(datum = todayISO()) {
  return `Erstellt am ${fmtDateLong(datum)} mit Kontovia, berechnet aus den erfassten Buchungen nach festen `
    + 'Rechenregeln; an der Berechnung wirkt keine künstliche Intelligenz mit. Eine Arbeitshilfe, bitte vor der Übernahme prüfen.';
}

const laeufe = (inhalt) => (Array.isArray(inhalt) ? inhalt : [{ t: String(inhalt ?? '') }])
  .map((l) => (typeof l === 'string' ? { t: l } : l));
const zelle = (z) => (z && typeof z === 'object' && !Array.isArray(z) ? z : { inhalt: z });

/* -------------------------------------------------------------------------- */
/* HTML                                                                        */
/* -------------------------------------------------------------------------- */

const CSS = `
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5pt; color: #14181d; margin: 0; line-height: 1.45; }
  h1 { font-size: 18pt; margin: 0 0 2mm; letter-spacing: -.3px; }
  h2 { font-size: 12pt; margin: 8mm 0 2mm; padding-bottom: 1.5mm; border-bottom: 1.2pt solid #14181d; }
  h3 { font-size: 10.5pt; margin: 5mm 0 1.5mm; color: #333; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2pt solid #14181d; padding-bottom: 3mm; margin-bottom: 4mm; }
  .doc-head .who { font-size: 9pt; color: #444; text-align: right; line-height: 1.4; }
  .doc-head .who strong { color: #14181d; font-size: 10pt; }
  .sub { color: #555; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .03em; color: #555; border-bottom: .8pt solid #999; padding: 1.6mm 2mm; }
  td { padding: 1.5mm 2mm; border-bottom: .4pt solid #dfe3e9; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { border-top: 1pt solid #14181d; border-bottom: 2.4pt double #14181d; font-weight: 700; padding-top: 2mm; }
  tr.sub-total td { border-top: .8pt solid #999; font-weight: 600; }
  tr.group td { background: #f1f3f6; font-weight: 600; }
  tr.storno td { opacity: .5; text-decoration: line-through; }
  .kpis { display: flex; gap: 4mm; margin: 4mm 0; }
  .kpi { flex: 1; border: .8pt solid #cfd5dd; border-radius: 2mm; padding: 3mm; }
  .kpi .l { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: .04em; }
  .kpi .v { font-size: 14pt; font-weight: 700; margin-top: 1mm; font-variant-numeric: tabular-nums; }
  .pos { color: #0d7a52; } .neg { color: #b83c34; }
  .note { font-size: 8.5pt; color: #555; border-left: 2pt solid #cfd5dd; padding: 1.5mm 0 1.5mm 3mm; margin: 4mm 0; line-height: 1.5; }
  .note strong { color: #14181d; }
  .muted { color: #666; }
  .small { font-size: 8.5pt; }
  .avoid-break { break-inside: avoid; }
  .pagebreak { break-before: page; }
`;

function htmlText(inhalt) {
  return laeufe(inhalt).map((l) => {
    let s = esc(l.t);
    if (l.fett) s = `<strong>${s}</strong>`;
    if (l.klein || l.gedaempft) s = `<span class="${[l.gedaempft ? 'muted' : '', l.klein ? 'small' : ''].filter(Boolean).join(' ')}">${s}</span>`;
    return (l.umbruch ? '<br>' : '') + s;
  }).join('');
}

function htmlKopf(doc) {
  const s = doc.firma || {};
  const adresse = [s.companyName, s.ownerName, s.street, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const steuer = [
    s.taxNumber ? `Steuernummer: ${esc(s.taxNumber)}` : '',
    s.vatId ? `USt-IdNr.: ${esc(s.vatId)}` : '',
  ].filter(Boolean).join('<br>');
  return `
    <div class="doc-head">
      <div>
        <h1>${esc(doc.titel)}</h1>
        <div class="sub">${esc(doc.untertitel || '')}</div>
      </div>
      <div class="who"><strong>${adresse || 'Ohne Firmenangabe'}</strong>${steuer ? '<br>' + steuer : ''}</div>
    </div>`;
}

function htmlTabelle(b) {
  const kopf = b.spalten.some((s) => s.titel);
  const th = b.spalten.map((s) => `<th class="${s.rechts ? 'num' : ''}"${s.breite ? ` style="width:${s.breite}mm"` : ''}>${esc(s.titel || '')}</th>`).join('');
  const klasse = { summe: 'total', zwischen: 'sub-total', gruppe: 'group', storno: 'storno' };
  const zeilen = b.zeilen.map((r) => {
    let spalte = 0;
    const tds = r.zellen.map((z0) => {
      const z = zelle(z0);
      const s = b.spalten[spalte] || {};
      const rechts = z.rechts ?? s.rechts;
      const cls = [rechts ? 'num' : '', z.ton || '', z.gedaempft ? 'muted' : ''].filter(Boolean).join(' ');
      const span = z.spalten > 1 ? ` colspan="${z.spalten}"` : '';
      const breite = !kopf && s.breite && !z.spalten ? ` style="width:${s.breite}mm"` : '';
      spalte += z.spalten || 1;
      return `<td${cls ? ` class="${cls}"` : ''}${span}${breite}>${htmlText(z.inhalt)}</td>`;
    }).join('');
    return `<tr${klasse[r.art] ? ` class="${klasse[r.art]}"` : ''}>${tds}</tr>`;
  }).join('') || (b.leer ? `<tr><td colspan="${b.spalten.length}" class="muted">${esc(b.leer)}</td></tr>` : '');
  return `<table${b.zusammen ? ' class="avoid-break"' : ''}>${kopf ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${zeilen}</tbody></table>`;
}

function htmlBlock(b) {
  switch (b.art) {
    case 'h2': return `<h2 class="${[b.neueSeite ? 'pagebreak' : '', b.zusammen ? 'avoid-break' : ''].filter(Boolean).join(' ')}">${htmlText(b.text)}</h2>`;
    case 'h3': return `<h3>${htmlText(b.text)}</h3>`;
    case 'kennzahlen':
      return `<div class="kpis">${b.werte.map((k) => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v ${k.ton || ''}">${esc(k.wert)}</div></div>`).join('')}</div>`;
    case 'tabelle': return htmlTabelle(b);
    case 'hinweis': return `<div class="note">${htmlText(b.inhalt)}</div>`;
    case 'absatz': return `<p class="${b.gedaempft ? 'muted' : ''}">${htmlText(b.inhalt)}</p>`;
    case 'seitenumbruch': return '<div class="pagebreak"></div>';
    default: return '';
  }
}

function htmlKoerper(doc) {
  return `${htmlKopf(doc)}${doc.bloecke.map(htmlBlock).join('\n')}
    <div class="note">${esc(herkunft())}${doc.fuss ? ' ' + htmlText(doc.fuss) : ''}</div>`;
}

/** Ein oder mehrere Dokumente als druckfertige HTML-Seite. */
export function alsHtml(docs) {
  const liste = Array.isArray(docs) ? docs : [docs];
  const titel = liste.length === 1 ? liste[0].titel : 'Jahresunterlagen';
  const koerper = liste.map((d, i) => (i ? '<div class="pagebreak"></div>' : '') + htmlKoerper(d)).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${CSS}</style></head><body>${koerper}</body></html>`;
}

/* -------------------------------------------------------------------------- */
/* PDF: Seitensatz                                                             */
/* -------------------------------------------------------------------------- */

const RAND = { oben: 14 * MM, unten: 17 * MM, links: 12.7 * MM, rechts: 12.7 * MM };
const FARBE = {
  text: '#14181d', grau: '#555555', hell: '#666666', fuss: '#8a8f98', pos: '#0d7a52', neg: '#b83c34',
  linie: '#999999', zart: '#dfe3e9', rahmen: '#cfd5dd', gruppe: '#f1f3f6', adresse: '#444444', h3: '#333333',
  storno: '#a4a9b0',
};
const ZEILE = 1.42;

/** Stil eines Laufs in einer Umgebung (Grundgröße, Grundfarbe, fett). */
function stil(l, u) {
  return {
    groesse: l.klein ? Math.min(u.groesse, 8.5) : u.groesse,
    schrift: l.fett || u.fett ? 'fett' : 'normal',
    farbe: l.gedaempft ? FARBE.hell : (l.fett && u.fettFarbe) ? u.fettFarbe : u.farbe,
  };
}

/**
 * Bricht Text in Zeilen um.
 * @returns {{teile:{text:string, x:number, stil:object}[], breite:number, hoehe:number, groesse:number}[]}
 */
function umbrechen(inhalt, maxBreite, u) {
  const zeilen = [];
  let z = null;
  const neueZeile = () => { z = { teile: [], breite: 0, groesse: u.groesse, hoehe: 0 }; zeilen.push(z); };
  neueZeile();
  let leer = 0; // Breite der Leerzeichen vor dem nächsten Wort
  const anfuegen = (text, st, b) => {
    z.teile.push({ text, x: z.breite + leer, stil: st });
    z.breite += leer + b;
    z.groesse = Math.max(z.groesse, st.groesse);
    leer = 0;
  };
  for (const l of laeufe(inhalt)) {
    const st = stil(l, u);
    if (l.umbruch && z.teile.length) { neueZeile(); leer = 0; }
    for (const stueck of String(l.t ?? '').split(/(\s+)/)) {
      if (!stueck) continue;
      if (/^\s+$/.test(stueck)) {
        if (z.teile.length) leer += textBreite(' ', st.groesse, st.schrift) * stueck.replace(/\n/g, ' ').length;
        continue;
      }
      let wort = stueck;
      let b = textBreite(wort, st.groesse, st.schrift);
      if (z.teile.length && z.breite + leer + b > maxBreite) { neueZeile(); leer = 0; }
      // Ein Wort, das allein nicht passt, wird zeichenweise geteilt.
      while (b > maxBreite && wort.length > 1) {
        let n = wort.length - 1;
        while (n > 1 && textBreite(wort.slice(0, n), st.groesse, st.schrift) > maxBreite - z.breite) n--;
        anfuegen(wort.slice(0, n), st, textBreite(wort.slice(0, n), st.groesse, st.schrift));
        neueZeile();
        wort = wort.slice(n);
        b = textBreite(wort, st.groesse, st.schrift);
      }
      anfuegen(wort, st, b);
    }
  }
  for (const zz of zeilen) zz.hoehe = zz.groesse * ZEILE;
  return zeilen;
}

const hoeheVon = (zeilen) => zeilen.reduce((n, z) => n + z.hoehe, 0);

class Setzer {
  constructor() {
    this.seiten = [];
    this.quer = false;
    this.s = null;
  }

  neueSeite() {
    this.s = new Seite({ quer: this.quer });
    this.seiten.push(this.s);
    this.y = RAND.oben;
    this.amAnfang = true;
  }

  get breite() { return this.s.breite - RAND.links - RAND.rechts; }
  get unten() { return this.s.hoehe - RAND.unten; }
  get seitenHoehe() { return this.unten - RAND.oben; }
  passt(h) { return this.y + h <= this.unten + 0.01; }

  /** Neue Seite, wenn h nicht mehr passt (am Seitenanfang nie). */
  platz(h) {
    if (!this.passt(h) && !this.amAnfang) this.neueSeite();
  }

  vor(h) {
    this.y += h;
    this.amAnfang = false;
  }

  /** Zeilen ab x mit Ausrichtung zeichnen; Rückgabe: Höhe. */
  zeichneZeilen(zeilen, x, breite, { rechts = false, storno = false } = {}) {
    let y = this.y;
    for (const z of zeilen) {
      const grundlinie = y + z.hoehe / 2 + z.groesse * 0.359;
      const ab = rechts ? x + breite - z.breite : x;
      for (const t of z.teile) {
        const farbe = storno ? FARBE.storno : t.stil.farbe;
        this.s.text(ab + t.x, grundlinie, t.text, { groesse: t.stil.groesse, schrift: t.stil.schrift, farbe });
      }
      if (storno && z.teile.length) {
        const mitte = grundlinie - z.groesse * 0.3;
        this.s.linie(ab, mitte, ab + z.breite, mitte, { staerke: 0.5, farbe: FARBE.storno });
      }
      y += z.hoehe;
    }
    return y - this.y;
  }

  /** Fließtext mit Umbruch über Seiten hinweg; links optional ein Strich (Hinweis). */
  fliesstext(inhalt, u, { einzug = 0, strich = false, abstand = 0 } = {}) {
    const zeilen = umbrechen(inhalt, this.breite - einzug, u);
    let i = 0;
    while (i < zeilen.length) {
      this.platz(zeilen[i].hoehe + abstand * 2);
      const start = this.y;
      this.y += abstand;
      let teil = [];
      while (i < zeilen.length && (this.passt(hoeheVon([...teil, zeilen[i]]) + abstand * 2) || !teil.length)) teil.push(zeilen[i++]);
      const h = this.zeichneZeilen(teil, RAND.links + einzug, this.breite - einzug);
      if (strich) this.s.linie(RAND.links + 1, start, RAND.links + 1, start + h + abstand * 2, { staerke: 2, farbe: FARBE.rahmen });
      this.y = start;
      this.vor(h + abstand * 2);
      if (i < zeilen.length) this.neueSeite();
    }
  }

  kopf(doc) {
    const s = doc.firma || {};
    const links = umbrechen([{ t: doc.titel }], this.breite * 0.58, { groesse: 18, fett: true, farbe: FARBE.text });
    const unter = umbrechen(doc.untertitel || '', this.breite * 0.58, { groesse: 9.5, farbe: FARBE.grau });
    const adresse = [s.companyName, s.ownerName, s.street, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean);
    const steuer = [s.taxNumber ? `Steuernummer: ${s.taxNumber}` : '', s.vatId ? `USt-IdNr.: ${s.vatId}` : ''].filter(Boolean);
    const rechteBreite = this.breite * 0.4;
    const rechts = [
      ...umbrechen((adresse.length ? adresse : ['Ohne Firmenangabe']).map((t, i) => ({ t, umbruch: i > 0 })),
        rechteBreite, { groesse: 10, fett: true, farbe: FARBE.text }),
      ...umbrechen(steuer.map((t, i) => ({ t, umbruch: i > 0 })), rechteBreite, { groesse: 9, farbe: FARBE.adresse }),
    ].filter((z) => z.teile.length);
    const x = RAND.links;
    const y0 = this.y;
    this.zeichneZeilen(links, x, this.breite);
    this.y = y0 + hoeheVon(links) + 1;
    this.zeichneZeilen(unter, x, this.breite);
    const linksH = hoeheVon(links) + 1 + hoeheVon(unter);
    this.y = y0;
    // Rechts bündig, Zeile für Zeile.
    let y = y0;
    for (const z of rechts) {
      this.y = y;
      this.zeichneZeilen([z], x, this.breite, { rechts: true });
      y += z.hoehe * 0.98;
    }
    const h = Math.max(linksH, y - y0) + 3 * MM;
    this.y = y0 + h;
    this.s.linie(RAND.links, this.y, RAND.links + this.breite, this.y, { staerke: 2, farbe: FARBE.text });
    this.y += 4 * MM;
    this.amAnfang = true;
  }

  ueberschrift(b, folgend) {
    if (b.neueSeite && !this.amAnfang) this.neueSeite();
    const h2 = b.art === 'h2';
    const u = h2 ? { groesse: 12, fett: true, farbe: FARBE.text } : { groesse: 10.5, fett: true, farbe: FARBE.h3 };
    const zeilen = umbrechen(b.text, this.breite, u);
    const oben = this.amAnfang ? 0 : (h2 ? 8 : 5) * MM;
    const eigen = hoeheVon(zeilen) + (h2 ? 1.5 * MM + 2 * MM : 1.5 * MM);
    // Eine Überschrift steht nie allein am Seitenende.
    let mit = folgend ? this.mindestHoehe(folgend) : 0;
    if (b.zusammen && folgend) {
      const ganz = this.blockHoehe(folgend);
      if (ganz + eigen <= this.seitenHoehe) mit = ganz;
    }
    if (!this.passt(oben + eigen + mit) && !this.amAnfang) this.neueSeite();
    if (!this.amAnfang) this.y += oben;
    this.zeichneZeilen(zeilen, RAND.links, this.breite);
    this.y += hoeheVon(zeilen);
    if (h2) {
      this.y += 1.5 * MM;
      this.s.linie(RAND.links, this.y, RAND.links + this.breite, this.y, { staerke: 1.2, farbe: FARBE.text });
      this.y += 2 * MM;
    } else {
      this.y += 1.5 * MM;
    }
    this.amAnfang = false;
  }

  kennzahlen(b) {
    const n = b.werte.length || 1;
    const luecke = 4 * MM;
    const w = (this.breite - luecke * (n - 1)) / n;
    const pad = 3 * MM;
    const h = pad * 2 + 8 * ZEILE + 1 * MM + 14 * ZEILE;
    this.platz(h + 8 * MM);
    if (!this.amAnfang) this.y += 4 * MM;
    b.werte.forEach((k, i) => {
      const x = RAND.links + i * (w + luecke);
      this.s.rechteck(x, this.y, w, h, { rand: FARBE.rahmen, staerke: 0.8 });
      const yy = this.y;
      this.y = yy + pad;
      this.zeichneZeilen(umbrechen(String(k.label).toUpperCase(), w - pad * 2, { groesse: 8, farbe: FARBE.hell }), x + pad, w - pad * 2);
      this.y = yy + pad + 8 * ZEILE + 1 * MM;
      this.zeichneZeilen(umbrechen(k.wert, w - pad * 2, { groesse: 14, fett: true, farbe: FARBE[k.ton] || FARBE.text }), x + pad, w - pad * 2);
      this.y = yy;
    });
    this.vor(h + 4 * MM);
  }

  /** Spaltenbreiten: feste aus dem Modell, Zahlen nach Inhalt, Text teilt sich den Rest. */
  spaltenBreiten(b) {
    const pad = 2 * MM;
    const n = b.spalten.length;
    const natur = b.spalten.map((s) => (s.titel ? textBreite(String(s.titel).toUpperCase(), 8.5, 'fett') + pad * 2 : pad * 2));
    for (const r of b.zeilen) {
      let i = 0;
      for (const z0 of r.zellen) {
        const z = zelle(z0);
        if ((z.spalten || 1) === 1 && i < n) {
          const fett = r.art === 'summe' || r.art === 'zwischen' || r.art === 'gruppe';
          const w = laeufe(z.inhalt).reduce((m, l) => m + textBreite(l.t, l.klein ? 8.5 : 9.5, fett || l.fett ? 'fett' : 'normal'), 0) + pad * 2;
          natur[i] = Math.max(natur[i], Math.min(w, this.breite * 0.6));
        }
        i += z.spalten || 1;
      }
    }
    // Das längste Wort einer Spalte (Datum, Betrag, Spaltentitel) wird nie mitten
    // drin umbrochen: Es bestimmt die Mindestbreite, auch einer festen Spalte.
    const wortBreite = (t, g, s) => Math.max(0, ...String(t ?? '').split(/\s+/).map((w) => textBreite(w, g, s)));
    const minWort = b.spalten.map((s) => wortBreite(String(s.titel || '').toUpperCase(), 8.5, 'fett') + pad * 2);
    for (const r of b.zeilen) {
      let i = 0;
      const fett = r.art === 'summe' || r.art === 'zwischen' || r.art === 'gruppe';
      for (const z0 of r.zellen) {
        const z = zelle(z0);
        if ((z.spalten || 1) === 1 && i < n) {
          for (const l of laeufe(z.inhalt)) {
            minWort[i] = Math.max(minWort[i], wortBreite(l.t, l.klein ? 8.5 : 9.5, fett || l.fett ? 'fett' : 'normal') + pad * 2);
          }
        }
        i += z.spalten || 1;
      }
    }
    const breiten = b.spalten.map((s, i) => (s.breite ? Math.max(s.breite * MM, minWort[i]) : null));
    for (let i = 0; i < n; i++) if (breiten[i] === null && b.spalten[i].rechts) breiten[i] = Math.max(natur[i], minWort[i]);
    const frei = b.spalten.map((_, i) => i).filter((i) => breiten[i] === null);
    const rest = this.breite - breiten.reduce((a, w) => a + (w || 0), 0);
    if (frei.length) {
      const summe = frei.reduce((a, i) => a + natur[i], 0) || 1;
      for (const i of frei) breiten[i] = Math.max(12 * MM, minWort[i], (rest * natur[i]) / summe);
      // Ging das über die Seite, geben die freien Spalten zurück, so weit sie können.
      let zuviel = breiten.reduce((a, w) => a + w, 0) - this.breite;
      for (const i of [...frei].sort((x, y) => breiten[y] - breiten[x])) {
        if (zuviel <= 0) break;
        const kann = breiten[i] - Math.max(12 * MM, minWort[i]);
        const weg = Math.min(kann, zuviel);
        breiten[i] -= weg;
        zuviel -= weg;
      }
    } else if (rest > 0) {
      // Ohne freie Spalte geht der Rest an die erste.
      breiten[0] += rest;
    }
    // Immer noch zu breit (sehr viele Spalten): alles anteilig verkleinern.
    const gesamt = breiten.reduce((a, w) => a + w, 0);
    if (gesamt > this.breite + 0.5) for (let i = 0; i < n; i++) breiten[i] *= this.breite / gesamt;
    return breiten;
  }

  /** Eine Tabellenzeile vorbereiten: Zellen umbrechen, Höhe bestimmen. */
  zeileSetzen(b, breiten, r) {
    const pad = 2 * MM;
    const fett = r.art === 'summe' || r.art === 'zwischen' || r.art === 'gruppe';
    const padOben = r.art === 'summe' ? 2 * MM : 1.5 * MM;
    const padUnten = 1.5 * MM;
    const zellen = [];
    let i = 0;
    for (const z0 of r.zellen) {
      const z = zelle(z0);
      const span = Math.max(1, Math.min(z.spalten || 1, breiten.length - i));
      const x = RAND.links + breiten.slice(0, i).reduce((a, w) => a + w, 0);
      const w = breiten.slice(i, i + span).reduce((a, ww) => a + ww, 0);
      const rechts = z.rechts ?? b.spalten[i]?.rechts ?? false;
      const farbe = z.ton ? FARBE[z.ton] : z.gedaempft ? FARBE.hell : FARBE.text;
      const zeilen = umbrechen(z.inhalt, Math.max(4, w - pad * 2), { groesse: 9.5, fett, farbe });
      zellen.push({ x: x + pad, w: w - pad * 2, rechts, zeilen });
      i += span;
    }
    const inhalt = Math.max(9.5 * ZEILE, ...zellen.map((c) => hoeheVon(c.zeilen)));
    return { zellen, hoehe: padOben + inhalt + padUnten, padOben, art: r.art };
  }

  kopfZeile(b, breiten) {
    if (!b.spalten.some((s) => s.titel)) return 0;
    const pad = 2 * MM;
    const zellen = b.spalten.map((s, i) => ({
      x: RAND.links + breiten.slice(0, i).reduce((a, w) => a + w, 0) + pad,
      w: breiten[i] - pad * 2,
      rechts: !!s.rechts,
      zeilen: umbrechen(String(s.titel || '').toUpperCase(), Math.max(4, breiten[i] - pad * 2), { groesse: 8.5, fett: true, farbe: FARBE.grau }),
    }));
    const h = 1.6 * MM * 2 + Math.max(8.5 * ZEILE, ...zellen.map((c) => hoeheVon(c.zeilen)));
    const y0 = this.y;
    for (const c of zellen) {
      this.y = y0 + 1.6 * MM;
      this.zeichneZeilen(c.zeilen, c.x, c.w, { rechts: c.rechts });
    }
    this.y = y0 + h;
    this.s.linie(RAND.links, this.y, RAND.links + this.breite, this.y, { staerke: 0.8, farbe: FARBE.linie });
    this.amAnfang = false;
    return h;
  }

  kopfHoehe(b, breiten) {
    if (!b.spalten.some((s) => s.titel)) return 0;
    return 1.6 * MM * 2 + Math.max(8.5 * ZEILE, ...b.spalten.map((s, i) => hoeheVon(umbrechen(String(s.titel || '').toUpperCase(), Math.max(4, breiten[i] - 4 * MM), { groesse: 8.5, fett: true }))));
  }

  zeichneTabellenZeile(z) {
    const y0 = this.y;
    const x0 = RAND.links;
    const x1 = RAND.links + this.breite;
    if (z.art === 'gruppe') this.s.rechteck(x0, y0, this.breite, z.hoehe, { fuellung: FARBE.gruppe });
    for (const c of z.zellen) {
      this.y = y0 + z.padOben;
      this.zeichneZeilen(c.zeilen, c.x, c.w, { rechts: c.rechts, storno: z.art === 'storno' });
    }
    this.y = y0;
    if (z.art === 'summe') {
      this.s.linie(x0, y0, x1, y0, { staerke: 1, farbe: FARBE.text });
      this.s.linie(x0, y0 + z.hoehe, x1, y0 + z.hoehe, { staerke: 0.6, farbe: FARBE.text });
      this.s.linie(x0, y0 + z.hoehe + 1.4, x1, y0 + z.hoehe + 1.4, { staerke: 0.6, farbe: FARBE.text });
    } else {
      if (z.art === 'zwischen') this.s.linie(x0, y0, x1, y0, { staerke: 0.8, farbe: FARBE.linie });
      this.s.linie(x0, y0 + z.hoehe, x1, y0 + z.hoehe, { staerke: 0.4, farbe: FARBE.zart });
    }
    this.vor(z.hoehe + (z.art === 'summe' ? 1.6 : 0));
  }

  tabelle(b) {
    const breiten = this.spaltenBreiten(b);
    const zeilen = (b.zeilen.length ? b.zeilen : (b.leer ? [{ zellen: [{ inhalt: b.leer, spalten: b.spalten.length, gedaempft: true }] }] : []))
      .map((r) => this.zeileSetzen(b, breiten, r));
    const kopfH = this.kopfHoehe(b, breiten);
    if (b.zusammen) {
      const ganz = kopfH + zeilen.reduce((a, z) => a + z.hoehe + 1.6, 0);
      if (ganz <= this.seitenHoehe && !this.passt(ganz)) this.neueSeite();
    }
    this.platz(kopfH + (zeilen[0]?.hoehe || 0));
    this.kopfZeile(b, breiten);
    for (const z of zeilen) {
      if (!this.passt(z.hoehe + 1.6)) {
        this.neueSeite();
        // Der Tabellenkopf steht auf jeder Seite der Tabelle.
        this.kopfZeile(b, breiten);
      }
      this.zeichneTabellenZeile(z);
    }
  }

  /** Was ein Block mindestens braucht, damit eine Überschrift nicht allein steht. */
  mindestHoehe(b) {
    if (b.art === 'tabelle') {
      const breiten = this.spaltenBreiten(b);
      const erste = b.zeilen[0] ? this.zeileSetzen(b, breiten, b.zeilen[0]).hoehe : 9.5 * ZEILE + 3 * MM;
      return this.kopfHoehe(b, breiten) + erste;
    }
    if (b.art === 'kennzahlen') return 3 * MM * 2 + 8 * ZEILE + 1 * MM + 14 * ZEILE + 8 * MM;
    return 2 * 8.5 * ZEILE + 8 * MM;
  }

  blockHoehe(b) {
    if (b.art !== 'tabelle') return this.mindestHoehe(b);
    const breiten = this.spaltenBreiten(b);
    return this.kopfHoehe(b, breiten) + b.zeilen.reduce((a, r) => a + this.zeileSetzen(b, breiten, r).hoehe + 1.6, 0);
  }

  dokument(doc) {
    // Jedes Dokument beginnt auf einer eigenen Seite, im eigenen Format.
    this.quer = !!doc.quer;
    this.neueSeite();
    this.kopf(doc);
    doc.bloecke.forEach((b, i) => {
      const folgend = doc.bloecke[i + 1];
      switch (b.art) {
        case 'h2': case 'h3': this.ueberschrift(b, folgend); break;
        case 'kennzahlen': this.kennzahlen(b); break;
        case 'tabelle': this.tabelle(b); break;
        case 'hinweis':
          if (!this.amAnfang) this.y += 4 * MM;
          this.fliesstext(b.inhalt, { groesse: 8.5, farbe: FARBE.grau, fettFarbe: FARBE.text }, { einzug: 3 * MM + 2, strich: true, abstand: 1.5 * MM });
          this.y += 4 * MM;
          break;
        case 'absatz':
          this.fliesstext(b.inhalt, { groesse: 10, farbe: b.gedaempft ? FARBE.hell : FARBE.text });
          this.y += 2 * MM;
          break;
        case 'seitenumbruch': if (!this.amAnfang) this.neueSeite(); break;
        default:
      }
    });
    this.y += 4 * MM;
    this.fliesstext([{ t: herkunft() }, ...(doc.fuss ? laeufe(doc.fuss).map((l, i) => ({ ...l, t: (i ? '' : ' ') + l.t })) : [])],
      { groesse: 8.5, farbe: FARBE.grau, fettFarbe: FARBE.text }, { einzug: 3 * MM + 2, strich: true, abstand: 1.5 * MM });
    this.amAnfang = false;
  }

  /** Fußzeile auf jeder Seite: Herkunft links, Seitenzahl rechts. */
  fusszeilen() {
    const n = this.seiten.length;
    this.seiten.forEach((s, i) => {
      const y = s.hoehe - 9 * MM;
      s.text(RAND.links, y, 'Erstellt mit Kontovia', { groesse: 8, farbe: FARBE.fuss });
      const rechts = `Seite ${i + 1} von ${n}`;
      s.text(s.breite - RAND.rechts - textBreite(rechts, 8), y, rechts, { groesse: 8, farbe: FARBE.fuss });
    });
  }
}

/**
 * Ein oder mehrere Dokumente als PDF-Datei; jedes beginnt auf einer neuen Seite.
 * @returns {Promise<Uint8Array>}
 */
export async function alsPdf(docs, { titel } = {}) {
  const liste = Array.isArray(docs) ? docs : [docs];
  const setzer = new Setzer();
  for (const d of liste) setzer.dokument(d);
  setzer.fusszeilen();
  const firma = liste[0]?.firma || {};
  return pdfDatei(setzer.seiten, {
    titel: titel || (liste.length === 1 ? `${liste[0].titel} ${liste[0].untertitel || ''}`.trim() : 'Jahresunterlagen'),
    autor: firma.companyName || firma.ownerName || '',
    betreff: 'Erstellt mit Kontovia',
  });
}
