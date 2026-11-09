// CelesTrak GP (General Perturbation) – elementset för navigationssatelliter
// (område 10). Öppna JSON utan nyckel, men CelesTraks användarvillkor ber om
// snäll trafik → sekventiella anrop med paus (CELESTRAK_DELAY_MS, nollas i
// tester) och en retry per grupp. FORMAT=json vald eftersom 5-siffriga
// NORAD-nummer tog slut 2026-07-11 (text-/TLE-format är inte längre unika).
// Verifierat 2026-11-09:
//   gp.php?GROUP=galileo&FORMAT=json → [{OBJECT_NAME, EPOCH ("2026-11-08T…"), …}]
//   grupperna galileo (32), glo-ops (28) och sbas (21) svarar; gps-ops har
//   vid ett tillfälle strulat → retry krävs.
// Records: antal satelliter per konstellation + epokålder (timmar sedan den
// nyaste EPOCH). En varningshändelse per konstellation vars elementset är
// >72 h gammalt (upstream-fel, inte driftfel i sig).
import { jjson, now, sleep } from '../lib/http.js';

const BASE = 'https://celestrak.org/NORAD/elements/gp.php';
export const GROUPS = [
  { group: 'galileo', label: 'Galileo' },
  { group: 'glo-ops', label: 'GLONASS' },
  { group: 'sbas', label: 'SBAS (EGNOS m.fl.)' },
  { group: 'gps-ops', label: 'GPS' },
];

export const gpUrl = g => `${BASE}?GROUP=${g}&FORMAT=json`;

const STALE_H = 72;

// CelesTrak svarar med tid utan tidszon ("2026-11-08T14:32:11.000000") –
// Date.parse tolkar det som lokal tid, så zonga läggs till (epokerna är UTC).
const epochUtc = e => /[zZ]|[+-]\d{2}:?\d{2}$/.test(e) ? e : `${e}Z`;

// Nyaste epoken i en GP-lista → ISO-string.
export const newestEpoch = list => {
  let best = '';
  for (const s of list ?? []) {
    const e = String(s?.EPOCH ?? '');
    if (e > best) best = e;
  }
  return best;
};

async function getGroup(group, delayMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const list = await jjson(gpUrl(group), { timeout: 30000 });
      if (!Array.isArray(list)) throw new Error(`GP ${group}: förväntade en lista`);
      return list;
    } catch (e) {
      if (attempt === 1) throw e;
      await sleep(delayMs ? delayMs * 2 : 0); // paus mellan retries; nollas i tester
    }
  }
  return []; // unreachable
}

export default {
  id: 'celestrak',
  name: 'CelesTrak GP (navigationssatelliter)',
  area: 10,
  country: 'NORDIC',
  every: 3600,
  fetch: async () => {
    const delay = Number(process.env.CELESTRAK_DELAY_MS ?? 1200);
    const ts = now();
    const records = [];
    let okGroups = 0;
    let totalSv = 0;

    for (let i = 0; i < GROUPS.length; i++) {
      if (i > 0 && delay > 0) await sleep(delay);
      const { group, label } = GROUPS[i];
      let list;
      try {
        list = await getGroup(group, delay);
      } catch (e) {
        records.push({
          t: 'm', area: 10, country: 'NORDIC', source: 'celestrak',
          indicator: `Satelliter i elementset (${label})`, value: null, unit: 'st', ts,
        });
        continue;
      }
      okGroups++;
      const n = list.length;
      totalSv += n;
      records.push({
        t: 'm', area: 10, country: 'NORDIC', source: 'celestrak',
        indicator: `Satelliter i elementset (${label})`, value: n, unit: 'st', ts,
      });
      const epoch = newestEpoch(list);
      if (epoch) {
        const ageH = Math.max(0, (Date.now() - Date.parse(epochUtc(epoch))) / 3600_000);
        records.push({
          t: 'm', area: 10, country: 'NORDIC', source: 'celestrak',
          indicator: `Epokålder (${label})`, value: Math.round(ageH * 10) / 10, unit: 'h', ts,
        });
        if (ageH > STALE_H) {
          records.push({
            t: 'e', area: 10, country: 'NORDIC', source: 'celestrak',
            kind: 'datakälla', severity: 'warn',
            title: `GP-element för ${label} uppdaterades inte`,
            detail: `Nyaste epoken är från ${epoch} (${Math.round(ageH)} h sedan). Positioneringsdata kan vara inaktuell.`,
            start: epoch,
          });
        }
      }
    }

    if (!okGroups) throw new Error('CelesTrak GP svarade inte för någon konstellation');
    records.push({
      t: 'm', area: 10, country: 'NORDIC', source: 'celestrak',
      indicator: 'Satelliter i elementset (totalt)', value: totalSv, unit: 'st', ts,
    });
    return records;
  },
};
