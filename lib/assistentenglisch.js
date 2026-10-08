/**
 * Kontovia – Assistent: Fragen auf Englisch verstehen.
 *
 * Die festen Regeln (assistentdeutung.js) kennen deutsche Wörter. Statt sie
 * zu verdoppeln, übersetzt dieses Modul eine englische Frage vor dem Deuten in
 * die Wörter, auf die die Regeln hören („last month“ → „letzten monat“,
 * „who owes me“ → „wer schuldet mir“). Die Übersetzung dient nur dem
 * Erkennen; Titel, Namen und Beschreibungen, die gespeichert werden, kommen
 * immer aus dem englischen Originaltext (anlegenEnglisch).
 *
 * zeitAusEnglisch ist auch für Zeitangaben gedacht, die ein Modell als Text an
 * ein Werkzeug gibt („last week“). Auf deutschen Text wirkt nichts davon.
 * Reine Logik, läuft in den Prüfungen (Thema assistent).
 */

const MONATE = { january: 'januar', february: 'februar', march: 'maerz', april: 'april', june: 'juni', july: 'juli', august: 'august', september: 'september', october: 'oktober', november: 'november', december: 'dezember' };
const MONAT_NR = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const MONATSNAMEN = Object.keys(MONAT_NR).join('|');
const TAGE = { monday: 'montag', tuesday: 'dienstag', wednesday: 'mittwoch', thursday: 'donnerstag', friday: 'freitag', saturday: 'samstag', sunday: 'sonntag' };
const TAGESNAMEN = Object.keys(TAGE).join('|');
const ZAHLEN = { one: 'ein', two: 'zwei', three: 'drei', four: 'vier', five: 'fuenf', six: 'sechs', seven: 'sieben', eight: 'acht', nine: 'neun', ten: 'zehn', eleven: 'elf', twelve: 'zwoelf', fourteen: 'vierzehn', twenty: 'zwanzig', thirty: 'dreissig', sixty: 'sechzig', ninety: 'neunzig' };
const ZAHLWORTE = Object.keys(ZAHLEN).join('|');
const EINHEIT = { day: 'tage', week: 'wochen', month: 'monate', year: 'jahre' };
const zahl = (w) => ZAHLEN[w] || w;
const zweistellig = (n) => String(n).padStart(2, '0');

