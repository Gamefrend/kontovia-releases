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

const FARBE = { text: '#14181d', grau: '#5b6270', hell: '#6b7280', linie: '#d5d9e0', zart: '#eef0f3' };
const d8 = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');
const hexOk = (f) => /^#[0-9a-f]{6}$/i.test(String(f || ''));
const zwischen = (n, lo, hi, vorgabe) => (Number.isFinite(Number(n)) && n !== '' && n !== null ? Math.min(hi, Math.max(lo, Number(n))) : vorgabe);

/** Mischung einer Farbe mit Weiß (Anteil 0–1 der Farbe). */
function aufgehellt(hex, anteil) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return FARBE.zart;
  return '#' + [m[1], m[2], m[3]].map((h) => Math.round(255 - (255 - parseInt(h, 16)) * anteil).toString(16).padStart(2, '0')).join('');
}

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  return m ? [m[1], m[2], m[3]].map((h) => parseInt(h, 16)) : null;
};
const leuchtdichte = (hex) => {
  const c = rgb(hex) || [0, 0, 0];
  const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Kontrastverhältnis zweier Farben nach WCAG (1 bis 21). */
export function kontrast(a, b) {
  const [hi, lo] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mischung zweier Farben: anteil (0–1) ist der Anteil von `mit`. */
export function mischen(hex, mit, anteil) {
  const p = rgb(hex);
  const q = rgb(mit);
  if (!p || !q) return hex;
  return '#' + p.map((x, i) => Math.round(x * (1 - anteil) + q[i] * anteil).toString(16).padStart(2, '0')).join('');
}

/** Die Farbe, bei Bedarf so weit abgedunkelt, dass sie als Schrift auf Weiß gut lesbar ist (Kontrast mindestens 4,5). */
export function lesbar(hex, mindestens = 4.5) {
  if (!rgb(hex)) return FARBE.text;
  for (let a = 0; a <= 1.0001; a += 0.05) {
    const c = mischen(hex, '#000000', a);
    if (kontrast(c, '#ffffff') >= mindestens) return c;
  }
  return '#000000';
}

/** Ist eine Schriftfarbe auf Weiß schlecht lesbar (sie steht dann auf eigenem dunklem Grund)? */
const hell = (hex) => kontrast(hex, '#ffffff') < 3;

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
 * Die Gestaltung darf alles verschieben, färben und ergänzen, aber nie die
 * Rechnung beschädigen. Dafür sorgen diese Regeln:
 *  - Kopf, Anschrift und Infoblock bleiben auf der Seite und überlappen sich
 *    nicht; wer im Weg steht, rückt nach unten.
 *  - Eigene Texte und Bilder weichen diesen Blöcken aus. Der Inhalt (Titel,
 *    Tabelle, Hinweise) weicht allen Blöcken und eigenen Texten und Bildern aus.
 *  - Eigene Flächen und Linien liegen immer hinter dem Inhalt, und eine Fläche
 *    wird unter Text so weit aufgehellt, dass der Text lesbar bleibt.
 *  - Schrift und Tabellenkopf behalten genug Kontrast, egal welche Farbe
 *    gewählt wurde.
 *  - Beträge, Mengen und Nummern werden nie abgeschnitten; die Spalten richten
 *    sich nach dem Inhalt, im Notfall wird die Tabellenschrift kleiner.
 *
 * bereiche: die anklickbaren Teile der ersten Seite mit ihren Maßen in Punkt,
 * für den Gestalter (views/rechnungsgestalter.js). Mit `anker` die Stelle, an
 * der der Teil tatsächlich steht (nach dem Ausweichen), mit `art: 'fluss'` die
 * Teile im Fluss (nur in der Reihenfolge änderbar), mit `fest` unverrückbare.
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
  const akzentText = lesbar(akzent); // Akzentfarbe als Schrift auf Weiß
  const TEXT = lesbar(hexOk(d.textfarbe) ? d.textfarbe : FARBE.text, 5.4); // trägt auch auf dem grauen Tabellenkopf
  const layout = ['klassisch', 'modern', 'schlicht'].includes(d.layout) ? d.layout : 'klassisch';
  const schlicht = layout === 'schlicht';
  const fs = Math.min(11, Math.max(8, Number(d.schriftgroesse) || 9.5));
  const zh = fs * 1.42; // Zeilenhöhe
  const pos = d.positionen || {};
  const punkt = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x) * MM, y: Number(p.y) * MM } : null);

  const SB_SEITE = 210 * MM;
  const SH_SEITE = 297 * MM;
  const RAND_MIN = 4 * MM;
  const LINKS = zwischen(d.randLinks, 8, 45, 25) * MM;
  const RECHTS = SB_SEITE - zwischen(d.randRechts, 8, 45, 20) * MM;
  const BREITE = RECHTS - LINKS;
  const fussHoehe = d.fusszeile !== false ? 24 * MM : 12 * MM;
  const fussBildMass = d.bildPosition === 'fuss' && bilder.bild ? bildMass(bilder.bild, d.bildBreite || 45, 18) : null;
  const UNTEN = SH_SEITE - fussHoehe - (fussBildMass ? fussBildMass.h + 4 * MM : 0) - 6 * MM;

  const seiten = [];
  const bereiche = [];
  let s = null;
  let y = 0;
  let seitenStart = 0; // y am Anfang der aktuellen Seite
  let ende1 = null; // y am Ende der ersten Seite, falls der Inhalt weiterläuft
  const titelText = `${titelVon(r)} ${r.nummer || '(Entwurf)'}`;

  /* ------------------------------ Seitenrahmen ----------------------------- */

  function rahmen(seite) {
    if (layout === 'modern') seite.rechteck(0, 0, SB_SEITE, 6 * MM, { fuellung: akzent });
    if (d.falzmarken !== false) {
      for (const mm of [105, 210]) seite.linie(3 * MM, mm * MM, 8 * MM, mm * MM, { staerke: 0.4, farbe: FARBE.hell });
      seite.linie(3 * MM, 148.5 * MM, 6 * MM, 148.5 * MM, { staerke: 0.4, farbe: FARBE.hell });
    }
  }

  function neueSeite() {
    if (seiten.length === 1 && ende1 === null) ende1 = y;
    s = new Seite();
    seiten.push(s);
    rahmen(s);
    y = (layout === 'modern' ? 18 : 15) * MM;
    s.text(LINKS, y, titelText, { groesse: fs, schrift: 'fett', farbe: TEXT });
    // Ein sehr langer Name wird in der Kopfzeile gekürzt (er steht vollständig in Anschrift und Fußzeile), damit er den Titel nie überdeckt.
    let kopfName = v.name || '';
    const nameMax = BREITE - textBreite(titelText, fs, 'fett') - 6 * MM;
    if (textBreite(kopfName, fs * 0.85) > nameMax) {
      while (kopfName.length > 1 && textBreite(`${kopfName}...`, fs * 0.85) > nameMax) kopfName = kopfName.slice(0, -1);
      kopfName = `${kopfName.trimEnd()}...`;
    }
    s.text(RECHTS - textBreite(kopfName, fs * 0.85), y, kopfName, { groesse: fs * 0.85, farbe: FARBE.grau });
    y += 4 * MM;
    s.linie(LINKS, y, RECHTS, y, { staerke: 0.4, farbe: FARBE.linie });
    y += 6 * MM;
    seitenStart = y;
  }

  s = new Seite();
  seiten.push(s);
  rahmen(s);

  /* ------------------------- Blöcke: messen und platzieren ------------------ */

  const klemme = (x, yy, bb, hh) => ({
    x: Math.min(Math.max(x, RAND_MIN), Math.max(RAND_MIN, SB_SEITE - RAND_MIN - bb)),
    y: Math.min(Math.max(yy, RAND_MIN), Math.max(RAND_MIN, UNTEN - hh)),
  });
  const schneidet = (p, q, abstand = 2 * MM) => p.x < q.x + q.b + abstand && p.x + p.b + abstand > q.x && p.y < q.y + q.h + abstand && p.y + p.h + abstand > q.y;
  /**
   * Rückt einen Block unter (sonst über) alles, womit er sich überschneidet; hilft
   * das nicht, wird der nächstgelegene freie Platz auf der Seite gesucht.
   * Rückgabe: Ist der Block jetzt frei?
   */
  function ausweichen(blk, fest) {
    for (let i = 0; i < 8; i++) {
      const treffer = fest.find((f) => schneidet(blk, f));
      if (!treffer) return true;
      const unten = treffer.y + treffer.h + 2 * MM;
      if (unten + blk.h <= UNTEN) blk.y = unten;
      else if (treffer.y - blk.h - 2 * MM >= RAND_MIN) blk.y = treffer.y - blk.h - 2 * MM;
      else break;
    }
    if (!fest.some((f) => schneidet(blk, f))) return true;
    let beste = null;
    for (let yy = RAND_MIN; yy + blk.h <= UNTEN; yy += 3 * MM) {
      for (let xx = RAND_MIN; xx + blk.b <= SB_SEITE - RAND_MIN; xx += 4 * MM) {
        const q = { x: xx, y: yy, b: blk.b, h: blk.h };
        if (fest.some((f) => schneidet(q, f))) continue;
        const abstand = (xx - blk.x) ** 2 + (yy - blk.y) ** 2;
        if (!beste || abstand < beste.abstand) beste = { x: xx, y: yy, abstand };
      }
    }
    if (!beste) return false;
    blk.x = beste.x;
    blk.y = beste.y;
    return true;
  }

  // Kopf: Logo oder Name des Betriebs
  const kopfOben = (layout === 'modern' ? 12 : 10) * MM;
  const logo = bilder.logo ? bildMass(bilder.logo, d.logoBreite || 40, 28) : null;
  let kopf = null;
  let kopfMitAnschrift = false;
  if (logo) {
    kopf = {
      b: logo.w, h: logo.h, logo: true,
      standard: { x: d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (SB_SEITE - logo.w) / 2 : RECHTS - logo.w, y: kopfOben },
      zeichnen: (x, yy) => s.bild(bildName('logo'), x, yy, logo.w, logo.h),
    };
  } else if (v.name && d.firmenkopf !== false) {
    // Ohne Logo steht der Name des Betriebs im Kopf, ohne Fußzeile mit Anschrift darunter.
    const g = 15;
    const zeilen = [{ t: v.name, g, schrift: 'fett', farbe: schlicht ? TEXT : akzentText }];
    if (d.fusszeile === false) {
      kopfMitAnschrift = true;
      for (const z of [v.strasse, [v.plz, v.ort].filter(Boolean).join(' '), v.telefon, v.email].filter(Boolean)) zeilen.push({ t: z, g: fs * 0.85, schrift: 'normal', farbe: FARBE.grau });
    }
    const bw = Math.min(Math.max(...zeilen.map((z) => textBreite(z.t, z.g, z.schrift))), RECHTS - LINKS);
    // Ein sehr langer Name bricht um, statt über die Seite zu laufen.
    const zeilenUmbrochen = zeilen.flatMap((z) => umbrechen(z.t, bw, z.g, z.schrift).map((t) => ({ ...z, t })));
    let hh = g * 0.75;
    zeilenUmbrochen.forEach((z, i) => { hh += i === 0 ? 5 * MM : fs * 1.25; });
    hh -= fs * 0.6;
    kopf = {
      b: bw, h: hh,
      standard: { x: d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (SB_SEITE - bw) / 2 : RECHTS - bw, y: kopfOben + 3 * MM },
      zeichnen: (bx, by) => {
        let zy = by + g * 0.75;
        zeilenUmbrochen.forEach((z, i) => {
          const tw = textBreite(z.t, z.g, z.schrift);
          const zx = d.logoPosition === 'links' ? bx : d.logoPosition === 'mitte' ? bx + (bw - tw) / 2 : bx + bw - tw;
          s.text(zx, zy, z.t, { groesse: z.g, schrift: z.schrift, farbe: z.farbe });
          zy += i === 0 ? 5 * MM : fs * 1.25;
        });
      },
    };
  }

  // Rücksendeangabe und Anschrift (Fenster: 45 mm von oben, 20 mm vom Rand, 85 × 45 mm)
  const absender = [v.name, v.strasse, [v.plz, v.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  let ab = absender;
  while (ab && textBreite(ab, 6.8) > 85 * MM) ab = ab.slice(0, -1);
  const mitAbsender = !!ab && d.absenderzeile !== false;
  const anschrift = [k.name, k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')];
  if (k.land && k.land !== (v.land || 'DE')) anschrift.push((LAENDER[k.land]?.name || k.land).toUpperCase());
  // Lange Namen werden umbrochen statt abgeschnitten: Der Name des Kunden ist Pflicht.
  const anschriftZeilen = anschrift.filter(Boolean).flatMap((z) => umbrechen(z, 80 * MM, fs + 0.5)).slice(0, 8);
  const anschriftBlock = {
    b: 85 * MM,
    h: Math.max(40 * MM, 11 * MM + anschriftZeilen.length * (fs + 0.5) * 1.3),
    standard: { x: LINKS, y: 55 * MM },
    zeichnen: (ax, ay0) => {
      if (mitAbsender) {
        s.text(ax, ay0 + 4.5 * MM, ab, { groesse: 6.8, farbe: FARBE.grau });
        s.linie(ax, ay0 + 5.6 * MM, ax + textBreite(ab, 6.8), ay0 + 5.6 * MM, { staerke: 0.3, farbe: FARBE.hell });
      }
      let ay = ay0 + 11 * MM;
      for (const t of anschriftZeilen) {
        s.text(ax, ay, t, { groesse: fs + 0.5, farbe: TEXT });
        ay += (fs + 0.5) * 1.3;
      }
    },
  };

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
  const INFO_X = Math.min(Math.max(125 * MM, LINKS + 90 * MM), 155 * MM);
  const IB = Math.max(50 * MM, Math.min(80 * MM, RECHTS - INFO_X));
  const ig = fs * 0.88;
  const labelBreite = Math.max(...info.map(([l]) => textBreite(l, ig)));
  // Werte werden umbrochen statt gekürzt (eine gekürzte Nummer wäre falsch).
  const infoZeilen = info.map(([label, wert]) => ({ label, zeilen: umbrechen(String(wert), Math.max(20 * MM, IB - labelBreite - 3 * MM), ig) }));
  const infoH = 3 * MM + infoZeilen.reduce((n, z) => n + (z.zeilen.length - 1) * ig * 1.3 + ig * 1.55, 0) - ig * 0.6;
  const infoBlock = {
    b: IB, h: infoH,
    standard: { x: INFO_X, y: 49 * MM },
    zeichnen: (ix, iy0) => {
      let iy = iy0 + 3 * MM;
      for (const z of infoZeilen) {
        s.text(ix, iy, z.label, { groesse: ig, farbe: FARBE.grau });
        z.zeilen.forEach((t, i) => {
          s.text(ix + IB - textBreite(t, ig), iy, t, { groesse: ig, farbe: TEXT });
          if (i < z.zeilen.length - 1) iy += ig * 1.3;
        });
        iy += ig * 1.55;
      }
    },
  };

  // Platzieren: erst Anschrift (Fenster), dann Info, dann Kopf. Wer später kommt, weicht aus.
  const bloecke = [];
  const platziere = (key, blk) => {
    const wunsch = punkt(pos[key]) || blk.standard;
    const p = { key, b: blk.b, h: blk.h, ...klemme(wunsch.x, wunsch.y, blk.b, blk.h), blk };
    // Der Kopf (Logo, Name) ist entbehrlich: Findet er keinen freien Platz, entfällt er.
    if (!ausweichen(p, bloecke) && key === 'kopf') return null;
    bloecke.push(p);
    return p;
  };
  const pAnschrift = platziere('anschrift', anschriftBlock);
  const pInfo = platziere('info', infoBlock);
  const pKopf = kopf ? platziere('kopf', kopf) : null;
  if (kopf && !pKopf) kopfMitAnschrift = false;

  // Eigene Texte und Bilder: stehen, wo sie hingezogen wurden, weichen aber den Blöcken aus.
  const ersetzen = (text, nr) => String(text ?? '').replace(/\{(\w+)\}/g, (m, key) => ({
    nummer: r.nummer || 'Entwurf',
    datum: d8(r.datum),
    faellig: d8(faelligkeit(r)),
    kunde: k.name || '',
    betrag: betragText(b.brutto, w),
    firma: v.name || '',
    seite: String(nr),
  }[key] ?? m));

  /** Maße eines eigenen Elements in Punkt (ohne zu zeichnen). */
  const elementMass = (e, nr = 1) => {
    const x = Number(e.x) * MM || 0;
    const ey = Number(e.y) * MM || 0;
    const breite = Math.max(1, zwischen(e.b, 0.5, 297, 40)) * MM;
    if (e.art === 'bild') {
      const bild = bilder.frei?.[e.bildId];
      const m = bild ? bildMass(bild, Math.min(breite / MM, 210), 297) : null;
      if (!m) return { x, y: ey, b: Math.min(breite, SB_SEITE), h: 20 * MM, leer: true };
      return { x, y: ey, b: m.w, h: m.h, m };
    }
    if (e.art === 'text') {
      const g = zwischen(e.groesse, 5, 60, 10);
      const schrift = e.fett ? 'fett' : 'normal';
      const zeilen = umbrechen(ersetzen(e.text, nr), breite, g, schrift);
      const lh = g * 1.3;
      return { x, y: ey, b: breite, h: Math.max(lh, zeilen.length * lh), g, schrift, zeilen, lh };
    }
    if (e.art === 'flaeche') return { x, y: ey, b: breite, h: Math.max(0.2, zwischen(e.h, 0.2, 297, 10)) * MM };
    if (e.art === 'linie') {
      const st = zwischen(e.staerke, 0.1, 10, 0.8);
      return e.richtung === 'senkrecht'
        ? { x: x - 1.5 * MM, y: ey, b: 3 * MM, h: breite, st, senkrecht: true, ax: x, ay: ey }
        : { x, y: ey - 1.5 * MM, b: breite, h: 3 * MM, st, ax: x, ay: ey };
    }
    return null;
  };

  // Die Fußzeile (mit Seitenzahl und Bild darüber) bleibt frei.
  const fussOben = SH_SEITE - fussHoehe - (fussBildMass ? fussBildMass.h + 5 * MM : 0) - 1 * MM;
  const fussSperre = { x: 0, y: fussOben, b: SB_SEITE, h: SH_SEITE - fussOben };
  const ePlatz = new Map(); // id → { x, y } nach dem Ausweichen (Punkt)
  const elementSperren = [];
  for (const e of d.elemente) {
    if (e.art !== 'text' && e.art !== 'bild') continue;
    const m = elementMass(e);
    if (!m || m.leer) continue;
    const p = { x: Math.min(Math.max(m.x, 0), Math.max(0, SB_SEITE - m.b)), y: Math.min(Math.max(m.y, 0), Math.max(0, SH_SEITE - m.h)), b: m.b, h: m.h };
    const fest = [...bloecke, fussSperre];
    // Findet ein Element keinen freien Platz, wird es nicht gedruckt: Pflichtangaben gehen vor.
    if (!ausweichen(p, fest) || fest.some((f) => schneidet(p, f, 0))) { ePlatz.set(e.id, { versteckt: true }); continue; }
    ePlatz.set(e.id, { x: p.x, y: p.y });
    elementSperren.push({ ...p, seiten: e.seiten });
  }

  // Blöcke zeichnen und für den Gestalter melden
  for (const p of bloecke) {
    p.blk.zeichnen(p.x, p.y);
    bereiche.push({ key: p.key, x: p.x, y: p.y, b: p.b, h: p.h, anker: { x: p.x, y: p.y }, ...(p.key === 'kopf' && p.blk.logo ? { logo: true } : {}) });
  }

  /* --------------------------- Platz im Fluss finden ------------------------ */

  const sperrenFuer = (nr) => [...(nr === 1 ? bloecke : []), ...elementSperren.filter((e) => nr === 1 || e.seiten === 'alle')]
    .filter((q) => q.x < RECHTS && q.x + q.b > LINKS);
  /**
   * Macht Platz für eine Einheit der Höhe h ab y: rückt unter Blöcke und eigene
   * Elemente und beginnt bei Bedarf eine neue Seite. Rückgabe: wurde eine
   * Seite begonnen?
   */
  function platz(h, oben = 0) {
    let neu = false;
    let frisch = false;
    for (let n = 0; n < 60; n++) {
      if (y + h > UNTEN && y > seitenStart + 0.5 && !frisch) { neueSeite(); neu = true; frisch = true; continue; }
      // oben: so weit ragt die Einheit über y hinaus (bei Text die Höhe der Buchstaben über der Grundlinie)
      const t = sperrenFuer(seiten.length).find((q) => q.y < y - oben + h && q.y + q.h + 2 * MM > y - oben);
      if (!t) break;
      // Auf einer frisch begonnenen Seite wird nichts mehr verschoben, sonst gäbe es nie ein Ende.
      if (frisch) break;
      y = t.y + t.h + 2.5 * MM + oben;
    }
    return neu;
  }

  /* ------------------------------ Titel, Text ------------------------------ */

  const inhaltY = pos.inhalt && Number.isFinite(Number(pos.inhalt.y)) ? Math.min(Math.max(Number(pos.inhalt.y) * MM, 30 * MM), UNTEN - 30 * MM) : null;
  const gTitel = Number(d.titelGroesse) > 0 ? zwischen(d.titelGroesse, 10, 30, 15) : (layout === 'modern' ? 17 : 15);
  const unterzeilen = [];
  if (r.betreff) unterzeilen.push(r.betreff);
  if (r.bezug?.nummer) unterzeilen.push(`${r.storno ? 'Storno zur' : 'Bezug:'} Rechnung ${r.bezug.nummer}${r.bezug.datum ? ` vom ${d8(r.bezug.datum)}` : ''}`);
  const unterUmbrochen = unterzeilen.flatMap((z) => umbrechen(z, BREITE, fs + 0.5));
  const titelHoehe = gTitel * 0.8 + gTitel * 0.55 + 2 * MM + unterUmbrochen.length * (fs + 0.5) * 1.35 + 2 * MM;
  // Ohne eigene Angabe beginnt der Titel bei 103 mm, sofern darüber nichts im Weg steht.
  y = (inhaltY ?? 103 * MM) - gTitel * 0.8;
  seitenStart = y;
  platz(titelHoehe);
  y += gTitel * 0.8;
  const titelOben = y - gTitel * 0.8;
  const titelGrundlinie = y;
  s.text(LINKS, y, titelText, { groesse: gTitel, schrift: 'fett', farbe: layout === 'modern' ? akzentText : TEXT });
  y += gTitel * 0.55 + 2 * MM;
  for (const t of unterUmbrochen) { y += (fs + 0.5) * 1.35; s.text(LINKS, y, t, { groesse: fs + 0.5, farbe: FARBE.grau }); }
  bereiche.push({ key: 'inhalt', x: LINKS, y: titelOben, b: BREITE, h: y - titelOben + 2 * MM, anker: { x: LINKS, y: titelGrundlinie } });
  y += 7 * MM;

  const absatz = (text, { groesse = fs, farbe: f = TEXT, schrift = 'normal', abstand = 0 } = {}) => {
    const zeilen = umbrechen(text, BREITE, groesse, schrift);
    for (const z of zeilen) {
      platz(groesse * 1.42, groesse * 0.85);
      if (z) s.text(LINKS, y, z, { groesse, farbe: f, schrift });
      y += groesse * 1.42;
    }
    y += abstand;
  };

  /* ------------------------------- Positionen ------------------------------ */

  const tabelle = () => {
    const titelVonSpalte = (key, vorgabe) => String(d.spaltenTitel?.[key] || '').trim().slice(0, 28) || vorgabe;
    // Bei mehreren Steuersätzen muss erkennbar sein, welcher Posten welchem Satz unterliegt.
    const mitSatz = mitSteuer && (d.spalteSatz !== false || b.steuern.length > 1);
    const PAD = 1.6 * MM;
    const stil = ['flaeche', 'linien', 'streifen', 'raster'].includes(d.tabellenstil) ? d.tabellenstil : (schlicht ? 'linien' : 'flaeche');

    /** Spalten für eine Schriftgröße und Auswahl; die Breiten richten sich nach dem Inhalt. */
    const baue = (tfs, mitNr, mitEinheit) => {
      const werte = (z) => {
        const einheit = einheitText(z);
        return {
          nr: String(z.nr),
          menge: mitEinheit ? mengeText(z.menge) : `${mengeText(z.menge)} ${einheit}`.trim(),
          einheit,
          preis: betragText(z.preis, w),
          satz: satzText(z.satz),
          netto: betragText(z.netto, w),
        };
      };
      const alle = b.zeilen.map(werte);
      const bedarf = (key, titel, min, max = Infinity) => {
        const n = Math.max(textBreite(titel, tfs * 0.86, 'fett'), ...alle.map((x) => textBreite(x[key] || '', tfs)), 0);
        return Math.min(max, Math.max(min, n + 2 * PAD + 1 * MM));
      };
      const spalten = [
        ...(mitNr ? [{ key: 'nr', titel: titelVonSpalte('nr', 'Pos.'), breite: bedarf('nr', titelVonSpalte('nr', 'Pos.'), 9 * MM) }] : []),
        { key: 'name', titel: titelVonSpalte('name', 'Bezeichnung'), breite: 0 },
        { key: 'menge', titel: titelVonSpalte('menge', 'Menge'), breite: bedarf('menge', titelVonSpalte('menge', 'Menge'), (mitEinheit ? 14 : 24) * MM), rechts: true },
        ...(mitEinheit ? [{ key: 'einheit', titel: titelVonSpalte('einheit', 'Einheit'), breite: bedarf('einheit', titelVonSpalte('einheit', 'Einheit'), 16 * MM, 24 * MM) }] : []),
        { key: 'preis', titel: titelVonSpalte('preis', 'Einzelpreis'), breite: bedarf('preis', titelVonSpalte('preis', 'Einzelpreis'), 22 * MM), rechts: true },
        ...(mitSatz ? [{ key: 'satz', titel: titelVonSpalte('satz', 'USt'), breite: bedarf('satz', titelVonSpalte('satz', 'USt'), 11 * MM), rechts: true }] : []),
        { key: 'netto', titel: titelVonSpalte('netto', mitSteuer ? 'Gesamt netto' : 'Gesamt'), breite: bedarf('netto', titelVonSpalte('netto', mitSteuer ? 'Gesamt netto' : 'Gesamt'), 24 * MM), rechts: true },
      ];
      const fest = spalten.reduce((n, c) => n + c.breite, 0);
      const rest = BREITE - fest;
      return { spalten, rest, alle, tfs, mitEinheit };
    };
    // Erst wie gewünscht; passt es nicht, entfällt zuerst die Nummer, dann die Einheitsspalte, dann wird die Schrift kleiner.
    const versuche = [
      [1, d.spalteNr !== false, d.spalteEinheit !== false], [1, false, d.spalteEinheit !== false], [1, false, false],
      [0.92, false, false], [0.85, false, false], [0.78, false, false],
    ];
    let T = null;
    for (const [f, nr, ein] of versuche) { T = baue(fs * f, nr, ein); if (T.rest >= 38 * MM) break; }
    const { spalten, alle, tfs, mitEinheit } = T;
    const nameSpalte = spalten.find((c) => c.key === 'name');
    nameSpalte.breite = Math.max(20 * MM, T.rest);
    let sx = LINKS;
    for (const c of spalten) { c.x = sx; sx += c.breite; }
    const tzh = tfs * 1.42;

    const farbigerKopf = d.tabellenkopfFarbig !== false && (stil === 'flaeche' || stil === 'streifen') && !(schlicht && d.tabellenstil === 'auto');
    // Weiße Schrift auf der Akzentfarbe, wenn sie trägt; sonst dunkle Schrift; sonst wird der Kopf abgedunkelt.
    const weissOk = kontrast('#ffffff', akzent) >= 4.5;
    const dunkelOk = kontrast(TEXT, akzent) >= 4.5;
    const kopfFlaeche = farbigerKopf ? (weissOk || dunkelOk ? akzent : akzentText) : FARBE.zart;
    const kopfText = farbigerKopf ? (kontrast('#ffffff', kopfFlaeche) >= kontrast(TEXT, kopfFlaeche) ? '#ffffff' : TEXT) : TEXT;
    const streifen = aufgehellt(akzent, 0.07);
    const senkrechte = (y1, y2) => {
      if (stil !== 'raster') return;
      for (const c of spalten) s.linie(c.x, y1, c.x, y2, { staerke: 0.35, farbe: FARBE.linie });
      s.linie(RECHTS, y1, RECHTS, y2, { staerke: 0.35, farbe: FARBE.linie });
    };

    const tabellenkopf = () => {
      const h = tfs * 1.9;
      platz(h + tzh * 2);
      if (stil !== 'linien') s.rechteck(LINKS, y, BREITE, h, { fuellung: kopfFlaeche });
      if (stil === 'raster') { s.linie(LINKS, y, RECHTS, y, { staerke: 0.35, farbe: FARBE.linie }); senkrechte(y, y + h); }
      const by = y + h / 2 + tfs * 0.32;
      for (const c of spalten) {
        const g = tfs * 0.86;
        const tx = c.rechts ? c.x + c.breite - PAD - textBreite(c.titel, g, 'fett') : c.x + PAD;
        s.text(tx, by, c.titel, { groesse: g, schrift: 'fett', farbe: kopfText });
      }
      y += h;
      if (stil === 'linien') s.linie(LINKS, y, RECHTS, y, { staerke: 0.8, farbe: TEXT });
      if (stil === 'raster') s.linie(LINKS, y, RECHTS, y, { staerke: 0.35, farbe: FARBE.linie });
    };

    tabellenkopf();
    b.zeilen.forEach((z, zi) => {
      const nameZeilen = umbrechen(z.name || '', nameSpalte.breite - 2 * PAD, tfs, 'normal');
      const beschrZeilen = z.beschreibung ? umbrechen(z.beschreibung, nameSpalte.breite - 2 * PAD, tfs * 0.88) : [];
      const h = 2 * PAD + nameZeilen.length * tzh + beschrZeilen.length * tfs * 0.88 * 1.38 + (beschrZeilen.length ? 0.6 * MM : 0);
      if (platz(h)) { tabellenkopf(); platz(h); }
      if (stil === 'streifen' && zi % 2 === 1) s.rechteck(LINKS, y, BREITE, h, { fuellung: streifen });
      const by = y + PAD + tfs * 0.95;
      const werte = alle[zi];
      const einheitSpalte = spalten.find((c) => c.key === 'einheit');
      // Passt ein eigener Einheitentext nicht in die Spalte, steht dort der Kurzname zum Code.
      if (einheitSpalte && textBreite(werte.einheit, tfs) > einheitSpalte.breite - 2 * PAD) werte.einheit = einheitKurz(z.einheit);
      for (const c of spalten) {
        if (c.key === 'name') continue;
        const t = werte[c.key] || '';
        const tx = c.rechts ? c.x + c.breite - PAD - textBreite(t, tfs) : c.x + PAD;
        s.text(tx, by, t, { groesse: tfs, farbe: c.key === 'nr' ? FARBE.grau : TEXT });
      }
      let ny = by;
      for (const t of nameZeilen) { s.text(nameSpalte.x + PAD, ny, t, { groesse: tfs, farbe: TEXT }); ny += tzh; }
      if (beschrZeilen.length) ny += 0.4 * MM - tzh + tfs * 0.88 * 1.38;
      for (const t of beschrZeilen) { s.text(nameSpalte.x + PAD, ny, t, { groesse: tfs * 0.88, farbe: FARBE.grau }); ny += tfs * 0.88 * 1.38; }
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
    // Der Block ist so breit, dass Beschriftung und Betrag nie ineinanderlaufen.
    const grosse = (z) => (z.fett ? fs + 1 : fs);
    const brauchtBreite = Math.max(...summen.map((z) => textBreite(z.label, z.grau ? fs * 0.92 : grosse(z), z.fett ? 'fett' : 'normal') + textBreite(z.wert, grosse(z), z.fett ? 'fett' : 'normal') + 6 * MM));
    const SB = Math.min(BREITE, Math.max(88 * MM, brauchtBreite));
    const hSummen = summen.length * zh * 1.15 + 6 * MM;
    platz(hSummen);
    y += 3 * MM;
    for (const z of summen) {
      if (z.linie) {
        s.linie(RECHTS - SB, y - 0.5 * MM, RECHTS, y - 0.5 * MM, { staerke: schlicht ? 0.6 : 0.9, farbe: schlicht ? TEXT : akzent });
        y += 1.5 * MM;
      }
      y += zh * 1.1;
      const g = grosse(z);
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
    platz(m.h);
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
      const vorher = y;
      if (platz(h) || y !== vorher) { x = LINKS; zeilenHoehe = 0; }
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
  for (const key of d.reihenfolge) {
    const start = y;
    const auf1 = seiten.length === 1;
    fluss[key]?.();
    // Als Teil im Fluss meldet sich, was (zumindest zum Teil) auf der ersten Seite steht.
    if (auf1) {
      const ende = seiten.length === 1 ? y : (ende1 ?? y);
      if (ende - start > 2 * MM) bereiche.push({ key, art: 'fluss', x: LINKS, y: start, b: BREITE, h: ende - start });
    }
  }

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
  const fy = SH_SEITE - fussHoehe + 4 * MM;
  seiten.forEach((seite, i) => {
    if (fussBildMass) seite.bild(bildName('bild'), (SB_SEITE - fussBildMass.w) / 2, fy - fussBildMass.h - 5 * MM, fussBildMass.w, fussBildMass.h);
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
  bereiche.push({ key: 'fuss', art: 'fest', x: LINKS, y: fy - 2 * MM, b: BREITE, h: fussHoehe - 2 * MM, leer: d.fusszeile === false });

  /* ------------------- Briefpapier und eigene Elemente --------------------- */

  /** Zeichnet ein eigenes Element; Rückgabe: seine Maße in Punkt (für den Gestalter). */
  const elementZeichnen = (seite, e, nr, texteDerSeite, belegt) => {
    const m = elementMass(e, nr);
    if (!m) return null;
    const platzE = ePlatz.get(e.id);
    if (platzE?.versteckt) return { x: m.x, y: m.y, b: m.b, h: m.h, leer: true, keinPlatz: true };
    // Letzte Sicherung: Berührt ein eigener Text oder ein eigenes Bild doch Gedrucktes, wird es nicht gedruckt.
    if ((e.art === 'text' || e.art === 'bild') && !m.leer) {
      const px0 = platzE?.x ?? m.x;
      const py0 = platzE?.y ?? m.y;
      const w0 = e.art === 'bild' ? m.m.w : m.b;
      const h0 = e.art === 'bild' ? m.m.h : m.h;
      if (belegt.some((q) => schneidet({ x: px0, y: py0, b: w0, h: h0 }, q, 0))) return { x: px0, y: py0, b: w0, h: h0, leer: true, keinPlatz: true };
    }
    if (e.art === 'bild') {
      if (m.leer) return { x: m.x, y: m.y, b: m.b, h: m.h, leer: true };
      const px = platzE?.x ?? m.x;
      const py = platzE?.y ?? m.y;
      seite.bild(bildName('frei', e.bildId), px, py, m.m.w, m.m.h);
      return { x: px, y: py, b: m.m.w, h: m.m.h };
    }
    if (e.art === 'text') {
      const px = platzE?.x ?? m.x;
      const py = platzE?.y ?? m.y;
      const oben = m.g * ((SCHRIFTMASS.versal || 710) / 1000) + m.g * 0.12;
      m.zeilen.forEach((t, i) => {
        const tw = textBreite(t, m.g, m.schrift);
        const tx = e.ausrichtung === 'rechts' ? px + m.b - tw : e.ausrichtung === 'mitte' ? px + (m.b - tw) / 2 : px;
        seite.text(tx, py + oben + i * m.lh, t, { groesse: m.g, schrift: m.schrift, farbe: hexOk(e.farbe) ? e.farbe : TEXT });
      });
      return { x: px, y: py, b: m.b, h: m.h };
    }
    if (e.art === 'flaeche') {
      const fuellung = hexOk(e.fuellung) ? fuellungSicher(e.fuellung, m, texteDerSeite) : null;
      const rand = hexOk(e.rand) ? e.rand : null;
      seite.rechteck(m.x, m.y, m.b, m.h, { fuellung, rand: rand || (fuellung ? null : FARBE.linie), staerke: zwischen(e.staerke, 0.1, 10, 0.5) });
      return { x: m.x, y: m.y, b: m.b, h: m.h };
    }
    if (e.art === 'linie') {
      const f = hexOk(e.farbe) ? e.farbe : TEXT;
      if (m.senkrecht) seite.linie(m.ax, m.ay, m.ax, m.ay + m.h, { staerke: m.st, farbe: f });
      else seite.linie(m.ax, m.ay, m.ax + m.b, m.ay, { staerke: m.st, farbe: f });
      return { x: m.x, y: m.y, b: m.b, h: m.h };
    }
    return null;
  };

  /** Eine Fläche unter Text wird so weit aufgehellt, dass dunkle Schrift darauf lesbar bleibt. */
  function fuellungSicher(fuellung, rect, texte) {
    const darunter = texte.filter((t) => t.x < rect.x + rect.b && t.x + t.b > rect.x && t.y < rect.y + rect.h && t.y + t.h > rect.y);
    if (!darunter.length) return fuellung;
    for (let a = 0; a <= 1.0001; a += 0.1) {
      const c = mischen(fuellung, '#ffffff', a);
      if (darunter.every((t) => kontrast(t.farbe, c) >= 4.5)) return c;
    }
    return '#ffffff';
  }

  seiten.forEach((seite, i) => {
    const erste = i === 0;
    const passt = (e) => e.seiten === 'alle' || erste;
    // Dunkle Schrift auf der Seite (helle steht auf eigenem Grund, etwa im Tabellenkopf).
    const texteDerSeite = seite.elemente.filter((e) => e.art === 'text' && !hell(e.farbe))
      .map((e) => ({ x: e.x, y: e.y - e.groesse * 0.78, b: textBreite(e.text, e.groesse, e.schrift), h: e.groesse * 0.98, farbe: e.farbe }));
    const belegt = [
      ...seite.elemente.filter((e) => e.art === 'text').map((e) => ({ x: e.x, y: e.y - e.groesse * 0.8, b: textBreite(e.text, e.groesse, e.schrift), h: e.groesse * 1.05 })),
      ...seite.elemente.filter((e) => e.art === 'bild').map((e) => ({ x: e.x, y: e.y, b: e.b, h: e.h })),
    ];
    // Hinten: Briefpapier und alle eigenen Elemente; sie liegen unter dem Inhalt und können ihn nie verdecken.
    const hinten = new Seite();
    if (bilder.briefpapier && (d.briefpapierSeiten !== 'erste' || erste)) hinten.bild(bildName('briefpapier'), 0, 0, SB_SEITE, SH_SEITE);
    for (const e of d.elemente) {
      if (!passt(e)) continue;
      const m = elementZeichnen(hinten, e, i + 1, texteDerSeite, belegt);
      if (erste && m) {
        const p = ePlatz.get(e.id);
        bereiche.push({ key: `el:${e.id}`, ...m, anker: p ? { x: p.x, y: p.y } : { x: Number(e.x) * MM || 0, y: Number(e.y) * MM || 0 } });
      }
    }
    seite.ops = [...hinten.ops, ...seite.ops];
    seite.elemente = [...hinten.elemente, ...seite.elemente];
    for (const n of hinten.bilder) seite.bilder.add(n);
  });

  return { seiten, titelText, bereiche };
}

/**
 * Pixel je Millimeter auf der Vorschau: Die Seite ist 210 mm breit und so breit wie
 * die Vorschau auf dem Bildschirm. Der Gestalter rechnet damit Mausbewegungen in
 * Millimeter um (1 Pixel Zug = 1 / pixelProMm Millimeter). Vor 2.5.0 stand hier eine
 * falsche Umrechnung: Teile liefen der Maus um das Vierfache davon.
 */
export const pixelProMm = (vorschauBreitePx) => Number(vorschauBreitePx) / 210;

/** Dateiname des PDFs. */
export function pdfDateiname(r) {
  const nr = String(r.nummer || 'Entwurf').replace(/[^\w.-]+/g, '_');
  return `${r.storno ? 'Stornorechnung' : (r.art === '381' ? 'Gutschrift' : 'Rechnung')}_${nr}.pdf`;
}
