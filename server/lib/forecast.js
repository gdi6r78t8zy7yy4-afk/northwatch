// SMHI väderprognos (SNOW / snow1g) – retention + API-layer för prognoscyklar.
// Källan är SMHIs öppna prognos-API (2,5 km-rutnät, nordiskt område; alla
// tider UTC), nyckelfri – kontaktuppgiften i User-Agent räcker:
//   https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/
//
// Prognosen uppdateras ~varje timme (ny cykel ca 15 min efter timslaget,
// createdtime.json). Varje cykel bär ~81 timsteg (max 10 dygn).
//
// Retention (disk + minne):
//   – senaste KEEP_CYCLES cyklar på disk: <cache>/<createdTime>.json
//     (tidslistan + tidsserier för samtliga katalogpunkter per cykel)
//   – multipoint-griddatavärden (kartyt) cachas i minnet per cykel med
//     plattsmirror på disk: smhi-grid-<param>-<time>-ds<N>-<createdTime>.json
//   – fritvalda platser (klick på kartan) cachas i minnet bara, giltig
//     under aktuell cykel.
//
// Datastruktur (per punkt, ur SMHI): timeSeries: [{ time,
// intervalParametersStartTime, data: {parameter: value} }].
//   – nederbördsparametrar är SUMMAN över ett intervall (kg/m2 ≈ mm) som
//     växer med prognosdjup (1→3→6→12 h); intervalParametersStartTime
//     markerar intervallstart.
//   – missingValue är 9999 (och precipitation_frozen_part = -9 vid ingen
//     nederbörd); punkter utanför domänen → HTTP 404 "out of bounds".
//
// Allt servas via /api/forecast/* – frontend pratar aldrig med SMHI direkt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { j, jjson, now } from './http.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export const BASE = process.env.SMHI_FCST_API_BASE
  || 'https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1';
export const KEEP_CYCLES = 12; // ~12 timmars prognoshistorik
export const MISSING = 9999;

// 15 parametrar per punkt (filter för point-frågan; övriga finns i
// param.json-katalogen). Överstyrbar med SMHI_FCST_PARAMS.
export const PARAMS = (process.env.SMHI_FCST_PARAMS
  ? process.env.SMHI_FCST_PARAMS.split(',').map(s => s.trim()).filter(Boolean)
  : [
    'air_temperature',
    'wind_from_direction',
    'wind_speed',
    'wind_speed_of_gust',
    'relative_humidity',
    'air_pressure_at_mean_sea_level',
    'visibility_in_air',
    'cloud_area_fraction',
    'thunderstorm_probability',
    'probability_of_frozen_precipitation',
    'precipitation_amount_mean',
    'precipitation_amount_max',
    'precipitation_frozen_part',
    'predominant_precipitation_type_at_surface',
    'symbol_code',
  ]);

// Enheter ur param.json-katalogen (verifierad 2026-11-05).
export const PARAM_UNITS = {
  air_temperature: '°C',
  wind_from_direction: '°',
  wind_speed: 'm/s',
  wind_speed_of_gust: 'm/s',
  relative_humidity: '%',
  air_pressure_at_mean_sea_level: 'hPa',
  visibility_in_air: 'km',
  cloud_area_fraction: 'oktas',
  thunderstorm_probability: '%',
  probability_of_frozen_precipitation: '%',
  probability_of_precipitation: '%',
  precipitation_amount_mean: 'mm',
  precipitation_amount_max: 'mm',
  precipitation_frozen_part: '%',
  predominant_precipitation_type_at_surface: 'kod',
  symbol_code: 'kod',
};

// Kartvytnätsparametrar (imageOverlay i MapPanel) + downsample (1–20).
export const GRID_PARAMS = [
  'air_temperature',
  'wind_speed_of_gust',
  'precipitation_amount_mean',
  'probability_of_precipitation',
];

const clampInt = (v, dflt, lo, hi) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
export const GRID_DOWNSAMPLE = clampInt(process.env.SMHI_GRID_DOWNSAMPLE, 20, 1, 20);

