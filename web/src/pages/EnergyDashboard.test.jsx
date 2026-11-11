import { test, expect, describe, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EnergyDashboard from './EnergyDashboard.jsx';

vi.mock('../api.js', () => ({
  fetchEnergyOverview: vi.fn(),
  fetchEnergyHistory: vi.fn(),
  fetchEnergyAnalysis: vi.fn(),
  fetchAssets: vi.fn(),
  fetchStaticGeo: vi.fn(),
}));

import {
  fetchEnergyOverview, fetchEnergyHistory, fetchEnergyAnalysis, fetchAssets, fetchStaticGeo,
} from '../api.js';

const TS = '2026-11-11T12:00:00.000Z';

const MOCK_OVERVIEW = {
  generatedAt: TS, country: 'ALL',
  metrics: [
    { t: 'm', area: 1, country: 'SE', source: 'elprisetjustnu', sourceName: 'Elpriset just nu', indicator: 'Dag-ahead-pris SE1', value: 0.42, unit: 'SEK/kWh', ts: TS },
    { t: 'm', area: 1, country: 'SE', source: 'elprisetjustnu', sourceName: 'Elpriset just nu', indicator: 'Dag-ahead-pris SE2', value: 0.38, unit: 'SEK/kWh', ts: TS },
    { t: 'm', area: 1, country: 'NO', source: 'eds-dayahead', sourceName: 'Energi Data Service – Dag-ahead-priser', indicator: 'Dag-ahead-pris NO2', value: 145.2, unit: 'EUR/MWh', ts: TS },
    { t: 'm', area: 1, country: 'DK', source: 'energidataservice', sourceName: 'Energi Data Service', indicator: 'Total produktion (DK)', value: 3400, unit: 'MW', ts: TS },
    { t: 'm', area: 1, country: 'DK', source: 'energidataservice', sourceName: 'Energi Data Service', indicator: 'Total förbrukning (DK)', value: 3100, unit: 'MW', ts: TS },
    { t: 'm', area: 1, country: 'DK', source: 'energidataservice', sourceName: 'Energi Data Service', indicator: 'Vindproduktion (DK)', value: 1500, unit: 'MW', ts: TS },
    { t: 'm', area: 1, country: 'DK', source: 'energidataservice', sourceName: 'Energi Data Service', indicator: 'Solproduktion (DK)', value: 300, unit: 'MW', ts: TS },
    { t: 'm', area: 1, country: 'DK', source: 'energinet-live', sourceName: 'Energinet Right Now', indicator: 'CO2-intensitet (DK)', value: 105.4, unit: 'g CO2/kWh', ts: TS },
    { t: 'm', area: 1, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät', indicator: 'aFRR-kapacitet SE4 up', value: 250, unit: 'MW', ts: TS },
    { t: 'm', area: 1, country: 'SE', source: 'svk', sourceName: 'Svenska kraftnät', indicator: 'aFRR-kapacitetspris SE4 up', value: 187.5, unit: 'EUR/MWh', ts: TS },
  ],
  flows: [{ t: 'a', area: 1, country: 'NORDIC', source: 'svk', type: 'flow', name: 'SE3→DK1',
    attrs: { mw: -420, from: 'SE3', to: 'DK1' }, updated: TS, sourceName: 'Svenska kraftnät' }],
  marketComparisons: [{ asOf: Date.parse(TS), unit: 'SEK/kWh', zoneCount: 2, spread: 0.04,
    low: { zone: 'SE2', value: 0.38, country: 'SE' }, high: { zone: 'SE1', value: 0.42, country: 'SE' },
    observations: [{ zone: 'SE1', country: 'SE', value: 0.42, sourceName: 'Elpriset just nu' }] }],
  sources: [
    { id: 'svk', name: 'Svenska kraftnät', country: 'SE', status: 'ok', every: 900, lastOk: TS, records: 120 },
    { id: 'fingrid', name: 'Fingrid Open Data', country: 'FI', status: 'no_key', every: 600, lastOk: null, records: 0 },
  ],
  coverage: { sourceCount: 5, reportingSources: 4, metricCount: 80, flowCount: 12 },
};

const MOCK_HISTORY = { series: [{ country: 'SE', source: 'elprisetjustnu', indicator: 'Dag-ahead-pris SE1', unit: 'SEK/kWh', points: [
  { ts: '2026-11-11T10:00:00.000Z', value: 40 }, { ts: '2026-11-11T11:00:00.000Z', value: 50 }] }], count: 2 };

const MOCK_ANALYSIS = { observations: [{ id: 'obs-1', severity: 'info', title: 'Prisspridning SE1–SE2',
  summary: 'Sammanfattning', observedAt: TS, confidence: 'high', caveat: 'Obs!', evidence: [] }], methodology: 'Deterministisk metod.' };

function renderDashboard(entry = '/energy') {
  return render(<MemoryRouter initialEntries={[entry]}><EnergyDashboard country="ALL" onCountryChange={vi.fn()}/></MemoryRouter>);
}

beforeEach(() => {
  fetchEnergyOverview.mockReset().mockResolvedValue(structuredClone(MOCK_OVERVIEW));
  fetchEnergyHistory.mockReset().mockResolvedValue(structuredClone(MOCK_HISTORY));
  fetchEnergyAnalysis.mockReset().mockResolvedValue(structuredClone(MOCK_ANALYSIS));
  fetchAssets.mockReset().mockResolvedValue({ assets: [] });
  fetchStaticGeo.mockReset().mockResolvedValue({});
});

describe('Energiwidget-dashboarden', () => {
  test('renderar hela widgetgrupperingen i fast ordning', async () => {
    const { container } = renderDashboard();
    await screen.findByText('Dag-spotpriser');
    expect(container.querySelectorAll('.nw-widget').length).toBe(11);
    for (const title of ['Nordiskt elnät', 'Produktion & förbrukning', 'Inrikesbalans', 'Produktionsmix',
      'CO₂-intensitet', 'Gränsflöden', 'Reservmarknad', 'Prisspridning elområden', 'Analysobservationer', 'Källor & täckning'])
      expect(screen.getByText(title)).toBeInTheDocument();
  });

  test('visar senaste priser, balans och flöden med källans enheter', async () => {
    renderDashboard();
    await screen.findByText('Dag-spotpriser');
    expect(screen.getByText(/145,2/)).toBeInTheDocument(); // NO2 EUR/MWh behålls
    expect(screen.getByText('+300 MW')).toBeInTheDocument(); // DK inrikesbalans
    expect(screen.getByText('DK1 → SE3')).toBeInTheDocument(); // negativt flöde vänder etiketten
  });

  test('klick på kort öppnar modalförstoring med historik och stänger med Esc', async () => {
    renderDashboard();
    const card = (await screen.findByText('Dag-spotpriser')).closest('.nw-widget');
    fireEvent.click(card);
    await screen.findByRole('dialog');
    expect(fetchEnergyHistory).toHaveBeenCalledWith('ALL', '24h');
    await waitFor(() => expect(screen.getAllByText('Dag-ahead-pris SE1').length).toBeGreaterThan(0));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('klick på en elområdescell öppnar modalen filtrerad på zonen', async () => {
    renderDashboard();
    await screen.findByText('Dag-spotpriser');
    fireEvent.click(screen.getByText(/^SE1 · SE$/));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/Dag-spotpriser/);
    expect(dialog.textContent).toContain('· SE1');
  });

  test('djuplänk via ?w=pris öppnar modalen direkt', async () => {
    renderDashboard('/energy?w=pris');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/Dag-spotpriser/);
  });

  test('kartwidgetens modal är bred så kartan får rimlig yta', async () => {
    renderDashboard('/energy?w=karta');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('nw-modal-wide');
  });

  test('källwidgeten visar källor utan nyckel och modalen listar kollektorkuren', async () => {
    renderDashboard('/energy?w=kallor');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Fingrid Open Data');
    expect(dialog.textContent).toContain('Svenska kraftnät');
  });

  test('tomma dataluckor benämner saknad källa i stället för nollor', async () => {
    fetchEnergyOverview.mockResolvedValue({ ...structuredClone(MOCK_OVERVIEW), metrics: [], flows: [] });
    renderDashboard();
    await screen.findByText(/Finska priser saknas|Inga dag-ahead-prisintervall/);
  });

  test('analysobservationer visas på kort och i modal', async () => {
    renderDashboard('/energy?w=analys');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Prisspridning SE1–SE2');
    expect(dialog.textContent).toContain('Deterministisk metod.');
  });

  test('återhämtning av historik cachelagras per land och intervall', async () => {
    renderDashboard();
    const card = (await screen.findByText('Dag-spotpriser')).closest('.nw-widget');
    fireEvent.click(card);
    await waitFor(() => expect(fetchEnergyHistory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '7 d' }));
    await waitFor(() => expect(fetchEnergyHistory).toHaveBeenCalledWith('ALL', '7d'));
    // tillbaka till 24 h ska träffa cache, inte nätet
    fireEvent.click(screen.getByRole('button', { name: '24 h' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchEnergyHistory).toHaveBeenCalledTimes(2);
  });
});
