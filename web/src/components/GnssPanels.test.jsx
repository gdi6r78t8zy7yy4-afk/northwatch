// M12: GNSS-panelerna (område 10) – rendering av ok-/fel-/loading-lägen för
// byggstenarna (GnssBits) och per-källa-panelerna (GnssPanels) samt GnssView:s
// koppling till /api/gnss/* (mockad api.js). Panelerna är presentationella –
// records och meta { loading, error, fetchedAt, onRetry } kommer som props från
// GnssView. Inget nätverk. Fixtures motsvarar kollektornas faktiska indikator-
// namn och lib/gnss-indexets ankarvärden (se server/test/gnss.test.js).
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LABEL_CLS, SEV_BADGE_CLS, StatusBadge, SevBadge, ComponentRows, ScoreBar, countryLabel } from './GnssBits.jsx';
import {
  GnssStatusPanel, NoaaPanel, CelestrakPanel, GscPanel, M3gPanel,
  DatanorgePanel, ApodPanel, GnssCorrelationPanel, GnssGapCards,
} from './GnssPanels.jsx';
import GnssView from './GnssView.jsx';

vi.mock('../api.js');
import { fetchGnssStatus, fetchGnssData, fetchGnssCorrelation } from '../api.js';

// ------------------------------------------------------------------- Fixtures

const META_OK = { loading: false, error: null, fetchedAt: '2026-11-09T08:00:00Z', onRetry: vi.fn() };
const META_LOADING = { loading: true, error: null, fetchedAt: null, onRetry: vi.fn() };
const META_ERR = { loading: false, error: 'gsc-europa: 503', fetchedAt: null, onRetry: vi.fn() };

const ok = body => ({ ok: true, status: 200, body });
const sourceError = message => ({ ok: false, status: 502, body: { error: message } });

const comp = (score, basis = 'testbasis') => ({ score, basis });
const SE_COMP = {
  tillgänglighet: comp(85.0, 'Galileo 87.5 % USABLE · SE 97.1 % aktiva stationer'),
  stabilitet: comp(70, 'Kp 5 → 70'),
  varningstäthet: comp(36.9, '3 NAGU ≤30 d → 36.9'),
  täckning: comp(100, '70 stationer mot 70 → 100'),
};
const STATUS_NORDIC = {
  generatedAt: '2026-11-09T08:00:00Z',
  country: 'NORDIC', asOf: '2026-11-09T08:00:00Z', score: 68.5, label: 'Stabil drift',
  components: {
    tillgänglighet: comp(79.3), stabilitet: comp(70), varningstäthet: comp(36.9), täckning: comp(79.4),
  },
  drivers: [
    'SE: 74.6 (Stabil drift)', 'NO: 59.3 (Stabil drift)', 'DK: 68.9 (Stabil drift)',
    'FI: 64.9 (Stabil drift)', 'IS: 74.9 (Stabil drift)',
  ],
  sources: ['celestrak', 'datanorge', 'gnss-metadata', 'gsc-europa', 'nasa-apod', 'noaa'],
  countries: [
    { country: 'SE', score: 74.6, label: 'Stabil drift', components: SE_COMP },
    { country: 'NO', score: 59.3, label: 'Stabil drift', components: { ...SE_COMP, tillgänglighet: comp(66.5), täckning: comp(55.6) } },
    { country: 'DK', score: 68.9, label: 'Stabil drift', components: { ...SE_COMP, tillgänglighet: comp(75.6), täckning: comp(88) } },
    { country: 'FI', score: 64.9, label: 'Stabil drift', components: { ...SE_COMP, tillgänglighet: comp(83.8), täckning: comp(53.3) } },
    { country: 'IS', score: 74.9, label: 'Stabil drift', components: { ...SE_COMP, tillgänglighet: comp(85.8) } },
  ],
};
const STATUS_SE = {
  generatedAt: '2026-11-09T08:00:00Z',
  country: 'SE', asOf: '2026-11-09T08:00:00Z', score: 74.6, label: 'Stabil drift',
  components: SE_COMP,
  drivers: [
    'Tillgänglighet: Galileo 87.5 % USABLE · SE 97.1 % aktiva stationer',
    'Stabilitet: Kp 5 → 70',
    'Varningstäthet: 3 NAGU ≤30 d → 36.9',
    'Täckning: 70 stationer mot 70 → 100',
  ],
  sources: ['celestrak', 'gnss-metadata', 'gsc-europa', 'nasa-apod', 'noaa'],
};

