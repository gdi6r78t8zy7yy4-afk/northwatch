import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductionConsumption } from '../collectors/statnett.js';

// Live-form 2026-11-10: endpointen svarar dagsbuketer (PeriodTickMs = 86 400 000)
// med nationella MWh-summor. Fixturen använder samma form med syntetiska värden.
const DAY = 86_400_000;
const dayStart = Date.parse('2026-11-07T00:00:00.000Z');

test('Statnett daily buckets normalize to MWh/dygn with the bucket start as ts', () => {
  const now = dayStart + 2 * DAY + 5 * 3_600_000; // mitt på dag 3 → dag 3 bukett partiell
  const records = normalizeProductionConsumption({
    StartPointUTC: dayStart, EndPointUTC: dayStart + 3 * DAY, PeriodTickMs: DAY,
    Production: [471669, 519813, 100009], Consumption: [415762, 433211, 82286],
  }, now);
  assert.deepEqual(records, [
    { t: 'm', area: 1, country: 'NO', source: 'statnett', indicator: 'Total produktion (NO)',
      value: 519813, unit: 'MWh/dygn', ts: '2026-11-08T00:00:00.000Z' },
    { t: 'm', area: 1, country: 'NO', source: 'statnett', indicator: 'Total förbrukning (NO)',
      value: 433211, unit: 'MWh/dygn', ts: '2026-11-08T00:00:00.000Z' },
  ]);
});

test('Statnett never reports the partial current-day bucket', () => {
  const now = dayStart + DAY + 60_000; // bara 1 minut in på dag 2 – den är partiell
  const records = normalizeProductionConsumption({
    StartPointUTC: dayStart, PeriodTickMs: DAY,
    Production: [471669, 3], Consumption: [415762, 1],
  }, now);
  assert.equal(records[0].value, 471669); // senaste HELT avslutade dygn
  assert.equal(records[1].value, 415762);
});

test('Statnett throws when only incomplete buckets exist', () => {
  const now = dayStart + 60_000; // dag 1 är ännu inte avslutad
  assert.throws(() => normalizeProductionConsumption({
    StartPointUTC: dayStart, PeriodTickMs: DAY, Production: [471669], Consumption: [415762],
  }, now), /no valid values for Total produktion/);
});

test('Statnett hourly envelopes (if upstream changes) keep MW semantics', () => {
  const hourStart = Date.parse('2026-11-05T00:00:00.000Z');
  const records = normalizeProductionConsumption({ StartPointUTC: hourStart,
    EndPointUTC: hourStart + 2 * 3_600_000, PeriodTickMs: 3_600_000,
    Production: [15000, 15200, 15400], Consumption: [14000, 14500, 14900] },
  hourStart + 3 * 3_600_000);
  assert.equal(records[0].value, 15400);
  assert.equal(records[0].unit, 'MW');
  assert.equal(records[0].ts, '2026-11-05T02:00:00.000Z');
});

test('Statnett skips trailing missing samples and uses the last valid completed timestamp', () => {
  const hourStart = Date.parse('2026-11-05T00:00:00.000Z');
  const records = normalizeProductionConsumption({ StartPointUTC: hourStart, PeriodTickMs: 3_600_000,
    Production: [12000, 12500, null], Consumption: [11000, 11200, ''] },
  hourStart + 4 * 3_600_000);
  assert.equal(records[0].value, 12500);
  assert.equal(records[0].ts, '2026-11-05T01:00:00.000Z');
  assert.equal(records[1].value, 11200);
  assert.equal(records[1].ts, '2026-11-05T01:00:00.000Z');
});

test('Statnett rejects malformed envelopes and series without valid values', () => {
  assert.throws(() => normalizeProductionConsumption({}), /invalid time-series envelope/);
  assert.throws(() => normalizeProductionConsumption({ StartPointUTC: dayStart, PeriodTickMs: DAY,
    Production: [null, 'bad'], Consumption: [10000] }, dayStart + 5 * DAY), /no valid values for Total produktion/);
});
