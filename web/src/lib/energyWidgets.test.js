import { describe, expect, test } from 'vitest';
import {
  WIDGETS, widgetById, latestPerIndicator, priceRows, genDemandRows, mixParts,
  co2Rows, flowRows, reserveRows, spreadData, sourceRows, emptyNote, caveatOf,
  selectDetailSeries, selectDetailObservations,
} from './energyWidgets.js';

const T1 = '2026-11-11T10:00:00.000Z';
const T2 = '2026-11-11T11:00:00.000Z';
const T3 = '2026-11-11T12:00:00.000Z';

const priceRow = (zone, country, value, unit, ts) => ({
  t: 'm', area: 1, country, source: 'test', sourceName: 'Testkälla', indicator: `Dag-ahead-pris ${zone}`, value, unit, ts,
});

const METRICS = [
  priceRow('SE1', 'SE', 0.42, 'SEK/kWh', T3),
  priceRow('SE1', 'SE', 0.55, 'SEK/kWh', T2), // äldre – ska inte väljas
  priceRow('SE2', 'SE', 0.38, 'SEK/kWh', T3),
  priceRow('NO2', 'NO', 145.2, 'EUR/MWh', T3),
  priceRow('DK1', 'DK', 0.91, 'DKK/kWh', T3),
  { t: 'm', area: 1, country: 'SE', source: 'test', indicator: 'Dag-ahead-pris SE3', value: null, unit: 'SEK/kWh', ts: T3 },
  // Produktion/förbrukning – DK justerat, NO olika tidsstämplar
  { t: 'm', area: 1, country: 'DK', source: 'test', indicator: 'Total produktion (DK)', value: 3400, unit: 'MW', ts: T2 },
  { t: 'm', area: 1, country: 'DK', source: 'test', indicator: 'Total förbrukning (DK)', value: 3100, unit: 'MW', ts: T2 },
  { t: 'm', area: 1, country: 'NO', source: 'test', indicator: 'Total produktion (NO)', value: 90000, unit: 'MWh/dygn', ts: T3 },
  { t: 'm', area: 1, country: 'NO', source: 'test', indicator: 'Total förbrukning (NO)', value: 88000, unit: 'MWh/dygn', ts: T2 },
  // DK-mix justerad vid T2 + total → "Övrigt" härleds
  { t: 'm', area: 1, country: 'DK', source: 'test', indicator: 'Vindproduktion (DK)', value: 1500, unit: 'MW', ts: T2 },
  { t: 'm', area: 1, country: 'DK', source: 'test', indicator: 'Solproduktion (DK)', value: 300, unit: 'MW', ts: T2 },
  // FI-mix ojusterad
  { t: 'm', area: 1, country: 'FI', source: 'test', indicator: 'Vindproduktion (FI)', value: 400, unit: 'MW', ts: T3 },
  { t: 'm', area: 1, country: 'FI', source: 'test', indicator: 'Kärnkraftsproduktion (FI)', value: 2600, unit: 'MW', ts: T2 },
  { t: 'm', area: 1, country: 'DK', source: 'test', indicator: 'CO2-intensitet (DK)', value: 105.4, unit: 'g CO2/kWh', ts: T3 },
  // Reserv – ett leveransblock vid T3 med pris på en produkt
  { t: 'm', area: 1, country: 'SE', source: 'test', indicator: 'aFRR-kapacitet SE4 up', value: 250, unit: 'MW', ts: T3 },
  { t: 'm', area: 1, country: 'SE', source: 'test', indicator: 'aFRR-kapacitetspris SE4 up', value: 187.5, unit: 'EUR/MWh', ts: T3 },
  { t: 'm', area: 1, country: 'SE', source: 'test', indicator: 'mFRR-kapacitet SE3 down', value: 90, unit: 'MW', ts: T2 }, // äldre block
  { t: 'm', area: 1, country: 'DK', source: 'test', indicator: 'Mfrr-efterfrågan DK1 (positivt = importbehov)', value: -40, unit: 'MW', ts: T3 },
];

const ctxAll = { country: 'ALL', metrics: METRICS };

