// Enhetstester för SMHI väderprognos (M8, område 11).
//
// Rådata från live-verifierade SMHI snow1g-frågor (2026-11-05, alla HTTP 200;
// cykel 2026-11-05T17:58:23Z) ligger i server/testdata/smhi-forecast/.
// Punktfixturen fullpoint.json är en komplett point-tidsserie (81 steg,
// 24 parametrar); mp*/mpp* är multipoint-gridsvar (downsample 1 och 20).
//
// Tick-testerna kör kollektorns hela väg mot en mockad fetch med tider
// genererade relativt nu-tillfället (så att "nu-steg" + evenemangsfönstret
// är deterministiskt oberoende av när testet körs). Förväntade värden
// beräknas ur override-tabellerna, inte hårdkodas.
//
// Kör: node --test server/test/smhi-forecast.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Miljön sätts INOM importen: POINTS/SMHI_FCST_CACHE_DIR läses då.
const CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smhi-fcst-'));
process.env.SMHI_FCST_CACHE_DIR = CACHE_DIR;
process.env.SMHI_FCST_POINTS =
  'Trollhättan=15.60,58.32,Umeå=20.25,63.83,Luleå=22.15,65.58,Reykjavik=-21.94,64.15';
delete process.env.SMHI_FCST_PARAMS;
delete process.env.SMHI_GRID_DOWNSAMPLE;

const {
  fc, POINTS, PARAMS, GRID_PARAMS, GRID_DOWNSAMPLE, MISSING,
  parsePointsEnv, nowIndex, cycleSafeName, ingestCycle, pruneCycles,
  loadLatestFromDisk, apiForecastMeta, apiForecastPoint, apiForecastGrid, apiForecastGridCoords,
} = await import('../lib/forecast.js');
const kollektorn = (await import('../collectors/smhi-forecast.js')).default;
const { EVENT_HORIZON, THRESHOLDS } = await import('../collectors/smhi-forecast.js');

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'smhi-forecast');
const fixture = f => JSON.parse(fs.readFileSync(path.join(TESTDATA, f), 'utf8'));

// ---- Testdata (dynamisk cykel + override-tabell) -------------------------

// 81 timsteg med start 1 h framåt i tiden → nuIndex ger alltid 0.
const BASE = new Date(Date.now() + 3600e3);
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z');
const TIMES = Array.from({ length: 81 }, (_, i) => iso(BASE.getTime() + i * 3600e3));
const CT1 = '2026-11-05T17:58:23Z';
const CT2 = '2026-11-05T18:58:23Z';
const REF = '2026-11-05T17:45:00Z';

const BASE_DATA = {
  air_temperature: -2,
  wind_from_direction: 220,
  wind_speed: 3.1,
  wind_speed_of_gust: 5.2,
  relative_humidity: 80,
  air_pressure_at_mean_sea_level: 1005,
  visibility_in_air: 20,
  cloud_area_fraction: 5,
  thunderstorm_probability: 0,
  probability_of_frozen_precipitation: 10,
  precipitation_amount_mean: 0.2,
  precipitation_amount_max: 0.5,
  precipitation_frozen_part: -9,
  predominant_precipitation_type_at_surface: 0,
  symbol_code: 2,
};
assert.deepEqual(Object.keys(BASE_DATA).sort(), [...PARAMS].sort(), 'BASE_DATA täcker de 15 punkt-parametrarna');

// Override per steg: tröskelbrott i det första dygnet (fönstret 0..EVENT_HORIZON).
const POINT_CFG = {
  'Trollhättan': { lon: 15.6, lat: 58.32, ov: { 2: { wind_speed_of_gust: 23.4 }, 3: { air_temperature: -16 }, 4: { wind_speed_of_gust: 18 } } },
  'Umeå': { lon: 20.25, lat: 63.83, ov: { 2: { thunderstorm_probability: 65 }, 3: { probability_of_frozen_precipitation: 55 }, 4: { precipitation_amount_max: 22 } } },
  'Luleå': { lon: 22.15, lat: 65.58, ov: {} },
};
const OUTSIDE_NAME = 'Reykjavik';

const makePoint = (lon, lat, times, createdTime, ov = {}) => ({
  createdTime,
  referenceTime: REF,
  geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
  timeSeries: times.map((time, i) => ({
    time,
    intervalParametersStartTime: iso(new Date(time).getTime() - 3600e3),
    data: { ...BASE_DATA, ...(ov[i] ?? {}) },
  })),
});

