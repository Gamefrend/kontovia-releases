/**
 * Kontovia – E-Mails vorbereiten.
 *
 * Kontovia hat keinen eigenen Mailserver. Die Mail entsteht fertig auf dem
 * Gerät und geht über das Konto oder Programm des Nutzers hinaus, auf einem
 * von fünf Wegen:
 *
 *   google     direkt über Gmail (src/web/mailversand.js), Nachricht als MIME
 *   microsoft  direkt über Outlook.com/Microsoft 365, Nachricht als JSON
 *   eml        E-Mail-Entwurf als Datei (MIME mit Anhängen, „X-Unsent: 1“),
 *              landet im Download-Ordner; ein Klick öffnet ihn in Outlook,
 *              Thunderbird oder Apple Mail. Der Weg am Rechner ohne Konto.
 *   teilen     Teilen-Menü des Geräts mit den Dateien (Mail, Outlook, Gmail …).
 *              Das Menü kennt keinen Empfänger; die Adresse kommt vorher in
 *              die Zwischenablage. Der Weg am Telefon.
 *   mailto     Nur Empfänger, Betreff und Text; Anhänge kann mailto: nicht.
 *
 * Hier liegen nur die reinen Teile (Text, Nachricht, mailto-Adresse);
 * das Fenster dazu steht in views/rechnungen.js.
 */

import { fmtDate } from './util.js';
import { berechnen, faelligkeit, betragText, titel as titelVon, dokumentSprache } from './rechnung.js';
import { t, inSprache } from './sprache.js';
import { MAIL_STANDARD_EN, ZAHLUNGSHINWEIS_EN } from './dokumenttexte.js';
import { base64 } from './pdfausgabe.js';

export const WEGE = ['google', 'microsoft', 'eml', 'teilen', 'mailto'];
/** Wege, auf denen Kontovia selbst sendet (über das Konto des Nutzers). */
export const DIREKT = ['google', 'microsoft'];

/* -------------------------------------------------------------------------- */
/* Standardtext                                                                */
/* -------------------------------------------------------------------------- */

/** Platzhalter im Standardtext und was sie bedeuten (für das Fenster zum Ändern). */
export const PLATZHALTER = [
  ['Art', 'Rechnung, Gutschrift oder Stornorechnung'],
  ['Nummer', 'Rechnungsnummer'],
  ['Datum', 'Rechnungsdatum'],
  ['Betrag', 'Gesamtbetrag'],
  ['Zahlungshinweis', 'Satz mit Betrag und Frist, fällt bei bezahlten Rechnungen weg'],
  ['Kunde', 'Name des Kunden'],
  ['Absender', 'Ihr Name oder Ihre Firma'],
];

export const STANDARD = {
  betreff: '{Art} {Nummer} von {Absender}',
  text: [
    'Guten Tag,',
    '',
    'anbei erhalten Sie unsere {Art} {Nummer} vom {Datum} über {Betrag}.',
    '{Zahlungshinweis}',
    '',
    'Die {Art} liegt als PDF bei. Die Rechnungsdaten sind darin auch maschinenlesbar enthalten (E-Rechnung).',
    '',
    'Mit freundlichen Grüßen',
    '{Absender}',
  ].join('\n'),
};

/**
 * Der gespeicherte Standardtext für Rechnungen, sonst der eingebaute. Hat die Rechnung die Sprache Englisch,
 * wird der unveränderte deutsche Standardtext zum englischen; eigene Texte bleiben, wie geschrieben.
 */
export function vorlageAus(settings, sprache = 'de') {
  const v = settings?.mailVorlagen?.rechnung;
  const eigen = (s) => typeof s === 'string' && s.trim();
  const wahl = (gespeichert, de, en) => (eigen(gespeichert) && !(sprache === 'en' && gespeichert === de) ? gespeichert : (sprache === 'en' ? en : de));
  return {
    betreff: wahl(v?.betreff, STANDARD.betreff, MAIL_STANDARD_EN.betreff),
    text: wahl(v?.text, STANDARD.text, MAIL_STANDARD_EN.text),
  };
}

