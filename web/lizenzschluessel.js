/**
 * Kontovia – öffentlicher Schlüssel des Betreibers für Lizenzscheine (ECDSA P-256).
 *
 * Er prüft nur; signieren kann allein der private Teil, der den Rechner des Betreibers nie verlässt
 * (scripts/lizenz-schluessel.js legt ihn unter ~/.kontovia-lizenz ab). Wer den Schlüssel tauscht,
 * macht alle bisher ausgestellten Scheine ungültig.
 */

export const OEFFENTLICHER_SCHLUESSEL = {
  kty: 'EC',
  crv: 'P-256',
  x: 'Je-W6sFV0T-TzeRcANEASYyFqkvx68gGMiISatEFQqM',
  y: 'yZrnnutYHUFX6vI813HDHcAoNu5KHAD_-oIAWV-uWVg',
};
