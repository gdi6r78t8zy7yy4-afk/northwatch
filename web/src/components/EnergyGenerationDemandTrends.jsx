import React from 'react';

const GENERATION = /^Total produktion \(([A-Z]{2})\)$/;
const CONSUMPTION = /^(Total förbrukning \(([A-Z]{2})\)|Beräknad förbrukning \(([A-Z]{2}),?[^)]*\))/;
const RENEWABLE = /^(Vindproduktion|Solproduktion|Vattenkraftproduktion|Geotermisk produktion|Förnybar produktion|Vind\+sol-produktion)/;

export function filterRenewableGenerationSeries(series = []) {
  return series.filter(item => RENEWABLE.test(item.indicator ?? ''));
}

function renewableTechnology(indicator) {
  if (indicator.startsWith('Vind+sol-')) return 'Wind + solar';
  if (indicator.startsWith('Vindproduktion')) return 'Wind';
  if (indicator.startsWith('Solproduktion')) return 'Solar';
  if (indicator.startsWith('Vattenkraftproduktion')) return 'Hydro';
  if (indicator.startsWith('Geotermisk produktion')) return 'Geothermal';
  if (indicator.startsWith('Förnybar produktion')) return 'Renewable total';
  return 'Renewable';
}

export function buildEnergyGenerationDemandTrends(series = []) {
  const rows = [];
  for (const item of series) {
    const indicator = item.indicator ?? '';
    const generation = GENERATION.test(indicator);
    const consumption = CONSUMPTION.test(indicator);
    const renewable = RENEWABLE.test(indicator);
    if (!generation && !consumption && !renewable) continue;
    const byTimestamp = new Map();
    for (const point of item.points ?? []) {
      if (point.value == null || point.value === '' || !Number.isFinite(Number(point.value))) continue;
      const at = Date.parse(point.ts ?? '');
      if (!Number.isFinite(at)) continue;
      byTimestamp.set(at, { ts: new Date(at).toISOString(), value: Number(point.value) });
    }
    const points = [...byTimestamp.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    if (points.length < 2) continue;
    const first = points[0], latest = points.at(-1);
    const delta = latest.value - first.value;
    rows.push({
      country: item.country,
      source: item.source,
      indicator,
      unit: item.unit,
      kind: generation ? 'Production' : renewable ? 'Renewable generation' : 'Consumption',
      technology: renewable ? renewableTechnology(indicator) : null,
      derived: indicator.startsWith('Beräknad förbrukning') ||
        (item.country === 'NO' && consumption && item.source === 'statnett'),
      first, latest, delta,
      percent: first.value === 0 ? null : delta / Math.abs(first.value) * 100,
      renewableShare: null,
      elapsedMs: Date.parse(latest.ts) - Date.parse(first.ts),
      count: points.length,
    });
  }

  // A technology share is shown only against total production from the same
  // country, source, timestamp and unit. No interpolation or cross-source join.
  for (const row of rows) {
    if (row.kind !== 'Renewable generation') continue;
    const total = rows.find(candidate => candidate.kind === 'Production' &&
      candidate.country === row.country && candidate.source === row.source &&
      candidate.latest.ts === row.latest.ts && candidate.unit === row.unit);
    if (total && total.latest.value > 0) {
      row.renewableShare = row.latest.value / total.latest.value * 100;
    }
  }

  const order = { Production: 0, Consumption: 1, 'Renewable generation': 2 };
  return rows.sort((a, b) => String(a.country).localeCompare(String(b.country)) ||
    order[a.kind] - order[b.kind] || String(a.technology ?? '').localeCompare(String(b.technology ?? '')) ||
    String(a.source).localeCompare(String(b.source)));
}

const fmt = value => Number(value).toLocaleString('sv-SE', { maximumFractionDigits: 1 });
const elapsed = ms => {
  const hours = ms / 3600000;
  if (hours < 1) return Math.round(ms / 60000) + ' min';
  if (hours < 48) return fmt(hours) + ' h';
  return fmt(hours / 24) + ' d';
};

export default function EnergyGenerationDemandTrends({ series = [] }) {
  const rows = buildEnergyGenerationDemandTrends(series);
  return <section className="card energy-generation-history">
    <div className="energy-section-head"><div>
      <h2>Historical generation & consumption trends</h2>
      <div className="mut">Change from the first to the latest recorded observation in the selected history window. Each source series is kept separate.</div>
    </div><span className="tag">{rows.length} series</span></div>
    {rows.length ? <div className="energy-generation-history-grid">{rows.map(row => {
      const direction = row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'flat';
      return <article className="energy-generation-history-row" key={[row.country,row.source,row.indicator,row.unit].join('|')}>
        <div className="energy-generation-history-title">
          <b>{row.country} · {row.kind === 'Renewable generation' ? row.technology : row.kind}</b>
          <span className={'energy-price-movement-direction ' + direction}>{row.delta > 0 ? '▲' : row.delta < 0 ? '▼' : '—'} {row.delta > 0 ? '+' : ''}{fmt(row.delta)} {row.unit}</span>
        </div>
        <div className="energy-generation-history-values">
          <span>First <b>{fmt(row.first.value)} {row.unit}</b></span>
          <span>Latest <b>{fmt(row.latest.value)} {row.unit}</b></span>
          <span>Change <b>{row.percent == null ? '—' : (row.percent > 0 ? '+' : '') + fmt(row.percent) + '%'}</b></span>
        </div>
        {row.kind === 'Renewable generation' ? <div className="mut">
          {row.renewableShare == null ? 'Share of total production unavailable · requires same-source, same-time, same-unit total production'
            : fmt(row.renewableShare) + '% of total production at the latest aligned observation'}
        </div> : null}
        <div className="mut">{row.source} · {row.count} observations · {elapsed(row.elapsedMs)} · {row.latest.ts}</div>
        {row.derived ? <div className="energy-derived-label">Derived measurement · see methodology</div> : null}
      </article>;
    })}</div> : <p className="mut">No production or consumption series have at least two valid observations in this history window. More collector snapshots are needed.</p>}
    <div className="mut energy-generation-history-note">
      Historical change is calculated within each individual country/source/indicator/unit series; no cross-country aggregation or interpolation is performed. Renewable technologies are shown only where the source reports them: wind and solar in Denmark, wind and hydro in Finland, and hydro/geothermal in Iceland. Shares require exact timestamp and unit alignment with total production. Norwegian consumption is derived from production and exchange. Danish SCADA consumption is derived from production and net exchange. Iceland currently has generation data but no consumption series in this dashboard.
    </div>
  </section>;
}
