// MapPanel (M6) – alla 6 kartdashboarden (områden med geo: true) delar
// denna komponent, så detta testpaket täcker kartfunktionen i alla:
//  – kartvalet flyttas ALDRIG vid datauppdatering (30 s-buggen)
//  – vy sätts vid områdes/landsbyte, när gränsdata blir klart, manuellt
//  – storlek S/M/L: höjd, persistens, återställning, invalidateSize
//  – lager: punkter, flöden, energi, händelser, gränser, legend, tomt läge
// Leaflet är deterministiskt mockat (src/test/leafletMock.js).
import { test, expect, describe, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MapPanel from './MapPanel.jsx';
import { __leaf, __resetLeaflet } from '../test/leafletMock.js';

const GEO = {
  countries: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Sverige', code: 'SE' }, geometry: { type: 'Polygon', coordinates: [[[11, 55], [24, 55], [24, 69], [11, 69], [11, 55]]] } },
      { type: 'Feature', properties: { name: 'Norge', code: 'NO' }, geometry: { type: 'Polygon', coordinates: [[[5, 58], [31, 58], [31, 71], [5, 71], [5, 58]]] } },
    ],
  },
  energy: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'zone', zone: 'SE2' }, geometry: { type: 'Point', coordinates: [15, 58] } },
      { type: 'Feature', properties: { kind: 'link', name: 'Hvdc SE–NO', mw: 1000, status: 'färdig' }, geometry: { type: 'LineString', coordinates: [[12, 59], [11, 58]] } },
      { type: 'Feature', properties: { kind: 'link', name: 'Hvdc planerad', mw: 500, status: 'planerad', note: '2031' }, geometry: { type: 'LineString', coordinates: [[12, 59], [13, 60]] } },
    ],
  },
};

const point = (over = {}) => ({
  id: 'p1', name: 'Anläggning', type: 'kraftanläggning', source: 'osm',
  geometry: { type: 'Point', coordinates: [18, 59.3] }, attrs: {},
  ...over,
});

const lineEvent = (title = 'Vägarbete') => ({
  title, geo: { type: 'LineString', coordinates: [[15, 60], [16, 61]] },
});

const renderMap = (props = {}) =>
  render(
    <MapPanel
      area={{ id: 3 }}
      country="ALL"
      assets={[]}
      staticGeo={GEO}
      events={[]}
      {...props}
    />,
  );

describe('MapPanel – kartval (M6)', () => {
  test('initial vy för "alla länder" är hela Norden', () => {
    renderMap();
    expect(__leaf.view.at(-1)).toEqual({ type: 'setView', center: [64.5, 8], zoom: 4 });
  });

  test('valt land → fitBounds till landets utbredning', () => {
    renderMap({ country: 'SE' });
    expect(__leaf.view.at(-1).type).toBe('fitBounds');
    expect(__leaf.view.at(-1).opts).toEqual({ maxZoom: 7 });
  });

  test('30 s-uppdatering (nya assets/events-referenser) flyttar inte vy', () => {
    const assets1 = [
      point({ id: 'a1', name: 'Mätare A', type: 'flowmatning', source: 'trafikverket' }),
      point({ id: 'a2', name: 'Station B', type: 'station', source: 'trafikverket' }),
    ];
    const events1 = [lineEvent('E1'), lineEvent('E2')];
    const { rerender } = renderMap({ country: 'SE', assets: assets1, events: events1 });

    // Vy ligger nu på Sverige.
    expect(__leaf.view.at(-1).type).toBe('fitBounds');
    const viewsBefore = __leaf.view.length;
    const clearsBefore = __leaf.clearLayers;

    // Simulerar 30 s-hämtningen: nya referenser, samma innehåll.
    const assets2 = assets1.map(a => ({ ...a }));
    const events2 = events1.map(e => ({ ...e }));
    rerender(
      <MapPanel area={{ id: 3 }} country="SE" assets={assets2} staticGeo={GEO} events={events2} />,
    );

    expect(__leaf.view.length).toBe(viewsBefore); // inga nya vy-anrop
    expect(__leaf.clearLayers).toBe(clearsBefore + 1); // …men lagren ritades om
  });

  test('landsbyte sätter ny vy; "alla länder" tillbaka till Norden', () => {
    const { rerender } = renderMap({ country: 'SE' });
    expect(__leaf.view.at(-1).type).toBe('fitBounds');

    rerender(<MapPanel area={{ id: 3 }} country="NO" assets={[]} staticGeo={GEO} events={[]} />);
    expect(__leaf.view.at(-1).type).toBe('fitBounds');
    expect(__leaf.view.filter(v => v.type === 'fitBounds')).toHaveLength(2);

    rerender(<MapPanel area={{ id: 3 }} country="ALL" assets={[]} staticGeo={GEO} events={[]} />);
    expect(__leaf.view.at(-1)).toEqual({ type: 'setView', center: [64.5, 8], zoom: 4 });
  });

  test('land valt innan gränsdata är laddat väntar (ingen fallback-vy)', () => {
    const { rerender } = renderMap({ country: 'SE', staticGeo: null });
    expect(__leaf.view.filter(v => v.type === 'fitBounds')).toHaveLength(0);

    rerender(<MapPanel area={{ id: 3 }} country="SE" assets={[]} staticGeo={GEO} events={[]} />);
    expect(__leaf.view.at(-1).type).toBe('fitBounds');
  });

  test('"Återställ vy" sätter om vy manuellt', () => {
    renderMap({ country: 'SE' });
    const before = __leaf.view.length;
    fireEvent.click(screen.getByRole('button', { name: 'Återställ vy' }));
    const added = __leaf.view.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe('fitBounds');
  });
});

