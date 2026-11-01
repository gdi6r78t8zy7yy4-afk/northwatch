// SMHI vädervarningar (impact-based weather warnings, ibww).
// OBS: datatjänstens endpoint var 503 vid verifiering 2026-11-01 –
// källhälsan visar fel tills rätt data-väg är bekräftad (M2).
// Övergrumbar med SMHI_WARNINGS_URL när en fungerande endpoint hittats.
import { jjson, now } from '../lib/http.js';

const DEFAULT_URLS = [
  'https://opendata-download-warnings.smhi.se/ibww/api/version/1/warnings/all.json',
];

export default {
  id: 'smhi-warnings',
  name: 'SMHI vädervarningar',
  area: 11,
  country: 'SE',
  every: 600,
  fetch: async () => {
    const urls = process.env.SMHI_WARNINGS_URL
      ? [process.env.SMHI_WARNINGS_URL]
      : DEFAULT_URLS;
    let lastErr;
    for (const url of urls) {
      try {
        const r = await jjson(url);
        const list = Array.isArray(r) ? r : (r.warnings ?? r.events ?? []);
        return list.map(w => ({
          t: 'e', area: 11, country: 'SE', source: 'smhi-warnings',
          kind: 'vädervarning',
          severity: (w.level ?? w.severity ?? 'gul').toLowerCase(),
          title: `${w.event ?? w.type ?? 'Vädervarning'}${w.region ? ' – ' + w.region : ''}`,
          detail: w.description ?? '',
          start: w.updatedAt ?? w.startDate ?? now(),
          end: w.endDate ?? null,
          geo: w.geometry ?? null,
        }));
      } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error('okänt svarsschema');
  },
};
