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
    version: '2.30.1',
    datum: '2026-10-08',
    titel: 'Tarifseite kürzer und ruhiger',
    punkte: [
      'Die Seite mit den Tarifen ist kürzer geworden. Die Anmeldung öffnet sich in einem eigenen Fenster.',
      'Am Handy lässt sich die Seite nicht mehr zur Seite schieben, und Knöpfe bleiben nach dem Antippen nicht mehr eingefärbt.',
      'Die Vorschau der App ist übersichtlicher, Grafiken lassen sich nicht mehr markieren oder verschieben.',
      'Dezente Bewegung beim Scrollen.',
    ],
  },
  {
    version: '2.30.0',
    datum: '2026-10-08',
    titel: 'Englisch für Rechnungen und Assistent',
    punkte: [
      'Neu: Rechnungen, Mahnschreiben und E-Mails lassen sich auf Englisch schreiben. Die Sprache wählen Sie bei jeder Rechnung, für neue Rechnungen unter Rechnungen › Gestaltung.',
      'Der Assistent versteht jetzt auch englische Fragen und antwortet auf Englisch.',
      'Die Seite mit den Tarifen gibt es auf Englisch, mit Umschalter oben.',
      'Auf Englisch steht bei Prozenten und Mengen jetzt überall der Punkt als Dezimalzeichen.',
    ],
  },
  {
    version: '2.29.0',
    datum: '2026-10-08',
    titel: 'Kontovia auf Englisch',
    punkte: [
      'Neu: Kontovia gibt es jetzt auch auf Englisch. Umschalten unter Einstellungen › Darstellung oder unten auf dem Sperrbildschirm.',
      'Auf Englisch erscheinen Zahlen und Datum in englischer Schreibweise, Berichte als PDF ebenfalls auf Englisch.',
      'Eigene Texte wie Beschreibungen und Namen bleiben, wie Sie sie eingegeben haben. Rechnungen und Rechtstexte bleiben vorerst deutsch.',
    ],
  },
  {
    version: '2.28.2',
    datum: '2026-10-08',
    titel: 'Textcursor in Fenstern',
    punkte: [
      'Behoben: In manchen Fenstern, etwa bei der Sicherung, war der blinkende Textcursor nicht zu sehen.',
    ],
  },
  {
    version: '2.28.1',
    datum: '2026-10-08',
    titel: 'Neue Seite mit Tarifen',
    punkte: [
      'Neu: Eine eigene Seite stellt Kontovia vor und zeigt die geplanten Tarife Kostenlos, Standard, Pro und Max.',
      'Alles läuft noch im Testbetrieb. Tarife lassen sich noch nicht buchen, und es wird nichts abgerechnet.',
    ],
  },
  {
    version: '2.28.0',
    datum: '2026-10-08',
    titel: 'Der Assistent wird schneller und hilft mehr',
    punkte: [
      'Der Assistent antwortet spürbar schneller, weil er im Gespräch nichts doppelt liest. Bricht der Grafikchip ab, startet er bei der nächsten Frage neu.',
      'Neu: „Was steht heute an?“ zeigt Termine, fällige Aufgaben, Fristen und überfällige Rechnungen auf einen Blick.',
      'Fragen zur Bedienung wie „Wie schreibe ich eine Rechnung?“ beantwortet er aus der Hilfe.',
      '„Müller hat bezahlt“ trägt die Zahlung ein, „Mahne das Weingut“ bereitet die Mahnung vor. Gespeichert wird erst, wenn Sie bestätigen.',
      'Er versteht „diese Rechnung“, zeigt Verläufe Monat für Monat, prüft ein Jahr vor der Steuer und liest Anlage EÜR und Abschreibungen.',
    ],
  },
  {
    version: '2.27.0',
    datum: '2026-10-07',
    titel: 'Steuer genauer, Rückmeldungen geschützt',
    punkte: [
      'Wechseln Sie etwa von Kleinunternehmer zu Regelbesteuerung, fragt Kontovia, ab wann. Frühere Jahre bleiben, wie sie waren.',
      'Kunden außerhalb der EU, Bauleistungen an deutsche Firmen und Buchungen ohne Kategorie stehen in der Voranmeldung jetzt richtig. Ohne Kategorie fragt Kontovia vor der ELSTER-Datei nach.',
      'Neu: Skonto und ausgefallene Rechnungen ausbuchen, verkaufte Anlagegüter eintragen, Zahlungen um den Jahreswechsel richtig zuordnen.',
      'Mahnungen rechnen den Verzug erst ab der ersten Erinnerung und ziehen Gebühren von der Pauschale ab. Rechnungen an Privatkunden nennen die 30-Tage-Frist.',
      'Ihre Rückmeldungen und Bildschirmfotos können nur noch wir lesen, nicht andere Nutzer.',
    ],
  },
  {
    version: '2.26.0',
    datum: '2026-10-07',
    titel: 'Neuer Speicher für Ihre Buchhaltung',
    punkte: [
      'Ihre Buchhaltung liegt jetzt in einer verschlüsselten Datenbank auf dem Gerät. Gespeichert wird nur noch, was sich geändert hat; so bleibt auch ein großer Bestand flüssig.',
      'Beim ersten Öffnen werden Ihre Daten einmal übernommen und Eintrag für Eintrag geprüft. Der bisherige Stand bleibt als Sicherung erhalten.',
      'Die Cloud bekommt beim ersten Abgleich das neue Format. Die alte Datei geht erst, wenn die neue geprüft angekommen ist, und bleibt als Sicherung. Bitte bald auch die anderen Geräte aktualisieren.',
      'Das Änderungsjournal verliert keinen Eintrag mehr. Ältere Einträge liegen im Archiv und stehen in jeder Sicherung und in den Unterlagen fürs Finanzamt.',
      'Neu unter Einstellungen › Daten & Cloud: Sicherungen auf diesem Gerät ansehen und zurückholen.',
    ],
  },
  {
    version: '2.25.1',
    datum: '2026-10-07',
    titel: 'Mit Google entsperren: klarer und sicherer',
    punkte: [
      '„Mit Google entsperren“ schalten Sie jetzt unter Einstellungen › Daten & Cloud ein und aus, direkt bei der Verbindung zu Google.',
      'Dort steht deutlich, dass das ein großes Sicherheitsrisiko ist: Ihre Buchhaltung ist dann nur noch durch das Passwort Ihres Google-Kontos geschützt. Einschalten geht nur mit Bestätigung.',
      'Der Sperrbildschirm bietet „Mit Google entsperren“ nur noch dort an, wo es eingeschaltet ist. Geräte, die den Weg schon nutzen, behalten ihn.',
      'Behoben: Wer den Weg auf einem Gerät ausschaltete, bekam ihn von einem anderen Gerät unbemerkt wieder eingeschaltet.',
    ],
  },
  {
    version: '2.25.0',
    datum: '2026-10-06',
    titel: 'Hilfe, wenn der Assistent nur Basis anbietet',
    punkte: [
      'Gibt Ihr Browser den Grafikchip nicht frei, zeigt der Assistent Schritt für Schritt, wie Sie ihn in genau diesem Browser einschalten.',
      'Adressen und Einstellungen stehen in der Anleitung zum Kopieren bereit, denn umstellen können Sie sie nur selbst.',
      'Die Anleitung erscheint einmal von selbst. Danach finden Sie sie im Assistenten unter Stufe › Grafikchip freigeben und unter „So funktioniert der Assistent“.',
    ],
  },
  {
    version: '2.24.0',
    datum: '2026-10-06',
    titel: 'Umsatzsteuer und Fristen genauer',
    punkte: [
      'Ausfuhren in Länder außerhalb der EU haben beim Buchen einen eigenen Steuerfall und stehen in der Umsatzsteuer-Voranmeldung in der passenden Zeile.',
      'Behoben: Steuerfreie Rechnungen ins Ausland landeten in der Voranmeldung alle in derselben Zeile. Lieferungen in die EU, Ausfuhren und Leistungen, für die der Kunde die Steuer zahlt, stehen jetzt jeweils richtig.',
      'Die Fristen der Jahreserklärungen stimmen jetzt auch für die Jahre 2020 bis 2025, mit und ohne Steuerberatung.',
      'Rechnungen als Kleinunternehmer nennen die Steuerbefreiung so, wie es seit 2025 vorgeschrieben ist.',
      'Die Nutzungsbedingungen beschreiben jetzt auch den Assistenten, darum fragt Kontovia einmal neu nach Ihrer Zustimmung. Kleine Knöpfe und Verweise sind leichter zu treffen.',
    ],
  },
  {
    version: '2.23.1',
    datum: '2026-10-06',
    titel: 'Der Assistent versteht Rückfragen',
    punkte: [
      'Kurze Rückfragen wie „Und 2023?“ oder „Und im April?“ beantwortet der Assistent jetzt mit der Frage davor und dem neuen Zeitraum.',
      'Behoben: Nach „Neues Gespräch“ während einer laufenden Antwort konnte der Assistent nur noch Fehler melden. Er startet sich jetzt selbst neu.',
    ],
  },
  {
    version: '2.23.0',
    datum: '2026-10-06',
    titel: 'Der Assistent, der nur auf Ihrem Gerät rechnet',
    punkte: [
      'Neu: der Assistent. Fragen Sie in Ihren Worten nach offenen Rechnungen, Umsatz, Umsatzsteuer oder Terminen, oder lassen Sie Buchungen, Aufgaben und Termine vorbereiten. Öffnen mit Strg+J oder über die Seitenleiste.',
      'Alles bleibt auf Ihrem Gerät: Fragen und Buchhaltung werden nirgendwohin gesendet. Die Stufe Basis braucht keinen Download, größere Stufen laden ein Sprachmodell einmalig nach Ihrer Zustimmung.',
      'Zahlen rechnet immer Kontovia selbst. Unter jeder Antwort sehen Sie, was gesucht und gerechnet wurde. Gespeichert wird erst, wenn Sie im gewohnten Fenster bestätigen.',
      'Der Assistent ist noch in Erprobung und kann eine Frage falsch verstehen.',
    ],
  },
  {
    version: '2.22.1',
    datum: '2026-10-06',
    titel: 'Hinweis zur Testphase',
    punkte: [
      'Kontovia ist noch in Entwicklung. Ein Hinweis auf dem Startbildschirm und eine Leiste über jeder Ansicht erinnern daran, dass es für Ihre Daten noch keine Haftung und keine Gewährleistung gibt.',
      'Legen Sie bitte regelmäßig Sicherungen an und prüfen Sie Ergebnisse, bevor Sie sie verwenden.',
    ],
  },
  {
    version: '2.22.0',
    datum: '2026-10-06',
    titel: 'Schneller startklar, leichter zu bedienen',
    punkte: [
      'Kontovia startet schneller: Die einzelnen Bereiche werden erst geladen, wenn Sie sie öffnen.',
      'Besser mit Tastatur und Bildschirmleser bedienbar: Jedes Eingabefeld trägt seinen Namen, Überschriften sind sauber gegliedert, und kleine Links und Knöpfe sind leichter zu treffen.',
      'Das Buchungsfenster ist aufgeräumt: Beleg oben, zuletzt verwendete Kategorien zuerst, Kontakte nach Kunden und Lieferanten getrennt. Über „Neue Buchung“ legen Sie eine Buchung auch direkt aus einem Beleg an.',
      '„Von diesem Gerät entfernen“ finden Sie jetzt im Kontomenü oben links, und die Hilfe hat eine Suche.',
      'Im Kalender sind Termine in eigenen Farben und die Tage der Nachbarmonate besser lesbar.',
    ],
  },
  {
    version: '2.21.0',
    datum: '2026-10-06',
    titel: 'Import und Export an einem Ort, Kacheln schneller verschieben',
    punkte: [
      'Import und Export sind jetzt ein Bereich in der Seitenleiste, mit je einem Reiter.',
      'Halten Sie eine Kachel der Übersicht gedrückt, haben Sie sie sofort in der Hand und können sie an ihren neuen Platz ziehen. Das geht auch am Telefon.',
      'Einträge der Seitenleiste lassen sich nach kürzerem Halten verschieben.',
      'Bei Zielen in den Aufgaben steht in einer eigenen Zeile, wann Sie bei Ihrem bisherigen Tempo fertig sind oder wie viele Tage Sie in Verzug wären.',
    ],
  },
  {
    version: '2.20.0',
    datum: '2026-10-06',
    titel: 'Seitenleiste mit Knopf am Rand, Reiter mit Bewegung',
    punkte: [
      'Die Seitenleiste klappen Sie jetzt mit einem kleinen runden Knopf auf ihrer Kante ein und aus. Auch ein Klick auf die Kante selbst genügt.',
      'Beim Ein- und Ausklappen gleitet die Leiste weich auf ihre neue Breite.',
      'In der Auswertung, der Hilfe, den Rechnungen, den Aufgaben und überall sonst mit Reitern gleitet die Markierung zum gewählten Reiter.',
      'Auch die kleinen Umschalter, etwa für Einnahme und Ausgabe oder Hell und Dunkel, wechseln jetzt mit Bewegung.',
      'In den Einstellungen gleitet der Strich unter dem gewählten Bereich mit.',
    ],
  },
  {
    version: '2.19.1',
    datum: '2026-10-06',
    titel: 'Kleine Verbesserungen',
    punkte: [
      'Der Knopf zum Einklappen der Seitenleiste sitzt jetzt neben der Suche.',
      'Die Reiter in den Stammdaten wechseln mit einer gleitenden Markierung.',
      'Über den Reitern der Einstellungen scheint beim Scrollen nichts mehr durch.',
      'Die Zahlen in der Übersicht springen am Ende nicht mehr ein Stück nach unten.',
      'Die Belegquote passt jetzt auch in die kleine Kachel, und die Karten für Einnahmen und Ausgaben haben jeweils ihre eigene Höhe.',
    ],
  },
  {
    version: '2.19.0',
    datum: '2026-10-06',
    titel: 'Seitenleiste nach Ihrem Geschmack',
    punkte: [
      'Die Seitenleiste lässt sich einklappen: Dann bleiben nur die Symbole, und ein Klick klappt sie wieder aus.',
      'Bereiche lassen sich per Rechtsklick (am Telefon langes Drücken) aus- und einblenden und verschieben. Auch ziehen geht, wenn Sie einen Eintrag kurz halten.',
      'Die Einstellungen brauchen weniger Platz: Die Bereiche stehen jetzt als Reiter oben statt in einer breiten Spalte.',
      'In der Übersicht zeichnet sich beim Umschalten einer Diagrammart nur noch diese Karte neu. Einnahmen und Ausgaben zeigen weniger Text.',
      'Aufgaben mit Ziel zeigen den Stand als Zahl: eintippen und Enter drücken oder mit den Pfeilen ändern.',
    ],
  },
  {
    version: '2.18.0',
    datum: '2026-10-05',
    titel: 'Aufgeräumter: Aufgaben, Einstellungen und Menü am Telefon',
    punkte: [
      'Die Aufgaben sind übersichtlicher: Jede Gruppe hat ihre eigene Karte, und die Fälligkeit steht immer rechts.',
      'Die Einstellungen sind in vier Bereiche geteilt. Ein Punkt zeigt, wo noch etwas nicht übernommen ist.',
      'Am Telefon öffnet „Mehr“ jetzt ein Menü von unten statt von links. Ein Wisch nach unten schließt es.',
      'Kleine Bewegungen helfen beim Orientieren: Abgehakte Aufgaben gleiten aus der Liste, Bereiche blenden sanft ein.',
    ],
  },
  {
    version: '2.17.0',
    datum: '2026-10-05',
    titel: 'Ziele und wiederkehrende Aufgaben',
    punkte: [
      'Neue Art von Aufgabe: ein Ziel. Zum Beispiel 20 Seiten in 10 Tagen. Sie tragen ein, was Sie geschafft haben, und sehen, wie viel pro Tag noch nötig ist.',
      'Kontovia zeigt, ob Sie im Plan oder im Rückstand sind, und was bei Ihrem bisherigen Tempo am Ende herauskommt.',
      'Aufgaben können sich wiederholen, zum Beispiel jede Woche oder jeden Monat. Nach dem Abhaken kommt die nächste von selbst.',
    ],
  },
  {
    version: '2.16.1',
    datum: '2026-10-05',
    titel: 'Senden mit Gmail repariert',
    punkte: [
      'Senden mit Gmail klappt jetzt. Bisher kam nach der Anmeldung „Keine Verbindung zum Server“.',
    ],
  },
  {
    version: '2.16.0',
    datum: '2026-10-05',
    titel: 'Rechnungen direkt mit Gmail oder Outlook senden',
    punkte: [
      'Neu: Rechnungen direkt aus Kontovia senden, über Ihr Gmail- oder Outlook-Konto. Die E-Mail steht danach bei Ihnen unter „Gesendet“.',
      'Beim ersten Mal fragt Google oder Microsoft, ob Kontovia in Ihrem Namen senden darf. Lesen kann Kontovia Ihre E-Mails nicht.',
      'Die E-Mail für Ihr E-Mail-Programm landet jetzt gleich im Download-Ordner. Ein Klick darauf öffnet sie.',
    ],
  },
  {
    version: '2.15.0',
    datum: '2026-10-05',
    titel: 'Rechnungen per E-Mail senden',
    punkte: [
      'Neu: Rechnungen per E-Mail senden. Kontovia schreibt die E-Mail mit Text und PDF, abgeschickt wird sie mit Ihrem eigenen E-Mail-Programm.',
      'Am Rechner öffnet sich die fertige E-Mail in Outlook, Thunderbird oder Apple Mail. Am Handy geben Sie sie mit „Teilen“ an Ihre Mail-App.',
      'Den Text der E-Mail legen Sie einmal fest, Nummer, Betrag und Frist setzt Kontovia selbst ein.',
      'Auf dem Handy passt die Anmeldeseite wieder ganz auf den Bildschirm.',
    ],
  },
  {
    version: '2.14.0',
    datum: '2026-10-05',
    titel: 'Daten übernehmen und neue Dateien für ELSTER und Excel',
    punkte: [
      'Neu: Unter „Daten übernehmen“ holen Sie Buchungen, Kunden und Produkte aus Ihrem bisherigen Programm, von der Steuerkanzlei, aus Excel oder als Visitenkarten. Was schon da ist, wird nicht doppelt übernommen.',
      'Die Umsatzsteuer-Voranmeldung gibt es als Datei, die „Mein ELSTER“ direkt einliest. Umgekehrt liest Kontovia solche Dateien ein und zeigt, ob sie zu Ihren Buchungen passen.',
      'Neu im Export: eine Excel-Datei mit Buchungen und Auswertungen, Ihre Kontakte als Visitenkarten und die Zusammenfassende Meldung für Lieferungen ins EU-Ausland.',
      'Auf sehr kleinen Handys passt die Buchungsliste wieder ganz auf den Bildschirm.',
    ],
  },
  {
    version: '2.13.0',
    datum: '2026-10-05',
    titel: 'Jahresvergleich, Drucken und ein sicheres Verbinden',
    punkte: [
      'Neu: Unter Auswertungen vergleichen Sie Ausgaben oder Einnahmen über mehrere Jahre, je Kategorie und im Verlauf der Monate. Das laufende Jahr zählt nur bis zum gleichen Tag, damit es fair bleibt.',
      'Die Buchungsliste lässt sich drucken oder als PDF sichern, genau so, wie Sie sie gerade eingestellt haben.',
      'Ein weiteres Gerät verbinden: Kontovia meldet nicht mehr zu früh „fehlgeschlagen“. Ist das Gerät trotzdem verbunden, nehmen Sie es mit einem Klick in die Liste auf.',
      'Fingerabdruck oder Gesicht einrichten klappt auf mehr Geräten, und die Meldungen sagen jetzt, woran es liegt.',
      'Der leere Knopf unter „Feedback“ in der Seitenleiste ist weg.',
    ],
  },
  {
    version: '2.12.0',
    datum: '2026-10-05',
    titel: 'Zweites Gerät per QR-Code',
    punkte: [
      'Neu: Ein zweites Gerät, etwa Ihr Handy, öffnen Sie mit einem QR-Code. Er erscheint am ersten Gerät unter Einstellungen, am Handy scannen Sie ihn. Weder Google noch wir können Ihre Buchhaltung dabei lesen.',
      'Es braucht beides, Ihr Google-Konto und den QR-Code. Der Code gilt fünf Minuten und nur einmal, und das erste Gerät fragt nach, bevor das neue hineinkommt.',
      'Unter Einstellungen sehen Sie die Geräte, die Sie von diesem aus verbunden haben.',
      'Mit Google verbundene Geräte bestätigen alle 30 Tage von selbst, dass das Konto zugelassen ist. Ohne Internet passiert nichts. Entfernt wird Ihre Buchhaltung nie, ohne dass sie gesichert in der Cloud liegt.',
    ],
  },
  {
    version: '2.11.0',
    datum: '2026-10-05',
    titel: 'Benutzer, Rechtliches und richtige Zahlen',
    punkte: [
      'Die hochzählenden Zahlen auf der Übersicht enden jetzt auf dem richtigen Wert. Vorher liefen sie auf einen falschen zu und sprangen erst am Schluss um.',
      'Neu: Benutzer in einem Konto mit Rollen (alles, buchen, nur lesen). Das Änderungsjournal zeigt, wer etwas geändert hat. Konten auf dem Gerät lassen sich umbenennen und entfernen.',
      'Impressum, Nutzungsbedingungen und Datenschutz sind überall erreichbar, auch vor dem Entsperren. Den Nutzungsbedingungen stimmen Sie einmal zu. Beim Löschen der Cloud-Daten verschwindet auch Ihr Anmeldekonto dort.',
      'Mahnwesen: Sie wählen, ob der Kunde ein Unternehmen oder eine Privatperson ist. Die Pauschale von 40 € gibt es nur bei Unternehmen, und Kontovia warnt vor zu hohen Sätzen.',
      'Kontoauszug: Kontovia schlägt Kategorien vor (etwa Lebensunterhalt oder Software), nur auf Ihrem Gerät. Eilige buchen auch ohne Kategorie und ordnen später zu. Angekreuzt wird nichts von selbst.',
    ],
  },
  {
    version: '2.10.0',
    datum: '2026-10-05',
    titel: 'Mahnwesen, GiroCode und Kontoauszug einlesen',
    punkte: [
      'Neu: Mahnwesen. Überfällige Rechnungen bekommen mit einem Klick eine Zahlungserinnerung oder Mahnung als PDF, mit Frist, Gebühr und auf Wunsch einem Verzugsaufschlag.',
      'Rechnungen tragen jetzt einen GiroCode: Wer ihn mit der Banking-App scannt, hat die Überweisung schon ausgefüllt. Im Gestalter lässt er sich abschalten.',
      'Neu: Kontoauszug einlesen (CSV, CAMT.053 und MT940). Kontovia schlägt vor, welche Zahlung zu welcher Rechnung gehört; gebucht wird erst nach Ihrer Bestätigung.',
      'Ein schon eingelesener Umsatz wird nie doppelt gebucht, auch nicht bei einer Datei mit überlappendem Zeitraum.',
      'Mahngebühr und Verzugsaufschlag zählen als Einnahme ohne Umsatzsteuer und werden erst gebucht, wenn das Geld eingegangen ist.',
    ],
  },
  {
    version: '2.9.2',
    datum: '2026-10-05',
    titel: 'Rückmeldefenster überarbeitet',
    punkte: [
      'Das Rückmeldefenster ist aufgeräumter. Es sagt vor dem Senden deutlich, dass andere Nutzer Ihre Nachricht lesen können.',
      'Das Bild der Seite geht weiterhin nur mit, wenn Sie es selbst ankreuzen.',
    ],
  },
  {
    version: '2.9.1',
    datum: '2026-10-05',
    titel: 'Hinweis im Rückmeldefenster',
    punkte: [
      'Das Rückmeldefenster weist jetzt darauf hin, dass Ihre Nachricht nicht vertraulich ist.',
    ],
  },
  {
    version: '2.9.0',
    datum: '2026-10-05',
    titel: 'Neues dunkles Aussehen, Bewegung und Rückmeldungen an uns',
    punkte: [
      'Das dunkle Aussehen ist neu: ein warmes Graphit mit kräftigerem Akzent. Alle Farben sind auf gute Lesbarkeit geprüft.',
      'Seiten, Zahlen, Diagramme, Fenster und Meldungen bewegen sich jetzt weich. Wer Bewegung im System abgestellt hat, sieht davon nichts.',
      'Auf dem Handy bleibt die Leiste oben immer gleich groß. Zeitraum und Knöpfe der Seite scrollen einfach mit. Fenster lassen sich am Griff nach unten wegziehen.',
      'Mit „Feedback“ senden Sie Ihre Nachricht jetzt wirklich an uns. Ein Bild der Seite geht nur mit, wenn Sie es selbst ankreuzen. Nichts aus Ihrer Buchhaltung wird dabei übertragen.',
      'Kleine Fehler behoben: Knöpfe im Export liefen über den Rand, auf kleinen Fenstern waren Einstellungen zu eng, und im Rechnungsgestalter gibt es echte Pfeile für Rückgängig und Wiederholen.',
    ],
  },
  {
    version: '2.8.0',
    datum: '2026-10-05',
    titel: 'Mehrere Konten und Abmelden mit Abgleich',
    punkte: [
      'Auf einem Gerät können mehrere Konten angemeldet sein, etwa für zwei Betriebe. Ein Klick auf den Namen oben in der Seitenleiste wechselt das Konto oder fügt eines hinzu.',
      'Jedes Konto hat sein eigenes Passwort und bleibt von den anderen getrennt. Vor dem Wechsel gleicht Kontovia ab, wenn das Konto mit Google verbunden ist.',
      'Beim Abmelden gleicht Kontovia zuerst mit Google ab. Klappt das nicht, etwa ohne Netz, entscheiden Sie: noch einmal versuchen, abbrechen oder trotzdem abmelden.',
      'Das Eintippen von „ABMELDEN“ entfällt. Abmelden betrifft nur das offene Konto, die anderen bleiben erhalten.',
      'Auf dem Sperrbildschirm sehen Sie, zu welchem Konto das Passwort gehört, und wechseln dort bei Bedarf das Konto.',
    ],
  },
  {
    version: '2.7.0',
    datum: '2026-10-04',
    titel: 'Aufgaben mit Text, Bildern und Unteraufgaben',
    punkte: [
      'Aufgaben können jetzt formatierten Text mit Überschriften, Listen und Links enthalten, dazu Bilder (auch per Strg+V) und Unteraufgaben, die Sie schon in der Liste abhaken.',
      'Eine Aufgabe lässt sich mit Terminen, Buchungen, Kontakten und Rechnungen verknüpfen. Dort steht sie dann auch, und von dort legen Sie gleich eine neue an. Aufgaben mit Datum erscheinen im Kalender.',
      'Wie weit die Aufgabenliste vorausschaut, wählen Sie selbst: 7 Tage, 4 Wochen, 1 Monat oder einen eigenen Zeitraum. Die Zeile zum schnellen Anlegen ist weg, „Aufgabe“ oben rechts reicht.',
      'Neu: Mit Strg+K durchsuchen Sie alles auf einmal, also Buchungen, Rechnungen, Kontakte, Termine, Aufgaben und Einstellungen. Auf dem Handy öffnet das Suchsymbol oben die Suche.',
      'Buchungen, die nicht zum Betrieb gehören, heißen jetzt „privat“ statt „nicht gelistet“. An der Wirkung ändert sich nichts.',
    ],
  },
  {
    version: '2.6.0',
    datum: '2026-10-04',
    titel: 'Abmelden, Fingerabdruck und Rückmeldungen',
    punkte: [
      'Neben „Sperren“ gibt es jetzt „Abmelden“. Damit räumen Sie dieses Gerät auf und melden sich mit einem anderen Konto an. Kontovia gleicht vorher noch einmal ab.',
      'Auf dem Handy öffnen Sie Kontovia mit Fingerabdruck oder Gesicht. Wenn Sie es möchten, geht das Entsperren auch über Ihr Google-Konto. Das Passwort bleibt immer gültig. Einschalten unter Einstellungen, Sicherheit.',
      'Mit „Feedback“ in der Seitenleiste schreiben Sie uns, was Ihnen auffällt, auf Wunsch mit einem Bild der aktuellen Seite.',
      'Im Rechnungsgestalter schließt ein Klick neben ein Fenster nur dieses Fenster. Farben stellen Sie auch im Rechtsklick-Menü ein.',
      'Texte auf der Rechnung ändern Sie mit einem Doppelklick direkt auf der Vorschau. Bilder aus der Zwischenablage fügen Sie mit Strg+V ein.',
    ],
  },
  {
    version: '2.5.0',
    datum: '2026-10-04',
    titel: 'Rechnungen einfacher gestalten',
    punkte: [
      'Sie ändern die Rechnung jetzt direkt auf der Vorschau: Teil anklicken, und ein kleines Fenster zeigt Farbe, Größe, Texte und mehr. Ein Rechtsklick zeigt weitere Möglichkeiten.',
      'Die Tabelle wählen Sie mit Bildern aus: Farbfläche, Linien, Streifen oder Raster. Spalten und Überschriften klappen Sie bei Bedarf auf.',
      'Das Verschieben folgt der Maus jetzt genau. Tabelle und Texte ordnen Sie durch Ziehen nach oben oder unten.',
      'Egal wie Sie gestalten: Pflichtangaben und die Daten der E-Rechnung bleiben vollständig und lesbar. Teile, die sich überlappen würden, rücken von selbst zur Seite.',
      'Zu helle Farben dunkelt Kontovia in der Schrift ab, und Beträge werden nie abgeschnitten.',
    ],
  },
  {
    version: '2.4.1',
    datum: '2026-10-04',
    titel: 'Rechnungen frei gestalten',
    punkte: [
      'Im Gestalter verschieben Sie die Bausteine Ihrer Rechnung per Hand und fügen eigene Texte, Bilder, Flächen und Linien hinzu. Auch Briefpapier, Tabellenstil und Spalten lassen sich anpassen, ein Schritt zurück geht immer.',
      'Die Fälligkeit setzen Sie mit einem Klick auf „Sofort“, „+14 Tage“ oder „+30 Tage“. Fälligkeit und Zahlungsziel bleiben dabei im Gleichklang.',
      'Bilder können Sie für jede Rechnung einzeln wählen. Ein Hinweis erinnert Sie daran, Rechnungen zehn Jahre aufzubewahren.',
      'Bei Schlussrechnungen werden Anzahlungen samt Umsatzsteuer abgezogen. Gutschriften bucht Kontovia als Minusbetrag.',
      'Steuernummer, Anschrift und Register bleiben auf dem PDF, auch wenn Sie die Fußzeile ausschalten. Eine USt-IdNr. ohne Länderkürzel zeigt Kontovia jetzt als fehlende Angabe.',
    ],
  },
  {
    version: '2.4.0',
    datum: '2026-10-04',
    titel: 'Neu: Rechnungen schreiben',
    punkte: [
      'Im neuen Bereich „Rechnungen“ schreiben Sie E-Rechnungen, die den gesetzlichen Vorgaben entsprechen: als PDF mit eingebetteten Rechnungsdaten und als XRechnung für Behörden.',
      'Kunden und Positionen wählen Sie aus Kontakten und Produkten oder tragen sie frei ein, mit Einheiten wie Stunden, Tage oder Pauschale. Rechts sehen Sie die fertige Seite.',
      'Fehlende Pflichtangaben zeigt Kontovia als Liste. Speichern geht immer, ausstellen nach einer Rückfrage auch dann, wenn noch etwas fehlt.',
      'Logo, Farbe, Stil und ein Zusatzbild wie Ihre Unterschrift lassen sich frei wählen. Häufige Rechnungen speichern Sie als Vorlage.',
      'Beim Ausstellen entsteht die offene Einnahme von selbst. Erhaltene E-Rechnungen legen Sie unter „Eingang“ ab und buchen sie mit einem Klick.',
    ],
  },
  {
    version: '2.3.0',
    datum: '2026-10-04',
    titel: 'Neues, ruhigeres Aussehen',
    punkte: [
      'Kontovia sieht jetzt aufgeräumter und moderner aus: mehr Luft, feine Linien, große Zahlen und eine neue Schrift.',
      'Eine neue Buchung legen Sie jetzt mit einem einzigen Knopf oben links an. Ein Klick darauf lässt Sie zwischen Einnahme und Ausgabe wählen.',
      'In der Seitenleiste stehen die vier wichtigsten Bereiche oben, Auswertungen und Export darunter, Stammdaten, Einstellungen und Hilfe ganz unten.',
      'Am Telefon gibt es eine feste Leiste am unteren Rand mit Übersicht, Buchungen, Neue Buchung, Kalender und Mehr.',
      'In den Diagrammen sind Einnahmen blau und Ausgaben grau, damit man zuerst sieht, was hereinkommt.',
    ],
  },
  {
    version: '2.2.0',
    datum: '2026-10-04',
    titel: 'Besser am Telefon, Installieren auf Android, verlässlicherer Google Kalender',
    punkte: [
      'Auf Android lässt sich Kontovia jetzt mit einem Tipp als App installieren: Der Knopf „App installieren“ steht im Menü und auf dem Anmeldebildschirm.',
      'Am Telefon sind Fenster nicht mehr zu breit, die Kennzahlen stehen untereinander, und die Zeile mit Zeitraum und Neu-Knöpfen klappt beim Hinunterscrollen weg.',
      'Im Monatskalender zeigen kleine Striche die Termine. Gelesen werden sie in der Liste darunter.',
      'Google Kalender: Wo ein zweites Fenster nicht geht, etwa in der App auf dem iPhone, wechselt Kontovia kurz zu Google und kommt danach zurück. Blockiert der Browser das Fenster, fragt Kontovia vorher.',
    ],
  },
  {
    version: '2.1.0',
    datum: '2026-10-04',
    titel: 'Übersicht zum Anklicken, Zurück-Taste und PDF am Telefon',
    punkte: [
      'In der Übersicht führt jede Zahl zu den Buchungen oder Auswertungen dahinter, auch ein Monat im Verlauf oder eine Kategorie.',
      'Die Breite eines Moduls lässt sich jetzt auch auf drei Viertel stellen. So füllt es mit einem Viertel zusammen eine ganze Zeile.',
      'Die Zurück-Taste des Browsers geht jetzt einen Schritt in Kontovia zurück, schließt ein offenes Fenster oder bleibt in der Übersicht, statt die Seite zu verlassen.',
      'Auf Telefon und Tablet gibt es keinen Druckknopf mehr. PDF-Dateien werden gespeichert und nicht an einen Drucker geschickt.',
    ],
  },
  {
    version: '2.0.0',
    datum: '2026-10-03',
    titel: 'Kontovia gibt es jetzt nur noch im Browser',
    punkte: [
      'Kontovia läuft nur noch im Browser: auf dem Rechner genauso wie auf Telefon und Tablet, auch ohne Internet.',
      'In Chrome und Edge lässt es sich als eigene App mit Symbol installieren und die Buchhaltung in einem Ordner auf dem Gerät führen. Das ersetzt die Windows-Fassung und die Fassung ohne Installation.',
      'Was die Windows-Fassung konnte, gibt es auch hier: echte PDF-Dateien, Google Kalender, Sperre nach dem Ruhezustand und angemeldet bleiben nach einem Update.',
      'Buchhaltungen, Vollsicherungen und Cloud-Stände aus der Windows-Fassung lassen sich weiter öffnen.',
    ],
  },
  {
    version: '1.18.0',
    datum: '2026-10-03',
    titel: 'Kontovia zieht in den Browser um',
    punkte: [
      'Dies ist das letzte Update der Windows-Fassung. Kontovia geht im Browser weiter, auch ohne Internet und in Chrome oder Edge als eigene App.',
      'Unter Windows zeigen ein Hinweis nach dem Start und eine Karte unter Hilfe → Neuigkeiten die drei Schritte für den Umzug.',
      'Auf Wunsch legt Kontovia eine Kopie des Datenordners unter Dokumente an, die der Browser direkt öffnen kann.',
    ],
  },
  {
    version: '1.17.0',
    datum: '2026-10-03',
    titel: 'Google Kalender im Browser',
    punkte: [
      'Google Kalender lässt sich jetzt auch im Browser, auf iPhone und iPad verbinden, in beide Richtungen wie unter Windows.',
      'Zur Anmeldung öffnet sich ein kleines Fenster von Google. Danach gilt der Zugriff jeweils eine Stunde und wird mit einem Tipp verlängert.',
      'Im Browser sperrt sich Kontovia jetzt auch nach dem Ruhezustand des Geräts, in Chrome und Edge auf Wunsch auch bei gesperrtem Bildschirm.',
      'Nach einer Aktualisierung im Browser bleiben Sie angemeldet.',
      'Als App installiert, zeigt ein Punkt am Symbol, dass eine neue Fassung bereitliegt.',
    ],
  },
  {
    version: '1.16.0',
    datum: '2026-10-03',
    titel: 'Echte PDF-Dateien',
    punkte: [
      'Berichte lassen sich jetzt auch im Browser, auf iPhone und iPad als echte PDF-Datei speichern, ohne Umweg über den Druckdialog.',
      'Das Paket „Alles für das Finanzamt“ enthält die Berichte als PDF.',
      'Lange Tabellen gehen sauber über mehrere Seiten, mit Spaltenköpfen auf jeder Seite; das Buchungsjournal steht im Querformat.',
      'Drucken geht in der Web-Fassung weiterhin über den eigenen Knopf.',
    ],
  },
  {
    version: '1.15.0',
    datum: '2026-10-03',
    titel: 'Buchhaltung in einem Ordner',
    punkte: [
      'In Chrome und Edge lässt sich die Buchhaltung jetzt in einem Ordner auf dem Gerät speichern statt im Speicher des Browsers: Einstellungen → Sicherung und Speicherort.',
      'Der Ordner ist so aufgebaut wie unter Windows. Eine Kopie des Windows-Datenordners öffnen Sie beim ersten Start mit „Ordner öffnen“.',
      'Liegt die Buchhaltung nur im Browser, erinnert Kontovia gelegentlich an die Cloud-Sicherung oder eine Vollsicherung.',
    ],
  },
  {
    version: '1.14.0',
    datum: '2026-10-02',
    titel: 'Aufgeräumt',
    punkte: [
      'Die Cloud-Sicherung läuft nur noch auf einem Weg. Wer sie über Google Drive oder ein eigenes Google-Projekt genutzt hat, verbindet sie einmal neu; die Einstellungen weisen darauf hin.',
      'Die Fassung ohne Installation gibt es nicht mehr. Wer sie benutzt, bekommt beim nächsten Update das normale Installationsprogramm, die Buchhaltung bleibt, wo sie ist.',
      'Kontovia prüft jetzt bei jeder Änderung, dass Buchhaltungen aus älteren Versionen lesbar bleiben.',
    ],
  },
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
