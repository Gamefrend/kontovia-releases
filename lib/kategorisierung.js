/**
 * Kontovia – Kategorien für Umsätze vorschlagen, ganz ohne Dienst im Netz.
 *
 * Alles läuft auf diesem Gerät mit festen, nachlesbaren Listen: Kein Text eines
 * Kontoauszugs verlässt den Browser, und es gibt kein Lernverfahren (gleiche
 * Eingabe, gleiche Ausgabe, COMPLIANCE.md Abschnitt 1). Zwei Quellen, in dieser
 * Reihenfolge:
 *
 *   1. Ihre eigene Geschichte: Wurde dieselbe Gegenseite schon einmal gebucht,
 *      gilt die Kategorie, die Sie dafür am häufigsten gewählt haben.
 *   2. Grobe Gruppen wie in Haushaltsbuch-Programmen (Lebensunterhalt,
 *      Abonnements, Unterhaltung, Mobilität, Wohnen …), erkannt an bekannten
 *      Händlernamen und Stichwörtern.
 *
 * Eine Gruppe ist nur eine Überschrift. Welche Kategorie daraus wird, hängt von
 * Ihrer Kategorienliste ab: Private Ausgaben (Supermarkt, Streaming, Kino,
 * Miete der Wohnung) werden als Privatentnahme vorgeschlagen, denn nur das ist
 * steuerlich ohne Risiko. Betriebliche Gruppen (Software, Telefon, Porto …)
 * landen in der passenden Betriebsausgabe. Gibt es zu einer Gruppe keine
 * passende Kategorie (weil sie gelöscht oder umbenannt wurde), gibt es auch
 * keinen Vorschlag.
 *
 * Ein Vorschlag wird nie von selbst gebucht: Er steht in der Prüfliste, der
 * Nutzer hakt ihn an (lib/zuordnung.js, Stufe „vorschlag“).
 */

import { norm } from './util.js';

/**
 * Welche Kategorie zu einem Ziel gehört, erkannt an Art, Merkmal oder Name.
 * Die Namen sind die der Startkategorien (src/web/seed.js); wer sie umbenannt
 * hat, bekommt für die Gruppe schlicht keinen Vorschlag.
 */
const ZIELE = {
  privat: { kind: 'expense', passt: (c) => !!c.private },
  software: { kind: 'expense', name: /software|lizenz|cloud/ },
  telefon: { kind: 'expense', name: /telefon|internet/ },
  versicherung: { kind: 'expense', name: /^versicherung/ },
  porto: { kind: 'expense', name: /porto|versand/ },
  werbung: { kind: 'expense', name: /werbung|marketing/ },
  bank: { kind: 'expense', name: /bankgebuehr|kontofuehrung/ },
  kfz: { kind: 'expense', name: /kfz.*laufend/ },
  reise: { kind: 'expense', name: /^reisekosten/ },
  fortbildung: { kind: 'expense', name: /fortbildung|fachliteratur/ },
  beratung: { kind: 'expense', name: /rechts.*steuerberatung/ },
  ustZahlung: { kind: 'expense', name: /finanzamt gezahlte umsatzsteuer/ },
  ustErstattung: { kind: 'income', name: /umsatzsteuer-erstattung/ },
  zinsen: { kind: 'income', name: /^zinsertraege/ },
  schuldzinsen: { kind: 'expense', name: /^schuldzinsen/ },
};

/**
 * Die Gruppen. `woerter` sind Händlernamen und Stichwörter (kleingeschrieben,
 * ohne Umlaute). Kurze Wörter (bis drei Buchstaben) müssen als ganzes Wort
 * dastehen, längere dürfen am Wortanfang stehen („rewe“ in „REWE Markt“).
 * Die Reihenfolge entscheidet: Was früher steht, gewinnt.
 */
