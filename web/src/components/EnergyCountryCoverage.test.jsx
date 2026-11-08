import { describe, expect, test } from 'vitest';
import { buildEnergyCountryCoverage, observationCollectorNote } from './EnergyCountryCoverage.jsx';

describe('buildEnergyCountryCoverage', () => {
  test('counts Denmark combined wind and solar production as a generation component', () => {
    const rows = buildEnergyCountryCoverage([{
      country: 'DK',
      indicator: 'Vind+sol-produktion DK',
      value: 1250,
      unit: 'MW',
      ts: '2026-11-08T09:00:00.000Z',
      source: 'energinet',
      sourceName: 'Energinet',
    }]);

    const denmark = rows.find(row => row.country === 'DK');
    expect(denmark.componentCount).toBe(1);
    expect(denmark.latestComponent.indicator).toBe('Vind+sol-produktion DK');
    expect(denmark.latestComponent.value).toBe(1250);
  });

  test('does not count invalid or unrelated measurements as generation components', () => {
    const rows = buildEnergyCountryCoverage([
      { country: 'DK', indicator: 'Vind+sol-produktion DK', value: null, ts: '2026-11-08T09:00:00Z' },
      { country: 'DK', indicator: 'Nettoflöde DK1→DK2', value: 10, ts: '2026-11-08T09:00:00Z' },
    ]);

    expect(rows.find(row => row.country === 'DK').componentCount).toBe(0);
  });
});

describe('observationCollectorNote', () => {
  test.each([
    ['stale', 'Collector stale · last successful measurement retained'],
    ['error', 'Collector error · last successful measurement retained'],
    ['no_key', 'Collector credentials missing · last successful measurement retained'],
  ])('explains retained observations when collector status is %s', (sourceStatus, expected) => {
    expect(observationCollectorNote({ sourceStatus })).toBe(expected);
  });

  test('does not add a warning for a healthy or unspecified collector', () => {
    expect(observationCollectorNote({ sourceStatus: 'ok' })).toBeNull();
    expect(observationCollectorNote({})).toBeNull();
    expect(observationCollectorNote(null)).toBeNull();
  });
});
