import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnergyOverview } from '../lib/energy.js';
const sources = [
 { id:'svk', name:'Svenska kraftnät', area:1, country:'SE', status:'ok', records:[{t:'m',country:'SE',indicator:'Nettoexport',value:1200,ts:'2026-11-07T08:45:00Z'},{t:'a',country:'NORDIC',type:'flow',attrs:{from:'SE1',to:'FI',mw:500},updated:'2026-11-07T08:45:00Z'}] },
 { id:'statnett', name:'Statnett', area:1, country:'NO', status:'ok', records:[{t:'a',country:'NORDIC',type:'flow',attrs:{from:'NO1',to:'SE3',mw:250},updated:'2026-11-07T08:44:00Z'}] },
 { id:'eds', name:'Energi Data Service', area:1, country:'DK', status:'stale', records:[{t:'m',country:'DK',indicator:'Produktion',value:4000,ts:'2026-11-07T08:30:00Z'}] },
 { id:'nvd', name:'NVD', area:5, country:'NORDIC', status:'ok', records:[{t:'m',value:1}] },
];
test('energy overview includes only energy metrics and flow assets', () => { const out=buildEnergyOverview(sources); assert.equal(out.metrics.length,2); assert.equal(out.flows.length,1); assert.equal(out.coverage.sourceCount,2); });
test('country filter retains country measurements and Nordic flow assets', () => { const out=buildEnergyOverview(sources,{country:'SE'}); assert.deepEqual(out.metrics.map(r=>r.indicator),['Nettoexport']); assert.equal(out.flows.length,2); assert.equal(out.sources.length,1); });
test('missing measurements are not synthesized as zeroes', () => { const out=buildEnergyOverview([{id:'fi',name:'Fingrid',area:1,country:'FI',status:'no_key',records:[]}]); assert.equal(out.metrics.length,0); assert.equal(out.coverage.metricCount,0); assert.equal(out.sources[0].status,'no_key'); });
