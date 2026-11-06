// Endast anrop mot backend /api/* – frontend pratar aldrig med externa
// källor och ser aldrig nyckler/tokens.
async function get(p) {
  const r = await fetch(p, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export const fetchSummary = () => get('/api/summary');
export const fetchDashboards = () => get('/api/dashboards');
export const fetchDashboard = (id, country = 'ALL') =>
  get(`/api/dashboard/${id}?country=${encodeURIComponent(country)}`);
export const fetchHealth = () => get('/api/health');
export const fetchAssets = (area, country = 'ALL') =>
  get(`/api/assets?area=${encodeURIComponent(area)}&country=${encodeURIComponent(country)}`);

// M3: statiska kartlager (landsgränser + energilager) – hämtas en gång.
let staticGeoPromise = null;
export const fetchStaticGeo = () =>
  (staticGeoPromise ??= get('/api/geo/static').catch(e => {
    staticGeoPromise = null; // tillåt retry
    throw e;
  }));

// M8: SMHI väderprognos (snow1g). getRaw behåller statuskod – punkt-frågan
// kan svara 404 (utanför domänen) eller 503 (cykeln ej klar). Panelen
// ska visa det som ett tillstånd, inte ett stacktrace.
async function getRaw(p) {
  const r = await fetch(p, { headers: { Accept: 'application/json' } });
  let body = null;
  try { body = await r.json(); } catch { /* icke-JSON */ }
  return { status: r.status, ok: r.ok, body };
}

export const fetchForecastMeta = () => getRaw('/api/forecast/meta');
export const fetchForecastPoint = ({ name, lat, lon } = {}) => {
  const q = name
    ? `point=${encodeURIComponent(name)}`
    : `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  return getRaw(`/api/forecast/point?${q}`);
};
export const fetchForecastGrid = (parameter, time, downsample) =>
  getRaw(`/api/forecast/grid?parameter=${parameter}&time=${encodeURIComponent(time)}&downsample=${downsample ?? ''}`);
export const fetchForecastGridCoords = downsample =>
  getRaw(`/api/forecast/grid-coords?downsample=${downsample ?? ''}`);
