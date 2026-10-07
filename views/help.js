/** Kontovia – Kurzanleitung, Cloud und Geräte, Neuigkeiten und rechtliche Hinweise. */

import { html, raw, esc, $, $$, MOD, fmtDate } from '../lib/util.js';
import { icon, err, modal } from '../lib/ui.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { EUER, formLine } from '../lib/calc.js';
import { VERSIONEN } from '../lib/versionen.js';
import { markdownZuHtml } from '../lib/markdown.js';
import { rechtstextZeigen } from '../lib/recht.js';
import { appInfo } from '../app.js';

const api = window.kontovia;
let tab = 'anleitung';

const TABS = { anleitung: 'Kurzanleitung', cloud: 'Cloud und Geräte', neu: 'Neuigkeiten', recht: 'Rechtliches' };

/** Kennung eines Abschnitts aus seiner Überschrift: „Rechnungen schreiben“ → „rechnungen-schreiben“. */
export function abschnittKennung(titel) {
  return String(titel || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function render(root, params = {}) {
  if (params.tab && TABS[params.tab]) tab = params.tab;
  // Ein Sprung aus einem Bereich („?“ oben neben dem Titel) öffnet die Kurzanleitung an der passenden Stelle.
  if (params.abschnitt && !params.tab) tab = 'anleitung';
  const suchbar = tab === 'anleitung' || tab === 'cloud';
  root.innerHTML = html`
    <div class="row wrap mb16" style="gap:10px 16px">
      <div class="seg tabs" id="helpTabs" role="group" aria-label="Hilfe">
        ${raw(Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${esc(v)}</button>`).join(''))}
      </div>
      ${suchbar ? raw('<input type="search" id="helpSuche" class="help-suche" placeholder="In der Hilfe suchen …" aria-label="In der Hilfe suchen">') : ''}
    </div>
    <p class="muted small" id="helpLeer" hidden>Dazu steht hier nichts. Versuchen Sie ein anderes Wort oder den anderen Reiter.</p>
    <div id="helpBody" class="help"></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(root); }));
  const body = $('#helpBody', root);
  ({ anleitung, cloud, neu, recht }[tab] || anleitung)(body);
  // Jede Überschrift wird zum Sprungziel.
  $$('h2', body).forEach((h) => { if (!h.id) h.id = `hilfe-${abschnittKennung(h.textContent)}`; });
  if (suchbar) sucheVerdrahten(root, body);
  // Sprung zu einem Abschnitt, etwa aus der Export-Ansicht.
  // Ohne Animation: die wird bei verdecktem Fenster ausgesetzt, der Sprung bliebe dann aus.
  if (params.anker) setTimeout(() => $(`#recht-${params.anker}`, root)?.scrollIntoView({ block: 'start' }), 60);
  if (params.abschnitt) setTimeout(() => $(`#hilfe-${params.abschnitt}`, root)?.closest('.card')?.scrollIntoView({ block: 'start' }), 60);
}

/** Blendet beim Tippen alle Karten aus, in denen nicht jedes gesuchte Wort vorkommt. */
function sucheVerdrahten(root, body) {
  const feld = $('#helpSuche', root);
  const leer = $('#helpLeer', root);
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');
  const karten = $$('.card', body).map((k) => ({ k, text: norm(k.textContent) }));
  feld.addEventListener('input', () => {
    const woerter = norm(feld.value).trim().split(' ').filter(Boolean);
    let sichtbar = 0;
    for (const { k, text } of karten) {
      const an = woerter.every((w) => text.includes(w));
      k.hidden = !an;
      if (an) sichtbar++;
    }
    leer.hidden = sichtbar > 0;
  });
}

/* -------------------------------------------------------------------------- */

