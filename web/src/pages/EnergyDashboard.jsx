import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import MapPanel from '../components/MapPanel.jsx';
import EnergyWidget, { WidgetItem } from '../components/EnergyWidget.jsx';
import WidgetDetailModal from '../components/WidgetDetailModal.jsx';
import { fetchEnergyOverview, fetchEnergyHistory, fetchEnergyAnalysis, fetchAssets, fetchStaticGeo } from '../api.js';
import { formatObservationAge } from '../lib/metricFreshness.js';
import { buildEnergyPriceSpreadMovements } from '../lib/energyPriceAnalysis.js';
import {
  WIDGETS, widgetById, priceRows, genDemandRows, mixParts, co2Rows, flowRows,
  reserveRows, spreadData, sourceRows, emptyNote, selectDetailObservations,
} from '../lib/energyWidgets.js';

const ENERGY_AREA = { id: 1, name: 'Elförsörjning och energisystem', short: 'Energi', geo: true };
const MIX_COUNTRIES = ['DK', 'FI', 'IS'];
const fmt = (value, digits = 1) => Number(value).toLocaleString('sv-SE', { maximumFractionDigits: digits });

// —— Widgetkroppar ————————————————————————————————————————————————
function PriceBody({ ctx, openItem }) {
  const rows = priceRows(ctx);
  if (!rows.length) return <p className="mut">{emptyNote('pris', ctx.country)}</p>;
  return <div className="nw-widget-cells">{rows.map(row => <WidgetItem key={`${row.indicator}|${row.zone}`}
    onOpen={() => openItem('pris', row.zone)}>
    <span className="nw-cell-label">{row.zone}{ctx.country === 'ALL' ? ` · ${row.country}` : ''}</span>
    <b>{fmt(row.value, 4)} <small>{row.unit}</small></b>
    <span className="mut">{formatObservationAge(row.ts)}</span>
  </WidgetItem>)}</div>;
}

function GenDemandBody({ ctx, openItem }) {
  const rows = genDemandRows(ctx);
  if (!rows.length) return <p className="mut">{emptyNote('produktion', ctx.country)}</p>;
  return <div className="nw-widget-rows">{rows.map(row => <WidgetItem key={row.country}
    onOpen={() => openItem('produktion', row.country)}>
    <span className="nw-cell-label">{COUNTRY_NAMES[row.country] ?? row.country}</span>
    <b>{row.generation ? `${fmt(row.generation.value)} ${row.generation.unit}` : 'Produktion saknas'}</b>
    <span className="mut">Förbrukning: {row.demand ? `${fmt(row.demand.value)} ${row.demand.unit}` : '—'} · {formatObservationAge(row.generation?.ts ?? row.demand?.ts)}</span>
  </WidgetItem>)}</div>;
}

function BalanceBody({ ctx, openItem }) {
  const rows = genDemandRows(ctx);
  const aligned = rows.filter(row => row.balance != null);
  if (!aligned.length) return <p className="mut">{emptyNote('balans', ctx.country)}</p>;
  return <div className="nw-widget-rows">{aligned.map(row => <WidgetItem key={row.country}
    onOpen={() => openItem('balans', row.country)}>
    <span className="nw-cell-label">{COUNTRY_NAMES[row.country] ?? row.country}</span>
    <b className={row.balance < 0 ? 'energy-balance deficit' : 'energy-balance surplus'}>
      {row.balance > 0 ? '+' : ''}{fmt(row.balance)} {row.generation.unit}
    </b>
    <span className="mut">{formatObservationAge(row.generation.ts)}{row.derivedDemand ? ' · förbrukning SCADA-härledd' : ''}</span>
  </WidgetItem>)}</div>;
}

