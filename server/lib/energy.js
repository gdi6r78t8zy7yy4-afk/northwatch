// Read-only aggregation for the dedicated energy dashboard.
// Missing measurements remain missing; this layer never synthesizes zeroes.
export function buildEnergyOverview(sources, { country = 'ALL', generatedAt = new Date().toISOString() } = {}) {
  const selected = String(country || 'ALL').toUpperCase();
  const relevant = sources.filter(s => s.area === 1 && (selected === 'ALL' || s.country === selected || s.country === 'NORDIC'));
  const metrics = relevant.flatMap(s => (s.records ?? []).filter(r => r.t === 'm' && (selected === 'ALL' || r.country === selected || r.country === 'NORDIC')).map(r => ({ ...r, sourceName: s.name, sourceStatus: s.status })));
  const flows = relevant.flatMap(s => (s.records ?? []).filter(r => r.t === 'a' && r.type === 'flow').map(r => ({ ...r, sourceName: s.name, sourceStatus: s.status })));
  metrics.sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
  flows.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
  const sourceHealth = relevant.map(s => ({ id: s.id, name: s.name, country: s.country, status: s.status, every: s.every, lastOk: s.lastOk, lastError: s.lastError, error: s.error, records: (s.records ?? []).length }));
  return { generatedAt, country: selected, metrics, flows, sources: sourceHealth,
    coverage: { sourceCount: relevant.length, reportingSources: relevant.filter(s => s.status === 'ok' || s.status === 'stale').length, metricCount: metrics.length, flowCount: flows.length, countries: [...new Set(relevant.map(s => s.country))].sort() } };
}
