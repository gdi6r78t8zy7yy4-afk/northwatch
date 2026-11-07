// Landsnet Amper – latest Icelandic generation mix (MW).
// Public endpoint referenced by the Electricity Maps Landsnet parser.
// The upstream parser treats naive timestamps as Atlantic/Reykjavik local time;
// Iceland remains on UTC year-round, so a naive timestamp is normalized as UTC.
// This endpoint exposes generation components only: no demand is synthesized.
import { jjson } from '../lib/http.js';

const URL = process.env.LANDSNET_API_URL ||
  'https://amper.landsnet.is/generation/api/Values';

function numeric(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input);
  const date = new Date(hasZone ? input : input + 'Z');
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeLandsnet(payload) {
  const ts = normalizeTimestamp(payload?.timestamp);
  if (!ts) throw new Error('Landsnet Amper: invalid or missing timestamp');

  const geothermal = numeric(payload?.geothermal);
  const hydro = numeric(payload?.hydro);
  const oil = numeric(payload?.oil);
  const out = [];
  const metric = (indicator, value) => out.push({
    t: 'm', area: 1, country: 'IS', source: 'landsnet',
    indicator, value, unit: 'MW', ts,
  });

  if (geothermal != null) metric('Geotermisk produktion (IS)', geothermal);
  if (hydro != null) metric('Vattenkraftproduktion (IS)', hydro);
  if (oil != null) metric('Oljeproduktion (IS)', oil);
  if (geothermal != null && hydro != null) {
    metric('Förnybar produktion (IS)', geothermal + hydro);
  }
  if (geothermal != null && hydro != null && oil != null) {
    metric('Total produktion (IS)', geothermal + hydro + oil);
  }
  if (!out.length) throw new Error('Landsnet Amper: no usable generation measurements');
  return out;
}

export default {
  id: 'landsnet',
  name: 'Landsnet Amper (Iceland)',
  area: 1,
  country: 'IS',
  every: 300,
  fetch: async () => normalizeLandsnet(await jjson(URL)),
};
