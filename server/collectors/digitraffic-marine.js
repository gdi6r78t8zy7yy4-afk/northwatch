// Digitraffic (Meri) – AIS-fartygspositioner nära FI:s stora hamnar.
// ÖPPT API, ingen nyckel. IDENTIFIERING: Digitraffic-User-headern krävs
// (samma ToS som väg/järnväg). Verifierat 2026-11-02:
//   GET https://meri.digitraffic.fi/api/ais/v1/locations?latitude=&longitude=&radius=
//     → GeoJSON FeatureCollection {dataUpdatedTime, features:[{mmsi,
//        geometry: {type:"Point", coordinates:[lon,lat]},
//        properties: {mmsi, sog (kn), cog (°), navStat, heading, ...}}]}
//     Radius i KM (Helsingfors r=40 → ~70 fartyg). /vessels-endpointen bär
//     fartygsnamn men är 280 KB metadata → ej hämtad per cykel.
// Sex cirklar kring huvudhamnarna, deduperade på MMSI. ToS max 1 anrop/s →
// anropen iaktskänbar; pollar var 5:e minut (6 anrop/cykel).
// Kartposter (t:'a', type 'fartyg'): bara fartyg i rörelse (sog > 0.5 kn) –
// legolägen i hamn skulle annars dominera lagret.
import { jjson, now, sleep, safeContact } from '../lib/http.js';

const CIRCLES = [
  { name: 'Helsingfors', lat: 60.17, lon: 24.95 },
  { name: 'Turku', lat: 60.45, lon: 22.25 },
  { name: 'Uleåborg', lat: 65.0, lon: 25.3 },
  { name: 'Vasa', lat: 63.1, lon: 21.65 },
  { name: 'Pori', lat: 61.5, lon: 21.8 },
  { name: 'Mariehamn', lat: 60.1, lon: 19.95 },
];
const RADIUS_KM = 40;

const H = () => ({
  'Digitraffic-User': process.env.CONTACT
    ? `northwatch/0.1 (${safeContact(process.env.CONTACT)})`
    : 'northwatch/0.1 (contact: unset)',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip',
});

export default {
  id: 'digitraffic-marine',
  name: 'Digitraffic (AIS sjöfart)',
  area: 3,
  country: 'FI',
  every: 300,
  fetch: async () => {
    const seen = new Map(); // mmsi → position (första träffen vinn)
    let updated = now();
    for (let i = 0; i < CIRCLES.length; i++) {
      if (i > 0) await sleep(1100); // ToS: max 1 anrop/s
      const c = CIRCLES[i];
      const r = await jjson(
        `https://meri.digitraffic.fi/api/ais/v1/locations?latitude=${c.lat}&longitude=${c.lon}&radius=${RADIUS_KM}`,
        { headers: H() },
      );
      if (r.dataUpdatedTime) updated = r.dataUpdatedTime;
      for (const f of r.features ?? []) {
        const mmsi = f.mmsi ?? f.properties?.mmsi;
        if (mmsi == null || seen.has(mmsi)) continue;
        const [lon, lat] = f.geometry?.coordinates ?? [];
        if (typeof lon !== 'number' || typeof lat !== 'number') continue;
        seen.set(mmsi, { mmsi, lon, lat, p: f.properties ?? {}, circle: c.name });
      }
    }
    const all = [...seen.values()];
    const moving = all.filter(x => (x.p.sog ?? 0) > 0.5);
    return [
      {
        t: 'm', area: 3, country: 'FI', source: 'digitraffic-marine',
        indicator: 'AIS-fartyg nära FI:s huvudhamnar (antal unika, r 40 km)',
        value: all.length, unit: 'st', ts: updated,
      },
      {
        t: 'm', area: 3, country: 'FI', source: 'digitraffic-marine',
        indicator: '… varav i rörelse (sog > 0,5 kn)',
        value: moving.length, unit: 'st', ts: updated,
      },
      ...moving.map(x => ({
        t: 'a', area: 3, country: 'FI', source: 'digitraffic-marine',
        type: 'fartyg',
        name: `Fartyg MMSI ${x.mmsi}`,
        geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
        attrs: {
          mmsi: x.mmsi,
          hastighet_kn: Math.round((x.p.sog ?? 0) * 10) / 10,
          kurss: x.p.cog ?? null,
          navstat: x.p.navStat ?? null,
          hamnområde: x.circle,
        },
        updated,
      })),
    ];
  },
};
