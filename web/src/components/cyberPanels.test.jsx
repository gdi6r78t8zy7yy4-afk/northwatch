// M9: cyberpanelerna (område 5) – rendering av ok-/fel-/loading-lägen,
// filter och rad-expansion för NVD/KEV/OSV/KEV×NVD-widgeterna. /api/cyber/*
// mockas via auto-mockad api.js (samma mönster som DashboardPage.test.jsx) –
// inget nätverk.
import { test, expect, describe, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CyberNvdPanel from './CyberNvdPanel.jsx';
import CyberKevPanel from './CyberKevPanel.jsx';
import CyberOsvPanel from './CyberOsvPanel.jsx';
import CyberPrioritizedPanel from './CyberPrioritizedPanel.jsx';

vi.mock('../api.js');
import {
  fetchCyberNvd, fetchCyberKev, fetchCyberOsv, fetchCyberPrioritized,
} from '../api.js';

const ok = body => ({ ok: true, status: 200, body });
const sourceError = message => ({ ok: false, status: 502, body: { error: message } });

beforeEach(() => {
  vi.mocked(fetchCyberNvd).mockReset();
  vi.mocked(fetchCyberKev).mockReset();
  vi.mocked(fetchCyberOsv).mockReset();
  vi.mocked(fetchCyberPrioritized).mockReset();
});

describe('CyberNvdPanel', () => {
  const NVD_BODY = {
    fetchedAt: '2026-11-06T21:00:00.000Z',
    window: 7,
    total: 42,
    dbTotal: 420447,
    capped: true,
    error: null,
    inWindow: 2,
    bySeverity: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, UNSCORED: 0 },
    perDay: [
      { day: '2026-11-05', n: 1 },
      { day: '2026-11-06', n: 1 },
    ],
    count: 2,
    top: [
      {
        id: 'CVE-2026-11111', published: '2026-11-06T10:00:00Z', modified: '2026-11-06T12:00:00Z',
        status: 'Analyzed', desc: 'Kritiskt fel i exempelapplikationen.', score: 9.8, severity: 'CRITICAL',
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', cwe: 'CWE-787',
        refs: ['https://example.com/advisory-1'],
      },
      {
        id: 'CVE-2026-22222', published: '2026-11-05T09:00:00Z', modified: '2026-11-05T11:00:00Z',
        status: 'Awaiting Analysis', desc: 'Hög risk för informationsläckage.', score: 7.5,
        severity: 'HIGH', vector: '', cwe: '', refs: [],
      },
    ],
  };

  test('KPI:er, per-dags-spark, tabell och expanderbar rad', async () => {
    vi.mocked(fetchCyberNvd).mockResolvedValue(ok(NVD_BODY));
    const { container } = render(<CyberNvdPanel />);

    expect(await screen.findByText('NVD – nya sårbarheter (senaste 30 d)')).toBeInTheDocument();
    expect(fetchCyberNvd).toHaveBeenCalledWith({ window: 7, severity: '', q: '', sort: 'newest', limit: 50 });
    expect(screen.getByText('Publicerade senaste 7 d')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '.kpi .n' })).toBeInTheDocument();
    expect(screen.getByText('Publicerade per dag')).toBeInTheDocument();
    expect(container.querySelectorAll('.spark i').length).toBe(2);
    expect(screen.getByText('CVE-2026-11111')).toBeInTheDocument();
    expect(screen.getByText('CVE-2026-22222')).toBeInTheDocument();
    expect(screen.getByText('9.8 Kritisk')).toBeInTheDocument();
    expect(screen.getByText('7.5 Hög')).toBeInTheDocument();
    expect(screen.getByText(/Del av fönstret är utelämnat/)).toBeInTheDocument();
    expect(screen.getByText(/Visar 2 av 2 i fönstret/)).toBeInTheDocument();

    // Expandera första raden: status, CWE, vektor, referens och NVD-länk.
    fireEvent.click(screen.getByText('CVE-2026-11111'));
    expect(await screen.findByText('Sårbarhetstyp: CWE-787')).toBeInTheDocument();
    expect(screen.getByText('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/advisory-1')).toBeInTheDocument();
    expect(screen.getByText('Se i NVD →')).toBeInTheDocument();
  });

  test('severity-chipet sätter filtret på nästa anrop', async () => {
    vi.mocked(fetchCyberNvd).mockResolvedValue(ok(NVD_BODY));
    render(<CyberNvdPanel />);
    await screen.findByText('CVE-2026-11111');

    fireEvent.click(screen.getByText('Kritisk (1)'));
    await waitFor(() => {
      expect(fetchCyberNvd).toHaveBeenLastCalledWith({
        window: 7, severity: 'CRITICAL', q: '', sort: 'newest', limit: 50,
      });
    });
  });

  test('källfel visas med felmeddelande och retry fungerar', async () => {
    vi.mocked(fetchCyberNvd)
      .mockResolvedValueOnce(sourceError('NVD: timeout'))
      .mockResolvedValueOnce(ok(NVD_BODY));
    render(<CyberNvdPanel />);

    expect(await screen.findByText('NVD: timeout')).toBeInTheDocument();
    expect(screen.getByText('Kunde inte hämta data.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Försök igen'));
    expect(await screen.findByText('CVE-2026-11111')).toBeInTheDocument();
  });
});

