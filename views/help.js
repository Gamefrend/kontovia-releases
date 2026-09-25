/** Kontovia – Kurzanleitung, Cloud-Einrichtung und rechtliche Hinweise. */

import { html, raw, esc, $, $$ } from '../lib/util.js';
import { icon, err } from '../lib/ui.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { appInfo } from '../app.js';

const api = window.kontovia;
/** Läuft Kontovia im Browser statt in Electron? (src/web/bridge.js) */
const WEB = api.platform === 'web';
let tab = 'anleitung';

const TABS = { anleitung: 'Kurzanleitung', cloud: 'Cloud einrichten', recht: 'Rechtliches' };

export async function render(root, params = {}) {
  if (params.tab) tab = params.tab;
  root.innerHTML = html`
    <div class="seg mb16" id="helpTabs">
      ${raw(Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(v)}</button>`).join(''))}
    </div>
    <div id="helpBody" class="help"></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(root); }));
  ({ anleitung, cloud, recht }[tab] || anleitung)($('#helpBody', root));
  // Sprung zu einem Abschnitt, etwa aus der Export-Ansicht.
  // Ohne Animation: die wird bei verdecktem Fenster ausgesetzt, der Sprung bliebe dann aus.
  if (params.anker) setTimeout(() => $(`#recht-${params.anker}`, root)?.scrollIntoView({ block: 'start' }), 60);
}

/* -------------------------------------------------------------------------- */

