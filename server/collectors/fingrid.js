// Fingrid Open Data – API key (x-api-key), 10 000 requests/24 h,
// max 1 request/2 s per key. FINGRID_DATASETS can override the defaults
// using "datasetId:Indicator,...".
//
// Verified active dataset IDs (all MW, 3 min):
//   192 – total electricity production
//   193 – total electricity consumption
//   181 – wind production (about 2% of capacity estimated)
//   191 – hydro production
//   188 – nuclear production
//   202 – industrial cogeneration (CHP)
// Dataset 337 (day-ahead electricity price, EUR/MWh, hourly) is listed in the
// Fingrid catalog; it cannot be verified live until a key is configured.
// Component series are additional indicators, not an exhaustive generation
// mix. Do not add them together to reconstruct total production.
// API access requires a registered key; it is never exposed to the browser.
import { jjson, sleep } from '../lib/http.js';

const DEFAULT_DATASETS = [
  [192, 'Total produktion (FI)'],
  [193, 'Total förbrukning (FI)'],
  [181, 'Vindproduktion (FI)'],
  [191, 'Vattenkraftproduktion (FI)'],
  [188, 'Kärnkraftsproduktion (FI)'],
  [202, 'Industriell kraftvärmeproduktion (FI)'],
  [337, 'Dag-ahead-pris FI'],
];

export function configuredDatasets(value = process.env.FINGRID_DATASETS) {
  if (!String(value ?? '').trim()) return DEFAULT_DATASETS;
  return String(value).split(',').map(item => {
    const [rawId, ...labelParts] = item.split(':');
    const id = Number(rawId?.trim());
    const label = labelParts.join(':').trim();
    if (!Number.isInteger(id) || id <= 0 || !label) {
      throw new Error(`Ogiltig FINGRID_DATASETS-post: ${item}`);
    }
    return [id, label];
  });
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.latest)) return payload.latest;
  const row = payload?.latest && typeof payload.latest === 'object'
    ? payload.latest : payload;
  return row && typeof row === 'object' ? [row] : [];
}

// Convert the latest API record to the common Northwatch metric shape.
// The end of the measured interval is used as the observation timestamp;
// an absent timestamp/value is rejected rather than replaced with "now" or 0.
export function normalizeLatestData(datasetId, indicator, payload) {
  const candidates = rowsFrom(payload)
    .filter(row => row && typeof row === 'object')
    .sort((a, b) => String(b.endTime ?? b.startTime ?? b.timestamp ?? '')
      .localeCompare(String(a.endTime ?? a.startTime ?? a.timestamp ?? '')));
  const row = candidates[0];
  if (!row) throw new Error(`Fingrid dataset ${datasetId}: empty latest response`);
  const value = Number(row.value);
  const ts = row.endTime ?? row.startTime ?? row.timestamp;
  if (row.value == null || !Number.isFinite(value)) {
    throw new Error(`Fingrid dataset ${datasetId}: missing or invalid value`);
  }
  if (typeof ts !== 'string' || !Number.isFinite(Date.parse(ts))) {
    throw new Error(`Fingrid dataset ${datasetId}: missing or invalid timestamp`);
  }
  return {
    t: 'm', area: 1, country: 'FI', source: 'fingrid',
    indicator, value, unit: row.unit || 'MW', ts: new Date(ts).toISOString(),
  };
}

export default {
  id: 'fingrid',
  name: 'Fingrid',
  area: 1,
  country: 'FI',
  every: 180,
  need: 'FINGRID_KEY',
  fetch: async () => {
    const out = [];
    const datasets = configuredDatasets();
    for (const [index, [id, name]] of datasets.entries()) {
      const response = await jjson(`https://data.fingrid.fi/api/datasets/${id}/data/latest`, {
        headers: { 'x-api-key': process.env.FINGRID_KEY },
      });
      out.push(normalizeLatestData(id, name, response));
      if (index < datasets.length - 1) await sleep(2100); // max 1 request / 2 s
    }
    return out;
  },
};
