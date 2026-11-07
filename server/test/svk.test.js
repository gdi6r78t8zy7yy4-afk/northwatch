// Enhetstester för Svenska kraftnät-kollektorn (2026-11-03-omskrivning).
//
// Rådata från de live-verifierade UUID-resurserna ligger i server/testdata/
// (2026-11-03, alla HTTP 200) – partiella stickprov av respektive
// dataset; kollektorns header dokumenterar fulla live-storlekar.
// Testerna kör kollektorn mot en mockad fetch som emulerar CKAN
// datastore_search-semantik (sort asc + offset/limit) – inget nätverk.
// Förväntade värden beräknas ur fixturen, inte hårdkodas.
//
// Kör: node --test "server/test/svk.test.js"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV = {
  SVK_API_BASE_URL: 'https://data.svk.se',
  SVK_PHYSICAL_FLOWS_RESOURCE_ID: 'rid-flows',
  SVK_AFRR_CAPACITY_RESOURCE_ID: 'rid-afrr',
  SVK_MFRR_CAPACITY_RESOURCE_ID: 'rid-mfrr',
  SVK_FCR_BID_VOLUMES_RESOURCE_ID: 'rid-fcrbid',
  SVK_FCR_ACTIVATED_ENERGY_RESOURCE_ID: 'rid-fcr-energy',
  SVK_FCR_CAPACITY_RESOURCE_ID: 'rid-fcr-capacity',
  SVK_FCR_AGGREGATED_VOLUMES_RESOURCE_ID: 'rid-fcr-agg',
  SVK_DAY_AHEAD_PRICES_RESOURCE_ID: 'rid-dap',
};
Object.assign(process.env, ENV);

const { search, normalizeReserveRows } = await import('../collectors/svk.js');
const svk = (await import('../collectors/svk.js')).default;
const svkHist = (await import('../collectors/svk-hist.js')).default;
const { zoneCenters } = await import('../lib/geolayers.js');

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata');
const FIX = {
  'rid-flows': 'svk-physical-flows.json',
  'rid-afrr': 'svk-afrr.json',
  'rid-mfrr': 'svk-mfrr.json',
  'rid-fcrbid': 'svk-fcrbid.json',
  'rid-fcr-energy': 'svk-hist-fcr-energy.json',
  'rid-fcr-capacity': 'svk-hist-fcr-capacity.json',
  'rid-fcr-agg': 'svk-hist-fcr-agg.json',
  'rid-dap': 'svk-hist-dap.json',
};
const byTime = (a, b) => a.start_time_utc.localeCompare(b.start_time_utc);
const rows = rid => JSON.parse(fs.readFileSync(path.join(TESTDATA, FIX[rid]), 'utf8')).rows;
const sorted = rid => [...rows(rid)].sort(byTime);

// Mockad fetch: emulerar datastore_search för fixturens resource-id:n.
// filters ignoreras – fixturen ligger redan i frågat fönster.
let empty = false;
const seenUrls = [];
function mockFetch() {
  globalThis.fetch = async url => {
    seenUrls.push(String(url));
    const u = new URL(String(url));
    if (!u.pathname.endsWith('/datastore_search')) {
      throw new Error(`mocken fick oväntad URL: ${u.pathname}`);
    }
    const rid = u.searchParams.get('resource_id');
    if (!FIX[rid]) throw new Error(`okänd resource_id: ${rid}`);
    const all = empty ? [] : sorted(rid);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    const limit = Number(u.searchParams.get('limit') ?? 100);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { total: all.length, records: all.slice(offset, offset + limit) },
      }),
    };
  };
}

const realFetch = globalThis.fetch;
before(mockFetch);
after(() => { globalThis.fetch = realFetch; });

// ---- URL-bygge ----------------------------------------------------------

test('search: bygger datastore_search-URL (resource_id, sort, filters)', async () => {
  seenUrls.length = 0;
  const r = await search(ENV.SVK_PHYSICAL_FLOWS_RESOURCE_ID, {
    filters: { start_time_utc: { gte: '2026-11-03T14:00:00', lt: '2026-11-03T20:00:00' } },
    sort: 'start_time_utc',
    limit: 1000,
  });
  const u = new URL(seenUrls[0]);
  assert.equal(`${u.origin}${u.pathname}`,
    'https://data.svk.se/sv/api/3/action/datastore_search');
  assert.equal(u.searchParams.get('resource_id'), ENV.SVK_PHYSICAL_FLOWS_RESOURCE_ID);
  assert.equal(u.searchParams.get('limit'), '1000');
  assert.equal(u.searchParams.get('sort'), 'start_time_utc');
  assert.deepEqual(JSON.parse(u.searchParams.get('filters')),
    { start_time_utc: { gte: '2026-11-03T14:00:00', lt: '2026-11-03T20:00:00' } });
  assert.equal(r.records.length, 8, 'hela fixturen ligger inom limitet');
});

