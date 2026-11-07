import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePriceRows } from '../collectors/elprisetjustnu.js';

test('Elprisetjustnu normalizes native quarter-hour prices and preserves the offset timestamp', () => {
  const records = normalizePriceRows('SE3', [
    { SEK_per_kWh: 0.8421, EUR_per_kWh: 0.073, EXR: 11.53,
      time_start: '2026-11-07T00:00:00+01:00', time_end: '2026-11-07T00:15:00+01:00' },
    { SEK_per_kWh: 0.9123, EUR_per_kWh: 0.079, EXR: 11.53,
      time_start: '2026-11-07T00:15:00+01:00', time_end: '2026-11-07T00:30:00+01:00' },
  ]);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    t: 'm', area: 1, country: 'SE', source: 'elprisetjustnu',
    indicator: 'Dag-ahead-pris SE3', value: 0.8421,
    unit: 'SEK/kWh', ts: '2026-11-07T00:00:00+01:00',
  });
  assert.equal(records[1].ts, '2026-11-07T00:15:00+01:00');
});

test('Elprisetjustnu accepts hourly historical intervals as well as quarter-hour intervals', () => {
  const records = normalizePriceRows('SE1', [{
    SEK_per_kWh: 0.5, time_start: '2024-02-01T00:00:00+01:00',
    time_end: '2024-02-01T01:00:00+01:00',
  }]);
  assert.equal(records.length, 1);
  assert.equal(records[0].unit, 'SEK/kWh');
});

test('Elprisetjustnu rejects unknown zones and malformed response payloads', () => {
  assert.throws(() => normalizePriceRows('NO1', []), /invalid bidding zone/);
  assert.throws(() => normalizePriceRows('SE2', {}), /response must be an array/);
});

test('Elprisetjustnu rejects missing prices and invalid delivery intervals', () => {
  assert.throws(() => normalizePriceRows('SE4', [{
    time_start: '2026-11-07T00:00:00Z', time_end: '2026-11-07T00:15:00Z',
  }]), /missing or invalid SEK_per_kWh/);
  assert.throws(() => normalizePriceRows('SE4', [{
    SEK_per_kWh: 0.2, time_start: 'not-a-date', time_end: '2026-11-07T00:15:00Z',
  }]), /invalid delivery interval/);
  assert.throws(() => normalizePriceRows('SE4', [{
    SEK_per_kWh: 0.2, time_start: '2026-11-07T00:15:00Z',
    time_end: '2026-11-07T00:00:00Z',
  }]), /invalid delivery interval/);
});
