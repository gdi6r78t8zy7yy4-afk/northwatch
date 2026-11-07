// M10: industristatusanalys (område 7). Slår ihop områdets records till en
// 0–100-poäng per land i tre komponenter:
//   production (v 0.5): senaste index (2021=100, per källa) + 12-månaders-
//                       förändring (%) ur Eurostat EI_ISIN_M/EI_ISIR_M och
//                       StatFins omsättningsindex
//   trade      (v 0.3): balans/import per källa (nationella statistikbyråer,
//                       Eurostat EFTA-handel) samt UN Comtrade (export/import
//                       → balans = X−M)
//   capacity   (v 0.2): stålkapacitet i Mt (OECD) + antal material landet
//                       levererar till EU (RMIS)
// Saknade komponenter renormaliseras; NORDIC = snitt av de fem länderna med
// per-land-rader i drivers. Ren funktion – inget nätverk, ingen store-koppling.
import { now } from './http.js';

export const NORDIC = ['SE', 'NO', 'DK', 'FI', 'IS'];
export const WEIGHTS = { production: 0.5, trade: 0.3, capacity: 0.2 };
const COMPONENT_KEYS = ['production', 'trade', 'capacity'];

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round1 = v => Math.round(v * 10) / 10;
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const isMoney = r => /eur|sek|nok|isk|usd/i.test(r.unit ?? '');
const isPctLike = r => /%|procent/.test(r.indicator ?? '');
const INDEX_UNITS = new Set(['index 2021=100', 'index 2015=100', 'index']);

// Rekordklassificering: först per källa (rmis/oecd/comtrade), sedan per
// indikator-/enhetstecken. Handelklasser kräver penning-enhet och utesluter
// %-särter; "EU-27-…" är EU-aggregat, inte landets egen handel.
export function classify(r) {
  const ind = r.indicator ?? '';
  if (r.source === 'rmis') return 'rmis';
  if (r.source === 'oecd') return 'capacity';
  if (r.source === 'comtrade') {
    if (/export/i.test(ind)) return 'export';
    if (/import/i.test(ind)) return 'import';
    return null;
  }
  if (r.unit === 'a/a %') return 'yoy';
  if (INDEX_UNITS.has(r.unit)) return 'index';
  if (/^EU-27/.test(ind)) return null;
  const cls = /balans|balance|nettohandel|nett\b|\bnet\b/i.test(ind) ? 'balance'
    : /export|eksport/i.test(ind) ? 'export'
      : /import/i.test(ind) ? 'import'
        : null;
  if (!cls || !isMoney(r) || isPctLike(r)) return null;
  return cls;
}

const byTsDesc = (a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? ''));

export function productionComponent(recs) {
  const bySource = new Map();
  for (const r of recs) {
    if (classify(r) !== 'index') continue;
    const cur = bySource.get(r.source);
    if (!cur || String(r.ts) > String(cur.ts)) bySource.set(r.source, r);
  }
  const scores = [];
  const parts = [];
  const yoyRecs = recs.filter(r => classify(r) === 'yoy');
  if (yoyRecs.length) {
    const yoy = [...yoyRecs].sort(byTsDesc)[0];
    scores.push(clamp(50 + 5 * yoy.value));
    parts.push(`12m-förändring ${yoy.value}% (${yoy.ts})`);
  }
  const idxScores = [];
  for (const r of bySource.values()) {
    idxScores.push(clamp(50 + 2 * (r.value - 100)));
    parts.push(`index ${r.value} (${r.unit}, ${r.ts})`);
  }
  if (idxScores.length) scores.push(avg(idxScores));
  if (!scores.length) return null;
  return { score: round1(avg(scores)), basis: parts.join('; ') };
}

const pickLatest = (cands, prefer) => {
  const sorted = [...cands].sort((a, b) =>
    String(b.ts ?? '').localeCompare(String(a.ts ?? '')) ||
    String(a.indicator).localeCompare(String(b.indicator)));
  const pref = prefer ? sorted.filter(r => prefer.test(r.indicator ?? '')) : [];
  return (pref.length ? pref : sorted)[0] ?? null;
};

const fmtShort = v => (Math.abs(v) >= 1e6 ? `${(v / 1e9).toFixed(1)} bn` : String(v));

