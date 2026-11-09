// M11: förvaltningsstatusanalys (område 12). Slår ihop områdets records till
// ett Förvaltningsindex 0–100 per land i tre delscore:
//   aktivitet     (v 0.4): per-källa aktivitetsmätare (begränsade/log-skalor,
//                          0–1 per källa; snitt över tillgängliga källor)
//   kontinuitet   (v 0.3): institutionerna pågår – aktuella mandat/sessioner,
//                          pågående flöden, datafreshness (2× taktgräns)
//   observerbarhet(v 0.3): öppenhet – andel öppna dataset, sammansättning,
//                          publicerad grunddata
// Saknad källa → saknad delscore → vikterna renormaliseras över de övriga
// (M10-modellen). NORDIC = snitt av de fem länderna med per-land-rader i
// drivers. Ren funktion – inget nätverk, ingen store-koppling.
import { now } from './http.js';

export const NORDIC = ['SE', 'NO', 'DK', 'FI', 'IS'];
export const WEIGHTS = { aktivitet: 0.4, kontinuitet: 0.3, observerbarhet: 0.3 };
const KEYS = ['aktivitet', 'kontinuitet', 'observerbarhet'];
const TITLES = { aktivitet: 'Aktivitet', kontinuitet: 'Kontinuitet', observerbarhet: 'Observerbarhet' };

const clamp01 = v => Math.min(1, Math.max(0, v));
const round1 = v => Math.round(v * 10) / 10;
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

// Senaste (max-ts) matchande metric-record (t:'m', icke-nulla value).
const numRec = (recs, re) => {
  let best = null;
  for (const x of recs) {
    if (x.t !== 'm' || x.value == null || !re.test(x.indicator ?? '')) continue;
    if (!best || String(x.ts ?? '') > String(best.ts ?? '')) best = x;
  }
  return best;
};
const num = (recs, re) => numRec(recs, re)?.value ?? null;

