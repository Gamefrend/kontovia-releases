/**
 * Wörterbuch Englisch, Teil geteilte Google-Kalender: nur lesbare Kalender anzeigen, filtern,
 * neu geteilte von selbst aufnehmen, Abgleich im Hintergrund.
 * Von Hand gepflegt, wie zusatz.js. Kennungen bleiben unverändert.
 */

export default {
  // Kennungen (keine Oberfläche)
  "cal-ein cal-{0}": "cal-ein cal-{0}",

  // Abgleich (lib/gcalsync.js)
  "1 geteilter Kalender dazugekommen": "1 shared calendar added",
  "geteilte Kalender dazugekommen": "shared calendars added",
  "{0} geteilte Kalender dazugekommen": "{0} shared calendars added",

  // Kalenderansicht (views/calendar.js)
  "nur lesen": "read-only",
  "(nur lesen)": "(read-only)",
  ", nur lesen": ", read-only",
  "Nur lesbar": "Read-only",
  "Mit einem Tipp bei Google bestätigen, dann läuft der Abgleich weiter": "Confirm with one tap at Google, then the sync continues",
  "Blättern": "Browse",
  "Kalender ein- und ausblenden": "Show and hide calendars",
  ". Klick blendet ein oder aus, Doppelklick zeigt nur diesen.": ". Click to show or hide, double-click to show only this one.",
  "{0}. Klick blendet ein oder aus, Doppelklick zeigt nur diesen.": "{0}. Click to show or hide, double-click to show only this one.",
  "Google Kalender „{0}“{1}": "Google Calendar “{0}”{1}",
  "Dieser Termin gehört zu einem geteilten Kalender, den Kontovia nur anzeigt.": "This appointment belongs to a shared calendar that Kontovia only displays.",
  "Aus dem geteilten Google Kalender {0}, den Kontovia nur anzeigt. Titel, Zeit, Ort und Notiz ändern sich nur dort. Kontakt, Projekt, Tags, Aufgaben und Buchungen können Sie hier trotzdem ergänzen.":
    "From the shared Google Calendar {0}, which Kontovia only displays. Title, time, location and note can only be changed there. You can still add a contact, project, tags, tasks and bookings here.",
  "{0} Aus dem geteilten Google Kalender {1}, den Kontovia nur anzeigt. Titel, Zeit, Ort und Notiz ändern sich nur dort. Kontakt, Projekt, Tags, Aufgaben und Buchungen können Sie hier trotzdem ergänzen.":
    "{0} From the shared Google Calendar {1}, which Kontovia only displays. Title, time, location and note can only be changed there. You can still add a contact, project, tags, tasks and bookings here.",
  "Im geteilten Google Kalender „{0}“ bleibt er bestehen; Kontovia blendet ihn nur hier aus.": "In the shared Google Calendar “{0}” it stays; Kontovia only hides it here.",

  // Versionshinweise (lib/versionen.js)
  "Kalender aufgeräumt, geteilte Kalender": "Calendar tidied up, shared calendars",
  "Der Kalender sieht ordentlicher aus: überall gleiche Ränder, ein sauberes Raster, in Woche und Tag bleibt der Kopf oben stehen, und beim Blättern und Umschalten bewegt sich alles weich.":
    "The calendar looks tidier: even margins everywhere, a clean grid, the header stays on top in week and day view, and everything moves smoothly when you browse and switch.",
  "Kalender, die andere in Google mit Ihnen geteilt haben, erscheinen jetzt auch, nur zum Lesen. Neu geteilte können von selbst dazukommen.":
    "Calendars that others have shared with you in Google now appear too, read-only. Newly shared ones can be added automatically.",
  "Jeden Kalender blenden Sie oben mit einem Klick ein oder aus, ein Doppelklick zeigt nur diesen.":
    "You show or hide each calendar at the top with one click; a double-click shows only this one.",
  "Der Abgleich mit Google läuft von selbst: alle fünf Minuten, sobald Sie zu Kontovia zurückkehren, und kurz nach jeder Änderung. Ist der Zugriff abgelaufen, genügt ein Tipp auf den Hinweis im Kalender.":
    "The sync with Google runs by itself: every five minutes, as soon as you return to Kontovia, and shortly after every change. If access has expired, one tap on the notice in the calendar is enough.",

  // Hilfe (views/help.js)
  "Von selbst:": "Automatically:",
  "Geteilte Kalender:": "Shared calendars:",
  "Der Abgleich läuft beim Entsperren, alle fünf Minuten, sobald Sie zu Kontovia zurückkehren oder wieder Netz haben, und kurz nach jeder Änderung an Ihren Terminen. Nur wenn der Zugriff abgelaufen ist, genügt ein Tipp auf den Hinweis {0} oben im Kalender.":
    "The sync runs when you unlock, every five minutes, as soon as you return to Kontovia or have network again, and shortly after every change to your appointments. Only when access has expired, one tap on the notice {0} at the top of the calendar is enough.",
  "{0} Der Abgleich läuft beim Entsperren, alle fünf Minuten, sobald Sie zu Kontovia zurückkehren oder wieder Netz haben, und kurz nach jeder Änderung an Ihren Terminen. Nur wenn der Zugriff abgelaufen ist, genügt ein Tipp auf den Hinweis {1} oben im Kalender.":
    "{0} The sync runs when you unlock, every five minutes, as soon as you return to Kontovia or have network again, and shortly after every change to your appointments. Only when access has expired, one tap on the notice {1} at the top of the calendar is enough.",
  "Kalender, die andere mit Ihnen geteilt haben, zeigt Kontovia an, auf Wunsch kommen neu geteilte von selbst dazu. Sie bleiben nur lesbar: Kontovia schreibt nie hinein, und was Sie dort in Kontovia löschen, blenden Sie nur hier aus. Im Kalender blenden Sie jeden Kalender über seinen farbigen Schalter ein oder aus; ein Doppelklick zeigt nur diesen.":
    "Kontovia shows calendars that others have shared with you, and newly shared ones can be added automatically on request. They stay read-only: Kontovia never writes to them, and what you delete there in Kontovia is only hidden here. In the calendar you show or hide each calendar with its colored switch; a double-click shows only this one.",
  "{0} Kalender, die andere mit Ihnen geteilt haben, zeigt Kontovia an, auf Wunsch kommen neu geteilte von selbst dazu. Sie bleiben nur lesbar: Kontovia schreibt nie hinein, und was Sie dort in Kontovia löschen, blenden Sie nur hier aus. Im Kalender blenden Sie jeden Kalender über seinen farbigen Schalter ein oder aus; ein Doppelklick zeigt nur diesen.":
    "{0} Kontovia shows calendars that others have shared with you, and newly shared ones can be added automatically on request. They stay read-only: Kontovia never writes to them, and what you delete there in Kontovia is only hidden here. In the calendar you show or hide each calendar with its colored switch; a double-click shows only this one.",

  // Abgleich und Auswahl (views/calendarsync.js)
  "Termine aus Ihrem Hauptkalender und anderen Kalendern in Kontovia sehen und bearbeiten. Änderungen und Löschungen gehen in beide Richtungen. Auch Kalender, die andere mit Ihnen geteilt haben, lassen sich so anzeigen (nur lesend). Dafür braucht Kontovia einmal zusätzlich Ihre Freigabe bei Google.":
    "See and edit appointments from your main calendar and other calendars in Kontovia. Changes and deletions go both ways. Calendars that others have shared with you can be shown this way too (read-only). For this, Kontovia needs your additional approval at Google once.",
  "Neu mit mir geteilte Kalender automatisch anzeigen (nur lesend)": "Automatically show newly shared calendars (read-only)",
  "{0} Neu mit mir geteilte Kalender automatisch anzeigen (nur lesend)": "{0} Automatically show newly shared calendars (read-only)",
  "Eigene Kalender werden in beide Richtungen abgeglichen, mit Ihnen geteilte, nur lesbare Kalender nur angezeigt. Termine ab gut einem Jahr zurück. „Lösen“ beendet den Abgleich eines Kalenders; dabei können Sie die von Kontovia dort angelegten Einträge mit löschen lassen, fremde Termine bleiben immer unberührt.":
    "Your own calendars are synced in both directions; read-only calendars shared with you are only displayed. Appointments from just over a year back. “Unlink” ends the sync of a calendar; you can have the entries Kontovia created there deleted as well, other people's appointments are never touched.",
  "Kontovia fragt bei Google zusätzlich das Recht an, Ihre Kalender aufzulisten und Termine darin zu lesen und zu ändern. Abgeglichen werden danach nur die Kalender, die Sie anschließend auswählen. Eigene Kalender laufen in beide Richtungen: Was Sie dort ändern oder löschen, ändert sich hier, und umgekehrt. Mit Ihnen geteilte Kalender zeigt Kontovia nur an. Es öffnet sich die Anmeldung bei Google; danach geht es hier weiter.":
    "Kontovia additionally asks Google for the right to list your calendars and to read and change appointments in them. Afterwards only the calendars you choose next are synced. Your own calendars run in both directions: what you change or delete there changes here, and the other way round. Calendars shared with you are only displayed by Kontovia. The Google sign-in opens; afterwards you continue here.",
  "Mit mir geteilt": "Shared with me",
  "Von Google (Feiertage, Geburtstage …)": "From Google (holidays, birthdays …)",
  "Die Termine der gewählten Kalender erscheinen in Kontovia, ab gut einem Jahr zurück. Eigene Kalender gleicht Kontovia in beide Richtungen ab: Ändern oder löschen Sie einen Termin hier oder in Google, gilt das beim nächsten Abgleich auf beiden Seiten. Mit Ihnen geteilte, nur lesbare Kalender zeigt Kontovia nur an und schreibt nie hinein. Wer einen solchen Termin hier löscht, blendet ihn nur in Kontovia aus.":
    "The appointments of the chosen calendars appear in Kontovia, from just over a year back. Kontovia syncs your own calendars in both directions: if you change or delete an appointment here or in Google, it applies on both sides at the next sync. Read-only calendars shared with you are only displayed by Kontovia and never written to. If you delete such an appointment here, it is only hidden in Kontovia.",
  "Es gibt keine weiteren Kalender, die Kontovia lesen darf.": "There are no other calendars that Kontovia may read.",
  "Auch meine anderen Google-Kalender einbeziehen, etwa den Hauptkalender (in beide Richtungen) und mit mir geteilte Kalender (nur lesend). Welche, wählen Sie danach":
    "Also include my other Google calendars, such as the main calendar (in both directions) and calendars shared with me (read-only). You choose which ones afterwards",
  "{0} Auch meine anderen Google-Kalender einbeziehen, etwa den Hauptkalender (in beide Richtungen) und mit mir geteilte Kalender (nur lesend). Welche, wählen Sie danach":
    "{0} Also include my other Google calendars, such as the main calendar (in both directions) and calendars shared with me (read-only). You choose which ones afterwards",

  // Kalender: Herkunft der Einträge, „nur privat“; stille Erneuerung des Google-Zugriffs
  "Woher die Einträge kommen": "Where entries come from",
  "Aus Kontovia zeigen": "Show from Kontovia",
  "Meine Termine": "My appointments",
  "Kontovia ist ausgeblendet": "Kontovia is hidden",
  "zum Einblenden tippen": "tap to show",
  "aus: nur Google, also privat": "off: Google only, i.e. private",
  "Blendet alles aus Kontovia aus und zeigt nur die Google-Kalender. Feiner einstellen: Anzeige oben rechts.":
    "Hides everything from Kontovia and shows only the Google calendars. For finer control use Display at the top right.",
  "Nur privat": "Private only",
  "Kontovia einblenden": "Show Kontovia",
  "Kalender nach Herkunft filtern, Google ohne ständiges Bestätigen": "Filter the calendar by source, Google without constant confirming",
  "Im Menü „Anzeige“ wählen Sie jetzt, woher die Einträge kommen: Kontovia (eigene Termine, Zahlungstermine, Veranstaltungen, Steuertermine, Aufgaben) und Google Kalender, jeweils einzeln.":
    "In the Display menu you now choose where entries come from: Kontovia (your own appointments, payment dates, events, tax dates, tasks) and Google Calendar, each on its own.",
  "Der Knopf „Nur privat“ blendet alles aus Kontovia mit einem Tipp aus und zeigt nur Ihre Google-Kalender. Ein zweiter Tipp bringt Kontovia zurück.":
    "The Private only button hides everything from Kontovia with one tap and shows only your Google calendars. A second tap brings Kontovia back.",
  "Der Zugriff auf Google wird nach Möglichkeit von selbst erneuert, bevor er abläuft oder nach dem Entsperren. Klappt das in Ihrem Browser nicht, genügt wie bisher ein Tipp.":
    "Where possible, access to Google is renewed on its own, before it runs out or after unlocking. If that does not work in your browser, a tap is enough, as before.",
  "Die Kalender, die andere mit Ihnen geteilt haben, sehen Sie unter Einstellungen → Kalender-Abgleich → „Kalender auswählen“ und oben im Kalender.":
    "Calendars others have shared with you appear under Settings → Calendar sync → Choose calendars, and at the top of the calendar.",
  "Stille Erneuerung nicht möglich.":"Silent renewal is not possible.",
  "Google hat nicht still geantwortet.": "Google did not answer silently.",
  "Stille Erneuerung der Google-Freigabe": "Silent renewal of the Google access",

  // Kalender: Schalter für Kontovia, geteilte Kalender, Zeitraster
  "Was aus Kontovia im Kalender steht": "What from Kontovia shows in the calendar",
  "Alles aus Kontovia ein- oder ausblenden; aus: nur die Google-Kalender": "Show or hide everything from Kontovia; off: only the Google calendars",
  "Die in Kontovia angelegten Termine": "The appointments created in Kontovia",
  "Fälligkeiten offener Rechnungen (nicht in der Liste)": "Due dates of open invoices (not in the list)",
  "Veranstaltungstage aus Anzahlungen": "Event days from down payments",
  "Voranmeldung und Erklärungen": "Advance returns and annual returns",
  "Geteilte Kalender anzeigen": "Show shared calendars",
  "{0} Geteilte Kalender anzeigen": "{0} Show shared calendars",
  "Geteilte Google-Kalender anzeigen: Kontovia braucht dafür einmal Ihre Freigabe bei Google.": "Show shared Google calendars: Kontovia needs your permission at Google once for this.",
  "weitere Termine zur gleichen Zeit, Tag ansehen": "more appointments at the same time, view the day",
  "{0} weitere Termine zur gleichen Zeit, Tag ansehen": "{0} more appointments at the same time, view the day",
  // Versionshinweis 2.48.1
  "Kalender ruhiger und besser lesbar": "Calmer, easier-to-read calendar",
  "Termine in Woche und Tag passen ihren Text dem Platz an, statt mitten im Wort abgeschnitten zu werden.": "Appointments in week and day view fit their text to the space instead of being cut off mid-word.",
  "Wo viele Termine zugleich liegen, stehen höchstens zwei nebeneinander, der Rest hinter „+n“.": "Where many appointments overlap, at most two stand side by side and the rest sit behind \"+n\".",
  "Beim Ein- und Ausblenden verrutscht nichts mehr, das Monatsraster behält seine Größe.": "Nothing shifts any more when you show or hide things, and the month grid keeps its size.",
  "Neue Schalter unter den Kalendern: Termine, Zahlungen, Veranstaltungen, Steuertermine und Aufgaben lassen sich einzeln ausblenden. „Kontovia“ blendet alles auf einmal aus.": "New switches below the calendars: appointments, payments, events, tax dates and tasks can be hidden one by one. \"Kontovia\" hides everything at once.",
  "Mit Ihnen geteilte Google-Kalender erscheinen jetzt von selbst, auch wenn sie in Google nicht angehakt sind.": "Google calendars shared with you now appear on their own, even if they are not ticked in Google.",
  // Kennungen (keine Oberfläche)
  "class=\"cal-ev": "class=\"cal-ev",
  "class=\"cal-ev mehrzeilig": "class=\"cal-ev mehrzeilig",
};
