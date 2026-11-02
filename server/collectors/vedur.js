// Ilmasto- ja maantietutkimuslaitos (Vedur) – Island: jordbävningar,
// vulkaner, väderobservationer och CAP-varningar. ÖPPT API, ingen nyckel.
// Verifierat 2026-11-02 (api.vedur.is, OpenAPI-specarna för kvicks/volkan/
// synop/CAP):
//   GET /quakes/events                     → GeoJSON FeatureCollection
//                                            (properties: event_id, time,
//                                            magnitude, depth, region)
//   GET /volcanoes/volcanoes               → array {code, name, country,
//                                            geom_point, min/max_plume_height,
//                                            possible_max_plume_height}
//   GET /weather/observations/synop/latest?locale=en
//                                            → array {station, name, time,
//                                            t=°C, rh=%, ps=hPa, a=m/s, r}
//   GET /cap/capbroker/active/detailed/all → 204 (No Content) när det saknas
//                                            aktiva varningar; annars JSON-array
//                                            (ActiveMessageDetailed: event_en,
//                                            headline_en, description_en,
//                                            category[], urgency, expires, sent)
// OBS: 204 är "ok" här – j() i lib/http.js kastar på !ok, så CAP-anropet
// görs med raw fetch.
import { jjson, UA, now, sleep } from '../lib/http.js';

const BASE = 'https://api.vedur.is';

// Större isländska synopstationer (normaliserade namn utan diakritiska tecken).
const KEY_STATIONS = ['reykjavik', 'keflavik', 'akureyri', 'isafjordur', 'egilstadir', 'vik'];
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const sev = m => (m >= 4 ? 'high' : m >= 2 ? 'medium' : 'low');

export default {
  id: 'vedur',
  name: 'Vedur (jordbävning/vulkan/väder)',
  area: 11,
  country: 'IS',
  every: 600,
  fetch: async () => {
    const records = [];

    // Jordbävningar → händelser (de 25 senaste).
    const q = await jjson(`${BASE}/quakes/events`);
    const feats = [...(q.features ?? [])]
      .sort((a, b) => String(b.properties?.time ?? '').localeCompare(String(a.properties?.time ?? '')));
    records.push({
      t: 'm', area: 11, country: 'IS', source: 'vedur',
      indicator: 'Jordbävningar i händelselistan (antal)',
      value: feats.length, unit: 'st', ts: now(),
    });
    for (const f of feats.slice(0, 25)) {
      const p = f.properties ?? {};
      const mag = Number(p.magnitude);
      records.push({
        t: 'e', area: 11, country: 'IS', source: 'vedur',
        kind: 'jordbävning',
        severity: sev(Number.isFinite(mag) ? mag : 0),
        title: `Jordbävning ${Number.isFinite(mag) ? `M${mag.toFixed(1)}` : 'okänd styrka'}${p.region ? ` ${p.region}` : ''}`,
        detail: `Djup ${p.depth ?? '?'} km${p.event_id ? ` · ${p.event_id}` : ''}`,
        start: p.time ?? now(),
        end: null,
        geo: f.geometry ?? null,
      });
    }

    await sleep(300);

    // Synopobservationer → metrik för de största stationerna.
    const wx = await jjson(`${BASE}/weather/observations/synop/latest?locale=en`);
    const list = Array.isArray(wx) ? wx : [];
    records.push({
      t: 'm', area: 11, country: 'IS', source: 'vedur',
      indicator: 'Synopstationer med senaste observation (antal)',
      value: list.length, unit: 'st', ts: now(),
    });
    for (const s of list) {
      if (!KEY_STATIONS.some(k => norm(s.name).startsWith(k))) continue;
      const ts = s.time ?? now();
      const base = `Vedur ${s.name}`;
      if (s.t != null) records.push({
        t: 'm', area: 11, country: 'IS', source: 'vedur',
        indicator: `${base} – temperatur`, value: s.t, unit: '°C', ts,
      });
      if (s.ps != null) records.push({
        t: 'm', area: 11, country: 'IS', source: 'vedur',
        indicator: `${base} – tryck (nivå havet)`, value: s.ps, unit: 'hPa', ts,
      });
      if (s.a != null) records.push({
        t: 'm', area: 11, country: 'IS', source: 'vedur',
        indicator: `${base} – vindhastighet`, value: s.a, unit: 'm/s', ts,
      });
    }

    await sleep(300);

    // Vulkaner → antal + askelmolnhändelse bara vid relevanta höjder
    // (≥ 1 km; katalogens värden är annars ofta små "möjliga"-höjder).
    const vol = await jjson(`${BASE}/volcanoes/volcanoes`);
    const volcanoes = Array.isArray(vol) ? vol : [];
    records.push({
      t: 'm', area: 11, country: 'IS', source: 'vedur',
      indicator: 'Vulkaner under bevakning (antal, Vedur-katalog)',
      value: volcanoes.length, unit: 'st', ts: now(),
    });
    for (const v of volcanoes) {
      const h = Number(v.max_plume_height);
      if (!Number.isFinite(h) || h < 1000) continue;
      records.push({
        t: 'e', area: 11, country: 'IS', source: 'vedur',
        kind: 'vulkanaktivitet',
        severity: h >= 6000 ? 'high' : 'medium',
        title: `Askelmoln: ${v.name} upp till ${Math.round(h)} m`,
        detail: v.alt_name ?? '',
        start: now(),
        end: null,
        geo: v.geom_point ?? null,
      });
    }

    await sleep(300);

    // CAP-varningar (raw fetch: 204 = inga aktiva varningar).
    const cr = await fetch(`${BASE}/cap/capbroker/active/detailed/all`, {
      headers: { 'User-Agent': UA(), Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    let caps = [];
    if (cr.status === 204) {
      caps = [];
    } else if (cr.ok) {
      caps = await cr.json().catch(() => []);
      if (!Array.isArray(caps)) caps = [];
    } else {
      throw new Error(`HTTP ${cr.status} api.vedur.is (CAP)`);
    }
    for (const c of caps.slice(0, 25)) {
      const title = c.event_en ?? c.headline_en ?? 'Varning (Vedur CAP)';
      const cats = (c.category ?? []).join(', ');
      records.push({
        t: 'e', area: 11, country: 'IS', source: 'vedur',
        kind: 'kapvarning',
        severity: c.urgency === 'immediate' ? 'high' : 'medium',
        title: `${title}${cats ? ` (${cats})` : ''}`,
        detail: c.description_en ?? '',
        start: c.sent ?? now(),
        end: c.expires ?? null,
        geo: null,
      });
    }

    return records;
  },
};
