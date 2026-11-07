// M10: per-källa-paneler för industrivy (område 7). Varje panel är
// presentationell – IndustryView hämtar /api/industry/status + /data (120 s)
// och distribuerar records + ett meta-objekt { loading, error, fetchedAt,
// onRetry }. Landsvy visar dess lands records; NORDIC-vyn visar sammanfattning
// + per-land-tabell. IEA och Stats Denmark visas som luckor (ej anslutna).
import React from 'react';
import { useFeed, WidgetShell, WidgetBody, KpiRow, BarList } from './CyberBits.jsx';
import {
  StatusBadge, ScoreBar, ComponentRows, RecordTable, countryLabel,
} from './IndustryBits.jsx';

// Gemensam ram för en recordbaserad panel.
function SourcePanel({ title, records, meta, children, fallback = 'Ingen data just nu.' }) {
  return (
    <WidgetShell title={title} fetchedAt={meta.fetchedAt} error={meta.error} onRetry={meta.onRetry}>
      <WidgetBody loading={meta.loading} error={meta.error} data={records} fallback={fallback}>
        {children}
      </WidgetBody>
    </WidgetShell>
  );
}

// --------------------------------------------------------------- Status ------

export function IndustryStatusPanel({ status, meta, national = false }) {
  return (
    <WidgetShell title="Industristatus" fetchedAt={meta.fetchedAt} error={meta.error} onRetry={meta.onRetry}>
      <WidgetBody loading={meta.loading} error={meta.error} data={status} fallback="Ingen analys ännu.">
        {status && (
          <div className="industry-status">
            <div className="ind-head">
              <div className="ind-score-big">
                <ScoreBar score={status.score} />
                <StatusBadge label={status.label} />
              </div>
              <div className="mut">t.o.m. {status.asOf || '–'} · {status.sources?.length ?? 0} källor</div>
            </div>
            <ComponentRows components={status.components} />
            {national ? (
              <div className="ind-drivers">
                {(status.drivers ?? []).map(d => (
                  <div className="mut" key={d}>{d}</div>
                ))}
              </div>
            ) : (
              <table className="ind-country-table">
                <thead>
                  <tr><th>Land</th><th>Poäng</th><th>Status</th><th>Prod</th><th>Handel</th><th>Kapac</th></tr>
                </thead>
                <tbody>
                  {(status.countries ?? []).map(c => (
                    <tr key={c.country}>
                      <td>{countryLabel(c.country)}</td>
                      <td className="mono">{c.score ?? '–'}</td>
                      <td><StatusBadge label={c.label} /></td>
                      <td className="mono">{c.components.production?.score ?? '–'}</td>
                      <td className="mono">{c.components.trade?.score ?? '–'}</td>
                      <td className="mono">{c.components.capacity?.score ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </WidgetBody>
    </WidgetShell>
  );
}

// ------------------------------------------------------------- Eurostat ------

export function IndustryEurostatPanel({ records, meta }) {
  return (
    <SourcePanel title="Eurostat – industri & råvaror" records={records} meta={meta}
      fallback="Ingen Eurostat-data just nu.">
      <RecordTable records={records} empty="Ingen Eurostat-data just nu." />
    </SourcePanel>
  );
}

// ------------------------------------------------------------- Stål (OECD) ----

export function IndustrySteelPanel({ records, meta }) {
  const items = (records ?? [])
    .filter(r => r.value != null)
    .map(r => ({ label: `${countryLabel(r.country)} (${r.ts})`, n: r.value }));
  return (
    <SourcePanel title="Råstålkapacitet (OECD)" records={records} meta={meta}
      fallback="Ingen stålkapacitetsdata just nu.">
      <BarList items={items} empty="Ingen stålkapacitetsdata just nu." />
      <div className="mut">Mt råstålkapacitet per land, senaste år.</div>
    </SourcePanel>
  );
}

// -------------------------------------------------------------- Comtrade ------

export function IndustryComtradePanel({ records, meta }) {
  const byCountry = {};
  for (const r of records ?? []) {
    if (r.value == null) continue;
    const isX = /export/i.test(r.indicator);
    const isM = /import/i.test(r.indicator);
    if (!isX && !isM) continue;
    byCountry[r.country] ??= {};
    byCountry[r.country].ts = r.ts;
    if (isX) byCountry[r.country].x = r.value;
    if (isM) byCountry[r.country].m = r.value;
  }
  const rows = Object.entries(byCountry);
  const fmt = v => (v == null ? '–' : Math.abs(v) >= 1e6 ? `${(v / 1e9).toFixed(1)} bn` : String(v));
  return (
    <SourcePanel title="Varuhandel (UN Comtrade)" records={records} meta={meta}
      fallback="Ingen Comtrade-data just nu.">
      {rows.length ? (
        <table>
          <thead>
            <tr><th>Land</th><th>Export</th><th>Import</th><th>Saldo</th><th>År</th></tr>
          </thead>
          <tbody>
            {rows.map(([c, v]) => {
              const bal = v.x != null && v.m != null ? v.x - v.m : null;
              return (
                <tr key={c}>
                  <td>{countryLabel(c)}</td>
                  <td className="mono">{fmt(v.x)}</td>
                  <td className="mono">{fmt(v.m)}</td>
                  <td className={`mono ${bal != null && bal < 0 ? 'neg' : 'pos'}`}>{fmt(bal)}</td>
                  <td className="mono">{v.ts ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="mut">Ingen Comtrade-data just nu.</div>
      )}
      <div className="mut">USD, världshandel (partnerCode 0). Saldo = export − import.</div>
    </SourcePanel>
  );
}

// -------------------------------------------------------- RMIS / EU CRMs ------

export function IndustryRmisPanel({ records, meta }) {
  const evs = (records ?? []).filter(r => r.t === 'e');
  const high = evs.filter(e => e.severity === 'high');
  const med = evs.filter(e => e.severity === 'medium');
  const SUPPLY_RE = /levererar (.+?) till EU/;
  const materials = [...new Set(
    (records ?? [])
      .filter(r => r.t === 'm')
      .map(r => r.indicator?.match(SUPPLY_RE)?.[1])
      .filter(Boolean),
  )];
  const top = [...high, ...med].slice(0, 10);
  return (
    <SourcePanel title="Kritiska råvaror (JRC RMIS / EU CRMs)" records={records} meta={meta}
      fallback="Ingen råvarudata just nu.">
      <KpiRow items={[
        { label: 'Högt importberoende (≥ 80 %)', value: high.length },
        { label: 'Medelberoende (50–79 %)', value: med.length },
        { label: 'Nordiska material till EU', value: materials.length },
      ]} />
      {top.length ? (
        <div className="ind-events">
          {top.map((e, i) => (
            <div className={`ind-event sev-${e.severity}`} key={i}>
              <span className={`sev ${e.severity === 'high' ? 'sev-high' : 'sev-med'}`}>
                {e.severity === 'high' ? 'Hög' : 'Medel'}
              </span>
              <span>{e.title}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mut">Inga importberoendelarm.</div>
      )}
      {materials.length ? (
        <>
          <div className="mut">Nordiska material som levereras till EU</div>
          <div className="chips">
            {materials.map(m => <span className="chip" key={m}>{m}</span>)}
          </div>
        </>
      ) : null}
    </SourcePanel>
  );
}

// ------------------------------------------ Nationella statistikbyråer --------

const NAT_SRC = {
  scb: 'SCB (Sverige)', ssb: 'SSB (Norge)',
  statfinland: 'StatFin (Finland)', statice: 'Statistics Iceland',
};

export function IndustryNationalPanel({ records, meta, country }) {
  const bySource = {};
  for (const r of records ?? []) if (NAT_SRC[r.source]) (bySource[r.source] ??= []).push(r);
  const ids = Object.keys(bySource);
  return (
    <SourcePanel
      title={country && country !== 'NORDIC' ? `Nationell statistikbyrå (${countryLabel(country)})` : 'Nationella statistikbyråer'}
      records={records} meta={meta}
      fallback="Ingen data från nationella statistikbyråer just nu.">
      {ids.length ? (
        ids.map(id => (
          <div key={id} style={{ marginBottom: 10 }}>
            <h3 style={{ fontSize: '0.9rem', margin: '4px 0' }}>{NAT_SRC[id]}</h3>
            <RecordTable records={bySource[id]} empty="Ingen data." />
          </div>
        ))
      ) : (
        <div className="mut">Ingen data från nationella statistikbyråer just nu.</div>
      )}
    </SourcePanel>
  );
}

// ------------------------------------------------------------- Luckor ---------

export function IndustryGapCards() {
  return (
    <div className="card industry-gapcard">
      <h2>Kända luckor – industri & försörjningskedjor</h2>
      <ul className="mut ind-gaps">
        <li><b>IEA</b> – industriell energianvändning (elektricitet, värme, förnybart). Inget verifierat öppet API.</li>
        <li><b>Statistics Denmark</b> – dansk industriproduktionsindex. Ej anslutet ännu; Danmarks produktion täcks via Eurostat.</li>
        <li><b>UN Comtrade</b> – körs i gratis preview-läge. För fullt API (~500 anrop/dag) sätt <span className="mono">COMTRADE_API_KEY</span> från comtradeplus.un.org.</li>
      </ul>
    </div>
  );
}

// Re-export så IndustryView kan ta an alltihop från en modul.
export { useFeed };
