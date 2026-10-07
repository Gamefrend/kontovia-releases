/**
 * Kontovia – Assistent: Anleitung, wie man den Grafikchip im Browser freigibt.
 *
 * Die Sprachmodelle des Assistenten rechnen auf dem Grafikchip. Manche
 * Browser geben ihn nicht frei: die Grafikbeschleunigung ist aus, der Chip
 * steht auf der Sperrliste des Browsers, oder die Schnittstelle dafür gilt
 * dort noch als Test (Chrome unter Linux, ältere Safari, Firefox außerhalb
 * von Windows).
 *
 * Eine Webseite kann das nicht selbst umstellen, auch nicht als installierte
 * App: Startparameter wie --enable-gpu und --ignore-gpu-blocklist, die Seiten
 * chrome://flags und chrome://settings gehören dem Browser, und Verweise
 * dorthin öffnet er aus einer Seite heraus nicht. Darum stellt diese Datei
 * die Schritte für den erkannten Browser zusammen, mit Adressen und Zusätzen
 * zum Kopieren, und der Nutzer stellt sie selbst um. Angezeigt werden sie als
 * Hinweisblase in Schritten (lib/hinweisblase.js) am Assistenten
 * (lib/assistentfenster.js).
 *
 * Rein: kein DOM, kein Speicher. Prüfung `assistent`.
 */

/** Was den Grafikchip zurückhält, aus api.ki.geraet(): '' heißt, er ist frei. */
export function grafikGrund(g) {
  if (!g) return 'schnittstelle';
  if (g.grafik && !g.ersatz) return '';
  if (g.grund) return g.grund;
  return g.ersatz ? 'ersatz' : 'adapter';
}

export const grafikHilfeNoetig = (g) => grafikGrund(g) !== '';

/** Startzusatz für die Verknüpfung (Windows), wie gewünscht mit --enable-gpu und --ignore-gpu-blocklist. */
export function startZusatz(grund) {
  return ['--enable-gpu', '--ignore-gpu-blocklist', ...(grund === 'schnittstelle' ? ['--enable-unsafe-webgpu'] : [])].join(' ');
}

const NAMEN = {
  chrome: 'Chrome', edge: 'Edge', opera: 'Opera', brave: 'Brave', vivaldi: 'Vivaldi', samsung: 'Samsung Internet',
  chromium: 'Chromium', firefox: 'Firefox', safari: 'Safari', andere: 'Ihr Browser',
};
/** Vor „://flags“ und „://gpu“: jeder Chromium-Browser hat seine eigene Vorsilbe. */
const SCHEMA = { chrome: 'chrome', chromium: 'chrome', edge: 'edge', opera: 'opera', brave: 'brave', vivaldi: 'vivaldi', samsung: 'internet' };

/**
 * Browser und System aus den Angaben des Browsers.
 * @param {{ua?:string, marken?:string[], brave?:boolean, beruehrung?:number}} a
 *   ua: navigator.userAgent; marken: navigator.userAgentData.brands[].brand;
 *   brave: ob navigator.brave da ist; beruehrung: navigator.maxTouchPoints (iPad meldet sich als Mac)
 * @returns {{browser:string, name:string, system:string, chromium:boolean, schema:string}}
 */
