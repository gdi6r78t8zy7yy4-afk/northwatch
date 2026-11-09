// Enhetstester för GNSS-/rymddatslagret (M12, område 10): sex kollektorer
// (NOAA SWPC, CelesTrak GP, GSC Europa, M3G GNSS Stations API, NASA APOD,
// data.norge.no) + den beräknande analysen lib/gnss.js (GNSS-index) och
// lib/gnss-correlation.js (anomalier/kedjor/LLM-berikelse). Inget nätverk –
// globalThis.fetch mockas per URL mot fixtures i testdata/gnss/ (form verifierad
// mot live-API:na 2026-11-09 med synthetiska värden; M3G-antal matchar live-probet
// SWE 70 / NOR 25 / DNK 22 / FIN 24 / ISL 53). Klockberoende fält skrivs i fixtures
// som tokens – @@ISO:-0.5d@@ = exakt tidpunkt, @@-10@@ = UTC-datum n dagar bakåt –
// och expanderas av mocken mot testklockan. Indexpoäng i gnssStatus är
// regressionsankrar; beräkningarna anges i kommentarerna under respektive test.
//
// Kör: node --test server/test/gnss.test.js
//
// Miljön sätts INNAN import: alla rate-limitpausar nollas (CELESTRAK_DELAY_MS,
// M3G_DELAY_MS, DATANORGE_DELAY_MS) och LLM är avstängd (LLM_BASE_URL borttaget –
// lib/llm.js gör då inga nätverksanrop alls).
process.env.CELESTRAK_DELAY_MS = '0';
process.env.M3G_DELAY_MS = '0';
process.env.DATANORGE_DELAY_MS = '0';
delete process.env.LLM_BASE_URL;

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'gnss');

// ---- Tokenexpansion (se huvudkommentaren) --------------------------------------
const expand = s => String(s)
  .replace(/@@ISO:(-?\d+(?:\.\d+)?)d@@/g, (_, d) => new Date(Date.now() + Number(d) * 86400e3).toISOString())
  .replace(/@@ISO:(-?\d+)h@@/g, (_, h) => new Date(Date.now() + Number(h) * 3600e3).toISOString())
  .replace(/@@(-?\d+)@@/g, (_, d) => new Date(Date.now() + Number(d) * 86400e3).toISOString().slice(0, 10));

const rd = f => expand(fs.readFileSync(path.join(TESTDATA, f), 'utf8'));
const rj = f => JSON.parse(rd(f));

// ---- Mockad fetch per URL → fixture --------------------------------------------
let celestrakFailOnce = false; // gps-ops: första anropet 503, andra OK (retry-test)
let celestrakDown = false;     // alla gp.php-anrop 503 (totalsykt-test)
let m3gDown = null;            // 'DNK' | '*' – M3G-anrop för landet falska
let apodEmpty = false;         // APOD svarar [] (tomlistan kastar i kollektorn)
let fdkFailQuery = null;       // 'posisjonering' | '*' – FDK-sökning falsk
const calls = [];              // {url, method} för anropsräknings-anspråk
const fdkQueries = [];         // queries som POST:ades till FDK

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opt?.method ?? 'GET' });
  const ok = obj => ({
    ok: true, status: 200,
    json: async () => (typeof obj === 'string' ? JSON.parse(obj) : obj),
    text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
  });
  const err = code => ({ ok: false, status: code, json: async () => ({}), text: async () => '' });

  // NOAA SWPC.
  if (u.includes('planetary_k_index_1m.json')) return ok(rj('noaa-kp.json'));
  if (u.includes('f107_cm_flux.json')) return ok(rj('noaa-f107.json'));

  // CelesTrak GP.
  let m = u.match(/celestrak\.org\/NORAD\/elements\/gp\.php\?GROUP=([\w-]+)&FORMAT=json/);
  if (m) {
    const g = m[1];
    if (celestrakDown) return err(503);
    if (g === 'gps-ops' && celestrakFailOnce) { celestrakFailOnce = false; return err(503); }
    return ok(rj(`celestrak-${g}.json`));
  }

  // GSC: RSS + konstellationssida (båda läses som text).
  if (u === 'https://www.gsc-europa.eu/rss.xml') return ok(rd('gsc-rss.xml'));
  if (u.includes('constellation-information')) return ok(rd('gsc-constellation.html'));

  // M3G: emulera API:t – bbox-filtrering + hård CAP=20-slice i filordning.
  m = u.match(/gnss-metadata\.eu\/v1\/sitelog\/.*country=(\w{3})/);
  if (m) {
    const cc = m[1];
    if (m3gDown === cc || m3gDown === '*') return err(500);
    const q = new URL(u).searchParams;
    const [minlat, maxlat, minlon, maxlon] = ['minlat', 'maxlat', 'minlon', 'maxlon'].map(k => Number(q.get(k)));
    const fc = rj(`m3g-${cc}.json`);
    const feats = fc.features.filter(f => {
      const [lon, lat] = f.geometry.coordinates;
      return lat >= minlat && lat <= maxlat && lon >= minlon && lon <= maxlon;
    });
    return ok({ ...fc, features: feats.slice(0, 20) }); // CAP – se gnss-metadata.js
  }

  // NASA APOD (wp-json).
  if (u.startsWith('https://science.nasa.gov/wp-json/')) return ok(apodEmpty ? [] : rj('apod.json'));

  // FDK-sök (data.norge.no): POST /search/datasets med query i bodyn.
  if (u === 'https://search.api.fellesdatakatalog.digdir.no/search/datasets') {
    const q = JSON.parse(opt.body ?? '{}').query;
    fdkQueries.push(q);
    if (fdkFailQuery === q || fdkFailQuery === '*') return err(500);
    return ok(rj('fdk.json')[q]);
  }

  throw new Error(`Mock: ingen fixture för ${u}`);
};

