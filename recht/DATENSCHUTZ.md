# Datenschutzhinweise zu Kontovia

<!--
  Hinweis für den Betreiber (erscheint nicht im Programm, Kontovia blendet
  HTML-Kommentare aus): Dieser Text beschreibt zutreffend, was das Programm
  technisch tut. Bevor er an Nutzer geht, unter „Verantwortlicher“ und
  „Bei der Ablage in Firebase“ die eigenen Angaben eintragen und ihn juristisch
  prüfen lassen. Rechtsberatung ist das hier nicht.
-->

Stand: 5. Oktober 2026, Programmversion 2.8.0

---

## Verantwortlicher

    [Name / Firma]
    [Anschrift]
    [E-Mail]

## Kurzfassung

Kontovia ist eine Web-App, die in Ihrem Browser auf Ihrem eigenen Gerät läuft
und sich dort wie ein Programm installieren lässt. Es gibt kein Benutzerkonto
beim Anbieter und keine Auswertung Ihrer Nutzung. Ohne den ausdrücklich
eingerichteten Cloud-Abgleich und ohne verbundenen Google Kalender verlässt
keine Angabe aus Ihrer Buchhaltung Ihr Gerät; die Suche nach neuen Versionen
läuft nur mit Ihrer Zustimmung.

## Welche Daten das Programm verarbeitet

Sie geben Ihre Buchhaltung ein: Beträge, Belege, Kategorien, Termine und die
Kontaktdaten Ihrer Kunden und Lieferanten. Darunter sind personenbezogene Daten
Dritter. Verantwortlich für diese Verarbeitung sind **Sie als Betrieb**, nicht
der Anbieter des Programms. An ihn fließt nichts.

Alle Daten liegen verschlüsselt auf Ihrem Gerät: im Speicher des Browsers oder,
wenn Sie das in Chrome oder Edge wählen, in einem Ordner Ihrer Wahl (siehe
„Auslieferung und Speicherort“). Die Verschlüsselung erfolgt mit AES-256-GCM;
der Schlüssel wird mit scrypt aus Ihrem Passwort abgeleitet und existiert nur im
Arbeitsspeicher, solange das Programm entsperrt ist.

## Was das Programm nicht tut

* keine Telemetrie, keine Nutzungsstatistik, keine Absturzberichte
* keine Werbung, kein Tracking, keine Weitergabe an Dritte
* keine automatische Übermittlung an Finanzbehörden
* keine künstliche Intelligenz und damit keine Verarbeitung Ihrer Daten durch
  Modelle Dritter

Kontovia baut von sich aus keine Verbindung ins Internet auf. Die einzigen
Verbindungen, die das Programm überhaupt aufbauen kann, sind die unten
genannten: der Cloud-Abgleich, der Abgleich mit Google Kalender und die Suche
nach einer neuen Programmversion. Alle drei laufen erst, wenn Sie ihnen
ausdrücklich zustimmen.

## Cloud-Abgleich (freiwillig)

Der Abgleich ist ausgeschaltet, bis Sie ihn einrichten. Das geht in den Einstellungen
oder beim ersten Start über „Mit Google anmelden“. Übertragen wird
ausschließlich der **bereits verschlüsselte** Tresor sowie die einzeln
verschlüsselten Belegdateien.

**Sicherungen:** Zusätzlich legt Kontovia höchstens einmal am Tag sowie vor
jedem Überschreiben und jeder Wiederherstellung eine Kopie des ebenso
verschlüsselten Tresors ab und hält die 30 neuesten vor. Belege, die Ihr
Bestand nicht mehr braucht, bleiben noch 90 Tage gespeichert, damit diese
Sicherungen vollständig wiederherstellbar sind.

**Was der Betreiber der Ablage sehen kann:** Dateigröße, Änderungszeitpunkt und
die Identität des angemeldeten Kontos. **Nicht** den Inhalt. Dafür wäre Ihr
Tresorpasswort nötig, und das verlässt Ihr Gerät nie. Eine Ausnahme gibt es nur,
wenn Sie selbst „Google-Konto“ unter *Weitere Wege zum Entsperren* einschalten
(siehe unten).

