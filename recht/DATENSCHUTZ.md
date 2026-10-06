# Datenschutzhinweise zu Kontovia

Stand: 6. Oktober 2026, Programmversion 2.21.0

---

## Verantwortlicher

Verantwortlich für die Verarbeitung nach Art. 4 Nr. 7 DSGVO, soweit sie hier
beschrieben ist (Auslieferung der Web-App, Cloud-Anmeldung, Aktualisierung):

    Beispielbetrieb (Platzhalter, noch keine Firma)
    Musterstraße 1
    12345 Musterstadt
    Deutschland
    E-Mail: platzhalter@example.org

Für die Buchhaltung selbst, also die Daten Ihrer Kundinnen, Kunden und
Lieferanten, sind Sie als Betrieb verantwortlich (siehe unten). Wir haben
keinen Datenschutzbeauftragten bestellt; dazu besteht keine Pflicht.

## Kurzfassung

Kontovia ist eine Web-App, die in Ihrem Browser auf Ihrem eigenen Gerät läuft
und sich dort wie ein Programm installieren lässt. Ohne Cloud-Abgleich gibt es
kein Benutzerkonto beim Anbieter, und es gibt in keinem Fall eine Auswertung Ihrer Nutzung. Ohne den ausdrücklich
eingerichteten Cloud-Abgleich und ohne verbundenen Google Kalender verlässt
keine Angabe aus Ihrer Buchhaltung Ihr Gerät; die Suche nach neuen Versionen
läuft nur mit Ihrer Zustimmung.

## Welche Daten das Programm verarbeitet

Sie geben Ihre Buchhaltung ein: Beträge, Belege, Kategorien, Termine und die
Kontaktdaten Ihrer Kunden und Lieferanten. Darunter sind personenbezogene Daten
Dritter. Verantwortlich für diese Verarbeitung sind **Sie als Betrieb**, nicht
der Anbieter des Programms. An ihn fließt nichts.

Rechtsgrundlage für das Speichern der Buchhaltung auf Ihrem Gerät ist Ihre eigene
Entscheidung als Verantwortliche. Wir verarbeiten diese Daten nicht.

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

## Speicher im Browser (Cookies und ähnliche Technologien)

Kontovia setzt **keine Cookies** und bindet kein Tracking, keine Werbung und
keine Analyse ein. Es speichert in Ihrem Browser (IndexedDB, lokaler Speicher,
Zwischenspeicher und Sitzungsspeicher) nur, was für den Betrieb der App
unbedingt erforderlich ist und was Sie ausdrücklich verlangen: die verschlüsselte
Buchhaltung, die Liste Ihrer Konten, Einstellungen wie das Erscheinungsbild und
die Programmdateien für den Betrieb ohne Netz. Dafür ist nach § 25 Abs. 2 Nr. 2
TDDDG keine Einwilligung nötig. Alles lässt sich in den Einstellungen Ihres
Browsers löschen; ohne Sicherung ist die Buchhaltung dann weg.

Schriften und alle anderen Dateien lädt Kontovia von der eigenen Adresse, nicht
von Schriftenanbietern oder Content-Delivery-Netzen.

## Kontoauszüge einlesen

Wenn Sie einen Kontoauszug einlesen (CSV, CAMT.053 oder MT940), liest Kontovia die Datei im Browser auf Ihrem Gerät.
Die Datei wird nicht hochgeladen und nirgends abgelegt. Ihr Inhalt liegt nur im Arbeitsspeicher, bis Sie gebucht
oder die Ansicht verlassen haben, und wird beim Sperren verworfen. Es gibt keinen Abruf bei der Bank und keine
Verbindung zu einem Dienst: Sie laden die Datei selbst bei Ihrer Bank herunter. Die Zuordnung zu Rechnungen folgt
festen Regeln und keinem lernenden Verfahren. Auch die Kategorie-Vorschläge entstehen auf Ihrem Gerät, aus Ihren
früheren Buchungen und einer festen Liste bekannter Händlernamen. Dafür wird kein Text an einen Dienst gesendet.

