/**
 * Wörterbuch Englisch, Teil SEC-72: Entfernen von Belegen im Journal,
 * Belege festgeschriebener Buchungen bleiben. Von Hand gepflegt, wie zusatz.js.
 */

export default {
  "Die Buchung liegt im festgeschriebenen Zeitraum. Ihr Beleg bleibt, ergänzen lässt sich weiterhin.": "The transaction is in the locked period. Its receipt stays, but you can still add more.",
  "Datei entfernt:": "File removed:",
  "Datei entfernt: {0}": "File removed: {0}",
  "Beleg einer privaten Buchung entfernt": "Receipt of a private transaction removed",
  "Beleg entfernt: {0}, Buchung": "Receipt removed: {0}, transaction",
  "Beleg entfernt: {0}, Buchung {1} {2}": "Receipt removed: {0}, transaction {1} {2}",
  "Entfernen Sie einen Beleg, steht das im Änderungsjournal. Ist die Buchung festgeschrieben, bleiben ihre Belege; weitere lassen sich noch anhängen.": "When you remove a receipt, the change log records it. Once a transaction is locked, its receipts stay; you can still attach more.",
  "Die Buchung ist festgeschrieben. Ihre Belege bleiben, weitere lassen sich anhängen.": "This transaction is locked. Its receipts stay, and you can attach more.",
  "Beleg nicht entfernt": "Receipt not removed",
  // Versionshinweise 2.48.4
  "Belege bleiben bei festgeschriebenen Buchungen": "Receipts stay with locked transactions",
  "Entfernen Sie einen Beleg, steht das jetzt im Änderungsjournal.": "When you remove a receipt, the change log now records it.",
  "Belege einer festgeschriebenen Buchung bleiben. Weitere lassen sich anhängen und speichern.": "Receipts of a locked transaction stay. You can still attach and save more.",
  // Versionshinweise 2.48.6
  "Belege festgeschriebener Buchungen bleiben sicher": "Receipts of locked transactions stay safe",
  "Auch beim Speichern bleibt jeder Beleg an einer festgeschriebenen Buchung hängen. Weitere lassen sich weiter anhängen.": "Saving a locked transaction also keeps every receipt attached. You can still attach more.",
};
