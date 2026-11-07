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

  test('matches country, source and unit case-insensitively', () => {
    expect(filterEnergyHistorySeries(series, 'dk')).toEqual([series[0]]);
    expect(filterEnergyHistorySeries(series, 'landsnet')).toEqual([series[2]]);
    expect(filterEnergyHistorySeries(series, 'mw')).toEqual(series);
  });

  test('matches common English and Swedish technology names', () => {
    expect(filterEnergyHistorySeries(series, 'HYDRO')).toEqual([series[1]]);
    expect(filterEnergyHistorySeries(series, 'vattenkraft')).toEqual([series[1]]);
    expect(filterEnergyHistorySeries(series, 'WIND')).toEqual([series[0]]);
    expect(filterEnergyHistorySeries(series, 'geothermal')).toEqual([series[2]]);
    expect(filterEnergyHistorySeries(series, 'geotermisk')).toEqual([series[2]]);
  });

  test('returns an empty list when nothing matches', () => {
    expect(filterEnergyHistorySeries(series, 'biomass')).toEqual([]);
  });

  test('handles missing metadata safely', () => {
    expect(filterEnergyHistorySeries([{ indicator: 'Wind' }, {}], 'wind')).toEqual([{ indicator: 'Wind' }]);
  });
});
