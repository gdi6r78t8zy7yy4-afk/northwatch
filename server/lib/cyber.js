// M9: cyberdatslager – NIST NVD CVE API 2.0, CISA KEV och OSV.dev.
// Samma mönster som lib/forecast.js: inminnescache med TTL + in-flight-dedupe
// + API-handlingar som servas via /api/cyber/*. Frontend pratar aldrig med
// externa källor; NVD_API_KEY lämnar aldrig processen.
//
// Källor:
//   NVD:  GET https://services.nvd.nist.gov/rest/json/cves/2.0
//         – 30-dagars publiceringsfönster, pagineras med resultsPerPage=2000
//           (max utan virtualMatchString/keywordSearch). NVD_API_KEY höjer
//           rate-limiten (5/30 s → 50/30 s) och minskar sidfördröjningen.
//         – verified live 2026-11-06: veckofönstret ≈ 3 500 CVE,
//           ?cveId=<id> returnerar en enskild CVE (används i KEV×NVD-joinen).
//   KEV:  GET https://www.cisa.gov/sites/default/files/feeds/
//         known_exploited_vulnerabilities.json – JSON-bakåten hos katalogsidan
//         cisa.gov/known-exploited-vulnerabilities-catalog (~1 800 posteringar,
//         fält: cveID, vendorProject, product, dateAdded, dueDate,
//         requiredAction, knownRansomwareCampaignUse, cwes, notes, …).
//   OSV:  POST https://api.osv.dev/v1/query – en POST per övervakat paket
//         (utan version → alla rapporter mot paketet). querybatch avvisas om
//         enskild post är ogiltig, därför per-paket med tolererat fel per
//         paket. Maven kräver groupId:artifactId. OSV kräver ett
//         "normalt" User-Agent + HTTP/2-ish klient (verifierat via undici).
import { j, jjson, now, sleep, UA } from './http.js';

const clampInt = (v, dflt, lo, hi) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const ttlEnv = (name, dflt) => clampInt(process.env[name], dflt, 60, 86400);

export const cyber = {
  nvd: null, // { fetchedAt, dbTotal, capped, rows:[trimCve] }
  kev: null, // { fetchedAt, total, dateReleased, entries:[trimKev] }
  osv: null, // { fetchedAt, windowDays, packages:[...], errors:[...], total, new90 }
  kevScore: new Map(), // cveId -> { id, score, severity, vector, at } (24 h TTL)
  error: null, // sista refresh-fel (informationellt)
};

const inflight = {};

async function cached(key, ttlS, fn) {
  const cur = cyber[key];
  const fresh = cur?.fetchedAt && Date.now() - new Date(cur.fetchedAt).getTime() < ttlS * 1000;
  if (fresh) return cur;
  if (!inflight[key]) {
    inflight[key] = fn()
      .then(res => {
        cyber[key] = { ...res, error: null };
        cyber.error = null;
        delete inflight[key];
        return cyber[key];
      })
      .catch(err => {
        delete inflight[key];
        const msg = String(err?.message ?? err);
        cyber.error = msg;
        if (cur) { cur.error = msg; return cur; } // gamlat data är bättre än inget
        throw new Error(msg);
      });
  }
  return inflight[key];
}

// ---- NVD -------------------------------------------------------------------

export const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_TTL = ttlEnv('NVD_TTL_S', 900); // 15 min
const NVD_PAGE = 2000;
export const NVD_WINDOW_DAYS = 30;
export const NVD_MAX_PAGES = clampInt(process.env.NVD_MAX_PAGES, 5, 1, 10);
const NVD_PAGE_DELAY = clampInt(process.env.NVD_PAGE_DELAY_MS, process.env.NVD_API_KEY ? 2000 : 7000, 0, 120000);
const NVD_RETRY_MAX = clampInt(process.env.NVD_RETRY_MAX, 4, 0, 8);
let nvdQueue = Promise.resolve();
let nvdLastRequestAt = 0;

const nvdHeaders = () => (process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {});
const nvdDate = d => d.toISOString().replace(/\.\d{3}Z$/, '.000');

