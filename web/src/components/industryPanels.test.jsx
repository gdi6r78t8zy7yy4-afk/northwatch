// M10: industripanelerna (område 7) – rendering av ok-/fel-/loading-lägen för
// byggstenarna (IndustryBits) och per-källa-panelerna (IndustryPanels) samt
// IndustryView:s koppling till /api/industry/* (mockad api.js). Panelerna är
// presentationella – records och meta { loading, error, fetchedAt, onRetry }
// kommer som props från IndustryView. Inget nätverk.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  StatusBadge, ScoreBar, ComponentRows, RecordTable, countryLabel,
} from './IndustryBits.jsx';
import {
  IndustryStatusPanel, IndustryEurostatPanel, IndustrySteelPanel,
  IndustryComtradePanel, IndustryRmisPanel, IndustryNationalPanel,
  IndustryGapCards,
} from './IndustryPanels.jsx';
import IndustryView from './IndustryView.jsx';

vi.mock('../api.js');
import { fetchIndustryStatus, fetchIndustryData } from '../api.js';

// ------------------------------------------------------------------- Fixtures

const META_OK = {
  loading: false, error: null, fetchedAt: '2026-11-07T10:00:00Z', onRetry: vi.fn(),
};
const META_LOADING = { loading: true, error: null, fetchedAt: null, onRetry: vi.fn() };
const META_ERR = {
  loading: false, error: 'Eurostat: timeout', fetchedAt: null, onRetry: vi.fn(),
};

const comp = (score, basis = 'testbasis') => ({ score, basis });
const STATUS_NORDIC = {
  generatedAt: '2026-11-07T10:00:00Z',
  country: 'NORDIC', asOf: '2026-09', score: 50.4, label: 'Stabilt',
  components: {
    production: comp(52.8), trade: comp(49.2), capacity: comp(46.2, 'SE 55.7 · NO 53.7 · FI 47.2 · IS 28'),
  },
  drivers: [
    'SE: 55.6 (Stabilt)', 'NO: 59.7 (Stabilt)', 'DK: 49.6 (Stabilt)',
    'FI: 51 (Stabilt)', 'IS: 36.1 (Kontraktion)',
  ],
  sources: ['comtrade', 'eurostat-industry', 'oecd', 'rmis', 'scb'],
  countries: [
    { country: 'SE', score: 55.6, label: 'Stabilt', components: { production: comp(57.6), trade: comp(52.1), capacity: comp(55.7) } },
    { country: 'NO', score: 59.7, label: 'Stabilt', components: { production: comp(61.2), trade: comp(61.2), capacity: comp(53.7) } },
    { country: 'DK', score: 49.6, label: 'Stabilt', components: { production: comp(49.4), trade: comp(50), capacity: null } },
    { country: 'FI', score: 51, label: 'Stabilt', components: { production: comp(53.2), trade: comp(50), capacity: comp(47.2) } },
    { country: 'IS', score: 36.1, label: 'Kontraktion', components: { production: comp(41.3), trade: comp(32.7), capacity: comp(28) } },
  ],
};
const STATUS_SE = {
  generatedAt: '2026-11-07T10:00:00Z',
  country: 'SE', asOf: '2026-09', score: 55.6, label: 'Stabilt',
  components: {
    production: comp(57.6, '12m-förändring 2.4% (2026-09); index 101.6 (index 2021=100, 2026-09)'),
    trade: comp(52.1, 'Comtrade: export 195.8 bn / import 100.0 bn USD (2025)'),
    capacity: comp(55.7, 'stålkapacitet 5.95 Mt (OECD, 2025)'),
  },
  drivers: [
    'Produktion: 12m-förändring 2.4% (2026-09); index 101.6 (index 2021=100, 2026-09)',
    'Handel: Comtrade: export 195.8 bn / import 100.0 bn USD (2025)',
    'Kapacitet: stålkapacitet 5.95 Mt (OECD, 2025)',
  ],
  sources: ['comtrade', 'eurostat-industry', 'oecd', 'rmis', 'scb'],
};

