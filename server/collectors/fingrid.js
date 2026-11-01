// Fingrid Open Data – gratis API-nyckel (x-api-key), 10 000 anrop/24 h,
// max 1 anrop/2 s per key. FINGRID_DATASETS="datasetId:Indikatornamn,..."
// – välj konkreta dataset från https://data.fingrid.fi (endpunkt väljs
// per dataset; "latest"-vägen verifieras i M2).
import { jjson, now, sleep } from '../lib/http.js';

export default {
  id: 'fingrid',
  name: 'Fingrid',
  area: 1,
  country: 'FI',
  every: 180,
  need: 'FINGRID_KEY',
  fetch: async () => {
    const out = [];
    for (const d of (process.env.FINGRID_DATASETS || '').split(',').filter(Boolean)) {
      const [id, name] = d.split(':');
      const r = await jjson(`https://data.fingrid.fi/api/datasets/${id}/data/latest`, {
        headers: { 'x-api-key': process.env.FINGRID_KEY },
      });
      out.push({
        t: 'm', area: 1, country: 'FI', source: 'fingrid',
        indicator: (name || id).trim(),
        value: r.value ?? r.latest?.value ?? r.data ?? null,
        unit: r.unit || 'MW',
        ts: r.startTime || r.timestamp || now(),
      });
      await sleep(2100); // håll under 1 anrop/2 s
    }
    if (!out.length) throw new Error('Saknar FINGRID_DATASETS');
    return out;
  },
};
