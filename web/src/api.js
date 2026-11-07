// Frontend talks only to the Northwatch backend; source credentials never reach the browser.
async function get(p) { const r = await fetch(p, { headers:{ Accept:'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
export const fetchSummary = () => get('/api/summary');
export const fetchDashboards = () => get('/api/dashboards');
export const fetchDashboard = (id, country='ALL') => get(`/api/dashboard/${id}?country=${encodeURIComponent(country)}`);
export const fetchHealth = () => get('/api/health');
export const fetchAssets = (area, country='ALL') => get(`/api/assets?area=${encodeURIComponent(area)}&country=${encodeURIComponent(country)}`);
export const fetchEnergyOverview = (country='ALL') => get(`/api/energy/overview?country=${encodeURIComponent(country)}`);
let staticGeoPromise = null;
export const fetchStaticGeo = () => (staticGeoPromise ??= get('/api/geo/static').catch(e => { staticGeoPromise=null; throw e; }));
async function getRaw(p) { const r=await fetch(p,{headers:{Accept:'application/json'}}); let body=null; try { body=await r.json(); } catch {} return {status:r.status,ok:r.ok,body}; }
export const fetchForecastMeta = () => getRaw('/api/forecast/meta');
export const fetchForecastPoint = ({name,lat,lon}={}) => getRaw('/api/forecast/point?' + (name ? 'point='+encodeURIComponent(name) : 'lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon)));
export const fetchForecastGrid = (parameter,time,downsample) => getRaw(`/api/forecast/grid?parameter=${parameter}&time=${encodeURIComponent(time)}&downsample=${downsample ?? ''}`);
export const fetchForecastGridCoords = downsample => getRaw(`/api/forecast/grid-coords?downsample=${downsample ?? ''}`);
export const fetchCyberNvd = ({window:win=7,severity='',q='',sort='newest',limit=50}={}) => { const p=new URLSearchParams(); p.set('window',win); if(severity)p.set('severity',severity); if(q)p.set('q',q); p.set('sort',sort); p.set('limit',limit); return getRaw('/api/cyber/nvd?'+p); };
export const fetchCyberKev = ({q='',ransomware=false,sort='added',limit=100}={}) => { const p=new URLSearchParams(); if(q)p.set('q',q); if(ransomware)p.set('ransomware','1'); p.set('sort',sort); p.set('limit',limit); return getRaw('/api/cyber/kev?'+p); };
export const fetchCyberOsv = ({ecosystem=''}={}) => getRaw('/api/cyber/osv?ecosystem='+encodeURIComponent(ecosystem));
export const fetchCyberPrioritized = () => getRaw('/api/cyber/prioritized');
export const fetchCyberOverview = () => getRaw('/api/cyber/overview');
