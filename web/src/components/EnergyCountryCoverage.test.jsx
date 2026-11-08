import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import EnergyCountryCoverage, { buildEnergyCountryCoverage, observationCollectorNote } from './EnergyCountryCoverage.jsx';

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


describe('day-ahead price series coverage', () => {
  test('keeps each valid bidding-zone series visible instead of collapsing a country to one price', () => {
    const rows = buildEnergyCountryCoverage([
      { country:'SE', indicator:'Dag-ahead-pris SE1', source:'entsoe', sourceName:'ENTSO-E', unit:'EUR/MWh', value:42, ts:'2026-11-08T08:00:00Z' },
      { country:'SE', indicator:'Dag-ahead-pris SE1', source:'entsoe', sourceName:'ENTSO-E', unit:'EUR/MWh', value:44, ts:'2026-11-08T09:00:00Z' },
      { country:'SE', indicator:'Dag-ahead-pris SE2', source:'entsoe', sourceName:'ENTSO-E', unit:'EUR/MWh', value:0, ts:'2026-11-08T08:00:00Z' },
      { country:'SE', indicator:'Dag-ahead-pris SE3', source:'other', sourceName:'Other source', unit:'SEK/kWh', value:80, ts:'2026-11-08T08:00:00Z' },
      { country:'DK', indicator:'Dag-ahead-pris DK1', source:'entsoe', unit:'EUR/MWh', value:50, ts:'2026-11-08T08:00:00Z' },
      { country:'SE', indicator:'Dag-ahead-pris SE4', source:'entsoe', unit:'EUR/MWh', value:null, ts:'2026-11-08T08:00:00Z' },
    ]);
    const sweden = rows.find(row => row.country === 'SE');
    expect(sweden.priceSeries).toHaveLength(3);
    expect(sweden.priceSeries.map(item => item.indicator)).toEqual([
      'Dag-ahead-pris SE1', 'Dag-ahead-pris SE2', 'Dag-ahead-pris SE3',
    ]);
    expect(sweden.priceSeries.find(item => item.indicator.endsWith('SE1')).value).toBe(44);
    expect(sweden.priceSeries.find(item => item.indicator.endsWith('SE2')).value).toBe(0);
    expect(rows.find(row => row.country === 'DK').priceSeries).toHaveLength(1);
  });

  test('does not mix source or unit variants into one price series', () => {
    const rows = buildEnergyCountryCoverage([
      { country:'SE', indicator:'Dag-ahead-pris SE1', source:'entsoe', unit:'EUR/MWh', value:42, ts:'2026-11-08T08:00:00Z' },
      { country:'SE', indicator:'Dag-ahead-pris SE1', source:'local', unit:'SEK/kWh', value:0.8, ts:'2026-11-08T08:00:00Z' },
    ]);
    expect(rows.find(row => row.country === 'SE').priceSeries).toHaveLength(2);
  });
});


describe('EnergyCountryCoverage price labels', () => {
  test('renders the bidding-zone name without the internal indicator prefix', () => {
    render(<EnergyCountryCoverage metrics={[
      { country:'SE', indicator:'Dag-ahead-pris SE1', source:'entsoe', sourceName:'ENTSO-E',
        unit:'EUR/MWh', value:42, ts:'2026-11-08T08:00:00Z' },
    ]}/>);
    expect(screen.getByText('SE1')).toBeInTheDocument();
    expect(screen.queryByText(/Dag-ahead-pris\\s+SE1/)).not.toBeInTheDocument();
  });
});