/* Ein Datum: 2026-03-05, 5.3., 05.03.2026 (nach der Umwandlung von 5/3/2026 und „March 5th“). */
const DATUM = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)`;

/**
 * Zeitangaben aus englischem Text in die deutschen Wendungen von zeitraumLesen.
 * @param {string} text
 * @param {string[]} [spannen]  bekommt die gefundenen englischen Zeitangaben (zum Entfernen aus Titeln)
 * @returns {string}  kleingeschrieben
 */
export function zeitAusEnglisch(text, spannen = null) {
  // Satzzeichen weg (außer Punkt und Komma in Zahlen), sonst passt „last month?“ nicht auf „ last month “.
  let s = ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[?!;:]+/g, ' ').replace(/(?<!\d),|,(?!\d)/g, ' ').replace(/\.(?=\s|$)/g, ' ')} `;
  const regel = (re, ersatz) => {
    s = s.replace(re, (...m) => {
      const r = typeof ersatz === 'function' ? ersatz(...m) : ersatz.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
      if (spannen) spannen.push(m[0].trim());
      return ` ${r.trim()} `;
    }).replace(/ {2,}/g, ' ');
  };

  // Daten: 5/3/2026 (Tag/Monat), 5th of March 2026, March 5th, 2026
  regel(/ (\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\d)/g, (_, d, m, j) => `${d}.${m}.${j}`);
  regel(new RegExp(` (\\d{1,2})(?:st|nd|rd|th)?(?: of)? (${MONATSNAMEN})(?:,? (\\d{4}))?(?!\\d) `, 'g'), (_, d, m, j) => `${d}.${MONAT_NR[m]}.${j || ''}`);
  regel(new RegExp(` (${MONATSNAMEN}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?(?!\\d) `, 'g'), (_, m, d, j) => `${d}.${MONAT_NR[m]}.${j || ''}`);
  // Von … bis …
  regel(new RegExp(` (?:from |between )?(${DATUM}) (?:to|until|till|through|and|-|–) (${DATUM}) `, 'g'), 'von $1 bis $2');

  regel(/ the day before yesterday /g, 'vorgestern');
  regel(/ the day after tomorrow /g, 'uebermorgen');
  regel(/ yesterday /g, 'gestern');
  regel(/ (?:today|tonight|this morning|this afternoon|this evening) /g, 'heute');
  regel(/ tomorrow /g, 'morgen');

  // Die letzten / nächsten N Tage, Wochen, Monate, Jahre.
  regel(new RegExp(` (?:in |over |during )?(?:the )?(?:last|past|previous) (\\d+|${ZAHLWORTE}) (day|week|month|year)s? `, 'g'), (_, n, e) => `die letzten ${zahl(n)} ${EINHEIT[e]}`);
  regel(new RegExp(` (?:in |over |during )?(?:the )?(?:next|coming) (\\d+|${ZAHLWORTE}) (day|week|month|year)s? `, 'g'), (_, n, e) => `die naechsten ${zahl(n)} ${EINHEIT[e]}`);
  regel(new RegExp(` since (\\d+|${ZAHLWORTE}) (day|week|month)s? `, 'g'), (_, n, e) => `seit ${zahl(n)} ${EINHEIT[e]}`);

  // Woche, Monat, Quartal, Jahr.
  regel(/ (?:this|the current|current) week /g, 'diese woche');
  regel(/ (?:last|previous|past) week /g, 'letzte woche');
  regel(/ next week /g, 'naechste woche');
  regel(/ (?:this|the current|current) month /g, 'diesen monat');
  regel(/ (?:last|previous|past) month /g, 'letzten monat');
  regel(/ next month /g, 'naechsten monat');
  regel(/ (?:this|the current|current) quarter /g, 'dieses quartal');
  regel(/ (?:last|previous|past) quarter /g, 'letztes quartal');
  regel(/ next quarter /g, 'naechstes quartal');
  regel(/ (first|1st|second|2nd|third|3rd|fourth|4th) quarter /g, (_, q) => `${{ first: 'erstes', '1st': 'erstes', second: 'zweites', '2nd': 'zweites', third: 'drittes', '3rd': 'drittes', fourth: 'viertes', '4th': 'viertes' }[q]} quartal`);
  regel(/ (?:this|the current|current) year /g, 'dieses jahr');
  regel(/ (?:last|previous|past) year /g, 'letztes jahr');
  regel(/ next year /g, 'naechstes jahr');
  regel(/ (?:year to date|year-to-date|ytd|so far this year|year so far|since the start of the year|since the beginning of the year) /g, 'seit jahresbeginn');
  regel(/ (?:all time|overall|in total|altogether|ever|to date|since the beginning|in all|entire record|whole record|everything) /g, 'insgesamt');

  // Jahreszeiten, Wochentage, Monate.
  regel(/ (?:in |during )?(?:the )?(last |previous )?summer /g, (_, l) => `${l ? 'letzten ' : 'im '}sommer`);
  regel(/ (?:in |during )?(?:the )?(last |previous )?winter /g, (_, l) => `${l ? 'letzten ' : 'im '}winter`);
  regel(/ (?:in |during )?(?:the )?(last |previous )?spring /g, (_, l) => `${l ? 'letzten ' : 'im '}fruehling`);
  regel(/ (?:in |during )?(?:the )?(last |previous )?(?:autumn|fall) /g, (_, l) => `${l ? 'letzten ' : 'im '}herbst`);
  regel(new RegExp(` (?:on )?(last|previous|next|this|on)? ?(${TAGESNAMEN}) `, 'g'), (_, v, t) => `${v === 'last' || v === 'previous' ? 'letzten' : v === 'next' ? 'naechsten' : 'am'} ${TAGE[t]}`);
  regel(new RegExp(` since (${MONATSNAMEN}) `, 'g'), (_, m) => `seit ${MONATE[m] || 'mai'}`);
  regel(new RegExp(` (in|for|during|of|from|until|to|last|next|this) (${MONATSNAMEN})(?= |,|\\.)`, 'g'), (_, v, m) => `${v === 'last' || v === 'next' || v === 'this' ? 'in' : v} ${MONATE[m] || 'mai'}`);
  regel(new RegExp(` (${Object.keys(MONATE).join('|')}) `, 'g'), (_, m) => MONATE[m]);
  regel(/ (sept|oct|dec)(?= \d{4} | \d{2} | $)/g, (_, m) => ({ sept: 'sep', oct: 'okt', dec: 'dez' }[m]));
  regel(/ (?:for|during) (20\d{2}|19\d{2}) /g, 'fuer $1');
  return s.replace(/\s+/g, ' ').trim();
}

