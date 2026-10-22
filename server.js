// Nordic infrastructure dashboard – collector + proxy. Inga beroenden (Node >= 20.6).
// Varje collector returnerar normaliserade poster: {area,country,indicator,value,unit,ts,source}
// Endpoints markerade VERIFIERA är inte testade (se Excel: Endpoint-verifiering).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const E = process.env, UA = E.CONTACT || 'NordicInfrastructureDashboard/0.1 (contact: unset)';
const j = async (url, opt = {}) => {
  const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, ...opt.headers }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r;
};
const now = () => new Date().toISOString();

const sources = [
 { id:'fingrid', area:1, country:'FI', every:180, need:'FINGRID_KEY', run: async () => {
   const out = [];
   for (const d of (E.FINGRID_DATASETS||'').split(',').filter(Boolean)) {
     const [id, name] = d.split(':'); // max 1 anrop / 2 s, 10 000 / dygn
     const r = await (await j(`https://data.fingrid.fi/api/datasets/${id}/data/latest`, { headers:{'x-api-key':E.FINGRID_KEY} })).json(); // VERIFIERA path
     out.push({ area:1, country:'FI', indicator:name.trim(), value:r.value, unit:'MW', ts:r.startTime||now(), source:'Fingrid' });
     await new Promise(s => setTimeout(s, 2100));
   } return out; } },
 { id:'svk', area:1, country:'SE', every:300, need:'SVK_RESOURCE_ID', run: async () => {
   const r = await (await j('https://data.svk.se/sv/api/action/datastore_search', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({resource_id:E.SVK_RESOURCE_ID, limit:1}) })).json();
   return [{ area:1, country:'SE', indicator:'SVK-dataset, antal poster', value:r.result?.total, unit:'st', ts:now(), source:'Svenska kraftnät' }]; } },
 // TODO ENTSO-E: GET https://web-api.tp.entsoe.eu/api?securityToken=..&documentType=A65&processType=A16&outBiddingZone_Domain=10YSE-1--------K&periodStart=yyyyMMddHHmm&periodEnd=..  (XML – lägg till en XML-parser)
 { id:'trafikverket', area:3, country:'SE', every:120, need:'TRAFIKVERKET_KEY', run: async () => {
   const body = `<REQUEST><LOGIN authenticationkey="${E.TRAFIKVERKET_KEY}"/><QUERY objecttype="Situation" schemaversion="1.5" limit="500"><FILTER/><INCLUDE>Id</INCLUDE></QUERY></REQUEST>`; // VERIFIERA schemaversion
   const r = await (await j('https://api.trafikinfo.trafikverket.se/v2/data.json', { method:'POST', headers:{'Content-Type':'text/xml'}, body })).json();
   return [{ area:3, country:'SE', indicator:'Aktiva trafikhändelser', value:r.RESPONSE.RESULT[0].Situation?.length ?? 0, unit:'st', ts:now(), source:'Trafikverket' }]; } },
 { id:'digitraffic', area:3, country:'FI', every:120, run: async () => {
   const r = await (await j('https://tie.digitraffic.fi/api/traffic-message/v1/traffic-messages?inactiveHours=0&includeAreaGeometry=false', { headers:{'Digitraffic-User':UA} })).json(); // VERIFIERA path i swagger
   return [{ area:3, country:'FI', indicator:'Aktiva trafikmeddelanden', value:r.features?.length ?? 0, unit:'st', ts:now(), source:'Digitraffic' }]; } },
 { id:'cisa-kev', area:5, country:'NORDIC', every:21600, run: async () => {
   const r = await (await j('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json')).json();
   const last = [...r.vulnerabilities].sort((a,b)=>b.dateAdded.localeCompare(a.dateAdded))[0];
   return [{ area:5, country:'NORDIC', indicator:'KEV – antal', value:r.count, unit:'CVE', ts:r.dateReleased, source:'CISA' },
           { area:5, country:'NORDIC', indicator:'KEV – senast tillagd', value:`${last.cveID} (${last.vendorProject})`, unit:'', ts:last.dateAdded, source:'CISA' }]; } },
 { id:'nvd', area:5, country:'NORDIC', every:3600, run: async () => {
   const r = await (await j('https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1', { headers: E.NVD_KEY ? {apiKey:E.NVD_KEY} : {} })).json();
   return [{ area:5, country:'NORDIC', indicator:'NVD – CVE totalt', value:r.totalResults, unit:'CVE', ts:now(), source:'NIST NVD' }]; } },
 { id:'met-no', area:11, country:'NO', every:1800, run: async () => {
   const r = await (await j('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=59.91&lon=10.75')).json();
   const d = r.properties.timeseries[0]; const i = d.data.instant.details;
   return [{ area:11, country:'NO', indicator:'Oslo temperatur', value:i.air_temperature, unit:'°C', ts:d.time, source:'MET Norway' },
           { area:11, country:'NO', indicator:'Oslo vind', value:i.wind_speed, unit:'m/s', ts:d.time, source:'MET Norway' }]; } },
 { id:'smhi', area:11, country:'SE', every:1800, run: async () => { // enbart tillgänglighetstest; välj konkret produkt (obs/varningar) härnäst
   const r = await (await j('https://opendata-download-metobs.smhi.se/api/version/1.0/parameter.json')).json();
   return [{ area:11, country:'SE', indicator:'SMHI observationsparametrar', value:r.resource?.length ?? 0, unit:'st', ts:now(), source:'SMHI' }]; } },
];

const state = { items:{}, health:{} };
async function poll(s) {
  const h = state.health[s.id] ??= { id:s.id, area:s.area, every:s.every };
  if (s.need && !E[s.need]) { Object.assign(h, { status:'no_key', error:`Saknar ${s.need}` }); return; }
  const t = Date.now();
  try { state.items[s.id] = await s.run(); Object.assign(h, { status:'ok', lastOk:now(), ms:Date.now()-t, error:null }); }
  catch (e) { Object.assign(h, { status:'error', error:String(e.message), lastError:now() }); }
}
for (const s of sources) { poll(s); setInterval(() => poll(s), s.every*1000); }

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css' };
http.createServer((q, res) => {
  if (q.url === '/api/state') { res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ generatedAt:now(), items:Object.values(state.items).flat(), health:Object.values(state.health) })); }
  const f = path.join('public', q.url === '/' ? 'index.html' : path.normalize(q.url).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(f, (err, d) => err ? (res.writeHead(404), res.end('Not found')) : (res.writeHead(200, {'Content-Type':types[path.extname(f)]||'text/plain'}), res.end(d)));
}).listen(E.PORT || 3000, () => console.log('http://localhost:' + (E.PORT || 3000)));
