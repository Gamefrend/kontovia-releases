/**
 * Kontovia – Verfahrensdokumentation (GoBD) als neutrales Dokument (dokument.js).
 *
 * Bei einer Betriebsprüfung beschreibt der Betrieb, wie seine Buchführung
 * läuft. Diese Datei setzt die Beschreibung aus dem Bestand zusammen: Firma
 * und Steuerstatus (settings, steuerVerlauf), Benutzer und Rollen, Konten
 * und Kontenrahmen, Weg der Belege, Festschreibung und Journal, Sicherungen
 * und Cloud, Archiv und Fristen, Programmfassung. Dazu kommen die eigenen
 * Abläufe des Betriebs als Freitext (`settings.verfahrensdoku`, FELDER).
 *
 * Jede Aussage muss zum Verhalten des Programms passen; wer hier etwas
 * behauptet, sieht im Code nach (Belege: store.js, rollen.js, archiv.js,
 * kontoauszug.js, beleglesen.js, rechnungsaktionen.js, web/tresor.js,
 * web/cloud.js). Das Dokument ist eine Vorlage zum Ergänzen, keine
 * Rechtsberatung, und sagt das auch.
 *
 * Reine Logik ohne Oberfläche: Was nicht im Bestand steht (Fassung,
 * Speicherort, Cloud, Prüfung der Journal-Kette), reicht die Ansicht herein
 * (views/verfahrensdoku.js). Freitext der Nutzer wird nie übersetzt
 * (`woertlich`, dokument.js).
 */

import { fmtDate, int, money, todayISO } from './util.js';
import { ROLLEN, aktiveBenutzer } from './rollen.js';
import { fristen, jahresuebersicht, festgeschriebenBis } from './archiv.js';

/** Die Freitextfelder: Schlüssel in settings.verfahrensdoku, Überschrift, Frage als Hilfe zum Ausfüllen. */
export const FELDER = [
  { id: 'unternehmen', titel: 'Unternehmen und Zuständigkeiten', frage: 'Was macht der Betrieb? Wer ist für die Buchhaltung zuständig, wer hilft dabei (Mitarbeit, Steuerberatung)?' },
  { id: 'belege', titel: 'Belege: Eingang und Ablage', frage: 'Wie kommen Belege zu Ihnen (Post, E-Mail, Kassenbon), wer erfasst sie, wie schnell, und was geschieht danach mit dem Papier?' },
  { id: 'kasse', titel: 'Bargeld und Zahlungsverkehr', frage: 'Gibt es Bargeld, Kartenzahlung oder Zahlungsdienste? Wie oft holen Sie Kontoauszüge und wer zählt die Kasse?' },
  { id: 'sicherung', titel: 'Sicherung und Zugang', frage: 'Wo liegen Vollsicherungen und Jahresarchive, wie oft sichern Sie, und wer kennt das Passwort?' },
  { id: 'sonstiges', titel: 'Weitere Abläufe', frage: 'Was gehört sonst zu Ihrer Buchführung, etwa das Scannen von Papierbelegen, ein Fahrtenbuch oder andere Programme?' },
];

/** Höchstlänge eines Freitextes (Zeichen). */
export const MAX_TEXT = 4000;

/** Die gespeicherten Ergänzungen, bereinigt: nur bekannte Felder, Text gekürzt. */
export function ergaenzungen(settings = {}) {
  const v = settings?.verfahrensdoku && typeof settings.verfahrensdoku === 'object' ? settings.verfahrensdoku : {};
  const out = {};
  for (const f of FELDER) out[f.id] = String(v[f.id] ?? '').slice(0, MAX_TEXT);
  out.geaendertAm = typeof v.geaendertAm === 'string' ? v.geaendertAm : '';
  return out;
}

/** Wie viele Felder schon ausgefüllt sind. */
export function ausgefuellt(settings = {}) {
  const e = ergaenzungen(settings);
  return FELDER.filter((f) => e[f.id].trim()).length;
}

