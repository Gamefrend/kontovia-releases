/**
 * Kontovia – die gestaltete Rechnung als PDF/A-3 mit eingebetteter E-Rechnung.
 *
 * Aufbau nach DIN 5008 (Form B): Anschrift im Fenster eines DL-Umschlags,
 * Informationsblock rechts, Falz- und Lochmarken. Gestalten lässt sich, was
 * die Rechnung nicht verändert: Stil, Akzentfarbe, Logo, ein Zusatzbild
 * (etwa Unterschrift oder Siegel), Schriftgröße, Fußzeile. Die Zahlen kommen
 * aus derselben Berechnung wie die XML (lib/rechnung.js), damit Ansicht und
 * E-Rechnung nie auseinanderlaufen.
 *
 * Ist xml angegeben, steckt sie als factur-x.xml im PDF (ZUGFeRD / Factur-X).
 */

import {
  berechnen, faelligkeit, zahlungsText, titel as titelVon, einheitText, einheitKurz, mengeText, betragText, satzText,
  STEUERFAELLE, ZAHLUNGSARTEN, LAENDER,
} from './rechnung.js';
import { Seite, MM, textBreite, pdfaDatei } from './pdfa.js';

const FARBE = { text: '#14181d', grau: '#5b6270', hell: '#8a909b', linie: '#d5d9e0', zart: '#eef0f3' };
const d8 = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');

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

/** Größe eines Bildes in mm bei gewünschter Breite, Höhe begrenzt. */
function bildMass(b, breiteMm, maxHoeheMm) {
  if (!b?.breite || !b?.hoehe) return null;
  let w = breiteMm;
  let h = (w * b.hoehe) / b.breite;
  if (h > maxHoeheMm) { h = maxHoeheMm; w = (h * b.breite) / b.hoehe; }
  return { w: w * MM, h: h * MM };
}

/**
 * Setzt die Rechnung.
 * @param {object} r  Rechnung
 * @param {object} v  Verkäufer (verkaeuferAus)
 * @param {object} d  Gestaltung (design)
 * @param {{bilder?:{logo?:object, bild?:object}, xml?:string, profil?:string, jetzt?:Date}} o
 *   bilder: {bytes (JPEG), breite, hoehe} – Breite/Höhe in Pixeln für das Seitenverhältnis
 * @returns {Promise<Uint8Array>}
 */