const TS = '2026-11-09T08:00:00Z';
const m = (source, country, indicator, value, unit = 'st') => ({ t: 'm', area: 10, country, source, indicator, value, unit, ts: TS });

const NOAA_RECS = [
  m('noaa', 'NORDIC', 'Kp-index (globalt geomagnetiskt)', 5, '0–9'),
  m('noaa', 'NORDIC', 'Estimerat Kp (aktuella 3h-intervallet)', 6, '0–9'),
  m('noaa', 'NORDIC', 'Solradioflux F10.7', 158.9, 'sfu'),
  { t: 'e', area: 10, country: 'NORDIC', source: 'noaa', kind: 'geomagnetiskt', severity: 'warn', title: 'Geomagnetisk storm – Kp 5', detail: '', start: '2026-11-09T07:00:00Z' },
];
const CELESTRAK_RECS = [
  ...['Galileo', 'GLONASS', 'SBAS (EGNOS m.fl.)', 'GPS'].flatMap(l => [
    m('celestrak', 'NORDIC', `Satelliter i elementset (${l})`, 5),
    m('celestrak', 'NORDIC', `Epokålder (${l})`, l === 'SBAS (EGNOS m.fl.)' ? 96 : 12, 'h'),
  ]),
  m('celestrak', 'NORDIC', 'Satelliter i elementset (totalt)', 20),
];
const GSC_RECS = [
  m('gsc-europa', 'NORDIC', 'Galileo-satelliter i konstellationen', 32),
  m('gsc-europa', 'NORDIC', 'Galileo-satelliter tillgängliga (USABLE)', 28),
  m('gsc-europa', 'NORDIC', 'Andel tillgängliga Galileo-satelliter', 87.5, '%'),
  m('gsc-europa', 'NORDIC', 'Galileo-satelliter med fast atomur (PHM)', 20),
  m('gsc-europa', 'NORDIC', 'Aktiva NAGU (konstellationssidan)', 5),
  m('gsc-europa', 'NORDIC', 'Rapporterade NAGU i feeden', 5),
  m('gsc-europa', 'NORDIC', 'Pågående/öppna NAGU (feed)', 1),
  { t: 'e', area: 10, country: 'NORDIC', source: 'gsc-europa', kind: 'nagu', severity: 'warn', title: 'NAGU 2099004: LONG TERM OUTAGE', detail: 'Typ: UNP_SHTRCVR · Satellit: GSAT0208', start: '2026-11-07T13:41:00Z', ref: '2099004' },
  { t: 'e', area: 10, country: 'NORDIC', source: 'gsc-europa', kind: 'nagu', severity: 'info', title: 'NAGU 2099001: SHORT TERM OUTAGE ON GSAT0208', detail: 'Typ: UNP_SHTRCVR · RECOVERED', start: '2026-10-30T06:39:00Z', end: '2026-10-30T08:42:00Z', ref: '2099001' },
];
const M3G_RECS = [
  m('gnss-metadata', 'SE', 'GNSS-stationer (M3G)', 70),
  m('gnss-metadata', 'SE', 'Aktiva GNSS-stationer (andel)', 97.1, '%'),
  m('gnss-metadata', 'SE', 'Flerkonstellationsstationer (andel)', 98.6, '%'),
  m('gnss-metadata', 'NO', 'GNSS-stationer (M3G)', 25),
  m('gnss-metadata', 'IS', 'GNSS-stationer (M3G) (minst)', 53),
  m('gnss-metadata', 'IS', 'Aktiva GNSS-stationer (andel)', 98.1, '%'),
];
const DATANORGE_RECS = [
  m('datanorge', 'NO', 'GNSS-dataset (gnss)', 3),
  m('datanorge', 'NO', 'Publika GNSS-dataset (gnss)', 3),
  m('datanorge', 'NO', 'GNSS-dataset (posisjonering)', 1),
  m('datanorge', 'NO', 'Publika GNSS-dataset (posisjonering)', 1),
];
const APOD_RECS = [
  m('nasa-apod', 'NORDIC', 'APOD-publiceringar (≤10 dagar)', 10),
  m('nasa-apod', 'NORDIC', 'Ålder på senaste APOD', 0.5, 'd'),
];

