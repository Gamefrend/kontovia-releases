/**
 * Kontovia – Rückmeldungen der Nutzer und das versteckte Entwicklermenü.
 *
 * Wer etwas mitteilen möchte, schreibt frei Text und kann ein Bildschirmfoto
 * der Seite mitgeben, auf der er gerade war (ohne das Rückmeldefenster, siehe
 * bildschirmfoto.js). Beim Absenden bleibt eine Kopie verschlüsselt im Bestand
 * dieses Geräts (db.feedback, das Foto als Beleg), und die Rückmeldung geht
 * online an die Entwickler (src/web/rueckmeldung.js, Cloud-Speicher, ohne
 * Konto). Klappt das nicht, versucht Kontovia es beim nächsten Entsperren oder
 * sobald das Netz wieder da ist erneut. Nur Einträge, die mit „Senden“
 * entstanden sind, gehen hinaus; ältere, die nur lokal gespeichert wurden,
 * bleiben, wo sie sind.
 * Das Entwicklermenü zeigt die lokalen und (für berechtigte Konten) die
 * eingegangenen Rückmeldungen: Fünfmal auf die Versionsangabe unten rechts klicken.
 */

import { html, raw, esc, $, $$, uid, fmtDateTime } from './util.js';
import { icon, modal, ok, err, warn, confirmDialog } from './ui.js';
import { store, commit, saveNow, tomb } from './store.js';
import { router } from './router.js';
import { seiteAufnehmen } from './bildschirmfoto.js';
import { VERSIONEN } from './versionen.js';

const api = window.kontovia;

const ARTEN = [['idee', 'Idee'], ['fehler', 'Fehler'], ['frage', 'Frage'], ['lob', 'Lob']];
const ARTNAME = Object.fromEntries(ARTEN);
const MAX_TEXT = 5000;
const MAX_VERSUCHE = 5;