**Rechtsgrundlage:** Art. 6 Abs. 1 lit. b und f DSGVO (Durchführung der eigenen
Buchhaltung, berechtigtes Interesse an einer Datensicherung).

### Wo die Daten liegen

Empfänger ist [Anbieter eintragen] als Betreiber des Firebase-Projekts sowie
Google Ireland Limited beziehungsweise Google LLC als Auftragsverarbeiter.
Gespeichert werden:

* der verschlüsselte Tresor und die verschlüsselten Belege im Cloud Storage
  (Standort: Europäische Union, Rechenzentren in Finnland und den Niederlanden)
* über Firebase Authentication Ihre E-Mail-Adresse und eine Kontokennung.
  Diese liegen unverschlüsselt vor und dienen allein dazu, Ihnen beim Anmelden
  Ihren eigenen Bereich zuzuordnen

Für die Kontodaten aus Firebase Authentication ist kein Speicherort wählbar;
sie liegen in der globalen Infrastruktur von Google. Grundlage für die
Übermittlung in die USA ist das EU-US Data Privacy Framework, unter dem Google
zertifiziert ist.

**Auftragsverarbeitung:** Für den Cloud-Speicher besteht zwischen dem Betreiber
des Firebase-Projekts und Google ein Auftragsverarbeitungsvertrag. Setzen Sie
Kontovia gewerblich ein, regelt [Anbieter eintragen] mit Ihnen, in welcher Rolle
er Ihre verschlüsselten Daten speichert.

**Widerruf:** In den Einstellungen unter „Verbindung trennen“. Das Gerät meldet
sich dann von der Cloud ab; Ihre anderen Geräte bleiben verbunden. Im selben
Dialog können Sie wählen, ob der verschlüsselte Tresor samt Belegen und
Sicherungen in der Cloud gelöscht werden soll. Die Freigabe für Kontovia in
Ihrem Google-Konto entfernen Sie unter *Sicherheit → Verbindungen zu
Drittanbieter-Apps* (myaccount.google.com/connections).

## Weitere Wege zum Entsperren (freiwillig)

Ihr Passwort bleibt immer gültig. Zusätzlich lassen sich in den Einstellungen
unter *Sicherheit* zwei weitere Wege einschalten. Jeder öffnet denselben Tresor
für sich allein.

**Fingerabdruck oder Gesicht (nur dieses Gerät).** Ihr Gerät gibt nach der
Bestätigung per Biometrie ein geheimes Merkmal heraus, aus dem Kontovia einen
Schlüssel ableitet, der den Tresorschlüssel umhüllt. Die Hülle liegt nur im
Speicher Ihres Browsers. Fingerabdruck und Gesicht selbst sehen weder Kontovia
noch der Betreiber noch Google; sie bleiben im Sicherheitschip Ihres Geräts.
Beim Abmelden wird die Hülle gelöscht.

**Google-Konto (jedes Gerät).** Dafür legt Kontovia den Tresorschlüssel als
kleine Datei in Ihrem eigenen Bereich des Cloud-Speichers ab. Wer sich mit
Ihrem Google-Konto anmeldet, bekommt sie und kann Kontovia ohne Passwort
öffnen. **Das ist ein Zugeständnis an die Bequemlichkeit:** Wer Ihr Google-Konto
übernimmt, und der Betreiber des Cloud-Projekts, der technisch auf den Speicher
zugreifen kann, kommen dann an Ihre Buchhaltung. Ohne diesen Schalter hat nur
Ihr Passwort den Schlüssel. Mit „Ausschalten“ wird die Datei gelöscht. Auch
„Verbindung trennen“ mit Löschen der Cloud-Daten entfernt sie.

## Rückmeldungen

