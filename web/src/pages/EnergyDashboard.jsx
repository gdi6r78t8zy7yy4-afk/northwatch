import React, { useEffect, useMemo, useState } from 'react';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import EnergySourceHealth from '../components/EnergySourceHealth.jsx';
import EnergyCountryCoverage from '../components/EnergyCountryCoverage.jsx';
import EnergyPriceProfiles from '../components/EnergyPriceProfiles.jsx';
import EnergyPriceMovementAnalysis from '../components/EnergyPriceMovementAnalysis.jsx';
import EnergyGenerationDemandTrends, { filterRenewableGenerationSeries } from '../components/EnergyGenerationDemandTrends.jsx';
import MapPanel from '../components/MapPanel.jsx';
import { fetchEnergyOverview, fetchEnergyHistory, fetchEnergyAnalysis, fetchAssets, fetchStaticGeo } from '../api.js';
import { formatObservationAge } from '../lib/metricFreshness.js';
import { buildEnergyPriceSpreadMovements } from '../lib/energyPriceAnalysis.js';
import { filterEnergyHistorySeries } from '../lib/energyHistoryExplorer.js';

const ENERGY_AREA = { id: 1, name: 'Elförsörjning och energisystem', short: 'Energi', geo: true };
const findMetric = (rows, test) => rows.find(r => test(r) && r.value !== null && Number.isFinite(Number(r.value))) ?? null;
const fmt = (r, digits = 0) => r ? new Intl.NumberFormat('sv-SE', { maximumFractionDigits: digits }).format(Number(r.value)) : '—';
const age = ts => {
  if (!ts) return 'Tid saknas';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000));
  return mins < 60 ? mins + ' min sedan' : Math.floor(mins / 60) + ' h sedan';
};
function Kpi({ label, metric, fallback }) {
  return <div className="energy-kpi"><div className="energy-kpi-label">{label}</div>
    <div className="energy-kpi-value">{fmt(metric, 1)} <small>{metric?.unit ?? ''}</small></div>
    <div className="mut">{metric ? metric.sourceName + ' · ' + age(metric.ts) : fallback}</div>
    {metric?.coverageNote ? <div className="mut">{metric.coverageNote}</div> : null}</div>;
}
function reportedRenewableMetric(metrics, country) {
  const latest = indicator => metrics
    .filter(row => row.country === country && row.indicator === indicator &&
      row.value != null && Number.isFinite(Number(row.value)) && row.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;
  const alignedSum = (left, right, label, coverageNote = null) => {
    if (!left || !right || left.ts !== right.ts || left.unit !== right.unit) return null;
    return { ...left, value: Number(left.value) + Number(right.value),
      indicator: label, sourceName: left.sourceName ?? left.source, coverageNote };
  };
  if (country === 'DK') {
    return alignedSum(latest('Vindproduktion (DK)'), latest('Solproduktion (DK)'), 'Vind + sol-produktion (DK)')
      ?? latest('Vind+sol-produktion DK');
  }
  if (country === 'FI') {
    return alignedSum(latest('Vindproduktion (FI)'), latest('Vattenkraftproduktion (FI)'),
      'Rapporterad vind- och vattenkraft (FI)',
      'Partial coverage: other renewable technologies may not be included.');
  }
  if (country === 'IS') return latest('Förnybar produktion (IS)');
  return null;
}
const GENERATION_COMPONENTS = {
  DK: [{ name: 'Wind', indicator: 'Vindproduktion (DK)' }, { name: 'Solar', indicator: 'Solproduktion (DK)' }],
  FI: [
    { name: 'Wind', indicator: 'Vindproduktion (FI)' },
    { name: 'Hydro', indicator: 'Vattenkraftproduktion (FI)' },
    { name: 'Nuclear', indicator: 'Kärnkraftsproduktion (FI)' },
    { name: 'Industrial CHP', indicator: 'Industriell kraftvärmeproduktion (FI)' },
  ],
  IS: [
    { name: 'Geothermal', indicator: 'Geotermisk produktion (IS)' },
    { name: 'Hydro', indicator: 'Vattenkraftproduktion (IS)' },
    { name: 'Oil', indicator: 'Oljeproduktion (IS)' },
  ],
};

function GenerationMix({ metrics, country = 'DK' }) {
  if (country === 'ALL') {
    return <div className="energy-generation-mix-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      {['DK', 'FI', 'IS'].map(code => <article className="energy-generation-country" key={code}>
        <h3>{COUNTRY_NAMES[code]} · reported components</h3>
        <GenerationMix metrics={metrics} country={code}/>
      </article>)}
    </div>;
  }
  const scope = country;
  const definitions = GENERATION_COMPONENTS[scope] ?? [];
  if (!definitions.length) return <p className="mut">No generation-technology breakdown is currently reported for {COUNTRY_NAMES[scope] ?? scope}.</p>;
  const candidates = definitions.map(definition => ({
    ...definition,
    metric: findMetric(metrics, row => row.country === scope && row.indicator === definition.indicator),
  })).filter(item => item.metric);
  const groups = new Map();
  for (const item of candidates) {
    const key = `${item.metric.ts}|${item.metric.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const aligned = [...groups.values()].sort((a, b) =>
    b.length - a.length || String(b[0]?.metric.ts).localeCompare(String(a[0]?.metric.ts)))[0] ?? [];
  if (aligned.length < 2) return <p className="mut">Fewer than two aligned generation-technology measurements are available for {COUNTRY_NAMES[scope] ?? scope}. Components are not combined across timestamps or units.</p>;
  const parts = aligned.map(item => ({ name: item.name, value: Number(item.metric.value) }));
  const total = findMetric(metrics, row => row.country === scope && row.indicator === `Total produktion (${scope})`);
  const isAlignedTotal = total && total.ts === aligned[0].metric.ts && total.unit === aligned[0].metric.unit;
  if (scope === 'DK' && isAlignedTotal) {
    const reported = parts.reduce((sum, part) => sum + part.value, 0);
    if (Number(total.value) >= reported) parts.push({ name: 'Other (unallocated)', value: Number(total.value) - reported });
  }
  const sum = parts.reduce((acc, part) => acc + Math.max(0, part.value), 0);
  return <>
    <div className="energy-mixbar" aria-label={`${COUNTRY_NAMES[scope] ?? scope}s produktionsmix`}>{parts.map(part =>
      <span key={part.name} style={{ width: (sum ? Math.max(0, part.value) / sum * 100 : 0) + '%' }} title={part.name + ': ' + part.value + ' MW'} />)}</div>
    <div className="energy-legend">{parts.map(part => <span key={part.name}>{part.name}: {Math.round(part.value).toLocaleString('sv-SE')} MW</span>)}</div>
    <p className="mut">{scope === 'FI' ? 'Fingrid technology indicators are reported components, not an exhaustive generation mix; they must not be summed as total production.' :
      scope === 'IS' ? 'Landsnet reports geothermal, hydro and oil components. No consumption is inferred from these generation values.' :
      'Other is the difference between total production and reported wind + solar; it is not a detailed fuel breakdown.'}</p>
  </>;
}
function TrendChart({ series }) {
  const points = series.points ?? [];
  if (points.length < 2) return <div className="energy-chart-empty">Insufficient history · {points.length} observation(s)</div>;
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
    <svg viewBox="0 0 360 142" role="img"
      aria-label={series.indicator + ' historical trend, value axis in ' + series.unit + ', time axis in UTC'}>
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
        Time (UTC)
      </text>
    </svg>
    <div className="energy-chart-values"><span>{formatValue(first.value)} {series.unit}</span><b>{formatValue(last.value)} {series.unit}</b></div>
    <div className="mut">Förändring {delta > 0 ? '+' : ''}{formatValue(delta)} {series.unit} · {points.length} mätpunkter</div>
  </div>;
}


function HistoryExplorer({ series, country = 'ALL' }) {
  // Keep the chart selector scoped to the active dashboard country. The API
  // is country-aware, but filtering here also prevents stale/mixed responses
  // from leaking another country's series into the visible chart choices.
  const scopedSeries = useMemo(() => country === 'ALL' ? series
    : series.filter(item => item.country === country), [series, country]);
  const keys = useMemo(() => scopedSeries.map(s => [s.country,s.source,s.indicator,s.unit].join('|')), [scopedSeries]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    setSelected(current => {
      if (current === null) return keys.slice(0, 6);
      const retained = current.filter(key => keys.includes(key));
      // When the country changes, none of the previous country's keys may
      // remain. Select the new scope's first series instead of showing blank.
      return retained.length ? retained : keys.slice(0, 6);
    });
  }, [keys.join('||')]);
  const filtered = useMemo(() => filterEnergyHistorySeries(scopedSeries, search), [scopedSeries, search]);
  const visible = scopedSeries.filter(s => selected?.includes([s.country,s.source,s.indicator,s.unit].join('|')));
  const toggle = key => setSelected(current => {
    const active = current ?? keys.slice(0, 6);
    return active.includes(key) ? active.filter(item => item !== key)
      : active.length < 8 ? [...active, key] : active;
  });
  const selectVisible = () => setSelected(filtered.slice(0, 8).map(item =>
    [item.country,item.source,item.indicator,item.unit].join('|')));
  return <>
    <div className="energy-series-controls">
      <input type="search" aria-label="Filter historical series" placeholder="Filter by country, technology, indicator or source…"
        value={search} onChange={event => setSearch(event.target.value)}/>
      <span className="mut">{filtered.length} of {scopedSeries.length} series</span>
      <button type="button" onClick={selectVisible} disabled={!filtered.length}>Select visible</button>
      <button type="button" onClick={() => setSelected([])} disabled={!selected?.length}>Clear selection</button>
    </div>
    <div className="energy-series-picker" aria-label="Choose historical series">
      {filtered.map(s => {
        const key = [s.country,s.source,s.indicator,s.unit].join('|');
        const active = selected?.includes(key);
        return <button type="button" key={key} className={'energy-series-chip' + (active ? ' on' : '')}
          aria-pressed={Boolean(active)} onClick={() => toggle(key)}>
          <span>{s.country}</span> {s.indicator}
        </button>;
      })}
    </div>
    {!filtered.length ? <p className="mut">No historical series match this filter.</p> : null}
    <div className="mut energy-series-help">Select up to 8 series. Different units and sources remain separate; values are never combined.</div>
    {visible.length ? <div className="energy-chart-grid">{visible.map(s =>
      <TrendChart key={[s.country,s.source,s.indicator,s.unit].join('|')} series={s}/>)}</div>
      : <p className="mut">Select a series above to display its history.</p>}
  </>;
}


function GridOperationsExplorer({ series }) {
  const interconnectors = series.filter(s => /^Nettoflöde .+→.+/.test(s.indicator));
  const reserves = series.filter(s => /^(aFRR|mFRR)-leverans /.test(s.indicator));
  return <section className="card energy-grid-operations">
    <div className="energy-section-head"><div><h2>Grid operations · flow & balancing history</h2>
      <div className="mut">Historical source measurements for cross-border exchange and reserve-capacity products.</div></div></div>
    <div className="energy-grid-operations-columns">
      <div className="energy-grid-operations-panel">
        <h3>Interconnector physical-flow measurements</h3>
        <p className="mut">Shows the source-reported signed MW series for each route. Sign conventions can differ by source; the chart does not infer transfer direction or available capacity.</p>
        {interconnectors.length ? <HistoryExplorer series={interconnectors}/>
          : <p className="mut">No historical interconnector measurements in this time window.</p>}
      </div>
      <div className="energy-grid-operations-panel">
        <h3>aFRR / mFRR capacity products</h3>
        <p className="mut">Shows published delivery-block volumes. These are not necessarily activated reserves or currently available headroom.</p>
        {reserves.length ? <HistoryExplorer series={reserves}/>
          : <p className="mut">No historical aFRR/mFRR delivery-block measurements in this time window.</p>}
      </div>
    </div>
  </section>;
}

function MarketSignals({ metrics, comparisons = [], country = 'ALL' }) {
  const scopedMetrics = country === 'ALL' ? metrics : metrics.filter(row => row.country === country);
  const priceGroups = new Map();
  const now = Date.now();
  for (const row of scopedMetrics.filter(r => /^Dag-ahead-pris /.test(r.indicator) && Number.isFinite(Number(r.value)) && Number.isFinite(Date.parse(r.ts ?? '')))) {
    const key = `${row.indicator}|${row.source}`;
    const previous = priceGroups.get(key);
    const at = Date.parse(row.ts);
    // For day-ahead interval series, show the interval active now. If the
    // source only has future prices, show the nearest upcoming interval.
    const rank = at <= now ? now - at : Number.MAX_SAFE_INTEGER + at;
    if (!previous || rank < previous.rank) priceGroups.set(key, { row, rank });
  }
  const regionalComparisons = country === 'ALL' ? comparisons : [];
  const spreadMovements = buildEnergyPriceSpreadMovements(regionalComparisons);
  const prices = [...priceGroups.values()].map(item => item.row)
    .sort((a, b) => a.indicator.localeCompare(b.indicator) || a.source.localeCompare(b.source));
  const renewableCountry = country === 'ALL' ? 'DK' : country;
  return <div className="energy-market-grid">
    <div className="energy-market-panel">
      <h3>Day-ahead prices</h3>
      {prices.length ? <div className="energy-price-grid">{prices.map(row =>
        <div className="energy-price-cell" key={row.indicator + '|' + row.source}>
          <span>{row.indicator.replace(/^Dag-ahead-pris\s+/, '')}</span><b>{Number(row.value).toLocaleString('sv-SE',{maximumFractionDigits:4})} <small>{row.unit}</small></b>
          <span className="mut">{row.sourceName ?? row.source} · {fmtTime(row.ts)}</span>
        </div>)}</div>
        : <p className="mut">No comparable day-ahead price observations are currently available from connected sources.</p>}
      <EnergyPriceProfiles metrics={scopedMetrics}/>
      <p className="mut">Prices are shown as published by each source. Currency and unit are retained; values are not converted. Spot prices exclude VAT, supplier markups and taxes.</p>
      {country === 'ALL' || country === 'SE' ? <p className="mut">Swedish bidding-zone prices: <a href="https://www.elprisetjustnu.se" target="_blank" rel="noreferrer">Elpriset just nu.se</a>.</p> : null}
      <div className="energy-spread-section">
        <h4>Aligned Nordic price spreads</h4>
        {regionalComparisons.length ? <div className="energy-spread-list">{regionalComparisons.slice(0, 6).map(snapshot =>
          <article className="energy-spread-row" key={snapshot.asOf + snapshot.unit}>
            <div className="energy-spread-heading"><b>{snapshot.spread.toLocaleString('sv-SE',{maximumFractionDigits:2})} {snapshot.unit}</b><span>{snapshot.countryCount} bidding zones · {fmtTime(snapshot.asOf)}</span></div>
            <div className="energy-spread-track" role="img" aria-label={`Lowest ${snapshot.low.country} ${snapshot.low.value}; highest ${snapshot.high.country} ${snapshot.high.value}`}>
              {snapshot.observations.map(item => <span key={item.country} style={{left:(snapshot.high.value === snapshot.low.value ? 50 : (item.value-snapshot.low.value)/(snapshot.high.value-snapshot.low.value)*100)+'%'}} title={item.country+': '+item.value+' '+item.unit}><i/></span>)}
            </div>
            <div className="energy-spread-detail"><span>Low: {snapshot.low.country} · {snapshot.low.value.toLocaleString('sv-SE')}</span><span>High: {snapshot.high.country} · {snapshot.high.value.toLocaleString('sv-SE')}</span></div>
            <div className="mut">{snapshot.observations.map(item => item.country + ' ' + item.sourceName).join(' · ')}</div>
          </article>)}</div>
          : <p className="mut">No aligned cross-country price snapshots yet. At least two countries must report the same timestamp and price unit.</p>}
        <p className="mut">Spread is the highest minus the lowest reported price. Only identical timestamps and units are compared; currencies are not converted.</p>
        <div className="energy-spread-movement">
          <h4>Spread movement · same countries, sources and unit</h4>
          {spreadMovements.length ? spreadMovements.slice(0, 4).map(movement => <div className="energy-spread-movement-row" key={movement.unit + movement.countries.join('-')}>
            <b>{movement.change > 0 ? '+' : ''}{movement.change.toLocaleString('sv-SE',{maximumFractionDigits:2})} {movement.unit}</b>
            <span>{movement.change > 0 ? 'Wider spread' : movement.change < 0 ? 'Narrower spread' : 'Unchanged spread'} · {movement.countries.join(', ')}</span>
            <small>{fmtTime(movement.previousAsOf)} → {fmtTime(movement.latestAsOf)} · {movement.previousSpread.toLocaleString('sv-SE',{maximumFractionDigits:2})} → {movement.latestSpread.toLocaleString('sv-SE',{maximumFractionDigits:2})} {movement.unit}</small>
          </div>) : <p className="mut">A spread trend needs at least two snapshots with identical countries, sources and units.</p>}
          <p className="mut">This describes a change in observed price separation only. It does not establish congestion, available transfer capacity or its cause.</p>
        </div>
      </div>
    </div>
    <div className="energy-market-panel">
      <h3>Reported generation technologies · {COUNTRY_NAMES[renewableCountry] ?? renewableCountry}</h3>
      <GenerationMix metrics={scopedMetrics} country={renewableCountry}/>
    </div>
  </div>;
}



function GenerationDemandPanel({ metrics, country = 'ALL' }) {
  const countries = country === 'ALL' ? ['SE', 'NO', 'DK', 'FI', 'IS'] : [country];
  const latestFor = (country, indicator) => metrics
    .filter(r => r.country === country && r.indicator === indicator &&
      r.value != null && Number.isFinite(Number(r.value)) && r.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;
  const rows = countries.map(country => {
    const generation = latestFor(country, `Total produktion (${country})`);
    const demand = [latestFor(country, `Total förbrukning (${country})`),
      country === 'DK' ? latestFor(country, 'Beräknad förbrukning (DK, SCADA)') : null]
      .filter(Boolean).sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;
    const wind = latestFor(country, `Vindproduktion (${country})`);
    const solar = latestFor(country, `Solproduktion (${country})`);
    const hydro = country === 'FI' ? latestFor(country, 'Vattenkraftproduktion (FI)') : null;
    const combinedRenewables = latestFor(country, `Vind+sol-produktion ${country}`);
    const icelandRenewables = country === 'IS' ? latestFor(country, 'Förnybar produktion (IS)') : null;
    let renewable = icelandRenewables ?? combinedRenewables;
    if (country === 'FI' && wind && hydro && wind.ts === hydro.ts && wind.unit === hydro.unit) {
      renewable = { value: Number(wind.value) + Number(hydro.value), unit: wind.unit,
        ts: wind.ts, sourceName: wind.sourceName ?? wind.source,
        partial: true };
    } else if (country === 'DK' && wind && solar && wind.ts === solar.ts && wind.unit === solar.unit) {
      renewable = { value: Number(wind.value) + Number(solar.value), unit: wind.unit,
        ts: wind.ts, sourceName: wind.sourceName ?? wind.source };
    }
    const aligned = generation && demand && generation.ts === demand.ts && generation.unit === demand.unit;
    const renewableAligned = renewable && generation && renewable.ts === generation.ts &&
      renewable.unit === generation.unit && Number(generation.value) > 0;
    if (!generation && !demand && !renewable) return null;
    const observationAges = [
      ['production', generation], ['consumption', demand], ['renewables', renewable],
    ].filter(([, metric]) => metric).map(([label, metric]) =>
      label + ' ' + formatObservationAge(metric.ts));
    return { country, generation, demand, renewable, observationAges,
      balance: aligned ? Number(generation.value) - Number(demand.value) : null,
      renewableShare: renewableAligned ? Number(renewable.value) / Number(generation.value) * 100 : null,
      aligned };
  }).filter(Boolean);
  const value = metric => metric
    ? Number(metric.value).toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ' ' + metric.unit
    : '—';
  return <section className="card energy-generation-section">
    <div className="energy-section-head"><div><h2>{country === 'ALL' ? 'Generation & demand · Nordic comparison' : `Generation & demand · ${COUNTRY_NAMES[country] ?? country}`}</h2>
      <div className="mut">{country === 'ALL' ? 'Country-level production and consumption, using the latest source observations available for each country.' : `Only source measurements belonging to ${COUNTRY_NAMES[country] ?? country} are shown. Missing indicators remain unavailable; no other country is substituted.`}</div></div>
      <span className="tag">{country === 'ALL' ? `${rows.length} countries with data` : `${rows.length ? 'Country data available' : 'No country data'}`}</span>
    </div>
    {rows.length ? <div className="energy-generation-grid">{rows.map(row => <article className="energy-generation-country" key={row.country}>
      <div className="energy-generation-country-head"><b>{COUNTRY_NAMES[row.country] ?? row.country}</b>
        <span className="mut">{row.generation?.sourceName ?? row.demand?.sourceName ?? row.renewable?.sourceName ?? 'Source measurement'}</span></div>
      <div className="energy-generation-values">
        <div><span>Production</span><b>{value(row.generation)}</b></div>
        <div><span>Consumption</span><b>{value(row.demand)}</b></div>
        <div><span>{row.country === 'IS' ? 'Hydro + geothermal' : row.country === 'FI' ? 'Wind + hydro (reported)' : 'Wind + solar'}</span><b>{value(row.renewable)}</b></div>
      </div>
      <div className="energy-generation-assessment">
        {row.aligned ? <span className={row.balance < 0 ? 'energy-balance deficit' : 'energy-balance surplus'}>
          Domestic balance {row.balance > 0 ? '+' : ''}{row.balance.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} {row.generation.unit}
        </span> : <span className="mut">Balance unavailable · timestamps or units do not align</span>}
        {row.renewableShare != null ? <span className="mut">{row.country === 'IS' ? 'Hydro + geothermal' : row.country === 'FI' ? 'Reported wind + hydro components' : 'Wind + solar'}: {row.renewableShare.toLocaleString('sv-SE', { maximumFractionDigits: 1 })}% of reported production{row.renewable?.partial ? ' · partial coverage, not a full renewable share' : ''}</span>
          : <span className="mut">Renewable share unavailable · requires aligned renewable and total production</span>}
      </div>
      {row.country === 'IS' ? <div className="mut">Landsnet reports geothermal, hydro and oil generation in its transmission-system snapshot. It does not provide consumption here; generation connected only to distribution networks may not be represented.</div> : null}
      {row.country === 'DK' && row.demand?.indicator === 'Beräknad förbrukning (DK, SCADA)' ?
        <div className="mut">Consumption is derived from SCADA production plus net exchange; it is approximate, not a settlement measurement.</div> : null}
      <div className="mut energy-generation-time">Latest observation: {fmtTime(row.generation?.ts ?? row.demand?.ts ?? row.renewable?.ts)}</div>
      <div className="mut energy-generation-freshness" aria-label="Observation age">Observation age · {row.observationAges.join(' · ')}</div>
    </article>)}</div> : <p className="mut">No generation, demand or wind/solar production measurements are currently available in this country scope.</p>}
    <p className="mut energy-generation-caveat">A domestic production-demand difference is not a system adequacy assessment. Imports, exports, losses, storage and balancing resources are not included. Missing and non-aligned measurements are left blank; no zeroes or estimates are synthesized.</p>
  </section>;
}

function ReserveMarketPanel({ metrics }) {
  const capacities = metrics.filter(r => /^(aFRR|mFRR)-kapacitet /.test(r.indicator) &&
    r.value != null && Number.isFinite(Number(r.value)) && r.ts);
  const latestTs = capacities.reduce((latest, row) => row.ts > latest ? row.ts : latest, '');
  const current = capacities.filter(row => row.ts === latestTs)
    .sort((a,b) => a.indicator.localeCompare(b.indicator));
  const prices = new Map(metrics.filter(r => /^(aFRR|mFRR)-kapacitetspris /.test(r.indicator) &&
    r.ts === latestTs && r.value != null && Number.isFinite(Number(r.value)))
    .map(r => [r.indicator.replace('-kapacitetspris ', '-kapacitet '), r]));
  return <section className="card energy-reserve-section">
    <div className="energy-section-head"><div><h2>Reserve capacity market · aFRR / mFRR</h2>
      <div className="mut">Published delivery-block capacity and capacity prices, by bidding zone and direction.</div></div>
      {latestTs ? <span className="tag">Block {fmtTime(latestTs)}</span> : null}
    </div>
    {current.length ? <div className="energy-table-wrap"><table>
      <thead><tr><th>Product</th><th>Zone</th><th>Direction</th><th>Published capacity</th><th>Capacity price</th><th>Source</th></tr></thead>
      <tbody>{current.map(row => {
        const match = row.indicator.match(/^(aFRR|mFRR)-kapacitet (.+) (up|down)$/);
        if (!match) return null;
        const [, product, zone, direction] = match;
        const price = prices.get(row.indicator);
        return <tr key={row.indicator}>
          <td><b>{product}</b></td><td>{zone}</td><td>{direction === 'up' ? 'Upward' : 'Downward'}</td>
          <td className="mono">{Number(row.value).toLocaleString('sv-SE',{maximumFractionDigits:1})} {row.unit}</td>
          <td className="mono">{price ? Number(price.value).toLocaleString('sv-SE',{maximumFractionDigits:2})+' '+price.unit : '—'}</td>
          <td>{row.sourceName ?? row.source}</td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="mut">No current reserve-capacity delivery block is available in the selected country scope.</p>}
    <div className="energy-reserve-notes">
      <p className="mut">Capacity volume is the published volume for a delivery block. Capacity price is shown only when supplied by the same source and block.</p>
      <p className="mut">These are capacity-market products, not activated balancing energy, instantaneous reserve availability or remaining system headroom. Missing prices are left blank.</p>
    </div>
  </section>;
}

export default function EnergyDashboard({ country = 'ALL', onCountryChange }) {
  const [data, setData] = useState(null), [assets, setAssets] = useState([]), [geo, setGeo] = useState(null);
  const [error, setError] = useState(null), [updated, setUpdated] = useState(null);
  const [historyRange, setHistoryRange] = useState('24h'), [history, setHistory] = useState(null), [analysis, setAnalysis] = useState(null);
  useEffect(() => {
    let stopped = false;
    setData(null); setHistory(null); setAnalysis(null); setAssets([]);
    const load = async () => { try { const result = await fetchEnergyOverview(country); if (!stopped) { setData(result); setError(null); setUpdated(new Date().toISOString()); } }
      catch (e) { if (!stopped) setError(e.message); } };
    load(); const timer = setInterval(load, 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, [country]);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const [h, a] = await Promise.all([fetchEnergyHistory(country, historyRange), fetchEnergyAnalysis(country)]);
        if (!stopped) { setHistory(h); setAnalysis(a); }
      } catch { /* keep the last successful historical view */ }
    };
    load(); const timer = setInterval(load, 120000);
    return () => { stopped = true; clearInterval(timer); };
  }, [country, historyRange]);
  useEffect(() => { let stopped = false; fetchAssets(1, country).then(r => { if (!stopped) setAssets(r.assets ?? []); }).catch(() => {}); return () => { stopped = true; }; }, [country]);
  useEffect(() => { let stopped = false; fetchStaticGeo().then(r => { if (!stopped) setGeo(r); }).catch(() => {}); return () => { stopped = true; }; }, []);
  const metrics = data?.metrics ?? [];
  const renewableHistory = useMemo(() => filterRenewableGenerationSeries(history?.series ?? []), [history?.series]);
  const kpi = useMemo(() => {
    const scope = country === 'ALL' ? null : country;
    const scoped = scope ? metrics.filter(r => r.country === scope) : metrics.filter(r => r.country !== 'NORDIC');
    const latest = test => scoped.filter(r => test(r) && r.value != null && Number.isFinite(Number(r.value)) && r.ts)
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;
    const production = latest(r => /^Total produktion \([A-Z]{2}\)$/.test(r.indicator));
    const consumption = latest(r => /^Total förbrukning \([A-Z]{2}\)$/.test(r.indicator) ||
      (r.country === 'DK' && r.indicator === 'Beräknad förbrukning (DK, SCADA)'));
    const price = latest(r => /^Dag-ahead-pris /.test(r.indicator));
    const renewable = (scope ? [scope] : ['SE', 'NO', 'DK', 'FI', 'IS'])
      .map(code => reportedRenewableMetric(metrics, code))
      .filter(Boolean)
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;
    const labelCountry = metric => metric ? COUNTRY_NAMES[metric.country] ?? metric.country : '';
    return [
      { label: production ? `Production · ${labelCountry(production)}` : 'Production', metric: production, fallback: 'No production measurement in this country scope' },
      { label: consumption ? `Consumption · ${labelCountry(consumption)}` : 'Consumption', metric: consumption, fallback: 'No consumption measurement in this country scope' },
      { label: price ? `Day-ahead price · ${labelCountry(price)}` : 'Day-ahead price', metric: price, fallback: 'No day-ahead price in this country scope' },
      { label: renewable ? `${renewable.coverageNote ? 'Reported renewable components' : 'Renewable output'} · ${labelCountry(renewable)}` : 'Renewable output', metric: renewable, fallback: 'No aligned renewable measurement in this country scope' },
      { label: 'Sources reporting', value: data?.coverage?.reportingSources ?? 0, unit: '', detail: `${data?.coverage?.sourceCount ?? 0} configured sources in scope` },
    ];
  }, [metrics, country, data?.coverage]);
  const status = !data?.sources?.length ? 'none' : data.sources.some(s => s.status === 'error') ? 'error'
    : data.sources.some(s => s.status === 'no_key') ? 'no_key' : data.sources.some(s => s.status === 'stale') ? 'stale' : 'ok';
  return <div className="energy-page">
    <header className="energy-heading"><div><div className="energy-eyebrow">NORTHWATCH / OPERATIONAL ENERGY</div>
      <h1>Nordic Energy Situation <StatusPill status={status} /></h1>
      <p className="mut">Elförsörjning, gränsflöden, balans och källornas aktualitet · {country === 'ALL' ? 'Alla länder' : COUNTRY_NAMES[country]}</p></div>
      <div className="energy-heading-actions"><label className="energy-country-control"><span>VALT LAND</span><select aria-label="Select energy dashboard country" value={country} onChange={event => onCountryChange?.(event.target.value)}><option value="ALL">Alla länder</option>{Object.entries(COUNTRY_NAMES).filter(([code]) => ['SE','NO','DK','FI','IS'].includes(code)).map(([code,name]) => <option key={code} value={code}>{name}</option>)}</select></label><div className="energy-updated"><span className="dot" /> Uppdateras var 60:e sekund<br/><span className="mut">Senast hämtad: {updated ? fmtTime(updated) : '—'}</span></div></div></header>
    {error && <div className="card"><StatusPill status="error"/> <span className="mut">Kunde inte uppdatera energivyn: {error}. Visar senast hämtade data om sådan finns.</span></div>}
    <div className="energy-kpis">{kpi.map(item => item.metric !== undefined
      ? <Kpi key={item.label} label={item.label} metric={item.metric} fallback={item.fallback}/>
      : <div className="energy-kpi" key={item.label}><div className="energy-kpi-label">{item.label}</div><div className="energy-kpi-value">{item.value}</div><div className="mut">{item.detail}</div></div>)}</div>
    <div className="energy-main-grid">
      <section className="card energy-map-card"><div className="energy-section-head"><div><h2>Nordic grid · live observations</h2>
        <div className="mut">Regionalt nordiskt nätperspektiv visas även när ett enskilt land är valt. Zonankare och vissa länkar är schematiska approximationer, inte verifierad fysisk nätgeometri.</div></div><span className="tag">{data?.coverage?.flowCount ?? 0} flödeslänkar</span></div>
        <MapPanel area={ENERGY_AREA} country={country} assets={assets} staticGeo={geo} events={[]}/></section>
      <section className="card energy-assessment"><h2>Operational assessment</h2>
        <div className="energy-assessment-row"><span className="mut">Källor i urvalet</span><b>{data?.coverage?.sourceCount ?? '—'}</b></div>
        <div className="energy-assessment-row"><span className="mut">Mätvärden</span><b>{data?.coverage?.metricCount ?? '—'}</b></div>
        <div className="energy-assessment-row"><span className="mut">Flödeslänkar</span><b>{data?.coverage?.flowCount ?? '—'}</b></div>
        <div className="energy-note"><b>Datatolkning</b><p>Värden visas med källans mättid. Fördröjda, frysta eller framtida leveransblock ska inte tolkas som momentan driftstatus.</p></div>
        <div className="energy-note"><b>Coverage gaps</b><p>Verified live coverage remains uneven. Finland requires a Fingrid API key and configured datasets. Iceland's Landsnet feed currently provides a latest generation snapshot only; it does not provide demand or historical series here. Market-price and generation-mix coverage is not complete across all countries.</p></div>
      </section>
    </div>
    <EnergyCountryCoverage metrics={metrics}/>
    <section className="card energy-history-section">
      <div className="energy-section-head"><div><h2>Historical measurements & trends</h2>
        <div className="mut">Collector snapshots stored with their original measurement timestamps.</div></div>
        <select aria-label="History range" value={historyRange} onChange={e => setHistoryRange(e.target.value)}>
          <option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
        </select></div>
      {history?.series?.length ? <HistoryExplorer series={history.series} country={country}/>
        : <p className="mut">Historical data is accumulating. Charts will populate as new collector measurements are recorded; the system does not backfill invented values.</p>}
      <div className="mut energy-history-meta">{history?.count ?? 0} observations · range {history?.from ? fmtTime(history.from) : '—'} – {history?.to ? fmtTime(history.to) : '—'}</div>
    </section>
    <EnergyGenerationDemandTrends series={history?.series ?? []}/>
    <section className="card energy-history-section energy-renewable-history-section">
      <div className="energy-section-head"><div><h2>Renewable generation history</h2>
        <div className="mut">Selectable source-reported renewable technology time series. Each country, source, indicator and unit remains independent.</div></div>
        <span className="tag">{renewableHistory.length} series</span></div>
      {renewableHistory.length ? <HistoryExplorer series={renewableHistory} country={country}/>
        : <p className="mut">No renewable generation history with two or more recorded observations is available in this time window. No values are estimated or backfilled.</p>}
    </section>
    <section className="card energy-market-section">
      <EnergyPriceMovementAnalysis series={history?.series ?? []}/>
    </section>
    {history?.series?.length ? <GridOperationsExplorer series={history.series}/> : null}
    <section className="card energy-market-section"><div className="energy-section-head"><div><h2>Market & renewable signals</h2>
      <div className="mut">Latest source observations; comparisons are limited to values with compatible timestamps and units.</div></div></div>
      <MarketSignals metrics={metrics} comparisons={data?.marketComparisons ?? []} country={country}/>
    </section>
    <GenerationDemandPanel metrics={metrics} country={country}/>
    <ReserveMarketPanel metrics={country === 'ALL' ? metrics : metrics.filter(row => row.country === country)}/>
    <section className="card energy-analysis-section"><div className="energy-section-head"><div><h2>Evidence-based observations</h2>
      <div className="mut">Deterministic comparisons of measurements; not incident declarations or forecasts.</div></div></div>
      {analysis?.observations?.length ? <div className="energy-observations">{analysis.observations.map(o =>
        <article className="energy-observation" key={o.id}><div className="energy-observation-title">
          <span className={'energy-severity severity-' + o.severity}>{o.severity}</span><b>{o.title}</b></div>
          <p>{o.summary}</p><div className="mut">Observed {fmtTime(o.observedAt)} · confidence: {o.confidence}</div>
          <p className="mut">{o.caveat}</p>
          <details><summary>Evidence ({o.evidence.length} measurements)</summary><ul>{o.evidence.map((e,i) =>
            <li key={i}>{e.indicator}: {e.value} {e.unit} · {e.source} · {fmtTime(e.ts)}</li>)}</ul></details>
        </article>)}</div> : <p className="mut">No observations can currently be derived from matching, timestamp-aligned measurements.</p>}
      <div className="mut">{analysis?.methodology}</div>
    </section>
    <div className="energy-lower-grid"><section className="card"><h2>Generation mix · {country === 'ALL' ? 'reported country technologies' : COUNTRY_NAMES[country]}</h2><GenerationMix metrics={metrics} country={country}/></section>
      <section className="card"><h2>Cross-border physical flows · Nordic context</h2>
        {data?.flows?.length ? <div className="energy-table-wrap"><table><thead><tr><th>Förbindelse</th><th>MW</th><th>Källa</th><th>Mättid</th></tr></thead><tbody>
          {data.flows.map((f, i) => <tr key={f.source + '-' + f.name + '-' + i}><td><b>{Number(f.attrs?.mw) < 0 ? (f.attrs?.to ?? '—') : (f.attrs?.from ?? '—')} → {Number(f.attrs?.mw) < 0 ? (f.attrs?.from ?? '—') : (f.attrs?.to ?? '—')}</b></td><td className="mono">{Math.abs(Number(f.attrs?.mw)).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}</td><td>{f.sourceName}</td><td>{fmtTime(f.updated)}</td></tr>)}
        </tbody></table></div> : <p className="mut">Inga flödeslänkar tillgängliga i valt urval just nu.</p>}
      </section></div>
    <section className="card"><div className="energy-section-head"><div><h2>Collector health & source coverage</h2><p className="mut">Fetch execution, configured polling cadence and upstream observation age are shown separately.</p></div></div>
      <EnergySourceHealth sources={data?.sources ?? []}/>
    </section>
    <p className="mut energy-footnote">Data sources include Svenska kraftnät, Statnett, Energi Data Service, Energinet and Landsnet. Frontend refresh frequency does not guarantee that upstream providers publish new measurements at the same cadence.</p>
  </div>;
}
