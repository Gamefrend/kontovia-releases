/**
 * Kontovia – E-Rechnungen lesen (XRechnung und ZUGFeRD / Factur-X).
 *
 * Seit 01.01.2025 muss jedes Unternehmen E-Rechnungen empfangen können
 * (§ 14 UStG). Aufbewahrt wird die XML-Datei unverändert – das tut Kontovia
 * schon immer. Lesen kann sie aber kaum jemand: Diese Datei macht aus ihr eine
 * Rechnung zum Ansehen und liefert die Werte, die sich in eine Buchung
 * übernehmen lassen.
 *
 * Unterstützt werden beide Syntaxen der Norm EN 16931:
 *   UBL  (Invoice, CreditNote)   – so kommt die XRechnung meist
 *   CII  (CrossIndustryInvoice)  – ZUGFeRD 2.x / Factur-X, auch in PDFs eingebettet
 *
 * Bewusst ohne DOMParser und ohne Fremdbibliothek: Der kleine Leser unten
 * löst keine externen Verweise und keine selbst definierten Entitäten auf –
 * eine präparierte Datei kann damit nichts nachladen. Und er läuft ohne
 * Fenster, sodass scripts/check.js ihn prüfen kann.
 *
 * Rein regelbasiert: Gelesen werden die Felder, die die Norm vorgibt. Es wird
 * nichts geschätzt oder erkannt – für die KI-Verordnung ohne Belang.
 */

/** Größte XML-Datei, die gelesen wird (eine Rechnung ist selten über 1 MB). */
const MAX_XML = 8 * 1024 * 1024;
/** Größtes PDF, in dem nach einer eingebetteten Rechnung gesucht wird. */
const MAX_PDF = 25 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Ein schlichter XML-Leser                                                    */
/* -------------------------------------------------------------------------- */

const ENTITAETEN = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function entschluesseln(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e[0] !== '#') return ENTITAETEN[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(code); } catch { return ''; }
  });
}

/** Name ohne Namensraum-Präfix: „cbc:ID“ → „ID“. */
const lokal = (n) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);

/**
 * Liest XML in einen Baum aus {name, attrs, children, text}. Wirft bei
 * offensichtlich kaputten Dateien; kleinere Unsauberkeiten werden toleriert.
 */
export function xmlBaum(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (src.length > MAX_XML) throw new Error('Die XML-Datei ist zu groß.');
  const doc = { name: '#dokument', attrs: {}, children: [], text: '' };
  const stapel = [doc];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const oben = stapel[stapel.length - 1];
    if (lt < 0) { oben.text += entschluesseln(src.slice(i)); break; }
    if (lt > i) oben.text += entschluesseln(src.slice(i, lt));
    const ende = (marke, ab) => {
      const e = src.indexOf(marke, ab);
      if (e < 0) throw new Error('Die XML-Datei ist unvollständig.');
      return e;
    };
    if (src.startsWith('<!--', lt)) { i = ende('-->', lt + 4) + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = ende(']]>', lt + 9); oben.text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { i = ende('?>', lt + 2) + 2; continue; }
    // DOCTYPE samt eingebetteter Deklarationen wird übersprungen – nichts
    // daraus wird ausgewertet, auch keine selbst definierte Entität.
    if (src.startsWith('<!', lt)) {
      const klammer = src.indexOf('[', lt);
      const gt = ende('>', lt);
      i = klammer >= 0 && klammer < gt ? ende(']>', klammer) + 2 : gt + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const e = ende('>', lt);
      const name = lokal(src.slice(lt + 2, e).trim());
      while (stapel.length > 1) { if (stapel.pop().name === name) break; }
      i = e + 1;
      continue;
    }
    // Starttag: bis zum schließenden „>“, Anführungszeichen beachten.
    let j = lt + 1;
    let quote = '';
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break;
    }
    if (j >= src.length) throw new Error('Die XML-Datei ist unvollständig.');
    const innen = src.slice(lt + 1, j);
    const leer = innen.endsWith('/');
    const rumpf = leer ? innen.slice(0, -1) : innen;
    const m = /^[^\s/>]+/.exec(rumpf);
    if (!m) throw new Error('Die XML-Datei ist fehlerhaft.');
    const knoten = { name: lokal(m[0]), attrs: {}, children: [], text: '' };
    for (const a of rumpf.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      knoten.attrs[lokal(a[1])] = entschluesseln(a[2] ?? a[3]);
    }
    oben.children.push(knoten);
    if (!leer) stapel.push(knoten);
    i = j + 1;
  }
  const wurzel = doc.children[0];
  if (!wurzel) throw new Error('Die Datei enthält kein XML.');
  return wurzel;
}