Mit „Feedback“ in der Seitenleiste können Sie Text und auf Wunsch ein
Bildschirmfoto der aktuellen Seite speichern. Das Foto entsteht auf Ihrem
Gerät und kann Zahlen aus Ihrer Buchhaltung zeigen; Sie sehen es vor dem
Speichern und können es abwählen. Gespeichert wird die Rückmeldung verschlüsselt
in Ihrer Buchhaltung, das Foto als Beleg. Sie wird vorerst an niemanden
gesendet. Sollte ein Versand eingeführt werden, geschieht er nur auf Ihr
Zutun und wird hier beschrieben.

## Abmelden

„Abmelden“ neben „Sperren“ entfernt das geöffnete Konto mit Buchhaltung, Belegen,
Sicherungen und allen Zugängen von diesem Gerät. Ist es mit Google verbunden,
gleicht Kontovia vorher noch einmal ab. Weitere Konten auf dem Gerät bleiben
unberührt. In der Cloud bleibt, was dort liegt.

## Mehrere Konten auf einem Gerät

Auf einem Gerät können mehrere Konten angemeldet sein, zum Beispiel für mehrere
Betriebe. Jedes Konto hat sein eigenes Passwort und liegt getrennt von den anderen
im Speicher des Browsers; beim Wechseln wird die Seite neu geladen, damit nichts
von einem Konto in das andere gelangt. Im Klartext steht auf dem Gerät nur eine
Liste dieser Konten mit einer Kennung, dem Namen des Betriebs und, falls
verbunden, der Google-Adresse, damit Sie ein Konto vor dem Entsperren erkennen.
Mit „Abmelden“ verschwindet der Eintrag.

## Google Kalender (freiwillig)

Auf Wunsch gleicht Kontovia Ihre Termine mit Ihrem Google-Kalender ab. Das
geschieht erst, nachdem Sie unter *Einstellungen → Kalender-Abgleich* (oder im
Kalender über *Abgleich*) ausdrücklich verbunden und sich bei Google angemeldet
haben.

Kontovia legt dafür in Ihrem Google-Konto einen eigenen Kalender „Kontovia“ an
und erhält zunächst nur auf diesen Kalender Zugriff (Bereich
`calendar.app.created`).

**Weitere Kalender (freiwillig):** Wenn Sie es einschalten, erhält Kontovia
zusätzlich das Recht, Ihre Kalender aufzulisten und Termine darin zu lesen und
zu ändern (Bereiche `calendar.readonly` und `calendar.events`). Abgeglichen
werden nur die Kalender, die Sie auswählen, in beide Richtungen: Termine daraus
werden (ab gut einem Jahr zurück) in Ihrem verschlüsselten Tresor gespeichert
und gehen mit dem Cloud-Abgleich verschlüsselt auf Ihre anderen Geräte;
Änderungen und Löschungen in Kontovia gehen an diese Kalender zurück.

**Was übertragen wird (anders als beim Cloud-Abgleich unverschlüsselt)**, weil
Google die Termine sonst nicht anzeigen könnte: Titel, Datum, Uhrzeit, Ort und
Wiederholung Ihrer Termine, sofern eingeschaltet die Notiz, auf Wunsch außerdem
Veranstaltungstermine aus Anzahlungen und Fälligkeiten offener Rechnungen,
jeweils **ohne Beträge**. Buchungen, Beträge, Kontakte und Belege werden nicht
übertragen. Umgekehrt übernimmt Kontovia Termine, die Sie in Google im Kalender
„Kontovia“ anlegen oder ändern.

Stehen Namen von Kunden im Titel eines Termins, gelangen sie damit zu Google.
Bei geschäftlicher Nutzung sollte das Google-Konto deshalb von einem
Auftragsverarbeitungsvertrag gedeckt sein (etwa Google Workspace).

**Rechtsgrundlage:** Ihre Einwilligung durch das Verbinden (Art. 6 Abs. 1 lit. a
DSGVO) bzw. bei geschäftlicher Nutzung das berechtigte Interesse an einem
gemeinsamen Terminkalender (Art. 6 Abs. 1 lit. f DSGVO). Der Hersteller von
Kontovia erhält dabei keine Daten.