function anleitung(root) {
  const s = store.db.settings;
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <div class="card"><div class="card-body">
        <h2 class="mt0">In fünf Minuten startklar</h2>
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
              Umsatzsteuer und Vermögen für jeden beliebigen Zeitraum, und im Jahresvergleich, wie sich
              Ausgaben oder Einnahmen von Jahr zu Jahr entwickeln. Listen und Berichte drucken Sie oder sichern sie als PDF.</li>
          <li><strong>Abgeben.</strong> Unter <a data-go="export">Export</a> erzeugen Sie einen Ordner
              mit allen Zahlen für ELSTER und für Ihre Steuerkanzlei.</li>
        </ol>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Zwei Einstellungen, auf die es ankommt</h2>
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
        <p><strong>Wechsel.</strong> Ändern Sie eine der beiden Einstellungen, fragt Kontovia, ab wann der Wechsel gilt. Frühere
        Zeiträume bleiben, wie sie waren: Wer etwa ab Januar nicht mehr Kleinunternehmer ist, sieht das alte Jahr weiter als
        Kleinunternehmer. Die Vorsteuer zählt übrigens immer mit dem Datum der Rechnung, auch bei Ist-Versteuerung.</p>
        <p><strong>Zahlungen um den Jahreswechsel.</strong> Regelmäßige Zahlungen wie Miete, Leasing oder die Umsatzsteuer-Vorauszahlung,
        die bis zehn Tage vor oder nach dem Jahreswechsel fällig sind und gezahlt werden, zählen in der Anlage EÜR im Jahr, zu dem sie
        gehören (§ 11 EStG). Kontovia erkennt sie an der wiederkehrenden Buchung, an der Kategorie „An Finanzamt gezahlte Umsatzsteuer“
        und an Kategorien, die Sie unter Stammdaten als „regelmäßig wiederkehrend“ kennzeichnen.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Belege</h2>
        <p>Keine Betriebsausgabe ohne Beleg. Kontovia speichert jede Rechnung verschlüsselt im
        Tresor und merkt sich eine Prüfsumme, mit der sich später nachweisen lässt,
        dass die Datei unverändert ist. Auf der Übersicht sehen Sie Ihre Belegquote.</p>
        <p>Bei Bewirtungskosten gehören der betriebliche Anlass und die Teilnehmerliste dazu.
        Schreiben Sie beides ins Notizfeld. Kontovia zieht davon automatisch nur 70 % ab.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Anschaffungen über 800 €</h2>
        <p>Eine Maschine für 5.000 € ist im Jahr des Kaufs nicht in voller Höhe abziehbar, sondern
        wird über die Nutzungsdauer verteilt. Beim Erfassen der Ausgabe wählen Sie
        „Als Anlagegut abschreiben“. Kontovia rechnet die Abschreibung monatsgenau aus, führt das
        Anlagenverzeichnis und trägt den Betrag in Zeile ${formLine(EUER.afaBeweglich, new Date().getFullYear())}
        der Anlage EÜR ein (Software und Lizenzen in Zeile ${formLine(EUER.afaImmateriell, new Date().getFullYear())}).</p>
        <ul>
          <li><strong>Computer, Notebooks, Tablets, Drucker und Software</strong> dürfen mit einem Jahr
              Nutzungsdauer voll im Jahr der Anschaffung abgezogen werden (BMF-Schreiben vom
              22.02.2022). Wählen Sie dafür die Abschreibung „1 Jahr“.</li>
          <li><strong>Degressiv</strong> geht für bewegliche Wirtschaftsgüter, die vom 01.07.2025 bis
              31.12.2027 angeschafft werden: höchstens das Dreifache der linearen Rate und höchstens 30 %
              vom Restwert (§ 7 Abs. 2 EStG). Für frühere Anschaffungen kennt Kontovia auch die älteren
              Fenster (2020 bis 2022 und April bis Dezember 2024). Kontovia wechselt
              von selbst zur linearen Rate, sobald sie höher ist.</li>
          <li><strong>Verkauf, Entnahme, Verschrottung.</strong> Scheidet ein Gut aus, tragen Sie das unter Stammdaten beim Anlagegut ein.
              Abgeschrieben wird bis zu diesem Monat, der Rest steht als Restbuchwert in der Anlage EÜR. Den Erlös buchen Sie als Einnahme
              in „Verkauf von Anlagevermögen“.</li>
          <li>Bis 800 € netto ist ein Wirtschaftsgut geringwertig und sofort voll abziehbar. Dafür
              genügt eine gewöhnliche Ausgabe.</li>
        </ul>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Rechnungen schreiben</h2>
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
        <p><strong>GiroCode.</strong> Bei Zahlung per Überweisung steht auf der Rechnung ein QR-Code. Wer ihn mit der
        Banking-App scannt, hat Empfänger, IBAN, Betrag und Rechnungsnummer schon in der Überweisung. Er erscheint, wenn
        unter Rechnungen → Gestaltung eine gültige IBAN eingetragen ist. Abschalten lässt er sich im Gestalter bei
        „Zahlung und Hinweise“. Rechnungen, die schon ausgestellt sind, ändern sich dadurch nicht.</p>
        <p><strong>Per E-Mail senden.</strong> Bei einer ausgestellten Rechnung schreibt Kontovia die E-Mail mit Betreff,
        Text und dem PDF als Anhang. Sie geht nie über einen Server von Kontovia, sondern über Ihr eigenes Konto oder
        Programm. Mit <strong>Gmail</strong> oder <strong>Outlook</strong> (Outlook.com, Microsoft 365) sendet Kontovia
        direkt; beim ersten Mal fragt Google bzw. Microsoft in einem kleinen Fenster, ob Kontovia in Ihrem Namen senden
        darf. Die E-Mail steht danach bei Ihnen unter „Gesendet“. Für andere Anbieter legt Kontovia die fertige E-Mail
        als Datei in den Download-Ordner; ein Klick darauf öffnet sie in Outlook, Thunderbird oder Apple Mail. Am
        Telefon übergibt „Teilen“ Anhang und Text an Ihre Mail-App. Den Standardtext ändern Sie direkt im Fenster.
        Kontovia vermerkt den Versand bei der Rechnung; bei den Wegen über Ihr Programm fragt es vorher, ob die E-Mail
        abgeschickt ist.</p>
        <p><strong>Kunden im Ausland.</strong> Für Leistungen an Unternehmen in einem anderen EU-Land wählen Sie „Leistung an
        Unternehmen in der EU“ (der Kunde schuldet die Steuer, die Rechnung gehört in die Zusammenfassende Meldung). Für Kunden
        außerhalb der EU, etwa in der Schweiz, in Großbritannien oder den USA, wählen Sie „Leistung an Unternehmen außerhalb der
        EU“. Bauleistungen und ähnliche Fälle an deutsche Unternehmen laufen über „Steuerschuld beim Kunden im Inland“.</p>
        <p><strong>Skonto und Ausfall.</strong> Zahlt ein Kunde mit Skonto oder gar nicht mehr, öffnen Sie die offene Buchung und
        wählen „Ausbuchen“. Kontovia berichtigt Einnahme und Umsatzsteuer im Zeitraum des Ausbuchens. Beim Kontoauszug geht das
        bei einer Teilzahlung gleich mit.</p>
        <p class="small">Der automatische Empfang von E-Rechnungen kommt mit einer der nächsten Versionen. Bis dahin
        lesen Sie eine erhaltene E-Rechnung unter Rechnungen → Eingang ein.</p>
      </div></div>

      <div class="card mt16"><div class="card-body" id="hilfe-kontoauszug">
        <h2 class="mt0">Kontoauszug einlesen</h2>
        <p>Unter <a data-go="kontoimport">Kontoauszug</a> lesen Sie die Datei ein, die Sie bei Ihrer Bank herunterladen: CSV (zum Beispiel von
        Sparkasse, Volksbank, ING oder DKB), CAMT.053 oder MT940. Die Datei wird nur im Browser auf diesem Gerät gelesen. Sie wird nicht hochgeladen
        und nirgends gespeichert, und nichts wird gebucht, bevor Sie es bestätigen.</p>
        <p><strong>Ablauf.</strong> Datei und Zahlungskonto wählen, bei CSV die Spalten prüfen (Kontovia erkennt sie meist selbst und
        merkt sich die Zuordnung für das nächste Mal), die vorgeschlagene Zuordnung durchsehen, ankreuzen und buchen. Die
        Zeichensätze (Windows-1252, ISO-8859-1, UTF-8) erkennt Kontovia selbst, Umlaute stimmen.</p>
        <p><strong>Zuordnung.</strong> Ein Eingang wird offenen Rechnungen zugeordnet, nach Rechnungsnummer im Verwendungszweck, Betrag und
        Name des Kunden. Er kann auch Rechnung plus Mahngebühr und Verzugsaufschlag decken. Ein Ausgang wird offenen Eingangsrechnungen und
        wiederkehrenden Buchungen zugeordnet. Das geschieht nach festen Regeln, nicht durch ein lernendes Verfahren. Jeder Vorschlag nennt
        seine Gründe und eine Sicherheit: <em>sicher</em> (Nummer und Betrag passen), <em>wahrscheinlich</em> (Betrag und Name passen),
        <em>unsicher</em>. Angekreuzt sind nur sichere Treffer und Ihre eigenen Regeln. Für den Rest legen Sie Regeln an: „Wenn der
        Verwendungszweck Adobe enthält, dann Kategorie Software“. Sie liegen verschlüsselt in Ihrem Tresor.</p>
        <p><strong>Kategorien vorschlagen.</strong> Für Umsätze ohne Rechnung schlägt Kontovia selbst eine Kategorie vor, ganz auf Ihrem
        Gerät und ohne dass ein Text irgendwohin gesendet wird. Zuerst gilt, was Sie bei derselben Gegenseite früher am häufigsten gewählt
        haben. Sonst erkennt Kontovia bekannte Händler und Stichwörter und ordnet sie groben Gruppen zu, etwa Lebensunterhalt,
        Abonnements, Unterhaltung, Mobilität, Wohnen, Software oder Telefon. Private Ausgaben schlägt Kontovia als Privatentnahme vor,
        damit nie etwas Privates als Betriebsausgabe landet. Vorschläge sind nie angekreuzt: Mit „Vorschläge auswählen“ übernehmen Sie sie
        auf einmal, mit „Ändern“ korrigieren Sie einzelne.</p>
        <p><strong>Wenig Zeit?</strong> Mit „Rest ohne Kategorie auswählen“ buchen Sie alles, was übrig ist, ohne Kategorie, und ordnen später in
        der Buchungsliste zu. Solche Buchungen zählen in der Steuerübersicht (Anlage EÜR) erst mit, wenn eine Kategorie gesetzt ist, und
        werden ohne Umsatzsteuer gebucht. Die Prüfung vor dem Jahresabschluss erinnert Sie daran.</p>
        <p><strong>Doppelt gebucht wird nichts.</strong> Jeder Umsatz bekommt einen Prüfwert. Dieselbe Datei noch einmal oder eine Datei mit
        überlappendem Zeitraum bucht nichts doppelt. Buchungen, die es schon gibt (auch von Hand erfasste), melden sich als mögliche Dublette.</p>
        <p><strong>Herkunft und Festschreibung.</strong> Jede Buchung nennt die Datei und den Zeitpunkt, im Journal steht sie ebenfalls. Der Zahlungseingang
        einer offenen Rechnung setzt Zahlungsdatum und Konto, wie beim Markieren als bezahlt. Ein festgeschriebener Zeitraum wird nicht
        verändert: Eine festgeschriebene offene Rechnung lässt sich bezahlen, wenn das Datum nach der Festschreibung liegt. Eine Teilzahlung
        trennt Kontovia nur bei einer offenen Buchung außerhalb der Festschreibung ab.</p>
      </div></div>

      <div class="card mt16"><div class="card-body" id="hilfe-mahnwesen">
        <h2 class="mt0">Zahlungserinnerung und Mahnung</h2>
        <p>Unter <a data-go="rechnungen">Rechnungen → Mahnungen</a> stehen alle überfälligen Rechnungen mit dem Vorschlag für die
        nächste Stufe: Zahlungserinnerung, 1. Mahnung, 2. Mahnung mit letzter Frist. Ein Klick auf „Mahnen“ öffnet das
        Fenster mit Frist, Gebühr und Verzugsaufschlag. Danach liegt das Schreiben als PDF vor, mit Ihrer Vorlage, Ihrem
        Absender und einem GiroCode über den ganzen Betrag. Jede Mahnung steht auch in der Rechnung.
        Gutschriften, bezahlte und stornierte Rechnungen werden nicht gemahnt; bei einer Teilzahlung ist der offene Rest dran.</p>
        <p><strong>Mahngebühr.</strong> Frist und Gebühr je Stufe stellen Sie unter
        <a data-go="settings">Einstellungen → Mahnwesen</a> ein. Beim Erstellen können Sie die Gebühr für das einzelne Schreiben
        ändern oder auf 0 setzen. Eine Gebühr von 0 € steht nicht auf dem Schreiben.</p>
        <p><strong>Verzugsaufschlag.</strong> Er ist ausgeschaltet, bis Sie ihn einschalten. Möglich sind Prozent pro Jahr auf den
        offenen Betrag (tageweise ab Beginn des Verzugs), eine feste Pauschale (Vorgabe 40 €, höchstens einmal je Rechnung) oder
        beides. Bei Geschäftskunden gilt gesetzlich üblich der Basiszinssatz plus 9 Prozentpunkte. Der Basiszinssatz ändert
        sich halbjährlich, deshalb tragen Sie den Satz selbst ein. Mahngebühren werden auf die Pauschale angerechnet.</p>
        <p><strong>Wann der Verzug beginnt.</strong> Ein Zahlungsziel, das nur auf der Rechnung steht, bringt den Kunden noch nicht in
        Verzug. Das tut die erste Zahlungserinnerung, bei Geschäftskunden spätestens 30 Tage nach Fälligkeit, bei Privatkunden nur,
        wenn die Rechnung darauf hinweist. Kontovia druckt diesen Hinweis auf Rechnungen an Privatkunden. Ist der Zahlungstermin mit
        dem Kunden fest vereinbart, stellen Sie in den Einstellungen „ab Fälligkeit“ ein. Die Kosten der ersten Erinnerung lassen sich
        meist nicht verlangen; Kontovia weist darauf hin.</p>
        <p><strong>Unternehmen oder Privatperson.</strong> Im Fenster wählen Sie, ob der Kunde ein Unternehmen oder eine Privatperson
        ist. Bei Privatkunden gilt der Basiszinssatz plus 5 Prozentpunkte, die Pauschale von 40 € gibt es nicht (§ 288 Abs. 5 BGB),
        und eine Mahngebühr darf nur den tatsächlichen Aufwand abdecken. Kontovia berechnet die Pauschale deshalb bei Privatkunden
        nie und warnt vor auffällig hohen Sätzen und Gebühren. Ohne USt-IdNr. oder Leitweg-ID geht Kontovia vorsichtshalber von einer
        Privatperson aus. Verzug setzt voraus, dass die Zahlungsfrist abgelaufen ist und gemahnt wurde oder 30 Tage vergangen sind (§ 286 BGB). Welche Beträge Sie verlangen,
        verantworten Sie selbst; Kontovia ersetzt keine Rechtsberatung.</p>
        <p><strong>Buchhaltung.</strong> Gebühr und Verzugsaufschlag sind kein Entgelt für eine Leistung. Sie ändern weder die
        Rechnung noch deren Umsatzsteuer, und eine festgeschriebene Rechnung bleibt, wie sie ist. Beim Erstellen der Mahnung
        wird nichts gebucht. Sobald das Geld da ist, buchen Sie es in der Rechnung mit „Mahnkosten als eingegangen buchen“: als
        eigene Einnahme ohne Umsatzsteuer, an dem Tag, an dem sie eingegangen ist. Kontovia legt dafür die Kategorie
        „Mahngebühren und Verzugsaufschlag“ an. Eine irrtümlich erstellte Mahnung nehmen Sie in der Rechnung zurück.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">E-Rechnungen empfangen (XRechnung, ZUGFeRD)</h2>
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
        <h2 class="mt0">Wiederkehrende Buchungen und Steuertermine</h2>
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
        <h2 class="mt0">Anzahlungen und der Ort der Leistung</h2>
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
        <h2 class="mt0">Termine und Rechnungen verknüpfen</h2>
        <p>Im <a data-go="calendar">Kalender</a> verknüpfen Sie einen Termin mit einer oder mehreren
        Buchungen, zum Beispiel den Montagetermin mit der dazugehörigen Rechnung. Außerdem zeigt der
        Kalender die Fälligkeiten offener Rechnungen.</p>
        ${raw(`<p><strong>Google Kalender:</strong> Unter <em>Abgleich</em> oben im
        Kalender oder unter Einstellungen → Kalender-Abgleich verbinden Sie Kontovia mit Ihrem
        Google-Konto. Kontovia legt dort einen eigenen Kalender „Kontovia“ an und gleicht in beide
        Richtungen ab. Auf dem Telefon sehen Sie Ihre Termine in der Google-Kalender-App, und was
        Sie dort im Kalender „Kontovia“ eintragen, erscheint hier. Ihre übrigen Kalender bezieht
        Kontovia nur ein, wenn Sie das ausdrücklich einschalten. Beträge, Buchungen und Kontakte
        gehen nie an Google. Ohne Google-Konto geht es per Kalenderdatei (.ics).</p>`)}
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Aufgaben, Ziele und Wiederholungen</h2>
        <p>Unter <a data-go="todos">Aufgaben</a> notieren Sie, was zu tun ist,
        und haken es ab. Eine Aufgabe kann zu einem Termin gehören, muss aber nicht. Hat sie kein
        eigenes Datum, gilt der Termin als Frist. Im Termin selbst stehen seine Aufgaben zum Abhaken
        und Ergänzen.</p>
        <p>Eine Aufgabe kann einen <strong>formatierten Text</strong> mit Überschriften, Listen, Links und Bildern
        enthalten (Bilder auch per <kbd>${MOD}</kbd>+<kbd>V</kbd> aus der Zwischenablage) sowie <strong>Unteraufgaben</strong>,
        die sich direkt in der Liste abhaken lassen. Mit <em>Verknüpft mit</em> hängen Sie sie an Buchungen, Kontakte und
        Rechnungen. Dort erscheint sie dann auch, und mit <em>+ Aufgabe</em> legen Sie dort gleich eine neue an.
        Aufgaben mit Datum stehen im Kalender. Wie weit die Liste vorausschaut (7 Tage, 4 Wochen, 1 Monat oder ein
        eigener Zeitraum), stellen Sie oben in der Liste unter <em>Vorschau</em> ein.</p>
        <p><strong>Ziele:</strong> Eine Aufgabe der Art <em>Ziel</em> hat eine Menge und eine Frist, etwa 20 Seiten
        bis Freitag. Den Stand tragen Sie als Zahl ein. Kontovia zeigt, wie viel pro Tag noch nötig ist, und rechnet
        aus Ihrem bisherigen Tempo hoch, wann Sie voraussichtlich fertig sind oder wie viele Tage Sie in Verzug wären.</p>
        <p><strong>Wiederholungen:</strong> Eine Aufgabe der Art <em>Wiederholt sich</em> kommt immer wieder, etwa jeden
        Monat. Beim Abhaken springt sie auf den nächsten Termin. Haben Sie sie eine Weile liegen lassen, holen Sie die
        verpassten Termine nicht einzeln nach: Ein Haken genügt, und sie steht beim nächsten Termin nach heute.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Zeitraum wählen und filtern</h2>
        <p><strong>Zeitraum.</strong> Oben rechts steht der gewählte Zeitraum, etwa „Jahr ${String(new Date().getFullYear())}“.
        Die Pfeile daneben blättern um genau diese Länge weiter, vom März zum April, vom
        2. zum 3. Quartal oder von einem Jahr ins nächste. Ein Klick auf den Zeitraum öffnet die
        Schnellwahl (dieser Monat, letztes Quartal …), ein Raster zum direkten Anklicken von
        Jahr, Quartal oder Monat und darunter zwei Felder für einen eigenen Zeitraum.</p>
        <p><strong>Filter in den Spaltenköpfen.</strong> In der <a data-go="transactions">Buchungsliste</a>
        filtern Sie dort, wo die Werte stehen: über den kleinen Trichter im Kopf der Spalten
        <em>Kategorie</em>, <em>Kontakt</em>, <em>Status</em> (offen, bezahlt, überfällig, dazu stornierte und
        private Buchungen), <em>Brutto</em> (nur Einnahmen oder nur Ausgaben), im Kopf der
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
        <h2 class="mt0">Die Übersicht anpassen</h2>
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
        <h2 class="mt0">Diagramme und Durchschnittswerte</h2>
        <p>In der <a data-go="dashboard">Übersicht</a> und unter <a data-go="reports">Auswertungen</a>
        schalten Sie die Darstellung mit den Knöpfen im Kopf jeder Karte um. Das geht unabhängig
        vom Zeitraum oben. Den Verlauf zeigen Sie als <strong>Säulen</strong>, <strong>Linien</strong>,
        <strong>aufgelaufene Summen</strong> oder <strong>Tabelle</strong>, die Aufteilung nach
        Kategorien als <strong>Balken</strong> oder <strong>Torte</strong>. Die Wahl merkt sich
        Kontovia auf diesem Gerät.</p>
        <p>Durchschnittswerte stehen unter den Kennzahlen („im Schnitt … je Monat“), als gestrichelte Linie im
        Verlauf und in der Karte <em>Durchschnittswerte</em> der Gewinn- und Verlustrechnung. Dort
        finden Sie auch den Wert je Buchung sowie den besten und schwächsten Monat. Gemittelt wird
        über die Monate, die schon begonnen haben, im laufenden Jahr also nicht über zwölf.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Private Buchungen</h2>
        <p>Im Buchungsdialog können Sie eine Buchung als <strong>privat</strong> kennzeichnen.
        Das ist für Vorgänge gedacht, die Sie für die eigene Übersicht festhalten wollen, die
        steuerlich aber nicht zum Betrieb gehören, etwa ein privater Einkauf, der über das Geschäftskonto lief. Private Buchungen fehlen in allen Unterlagen für Finanzamt und
        Steuerkanzlei: EÜR, Umsatzsteuer, DATEV-Stapel, Prüfungsordner, Buchungsjournal.</p>
        <p>In Übersicht und Auswertungen zählen sie nur mit, wenn Sie dort oben den Schalter
        <strong>„Private einbeziehen“</strong> setzen. Die Zahl daneben nennt, wie viele es
        im gewählten Zeitraum gibt; die Beträge stehen im Hinweis beim Darüberfahren. Der Schalter
        gilt bis zum Sperren. In der Buchungsliste zeigt ein Abzeichen, welche Buchung
        privat ist, und der Filter im Kopf der Spalte <em>Status</em> blendet sie ein oder aus.</p>
        <p class="small">Wichtig: Betriebliche Einnahmen und Ausgaben dürfen nicht als privat gekennzeichnet werden, sie müssen vollständig erklärt werden
        (§ 146 Abs. 1 AO). Das Änderungsjournal bleibt deshalb vollständig. Es verzeichnet auch
        Änderungen an privaten Buchungen, sonst wäre seine Prüfsummenkette unterbrochen.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Was beim Export herauskommt</h2>
        <ul>
          <li><strong>Anlage EÜR:</strong> Ihre Zahlen, sortiert nach den Zeilennummern des amtlichen
              Formulars. In „Mein ELSTER" nur noch abschreiben.</li>
          <li><strong>Umsatzsteuer-Voranmeldung:</strong> die Kennzahlen 81, 86, 66, 83 und weitere, auf Wunsch als Datei für
              „Mein ELSTER“. Dort öffnen Sie das Formular, wählen das Jahr und laden die Datei über den Reiter „XML-Import“ hoch.
              Wählen Sie dafür oben einen Monat oder ein Quartal.</li>
          <li><strong>DATEV-Buchungsstapel:</strong> eine Datei, die Ihre Steuerkanzlei direkt einliest.</li>
          <li><strong>Excel-Mappe:</strong> Buchungen, Anlage EÜR, Umsatzsteuer, offene Posten und Kontakte in einer Datei,
              mit Datums- und Eurozellen, mit denen Excel rechnen kann.</li>
          <li><strong>Zusammenfassende Meldung:</strong> Lieferungen und Leistungen an Unternehmen im EU-Ausland als Datei für das
              Online-Portal des Bundeszentralamts für Steuern. Dafür braucht jeder dieser Kunden seine USt-IdNr. in den Stammdaten.</li>
          <li><strong>Kontakte und Produkte:</strong> als Visitenkarten (vCard) und als Tabelle.</li>
          <li><strong>GoBD-Prüfungsordner:</strong> alle Daten maschinell auswertbar samt
              <code>index.xml</code>, so wie es bei einer Betriebsprüfung verlangt wird.</li>
        </ul>
        <p class="small">Kontovia übermittelt <strong>nichts</strong> an die Finanzverwaltung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body" id="hilfe-datenimport">
        <h2 class="mt0">Daten aus einem anderen Programm übernehmen</h2>
        <p>Unter <a data-go="datenimport">Import & Export</a>, Reiter „Import“, ziehen Sie eine Datei hinein. Kontovia erkennt selbst, was darin steht,
        liest sie nur auf diesem Gerät und übernimmt erst, wenn Sie es bestätigen.</p>
        <ul>
          <li><strong>DATEV-Format:</strong> Buchungsstapel von Ihrer Steuerkanzlei oder aus Programmen wie Lexware Office und sevDesk.
              Die Kategorie folgt aus dem Sachkonto, der Steuersatz aus dem Steuerschlüssel oder der Kategorie. Rechnung und Zahlung
              in derselben Datei werden zu einer bezahlten Buchung. Umbuchungen zwischen Sachkonten, etwa Abschreibungen, bleiben draußen.</li>
          <li><strong>Excel und CSV:</strong> Tabellen mit Buchungen, Kontakten oder Produkten. Spalten wie Datum, Betrag, Netto,
              Steuersatz, Kategorie und Kunde erkennt Kontovia an der Überschrift, auch die eigenen Exporte.</li>
          <li><strong>ELSTER:</strong> die XML-Datei einer Umsatzsteuer-Voranmeldung. Kontovia stellt die gemeldeten Werte neben die
              eigenen Buchungen und zeigt jede Abweichung. „Mein ELSTER“ selbst gibt nur einen Ausdruck als PDF aus; daraus lassen
              sich keine Werte lesen.</li>
          <li><strong>Kontakte:</strong> Visitenkarten (vCard) aus Outlook, Google oder vom Telefon und DATEV-Debitoren und -Kreditoren.</li>
        </ul>
        <p class="small">Was schon einmal übernommen wurde, erkennt Kontovia wieder; dieselbe Datei zweimal einzulesen, bucht nichts doppelt.
        Festgeschriebene Zeiträume bleiben unverändert.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Der Assistent</h2>
        <p>Öffnen Sie ihn mit <strong>Assistent</strong> in der Seitenleiste oder <kbd>${MOD}</kbd>+<kbd>J</kbd>
        und fragen Sie in Ihren Worten: „Was ist noch offen?“, „Wie viel Umsatzsteuer zahle ich dieses Quartal?“,
        „Finde die Rechnung vom Fotoshooting mit dem Garten“ oder „Erinnere mich morgen an die Belege“.</p>
        <ul>
          <li><strong>Alles bleibt auf dem Gerät.</strong> Der Assistent rechnet auf Ihrem Gerät. Fragen und Buchhaltung gehen nirgendwohin.</li>
          <li><strong>Stufen:</strong> Basis versteht feste Fragen ohne Download. Mini, Standard, Groß und Maximal sind
          Sprachmodelle, die einmalig heruntergeladen werden (350 MB bis 4,6 GB) und dann offline laufen. Kontovia
          schlägt die Stufe vor, die zu Ihrem Gerät passt.</li>
          <li><strong>Nur Basis wählbar?</strong> Dann gibt der Browser den Grafikchip nicht frei. Kontovia darf das nicht
          selbst umstellen, zeigt aber im Assistenten unter <strong>Stufe</strong> › <strong>Grafikchip freigeben</strong>
          Schritt für Schritt, wie es in Ihrem Browser geht.</li>
          <li><strong>Denkweise:</strong> Schnell antwortet direkt aus Ihren Zahlen, Ausgewogen formuliert eine kurze
          Antwort, Gründlich denkt vorher nach. Automatisch wählt je Frage.</li>
          <li><strong>Zahlen rechnet immer Kontovia.</strong> Das Modell wählt nur aus, was gesucht oder gerechnet
          wird. Unter jeder Antwort sehen Sie die Schritte und das Ergebnis als Karte.</li>
          <li><strong>Nichts wird ohne Sie gespeichert.</strong> Neue Buchungen, Aufgaben, Termine, Kontakte und
          Rechnungen öffnet der Assistent ausgefüllt im gewohnten Fenster. Speichern tun Sie.</li>
        </ul>
        <p class="mb0 small muted">Der Assistent ist neu und noch in Erprobung. Er kann eine Frage falsch verstehen und ersetzt keine Steuerberatung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Tastenkürzel</h2>
        <table class="data compact">
          <tbody>
            <tr><td><kbd>${MOD}</kbd>+<kbd>N</kbd></td><td>Neue Buchung</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>Umschalt</kbd>+<kbd>N</kbd></td><td>Neuer Termin</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>S</kbd></td><td>Sofort speichern</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>K</kbd></td><td>Alles durchsuchen: Buchungen, Rechnungen, Kontakte, Termine, Aufgaben, Seiten</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>J</kbd></td><td>Assistent öffnen und schließen</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>F</kbd></td><td>In Buchungen suchen</td></tr>
            <tr><td><kbd>${MOD}</kbd>+<kbd>L</kbd></td><td>Sperren</td></tr>
            <tr><td><kbd>Alt</kbd>+<kbd>1</kbd> … <kbd>8</kbd></td><td>Übersicht, Buchungen, Rechnungen, Kalender, Aufgaben, Auswertungen, Import &amp; Export, Stammdaten. In der installierten App geht auch <kbd>${MOD}</kbd> statt <kbd>Alt</kbd>.</td></tr>
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
        <h2 class="mt0">Wo Ihre Buchhaltung liegt</h2>
        <p>Zunächst im Speicher dieses Browsers, in einer Datenbank, die mit einem Schlüssel aus Ihrem
        Passwort verschlüsselt ist. Den Speicher darf der Browser bei Platzmangel räumen; auf iPhone und
        iPad gehört deshalb die Cloud-Sicherung oder eine regelmäßige Vollsicherung dazu.</p>
        <p>Beim Speichern legt Kontovia höchstens alle 30 Minuten eine Sicherung ab. Unter
        <a data-go="settings">Einstellungen → Daten &amp; Cloud</a> sehen Sie sie und holen bei Bedarf eine
        zurück. Der Stand von vor Version 2.26 bleibt dort dauerhaft.</p>
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
        <h2 class="mt0">Wann Kontovia sich sperrt</h2>
        <p>Nach der eingestellten Zeit ohne Eingabe, nach drei Minuten in einer anderen App oder einem
        anderen Tab, nach dem Ruhezustand des Geräts und wenn Kontovia in einem zweiten Fenster geöffnet
        wird. Sofort mit <kbd>${MOD}</kbd>+<kbd>L</kbd>.</p>
        <p class="mb0">Dass der Bildschirm gesperrt wurde, melden nur Chrome und Edge, und nur mit Ihrer
        Erlaubnis: unter <a data-go="settings">Einstellungen → Sicherheit</a>. Safari und Firefox melden es
        nicht. Auf iPhone und iPad hält Safari Kontovia beim Sperren des Bildschirms an; nach dem Entsperren
        gilt dann die Regel für den Hintergrund.</p>
      </div></div>
      <div class="card mb16"><div class="card-body">
        <h2 class="mt0">Entsperren, Sperren, Wechseln und Entfernen</h2>
        <p><strong>Sperren</strong> schließt nur den Tresor. <strong>Von diesem Gerät entfernen</strong> (im Menü am Namen oben
        in der Seitenleiste) entfernt das offene Konto mit Buchhaltung, Belegen und allen Zugängen von diesem Gerät. Ist es mit Google
        verbunden, gleicht Kontovia vorher von selbst ab und entfernt es erst danach. Klappt der Abgleich nicht,
        etwa ohne Netz, bleibt alles stehen, bis Sie entscheiden. Ohne Google-Verbindung weist Kontovia deutlich darauf hin,
        dass es Ihre Buchhaltung dann nur noch in einer Sicherung gäbe.</p>
        <p><strong>Mehrere Konten:</strong> Mit einem Klick auf den Namen oben in der Seitenleiste wechseln Sie zu einem
        anderen Konto auf diesem Gerät oder fügen ein weiteres hinzu, zum Beispiel für einen zweiten Betrieb. Jedes Konto hat sein
        eigenes Passwort und ist von den anderen getrennt. Vor dem Wechsel gleicht Kontovia ab, wenn das Konto mit Google
        verbunden ist. Ein Google-Konto passt zu genau einem Konto auf dem Gerät. Unter
        <a data-go="settings">Einstellungen → Konten auf diesem Gerät</a> sehen Sie alle Konten mit dem Zeitpunkt, zu dem sie zuletzt
        offen waren, geben ihnen eine eigene Bezeichnung und entfernen eines, das Sie nicht mehr brauchen. Auf dem Sperrbildschirm
        erscheinen die Namen der anderen Konten erst nach „Konto wechseln“, damit sie nicht jeder sieht, der vor dem Gerät sitzt.</p>
        <p><strong>Mehrere Personen in einem Konto:</strong> Unter <a data-go="settings">Einstellungen → Benutzer in diesem Konto</a>
        legen Sie Benutzer an, etwa für Mitarbeitende oder die Steuerberatung. Nach dem Entsperren fragt Kontovia dann, wer arbeitet
        (auf Wunsch mit einer PIN), und das Änderungsjournal vermerkt bei jeder Änderung den Namen. Die Rolle bestimmt, was jemand
        darf: <em>Inhaber</em> alles, <em>Mitarbeit</em> Buchungen, Rechnungen, Kontakte, Termine und Aufgaben, aber keine Einstellungen,
        <em>Nur lesen</em> ansehen, auswerten und exportieren. Rollen sind keine Zugriffssperre: Wer das Passwort des Kontos kennt,
        kommt an alle Daten. Wer getrennte Daten braucht, legt ein eigenes Konto an.</p>
        <p>Neben dem Passwort lässt sich unter <a data-go="settings">Einstellungen → Sicherheit</a>
        <strong>Fingerabdruck oder Gesicht</strong> einschalten (nur auf diesem Gerät, der Schlüssel bleibt im Sicherheitschip).
        Das Passwort bleibt immer gültig.</p>
        <p class="mb0">Ist Kontovia mit Google verbunden, gibt es unter <a data-go="settings">Einstellungen → Daten &amp; Cloud</a>
        außerdem <strong>Mit Google entsperren</strong>. <strong>Das ist ein großes Sicherheitsrisiko:</strong> Der Schlüssel zu Ihrer
        Buchhaltung liegt dann unverschlüsselt im Cloud-Speicher, und Ihre Daten sind nur noch durch das Passwort Ihres
        Google-Kontos geschützt. Wer Ihr Google-Konto übernimmt, kann alles lesen. Wir raten davon ab.</p>
      </div></div>
      <div class="card mb16"><div class="card-body">
        <h2 class="mt0">Rückmeldung geben</h2>
        <p class="mb0">Mit <strong>Feedback</strong> unten in der Seitenleiste schreiben Sie uns frei, was Ihnen
        auffällt. Auf Wunsch geht ein Bild der Seite mit, auf der Sie waren, ohne das Rückmeldefenster. Mit
        <strong>Senden</strong> geht Ihre Nachricht unverschlüsselt an das Kontovia-Team; <strong>andere Nutzer sehen sie nicht</strong>.
        Eine Kopie bleibt verschlüsselt auf Ihrem Gerät. Dabei werden nur Art, Text, Name der Seite,
        Programmversion und Fenstergröße übertragen, nichts aus Ihrer Buchhaltung, kein Name und keine
        E-Mail-Adresse. Das Bild geht nur mit, wenn Sie es ankreuzen. Schreiben Sie bitte keine Passwörter,
        Kontonummern oder Namen Ihrer Kunden hinein.</p>
      </div></div>
      <div class="card"><div class="card-body">
        <h2 class="mt0">Cloud-Abgleich einschalten</h2>
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
        Das sind weder Google noch der Hersteller von Kontovia. Das gilt, solange Sie „Mit Google entsperren“ ausgeschaltet lassen.</div>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Zweites Gerät anschließen</h2>
        <p>Öffnen Sie Kontovia dort und klicken Sie beim ersten Start auf
        <strong>Mit Google anmelden</strong>, mit demselben Google-Konto wie auf dem ersten Gerät. Kontovia findet Ihre Buchhaltung im Konto.
        Zum Öffnen haben Sie zwei Wege:</p>
        <ul>
          <li><strong>Mit QR-Code (empfohlen):</strong> Auf dem ersten Gerät zeigen Sie unter
              <a data-go="settings">Einstellungen → Weitere Geräte</a> mit <em>Neues Gerät hinzufügen</em> einen QR-Code.
              Auf dem neuen Gerät wählen Sie <em>Mit QR-Code vom anderen Gerät öffnen</em> und scannen ihn. Das erste Gerät zeigt den Namen des neuen
              und wartet auf Ihr Ja. Weder Google noch wir können Ihre Buchhaltung dabei lesen: Das Google-Konto allein genügt nicht, der Code allein auch nicht.
              Der Code gilt fünf Minuten und nur einmal. Kann der Browser den Code nicht lesen (etwa Safari auf dem iPhone), halten Sie die Kamera-App
              Ihres Handys auf den Code oder tippen Sie den Code von Hand ein.</li>
          <li><strong>Mit Passwort:</strong> Geben Sie das Passwort des ersten Geräts ein.</li>
        </ul>
        <p>Ab da arbeiten beide Geräte auf demselben Bestand; die Belege kommen beim ersten Abgleich nach.
        Auf dem neuen Gerät können Sie danach Fingerabdruck oder Gesicht einschalten, dann entfällt das Tippen des Passworts.</p>
        <div class="notice warn"><strong>Gut zu wissen.</strong> Ein verbundenes Gerät kann Ihre Buchhaltung dauerhaft öffnen, solange es entsperrt ist.
        Schützen Sie es mit einer Bildschirmsperre. Geht es verloren, lässt sich sein Zugang derzeit nicht einzeln zurückrufen.</div>
        <p class="small muted mb0">Haben Sie dort schon einen Tresor angelegt: unter
        <a data-go="settings">Einstellungen → Cloud-Abgleich</a> verbinden. Kontovia erkennt die
        Buchhaltung in der Cloud und bietet <strong>Cloud-Stand übernehmen</strong> an; der
        Tresor des Geräts wird vorher gesichert.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Bestätigung alle 30 Tage</h2>
        <p>Ein mit Google verbundenes Gerät fragt von selbst, beim Entsperren und danach alle paar Stunden, bei Ihrem Konto nach, ob es noch zugelassen ist.
        Dabei wird nur gelesen; es gehen keine Angaben zu Ihrer Buchhaltung hinaus. So kann der Betreiber ein verlorenes oder nicht mehr berechtigtes Gerät
        vom Konto trennen. Sie müssen nichts tun. Haben Sie ein Gerät länger als drei Wochen nicht geöffnet, erinnert Kontovia freundlich; unter
        <a data-go="settings">Einstellungen → Zulassung dieses Geräts</a> bestätigen Sie mit einem Klick.</p>
        <ul>
          <li>Ohne Internet oder bei einer Störung <strong>passiert nichts</strong> außer Hinweisen. Ihre Buchhaltung wird nie gelöscht, nur weil eine Prüfung nicht klappt.</li>
          <li>Nur wenn Ihr Konto ausdrücklich gesperrt wird, entfernt Kontovia die Buchhaltung von diesem Gerät, frühestens nach einem Tag,
              und erst, nachdem sie gesichert in der Cloud liegt. Die Cloud-Kopie bleibt erhalten; nach einer Klärung melden Sie sich wieder an und laden sie.
              Lässt sie sich nicht sichern, wird nichts gelöscht, sondern das Gerät nur vom Abgleich getrennt. Dann legen Sie bitte eine Vollsicherung an.</li>
          <li>Ist die Bestätigung lange überfällig und ein Gerät hat gar kein Internet, öffnet Kontovia erst wieder, wenn es einmal online war. Ihre Buchhaltung ist dabei unverändert.</li>
          <li>Mit <em>Verbindung trennen</em> endet die Prüfung.</li>
        </ul>
        <p class="small muted mb0">Das ist kein vollständiger Schutz: Wer ein Gerät nie öffnet, wird auch nicht gefragt. Es hilft vor allem bei der gewöhnlichen Nutzung eines abhandengekommenen Geräts.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Sicherungen in der Cloud</h2>
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
        <h2 class="mt0">Was passiert, wenn beide Geräte dasselbe ändern?</h2>
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
        <h2 class="mt0">Google Kalender</h2>
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
        <h2 class="mt0">Verbindung trennen</h2>
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

/** Wann dieses Konto den Nutzungsbedingungen zugestimmt hat. */
function nutzungStand() {
  const n = store.db?.settings?.nutzung;
  return raw(n?.am ? `<p class="tiny muted mt8 mb0">Zugestimmt am ${esc(fmtDate(String(n.am).slice(0, 10)))}, Fassung vom ${esc(fmtDate(n.version))}.</p>` : '');
}

function recht(root) {
  root.innerHTML = html`
    <div class="content narrow" style="padding:0">
      <div class="card"><div class="card-body">
        <h2 class="mt0">Über dieses Programm</h2>
        <table class="data compact">
          <tbody>
            <tr><td class="muted">Programm</td><td>Kontovia ${appInfo.version || ''}</td></tr>
            <tr><td class="muted">Ablage</td><td class="tiny">${appInfo.dataDir || ''}</td></tr>
            <tr><td class="muted">Verschlüsselung</td><td>AES-256, der Schlüssel entsteht aus Ihrem Passwort</td></tr>
          </tbody>
        </table>
      </div></div>

      <div class="card mt16" id="recht-anbieter"><div class="card-body">
        <h2 class="mt0">Anbieter und Bedingungen</h2>
        <p>Wer Kontovia anbietet, wie Sie ihn erreichen und unter welchen Bedingungen Sie das Programm nutzen, steht im Impressum
        und in den Nutzungsbedingungen. Beide sind auch auf der Webseite von Kontovia ohne Anmeldung abrufbar.</p>
        <div class="row wrap" style="gap:8px">
          <button class="btn" data-recht="impressum">${icon('file', 15)} Impressum</button>
          <button class="btn" data-recht="nutzung">${icon('file', 15)} Nutzungsbedingungen</button>
        </div>
        ${nutzungStand()}
      </div></div>

      <div class="card mt16" id="recht-datenschutz"><div class="card-body">
        <h2 class="mt0">Datenschutz</h2>
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
        <h2 class="mt0">Künstliche Intelligenz</h2>
        <p><strong>Die Buchhaltung selbst arbeitet ohne.</strong> Jede Zuordnung folgt einer Tabelle,
        die Sie selbst pflegen; jede Berechnung, jeder Bericht und jeder Export folgt festen
        Rechenregeln. Gleiche Eingabe ergibt immer dieselbe Ausgabe. Kein Modell wird mit Ihren
        Daten trainiert.</p>
        <p><strong>Der Assistent ist freiwillig.</strong> In der Stufe Basis arbeitet auch er nur mit
        festen Regeln. Wählen Sie eine der Stufen Mini bis Maximal, antwortet ein Sprachmodell
        (Qwen3, Apache 2.0), also ein KI-System. Es läuft ausschließlich auf Ihrem Gerät, in einer
        festen, geprüften Fassung, lernt nichts dazu und sendet nichts. Es wählt nur aus, welche
        Suche oder Rechnung Kontovia ausführt; die Zahlen selbst rechnet Kontovia. Antworten aus
        dem Modell sind im Assistenten als solche gekennzeichnet.</p>
        <p class="mb0">Ohne Assistent ist die KI-Verordnung der EU (Verordnung (EU) 2024/1689) auf
        Kontovia nicht anwendbar: Erwägungsgrund 12 nimmt Systeme aus, die auf ausschließlich von
        Menschen definierten Regeln beruhen.</p>
      </div></div>

      <div class="card mt16" id="recht-export"><div class="card-body">
        <h2 class="mt0">Darf ich die Exporte beim Finanzamt verwenden?</h2>
        <p><strong>Ja, als Arbeitshilfe, so wie die Ausgaben jedes anderen Buchhaltungsprogramms.</strong>
        Beim Finanzamt kommt nicht der Export an, sondern Ihre Erklärung, die Sie in „Mein ELSTER“
        abgeben. Für deren Richtigkeit sind Sie verantwortlich, gleich mit welchem Programm oder ob
        von Hand vorbereitet. Eine Zulassung oder Zertifizierung von Buchhaltungsprogrammen gibt es
        nicht; Bescheinigungen Dritter binden das Finanzamt ausdrücklich nicht (GoBD Rz. 181).</p>
        <p><strong>Ein KI-Hinweis ist nicht nötig.</strong> Die Werte in den Exporten entstehen nach
        festen Rechenregeln aus Ihren Buchungen; künstliche Intelligenz wirkt dabei nicht mit. Die
        Kennzeichnungspflichten der KI-Verordnung (Art. 50, seit 2. August 2026) betreffen Inhalte, die
        ein KI-System erzeugt. Exporte und Berichte erzeugt Kontovia nach festen Regeln, auch wenn Sie
        den Assistenten nutzen. Auch das Steuerrecht kennt keine Pflicht,
        anzugeben, womit eine Erklärung vorbereitet wurde. Freiwillig und zur Transparenz trägt jeder
        Bericht einen Herkunftsvermerk.</p>
        <p><strong>Wer lieber selbst zusammenstellt,</strong> kann das: Die Tabellen unter
        <a data-go="export">Export</a> (CSV) enthalten die Rohdaten, und die Werte für ELSTER tragen Sie
        ohnehin selbst ein. Im Zweifel lohnt ein einmaliger Abgleich der Zuordnungen mit der
        Steuerberatung.</p>
        <p class="small muted mb0">Eine sorgfältige Einschätzung, keine Rechtsberatung.</p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Lizenzen</h2>
        <p>Kontovia läuft in Ihrem Browser; für ihn gelten dessen Lizenzbedingungen. Fremden
        Programmcode enthält Kontovia nur für den Assistenten: <strong>WebLLM</strong> (MLC, Apache 2.0)
        mit der TVM-Laufzeit und XGrammar (Apache 2.0) sowie loglevel (MIT). Die Sprachmodelle
        <strong>Qwen3</strong> (Alibaba Cloud, Apache 2.0) werden erst auf Wunsch heruntergeladen.</p>
        <p class="mb0"><strong>Schrift Geist.</strong> Copyright 2024 The Geist Project Authors
        (github.com/vercel/geist-font), lizenziert unter der SIL Open Font License 1.1. Sie wird mit
        Kontovia ausgeliefert und in die PDF-Dateien eingebettet; Verkauf der Schrift für sich allein
        ist ausgeschlossen, Nutzung und Weitergabe im Programm sind erlaubt.
        <a href="#" data-recht="schrift">Lizenztext lesen</a></p>
      </div></div>

      <div class="card mt16"><div class="card-body">
        <h2 class="mt0">Marken Dritter</h2>
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
  root.querySelectorAll('[data-recht]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); rechtstextZeigen(b.dataset.recht); }));
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
    a.style.textDecoration = 'underline';
    a.setAttribute('role', 'link');
    a.setAttribute('tabindex', '0');
    a.addEventListener('click', () => navigate(a.dataset.go));
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(a.dataset.go); });
  });
}
