// FIRST.org EPSS – sannolikhet för aktiv utnyttjande av sårbarheter.
// Öppet API, ingen nyckel krävs (NVD_API_KEY i .env höjer rate-limiten).
// Uppdateras dagligen (UTC) – pollar därför en gång per dygn.
// Verifierat 2026-11-01: /data/v1/epss?limit=N&sort=-percentile →
//   {results:[{cpe, epss, percentile, date, cvss_vector, cwe_ids}]}
import { jjson, now } from '../lib/http.js';

export default {
  id: 'epss',
  name: 'FIRST EPSS',
  area: 5,
  country: 'NORDIC',
  every: 86400,
  fetch: async () => {
    const key = process.env.NVD_API_KEY ? `&api_key=${process.env.NVD_API_KEY}` : '';
    const d = await jjson(`https://api.first.org/data/v1/epss?limit=10&sort=-percentile${key}`);
    // Svarsformen är {data:[{cve, epss, percentile, date, …}]} (v1).
    const rows = d.data ?? d.results ?? [];
    if (!rows.length) throw new Error('EPSS returnerade inga rader');
    const id = r => r.cve ?? r.cpe;
    const top = rows.slice(0, 3);
    return [
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'epss',
        indicator: 'Top-10 EPSS-procentil (exploitsannolikhet)',
        value: Number(rows[0].percentile), unit: '0–1',
        ts: rows[0].date ?? now(),
      },
      {
        t: 'e', area: 5, country: 'NORDIC', source: 'epss',
        kind: 'sårbarhet', severity: 'info',
        title: `Mest aktiva sårbarheter: ${top.map(id).join(', ')}`,
        detail: top.map(r => `${id(r)} – EPSS ${r.epss} (procentil ${r.percentile})`).join('\n'),
        start: now(),
      },
    ];
  },
};
