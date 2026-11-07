import React, { useEffect, useMemo, useState } from 'react';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import MapPanel from '../components/MapPanel.jsx';
import { fetchEnergyOverview, fetchEnergyHistory, fetchEnergyAnalysis, fetchAssets, fetchStaticGeo } from '../api.js';

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
    <div className="mut">{metric ? metric.sourceName + ' · ' + age(metric.ts) : fallback}</div></div>;
}
function GenerationMix({ metrics }) {
  const wind = findMetric(metrics, r => r.indicator === 'Vindproduktion (DK)');
  const solar = findMetric(metrics, r => r.indicator === 'Solproduktion (DK)');
  const total = findMetric(metrics, r => r.indicator === 'Total produktion (DK)');
  if (!wind || !solar || !total || wind.ts !== solar.ts || wind.ts !== total.ts) return <p className="mut">Ofullständig produktionsmix. Vind, sol och total produktion måste finnas för samma uppdatering innan mixen visas.</p>;
  const parts = [{ name: 'Vind', value: Number(wind.value) }, { name: 'Sol', value: Number(solar.value) },
    { name: 'Övrigt', value: Math.max(0, Number(total.value) - Number(wind.value) - Number(solar.value)) }];
  const sum = parts.reduce((a, p) => a + p.value, 0);
  return <><div className="energy-mixbar" aria-label="Danmarks produktionsmix">{parts.map(p => <span key={p.name} style={{ width: (sum ? p.value / sum * 100 : 0) + '%' }} title={p.name + ': ' + p.value + ' MW'} />)}</div>
    <div className="energy-legend">{parts.map(p => <span key={p.name}>{p.name}: {Math.round(p.value).toLocaleString('sv-SE')} MW</span>)}</div>
    <p className="mut">Övrigt är total produktion minus rapporterad vind och sol; det är inte en fullständig bränslespecifikation.</p></>;
}
function TrendChart({ series }) {
  const points = series.points ?? [];
  if (points.length < 2) return <div className="energy-chart-empty">Insufficient history · {points.length} observation(s)</div>;
  const values = points.map(p => p.value);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const path = points.map((p, i) => {
    const x = 8 + i / (points.length - 1) * 284;
    const y = 76 - (p.value - min) / span * 62;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
  const first = points[0], last = points[points.length - 1];
  const delta = last.value - first.value;
  return <div className="energy-chart">
    <div className="energy-chart-meta"><b>{series.indicator}</b><span>{series.country} · {series.source} · {series.unit}</span></div>
    <svg viewBox="0 0 300 88" role="img" aria-label={series.indicator + ' historical trend'}>
      <path d="M8 76 H292" stroke="currentColor" opacity=".18" fill="none"/>
      <path d={path} stroke="#68a9e8" strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx="292" cy={76 - (last.value - min) / span * 62} r="3.5" fill="#68a9e8"/>
    </svg>
    <div className="energy-chart-values"><span>{first.value.toLocaleString('sv-SE')} {series.unit}</span><b>{last.value.toLocaleString('sv-SE')} {series.unit}</b></div>
    <div className="mut">Förändring {delta > 0 ? '+' : ''}{delta.toLocaleString('sv-SE')} {series.unit} · {points.length} mätpunkter</div>
  </div>;
}


function HistoryExplorer({ series }) {
  const keys = useMemo(() => series.map(s => [s.country,s.source,s.indicator,s.unit].join('|')), [series]);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    setSelected(current => current === null ? keys.slice(0, 6) : current.filter(key => keys.includes(key)));
  }, [keys.join('||')]);
  const visible = series.filter(s => selected?.includes([s.country,s.source,s.indicator,s.unit].join('|')));
  const toggle = key => setSelected(current => {
    const active = current ?? keys.slice(0, 6);
    return active.includes(key) ? active.filter(item => item !== key)
      : active.length < 8 ? [...active, key] : active;
  });
  return <>
    <div className="energy-series-picker" aria-label="Choose historical series">
      {series.map(s => {
        const key = [s.country,s.source,s.indicator,s.unit].join('|');
        const active = selected?.includes(key);
        return <button type="button" key={key} className={'energy-series-chip' + (active ? ' on' : '')}
          aria-pressed={Boolean(active)} onClick={() => toggle(key)}>
          <span>{s.country}</span> {s.indicator}
        </button>;
      })}
    </div>
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

function MarketSignals({ metrics }) {
  const priceGroups = new Map();
  const now = Date.now();
  for (const row of metrics.filter(r => /^Dag-ahead-pris /.test(r.indicator) && Number.isFinite(Number(r.value)) && Number.isFinite(Date.parse(r.ts ?? '')))) {
    const key = `${row.indicator}|${row.source}`;
    const previous = priceGroups.get(key);
    const at = Date.parse(row.ts);
    // For day-ahead interval series, show the interval active now. If the
    // source only has future prices, show the nearest upcoming interval.
    const rank = at <= now ? now - at : Number.MAX_SAFE_INTEGER + at;
    if (!previous || rank < previous.rank) priceGroups.set(key, { row, rank });
  }
  const prices = [...priceGroups.values()].map(item => item.row)
    .sort((a, b) => a.indicator.localeCompare(b.indicator) || a.source.localeCompare(b.source));
  const wind = findMetric(metrics, r => r.indicator === 'Vindproduktion (DK)');
  const solar = findMetric(metrics, r => r.indicator === 'Solproduktion (DK)');
  const total = findMetric(metrics, r => r.indicator === 'Total produktion (DK)');
  const aligned = wind && solar && total && wind.ts === solar.ts && wind.ts === total.ts &&
    wind.unit === solar.unit && wind.unit === total.unit && Number(total.value) > 0;
  const renewable = aligned ? Number(wind.value) + Number(solar.value) : null;
  const share = aligned ? renewable / Number(total.value) * 100 : null;
  return <div className="energy-market-grid">
    <div className="energy-market-panel">
      <h3>Day-ahead prices</h3>
      {prices.length ? <div className="energy-price-grid">{prices.map(row =>
        <div className="energy-price-cell" key={row.indicator + '|' + row.source}>
          <span>{row.indicator.replace(/^Dag-ahead-pris\\s+/, '')}</span><b>{Number(row.value).toLocaleString('sv-SE',{maximumFractionDigits:4})} <small>{row.unit}</small></b>
          <span className="mut">{row.sourceName ?? row.source} · {fmtTime(row.ts)}</span>
        </div>)}</div>
        : <p className="mut">No comparable day-ahead price observations are currently available from connected sources.</p>}
      <p className="mut">Prices are shown as published by each source. Currency and unit are retained; values are not converted. Spot prices exclude VAT, supplier markups and taxes.</p>
      <p className="mut">Swedish bidding-zone prices: <a href="https://www.elprisetjustnu.se" target="_blank" rel="noreferrer">Elpriset just nu.se</a>.</p>
      <div className="energy-spread-section">
        <h4>Aligned Nordic price spreads</h4>
        {comparisons.length ? <div className="energy-spread-list">{comparisons.slice(0, 6).map(snapshot =>
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
      </div>
    </div>
    <div className="energy-market-panel">
      <h3>Wind + solar · Denmark</h3>
      {aligned ? <>
        <div className="energy-renewable-value">{share.toLocaleString('sv-SE',{maximumFractionDigits:1})}%</div>
        <div className="energy-renewable-track"><span style={{width:Math.max(0,Math.min(100,share))+'%'}}/></div>
        <div className="energy-price-grid">
          <div className="energy-price-cell"><span>Wind</span><b>{Number(wind.value).toLocaleString('sv-SE')} MW</b></div>
          <div className="energy-price-cell"><span>Solar</span><b>{Number(solar.value).toLocaleString('sv-SE')} MW</b></div>
        </div>
        <p className="mut">Share of reported Danish production at {fmtTime(total.ts)}. This is not a full generation-mix breakdown.</p>
      </> : <p className="mut">Renewable share is unavailable until wind, solar and total production have matching timestamps and units.</p>}
    </div>
  </div>;
}



function GenerationDemandPanel({ metrics }) {
  const countries = ['SE', 'NO', 'DK', 'FI', 'IS'];
  const latestFor = (country, indicator) => metrics
    .filter(r => r.country === country && r.indicator === indicator &&
      r.value != null && Number.isFinite(Number(r.value)) && r.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;
  const rows = countries.map(country => {
    const generation = latestFor(country, `Total produktion (${country})`);
    const demand = latestFor(country, `Total förbrukning (${country})`);
    const wind = latestFor(country, `Vindproduktion (${country})`);
    const solar = latestFor(country, `Solproduktion (${country})`);
    const combinedRenewables = latestFor(country, `Vind+sol-produktion ${country}`);
    let renewable = combinedRenewables;
    if (wind && solar && wind.ts === solar.ts && wind.unit === solar.unit) {
      renewable = { value: Number(wind.value) + Number(solar.value), unit: wind.unit,
        ts: wind.ts, sourceName: wind.sourceName ?? wind.source };
    }
    const aligned = generation && demand && generation.ts === demand.ts && generation.unit === demand.unit;
    const renewableAligned = renewable && generation && renewable.ts === generation.ts &&
      renewable.unit === generation.unit && Number(generation.value) > 0;
    if (!generation && !demand && !renewable) return null;
    return { country, generation, demand, renewable,
      balance: aligned ? Number(generation.value) - Number(demand.value) : null,
      renewableShare: renewableAligned ? Number(renewable.value) / Number(generation.value) * 100 : null,
      aligned };
  }).filter(Boolean);
  const value = metric => metric
    ? Number(metric.value).toLocaleString('sv-SE', { maximumFractionDigits: 1 }) + ' ' + metric.unit
    : '—';
  return <section className="card energy-generation-section">
    <div className="energy-section-head"><div><h2>Generation & demand · Nordic comparison</h2>
      <div className="mut">Country-level production and consumption, using the latest source observations available for each country.</div></div>
      <span className="tag">{rows.length} countries with data</span>
    </div>
    {rows.length ? <div className="energy-generation-grid">{rows.map(row => <article className="energy-generation-country" key={row.country}>
      <div className="energy-generation-country-head"><b>{COUNTRY_NAMES[row.country] ?? row.country}</b>
        <span className="mut">{row.generation?.sourceName ?? row.demand?.sourceName ?? row.renewable?.sourceName ?? 'Source measurement'}</span></div>
      <div className="energy-generation-values">
        <div><span>Production</span><b>{value(row.generation)}</b></div>
        <div><span>Consumption</span><b>{value(row.demand)}</b></div>
        <div><span>Wind + solar</span><b>{value(row.renewable)}</b></div>
      </div>
      <div className="energy-generation-assessment">
        {row.aligned ? <span className={row.balance < 0 ? 'energy-balance deficit' : 'energy-balance surplus'}>
          Domestic balance {row.balance > 0 ? '+' : ''}{row.balance.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} {row.generation.unit}
        </span> : <span className="mut">Balance unavailable · timestamps or units do not align</span>}
        {row.renewableShare != null ? <span className="mut">Wind + solar: {row.renewableShare.toLocaleString('sv-SE', { maximumFractionDigits: 1 })}% of reported production</span>
          : <span className="mut">Renewable share unavailable · requires aligned wind, solar and total production</span>}
      </div>
      <div className="mut energy-generation-time">Latest observation: {fmtTime(row.generation?.ts ?? row.demand?.ts ?? row.renewable?.ts)}</div>
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

export default function EnergyDashboard({ country = 'ALL' }) {
  const [data, setData] = useState(null), [assets, setAssets] = useState([]), [geo, setGeo] = useState(null);
  const [error, setError] = useState(null), [updated, setUpdated] = useState(null);
  const [historyRange, setHistoryRange] = useState('24h'), [history, setHistory] = useState(null), [analysis, setAnalysis] = useState(null);
  useEffect(() => {
    let stopped = false;
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
  const kpi = useMemo(() => ({
    export: findMetric(metrics, r => r.indicator === 'Svensk nettoexport (SE1–SE4)'),
    generation: findMetric(metrics, r => r.indicator === 'Total produktion (DK)'),
    demand: findMetric(metrics, r => r.indicator === 'Total förbrukning (DK)'),
    co2: findMetric(metrics, r => r.indicator === 'CO2-intensitet (DK)'),
    mfrr: findMetric(metrics, r => r.indicator.startsWith('Mfrr-efterfrågan DK1+DK2')),
  }), [metrics]);
  const status = !data?.sources?.length ? 'none' : data.sources.some(s => s.status === 'error') ? 'error'
    : data.sources.some(s => s.status === 'no_key') ? 'no_key' : data.sources.some(s => s.status === 'stale') ? 'stale' : 'ok';
  return <div className="energy-page">
    <header className="energy-heading"><div><div className="energy-eyebrow">NORTHWATCH / OPERATIONAL ENERGY</div>
      <h1>Nordic Energy Situation <StatusPill status={status} /></h1>
      <p className="mut">Elförsörjning, gränsflöden, balans och källornas aktualitet · {country === 'ALL' ? 'Alla länder' : COUNTRY_NAMES[country]}</p></div>
      <div className="energy-updated"><span className="dot" /> Uppdateras var 60:e sekund<br/><span className="mut">Senast hämtad: {updated ? fmtTime(updated) : '—'}</span></div></header>
    {error && <div className="card"><StatusPill status="error"/> <span className="mut">Kunde inte uppdatera energivyn: {error}. Visar senast hämtade data om sådan finns.</span></div>}
    <div className="energy-kpis">
      <Kpi label="Svensk nettoexport" metric={kpi.export} fallback="Ingen aktuell SVK-mätning"/>
      <Kpi label="Produktion · Danmark" metric={kpi.generation} fallback="Ej täckt i valt urval"/>
      <Kpi label="Förbrukning · Danmark" metric={kpi.demand} fallback="Ej täckt i valt urval"/>
      <Kpi label="CO₂-intensitet · Danmark" metric={kpi.co2} fallback="Ej täckt i valt urval"/>
      <Kpi label="mFRR-behov · Danmark" metric={kpi.mfrr} fallback="Ingen aktuell mFRR-mätning"/>
    </div>
    <div className="energy-main-grid">
      <section className="card energy-map-card"><div className="energy-section-head"><div><h2>Nordic grid · live observations</h2>
        <div className="mut">Zonankare och vissa länkar är schematiska approximationer, inte verifierad fysisk nätgeometri.</div></div><span className="tag">{data?.coverage?.flowCount ?? 0} flödeslänkar</span></div>
        <MapPanel area={ENERGY_AREA} country={country} assets={assets} staticGeo={geo} events={[]}/></section>
      <section className="card energy-assessment"><h2>Operational assessment</h2>
        <div className="energy-assessment-row"><span className="mut">Källor i urvalet</span><b>{data?.coverage?.sourceCount ?? '—'}</b></div>
        <div className="energy-assessment-row"><span className="mut">Mätvärden</span><b>{data?.coverage?.metricCount ?? '—'}</b></div>
        <div className="energy-assessment-row"><span className="mut">Flödeslänkar</span><b>{data?.coverage?.flowCount ?? '—'}</b></div>
        <div className="energy-note"><b>Datatolkning</b><p>Värden visas med källans mättid. Fördröjda, frysta eller framtida leveransblock ska inte tolkas som momentan driftstatus.</p></div>
        <div className="energy-note"><b>Täckningsluckor</b><p>Verifierat liveunderlag är ojämnt mellan länder. Finland kräver Fingrid-nyckel och dataset; Island saknar ännu ansluten elkälla. Marknadspriser och full nordisk produktionsmix är inte komplett integrerade.</p></div>
      </section>
    </div>
    <section className="card energy-history-section">
      <div className="energy-section-head"><div><h2>Historical measurements & trends</h2>
        <div className="mut">Collector snapshots stored with their original measurement timestamps.</div></div>
        <select aria-label="History range" value={historyRange} onChange={e => setHistoryRange(e.target.value)}>
          <option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
        </select></div>
      {history?.series?.length ? <HistoryExplorer series={history.series}/>
        : <p className="mut">Historical data is accumulating. Charts will populate as new collector measurements are recorded; the system does not backfill invented values.</p>}
      <div className="mut energy-history-meta">{history?.count ?? 0} observations · range {history?.from ? fmtTime(history.from) : '—'} – {history?.to ? fmtTime(history.to) : '—'}</div>
    </section>
    {history?.series?.length ? <GridOperationsExplorer series={history.series}/> : null}
    <section className="card energy-market-section"><div className="energy-section-head"><div><h2>Market & renewable signals</h2>
      <div className="mut">Latest source observations; comparisons are limited to values with compatible timestamps and units.</div></div></div>
      <MarketSignals metrics={metrics} comparisons={data?.marketComparisons ?? []}/>
    </section>
    <GenerationDemandPanel metrics={metrics}/>
    <ReserveMarketPanel metrics={metrics}/>
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
    <div className="energy-lower-grid"><section className="card"><h2>Generation mix · Denmark</h2><GenerationMix metrics={metrics}/></section>
      <section className="card"><h2>Cross-border physical flows</h2>
        {data?.flows?.length ? <div className="energy-table-wrap"><table><thead><tr><th>Förbindelse</th><th>MW</th><th>Källa</th><th>Mättid</th></tr></thead><tbody>
          {data.flows.map((f, i) => <tr key={f.source + '-' + f.name + '-' + i}><td><b>{Number(f.attrs?.mw) < 0 ? (f.attrs?.to ?? '—') : (f.attrs?.from ?? '—')} → {Number(f.attrs?.mw) < 0 ? (f.attrs?.from ?? '—') : (f.attrs?.to ?? '—')}</b></td><td className="mono">{Math.abs(Number(f.attrs?.mw)).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}</td><td>{f.sourceName}</td><td>{fmtTime(f.updated)}</td></tr>)}
        </tbody></table></div> : <p className="mut">Inga flödeslänkar tillgängliga i valt urval just nu.</p>}
      </section></div>
    <section className="card"><h2>Source coverage & freshness</h2>
      {data?.sources?.length ? <div className="energy-table-wrap"><table><thead><tr><th>Källa</th><th>Land</th><th>Status</th><th>Poster</th><th>Senast OK</th><th>Fel</th></tr></thead><tbody>
        {data.sources.map(s => <tr key={s.id}><td><b>{s.name}</b><div className="mut mono">{s.id}</div></td><td>{s.country === 'NORDIC' ? 'Nordiskt' : COUNTRY_NAMES[s.country] ?? s.country}</td><td><StatusPill status={s.status}/></td><td className="mono">{s.records}</td><td>{s.lastOk ? fmtTime(s.lastOk) : '—'}</td><td className="mut">{s.error ?? '—'}</td></tr>)}
      </tbody></table></div> : <p className="mut">Inväntar energikällor…</p>}
    </section>
    <p className="mut energy-footnote">Datakällor: Svenska kraftnät, Statnett, Energi Data Service och Energinet. Frontendens uppdateringsintervall garanterar inte att upstream-källorna publicerar nya mätvärden lika ofta.</p>
  </div>;
}