// All NVD calls, including per-CVE enrichment, share one serialized queue.
// This prevents the dashboard and collector from independently bursting NVD.
export function nvdJson(url, opt = {}) {
  const task = nvdQueue.then(async () => {
    for (let attempt = 0; ; attempt += 1) {
      const interval = NVD_PAGE_DELAY;
      const wait = Math.max(0, interval - (Date.now() - nvdLastRequestAt));
      if (wait) await sleep(wait);
      nvdLastRequestAt = Date.now();
      try {
        return await jjson(url, { ...opt, headers: { ...nvdHeaders(), ...(opt.headers ?? {}) }, timeout: opt.timeout ?? 30000 });
      } catch (error) {
        const message = String(error?.message ?? error);
        const retryable = /HTTP (429|5\d\d)\b|fetch failed|network|timed? ?out/i.test(message);
        if (!retryable || attempt >= NVD_RETRY_MAX) throw error;
        const retryDelay = Math.min(60_000, 1000 * (2 ** attempt));
        await sleep(retryDelay);
      }
    }
  });
  nvdQueue = task.catch(() => {});
  return task;
}

export const scoreSeverity = s =>
  (s == null ? null : s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MEDIUM' : 'LOW');

// Trimmar ett NVD-svarsobjekt till en kompakt rad (~200 B). CVSS: föredra
// v3.1 (Primary först), sedan v3.0, sedan v2 (allvarlighetsmappning ur scoren).
export function trimCve(v) {
  const cve = v?.cve ?? {};
  let score = null;
  let severity = null;
  let vector = '';
  const m = cve.metrics ?? {};
  for (const key of ['cvssMetricV31', 'cvssMetricV30']) {
    const list = m[key] ?? [];
    if (!list.length) continue;
    const d = (list.find(e => e.type === 'Primary') ?? list[0]).cvssData ?? {};
    score = d.baseScore ?? null;
    severity = d.baseSeverity ?? scoreSeverity(score);
    vector = d.vectorString ?? '';
    break;
  }
  if (score == null) {
    const list = m.cvssMetricV2 ?? [];
    if (list.length) {
      const d = (list.find(e => e.type === 'Primary') ?? list[0]).cvssData ?? {};
      score = d.baseScore ?? null;
      severity = scoreSeverity(score);
      vector = d.vectorString ?? '';
    }
  }
  const descs = cve.descriptions ?? [];
  const desc = descs.find(x => x.lang === 'en')?.value ?? descs[0]?.value ?? '';
  const cwe = (cve.weaknesses?.[0]?.description ?? []).find(x => x.lang === 'en')?.value ?? '';
  return {
    id: cve.id ?? null,
    published: cve.published ?? null,
    modified: cve.lastModified ?? null,
    status: cve.vulnStatus ?? null,
    desc: desc.length > 240 ? `${desc.slice(0, 237)}…` : desc,
    score,
    severity,
    vector,
    cwe,
    refs: (cve.references ?? []).slice(0, 3).map(r => r.url).filter(Boolean),
  };
}

// NVD returnerar ett publiceringsfönster i ORDNING FRÅN ÄLDSTA (startIndex 0
// = äldst) – verifierat live 2026-11-06: 30 d ≈ 17 600 CVE, där de sista
// dagarna hamnar på de sidor som ett sidkap aldrig når. Därför delas fönstret
// i veckosubfönster som hämtas nyast först: nyaste veckan får störst
// sidbudget (räcker i princip alltid; ~3 500 CVE/vecka ≈ 2 sidor), äldre
// veckor hämtas best-effort. Sidkappat subfönster sätter `capped`.
export async function fetchNvdWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - NVD_WINDOW_DAYS * 86400000);
  // Databastotalen kostar ett anrop ur rate-limitbudgeten – hämta den bara
  // med API-key (utan key är gränsen 5 req/30 s och fönstret tar redan ~10).
  let dbTotal = null;
  if (process.env.NVD_API_KEY) {
    try {
      dbTotal = (await nvdJson(`${NVD_BASE}?resultsPerPage=1`, { timeout: 30000 })).totalResults ?? null;
    } catch { /* databastotalen är nice-to-have – fäll inte fönstret */ }
  }
  const week = 7 * 86400000;
  const chunks = Math.min(5, Math.max(1, Math.ceil(NVD_WINDOW_DAYS / 7)));
  const budgets = [NVD_MAX_PAGES, 2, 2, 1, 1].slice(0, chunks);
  const rows = new Map();
  let capped = false;
  for (let c = 0; c < chunks; c += 1) {
    // Subfönster c täcker (end-(c+1)*7d, end-c*7d], med clamp mot `start`.
    // Gränsmomentet ingår i två grannfönster (NVD-datum är inkludera) –
    // dubletternas av Map:n på cve-id.
    const wEnd = new Date(end.getTime() - c * week);
    const wStart = new Date(Math.max(start.getTime(), end.getTime() - (c + 1) * week));
    if (wEnd <= wStart) continue;
    for (let page = 1; page <= budgets[c]; page += 1) {
      const u = `${NVD_BASE}?resultsPerPage=${NVD_PAGE}&startIndex=${(page - 1) * NVD_PAGE}`
        + `&pubStartDate=${nvdDate(wStart)}&pubEndDate=${nvdDate(wEnd)}`;
      const r = await nvdJson(u, { timeout: 30000 });
      const list = r.vulnerabilities ?? [];
      for (const v of list) {
        const t = trimCve(v);
        if (t.id) rows.set(t.id, t);
      }
      const total = r.totalResults ?? list.length;
      if (list.length < NVD_PAGE || (page - 1) * NVD_PAGE + list.length >= total) break;
      if (page === budgets[c]) { capped = true; break; }
      // The shared NVD queue enforces the minimum interval between all requests.
    }
  }
  return {
    fetchedAt: now(),
    dbTotal,
    capped,
    rows: [...rows.values()].sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? ''))),
  };
}

