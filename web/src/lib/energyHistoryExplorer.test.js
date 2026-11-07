import { describe, expect, test } from 'vitest';
import { filterEnergyHistorySeries } from './energyHistoryExplorer.js';

const series = [
  { country: 'DK', source: 'energinet', indicator: 'Vindproduktion (DK)', unit: 'MW' },
  { country: 'FI', source: 'fingrid', indicator: 'Vattenkraftproduktion (FI)', unit: 'MW' },
  { country: 'IS', source: 'landsnet', indicator: 'Geotermisk produktion (IS)', unit: 'MW' },
];

describe('filterEnergyHistorySeries', () => {
  test('returns all series for an empty query', () => {
    expect(filterEnergyHistorySeries(series)).toEqual(series);
    expect(filterEnergyHistorySeries(series, '  ')).toEqual(series);
  });

  test('matches country, technology, indicator, source and unit case-insensitively', () => {
    expect(filterEnergyHistorySeries(series, 'dk')).toEqual([series[0]]);
    expect(filterEnergyHistorySeries(series, 'HYDRO')).toEqual([series[1]]);
    expect(filterEnergyHistorySeries(series, 'landsnet')).toEqual([series[2]]);
    expect(filterEnergyHistorySeries(series, 'mw')).toEqual(series);
  });

  test('returns an empty list when nothing matches', () => {
    expect(filterEnergyHistorySeries(series, 'nuclear')).toEqual([]);
  });

  test('handles missing metadata safely', () => {
    expect(filterEnergyHistorySeries([{ indicator: 'Wind' }, {}], 'wind')).toEqual([{ indicator: 'Wind' }]);
  });
});
