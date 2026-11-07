// NIST NVD CVE API 2.0 – senaste 30 dagarnas publicerade CVE via det delade
// cyberdatslagret (server/lib/cyber.js). Samma cache driver widgeten
// /api/cyber/nvd på cybersäkerhetsdashboarden (M9). Valfri API-key
// (NVD_API_KEY i .env) höjer rate-limiten.
import { getNvd } from '../lib/cyber.js';
import { now } from '../lib/http.js';

const inDays = (days, r) => new Date(r.published ?? 0).getTime() >= Date.now() - days * 86400000;

export default {
  id: 'nvd',
  name: 'NIST NVD',
  area: 5,
  country: 'NORDIC',
  every: 3600,
  fetch: async () => {
    const c = await getNvd();
    const rows = c.rows ?? [];
    const d7 = rows.filter(r => inDays(7, r));
    const crit = d7.filter(r => r.severity === 'CRITICAL');
    const high = d7.filter(r => r.severity === 'HIGH');
    const scored = rows.filter(r => r.score != null);
    const avg = scored.length
      ? Math.round((scored.reduce((s, r) => s + r.score, 0) / scored.length) * 10) / 10
      : '–';
    const ts = c.fetchedAt ?? now();
    const recs = [
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'nvd',
        indicator: 'NVD – totalt antal CVE', value: c.dbTotal ?? rows.length, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'nvd',
        indicator: 'NVD – nya CVE senaste 7 dagarna', value: d7.length, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'nvd',
        indicator: 'NVD – kritiska (CVSS ≥ 9) senaste 7 dagarna', value: crit.length, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'nvd',
        indicator: 'NVD – hög allvarlighet (CVSS 7–8.9) senaste 7 dagarna', value: high.length, unit: 'CVE', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'nvd',
        indicator: 'NVD – medelvärde CVSS senaste 30 dagarna', value: avg, unit: '0–10', ts,
      },
    ];
    if (crit.length) {
      recs.push({
        t: 'e', area: 5, country: 'NORDIC', source: 'nvd',
        kind: 'sårbarhet', severity: crit.length > 10 ? 'high' : 'info',
        title: `${crit.length} kritiska CVE publicerade senaste 7 dagarna`,
        detail: crit.slice(0, 5).map(r => `${r.id} (CVSS ${r.score}) – ${r.desc}`).join('\n'),
        start: now(),
      });
    }
    return recs;
  },
};
