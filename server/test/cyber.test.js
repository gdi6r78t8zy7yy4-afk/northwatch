// Enhetstester för cyberdatslagret (M9, område 5): NVD/KEV/OSV-hämtare,
// API-handlingar, kollektorer och KEV×NVD-join. Inget nätverk – globalThis.fetch
// mockas per test. Miljön sätts INNAN importen (NVD_MAX_PAGES/NVD_PAGE_DELAY_MS/
// OSV_QUERY_DELAY_MS/OSV_WATCH_PACKAGES läses då). Fixtures i testdata/cyber/
// (formverifierade mot live-API:na 2026-11-06); riktiga tal beräknas ur
// fixtures, inte hårdkodas.
//
// Kör: node --test server/test/cyber.test.js
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NVD_MAX_PAGES = '2';
process.env.NVD_PAGE_DELAY_MS = '0';
process.env.OSV_QUERY_DELAY_MS = '0';
process.env.OSV_WATCH_PACKAGES = 'npm:express;PyPI:flask';
delete process.env.NVD_API_KEY;

const {
  cyber, NVD_WINDOW_DAYS, OSV_WINDOW_DAYS,
  scoreSeverity, trimCve, fetchNvdWindow, apiCyberNvd,
  trimKev, fetchKevCatalog, apiCyberKev,
  parseWatchEnv, WATCH, DEFAULT_WATCH, sevRank, trimOsv, fetchOsvWatchlist, apiCyberOsv,
  nvdScoreForCve, apiCyberPrioritized, apiCyberOverview,
  nvdJson,
} = await import('../lib/cyber.js');
const nvdCollector = (await import('../collectors/nvd.js')).default;
const kevCollector = (await import('../collectors/kev.js')).default;
const osvCollector = (await import('../collectors/osv.js')).default;

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'cyber');
const fixture = f => JSON.parse(fs.readFileSync(path.join(TESTDATA, f), 'utf8'));

// ---- Mockad fetch ----------------------------------------------------------

let fetchImpl = () => { throw new Error('ingen fetch-mock satt'); };
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opt) => fetchImpl(String(url), opt);
before(() => {});
after(() => { globalThis.fetch = realFetch; });