export const getNvd = () => cached('nvd', NVD_TTL, fetchNvdWindow);

function perDayCounts(rows, days) {
  const counts = new Map();
  for (const r of rows) {
    const k = (r.published ?? '').slice(0, 10);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day: key, n: counts.get(key) ?? 0 });
  }
  return out;
}

const byScore = (a, b) =>
  (b.score ?? -1) - (a.score ?? -1) || String(b.published ?? '').localeCompare(String(a.published ?? ''));
const byNewest = (a, b) => String(b.published ?? '').localeCompare(String(a.published ?? ''));

export async function apiCyberNvd(u) {
  let c;
  try { c = await getNvd(); } catch (e) { return { status: 502, body: { error: `NVD: ${e.message}` } }; }
  const window = clampInt(u.searchParams.get('window'), 7, 1, 30);
  const sev = (u.searchParams.get('severity') ?? '').toUpperCase();
  const q = (u.searchParams.get('q') ?? '').trim().toLowerCase();
  const sort = u.searchParams.get('sort') === 'score' ? 'score' : 'newest';
  const limit = clampInt(u.searchParams.get('limit'), 50, 1, 200);
  const cutoff = Date.now() - window * 86400000;
  const inWindow = c.rows.filter(r => new Date(r.published ?? 0).getTime() >= cutoff);
  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNSCORED: 0 };
  for (const r of inWindow) {
    const k = r.severity ?? 'UNSCORED';
    // NVD skickar ibland baseSeverity "NONE" (score 0) → extra bucket.
    // (Obesvar: `obj[okändNyckel] += 1` ger NaN → null i JSON.)
    bySeverity[k] = (bySeverity[k] ?? 0) + 1;
  }
  let rows = inWindow;
  if (sev) rows = rows.filter(r => (r.severity ?? 'UNSCORED') === sev);
  if (q) rows = rows.filter(r => r.id.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q));
  rows = [...rows].sort(sort === 'score' ? byScore : byNewest);
  return {
    status: 200,
    body: {
      fetchedAt: c.fetchedAt,
      window,
      total: c.rows.length,
      dbTotal: c.dbTotal ?? null,
      capped: c.capped,
      error: c.error ?? null,
      inWindow: inWindow.length,
      bySeverity,
      perDay: perDayCounts(inWindow, window),
      count: rows.length,
      top: rows.slice(0, limit),
    },
  };
}

