import { describe, expect, test } from 'vitest';
import { buildEnergyGenerationDemandTrends, filterRenewableGenerationSeries } from './EnergyGenerationDemandTrends.jsx';

const point = (value, ts) => ({ value, ts });

describe('buildEnergyGenerationDemandTrends', () => {
  test('calculates first-to-last changes within each independent series', () => {
    const rows = buildEnergyGenerationDemandTrends([
      { country:'SE', source:'svk', indicator:'Total produktion (SE)', unit:'MW', points:[
        point(100, '2026-11-07T08:00:00Z'), point(120, '2026-11-07T09:00:00Z'), point(150, '2026-11-07T10:00:00Z'),
      ] },
      { country:'SE', source:'svk', indicator:'Total förbrukning (SE)', unit:'MW', points:[
        point(90, '2026-11-07T08:00:00Z'), point(95, '2026-11-07T10:00:00Z'),
      ] },
      { country:'NO', source:'statnett', indicator:'Total förbrukning (NO)', unit:'MW', points:[
        point(80, '2026-11-07T08:00:00Z'), point(100, '2026-11-07T10:00:00Z'),
      ] },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].country).toBe('NO');
    expect(rows[0].derived).toBe(true);
    const production = rows.find(row => row.kind === 'Production');
    expect(production.delta).toBe(50);
    expect(production.percent).toBe(50);
    expect(production.count).toBe(3);
  });

  test('marks explicitly estimated consumption and keeps Iceland generation without inventing demand', () => {
    const rows = buildEnergyGenerationDemandTrends([
      { country:'DK', source:'energinet-live', indicator:'Beräknad förbrukning (DK, SCADA)', unit:'MW',
        points:[point(200, '2026-11-07T08:00:00Z'), point(210, '2026-11-07T09:00:00Z')] },
      { country:'IS', source:'landsnet', indicator:'Total produktion (IS)', unit:'MW',
        points:[point(300, '2026-11-07T08:00:00Z'), point(320, '2026-11-07T09:00:00Z')] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.country === 'DK').derived).toBe(true);
    expect(rows.some(row => row.country === 'IS' && row.kind === 'Consumption')).toBe(false);
  });

  test('tracks renewable technologies separately and calculates only exactly aligned shares', () => {
    const ts1 = '2026-11-07T08:00:00Z';
    const ts2 = '2026-11-07T09:00:00Z';
    const rows = buildEnergyGenerationDemandTrends([
      { country:'DK', source:'energidataservice', indicator:'Total produktion (DK)', unit:'MW',
        points:[point(1000, ts1), point(1200, ts2)] },
      { country:'DK', source:'energidataservice', indicator:'Vindproduktion (DK)', unit:'MW',
        points:[point(300, ts1), point(420, ts2)] },
      { country:'DK', source:'energidataservice', indicator:'Solproduktion (DK)', unit:'MW',
        points:[point(100, ts1), point(180, ts2)] },
      { country:'FI', source:'fingrid', indicator:'Vattenkraftproduktion (FI)', unit:'MW',
        points:[point(200, ts1), point(250, ts2)] },
      { country:'IS', source:'landsnet', indicator:'Geotermisk produktion (IS)', unit:'MW',
        points:[point(150, ts1), point(160, ts2)] },
    ]);
    const wind = rows.find(row => row.technology === 'Wind');
    const solar = rows.find(row => row.technology === 'Solar');
    const hydro = rows.find(row => row.technology === 'Hydro');
    const geothermal = rows.find(row => row.technology === 'Geothermal');
    expect(wind.renewableShare).toBe(35);
    expect(solar.renewableShare).toBe(15);
    expect(hydro.renewableShare).toBeNull();
    expect(geothermal.renewableShare).toBeNull();
    expect(rows.filter(row => row.kind === 'Renewable generation')).toHaveLength(4);
  });

  test('does not calculate renewable shares across different sources, timestamps or units', () => {
    const ts1 = '2026-11-07T08:00:00Z';
    const ts2 = '2026-11-07T09:00:00Z';
    const rows = buildEnergyGenerationDemandTrends([
      { country:'DK', source:'energidataservice', indicator:'Total produktion (DK)', unit:'MW',
        points:[point(1000, ts1), point(1200, ts2)] },
      { country:'DK', source:'other-source', indicator:'Vindproduktion (DK)', unit:'MW',
        points:[point(300, ts1), point(420, ts2)] },
      { country:'FI', source:'fingrid', indicator:'Total produktion (FI)', unit:'MW',
        points:[point(1000, ts1), point(1200, ts2)] },
      { country:'FI', source:'fingrid', indicator:'Vindproduktion (FI)', unit:'kW',
        points:[point(300, ts1), point(420, ts2)] },
      { country:'IS', source:'landsnet', indicator:'Total produktion (IS)', unit:'MW',
        points:[point(1000, ts1), point(1200, ts2)] },
      { country:'IS', source:'landsnet', indicator:'Geotermisk produktion (IS)', unit:'MW',
        points:[point(300, ts1), point(420, ts2)] },
    ]);
    expect(rows.find(row => row.country === 'DK' && row.kind === 'Renewable generation').renewableShare).toBeNull();
    expect(rows.find(row => row.country === 'FI' && row.kind === 'Renewable generation').renewableShare).toBeNull();
    expect(rows.find(row => row.country === 'IS' && row.kind === 'Renewable generation').renewableShare).toBe(35);
  });

  test('does not divide by zero or treat missing values as zero', () => {
    const rows = buildEnergyGenerationDemandTrends([{
      country:'FI', source:'fingrid', indicator:'Total produktion (FI)', unit:'MW',
      points:[point(null, '2026-11-07T07:00:00Z'), point(0, '2026-11-07T08:00:00Z'),
        point(10, '2026-11-07T09:00:00Z'), point('', '2026-11-07T10:00:00Z')],
    }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].first.value).toBe(0);
    expect(rows[0].percent).toBeNull();
    expect(rows[0].count).toBe(2);
  });

  test('requires two distinct valid timestamps and filters unrelated indicators', () => {
    expect(buildEnergyGenerationDemandTrends([
      { country:'SE', source:'svk', indicator:'Total produktion (SE)', unit:'MW',
        points:[point(1, '2026-11-07T08:00:00Z'), point(2, '2026-11-07T08:00:00Z')] },
      { country:'SE', source:'svk', indicator:'Nettoflöde SE→FI', unit:'MW',
        points:[point(1, '2026-11-07T08:00:00Z'), point(2, '2026-11-07T09:00:00Z')] },
    ])).toHaveLength(0);
  });
});


describe('filterRenewableGenerationSeries', () => {
  test('keeps only source-reported renewable technology series', () => {
    const renewable = [
      { indicator: 'Vindproduktion (DK)' },
      { indicator: 'Solproduktion (DK)' },
      { indicator: 'Vattenkraftproduktion (FI)' },
      { indicator: 'Geotermisk produktion (IS)' },
      { indicator: 'Förnybar produktion (IS)' },
      { indicator: 'Vind+sol-produktion DK' },
    ];
    const unrelated = [
      { indicator: 'Total produktion (DK)' },
      { indicator: 'Total förbrukning (DK)' },
      { indicator: 'Nettoflöde DK→SE' },
      { indicator: 'Dag-ahead-pris DK1' },
    ];
    expect(filterRenewableGenerationSeries([...renewable, ...unrelated])).toEqual(renewable);
  });

  test('handles missing indicators and empty input safely', () => {
    expect(filterRenewableGenerationSeries()).toEqual([]);
    expect(filterRenewableGenerationSeries([{}, { indicator: null }, { indicator: 'Total produktion (SE)' }])).toEqual([]);
  });
});