// Rå-NVD-CVE-generator (form enligt API:t 2.0).
const nvdCve = (id, published, { score = 9.8, severity = 'CRITICAL', desc = `Beskrivning för ${id}.` } = {}) => ({
  cve: {
    id,
    published,
    lastModified: published,
    vulnStatus: 'Analyzed',
    metrics: score != null
      ? { cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: score, baseSeverity: severity, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' } }] }
      : {},
    descriptions: [{ lang: 'en', value: desc }],
    references: [{ url: `https://example.com/${id}` }],
    weaknesses: [{ description: [{ lang: 'en', value: 'CWE-787' }] }],
  },
});
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = n => new Date(Date.now() + n * 86400000).toISOString();
const isoDay = t => new Date(t).toISOString().slice(0, 10);

const resetCyber = () => {
  cyber.nvd = null;
  cyber.kev = null;
  cyber.osv = null;
  cyber.kevScore.clear();
  cyber.error = null;
};
beforeEach(resetCyber);

const seedNvd = rows => {
  cyber.nvd = { fetchedAt: new Date().toISOString(), dbTotal: 420000, capped: false, rows, error: null };
};
const seedKev = entries => {
  cyber.kev = {
    fetchedAt: new Date().toISOString(),
    total: entries.length,
    dateReleased: new Date().toISOString(),
    entries,
    error: null,
  };
};

// ---- trimCve + scoreSeverity ------------------------------------------------

describe('trimCve / scoreSeverity', () => {
  test('v3.1 Primary föredras före Secondary', () => {
    const t = trimCve(fixture('nvd-cve.json').vulnerabilities[0]);
    assert.equal(t.id, 'CVE-2026-9999');
    assert.equal(t.score, 9.1);
    assert.equal(t.severity, 'CRITICAL');
    assert.equal(t.vector, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    assert.equal(t.cwe, 'CWE-1321');
    assert.equal(t.status, 'Analyzed');
    assert.equal(t.refs.length, 3);
  });

  test('engelsk beskrivning föredras, överskridande klippas (≤ 240 tecken)', () => {
    const long = 'x'.repeat(300);
    const v = { cve: {
      id: 'CVE-1', published: null, lastModified: null, vulnStatus: null,
      descriptions: [{ lang: 'sv', value: 'På svenska' }, { lang: 'en', value: long }],
    } };
    const t = trimCve(v);
    assert.ok(t.desc.length < 300);
    assert.ok(t.desc.length <= 240);
    assert.ok(t.desc.startsWith('xxxxx'));
    assert.ok(t.desc.endsWith('…'));
    assert.equal(t.score, null);
    assert.equal(t.severity, null);
  });

  test('v3.0-fallback och v2-fallback', () => {
    const v30 = { cve: { id: 'C-30', metrics: { cvssMetricV30: [{ type: 'Primary', cvssData: { baseScore: 7.5, baseSeverity: 'HIGH' } }] } } };
    assert.equal(trimCve(v30).score, 7.5);
    const v2 = { cve: { id: 'C-2', metrics: { cvssMetricV2: [{ type: 'Primary', cvssData: { baseScore: 10, vectorString: 'AV:N/AC:L/Au:N/C:C/I:C/A:C' } }] } } };
    const t2 = trimCve(v2);
    assert.equal(t2.score, 10);
    assert.equal(t2.severity, 'CRITICAL'); // allvarlighet härleds ur v2-scoren
  });

  test('scoreSeverity-gränser', () => {
    assert.equal(scoreSeverity(9), 'CRITICAL');
    assert.equal(scoreSeverity(8.9), 'HIGH');
    assert.equal(scoreSeverity(7), 'HIGH');
    assert.equal(scoreSeverity(6.9), 'MEDIUM');
    assert.equal(scoreSeverity(4), 'MEDIUM');
    assert.equal(scoreSeverity(3.9), 'LOW');
    assert.equal(scoreSeverity(0), 'LOW');
    assert.equal(scoreSeverity(null), null);
  });
});

// ---- fetchNvdWindow ----------------------------------------------------------

describe('fetchNvdWindow', () => {
  // Veckosubfönster (nyast först) med NVD_WINDOW_DAYS=30: subfönster c täcker
  // (end-(c+1)*7d, end-c*7d], clampat mot start. nvdDate:s tidsträng saknar Z
  // (NVD-format) → mocken parsear den som explicit UTC.
  const chunkOf = u => Math.round(
    (Date.now() - new Date(u.searchParams.get('pubEndDate') + 'Z').getTime()) / (7 * 86400000));

  test('hämtar 5 subfönster nyast först, deduperar över gränser, capped=false', async () => {
    const calls = [];
    // Pubdate exakt på subfönstrets gemensamma gräns (end-7d) ingår i båda
    // grannfönstren (NVD-datum är inkluderande) → gränsdubbelet deduperas.
    const boundary = new Date(Date.now() - 7 * 86400000).toISOString();
    fetchImpl = (url) => {
      const u = new URL(url);
      calls.push(u);
      const c = chunkOf(u);
      const wEnd = new Date(u.searchParams.get('pubEndDate') + 'Z').getTime();
      const rows = [0, 1, 2].map(k => nvdCve(`CVE-2026-${c}A${k}`, new Date(wEnd - (k + 1) * 3600e3).toISOString()));
      if (c === 0 || c === 1) rows.push(nvdCve('CVE-2026-SHARED', boundary));
      return { ok: true, status: 200, json: async () => ({ totalResults: rows.length, vulnerabilities: rows }) };
    };
    const r = await fetchNvdWindow();
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.map(u => chunkOf(u)), [0, 1, 2, 3, 4]); // nyast först
    assert.equal(r.capped, false);
    assert.equal(r.dbTotal, null); // ingen NVD_API_KEY i testmiljön
    assert.equal(r.rows.length, 5 * 3 + 1); // 15 + delat – 1 dubbelet
    assert.equal(r.rows.filter(x => x.id === 'CVE-2026-SHARED').length, 1);
    // Sorterat nyast först.
    for (let i = 1; i < r.rows.length; i += 1) {
      assert.ok(r.rows[i - 1].published >= r.rows[i].published);
    }
  });

  test('capped=true när ett subfönster når sin sidbudget med kvarvarande rader', async () => {
    const calls = [];
    fetchImpl = (url) => {
      const u = new URL(url);
      calls.push(u);
      const c = chunkOf(u);
      if (c === 0) {
        const start = Number(u.searchParams.get('startIndex'));
        const rows = Array.from({ length: 2000 }, (_, k) => nvdCve(`CVE-2026-BIG${start + k}`, daysAgo(1)));
        return { ok: true, status: 200, json: async () => ({ totalResults: 5000, vulnerabilities: rows }) };
      }
      return { ok: true, status: 200, json: async () => ({ totalResults: 0, vulnerabilities: [] }) };
    };
    const r = await fetchNvdWindow();
    assert.equal(r.capped, true);
    assert.equal(r.rows.length, 4000); // budget [2,…] → 2×2000 i nyaste veckan
    assert.equal(calls.length, 6); // 2 sidor c0 + 1 sida per äldre subfönster
  });

  test('databastotalen hämtas bara med NVD_API_KEY', async () => {
    const calls = [];
    fetchImpl = (url) => {
      const u = new URL(url);
      calls.push(u);
      if (u.searchParams.get('resultsPerPage') === '1') {
        return { ok: true, status: 200, json: async () => ({ totalResults: 420447 }) };
      }
      return { ok: true, status: 200, json: async () => ({ totalResults: 0, vulnerabilities: [] }) };
    };
    process.env.NVD_API_KEY = 'test-key';
    try {
      const r = await fetchNvdWindow();
      assert.equal(r.dbTotal, 420447);
      assert.ok(calls.some(u => u.searchParams.get('resultsPerPage') === '1'));
    } finally {
      delete process.env.NVD_API_KEY;
    }
    calls.length = 0;
    const r2 = await fetchNvdWindow();
    assert.equal(r2.dbTotal, null);
    assert.ok(!calls.some(u => u.searchParams.get('resultsPerPage') === '1'));
  });
});

// ---- apiCyberNvd ---------------------------------------------------------------

describe('apiCyberNvd', () => {
  const mk = (id, days, score, severity, desc = '') => ({
    id, published: daysAgo(days), modified: daysAgo(days), status: 'Analyzed',
    desc, score, severity, vector: '', cwe: '', refs: [],
  });
  const SEED = [
    mk('CVE-2026-0001', 1, 9.8, 'CRITICAL', 'critical flaw in example app'),
    mk('CVE-2026-0002', 5, 7.5, 'HIGH', 'high impact issue'),
    mk('CVE-2026-0003', 20, 5.0, 'MEDIUM', 'medium concern'),
    mk('CVE-2026-0004', 2, null, null, 'unscored item'),
  ];

  test('fönster, bySeverity, perDay och sort=nyast', async () => {
    seedNvd(SEED);
    const r = await apiCyberNvd(new URL('http://x/?window=7'));
    assert.equal(r.status, 200);
    assert.equal(r.body.inWindow, 3);
    assert.deepEqual(r.body.bySeverity, { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0, UNSCORED: 1 });
    assert.equal(r.body.perDay.length, 7);
    assert.equal(r.body.perDay.reduce((s, d) => s + d.n, 0), 3);
    assert.equal(r.body.top[0].id, 'CVE-2026-0001'); // nyast = 1 d sedan
    assert.equal(r.body.count, 3);
    assert.equal(r.body.capped, false);
  });

  test('bySeverity: NVD:s baseSeverity "NONE" (score 0) räknas i eget bucket', async () => {
    seedNvd([
      ...SEED,
      mk('CVE-2026-0005', 3, 0, 'NONE'), // NVD skickar "NONE" för score 0
    ]);
    const r = await apiCyberNvd(new URL('http://x/?window=7'));
    assert.equal(r.body.bySeverity.NONE, 1); // inte null (obj[okänd] += 1 → NaN)
    assert.equal(r.body.inWindow, 4);
    assert.equal(r.body.bySeverity.CRITICAL + r.body.bySeverity.HIGH
      + r.body.bySeverity.UNSCORED + r.body.bySeverity.NONE, 4);
    const f = await apiCyberNvd(new URL('http://x/?window=30&severity=NONE'));
    assert.deepEqual(f.body.top.map(t => t.id), ['CVE-2026-0005']);
  });

  test('severity-/q-filter och sort=score med limit', async () => {
    seedNvd(SEED);
    const sev = await apiCyberNvd(new URL('http://x/?window=30&severity=CRITICAL'));
    assert.deepEqual(sev.body.top.map(t => t.id), ['CVE-2026-0001']);
    const q = await apiCyberNvd(new URL('http://x/?window=30&q=0003'));
    assert.deepEqual(q.body.top.map(t => t.id), ['CVE-2026-0003']);
    const qd = await apiCyberNvd(new URL('http://x/?window=30&q=critical'));
    assert.deepEqual(qd.body.top.map(t => t.id), ['CVE-2026-0001']);
    const sc = await apiCyberNvd(new URL('http://x/?window=30&sort=score&limit=2'));
    assert.deepEqual(sc.body.top.map(t => t.id), ['CVE-2026-0001', 'CVE-2026-0002']);
    assert.equal(sc.body.count, 4); // limit påverkar bara top, inte count
  });

  test('502 när källhämtningen misslyckas utan cachat data', async () => {
    fetchImpl = () => { throw new Error('timeout'); };
    const r = await apiCyberNvd(new URL('http://x/?window=7'));
    assert.equal(r.status, 502);
    assert.match(r.body.error, /NVD/);
  });
});

// ---- KEV -----------------------------------------------------------------------

describe('trimKev / fetchKevCatalog', () => {
  test('trimKev mappar fälten', () => {
    const v = fixture('kev.json').vulnerabilities[0];
    const t = trimKev(v);
    assert.equal(t.id, v.cveID);
    assert.equal(t.vendor, v.vendorProject ?? v.vendor);
    assert.equal(t.added, v.dateAdded);
    assert.equal(t.due, v.dueDate);
    assert.equal(t.ransomware, v.knownRansomwareCampaignUse === 'Known');
    assert.deepEqual(t.cwes, v.cwes);
  });

  test('fetchKevCatalog: entries sorterade nyast först, total ur count', async () => {
    const fix = fixture('kev.json');
    fetchImpl = (url) => {
      assert.match(String(url), /cisa\.gov/);
      return { ok: true, status: 200, json: async () => fix };
    };
    const r = await fetchKevCatalog();
    assert.equal(r.total, fix.count);
    assert.equal(r.dateReleased, fix.dateReleased);
    assert.equal(r.entries.length, fix.vulnerabilities.length);
    assert.equal(r.entries[0].id, 'CVE-2026-19868'); // senast tillagd i fixturen
    for (let i = 1; i < r.entries.length; i += 1) {
      assert.ok(r.entries[i - 1].added >= r.entries[i].added);
    }
  });

  test('fetchKevCatalog kastar vid saknad vulnerabilities', async () => {
    fetchImpl = () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) });
    await assert.rejects(() => fetchKevCatalog(), /vulnerabilities/);
  });
});

