/**
 * Kontovia – ZIP-Archive ohne Fremdbibliothek.
 *
 * Die Windows-Fassung schreibt „Alles für das Finanzamt“ und die
 * Prüfungsdaten in einen Ordner. Safari und das iPhone kennen keine
 * Ordnerauswahl; dort kommt derselbe Inhalt als ein ZIP-Archiv heraus, das
 * die Dateien-App und jedes Betriebssystem von selbst öffnen.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Bereits komprimierte Formate werden nur abgelegt – Packen brächte nichts. */
const SCHON_GEPACKT = /\.(pdf|jpe?g|png|gif|webp|heic|zip|docx|xlsx|kvbak|gz)$/i;

async function deflateRaw(u8) {
  try {
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch {
    return null; // Browser ohne deflate-raw: dann eben ungepackt
  }
}

function dosZeit(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * @param {{name:string, data:Uint8Array}[]} files
 * @returns {Promise<Uint8Array>}
 */
export async function zip(files) {
  const te = new TextEncoder();
  const { time, date } = dosZeit(new Date());
  const lokale = [];
  const zentrale = [];
  let offset = 0;
  const vergeben = new Set();

  for (const f of files) {
    // Doppelte Namen würden sich beim Entpacken überschreiben.
    let name = String(f.name || 'datei').replace(/\\/g, '/').replace(/^\/+/, '');
    if (vergeben.has(name)) {
      const punkt = name.lastIndexOf('.');
      let i = 2;
      const neu = (n) => (punkt > 0 ? `${name.slice(0, punkt)} (${n})${name.slice(punkt)}` : `${name} (${n})`);
      while (vergeben.has(neu(i))) i++;
      name = neu(i);
    }
    vergeben.add(name);

    const nameBytes = te.encode(name);
    const data = f.data;
    const crc = crc32(data);
    let methode = 0;
    let inhalt = data;
    if (!SCHON_GEPACKT.test(name) && data.length > 64) {
      const packed = await deflateRaw(data);
      if (packed && packed.length < data.length) { methode = 8; inhalt = packed; }
    }

    const kopf = new Uint8Array(30 + nameBytes.length);
    const k = new DataView(kopf.buffer);
    k.setUint32(0, 0x04034b50, true);
    k.setUint16(4, 20, true);
    k.setUint16(6, 0x0800, true); // Dateinamen in UTF-8
    k.setUint16(8, methode, true);
    k.setUint16(10, time, true);
    k.setUint16(12, date, true);
    k.setUint32(14, crc, true);
    k.setUint32(18, inhalt.length, true);
    k.setUint32(22, data.length, true);
    k.setUint16(26, nameBytes.length, true);
    k.setUint16(28, 0, true);
    kopf.set(nameBytes, 30);

    const zk = new Uint8Array(46 + nameBytes.length);
    const z = new DataView(zk.buffer);
    z.setUint32(0, 0x02014b50, true);
    z.setUint16(4, 20, true);
    z.setUint16(6, 20, true);
    z.setUint16(8, 0x0800, true);
    z.setUint16(10, methode, true);
    z.setUint16(12, time, true);
    z.setUint16(14, date, true);
    z.setUint32(16, crc, true);
    z.setUint32(20, inhalt.length, true);
    z.setUint32(24, data.length, true);
    z.setUint16(28, nameBytes.length, true);
    z.setUint32(42, offset, true);
    zk.set(nameBytes, 46);

    lokale.push(kopf, inhalt);
    zentrale.push(zk);
    offset += kopf.length + inhalt.length;
  }

  const zGroesse = zentrale.reduce((n, b) => n + b.length, 0);
  const ende = new Uint8Array(22);
  const e = new DataView(ende.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, zGroesse, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + zGroesse + ende.length);
  let o = 0;
  for (const b of [...lokale, ...zentrale, ende]) { out.set(b, o); o += b.length; }
  return out;
}
