// DashboardPage (M6) – den gemensamma sidan bakom alla 12 dashboard:
// hämtar-/fel-/okänt-område-lägen, karta bara när area.geo, statusaggregering,
// källor, luckor och 30 s-hämtning. M8: väderprognos (SMHI snow1g) i område 11.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DashboardPage from './DashboardPage.jsx';
import { __fireLeaf } from '../test/leafletMock.js';

vi.mock('../api.js');
import {
  fetchDashboard, fetchAssets, fetchStaticGeo,
  fetchForecastMeta, fetchForecastPoint, fetchForecastGrid, fetchForecastGridCoords,
  fetchCyberNvd, fetchCyberKev, fetchCyberOsv, fetchCyberPrioritized,
} from '../api.js';

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
  vi.mocked(fetchForecastMeta).mockReset();
  vi.mocked(fetchForecastPoint).mockReset();
  vi.mocked(fetchForecastGrid).mockReset();
  vi.mocked(fetchForecastGridCoords).mockReset();
  vi.mocked(fetchCyberNvd).mockReset();
  vi.mocked(fetchCyberKev).mockReset();
  vi.mocked(fetchCyberOsv).mockReset();
  vi.mocked(fetchCyberPrioritized).mockReset();
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

// M8: område 11 (geo: true) kopplar in SMHI snow1g-prognosen: meta delas
// mellan karta (prognosrutnät) och panel (punktprognoser), klick på kartan
// ger anpassad plats, övriga områden har ingen prognoslogik alls.
describe('DashboardPage – väderprognos (M8, område 11)', () => {
  // Fixturens tider ligger i det förflutna → nu-steget = sista (TIMES[2]),
  // deterministiskt oavsett när testerna körs.
  const TIMES = ['2026-11-05T10:00:00Z', '2026-11-05T11:00:00Z', '2026-11-05T12:00:00Z'];
  const AREA_WX = {
    id: 11, slug: 'miljo', name: 'Miljö, naturhändelser och klimatpåverkan',
    short: 'Miljö/Väder', geo: true,
    scope: 'Nordiskt väder, snö, kraft och naturhändelser.',
    gaps: 'SMHI-prognosen täcker inte Island.',
  };
  const WX_META = {
    ready: true,
    createdTime: '2026-11-05T10:15:00Z',
    referenceTime: TIMES[0],
    times: TIMES,
    points: [
      { name: 'Stockholm', lon: 18.07, lat: 59.33, country: 'SE', outsideDomain: false },
      { name: 'Reykjavik', lon: -21.94, lat: 64.15, country: 'IS', outsideDomain: true },
    ],
    grid: { downsample: 20, parameters: ['air_temperature'] },
  };
  const gridOk = {
    ok: true, status: 200,
    body: {
      parameter: 'air_temperature', time: TIMES[2], createdTime: WX_META.createdTime,
      downsample: 20, count: 4, values: [2, 8, -5, 9999],
    },
  };
  const coordsOk = {
    ok: true, status: 200,
    body: { downsample: 20, count: 4, coordinates: [[10, 58], [12, 58], [10, 60], [12, 60]] },
  };
  const pointOk = {
    ok: true, status: 200,
    body: {
      point: { name: 'Stockholm', lon: 18.07, lat: 59.33, country: 'SE' },
      createdTime: WX_META.createdTime,
      referenceTime: TIMES[0],
      times: TIMES,
      timeSeries: TIMES.map((t, i) => ({
        time: t,
        data: {
          air_temperature: 2 + i, wind_speed: 5, wind_speed_of_gust: 10,
          wind_from_direction: 90, precipitation_amount_mean: 0,
          symbol_code: 1, predominant_precipitation_type_at_surface: 0,
        },
      })),
    },
  };

  const renderWxPage = async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_WX));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    vi.mocked(fetchForecastMeta).mockResolvedValue({ ok: true, status: 200, body: WX_META });
    vi.mocked(fetchForecastPoint).mockResolvedValue(pointOk);
    vi.mocked(fetchForecastGrid).mockResolvedValue(gridOk);
    vi.mocked(fetchForecastGridCoords).mockResolvedValue(coordsOk);
    const view = renderPage(11);
    await screen.findByText('11. Miljö, naturhändelser och klimatpåverkan');
    return view;
  };

  test('område 11: panel + kartrutnät kopplas in; autoval ger 6 grafer', async () => {
    const { container } = await renderWxPage();

    expect(fetchForecastMeta).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Väderprognos (SMHI snow1g)')).toBeInTheDocument();
    // Kartan hämtar rutnätet vid cykelns nu-steg (sista – allt är förflutet).
    await waitFor(() => expect(fetchForecastGrid).toHaveBeenCalledWith('air_temperature', TIMES[2], 20));
    await waitFor(() => expect(fetchForecastGridCoords).toHaveBeenCalledWith(20));
    // Panelen autovaljerar första inomdomän-staden → punktprognos → 6 grafer.
    await waitFor(() => expect(container.querySelectorAll('.fchart').length).toBe(6));
    expect(fetchForecastPoint).toHaveBeenCalledWith({ name: 'Stockholm' });
  });

  test('klick på kartan → anpassad plats (2 decimaler) + punktprognos per lat/lon', async () => {
    await renderWxPage();

    __fireLeaf('click', { latlng: { lat: 59.325, lng: 18.065 } });
    expect(await screen.findByText('📍 Anpassad plats (59.33, 18.07)')).toBeInTheDocument();
    expect(fetchForecastPoint).toHaveBeenCalledWith({ lat: 59.33, lon: 18.07 });

    // Rensa anpassad plats via rensningsknappen
    const clearBtn = screen.getByTitle('Tillbaka till katalogstäderna');
    fireEvent.click(clearBtn);
    expect(screen.queryByText('📍 Anpassad plats (59.33, 18.07)')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Val av stad' })).toBeInTheDocument();
  });

  test('klick på kartan med ogiltiga/icke-numeriska koordinater ignoreras', async () => {
    await renderWxPage();

    __fireLeaf('click', { latlng: { lat: NaN, lng: 18.065 } });
    expect(screen.queryByText(/Anpassad plats/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Val av stad' })).toBeInTheDocument();
  });

  test('fel vid hämtning av punktprognos (t.ex. 429 rate limit) visas i panelen', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_WX));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    vi.mocked(fetchForecastMeta).mockResolvedValue({ ok: true, status: 200, body: WX_META });
    vi.mocked(fetchForecastPoint).mockResolvedValue({
      ok: false,
      status: 429,
      body: { error: 'För många anpassade prognosförfrågningar' },
    });
    vi.mocked(fetchForecastGrid).mockResolvedValue(gridOk);
    vi.mocked(fetchForecastGridCoords).mockResolvedValue(coordsOk);
    renderPage(11);

    expect(await screen.findByText('För många anpassade prognosförfrågningar')).toBeInTheDocument();
  });

  test('annat område: ingen prognospanel, inga prognosfrågor', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_GEO));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage(3);
    expect(await screen.findByText('3. Transport och logistik')).toBeInTheDocument();
    expect(screen.queryByText('Väderprognos (SMHI snow1g)')).not.toBeInTheDocument();
    expect(fetchForecastMeta).not.toHaveBeenCalled();
    expect(fetchForecastPoint).not.toHaveBeenCalled();
    expect(fetchForecastGrid).not.toHaveBeenCalled();
    expect(fetchForecastGridCoords).not.toHaveBeenCalled();
  });
});