// ---- OSV ------------------------------------------------------------------------

describe('parseWatchEnv / sevRank / trimOsv', () => {
  test('parseWatchEnv: giltig lista, Maven delas på första kolon', () => {
    assert.deepEqual(parseWatchEnv('npm:express;PyPI:flask'),
      [{ ecosystem: 'npm', name: 'express' }, { ecosystem: 'PyPI', name: 'flask' }]);
    assert.deepEqual(parseWatchEnv('Maven:org.apache:x'),
      [{ ecosystem: 'Maven', name: 'org.apache:x' }]);
  });
  test('parseWatchEnv: tom/blank → null, ogiltig post kastar', () => {
    assert.equal(parseWatchEnv(''), null);
    assert.equal(parseWatchEnv(undefined), null);
    assert.equal(parseWatchEnv('   '), null);
    assert.equal(parseWatchEnv(';;'), null);
    assert.throws(() => parseWatchEnv('npm:express;badpost'), /ogiltig post/);
    assert.throws(() => parseWatchEnv(':x'), /ogiltig post/);
  });
  test('testmiljöns WATCH kommer från env, DEFAULT_WATCH påverkas inte', () => {
    assert.deepEqual(WATCH, [
      { ecosystem: 'npm', name: 'express' }, { ecosystem: 'PyPI', name: 'flask' },
    ]);
    assert.ok(DEFAULT_WATCH.length >= 20);
  });
  test('sevRank-ordning', () => {
    assert.ok(sevRank('CRITICAL') > sevRank('HIGH'));
    assert.ok(sevRank('HIGH') > sevRank('MODERATE'));
    assert.equal(sevRank('MODERATE'), sevRank('MEDIUM'));
    assert.ok(sevRank('LOW') > sevRank('NONE'));
    assert.equal(sevRank('unknown'), 0);
    assert.equal(sevRank(null), 0);
    assert.equal(sevRank('low'), 1); // skiftalster tolereras
  });
  test('trimOsv: CVE-alias föredras, summary klippas, severity versal', () => {
    const a = trimOsv({
      id: 'GHSA-abc',
      aliases: ['PYSEC-2026-1', 'CVE-2026-12345'],
      summary: 'y'.repeat(250),
      database_specific: { severity: 'moderate', cwe_ids: ['CWE-79', 'CWE-22'] },
      references: [{ url: 'https://osv.dev/vuln/GHSA-abc' }],
      published: '2026-10-01T00:00:00Z',
    });
    assert.equal(a.alias, 'CVE-2026-12345');
    assert.ok(a.summary.length <= 200);
    assert.ok(a.summary.length < 250);
    assert.ok(a.summary.endsWith('…'));
    assert.equal(a.severity, 'MODERATE');
    assert.equal(a.cwe, 'CWE-79, CWE-22');
    assert.equal(a.link, 'https://osv.dev/vuln/GHSA-abc');
  });
  test('trimOsv: saknad severity → null', () => {
    assert.equal(trimOsv({ id: 'D-S-A-1', database_specific: {} }).severity, null);
  });
});

