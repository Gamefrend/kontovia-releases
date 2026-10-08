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

export default W;