// ---- CISA KEV ----------------------------------------------------------------

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const KEV_TTL = ttlEnv('KEV_TTL_S', 21600); // 6 h

export function trimKev(v) {
  return {
    id: v.cveID ?? null,
    vendor: v.vendorProject ?? '',
    product: v.product ?? '',
    added: v.dateAdded ?? null,
    due: v.dueDate ?? null,
    action: v.requiredAction ?? '',
    notes: v.notes ?? '',
    short: v.shortDescription ?? v.vulnerabilityName ?? '',
    ransomware: v.knownRansomwareCampaignUse === 'Known',
    cwes: Array.isArray(v.cwes) ? v.cwes : [],
  };
}

export async function fetchKevCatalog() {
  const r = await jjson(KEV_URL, { timeout: 30000 });
  if (!Array.isArray(r.vulnerabilities)) throw new Error('KEV-svaret saknar vulnerabilities');
  return {
    fetchedAt: now(),
    total: r.count ?? r.vulnerabilities.length,
    dateReleased: r.dateReleased ?? now(),
    entries: r.vulnerabilities.map(trimKev)
      .sort((a, b) => String(b.added ?? '').localeCompare(String(a.added ?? ''))),
  };
}

export const getKev = () => cached('kev', KEV_TTL, fetchKevCatalog);

function byMonthCounts(entries, months) {
  const counts = new Map();
  for (const e of entries) {
    const m = (e.added ?? '').slice(0, 7);
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const out = [];
  const d = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    out.push({ month: key, n: counts.get(key) ?? 0 });
  }
  return out;
}

