/**
 * Wörterbuch Englisch: Antworten des Assistenten, von Hand gepflegt.
 *
 * Die Werkzeuge des Assistenten setzen ihre Sätze aus Teilen zusammen
 * (Mehrzahl, „mit Telefon“, „mit Netto“ …). scripts/sprache.js findet davon
 * nur die einzelnen Teile; hier stehen die Sätze, wie sie zur Laufzeit entstehen,
 * jede Form für sich. Platzhalter folgen der Reihenfolge im Satz.
 */

const W = {};
const add = (de, en) => { W[de] = en; };

// Suchen
add('Ich habe {0} Treffer zu „{1}“ gefunden.', 'I found {0} results for “{1}”.');
add('Ich habe 1 Treffer zu „{0}“ gefunden.', 'I found 1 result for “{0}”.');
add('Zu „{0}“ habe ich nichts gefunden. Versuchen Sie es mit einem anderen Wort.', 'I found nothing for “{0}”. Try another word.');

// Buchungen im Zeitraum, mit Summen
for (const [de, en] of [['Buchungen', 'transactions'], ['Buchung', 'transaction']]) {
  add(`{0} ${de} im Zeitraum {1}.`, `{0} ${en} in the period {1}.`);
  add(`{0} ${de} im Zeitraum {1}, Einnahmen {2}.`, `{0} ${en} in the period {1}, income {2}.`);
  add(`{0} ${de} im Zeitraum {1}, Ausgaben {2}.`, `{0} ${en} in the period {1}, expenses {2}.`);
  add(`{0} ${de} im Zeitraum {1}, Einnahmen {2}, Ausgaben {3}.`, `{0} ${en} in the period {1}, income {2}, expenses {3}.`);
}
add('Im Zeitraum {0} gibt es keine passenden Buchungen.', 'There are no matching transactions in the period {0}.');

// Rechnungen
for (const [de, en] of [['Rechnungen', 'invoices'], ['Rechnung', 'invoice']]) {
  add(`{0} ${de}, zusammen {1}.`, `{0} ${en}, totalling {1}.`);
  add(`{0} ${de} für {1}, zusammen {2}.`, `{0} ${en} for {1}, totalling {2}.`);
}
add('Keine passenden Rechnungen für {0}.', 'No matching invoices for {0}.');

// Kategorien, Kontakte, Vergleich
add('Größter Posten {0}: {1} mit {2} ({3}).', 'Largest item {0}: {1} with {2} ({3}).');
add('Stärkster Kunde {0}: {1} mit {2}.', 'Top customer {0}: {1} with {2}.');
add('Größter Lieferant {0}: {1} mit {2}.', 'Largest supplier {0}: {1} with {2}.');
add('Gewinn {0}: {1}, {2}: {3}, Unterschied {4}.', 'Profit {0}: {1}, {2}: {3}, difference {4}.');
add('{0} gegenüber {1}', '{0} vs. {1}');

// Termine und Aufgaben
for (const [de, en] of [['Termine', 'appointments'], ['Termin', 'appointment']]) {
  add(`{0} ${de} im Zeitraum {1}.`, `{0} ${en} in the period {1}.`);
}
for (const [adj, enAdj] of [['offene', 'open'], ['erledigte', 'completed']]) {
  for (const [de, en] of [['Aufgaben', 'tasks'], ['Aufgabe', 'task']]) {
    add(`{0} ${adj} ${de}.`, `{0} ${enAdj} ${en}.`);
    add(`{0} ${adj} ${de}, als Nächstes fällig: „{1}“ am {2}.`, `{0} ${enAdj} ${en}, next due: “{1}” on {2}.`);
  }
}

