/**
 * Kontovia – was in jeder Fassung neu ist, neueste zuerst.
 *
 * Die einzige Quelle für die Versionshinweise: Die Oberfläche zeigt sie unter
 * Hilfe → Neuigkeiten, und scripts/versionshinweise.js macht daraus den Text
 * für die Veröffentlichung auf GitHub, für update.json und für die Web-Fassung.
 * Für eine neue Fassung oben einen Eintrag mit der Version aus package.json
 * ergänzen – scripts/check.js prüft das.
 *
 * Geschrieben für die Menschen, die Kontovia benutzen: kurz, ohne Fachbegriffe
 * aus der Programmierung, ein Satz je Punkt.
 */

export const VERSIONEN = [
  {
    version: '1.13.0',
    datum: '2026-10-02',
    titel: 'Ruhigerer Neustart nach Updates, natürlichere Texte',
    punkte: [
      'Beim Aktualisieren sehen Sie jetzt Schritt für Schritt, was passiert und wann Kontovia von selbst zurückkommt.',
      'Der Fortschritt erscheint auch in der Taskleiste, und Windows meldet, dass Kontovia gleich wieder da ist.',
      'Die zweite Rückfrage vor dem Update entfällt, die Erklärung steht jetzt direkt am Knopf.',
      'Viele Texte in Hilfe, Dialogen und Hinweisen sind klarer und kürzer formuliert.',
    ],
  },
  {
    version: '1.12.0',
    datum: '2026-10-02',
    titel: 'Neuigkeiten im Programm und eine aufgeräumte Hilfe',
    punkte: [
      'Was neu ist, steht jetzt unter Hilfe → Neuigkeiten, für jede Version seit der ersten. Nach einem Update weist Kontovia einmal darauf hin.',
      'Hilfe und Einstellungen sind aufgeräumt: Anleitungen, die nur für den Hersteller gedacht waren, sind verschwunden. Die Datenschutzhinweise öffnen sich direkt im Programm.',
      'Wer beim ersten Start die Google-Anmeldung abbricht oder die Cloud auf einem Gerät trennt, lässt die anderen Geräte verbunden. Bisher musste dort Google Kalender neu verbunden werden.',
      'Das Änderungsjournal nennt jeden Vorgang in Worten, etwa „Buchung angelegt“.',
      'In schmalen Fenstern bleibt die Beschreibung in der Buchungsliste lesbar, und das Warten auf die Anmeldung bei Google Kalender lässt sich abbrechen.',
    ],
  },
  {
    version: '1.11.1',
    datum: '2026-10-01',
    titel: 'Test-Update',
    punkte: [
      'Nur zum Ausprobieren der neuen Aktualisierung, sonst keine Änderungen.',
    ],
  },
  {
    version: '1.11.0',
    datum: '2026-10-01',
    titel: 'Aktualisieren ohne Umweg',
    punkte: [
      'Kontovia installiert neue Versionen selbst und startet danach von allein neu.',
      'Sie bleiben dabei angemeldet und müssen Ihr Passwort nicht erneut eingeben.',
      'Die Größenanzeige beim Herunterladen stimmt wieder.',
    ],
  },
  {
    version: '1.10.0',
    datum: '2026-10-01',
    titel: 'Alle Ihre Google-Kalender',
    punkte: [
      'Auf Wunsch gleicht Kontovia auch Ihren Hauptkalender und weitere Google-Kalender ab, in beide Richtungen.',
      'Web-Fassung: Anmeldung bei Google ohne Code, und sie lädt Ihre Buchhaltung jetzt auch aus der Cloud.',
      'Nach der Anmeldung im Browser kommt Kontovia von selbst wieder nach vorn.',
      'Wer die Cloud trennt, behält die Verbindung zu Google Kalender.',
    ],
  },
  {
    version: '1.9.1',
    datum: '2026-10-01',
    titel: 'Cloud auch in der Web-Fassung',
    punkte: [
      'Auf iPhone, iPad und Mac lässt sich Kontovia jetzt mit Google verbinden und mit Ihren anderen Geräten abgleichen.',
    ],
  },
  {
    version: '1.9.0',
    datum: '2026-10-01',
    titel: 'Mit Google anmelden, Sicherungen in der Cloud',
    punkte: [
      'Auf einem neuen Gerät: mit Google anmelden, Passwort eingeben, fertig. Ihre Buchhaltung ist da.',
      'Kontovia sichert täglich in der Cloud; jede Sicherung lässt sich wiederherstellen.',
      'Ist die Anmeldung bei Google abgelaufen, hilft der Knopf „Neu anmelden“.',
      'Mehrere Fehler beim Abgleich zwischen Geräten sind behoben.',
    ],
  },
  {
    version: '1.8.0',
    datum: '2026-09-30',
    titel: 'E-Rechnungen, wiederkehrende Buchungen, Steuertermine',
    punkte: [
      'E-Rechnungen (XRechnung, ZUGFeRD) erscheinen lesbar und lassen sich mit einem Klick übernehmen.',
      'Wiederkehrende Buchungen für Miete, Telefon oder Abos.',
      'Übersicht und Kalender zeigen die nächsten Steuertermine.',
      'Computer und Software lassen sich in einem Jahr abschreiben, neue Anschaffungen auch degressiv.',
      'Korrekturen am Änderungsjournal und an der Festschreibung.',
    ],
  },
  {
    version: '1.7.1',
    datum: '2026-09-29',
    titel: 'Korrekturen',
    punkte: [
      'Offene Rechnungen aus einem festgeschriebenen Zeitraum lassen sich noch als bezahlt vermerken.',
      'Beträge mit Tausenderpunkt wie „1.500“ werden richtig gelesen.',
      'Monatliche Termine am 31. landen in kurzen Monaten am Monatsende.',
      'Sperren ist sicherer, Filter bleiben erhalten, Termine und Aufgaben fragen vor dem Verwerfen.',
    ],
  },
  {
    version: '1.7.0',
    datum: '2026-09-29',
    titel: 'Aufgaben',
    punkte: [
      'Neue Aufgabenliste zum Abhaken, auf Wunsch zu einem Termin.',
      'Einnahmen und Ausgaben zählen in dem Monat, in dem das Geld fließt.',
      'Die Buchungsliste zeigt auch, was im Zeitraum bezahlt wurde.',
      'Sonderzeichen wie & oder " bleiben beim Speichern, wie sie sind.',
    ],
  },
  {
    version: '1.6.1',
    datum: '2026-09-28',
    titel: 'Dringende Korrektur',
    punkte: [
      'Unter Windows blieb das Fenster von Version 1.6.0 schwarz. Wer 1.6.0 hat, installiert 1.6.1 bitte einmal von Hand. Ihre Daten waren nicht betroffen.',
    ],
  },
  {
    version: '1.6.0',
    datum: '2026-09-26',
    titel: 'Stornos, Anlage EÜR und DATEV',
    punkte: [
      'Stornierte Buchungen zählen nicht mehr doppelt.',
      'Die Anlage EÜR folgt den amtlichen Vordrucken 2025 und 2026.',
      'DATEV-Export und Prüfungsordner lassen sich sauber einlesen.',
      'Hinweis, wenn Sie die Kleinunternehmergrenze überschreiten; schneller bei vielen Buchungen.',
    ],
  },
  {
    version: '1.5.0',
    datum: '2026-09-25',
    titel: 'Richtige Vergleiche, bessere Handy-Ansicht',
    punkte: [
      'Der Vergleich mit dem Vorjahr zählt bis zum gleichen Tag.',
      'Auf dem Handy erscheinen Buchungen als übersichtliche Karten.',
      'Ungespeicherte Einstellungen gehen beim Verlassen nicht mehr verloren.',
      'Kontovia warnt, wenn eine Kasse ins Minus rutscht.',
    ],
  },
  {
    version: '1.4.0',
    datum: '2026-09-25',
    titel: 'Sortieren überall',
    punkte: [
      'Jede Liste lässt sich nach jeder Spalte sortieren.',
      'Suche und Filter jetzt auch in Stammdaten, offenen Posten und im Änderungsjournal.',
    ],
  },
  {
    version: '1.3.0',
    datum: '2026-09-25',
    titel: 'Eigene Übersicht, einfachere Filter',
    punkte: [
      'Die Übersicht lässt sich frei anordnen; Bereiche blenden Sie ein und aus.',
      'Den Zeitraum wählen Sie mit einem Klick.',
      'Gefiltert wird direkt in den Spaltenköpfen.',
    ],
  },
  {
    version: '1.2.0',
    datum: '2026-09-24',
    titel: 'Diagramme, Google Kalender und die Web-Fassung',
    punkte: [
      'Diagramme lassen sich umschalten, dazu Durchschnittswerte.',
      'Termine gleichen sich mit Google Kalender ab.',
      'Buchungen lassen sich als „nicht gelistet“ kennzeichnen.',
      'Hell oder dunkel mit einem Klick. Neu ist Kontovia im Browser für iPhone, iPad und Mac.',
    ],
  },
  {
    version: '1.1.7',
    datum: '2026-09-19',
    titel: 'Wichtige Korrekturen bei Belegen und Abgleich',
    punkte: [
      'Angehängte Belege konnten verloren gehen. Das ist behoben, vorhandene Belege werden wiederhergestellt.',
      'Mehrere Fehler im Cloud-Abgleich sind behoben.',
    ],
  },
  {
    version: '1.1.6',
    datum: '2026-09-19',
    titel: 'Bessere Bedienung',
    punkte: [
      'Fenster fragen nach, bevor begonnene Eingaben verloren gehen.',
      'Vieles geht jetzt auch mit der Tastatur.',
      'Das Passwort lässt sich beim Eintippen anzeigen.',
    ],
  },
  {
    version: '1.1.5',
    datum: '2026-09-18',
    titel: 'Mehr Kontrolle',
    punkte: [
      'Beim Trennen der Cloud lassen sich Ihre Daten dort auch löschen.',
      'Ob Kontovia nach Updates sucht, entscheiden Sie selbst.',
      'Das Anlagenverzeichnis gibt es als eigenes PDF.',
    ],
  },
  {
    version: '1.1.4',
    datum: '2026-09-18',
    titel: 'Ort und Anzahlungen',
    punkte: [
      'Bei Einnahmen lässt sich der Ort festhalten und danach filtern.',
      'Anzahlungen mit Veranstaltungstermin; die Restzahlung legt Kontovia auf Wunsch gleich an.',
    ],
  },
  {
    version: '1.1.3',
    datum: '2026-09-07',
    titel: 'Hinweis auf neue Versionen',
    punkte: [
      'Auf Wunsch meldet sich Kontovia, sobald es eine neue Version gibt.',
    ],
  },
  {
    version: '1.1.2',
    datum: '2026-09-07',
    titel: 'Sicherheit',
    punkte: [
      'Exporte lassen sich gefahrlos in Excel öffnen.',
      'Festgeschriebene Zeiträume sind besser geschützt.',
      'Rechtliches und Datenschutz finden Sie unter Hilfe.',
    ],
  },
  {
    version: '1.1.1',
    datum: '2026-09-07',
    titel: 'Abgleich zwischen Geräten',
    punkte: [
      'Ihre Buchhaltung lässt sich zwischen mehreren Rechnern abgleichen.',
      'Updates installieren sich auf Knopfdruck.',
      'Einnahmen erscheinen grün, Ausgaben rot.',
    ],
  },
  {
    version: '1.1.0',
    datum: '2026-09-07',
    titel: 'Die erste Version',
    punkte: [
      'Einnahmen und Ausgaben samt Belegen, verschlüsselt auf Ihrem Rechner.',
      'Kalender, Auswertungen, Anlage EÜR und Umsatzsteuer.',
      'Export für ELSTER, DATEV und Betriebsprüfung.',
    ],
  },
];
