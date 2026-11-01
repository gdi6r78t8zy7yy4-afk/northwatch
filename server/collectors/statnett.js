// Statnett driftsdata – aktuella fysiska flöden (MW) mellan elspotzoner
// (SE–NO, NO–DK, NO–FI m.fl.). Öppet API, ingen nyckel.
// Verifierad 2026-11-01:
//   /restapi/PhysicalFlowMap/GetFlow
//     → [{OutAreaElspotId, InAreaElspotId, Value (MW, teckenriktat), MeasureDate (ms)}]
// Övriga tillgängliga endpoints: /restapi/ProductionConsumption/GetLatestDetailedOverview,
// /restapi/Frequency/ByMinute?From=YYYY-MM-DD.
import { jjson, now } from '../lib/http.js';

const FLOW_URL = process.env.STATNETT_FLOW_URL ||
  'https://driftsdata.statnett.no/restapi/PhysicalFlowMap/GetFlow';

export default {
  id: 'statnett',
  name: 'Statnett driftsdata',
  area: 1,
  country: 'NO',
  every: 300,
  fetch: async () => {
    const rows = await jjson(FLOW_URL);
    const list = Array.isArray(rows) ? rows : rows?.flows ?? [];
    if (!list.length) throw new Error('GetFlow returnerade ingen flödesrad');
    return list.map(r => ({
      t: 'm', area: 1, country: 'NO', source: 'statnett',
      indicator: `Nettoflöde ${r.OutAreaElspotId}→${r.InAreaElspotId}`,
      value: Number(r.Value), unit: 'MW',
      ts: r.MeasureDate ? new Date(r.MeasureDate).toISOString() : now(),
    }));
  },
};
