// Svenska kraftnät Data Service (data.svk.se) – CKAN datastore API.
// Ingen API-nyckel (API Guide 2026-06-25, https://data.svk.se/blog/api_guide:
// "No API token required" – helt öppen portal).
// Verifierat live 2026-11-03 (svk_probe1–5):
//   GET {SVK_API_BASE_URL}/sv/api/3/action/datastore_search
//     params: resource_id, limit (max 32000, default 100), offset,
//             sort (asc), filters (JSON-objekt: gt/gte/lt/lte);
//             datum krävs som full ISO-tid (UTC, utan Z).
//   physical_flows: 15-min-steg, ~14 zonpar (SE1–4, NO1–4, DK1/2, FI, LT,
//     PL, DELU), ~2 h publiceringsfördröjning → fönstret är 3 h bakåt.
//   afrr/mfrr_capacity: timvisa leveransblock, publicerade ~5 h framåt.
//   fcr_bid_volumes: markerat "Discontinued" av SVK (senaste rad 2026-04-14)
//     → sista mätningen visas med dess egna, frusna tidstämpel.
// Historiska dataset (fcr_activated_energy, fcr_capacity, fcr_agg_volumes,
// day_ahead_prices – frusna 2025-03 … 2026-07) poldas i svk-hist.js (6 h).
import { jjson } from '../lib/http.js';
import { zoneCenters } from '../lib/geolayers.js';

const BASE = process.env.SVK_API_BASE_URL || 'https://data.svk.se';
const iso = d => d.toISOString().slice(0, 19);

// Ensam ingång till portalen. Svar: { success, result: { total, records } }.
export async function search(resourceId, { filters = null, sort = null, limit = 500, offset = 0 } = {}) {
  if (!resourceId) throw new Error('svk: resource_id saknas (SVK_*_RESOURCE_ID i .env)');
  const p = new URLSearchParams({ resource_id: resourceId, limit: String(limit) });
  if (offset) p.set('offset', String(offset));
  if (sort) p.set('sort', sort);
  if (filters) p.set('filters', JSON.stringify(filters));
  const j = await jjson(`${BASE}/sv/api/3/action/datastore_search?${p}`);
  if (j?.success !== true) {
    throw new Error(`data.svk.se: success=${j?.success} (${j?.error?.message ?? 'okänt svar'})`);
  }
  return { total: j.result?.total ?? 0, records: j.result?.records ?? [] };
}

// Senaste raden (datasetets nyaste inskrivna värde) – två anrop:
// total först, sedan offset = total−1 i asc-sorterad ordning.
async function lastRow(resourceId) {
  const { total } = await search(resourceId, { limit: 1 });
  if (!total) return null;
  const { records } = await search(resourceId, {
    limit: 1, sort: 'start_time_utc', offset: total - 1,
  });
  return records[0] ?? null;
}

const metric = (indicator, value, unit, ts) => ({
  t: 'm', area: 1, country: 'SE', source: 'svk', indicator,
  value, unit, ts,
});

// Fysiska gränsflöden (15 min): senaste fulla steget inom 3 h.
async function qFlows(resourceId) {
  const { records: rows } = await search(resourceId, {
    limit: 1000, sort: 'start_time_utc',
    filters: { start_time_utc: { gte: iso(new Date(Date.now() - 3 * 3600 * 1000)) } },
  });
  if (!rows.length) throw new Error('svk physical_flows: inga rader senaste 3 h');
  const step = rows.map(r => r.start_time_utc).sort().at(-1);
  const list = rows.filter(r => r.start_time_utc === step);
  const recs = list.map(r => metric(
    `Nettoflöde ${r.from_bidding_zone}→${r.to_bidding_zone}`,
    Number(r.power), r.power_unit ?? 'MW', `${r.start_time_utc}Z`,
  ));
  // KPI: svensk nettoexport – bara korsande länkar (SE1–SE4 internt exkluderas).
  const isSe = z => /^SE\d$/.test(z);
  const net = list.reduce((a, r) => a + (
    isSe(r.from_bidding_zone) && !isSe(r.to_bidding_zone) ? Number(r.power)
    : !isSe(r.from_bidding_zone) && isSe(r.to_bidding_zone) ? -Number(r.power)
    : 0), 0);
  recs.push(metric('Svensk nettoexport (SE1–SE4)', Math.round(net * 10) / 10, 'MW', `${step}Z`));
  // Kartlager: zonskilda-linjer (lib/geolayers.js), samma mönster som
  // statnett.js – grönt export / rött import ritas av frontend utifrån mw.
  // DELU har inget ankarskilda → raden visas som mätvärde utan linje.
  for (const r of list) {
    const a = zoneCenters[r.from_bidding_zone];
    const b = zoneCenters[r.to_bidding_zone];
    if (!a || !b) continue;
    recs.push({
      t: 'a', area: 1, country: 'NORDIC', source: 'svk',
      type: 'flow', name: `${r.from_bidding_zone}→${r.to_bidding_zone}`,
      geometry: { type: 'LineString', coordinates: [a, b] },
      attrs: { mw: Number(r.power), from: r.from_bidding_zone, to: r.to_bidding_zone },
      updated: `${r.start_time_utc}Z`,
    });
  }
  return recs;
}