// 11 följda städer (én+ per land). Reykjavik ligger utanför snow1g:s domän
// (404 "out of bounds", verifierad 2026-11-05) – hanteras som outsideDomain.
// Överstyrbar med SMHI_FCST_POINTS: "Namn=lon,lat,Namn2=lon,lat2"
// (längd först, som i API:t; överskrivna punkter får country NORDIC).
const DEFAULT_POINTS = [
  { name: 'Stockholm', lon: 18.07, lat: 59.33, country: 'SE' },
  { name: 'Göteborg', lon: 11.97, lat: 57.70, country: 'SE' },
  { name: 'Malmö', lon: 12.99, lat: 55.60, country: 'SE' },
  { name: 'Umeå', lon: 20.25, lat: 63.83, country: 'SE' },
  { name: 'Kiruna', lon: 20.22, lat: 67.86, country: 'SE' },
  { name: 'Oslo', lon: 10.75, lat: 59.91, country: 'NO' },
  { name: 'Trondheim', lon: 9.10, lat: 63.43, country: 'NO' },
  { name: 'Tromsø', lon: 18.96, lat: 69.65, country: 'NO' },
  { name: 'Helsingfors', lon: 24.94, lat: 60.17, country: 'FI' },
  { name: 'Köpenhamn', lon: 12.57, lat: 55.68, country: 'DK' },
  { name: 'Reykjavik', lon: -21.94, lat: 64.15, country: 'IS', outside: true },
];

export function parsePointsEnv(str) {
  if (!str || !str.trim()) return null;
  // Dela på komman före nästa "Namn=" – annars ruckas lon/lat isär.
  const parts = str.split(/,(?=[^,=]+=)/).map(s => s.trim()).filter(Boolean);
  const pts = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) throw new Error(`SMHI_FCST_POINTS: ogiltig post "${part}" (förväntat Namn=lon,lat)`);
    const rest = part.slice(eq + 1);
    const [lonS, latS] = rest.split(',').map(s => s.trim());
    const lon = Number(lonS);
    const lat = Number(latS);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`SMHI_FCST_POINTS: ogiltig koordinat "${rest}"`);
    }
    pts.push({ name: part.slice(0, eq), lon, lat, country: 'NORDIC' });
  }
  return pts.length ? pts : null;
}

export const POINTS = parsePointsEnv(process.env.SMHI_FCST_POINTS) ?? DEFAULT_POINTS;

// ---- Inminnesstatus --------------------------------------------------------
// pointsByCycle: createdTime -> { [namn]: { geometry, timeSeries } }
// gridTiles:     "ds|param|time" -> values (barra aktuell cykel)
export const MAX_ADHOC_POINTS = clampInt(process.env.SMHI_ADHOC_CACHE_MAX, 500, 10, 5000);
const ADHOC_RATE_LIMIT = clampInt(process.env.SMHI_ADHOC_RATE_LIMIT_PER_MIN, 20, 1, 600);
const ADHOC_RATE_WINDOW_MS = 60_000;
const adhocRequests = new Map();
const adhocInflight = new Map();

export const fc = {
  cycle: null,
  pointsByCycle: new Map(),
  outside: new Set(),
  adhoc: new Map(),
  gridCoords: new Map(),
  gridTiles: new Map(),
};

function allowAdhocRequest(clientKey) {
  const nowMs = Date.now();
  let bucket = adhocRequests.get(clientKey);
  if (!bucket || nowMs - bucket.startedAt >= ADHOC_RATE_WINDOW_MS) {
    bucket = { startedAt: nowMs, count: 0 };
    adhocRequests.set(clientKey, bucket);
  }
  // Bound the limiter bookkeeping if clients rotate addresses.
  if (adhocRequests.size > 10_000) {
    for (const [key, value] of adhocRequests) {
      if (nowMs - value.startedAt >= ADHOC_RATE_WINDOW_MS) adhocRequests.delete(key);
    }
  }
  bucket.count += 1;
  return bucket.count <= ADHOC_RATE_LIMIT;
}

export const cacheDir = () =>
  process.env.SMHI_FCST_CACHE_DIR || path.join(root, '..', 'cache', 'smhi-forecast');

const CYCLE_RE = /^\d{8}T\d{6}Z\.json$/;
export const cycleSafeName = createdTime => createdTime.replace(/[-:]/g, '');
const cycleFile = createdTime => path.join(cacheDir(), `${cycleSafeName(createdTime)}.json`);
const tileFile = (param, time, ds, createdTime) =>
  path.join(cacheDir(), `smhi-grid-${param}-${time.replace(/[-:]/g, '')}-ds${ds}-${cycleSafeName(createdTime)}.json`);