Gebucht wird nur, was Sie bestätigen. Die Buchungen stehen danach wie alle anderen verschlüsselt in Ihrem Tresor,
mit dem Namen der Datei und dem Zeitpunkt als Herkunft, mit einem Prüfwert je Umsatz, damit derselbe Umsatz nie
zweimal gebucht wird, und mit der IBAN der Gegenseite. Eigene Regeln und gemerkte Spaltenzuordnungen liegen ebenfalls
verschlüsselt im Tresor und gehen beim Cloud-Abgleich nur verschlüsselt mit.

## Mahnungen

Mahnschreiben entstehen auf Ihrem Gerät und liegen wie Rechnungen als PDF verschlüsselt im Tresor. Sie enthalten Name
und Anschrift des Kunden sowie die Beträge. Wie lange Sie sie aufbewahren, bestimmen Sie. Handelsbriefe sind nach
§ 257 HGB sechs Jahre aufzubewahren.

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

Empfänger ist Beispielbetrieb (Platzhalter, noch keine Firma) als Betreiber des Firebase-Projekts sowie
Google Ireland Limited beziehungsweise Google LLC als Auftragsverarbeiter.
Gespeichert werden:

* der verschlüsselte Tresor und die verschlüsselten Belege im Cloud Storage
  (Standort: Europäische Union, Rechenzentren in Finnland und den Niederlanden)
* nur wenige Minuten und nur verschlüsselt: beim Verbinden eines weiteren
  Geräts eine Anfrage und eine Antwort in Ihrem Bereich (siehe „Weiteres Gerät
  verbinden“)
* ein Eintrag zu Ihrer Zulassung (siehe „Befristete Zulassung“), den nur der
  Betreiber setzen kann und den Kontovia nur liest
* über Firebase Authentication Ihre E-Mail-Adresse und eine Kontokennung.
  Diese liegen unverschlüsselt vor und dienen allein dazu, Ihnen beim Anmelden
  Ihren eigenen Bereich zuzuordnen

Für die Kontodaten aus Firebase Authentication ist kein Speicherort wählbar;
sie liegen in der globalen Infrastruktur von Google. Grundlage für die
Übermittlung in die USA ist das EU-US Data Privacy Framework, unter dem Google
zertifiziert ist.

**Auftragsverarbeitung:** Für den Cloud-Speicher besteht zwischen dem Betreiber
des Firebase-Projekts und Google ein Auftragsverarbeitungsvertrag. Setzen Sie
Kontovia gewerblich ein, gilt die Anlage zur Auftragsverarbeitung in den
Nutzungsbedingungen: Für Ihre verschlüsselten Daten sind wir dann Ihr
Auftragsverarbeiter, für E-Mail-Adresse und Kontokennung selbst Verantwortliche.

**Widerruf:** In den Einstellungen unter „Verbindung trennen“. Das Gerät meldet
sich dann von der Cloud ab; Ihre anderen Geräte bleiben verbunden. Im selben
Dialog können Sie wählen, ob der verschlüsselte Tresor samt Belegen und
Sicherungen in der Cloud gelöscht werden soll; dann löscht Kontovia auch Ihr
Anmeldekonto bei Firebase Authentication (E-Mail-Adresse und Kontokennung). Gelingt
Letzteres nicht, etwa ohne Netz, löschen wir es auf Ihre Nachricht an die oben
genannte Adresse unverzüglich. Die Freigabe für Kontovia in
Ihrem Google-Konto entfernen Sie unter *Sicherheit → Verbindungen zu
Drittanbieter-Apps* (myaccount.google.com/connections).

### Google-Anmeldung und die Google API Services User Data Policy

