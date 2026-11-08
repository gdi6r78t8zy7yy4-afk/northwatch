// Enhetstester för industridatslagret (M10, område 7): fem nya kollektorer
// (Eurostat SDMX 2.1, OECD SDMX, JRC RMIS/EU CRMs, UN Comtrade, Statistics
// Iceland) + M4-kollektornas records (scb/ssb/statfinland seedas eftersom de
// saknar offline-test), och den beräknande analysen lib/industry.js.
// Inget nätverk – globalThis.fetch mockas per URL mot fixtures i
// testdata/industry/ (CC-/datafixturer formverifierade mot live-API:na
// 2026-11-07 med synthetiska värden). Riktiga tal beräknas ur fixtures, inte
// hårdkodas, där det är meningsfullt; slutpoäng i industryStatus är verifierade
// regressionsvärdeder.
//
// Kör: node --test server/test/industry.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Miljön sätts INNAN körs: COMTRADE_PREVIEW_DELAY_MS/STATICE_DELAY_MS nollas
// (4 s/9 s rate-limitpausar i preview-läge) och COMTRADE_API_KEY tas bort så
// att comtrade körs i preview-läge mot enstat fixtures. COMTRADE_KEYED_DELAY_MS
// nollas (annars 2 s paus × 9 i keyed-testet) och COMTRADE_RETRY_MAX=0 så att
// simulerade misslyckanden inte väntar på backoff.
process.env.COMTRADE_PREVIEW_DELAY_MS = '0';
process.env.COMTRADE_KEYED_DELAY_MS = '0';
process.env.COMTRADE_RETRY_MAX = '0';
process.env.STATICE_DELAY_MS = '0';
delete process.env.COMTRADE_API_KEY;

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'industry');
const rd = f => fs.readFileSync(path.join(TESTDATA, f), 'utf8');

