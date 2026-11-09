// NASA APOD via WordPress wp-json (område 10, information enbart).
//   https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=N
//   → [{date, post_id, title, permalink, media_type, explanation}]
// Verifierat 2026-11-09: nyckelfritt. Ingår INTE i GNSS-index – ger bara en
// enkel publiceringstakt för rymdområdet ("rymdbevakning i media").
import { jjson, now } from '../lib/http.js';

const URL = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=15';

export default {
  id: 'nasa-apod',
  name: 'NASA APOD (wp-json)',
  area: 10,
  country: 'NORDIC',
  every: 86400,
  fetch: async () => {
    const ts = now();
    const posts = await jjson(URL);
    if (!Array.isArray(posts) || !posts.length) throw new Error('APOD returnerade ingen lista');
    const dates = posts.map(p => String(p.date ?? '')).sort();
    const newest = dates.at(-1) ?? '';
    const recent = dates.filter(d => Date.now() - Date.parse(d) < 10 * 86400_000).length;
    const ageDays = newest ? Math.max(0, (Date.now() - Date.parse(newest)) / 86400_000) : null;
    return [
      { t: 'm', area: 10, country: 'NORDIC', source: 'nasa-apod', indicator: 'APOD-publiceringar (≤10 dagar)', value: recent, unit: 'st', ts },
      { t: 'm', area: 10, country: 'NORDIC', source: 'nasa-apod', indicator: 'Ålder på senaste APOD', value: ageDays == null ? null : Math.round(ageDays * 10) / 10, unit: 'd', ts },
    ];
  },
};