const tileCycleOf = f => f.replace(/\.json$/, '').split('-').pop();

let dirReady = null;
const ensureDir = () =>
  (dirReady ??= fs.promises.mkdir(cacheDir(), { recursive: true }));

// ---- Hämtare (SMHI) ---------------------------------------------------------

export const fetchCreatedTime = () => jjson(`${BASE}/createdtime.json`);
// times.json svarar med { time: [...] } (verifierat live 2026-11-05).
export const fetchTimes = async () => (await jjson(`${BASE}/times.json`)).time ?? [];

export function pointUrl(lon, lat, { timeseries, parameters } = {}) {
  let u = `${BASE}/geotype/point/lon/${lon}/lat/${lat}/data.json`;
  const q = [];
  if (timeseries) q.push(`timeseries=${timeseries}`);
  if (parameters?.length) q.push(`parameters=${parameters.join(',')}`);
  return q.length ? `${u}?${q.join('&')}` : u;
}

// Punkter utanför domänen ger 404 ("Requested point is out of bounds",
// dokumentationen säger 400) – returnerar { outside: true } i stället för att
// kasta felet så att en enda punkt inte fäller hela cykeln.
export async function fetchPoint(lon, lat, opt = {}) {
  let r;
  try {
    r = await j(pointUrl(lon, lat, opt));
  } catch (e) {
    if (/^HTTP 40[04]/.test(String(e.message))) return { outside: true };
    throw e;
  }
  return r.json();
}

// Statisk MultiPoint-geometri för rutnätet (modellrutnätet ändras inte mellan
// cykler) – hämtas en gång per downsample-nivå.
export const gridCoordsUrl = ds => `${BASE}/geotype/multipoint.json?downsample=${ds}`;

export async function getGridCoords(ds = GRID_DOWNSAMPLE) {
  if (fc.gridCoords.has(ds)) return fc.gridCoords.get(ds);
  const geo = await jjson(gridCoordsUrl(ds));
  const coords = geo?.coordinates ?? [];
  fc.gridCoords.set(ds, coords);
  return coords;
}

// Rutnätsvärden för en parameter + tid: tidsseri där data[parameter] är en
// array indexerad på koordinatindex i multipoint.json?downsample=ds.
// Tiden i URL:en är komprimerad (YYYYMMDDThhmmssZ; ISO ger 404, verifierat
// live 2026-11-05). Kräver GZIP-accept (undici skickar den automatiskt).
export const gridValuesUrl = (param, time, ds) =>
  `${BASE}/geotype/multipoint/time/${time.replace(/[-:]/g, '')}/parameter/${param}/data.json?with-geo=false&downsample=${ds}`;

const tileKey = (param, time, ds) => `${ds}|${param}|${time}`;

export async function getGridTile(param, time, ds = GRID_DOWNSAMPLE) {
  const k = tileKey(param, time, ds);
  if (fc.gridTiles.has(k)) return fc.gridTiles.get(k);
  // Disk-mirror (samma cykel) – återställ efter omstart och skydd om
  // SMHI släpper en cykel medan klienten redan har tiderna i handen.
  const f = tileFile(param, time, ds, fc.cycle?.createdTime ?? 'unknown');
  try {
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(t.values) && t.values.length === (await getGridCoords(ds)).length) {
      fc.gridTiles.set(k, t.values);
      return t.values;
    }
  } catch { /* saknas – hämta från källan */ }
  const r = await jjson(gridValuesUrl(param, time, ds));
  const values = r?.timeSeries?.[0]?.data?.[param] ?? r?.values ?? [];
  if (!Array.isArray(values) || !values.length) {
    throw new Error(`ogiltigt gridsvar för ${param} ${time}`);
  }
  fc.gridTiles.set(k, values);
  try {
    await ensureDir();
    fs.writeFileSync(f, JSON.stringify({
      param, time, downsample: ds, createdTime: fc.cycle?.createdTime ?? null, values,
    }));
  } catch { /* disk är auxiliary – fäll inte cykeln */ }
  return values;
}

