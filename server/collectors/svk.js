// Svenska kraftnät Data Service – CKAN Action API (DOC_VERIFIED).
// resource_id krävs per dataset (SVK_RESOURCE_ID i .env).
// Ej alla energidata har öppen CKAN-åtkomst – ENTSO-E (M2) ger systembilden.
import { jjson, now } from '../lib/http.js';

export default {
  id: 'svk',
  name: 'Svenska kraftnät',
  area: 1,
  country: 'SE',
  every: 300,
  need: 'SVK_RESOURCE_ID',
  fetch: async () => {
    const r = await jjson('https://data.svk.se/sv/api/action/datastore_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource_id: process.env.SVK_RESOURCE_ID, limit: 1 }),
    });
    return [{
      t: 'm', area: 1, country: 'SE', source: 'svk',
      indicator: 'SVK-dataset, antal poster',
      value: r.result?.total ?? 0, unit: 'st', ts: now(),
    }];
  },
};
