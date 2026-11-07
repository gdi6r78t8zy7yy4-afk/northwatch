// Northwatch – backend. Insamlar data från öppna API, normaliserar och
// exponerar via /api/*. Samtliga nycklar/tokens ligger här (i .env) och
// visas aldrig i frontend. Inga runtime-beroenden (Node >= 20.6).
import './lib/env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTORS } from './collectors/index.js';
import { registerSource, initStore, loadEnergyMeasurements } from './lib/store.js';
import { startScheduler } from './lib/scheduler.js';
import { state, healthList, areaSources, areaStatus, cellStatus, sourceStatus } from './lib/store.js';
import { AREAS, COUNTRIES } from './areas.js';
import { now } from './lib/http.js';
import { staticGeo } from './lib/geolayers.js';
import { apiForecastMeta, apiForecastPoint, apiForecastGrid, apiForecastGridCoords } from './lib/forecast.js';
import { apiCyberNvd, apiCyberKev, apiCyberOsv, apiCyberPrioritized, apiCyberOverview } from './lib/cyber.js';
import { buildEnergyOverview } from './lib/energy.js';
import { parseEnergyRange, buildEnergyHistory, buildEnergyAnalysis } from './lib/energy-insights.js';

for (const c of COLLECTORS) registerSource(c);
// Restore the last snapshot before the first collector run, so the dashboard
// can serve the previous good dataset immediately after a restart.
await initStore();
startScheduler(COLLECTORS);

const root = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(root, '..', 'web', 'dist');

// ---- API ---------------------------------------------------------------

function areaMatrix() {
  return AREAS.map(a => {
    const srcs = areaSources(a.id);
    const cells = {};
    for (const c of COUNTRIES) {
      const rel = srcs.filter(s => s.country === c.code);
      const recs = rel.flatMap(s => s.records);
      cells[c.code] = {
        status: cellStatus(rel),
        count: recs.length,
        lastTs: recs.reduce((m, r) => (r.ts > m ? r.ts : m), null),
      };
    }
    const nordic = srcs.filter(s => s.country === 'NORDIC');
    const nordicRecs = nordic.flatMap(s => s.records);
    cells.NORDIC = {
      status: cellStatus(nordic),
      count: nordicRecs.length,
      lastTs: nordicRecs.reduce((m, r) => (r.ts > m ? r.ts : m), null),
    };
    const allRecs = srcs.flatMap(s => s.records);
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      short: a.short,
      scope: a.scope,
      gaps: a.gaps,
      geo: a.geo,
      status: areaStatus(a.id),
      sources: srcs.length,
      records: allRecs.length,
      lastTs: allRecs.reduce((m, r) => (r.ts > m ? r.ts : m), null),
      countriesWithData: COUNTRIES.filter(c => (cells[c.code].count ?? 0) > 0).map(c => c.code),
      cells,
    };
  });
}

function topRecords(limit = 12) {
  const recs = [];
  for (const s of state.sources.values()) recs.push(...s.records);
  const events = recs.filter(r => r.t === 'e').sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  const metrics = recs.filter(r => r.t === 'm').sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
  return [...events, ...metrics].slice(0, limit);
}

function sourceName(id) {
  const s = state.sources.get(id);
  return s?.name ?? id;
}

function enrich(records) {
  return records.map(r => ({ ...r, sourceName: sourceName(r.source) }));
}

const routes = {
  '/api/health': () => ({ health: healthList() }),

  '/api/energy/overview': u => buildEnergyOverview(
    [...state.sources.values()].map(source => ({ ...source, status: sourceStatus(source) })),
    { country: u.searchParams.get('country') || 'ALL', generatedAt: now() },
  ),

  '/api/dashboards': () => ({ generatedAt: now(), areas: areaMatrix() }),

  '/api/summary': () => {
    const health = healthList();
    const kpis = {
      total: health.length,
      ok: health.filter(h => h.status === 'ok').length,
      error: health.filter(h => h.status === 'error').length,
      no_key: health.filter(h => h.status === 'no_key').length,
      stale: health.filter(h => h.status === 'stale').length,
    };
    return { generatedAt: now(), kpis, areas: areaMatrix(), top: enrich(topRecords()), health };
  },

  // M3: geolager som poster (t:'a') från alla källor – OSM/Overpass
  // (anläggningar), PeeringDB (IX), Statnett (zonflöden), Digitraffic (geografi
  // i händelser). Filtreras på ?area= och ?country= (NORDIC ingår alltid).
  '/api/assets': (u) => {
    const area = u.searchParams.get('area');
    const country = (u.searchParams.get('country') || 'ALL').toUpperCase();
    const assets = [];
    for (const s of state.sources.values()) {
      for (const r of s.records) {
        if (r.t !== 'a') continue;
        if (area && String(r.area) !== area) continue;
        if (country !== 'ALL' && r.country !== country && r.country !== 'NORDIC') continue;
        assets.push(r);
      }
    }
    return { assets };
  },

  // M3: statiska kartlager (landsgränser + energilager) – ändras sällan.
  '/api/geo/static': () => ({ generatedAt: now(), ...staticGeo() }),
};

