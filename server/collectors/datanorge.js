// NO: data.norge.no / Felles datakatalog – antal norska öppna dataset som
// rör GNSS/positionering (område 10, information enbart; ingår inte i index).
// data.norge.no:s egna dokumenterade API-pekar (/nb/technical/api/*) svarar
// med HTML (Next-app), CKAN-koden api/3/action/package_search ger 404
// (verifierat 2026-11-09). Den faktiskt fungerande sök-API:t är samma som
// fdk.js använder för område 12: POST till search.api.fellesdatakatalog.digdir.no
// /search/datasets – page.totalElements är det sanna antalet. Veckohämtning,
// paus mellan anrop (DATANORGE_DELAY_MS, nollas i tester).
import { j, now, sleep } from '../lib/http.js';

const BASE = 'https://search.api.fellesdatakatalog.digdir.no/search/datasets';
export const QUERIES = ['gnss', 'posisjonering'];

async function search(query, delayMs, i) {
  if (i > 0 && delayMs > 0) await sleep(delayMs);
  const r = await j(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, filters: {}, pagination: { size: 1, page: 0 } }),
    timeout: 30000,
  });
  return r.json();
}

export default {
  id: 'datanorge',
  name: 'data.norge.no (GNSS/positioneringsdataset)',
  area: 10,
  country: 'NO',
  every: 604800,
  fetch: async () => {
    const delay = Number(process.env.DATANORGE_DELAY_MS ?? 6500); // FDK 10 rpm
    const ts = now();
    const records = [];
    let ok = 0;
    for (let i = 0; i < QUERIES.length; i++) {
      let doc;
      try {
        doc = await search(QUERIES[i], delay, i);
        ok++;
      } catch (e) {
        records.push({ t: 'm', area: 10, country: 'NO', source: 'datanorge', indicator: `GNSS-dataset (${QUERIES[i]})`, value: null, unit: 'st', ts });
        continue;
      }
      const total = Number(doc?.page?.totalElements) || 0;
      const pub = (doc?.aggregations?.accessRights ?? []).find(b => b.key === 'PUBLIC')?.count ?? 0;
      records.push(
        { t: 'm', area: 10, country: 'NO', source: 'datanorge', indicator: `GNSS-dataset (${QUERIES[i]})`, value: total, unit: 'st', ts },
        { t: 'm', area: 10, country: 'NO', source: 'datanorge', indicator: `Publika GNSS-dataset (${QUERIES[i]})`, value: pub, unit: 'st', ts },
      );
    }
    if (!ok) throw new Error('Felles datakatalog-söket svarade inte');
    return records;
  },
};