// ---- Mockad fetch per URL → fixture ------------------------------------------
const realFetch = globalThis.fetch;
const comtradeCalls = []; // {url, headers} – sparas för keyed/preview-URL-anspråk
let comtradeFail = { count: 0, status: 500 }; // X första comtrade-anropen returnerar status
const comtradeEmpty = new Set(); // reporter-koder som returnerar count=0 (t.ex. NO – inga dataset)
globalThis.fetch = (url, opt) => {
  const u = String(url);
  const method = opt?.method ?? 'GET';
  const ok = text => ({ ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) });
  const fail = status => ({ ok: false, status, text: async () => '', json: async () => ({}) });
  let m;
  if ((m = u.match(/contentconstraint\/ESTAT\/([^/]+)\/latest/))) return ok(rd('eurostat-cc-' + m[1] + '.xml'));
  if ((m = u.match(/data\/ESTAT\/([^/]+)\//))) return ok(rd('eurostat-data-' + m[1] + '.json'));
  if (u.includes('sdmx.oecd.org')) return ok(rd('oecd-steel.csv'));
  if ((m = u.match(/eucrm\/([^/]+)/))) return ok(rd('rmis-' + m[1] + '.json'));
  if (u.includes('comtradeapi.un.org')) {
    comtradeCalls.push({ url: u, headers: opt?.headers ?? {} });
    if (comtradeFail.count > 0) { comtradeFail.count -= 1; return fail(comtradeFail.status); }
    const rep = u.match(/reporterCode=(\d+)/);
    if (rep && comtradeEmpty.has(rep[1])) {
      return ok('{"elapsedTime":"0.1 secs","count":0,"data":[],"error":""}');
    }
    // data/v1/get (keyed) → 16-raders mot×p2-svar; public/v1/preview → enskild totalrad.
    return ok(u.includes('/data/v1/') ? rd('comtrade-keyed.json') : rd('comtrade-preview.json'));
  }
  if (u.includes('px.hagstofa.is')) return ok(method === 'POST' ? rd('is-data.json') : rd('is-structure.json'));
  throw new Error('fetch-mock: oväntad URL ' + u);
};
after(() => { globalThis.fetch = realFetch; });

const eurostatCol = (await import('../collectors/eurostat-industry.js')).default;
const { parseCC, buildKey } = await import('../collectors/eurostat-industry.js');
const oecdCol = (await import('../collectors/oecd.js')).default;
const { parseRow } = await import('../collectors/oecd.js');
const rmisCol = (await import('../collectors/rmis.js')).default;
const { latestByCountryMaterial } = await import('../collectors/rmis.js');
const comtradeCol = (await import('../collectors/comtrade.js')).default;
const { queryFor, pickTotal, periodYear, fetchTotal } = await import('../collectors/comtrade.js');
const staticeCol = (await import('../collectors/statice.js')).default;
const { tradeQuery } = await import('../collectors/statice.js');
const {
  classify, productionComponent, tradeComponent, capacityComponent,
  labelOf, industryStatus, industryData, NORDIC, WEIGHTS,
} = await import('../lib/industry.js');

// M4-kollektornas records – ingen offline-kollektör, seedas med samma
// indikator-/enhetsskick som de riktiga kollektörerna producerar.
const SEED = {
  scb: [
    { t: 'm', area: 7, country: 'SE', source: 'scb', indicator: 'Net trade – mrdSEK (2026-09)', value: 3.4, unit: 'mrdSEK', ts: '2026-09' },
    { t: 'm', area: 7, country: 'SE', source: 'scb', indicator: 'Imports – mrdSEK (2026-09)', value: 81.2, unit: 'mrdSEK', ts: '2026-09' },
    { t: 'm', area: 7, country: 'SE', source: 'scb', indicator: 'Exports – mrdSEK (2026-09)', value: 84.6, unit: 'mrdSEK', ts: '2026-09' },
    { t: 'm', area: 7, country: 'SE', source: 'scb', indicator: 'Imports – % change (2026-09)', value: 2.1, unit: 'mrdSEK', ts: '2026-09' },
  ],
  ssb: [
    { t: 'm', area: 7, country: 'NO', source: 'ssb', indicator: 'Net trade – mNOK (2026-09)', value: 4335, unit: 'mNOK', ts: '2026-09' },
    { t: 'm', area: 7, country: 'NO', source: 'ssb', indicator: 'Imports – mNOK (2026-09)', value: 29875, unit: 'mNOK', ts: '2026-09' },
    { t: 'm', area: 7, country: 'NO', source: 'ssb', indicator: 'Exports – mNOK (2026-09)', value: 34210, unit: 'mNOK', ts: '2026-09' },
  ],
  statfinland: [
    { t: 'm', area: 7, country: 'FI', source: 'statfinland', indicator: 'Industriomsättning (2021=100), Originalserien (2025Q4)', value: 97.9, unit: 'index', ts: '2025Q4' },
    { t: 'm', area: 7, country: 'FI', source: 'statfinland', indicator: 'Industriomsättning (2021=100), Originalserien (2026Q3)', value: 98.8, unit: 'index', ts: '2026Q3' },
  ],
};

const M4_CONFIG = [
  { id: 'scb', name: 'SCB (industri/handelsstatistik)', area: 7, country: 'SE', every: 86400 },
  { id: 'ssb', name: 'SSB (handelstatistik)', area: 7, country: 'NO', every: 86400 },
  { id: 'statfinland', name: 'StatFin (industriomsättning)', area: 7, country: 'FI', every: 604800 },
];

let store;
let tmpDir;
let sources;
let allRecs;
const colRecs = {};

before(async () => {
  tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'northwatch-industry-'));
  process.env.NORTHWATCH_STORE_FILE = path.join(tmpDir, 'store.json');
  store = await import('../lib/store.js');
  store.state.sources.clear();
  for (const col of [eurostatCol, oecdCol, rmisCol, comtradeCol, staticeCol]) {
    store.registerSource({ id: col.id, name: col.name, area: col.area, country: col.country, every: col.every });
  }
  for (const cfg of M4_CONFIG) store.registerSource(cfg);

  for (const col of [eurostatCol, oecdCol, rmisCol, comtradeCol, staticeCol]) {
    const recs = await col.fetch();
    colRecs[col.id] = recs;
    store.setResult(col.id, recs, 10);
  }
  store.setResult('scb', SEED.scb, 10);
  store.setResult('ssb', SEED.ssb, 10);
  store.setResult('statfinland', SEED.statfinland, 10);

  sources = store.areaSources(7);
  allRecs = sources.flatMap(s => s.records);
});