// ---- fetchOsvWatchlist / apiCyberOsv ---------------------------------------------

describe('fetchOsvWatchlist', () => {
  // WATCH = [npm:express, PyPI:flask] (env ovan). OSV_QUERY_DELAY_MS=0 →
  // retry-fördröjningen är 500 ms per tomt paket.
  const osvVuln = (id, published, { severity = null, cwe = null } = {}) => ({
    id,
    database_specific: severity || cwe ? { severity, cwe_ids: cwe ? [cwe] : [] } : {},
    summary: `Sammanfattning för ${id}`,
    published,
    references: [{ url: `https://osv.dev/vuln/${id}` }],
  });
  const isoDaysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const pkgOf = opt => JSON.parse(opt.body).package;

  test('fönsterfiltrering, new90, severity-sortering och top-30-klipp', async () => {
    fetchImpl = (url, opt) => {
      assert.match(String(url), /api\.osv\.dev\/v1\/query$/);
      assert.equal(opt.method, 'POST');
      const pkg = pkgOf(opt);
      if (pkg.ecosystem === 'npm') {
        return { ok: true, status: 200, json: async () => ({ vulns: [
          osvVuln('NPM-1', isoDaysAgo(10), { severity: 'HIGH', cwe: 'CWE-79' }),
          osvVuln('NPM-2', isoDaysAgo(300)), // utanför 180-d-fönstret
          osvVuln('NPM-3', isoDaysAgo(120)), // inom fönstret, utanför new90
        ] }) };
      }
      // 40 rapporter, alla inom fönstret och new90 → top-30-klippet aktiveras.
      const vulns = Array.from({ length: 40 }, (_, k) => osvVuln(`GHSA-${k}`, isoDaysAgo(k + 1)));
      return { ok: true, status: 200, json: async () => ({ vulns }) };
    };
    const r = await fetchOsvWatchlist();
    assert.equal(r.packages.length, 2);
    assert.equal(r.errors.length, 0);
    const npm = r.packages.find(p => p.ecosystem === 'npm');
    assert.equal(npm.status, 'ok');
    assert.equal(npm.total, 2); // NPM-2 utelämnat (300 d)
    assert.equal(npm.new90, 1); // bara NPM-1 (10 d)
    assert.deepEqual(npm.recent.map(a => a.id), ['NPM-1', 'NPM-3']); // HIGH först
    assert.equal(npm.recent[0].severity, 'HIGH');
    assert.equal(npm.recent[0].cwe, 'CWE-79');
    assert.equal(npm.recent[0].link, 'https://osv.dev/vuln/NPM-1');
    const pypi = r.packages.find(p => p.ecosystem === 'PyPI');
    assert.equal(pypi.total, 40);
    assert.equal(pypi.new90, 40);
    assert.equal(pypi.recent.length, 30); // OSV_TOP-klipp
    assert.equal(r.total, 42);
    assert.equal(r.new90, 41);
  });

  test('fel per paket tolereras – paketet markeras error, övriga påverkas ej', async () => {
    fetchImpl = (url, opt) => {
      const pkg = pkgOf(opt);
      if (pkg.ecosystem === 'npm') {
        return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'invalid package' }) };
      }
      return { ok: true, status: 200, json: async () => ({ vulns: [osvVuln('GHSA-X', isoDaysAgo(5))] }) };
    };
    const r = await fetchOsvWatchlist();
    const npm = r.packages.find(p => p.ecosystem === 'npm');
    assert.equal(npm.status, 'error');
    assert.match(npm.error, /HTTP 400 api\.osv\.dev – invalid package/);
    assert.equal(npm.recent.length, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].ecosystem, 'npm');
    assert.equal(r.errors[0].name, 'express');
    const pypi = r.packages.find(p => p.ecosystem === 'PyPI');
    assert.equal(pypi.status, 'ok');
    assert.equal(pypi.total, 1);
    assert.equal(r.total, 1);
  });

  test('tomt svar försöks en gång till innan noll accepteras', async () => {
    const calls = [];
    fetchImpl = (url, opt) => {
      const pkg = pkgOf(opt);
      calls.push(pkg.ecosystem);
      if (pkg.ecosystem === 'npm') {
        // Första anropet tomt (burst-flakighet), retry ger data.
        return calls.filter(e => e === 'npm').length === 1
          ? { ok: true, status: 200, json: async () => ({ vulns: [] }) }
          : { ok: true, status: 200, json: async () => ({ vulns: [osvVuln('NPM-R', isoDaysAgo(3))] }) };
      }
      // flask är faktiskt tomt → ett extra försök och sedan noll.
      return { ok: true, status: 200, json: async () => ({ vulns: [] }) };
    };
    const r = await fetchOsvWatchlist();
    const npm = r.packages.find(p => p.ecosystem === 'npm');
    assert.equal(npm.status, 'ok');
    assert.equal(npm.total, 1);
    assert.equal(npm.recent[0].id, 'NPM-R');
    assert.equal(calls.filter(e => e === 'npm').length, 2); // försök + retry
    assert.equal(calls.filter(e => e === 'PyPI').length, 2); // tomt + onsdans retry
    const pypi = r.packages.find(p => p.ecosystem === 'PyPI');
    assert.equal(pypi.status, 'ok');
    assert.equal(pypi.total, 0);
    assert.equal(r.errors.length, 0);
  });

  test('apiCyberOsv: byEcosystem och ekosystemfilter', async () => {
    fetchImpl = (url, opt) => {
      const pkg = pkgOf(opt);
      return { ok: true, status: 200, json: async () => ({
        vulns: pkg.ecosystem === 'npm'
          ? [osvVuln('NPM-1', isoDaysAgo(1)), osvVuln('NPM-2', isoDaysAgo(2))]
          : [osvVuln('GHSA-1', isoDaysAgo(1))],
      }) };
    };
    const all = await apiCyberOsv(new URL('http://x/'));
    assert.equal(all.status, 200);
    assert.equal(all.body.packageCount, 2);
    assert.equal(all.body.errorCount, 0);
    assert.equal(all.body.total, 3);
    assert.equal(all.body.new90, 3);
    assert.equal(all.body.packages.length, 2);
    assert.equal(all.body.byEcosystem.length, 2);
    assert.equal(all.body.byEcosystem[0].ecosystem, 'npm'); // flest rapporter först
    assert.equal(all.body.byEcosystem[0].packages, 1);
    assert.equal(all.body.byEcosystem[0].advisories, 2);

    const npmOnly = await apiCyberOsv(new URL('http://x/?ecosystem=npm'));
    assert.deepEqual(npmOnly.body.packages.map(p => p.ecosystem), ['npm']);
    // byEcosystem och packageCount täcker alltid hela listan (ej filtrerade).
    assert.equal(npmOnly.body.byEcosystem.length, 2);
    assert.equal(npmOnly.body.packageCount, 2);
  });

  // fetchOsvWatchlist kastar aldrig per pakets fel (deltolerans är designen),
  // så 502 är en defensiv gren – kontraktet vid totalt utfall är 200 med
  // errorCount och per-paket status 'error'.
  test('apiCyberOsv: alla paket misslyckas → 200 med errorCount (deltolerans)', async () => {
    fetchImpl = () => { throw new Error('timeout'); };
    const r = await apiCyberOsv(new URL('http://x/'));
    assert.equal(r.status, 200);
    assert.equal(r.body.errorCount, 2);
    assert.equal(r.body.total, 0);
    assert.ok(r.body.packages.every(p => p.status === 'error'));
    assert.match(r.body.packages[0].error, /timeout/);
  });
});

