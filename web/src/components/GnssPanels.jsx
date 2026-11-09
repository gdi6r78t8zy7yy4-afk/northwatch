// M12: per-källa-paneler för GNSS-/rymdvyn (område 10). Varje panel är
// presentationell – GnssView hämtar /api/gnss/status + /data (120 s) och
// distribuerar records + ett meta-objekt { loading, error, fetchedAt, onRetry }.
// Landsvy (SE/NO/DK/FI/IS) visar nationella källor (data.norge.no för NO) + de
// globala; NORDIC/ALL visar allt + luckkort. Korrelationspanelen pollar sin
// egen /api/gnss/correlation (async pga valfri LLM-berikelse i backenden).
import React from 'react';
import { WidgetShell, WidgetBody, KpiRow, useFeed } from './CyberBits.jsx';
import { StatusBadge, SevBadge, ComponentRows, ScoreBar, RecordTable, countryLabel } from './GnssBits.jsx';
import { fetchGnssCorrelation } from '../api.js';

// Gemensam ram för en recordbaserad panel. Tom recordlista (t.ex. källa utan
// data i landsvyn) behandlas som inga data → WidgetBody visar panelens egen
// fallback-text i stället för tomma KPI-rader.
function SourcePanel({ title, records, meta, children, fallback = 'Ingen data just nu.' }) {
  return (
    <WidgetShell title={title} fetchedAt={meta.fetchedAt} error={meta.error} onRetry={meta.onRetry}>
      <WidgetBody loading={meta.loading} error={meta.error} data={records?.length ? records : null} fallback={fallback}>
        {children}
      </WidgetBody>
    </WidgetShell>
  );
}

// Senaste metric-värdet som matchar en regex (explicit max-ts-sök).
const val = (recs, re) => {
  let best = null;
  for (const r of recs ?? []) {
    if (r.t !== 'm' || r.value == null || !re.test(r.indicator ?? '')) continue;
    if (!best || String(r.ts ?? '') > String(best.ts ?? '')) best = r;
  }
  return best?.value ?? null;
};

// ------------------------------------------------------------- GNSS-index ----