const GRUPPEN = [
  {
    id: 'bank', name: 'Bankgebühren', richtung: 'aus', ziel: 'bank',
    woerter: ['kontofuehrung', 'kontoentgelt', 'kontogebuehr', 'entgelt kontoabschluss', 'abschlussentgelt', 'depotgebuehr', 'kartenentgelt', 'kreditkartengebuehr'],
  },
  { id: 'zinsen', name: 'Zinsen', richtung: 'ein', ziel: 'zinsen', woerter: ['habenzinsen', 'guthabenzinsen', 'zinsen guthaben', 'zinsgutschrift'] },
  { id: 'sollzinsen', name: 'Zinsen', richtung: 'aus', ziel: 'schuldzinsen', woerter: ['sollzinsen', 'dispozinsen', 'kreditzinsen', 'darlehenszinsen'] },
  { id: 'finanzamt-ein', name: 'Finanzamt', richtung: 'ein', ziel: 'ustErstattung', woerter: ['finanzamt'], zusatz: ['umsatzsteuer', 'ust', 'vorsteuer'] },
  { id: 'finanzamt-aus', name: 'Finanzamt', richtung: 'aus', ziel: 'ustZahlung', woerter: ['finanzamt'], zusatz: ['umsatzsteuer', 'ust', 'ust-va', 'ustva', 'vorauszahlung ust'] },
  {
    id: 'bargeld', name: 'Bargeld', richtung: 'aus', ziel: 'privat',
    woerter: ['geldautomat', 'bargeldauszahlung', 'bargeld', 'barauszahlung', 'atm'],
  },
  {
    id: 'software', name: 'Software und Cloud', richtung: 'aus', ziel: 'software',
    woerter: ['adobe', 'github', 'gitlab', 'notion ', 'slack ', 'zoom ', 'dropbox', 'openai', 'anthropic', 'amazon web services', 'aws', 'hetzner', 'ionos', 'strato', 'cloudflare', 'digitalocean', 'vercel', 'netlify', 'jetbrains', 'figma', 'canva', 'atlassian', 'google workspace', 'google cloud', 'microsoft 365', 'office 365', 'microsoft', 'lexoffice', 'lexware', 'sevdesk', 'datev', 'mailchimp', 'squarespace', 'wix', 'shopify', 'godaddy', 'namecheap', 'domainfactory', 'all-inkl', 'webgo', 'mittwald', '1password', 'bitwarden', 'zapier', 'airtable', 'trello', 'asana', 'miro ', 'sentry', 'firebase'],
  },
  {
    id: 'werbung', name: 'Werbung', richtung: 'aus', ziel: 'werbung',
    woerter: ['google ads', 'google adwords', 'facebook ads', 'meta platforms', 'facebook', 'instagram', 'linkedin', 'tiktok ads', 'xing', 'flyeralarm', 'vistaprint', 'wir-machen-druck', 'onlineprinters', 'saxoprint'],
  },
  {
    id: 'porto', name: 'Porto und Versand', richtung: 'aus', ziel: 'porto',
    woerter: ['deutsche post', 'dhl', 'dpd', 'hermes', 'ups', 'gls', 'fedex', 'postcard', 'internetmarke', 'packstation'],
  },
  {
    id: 'telefon', name: 'Telefon und Internet', richtung: 'aus', ziel: 'telefon',
    woerter: ['telekom', 'vodafone', 'o2', 'telefonica', '1und1', '1&1', 'congstar', 'freenet', 'mobilcom', 'drillisch', 'winsim', 'sim.de', 'klarmobil', 'otelo', 'pyur', 'unitymedia', 'm-net', 'netcologne', 'ewe tel', 'tele columbus', 'fonial', 'sipgate'],
  },
  {
    id: 'beratung', name: 'Beratung', richtung: 'aus', ziel: 'beratung',
    woerter: ['steuerberater', 'steuerberatung', 'rechtsanwalt', 'rechtsanwaelte', 'kanzlei', 'notar', 'buchhaltung'],
  },
  {
    id: 'fortbildung', name: 'Fortbildung', richtung: 'aus', ziel: 'fortbildung',
    woerter: ['udemy', 'coursera', 'skillshare', 'oreilly', "o'reilly", 'pluralsight', 'fachbuch', 'thalia', 'hugendubel', 'seminar', 'weiterbildung', 'fortbildung'],
  },
  {
    id: 'versicherung', name: 'Versicherungen', richtung: 'aus', ziel: 'versicherung',
    woerter: ['versicherung', 'allianz', 'huk', 'huk-coburg', 'ergo ', 'axa', 'debeka', 'signal iduna', 'generali', 'zurich', 'devk', 'gothaer', 'r+v', 'rv versicherung', 'concordia', 'nuernberger', 'barmenia', 'hdi', 'continentale', 'wuerttembergische', 'ruv', 'cosmosdirekt', 'check24 versicherung', 'haftpflicht', 'krankenkasse', 'techniker krankenkasse', 'aok', 'barmer', 'dak', 'ikk', 'kkh', 'hkk', 'bkk'],
  },
  {
    id: 'abonnements', name: 'Abonnements', richtung: 'aus', ziel: 'privat',
    woerter: ['netflix', 'spotify', 'disney', 'disneyplus', 'amazon prime', 'prime video', 'dazn', 'youtube premium', 'youtube', 'apple music', 'apple tv', 'itunes', 'icloud', 'apple.com/bill', 'audible', 'deezer', 'tidal', 'paramount', 'sky deutschland', 'rtl+', 'joyn', 'playstation plus', 'xbox game pass', 'nintendo', 'steam ', 'twitch', 'patreon', 'kindle unlimited', 'blinkist', 'headspace', 'tinder', 'bumble', 'strava', 'duolingo', 'zeit online', 'spiegel', 'faz', 'handelsblatt', 'sueddeutsche', 'bild plus'],
  },
  {
    id: 'unterhaltung', name: 'Unterhaltung', richtung: 'aus', ziel: 'privat',
    woerter: ['kino', 'cinemaxx', 'cinestar', 'uci', 'ticketmaster', 'eventim', 'reservix', 'konzert', 'theater', 'museum', 'zoo', 'freizeitpark', 'europa-park', 'heide park', 'bowling', 'fitnessstudio', 'fitness', 'mcfit', 'clever fit', 'john reed', 'urban sports', 'gym', 'sauna', 'therme', 'schwimmbad', 'spielothek', 'lotto', 'tipico', 'bet365'],
  },
  {
    id: 'gastronomie', name: 'Essen und Trinken außer Haus', richtung: 'aus', ziel: 'privat',
    woerter: ['restaurant', 'gasthof', 'gasthaus', 'trattoria', 'ristorante', 'pizzeria', 'imbiss', 'doener', 'kebab', 'sushi', 'bistro', 'cafe', 'kaffee', 'coffee', 'starbucks', 'espresso house', 'mcdonald', 'burger king', 'kfc', 'subway', 'nordsee', 'vapiano', 'lieferando', 'wolt', 'uber eats', 'ubereats', 'foodora', 'delivery hero', 'kneipe', 'biergarten', 'brauhaus'],
  },
  {
    id: 'mobilitaet', name: 'Mobilität', richtung: 'aus', ziel: 'kfz',
    woerter: ['aral ', 'shell ', 'esso ', 'jet tankstelle', 'agip', 'omv', 'tankstelle', 'tamoil', 'hem tank', 'star tankstelle', 'avia', 'sprint tank', 'adac', 'tuev', 'dekra', 'atu', 'parkhaus', 'parken', 'parkster', 'easypark', 'apcoa', 'q-park', 'sixt', 'europcar', 'hertz', 'share now', 'miles mobility', 'maut', 'toll collect', 'kfz-steuer', 'kfz steuer', 'zulassungsstelle'],
  },
  {
    id: 'reisen', name: 'Reisen und Bahn', richtung: 'aus', ziel: 'reise',
    woerter: ['deutsche bahn', 'db vertrieb', 'db fernverkehr', 'bahn.de', 'flixbus', 'flixtrain', 'lufthansa', 'eurowings', 'ryanair', 'easyjet', 'condor', 'airline', 'booking.com', 'airbnb', 'hotel', 'hostel', 'expedia', 'trivago', 'bvg', 'mvv', 'hvv', 'rmv', 'vrr', 'kvb', 'uber ', 'bolt ', 'freenow', 'free now', 'taxi', 'tier mobility'],
  },
  {
    id: 'wohnen', name: 'Wohnen', richtung: 'aus', ziel: 'privat',
    woerter: ['miete', 'mietzahlung', 'vermieter', 'hausverwaltung', 'wohnungsbau', 'wohnungsgesellschaft', 'vonovia', 'stadtwerke', 'vattenfall', 'e.on', 'eon energie', 'enbw', 'rwe', 'eprimo', 'naturstrom', 'lichtblick', 'tibber', 'strom', 'erdgas', 'fernwaerme', 'wasserversorgung', 'abfallwirtschaft', 'muellabfuhr', 'grundsteuer', 'rundfunk', 'beitragsservice', 'ard zdf', 'ikea', 'hornbach', 'bauhaus', 'obi', 'toom', 'globus baumarkt', 'hagebau'],
  },
  {
    id: 'lebensunterhalt', name: 'Lebensunterhalt', richtung: 'aus', ziel: 'privat',
    woerter: ['rewe', 'edeka', 'aldi', 'lidl', 'penny ', 'netto ', 'kaufland', 'norma', 'tegut', 'denns', "denn's", 'alnatura', 'biocompany', 'basic bio', 'globus', 'marktkauf', 'famila', 'nahkauf', 'hit markt', 'edeka center', 'e center', 'e-center', 'supermarkt', 'lebensmittel', 'getraenke', 'baeckerei', 'baecker', 'metzgerei', 'fleischerei', 'wochenmarkt', 'dm drogerie', 'dm-drogerie', 'dm', 'rossmann', 'mueller drogerie', 'budni', 'apotheke', 'apotheken', 'shop apotheke', 'docmorris', 'friseur', 'barber', 'zalando', 'c&a', 'primark', 'zara', 'tk maxx', 'about you', 'decathlon', 'kik', 'tedi', 'flying tiger'],
  },
];

