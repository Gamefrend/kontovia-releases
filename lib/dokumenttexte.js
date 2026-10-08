/**
 * Kontovia – kleine Texte für Dokumente in der zweiten Sprache.
 *
 * Rechnung, Mahnschreiben und E-Mail erscheinen in der Sprache des Dokuments
 * (Feld `sprache` der Rechnung, „de“ oder „en“), unabhängig von der Oberfläche.
 * Feste Texte übersetzt das Wörterbuch (sprache.js: t, im Aufbau mit inSprache).
 * Hier stehen die wenigen Wörter, die kein eigener Eintrag des Wörterbuchs sind
 * (Bindewörter in zusammengesetzten Zeilen) und die englischen Standardtexte der
 * Mahnschreiben und E-Mails. Die Datei zählt nicht als Oberfläche
 * (scripts/sprache.js liest sie nicht).
 */

/** Sprachen eines Dokuments; die Namen stehen in ihrer eigenen Sprache. */
export const DOKUMENT_SPRACHEN = [{ code: 'de', name: 'Deutsch' }, { code: 'en', name: 'English' }];

/** „Rechnung an Müller“ / „Invoice to Müller“. */
export const AN = { de: 'an', en: 'to' };

/**
 * Die Standardtexte über und unter der Rechnung (rechnung.js: PROFIL_VORGABE) auf Englisch, mit denselben
 * Absätzen. Wer sie nicht geändert hat, bekommt sie in der Sprache des Dokuments; eigene Texte bleiben, wie geschrieben.
 */
export const STANDARD_EN = {
  'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Wir berechnen Ihnen folgende Leistungen:': 'Dear Sir or Madam,\n\nthank you for your order. We are invoicing you for the following services:',
  'Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer.\nMit freundlichen Grüßen': 'Please transfer the amount quoting the invoice number.\nKind regards',
};

/** Die Standardtexte der Mahnschreiben (mahnwesen.js: MAHNTEXTE) auf Englisch; {betrag} und {frist} setzt mahnschreiben ein. */
export const MAHNTEXTE_EN = {
  1: {
    kopf: 'Dear Sir or Madam,\n\nwhile reviewing our accounts we noticed that the invoice listed below has not been paid yet. The payment may simply have been overlooked. We kindly ask you to transfer {betrag} by {frist}.',
    schluss: 'If you have already paid in the meantime, please disregard this letter.\nKind regards',
  },
  2: {
    kopf: 'Dear Sir or Madam,\n\nwe have not yet received the amount of the invoice listed below, although it is overdue. We kindly ask you to transfer {betrag} by {frist}.',
    schluss: 'If you have already paid in the meantime, please disregard this letter.\nKind regards',
  },
  3: {
    kopf: 'Dear Sir or Madam,\n\nour previous letters have gone unanswered. We are therefore setting a final deadline: please transfer {betrag} by {frist}.',
    schluss: 'After the deadline has passed, we reserve the right to enforce the claim in court. This will cause you further costs.\nIf you have already paid in the meantime, please disregard this letter.\nKind regards',
  },
};

/** Der Betrag im Satz „Wir bitten Sie, {betrag} bis zum {frist} zu überweisen.“ */
export const GESAMTBETRAG_EN = (betrag) => `the total amount of ${betrag}`;

/** Der Standardtext der E-Mail zur Rechnung (emailversand.js: STANDARD) auf Englisch, mit denselben Platzhaltern. */
export const MAIL_STANDARD_EN = {
  betreff: '{Art} {Nummer} from {Absender}',
  text: [
    'Hello,',
    '',
    'please find attached our {Art} {Nummer} dated {Datum} for {Betrag}.',
    '{Zahlungshinweis}',
    '',
    'The {Art} is attached as a PDF. The invoice data is also contained in it in machine-readable form (e-invoice).',
    '',
    'Kind regards',
    '{Absender}',
  ].join('\n'),
};

/** Der Satz zur Zahlung in der E-Mail. teilBetrag: „the outstanding amount of …“ oder „the amount“. */
export const ZAHLUNGSHINWEIS_EN = {
  frist: (betragTeil, datum) => `Please pay ${betragTeil} by ${datum}.`,
  ohneFrist: 'Please pay the amount without deduction.',
  offenerBetrag: (betrag) => `the outstanding amount of ${betrag}`,
  betrag: 'the amount',
};
