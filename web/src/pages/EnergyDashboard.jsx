import React, { useEffect, useMemo, useState } from 'react';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import MapPanel from '../components/MapPanel.jsx';
import { fetchEnergyOverview, fetchAssets, fetchStaticGeo } from '../api.js';

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
  if (!wind && !solar && !total) return <p className="mut">Ingen verifierad produktionsmix tillgänglig för valt urval. Nuvarande mixdata täcker Danmark.</p>;
  const parts = [{ name: 'Vind', value: Number(wind?.value ?? 0) }, { name: 'Sol', value: Number(solar?.value ?? 0) },
    { name: 'Övrigt', value: Math.max(0, Number(total?.value ?? 0) - Number(wind?.value ?? 0) - Number(solar?.value ?? 0)) }];
  const sum = parts.reduce((a, p) => a + p.value, 0);
  return <><div className="energy-mixbar" aria-label="Danmarks produktionsmix">{parts.map(p => <span key={p.name} style={{ width: (sum ? p.value / sum * 100 : 0) + '%' }} title={p.name + ': ' + p.value + ' MW'} />)}</div>
    <div className="energy-legend">{parts.map(p => <span key={p.name}>{p.name}: {Math.round(p.value).toLocaleString('sv-SE')} MW</span>)}</div>
    <p className="mut">Övrigt är total produktion minus rapporterad vind och sol; det är inte en fullständig bränslespecifikation.</p></>;
}
export default function EnergyDashboard({ country = 'ALL' }) {
  const [data, setData] = useState(null), [assets, setAssets] = useState([]), [geo, setGeo] = useState(null);
  const [error, setError] = useState(null), [updated, setUpdated] = useState(null);
  useEffect(() => {
    let stopped = false;
    const load = async () => { try { const result = await fetchEnergyOverview(country); if (!stopped) { setData(result); setError(null); setUpdated(new Date().toISOString()); } }
      catch (e) { if (!stopped) setError(e.message); } };
    load(); const timer = setInterval(load, 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, [country]);
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
    <div className="energy-lower-grid"><section className="card"><h2>Generation mix · Denmark</h2><GenerationMix metrics={metrics}/></section>
      <section className="card"><h2>Cross-border physical flows</h2>
        {data?.flows?.length ? <div className="energy-table-wrap"><table><thead><tr><th>Förbindelse</th><th>MW</th><th>Källa</th><th>Mättid</th></tr></thead><tbody>
          {data.flows.map((f, i) => <tr key={f.source + '-' + f.name + '-' + i}><td><b>{f.attrs?.from ?? '—'} → {f.attrs?.to ?? '—'}</b></td><td className="mono">{Number(f.attrs?.mw).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}</td><td>{f.sourceName}</td><td>{fmtTime(f.updated)}</td></tr>)}
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
