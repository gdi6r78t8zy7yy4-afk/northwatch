// SummaryPage (M6): KPI:er, statusmatris, senaste händelser, källhälsa,
// fallbacklista, backend-down/fel-lägen och 30 s-hämtning.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SummaryPage from './SummaryPage.jsx';

vi.mock('../api.js');
import { fetchSummary } from '../api.js';

const now = Date.now();

const SUMMARY = {
  generatedAt: now,
  kpis: { total: 34, ok: 27, stale: 2, no_key: 4, error: 1 },
  areas: [
    {
      id: 1, short: 'Energi', name: 'Elförsörjning och energisystem', status: 'ok',
      cells: { SE: { status: 'ok', count: 3 }, NO: { status: 'ok', count: 0 }, NORDIC: { status: 'ok', count: 1 } },
    },
    { id: 2, short: 'Digital infrastruktur', name: 'Elektronisk kommunikation', status: 'stale', cells: {} },
  ],
  top: [
    { t: 'e', title: 'Ledbanning E4', country: 'SE', sourceName: 'Trafikverket', start: now },
    { t: 'm', indicator: 'Zonflöde SE→NO', country: 'NORDIC', sourceName: 'Statnett', ts: now },
  ],
  health: [
    { id: 'trafikverket', name: 'Trafikverket API', area: 1, country: 'SE', status: 'ok', lastOk: now, error: null },
  ],
};

const renderSummary = (props = {}) =>
  render(
    <MemoryRouter>
      <SummaryPage areas={[]} backendDown={false} {...props} />
    </MemoryRouter>,
  );

beforeEach(() => { vi.mocked(fetchSummary).mockReset(); });

describe('SummaryPage', () => {
  test('KPI:er: totalt, OK, föråldrad+nyckellös, fel', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(SUMMARY);
    renderSummary();
    expect(await screen.findByText('Källor totalt')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument(); // 2 stale + 4 no_key
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  test('matris: en rad per område, celler med punkt + antal, – för saknad data', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(SUMMARY);
    renderSummary();
    // '1. Energi' finns även som länk i källhälsan – begränsa till matriscellens <b>.
    expect(await screen.findByText('1. Energi', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('2. Digital infrastruktur')).toBeInTheDocument();
    expect(screen.getByText('3 poster')).toBeInTheDocument();
    expect(screen.getByText('1 post')).toBeInTheDocument();
    // område 1: 3 tomma celler (DK/FI/IS) + område 2: 6 (inga celler) → 9 –
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(9);
    // statuspunkter: område 1 har celler för SE/NO/NORDIC
    expect(document.querySelectorAll('.dot').length).toBeGreaterThanOrEqual(3);
  });

  test('klick på rad öppnar områdets dashboard', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(SUMMARY);
    renderSummary();
    const row = await screen.findByText('1. Energi', { selector: 'b' });
    fireEvent.click(row);
    expect(window.location.hash).toBe('#/d/1');
  });

  test('senaste händelser: händelse- och indikatorrader', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(SUMMARY);
    renderSummary();
    expect(await screen.findByText('Ledbanning E4')).toBeInTheDocument();
    expect(screen.getByText('händelse')).toBeInTheDocument();
    expect(screen.getByText('indikator')).toBeInTheDocument();
    expect(screen.getByText('Zonflöde SE→NO')).toBeInTheDocument();
    expect(screen.getByText('Statnett')).toBeInTheDocument();
  });

  test('fallerar till områdeslistan från /api/dashboards innan summary hunnit', () => {
    vi.mocked(fetchSummary).mockReturnValue(new Promise(() => {})); // svarar aldrig
    renderSummary({
      areas: [{ id: 9, short: 'Finans', name: 'Finans och betalningssystem', status: 'none', cells: {} }],
    });
    expect(screen.getByText('9. Finans')).toBeInTheDocument();
  });

  test('backend down → uppmaning utan extra felkort', async () => {
    vi.mocked(fetchSummary).mockRejectedValue(new Error('HTTP 503'));
    renderSummary({ backendDown: true });
    expect(await screen.findByText(/Backend är inte uppe/)).toBeInTheDocument();
    expect(screen.queryByText('Kunde inte hämta status')).not.toBeInTheDocument();
  });

  test('fel i summary (backend uppe) → felkort + ledtråd i händelsekortet', async () => {
    vi.mocked(fetchSummary).mockRejectedValue(new Error('HTTP 503'));
    renderSummary();
    expect(await screen.findByText('Kunde inte hämta status')).toBeInTheDocument();
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();
    expect(screen.getByText(/Backend är inte uppe – starta med `npm run dev`/)).toBeInTheDocument();
    expect(screen.getByText('Inga källor registrerade ännu.')).toBeInTheDocument();
  });

  test('källhälsan ifylls från summaryn', async () => {
    vi.mocked(fetchSummary).mockResolvedValue(SUMMARY);
    renderSummary();
    expect(await screen.findByText('Trafikverket API')).toBeInTheDocument();
  });

  test('hämtar om varje 30 s', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchSummary).mockResolvedValue(SUMMARY);
      renderSummary();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(vi.mocked(fetchSummary)).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(vi.mocked(fetchSummary)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
