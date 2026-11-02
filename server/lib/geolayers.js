// Geolager för kartan (M3): statisk GeoJSON + OSM/Overpass-extraktion av
// kritiska anläggningar (veckocache på disk).
// Postmodell (se store.js): asset {t:'a', area, country, source, type, name,
// geometry, attrs?, updated}. OSM-data gäller ODbL-tillståndet; vi sparar
// bara namn, koordinat och få tekniska attribut – ingen personuppgifter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { j, now, sleep } from './http.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.join(root, '..', 'assets');
const CACHE_DIR = path.join(root, '..', 'cache');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ASSET_DIR, name), 'utf8'));
}

// Statiska lager, lästa vid start (inga API-anrop):
//   nordic-countries.geojson – landsgränser, Natural Earth 50m (public domain)
//   energy.geojson           – HVDC-länkar + schematiska zonskilda (M3)
const countries = loadJson('nordic-countries.geojson');
const energy = loadJson('energy.geojson');

// Zonmittpunkter + grannländer-ankar från energilagret – används av
// statnett.js för flödesgeometri. EN (Storbritannien) aliasas till GB.
export const zoneCenters = Object.fromEntries(
  energy.features
    .filter(f => f.properties.kind === 'zone' || f.properties.kind === 'anchor')
    .map(f => [f.properties.zone, f.geometry.coordinates]),
);
zoneCenters.EN = zoneCenters.GB;

export function staticGeo() {
  return { countries, energy };
}

// Punkt-i-polygon (ray casting, ytterring) för landtilldelning av OSM-objekt.
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function countryOf([lon, lat]) {
  for (const f of countries.features) {
    const polys = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) if (inRing(lon, lat, poly[0])) return f.properties.code;
  }
  return null;
}

// ---- OSM/Overpass (veckocache) ------------------------------------------
// Verifierat mot den publika instansen 2026-11-02 (Node-klient fungerar från
// detta nätverk; curl möter 406 i kanten – irrelevant för appen). Den publika
// instansen är ofta fullbelagd (429/502) → anropen köas internt och
// återförs med exponentiell backoff. Överaskande taggförhållanden i Norden:
// kraftverken har power=plant (inte power:generator), datacenter har
// building=data_center(-centre), vattenverk har man_made=water_works.
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const WEEK = 7 * 86400; // pollinterval för osm-* källorna
const NORDIC_BBOX = [54.3, -24.9, 71.4, 31.9]; // S, W, N, E

export const OSM_SPECS = {
  'osm-energi': {
    area: 1, type: 'kraftanläggning', limit: 1500,
    fields: ['power', 'plant:source', 'generator:source', 'output:electricity',
      'plant:output:electricity', 'voltage', 'operator', 'generator:type'],
    query: '(node["power"="plant"]({bbox});way["power"="plant"]({bbox});'
      + 'node["power:substation"]["voltage"~"[0-9]00000"]({bbox});'
      + 'way["power:substation"]["voltage"~"[0-9]00000"]({bbox});)',
  },
  'osm-digital': {
    area: 2, type: 'datacenter', limit: 500,
    fields: ['operator', 'website', 'capacity'],
    query: '(node["building"="data_center"]({bbox});way["building"="data_center"]({bbox});'
      + 'rel["building"="data_center"]({bbox});node["building"="data_centre"]({bbox});'
      + 'way["building"="data_centre"]({bbox});node["man_made"="data_centre"]({bbox});'
      + 'way["man_made"="data_centre"]({bbox});)',
  },
  'osm-transport': {
    area: 3, type: 'flygplats', limit: 1200,
    fields: ['iata', 'icao', 'aeroway', 'aerodrome:type'],
    query: '(node["aeroway"~"airport|aerodrome"]["aerodrome:type"!="military"]({bbox});'
      + 'way["aeroway"~"airport|aerodrome"]["aerodrome:type"!="military"]({bbox});'
      + 'rel["aeroway"~"airport|aerodrome"]["aerodrome:type"!="military"]({bbox});)',
  },
  'osm-vatten': {
    area: 4, type: 'vattenverk', limit: 1200,
    fields: ['operator', 'water', 'man_made'],
    query: '(node["man_made"="water_works"]({bbox});way["man_made"="water_works"]({bbox});'
      + 'node["sewage"="works"]({bbox});way["sewage"="works"]({bbox});)',
  },
};

function toAsset(spec, el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const cc = lat != null && lon != null ? countryOf([lon, lat]) : null;
  if (!cc) return null; // utanför de fem länderna (t.ex. Färöarna) → uteslut
  const tags = el.tags ?? {};
  const name = tags.name
    ?? (tags.iata ? `${tags.iata} (${cc})` : null)
    ?? `${spec.type} ${cc} (${el.type} ${el.id})`;
  const attrs = {};
  for (const k of spec.fields) if (tags[k] != null) attrs[k] = tags[k];
  return {
    t: 'a', area: spec.area, country: cc, source: 'osm',
    type: spec.type, name,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    attrs, updated: now(),
  };
}

// Serialisera Overpass-anrop (den publika instansen 429:ar vid samtidighet).
let osmQueue = Promise.resolve();
export function refreshOsm(id) {
  const run = async () => {
    const spec = OSM_SPECS[id];
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // Veckokälla: färsk cache → inget nätverksanrop (mjuk uppstart).
    const cached = readCache(id);
    if (cached?.records?.length && Date.now() - Date.parse(cached.fetchedAt) < WEEK * 1000) {
      return cached.records;
    }
    const [s, w, n, e] = NORDIC_BBOX;
    // Obs: union-gruppen avslutas med ; följt av utmatning.
    const body = `[out:json][timeout:120];${spec.query.replaceAll('{bbox}', `${s},${w},${n},${e}`)};out center ${spec.limit};`;
    // Försök 1–4: den publika instansen svarar 429/502/503 vid full kö.
    let data = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(15000 * 2 ** (attempt - 1)); // 15 s, 30 s, 60 s
      try {
        const r = await j(OVERPASS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(body),
          timeout: 150000,
        });
        data = await r.json();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const retryable = /HTTP (429|502|503)/.test(String(err?.message ?? err));
        if (!retryable) break;
      }
    }
    if (data == null) {
      const cached = readCache(id); // håll åldrig cache i stället för att dör
      if (cached) return cached.records;
      throw lastErr;
    }
    const records = (data.elements ?? [])
      .map(el => toAsset(spec, el)).filter(Boolean);
    if (!records.length) throw new Error('OSM returnerade inga objekt');
    fs.writeFileSync(path.join(CACHE_DIR, `${id}.json`), JSON.stringify({ fetchedAt: now(), records }));
    return records;
  };
  // Vänta på föregående anrop + kort paus så vi inte trumfar in i rate-limiten.
  const p = osmQueue.then(async () => { await sleep(1500); return run(); });
  osmQueue = p.catch(() => {});
  return p;
}

export function readCache(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export { WEEK as OSM_WEEK };
