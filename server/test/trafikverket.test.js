// Enhetstester för Trafikverket-kollektorn (M5).
//
// Rådata från de live-verifierade frågorna ligger i server/testdata/
// (2026-11-02, alla HTTP 200) – partiella stickprov (de första raderna)
// av varje verifierade fråga; rowCount-metaportalen visar den fulla storleken.
// Testerna kör kollektorns parser och hela tick-vägen mot de fixturen –
// inget nätverk. Förväntade värden beräknas ur fixturen, inte hårdkodas.
//
// Kör: node --test "server/test/trafikverket.test.js"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.TRAFIKVERKET_KEY = 'test-key';
delete process.env.TRAFIKVERKET_SSE;

const kollektorn = (await import('../collectors/trafikverket.js')).default;
const { wktGeo, extractRows, requestXml } = await import('../collectors/trafikverket.js');

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata');
const FIXTURE = {
  Situation: 'situation-full.json',
  RoadCondition: 'roadcondition-full.json',
  TrafficFlow: 'trafficflow-window.json',
  TrainAnnouncement: 'trainannouncement-6st.json',
  WeatherObservation: 'weatherobs-15min.json',
  FerryAnnouncement: 'ferryannouncements.json',
};

// Stationslisten (testdata saknar geometri) bär med geometri + den
// följda signaturen Cst (Stockholm C), verifierad 2026-11-02. Prognosticated
// värdena speglar live-API:t: Cst (Stockholm C) är "prognosticerad" (ombyggd)
// trots full drift – kartpunkten ska ändå visas.
const STATIONS = [
  { LocationSignature: 'Cst', AdvertisedLocationName: 'Stockholm C', Prognosticated: true,
    CountyNo: [1, 2], Geometry: { WGS84: 'POINT (18.06667 59.33039)' } },
  { LocationSignature: 'A', AdvertisedLocationName: 'Alingsås', Prognosticated: false,
    Geometry: { WGS84: 'POINT (12.53219 57.92691)' } },
];

const rows = type => (JSON.parse(fs.readFileSync(path.join(TESTDATA, FIXTURE[type]), 'utf8')).rows ?? []);

// Senaste XML-bodyn per objekttyp – för regressionskoll av frågebyggeriet.
const seenBodies = new Map();

function mockFetch() {
  globalThis.fetch = async (url, opt) => {
    const xml = String(opt?.body ?? '');
    const type = (xml.match(/objecttype='([^']+)'/) ?? [])[1];
    assert.ok(type, 'mocken fick en fråga utan objecttype');
    seenBodies.set(type, xml);
    let body;
    if (type === 'TrainStation') body = STATIONS;
    else {
      const all = rows(type);
      // Fönsterfrågor ($dateadd) svarar med en delmängd, fulla med allt.
      body = xml.includes('dateadd') ? all.slice(0, 5) : all;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ RESPONSE: { RESULT: [{ [type]: body, INFO: null }] } }),
    };
  };
}

const realFetch = globalThis.fetch;
before(mockFetch);
after(() => { globalThis.fetch = realFetch; });

// ---- parser --------------------------------------------------------------

test('wktGeo: POINT, LINESTRING, POLYGON och trasig WKT', () => {
  assert.deepEqual(wktGeo('POINT (18.07428 59.47933)'),
    { type: 'Point', coordinates: [18.07428, 59.47933] });
  assert.deepEqual(wktGeo('LINESTRING (18.446 60.340, 18.447 60.341)'),
    { type: 'LineString', coordinates: [[18.446, 60.340], [18.447, 60.341]] });
  assert.deepEqual(wktGeo('POLYGON ((1 2, 3 4, 5 6, 1 2))'),
    { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] });
  assert.equal(wktGeo(''), null);
  assert.equal(wktGeo('INGET (1 2)'), null);
  assert.equal(wktGeo('POINT ()'), null);
});

test('extractRows: array, enstaka objekt, tomt RESULT', () => {
  const xml = "<QUERY objecttype='Situation'/>";
  assert.deepEqual(extractRows({ Situation: [{ Id: 'a' }, { Id: 'b' }] }, xml),
    [{ Id: 'a' }, { Id: 'b' }]);
  assert.deepEqual(extractRows({ Situation: { Id: 'a' } }, xml), [{ Id: 'a' }]);
  assert.deepEqual(extractRows({ Situation: [] }, xml), []);
  assert.deepEqual(extractRows({ INFO: { SSEURL: 'x' } }, xml), []);
});

test('requestXml: LOGIN, attribut, filter, INCLUDE', () => {
  const xml = requestXml({
    type: 'Situation', ns: 'Road.TrafficInfo', sv: '1.6',
    limit: 10, orderby: 'ModifiedTime',
    filter: "<FILTER><GT name='ModifiedTime' value='$dateadd(-00:15:00)' /></FILTER>",
    include: ['Id', 'Deviation.MessageCodeValue'],
  });
  assert.match(xml, /^<REQUEST><LOGIN authenticationkey='test-key'\/>/);
  assert.match(xml,
    /objecttype='Situation' namespace='Road\.TrafficInfo' schemaversion='1\.6' limit='10' orderby='ModifiedTime'/);
  assert.match(xml, /<FILTER><GT name='ModifiedTime' value='\$dateadd\(-00:15:00\)' \/><\/FILTER>/);
  assert.match(xml, /<INCLUDE>Id<\/INCLUDE><INCLUDE>Deviation\.MessageCodeValue<\/INCLUDE><\/QUERY><\/REQUEST>$/);
});

