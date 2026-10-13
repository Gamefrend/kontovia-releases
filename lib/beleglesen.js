/**
 * Kontovia – aus dem Text eines Belegs einen Vorschlag für die Buchung machen (reine Regeln, ohne Netz).
 *
 * Der Text kommt aus der Textebene eines PDFs (lib/pdftext.js) oder aus der Texterkennung eines Fotos
 * (src/web/ocr.js). Gesucht werden Gesamtbetrag (brutto), Netto, Umsatzsteuer und Satz, Rechnungsdatum,
 * Fälligkeit, Rechnungsnummer, Lieferant (Name, USt-IdNr., IBAN). Jede Angabe trägt, woher sie kommt
 * (beschriftet oder geschätzt); die Oberfläche zeigt den Vorschlag und übernimmt ihn erst auf Klick
 * (views/transactions.js). Nichts wird von selbst gespeichert.
 *
 * Beträge: deutsche (1.234,56) und englische (1,234.56) Schreibweise, mit oder ohne €/EUR. Datum:
 * 03.10.2026, 3.10.26, 2026-10-03, 3. Oktober 2026, 03/10/2026. Kassenbons (Supermarkt, Tankstelle) und
 * Rechnungen (Dienstleister, Shops) folgen unterschiedlichen Mustern; beide sind berücksichtigt.
 */

const MONATE = {
  januar: 1, jan: 1, februar: 2, feb: 2, maerz: 3, märz: 3, mrz: 3, mar: 3, april: 4, apr: 4, mai: 5, may: 5, juni: 6, jun: 6,
  juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, november: 11, nov: 11,
  dezember: 12, dez: 12, dec: 12, january: 1, february: 2, march: 3, june: 6, july: 7, october: 10, december: 12,
};