const RECS = [
  { t: 'm', area: 7, country: 'SE', source: 'eurostat-industry',
    indicator: 'Industriproduktionsindex (2021=100), 2026-09', value: 101.6, unit: 'index 2021=100', ts: '2026-09' },
  { t: 'm', area: 7, country: 'SE', source: 'scb',
    indicator: 'Net trade – mrdSEK (2026-09)', value: 3.4, unit: 'mrdSEK', ts: '2026-09' },
  { t: 'm', area: 7, country: 'SE', source: 'oecd',
    indicator: 'Stålkapacitet, råstål (Sverige), 2025', value: 5.95, unit: 'Mt', ts: '2025' },
  { t: 'm', area: 7, country: 'SE', source: 'comtrade',
    indicator: 'Exporter (UN Comtrade, USD), 2025', value: 195760254697, unit: 'USD', ts: '2025' },
  { t: 'm', area: 7, country: 'SE', source: 'comtrade',
    indicator: 'Importer (UN Comtrade, USD), 2025', value: 100000000000, unit: 'USD', ts: '2025' },
  { t: 'm', area: 7, country: 'IS', source: 'comtrade',
    indicator: 'Exporter (UN Comtrade, USD), 2025', value: 5000000000, unit: 'USD', ts: '2025' },
  { t: 'm', area: 7, country: 'IS', source: 'comtrade',
    indicator: 'Importer (UN Comtrade, USD), 2025', value: 8000000000, unit: 'USD', ts: '2025' },
  { t: 'm', area: 7, country: 'NO', source: 'rmis',
    indicator: 'Utvinning: Norge levererar Feldspar till EU (TONS), 2025', value: 307916.94, unit: 'TONS', ts: '2025' },
  { t: 'm', area: 7, country: 'IS', source: 'rmis',
    indicator: 'Utvinning: Island levererar Aluminium till EU (TONS), 2025', value: 357024, unit: 'TONS', ts: '2025' },
  { t: 'e', area: 7, country: 'NO', source: 'rmis', kind: 'dependency', severity: 'high',
    title: 'EU:s importberoende av Kobolt är 98 %', start: '2026-09' },
  { t: 'e', area: 7, country: 'FI', source: 'rmis', kind: 'dependency', severity: 'medium',
    title: 'EU:s importberoende av Lithium är 62 %', start: '2026-09' },
];
const DATA_BODY = { generatedAt: '2026-11-07T10:00:00Z', country: 'ALL', records: RECS, sources: [] };

const ok = body => ({ ok: true, status: 200, body });
const sourceError = message => ({ ok: false, status: 502, body: { error: message } });

beforeEach(() => {
  vi.mocked(fetchIndustryStatus).mockReset();
  vi.mocked(fetchIndustryData).mockReset();
});

// ----------------------------------------------------------------- Bits ------

describe('IndustryBits', () => {
  test('StatusBadge: färgklass per label, null → Okänt', () => {
    const { container } = render(<><StatusBadge label="Expansiv" /><StatusBadge label="Stabilt" /><StatusBadge label="Kontraktion" /><StatusBadge label={null} /></>);
    expect(container.querySelector('.ind-exp')).toHaveTextContent('Expansiv');
    expect(container.querySelector('.ind-stab')).toHaveTextContent('Stabilt');
    expect(container.querySelector('.ind-kon')).toHaveTextContent('Kontraktion');
    expect(container.querySelector('.ind-unknown')).toHaveTextContent('Okänt');
  });

  test('ScoreBar: null → –, annars fyllning i skalan + siffran', () => {
    const { container } = render(<><ScoreBar score={null} /><ScoreBar score={55.6} /></>);
    expect(container.querySelectorAll('.ind-scorebar').length).toBe(1);
    expect(container.querySelector('.ind-scorebar .fill')).toHaveStyle('width: 55.6%');
    expect(container.querySelector('.ind-scorebar .n')).toHaveTextContent('55.6');
  });

  test('ComponentRows: tre rader, saknad komponent → –', () => {
    const { container } = render(<ComponentRows components={{ production: comp(57.6), trade: comp(52.1), capacity: null }} />);
    expect(container.querySelectorAll('.ind-comp').length).toBe(3);
    expect(container.querySelector('[title="testbasis"] .ind-scorebar .n')).toHaveTextContent('57.6');
    expect(screen.getByText('Kapacitet').parentElement).toHaveTextContent('–');
  });

  test('RecordTable: tom fallback, händelser (t=e) exkluderas, max klipper', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      t: 'm', indicator: `Indikator ${i}`, value: i, unit: 'st', ts: '2026-09',
    }));
    const { rerender, container } = render(<RecordTable records={[]} empty="Inget just nu." />);
    expect(screen.getByText('Inget just nu.')).toBeInTheDocument();

    rerender(<RecordTable records={[...many, { t: 'e', title: 'Larm' }]} max={2} />);
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
    expect(screen.queryByText('Larm')).not.toBeInTheDocument();
  });

  test('countryLabel: ISO-koder → svenska namn, NORDIC → Nordiskt', () => {
    expect(countryLabel('SE')).toBe('Sverige');
    expect(countryLabel('NORDIC')).toBe('Nordiskt');
    expect(countryLabel('XX')).toBe('XX');
  });
});