after(async () => {
  await store?.flushStore();
  if (tmpDir) await fsPromises.rm(tmpDir, { recursive: true, force: true });
  delete process.env.NORTHWATCH_STORE_FILE;
});

// ---- Kollektörers recordantal (från fixtures) --------------------------------

describe('kollektörers recordantal', () => {
  test('eurostat-industry: sju flöden, 82 records (10+5+6+9+18+22+12)', () => {
    assert.equal(colRecs['eurostat-industry'].length, 82);
    // Inget "hämtfel"-record – alla sju flöden levererade.
    assert.ok(!colRecs['eurostat-industry'].some(r => r.indicator.includes('hämtfel')));
  });
  test('oecd: sex länder med stålkapacitet (DNK/ISL tomt OBS_VALUE)', () => {
    assert.equal(colRecs.oecd.length, 6);
    const se = colRecs.oecd.find(r => r.country === 'SE');
    assert.equal(se.value, 5.95);
    assert.equal(se.unit, 'Mt');
    const cn = colRecs.oecd.find(r => r.country === 'CN');
    assert.equal(cn.value, 1135.5);
  });
  test('rmis: 75 metrik + 25 händelser (17 high ≥ 80 % + 8 medium)', () => {
    assert.equal(colRecs.rmis.length, 100);
    const metrics = colRecs.rmis.filter(r => r.t === 'm');
    const events = colRecs.rmis.filter(r => r.t === 'e');
    assert.equal(metrics.length, 75);
    assert.equal(events.length, 25);
    assert.equal(events.filter(e => e.severity === 'high').length, 17);
    assert.equal(events.filter(e => e.severity === 'medium').length, 8);
  });
  test('comtrade: 5 länder × 2 flöden = 10 records', () => {
    assert.equal(colRecs.comtrade.length, 10);
    const seX = colRecs.comtrade.find(r => r.country === 'SE' && /export/i.test(r.indicator));
    assert.equal(seX.value, 195760254697.116);
    assert.equal(seX.unit, 'USD');
  });
  test('statice: 3 månader × 5 handelsflöden = 15 records', () => {
    assert.equal(colRecs.statice.length, 15);
    const bal = colRecs.statice.find(r => r.ts === '2026-09' && /fob-fob/i.test(r.indicator));
    assert.equal(bal.value, -38763.8);
    assert.equal(bal.unit, 'mISK');
  });
});

// ---- eurostat parseCC / buildKey ----------------------------------------------

describe('eurostat parseCC / buildKey', () => {
  const dims = parseCC(rd('eurostat-cc-EI_ISIN_M.xml'));
  test('parseCC hittar dimensioner ur contentconstraint', () => {
    assert.ok(dims.length >= 5);
    const geo = dims.find(d => d.id === 'geo');
    assert.ok(geo);
    for (const c of ['SE', 'NO', 'DK', 'FI', 'IS']) assert.ok(geo.values.includes(c));
  });
  test('buildKey bygger nyckeln ur selektionen (TIME_PERIOD ingår ej)', () => {
    const key = buildKey(dims, {
      unit: ['I2021'], s_adj: ['SCA'], nace_r2: ['B-D'], indic: ['IS-IP'],
      geo: ['SE', 'NO', 'DK', 'FI', 'IS'],
    });
    assert.equal(key, 'M.I2021.SCA.B-D.IS-IP.SE+NO+DK+FI+IS');
  });
  test('buildKey kastar vid ej tillåtet dimensionvärde', () => {
    assert.throws(() => buildKey(dims, {
      unit: ['I2021'], s_adj: ['SCA'], nace_r2: ['B-D'], indic: ['IS-IP'], geo: ['XX'],
    }), /geo=XX är ej tillåtet/);
  });
  test('buildKey kastar om oselektad dimension har flera värden', () => {
    const d = parseCC(rd('eurostat-cc-NAMQ_10_A10.xml'));
    const geo = d.find(x => x.id === 'geo');
    if (geo && geo.values.length > 1) {
      assert.throws(() => buildKey(d, {}), /ej selekterad/);
    }
  });
});