/** Die Werte der Platzhalter für eine Rechnung. offen: Zahlung steht noch aus. */
export function werteFuer(r, settings = {}, opt = {}) {
  return inSprache(dokumentSprache(r), () => werteAufbau(r, settings, opt));
}

function werteAufbau(r, settings, { offen = true } = {}) {
  const en = dokumentSprache(r) === 'en';
  const b = berechnen(r);
  const faellig = faelligkeit(r);
  const zahlbar = offen && b.zahlbetrag > 0 && !r.storno;
  return {
    Art: t(titelVon(r)),
    Nummer: r.nummer || '',
    Datum: fmtDate(r.datum),
    Betrag: betragText(b.brutto, r.waehrung),
    Zahlungshinweis: !zahlbar ? ''
      : en ? (faellig ? ZAHLUNGSHINWEIS_EN.frist(b.zahlbetrag !== b.brutto ? ZAHLUNGSHINWEIS_EN.offenerBetrag(betragText(b.zahlbetrag, r.waehrung)) : ZAHLUNGSHINWEIS_EN.betrag, fmtDate(faellig)) : ZAHLUNGSHINWEIS_EN.ohneFrist)
        : faellig ? `Bitte zahlen Sie ${b.zahlbetrag !== b.brutto ? `den offenen Betrag von ${betragText(b.zahlbetrag, r.waehrung)}` : 'den Betrag'} bis zum ${fmtDate(faellig)}.`
          : 'Bitte zahlen Sie den Betrag ohne Abzug.',
    Kunde: r.kaeufer?.name || '',
    Absender: r.verkaeufer?.name || settings.companyName || settings.ownerName || '',
  };
}

/**
 * Setzt die Werte ein. Zeilen, die nur aus einem leeren Platzhalter bestanden,
 * fallen weg, und mehr als eine Leerzeile hintereinander wird zu einer.
 */
export function ausfuellen(vorlage, werte) {
  const ein = (s) => String(s || '').replace(/\{([A-Za-zÄÖÜäöüß]+)\}/g, (m, k) => (k in werte ? werte[k] : m));
  const zeilen = String(vorlage.text || '').replace(/\r\n?/g, '\n').split('\n')
    .filter((z) => !(/^\s*(\{[A-Za-zÄÖÜäöüß]+\}\s*)+$/.test(z) && !ein(z).trim()))
    .map(ein);
  const text = zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { betreff: ein(vorlage.betreff).replace(/\s+/g, ' ').trim(), text };
}

/** Betreff und Text für eine Rechnung, fertig ausgefüllt. */
export function mailFuer(r, settings = {}, opt = {}) {
  return ausfuellen(vorlageAus(settings, dokumentSprache(r)), werteFuer(r, settings, opt));
}

/* -------------------------------------------------------------------------- */
/* Adressen                                                                    */
/* -------------------------------------------------------------------------- */

/** Mehrere Adressen, getrennt durch Komma, Semikolon oder Leerraum. */
export function adressen(eingabe) {
  return String(eingabe || '').split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
}

export const adresseOk = (a) => /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/.test(String(a || ''));

/* -------------------------------------------------------------------------- */
/* mailto:                                                                     */
/* -------------------------------------------------------------------------- */

/* Windows reicht mailto-Adressen nur bis gut 2000 Zeichen an das Mailprogramm weiter. */
const MAILTO_MAX = 1900;

const kodiert = (s) => encodeURIComponent(s);

/**
 * mailto-Adresse. Ist sie zu lang, wird der Text gekürzt.
 * @returns {{url:string, gekuerzt:boolean}}
 */
export function mailtoAdresse({ an = [], betreff = '', text = '' }) {
  const ziel = (Array.isArray(an) ? an : adressen(an)).map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',');
  const kopf = `mailto:${ziel}?subject=${kodiert(betreff)}`;
  const crlf = String(text).replace(/\r?\n/g, '\r\n');
  let url = `${kopf}&body=${kodiert(crlf)}`;
  if (url.length <= MAILTO_MAX) return { url, gekuerzt: false };
  // Zeichenweise kürzen, damit kein Zeichen in der Mitte zerschnitten wird.
  const zeichen = [...crlf];
  let n = zeichen.length;
  do {
    n = Math.floor(n * 0.9);
    url = `${kopf}&body=${kodiert(zeichen.slice(0, n).join('') + ' …')}`;
  } while (url.length > MAILTO_MAX && n > 0);
  return { url, gekuerzt: true };
}

