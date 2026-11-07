import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('collector records and source health survive a process restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'northwatch-store-'));
  const file = path.join(dir, 'store.json');
  const previous = process.env.NORTHWATCH_STORE_FILE;
  const previousDriver = process.env.STORE_DRIVER;
  process.env.STORE_DRIVER = 'local';
  process.env.NORTHWATCH_STORE_FILE = file;
  try {
    const { state, registerSource, setResult, initStore, flushStore } = await import('../lib/store.js?local-persistence-test');
    state.sources.clear();
    registerSource({ id: 'test-source', name: 'Test source', area: 1, country: 'SE', every: 60 });
    const records = [{ t: 'm', area: 1, country: 'SE', source: 'test-source', indicator: 'test', value: 42, unit: 'n', ts: '2026-11-07T00:00:00.000Z' }];
    setResult('test-source', records, 12);
    const expectedLastOk = state.sources.get('test-source').lastOk;
    await flushStore();

    state.sources.clear();
    registerSource({ id: 'test-source', name: 'Test source', area: 1, country: 'SE', every: 60 });
    await initStore();

    const restored = state.sources.get('test-source');
    assert.deepEqual(restored.records, records);
    assert.equal(restored.lastOk, expectedLastOk);
    assert.equal(restored.ms, 12);
    assert.equal(restored.status, 'stale');
  } finally {
    state.sources.clear();
    if (previous === undefined) delete process.env.NORTHWATCH_STORE_FILE;
    else process.env.NORTHWATCH_STORE_FILE = previous;
    if (previousDriver === undefined) delete process.env.STORE_DRIVER;
    else process.env.STORE_DRIVER = previousDriver;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