/* Kleine Zugriffshelfer auf den Baum. */
const kind = (n, name) => n?.children?.find((c) => c.name === name) || null;
const kinder = (n, name) => n?.children?.filter((c) => c.name === name) || [];
const pfad = (n, ...namen) => namen.reduce((x, name) => kind(x, name), n);
const text = (n) => String(n?.text ?? '').trim();
const wert = (n, ...namen) => text(pfad(n, ...namen));

/** Betrag „1234.5“ → 123450 Cent; leer bleibt null. */
function cent(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Datum „20260930“ (Format 102) oder „2026-09-30“ → ISO. */
function datum(s) {
  const t = String(s ?? '').trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return '';
}

/** Übliche Mengeneinheiten nach UN/ECE Rec. 20. */
const EINHEITEN = {
  C62: 'Stück', H87: 'Stück', XPP: 'Stück', EA: 'Stück', HUR: 'Std.', MIN: 'Min.', DAY: 'Tag', WEE: 'Woche', MON: 'Monat',
  ANN: 'Jahr', KGM: 'kg', GRM: 'g', MTR: 'm', MTK: 'm²', MTQ: 'm³', LTR: 'l', KMT: 'km', LS: 'pauschal', SET: 'Satz', P1: '%',
};

function formatName(kennung, syntax) {
  const k = String(kennung || '').toLowerCase();
  if (k.includes('xrechnung')) return 'XRechnung';
  if (k.includes('factur-x') || k.includes('zugferd') || k.includes('ferd')) return 'ZUGFeRD / Factur-X';
  return syntax === 'UBL' ? 'E-Rechnung (UBL)' : 'E-Rechnung (CII)';
}

/* -------------------------------------------------------------------------- */
/* UBL: Invoice und CreditNote                                                 */
/* -------------------------------------------------------------------------- */

function ublPartei(p) {
  const party = pfad(p, 'Party');
  const steuer = kinder(party, 'PartyTaxScheme');
  const nachSchema = (id) => text(kind(steuer.find((s) => wert(s, 'TaxScheme', 'ID').toUpperCase() === id), 'CompanyID'));
  const adr = kind(party, 'PostalAddress');
  return {
    name: wert(party, 'PartyName', 'Name') || wert(party, 'PartyLegalEntity', 'RegistrationName'),
    ustId: nachSchema('VAT') || (steuer.length === 1 ? text(kind(steuer[0], 'CompanyID')) : ''),
    steuernummer: nachSchema('FC'),
    anschrift: [wert(adr, 'StreetName'), wert(adr, 'AdditionalStreetName'),
      [wert(adr, 'PostalZone'), wert(adr, 'CityName')].filter(Boolean).join(' '), wert(adr, 'Country', 'IdentificationCode')]
      .filter(Boolean).join(', '),
    email: wert(party, 'Contact', 'ElectronicMail'),
  };
}

function ubl(root) {
  const gutschrift = root.name === 'CreditNote' || wert(root, 'InvoiceTypeCode') === '381';
  const summen = kind(root, 'LegalMonetaryTotal');
  const steuerSumme = kinder(root, 'TaxTotal').find((t) => kinder(t, 'TaxSubtotal').length) || kind(root, 'TaxTotal');
  const zahlung = kind(root, 'PaymentMeans');
  const zeilen = [...kinder(root, 'InvoiceLine'), ...kinder(root, 'CreditNoteLine')];
  return {
    syntax: 'UBL',
    format: formatName(wert(root, 'CustomizationID'), 'UBL'),
    gutschrift,
    nummer: wert(root, 'ID'),
    datum: datum(wert(root, 'IssueDate')),
    faellig: datum(wert(root, 'DueDate') || wert(zahlung, 'PaymentDueDate')),
    waehrung: wert(root, 'DocumentCurrencyCode') || 'EUR',
    leitwegId: wert(root, 'BuyerReference'),
    verkaeufer: ublPartei(kind(root, 'AccountingSupplierParty')),
    kaeufer: ublPartei(kind(root, 'AccountingCustomerParty')),
    netto: cent(wert(summen, 'TaxExclusiveAmount')),
    steuer: cent(wert(steuerSumme, 'TaxAmount')),
    brutto: cent(wert(summen, 'TaxInclusiveAmount')),
    zahlbetrag: cent(wert(summen, 'PayableAmount')),
    steuersaetze: kinder(steuerSumme, 'TaxSubtotal').map((s) => ({
      satz: Number(wert(s, 'TaxCategory', 'Percent') || 0),
      basis: cent(wert(s, 'TaxableAmount')),
      steuer: cent(wert(s, 'TaxAmount')),
      kategorie: wert(s, 'TaxCategory', 'ID'),
    })),
    positionen: zeilen.map((z) => {
      const menge = kind(z, 'InvoicedQuantity') || kind(z, 'CreditedQuantity');
      return {
        nr: wert(z, 'ID'),
        name: wert(z, 'Item', 'Name') || wert(z, 'Item', 'Description'),
        menge: Number(text(menge) || 0),
        einheit: EINHEITEN[menge?.attrs?.unitCode] || menge?.attrs?.unitCode || '',
        einzelpreis: cent(wert(z, 'Price', 'PriceAmount')),
        netto: cent(wert(z, 'LineExtensionAmount')),
        satz: Number(wert(z, 'Item', 'ClassifiedTaxCategory', 'Percent') || 0),
      };
    }),
    iban: wert(zahlung, 'PayeeFinancialAccount', 'ID'),
    verwendungszweck: wert(zahlung, 'PaymentID'),
    zahlungsbedingungen: wert(root, 'PaymentTerms', 'Note'),
    hinweise: kinder(root, 'Note').map(text).filter(Boolean),
  };
}

/* -------------------------------------------------------------------------- */
/* CII: CrossIndustryInvoice (ZUGFeRD 2.x / Factur-X)                          */
/* -------------------------------------------------------------------------- */

function ciiPartei(p) {
  const reg = kinder(p, 'SpecifiedTaxRegistration').map((r) => kind(r, 'ID'));
  const nachSchema = (id) => text(reg.find((r) => String(r?.attrs?.schemeID || '').toUpperCase() === id));
  const adr = kind(p, 'PostalTradeAddress');
  return {
    name: wert(p, 'Name'),
    ustId: nachSchema('VA'),
    steuernummer: nachSchema('FC'),
    anschrift: [wert(adr, 'LineOne'), wert(adr, 'LineTwo'),
      [wert(adr, 'PostcodeCode'), wert(adr, 'CityName')].filter(Boolean).join(' '), wert(adr, 'CountryID')]
      .filter(Boolean).join(', '),
    email: wert(p, 'URIUniversalCommunication', 'URIID') || wert(p, 'DefinedTradeContact', 'EmailURIUniversalCommunication', 'URIID'),
  };
}

function cii(root) {
  const dokument = kind(root, 'ExchangedDocument');
  const handel = kind(root, 'SupplyChainTradeTransaction');
  const vereinbarung = kind(handel, 'ApplicableHeaderTradeAgreement');
  const abrechnung = kind(handel, 'ApplicableHeaderTradeSettlement');
  const waehrung = wert(abrechnung, 'InvoiceCurrencyCode') || 'EUR';
  const summen = kind(abrechnung, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  // Die Steuersumme kann zweimal stehen (Rechnungs- und Buchungswährung).
  const steuerSummen = kinder(summen, 'TaxTotalAmount');
  const steuerSumme = steuerSummen.find((s) => !s.attrs.currencyID || s.attrs.currencyID === waehrung) || steuerSummen[0];
  const zahlungsmittel = kinder(abrechnung, 'SpecifiedTradeSettlementPaymentMeans');
  const typ = wert(dokument, 'TypeCode');
  return {
    syntax: 'CII',
    format: formatName(wert(root, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID'), 'CII'),
    gutschrift: typ === '381',
    nummer: wert(dokument, 'ID'),
    datum: datum(wert(dokument, 'IssueDateTime', 'DateTimeString')),
    faellig: datum(wert(abrechnung, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString')),
    waehrung,
    leitwegId: wert(vereinbarung, 'BuyerReference'),
    verkaeufer: ciiPartei(kind(vereinbarung, 'SellerTradeParty')),
    kaeufer: ciiPartei(kind(vereinbarung, 'BuyerTradeParty')),
    netto: cent(wert(summen, 'TaxBasisTotalAmount')),
    steuer: cent(text(steuerSumme)),
    brutto: cent(wert(summen, 'GrandTotalAmount')),
    zahlbetrag: cent(wert(summen, 'DuePayableAmount')),
    steuersaetze: kinder(abrechnung, 'ApplicableTradeTax').map((s) => ({
      satz: Number(wert(s, 'RateApplicablePercent') || 0),
      basis: cent(wert(s, 'BasisAmount')),
      steuer: cent(wert(s, 'CalculatedAmount')),
      kategorie: wert(s, 'CategoryCode'),
    })),
    positionen: kinder(handel, 'IncludedSupplyChainTradeLineItem').map((z) => {
      const menge = pfad(z, 'SpecifiedLineTradeDelivery', 'BilledQuantity');
      return {
        nr: wert(z, 'AssociatedDocumentLineDocument', 'LineID'),
        name: wert(z, 'SpecifiedTradeProduct', 'Name'),
        menge: Number(text(menge) || 0),
        einheit: EINHEITEN[menge?.attrs?.unitCode] || menge?.attrs?.unitCode || '',
        einzelpreis: cent(wert(z, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount')),
        netto: cent(wert(z, 'SpecifiedLineTradeSettlement', 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount')),
        satz: Number(wert(z, 'SpecifiedLineTradeSettlement', 'ApplicableTradeTax', 'RateApplicablePercent') || 0),
      };
    }),
    iban: zahlungsmittel.map((z) => wert(z, 'PayeePartyCreditorFinancialAccount', 'IBANID')).find(Boolean) || '',
    verwendungszweck: wert(abrechnung, 'PaymentReference'),
    zahlungsbedingungen: wert(abrechnung, 'SpecifiedTradePaymentTerms', 'Description'),
    hinweise: kinder(dokument, 'IncludedNote').map((n) => wert(n, 'Content')).filter(Boolean),
  };
}

/* -------------------------------------------------------------------------- */
/* Einstieg                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Liest eine E-Rechnung aus XML-Text. Liefert null, wenn es keine ist
 * (etwa eine andere XML-Datei) – wirft nur bei kaputtem XML nicht, sondern
 * liefert dann ebenfalls null.
 */
export function eRechnungLesen(xml) {
  let root;
  try { root = xmlBaum(xml); } catch { return null; }
  if (root.name === 'Invoice' || root.name === 'CreditNote') return ubl(root);
  if (root.name === 'CrossIndustryInvoice') return cii(root);
  return null;
}

async function entpacken(bytes) {
  const strom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

/**
 * Sucht in einem PDF nach einer eingebetteten Rechnung (ZUGFeRD, Factur-X,
 * XRechnung als Anhang) und liefert deren XML-Text oder null.
 *
 * Eingebettete Dateien sind eigene Datenströme mit /Type /EmbeddedFile im
 * Kopf; sie dürfen nicht in Objektströmen stecken und lassen sich deshalb
 * direkt im Dateitext finden. Entpackt wird nur /FlateDecode.
 */
export async function xmlAusPdf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (u8.length < 8 || u8.length > MAX_PDF || u8[0] !== 0x25 || u8[1] !== 0x50 || u8[2] !== 0x44 || u8[3] !== 0x46) return null;
  // latin1: ein Zeichen je Byte, damit Positionen im Text denen in den Bytes entsprechen.
  const t = new TextDecoder('latin1').decode(u8);
  let pos = 0;
  for (let n = 0; n < 5000; n++) {
    pos = t.indexOf('stream', pos);
    if (pos < 0) break;
    if (t.slice(pos - 3, pos) === 'end') { pos += 6; continue; }
    const kopf = t.slice(Math.max(0, t.lastIndexOf(' obj', pos)), pos);
    let start = pos + 6;
    if (t[start] === '\r') start++;
    if (t[start] === '\n') start++;
    const ende = t.indexOf('endstream', start);
    if (ende < 0) break;
    if (/\/Type\s*\/EmbeddedFile\b/.test(kopf)) {
      let stop = ende;
      if (t[stop - 1] === '\n') stop--;
      if (t[stop - 1] === '\r') stop--;
      let daten = u8.subarray(start, stop);
      try {
        if (/\/FlateDecode/.test(kopf)) daten = await entpacken(daten);
        const xml = new TextDecoder('utf-8').decode(daten);
        if (/<(?:[\w-]+:)?(CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(xml)) return xml;
      } catch { /* nächster Datenstrom */ }
    }
    pos = ende + 9;
  }
  return null;
}

/**
 * Liest eine E-Rechnung aus einer Belegdatei – XML direkt, PDF mit
 * eingebetteter Rechnung. Liefert null, wenn die Datei keine enthält.
 * @param {Uint8Array} bytes
 * @param {{mime?:string, fileName?:string}} meta
 */
export async function eRechnungAusDatei(bytes, meta = {}) {
  const name = String(meta.fileName || '').toLowerCase();
  const mime = String(meta.mime || '').toLowerCase();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (mime.includes('pdf') || name.endsWith('.pdf') || (u8[0] === 0x25 && u8[1] === 0x50)) {
    const xml = await xmlAusPdf(u8);
    return xml ? eRechnungLesen(xml) : null;
  }
  if (mime.includes('xml') || name.endsWith('.xml') || u8[0] === 0x3c || (u8[0] === 0xef && u8[3] === 0x3c)) {
    return eRechnungLesen(new TextDecoder('utf-8').decode(u8));
  }
  return null;
}

/**
 * Welche Seite der Rechnung ist der eigene Betrieb? Über USt-IdNr. oder Name
 * aus den Einstellungen. 'expense', wenn der Betrieb Käufer ist, 'income',
 * wenn er verkauft hat, sonst ''.
 */
export function richtung(r, settings = {}) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const eigeneId = norm(settings.vatId);
  const eigenerName = norm(settings.companyName);
  const passt = (p) => (!!eigeneId && norm(p?.ustId) === eigeneId) || (!!eigenerName && norm(p?.name) === eigenerName);
  if (passt(r?.kaeufer)) return 'expense';
  if (passt(r?.verkaeufer)) return 'income';
  return '';
}
