// M9: gemensamma byggstenar för cyberpanelerna (område 5) – severity-badgar,
// KPI-radar, stapelrader, per-dags-sparkline, pollningshook och panelram.
// All data kommer via /api/cyber/* (backenden hämtar NVD/KEV/OSV).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime } from '../status.js';

// Severity → klass. NVD: CRITICAL/HIGH/MEDIUM/LOW/UNSCORED; OSV: dessutom
// MODERATE/NONE; null → ospecificerad.
const SEV_CLS = {
  CRITICAL: 'sev-crit',
  HIGH: 'sev-high',
  MODERATE: 'sev-med',
  MEDIUM: 'sev-med',
  LOW: 'sev-low',
  NONE: 'sev-uns',
  UNSCORED: 'sev-uns',
};
export const SEV_LABEL = {
  CRITICAL: 'Kritisk', HIGH: 'Hög', MODERATE: 'Medel', MEDIUM: 'Medel',
  LOW: 'Låg', NONE: 'Ingen', UNSCORED: 'Opunkterad',
};

export function SeverityBadge({ severity, score }) {
  const s = severity ? String(severity).toUpperCase() : null;
  const cls = s ? (SEV_CLS[s] ?? 'sev-uns') : 'sev-uns';
  const label = s
    ? (score != null ? `${score} ${SEV_LABEL[s] ?? s}` : SEV_LABEL[s] ?? s)
    : '–';
  return <span className={`sev ${cls}`} title={s ?? 'Ingen allvarlighetsgrad'}>{label}</span>;
}

// KPI-radar – item: { label, value, sub? }.
export function KpiRow({ items }) {
  if (!items?.length) return null;
  return (
    <div className="kpis">
      {items.map(it => (
        <div className="kpi" key={it.label}>
          <div className="n">{it.value}</div>
          <div className="l">{it.label}</div>
          {it.sub ? <div className="l mut">{it.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

// Stapelrader – item: { label, n, color? }. Bredden relativ mot maxet.
export function BarList({ items, empty = 'Ingen data' }) {
  const max = Math.max(1, ...(items ?? []).map(i => i.n ?? 0));
  if (!items?.length) return <div className="mut">{empty}</div>;
  return (
    <div className="bars">
      {items.map(i => (
        <div className="bar-row" key={i.label}>
          <span className="lbl">{i.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${((i.n ?? 0) / max) * 100}%`, background: i.color ?? 'var(--accent)' }}
            />
          </span>
          <span className="n mono">{i.n ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

// Per-dags sparkline (div-baserad, en stapel per dag). days: [{day, n}].
export function Spark({ days }) {
  const max = Math.max(1, ...(days ?? []).map(d => d.n ?? 0));
  if (!days?.length) return null;
  return (
    <div className="spark" title={days.map(d => `${d.day}: ${d.n}`).join('\n')}>
      {days.map(d => (
        <i
          key={d.day}
          style={{ height: `${Math.max(4, ((d.n ?? 0) / max) * 100)}%` }}
          title={`${d.day}: ${d.n}`}
        />
      ))}
    </div>
  );
}

// Pollningshook för cyberendpoints: hämtar direkt + var `ms`, byter om
// `deps` ändras. return { data, error, loading, reload } – error kan vara
// null, ett felmeddelande eller (samma sak) att backend servar gammalt data
// efter misslyckad källhämtning (body.error).
export function useFeed(loadFn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(loadFn);
  fnRef.current = loadFn;
  const load = useCallback(async () => {
    try {
      const r = await fnRef.current();
      if (r?.ok && r.body) {
        setData(r.body);
        setError(r.body.error ?? null);
      } else {
        setData(null);
        setError(r?.body?.error ?? `HTTP ${r?.status ?? '?'}`);
      }
    } catch (e) {
      setData(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ms, ...deps]);
  return { data, error, loading, reload: load };
}

// Panelram: rubrik + fräschess-tag + (vid fel) felrad med retry-knapp.
export function WidgetShell({ title, fetchedAt, error, onRetry, children }) {
  return (
    <div className="card cyber-card">
      <h2>
        {title}
        <span className="maptools">
          {fetchedAt ? <span className="tag">uppdaterad {fmtTime(fetchedAt)}</span> : null}
          {error
            ? (
              <>
                <span className="pill st-warn">otillförlitlig data</span>
                {onRetry && (
                  <button type="button" className="tbtn" onClick={onRetry}>Försök igen</button>
                )}
              </>
            )
            : null}
        </span>
      </h2>
      {error
        ? <div className="mut" style={{ color: 'var(--warn)' }}>{error}</div>
        : null}
      {children}
    </div>
  );
}

// Panelens inre: loading / hård fel (inga data alls) / innehåll.
export function WidgetBody({ loading, error, data, fallback = 'Ingen data just nu.', children }) {
  if (loading) return <div className="mut">Hämtar data (förstahämtning kan ta ~1 minut)…</div>;
  if (!data) return <div className="mut">{error ? 'Kunde inte hämta data.' : fallback}</div>;
  return children;
}