export function tradeComponent(recs) {
  const groups = new Map();
  for (const r of recs) {
    const cls = classify(r);
    if (cls !== 'balance' && cls !== 'import' && cls !== 'export') continue;
    const g = groups.get(r.source) ?? { balance: [], import: [], export: [] };
    g[cls].push(r);
    groups.set(r.source, g);
  }
  const scores = [];
  const parts = [];
  for (const [source, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (source === 'comtrade') {
      const x = pickLatest(g.export);
      const m = pickLatest(g.import);
      if (x && m && m.value) {
        const ratio = (x.value - m.value) / m.value;
        scores.push(clamp(50 + 100 * ratio));
        parts.push(`Comtrade: export ${fmtShort(x.value)} / import ${fmtShort(m.value)} USD (${x.ts})`);
      } else if (x || m) {
        parts.push('Comtrade: bara export eller import tillgängligt');
      }
      continue;
    }
    const bal = pickLatest(g.balance, /fob-fob/);
    const imp = pickLatest(g.import, /fob/);
    if (bal && imp && imp.value) {
      const ratio = bal.value / imp.value;
      scores.push(clamp(50 + 100 * ratio));
      parts.push(`${source}: balans ${fmtShort(bal.value)} / import ${fmtShort(imp.value)} ${bal.unit} (${bal.ts})`);
    }
  }
  if (!scores.length) return null;
  return { score: round1(avg(scores)), basis: parts.join(' · ') };
}

// RMIS-leveransrad: "{stage}: {land} levererar {material} till EU ({unit}), {år}".
const SUPPLY_RE = /levererar (.+?) till EU/;

export function capacityComponent(recs) {
  const steelRecs = recs.filter(r =>
    r.source === 'oecd' && r.unit === 'Mt' && Number.isFinite(r.value));
  const steel = steelRecs.length ? [...steelRecs].sort(byTsDesc)[0] : null;
  const materials = new Set();
  for (const r of recs) {
    if (r.source !== 'rmis') continue;
    const m = (r.indicator ?? '').match(SUPPLY_RE);
    if (m) materials.add(m[1]);
  }
  if (!steel && !materials.size) return null;
  const parts = [];
  const score = clamp(20 + 6 * (steel?.value ?? 0), 0, 70) + Math.min(30, 2 * materials.size);
  parts.push(steel
    ? `stålkapacitet ${steel.value} Mt (OECD, ${steel.ts})`
    : 'ingen råstålkapacitet (OECD)');
  if (materials.size) parts.push(`${materials.size} material levererade till EU (RMIS)`);
  return { score: round1(score), basis: parts.join('; ') };
}

export const labelOf = score =>
  score == null ? 'Okänt' : score >= 65 ? 'Expansiv' : score >= 45 ? 'Stabilt' : 'Kontraktion';

// Poäng + drivande faktorer för ett land eller NORDIC (snitt av länderna).
export function industryStatus(country, records) {
  const c = String(country ?? 'NORDIC').toUpperCase();
  const all = records ?? [];
  const recs = all.filter(r => r.t === 'm' && (r.country === c || r.country === 'NORDIC'));
  const sources = [...new Set(recs.map(r => r.source))].sort();
  const asOf = recs.reduce((m, r) => (String(r.ts ?? '') > m ? String(r.ts ?? '') : m), '');

  const components = {
    production: productionComponent(recs),
    trade: tradeComponent(recs),
    capacity: capacityComponent(recs),
  };
  const weightOf = comps => {
    let wsum = 0; let wscore = 0;
    for (const key of COMPONENT_KEYS) {
      if (comps[key]) { wsum += WEIGHTS[key]; wscore += WEIGHTS[key] * comps[key].score; }
    }
    return wsum ? round1(wscore / wsum) : null;
  };

  if (c !== 'NORDIC') {
    const titles = { production: 'Produktion', trade: 'Handel', capacity: 'Kapacitet' };
    const missing = {
      production: 'saknar produktionstäckning',
      trade: 'saknar handelstäckning',
      capacity: 'saknar kapacitetsdata',
    };
    const drivers = COMPONENT_KEYS.map(key => components[key]
      ? `${titles[key]}: ${components[key].basis}`
      : `${titles[key]}: ${missing[key]}`);
    const score = weightOf(components);
    return { country: c, asOf: asOf || now(), score, label: labelOf(score), components, drivers, sources };
  }

  const byCountry = NORDIC.map(x => industryStatus(x, all));
  const nordicComponents = {};
  for (const key of COMPONENT_KEYS) {
    const per = byCountry.filter(x => x.components[key]).map(x => ({ c: x.country, s: x.components[key].score }));
    nordicComponents[key] = per.length
      ? { score: round1(avg(per.map(x => x.s))), basis: per.map(x => `${x.c} ${x.s}`).join(' · ') }
      : null;
  }
  const score = byCountry.map(x => x.score).filter(s => s != null).length
    ? round1(avg(byCountry.map(x => x.score).filter(s => s != null)))
    : null;
  return {
    country: 'NORDIC', asOf: byCountry.reduce((m, x) => (x.asOf > m ? x.asOf : m), ''),
    score, label: labelOf(score), components: nordicComponents,
    drivers: byCountry.map(x => `${x.country}: ${x.score ?? '–'} (${x.label})`),
    sources, countries: byCountry,
  };
}

// Underliggande records + källstatus för dashboardens per-källa-paneler.
export function industryData(country, sources) {
  const c = String(country ?? 'ALL').toUpperCase();
  const srcs = sources ?? [];
  const records = srcs
    .flatMap(s => s.records ?? [])
    .filter(r => c === 'ALL' || r.country === c || r.country === 'NORDIC')
    .sort((a, b) => String(b.ts ?? b.start ?? '').localeCompare(String(a.ts ?? a.start ?? '')));
  return {
    records,
    sources: srcs.map(s => ({
      id: s.id, name: s.name, country: s.country, every: s.every,
      status: s.status, lastOk: s.lastOk, lastError: s.lastError,
      ms: s.ms, error: s.error, count: (s.records ?? []).length,
    })),
  };
}
