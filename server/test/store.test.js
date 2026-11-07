import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { state, registerSource, setResult, initStore, flushStore } from '../lib/store.js';

test('collector records and source health survive a process restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'northwatch-store-'));
  const file = path.join(dir, 'store.json');
  const previous = process.env.NORTHWATCH_STORE_FILE;
  process.env.NORTHWATCH_STORE_FILE = file;
  try {
    state.sources.clear();
    registerSource({ id: 'test-source', name: 'Test source', area: 1, country: 'SE', every: 60 });
    const records = [{ t: 'm', area: 1, country: 'SE', source: 'test-source', indicator: 'test', value: 42, unit: 'n', ts: '2026-11-07T00:00:00.000Z' }];
    setResult('test-source', records, 12);
    await flushStore();

    state.sources.clear();
    registerSource({ id: 'test-source', name: 'Test source', area: 1, country: 'SE', every: 60 });
    await initStore();

    const restored = state.sources.get('test-source');
    assert.deepEqual(restored.records, records);
    assert.equal(restored.lastOk, '2026-11-07T00:00:00.000Z'.replace('2026-11-07T00:00:00.000Z', restored.lastOk));
    assert.equal(restored.ms, 12);
    assert.equal(restored.status, 'stale');
  } finally {
    state.sources.clear();
    if (previous === undefined) delete process.env.NORTHWATCH_STORE_FILE;
    else process.env.NORTHWATCH_STORE_FILE = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
