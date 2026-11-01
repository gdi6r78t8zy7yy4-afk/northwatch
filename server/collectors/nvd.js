// NIST NVD CVE API 2.0 – valfri API-key (högre rate-limit).
import { jjson, now } from '../lib/http.js';

export default {
  id: 'nvd',
  name: 'NIST NVD',
  area: 5,
  country: 'NORDIC',
  every: 3600,
  fetch: async () => {
    const r = await jjson('https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1', {
      headers: process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {},
    });
    return [{
      t: 'm', area: 5, country: 'NORDIC', source: 'nvd',
      indicator: 'NVD – totalt antal CVE',
      value: r.totalResults, unit: 'CVE', ts: now(),
    }];
  },
};
