import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnergyOverview } from '../lib/energy.js';
const sources = [
 { id:'svk', name:'Svenska kraftnät', area:1, country:'SE', status:'ok', records:[{t:'m',country:'SE',indicator:'Nettoexport',value:1200,ts:'2026-11-07T08:45:00Z'},{t:'a',country:'NORDIC',type:'flow',attrs:{from:'SE1',to:'FI',mw:500},updated:'2026-11-07T08:45:00Z'}] },
 { id:'statnett', name:'Statnett', area:1, country:'NO', status:'ok', records:[{t:'a',country:'NORDIC',type:'flow',attrs:{from:'NO1',to:'SE3',mw:250},updated:'2026-11-07T08:44:00Z'}] },
 { id:'eds', name:'Energi Data Service', area:1, country:'DK', status:'stale', records:[{t:'m',country:'DK',indicator:'Produktion',value:4000,ts:'2026-11-07T08:30:00Z'}] },
 { id:'nvd', name:'NVD', area:5, country:'NORDIC', status:'ok', records:[{t:'m',value:1}] },
];
test('energy overview includes only energy metrics and flow assets', () => { const out=buildEnergyOverview(sources); assert.equal(out.metrics.length,2); assert.equal(out.flows.length,2); assert.equal(out.coverage.sourceCount,3); });
test('country filter retains country measurements and Nordic flow assets', () => { const out=buildEnergyOverview(sources,{country:'SE'}); assert.deepEqual(out.metrics.map(r=>r.indicator),['Nettoexport']); assert.equal(out.flows.length,2); assert.equal(out.sources.length,1); });
test('energy source health includes collector cadence, run time and duration', () => {
  const out = buildEnergyOverview([{
    id:'svk', name:'Svenska kraftnät', area:1, country:'SE', status:'ok',
    every:300, lastRun:'2026-11-07T10:00:00.000Z', lastOk:'2026-11-07T10:00:00.000Z',
    lastError:null, ms:842, error:null, records:[]
  }]);
  assert.deepEqual(
    { every:out.sources[0].every, lastRun:out.sources[0].lastRun, lastOk:out.sources[0].lastOk, ms:out.sources[0].ms },
    { every:300, lastRun:'2026-11-07T10:00:00.000Z', lastOk:'2026-11-07T10:00:00.000Z', ms:842 }
  );
});

test('missing measurements are not synthesized as zeroes', () => { const out=buildEnergyOverview([{id:'fi',name:'Fingrid',area:1,country:'FI',status:'no_key',records:[]}]); assert.equal(out.metrics.length,0); assert.equal(out.coverage.metricCount,0); assert.equal(out.sources[0].status,'no_key'); });

import { buildEnergyMarketComparisons } from '../lib/energy.js';

test('market comparisons only compare same timestamp and unit across countries', () => {
  const rows = [
    { indicator:'Dag-ahead-pris SE', country:'SE', value:40, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
    { indicator:'Dag-ahead-pris NO', country:'NO', value:25, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
    { indicator:'Dag-ahead-pris FI', country:'FI', value:70, unit:'EUR/MWh', ts:'2026-11-07T10:15:00Z' },
    { indicator:'Dag-ahead-pris DK', country:'DK', value:300, unit:'DKK/MWh', ts:'2026-11-07T10:00:00Z' },
  ];
  const out = buildEnergyMarketComparisons(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].countryCount, 2);
  assert.equal(out[0].unit, 'EUR/MWh');
  assert.equal(out[0].low.country, 'NO');
  assert.equal(out[0].high.country, 'SE');
  assert.equal(out[0].spread, 15);
});

test('market comparisons reject invalid measurements and de-duplicate country snapshots', () => {
  const rows = [
    { indicator:'Dag-ahead-pris SE', country:'SE', value:40, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
    { indicator:'Dag-ahead-pris SE', country:'SE', value:42, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
    { indicator:'Dag-ahead-pris NO', country:'NO', value:'invalid', unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z' },
    { indicator:'Dag-ahead-pris DK', country:'DK', value:300, unit:'DKK/MWh', ts:'invalid' },
  ];
  assert.deepEqual(buildEnergyMarketComparisons(rows), []);
});

test('market comparisons are ordered newest first and retain source provenance', () => {
  const rows = [
    { indicator:'Dag-ahead-pris SE', country:'SE', value:30, unit:'EUR/MWh', ts:'2026-11-07T09:00:00Z', source:'entsoe', sourceName:'ENTSO-E' },
    { indicator:'Dag-ahead-pris NO', country:'NO', value:20, unit:'EUR/MWh', ts:'2026-11-07T09:00:00Z', source:'entsoe', sourceName:'ENTSO-E' },
    { indicator:'Dag-ahead-pris SE', country:'SE', value:40, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z', source:'entsoe', sourceName:'ENTSO-E' },
    { indicator:'Dag-ahead-pris NO', country:'NO', value:35, unit:'EUR/MWh', ts:'2026-11-07T10:00:00Z', source:'entsoe', sourceName:'ENTSO-E' },
  ];
  const out = buildEnergyMarketComparisons(rows);
  assert.equal(out.length, 2);
  assert.ok(out[0].asOf > out[1].asOf);
  assert.equal(out[0].observations[0].sourceName, 'ENTSO-E');
});
