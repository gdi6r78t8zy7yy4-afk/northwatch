// Frontendets API-lag (M6): URL-avtal och staticGeo-memoisering.
// fetch stubbas – inget nätverk.
import { test, expect, beforeEach, afterEach, vi } from 'vitest';

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
