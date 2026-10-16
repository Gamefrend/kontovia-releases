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
  // Angebot, Auftragsbestätigung, Lieferschein (angebote.js: BELEGARTEN)
  'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:': 'Dear Sir or Madam,\n\nthank you for your enquiry. We are pleased to offer you the following:',
  'Wir freuen uns auf Ihren Auftrag. Bei Fragen sind wir gern für Sie da.\nMit freundlichen Grüßen': 'We look forward to your order. If you have any questions, we are happy to help.\nKind regards',
  'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihren Auftrag. Wir bestätigen ihn wie folgt:': 'Dear Sir or Madam,\n\nthank you for your order. We confirm it as follows:',
  'Die Rechnung erhalten Sie nach Erbringung der Leistung.\nMit freundlichen Grüßen': 'You will receive the invoice once the work has been completed.\nKind regards',
  'Sehr geehrte Damen und Herren,\n\nwir liefern Ihnen:': 'Dear Sir or Madam,\n\nwe are delivering the following:',
  'Ware vollständig und unbeschädigt erhalten:\n\n\n______________________________\nDatum, Unterschrift': 'Goods received complete and undamaged:\n\n\n______________________________\nDate, signature',
};

/**
 * E-Mail zu einem Angebot, einer Auftragsbestätigung oder einem Lieferschein (emailversand.js: mailFuer), je Sprache.
 * {Beleg} ist die Art mit Fürwort („unser Angebot“), {Betragteil} „ über 1.190,00 €“ (fehlt beim Lieferschein),
 * {Gueltigkeit} der Satz zur Bindefrist eines Angebots.
 */
export const BELEG_MAIL = {
  de: {
    betreff: '{Art} {Nummer} von {Absender}',
    text: ['Guten Tag,', '', 'anbei erhalten Sie {Beleg} {Nummer} vom {Datum}{Betragteil}.', '{Gueltigkeit}', '', 'Bei Fragen sind wir gern für Sie da.', '', 'Mit freundlichen Grüßen', '{Absender}'].join('\n'),
  },
  en: {
    betreff: '{Art} {Nummer} from {Absender}',
    text: ['Hello,', '', 'please find attached {Beleg} {Nummer} dated {Datum}{Betragteil}.', '{Gueltigkeit}', '', 'If you have any questions, we are happy to help.', '', 'Kind regards', '{Absender}'].join('\n'),
  },
};
export const BELEG_MIT_FUERWORT = {
  de: { angebot: 'unser Angebot', auftrag: 'unsere Auftragsbestätigung', lieferschein: 'unseren Lieferschein' },
  en: { angebot: 'our quote', auftrag: 'our order confirmation', lieferschein: 'our delivery note' },
};
export const BELEG_BETRAG = { de: (b) => ` über ${b}`, en: (b) => ` for ${b}` };
export const BELEG_GUELTIG = { de: (d) => `Das Angebot gilt bis zum ${d}.`, en: (d) => `The quote is valid until ${d}.` };

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

/**
 * E-Mail zu einer Zahlungserinnerung oder Mahnung (emailversand.js: mahnungMail), je Sprache.
 * {Stufe} ist der Name der Stufe, {Zahlungshinweis} der Satz zum Online-Bezahlen (fällt ohne Link weg).
 */
export const MAHNUNG_MAIL = {
  de: {
    betreff: '{Stufe} zu {Art} {Nummer} von {Absender}',
    text: ['Guten Tag,', '', 'anbei erhalten Sie unsere {Stufe} zu {Art} {Nummer} vom {Datum}.',
      'Offen ist ein Betrag von {Betrag}. Bitte überweisen Sie ihn bis zum {Frist}.', '{Zahlungshinweis}', '',
      'Wenn Sie schon gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.', '', 'Mit freundlichen Grüßen', '{Absender}'].join('\n'),
  },
  en: {
    betreff: '{Stufe} for {Art} {Nummer} from {Absender}',
    text: ['Hello,', '', 'please find attached our {Stufe} for {Art} {Nummer} dated {Datum}.',
      'An amount of {Betrag} is outstanding. Please transfer it by {Frist}.', '{Zahlungshinweis}', '',
      'If you have already paid, please disregard this letter.', '', 'Kind regards', '{Absender}'].join('\n'),
  },
};

/** Der Satz zur Zahlung in der E-Mail. teilBetrag: „the outstanding amount of …“ oder „the amount“. */
export const ZAHLUNGSHINWEIS_EN = {
  frist: (betragTeil, datum) => `Please pay ${betragTeil} by ${datum}.`,
  ohneFrist: 'Please pay the amount without deduction.',
  offenerBetrag: (betrag) => `the outstanding amount of ${betrag}`,
  betrag: 'the amount',
  online: (link) => `You can also pay online: ${link}`,
};
