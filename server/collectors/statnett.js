// Statnett driftsdata – fysiska flöden mellan elspotzoner samt norsk produktion/förbrukning.
// Öppet API, ingen API-nyckel.
//
// Verifierade endpoints:
//   /restapi/PhysicalFlowMap/GetFlow
//     → [{OutAreaElspotId, InAreaElspotId, Value (MW), MeasureDate (ms)}]
//   /restapi/ProductionConsumption/GetData?From=YYYY-MM-DD
//     → {StartPointUTC, EndPointUTC, PeriodTickMs, Production[], Consumption[]}
// Production/Consumption är nationella norska MW-serier med timupplösning.
// Statnett anger 1–2 % felmarginal och att förbrukning beräknas från
// produktion plus import/minus export. Dessa serier visar inte produktionsmix.
import { jjson, now } from '../lib/http.js';
import { zoneCenters } from '../lib/geolayers.js';

const FLOW_URL = process.env.STATNETT_FLOW_URL ||
  'https://driftsdata.statnett.no/restapi/PhysicalFlowMap/GetFlow';
const PRODUCTION_URL = process.env.STATNETT_PRODUCTION_URL ||
  'https://driftsdata.statnett.no/restapi/ProductionConsumption/GetData';

function utcDateDaysAgo(days, date = new Date()) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function normalizeProductionConsumption(payload) {
  const start = Number(payload?.StartPointUTC);
  const tick = Number(payload?.PeriodTickMs);
  const production = payload?.Production;
  const consumption = payload?.Consumption;
  if (!Number.isFinite(start) || !Number.isFinite(tick) || tick <= 0 ||
      !Array.isArray(production) || !Array.isArray(consumption)) {
    throw new Error('Statnett ProductionConsumption: invalid time-series envelope');
  }
  const latest = (values, indicator) => {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const value = Number(values[i]);
      if (values[i] == null || (typeof values[i] === 'string' && !values[i].trim()) || !Number.isFinite(value)) continue;
      const timestamp = start + i * tick;
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      return { t: 'm', area: 1, country: 'NO', source: 'statnett',
        indicator, value, unit: 'MW', ts: new Date(timestamp).toISOString() };
    }
    throw new Error(`Statnett ProductionConsumption: no valid values for ${indicator}`);
  };
  return [latest(production, 'Total produktion (NO)'), latest(consumption, 'Total förbrukning (NO)')];
}

export default {
  id: 'statnett', name: 'Statnett driftsdata', area: 1, country: 'NO', every: 900,
  fetch: async () => {
    const rows = await jjson(FLOW_URL);
    const list = Array.isArray(rows) ? rows : rows?.flows ?? [];
    if (!list.length) throw new Error('GetFlow returnerade ingen flödesrad');
    const Z = z => (z === 'EN' ? 'GB' : z);
    const ts = r => (r.MeasureDate ? new Date(r.MeasureDate).toISOString() : now());
    const records = list.map(r => ({ t: 'm', area: 1, country: 'NO', source: 'statnett',
      indicator: `Nettoflöde ${Z(r.OutAreaElspotId)}→${Z(r.InAreaElspotId)}`,
      value: Number(r.Value), unit: 'MW', ts: ts(r) }));
    for (const r of list) {
      const a = zoneCenters[r.OutAreaElspotId];
      const b = zoneCenters[r.InAreaElspotId];
      if (!a || !b) continue;
      records.push({ t: 'a', area: 1, country: 'NORDIC', source: 'statnett',
        type: 'flow', name: `${Z(r.OutAreaElspotId)}→${Z(r.InAreaElspotId)}`,
        geometry: { type: 'LineString', coordinates: [a, b] },
        attrs: { mw: Number(r.Value), from: Z(r.OutAreaElspotId), to: Z(r.InAreaElspotId) },
        updated: ts(r) });
    }
    // Fetch a two-day window to tolerate publication lag; retain newest valid
    // samples. Flow data remains available if this separate endpoint fails.
    try {
      const url = `${PRODUCTION_URL}?${new URLSearchParams({ From: utcDateDaysAgo(2) })}`;
      records.push(...normalizeProductionConsumption(await jjson(url)));
    } catch (error) {
      records.push({ t: 'e', area: 1, country: 'NO', source: 'statnett',
        kind: 'källstatus', severity: 'warning',
        title: 'Statnett: produktion/förbrukning tillfälligt otillgänglig',
        detail: error?.message ?? 'Okänt fel vid hämtning av produktion/förbrukning', start: now() });
    }
    return records;
  },
};
