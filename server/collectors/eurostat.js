// Eurostat SDMX 2.1 – BNP (GDP) för de nordiska länderna.
// Öppet API, ingen nyckel. Verifierat 2026-11-01:
//   https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/{DATAFLOW}/{KEY}?format=JSON
//   – SDMX 1.0 är nedlagt, SDMX 3.0 finns inte; format=JSON (JSON-stat) fungerar,
//     JSON_DATA/CSV ger 406. Dataflow-id utan @agency-suffix.
//   NAMA_10_GDP (B1GQ, MEUR) är tillgänglig för SE/NO/DK/FI/IS.
//   Katalogens övriga kandidatdataflöden (NA_IND_10_5A, STS_TR_UBTS,
//   NFS_II_IC, BEA_EG_1) är "not available for dissemination".
const URL = process.env.EUROSTAT_GDP_URL ||
  'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/' +
  'NAMA_10_GDP/A.CP_MEUR.B1GQ.SE+NO+DK+FI+IS?format=JSON';

import { jjson, now } from '../lib/http.js';

// JSON-stat 2.0: {id:[dim,…], dimension:{dim:{category:{index,label}}},
// size:[…], value}. Vid nyckelfrågor kan Eurostat leverera value som platt
// objekt {plattObsIndex: värde} (rad-majordistribution per size) i stället
// för nästlade arrayer – båda formerna hanteras. Hämta senaste tidsindex
// med data per geo.
// category.index är antingen lista i indexordning eller (Eurostat 2.0)
// dict {kod: index} – normalisera alltid till [kod per index].
function catCodes(cat) {
  const idx = cat?.index;
  if (Array.isArray(idx)) return idx;
  if (idx && typeof idx === 'object') {
    const arr = [];
    for (const [code, i] of Object.entries(idx)) arr[Number(i)] = code;
    return arr;
  }
  return Object.keys(cat?.label ?? {});
}

function latestPerGeo(d) {
  const dimIds = d.id ?? [];
  const dim = d.dimension ?? {};
  const geoKey = dimIds.find(k => /geo/i.test(k));
  const timeKey = dimIds.find(k => /time|period/i.test(k));
  if (!geoKey || !timeKey) return [];
  const geoCodes = catCodes(dim[geoKey]?.category);
  const timeCodes = catCodes(dim[timeKey]?.category);
  const size = d.size ?? dimIds.map(() => 1);
  const gi = dimIds.indexOf(geoKey);
  const ti = dimIds.indexOf(timeKey);
  const n = dimIds.length;
  const total = size.reduce((a, b) => a * b, 1);
  const best = new Map(); // geokod → {t, v}
  const setCell = (idx, v) => {
    if (v == null || v === '.' || v === '') return;
    const num = Number(v);
    if (!Number.isFinite(num)) return;
    const code = geoCodes[idx[gi]] ?? String(idx[gi]);
    const cur = best.get(code);
    if (!cur || idx[ti] > cur.t) best.set(code, { t: idx[ti], v: num });
  };
  const walk = (node, idx) => {
    if (idx.length === n) { setCell(idx, node); return; }
    if (Array.isArray(node)) { node.forEach((x, k) => walk(x, [...idx, k])); return; }
    if (node && typeof node === 'object') {
      Object.entries(node).forEach(([k, x]) => walk(x, [...idx, Number(k)]));
      return;
    }
    walk(node, [...idx, 0]); // hopa dimensioner med cardinalitet 1
  };
  const rawVal = d.value ?? {};
  const isFlat = !Array.isArray(rawVal) && typeof rawVal === 'object'
    && Object.keys(rawVal).length > 0
    && Math.max(...Object.keys(rawVal).map(Number)) >= size[0];
  if (isFlat) {
    // Platt obs-index → multi-index via strides (rad-major per size).
    for (const [k, v] of Object.entries(rawVal)) {
      const f = Number(k);
      if (!Number.isFinite(f) || f < 0 || f >= total) continue;
      const idx = size.map((s, i) => {
        let r = f;
        for (let j = i + 1; j < n; j++) r = Math.floor(r / size[j]);
        return r % s;
      });
      setCell(idx, v);
    }
  } else {
    walk(rawVal, []);
  }
  return [...best.entries()].map(([code, { t, v }]) => ({
    country: code,
    year: timeCodes[t] ?? '?',
    value: v,
  }));
}

export default {
  id: 'eurostat',
  name: 'Eurostat (BNP)',
  area: 7,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const d = await jjson(URL, { timeout: 45000 });
    const rows = latestPerGeo(d);
    if (!rows.length) throw new Error('Eurostat: inga värden i datamängden');
    const latestYear = rows.reduce((a, r) => (r.year > a ? r.year : a), rows[0].year);
    const ts = d.updated ?? now();
    const records = rows.map(r => ({
      t: 'm', area: 7, country: r.country, source: 'eurostat',
      indicator: `BNP ${r.year} (GDP)`,
      value: r.value, unit: 'MEUR', ts,
    }));
    records.push({
      t: 'm', area: 7, country: 'NORDIC', source: 'eurostat',
      indicator: `BNP Norden totalt (${latestYear})`,
      value: Math.round(rows.reduce((a, r) => a + r.value, 0)),
      unit: 'MEUR', ts,
    });
    records.push({
      t: 'e', area: 7, country: 'NORDIC', source: 'eurostat',
      kind: 'uppdatering', severity: 'info',
      title: `Eurostat BNP-uppdatering (senaste år ${latestYear})`,
      detail: `Dataset NAMA_10_GDP uppdaterad ${ts} – årlig BNP i MEUR för ${rows.map(r => r.country).join(', ')}.`,
      start: now(),
    });
    return records;
  },
};