**Widerruf:** *Trennen* zieht die Freigabe bei Google zurück; auf Wunsch wird
der Kalender „Kontovia“ in Google gelöscht. Die Termine in Kontovia bleiben
erhalten. Google zieht dabei die Freigabe des ganzen Kontos zurück. Ist Google
Kalender auch auf einem anderen Gerät verbunden, muss er dort neu verbunden
werden.

Ihr Browser spricht dafür direkt mit Google (`accounts.google.com` für die
Anmeldung, `www.googleapis.com` für die Termine). Google erteilt dort nur einen Zugriff für jeweils eine Stunde. Er
liegt nur im Arbeitsspeicher des Browsers, nie im Tresor oder im
Browser-Speicher, und verfällt, sobald Kontovia sich sperrt. Danach wartet der
Abgleich, bis Sie ihn mit einem Tipp erneut bestätigen.

Wo ein zweites Fenster nicht geht (etwa in der App auf dem iPhone), wechselt
Kontovia stattdessen kurz selbst zu Google. Bis zur Rückkehr, höchstens 15
Minuten, merkt es sich dafür im Browser-Speicher nur den Zweck, eine
Zufallskennung und Ihre Häkchen aus dem Verbindungsdialog; die Berechtigung von
Google steht dort nicht. Die Kennung wird bei der Rückkehr sofort gelöscht.

Ohne Google-Konto lassen sich Termine als Kalenderdatei (.ics) exportieren und
importieren; dabei entsteht keine Verbindung ins Netz.

## Programmaktualisierung (freiwillig)

Kontovia bringt die Adresse einer Versionsdatei mit. Abgefragt wird sie
**erst nach Ihrer Zustimmung**: Beim Einrichten werden Sie einmal gefragt, ob
das Programm nach neuen Fassungen suchen soll; die Frage ist nicht
vorausgewählt, und wer sie offen lässt, bekommt sie beim nächsten Start
erneut. Vorher geht nichts hinaus.

**Rechtsgrundlage:** Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Sie ist
freiwillig und lässt sich jederzeit unter *Einstellungen →
Programmaktualisierung* widerrufen. Eine von Ihnen selbst über *Hilfe → Nach
neuer Version suchen* ausgelöste Suche ist davon unabhängig und findet nur auf
Ihren Klick hin statt.

Haben Sie zugestimmt, ruft Kontovia die Versionsdatei beim Start und danach
alle sechs Stunden ab, solange das Programm geöffnet ist. Liegt eine neuere
Fassung vor, erscheint ein Hinweis; heruntergeladen und installiert wird erst
nach einer weiteren ausdrücklichen Bestätigung.

Bei jeder solchen Abfrage erfährt der Betreiber dieses Servers (GitHub, Inc.,
USA) zwangsläufig Ihre IP-Adresse und den Zeitpunkt der Anfrage. Es werden keine
Kennungen Ihres Geräts und keine Angaben aus Ihrer Buchhaltung mitgesendet. Sie
können die Prüfung jederzeit unter *Einstellungen → Programmaktualisierung*
wieder abschalten.

**Angemeldet bleiben beim Update:** Lädt Kontovia eine neue Fassung, wird der Schlüssel Ihrer Buchhaltung für das Neuladen geteilt
abgelegt: umhüllt im Speicher des Browsers, der passende Gegenschlüssel nur im
geöffneten Tab. Beides gilt höchstens zwei Minuten und nur für die neue
Fassung, wird beim Start sofort gelöscht und beim Sperren verworfen. Das Gerät
verlässt es nie.

## Auslieferung und Speicherort

Kontovia läuft im Browser und lässt sich auf iPhone, iPad und Mac „zum
Home-Bildschirm“ bzw. „zum Dock“ hinzufügen, in Chrome und Edge als App
installieren.

