/**
 * Kontovia – mitgelieferte Zugangsdaten.
 *
 * Diese Werte identifizieren die *Anwendung* gegenüber Google, nicht den
 * Nutzer. Sie sind fest eingebaut: Wer Kontovia öffnet, soll sich anmelden
 * können, ohne vorher ein Google-Projekt anzulegen.
 *
 * Sind diese Werte geheim? Nein, und das ist keine Nachlässigkeit:
 *
 *   apiKey        Der Web-API-Schlüssel von Firebase ist nach Googles eigener
 *                 Dokumentation ausdrücklich nicht geheim. Er benennt nur das
 *                 Projekt. Den Zugriff regeln Anmeldung und Storage-Regeln.
 *   clientId      Öffentlich, steht in jeder Anmelde-URL.
 *   clientSecret  Nur beim Client für die Anmeldung per Code. Bei diesem Typ
 *                 gilt er nach Googles eigener Festlegung nicht als
 *                 vertraulich; er steht in jeder ausgelieferten Fassung.
 *
 * Was den Zugriff tatsächlich absichert, sind die Regeln in
 * firebase/storage.rules: Jede angemeldete Person kommt ausschließlich an den
 * eigenen Zweig.
 *
 * Wer Kontovia mit einem eigenen Google-Projekt betreibt, tauscht diese Datei
 * aus (siehe README).
 */

export default Object.freeze({
  provider: 'firebase',

  firebase: Object.freeze({
    projectId: 'finanztracker-149f2',
    apiKey: 'AIzaSyCpWNCQx0QcJ0hI4OGMwALZgvIz_dZUYzE',
    bucket: 'finanztracker-149f2.firebasestorage.app',
  }),

  // OAuth-Client vom Typ „Webanwendung“: Anmeldung per Weiterleitung
  // (weiterleitung.js) und Google Kalender (gcal.js). Zugelassen sind nur die
  // Adresse auf GitHub Pages und http://localhost:8081/ zum Testen. Ein
  // Client-Schlüssel wird dafür nicht gebraucht.
  googleWeb: Object.freeze({
    clientId: '614129333064-56dcl6mcgliqoci1v81upe6f4o4tdt0c.apps.googleusercontent.com',
  }),

  // OAuth-Client vom Typ „Fernseher und Geräte mit eingeschränkter Eingabe“:
  // Anmeldung per Code (anmeldung.js), der Rückfallweg, wenn die Weiterleitung
  // nicht geht.
  googleGeraet: Object.freeze({
    clientId: '614129333064-4ro66aq8ioaf1tkt6t4c111s3ftoi6ql.apps.googleusercontent.com',
    clientSecret: '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',
  }),
});
