import React from 'react';
import { fmtTime } from '../status.js';
import { formatObservationAge } from '../lib/metricFreshness.js';

// Delad trendgraf för energidashboardens widget- och modal-vyer. Ritar en
// serie som SVG; ogiltiga observationer utesläs öppet, inga skattningar.
export default function TrendChart({ series }) {
  const rawPoints = Array.isArray(series.points) ? series.points : [];
  const points = rawPoints
    .filter(point => point?.value != null && point.value !== '' &&
      Number.isFinite(Number(point.value)) && Number.isFinite(Date.parse(point.ts ?? '')))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const omittedCount = rawPoints.length - points.length;
  if (points.length < 2) return <div className="energy-chart-empty">Otillräcklig historik · {points.length} observation(er){omittedCount ? ` · ${omittedCount} ogiltiga observationer uteslutna` : ''}</div>;
  const values = points.map(p => Number(p.value));
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const plot = { left: 52, right: 344, top: 18, bottom: 104 };
  const xFor = index => plot.left + index / (points.length - 1) * (plot.right - plot.left);
  const yFor = value => plot.bottom - (Number(value) - min) / span * (plot.bottom - plot.top);
  const path = points.map((point, index) =>
    (index ? 'L' : 'M') + xFor(index).toFixed(1) + ' ' + yFor(point.value).toFixed(1)
  ).join(' ');
  const first = points[0], last = points[points.length - 1];
  const delta = Number(last.value) - Number(first.value);
  const ticks = [0, 0.5, 1].map(ratio => ({
    y: plot.bottom - ratio * (plot.bottom - plot.top),
    value: min + ratio * (max - min),
  }));
  const formatValue = value => Number(value).toLocaleString('sv-SE', { maximumFractionDigits: 1 });
  const formatAxisTime = timestamp => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('sv-SE', {
      timeZone: 'UTC', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };
  return <div className="energy-chart">
    <div className="energy-chart-meta"><b>{series.indicator}</b><span>{series.country} · {series.source} · {series.unit}</span></div>
    <div className="mut energy-chart-freshness">Senaste observation: {formatObservationAge(last.ts)} · {fmtTime(last.ts)}</div>
    {omittedCount > 0 ? <div className="mut energy-chart-warning">{omittedCount} ogiltiga observationer uteslutna från grafen (saknar tidsstämpel eller numeriskt värde).</div> : null}
    <svg viewBox="0 0 360 142" role="img"
      aria-label={series.indicator + ' historisk trend, värderaxel i ' + series.unit + ', tidsaxel i UTC'}>
      <title>{series.indicator} · {series.country} · {series.unit}</title>
      <text x="4" y="11" fill="currentColor" fontSize="9">{series.unit}</text>
      {ticks.map(tick => <g key={tick.y}>
        <line x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y}
          stroke="currentColor" opacity=".18" strokeDasharray="2 3"/>
        <text x={plot.left - 7} y={tick.y + 3} textAnchor="end" fill="currentColor" opacity=".75" fontSize="9">
          {formatValue(tick.value)}
        </text>
      </g>)}
      <path d={path} stroke="#68a9e8" strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((point, index) => <circle key={point.ts ?? index}
        cx={xFor(index)} cy={yFor(point.value)} r={points.length > 80 ? 1.8 : 2.8}
        fill="#68a9e8">
        <title>{fmtTime(point.ts)} · {formatValue(point.value)} {series.unit}</title>
      </circle>)}
      <text x={plot.left} y="120" textAnchor="start" fill="currentColor" opacity=".8" fontSize="9">
        {formatAxisTime(first.ts)}
      </text>
      <text x={plot.right} y="120" textAnchor="end" fill="currentColor" opacity=".8" fontSize="9">
        {formatAxisTime(last.ts)}
      </text>
      <text x={(plot.left + plot.right) / 2} y="137" textAnchor="middle" fill="currentColor" opacity=".7" fontSize="9">
        Tid (UTC)
      </text>
    </svg>
    <div className="energy-chart-values"><span>{formatValue(first.value)} {series.unit}</span><b>{formatValue(last.value)} {series.unit}</b></div>
    <div className="mut">Förändring {delta > 0 ? '+' : ''}{formatValue(delta)} {series.unit} · {points.length} mätpunkter</div>
  </div>;
}
