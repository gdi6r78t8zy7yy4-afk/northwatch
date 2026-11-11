// Energi Data Service – dag-ahead-elpriser (15-minutersupplösning sedan EU:s
// övergång till 15-minutersmarknader 2025-09-30, då Elspotprices lades ner).
// Öppet dataset-API, ingen nyckel. Verifierat live 2026-11-11:
//   /dataset/DayAheadPrices?start=StartOfDay&end=now&endOffset=P2D –
//   TimeUTC + PriceArea; fält DayAheadPriceDKK (DKK/MWh) och
//   DayAheadPriceEUR (EUR/MWh); prisområden DE, DK1, DK2, NO2, SE3, SE4.
// Start-/end-parametrar tolkas som dansk lokal tid. Priser publiceras dagligen
// ca 13:00 CET för kommande dygn – framtida leveranstimmar ingår i svaret.
// DK1/DK2 lagras i DKK/kWh (samma skala som elprisetjustnu:s SEK/kWh).
// NO2 (Oslo-området) är Norges enda priszon hos EDS och lagras i EUR/MWh –
// täckningen är partiell för Norge och det framgår av indikatornamnet.
// SE3/SE4 utesluts: elprisetjustnu täcker alla fyra SE-zoner i SEK.
import { jjson } from '../lib/http.js';

const BASE = process.env.EDS_BASE || 'https://api.energidataservice.dk/dataset';

// Prisområde → land och hur priset ska omvandlas till lagrad enhet.
export const PRICE_ZONES = {
  DK1: { country: 'DK', field: 'DayAheadPriceDKK', divide: 1000, unit: 'DKK/kWh' },
  DK2: { country: 'DK', field: 'DayAheadPriceDKK', divide: 1000, unit: 'DKK/kWh' },
  NO2: { country: 'NO', field: 'DayAheadPriceEUR', divide: 1, unit: 'EUR/MWh' },
};

export function normalizeDayAheadRows(records) {
  if (!Array.isArray(records)) throw new Error('DayAheadPrices: response must include a records array');
  const out = [];
  for (const rec of records) {
    const zone = String(rec?.PriceArea ?? '');
    const cfg = PRICE_ZONES[zone];
    if (!cfg) continue; // andra prisområden (DE, SE3, SE4 …) ignoreras
    const raw = Number(rec[cfg.field]);
    const start = rec.TimeUTC;
    if (rec[cfg.field] == null || !Number.isFinite(raw)) {
      continue; // saknat värde – hoppa över i stället för att nollställa
    }
    if (typeof start !== 'string' || !Number.isFinite(Date.parse(start + 'Z'))) {
      continue;
    }
    out.push({
      t: 'm', area: 1, country: cfg.country, source: 'eds-dayahead',
      indicator: `Dag-ahead-pris ${zone}`, value: raw / cfg.divide,
      unit: cfg.unit, ts: new Date(Date.parse(start + 'Z')).toISOString(),
    });
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

export default {
  id: 'eds-dayahead',
  name: 'Energi Data Service – Dag-ahead-priser',
  area: 1,
  country: 'NORDIC', // levererar mätvärden för både DK och NO (som entsoe)
  every: 3600, // priserna publiceras en gång per dygn; timvis kollning räcker
  fetch: async () => {
    const filter = encodeURIComponent(JSON.stringify({ PriceArea: Object.keys(PRICE_ZONES) }));
    const url = `${BASE}/DayAheadPrices?start=StartOfDay&startOffset=-P1D`
      + `&end=now&endOffset=P2D&filter=${filter}&sort=TimeUTC%20asc`;
    const d = await jjson(url);
    const records = normalizeDayAheadRows(d.records ?? []);
    if (!records.length) throw new Error('DayAheadPrices: inga nordiska prisintervall returnerades');
    return records;
  },
};