// ---- Cykel-persistering -----------------------------------------------------

// Sparar en ny cykel (fil), uppdaterar minnet och raderar dolda cachar som
// hör till den äldre cykeln (adhoc-punkter + griddatavärden).
export async function ingestCycle(createdTime, referenceTime, times, pointData) {
  await ensureDir();
  fs.writeFileSync(cycleFile(createdTime), JSON.stringify({
    createdTime, referenceTime, times, points: pointData, savedAt: now(),
  }));
  fc.cycle = { createdTime, referenceTime, times };
  fc.pointsByCycle.set(createdTime, pointData);
  fc.adhoc.clear();
  fc.gridTiles.clear();
  pruneCycles();
  return fc.cycle;
}

// Behåll de KEEP_CYCLES senaste cykelfilerna (och gridskivor som hör till dem).
export function pruneCycles() {
  let entries;
  try {
    entries = fs.readdirSync(cacheDir());
  } catch {
    return; // ingen cache än – inget att radera
  }
  const cycles = entries.filter(f => CYCLE_RE.test(f)).sort().reverse(); // nyast först
  const keep = new Set(cycles.slice(0, KEEP_CYCLES).map(f => f.replace(/\.json$/, '')));
  for (const f of entries) {
    const isCycle = CYCLE_RE.test(f);
    const isTile = f.startsWith('smhi-grid-') && f.endsWith('.json');
    if (!isCycle && !isTile) continue;
    const created = isCycle ? f.replace(/\.json$/, '') : tileCycleOf(f);
    if (!keep.has(created)) {
      try { fs.rmSync(path.join(cacheDir(), f), { force: true }); } catch { /* tyst */ }
    }
  }
}

// Vid start (innan kollektorns första tick): ladda senaste sparade cykeln så
// att /api/forecast/* kan svara direkt.
export function loadLatestFromDisk() {
  if (fc.cycle) return fc.cycle;
  try {
    const files = fs.readdirSync(cacheDir()).filter(f => CYCLE_RE.test(f)).sort();
    const last = files.at(-1);
    if (!last) return null;
    const d = JSON.parse(fs.readFileSync(path.join(cacheDir(), last), 'utf8'));
    if (!d?.createdTime || !Array.isArray(d.times) || !d.times.length) return null;
    fc.cycle = { createdTime: d.createdTime, referenceTime: d.referenceTime, times: d.times };
    fc.pointsByCycle.set(d.createdTime, d.points ?? {});
    return fc.cycle;
  } catch {
    return null;
  }
}

// Fritvald plats (klick på kartan) – hämtas on-demand per cykel.
export async function getAdhocPoint(lon, lat) {
  const key = `${lat.toFixed(3)}|${lon.toFixed(3)}`;
  if (fc.adhoc.has(key)) {
    const hit = fc.adhoc.get(key);
    fc.adhoc.delete(key);
    fc.adhoc.set(key, hit); // LRU: recently used points move to the end.
    return hit;
  }
  if (adhocInflight.has(key)) return adhocInflight.get(key);
  const request = (async () => {
    const p = await fetchPoint(lon, lat, { parameters: PARAMS });
    if (p?.outside) return { outside: true };
    const value = { geometry: p.geometry ?? null, timeSeries: p.timeSeries ?? [] };
    fc.adhoc.set(key, value);
    while (fc.adhoc.size > MAX_ADHOC_POINTS) {
      fc.adhoc.delete(fc.adhoc.keys().next().value);
    }
    return value;
  })().finally(() => adhocInflight.delete(key));
  adhocInflight.set(key, request);
  return request;
}

// Första tidssteg som är nu eller senare (prognoserna börjar nu).
export function nowIndex(times, at = new Date()) {
  const t = at.getTime();
  for (let i = 0; i < times.length; i += 1) {
    if (new Date(times[i]).getTime() >= t) return i;
  }
  return times.length - 1;
}

// ---- API-handlingar (anropas av app.js via /api/forecast/*) -----------------

function pointsList() {
  const cyclePts = fc.cycle ? (fc.pointsByCycle.get(fc.cycle.createdTime) ?? {}) : {};
  return POINTS.map(p => ({
    name: p.name,
    lon: p.lon,
    lat: p.lat,
    country: p.country,
    outsideDomain: fc.outside.has(p.name) || (p.outside === true && !cyclePts[p.name]),
  }));
}