function MixBody({ ctx, openItem }) {
  const countries = ctx.country === 'ALL' ? MIX_COUNTRIES : [ctx.country];
  const entries = countries.map(code => ({ code, ...mixParts(ctx, code) })).filter(entry => entry.parts.length);
  if (!entries.length) return <p className="mut">{emptyNote('mix', ctx.country)}</p>;
  return <div className="nw-widget-rows">{entries.map(({ code, parts }) => {
    const sum = parts.reduce((acc, part) => acc + Math.max(0, part.value), 0);
    return <WidgetItem key={code} onOpen={() => openItem('mix', code)}>
      <span className="nw-cell-label">{COUNTRY_NAMES[code] ?? code}</span>
      <div className="energy-mixbar" aria-hidden="true">{parts.map(part =>
        <span key={part.name} style={{ width: (sum ? Math.max(0, part.value) / sum * 100 : 0) + '%' }} title={`${part.name}: ${fmt(part.value)} ${part.unit}`}/>)}</div>
      <span className="mut">{parts.map(part => `${part.name} ${Math.round(part.value).toLocaleString('sv-SE')}`).join(' · ')}</span>
    </WidgetItem>;
  })}</div>;
}

function Co2Body({ ctx, openItem }) {
  const rows = co2Rows(ctx);
  if (!rows.length) return <p className="mut">{emptyNote('co2', ctx.country)}</p>;
  return <div className="nw-widget-cells">{rows.map(row => <WidgetItem key={`${row.country}|${row.indicator}|${row.sourceName}`}
    onOpen={() => openItem('co2', row.country)}>
    <span className="nw-cell-label">{COUNTRY_NAMES[row.country] ?? row.country}</span>
    <b>{fmt(row.value)} <small>{row.unit}</small></b>
    <span className="mut">{row.sourceName} · {formatObservationAge(row.ts)}</span>
  </WidgetItem>)}</div>;
}

function FlowBody({ ctx, openItem }) {
  const rows = flowRows(ctx, 6);
  if (!rows.length) return <p className="mut">{emptyNote('floden', ctx.country)}</p>;
  return <div className="nw-widget-rows">{rows.map(row => <WidgetItem key={row.id}
    onOpen={() => openItem('floden', row.label)}>
    <span className="nw-cell-label">{row.label}</span>
    <b>{fmt(Math.abs(row.mw))} MW</b>
    <span className="mut">{row.sourceName} · {formatObservationAge(row.updated)}</span>
  </WidgetItem>)}</div>;
}

function ReserveBody({ ctx, openItem }) {
  const { blockTs, rows } = reserveRows(ctx);
  if (!rows.length) return <p className="mut">{emptyNote('reserv', ctx.country)}</p>;
  return <>
    {blockTs ? <div className="mut nw-widget-ts">Leveransblock {fmtTime(blockTs)}</div> : null}
    <div className="nw-widget-rows">{rows.slice(0, 6).map(row => <WidgetItem key={row.id + row.zone + row.direction}
      onOpen={() => openItem('reserv', `${row.product} ${row.zone}`)}>
      <span className="nw-cell-label">{row.product} · {row.zone} {row.direction === 'up' ? 'upp' : row.direction === 'down' ? 'ner' : ''}</span>
      <b>{row.capacity != null ? `${fmt(row.capacity)} ${row.unit}` : `${fmt(row.value ?? 0)} ${row.unit}`}</b>
      <span className="mut">{row.price != null ? `Pris ${fmt(row.price, 2)} ${row.priceUnit}` : 'Pris saknas'}</span>
    </WidgetItem>)}</div>
  </>;
}

function SpreadBody({ ctx }) {
  const { latest } = spreadData(ctx);
  if (!latest) return <p className="mut">{emptyNote('prisspridning', ctx.country)}</p>;
  return <div className="nw-widget-spread">
    <b>{fmt(latest.spread, 2)} {latest.unit}</b>
    <span className="mut">{latest.zoneCount} zoner · {fmtTime(latest.asOf)}</span>
    <div className="energy-spread-detail"><span>Lägst: {latest.low.zone} · {fmt(latest.low.value, 2)}</span><span>Högst: {latest.high.zone} · {fmt(latest.high.value, 2)}</span></div>
  </div>;
}

function AnalysisBody({ ctx }) {
  const observations = ctx.analysis?.observations ?? [];
  if (!observations.length) return <p className="mut">{emptyNote('analys', ctx.country)}</p>;
  return <div className="nw-widget-rows">{observations.slice(0, 3).map(o => <div className="nw-widget-row-static" key={o.id}>
    <span className={'energy-severity severity-' + o.severity}>{o.severity}</span>
    <b>{o.title}</b>
  </div>)}</div>;
}