// Kontakt: Name, Telefon, Mail, Umsatz, offen
for (const tel of [false, true]) {
  for (const mail of [false, true]) {
    for (const offen of [false, true]) {
      let n = 1;
      const de = `{0}${tel ? `, Telefon {${n++}}` : ''}${mail ? `, {${n++}}` : ''}. Einnahmen in den letzten 12 Monaten: {${n++}}${offen ? `, offen: {${n++}}` : ''}.`;
      n = 1;
      const en = `{0}${tel ? `, phone {${n++}}` : ''}${mail ? `, {${n++}}` : ''}. Income in the last 12 months: {${n++}}${offen ? `, open: {${n++}}` : ''}.`;
      add(de, en);
    }
  }
}

// „Was ansteht“
add('{0} eigene Rechnung bald zu zahlen', '{0} own invoice due soon');
add('{0} eigene Rechnungen bald zu zahlen', '{0} own invoices due soon');
add('{0} überfällige Kundenrechnung über {1}', '{0} overdue customer invoice totalling {1}');
add('{0} überfällige Kundenrechnungen über {1}', '{0} overdue customer invoices totalling {1}');

// Vorschläge
add('Ich habe eine Einnahme über {0} vorbereitet. Prüfen Sie die Angaben und speichern Sie.', 'I have prepared an income entry of {0}. Check the details and save.');
add('Ich habe eine Ausgabe über {0} vorbereitet. Prüfen Sie die Angaben und speichern Sie.', 'I have prepared an expense of {0}. Check the details and save.');
add('Ich habe die Aufgabe „{0}“ für {1} vorbereitet.', 'I have prepared the task “{0}” for {1}.');
add('Ich habe die Aufgabe „{0}“ vorbereitet.', 'I have prepared the task “{0}”.');
add('Ich habe den Termin „{0}“ am {1} um {2} vorbereitet.', 'I have prepared the appointment “{0}” on {1} at {2}.');
add('Ich habe den Termin „{0}“ am {1} vorbereitet.', 'I have prepared the appointment “{0}” on {1}.');
add('Achtung: „{0}“ gibt es schon. Ich habe den neuen Kontakt trotzdem vorbereitet.', 'Note: “{0}” already exists. I have prepared the new contact anyway.');
add('Ich habe den Kontakt „{0}“ vorbereitet.', 'I have prepared the contact “{0}”.');
add('Ich habe eine Rechnung an {0} vorbereitet über {1} netto.', 'I have prepared an invoice to {0} for {1} net.');
add('Ich habe eine Rechnung an {0} vorbereitet.', 'I have prepared an invoice to {0}.');
add('Ich habe eine Rechnung vorbereitet über {0} netto.', 'I have prepared an invoice for {0} net.');
add('Ich habe eine Rechnung vorbereitet.', 'I have prepared an invoice.');
add('Ich habe die Zahlung zu „{0}“ von {1} über {2} vorbereitet, bezahlt am {3}. Prüfen und bestätigen Sie im Fenster.', 'I have prepared the payment for “{0}” from {1} of {2}, paid on {3}. Check and confirm it in the window.');
add('Ich habe die Zahlung zu „{0}“ über {1} vorbereitet, bezahlt am {2}. Prüfen und bestätigen Sie im Fenster.', 'I have prepared the payment for “{0}” of {1}, paid on {2}. Check and confirm it in the window.');
add('Rechnung {0} an {1} ist seit {2} überfällig, offen {3}. Ich habe die {4} vorbereitet; prüfen Sie sie im Fenster.', 'Invoice {0} to {1} has been overdue for {2}, {3} outstanding. I have prepared the {4}; check it in the window.');
add('Rechnung {0} ist seit {1} überfällig, offen {2}. Ich habe die {3} vorbereitet; prüfen Sie sie im Fenster.', 'Invoice {0} has been overdue for {1}, {2} outstanding. I have prepared the {3}; check it in the window.');

// Kleine Bausteine der Karten
add('noch nicht gebucht', 'not booked yet');
add('nicht eingestellt', 'not set');
add('eingestellt', 'set');
add('bitte wählen', 'please choose');

