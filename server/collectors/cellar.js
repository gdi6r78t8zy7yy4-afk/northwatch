// EU: EUR-Lex/Cellar – unionsrättsliga texter via publikt SPARQL-slutpunkt
// (M11, område 12). POST https://publications.europa.eu/webapi/rdf/sparql
// (body: query=..., accept: application/sparql-results+json). Virtuoso saknar
// glob-operator → FILTER REGEX. CELEX-koder 32YYYY = EU-rättsliga handlingar
// från år YYYY: 32YYYYL direktiv, 32YYYYR förordningar, 32YYYYD beslut.
// Räkna löpande året (YTD) totalt + per typ. EU:s upphovsrätt – fri
// återanvändning med källtillkännagivande. Månadshämtning.
import { now, sleep } from '../lib/http.js';

const SPARQL = 'https://publications.europa.eu/webapi/rdf/sparql';
const CDM = 'http://publications.europa.eu/ontology/cdm#';

// CELEX-räkning med REGEX-prefix på resource_legal_id_celex.
const celexCount = async prefix => {
  const q = `PREFIX cdm: <${CDM}>
SELECT (COUNT(?r) AS ?count) WHERE {
  ?r cdm:resource_legal_id_celex ?celex .
  FILTER REGEX(?celex, "^${prefix}")
}`;
  const r = await fetch(SPARQL, {
    method: 'POST',
    headers: {
      accept: 'application/sparql-results+json',
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': 'northwatch/0.1 (cellar-celex-rakning; omrade 12)', // ASCII (header)
    },
    body: `query=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} publications.europa.eu`);
  const doc = await r.json();
  const b = doc?.results?.bindings?.[0]?.count;
  return Number(b?.value) || 0;
};

export default {
  id: 'cellar',
  name: 'EUR-Lex/Cellar (EU-rättsliga texter)',
  area: 12,
  country: 'NORDIC',
  every: 2592000, // 30 dagar
  fetch: async () => {
    const delay = Number(process.env.CELLAR_DELAY_MS ?? 1500);
    const ts = now();
    const year = String(new Date().getFullYear());
    const rec = (indicator, value) => ({
      t: 'm', area: 12, country: 'NORDIC', source: 'cellar',
      indicator, value, unit: 'st', ts,
    });
    const records = [];
    const failed = [];

    const jobs = [
      { prefix: `3${year}`, label: `EU-rättsliga texter ${year} (CELEX, YTD)` },
      { prefix: `3${year}L`, label: `EU-direktiv ${year}` },
      { prefix: `3${year}R`, label: `EU-förordningar ${year}` },
      { prefix: `3${year}D`, label: `EU-beslut ${year}` },
    ];
    for (let i = 0; i < jobs.length; i += 1) {
      if (i > 0 && delay > 0) await sleep(delay);
      try {
        const n = await celexCount(jobs[i].prefix);
        records.push(rec(jobs[i].label, n));
      } catch (e) {
        failed.push({ job: jobs[i].label, message: e.message });
        records.push(rec(`${jobs[i].label}: hämtfel`, null, ''));
      }
    }
    if (failed.length === jobs.length) {
      throw new Error(`Cellar SPARQL: alla 4 räkningar misslyckades – ${failed[0].message}`);
    }
    return records;
  },
};
