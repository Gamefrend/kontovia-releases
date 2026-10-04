/** Kontovia – Kurzanleitung, Cloud und Geräte, Neuigkeiten und rechtliche Hinweise. */

import { html, raw, esc, $, $$, MOD, fmtDate } from '../lib/util.js';
import { icon, err, modal } from '../lib/ui.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { EUER, formLine } from '../lib/calc.js';
import { VERSIONEN } from '../lib/versionen.js';
import { markdownZuHtml } from '../lib/markdown.js';
import { appInfo } from '../app.js';

const api = window.kontovia;
let tab = 'anleitung';

const TABS = { anleitung: 'Kurzanleitung', cloud: 'Cloud und Geräte', neu: 'Neuigkeiten', recht: 'Rechtliches' };

export async function render(root, params = {}) {
  if (params.tab && TABS[params.tab]) tab = params.tab;
  root.innerHTML = html`
    <div class="seg tabs mb16" id="helpTabs" role="group" aria-label="Hilfe">
      ${raw(Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(v)}</button>`).join(''))}
    </div>
    <div id="helpBody" class="help"></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(root); }));
  ({ anleitung, cloud, neu, recht }[tab] || anleitung)($('#helpBody', root));
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
              Ihr Geschäftskonto mit dem Anfangsbestand ein. Das ist der Kontostand an dem Tag,
              ab dem Sie mit Kontovia buchen. Sonst stimmen die Kontostände nicht.</li>
          <li><strong>Erste Ausgabe erfassen.</strong> <kbd>${MOD}</kbd>+<kbd>N</kbd> öffnet den Dialog.
              Beschreibung, Datum, Kategorie, Betrag, fertig. Den Beleg ziehen Sie einfach
              mit der Maus ins Fenster.</li>
          <li><strong>Rechnungen stellen.</strong> Unter <a data-go="rechnungen">Rechnungen</a> schreiben Sie
              E-Rechnungen mit Ihrem Logo. Beim Ausstellen entsteht die offene Einnahme von selbst; sie
              taucht in der Übersicht und im Kalender auf, bis sie bezahlt ist.</li>
          <li><strong>Auswerten.</strong> Unter <a data-go="reports">Auswertungen</a> sehen Sie Gewinn,
              Umsatzsteuer und Vermögen für jeden beliebigen Zeitraum.</li>
          <li><strong>Abgeben.</strong> Unter <a data-go="export">Export</a> erzeugen Sie einen Ordner
              mit allen Zahlen für ELSTER und für Ihre Steuerkanzlei.</li>
        </ol>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Zwei Einstellungen, auf die es ankommt</h3>
        <p><strong>Zahlungsfluss oder Rechnungsdatum.</strong> In der Einnahmen-Überschuss-Rechnung
        zählt eine Buchung erst, wenn das Geld geflossen ist (§ 11 EStG).
        Eine im Dezember gestellte und im Januar bezahlte Rechnung gehört also ins neue Jahr.
        Das gilt für die Anlage EÜR immer. Übersicht, Buchungsliste und Gewinn &amp; Verlust
        richten sich ebenfalls danach: Eine im Zeitraum bezahlte Rechnung steht dort auch dann,
        wenn ihr Datum außerhalb liegt. Bei der Umsatzsteuer haben Sie die Wahl. Nach dem Gesetz
        entsteht sie mit der Leistung, also zum Rechnungsdatum (Soll-Versteuerung). Auf Antrag
        nach § 20 UStG entsteht sie erst mit dem Zahlungseingang (Ist-Versteuerung). Was für Sie
        gilt, steht im Fragebogen zur steuerlichen Erfassung oder im Bescheid.
        Bei Ihnen ist eingestellt: <strong>${s.taxMode === 'kleinunternehmer' ? 'nach Zahlungsfluss' : s.accountingBasis === 'ist' ? 'Umsatzsteuer nach Zahlungseingang (Ist-Versteuerung)' : 'Umsatzsteuer nach Rechnungsdatum (Soll-Versteuerung)'}</strong>.</p>
        <p><strong>Regelbesteuerung oder Kleinunternehmer.</strong> Als Kleinunternehmer nach § 19 UStG
        rechnen Sie durchgehend brutto, weisen keine Umsatzsteuer aus und ziehen keine Vorsteuer.
        Bei Ihnen ist eingestellt: <strong>${s.taxMode === 'kleinunternehmer' ? 'Kleinunternehmer § 19 UStG' : 'Regelbesteuerung'}</strong>.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Belege</h3>
        <p>Keine Betriebsausgabe ohne Beleg. Kontovia speichert jede Rechnung verschlüsselt im
        Tresor und merkt sich eine Prüfsumme, mit der sich später nachweisen lässt,
        dass die Datei unverändert ist. Auf der Übersicht sehen Sie Ihre Belegquote.</p>
        <p>Bei Bewirtungskosten gehören der betriebliche Anlass und die Teilnehmerliste dazu.
        Schreiben Sie beides ins Notizfeld. Kontovia zieht davon automatisch nur 70 % ab.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Anschaffungen über 800 €</h3>
        <p>Eine Maschine für 5.000 € ist im Jahr des Kaufs nicht in voller Höhe abziehbar, sondern
        wird über die Nutzungsdauer verteilt. Beim Erfassen der Ausgabe wählen Sie
        „Als Anlagegut abschreiben“. Kontovia rechnet die Abschreibung monatsgenau aus, führt das
        Anlagenverzeichnis und trägt den Betrag in Zeile ${formLine(EUER.afaBeweglich, new Date().getFullYear())}
        der Anlage EÜR ein.</p>
        <ul>
          <li><strong>Computer, Notebooks, Tablets, Drucker und Software</strong> dürfen mit einem Jahr
              Nutzungsdauer voll im Jahr der Anschaffung abgezogen werden (BMF-Schreiben vom
              22.02.2022). Wählen Sie dafür die Abschreibung „1 Jahr“.</li>
          <li><strong>Degressiv</strong> geht für bewegliche Wirtschaftsgüter, die vom 01.07.2025 bis
              31.12.2027 angeschafft werden: höchstens das Dreifache der linearen Rate und höchstens 30 %
              vom Restwert (§ 7 Abs. 2 EStG). Das bringt in den ersten Jahren mehr Abzug; Kontovia wechselt
              von selbst zur linearen Rate, sobald sie höher ist.</li>
          <li>Bis 800 € netto ist ein Wirtschaftsgut geringwertig und sofort voll abziehbar. Dafür
              genügt eine gewöhnliche Ausgabe.</li>
        </ul>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Rechnungen schreiben</h3>
        <p>Unter <a data-go="rechnungen">Rechnungen</a> entsteht jede Rechnung als Entwurf. Kunden und Positionen
        wählen Sie aus Kontakten und Produkten oder tragen sie frei ein, auch Einheiten wie Stunden, Tage oder
        Pauschalen. Rechts sehen Sie die fertige Seite und eine Liste der Pflichtangaben, die noch fehlen.
        Speichern geht immer; ausstellen auch mit Lücken, nach einer Rückfrage.</p>
        <p><strong>Ausstellen</strong> vergibt die nächste Nummer und legt zwei Dateien unveränderlich ab: ein PDF nach
        ZUGFeRD (es enthält die Rechnungsdaten maschinenlesbar und gilt als E-Rechnung) und eine XRechnung für
        Behörden. Danach lässt sich die Rechnung nur noch stornieren oder korrigieren. Auf Wunsch entsteht die
        offene Einnahme dazu, bei mehreren Steuersätzen je Satz eine Buchung.</p>
        <p><strong>Gestalten</strong> lassen sich Stil, Farbe, Logo, ein Zusatzbild (etwa Ihre Unterschrift) und die
        Texte. Das ändert nur die Ansicht; die Rechnungsdaten bleiben immer eine gültige E-Rechnung.
        Häufige Rechnungen speichern Sie als <strong>Vorlage</strong>.</p>
        <p><strong>Bedienung auf der Vorschau.</strong> Teil anklicken zeigt ein Fenster mit allen Einstellungen. Ein
        Klick neben das Fenster schließt nur dieses. Ein Rechtsklick öffnet das Menü, in dem Sie auch Farben wählen.
        Mit einem <strong>Doppelklick</strong> ändern Sie einen Text direkt auf dem Blatt (Strg+Enter beendet, Esc
        verwirft); er steht danach überall, wo er vorkommt, im selben Wortlaut, auch in den Rechnungsdaten.
        Ein Bild aus der Zwischenablage, etwa ein Bildschirmfoto, fügen Sie mit <kbd>Strg</kbd>+<kbd>V</kbd> ein.</p>
        <p class="small">Der Versand per E-Mail und der automatische Empfang kommen mit einer der nächsten Versionen.
        Bis dahin speichern Sie das PDF und hängen es an Ihre E-Mail an.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">E-Rechnungen empfangen (XRechnung, ZUGFeRD)</h3>
        <p>Seit 2025 muss jedes Unternehmen E-Rechnungen annehmen können. Unter <a data-go="rechnungen">Rechnungen → Eingang</a>
        legen Sie erhaltene E-Rechnungen ab und buchen sie mit einem Klick. Ziehen Sie die XML-Datei oder
        das ZUGFeRD-PDF einfach als Beleg in die Buchung: Kontovia erkennt die Rechnung und bietet an,
        <strong>Rechnungsnummer, Datum, Fälligkeit, Betrag, Steuersatz und Kontakt zu übernehmen</strong>.
        In der Belegvorschau sehen Sie die Rechnung lesbar, mit Positionen, Steuer und
        Bankverbindung, statt als XML-Text.</p>
        <p class="small">Aufbewahrt wird die Originaldatei, unverändert und mit Prüfsumme. Bei Rechnungen mit
        mehreren Steuersätzen legen Sie je Satz eine Buchung an.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Wiederkehrende Buchungen und Steuertermine</h3>
        <p><strong>Miete, Telefon, Abos:</strong> Beim Erfassen unter <em>Weitere Angaben → Wiederholen</em>
        einen Turnus wählen. Sobald die nächste Buchung fällig ist, bietet Kontovia sie nach dem Entsperren
        zum Anlegen an. Jede wird eine gewöhnliche Buchung, an die Sie den Beleg hängen. Verwalten
        können Sie das unter <a data-go="master">Stammdaten → Wiederkehrend</a>.</p>
        <p><strong>Steuertermine:</strong> Übersicht und Kalender zeigen, wann die nächste
        Umsatzsteuer-Voranmeldung fällig ist (samt der Zahllast nach heutigem Stand) und bis wann die
        Jahreserklärungen abzugeben sind. Fällt eine Frist auf ein Wochenende oder einen Feiertag,
        rutscht sie auf den nächsten Werktag. Die Dauerfristverlängerung stellen Sie unter
        <a data-go="settings">Einstellungen</a> ein.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Anzahlungen und der Ort der Leistung</h3>
        <p>Bei einer Einnahme können Sie den <strong>Ort</strong> festhalten, also wo die Leistung
        erbracht wurde. Bereits verwendete Orte schlägt das Feld vor, und in der
        <a data-go="transactions">Buchungsliste</a> filtern Sie danach über den Trichter im
        Kopf der Spalte <em>Beschreibung</em>.</p>
        <p>Wird nur ein Teil im Voraus bezahlt, setzen Sie das Häkchen bei
        <strong>Anzahlung</strong> und tragen den Termin der Veranstaltung ein (bei einer Hochzeit
        das Hochzeitsdatum) sowie den Anteil in Prozent. Aus Anzahlung und Anteil
        errechnet Kontovia den vereinbarten Gesamtbetrag und den Restbetrag und legt auf Wunsch
        gleich die offene Restzahlung zum Veranstaltungstag an. Der Termin erscheint im
        <a data-go="calendar">Kalender</a>.</p>
        <p class="small">Steuerlich zählt die Anzahlung bei der Einnahmen-Überschuss-Rechnung im
        Jahr des Zuflusses, also wenn das Geld eingeht und nicht erst zur Veranstaltung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Termine und Rechnungen verknüpfen</h3>
        <p>Im <a data-go="calendar">Kalender</a> verknüpfen Sie einen Termin mit einer oder mehreren
        Buchungen, zum Beispiel den Montagetermin mit der dazugehörigen Rechnung. Außerdem zeigt der
        Kalender die Fälligkeiten offener Rechnungen.</p>
        <p><strong>Aufgaben:</strong> Unter <a data-go="todos">Aufgaben</a> notieren Sie, was zu tun ist,
        und haken es ab. Eine Aufgabe kann zu einem Termin gehören, muss aber nicht. Hat sie kein
        eigenes Datum, gilt der Termin als Frist. Im Termin selbst stehen seine Aufgaben zum Abhaken
        und Ergänzen.</p>
        ${raw(`<p><strong>Google Kalender:</strong> Unter <em>Abgleich</em> oben im
        Kalender oder unter Einstellungen → Kalender-Abgleich verbinden Sie Kontovia mit Ihrem
        Google-Konto. Kontovia legt dort einen eigenen Kalender „Kontovia“ an und gleicht in beide
        Richtungen ab. Auf dem Telefon sehen Sie Ihre Termine in der Google-Kalender-App, und was
        Sie dort im Kalender „Kontovia“ eintragen, erscheint hier. Ihre übrigen Kalender bezieht
        Kontovia nur ein, wenn Sie das ausdrücklich einschalten. Beträge, Buchungen und Kontakte
        gehen nie an Google. Ohne Google-Konto geht es per Kalenderdatei (.ics).</p>`)}
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Zeitraum wählen und filtern</h3>
        <p><strong>Zeitraum.</strong> Oben rechts steht der gewählte Zeitraum, etwa „Jahr ${String(new Date().getFullYear())}“.
        Die Pfeile daneben blättern um genau diese Länge weiter, vom März zum April, vom
        2. zum 3. Quartal oder von einem Jahr ins nächste. Ein Klick auf den Zeitraum öffnet die
        Schnellwahl (dieser Monat, letztes Quartal …), ein Raster zum direkten Anklicken von
        Jahr, Quartal oder Monat und darunter zwei Felder für einen eigenen Zeitraum.</p>
        <p><strong>Filter in den Spaltenköpfen.</strong> In der <a data-go="transactions">Buchungsliste</a>
        filtern Sie dort, wo die Werte stehen: über den kleinen Trichter im Kopf der Spalten
        <em>Kategorie</em>, <em>Kontakt</em>, <em>Status</em> (offen, bezahlt, überfällig, dazu stornierte und
        nicht gelistete Buchungen), <em>Brutto</em> (nur Einnahmen oder nur Ausgaben), im Kopf der
        Belegspalte (mit oder ohne Beleg) und, sobald Orte erfasst sind, bei <em>Beschreibung</em>.
        Neben jeder Möglichkeit steht, wie viele Buchungen sie ergibt. Ein Klick auf den
        Spaltennamen sortiert.</p>
        <p>Was gerade gefiltert ist, steht als Chip über der Liste; das Kreuz im Chip hebt den
        Filter auf, „Alle Filter zurücksetzen“ alle zusammen. Ein gesetzter Filter färbt außerdem
        seinen Trichter ein.</p>
        <p><strong>Sortieren.</strong> Jede Liste lässt sich nach jeder Spalte sortieren: Buchungen,
        Kategorien, Kontakte, Konten, Anlagen, offene Posten, die Kategorien der Gewinn- und
        Verlustrechnung, die Monatstabelle und das Änderungsjournal. Ein Klick auf den
        Spaltennamen mit dem Doppelpfeil sortiert, ein zweiter kehrt die Richtung um. Der farbige
        Pfeil zeigt, wonach gerade sortiert ist. Über größeren Listen nennt der Knopf
        <em>Sortieren</em> die Sortierung in Worten („Datum: neueste zuerst“) und lässt Spalte und
        Richtung wählen. Das hilft auf dem Telefon, wo nicht alle Spalten ins Bild passen.
        Kontovia merkt sich die Sortierung jeder Liste auf diesem Gerät. Aufstellungen mit fester
        Reihenfolge, etwa die Zeilen der Anlage EÜR oder die Kontenblätter mit laufendem Saldo,
        bleiben unsortiert.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Die Übersicht anpassen</h3>
        <p>Über <strong>Anpassen</strong> oben in der <a data-go="dashboard">Übersicht</a> ordnen Sie die
        Module so, wie Sie arbeiten: mit der Maus an einen anderen Platz ziehen oder mit den Pfeilen
        verschieben, die Breite von einem Viertel bis zur ganzen Zeile wählen (auch drei Viertel, damit sich
        mit einem Viertel immer eine volle Zeile ergibt), Nicht-Benötigtes
        ausblenden. Ausgeblendete Module und zusätzliche wie <em>Letzte Buchungen</em>,
        <em>Durchschnittswerte</em> oder <em>Kontostände heute</em> holen Sie über die Knöpfe oben im
        Anpassen-Modus zurück. „Voreinstellung“ stellt die ursprüngliche Anordnung wieder her.</p>
        <p>Jede Zahl der Übersicht lässt sich anklicken: Die Einnahmen führen zu den Zahlungseingängen des Zeitraums,
        der Gewinn zur Gewinn- und Verlustrechnung, eine Kategorie oder ein Monat zu den dazu passenden Buchungen.
        Ein Klick auf die Überschrift eines Moduls oder auf eine freie Stelle in seiner Karte öffnet die zugehörige Ansicht.</p>
        <p class="small">Die Anordnung gilt nur für dieses Gerät. Am Telefon passt oft eine andere als
        am großen Bildschirm. In den Tresor und den Cloud-Abgleich geht sie nicht.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Diagramme und Durchschnittswerte</h3>
        <p>In der <a data-go="dashboard">Übersicht</a> und unter <a data-go="reports">Auswertungen</a>
        schalten Sie die Darstellung mit den Knöpfen im Kopf jeder Karte um. Das geht unabhängig
        vom Zeitraum oben. Den Verlauf zeigen Sie als <strong>Säulen</strong>, <strong>Linien</strong>,
        <strong>aufgelaufene Summen</strong> oder <strong>Tabelle</strong>, die Aufteilung nach
        Kategorien als <strong>Balken</strong> oder <strong>Torte</strong>. Die Wahl merkt sich
        Kontovia auf diesem Gerät.</p>
        <p>Durchschnittswerte stehen unter den Kennzahlen (Ø je Monat), als gestrichelte Linie im
        Verlauf und in der Karte <em>Durchschnittswerte</em> der Gewinn- und Verlustrechnung. Dort
        finden Sie auch den Wert je Buchung sowie den besten und schwächsten Monat. Gemittelt wird
        über die Monate, die schon begonnen haben, im laufenden Jahr also nicht über zwölf.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Nicht gelistete Buchungen</h3>
        <p>Im Buchungsdialog können Sie eine Buchung als <strong>nicht gelistet</strong> kennzeichnen.
        Das ist für Vorgänge gedacht, die Sie für die eigene Übersicht festhalten wollen, die
        steuerlich aber nicht zum Betrieb gehören. Nicht gelistete Buchungen fehlen in allen Unterlagen für Finanzamt und
        Steuerkanzlei: EÜR, Umsatzsteuer, DATEV-Stapel, Prüfungsordner, Buchungsjournal.</p>
        <p>In Übersicht und Auswertungen zählen sie nur mit, wenn Sie dort oben den Schalter
        <strong>„Nicht gelistete einbeziehen“</strong> setzen. Die Zahl daneben nennt, wie viele es
        im gewählten Zeitraum gibt; die Beträge stehen im Hinweis beim Darüberfahren. Der Schalter
        gilt bis zum Sperren. In der Buchungsliste zeigt ein Abzeichen, welche Buchung nicht
        gelistet ist, und der Filter im Kopf der Spalte <em>Status</em> blendet sie ein oder aus.</p>
        <p class="small">Wichtig: Betriebliche Einnahmen und Ausgaben müssen vollständig erklärt werden
        (§ 146 Abs. 1 AO). Das Änderungsjournal bleibt deshalb vollständig. Es verzeichnet auch
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
              <code>index.xml</code>, so wie es bei einer Betriebsprüfung verlangt wird.</li>
        </ul>
        <p class="small">Kontovia übermittelt <strong>nichts</strong> an die Finanzverwaltung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Tastenkürzel</h3>
        <table class="data compact">
          <tbody>
            <tr><td><kbd>${MOD}</kbd>+<kbd>N</kbd></td><td>Neue Buchung</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>Umschalt</kbd>+<kbd>N</kbd></td><td>Neuer Termin</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>S</kbd></td><td>Sofort speichern</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>F</kbd></td><td>In Buchungen suchen</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>L</kbd></td><td>Sperren</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>1</kbd> … <kbd>7</kbd></td><td>Übersicht, Buchungen, Kalender, Auswertungen, Export, Stammdaten, Aufgaben</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>,</kbd></td><td>Einstellungen</td></tr>
            <tr><td><kbd>F1</kbd> oder <kbd>?</kbd></td><td>Diese Hilfe</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Fenster schließen (fragt nach, wenn Eingaben offen sind)</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>Enter</kbd></td><td>Im Fenster speichern</td></tr>
            <tr><td colspan="2" class="small muted">Im Browser sind einzelne Kürzel wie ${MOD}+N vom Browser selbst belegt;
              dann helfen die Knöpfe oben rechts.</td></tr>
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
      <div class="card mb16"><div class="card-body">
        <h3 class="mt0">Wo Ihre Buchhaltung liegt</h3>
        <p>Zunächst im Speicher dieses Browsers, verschlüsselt mit Ihrem Passwort. Den darf der
        Browser bei Platzmangel räumen; auf iPhone und iPad gehört deshalb die Cloud-Sicherung oder
        eine regelmäßige Vollsicherung dazu.</p>
        <p><strong>In Chrome und Edge</strong> lässt sie sich unter <a data-go="settings">Einstellungen →
        Sicherung und Speicherort</a> in einen <strong>Ordner auf dem Gerät</strong> verschieben. Dort liegen
        Tresor, Belege und Sicherungen als Dateien, und Sie sichern sie mit
        Ihren übrigen Dateien. Nach einem Neustart fragt der Browser einmal, ob Kontovia wieder auf den
        Ordner zugreifen darf.</p>
        <p class="mb0"><strong>Von Windows umziehen:</strong> Kopieren Sie den Ordner
        <code>%APPDATA%\\Kontovia\\daten</code> zum Beispiel in Ihre Dokumente und öffnen Sie die Kopie beim
        ersten Start mit <em>Ordner öffnen</em>. Den Originalordner gibt der Browser nicht frei. Alternativ:
        Vollsicherung einspielen oder die Buchhaltung aus der Cloud laden.</p>
      </div></div>
      <div class="card mb16"><div class="card-body">
        <h3 class="mt0">Wann Kontovia sich sperrt</h3>
        <p>Nach der eingestellten Zeit ohne Eingabe, nach drei Minuten in einer anderen App oder einem
        anderen Tab, nach dem Ruhezustand des Geräts und wenn Kontovia in einem zweiten Fenster geöffnet
        wird. Sofort mit <kbd>${MOD}</kbd>+<kbd>L</kbd>.</p>
        <p class="mb0">Dass der Bildschirm gesperrt wurde, melden nur Chrome und Edge, und nur mit Ihrer
        Erlaubnis: unter <a data-go="settings">Einstellungen → Sicherheit</a>. Safari und Firefox melden es
        nicht. Auf iPhone und iPad hält Safari Kontovia beim Sperren des Bildschirms an; nach dem Entsperren
        gilt dann die Regel für den Hintergrund.</p>
      </div></div>
      <div class="card mb16"><div class="card-body">
        <h3 class="mt0">Entsperren, Sperren und Abmelden</h3>
        <p><strong>Sperren</strong> schließt nur den Tresor. <strong>Abmelden</strong> (daneben in der Seitenleiste)
        entfernt Buchhaltung, Belege und alle Zugänge von diesem Gerät, damit Sie sich mit einem anderen Konto
        anmelden können. Ist Kontovia mit Google verbunden, gleicht es vorher ab; sonst fragt es besonders
        deutlich nach, denn dann gäbe es Ihre Buchhaltung nur noch in einer Sicherung.</p>
        <p class="mb0">Neben dem Passwort lassen sich unter <a data-go="settings">Einstellungen → Sicherheit</a> zwei
        weitere Wege einschalten, jeder für sich ausreichend: <strong>Fingerabdruck oder Gesicht</strong> (nur auf diesem
        Gerät, der Schlüssel bleibt im Sicherheitschip) und das <strong>Google-Konto</strong> (auf jedem Gerät; dafür liegt
        der Schlüssel in Ihrem Konto, wer es übernimmt, kommt auch an die Buchhaltung). Das Passwort bleibt immer gültig.</p>
      </div></div>
      <div class="card mb16"><div class="card-body">
        <h3 class="mt0">Rückmeldung geben</h3>
        <p class="mb0">Mit <strong>Feedback</strong> unten in der Seitenleiste schreiben Sie uns frei, was Ihnen
        auffällt. Auf Wunsch geht ein Bild der Seite mit, auf der Sie waren, ohne das Rückmeldefenster. Es wird
        verschlüsselt in Ihrer Buchhaltung gespeichert und vorerst nirgends hin gesendet.</p>
      </div></div>
      <div class="card"><div class="card-body">
        <h3 class="mt0">Cloud-Abgleich einschalten</h3>
        <p>Mit dem Cloud-Abgleich arbeiten Sie auf mehreren Geräten an derselben Buchhaltung, und
        Kontovia legt jeden Tag eine Sicherung in der Cloud ab. Sie brauchen dafür nur ein
        Google-Konto.</p>
        <ol>
          <li>Öffnen Sie <a data-go="settings">Einstellungen → Cloud-Abgleich</a>.</li>
          <li>Klicken Sie auf <strong>Mit Google verbinden</strong>.</li>
          <li>Kontovia leitet Sie zu Google weiter. Nach der Anmeldung kommen Sie zurück und entsperren Kontovia einmal mit Ihrem Passwort.</li>
        </ol>
        <p>Ab dann gleicht Kontovia von selbst ab: nach jeder Änderung, beim Start und in
        regelmäßigen Abständen.</p>
        <div class="notice ok mb0"><strong>Ihre Daten bleiben verschlüsselt.</strong> In die Cloud geht
        nur Ihre bereits verschlüsselte Buchhaltung. Lesen kann sie nur, wer Ihr Passwort kennt.
        Das sind weder Google noch der Hersteller von Kontovia.</div>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Zweites Gerät anschließen</h3>
        <p>Installieren Sie Kontovia dort und klicken Sie beim ersten Start auf
        <strong>Mit Google anmelden</strong>. Kontovia findet Ihre Buchhaltung im Konto und
        lädt sie, sobald Sie das Passwort eingeben (das Passwort des ersten Geräts). Ab da
        arbeiten beide Geräte auf demselben Bestand; die Belege kommen beim ersten Abgleich nach.</p>
        <p class="small muted mb0">Haben Sie dort schon einen Tresor angelegt: unter
        <a data-go="settings">Einstellungen → Cloud-Abgleich</a> verbinden. Kontovia erkennt die
        Buchhaltung in der Cloud und bietet <strong>Cloud-Stand übernehmen</strong> an; der
        Tresor des Geräts wird vorher gesichert.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Sicherungen in der Cloud</h3>
        <p>Neben dem laufenden Stand legt der Abgleich einmal am Tag eine Sicherung in Ihrem
        Konto ab, ebenso vor jedem „Cloud überschreiben“ und vor jeder Wiederherstellung. Die
        30 neuesten bleiben erhalten; sie sind genauso verschlüsselt wie der Tresor.</p>
        <ul>
          <li><strong>Wiederherstellen</strong> unter <a data-go="settings">Einstellungen →
              Cloud-Abgleich → Sicherungen ansehen</a>. Der gewählte Stand ersetzt den Bestand
              dieses Geräts und gilt nach dem nächsten Abgleich auch auf den anderen. Auch
              Buchungen, die dort inzwischen gelöscht wurden, kommen zurück.</li>
          <li>Belege, die nicht mehr gebraucht werden, bleiben noch 90 Tage in der Cloud,
              damit die Sicherungen vollständig wiederherstellbar sind.</li>
          <li>Eine Sicherung aus der Zeit vor einem Passwortwechsel öffnet sich ohne
              Rückfrage. Eine Sicherung einer <em>anderen</em> Buchhaltung (etwa der Stand vor
              „Cloud überschreiben“) fragt nach deren Passwort.</li>
        </ul>
        <p class="small muted mb0">Die Sicherungen in der Cloud ersetzen nicht die Vollsicherung auf
        einem eigenen Datenträger: Wer den Zugang zum Google-Konto verliert, verliert auch sie.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Was passiert, wenn beide Geräte dasselbe ändern?</h3>
        <p>Kontovia vergleicht jeden einzelnen Eintrag mit dem letzten Stand, den beide Geräte
        gemeinsam hatten. Daraus ergibt sich:</p>
        <ul>
          <li>Nur auf einer Seite geändert: Die Änderung wird ohne Nachfrage übernommen.</li>
          <li>Auf beiden Seiten geändert: Es gilt die zuletzt bearbeitete Fassung. Die andere
              finden Sie unter <em>Einstellungen → Cloud-Abgleich → Konflikte ansehen</em> zum
              Nachlesen.</li>
          <li>Auf einem Gerät gelöscht, auf dem anderen geändert: Der Eintrag
              <strong>bleibt erhalten</strong>. Eine Buchung verschwindet nie stillschweigend,
              nur weil ein anderes Gerät sie gelöscht hat.</li>
          <li>Belege werden nie verändert, nur ergänzt.</li>
        </ul>
        <p class="small muted mb0">Speichern zwei Geräte genau gleichzeitig, bemerkt Kontovia das
        und beginnt den Abgleich von vorn, statt den Stand des anderen zu überschreiben.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Google Kalender</h3>
        ${raw(`<p>Im <a data-go="calendar">Kalender</a> über
        <em>Abgleich</em> oder unter <a data-go="settings">Einstellungen → Kalender-Abgleich</a>
        verbinden Sie Kontovia mit Google. Kontovia legt in Ihrem Konto einen eigenen Kalender
        „Kontovia“ an und gleicht in beide Richtungen ab. Auf Wunsch kommen Ihr Hauptkalender und
        weitere Kalender dazu.</p>
        <ul>
          <li><strong>Was an Google geht:</strong> Titel, Zeit, Ort und Wiederholung Ihrer Termine, die
              Notiz nur, wenn Sie das einschalten. Anders als beim Cloud-Abgleich ist das
              unverschlüsselt, sonst könnte Google die Termine nicht anzeigen. Beträge, Buchungen,
              Kontakte und Belege gehen nie an Google.</li>
          <li><strong>Hinweis von Google:</strong> Beim Verbinden kann „Google hat diese App nicht
              überprüft“ erscheinen. Über <em>Erweitert</em> und den Link darunter geht es weiter.</li>
          <li><strong>Trennen</strong> unter Einstellungen → Kalender-Abgleich. Ihre Termine in
              Kontovia bleiben, auf Wunsch wird der Kalender „Kontovia“ in Google gelöscht.</li>
          <li><strong>Anmeldung:</strong> Es öffnet sich ein kleines Fenster von Google. Wo das nicht
              geht (etwa in der App auf dem iPhone), wechselt Kontovia für einen Moment zu Google und
              kommt danach zurück. Blockiert der Browser das Fenster, fragt Kontovia vorher. Sie entsperren Kontovia dann einmal
              mit Ihrem Passwort, und es geht dort weiter, wo Sie waren. Der Zugriff auf den Kalender gilt jeweils
              eine Stunde. Danach wartet der Abgleich, bis Sie kurz bestätigen: ein Tipp auf
              <em>Bestätigen und abgleichen</em>, meist ohne erneute Anmeldung.</li>
        </ul>
        <p class="small muted mb0">Ohne Google-Konto übertragen Sie Termine als Kalenderdatei (.ics):
        im Kalender über <em>Abgleich</em>. Die Datei öffnet Google Kalender, Apple Kalender oder
        Outlook.</p>`)}
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Verbindung trennen</h3>
        <p>Unter <a data-go="settings">Einstellungen → Cloud-Abgleich → Verbindung trennen</a> meldet
        sich dieses Gerät von der Cloud ab. Ihre Buchhaltung bleibt vollständig auf dem Gerät, und
        Ihre anderen Geräte bleiben verbunden. Auf Wunsch löscht Kontovia dabei auch Tresor, Belege
        und Sicherungen in der Cloud.</p>
        <p class="small muted mb0">Den Zugriff von Kontovia auf Ihr Google-Konto entfernen Sie ganz in
        Ihrem Google-Konto unter <em>Sicherheit → Verbindungen zu Drittanbieter-Apps</em>
        (myaccount.google.com/connections).</p>
      </div></div>
    </div>`;
  wireLinks(root);
}

/* -------------------------------------------------------------------------- */

/** So viele Versionen stehen offen da; die älteren klappen sich auf Wunsch auf. */
const NEU_OFFEN = 4;

function versionsBlock(v, { karte }) {
  const ihre = v.version === appInfo.version;
  const kopf = `<div class="row wrap" style="gap:8px;align-items:baseline">
      <strong style="font-size:${karte ? 15 : 14}px">${esc(v.titel)}</strong>
      <span class="spacer"></span>
      <span class="badge${ihre ? ' info' : ''}">Version ${esc(v.version)}${ihre ? ' · Ihre Version' : ''}</span>
    </div>
    <div class="tiny muted mt8">${esc(fmtDate(v.datum))}</div>
    <ul class="mb0">${v.punkte.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  return karte ? `<div class="card mb16"><div class="card-body">${kopf}</div></div>` : `<div class="version-alt">${kopf}</div>`;
}

