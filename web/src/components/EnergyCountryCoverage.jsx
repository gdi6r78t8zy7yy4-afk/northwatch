import React from 'react';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import { formatObservationAge } from '../lib/metricFreshness.js';

const COUNTRIES = ['SE', 'NO', 'DK', 'FI', 'IS'];
const valid = metric => metric && metric.value != null && metric.value !== '' &&
  Number.isFinite(Number(metric.value)) && Number.isFinite(Date.parse(metric.ts ?? ''));
export function observationCollectorNote(metric) {
  if (metric?.sourceStatus === 'stale') return 'Collector stale · last successful measurement retained';
  if (metric?.sourceStatus === 'error') return 'Collector error · last successful measurement retained';
  if (metric?.sourceStatus === 'no_key') return 'Collector credentials missing · last successful measurement retained';
  return null;
}

const latest = (metrics, country, predicate) => metrics
  .filter(metric => metric.country === country && predicate(metric) && valid(metric))
  .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0] ?? null;

const latestPerPriceSeries = (metrics, country) => {
  const series = new Map();
  for (const metric of metrics) {
    if (metric.country !== country || !String(metric.indicator ?? '').startsWith('Dag-ahead-pris ') || !valid(metric)) continue;
    const key = [metric.indicator, metric.source, metric.unit].join('|');
    const previous = series.get(key);
    if (!previous || Date.parse(metric.ts) > Date.parse(previous.ts)) series.set(key, metric);
  }
  return [...series.values()].sort((a, b) => a.indicator.localeCompare(b.indicator) ||
    String(a.source).localeCompare(String(b.source)));
};

function ObservationCell({ metric, label }) {
  if (!metric) return <span className="energy-coverage-empty">No measurement</span>;
  return <span className="energy-coverage-observation">
    <b>{label}</b>
    <span>{metric.sourceName ?? metric.source ?? 'Source unavailable'}</span>
    <span title={fmtTime(metric.ts)}>{formatObservationAge(metric.ts)} · {fmtTime(metric.ts)}</span>
    {observationCollectorNote(metric) ? <span className="energy-coverage-collector-state">{observationCollectorNote(metric)}</span> : null}
  </span>;
}

export function buildEnergyCountryCoverage(metrics = []) {
  return COUNTRIES.map(country => {
    const production = latest(metrics, country, row => row.indicator === `Total produktion (${country})`);
    const consumption = latest(metrics, country, row =>
      row.indicator === `Total förbrukning (${country})` ||
      row.indicator.startsWith(`Beräknad förbrukning (${country}`));
    const priceSeries = latestPerPriceSeries(metrics, country);
    const price = priceSeries.slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0] ?? null;
    const components = metrics.filter(row => row.country === country && valid(row) &&
      /^(Vindproduktion|Solproduktion|Vind\+sol-produktion|Vattenkraftproduktion|Geotermisk produktion|Oljeproduktion|Förnybar produktion|Kärnkraftsproduktion|Industriell kraftvärmeproduktion)/.test(row.indicator ?? ''));
    const latestComponent = components.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0] ?? null;
    return {
      country, production, consumption, price, priceSeries,
      componentCount: new Set(components.map(row => row.indicator)).size,
      latestComponent,
      consumptionDerived: Boolean(consumption?.indicator.startsWith('Beräknad förbrukning')),
    };
  });
}

export default function EnergyCountryCoverage({ metrics = [] }) {
  const rows = buildEnergyCountryCoverage(metrics);
  return <section className="card energy-country-coverage">
    <div className="energy-section-head"><div>
      <h2>Nordic country data coverage</h2>
      <div className="mut">Presence and freshness of the latest valid observations by country and indicator group.</div>
    </div><span className="tag">{rows.filter(row => row.production || row.consumption || row.price || row.componentCount).length}/5 countries with observations</span></div>
    <div className="energy-table-wrap">
      <table className="energy-coverage-table" aria-label="Nordic energy data coverage">
        <thead><tr><th>Country</th><th>Total production</th><th>Consumption</th><th>Day-ahead price</th><th>Generation components</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.country}>
          <td><b>{COUNTRY_NAMES[row.country] ?? row.country}</b></td>
          <td><ObservationCell metric={row.production} label="Reported"/></td>
          <td><ObservationCell metric={row.consumption} label={row.consumptionDerived ? 'Derived' : 'Reported'}/></td>
          <td>{row.priceSeries.length ? <span className="energy-coverage-observation">
            <b>{row.priceSeries.length} reported series</b>
            {row.priceSeries.map(metric => <span key={[metric.indicator, metric.source, metric.unit].join('|')}>
              <b>{metric.indicator.replace(/^Dag-ahead-pris\\s+/, '')}</b> · {metric.sourceName ?? metric.source ?? 'Source unavailable'}
              <span title={fmtTime(metric.ts)}>{formatObservationAge(metric.ts)} · {fmtTime(metric.ts)}</span>
              {observationCollectorNote(metric) ? <span className="energy-coverage-collector-state">{observationCollectorNote(metric)}</span> : null}
            </span>)}
          </span> : <span className="energy-coverage-empty">No measurement</span>}</td>
          <td>{row.componentCount ? <span className="energy-coverage-observation">
            <b>{row.componentCount} indicator{row.componentCount === 1 ? '' : 's'}</b>
            <span>{row.latestComponent?.sourceName ?? row.latestComponent?.source ?? 'Source unavailable'}</span>
            <span title={fmtTime(row.latestComponent?.ts)}>{formatObservationAge(row.latestComponent?.ts)} · {fmtTime(row.latestComponent?.ts)}</span>
            {observationCollectorNote(row.latestComponent) ? <span className="energy-coverage-collector-state">{observationCollectorNote(row.latestComponent)}</span> : null}
          </span> : <span className="energy-coverage-empty">No component data</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mut energy-coverage-note">This is an observation-availability matrix, not a completeness or adequacy assessment. A reported generation component does not imply an exhaustive generation mix. Derived consumption is explicitly labelled. Missing measurements are not treated as zero.</p>
  </section>;
}
