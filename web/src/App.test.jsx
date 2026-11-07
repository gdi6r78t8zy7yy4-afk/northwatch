// App (M6): routing (/, /d/:id, okänd → översikt), land persisteras i
// localStorage, dashboardhämtning varje 30 s och backend-ned-läget.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App.jsx';

vi.mock('./api.js');
import { fetchDashboards, fetchSummary, fetchDashboard, fetchAssets, fetchStaticGeo } from './api.js';

const NOW = Date.now();

const DASHBOARDS = {
  generatedAt: NOW,
  areas: [
    { id: 1, slug: 'energi', name: 'Elförsörjning och energisystem', short: 'Energi', geo: true },
    { id: 2, slug: 'digital', name: 'Elektronisk kommunikation och digital infrastruktur', short: 'Digital infrastruktur', geo: true },
  ],
  areaMatrix: [],
};

beforeEach(() => {
  vi.mocked(fetchDashboards).mockReset();
  vi.mocked(fetchSummary).mockReset();
  vi.mocked(fetchDashboard).mockReset();
  vi.mocked(fetchAssets).mockReset();
  vi.mocked(fetchStaticGeo).mockReset();
  window.location.hash = '';
});

const defaults = () => {
  vi.mocked(fetchDashboards).mockResolvedValue(DASHBOARDS);
  vi.mocked(fetchSummary).mockResolvedValue({
    generatedAt: NOW,
    kpis: { total: 0, ok: 0, stale: 0, no_key: 0, error: 0 },
    areas: [], top: [], health: [],
  });
  vi.mocked(fetchDashboard).mockImplementation(async id => ({
    area: DASHBOARDS.areas.find(a => a.id === Number(id)),
    records: [],
    sources: [],
  }));
  vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
  vi.mocked(fetchStaticGeo).mockResolvedValue(null);
};

describe('App', () => {
  test('översikten + en navlänk per område', async () => {
    defaults();
    render(<App />);
    expect(await screen.findByText('Översikt – alla dashboardområden')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Energi' })).toHaveAttribute('href', '#/energy');
    expect(screen.getByRole('link', { name: '2. Digital infrastruktur' })).toBeInTheDocument();
  });

  test('okänd ruta omdirigeras till översikten', async () => {
    defaults();
    window.location.hash = '#/spärrat';
    render(<App />);
    await waitFor(() => {
      expect(window.location.hash).toBe('#/');
    });
    expect(screen.getByText('Översikt – alla dashboardområden')).toBeInTheDocument();
  });

  test('/d/:id öppnar områdets dashboard med karta (geo)', async () => {
    defaults();
    window.location.hash = '#/d/1';
    render(<App />);
    expect(await screen.findByText('1. Elförsörjning och energisystem')).toBeInTheDocument();
    expect(screen.getByText('Karta')).toBeInTheDocument();
  });

  test('land persisteras i localStorage (nw-country)', async () => {
    defaults();
    window.localStorage.setItem('nw-country', 'FI');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('FI'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NO' } });
    expect(window.localStorage.getItem('nw-country')).toBe('NO');
    expect(screen.getByRole('combobox')).toHaveValue('NO');
  });

  test('backend down: pill och tom områdeslista', async () => {
    vi.mocked(fetchDashboards).mockRejectedValue(new Error('nås inte'));
    vi.mocked(fetchSummary).mockRejectedValue(new Error('nås inte'));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByText('Backend ej nåbar')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '1. Energi' })).not.toBeInTheDocument();
  });

  test('hämtar om dashboarden varje 30 s', async () => {
    vi.useFakeTimers();
    try {
      defaults();
      render(<App />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(vi.mocked(fetchDashboards)).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(vi.mocked(fetchDashboards)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