// ---------------------------------------------------------------- Panels -----

describe('IndustryStatusPanel', () => {
  test('NORDIC: poäng, badge, komponentrader och per-land-tabell', () => {
    const { container } = render(<IndustryStatusPanel status={STATUS_NORDIC} meta={META_OK} />);
    expect(screen.getByText('Industristatus')).toBeInTheDocument();
    expect(screen.getByText('50.4')).toBeInTheDocument();
    expect(container.querySelector('.ind-stab')).toHaveTextContent('Stabilt');
    expect(screen.getByText('t.o.m. 2026-09 · 5 källor')).toBeInTheDocument();
    // Per-land-tabellen (ej landsvy): alla fem länderna + DK:s saknade kapacitet.
    for (const name of ['Sverige', 'Norge', 'Danmark', 'Finland', 'Island']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText('36.1')).toBeInTheDocument();
    expect(screen.getAllByText('–').length).toBeGreaterThanOrEqual(1);
  });

  test('landsvy (national): drivfaktorer i stället för per-land-tabell', () => {
    render(<IndustryStatusPanel status={STATUS_SE} meta={META_OK} national />);
    expect(screen.getByText('Kapacitet: stålkapacitet 5.95 Mt (OECD, 2025)')).toBeInTheDocument();
    expect(screen.queryByText('Sverige')).not.toBeInTheDocument(); // ingen tabellrad
  });

  test('loading → hämtar-läge; error + retry → onRetry; data=null → fallback', () => {
    const { rerender } = render(<IndustryStatusPanel status={null} meta={META_LOADING} />);
    expect(screen.getByText(/Hämtar data/)).toBeInTheDocument();

    rerender(<IndustryStatusPanel status={null} meta={META_ERR} />);
    expect(screen.getByText('Eurostat: timeout')).toBeInTheDocument();
    expect(screen.getByText('Kunde inte hämta data.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Försök igen'));
    expect(META_ERR.onRetry).toHaveBeenCalledTimes(1);

    rerender(<IndustryStatusPanel status={null} meta={{ ...META_OK, error: null }} />);
    expect(screen.getByText('Ingen analys ännu.')).toBeInTheDocument();
  });
});

