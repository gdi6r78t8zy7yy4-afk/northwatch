// Tilastetoimisto (StatFin) – industriomsättningens index (tabell 14mt.px).
// ÖPPT API, ingen nyckel. Verifierat 2026-11-02 (pxdata.stat.fi, PxWeb api/v1):
//   GET  /PxWeb/api/v1/en/StatFin/tlv/14mt.px
//     → metadatan: {title, variables:[{code, values[], valueTexts[]}]}
//     (hela tabellen är 1,3 MB → smal fråga istället)
//   POST /PxWeb/api/v1/en/StatFin/tlv/14mt.px
//     body: {query:[{code:"timeperiod_q",selection:{filter:"item",values:[...]}},
//                   {code:"nace_8_20180101",selection:{filter:"item",values:["C"]}}],
//            response:{format:"json"}}
//     → {columns:[{code, text, type:"t"|"d"|"c"}],
//        data:[{key:[tid, bransch, variabel], values:[...]}],
//        metadata:[{updated, label, source}]}
// Frågar de två senaste kvartalen, tillverkningsindustri (NACE C), index
// 2021=100; originalserien + arbetsdag/konjunkturjusterad + trend.
import { j, jjson, now } from '../lib/http.js';

const TABLE = 'https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/tlv/14mt.px';

export default {
  id: 'statfinland',
  name: 'StatFin (industriomsättning)',
  area: 7,
  country: 'FI',
  every: 604800,
  fetch: async () => {
    const meta = await jjson(TABLE);
    const tq = meta.variables?.find(v => v.code === 'timeperiod_q')?.values ?? [];
    const last2 = tq.slice(-2);
    if (!last2.length) throw new Error('StatFin: inga timeperiod_q-koder i metadatan');
    const body = {
      query: [
        { code: 'timeperiod_q', selection: { filter: 'item', values: last2 } },
        { code: 'nace_8_20180101', selection: { filter: 'item', values: ['C'] } },
      ],
      response: { format: 'json' },
    };
    const r = await j(TABLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const vcols = (data.columns ?? []).filter(c => c.type === 'c');
    const origIdx = Math.max(0, vcols.findIndex(c => c.code === 'tlv-alkuperainen'));
    const textOf = c => (data.columns ?? []).find(x => x.code === c)?.text ?? c;
    const records = (data.data ?? []).map(row => ({
      t: 'm', area: 7, country: 'FI', source: 'statfinland',
      indicator: `Industriomsättning (2021=100), ${textOf(row.key?.[2])} (${row.key?.[0]})`,
      value: Number(row.values?.[origIdx]), unit: 'index',
      ts: row.key?.[0] ?? now(),
    })).filter(x => Number.isFinite(x.value));
    if (!records.length) throw new Error('StatFin 14mt levererade inga värden');
    return records;
  },
};