/** Wörter, nach denen der Gesamtbetrag steht (der stärkste Treffer zuerst). */
const GESAMT = [
  /\b(rechnungsbetrag|gesamtbetrag|endbetrag|zahlbetrag|zu\s*zahlen(?:der\s*betrag)?|zahlbar|total\s*(?:amount|due)|amount\s*due|gesamtsumme|bruttobetrag|brutto|summe\s*brutto|gesamt\s*brutto)\b/i,
  /\b(summe|gesamt|betrag|total)\b/i,
  // Bezahlt mit Karte: steht auf Bons meist genau mit dem Gesamtbetrag. „BAR“ nicht, das ist das gegebene Geld.
  /\b(ec[-\s]?karte|kartenzahlung|girocard|visa|mastercard|maestro|kreditkarte)\b/i,
];
const NETTO = /\b(netto(?:betrag|summe)?|summe\s*netto|zwischensumme|subtotal|net(?:\s*amount)?)\b/i;
const STEUER = /\b(mwst|ust|umsatzsteuer|mehrwertsteuer|vat|tax)\b/i;
const NUMMER = /\b(?:rechnungs?[-\s]?(?:nr|nummer|no)|rg[-\s.]?nr|re[-\s.]?nr|beleg[-\s]?(?:nr|nummer)|bon[-\s]?(?:nr|nummer)|invoice\s*(?:no|number|#)|nr\.?)\s*[.:#]?\s*([A-Z0-9][A-Z0-9/_.-]{2,30})/i;
const DATUM_WORT = /\b(rechnungsdatum|belegdatum|datum|date|invoice\s*date|ausgestellt\s*am|vom)\b/i;
const FAELLIG_WORT = /\b(f(?:ä|ae)llig(?:\s*am|keit)?|zahlbar\s*bis|zahlungsziel|due\s*(?:date|on)?|payable\s*by)\b/i;
const RECHTSFORM = /\b(gmbh|ag|ug|kg|ohg|gbr|e\.\s?k\.|e\.\s?v\.|mbh|ltd|inc|llc|s\.?a\.?r\.?l|b\.?v\.?|se|co\.?\s*kg)\b/i;
/** Zeilen, die nie der Name des Lieferanten sind. */
const KEIN_NAME = /(rechnung|invoice|quittung|beleg|kassenbon|bon\b|datum|date|tel|fax|e-?mail|www\.|http|ust|steuer|seite|page|kunde|lieferschein|angebot|filiale|kasse|uhrzeit|^\d|summe|betrag|mwst|iban|bic|bank)/i;

/** Einen Betrag lesen: „1.234,56“, „1,234.56“, „12,9“, „-3,50“ → Cent oder null. */
export function betragLesen(text) {
  let s = String(text || '').replace(/[€\s]|EUR/gi, '').replace(/[−–]/g, '-');
  if (!/\d/.test(s)) return null;
  const neg = /^-|-$/.test(s);
  s = s.replace(/^[-+]|-$/g, '');
  let ganz;
  let rest = '';
  const komma = s.lastIndexOf(',');
  const punkt = s.lastIndexOf('.');
  const trenner = Math.max(komma, punkt);
  if (trenner >= 0 && s.length - trenner - 1 <= 2 && s.length - trenner - 1 >= 1) {
    ganz = s.slice(0, trenner).replace(/[.,'\s]/g, '');
    rest = s.slice(trenner + 1);
  } else {
    ganz = s.replace(/[.,'\s]/g, '');
  }
  if (!/^\d{1,9}$/.test(ganz) || !/^\d{0,2}$/.test(rest)) return null;
  const cent = Number(ganz) * 100 + Number((rest + '00').slice(0, 2));
  return neg ? -cent : cent;
}

/** Alle Beträge einer Zeile, mit Position. */
const BETRAG_RE = /(?<![\d.,])[-−]?\d{1,3}(?:[.\s']\d{3})*(?:[.,]\d{2})(?![\d])|(?<![\d.,])[-−]?\d+[.,]\d{2}(?![\d])/g;
function betraegeIn(zeile) {
  const out = [];
  for (const m of zeile.matchAll(BETRAG_RE)) {
    // Keine Datumsteile („03.10“) und keine Prozente („19,00 %“).
    const nach = zeile.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (/^\s?%/.test(nach)) continue;
    if (/^[.]\d{2,4}/.test(zeile.slice(m.index + m[0].length)) || /\d[.]$/.test(zeile.slice(0, m.index))) continue;
    const c = betragLesen(m[0]);
    if (c !== null) out.push({ cent: c, pos: m.index });
  }
  return out;
}

/** Schreibweisen eines Datums: Jahr, Monat, Tag als Gruppen (Monat auch als Wort). */
const DATUM_MUSTER = [
  [/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) => [+m[1], +m[2], +m[3]]],
  [/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/g, (m) => [+m[3], +m[2], +m[1]]],
  [/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/g, (m) => [+m[3], +m[2], +m[1]]],
  [/(?<!\d)(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{4})(?!\d)/g, (m) => [+m[3], MONATE[m[2].toLowerCase()] || 0, +m[1]]],
];

/** Alle Daten im Text in der Reihenfolge, in der sie stehen (YYYY-MM-DD), nur plausible Jahre. */
export function datenIn(text, heute = new Date().toISOString().slice(0, 10)) {
  const t = String(text || '');
  const jahrHeute = Number(heute.slice(0, 4));
  const treffer = [];
  for (const [re, teile] of DATUM_MUSTER) {
    for (const m of t.matchAll(re)) {
      let [j, mo, d] = teile(m);
      if (j < 100) j += j > 70 ? 1900 : 2000;
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || j < jahrHeute - 12 || j > jahrHeute + 2) continue;
      const iso = `${j}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (new Date(Date.UTC(j, mo - 1, d)).getUTCDate() !== d) continue; // etwa der 31.02.
      treffer.push({ iso, pos: m.index });
    }
  }
  return treffer.sort((a, b) => a.pos - b.pos).map((x) => x.iso);
}

/** Das erste Datum im Text; YYYY-MM-DD oder ''. */
export const datumLesen = (text, heute) => datenIn(text, heute)[0] || '';

/**
 * Den Text deuten.
 * @param {string} text
 * @param {{heute?:string, kontakte?:Array<{id,name,taxId?,vatId?}>, eigeneUstId?:string, eigenerName?:string}} opt
 * @returns {{brutto:number|null, netto:number|null, steuer:number|null, satz:number|null, saetze:number[], datum:string,
 *   faellig:string, nummer:string, lieferant:string, ustId:string, iban:string, kontaktId:string, gefunden:string[], sicher:boolean}}
 */
export function belegDeuten(text, { heute = new Date().toISOString().slice(0, 10), kontakte = [], eigeneUstId = '', eigenerName = '' } = {}) {
  const zeilen = String(text || '').replace(/\r/g, '').split('\n').map((z) => z.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = { brutto: null, netto: null, steuer: null, satz: null, saetze: [], datum: '', faellig: '', nummer: '', lieferant: '', ustId: '', iban: '', kontaktId: '', gefunden: [], sicher: false };
  if (!zeilen.length) return out;
  const eigen = String(eigeneUstId || '').replace(/\s/g, '').toUpperCase();

  /* Gesamtbetrag: beschriftete Zeile (oder die Zeile darunter), stärkste Beschriftung, dann der größte Betrag dort. */
  let bestes = null;
  zeilen.forEach((z, i) => {
    GESAMT.forEach((re, stufe) => {
      if (!re.test(z) || NETTO.test(z) || /\b(rabatt|skonto|gegeben|rückgeld|wechselgeld|zurück|change|gespart|pfand(?!.*summe))\b/i.test(z)) return;
      let b = betraegeIn(z);
      if (!b.length && zeilen[i + 1] && !GESAMT[0].test(zeilen[i + 1])) b = betraegeIn(zeilen[i + 1]);
      if (!b.length) return;
      const wert = Math.max(...b.map((x) => x.cent));
      // Stärkere Beschriftung gewinnt; bei gleicher der größere Betrag (Gesamt steht meist über Teilsummen).
      if (!bestes || stufe < bestes.stufe || (stufe === bestes.stufe && wert > bestes.cent)) bestes = { stufe, cent: wert, zeile: i };
    });
  });
  if (bestes && bestes.cent > 0) { out.brutto = bestes.cent; out.gefunden.push('betrag'); }

  /* Steuersätze und -beträge: „19 %“, „MwSt 19% 3,19“, „USt 7 % auf 10,00 0,70“. */
  const saetze = new Map(); // satz → {steuer, basis}
  for (const z of zeilen) {
    const pz = [...z.matchAll(/(?<![\d,.])(19|16|7|5|0)(?:[.,]0{1,2})?\s?%/g)].map((m) => Number(m[1]));
    // Nur Zeilen zur Umsatzsteuer, auch Bons mit Kennbuchstaben („A 19 %“, „B = 7 %“); Rabatte in Prozent nicht.
    if (!pz.length || /rabatt|skonto|nachlass|discount/i.test(z) || !(STEUER.test(z) || /^\s*[A-D1-4]\s?[=:]?\s?\d{1,2}(?:[.,]\d+)?\s?%/i.test(z))) continue;
    const b = betraegeIn(z).map((x) => x.cent).filter((c) => c > 0);
    for (const s of pz) {
      const e = saetze.get(s) || { steuer: null, basis: null };
      if (STEUER.test(z) && b.length) {
        // Die kleinste Zahl der Zeile ist meist die Steuer, eine größere die Grundlage.
        const sortiert = [...b].sort((x, y) => x - y);
        e.steuer ??= sortiert[0];
        if (sortiert.length > 1) e.basis ??= sortiert[sortiert.length - 1];
      }
      saetze.set(s, e);
    }
  }
  // Nur Sätze, die wirklich als Umsatzsteuer dastehen (oder genau einer im Text).
  out.saetze = [...saetze.keys()].filter((s) => s !== 0 || saetze.size === 1).sort((a, b) => b - a);
  if (out.saetze.length === 1) {
    out.satz = out.saetze[0];
    const e = saetze.get(out.satz);
    if (e.steuer !== null) out.steuer = e.steuer;
    out.gefunden.push('satz');
  } else if (out.saetze.length > 1) {
    out.satz = out.saetze[0];
    out.gefunden.push('saetze');
  }
  for (const z of zeilen) {
    if (!NETTO.test(z) || out.netto !== null) continue;
    const b = betraegeIn(z);
    if (b.length) out.netto = Math.max(...b.map((x) => x.cent));
  }
  // Fehlendes aus dem, was da ist: Netto = Brutto − Steuer, Steuer aus dem Satz.
  if (out.brutto === null && out.netto !== null && out.steuer !== null) out.brutto = out.netto + out.steuer;
  if (out.brutto !== null && out.satz !== null && out.saetze.length === 1) {
    const rechnerisch = Math.round(out.brutto - out.brutto / (1 + out.satz / 100));
    if (out.steuer === null || Math.abs(out.steuer - rechnerisch) > 2) {
      // Steht ein anderer Steuerbetrag da, passt er nicht zum Brutto; dann zählt der Satz.
      out.steuer = rechnerisch;
    }
    out.netto = out.brutto - out.steuer;
  }
  // Ohne Gesamtbeschriftung: der größte Betrag mit Euro-Zeichen oder EUR.
  if (out.brutto === null) {
    const mitEuro = zeilen.flatMap((z) => (/€|EUR/i.test(z) ? betraegeIn(z).map((x) => x.cent) : [])).filter((c) => c > 0);
    if (mitEuro.length) { out.brutto = Math.max(...mitEuro); out.gefunden.push('betrag-geschaetzt'); }
  }

  /* Datum: beschriftet zuerst, sonst das erste plausible Datum; Fälligkeit nur beschriftet. */
  for (const [i, z] of zeilen.entries()) {
    if (FAELLIG_WORT.test(z) && !out.faellig) {
      const d = datumLesen(z, heute) || datumLesen(zeilen[i + 1] || '', heute);
      if (d) out.faellig = d;
      continue;
    }
    if (!out.datum && DATUM_WORT.test(z) && !/liefer|leistung/i.test(z)) {
      const d = datumLesen(z, heute) || (z.length < 25 ? datumLesen(zeilen[i + 1] || '', heute) : '');
      if (d) out.datum = d;
    }
  }
  if (!out.datum) {
    // Ohne Beschriftung: das erste Datum, das nicht in der Zukunft liegt (Kassenbons drucken es oben oder unten).
    for (const z of zeilen) {
      if (FAELLIG_WORT.test(z)) continue;
      const d = datenIn(z, heute).find((x) => x <= heute);
      if (d) { out.datum = d; break; }
    }
  }
  if (out.datum) out.gefunden.push('datum');
  if (out.faellig && out.datum && out.faellig < out.datum) out.faellig = '';

  /* Rechnungsnummer */
  for (const z of zeilen) {
    const m = NUMMER.exec(z);
    if (m && /\d/.test(m[1]) && !datumLesen(m[1], heute)) { out.nummer = m[1].replace(/[.,:]$/, ''); out.gefunden.push('nummer'); break; }
  }

  /* USt-IdNr. und IBAN des Lieferanten (nicht die eigene). */
  const ids = [...String(text).matchAll(/\b(DE)\s?(\d{3})\s?(\d{3})\s?(\d{3})\b/g)].map((m) => m.slice(1).join('')).filter((id) => id !== eigen);
  if (ids.length) out.ustId = ids[0];
  const iban = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b/.exec(String(text).toUpperCase());
  if (iban) out.iban = iban[1].replace(/\s/g, '');

  /* Lieferant: bekannter Kontakt (USt-IdNr. oder Name im Text), sonst die erste Zeile mit Rechtsform, sonst die erste Namenszeile oben. */
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  const textNorm = ` ${norm(text)} `;
  const kontakt = kontakte.find((c) => out.ustId && [c.taxId, c.vatId].some((x) => String(x || '').replace(/\s/g, '').toUpperCase() === out.ustId))
    || kontakte.filter((c) => norm(c.name).length >= 4 && textNorm.includes(` ${norm(c.name)} `)).sort((a, b) => norm(b.name).length - norm(a.name).length)[0];
  const eigenerNorm = norm(eigenerName);
  if (kontakt) { out.kontaktId = kontakt.id; out.lieferant = kontakt.name; } else {
    const oben = zeilen.slice(0, 12).filter((z) => !(eigenerNorm && norm(z).includes(eigenerNorm)));
    const mitForm = oben.find((z) => RECHTSFORM.test(z) && z.length <= 60 && !/\d{5}/.test(z));
    const name = mitForm || oben.find((z) => /[A-Za-zÄÖÜäöü]{3}/.test(z) && !KEIN_NAME.test(z) && z.length <= 40 && !betraegeIn(z).length);
    if (name) out.lieferant = name.replace(/[*_=#|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  if (out.lieferant) out.gefunden.push('lieferant');

  // Sicher heißt: Betrag beschriftet und Datum da; dann bietet die Oberfläche das Übernehmen gleich an.
  out.sicher = !!bestes && !!out.datum;
  return out;
}
