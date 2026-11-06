// SMHI-prognospanel (M8, område 11): tillstånden (lägeland → väntar →
// klar), katalogautoval, 404 utanför domänen, 503, anpassad plats med
// ✕-knapp, 9999 → saknat värde, tidsskrov i yyyy-mm-dd hh:mm UTC.
// api.js mockas helt – inget nätverk.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WeatherForecastPanel from './WeatherForecastPanel.jsx';

vi.mock('../api.js');
import { fetchForecastPoint } from '../api.js';

const TIMES = Array.from({ length: 13 }, (_, i) =>
  `2026-11-05T${String(i).padStart(2, '0')}:00:00Z`);

// Katalogn i produkten har 11 städer (Reykjavik utanför domänen) –
// speglad här i urval för autoval-testet.
const CATALOG11 = [
  { name: 'Stockholm', lon: 18.07, lat: 59.33, country: 'SE', outsideDomain: false },
  { name: 'Göteborg', lon: 11.97, lat: 57.7, country: 'SE', outsideDomain: false },
  { name: 'Malmö', lon: 12.99, lat: 55.6, country: 'SE', outsideDomain: false },
  { name: 'Umeå', lon: 20.25, lat: 63.83, country: 'SE', outsideDomain: false },
  { name: 'Kiruna', lon: 20.22, lat: 67.86, country: 'SE', outsideDomain: false },
  { name: 'Oslo', lon: 10.75, lat: 59.91, country: 'NO', outsideDomain: false },
  { name: 'Trondheim', lon: 9.1, lat: 63.43, country: 'NO', outsideDomain: false },
  { name: 'Tromsø', lon: 18.96, lat: 69.65, country: 'NO', outsideDomain: false },
  { name: 'Helsingfors', lon: 24.94, lat: 60.17, country: 'FI', outsideDomain: false },
  { name: 'Köpenhamn', lon: 12.57, lat: 55.68, country: 'DK', outsideDomain: false },
  { name: 'Reykjavik', lon: -21.94, lat: 64.15, country: 'IS', outsideDomain: true },
];
const CATALOG = [
  CATALOG11[0], CATALOG11[1], CATALOG11[10], // Stockholm, Göteborg, Reykjavik
];

const META = (over = {}) => ({
  ready: true,
  createdTime: '2026-11-05T00:15:00Z',
  referenceTime: '2026-11-05T00:00:00Z',
  times: TIMES,
  points: CATALOG,
  grid: { downsample: 20, parameters: ['air_temperature'] },
  ...over,
});

// Punktprognos i samma form som /api/forecast/point svarar. Temp är 9999 på
// steg 2 (saknat värde) och 2+i annars.
const pointBody = (over = {}) => ({
  point: { name: 'Stockholm', lon: 18.07, lat: 59.33, country: 'SE' },
  createdTime: META().createdTime,
  referenceTime: META().referenceTime,
  times: TIMES,
  timeSeries: TIMES.map((t, i) => ({
    time: t,
    data: {
      air_temperature: i === 2 ? 9999 : 2 + i,
      wind_speed: 5,
      wind_speed_of_gust: 10,
      wind_from_direction: 90,
      precipitation_amount_mean: 0,
      precipitation_amount_max: 0,
      thunderstorm_probability: 0,
      probability_of_frozen_precipitation: 0,
      air_pressure_at_mean_sea_level: 1013,
      relative_humidity: 70,
      visibility_in_air: 20,
      symbol_code: 1,
      predominant_precipitation_type_at_surface: 0,
    },
  })),
  ...over,
});

const okPoint = { ok: true, status: 200, body: pointBody() };

const renderPanel = (props = {}) =>
  render(<WeatherForecastPanel meta={META()} {...props} />);

beforeEach(() => {
  vi.mocked(fetchForecastPoint).mockReset();
});

describe('WeatherForecastPanel – tillstånd', () => {
  test('meta saknas → lägeland', () => {
    render(<WeatherForecastPanel meta={null} />);
    expect(screen.getByText('Hämtar prognosstatus…')).toBeInTheDocument();
  });

  test('meta ej redo → väntar på första cykeln', () => {
    render(<WeatherForecastPanel meta={{ ready: false, points: CATALOG, grid: META().grid }} />);
    expect(screen.getByText(/Väntar på första prognoscykeln/)).toBeInTheDocument();
  });

  test('503 från backend → felmeddelande, ingen stacktrace', async () => {
    vi.mocked(fetchForecastPoint).mockResolvedValue({
      ok: false, status: 503, body: { error: 'Prognoscykeln är inte klar ännu' },
    });
    const { container } = renderPanel();
    expect(await screen.findByText('Prognoscykeln är inte klar ännu')).toBeInTheDocument();
    // Inga grafer utan punktdata; felförklaringen ersätter "Hämtar…" raden.
    expect(container.querySelectorAll('.fchart')).toHaveLength(0);
    expect(screen.queryByText(/Hämtar prognos för/)).not.toBeInTheDocument();
  });
});

