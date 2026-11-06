// SMHI snow1g-koder → svenska etiketter (från param.json-katalogen,
// verifierad 2026-11-05: https://opendata.smhi.se/metfcst/snow1gv1/parameters).
// Väderbilder (symbol_code) 1–27, nederbördsart (ptype) 0–12, vindriktning.

// symbol_code – väderbildekod (27 koder).
export const SYMBOL_CODES = {
  1: 'Klart',
  2: 'Nästan klart',
  3: 'Halvt molnigt',
  4: 'Halvt molnigt',
  5: 'Molnigt',
  6: 'Täckt moln',
  7: 'Dimma',
  8: 'Lätt regnskur',
  9: 'Regnskur',
  10: 'Tung regnskur',
  11: 'Åska',
  12: 'Lätta slaskbyar',
  13: 'Slaskbyar',
  14: 'Tunga slaskbyar',
  15: 'Lätta snöbyar',
  16: 'Snöbyar',
  17: 'Tunga snöbyar',
  18: 'Lätt regn',
  19: 'Regn',
  20: 'Tungt regn',
  21: 'Åska',
  22: 'Lätt slaskig nederbörd',
  23: 'Slaskig nederbörd',
  24: 'Tung slaskig nederbörd',
  25: 'Lätt snöfall',
  26: 'Snöfall',
  27: 'Tunga snöfall',
};

// predominant_precipitation_type_at_surface (ptype, 0–12).
export const PTYPE_CODES = {
  0: 'Ingen nederbörd',
  1: 'Regn',
  2: 'Åska',
  3: 'Isaregn',
  4: 'Slask/isblandad',
  5: 'Snö',
  6: 'Blöt snö',
  7: 'Regn och snö',
  8: 'Ispellets',
  9: 'Pelletshagel',
  10: 'Hagel',
  11: 'Duggregn',
  12: 'Isande duggregn',
};

// null/undefined före koll mot mappningen – Number(null) = 0 och kod 0 är
// giltig för ptype ("Ingen nederbörd"), så fallbacken måste vara explicit.
export const symbolLabel = code =>
  code == null ? '–' : (SYMBOL_CODES[Number(code)] ?? `okänd väderkod ${code}`);

export const ptypeLabel = code =>
  code == null ? '–' : (PTYPE_CODES[Number(code)] ?? `okänd nederbördsart ${code}`);

// 16-ros för vindfrånriktning (grader): 0° = norrvind, 90° = västervind.
const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NVN'];
export const compass = deg => {
  if (deg == null) return '–'; // Number(null) = 0 → annars felaktigt 'N'
  const d = Number(deg);
  if (!Number.isFinite(d)) return '–';
  const i = Math.round((((d % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i];
};

// Vindfrånriktning som "morseende": vind frän N → "blåser mot S".
export const compassTowards = deg => compass(deg + 180);
