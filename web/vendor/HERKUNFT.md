# Fremder Programmcode in Kontovia

Kontovia kommt sonst ohne fremden Code aus. Es gibt genau drei Ausnahmen, alle
für Dinge, die sich nicht sinnvoll selbst schreiben lassen: die Datenbank, in
der die Buchhaltung liegt (SQLite), die Laufzeit für den Assistenten (ein
Sprachmodell auf dem Grafikchip des Geräts) und die Texterkennung für Fotos von
Belegen (Tesseract, seit 2.35, Nutzerentscheid vom 12.10.2026).

| Datei | Herkunft | Lizenz |
|---|---|---|
| `sqlite3.mjs`, `sqlite3.wasm` | SQLite3 Multiple Ciphers 2.5.1 auf SQLite 3.53.4, Release-Datei `sqlite3mc-2.5.1-sqlite-3.53.4-wasm.zip` von https://github.com/utelle/SQLite3MultipleCiphers/releases/tag/v2.5.1 (SHA-256 der ZIP-Datei `761a41b8dc996cfa21f193fc044739fbb0c4a31a1fd657a4df49cc59085577ce`, wie in der signierten `sqlite3mc-2.5.1-SHA256SUMS`), daraus `sqlite3mc-wasm-3530400/jswasm/sqlite3.mjs` und `sqlite3.wasm`, unverändert (die `.mjs` hat schon LF) | SQLite: gemeinfrei; JavaScript-Hülle von sqlite.org: gemeinfrei, Emscripten-Anteile MIT/NCSA (Kopf der `.mjs`); SQLite3 Multiple Ciphers: MIT (`LICENSE-sqlite3mc.txt`) |
| `web-llm.js` | `@mlc-ai/web-llm` 0.2.85 (npm), `lib/index.js`, einzige Änderung: Zeilenenden CRLF zu LF (210 Zeilen in Lizenzkommentaren und Hilfscode; für JavaScript bedeutungsgleich) | Apache 2.0 (`LICENSE-web-llm.txt`), enthält `loglevel` 1.9 (MIT, `LICENSE-loglevel.txt`), TVM-Laufzeit und XGrammar (beide Apache 2.0) |
| `tesseract/tesseract.esm.min.js`, `tesseract/worker.min.js` | `tesseract.js` 6.0.1 (npm), `dist/`, unverändert (schon LF) | Apache 2.0 (`tesseract/LICENSE-tesseract.js.md`); im Worker gebündelt: buffer, ieee754, regenerator-runtime, zlib.js (MIT/BSD, `tesseract/LICENSE-worker-bestandteile.txt`) |
| `tesseract/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core` 6.0.0 (npm), unverändert: Tesseract 5 und Leptonica als WebAssembly (in der Datei eingebettet), nur LSTM, mit SIMD | Apache 2.0 (`tesseract/LICENSE-tesseract.js-core.txt`; Tesseract und Leptonica: Apache 2.0 bzw. BSD-artig) |
| `tesseract/deu.traineddata.gz` | `@tesseract.js-data/deu` 1.0.0 (npm), `4.0.0_best_int/deu.traineddata.gz`, unverändert (aus tessdata_best von tesseract-ocr, ganzzahlig) | Paket MIT; Sprachdaten von tesseract-ocr: Apache 2.0 |
| `tesseract/eng.traineddata.gz` | `@tesseract.js-data/eng` 1.0.0 (npm), `4.0.0_best_int/eng.traineddata.gz`, unverändert (seit 13.10.2026, Nutzerentscheid; geladen mit `npm pack`, dieselbe Quelle wie `deu`: deren Datei aus demselben Weg hat die Prüfsumme unten) | Paket MIT; Sprachdaten von tesseract-ocr: Apache 2.0 |

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

SHA-256 der Texterkennung (die Prüfung `beleglesen` hält sie fest):
`tesseract.esm.min.js` `da6267cfe5036ae718a59eece3b5744a4655b0b8faa9f16259362b783d74c9bb`,
`worker.min.js` `38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842`,
`tesseract-core-simd-lstm.wasm.js` `9d7c43fb206dc9f48475228b46bf35f888fa9e6259da2e67d5a75c77049f2dc7`,
`deu.traineddata.gz` `306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b`,
`eng.traineddata.gz` `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`.

**Tesseract** läuft nur im Rechenwerk der Texterkennung (`../ocr-worker.js`, ein
eigener klassischer Worker) und nur, wenn jemand ein Foto oder einen Scan als Beleg
anhängt. Dort lässt eine Sperre `fetch` und `importScripts` nur für die Dateien in
`tesseract/` zu; XMLHttpRequest, WebSocket, EventSource und WebTransport gibt es
dort nicht. Pfade setzt `../ocr.js` ausdrücklich (sonst nähme Tesseract ein CDN),
ohne Blob-Worker und ohne eigenen Zwischenspeicher im Browser. Das Bild verlässt
das Gerät nie. Ohne SIMD (sehr alte Browser) gibt es keine Texterkennung; der
Rechenkern ohne SIMD ist bewusst nicht dabei (noch einmal 4 MB).

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

Aktualisieren, Tesseract: `npm pack tesseract.js@<fassung> tesseract.js-core@<passend> @tesseract.js-data/deu @tesseract.js-data/eng`
in einen leeren Ordner, die fünf Dateien oben unverändert nach `tesseract/`, Prüfsummen hier und in
`scripts/pruefungen/beleglesen.test.js` nachtragen; prüfen, dass `worker.min.js` weiter nur über
`fetch`/`importScripts` lädt (sonst greift die Sperre in `../ocr-worker.js` nicht) und die Optionen in `../ocr.js` noch gelten.

Aktualisieren, WebLLM: `npm pack @mlc-ai/web-llm@<fassung>`, `lib/index.js` hierher
kopieren, CRLF zu LF wandeln (Git und der Bau tun es sonst unbemerkt), Prüfsumme hier und in `scripts/pruefungen/assistent.test.js`
nachtragen, Modellfassungen in `../kimodelle.js` prüfen.