/* -------------------------------------------------------------------------- */
/* Bausteine                                                                   */
/* -------------------------------------------------------------------------- */

const h2 = (text, extra = {}) => ({ art: 'h2', text, ...extra });
const h3 = (text) => ({ art: 'h3', text });
const absatz = (inhalt, extra = {}) => ({ art: 'absatz', inhalt, ...extra });
const hinweis = (inhalt) => ({ art: 'hinweis', inhalt });
/** Zweispaltig ohne Kopf: Angabe und Wert. */
const angaben = (zeilen) => ({ art: 'tabelle', spalten: [{ breite: 58 }, {}], zeilen: zeilen.map(([a, w]) => ({ zellen: [{ inhalt: a, gedaempft: true }, w] })) });
const fehlt = 'nicht angegeben';
const oder = (v) => (String(v ?? '').trim() ? String(v).trim() : { inhalt: fehlt, gedaempft: true });

/** Freitext der Nutzer: Absätze an Leerzeilen, Zeilen mit Umbruch, nie übersetzt. */
function eigenerText(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => absatz(p.split('\n').map((z, i) => ({ t: z, woertlich: true, ...(i ? { umbruch: true } : {}) }))));
}

/** Der Abschnitt mit der Ergänzung des Betriebs, oder die Frage, die noch offen ist. */
function ergaenzung(e, id, { titel = true } = {}) {
  const f = FELDER.find((x) => x.id === id);
  const text = e[id];
  const kopf = titel ? [h3(f.titel)] : [];
  if (String(text || '').trim()) return [...kopf, ...eigenerText(text)];
  return [...kopf, hinweis([{ t: 'Noch zu ergänzen:', fett: true }, { t: ` ${f.frage}` }])];
}

const STEUERART = { regelbesteuerung: 'Regelbesteuerung', kleinunternehmer: 'Kleinunternehmer (§ 19 UStG)' };
const VERSTEUERUNG = { ist: 'nach Zahlungseingang (Ist-Versteuerung, § 20 UStG)', soll: 'nach Rechnungsdatum (Soll-Versteuerung)' };
const RHYTHMUS = { monatlich: 'monatlich', vierteljährlich: 'vierteljährlich', jährlich: 'jährlich' };
const KONTOART = { bank: 'Bankkonto', cash: 'Kasse (Bargeld)', zahlungsdienst: 'Zahlungsdienst', other: 'Sonstiges' };

function steuerart(e) {
  const art = STEUERART[e.taxMode] || STEUERART.regelbesteuerung;
  return e.taxMode !== 'kleinunternehmer' && e.vorsteuerAbzug === 'nein' ? `${art}, ohne Vorsteuerabzug` : art;
}
const versteuerung = (e) => (e.taxMode === 'kleinunternehmer' ? 'entfällt' : VERSTEUERUNG[e.accountingBasis] || VERSTEUERUNG.ist);
function voranmeldung(e) {
  if (e.taxMode === 'kleinunternehmer' || e.vorsteuerAbzug === 'nein') return 'entfällt';
  const r = RHYTHMUS[e.vatPeriod] || 'monatlich';
  return e.vatDeadline === 'dauerfrist' ? `${r}, mit Dauerfristverlängerung` : r;
}

const ibanEnde = (iban) => {
  const s = String(iban || '').replace(/\s+/g, '');
  return s.length > 4 ? `… ${s.slice(-4)}` : '';
};

/* -------------------------------------------------------------------------- */
/* Das Dokument                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Die Verfahrensdokumentation als Dokument für alsPdf/alsHtml.
 * @param {object} db
 * @param {{heute?:string, version?:string, storage?:object|null, cloud?:object|null, journal?:object|null}} [opts]
 *   storage: api.vault.storage() (Speicherort, Sicherungen), cloud: api.cloud.status(), journal: verifyAudit()
 */
