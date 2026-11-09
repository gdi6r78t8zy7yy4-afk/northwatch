// M11: förvaltningspanelerna (område 12) – rendering av ok-/fel-/loading-lägen
// för byggstenarna (ForvaltningBits) och per-källa-panelerna (ForvaltningPanels)
// samt ForvaltningView:s koppling till /api/forvaltning/* (mockad api.js).
// Panelerna är presentationella – records och meta { loading, error, fetchedAt,
// onRetry } kommer som props från ForvaltningView. Inget nätverk.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LABEL_CLS, StatusBadge, ComponentRows, RecordTable, countryLabel } from './ForvaltningBits.jsx';
import {
  ForvaltningStatusPanel, RiksdagenPanel, FdkPanel, RetsinformationPanel,
  FinlexPanel, IslandGapCard, IpuPanel, DataportalPanel, CellarPanel,
  ForvaltningGapCards,
} from './ForvaltningPanels.jsx';
import ForvaltningView from './ForvaltningView.jsx';

vi.mock('../api.js');
import { fetchForvaltningStatus, fetchForvaltningData } from '../api.js';

// ------------------------------------------------------------------- Fixtures

const META_OK = {
  loading: false, error: null, fetchedAt: '2026-11-09T08:00:00Z', onRetry: vi.fn(),
};
const META_LOADING = { loading: true, error: null, fetchedAt: null, onRetry: vi.fn() };
const META_ERR = {
  loading: false, error: 'riksdagen: 404', fetchedAt: null, onRetry: vi.fn(),
};

const comp = (score, basis = 'testbasis') => ({ score, basis });
const compRows = se => ({
  aktivitet: comp(78.4, se), kontinuitet: comp(100, 'testbasis'),
  observerbarhet: comp(68.8, 'testbasis'),
});
const STATUS_NORDIC = {
  generatedAt: '2026-11-09T08:00:00Z',
  country: 'NORDIC', asOf: '2026-11-09', score: 66.2, label: 'Stabilt',
  components: {
    aktivitet: comp(46.2), kontinuitet: comp(100), observerbarhet: comp(59.1),
  },
  drivers: ['Aktivitet: bas', 'Kontinuitet: bas', 'Observerbarhet: bas'],
  sources: ['cellar', 'dataportal', 'fdk', 'finlex', 'ipu', 'retsinformation', 'riksdagen'],
  countries: [
    { country: 'SE', score: 82.0, label: 'Hög trygghet', components: compRows() },
    { country: 'NO', score: 73.0, label: 'Stabilt', components: { aktivitet: comp(53.5), kontinuitet: comp(100), observerbarhet: comp(72.0) } },
    { country: 'DK', score: 62.1, label: 'Stabilt', components: { aktivitet: comp(32.8), kontinuitet: comp(100), observerbarhet: comp(63.3) } },
    { country: 'FI', score: 57.8, label: 'Stabilt', components: { aktivitet: comp(34.3), kontinuitet: comp(100), observerbarhet: comp(46.9) } },
    { country: 'IS', score: 56.3, label: 'Stabilt', components: { aktivitet: comp(32.2), kontinuitet: comp(100), observerbarhet: comp(44.6) } },
  ],
};
const STATUS_SE = {
  generatedAt: '2026-11-09T08:00:00Z',
  country: 'SE', asOf: '2026-11-09', score: 82.0, label: 'Hög trygghet',
  components: {
    aktivitet: comp(78.4, 'riksdagen: 6 kalenderhändelser, 3 omröstningar, 5 anföranden'),
    kontinuitet: comp(100, 'riksdagen: 3 kommande kalenderhändelser'),
    observerbarhet: comp(68.8, 'testbasis'),
  },
  drivers: [
    'Aktivitet: riksdagen: 6 kalenderhändelser, 3 omröstningar, 5 anföranden',
    'Kontinuitet: riksdagen: 3 kommande kalenderhändelser',
    'Observerbarhet: testbasis',
  ],
  sources: ['cellar', 'dataportal', 'ipu', 'riksdagen'],
};

