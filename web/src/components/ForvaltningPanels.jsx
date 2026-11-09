// M11: per-källa-paneler för förvaltningsvy (område 12). Varje panel är
// presentationell – ForvaltningView hämtar /api/forvaltning/status + /data
// (120 s) och distribuerar records + ett meta-objekt { loading, error,
// fetchedAt, onRetry }. Landsvy visar dess lands records; NORDIC-vyn visar
// alla källor + luckkort. Gemensamma källor (IPU, data.europa.eu, EUR-Lex)
// visas per land respektive som nordisk/EU-bas.
import React from 'react';
import { WidgetShell, WidgetBody, KpiRow, BarList, Spark } from './CyberBits.jsx';
import { RecordTable, countryLabel } from './ForvaltningBits.jsx';

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

// Senaste metric-värdet som matchar en regex (records är ts-sorterade i
// paneldata men ordningen kan variera → explicit max-ts-sök).
const val = (recs, re) => {
  let best = null;
  for (const r of recs ?? []) {
    if (r.t !== 'm' || r.value == null || !re.test(r.indicator ?? '')) continue;
    if (!best || String(r.ts ?? '') > String(best.ts ?? '')) best = r;
  }
  return best?.value ?? null;
};

// ------------------------------------------------------ Förvaltningsindex ----

