import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from '../lib/persistence.js';
import { buildEnergyHistory, buildEnergyAnalysis, parseEnergyRange } from '../lib/energy-insights.js';

test('energy history persists unique measurements and reloads after restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'northwatch-energy-history-'));
  const previous = process.env.NORTHWATCH_ENERGY_HISTORY_FILE;
  process.env.NORTHWATCH_ENERGY_HISTORY_FILE = path.join(dir, 'history.jsonl');
  try {
    const first = createPersistence();
    const record = { t:'m', area:1, country:'DK', source:'eds', indicator:'Total produktion (DK)', value:4200, unit:'MW', ts:'2026-11-07T09:00:00.000Z' };
    await first.saveEnergyMeasurements([record, record]);
    await first.flush();
    const second = createPersistence();
    assert.deepEqual(await second.loadEnergyMeasurements({ from:'2026-11-07T08:00:00.000Z', to:'2026-11-07T10:00:00.000Z' }), [record]);
  } finally {
    if (previous === undefined) delete process.env.NORTHWATCH_ENERGY_HISTORY_FILE;
    else process.env.NORTHWATCH_ENERGY_HISTORY_FILE = previous;
    await fs.rm(dir, { recursive:true, force:true });
  }
});

test('history groups distinct series and sorts points by measurement time', () => {
  const records = [
    { t:'m', country:'DK', indicator:'Load', value:3, unit:'MW', source:'eds', ts:'2026-11-07T09:15:00Z' },
    { t:'m', country:'DK', indicator:'Load', value:2, unit:'MW', source:'eds', ts:'2026-11-07T09:00:00Z' },
    { t:'m', country:'SE', indicator:'Load', value:1, unit:'MW', source:'svk', ts:'2026-11-07T09:00:00Z' },
  ];
  const result = buildEnergyHistory(records, { country:'DK', range:'24h' });
  assert.equal(result.count, 2);
  assert.deepEqual(result.series[0].points.map(p => p.value), [2,3]);
});

test('analysis only compares generation and demand with matching timestamp and unit', () => {
  const rows = [
    { t:'m', country:'DK', indicator:'Total produktion (DK)', value:4000, unit:'MW', ts:'2026-11-07T09:00:00Z', source:'eds' },
    { t:'m', country:'DK', indicator:'Total förbrukning (DK)', value:4500, unit:'MW', ts:'2026-11-07T09:00:00Z', source:'eds' },
  ];
  const result = buildEnergyAnalysis(rows);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].severity, 'medium');
  assert.match(result.observations[0].caveat, /not a system adequacy assessment/);
  assert.equal(buildEnergyAnalysis([{ ...rows[1], ts:'2026-11-07T09:15:00Z' }]).observations.length, 0);
});

test('range parser only accepts supported time windows', () => {
  assert.equal(parseEnergyRange('7d', 0).range, '7d');
  assert.equal(parseEnergyRange('invalid', 0).range, '24h');
});
