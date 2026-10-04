/**
 * Kontovia – die gestaltete Rechnung als PDF/A-3 mit eingebetteter E-Rechnung.
 *
 * Grundaufbau nach DIN 5008 (Form B): Anschrift im Fenster eines
 * DL-Umschlags, Informationsblock rechts, Falz- und Lochmarken. Die
 * Gestaltung (lib/rechnung.js, DESIGN_VORGABE) kann davon frei abweichen:
 * Bausteine verschieben (Kopf, Anschrift, Infoblock, Beginn des Inhalts),
 * die Reihenfolge im Fluss ändern, Tabellenstil und Spalten wählen, ein
 * Briefpapier hinterlegen und eigene Bilder, Texte, Flächen und Linien
 * setzen. Die Zahlen kommen immer aus derselben Berechnung wie die XML
 * (lib/rechnung.js), damit Ansicht und E-Rechnung nie auseinanderlaufen.
 *
 * Was § 14 UStG verlangt, bleibt auf dem Blatt, egal wie gestaltet wird:
 * Ohne Fußzeile wandern Steuernummer, Anschrift und Registerangaben in den
 * Infoblock und ans Ende.
 *
 * Ist xml angegeben, steckt sie als factur-x.xml im PDF (ZUGFeRD / Factur-X).
 */

import {
  berechnen, faelligkeit, zahlungsText, titel as titelVon, einheitText, einheitKurz, mengeText, betragText, satzText,
  anzahlungTeile, designVoll, istGutschrift, AUFBEWAHRUNG_TEXT, STEUERFAELLE, ZAHLUNGSARTEN, LAENDER,
} from './rechnung.js';
import { Seite, MM, textBreite, pdfaDatei, SCHRIFTMASS } from './pdfa.js';

const FARBE = { text: '#14181d', grau: '#5b6270', hell: '#8a909b', linie: '#d5d9e0', zart: '#eef0f3' };
const d8 = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');
const hexOk = (f) => /^#[0-9a-f]{6}$/i.test(String(f || ''));
const zwischen = (n, lo, hi, vorgabe) => (Number.isFinite(Number(n)) && n !== '' && n !== null ? Math.min(hi, Math.max(lo, Number(n))) : vorgabe);

/** Mischung einer Farbe mit Weiß (Anteil 0–1 der Farbe). */
function aufgehellt(hex, anteil) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return FARBE.zart;
  return '#' + [m[1], m[2], m[3]].map((h) => Math.round(255 - (255 - parseInt(h, 16)) * anteil).toString(16).padStart(2, '0')).join('');
}

