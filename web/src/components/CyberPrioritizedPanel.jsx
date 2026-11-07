// M9: KEV×NVD-widget (område 5) – de senaste 15 KEV-tillägg enriched med
// CVSS-poäng ur NVD (30-dagarscachet först, sedan enskilda cveId-slagningar).
// Prioriteringsvy: vilka kända exploaterade sårbarheterna är som allvarligast?
import React, { useState } from 'react';
import { fetchCyberPrioritized } from '../api.js';
import { fmtTime } from '../status.js';
import { SeverityBadge, KpiRow, useFeed, WidgetShell, WidgetBody } from './CyberBits.jsx';

export default function CyberPrioritizedPanel() {
  const [expanded, setExpanded] = useState(null);
  const { data, error, loading, reload } = useFeed(
    () => fetchCyberPrioritized(),
    120000, [],
  );

  const d = data;
  return (
    <WidgetShell
      title="Prioriterade exploaterade sårbarheter (KEV × NVD)"
      fetchedAt={d?.fetchedAt}
      error={error}
      onRetry={reload}
    >
      <WidgetBody loading={loading} error={error} data={d}>
        {d && (
          <>
            <KpiRow items={[
              { label: 'Senaste KEV-tillägg', value: d.count },
              { label: 'Med CVSS-poäng', value: d.resolved },
              { label: 'Utan poäng ännu', value: d.unresolved },
            ]} />

            <table>
              <thead>
                <tr><th>CVE</th><th>Produkt</th><th>Tillagd</th><th>Frist</th><th>CVSS</th></tr>
              </thead>
              <tbody>
                {d.rows.map(r => (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cyber-row"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <td className="mono">{r.id}{r.ransomware ? ' 🔒' : ''}</td>
                      <td>{r.vendor} {r.product}</td>
                      <td className="mono">{r.added ?? '–'}</td>
                      <td className="mono">{r.due ?? '–'}</td>
                      <td><SeverityBadge severity={r.severity} score={r.score} /></td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="detail-row">
                        <td colSpan={5}>
                          <div><b>{r.id}</b> – {r.short}</div>
                          {r.action && <div className="mut">Åtgärd: {r.action}</div>}
                          {r.vector && <div className="mut mono">{r.vector}</div>}
                          <div className="mut">
                            Poängkälla: {r.from === 'nvd-cache' ? 'NVD 30-dagarscache'
                              : r.from === 'nvd-lookup' ? 'enskild NVD-slagning'
                              : r.error ? `fel (${r.error})` : 'ej upplöst (NVD saknar CVE:et ännu)'}
                          </div>
                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${r.id}`}
                            target="_blank" rel="noreferrer"
                          >
                            Se i NVD →
                          </a>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {!d.rows.length && (
                  <tr><td colSpan={5} className="mut">Inga KEV-tillägg att visa.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mut">
              KEV hämtad {fmtTime(d.kevFetchedAt)}{d.nvdFetchedAt ? ` · NVD ${fmtTime(d.nvdFetchedAt)}` : ''}
              {' '}(🔒 = känd ransomware-användning)
            </div>
          </>
        )}
      </WidgetBody>
    </WidgetShell>
  );
}