function neu(root) {
  const offen = VERSIONEN.slice(0, NEU_OFFEN);
  const aelter = VERSIONEN.slice(NEU_OFFEN);
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <p class="small muted mt0 mb16">Was sich in Kontovia geändert hat, die neueste Version zuerst.</p>
      ${raw(offen.map((v) => versionsBlock(v, { karte: true })).join(''))}
      ${aelter.length ? raw(`<div class="card"><div class="card-body">
        <details class="versionen-aelter">
          <summary><strong>Ältere Versionen</strong> <span class="muted small">(${aelter.length})</span></summary>
          ${aelter.map((v) => versionsBlock(v, { karte: false })).join('')}
        </details>
      </div></div>`) : ''}
    </div>`;
}

/* -------------------------------------------------------------------------- */

function recht(root) {
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <div class="card"><div class="card-body">
        <h3 class="mt0">Über dieses Programm</h3>
        <table class="data compact">
          <tbody>
            <tr><td class="muted">Programm</td><td>Kontovia ${appInfo.version || ''}</td></tr>
            <tr><td class="muted">Ablage</td><td class="tiny">${appInfo.dataDir || ''}</td></tr>
            <tr><td class="muted">Verschlüsselung</td><td>AES-256, der Schlüssel entsteht aus Ihrem Passwort</td></tr>
          </tbody>
        </table>
      </div></div>

      <div class="card mt16" id="recht-datenschutz"><div class="card-body">
        <h3 class="mt0">Datenschutz</h3>
        <p>Ohne Cloud-Abgleich, ohne Google Kalender und ohne Ihre Zustimmung zur Update-Suche
        verlässt nichts dieses Gerät. Es gibt keine Telemetrie, keine
        Absturzberichte, keine Nutzungsstatistik und kein Benutzerkonto beim Hersteller.</p>
        <ul>
          <li><strong>Update-Suche:</strong> nur, wenn Sie zugestimmt haben. Dabei sieht der Server
              Ihre IP-Adresse, sonst nichts. Abschalten unter
              <a data-go="settings">Einstellungen → Programmaktualisierung</a>.</li>
          <li><strong>Cloud-Abgleich:</strong> Übertragen wird nur Ihre bereits verschlüsselte
              Buchhaltung. Für die Anmeldung speichert Google zusätzlich Ihre E-Mail-Adresse.</li>
          ${raw(`<li><strong>Google Kalender:</strong> Titel, Zeit und Ort Ihrer Termine gehen
              unverschlüsselt an Google, damit der Kalender sie anzeigen kann. Beträge, Buchungen,
              Kontakte und Belege nie.</li>`)}
        </ul>
        <button class="btn" id="btnDatenschutz">${icon('file', 15)} Datenschutzhinweise lesen</button>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Künstliche Intelligenz</h3>
        <p><strong>Kontovia enthält keine.</strong> Es gibt kein Modell, kein Training, keine
        Ableitung aus Daten. Jede Zuordnung folgt einer Tabelle, die Sie selbst pflegen;
        jede Berechnung folgt festen Rechenregeln. Gleiche Eingabe ergibt immer
        dieselbe Ausgabe.</p>
        <p class="mb0">Damit ist die KI-Verordnung der EU (Verordnung (EU) 2024/1689) auf dieses Programm
        nicht anwendbar: Erwägungsgrund 12 nimmt Systeme ausdrücklich aus, die auf
        ausschließlich von Menschen definierten Regeln beruhen.</p>
      </div></div>

      <div class="card mt16" id="recht-export"><div class="card-body">
        <h3 class="mt0">Darf ich die Exporte beim Finanzamt verwenden?</h3>
        <p><strong>Ja, als Arbeitshilfe, so wie die Ausgaben jedes anderen Buchhaltungsprogramms.</strong>
        Beim Finanzamt kommt nicht der Export an, sondern Ihre Erklärung, die Sie in „Mein ELSTER“
        abgeben. Für deren Richtigkeit sind Sie verantwortlich, gleich mit welchem Programm oder ob
        von Hand vorbereitet. Eine Zulassung oder Zertifizierung von Buchhaltungsprogrammen gibt es
        nicht; Bescheinigungen Dritter binden das Finanzamt ausdrücklich nicht (GoBD Rz. 181).</p>
        <p><strong>Ein KI-Hinweis ist nicht nötig.</strong> Die Werte in den Exporten entstehen nach
        festen Rechenregeln aus Ihren Buchungen; künstliche Intelligenz wirkt dabei nicht mit. Die
        Kennzeichnungspflichten der KI-Verordnung (Art. 50, seit 2. August 2026) betreffen Inhalte, die
        ein KI-System erzeugt. Das ist Kontovia nicht. Auch das Steuerrecht kennt keine Pflicht,
        anzugeben, womit eine Erklärung vorbereitet wurde. Freiwillig und zur Transparenz trägt jeder
        Bericht einen Herkunftsvermerk.</p>
        <p><strong>Wer lieber selbst zusammenstellt,</strong> kann das: Die Tabellen unter
        <a data-go="export">Export</a> (CSV) enthalten die Rohdaten, und die Werte für ELSTER tragen Sie
        ohnehin selbst ein. Im Zweifel lohnt ein einmaliger Abgleich der Zuordnungen mit der
        Steuerberatung.</p>
        <p class="small muted mb0">Eine sorgfältige Einschätzung, keine Rechtsberatung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Lizenzen</h3>
        <p class="mb0">Kontovia selbst enthält keinen fremden Programmcode. Kontovia läuft in Ihrem
        Browser; für ihn gelten dessen Lizenzbedingungen.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h3 class="mt0">Marken Dritter</h3>
        <p>Die folgenden Zeichen sind Marken ihrer jeweiligen Inhaber. Sie werden hier
        ausschließlich beschreibend verwendet, um ein Format oder eine Schnittstelle zu
        benennen. Es besteht keine geschäftliche Verbindung zu den Inhabern, keine Empfehlung
        und keine Zertifizierung durch sie.</p>
        <ul class="mb0">
          <li><strong>DATEV</strong> ist eine Marke der DATEV eG. Kontovia erzeugt eine Datei im
              DATEV-Importformat. Die Kontenrahmen SKR03 und SKR04 stammen von der DATEV eG; Kontovia
              hinterlegt einzelne Kontonummern als frei änderbare Vorschläge, damit der Import klappt.</li>
          <li><strong>ELSTER</strong> ist eine Marke der deutschen Finanzverwaltung. Kontovia bereitet
              Werte zur Eingabe auf und übermittelt selbst nichts.</li>
          <li><strong>Google</strong>, <strong>Google Kalender</strong> und <strong>Firebase</strong> sind Marken von Google LLC.</li>
          <li><strong>Windows</strong> und <strong>Excel</strong> sind Marken der Microsoft Corporation.</li>
          <li><strong>LibreOffice</strong> ist eine Marke von The Document Foundation.</li>
        </ul>
      </div></div>

      <div class="notice warn mt16">
        <strong>Haftung.</strong> Kontovia ist ein Werkzeug zur Erfassung und Auswertung,
        kein Ersatz für Steuerberatung. Die Richtigkeit dessen, was beim Finanzamt eingereicht
        wird, verantwortet der Betrieb. Prüfen Sie die Zuordnung zu EÜR-Zeilen, Kennzahlen und
        Konten einmal mit Ihrer Steuerberatung.
      </div>
    </div>`;

  $('#btnDatenschutz', root).addEventListener('click', () => zeigeDatenschutz());
  wireLinks(root);
}

/** Die vollständigen Datenschutzhinweise (DATENSCHUTZ.md) in einem Fenster. */
export async function zeigeDatenschutz() {
  const m = modal({
    title: 'Datenschutzhinweise',
    size: 'wide',
    body: '<div class="skeleton" style="height:240px"></div>',
    foot: '<button class="btn primary" data-x>Schließen</button>',
  });
  m.root.querySelector('[data-x]').addEventListener('click', () => m.close());
  try {
    const text = await api.app.legalText('datenschutz');
    m.body.innerHTML = `<div class="legal">${markdownZuHtml(text)}</div>`;
  } catch (e) {
    m.body.innerHTML = html`<div class="notice danger">${e.message}</div>`;
  }
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
