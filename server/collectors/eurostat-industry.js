// M10: Eurostat SDMX 2.1 – sju industri- och råvarudataflöden.
// ÖPPT API, ingen nyckel. Verifierat 2026-11-07 (contentconstraint +
// data-keyqueries); Eurostats data-API var systembrett nede i timmar samma
// dag, så testdata/industry-datafixtures är CC-formverifierade med
// synthetiska värden (se README "M10"):
//   EI_ISIN_M      Industriproduktionsindex (2021=100), månad, SE/NO/DK/FI/IS
//   EI_ISIR_M      Industriproduktion, 12-månadersförändring (%), månad
//                  (EI_IS_M_VTG distribueras inte – ERR_NOT_FOUND_2;
//                  dessa två flöden hittades via hela dataflowkatalogen)
//   TEIBS070       Lagerförändring tillverkning (%), kvartal, DK/FI/SE
//   GLOE_CRM_PS    Företag som importerar kritiska råvaror, DK/FI/IS (2021–2023)
//   EXT_LT_INTERCC EFTAs utrikeshandel mot EU-27/utanför EU/världen (mio EUR), IS/NO
//   EXT_LT_MAINRAWM EU-27:s import av råvaror per partner (mio EUR)
//   NAMQ_10_A10    Mervärdetillökning tillverkning (MEUR, NACE C), DK/FI/EU-27
// Varje körning hämtar contentconstraint (XML) per flöde → bygger nyckel
// ur de tillåtna värdena → hämtar data (JSON-stat, lastNObservations).
// Felisolering per flöde: misslyckas ALLA flöden throwas; misslyckas
// några får de en "Dataflöde {id}: hämtfel"-metrik och övriga records
// levereras.

import { j, jjson, now } from '../lib/http.js';
import { jsonstatRows } from '../lib/jsonstat.js';

const BASE = process.env.EUROSTAT_INDUSTRY_BASE ||
  'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1';

const NORDIC_GEO = ['SE', 'NO', 'DK', 'FI', 'IS'];

// Etikettext för indikatornamn (partner/land-koder → svenska).
const PARTNER_LABELS = {
  INT_EU27_2020: 'EU-27', EXT_EU27_2020: 'utanför EU-27', WORLD: 'världen',
  EU27_2020: 'EU-27',
  EFTA: 'EFTA', IS: 'Island', NO: 'Norge', CH: 'Schweiz', LI: 'Liechtenstein',
  UK: 'Storbritannien', US: 'USA', CA: 'Kanada', MX: 'Mexiko', BR: 'Brasilien',
  CN_X_HK: 'Kina', HK: 'Hongkong', JP: 'Japan', KR: 'Sydkorea', IN: 'Indien',
  AU: 'Australien', RU: 'Ryssland', CIS: 'SFR', ZA: 'Sydafrika',
  SA: 'Saudiarabien', TR: 'Tyrkiet', OPEC: 'OPEC',
};

