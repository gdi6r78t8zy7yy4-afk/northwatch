import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchDashboard } from '../api.js';
import { COUNTRY_NAMES } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import { MetricsTable, EventsTable } from '../components/RecordsTables.jsx';

export default function DashboardPage({ country }) {
  const { id } = useParams();
  const areaId = Number(id);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

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

      {area.geo && (
        <div className="card">
          <h2>Karta</h2>
          <div className="mapbox">Interaktiv karta med geo-data kommer i M3 (Leaflet + geolager från backend)</div>
        </div>
      )}

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
                  <td>{s.lastOk ? new Date(s.lastOk).toLocaleTimeString('sv-SE') : '–'}</td>
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