describe('WeatherForecastPanel – klar cykel', () => {
  test('autoval av första inomdomän-punkten, grafer + väderbildsläsvärde', async () => {
    vi.mocked(fetchForecastPoint).mockResolvedValue(okPoint);
    const { container } = renderPanel();

    // Alla tidssteg i fixturen ligger i det förflutna → "nu" = sista steget.
    const select = await screen.findByRole('combobox', { name: 'Val av stad' });
    expect(select).toHaveValue('Stockholm');
    await waitFor(() => expect(container.querySelectorAll('.fchart').length).toBe(6));

    // Väderbilden för valt steg: symbol 1 → "Klart", ptype 0 → "Ingen nederbörd".
    const cond = container.querySelector('.fcond');
    expect(cond).toBeTruthy();
    expect(cond.textContent).toContain('Klart');
    expect(cond.textContent).toContain('Ingen nederbörd');
    // Steg 12: temp 2+12 = 14 °C, vind O (90°).
    expect(cond.textContent).toContain('14 °C');
    expect(cond.textContent).toContain('(O)');

    // Cykelhuvud med standardformat.
    expect(screen.getByText(/Cykel skapad 2026-11-05 00:15 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/13 timsteg/)).toBeInTheDocument();
  });

  test('katalogen visar alla 11 städer; utanfördomän markerad', async () => {
    vi.mocked(fetchForecastPoint).mockResolvedValue(okPoint);
    const { container } = renderPanel({ meta: META({ points: CATALOG11 }) });
    await screen.findByRole('combobox', { name: 'Val av stad' });
    const options = [...container.querySelectorAll('select option')];
    expect(options).toHaveLength(11);
    expect(options.at(-1).textContent).toBe('Reykjavik (utanför domänen)');
  });

  test('404 för utanfördomän-punkt → förklarande meddelande', async () => {
    vi.mocked(fetchForecastPoint).mockImplementation(({ name }) => Promise.resolve(
      name === 'Reykjavik'
        ? { ok: false, status: 404, body: { error: 'Platsen ligger utanför SMHI:s prognosområde (snow1g)' } }
        : okPoint,
    ));
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelectorAll('.fchart').length).toBe(6));

    fireEvent.change(screen.getByRole('combobox', { name: 'Val av stad' }), {
      target: { value: 'Reykjavik' },
    });
    expect(await screen.findByText(/utanför SMHI:s prognosområde/)).toBeInTheDocument();
    expect(container.querySelectorAll('.fchart')).toHaveLength(0);
  });
});

describe('WeatherForecastPanel – anpassad plats (klick på kartan)', () => {
  test('customPoint → chip med ✕; frågan går på lat/lon; ✕ raderar', async () => {
    const onClear = vi.fn();
    vi.mocked(fetchForecastPoint).mockResolvedValue(okPoint);
    const { container } = renderPanel({
      customPoint: { name: 'Anpassad plats (59.33, 18.07)', lat: 59.33, lon: 18.07 },
      onClearCustom: onClear,
    });

    expect(screen.queryByRole('combobox', { name: 'Val av stad' })).toBeNull();
    expect(await screen.findByText('📍 Anpassad plats (59.33, 18.07)')).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetchForecastPoint))
      .toHaveBeenCalledWith({ lat: 59.33, lon: 18.07 }));

    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.fchart').length).toBeGreaterThan(0);
  });
});

describe('WeatherForecastPanel – tidsskrov', () => {
  test('skrov uppdaterar läsvärdet i yyyy-mm-dd hh:mm UTC; 9999 → –', async () => {
    vi.mocked(fetchForecastPoint).mockResolvedValue(okPoint);
    const { container } = renderPanel();
    const cond = () => container.querySelector('.fcond');

    await waitFor(() => expect(cond()).toBeTruthy());
    // "Nu" (sista steget) visat vid start:
    expect(screen.getByText('2026-11-05 12:00 UTC')).toBeInTheDocument();

    // Skruva till steg 2 – där är temp 9999 → renderas som "–".
    fireEvent.change(screen.getByLabelText('Tidssteg i prognosen'), { target: { value: '2' } });
    expect(screen.getByText('2026-11-05 02:00 UTC')).toBeInTheDocument();
    expect(cond().textContent).toContain('– °C');

    // "Nu"-knappen återgår till nu-steget.
    fireEvent.click(screen.getByRole('button', { name: 'Nu' }));
    expect(screen.getByText('2026-11-05 12:00 UTC')).toBeInTheDocument();
    expect(cond().textContent).toContain('14 °C');
  });
});