const Y = new Date().getFullYear();
const RIKS_RECS = [
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Kalenderhändelser, kammarkalendern', value: 6, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: `Omröstningar (kammaråret ${Y}${Y + 1})`, value: 3, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Röster: Ja', value: 9, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Röster: Nej', value: 6, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Röster: Frånvarande', value: 3, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Röster: Avstått', value: 1, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: `Anföranden (kammaråret ${Y}${Y + 1})`, value: 5, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Tjänstgörande riksdagsledamöter', value: 6, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Kvinnor bland tjänstgörande ledamöter', value: 3, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Personregister (historiskt)', value: 10, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'e', area: 12, country: 'SE', source: 'riksdagen', kind: 'kammarkalender', severity: 'info', title: 'Kammarsammanträde', detail: 'Riksdagshuset', start: '2026-11-10T10:00:00' },
  { t: 'e', area: 12, country: 'SE', source: 'riksdagen', kind: 'kammarkalender', severity: 'info', title: 'Kammarsammanträde', detail: 'Riksdagshuset', start: '2026-11-17T10:00:00' },
];
const FDK_RECS = [
  { t: 'm', area: 12, country: 'NO', source: 'fdk', indicator: 'Dataset i Felles datakatalog', value: 9227, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'NO', source: 'fdk', indicator: 'Öppna dataset (andel)', value: 98.6, unit: '%', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'NO', source: 'fdk', indicator: 'Nyregistrerade dataset (≤365 d)', value: 799, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'NO', source: 'fdk', indicator: 'Dataset med metadataändring (≤30 d)', value: 1, unit: 'st', ts: '2026-11-09T08:00:00Z' },
];
const RTI_RECS = [
  ...['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']
    .map((d, i) => ({
      t: 'm', area: 12, country: 'DK', source: 'retsinformation',
      indicator: `Lagändringar, ${d}`, value: [5, 3, 2, 6, 4, 0, 0][i], unit: 'st', ts: d,
    })),
  { t: 'm', area: 12, country: 'DK', source: 'retsinformation', indicator: 'Lagändringar, senaste 7 dygn', value: 20, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'DK', source: 'retsinformation', indicator: 'Lagändringar per typ: BEK (7 d)', value: 9, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'DK', source: 'retsinformation', indicator: 'Lagändringar per typ: SØF (7 d)', value: 1, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'e', area: 12, country: 'DK', source: 'retsinformation', kind: 'lagtext', severity: 'info', title: '2026-11-09 (BEK)', detail: 'Bekendtgørelse om ændring', start: '2026-11-09' },
  { t: 'e', area: 12, country: 'DK', source: 'retsinformation', kind: 'lagtext', severity: 'info', title: '2026-11-08 (LBK)', detail: '', start: '2026-11-08' },
];
const FIN_RECS = [
  { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Lagversioner ${Y}`, value: 38, unit: 'st', ts: String(Y) },
  { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Nya lagar ${Y}`, value: 12, unit: 'st', ts: String(Y) },
  { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Ändrade lagar ${Y}`, value: 7, unit: 'st', ts: String(Y) },
  { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Nya lagar ${Y - 1} (hela året)`, value: 6, unit: 'st', ts: String(Y - 1) },
  { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Ändrade lagar ${Y - 1} (hela året)`, value: 4, unit: 'st', ts: String(Y - 1) },
];
const ipuRec = (cc, indicator, value) => ({
  t: 'm', area: 12, country: cc, source: 'ipu', indicator, value, unit: 'st', ts: '2026-11-09T08:00:00Z',
});
const IPU_RECS = [
  ipuRec('SE', 'Ledamöter, kammare', 349), ipuRec('SE', 'Kvinnor bland ledamöter', 162),
  ipuRec('SE', 'Partigrupper', 8), ipuRec('SE', 'Lagar antagna per år', 608),
  ipuRec('SE', 'Politiska partier (IPU)', 10), ipuRec('SE', 'Parlamentsanställda', 697),
  ipuRec('SE', 'Dagar sedan senaste val (2022-09-18)', 1451),
  ipuRec('NO', 'Ledamöter, kammare', 169), ipuRec('NO', 'Kvinnor bland ledamöter', 72),
  ipuRec('NO', 'Partigrupper', 9), ipuRec('NO', 'Lagar antagna per år', 93),
  ipuRec('NO', 'Parlamentsanställda', 530), ipuRec('NO', 'Dagar sedan senaste val (2021-09-13)', 1790),
  ipuRec('DK', 'Ledamöter, kammare', 179), ipuRec('DK', 'Kvinnor bland ledamöter', 89),
  ipuRec('DK', 'Lagar antagna per år', 210), ipuRec('DK', 'Parlamentsanställda', 1000),
  ipuRec('DK', 'Dagar sedan senaste val (2022-11-13)', 1426),
  ipuRec('FI', 'Ledamöter, kammare', 200), ipuRec('FI', 'Kvinnor bland ledamöter', 97),
  ipuRec('FI', 'Lagar antagna per år', 300), ipuRec('FI', 'Parlamentsanställda', 1400),
  ipuRec('FI', 'Dagar sedan senaste val (2023-04-02)', 1073),
  ipuRec('IS', 'Ledamöter, kammare', 63), ipuRec('IS', 'Kvinnor bland ledamöter', 28),
  ipuRec('IS', 'Lagar antagna per år', 40), ipuRec('IS', 'Parlamentsanställda', 170),
  ipuRec('IS', 'Dagar sedan senaste val (2024-09-15)', 420),
];
const dpRecs = (cc, hub, total, recent, samples) => [
  { t: 'm', area: 12, country: cc, source: 'dataportal', indicator: 'Öppna dataset i data.europa.eu', value: total, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: cc, source: 'dataportal', indicator: 'Dataset uppdaterade (≤30 d)', value: recent, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  ...samples.map(s => ({
    t: 'e', area: 12, country: cc, source: 'dataportal', kind: 'dataset', severity: 'info',
    title: s.title, detail: s.catalog.name, start: s.modified.slice(0, 10),
  })),
];
const DP_RECS = [
  ...dpRecs('SE', 'se', 25085, 1161, [
    { title: 'Folkmängd och befolkning i Sverige', catalog: { name: 'SCB statistik' }, modified: '2026-11-05T10:00:00Z' },
    { title: 'Regionala produktions- och inkomstkonton', catalog: { name: 'Europeiska regionala konton' }, modified: '2026-11-02T08:00:00Z' },
  ]),
  ...dpRecs('NO', 'no', 9559, 312, [{ title: 'Befolkning og befolkningsutvikling', catalog: { name: 'SSB statistikk' }, modified: '2026-11-04T09:00:00Z' }]),
  ...dpRecs('DK', 'dk', 3707, 98, []),
  ...dpRecs('FI', 'fi', 2959, 45, []),
  ...dpRecs('IS', 'is', 611, 3, []),
];
const CELLAR_RECS = [
  { t: 'm', area: 12, country: 'NORDIC', source: 'cellar', indicator: `EU-rättsliga texter ${Y} (CELEX, YTD)`, value: 2736, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'NORDIC', source: 'cellar', indicator: `EU-direktiv ${Y}`, value: 412, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'NORDIC', source: 'cellar', indicator: `EU-förordningar ${Y}`, value: 1288, unit: 'st', ts: '2026-11-09T08:00:00Z' },
  { t: 'm', area: 12, country: 'NORDIC', source: 'cellar', indicator: `EU-beslut ${Y}`, value: 847, unit: 'st', ts: '2026-11-09T08:00:00Z' },
];
const RECS = [...RIKS_RECS, ...FDK_RECS, ...RTI_RECS, ...FIN_RECS, ...IPU_RECS, ...DP_RECS, ...CELLAR_RECS];
const DATA_BODY = { generatedAt: '2026-11-09T08:00:00Z', country: 'ALL', records: RECS, sources: [] };

const ok = body => ({ ok: true, status: 200, body });
const sourceError = message => ({ ok: false, status: 502, body: { error: message } });

beforeEach(() => {
  vi.mocked(fetchForvaltningStatus).mockReset();
  vi.mocked(fetchForvaltningData).mockReset();
});

// ------------------------------------------------------------------- Bits ----

describe('ForvaltningBits', () => {
  test('LABEL_CLS: label → färgklass', () => {
    expect(LABEL_CLS).toEqual({
      'Hög trygghet': 'fv-hog',
      Stabilt: 'fv-stab',
      Uppmärksamhet: 'fv-opp',
      Svag: 'fv-svag',
      Okänt: 'fv-unknown',
    });
  });

  test('StatusBadge: färgklass per label, null → Okänt', () => {
    const { container } = render(
      <>
        <StatusBadge label="Hög trygghet" /><StatusBadge label="Stabilt" /><StatusBadge label="Uppmärksamhet" />
        <StatusBadge label="Svag" /><StatusBadge label={null} />
      </>,
    );
    expect(container.querySelector('.fv-hog')).toHaveTextContent('Hög trygghet');
    expect(container.querySelector('.fv-stab')).toHaveTextContent('Stabilt');
    expect(container.querySelector('.fv-opp')).toHaveTextContent('Uppmärksamhet');
    expect(container.querySelector('.fv-svag')).toHaveTextContent('Svag');
    expect(container.querySelector('.fv-unknown')).toHaveTextContent('Okänt');
  });

  test('ComponentRows: tre rader, saknad komponent → –', () => {
    const { container } = render(<ComponentRows components={{ aktivitet: comp(78.4), kontinuitet: null, observerbarhet: comp(68.8) }} />);
    expect(container.querySelectorAll('.ind-comp').length).toBe(3);
    expect(screen.getByText('Kontinuitet').parentElement).toHaveTextContent('–');
  });

  test('RecordTable: tom fallback (återanvänd från IndustryBits)', () => {
    render(<RecordTable records={[]} empty="Inget just nu." />);
    expect(screen.getByText('Inget just nu.')).toBeInTheDocument();
  });

  test('countryLabel: ISO-koder → svenska namn, NORDIC → Nordiskt', () => {
    expect(countryLabel('SE')).toBe('Sverige');
    expect(countryLabel('NORDIC')).toBe('Nordiskt');
  });
});

// ---------------------------------------------------------------- Panels -----

describe('ForvaltningStatusPanel', () => {
  test('NORDIC: poäng, badge, komponentrader och per-land-tabell', () => {
    const { container } = render(<ForvaltningStatusPanel status={STATUS_NORDIC} meta={META_OK} />);
    expect(screen.getByText('Förvaltningsindex')).toBeInTheDocument();
    expect(screen.getByText('66.2')).toBeInTheDocument();
    expect(container.querySelector('.fv-stab')).toHaveTextContent('Stabilt');
    expect(screen.getByText('t.o.m. 2026-11-09 · 7 källor')).toBeInTheDocument();
    // Per-land-tabellen (ej landsvy): alla fem länderna.
    for (const name of ['Sverige', 'Norge', 'Danmark', 'Finland', 'Island']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(container.querySelector('.fv-hog')).toHaveTextContent('Hög trygghet');
    expect(screen.getByText('82')).toBeInTheDocument();
  });

  test('landsvy (national): drivfaktorer i stället för per-land-tabell', () => {
    render(<ForvaltningStatusPanel status={STATUS_SE} meta={META_OK} national />);
    expect(screen.getByText('Aktivitet: riksdagen: 6 kalenderhändelser, 3 omröstningar, 5 anföranden')).toBeInTheDocument();
    expect(screen.queryByText('Sverige')).not.toBeInTheDocument(); // ingen tabellrad
  });

  test('loading → hämtar-läge; error + retry → onRetry; data=null → fallback', () => {
    const { rerender } = render(<ForvaltningStatusPanel status={null} meta={META_LOADING} />);
    expect(screen.getByText(/Hämtar data/)).toBeInTheDocument();

    rerender(<ForvaltningStatusPanel status={null} meta={META_ERR} />);
    expect(screen.getByText('riksdagen: 404')).toBeInTheDocument();
    expect(screen.getByText('Kunde inte hämta data.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Försök igen'));
    expect(META_ERR.onRetry).toHaveBeenCalledTimes(1);

    rerender(<ForvaltningStatusPanel status={null} meta={{ ...META_OK, error: null }} />);
    expect(screen.getByText('Ingen analys ännu.')).toBeInTheDocument();
  });
});

describe('RiksdagenPanel', () => {
  test('KPI:er, röstfördelning som staplar, kalenderhändelser', () => {
    const { container } = render(<RiksdagenPanel records={RIKS_RECS} meta={META_OK} />);
    expect(screen.getByText('Sveriges riksdag (SE)')).toBeInTheDocument();
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['6', '3', '5', '6', '3']);
    expect(screen.getByText('Tjänstgörande ledamöter')).toBeInTheDocument();
    // Röster som staplar: Ja 9 är maxet.
    const bars = [...container.querySelectorAll('.bar-row')];
    expect(bars.map(b => b.querySelector('.lbl').textContent)).toEqual(['Ja', 'Nej', 'Frånvarande', 'Avstått']);
    expect(bars.map(b => b.querySelector('.n').textContent)).toEqual(['9', '6', '3', '1']);
    // Kommande händelser visas med datum.
    expect(screen.getByText('2026-11-10')).toBeInTheDocument();
    expect(screen.getByText('2026-11-17')).toBeInTheDocument();
    expect(screen.getByText(/Källa: Sveriges riksdag/)).toBeInTheDocument();
  });

  test('tom lista → KPI-streck; records=null → fallback', () => {
    const { rerender, container } = render(<RiksdagenPanel records={[]} meta={META_OK} />);
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['–', '–', '–', '–', '–']);
    rerender(<RiksdagenPanel records={null} meta={META_OK} />);
    expect(screen.getByText('Ingen riksdagsdata just nu.')).toBeInTheDocument();
  });
});

describe('FdkPanel', () => {
  test('KPI:er (totalt/öppna andel/nyregistrerade/≤30 d) + recordtabell', () => {
    const { container } = render(<FdkPanel records={FDK_RECS} meta={META_OK} />);
    expect(screen.getByText('Felles datakatalog, DigDir (NO)')).toBeInTheDocument();
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['9227', '98.6%', '799', '1']);
    expect(screen.getByText('Dataset i Felles datakatalog')).toBeInTheDocument();
    expect(screen.getByText(/CC0/)).toBeInTheDocument();
  });

  test('tom lista → KPI-streck; records=null → fallback', () => {
    const { rerender, container } = render(<FdkPanel records={[]} meta={META_OK} />);
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['–', '–', '–', '–']);
    rerender(<FdkPanel records={null} meta={META_OK} />);
    expect(screen.getByText('Ingen FDK-data just nu.')).toBeInTheDocument();
  });
});

describe('RetsinformationPanel', () => {
  test('KPI:er (7 d total, typer), dagsstaplar, typstaplar, händelser', () => {
    const { container } = render(<RetsinformationPanel records={RTI_RECS} meta={META_OK} />);
    expect(screen.getByText('Retsinformation (DK)')).toBeInTheDocument();
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['20', '2']);
    // Sju dagsstaplar (spark).
    expect(container.querySelectorAll('.spark i').length).toBe(7);
    // Typstaplar: BEK (9) + SØF (1), nedstigande.
    const bars = [...container.querySelectorAll('.bar-row')];
    expect(bars.map(b => b.querySelector('.lbl').textContent)).toEqual(['BEK', 'SØF']);
    // Händelser med datum + detalj.
    expect(screen.getByText('2026-11-09 (BEK)')).toBeInTheDocument();
    expect(screen.getByText('Bekendtgørelse om ændring')).toBeInTheDocument();
  });

  test('tom lista → KPI-streck; records=null → fallback', () => {
    const { rerender, container } = render(<RetsinformationPanel records={[]} meta={META_OK} />);
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['–', '–']);
    expect(container.querySelector('.spark')).toBeNull();
    rerender(<RetsinformationPanel records={null} meta={META_OK} />);
    expect(screen.getByText('Ingen Retsinformation-data just nu.')).toBeInTheDocument();
  });
});

describe('FinlexPanel', () => {
  test('KPI:er (löpande år + föregående år)', () => {
    const { container } = render(<FinlexPanel records={FIN_RECS} meta={META_OK} />);
    expect(screen.getByText('Finlex, lagsättning (FI)')).toBeInTheDocument();
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['12', '7', '38', '6']); // sista: Nya lagar föregående år
    expect(screen.getByText(`Nya lagar ${Y}`)).toBeInTheDocument();
    expect(screen.getByText(/swe@/)).toBeInTheDocument(); // avdubblingsnotisen
  });

  test('tom lista → fallback', () => {
    render(<FinlexPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen Finlex-data just nu.')).toBeInTheDocument();
  });
});

describe('IslandGapCard', () => {
  test('klarar ut Island-luckan (inga nationella källor)', () => {
    render(<IslandGapCard />);
    expect(screen.getByText('Islandsk offentlig förvaltning (IS)')).toBeInTheDocument();
    expect(screen.getByText(/Althinget har inget öppet API/)).toBeInTheDocument();
    expect(screen.getByText(/IPU Parline/)).toBeInTheDocument();
  });
});

describe('IpuPanel', () => {
  test('per-land-tabell: alla fem länderna, saknade celler → –', () => {
    const { container } = render(<IpuPanel records={IPU_RECS} meta={META_OK} />);
    expect(screen.getByText('Parlament (IPU Parline)')).toBeInTheDocument();
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(5);
    expect(rows.map(r => r.querySelector('td').textContent)).toEqual(['Danmark', 'Finland', 'Island', 'Norge', 'Sverige']);
    // SE-raden: 349 ledamöter, 608 lagar/år, 10 partier, val-relativ dagar.
    const se = rows[4];
    expect(se.querySelectorAll('td').length).toBe(8);
    expect(se.querySelector('td:nth-child(2)').textContent).toBe('349');
    expect(se.querySelector('td:nth-child(5)').textContent).toBe('608');
    expect(se.querySelector('td:nth-child(6)').textContent).toBe('10');
    expect(se.querySelector('td:nth-child(8)').textContent).toBe('2022-09-18 (1451 d)');
    // IS saknar partier + partigrupper → –.
    const is = rows[2];
    expect(is.querySelector('td:nth-child(6)').textContent).toBe('–');
    // DK saknar partigrupper + partier → streck i kolumn 4 och 6.
    expect(rows[0].querySelectorAll('td').length).toBe(8);
    expect(rows[0].querySelector('td:nth-child(4)').textContent).toBe('–');
    expect(screen.getByText(/källtillkännagivande/)).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<IpuPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen IPU-data just nu.')).toBeInTheDocument();
  });
});

describe('DataportalPanel', () => {
  test('staplar per land (totala dataset) + nyligen uppdaterade', () => {
    const { container } = render(<DataportalPanel records={DP_RECS} meta={META_OK} />);
    expect(screen.getByText('data.europa.eu Data Portal')).toBeInTheDocument();
    const bars = [...container.querySelectorAll('.bar-row')];
    expect(bars.map(b => b.querySelector('.lbl').textContent)).toEqual(['Danmark', 'Finland', 'Island', 'Norge', 'Sverige']);
    expect(bars[4].querySelector('.n').textContent).toBe('25085');
    // Nyligen uppdaterade dataset (händelser).
    expect(screen.getByText('Nyligen uppdaterade dataset')).toBeInTheDocument();
    expect(screen.getByText('Folkmängd och befolkning i Sverige')).toBeInTheDocument();
    expect(screen.getByText('SCB statistik')).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<DataportalPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen portaldata just nu.')).toBeInTheDocument();
  });
});

describe('CellarPanel', () => {
  test('KPI:er (YTD totalt + L/R/D) + recordtabell', () => {
    const { container } = render(<CellarPanel records={CELLAR_RECS} meta={META_OK} />);
    expect(screen.getByText('EUR-Lex / Cellar (EU)')).toBeInTheDocument();
    const kpis = [...container.querySelectorAll('.kpi .n')].map(n => n.textContent);
    expect(kpis).toEqual(['2736', '412', '1288', '847']);
    expect(screen.getByText(`EU-rättsliga texter ${Y} (CELEX, YTD)`)).toBeInTheDocument();
    expect(screen.getByText(/SPARQL/)).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<CellarPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen EUR-Lex-data just nu.')).toBeInTheDocument();
  });
});

describe('ForvaltningGapCards', () => {
  test('kända luckor: krisinformation, Island, Finlex, IPU, OECD/Norden', () => {
    render(<ForvaltningGapCards />);
    expect(screen.getByText('Kända luckor – offentlig förvaltning')).toBeInTheDocument();
    expect(screen.getByText('Krisinformation & varningssystem')).toBeInTheDocument();
    expect(screen.getByText(/112\.se/)).toBeInTheDocument();
    expect(screen.getByText(/Althinget/)).toBeInTheDocument();
    expect(screen.getByText(/rättspraxis/)).toBeInTheDocument();
    expect(screen.getByText(/OECD \/ Norden/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- View -------

describe('ForvaltningView', () => {
  test('NORDIC/ALL: status för NORDIC, data för ALL, alla sju paneler + luckkort', async () => {
    vi.mocked(fetchForvaltningStatus).mockResolvedValue(ok(STATUS_NORDIC));
    vi.mocked(fetchForvaltningData).mockResolvedValue(ok(DATA_BODY));
    const { container } = render(<ForvaltningView country="ALL" />);

    expect(fetchForvaltningStatus).toHaveBeenCalledWith('NORDIC');
    expect(fetchForvaltningData).toHaveBeenCalledWith('ALL');
    // Alla per-källa-panelerna + status sätts in.
    expect(await screen.findByText('Förvaltningsindex')).toBeInTheDocument();
    expect(screen.getByText('Sveriges riksdag (SE)')).toBeInTheDocument();
    expect(screen.getByText('Felles datakatalog, DigDir (NO)')).toBeInTheDocument();
    expect(screen.getByText('Retsinformation (DK)')).toBeInTheDocument();
    expect(screen.getByText('Finlex, lagsättning (FI)')).toBeInTheDocument();
    expect(screen.getByText('Parlament (IPU Parline)')).toBeInTheDocument();
    expect(screen.getByText('data.europa.eu Data Portal')).toBeInTheDocument();
    expect(screen.getByText('EUR-Lex / Cellar (EU)')).toBeInTheDocument();
    expect(container.querySelector('.industry-grid')).not.toBeNull();
    // Luckkortet visas i den nordiska sammanfattningen (inte landsvyn).
    expect(screen.getByText('Kända luckor – offentlig förvaltning')).toBeInTheDocument();
    // Records distribueras till rätt paneler.
    expect(screen.getByText('Tjänstgörande ledamöter')).toBeInTheDocument();
    expect(screen.getByText('Dataset i Felles datakatalog')).toBeInTheDocument();
    expect(screen.getByText(`EU-rättsliga texter ${Y} (CELEX, YTD)`)).toBeInTheDocument();
    expect(screen.queryByText('Islandsk offentlig förvaltning (IS)')).not.toBeInTheDocument();
  });

  test('landsvy (SE): status + data för SE, bara riksdagspanelen nationellt, drivfaktorer', async () => {
    vi.mocked(fetchForvaltningStatus).mockResolvedValue(ok(STATUS_SE));
    vi.mocked(fetchForvaltningData).mockResolvedValue(ok({
      ...DATA_BODY, country: 'SE',
      records: RECS.filter(r => r.country === 'SE' || r.country === 'NORDIC'),
    }));
    render(<ForvaltningView country="SE" />);

    expect(fetchForvaltningStatus).toHaveBeenCalledWith('SE');
    expect(fetchForvaltningData).toHaveBeenCalledWith('SE');
    expect(await screen.findByText('Sveriges riksdag (SE)')).toBeInTheDocument();
    // Övriga nationella paneler visas ej i landsvyn.
    expect(screen.queryByText('Felles datakatalog, DigDir (NO)')).not.toBeInTheDocument();
    expect(screen.queryByText('Retsinformation (DK)')).not.toBeInTheDocument();
    expect(screen.queryByText('Finlex, lagsättning (FI)')).not.toBeInTheDocument();
    // Gemensamma paneler visas + drivfaktorer istället för per-land-tabell.
    expect(screen.getByText('Parlament (IPU Parline)')).toBeInTheDocument();
    expect(screen.getByText('Aktivitet: riksdagen: 6 kalenderhändelser, 3 omröstningar, 5 anföranden')).toBeInTheDocument();
    expect(screen.queryByText('Kända luckor – offentlig förvaltning')).not.toBeInTheDocument();
  });

  test('landsvy (IS): luckkort i stället för nationell panel', async () => {
    vi.mocked(fetchForvaltningStatus).mockResolvedValue(ok({ ...STATUS_NORDIC, country: 'IS' }));
    vi.mocked(fetchForvaltningData).mockResolvedValue(ok({
      ...DATA_BODY, country: 'IS',
      records: RECS.filter(r => r.country === 'IS' || r.country === 'NORDIC'),
    }));
    render(<ForvaltningView country="IS" />);

    expect(fetchForvaltningStatus).toHaveBeenCalledWith('IS');
    expect(await screen.findByText('Islandsk offentlig förvaltning (IS)')).toBeInTheDocument();
    expect(screen.queryByText('Sveriges riksdag (SE)')).not.toBeInTheDocument();
    // Parlamentet täcks ändå via IPU (IS-radens ledamöter).
    expect(screen.getByText('63')).toBeInTheDocument();
  });

  test('ofoglig country → NORDIC; datafel → fel i sju paneler, retry hämtar igen', async () => {
    vi.mocked(fetchForvaltningStatus).mockResolvedValue(ok(STATUS_NORDIC));
    vi.mocked(fetchForvaltningData)
      .mockResolvedValueOnce(sourceError('riksdagen: 404 för många anrop'))
      .mockResolvedValue(ok(DATA_BODY));
    render(<ForvaltningView country="XX" />);

    expect(fetchForvaltningStatus).toHaveBeenCalledWith('NORDIC');
    // Datafelet visas i alla sju recordbaserade panelerna (delade datafeed).
    expect((await screen.findAllByText('riksdagen: 404 för många anrop')).length).toBe(7);
    expect(screen.getAllByText('Kunde inte hämta data.').length).toBe(7);

    const retry = screen.getAllByText('Försök igen')[0];
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Dataset i Felles datakatalog')).toBeInTheDocument());
    expect(screen.queryByText('riksdagen: 404 för många anrop')).not.toBeInTheDocument();
  });
});
