// OSV.dev (Open Source Vulnerabilities) – sårbarhetsrapporter mot ett
// kurerat paketutbud som är relevant för kritisk infrastruktur
// (server/lib/cyber.js, DEFAULT_WATCH). Ett POST /v1/query per paket
// (utan version → alla rapporter mot paketet); rapporter publicerade inom
// OSV_WINDOW_DAYS (180 d) räknas in. Överstyrbart via OSV_WATCH_PACKAGES
// ("Ecosystem:Paket;…"). Uppdateras sällan → 6 h-intervall.
import { getOsv, OSV_NEW_DAYS } from '../lib/cyber.js';
import { now } from '../lib/http.js';

export default {
  id: 'osv',
  name: 'OSV.dev',
  area: 5,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const c = await getOsv();
    const ok = (c.packages ?? []).filter(p => p.status === 'ok');
    const top = ok.length ? ok.reduce((m, p) => (p.total > m.total ? p : m)) : null;
    const newest = ok
      .flatMap(p => p.recent.map(a => ({ ...a, pkg: p.name, eco: p.ecosystem })))
      .sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));
    const ts = c.fetchedAt ?? now();
    const recs = [
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'osv',
        indicator: 'OSV – övervakade paket', value: (c.packages ?? []).length, unit: 'paket', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'osv',
        indicator: `OSV – rapporter senaste ${c.windowDays} d (övervakat utbud)`,
        value: c.total, unit: 'st', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'osv',
        indicator: `OSV – rapporter senaste ${OSV_NEW_DAYS} d`, value: c.new90, unit: 'st', ts,
      },
      {
        t: 'm', area: 5, country: 'NORDIC', source: 'osv',
        indicator: 'OSV – mest påverkat paket',
        value: top ? `${top.name} (${top.ecosystem})` : '–', unit: '', ts,
      },
    ];
    if (newest.length) {
      recs.push({
        t: 'e', area: 5, country: 'NORDIC', source: 'osv',
        kind: 'sårbarhet', severity: 'info',
        title: `Nyaste OSV-rapport: ${newest[0].id} (${newest[0].pkg})`,
        detail: newest.slice(0, 5).map(a =>
          `${a.id} – ${a.pkg} [${a.eco}] ${a.published ?? ''}${a.severity ? ` · ${a.severity}` : ''}`).join('\n'),
        start: now(),
      });
    }
    if (c.errors?.length) {
      recs.push({
        t: 'e', area: 5, country: 'NORDIC', source: 'osv',
        kind: 'källa', severity: 'warn',
        title: `${c.errors.length} OSV-paket kunde inte hämtas`,
        detail: c.errors.slice(0, 5).map(e => `${e.ecosystem}/${e.name}: ${e.error}`).join('\n'),
        start: now(),
      });
    }
    return recs;
  },
};
