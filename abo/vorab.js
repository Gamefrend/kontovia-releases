/* Kontovia Abo-Seite: läuft vor dem ersten Zeichnen und markiert, dass JavaScript da ist.
   Nur dann starten die Einblend-Animationen verborgen; ohne Skript bleibt alles sichtbar. */
document.documentElement.classList.add('js');

/* Soll die Seite englisch erscheinen (Wahl, Adresse oder Browsersprache), bleibt sie bis zur Übersetzung
   unsichtbar, damit kein deutscher Text aufblitzt. Spätestens nach drei Sekunden erscheint sie in jedem Fall. */
(function () {
  var wahl = '';
  try { wahl = new URLSearchParams(location.search).get('lang') || localStorage.getItem('kontovia.sprache') || ''; } catch (e) { /* privater Modus */ }
  var sprachen = navigator.languages || [navigator.language || 'de'];
  var englisch = wahl ? wahl === 'en' : !sprachen.some(function (l) { return /^de\b/i.test(String(l)); });
  if (!englisch) return;
  document.documentElement.classList.add('uebersetzt-folgt');
  setTimeout(function () { document.documentElement.classList.remove('uebersetzt-folgt'); }, 3000);
})();
