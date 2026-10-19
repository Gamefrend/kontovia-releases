/**
 * Kontovia – Einträge öffnen und neu anlegen, egal von wo.
 *
 * Eine Stelle weiß, welches Fenster oder welche Seite zu welcher Art Eintrag gehört. Suche, Assistent,
 * Verknüpfungen an Aufgaben und Terminen, Übersicht, Auswertungen, Projekt- und Kontaktseiten springen hierüber.
 * Die Ansichten werden erst beim Öffnen geladen: Keine Ansicht muss eine andere importieren, nur um deren Fenster
 * zu zeigen (früher hingen Aufgaben und Kalender im Kreis aneinander, die Übersicht zog das Buchungsfenster mit).
 *
 * Arten (`eintragOeffnen`): buchung, termin, aufgabe, kontakt, stamm (mit `tab`), rechnung, beleg, projekt.
 * Neu (`neuOeffnen`): einnahme, ausgabe, aufgabe, termin, kontakt, projekt, zeit, stoppuhr, rechnung, angebot.
 */

import { navigate } from './router.js';
import { sel } from './store.js';
import { todayISO } from './util.js';

const buchungen = () => import('../views/transactions.js');
const kalender = () => import('../views/calendar.js');
const aufgaben = () => import('../views/todos.js');
const stamm = () => import('../views/master.js');
const projekte = () => import('../views/projekte.js');

/**
 * Öffnet einen vorhandenen Eintrag. `optionen` geht an das Fenster weiter (etwa `onSaved`, `nachSpeichern`,
 * `vorgabe`); bei `stamm` steht dort der Reiter (`tab`), bei `projekt` auf Wunsch der Reiter der Projektseite.
 */
export async function eintragOeffnen(art, id, optionen = {}) {
  if (art === 'buchung') return (await buchungen()).openTransactionDialog(id, undefined, optionen);
  if (art === 'termin') return (await kalender()).openAppointmentDialog(id, optionen.vorgabe || {});
  if (art === 'aufgabe') return (await aufgaben()).openTodoDialog(id, optionen.vorgabe || {}, optionen);
  if (art === 'kontakt') return (await stamm()).openStammdatum('contacts', id);
  if (art === 'stamm') return (await stamm()).openStammdatum(optionen.tab, id);
  if (art === 'rechnung') {
    // Eingangsrechnungen haben keine eigene Seite, sie stehen im Reiter „Eingang“.
    if (sel.invoice(id)?.richtung === 'eingang') return navigate('rechnungen', { tab: 'eingang' });
    return navigate('rechnungen', { id });
  }
  if (art === 'beleg') return navigate('rechnungen', { beleg: id });
  if (art === 'projekt') return navigate('projekte', { id, ...(optionen.reiter ? { reiter: optionen.reiter } : {}) });
  return undefined;
}

/**
 * Öffnet das Fenster für einen neuen Eintrag, vorbelegt mit `vorgabe`. `optionen` geht wie bei
 * `eintragOeffnen` an das Fenster.
 */
export async function neuOeffnen(art, vorgabe = {}, optionen = {}) {
  if (art === 'einnahme' || art === 'ausgabe') {
    const typ = art === 'einnahme' ? 'income' : 'expense';
    const leer = !Object.keys(vorgabe).length;
    return (await buchungen()).openTransactionDialog(null, typ, { ...optionen, ...(leer ? {} : { vorgabe }) });
  }
  if (art === 'aufgabe') return (await aufgaben()).openTodoDialog(null, vorgabe, optionen);
  if (art === 'termin') return (await kalender()).openAppointmentDialog(null, { date: todayISO(), ...vorgabe });
  if (art === 'kontakt') return (await stamm()).openStammdatum('contacts', null, Object.keys(vorgabe).length ? vorgabe : null);
  if (art === 'projekt') return (await projekte()).projektNeu(vorgabe);
  if (art === 'zeit') {
    const { projektId = '', ...rest } = vorgabe;
    return (await projekte()).zeitEintragen(projektId, rest);
  }
  if (art === 'stoppuhr') return (await projekte()).stoppuhrDialog(vorgabe.projektId || '', vorgabe.taetigkeit || '', vorgabe.person || '');
  if (art === 'rechnung') return navigate('rechnungen', { neu: true, ...vorgabe });
  if (art === 'angebot') return navigate('rechnungen', { neuBeleg: 'angebot', ...vorgabe });
  return undefined;
}
