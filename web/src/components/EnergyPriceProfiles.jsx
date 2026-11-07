import React, { useMemo, useState } from 'react';
import { analyzeEnergyPriceProfile } from '../lib/energyPriceAnalysis.js';

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

function PriceProfile({ series }) {
  const points = series.points;
  const values = points.map(point => point.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
  const x = at => 12 + (at - points[0].at) / Math.max(1, points.at(-1).at - points[0].at) * 276;
  const y = value => 70 - (value - min) / span * 54;
  const path = points.map((point,index) => (index ? 'L' : 'M') + x(point.at).toFixed(1) + ' ' + y(point.value).toFixed(1)).join(' ');
  const low = Math.min(...values), high = Math.max(...values);
  const analysis = analyzeEnergyPriceProfile(series);
  const formatDelta = value => (value > 0 ? '+' : '') + value.toLocaleString('sv-SE', { maximumFractionDigits:2 });
  return <article className="energy-price-profile">
    <div className="energy-price-profile-head"><b>{series.country} · {series.label}</b><span>{series.source}</span></div>
    <svg viewBox="0 0 300 88" role="img" aria-label={series.country + ' ' + series.label + ' day-ahead price profile'}>
      <path d="M12 70 H288 M12 43 H288 M12 16 H288" stroke="currentColor" opacity=".14" fill="none"/>
      {points.length > 1 ? <path d={path} stroke="#68a9e8" strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round"/> : null}
      {points.map((point,index) => <circle key={point.ts} cx={x(point.at)} cy={y(point.value)} r="3" fill="#68a9e8">
        <title>{formatClock(point.at)} · {point.value.toLocaleString('sv-SE')} {series.unit}</title>
      </circle>)}
    </svg>
    <div className="energy-price-profile-range"><span>{formatClock(points[0].at)}</span><b>{low.toLocaleString('sv-SE',{maximumFractionDigits:2})} – {high.toLocaleString('sv-SE',{maximumFractionDigits:2})} {series.unit}</b><span>{formatClock(points.at(-1).at)}</span></div>
    <div className="mut">{points.length} delivery interval{points.length === 1 ? '' : 's'} · {series.source}</div>
    <div className="energy-price-profile-analysis" aria-label="Price movement analysis">
      {analysis.netChange === null
        ? <span>Movement: one published interval only</span>
        : <span>First-to-last movement: <b>{formatDelta(analysis.netChange)} {series.unit}</b></span>}
      {analysis.largestStep ? <span>Largest adjacent move: <b>{formatDelta(analysis.largestStep.change)} {series.unit}</b>
        <small>{formatClock(analysis.largestStep.from)} → {formatClock(analysis.largestStep.to)} UTC</small></span> : null}
      {analysis.negativeIntervals > 0 ? <span>Negative-price intervals: <b>{analysis.negativeIntervals}</b></span> : null}
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
    <p className="mut energy-price-profiles-note">Each bidding-zone series is plotted independently. Different currencies, units and sources are not combined. The line connects published interval values; it is not a forecast beyond the source's published day-ahead schedule.</p>
  </section>;
}
