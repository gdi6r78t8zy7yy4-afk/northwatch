// Normalized in-memory read model backed by a pluggable durable persistence adapter.
// Record types:
//   metric { t:'m', area, country, source, indicator, value, unit, ts }
//   event  { t:'e', area, country, source, kind, severity, title, detail, start, end?, geo? }
//   asset  { t:'a', area, country, source, type, name, id?, geometry, attrs?, updated }
import { now } from './http.js';
import { createPersistence } from './persistence.js';

export const state = { startedAt: now(), sources: new Map() };
const persistence = createPersistence();

function serializableSource(source) {
  return {
    id: source.id, name: source.name, area: source.area, country: source.country, every: source.every,
    status: source.status, records: source.records, lastRun: source.lastRun, lastOk: source.lastOk,
    lastError: source.lastError, error: source.error, ms: source.ms,
  };
}

function persistSource(id) {
  const source = state.sources.get(id);
  if (!source) return Promise.resolve();
  return persistence.saveSource(serializableSource(source));
}

export async function loadEnergyMeasurements(range) {
  return persistence.loadEnergyMeasurements(range);
}

export async function flushStore() {
  await persistence.flush();
}

export async function initStore() {
  try {
    const savedSources = await persistence.loadSources();
    let restored = 0;
    for (const saved of savedSources) {
      const current = state.sources.get(saved.id);
      if (!current) continue;
      current.records = Array.isArray(saved.records) ? saved.records : [];
      current.status = saved.status === 'ok' ? 'stale' : (saved.status ?? 'stale');
      current.lastRun = saved.lastRun ?? null;
      current.lastOk = saved.lastOk ?? null;
      current.lastError = saved.lastError ?? null;
      current.error = saved.error ?? null;
      current.ms = saved.ms ?? null;
      restored++;
    }
    console.log(`[store] restored ${restored} source snapshots using ${persistence.driver} persistence`);
  } catch (error) {
    console.error(`[store] ${persistence.driver} restore failed:`, error?.message ?? error);
    if ((process.env.STORE_REQUIRED || 'false').toLowerCase() === 'true') throw error;
  }
}

export function registerSource(cfg) {
  const source = {
    ...cfg, status: 'running', records: [], lastRun: null, lastOk: null,
    lastError: null, error: null, ms: null,
  };
  state.sources.set(cfg.id, source);
  return source;
}

export function setResult(id, records, ms) {
  const source = state.sources.get(id);
  if (!source) throw new Error(`Unknown collector: ${id}`);
  source.records = records;
  if (source.area === 1) {
    const measurements = records.filter(record => record.t === 'm' && record.ts && Number.isFinite(Number(record.value)));
    if (measurements.length) void persistence.saveEnergyMeasurements(measurements);
  }
  source.status = 'ok';
  source.lastOk = now();
  source.lastRun = source.lastOk;
  source.ms = ms;
  source.error = null;
  void persistSource(id);
}

export function setError(id, err, ms) {
  const source = state.sources.get(id);
  if (!source) throw new Error(`Unknown collector: ${id}`);
  source.status = 'error';
  source.error = String(err?.message ?? err);
  source.lastError = now();
  source.lastRun = source.lastError;
  source.ms = ms;
  void persistSource(id);
}

export function setNoKey(id, envName) {
  const source = state.sources.get(id);
  if (!source) throw new Error(`Unknown collector: ${id}`);
  source.status = 'no_key';
  source.error = `Saknar ${envName}`;
  source.lastRun = now();
  void persistSource(id);
}

// An 'ok' older than three polling intervals is exposed as stale.
export function sourceStatus(source) {
  if (source.status === 'ok' && source.lastOk && Date.now() - new Date(source.lastOk).getTime() > source.every * 3000) return 'stale';
  return source.status;
}

export function healthList() {
  return [...state.sources.values()].map(source => ({
    id: source.id, name: source.name, area: source.area, country: source.country,
    every: source.every, status: sourceStatus(source), lastOk: source.lastOk,
    lastError: source.lastError, lastRun: source.lastRun, ms: source.ms, error: source.error,
  }));
}

// Worst status wins: error > no_key > stale > ok.
const RANK = { error: 4, no_key: 3, stale: 2, running: 1, ok: 1, none: 0 };

export function cellStatus(sources) {
  if (!sources.length) return 'none';
  let worst = 'ok';
  for (const source of sources) {
    const status = sourceStatus(source);
    if (RANK[status] > RANK[worst]) worst = status;
    if (worst === 'error') break;
  }
  return worst;
}

export function areaSources(areaId) {
  return [...state.sources.values()].filter(source => source.area === areaId);
}

export function areaStatus(areaId) {
  const sources = areaSources(areaId);
  if (!sources.length) return 'none';
  return cellStatus(sources);
}
