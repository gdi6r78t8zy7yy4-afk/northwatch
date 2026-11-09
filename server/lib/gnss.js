// M12: GNSS-/rymdstatusanalys (område 10). Slår ihop områdets records till ett
// GNSS-index 0–100 per land i fyra delscore:
//   tillgänglighet (v 0.35): andel Galileo-satelliter USABLE (GSC) × andel
//                          aktiva stationer i landet (M3G) – båda 0–1
//   stabilitet     (v 0.25): rymdväders lugn – Kp-band från NOAA SWPC
//   varningstäthet (v 0.20): NAGU-händelser inom 30 d (GSC-RSS), log-skalad
//                          och inverterad; global (Galileo) men påverkar alla
//   täckning       (v 0.20): stationsantal/land mot referensnetätthet (M3G)
// Saknad källa → saknad delscore → vikterna renormaliseras över de övriga
// (M10/M11-modellen). NORDIC = snitt av de fem länderna med per-land-rader i
// drivers. Ren funktion – inget nätverk, ingen store-koppling.
import { now } from './http.js';

export const NORDIC = ['SE', 'NO', 'DK', 'FI', 'IS'];
export const WEIGHTS = { tillgänglighet: 0.35, stabilitet: 0.25, varningstäthet: 0.2, täckning: 0.2 };
const KEYS = ['tillgänglighet', 'stabilitet', 'varningstäthet', 'täckning'];
const TITLES = { tillgänglighet: 'Tillgänglighet', stabilitet: 'Stabilitet', varningstäthet: 'Varningstäthet', täckning: 'Täckning' };

// Referens för täckningsscoren: antal M3G-stationer som ger full poäng.
// Speglar nationella nätverk i EPOS-urvalet (SWEPOS/NOANET/REFN/GNOS/ISNET),
// justerade för vad M3G faktiskt listar (verifierat 2026-11-09).
export const STATION_TARGETS = { SE: 70, NO: 45, DK: 25, FI: 45, IS: 25 };

const clamp01 = v => Math.max(0, Math.min(1, v));
const round1 = v => Math.round(v * 10) / 10;
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// Hitta senaste metric-post som matchar regex (records är inte sorterade).
const numRec = (recs, re) => {
  let best = null;
  for (const r of recs) {
    if (r.t !== 'm' || typeof r.indicator !== 'string') continue;
    if (!re.test(r.indicator)) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (!best || String(r.ts ?? '') > best.ts) best = { ts: String(r.ts ?? ''), value: v };
  }
  return best;
};

// Kp → lugnhetsscore 0–1.
export const kpScore = kp => (kp <= 4 ? 1 : kp === 5 ? 0.7 : kp === 6 ? 0.4 : kp === 7 ? 0.2 : 0);

// Antal NAGU-händelser med start inom fönster dagar (severity oavsett).
export const naguCount = (recs, days = 30) => {
  const cutoff = Date.now() - days * 86400_000;
  return recs.filter(r => r.t === 'e' && r.source === 'gsc-europa' && r.kind === 'nagu'
    && Number.isFinite(Date.parse(String(r.start ?? ''))) && Date.parse(r.start) >= cutoff).length;
};

