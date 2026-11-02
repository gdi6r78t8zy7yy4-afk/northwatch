// Energinet Electricity Market Service – Mfrr (balanseringsbehov) DK1/DK2.
// ÖPPT API, ingen nyckel. Verifierad 2026-11-02 (swagger v1):
//   GET https://electricitymarketservice.energinet.dk/api/v1/PublicData/Dataset/All/latest
//     → {"messageId","mfrrRequest":[{timeStamp, mtuStart,
//        values:[{area:"DK1"|"DK2", value:MW (teckenriktat)}]}]}
//     Positiva värden = importbehov (balansering efter marknad).
//   Övrigt i swagger: dataset MfrrRequest, /lastweek, /period.
// MTU-takt 15 min; ~213 bytes per anrop → pollar var 5:e minut.
import { jjson, now } from '../lib/http.js';

const BASE = 'https://electricitymarketservice.energinet.dk';

export default {
  id: 'energinet',
  name: 'Energinet (Mfrr DK1/DK2)',
  area: 1,
  country: 'DK',
  every: 300,
  fetch: async () => {
    const r = await jjson(`${BASE}/api/v1/PublicData/Dataset/All/latest`);
    const entries = r.mfrrRequest ?? [];
    if (!entries.length) throw new Error('MfrrRequest saknas i Energinets svar');
    const latest = entries[entries.length - 1];
    const rows = latest.values ?? [];
    if (!rows.length) throw new Error('MfrrRequest saknar värden');
    const sum = rows.reduce((s, v) => s + (Number(v.value) || 0), 0);
    const ts = latest.timeStamp ?? now();
    return [
      ...rows.map(v => ({
        t: 'm', area: 1, country: 'DK', source: 'energinet',
        indicator: `Mfrr-efterfrågan ${v.area} (positivt = importbehov)`,
        value: Number(v.value), unit: 'MW', ts,
      })),
      {
        t: 'm', area: 1, country: 'DK', source: 'energinet',
        indicator: 'Mfrr-efterfrågan DK1+DK2 (positivt = importbehov)',
        value: sum, unit: 'MW', ts,
      },
    ];
  },
};