const sauber = (s) => ` ${norm(s).replace(/[^a-z0-9&+.'/\-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

const MUSTER = new Map();
/** Regex für ein Stichwort: kurze Wörter ganz, längere am Wortanfang. */
function musterVon(wort) {
  let m = MUSTER.get(wort);
  if (m) return m;
  const w = norm(wort).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kurz = w.replace(/[^a-z0-9]/g, '').length <= 3 || /\s$/.test(wort);
  m = kurz ? new RegExp(`(?<![a-z0-9])${w.trim()}(?![a-z0-9])`) : new RegExp(`(?<![a-z0-9])${w}`);
  MUSTER.set(wort, m);
  return m;
}

/** Findet die Kategorie zu einem Ziel in der (aktiven) Kategorienliste des Nutzers. */
function kategorieZu(zielName, kategorien) {
  const ziel = ZIELE[zielName];
  if (!ziel) return null;
  for (const c of kategorien.values()) {
    if (c.active === false || c.kind !== ziel.kind) continue;
    if (ziel.passt ? ziel.passt(c) : ziel.name.test(norm(c.name))) return c;
  }
  return null;
}

/**
 * Erkennt die Gruppe eines Umsatzes. Erst zählt die Gegenseite allein (das ist
 * der Händlername), dann der ganze Text. Die Reihenfolge der Gruppen entscheidet.
 * @returns {{gruppe:object, wort:string, ausGegenseite:boolean}|null}
 */
export function gruppeErkennen(u) {
  const ein = u.betrag > 0;
  const gegen = sauber(u.gegenseite);
  const alles = sauber([u.gegenseite, u.zweck, u.buchungstext].filter(Boolean).join(' '));
  for (const nurGegenseite of [true, false]) {
    const text = nurGegenseite ? gegen : alles;
    if (text.trim().length < 2) continue;
    for (const g of GRUPPEN) {
      if (g.richtung === 'ein' && !ein) continue;
      if (g.richtung === 'aus' && ein) continue;
      if (g.zusatz && !g.zusatz.some((w) => musterVon(w).test(alles))) continue;
      for (const w of g.woerter) {
        if (musterVon(w).test(text)) return { gruppe: g, wort: w.trim(), ausGegenseite: nurGegenseite };
      }
    }
  }
  return null;
}

const nameSchluessel = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Baut aus dem Bestand die „Geschichte“ je Gegenseite: Welche Kategorie wurde
 * für denselben Namen am häufigsten gebucht (bei Gleichstand die zuletzt
 * gebuchte)? Nur lebende, nicht stornierte Buchungen mit Kategorie zählen.
 * @param {Array<object>} txs  Buchungen
 * @param {Map<string,object>} kontakte  Kontakte nach Id
 * @returns {Map<string, Map<string,{n:number, zuletzt:string}>>}
 */
export function geschichteAufbauen(txs, kontakte) {
  const out = new Map();
  for (const t of txs) {
    if (!t.categoryId || t.voided || t.isReversal) continue;
    const name = t.import?.gegenseite || (t.contactId ? kontakte.get(t.contactId)?.name : '') || '';
    const k = nameSchluessel(name);
    if (k.length < 3) continue;
    const art = t.type === 'income' ? 'ein' : 'aus';
    const key = `${art}|${k}`;
    if (!out.has(key)) out.set(key, new Map());
    const m = out.get(key);
    const e = m.get(t.categoryId) || { n: 0, zuletzt: '' };
    e.n++;
    const d = t.paidDate || t.date || '';
    if (d > e.zuletzt) e.zuletzt = d;
    m.set(t.categoryId, e);
  }
  return out;
}

/**
 * Schlägt für einen Umsatz eine Kategorie vor.
 *
 * @param {object} u  Umsatz aus lib/kontoauszug.js
 * @param {{kategorien:Map<string,object>, geschichte?:Map<string,Map<string,object>>}} ctx
 * @returns {{kategorieId:string, gruppe:string, grund:string, quelle:'geschichte'|'gruppe'}|null}
 */
export function kategorieVorschlagen(u, ctx) {
  const ein = u.betrag > 0;
  const kind = ein ? 'income' : 'expense';
  const kategorien = ctx.kategorien;

  // 1. Dieselbe Gegenseite wie früher
  const k = nameSchluessel(u.gegenseite);
  const frueher = k.length >= 3 ? ctx.geschichte?.get(`${ein ? 'ein' : 'aus'}|${k}`) : null;
  if (frueher) {
    const [id, e] = [...frueher.entries()]
      .filter(([cid]) => { const c = kategorien.get(cid); return c && c.active !== false && c.kind === kind; })
      .sort((a, b) => (b[1].n - a[1].n) || String(b[1].zuletzt).localeCompare(String(a[1].zuletzt)) || String(a[0]).localeCompare(String(b[0])))[0] || [];
    if (id) {
      return { kategorieId: id, gruppe: kategorien.get(id).name, quelle: 'geschichte', grund: `Wie bei Ihren früheren Buchungen mit „${u.gegenseite}“ (${e.n}-mal ${kategorien.get(id).name})` };
    }
  }

  // 2. Bekannte Händler und Stichwörter
  const treffer = gruppeErkennen(u);
  if (!treffer) return null;
  const kat = kategorieZu(treffer.gruppe.ziel, kategorien);
  if (!kat) return null;
  return {
    kategorieId: kat.id, gruppe: treffer.gruppe.name, quelle: 'gruppe',
    grund: `Erkannt als ${treffer.gruppe.name} („${treffer.wort}“); Vorschlag: ${kat.name}`,
  };
}

/** Die Namen aller Gruppen, für die Hilfe. */
export const GRUPPENNAMEN = [...new Set(GRUPPEN.map((g) => g.name))];