// Datafreshness: 1.0 inom källans takt, linjär nedgång till 0 vid 3× takt.
// Ej fullständigt datum (t.ex. "2026") → anses friskt (data avser året).
const freshness = (srcRecs, cadenceSec, nowIso) => {
  const maxTs = srcRecs.reduce((m, r) => (String(r.ts ?? '') > m ? String(r.ts) : m), '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(maxTs)) return 1;
  const days = (Date.parse(nowIso) - Date.parse(maxTs)) / 86400000;
  const expect = cadenceSec / 86400;
  if (days <= expect) return 1;
  return clamp01(1 - (days - expect) / (2 * expect));
};

// ---- Per-källa signaler (0–1 vardera) --------------------------------------

function riksdagenSignal(recs, evts, nowIso) {
  const events = num(recs, /Kalenderhändelser, kammarkalendern/) ?? null;
  const votes = num(recs, /^Omröstningar \(kammaråret/) ?? 0;
  const speeches = num(recs, /^Anföranden \(kammaråret/) ?? 0;
  const members = num(recs, /Tjänstgörande riksdagsledamöter/) ?? null;
  const women = num(recs, /Kvinnor bland tjänstgörande/) ?? null;
  if (events == null && members == null) return null;
  const future = evts.filter(e => String(e.start ?? '') > String(nowIso).slice(0, 10)).length;
  return {
    akt: clamp01(Math.log10(1 + (events ?? 0) + 0.25 * votes + 0.15 * speeches) / 2),
    kont: future > 0 ? 1 : 0.2,
    obs: members
      ? 0.6 * clamp01(members / 350) + 0.4 * (women != null ? clamp01(women / members) : 0.5)
      : null,
    part: {
      aktivitet: `riksdagen: ${events ?? '?'} kalenderhändelser, ${votes} omröstningar, ${speeches} anföranden`,
      kontinuitet: `riksdagen: ${future} kommande kalenderhändelser`,
      observerbarhet: `riksdagen: ${members ?? '?'} tjänstgörande ledamöter, ${women ?? '?'} kvinnor`,
    },
  };
}

function fdkSignal(recs) {
  const all = num(recs, /Dataset i Felles datakatalog/);
  if (all == null) return null;
  const m365 = num(recs, /uppdaterad metadata \(≤365 d\)/);
  const m30 = num(recs, /metadataändring \(≤30 d\)/);
  const n365 = num(recs, /Nyregistrerade dataset \(≤365 d\)/) ?? 0;
  const openN = num(recs, /Öppna dataset \(allmän åtkomst\)/);
  const openPct = num(recs, /Öppna dataset \(andel\)/);
  const share = openPct != null ? openPct / 100 : openN != null && all ? openN / all : null;
  return {
    // Nyregistrerade dataset är den faktiska öppna-data-produktionen;
    // metadataändringar ≤30 d är typiskt få för en stabil katalog.
    akt: clamp01(n365 / 1000),
    kont: m30 > 0 ? 1 : m365 != null && m365 > 0 ? 0.5 : 0.1,
    obs: share,
    part: {
      aktivitet: `fdk: ${n365} nyregistrerade dataset ≤365 d av ${all} totalt`,
      kontinuitet: m30 > 0 ? `fdk: ${m30} metadataändringar ≤30 d` : `fdk: ${m365 ?? 0} ändrade ≤365 d`,
      observerbarhet: `fdk: ${share != null ? Math.round(share * 100) : '?'}% öppna av ${all} dataset`,
    },
  };
}

function rtiSignal(recs) {
  const d7 = num(recs, /^Lagändringar, senaste \d+ dygn/);
  if (d7 == null) return null;
  const types = new Set();
  for (const r of recs) {
    if (r.t !== 'm' || r.value == null) continue;
    const m = (r.indicator ?? '').match(/^Lagändringar per typ: (.+?) \(\d+ d\)$/);
    if (m) types.add(m[1]);
  }
  return {
    akt: clamp01(d7 / 500),
    kont: d7 > 0 ? 1 : 0.4,
    obs: Math.min(1, types.size / 8),
    part: {
      aktivitet: `retsinformation: ${d7} lagändringar senaste 7 d`,
      kontinuitet: d7 > 0 ? 'retsinformation: kontinuerligt lagflöde' : 'retsinformation: tyst vecka (helger normalt)',
      observerbarhet: `retsinformation: ${types.size} dokumenttyper publicerade`,
    },
  };
}

function finlexSignal(recs) {
  const year = Number(new Date().getFullYear());
  // \b: matchar både "Nya lagar 2026" och "Nya lagar 2026 (estimat)" men inte
  // föregående års "(hela året)"-records (de bär ett annat år).
  const newCur = num(recs, new RegExp(`^Nya lagar ${year}\\b`));
  const verCur = num(recs, new RegExp(`^Lagversioner ${year}\\b`));
  const newPrev = num(recs, new RegExp(`^Nya lagar ${year - 1}`)) ?? 0;
  const modPrev = num(recs, new RegExp(`^Ändrade lagar ${year - 1}`)) ?? 0;
  if (newCur == null && verCur == null) return null;
  const published = (verCur ?? 0) + newPrev + modPrev;
  return {
    akt: clamp01((newCur ?? 0) / 300),
    kont: (newCur ?? 0) > 0 ? 1 : 0,
    obs: clamp01(published / 3000),
    part: {
      aktivitet: `finlex: ${newCur ?? 0} nya lagar ${year} (löpande)`,
      kontinuitet: (newCur ?? 0) > 0 ? `finlex: lagsättning pågår ${year}` : `finlex: inga nya lagar ${year}`,
      observerbarhet: `finlex: ${published} lagversioner publicerade (inkl. ${newPrev + modPrev} från ${year - 1})`,
    },
  };
}

function ipuSignal(recs) {
  const laws = num(recs, /Lagar antagna per år/);
  const staff = num(recs, /Parlamentsanställda/) ?? null;
  const members = num(recs, /Ledamöter, kammare/) ?? null;
  const women = num(recs, /Kvinnor bland ledamöter/) ?? null;
  const parties = num(recs, /Politiska partier/) ?? null;
  const daysRec = numRec(recs, /^Dagar sedan senaste val \(/);
  if (laws == null && members == null) return null;
  let kont = null;
  let kontPart = 'ipu: valdatum okänt';
  if (daysRec) {
    const d = daysRec.value;
    kont = d <= 7 * 365 ? 1 : d <= 10 * 365 ? 0.5 : 0.2;
    kontPart = `ipu: val ${daysRec.indicator.match(/\(([^)]+)\)/)?.[1]} (${Math.round(d / 30.44) / 10 * 10} mån)`;
  }
  return {
    akt: laws != null ? clamp01(laws / 800) : null,
    kont,
    obs: members
      ? 0.5 * clamp01((women ?? 0) / members) + 0.3 * clamp01((parties ?? 0) / 15) + 0.2 * clamp01((staff ?? 0) / 700)
      : null,
    part: {
      aktivitet: `ipu: ${laws ?? '?'} lagar/år`,
      kontinuitet: kontPart,
      observerbarhet: `ipu: ${women ?? '?'}/${members ?? '?'} kvinnor, ${parties ?? '?'} partier, ${staff ?? '?'} anställda`,
    },
  };
}

function dataportalSignal(recs) {
  const total = num(recs, /Öppna dataset i data.europa.eu/);
  if (total == null) return null;
  const mod30 = num(recs, /Dataset uppdaterade \(≤30 d\)/) ?? 0;
  return {
    akt: clamp01(mod30 / 1000),
    kont: mod30 > 0 ? 1 : 0.2,
    // Kvadratrotskala: portalmängderna skiljer sig upp till 40× mellan länderna
    // (SE 25 000+ mot IS ~600) – sqrt dämpar skalan till hanterbar spridning.
    obs: clamp01(Math.sqrt(total / 25000)),
    part: {
      aktivitet: `dataportal: ${mod30} dataset uppdaterade ≤30 d`,
      kontinuitet: mod30 > 0 ? 'dataportal: pågående uppdatering' : 'dataportal: ingen uppdatering ≤30 d',
      observerbarhet: `dataportal: ${total} öppna dataset`,
    },
  };
}

function cellarSignal(recs) {
  const total = num(recs, /^EU-rättsliga texter \d{4}/);
  if (total == null) return null;
  return {
    akt: clamp01(total / 3000),
    kont: total > 0 ? 1 : 0,
    obs: clamp01(total / 3000),
    part: {
      aktivitet: `cellar: ${total} EU-rättsliga texter (YTD)`,
      kontinuitet: total > 0 ? 'cellar: EU-rättslig produktion pågår' : 'cellar: inga nya EU-texter',
      observerbarhet: `cellar: ${total} texter publicerade i EUR-Lex`,
    },
  };
}

// Källans tillämplighet per land + takt (s) + signal. cc: null → alla länder,
// 'NORDIC' → gemensam bas (cellar), annars enstaka land (riksdagen/fdk/rti/finlex).
const SOURCES = {
  riksdagen: { cc: 'SE', cadence: 604800, signal: (r, e, n) => riksdagenSignal(r, e, n) },
  fdk: { cc: 'NO', cadence: 604800, signal: r => fdkSignal(r) },
  retsinformation: { cc: 'DK', cadence: 86400, signal: r => rtiSignal(r) },
  finlex: { cc: 'FI', cadence: 604800, signal: r => finlexSignal(r) },
  ipu: { cc: null, cadence: 604800, signal: r => ipuSignal(r) },
  dataportal: { cc: null, cadence: 2592000, signal: r => dataportalSignal(r) },
  cellar: { cc: 'NORDIC', cadence: 2592000, signal: r => cellarSignal(r) },
};

function countryStatus(cc, all) {
  const nowIso = now();
  const recs = all.filter(r => r.t === 'm' && r.area === 12 && (r.country === cc || r.country === 'NORDIC'));
  const evts = all.filter(r => r.t === 'e' && r.area === 12 && r.country === cc);
  const results = {};
  for (const [id, cfg] of Object.entries(SOURCES)) {
    if (cfg.cc && cfg.cc !== 'NORDIC' && cfg.cc !== cc) continue;
    const srcRecs = recs.filter(r => r.source === id);
    if (!srcRecs.length) continue;
    const sig = cfg.signal(srcRecs, evts.filter(e => e.source === id), nowIso);
    if (!sig) continue;
    // Datafreshness nedsätter kontinuiteten: 1 inom takt, 0 vid 3× takt.
    const fresh = freshness(srcRecs, cfg.cadence, nowIso);
    if (sig.kont != null) sig.kont = clamp01(sig.kont * fresh);
    results[id] = sig;
  }

  const components = {};
  for (const k of KEYS) {
    const field = k === 'aktivitet' ? 'akt' : k === 'kontinuitet' ? 'kont' : 'obs';
    const pairs = Object.values(results)
      .map(s => ({ v: s[field], part: s.part?.[k] }))
      .filter(p => p.v != null);
    components[k] = pairs.length
      ? { score: round1(100 * avg(pairs.map(p => p.v))), basis: pairs.map(p => p.part).filter(Boolean).join(' · ') }
      : null;
  }
  let wsum = 0; let wscore = 0;
  for (const k of KEYS) {
    if (components[k]) { wsum += WEIGHTS[k]; wscore += WEIGHTS[k] * components[k].score; }
  }
  const score = wsum ? round1(wscore / wsum) : null;
  const missing = {
    aktivitet: 'saknar aktivitetsdata',
    kontinuitet: 'saknar kontinuitetsdata',
    observerbarhet: 'saknar öppningsdata',
  };
  const drivers = KEYS.map(k => components[k]
    ? `${TITLES[k]}: ${components[k].basis}`
    : `${TITLES[k]}: ${missing[k]}`);
  const asOf = recs.reduce((m, r) => (String(r.ts ?? '') > m ? String(r.ts) : m), '');
  const sources = [...new Set(recs.map(r => r.source))].sort();
  return { country: cc, asOf: asOf || nowIso, score, label: labelOf(score), components, drivers, sources };
}

export const labelOf = s =>
  s == null ? 'Okänt' : s >= 75 ? 'Hög trygghet' : s >= 55 ? 'Stabilt' : s >= 35 ? 'Uppmärksamhet' : 'Svag';

// Förvaltningsindex för ett land eller NORDIC (snitt av de fem länderna).
export function forvaltningStatus(country, records) {
  const c = String(country ?? 'NORDIC').toUpperCase();
  const all = (records ?? []).filter(r => r.area === 12);
  const asOf = all.reduce((m, r) => (String(r.ts ?? '') > m ? String(r.ts) : m), '');
  const sources = [...new Set(all.filter(r => r.t === 'm').map(r => r.source))].sort();

  if (c !== 'NORDIC') return countryStatus(c, all);

  const byCountry = NORDIC.map(x => countryStatus(x, all));
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
export function forvaltningData(country, sources) {
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