Die Nutzung und Weitergabe von Informationen, die Kontovia von Google-APIs
erhält, folgt der Google API Services User Data Policy
(developers.google.com/terms/api-services-user-data-policy) einschließlich der
Anforderungen an die eingeschränkte Nutzung (Limited Use). In der Sprache der
Richtlinie: Kontovia's use and transfer to any other app of information received
from Google APIs will adhere to the Google API Services User Data Policy,
including the Limited Use requirements. Konkret: Kontovia
verwendet Daten aus Ihrem Google-Konto (Name, E-Mail-Adresse, Kalendertermine)
ausschließlich, um die von Ihnen gewählte Funktion bereitzustellen. Sie werden
nicht an Dritte weitergegeben, nicht für Werbung verwendet, nicht zur Entwicklung
oder zum Training von Modellen genutzt und nicht von Menschen gelesen, außer Sie
verlangen das ausdrücklich oder es ist aus Sicherheitsgründen oder zur Erfüllung
von Gesetzen nötig.

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

## Weiteres Gerät verbinden (freiwillig)

Wer Kontovia auf einem zweiten Gerät öffnen möchte, meldet sich dort mit
demselben Google-Konto an und scannt am ersten Gerät einen QR-Code. Dabei legen
beide Geräte kurzzeitig zwei kleine Dateien in Ihrem Bereich des Cloud-Speichers
ab: eine Anfrage und eine Antwort. Beide sind mit einem Geheimnis verschlüsselt,
das **nur im QR-Code** steht und nie über das Netz geht. Der Name, den Sie dem
neuen Gerät geben, liegt deshalb nur verschlüsselt dort. Sichtbar sind für den
Betreiber der Ablage allein Dateiname (eine zufällige Kennung), Größe und
Zeitpunkt. Die Dateien werden nach der Übernahme, bei Abbruch und nach spätestens
fünf Minuten vom Gerät gelöscht; liegt eine einmal länger, räumt das nächste
Gerät sie ab. Ohne den QR-Code sind sie wertlos. Die Liste der verbundenen
Geräte (Name, Datum) steht nur in Ihrem verschlüsselten Tresor auf dem Gerät, von
dem aus Sie verbunden haben, und wird nicht in die Cloud abgeglichen.
Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.

## Befristete Zulassung (bei Verbindung mit Google)

Ist ein Gerät mit einem Google-Konto verbunden, fragt Kontovia beim Entsperren und
danach alle sechs Stunden, spätestens aber alle 30 Tage bei Ihrem Konto im
Cloud-Speicher nach, ob es noch zugelassen ist (eine kleine Datei, die nur der
Betreiber setzen kann). Dabei werden ausschließlich die Anmeldung und das Lesen
dieser einen Datei übertragen: keine Angaben zu Ihrer Buchhaltung, zu Ihrem Gerät
oder zu Ihrer Nutzung. Das Gerät merkt sich den Zeitpunkt der letzten Bestätigung
auf dem Gerät. Der Zweck: Ein verlorenes, gestohlenes oder nicht mehr berechtigtes
Gerät kann vom Konto getrennt werden. Ist das Konto ausdrücklich gesperrt,
entfernt Kontovia die Buchhaltung von diesem Gerät, jedoch erst nach
wiederholter Bestätigung im Abstand von mindestens 24 Stunden und nachdem sie
gesichert in der Cloud liegt; die Cloud-Kopie bleibt erhalten. Bei Störungen oder
ohne Netz geschieht nichts dergleichen. Mit „Verbindung trennen“ endet die
Prüfung. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Sicherheit der Daten).

## Rückmeldungen

Mit „Feedback“ in der Seitenleiste können Sie uns Text und auf Wunsch ein
Bildschirmfoto der aktuellen Seite schicken. Das Foto entsteht auf Ihrem
Gerät und kann Zahlen aus Ihrer Buchhaltung zeigen; es geht nur mit, wenn Sie
den Haken dafür selbst setzen, und Sie sehen es vorher.