import noaa from '../collectors/noaa.js';
import celestrak, { gpUrl, newestEpoch } from '../collectors/celestrak.js';
import gscEuropa, { parseNagu, parseConstellation, unescapeHtml, eventTime } from '../collectors/gsc-europa.js';
import gnssMetadata, { GRIDS, CAP, tileUrl, parseStation } from '../collectors/gnss-metadata.js';
import nasaApod from '../collectors/nasa-apod.js';
import datanorge from '../collectors/datanorge.js';
import { gnssStatus, gnssData, kpScore, naguCount, labelOf, WEIGHTS, NORDIC, STATION_TARGETS } from '../lib/gnss.js';
import { gnssAnomalies, gnssChains, gnssNarrative, gnssCorrelation, isActiveNagu, WINDOW_H } from '../lib/gnss-correlation.js';

const COLS = { noaa, celestrak, 'gsc-europa': gscEuropa, 'gnss-metadata': gnssMetadata, 'nasa-apod': nasaApod, datanorge };
let colRecs = {}; // id → records från en ren live-simulering i before()
let allRecs = [];

before(async () => {
  for (const [id, c] of Object.entries(COLS)) colRecs[id] = await c.fetch();
  allRecs = Object.values(colRecs).flat();
});
after(() => { globalThis.fetch = realFetch; });

// Hjälp: senaste metric-post som matchar regex (eventuellt inom land).
const metric = (recs, re) => recs.find(r => r.t === 'm' && re.test(String(r.indicator ?? '')));
// Bokstavs-regex för etiketter med parenteser (t.ex. "SBAS (EGNOS m.fl.)").
const lit = s => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// ---- NOAA SWPC -------------------------------------------------------------------
describe('noaa', () => {
  test('senaste Kp + F10.7 plockas ur listorna; Kp≥5 ger stormhändelse', () => {
    const r = colRecs.noaa;
    assert.equal(metric(r, /^Kp-index /).value, 5); // lista i fallande tid → senaste först ej garanterad
    assert.equal(metric(r, /^Estimerat Kp/).value, 6);
    assert.equal(metric(r, /^Solradioflux F10\.7$/).value, 158.9);
    const ev = r.find(x => x.t === 'e');
    assert.ok(ev && ev.kind === 'geomagnetiskt' && ev.severity === 'warn' && ev.title.includes('Kp 5'));
    assert.ok(Date.parse(ev.start) > Date.now() - 2 * 3600e3); // @@ISO:-1h@@
  });
});