function SourcesBody({ ctx }) {
  const rows = sourceRows(ctx);
  if (!rows.length) return <p className="mut">{emptyNote('kallor', ctx.country)}</p>;
  const okCount = rows.filter(s => s.status === 'ok').length;
  return <div className="nw-widget-spread">
    <b>{okCount} / {rows.length}</b>
    <span className="mut">källor rapporterar · {ctx.data?.coverage?.metricCount ?? 0} mätvärden i urvalet</span>
  </div>;
}

// —— Modalinnehåll för widgets utan tidsserier ——————————————————
function SpreadModalContent({ ctx }) {
  const comparisons = ctx.comparisons;
  const movements = buildEnergyPriceSpreadMovements(ctx.country === 'ALL' ? comparisons : []);
  return <>
    <h3 className="nw-modal-subhead">Justerade prismoment</h3>
    {comparisons.length ? <div className="energy-spread-list">{comparisons.slice(0, 8).map(snapshot =>
      <article className="energy-spread-row" key={snapshot.asOf + snapshot.unit}>
        <div className="energy-spread-heading"><b>{fmt(snapshot.spread, 2)} {snapshot.unit}</b><span>{snapshot.zoneCount} elområden · {fmtTime(snapshot.asOf)}</span></div>
        <div className="energy-spread-track" role="img" aria-label={`Lägsta ${snapshot.low.zone} ${snapshot.low.value}; högsta ${snapshot.high.zone} ${snapshot.high.value}`}>
          {snapshot.observations.map(item => <span key={item.zone} style={{ left: (snapshot.high.value === snapshot.low.value ? 50 : (item.value - snapshot.low.value) / (snapshot.high.value - snapshot.low.value) * 100) + '%' }} title={`${item.zone}: ${item.value} ${item.unit}`}><i/></span>)}
        </div>
        <div className="energy-spread-detail"><span>Lägst: {snapshot.low.zone} · {fmt(snapshot.low.value, 2)}</span><span>Högst: {snapshot.high.zone} · {fmt(snapshot.high.value, 2)}</span></div>
        <div className="mut">{snapshot.observations.map(item => `${item.zone} (${item.country}) ${item.sourceName}`).join(' · ')}</div>
      </article>)}</div>
      : <p className="mut">Inga justerade prismoment ännu – minst två elområden måste rapportera samma tidsstämpel och enhet.</p>}
    {ctx.country === 'ALL' ? <>
      <h3 className="nw-modal-subhead">Spridningsförändring · samma zoner, källor och enhet</h3>
      {movements.length ? movements.slice(0, 4).map(movement => <div className="energy-spread-movement-row" key={movement.unit + movement.markets.join('-')}>
        <b>{movement.change > 0 ? '+' : ''}{fmt(movement.change, 2)} {movement.unit}</b>
        <span>{movement.change > 0 ? 'Vidare spridning' : movement.change < 0 ? 'Snävare spridning' : 'Oförändrad spridning'} · {movement.markets.join(', ')}</span>
        <small>{fmtTime(movement.previousAsOf)} → {fmtTime(movement.latestAsOf)} · {fmt(movement.previousSpread, 2)} → {fmt(movement.latestSpread, 2)} {movement.unit}</small>
      </div>) : <p className="mut">En spridningstrend kräver minst två ögonblick med identiska elområden, källor och enheter.</p>}
    </> : null}
  </>;
}

function AnalysisModalContent({ ctx }) {
  const observations = ctx.analysis?.observations ?? [];
  return <>
    <h3 className="nw-modal-subhead">Deterministiska observationer</h3>
    {observations.length ? <div className="energy-observations">{observations.map(o =>
      <article className="energy-observation" key={o.id}><div className="energy-observation-title">
        <span className={'energy-severity severity-' + o.severity}>{o.severity}</span><b>{o.title}</b></div>
        <p>{o.summary}</p>
        <div className="mut">Observerad {fmtTime(o.observedAt)} · konfidens: {o.confidence}</div>
        <p className="mut">{o.caveat}</p>
        <details><summary>Beläggning ({o.evidence.length} mätvärden)</summary><ul>{o.evidence.map((e, i) =>
          <li key={i}>{e.indicator}: {e.value} {e.unit} · {e.source} · {fmtTime(e.ts)}</li>)}</ul></details>
      </article>)}</div> : <p className="mut">{emptyNote('analys', ctx.country)}</p>}
    {ctx.analysis?.methodology ? <p className="mut">{ctx.analysis.methodology}</p> : null}
  </>;
}

