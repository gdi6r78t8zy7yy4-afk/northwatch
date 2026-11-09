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
export const fetchEnergyOverview = (country = 'ALL') =>
  get(`/api/energy/overview?country=${encodeURIComponent(country)}`);
export const fetchEnergyHistory = (country = 'ALL', range = '24h') =>
  get(`/api/energy/history?country=${encodeURIComponent(country)}&range=${encodeURIComponent(range)}`);
export const fetchEnergyAnalysis = (country = 'ALL') =>
  get(`/api/energy/analysis?country=${encodeURIComponent(country)}`);

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

// M9: cyber (område 5) – NVD/KEV/OSV via backend /api/cyber/* (backenden
// pratar med källorna, TTL-cachad). getRaw behåller statuskod: 502 betyder
// att källhämtningen misslyckades, 200 + body.error att gamlat data servas.
export const fetchCyberNvd = ({ window: win = 7, severity = '', q = '', sort = 'newest', limit = 50 } = {}) => {
  const p = new URLSearchParams();
  p.set('window', win);
  if (severity) p.set('severity', severity);
  if (q) p.set('q', q);
  p.set('sort', sort);
  p.set('limit', limit);
  return getRaw(`/api/cyber/nvd?${p}`);
};
export const fetchCyberKev = ({ q = '', ransomware = false, sort = 'added', limit = 100 } = {}) => {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (ransomware) p.set('ransomware', '1');
  p.set('sort', sort);
  p.set('limit', limit);
  return getRaw(`/api/cyber/kev?${p}`);
};
export const fetchCyberOsv = ({ ecosystem = '' } = {}) =>
  getRaw(`/api/cyber/osv?ecosystem=${encodeURIComponent(ecosystem)}`);
export const fetchCyberPrioritized = () => getRaw('/api/cyber/prioritized');
export const fetchCyberOverview = () => getRaw('/api/cyber/overview');

// M10: industri (område 7) – beräknad status + underliggande records per
// källa, via backend /api/industry/*. getRaw behåller statuskod (502 om
// inga records alls). country = SE/NO/DK/FI/IS för landsvy, NORDIC (eller
// ALL) för den nordiska sammanfattningen.
export const fetchIndustryStatus = (country = 'NORDIC') =>
  getRaw(`/api/industry/status?country=${encodeURIComponent(country)}`);
export const fetchIndustryData = (country = 'NORDIC') =>
  getRaw(`/api/industry/data?country=${encodeURIComponent(country)}`);

// M11: offentlig förvaltning (område 12) – Förvaltningsindex + underliggande
// records, via backend /api/forvaltning/*. Samma modell som /api/industry/*:
// country = SE/NO/DK/FI/IS för landsvy, NORDIC (eller ALL) för sammanfattning.
export const fetchForvaltningStatus = (country = 'NORDIC') =>
  getRaw(`/api/forvaltning/status?country=${encodeURIComponent(country)}`);
export const fetchForvaltningData = (country = 'NORDIC') =>
  getRaw(`/api/forvaltning/data?country=${encodeURIComponent(country)}`);

// M12: GNSS/rymd (område 10) – GNSS-index + underliggande records per källa,
// via backend /api/gnss/*. Samma modell som /api/industry/* och
// /api/forvaltning/*: country = SE/NO/DK/FI/IS för landsvy, NORDIC (eller ALL)
// för sammanfattningen. /correlation är async (valfri LLM-berikelse i
// backenden) och pollas av sin egen panel.
export const fetchGnssStatus = (country = 'NORDIC') =>
  getRaw(`/api/gnss/status?country=${encodeURIComponent(country)}`);
export const fetchGnssData = (country = 'NORDIC') =>
  getRaw(`/api/gnss/data?country=${encodeURIComponent(country)}`);
export const fetchGnssCorrelation = () => getRaw('/api/gnss/correlation');