// M9: cyber (område 5) – de fyra widgeterna ersätter de generiska
// indikator-/händelse-tabellerna; övriga områden hämtar aldrig /api/cyber/*.
// Renderingsdetaljer för varje panel täcks i cyberPanels.test.jsx – här
// verifieras kopplingen (vilka paneler som sätts in var).
describe('DashboardPage – cyber (M9, område 5)', () => {
  const rejectCyber = () => {
    for (const fn of [fetchCyberNvd, fetchCyberKev, fetchCyberOsv, fetchCyberPrioritized]) {
      vi.mocked(fn).mockRejectedValue(new Error('test: ingen källa'));
    }
  };

  test('område 5: fyra cyberpaneler, ingen generell tabell, ett anrop per källa', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_NOGEO));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    rejectCyber();
    const { container } = renderPage(5);

    expect(await screen.findByText('5. Cybersäkerhet')).toBeInTheDocument();
    // Alla fyra panelramarna sätts in (och pratar med rätt endpoint vardera).
    expect(screen.getByText('NVD – nya sårbarheter (senaste 30 d)')).toBeInTheDocument();
    expect(screen.getByText('CISA KEV – kända exploaterade sårbarheter')).toBeInTheDocument();
    expect(screen.getByText('OSV.dev – paketutbud och rapporter')).toBeInTheDocument();
    expect(screen.getByText('Prioriterade exploaterade sårbarheter (KEV × NVD)')).toBeInTheDocument();
    expect(container.querySelector('.cyber-grid')).not.toBeNull();
    expect(fetchCyberNvd).toHaveBeenCalledTimes(1);
    expect(fetchCyberKev).toHaveBeenCalledTimes(1);
    expect(fetchCyberOsv).toHaveBeenCalledTimes(1);
    expect(fetchCyberPrioritized).toHaveBeenCalledTimes(1);
    // De generiska tabellerna ersätts av widgeterna.
    expect(screen.queryByText('Indikatorer')).not.toBeInTheDocument();
    expect(screen.queryByText('Händelser och larm')).not.toBeInTheDocument();
    // Källkartan och luckorna finns kvar under widgeterna.
    expect(screen.getByText('Källor för området')).toBeInTheDocument();
    expect(screen.getByText('Kända luckor (enligt API-katalogen)')).toBeInTheDocument();
  });

  test('annat område: inga cyberpaneler, inga /api/cyber-frågor', async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(PAYLOAD(AREA_GEO));
    vi.mocked(fetchAssets).mockResolvedValue({ assets: [] });
    vi.mocked(fetchStaticGeo).mockResolvedValue(null);
    renderPage(3);

    expect(await screen.findByText('3. Transport och logistik')).toBeInTheDocument();
    expect(screen.queryByText('NVD – nya sårbarheter (senaste 30 d)')).not.toBeInTheDocument();
    expect(screen.queryByText('CISA KEV – kända exploaterade sårbarheter')).not.toBeInTheDocument();
    expect(screen.queryByText('OSV.dev – paketutbud och rapporter')).not.toBeInTheDocument();
    expect(screen.queryByText('Prioriterade exploaterade sårbarheter (KEV × NVD)')).not.toBeInTheDocument();
    expect(fetchCyberNvd).not.toHaveBeenCalled();
    expect(fetchCyberKev).not.toHaveBeenCalled();
    expect(fetchCyberOsv).not.toHaveBeenCalled();
    expect(fetchCyberPrioritized).not.toHaveBeenCalled();
    expect(screen.getByText('Indikatorer')).toBeInTheDocument();
    expect(screen.getByText('Händelser och larm')).toBeInTheDocument();
  });
});