Mit „Senden“ übertragen wir in den Cloud-Speicher unseres Projekts (Google
Cloud Storage, EU, derselbe Speicher wie für die Cloud-Sicherung, aber ein
getrennter Ordner): die Art der Rückmeldung, Ihren Text, den Namen der Seite,
auf der Sie waren, die Programmversion, die Fenstergröße, den Zeitpunkt und
auf Wunsch das Foto. Nicht übertragen werden Ihre Buchhaltung, Ihr Name, Ihre
E-Mail-Adresse oder eine Kennung Ihres Kontos; dafür ist kein Konto nötig.
Anders als Ihre Buchhaltung ist diese Übertragung nicht mit Ihrem Passwort
verschlüsselt (sie läuft über eine verschlüsselte Verbindung, liegt aber
unverschlüsselt im Speicher). **Jede gesendete Rückmeldung, auch ein
mitgesendetes Foto, kann von anderen gelesen werden**, technisch von jedem, der
die Adresse des Speichers kennt. Schreiben Sie daher
bitte keine Passwörter, Kontonummern, Steuerdaten oder Namen von Kunden hinein
und kreuzen Sie das Foto nur an, wenn die Seite nichts zeigt, das nicht
öffentlich sein soll. Wir löschen Rückmeldungen auf Anfrage und wenn sie erledigt sind. Wir
verwenden sie, um Kontovia zu verbessern.

Eine Kopie bleibt verschlüsselt in Ihrer Buchhaltung auf Ihrem Gerät, das Foto
als Beleg. Klappt das Senden nicht, versucht Kontovia es später erneut; bis
dahin bleibt die Rückmeldung nur bei Ihnen. Rückmeldungen, die Sie vor Version
2.9 gespeichert haben, wurden nie gesendet und werden auch nicht nachgesendet.

## Abmelden

„Abmelden“ neben „Sperren“ entfernt das geöffnete Konto mit Buchhaltung, Belegen,
Sicherungen und allen Zugängen von diesem Gerät. Ist es mit Google verbunden,
gleicht Kontovia vorher noch einmal ab. Weitere Konten auf dem Gerät bleiben
unberührt. In der Cloud bleibt, was dort liegt.

## Benutzer in einem Konto

In einem Konto lassen sich mehrere Benutzer anlegen (Name und Rolle), etwa für
Mitarbeitende oder die Steuerberatung. Die Namen liegen verschlüsselt im Tresor.
Das Änderungsjournal vermerkt bei jeder Änderung, welcher Benutzer sie gemacht hat;
das dient dem Nachweis der Ordnungsmäßigkeit (GoBD) und ist deshalb Teil der
Buchführungsunterlagen. Wer Benutzer anlegt, informiert diese Personen darüber und
ist dafür verantwortlich. Rechtsgrundlage ist Art. 6 Abs. 1 lit. c und f DSGVO.

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

## Rechnungen per E-Mail senden (freiwillig)

Kontovia hat keinen eigenen Mailserver. Eine Rechnung per E-Mail geht immer
über Ihr eigenes Konto oder Programm, nie über einen Server des Herstellers.

**Über Gmail oder Outlook direkt:** Wählen Sie diesen Weg, spricht Ihr Browser
direkt mit Google (`accounts.google.com` für die Freigabe,
`gmail.googleapis.com` für das Senden) bzw. Microsoft
(`login.microsoftonline.com` für die Freigabe, `graph.microsoft.com` für das
Senden). Beim ersten Mal fragt der Anbieter in einem eigenen Fenster, ob
Kontovia in Ihrem Namen E-Mails senden darf. Kontovia erhält nur das Recht zu
**senden**, nicht, Ihre E-Mails zu lesen. Übertragen werden Empfänger, Betreff,
Text und die gewählten Anhänge (Rechnung als PDF, auf Wunsch die XRechnung).
Die E-Mail liegt danach in Ihrem Konto unter „Gesendet“. Der Zugriff gilt rund
eine Stunde, liegt nur im Arbeitsspeicher des Browsers und verfällt, sobald
Kontovia sich sperrt. Im Tresor merkt sich Kontovia auf diesem Gerät nur die
Adresse des Kontos, mit dem zuletzt gesendet wurde; „Anderes Konto“ löscht sie.
Bei Google gilt die Freigabe zusammen mit der für Google Kalender: Trennen Sie
dort den Kalender, endet auch das Senden.