/* -------------------------------------------------------------------------- */
/* E-Mail-Entwurf (.eml)                                                       */
/* -------------------------------------------------------------------------- */

const utf8 = (s) => new TextEncoder().encode(String(s));
const zeilenweise = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');
/* Kein Zeilenumbruch in Kopfzeilen: sonst ließen sich weitere Kopfzeilen einschleusen. */
const einzeilig = (s) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim();

/** Kopfzeilen-Text nach RFC 2047, in Stücken, die kein Zeichen zerschneiden. */
export function kopfKodiert(s) {
  const t = einzeilig(s);
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const teile = [];
  let stueck = '';
  for (const z of t) {
    // 39 Bytes ergeben 52 Zeichen Base64: auch die erste Zeile mit „Subject: “ bleibt unter 78 Zeichen.
    if (utf8(stueck + z).length > 39) { teile.push(stueck); stueck = ''; }
    stueck += z;
  }
  if (stueck) teile.push(stueck);
  return teile.map((x) => `=?UTF-8?B?${base64(utf8(x))}?=`).join('\r\n ');
}

/** Dateiname für den Anhang: ASCII für alte Programme, dazu der echte nach RFC 2231. */
function dateiname(name) {
  const ascii = einzeilig(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'anhang';
  if (ascii === name) return `filename="${ascii}"`;
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(einzeilig(name))}`;
}

/**
 * Eine E-Mail mit Anhängen im MIME-Format: als Entwurf für die .eml-Datei
 * (öffnet als neue Nachricht) oder fertig zum Senden über Gmail.
 * @param {{an:string[]|string, betreff:string, text:string, anhaenge:{name:string, mime:string, bytes:Uint8Array}[]}} mail
 * @returns {Uint8Array}
 */
export function emlBauen({ an = [], betreff = '', text = '', anhaenge = [] }, { grenze = '', entwurf = true } = {}) {
  const b = grenze || `kontovia-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('')}`;
  const ziel = (Array.isArray(an) ? an : adressen(an)).map(einzeilig).filter(Boolean);
  const teile = [
    ...(entwurf ? ['X-Unsent: 1'] : []),
    ...(ziel.length ? [`To: ${ziel.join(', ')}`] : []),
    `Subject: ${kopfKodiert(betreff)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    'Dies ist eine E-Mail im MIME-Format.',
    '',
    `--${b}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    zeilenweise(base64(utf8(String(text).replace(/\r?\n/g, '\r\n')))).trimEnd(),
  ];
  for (const a of anhaenge) {
    const typ = einzeilig(a.mime) || 'application/octet-stream';
    teile.push(
      `--${b}`,
      `Content-Type: ${typ}; name="${einzeilig(a.name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`,
      `Content-Disposition: attachment; ${dateiname(a.name)}`,
      'Content-Transfer-Encoding: base64',
      '',
      zeilenweise(base64(a.bytes)).trimEnd(),
    );
  }
  teile.push(`--${b}--`, '');
  return utf8(teile.join('\r\n'));
}

/* -------------------------------------------------------------------------- */
/* Nachricht für Microsoft                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Dieselbe E-Mail im Format, das Microsoft zum Senden annimmt.
 * @returns {object} { subject, body, toRecipients, attachments }
 */
export function graphNachricht({ an = [], betreff = '', text = '', anhaenge = [] }) {
  return {
    subject: einzeilig(betreff),
    body: { contentType: 'Text', content: String(text) },
    toRecipients: (Array.isArray(an) ? an : adressen(an)).map(einzeilig).filter(Boolean).map((address) => ({ emailAddress: { address } })),
    attachments: anhaenge.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: einzeilig(a.name),
      contentType: einzeilig(a.mime) || 'application/octet-stream',
      contentBytes: base64(a.bytes),
    })),
  };
}
