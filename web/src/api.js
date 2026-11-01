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