export function apiForecastMeta(u) {
  loadLatestFromDisk();
  if (!fc.cycle) {
    return { status: 200, body: { ready: false, points: pointsList(), grid: { downsample: GRID_DOWNSAMPLE, parameters: GRID_PARAMS } } };
  }
  return {
    status: 200,
    body: {
      ready: true,
      createdTime: fc.cycle.createdTime,
      referenceTime: fc.cycle.referenceTime,
      times: fc.cycle.times,
      points: pointsList(),
      outside: [...fc.outside],
      grid: { downsample: GRID_DOWNSAMPLE, parameters: GRID_PARAMS },
    },
  };
}

export async function apiForecastPoint(u, clientKey = 'unknown-client') {
  loadLatestFromDisk();
  if (!fc.cycle) return { status: 503, body: { error: 'Prognoscykeln är inte klar ännu' } };
  const name = u.searchParams.get('point');
  const lat = u.searchParams.get('lat');
  const lon = u.searchParams.get('lon');
  let pt;
  if (name) {
    pt = POINTS.find(p => p.name === name);
  } else if (lat !== null && lon !== null) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return { status: 400, body: { error: 'Koordinater måste vara numeriska och inom lat -90..90, lon -180..180' } };
    }
    if (!allowAdhocRequest(clientKey)) {
      return { status: 429, body: { error: 'För många anpassade prognosförfrågningar', retryAfterSeconds: 60 } };
    }
    pt = { name: `Anpassad plats (${lat}, ${lon})`, lon: longitude, lat: latitude, country: 'NORDIC' };
  }
  if (!pt || !Number.isFinite(pt.lon) || !Number.isFinite(pt.lat)) {
    return { status: 400, body: { error: 'Ange point=<namn> eller lat= och lon=' } };
  }
  const cyclePts = fc.pointsByCycle.get(fc.cycle.createdTime) ?? {};
  const pd = cyclePts[pt.name]
    ?? await getAdhocPoint(pt.lon, pt.lat);
  if (pd?.outside || !pd?.timeSeries?.length) {
    return { status: 404, body: { error: 'Platsen ligger utanför SMHI:s prognosområde (snow1g)' } };
  }
  return {
    status: 200,
    body: {
      point: { name: pt.name, lon: pt.lon, lat: pt.lat, country: pt.country },
      createdTime: fc.cycle.createdTime,
      referenceTime: fc.cycle.referenceTime,
      times: fc.cycle.times,
      timeSeries: pd.timeSeries,
      geometry: pd.geometry ?? null,
    },
  };
}

export async function apiForecastGrid(u) {
  loadLatestFromDisk();
  const time = u.searchParams.get('time');
  const parameter = u.searchParams.get('parameter');
  const ds = clampInt(u.searchParams.get('downsample'), GRID_DOWNSAMPLE, 1, 20);
  if (!fc.cycle) return { status: 503, body: { error: 'Prognoscykeln är inte klar ännu' } };
  if (!GRID_PARAMS.includes(parameter)) {
    return { status: 400, body: { error: `parameter måste vara en av: ${GRID_PARAMS.join(', ')}` } };
  }
  if (!time || !fc.cycle.times.includes(time)) {
    return { status: 400, body: { error: 'time saknas eller hör inte till aktuell cykel' } };
  }
  try {
    const values = await getGridTile(parameter, time, ds);
    return {
      status: 200,
      body: {
        parameter, time, createdTime: fc.cycle.createdTime, downsample: ds,
        count: values.length, values,
      },
    };
  } catch (e) {
    return { status: 502, body: { error: `Kunde inte hämta rutnätet: ${e.message}` } };
  }
}

export async function apiForecastGridCoords(u) {
  const ds = clampInt(u.searchParams.get('downsample'), GRID_DOWNSAMPLE, 1, 20);
  try {
    const coordinates = await getGridCoords(ds);
    return { status: 200, body: { downsample: ds, count: coordinates.length, coordinates } };
  } catch (e) {
    return { status: 502, body: { error: `Kunde inte hämta rutnätets koordinater: ${e.message}` } };
  }
}
