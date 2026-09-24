/**
 * Kontovia – scrypt im Hintergrund-Thread.
 * Rechnet eine einzige Ableitung und wird danach beendet; damit geben
 * Browser die rund 128 MiB Arbeitsspeicher sofort wieder frei.
 */

import { scrypt } from './scrypt.js';

self.onmessage = async (e) => {
  const { password, salt, params } = e.data || {};
  try {
    const key = await scrypt(new Uint8Array(password), new Uint8Array(salt), params);
    self.postMessage({ key }, [key.buffer]);
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
