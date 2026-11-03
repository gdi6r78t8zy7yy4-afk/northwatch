// HealthTable (M6): källrader med ömrelänk, status, senast OK och fel.
import { test, expect, describe } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HealthTable from './HealthTable.jsx';

const now = Date.now();
const AREAS = [{ id: 3, short: 'Transport', name: 'Transport och logistik' }];

const renderTable = health =>
  render(
    <MemoryRouter>
      <HealthTable health={health} areas={AREAS} />
    </MemoryRouter>,
  );

describe('HealthTable', () => {
  test('en rad per källa med ömrelänk, status, senast OK och fel', () => {
    renderTable([
      { id: 'trafikverket', name: 'Trafikverket API', area: 3, country: 'SE', status: 'ok', lastOk: now, error: null },
      { id: 'smhi', name: 'SMHI', area: 99, country: 'NORDIC', status: 'error', lastOk: null, error: '503' },
    ]);
    expect(screen.getByText('Trafikverket API')).toBeInTheDocument();
    expect(screen.getByText('3. Transport')).toHaveAttribute('href', '/d/3');
    expect(screen.getByText('Nordiskt')).toBeInTheDocument();
    expect(screen.getByText('OK', { selector: '.pill' })).toHaveClass('st-ok');
    // 'Fel' finns också som kolumnrubrik – begränsa till statuspillen.
    expect(screen.getByText('Fel', { selector: '.pill' })).toHaveClass('st-err');
    expect(screen.getByText('503')).toBeInTheDocument();
  });

  test('status → färgklass (ok/error/stale/no_key/running)', () => {
    renderTable([
      { id: 'a', name: 'A', area: 1, country: 'SE', status: 'ok', lastOk: null, error: null },
      { id: 'b', name: 'B', area: 1, country: 'SE', status: 'stale', lastOk: null, error: null },
      { id: 'c', name: 'C', area: 1, country: 'SE', status: 'no_key', lastOk: null, error: null },
      { id: 'd', name: 'D', area: 1, country: 'SE', status: 'running', lastOk: null, error: null },
    ]);
    const pills = screen.getAllByText(/^(OK|Föråldrad|Saknar nyckel|Hämtar…)$/);
    expect(pills[0]).toHaveClass('st-ok');
    expect(pills[1]).toHaveClass('st-warn');
    expect(pills[2]).toHaveClass('st-warn');
    expect(pills[3]).toHaveClass('st-mut');
  });

  test('senast OK visas med formaterad tid och ålder', () => {
    renderTable([{ id: 't', name: 'T', area: 1, country: 'SE', status: 'ok', lastOk: now - 120_000, error: null }]);
    expect(screen.getByText(/2 min sedan/)).toBeInTheDocument();
  });

  test('– när det saknas senast OK', () => {
    renderTable([{ id: 't', name: 'T', area: 1, country: 'SE', status: 'ok', lastOk: null, error: null }]);
    // '–' visas i både "Senast OK"- och "Fel"-kolumnen.
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(1);
  });

  test('tomt meddelande när det saknas källor', () => {
    renderTable([]);
    expect(screen.getByText('Inga källor registrerade ännu.')).toBeInTheDocument();
  });
});
