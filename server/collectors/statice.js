// Statistics Iceland (Hagstofan) pxwebapi v1 – varuhandel, UTA06002, mISK (M10).
// ÖPPT API, ingen nyckel. Verifierat 2026-11-07:
//   GET  https://px.hagstofa.is/pxen/api/v1/en/Efnahagur/UTA06002.px
//     → strukturen: {title, variables:[{code, values[], valueTexts[], time?}]}
//       (UTA06002 "Exports, imports and balance of trade 2015-2026": Month +
//        Trade: Exports fob / Imports fob / Imports cif / Balance fob-fob /
//        Balance cif-fob, mISK)
//   POST samma URL med
//     {query:[{code, selection:{filter:"item",values:[...]}}, ...],
//      response:{format:"json"}}
//     → {columns:[{code, type:"t"|"d"|"c"}], data:[{key:[...], values:[str]}]}
//   429 vid anrop tättare än ~8 s → 9 s paus mellan struktur och data
//   (STATICE_DELAY_MS, standard 9000).
// OBS: ingen aktuell industriproduktionstabell (IDN01000 avslutades 2018) →
// Islands produktionstäckning görs via Eurostat (EI_ISIN_M/EI_ISIR_M).
import { j, jjson, now, sleep } from '../lib/http.js';

const BASE = process.env.STATICE_BASE || 'https://px.hagstofa.is/pxen/api/v1/en/';
const TABLE = process.env.STATICE_TRADE_TABLE || 'Efnahagur/UTA06002.px';

// "2026M09" → "2026-09" (övriga kodar släppas som de är).
const fmtTime = t => {
  const s = String(t ?? '');
  const m = s.match(/^(\d{4})[M-](\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : s || now();
};

// Bygger frågan: tre senaste tidsperioder ur strukturen + alla övriga
// variabelvärden (t.ex. alla handelsflöden i UTA06002).
export function tradeQuery(meta, n = 3) {
  const vars = meta.variables ?? [];
  const timeVar = vars.find(v => v.time === true) ??
    vars.find(v => /time|month|period/i.test(v.code ?? ''));
  if (!timeVar) throw new Error('statice: ingen tidsvariabel i strukturen');
  const periods = (timeVar.values ?? []).slice(-n);
  if (!periods.length) throw new Error('statice: tidsvariabeln har inga värden');
  const query = [{ code: timeVar.code, selection: { filter: 'item', values: periods } }];
  for (const v of vars) {
    if (v.code === timeVar.code || !(v.values ?? []).length) continue;
    query.push({ code: v.code, selection: { filter: 'item', values: v.values } });
  }
  return { query, timeVar, periods };
}

export default {
  id: 'statice',
  name: 'Statistics Iceland (handel)',
  area: 7,
  country: 'IS',
  every: 86400,
  fetch: async () => {
    const url = `${BASE}${TABLE}`;
    const meta = await jjson(url);
    const { query, timeVar } = tradeQuery(meta, 3);
    await sleep(Number(process.env.STATICE_DELAY_MS ?? 9000)); // 429-vakt
    const r = await j(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, response: { format: 'json' } }),
    });
    const doc = await r.json();
    const cols = doc.columns ?? [];
    // Värderaden innehåller bara värde- ('c')-kolumnernas värden, i deras
    // ordning – indexet är alltså positionen BLAND c-kolumnerna (0 för en
    // tabell med en värdekolumn), inte bland alla kolumntyper.
    const cCount = cols.filter(c => c.type === 'c').length;
    if (!cCount) throw new Error('statice: inget värdeskolumn i svaret');
    const valIdx = 0;
    const others = (meta.variables ?? []).filter(v => v.code !== timeVar.code);
    const labelOf = (v, key) => {
      const i = (v.values ?? []).indexOf(key);
      return i >= 0 ? v.valueTexts?.[i] ?? key : key;
    };
    const records = (doc.data ?? [])
      .map(row => {
        const parts = others.map((v, i) => labelOf(v, row.key?.[i + 1]));
        const v = Number(row.values?.[valIdx]);
        return {
          t: 'm', area: 7, country: 'IS', source: 'statice',
          indicator: `${parts.join(' – ') || 'Handel'}, ${fmtTime(row.key?.[0])}`,
          value: v, unit: 'mISK', ts: fmtTime(row.key?.[0]),
        };
      })
      .filter(x => Number.isFinite(x.value));
    if (!records.length) throw new Error('statice UTA06002 levererade inga värden');
    return records;
  },
};
