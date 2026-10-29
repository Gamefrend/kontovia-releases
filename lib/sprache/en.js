/**
 * Kontovia – Wörterbuch Englisch: deutscher Text der Oberfläche → englischer.
 *
 * Die Teile liegen in en/, je ein Stapel Texte aus dem Quelltext (gelesen von
 * scripts/sprache.js). Schlüssel sind die deutschen Texte in Normalform
 * (Leerraum zusammengefasst, eingebettete Elemente und Werte als {0}, {1} …).
 * Neue Texte: `node scripts/sprache.js` nennt fehlende Einträge, die Prüfung
 * `quelltext` verlangt sie. Geladen wird das Wörterbuch nur auf Englisch.
 */

import t0 from './en/t01.js';
import t1 from './en/t02.js';
import t2 from './en/t03.js';
import t3 from './en/t04.js';
import t4 from './en/t05.js';
import t5 from './en/t06.js';
import t6 from './en/t07.js';
import t7 from './en/t08.js';
import t8 from './en/t09.js';
import t9 from './en/t10.js';
import t10 from './en/t11.js';
import t11 from './en/t12.js';
import t12 from './en/t13.js';
import t13 from './en/t14.js';
import t14 from './en/t15.js';
import t15 from './en/t16.js';
import t16 from './en/t17.js';
import t17 from './en/t18.js';
import t18 from './en/t19.js';
import t19 from './en/t20.js';
import t20 from './en/t21.js';
import t21 from './en/zusatz.js';
import t22 from './en/zusatz-assistent.js';
import t23 from './en/zusatz-messung.js';
import t24 from './en/zusatz-archiv.js';
import tSec42 from './en/zusatz-sec42.js';
import tSec34 from './en/zusatz-sec34.js';
import tSec35 from './en/zusatz-sec35.js';
import sec38 from './en/zusatz-sec38.js';
import t37 from './en/zusatz-sec37.js';
import sec47 from './en/zusatz-sec47.js';
import t49 from './en/zusatz-sec49.js';
import tRelease from './en/zusatz-release.js';
import sec85 from './en/zusatz-sec85.js';
import geteilt from './en/zusatz-geteilt.js';
import sec72 from './en/zusatz-sec72.js';
import sec84 from './en/zusatz-sec84.js';
import sec64 from './en/zusatz-sec64.js';
import sec36 from './en/zusatz-sec36.js';
import sec63 from './en/zusatz-sec63.js';
import sec65 from './en/zusatz-sec65.js';

export default Object.assign({}, t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24, tSec42, tSec34, tSec35, sec38, t37, sec47, t49, tRelease, sec85, geteilt, sec72, sec84, sec64, sec36, sec63, sec65);