describe('latestPerIndicator', () => {
  test('picks the newest past observation per indicator and skips null values', () => {
    const rows = latestPerIndicator(METRICS, r => /^Dag-ahead-pris /.test(r.indicator ?? ''));
    expect(rows.map(r => r.indicator).sort()).toEqual(['Dag-ahead-pris DK1', 'Dag-ahead-pris NO2', 'Dag-ahead-pris SE1', 'Dag-ahead-pris SE2']);
    expect(rows.find(r => r.indicator === 'Dag-ahead-pris SE1').value).toBe(0.42);
  });

  test('prefers the interval active now over later future intervals', () => {
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const later = new Date(Date.now() + 7200_000).toISOString();
    const rows = latestPerIndicator([
      priceRow('SE1', 'SE', 1, 'SEK/kWh', soon),
      priceRow('SE1', 'SE', 2, 'SEK/kWh', later),
    ], r => /^Dag-ahead-pris /.test(r.indicator ?? ''));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(1);
  });
});

describe('priceRows', () => {
  test('ALL scope lists every zone with country and unit retained', () => {
    const rows = priceRows(ctxAll);
    expect(rows.map(r => r.zone).sort()).toEqual(['DK1', 'NO2', 'SE1', 'SE2']);
    expect(rows.find(r => r.zone === 'NO2')).toMatchObject({ country: 'NO', unit: 'EUR/MWh' });
  });

  test('country scope excludes other countries zones', () => {
    const rows = priceRows({ ...ctxAll, country: 'SE' });
    expect(rows.map(r => r.zone).sort()).toEqual(['SE1', 'SE2']);
  });
});

describe('genDemandRows', () => {
  test('computes balance only when production and demand share timestamp and unit', () => {
    const rows = genDemandRows(ctxAll);
    const dk = rows.find(r => r.country === 'DK');
    expect(dk.aligned).toBe(true);
    expect(dk.balance).toBe(300);
    const no = rows.find(r => r.country === 'NO');
    expect(no.aligned).toBe(false);
    expect(no.balance).toBeNull();
  });

  test('empty scope yields no rows', () => {
    expect(genDemandRows({ country: 'IS', metrics: METRICS })).toEqual([]);
  });
});

describe('mixParts', () => {
  test('DK derives the unallocated remainder from aligned total production', () => {
    const { parts, reason } = mixParts(ctxAll, 'DK');
    expect(reason).toBeNull();
    expect(parts.map(p => p.name)).toEqual(['Vind', 'Sol', 'Övrigt (ej fördelat)']);
    expect(parts[2].value).toBe(3400 - 1800);
  });

  test('unaligned components are refused instead of mixed across timestamps', () => {
    const { parts, reason } = mixParts(ctxAll, 'FI');
    expect(parts).toEqual([]);
    expect(reason).toBe('not-aligned');
  });

  test('countries without definitions report no-definitions', () => {
    expect(mixParts(ctxAll, 'SE').reason).toBe('no-definitions');
  });
});

describe('co2Rows and flowRows', () => {
  test('co2Rows lists aligned intensity per country', () => {
    const rows = co2Rows(ctxAll);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ country: 'DK', value: 105.4, unit: 'g CO2/kWh' });
  });

  test('flowRows sorts by absolute MW and flips the label for negative flows', () => {
    const flows = [
      { source: 'svk', name: 'SE3→DK1', updated: T3, attrs: { mw: -420, from: 'SE3', to: 'DK1' } },
      { source: 'statnett', name: 'NO2→DK1', updated: T3, attrs: { mw: 950, from: 'NO2', to: 'DK1' } },
      { source: 'svk', name: 'SE4→PL', updated: T3, attrs: { mw: null } },
    ];
    const rows = flowRows({ ...ctxAll, flows });
    expect(rows.map(r => r.label)).toEqual(['NO2 → DK1', 'DK1 → SE3']);
    expect(rows).toHaveLength(2); // null-MW-flödet utesluts
  });
});

describe('reserveRows', () => {
  test('pairs capacity with same-block price and appends mFRR demand rows', () => {
    const { blockTs, rows } = reserveRows(ctxAll);
    expect(blockTs).toBe(T3);
    const afrr = rows.find(r => r.product === 'aFRR' && r.zone === 'SE4');
    expect(afrr).toMatchObject({ direction: 'up', capacity: 250, price: 187.5 });
    const demand = rows.find(r => r.direction === 'uppgift');
    expect(demand).toMatchObject({ product: 'mFRR', zone: 'DK1', value: -40 });
    // äldre block (T2) hör inte till aktuellt leveransblock
    expect(rows.find(r => r.zone === 'SE3')).toBeUndefined();
  });

  test('country scope limits reserve rows to that country', () => {
    const { rows } = reserveRows({ ...ctxAll, country: 'DK' });
    expect(rows.every(r => r.country === 'DK')).toBe(true);
  });
});

