import React from 'react';
import { COUNTRY_NAMES, fmtTime } from '../status.js';
import StatusPill from './StatusPill.jsx';
import { formatObservationAge } from '../lib/metricFreshness.js';

const duration = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : '—';
const cadence = value => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds} s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
};

export default function EnergySourceHealth({ sources = [] }) {
  if (!sources.length) return <p className="mut">No energy collectors are reporting in the selected scope.</p>;
  const counts = sources.reduce((result, source) => {
    const key = source.status === 'ok' ? 'ok'
      : source.status === 'stale' ? 'stale'
      : source.status === 'error' ? 'error'
      : source.status === 'no_key' ? 'no_key' : 'other';
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  return <>
    <div className="energy-source-health-summary" aria-label="Collector status summary">
      <span><b>{sources.length}</b> collectors</span>
      <span><b>{counts.ok ?? 0}</b> OK</span>
      <span><b>{counts.stale ?? 0}</b> stale</span>
      <span><b>{counts.error ?? 0}</b> errors</span>
      <span><b>{counts.no_key ?? 0}</b> missing credentials</span>
    </div>
    <div className="energy-table-wrap">
      <table className="energy-source-health-table">
        <thead><tr><th>Source</th><th>Country</th><th>Status</th><th>Poll cadence</th><th>Last attempt</th><th>Last success</th><th>Duration</th><th>Records</th><th>Latest error</th></tr></thead>
        <tbody>{sources.map(source => <tr key={source.id}>
          <td><b>{source.name}</b><div className="mut mono">{source.id}</div></td>
          <td>{source.country === 'NORDIC' ? 'Nordic' : COUNTRY_NAMES[source.country] ?? source.country}</td>
          <td><StatusPill status={source.status}/></td>
          <td className="mono">{cadence(source.every)}</td>
          <td title={source.lastRun ? fmtTime(source.lastRun) : undefined}>
            {source.lastRun ? <>{formatObservationAge(source.lastRun)}<div className="mut">{fmtTime(source.lastRun)}</div></> : '—'}
          </td>
          <td title={source.lastOk ? fmtTime(source.lastOk) : undefined}>
            {source.lastOk ? <>{formatObservationAge(source.lastOk)}<div className="mut">{fmtTime(source.lastOk)}</div></> : '—'}
          </td>
          <td className="mono">{duration(source.ms)}</td>
          <td className="mono">{source.records}</td>
          <td className="mut">{source.error ?? '—'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mut energy-source-health-note">Collector run times describe Northwatch's last fetch attempt; observation timestamps describe when the upstream system measured or published the data. They are different clocks. Poll cadence is the configured target, not a guarantee of upstream publication frequency.</p>
  </>;
}
