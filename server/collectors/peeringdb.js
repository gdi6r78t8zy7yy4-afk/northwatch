// PeeringDB – internetutbyten (IX) per nordiskt land: strukturmått för
// digital infrastruktur (område 2). Öppet API, ingen nyckel.
// OBS: URL:en får INTE ha avslutande snedstreck (ger 404).
// SVaret är {data:[...]}; Nordic IX-totalen ligger väl under limit=1000.
import { jjson, now } from '../lib/http.js';

const COUNTRIES = ['SE', 'NO', 'DK', 'FI'];

export default {
  id: 'peeringdb',
  name: 'PeeringDB (IX)',
  area: 2,
  country: 'NORDIC',
  every: 21600,
  fetch: async () => {
    const per = await Promise.all(COUNTRIES.map(async cc => {
      const d = await jjson(`https://www.peeringdb.com/api/ix?country=${cc}&limit=1000`);
      const list = d.data ?? [];
      return {
        cc,
        n: list.length,
        nets: list.reduce((a, r) => a + (Number(r.net_count) || 0), 0),
      };
    }));
    const total = per.reduce((a, p) => a + p.n, 0);
    const records = per.map(p => ({
      t: 'm', area: 2, country: p.cc, source: 'peeringdb',
      indicator: 'Internetutbyten (IX)', value: p.n, unit: 'st', ts: now(),
    }));
    records.push({
      t: 'm', area: 2, country: 'NORDIC', source: 'peeringdb',
      indicator: 'IX totalt (Nordiskt)', value: total, unit: 'st', ts: now(),
    });
    records.push({
      t: 'm', area: 2, country: 'NORDIC', source: 'peeringdb',
      indicator: 'IX-anslutna nätverk (Nordiskt)',
      value: per.reduce((a, p) => a + p.nets, 0), unit: 'st', ts: now(),
    });
    return records;
  },
};
