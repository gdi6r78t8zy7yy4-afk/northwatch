// Trafikverket öppna dataplattform (datacache) – väg, järnväg, färja,
// vägväder och trafikflöden. API:t verifierat live 2026-11-02 (M5).
//
//   POST https://api.trafikinfo.trafikverket.se/v2/data.json
//   Headers: Content-Type: text/xml + Referer (portaldomän)
//   Body:    <REQUEST><LOGIN authenticationkey='NYCKEL'/>
//              <QUERY objecttype='X' namespace='Y' schemaversion='SV'
//                     [limit='N'] [orderby='F'] [lastmodified='true']
//                     [sseurl='true']><FILTER>…</FILTER><INCLUDE>fält</INCLUDE>
//            </QUERY></REQUEST>
//
// Autentisering sker via LOGIN-elementet i bodyn, inte HTTP-header.
// Frågespråk: operatorelement (EQ/GT/GTE/LT/IN, IN med kommaseparerad lista)
// med AND/OR-nästning; tidsuttrycken $now och $dateadd(±HH:MM:SS) stöds.
// INCLUDE beskär svarsfält (punktstigar funkar). Svar: RESPONSE.RESULT[0]
// med typens namn som array (eller enstaka objekt) + valfri INFO
// (SSEURL/LASTMODIFIED). HTTP 200/206; tomt resultat = tom array.
// Rate-limit 100 req/s. Attributkatalog: data.trafikverket.se/apb/prod/intellisense.
//
// Objekttyper (schemaversioner verifierade mot intellisense):
//   Situation          Road.TrafficInfo  1.6  väghändelser (Deviation)
//   RoadCondition      Road.TrafficInfo  1.3  väglag per sträcka
//   TrafficFlow        Road.TrafficInfo  1.5  flödesmätning: fordon/h + snittfart
//   TrainAnnouncement  Rail.TrafficInfo  2.0  avgångar/ankomster valda stationer
//   WeatherObservation Road.WeatherInfo  2.1  vägväder (vägtemp/is/snö)
//   TrainStation       rail.infrastructure 1.0 stationer + WGS84-geometri
//   FerryAnnouncement  Ferry.TrafficInfo 1.2  färjeavgångar påverkade av avvikelser
//
// Strategi: Situation och RoadCondition hålls i ett minneslager (Map per Id).
// Start + var 30:e min fullast (~3 300 respektive ~800 rader); däremellan
// inkrementell ModifiedTime-fönsterpolling (endast färre än 10 rader/min).
// API:ets egen lastmodified/changeid-mekanism ger inga användbara delta
// (vattenståndet är det äldsta ModifiedTime, changeid avslås 400) – vi
// förvaltar vattenståndet själva. TrafficFlow/TrainAnnouncement/Weather/Ferry
// är fönsterfrågor per tick; TrainStation laddas en gång per dygn.
//
// SSE (valfritt, TRAFIKVERKET_SSE=1): POST med sseurl='true' ger INFO.SSEURL;
// GET på den URL:en strömmar text/event-stream (CRLF-ramad: id:/data: per
// förändring). Första delarna är en full replay (ignorerar limit, ~12 MB/50 s).
// Vid tystnad >5 min faller vi tillbaka på ModifiedTime-polling.
//
// Stationssignaturer (LocationSignature) verifierade 2026-11-02:
// Stockholm C=Cst, Göteborg C=G, Malmö C=Mc, Uppsala C=U, Lund C=Lu,
// Örebro C=Ör, Västerås C=Vå. OBS: 'Stl' är Ställdalen, inte Stockholm.
import { now, UA } from '../lib/http.js';

const API_URL = process.env.TRAFIKVERKET_API_URL
  || 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const REFERER = process.env.TRAFIKVERKET_REFERER || 'https://northwatch.local/';
const USE_SSE = process.env.TRAFIKVERKET_SSE === '1';
const FULL_REFRESH_MS = 30 * 60000;   // fullast situation/väglag
const SSE_SILENCE_MS = 5 * 60000;     // fall tillbaka på polling efter tystnad
const STATIONS_D = 24 * 3600 * 1000;  // stationslista per dygn
const FERRY_D = 5 * 60000;            // färjefönstret (stort) sällan

const stations = () => (process.env.TRAFIKVERKET_STATIONS || 'Cst,G,Mc,U,Lu,Ör,Vå')
  .split(',').map(s => s.trim()).filter(Boolean);

