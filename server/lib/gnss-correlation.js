// M12: korrelations- och anomalilager för område 10 (GNSS/rymd). Helt
// deterministiskt: reglerna ser bara på nuvarande snapshot av records
// (store setResult ersätter per källa, ingen historik i minnet) – tidsglapp
// byggs ur händelsernas egna timestamps. LLM (qwen3.8-flash-next via lib/llm.js)
// är ENBART en presentationell berikelse av den deterministiska texten:
// summarizer-parametern kan injiceras i tester; utan LLM_BASE_URL eller vid
// fel används malltexten. Inget nätverk sker här annars.
import { now } from './http.js';
import { llmSummarize } from './llm.js';

const H = 3600_000;
export const WINDOW_H = 72; // storm ↔ NAGU-korrelationsfönster

const latestMetric = (recs, re) => {
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

export const isActiveNagu = (r, at = Date.now()) => {
  const s = Date.parse(String(r.start ?? ''));
  if (!Number.isFinite(s)) return false;
  const e = r.end ? Date.parse(String(r.end)) : null;
  return !Number.isFinite(e) || e > at; // slutdatum N/A = pågående
};

// Regelbundna anomalier ur nuvarande snapshot.
export function gnssAnomalies(records, at = Date.now()) {
  const recs = (records ?? []).filter(r => r.area === 10);
  const out = [];

  const kp = latestMetric(recs.filter(r => r.source === 'noaa'), /^Kp-index \(globalt geomagnetiskt\)$/);
  if (kp && kp.value >= 5) {
    out.push({
      kind: 'rymdväder', severity: kp.value >= 7 ? 'alert' : 'warn', ts: kp.ts,
      title: `Geomagnetisk aktivitet – Kp ${kp.value}`,
      detail: 'Kp ≥ 5 kan försämra GNSS-positionering och radiokommunikation i högbredderna.',
    });
  }

  const share = latestMetric(recs.filter(r => r.source === 'gsc-europa'), /^Andel tillgängliga Galileo-satelliter$/);
  if (share && share.value < 75) {
    out.push({
      kind: 'konstellation', severity: 'alert', ts: share.ts,
      title: `Låg andel tillgängliga Galileo-satelliter (${share.value} %)`,
      detail: 'Fler satelliter är NOT USABLE än normalt (75 %).',
    });
  } else if (share && share.value < 80) {
    out.push({
      kind: 'konstellation', severity: 'warn', ts: share.ts,
      title: `Några Galileo-satelliter utilgängliga (${share.value} %)`,
      detail: 'Under 80 % av konstellationen är USABLE.',
    });
  }

  const nagus = recs.filter(r => r.t === 'e' && r.source === 'gsc-europa' && r.kind === 'nagu');
  const active = nagus.filter(r => isActiveNagu(r, at));
  if (active.length) {
    out.push({
      kind: 'nagu', severity: 'warn', ts: String(active[0]?.start ?? ''),
      title: `${active.length} pågående NAGU`,
      detail: active.slice(0, 3).map(r => r.title).join(' · '),
    });
  }

  for (const r of recs) {
    if (r.t === 'm' && /^Epokålder \(/.test(String(r.indicator ?? '')) && Number(r.value) > 72) {
      out.push({
        kind: 'datakälla', severity: 'warn', ts: String(r.ts ?? ''),
        title: `Inaktuella elementset – ${r.indicator}`,
        detail: 'GP-elementen uppdateras inte; positionsberäkningar kan vara felaktiga.',
      });
    }
  }

  return out.sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
}

// Storm ↔ NAGU-kedjor: NOAA geomagnetiska händelser × GSC NAGU inom ±72 h.
export function gnssChains(records, at = Date.now()) {
  const recs = (records ?? []).filter(r => r.area === 10);
  const storms = recs.filter(r => r.t === 'e' && r.source === 'noaa' && r.kind === 'geomagnetiskt')
    .map(r => ({ start: Date.parse(String(r.start ?? '')), title: r.title, severity: r.severity }))
    .filter(s => Number.isFinite(s.start));
  const nagus = recs.filter(r => r.t === 'e' && r.source === 'gsc-europa' && r.kind === 'nagu')
    .map(r => ({ start: Date.parse(String(r.start ?? '')), title: r.title, severity: r.severity, end: r.end }))
    .filter(n => Number.isFinite(n.start));

  const chains = [];
  for (const s of storms) {
    const items = nagus.filter(n => Math.abs(n.start - s.start) <= WINDOW_H * H);
    if (!items.length) continue;
    chains.push({
      id: `storm:${new Date(s.start).toISOString()}`,
      type: 'storm-nagu', t0: new Date(s.start).toISOString(),
      storm: { title: s.title, severity: s.severity },
      nagus: items.map(n => ({ title: n.title, start: new Date(n.start).toISOString(), end: n.end ?? null })),
      score: items.length + (s.severity === 'alert' ? 2 : 1),
    });
  }

  // Pågående sammanfallande rymdväder + NAGU just nu.
  const kp = latestMetric(recs.filter(r => r.source === 'noaa'), /^Kp-index \(globalt geomagnetiskt\)$/);
  const activeNagus = nagus.filter(n => isActiveNagu({ start: new Date(n.start).toISOString(), end: n.end }, at));
  if (kp && kp.value >= 5 && activeNagus.length) {
    chains.push({
      id: 'active', type: 'active-now', t0: now(),
      storm: { title: `Kp ${kp.value} just nu`, severity: kp.value >= 7 ? 'alert' : 'warn' },
      nagus: activeNagus.map(n => ({ title: n.title, start: new Date(n.start).toISOString(), end: n.end ?? null })),
      score: 10 + activeNagus.length,
    });
  }

  return chains.sort((a, b) => b.score - a.score);
}

// Deterministisk malltext (används alltid som fallback och som LLM-promptbas).
export function gnssNarrative(anomalies, chains) {
  const parts = [];
  if (!anomalies.length && !chains.length) return 'Inga aktiva rymd- eller GNSS-anomalier i nuläget. Konstellation och geomagnetiskt fält inom normalspann.';
  if (chains.length) {
    const c = chains[0];
    parts.push(c.type === 'active-now'
      ? `Geomagnetisk aktivitet sammanfaller just nu med ${c.nagus.length} pågående NAGU.`
      : `${c.storm.title} korrelerar med ${c.nagus.length} NAGU inom ±${WINDOW_H} h.`);
  }
  const kinds = {};
  for (const a of anomalies) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  parts.push(`Aktiva anomalier: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}.`);
  const alerts = anomalies.filter(a => a.severity === 'alert').length;
  if (alerts) parts.push(`${alerts} av dem klassificeras som allvarliga.`);
  return parts.join(' ');
}

// Huvudroute: deterministisk analys + valfri LLM-berikelse. summarizer kan
// injiceras i tester – annars llmSummarize (avstängd utan LLM_BASE_URL).
export async function gnssCorrelation(records, { summarizer = llmSummarize } = {}) {
  const anomalies = gnssAnomalies(records);
  const chains = gnssChains(records);
  const fallback = gnssNarrative(anomalies, chains);

  let narrative = fallback;
  let narrativeSource = 'deterministic';
  if (chains.length || anomalies.some(a => a.severity === 'alert')) {
    const prompt = [
      'Sammanfatta nuläget för nordisk GNSS-drift på svenska, 2–3 meningar.',
      `Anomalier: ${anomalies.map(a => `${a.severity} ${a.kind}: ${a.title}`).join(' | ') || 'inga'}`,
      `Kedjor (rymdväder↔NAGU): ${chains.map(c => `${c.type} @${c.t0}: ${c.storm?.title ?? ''} + ${c.nagus.length} NAGU`).join(' | ') || 'inga'}`,
    ].join('\n');
    let llm = null;
    try { llm = await summarizer(prompt); } catch { /* modellen svarar inte → deterministisk text */ }
    if (llm) { narrative = llm; narrativeSource = 'llm'; }
  }

  return { generatedAt: now(), anomalies, chains, narrative, narrativeSource };
}