export function verfahrensdokuPdf(db, { heute = todayISO(), version = '', storage = null, cloud = null, journal = null } = {}) {
  const s = db.settings || {};
  const e = ergaenzungen(s);
  const firma = s.companyName || s.ownerName || 'der Betrieb';
  const skr = s.chartOfAccounts === 'SKR04' ? 'SKR04' : 'SKR03';
  const bloecke = [];

  bloecke.push(hinweis([
    { t: 'Eine Vorlage zum Prüfen und Ergänzen.', fett: true },
    { t: ' Diese Beschreibung entsteht aus Ihren Einstellungen und Daten in Kontovia und sagt, wie das Programm arbeitet. Ergänzen Sie Ihre eigenen Abläufe, lassen Sie das Dokument bei Bedarf von Ihrer Steuerberatung durchsehen und erstellen Sie eine neue Fassung, wenn sich Abläufe oder Einstellungen ändern. Jede Fassung bewahren Sie auf. Das Dokument ist keine Rechtsberatung.' },
  ]));

  /* 1. Allgemeines ---------------------------------------------------------- */
  bloecke.push(h2('1. Zweck und Unternehmen'));
  bloecke.push(absatz(`Diese Verfahrensdokumentation beschreibt, wie ${firma} die Bücher mit dem Programm Kontovia führt: wie Belege ankommen und gebucht werden, wie Änderungen nachvollziehbar bleiben, wie die Daten gesichert und aufbewahrt werden.`));
  bloecke.push(...ergaenzung(e, 'unternehmen'));

  /* 2. Firma und Steuerstatus ---------------------------------------------- */
  const stand = { taxMode: s.taxMode, accountingBasis: s.accountingBasis, vatPeriod: s.vatPeriod, vatDeadline: s.vatDeadline, vorsteuerAbzug: s.vorsteuerAbzug };
  bloecke.push(h2('2. Firma und Steuerstatus', { zusammen: true }));
  bloecke.push(angaben([
    ['Firma', oder(s.companyName)],
    ['Inhaber', oder(s.ownerName)],
    ['Anschrift', oder([s.street, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))],
    ['Steuernummer', oder(s.taxNumber)],
    ['USt-IdNr.', oder(s.vatId)],
    ['Finanzamt', oder(s.taxOffice)],
    ['Beginn der Tätigkeit', s.taetigSeit ? fmtDate(s.taetigSeit) : { inhalt: fehlt, gedaempft: true }],
    ['Besteuerung heute', steuerart(stand)],
    ['Umsatzsteuer entsteht', versteuerung(stand)],
    ['Umsatzsteuer-Voranmeldung', voranmeldung(stand)],
    ['Gewinnermittlung', 'Einnahmen-Überschuss-Rechnung (§ 4 Abs. 3 EStG)'],
    ['Kontenrahmen', skr],
  ]));
  const verlauf = (Array.isArray(s.steuerVerlauf) ? s.steuerVerlauf.filter(Boolean) : [])
    .slice().sort((a, b) => String(a.ab || '').localeCompare(String(b.ab || '')));
  if (verlauf.length > 1) {
    bloecke.push(h3('Bisherige Stände der Besteuerung'));
    bloecke.push({
      art: 'tabelle',
      spalten: [{ titel: 'Gilt ab', breite: 28 }, { titel: 'Besteuerung' }, { titel: 'Umsatzsteuer entsteht' }, { titel: 'Voranmeldung' }],
      zeilen: verlauf.map((v) => ({ zellen: [v.ab ? fmtDate(v.ab) : 'von Anfang an', steuerart(v), versteuerung(v), voranmeldung(v)] })),
    });
    bloecke.push(absatz('Eine Änderung an Besteuerung, Versteuerung oder Voranmeldung gilt in Kontovia ab einem Tag. Frühere Zeiträume rechnen weiter mit dem, was damals galt.', { gedaempft: true }));
  } else {
    bloecke.push(absatz('Die steuerlichen Einstellungen gelten unverändert für alle Zeiträume. Ändert sich später etwas, gilt die Änderung ab einem Tag; frühere Zeiträume bleiben, wie sie waren.', { gedaempft: true }));
  }

  /* 3. Software ------------------------------------------------------------ */
  const sp = storage?.speicher;
  const ort = sp?.art === 'ordner' ? `in einem Ordner auf dem Gerät („${sp.name || ''}“)` : sp ? 'im Speicher des Browsers auf dem Gerät' : 'auf dem Gerät';
  bloecke.push(h2('3. Eingesetzte Software', { zusammen: true }));
  bloecke.push(angaben([
    ['Programm', 'Kontovia'],
    ['Fassung', version ? String(version) : { inhalt: fehlt, gedaempft: true }],
    ['Dokument erstellt am', fmtDate(heute)],
    ['Speicherort der Daten', ort],
    ['Schutz der Daten', 'verschlüsselt (AES-256-GCM, Schlüssel aus dem Passwort des Kontos)'],
  ]));
  bloecke.push(absatz('Kontovia läuft im Browser auf dem Gerät, auch ohne Internet; einen Server des Herstellers für die Buchhaltung gibt es nicht. Beträge, Umsatzsteuer, Anlage EÜR und Auswertungen rechnet das Programm nach festen Regeln. An Berechnungen und Buchungen wirkt keine künstliche Intelligenz mit. Ein freiwilliger Assistent läuft nur auf dem Gerät und macht höchstens Vorschläge, die im gewohnten Fenster geprüft und gespeichert werden.'));
  bloecke.push(absatz('Neue Fassungen installiert Kontovia erst nach Bestätigung, und nur, wenn jede Programmdatei ihre Prüfsumme hat. Was sich je Fassung geändert hat, steht in der Hilfe unter „Neuigkeiten“.'));

  /* 4. Benutzer und Rollen ------------------------------------------------- */
  const nutzer = (db.users || []).filter(Boolean).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  bloecke.push(h2('4. Benutzer und Rollen', { zusammen: true }));
  if (!nutzer.length) {
    bloecke.push(absatz('In diesem Konto sind keine Benutzer angelegt. Es arbeitet, wer das Passwort des Kontos kennt; das Änderungsjournal nennt dann keinen Namen.'));
  } else {
    bloecke.push({
      art: 'tabelle',
      spalten: [{ titel: 'Name' }, { titel: 'Rolle' }, { titel: 'PIN', breite: 18 }, { titel: 'Stand', breite: 30 }],
      zeilen: nutzer.map((u) => ({ zellen: [{ inhalt: [{ t: u.name || '', woertlich: true }] }, ROLLEN[u.rolle]?.name || ROLLEN.inhaber.name, u.pin ? 'ja' : 'nein', u.deaktiviert ? 'deaktiviert' : 'aktiv'] })),
    });
    bloecke.push(absatz(`Aktive Benutzer: ${int(aktiveBenutzer(db).length)}. Das Änderungsjournal vermerkt bei jeder Änderung den Namen des gewählten Benutzers.`));
  }
  bloecke.push({
    art: 'tabelle',
    spalten: [{ titel: 'Rolle', breite: 30 }, { titel: 'Was sie darf' }],
    zeilen: Object.values(ROLLEN).map((r) => ({ zellen: [r.name, r.text] })),
  });
  bloecke.push(hinweis('Rollen regeln, was jemand in Kontovia ändern kann. Sie sind keine Zugriffssperre: Wer das Passwort des Kontos kennt, kann alle Daten öffnen. Der Name im Journal ist der in Kontovia gewählte Benutzer, keine eigene Anmeldung. Wer getrennte Daten braucht, legt ein eigenes Konto an.'));

  /* 5. Konten und Kontenrahmen --------------------------------------------- */
  const konten = (db.accounts || []).filter(Boolean);
  const kategorien = (db.categories || []).filter((c) => c && c.active !== false);
  const sk = skr === 'SKR04' ? 'skr04' : 'skr03';
  bloecke.push(h2('5. Konten und Kontenrahmen', { zusammen: true }));
  bloecke.push({
    art: 'tabelle',
    spalten: [{ titel: 'Konto' }, { titel: 'Art' }, { titel: 'IBAN' }, { titel: 'Sachkonto' }, { titel: 'Anfangsbestand', rechts: true }, { titel: 'Stichtag' }],
    zeilen: konten.map((a) => ({
      ...(a.active === false ? { art: 'storno' } : {}),
      zellen: [a.name || '', KONTOART[a.kind] || KONTOART.other, ibanEnde(a.iban), a[sk] || '', money(a.openingBalance || 0), a.openingDate ? fmtDate(a.openingDate) : ''],
    })),
    leer: 'Keine Konten angelegt.',
  });
  bloecke.push(absatz(`Jede Buchung trägt ein Konto und eine Kategorie. Jede Kategorie ist einer Zeile der Anlage EÜR und je einem Sachkonto in SKR03 und SKR04 zugeordnet; gewählt ist ${skr}. Daraus entstehen Anlage EÜR, DATEV-Export und Summen- und Saldenliste. Durchgestrichene Konten sind nicht mehr in Gebrauch.`));
  bloecke.push(h3(`Kategorien (${int(kategorien.length)})`));
  bloecke.push({
    art: 'tabelle',
    spalten: [{ titel: 'Kategorie' }, { titel: 'Art', breite: 26 }, { titel: 'EÜR-Zeile', breite: 24, rechts: true }, { titel: 'Sachkonto', breite: 30, rechts: true }],
    zeilen: kategorien.slice().sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.name).localeCompare(String(b.name), 'de'))
      .map((c) => ({ zellen: [c.name || '', c.kind === 'income' ? 'Einnahme' : 'Ausgabe', c.euerLine != null && c.euerLine !== '' ? String(c.euerLine) : '', c[sk] || ''] })),
    leer: 'Keine Kategorien angelegt.',
  });

  /* 6. Belege und Buchungen ------------------------------------------------ */
  const tx = db.transactions || [];
  const ausgestellt = (db.invoices || []).filter((r) => r && r.richtung !== 'eingang' && r.status === 'ausgestellt').length;
  bloecke.push(h2('6. Vom Beleg zur Buchung', { neueSeite: true }));
  bloecke.push(angaben([
    ['Buchungen im Bestand', int(tx.length)],
    ['davon aus Kontoauszügen', int(tx.filter((t) => t.importHash).length)],
    ['Belegdateien', int((db.attachments || []).length)],
    ['Ausgestellte Rechnungen', int(ausgestellt)],
    ['Eingelesene Kontoauszüge', int((db.imports || []).length)],
  ]));
  bloecke.push(h3('Erfassen'));
  bloecke.push(absatz('Eine Buchung entsteht von Hand, aus einem Beleg, aus einem Kontoauszug, aus einer eigenen Rechnung oder aus der Datei eines anderen Programms. Sie trägt Rechnungs- und Zahlungsdatum, Betrag, Steuersatz, Kategorie und Konto, auf Wunsch Kontakt und Belege. Fällige wiederkehrende Buchungen legt Kontovia nicht still an, sondern bietet sie zum Anlegen an.'));
  bloecke.push(h3('Belege und „Beleg lesen“'));
  bloecke.push(absatz('Belege (PDF, Foto, E-Rechnung) hängen an der Buchung. Jede Belegdatei liegt unverändert und verschlüsselt im Programm, mit einer Prüfsumme (SHA-256). „Beleg lesen“ liest Betrag, Datum, Rechnungsnummer und Lieferant aus dem Text eines PDFs oder per Texterkennung auf dem Gerät; das Ergebnis ist nur ein Vorschlag und wird erst gespeichert, wenn der Nutzer ihn übernimmt.'));
  bloecke.push(h3('E-Rechnungen'));
  bloecke.push(absatz('XRechnung und ZUGFeRD werden unverändert aufbewahrt und lesbar angezeigt. Ihre Werte lassen sich in die Buchung übernehmen.'));
  bloecke.push(h3('Kontoauszüge'));
  bloecke.push(absatz('Kontoauszüge liest Kontovia aus Dateien (CSV, CAMT.053, MT940), die der Betrieb bei der Bank herunterlädt; einen Abruf bei der Bank gibt es nicht. Für jeden Umsatz schlägt Kontovia nach festen Regeln eine Zuordnung vor (offene Rechnung, eigene Regel, Kategorie aus früheren Buchungen); gebucht wird erst nach Bestätigung. Jede so entstandene Buchung trägt Dateiname, Zeitpunkt und einen Prüfwert, der doppelte Buchungen verhindert. Die Datei selbst bewahrt Kontovia nicht auf; den Auszug der Bank hebt der Betrieb auf.'));
  bloecke.push(h3('Eigene Rechnungen'));
  bloecke.push(absatz('Beim Ausstellen bekommt eine Rechnung ihre fortlaufende Nummer. PDF und XRechnung liegen danach unverändert mit Prüfsumme im Programm. Eine ausgestellte Rechnung lässt sich in der Oberfläche nicht mehr ändern, nur stornieren oder korrigieren.'));
  bloecke.push(...ergaenzung(e, 'belege'));
  bloecke.push(...ergaenzung(e, 'kasse'));

  /* 7. Änderungen, Festschreibung, Journal --------------------------------- */
  const log = db.auditLog || [];
  const geraete = new Set(log.map((x) => x.device || 'lokal')).size;
  const erster = log.reduce((a, x) => (x.ts && (!a || x.ts < a) ? x.ts : a), '');
  const bis = festgeschriebenBis(db);
  bloecke.push(h2('7. Änderungen, Festschreibung und Journal', { neueSeite: true }));
  bloecke.push(angaben([
    ['Festgeschrieben bis', bis ? fmtDate(bis) : 'noch nichts festgeschrieben'],
    ['Einträge im Änderungsjournal', int(log.length)],
    ['Geräte mit eigenen Einträgen', int(geraete)],
    ['Erster Eintrag', erster ? fmtDate(erster.slice(0, 10)) : { inhalt: fehlt, gedaempft: true }],
    ...(journal ? [['Prüfung der Kette beim Erstellen', journal.ok ? `unversehrt, ${int(journal.count)} Einträge geprüft` : `bricht bei Eintrag Nr. ${journal.seq}`]] : []),
  ]));
  bloecke.push(h3('Änderungsjournal'));
  bloecke.push(absatz('Jede fachliche Änderung an Buchungen, Rechnungen und Stammdaten, auch Stornieren und Löschen, erzeugt einen Eintrag im Änderungsjournal: Zeitpunkt, Gerät, Art der Änderung, betroffener Datensatz und eine kurze Beschreibung, bei geänderten Feldern auch die früheren Werte, mit angelegten Benutzern auch der Name. Die Einträge eines Geräts sind über Prüfsummen (SHA-256) verkettet; wird ein Eintrag nachträglich verändert, bricht die Kette nachweisbar. Die Kette lässt sich in den Einstellungen jederzeit prüfen. Das Journal wird nie gelöscht, auch nicht, wenn ein Jahr nach Ablauf der Frist gelöscht wird.'));
  bloecke.push(h3('Festschreibung'));
  bloecke.push(absatz('Abgeschlossene Zeiträume schreibt der Inhaber fest, in den Einstellungen oder nach der Umsatzsteuer-Voranmeldung. Danach lassen sich Buchungen im festgeschriebenen Zeitraum nicht mehr ändern oder löschen, nur stornieren, und nichts lässt sich hineindatieren; das gilt auch für Anlagegüter und Anfangsbestände. Belege lassen sich dort noch ergänzen, aber nicht mehr entfernen; außerhalb davon steht jedes Entfernen eines Belegs im Änderungsjournal. Eine offene Rechnung aus diesem Zeitraum darf noch bezahlt werden; dabei ändern sich nur Zahlungsdatum und Konto.'));
  bloecke.push(absatz('Kontovia bietet keine Funktion, eine Festschreibung aufzuheben. Wer einen älteren Stand zurückspielt (Sicherung, Cloud), ersetzt damit auch die Festschreibungen; das Zurückspielen steht im Änderungsjournal. Nach Ablauf der Aufbewahrungsfrist entfernt der Löschlauf ganze Jahre, auch festgeschriebene (Abschnitt 9).'));
  bloecke.push(h3('Storno statt Löschen'));
  bloecke.push(absatz('Ein Storno lässt die ursprüngliche Buchung stehen und fügt eine Gegenbuchung hinzu; beide zusammen ergeben null. Liegt das Original im festgeschriebenen Zeitraum, wirkt die Gegenbuchung im offenen. Original und Gegenbuchung lassen sich weder ändern noch löschen. Vor der Festschreibung lassen sich Buchungen ändern und löschen; auch das steht im Journal. Schreiben Sie deshalb Zeiträume zeitnah fest, etwa nach jeder Voranmeldung.'));
  bloecke.push(h3('Private Buchungen'));
  bloecke.push(absatz('Als privat gekennzeichnete Buchungen gehören nicht zum Betrieb. Sie fehlen in den Unterlagen für das Finanzamt und im Prüfungsordner. Das Jahresarchiv enthält sie, als privat gekennzeichnet, und das Änderungsjournal behält sie.'));

  /* 8. Sicherung und Cloud ------------------------------------------------- */
  const verbunden = !!cloud?.linked;
  const lokal = storage?.backups ? `${int(storage.backups.count)} vorhanden` : '';
  bloecke.push(h2('8. Datensicherung und Cloud', { zusammen: true }));
  bloecke.push(angaben([
    ['Automatische Sicherungen auf dem Gerät', ['beim Speichern höchstens alle 30 Minuten, die 25 neuesten bleiben', lokal].filter(Boolean).join('; ')],
    ['Vollsicherung', 'von Hand: eine Datei mit allen Buchungen, Belegen und dem ganzen Journal, verschlüsselt mit einem eigenen Passwort'],
    ['Cloud-Abgleich', verbunden ? 'verbunden' : 'nicht verbunden'],
    ...(verbunden ? [
      ['Abgleich', cloud.autoSync === false ? 'von Hand' : `automatisch alle ${int(cloud.autoSyncMinutes || 15)} Minuten`],
      ['Zuletzt abgeglichen', cloud.lastSyncAt ? fmtDate(String(cloud.lastSyncAt).slice(0, 10)) : { inhalt: fehlt, gedaempft: true }],
      ['Sicherungen in der Cloud', 'etwa einmal am Tag, die 30 neuesten bleiben'],
    ] : []),
  ]));
  bloecke.push(absatz('In die Cloud gehen nur bereits verschlüsselte Daten; der Schlüssel entsteht aus dem Passwort und verlässt das Gerät nicht. Die Cloud-Ablage liegt in der EU (Finnland und Niederlande). Ohne Passwort lässt sich nichts wiederherstellen, auch nicht durch den Hersteller. Vollsicherungen und Jahresarchive gehören an einen anderen Ort als das Arbeitsgerät.'));
  bloecke.push(...ergaenzung(e, 'sicherung'));

  /* 9. Archiv und Aufbewahrung --------------------------------------------- */
  const f = fristen(s);
  const jahre = jahresuebersicht(db, heute);
  bloecke.push(h2('9. Archiv und Aufbewahrung', { zusammen: true }));
  bloecke.push(absatz(`Aufbewahrungsfristen in Kontovia: Rechnungen hält Kontovia wie Buchungen ${f.buchhaltung} Jahre, Belege ${f.belege} Jahre (§ 147 AO). Die Frist beginnt mit dem Ende des Kalenderjahres. Längere Fristen lassen sich einstellen, kürzere nicht.`));
  bloecke.push({
    art: 'tabelle',
    spalten: [{ titel: 'Jahr', breite: 16 }, { titel: 'Buchungen', rechts: true }, { titel: 'Belege', rechts: true }, { titel: 'Festgeschrieben' }, { titel: 'Jahresarchiv' }, { titel: 'Frist bis' }],
    zeilen: jahre.map((j) => ({
      zellen: [String(j.jahr), int(j.buchungen), int(j.belege), j.festgeschrieben ? 'ja' : 'nein',
        j.archiv ? (j.status === 'geloescht' ? 'ja, Jahr gelöscht' : `ja, vom ${fmtDate(String(j.archiv.erstelltAm || '').slice(0, 10))}`) : 'nein',
        fmtDate(j.fristEnde)],
    })),
    leer: 'Noch keine Buchungen.',
  });
  bloecke.push(absatz('Je Jahr erstellt Kontovia auf Wunsch ein Jahresarchiv: eine ZIP-Datei mit jedem Datensatz, den Buchungen als Tabelle, den Unterlagen für das Finanzamt, den Berichten, allen Belegen und den Einträgen des Änderungsjournals, dazu eine Liste mit der Prüfsumme jeder Datei. Die Prüfsumme des Archivs bleibt im Programm und lässt sich jederzeit gegen die Datei prüfen. Das Archiv hat kein Passwort, damit es auch in vielen Jahren lesbar bleibt; es gehört an einen geschützten Ort. Ein Jahr lässt sich erst nach Ablauf der Frist und mit Archiv löschen, nur durch den Inhaber und nach zweifacher Bestätigung.'));

  /* 10. Datenzugriff bei einer Prüfung ------------------------------------- */
  bloecke.push(h2('10. Datenzugriff bei einer Betriebsprüfung', { zusammen: true }));
  bloecke.push(absatz('Für den Datenzugriff der Finanzverwaltung erstellt Kontovia unter Import & Export den Prüfungsordner (Datenträgerüberlassung): alle Daten in maschinell auswertbarer Form mit Beschreibungsdatei nach dem Beschreibungsstandard der Finanzverwaltung. Das Journal darin enthält alle Angaben, aus denen sich die Prüfsummen nachrechnen lassen. Dazu kommen Buchungsjournal, Belege und Berichte als PDF.'));

  /* 11. Weitere Abläufe und Freigabe --------------------------------------- */
  bloecke.push(h2('11. Weitere Abläufe', { zusammen: true }));
  bloecke.push(...ergaenzung(e, 'sonstiges', { titel: false }));
  bloecke.push(h2('Freigabe', { zusammen: true }));
  bloecke.push(absatz('Ich habe diese Beschreibung geprüft. Sie gibt die Abläufe des Betriebs wieder.'));
  bloecke.push({
    art: 'tabelle',
    spalten: [{ breite: 50 }, {}],
    zeilen: [['Name', ''], ['Ort, Datum', ''], ['Unterschrift', '']].map(([a, w]) => ({ zellen: [{ inhalt: a, gedaempft: true }, w] })),
  });

  const untertitel = `Buchführung mit Kontovia, Stand ${fmtDate(heute)}`;
  const fuss = e.geaendertAm ? `Ergänzungen zuletzt geändert am ${fmtDate(e.geaendertAm.slice(0, 10))}.` : '';
  return { titel: 'Verfahrensdokumentation', untertitel, firma: s, bloecke, fuss };
}