const CORR_BODY = {
  generatedAt: TS,
  anomalies: [
    { kind: 'rymdväder', severity: 'warn', ts: TS, title: 'Geomagnetisk aktivitet – Kp 5', detail: 'Kp ≥ 5 kan försämra GNSS-positionering.' },
    { kind: 'nagu', severity: 'warn', ts: '2026-11-07T13:41:00Z', title: '1 pågående NAGU', detail: 'NAGU 2099004: LONG TERM OUTAGE' },
  ],
  chains: [{
    id: 'active', type: 'active-now', t0: TS,
    storm: { title: 'Kp 5 just nu', severity: 'warn' },
    nagus: [{ title: 'NAGU 2099004: LONG TERM OUTAGE', start: '2026-11-07T13:41:00Z', end: null }],
    score: 11,
  }],
  narrative: 'Geomagnetisk aktivitet sammanfaller just nu med 1 pågående NAGU.',
  narrativeSource: 'deterministic',
};

const RECS = [...NOAA_RECS, ...CELESTRAK_RECS, ...GSC_RECS, ...M3G_RECS, ...DATANORGE_RECS, ...APOD_RECS];
const DATA_BODY = { generatedAt: TS, country: 'ALL', records: RECS, sources: [] };

// ------------------------------------------------------------------ Bits ----

describe('GnssBits', () => {
  test('LABEL_CLS täcker alla GNSS-index-labels', () => {
    expect(LABEL_CLS['Hög driftssäkerhet']).toBe('fv-hog');
    expect(LABEL_CLS['Stabil drift']).toBe('fv-stab');
    expect(LABEL_CLS.Uppmärksamhet).toBe('fv-opp');
    expect(LABEL_CLS.Svag).toBe('fv-svag');
    expect(LABEL_CLS.Okänt).toBe('fv-unknown');
  });

  test('StatusBadge: klass per label, okänd → fv-unknown', () => {
    const { container } = render(<div>
      <StatusBadge label="Hög driftssäkerhet" />
      <StatusBadge label="Vad som helst" />
    </div>);
    expect(container.querySelector('.ind-badge.fv-hog')).not.toBeNull();
    expect(container.querySelector('.ind-badge.fv-unknown')).not.toBeNull();
  });

  test('SevBadge: alert/warn/info-klasser', () => {
    const { container } = render(<div>
      <SevBadge severity="alert" />
      <SevBadge severity="warn" />
      <SevBadge severity="info" />
      <SevBadge severity={null} />
    </div>);
    expect(SEV_BADGE_CLS).toEqual({ alert: 'fv-svag', warn: 'fv-opp', info: 'fv-stab' });
    const badges = [...container.querySelectorAll('.ind-badge')].map(b => b.className);
    expect(badges[0]).toContain('fv-svag');
    expect(badges[1]).toContain('fv-opp');
    expect(badges[2]).toContain('fv-stab');
    expect(badges[3]).toContain('fv-unknown');
  });

  test('ComponentRows: fyra rader, null-komponent → "–"', () => {
    const { container } = render(<ComponentRows components={{
      tillgänglighet: comp(85), stabilitet: null, varningstäthet: comp(36.9), täckning: undefined,
    }} />);
    expect(container.querySelectorAll('.ind-comp').length).toBe(4);
    expect([...container.querySelectorAll('.ind-comp .lbl')].map(n => n.textContent))
      .toEqual(['Tillgänglighet', 'Stabilitet', 'Varningstäthet', 'Täckning']);
    expect(container.querySelectorAll('.ind-scorebar').length).toBe(2); // null/undefined → '–'
    expect([...container.querySelectorAll('.ind-comp .mut')].map(n => n.textContent)).toEqual(['–', '–']);
  });

  test('ScoreBar null → "–"; countryLabel NORDIC → Nordiskt', () => {
    const { container } = render(<div><ScoreBar score={null} /><ScoreBar score={42.5} /></div>);
    expect(container.querySelector('.ind-scorebar')).not.toBeNull();
    expect(countryLabel('NORDIC')).toBe('Nordiskt');
  });
});

// ----------------------------------------------------------- Statuspanel ----

