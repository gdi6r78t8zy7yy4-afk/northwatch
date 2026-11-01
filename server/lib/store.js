// Minnesbaserat lager: normaliserade poster + källhälsa.
// Posttyper:
//   metric { t:'m', area, country, source, indicator, value, unit, ts }
//   event  { t:'e', area, country, source, kind, severity, title, detail, start, end?, geo? }
//   asset  { t:'a', area, country, source, type, name, id?, geometry, attrs?, updated }
import { now } from './http.js';

export const state = { startedAt: now(), sources: new Map() };

export function registerSource(cfg) {
  const s = {
    ...cfg,
    status: 'running',
    records: [],
    lastRun: null,
    lastOk: null,
    lastError: null,
    error: null,
    ms: null,
  };
  state.sources.set(cfg.id, s);
  return s;
}

export function setResult(id, records, ms) {
  const s = state.sources.get(id);
  s.records = records;
  s.status = 'ok';
  s.lastOk = now();
  s.lastRun = now();
  s.ms = ms;
  s.error = null;
}

export function setError(id, err, ms) {
  const s = state.sources.get(id);
  s.status = 'error';
  s.error = String(err?.message ?? err);
  s.lastError = now();
  s.lastRun = now();
  s.ms = ms;
}

export function setNoKey(id, envName) {
  const s = state.sources.get(id);
  s.status = 'no_key';
  s.error = `Saknar ${envName}`;
  s.lastRun = now();
}

// 'ok' som ligger längre tillbaka än 3× pollintervallet räknas som 'stale'.
export function sourceStatus(s) {
  if (s.status === 'ok' && s.lastOk && Date.now() - new Date(s.lastOk).getTime() > s.every * 3000) return 'stale';
  return s.status;
}

export function healthList() {
  return [...state.sources.values()].map(s => ({
    id: s.id,
    name: s.name,
    area: s.area,
    country: s.country,
    every: s.every,
    status: sourceStatus(s),
    lastOk: s.lastOk,
    lastError: s.lastError,
    lastRun: s.lastRun,
    ms: s.ms,
    error: s.error,
  }));
}

// Sammanställ status per cell (område × land): värst-vinnare.
// error > no_key > stale > ok; 'none' om inga källor.
const RANK = { error: 4, no_key: 3, stale: 2, running: 1, ok: 1, none: 0 };

export function cellStatus(sources) {
  if (!sources.length) return 'none';
  let worst = 'ok';
  for (const s of sources) {
    const st = sourceStatus(s);
    if (RANK[st] > RANK[worst]) worst = st;
    if (worst === 'error') break;
  }
  return worst;
}

export function areaSources(areaId) {
  return [...state.sources.values()].filter(s => s.area === areaId);
}

export function areaStatus(areaId) {
  const srcs = areaSources(areaId);
  if (!srcs.length) return 'none';
  return cellStatus(srcs);
}