function countryStatus(cc, all, nowIso) {
  const recs = all.filter(r => r.country === cc || r.country === 'NORDIC');
  const gsc = recs.filter(r => r.source === 'gsc-europa');
  const m3g = recs.filter(r => r.source === 'gnss-metadata');

  // tillgänglighet: Galileo-andel (global) × aktiv stationsandel (land).
  const galShareRec = numRec(gsc, /^Andel tillgängliga Galileo-satelliter$/);
  const activeRec = numRec(m3g, /^Aktiva GNSS-stationer \(andel\)$/);
  let tillg = null; let tillgBasis = 'saknar tillgänglighetsdata';
  if (galShareRec || activeRec) {
    const parts = [];
    let prod = 1; let n = 0;
    if (galShareRec) { prod *= clamp01(galShareRec.value / 100); parts.push(`Galileo ${round1(galShareRec.value)} % USABLE`); n++; }
    if (activeRec) { prod *= clamp01(activeRec.value / 100); parts.push(`${cc} ${round1(activeRec.value)} % aktiva stationer`); n++; }
    tillg = round1(prod * 100);
    tillgBasis = parts.join(' · ');
  }

  // stabilitet: Kp (global).
  const kpRec = numRec(recs.filter(r => r.source === 'noaa'), /^Kp-index \(globalt geomagnetiskt\)$/);
  let stab = null; let stabBasis = 'saknar rymdvädersdata';
  if (kpRec) {
    stab = round1(kpScore(kpRec.value) * 100);
    stabBasis = `Kp ${kpRec.value} → ${stab}`;
  }

  // varningstäthet: NAGU-aktivitet 30 d (global Galileo, log-skalad inverterad).
  let varn = null; let varnBasis = 'saknar NAGU-data';
  if (gsc.length) {
    const n = naguCount(recs);
    varn = round1(clamp01(1 - Math.log1p(n) / Math.log(9)) * 100); // 0→100, ~8→~0
    varnBasis = `${n} NAGU ≤30 d → ${varn}`;
  }

  // täckning: stationsantal mot referens.
  const countRec = numRec(m3g, /^GNSS-stationer \(M3G\)( \(minst\))?$/);
  let tack = null; let tackBasis = 'saknar stationsdata';
  if (countRec) {
    const target = STATION_TARGETS[cc] ?? 40;
    tack = round1(clamp01(countRec.value / target) * 100);
    tackBasis = `${countRec.value} stationer mot ${target} → ${tack}`;
  }

  const components = {
    tillgänglighet: tillg == null ? null : { score: tillg, basis: tillgBasis },
    stabilitet: stab == null ? null : { score: stab, basis: stabBasis },
    varningstäthet: varn == null ? null : { score: varn, basis: varnBasis },
    täckning: tack == null ? null : { score: tack, basis: tackBasis },
  };

  let wsum = 0; let wscore = 0;
  for (const k of KEYS) {
    if (components[k]) { wsum += WEIGHTS[k]; wscore += WEIGHTS[k] * components[k].score; }
  }
  const score = wsum ? round1(wscore / wsum) : null;
  const missing = {
    tillgänglighet: 'saknar satellit-/stationsdata',
    stabilitet: 'saknar rymdvädersdata',
    varningstäthet: 'saknar NAGU-data',
    täckning: 'saknar stationsantal',
  };
  const drivers = KEYS.map(k => components[k]
    ? `${TITLES[k]}: ${components[k].basis}`
    : `${TITLES[k]}: ${missing[k]}`);
  const asOf = recs.reduce((m, r) => (String(r.ts ?? '') > m ? String(r.ts) : m), '');
  const sources = [...new Set(recs.map(r => r.source))].sort();
  return { country: cc, asOf: asOf || nowIso, score, label: labelOf(score), components, drivers, sources };
}

export const labelOf = s =>
  s == null ? 'Okänt' : s >= 75 ? 'Hög driftssäkerhet' : s >= 55 ? 'Stabil drift' : s >= 35 ? 'Uppmärksamhet' : 'Svag';

// GNSS-index för ett land eller NORDIC (snitt av de fem länderna).
export function gnssStatus(country, records) {
  const c = String(country ?? 'NORDIC').toUpperCase();
  const all = (records ?? []).filter(r => r.area === 10);
  const asOf = all.reduce((m, r) => (String(r.ts ?? '') > m ? String(r.ts) : m), '');
  const sources = [...new Set(all.filter(r => r.t === 'm').map(r => r.source))].sort();

  if (c !== 'NORDIC' && NORDIC.includes(c)) return countryStatus(c, all, now());
  // NORDIC/ALL/okänt land → nordisk sammanfattning.

  const byCountry = NORDIC.map(x => countryStatus(x, all, now()));
  const components = {};
  for (const k of KEYS) {
    const per = byCountry.filter(x => x.components[k]).map(x => ({ c: x.country, s: x.components[k].score }));
    components[k] = per.length
      ? { score: round1(avg(per.map(x => x.s))), basis: per.map(x => `${x.c} ${x.s}`).join(' · ') }
      : null;
  }
  const scored = byCountry.map(x => x.score).filter(s => s != null);
  const score = scored.length ? round1(avg(scored)) : null;
  return {
    country: 'NORDIC',
    asOf: asOf || now(),
    score,
    label: labelOf(score),
    components,
    drivers: byCountry.map(x => `${x.country}: ${x.score ?? '–'} (${x.label})`),
    sources,
    countries: byCountry,
  };
}

// Underliggande records + källstatus för dashboardens per-källa-paneler.
export function gnssData(country, sources) {
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