describe('GnssStatusPanel', () => {
  test('nordisk vy: storscore + komponentrader + per-land-tabell', () => {
    const { container } = render(<GnssStatusPanel status={STATUS_NORDIC} meta={META_OK} />);
    expect(screen.getByText('GNSS-index')).toBeInTheDocument();
    expect(container.textContent).toContain('68.5');
    expect(container.querySelector('.ind-badge.fv-stab')).not.toBeNull(); // 'Stabil drift'
    const rows = [...container.querySelectorAll('.ind-country-table tbody tr')];
    expect(rows.length).toBe(5);
    expect([...rows[0].querySelectorAll('td.mono')].map(n => n.textContent))
      .toEqual(['74.6', '85', '70', '36.9', '100']);
  });

  test('landsvy: drivfaktorer i stället för landtabell', () => {
    const { container } = render(<GnssStatusPanel status={STATUS_SE} meta={META_OK} national />);
    expect(container.querySelector('.ind-country-table')).toBeNull();
    expect(screen.getByText('Täckning: 70 stationer mot 70 → 100')).toBeInTheDocument();
    expect(screen.getByText('Stabilitet: Kp 5 → 70')).toBeInTheDocument();
  });

  test('loading/fel-lägen', () => {
    render(<GnssStatusPanel status={null} meta={META_LOADING} />);
    expect(screen.getByText(/Hämtar data/)).toBeInTheDocument();
    render(<GnssStatusPanel status={null} meta={META_ERR} />);
    expect(screen.getByText('gsc-europa: 503')).toBeInTheDocument(); // WidgetShell-felrad (1 st)
    expect(screen.getByText('Kunde inte hämta data.')).toBeInTheDocument();
  });

  test('score null → "–" och Okänt-badge', () => {
    render(<GnssStatusPanel status={{ ...STATUS_SE, score: null, label: 'Okänt' }} meta={META_OK} national />);
    expect(screen.getByText('Okänt')).toBeInTheDocument();
  });
});

// --------------------------------------------------------- NOAA SWPC --------

