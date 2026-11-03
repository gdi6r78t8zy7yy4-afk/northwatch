// MetricsTable + EventsTable (M6): kolumner, NORDIC→Nordiskt,
// 50-händelsetak och tom-meddelanden.
import { test, expect, describe } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricsTable, EventsTable } from './RecordsTables.jsx';

const now = Date.now();

describe('MetricsTable', () => {
  test('visar indikator, land, värde+enhet, källa och tid', () => {
    render(
      <MetricsTable records={[
        { t: 'm', indicator: 'Zonflöde SE→NO', country: 'NORDIC', value: 1250, unit: 'MW', sourceName: 'Statnett', ts: now },
        { t: 'm', indicator: 'Tom indikator', country: 'SE', value: null, unit: null, sourceName: 'X', ts: now },
        { t: 'e', title: 'måste-inte-visas' },
      ]} />,
    );
    expect(screen.getByText('Zonflöde SE→NO')).toBeInTheDocument();
    expect(screen.getByText('Nordiskt')).toBeInTheDocument();
    expect(screen.getByText('1250')).toBeInTheDocument();
    expect(screen.getByText('MW')).toBeInTheDocument();
    expect(screen.getByText('Statnett')).toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument(); // null-värde → –
    expect(screen.queryByText('måste-inte-visas')).not.toBeInTheDocument();
  });

  test('tomt meddelande när det inte finns några indikatorer', () => {
    render(<MetricsTable records={[{ t: 'e', title: 'x' }]} />);
    expect(screen.getByText(/Inga indikatorvärden just nu/)).toBeInTheDocument();
  });
});

describe('EventsTable', () => {
  test('visar händelse med detalj, allvarlighet, land, källa och starttid', () => {
    render(
      <EventsTable records={[
        { t: 'e', title: 'Ledbanning', detail: 'Motala–Jönköping', country: 'SE', severity: 'high', sourceName: 'Trafikverket', start: now },
        { t: 'e', title: 'Saknad allvarlighet', country: 'NORDIC', sourceName: 'Statnett', start: now },
        { t: 'm', indicator: 'måste-inte-visas' },
      ]} />,
    );
    expect(screen.getByText('Ledbanning')).toBeInTheDocument();
    expect(screen.getByText('Motala–Jönköping')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Nordiskt')).toBeInTheDocument();
    expect(screen.getByText('–')).toBeInTheDocument(); // severity ?? –
    expect(screen.queryByText('måste-inte-visas')).not.toBeInTheDocument();
  });

  test('visar högst 50 händelser', () => {
    const records = Array.from({ length: 60 }, (_, i) => ({
      t: 'e', title: `Händelse ${i + 1}`, country: 'SE', sourceName: 'x', start: now,
    }));
    render(<EventsTable records={records} />);
    expect(screen.getByText('Händelse 1')).toBeInTheDocument();
    expect(screen.getByText('Händelse 50')).toBeInTheDocument();
    expect(screen.queryByText('Händelse 51')).not.toBeInTheDocument();
  });

  test('tomt meddelande när det inte finns några händelser', () => {
    render(<EventsTable records={[]} />);
    expect(screen.getByText(/Inga händelser\/larm rapporteras just nu/)).toBeInTheDocument();
  });
});
