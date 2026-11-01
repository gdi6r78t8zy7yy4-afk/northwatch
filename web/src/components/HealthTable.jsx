import React from 'react';
import { Link } from 'react-router-dom';
import { fmtTime, fmtAge } from '../status.js';

export default function HealthTable({ health, areas = [] }) {
  if (!health?.length) return <div className="mut">Inga källor registrerade ännu.</div>;
  const areaName = id => areas.find(a => a.id === id);
  return (
    <table>
      <thead>
        <tr><th>Källa</th><th>Område</th><th>Land</th><th>Status</th><th>Senast OK</th><th>Fel</th></tr>
      </thead>
      <tbody>
        {health.map(h => {
          const a = areaName(h.area);
          return (
            <tr key={h.id}>
              <td className="mono">{h.name} <span className="mut">({h.id})</span></td>
              <td>
                {a ? <Link to={`/d/${a.id}`}>{a.id}. {a.short}</Link> : h.area}
              </td>
              <td>{h.country === 'NORDIC' ? 'Nordiskt' : h.country}</td>
              <td><span className={`pill ${h.status === 'ok' ? 'st-ok' : h.status === 'error' ? 'st-err' : h.status === 'stale' || h.status === 'no_key' ? 'st-warn' : 'st-mut'}`}>{
                h.status === 'ok' ? 'OK' : h.status === 'error' ? 'Fel' :
                h.status === 'no_key' ? 'Saknar nyckel' : h.status === 'stale' ? 'Föråldrad' : 'Hämtar…'
              }</span></td>
              <td>{fmtTime(h.lastOk)} {h.lastOk && <span className="mut">({fmtAge(h.lastOk)})</span>}</td>
              <td className="mut">{h.error ?? '–'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
