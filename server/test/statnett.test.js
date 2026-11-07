import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductionConsumption } from '../collectors/statnett.js';

const start = Date.parse('2026-11-05T00:00:00.000Z');

test('Statnett normalizes latest hourly national production and consumption values', () => {
  const records = normalizeProductionConsumption({ StartPointUTC: start,
    EndPointUTC: start + 2 * 3600000, PeriodTickMs: 3600000,
    Production: [15000, 15200, 15400], Consumption: [14000, 14500, 14900] });
  assert.deepEqual(records, [
    { t: 'm', area: 1, country: 'NO', source: 'statnett', indicator: 'Total produktion (NO)',
      value: 15400, unit: 'MW', ts: '2026-11-05T02:00:00.000Z' },
    { t: 'm', area: 1, country: 'NO', source: 'statnett', indicator: 'Total förbrukning (NO)',
      value: 14900, unit: 'MW', ts: '2026-11-05T02:00:00.000Z' },
  ]);
});

test('Statnett skips trailing missing samples and uses the last valid timestamp', () => {
  const records = normalizeProductionConsumption({ StartPointUTC: start, PeriodTickMs: 3600000,
    Production: [12000, 12500, null], Consumption: [11000, 11200, ''] });
  assert.equal(records[0].value, 12500);
  assert.equal(records[0].ts, '2026-11-05T01:00:00.000Z');
  assert.equal(records[1].value, 11200);
  assert.equal(records[1].ts, '2026-11-05T01:00:00.000Z');
});

test('Statnett rejects malformed envelopes and series without valid values', () => {
  assert.throws(() => normalizeProductionConsumption({}), /invalid time-series envelope/);
  assert.throws(() => normalizeProductionConsumption({ StartPointUTC: start, PeriodTickMs: 3600000,
    Production: [null, 'bad'], Consumption: [10000] }), /no valid values for Total produktion/);
});
