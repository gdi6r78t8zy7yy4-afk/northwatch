import React from 'react';

function buildEnergyPriceMovements(series = []) {
  return series.filter(item => /^Dag-ahead-pris\s+/.test(item.indicator ?? ''))
    .map(item => {
      const points = (item.points ?? []).filter(point =>
        Number.isFinite(Number(point.value)) && Number.isFinite(Date.parse(point.ts ?? '')))
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      if (points.length < 2) return null;
      const previous = points.at(-2), latest = points.at(-1);
      const previousValue = Number(previous.value), latestValue = Number(latest.value);
      const delta = latestValue - previousValue;
      const percent = previousValue === 0 ? null : delta / Math.abs(previousValue) * 100;
      const elapsedMs = Date.parse(latest.ts) - Date.parse(previous.ts);
      if (!(elapsedMs > 0)) return null;
      return {
        country: item.country, source: item.source, indicator: item.indicator,
        unit: item.unit, previous, latest, delta, percent, elapsedMs,
      };
    }).filter(Boolean)
    .sort((a, b) => {
      if (a.percent == null && b.percent != null) return 1;
      if (a.percent != null && b.percent == null) return -1;
      return Math.abs(b.percent ?? b.delta) - Math.abs(a.percent ?? a.delta);
    });
}

const fmt = value => Number(value).toLocaleString('sv-SE', { maximumFractionDigits: 3 });
const fmtGap = ms => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return minutes + ' min';
  const hours = minutes / 60;
  return Number.isInteger(hours) ? hours + ' h' : hours.toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ' h';
};

export { buildEnergyPriceMovements };

export default function EnergyPriceMovementAnalysis({ series = [] }) {
  const movements = buildEnergyPriceMovements(series).slice(0, 6);
  return <section className="energy-price-movement" aria-label="Historical day-ahead price movements">
    <div className="energy-price-movement-heading">
      <div><h3>Largest observed price movements</h3>
        <p className="mut">Latest two stored observations within each source, country, bidding-zone and unit series.</p></div>
      <span className="mut">{movements.length} series</span>
    </div>
    {movements.length ? <div className="energy-price-movement-grid">{movements.map(item => {
      const direction = item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : 'unchanged';
      return <article className="energy-price-movement-row" key={[item.country,item.source,item.indicator,item.unit].join('|')}>
        <div className="energy-price-movement-title"><b>{item.country} · {item.indicator.replace(/^Dag-ahead-pris\s+/, '')}</b>
          <span className={'energy-price-movement-direction ' + direction}>{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'} {fmt(item.delta)} {item.unit}</span></div>
        <div className="energy-price-movement-values">
          <span>Previous <b>{fmt(item.previous.value)}</b></span>
          <span>Latest <b>{fmt(item.latest.value)}</b></span>
          <span>Change <b>{item.percent == null ? '—' : (item.percent > 0 ? '+' : '') + fmt(item.percent) + '%'}</b></span>
        </div>
        <div className="mut">{item.source} · {fmtGap(item.elapsedMs)} between observations · {item.latest.ts}</div>
      </article>;
    })}</div> : <p className="mut">Not enough historical day-ahead price observations to calculate movements. At least two timestamped observations in the same series are required.</p>}
    <p className="mut energy-price-movement-note">Changes compare only the latest two recorded points in the same series. The time gap is shown because observations may be non-consecutive. Percentage change is omitted when the previous value is zero. This is a descriptive movement signal, not a forecast or evidence of market stress.</p>
  </section>;
}
