// CISA Known Exploited Vulnerabilities – publikt JSON, ingen nyckel.
// Den fullständiga katalogen (~1 800 posteringar, bakåten hos katalogsidan
// cisa.gov/known-exploited-vulnerabilities-catalog) hämtas via det delade
// cyberdatslagret (server/lib/cyber.js); widgeten /api/cyber/kev visar
// hela listan (M9). Används för prioritering (ej incidentdetektion).
import { getKev } from '../lib/cyber.js';
import { now } from '../lib/http.js';

const iso = t => new Date(t).toISOString().slice(0, 10);

export default {
  id: 'kev',
  name: 'CISA KEV',
  area: 5,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const c = await getKev();
    const entries = c.entries ?? [];
    const last = entries[0] ?? null;
    const d90 = iso(Date.now() - 90 * 86400000);
    const dueMax = iso(Date.now() + 14 * 86400000);
    const today = iso(Date.now());
    const added90 = entries.filter(e => (e.added ?? '') >= d90).length;
    const ransom = entries.filter(e => e.ransomware).length;
    const dueSoon = entries.filter(e => e.due && e.due >= today && e.due <= dueMax).length;
    const ts = c.fetchedAt ?? now();
    const recs = [
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – antal kända exploaterade sårbarheter',
        value: c.total, unit: 'CVE', ts: c.dateReleased ?? ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – tillagda senaste 90 dagarna', value: added90, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – kända ransomware-kampanjer', value: ransom, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – åtgärdsfrist inom 14 dagar', value: dueSoon, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'kev',
        indicator: 'KEV – senast tillagd',
        value: last ? `${last.id} (${last.vendor})` : '–', unit: '',
        ts: last?.added ?? ts,
      },
    ];
    if (last) {
      recs.push({
        t: 'e', area: 5, country: 'NORDIC', source: 'kev',
        kind: 'sårbarhet', severity: dueSoon > 0 ? 'high' : 'info',
        title: `Senaste KEV-tillägg: ${last.id} (${last.vendor} ${last.product})`,
        detail: [
          last.action,
          last.ransomware ? 'Känd användning i ransomware-kampanj' : null,
          last.due ? `Åtgärdsfrist: ${last.due}` : null,
        ].filter(Boolean).join('\n'),
        start: now(),
      });
    }
    return recs;
  },
};
