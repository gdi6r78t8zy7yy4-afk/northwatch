import React from 'react';
import { fmtTime, fmtAge } from '../status.js';

export function MetricsTable({ records }) {
  const metrics = records.filter(r => r.t === 'm');
  if (!metrics.length) {
    return <div className="mut">Inga indikatorvärden just nu (källan hämtar ännu eller saknar data för valt land).</div>;
  }
  return (
    <table>
      <thead>
        <tr><th>Indikator</th><th>Land</th><th>Värde</th><th>Källa</th><th>Tid</th></tr>
      </thead>
      <tbody>
        {metrics.map((r, i) => (
          <tr key={i}>
            <td>{r.indicator}</td>
            <td>{r.country === 'NORDIC' ? 'Nordiskt' : r.country}</td>
            <td className="mono"><b>{String(r.value ?? '–')}</b> {r.unit}</td>
            <td>{r.sourceName}</td>
            <td>{fmtTime(r.ts)} {r.ts && <span className="mut">({fmtAge(r.ts)})</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EventsTable({ records }) {
  const events = records.filter(r => r.t === 'e');
  if (!events.length) {
    return <div className="mut">Inga händelser/larm rapporteras just nu.</div>;
  }
  return (
    <table>
      <thead>
        <tr><th>Händelse</th><th>Land</th><th>Allvarlighet</th><th>Källa</th><th>Start</th></tr>
      </thead>
      <tbody>
        {events.slice(0, 50).map((r, i) => (
          <tr key={i}>
            <td>{r.title} {r.detail && <div className="mut">{r.detail}</div>}</td>
            <td>{r.country === 'NORDIC' ? 'Nordiskt' : r.country}</td>
            <td>{r.severity ?? '–'}</td>
            <td>{r.sourceName}</td>
            <td>{fmtTime(r.start)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
