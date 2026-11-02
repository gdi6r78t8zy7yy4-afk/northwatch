// Statistik Sweden (SCB) Statistikdatabasen v2 – industri- och handelsstatistik.
// ÖPPT API, ingen nyckel. Verifierat 2026-11-02:
//   GET https://statistikdatabasen.scb.se/api/v2/tables/{id}/data?lang=en
//     → json-stat 2.0 med toppnyckeln "value" (singular). outputFormat
//       accepterar json-stat2/csv; "jsonstat2" (tanst "2") ger 4xx.
//   OBS: gamla data.scb.se-värdnamnet ECONNRESET:ar från testnätet –
//   Statistikdatabasen-värden är det som verkar.
// Tabeller (senaste tidsperiod):
//   TAB4516 "Key figures for Foreign trade" (månad): 3 nyckeltal (nettohandel,
//             import, export) × 3 uppbrytningar (mrdSEK, % förändringar)
//   TAB5166 "Enterprises (FDB)" (år): antal företag per NACE-avsnitt ×
//             storleksklass → summerat för centrala tillverkningsavsnitt
import { jjson, now } from '../lib/http.js';
import { jsonstatRows, jsonstatLatest } from '../lib/jsonstat.js';

const BASE = 'https://statistikdatabasen.scb.se/api/v2';

// Centrala tillverkningsavsnitt (NACE Rev. 2, 2-siffriga koder) för
// företagstalet.
const SECTORS = ['24', '25', '26', '27', '28', '29', '30'];

export default {
  id: 'scb',
  name: 'SCB (industri/handelsstatistik)',
  area: 7,
  country: 'SE',
  every: 86400,
  fetch: async () => {
    const records = [];

    // Utrikeshandel – nyckeltal per månad (senaste publicerade månaden).
    const trade = await jjson(`${BASE}/tables/TAB4516/data?lang=en`);
    const tradeRecs = jsonstatLatest(trade, {
      source: 'scb', area: 7, country: 'SE', unit: 'mrdSEK',
      indicator: (r, last) => {
        const parts = [r.label.NyckeltalSCB, r.label.ContentsCode].filter(Boolean);
        return parts.length ? `${parts.join(' – ')} (${last})` : null;
      },
    });
    if (!tradeRecs.length) throw new Error('SCB TAB4516 levererade inga värden');
    records.push(...tradeRecs);

    // Företag (FDB) – antal per tillverkningsavsnitt, senast publicerade år.
    const ent = await jjson(`${BASE}/tables/TAB5166/data?lang=en`);
    const rows = [...jsonstatRows(ent)];
    const year = rows.map(r => r.code.Tid).filter(Boolean).sort().at(-1);
    if (!year) throw new Error('SCB TAB5166 saknar tidsperiod');
    const sniLabel = ent.dimension?.SNI2007?.category?.label ?? {};
    for (const code of SECTORS) {
      const sum = rows
        .filter(r => r.code.SNI2007 === code && r.code.Tid === year)
        .reduce((s, r) => s + (Number(r.value) || 0), 0);
      records.push({
        t: 'm', area: 7, country: 'SE', source: 'scb',
        indicator: `Antal företag, ${sniLabel[code] ?? code} (${year})`,
        value: sum, unit: 'st', ts: year,
      });
    }

    return records;
  },
};