export function browserErkennen({ ua = '', marken = [], brave = false, beruehrung = 0 } = {}) {
  const m = marken.map((x) => String(x).toLowerCase());
  let system = 'andere';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && beruehrung > 1)) system = 'ios';
  else if (/Android/.test(ua)) system = 'android';
  else if (/CrOS/.test(ua)) system = 'chromeos';
  else if (/Windows/.test(ua)) system = 'windows';
  else if (/Mac OS X|Macintosh/.test(ua)) system = 'mac';
  else if (/Linux/.test(ua)) system = 'linux';

  let browser = 'andere';
  // Auf iPhone und iPad rechnet in jedem Browser Safari; die Schalter liegen dort.
  if (system === 'ios') browser = 'safari';
  else if (m.includes('microsoft edge') || /Edg(A|iOS)?\//.test(ua)) browser = 'edge';
  else if (m.includes('opera') || /OPR\//.test(ua)) browser = 'opera';
  else if (brave || m.includes('brave')) browser = 'brave';
  else if (/Vivaldi/.test(ua)) browser = 'vivaldi';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/Firefox\//.test(ua)) browser = 'firefox';
  else if (m.includes('chromium') && !m.includes('google chrome')) browser = 'chromium';
  else if (m.includes('google chrome') || /Chrome\//.test(ua)) browser = 'chrome';
  else if (/Safari\//.test(ua)) browser = 'safari';

  return { browser, name: NAMEN[browser], system, chromium: !!SCHEMA[browser], schema: SCHEMA[browser] || '' };
}

/**
 * Die Schritte für diesen Browser.
 * @param {{browser:string, name:string, system:string, chromium:boolean, schema:string}} b  aus browserErkennen
 * @param {{grund?:string, appFenster?:boolean}} [o]
 *   grund: schnittstelle | adapter | ersatz | absturz (das Modell ist auf dem Chip gescheitert);
 *   appFenster: Kontovia läuft als installierte App (ohne Adresszeile)
 * @returns {Array<{id:string, titel:string, text:string, adresse?:string, eintrag?:string, wert?:string, zusatz?:string}>}
 */
export function grafikAnleitung(b, { grund = 'adapter', appFenster = false } = {}) {
  const { name, system, schema } = b;
  const schritte = [];
  const fenster = appFenster
    ? ` Die Adressen öffnen Sie in einem normalen Fenster von ${name}, nicht im Fenster von Kontovia.`
    : '';
  const einstieg = {
    schnittstelle: `${name} gibt den Grafikchip auf diesem Gerät noch nicht für Webseiten frei. Die Stufen ab Mini brauchen ihn.`,
    adapter: `${name} hält den Grafikchip zurück, meist weil die Grafikbeschleunigung aus ist oder der Chip auf seiner Sperrliste steht. Die Stufen ab Mini brauchen ihn.`,
    ersatz: `${name} rechnet hier nur mit einem Ersatz ohne Grafikchip, meist weil die Grafikbeschleunigung aus ist. Die Stufen ab Mini brauchen den echten Chip.`,
    absturz: 'Der Grafikchip hat das Modell nicht geschafft. Meist hilft eine kleinere Stufe. Bremst der Browser den Chip aus, helfen diese Schritte.',
  }[grund] || '';
  schritte.push({
    id: 'warum',
    titel: grund === 'absturz' ? 'Das Modell lief nicht' : 'Der Grafikchip ist aus',
    text: `${einstieg} Kontovia darf das nicht selbst umstellen, mit ein paar Klicks geht es aber.${fenster}`,
  });

  const oeffnen = 'Adresse kopieren, in einem neuen Tab in die Adresszeile einfügen und Enter drücken.';
  const neustart = (extra = '') => ({
    id: 'neustart',
    titel: `${name} neu starten`,
    text: `Alle Fenster von ${name} schließen, auch das von Kontovia, und neu öffnen.${extra} Danach entsperren Sie Kontovia wie gewohnt, und der Assistent prüft den Grafikchip neu.`,
  });

  if (b.chromium) {
    const desktop = ['windows', 'mac', 'linux'].includes(system);
    if (desktop) {
      const adresse = ['chrome', 'chromium', 'edge', 'brave'].includes(b.browser) ? `${schema}://settings/system` : '';
      schritte.push({
        id: 'beschleunigung',
        titel: 'Grafikbeschleunigung einschalten',
        text: adresse
          ? `${oeffnen} Dort den Schalter „Grafikbeschleunigung verwenden …“ einschalten (in manchen Fassungen heißt er „Hardwarebeschleunigung“).`
          : 'In den Einstellungen des Browsers nach „Beschleunigung“ suchen und den Schalter „Grafikbeschleunigung“ oder „Hardwarebeschleunigung“ einschalten.',
        ...(adresse ? { adresse } : {}),
      });
    }
    schritte.push({
      id: 'sperrliste',
      titel: 'Sperrliste übergehen',
      text: `Der Browser schaltet den Chip auf manchen Geräten vorsichtshalber ab. ${oeffnen} Beim markierten Eintrag rechts den angegebenen Wert wählen.`,
      adresse: `${schema}://flags/#ignore-gpu-blocklist`,
      eintrag: 'Override software rendering list',
      wert: 'Enabled',
    });
    if (grund === 'schnittstelle' || system === 'linux') {
      schritte.push({
        id: 'schnittstelle',
        titel: 'Grafikchip für Webseiten freigeben',
        text: `${oeffnen} Beim markierten Eintrag den angegebenen Wert wählen. „Unsafe“ heißt hier: Der Browser erprobt die Funktion auf diesem System noch. Sie gilt dann für alle Webseiten.`,
        adresse: `${schema}://flags/#enable-unsafe-webgpu`,
        eintrag: 'Unsafe WebGPU Support',
        wert: 'Enabled',
      });
    }
    if (system === 'linux') {
      schritte.push({
        id: 'vulkan',
        titel: 'Unter Linux zusätzlich',
        text: `Unter Linux braucht ${name} dafür noch diesen Eintrag. ${oeffnen}`,
        adresse: `${schema}://flags/#enable-vulkan`,
        eintrag: 'Vulkan',
        wert: 'Enabled',
      });
    }
    schritte.push(neustart(` Auf der Seite mit den Einträgen geht das auch mit „Relaunch“ unten rechts.${system === 'windows' ? ' Läuft der Browser im Hintergrund weiter, beenden Sie ihn über sein Symbol unten rechts in der Taskleiste.' : ''}`));
    if (system === 'windows') {
      schritte.push({
        id: 'verknuepfung',
        titel: 'Klappt es noch nicht?',
        text: `Rechtsklick auf die Verknüpfung von Kontovia oder von ${name}, dann „Eigenschaften“. Im Feld „Ziel“ ganz ans Ende, nach einem Leerzeichen, diesen Zusatz einfügen und mit „OK“ bestätigen. Danach ${name} ganz schließen und über diese Verknüpfung starten.`,
        zusatz: startZusatz(grund),
      });
    }
    schritte.push({
      id: 'pruefen',
      titel: 'Nachsehen, ob es läuft',
      text: `${oeffnen} Unter „Graphics Feature Status“ sollte bei „WebGPU“ „Hardware accelerated“ stehen. Steht dort etwas anderes, schafft der Chip die Modelle nicht. Die Stufe Basis funktioniert trotzdem, ganz ohne Grafikchip.`,
      adresse: `${schema}://gpu`,
    });
    return schritte;
  }

  if (b.browser === 'firefox' && system !== 'android') {
    schritte.push({
      id: 'beschleunigung',
      titel: 'Hardwarebeschleunigung einschalten',
      text: `${oeffnen} Unter „Leistung“ das Häkchen bei „Empfohlene Leistungseinstellungen verwenden“ entfernen und „Hardwarebeschleunigung verwenden, wenn verfügbar“ anhaken.`,
      adresse: 'about:preferences#general',
    });
    schritte.push({
      id: 'schnittstelle',
      titel: 'Grafikchip für Webseiten freigeben',
      text: `${oeffnen} Die Warnung mit „Risiko akzeptieren und fortfahren“ bestätigen, oben nach dem Eintrag suchen und ihn mit einem Doppelklick auf den angegebenen Wert stellen.`,
      adresse: 'about:config',
      eintrag: 'dom.webgpu.enabled',
      wert: 'true',
    });
    schritte.push({
      id: 'sperrliste',
      titel: 'Sperrliste übergehen',
      text: 'Auf derselben Seite auch diesen Eintrag suchen und auf den angegebenen Wert stellen.',
      adresse: 'about:config',
      eintrag: 'gfx.webgpu.ignore-blocklist',
      wert: 'true',
    });
    schritte.push(neustart());
    return schritte;
  }

  if (b.browser === 'safari') {
    schritte.push({
      id: 'aktualisieren',
      titel: system === 'ios' ? 'iOS aktualisieren' : 'macOS aktualisieren',
      text: system === 'ios'
        ? 'Ab iOS 26 gibt Safari den Grafikchip von selbst frei. Aktualisieren unter Einstellungen › Allgemein › Softwareupdate.'
        : 'Ab macOS 26 gibt Safari den Grafikchip von selbst frei. Aktualisieren unter Systemeinstellungen › Allgemein › Softwareupdate.',
    });
    schritte.push({
      id: 'schnittstelle',
      titel: 'Oder in Safari einschalten',
      text: system === 'ios'
        ? 'Einstellungen › Apps › Safari › Erweitert › Funktionsflags (auf älteren Geräten „Experimentelle Funktionen“), dort den Eintrag einschalten.'
        : 'In Safari unter Einstellungen › Erweitert „Funktionen für Webentwickler anzeigen“ anhaken. Dann in der Menüleiste Entwickler › Funktionsflags, dort den Eintrag anhaken.',
      eintrag: 'WebGPU',
    });
    schritte.push(neustart(system === 'ios' ? ' Auf dem iPhone oder iPad dazu Safari aus der App-Übersicht nach oben wischen.' : ' Auf dem Mac dazu Safari mit Befehl+Q beenden.'));
    return schritte;
  }

  // Firefox auf Android und unbekannte Browser: Umstellen geht dort nicht verlässlich.
  schritte.push({
    id: 'anderer',
    titel: 'Einen anderen Browser nehmen',
    text: `Am zuverlässigsten läuft der Assistent in einem aktuellen Chrome oder Edge${system === 'android' ? ' auf Android' : ''}. Ihre Daten nehmen Sie über die Cloud oder eine Vollsicherung mit. Die Stufe Basis funktioniert auch hier, ganz ohne Grafikchip.`,
  });
  return schritte;
}