function anleitung(root) {
  const s = store.db.settings;
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <div class="card"><div class="card-body">
        <h3 class="mt0">In fünf Minuten startklar</h3>
        <ol>
          <li><strong>Konto anlegen.</strong> Unter <a data-go="master">Stammdaten → Zahlungskonten</a> tragen Sie
              Ihr Geschäftskonto mit dem Anfangsbestand ein – dem Saldo an dem Tag, ab dem Sie
              mit Kontovia buchen. Sonst stimmen die Kontostände nicht.</li>
          <li><strong>Erste Ausgabe erfassen.</strong> <kbd>Strg</kbd>+<kbd>N</kbd> öffnet den Dialog.
              Beschreibung, Datum, Kategorie, Betrag – fertig. Den Beleg ziehen Sie einfach
              per Maus ins Fenster.</li>
          <li><strong>Rechnungen stellen.</strong> Eine Einnahme mit gesetzter Fälligkeit und ohne
              Zahldatum gilt als offene Forderung und taucht in der Übersicht und im Kalender auf.</li>
          <li><strong>Auswerten.</strong> Unter <a data-go="reports">Auswertungen</a> sehen Sie Gewinn,
              Umsatzsteuer und Vermögen für jeden beliebigen Zeitraum.</li>
          <li><strong>Abgeben.</strong> Unter <a data-go="export">Export</a> erzeugen Sie einen Ordner
              mit allen Zahlen für ELSTER und für Ihre Steuerkanzlei.</li>
        </ol>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Die zwei Weichen, die alles bestimmen</h3>
        <p><strong>Zahlungsfluss oder Rechnungsdatum.</strong> Bei der Einnahmen-Überschuss-Rechnung
        zählt eine Buchung erst dann, wenn das Geld tatsächlich geflossen ist (§ 11 EStG).
        Eine im Dezember gestellte, im Januar bezahlte Rechnung gehört also ins neue Jahr.
        Bei Ihnen ist eingestellt: <strong>${esc(s.accountingBasis === 'ist' ? 'nach Zahlungsfluss' : 'nach Rechnungsdatum')}</strong>.</p>
        <p><strong>Regelbesteuerung oder Kleinunternehmer.</strong> Als Kleinunternehmer nach § 19 UStG
        rechnen Sie durchgehend brutto, weisen keine Umsatzsteuer aus und ziehen keine Vorsteuer.
        Bei Ihnen ist eingestellt: <strong>${esc(s.taxMode === 'kleinunternehmer' ? 'Kleinunternehmer § 19 UStG' : 'Regelbesteuerung')}</strong>.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Belege – der häufigste Streitpunkt mit dem Finanzamt</h3>
        <p>Keine Betriebsausgabe ohne Beleg. Kontovia speichert jede Rechnung verschlüsselt im
        Tresor und merkt sich eine SHA-256-Prüfsumme, mit der sich später nachweisen lässt,
        dass die Datei unverändert ist. Auf der Übersicht sehen Sie Ihre Belegquote.</p>
        <p>Bei Bewirtungskosten gehört der betriebliche Anlass und die Teilnehmerliste dazu –
        schreiben Sie beides ins Notizfeld. Kontovia zieht davon automatisch nur 70 % ab.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Anschaffungen über 800 €</h3>
        <p>Ein Notebook für 1.500 € ist im Jahr des Kaufs nicht in voller Höhe abziehbar, sondern
        wird über die Nutzungsdauer verteilt – bei Computern drei Jahre. Beim Erfassen der
        Ausgabe wählen Sie „Als Anlagegut abschreiben". Kontovia rechnet die Abschreibung dann
        monatsgenau aus, führt das Anlagenverzeichnis und trägt den Betrag in Zeile 31 der
        Anlage EÜR ein.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Anzahlungen und der Ort der Leistung</h3>
        <p>Bei einer Einnahme lässt sich der <strong>Ort</strong> festhalten – wo die Leistung
        erbracht wurde. Bereits verwendete Orte schlägt das Feld vor, und in der
        <a data-go="transactions">Buchungsliste</a> filtern Sie danach – über den Trichter im
        Kopf der Spalte <em>Beschreibung</em>.</p>
        <p>Wird nur ein Teil im Voraus bezahlt, setzen Sie das Häkchen bei
        <strong>Anzahlung</strong> und tragen den Termin der Veranstaltung – bei einer Hochzeit
        das Hochzeitsdatum – sowie den Anteil in Prozent ein. Aus Anzahlung und Anteil
        errechnet Kontovia den vereinbarten Gesamtbetrag und den Restbetrag und legt auf Wunsch
        gleich die offene Restzahlung zum Veranstaltungstag an. Der Termin erscheint im
        <a data-go="calendar">Kalender</a>.</p>
        <p class="small">Steuerlich zählt die Anzahlung bei der Einnahmen-Überschuss-Rechnung im
        Jahr des Zuflusses – also dann, wenn das Geld eingeht, nicht erst zur Veranstaltung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Termine und Rechnungen zusammenhalten</h3>
        <p>Im <a data-go="calendar">Kalender</a> verknüpfen Sie einen Termin mit einer oder mehreren
        Buchungen – etwa den Montagetermin mit der Rechnung dazu. Zusätzlich blendet der
        Kalender die Fälligkeiten offener Rechnungen ein.</p>
        ${WEB ? raw(`<p><strong>Mit anderen Kalendern abgleichen:</strong> Über <em>Abgleich</em> oben im
        Kalender exportieren Sie alle Termine als Kalenderdatei (.ics) für Google, Apple oder Outlook
        und holen Termine von dort herein. Den laufenden Abgleich mit Google Kalender gibt es nur in
        der Windows-Fassung.</p>`) : raw(`<p><strong>Google Kalender:</strong> Unter <em>Abgleich</em> oben im
        Kalender oder unter Einstellungen → Kalender-Abgleich verbinden Sie Kontovia mit Ihrem
        Google-Konto. Kontovia legt dort einen eigenen Kalender „Kontovia“ an und gleicht in beide
        Richtungen ab – auf dem Telefon sehen Sie Ihre Termine in der Google-Kalender-App, und was
        Sie dort im Kalender „Kontovia“ eintragen, erscheint hier. Ihre anderen Kalender sieht
        Kontovia nicht. Beträge, Buchungen und Kontakte gehen nie an Google. Ohne Google-Konto
        geht es per Kalenderdatei (.ics).</p>`)}
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Zeitraum wählen und filtern</h3>
        <p><strong>Zeitraum.</strong> Oben rechts steht der gewählte Zeitraum, etwa „Jahr ${esc(String(new Date().getFullYear()))}“.
        Die Pfeile daneben blättern um genau diese Länge weiter – vom März zum April, vom
        2. zum 3. Quartal, von einem Jahr ins nächste. Ein Klick auf den Zeitraum öffnet die
        Schnellwahl (dieser Monat, letztes Quartal …), ein Raster zum direkten Anklicken von
        Jahr, Quartal oder Monat und darunter zwei Felder für einen eigenen Zeitraum.</p>
        <p><strong>Filter in den Spaltenköpfen.</strong> In der <a data-go="transactions">Buchungsliste</a>
        filtern Sie dort, wo die Werte stehen: über den kleinen Trichter im Kopf der Spalten
        <em>Kategorie</em>, <em>Kontakt</em>, <em>Status</em> (offen, bezahlt, überfällig, dazu stornierte und
        nicht gelistete Buchungen), <em>Brutto</em> (nur Einnahmen oder nur Ausgaben), im Kopf der
        Belegspalte (mit oder ohne Beleg) und – sobald Orte erfasst sind – bei <em>Beschreibung</em>.
        Neben jeder Möglichkeit steht, wie viele Buchungen sie ergibt. Ein Klick auf den
        Spaltennamen sortiert.</p>
        <p>Was gerade gefiltert ist, steht als Chip über der Liste; das Kreuz im Chip hebt den
        Filter auf, „Alle Filter zurücksetzen“ alle zusammen. Ein gesetzter Filter färbt außerdem
        seinen Trichter ein.</p>
        <p><strong>Sortieren.</strong> Alle Listen – Buchungen, Kategorien, Kontakte, Konten,
        Anlagen, offene Posten, die Kategorien der Gewinn- und Verlustrechnung, die Monatstabelle
        und das Änderungsjournal – lassen sich nach jeder Spalte sortieren: ein Klick auf den
        Spaltennamen mit dem Doppelpfeil sortiert, ein zweiter kehrt die Richtung um; der farbige
        Pfeil zeigt, wonach gerade sortiert ist. Über größeren Listen nennt der Knopf
        <em>Sortieren</em> die Sortierung in Worten („Datum: neueste zuerst“) und bietet Spalte und
        Richtung zur Wahl – praktisch auf dem Telefon, wo nicht alle Spalten ins Bild passen.
        Kontovia merkt sich die Sortierung jeder Liste auf diesem Gerät. Aufstellungen mit fester
        Reihenfolge wie die Zeilen der Anlage EÜR oder die Kontenblätter mit laufendem Saldo
        bleiben bewusst unsortiert.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Die Übersicht anpassen</h3>
        <p>Über <strong>Anpassen</strong> oben in der <a data-go="dashboard">Übersicht</a> ordnen Sie die
        Module so, wie Sie arbeiten: mit der Maus an einen anderen Platz ziehen oder mit den Pfeilen
        verschieben, die Breite von einem Viertel bis zur ganzen Zeile wählen, Nicht-Benötigtes
        ausblenden. Ausgeblendete Module und zusätzliche wie <em>Letzte Buchungen</em>,
        <em>Durchschnittswerte</em> oder <em>Kontostände heute</em> holen Sie über die Knöpfe oben im
        Anpassen-Modus zurück. „Voreinstellung“ stellt die ursprüngliche Anordnung wieder her.</p>
        <p class="small">Die Anordnung gilt für dieses Gerät – am Telefon passt oft eine andere als am
        großen Bildschirm. In den Tresor und den Cloud-Abgleich geht sie nicht.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Diagramme und Durchschnittswerte</h3>
        <p>In der <a data-go="dashboard">Übersicht</a> und unter <a data-go="reports">Auswertungen</a>
        schalten Sie die Darstellung mit den Knöpfen im Kopf jeder Karte um – unabhängig vom
        Zeitraum oben: den Verlauf als <strong>Säulen</strong>, <strong>Linien</strong>,
        <strong>aufgelaufene Summen</strong> oder <strong>Tabelle</strong>, die Aufteilung nach
        Kategorien als <strong>Balken</strong> oder <strong>Torte</strong>. Die Wahl merkt sich
        Kontovia auf diesem Gerät.</p>
        <p>Durchschnittswerte stehen unter den Kennzahlen (Ø je Monat), als gestrichelte Linie im
        Verlauf und in der Karte <em>Durchschnittswerte</em> der Gewinn- und Verlustrechnung – dort
        auch je Buchung sowie bester und schwächster Monat. Gemittelt wird über die Monate, die
        schon begonnen haben; im laufenden Jahr also nicht über zwölf.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Nicht gelistete Buchungen</h3>
        <p>Im Buchungsdialog lässt sich eine Buchung als <strong>nicht gelistet</strong> kennzeichnen –
        für Vorgänge, die Sie für die eigene Übersicht festhalten wollen, die steuerlich aber nicht
        zum Betrieb gehören. Nicht gelistete Buchungen fehlen in allen Unterlagen für Finanzamt und
        Steuerkanzlei: EÜR, Umsatzsteuer, DATEV-Stapel, Prüfungsordner, Buchungsjournal.</p>
        <p>In Übersicht und Auswertungen zählen sie nur mit, wenn Sie dort oben den Schalter
        <strong>„Nicht gelistete einbeziehen“</strong> setzen. Die Zahl daneben nennt, wie viele es
        im gewählten Zeitraum gibt; die Beträge stehen im Hinweis beim Darüberfahren. Der Schalter
        gilt bis zum Sperren. In der Buchungsliste zeigt ein Abzeichen, welche Buchung nicht
        gelistet ist, und der Filter im Kopf der Spalte <em>Status</em> blendet sie ein oder aus.</p>
        <p class="small">Wichtig: Betriebliche Einnahmen und Ausgaben müssen vollständig erklärt werden
        (§ 146 Abs. 1 AO). Das Änderungsjournal bleibt deshalb vollständig – es verzeichnet auch
        Änderungen an nicht gelisteten Buchungen, sonst wäre seine Prüfsummenkette unterbrochen.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Was beim Export herauskommt</h3>
        <ul>
          <li><strong>Anlage EÜR:</strong> Ihre Zahlen, sortiert nach den Zeilennummern des amtlichen
              Formulars. In „Mein ELSTER" nur noch abschreiben.</li>
          <li><strong>Umsatzsteuer-Voranmeldung:</strong> die Kennzahlen 81, 86, 66, 83 und weitere.</li>
          <li><strong>DATEV-Buchungsstapel:</strong> eine Datei, die Ihre Steuerkanzlei direkt einliest.</li>
          <li><strong>GoBD-Prüfungsordner:</strong> alle Daten maschinell auswertbar samt
              <code>index.xml</code> – das, was bei einer Betriebsprüfung verlangt wird.</li>
        </ul>
        <p class="small">Kontovia übermittelt <strong>nichts</strong> an die Finanzverwaltung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Tastenkürzel</h3>
        <table class="data compact">
          <tbody>
            <tr><td><kbd>Strg</kbd>+<kbd>N</kbd></td><td>Neue Buchung</td></tr>
            <tr><td><kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>N</kbd></td><td>Neuer Termin</td></tr>
            <tr><td><kbd>Strg</kbd>+<kbd>S</kbd></td><td>Sofort speichern</td></tr>
            <tr><td><kbd>Strg</kbd>+<kbd>F</kbd></td><td>In Buchungen suchen</td></tr>
            <tr><td><kbd>Strg</kbd>+<kbd>L</kbd></td><td>Sperren</td></tr>
            <tr><td><kbd>Strg</kbd>+<kbd>1</kbd> … <kbd>6</kbd></td><td>Zwischen den Ansichten wechseln</td></tr>
          </tbody>
        </table>
      </div></div>

      <div class="notice warn mt16">
        <strong>Kein Ersatz für Steuerberatung.</strong> Kontovia rechnet nach den üblichen Regeln
        der Einnahmen-Überschuss-Rechnung, kennt aber Ihren Einzelfall nicht. Zuordnungen zu
        EÜR-Zeilen, Kennzahlen und Konten sind Vorschläge. Die Verantwortung für das, was
        beim Finanzamt ankommt, bleibt bei Ihnen.
      </div>
    </div>`;
  wireLinks(root);
}

/* -------------------------------------------------------------------------- */

function cloud(root) {
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <div class="notice ok mb16">
        <strong>Für den normalen Gebrauch müssen Sie hier nichts tun.</strong> Das
        Firebase-Projekt ist bereits mitgeliefert. Gehen Sie einfach auf
        <a data-go="settings">Einstellungen → Cloud-Abgleich</a> und klicken Sie
        <strong>Mit Google verbinden</strong> – das war es.
      </div>

      <div class="notice mb16">
        <strong>Der Rest dieser Seite</strong> ist für den Fall, dass Sie ein
        <em>eigenes</em> Projekt betreiben wollen, etwa weil die Daten in Ihrer eigenen
        Hand liegen sollen. Kontovia kann den verschlüsselten Tresor entweder in ein
        <strong>Firebase-Projekt</strong> legen oder in das <strong>Google Drive</strong>
        jedes einzelnen Nutzers. In beiden Fällen geht nur Chiffretext raus – der
        Schlüssel bleibt auf dem Gerät.
      </div>

      <div class="card mb16"><div class="card-body">
        <h3 class="mt0">Welchen Weg nehmen?</h3>
        <table class="data">
          <thead><tr><th></th><th>Firebase</th><th>Google Drive</th></tr></thead>
          <tbody>
            <tr><td class="muted">Aufwand für Ihre Nutzer</td><td><strong>nur „mit Google anmelden“</strong></td><td>ebenfalls nur anmelden</td></tr>
            <tr><td class="muted">Prüfung durch Google nötig</td><td><strong>nein</strong></td><td>ja, sonst Warnhinweis</td></tr>
            <tr><td class="muted">Nutzerobergrenze</td><td><strong>keine</strong></td><td>100 ohne Prüfung</td></tr>
            <tr><td class="muted">Wo die Daten liegen</td><td>in Ihrem Projekt</td><td><strong>beim Nutzer selbst</strong></td></tr>
            <tr><td class="muted">Kosten</td><td>Kreditkarte nötig, real unter einem Euro im Monat bei 100 Nutzern</td><td><strong>keine</strong></td></tr>
            <tr><td class="muted">Ihre Rolle im Datenschutz</td><td>Sie halten fremde (verschlüsselte) Daten</td><td><strong>Sie halten nichts</strong></td></tr>
          </tbody>
        </table>
        <p class="small mt16 mb0"><strong>Für die Weitergabe an andere: Firebase.</strong>
        Der Grund ist die Prüfpflicht. Google stuft den Zugriff auf den Drive-Anwendungsordner
        als sensibel ein; ohne Überprüfung bleibt es bei 100 Nutzern und einem Warnhinweis im
        Anmeldedialog. Firebase braucht nur Name und E-Mail-Adresse – das ist unbedenklich und
        damit weder prüfpflichtig noch gedeckelt.
        <strong>Nur für sich selbst: Drive.</strong> Kostet nichts und Sie halten keine
        fremden Daten.</p>
      </div></div>

      ${WEB ? raw(`<div class="notice warn mb16">
        <strong>In der Web-Fassung (Browser, iPhone, iPad)</strong> meldet sich Kontovia
        anders bei Google an: Sie bekommen einen kurzen Code und geben ihn auf
        <code>google.com/device</code> ein. Dafür braucht es statt des Clients vom Typ
        <strong>Desktop-App</strong> einen vom Typ <strong>Fernseher und Geräte mit
        eingeschränkter Eingabe</strong> – angelegt an derselben Stelle wie unten in Schritt 5
        beschrieben, im selben Projekt. Beide Clients können nebeneinander bestehen; ein Konto,
        das am PC verbunden ist, sieht in der Web-Fassung denselben Tresor.
      </div>`) : ''}

      <div class="card"><div class="card-body">
        <h3 class="mt0">Firebase einrichten</h3>

        <h3>1 – Projekt anlegen</h3>
        <ol>
          <li><code>console.firebase.google.com</code> öffnen, <strong>Projekt hinzufügen</strong>,
              Name zum Beispiel <code>kontovia</code>.</li>
          <li>Google Analytics können Sie abwählen, es wird nicht gebraucht.</li>
        </ol>

        <h3>2 – Anmeldung einschalten</h3>
        <ol>
          <li><strong>Authentication → Jetzt starten</strong>.</li>
          <li>Bei den Anbietern <strong>Google</strong> aktivieren, Support-E-Mail wählen, speichern.</li>
        </ol>

        <h3>3 – Speicher anlegen</h3>
        <ol>
          <li><strong>Storage → Jetzt starten</strong>. Firebase verlangt dafür den
              Tarif <strong>Blaze</strong>, also eine hinterlegte Kreditkarte.</li>
          <li>Als Standort <strong><code>europe-west3</code> (Frankfurt)</strong> wählen.
              Das ist wichtiger als es aussieht: Ein Standort in der EU erspart die
              Diskussion um Drittlandübermittlung nach der DSGVO und passt zu
              § 146 Abs. 2a AO. Der Standort lässt sich später <strong>nicht</strong> ändern.</li>
          <li>Den angezeigten Speicherort notieren, etwa <code>kontovia-1234.firebasestorage.app</code>.</li>
        </ol>
        <div class="notice warn">
          <strong>Zu den Kosten.</strong> Der Tarif Blaze rechnet nach Verbrauch ab. Das
          kostenlose Kontingent gilt nur in US-Regionen – bei Frankfurt zahlen Sie ab dem
          ersten Byte, aber sehr wenig: rund 0,02 € je Gigabyte und Monat. Hundert Nutzer mit
          je 200 MB liegen bei etwa 0,50 € im Monat. Kontovia lädt den Tresor außerdem nur
          dann herunter, wenn sich tatsächlich etwas geändert hat – das hält die
          Übertragungsmengen klein. Legen Sie trotzdem unter
          <em>Google Cloud → Abrechnung → Budgets</em> eine Warnung bei etwa 5 € an.
        </div>

        <h3>4 – Zugriffsregeln setzen</h3>
        <ol>
          <li><strong>Storage → Regeln</strong> öffnen.</li>
          <li>Den Inhalt der Datei <code>firebase/storage.rules</code> aus dem
              Programmverzeichnis vollständig einfügen und veröffentlichen.</li>
        </ol>
        <p class="small">Ohne diesen Schritt ist der Speicher entweder für alle Angemeldeten
        offen oder ganz gesperrt. Die Regeln begrenzen jeden Zugriff auf den eigenen Zweig:
        Wer angemeldet ist, kommt an <code>tresore/&lt;eigene Kennung&gt;/</code> und sonst
        an nichts.</p>

        <h3>5 – Zugangsdaten für die Anwendung</h3>
        <ol>
          <li><strong>Projekteinstellungen → Allgemein</strong>: den
              <strong>Web-API-Schlüssel</strong> kopieren (beginnt mit <code>AIza…</code>).
              Er ist kein Geheimnis – die Absicherung leisten die Regeln aus Schritt 4.</li>
          <li>In der <strong>Google Cloud Console</strong> (dasselbe Projekt) unter
              <strong>APIs und Dienste → Anmeldedaten → Anmeldedaten erstellen →
              OAuth-Client-ID</strong> einen Client vom Typ <strong>Desktop-App</strong>
              anlegen. Client-ID und Client-Schlüssel kopieren.</li>
          <li>Beim OAuth-Zustimmungsbildschirm reichen App-Name und Ihre E-Mail-Adresse.
              Bereiche müssen Sie <strong>keine</strong> hinzufügen – Kontovia fragt nur
              Name und E-Mail an, und die sind nicht prüfpflichtig.
              Die App auf <strong>Veröffentlicht</strong> setzen, sonst laufen die
              Anmeldungen nach sieben Tagen ab.</li>
        </ol>

        <h3>6 – In Kontovia eintragen</h3>
        <ol>
          <li><a data-go="settings">Einstellungen → Cloud-Abgleich</a>, als Ablage
              <strong>Firebase</strong> wählen.</li>
          <li>Web-API-Schlüssel, Speicherort, Client-ID und Client-Schlüssel eintragen,
              speichern, dann <strong>Mit Google verbinden</strong>.</li>
        </ol>
        <p class="small muted">Es öffnet sich Ihr normaler Browser mit der Anmeldeseite von
        Google. Das ist Absicht: nur dort sehen Sie in der Adresszeile, wo Sie Ihr Passwort
        eingeben.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Google Drive einrichten</h3>
        <p>Kürzer, weil kein Speicher und keine Abrechnung nötig sind:</p>
        <ol>
          <li><code>console.cloud.google.com</code> → neues Projekt.</li>
          <li><strong>APIs und Dienste → Bibliothek</strong> → <strong>Google Drive API</strong> aktivieren.</li>
          <li><strong>OAuth-Zustimmungsbildschirm</strong>: Extern, App-Name, E-Mail,
              auf <strong>Veröffentlicht</strong> setzen.</li>
          <li><strong>Anmeldedaten</strong> → OAuth-Client-ID → <strong>Desktop-App</strong>.</li>
          <li>In <a data-go="settings">Einstellungen → Cloud-Abgleich</a> als Ablage
              <strong>Google Drive</strong> wählen und die beiden Werte eintragen.</li>
        </ol>
        <p class="small">Beim ersten Verbinden erscheint „Google hat diese App nicht überprüft“.
        Über <strong>Erweitert → Weiter zu Kontovia</strong> geht es weiter. Bis 100 Nutzer
        ist das ohne Überprüfung möglich.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Zweites Gerät anschließen</h3>
        <p>Installieren Sie Kontovia dort, legen Sie einen Tresor an (das Passwort ist
        zunächst egal) und tragen Sie dieselben Zugangsdaten ein. Beim Verbinden erkennt
        Kontovia, dass in der Cloud schon eine Buchhaltung liegt, und bietet
        <strong>Cloud-Stand übernehmen</strong> an. Danach melden Sie sich mit dem Passwort
        des ersten Geräts an – ab da arbeiten beide Rechner auf demselben Bestand.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Was passiert, wenn beide Geräte dasselbe ändern?</h3>
        <p>Kontovia vergleicht nicht die Datei, sondern jeden einzelnen Datensatz – und zwar
        gegen den letzten Stand, den beide Geräte gemeinsam hatten. Daraus ergibt sich:</p>
        <ul>
          <li>Änderung nur auf einer Seite → sie wird übernommen, ohne Nachfrage.</li>
          <li>Änderung auf beiden Seiten → die zuletzt bearbeitete Fassung gilt, die andere
              wird unter <em>Einstellungen → Konflikte ansehen</em> zum Nachlesen abgelegt.</li>
          <li>Auf einem Gerät gelöscht, auf dem anderen geändert → der Datensatz
              <strong>bleibt erhalten</strong>. Eine Buchung verschwindet nie stillschweigend,
              nur weil ein anderer Rechner sie gelöscht hat.</li>
          <li>Belege sind unveränderlich und werden immer nur ergänzt.</li>
        </ul>
        <p class="small muted">Wollen beide Geräte gleichzeitig hochladen, bemerkt die
        Anwendung das und beginnt den Abgleich von vorn, statt den fremden Stand zu
        überschreiben.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Google Kalender einrichten (einmalig, für den Betreiber)</h3>
        <p>Der Kalenderabgleich nutzt denselben OAuth-Client wie der Cloud-Abgleich. Im selben
        Google-Cloud-Projekt braucht es zusätzlich:</p>
        <ol>
          <li><strong>APIs und Dienste → Bibliothek → Google Calendar API</strong> aktivieren.
              Ohne diesen Schritt meldet Kontovia beim Verbinden, dass die Schnittstelle nicht
              eingeschaltet ist.</li>
          <li>Beim <strong>OAuth-Zustimmungsbildschirm</strong> den Bereich
              <code>…/auth/calendar.app.created</code> eintragen. Er erlaubt nur den eigenen
              Kalender „Kontovia“, nicht die übrigen Kalender der Nutzer.</li>
          <li>Google stuft Kalenderbereiche als sensibel ein. Bis zur Überprüfung durch Google
              erscheint beim Verbinden „Google hat diese App nicht überprüft“, und es können
              höchstens 100 Konten verbunden werden. Für den eigenen Gebrauch und eine kleine
              Testgruppe reicht das.</li>
        </ol>
        <p class="small muted mb0">Die Web-Fassung kann Google Kalender nicht anbinden: Ihre Anmeldung
        per Code (für Fernseher und Geräte mit eingeschränkter Eingabe) lässt Google nur für
        Anmeldung, Drive-Dateien und YouTube zu. Dort helfen Kalenderdateien (.ics).</p>
      </div></div>
    </div>`;
  wireLinks(root);
}

