// SMHI metobs – observationsparametrar (bekräftad endpoint per API-katalogen).
import { jjson, now } from '../lib/http.js';

export default {
  id: 'smhi',
  name: 'SMHI observationsdata',
  area: 11,
  country: 'SE',
  every: 1800,
  fetch: async () => {
    const r = await jjson('https://opendata-download-metobs.smhi.se/api/version/1.0/parameter.json');
    return [{
      t: 'm', area: 11, country: 'SE', source: 'smhi',
      indicator: 'SMHI observationsparametrar (metobs)',
      value: r.resource?.length ?? 0, unit: 'st', ts: now(),
    }];
  },
};