describe('NoaaPanel', () => {
  test('KPI:er Kp/estimat/F10.7 + stormhändelse', () => {
    const { container } = render(<NoaaPanel records={NOAA_RECS} meta={META_OK} />);
    expect(screen.getByText('Rymdväder (NOAA SWPC)')).toBeInTheDocument();
    expect([...container.querySelectorAll('.kpi .n')].map(n => n.textContent)).toEqual(['5', '6', '158.9']);
    expect(screen.getByText('Geomagnetisk storm – Kp 5')).toBeInTheDocument();
    expect(screen.getByText(/planetary_k_index/)).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<NoaaPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen rymdvädersdata just nu.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------- CelesTrak GP -------

describe('CelestrakPanel', () => {
  test('total-KPI + tabell med epokålder; SBAS (96 h) markeras som inaktuell', () => {
    const { container } = render(<CelestrakPanel records={CELESTRAK_RECS} meta={META_OK} />);
    expect(screen.getByText('GNSS-elementset (CelesTrak GP)')).toBeInTheDocument();
    expect([...container.querySelectorAll('.kpi .n')].map(n => n.textContent)).toEqual(['20']);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(4); // 'totalt' raden exkluderas
    expect(screen.getByText('SBAS (EGNOS m.fl.)')).toBeInTheDocument();
    expect(screen.getByText('96 ⚠')).toBeInTheDocument(); // >72 h → varning + ⚠
    expect(screen.getAllByText('12').length).toBe(3); // Galileo/GLONASS/GPS är aktuella
  });

  test('tom lista → fallback', () => {
    render(<CelestrakPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Inga elementdata just nu.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------- GSC Europa ------

describe('GscPanel', () => {
  test('KPI:er (32/28/87,5 %/20/1) + NAGU-händelser med detalj', () => {
    const { container } = render(<GscPanel records={GSC_RECS} meta={META_OK} />);
    expect(screen.getByText('Galileo & EGNOS (GSC Europa)')).toBeInTheDocument();
    expect([...container.querySelectorAll('.kpi .n')].map(n => n.textContent))
      .toEqual(['32', '28', '87.5 %', '20', '1']);
    expect(screen.getByText('NAGU 2099004: LONG TERM OUTAGE')).toBeInTheDocument();
    expect(screen.getByText('Typ: UNP_SHTRCVR · Satellit: GSAT0208')).toBeInTheDocument();
    expect(container.querySelectorAll('.fv-event').length).toBe(2);
  });

  test('tom lista → fallback', () => {
    render(<GscPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen Galileo-data just nu.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------ M3G / EPOS ----------

describe('M3gPanel', () => {
  test('per-land-tabell; mättat land (minst) → "≥"', () => {
    const { container } = render(<M3gPanel records={M3G_RECS} meta={META_OK} />);
    expect(screen.getByText('GNSS-stationer (M3G / EPOS)')).toBeInTheDocument();
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(3); // SE, NO, IS
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('53 ≥')).toBeInTheDocument();
    expect(screen.getByText('97.1 %')).toBeInTheDocument();
    expect(screen.getByText(/doi:10\.24414\/ROB-GNSS-M3G/)).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<M3gPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Inga stationsdata just nu.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------ data.norge.no -------

describe('DatanorgePanel', () => {
  test('KPI:er per query + recordtabell', () => {
    const { container } = render(<DatanorgePanel records={DATANORGE_RECS} meta={META_OK} />);
    expect(screen.getByText('GNSS-register (data.norge.no, NO)')).toBeInTheDocument();
    expect([...container.querySelectorAll('.kpi .n')].map(n => n.textContent)).toEqual(['3', '3', '1', '1']);
    expect(screen.getByText('Publika GNSS-dataset (posisjonering)')).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<DatanorgePanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen norska datasetdata just nu.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- APOD ---------

describe('ApodPanel', () => {
  test('publiceringstakt + ålder; information-enbart-notis', () => {
    const { container } = render(<ApodPanel records={APOD_RECS} meta={META_OK} />);
    expect([...container.querySelectorAll('.kpi .n')].map(n => n.textContent)).toEqual(['10', '0.5 d']);
    expect(screen.getByText(/ingår inte i GNSS-index/)).toBeInTheDocument();
  });

  test('tom lista → fallback', () => {
    render(<ApodPanel records={[]} meta={META_OK} />);
    expect(screen.getByText('Ingen APOD-data just nu.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------- Korrelation -----

describe('GnssCorrelationPanel', () => {
  beforeEach(() => fetchGnssCorrelation.mockReset());

  test('narrativ + kedja + anomalier (deterministisk källa)', async () => {
    fetchGnssCorrelation.mockResolvedValue(ok(CORR_BODY));
    render(<GnssCorrelationPanel />);
    expect(await screen.findByText(/sammanfaller just nu med 1 pågående NAGU/)).toBeInTheDocument();
    expect(screen.getByText('Analys: deterministisk regeltext')).toBeInTheDocument();
    expect(screen.getByText('Pågående sammanfall')).toBeInTheDocument();
    expect(screen.getByText('Kp 5 just nu + 1 NAGU')).toBeInTheDocument();
    expect(screen.getByText('Geomagnetisk aktivitet – Kp 5')).toBeInTheDocument();
    expect(fetchGnssCorrelation).toHaveBeenCalledTimes(1);
  });

  test('LLM-berikad källa taggas', async () => {
    fetchGnssCorrelation.mockResolvedValue(ok({ ...CORR_BODY, narrativeSource: 'llm' }));
    render(<GnssCorrelationPanel />);
    expect(await screen.findByText(/LLM-berikad \(qwen3\.8-flash-next\)/)).toBeInTheDocument();
  });

  test('lugnt läge: inga kedjor/anomalier → lugn text', async () => {
    fetchGnssCorrelation.mockResolvedValue(ok({ ...CORR_BODY, chains: [], anomalies: [] }));
    render(<GnssCorrelationPanel />);
    expect(await screen.findByText('Inga aktiva anomalier i nuläget.')).toBeInTheDocument();
  });

  test('fel → felrad med retry', async () => {
    fetchGnssCorrelation.mockResolvedValue(sourceError('LLM-hantering misslyckades'));
    render(<GnssCorrelationPanel />);
    expect(await screen.findByText('LLM-hantering misslyckades')).toBeInTheDocument();
  });
});

// --------------------------------------------------------------- Luckor -----

describe('GnssGapCards', () => {
  test('kända luckor: SWEPOS/FINPOS/DK, SWE/Space-Track, Island, M3G-taket, Copernicus', () => {
    render(<GnssGapCards />);
    expect(screen.getByText('Kända luckor – rymd, navigation och positionering')).toBeInTheDocument();
    expect(screen.getByText(/SWEPOS RINEX/)).toBeInTheDocument();
    expect(screen.getByText(/Space-Track/)).toBeInTheDocument();
    expect(screen.getByText(/althingi\.is/)).toBeInTheDocument();
    expect(screen.getByText(/max 20 stationer/)).toBeInTheDocument();
    expect(screen.getByText(/Copernicus Data Space/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- View ------

describe('GnssView', () => {
  beforeEach(() => {
    fetchGnssStatus.mockReset();
    fetchGnssData.mockReset();
    fetchGnssCorrelation.mockReset().mockResolvedValue(ok(CORR_BODY));
  });

  test('NORDIC/ALL: status för NORDIC, data för ALL, alla paneler + luckkort', async () => {
    fetchGnssStatus.mockResolvedValue(ok(STATUS_NORDIC));
    fetchGnssData.mockResolvedValue(ok(DATA_BODY));
    const { container } = render(<GnssView country="ALL" />);

    expect(fetchGnssStatus).toHaveBeenCalledWith('NORDIC');
    expect(fetchGnssData).toHaveBeenCalledWith('ALL');
    expect(await screen.findByText('GNSS-index')).toBeInTheDocument();
    expect(screen.getByText('Rymdväder (NOAA SWPC)')).toBeInTheDocument();
    expect(screen.getByText('GNSS-elementset (CelesTrak GP)')).toBeInTheDocument();
    expect(screen.getByText('Galileo & EGNOS (GSC Europa)')).toBeInTheDocument();
    expect(screen.getByText('GNSS-stationer (M3G / EPOS)')).toBeInTheDocument();
    expect(screen.getByText('GNSS-register (data.norge.no, NO)')).toBeInTheDocument();
    expect(screen.getByText('APOD-publiceringstakt (NASA)')).toBeInTheDocument();
    expect(screen.getByText('Korrelation – rymdväder × GNSS')).toBeInTheDocument();
    expect(container.querySelector('.industry-grid')).not.toBeNull();
    expect(screen.getByText('Kända luckor – rymd, navigation och positionering')).toBeInTheDocument();
    // Records distribueras till rätt paneler.
    expect(screen.getByText('Solradioflux F10.7')).toBeInTheDocument();
    expect(screen.getByText('53 ≥')).toBeInTheDocument();
    expect(screen.getByText('Publika GNSS-dataset (gnss)')).toBeInTheDocument();
  });

  test('landsvy (SE): nationella datanorge-panelen visas ej, drivfaktorer istället för landtabell', async () => {
    fetchGnssStatus.mockResolvedValue(ok(STATUS_SE));
    fetchGnssData.mockResolvedValue(ok({
      ...DATA_BODY, country: 'SE',
      records: RECS.filter(r => r.country === 'SE' || r.country === 'NORDIC'),
    }));
    render(<GnssView country="SE" />);

    expect(fetchGnssStatus).toHaveBeenCalledWith('SE');
    expect(fetchGnssData).toHaveBeenCalledWith('SE');
    expect(await screen.findByText('Täckning: 70 stationer mot 70 → 100')).toBeInTheDocument();
    expect(screen.queryByText('GNSS-register (data.norge.no, NO)')).not.toBeInTheDocument();
    expect(screen.queryByText('Kända luckor – rymd, navigation och positionering')).not.toBeInTheDocument();
    // M3G-panelen visar bara SE-rader i landsvyn.
    await waitFor(() => expect(screen.getByText('97.1 %')).toBeInTheDocument());
    expect(screen.queryByText('53 ≥')).not.toBeInTheDocument();
  });

  test('ofoglig country → NORDIC; datafel → fel i sex recordpaneler, retry hämtar igen', async () => {
    fetchGnssStatus.mockResolvedValue(ok(STATUS_NORDIC));
    fetchGnssData
      .mockResolvedValueOnce(sourceError('gsc-europa: 503'))
      .mockResolvedValue(ok(DATA_BODY));
    render(<GnssView country="XX" />);

    expect(fetchGnssStatus).toHaveBeenCalledWith('NORDIC');
    // Datafelet visas i alla sex recordbaserade panelerna (delade datafeedet):
    // NOAA, CelesTrak, GSC, M3G, Datanorge och APOD.
    expect((await screen.findAllByText('gsc-europa: 503')).length).toBe(6);
    expect(screen.getAllByText('Kunde inte hämta data.').length).toBe(6);

    const retry = screen.getAllByText('Försök igen')[0];
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Solradioflux F10.7')).toBeInTheDocument());
    expect(screen.queryByText('gsc-europa: 503')).not.toBeInTheDocument();
  });

  test('statusfel → GNSS-index-panelen visar felet, resten lever', async () => {
    fetchGnssStatus.mockResolvedValue(sourceError('ingen data för område 10'));
    fetchGnssData.mockResolvedValue(ok(DATA_BODY));
    render(<GnssView country="NORDIC" />);

    expect(await screen.findByText('ingen data för område 10')).toBeInTheDocument();
    expect(screen.getByText('Rymdväder (NOAA SWPC)')).toBeInTheDocument();
  });
});
