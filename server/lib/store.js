// Minnesbaserat lager: normaliserade poster + källhälsa.
// Posttyper:
//   metric { t:'m', area, country, source, indicator, value, unit, ts }
//   event  { t:'e', area, country, source, kind, severity, title, detail, start, end?, geo? }
//   asset  { t:'a', area, country, source, type, name, id?, geometry, attrs?, updated }
import { now } from './http.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const state = { startedAt: now(), sources: new Map() };

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = () => process.env.NORTHWATCH_STORE_FILE
  || path.join(moduleDir, '..', 'data', 'store.json');
let writeQueue = Promise.resolve();
let persistenceWarning = null;

function serializableSource(s) {
  return {
    id: s.id, name: s.name, area: s.area, country: s.country, every: s.every,
    status: s.status, records: s.records, lastRun: s.lastRun, lastOk: s.lastOk,
    lastError: s.lastError, error: s.error, ms: s.ms,
  };
}

function scheduleSnapshot() {
  const snapshot = JSON.stringify({
    version: 1,
    savedAt: now(),
    sources: [...state.sources.values()].map(serializableSource),
  });
  const target = snapshotPath();
  writeQueue = writeQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, snapshot, { mode: 0o600 });
    await fs.promises.rename(temp, target);
    persistenceWarning = null;
  }).catch(error => {
    persistenceWarning = String(error?.message ?? error);
    console.error('[store] persistence failed:', persistenceWarning);
  });
  return writeQueue;
}

// Local/VM persistence. The snapshot is written atomically and contains the
// last successful records plus source health. For Cloud Run use a network DB
// (e.g. Firestore); the container filesystem is not durable across instances.
export async function flushStore() {
  await writeQueue;
}

export async function initStore() {
  try {
    const raw = await fs.promises.readFile(snapshotPath(), 'utf8');
    const snapshot = JSON.parse(raw);
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.sources)) return;
    for (const saved of snapshot.sources) {
      const current = state.sources.get(saved.id);
      if (!current) continue;
      current.records = Array.isArray(saved.records) ? saved.records : [];
      current.status = saved.status === 'ok' ? 'stale' : (saved.status ?? 'stale');
      current.lastRun = saved.lastRun ?? null;
      current.lastOk = saved.lastOk ?? null;
      current.lastError = saved.lastError ?? null;
      current.error = saved.error ?? null;
      current.ms = saved.ms ?? null;
    }
    console.log(`[store] restored ${snapshot.sources.length} source snapshots from disk`);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      persistenceWarning = String(error?.message ?? error);
      console.error('[store] unable to restore snapshot:', persistenceWarning);
    }
  }
}

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
  scheduleSnapshot();
}

export function setError(id, err, ms) {
  const s = state.sources.get(id);
  s.status = 'error';
  s.error = String(err?.message ?? err);
  s.lastError = now();
  s.lastRun = now();
  s.ms = ms;
  scheduleSnapshot();
}

export function setNoKey(id, envName) {
  const s = state.sources.get(id);
  s.status = 'no_key';
  s.error = `Saknar ${envName}`;
  s.lastRun = now();
  scheduleSnapshot();
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
