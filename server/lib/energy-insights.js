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

const median = values => {
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Statistical deviations are only evaluated when the newest observation is
// recent relative to that series' own median sampling interval. This prevents
// an old last-known value from being presented as a current operational signal.
function baselineObservations(records, generatedAt) {
  const analysisTime = Date.parse(generatedAt);
  if (!Number.isFinite(analysisTime)) return [];
  const groups = new Map();
  for (const r of records.filter(x => x.t === 'm' && x.value != null && x.value !== '' &&
    Number.isFinite(Number(x.value)) && Number.isFinite(Date.parse(x.ts ?? '')))) {
    const key = [r.country, r.source, r.indicator, r.unit].join('|');
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(new Date(Date.parse(r.ts)).toISOString(), r);
  }
  const observations = [];
  for (const samples of groups.values()) {
    const ordered = [...samples.values()].sort((a,b) => Date.parse(a.ts) - Date.parse(b.ts));
    if (ordered.length < 9) continue;
    const latest = ordered.at(-1);
    const latestAt = Date.parse(latest.ts);
    const intervals = ordered.slice(-25).slice(1).map((row, index) =>
      Date.parse(row.ts) - Date.parse(ordered.slice(-25)[index].ts))
      .filter(interval => Number.isFinite(interval) && interval > 0);
    if (!intervals.length) continue;
    const typicalInterval = median(intervals);
    const ageMs = analysisTime - latestAt;
    // Three median intervals tolerate ordinary publication jitter while
    // excluding stale and future-dated samples from current anomaly analysis.
    if (ageMs < 0 || ageMs > typicalInterval * 3) continue;

    // Compare the newest sample with up to 96 earlier samples. Never include
    // the value being tested in its own baseline.
    const baselineRows = ordered.slice(-97, -1);
    if (baselineRows.length < 8) continue;
    const baseline = baselineRows.map(r => Number(r.value));
    const center = median(baseline);
    const mad = median(baseline.map(v => Math.abs(v - center)));
    const value = Number(latest.value);
    const robustZ = mad > 0 ? 0.6745 * (value - center) / mad : null;
    const deviation = Math.abs(value - center);
    // A zero-MAD series is common for flat/rounded feeds. Require a material
    // relative/absolute change instead of dividing by zero.
    const flatSeriesChange = mad === 0 && deviation > Math.max(Math.abs(center) * 0.25, 1);
    if (!(robustZ !== null ? Math.abs(robustZ) >= 3.5 : flatSeriesChange)) continue;
    const direction = value > center ? 'above' : 'below';
    const confidence = baselineRows.length >= 12 ? 'medium' : 'low';
    observations.push({
      id: 'baseline-' + [latest.country, latest.source, latest.indicator].join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      category:'anomaly', severity:'medium', country:latest.country,
      title: latest.indicator + ' is ' + direction + ' its recent baseline',
      summary: 'Latest value ' + value.toLocaleString('sv-SE') + ' ' + latest.unit +
        ' versus a historical median of ' + center.toLocaleString('sv-SE') + ' ' + latest.unit + '.',
      observedAt:latest.ts, confidence,
      caveat:'Statistical deviation only. The latest sample passed a freshness check (within three median sampling intervals). This may reflect normal operating changes, source corrections or data quality; it is not evidence of an outage or security incident.',
      evidence:[
        { indicator:latest.indicator, value:latest.value, unit:latest.unit, ts:latest.ts, source:latest.source },
        { indicator:'Historical median (' + baselineRows.length + ' prior samples)', value:center, unit:latest.unit, ts:baselineRows[0].ts + ' – ' + baselineRows.at(-1).ts, source:latest.source },
        ...(robustZ === null ? [] : [{ indicator:'Robust deviation score', value:Number(robustZ.toFixed(2)), unit:'MAD-z', ts:latest.ts, source:'Northwatch baseline' }]),
      ],
    });
  }
  return observations;
}

function priceSpreadObservation(metrics) {
  const prices = metrics.filter(r => r.t === 'm' && /^Dag-ahead-pris /.test(r.indicator) &&
    r.ts && r.unit && Number.isFinite(Number(r.value)));
  const latestByCountry = new Map();
  for (const row of prices) {
    const country = row.country;
    const old = latestByCountry.get(country);
    if (!old || String(row.ts) > String(old.ts)) latestByCountry.set(country, row);
  }
  const comparable = [...latestByCountry.values()];
  if (comparable.length < 2) return null;
  const newestTs = comparable.reduce((v,r) => String(r.ts) > v ? String(r.ts) : v, '');
  const sameTime = comparable.filter(r => r.ts === newestTs);
  if (sameTime.length < 2 || new Set(sameTime.map(r => r.unit)).size !== 1) return null;
  const low = sameTime.reduce((a,b) => Number(a.value) <= Number(b.value) ? a : b);
  const high = sameTime.reduce((a,b) => Number(a.value) >= Number(b.value) ? a : b);
  const spread = Number(high.value) - Number(low.value);
  return {
    id:'nordic-day-ahead-price-spread', category:'market', severity:'info', country:'NORDIC',
    title:'Nordic day-ahead price spread',
    summary:high.country + ' is ' + spread.toLocaleString('sv-SE') + ' ' + high.unit + ' above ' + low.country + ' in the latest comparable snapshot.',
    observedAt:newestTs, confidence:'medium',
    caveat:'Only countries with a price observation at the exact same timestamp and in the same unit are compared. This is a price spread, not proof of available transfer capacity or congestion.',
    evidence:sameTime.map(r => ({ indicator:r.indicator, value:r.value, unit:r.unit, ts:r.ts, source:r.source })),
  };
}

export function buildEnergyAnalysis(metrics, generatedAt = new Date().toISOString(), historyRecords = []) {
  const latest = new Map();
  for (const r of metrics.filter(x => x.t === 'm' && Number.isFinite(Number(x.value)))) {
    const key = [r.country, r.indicator].join('|');
    const old = latest.get(key);
    if (!old || String(r.ts) > String(old.ts)) latest.set(key, r);
  }
  const observations = [];
  // Compare domestic production and demand for every country that publishes
  // the standardized indicators. Never align samples by proximity: timestamp
  // and unit must match exactly.
  const countries = [...new Set([...latest.values()].map(r => r.country))]
    .filter(country => /^[A-Z]{2}$/.test(country)).sort();
  for (const country of countries) {
    const generation = latest.get(`${country}|Total produktion (${country})`);
    const demand = latest.get(`${country}|Total förbrukning (${country})`);
    if (!generation || !demand || generation.ts !== demand.ts || generation.unit !== demand.unit) continue;
    const gap = Number(generation.value) - Number(demand.value);
    observations.push({
      id:country.toLowerCase() + '-domestic-balance', category:'balance',
      severity:gap < 0 ? 'medium' : 'info', country,
      title:gap < 0 ? country + ' domestic generation below demand' : country + ' domestic generation covers demand',
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
  const balancing = [...latest.values()].filter(r => r.source === 'energinet' && /^Mfrr-efterfrågan DK1\+DK2/.test(r.indicator))
    .sort((a,b) => String(b.ts).localeCompare(String(a.ts)))[0];
  if (balancing) observations.push({
    id:'dk-mfrr-direction', category:'balancing', severity:'info', country:'DK',
    title:Number(balancing.value) > 0 ? 'Danish mFRR signal indicates import-side balancing need' :
      Number(balancing.value) < 0 ? 'Danish mFRR signal indicates export-side balancing direction' : 'Danish mFRR signal is near zero',
    summary:'Energinet reports ' + Number(balancing.value).toLocaleString('sv-SE') + ' ' + balancing.unit + ' for DK1+DK2.',
    observedAt:balancing.ts, confidence:'medium',
    caveat:'Interpretation follows Energinet’s published sign convention (positive = import need). This is a balancing request signal, not a measure of reserve availability or an adequacy forecast.',
    evidence:[{indicator:balancing.indicator,value:balancing.value,unit:balancing.unit,ts:balancing.ts,source:balancing.source}],
  });
  const spread = priceSpreadObservation([...latest.values()]);
  if (spread) observations.push(spread);
  observations.push(...baselineObservations(historyRecords, generatedAt));
  observations.sort((a,b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  return { generatedAt, observations, methodology:'Deterministic source comparisons, comparable day-ahead price snapshots and robust historical baselines. Statistical deviations are signals for review, not inferred incidents or forecasts. Historical-baseline anomalies are evaluated only when the latest sample is within three median sampling intervals.' };
}
