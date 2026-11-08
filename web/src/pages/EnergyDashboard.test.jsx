import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import EnergyDashboard from './EnergyDashboard.jsx';

vi.mock('../api.js', () => ({
  fetchEnergyOverview: vi.fn(),
  fetchEnergyHistory: vi.fn(),
  fetchEnergyAnalysis: vi.fn(),
  fetchAssets: vi.fn(),
  fetchStaticGeo: vi.fn(),
}));

import {
  fetchEnergyOverview,
  fetchEnergyHistory,
  fetchEnergyAnalysis,
  fetchAssets,
  fetchStaticGeo,
} from '../api.js';

const MOCK_TIMESTAMP = '2026-11-07T12:00:00.000Z';

const MOCK_OVERVIEW = {
  generatedAt: MOCK_TIMESTAMP,
  country: 'ALL',
  metrics: [
    { indicator: 'Svensk nettoexport (SE1–SE4)', value: 1250, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät' },
    { indicator: 'Total produktion (SE)', value: 16000, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät' },
    { indicator: 'Total förbrukning (SE)', value: 14500, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät' },
    { indicator: 'Total produktion (DK)', value: 3400, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'DK', source: 'energinet', sourceName: 'Energi Data Service' },
    { indicator: 'Total förbrukning (DK)', value: 3100, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'DK', source: 'energinet', sourceName: 'Energi Data Service' },
    { indicator: 'Vindproduktion (DK)', value: 1800, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'DK', source: 'energinet', sourceName: 'Energi Data Service' },
    { indicator: 'Solproduktion (DK)', value: 400, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'DK', source: 'energinet', sourceName: 'Energi Data Service' },
    { indicator: 'Vindproduktion (FI)', value: 100, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'FI', source: 'fingrid', sourceName: 'Fingrid' },
    { indicator: 'Vattenkraftproduktion (FI)', value: 250, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'FI', source: 'fingrid', sourceName: 'Fingrid' },
    { indicator: 'Kärnkraftsproduktion (FI)', value: 300, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'FI', source: 'fingrid', sourceName: 'Fingrid' },
    { indicator: 'Industriell kraftvärmeproduktion (FI)', value: 50, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'FI', source: 'fingrid', sourceName: 'Fingrid' },
    { indicator: 'Total produktion (FI)', value: 900, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'FI', source: 'fingrid', sourceName: 'Fingrid' },
    { indicator: 'Geotermisk produktion (IS)', value: 200, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'IS', source: 'landsnet', sourceName: 'Landsnet' },
    { indicator: 'Vattenkraftproduktion (IS)', value: 300, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'IS', source: 'landsnet', sourceName: 'Landsnet' },
    { indicator: 'Oljeproduktion (IS)', value: 10, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'IS', source: 'landsnet', sourceName: 'Landsnet' },
    { indicator: 'Förnybar produktion (IS)', value: 500, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'IS', source: 'landsnet', sourceName: 'Landsnet' },
    { indicator: 'Total produktion (IS)', value: 510, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'IS', source: 'landsnet', sourceName: 'Landsnet' },
    { indicator: 'CO2-intensitet (DK)', value: 45, unit: 'g/kWh', ts: MOCK_TIMESTAMP, country: 'DK', source: 'energinet', sourceName: 'Energi Data Service' },
    { indicator: 'Dag-ahead-pris SE3', value: 24.5, unit: 'EUR/MWh', ts: MOCK_TIMESTAMP, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät' },
    { indicator: 'Dag-ahead-pris DK1', value: 29.8, unit: 'EUR/MWh', ts: MOCK_TIMESTAMP, country: 'DK', source: 'energinet', sourceName: 'Energi Data Service' },
    { indicator: 'aFRR-kapacitet SE3 up', value: 120, unit: 'MW', ts: MOCK_TIMESTAMP, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät' },
    { indicator: 'aFRR-kapacitetspris SE3 up', value: 15.2, unit: 'EUR/MW', ts: MOCK_TIMESTAMP, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät' },
  ],
  flows: [
    {
      source: 'statnett',
      name: 'NO1-SE3',
      sourceName: 'Statnett',
      updated: MOCK_TIMESTAMP,
      attrs: { from: 'NO1', to: 'SE3', mw: 450 },
    },
  ],
  marketComparisons: [
    {
      asOf: MOCK_TIMESTAMP,
      unit: 'EUR/MWh',
      countryCount: 2,
      low: { country: 'SE', value: 24.5 },
      high: { country: 'DK', value: 29.8 },
      spread: 5.3,
      observations: [
        { country: 'SE', value: 24.5, unit: 'EUR/MWh', ts: MOCK_TIMESTAMP, sourceName: 'Svenska kraftnät' },
        { country: 'DK', value: 29.8, unit: 'EUR/MWh', ts: MOCK_TIMESTAMP, sourceName: 'Energi Data Service' },
      ],
    },
  ],
  sources: [
    { id: 'svk', name: 'Svenska kraftnät', country: 'SE', status: 'ok', every: '5m', lastOk: MOCK_TIMESTAMP, error: null, records: 4 },
    { id: 'energinet', name: 'Energi Data Service', country: 'DK', status: 'ok', every: '5m', lastOk: MOCK_TIMESTAMP, error: null, records: 5 },
  ],
  coverage: { sourceCount: 2, reportingSources: 2, metricCount: 9, flowCount: 1, countries: ['DK', 'SE'] },
};

beforeEach(() => {
  vi.mocked(fetchEnergyOverview).mockReset();
  vi.mocked(fetchEnergyHistory).mockReset();
  vi.mocked(fetchEnergyAnalysis).mockReset();
  vi.mocked(fetchAssets).mockReset();
  vi.mocked(fetchStaticGeo).mockReset();

  vi.mocked(fetchEnergyOverview).mockResolvedValue(MOCK_OVERVIEW);
  vi.mocked(fetchEnergyHistory).mockResolvedValue({ series: [], count: 0 });
  vi.mocked(fetchEnergyAnalysis).mockResolvedValue({ observations: [] });
  vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
  vi.mocked(fetchStaticGeo).mockResolvedValue(null);
});

describe('EnergyDashboard', () => {
  test('gives the Nordic grid map a full dashboard row and large default viewport', async () => {
    localStorage.removeItem('nw-energy-mapsize');
    const { container } = render(<EnergyDashboard country="ALL" />);
    expect(await screen.findByText('Nordic Energy Situation')).toBeInTheDocument();
    const mainGrid = container.querySelector('.energy-main-grid');
    expect(mainGrid.firstElementChild).toHaveClass('energy-map-card');
    expect(mainGrid.lastElementChild).toHaveClass('energy-assessment');
    expect(container.querySelector('.energy-map-card .mapbox')).toHaveClass('mapbox-size-L');
    expect(container.querySelector('.energy-map-card .map-workspace')).toBeInTheDocument();
  });

  test('renders energy dashboard and KPI sections with data', async () => {
    render(<EnergyDashboard country="ALL" />);
    expect(await screen.findByText('Nordic Energy Situation')).toBeInTheDocument();
    expect(screen.getByText('Production · Sverige')).toBeInTheDocument();
    expect(screen.getByText('Consumption · Sverige')).toBeInTheDocument();
    expect(screen.getByText('Day-ahead price · Sverige')).toBeInTheDocument();
    expect(screen.getByText('Renewable output · Danmark')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Danmarks produktionsmix')).toHaveLength(2);
    expect(screen.getByLabelText('Finlands produktionsmix')).toBeInTheDocument();
    expect(screen.getByLabelText('Islands produktionsmix')).toBeInTheDocument();
    expect(screen.getByText('Generation mix · reported country technologies')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Nordic energy data coverage' })).toBeInTheDocument();
    expect(screen.getAllByText('4 indicators').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No measurement').length).toBeGreaterThan(0);
  });

  test('country selector in the energy heading updates the global country scope', async () => {
    const onCountryChange = vi.fn();
    render(<EnergyDashboard country="SE" onCountryChange={onCountryChange} />);
    const selector = await screen.findByRole('combobox', { name: 'Select energy dashboard country' });
    expect(selector).toHaveValue('SE');
    fireEvent.change(selector, { target: { value: 'NO' } });
    expect(onCountryChange).toHaveBeenCalledWith('NO');
  });

  test('country scope control is placed in a prominent toolbar below the page heading', async () => {
    const { container } = render(<EnergyDashboard country="SE" />);
    const toolbar = container.querySelector('.energy-country-toolbar');
    expect(toolbar).toBeInTheDocument();
    expect(toolbar.querySelector('select')).toHaveValue('SE');
    expect(toolbar).toHaveTextContent('Showing country-specific indicators for Sverige');
  });

  test('historical trend and price movement widgets exclude other countries in a selected scope', async () => {
    vi.mocked(fetchEnergyHistory).mockResolvedValue({
      count: 4,
      series: [
        { country:'SE', source:'svk', indicator:'Total produktion (SE)', unit:'MW',
          points:[{ value:100, ts:'2026-11-07T08:00:00Z' }, { value:120, ts:'2026-11-07T09:00:00Z' }] },
        { country:'DK', source:'energinet', indicator:'Total produktion (DK)', unit:'MW',
          points:[{ value:200, ts:'2026-11-07T08:00:00Z' }, { value:220, ts:'2026-11-07T09:00:00Z' }] },
        { country:'SE', source:'svk', indicator:'Dag-ahead-pris SE3', unit:'SEK/MWh',
          points:[{ value:30, ts:'2026-11-07T08:00:00Z' }, { value:35, ts:'2026-11-07T09:00:00Z' }] },
        { country:'DK', source:'energinet', indicator:'Dag-ahead-pris DK1', unit:'DKK/MWh',
          points:[{ value:20, ts:'2026-11-07T08:00:00Z' }, { value:25, ts:'2026-11-07T09:00:00Z' }] },
      ],
    });
    render(<EnergyDashboard country="SE" />);
    expect(await screen.findByText('SE · Production')).toBeInTheDocument();
    expect(screen.queryByText('DK · Production')).not.toBeInTheDocument();
    expect(screen.getByText('SE · SE3')).toBeInTheDocument();
    expect(screen.queryByText('DK · DK1')).not.toBeInTheDocument();
  });

  test('country selection renders only country-specific generation and KPI measurements', async () => {
    render(<EnergyDashboard country="SE" />);
    expect(await screen.findByText('Generation & demand · Sverige')).toBeInTheDocument();
    expect(screen.getByText('Production · Sverige')).toBeInTheDocument();
    expect(screen.queryByText('Production · Danmark')).not.toBeInTheDocument();
    expect(screen.queryByText('Wind + solar · Denmark')).not.toBeInTheDocument();
    expect(screen.queryByText('Denmark (regional overview)')).not.toBeInTheDocument();
    expect(fetchEnergyOverview).toHaveBeenCalledWith('SE');
    expect(fetchEnergyHistory).toHaveBeenCalledWith('SE', '24h');
    expect(fetchEnergyAnalysis).toHaveBeenCalledWith('SE');
    expect(fetchAssets).toHaveBeenCalledWith(1, 'SE');
  });

  test('historical measurements only offer and chart the selected country series', async () => {
    vi.mocked(fetchEnergyHistory).mockResolvedValue({
      count: 4,
      series: [
        { country:'SE', source:'svk', indicator:'Total produktion (SE)', unit:'MW',
          points:[{ value:100, ts:'2026-11-07T08:00:00Z' }, { value:120, ts:'2026-11-07T09:00:00Z' }] },
        { country:'DK', source:'energinet', indicator:'Total produktion (DK)', unit:'MW',
          points:[{ value:200, ts:'2026-11-07T08:00:00Z' }, { value:220, ts:'2026-11-07T09:00:00Z' }] },
      ],
    });
    render(<EnergyDashboard country="SE" />);
    expect(await screen.findByRole('button', { name:/SE Total produktion \(SE\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name:/DK Total produktion \(DK\)/ })).not.toBeInTheDocument();
    expect(screen.getByText('SE · svk · MW')).toBeInTheDocument();
    expect(screen.queryByText('DK · energinet · MW')).not.toBeInTheDocument();
  });

  test('historical trend chart labels both axes and exposes exact point readings', async () => {
    vi.mocked(fetchEnergyHistory).mockResolvedValue({
      count: 2,
      series: [{
        country:'SE', source:'svk', indicator:'Total produktion (SE)', unit:'MW',
        points:[
          { value:100, ts:'2026-11-07T08:00:00Z' },
          { value:120, ts:'2026-11-07T09:00:00Z' },
        ],
      }],
    });
    const { container } = render(<EnergyDashboard country="SE" />);
    const chart = await screen.findByRole('img', {
      name:/Total produktion \(SE\) historical trend, value axis in MW, time axis in UTC/,
    });
    expect(chart).toBeInTheDocument();
    expect(container.querySelector('.energy-chart svg text')).toHaveTextContent('MW');
    expect(container.querySelector('.energy-chart svg')).toHaveTextContent('Time (UTC)');
    const pointTitles = [...container.querySelectorAll('.energy-chart svg circle title')].map(node => node.textContent);
    expect(pointTitles).toHaveLength(2);
    expect(pointTitles[0]).toContain('100 MW');
    expect(pointTitles[1]).toContain('120 MW');
    expect(pointTitles[1]).toContain('2026-11-07');
  });

  test('Finland shows its reported wind, hydro, nuclear and CHP components', async () => {
    render(<EnergyDashboard country="FI" />);
    expect(await screen.findByText('Reported generation technologies · Finland')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Finlands produktionsmix')).toHaveLength(2);
    expect(screen.getAllByText(/Hydro: 250 MW/)).toHaveLength(2);
    expect(screen.getAllByText(/Nuclear: 300 MW/)).toHaveLength(2);
    expect(screen.getAllByText(/not an exhaustive generation mix/)).toHaveLength(2);
    expect(screen.getByText('Reported renewable components · Finland')).toBeInTheDocument();
    expect(screen.getByText('Wind + hydro (reported)')).toBeInTheDocument();
    expect(screen.getByText(/partial coverage, not a full renewable share/)).toBeInTheDocument();
  });

  test('Iceland shows geothermal, hydro and oil instead of a wind/solar placeholder', async () => {
    render(<EnergyDashboard country="IS" />);
    expect(await screen.findByText('Reported generation technologies · Island')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Islands produktionsmix')).toHaveLength(2);
    expect(screen.getAllByText(/Geothermal: 200 MW/)).toHaveLength(2);
    expect(screen.getAllByText(/Hydro: 300 MW/)).toHaveLength(2);
    expect(screen.getAllByText(/Oil: 10 MW/)).toHaveLength(2);
  });

  test('renders market comparisons and price spread list without error', async () => {
    render(<EnergyDashboard country="ALL" />);
    expect(await screen.findByText('Aligned Nordic price spreads')).toBeInTheDocument();
    expect(screen.getByText(/5,3 EUR\/MWh/)).toBeInTheDocument();
    expect(screen.getByText(/2 bidding zones/)).toBeInTheDocument();
  });

  test('renders empty comparisons gracefully without crashing', async () => {
    vi.mocked(fetchEnergyOverview).mockResolvedValue({
      ...MOCK_OVERVIEW,
      marketComparisons: [],
    });
    render(<EnergyDashboard country="ALL" />);
    expect(await screen.findByText('Aligned Nordic price spreads')).toBeInTheDocument();
    expect(screen.getByText(/No aligned cross-country price snapshots yet/)).toBeInTheDocument();
  });

  test('renders reserve capacity table', async () => {
    render(<EnergyDashboard country="ALL" />);
    expect(await screen.findByText('Reserve capacity market · aFRR / mFRR')).toBeInTheDocument();
    expect(screen.getByText('Published capacity')).toBeInTheDocument();
    expect(screen.getByText('aFRR')).toBeInTheDocument();
  });

  test('displays error message when overview fetch fails', async () => {
    vi.mocked(fetchEnergyOverview).mockRejectedValue(new Error('Network offline'));
    render(<EnergyDashboard country="ALL" />);
    expect(await screen.findByText(/Kunde inte uppdatera energivyn: Network offline/)).toBeInTheDocument();
  });
});