// ---- CelesTrak GP -----------------------------------------------------------------
describe('celestrak', () => {
  test('antal per konstellation + total, epokåldrar; SBAS (96 h) ger stale-varning', () => {
    const r = colRecs.celestrak;
    for (const label of ['Galileo', 'GLONASS', 'SBAS (EGNOS m.fl.)', 'GPS']) {
      assert.equal(metric(r, lit(`Satelliter i elementset (${label})`)).value, 5);
    }
    assert.equal(metric(r, /\(totalt\)$/).value, 20);
    for (const label of ['Galileo', 'GLONASS', 'GPS']) {
      assert.equal(metric(r, lit(`Epokålder (${label})`)).value, 12.0); // @@ISO:-0.5d@@
    }
    assert.equal(metric(r, /^Epokålder \(SBAS/).value, 96.0); // @@ISO:-4d@@ > 72 h
    const ev = r.find(x => x.t === 'e');
    assert.ok(ev && ev.severity === 'warn' && ev.title.includes('SBAS'));
  });

  test('retry: gps-ops svarar 503 första gången, andra gången OK', async () => {
    celestrakFailOnce = true;
    const n0 = calls.length;
    const r = await celestrak.fetch();
    assert.equal(metric(r, /\(GPS\)$/).value, 5);
    const gpsCalls = calls.slice(n0).filter(c => c.url.includes('GROUP=gps-ops')).length;
    assert.equal(gpsCalls, 2); // initialt + retry
    celestrakDown = true;
    await assert.rejects(celestrak.fetch(), /svarade inte för någon konstellation/);
    celestrakDown = false;
  });

  test('gpUrl och newestEpoch', () => {
    assert.equal(gpUrl('sbas'), 'https://celestrak.org/NORAD/elements/gp.php?GROUP=sbas&FORMAT=json');
    assert.equal(newestEpoch([{ EPOCH: '2026-01-01T00:00:00Z' }, { EPOCH: '2026-05-05T00:00:00Z' }]), '2026-05-05T00:00:00Z');
    assert.equal(newestEpoch([]), '');
  });
});

// ---- GSC Europa -------------------------------------------------------------------
describe('gsc-europa', () => {
  const items = [...rd('gsc-rss.xml').matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);

  test('parseNagu: fälten landar på var sin rad trots blandade <p>/<br>-block', () => {
    const n = parseNagu(items.find(i => i.includes('2099001')));
    assert.equal(n.number, '2099001');
    assert.equal(n.type, 'UNP_SHTRCVR');
    assert.ok(n.subject.startsWith('SHORT TERM OUTAGE ON'));
    assert.match(n.start, /T13:41:00Z$/); // '@@-2@@ 13:41' → YYYY-MM-DDT13:41:00Z
    assert.match(n.end, /T15:44:00Z$/);   // slutet rinner inte ut i SATELLITE AFFECTED
    assert.equal(n.satellite, 'GSAT0208');
    assert.equal(n.severity, 'info');     // RECOVERED
  });

  test('parseNagu: "USABLE AS FROM" med END N/A → info, inget slutdatum', () => {
    const n = parseNagu(items.find(i => i.includes('2099004')));
    assert.equal(n.end, null);
    assert.equal(n.severity, 'info');
  });

  test('parseNagu: icke-NAGU-item returnerar null', () => {
    assert.equal(parseNagu(items.find(i => i.includes('Performance Reports'))), null);
  });

  test('eventTime/unescapeHtml', () => {
    assert.equal(eventTime('2026-11-02 13:41'), '2026-11-02T13:41:00Z');
    assert.equal(eventTime('N/A'), null);
    assert.equal(unescapeHtml('a&#x2013;b&nbsp;c&amp;d'), 'a–b c&d');
  });

  test('parseConstellation: 32 GSAT-rader, PRN-rad och rubrikrader filtreras', () => {
    const sv = parseConstellation(rd('gsc-constellation.html'));
    assert.equal(sv.length, 32);
    assert.ok(!sv.some(s => s.name === 'PRN 12'));
    assert.equal(sv.filter(s => s.usable).length, 28);
    assert.equal(sv.filter(s => s.clock === 'PHM').length, 20);
    assert.equal(sv.filter(s => s.nagu).length, 5);
    const g7 = sv.find(s => s.name === 'GSAT0107');
    assert.equal(g7.usable, false);
    assert.equal(g7.svId, 'E08');
    assert.equal(g7.nagu, '2099006');
  });

  test('kollektorn: konstellationsmetrics + NAGU-händelser med rena detail-strängar', () => {
    const r = colRecs['gsc-europa'];
    assert.equal(metric(r, /^Galileo-satelliter i konstellationen$/).value, 32);
    assert.equal(metric(r, /^Galileo-satelliter tillgängliga/).value, 28);
    assert.equal(metric(r, /^Andel tillgängliga Galileo-satelliter$/).value, 87.5);
    assert.equal(metric(r, /fast atomur \(PHM\)/).value, 20);
    assert.equal(metric(r, /^Aktiva NAGU \(konstellationssidan\)$/).value, 5);
    assert.equal(metric(r, /^Rapporterade NAGU i feeden$/).value, 5);
    assert.equal(metric(r, /^Pågående\/öppna NAGU \(feed\)$/).value, 1); // bara 2099004 (END N/A)
    const evs = r.filter(x => x.t === 'e');
    assert.equal(evs.length, 5);
    assert.deepEqual(evs.map(e => e.severity), ['info', 'warn', 'warn', 'info', 'warn']);
    const d1 = evs.find(e => e.ref === '2099001').detail;
    assert.match(d1, /^Typ: UNP_SHTRCVR · Satellit: GSAT0208 · Start: \d{4}-\d{2}-\d{2}T13:41:00Z · Slut: /);
    assert.ok(!/[<>]/.test(d1) && !/ {2}/.test(d1)); // inga HTML-rester, inga dubbelblanketter
  });
});

// ---- M3G GNSS Stations API --------------------------------------------------------
describe('gnss-metadata', () => {
  test('per land: antal, aktiva andel och flerkonstellationsandel (live-ankrar)', () => {
    // Posterna bär nordwatch tvåbokstaviga koder (SE…) – API-anropen använder SWE….
    const r = colRecs['gnss-metadata'];
    const byCc = cc => r.filter(x => x.country === cc);
    const expect = { SE: [70, 97.1, 98.6], NO: [25, 76, 76], DK: [22, 86.4, 90.9], FI: [24, 95.8, 83.3], IS: [53, 98.1, 86.8] };
    for (const [cc, [n, act, multi]] of Object.entries(expect)) {
      assert.equal(metric(byCc(cc), /^GNSS-stationer \(M3G\)/).value, n, cc);
      assert.equal(metric(byCc(cc), /^Aktiva GNSS-stationer/).value, act, cc);
      assert.equal(metric(byCc(cc), /^Flerkonstellationsstationer/).value, multi, cc);
    }
  });

  test('ISL mättar CAP=20 → "(minst)"-flagg; övriga länder ej', () => {
    const isl = colRecs['gnss-metadata'].find(r => r.country === 'IS' && /^GNSS-stationer/.test(r.indicator));
    assert.ok(isl.indicator.endsWith('(minst)'));
    for (const cc of ['SE', 'NO', 'DK', 'FI']) {
      const rec = colRecs['gnss-metadata'].find(r => r.country === cc && /^GNSS-stationer/.test(r.indicator));
      assert.ok(!rec.indicator.includes('minst'), cc);
    }
  });

  test('stationer blir assets med [lon,lat] och attribut; totalt 194 (live-match)', () => {
    const a = colRecs['gnss-metadata'].filter(r => r.t === 'a');
    assert.equal(a.length, 70 + 25 + 22 + 24 + 53);
    for (const x of a) {
      assert.equal(x.type, 'gnss-station');
      assert.equal(x.geometry.type, 'Point');
      const [lon, lat] = x.geometry.coordinates;
      assert.ok(lat > 54 && lat < 72 && lon > -25 && lon < 32, `${x.name} ${lat},${lon}`); // ALB00DNK ligger på 54.85
      assert.deepEqual(Object.keys(x.attrs).sort(), ['konstellationer', 'nätverk', 'stad', 'status']);
    }
    // Dedup: unika ID:n per land = stationsantal (rutorna överlappar ej men
    // ISL-föräldern returnerar samma 20 stationer om i NE-kvadranten).
    for (const cc of ['SE', 'NO', 'DK', 'FI', 'IS']) {
      const names = new Set(a.filter(x => x.country === cc).map(x => x.name));
      assert.equal(names.size, a.filter(x => x.country === cc).length);
    }
  });

  test('rutnätsanrop: SWE 8 + NOR 12 + DNK 12 + FIN 4 + ISL 5 (delade rutor) = 41', async () => {
    const n0 = calls.length;
    await gnssMetadata.fetch();
    const sitelog = calls.slice(n0).filter(c => c.url.includes('sitelog'));
    // DNK har en ruta med exakt 20 stationer i fixturen → delas i fyra (8+4).
    assert.equal(sitelog.length, 8 + 12 + 12 + 4 + 5);
    for (const [cc, n] of Object.entries({ SWE: 8, NOR: 12, DNK: 12, FIN: 4 })) {
      assert.equal(sitelog.filter(c => c.url.includes(`country=${cc}`)).length, n, cc);
    }
    // ISL: föräldrarutan + exakt fyra kvadranter (mättad → en delning).
    const isl = sitelog.filter(c => c.url.includes('country=ISL'));
    assert.equal(isl.length, 5);
    const [a, b, p, q] = GRIDS.ISL[0]; // förväntad NE-kvadrant ur rutnätet (flyttal!)
    const ne = tileUrl('ISL', [(a + b) / 2, b, (p + q) / 2, q]);
    assert.ok(isl.some(c => c.url === ne), 'NE-kvadranten anropades');
    assert.equal(GRIDS.ISL.length, 1);
    assert.equal(CAP, 20);
  });

  test('sjukt land → null-metric för det landet, övriga OK; alla sjuka kastar', async () => {
    m3gDown = 'DNK';
    const r = await gnssMetadata.fetch();
    assert.equal(metric(r.filter(x => x.country === 'DK'), /^GNSS-stationer/).value, null);
    assert.equal(metric(r.filter(x => x.country === 'SE'), /^GNSS-stationer/).value, 70);
    m3gDown = '*';
    await assert.rejects(gnssMetadata.fetch(), /svarade inte för något land/);
    m3gDown = null;
  });

  test('parseStation: "Lat/Lon/Height"-sträng och saknat ID', () => {
    const s = parseStation({ properties: { 'GNSS Station ID': 'X1', 'Lat/Lon/Height': '65.67398/21.00693/75.9', City: 'Umeå' } });
    assert.deepEqual([s.lat, s.lon], [65.67398, 21.00693]);
    assert.equal(s.city, 'Umeå');
    assert.equal(parseStation({ properties: {} }), null);
  });
});

// ---- NASA APOD ---------------------------------------------------------------------
describe('nasa-apod', () => {
  test('publiceringstakt: 10 färska ≤10 d, senaste 0,5 d gammalt', () => {
    const r = colRecs['nasa-apod'];
    assert.equal(metric(r, /APOD-publiceringar/).value, 10);
    assert.equal(metric(r, /^Ålder på senaste APOD$/).value, 0.5); // @@ISO:-0.5d@@ exakt
  });

  test('tom lista kastar', async () => {
    apodEmpty = true;
    await assert.rejects(nasaApod.fetch(), /ingen lista/);
    apodEmpty = false;
  });
});

// ---- data.norge.no -----------------------------------------------------------------
describe('datanorge', () => {
  test('FDK-sök ger total + publika per query (POST med query i bodyn)', () => {
    const r = colRecs.datanorge;
    assert.deepEqual(fdkQueries, ['gnss', 'posisjonering']);
    assert.ok(r.every(x => x.country === 'NO'));
    assert.equal(metric(r, /^GNSS-dataset \(gnss\)$/).value, 3);
    assert.equal(metric(r, /^Publika GNSS-dataset \(gnss\)$/).value, 3);
    assert.equal(metric(r, /^GNSS-dataset \(posisjonering\)$/).value, 1);
    assert.equal(metric(r, /^Publika GNSS-dataset \(posisjonering\)$/).value, 1);
  });

  test('en query felar → null-metric utan publik-rad; alla fel kastar', async () => {
    fdkFailQuery = 'posisjonering';
    const r = await datanorge.fetch();
    assert.equal(metric(r, /^GNSS-dataset \(gnss\)$/).value, 3);
    assert.equal(metric(r, /^GNSS-dataset \(posisjonering\)$/).value, null);
    assert.ok(!r.some(x => /Publika.*posisjonering/.test(x.indicator)));
    fdkFailQuery = '*';
    await assert.rejects(datanorge.fetch(), /svarade inte/);
    fdkFailQuery = null;
  });
});

// ---- GNSS-index (lib/gnss.js) ------------------------------------------------------
describe('gnssStatus', () => {
  test('konstanter: vikter, länder och stationstäthetsreferenser', () => {
    assert.deepEqual(WEIGHTS, { tillgänglighet: 0.35, stabilitet: 0.25, varningstäthet: 0.2, täckning: 0.2 });
    assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.deepEqual(NORDIC, ['SE', 'NO', 'DK', 'FI', 'IS']);
    assert.deepEqual(STATION_TARGETS, { SE: 70, NO: 45, DK: 25, FI: 45, IS: 25 });
    assert.equal(kpScore(3), 1); assert.equal(kpScore(4), 1); assert.equal(kpScore(5), 0.7);
    assert.equal(kpScore(6), 0.4); assert.equal(kpScore(7), 0.2); assert.equal(kpScore(9), 0);
  });

  test('naguCount: 3 NAGU ≤30 d, 1 ≤5 d', () => {
    assert.equal(naguCount(allRecs), 3);   // starts -2, -10, -10 (d -60/-70 utanför)
    assert.equal(naguCount(allRecs, 5), 1);
  });

  test('per-land-scores (regressionsankar; beräkning i kommentaren)', () => {
    // tillgänglighet = Galileo-andel 87,5 % × landets aktiva andel:
    //   SE .875·.971=85.0 · NO .875·.76=66.5 · DK .875·.864=75.6 · FI .875·.958=83.8 · IS .875·.981=85.8
    // stabilitet = Kp 5 → 70 (globalt); varningstäthet: 3 NAGU ≤30 d →
    //   1−ln4/ln9=0.369 → 36.9; täckning = stationer/mål: SE 70/70=100, NO 25/45=55.6,
    //   DK 22/25=88, FI 24/45=53.3, IS 53/25→clamp 100.
    const expect = { SE: [74.6, 'Stabil drift'], NO: [59.3, 'Stabil drift'], DK: [68.9, 'Stabil drift'], FI: [64.9, 'Stabil drift'], IS: [74.9, 'Stabil drift'] };
    for (const [cc, [score, label]] of Object.entries(expect)) {
      const s = gnssStatus(cc, allRecs);
      assert.equal(s.country, cc);
      assert.equal(s.score, score, `${cc} score`);
      assert.equal(s.label, label, cc);
    }
    const se = gnssStatus('SE', allRecs);
    assert.deepEqual(
      Object.fromEntries(Object.entries(se.components).map(([k, v]) => [k, v.score])),
      { tillgänglighet: 85.0, stabilitet: 70, varningstäthet: 36.9, täckning: 100 },
    );
    assert.ok(se.drivers[0].includes('Galileo 87.5 % USABLE · SE 97.1 % aktiva stationer'));
    assert.ok(se.drivers[1].includes('Kp 5 → 70'));
    assert.ok(se.drivers[2].includes('3 NAGU ≤30 d → 36.9'));
    assert.ok(se.drivers[3].includes('70 stationer mot 70 → 100'));
  });

  test('NORDIC = snitt av de fem länderna med per-land-rader', () => {
    const s = gnssStatus('NORDIC', allRecs); // (74.6+59.3+68.9+64.9+74.9)/5 = 68.52 → 68.5
    assert.equal(s.score, 68.5);
    assert.equal(s.label, 'Stabil drift');
    assert.deepEqual(
      Object.fromEntries(Object.entries(s.components).map(([k, v]) => [k, v.score])),
      { tillgänglighet: 79.3, stabilitet: 70, varningstäthet: 36.9, täckning: 79.4 },
    );
    assert.equal(s.countries.length, 5);
    assert.deepEqual(s.sources, ['celestrak', 'datanorge', 'gnss-metadata', 'gsc-europa', 'nasa-apod', 'noaa']);
    assert.ok(s.drivers.some(d => d.startsWith('SE: 74.6 (Stabil drift)')));
    // Okänt land → nordisk sammanfattning.
    assert.equal(gnssStatus('XX', allRecs).country, 'NORDIC');
  });

  test('renormering: saknad källa → vikterna fördelas över de övriga', () => {
    const n = new Date().toISOString();
    const syn = [
      { t: 'm', area: 10, country: 'SE', source: 'gsc-europa', indicator: 'Andel tillgängliga Galileo-satelliter', value: 87.5, unit: '%', ts: n },
      { t: 'e', area: 10, country: 'NORDIC', source: 'gsc-europa', kind: 'nagu', severity: 'warn', title: 'A', detail: '', start: new Date(Date.now() - 3600e3).toISOString() },
      { t: 'e', area: 10, country: 'NORDIC', source: 'gsc-europa', kind: 'nagu', severity: 'warn', title: 'B', detail: '', start: new Date(Date.now() - 7200e3).toISOString() },
    ];
    const s = gnssStatus('SE', syn);
    // Bara gsc: tillgänglighet 87.5 (Galileo ensam), varningstäthet 1−ln3/ln9=0.5 → 50;
    // stabilitet/täckning saknas → poäng = (0.35·87.5 + 0.2·50)/0.55 = 73.9.
    assert.equal(s.components.stabilitet, null);
    assert.equal(s.components.täckning, null);
    assert.equal(s.components.tillgänglighet.score, 87.5);
    assert.equal(s.components.varningstäthet.score, 50);
    assert.equal(s.score, 73.9);
    assert.ok(s.drivers.some(d => d.startsWith('Stabilitet: saknar rymdvädersdata')));
    assert.ok(s.drivers.some(d => d.startsWith('Täckning: saknar stationsantal')));
  });

  test('tomma data → okänt (score null)', () => {
    for (const c of ['SE', 'NORDIC']) {
      const s = gnssStatus(c, []);
      assert.equal(s.score, null);
      assert.equal(s.label, 'Okänt');
      assert.ok(Object.values(s.components).every(x => x === null));
    }
  });

  test('labelOf-trösklar', () => {
    assert.equal(labelOf(null), 'Okänt');
    assert.equal(labelOf(75), 'Hög driftssäkerhet');
    assert.equal(labelOf(74.9), 'Stabil drift');
    assert.equal(labelOf(55), 'Stabil drift');
    assert.equal(labelOf(54.9), 'Uppmärksamhet');
    assert.equal(labelOf(35), 'Uppmärksamhet');
    assert.equal(labelOf(34.9), 'Svag');
  });
});

// ---- gnssData (panelens data) ------------------------------------------------------
describe('gnssData', () => {
  // OBS: måste byggas INNE i testet – colRecs fylls först av before().
  const mkSrcs = () => Object.entries(COLS).map(([id, c]) => ({ id, name: c.name, country: c.country, every: c.every, status: 'ok', lastOk: null, ms: 100, error: null, records: colRecs[id] }));

  test('ALL: samtliga records, sorterade desc, källsammanfattning med counts', () => {
    const d = gnssData('ALL', mkSrcs());
    assert.equal(d.records.length, allRecs.length);
    for (let i = 1; i < d.records.length; i += 1) {
      const a = String(d.records[i - 1].ts ?? d.records[i - 1].start ?? '');
      const b = String(d.records[i].ts ?? d.records[i].start ?? '');
      assert.ok(a >= b, `sortering vid ${i}`);
    }
    assert.equal(d.sources.length, 6);
    for (const s of d.sources) {
      assert.equal(s.count, colRecs[s.id].length, s.id);
      assert.ok(s.name && s.every > 0 && s.status === 'ok');
    }
    assert.deepEqual(d.sources.map(s => s.id).sort(), Object.keys(COLS).sort());
  });

  test('landsfilter: egna + NORDIC (gemensamma) records', () => {
    const dSe = gnssData('SE', mkSrcs());
    assert.ok(dSe.records.every(r => r.country === 'SE' || r.country === 'NORDIC'));
    assert.equal(dSe.records.length, allRecs.filter(r => r.country === 'SE' || r.country === 'NORDIC').length);
    assert.ok(!dSe.records.some(r => r.source === 'datanorge')); // NO-källa
    assert.equal(dSe.records.filter(r => r.source === 'gnss-metadata').length, 73); // SWE: 3 metrics + 70 assets
    const dIs = gnssData('IS', mkSrcs());
    assert.ok(!dIs.records.some(r => r.country === 'SE'));
    assert.equal(dIs.records.filter(r => r.source === 'gnss-metadata').length, 56); // ISL: 3 + 53
  });
});

// ---- Korrelation (lib/gnss-correlation.js) ----------------------------------------
describe('gnssAnomalies', () => {
  test('fixture-snapshot: rymdväder + pågående NAGU + inaktuella elementset', () => {
    const a = gnssAnomalies(allRecs);
    assert.deepEqual(a.map(x => x.kind), ['datakälla', 'rymdväder', 'nagu']); // ts-desc: now > -1h > -60d
    assert.ok(a.every(x => x.severity === 'warn'));                           // 87,5 % ≥ 80 → ej konstellation
    assert.ok(a.find(x => x.kind === 'rymdväder').title.includes('Kp 5'));
    assert.ok(a.find(x => x.kind === 'nagu').title.includes('1 pågående NAGU'));
    assert.ok(a.find(x => x.kind === 'datakälla').title.includes('SBAS'));
  });

  test('låg Galileo-andel och hög Kp ger alert', () => {
    const n = new Date().toISOString();
    const recs = [
      { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Andel tillgängliga Galileo-satelliter', value: 70, unit: '%', ts: n },
      { t: 'm', area: 10, country: 'NORDIC', source: 'noaa', indicator: 'Kp-index (globalt geomagnetiskt)', value: 8, unit: '0–9', ts: n },
    ];
    const a = gnssAnomalies(recs);
    assert.deepEqual(a.map(x => [x.kind, x.severity]).sort(), [['konstellation', 'alert'], ['rymdväder', 'alert']]);
  });

  test('isActiveNagu: slutdatum i framtid/pågående/fortiden', () => {
    const at = Date.now();
    assert.equal(isActiveNagu({ start: new Date(at - 3600e3).toISOString(), end: new Date(at + 3600e3).toISOString() }, at), true);
    assert.equal(isActiveNagu({ start: new Date(at - 3600e3).toISOString() }, at), true); // END N/A = pågående
    assert.equal(isActiveNagu({ start: new Date(at - 72 * 3600e3).toISOString(), end: new Date(at - 3600e3).toISOString() }, at), false);
    assert.equal(isActiveNagu({ start: 'inte ett datum' }, at), false);
  });

  test('tomma records → inga anomalier', () => {
    assert.deepEqual(gnssAnomalies([]), []);
  });
});

describe('gnssChains', () => {
  test('fixture: Kp5 sammanfaller med pågående NAGU + storm↔NAGU inom ±72 h', () => {
    const c = gnssChains(allRecs);
    assert.equal(c.length, 2);
    assert.equal(c[0].id, 'active'); // Kp≥5 nu + öppen NAGU → score 11 först
    assert.equal(c[0].type, 'active-now');
    assert.equal(c[0].nagus.length, 1);
    assert.ok(c[0].storm.title.includes('Kp 5'));
    assert.equal(c[1].type, 'storm-nagu'); // storm -1 h ↔ NAGU-start ~-2 d (≤72 h)
    assert.equal(c[1].nagus.length, 1);    // -10/-60/-70-d-starterna utanför fönstret
    assert.equal(WINDOW_H, 72);
  });

  test('kedja saknas utan korrelerade händelser', () => {
    const recs = [
      { t: 'e', area: 10, country: 'NORDIC', source: 'noaa', kind: 'geomagnetiskt', severity: 'warn', title: 'Storm', detail: '', start: new Date(Date.now() - 200 * 3600e3).toISOString() },
      { t: 'e', area: 10, country: 'NORDIC', source: 'gsc-europa', kind: 'nagu', severity: 'warn', title: 'NAGU', detail: '', start: new Date().toISOString(), end: new Date(Date.now() - 3600e3).toISOString() },
    ];
    assert.deepEqual(gnssChains(recs), []); // storm 200 h gammal, NAGU stängd → varken kedja eller active-now
  });
});

describe('gnssCorrelation', () => {
  test('LLM-berikelse via injicerad summarizer (alert-scenario)', async () => {
    const n = new Date().toISOString();
    const recs = [
      { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Andel tillgängliga Galileo-satelliter', value: 70, unit: '%', ts: n },
    ];
    let prompt = null;
    const res = await gnssCorrelation(recs, { summarizer: async p => { prompt = p; return 'LLM-SAMMANFATTNING.'; } });
    assert.equal(res.narrativeSource, 'llm');
    assert.equal(res.narrative, 'LLM-SAMMANFATTNING.');
    assert.ok(prompt.includes('GNSS-drift på svenska') && prompt.includes('konstellation'));
  });

  test('summarizer som kastar → deterministisk fallback', async () => {
    const n = new Date().toISOString();
    const recs = [
      { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Andel tillgängliga Galileo-satelliter', value: 70, unit: '%', ts: n },
    ];
    const res = await gnssCorrelation(recs, { summarizer: async () => { throw new Error('modellen nere'); } });
    assert.equal(res.narrativeSource, 'deterministic');
    assert.ok(res.narrative.includes('Aktiva anomalier'));
  });

  test('lugnt läge → ingen LLM-anrop alls, lugn malltext', async () => {
    const n = new Date().toISOString();
    const recs = [
      { t: 'm', area: 10, country: 'NORDIC', source: 'noaa', indicator: 'Kp-index (globalt geomagnetiskt)', value: 3, unit: '0–9', ts: n },
      { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Andel tillgängliga Galileo-satelliter', value: 95, unit: '%', ts: n },
    ];
    let called = 0;
    const res = await gnssCorrelation(recs, { summarizer: async () => { called++; return 'x'; } });
    assert.equal(called, 0); // varken kedjor eller alerts → ingen anledning att fråga modellen
    assert.deepEqual(res.anomalies, []);
    assert.deepEqual(res.chains, []);
    assert.ok(res.narrative.startsWith('Inga aktiva'));
    assert.equal(res.narrativeSource, 'deterministic');
  });

  test('fixture-narrativ nämner sammanfallet just nu', async () => {
    const res = await gnssCorrelation(allRecs); // LLM avstängd → deterministisk text
    assert.equal(res.narrativeSource, 'deterministic');
    assert.ok(res.narrative.includes('sammanfaller just nu'));
    assert.ok(res.narrative.includes('Aktiva anomalier: 1 datakälla, 1 rymdväder, 1 nagu.'));
    assert.equal(res.anomalies.length, 3);
    assert.ok(gnssNarrative([], []).startsWith('Inga aktiva'));
  });

  test('LLM är avstängd utan LLM_BASE_URL (lib/llm.js)', async () => {
    const { llmEnabled, llmSummarize } = await import('../lib/llm.js');
    assert.equal(llmEnabled(), false);
    assert.equal(await llmSummarize('test'), null); // inget nätverksförsök
  });
});
