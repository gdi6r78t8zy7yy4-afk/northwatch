// Derived price movement summaries. Comparisons stay within identical units,
// country coverage and source coverage; no currency conversion or thresholds.
export function analyzeEnergyPriceProfile(series) {
  const points = (series?.points ?? [])
    .filter(point => Number.isFinite(Number(point.value)) && Number.isFinite(Date.parse(point.ts ?? '')))
    .slice()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (!points.length) return null;
  const values = points.map(point => Number(point.value));
  let largestStep = null;
  for (let index = 1; index < points.length; index += 1) {
    const change = Number(points[index].value) - Number(points[index - 1].value);
    if (!largestStep || Math.abs(change) > Math.abs(largestStep.change)) {
      largestStep = { change, from: points[index - 1].ts, to: points[index].ts };
    }
  }
  return {
    count: points.length,
    low: Math.min(...values),
    high: Math.max(...values),
    netChange: points.length > 1 ? values.at(-1) - values[0] : null,
    firstAt: points[0].ts,
    lastAt: points.at(-1).ts,
    largestStep,
    negativeIntervals: values.filter(value => value < 0).length,
  };
}

export function buildEnergyPriceSpreadMovements(comparisons = []) {
  const groups = new Map();
  for (const snapshot of comparisons) {
    const at = Date.parse(snapshot.asOf ?? '');
    const unit = String(snapshot.unit ?? '').trim();
    const observations = (snapshot.observations ?? [])
      .filter(item => (item.zone || item.country) && item.source && item.value != null && item.value !== '' && Number.isFinite(Number(item.value)))
      .map(item => ({ zone: String(item.zone ?? item.country), country: String(item.country ?? ''), source: String(item.source) }))
      .sort((a, b) => a.zone.localeCompare(b.zone) || a.source.localeCompare(b.source));
    if (!Number.isFinite(at) || !unit || observations.length < 2 ||
        snapshot.spread == null || !Number.isFinite(Number(snapshot.spread))) continue;
    const coverage = observations.map(item => item.zone + ':' + item.source).join('|');
    const key = unit + '|' + coverage;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(new Date(at).toISOString(), {
      asOf: new Date(at).toISOString(), spread: Number(snapshot.spread),
      unit, markets: observations.map(item => item.zone),
      countries: [...new Set(observations.map(item => item.country).filter(Boolean))],
    });
  }
  const movements = [];
  for (const snapshots of groups.values()) {
    const ordered = [...snapshots.values()].sort((a, b) => a.asOf.localeCompare(b.asOf));
    if (ordered.length < 2) continue;
    const previous = ordered.at(-2), latest = ordered.at(-1);
    movements.push({
      unit: latest.unit, countries: latest.countries,
      previousAsOf: previous.asOf, latestAsOf: latest.asOf,
      previousSpread: previous.spread, latestSpread: latest.spread,
      change: latest.spread - previous.spread,
    });
  }
  return movements.sort((a, b) => b.latestAsOf.localeCompare(a.latestAsOf));
}