// ---- oecd parseRow --------------------------------------------------------------

describe('oecd parseRow', () => {
  test('högerankrade fält är stabila trots komma i REF_AREA-etiketten', () => {
    const line = rd('oecd-steel.csv').split('\n').map(s => s.trim()).filter(Boolean).find(l => l.includes('CHN'));
    const r = parseRow(line);
    assert.equal(r.refArea, 'CHN');
    assert.equal(r.time, '2025');
    assert.equal(r.value, '1135.5');
    assert.equal(r.unitMult, '6');
    // Tonnes → mult 6 → värdet är redan i Mt (10^(6-6)=1).
  });
  test('tom OBS_VALUE ger tomt value-fält', () => {
    const line = rd('oecd-steel.csv').split('\n').map(s => s.trim()).filter(Boolean).find(l => l.includes(',DNK,'));
    const r = parseRow(line);
    assert.equal(r.value, '');
  });
});

// ---- rmis latestByCountryMaterial -----------------------------------------------

describe('rmis latestByCountryMaterial', () => {
  test('senaste året per land+material vinner', () => {
    const rows = [
      { material: 'Graphite', year: 2024, country: 'Norway', value: 1, unit: 't' },
      { material: 'Graphite', year: 2025, country: 'Norway', value: 7050.42, unit: 't' },
      { material: 'Aluminium', year: 2025, country: 'Iceland', value: 357024, unit: 't' },
    ];
    const out = latestByCountryMaterial(rows);
    assert.equal(out.length, 2);
    const gr = out.find(r => r.material === 'Graphite');
    assert.equal(gr.value, 7050.42);
    assert.equal(gr.code, 'NO');
    assert.equal(out.find(r => r.material === 'Aluminium').code, 'IS');
  });
  test('obekanta länder släpps', () => {
    assert.equal(latestByCountryMaterial([{ material: 'X', year: 2025, country: 'Greenland', value: 1 }]).length, 0);
  });
});

// ---- statice tradeQuery -----------------------------------------------------------

describe('statice tradeQuery', () => {
  test('tre senaste perioderna + alla övriga variabelvärden', () => {
    const meta = JSON.parse(rd('is-structure.json'));
    const { query, timeVar, periods } = tradeQuery(meta, 3);
    assert.equal(timeVar.code, 'Month');
    assert.deepEqual(periods, ['2026M07', '2026M08', '2026M09']);
    assert.equal(query.length, 2); // Month + Trade
    assert.deepEqual(query[0].selection.values, periods);
  });
  test('kastar utan tidsvariabel', () => {
    assert.throws(() => tradeQuery({ variables: [{ code: 'x', values: [1, 2] }] }), /tidsvariabel/);
  });
});

// ---- comtrade pickTotal / queryFor / keyed ----------------------------------------