export function ForvaltningStatusPanel({ status, meta, national = false }) {
  return (
    <WidgetShell title="Förvaltningsindex" fetchedAt={meta.fetchedAt} error={meta.error} onRetry={meta.onRetry}>
      <WidgetBody loading={meta.loading} error={meta.error} data={status} fallback="Ingen analys ännu.">
        {status && (
          <div className="industry-status">
            <div className="ind-head">
              <div className="ind-score-big">
                <ForvaltningScore score={status.score} />
                <ForvaltningBadge label={status.label} />
              </div>
              <div className="mut">t.o.m. {status.asOf || '–'} · {status.sources?.length ?? 0} källor</div>
            </div>
            <ForvaltningComponentRows components={status.components} />
            {national ? (
              <div className="ind-drivers">
                {(status.drivers ?? []).map(d => (
                  <div className="mut" key={d}>{d}</div>
                ))}
              </div>
            ) : (
              <table className="ind-country-table">
                <thead>
                  <tr><th>Land</th><th>Poäng</th><th>Status</th><th>Aktiv</th><th>Kont</th><th>Obser</th></tr>
                </thead>
                <tbody>
                  {(status.countries ?? []).map(c => (
                    <tr key={c.country}>
                      <td>{countryLabel(c.country)}</td>
                      <td className="mono">{c.score ?? '–'}</td>
                      <td><ForvaltningBadge label={c.label} /></td>
                      <td className="mono">{c.components.aktivitet?.score ?? '–'}</td>
                      <td className="mono">{c.components.kontinuitet?.score ?? '–'}</td>
                      <td className="mono">{c.components.observerbarhet?.score ?? '–'}</td>
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

function ForvaltningScore({ score }) {
  if (score == null) return <span className="mut">–</span>;
  const w = Math.max(0, Math.min(100, score));
  return (
    <span className="ind-scorebar">
      <span className="track">
        <span className="fill" style={{ width: `${w}%` }} />
        <span className="mid" />
      </span>
      <span className="n mono">{score}</span>
    </span>
  );
}

const BADGE_CLS = {
  'Hög trygghet': 'fv-hog',
  Stabilt: 'fv-stab',
  Uppmärksamhet: 'fv-opp',
  Svag: 'fv-svag',
  Okänt: 'fv-unknown',
};

function ForvaltningBadge({ label }) {
  return <span className={`ind-badge ${BADGE_CLS[label] ?? 'fv-unknown'}`}>{label ?? 'Okänt'}</span>;
}

function ForvaltningComponentRows({ components }) {
  const rows = [
    ['aktivitet', 'Aktivitet'],
    ['kontinuitet', 'Kontinuitet'],
    ['observerbarhet', 'Observerbarhet'],
  ];
  return (
    <div className="ind-components">
      {rows.map(([key, label]) => {
        const c = components?.[key];
        return (
          <div className="ind-comp" key={key} title={c?.basis}>
            <span className="lbl">{label}</span>
            <ForvaltningScore score={c?.score ?? null} />
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ Riksdagen (SE) --

export function RiksdagenPanel({ records, meta }) {
  const evs = (records ?? []).filter(r => r.t === 'e').slice(0, 8);
  const rost = (records ?? [])
    .filter(r => r.t === 'm' && /^Röster: /.test(r.indicator ?? ''))
    .map(r => ({ label: r.indicator.replace(/^Röster: /, ''), n: r.value }));
  return (
    <SourcePanel title="Sveriges riksdag (SE)" records={records} meta={meta}
      fallback="Ingen riksdagsdata just nu.">
      <KpiRow items={[
        { label: 'Kalenderhändelser', value: val(records, /Kalenderhändelser, kammarkalendern/) ?? '–' },
        { label: 'Omröstningar (rullande)', value: val(records, /^Omröstningar \(/) ?? '–' },
        { label: 'Anföranden (rullande)', value: val(records, /^Anföranden \(/) ?? '–' },
        { label: 'Tjänstgörande ledamöter', value: val(records, /Tjänstgörande riksdagsledamöter/) ?? '–' },
        { label: 'Kvinnor bland dem', value: val(records, /Kvinnor bland tjänstgörande/) ?? '–' },
      ]} />
      {rost.length ? <BarList items={rost} /> : null}
      {evs.length ? (
        <div className="fv-events">
          {evs.map((e, i) => (
            <div className="fv-event" key={i}>
              <span className="mono">{String(e.start ?? '').slice(0, 10)}</span>
              <span>{e.title}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mut">
        Voteringar/anföranden är rullande fönster (närmaste avstämmningarna),
        kalendern täcker ~4 veckor bakåt + kommande sammanträden. Källa: Sveriges riksdag.
      </div>
    </SourcePanel>
  );
}

// ----------------------------------------------------- Felles datakatalog (NO) -

export function FdkPanel({ records, meta }) {
  return (
    <SourcePanel title="Felles datakatalog, DigDir (NO)" records={records} meta={meta}
      fallback="Ingen FDK-data just nu.">
      <KpiRow items={[
        { label: 'Dataset totalt', value: val(records, /Dataset i Felles datakatalog/) ?? '–' },
        { label: 'Öppna (andel)', value: val(records, /Öppna dataset \(andel\)/) != null ? `${val(records, /Öppna dataset \(andel\)/)}%` : '–' },
        { label: 'Nyregistrerade ≤365 d', value: val(records, /Nyregistrerade dataset/) ?? '–' },
        { label: 'Metadataändring ≤30 d', value: val(records, /metadataändring \(/) ?? '–' },
      ]} />
      <RecordTable records={records} empty="Ingen FDK-data just nu." max={12} />
      <div className="mut">Källan är DigDir:s offentliga dataportal (CC0); sök-API:t är internt/instabilt → 6 s takt.</div>
    </SourcePanel>
  );
}

// -------------------------------------------------------- Retsinformation (DK) -

export function RetsinformationPanel({ records, meta }) {
  const days = (records ?? [])
    .filter(r => r.t === 'm' && /^Lagändringar, \d{4}-\d{2}-\d{2}$/.test(r.indicator ?? ''))
    .map(r => ({ day: r.indicator.replace('Lagändringar, ', ''), n: r.value }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const types = (records ?? [])
    .filter(r => r.t === 'm' && /^Lagändringar per typ: /.test(r.indicator ?? ''))
    .map(r => ({
      label: r.indicator.replace(/^Lagändringar per typ: (.+) \(\d+ d\)$/, '$1'),
      n: r.value,
    }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const evs = (records ?? []).filter(r => r.t === 'e').slice(0, 6);
  return (
    <SourcePanel title="Retsinformation (DK)" records={records} meta={meta}
      fallback="Ingen Retsinformation-data just nu.">
      <KpiRow items={[
        { label: 'Lagändringar senaste 7 d', value: val(records, /senaste \d+ dygn/) ?? '–' },
        { label: 'Dokumenttyper', value: types.length || '–' },
      ]} />
      <div className="mut">Lagändringar per dag (senaste 7 dygn, helger oftast tomma)</div>
      <Spark days={days} />
      {types.length ? <BarList items={types} /> : null}
      {evs.length ? (
        <div className="fv-events">
          {evs.map((e, i) => (
            <div className="fv-event" key={i}>
              <span className="mono">{String(e.start ?? '').slice(0, 10)}</span>
              <span>{e.title}</span>
              {e.detail ? <span className="mut">{e.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="mut">Folketingets lovsamling: ändrade lagar, BEK, förordningar m.m. via Retsinformation-API:t.</div>
    </SourcePanel>
  );
}

// ------------------------------------------------------------------ Finlex (FI) -

export function FinlexPanel({ records, meta }) {
  return (
    <SourcePanel title="Finlex, lagsättning (FI)" records={records} meta={meta}
      fallback="Ingen Finlex-data just nu.">
      <KpiRow items={(records ?? []).length ? [
        {
          label: 'Nya lagar (löpande år)',
          value: val(records, /^Nya lagar (?!.*hela)/) ?? '–',
        },
        {
          label: 'Ändrade lagar (löpande år)',
          value: val(records, /^Ändrade lagar (?!.*hela)/) ?? '–',
        },
        {
          label: 'Lagversioner (löpande år)',
          value: val(records, /^Lagversioner/) ?? '–',
        },
        {
          label: 'Nya lagar (föregående år)',
          value: val(records, /Nya lagar \d{4} \(hela året\)/) ?? '–',
        },
      ] : []} />
      <RecordTable records={records} empty="Ingen Finlex-data just nu." max={12} />
      <div className="mut">
        AKN-URI-lista: samma lag förekommer per språkversion (fin@swe@) → antal avdubblade på lagenr.
        Rättspraxis, betänkanden (HE) och regeringsförordningar saknas i API:t (se luckor).
      </div>
    </SourcePanel>
  );
}

// ------------------------------------------------------------------ Island (IS) -

// IS saknar nationell källa (Althinget har inget öppet API) – landsvyn visar
// detta istället för en panel; parlamentet täcks ändå via IPU + data.europa.eu.
export function IslandGapCard() {
  return (
    <div className="card cyber-card">
      <h2>Islandsk offentlig förvaltning (IS)</h2>
      <div className="mut">
        Althinget har inget öppet API och isländska myndighetsflöden saknar
        verifierade endpoints → ingen nationell källa. Parlamentet (kammare, val,
        partier) täcks via IPU Parline och öppna dataset via data.europa.eu –
        se panelerna nedan.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- IPU (5) -

const IPU_ROW_RE = [
  [/^Ledamöter, kammare/, 'Ledamöter'],
  [/^Kvinnor bland ledamöter/, 'Kvinnor'],
  [/^Partigrupper/, 'Partigrupper'],
  [/^Lagar antagna per år/, 'Lagar/år'],
  [/^Politiska partier/, 'Partier'],
  [/^Parlamentsanställda/, 'Anställda'],
  [/^Dagar sedan senaste val/, 'Val (dagar sedan)'],
];

export function IpuPanel({ records, meta }) {
  const byCountry = {};
  for (const r of records ?? []) {
    if (r.t !== 'm' || r.value == null) continue;
    (byCountry[r.country] ??= []).push(r);
  }
  const rows = Object.keys(byCountry).sort();
  const valFor = (list, re) => {
    let best = null;
    for (const r of list) {
      if (!re.test(r.indicator ?? '')) continue;
      if (!best || String(r.ts ?? '') > String(best.ts ?? '')) best = r;
    }
    return best;
  };
  return (
    <SourcePanel title="Parlament (IPU Parline)" records={records} meta={meta}
      fallback="Ingen IPU-data just nu.">
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th>Land</th>
              <th>Kammare</th>
              <th>Kvinnor</th>
              <th>Grupper</th>
              <th>Lagar/år</th>
              <th>Partier</th>
              <th>Anställda</th>
              <th>Senaste val</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(cc => {
              const list = byCountry[cc];
              const members = valFor(list, /^Ledamöter, kammare/);
              const women = valFor(list, /^Kvinnor bland ledamöter/);
              const groups = valFor(list, /^Partigrupper/);
              const laws = valFor(list, /^Lagar antagna per år/);
              const parties = valFor(list, /^Politiska partier/);
              const staff = valFor(list, /^Parlamentsanställda/);
              const election = valFor(list, /^Dagar sedan senaste val/);
              const electionLabel = election
                ? `${election.indicator.match(/\(([^)]+)\)/)?.[1] ?? ''} (${election.value} d)`
                : '–';
              return (
                <tr key={cc}>
                  <td>{countryLabel(cc)}</td>
                  <td className="mono">{members?.value ?? '–'}</td>
                  <td className="mono">{women?.value ?? '–'}</td>
                  <td className="mono">{groups?.value ?? '–'}</td>
                  <td className="mono">{laws?.value ?? '–'}</td>
                  <td className="mono">{parties?.value ?? '–'}</td>
                  <td className="mono">{staff?.value ?? '–'}</td>
                  <td className="mono">{electionLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="mut">Ingen IPU-data just nu.</div>
      )}
      <div className="mut">
        Nedre kammaren (IS: enkammarparlament). IPU:s källtillkännagivande gäller; data uppdateras
        löpande av IPU och kan vara fördröjd.
      </div>
    </SourcePanel>
  );
}

// ----------------------------------------------------------------- Portal (5) ---

export function DataportalPanel({ records, meta }) {
  const perCountry = {};
  for (const r of records ?? []) {
    if (r.t !== 'm' || r.value == null) continue;
    const g = perCountry[r.country] ?? (perCountry[r.country] = {});
    if (/Öppna dataset i data\.europa\.eu/.test(r.indicator)) g.total = r.value;
    if (/Dataset uppdaterade/.test(r.indicator)) g.mod30 = r.value;
  }
  const items = Object.keys(perCountry).sort()
    .map(cc => ({ label: countryLabel(cc), n: perCountry[cc].total ?? 0 }));
  const evs = (records ?? []).filter(r => r.t === 'e').slice(0, 6);
  return (
    <SourcePanel title="data.europa.eu Data Portal" records={records} meta={meta}
      fallback="Ingen portaldata just nu.">
      <BarList items={items} empty="Ingen portaldata just nu." />
      <div className="mut">Öppna dataset per land i den europeiska dataportalen; (≤30 d) = uppdaterade under senaste månaden.</div>
      {evs.length ? (
        <>
          <div className="mut">Nyligen uppdaterade dataset</div>
          <div className="fv-events">
            {evs.map((e, i) => (
              <div className="fv-event" key={i}>
                <span className="mono">{countryLabel(e.country)} · {String(e.start ?? '').slice(0, 10)}</span>
                <span>{e.title}</span>
                {e.detail ? <span className="mut">{e.detail}</span> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </SourcePanel>
  );
}

// -------------------------------------------------------- EUR-Lex / Cellar (EU) -

export function CellarPanel({ records, meta }) {
  return (
    <SourcePanel title="EUR-Lex / Cellar (EU)" records={records} meta={meta}
      fallback="Ingen EUR-Lex-data just nu.">
      <KpiRow items={[
        { label: 'EU-rättsliga texter (YTD)', value: val(records, /^EU-rättsliga texter/) ?? '–' },
        { label: 'Direktiv', value: val(records, /^EU-direktiv/) ?? '–' },
        { label: 'Förordningar', value: val(records, /^EU-förordningar/) ?? '–' },
        { label: 'Beslut', value: val(records, /^EU-beslut/) ?? '–' },
      ]} />
      <RecordTable records={records} empty="Ingen EUR-Lex-data just nu." max={8} />
      <div className="mut">
        CELEX-räkning via publik SPARQL-slutpunkt (CDM); år = löpande. Fri återanvändning
        enligt EU:s regler, källa anges.
      </div>
    </SourcePanel>
  );
}

// ------------------------------------------------------------------ Luckor ------

export function ForvaltningGapCards() {
  return (
    <div className="card industry-gapcard">
      <h2>Kända luckor – offentlig förvaltning</h2>
      <ul className="mut ind-gaps">
        <li><b>Krisinformation & varningssystem</b> – områdets kärnscope (krisinformation, grunddata, varningssystem, myndighetsmeddelanden) finns bara som webbportaler (t.ex. 112.se, beredskabet.no, beredskabet.dk, virallinen.fi, isafold.is) utan stabila API → mätningen bygger på kvantifierbar offentlig förvaltningsaktivitet istället.</li>
        <li><b>Island</b> – Althinget har inget öppet API; isländska parlamentet täcks via IPU (kammare, val, partier) + data.europa.eu.</li>
        <li><b>Finlex</b> – bara lagtexter (statute) finns som API; rättspraxis (HFD/KHO/HS), betänkanden (HE) och propositioner (AS) saknas → renormaliseras i indexet.</li>
        <li><b>Riksdagen</b> – voteringar/anföranden är rullande fönster (närmaste avstämmningarna), inte hela kammarårets historia; personregistret är historiskt.</li>
        <li><b>IPU</b> – personsök (people) är partiell; kammarens records används som grunddata. Personer/partiledare saknas.</li>
        <li><b>OECD / Norden</b> – inga tillförlitliga öppna API för området (se M10/M11-verifiering); uteslutna.</li>
      </ul>
    </div>
  );
}