function SourcesModalContent({ ctx }) {
  const rows = sourceRows(ctx);
  if (!rows.length) return <p className="mut">{emptyNote('kallor', ctx.country)}</p>;
  return <>
    <h3 className="nw-modal-subhead">Kollektorkur och status</h3>
    <div className="energy-table-wrap"><table>
      <thead><tr><th>Källa</th><th>Status</th><th>Hämtvarje</th><th>Senast ok</th><th>Poster</th></tr></thead>
      <tbody>{rows.map(s => <tr key={s.id}>
        <td><b>{s.name}</b><div className="mut">{s.country} · {s.id}</div></td>
        <td><StatusPill status={s.status}/></td>
        <td className="mono">{s.every ? `${s.every} s` : '—'}</td>
        <td>{s.lastOk ? fmtTime(s.lastOk) : '—'}</td>
        <td className="mono">{s.records ?? 0}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}

function MapModalContent({ ctx }) {
  return <>
    <MapPanel area={ENERGY_AREA} country={ctx.country} assets={ctx.assets} staticGeo={ctx.geo} events={[]}
      defaultSize="L" sizeStorageKey="nw-energy-mapmodal-size"/>
    <p className="mut">Kartan visar det nordiska nät perspektivet även när ett enskilt land är valt. Zonankare och vissa länkar är schematiska approximationer, inte verifierad fysisk nätgeometri.</p>
  </>;
}

const BODIES = {
  pris: PriceBody, produktion: GenDemandBody, balans: BalanceBody, mix: MixBody,
  co2: Co2Body, floden: FlowBody, reserv: ReserveBody, prisspridning: SpreadBody,
  analys: AnalysisBody, kallor: SourcesBody,
};

export default function EnergyDashboard({ country = 'ALL', onCountryChange }) {
  const [data, setData] = useState(null), [assets, setAssets] = useState([]), [geo, setGeo] = useState(null);
  const [error, setError] = useState(null), [updated, setUpdated] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [params, setParams] = useSearchParams();
  const historyCache = useRef(new Map());

  useEffect(() => {
    let stopped = false;
    setData(null); setAssets([]); historyCache.current.clear();
    const load = async () => {
      try {
        const result = await fetchEnergyOverview(country);
        if (!stopped) { setData(result); setError(null); setUpdated(new Date().toISOString()); }
      } catch (e) { if (!stopped) setError(e.message); }
    };
    load(); const timer = setInterval(load, 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, [country]);

  useEffect(() => {
    let stopped = false;
    setAnalysis(null);
    fetchEnergyAnalysis(country).then(r => { if (!stopped) setAnalysis(r); }).catch(() => {});
    return () => { stopped = true; };
  }, [country]);

  useEffect(() => { let stopped = false; fetchAssets(1, country).then(r => { if (!stopped) setAssets(r.assets ?? []); }).catch(() => {}); return () => { stopped = true; }; }, [country]);
  useEffect(() => { let stopped = false; fetchStaticGeo().then(r => { if (!stopped) setGeo(r); }).catch(() => {}); return () => { stopped = true; }; }, []);

  const metrics = data?.metrics ?? [];
  const comparisons = data?.marketComparisons ?? [];
  const ctx = useMemo(() => ({
    country, metrics, flows: data?.flows ?? [], comparisons, sources: data?.sources ?? [],
    data, assets, geo, analysis,
  }), [country, metrics, data, assets, geo, analysis, comparisons]);

  // Delat historikarkiv per land+intervall – modalen hämtar lazigt och
  // återanvänder färsk cache i stället för att dubbelbella vid byten.
  const getSeries = useCallback(async range => {
    const key = `${country}|${range}`;
    const hit = historyCache.current.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.series;
    const result = await fetchEnergyHistory(country, range);
    const series = result?.series ?? [];
    historyCache.current.set(key, { at: Date.now(), series });
    return series;
  }, [country]);

  const openId = params.get('w');
  const itemId = params.get('i');
  const widget = openId ? widgetById(openId) : null;
  const setParam = (updates, removals = []) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) next.set(key, value);
    for (const key of removals) next.delete(key);
    setParams(next);
  };
  const openWidget = id => setParam({ w: id }, ['i']);
  const openItem = (id, item) => setParam({ w: id, i: item });
  const closeWidget = () => setParam({}, ['w', 'i']);

  const modalHasSeries = Boolean(widget && ['pris', 'produktion', 'balans', 'mix', 'co2', 'floden', 'reserv'].includes(widget.id));
  const observations = useMemo(() => (widget && modalHasSeries)
    ? selectDetailObservations(widget.id, metrics, { country, item: itemId }) : [],
    [widget?.id, metrics, country, itemId, modalHasSeries]);

  const status = !data?.sources?.length ? 'none' : data.sources.some(s => s.status === 'error') ? 'error'
    : data.sources.some(s => s.status === 'no_key') ? 'no_key' : data.sources.some(s => s.status === 'stale') ? 'stale' : 'ok';

  return <div className="energy-page">
    <header className="energy-heading"><div><div className="energy-eyebrow">NORTHWATCH / ENERGI</div>
      <h1>Nordisk energisituation <StatusPill status={status}/></h1>
      <p className="mut">Elförsörjning, gränsflöden, balans och källornas aktualitet · {country === 'ALL' ? 'Alla länder' : COUNTRY_NAMES[country]}</p></div>
      <div className="energy-heading-actions"><div className="energy-updated"><span className="dot"/> Uppdateras var 60:e sekund<br/><span className="mut">Senast hämtad: {updated ? fmtTime(updated) : '—'}</span></div></div></header>

    <div className="energy-country-toolbar" aria-label="Landsurval">
      <label className="energy-country-control"><span>LAND</span><select aria-label="Välj land för energidashboarden" value={country} onChange={event => onCountryChange?.(event.target.value)}><option value="ALL">Alla länder · Nordisk översikt</option>{Object.entries(COUNTRY_NAMES).filter(([code]) => ['SE', 'NO', 'DK', 'FI', 'IS'].includes(code)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <span className="energy-country-scope-note">{country === 'ALL' ? 'Visar hela den nordiska översikten' : `Visar ${COUNTRY_NAMES[country] ?? country}`}</span>
    </div>

    {error ? <div className="card"><StatusPill status="error"/> <span className="mut">Kunde inte uppdatera energivyn: {error}. Visar senast hämtade data om sådan finns.</span></div> : null}

    <div className="nw-widget-grid">{WIDGETS.map(w => {
      const Body = BODIES[w.id];
      return <EnergyWidget key={w.id} widget={w} wide={w.id === 'karta'} onOpen={openWidget}>
        {w.id === 'karta' ? <>
          <MapPanel area={ENERGY_AREA} country={country} assets={assets} staticGeo={geo} events={[]}
            defaultSize="M" sizeStorageKey="nw-energy-mapsize"/>
          <div className="mut nw-widget-ts">{data?.coverage?.flowCount ?? 0} flödeslänkar · klicka för stor karta</div>
        </> : Body ? <Body ctx={ctx} openItem={openItem}/> : null}
      </EnergyWidget>;
    })}</div>

    {widget ? <WidgetDetailModal widget={widget} item={itemId ? { id: itemId, label: itemId } : null}
      country={country} getSeries={modalHasSeries ? getSeries : undefined} observations={observations}
      wide={widget.id === 'karta'} onClose={closeWidget}>
      {widget.id === 'karta' ? <MapModalContent ctx={ctx}/> : null}
      {widget.id === 'prisspridning' ? <SpreadModalContent ctx={ctx}/> : null}
      {widget.id === 'analys' ? <AnalysisModalContent ctx={ctx}/> : null}
      {widget.id === 'kallor' ? <SourcesModalContent ctx={ctx}/> : null}
    </WidgetDetailModal> : null}

    <p className="mut energy-footnote">Datakällor: Svenska kraftnät, Statnett, Energi Data Service, Energinet, Elprisetjustnu.se och Fingrid. Frontendens uppdateringstakt garanterar inte att uppströmsleverantörer publicerar nya mätvärden i samma takt.</p>
  </div>;
}