export function GnssStatusPanel({ status, meta, national = false }) {
  return (
    <WidgetShell title="GNSS-index" fetchedAt={meta.fetchedAt} error={meta.error} onRetry={meta.onRetry}>
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
                  <tr><th>Land</th><th>Poäng</th><th>Status</th><th>Tillg</th><th>Stab</th><th>Varn</th><th>Täck</th></tr>
                </thead>
                <tbody>
                  {(status.countries ?? []).map(c => (
                    <tr key={c.country}>
                      <td>{countryLabel(c.country)}</td>
                      <td className="mono">{c.score ?? '–'}</td>
                      <td><StatusBadge label={c.label} /></td>
                      <td className="mono">{c.components.tillgänglighet?.score ?? '–'}</td>
                      <td className="mono">{c.components.stabilitet?.score ?? '–'}</td>
                      <td className="mono">{c.components.varningstäthet?.score ?? '–'}</td>
                      <td className="mono">{c.components.täckning?.score ?? '–'}</td>
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

// ------------------------------------------------------------- NOAA SWPC ----

export function NoaaPanel({ records, meta }) {
  const evs = (records ?? []).filter(r => r.t === 'e').slice(0, 6);
  return (
    <SourcePanel title="Rymdväder (NOAA SWPC)" records={records} meta={meta}
      fallback="Ingen rymdvädersdata just nu.">
      <KpiRow items={[
        { label: 'Kp-index (globalt)', value: val(records, /^Kp-index \(globalt/) ?? '–' },
        { label: 'Estimerat Kp (3 h)', value: val(records, /^Estimerat Kp/) ?? '–' },
        { label: 'Solradioflux F10.7', value: val(records, /^Solradioflux F10\.7$/) ?? '–', sub: 'sfu' },
      ]} />
      {evs.length ? (
        <div className="fv-events">
          {evs.map((e, i) => (
            <div className="fv-event" key={i}>
              <SevBadge severity={e.severity} />
              <span className="mono">{String(e.start ?? '').slice(0, 16).replace('T', ' ')}</span>
              <span>{e.title}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mut">Kp ≥ 5 = geomagnetisk storm (G1+); påverkar GNSS- och HF-radiopositionering i högbredderna. Källa: NOAA SWPC planetary_k_index/f107_cm_flux.</div>
    </SourcePanel>
  );
}

// ------------------------------------------------------- CelesTrak GP -------

export function CelestrakPanel({ records, meta }) {
  // Etiketterna kommer i kollektorns konstellationsordning; samla antal + epokålder.
  const byLabel = new Map();
  const entry = label => {
    let o = byLabel.get(label);
    if (!o) { o = {}; byLabel.set(label, o); }
    return o;
  };
  for (const r of records ?? []) {
    if (r.t !== 'm') continue;
    let m = String(r.indicator ?? '').match(/^Satelliter i elementset \((.+)\)$/);
    if (m && m[1] !== 'totalt') { entry(m[1]).n = r.value; continue; }
    m = String(r.indicator ?? '').match(/^Epokålder \((.+)\)$/);
    if (m) entry(m[1]).ageH = r.value;
  }
  const total = val(records, /\(totalt\)$/);
  return (
    <SourcePanel title="GNSS-elementset (CelesTrak GP)" records={records} meta={meta}
      fallback="Inga elementdata just nu.">
      <KpiRow items={[{ label: 'Satelliter totalt', value: total ?? '–' }]} />
      {byLabel.size ? (
        <table>
          <thead><tr><th>Konstellation</th><th>Satelliter</th><th>Nyaste epok (h)</th></tr></thead>
          <tbody>
            {[...byLabel.entries()].map(([label, o]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="mono">{o.n ?? '–'}</td>
                <td className="mono" style={o.ageH > 72 ? { color: 'var(--warn)' } : undefined}>
                  {o.ageH ?? '–'}{o.ageH > 72 ? ' ⚠' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="mut">Inga elementdata just nu.</div>}
      <div className="mut">Epokålder &gt; 72 h = inaktuella GP-element (SBAS uppdateras glesare). FORMAT=json, nyckelfritt.</div>
    </SourcePanel>
  );
}

// ---------------------------------------------------------- GSC Europa ------

export function GscPanel({ records, meta }) {
  const evs = (records ?? []).filter(r => r.t === 'e').slice(0, 8);
  return (
    <SourcePanel title="Galileo & EGNOS (GSC Europa)" records={records} meta={meta}
      fallback="Ingen Galileo-data just nu.">
      <KpiRow items={[
        { label: 'Konstellation', value: val(records, /^Galileo-satelliter i konstellationen$/) ?? '–' },
        { label: 'USABLE', value: val(records, /^Galileo-satelliter tillgängliga/) ?? '–' },
        { label: 'Tillgänglighetsandel', value: val(records, /^Andel tillgängliga Galileo/) != null ? `${val(records, /^Andel tillgängliga Galileo/)} %` : '–' },
        { label: 'Fast atomur (PHM)', value: val(records, /fast atomur \(PHM\)/) ?? '–' },
        { label: 'Öppna NAGU', value: val(records, /^Pågående\/öppna NAGU/) ?? '–' },
      ]} />
      {evs.length ? (
        <div className="fv-events">
          {evs.map((e, i) => (
            <div className="fv-event" key={i}>
              <SevBadge severity={e.severity} />
              <span className="mono">{String(e.start ?? '').slice(0, 16).replace('T', ' ')}</span>
              <span>{e.title}</span>
              {e.detail ? <span className="mut">{e.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mut">NAGU = Navigation Advisory for Galileo/EGNOS (planerade och pågående störningar). Källa: GSC RSS-feed + konstellationssida.</div>
    </SourcePanel>
  );
}

// ----------------------------------------------- M3G GNSS Stations API ------

export function M3gPanel({ records, meta }) {
  const byCountry = {};
  for (const r of records ?? []) {
    if (r.t !== 'm' || !['SE', 'NO', 'DK', 'FI', 'IS'].includes(r.country)) continue;
    const g = byCountry[r.country] ?? (byCountry[r.country] = {});
    if (/^GNSS-stationer \(M3G\)/.test(r.indicator ?? '')) {
      g.n = r.value;
      g.capped = /minst/.test(r.indicator);
    } else if (/^Aktiva GNSS-stationer/.test(r.indicator ?? '')) g.active = r.value;
    else if (/^Flerkonstellationsstationer/.test(r.indicator ?? '')) g.multi = r.value;
  }
  const rows = Object.keys(byCountry).sort();
  return (
    <SourcePanel title="GNSS-stationer (M3G / EPOS)" records={records} meta={meta}
      fallback="Inga stationsdata just nu.">
      {rows.length ? (
        <table>
          <thead><tr><th>Land</th><th>Stationer</th><th>Aktiva</th><th>Flerkonst.</th></tr></thead>
          <tbody>
            {rows.map(cc => {
              const g = byCountry[cc];
              return (
                <tr key={cc}>
                  <td>{countryLabel(cc)}</td>
                  <td className="mono">{g.n ?? '–'}{g.capped ? ' ≥' : ''}</td>
                  <td className="mono">{g.active != null ? `${g.active} %` : '–'}</td>
                  <td className="mono">{g.multi != null ? `${g.multi} %` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <div className="mut">Inga stationsdata just nu.</div>}
      <div className="mut">≥ = rutnätet mättade API:t:s 20-posters tak → verkligt antal är högre. Stationerna visas i kartan ovan. Källa: M3G GNSS Stations API (CC BY 4.0, doi:10.24414/ROB-GNSS-M3G).</div>
    </SourcePanel>
  );
}

// ------------------------------------------------------ data.norge.no (NO) --

export function DatanorgePanel({ records, meta }) {
  return (
    <SourcePanel title="GNSS-register (data.norge.no, NO)" records={records} meta={meta}
      fallback="Ingen norska datasetdata just nu.">
      <KpiRow items={[
        { label: 'Dataset „gnss"', value: val(records, /^GNSS-dataset \(gnss\)$/) ?? '–' },
        { label: 'Publika („gnss")', value: val(records, /^Publika GNSS-dataset \(gnss\)$/) ?? '–' },
        { label: 'Dataset „posisjonering"', value: val(records, /^GNSS-dataset \(posisjonering\)$/) ?? '–' },
        { label: 'Publika („posisjonering")', value: val(records, /^Publika GNSS-dataset \(posisjonering\)$/) ?? '–' },
      ]} />
      <RecordTable records={records} empty="Ingen norska datasetdata just nu." max={8} />
      <div className="mut">Antal registerposter i Felles datakatalog (DigDir) för GNSS-/positioneringsrelaterade dataset.</div>
    </SourcePanel>
  );
}

// ------------------------------------------------------------- NASA APOD ----

export function ApodPanel({ records, meta }) {
  return (
    <SourcePanel title="APOD-publiceringstakt (NASA)" records={records} meta={meta}
      fallback="Ingen APOD-data just nu.">
      <KpiRow items={[
        { label: 'Publiceringar ≤10 d', value: val(records, /^APOD-publiceringar/) ?? '–' },
        { label: 'Ålder senaste', value: val(records, /^Ålder på senaste APOD$/) != null ? `${val(records, /^Ålder på senaste APOD$/)} d` : '–' },
      ]} />
      <div className="mut">Rymdbevakning i media – information enbart, ingår inte i GNSS-index.</div>
    </SourcePanel>
  );
}

// ------------------------------------------------------------- Korrelation --

const CHAIN_LABEL = { 'active-now': 'Pågående sammanfall', 'storm-nagu': 'Storm ↔ NAGU' };

export function GnssCorrelationPanel() {
  const feed = useFeed(() => fetchGnssCorrelation(), 120000, []);
  return (
    <WidgetShell title="Korrelation – rymdväder × GNSS" fetchedAt={feed.data?.generatedAt} error={feed.error} onRetry={feed.reload}>
      <WidgetBody loading={feed.loading} error={feed.error} data={feed.data} fallback="Ingen korrelationsanalys ännu.">
        {feed.data && (
          <>
            <p style={{ margin: '4px 0 8px 0' }}>{feed.data.narrative}</p>
            <div className="mut" style={{ marginBottom: 6 }}>
              Analys: {feed.data.narrativeSource === 'llm' ? 'LLM-berikad (qwen3.8-flash-next)' : 'deterministisk regeltext'}
            </div>
            {(feed.data.chains ?? []).length ? (
              <>
                <div className="mut">Kedjor</div>
                <div className="fv-events">
                  {feed.data.chains.map(c => (
                    <div className="fv-event" key={c.id}>
                      <SevBadge severity={c.storm?.severity ?? 'warn'} />
                      <span>{CHAIN_LABEL[c.type] ?? c.type}</span>
                      <span className="mono">{String(c.t0 ?? '').slice(0, 16).replace('T', ' ')}</span>
                      <span>{c.storm?.title} + {c.nagus.length} NAGU</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {(feed.data.anomalies ?? []).length ? (
              <>
                <div className="mut">Aktiva anomalier</div>
                <div className="fv-events">
                  {feed.data.anomalies.map((a, i) => (
                    <div className="fv-event" key={i}>
                      <SevBadge severity={a.severity} />
                      <span>{a.title}</span>
                      {a.detail ? <span className="mut">{a.detail}</span> : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="mut">Inga aktiva anomalier i nuläget.</div>
            )}
          </>
        )}
      </WidgetBody>
    </WidgetShell>
  );
}

// --------------------------------------------------------------- Luckor -----

export function GnssGapCards() {
  return (
    <div className="card industry-gapcard">
      <h2>Kända luckor – rymd, navigation och positionering</h2>
      <ul className="mut ind-gaps">
        <li><b>Nationella referensstationer i realtid</b> – SWEPOS RINEX (Lantmäteriet) kräver registrerad nyckel (CC0), FINPOS rådata är licensbelagd och DK RINEX serveras över FTPS som Node-fetch inte stödjer → stationshälsan mäts via M3G-metadata i stället.</li>
        <li><b>Precisionsprodukter</b> – ESA SWE HAPI (precis ephemerid/klockdrift) kräver M2M-klient hos ESA Single Sign-On; Space-Track kräver konto + användaravtal → båda återstår med nycklar.</li>
        <li><b>Island</b> – althingi.is svarar 403/unreachable; Island täcks via M3G ISL-stationsnätet (53 stationer) i stället för nationell registerkälla.</li>
        <li><b>M3G-taket</b> – API:t returnerar max 20 stationer per anrop och rutnätssplittingen är en nivå djup → länder med mycket täta nät kan rapportera „minst" (≥) i stället för exakt antal.</li>
        <li><b>Copernicus Data Space / EDAS</b> – svag direkt relevans för nordisk positioneringsberedskap; uteslutna efter endpoint-verifiering.</li>
      </ul>
    </div>
  );
}