// ---- nvdScoreForCve (grunden i KEV×NVD-joinen) ------------------------------------

describe('nvdScoreForCve', () => {
  test('slår upp via ?cveId= och cachar i cyber.kevScore', async () => {
    let calls = 0;
    fetchImpl = (url) => {
      calls += 1;
      assert.equal(new URL(url).searchParams.get('cveId'), 'CVE-2026-77777');
      return { ok: true, status: 200, json: async () => ({
        vulnerabilities: [nvdCve('CVE-2026-77777', daysAgo(3), { score: 8.8, severity: 'HIGH' })],
      }) };
    };
    const a = await nvdScoreForCve('CVE-2026-77777');
    assert.equal(a.score, 8.8);
    assert.equal(a.severity, 'HIGH');
    assert.equal(a.vector, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    await nvdScoreForCve('CVE-2026-77777');
    assert.equal(calls, 1); // andra gången ur 24 h-cachet
    assert.equal(cyber.kevScore.get('CVE-2026-77777'), a);
  });

  test('parallella anrop dedupliceras (in-flight)', async () => {
    let calls = 0;
    fetchImpl = () => new Promise(resolve => {
      calls += 1;
      setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({
        vulnerabilities: [nvdCve('CVE-2026-88888', daysAgo(2), { score: 6.5, severity: 'MEDIUM' })],
      }) }), 30);
    });
    const [a, b] = await Promise.all([
      nvdScoreForCve('CVE-2026-88888'), nvdScoreForCve('CVE-2026-88888'),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.score, 6.5);
    assert.equal(b.score, 6.5);
  });
});