describe('comtrade pickTotal / queryFor', () => {
  test('keyed-svar: isAggregate true på ALLA rader – väljer mot=0 & p2=0', () => {
    const doc = JSON.parse(rd('comtrade-keyed.json'));
    assert.ok(doc.data.length > 1); // nedbrytning mot×p2, ej enskild rad
    assert.ok(doc.data.every(r => r.isAggregate === true)); // onyttig signal – ignorerad
    const v = pickTotal(doc, 2025);
    const m9900 = doc.data.find(r => Number(r.motCode) === 9900 && Number(r.partner2Code) === 0);
    assert.notEqual(v, m9900.primaryValue); // inte "ej deklarerat"-raden
    assert.equal(v, 208483056355.924); // unik totalrad (SE X 2025, verifierad mot live)
  });
  test('preview-svaret (enskild rad) väljs av samma selektor', () => {
    const doc = JSON.parse(rd('comtrade-preview.json'));
    assert.equal(doc.count, 1);
    assert.equal(pickTotal(doc, 2024), doc.data[0].primaryValue);
  });
  test('kastar när totalraden saknas; API-felet propageras', () => {
    assert.throws(() => pickTotal({ data: [{ motCode: 9900, partner2Code: 0, primaryValue: 123 }] }, 2025), /totalrad/);
    assert.throws(() => pickTotal({ data: [], error: 'Invalid API key' }, 2025), /Invalid API key/);
  });
  test('queryFor: 4-siffrigt år (inte A-prefix) + koder som query-parametrar', () => {
    assert.equal(queryFor({ code: 752, country: 'SE' }, 2025, { code: 'X' }),
      'reporterCode=752&period=2025&partnerCode=0&cmdCode=TOTAL&flowCode=X');
    assert.equal(queryFor({ code: 578, country: 'NO' }, 2026, { code: 'M' }),
      'reporterCode=578&period=2026&partnerCode=0&cmdCode=TOTAL&flowCode=M');
  });
});

describe('comtrade keyed fetch (data/v1/get)', () => {
  after(() => { delete process.env.COMTRADE_API_KEY; });
  test('10 querystring-anrop med subscription-key-header, totalrad per land/flöde', async () => {
    process.env.COMTRADE_API_KEY = 'test-nordwatch-key';
    comtradeCalls.length = 0;
    const recs = await comtradeCol.fetch();
    const year = periodYear();
    assert.equal(comtradeCalls.length, 10);
    for (const c of comtradeCalls) {
      assert.ok(c.url.startsWith('https://comtradeapi.un.org/data/v1/get/C/A/HS?'), c.url);
      assert.ok(!c.url.includes('/A' + year + '/'), 'legacy vägsform (A2025) används ej');
      assert.equal(c.headers['Ocp-Apim-Subscription-Key'], 'test-nordwatch-key');
    }
    assert.ok(comtradeCalls[0].url.includes(`reporterCode=752&period=${year}&partnerCode=0&cmdCode=TOTAL&flowCode=X`));
    assert.ok(comtradeCalls[1].url.includes(`reporterCode=752&period=${year}&partnerCode=0&cmdCode=TOTAL&flowCode=M`));
    // Förväntat värde beräknas ur keyed-fixturens totalrad (mot=0 & p2=0).
    const doc = JSON.parse(rd('comtrade-keyed.json'));
    const total = doc.data.find(r => Number(r.motCode) === 0 && Number(r.partner2Code) === 0).primaryValue;
    assert.equal(recs.length, 10);
    for (const r of recs) assert.equal(r.value, total);
    const seX = recs.find(r => r.country === 'SE' && /export/i.test(r.indicator));
    assert.equal(seX.value, total);
    assert.equal(seX.unit, 'USD');
  });
});

