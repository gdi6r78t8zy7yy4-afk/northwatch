import { describe, expect, test } from 'vitest';
import { analyzeEnergyPriceProfile, buildEnergyPriceSpreadMovements } from './energyPriceAnalysis.js';

describe('analyzeEnergyPriceProfile', () => {
  test('summarizes net movement and the largest adjacent move within one series', () => {
    const result = analyzeEnergyPriceProfile({ points: [
      { ts:'2026-11-07T13:00:00Z', value:40 },
      { ts:'2026-11-07T14:00:00Z', value:55 },
      { ts:'2026-11-07T15:00:00Z', value:20 },
    ] });
    expect(result.netChange).toBe(-20);
    expect(result.largestStep).toEqual({
      change:-35, from:'2026-11-07T14:00:00Z', to:'2026-11-07T15:00:00Z',
    });
    expect(result.low).toBe(20);
    expect(result.high).toBe(55);
  });

  test('counts negative-price intervals and does not invent movement for one point', () => {
    const result = analyzeEnergyPriceProfile({ points:[
      { ts:'2026-11-07T13:00:00Z', value:-2 },
    ] });
    expect(result.negativeIntervals).toBe(1);
    expect(result.netChange).toBeNull();
    expect(result.largestStep).toBeNull();
  });

  test('returns null for an empty or invalid series', () => {
    expect(analyzeEnergyPriceProfile({ points:[{ ts:'invalid', value:2 }] })).toBeNull();
  });
});

describe('buildEnergyPriceSpreadMovements', () => {
  const snapshot = (asOf, spread, overrides = {}) => ({
    asOf, spread, unit:'EUR/MWh',
    observations:[
      { country:'DK', source:'energinet', value:20 },
      { country:'SE', source:'elprisetjustnu', value:20 + spread },
    ],
    ...overrides,
  });

  test('compares the two latest spreads only with identical country, source and unit coverage', () => {
    const movements = buildEnergyPriceSpreadMovements([
      snapshot('2026-11-07T12:00:00Z', 30),
      snapshot('2026-11-07T13:00:00Z', 45),
      snapshot('2026-11-07T14:00:00Z', 60),
      snapshot('2026-11-07T14:30:00Z', 900, { unit:'SEK/MWh' }),
      snapshot('2026-11-07T14:45:00Z', 100, { observations:[
        { country:'DK', source:'energinet', value:20 },
        { country:'NO', source:'statnett', value:120 },
      ] }),
    ]);
    expect(movements).toHaveLength(1);
    expect(movements[0].previousSpread).toBe(45);
    expect(movements[0].latestSpread).toBe(60);
    expect(movements[0].change).toBe(15);
    expect(movements[0].countries).toEqual(['DK', 'SE']);
  });

  test('requires at least two snapshots with two comparable countries', () => {
    expect(buildEnergyPriceSpreadMovements([
      snapshot('2026-11-07T12:00:00Z', 30),
    ])).toEqual([]);
  });
});
