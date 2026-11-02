// Sveriges Riksbank – öppna API-yta (klass B-raden SE/9).
// BEGRÄNSNING (verifierad 2026-11-02, 17 testanrop): datagatewayn på
// api.riksbank.se svarar 404 ("Resource not found") på alla försökta
// operationer (swestr/v1/..., holdings/... m.fl.) – operationerna är inte
// publikt upptäckbara utan prenumerationsnyckel från portalen. Portalkatalogens
// endpoint är däremot öppen och fungerar:
//   GET https://developer.api.riksbank.se/developer/apis?api-version=2022-04-01-preview
//     → {value: [5 API:er, alla subscriptionRequired:false]}
//       SWESTR (referänsränta, interestRateId=SWESTR, 5 anrop/min), SWEA,
//       holdings, monetary policy data, turnover statistics.
// Kollektorn följer alltså den öppna ytan (API-katalogen). När Riksbanken
// exponerar gateway-operationerna kan kollektorn utökas att läsa SWESTR-satser.
import { jjson, now } from '../lib/http.js';

const CATALOG = 'https://developer.api.riksbank.se/developer/apis?api-version=2022-04-01-preview';

export default {
  id: 'riksbank',
  name: 'Riksbank (API-katalog)',
  area: 9,
  country: 'SE',
  every: 86400,
  fetch: async () => {
    const r = await jjson(CATALOG);
    const apis = r.value ?? [];
    if (!apis.length) throw new Error('Riksbankens API-katalog svarade utan API:er');
    return [
      {
        t: 'm', area: 9, country: 'SE', source: 'riksbank',
        indicator: 'Öppna Riksbanken-API:er (antal, gratis)',
        value: apis.length, unit: 'st', ts: now(),
      },
      ...apis.map(a => ({
        t: 'm', area: 9, country: 'SE', source: 'riksbank',
        indicator: `Riksbank API: ${a.name} (path ${a.path})`,
        value: a.subscriptionRequired ? 1 : 0,
        unit: 'kräver prenumeration (0/1)',
        ts: now(),
      })),
    ];
  },
};