describe('IndustryEurostatPanel', () => {
  test('records som tabell; tom lista → fallback', async () => {
    const { rerender } = render(<IndustryEurostatPanel records={RECS.filter(r => r.source === 'eurostat-industry')} meta={META_OK} />);
    expect(await screen.findByText('Eurostat – industri & råvaror')).toBeInTheDocument();
    expect(screen.getByText('Industriproduktionsindex (2021=100), 2026-09')).toBeInTheDocument();
    expect(screen.getByText('index 2021=100')).toBeInTheDocument();

    rerender(<IndustryEurostatPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen Eurostat-data just nu.')).toBeInTheDocument();
  });
});

describe('IndustrySteelPanel', () => {
  test('stålkapacitet som staplar per land; tom lista → fallback', () => {
    const { container, rerender } = render(<IndustrySteelPanel records={RECS.filter(r => r.source === 'oecd')} meta={META_OK} />);
    expect(screen.getByText('Råstålkapacitet (OECD)')).toBeInTheDocument();
    expect(container.querySelectorAll('.bar-row').length).toBe(1);
    expect(screen.getByText('Sverige (2025)')).toBeInTheDocument();
    expect(screen.getByText('Mt råstålkapacitet per land, senaste år.')).toBeInTheDocument();

    rerender(<IndustrySteelPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen stålkapacitetsdata just nu.')).toBeInTheDocument();
  });
});

describe('IndustryComtradePanel', () => {
  test('export/import/saldo per land med bn-format och teckenfärg', () => {
    render(<IndustryComtradePanel records={RECS.filter(r => r.source === 'comtrade')} meta={META_OK} />);
    expect(screen.getByText('Varuhandel (UN Comtrade)')).toBeInTheDocument();
    expect(screen.getByText('Sverige')).toBeInTheDocument();
    expect(screen.getByText('195.8 bn')).toBeInTheDocument();
    expect(screen.getByText('100.0 bn')).toBeInTheDocument();
    // SE: positivt saldo (pos), IS: negativt saldo (neg) + –3.0 bn.
    expect(screen.getByText('95.8 bn')).toHaveClass('pos');
    expect(screen.getByText('-3.0 bn')).toHaveClass('neg');
    expect(screen.getByText('Island')).toBeInTheDocument();
    expect(screen.getByText('USD, världshandel (partnerCode 0). Saldo = export − import.')).toBeInTheDocument();
  });

  test('inga export/import-records → fallback', () => {
    render(<IndustryComtradePanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen Comtrade-data just nu.')).toBeInTheDocument();
  });

  test('land som bara har null-records (ej rapporterat) visas med –-rad', () => {
    const noRecs = ['X', 'M'].map(f => ({
      t: 'm', area: 7, country: 'NO', source: 'comtrade',
      indicator: `Comtrade NO ${f}: ej rapporterat (2025)`, value: null, unit: '', ts: '2025',
    }));
    render(<IndustryComtradePanel
      records={[...RECS.filter(r => r.source === 'comtrade'), ...noRecs]} meta={META_OK} />);
    expect(screen.getByText('Norge')).toBeInTheDocument();
    // NO-raden: export –, import –, saldo – → exakt 3 streck, och ts = år
    // ("2025") från null-records visas i År-kolumnen.
    expect(screen.getAllByText('–')).toHaveLength(3);
    expect(screen.getAllByText('2025')).toHaveLength(3); // SE + IS + NO
  });
});

describe('IndustryRmisPanel', () => {
  test('KPI:er (hög/medelberoende, material), larmrader och materialchips', () => {
    const { container } = render(<IndustryRmisPanel records={RECS.filter(r => r.source === 'rmis')} meta={META_OK} />);
    expect(screen.getByText('Kritiska råvaror (JRC RMIS / EU CRMs)')).toBeInTheDocument();
    // KPI-värden i ordning: 1 högt, 1 medel, 2 nordiska material till EU.
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['1', '1', '2']);
    expect(screen.getByText('Högt importberoende (≥ 80 %)')).toBeInTheDocument();
    expect(screen.getByText('Nordiska material till EU')).toBeInTheDocument();
    // Båda larmen (1 high + 1 medium) + chips för de två levererade materialen.
    expect(screen.getByText('EU:s importberoende av Kobolt är 98 %')).toBeInTheDocument();
    expect(screen.getByText('EU:s importberoende av Lithium är 62 %')).toBeInTheDocument();
    expect(screen.getByText('Feldspar')).toBeInTheDocument();
    expect(screen.getByText('Aluminium')).toBeInTheDocument();
  });

  test('inga larm → tomtext', () => {
    render(<IndustryRmisPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Inga importberoendelarm.')).toBeInTheDocument();
  });
});

describe('IndustryNationalPanel', () => {
  test('records grupperade per statistikbyrå (landsrubrik)', () => {
    render(<IndustryNationalPanel records={RECS.filter(r => r.source === 'scb')} meta={META_OK} country="SE" />);
    expect(screen.getByText('Nationell statistikbyrå (Sverige)')).toBeInTheDocument();
    expect(screen.getByText('SCB (Sverige)')).toBeInTheDocument();
    expect(screen.getByText('Net trade – mrdSEK (2026-09)')).toBeInTheDocument();
  });

  test('Nordiskt: gemensam rubrik, alla byråer; tomma records → fallback', () => {
    const { rerender } = render(<IndustryNationalPanel records={RECS} meta={META_OK} country="NORDIC" />);
    expect(screen.getByText('Nationella statistikbyråer')).toBeInTheDocument();
    expect(screen.getByText('SCB (Sverige)')).toBeInTheDocument();

    rerender(<IndustryNationalPanel records={[]} meta={META_OK} country="NORDIC" />);
    expect(screen.getByText('Ingen data från nationella statistikbyråer just nu.')).toBeInTheDocument();
  });
});

describe('IndustryGapCards', () => {
  test('kända luckor: IEA, Statistics Denmark, Comtrade-nyckel', () => {
    render(<IndustryGapCards />);
    expect(screen.getByText('Kända luckor – industri & försörjningskedjor')).toBeInTheDocument();
    expect(screen.getByText(/IEA/)).toBeInTheDocument();
    expect(screen.getByText(/Statistics Denmark/)).toBeInTheDocument();
    expect(screen.getByText('COMTRADE_API_KEY')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- View -------

describe('IndustryView', () => {
  test('NORDIC/ALL: status för NORDIC, data för ALL, alla paneler + luckkort', async () => {
    vi.mocked(fetchIndustryStatus).mockResolvedValue(ok(STATUS_NORDIC));
    vi.mocked(fetchIndustryData).mockResolvedValue(ok(DATA_BODY));
    const { container } = render(<IndustryView country="ALL" />);

    expect(fetchIndustryStatus).toHaveBeenCalledWith('NORDIC');
    expect(fetchIndustryData).toHaveBeenCalledWith('ALL');
    // Alla per-källa-panelerna + status sätts in.
    expect(await screen.findByText('Industristatus')).toBeInTheDocument();
    expect(screen.getByText('Eurostat – industri & råvaror')).toBeInTheDocument();
    expect(screen.getByText('Nationella statistikbyråer')).toBeInTheDocument();
    expect(screen.getByText('Råstålkapacitet (OECD)')).toBeInTheDocument();
    expect(screen.getByText('Varuhandel (UN Comtrade)')).toBeInTheDocument();
    expect(screen.getByText('Kritiska råvaror (JRC RMIS / EU CRMs)')).toBeInTheDocument();
    expect(container.querySelector('.industry-grid')).not.toBeNull();
    // Luckkortet visas i den nordiska sammanfattningen.
    expect(screen.getByText('Kända luckor – industri & försörjningskedjor')).toBeInTheDocument();
    // Records distribueras till rätt paneler.
    expect(screen.getByText('Industriproduktionsindex (2021=100), 2026-09')).toBeInTheDocument();
    expect(screen.getByText('Net trade – mrdSEK (2026-09)')).toBeInTheDocument();
    expect(screen.getByText('195.8 bn')).toBeInTheDocument();
  });

  test('landsvy (SE): status + data för SE, ingen luckrad, drivfaktorer', async () => {
    vi.mocked(fetchIndustryStatus).mockResolvedValue(ok(STATUS_SE));
    vi.mocked(fetchIndustryData).mockResolvedValue(ok({
      ...DATA_BODY, country: 'SE',
      records: RECS.filter(r => r.country === 'SE' || r.country === 'NORDIC'),
    }));
    render(<IndustryView country="SE" />);

    expect(fetchIndustryStatus).toHaveBeenCalledWith('SE');
    expect(fetchIndustryData).toHaveBeenCalledWith('SE');
    expect(await screen.findByText('Nationell statistikbyrå (Sverige)')).toBeInTheDocument();
    expect(screen.getByText('Kapacitet: stålkapacitet 5.95 Mt (OECD, 2025)')).toBeInTheDocument();
    expect(screen.queryByText('Kända luckor – industri & försörjningskedjor')).not.toBeInTheDocument();
  });

  test('ofoglig country → NORDIC; datafel → fel i panelerna, retry hämtar igen', async () => {
    vi.mocked(fetchIndustryStatus).mockResolvedValue(ok(STATUS_NORDIC));
    vi.mocked(fetchIndustryData)
      .mockResolvedValueOnce(sourceError('comtrade: 429 för många anrop'))
      .mockResolvedValue(ok(DATA_BODY));
    render(<IndustryView country="XX" />);

    expect(fetchIndustryStatus).toHaveBeenCalledWith('NORDIC');
    // Datafelet visas i alla per-källa-panelerna (delade datafeed).
    expect((await screen.findAllByText('comtrade: 429 för många anrop')).length).toBe(5);
    expect(screen.getAllByText('Kunde inte hämta data.').length).toBe(5);

    const retry = screen.getAllByText('Försök igen')[0];
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Industriproduktionsindex (2021=100), 2026-09')).toBeInTheDocument());
    expect(screen.queryByText('comtrade: 429 för många anrop')).not.toBeInTheDocument();
  });
});
