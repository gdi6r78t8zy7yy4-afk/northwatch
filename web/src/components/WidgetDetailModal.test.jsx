import { describe, expect, test, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WidgetDetailModal from './WidgetDetailModal.jsx';

const WIDGET = { id: 'pris', title: 'Dag-spotpriser', hint: 'Publicerade day-ahead-intervall per elområde' };

const SERIES = [{
  country: 'SE', source: 'elprisetjustnu', indicator: 'Dag-ahead-pris SE1', unit: 'SEK/kWh',
  points: [
    { ts: '2026-11-11T09:00:00.000Z', value: 40 },
    { ts: '2026-11-11T10:00:00.000Z', value: 50 },
    { ts: '2026-11-11T11:00:00.000Z', value: 45 },
  ],
}];

const OBSERVATIONS = [{
  country: 'SE', source: 'elprisetjustnu', sourceName: 'Elpriset just nu', indicator: 'Dag-ahead-pris SE1',
  value: 45, unit: 'SEK/kWh', ts: '2026-11-11T11:00:00.000Z',
}];

function renderModal(overrides = {}) {
  const props = {
    widget: WIDGET, country: 'ALL', getSeries: vi.fn().mockResolvedValue(SERIES),
    observations: OBSERVATIONS, onClose: vi.fn(), ...overrides,
  };
  const view = render(<WidgetDetailModal {...props}/>);
  return { ...view, props };
}

describe('WidgetDetailModal', () => {
  test('loads the default range and renders chart plus raw observations', async () => {
    const { props } = renderModal();
    await waitFor(() => expect(screen.getAllByText('Dag-ahead-pris SE1').length).toBeGreaterThan(0));
    expect(props.getSeries).toHaveBeenCalledWith('24h');
    expect(screen.getByRole('dialog', { name: /Dag-spotpriser/ })).toBeInTheDocument();
    expect(screen.getByText(/Förändring \+5 SEK\/kWh · 3 mätpunkter/)).toBeInTheDocument();
    expect(screen.getAllByText('Elpriset just nu').length).toBeGreaterThan(0);
  });

  test('range switcher refetches history through getSeries', async () => {
    const { props } = renderModal();
    await waitFor(() => expect(props.getSeries).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '7 d' }));
    await waitFor(() => expect(props.getSeries).toHaveBeenCalledWith('7d'));
    expect(screen.getByRole('button', { name: '7 d' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('item selection narrows the chart to the clicked zone', async () => {
    const twoZones = [SERIES[0], { ...SERIES[0], indicator: 'Dag-ahead-pris SE2' }];
    renderModal({ item: { id: 'SE1', label: 'SE1' }, getSeries: vi.fn().mockResolvedValue(twoZones) });
    await waitFor(() => expect(screen.getAllByText('Dag-ahead-pris SE1').length).toBeGreaterThan(0));
    expect(screen.queryByText('Dag-ahead-pris SE2')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('SE1');
  });

  test('Escape stänger dialogen', async () => {
    const { props } = renderModal();
    await waitFor(() => expect(props.getSeries).toHaveBeenCalled());
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('backdrop mousedown closes but clicks inside the panel do not', async () => {
    const { props } = renderModal();
    await waitFor(() => expect(props.getSeries).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Stäng' }).closest('.nw-modal'));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.querySelector('.nw-modal-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  test('close button receives autofocus on open', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stäng' })).toHaveFocus());
  });

  test('body scroll is locked while open and restored after unmount', async () => {
    const { props, unmount } = renderModal();
    await waitFor(() => expect(props.getSeries).toHaveBeenCalled());
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  test('widgets without series render children instead of charts', () => {
    render(<WidgetDetailModal widget={{ id: 'karta', title: 'Nordiskt elnät', hint: 'Karta' }}
      country="ALL" onClose={vi.fn()}>
      <p>Kartinnehåll</p>
    </WidgetDetailModal>);
    expect(screen.getByText('Kartinnehåll')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Tidsintervall' })).not.toBeInTheDocument();
  });

  test('failed history fetch shows an honest error instead of empty charts', async () => {
    renderModal({ getSeries: vi.fn().mockRejectedValue(new Error('nätverksfel')) });
    await waitFor(() => expect(screen.getByText(/Historiken kunde inte hämtas: nätverksfel/)).toBeInTheDocument());
  });

  test('empty history explains that no series exist yet', async () => {
    renderModal({ getSeries: vi.fn().mockResolvedValue([]) });
    await waitFor(() => expect(screen.getByText(/Inga historiserade serier matchar detta urval/)).toBeInTheDocument());
  });
});
