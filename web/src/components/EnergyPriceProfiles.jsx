import React, { useMemo, useState } from 'react';
import { analyzeEnergyPriceProfile, analyzeEnergyPriceProfileCoverage } from '../lib/energyPriceAnalysis.js';

const DAY_AHEAD_PREFIX = /^Dag-ahead-pris\s+/;
const formatClock = value => new Intl.DateTimeFormat('sv-SE', {
  hour:'2-digit', minute:'2-digit', timeZone:'UTC',
}).format(new Date(value));

export function buildEnergyPriceProfiles(metrics, { now = Date.now(), horizonHours = 24, pastMinutes = 120 } = {}) {
  const start = now - pastMinutes * 60_000;
  const end = now + horizonHours * 3_600_000;
  const groups = new Map();
  for (const row of metrics) {
    if (!DAY_AHEAD_PREFIX.test(row.indicator ?? '') || row.value == null || !row.unit) continue;
    const value = Number(row.value);
    const at = Date.parse(row.ts ?? '');
    if (!Number.isFinite(value) || !Number.isFinite(at) || at < start || at > end) continue;
    const key = [row.country, row.indicator, row.source, row.unit].join('|');
    if (!groups.has(key)) groups.set(key, {
      key, country:row.country, label:row.indicator.replace(DAY_AHEAD_PREFIX, ''),
      source:row.sourceName ?? row.source, unit:row.unit, points:[],
    });
    const group = groups.get(key);
    if (!group.points.some(point => point.ts === row.ts)) group.points.push({ ts:row.ts, at, value });
  }
  return [...groups.values()].map(group => ({
    ...group,
    points:group.points.sort((a,b) => a.at - b.at),
  })).filter(group => group.points.length).sort((a,b) =>
    String(a.country).localeCompare(String(b.country)) || a.label.localeCompare(b.label));
}

function formatAxisTime(value) {
  return new Intl.DateTimeFormat('sv-SE', {
    day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'UTC',
  }).format(new Date(value));
}

