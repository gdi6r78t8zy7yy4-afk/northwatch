// Elprisetjustnu.se – public Swedish day-ahead spot prices, SE1–SE4.
// No API key. Native intervals are hourly before 2025-10-01 and 15-minute
// intervals from 2025-10-01 (96 rows/day). Prices exclude VAT, markups and tax.
// API returns SEK/kWh, EUR/kWh, exchange rate and ISO 8601 delivery intervals.
// Public display should credit https://www.elprisetjustnu.se.
import { jjson } from '../lib/http.js';

const BASE = 'https://www.elprisetjustnu.se/api/v1/prices';
const ZONES = ['SE1', 'SE2', 'SE3', 'SE4'];

function stockholmDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addCalendarDays(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')].join('-');
}

export function normalizePriceRows(zone, rows) {
  if (!ZONES.includes(zone)) throw new Error(`Elprisetjustnu: invalid bidding zone ${zone}`);
  if (!Array.isArray(rows)) throw new Error(`Elprisetjustnu ${zone}: response must be an array`);
  return rows.map(row => {
    const value = Number(row?.SEK_per_kWh);
    const start = row?.time_start;
    const end = row?.time_end;
    if (row?.SEK_per_kWh == null || !Number.isFinite(value)) {
      throw new Error(`Elprisetjustnu ${zone}: missing or invalid SEK_per_kWh`);
    }
    if (typeof start !== 'string' || !Number.isFinite(Date.parse(start)) ||
        typeof end !== 'string' || !Number.isFinite(Date.parse(end)) ||
        Date.parse(end) <= Date.parse(start)) {
      throw new Error(`Elprisetjustnu ${zone}: invalid delivery interval`);
    }
    return {
      t: 'm', area: 1, country: 'SE', source: 'elprisetjustnu',
      indicator: `Dag-ahead-pris ${zone}`, value,
      unit: 'SEK/kWh', ts: start,
    };
  }).sort((a, b) => a.ts.localeCompare(b.ts));
}

async function fetchDate(date) {
  const [year, month, day] = date.split('-');
  const results = await Promise.allSettled(ZONES.map(async zone => {
    const rows = await jjson(`${BASE}/${year}/${month}-${day}_${zone}.json`);
    return normalizePriceRows(zone, rows);
  }));
  const records = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') records.push(...result.value);
    else errors.push(`${ZONES[index]}: ${result.reason?.message ?? 'unknown error'}`);
  });
  return { records, errors };
}

export default {
  id: 'elprisetjustnu',
  name: 'Elprisetjustnu.se',
  area: 1,
  country: 'SE',
  every: 900,
  fetch: async () => {
    // API dates are Swedish civil dates, not UTC dates. Tomorrow's prices
    // are normally published after 13:00; a 404 is expected before then.
    const today = stockholmDate();
    const tomorrow = addCalendarDays(today, 1);
    const [current, next] = await Promise.all([fetchDate(today), fetchDate(tomorrow)]);
    const records = [...current.records, ...next.records];
    if (!records.length) {
      const detail = [...current.errors, ...next.errors].slice(0, 4).join('; ');
      throw new Error(`Elprisetjustnu: no price intervals returned${detail ? ` (${detail})` : ''}`);
    }
    return records;
  },
};
