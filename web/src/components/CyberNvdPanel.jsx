// M9: NVD-widget (område 5) – publicerade CVE senaste 7/14/30 dagarna med
// allvarlighetsfördelning, per-dags-trend, sökning, sortering och
// expanderade rader (beskrivning, CWE, CVSS-vektor, referenser, NVD-länk).
import React, { useState } from 'react';
import { fetchCyberNvd } from '../api.js';
import { fmtTime } from '../status.js';
import {
  SeverityBadge, KpiRow, Spark, useFeed, WidgetShell, WidgetBody, SEV_LABEL,
} from './CyberBits.jsx';

const SEVS = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNSCORED'];

export default function CyberNvdPanel() {
  const [win, setWin] = useState(7);
  const [sev, setSev] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [expanded, setExpanded] = useState(null);
  const { data, error, loading, reload } = useFeed(
    () => fetchCyberNvd({ window: win, severity: sev, q, sort, limit: 50 }),
    120000, [win, sev, q, sort],
  );

  const d = data;
  return (
    <WidgetShell
      title="NVD – nya sårbarheter (senaste 30 d)"
      fetchedAt={d?.fetchedAt}
      error={error}
      onRetry={reload}
    >
      <WidgetBody loading={loading} error={error} data={d}>
        {/* Guards: children utvärderas innan WidgetBody visar dem, så
            data-fälten får inte läsas medan d är null (första rendern). */}
        {d && (
          <>
            <KpiRow items={[
              { label: `Publicerade senaste ${d.window} d`, value: d.inWindow },
              { label: 'Kritiska (≥ 9)', value: d.bySeverity.CRITICAL },
              { label: 'Hög (7–8.9)', value: d.bySeverity.HIGH },
              { label: 'Medel (4–6.9)', value: d.bySeverity.MEDIUM },
              { label: 'Opunkterade', value: d.bySeverity.UNSCORED },
            ]} />

            <div className="mut">Publicerade per dag</div>
            <Spark days={d.perDay} />

            <div className="chips">
              <select value={win} onChange={e => setWin(Number(e.target.value))} aria-label="Tidsfönster i dagar">
                <option value={7}>7 dagar</option>
                <option value={14}>14 dagar</option>
                <option value={30}>30 dagar</option>
              </select>
              {SEVS.map(s => (
                <button
                  key={s || 'alla'}
                  type="button"
                  className={`chip${sev === s ? ' on' : ''}`}
                  onClick={() => { setSev(s); setExpanded(null); }}
                >
                  {s ? `${SEV_LABEL[s]} (${d.bySeverity[s]})` : 'Alla'}
                </button>
              ))}
              <input
                className="cyber-search"
                type="search"
                placeholder="Sök CVE-id eller beskrivning…"
                value={q}
                onChange={e => { setQ(e.target.value); setExpanded(null); }}
                aria-label="Sök i NVD-listan"
              />
              <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sortering">
                <option value="newest">Nyast först</option>
                <option value="score">Högst CVSS</option>
              </select>
            </div>

            {d.capped && (
              <div className="mut" style={{ color: 'var(--warn)' }}>
                Del av fönstret är utelämnat (NVD pagineringsspärr) – talen är en undervarning.
              </div>
            )}

            <table>
              <thead>
                <tr><th>CVE</th><th>Publicerad</th><th>CVSS</th><th>Beskrivning</th></tr>
              </thead>
              <tbody>
                {d.top.map(r => (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cyber-row"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <td className="mono">{r.id}</td>
                      <td className="mono">{(r.published ?? '').slice(0, 10)}</td>
                      <td><SeverityBadge severity={r.severity} score={r.score} /></td>
                      <td className="mut">{r.desc}</td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="detail-row">
                        <td colSpan={4}>
                          <div><b>{r.id}</b> <span className="mut">· status: {r.status ?? '–'} · modifierad {(r.modified ?? '').slice(0, 10)}</span></div>
                          <div>{r.desc}</div>
                          {r.cwe && <div className="mut">Sårbarhetstyp: {r.cwe}</div>}
                          {r.vector && <div className="mut mono">{r.vector}</div>}
                          {r.refs?.length > 0 && (
                            <div className="refs">
                              {r.refs.map(u => (
                                <a key={u} href={u} target="_blank" rel="noreferrer">{u}</a>
                              ))}
                            </div>
                          )}
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
                {!d.top.length && (
                  <tr><td colSpan={4} className="mut">Inga träffar för valda filter.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mut">
              Visar {d.count} av {d.inWindow} i fönstret · NVD-databas {d.dbTotal != null ? `${d.dbTotal.toLocaleString('sv-SE')} CVE` : '–'} · hämtad {fmtTime(d.fetchedAt)}
            </div>
          </>
        )}
      </WidgetBody>
    </WidgetShell>
  );
}
