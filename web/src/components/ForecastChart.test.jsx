// Handgjord prognosgraf (M8): serieredovisning med gap vid saknade värden,
// pekar→index, tröskellinjer (inuti + kantslättna), nu-markör, akseticks.
// jsdom: getBoundingClientRect ger width 0, så pekar-index = clientX * (n-1)
// är deterministiskt testbart.
import { test, expect, describe, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ForecastChart, { tickLabel, defaultTicks } from './ForecastChart.jsx';

const T = n =>
  Array.from({ length: n }, (_, i) => `2026-11-05T${String(i).padStart(2, '0')}:00:00Z`);
const T13 = T(13);
const T11 = T(11);

const renderChart = (props = {}) =>
  render(
    <ForecastChart
      title="Testserie"
      unit="°C"
      times={T13}
      series={[{ label: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], color: '#00f' }]}
      nowIdx={0}
      {...props}
    />,
  );

describe('tickLabel + defaultTicks', () => {
  test('tickLabel: dd-mm HH:MM i UTC', () => {
    expect(tickLabel('2026-11-05T13:30:00Z')).toBe('05-11 13:30');
    expect(tickLabel('helt-ogiltigt')).toBe('');
  });

  test('defaultTicks: max 7 jämnt ut, first/last med; korta serier', () => {
    expect(defaultTicks(T13)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(defaultTicks(T11)).toEqual(expect.arrayContaining([0, 10]));
    expect(defaultTicks(T11)).toHaveLength(7);
    expect(defaultTicks(['endast-ett'])).toEqual([0]);
    expect(defaultTicks([])).toEqual([]);
  });
});

describe('ForecastChart – rendering', () => {
  test('rubrik med enhet, legend och fyra y-guidlinjer', () => {
    const { container } = renderChart();
    expect(screen.getByText('Testserie (°C)')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(container.querySelectorAll('line.fcgrid')).toHaveLength(4);
  });

  test('7 x-axis-ticks för 13 tidssteg (dd-mm HH:MM)', () => {
    renderChart();
    expect(screen.getByText('05-11 00:00')).toBeInTheDocument();
    expect(screen.getByText('05-11 12:00')).toBeInTheDocument();
  });

  test('samma värde i hela serien → y-span expanderas (ingen division med 0)', () => {
    const { container } = renderChart({
      series: [{ label: 'A', values: Array(13).fill(7), color: '#00f' }],
    });
    expect(container.querySelector('svg path')).toBeTruthy();
  });
});

describe('ForecastChart – serievägen', () => {
  test('sammanhängande värden → en M och L-delar', () => {
    const { container } = renderChart();
    const d = container.querySelector('svg path').getAttribute('d');
    expect(d).toMatch(/^M/);
    expect((d.match(/L/g) || []).length).toBeGreaterThan(5);
  });

  test('null i mitten → avbrott: ett nytt M-segment före första L:et', () => {
    const { container } = renderChart({
      series: [{ label: 'A', values: [1, null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], color: '#00f' }],
    });
    const d = container.querySelector('svg path').getAttribute('d');
    // Första steget står ensamt → nytt M (gap) innan linjen kopplas upp igen.
    expect(d).toMatch(/^M[^L]*M/);
    expect((d.match(/M/g) || []).length).toBeGreaterThanOrEqual(2);
    // Steget efter gapet är sammanhängande → L-delar finns.
    expect(d).toContain('L');
  });

  test('två serier → två vägar (strecksad distinkt markerad)', () => {
    const { container } = renderChart({
      series: [
        { label: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], color: '#00f' },
        { label: 'B', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26], color: '#f00', dashed: true },
      ],
    });
    const paths = [...container.querySelectorAll('svg path')];
    expect(paths).toHaveLength(2);
    const dashed = paths.find(p => p.getAttribute('stroke') === '#f00');
    expect(dashed.getAttribute('stroke-dasharray')).toBe('5 3');
  });
});