test('TrainStation INCLUDE exkluderar OfficialLocationName (avslås 400 av API:t)', async () => {
  await kollektorn.fetch();
  const xml = seenBodies.get('TrainStation');
  assert.ok(xml, 'TrainStation-frågan skickades');
  // Regression 2026-11-02: datacache INCLUDE avslår OfficialLocationName med
  // "Invalid query attribute" även om fältet finns i intellisense-katalogen.
  assert.doesNotMatch(xml, /OfficialLocationName/);
  for (const f of ['LocationSignature', 'AdvertisedLocationName', 'CountyNo',
    'Prognosticated', 'Geometry.WGS84']) {
    assert.match(xml, new RegExp(`<INCLUDE>${f.replace(/\./g, '\\.')}</INCLUDE>`), `INCLUDE ${f}`);
  }
});

// ---- hela tick-vägen mot fixtures -----------------------------------------

test('tick 1: fullastar och normaliserar alla objekttyper', async () => {
  const recs = await kollektorn.fetch();
  assert.ok(Array.isArray(recs) && recs.length > 10, `väntade >10 poster, fick ${recs.length}`);

  // Förväntade värden ur fixturen (ej hårdkodade).
  const sit = rows('Situation');
  const expectedSit = sit.filter(r => (r.Deviation ?? []).some(d => d.Id && !d.Suspended)).length;
  const expectedRoad = rows('RoadCondition').filter(r => Number(r.ConditionCode ?? 0) >= 2).length;
  const flowRows = rows('TrafficFlow').filter(r => !r.Deleted && r.SiteId != null);
  const expectedFlowSites = new Set(flowRows.map(r => r.SiteId)).size;
  const expectedFlowTotal = flowRows.reduce((a, r) => a + (Number(r.VehicleFlowRate) || 0), 0);
  const expectedTrains = rows('TrainAnnouncement').length;
  const expectedFerry = rows('FerryAnnouncement').filter(r => !r.Deleted).length;
  const expectedWeather = rows('WeatherObservation').length;

  const m = p => recs.find(r => r.t === 'm' && r.indicator.includes(p));
  assert.equal(m('Aktiva trafikhändelser')?.value, expectedSit, 'väghändelser (Suspended filtreras bort)');
  assert.equal(m('Besvärligt väglag')?.value, expectedRoad, 'väglag');
  assert.equal(m('Flödesmätare med mätning')?.value, expectedFlowSites, 'unika mätare i fönstret');
  assert.equal(m('Totalt fordonsflöde')?.value, expectedFlowTotal, 'totalt fordonsflöde');
  assert.ok(m('Snittfart')?.value > 0, 'snittfart');
  // Regression 2026-11-02: API:ets CountyNo är EJ SCB:s länskoder – kod 1
  // är Stockholm (herledd mot kända stationer + mätargeografi).
  assert.equal(m('Fordonsflöde Stockholm')?.value,
    flowRows.filter(r => r.CountyNo === 1).reduce((a, r) => a + (Number(r.VehicleFlowRate) || 0), 0),
    'länsaggregat (Stockholm, kod 1 i fixturen)');
  assert.doesNotMatch(JSON.stringify(recs), /Blekinge/, 'felaktig SCB-baserad länmappning');
  assert.equal(m('Färjeavgångar')?.value, expectedFerry, 'färjefönstret');
  assert.equal(m('Tågevenemang')?.value, expectedTrains, 'tågevenemang');
  assert.equal(m('Vägväderstationer')?.value, expectedWeather, 'vägväder');
  assert.equal(m('Järnvägsstationer')?.value, 1, 'stationer i drift (A; Cst är prognosticerad)');

  // Flödesmätarna är kartpunkter med mätdata.
  const flowAssets = recs.filter(r => r.t === 'a' && r.type === 'flowmatning');
  assert.equal(flowAssets.length, Math.min(25, expectedFlowSites), 'topp mätare som kartpunkter');
  assert.ok(flowAssets.every(a => a.geometry.type === 'Point' && a.id.startsWith('tv-flow-')));
  assert.match(flowAssets[0].attrs.Fordonsflöde, /fordon\/h/);

  // Följda stationer blir kartpunkter även om de är prognostiserade
  // (ombyggda); den ej följda stationen A visas ej.
  const stAssets = recs.filter(r => r.t === 'a' && r.type === 'station');
  assert.deepEqual(stAssets.map(a => a.name), ['Stockholm C']);
  assert.equal(stAssets[0].attrs['Prognosticerad (ombyggd?)'], 'ja');

  // Färjelinje som händelse (fixturen: Röduppleden).
  const ferryEv = recs.find(r => r.t === 'e' && r.kind === 'färja');
  assert.match(ferryEv.title, /Röduppleden/);

  assert.equal(recs.filter(r => r.t === 'e' && r.kind === 'tåg').length, Math.min(50, expectedTrains),
    'tågevenemang som händelser');
  assert.equal(recs.filter(r => r.t === 'e' && r.kind === 'väglag').length, Math.min(30, expectedRoad),
    'väglagshändelser');
});

test('tick 2: deltavägen (ModifiedTime-fönster) utan fullast', async () => {
  const recs = await kollektorn.fetch();
  assert.ok(Array.isArray(recs) && recs.length > 10, `tick 2, fick ${recs.length}`);
});

test('tick: totalt misslyckande avkastar fel till hälsan', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNRESET (test)'); };
  await assert.rejects(kollektorn.fetch(), /situation|road|flöde|tåg|väder|stationer|färja/);
  mockFetch();
});