// ---- XML ---------------------------------------------------------------

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;');

function requestXml(spec) {
  const attrs = [`objecttype='${esc(spec.type)}'`];
  if (spec.ns) attrs.push(`namespace='${esc(spec.ns)}'`);
  if (spec.sv) attrs.push(`schemaversion='${esc(spec.sv)}'`);
  if (spec.limit) attrs.push(`limit='${spec.limit}'`);
  if (spec.orderby) attrs.push(`orderby='${esc(spec.orderby)}'`);
  if (spec.lastmod) attrs.push(`lastmodified='true'`);
  if (spec.sse) attrs.push(`sseurl='true'`);
  const inc = (spec.include ?? []).map(f => `<INCLUDE>${f}</INCLUDE>`).join('');
  return `<REQUEST><LOGIN authenticationkey='${esc(process.env.TRAFIKVERKET_KEY)}'/>`
    + `<QUERY ${attrs.join(' ')}>${spec.filter ?? '<FILTER/>'}${inc}</QUERY></REQUEST>`;
}

async function postXml(xml, { tag, timeout = 45000 } = {}) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', Referer: REFERER, 'User-Agent': UA() },
    body: xml,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${new URL(API_URL).host} (${tag}): ${text.slice(0, 150).replace(/\s+/g, ' ')}`);
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`JSON-parsfel ${tag}: ${text.slice(0, 120)}`); }
  const r0 = j?.RESPONSE?.RESULT?.[0] ?? {};
  const rows = extractRows(r0, xml);
  return { rows, info: r0.INFO ?? null, bytes: text.length };
}

// RESULT[0] bär typens array under ett typspecifikt nyckelnamn (plus ev. INFO).
// Enstaka rad kommer som objekt, tomt som [].
function extractRows(r0, xml) {
  const m = xml.match(/objecttype='([^']+)'/);
  const v = m ? r0[m[1]] : undefined;
  if (v != null) return Array.isArray(v) ? v : [v];
  for (const [k, val] of Object.entries(r0)) {
    if (k === 'INFO' || k.startsWith('xmlns') || k.startsWith('@')) continue;
    return Array.isArray(val) ? val : [val];
  }
  return [];
}

// WKT (Geometry.WGS84) → GeoJSON. Bara WGS84-stringen används;
// SWEREF99TM finns med i rådatat men är ej användbar på kartan.
function wktGeo(wkt) {
  if (typeof wkt !== 'string' || !wkt) return null;
  const m = wkt.trim().match(/^(POINT|LINESTRING|POLYGON)\s*\((.*)\)$/i);
  if (!m) return null;
  const pts = m[2].split(',')
    .map(p => p.trim().replace(/^\(|\)$/g, '').split(/\s+/).map(Number));
  if (!pts.length || !pts.every(p => p.length === 2 && p.every(Number.isFinite))) return null;
  if (m[1].toUpperCase() === 'POINT') return { type: 'Point', coordinates: pts[0] };
  if (m[1].toUpperCase() === 'LINESTRING') return { type: 'LineString', coordinates: pts };
  return { type: 'Polygon', coordinates: [pts] };
}

// Länskoder enligt API:ets egen CountyNo-numrering (EJ SCB:s länskoder).
// Härledda empiriskt 2026-11-02 mot kända stationer (Göteborg C=14, Malmö
// C=12, Stockholm C=[1,2], Hudiksvall=21, Vaxholm-klass=4 Södermanland m.fl.)
// samt TrafficFlow-geografi (kod 1 → Stockholmsbbox, 14 → Göteborgsbbox).
// Kod 9 = Bohuslänska industrihalter med felaktig geografi i API:t – ej
// mappad. Kod 100 = danska gränsstationer (Malmö–Helsingör).
const COUNTY = {
  1: 'Stockholm', 2: 'Stockholm', 3: 'Uppsala', 4: 'Södermanland',
  5: 'Östergötland', 6: 'Jönköping', 7: 'Kronoberg', 8: 'Kalmar',
  10: 'Blekinge', 12: 'Skåne', 13: 'Halland', 14: 'Västra Götaland',
  17: 'Värmland', 18: 'Örebro', 19: 'Västmanland', 20: 'Dalarna',
  21: 'Gävleborg', 22: 'Västernorrland', 23: 'Jämtland',
  24: 'Västerbotten', 25: 'Norrbotten', 100: 'Danmark (gräns)',
};
// Dubblett-namn undviks (Stockholm C bär koder [1,2], båda Stockholm).
const countyName = c => {
  const names = (Array.isArray(c) ? c : [c]).filter(Boolean)
    .map(x => COUNTY[x] ?? `län ${x}`);
  return [...new Set(names)].join(', ');
};

// Allvarlighetsgrad per händelsetyp (MessageCodeValue) + svensk etikett.
const CODE_SEV = {
  accident: 'high', accidentInvolvingHeavyLorries: 'high', majorEvent: 'high',
  roadClosed: 'high', obstructionOnTheRoad: 'high', objectOnTheRoad: 'high',
  brokenDownVehicle: 'high', animalsOnTheRoad: 'high', peopleOnRoadway: 'high',
  hazardsOnTheRoad: 'high', notWorking: 'high',
  severeFrostDamagedRoadway: 'warn', roadSurfaceInPoorCondition: 'warn',
  followDiversionSigns: 'warn', blastingWork: 'warn', trafficSignals: 'warn',
  weightRestrictionInOperation: 'warn',
  laneClosures: 'medium', speedRestrictionInOperation: 'medium',
};
const SEV_RANK = { info: 0, medium: 1, warn: 2, high: 3 };
const CODE_LABEL = {
  accident: 'Olycka', accidentInvolvingHeavyLorries: 'Olycka med tungt fordon',
  majorEvent: 'Större händelse', roadClosed: 'Vägen stängd',
  obstructionOnTheRoad: 'Hinder på vägen', objectOnTheRoad: 'Föremål på vägen',
  brokenDownVehicle: 'Påverkat fordon', animalsOnTheRoad: 'Djur på vägen',
  peopleOnRoadway: 'Personer på vägbana', hazardsOnTheRoad: 'Fara på vägen',
  notWorking: 'Trafikledet stängt', severeFrostDamagedRoadway: 'Sevfrostskadad väg',
  roadSurfaceInPoorCondition: 'Vägyta i dåligt skick', followDiversionSigns: 'Följ omledningsskyltning',
  blastingWork: 'Sprängningsarbete', trafficSignals: 'Ljusstyrd trafik',
  weightRestrictionInOperation: 'Begränsning tunga fordon', laneClosures: 'Körfilsstängning',
  speedRestrictionInOperation: 'Hastighetsbegränsning', roadworks: 'Vägarbete',
  resurfacingWork: 'Vägytebyte', ferry: 'Färjeinformation', noOvertaking: 'Ingen omkörning',
};

// ---- Minneslager -------------------------------------------------------

const S = {
  situation: new Map(),   // Id -> Situation-rad (inkl. Deviation[])
  road: new Map(),        // Id -> RoadCondition-rad
  flowSites: [],          // senaste mätningen per SiteId (20-min-fönstret)
  trains: [],             // ankomster/avgångar nästa 2 h, valda stationer
  weather: [],            // observationer <15 min
  stations: [],           // alla stationer (prunat), per dygn
  stationNames: new Map(), // LocationSignature -> visningsnamn
  ferry: [],              // avgångar påverkade av avvikelser, -6 h … +12 h
  initialized: false,
  lastFull: { situation: 0, road: 0 },
  lastFetch: {},
  sse: { active: false, ctrl: null, lastEvent: 0, lastAttempt: 0 },
};

// ---- Frågor ------------------------------------------------------------

async function qSituationFull() {
  const { rows } = await postXml(
    requestXml({ type: 'Situation', ns: 'Road.TrafficInfo', sv: '1.6', limit: 4000 }),
    { tag: 'situation-full', timeout: 60000 });
  const m = new Map();
  for (const r of rows) if (r.Id && !r.Deleted) m.set(r.Id, r);
  S.situation = m;
  S.lastFull.situation = Date.now();
}

// Fönsterpolling: rader med ModifiedTime senare än för 15 min sedan.
// Returnerar true om limita träffades (⇒ fullast behövs i stället).
async function qSituationDelta() {
  const { rows } = await postXml(
    requestXml({
      type: 'Situation', ns: 'Road.TrafficInfo', sv: '1.6', limit: 1000,
      filter: `<FILTER><GT name='ModifiedTime' value='$dateadd(-00:15:00)' /></FILTER>`,
    }), { tag: 'situation-delta' });
  for (const r of rows) {
    if (!r.Id) continue;
    if (r.Deleted) S.situation.delete(r.Id); else S.situation.set(r.Id, r);
  }
  return rows.length >= 1000;
}

const ROAD_INC = ['Id', 'Deleted', 'ModifiedTime', 'ConditionCode', 'ConditionText',
  'ConditionInfo', 'Cause', 'RoadNumber', 'CountyNo', 'StartTime', 'Warning',
  'Measure', 'LocationText', 'Geometry.WGS84'];

async function qRoadFull() {
  const { rows } = await postXml(
    requestXml({ type: 'RoadCondition', ns: 'Road.TrafficInfo', sv: '1.3', limit: 6000, include: ROAD_INC }),
    { tag: 'roadcondition-full', timeout: 60000 });
  const m = new Map();
  for (const r of rows) if (r.Id && !r.Deleted) m.set(r.Id, r);
  S.road = m;
  S.lastFull.road = Date.now();
}

async function qRoadDelta() {
  const { rows } = await postXml(
    requestXml({
      type: 'RoadCondition', ns: 'Road.TrafficInfo', sv: '1.3', limit: 1000, include: ROAD_INC,
      filter: `<FILTER><GT name='ModifiedTime' value='$dateadd(-00:15:00)' /></FILTER>`,
    }), { tag: 'roadcondition-delta' });
  for (const r of rows) {
    if (!r.Id) continue;
    if (r.Deleted) S.road.delete(r.Id); else S.road.set(r.Id, r);
  }
  return rows.length >= 1000;
}

// Senaste 20 minuters mätningar; per mätare behålls den senaste raden.
async function qFlow() {
  const { rows } = await postXml(
    requestXml({
      type: 'TrafficFlow', ns: 'Road.TrafficInfo', sv: '1.5', limit: 5000,
      orderby: 'MeasurementTime',
      filter: `<FILTER><GT name='MeasurementTime' value='$dateadd(-00:20:00)' /></FILTER>`,
    }), { tag: 'trafficflow' });
  const latest = new Map();
  for (const r of rows) {
    if (r.Deleted || r.SiteId == null) continue;
    const prev = latest.get(r.SiteId);
    const t = (x) => (x ? Date.parse(x) : 0);
    if (!prev || t(r.MeasurementTime) >= t(prev.MeasurementTime)) latest.set(r.SiteId, r);
  }
  S.flowSites = [...latest.values()];
}

async function qTrains() {
  const sigs = stations();
  const { rows } = await postXml(
    requestXml({
      type: 'TrainAnnouncement', ns: 'Rail.TrafficInfo', sv: '2.0', limit: 500,
      orderby: 'AdvertisedTimeAtLocation',
      filter: `<FILTER><AND>`
        + `<GT name='AdvertisedTimeAtLocation' value='$dateadd(-00:15:00)' />`
        + `<LT name='AdvertisedTimeAtLocation' value='$dateadd(02:00:00)' />`
        + `<IN name='LocationSignature' value='${esc(sigs.join(','))}' />`
        + `</AND></FILTER>`,
      include: ['LocationSignature', 'ActivityType', 'AdvertisedTimeAtLocation',
        'EstimatedTimeAtLocation', 'OperationalTrainNumber', 'TrackAtLocation',
        'FromLocation.LocationName', 'ToLocation.LocationName',
        'ProductInformation.Description', 'Deviation.Description', 'Canceled'],
    }), { tag: 'trainannouncement' });
  S.trains = rows;
}

async function qWeather() {
  const { rows } = await postXml(
    requestXml({
      type: 'WeatherObservation', ns: 'Road.WeatherInfo', sv: '2.1', limit: 600,
      filter: `<FILTER><GT name='ModifiedTime' value='$dateadd(-00:15:00)' /></FILTER>`,
      include: ['Id', 'Sample', 'Surface', 'Air', 'Wind', 'Weather', 'Measurepoint'],
    }), { tag: 'weatherobs' });
  S.weather = rows;
}

async function qStations() {
  // OBS: OfficialLocationName finns i intellisense men avslås 400 av
  // datacache INCLUDE ("Invalid query attribute") – ej i listan.
  const { rows } = await postXml(
    requestXml({
      type: 'TrainStation', ns: 'rail.infrastructure', sv: '1.0', limit: 2500,
      include: ['LocationSignature', 'AdvertisedLocationName',
        'CountyNo', 'Prognosticated', 'Geometry.WGS84'],
    }), { tag: 'trainstation', timeout: 60000 });
  S.stations = rows;
  const names = new Map();
  for (const r of rows) if (r.LocationSignature) names.set(r.LocationSignature, r.AdvertisedLocationName ?? r.LocationSignature);
  S.stationNames = names;
}

// Alla avgångar i fönstret bär DeviationId (flödet är påverkade avgångar).
async function qFerry() {
  const { rows } = await postXml(
    requestXml({
      type: 'FerryAnnouncement', ns: 'Ferry.TrafficInfo', sv: '1.2', limit: 2500,
      filter: `<FILTER><AND>`
        + `<GT name='DepartureTime' value='$dateadd(-06:00:00)' />`
        + `<LT name='DepartureTime' value='$dateadd(12:00:00)' />`
        + `</AND></FILTER>`,
    }), { tag: 'ferry', timeout: 60000 });
  S.ferry = rows;
}

// ---- SSE (valfritt) ----------------------------------------------------

function stopSse() {
  if (S.sse.ctrl) { try { S.sse.ctrl.abort(); } catch { /* redan avstängd */ } S.sse.ctrl = null; }
  S.sse.active = false;
}

function applySseData(j) {
  const r0 = j?.RESPONSE?.RESULT?.[0] ?? j;
  const v = r0?.Situation;
  if (!v) return;
  for (const row of Array.isArray(v) ? v : [v]) {
    if (!row?.Id) continue;
    if (row.Deleted) S.situation.delete(row.Id); else S.situation.set(row.Id, row);
  }
}

// POST sseurl='true' → INFO.SSEURL, sedan GET-ström i bakgrunden.
// Setup-fel är icke-dödliga: pollingen fortsätter oavsett.
function startSse() {
  stopSse();
  S.sse.lastAttempt = Date.now();
  (async () => {
    const { info } = await postXml(
      requestXml({ type: 'Situation', ns: 'Road.TrafficInfo', sv: '1.6', limit: 50, lastmod: true, sse: true }),
      { tag: 'sse-setup' });
    const url = info?.SSEURL;
    if (!url) return;
    const ctrl = new AbortController();
    S.sse = { active: true, ctrl, lastEvent: Date.now(), lastAttempt: S.sse.lastAttempt };
    try {
      const r = await fetch(url, {
        headers: { Accept: 'text/event-stream', Referer: REFERER, 'User-Agent': UA() },
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) return;
      let buf = '';
      for await (const chunk of r.body) {
        buf += chunk.toString('utf8');
        // SSE är CRLF-ramad; händelser separeras av \r\n\r\n (tolera \n\n).
        let i = buf.search(/\r?\n\r?\n/);
        while (i >= 0) {
          const sep = buf[i] === '\r' ? 4 : 2;
          const evt = buf.slice(0, i);
          buf = buf.slice(i + sep);
          const data = evt.split(/\r?\n/).filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).trimStart()).join('');
          if (data) {
            S.sse.lastEvent = Date.now();
            try { applySseData(JSON.parse(data)); } catch { /* trasig rad – ignorera */ }
          }
          i = buf.search(/\r?\n\r?\n/);
        }
        if (buf.length > 5e6) buf = buf.slice(-1000); // säkerhetsventil
      }
    } catch { /* abort eller nätverksmisse – polling tar över */ }
    S.sse.active = false;
  })().catch(() => { /* setupfel: pollingen fortsätter */ });
}

// Situation via SSE (om aktiverat) eller polling. En frisk ström
// (sista eventet < 5 min) undviker polling för den här typen; annars
// fullast/delta och (valfritt) strömstart om det inte görr på 60 s.
async function updateSituation() {
  if (USE_SSE) {
    const fresh = S.sse.active && Date.now() - S.sse.lastEvent < SSE_SILENCE_MS;
    if (fresh) return;
    stopSse();
  }
  if (Date.now() - S.lastFull.situation > FULL_REFRESH_MS || S.situation.size === 0) {
    await qSituationFull();
  } else {
    const capped = await qSituationDelta();
    if (capped) await qSituationFull();
  }
  if (USE_SSE && Date.now() - S.sse.lastAttempt > 60000) startSse();
}

async function updateRoad() {
  if (Date.now() - S.lastFull.road > FULL_REFRESH_MS || S.road.size === 0) {
    await qRoadFull();
  } else {
    const capped = await qRoadDelta();
    if (capped) await qRoadFull();
  }
}

// ---- Tick ----------------------------------------------------------------

async function tick() {
  const errors = [];
  let attempted = 0;
  // Sista lyckade hämtning styr "due"-kollarna; misslyckade frågor
  // förs alltså i stället på nästa tick.
  const run = async (name, fn, dueMs) => {
    if (dueMs && S.lastFetch[name] && Date.now() - S.lastFetch[name] < dueMs) return;
    attempted += 1;
    try {
      await fn();
      S.lastFetch[name] = Date.now();
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  };

  if (!S.initialized) {
    // Förstakörning: fullast av allt sekventiellt (~4–5 s).
    await run('situation-full', qSituationFull);
    await run('road-full', qRoadFull);
    await run('stationer', qStations);
  } else {
    await run('situation', updateSituation);
    await run('road', updateRoad);
  }
  await run('flöde', qFlow);
  await run('tåg', qTrains);
  await run('väder', qWeather);
  await run('stationer', qStations, STATIONS_D);
  await run('färja', qFerry, FERRY_D);

  // Källan räknas initierad när minst en datadriven fråga kommit igenom;
  // varje typ hämtar sedan på egen hand (tomt lager ⇒ fullast nästa tick).
  if (!S.initialized && (S.situation.size || S.road.size || S.flowSites.length
      || S.trains.length || S.weather.length || S.ferry.length)) {
    S.initialized = true;
  }
  // Frisk = minst en fråga lyckades. Full miss (API nere, dålig nyckel)
  // markeras i källhälsan; delvis fel serveras med sista goda data.
  if (attempted > 0 && errors.length === attempted) {
    throw new Error(errors.join(' | '));
  }
  return buildRecords();
}

// ---- Postkonstruktion -----------------------------------------------------

const M = (indicator, value, unit, ts) => ({
  t: 'm', area: 3, country: 'SE', source: 'trafikverket',
  indicator, value, unit, ts: ts ?? now(),
});

function buildRecords() {
  const ts = now();
  const recs = [];

  // --- Situation: en post per Deviation, prioriterat på allvarlighetsgrad
  let sitCount = 0;
  const devEvents = [];
  for (const s of S.situation.values()) {
    const devs = (s.Deviation ?? []).filter(d => d.Id && !d.Suspended);
    if (!devs.length) continue;
    sitCount += 1;
    for (const d of devs) {
      const sev = CODE_SEV[d.MessageCodeValue] ?? 'info';
      const road = d.RoadNumber ?? d.Header ?? '';
      devEvents.push({
        rank: SEV_RANK[sev],
        start: d.StartTime ?? '',
        ev: {
          t: 'e', area: 3, country: 'SE', source: 'trafikverket',
          kind: 'väg', severity: sev,
          title: `${CODE_LABEL[d.MessageCodeValue] ?? d.MessageCodeValue ?? 'Trafikhändelse'}${road ? ` · ${road}` : ''}`,
          detail: d.LocationDescriptor ?? [d.RoadNumber, d.Header].filter(Boolean).join(' – '),
          start: d.StartTime ?? ts,
          end: d.EndTime ?? null,
          geo: wktGeo(d.Geometry?.Line?.WGS84 ?? d.Geometry?.WGS84),
        },
      });
    }
  }
  devEvents.sort((a, b) => b.rank - a.rank || b.start.localeCompare(a.start));
  recs.push(...devEvents.slice(0, 40).map(x => x.ev));
  recs.push(M('Aktiva trafikhändelser (väg, SE)', sitCount, 'st', ts));

  // --- RoadCondition: bara besvärliga sträckor som händelser
  let roadBad = 0;
  const roadEvents = [];
  for (const r of S.road.values()) {
    const code = Number(r.ConditionCode ?? 0);
    if (code < 2) continue;
    roadBad += 1;
    roadEvents.push({
      t: 'e', area: 3, country: 'SE', source: 'trafikverket',
      kind: 'väglag', severity: code >= 3 ? 'warn' : 'medium',
      title: `Väglag ${r.ConditionText ?? code}${r.RoadNumber ? ` · ${r.RoadNumber}` : ''}`,
      detail: [r.LocationText, ...(r.ConditionInfo ?? []), ...(r.Cause ?? [])].filter(Boolean).join(' · '),
      start: r.StartTime ?? ts,
      end: null,
      geo: wktGeo(r.Geometry?.WGS84),
    });
  }
  roadEvents.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  recs.push(...roadEvents.slice(0, 30));
  recs.push(M('Besvärligt väglag (SE)', roadBad, 'sträckor', ts));

  // --- TrafficFlow: fordon/h + snittfart per mätare
  const flowSites = S.flowSites;
  const totalFlow = flowSites.reduce((a, s) => a + (Number(s.VehicleFlowRate) || 0), 0);
  const speeds = flowSites.map(s => Number(s.AverageVehicleSpeed)).filter(Number.isFinite);
  const avgSpeed = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null;
  const flowTs = flowSites.length
    ? flowSites.map(s => s.MeasurementTime).filter(Boolean).sort().at(-1)
    : ts;
  recs.push(M('Flödesmätare med mätning (väg, SE)', flowSites.length, 'st', flowTs ?? ts));
  if (totalFlow) recs.push(M('Totalt fordonsflöde (mätstationer, SE)', totalFlow, 'fordon/h', flowTs ?? ts));
  if (avgSpeed != null) recs.push(M('Snittfart (flödesmätare, SE)', avgSpeed, 'km/h', flowTs ?? ts));

  // Länsaggregat: topp 3 efter totalt flöde.
  const byCounty = new Map();
  for (const s of flowSites) {
    if (s.CountyNo == null) continue;
    const e = byCounty.get(s.CountyNo) ?? { flow: 0, n: 0 };
    e.flow += Number(s.VehicleFlowRate) || 0;
    e.n += 1;
    byCounty.set(s.CountyNo, e);
  }
  for (const [c, e] of [...byCounty.entries()].sort((a, b) => b[1].flow - a[1].flow).slice(0, 3)) {
    if (e.flow > 0) recs.push(M(`Fordonsflöde ${countyName(c)} (${e.n} mätare)`, e.flow, 'fordon/h', flowTs ?? ts));
  }

  // Topp mätare som kartpunkter.
  const topFlow = [...flowSites]
    .sort((a, b) => (Number(b.VehicleFlowRate) || 0) - (Number(a.VehicleFlowRate) || 0))
    .slice(0, 25);
  for (const s of topFlow) {
    const g = wktGeo(s.Geometry?.WGS84);
    if (!g || g.type !== 'Point') continue;
    recs.push({
      t: 'a', area: 3, country: 'SE', source: 'trafikverket',
      type: 'flowmatning', name: `Flödesmätare ${s.SiteId}`, id: `tv-flow-${s.SiteId}`,
      geometry: g,
      attrs: {
        'Fordonsflöde': `${s.VehicleFlowRate ?? '–'} fordon/h`,
        'Snittfart': s.AverageVehicleSpeed != null ? `${s.AverageVehicleSpeed} km/h` : null,
        'Län': s.CountyNo != null ? countyName(s.CountyNo) : null,
        'Mätperiod': s.MeasurementOrCalculationPeriod ? `${s.MeasurementOrCalculationPeriod} min` : null,
        'Mätt': s.MeasurementTime ?? null,
      },
      updated: ts,
    });
  }

  // --- Tåg: ankomster/avgångar nästa 2 h vid valda stationer,
  //   närmaste först, upp till 50 poster.
  const sigCount = stations().length;
  const trainEvs = S.trains.map(a => {
    const name = S.stationNames.get(a.LocationSignature) ?? a.LocationSignature ?? 'okänd station';
    const from = (a.FromLocation ?? [])[0]?.LocationName;
    const to = (a.ToLocation ?? [])[0]?.LocationName;
    const prod = (a.ProductInformation ?? [])[0]?.Description;
    const dev = (a.Deviation ?? [])[0]?.Description;
    return {
      t: 'e', area: 3, country: 'SE', source: 'trafikverket',
      kind: 'tåg', severity: a.Canceled ? 'high' : (dev ? 'warn' : 'info'),
      title: `Tåg ${a.OperationalTrainNumber ?? '–'} · ${a.ActivityType ?? 'evenemang'} ${name}`,
      detail: [prod, from && to ? `${from} → ${to}` : null, a.TrackAtLocation ? `spår ${a.TrackAtLocation}` : null, dev]
        .filter(Boolean).join(' · '),
      start: a.AdvertisedTimeAtLocation ?? ts,
      end: null,
      geo: null,
    };
  }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  recs.push(...trainEvs.slice(0, 50));
  recs.push(M(`Tågevenemang nästa 2 h (${sigCount} stationer)`, S.trains.length, 'st', ts));

  // --- Vägväder: KPI:er över observationer <15 min
  const weatherTs = S.weather.length
    ? S.weather.map(w => w.Sample).filter(Boolean).sort().at(-1)
    : ts;
  const num = x => { const n = Number(x); return Number.isFinite(n) ? n : null; };
  const surf = S.weather.map(w => num(w.Surface?.Temperature?.Value)).filter(v => v != null);
  const avgSurf = surf.length ? Math.round((surf.reduce((a, b) => a + b, 0) / surf.length) * 10) / 10 : null;
  const icy = S.weather.filter(w =>
    w.Surface?.Ice
    || (num(w.Surface?.SnowDepth?.Solid?.Value) ?? 0) > 0
    || (num(w.Surface?.SnowDepth?.WaterEquivalent?.Value) ?? 0) > 0
    || (num(w.Surface?.WaterDepth?.Value) ?? 0) > 0).length;
  recs.push(M('Vägväderstationer (mätning <15 min)', S.weather.length, 'st', weatherTs ?? ts));
  if (avgSurf != null) recs.push(M('Snitt vägtamperatur (SE)', avgSurf, '°C', weatherTs ?? ts));
  recs.push(M('Stationer med is/snö på väg (SE)', icy, 'st', weatherTs ?? ts));

  // --- Färja: påverkade avgångar per linje
  const byRoute = new Map();
  for (const f of S.ferry) {
    if (f.Deleted) continue;
    const key = f.Route?.Name ?? 'okänd linje';
    const e = byRoute.get(key) ?? { name: key, short: f.Route?.Shortname, n: 0, first: null };
    e.n += 1;
    if (f.DepartureTime && (!e.first || f.DepartureTime < e.first)) e.first = f.DepartureTime;
    byRoute.set(key, e);
  }
  recs.push(M('Färjeavgångar påverkade av avvikelser (–6 h … +12 h)', S.ferry.length, 'avgångar', ts));
  for (const e of [...byRoute.values()].sort((a, b) => b.n - a.n).slice(0, 10)) {
    recs.push({
      t: 'e', area: 3, country: 'SE', source: 'trafikverket',
      kind: 'färja', severity: 'warn',
      title: `Färja ${e.short ? `(${e.short}) ` : ''}${e.name}`,
      detail: `${e.n} påverkade avgångar i fönstret · nästa ${e.first ?? '–'}`,
      start: e.first ?? ts,
      end: null,
      geo: null,
    });
  }

  // --- Stationer: metric + kartpunkter för följda stationer
  const realStations = S.stations.filter(s => !s.Prognosticated).length;
  if (S.stations.length) recs.push(M('Järnvägsstationer (SE, i drift)', realStations, 'st', ts));
  // Följda stationer som kartpunkter. Prognosticated utesluts EJ: flaggan
  // betyder "planerad/ombyggd" i datakatalogen och täcker t.ex. Stockholm C,
  // som är fullt driftande. Noteras i attributen i stället.
  const wanted = new Set(stations());
  for (const st of S.stations) {
    if (!wanted.has(st.LocationSignature)) continue;
    const g = wktGeo(st.Geometry?.WGS84);
    if (!g || g.type !== 'Point') continue;
    recs.push({
      t: 'a', area: 3, country: 'SE', source: 'trafikverket',
      type: 'station', name: st.AdvertisedLocationName ?? st.LocationSignature,
      id: `tv-station-${st.LocationSignature}`,
      geometry: g,
      attrs: {
        'Signatur': st.LocationSignature,
        'Län': st.CountyNo != null ? countyName(st.CountyNo) : null,
        'Prognosticerad (ombyggd?)': st.Prognosticated ? 'ja' : 'nej',
      },
      updated: ts,
    });
  }

  return recs;
}

export default {
  id: 'trafikverket',
  name: 'Trafikverket',
  area: 3,
  country: 'SE',
  every: 60,
  need: 'TRAFIKVERKET_KEY',
  fetch: async () => tick(),
};

// Exporteras för enhetstester (server/test/trafikverket.test.js).
export { wktGeo, extractRows, requestXml };
