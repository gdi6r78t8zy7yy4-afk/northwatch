// PeeringDB – internetutbyten (IX) per nordiskt land: strukturmått för
// digital infrastruktur (område 2). Öppet API, ingen nyckel.
// OBS: URL:en får INTE ha avslutande snedstreck (ger 404).
// SVaret är {data:[...]}; Nordic IX-totalen ligger väl under limit=1000.
// M3: API:t bär sedan 2026 inte med koordinater (x/y borttagna) → IX:ar
// placeras på stadsnivå via en statisk koordinatordlista (se nedan).
import { jjson, now } from '../lib/http.js';

const COUNTRIES = ['SE', 'NO', 'DK', 'FI'];

// [lon, lat] per stad – nordiska IX-städer, verifierade mot API:ts city-fält
// 2026-11-02. Kompositer (t.ex. "Sundsvall / Gavle") placeras på första staden.
const CITY_COORDS = {
  bergen: [5.32, 60.39],
  copenhagen: [12.57, 55.68],
  esbjerg: [8.14, 55.47],
  espoo: [24.86, 60.20],
  gothenburg: [11.97, 57.71],
  göteborg: [11.97, 57.71],
  helsinki: [24.94, 60.17],
  kristiansand: [8.00, 58.15],
  lulea: [22.15, 65.58],
  luleå: [22.15, 65.58],
  malmo: [13.00, 55.60],
  malmö: [13.00, 55.60],
  'malmo / copenhagen': [12.57, 55.68],
  oslo: [10.75, 59.91],
  oulu: [25.47, 65.01],
  stavanger: [5.73, 58.97],
  stockholm: [18.07, 59.33],
  'stockholm, gothenburg, malmö, amsterdam': [18.07, 59.33],
  sundsvall: [17.31, 62.39],
  'sundsvall / gavle': [17.31, 62.39],
  tampere: [23.77, 61.50],
  tromsø: [18.96, 69.65],
  tromso: [18.96, 69.65],
  trondheim: [10.40, 63.43],
  turku: [22.27, 60.45],
  umea: [20.25, 63.83],
  umeå: [20.25, 63.83],
};

export default {
  id: 'peeringdb',
  name: 'PeeringDB (IX)',
  area: 2,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const per = await Promise.all(COUNTRIES.map(async cc => {
      const d = await jjson(`https://www.peeringdb.com/api/ix?country=${cc}&limit=1000`);
      const list = d.data ?? [];
      return {
        cc,
        n: list.length,
        nets: list.reduce((a, r) => a + (Number(r.net_count) || 0), 0),
        // M3: IX-positioner som kartasset (område 2) – stadsnivå (API:t har
        // inga koordinater). IX:ar utan känd stad utesluts ur kartlagret.
        assets: list
          .map(r => [r, CITY_COORDS[(r.city ?? '').trim().toLowerCase()]])
          .filter(([, coords]) => coords)
          .map(([r, coords]) => ({
            t: 'a', area: 2, country: cc, source: 'peeringdb',
            type: 'ix', name: r.name ?? `IX ${r.id}`,
            geometry: { type: 'Point', coordinates: coords },
            attrs: { city: r.city ?? null, networks: r.net_count ?? 0 },
            updated: now(),
          })),
      };
    }));
    const total = per.reduce((a, p) => a + p.n, 0);
    const records = per.map(p => ({
      t: 'm', area: 2, country: p.cc, source: 'peeringdb',
      indicator: 'Internetutbyten (IX)', value: p.n, unit: 'st', ts: now(),
    }));
    records.push({
      t: 'm', area: 2, country: 'NORDIC', source: 'peeringdb',
      indicator: 'IX totalt (Nordiskt)', value: total, unit: 'st', ts: now(),
    });
    records.push({
      t: 'm', area: 2, country: 'NORDIC', source: 'peeringdb',
      indicator: 'IX-anslutna nätverk (Nordiskt)',
      value: per.reduce((a, p) => a + p.nets, 0), unit: 'st', ts: now(),
    });
    for (const p of per) records.push(...p.assets);
    return records;
  },
};