// ---- apiCyberPrioritized (KEV × NVD) -------------------------------------------------

describe('apiCyberPrioritized', () => {
  const isoIn = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const kevRow = (id, addedDays, dueDays, extra = {}) => ({
    id,
    vendor: 'V', product: 'P',
    added: new Date(Date.now() - addedDays * 86400000).toISOString().slice(0, 10),
    due: dueDays == null ? null : isoIn(dueDays),
    action: 'Uppgradera', notes: '', short: 'Kort beskrivning',
    ransomware: false, cwes: [], ...extra,
  });
  const nvdRow = (id, days, score, severity) => ({
    id, published: daysAgo(days), modified: daysAgo(days), status: 'Analyzed',
    desc: '', score, severity, vector: '', cwe: '', refs: [],
  });

  test('join: nvd-cache först, sedan cveId-slagning; icke-CVE utan lookup', async () => {
    seedKev([
      kevRow('CVE-2026-111357', 1, 7, { ransomware: true }),
      kevRow('CVE-2026-00421', 2, 1),
      kevRow('VULN-NO-CVE-1', 3, null),
    ]);
    seedNvd([nvdRow('CVE-2026-111357', 5, 9.1, 'CRITICAL')]);
    const lookedUp = [];
    fetchImpl = (url) => {
      const cid = new URL(url).searchParams.get('cveId');
      lookedUp.push(cid);
      return { ok: true, status: 200, json: async () => ({
        vulnerabilities: [nvdCve(cid, daysAgo(1), { score: 7.2, severity: 'HIGH' })],
      }) };
    };
    const r = await apiCyberPrioritized(new URL('http://x/'));
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 3);
    assert.deepEqual(r.body.rows.map(x => x.id), ['CVE-2026-111357', 'CVE-2026-00421', 'VULN-NO-CVE-1']);
    const [a, b, c] = r.body.rows;
    assert.equal(a.from, 'nvd-cache');
    assert.equal(a.score, 9.1);
    assert.equal(a.severity, 'CRITICAL');
    assert.equal(a.ransomware, true);
    assert.equal(a.resolved, true);
    assert.equal(b.from, 'nvd-lookup');
    assert.equal(b.score, 7.2);
    assert.equal(c.from, null);
    assert.equal(c.resolved, false);
    assert.deepEqual(lookedUp, ['CVE-2026-00421']); // bara den som saknas i cachet
    assert.equal(r.body.resolved, 2);
    assert.equal(r.body.unresolved, 1);
    assert.ok(r.body.kevFetchedAt);
    assert.ok(r.body.nvdFetchedAt);
  });

  test('lookup-fel ger unresolved-rad med error (inte 502)', async () => {
    seedKev([kevRow('CVE-2026-00421', 2, 1)]);
    seedNvd([]);
    fetchImpl = () => { throw new Error('rate limited'); };
    const r = await apiCyberPrioritized(new URL('http://x/'));
    assert.equal(r.status, 200);
    assert.equal(r.body.rows.length, 1);
    assert.equal(r.body.rows[0].resolved, false);
    assert.equal(r.body.rows[0].from, null);
    assert.match(r.body.rows[0].error, /rate limited/);
    assert.equal(r.body.unresolved, 1);
  });

  test('502 när KEV saknas trots NVD-cachet', async () => {
    fetchImpl = () => { throw new Error('KEV ner'); };
    seedNvd([nvdRow('CVE-2026-1', 1, 5, 'MEDIUM')]);
    const r = await apiCyberPrioritized(new URL('http://x/'));
    assert.equal(r.status, 502);
    assert.match(r.body.error, /KEV: KEV ner/);
  });

  test('502 KEV/NVD när båda källorna misslyckas', async () => {
    fetchImpl = () => { throw new Error('ner'); };
    const r = await apiCyberPrioritized(new URL('http://x/'));
    assert.equal(r.status, 502);
    assert.match(r.body.error, /KEV\/NVD/);
  });
});

// ---- apiCyberOverview -----------------------------------------------------------------

