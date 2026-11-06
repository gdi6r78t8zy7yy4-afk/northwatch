// Frontendets API-lag (M6): URL-avtal och staticGeo-memoisering.
// fetch stubbas – inget nätverk.
import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

const json = (body, ok = true, status = 200) => ({
  ok, status, json: async () => body,
});

test('fetchDashboard bygger URL med område och land', async () => {
  const fetchMock = vi.fn(async () => json({}));
  vi.stubGlobal('fetch', fetchMock);
  const { fetchDashboard } = await import('./api.js');
  await fetchDashboard(3, 'SE');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/dashboard/3?country=SE');
});

test('fetchAssets bygger URL med område och land', async () => {
  const fetchMock = vi.fn(async () => json({ assets: [] }));
  vi.stubGlobal('fetch', fetchMock);
  const { fetchAssets } = await import('./api.js');
  await fetchAssets(1, 'FI');
  expect(fetchMock.mock.calls[0][0]).toBe('/api/assets?area=1&country=FI');
});

test('inte-2xx svar blir HTTP <status>', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(null, false, 503)));
  const { fetchHealth } = await import('./api.js');
  await expect(fetchHealth()).rejects.toThrow('HTTP 503');
});

test('fetchStaticGeo memoiseras – fetchas bara en gång', async () => {
  const fetchMock = vi.fn(async () => json({ countries: { features: [] } }));
  vi.stubGlobal('fetch', fetchMock);
  const { fetchStaticGeo } = await import('./api.js');
  await fetchStaticGeo();
  await fetchStaticGeo();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('fetchStaticGeo tillåter retry efter fel', async () => {
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    n += 1;
    if (n === 1) throw new Error('nätverksfel');
    return json({ countries: { features: [] } });
  }));
  const { fetchStaticGeo } = await import('./api.js');
  await expect(fetchStaticGeo()).rejects.toThrow('nätverksfel');
  const geo = await fetchStaticGeo();
  expect(geo).toEqual({ countries: { features: [] } });
});

// M8: SMHI-prognos API:t – URL-avtal + getRaw som INTE kastas vid
// 404/503 (panelen visar dem som tillstånd).
describe('forecast (M8)', () => {
  test('fetchForecastMeta → /api/forecast/meta', async () => {
    const fetchMock = vi.fn(async () => json({ ready: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchForecastMeta } = await import('./api.js');
    const r = await fetchForecastMeta();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/forecast/meta');
    expect(r).toEqual({ status: 200, ok: true, body: { ready: false } });
  });

  test('fetchForecastPoint: namn vs lat/lon', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchForecastPoint } = await import('./api.js');
    await fetchForecastPoint({ name: 'Stockholm' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/forecast/point?point=Stockholm');
    await fetchForecastPoint({ lat: 59.33, lon: 18.07 });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/forecast/point?lat=59.33&lon=18.07');
  });

  test('fetchForecastGrid: parameter, kodad tid, downsample', async () => {
    const fetchMock = vi.fn(async () => json({ values: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchForecastGrid } = await import('./api.js');
    await fetchForecastGrid('air_temperature', '2026-11-05T10:00:00Z', 20);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/forecast/grid?parameter=air_temperature&time=2026-11-05T10%3A00%3A00Z&downsample=20',
    );
    // downsample okänt → tom parameter (servern väljer standard).
    await fetchForecastGrid('wind_speed_of_gust', '2026-11-05T10:00:00Z');
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/forecast/grid?parameter=wind_speed_of_gust&time=2026-11-05T10%3A00%3A00Z&downsample=',
    );
  });

  test('fetchForecastGridCoords → /api/forecast/grid-coords', async () => {
    const fetchMock = vi.fn(async () => json({ coordinates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchForecastGridCoords } = await import('./api.js');
    await fetchForecastGridCoords(20);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/forecast/grid-coords?downsample=20');
  });

  test('getRaw: 404 (utanför domänen) → status + body, ingen exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(
      { error: 'Platsen ligger utanför SMHI:s prognosområde (snow1g)' }, false, 404,
    )));
    const { fetchForecastPoint } = await import('./api.js');
    const r = await fetchForecastPoint({ name: 'Reykjavik' });
    expect(r).toEqual({
      status: 404, ok: false,
      body: { error: 'Platsen ligger utanför SMHI:s prognosområde (snow1g)' },
    });
  });

  test('getRaw: icke-JSON-kropp → body null utan att kasta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new Error('icke-JSON'); },
    })));
    const { fetchForecastMeta } = await import('./api.js');
    const r = await fetchForecastMeta();
    expect(r).toEqual({ status: 200, ok: true, body: null });
  });
});
