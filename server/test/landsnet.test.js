import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLandsnet } from '../collectors/landsnet.js';

const payload = (overrides = {}) => ({
  timestamp: '2026-11-07T10:00:00',
  geothermal: 700,
  hydro: 900,
  oil: 10,
  ...overrides,
});

test('normalizes Icelandic generation mix and derives totals only from complete components', () => {
  const metrics = normalizeLandsnet(payload());
  const get = indicator => metrics.find(row => row.indicator === indicator);
  assert.equal(get('Geotermisk produktion (IS)').value, 700);
  assert.equal(get('Vattenkraftproduktion (IS)').value, 900);
  assert.equal(get('Oljeproduktion (IS)').value, 10);
  assert.equal(get('Förnybar produktion (IS)').value, 1600);
  assert.equal(get('Total produktion (IS)').value, 1610);
  assert.equal(get('Total produktion (IS)').unit, 'MW');
  assert.equal(get('Total produktion (IS)').ts, '2026-11-07T10:00:00.000Z');
  assert.ok(metrics.every(row => row.country === 'IS' && row.source === 'landsnet'));
  assert.equal(metrics.some(row => /förbrukning/i.test(row.indicator)), false);
});

test('keeps component values but omits derived totals when a component is missing', () => {
  const metrics = normalizeLandsnet(payload({ oil: null }));
  assert.equal(metrics.some(row => row.indicator === 'Geotermisk produktion (IS)'), true);
  assert.equal(metrics.some(row => row.indicator === 'Förnybar produktion (IS)'), true);
  assert.equal(metrics.some(row => row.indicator === 'Total produktion (IS)'), false);
  const partial = normalizeLandsnet(payload({ hydro: null }));
  assert.equal(partial.some(row => row.indicator === 'Förnybar produktion (IS)'), false);
  assert.equal(partial.some(row => row.indicator === 'Total produktion (IS)'), false);
});

test('preserves legitimate zero values and accepts explicit UTC offsets', () => {
  const metrics = normalizeLandsnet(payload({
    geothermal: 0, hydro: 0, oil: 0,
    timestamp: '2026-11-07T10:00:00+00:00',
  }));
  assert.equal(metrics.find(row => row.indicator === 'Total produktion (IS)').value, 0);
  assert.equal(metrics.find(row => row.indicator === 'Förnybar produktion (IS)').value, 0);
});

test('normalizes Iceland local wall-clock timestamps as UTC year-round', () => {
  const winter = normalizeLandsnet(payload({ timestamp: '2026-01-15T12:30:00' }));
  const summer = normalizeLandsnet(payload({ timestamp: '2026-07-01T12:00:00' }));
  assert.equal(winter[0].ts, '2026-01-15T12:30:00.000Z');
  assert.equal(summer[0].ts, '2026-07-01T12:00:00.000Z');
});

test('rejects missing timestamps and payloads without usable measurements', () => {
  assert.throws(() => normalizeLandsnet(payload({ timestamp: null })), /invalid or missing timestamp/);
  assert.throws(() => normalizeLandsnet(payload({
    geothermal: 'invalid', hydro: null, oil: undefined,
  })), /no usable generation measurements/);
});
