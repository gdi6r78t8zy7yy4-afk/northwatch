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


test('historical baseline flags a material deviation but does not invent an incident', () => {
  const history = Array.from({ length: 12 }, (_, i) => ({
    t:'m', country:'SE', source:'svk', indicator:'Load', unit:'MW',
    value:1000 + (i % 2), ts:new Date(Date.parse('2026-11-06T00:00:00Z') + i * 3600_000).toISOString(),
  }));
  history.push({ ...history.at(-1), value:1600, ts:'2026-11-07T00:00:00Z' });
  const result = buildEnergyAnalysis([], '2026-11-07T00:01:00Z', history);
  const observation = result.observations.find(o => o.category === 'anomaly');
  assert.ok(observation);
  assert.equal(observation.confidence, 'medium');
  assert.match(observation.caveat, /not evidence of an outage/);
  assert.equal(observation.evidence.length, 3);
});

test('price spread requires identical timestamps and units', () => {
  const rows = [
    { t:'m', country:'SE', source:'entsoe', indicator:'Dag-ahead-pris SE', value:40, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
    { t:'m', country:'FI', source:'entsoe', indicator:'Dag-ahead-pris FI', value:80, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
  ];
  const result = buildEnergyAnalysis(rows);
  assert.ok(result.observations.some(o => o.id === 'nordic-day-ahead-price-spread'));
  const mismatched = buildEnergyAnalysis([{ ...rows[0] }, { ...rows[1], ts:'2026-11-07T10:15:00Z' }]);
  assert.ok(!mismatched.observations.some(o => o.id === 'nordic-day-ahead-price-spread'));
});

test('range parser only accepts supported time windows', () => {
  assert.equal(parseEnergyRange('7d', 0).range, '7d');
  assert.equal(parseEnergyRange('invalid', 0).range, '24h');
});

test('domestic production-demand analysis is country-generic and requires exact alignment', () => {
  const rows = [
    { t:'m', country:'NO', indicator:'Total produktion (NO)', value:18000, unit:'MW', ts:'2026-11-07T10:00:00Z', source:'statnett' },
    { t:'m', country:'NO', indicator:'Total förbrukning (NO)', value:19000, unit:'MW', ts:'2026-11-07T10:00:00Z', source:'statnett' },
    { t:'m', country:'FI', indicator:'Total produktion (FI)', value:9000, unit:'MW', ts:'2026-11-07T10:00:00Z', source:'fingrid' },
    { t:'m', country:'FI', indicator:'Total förbrukning (FI)', value:8500, unit:'MW', ts:'2026-11-07T09:45:00Z', source:'fingrid' },
  ];
  const balances = buildEnergyAnalysis(rows).observations.filter(o => o.category === 'balance');
  assert.equal(balances.length, 1);
  assert.equal(balances[0].country, 'NO');
  assert.equal(balances[0].id, 'no-domestic-balance');
  assert.match(balances[0].title, /below demand/);
  assert.equal(balances[0].evidence[0].value - balances[0].evidence[1].value, -1000);
});


test('historical baseline ignores stale and future-dated latest samples', () => {
  const base = Array.from({ length: 12 }, (_, i) => ({
    t:'m', country:'SE', source:'svk', indicator:'Load', unit:'MW',
    value:1000 + (i % 2), ts:new Date(Date.parse('2026-11-06T00:00:00Z') + i * 3600_000).toISOString(),
  }));
  const deviation = { ...base.at(-1), value:1600 };
  const stale = [...base, { ...deviation, ts:'2026-11-07T00:00:00Z' }];
  const future = [...base, { ...deviation, ts:'2026-11-07T02:00:00Z' }];
  assert.equal(buildEnergyAnalysis([], '2026-11-07T10:00:00Z', stale).observations
    .filter(item => item.category === 'anomaly').length, 0);
  assert.equal(buildEnergyAnalysis([], '2026-11-07T01:00:00Z', future).observations
    .filter(item => item.category === 'anomaly').length, 0);
});

test('historical baseline freshness follows the series median sampling interval', () => {
  const history = Array.from({ length: 12 }, (_, i) => ({
    t:'m', country:'SE', source:'svk', indicator:'Load', unit:'MW',
    value:1000 + (i % 2), ts:new Date(Date.parse('2026-11-07T00:00:00Z') + i * 3600_000).toISOString(),
  }));
  history.push({ ...history.at(-1), value:1600, ts:'2026-11-07T12:00:00Z' });
  const result = buildEnergyAnalysis([], '2026-11-07T13:00:00Z', history);
  assert.ok(result.observations.some(item => item.category === 'anomaly'));
});
