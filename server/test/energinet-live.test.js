import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePowerSystemRows } from '../collectors/energinet-live.js';

const row = (overrides = {}) => ({
  Minutes1UTC: '2026-11-07T10:00:00',
  ProductionGe100MW: 900,
  ProductionLt100MW: 400,
  SolarPower: 50,
  OnshoreWindPower: 200,
  OffshoreWindPower: 300,
  Exchange_Sum: 150,
  CO2Emission: 85,
  ...overrides,
});

test('normalizes latest Danish one-minute snapshot and derives SCADA load', () => {
  const metrics = normalizePowerSystemRows({ records: [
    row({ Minutes1UTC: '2026-11-07T09:59:00', ProductionGe100MW: 1 }),
    row(),
  ] });
  const get = name => metrics.find(item => item.indicator === name);
  assert.equal(get('Total produktion (DK)').value, 1850);
  assert.equal(get('Vindproduktion (DK)').value, 500);
  assert.equal(get('Solproduktion (DK)').value, 50);
  assert.equal(get('Beräknad förbrukning (DK, SCADA)').value, 2000);
  assert.equal(get('Nettoflöde (DK, SCADA)').value, 150);
  assert.equal(get('CO2-intensitet (DK)').unit, 'g/kWh');
  assert.equal(get('Total produktion (DK)').ts, '2026-11-07T10:00:00.000Z');
  assert.ok(metrics.every(item => item.source === 'energinet-live'));
});

test('does not fabricate total production or calculated load from partial components', () => {
  const metrics = normalizePowerSystemRows({ records: [row({ SolarPower: null })] });
  assert.equal(metrics.some(item => item.indicator === 'Total produktion (DK)'), false);
  assert.equal(metrics.some(item => item.indicator === 'Beräknad förbrukning (DK, SCADA)'), false);
  assert.equal(metrics.some(item => item.indicator === 'Vindproduktion (DK)'), true);
});

test('preserves zero values and rejects missing timestamps or empty records', () => {
  const metrics = normalizePowerSystemRows({ records: [row({ Exchange_Sum: 0, CO2Emission: 0 })] });
  assert.equal(metrics.find(item => item.indicator === 'Nettoflöde (DK, SCADA)').value, 0);
  assert.equal(metrics.find(item => item.indicator === 'CO2-intensitet (DK)').value, 0);
  assert.throws(() => normalizePowerSystemRows({ records: [row({ Minutes1UTC: null })] }), /no valid timestamped records/);
  assert.throws(() => normalizePowerSystemRows({ records: [] }), /no valid timestamped records/);
});

test('ignores malformed values instead of coercing them to zero', () => {
  const metrics = normalizePowerSystemRows({ records: [row({ CO2Emission: 'not-a-number' })] });
  assert.equal(metrics.some(item => item.indicator === 'CO2-intensitet (DK)'), false);
});