describe('spreadData, sourceRows and notes', () => {
  test('spreadData exposes the latest comparison snapshot', () => {
    const comparisons = [{ asOf: T3, unit: 'SEK/kWh', zoneCount: 2, low: { zone: 'SE2' }, high: { zone: 'SE1' }, spread: 0.04 }];
    expect(spreadData({ comparisons })).toEqual({ latest: comparisons[0], count: 1 });
    expect(spreadData({}).latest).toBeNull();
  });

  test('sourceRows sorts by name', () => {
    const rows = sourceRows({ sources: [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }] });
    expect(rows.map(r => r.name)).toEqual(['A', 'B']);
  });

  test('emptyNote names the missing source per widget and country', () => {
    expect(emptyNote('pris', 'FI')).toContain('FINGRID_KEY');
    expect(emptyNote('produktion', 'IS')).toContain('403');
    expect(emptyNote('balans', 'SE')).toContain('Sverige');
    expect(emptyNote('co2', 'ALL')).toContain('Energinet');
  });

  test('every widget has caveats except the analysis-free ones are still safe', () => {
    for (const w of WIDGETS) expect(Array.isArray(caveatOf(w.id))).toBe(true);
    expect(caveatOf('pris').length).toBeGreaterThan(0);
  });
});

describe('detail selection for the modal', () => {
  const series = [
    { country: 'SE', source: 'elprisetjustnu', indicator: 'Dag-ahead-pris SE1', unit: 'SEK/kWh', points: [] },
    { country: 'SE', source: 'elprisetjustnu', indicator: 'Dag-ahead-pris SE2', unit: 'SEK/kWh', points: [] },
    { country: 'NO', source: 'eds-dayahead', indicator: 'Dag-ahead-pris NO2', unit: 'EUR/MWh', points: [] },
    { country: 'SE', source: 'svk', indicator: 'Nettoflöde SE3→DK1', unit: 'MW', points: [] },
    { country: 'SE', source: 'svk', indicator: 'aFRR-kapacitet SE4 up', unit: 'MW', points: [] },
  ];

  test('pris widget filters to the clicked bidding zone only', () => {
    expect(selectDetailSeries('pris', series, { country: 'ALL', item: 'SE1' }).map(s => s.indicator))
      .toEqual(['Dag-ahead-pris SE1']);
    expect(selectDetailSeries('pris', series, { country: 'NO', item: null }).map(s => s.indicator))
      .toEqual(['Dag-ahead-pris NO2']);
  });

  test('floden widget matches either arrow direction', () => {
    const rows = selectDetailSeries('floden', series, { country: 'ALL', item: 'DK1 → SE3' });
    expect(rows).toHaveLength(1);
    expect(rows[0].indicator).toBe('Nettoflöde SE3→DK1');
  });

  test('widgets without a detail spec return no series', () => {
    expect(selectDetailSeries('karta', series, { country: 'ALL' })).toEqual([]);
  });

  test('observations spread the limit across indicators and stay newest-first', () => {
    const metrics = [];
    for (let i = 0; i < 10; i += 1) {
      metrics.push(priceRow('SE1', 'SE', 0.4 + i / 100, 'SEK/kWh', `2026-11-11T${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00.000Z`));
      metrics.push(priceRow('SE2', 'SE', 0.3 + i / 100, 'SEK/kWh', `2026-11-11T${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00.000Z`));
    }
    const rows = selectDetailObservations('pris', metrics, { country: 'ALL', item: null, limit: 8 });
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(new Set(rows.map(r => r.indicator))).toEqual(new Set(['Dag-ahead-pris SE1', 'Dag-ahead-pris SE2']));
    for (let i = 1; i < rows.length; i += 1) expect(String(rows[i - 1].ts).localeCompare(rows[i].ts)).toBeGreaterThanOrEqual(0);
  });

  test('observations respect the clicked item filter', () => {
    const rows = selectDetailObservations('pris', METRICS, { country: 'ALL', item: 'SE2' });
    expect(rows.every(r => r.indicator === 'Dag-ahead-pris SE2')).toBe(true);
  });

  test('co2 observations narrow to the clicked country even in ALL scope', () => {
    expect(selectDetailObservations('co2', METRICS, { country: 'ALL', item: 'DK' })
      .every(r => r.country === 'DK')).toBe(true);
    expect(selectDetailObservations('co2', METRICS, { country: 'ALL', item: 'SE' })).toEqual([]);
  });
});

describe('widget registry', () => {
  test('curated order is fixed and ids are unique', () => {
    const ids = WIDGETS.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('karta');
    expect(widgetById('pris')).toMatchObject({ title: 'Dag-spotpriser' });
    expect(widgetById('nope')).toBeNull();
  });
});