describe('MapPanel – storlek S/M/L (M6)', () => {
  test('standard M (420 px); knapparna sätter höjd och persisterar valet', () => {
    const { container } = renderMap();
    const box = container.querySelector('.mapbox');
    expect(box).toHaveStyle({ height: '420px' });
    expect(window.localStorage.getItem('nw-mapsize')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(box).toHaveStyle({ height: '580px' });
    expect(window.localStorage.getItem('nw-mapsize')).toBe('L');
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'S' }));
    expect(box).toHaveStyle({ height: '260px' });
    expect(window.localStorage.getItem('nw-mapsize')).toBe('S');
    expect(screen.getByRole('button', { name: 'S' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('storleksändring kallar invalidateSize (Leaflet behöver nya måtten)', async () => {
    vi.useFakeTimers();
    try {
      renderMap();
      await act(async () => { vi.advanceTimersByTime(10); });
      const before = __leaf.invalidateSize;
      expect(before).toBeGreaterThanOrEqual(1); // från mount

      fireEvent.click(screen.getByRole('button', { name: 'L' }));
      await act(async () => { vi.advanceTimersByTime(10); });
      expect(__leaf.invalidateSize).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  test('sparad storlek återställs vid nästa montering', () => {
    window.localStorage.setItem('nw-mapsize', 'S');
    const { container } = renderMap();
    expect(container.querySelector('.mapbox')).toHaveStyle({ height: '260px' });
    expect(screen.getByRole('button', { name: 'S' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('ogiltig sparad storlek → M', () => {
    window.localStorage.setItem('nw-mapsize', 'XXL');
    const { container } = renderMap();
    expect(container.querySelector('.mapbox')).toHaveStyle({ height: '420px' });
  });
});

describe('MapPanel – lager', () => {
  test('punkteraseter ritas med typfärg, radie och popup', () => {
    renderMap({
      assets: [
        point({ id: 'ix1', name: 'StockholmIX', type: 'ix', source: 'peeringdb' }),
        point({ id: 'dc1', name: 'DC Norr', type: 'datacenter' }),
        point({ id: 'fm1', name: 'Mätare 1', type: 'flowmatning', source: 'trafikverket' }),
        point({ id: 'st1', name: 'Stockholm C', type: 'station', source: 'trafikverket' }),
      ],
    });
    const byPopup = txt => __leaf.created.find(c => c.kind === 'circleMarker' && c.popup && c.popup.includes(txt));
    expect(byPopup('StockholmIX').options.fillColor).toBe('#7c5cd6'); // ix
    expect(byPopup('StockholmIX').options.radius).toBe(4.5);
    expect(byPopup('DC Norr').options.fillColor).toBe('#9b3fd4'); // datacenter
    expect(byPopup('Mätare 1').options.fillColor).toBe('#e0a52e'); // flowmatning
    expect(byPopup('Mätare 1').options.radius).toBe(3.5);
    expect(byPopup('Stockholm C').options.fillColor).toBe('#c2418f'); // station
    // popups bär namn + typ + källa
    expect(byPopup('StockholmIX').popup).toContain('Internetutbyte (IX)');
    expect(byPopup('StockholmIX').popup).toContain('peeringdb');
  });

  test('speedkameror (M7) med egen färg, liten radie, popup och legendpost', () => {
    renderMap({
      assets: [
        point({ id: 'k1', name: 'Marbäck', type: 'kamera', source: 'trafikverket',
          attrs: { Väg: 'Väg 25', Län: 'Halland' } }),
      ],
    });
    const cam = __leaf.created.find(c => c.kind === 'circleMarker' && c.popup?.includes('Marbäck'));
    expect(cam.options.fillColor).toBe('#2f9e44'); // kamera
    expect(cam.options.radius).toBe(2.5);          // ~900 punkter – ryms bättre
    expect(cam.popup).toContain('Speedkamera (Trafikverket)');
    expect(cam.popup).toContain('Halland');
    expect(screen.getByText('Speedkamera (huvudvägar)')).toBeInTheDocument();
  });

  test('flöden gröna i exportriktning, röda i motriktning', () => {
    renderMap({
      assets: [
        { id: 'f1', name: 'SE→NO', type: 'flow', source: 'statnett', geometry: { type: 'LineString', coordinates: [[11, 59], [12, 60]] }, attrs: { mw: 1200 } },
        { id: 'f2', name: 'NO→SE', type: 'flow', source: 'statnett', geometry: { type: 'LineString', coordinates: [[12, 60], [11, 59]] }, attrs: { mw: -800 } },
      ],
    });
    const byTooltip = t => __leaf.created.find(c => c.kind === 'polyline' && c.tooltip && c.tooltip.text.includes(t));
    expect(byTooltip('1200 MW').options.color).toBe('#2e9e5b');
    expect(byTooltip('800 MW').options.color).toBe('#d4574a');
  });

  test('energilager (endast område 1): zonskilda + planerad länk streckad', () => {
    renderMap({ area: { id: 1 } });
    const zones = __leaf.created.filter(c => c.kind === 'circleMarker' && c.tooltip);
    expect(zones.map(z => z.tooltip.text)).toContain('SE2');
    const planned = __leaf.created.find(c => c.kind === 'polyline' && c.tooltip?.text?.includes('Hvdc planerad'));
    expect(planned.options.dashArray).toBe('6 6');
    const done = __leaf.created.find(c => c.kind === 'polyline' && c.tooltip?.text?.includes('Hvdc SE–NO'));
    expect(done.options.dashArray).toBeNull();
  });

  test('inga energilager i andra områden', () => {
    renderMap({ area: { id: 3 } });
    expect(__leaf.created.filter(c => c.kind === 'circleMarker' && c.tooltip)).toHaveLength(0);
  });

  test('händelser med geo ritas som röda geoJSON-lager', () => {
    renderMap({ events: [lineEvent()] });
    const ev = __leaf.created.find(c => c.kind === 'geoJSON' && c.options?.style?.color === '#d4574a');
    expect(ev).toBeTruthy();
    expect(ev.options.style.weight).toBe(2.5);
  });

  test('valda land framhävs i gränslagret; alla länder = jämn markering', () => {
    const { unmount } = renderMap({ country: 'SE' });
    const border = __leaf.created.find(c => c.kind === 'geoJSON' && typeof c.options?.style === 'function');
    expect(border).toBeTruthy();
    const sel = border.options.style({ properties: { code: 'SE' } });
    const other = border.options.style({ properties: { code: 'NO' } });
    expect(sel.weight).toBe(2.5);
    expect(other.weight).toBe(1.2);
    expect(other.opacity).toBeLessThan(sel.opacity);

    unmount();
    __resetLeaflet();
    renderMap({ country: 'ALL' });
    const all = __leaf.created.find(c => c.kind === 'geoJSON' && typeof c.options?.style === 'function');
    const none = all.options.style({ properties: { code: 'NO' } });
    expect(none.weight).toBe(1.2);
    expect(none.opacity).toBe(0.9);
  });

  test('legenden visar bara lager som faktiskt finns', () => {
    renderMap({
      assets: [
        point({ id: 'ix1', name: 'IX', type: 'ix', source: 'peeringdb' }),
        point({ id: 'fm1', name: 'FM', type: 'flowmatning', source: 'trafikverket' }),
      ],
    });
    expect(screen.getByText('Landsgränser')).toBeInTheDocument();
    expect(screen.getByText('Internetutbyte (IX)')).toBeInTheDocument();
    expect(screen.getByText('Flödesmätare (topp 25)')).toBeInTheDocument();
    expect(screen.queryByText('Fartyg (AIS)')).not.toBeInTheDocument();
    expect(screen.queryByText('Järnvägsstation')).not.toBeInTheDocument();
    expect(screen.queryByText('Speedkamera (huvudvägar)')).not.toBeInTheDocument();
    expect(screen.queryByText('Trafikhändelse')).not.toBeInTheDocument();
  });

  test('tomt meddelande när inga dynamiska lager finns', () => {
    renderMap();
    expect(screen.getByText(/Inga dynamiska geolager just nu/)).toBeInTheDocument();
  });

  test('inget tomt meddelande när det finns aseter', () => {
    renderMap({ assets: [point()] });
    expect(screen.queryByText(/Inga dynamiska geolager/)).not.toBeInTheDocument();
  });

  test('karta rivs vid unmount', () => {
    const { unmount } = renderMap();
    expect(__leaf.removed).toBe(0);
    unmount();
    expect(__leaf.removed).toBe(1);
  });
});