/* Wörter, die nach der Übersetzung nichts mehr zu sagen haben. */
const WEG = new Set(('a the to about regarding concerning anything something any some there that these those just also really very would should could might shall will '
  + 'can may must been being were am it its your yours his her their them then if but by into over under please kindly actually basically maybe perhaps '
  + 'again still yet already').split(' '));

/* [Muster, deutsche Wörter]; Reihenfolge zählt (Längeres zuerst). Alles kleingeschrieben, mit Wortgrenzen. */
const WOERTER = [
  [/\b(?:was|were)\b/g, 'war'],   // zuerst: andere Regeln erzeugen das deutsche „was“
  [/^ ?(?:please )?(?:could you |can you |would you )?(?:open|go to|take me to|navigate to|switch to|jump to|bring me to)\b/g, ' oeffne'],
  [/\b(?:euros?|eur)\b/g, '€'],
  [/\bhow (?:is|are|'s) (?:my |the |our )?(?:business|company|numbers|figures|finances|things)(?: doing| going| looking)?\b/g, 'wie laeuft geschaeft'],
  [/\bhow am i doing\b/g, 'wie stehe ich'], [/\bhow much (net|gross)\b/g, 'wie viel ist $1'],
  [/\badd\b/g, 'hinzufuegen'], [/\bset up\b/g, 'einrichten'], [/\bset\b/g, 'einstellen'], [/\bupload\b/g, 'hochladen'], [/\bchange\b/g, 'aendern'],
  [/\b(?:delete|remove)\b/g, 'loeschen'], [/\b(?:create|make)\b/g, 'erstellen'], [/\bprint\b/g, 'drucken'], [/\bsend(?! (?:an? |the )?(?:payment )?reminder)\b/g, 'senden'], [/\bedit\b/g, 'bearbeiten'],
  // Zusammenziehungen
  [/\bi'?ve\b/g, 'ich habe'], [/\bi'?m\b/g, 'ich bin'], [/\bwhat'?s\b/g, 'was ist'], [/\b(?:it|that|there|here)'?s\b/g, 'ist'],
  [/\b(?:don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|haven'?t|hasn'?t|can'?t|cannot|won'?t)\b/g, 'nicht'],
  // Gruß und Fähigkeiten
  [/\b(?:what can you do|what are you able to do|what do you do|how can you help(?: me)?|what are you)\b/g, 'was kannst du'],
  [/\bwho are you\b/g, 'wer bist du'], [/\b(?:hello|hi|hey)\b/g, 'hallo'], [/\b(?:thanks|thank you|thx|cheers)\b/g, 'danke'],
  // Heute und Tagesüberblick
  [/\b(?:what(?: is|'s)?|was ist) (?:on|up|due|next|happening)(?: for)? heute\b/g, 'was steht heute an'],
  [/\bwhat (?:do|should) i (?:do|need to do|have to do)(?: heute| next)?\b/g, 'was muss ich heute erledigen'],
  [/\b(?:daily )?(?:overview|briefing|summary)\b/g, 'ueberblick'],
  // Verdienen, Ausgeben
  [/\bhow much (?:money )?(?:did|do|have|has|will) (?:i|we) (?:earn|earned|make|made|take in|bring in|get|got)\b/g, 'wie viel habe ich verdient'],
  [/\bhow much (?:money )?(?:did|do|have|has) (?:i|we) (?:spend|spent|pay|paid)\b/g, 'wie viel habe ich ausgegeben'],
  [/\bhow much (?:money )?(?:do|did|have|has) (?:i|we) (?:have|got)(?: left)?\b/g, 'wie viel geld habe ich'],
  [/\bhow much (?:is|are|was|were)\b/g, 'wie viel ist'],
  [/\b(?:what|where) (?:did|do|does|have|has) (?:i|we|my money) (?:spend|spent|go|went)(?: (?:the )?most)?(?: on)?\b/g, 'wofuer ausgaben'],
  [/\b(?:where does (?:my )?money go|spent on|spending by category|by category|per category|breakdown)\b/g, 'wofuer ausgaben'],
  [/\b(?:earned|earn|earnings|made money|make money)\b/g, 'verdient'],
  [/\b(?:income|revenues?|turnover|sales|takings|incoming payments?)\b/g, 'einnahmen'],
  [/\b(?:profits?)\b/g, 'gewinn'], [/\b(?:loss|losses)\b/g, 'verlust'],
  [/\b(?:expenses?|expenditures?|spending|outgoings?|costs?)\b/g, 'ausgaben'],
  [/\b(?:spent|spend)\b/g, 'ausgegeben'],
  // Offene Posten
  [/\bwho owes me\b/g, 'wer schuldet mir'], [/\b(?:what|who) do i owe\b/g, 'was schulde ich'], [/\bi owe\b/g, 'schulde ich'],
  [/\b(?:owes? me|owing to me|owed to me)\b/g, 'schuldet mir'],
  [/\b(?:what|which|who) (?:do i have to|must i|should i) pay\b/g, 'was muss ich bezahlen'],
  [/\b(?:overdue|past due|late payments?|paying late|pay late|paid late|too late)\b/g, 'ueberfaellig'],
  [/\b(?:outstanding|unpaid|open|pending|owed|owing)\b/g, 'offen'],
  [/\b(?:receivables?|money owed to me)\b/g, 'forderungen'], [/\b(?:payables?|liabilities|bills to pay)\b/g, 'verbindlichkeiten'],
  [/\b(?:has|have) paid\b/g, 'hat bezahlt'], [/\bpaid (?:me|us)\b/g, 'hat bezahlt'], [/\bpaid\b/g, 'bezahlt'],
  [/\bmark(?:ed)? (?:it |this |the invoice )?(?:as )?paid\b/g, 'als bezahlt markieren'],
  // Mahnen
  [/\b(?:dunning letters?|dunning notices?|payment reminders?|dunning|reminder letters?)\b/g, 'mahnung'],
  [/\b(?:chase|dun|send a reminder to|send reminder to)\b/g, 'mahne'],
  // Steuern und Fristen
  [/\binput (?:vat|tax)\b/g, 'vorsteuer'], [/\b(?:vat|sales tax|value added tax|vat return|advance return|vat return)\b/g, 'umsatzsteuer'],
  [/\b(?:vat due|vat payable|vat liability|vat owed|vat balance)\b/g, 'zahllast'],
  [/\b(?:ready (?:for|to file)(?: the| my| our)? (?:tax(?:es)?|tax return)|tax ready|ready to file|ready for filing)\b/g, 'fertig fuer die steuer'],
  [/\b(?:tax return|income tax return)\b/g, 'steuererklaerung'], [/\b(?:deadlines?|due dates?|tax dates?|filing dates?)\b/g, 'fristen'],
  [/\b(?:profit and loss|p ?& ?l|income statement)\b/g, 'gewinn und verlust'],
  [/\b(?:depreciation|write-?offs?|amortization|amortisation)\b/g, 'abschreibung'],
  [/\b(?:fixed assets?|assets?)\b/g, 'anlagevermoegen'],
  [/\b(?:small business(?: owner| regulation| rule)?|small-business)\b/g, 'kleinunternehmer'], [/\b(?:turnover limit|revenue limit|threshold)\b/g, 'umsatzgrenze'],
  [/\b(?:what(?: is|'s)? missing|anything missing|is anything missing|what am i missing)\b/g, 'was fehlt'],
  [/\b(?:is everything|are all .{1,20}) (?:booked|complete|correct|in order)\b/g, 'ist alles in ordnung'],
  [/\b(?:check|review|audit) (?:my )?(?:books|bookkeeping|accounts|numbers|year)\b/g, 'pruefe meine buchhaltung'], [/\byear-?end\b/g, 'jahresabschluss'],
  // Kontostand, Belege, Verlauf
  [/\b(?:account balances?|bank balances?|balances?|how much is in (?:my )?(?:bank )?accounts?)\b/g, 'kontostand'],
  [/\bbank statements?\b/g, 'kontoauszug'],
  [/\b(?:without|missing|no|lacking|lack)(?: an?| the| any)? receipts?\b/g, 'ohne beleg'], [/\breceipts? (?:is |are )?(?:missing|lacking)\b/g, 'ohne beleg'], [/\breceipts?\b/g, 'beleg'],
  [/\b(?:per month|each month|every month|by month|month by month|month-by-month|monthly)\b/g, 'pro monat'],
  [/\b(?:trend|development|evolution|over time|progress)\b/g, 'verlauf'], [/\b(?:on average|average|avg)\b/g, 'durchschnitt'],
  [/\b(?:compared (?:to|with)|comparison|compare|versus|vs\.?|against)\b/g, 'vergleich'],
  [/\b(?:biggest|largest|greatest|highest|top)\b/g, 'groessten'], [/\b(?:best|most valuable)\b/g, 'besten'], [/\b(?:the )?most\b/g, 'meisten'],
  // Dinge
  [/\binvoices?\b/g, 'rechnung'], [/\b(?:customers?|clients?)\b/g, 'kunden'], [/\b(?:suppliers?|vendors?)\b/g, 'lieferanten'],
  [/\bcontacts?\b/g, 'kontakte'], [/\b(?:transactions?|bookings?|entries|postings?)\b/g, 'buchungen'], [/\bpayments?\b/g, 'zahlung'],
  [/\b(?:appointments?|meetings?)\b/g, 'termine'], [/\bcalendar\b/g, 'kalender'], [/\b(?:tasks?|to-?dos?|to do list)\b/g, 'aufgaben'],
  [/\bsettings?\b/g, 'einstellungen'], [/\bhelp\b/g, 'hilfe'], [/\breports?\b/g, 'auswertungen'], [/\b(?:overview|dashboard|home)\b/g, 'uebersicht'],
  [/\bproducts?\b/g, 'produkte'], [/\btemplates?\b/g, 'vorlagen'], [/\brecurring\b/g, 'wiederkehrend'], [/\bcategor(?:y|ies)\b/g, 'kategorien'],
  [/\b(?:bank|payment) accounts?\b/g, 'zahlungskonten'], [/\b(?:what is new|whats new|release notes|news)\b/g, 'neuigkeiten'],
  [/\b(?:gross|including vat|incl\.? vat|after tax)\b/g, 'brutto'], [/\b(?:net|excluding vat|excl\.? vat|before tax)\b/g, 'netto'],
  [/\blogo\b/g, 'logo'], [/\b(?:backup|back up)\b/g, 'sicherung'], [/\bpassword\b/g, 'passwort'], [/\bdrafts?\b/g, 'entwurf'],
  // Fragen und Befehle
  [/\b(?:show me|show|display|list|give me|let me see|tell me)\b/g, 'zeig mir'],
  [/\b(?:find|search for|look for|looking for|i can'?t find|i cannot find)\b/g, 'finde'],
  [/\bhow (?:do|can|would|should) i\b/g, 'wie kann ich'], [/\bhow (?:to|does)\b/g, 'wie funktioniert'],
  [/\bwhere (?:do|can|could) i (?:find|see|set|change|enter|put)\b/g, 'wo finde ich'], [/\bwhere (?:is|are)\b/g, 'wo ist'],
  [/\bwhat does (.{1,40}?) mean\b/g, 'was bedeutet $1'], [/\bwhat (?:is|are) an?\b/g, 'was ist eine'],
  [/\bhow (?:many|much)\b/g, 'wie viel'], [/\bwhat about\b/g, 'was ist mit'], [/\bhow about\b/g, 'wie ist es mit'],
  [/\bwhat\b/g, 'was'], [/\bwhich\b/g, 'welche'], [/\bwho\b/g, 'wer'], [/\bwhen\b/g, 'wann'], [/\bwhere\b/g, 'wo'], [/\bhow\b/g, 'wie'], [/\bwhy\b/g, 'warum'],
  // Kleine Wörter
  [/\bthis\b/g, 'diese'], [/\bhere\b/g, 'hier'], [/\b(?:current|opened|displayed)\b/g, 'aktuelle'],
  [/\b(?:is|are)\b/g, 'ist'], [/\b(?:do|does|did)\b/g, ''], [/\bhas\b/g, 'hat'], [/\bhave\b/g, 'habe'], [/\bhad\b/g, 'hatte'],
  [/\bi\b/g, 'ich'], [/\bme\b/g, 'mir'], [/\bmy\b/g, 'meine'], [/\bwe\b/g, 'wir'], [/\bour\b/g, 'unsere'], [/\byou\b/g, 'du'],
  [/\b(?:phone number|phone|telephone)\b/g, 'telefon'], [/\be-?mail(?: address)?\b/g, 'e-mail'], [/\baddress\b/g, 'adresse'],
  [/\bof\b/g, 'von'], [/\bfor\b/g, 'fuer'], [/\bwith\b/g, 'mit'], [/\bfrom\b/g, 'von'], [/\band\b/g, 'und'], [/\bor\b/g, 'oder'], [/\bthan\b/g, 'als'],
  [/\bper\b/g, 'pro'], [/\bnot\b/g, 'nicht'], [/\bwithout\b/g, 'ohne'], [/\bat\b/g, 'bei'],
];

/**
 * Eine englische Frage in die deutschen Wörter, auf die die festen Regeln hören.
 * @param {string} text
 * @returns {string}
 */
export function frageAusEnglisch(text) {
  let s = ` ${zeitAusEnglisch(text)} `;
  for (const [re, de] of WOERTER) s = s.replace(re, ` ${de} `);
  return s.split(/\s+/).filter((w) => w && !WEG.has(w)).join(' ');
}

/* ------------------------------------------------------------------------ */
/* Anlegen aus einem englischen Satz                                         */
/* ------------------------------------------------------------------------ */

const groß = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const saubern = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').trim();

/** Zeitangaben und Uhrzeit aus einem Titel nehmen. */
function ohneZeitangaben(s) {
  const spannen = [];
  zeitAusEnglisch(s, spannen);
  let r = s;
  for (const p of spannen) r = r.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ');
  return r.replace(/\b(?:at|around|by|from|@)?\s*\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.|o'?clock)\b/gi, ' ').replace(/\b(?:at|around|by|@)\s*\d{1,2}:\d{2}\b/gi, ' ');
}

/**
 * Anlegen („Remind me tomorrow to call the tax adviser“, „New appointment Friday at 3pm: Studio Nord“,
 * „I spent €49.90 on fuel yesterday“, „New customer Weber GmbH, mail@example.org“, „Create an invoice for
 * Müller Bau, €1,200 for website“). Gibt wie `deuten` ein Werkzeug mit Angaben zurück, sonst null.
 * @param {string} roh  der englische Originaltext
 * @param {{heute:string, kontakt?:{name:string}|null, zeitraum:Function, betrag:Function, uhrzeit:Function}} k
 */
export function anlegenEnglisch(roh, { heute, kontakt = null, zeitraum, betrag, uhrzeit }) {
  const text = roh.trim().replace(/[.!]+$/, '');
  const z = zeitraum(text);
  const istFrage = /\?\s*$/.test(roh) || /^(?:what|how|when|where|who|which|why|is|are|do|does|did|can|could|have|has|show|list)\b/i.test(text);
  let m;

  // Aufgabe
  m = /^(?:please )?(?:remind me(?:\s+(?:to|about|of)\b)?|new task:?|add (?:a )?task:?|create (?:a )?task:?|task:|to-?do:?|note(?: down)?:?|remember to|don'?t let me forget(?: to)?)\s*(.+)$/i.exec(text);
  if (m && !istFrage) {
    const titel = saubern(ohneZeitangaben(m[1]).replace(/^\s*(?:to|that i|about|of)\s+/i, '').replace(/\s+(?:to|on|by|for)\s*$/i, '').replace(/^\s*(?:to|that i|about)\s+/i, ''));
    return { werkzeug: 'aufgabe_vorschlagen', argumente: { titel: titel ? groß(titel) : text, faellig: z?.von || '' }, sicher: true };
  }

  // Termin
  m = /^(?:please )?(?:new (?:appointment|meeting|event)|(?:add|create|book|schedule|set up|plan)(?: an?| the)? (?:appointment|meeting|event)?(?: in| to)?(?: my| the)?(?: calendar)?)\b[:\s,-]*(.*)$/i.exec(text);
  if (m && !istFrage && /\b(?:appointment|meeting|event|calendar|schedule)\b/i.test(text)) {
    const ohneDatum = ohneZeitangaben(m[1] || text);
    const titel = saubern(ohneDatum.replace(/^\s*(?:with|for|about|called|named)\s+(?=\S)/i, (v) => (/^\s*with/i.test(v) ? 'with ' : '')).replace(/\s+(?:in|to|on)(?: my| the)? calendar\s*$/i, ''));
    const titelSchoen = !titel ? 'Appointment' : /^with\b/i.test(titel) ? `Appointment ${titel}` : groß(titel);
    return { werkzeug: 'termin_vorschlagen', argumente: { titel: titelSchoen, datum: z?.von || heute, uhrzeit: uhrzeit(text) }, sicher: true };
  }
  m = /^(?:put|add|enter)\s+(.+?)\s+(?:in|into|to|on)\s+(?:my |the )?calendar$/i.exec(text);
  if (m && !istFrage) {
    return { werkzeug: 'termin_vorschlagen', argumente: { titel: groß(saubern(ohneZeitangaben(m[1]))) || 'Appointment', datum: z?.von || heute, uhrzeit: uhrzeit(text) }, sicher: true };
  }

  // Kontakt
  m = /^(?:new|add|create)(?: an?)? (customer|client|supplier|vendor|contact)\s*:?\s*(.*)$/i.exec(text);
  if (m && !istFrage) {
    const rest = m[2];
    const email = /[^\s<>]+@[^\s<>]+\.[a-z]{2,}/i.exec(rest)?.[0] || '';
    const telefon = /(\+?\d[\d\s/-]{6,}\d)/.exec(rest)?.[1] || '';
    const name = saubern(rest.replace(email, '').replace(telefon, '').replace(/[,;]+/g, ' ').replace(/\s+(?:with|e-?mail|phone|tel\.?)\s*$/i, ''));
    return { werkzeug: 'kontakt_vorschlagen', argumente: { name, email, telefon, art: /^(?:supplier|vendor)$/i.test(m[1]) ? 'lieferant' : 'kunde' }, sicher: !!name };
  }

  // Rechnung
  m = /^(?:please )?(?:new invoice|(?:create|write|make|draft|prepare|issue)(?: an?| the)? invoice|invoice)\b\s*(.*)$/i.exec(text);
  if (m && !istFrage) {
    const b = betrag(text);
    const kunde = kontakt?.name || /(?:^|\s)(?:to|for)\s+([^,]+?)(?:\s+(?:for|over|worth|of|at)\s|\s+[€$]|,|\s+\d|$)/i.exec(m[1])?.[1] || '';
    const leistung = saubern(m[1].replace(/^(?:to|for)\s+[^,]+?(?=\s+(?:for|over|worth|of|at)\s|\s+[€$]|,|\s+\d)/i, '').replace(/[€$]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|eur(?:os?)?)/gi, ' ').replace(/^\s*(?:for|over|worth|of|at)\s+/i, '').replace(/^\s*for\s+/i, ''));
    return { werkzeug: 'rechnung_vorschlagen', argumente: { kunde: saubern(kunde), positionen: b !== null ? [{ name: groß(leistung) || 'Service', menge: 1, preis: b / 100 }] : [] }, sicher: true };
  }

  // Buchung: „I spent €49.90 on fuel“, „New expense 12 € coffee“, „Received 500 € from Müller“
  const ausgabe = /^(?:i |we )?(?:spent|paid|bought|purchased|had to pay)\b/i.test(text) || /^(?:new |add (?:an? )?|book (?:an? )?|record (?:an? )?)expense\b/i.test(text);
  const einnahme = /^(?:i |we )?(?:received|earned|got paid|was paid|made|took in)\b/i.test(text) || /^(?:new |add (?:an? )?|book (?:an? )?|record (?:an? )?)(?:income|revenue)\b/i.test(text);
  if ((ausgabe || einnahme) && !istFrage && betrag(text) !== null) {
    const beschreibung = saubern(ohneZeitangaben(text)
      .replace(/^(?:i |we )?(?:spent|paid|bought|purchased|had to pay|received|earned|got paid|was paid|made|took in)\b/i, '')
      .replace(/^(?:new |add (?:an? )?|book (?:an? )?|record (?:an? )?)(?:expense|income|revenue)\b(?: of| for)?/i, '')
      .replace(/[€$]\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|eur(?:os?)?)\b|\b\d[\d.,]*\b/gi, ' ')
      .replace(/(?:^|\s)(?:on|for|at|from|to|the|a|an|of|in|with|about)(?=\s|$)/gi, ' '));
    return { werkzeug: 'buchung_vorschlagen', argumente: { typ: einnahme && !ausgabe ? 'einnahme' : 'ausgabe', betrag: betrag(text) / 100, beschreibung: groß(beschreibung), datum: z?.von || heute, kontakt: kontakt?.name || '' }, sicher: true };
  }
  return null;
}
