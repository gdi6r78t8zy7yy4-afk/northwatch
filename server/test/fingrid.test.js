import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLatestData } from '../collectors/fingrid.js';

test('Fingrid latest response normalizes production and consumption with interval end time', () => {
  const row = normalizeLatestData(192, 'Total produktion (FI)', {
    datasetId: 192,
    startTime: '2026-11-07T08:30:00.000Z',
    endTime: '2026-11-07T08:33:00.000Z',
    value: 10115.4,
  });
  assert.deepEqual(row, {
    t: 'm', area: 1, country: 'FI', source: 'fingrid',
    indicator: 'Total produktion (FI)', value: 10115.4,
    unit: 'MW', ts: '2026-11-07T08:33:00.000Z',
  });
});

test('Fingrid latest response selects the newest row from an array or data envelope', () => {
  const row = normalizeLatestData(193, 'Total förbrukning (FI)', { data: [
    { startTime: '2026-11-07T08:24:00.000Z', endTime: '2026-11-07T08:27:00.000Z', value: 11000 },
    { startTime: '2026-11-07T08:27:00.000Z', endTime: '2026-11-07T08:30:00.000Z', value: 11200 },
  ] });
  assert.equal(row.value, 11200);
  assert.equal(row.ts, '2026-11-07T08:30:00.000Z');
  assert.equal(row.indicator, 'Total förbrukning (FI)');
});

test('Fingrid latest response accepts a numeric string but rejects missing values', () => {
  const row = normalizeLatestData(192, 'Production', {
    timestamp: '2026-11-07T08:33:00Z', value: '10100.5',
  });
  assert.equal(row.value, 10100.5);
  assert.throws(() => normalizeLatestData(192, 'Production', {
    timestamp: '2026-11-07T08:33:00Z', value: null,
  }), /missing or invalid value/);
});

test('Fingrid latest response rejects missing timestamps instead of inventing one', () => {
  assert.throws(() => normalizeLatestData(193, 'Consumption', {
    value: 12000,
  }), /missing or invalid timestamp/);
  assert.throws(() => normalizeLatestData(193, 'Consumption', []), /empty latest response/);
});


test('Fingrid defaults include total production/consumption and separately identified generation types', async () => {
  const { configuredDatasets } = await import('../collectors/fingrid.js');
  assert.deepEqual(configuredDatasets(''), [
    [192, 'Total produktion (FI)'],
    [193, 'Total förbrukning (FI)'],
    [181, 'Vindproduktion (FI)'],
    [191, 'Vattenkraftproduktion (FI)'],
    [188, 'Kärnkraftsproduktion (FI)'],
    [202, 'Industriell kraftvärmeproduktion (FI)'],
  ]);
});

test('Fingrid custom dataset configuration continues to override defaults', async () => {
  const { configuredDatasets } = await import('../collectors/fingrid.js');
  assert.deepEqual(configuredDatasets('74:Historisk produktion,181:Vindkraft'), [
    [74, 'Historisk produktion'],
    [181, 'Vindkraft'],
  ]);
  assert.throws(() => configuredDatasets('bad:Missing id'), /Ogiltig FINGRID_DATASETS-post/);
});
