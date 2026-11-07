// JRC RMIS / EU CRMs – Europeiska kommissionens råvaruportal, offentligt API (M10).
// ÖPPT API, ingen nyckel. Verifierat 2026-11-07:
//   GET https://rmis.jrc.ec.europa.eu/includes/public/api/eucrm/{endpoint}
//     materials (36 kritiska råvaror), overview (sex listor), exploration,
//     processing, recycling, crma (85 ambitionsmål), env.
// Records (se README "M10"):
//   - materialkatalogen som en metrik
//   - overview: topp-5 EU-import/produktion (EU + världen), MCI per nordiskt
//     land, och importberoende på huvudleverantör → HÄNDELSER vid beroende
//     ≥ 50 % (severity high vid ≥ 80 %)
//   - nordisk leverans/export av råvaror till EU (exploration + processing,
//     senaste år per land+material) samt nordiska reservor
//   - per-lands nämnanden i materiallistorna + CRMA-ambitioner som en metrik
//   - env hämtas och sanitykallas men ger inga records (semantik obekräftad)
import { jjson, now } from '../lib/http.js';

const BASE = process.env.RMIS_BASE || 'https://rmis.jrc.ec.europa.eu/includes/public/api/eucrm';

// Engelska landsnamn (RMIS) → kod + svenskt namn.
const COUNTRIES = {
  Sweden: { code: 'SE', name: 'Sverige' },
  Norway: { code: 'NO', name: 'Norge' },
  Denmark: { code: 'DK', name: 'Danmark' },
  Finland: { code: 'FI', name: 'Finland' },
  Iceland: { code: 'IS', name: 'Island' },
};
const NORDIC_CODES = Object.values(COUNTRIES).map(c => c.code);

const num = v => Number(v);

// Senaste året per (land, material) ur en lista på formen
// {material, year, country, value, unit}.
export function latestByCountryMaterial(rows) {
  const best = new Map();
  for (const r of rows ?? []) {
    const c = COUNTRIES[r?.country];
    if (!c || !r.material) continue;
    const key = `${c.code}|${r.material}`;
    const cur = best.get(key);
    if (!cur || num(r.year) > num(cur.year)) best.set(key, { ...r, code: c.code, name: c.name });
  }
  return [...best.values()];
}

