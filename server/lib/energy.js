// Read-only aggregation for the dedicated energy dashboard.
// Missing measurements remain missing; this layer never synthesizes zeroes.

export function buildEnergyMarketComparisons(metrics) {
  const groups = new Map();
  for (const row of metrics) {
    if (!/^Dag-ahead-pris\s+/.test(row.indicator ?? '') || row.value == null) continue;
    const value = Number(row.value);
    const at = Date.parse(row.ts ?? '');
    const unit = String(row.unit ?? '').trim();
    const country = String(row.country ?? '').toUpperCase();
    if (!Number.isFinite(value) || !Number.isFinite(at) || !unit || !/^[A-Z]{2}$/.test(country)) continue;
    const zone = String(row.indicator).replace(/^Dag-ahead-pris\\s+/, '').trim();
    if (!zone) continue;
    const key = `${at}|${unit}`;
    if (!groups.has(key)) groups.set(key, { at, unit, observations: new Map() });
    const group = groups.get(key);
    // Keep each bidding zone distinct (e.g. SE1–SE4). A country may report
    // several zones at the same instant; collapsing by country hides them.
    // Keep the first record per zone; overview metrics are newest-first.
    if (!group.observations.has(zone)) {
      group.observations.set(zone, {
        zone, country, value, unit, ts: row.ts,
        source: row.source, sourceName: row.sourceName ?? row.source,
      });
    }
  }

  return [...groups.values()]
    .filter(group => group.observations.size >= 2)
    .map(group => {
      const observations = [...group.observations.values()].sort((a, b) => a.country.localeCompare(b.country));
      const ordered = [...observations].sort((a, b) => a.value - b.value);
      const low = ordered[0], high = ordered[ordered.length - 1];
      return {
        asOf: new Date(group.at).toISOString(),
        unit: group.unit,
        zoneCount: observations.length,
        low: { zone: low.zone, country: low.country, value: low.value },
        high: { zone: high.zone, country: high.country, value: high.value },
        spread: high.value - low.value,
        observations,
      };
    })
    .sort((a, b) => b.asOf.localeCompare(a.asOf));
}

export function buildEnergyOverview(sources, { country = 'ALL', generatedAt = new Date().toISOString() } = {}) {
  const selected = String(country || 'ALL').toUpperCase();
  const relevant = sources.filter(s => s.area === 1 && (selected === 'ALL' || s.country === selected || s.country === 'NORDIC'));
  const metrics = relevant.flatMap(s => (s.records ?? []).filter(r => r.t === 'm' && (selected === 'ALL' || r.country === selected || r.country === 'NORDIC')).map(r => ({ ...r, sourceName: s.name, sourceStatus: s.status })));
  // Nordic interconnector assets are tagged NORDIC but owned by a country collector;
  // retain the complete regional network even when a country filter is selected.
  const flows = sources.filter(s => s.area === 1).flatMap(s => (s.records ?? []).filter(r => r.t === 'a' && r.type === 'flow').map(r => ({ ...r, sourceName: s.name, sourceStatus: s.status })));
  metrics.sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
  flows.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
  const sourceHealth = relevant.map(s => ({ id: s.id, name: s.name, country: s.country, status: s.status, every: s.every, lastRun: s.lastRun ?? null, lastOk: s.lastOk ?? null, lastError: s.lastError ?? null, ms: s.ms ?? null, error: s.error ?? null, records: (s.records ?? []).length }));
  return { generatedAt, country: selected, metrics, flows, marketComparisons: buildEnergyMarketComparisons(metrics),
    sources: sourceHealth,
    coverage: { sourceCount: relevant.length, reportingSources: relevant.filter(s => s.status === 'ok' || s.status === 'stale').length, metricCount: metrics.length, flowCount: flows.length, countries: [...new Set(relevant.map(s => s.country))].sort() } };
}