describe('comtrade fetchTotal retry', () => {
  const url = 'https://comtradeapi.un.org/data/v1/get/C/A/HS?reporterCode=752&period=2025&partnerCode=0&cmdCode=TOTAL&flowCode=X';
  after(() => { delete process.env.COMTRADE_RETRY_MAX; comtradeFail = { count: 0, status: 500 }; });
  test('transient 500s retryas (backoff) tills svaret kommer', async () => {
    process.env.COMTRADE_RETRY_MAX = '2';
    comtradeCalls.length = 0;
    comtradeFail = { count: 2, status: 500 }; // två 500:or, därefter 200
    const doc = await fetchTotal(url, { headers: { 'Ocp-Apim-Subscription-Key': 'k' } });
    assert.equal(comtradeCalls.length, 3); // 2 misslyckade + 1 lyckad
    assert.equal(pickTotal(doc, 2025), 208483056355.924);
  });
  test('icke-transient fel (404) throwas direkt utan retry', async () => {
    process.env.COMTRADE_RETRY_MAX = '2';
    comtradeCalls.length = 0;
    comtradeFail = { count: 5, status: 404 };
    await assert.rejects(() => fetchTotal(url, { headers: { 'Ocp-Apim-Subscription-Key': 'k' } }), /HTTP 404/);
    assert.equal(comtradeCalls.length, 1); // inget retry på 404
  });
  test('retry-tak: alla försök 500 → throwas efter RETRY_MAX + 1 anrop', async () => {
    process.env.COMTRADE_RETRY_MAX = '1';
    comtradeCalls.length = 0;
    comtradeFail = { count: 5, status: 500 };
    await assert.rejects(() => fetchTotal(url, { headers: { 'Ocp-Apim-Subscription-Key': 'k' } }), /HTTP 500/);
    assert.equal(comtradeCalls.length, 2); // initial + 1 retry
  });
});

describe('comtrade ej rapporterat (count=0)', () => {
  test('rapportör utan data ger "ej rapporterat"-records, inte hämtfel', async () => {
    comtradeEmpty.add('578'); // NO har inga dataset i Comtrade alls
    const recs = await comtradeCol.fetch();
    comtradeEmpty.delete('578');
    assert.equal(recs.length, 10);
    const seX = recs.find(r => r.country === 'SE' && /export/i.test(r.indicator));
    assert.ok(Number.isFinite(seX.value)); // övriga länder levererar
    const noX = recs.find(r => r.country === 'NO' && /X/.test(r.indicator));
    const noM = recs.find(r => r.country === 'NO' && /M/.test(r.indicator));
    assert.ok(/ej rapporterat/.test(noX.indicator));
    assert.ok(/ej rapporterat/.test(noM.indicator));
    assert.equal(noX.value, null);
    assert.equal(noX.ts, String(periodYear()));
    assert.ok(!recs.some(r => /hämtfel/.test(r.indicator)));
  });
});

// ---- classify ----------------------------------------------------------------------

describe('classify', () => {
  const m = (indicator, unit, source) => ({ indicator, unit, source });
  test('källan avgör först: rmis/oecd/comtrade', () => {
    assert.equal(classify(m('Materialcirkularitetsindex (index)', 'index', 'rmis')), 'rmis');
    assert.equal(classify(m('Stålkapacitet, råstål (Sverige), 2025', 'Mt', 'oecd')), 'capacity');
    assert.equal(classify(m('Exporter (UN Comtrade, USD), 2025', 'USD', 'comtrade')), 'export');
    assert.equal(classify(m('Importer (UN Comtrade, USD), 2025', 'USD', 'comtrade')), 'import');
  });
  test('a/a % → yoy, index-enheter → index', () => {
    assert.equal(classify(m('Industriproduktion, 12-månadersförändring, 2026-09', 'a/a %', 'eurostat-industry')), 'yoy');
    assert.equal(classify(m('Industriproduktionsindex (2021=100), 2026-09', 'index 2021=100', 'eurostat-industry')), 'index');
    assert.equal(classify(m('Industriomsättning (2021=100), Originalserien (2026Q3)', 'index', 'statfinland')), 'index');
  });
  test('EU-27-aggregat är inte landets egen handel', () => {
    assert.equal(classify(m('EU-27-import av råvaror, USA (mio EUR), 2024', 'mio EUR', 'eurostat-industry')), null);
    assert.equal(classify(m('Mervärdetillökning, tillverkning (MEUR), 2026Q2', 'MEUR', 'eurostat-industry')), null);
  });
  test('handel kräver penning-enhet och utesluter %-särter', () => {
    assert.equal(classify(m('Net trade – mrdSEK (2026-09)', 'mrdSEK', 'scb')), 'balance');
    assert.equal(classify(m('Imports – mNOK (2026-09)', 'mNOK', 'ssb')), 'import');
    assert.equal(classify(m('Handelsbalans med EU-27 (mio EUR), 2024', 'mio EUR', 'eurostat-industry')), 'balance');
    // TEIBS070 lagerförändring har unit '%' → ingen handel, ingen index → null.
    assert.equal(classify(m('Lagerförändring, tillverkning (%), 2026Q2', '%', 'eurostat-industry')), null);
    // '% change'-särter exkluderas även med penning-enhet.
    assert.equal(classify(m('Imports – % change (2026-09)', 'mrdSEK', 'scb')), null);
  });
});

