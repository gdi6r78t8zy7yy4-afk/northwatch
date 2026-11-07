import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('Firestore adapter round-trips source snapshots through the emulator', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  process.env.STORE_DRIVER = 'firestore';
  process.env.GOOGLE_CLOUD_PROJECT ||= 'northwatch-emulator-test';
  const { createPersistence } = await import('../lib/persistence.js?firestore-emulator-test');
  const persistence = createPersistence();
  const id = `test-${randomUUID()}`;
  const source = {
    id, name: 'Emulator test', area: 1, country: 'SE', every: 60,
    status: 'ok', lastRun: new Date().toISOString(), lastOk: new Date().toISOString(),
    lastError: null, error: null, ms: 12,
    records: [{ t: 'm', area: 1, country: 'SE', source: id, indicator: 'round-trip', value: 7, unit: 'n', ts: new Date().toISOString() }],
  };
  await persistence.saveSource(source);
  await persistence.flush();
  const restored = (await persistence.loadSources()).find(item => item.id === id);
  assert.ok(restored);
  assert.equal(restored.status, 'ok');
  assert.deepEqual(restored.records, source.records);
});
