# Kontovia – Downloads

Buchhaltung für Windows, die auf Ihrem Rechner bleibt.

**➜ [Neueste Fassung herunterladen](../../releases/latest)**

| Datei | Wofür |
| --- | --- |
| `Kontovia-Setup-*.exe` | Installationsprogramm. Braucht kein Administratorrecht. |
| `Kontovia-*-portabel.exe` | Startet ohne Installation, etwa vom USB-Stick. |
| `update.json` | Versionsdatei für die eingebaute Aktualisierung. **Nicht herunterladen** – die Anwendung ruft sie selbst ab. |

## Beim ersten Start

Windows SmartScreen zeigt eine Warnung, weil kein Code-Signing-Zertifikat
hinterlegt ist. Über **Weitere Informationen → Trotzdem ausführen** bestätigen.
Das ist bei unsignierter Software normal und sagt nichts über den Inhalt aus.

## Was das Programm macht

* Einnahmen und Ausgaben erfassen, Belege verschlüsselt anhängen
* Termine führen und mit Rechnungen verknüpfen
* Auswertungen für jeden Zeitraum: Gewinn und Verlust, Anlage EÜR,
  Umsatzsteuer-Voranmeldung, Vermögensübersicht, offene Posten
* Export als PDF sowie für ELSTER, DATEV und die Betriebsprüfung (GoBD)
* Optionaler Abgleich zwischen mehreren Rechnern – übertragen wird
  ausschließlich der bereits verschlüsselte Datenbestand

Die gesamte Buchhaltung liegt in einer einzigen, mit AES-256-GCM
verschlüsselten Datei auf dem eigenen Rechner. Der Schlüssel wird aus dem
Passwort abgeleitet und verlässt das Gerät nie. Ohne Passwort kommt niemand an
die Daten – auch der Hersteller nicht.

## Hinweise

Kontovia ist ein Werkzeug zur Erfassung und Auswertung und ersetzt keine
Steuerberatung. Die Zuordnung zu EÜR-Zeilen, Kennzahlen und Konten sind
Vorschläge, die geprüft gehören.

Die rechtliche Einordnung (KI-Verordnung, DSGVO, GoBD, Lizenzen und Marken
Dritter) liegt jeder Installation als `COMPLIANCE.md` bei und ist in der
Anwendung unter **Hilfe → Rechtliches** erreichbar.

---

Dieses Repository enthält ausschließlich die fertigen Installationsdateien.
Der Quellcode wird getrennt davon verwaltet.