// "2026M09" → "2026-09", "2026-Q2" → "2026Q2", "2024" → "2024".
const fmtTime = t => {
  const s = String(t);
  const m = s.match(/^(\d{4})[M-](\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : s.replace(/-/g, '');
};

// SDMX-ML contentconstraint: <c:KeyValue id="dim"><c:Value>…</c:Value>…
// inom CubeRegion; blockordning = nyckelordning (TIME_PERIOD sist och
// ingår aldrig i nyckeln).
export function parseCC(xml) {
  const region = xml.match(/<s:CubeRegion[\s\S]*?<\/s:CubeRegion>/)?.[0] ?? String(xml ?? '');
  const dims = [];
  for (const m of region.matchAll(/<c:KeyValue id="([^"]+)">([\s\S]*?)<\/c:KeyValue>/g)) {
    dims.push({
      id: m[1],
      values: [...m[2].matchAll(/<c:Value>([^<]*)<\/c:Value>/g)].map(v => v[1]),
    });
  }
  if (!dims.length) throw new Error('parseCC: inga KeyValue-block i contentconstraint');
  return dims;
}

// Nyckel = punktseparerade dimensionvärden i CC-ordning. Oselektade
// dimensioner krävs singleton (första tillåtna värdet).
export function buildKey(dims, select = {}) {
  return dims
    .filter(d => d.id !== 'TIME_PERIOD')
    .map(d => {
      const sel = select[d.id];
      if (sel) {
        for (const v of sel) {
          if (!d.values.includes(v)) throw new Error(`buildKey: ${d.id}=${v} är ej tillåtet`);
        }
        return sel.join('+');
      }
      if (d.values.length !== 1) {
        throw new Error(`buildKey: dimension ${d.id} är ej selekterad och har ${d.values.length} tillåtna värden`);
      }
      return d.values[0];
    })
    .join('.');
}

// JSON-stat 2.1 (platt objekt eller array) → rader med tidskod.
function dataRows(doc) {
  const ids = doc.id ?? [];
  const timeKey = (doc.role?.time ?? [])[0] ?? ids.find(k => /time|period/i.test(k));
  if (!timeKey) throw new Error('ingen tidsdimension i dataflödet');
  const rows = [];
  for (const r of jsonstatRows(doc)) {
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    rows.push({ code: r.code, value: v, time: r.code[timeKey], ts: fmtTime(r.code[timeKey]) });
  }
  if (!rows.length) throw new Error('inga värden i datamängden');
  return rows;
}

const FLOWS = [
  {
    flow: 'EI_ISIN_M', lastObs: 2, unit: 'index 2021=100',
    select: { unit: ['I2021'], s_adj: ['SCA'], nace_r2: ['B-D'], indic: ['IS-IP'], geo: NORDIC_GEO },
    indicator: r => `Industriproduktionsindex (2021=100), ${r.ts}`,
  },
  {
    flow: 'EI_ISIR_M', lastObs: 1, unit: 'a/a %',
    select: { indic: ['IS-IP-SCA'], nace_r2: ['B-D'], unit: ['RT12'], geo: NORDIC_GEO },
    indicator: r => `Industriproduktion, 12-månadersförändring, ${r.ts}`,
  },
  {
    flow: 'TEIBS070', lastObs: 2, unit: '%',
    select: { geo: ['DK', 'FI', 'SE'] },
    indicator: r => `Lagerförändring, tillverkning (%), ${r.ts}`,
  },
  {
    flow: 'GLOE_CRM_PS', lastObs: 1, unit: 'företag',
    select: {
      partner: ['INT_EU27_2020', 'EXT_EU27_2020', 'WORLD'], sizeclas: ['TOTAL'],
      product: ['TOT_CRM'], stk_flow: ['IMP'], indic_sbs: ['ENT_NR'], geo: ['DK', 'FI', 'IS'],
    },
    indicator: r => `Företag med CRM-import (${PARTNER_LABELS[r.code.partner] ?? r.code.partner}), ${r.ts}`,
  },
  {
    flow: 'EXT_LT_INTERCC', lastObs: 1, unit: 'mio EUR',
    select: {
      indic_et: ['MIO_EXP_VAL', 'MIO_IMP_VAL', 'MIO_BAL_VAL'], sitc06: ['TOTAL'],
      partner: ['EU27_2020', 'EXT_EU27_2020', 'WORLD'], geo: ['IS', 'NO'],
    },
    indicator: r => {
      const p = PARTNER_LABELS[r.code.partner] ?? r.code.partner;
      if (r.code.indic_et === 'MIO_EXP_VAL') return `Export till ${p} (mio EUR), ${r.ts}`;
      if (r.code.indic_et === 'MIO_IMP_VAL') return `Import från ${p} (mio EUR), ${r.ts}`;
      return `Handelsbalans med ${p} (mio EUR), ${r.ts}`;
    },
  },
  {
    flow: 'EXT_LT_MAINRAWM', lastObs: 1, unit: 'mio EUR',
    select: {
      indic_et: ['MIO_IMP_VAL'], sitc06: ['SITC2_4'], geo: ['EU27_2020'],
      partner: ['EFTA', 'IS', 'NO', 'CH', 'LI', 'UK', 'US', 'CA', 'MX', 'BR',
        'CN_X_HK', 'HK', 'JP', 'KR', 'IN', 'AU', 'RU', 'CIS', 'ZA', 'SA', 'TR', 'OPEC'],
    },
    indicator: r => `EU-27-import av råvaror, ${PARTNER_LABELS[r.code.partner] ?? r.code.partner} (mio EUR), ${r.ts}`,
  },
  {
    flow: 'NAMQ_10_A10', lastObs: 4, unit: 'MEUR',
    select: { unit: ['CP_MEUR'], s_adj: ['SCA'], nace_r2: ['C'], na_item: ['B1G'], geo: ['DK', 'FI', 'EU27_2020'] },
    indicator: r => `Mervärdetillökning, tillverkning (MEUR), ${r.ts}`,
  },
];

export default {
  id: 'eurostat-industry',
  name: 'Eurostat (industri och råvaror)',
  area: 7,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const records = [];
    const failed = [];
    for (const spec of FLOWS) {
      try {
        const ccResp = await j(`${BASE}/contentconstraint/ESTAT/${spec.flow}/latest`);
        const dims = parseCC(await ccResp.text());
        const key = buildKey(dims, spec.select);
        const url = `${BASE}/data/ESTAT/${spec.flow}/${key}?format=JSON` +
          (spec.lastObs ? `&lastNObservations=${spec.lastObs}` : '');
        const doc = await jjson(url, { timeout: 45000 });
        for (const row of dataRows(doc)) {
          records.push({
            t: 'm', area: 7,
            country: NORDIC_GEO.includes(row.code.geo) ? row.code.geo : 'NORDIC',
            source: 'eurostat-industry',
            indicator: spec.indicator(row),
            value: row.value, unit: spec.unit, ts: row.ts,
          });
        }
      } catch (e) {
        failed.push({ flow: spec.flow, message: e.message });
      }
    }
    if (failed.length === FLOWS.length) {
      throw new Error(`Eurostat industri: alla ${FLOWS.length} flöden misslyckades – ${failed[0].message}`);
    }
    for (const { flow } of failed) {
      records.push({
        t: 'm', area: 7, country: 'NORDIC', source: 'eurostat-industry',
        indicator: `Dataflöde ${flow}: hämtfel`, value: null, unit: '', ts: now(),
      });
    }
    return records;
  },
};
