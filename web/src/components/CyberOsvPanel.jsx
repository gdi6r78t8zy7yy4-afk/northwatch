// M9: OSV-widget (område 5) – sårbarhetsrapporter (OSV.dev) mot det
// övervakade paketutbudet per ekosystem, med senaste 90 dagarnas tillväxt,
// ekosystemfilter och expanderade paket (rapporter med osv.dev-länk).
import React, { useState } from 'react';
import { fetchCyberOsv } from '../api.js';
import { fmtTime } from '../status.js';
import {
  SeverityBadge, KpiRow, BarList, useFeed, WidgetShell, WidgetBody,
} from './CyberBits.jsx';

export default function CyberOsvPanel() {
  const [eco, setEco] = useState('');
  const [expanded, setExpanded] = useState(null);
  const { data, error, loading, reload } = useFeed(
    () => fetchCyberOsv({ ecosystem: eco }),
    120000, [eco],
  );

  const d = data;
  return (
    <WidgetShell
      title="OSV.dev – paketutbud och rapporter"
      fetchedAt={d?.fetchedAt}
      error={error}
      onRetry={reload}
    >
      <WidgetBody loading={loading} error={error} data={d}>
        {d && (
          <>
            <KpiRow items={[
              { label: 'Övervakade paket', value: d.packageCount },
              { label: `Rapporter senaste ${d.windowDays} d`, value: d.total },
              { label: 'Nya senaste 90 d', value: d.new90 },
              { label: 'Paket med fel', value: d.errorCount },
            ]} />

            <div className="mut">Rapporter per ekosystem</div>
            <BarList
              items={d.byEcosystem.map(e => ({
                label: `${e.ecosystem} (${e.packages} pkt)`, n: e.advisories,
              }))}
            />

            <div className="chips">
              <button
                type="button"
                className={`chip${eco === '' ? ' on' : ''}`}
                onClick={() => { setEco(''); setExpanded(null); }}
              >
                Alla
              </button>
              {d.byEcosystem.map(e => (
                <button
                  key={e.ecosystem}
                  type="button"
                  className={`chip${eco === e.ecosystem ? ' on' : ''}`}
                  onClick={() => { setEco(e.ecosystem); setExpanded(null); }}
                >
                  {e.ecosystem}
                </button>
              ))}
            </div>

            <table>
              <thead>
                <tr><th>Paket</th><th>Ekosystem</th><th>Rapporter</th><th>Nya 90 d</th></tr>
              </thead>
              <tbody>
                {d.packages.map(p => (
                  <React.Fragment key={`${p.ecosystem}:${p.name}`}>
                    <tr
                      className="cyber-row"
                      onClick={() => setExpanded(expanded === `${p.ecosystem}:${p.name}` ? null : `${p.ecosystem}:${p.name}`)}
                    >
                      <td className="mono">{p.name}{p.status === 'error' ? ' ⚠' : ''}</td>
                      <td>{p.ecosystem}</td>
                      <td className="mono">{p.total}</td>
                      <td className="mono">{p.new90}</td>
                    </tr>
                    {expanded === `${p.ecosystem}:${p.name}` && (
                      <tr className="detail-row">
                        <td colSpan={4}>
                          {p.status === 'error' ? (
                            <div className="mut" style={{ color: 'var(--warn)' }}>Hämtfel: {p.error}</div>
                          ) : p.recent.length ? (
                            <div className="osv-list">
                              {p.recent.slice(0, 10).map(a => (
                                <div className="osv-item" key={a.id}>
                                  <SeverityBadge severity={a.severity} />
                                  <span className="mono">{a.id}</span>
                                  {a.alias && a.alias !== a.id && <span className="mut mono">({a.alias})</span>}
                                  <span className="mut">{(a.published ?? '').slice(0, 10)}</span>
                                  {a.link && (
                                    <a href={a.link} target="_blank" rel="noreferrer">{a.link}</a>
                                  )}
                                </div>
                              ))}
                              {p.recent.length > 10 && (
                                <div className="mut">… och {p.recent.length - 10} äldre rapporter</div>
                              )}
                            </div>
                          ) : (
                            <div className="mut">
                              Inga rapporter inom {d.windowDays} d – paketet har inga kända
                              (nya) sårbarheter i OSV.dev just nu.
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="mut">
              {d.packages.length} paket övervakas (OSV_WATCH_PACKAGES) ·
              rapporter publicerade senaste {d.windowDays} d · hämtad {fmtTime(d.fetchedAt)}
            </div>
          </>
        )}
      </WidgetBody>
    </WidgetShell>
  );
}