export default {
  id: 'rmis',
  name: 'JRC RMIS / EU CRMs (kritiska råvaror)',
  area: 7,
  country: 'NORDIC',
  every: 604800,
  fetch: async () => {
    const [materials, overview, exploration, processing, recycling, crma, env] =
      await Promise.all([
        jjson(`${BASE}/materials`),
        jjson(`${BASE}/overview`),
        jjson(`${BASE}/exploration`),
        jjson(`${BASE}/processing`),
        jjson(`${BASE}/recycling`),
        jjson(`${BASE}/crma`),
        jjson(`${BASE}/env`),
      ]);
    if (!Array.isArray(materials) || !materials.length) throw new Error('RMIS materials: tom lista');
    if (!overview || typeof overview !== 'object') throw new Error('RMIS overview: ogiltigt format');
    if (!env || typeof env !== 'object' || !Array.isArray(env['env-impact']) ||
      !Array.isArray(env['env-vc']) || !Array.isArray(env['env-demand'])) {
      throw new Error('RMIS env: förväntade listor saknas (semantik obekräftad)');
    }

    const records = [];
    const ts = now();

    records.push({
      t: 'm', area: 7, country: 'NORDIC', source: 'rmis',
      indicator: 'Kritiska råvaror i RMIS-katalogen', value: materials.length,
      unit: 'råvaror', ts,
    });

    const pushMetric = (indicator, value, unit = '') => {
      const v = num(value);
      if (!Number.isFinite(v)) return;
      records.push({
        t: 'm', area: 7, country: 'NORDIC', source: 'rmis',
        indicator, value: v, unit, ts,
      });
    };
    for (const item of overview['dsb-eu-mat-imp'] ?? []) {
      pushMetric(`EU:s import av ${item.material} (${item.unit}), ${item.year}`, item.value, item.unit);
    }
    for (const item of overview['dsb-prod-mat-1'] ?? []) {
      pushMetric(`EU:s produktion av ${item.material} (${item.unit}), ${item.year}`, item.value, item.unit);
    }
    for (const item of overview['dsb-prod-mat-2'] ?? []) {
      pushMetric(`Världens produktion av ${item.material} (${item.unit}), ${item.year}`, item.value, item.unit);
    }
    for (const item of overview['dsb-mcp'] ?? []) {
      const c = COUNTRIES[item.country];
      if (!c) continue;
      const v = num(item.mci);
      if (!Number.isFinite(v)) continue;
      records.push({
        t: 'm', area: 7, country: c.code, source: 'rmis',
        indicator: `Materialcirkularitetsindex (MCI) för ${c.name}, förändring ${item.delta ?? '–'}`,
        value: v, unit: 'index', ts,
      });
    }
    // Importberoende → händelser vid ≥ 50 % (high ≥ 80 %).
    for (const [rank, key] of [['1', 'dsb-imp-reliance-1'], ['2', 'dsb-imp-reliance-2']]) {
      for (const item of overview[key] ?? []) {
        const v = num(item.value);
        if (!Number.isFinite(v) || v < 50) continue;
        records.push({
          t: 'e', area: 7, country: 'NORDIC', source: 'rmis',
          kind: 'råvaruberoende', severity: v >= 80 ? 'high' : 'medium',
          title: `${item.material}: EU-importberoende på ${item.country} – ${v} %`,
          detail: `RMIS/EU CRMs (dsb-imp-reliance-${rank}): ${v} % av EU:ns import av ${item.material} kommer från ${item.country}.`,
          start: ts,
        });
      }
    }

    // Nordisk leverans/export till EU (senaste året per land+material).
    const tradeList = (stage, key, doc, verb) => {
      for (const item of latestByCountryMaterial(doc[key])) {
        records.push({
          t: 'm', area: 7, country: item.code, source: 'rmis',
          indicator: `${stage}: ${item.name} ${verb} ${item.material} till EU (${item.unit}), ${item.year}`,
          value: num(item.value), unit: item.unit ?? '', ts: item.year ?? ts,
        });
      }
    };
    tradeList('Utvinning', 'eu-supply-1', exploration, 'levererar');
    tradeList('Utvinning', 'eu-export-1', exploration, 'exporterar');
    tradeList('Bearbetning', 'eu-supply-2', processing, 'levererar');
    tradeList('Bearbetning', 'eu-export-2', processing, 'exporterar');

    // Nordiska reservor.
    for (const item of exploration.reserves ?? []) {
      const c = COUNTRIES[item.country_name];
      if (!c) continue;
      const v = num(item.value);
      if (!Number.isFinite(v)) continue;
      records.push({
        t: 'm', area: 7, country: c.code, source: 'rmis',
        indicator: `Reservor: ${c.name} har ${item.material} (${item.unit}), ${item.year ?? '–'}`,
        value: v, unit: item.unit ?? '', ts: item.year ?? ts,
      });
    }

    // Nämnanden per nordiskt land i materiallistorna (exp+proc+recyc).
    const mentions = Object.fromEntries(NORDIC_CODES.map(c => [c, 0]));
    for (const doc of [exploration, processing, recycling]) {
      for (const key of Object.keys(doc)) {
        for (const item of doc[key] ?? []) {
          const c = COUNTRIES[item?.country];
          if (c) mentions[c.code] += 1;
        }
      }
    }
    for (const code of NORDIC_CODES) {
      records.push({
        t: 'm', area: 7, country: code, source: 'rmis',
        indicator: 'Nämnanden i RMIS-listor (exploration/processing/recycling)',
        value: mentions[code], unit: 'rader', ts,
      });
    }

    // CRMA-ambitioner som en sammanfattad metrik.
    const targets = crma['crma-targets'] ?? [];
    const done = targets.filter(t => (t.status ?? '-').trim() && t.status !== '-').length;
    records.push({
      t: 'm', area: 7, country: 'NORDIC', source: 'rmis',
      indicator: `RMIS CRMA-ambitioner (utvinning/bearbetning/återvinning), uppnådda: ${done}`,
      value: targets.length, unit: 'mål', ts,
    });

    return records;
  },
};
