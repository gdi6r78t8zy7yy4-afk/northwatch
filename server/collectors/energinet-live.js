// Energinet PowerSystemRightNow – 1-minute Danish power-system snapshot.
// Public/keyless Energi Data Service API. The dataset is updated every minute;
// it is SCADA-derived and approximate, not a settlement/statistical series.
// API: /dataset/PowerSystemRightNow?start=now-PT15M&sort=Minutes1UTC%20desc
// Fields used: Minutes1UTC, ProductionGe100MW, ProductionLt100MW,
// SolarPower, OnshoreWindPower, OffshoreWindPower, Exchange_Sum, CO2Emission.
// Positive Exchange_Sum is import. The source defines load as production + exchange.
import { jjson } from '../lib/http.js';

const BASE = process.env.EDS_BASE || 'https://api.energidataservice.dk/dataset';
const COMPONENTS = [
  'ProductionGe100MW', 'ProductionLt100MW', 'SolarPower',
  'OnshoreWindPower', 'OffshoreWindPower',
];

function numeric(row, field) {
  if (row?.[field] == null || row[field] === '') return null;
  const value = Number(row[field]);
  return Number.isFinite(value) ? value : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  // Energi Data Service timestamps are UTC; some responses omit the Z suffix.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + 'Z';
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizePowerSystemRows(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const valid = records.map(row => ({ row, ts: timestamp(row?.Minutes1UTC) }))
    .filter(item => item.ts)
    .sort((a, b) => b.ts.localeCompare(a.ts));
  if (!valid.length) throw new Error('PowerSystemRightNow: no valid timestamped records');

  const { row, ts } = valid[0];
  const values = Object.fromEntries([
    ...COMPONENTS, 'Exchange_Sum', 'CO2Emission',
  ].map(field => [field, numeric(row, field)]));
  const out = [];
  const metric = (indicator, value, unit = 'MW') => out.push({
    t: 'm', area: 1, country: 'DK', source: 'energinet-live',
    indicator, value, unit, ts,
  });

  // Do not label a partial sum as total production. Require every component.
  const completeProduction = COMPONENTS.every(field => values[field] != null);
  const production = completeProduction
    ? COMPONENTS.reduce((sum, field) => sum + values[field], 0) : null;
  if (production != null) metric('Total produktion (DK)', production);

  if (values.OnshoreWindPower != null && values.OffshoreWindPower != null) {
    metric('Vindproduktion (DK)', values.OnshoreWindPower + values.OffshoreWindPower);
  }
  if (values.SolarPower != null) metric('Solproduktion (DK)', values.SolarPower);

  if (production != null && values.Exchange_Sum != null) {
    // Energinet's live overview derives load from production plus net exchange.
    metric('Beräknad förbrukning (DK, SCADA)', production + values.Exchange_Sum);
  }
  if (values.Exchange_Sum != null) metric('Nettoflöde (DK, SCADA)', values.Exchange_Sum);
  if (values.CO2Emission != null) metric('CO2-intensitet (DK)', values.CO2Emission, 'g/kWh');

  if (!out.length) throw new Error('PowerSystemRightNow: latest row contains no usable measurements');
  return out;
}

export default {
  id: 'energinet-live',
  name: 'Energinet PowerSystemRightNow (1 min)',
  area: 1,
  country: 'DK',
  every: 300,
  fetch: async () => {
    const url = `${BASE}/PowerSystemRightNow?start=now-PT15M&sort=Minutes1UTC%20desc&limit=5`;
    const payload = await jjson(url);
    return normalizePowerSystemRows(payload);
  },
};
