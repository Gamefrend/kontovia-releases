# Fremder Programmcode in Kontovia

Kontovia kommt sonst ohne fremden Code aus. Es gibt genau zwei Ausnahmen, beide
für Dinge, die sich nicht sinnvoll selbst schreiben lassen: die Datenbank, in
der die Buchhaltung liegt (SQLite), und die Laufzeit für den Assistenten (ein
Sprachmodell auf dem Grafikchip des Geräts).

| Datei | Herkunft | Lizenz |
|---|---|---|
| `sqlite3.mjs`, `sqlite3.wasm` | SQLite3 Multiple Ciphers 2.5.1 auf SQLite 3.53.4, Release-Datei `sqlite3mc-2.5.1-sqlite-3.53.4-wasm.zip` von https://github.com/utelle/SQLite3MultipleCiphers/releases/tag/v2.5.1 (SHA-256 der ZIP-Datei `761a41b8dc996cfa21f193fc044739fbb0c4a31a1fd657a4df49cc59085577ce`, wie in der signierten `sqlite3mc-2.5.1-SHA256SUMS`), daraus `sqlite3mc-wasm-3530400/jswasm/sqlite3.mjs` und `sqlite3.wasm`, unverändert (die `.mjs` hat schon LF) | SQLite: gemeinfrei; JavaScript-Hülle von sqlite.org: gemeinfrei, Emscripten-Anteile MIT/NCSA (Kopf der `.mjs`); SQLite3 Multiple Ciphers: MIT (`LICENSE-sqlite3mc.txt`) |
| `web-llm.js` | `@mlc-ai/web-llm` 0.2.85 (npm), `lib/index.js`, einzige Änderung: Zeilenenden CRLF zu LF (210 Zeilen in Lizenzkommentaren und Hilfscode; für JavaScript bedeutungsgleich) | Apache 2.0 (`LICENSE-web-llm.txt`), enthält `loglevel` 1.9 (MIT, `LICENSE-loglevel.txt`), TVM-Laufzeit und XGrammar (beide Apache 2.0) |

SHA-256 von `sqlite3.mjs`: `058b526608afdd81c244540f525286275d7bcc6a11676d19fdda7be50502f10e`,
von `sqlite3.wasm`: `b6aedab9eee5cd5de0f13498e0bf64bb5ee9cc786d1d0303cc365578b64d18ab`
(die Prüfung `umstellung` hält beide fest; `../sqlwerk.js` prüft die `.wasm` vor dem Start noch einmal).

SHA-256 von `web-llm.js` (mit LF): `a79b021e27e3048de514a2913bfb55800ddb31b1bd82eb38ba91f9b51b602e1f`; das Original aus npm hat `341bae95822bfee1d0fd6a0e6cd2db8613bb8edf809390ac142fba36ec17792c`
(die Prüfung `assistent` hält den Wert fest; wer die Datei austauscht, trägt ihn dort nach).

**SQLite** läuft nur im Rechenwerk der Datenbank (`../sqlwerk.js`, ein eigener
Worker) und nur, solange die Buchhaltung offen ist. Dort lässt eine Sperre
keinen Netzzugriff zu außer dem Laden der eigenen `.wasm`-Datei. Verschlüsselt
wird jede Seite der Datenbank (ChaCha20-Poly1305 von SQLite3 Multiple Ciphers)
mit einem Schlüssel, der aus dem Datenschlüssel des Tresors abgeleitet ist;
auf dem Gerät liegt nichts im Klartext. Speicher ist das private Dateisystem
des Browsers (OPFS, Weg „opfs-sahpool“), immer mit `journal_mode=WAL` und
`locking_mode=EXCLUSIVE`: Mit dem Rückroll-Journal verliert SQLite 3.53.4 auf
diesem Weg bei einem Abbruch mitten im Schreiben die Datenbank (der Weg meldet
immer eine fremde Sperre, ein liegengebliebenes Journal wird nie zurückgespielt;
nachgestellt am 07.10.2026). Neue Fassung erst übernehmen, wenn die Prüfungen
`umstellung` und der Selbsttest (Abbruch beim Schreiben) grün sind.

**WebLLM** wird nur im Rechenwerk des Assistenten (`../ki-worker.js`) geladen
und erst, wenn jemand ein Modell bewusst herunterlädt oder startet. Dort leitet
eine Sperre jeden Netzzugriff über `netz.js: modellAdresseErlaubt`.

Die Prüfungen (Syntax, Texte) lassen den Ordner `vendor` aus.

Aktualisieren, SQLite: die `-wasm.zip` des neuen Releases laden, Prüfsumme mit
der signierten `SHA256SUMS` vergleichen, beide Dateien hierher kopieren,
Prüfsummen hier, in `../sqlwerk.js` (`WASM_SHA256`) und in
`scripts/pruefungen/umstellung.test.js` nachtragen. Das Dateiformat der
verschlüsselten Datenbank darf sich dabei nicht ändern (`cipher=chacha20`,
`legacy=0`, `kdf_iter=64007` sind in `../sqlkern.js` fest eingestellt).

Aktualisieren, WebLLM: `npm pack @mlc-ai/web-llm@<fassung>`, `lib/index.js` hierher
kopieren, CRLF zu LF wandeln (Git und der Bau tun es sonst unbemerkt), Prüfsumme hier und in `scripts/pruefungen/assistent.test.js`
nachtragen, Modellfassungen in `../kimodelle.js` prüfen.
