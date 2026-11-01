// CISA Known Exploited Vulnerabilities – publikt JSON, ingen nyckel.
// Används för prioritering (ej incidentdetektion). Uppdateras sällan –
// lågt pollningsintervall.
import { jjson, now } from '../lib/http.js';

export default {
  id: 'kev',
  name: 'CISA KEV',
  area: 5,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const r = await jjson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json');
    const last = [...r.vulnerabilities].sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))[0];
    return [
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – antal kända exploaterade sårbarheter',
        value: r.count, unit: 'CVE', ts: r.dateReleased ?? now(),
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – senast tillagd',
        value: last ? `${last.cveID} (${last.vendorProject})` : '–', unit: '', ts: last?.dateAdded ?? now(),
      },
    ];
  },
};
