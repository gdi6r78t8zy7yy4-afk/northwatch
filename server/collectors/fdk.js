// NO: Felles datakatalog (DigDir) (M11, område 12) – Norges åpne metadata-
// katalog, CC0. Söks-API:t är officiellt internt/instabilt (OpenAPI-spec:
// https://search.api.fellesdatakatalog.digdir.no/v3/api-docs) med 10 rpm
// (burst 20) → takt 6 s mellan anropen (FDK_DELAY_MS, nollas i tester).
// POST https://search.api.fellesdatakatalog.digdir.no/search/datasets
//   body {query:"", filters:{...}, pagination:{size,page}}
// page.totalElements är DEN SANTTA ANTALLET (hits = en sida). Verifierade
// filter: lastXDaysModified (metadata ändrad inom N dagar), lastXDays
// (registrerat inom N dagar) – Integer. aggregations.openData ger
// [{key:"true"|"false", count}] → andelen öppna dataset (allmän åtkomst).
// Records per körning (NO): totalt antal, metadataändrade ≤365 d,
// nyregistrerade ≤365 d, metadataändrade ≤30 d (aktivitet), öppna antal
// + andel. Veckohämtning.
import { j, now, sleep } from '../lib/http.js';

const BASE = 'https://search.api.fellesdatakatalog.digdir.no/search/datasets';

const search = async (filters, delayMs, i) => {
  if (i > 0 && delayMs > 0) await sleep(delayMs);
  const r = await j(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '', filters, pagination: { size: 1, page: 0 } }),
    timeout: 30000,
  });
  return r.json();
};

// Sista ikrafta öppna-dataandel ur aggregations.openData (0–1).
export const openDataShare = aggs => {
  const od = aggs?.openData;
  if (!Array.isArray(od)) return null;
  let open = 0; let closed = 0;
  for (const b of od) {
    if (b.key === 'true') open = Number(b.count) || 0;
    if (b.key === 'false') closed = Number(b.count) || 0;
  }
  return open + closed ? open / (open + closed) : null;
};

const total = doc => Number(doc?.page?.totalElements) || 0;

export default {
  id: 'fdk',
  name: 'Felles datakatalog (DigDir, öppna dataset)',
  area: 12,
  country: 'NO',
  every: 604800,
  fetch: async () => {
    const delay = Number(process.env.FDK_DELAY_MS ?? 6000);
    const ts = now();
    const rec = (indicator, value, unit = 'st') => ({
      t: 'm', area: 12, country: 'NO', source: 'fdk', indicator, value, unit, ts,
    });

    // 1) Hela katalogen + öppna-dataandel (aggregationen medförs i varje svar).
    const base = await search({}, delay, 0);
    const all = total(base);
    const share = openDataShare(base.aggregations);
    const records = [rec('Dataset i Felles datakatalog', all)];
    if (share != null) {
      const open = Math.round(all * share);
      records.push(
        rec('Öppna dataset (allmän åtkomst)', open),
        rec('Öppna dataset (andel)', Math.round(share * 1000) / 10, '%'),
      );
    }

    // 2) Aktivitetsfönster – metadata som faktiskt underhålls.
    try {
      const m365 = await search({ lastXDaysModified: 365 }, delay, 1);
      records.push(rec('Dataset med uppdaterad metadata (≤365 d)', total(m365)));
    } catch (e) {
      records.push(rec('fdk metadata≤365d: hämtfel', null, ''));
    }
    try {
      const n365 = await search({ lastXDays: 365 }, delay, 2);
      records.push(rec('Nyregistrerade dataset (≤365 d)', total(n365)));
    } catch (e) {
      records.push(rec('fdk nya≤365d: hämtfel', null, ''));
    }
    try {
      const m30 = await search({ lastXDaysModified: 30 }, delay, 3);
      records.push(rec('Dataset med metadataändring (≤30 d)', total(m30)));
    } catch (e) {
      records.push(rec('fdk metadata≤30d: hämtfel', null, ''));
    }

    return records;
  },
};
