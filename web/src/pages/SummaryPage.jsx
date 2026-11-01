import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSummary } from '../api.js';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from '../components/StatusPill.jsx';
import HealthTable from '../components/HealthTable.jsx';

const COLUMNS = ['SE', 'NO', 'DK', 'FI', 'IS', 'NORDIC'];

export default function SummaryPage({ areas, backendDown }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await fetchSummary();
        if (!stop) { setData(d); setErr(null); }
      } catch (e) {
        if (!stop) setErr(e.message);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // areaMatrix från /api/dashboards (TopBar) kan finnas innan /api/summary svarat
  const list = data?.areas?.length ? data.areas : areas;

  return (
    <>
      <h1>Översikt – alla dashboardområden</h1>

      {err && !backendDown && (
        <div className="card"><span className="pill st-err">Kunde inte hämta status</span> <span className="mut">{err}</span></div>
      )}

      {data && (
        <div className="kpis">
          <div className="kpi"><div className="n">{data.kpis.total}</div><div className="l">Källor totalt</div></div>
          <div className="kpi"><div className="n" style={{ color: 'var(--ok)' }}>{data.kpis.ok}</div><div className="l">OK</div></div>
          <div className="kpi"><div className="n" style={{ color: 'var(--warn)' }}>{data.kpis.stale + data.kpis.no_key}</div><div className="l">Föråldrad / saknar nyckel</div></div>
          <div className="kpi"><div className="n" style={{ color: 'var(--err)' }}>{data.kpis.error}</div><div className="l">Fel</div></div>
        </div>
      )}

      <div className="card">
        <h2>Status per område och land <span className="tag">klicka rad för att öppna</span></h2>
        <table>
          <thead>
            <tr>
              <th>Område</th>
              {COLUMNS.map(c => <th key={c}>{c === 'NORDIC' ? 'Nordiskt' : c}</th>)}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map(a => (
              <tr key={a.id} className="area-row" onClick={() => { window.location.hash = `#/d/${a.id}`; }}>
                <td>
                  <b>{a.id}. {a.short}</b>
                  <div className="mut">{a.name}</div>
                </td>
                {COLUMNS.map(c => {
                  const cell = a.cells?.[c];
                  if (!cell) return <td key={c} className="cell mut">–</td>;
                  return (
                    <td key={c} className="cell">
                      <span className={`dot ${cell.status}`} />
                      {cell.count > 0 && <div className="mut mono">{cell.count} {cell.count === 1 ? 'post' : 'poster'}</div>}
                    </td>
                  );
                })}
                <td><StatusPill status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Senaste händelser och värden</h2>
        {data && data.top?.length ? (
          <table>
            <thead>
              <tr><th>Typ</th><th>Beskrivning</th><th>Land</th><th>Källa</th><th>Tid</th></tr>
            </thead>
            <tbody>
              {data.top.map((r, i) => (
                <tr key={i}>
                  <td>{r.t === 'e' ? <span className="pill st-warn">händelse</span> : <span className="pill st-mut">indikator</span>}</td>
                  <td>{r.t === 'e' ? r.title : r.indicator}</td>
                  <td>{r.country === 'NORDIC' ? 'Nordiskt' : r.country}</td>
                  <td>{r.sourceName}</td>
                  <td>{fmtTime(r.t === 'e' ? r.start : r.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="mut">
            {backendDown || err ? 'Backend är inte uppe – starta med `npm run dev`.' : 'Ingen data ännu; källorna hämtas vid uppstart (förstahämtning tar upp till ~20 s).'}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Källhälsa</h2>
        <HealthTable health={data?.health ?? []} areas={list} />
      </div>
    </>
  );
}