describe('ForecastChart – pekar och hover', () => {
  // jsdom har ingen PointerEvent-konstruktor (fireEvent.pointerMove tappar
  // clientX) – dispatcha MouseEvent med typ pointer* i stället; Reacts
  // delegation fångar det och synthetiska eventet bär clientX.
  // jsdom ger getBoundingClientRect().width = 0 → fraktion = clientX/1,
  // dvs. index = round(clientX * (n-1)). Deterministiskt.
  const fire = (el, type, clientX) =>
    el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX }));

  test('pekning mappar x-position till index', () => {
    const onHover = vi.fn();
    const { container } = renderChart({ times: T11, onHover });
    const rect = container.querySelector('svg rect');
    expect(rect).toBeTruthy();

    fire(rect, 'pointermove', 0);
    expect(onHover).toHaveBeenLastCalledWith(0);
    fire(rect, 'pointermove', 0.5);
    expect(onHover).toHaveBeenLastCalledWith(5);
    fire(rect, 'pointerdown', 3); // utöver → kloras till sista
    expect(onHover).toHaveBeenLastCalledWith(10);
  });

  test('pekare utanför plotområdet → onHover(null)', () => {
    // React 18 simulerar pointerleave ur pointerout (leave bubblar inte),
    // så det är pointerout som dispatchas.
    const onHover = vi.fn();
    const { container } = renderChart({ times: T11, onHover });
    fire(container.querySelector('svg rect'), 'pointerout', 0);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  test('saknar onHover → pekning gör inget (inga fel)', () => {
    const { container } = renderChart({ times: T11 });
    expect(() => fire(container.querySelector('svg rect'), 'pointermove', 0.5))
      .not.toThrow();
  });

  test('hover → markeringslinje + en cirkel per serie med värde på steget', () => {
    const { container } = renderChart({
      times: T13,
      hover: 1,
      series: [
        { label: 'A', values: [1, null, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], color: '#00f' },
        { label: 'B', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26], color: '#f00' },
      ],
    });
    expect(container.querySelector('line.fhover')).toBeTruthy();
    // A har null på index 1 → bara B får cirkel.
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });
});

describe('ForecastChart – trösklar och nu-markör', () => {
  test('tröskel inom dataspännet → streckad linje i mitten', () => {
    const { container } = renderChart({
      thresholds: [{ value: 7, label: 'T7', color: '#f00' }],
    });
    const line = [...container.querySelectorAll('line')]
      .find(l => l.getAttribute('stroke') === '#f00');
    expect(line.getAttribute('stroke-dasharray')).toBe('5 4');
    expect(screen.getByText('T7')).toBeInTheDocument();
  });

  test('tröskel ovanför/under → kantslätnad till plotens kanter', () => {
    const { container } = renderChart({
      thresholds: [
        { value: 100, label: 'Ovan', color: '#0f0' },
        { value: -50, label: 'Under', color: '#0ff' },
      ],
    });
    const top = [...container.querySelectorAll('line')].find(l => l.getAttribute('stroke') === '#0f0');
    const bottom = [...container.querySelectorAll('line')].find(l => l.getAttribute('stroke') === '#0ff');
    // Plotområdet: t = 14, b = 14 + (150 - 14 - 26) = 124.
    expect(top.getAttribute('stroke-dasharray')).toBe('2 4');
    expect(top.getAttribute('y1')).toBe('14');
    expect(bottom.getAttribute('stroke-dasharray')).toBe('2 4');
    expect(bottom.getAttribute('y1')).toBe('124');
  });

  test('nu-markör på nuIdx + etikett "nu"; nollinje bara om 0 i spännet', () => {
    const { container } = renderChart({ nowIdx: 0 });
    const now = container.querySelector('line.fnow');
    expect(now).toBeTruthy();
    expect(now.getAttribute('x1')).toBe('48'); // M.l vid index 0
    expect(screen.getByText('nu')).toBeInTheDocument();
    // Värden 1–13 → nollinjen ritas inte.
    expect(container.querySelector('line.fzero')).toBeNull();

    // Negativa värden medföra nollinjen.
    const neg = renderChart({
      nowIdx: 0,
      series: [{ label: 'A', values: [-5, -3, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], color: '#00f' }],
    });
    expect(neg.container.querySelector('line.fzero')).toBeTruthy();
  });
});