// Projekte, Zeiten, Angebote, Kasse, Liquidität (2.38)
for (const [de, en] of [
  ['Liest die Projekte', 'Reading the projects'], ['Zählt die Arbeitszeit', 'Adding up working time'], ['Liest die Angebote', 'Reading the quotes'],
  ['Liest das Kassenbuch', 'Reading the cash book'], ['Rechnet die Liquidität voraus', 'Forecasting liquidity'], ['Bereitet die Zeit vor', 'Preparing the time entry'],
  ['Bereitet ein Projekt vor', 'Preparing a project'], ['Bereitet ein Projekt vor.', 'Prepares a project.'],
  ['„{0}“ gibt es noch nicht als Kontakt. Tragen Sie den Kunden im Beleg ein.', '“{0}” is not a contact yet. Enter the customer in the document.'],
  ['Er beantwortet Fragen zu Ihrer Buchhaltung und zur Bedienung, sagt, was heute ansteht, sucht Einträge, rechnet und öffnet Bereiche. Neue Buchungen, Aufgaben, Termine, Kontakte, Rechnungen, Angebote und Projekte bereitet er vor, ebenso Arbeitszeiten, Zahlungseingänge und Mahnungen; speichern tun Sie selbst, im gewohnten Fenster.',
    'It answers questions about your bookkeeping and how to use the app, tells you what is due today, finds entries, calculates and opens sections. It prepares new transactions, tasks, appointments, contacts, invoices, quotes and projects, as well as working time, incoming payments and dunning letters; you save them yourself, in the usual window.'],
  ['{0} Er beantwortet Fragen zu Ihrer Buchhaltung und zur Bedienung, sagt, was heute ansteht, sucht Einträge, rechnet und öffnet Bereiche. Neue Buchungen, Aufgaben, Termine, Kontakte, Rechnungen, Angebote und Projekte bereitet er vor, ebenso Arbeitszeiten, Zahlungseingänge und Mahnungen; speichern tun Sie selbst, im gewohnten Fenster.',
    '{0} It answers questions about your bookkeeping and how to use the app, tells you what is due today, finds entries, calculates and opens sections. It prepares new transactions, tasks, appointments, contacts, invoices, quotes and projects, as well as working time, incoming payments and dunning letters; you save them yourself, in the usual window.'],
  ['0,5 stunden', '0.5 hours'], ['0,25 stunden', '0.25 hours'], ['{0} Std.', '{0} h'],
  ['Projekt „{0}“', 'Project “{0}”'], ['Projekt „{0}“{1}', 'Project “{0}”{1}'], ['Projekt „{0}“ für {1}', 'Project “{0}” for {1}'],
  ['Sucht Buchungen, Rechnungen, Kontakte, Termine, Aufgaben, Projekte. Schreibweisen mit | trennen.', 'Searches transactions, invoices, contacts, appointments, tasks, projects. Separate spellings with |.'],
  ['Bank- und Kassenkonten; art kasse = Kassenbuch, vorschau = Stand der nächsten Tage.', 'Bank and cash accounts; art kasse = cash book, vorschau = balance over the next days.'],
  ['Alle Angaben zu einem Eintrag (id aus Ergebnis oder geöffnetem Eintrag).', 'All details of an entry (id from a result or the opened entry).'],
  ['Projekte mit Stunden, Ergebnis, Budget; mit name eines genau.', 'Projects with hours, result, budget; with name one in detail.'],
  ['Es gibt noch keine Projekte. Legen Sie eins unter Projekte an oder sagen Sie zum Beispiel „Neues Projekt Website für Café Sonne“.', 'There are no projects yet. Create one under Projects or say, for example, “New project Website for Café Sonne”.'],
  ['für {0}: {1} erfasst.', 'for {0}: {1} recorded.'], ['{0} für {1}: {2} erfasst.', '{0} for {1}: {2} recorded.'], [': {0} erfasst.', ': {0} recorded.'], ['{0}: {1} erfasst.', '{0}: {1} recorded.'],
  ['Davon {0} noch nicht abgerechnet ({1}).', 'Of that, {0} not yet billed ({1}).'], ['Ergebnis {0} netto.', 'Result {0} net.'], ['Budget verbraucht: {0}.', 'Budget used: {0}.'], ['{0} % von {1}', '{0}% of {1}'],
  ['abgeschlossenes Projekt', 'completed project'], ['abgeschlossene Projekte', 'completed projects'], ['laufendes Projekt', 'running project'], ['laufende Projekte', 'running projects'],
  ['{0} laufende Projekte.', '{0} running projects.'], ['1 laufendes Projekt.', '1 running project.'], ['{0} abgeschlossene Projekte.', '{0} completed projects.'], ['1 abgeschlossenes Projekt.', '1 completed project.'],
  ['{0} Projekte.', '{0} projects.'], ['1 Projekt.', '1 project.'],
  ['Abgeschlossene Projekte', 'Completed projects'], ['Projekte öffnen', 'Open projects'], ['Keine passenden Projekte.', 'No matching projects.'],
  ['Ein Projekt „{0}“ finde ich nicht.', 'I cannot find a project “{0}”.'], ['Noch nicht abgerechnet: {0}.', 'Not yet billed: {0}.'],
  ['Arbeitsstunden und laufende Stoppuhr; nur_offene = nicht abgerechnet.', 'Working hours and running timer; nur_offene = not yet billed.'],
  ['diese Woche', 'this week'], ['Ohne Projekt', 'No project'], ['Nicht abgerechnete Zeiten', 'Unbilled time'], ['Noch abzurechnen', 'Still to bill'],
  ['Stoppuhr läuft:', 'Timer running:'], ['Stoppuhr läuft: {0}', 'Timer running: {0}'], ['seit {0} Uhr', 'since {0}'], ['Zeiten öffnen', 'Open time tracking'],
  ['In diesem Zeitraum sind keine Zeiten erfasst.', 'No time is recorded in this period.'], ['Im Zeitraum {0} sind keine Zeiten offen.', 'No unbilled time in the period {0}.'],
  ['Im Zeitraum {0} sind keine Zeiten erfasst.', 'No time is recorded in the period {0}.'],
  [': {0} für {1} noch nicht abgerechnet.', ': {0} for {1} not yet billed.'], ['{0}: {1} für {2} noch nicht abgerechnet.', '{0}: {1} for {2} not yet billed.'],
  [': {0} für {1} erfasst.', ': {0} for {1} recorded.'], ['{0}: {1} für {2} erfasst.', '{0}: {1} for {2} recorded.'],
  [': {0} noch nicht abgerechnet.', ': {0} not yet billed.'], ['{0}: {1} noch nicht abgerechnet.', '{0}: {1} not yet billed.'],
  ['Wert zum Stundensatz: {0}.', 'Value at the hourly rate: {0}.'], ['Die Stoppuhr läuft seit {0} Uhr für {1}.', 'The timer has been running since {0} for {1}.'],
  ['Angebote, Auftragsbestätigungen, Lieferscheine.', 'Quotes, order confirmations, delivery notes.'],
  ['Abgelaufene Angebote', 'Expired quotes'], ['Angenommene Angebote', 'Accepted quotes'], ['Abgelehnte Angebote', 'Declined quotes'], ['Berechnete Angebote', 'Invoiced quotes'],
  ['Angebote öffnen', 'Open quotes'], ['Keine passenden Angebote.', 'No matching quotes.'], ['{0} gefunden.', '{0} found.'],
  ['{0} Belege gefunden.', '{0} documents found.'], ['1 Beleg gefunden.', '1 document found.'],
  ['Offene Angebote: {0} über {1}.', 'Open quotes: {0} totalling {1}.'], ['{0} Angebote', '{0} quotes'], ['1 Angebot', '1 quote'], ['gültig bis {0}', 'valid until {0}'],
  ['Barkasse: Bestand, Ein- und Auszahlungen.', 'Petty cash: balance, cash in and cash out.'],
  ['Es gibt keine Kasse. Legen Sie unter Stammdaten bei den Zahlungskonten ein Konto der Art Kasse an.', 'There is no cash account. Create an account of the type Cash under Master data, Payment accounts.'],
  ['am {0}:', 'on {0}:'], ['{0} am {1}: {2}', '{0} on {1}: {2}'], ['{0} am {1}', '{0} on {1}'],
  ['Fehlbestand: {0}. Eine Kasse kann nie unter null fallen.', 'Cash shortfall: {0}. A cash box can never go below zero.'],
  ['Kassenbuch öffnen', 'Open cash book'], [': Bestand {0} am {1}.', ': balance {0} on {1}.'], ['{0}: Bestand {1} am {2}.', '{0}: balance {1} on {2}.'], ['Achtung, Fehlbestand: {0}.', 'Warning, cash shortfall: {0}.'],
  ['Vorschau des Kontostands der nächsten Tage.', 'Forecast of the account balance for the coming days.'],
  ['die nächsten {0} Tage', 'the next {0} days'], ['In {0} Tagen', 'In {0} days'], ['Tiefster Stand', 'Lowest point'], ['· überfällig, erhofft', '· overdue, hoped for'], ['überfällig, erhofft', 'overdue, hoped for'],
  ['Am {0} fehlen voraussichtlich {1}.', 'On {0} you will probably be {1} short.'], ['Liquidität öffnen', 'Open cash flow'], ['{0} Std. offen', '{0} h open'],
  ['Es ist nichts Offenes oder Wiederkehrendes geplant.', 'Nothing open or recurring is planned.'],
  ['Heute {0} auf allen Konten.', 'Today {0} across all accounts.'], ['In {0} Tagen voraussichtlich {1}.', 'In {0} days probably {1}.'], ['Am tiefsten am {0} mit {1}.', 'Lowest on {0} at {1}.'],
  ['Dann reicht das Geld nicht; prüfen Sie offene Forderungen.', 'The money will not last then; check your open receivables.'],
  ['Öffnet einen Bereich: {0}. Reiter auch mit Namen, z. B. mahnwesen, angebote, ust, euer, opos, kassenbuch, liquiditaet, kategorien, zeiten.', 'Opens a section: {0}. Tabs also by name, e.g. mahnwesen, angebote, ust, euer, opos, kassenbuch, liquiditaet, kategorien, zeiten.'],
  ['Bereitet eine Rechnung vor (oder mit art ein Angebot usw.).', 'Prepares an invoice (or, with art, a quote etc.).'],
  ['Neue Auftragsbestätigung', 'New order confirmation'], ['Neuer Lieferschein', 'New delivery note'],
  ['ein Angebot', 'a quote'], ['eine Auftragsbestätigung', 'an order confirmation'], ['einen Lieferschein', 'a delivery note'], ['eine Rechnung', 'an invoice'],
  ['Ich habe {0}{1} vorbereitet{2}.', 'I have prepared {0}{1}{2}.'],
  ['Bereitet Arbeitszeit für ein Projekt vor (stoppuhr: true = Stoppuhr starten).', 'Prepares working time for a project (stoppuhr: true = start the timer).'],
  ['Es gibt noch kein laufendes Projekt. Legen Sie zuerst eins an, etwa mit „Neues Projekt …“.', 'There is no running project yet. Create one first, for example with “New project …”.'],
  ['Ein Projekt „{0}“ finde ich nicht; bitte im Fenster wählen.', 'I cannot find a project “{0}”; please choose it in the window.'],
  ['Bitte das Projekt im Fenster wählen.', 'Please choose the project in the window.'], ['Die laufende Stoppuhr wird dabei angehalten.', 'The running timer will be stopped.'],
  ['Bitte die Dauer im Fenster eintragen.', 'Please enter the duration in the window.'], ['startet nach Bestätigung', 'starts after confirmation'],
  ['Noch nicht gespeichert: Der Nutzer bestätigt im Fenster.', 'Not saved yet: the user confirms in the window.'], ['Prüfen und starten', 'Check and start'],
  ['Ich habe die Stoppuhr{0} vorbereitet. Starten Sie sie im Fenster.', 'I have prepared the timer{0}. Start it in the window.'],
  ['Ich habe die Stoppuhr für {0} vorbereitet. Starten Sie sie im Fenster.', 'I have prepared the timer for {0}. Start it in the window.'],
  ['Ich habe die Stoppuhr vorbereitet. Starten Sie sie im Fenster.', 'I have prepared the timer. Start it in the window.'],
  ['Ich habe {0}{1} am {2} vorbereitet. Prüfen und speichern Sie im Fenster.', 'I have prepared {0}{1} on {2}. Check and save it in the window.'],
  ['Ich habe {0} für {1} am {2} vorbereitet. Prüfen und speichern Sie im Fenster.', 'I have prepared {0} for {1} on {2}. Check and save it in the window.'],
  ['Ich habe {0} am {1} vorbereitet. Prüfen und speichern Sie im Fenster.', 'I have prepared {0} on {1}. Check and save it in the window.'],
  ['eine Zeit', 'a time entry'], ['Stoppuhr starten', 'Start timer'], ['Zeit eintragen', 'Log time'], ['Neues Projekt', 'New project'], ['Tätigkeit', 'Activity'], ['Stundensatz', 'Hourly rate'],
  ['Es gibt schon das Projekt „{0}“.', 'The project “{0}” already exists.'],
  ['Ich habe das Projekt „{0}“{1} vorbereitet.', 'I have prepared the project “{0}”{1}.'], ['Ich habe das Projekt „{0}“ für {1} vorbereitet.', 'I have prepared the project “{0}” for {1}.'],
  ['Ich habe das Projekt „{0}“ vorbereitet.', 'I have prepared the project “{0}”.'],
  ['Ich habe ein Angebot an {0} vorbereitet über {1} netto.', 'I have prepared a quote to {0} for {1} net.'], ['Ich habe ein Angebot an {0} vorbereitet.', 'I have prepared a quote to {0}.'],
  ['Ich habe ein Angebot vorbereitet über {0} netto.', 'I have prepared a quote for {0} net.'], ['Ich habe ein Angebot vorbereitet.', 'I have prepared a quote.'],
  ['Ich habe eine Auftragsbestätigung an {0} vorbereitet.', 'I have prepared an order confirmation to {0}.'], ['Ich habe eine Auftragsbestätigung vorbereitet.', 'I have prepared an order confirmation.'],
  ['Ich habe einen Lieferschein an {0} vorbereitet.', 'I have prepared a delivery note to {0}.'], ['Ich habe einen Lieferschein vorbereitet.', 'I have prepared a delivery note.'],
  ['Ich finde Buchungen, Rechnungen, Angebote, Projekte, Kontakte, Termine und Aufgaben, rechne Ihre Zahlen aus, zeige Arbeitszeiten, Kasse und Liquidität, erkläre die Bedienung, öffne Bereiche und bereite neue Einträge, Zeiten, Zahlungen und Mahnungen vor. Fragen Sie zum Beispiel: „Was steht heute an?“',
    'I find transactions, invoices, quotes, projects, contacts, appointments and tasks, work out your figures, show working time, cash and liquidity, explain how to use the app, open sections and prepare new entries, time entries, payments and dunning letters. For example, ask: “What is due today?”'],
]) add(de, en);

export default W;
