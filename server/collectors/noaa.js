// NOAA SWPC (rymdväder) – globalt Kp-index + F10.7 solradioflux.
// Öppna JSON-endpoints, ingen nyckel. Global källa som täcker hela Norden.
// Verifierat 2026-11-01:
//   planetary_k_index_1m.json → [{time_tag, kp_index (0–9), estimated_kp, kp ("2P")}]
//   f107_cm_flux.json         → [{time_tag, flux (sfu), reporting_schedule, …}]
import { jjson } from '../lib/http.js';

const K_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
const F_URL = 'https://services.swpc.noaa.gov/json/f107_cm_flux.json';

const latestBy = (list, f) => list.reduce((a, b) => (String(b[f]) > String(a[f]) ? b : a), list[0]);

export default {
  id: 'noaa',
  name: 'NOAA SWPC',
  area: 10,
  country: 'NORDIC',
  every: 1800,
  fetch: async () => {
    const [kp, f107] = await Promise.all([jjson(K_URL), jjson(F_URL)]);
    if (!kp?.length || !f107?.length) throw new Error('NOAA returnerade tomma listor');
    const k = latestBy(kp, 'time_tag');
    const f = latestBy(f107, 'time_tag');
    const kpIdx = Number(k.kp_index ?? 0);
    const records = [
      {
        t: 'm', area: 10, country: 'NORDIC', source: 'noaa',
        indicator: 'Kp-index (globalt geomagnetiskt)',
        value: kpIdx, unit: '0–9', ts: k.time_tag,
      },
      {
        t: 'm', area: 10, country: 'NORDIC', source: 'noaa',
        indicator: 'Estimerat Kp (aktuella 3h-intervallet)',
        value: k.estimated_kp ?? null, unit: '0–9', ts: k.time_tag,
      },
      {
        t: 'm', area: 10, country: 'NORDIC', source: 'noaa',
        indicator: 'Solradioflux F10.7',
        value: f.flux ?? null, unit: 'sfu', ts: f.time_tag,
      },
    ];
    if (kpIdx >= 5) records.push({
      t: 'e', area: 10, country: 'NORDIC', source: 'noaa',
      kind: 'geomagnetiskt',
      severity: kpIdx >= 7 ? 'alert' : 'warn',
      title: `Geomagnetisk storm – Kp ${kpIdx}`,
      detail: `Kp ${kpIdx} (${k.kp}) sedan ${k.time_tag}. Kan påverka GNSS/radiokommunikation och inducera ström i högspänningsnät (GIC).`,
      start: k.time_tag,
    });
    return records;
  },
};