* **Auslieferung.** Die Programmdateien kommen von einem Webserver
  (GitHub Pages der GitHub, Inc., USA). Beim
  ersten Aufruf und bei einer bestätigten Aktualisierung werden sie dort
  abgerufen; danach liegen sie auf dem Gerät und Kontovia läuft ohne Netz.
  Unabhängig davon fragt der Browser beim Öffnen selbstständig nach, ob sich die
  Steuerdatei `sw.js` geändert hat. Bei jedem dieser Abrufe erfährt der
  Betreiber des Servers Ihre IP-Adresse und den Zeitpunkt; Angaben aus Ihrer
  Buchhaltung werden nie übertragen.
* **Speicherort.** Tresor und Belege liegen zunächst im Speicher des Browsers
  (IndexedDB), in derselben Verschlüsselung wie oben beschrieben. Browser dürfen
  solche Daten bei Platzmangel räumen. Kontovia bittet deshalb um dauerhafte
  Speicherung und zeigt unter *Einstellungen* an, ob der Browser sie gewährt hat.
  Ihre Gerätekennung, die Liste Ihrer Konten und, für höchstens zwei Minuten während einer
  Aktualisierung, die Übergabe aus „Angemeldet bleiben beim Update“ liegen immer
  im Browser.
  In Chrome und Edge lässt sich die Buchhaltung stattdessen in einem Ordner auf
  Ihrem Gerät speichern, den Sie selbst wählen; Kontovia liest und schreibt dann
  nur in diesem Ordner, und der Browser fragt nach einem Neustart, ob er das darf.
  Auf iPhone und iPad ist der Cloud-Abgleich oder eine regelmäßige Vollsicherung
  dringend zu empfehlen.
* **Anmeldung bei Google.** Für den Cloud-Abgleich leitet Kontovia zu
  Google weiter und nach der Anmeldung zurück; ersatzweise zeigt sie einen kurzen
  Code für `google.com/device`. Angefragt werden nur Name und E-Mail-Adresse. Was
  dabei an Google und Firebase geht, entspricht dem oben Beschriebenen.

## Speicherdauer

Sie bestimmen sie. Das Programm löscht von sich aus nichts. Beachten Sie die
steuerlichen Aufbewahrungspflichten nach § 147 AO: Buchungsbelege acht Jahre,
Bücher und Abschlüsse zehn Jahre. Ein Löschverlangen nach Art. 17 DSGVO tritt
für diese Zeit hinter die Aufbewahrungspflicht zurück (Art. 17 Abs. 3 lit. b
DSGVO). Praktisch: Kontaktdaten dürfen Sie bereinigen, die Buchung selbst nicht.

## Rechte betroffener Personen

Personen, deren Daten in Ihrer Buchhaltung stehen, haben Ihnen gegenüber die
Rechte aus Art. 15 bis 21 DSGVO: Auskunft, Berichtigung, Löschung im Rahmen der
gesetzlichen Grenzen, Einschränkung, Datenübertragbarkeit und Widerspruch. Für
die Auskunft hilft der Kontakt-Export unter „Export → Rohdaten".

## Technische und organisatorische Maßnahmen

* Verschlüsselung im Ruhezustand: AES-256-GCM, authentifiziert
* Schlüsselableitung: scrypt mit N = 2¹⁷, r = 8 (rund 134 MiB je Versuch)
* automatische Sperre bei Inaktivität, nach einigen Minuten im Hintergrund,
  nach dem Ruhezustand und, in Chrome und Edge auf Wunsch, bei Bildschirmsperre
* Belegdateien einzeln verschlüsselt, Dateinamen ohne Aussagekraft
* verkettetes Änderungsjournal zum Nachweis der Unveränderbarkeit
* Anmeldemerkmale für Google und Firebase bleiben in der Verbindungsschicht; sie stehen
  weder im JSON-Gesamtexport noch in einer Vollsicherung noch in der Cloud
* Verschlüsselung vor jeder Übertragung in die Cloud
* Schlüsselübergabe beim Update nur geteilt (umhüllt im Browser-Speicher,
  Gegenschlüssel nur im Tab), für höchstens zwei Minuten und genau einen Start

## Änderungen

Diese Hinweise gelten für die oben genannte Programmversion. Neue Fassungen
liegen der jeweiligen Version bei.