// M8: SMHI-prognosapi:t – asynkront (påfrågan kan utlösa SMHI-hämtning
// på plats, t.ex. griddatavärden eller anpassade platser).
// M9: cyber (område 5) – NVD/KEV/OSV med inminnescache (TTL); första
// anropet efter start kan alltså ta ~10–30 s medan datat hämtas.
const asyncRoutes = {
  '/api/energy/history': async u => {
    const { range, from, to } = parseEnergyRange(u.searchParams.get('range') || '24h');
    const records = await loadEnergyMeasurements({ from, to });
    const result = buildEnergyHistory(records, {
      range, country: u.searchParams.get('country') || 'ALL',
      indicator: u.searchParams.get('indicator') || null,
    });
    return { status: 200, body: { ...result, from, to } };
  },
  '/api/energy/analysis': async u => {
    const country = (u.searchParams.get('country') || 'ALL').toUpperCase();
    const metrics = [...state.sources.values()].filter(s => s.area === 1)
      .flatMap(s => s.records ?? []).filter(r => r.t === 'm' &&
        (country === 'ALL' || r.country === country || r.country === 'NORDIC'));
    const historyFrom = new Date(Date.now() - 30 * 86400_000).toISOString();
    const historyRecords = await loadEnergyMeasurements({ from: historyFrom, to: now() });
    return { status: 200, body: buildEnergyAnalysis(metrics, now(), historyRecords) };
  },

  '/api/forecast/meta': u => apiForecastMeta(u),
  '/api/forecast/point': (u, q) => apiForecastPoint(u, q.socket.remoteAddress ?? 'unknown-client'),
  '/api/forecast/grid': u => apiForecastGrid(u),
  '/api/forecast/grid-coords': u => apiForecastGridCoords(u),
  '/api/cyber/nvd': u => apiCyberNvd(u),
  '/api/cyber/kev': u => apiCyberKev(u),
  '/api/cyber/osv': u => apiCyberOsv(u),
  '/api/cyber/prioritized': u => apiCyberPrioritized(u),
  '/api/cyber/overview': u => apiCyberOverview(u),
};

function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---- Statisk server (web/dist) + SPA-fallback ---------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function serveStatic(q, res) {
  let p = q.url === '/' ? '/index.html' : q.url.split('?')[0];
  const file = path.resolve(DIST, '.' + p);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-fallback: okända GET-vägar (uten extension) visar appen
      if (!path.extname(p)) return fs.readFile(path.join(DIST, 'index.html'), (e2, d) =>
        e2 ? (res.writeHead(404), res.end('Not found')) : (res.writeHead(200, { 'Content-Type': TYPES['.html'] }), res.end(d)));
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

function sendStatus(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

http.createServer((q, res) => {
  const u = new URL(q.url, 'http://localhost');
  if (q.method === 'GET' && routes[u.pathname]) return sendJson(res, routes[u.pathname](u));
  // Asynkna vägar (kan vänta på extern hämtning).
  const ar = q.method === 'GET' && asyncRoutes[u.pathname];
  if (ar) {
    return Promise.resolve(ar(u, q)).then(
      ({ status, body }) => sendStatus(res, status ?? 200, body),
      e => sendStatus(res, 500, { error: String(e?.message ?? e) }),
    );
  }
  const m = q.method === 'GET' && u.pathname.match(/^\/api\/dashboard\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const area = AREAS.find(a => a.id === id);
    if (!area) { res.writeHead(404); return res.end('Okänt område'); }
    const country = (u.searchParams.get('country') || 'ALL').toUpperCase();
    const srcs = areaSources(id);
    const recs = srcs.flatMap(s => s.records)
      .filter(r => country === 'ALL' || r.country === country || r.country === 'NORDIC')
      .sort((a, b) => ((b.ts ?? b.start) || '').localeCompare((a.ts ?? a.start) || ''));
    return sendJson(res, {
      area,
      country,
      records: enrich(recs),
      sources: srcs.map(s => ({
        id: s.id, name: s.name, country: s.country, every: s.every,
        status: sourceStatus(s), lastOk: s.lastOk, lastError: s.lastError, ms: s.ms, error: s.error,
      })),
    });
  }
  if (q.method === 'GET' && u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }
  serveStatic(q, res);
}).listen(3000, '0.0.0.0', () => {
  console.log(`northwatch: http://0.0.0.0:3000 (${COLLECTORS.length} källor)`);
});