export async function rechnungPdf(r, v, d, { bilder = {}, xml = null, profil = 'en16931', jetzt = new Date() } = {}) {
  const { seiten, titelText } = rechnungSeiten(r, v, d, { bilder, eRechnung: !!xml, profil });
  const k = r.kaeufer || {};
  const xmlBytes = xml ? new TextEncoder().encode(xml) : null;
  const dateiname = profil === 'xrechnung' ? 'xrechnung.xml' : 'factur-x.xml';
  return pdfaDatei(seiten, {
    titel: titelText,
    autor: v.name || '',
    betreff: `${titelText}${k.name ? ` an ${k.name}` : ''}`,
    bilder: {
      ...(bilder.logo ? { Logo: bilder.logo } : {}),
      ...(bilder.bild ? { Bild: bilder.bild } : {}),
    },
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
 * @returns {{seiten:Seite[], titelText:string}}
 */
export function rechnungSeiten(r, v, d, { bilder = {}, eRechnung = true, profil = 'en16931' } = {}) {
  const b = berechnen(r);
  const fall = STEUERFAELLE[r.steuerfall] || STEUERFAELLE.standard;
  const mitSteuer = !fall.kategorie;
  const k = r.kaeufer || {};
  const w = r.waehrung || 'EUR';
  const akzent = /^#[0-9a-f]{6}$/i.test(d.akzent || '') ? d.akzent : '#3446e0';
  const layout = ['klassisch', 'modern', 'schlicht'].includes(d.layout) ? d.layout : 'klassisch';
  const schlicht = layout === 'schlicht';
  const fs = Math.min(11, Math.max(8, Number(d.schriftgroesse) || 9.5));
  const zh = fs * 1.42; // Zeilenhöhe

  const LINKS = 25 * MM;
  const RECHTS = 210 * MM - 20 * MM;
  const BREITE = RECHTS - LINKS;
  const fussHoehe = d.fusszeile !== false ? 24 * MM : 12 * MM;
  const fussBildMass = d.bildPosition === 'fuss' && bilder.bild ? bildMass(bilder.bild, d.bildBreite || 45, 18) : null;
  const UNTEN = 297 * MM - fussHoehe - (fussBildMass ? fussBildMass.h + 4 * MM : 0) - 6 * MM;

  const seiten = [];
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
    s.text(LINKS, y, titelText, { groesse: fs, schrift: 'fett' });
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
  const logo = bilder.logo ? bildMass(bilder.logo, d.logoBreite || 40, 28) : null;
  if (logo) {
    const x = d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (210 * MM - logo.w) / 2 : RECHTS - logo.w;
    s.bild('Logo', x, kopfOben, logo.w, logo.h);
  }
  // Ohne Logo steht der Name des Betriebs im Kopf.
  if (!logo && v.name) {
    const g = 15;
    const x = d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (210 * MM - textBreite(v.name, g, 'fett')) / 2 : RECHTS - textBreite(v.name, g, 'fett');
    s.text(x, kopfOben + 8 * MM, v.name, { groesse: g, schrift: 'fett', farbe: schlicht ? FARBE.text : akzent });
    if (d.fusszeile === false) {
      const zeilen = [v.strasse, [v.plz, v.ort].filter(Boolean).join(' '), v.telefon, v.email].filter(Boolean);
      zeilen.forEach((z, i) => {
        const gx = d.logoPosition === 'links' ? LINKS : d.logoPosition === 'mitte' ? (210 * MM - textBreite(z, fs * 0.85)) / 2 : RECHTS - textBreite(z, fs * 0.85);
        s.text(gx, kopfOben + 13 * MM + i * fs * 1.25, z, { groesse: fs * 0.85, farbe: FARBE.grau });
      });
    }
  }

  // Rücksendeangabe und Anschrift (Fenster: 45 mm von oben, 20 mm vom Rand, 85 × 45 mm)
  const absender = [v.name, v.strasse, [v.plz, v.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  let ab = absender;
  while (ab && textBreite(ab, 6.8) > 85 * MM) ab = ab.slice(0, -1);
  if (ab) {
    s.text(LINKS, 59.5 * MM, ab, { groesse: 6.8, farbe: FARBE.grau });
    s.linie(LINKS, 60.6 * MM, LINKS + textBreite(ab, 6.8), 60.6 * MM, { staerke: 0.3, farbe: FARBE.hell });
  }
  const anschrift = [k.name, k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')];
  if (k.land && k.land !== (v.land || 'DE')) anschrift.push((LAENDER[k.land]?.name || k.land).toUpperCase());
  let ay = 66 * MM;
  for (const z of anschrift.filter(Boolean).slice(0, 6)) {
    let t = z;
    while (textBreite(t, fs + 0.5) > 80 * MM && t.length > 1) t = t.slice(0, -1);
    s.text(LINKS, ay, t, { groesse: fs + 0.5 });
    ay += (fs + 0.5) * 1.3;
  }

  // Informationsblock (125 mm vom Rand, 50 mm von oben)
  const info = [
    [r.storno ? 'Storno-Nr.' : 'Rechnungsnr.', r.nummer || 'Entwurf'],
    ['Rechnungsdatum', d8(r.datum)],
    r.leistungArt === 'zeitraum'
      ? ['Leistungszeitraum', r.leistungVon && r.leistungBis ? `${d8(r.leistungVon)} bis ${d8(r.leistungBis)}` : '']
      : ['Leistungsdatum', d8(r.leistungsdatum)],
    ['Kundennr.', k.kundennummer],
    ['Ihre Bestellung', r.bestellnummer],
    ['Leitweg-ID', k.leitwegId],
    ['Ihre USt-IdNr.', fall.kategorie === 'AE' || fall.kategorie === 'K' ? k.ustId : ''],
    ['Zahlbar bis', b.zahlbetrag > 0 && r.zahlungsart !== 'bar' ? d8(faelligkeit(r)) : ''],
  ].filter(([, wert]) => wert);
  const IX = 125 * MM;
  let iy = 52 * MM;
  for (const [label, wert] of info) {
    s.text(IX, iy, label, { groesse: fs * 0.88, farbe: FARBE.grau });
    let t = String(wert);
    while (textBreite(t, fs * 0.88) > RECHTS - IX - 30 * MM && t.length > 1) t = t.slice(0, -1);
    s.text(RECHTS - textBreite(t, fs * 0.88), iy, t, { groesse: fs * 0.88 });
    iy += fs * 0.88 * 1.55;
  }

  /* ------------------------------ Titel, Text ------------------------------ */

  y = Math.max(103 * MM, iy + 8 * MM, ay + 10 * MM);
  const gTitel = layout === 'modern' ? 17 : 15;
  s.text(LINKS, y, titelText, { groesse: gTitel, schrift: 'fett', farbe: layout === 'modern' ? akzent : FARBE.text });
  y += gTitel * 0.55 + 2 * MM;
  const unterzeilen = [];
  if (r.betreff) unterzeilen.push(r.betreff);
  if (r.bezug?.nummer) unterzeilen.push(`${r.storno ? 'Storno zur' : 'Bezug:'} Rechnung ${r.bezug.nummer}${r.bezug.datum ? ` vom ${d8(r.bezug.datum)}` : ''}`);
  for (const z of unterzeilen) {
    for (const t of umbrechen(z, BREITE, fs + 0.5)) { y += (fs + 0.5) * 1.35; s.text(LINKS, y, t, { groesse: fs + 0.5, farbe: FARBE.grau }); }
  }
  y += 7 * MM;

  const absatz = (text, { groesse = fs, farbe: f = FARBE.text, schrift = 'normal', abstand = 0 } = {}) => {
    const zeilen = umbrechen(text, BREITE, groesse, schrift);
    for (const z of zeilen) {
      if (y + groesse * 1.42 > UNTEN) neueSeite();
      if (z) s.text(LINKS, y, z, { groesse, farbe: f, schrift });
      y += groesse * 1.42;
    }
    y += abstand;
  };

  if (r.kopftext) absatz(r.kopftext, { abstand: 4 * MM });

  /* ------------------------------- Positionen ------------------------------ */

  const spalten = [
    { key: 'nr', titel: 'Pos.', breite: 9 * MM },
    { key: 'name', titel: 'Bezeichnung', breite: 0 },
    { key: 'menge', titel: 'Menge', breite: 14 * MM, rechts: true },
    { key: 'einheit', titel: 'Einheit', breite: 16 * MM },
    { key: 'preis', titel: 'Einzelpreis', breite: 22 * MM, rechts: true },
    ...(mitSteuer ? [{ key: 'satz', titel: 'USt', breite: 11 * MM, rechts: true }] : []),
    { key: 'netto', titel: mitSteuer ? 'Gesamt netto' : 'Gesamt', breite: 24 * MM, rechts: true },
  ];
  const fest = spalten.reduce((n, c) => n + c.breite, 0);
  spalten.find((c) => c.key === 'name').breite = BREITE - fest;
  let sx = LINKS;
  for (const c of spalten) { c.x = sx; sx += c.breite; }
  const PAD = 1.6 * MM;
  const farbigerKopf = d.tabellenkopfFarbig !== false && !schlicht;
  const kopfText = farbigerKopf && !hell(akzent) ? '#ffffff' : FARBE.text;

  const tabellenkopf = () => {
    const h = fs * 1.9;
    if (y + h + zh * 2 > UNTEN) neueSeite();
    if (farbigerKopf) s.rechteck(LINKS, y, BREITE, h, { fuellung: akzent });
    else if (!schlicht) s.rechteck(LINKS, y, BREITE, h, { fuellung: FARBE.zart });
    const by = y + h / 2 + fs * 0.32;
    for (const c of spalten) {
      const g = fs * 0.86;
      const tx = c.rechts ? c.x + c.breite - PAD - textBreite(c.titel, g, 'fett') : c.x + PAD;
      s.text(tx, by, c.titel, { groesse: g, schrift: 'fett', farbe: kopfText });
    }
    y += h;
    if (schlicht) s.linie(LINKS, y, RECHTS, y, { staerke: 0.8, farbe: FARBE.text });
  };

  tabellenkopf();
  for (const z of b.zeilen) {
    const nameZeilen = umbrechen(z.name || '', spalten[1].breite - 2 * PAD, fs, 'normal');
    const beschrZeilen = z.beschreibung ? umbrechen(z.beschreibung, spalten[1].breite - 2 * PAD, fs * 0.88) : [];
    const h = 2 * PAD + nameZeilen.length * zh + beschrZeilen.length * fs * 0.88 * 1.38 + (beschrZeilen.length ? 0.6 * MM : 0);
    if (y + h > UNTEN) { neueSeite(); tabellenkopf(); }
    const by = y + PAD + fs * 0.95;
    const werte = {
      nr: String(z.nr),
      menge: mengeText(z.menge),
      // Passt ein eigener Einheitentext nicht in die Spalte, steht dort der Kurzname zum Code.
      einheit: textBreite(einheitText(z), fs) > spalten.find((c) => c.key === 'einheit').breite - 2 * PAD ? einheitKurz(z.einheit) : einheitText(z),
      preis: betragText(z.preis, w),
      satz: satzText(z.satz),
      netto: betragText(z.netto, w),
    };
    for (const c of spalten) {
      if (c.key === 'name') continue;
      let t = werte[c.key] || '';
      while (textBreite(t, fs) > c.breite - 2 * PAD && t.length > 1) t = t.slice(0, -1);
      const tx = c.rechts ? c.x + c.breite - PAD - textBreite(t, fs) : c.x + PAD;
      s.text(tx, by, t, { groesse: fs, farbe: c.key === 'nr' ? FARBE.grau : FARBE.text });
    }
    let ny = by;
    for (const t of nameZeilen) { s.text(spalten[1].x + PAD, ny, t, { groesse: fs }); ny += zh; }
    if (beschrZeilen.length) ny += 0.4 * MM - zh + fs * 0.88 * 1.38;
    for (const t of beschrZeilen) { s.text(spalten[1].x + PAD, ny, t, { groesse: fs * 0.88, farbe: FARBE.grau }); ny += fs * 0.88 * 1.38; }
    y += h;
    s.linie(LINKS, y, RECHTS, y, { staerke: 0.35, farbe: FARBE.linie });
  }
  if (!b.zeilen.length) {
    y += PAD + fs;
    s.text(LINKS + PAD, y, 'Noch keine Positionen.', { groesse: fs, farbe: FARBE.grau });
    y += PAD + 2 * MM;
  }

  /* -------------------------------- Summen --------------------------------- */

  const summen = [];
  if (mitSteuer || b.steuer) {
    summen.push({ label: 'Summe netto', wert: betragText(b.netto, w) });
    for (const g of b.steuern) {
      if (g.kategorie === 'S' || g.satz) summen.push({ label: `zzgl. USt ${satzText(g.satz)} auf ${betragText(g.basis, w)}`, wert: betragText(g.steuer, w), grau: true });
      else if (b.steuern.length > 1) summen.push({ label: `USt 0 % auf ${betragText(g.basis, w)}`, wert: betragText(0, w), grau: true });
    }
  }
  summen.push({ label: 'Gesamtbetrag', wert: betragText(b.brutto, w), fett: true, linie: true });
  if (b.bereitsGezahlt) {
    summen.push({ label: 'abzüglich bereits gezahlt', wert: betragText(-b.bereitsGezahlt, w), grau: true });
    summen.push({ label: b.zahlbetrag < 0 ? 'Guthaben' : 'Noch zu zahlen', wert: betragText(b.zahlbetrag, w), fett: true });
  }
  const SB = 82 * MM;
  const hSummen = summen.length * zh * 1.15 + 6 * MM;
  if (y + hSummen > UNTEN) neueSeite();
  y += 3 * MM;
  for (const z of summen) {
    if (z.linie) {
      s.linie(RECHTS - SB, y - 0.5 * MM, RECHTS, y - 0.5 * MM, { staerke: schlicht ? 0.6 : 0.9, farbe: schlicht ? FARBE.text : akzent });
      y += 1.5 * MM;
    }
    y += zh * 1.1;
    const g = z.fett ? fs + 1 : fs;
    s.text(RECHTS - SB, y - zh * 0.3, z.label, { groesse: z.grau ? fs * 0.92 : g, schrift: z.fett ? 'fett' : 'normal', farbe: z.grau ? FARBE.grau : FARBE.text });
    s.text(RECHTS - textBreite(z.wert, g, z.fett ? 'fett' : 'normal'), y - zh * 0.3, z.wert, { groesse: g, schrift: z.fett ? 'fett' : 'normal' });
  }
  y += 6 * MM;

  /* ------------------------------ Hinweise --------------------------------- */

  if (b.grund) absatz(b.grund, { schrift: 'fett', abstand: 2 * MM });
  const zahlung = zahlungsText(r);
  if (zahlung && (b.zahlbetrag > 0 || String(r.zahlungsbedingungen || '').trim())) absatz(zahlung, { abstand: 1 * MM });
  if (r.zahlungsart === 'ueberweisung' && v.iban && b.zahlbetrag > 0) {
    const iban = v.iban.replace(/(.{4})/g, '$1 ').trim();
    absatz(`Bankverbindung: ${[v.kontoinhaber, v.bank, `IBAN ${iban}`, v.bic ? `BIC ${v.bic}` : ''].filter(Boolean).join(', ')}`, { abstand: 1 * MM });
    if (r.nummer) absatz(`Verwendungszweck: ${r.nummer}`, { abstand: 2 * MM });
  } else if (b.zahlbetrag > 0 && r.zahlungsart && r.zahlungsart !== 'ueberweisung' && r.zahlungsart !== 'bar') {
    absatz(`Zahlungsart: ${ZAHLUNGSARTEN[r.zahlungsart]?.name || ''}`, { abstand: 2 * MM });
  }
  if (b.zahlbetrag < 0 && !r.storno) absatz(`Den Betrag von ${betragText(-b.zahlbetrag, w)} erstatten wir Ihnen.`, { abstand: 2 * MM });
  y += 3 * MM;
  if (r.schlusstext) absatz(r.schlusstext, { abstand: 2 * MM });

  const schlussBild = d.bildPosition !== 'fuss' && bilder.bild ? bildMass(bilder.bild, d.bildBreite || 45, 30) : null;
  if (schlussBild) {
    if (y + schlussBild.h > UNTEN) neueSeite();
    s.bild('Bild', LINKS, y, schlussBild.w, schlussBild.h);
    y += schlussBild.h + 3 * MM;
  }

  if (eRechnung && d.hinweisERechnung !== false) {
    y += 2 * MM;
    absatz(`Diese Rechnung enthält ihre Daten zusätzlich maschinenlesbar als E-Rechnung (${profil === 'xrechnung' ? 'XRechnung' : 'ZUGFeRD / Factur-X, Profil EN 16931'}).`,
      { groesse: fs * 0.78, farbe: FARBE.hell });
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
    if (fussBildMass) seite.bild('Bild', (210 * MM - fussBildMass.w) / 2, fy - fussBildMass.h - 5 * MM, fussBildMass.w, fussBildMass.h);
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

  return { seiten, titelText };
}

/** Dateiname des PDFs. */
export function pdfDateiname(r) {
  const nr = String(r.nummer || 'Entwurf').replace(/[^\w.-]+/g, '_');
  return `${r.storno ? 'Stornorechnung' : (r.art === '381' ? 'Gutschrift' : 'Rechnung')}_${nr}.pdf`;
}