describe('apiCyberOverview', () => {
  test('null-sektioner utan att utlösa hämtningar', async () => {
    fetchImpl = () => { throw new Error('ska inte hämta'); };
    const r = await apiCyberOverview(new URL('http://x/'));
    assert.equal(r.status, 200);
    assert.ok(r.body.generatedAt);
    assert.equal(r.body.nvd, null);
    assert.equal(r.body.kev, null);
    assert.equal(r.body.osv, null);
  });

  test('resumér beräknas ur cachet', async () => {
    seedNvd([
      { id: 'A', published: daysAgo(1), modified: '', status: '', desc: '', score: 9.8, severity: 'CRITICAL', vector: '', cwe: '', refs: [] },
      { id: 'B', published: daysAgo(2), modified: '', status: '', desc: '', score: 7.5, severity: 'HIGH', vector: '', cwe: '', refs: [] },
      { id: 'C', published: daysAgo(20), modified: '', status: '', desc: '', score: 5, severity: 'MEDIUM', vector: '', cwe: '', refs: [] },
    ]);
    seedKev([
      { id: 'K1', vendor: 'V', product: 'P', added: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10), due: null, action: '', notes: '', short: '', ransomware: true, cwes: [] },
      { id: 'K2', vendor: 'V', product: 'P', added: new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10), due: null, action: '', notes: '', short: '', ransomware: false, cwes: [] },
    ]);
    cyber.osv = {
      fetchedAt: new Date().toISOString(),
      windowDays: 180,
      packages: [
        { ecosystem: 'npm', name: 'express', status: 'ok', total: 2, new90: 1, recent: [] },
        { ecosystem: 'PyPI', name: 'flask', status: 'error', total: 0, new90: 0, recent: [], error: 'HTTP 429' },
      ],
      errors: [{ ecosystem: 'PyPI', name: 'flask', error: 'HTTP 429' }],
      total: 2, new90: 1,
    };
    const r = await apiCyberOverview(new URL('http://x/'));
    assert.equal(r.body.nvd.published7d, 2);
    assert.equal(r.body.nvd.critical7d, 1);
    assert.equal(r.body.nvd.high7d, 1);
    assert.equal(r.body.kev.total, 2);
    assert.equal(r.body.kev.added90, 1);
    assert.equal(r.body.kev.ransomware, 1);
    assert.equal(r.body.osv.packages, 2);
    assert.equal(r.body.osv.errorCount, 1);
    assert.equal(r.body.osv.total, 2);
    assert.equal(r.body.osv.new90, 1);
  });
});

// ---- Kollektorerna ----------------------------------------------------------------------

