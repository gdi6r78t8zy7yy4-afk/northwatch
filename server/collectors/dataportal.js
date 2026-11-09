// EU: data.europa.eu Data Portal – hub-sök (M11, område 12). Ingen auth.
// GET https://data.europa.eu/api/hub/search/search (spec:
// /api/hub/search/openapi.yaml). Viktigt: `q=`-syntax och `sort=` ändrar INTE
// resultatantalet; landfiltrering görs med `facets={"country":["se"]}` (JSON
// som string) och `filters=dataset`. `countOnly=true` ger bara
// {result:{index,count}} → billiga räkningar. `minDate` + `dateType=modified`
// mäter aktivitet (dataset uppdaterade inom 30 dagar). Verifierade totaler
// 2026-11-08: se 25 085, no 9 559, is 611, dk 3 707, fi 2 959 (IS: via
// EFTA-kataloger i portalen). Månadshämtning.
import { j, now, sleep } from '../lib/http.js';

const BASE = 'https://data.europa.eu/api/hub/search/search';
export const HUB_COUNTRIES = {
  SE: 'se', NO: 'no', DK: 'dk', FI: 'fi', IS: 'is',
};

const hubGet = async (params, delayMs, i) => {
  if (i > 0 && delayMs > 0) await sleep(delayMs);
  const r = await j(`${BASE}?${params}`);
  return r.json();
};

// Lokaliserad titel ur results[0] (titel är en per-språk-mappa).
export const titleOf = result => {
  const t = result?.title;
  if (t == null) return null;
  if (typeof t === 'string') return t;
  return t.sv ?? t.en ?? t.no ?? t.da ?? t.fi ?? Object.values(t)[0] ?? null;
};

export default {
  id: 'dataportal',
  name: 'data.europa.eu Data Portal (öppna dataset)',
  area: 12,
  country: 'NORDIC',
  every: 2592000, // 30 dagar
  fetch: async () => {
    const delay = Number(process.env.DATAPORTAL_DELAY_MS ?? 1500);
    const ts = now();
    const records = [];
    const failed = [];
    const counter = { i: 0 };
    const minDate = new Date(Date.now() - 30 * 86400000).toISOString();

    for (const [cc, hub] of Object.entries(HUB_COUNTRIES)) {
      const rec = (indicator, value, unit = 'st') => ({
        t: 'm', area: 12, country: cc, source: 'dataportal', indicator, value, unit, ts,
      });
      try {
        const facets = encodeURIComponent(JSON.stringify({ country: [hub] }));
        const totalDoc = await hubGet(
          `filters=dataset&countOnly=true&facets=${facets}`, delay, (counter.i += 1));
        const total = Number(totalDoc?.result?.count) || 0;
        const rec30Doc = await hubGet(
          `filters=dataset&countOnly=true&facets=${facets}&minDate=${encodeURIComponent(minDate)}&dateType=modified`,
          delay, (counter.i += 1));
        const recent = Number(rec30Doc?.result?.count) || 0;
        records.push(
          rec('Öppna dataset i data.europa.eu', total),
          rec('Dataset uppdaterade (≤30 d)', recent),
        );
        // Tre nyaste dataseten → händelser för panelen.
        const sample = await hubGet(
          `filters=dataset&limit=3&sort=modified+desc&facets=${facets}`, delay, (counter.i += 1));
        for (const d of sample?.result?.results ?? []) {
          records.push({
            t: 'e', area: 12, country: cc, source: 'dataportal', kind: 'dataset',
            severity: 'info',
            title: titleOf(d) ?? d.id,
            detail: d.catalog?.name ?? d.catalog?.id ?? d.id,
            start: d.modified ?? d.issued ?? ts.slice(0, 10),
          });
        }
      } catch (e) {
        failed.push({ country: cc, message: e.message });
        records.push(rec(`dataportal ${cc}: hämtfel`, null, ''));
      }
    }
    if (failed.length === Object.keys(HUB_COUNTRIES).length) {
      throw new Error(`data.europa.eu: alla 5 länder misslyckades – ${failed[0].message}`);
    }
    return records;
  },
};
