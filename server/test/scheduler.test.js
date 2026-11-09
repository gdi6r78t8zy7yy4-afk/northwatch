// Test för scheduler:s setTimeout-klamp (M11): månadstakter (2 592 000 s)
// ger every*1000 = 2 592 000 000 ms som inte ryms i 32 bitar – Node clampar
// annars timern till 1 ms och källan pollas back-to-back i stället för
// månatligen. Loop-fördröjningen ska därför klämas till 2^31-1 ms, medan
// kortare takter (t.ex. vecko) får sin exakta delay. setTimeout mockas bara
// medan varje test drivs, och timrarna drivs manuellt – inget väntande.
//
// Kör: node --test server/test/scheduler.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), `northwatch-scheduler-${process.pid}`);
const previousFile = process.env.NORTHWATCH_STORE_FILE;
process.env.NORTHWATCH_STORE_FILE = path.join(dir, 'store.json');

const realSetTimeout = globalThis.setTimeout;
const scheduled = [];

const { registerSource, state, flushStore } = await import('../lib/store.js');
const { startScheduler } = await import('../lib/scheduler.js');

after(async () => {
  globalThis.setTimeout = realSetTimeout;
  state.sources.clear();
  if (previousFile === undefined) delete process.env.NORTHWATCH_STORE_FILE;
  else process.env.NORTHWATCH_STORE_FILE = previousFile;
  await flushStore();
  await fs.rm(dir, { recursive: true, force: true });
});

// Driv en kollektor genom: staggerad förstakörning → loop (25 s) → reschedule.
// Returnerar reschedule-delay:n (den som repeteras med källans takt).
async function rescheduledDelay(cfg) {
  scheduled.length = 0;
  globalThis.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    return { fn, delay };
  };
  try {
    const collector = { ...cfg, fetch: async () => [] };
    registerSource(collector);
    startScheduler([collector]);
    assert.equal(scheduled.length, 1, 'endast staggerad förstakörning');
    scheduled[0].fn();
    assert.equal(scheduled.length, 2, 'första loop-iterationen efter 25 s');
    assert.equal(scheduled[1].delay, 25000);
    scheduled[1].fn();
    await new Promise(r => realSetTimeout(r, 0)); // låt run(c) löpa färdigt
    assert.equal(scheduled.length, 3, 'loop reskedulerar med källans takt');
    return scheduled[2].delay;
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

test('månadstakt (2 592 000 s) → loop-delay kläms till 2^31-1 ms', async () => {
  const delay = await rescheduledDelay({
    id: 'sched-monthly', name: 'Monthly test', area: 12, country: 'NORDIC', every: 2592000,
  });
  assert.equal(delay, 2147483647);
});

test('veckotakt (604 800 s) → exakt delay, oklämd', async () => {
  const delay = await rescheduledDelay({
    id: 'sched-weekly', name: 'Weekly test', area: 12, country: 'FI', every: 604800,
  });
  assert.equal(delay, 604800000);
});