// ---- Komponenter --------------------------------------------------------------------

const recsFor = c => allRecs.filter(r => r.t === 'm' && (r.country === c || r.country === 'NORDIC'));

describe('productionComponent', () => {
  test('SE: 12m-förändring + index 2021=100', () => {
    const p = productionComponent(recsFor('SE'));
    assert.equal(p.score, 57.6); // mean(50+5*2.4, 50+2*(101.6-100)) = mean(62, 53.2)
    assert.match(p.basis, /12m-förändring 2\.4%/);
    assert.match(p.basis, /index 101\.6/);
  });
  test('FI: genomsnitt av eurostat- och statfin-index + yoy', () => {
    const p = productionComponent(recsFor('FI'));
    assert.equal(p.score, 53.2); // mean(50+5*1.8, mean(50+2*(98.6-100), 50+2*(98.8-100)))
  });
  test('INGET index → null', () => {
    assert.equal(productionComponent([]), null);
  });
});

describe('tradeComponent', () => {
  test('SE: comtrade (ratio 0 → 50) + scb balans/import', () => {
    const t = tradeComponent(recsFor('SE'));
    assert.equal(t.score, 52.1); // mean(50, 50+100*(3.4/81.2)=54.19)
  });
  test('NO: comtrade + eurostat EFTA + ssb', () => {
    const t = tradeComponent(recsFor('NO'));
    assert.equal(t.score, 61.2);
    assert.match(t.basis, /eurostat-industry/);
    assert.match(t.basis, /ssb/);
  });
  test('DK: bara comtrade (ratio 0) → 50', () => {
    const t = tradeComponent(recsFor('DK'));
    assert.equal(t.score, 50);
  });
  test('IS: comtrade + EFTA + statice (negativ balans sänker)', () => {
    const t = tradeComponent(recsFor('IS'));
    assert.equal(t.score, 32.7);
  });
});

describe('capacityComponent', () => {
  test('SE: stål 5.95 Mt, inga material', () => {
    const c = capacityComponent(recsFor('SE'));
    assert.equal(c.score, 55.7); // clamp(20+6*5.95) + 0
  });
  test('NO: stål 0.95 Mt + 14 material → +28 (max 30)', () => {
    const c = capacityComponent(recsFor('NO'));
    assert.equal(c.score, 53.7); // clamp(20+6*0.95)=25.7 + 28
  });
  test('DK: ingen stål och inga material → null', () => {
    assert.equal(capacityComponent(recsFor('DK')), null);
  });
  test('IS: ingen stål men 4 material → 20 + 8', () => {
    const c = capacityComponent(recsFor('IS'));
    assert.equal(c.score, 28);
  });
});

// ---- labelOf ------------------------------------------------------------------------

describe('labelOf', () => {
  test('gränser', () => {
    assert.equal(labelOf(null), 'Okänt');
    assert.equal(labelOf(65), 'Expansiv');
    assert.equal(labelOf(80), 'Expansiv');
    assert.equal(labelOf(45), 'Stabilt');
    assert.equal(labelOf(64.9), 'Stabilt');
    assert.equal(labelOf(44.9), 'Kontraktion');
    assert.equal(labelOf(0), 'Kontraktion');
  });
});

// ---- industryStatus --------------------------------------------------------------------

