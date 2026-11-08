import { describe, expect, test } from 'vitest';
import { buildEnergyCountryCoverage } from './EnergyCountryCoverage.jsx';

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