// Griddatavärden (korta mock-koordinatmängder; längden styr valideringen).
const GRID_COORDS = Array.from({ length: 12 }, (_, i) => [5 + i, 60 + i / 10]);
const GRID_VALUES = [2.1, 1.8, 9999, 0.4, -1.2, 3.7, 9999, 9999, -5.5, 0.1, 2.9, 4.4];

// ---- Mockad fetch ----------------------------------------------------------

let CREATED = CT1;
let TIMES_CUR = TIMES;
let POINT_FIXTURES = {};
let fetchCount = 0;

function jsonResp(body, status = 200) {
  return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function mockFetch() {
  globalThis.fetch = async url => {
    fetchCount += 1;
    url = String(url);
    if (url.endsWith('/createdtime.json')) {
      return jsonResp({ createdTime: CREATED, referenceTime: REF });
    }
    if (url.endsWith('/times.json')) return jsonResp({ time: TIMES_CUR });
    const pt = url.match(/geotype\/point\/lon\/(-?[\d.]+)\/lat\/(-?[\d.]+)\/data\.json/);
    if (pt) {
      const fx = POINT_FIXTURES[`${pt[1]}|${pt[2]}`];
      if (!fx) return jsonResp({ error: 'Requested point is out of bounds' }, 404);
      return jsonResp(fx);
    }
    if (url.includes('/geotype/multipoint.json')) {
      return jsonResp({ type: 'MultiPoint', coordinates: GRID_COORDS });
    }
    if (url.includes('/geotype/multipoint/time/')) {
      return jsonResp({ createdTime: CREATED, timeSeries: [{ time: TIMES_CUR[0], data: { air_temperature: GRID_VALUES } }] });
    }
    throw new Error(`oväntad URL i mocken: ${url}`);
  };
}

const realFetch = globalThis.fetch;
before(() => {
  POINT_FIXTURES = {
    '15.6|58.32': makePoint(15.6, 58.32, TIMES, CT1, POINT_CFG['Trollhättan'].ov),
    '20.25|63.83': makePoint(20.25, 63.83, TIMES, CT1, POINT_CFG['Umeå'].ov),
    '22.15|65.58': makePoint(22.15, 65.58, TIMES, CT1, POINT_CFG['Luleå'].ov),
    // Anpassad plats (utanför katalogen) för point-API:t.
    '10.75|59.91': makePoint(10.75, 59.91, TIMES, CT1, {}),
  };
  mockFetch();
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
});

const url = qs => new URL(qs, 'http://localhost');

// ---- parser/env-parsning ---------------------------------------------------

test('parsePointsEnv: giltig lista, tom sträng, trasiga poster', () => {
  const pts = parsePointsEnv('A=1,2, B=-3.5,60.25');
  assert.deepEqual(pts, [
    { name: 'A', lon: 1, lat: 2, country: 'NORDIC' },
    { name: 'B', lon: -3.5, lat: 60.25, country: 'NORDIC' },
  ]);
  assert.equal(parsePointsEnv(''), null);
  assert.equal(parsePointsEnv('  '), null);
  assert.throws(() => parsePointsEnv('utan-koordinat'), /ogiltig post/);
  assert.throws(() => parsePointsEnv('A=x,2'), /ogiltig koordinat/);
});

test('POINTS i testmiljön: 4 punkter (Reykjavik utanför domänen)', () => {
  assert.equal(POINTS.length, 4);
  assert.deepEqual(POINTS.map(p => p.name), ['Trollhättan', 'Umeå', 'Luleå', 'Reykjavik']);
  assert.ok(POINTS.every(p => p.country === 'NORDIC'), 'env-punkter får land NORDIC');
});

test('nowIndex: första steg som är nu eller senare', () => {
  assert.equal(nowIndex([], new Date('2026-01-01T00:00:00Z')), -1);
  assert.equal(nowIndex(['2030-01-01T00:00:00Z'], new Date('2026-01-01T00:00:00Z')), 0);
  assert.equal(nowIndex(['2020-01-01T00:00:00Z', '2020-01-01T05:00:00Z'], new Date('2020-01-01T04:59:59Z')), 1);
  assert.equal(nowIndex(['2020-01-01T00:00:00Z', '2020-01-01T05:00:00Z'], new Date('2021-01-01T00:00:00Z')), 1);
});

test('cycleSafeName: filnamn för cykel', () => {
  assert.equal(cycleSafeName(CT1), '20261105T175823Z');
});

// ---- fixturkonsekvens (live-verifierad form) -------------------------------

test('fixture: fullpoint – 81 steg, 24 parametrar, intervallexponenten', () => {
  const full = fixture('fullpoint.json');
  assert.equal(full.timeSeries.length, 81);
  const catalog = fixture('param.json').parameter;
  const names = new Set(catalog.map(p => p.name));
  for (const step of full.timeSeries) {
    assert.deepEqual(new Set(Object.keys(step.data)), names, 'samma 24 parametrar i varje steg');
    assert.ok(step.time && step.intervalParametersStartTime, 'tid + intervallstart i varje steg');
  }
  // Intervallsumman växer med prognosdjup: 58×1 h, 3 h, 13×6 h, 9×12 h.
  const lens = full.timeSeries.map(s => (new Date(s.time) - new Date(s.intervalParametersStartTime)) / 3600e3);
  assert.deepEqual(lens, [
    ...Array(58).fill(1), 3, ...Array(13).fill(6), ...Array(9).fill(12),
  ]);
  assert.equal(full.createdTime, CT1);
  assert.equal(full.geometry.type, 'Point');
});

test('fixture: createdtime/times stämmer med fullpoint; param-katalogen', () => {
  const ct = fixture('createdtime.json');
  assert.equal(ct.createdTime, CT1);
  assert.ok(ct.referenceTime);
  const times = fixture('times.json');
  const full = fixture('fullpoint.json');
  assert.equal(times.time.length, 81);
  assert.equal(times.time[0], full.timeSeries[0].time);
  assert.equal(times.time.at(-1), full.timeSeries.at(-1).time);

  const catalog = fixture('param.json').parameter;
  assert.equal(catalog.length, 24);
  assert.ok(catalog.every(p => p.missingValue === MISSING), 'missingValue 9999 i hela katalogen');
  const names = new Set(catalog.map(p => p.name));
  for (const p of PARAMS) assert.ok(names.has(p), `punkt-parametern ${p} finns i katalogen`);
  for (const p of GRID_PARAMS) assert.ok(names.has(p), `grid-parametern ${p} finns i katalogen`);
});

test('fixture: gridsvar (downsample 1 och 20) – längd, koordinater, form', () => {
  const mp20 = fixture('mp20.json');
  const mpp20 = fixture('mpp20.json');
  const v20 = mp20.timeSeries[0].data.wind_speed_of_gust;
  assert.equal(v20.length, mpp20.coordinates.length, 'värden indexerade på koordinatindex');
  assert.equal(v20.length, 48 * 54, 'ds20-rutnätet är 48×54 punkter');
  assert.ok(v20.every(x => typeof x === 'number'), 'värden är skalärer (9999 = saknad)');

  const mp = fixture('mp.json');
  assert.ok(mp.timeSeries[0].data.air_temperature.length > 1000, 'fullt rutnät (ds1) är större');
  assert.equal(mp.createdTime, CT1);

  const tr = fixture('tromso.json');
  assert.equal(tr.timeSeries.length, 1, 'enstegsvar (timeseries=1)');
  assert.equal(typeof tr.timeSeries[0].data.air_temperature, 'number');
  assert.deepEqual(tr.geometry.coordinates, [18.980893, 69.649731]);
});

// ---- tick-vägen --------------------------------------------------------------

test('tick 1: fullastar cykeln, 4 städer (1 utanför), poster + härledda händelser', async () => {
  const recs = await kollektorn.fetch();
  const m = recs.filter(r => r.t === 'm');
  const e = recs.filter(r => r.t === 'e');
  assert.equal(m.length, 3 * 4, '4 indikatorer per inom domänen (Reykjavik utanför)');
  assert.equal(e.length, 6, '6 härledda händelser');

  // Metric-posterna speglar nu-stegets (steg 0) värden.
  const val = ind => m.find(r => r.indicator === ind);
  for (const name of Object.keys(POINT_CFG)) {
    assert.equal(val(`${name} temperatur (prognos)`)?.value, BASE_DATA.air_temperature);
    assert.equal(val(`${name} temperatur (prognos)`)?.ts, TIMES[0]);
    assert.equal(val(`${name} temperatur (prognos)`)?.area, 11);
    assert.equal(val(`${name} temperatur (prognos)`)?.source, 'smhi-forecast');
  }
  assert.ok(m.every(r => r.source === 'smhi-forecast' && r.area === 11));

  // Händelser: trösklar värst-först, rätt allvarlighetsgrad och tidssteg.
  const ev = pat => e.find(x => x.title.match(pat));
  const storm = ev(/^Byig storm 23\.4 m\/s – Trollhättan \(prognos .* UTC\)$/);
  assert.ok(storm, 'röd storm-tröskel (≥22.5 m/s)');
  assert.equal(storm.severity, 'röd');
  assert.equal(storm.start, TIMES[2]);
  assert.equal(storm.kind, 'väderprognos');
  assert.equal(storm.country, 'NORDIC');
  assert.deepEqual(storm.geo.coordinates, [15.6, 58.32]);
  assert.match(storm.detail, /Beräknad utifrån prognos/);
  // Vid 23.4 m/s eldas bara den värsta nivån – ingen extra "Byig vind"
  // för samma tidssteg.
  const step2 = e.filter(x => x.start === TIMES[2]);
  assert.equal(step2.filter(x => x.title.startsWith('Byig')).length, 1, 'värsta nivå per steg');
  assert.equal(ev(/^Extremt kallt -16 °C – Trollhättan/)?.severity, 'orange', 'temperatur ≤ −15');
  assert.equal(ev(/^Byig vind 18 m\/s – Trollhättan/)?.severity, 'orange', 'lägre bynivå på senare steg');
  assert.equal(ev(/^Hög åskrisk 65 % – Umeå/)?.severity, 'gul');
  assert.equal(ev(/^Risk för frusn nederbörd 55 % – Umeå/)?.severity, 'gul');
  const nederbörd = ev(/^Stark nederbörd 22 mm – Umeå/);
  assert.equal(nederbörd?.severity, 'gul');
  assert.match(nederbörd.detail, /summa över prognosintervall/);
  assert.equal(e.filter(x => x.country === 'NORDIC').length, 6);
});

test('tick 2: samma cykel → returnerar kända poster utan nya SMHI-anrop', async () => {
  const before = fetchCount;
  const recs = await kollektorn.fetch();
  assert.equal(fetchCount, before + 1, 'endast createdtime.json kollas (ingen omhämtning)');
  const again = await kollektorn.fetch();
  assert.equal(fetchCount, before + 2);
  assert.equal(again, recs, 'samma lista återanvänds');
  assert.equal(recs.length, 18);
});

test('tick 3: ny cykel (timme senare) → ny cykel + nya poster', async () => {
  CREATED = CT2;
  TIMES_CUR = TIMES.map(t => iso(new Date(t).getTime() + 3600e3));
  POINT_FIXTURES = Object.fromEntries(
    Object.entries(POINT_FIXTURES).map(([k, v]) => [k, makePoint(
      v.geometry.coordinates[0], v.geometry.coordinates[1], TIMES_CUR, CT2, {})]));
  const recs = await kollektorn.fetch();
  assert.equal(fc.cycle.createdTime, CT2);
  assert.equal(fc.pointsByCycle.size, 2, 'båda cyklarna i minnet');
  assert.equal(recs.filter(r => r.t === 'm').length, 12, '12 indikatorer');
  assert.equal(recs.filter(r => r.t === 'e').length, 0, 'inga tröskelbrott i baseline-datan');
  // Tick igen: cachade poster.
  const before = fetchCount;
  assert.equal(await kollektorn.fetch(), recs);
  assert.equal(fetchCount, before + 1);
});

test('retention: cykelfiler på disk, innehåll, 12-cykelns röningsbehållning', async () => {
  const files = fs.readdirSync(CACHE_DIR);
  assert.ok(files.includes(`${cycleSafeName(CT1)}.json`));
  assert.ok(files.includes(`${cycleSafeName(CT2)}.json`));
  const d1 = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${cycleSafeName(CT1)}.json`), 'utf8'));
  assert.equal(d1.createdTime, CT1);
  assert.deepEqual(d1.times, TIMES);
  assert.deepEqual(Object.keys(d1.points).sort(), ['Luleå', 'Trollhättan', 'Umeå'], 'Reykjavik sparas ej');
  assert.ok(d1.savedAt);

  // Skapa 13 äldre cykler + tiles (den gamla cykeln 00:00 och den behållna 12:00).
  const dummies = [];
  for (let h = 0; h < 13; h += 1) {
    const name = `20261104T${String(h).padStart(2, '0')}0000Z.json`;
    fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify({
      createdTime: `2026-11-04T${String(h).padStart(2, '0')}:00:00Z`, times: [TIMES[0]], points: {},
    }));
    dummies.push(name);
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'smhi-grid-air_temperature-20261104T000000Z-ds20-20261104T000000Z.json'), '{}');
  fs.writeFileSync(path.join(CACHE_DIR, 'smhi-grid-air_temperature-20261104T120000Z-ds20-20261104T120000Z.json'), '{}');

  pruneCycles();
  const after = fs.readdirSync(CACHE_DIR);
  const cycleFiles = after.filter(f => /^\d{8}T\d{6}Z\.json$/.test(f));
  assert.equal(cycleFiles.length, 12, 'högst 12 cykler behålls');
  assert.ok(after.includes(`${cycleSafeName(CT1)}.json`));
  assert.ok(after.includes(`${cycleSafeName(CT2)}.json`));
  assert.ok(!after.includes('20261104T000000Z.json'), 'äldsta cykeln rönas');
  assert.ok(!after.includes('20261104T010000Z.json'));
  assert.ok(!after.includes('smhi-grid-air_temperature-20261104T000000Z-ds20-20261104T000000Z.json'), 'tile för rönad cykel raderas');
  assert.ok(after.includes('smhi-grid-air_temperature-20261104T120000Z-ds20-20261104T120000Z.json'), 'tile för behållen cykel kvar');
});

test('loadLatestFromDisk: efter "omstart" svarar meta från disken', async () => {
  fc.cycle = null;
  fc.pointsByCycle.clear();
  fc.outside.clear();
  assert.equal(loadLatestFromDisk()?.createdTime, CT2, 'senaste cykeln laddas');
  const { status, body } = await apiForecastMeta(url('/api/forecast/meta'));
  assert.equal(status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.createdTime, CT2);
  assert.equal(body.times.length, 81);
  assert.equal(body.points.length, 4);
});

// ---- API-handlingar ---------------------------------------------------------

test('meta: redo-flagga, punkter med outsideDomain, grid-konfiguration', async () => {
  const { status, body } = await apiForecastMeta(url('/api/forecast/meta'));
  assert.equal(status, 200);
  assert.equal(body.ready, true);
  assert.deepEqual(body.points.map(p => p.name), POINTS.map(p => p.name));
  const ry = body.points.find(p => p.name === OUTSIDE_NAME);
  // fc.outside rensades ovan och är ej persisted – flaggan återfinns först
  // efter nästa cycled (404:et). Här: ej utanför (dokumenterat beteende).
  assert.equal(ry.outsideDomain, false);
  assert.equal(body.grid.downsample, GRID_DOWNSAMPLE);
  assert.deepEqual(body.grid.parameters, GRID_PARAMS);
});

test('point: katalogpunkt, anpassad plats, utanför domänen, saknade param', async () => {
  // Katalogpunkt (nuvarande cykel CT2 – baseline-värden).
  const cat = await apiForecastPoint(url('/api/forecast/point?point=Trollhättan'));
  assert.equal(cat.status, 200);
  assert.equal(cat.body.timeSeries.length, 81);
  assert.equal(cat.body.createdTime, CT2);
  assert.equal(cat.body.point.lon, 15.6);
  assert.equal(cat.body.point.lat, 58.32);
  assert.equal(cat.body.point.country, 'NORDIC');

  // Anpassad plats (klick på kartan): hämtas on-demand och minnescachas.
  const adh = await apiForecastPoint(url('/api/forecast/point?lat=59.91&lon=10.75'));
  assert.equal(adh.status, 200);
  assert.match(adh.body.point.name, /^Anpassad plats \(59\.91, 10\.75\)$/);
  assert.equal(adh.body.timeSeries.length, 81);
  const adhAgain = await apiForecastPoint(url('/api/forecast/point?lat=59.91&lon=10.75'));
  assert.equal(adhAgain.body.timeSeries, adh.body.timeSeries, 'minnescachad (samma referens)');

  // Utanför domänen: katalogpunkt (Reykjavik, 404) och anpassad plats.
  const out = await apiForecastPoint(url(`/api/forecast/point?point=${OUTSIDE_NAME}`));
  assert.equal(out.status, 404);
  const outAdh = await apiForecastPoint(url('/api/forecast/point?lat=64.15&lon=-21.94'));
  assert.equal(outAdh.status, 404);
  assert.match(outAdh.body.error, /utanför SMHI/);

  // Saknade/ogiltiga param: utan val 400; okänt katalognamn är 400
  // (känd namn utanför domänen är i stället 404, se ovan).
  assert.equal((await apiForecastPoint(url('/api/forecast/point'))).status, 400);
  assert.equal((await apiForecastPoint(url('/api/forecast/point?point=FinnsInte'))).status, 400);

  // Validering av anpassade koordinater: icke-numeriska och utanför giltigt intervall.
  const nanRes = await apiForecastPoint(url('/api/forecast/point?lat=abc&lon=12.5'));
  assert.equal(nanRes.status, 400);
  assert.match(nanRes.body.error, /numeriska och inom lat/);

  const latOutOfRange = await apiForecastPoint(url('/api/forecast/point?lat=95&lon=12.5'));
  assert.equal(latOutOfRange.status, 400);
  assert.match(latOutOfRange.body.error, /numeriska och inom lat/);

  const lonOutOfRange = await apiForecastPoint(url('/api/forecast/point?lat=60&lon=190'));
  assert.equal(lonOutOfRange.status, 400);
  assert.match(lonOutOfRange.body.error, /numeriska och inom lat/);

  // Hastighetsbegränsning per klientnyckel vid anpassade prognoser.
  const clientKey = 'test-rate-limit-client';
  let lastStatus = 200;
  for (let i = 0; i < 21; i++) {
    const res = await apiForecastPoint(url('/api/forecast/point?lat=59.91&lon=10.75'), clientKey);
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});

test('grid-coords: statiska rutnätskoordinater', async () => {
  const r = await apiForecastGridCoords(url(`/api/forecast/grid-coords?downsample=${GRID_DOWNSAMPLE}`));
  assert.equal(r.status, 200);
  assert.equal(r.body.count, GRID_COORDS.length);
  assert.deepEqual(r.body.coordinates, GRID_COORDS);
});

test('grid: värden per parameter+tidssteg, cachelagring, disk-mirror, felstyrning', async () => {
  const q = url(`/api/forecast/grid?time=${encodeURIComponent(TIMES_CUR[5])}&parameter=air_temperature`);
  const r = await apiForecastGrid(q);
  assert.equal(r.status, 200);
  assert.equal(r.body.parameter, 'air_temperature');
  assert.equal(r.body.time, TIMES_CUR[5]);
  assert.equal(r.body.count, GRID_VALUES.length);
  assert.deepEqual(r.body.values, GRID_VALUES);
  assert.ok(r.body.values.includes(MISSING), 'saknade celler (9999) reläeras som de är');

  // Minnescachad.
  const r2 = await apiForecastGrid(q);
  assert.equal(r2.body.values, r.body.values, 'samma referens ur minnescachen');

  // Disk-mirror: rensa minnet, vänta på filen och hämta igen.
  fc.gridTiles.clear();
  const tiles = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('smhi-grid-') && f.endsWith('.json'));
  assert.ok(tiles.length >= 1, 'gridskivorna speglas på disk');
  const r3 = await apiForecastGrid(q);
  assert.equal(r3.status, 200);
  assert.deepEqual(r3.body.values, GRID_VALUES, 'återläsas från disk-mirorn');

  // Felstyrning.
  assert.equal((await apiForecastGrid(url(`/api/forecast/grid?time=${encodeURIComponent(TIMES_CUR[5])}&parameter=bogus`))).status, 400);
  assert.equal((await apiForecastGrid(url('/api/forecast/grid?parameter=air_temperature'))).status, 400);
  const badTime = await apiForecastGrid(url('/api/forecast/grid?time=2000-01-01T00:00:00Z&parameter=air_temperature'));
  assert.equal(badTime.status, 400);
});

test('collector: totalt misslyckande avkastar fel till hälsan', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNRESET (test)'); };
  CREATED = CT1;
  fc.cycle = null;
  await assert.rejects(kollektorn.fetch(), /ECONNRESET/);
  mockFetch();
});

test('smhi-forecast är registrerad i kollektorsregistret med rätt form', async () => {
  assert.equal(kollektorn.id, 'smhi-forecast');
  assert.equal(kollektorn.area, 11);
  assert.equal(kollektorn.every, 300);
  assert.ok(THRESHOLDS.length >= 4);
  assert.ok(EVENT_HORIZON > 0);
});