**Über Ihr E-Mail-Programm:** Kontovia legt die fertige E-Mail als Datei in
Ihren Download-Ordner, übergibt sie über das Teilen-Menü Ihres Geräts oder
öffnet Ihr E-Mail-Programm mit Empfänger, Betreff und Text. Dabei entsteht
keine Verbindung ins Netz; gesendet wird erst aus Ihrem Programm.

**Rechtsgrundlage:** Erfüllung Ihrer Verträge mit Ihren Kunden bzw. Ihr
berechtigtes Interesse am Versand Ihrer Rechnungen (Art. 6 Abs. 1 lit. b und f
DSGVO). Für die Verarbeitung bei Google oder Microsoft gelten deren
Bedingungen; bei geschäftlicher Nutzung sollte das Konto von einem
Auftragsverarbeitungsvertrag gedeckt sein (etwa Google Workspace oder
Microsoft 365). Der Hersteller von Kontovia erhält dabei keine Daten.

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

## Ihre Rechte

**Gegenüber uns.** Soweit wir Ihre Daten verarbeiten (E-Mail-Adresse und
Kontokennung bei der Cloud-Anmeldung, IP-Adresse bei Auslieferung und
Aktualisierung), haben Sie das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung
(Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21). Eine erteilte
Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen
(Art. 7 Abs. 3 DSGVO); die Verarbeitung bis dahin bleibt rechtmäßig. Wenden Sie
sich dazu an die oben genannte E-Mail-Adresse.

**Beschwerde.** Sie können sich bei einer Datenschutz-Aufsichtsbehörde
beschweren (Art. 77 DSGVO), insbesondere in dem Mitgliedstaat Ihres Aufenthalts,
Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.

**Gegenüber Ihnen als Betrieb.** Personen, deren Daten in Ihrer Buchhaltung
stehen, haben Ihnen gegenüber dieselben Rechte aus Art. 15 bis 21 DSGVO: Auskunft,
Berichtigung, Löschung im Rahmen der gesetzlichen Grenzen, Einschränkung,
Datenübertragbarkeit und Widerspruch. Für die Auskunft hilft der Kontakt-Export
unter „Export → Rohdaten“.

**Pflicht zur Bereitstellung, automatisierte Entscheidungen.** Sie müssen uns
keine Daten bereitstellen: Kontovia läuft ohne Cloud und ohne Anmeldung. Für den
Cloud-Abgleich ist ein Google-Konto nötig, ohne das er nicht möglich ist. Es gibt
keine automatisierte Entscheidungsfindung und kein Profiling (Art. 22 DSGVO).

## Übermittlung in Drittländer

Die Auslieferung der Web-App läuft über GitHub (GitHub, Inc., USA) und die
Cloud-Anmeldung, der Cloud-Speicher und der Kalenderabgleich über Google
(Google Ireland Limited bzw. Google LLC, USA). Senden Sie Rechnungen direkt über
Gmail oder Outlook, geht die E-Mail über Google bzw. Microsoft (Microsoft
Ireland Operations Limited bzw. Microsoft Corporation, USA). Die Übermittlung in
die USA stützt sich auf den Angemessenheitsbeschluss der EU-Kommission zum
EU-US Data Privacy Framework, bei dem diese Unternehmen zertifiziert sind, und ergänzend auf
Standardvertragsklauseln. Die Buchhaltung selbst verlässt Ihr Gerät nur
verschlüsselt.

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