describe('CyberKevPanel', () => {
  const KEV_BODY = {
    fetchedAt: '2026-11-06T21:00:00.000Z',
    total: 2,
    dateReleased: '2026-11-04T20:00:05.774Z',
    error: null,
    added90: 1,
    ransomware: 1,
    dueSoon: 1,
    byMonth: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`, n: i === 10 ? 1 : 0,
    })),
    count: 2,
    rows: [
      {
        id: 'CVE-2026-19868', vendor: 'Fortinet', product: 'FortiOS',
        added: '2026-11-05', due: '2026-11-19', action: 'Apply the vendor-provided fix.',
        notes: 'CISA is aware that this vulnerability is being actively exploited.',
        short: 'Heap overflow in FortiOS web components.', ransomware: false, cwes: ['CWE-122'],
      },
      {
        id: 'CVE-2026-111357', vendor: 'Ivanti', product: 'Connect Secure',
        added: '2026-11-03', due: '2026-11-17', action: '', notes: '',
        short: 'Authentication bypass in Ivanti Connect Secure.', ransomware: true,
        cwes: ['CWE-287'],
      },
    ],
  };

  test('KPI:er, månadshistogram och expanderbar rad', async () => {
    vi.mocked(fetchCyberKev).mockResolvedValue(ok(KEV_BODY));
    const { container } = render(<CyberKevPanel />);

    expect(await screen.findByText('CISA KEV – kända exploaterade sårbarheter')).toBeInTheDocument();
    expect(fetchCyberKev).toHaveBeenCalledWith({ q: '', ransomware: false, sort: 'added', limit: 100 });
    expect(screen.getByText('Tillagda senaste 90 d')).toBeInTheDocument();
    expect(screen.getByText('Kända ransomware-kampanjer')).toBeInTheDocument();
    expect(container.querySelectorAll('.bar-row').length).toBe(12);
    expect(screen.getByText('CVE-2026-19868')).toBeInTheDocument();
    expect(screen.getByText('CVE-2026-111357 🔒')).toBeInTheDocument();

    // Expandera första raden: åtgärd, CWE och NVD-länk.
    fireEvent.click(screen.getByText('CVE-2026-19868'));
    expect(await screen.findByText('Åtgärd: Apply the vendor-provided fix.')).toBeInTheDocument();
    expect(screen.getByText('CWE: CWE-122')).toBeInTheDocument();
    expect(screen.getByText('Se i NVD →')).toBeInTheDocument();
  });

  test('ransomware-växlaren sätter filtret på nästa anrop', async () => {
    vi.mocked(fetchCyberKev).mockResolvedValue(ok(KEV_BODY));
    render(<CyberKevPanel />);
    await screen.findByText('CVE-2026-19868');

    fireEvent.click(screen.getByText('Bara ransomware'));
    await waitFor(() => {
      expect(fetchCyberKev).toHaveBeenLastCalledWith({
        q: '', ransomware: true, sort: 'added', limit: 100,
      });
    });
  });
});

describe('CyberOsvPanel', () => {
  const OSV_BODY = {
    fetchedAt: '2026-11-06T21:00:00.000Z',
    windowDays: 180,
    error: null,
    packageCount: 3,
    errorCount: 1,
    total: 3,
    new90: 2,
    byEcosystem: [
      { ecosystem: 'npm', packages: 1, advisories: 2 },
      { ecosystem: 'PyPI', packages: 1, advisories: 1 },
      { ecosystem: 'Go', packages: 1, advisories: 0 },
    ],
    packages: [
      {
        ecosystem: 'npm', name: 'express', status: 'ok', total: 2, new90: 1,
        recent: [
          {
            id: 'GHSA-aaaa', alias: 'CVE-2026-1234', summary: 'Open redirect i express.',
            severity: 'HIGH', cwe: 'CWE-79', published: '2026-11-01T00:00:00Z',
            link: 'https://osv.dev/vuln/GHSA-aaaa',
          },
          {
            id: 'GHSA-bbbb', alias: null, summary: '', severity: null, cwe: '',
            published: '2026-10-01T00:00:00Z', link: null,
          },
        ],
      },
      { ecosystem: 'PyPI', name: 'flask', status: 'ok', total: 1, new90: 1, recent: [] },
      {
        ecosystem: 'Go', name: 'golang.org/x/net', status: 'error', total: 0,
        new90: 0, recent: [], error: 'HTTP 429',
      },
    ],
  };

  test('KPI:er, ekosystemchips, felpaket och expanderade rapporter', async () => {
    vi.mocked(fetchCyberOsv).mockResolvedValue(ok(OSV_BODY));
    const { container } = render(<CyberOsvPanel />);

    expect(await screen.findByText('OSV.dev – paketutbud och rapporter')).toBeInTheDocument();
    expect(fetchCyberOsv).toHaveBeenCalledWith({ ecosystem: '' });
    expect(screen.getByText('Övervakade paket')).toBeInTheDocument();
    expect(screen.getByText('Paket med fel')).toBeInTheDocument();
    // Ekosystemet visas som chip (knapp) och i tabellraden → role-baserat.
    expect(screen.getByRole('button', { name: 'npm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    expect(screen.getByText('express')).toBeInTheDocument();
    expect(screen.getByText('golang.org/x/net ⚠')).toBeInTheDocument();

    // Expandera felpaketet.
    fireEvent.click(screen.getByText('golang.org/x/net ⚠'));
    expect(await screen.findByText('Hämtfel: HTTP 429')).toBeInTheDocument();

    // Expandera ett paket med rapporter: severity-badg, alias och osv.dev-länk.
    fireEvent.click(screen.getByText('express'));
    expect(await screen.findByText('GHSA-aaaa')).toBeInTheDocument();
    expect(screen.getByText('(CVE-2026-1234)')).toBeInTheDocument();
    expect(screen.getByText('https://osv.dev/vuln/GHSA-aaaa')).toBeInTheDocument();
  });

  test('ekosystem-chipet filtrerar nästa anrop', async () => {
    vi.mocked(fetchCyberOsv).mockResolvedValue(ok(OSV_BODY));
    render(<CyberOsvPanel />);
    await screen.findByText('express');

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => {
      expect(fetchCyberOsv).toHaveBeenLastCalledWith({ ecosystem: 'Go' });
    });
  });
});

describe('CyberPrioritizedPanel', () => {
  const PRIO_BODY = {
    fetchedAt: '2026-11-06T21:00:00.000Z',
    kevFetchedAt: '2026-11-06T21:00:00.000Z',
    nvdFetchedAt: '2026-11-06T20:00:00.000Z',
    error: null,
    count: 2,
    resolved: 1,
    unresolved: 1,
    rows: [
      {
        id: 'CVE-2026-19868', vendor: 'Fortinet', product: 'FortiOS',
        added: '2026-11-05', due: '2026-11-19', ransomware: true,
        action: 'Apply the vendor-provided fix.', short: 'Heap overflow in FortiOS web components.',
        score: 8.1, severity: 'HIGH', vector: 'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        from: 'nvd-cache', resolved: true,
      },
      {
        id: 'VULN-NO-CVE', vendor: 'Acme', product: 'Widget',
        added: '2026-11-04', due: null, ransomware: false, action: '',
        short: 'Sårbarhet utan CVE-id.', score: null, severity: null, vector: '',
        from: null, resolved: false,
      },
    ],
  };

  test('CVSS-badgar, poängkälla i expansion och olöst rad', async () => {
    vi.mocked(fetchCyberPrioritized).mockResolvedValue(ok(PRIO_BODY));
    render(<CyberPrioritizedPanel />);

    expect(await screen.findByText('Prioriterade exploaterade sårbarheter (KEV × NVD)')).toBeInTheDocument();
    expect(fetchCyberPrioritized).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Senaste KEV-tillägg')).toBeInTheDocument();
    expect(screen.getByText('Utan poäng ännu')).toBeInTheDocument();
    expect(screen.getByText('CVE-2026-19868 🔒')).toBeInTheDocument();
    expect(screen.getByText('8.1 Hög')).toBeInTheDocument();
    expect(screen.getByText('VULN-NO-CVE')).toBeInTheDocument();

    // Uppslagen rad: poängen urs NVD-cachet.
    fireEvent.click(screen.getByText('CVE-2026-19868 🔒'));
    expect(await screen.findByText('Poängkälla: NVD 30-dagarscache')).toBeInTheDocument();
    expect(screen.getByText('Se i NVD →')).toBeInTheDocument();

    // Ej upplösbar rad (icke-CVE).
    fireEvent.click(screen.getByText('VULN-NO-CVE'));
    expect(screen.getByText('Poängkälla: ej upplöst (NVD saknar CVE:et ännu)')).toBeInTheDocument();
  });
});
