import { describe, expect, test } from 'vitest';
import { buildEnergyPriceMovements } from './EnergyPriceMovementAnalysis.jsx';

const point = (value, ts) => ({ value, ts });

describe('buildEnergyPriceMovements', () => {
  test('compares the latest two points only within each independent price series', () => {
    const result = buildEnergyPriceMovements([
      { country:'SE', source:'svk', indicator:'Dag-ahead-pris SE3', unit:'SEK/MWh', points:[
        point(40, '2026-11-07T08:00:00Z'), point(50, '2026-11-07T09:00:00Z'),
        point(45, '2026-11-07T11:00:00Z'),
      ] },
      { country:'FI', source:'fingrid', indicator:'Dag-ahead-pris FI', unit:'EUR/MWh', points:[
        point(30, '2026-11-07T09:00:00Z'), point(60, '2026-11-07T10:00:00Z'),
      ] },
      { country:'NO', source:'statnett', indicator:'Production', unit:'MW', points:[
        point(100, '2026-11-07T09:00:00Z'), point(200, '2026-11-07T10:00:00Z'),
      ] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].country).toBe('FI');
    expect(result[0].percent).toBe(100);
    expect(result[1].country).toBe('SE');
    expect(result[1].delta).toBe(-5);
    expect(result[1].elapsedMs).toBe(2 * 60 * 60 * 1000);
  });

  test('omits percentage change when previous value is zero', () => {
    const [movement] = buildEnergyPriceMovements([{
      country:'DK', source:'eds', indicator:'Dag-ahead-pris DK1', unit:'DKK/MWh',
      points:[point(0, '2026-11-07T09:00:00Z'), point(12, '2026-11-07T10:00:00Z')],
    }]);
    expect(movement.percent).toBeNull();
    expect(movement.delta).toBe(12);
  });

  test('requires two valid, increasing timestamps', () => {
    expect(buildEnergyPriceMovements([{
      country:'SE', source:'svk', indicator:'Dag-ahead-pris SE1', unit:'SEK/MWh',
      points:[point(10, '2026-11-07T10:00:00Z'), point(20, '2026-11-07T09:00:00Z')],
    }])).toHaveLength(0);
  });
});
