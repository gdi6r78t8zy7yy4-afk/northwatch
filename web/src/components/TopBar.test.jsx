// TopBar (M6): navigation, landsval, backendstatus och sista uppdatering.
import { test, expect, describe, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopBar from './TopBar.jsx';

const AREAS = [
  { id: 1, short: 'Energi' },
  { id: 2, short: 'Digital infrastruktur' },
];

const renderTop = (props = {}) =>
  render(
    <MemoryRouter>
      <TopBar
        areas={AREAS}
        gen={new Date('2026-11-03T12:34:56').getTime()}
        backendDown={false}
        country="ALL"
        setCountry={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );

describe('TopBar', () => {
  test('visar översikten och en länk per område', () => {
    renderTop();
    expect(screen.getByRole('link', { name: 'Översikt' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Energi' })).toHaveAttribute('href', '/energy');
    expect(screen.getByRole('link', { name: '2. Digital infrastruktur' })).toHaveAttribute('href', '/d/2');
  });

  test('landsval visar alla länder + alla länder (utan NORDIC)', () => {
    renderTop();
    const select = screen.getByRole('combobox');
    expect(Array.from(select.querySelectorAll('option')).map(o => o.value))
      .toEqual(['ALL', 'SE', 'NO', 'DK', 'FI', 'IS']);
  });

  test('byte av land anropar setCountry med det nya värdet', () => {
    const setCountry = vi.fn();
    renderTop({ setCountry });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NO' } });
    expect(setCountry).toHaveBeenCalledWith('NO');
  });

  test('aktuellt land är valt i listan', () => {
    renderTop({ country: 'FI' });
    expect(screen.getByRole('combobox')).toHaveValue('FI');
  });

  test('Backend ej nåbar visas bara när backendDown', () => {
    const { rerender } = renderTop();
    expect(screen.queryByText('Backend ej nåbar')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <TopBar areas={AREAS} gen={null} backendDown country="ALL" setCountry={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Backend ej nåbar')).toBeInTheDocument();
  });

  test('sista uppdatering visas när gen är satt', () => {
    renderTop();
    expect(screen.getByText(/uppdaterad/)).toBeInTheDocument();
  });

  test('ingen tidsstämpel när gen är tom', () => {
    renderTop({ gen: null });
    expect(screen.queryByText(/uppdaterad/)).not.toBeInTheDocument();
  });
});
