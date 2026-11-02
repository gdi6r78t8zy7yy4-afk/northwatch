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
