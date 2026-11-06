// SMHI väderprognos (SNOW / snow1g) – timvisa prognoscyklar, område 11.
// Källan är SMHIs öppna prognos-API (nyckelfri; kontakt-User-Agent räcker).
// Pollar createdtime.json var 5:e min; när en ny cykel dyker upp (~15 min
// efter timslaget, UTC) hämtas times.json + tidsserier för de 11 följda
// städerna (lib/forecast.js POINTS, SMHI_FCST_POINTS-överstyrbar).
//
// Retention: de 12 senaste cyklarna speglas på disk
// (server/cache/smhi-forecast/, se lib/forecast.js) så att prognoshistorik
// och griddatavärden överlever omstart.
//
// Poster per cykel:
//   – metric: nuvarande steg per stad (temperatur, vind, byar, nederbörd)
//   – event: härledda väderhändelser (kind "väderprognos",
//     "beräknad utifrån prognos") när trösklar bryts i det kommande dygnet:
//       byar ≥ 22.5 m/s (röd) / ≥ 17 m/s (orange)
//       temperatur ≤ −15 °C (orange)
//       åskrisk ≥ 60 % (gul)
//       frusn nederbörd ≥ 50 % (gul)
//       nederbörd (max) ≥ 20 mm per intervall (gul)
// ibww-varningstjänsten har varit 503 sedan 2026-11-01 – dessa händelser
// kompenserar delvis (se kollektorn smhi-warnings.js).
import { fetchCreatedTime, fetchTimes, fetchPoint, ingestCycle, fc, POINTS, PARAMS, nowIndex } from '../lib/forecast.js';

export const EVENT_HORIZON = 24; // timmar/steg att scanna för härledda händelser

// Trösklar: för varje parameter eldas bara den värsta träffande nivån.
export const THRESHOLDS = [
  { param: 'wind_speed_of_gust', min: 22.5, severity: 'röd', label: 'Byig storm', unit: 'm/s' },
  { param: 'wind_speed_of_gust', min: 17, severity: 'orange', label: 'Byig vind', unit: 'm/s' },
  { param: 'air_temperature', max: -15, severity: 'orange', label: 'Extremt kallt', unit: '°C' },
  { param: 'thunderstorm_probability', min: 60, severity: 'gul', label: 'Hög åskrisk', unit: '%' },
  { param: 'probability_of_frozen_precipitation', min: 50, severity: 'gul', label: 'Risk för frusn nederbörd', unit: '%' },
  { param: 'precipitation_amount_max', min: 20, severity: 'gul', label: 'Stark nederbörd', unit: 'mm' },
];

const fmt = v => String(Math.round(v * 10) / 10);
const isMissing = v => v == null || v === 9999 || Number.isNaN(v);

function hitThresholds(data) {
  // THRESHOLDS är sorterad värst-först per parameter, så den första träffen
  // per parameter är den värsta nivån – used-setet deduperar resten.
  const hits = [];
  const used = new Set();
  for (const t of THRESHOLDS) {
    const v = data[t.param];
    if (isMissing(v)) continue;
    if (used.has(t.param)) continue;
    const hit = t.min != null ? v >= t.min : v <= t.max;
    if (!hit) continue;
    used.add(t.param);
    hits.push({ ...t, value: v });
  }
  return hits;
}

// Härledda händelser: scannar steg i0..i0+EVENT_HORIZON för varje punkt.
export function deriveEvents(pointData, times, i0, createdTime, referenceTime) {
  const events = [];
  for (const [name, pd] of Object.entries(pointData)) {
    const p = POINTS.find(x => x.name === name);
    if (!p || !pd?.timeSeries?.length) continue;
    const series = pd.timeSeries;
    const from = Math.min(i0, series.length - 1);
    const to = Math.min(from + EVENT_HORIZON, series.length - 1);
    for (let i = from; i <= to; i += 1) {
      const step = series[i];
      const hits = hitThresholds(step.data);
      if (!hits.length) continue;
      for (const h of hits) {
        events.push({
          t: 'e', area: 11, country: p.country, source: 'smhi-forecast',
          kind: 'väderprognos',
          severity: h.severity,
          title: `${h.label} ${fmt(h.value)} ${h.unit} – ${p.name} (prognos ${step.time.replace('T', ' ').slice(0, 16)} UTC)`,
          detail: `Beräknad utifrån prognos (SMHI snow1g, cykel ${createdTime}). `
            + `Värde ${fmt(h.value)} ${h.unit} kl ${step.time}${h.param === 'precipitation_amount_max' ? ' (summa över prognosintervall)' : ''}.`,
          start: step.time,
          end: null,
          geo: { type: 'Point', coordinates: [p.lon, p.lat] },
        });
      }
    }
  }
  return events;
}