export async function apiCyberKev(u) {
  let c;
  try { c = await getKev(); } catch (e) { return { status: 502, body: { error: `KEV: ${e.message}` } }; }
  const q = (u.searchParams.get('q') ?? '').trim().toLowerCase();
  const ransomware = ['1', 'true'].includes(u.searchParams.get('ransomware'));
  const sort = u.searchParams.get('sort') === 'due' ? 'due' : 'added';
  const limit = clampInt(u.searchParams.get('limit'), 100, 1, 500);
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const d90 = iso(Date.now() - 90 * 86400000);
  const dueMax = iso(Date.now() + 14 * 86400000);
  const today = iso(Date.now());
  const added90 = c.entries.filter(e => (e.added ?? '') >= d90).length;
  const ransom = c.entries.filter(e => e.ransomware).length;
  const dueSoon = c.entries.filter(e => e.due && e.due >= today && e.due <= dueMax).length;
  let rows = c.entries;
  if (ransomware) rows = rows.filter(e => e.ransomware);
  if (q) rows = rows.filter(e => [e.id, e.vendor, e.product, e.short].join(' ').toLowerCase().includes(q));
  if (sort === 'due') rows = [...rows].sort((a, b) => String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')));
  return {
    status: 200,
    body: {
      fetchedAt: c.fetchedAt,
      total: c.total,
      dateReleased: c.dateReleased,
      error: c.error ?? null,
      added90,
      ransomware: ransom,
      dueSoon,
      byMonth: byMonthCounts(c.entries, 12),
      count: rows.length,
      rows: rows.slice(0, limit),
    },
  };
}

// ---- OSV ---------------------------------------------------------------------

const OSV_URL = 'https://api.osv.dev/v1/query';
const OSV_TTL = ttlEnv('OSV_TTL_S', 21600); // 6 h
export const OSV_WINDOW_DAYS = clampInt(process.env.OSV_WINDOW_DAYS, 180, 30, 730);
const OSV_TOP = clampInt(process.env.OSV_TOP_PER_PKG, 30, 1, 200);
// 400 ms mellan paketen: vid ~150 ms såg vi sporadiskt tomma svar under
// burst (verifierat live 2026-11-06 – paket som enstaka probes gav data för
// kom tillbaka som 0 stycken rapporter trots HTTP 200).
const OSV_DELAY = clampInt(process.env.OSV_QUERY_DELAY_MS, 400, 0, 5000);
export const OSV_NEW_DAYS = 90;

// Övervakat utbud: paket som är relevanta för kritisk infrastruktur
// (verifierade mot API:t 2026-11-06; Maven kräver groupId:artifactId).
// Överstyrbar med OSV_WATCH_PACKAGES: "Ecosystem:Paket;Eco:Paket;…"
export const DEFAULT_WATCH = [
  { ecosystem: 'Debian', name: 'openssl' },
  { ecosystem: 'Debian', name: 'nginx' },
  { ecosystem: 'Debian', name: 'curl' },
  { ecosystem: 'Debian', name: 'glibc' },
  { ecosystem: 'Linux', name: 'kernel' },
  { ecosystem: 'npm', name: 'express' },
  { ecosystem: 'npm', name: 'webpack' },
  { ecosystem: 'npm', name: 'react' },
  { ecosystem: 'npm', name: 'axios' },
  { ecosystem: 'npm', name: 'lodash' },
  { ecosystem: 'npm', name: 'jsonwebtoken' },
  { ecosystem: 'PyPI', name: 'django' },
  { ecosystem: 'PyPI', name: 'flask' },
  { ecosystem: 'PyPI', name: 'requests' },
  { ecosystem: 'PyPI', name: 'urllib3' },
  { ecosystem: 'PyPI', name: 'cryptography' },
  { ecosystem: 'PyPI', name: 'pyyaml' },
  { ecosystem: 'PyPI', name: 'pillow' },
  { ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core' },
  { ecosystem: 'Maven', name: 'org.springframework:spring-web' },
  { ecosystem: 'Maven', name: 'org.apache.tomcat:tomcat-catalina' },
  { ecosystem: 'Maven', name: 'org.yaml:snakeyaml' },
  { ecosystem: 'Maven', name: 'commons-io:commons-io' },
  { ecosystem: 'Go', name: 'golang.org/x/net' },
  { ecosystem: 'Go', name: 'golang.org/x/crypto' },
  { ecosystem: 'Go', name: 'github.com/docker/docker' },
];

export function parseWatchEnv(str) {
  if (!str || !str.trim()) return null;
  const out = [];
  for (const part of str.split(';').map(s => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i <= 0) throw new Error(`OSV_WATCH_PACKAGES: ogiltig post "${part}" (förväntat Ecosystem:Paket)`);
    out.push({ ecosystem: part.slice(0, i).trim(), name: part.slice(i + 1).trim() });
  }
  return out.length ? out : null;
}

export const WATCH = parseWatchEnv(process.env.OSV_WATCH_PACKAGES) ?? DEFAULT_WATCH;

const SEV_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1, NONE: -1 };
export const sevRank = s => (s && SEV_RANK[String(s).toUpperCase()] != null ? SEV_RANK[String(s).toUpperCase()] : 0);

// Trimmar en OSV-rapport. Severity saknas ofta (t.ex. distro-advisories) → null.
export function trimOsv(v) {
  const ds = v?.database_specific ?? {};
  const cwes = ds.cwe_ids ?? ds.cweIds ?? [];
  const aliases = v?.aliases ?? [];
  const alias = aliases.find(a => /^CVE-\d{4}-\d+$/.test(a)) ?? aliases[0] ?? null;
  const urls = (v?.references ?? []).map(r => r.url).filter(x => typeof x === 'string' && x);
  const summary = typeof v?.summary === 'string' ? v.summary : '';
  return {
    id: v?.id ?? null,
    alias,
    summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary,
    severity: ds.severity ? String(ds.severity).toUpperCase() : null,
    cwe: Array.isArray(cwes) && cwes.length ? cwes.join(', ') : '',
    published: v?.published ?? null,
    link: urls[0] ?? null,
  };
}

async function queryOsvPackage(pkg) {
  const r = await fetch(OSV_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA() },
    body: JSON.stringify({ package: { name: pkg.name, ecosystem: pkg.ecosystem } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    let msg = '';
    try {
      const d = JSON.parse(await r.text());
      if (d?.message) msg = ` – ${d.message}`;
    } catch { /* icke-JSON */ }
    throw new Error(`HTTP ${r.status} api.osv.dev${msg}`);
  }
  const d = await r.json();
  return d.vulns ?? [];
}

export async function fetchOsvWatchlist() {
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const cutoff = iso(Date.now() - OSV_WINDOW_DAYS * 86400000);
  const new90Cutoff = iso(Date.now() - OSV_NEW_DAYS * 86400000);
  const packages = [];
  const errors = [];
  for (const pkg of WATCH) {
    try {
      let vulns = await queryOsvPackage(pkg);
      if (!vulns.length) {
        // Enstaka paket svarar tomma under burst trots data (se OSV_DELAY).
        // Ett enda nytt försök innan vi accepterar noll; på riktigt tomma
        // paket kostar det bara ett extra anrop.
        await sleep(OSV_DELAY * 2 + 500);
        vulns = await queryOsvPackage(pkg).catch(() => vulns);
      }
      const recent = vulns
        .map(trimOsv)
        .filter(a => a.id && (a.published ?? '') >= cutoff)
        .sort((a, b) =>
          sevRank(b.severity) - sevRank(a.severity)
          || String(b.published ?? '').localeCompare(String(a.published ?? '')));
      packages.push({
        ecosystem: pkg.ecosystem,
        name: pkg.name,
        status: 'ok',
        total: recent.length,
        new90: recent.filter(a => (a.published ?? '') >= new90Cutoff).length,
        recent: recent.slice(0, OSV_TOP),
      });
    } catch (e) {
      const msg = String(e?.message ?? e);
      packages.push({ ecosystem: pkg.ecosystem, name: pkg.name, status: 'error', total: 0, new90: 0, recent: [], error: msg });
      errors.push({ ecosystem: pkg.ecosystem, name: pkg.name, error: msg });
    }
    await sleep(OSV_DELAY);
  }
  return {
    fetchedAt: now(),
    windowDays: OSV_WINDOW_DAYS,
    packages,
    errors,
    total: packages.reduce((n, p) => n + p.total, 0),
    new90: packages.reduce((n, p) => n + p.new90, 0),
  };
}

export const getOsv = () => cached('osv', OSV_TTL, fetchOsvWatchlist);

export async function apiCyberOsv(u) {
  let c;
  try { c = await getOsv(); } catch (e) { return { status: 502, body: { error: `OSV: ${e.message}` } }; }
  const eco = u.searchParams.get('ecosystem') ?? '';
  const byEco = {};
  for (const p of c.packages) {
    byEco[p.ecosystem] ??= { ecosystem: p.ecosystem, packages: 0, advisories: 0 };
    byEco[p.ecosystem].packages += 1;
    byEco[p.ecosystem].advisories += p.total;
  }
  return {
    status: 200,
    body: {
      fetchedAt: c.fetchedAt,
      windowDays: c.windowDays,
      error: c.error ?? null,
      packageCount: c.packages.length,
      errorCount: c.errors.length,
      total: c.total,
      new90: c.new90,
      byEcosystem: Object.values(byEco).sort((a, b) => b.advisories - a.advisories),
      packages: eco ? c.packages.filter(p => p.ecosystem === eco) : c.packages,
    },
  };
}

// ---- Prioriterat: KEV × NVD ----------------------------------------------------
// Senaste KEV-tillägg + CVSS-poäng ur NVD (först 30-dagarscachet, sedan
// enskilda ?cveId=-slagningar med 24 h-cachet – max 15 extra anrop/refresh).

const PRIO_N = 15;
const KSV_TTL = 86400000;
const ksvInflight = new Map();

export async function nvdScoreForCve(id) {
  const hit = cyber.kevScore.get(id);
  if (hit && Date.now() - hit.at < KSV_TTL) return hit;
  if (!ksvInflight.has(id)) {
    ksvInflight.set(id, (async () => {
      const r = await nvdJson(`${NVD_BASE}?cveId=${encodeURIComponent(id)}`, { timeout: 30000 });
      const t = trimCve((r.vulnerabilities ?? [])[0] ?? {});
      return { id, score: t.score, severity: t.severity, vector: t.vector, at: Date.now() };
    })().finally(() => ksvInflight.delete(id)));
  }
  const res = await ksvInflight.get(id);
  cyber.kevScore.set(id, res);
  return res;
}

export async function apiCyberPrioritized(u) {
  const [kr, nr] = await Promise.allSettled([getKev(), getNvd()]);
  const kev = kr.status === 'fulfilled' ? kr.value : null;
  const nvd = nr.status === 'fulfilled' ? nr.value : null;
  if (!kev) {
    const both = nr.status === 'rejected';
    if (both) return { status: 502, body: { error: 'KEV/NVD: kunde inte hämta' } };
    return { status: 502, body: { error: `KEV: ${kr.reason?.message ?? kr.reason}` } };
  }
  const nvdById = new Map((nvd?.rows ?? []).map(r => [r.id, r]));
  const latest = kev.entries.slice(0, PRIO_N);
  const settled = await Promise.allSettled(latest.map(async e => {
    let score = null;
    let severity = null;
    let vector = '';
    let from = null;
    const cachedRow = nvdById.get(e.id);
    if (cachedRow) {
      score = cachedRow.score;
      severity = cachedRow.severity;
      vector = cachedRow.vector;
      from = 'nvd-cache';
    } else if (/^CVE-\d{4}-\d+$/.test(e.id ?? '')) {
      const s = await nvdScoreForCve(e.id);
      score = s.score;
      severity = s.severity;
      vector = s.vector;
      from = 'nvd-lookup';
    }
    return {
      id: e.id, vendor: e.vendor, product: e.product, added: e.added,
      due: e.due, ransomware: e.ransomware, action: e.action, short: e.short,
      score, severity, vector, from, resolved: score != null,
    };
  }));
  const rows = settled.map((r, i) => (r.status === 'fulfilled'
    ? r.value
    : {
      ...latest[i], score: null, severity: null, vector: '', from: null,
      resolved: false, error: String(r.reason?.message ?? r.reason),
    }));
  return {
    status: 200,
    body: {
      fetchedAt: now(),
      kevFetchedAt: kev.fetchedAt,
      nvdFetchedAt: nvd?.fetchedAt ?? null,
      error: kev.error ?? nvd?.error ?? null,
      count: rows.length,
      resolved: rows.filter(r => r.resolved).length,
      unresolved: rows.filter(r => !r.resolved).length,
      rows,
    },
  };
}

// ---- Översikt ------------------------------------------------------------------

const iso90 = () => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

// Rapporterar cache-tillståndet utan att utlösa nya hämtningar (panelerna och
// kollektorerna sköter själva uppdateringarna).
export async function apiCyberOverview() {
  const nvd = cyber.nvd;
  const kev = cyber.kev;
  const osv = cyber.osv;
  const d7 = (nvd?.rows ?? []).filter(r => new Date(r.published ?? 0).getTime() >= Date.now() - 7 * 86400000);
  return {
    status: 200,
    body: {
      generatedAt: now(),
      nvd: nvd ? {
        fetchedAt: nvd.fetchedAt, error: nvd.error ?? null, dbTotal: nvd.dbTotal ?? null,
        published7d: d7.length,
        critical7d: d7.filter(r => r.severity === 'CRITICAL').length,
        high7d: d7.filter(r => r.severity === 'HIGH').length,
      } : null,
      kev: kev ? {
        fetchedAt: kev.fetchedAt, error: kev.error ?? null, total: kev.total,
        added90: kev.entries.filter(e => (e.added ?? '') >= iso90()).length,
        ransomware: kev.entries.filter(e => e.ransomware).length,
      } : null,
      osv: osv ? {
        fetchedAt: osv.fetchedAt, error: osv.error ?? null, packages: osv.packages.length,
        errorCount: osv.errors.length, total: osv.total, new90: osv.new90,
      } : null,
    },
  };
}