// aFRR/mFRR-kapacitetsmarknaden: timvisa leveransblock, ~5 h framåt.
// KPI: blocket för den igångvarande timmen (tidigaste raden i fönstret).
async function qReserve(kind, resourceId) {
  const { records: rows } = await search(resourceId, {
    limit: 500, sort: 'start_time_utc',
    filters: {
      start_time_utc: {
        gte: iso(new Date(Date.now() - 2 * 3600 * 1000)),
        lt: iso(new Date(Date.now() + 48 * 3600 * 1000)),
      },
    },
  });
  if (!rows.length) throw new Error(`svk ${kind}: inga leveransblock i fönstret`);
  const cur = rows[0];
  const hour = cur.start_time_utc.slice(11, 16);
  const ts = `${cur.start_time_utc}Z`;
  const unit = cur.volume_unit ?? 'MW';
  const recs = [];
  if (kind === 'afrr') {
    recs.push(metric(
      `aFRR-leverans ${hour} (${cur.bidding_zone} ${cur.reserve_direction})`,
      Number(cur.volume), unit, ts,
    ));
  } else {
    // mFRR publiceras per zon × riktning – summera per riktning.
    const byDir = new Map();
    for (const r of rows) {
      if (r.start_time_utc !== cur.start_time_utc) continue;
      byDir.set(r.reserve_direction, (byDir.get(r.reserve_direction) ?? 0) + Number(r.volume));
    }
    for (const dir of ['up', 'down']) {
      if (byDir.has(dir)) {
        recs.push(metric(`mFRR-leverans ${hour} (${dir})`,
          Math.round(byDir.get(dir) * 10) / 10, unit, ts));
      }
    }
  }
  return recs;
}

// FCR-bidvolym – SVK har avstannat uppdateringen ("Discontinued").
// Sista mätningen visas med sin frusna tidstämpel så att åldern syns
// per post; datasetet poldas bara var 15:e minut för att fånga en
// återupptagning.
async function qFcrBid(resourceId) {
  const r = await lastRow(resourceId);
  if (!r) return [];
  return [metric(
    `FCR-erbjudandevolym (sista mätning, ${r.auction_round} ${r.reserve_product} ${r.reserve_direction})`,
    Number(r.volume), r.volume_unit ?? 'MW', `${r.start_time_utc}Z`,
  )];
}

export default {
  id: 'svk',
  name: 'Svenska kraftnät',
  area: 1,
  country: 'SE',
  every: 900,
  need: [
    'SVK_PHYSICAL_FLOWS_RESOURCE_ID',
    'SVK_AFRR_CAPACITY_RESOURCE_ID',
    'SVK_MFRR_CAPACITY_RESOURCE_ID',
    'SVK_FCR_BID_VOLUMES_RESOURCE_ID',
  ],
  fetch: async () => {
    const env = process.env;
    const recs = [
      ...(await qFlows(env.SVK_PHYSICAL_FLOWS_RESOURCE_ID)),
      ...(await qReserve('afrr', env.SVK_AFRR_CAPACITY_RESOURCE_ID)),
      ...(await qReserve('mfrr', env.SVK_MFRR_CAPACITY_RESOURCE_ID)),
      ...(await qFcrBid(env.SVK_FCR_BID_VOLUMES_RESOURCE_ID)),
    ];
    if (!recs.length) throw new Error('svk: inga poster från något dataset');
    return recs;
  },
};