/* -------------------------------------------------------------------------- */

function recht(root) {
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <div class="card"><div class="card-body">
        <h3 class="mt0">Über dieses Programm</h3>
        <table class="data compact">
          <tbody>
            <tr><td class="muted">Programm</td><td>Kontovia ${esc(appInfo.version || '')}</td></tr>
            <tr><td class="muted">Datenordner</td><td class="tiny">${esc(appInfo.dataDir || '')}</td></tr>
            <tr><td class="muted">Verschlüsselung</td><td>AES-256-GCM, Schlüsselableitung mit scrypt</td></tr>
            <tr><td class="muted">Laufzeitumgebung</td><td>Electron ${esc(appInfo.electron || '')}, Chromium ${esc(appInfo.chrome || '')}</td></tr>
            <tr><td class="muted">Fremder Programmcode</td><td>keiner – null Laufzeitabhängigkeiten</td></tr>
          </tbody>
        </table>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Künstliche Intelligenz</h3>
        <p><strong>Kontovia enthält keine.</strong> Es gibt kein Modell, kein Training, keine
        Ableitung aus Daten. Jede Zuordnung folgt einer Tabelle, die Sie selbst pflegen;
        jede Berechnung ist handgeschriebene Arithmetik. Gleiche Eingabe ergibt immer
        dieselbe Ausgabe.</p>
        <p>Damit ist die KI-Verordnung der EU (Verordnung (EU) 2024/1689) auf dieses Programm
        nicht anwendbar: Erwägungsgrund 12 nimmt Systeme ausdrücklich aus, die auf
        ausschließlich von Menschen definierten Regeln beruhen. Die ausführliche Bewertung
        steht in <code>COMPLIANCE.md</code>.</p>
        <div class="row" style="gap:8px">
          <button class="btn" data-lic="compliance">${icon('file', 15)} Rechtliche Einordnung öffnen</button>
          <button class="btn" data-lic="datenschutz">${icon('file', 15)} Datenschutzhinweise öffnen</button>
        </div>
      </div></div>

      <div class="card mt16" id="recht-export"><div class="card-body">
        <h3 class="mt0">Darf ich die Exporte beim Finanzamt verwenden?</h3>
        <p><strong>Ja – als Arbeitshilfe, so wie die Ausgaben jedes anderen Buchhaltungsprogramms.</strong>
        Beim Finanzamt kommt nicht der Export an, sondern Ihre Erklärung, die Sie in „Mein ELSTER“
        abgeben. Für deren Richtigkeit sind Sie verantwortlich, gleich mit welchem Programm oder ob
        von Hand vorbereitet. Eine Zulassung oder Zertifizierung von Buchhaltungsprogrammen gibt es
        nicht; Bescheinigungen Dritter binden das Finanzamt ausdrücklich nicht (GoBD Rz. 181).</p>
        <p><strong>Ein KI-Hinweis ist nicht nötig.</strong> Die Werte in den Exporten entstehen nach
        festen Rechenregeln aus Ihren Buchungen; bei ihrer Berechnung wirkt keine künstliche
        Intelligenz mit. Die Kennzeichnungspflichten der KI-Verordnung (Art. 50, seit 2. August 2026)
        betreffen Inhalte, die ein KI-System erzeugt – das ist Kontovia nicht. Dass beim Schreiben des
        Programms KI-Werkzeuge geholfen haben, ändert daran nichts; es löst weder eine
        Kennzeichnungspflicht aus noch mindert es die Verwendbarkeit der Zahlen. Auch das
        Steuerrecht kennt keine Pflicht, anzugeben, womit eine Erklärung vorbereitet wurde.
        Freiwillig und zur Transparenz trägt jeder Bericht einen Herkunftsvermerk.</p>
        <p><strong>Wer lieber selbst zusammenstellt,</strong> kann das: Die Tabellen unter
        <a data-go="export">Export</a> (CSV) enthalten die Rohdaten, aus denen sich eigene Unterlagen
        bauen lassen, und die Werte für ELSTER tragen Sie ohnehin selbst ein. Im Zweifel lohnt ein
        einmaliger Abgleich der Zuordnungen mit der Steuerberatung.</p>
        <p class="small muted">Eine technische Einschätzung, keine Rechtsberatung. Die ausführliche
        Begründung steht in <code>COMPLIANCE.md</code>, Abschnitt 7.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Datenschutz</h3>
        <p>Ohne eingerichteten Cloud-Abgleich, ohne verbundenen Google Kalender und ohne Zustimmung
        zur Update-Prüfung verlässt kein Byte diesen Rechner. Es gibt keine Telemetrie, keine Absturzberichte, keine
        Nutzungsstatistik und kein Benutzerkonto beim Hersteller. Nicht-lokale Netzanfragen
        der Oberfläche werden im Hauptprozess verworfen.</p>
        <p>Die Suche nach neuen Programmversionen ist die einzige weitere Verbindung. Sie läuft
        nur, wenn Sie ihr zugestimmt haben, überträgt außer Ihrer IP-Adresse nichts und lässt
        sich unter <a data-go="settings">Einstellungen → Programmaktualisierung</a> jederzeit
        abschalten.</p>
        ${WEB ? '' : raw(`<p><strong>Google Kalender</strong> ist die Ausnahme von der Verschlüsselung und
        deshalb nur nach ausdrücklichem Verbinden aktiv: Damit Google Termine anzeigen kann, gehen
        Titel, Zeit, Ort, Wiederholung und – abschaltbar – die Notiz Ihrer Termine unverschlüsselt in
        den Kalender „Kontovia“ Ihres Google-Kontos. Beträge, Buchungen, Kontakte und Belege gehen
        nicht mit. Trennen unter Einstellungen → Kalender-Abgleich zieht die Freigabe bei Google
        zurück.</p>`)}
        <p>Mit Cloud-Abgleich wird ausschließlich der <strong>bereits verschlüsselte</strong>
        Tresor übertragen – je nach Einstellung in ein Firebase-Projekt oder in Ihr eigenes
        Google Drive. Der Betreiber der Ablage sieht Dateigröße und Änderungszeitpunkt, aber
        keinen Inhalt: der Schlüssel bleibt auf Ihrem Gerät.</p>
        <p class="small">Bei der Firebase-Variante speichert Firebase Authentication
        zusätzlich Ihre E-Mail-Adresse und eine Kontokennung im Klartext – nötig, damit Ihnen
        beim Anmelden Ihr eigener Bereich zugeordnet werden kann. Wer auch das vermeiden will,
        wählt die Drive-Variante; dort entsteht beim Anbieter der Anwendung überhaupt kein
        Datenbestand. Die vollständige Abwägung steht in <code>COMPLIANCE.md</code>.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Lizenzen der Laufzeitumgebung</h3>
        ${WEB ? raw(`<p>Kontovia selbst enthält keinen fremden Quellcode. Die Web-Fassung läuft im
        Browser und bringt keine eigene Laufzeitumgebung mit; für den Browser gelten dessen
        Lizenzbedingungen.</p>`) : raw(`<p>Kontovia selbst enthält keinen fremden Quellcode. Mitgeliefert wird die
        Laufzeitumgebung Electron (MIT-Lizenz) einschließlich Chromium (BSD-3-Clause und
        weitere) sowie Node.js (MIT-Lizenz).</p>
        <div class="row" style="gap:8px">
          <button class="btn" data-lic="electron">${icon('file', 15).__raw} Electron-Lizenz öffnen</button>
          <button class="btn" data-lic="chromium">${icon('file', 15).__raw} Chromium-Lizenzen öffnen</button>
        </div>`)}
        <p class="small muted mt16 mb0">Schriftarten werden nur über ihren Namen angesprochen;
        es wird keine Schriftdatei mitgeliefert.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Marken Dritter</h3>
        <p>Die folgenden Zeichen sind Marken ihrer jeweiligen Inhaber. Sie werden hier
        ausschließlich beschreibend verwendet, um ein Format oder eine Schnittstelle zu
        benennen. Es besteht keine geschäftliche Verbindung zu den Inhabern, keine Empfehlung
        und keine Zertifizierung durch sie.</p>
        <ul>
          <li><strong>DATEV</strong> – DATEV eG. Kontovia erzeugt eine Datei im DATEV-Importformat.
              Die Kontenrahmen SKR03 und SKR04 stammen von der DATEV eG; Kontovia hinterlegt
              einzelne Kontonummern als frei änderbare Vorschläge, um den Import zu ermöglichen.</li>
          <li><strong>ELSTER</strong> – Marke der deutschen Finanzverwaltung. Kontovia bereitet
              Werte zur Eingabe auf und übermittelt selbst nichts.</li>
          <li><strong>Google</strong>, <strong>Google Drive</strong> und <strong>Firebase</strong> – Google LLC.</li>
          <li><strong>Windows</strong> und <strong>Excel</strong> – Microsoft Corporation.</li>
          <li><strong>LibreOffice</strong> – The Document Foundation.</li>
        </ul>
      </div></div>

      <div class="notice warn mt16">
        <strong>Haftung.</strong> Kontovia ist ein Werkzeug zur Erfassung und Auswertung,
        kein Ersatz für Steuerberatung. Die Richtigkeit dessen, was beim Finanzamt eingereicht
        wird, verantwortet der Betrieb. Prüfen Sie die Zuordnung zu EÜR-Zeilen, Kennzahlen und
        Konten einmal mit Ihrer Steuerberatung.
      </div>
    </div>`;

  $$('[data-lic]', root).forEach((b) => b.addEventListener('click', async () => {
    try {
      await api.app.openLicense(b.dataset.lic);
    } catch (e) {
      err('Lizenzdatei nicht gefunden', e.message);
    }
  }));
  wireLinks(root);
}

function wireLinks(root) {
  root.querySelectorAll('[data-go]').forEach((a) => {
    a.style.cursor = 'pointer';
    a.style.color = 'var(--accent)';
    a.setAttribute('role', 'link');
    a.setAttribute('tabindex', '0');
    a.addEventListener('click', () => navigate(a.dataset.go));
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(a.dataset.go); });
  });
}
