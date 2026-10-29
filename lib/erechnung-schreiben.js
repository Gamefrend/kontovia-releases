/**
 * Kontovia – E-Rechnungen schreiben (UN/CEFACT CII, EN 16931).
 *
 * Eine Syntax, zwei Profile:
 *   'en16931'   ZUGFeRD 2.x / Factur-X im Profil EN 16931 (COMFORT). Diese
 *               XML steckt als factur-x.xml im PDF (lib/rechnungsdruck.js).
 *   'xrechnung' XRechnung 3.0 in CII-Syntax, für öffentliche Auftraggeber.
 *               Dieselben Daten, dazu die deutschen Regeln BR-DE-*.
 *
 * Die Reihenfolge der Elemente folgt dem Schema (CrossIndustryInvoice D16B);
 * ein Validator weist eine Datei mit vertauschten Elementen ab. Geschrieben
 * wird nur, was es gibt: leere Elemente sind in E-Rechnungen unzulässig.
 *
 * Rein regelbasiert, die Werte kommen aus lib/rechnung.js (berechnen).
 */

import {
  berechnen, faelligkeit, zahlungsText, anzahlungTeile, istGutschrift, satzText, betragText, AUFBEWAHRUNG_TEXT, HAUSHALT_TEXT, haushaltsZeilen, ZAHLUNGSARTEN, STEUERFAELLE,
  IST_VERMERK, istVermerkNoetig, dokumentSprache, steuerInEuro,
} from './rechnung.js';
import { istFremd, kursGueltig } from './waehrung.js';
import { t as uebersetzen, inSprache } from './sprache.js';

const T = (s) => uebersetzen(s);

export const PROFILE = {
  en16931: { name: 'ZUGFeRD / Factur-X (EN 16931)', guideline: 'urn:cen.eu:en16931:2017', prozess: '' },
  xrechnung: {
    name: 'XRechnung 3.0',
    guideline: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    prozess: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
  },
};

const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
};