/** Ist eine Farbe so hell, dass weiße Schrift darauf schlecht lesbar wäre? */
function hell(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

/** Bricht Text in Zeilen um; harte Zeilenumbrüche bleiben. */
export function umbrechen(text, breite, groesse, schrift = 'normal') {
  const zeilen = [];
  for (const absatz of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let z = '';
    for (const wort of absatz.split(/\s+/).filter(Boolean)) {
      const versuch = z ? `${z} ${wort}` : wort;
      if (textBreite(versuch, groesse, schrift) <= breite) { z = versuch; continue; }
      if (z) zeilen.push(z);
      // Ein Wort, das allein nicht passt, wird geteilt.
      let rest = wort;
      while (textBreite(rest, groesse, schrift) > breite && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && textBreite(rest.slice(0, n), groesse, schrift) > breite) n--;
        zeilen.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      z = rest;
    }
    zeilen.push(z);
  }
  // Leerzeilen am Ende fallen weg.
  while (zeilen.length && !zeilen[zeilen.length - 1]) zeilen.pop();
  return zeilen;
}

/** Größe eines Bildes in Punkt bei gewünschter Breite (mm), Höhe begrenzt. */
function bildMass(b, breiteMm, maxHoeheMm) {
  if (!b?.breite || !b?.hoehe) return null;
  let w = breiteMm;
  let h = (w * b.hoehe) / b.breite;
  if (h > maxHoeheMm) { h = maxHoeheMm; w = (h * b.breite) / b.hoehe; }
  return { w: w * MM, h: h * MM };
}

/**
 * Name eines Bildes im PDF. Logo, Zusatzbild und Briefpapier haben feste
 * Namen; eigene Bilder heißen nach ihrem Beleg, damit ein Bild, das mehrfach
 * vorkommt, nur einmal in der Datei steckt.
 */
export const bildName = (art, id = '') => (art === 'frei' ? `F${String(id).replace(/\W/g, '')}` : { logo: 'Logo', bild: 'Bild', briefpapier: 'Briefpapier' }[art]);

/** Alle Bilder unter ihren PDF-Namen: { Name: {bytes, breite, hoehe, url} }. */
export function bilderNachName(bilder = {}) {
  const out = {};
  for (const art of ['logo', 'bild', 'briefpapier']) if (bilder[art]) out[bildName(art)] = bilder[art];
  for (const [id, b] of Object.entries(bilder.frei || {})) if (b) out[bildName('frei', id)] = b;
  return out;
}

/**
 * Setzt die Rechnung.
 * @param {object} r  Rechnung
 * @param {object} v  Verkäufer (verkaeuferAus)
 * @param {object} d  Gestaltung (design)
 * @param {{bilder?:{logo?:object, bild?:object, briefpapier?:object, frei?:Object<string,object>}, xml?:string, profil?:string, jetzt?:Date}} o
 *   bilder: {bytes (JPEG), breite, hoehe} – Breite/Höhe in Pixeln für das Seitenverhältnis
 * @returns {Promise<Uint8Array>}
 */
export async function rechnungPdf(r, v, d, { bilder = {}, xml = null, profil = 'en16931', jetzt = new Date() } = {}) {
  const { seiten, titelText } = rechnungSeiten(r, v, d, { bilder, eRechnung: !!xml, profil });
  const k = r.kaeufer || {};
  const xmlBytes = xml ? new TextEncoder().encode(xml) : null;
  const dateiname = profil === 'xrechnung' ? 'xrechnung.xml' : 'factur-x.xml';
  // Nur Bilder, die auch auf einer Seite stehen, kommen in die Datei.
  const benutzt = new Set(seiten.flatMap((s) => [...s.bilder]));
  const alle = bilderNachName(bilder);
  return pdfaDatei(seiten, {
    titel: titelText,
    autor: v.name || '',
    betreff: `${titelText}${k.name ? ` an ${k.name}` : ''}`,
    bilder: Object.fromEntries(Object.entries(alle).filter(([n]) => benutzt.has(n))),
    anhang: xmlBytes ? {
      name: dateiname,
      bytes: xmlBytes,
      mime: 'text/xml',
      beschreibung: profil === 'xrechnung' ? 'XRechnung' : 'Factur-X/ZUGFeRD-Rechnung',
      beziehung: 'Alternative',
    } : null,
    facturX: xmlBytes ? { dateiname, profil: profil === 'xrechnung' ? 'XRECHNUNG' : 'EN 16931' } : null,
    jetzt,
  });
}

/**
 * Die Seiten der Rechnung, ohne sie zu einer Datei zu machen: für das PDF
 * und für die Vorschau in der Oberfläche (lib/pdfvorschau.js).
 *
 * bereiche: die verschiebbaren Teile der ersten Seite mit ihren Maßen in
 * Punkt, für den Gestalter (views/rechnungsgestalter.js).
 * @returns {{seiten:Seite[], titelText:string, bereiche:Array<{key:string, x:number, y:number, b:number, h:number}>}}
 */
export function rechnungSeiten(r, v, dRoh, { bilder = {}, eRechnung = true, profil = 'en16931' } = {}) {
  const d = designVoll(dRoh);
  const b = berechnen(r);
  const fall = STEUERFAELLE[r.steuerfall] || STEUERFAELLE.standard;
  const mitSteuer = !fall.kategorie;
  const gutschrift = istGutschrift(r);
  const k = r.kaeufer || {};
  const w = r.waehrung || 'EUR';
  const akzent = hexOk(d.akzent) ? d.akzent : '#3446e0';
  const TEXT = hexOk(d.textfarbe) ? d.textfarbe : FARBE.text;
  const layout = ['klassisch', 'modern', 'schlicht'].includes(d.layout) ? d.layout : 'klassisch';
  const schlicht = layout === 'schlicht';
  const fs = Math.min(11, Math.max(8, Number(d.schriftgroesse) || 9.5));
  const zh = fs * 1.42; // Zeilenhöhe
  const pos = d.positionen || {};
  const punkt = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x) * MM, y: Number(p.y) * MM } : null);

  const LINKS = zwischen(d.randLinks, 8, 45, 25) * MM;
  const RECHTS = 210 * MM - zwischen(d.randRechts, 8, 45, 20) * MM;
  const BREITE = RECHTS - LINKS;
  const fussHoehe = d.fusszeile !== false ? 24 * MM : 12 * MM;
  const fussBildMass = d.bildPosition === 'fuss' && bilder.bild ? bildMass(bilder.bild, d.bildBreite || 45, 18) : null;
  const UNTEN = 297 * MM - fussHoehe - (fussBildMass ? fussBildMass.h + 4 * MM : 0) - 6 * MM;

  const seiten = [];
  const bereiche = [];
  let s = null;
  let y = 0;
  const titelText = `${titelVon(r)} ${r.nummer || '(Entwurf)'}`;

  /* ------------------------------ Seitenrahmen ----------------------------- */

  function rahmen(seite) {
    if (layout === 'modern') seite.rechteck(0, 0, 210 * MM, 6 * MM, { fuellung: akzent });
    if (d.falzmarken !== false) {
      for (const mm of [105, 210]) seite.linie(3 * MM, mm * MM, 8 * MM, mm * MM, { staerke: 0.4, farbe: FARBE.hell });
      seite.linie(3 * MM, 148.5 * MM, 6 * MM, 148.5 * MM, { staerke: 0.4, farbe: FARBE.hell });
    }
  }

  function neueSeite() {
    s = new Seite();
    seiten.push(s);
    rahmen(s);
    y = (layout === 'modern' ? 18 : 15) * MM;
    s.text(LINKS, y, titelText, { groesse: fs, schrift: 'fett', farbe: TEXT });
    s.text(RECHTS - textBreite(v.name || '', fs * 0.85), y, v.name || '', { groesse: fs * 0.85, farbe: FARBE.grau });
    y += 4 * MM;
    s.linie(LINKS, y, RECHTS, y, { staerke: 0.4, farbe: FARBE.linie });
    y += 6 * MM;
  }

  /* --------------------------------- Kopf ---------------------------------- */

  s = new Seite();
  seiten.push(s);
  rahmen(s);
  const kopfOben = (layout === 'modern' ? 12 : 10) * MM;
  const kopfPunkt = punkt(pos.kopf);
  const logo = bilder.logo ? bildMass(bilder.logo, d.logoBreite || 40, 28) : null;
  let kopfMitAnschrift = false;
  if (logo) {
    const x = kopfPunkt ? kopfPunkt.x : d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (210 * MM - logo.w) / 2 : RECHTS - logo.w;
    const ky = kopfPunkt ? kopfPunkt.y : kopfOben;
    s.bild(bildName('logo'), x, ky, logo.w, logo.h);
    bereiche.push({ key: 'kopf', x, y: ky, b: logo.w, h: logo.h, anker: { x, y: ky }, logo: true });
  } else if (v.name && d.firmenkopf !== false) {
    // Ohne Logo steht der Name des Betriebs im Kopf, ohne Fußzeile mit Anschrift darunter.
    const g = 15;
    const zeilen = [{ t: v.name, g, schrift: 'fett', farbe: schlicht ? TEXT : akzent }];
    if (d.fusszeile === false) {
      kopfMitAnschrift = true;
      for (const z of [v.strasse, [v.plz, v.ort].filter(Boolean).join(' '), v.telefon, v.email].filter(Boolean)) zeilen.push({ t: z, g: fs * 0.85, schrift: 'normal', farbe: FARBE.grau });
    }
    const bw = Math.max(...zeilen.map((z) => textBreite(z.t, z.g, z.schrift)));
    const bx = kopfPunkt ? kopfPunkt.x : d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (210 * MM - bw) / 2 : RECHTS - bw;
    const by = kopfPunkt ? kopfPunkt.y : kopfOben + 3 * MM;
    let zy = by + g * 0.75;
    zeilen.forEach((z, i) => {
      const tw = textBreite(z.t, z.g, z.schrift);
      const zx = d.logoPosition === 'links' ? bx : d.logoPosition === 'mitte' ? bx + (bw - tw) / 2 : bx + bw - tw;
      s.text(zx, zy, z.t, { groesse: z.g, schrift: z.schrift, farbe: z.farbe });
      zy += i === 0 ? 5 * MM : fs * 1.25;
    });
    bereiche.push({ key: 'kopf', x: bx, y: by, b: bw, h: zy - by - fs * 0.6, anker: { x: bx, y: by } });
  }

  // Rücksendeangabe und Anschrift (Fenster: 45 mm von oben, 20 mm vom Rand, 85 × 45 mm)
  const anschriftPunkt = punkt(pos.anschrift) || { x: LINKS, y: 55 * MM };
  const AX = anschriftPunkt.x;
  const AY = anschriftPunkt.y;
  const absender = [v.name, v.strasse, [v.plz, v.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  let ab = absender;
  while (ab && textBreite(ab, 6.8) > 85 * MM) ab = ab.slice(0, -1);
  const mitAbsender = !!ab && d.absenderzeile !== false;
  if (mitAbsender) {
    s.text(AX, AY + 4.5 * MM, ab, { groesse: 6.8, farbe: FARBE.grau });
    s.linie(AX, AY + 5.6 * MM, AX + textBreite(ab, 6.8), AY + 5.6 * MM, { staerke: 0.3, farbe: FARBE.hell });
  }
  const anschrift = [k.name, k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')];
  if (k.land && k.land !== (v.land || 'DE')) anschrift.push((LAENDER[k.land]?.name || k.land).toUpperCase());
  // Lange Namen werden umbrochen statt abgeschnitten: Der Name des Kunden ist Pflicht.
  const anschriftZeilen = anschrift.filter(Boolean).flatMap((z) => umbrechen(z, 80 * MM, fs + 0.5)).slice(0, 8);
  let ay = AY + 11 * MM;
  for (const t of anschriftZeilen) {
    s.text(AX, ay, t, { groesse: fs + 0.5, farbe: TEXT });
    ay += (fs + 0.5) * 1.3;
  }
  bereiche.push({ key: 'anschrift', x: AX, y: AY, b: 85 * MM, h: Math.max(40 * MM, ay - AY), anker: { x: AX, y: AY } });

  // Informationsblock (125 mm vom Rand, 50 mm von oben)
  const steuerKennung = v.ustId ? ['USt-IdNr.', v.ustId] : ['Steuernummer', v.steuernummer];
  const info = [
    [r.storno ? 'Storno-Nr.' : (gutschrift ? 'Gutschrift-Nr.' : 'Rechnungsnr.'), r.nummer || 'Entwurf'],
    [r.storno || gutschrift ? 'Datum' : 'Rechnungsdatum', d8(r.datum)],
    r.leistungArt === 'zeitraum'
      ? ['Leistungszeitraum', r.leistungVon && r.leistungBis ? `${d8(r.leistungVon)} bis ${d8(r.leistungBis)}` : '']
      : ['Leistungsdatum', d8(r.leistungsdatum)],
    ['Kundennr.', k.kundennummer],
    ['Ihre Bestellung', r.bestellnummer],
    ['Leitweg-ID', k.leitwegId],
    ['Ihre USt-IdNr.', fall.kategorie === 'AE' || fall.kategorie === 'K' ? k.ustId : ''],
    ['Zahlbar bis', b.zahlbetrag > 0 && r.zahlungsart !== 'bar' && !gutschrift ? d8(faelligkeit(r)) : ''],
    // Ohne Fußzeile steht die Steuernummer hier (§ 14 Abs. 4 Nr. 2 UStG).
    d.fusszeile === false ? steuerKennung : ['', ''],
  ].filter(([, wert]) => wert);
  const infoPunkt = punkt(pos.info) || { x: 125 * MM, y: 49 * MM };
  const IX = infoPunkt.x;
  const IB = Math.max(40 * MM, Math.min(RECHTS - 125 * MM, 205 * MM - IX));
  const ig = fs * 0.88;
  const labelBreite = Math.max(...info.map(([l]) => textBreite(l, ig)));
  let iy = infoPunkt.y + 3 * MM;
  for (const [label, wert] of info) {
    s.text(IX, iy, label, { groesse: ig, farbe: FARBE.grau });
    // Werte werden umbrochen statt gekürzt (eine gekürzte Nummer wäre falsch).
    const zeilen = umbrechen(String(wert), Math.max(20 * MM, IB - labelBreite - 3 * MM), ig);
    zeilen.forEach((t, i) => {
      s.text(IX + IB - textBreite(t, ig), iy, t, { groesse: ig, farbe: TEXT });
      if (i < zeilen.length - 1) iy += ig * 1.3;
    });
    iy += ig * 1.55;
  }
  bereiche.push({ key: 'info', x: IX, y: infoPunkt.y, b: IB, h: iy - infoPunkt.y - ig * 0.6, anker: { x: IX, y: infoPunkt.y } });

  /* ------------------------------ Titel, Text ------------------------------ */

  const inhaltY = pos.inhalt && Number.isFinite(Number(pos.inhalt.y)) ? Number(pos.inhalt.y) * MM : null;
  // Ohne eigene Angabe beginnt der Inhalt unter Anschrift und Infoblock, sofern
  // diese nicht bewusst weiter unten stehen.
  y = inhaltY ?? Math.max(103 * MM, infoPunkt.y < 120 * MM ? iy + 8 * MM : 0, AY < 120 * MM ? ay + 10 * MM : 0);
  const gTitel = Number(d.titelGroesse) > 0 ? zwischen(d.titelGroesse, 10, 30, 15) : (layout === 'modern' ? 17 : 15);
  const titelOben = y - gTitel * 0.8;
  const titelGrundlinie = y;
  s.text(LINKS, y, titelText, { groesse: gTitel, schrift: 'fett', farbe: layout === 'modern' ? akzent : TEXT });
  y += gTitel * 0.55 + 2 * MM;
  const unterzeilen = [];
  if (r.betreff) unterzeilen.push(r.betreff);
  if (r.bezug?.nummer) unterzeilen.push(`${r.storno ? 'Storno zur' : 'Bezug:'} Rechnung ${r.bezug.nummer}${r.bezug.datum ? ` vom ${d8(r.bezug.datum)}` : ''}`);
  for (const z of unterzeilen) {
    for (const t of umbrechen(z, BREITE, fs + 0.5)) { y += (fs + 0.5) * 1.35; s.text(LINKS, y, t, { groesse: fs + 0.5, farbe: FARBE.grau }); }
  }
  bereiche.push({ key: 'inhalt', x: LINKS, y: titelOben, b: BREITE, h: y - titelOben + 2 * MM, anker: { x: LINKS, y: titelGrundlinie } });
  y += 7 * MM;

  const absatz = (text, { groesse = fs, farbe: f = TEXT, schrift = 'normal', abstand = 0 } = {}) => {
    const zeilen = umbrechen(text, BREITE, groesse, schrift);
    for (const z of zeilen) {
      if (y + groesse * 1.42 > UNTEN) neueSeite();
      if (z) s.text(LINKS, y, z, { groesse, farbe: f, schrift });
      y += groesse * 1.42;
    }
    y += abstand;
  };

  /* ------------------------------- Positionen ------------------------------ */

  const tabelle = () => {
    const titelVonSpalte = (key, vorgabe) => String(d.spaltenTitel?.[key] || '').trim() || vorgabe;
    const mitEinheit = d.spalteEinheit !== false;
    // Bei mehreren Steuersätzen muss erkennbar sein, welcher Posten welchem Satz unterliegt.
    const mitSatz = mitSteuer && (d.spalteSatz !== false || b.steuern.length > 1);
    const spalten = [
      ...(d.spalteNr !== false ? [{ key: 'nr', titel: titelVonSpalte('nr', 'Pos.'), breite: 9 * MM }] : []),
      { key: 'name', titel: titelVonSpalte('name', 'Bezeichnung'), breite: 0 },
      { key: 'menge', titel: titelVonSpalte('menge', 'Menge'), breite: (mitEinheit ? 14 : 24) * MM, rechts: true },
      ...(mitEinheit ? [{ key: 'einheit', titel: titelVonSpalte('einheit', 'Einheit'), breite: 16 * MM }] : []),
      { key: 'preis', titel: titelVonSpalte('preis', 'Einzelpreis'), breite: 22 * MM, rechts: true },
      ...(mitSatz ? [{ key: 'satz', titel: titelVonSpalte('satz', 'USt'), breite: 11 * MM, rechts: true }] : []),
      { key: 'netto', titel: titelVonSpalte('netto', mitSteuer ? 'Gesamt netto' : 'Gesamt'), breite: 24 * MM, rechts: true },
    ];
    const fest = spalten.reduce((n, c) => n + c.breite, 0);
    const nameSpalte = spalten.find((c) => c.key === 'name');
    nameSpalte.breite = Math.max(30 * MM, BREITE - fest);
    let sx = LINKS;
    for (const c of spalten) { c.x = sx; sx += c.breite; }
    const PAD = 1.6 * MM;
    const stil = ['flaeche', 'linien', 'streifen', 'raster'].includes(d.tabellenstil) ? d.tabellenstil : (schlicht ? 'linien' : 'flaeche');
    const farbigerKopf = d.tabellenkopfFarbig !== false && (stil === 'flaeche' || stil === 'streifen') && !(schlicht && d.tabellenstil === 'auto');
    const kopfText = farbigerKopf && !hell(akzent) ? '#ffffff' : TEXT;
    const streifen = aufgehellt(akzent, 0.07);
    const senkrechte = (y1, y2) => {
      if (stil !== 'raster') return;
      for (const c of spalten) s.linie(c.x, y1, c.x, y2, { staerke: 0.35, farbe: FARBE.linie });
      s.linie(RECHTS, y1, RECHTS, y2, { staerke: 0.35, farbe: FARBE.linie });
    };

    const tabellenkopf = () => {
      const h = fs * 1.9;
      if (y + h + zh * 2 > UNTEN) neueSeite();
      if (stil !== 'linien') s.rechteck(LINKS, y, BREITE, h, { fuellung: farbigerKopf ? akzent : FARBE.zart });
      if (stil === 'raster') { s.linie(LINKS, y, RECHTS, y, { staerke: 0.35, farbe: FARBE.linie }); senkrechte(y, y + h); }
      const by = y + h / 2 + fs * 0.32;
      for (const c of spalten) {
        const g = fs * 0.86;
        const tx = c.rechts ? c.x + c.breite - PAD - textBreite(c.titel, g, 'fett') : c.x + PAD;
        s.text(tx, by, c.titel, { groesse: g, schrift: 'fett', farbe: kopfText });
      }
      y += h;
      if (stil === 'linien') s.linie(LINKS, y, RECHTS, y, { staerke: 0.8, farbe: TEXT });
      if (stil === 'raster') s.linie(LINKS, y, RECHTS, y, { staerke: 0.35, farbe: FARBE.linie });
    };

    tabellenkopf();
    b.zeilen.forEach((z, zi) => {
      const nameZeilen = umbrechen(z.name || '', nameSpalte.breite - 2 * PAD, fs, 'normal');
      const beschrZeilen = z.beschreibung ? umbrechen(z.beschreibung, nameSpalte.breite - 2 * PAD, fs * 0.88) : [];
      const h = 2 * PAD + nameZeilen.length * zh + beschrZeilen.length * fs * 0.88 * 1.38 + (beschrZeilen.length ? 0.6 * MM : 0);
      if (y + h > UNTEN) { neueSeite(); tabellenkopf(); }
      if (stil === 'streifen' && zi % 2 === 1) s.rechteck(LINKS, y, BREITE, h, { fuellung: streifen });
      const by = y + PAD + fs * 0.95;
      const einheit = einheitText(z);
      const werte = {
        nr: String(z.nr),
        menge: mitEinheit ? mengeText(z.menge) : `${mengeText(z.menge)} ${einheit}`.trim(),
        // Passt ein eigener Einheitentext nicht in die Spalte, steht dort der Kurzname zum Code.
        einheit: mitEinheit && textBreite(einheit, fs) > spalten.find((c) => c.key === 'einheit').breite - 2 * PAD ? einheitKurz(z.einheit) : einheit,
        preis: betragText(z.preis, w),
        satz: satzText(z.satz),
        netto: betragText(z.netto, w),
      };
      for (const c of spalten) {
        if (c.key === 'name') continue;
        let t = werte[c.key] || '';
        if (c.key === 'menge' && !mitEinheit && textBreite(t, fs) > c.breite - 2 * PAD) t = `${mengeText(z.menge)} ${einheitKurz(z.einheit)}`;
        while (textBreite(t, fs) > c.breite - 2 * PAD && t.length > 1) t = t.slice(0, -1);
        const tx = c.rechts ? c.x + c.breite - PAD - textBreite(t, fs) : c.x + PAD;
        s.text(tx, by, t, { groesse: fs, farbe: c.key === 'nr' ? FARBE.grau : TEXT });
      }
      let ny = by;
      for (const t of nameZeilen) { s.text(nameSpalte.x + PAD, ny, t, { groesse: fs, farbe: TEXT }); ny += zh; }
      if (beschrZeilen.length) ny += 0.4 * MM - zh + fs * 0.88 * 1.38;
      for (const t of beschrZeilen) { s.text(nameSpalte.x + PAD, ny, t, { groesse: fs * 0.88, farbe: FARBE.grau }); ny += fs * 0.88 * 1.38; }
      senkrechte(y, y + h);
      y += h;
      if (stil !== 'streifen') s.linie(LINKS, y, RECHTS, y, { staerke: 0.35, farbe: FARBE.linie });
    });
    if (!b.zeilen.length) {
      y += PAD + fs;
      s.text(LINKS + PAD, y, 'Noch keine Positionen.', { groesse: fs, farbe: FARBE.grau });
      y += PAD + 2 * MM;
    }

    /* ------------------------------ Summen ------------------------------- */

    const summen = [];
    if (mitSteuer || b.steuer) {
      summen.push({ label: 'Summe netto', wert: betragText(b.netto, w) });
      for (const g of b.steuern) {
        if (g.kategorie === 'S' || g.satz) summen.push({ label: `zzgl. USt ${satzText(g.satz)} auf ${betragText(g.basis, w)}`, wert: betragText(g.steuer, w), grau: true });
        else if (b.steuern.length > 1) summen.push({ label: `USt 0 % auf ${betragText(g.basis, w)}`, wert: betragText(0, w), grau: true });
      }
    }
    summen.push({ label: gutschrift ? 'Gutschriftbetrag' : 'Gesamtbetrag', wert: betragText(b.brutto, w), fett: true, linie: true });
    if (b.bereitsGezahlt) {
      // § 14 Abs. 5 Satz 2 UStG: Anzahlungen samt der Steuer darauf absetzen.
      const teile = anzahlungTeile(b).filter((t) => t.brutto);
      if ((mitSteuer || b.steuer) && teile.some((t) => t.satz)) {
        for (const t of teile) {
          const mehrere = teile.length > 1;
          summen.push({ label: `abzüglich Anzahlung netto${mehrere ? ` (${satzText(t.satz)})` : ''}`, wert: betragText(-t.netto, w), grau: true });
          if (t.satz) summen.push({ label: `abzüglich USt ${satzText(t.satz)} auf die Anzahlung`, wert: betragText(-t.steuer, w), grau: true });
        }
      } else {
        summen.push({ label: 'abzüglich bereits gezahlt', wert: betragText(-b.bereitsGezahlt, w), grau: true });
      }
      summen.push({ label: b.zahlbetrag < 0 ? 'Guthaben' : 'Noch zu zahlen', wert: betragText(b.zahlbetrag, w), fett: true });
    }
    const SB = Math.min(BREITE, 88 * MM);
    const hSummen = summen.length * zh * 1.15 + 6 * MM;
    if (y + hSummen > UNTEN) neueSeite();
    y += 3 * MM;
    for (const z of summen) {
      if (z.linie) {
        s.linie(RECHTS - SB, y - 0.5 * MM, RECHTS, y - 0.5 * MM, { staerke: schlicht ? 0.6 : 0.9, farbe: schlicht ? TEXT : akzent });
        y += 1.5 * MM;
      }
      y += zh * 1.1;
      const g = z.fett ? fs + 1 : fs;
      s.text(RECHTS - SB, y - zh * 0.3, z.label, { groesse: z.grau ? fs * 0.92 : g, schrift: z.fett ? 'fett' : 'normal', farbe: z.grau ? FARBE.grau : TEXT });
      s.text(RECHTS - textBreite(z.wert, g, z.fett ? 'fett' : 'normal'), y - zh * 0.3, z.wert, { groesse: g, schrift: z.fett ? 'fett' : 'normal', farbe: TEXT });
    }
    y += 6 * MM;
  };

  /* ------------------------------ Hinweise --------------------------------- */

  const hinweise = () => {
    if (b.grund) absatz(b.grund, { schrift: 'fett', abstand: 2 * MM });
    if (r.hinweisAufbewahrung) absatz(AUFBEWAHRUNG_TEXT, { abstand: 2 * MM });
    const zahlung = zahlungsText(r);
    if (zahlung && (b.zahlbetrag > 0 || String(r.zahlungsbedingungen || '').trim())) absatz(zahlung, { abstand: 1 * MM });
    if (r.zahlungsart === 'ueberweisung' && v.iban && b.zahlbetrag > 0 && !gutschrift) {
      const iban = v.iban.replace(/(.{4})/g, '$1 ').trim();
      absatz(`Bankverbindung: ${[v.kontoinhaber, v.bank, `IBAN ${iban}`, v.bic ? `BIC ${v.bic}` : ''].filter(Boolean).join(', ')}`, { abstand: 1 * MM });
      if (r.nummer) absatz(`Verwendungszweck: ${r.nummer}`, { abstand: 2 * MM });
    } else if (b.zahlbetrag > 0 && !gutschrift && r.zahlungsart && r.zahlungsart !== 'ueberweisung' && r.zahlungsart !== 'bar') {
      absatz(`Zahlungsart: ${ZAHLUNGSARTEN[r.zahlungsart]?.name || ''}`, { abstand: 2 * MM });
    }
    if (b.zahlbetrag < 0 && !r.storno) absatz(`Den Betrag von ${betragText(-b.zahlbetrag, w)} erstatten wir Ihnen.`, { abstand: 2 * MM });
    y += 3 * MM;
  };

  /* ---------------------------- Bilder im Fluss ---------------------------- */

  const bildImFluss = (name, bild, breiteMm, maxHoeheMm) => {
    const m = bildMass(bild, Math.min(breiteMm, BREITE / MM), maxHoeheMm);
    if (!m) return;
    if (y + m.h > UNTEN) neueSeite();
    s.bild(name, LINKS, y, m.w, m.h);
    y += m.h + 3 * MM;
  };

  // Bilder dieser Rechnung (etwa Fotos der Arbeit): nebeneinander, solange sie passen.
  const rechnungsbilder = () => {
    const liste = (Array.isArray(r.bilder) ? r.bilder : []).filter((x) => x?.bildId && bilder.frei?.[x.bildId]);
    if (!liste.length) return;
    let x = LINKS;
    let zeilenHoehe = 0;
    for (const e of liste) {
      const m = bildMass(bilder.frei[e.bildId], Math.min(zwischen(e.breite, 10, 165, 60), BREITE / MM), 110);
      if (!m) continue;
      const unter = String(e.text || '').trim() ? umbrechen(e.text, m.w, fs * 0.85) : [];
      const h = m.h + (unter.length ? 1.5 * MM + unter.length * fs * 0.85 * 1.3 : 0);
      if (x > LINKS && x + m.w > RECHTS + 0.5) { y += zeilenHoehe + 4 * MM; x = LINKS; zeilenHoehe = 0; }
      if (y + h > UNTEN) { neueSeite(); x = LINKS; zeilenHoehe = 0; }
      s.bild(bildName('frei', e.bildId), x, y, m.w, m.h);
      unter.forEach((t, i) => s.text(x, y + m.h + 1.5 * MM + fs * 0.85 * (0.8 + i * 1.3), t, { groesse: fs * 0.85, farbe: FARBE.grau }));
      zeilenHoehe = Math.max(zeilenHoehe, h);
      x += m.w + 4 * MM;
    }
    y += zeilenHoehe + 4 * MM;
  };

  const fluss = {
    kopftext: () => { if (r.kopftext) absatz(r.kopftext, { abstand: 4 * MM }); },
    tabelle,
    hinweise,
    schlusstext: () => { if (r.schlusstext) absatz(r.schlusstext, { abstand: 2 * MM }); },
    bilder: rechnungsbilder,
    bild: () => { if (d.bildPosition !== 'fuss' && bilder.bild) bildImFluss(bildName('bild'), bilder.bild, d.bildBreite || 45, 30); },
  };
  for (const key of d.reihenfolge) fluss[key]?.();

  if (eRechnung && d.hinweisERechnung !== false) {
    y += 2 * MM;
    absatz(`Diese Rechnung enthält ihre Daten zusätzlich maschinenlesbar als E-Rechnung (${profil === 'xrechnung' ? 'XRechnung' : 'ZUGFeRD / Factur-X, Profil EN 16931'}).`,
      { groesse: fs * 0.78, farbe: FARBE.hell });
  }

  // Ohne Fußzeile: was sonst dort steht und Pflicht ist (§ 14 Abs. 4 Nr. 1 UStG, § 35a GmbHG, § 37a HGB).
  if (d.fusszeile === false) {
    const anschriftSichtbar = mitAbsender || kopfMitAnschrift;
    const pflicht = [
      anschriftSichtbar ? '' : [v.name, v.strasse, [v.plz, v.ort].filter(Boolean).join(' '), v.land && v.land !== 'DE' ? LAENDER[v.land]?.name : ''].filter(Boolean).join(', '),
      v.ustId && v.steuernummer ? `Steuernr. ${v.steuernummer}` : '',
      v.register,
      v.geschaeftsfuehrung ? `Geschäftsführung: ${v.geschaeftsfuehrung}` : '',
    ].filter(Boolean);
    if (pflicht.length) { y += 1 * MM; absatz(pflicht.join(' · '), { groesse: fs * 0.78, farbe: FARBE.grau }); }
  }

  /* ------------------------------- Fußzeile -------------------------------- */

  const spaltenFuss = d.fusszeile !== false ? [
    [v.name, v.strasse, [v.plz, v.ort].filter(Boolean).join(' '), v.land && v.land !== 'DE' ? LAENDER[v.land]?.name : ''],
    [v.telefon ? `Tel. ${v.telefon}` : '', v.email, v.web],
    [v.bank, v.iban ? `IBAN ${v.iban.replace(/(.{4})/g, '$1 ').trim()}` : '', v.bic ? `BIC ${v.bic}` : ''],
    [v.steuernummer ? `Steuernr. ${v.steuernummer}` : '', v.ustId ? `USt-IdNr. ${v.ustId}` : '', v.register, v.geschaeftsfuehrung ? `GF: ${v.geschaeftsfuehrung}` : ''],
  ].map((sp) => sp.filter(Boolean)).filter((sp) => sp.length) : [];
  const gesamt = seiten.length;
  seiten.forEach((seite, i) => {
    const fy = 297 * MM - fussHoehe + 4 * MM;
    if (fussBildMass) seite.bild(bildName('bild'), (210 * MM - fussBildMass.w) / 2, fy - fussBildMass.h - 5 * MM, fussBildMass.w, fussBildMass.h);
    if (spaltenFuss.length) {
      seite.linie(LINKS, fy, RECHTS, fy, { staerke: 0.4, farbe: schlicht ? FARBE.linie : aufgehellt(akzent, 0.55) });
      // Spalten so breit wie ihr längster Eintrag; reicht der Platz nicht, wird die Schrift kleiner.
      // Abgeschnitten wird nichts: eine IBAN ohne letzte Ziffern wäre schlimmer als kleine Schrift.
      const LUECKE = 4 * MM;
      const roh = spaltenFuss.map((sp, si) => Math.max(...sp.slice(0, 4).map((z, zi) => textBreite(z, 6.8, zi === 0 && si === 0 ? 'fett' : 'normal'))));
      const bedarf = roh.reduce((a, x) => a + x, 0) + LUECKE * (spaltenFuss.length - 1);
      const g = bedarf > BREITE ? Math.max(5, (6.8 * (BREITE - LUECKE * (spaltenFuss.length - 1))) / (bedarf - LUECKE * (spaltenFuss.length - 1))) : 6.8;
      const breiten = roh.map((x) => (x * g) / 6.8);
      const rest = Math.max(0, BREITE - breiten.reduce((a, x) => a + x, 0) - LUECKE * (spaltenFuss.length - 1));
      let fx = LINKS;
      spaltenFuss.forEach((sp, si) => {
        sp.slice(0, 4).forEach((z, zi) => {
          seite.text(fx, fy + 4 * MM + zi * g * 1.36, z, { groesse: g, farbe: FARBE.grau, schrift: zi === 0 && si === 0 ? 'fett' : 'normal' });
        });
        fx += breiten[si] + LUECKE + (spaltenFuss.length > 1 ? rest / (spaltenFuss.length - 1) : 0);
      });
    }
    if (gesamt > 1) {
      const t = `Seite ${i + 1} von ${gesamt}`;
      seite.text(RECHTS - textBreite(t, 7), fy - 2 * MM, t, { groesse: 7, farbe: FARBE.hell });
    }
  });

  /* ------------------- Briefpapier und eigene Elemente --------------------- */

  const ersetzen = (text, nr) => String(text ?? '').replace(/\{(\w+)\}/g, (m, key) => ({
    nummer: r.nummer || 'Entwurf',
    datum: d8(r.datum),
    faellig: d8(faelligkeit(r)),
    kunde: k.name || '',
    betrag: betragText(b.brutto, w),
    firma: v.name || '',
    seite: String(nr),
  }[key] ?? m));

  /** Zeichnet ein eigenes Element; Rückgabe: seine Maße in Punkt (für den Gestalter). */
  const elementZeichnen = (seite, e, nr) => {
    const x = Number(e.x) * MM || 0;
    const ey = Number(e.y) * MM || 0;
    const breite = Math.max(1, zwischen(e.b, 1, 297, 40)) * MM;
    if (e.art === 'bild') {
      const bild = bilder.frei?.[e.bildId];
      const m = bild ? bildMass(bild, breite / MM, 297) : null;
      if (!m) return { x, y: ey, b: breite, h: 20 * MM, leer: true };
      seite.bild(bildName('frei', e.bildId), x, ey, m.w, m.h);
      return { x, y: ey, b: m.w, h: m.h };
    }
    if (e.art === 'text') {
      const g = zwischen(e.groesse, 5, 60, 10);
      const schrift = e.fett ? 'fett' : 'normal';
      const zeilen = umbrechen(ersetzen(e.text, nr), breite, g, schrift);
      const lh = g * 1.3;
      const oben = g * ((SCHRIFTMASS.versal || 710) / 1000) + g * 0.12;
      zeilen.forEach((t, i) => {
        const tw = textBreite(t, g, schrift);
        const tx = e.ausrichtung === 'rechts' ? x + breite - tw : e.ausrichtung === 'mitte' ? x + (breite - tw) / 2 : x;
        seite.text(tx, ey + oben + i * lh, t, { groesse: g, schrift, farbe: hexOk(e.farbe) ? e.farbe : TEXT });
      });
      return { x, y: ey, b: breite, h: Math.max(lh, zeilen.length * lh) };
    }
    if (e.art === 'flaeche') {
      const h = Math.max(0.2, zwischen(e.h, 0.2, 297, 10)) * MM;
      const fuellung = hexOk(e.fuellung) ? e.fuellung : null;
      const rand = hexOk(e.rand) ? e.rand : null;
      seite.rechteck(x, ey, breite, h, { fuellung, rand: rand || (fuellung ? null : FARBE.linie), staerke: zwischen(e.staerke, 0.1, 10, 0.5) });
      return { x, y: ey, b: breite, h };
    }
    if (e.art === 'linie') {
      const st = zwischen(e.staerke, 0.1, 10, 0.8);
      const f = hexOk(e.farbe) ? e.farbe : TEXT;
      if (e.richtung === 'senkrecht') {
        seite.linie(x, ey, x, ey + breite, { staerke: st, farbe: f });
        return { x: x - 1.5 * MM, y: ey, b: 3 * MM, h: breite };
      }
      seite.linie(x, ey, x + breite, ey, { staerke: st, farbe: f });
      return { x, y: ey - 1.5 * MM, b: breite, h: 3 * MM };
    }
    return null;
  };

  seiten.forEach((seite, i) => {
    const erste = i === 0;
    const passt = (e) => e.seiten === 'alle' || erste;
    // Hinten: Briefpapier und Elemente der Ebene „hinten“; sie liegen unter dem Inhalt.
    const hinten = new Seite();
    if (bilder.briefpapier && (d.briefpapierSeiten !== 'erste' || erste)) hinten.bild(bildName('briefpapier'), 0, 0, 210 * MM, 297 * MM);
    const vorne = new Seite();
    for (const e of d.elemente) {
      if (!passt(e)) continue;
      const m = elementZeichnen(e.ebene === 'vorne' ? vorne : hinten, e, i + 1);
      if (erste && m) bereiche.push({ key: `el:${e.id}`, ...m, anker: { x: Number(e.x) * MM || 0, y: Number(e.y) * MM || 0 } });
    }
    seite.ops = [...hinten.ops, ...seite.ops, ...vorne.ops];
    seite.elemente = [...hinten.elemente, ...seite.elemente, ...vorne.elemente];
    for (const n of [...hinten.bilder, ...vorne.bilder]) seite.bilder.add(n);
  });

  return { seiten, titelText, bereiche };
}

/** Dateiname des PDFs. */
export function pdfDateiname(r) {
  const nr = String(r.nummer || 'Entwurf').replace(/[^\w.-]+/g, '_');
  return `${r.storno ? 'Stornorechnung' : (r.art === '381' ? 'Gutschrift' : 'Rechnung')}_${nr}.pdf`;
}
