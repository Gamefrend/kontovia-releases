/* Kontovia Abo-Seite: läuft vor dem ersten Zeichnen und markiert, dass JavaScript da ist.
   Nur dann starten die Einblend-Animationen verborgen; ohne Skript bleibt alles sichtbar. */
document.documentElement.classList.add('js');
