// Svenska kraftnät Data Service – historiska dataset (data.svk.se, ingen
// nyckel). Alla fyra är frusna per 2026-11-03 (SVK:s egna titlar:
// "Discontinued" resp. "Currently not updating"):
//   fcr_activated_energy  senaste rad 2025-03-04
//   fcr_capacity          senaste rad 2026-04-14
//   fcr_agg_volumes       senaste rad 2026-04-14
//   day_ahead_prices      senaste rad 2026-07-01
// Pollas var 6:e timme för att fånga en återupptagning; posterna bär
// dataens egna tidstämpel så att åldern syns i dashboards tabell.
import { search } from './svk.js';

const DATASETS = [
  {
    env: 'SVK_FCR_ACTIVATED_ENERGY_RESOURCE_ID',
    label: 'FCR aktiverad energi',
    suffix: 'mätning',
    detail: r => `${r.bidding_zone} ${r.reserve_product} ${r.reserve_direction}`,
    value: r => r.volume,
  },
  {
    env: 'SVK_FCR_CAPACITY_RESOURCE_ID',
    label: 'FCR-kapacitet',
    suffix: 'mätning',
    detail: r => `${r.bidding_zone} ${r.reserve_product} ${r.reserve_direction} (${r.auction_round})`,
    value: r => r.volume,
  },
  {
    env: 'SVK_FCR_AGGREGATED_VOLUMES_RESOURCE_ID',
    label: 'FCR aggregerad volym',
    suffix: 'mätning',
    detail: r => `${r.reserve_product} ${r.reserve_direction} (${r.auction_round})`,
    value: r => r.volume,
  },
  {
    env: 'SVK_DAY_AHEAD_PRICES_RESOURCE_ID',
    label: 'Dagstima-pris',
    suffix: 'uppdatering',
    detail: r => r.bidding_zone,
    value: r => r.price,
  },
];

// Senaste raden i datasetet: total först, sedan offset = total−1 i
// asc-sorterad ordning (samma mönster som i svk.js).
async function lastRow(resourceId) {
  const { total } = await search(resourceId, { limit: 1 });
  if (!total) return null;
  const { records } = await search(resourceId, {
    limit: 1, sort: 'start_time_utc', offset: total - 1,
  });
  return records[0] ?? null;
}

export default {
  id: 'svk-hist',
  name: 'Svenska kraftnät (historiskt)',
  area: 1,
  country: 'SE',
  every: 21600,
  need: DATASETS.map(d => d.env),
  fetch: async () => {
    const env = process.env;
    const recs = [];
    for (const d of DATASETS) {
      const r = await lastRow(env[d.env]);
      if (!r) continue; // dataset tomt – hoppa utan att rubba hälsan
      recs.push({
        t: 'm', area: 1, country: 'SE', source: 'svk-hist',
        indicator: `${d.label} (sista ${d.suffix}, ${d.detail(r)})`,
        value: Number(d.value(r)),
        unit: r.volume_unit ?? r.price_unit ?? '',
        ts: `${r.start_time_utc}Z`,
      });
    }
    if (!recs.length) throw new Error('svk-hist: inga rader i något historiskt dataset');
    return recs;
  },
};