describe('industryStatus per land', () => {
  const EXPECT = {
    SE: { score: 55.6, label: 'Stabilt' },
    NO: { score: 59.7, label: 'Stabilt' },
    DK: { score: 49.6, label: 'Stabilt' },
    FI: { score: 51.0, label: 'Stabilt' },
    IS: { score: 36.1, label: 'Kontraktion' },
  };
  for (const c of NORDIC) {
    test(c, () => {
      const s = industryStatus(c, allRecs);
      assert.equal(s.country, c);
      assert.equal(s.score, EXPECT[c].score);
      assert.equal(s.label, EXPECT[c].label);
      assert.ok(s.sources.length >= 3);
      assert.equal(s.drivers.length, 3);
      if (c === 'DK') assert.equal(s.components.capacity, null);
      else assert.ok(s.components.capacity);
      // Alla fem länderna har produktionstäckning via Eurostat EI_ISIN_M/EI_ISIR_M.
      assert.ok(s.components.production);
    });
  }
  test('komponentpoäng per land (verifierat ur fixtures)', () => {
    const SE = industryStatus('SE', allRecs);
    assert.equal(SE.components.production.score, 57.6);
    assert.equal(SE.components.trade.score, 52.1);
    assert.equal(SE.components.capacity.score, 55.7);
    const NO = industryStatus('NO', allRecs);
    assert.equal(NO.components.production.score, 61.2);
    assert.equal(NO.components.trade.score, 61.2);
    assert.equal(NO.components.capacity.score, 53.7);
    const FI = industryStatus('FI', allRecs);
    assert.equal(FI.components.production.score, 53.2);
    assert.equal(FI.components.capacity.score, 47.2);
    const IS = industryStatus('IS', allRecs);
    assert.equal(IS.components.production.score, 41.3);
    assert.equal(IS.components.trade.score, 32.7);
    assert.equal(IS.components.capacity.score, 28);
  });
  test('saknad komponent renormaliseras (DK utan kapacitet)', () => {
    assert.deepEqual(WEIGHTS, { production: 0.5, trade: 0.3, capacity: 0.2 });
    const DK = industryStatus('DK', allRecs);
    // (0.5*49.4 + 0.3*50) / (0.5+0.3) = (24.7 + 15) / 0.8 = 49.6
    assert.equal(DK.score, 49.6);
  });
});

describe('industryStatus NORDIC', () => {
  test('snitt av de fem länderna med per-land-rader', () => {
    const s = industryStatus('NORDIC', allRecs);
    assert.equal(s.country, 'NORDIC');
    assert.equal(s.score, 50.4); // mean(55.6, 59.7, 49.6, 51.0, 36.1)
    assert.equal(s.label, 'Stabilt');
    assert.equal(s.countries.length, 5);
    assert.equal(s.drivers.length, 5);
    assert.equal(s.components.capacity.score, 46.2); // mean(SE 55.7, NO 53.7, FI 47.2, IS 28)
    assert.equal(s.components.capacity.basis, 'SE 55.7 · NO 53.7 · FI 47.2 · IS 28');
  });
});

// ---- industryData ------------------------------------------------------------------------

describe('industryData', () => {
  test('filtrerar records per land (inkl NORDIC) och sammanfattar källor', () => {
    const d = industryData('SE', sources);
    assert.ok(d.records.every(r => r.country === 'SE' || r.country === 'NORDIC'));
    assert.ok(d.records.length > 0);
    const ids = d.sources.map(s => s.id);
    for (const id of ['eurostat-industry', 'oecd', 'rmis', 'comtrade', 'scb']) assert.ok(ids.includes(id));
    assert.ok(d.sources.every(s => typeof s.count === 'number'));
    // Källor som inte berör SE (statice=IS, ssb=NO) är ändå med i källstatus
    // men bidrar inte till SE:s records.
    assert.ok(!d.records.some(r => r.source === 'statice'));
    assert.ok(!d.records.some(r => r.source === 'ssb'));
  });
  test('country ALL ger alla records', () => {
    const d = industryData('ALL', sources);
    assert.equal(d.records.length, allRecs.length);
  });
});