/** XML-Text maskieren; Steuerzeichen außer Tab und Zeilenumbruch sind in XML 1.0 verboten. */
function x(s) {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Cent → „1234.50“ */
export const betrag = (cent) => {
  const n = Math.round(Number(cent) || 0);
  const s = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.floor(s / 100)}.${String(s % 100).padStart(2, '0')}`;
};

/** Menge → „1.5“ (höchstens vier Nachkommastellen, ohne Nullen am Ende). */
export const menge = (m) => {
  const s = (Math.round((Number(m) || 0) * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};

const prozent = (p) => menge(p);
const datum102 = (iso) => String(iso || '').replace(/-/g, '').slice(0, 8);

/**
 * Kleiner Baumschreiber: ['ram:Name', 'Text'] oder ['ram:X', {attr}, kinder…].
 * Kinder, die null/undefined/false sind oder leer bleiben, entfallen.
 */
function el(name, ...rest) {
  let attrs = null;
  if (rest.length && rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0])) attrs = rest.shift();
  const kinder = rest.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== '');
  if (!kinder.length) return '';
  const a = attrs ? Object.entries(attrs).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => ` ${k}="${x(v)}"`).join('') : '';
  const istText = kinder.length === 1 && typeof kinder[0] === 'string' && !kinder[0].startsWith('<');
  if (istText) return `<${name}${a}>${x(kinder[0])}</${name}>`;
  const innen = kinder.map((k) => (typeof k === 'string' && !k.startsWith('<') ? x(k) : k)).join('');
  return innen ? `<${name}${a}>${innen}</${name}>` : '';
}

/** Text, der garantiert als Text geschrieben wird (auch wenn er mit „<“ beginnt). */
const t = (name, wert, attrs, { roh = false } = {}) => {
  const s = roh ? String(wert ?? '') : String(wert ?? '').trim();
  if (!s.trim()) return '';
  const a = attrs ? Object.entries(attrs).filter(([, v]) => v).map(([k, v]) => ` ${k}="${x(v)}"`).join('') : '';
  return `<${name}${a}>${x(s)}</${name}>`;
};

const datumEl = (name, iso, ns = 'udt') => (iso ? `<${name}><${ns}:DateTimeString format="102">${datum102(iso)}</${ns}:DateTimeString></${name}>` : '');

function anschrift(a) {
  return el('ram:PostalTradeAddress',
    t('ram:PostcodeCode', a.plz),
    t('ram:LineOne', a.strasse),
    t('ram:LineTwo', a.zusatz),
    t('ram:CityName', a.ort),
    t('ram:CountryID', String(a.land || 'DE').toUpperCase()));
}

function verkaeuferPartei(v, profil, nichtSteuerbar = false) {
  // BR-CO-26 verlangt eine Kennung des Verkäufers (BT-29, BT-30 oder BT-31).
  // Ohne USt-IdNr. dient die Steuernummer als Kennung. Bei nicht steuerbaren
  // Leistungen (Kategorie O) darf keine USt-IdNr. in der Datei stehen (BR-O-2).
  const ustId = nichtSteuerbar ? '' : v.ustId;
  const kennung = !ustId && v.steuernummer ? v.steuernummer : '';
  const rechtlich = [v.register, v.geschaeftsfuehrung ? `${T('Geschäftsführung')}: ${v.geschaeftsfuehrung}` : ''].filter(Boolean).join(', ');
  const kontaktNoetig = profil === 'xrechnung' || v.telefon || v.email;
  return el('ram:SellerTradeParty',
    t('ram:ID', kennung),
    t('ram:Name', v.name),
    t('ram:Description', rechtlich),
    kontaktNoetig ? el('ram:DefinedTradeContact',
      t('ram:PersonName', v.inhaber || v.name),
      v.telefon ? el('ram:TelephoneUniversalCommunication', t('ram:CompleteNumber', v.telefon)) : '',
      v.email ? el('ram:EmailURIUniversalCommunication', t('ram:URIID', v.email)) : '') : '',
    anschrift(v),
    v.email ? el('ram:URIUniversalCommunication', t('ram:URIID', v.email, { schemeID: 'EM' })) : '',
    ustId ? el('ram:SpecifiedTaxRegistration', t('ram:ID', ustId, { schemeID: 'VA' })) : '',
    v.steuernummer ? el('ram:SpecifiedTaxRegistration', t('ram:ID', v.steuernummer, { schemeID: 'FC' })) : '');
}

function kaeuferPartei(k, nichtSteuerbar = false) {
  return el('ram:BuyerTradeParty',
    t('ram:ID', k.kundennummer),
    t('ram:Name', k.name),
    anschrift(k),
    k.email ? el('ram:URIUniversalCommunication', t('ram:URIID', k.email, { schemeID: 'EM' })) : '',
    k.ustId && !nichtSteuerbar ? el('ram:SpecifiedTaxRegistration', t('ram:ID', String(k.ustId).replace(/\s/g, '').toUpperCase(), { schemeID: 'VA' })) : '');
}

/** Kategorie O (nicht steuerbar) trägt in der Position keinen Steuersatz (BR-O-5). */
const satzEl = (kategorie, satz) => (kategorie === 'O' ? '' : t('ram:RateApplicablePercent', prozent(satz)));
/** In der Steueraufschlüsselung verlangt die XRechnung immer einen Satz (BR-DE-14), bei O also 0 (SEC-36, KoSIT 3.0.2). */
const summenSatzEl = (kategorie, satz) => t('ram:RateApplicablePercent', prozent(kategorie === 'O' ? 0 : satz));

function position(z) {
  return el('ram:IncludedSupplyChainTradeLineItem',
    el('ram:AssociatedDocumentLineDocument', t('ram:LineID', String(z.nr))),
    el('ram:SpecifiedTradeProduct',
      t('ram:SellerAssignedID', z.artikelnummer),
      t('ram:Name', z.name || z.beschreibung || 'Position'),
      t('ram:Description', z.name ? z.beschreibung : '')),
    el('ram:SpecifiedLineTradeAgreement',
      el('ram:NetPriceProductTradePrice', t('ram:ChargeAmount', betrag(z.preis)))),
    el('ram:SpecifiedLineTradeDelivery', t('ram:BilledQuantity', menge(z.menge), { unitCode: z.einheit || 'C62' })),
    el('ram:SpecifiedLineTradeSettlement',
      el('ram:ApplicableTradeTax',
        t('ram:TypeCode', 'VAT'),
        t('ram:CategoryCode', z.kategorie),
        satzEl(z.kategorie, z.satz)),
      // Rabatt auf die Position (BG-27): der Preis bleibt der Listenpreis, die Zeilensumme ist um den Rabatt kleiner (BR-CO-10).
      z.rabattBetrag ? el('ram:SpecifiedTradeAllowanceCharge',
        el('ram:ChargeIndicator', '<udt:Indicator>false</udt:Indicator>'),
        t('ram:CalculationPercent', prozent(z.rabatt)),
        t('ram:BasisAmount', betrag(z.vorRabatt)),
        t('ram:ActualAmount', betrag(z.rabattBetrag)),
        t('ram:ReasonCode', '95'),
        t('ram:Reason', T('Rabatt'))) : '',
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', t('ram:LineTotalAmount', betrag(z.netto)))));
}

/**
 * Die E-Rechnung als XML-Text.
 * @param {object} r Rechnung (lib/rechnung.js)
 * @param {object} v Verkäufer (verkaeuferAus)
 * @param {{profil?:'en16931'|'xrechnung'}} opts
 */
export function eRechnungXml(r, v, optionen = {}) {
  // Freitexte (Hinweise, Zahlungsbedingungen) stehen in der Sprache des Dokuments.
  return inSprache(dokumentSprache(r), () => eRechnungAufbau(r, v, optionen));
}

function eRechnungAufbau(r, v, { profil = 'en16931' } = {}) {
  const p = PROFILE[profil] || PROFILE.en16931;
  const b = berechnen(r);
  const k = r.kaeufer || {};
  const fall = STEUERFAELLE[r.steuerfall] || STEUERFAELLE.standard;
  // Bei einer Gutschrift zahlen wir an den Kunden; unsere eigene IBAN wäre als
  // Zahlungsziel falsch. Code 1 (nicht festgelegt) braucht kein Konto.
  // Ebenso Code 1 bei Karte (BG-18 verlangt Kartendaten, die nicht erfasst werden) und bei Überweisung
  // ohne eigene IBAN, wenn nichts mehr offen ist (BR-DE-23 braucht sonst ein Konto).
  const zahlart0 = istGutschrift(r) ? { name: 'Gutschrift', code: '1' } : (ZAHLUNGSARTEN[r.zahlungsart] || ZAHLUNGSARTEN.ueberweisung);
  const ohneKonto = zahlart0.code === '58' && !v.iban && !(b.zahlbetrag > 0);
  const zahlart = { ...zahlart0, name: T(zahlart0.name), code: zahlart0.code === '48' || ohneKonto ? '1' : zahlart0.code };
  // Lastschrift (BG-19, SEC-63): Mandat (BT-89) und Konto des Kunden (BT-91) aus dem Kontakt, Gläubiger-ID (BT-90) von Ihnen.
  const lastschrift = zahlart.code === '59';
  const mandat = k.mandat || {};
  const due = faelligkeit(r);
  const waehrung = r.waehrung || 'EUR';
  const steuerEuro = istFremd(waehrung) && kursGueltig(r.kurs) ? steuerInEuro(r, b) : null;

  // Hinweise: Betreff, Kopf- und Schlusstext gehören aufs PDF; in der XML
  // stehen nur Angaben mit Rechtsfolge (Steuerbefreiung) und der Betreff.
  const hinweise = [];
  if (r.betreff) hinweise.push({ text: r.betreff });
  if (fall.kategorie && b.grund) hinweise.push({ text: T(b.grund) });
  if (istVermerkNoetig(r, v)) hinweise.push({ text: T(IST_VERMERK) });
  if (r.storno && r.bezug?.nummer) hinweise.push({ text: T(`Storno der Rechnung ${r.bezug.nummer}.`) });
  if (r.hinweisAufbewahrung) hinweise.push({ text: T(AUFBEWAHRUNG_TEXT) });
  if (!istGutschrift(r)) {
    const haushalt = haushaltsZeilen(r, b, waehrung, !fall.kategorie);
    if (haushalt.length) hinweise.push({ text: `${haushalt.map((z) => T(z)).join(' ')} ${T(HAUSHALT_TEXT)}` });
  }
  // Schlussrechnung: abgesetzte Anzahlungen samt Steuer (§ 14 Abs. 5 Satz 2 UStG).
  const anzahlung = anzahlungTeile(b).filter((a) => a.brutto && a.satz);
  if (anzahlung.length) {
    hinweise.push({ text: `${T('Abgesetzte Anzahlungen')}: ${anzahlung.map((a) => T(`${betragText(a.netto, waehrung)} netto zzgl. ${betragText(a.steuer, waehrung)} USt (${satzText(a.satz)})`)).join('; ')}.` });
  }
  const rechtlich = [v.register, v.geschaeftsfuehrung ? `Geschäftsführung: ${v.geschaeftsfuehrung}` : ''].filter(Boolean).join(', ');
  if (rechtlich) hinweise.push({ text: rechtlich, code: 'REG' });

  // Zahlungsbedingungen; die XRechnung kennt für Skonto eine feste Schreibweise (BR-DE-18).
  let bedingungen = T(zahlungsText(r)).trim();
  if (profil === 'xrechnung' && Number(r.skontoTage) > 0 && Number(r.skontoProzent) > 0) {
    const basis = b.zahlbetrag !== b.brutto ? `#BASISBETRAG=${betrag(b.zahlbetrag)}` : '';
    bedingungen += `\n#SKONTO#TAGE=${Number(r.skontoTage)}#PROZENT=${Number(r.skontoProzent).toFixed(2)}${basis}#\n`;
  }

  const leistung = r.leistungArt === 'zeitraum' && r.leistungVon && r.leistungBis;
  const lieferland = fall.kategorie === 'K' || fall.kategorie === 'G';

  const xml = el('rsm:CrossIndustryInvoice', { 'xmlns:rsm': NS.rsm, 'xmlns:qdt': NS.qdt, 'xmlns:ram': NS.ram, 'xmlns:udt': NS.udt },
    el('rsm:ExchangedDocumentContext',
      p.prozess ? el('ram:BusinessProcessSpecifiedDocumentContextParameter', t('ram:ID', p.prozess)) : '',
      el('ram:GuidelineSpecifiedDocumentContextParameter', t('ram:ID', p.guideline))),
    el('rsm:ExchangedDocument',
      t('ram:ID', r.nummer || 'ENTWURF'),
      t('ram:TypeCode', String(r.art || '380')),
      datumEl('ram:IssueDateTime', r.datum),
      hinweise.map((h) => el('ram:IncludedNote', t('ram:Content', h.text), t('ram:SubjectCode', h.code)))),
    el('rsm:SupplyChainTradeTransaction',
      b.zeilen.map(position),
      el('ram:ApplicableHeaderTradeAgreement',
        t('ram:BuyerReference', k.leitwegId || (profil === 'xrechnung' ? (k.kundennummer || r.bestellnummer || r.nummer || 'n/a') : '')),
        verkaeuferPartei(v, profil, fall.kategorie === 'O'),
        kaeuferPartei(k, fall.kategorie === 'O'),
        r.bestellnummer ? el('ram:BuyerOrderReferencedDocument', t('ram:IssuerAssignedID', r.bestellnummer)) : ''),
      el('ram:ApplicableHeaderTradeDelivery',
        lieferland ? el('ram:ShipToTradeParty', t('ram:Name', k.name), anschrift(k)) : '',
        !leistung && r.leistungsdatum ? el('ram:ActualDeliverySupplyChainEvent', datumEl('ram:OccurrenceDateTime', r.leistungsdatum)) : '',
        // Das Element muss stehen, auch wenn es leer ist (Schema).
        '<!---->'),
      el('ram:ApplicableHeaderTradeSettlement',
        lastschrift ? t('ram:CreditorReferenceID', v.glaeubigerId) : '',
        t('ram:PaymentReference', r.nummer),
        // Fremdwährung: Die Umsatzsteuer wird in Euro abgerechnet (BT-6, dazu BT-111 unten, BR-53).
        steuerEuro !== null ? t('ram:TaxCurrencyCode', 'EUR') : '',
        t('ram:InvoiceCurrencyCode', waehrung),
        el('ram:SpecifiedTradeSettlementPaymentMeans',
          t('ram:TypeCode', zahlart.code),
          t('ram:Information', zahlart.name),
          lastschrift && mandat.iban ? el('ram:PayerPartyDebtorFinancialAccount', t('ram:IBANID', mandat.iban)) : '',
          zahlart.code === '58' && v.iban ? el('ram:PayeePartyCreditorFinancialAccount', t('ram:IBANID', v.iban), t('ram:AccountName', v.kontoinhaber)) : '',
          zahlart.code === '58' && v.bic ? el('ram:PayeeSpecifiedCreditorFinancialInstitution', t('ram:BICID', v.bic)) : ''),
        b.steuern.map((g) => el('ram:ApplicableTradeTax',
          t('ram:CalculatedAmount', betrag(g.steuer)),
          t('ram:TypeCode', 'VAT'),
          t('ram:ExemptionReason', T(g.grund)),
          t('ram:BasisAmount', betrag(g.basis)),
          t('ram:CategoryCode', g.kategorie),
          t('ram:ExemptionReasonCode', g.code),
          summenSatzEl(g.kategorie, g.satz))),
        leistung ? el('ram:BillingSpecifiedPeriod', datumEl('ram:StartDateTime', r.leistungVon), datumEl('ram:EndDateTime', r.leistungBis)) : '',
        // Rabatt auf die ganze Rechnung (BG-20), je Steuersatz ein Nachlass (BR-S-08: Bemessungsgrundlage = Positionen − Nachlässe).
        b.steuern.filter((g) => g.nachlass).map((g) => el('ram:SpecifiedTradeAllowanceCharge',
          el('ram:ChargeIndicator', '<udt:Indicator>false</udt:Indicator>'),
          b.gesamtrabatt?.art === 'prozent' ? t('ram:CalculationPercent', prozent(b.gesamtrabatt.wert)) : '',
          b.gesamtrabatt?.art === 'prozent' ? t('ram:BasisAmount', betrag(g.basisVor)) : '',
          t('ram:ActualAmount', betrag(g.nachlass)),
          t('ram:ReasonCode', '95'),
          t('ram:Reason', T('Rabatt')),
          el('ram:CategoryTradeTax',
            t('ram:TypeCode', 'VAT'),
            t('ram:CategoryCode', g.kategorie),
            satzEl(g.kategorie, g.satz)))),
        el('ram:SpecifiedTradePaymentTerms', t('ram:Description', bedingungen, null, { roh: true }), b.zahlbetrag > 0 ? datumEl('ram:DueDateDateTime', due) : '',
          lastschrift ? t('ram:DirectDebitMandateID', mandat.referenz) : ''),
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation',
          t('ram:LineTotalAmount', betrag(b.positionen)),
          b.nachlass ? t('ram:AllowanceTotalAmount', betrag(b.nachlass)) : '',
          t('ram:TaxBasisTotalAmount', betrag(b.netto)),
          t('ram:TaxTotalAmount', betrag(b.steuer), { currencyID: waehrung }),
          steuerEuro !== null ? t('ram:TaxTotalAmount', betrag(steuerEuro), { currencyID: 'EUR' }) : '',
          t('ram:GrandTotalAmount', betrag(b.brutto)),
          b.bereitsGezahlt ? t('ram:TotalPrepaidAmount', betrag(b.bereitsGezahlt)) : '',
          t('ram:DuePayableAmount', betrag(b.zahlbetrag))),
        r.bezug?.nummer ? el('ram:InvoiceReferencedDocument',
          t('ram:IssuerAssignedID', r.bezug.nummer),
          r.bezug.datum ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${datum102(r.bezug.datum)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : '') : '')));
  // Der Platzhalter oben hält nur das Lieferelement am Leben.
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml.replace('<!---->', '')}\n`;
}

/** Dateiname für die XML zur Rechnung. */
export function xmlDateiname(r, profil = 'en16931') {
  const nr = String(r.nummer || 'Entwurf').replace(/[^\w.-]+/g, '_');
  return profil === 'xrechnung' ? `XRechnung_${nr}.xml` : `E-Rechnung_${nr}.xml`;
}