describe('kollektorer', () => {
  const metr = (recs, indicator) => recs.find(r => r.t === 'm' && r.indicator === indicator).value;

  test('nvd: 6 metrikvärden med dbTotal + kritisk-event (severity high vid > 10 kritiska)', async () => {
    const crit = Array.from({ length: 11 }, (_, k) => ({
      id: `CVE-C${k}`, published: daysAgo(1), modified: '', status: '', desc: 'kritisk',
      score: 9.5, severity: 'CRITICAL', vector: '', cwe: '', refs: [],
    }));
    seedNvd([...crit, { id: 'CVE-H', published: daysAgo(2), modified: '', status: '', desc: '', score: 7.5, severity: 'HIGH', vector: '', cwe: '', refs: [] }]);
    const recs = await nvdCollector.fetch();
    assert.equal(recs.filter(r => r.t === 'm').length, 6);
    assert.equal(metr(recs, 'NVD – totalt antal CVE i databasen'), 420000); // seedNvd:s dbTotal
    assert.equal(metr(recs, 'NVD – CVE i hämtat 30-dagarsfönster'), 12);
    assert.equal(metr(recs, 'NVD – nya CVE senaste 7 dagarna'), 12);
    assert.equal(metr(recs, 'NVD – kritiska (CVSS ≥ 9) senaste 7 dagarna'), 11);
    assert.equal(metr(recs, 'NVD – hög allvarlighet (CVSS 7–8.9) senaste 7 dagarna'), 1);
    assert.equal(metr(recs, 'NVD – medelvärde CVSS senaste 30 dagarna'), Math.round((11 * 9.5 + 7.5) / 12 * 10) / 10);
    const e = recs.filter(r => r.t === 'e');
    assert.equal(e.length, 1);
    assert.equal(e[0].severity, 'high'); // 11 > 10
    assert.match(e[0].title, /11 kritiska CVE/);
    assert.ok(e[0].detail.includes('CVE-C0'));
    for (const r of recs) {
      assert.equal(r.area, 5);
      assert.equal(r.source, 'nvd');
      assert.equal(r.country, 'NORDIC');
    }
  });

  test('nvd: inget event utan kritiska, medelvärde "–" utan poäng', async () => {
    seedNvd([
      { id: 'CVE-U1', published: daysAgo(2), modified: '', status: '', desc: '', score: null, severity: null, vector: '', cwe: '', refs: [] },
      { id: 'CVE-U2', published: daysAgo(25), modified: '', status: '', desc: '', score: null, severity: null, vector: '', cwe: '', refs: [] },
    ]);
    const recs = await nvdCollector.fetch();
    assert.equal(recs.filter(r => r.t === 'e').length, 0);
    assert.equal(metr(recs, 'NVD – medelvärde CVSS senaste 30 dagarna'), '–');
    assert.equal(metr(recs, 'NVD – nya CVE senaste 7 dagarna'), 1);
  });

  test('nvd: utan dbTotal returneras endast de 5 fönstermetriken', async () => {
    cyber.nvd = { fetchedAt: new Date().toISOString(), dbTotal: null, capped: false, rows: [], error: null };
    const recs = await nvdCollector.fetch();
    assert.equal(recs.filter(r => r.t === 'm').length, 5);
    assert.equal(metr(recs, 'NVD – CVE i hämtat 30-dagarsfönster'), 0);
    assert.equal(recs.find(r => r.indicator === 'NVD – totalt antal CVE i databasen'), undefined);
  });

  test('kev: 5 metrikvärden + senaste-tillägg-event (high vid inkommande frist)', async () => {
    const iso = t => new Date(t).toISOString().slice(0, 10);
    seedKev([
      { id: 'CVE-2026-111357', vendor: 'Ivanti', product: 'Connect Secure', added: iso(Date.now() - 1 * 86400000), due: iso(Date.now() + 7 * 86400000), action: 'Uppgradera', notes: 'Notering', short: 'Auth bypass', ransomware: true, cwes: ['CWE-287'] },
      { id: 'CVE-2026-00102', vendor: 'OpenCore', product: 'Gateway', added: iso(Date.now() - 30 * 86400000), due: iso(Date.now() + 30 * 86400000), action: '', notes: '', short: 'SQL injection', ransomware: false, cwes: [] },
      { id: 'CVE-2026-00421', vendor: 'ExampleSoft', product: 'Widget', added: iso(Date.now() - 100 * 86400000), due: iso(Date.now() - 5 * 86400000), action: '', notes: '', short: 'RCE', ransomware: true, cwes: [] },
    ]);
    const recs = await kevCollector.fetch();
    assert.equal(recs.filter(r => r.t === 'm').length, 5);
    assert.equal(metr(recs, 'KEV – antal kända exploaterade sårbarheter'), 3);
    assert.equal(metr(recs, 'KEV – tillagda senaste 90 dagarna'), 2);
    assert.equal(metr(recs, 'KEV – kända ransomware-kampanjer'), 2);
    assert.equal(metr(recs, 'KEV – åtgärdsfrist inom 14 dagar'), 1);
    assert.equal(metr(recs, 'KEV – senast tillagd'), 'CVE-2026-111357 (Ivanti)');
    const e = recs.filter(r => r.t === 'e');
    assert.equal(e.length, 1);
    assert.equal(e[0].severity, 'high');
    assert.match(e[0].title, /CVE-2026-111357 \(Ivanti Connect Secure\)/);
    assert.ok(e[0].detail.includes('Känd användning i ransomware-kampanj'));
    assert.ok(e[0].detail.includes('Åtgärdsfrist:'));
  });

  test('osv: 4 metrikvärden + nyaste-rapport- och fel-event', async () => {
    const iso = t => new Date(t).toISOString().slice(0, 10);
    const adv = (id, published, severity) => ({ id, alias: null, summary: '', severity, cwe: '', published, link: null });
    cyber.osv = {
      fetchedAt: new Date().toISOString(),
      windowDays: 180,
      packages: [
        { ecosystem: 'npm', name: 'express', status: 'ok', total: 2, new90: 1, recent: [adv('NPM-1', iso(Date.now() - 3 * 86400000), 'HIGH'), adv('NPM-2', iso(Date.now() - 30 * 86400000), null)] },
        { ecosystem: 'PyPI', name: 'flask', status: 'ok', total: 1, new90: 1, recent: [adv('GHSA-1', iso(Date.now() - 5 * 86400000), 'CRITICAL')] },
        { ecosystem: 'Go', name: 'golang.org/x/net', status: 'error', total: 0, new90: 0, recent: [], error: 'HTTP 429' },
      ],
      errors: [{ ecosystem: 'Go', name: 'golang.org/x/net', error: 'HTTP 429' }],
      total: 3, new90: 2,
    };
    const recs = await osvCollector.fetch();
    assert.equal(recs.filter(r => r.t === 'm').length, 4);
    assert.equal(metr(recs, 'OSV – övervakade paket'), 3);
    assert.equal(metr(recs, 'OSV – rapporter senaste 180 d (övervakat utbud)'), 3);
    assert.equal(metr(recs, 'OSV – rapporter senaste 90 d'), 2);
    assert.equal(metr(recs, 'OSV – mest påverkat paket'), 'express (npm)');
    const e = recs.filter(r => r.t === 'e');
    assert.equal(e.length, 2);
    assert.equal(e[0].kind, 'sårbarhet');
    assert.match(e[0].title, /Nyaste OSV-rapport: NPM-1 \(express\)/);
    assert.equal(e[1].kind, 'källa');
    assert.equal(e[1].severity, 'warn');
    assert.match(e[1].title, /1 OSV-paket kunde inte hämtas/);
  });
});

describe('nvdJson queue & retry', () => {
  test('lyckat anrop returnerar parsad json', async () => {
    fetchImpl = () => ({
      ok: true,
      status: 200,
      json: async () => ({ totalResults: 42 }),
    });
    const res = await nvdJson('https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1');
    assert.equal(res.totalResults, 42);
  });

  test('återförsöker vid HTTP 429 och lyckas på andra försöket', async () => {
    let callCount = 0;
    fetchImpl = () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 429, text: async () => 'Rate limit exceeded' };
      }
      return { ok: true, status: 200, json: async () => ({ totalResults: 99 }) };
    };
    const res = await nvdJson('https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1');
    assert.equal(callCount, 2);
    assert.equal(res.totalResults, 99);
  });

  test('kastar omedelbart utan onödiga återförsök vid icke-återförsökningsbara fel som HTTP 404', async () => {
    let callCount = 0;
    fetchImpl = () => {
      callCount++;
      return { ok: false, status: 404, text: async () => 'Not Found' };
    };
    await assert.rejects(
      async () => nvdJson('https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-NOTFOUND'),
      /HTTP 404/,
    );
    assert.equal(callCount, 1, 'ska inte återförsöka 404');
  });
});