test('search: saknat resource_id avkastar fel före HTTP-anrop', async () => {
  seenUrls.length = 0;
  await assert.rejects(search(undefined), /resource_id saknas/);
  assert.equal(seenUrls.length, 0, 'inget anrop görs utan resource_id');
});

// ---- hela tick-vägen mot fixtures ----------------------------------------

test('svk: senaste flödessteget, nettoexport och zonskilda-linjer', async () => {
  const recs = await svk.fetch();
  const flow = sorted(ENV.SVK_PHYSICAL_FLOWS_RESOURCE_ID);
  const step = flow.at(-1).start_time_utc;
  const list = flow.filter(r => r.start_time_utc === step);
  const m = p => recs.find(r => r.t === 'm' && r.indicator === p);
  for (const r of list) {
    const mm = m(`Nettoflöde ${r.from_bidding_zone}→${r.to_bidding_zone}`);
    assert.ok(mm, `mätvärde saknas för ${r.from_bidding_zone}→${r.to_bidding_zone}`);
    assert.equal(mm.value, Number(r.power));
    assert.equal(mm.unit, r.power_unit);
    assert.equal(mm.country, 'SE');
    assert.equal(mm.ts, `${r.start_time_utc}Z`, 'UTC-tidstämpel med explicit Z');
  }
  // Nettoexport: bara korsande länkar (internt SE2→SE3 exkluderas).
  const isSe = z => /^SE\d$/.test(z);
  const net = list.reduce((a, r) => a + (
    isSe(r.from_bidding_zone) && !isSe(r.to_bidding_zone) ? r.power
    : !isSe(r.from_bidding_zone) && isSe(r.to_bidding_zone) ? -r.power
    : 0), 0);
  assert.equal(m('Svensk nettoexport (SE1–SE4)')?.value, Math.round(net * 10) / 10,
    'internt SE2→SE3 exkluderat, DELU→SE4 räknas som import');
  // Kartlinjer: bara par med zonskilda i energy.geojson.
  const lines = recs.filter(r => r.t === 'a' && r.type === 'flow');
  const expected = list.filter(r => zoneCenters[r.from_bidding_zone] && zoneCenters[r.to_bidding_zone]);
  assert.deepEqual(lines.map(a => a.name).sort(),
    expected.map(r => `${r.from_bidding_zone}→${r.to_bidding_zone}`).sort(),
    'bara par med zonskilda blir kartlinjer');
  assert.ok(lines.every(a => a.country === 'NORDIC' && a.geometry.type === 'LineString'));
  assert.ok(!lines.some(a => a.name.startsWith('DELU')),
    'DELU har inget zonskilda och ritas ej');
});

test('svk: aFRR- och mFRR-leveransen för den tidigaste blocktimmen', async () => {
  const recs = await svk.fetch();
  const m = p => recs.find(r => r.t === 'm' && r.indicator === p);
  const af = sorted(ENV.SVK_AFRR_CAPACITY_RESOURCE_ID)[0];
  const am = m(`aFRR-leverans ${af.start_time_utc.slice(11, 16)} (${af.bidding_zone} ${af.reserve_direction})`);
  assert.ok(am, 'aFRR-KPI:n saknas');
  assert.equal(am.value, Number(af.volume));
  assert.equal(am.unit, af.volume_unit);
  const mf = sorted(ENV.SVK_MFRR_CAPACITY_RESOURCE_ID);
  const hour = mf[0].start_time_utc;
  for (const dir of ['up', 'down']) {
    const sum = mf.filter(r => r.start_time_utc === hour && r.reserve_direction === dir)
      .reduce((a, r) => a + Number(r.volume), 0);
    assert.equal(m(`mFRR-leverans ${hour.slice(11, 16)} (${dir})`)?.value,
      Math.round(sum * 10) / 10, `mFRR ${dir} summeras över SE1–SE4`);
  }
});

test('svk: sista FCR-bidmätningen ur avstannat dataset behåller frusen tidsstämpel', async () => {
  seenUrls.length = 0;
  const recs = await svk.fetch();
  const bid = sorted(ENV.SVK_FCR_BID_VOLUMES_RESOURCE_ID).at(-1);
  const m = recs.find(r => r.t === 'm' && r.indicator ===
    `FCR-erbjudandevolym (sista mätning, ${bid.auction_round} ${bid.reserve_product} ${bid.reserve_direction})`);
  assert.ok(m, 'FCR-bidmätningen saknas');
  assert.equal(m.value, Number(bid.volume));
  assert.equal(m.ts, `${bid.start_time_utc}Z`);
  // Sista raden hämtas via total + offset (asc-sorterat), inte första sidan.
  const offsets = seenUrls.map(u => new URL(u).searchParams.get('offset'))
    .filter(v => v !== null && v !== '0');
  assert.ok(offsets.includes(String(rows(ENV.SVK_FCR_BID_VOLUMES_RESOURCE_ID).length - 1)),
    'offset = total−1 används för sista raden');
});