// Metric-poster: nuvarande steg per punkt (4 indikatorer/stad).
export function pointMetrics(pointData, times, i0) {
  const out = [];
  for (const [name, pd] of Object.entries(pointData)) {
    const p = POINTS.find(x => x.name === name);
    if (!p || !pd?.timeSeries?.length) continue;
    const step = pd.timeSeries[Math.min(i0, pd.timeSeries.length - 1)];
    const d = step.data;
    const mk = (indicator, param, unit) => {
      if (isMissing(d[param])) return null;
      return {
        t: 'm', area: 11, country: p.country, source: 'smhi-forecast',
        indicator, value: d[param], unit, ts: step.time,
      };
    };
    const recs = [
      mk(`${p.name} temperatur (prognos)`, 'air_temperature', '°C'),
      mk(`${p.name} vind (prognos)`, 'wind_speed', 'm/s'),
      mk(`${p.name} vindbyar (prognos)`, 'wind_speed_of_gust', 'm/s'),
      mk(`${p.name} nederbörd (prognos, intervallsumma)`, 'precipitation_amount_mean', 'mm'),
    ];
    out.push(...recs.filter(Boolean));
  }
  return out;
}

export function buildRecords(pointData, times, createdTime, referenceTime, at = new Date()) {
  const i0 = nowIndex(times, at);
  return [...pointMetrics(pointData, times, i0), ...deriveEvents(pointData, times, i0, createdTime, referenceTime)];
}

// Senaste cykelns poster – återanvänds vid tickar utan cykelbyte så att
// dashboardskiktet inte behöver omräkna (scheduler ersätter annars listan).
let lastRecords = [];

export default {
  id: 'smhi-forecast',
  name: 'SMHI väderprognos (snow1g)',
  area: 11,
  country: 'NORDIC', // per-post-country bär stadslandet (SE/NO/FI/DK/IS)
  every: 300,
  fetch: async () => {
    const ct = await fetchCreatedTime();
    const createdTime = ct.createdTime ?? ct.created;
    const referenceTime = ct.referenceTime ?? null;
    if (!createdTime) throw new Error('createdtime.json saknar createdTime');
    if (fc.cycle?.createdTime === createdTime) {
      if (lastRecords.length) return lastRecords;
      throw new Error(`känd cykel ${createdTime} men inga poster i minnet`);
    }
    const times = await fetchTimes();
    if (!Array.isArray(times) || !times.length) throw new Error('times.json gav ingen tidslista');
    // Punkterna hämtas parallellt; enstaka 404 (utanför domän) fäller inte cykeln.
    const results = await Promise.all(POINTS.map(async p => {
      const r = await fetchPoint(p.lon, p.lat, { parameters: PARAMS });
      return [p, r];
    }));
    const pointData = {};
    for (const [p, r] of results) {
      if (r?.outside) {
        fc.outside.add(p.name);
        continue;
      }
      fc.outside.delete(p.name);
      pointData[p.name] = {
        geometry: r.geometry ?? null,
        timeSeries: r.timeSeries ?? [],
      };
    }
    if (!Object.keys(pointData).length) throw new Error('inga punkter inom domänen');
    await ingestCycle(createdTime, referenceTime, times, pointData);
    lastRecords = buildRecords(pointData, times, createdTime, referenceTime);
    return lastRecords;
  },
};
