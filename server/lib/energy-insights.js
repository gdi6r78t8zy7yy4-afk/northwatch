const RANGE_MS = { '6h': 6*3600_000, '24h': 24*3600_000, '7d': 7*86400_000, '30d': 30*86400_000 };
export function parseEnergyRange(value = '24h', now = Date.now()) {
  const range = RANGE_MS[value] ? value : '24h';
  return { range, from: new Date(now - RANGE_MS[range]).toISOString(), to: new Date(now).toISOString() };
}
export function buildEnergyHistory(records, { country = 'ALL', indicator = null, range = '24h' } = {}) {
  const selected = String(country).toUpperCase();
  const filtered = records.filter(r => r.t === 'm' && (selected === 'ALL' || r.country === selected || r.country === 'NORDIC') &&
    (!indicator || r.indicator === indicator));
  const seriesMap = new Map();
  for (const r of filtered) {
    const key = [r.country, r.source, r.indicator, r.unit].join('|');
    if (!seriesMap.has(key)) seriesMap.set(key, { country:r.country, indicator:r.indicator, unit:r.unit, source:r.source, points:[] });
    seriesMap.get(key).points.push({ ts:r.ts, value:Number(r.value) });
  }
  const series = [...seriesMap.values()].map(s => ({ ...s, points:s.points.sort((a,b)=>a.ts.localeCompare(b.ts)) }));
  return { range, country:selected, count:filtered.length, series };
}
export function buildEnergyAnalysis(metrics, generatedAt = new Date().toISOString()) {
  const latest = new Map();
  for (const r of metrics.filter(x => x.t === 'm' && Number.isFinite(Number(x.value)))) {
    const key = [r.country, r.indicator].join('|');
    const old = latest.get(key);
    if (!old || String(r.ts) > String(old.ts)) latest.set(key, r);
  }
  const observations = [];
  const generation = latest.get('DK|Total produktion (DK)');
  const demand = latest.get('DK|Total förbrukning (DK)');
  if (generation && demand && generation.ts === demand.ts && generation.unit === demand.unit) {
    const gap = Number(generation.value) - Number(demand.value);
    observations.push({
      id:'dk-domestic-balance', category:'balance', severity:gap < 0 ? 'medium' : 'info',
      country:'DK', title:gap < 0 ? 'Domestic generation below demand' : 'Domestic generation covers demand',
      summary:'Reported production minus consumption: ' + Math.round(gap).toLocaleString('sv-SE') + ' ' + generation.unit + '.',
      observedAt:generation.ts, confidence:'medium',
      caveat:'This is a domestic production-demand comparison, not a system adequacy assessment. Cross-border imports, exports, losses and other balancing resources are not included.',
      evidence:[{indicator:generation.indicator,value:generation.value,unit:generation.unit,ts:generation.ts,source:generation.source},
        {indicator:demand.indicator,value:demand.value,unit:demand.unit,ts:demand.ts,source:demand.source}],
    });
  }
  const exportMetric = latest.get('SE|Svensk nettoexport (SE1–SE4)');
  if (exportMetric) observations.push({
    id:'se-net-export', category:'cross-border', severity:'info', country:'SE',
    title:Number(exportMetric.value) >= 0 ? 'Sweden is a net exporter in the reported snapshot' : 'Sweden is a net importer in the reported snapshot',
    summary:'Reported net exchange: ' + Number(exportMetric.value).toLocaleString('sv-SE') + ' ' + exportMetric.unit + '.',
    observedAt:exportMetric.ts, confidence:'medium',
    caveat:'Collector sign convention and timestamp apply; this is not a forecast or a complete Nordic system balance.',
    evidence:[{indicator:exportMetric.indicator,value:exportMetric.value,unit:exportMetric.unit,ts:exportMetric.ts,source:exportMetric.source}],
  });
  return { generatedAt, observations, methodology:'Deterministic comparisons of source measurements only. No inferred incidents, forecasts or external LLM-generated assessments.' };
}
