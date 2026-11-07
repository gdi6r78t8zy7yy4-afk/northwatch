import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EnergyPriceProfiles, { buildEnergyPriceProfiles } from './EnergyPriceProfiles.jsx';

const now = Date.parse('2026-11-07T12:00:00.000Z');
const row = (country, value, ts, overrides = {}) => ({
  country, value, ts, unit:'EUR/MWh', source:'entsoe', sourceName:'ENTSO-E',
  indicator:'Dag-ahead-pris ' + country, ...overrides,
});

describe('buildEnergyPriceProfiles', () => {
  test('groups each country, source and unit into an ordered delivery profile', () => {
    const profiles = buildEnergyPriceProfiles([
      row('SE', 80, '2026-11-07T14:00:00Z'),
      row('SE', 30, '2026-11-07T13:00:00Z'),
      row('NO', 25, '2026-11-07T13:00:00Z'),
    ], { now });
    expect(profiles).toHaveLength(2);
    const sweden = profiles.find(profile => profile.country === 'SE');
    expect(sweden.points.map(point => point.value)).toEqual([30, 80]);
    expect(sweden.source).toBe('ENTSO-E');
  });

  test('keeps different currencies, sources and bidding zones separate', () => {
    const profiles = buildEnergyPriceProfiles([
      row('SE', 80, '2026-11-07T13:00:00Z'),
      row('SE', 800, '2026-11-07T13:00:00Z', { source:'elprisetjustnu', unit:'SEK/kWh' }),
      row('DK', 700, '2026-11-07T13:00:00Z', { unit:'DKK/MWh' }),
    ], { now });
    expect(profiles).toHaveLength(3);
    expect(new Set(profiles.map(profile => profile.unit)).size).toBe(3);
  });

  test('includes the latest active interval and upcoming 24 hours, excluding older and distant data', () => {
    const profiles = buildEnergyPriceProfiles([
      row('SE', 10, '2026-11-07T09:59:00Z'),
      row('SE', 20, '2026-11-07T11:00:00Z'),
      row('SE', 30, '2026-11-08T12:00:00Z'),
      row('SE', 40, '2026-11-08T12:01:00Z'),
    ], { now });
    expect(profiles[0].points.map(point => point.value)).toEqual([20, 30]);
  });

  test('deduplicates the same series timestamp and ignores invalid or missing values', () => {
    const profiles = buildEnergyPriceProfiles([
      row('SE', 20, '2026-11-07T13:00:00Z'),
      row('SE', 25, '2026-11-07T13:00:00Z'),
      row('NO', null, '2026-11-07T13:00:00Z'),
      row('FI', 'not-a-number', '2026-11-07T13:00:00Z'),
      row('DK', 50, 'invalid'),
    ], { now });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].points).toHaveLength(1);
    expect(profiles[0].points[0].value).toBe(20);
  });
});

describe('EnergyPriceProfiles', () => {
  test('renders the empty state when no current or upcoming prices exist', () => {
    render(<EnergyPriceProfiles metrics={[]} now={now}/>);
    expect(screen.getByText(/No current or upcoming day-ahead delivery intervals/)).toBeInTheDocument();
  });

  test('lets the user expand the visible delivery window to 48 hours', () => {
    render(<EnergyPriceProfiles metrics={[
      row('SE', 30, '2026-11-07T13:00:00Z'),
      row('SE', 80, '2026-11-08T18:00:00Z'),
    ]} now={now}/>);
    expect(screen.getByText('Current & next 24 hours')).toBeInTheDocument();
    expect(screen.getByText(/No current or upcoming day-ahead delivery intervals/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name:'Price profile time range' }), { target:{ value:'48' } });
    expect(screen.getByText('Current & next 48 hours')).toBeInTheDocument();
    expect(screen.getByText('SE · SE')).toBeInTheDocument();
  });

  test('renders source-attributed profile values', () => {
    render(<EnergyPriceProfiles metrics={[
      row('SE', 30, '2026-11-07T13:00:00Z'),
      row('SE', 80, '2026-11-07T14:00:00Z'),
    ]} now={now}/>);
    expect(screen.getByText('SE · SE')).toBeInTheDocument();
    expect(screen.getByText('ENTSO-E')).toBeInTheDocument();
    expect(screen.getByText(/30 – 80 EUR\/MWh/)).toBeInTheDocument();
  });
});
