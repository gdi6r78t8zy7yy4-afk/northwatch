// DashboardPage (M6) – den gemensamma sidan bakom alla 12 dashboard:
// hämtar-/fel-/okänt-område-lägen, karta bara när area.geo, statusaggregering,
// källor, luckor och 30 s-hämtning.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DashboardPage from './DashboardPage.jsx';

vi.mock('../api.js');
import { fetchDashboard, fetchAssets, fetchStaticGeo } from '../api.js';

const now = Date.now();

const AREA_GEO = {
  id: 3, slug: 'transport', name: 'Transport och logistik', short: 'Transport',
  geo: true, scope: 'Snabbt bildläge över nordisk transport.', gaps: 'Klass C: portaler ej verifierade.',
};
const AREA_NOGEO = {
  ...AREA_GEO, id: 5, slug: 'cyber', name: 'Cybersäkerhet', short: 'Cyber', geo: false,
};

const PAYLOAD = (area = AREA_GEO, sources = [
  { id: 'trafikverket', name: 'Trafikverket (SE)', country: 'SE', status: 'ok', lastOk: now, error: null },
]) => ({
  area,
  records: [
    { t: 'm', indicator: 'Antal flödesmätare', country: 'SE', value: 176, unit: 'st', sourceName: 'Trafikverket', ts: now },
    { t: 'e', title: 'Ledbanning E4', country: 'SE', severity: 'high', sourceName: 'Trafikverket', start: now,
      geo: { type: 'LineString', coordinates: [[13, 58], [14, 59]] } },
  ],
  sources,
});

const renderPage = (id, country = 'ALL') =>
  render(
    <MemoryRouter initialEntries={[`/d/${id}`]}>
      <Routes>
        <Route path="/d/:id" element={<DashboardPage country={country} />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(fetchDashboard).mockReset();
  vi.mocked(fetchAssets).mockReset();
  vi.mocked(fetchStaticGeo).mockReset();
});

describe('DashboardPage', () => {
  test('lägeland tills backend svarat', async () => {
    let resolveDashboard;
    vi.mocked(fetchDashboard).mockReturnValue(new Promise(res => { resolveDashboard = res; }));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage(3);
    expect(screen.getByText('Hämtar dashboard 3…')).toBeInTheDocument();
    resolveDashboard(PAYLOAD());
    expect(await screen.findByText('3. Transport och logistik')).toBeInTheDocument();
    expect(screen.queryByText(/Hämtar dashboard/)).not.toBeInTheDocument();
  });

  test('felfärd med meddelande när backend misslycks', async () => {
    vi.mocked(fetchDashboard).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage(3);
    expect(await screen.findByText('Kunde inte hämta dashboard')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 500 – är backend uppe\?/)).toBeInTheDocument();
  });

  test('okänt område → Okänt område', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD());
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage('abc');
    expect(screen.getByText('Okänt område')).toBeInTheDocument();
    await act(async () => {}); // släpp löpande hämtningar inom act
  });

  test('komplett rendering: rubrik, karta (geo), indikatorer, händelser, källor, luckor', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD());
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [
      { id: 'st1', name: 'Stockholm C', type: 'station', source: 'trafikverket', geometry: { type: 'Point', coordinates: [18.07, 59.33] }, attrs: {} },
    ]});
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage(3);

    expect(await screen.findByText('3. Transport och logistik')).toBeInTheDocument();
    expect(screen.getByText('Karta')).toBeInTheDocument(); // MapPanel – geo: true
    expect(screen.getByText('Snabbt bildläge över nordisk transport.')).toBeInTheDocument();
    expect(screen.getByText('Antal flödesmätare')).toBeInTheDocument();
    expect(screen.getByText('176')).toBeInTheDocument();
    expect(screen.getByText('Ledbanning E4')).toBeInTheDocument();
    expect(screen.getByText('Trafikverket (SE)')).toBeInTheDocument();
    expect(screen.getByText(/Klass C: portaler ej verifierade\./)).toBeInTheDocument();
    // 'OK' finns även i källtabellen – aggregerad status är pillen i rubriken.
    expect(screen.getByText('OK', { selector: 'h1 .pill' })).toHaveClass('st-ok');
  });

  test('område utan karta (geo: false) renderar ingen MapPanel', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_NOGEO));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage(5);
    expect(await screen.findByText('5. Cybersäkerhet')).toBeInTheDocument();
    expect(screen.queryByText('Karta')).not.toBeInTheDocument();
  });

  test('huvudstatus aggregeras: error > no_key > stale > ok, none utan källor', async () => {
    const src = (status, id = 's1') => ({ id, name: 'Källa', country: 'SE', status, lastOk: now, error: null });
    const cases = [
      [[src('ok'), src('no_key', 's2')], 'Saknar nyckel', 'st-warn'],
      [[src('ok'), src('error', 's2')], 'Fel', 'st-err'],
      [[src('ok'), src('stale', 's2')], 'Föråldrad', 'st-warn'],
      [[src('ok')], 'OK', 'st-ok'],
      [[], 'Ingen källa', 'st-none'],
    ];
    for (const [sources, label, cls] of cases) {
      vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_GEO, sources));
      vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
      vi.mocked(fetchStaticGeo).mockResolvedValue(null);
      const { unmount } = renderPage(3);
      const pill = await screen.findByText(label, { selector: 'h1 .pill' });
      expect(pill).toHaveClass(cls);
      unmount();
    }
  });

  test('hämtar om dashboard och aseter varje 30 s (staticGeo bara en gång)', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD());
      vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
      vi.mocked(fetchStaticGeo).mockResolvedValue(null);
      renderPage(3);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(vi.mocked(fetchDashboard)).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(vi.mocked(fetchDashboard)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetchAssets)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(fetchStaticGeo)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