test('svk-hist: sista mätningen per fruset dataset med egen tidsstämpel', async () => {
  const recs = await svkHist.fetch();
  assert.equal(recs.length, 4, 'en post per dataset');
  assert.ok(recs.every(r => r.t === 'm' && r.source === 'svk-hist' && r.country === 'SE' && r.area === 1));
  const last = rid => sorted(rid).at(-1);
  const byLabel = l => recs.find(r => r.indicator.startsWith(l));
  const e = last(ENV.SVK_FCR_ACTIVATED_ENERGY_RESOURCE_ID);
  assert.equal(byLabel('FCR aktiverad energi')?.value, Number(e.volume));
  assert.equal(byLabel('FCR aktiverad energi')?.unit, e.volume_unit);
  assert.equal(byLabel('FCR aktiverad energi')?.ts, `${e.start_time_utc}Z`, 'frusen tidsstämpel 2025-03');
  const c = last(ENV.SVK_FCR_CAPACITY_RESOURCE_ID);
  assert.equal(byLabel('FCR-kapacitet')?.value, Number(c.volume));
  const g = last(ENV.SVK_FCR_AGGREGATED_VOLUMES_RESOURCE_ID);
  assert.equal(byLabel('FCR aggregerad volym')?.value, Number(g.volume));
  const d = last(ENV.SVK_DAY_AHEAD_PRICES_RESOURCE_ID);
  const dm = byLabel('Dagstima-pris');
  assert.equal(dm?.value, Number(d.price));
  assert.equal(dm?.unit, d.price_unit);
  assert.match(dm?.indicator, /sista uppdatering, SE3/);
});

test('svk/svk-hist: tomma dataset avkastar fel till källhälsan', async () => {
  empty = true;
  await assert.rejects(svk.fetch(), /physical_flows: inga rader/);
  await assert.rejects(svkHist.fetch(), /svk-hist: inga rader/);
  empty = false;
});


test('reserve normalization exposes capacity and price separately per zone and direction', () => {
  const rows = [
    { start_time_utc:'2026-11-03T17:00:00', bidding_zone:'SE1', reserve_direction:'up', volume:120.5, volume_unit:'MW', price:2.1, price_unit:'EUR-MW' },
    { start_time_utc:'2026-11-03T17:00:00', bidding_zone:'SE1', reserve_direction:'down', volume:95, volume_unit:'MW', price:2.4, price_unit:'EUR-MW' },
    { start_time_utc:'2026-11-03T18:00:00', bidding_zone:'SE2', reserve_direction:'up', volume:110, volume_unit:'MW', price:1.6, price_unit:'EUR-MW' },
  ];
  const out = normalizeReserveRows('mfrr', rows);
  assert.equal(out.length, 6);
  assert.ok(out.some(r => r.indicator === 'mFRR-kapacitet SE1 up' && r.value === 120.5 && r.unit === 'MW'));
  assert.ok(out.some(r => r.indicator === 'mFRR-kapacitetspris SE1 up' && r.value === 2.1 && r.unit === 'EUR-MW'));
  assert.ok(out.some(r => r.indicator === 'mFRR-kapacitet SE1 down' && r.value === 95));
  assert.ok(!out.some(r => r.indicator.includes('SE2')), 'only the earliest delivery block is selected');
  assert.ok(out.some(r => r.indicator === 'mFRR-leverans 17:00 (up)' && r.value === 120.5));
  assert.ok(out.some(r => r.indicator === 'mFRR-leverans 17:00 (down)' && r.value === 95));
});

test('reserve normalization does not invent missing prices or accept invalid rows', () => {
  const rows = [
    { start_time_utc:'2026-11-03T17:00:00', bidding_zone:'SE3', reserve_direction:'up', volume:80, volume_unit:'MW' },
    { start_time_utc:'2026-11-03T17:00:00', bidding_zone:'SE4', reserve_direction:'sideways', volume:70, volume_unit:'MW', price:3, price_unit:'EUR-MW' },
    { start_time_utc:'2026-11-03T17:00:00', bidding_zone:'SE2', reserve_direction:'down', volume:'bad', volume_unit:'MW', price:'bad', price_unit:'EUR-MW' },
  ];
  const out = normalizeReserveRows('afrr', rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].indicator, 'aFRR-kapacitet SE3 up');
  assert.equal(out[0].value, 80);
});
