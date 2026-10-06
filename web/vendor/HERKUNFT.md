# Fremder Programmcode in Kontovia

Kontovia kommt sonst ohne fremden Code aus. Die einzige Ausnahme ist die
Laufzeit für den Assistenten: Ein Sprachmodell auf dem Grafikchip des Geräts
auszuführen, lässt sich nicht sinnvoll selbst schreiben.

| Datei | Herkunft | Lizenz |
|---|---|---|
| `web-llm.js` | `@mlc-ai/web-llm` 0.2.85 (npm), `lib/index.js`, einzige Änderung: Zeilenenden CRLF zu LF (210 Zeilen in Lizenzkommentaren und Hilfscode; für JavaScript bedeutungsgleich) | Apache 2.0 (`LICENSE-web-llm.txt`), enthält `loglevel` 1.9 (MIT, `LICENSE-loglevel.txt`), TVM-Laufzeit und XGrammar (beide Apache 2.0) |

SHA-256 von `web-llm.js` (mit LF): `a79b021e27e3048de514a2913bfb55800ddb31b1bd82eb38ba91f9b51b602e1f`; das Original aus npm hat `341bae95822bfee1d0fd6a0e6cd2db8613bb8edf809390ac142fba36ec17792c`
(die Prüfung `assistent` hält den Wert fest; wer die Datei austauscht, trägt ihn dort nach).

Geladen wird die Datei nur im Rechenwerk des Assistenten (`../ki-worker.js`)
und erst, wenn jemand ein Modell bewusst herunterlädt oder startet. Dort leitet
eine Sperre jeden Netzzugriff über `netz.js: modellAdresseErlaubt`.
Die Prüfungen (Syntax, Texte) lassen den Ordner `vendor` aus.

Aktualisieren: `npm pack @mlc-ai/web-llm@<fassung>`, `lib/index.js` hierher
kopieren, CRLF zu LF wandeln (Git und der Bau tun es sonst unbemerkt), Prüfsumme hier und in `scripts/pruefungen/assistent.test.js`
nachtragen, Modellfassungen in `../kimodelle.js` prüfen.
