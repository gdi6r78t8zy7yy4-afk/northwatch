import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchDashboard, fetchAssets, fetchStaticGeo, fetchForecastMeta } from '../api.js';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import MapPanel from '../components/MapPanel.jsx';
import WeatherForecastPanel from '../components/WeatherForecastPanel.jsx';
import { MetricsTable, EventsTable } from '../components/RecordsTables.jsx';
import CyberNvdPanel from '../components/CyberNvdPanel.jsx';
import CyberKevPanel from '../components/CyberKevPanel.jsx';
import CyberOsvPanel from '../components/CyberOsvPanel.jsx';
import CyberPrioritizedPanel from '../components/CyberPrioritizedPanel.jsx';

export default function DashboardPage({ country }) {
  const { id } = useParams();
  const areaId = Number(id);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [assets, setAssets] = useState([]);
  const [staticGeo, setStaticGeo] = useState(null);
  const [fcstMeta, setFcstMeta] = useState(null);
  const [customPoint, setCustomPoint] = useState(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await fetchDashboard(areaId, country);
        if (!stop) { setData(d); setErr(null); }
      } catch (e) {
        if (!stop) setErr(e.message);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [areaId, country]);

  // M3: geolager (OSM/PeeringDB/Statnett-asset) pollas parallellt.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await fetchAssets(areaId, country);
        if (!stop) setAssets(d.assets ?? []);
      } catch {
        if (!stop) setAssets([]);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [areaId, country]);

  // M3: statiska kartlager (landsgränser + energi) hämtas en gång.
  useEffect(() => {
    let stop = false;
    fetchStaticGeo()
      .then(d => { if (!stop) setStaticGeo(d); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);

  // M8: väderprognos (område 11): meta pollas var 30:e sekund och delas av
  // panelen (punktprognoser) och kartan (prognosrutnät). Meta är
  // kompletterande – ett misslyckande fäller inte dashboarden.
  const wxArea = areaId === 11;
  useEffect(() => {
    if (!wxArea) return undefined;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetchForecastMeta();
        if (!stop && r.ok && r.body) setFcstMeta(r.body);
      } catch { /* tyst – se kommentar */ }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [wxArea]);

  // M8: klick på kartan → prognos för valfri plats (2 decimaler räcker –
  // backend cachar anpassade platser per 3 decimaler).
  const handleMapClick = ({ lat, lon }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const rlat = Math.round(lat * 100) / 100;
    const rlon = Math.round(lon * 100) / 100;
    setCustomPoint({ name: `Anpassad plats (${rlat}, ${rlon})`, lat: rlat, lon: rlon });
  };

  if (Number.isNaN(areaId)) {
    return <div className="card"><span className="pill st-err">Okänt område</span></div>;
  }
  if (err) {
    return <div className="card"><span className="pill st-err">Kunde inte hämta dashboard</span> <span className="mut">{err} – är backend uppe?</span></div>;
  }
  if (!data) {
    return <div className="card mut">Hämtar dashboard {areaId}…</div>;
  }

  const { area, records, sources } = data;
  const srcStatus = sources.length
    ? (sources.some(s => s.status === 'error') ? 'error'
      : sources.some(s => s.status === 'no_key') ? 'no_key'
      : sources.some(s => s.status === 'stale') ? 'stale'
      : 'ok')
    : 'none';

  return (
    <>
      <h1>
        {area.id}. {area.name}{' '}
        <StatusPill status={srcStatus} />{' '}
        <span className="tag">{country === 'ALL' ? 'Alla länder' : COUNTRY_NAMES[country]}</span>
      </h1>
      <div className="mut" style={{ marginBottom: 12 }}>{area.scope}</div>

      {area.id === 1 && (
        <div className="card" style={{ background: '#131e2e', border: '1px solid #2b5278', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', color: '#93c5fd' }}>⚡ Specialiserad Energi-dashboard tillgänglig</h2>
              <div className="mut">Se detaljerad produktionsmix, spotpriser, elflöden, aFRR/mFRR-reserver och marknadssignaler i realtid.</div>
            </div>
            <a href="#/energy" className="pill" style={{ textDecoration: 'none', background: '#2563eb', color: '#ffffff', padding: '8px 16px', fontWeight: 600 }}>Öppna Energi-dashboarden</a>
          </div>
        </div>
      )}

      {area.geo && (
        <MapPanel
          area={area}
          country={country}
          assets={assets}
          staticGeo={staticGeo}
          events={records.filter(r => r.t === 'e' && r.geo)}
          forecastMeta={wxArea ? fcstMeta : null}
          onMapClick={wxArea ? handleMapClick : undefined}
        />
      )}

      {wxArea && (
        <WeatherForecastPanel
          meta={fcstMeta}
          customPoint={customPoint}
          onClearCustom={() => setCustomPoint(null)}
        />
      )}

      {area.id === 5 ? (
        // M9: cyber (område 5) – de fyra widgeterna ersätter de generiska
        // indikator-/händelse-tabellerna (de innehåller en superset av
        // analysen). Varje panel hämtar sin egen /api/cyber/*-endpoint
        // (120 s-polling); övriga 11 områden är oförändrade.
        <div className="cyber-grid">
          <CyberNvdPanel />
          <CyberKevPanel />
          <CyberOsvPanel />
          <CyberPrioritizedPanel />
        </div>
      ) : (
        <div className="grid">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2>Indikatorer <span className="tag">{records.filter(r => r.t === 'm').length} st</span></h2>
            <MetricsTable records={records} />
          </div>
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h2>Händelser och larm <span className="tag">{records.filter(r => r.t === 'e').length} st</span></h2>
            <EventsTable records={records} />
          </div>
        </div>
      )}

      <div className="card">
        <h2>Källor för området</h2>
        {sources.length ? (
          <table>
            <thead>
              <tr><th>Källa</th><th>Land</th><th>Status</th><th>Senast OK</th><th>Fel</th></tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id}>
                  <td className="mono">{s.name} <span className="mut">({s.id})</span></td>
                  <td>{s.country === 'NORDIC' ? 'Nordiskt' : s.country}</td>
                  <td><StatusPill status={s.status} /></td>
                  <td>{s.lastOk ? fmtTime(s.lastOk) : '–'}</td>
                  <td className="mut">{s.error ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="mut">Inga källor är anslutna till detta område ännu.</div>
        )}
      </div>

      <div className="card gapcard">
        <h2>Kända luckor (enligt API-katalogen)</h2>
        <div className="mut">{area.gaps}</div>
        <div className="mut" style={{ marginTop: 6 }}>
          Klass C-källor (portal/webb, ej verifierat API) visas här tills endpoint-verifiering i M2/M3.
        </div>
      </div>
    </>
  );
}