function PriceProfile({ series }) {
  const points = series.points;
  const values = points.map(point => point.value);
  const min = Math.min(...values), max = Math.max(...values);
  const rawSpan = max - min;
  const span = rawSpan || Math.max(Math.abs(max) * 0.1, 1);
  const low = min - span * 0.08, high = max + span * 0.08;
  const plot = { left:48, right:350, top:12, bottom:136 };
  const x = at => plot.left + (at - points[0].at) / Math.max(1, points.at(-1).at - points[0].at) * (plot.right - plot.left);
  const y = value => plot.bottom - (value - low) / (high - low) * (plot.bottom - plot.top);
  const path = points.map((point,index) => (index ? 'L' : 'M') + x(point.at).toFixed(1) + ' ' + y(point.value).toFixed(1)).join(' ');
  const yTicks = [0, 1, 2, 3].map(index => low + (high - low) * index / 3);
  const xTickIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const analysis = analyzeEnergyPriceProfile(series);
  const coverage = analyzeEnergyPriceProfileCoverage(series);
  const formatGap = value => {
    if (value == null) return 'Unavailable';
    const minutes = value / 60_000;
    if (minutes < 60) return `${Number(minutes.toFixed(1))} min`;
    const hours = minutes / 60;
    return `${Number(hours.toFixed(1))} h`;
  };
  const formatDelta = value => (value > 0 ? '+' : '') + value.toLocaleString('sv-SE', { maximumFractionDigits:2 });
  const formatValue = value => value.toLocaleString('sv-SE', { maximumFractionDigits:2 });
  return <article className="energy-price-profile">
    <div className="energy-price-profile-head"><b>{series.country} · {series.label}</b><span>{series.source}</span></div>
    <svg viewBox="0 0 380 178" role="img"
      aria-label={series.country + ' ' + series.label + ' day-ahead price profile. X-axis: date and time UTC. Y-axis: price in ' + series.unit}>
      {yTicks.map((tick,index) => <g key={index}>
        <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" opacity=".16"/>
        <text x={plot.left - 7} y={y(tick) + 3} textAnchor="end" className="energy-price-axis-tick">{formatValue(tick)}</text>
      </g>)}
      <path d={`M${plot.left} ${plot.bottom} H${plot.right}`} stroke="currentColor" opacity=".45" fill="none"/>
      {points.length > 1 ? <path d={path} stroke="#68a9e8" strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round"/> : null}
      {points.map(point => <circle key={point.ts} cx={x(point.at)} cy={y(point.value)} r="3" fill="#68a9e8">
        <title>{formatAxisTime(point.at)} UTC · {formatValue(point.value)} {series.unit}</title>
      </circle>)}
      {xTickIndices.map(index => <text key={index} x={x(points[index].at)} y="151"
        textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
        className="energy-price-axis-tick">{formatAxisTime(points[index].at)}</text>)}
      <text x={(plot.left + plot.right) / 2} y="172" textAnchor="middle" className="energy-price-axis-title">Date / time (UTC)</text>
      <text transform="translate(10 74) rotate(-90)" textAnchor="middle" className="energy-price-axis-title">Price ({series.unit})</text>
    </svg>
    <div className="energy-price-profile-range"><span>{formatClock(points[0].at)}</span><b>{formatValue(Math.min(...values))} – {formatValue(Math.max(...values))} {series.unit}</b><span>{formatClock(points.at(-1).at)}</span></div>
    <div className="mut">{points.length} delivery interval{points.length === 1 ? '' : 's'} · {series.source}</div>
    <div className="energy-price-profile-analysis" aria-label="Price movement analysis">
      {analysis.netChange === null
        ? <span>Movement: one published interval only</span>
        : <span>First-to-last movement: <b>{formatDelta(analysis.netChange)} {series.unit}</b></span>}
      {analysis.largestStep ? <span>Largest adjacent move: <b>{formatDelta(analysis.largestStep.change)} {series.unit}</b>
        <small>{formatClock(analysis.largestStep.from)} → {formatClock(analysis.largestStep.to)} UTC</small></span> : null}
      {analysis.negativeIntervals > 0 ? <span>Negative-price intervals: <b>{analysis.negativeIntervals}</b></span> : null}
    </div>
    <div className="energy-price-profile-coverage" aria-label="Observation coverage diagnostics">
      <span>Latest observation: <b>{formatAxisTime(Date.parse(coverage.latestObservationTs))} UTC</b></span>
      <span>Typical spacing: <b>{formatGap(coverage.typicalGapMs)}</b></span>
      <span>Largest gap: <b>{formatGap(coverage.largestGapMs)}</b></span>
      {coverage.largeGapCount > 0 ? <span className="energy-price-gap-warning">Unusually large gaps: <b>{coverage.largeGapCount}</b></span> : null}
    </div>
  </article>;
}

const HORIZONS = [6, 12, 24, 48];

export default function EnergyPriceProfiles({ metrics = [], now = Date.now() }) {
  const [horizonHours, setHorizonHours] = useState(24);
  const profiles = useMemo(() => buildEnergyPriceProfiles(metrics, { now, horizonHours }), [metrics, now, horizonHours]);
  return <section className="energy-price-profiles" aria-label="Day-ahead price profiles">
    <div className="energy-price-profiles-heading">
      <div><h4>Current & next {horizonHours} hours</h4>
        <span className="mut">Delivery interval timestamps · UTC · source units retained</span></div>
      <label className="energy-price-horizon-control">Time range
        <select aria-label="Price profile time range" value={horizonHours}
          onChange={event => setHorizonHours(Number(event.target.value))}>
          {HORIZONS.map(hours => <option key={hours} value={hours}>{hours} hours</option>)}
        </select>
      </label>
    </div>
    {profiles.length ? <div className="energy-price-profiles-grid">
      {profiles.map(series => <PriceProfile key={series.key} series={series}/>)}
    </div> : <p className="mut">No current or upcoming day-ahead delivery intervals are available in this time range.</p>}
    <p className="mut energy-price-profiles-note">Each bidding-zone series is plotted independently. Different currencies, units and sources are not combined. The line connects published interval values; it is not a forecast beyond the source's published day-ahead schedule. Gap diagnostics compare spacing with the median observed interval in each series (large gap = more than 1.5× that median); they do not assume a fixed delivery cadence or infer missing values.</p>
  </section>;
}
