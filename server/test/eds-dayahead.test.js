import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDayAheadRows, PRICE_ZONES } from '../collectors/eds-dayahead.js';

test('DayAheadPrices normalizes DK zones to DKK/kWh and NO2 to EUR/MWh', () => {
  const rows = normalizeDayAheadRows([
    { TimeUTC: '2026-11-11T13:15:00', PriceArea: 'DK1', DayAheadPriceDKK: 890.5, DayAheadPriceEUR: 119.4 },
    { TimeUTC: '2026-11-11T13:30:00', PriceArea: 'DK2', DayAheadPriceDKK: -42.0, DayAheadPriceEUR: -5.6 },
    { TimeUTC: '2026-11-11T13:15:00', PriceArea: 'NO2', DayAheadPriceDKK: 901.2, DayAheadPriceEUR: 120.8 },
  ]);
  assert.equal(rows.length, 3);
  const dk1 = rows.find(r => r.indicator === 'Dag-ahead-pris DK1');
  assert.deepEqual(dk1, {
    t: 'm', area: 1, country: 'DK', source: 'eds-dayahead',
    indicator: 'Dag-ahead-pris DK1', value: 0.8905, unit: 'DKK/kWh',
    ts: '2026-11-11T13:15:00.000Z',
  });
  const dk2 = rows.find(r => r.indicator === 'Dag-ahead-pris DK2');
  assert.equal(dk2.value, -0.042); // negativa spotpriser är giltiga
  const no2 = rows.find(r => r.indicator === 'Dag-ahead-pris NO2');
  assert.deepEqual(no2, {
    t: 'm', area: 1, country: 'NO', source: 'eds-dayahead',
    indicator: 'Dag-ahead-pris NO2', value: 120.8, unit: 'EUR/MWh',
    ts: '2026-11-11T13:15:00.000Z',
  });
});

test('DayAheadPrices ignores zones outside the Nordic scope and invalid rows', () => {
  const rows = normalizeDayAheadRows([
    { TimeUTC: '2026-11-11T13:15:00', PriceArea: 'DE', DayAheadPriceDKK: 700, DayAheadPriceEUR: 95 },
    { TimeUTC: '2026-11-11T13:15:00', PriceArea: 'SE3', DayAheadPriceDKK: 800, DayAheadPriceEUR: 105 },
    { TimeUTC: '2026-11-11T14:00:00', PriceArea: 'DK1', DayAheadPriceDKK: null, DayAheadPriceEUR: null },
    { TimeUTC: '', PriceArea: 'DK1', DayAheadPriceDKK: 500, DayAheadPriceEUR: 68 },
    { TimeUTC: 'not-a-date', PriceArea: 'DK2', DayAheadPriceDKK: 500, DayAheadPriceEUR: 68 },
  ]);
  assert.deepEqual(rows, []);
});

test('DayAheadPrices sorts records ascending by timestamp', () => {
  const rows = normalizeDayAheadRows([
    { TimeUTC: '2026-11-11T14:00:00', PriceArea: 'DK1', DayAheadPriceDKK: 900 },
    { TimeUTC: '2026-11-11T13:00:00', PriceArea: 'DK1', DayAheadPriceDKK: 850 },
  ]);
  assert.deepEqual(rows.map(r => r.ts), [
    '2026-11-11T13:00:00.000Z', '2026-11-11T14:00:00.000Z',
  ]);
});

test('DayAheadPrices rejects a missing records array instead of failing silently', () => {
  assert.throws(() => normalizeDayAheadRows(undefined), /records array/);
});

test('DayAheadPrices zone map covers exactly DK1, DK2 and NO2', () => {
  assert.deepEqual(Object.keys(PRICE_ZONES).sort(), ['DK1', 'DK2', 'NO2']);
});