const alsBase64 = async (blob) => {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Wie die Ansicht heißt, auf der man war (Name aus der Seitenleiste). */
function ansichtName() {
  return (document.getElementById('viewTitle')?.textContent || router.view || '').trim();
}

/** Hinterlegt eine Rückmeldung samt Foto im Bestand. */
export async function feedbackSpeichern({ art, text, foto = null }) {
  const eintrag = {
    id: uid('fb'),
    createdAt: new Date().toISOString(),
    art: ARTNAME[art] ? art : 'idee',
    text: String(text || '').slice(0, MAX_TEXT),
    ansicht: ansichtName(),
    version: document.querySelector('[data-version]')?.dataset.version || '',
    fenster: `${window.innerWidth}x${window.innerHeight}`,
    erledigt: false,
    // Geht online an die Entwickler; gesendetAm wird nach dem Hochladen gesetzt.
    senden: true,
    versuche: 0,
    gesendetAm: null,
  };
  let meta = null;
  if (foto) {
    meta = await api.attach.add(`feedback-${eintrag.createdAt.slice(0, 10)}.jpg`, 'image/jpeg', await alsBase64(foto));
    eintrag.bildId = meta.id;
  }
  await commit('feedback.neu', (db) => {
    db.feedback ??= [];
    db.feedback.push(eintrag);
    if (meta) db.attachments.push(meta);
  }, { entity: 'feedback', entityId: eintrag.id, summary: `Rückmeldung (${ARTNAME[eintrag.art]}) gespeichert` });
  await saveNow();
  return eintrag;
}

/**
 * Schickt eine gespeicherte Rückmeldung online ab. Gelingt es, steht
 * gesendetAm im Eintrag; sonst zählen die Versuche. Wirft nie: wer nachsendet,
 * soll nicht an einem Fehler hängen.
 * @returns {Promise<boolean>} ob die Rückmeldung angekommen ist
 */
export async function feedbackSenden(id) {
  const e = (store.db?.feedback || []).find((x) => x.id === id);
  if (!e || !e.senden || e.gesendetAm || !api.feedback?.senden) return false;
  try {
    const fotoBase64 = e.bildId ? await api.attach.read(e.bildId) : null;
    await api.feedback.senden({ eintrag: e, fotoBase64 });
    await commit('feedback.gesendet', () => { e.gesendetAm = new Date().toISOString(); e.updatedAt = e.gesendetAm; },
      { silent: true });
    await saveNow();
    return true;
  } catch {
    try {
      await commit('feedback.versuch', () => { e.versuche = (e.versuche || 0) + 1; }, { silent: true });
    } catch { /* gesperrt: dann eben beim nächsten Mal */ }
    return false;
  }
}

let nachsendet = false;
/** Sendet alles nach, was noch nicht angekommen ist (nach dem Entsperren, bei wiederkehrendem Netz). */
export async function feedbackNachsenden() {
  if (nachsendet || !store.db || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  nachsendet = true;
  try {
    const offen = (store.db.feedback || []).filter((x) => x.senden && !x.gesendetAm && (x.versuche || 0) < MAX_VERSUCHE);
    for (const x of offen) { if (!await feedbackSenden(x.id)) break; }
  } finally { nachsendet = false; }
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { feedbackNachsenden(); });

/** Öffnet das Rückmeldefenster. Das Foto entsteht vorher, damit das Fenster nicht darauf zu sehen ist. */
export async function feedbackOeffnen() {
  const fotoBlob = await seiteAufnehmen();
  const fotoUrl = fotoBlob ? URL.createObjectURL(fotoBlob) : '';
  let art = 'idee';
  let gesendet = false;
  const m = modal({
    title: 'Rückmeldung geben',
    size: 'slim',
    body: html`
      <p class="mt0 muted small" style="line-height:1.5">Was ist Ihnen aufgefallen, was fehlt, was hat Ihnen gefallen? Schreiben Sie einfach los.</p>
      <div class="field"><label>Worum geht es?</label>
        <div class="seg sm" role="group" id="fbArt">${raw(ARTEN.map(([k, t]) => `<button type="button" data-wert="${k}" class="${k === art ? 'active' : ''}">${esc(t)}</button>`).join(''))}</div></div>
      <div class="field"><label for="fbText">Ihre Nachricht</label>
        <textarea id="fbText" rows="6" maxlength="${MAX_TEXT}" placeholder="Ihre Gedanken in eigenen Worten"></textarea></div>
      ${raw(fotoBlob ? `<div class="field mb0"><label class="check"><input type="checkbox" id="fbFoto"> <span>Bildschirmfoto der Seite mitsenden</span></label>
          <div class="fb-foto" id="fbVorschau" hidden><img src="${fotoUrl}" alt="Bildschirmfoto der Seite, auf der Sie waren"></div>
          <span class="hint">Das Foto zeigt die Seite so, wie Sie sie eben gesehen haben, ohne dieses Fenster. Es kann Zahlen aus Ihrer Buchhaltung zeigen und geht nur mit, wenn Sie den Haken setzen.</span></div>`
    : '<p class="small muted mb0">Ein Bildschirmfoto ließ sich in diesem Browser nicht erstellen. Ihre Nachricht können Sie trotzdem abschicken.</p>')}
      <p class="small muted mt16 mb0">Beim Senden gehen Art, Text, Name der Seite, Programmversion und Fenstergröße (und das Foto, wenn Sie es ankreuzen) an das Kontovia-Team. Nichts sonst aus Ihrer Buchhaltung, kein Name, keine E-Mail-Adresse. Anders als Ihre Buchhaltung ist das nicht verschlüsselt: Bitte schreiben Sie keine Passwörter oder Kontonummern hinein. Eine Kopie bleibt verschlüsselt auf diesem Gerät.</p>`,
    foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Senden</button>',
    onClose: () => { if (fotoUrl) URL.revokeObjectURL(fotoUrl); },
    confirmDismiss: () => !gesendet && !!String(document.getElementById('fbText')?.value || '').trim(),
  });
  const text = $('#fbText', m.root);
  setTimeout(() => text.focus(), 40);
  $('#fbArt', m.root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-wert]');
    if (!b) return;
    art = b.dataset.wert;
    $$('#fbArt button', m.root).forEach((x) => x.classList.toggle('active', x === b));
  });
  $('#fbFoto', m.root)?.addEventListener('change', (e) => { $('#fbVorschau', m.root).hidden = !e.target.checked; });
  m.root.querySelector('[data-nein]').addEventListener('click', () => m.close());
  m.root.querySelector('[data-ja]').addEventListener('click', async (e) => {
    const t = text.value.trim();
    if (!t) { text.focus(); text.classList.add('invalid'); return; }
    const knopf = e.currentTarget;
    knopf.disabled = true;
    knopf.textContent = 'Sende …';
    try {
      const eintrag = await feedbackSpeichern({ art, text: t, foto: $('#fbFoto', m.root)?.checked ? fotoBlob : null });
      gesendet = true;
      const angekommen = await feedbackSenden(eintrag.id);
      m.close();
      if (angekommen) ok('Danke für Ihre Rückmeldung', 'Sie ist bei uns angekommen.');
      else warn('Rückmeldung gespeichert', 'Das Senden hat gerade nicht geklappt. Kontovia versucht es später noch einmal.');
    } catch (ex) {
      knopf.textContent = 'Senden';
      knopf.disabled = false;
      err('Nicht gespeichert', ex.message);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Entwicklermenü                                                              */
/* -------------------------------------------------------------------------- */

const textBase64 = (s) => alsBase64(new Blob([s], { type: 'text/plain;charset=utf-8' }));

/** Zeigt die auf diesem Gerät gespeicherten und, für berechtigte Konten, die online eingegangenen Rückmeldungen. */
export function entwicklerMenue() {
  const m = modal({
    title: 'Entwicklermenü',
    size: 'wide',
    body: '<div id="devInhalt"></div>',
    foot: '<button class="btn" data-zu>Schließen</button>',
  });
  m.root.querySelector('[data-zu]').addEventListener('click', () => m.close());
  const urls = [];
  const aufraeumen = () => { for (const u of urls.splice(0)) URL.revokeObjectURL(u); };

  /* Online eingegangen (nur Konten, die firebase/storage.rules nennt). „Erledigt“ merkt sich dieses Gerät. */
  let online = null;
  const ERLEDIGT_KEY = 'kontovia.fbErledigt';
  const erledigtIds = () => { try { return new Set(JSON.parse(localStorage.getItem(ERLEDIGT_KEY) || '[]')); } catch { return new Set(); } };
  const erledigtSetzen = (set) => { try { localStorage.setItem(ERLEDIGT_KEY, JSON.stringify([...set])); } catch { /* ohne Speicher eben nicht */ } };

  function onlineZeichnen() {
    const feld = $('#devOnline', m.root);
    if (!feld || !online) return;
    const fertig = erledigtIds();
    const offen = online.filter((f) => !fertig.has(f.id)).length;
    feld.innerHTML = `
      <div class="row between wrap mb16" style="gap:8px">
        <h3 class="m0">Eingegangen (online) <span class="muted small">${online.length} gesamt, ${offen} offen</span></h3>
        <button class="btn sm" id="devOnlineNeu">${icon('refresh', 14).__raw} Neu laden</button>
      </div>
      ${online.length ? online.map((f) => `
        <div class="fb-karte fb-online ${fertig.has(f.id) ? 'erledigt' : ''}" data-oid="${esc(f.id)}">
          <div class="row wrap" style="gap:8px">
            <span class="chip">${esc(ARTNAME[f.art] || f.art)}</span>
            <span class="small muted">${esc(fmtDateTime(f.createdAt))}</span>
            ${f.ansicht ? `<span class="small muted">Seite: ${esc(f.ansicht)}</span>` : ''}
            <span class="small muted">${esc(f.fenster || '')}${f.version ? ` · Version ${esc(f.version)}` : ''}</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" data-o-erledigt>${fertig.has(f.id) ? 'Wieder öffnen' : 'Erledigt'}</button>
            <button class="btn sm ghost danger-text" data-o-weg>${icon('trash', 13).__raw} Löschen</button>
          </div>
          <p class="fb-text">${esc(f.text)}</p>
          ${f.hatFoto ? `<div class="fb-foto"><img data-obild="${esc(f.id)}" alt="Bildschirmfoto zur Rückmeldung"></div>` : ''}
        </div>`).join('') : '<p class="muted">Noch nichts eingegangen.</p>'}
      <hr class="sep">`;
    $$('img[data-obild]', feld).forEach(async (img) => {
      try {
        const bin = atob(await api.feedback.foto(img.dataset.obild));
        const url = URL.createObjectURL(new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
        urls.push(url);
        img.src = url;
      } catch { img.replaceWith(Object.assign(document.createElement('span'), { className: 'small muted', textContent: 'Foto nicht verfügbar' })); }
    });
  }

  async function onlineLaden() {
    const feld = $('#devOnline', m.root);
    feld.innerHTML = '<p class="muted small">Lade …</p>';
    try {
      online = await api.feedback.laden();
      onlineZeichnen();
    } catch (ex) {
      const kennung = ex.code === 'KEINE_BERECHTIGUNG' ? await api.feedback.kennung().catch(() => '') : '';
      feld.innerHTML = `<div class="notice warn mb16">${esc(ex.message)}${kennung ? ` Ihre Kennung: <code>${esc(kennung)}</code>` : ''}</div>
        <button class="btn sm mb16" id="devOnlineNeu">${icon('refresh', 14).__raw} Noch einmal versuchen</button>`;
    }
  }

  function zeichnen() {
    aufraeumen();
    const liste = [...(store.db.feedback || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const offen = liste.filter((f) => !f.erledigt).length;
    $('#devInhalt', m.root).innerHTML = `
      <div class="notice mb16">Rückmeldungen gehen beim Absenden online an die Entwickler und bleiben als Kopie auf dem Gerät der Person.
        Lesen können sie nur Entwickler-Konten, die in den Zugriffsregeln des Cloud-Speichers eingetragen sind (Anleitung im README).
        Version ${esc(VERSIONEN[0]?.version || '')}.</div>
      <div id="devOnline" class="mb16"><button class="btn sm" id="devOnlineNeu">${icon('refresh', 14).__raw} Eingegangene Rückmeldungen online laden</button></div>
      <div class="row between wrap mb16" style="gap:8px">
        <h3 class="m0">Auf diesem Gerät <span class="muted small">${liste.length} gesamt, ${offen} offen</span></h3>
        <button class="btn sm" id="devExport" ${liste.length ? '' : 'disabled'}>${icon('export', 14).__raw} Alle als Textdatei sichern</button>
      </div>
      ${liste.length ? liste.map((f) => `
        <div class="fb-karte ${f.erledigt ? 'erledigt' : ''}" data-id="${esc(f.id)}">
          <div class="row wrap" style="gap:8px">
            <span class="chip">${esc(ARTNAME[f.art] || f.art)}</span>
            <span class="small muted">${esc(fmtDateTime(f.createdAt))}</span>
            ${f.ansicht ? `<span class="small muted">Seite: ${esc(f.ansicht)}</span>` : ''}
            <span class="small muted">${esc(f.fenster || '')}</span>
            <span class="badge ${f.gesendetAm ? 'pos' : f.senden ? 'warn' : ''}">${f.gesendetAm ? 'gesendet' : f.senden ? ((f.versuche || 0) >= MAX_VERSUCHE ? 'nicht gesendet' : 'wartet auf Senden') : 'nur hier'}</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" data-erledigt>${f.erledigt ? 'Wieder öffnen' : 'Erledigt'}</button>
            <button class="btn sm ghost danger-text" data-weg>${icon('trash', 13).__raw} Löschen</button>
          </div>
          <p class="fb-text">${esc(f.text)}</p>
          ${f.bildId ? `<div class="fb-foto"><img data-bild="${esc(f.bildId)}" alt="Bildschirmfoto zur Rückmeldung"><button class="btn sm ghost" data-foto-oeffnen>Foto öffnen</button></div>` : ''}
        </div>`).join('') : '<p class="muted">Noch keine Rückmeldungen. Sie entstehen über „Feedback“ in der Seitenleiste.</p>'}`;
    if (online) onlineZeichnen();
    $$('img[data-bild]', m.root).forEach(async (img) => {
      try {
        const b64 = await api.attach.read(img.dataset.bild);
        const bin = atob(b64);
        const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' }));
        urls.push(url);
        img.src = url;
      } catch { img.replaceWith(Object.assign(document.createElement('span'), { className: 'small muted', textContent: 'Foto nicht verfügbar' })); }
    });
  }

  m.root.addEventListener('click', async (e) => {
    if (e.target.closest('#devOnlineNeu')) { await onlineLaden(); return; }
    const okarte = e.target.closest('.fb-online');
    if (okarte) {
      const id = okarte.dataset.oid;
      if (e.target.closest('[data-o-erledigt]')) {
        const set = erledigtIds();
        if (set.has(id)) set.delete(id); else set.add(id);
        erledigtSetzen(set);
        onlineZeichnen();
      } else if (e.target.closest('[data-o-weg]')) {
        if (!await confirmDialog({ title: 'Rückmeldung löschen?', text: 'Sie wird online samt Foto für alle entfernt.', confirmLabel: 'Löschen', danger: true })) return;
        try {
          await api.feedback.loeschen(id);
          online = online.filter((x) => x.id !== id);
          onlineZeichnen();
        } catch (ex) { err('Nicht gelöscht', ex.message); }
      }
      return;
    }
    const karte = e.target.closest('.fb-karte');
    const f = karte && (store.db.feedback || []).find((x) => x.id === karte.dataset.id);
    if (e.target.closest('#devExport')) {
      const daten = (store.db.feedback || []).map(({ id, createdAt, art, text, ansicht, version, fenster, erledigt }) => ({ id, createdAt, art, text, ansicht, version, fenster, erledigt }));
      try {
        await api.file.save({ dataBase64: await textBase64(JSON.stringify(daten, null, 2)), defaultName: `kontovia-rueckmeldungen-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Textdatei (JSON)', extensions: ['json'] }] });
      } catch (ex) { err('Nicht gesichert', ex.message); }
      return;
    }
    if (!f) return;
    if (e.target.closest('[data-erledigt]')) {
      await commit('feedback.aendern', () => { f.erledigt = !f.erledigt; f.updatedAt = new Date().toISOString(); }, { entity: 'feedback', entityId: f.id, summary: 'Rückmeldung abgehakt' });
      zeichnen();
    } else if (e.target.closest('[data-weg]')) {
      if (!await confirmDialog({ title: 'Rückmeldung löschen?', text: 'Sie wird samt Foto entfernt.', confirmLabel: 'Löschen', danger: true })) return;
      await commit('feedback.geloescht', (db) => {
        db.feedback = db.feedback.filter((x) => x.id !== f.id);
        tomb(db, 'feedback', f.id);
        if (f.bildId) {
          db.attachments = db.attachments.filter((a) => a.id !== f.bildId);
          tomb(db, 'attachments', f.bildId);
          api.attach.remove(f.bildId).catch(() => {});
        }
      }, { entity: 'feedback', entityId: f.id, summary: 'Rückmeldung gelöscht' });
      zeichnen();
    } else if (e.target.closest('[data-foto-oeffnen]')) {
      api.attach.openExternal(f.bildId, `rueckmeldung-${f.createdAt.slice(0, 10)}.jpg`).catch((ex) => err('Foto', ex.message));
    }
  });
  zeichnen();
  return m;
}

/** Fünf schnelle Klicks auf die Versionsangabe öffnen das Entwicklermenü. */
export function entwicklerKlick(el) {
  let n = 0;
  let zeit = null;
  el.addEventListener('click', () => {
    n++;
    clearTimeout(zeit);
    zeit = setTimeout(() => { n = 0; }, 2500);
    if (n >= 5) { n = 0; entwicklerMenue(); }
  });
}
