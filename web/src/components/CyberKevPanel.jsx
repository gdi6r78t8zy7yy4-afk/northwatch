// M9: KEV-widget (område 5) – CISA Known Exploited Vulnerabilities:
// tillägg senaste 90 dagarna, ransomware-användning, kommande åtgärdsfrister
// och monthly histogram, med sökning/filter/expanderade rader.
import React, { useState } from 'react';
import { fetchCyberKev } from '../api.js';
import { fmtTime } from '../status.js';
import { KpiRow, BarList, useFeed, WidgetShell, WidgetBody } from './CyberBits.jsx';

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const monthLabel = m => {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[Number(mo) - 1] ?? mo} ${y.slice(2)}`;
};

export default function CyberKevPanel() {
  const [q, setQ] = useState('');
  const [ransomOnly, setRansomOnly] = useState(false);
  const [sort, setSort] = useState('added');
  const [expanded, setExpanded] = useState(null);
  const { data, error, loading, reload } = useFeed(
    () => fetchCyberKev({ q, ransomware: ransomOnly, sort, limit: 100 }),
    120000, [q, ransomOnly, sort],
  );

  const d = data;
  return (
    <WidgetShell
      title="CISA KEV – kända exploaterade sårbarheter"
      fetchedAt={d?.fetchedAt}
      error={error}
      onRetry={reload}
    >
      <WidgetBody loading={loading} error={error} data={d}>
        {d && (
          <>
            <KpiRow items={[
              { label: 'Totalt i katalogen', value: d.total },
              { label: 'Tillagda senaste 90 d', value: d.added90 },
              { label: 'Kända ransomware-kampanjer', value: d.ransomware },
              { label: 'Åtgärdsfrist ≤ 14 d', value: d.dueSoon },
            ]} />

            <div className="mut">Tillägg per månad (12 m)</div>
            <BarList
              items={d.byMonth.map(m => ({ label: monthLabel(m.month), n: m.n }))}
            />

            <div className="chips">
              <input
                className="cyber-search"
                type="search"
                placeholder="Sök CVE, leverantör eller produkt…"
                value={q}
                onChange={e => { setQ(e.target.value); setExpanded(null); }}
                aria-label="Sök i KEV-katalogen"
              />
              <button
                type="button"
                className={`chip${ransomOnly ? ' on' : ''}`}
                onClick={() => { setRansomOnly(!ransomOnly); setExpanded(null); }}
              >
                Bara ransomware
              </button>
              <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sortering">
                <option value="added">Senast tillagd</option>
                <option value="due">Snarast åtgärdsfrist</option>
              </select>
            </div>

            <table>
              <thead>
                <tr><th>CVE</th><th>Produkt</th><th>Tillagd</th><th>Frist</th></tr>
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
                    </tr>
                    {expanded === r.id && (
                      <tr className="detail-row">
                        <td colSpan={4}>
                          <div><b>{r.id}</b> – {r.short}</div>
                          {r.action && <div className="mut">Åtgärd: {r.action}</div>}
                          {r.notes && <div className="mut">{r.notes}</div>}
                          {r.cwes?.length > 0 && <div className="mut">CWE: {r.cwes.join(', ')}</div>}
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
                  <tr><td colSpan={4} className="mut">Inga träffar för valda filter.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mut">
              Visar {d.count} av {d.total} (🔒 = känd ransomware-användning) ·
              katalog publicerad {fmtTime(d.dateReleased)}
            </div>
          </>
        )}
      </WidgetBody>
    </WidgetShell>
  );
}
