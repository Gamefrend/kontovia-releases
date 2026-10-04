/**
 * Kontovia – Rückmeldungen der Nutzer und das versteckte Entwicklermenü.
 *
 * Wer etwas mitteilen möchte, schreibt frei Text und kann ein Bildschirmfoto
 * der Seite mitgeben, auf der er gerade war (ohne das Rückmeldefenster, siehe
 * bildschirmfoto.js). Die Rückmeldung liegt vorerst im verschlüsselten
 * Bestand dieses Geräts (db.feedback, das Foto als Beleg) und nirgends sonst.
 * Das Entwicklermenü zeigt sie an: Fünfmal auf die Versionsangabe unten
 * rechts klicken. Ein Versand per E-Mail kommt später.
 */

import { html, raw, esc, $, $$, uid, fmtDateTime } from './util.js';
import { icon, modal, ok, err, confirmDialog } from './ui.js';
import { store, commit, saveNow, tomb } from './store.js';
import { router } from './router.js';
import { seiteAufnehmen } from './bildschirmfoto.js';
import { VERSIONEN } from './versionen.js';

const api = window.kontovia;

const ARTEN = [['idee', 'Idee'], ['fehler', 'Fehler'], ['frage', 'Frage'], ['lob', 'Lob']];
const ARTNAME = Object.fromEntries(ARTEN);
const MAX_TEXT = 5000;

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
      ${raw(fotoBlob ? `<div class="field mb0"><label class="check"><input type="checkbox" id="fbFoto" checked> <span>Bildschirmfoto der Seite mitsenden</span></label>
          <div class="fb-foto" id="fbVorschau"><img src="${fotoUrl}" alt="Bildschirmfoto der Seite, auf der Sie waren"></div>
          <span class="hint">Das Foto zeigt die Seite so, wie Sie sie eben gesehen haben, ohne dieses Fenster. Es kann Zahlen aus Ihrer Buchhaltung zeigen. Ohne Haken wird es nicht gespeichert.</span></div>`
    : '<p class="small muted mb0">Ein Bildschirmfoto ließ sich in diesem Browser nicht erstellen. Ihre Nachricht können Sie trotzdem abschicken.</p>')}
      <p class="small muted mt16 mb0">Ihre Rückmeldung wird verschlüsselt in Ihrer Buchhaltung auf diesem Gerät gespeichert. Das Absenden per E-Mail kommt später.</p>`,
    foot: '<button class="btn" data-nein>Abbrechen</button><button class="btn primary" data-ja>Speichern</button>',
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
    e.currentTarget.disabled = true;
    try {
      await feedbackSpeichern({ art, text: t, foto: $('#fbFoto', m.root)?.checked ? fotoBlob : null });
      gesendet = true;
      m.close();
      ok('Danke für Ihre Rückmeldung', 'Sie ist gespeichert.');
    } catch (ex) {
      e.currentTarget.disabled = false;
      err('Nicht gespeichert', ex.message);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Entwicklermenü                                                              */
/* -------------------------------------------------------------------------- */

const textBase64 = (s) => alsBase64(new Blob([s], { type: 'text/plain;charset=utf-8' }));

/** Zeigt alle gespeicherten Rückmeldungen. In Arbeit: Versand per E-Mail. */
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

  function zeichnen() {
    aufraeumen();
    const liste = [...(store.db.feedback || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const offen = liste.filter((f) => !f.erledigt).length;
    $('#devInhalt', m.root).innerHTML = `
      <div class="notice mb16"><strong>In Arbeit.</strong> Rückmeldungen liegen vorerst nur auf diesem Gerät. Das Absenden per E-Mail folgt später.
        Version ${esc(VERSIONEN[0]?.version || '')}.</div>
      <div class="row between wrap mb16" style="gap:8px">
        <h3 class="m0">Rückmeldungen <span class="muted small">${liste.length} gesamt, ${offen} offen</span></h3>
        <button class="btn sm" id="devExport" ${liste.length ? '' : 'disabled'}>${icon('export', 14).__raw} Alle als Textdatei sichern</button>
      </div>
      ${liste.length ? liste.map((f) => `
        <div class="fb-karte ${f.erledigt ? 'erledigt' : ''}" data-id="${esc(f.id)}">
          <div class="row wrap" style="gap:8px">
            <span class="chip">${esc(ARTNAME[f.art] || f.art)}</span>
            <span class="small muted">${esc(fmtDateTime(f.createdAt))}</span>
            ${f.ansicht ? `<span class="small muted">Seite: ${esc(f.ansicht)}</span>` : ''}
            <span class="small muted">${esc(f.fenster || '')}</span>
            <span class="spacer"></span>
            <button class="btn sm ghost" data-erledigt>${f.erledigt ? 'Wieder öffnen' : 'Erledigt'}</button>
            <button class="btn sm ghost danger-text" data-weg>${icon('trash', 13).__raw} Löschen</button>
          </div>
          <p class="fb-text">${esc(f.text)}</p>
          ${f.bildId ? `<div class="fb-foto"><img data-bild="${esc(f.bildId)}" alt="Bildschirmfoto zur Rückmeldung"><button class="btn sm ghost" data-foto-oeffnen>Foto öffnen</button></div>` : ''}
        </div>`).join('') : '<p class="muted">Noch keine Rückmeldungen. Sie entstehen über „Feedback“ in der Seitenleiste.</p>'}`;
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
