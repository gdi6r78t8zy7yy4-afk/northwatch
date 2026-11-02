// Statistics Norway (SSB) pxwebapi v2 – utrikeshandel i varor, nyckeltal.
// ÖPPT API, ingen nyckel. Verifierat 2026-11-02:
//   GET https://data.ssb.no/api/pxwebapi/v2/tables/{id}/data?lang=en
//     → json-stat 2.0 med TOPPNYCKELN "value" (singular; SCB v2 är samma).
//   Tabell 08864 "External trade in goods, main figures (NOK million),
//   by trade flow and month" – senaste månaden (2026-11-02: 2026M09),
//   8 handelsflöden × 2 uppbrytningar (säsongsjusterad/nej).
import { jjson } from '../lib/http.js';
import { jsonstatLatest } from '../lib/jsonstat.js';

const TABLE = process.env.SSB_TRADE_TABLE || '08864';

export default {
  id: 'ssb',
  name: 'SSB (handelstatistik)',
  area: 7,
  country: 'NO',
  every: 86400,
  fetch: async () => {
    const j = await jjson(`https://data.ssb.no/api/pxwebapi/v2/tables/${TABLE}/data?lang=en`);
    const recs = jsonstatLatest(j, {
      source: 'ssb', area: 7, country: 'NO', unit: 'mNOK',
      indicator: (r, last) => {
        const parts = [r.label.HovedVareStrommer, r.label.ContentsCode].filter(Boolean);
        return parts.length ? `${parts.join(' – ')} (${last})` : null;
      },
    });
    if (!recs.length) throw new Error(`SSB tabell ${TABLE} levererade inga värden`);
    return recs;
  },
};
