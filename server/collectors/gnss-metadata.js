// M3G – GNSS Stations API Service (EPOS) (område 10). Nationala GNSS-stations-
// metadata för Sverige/Norge/Danmark/Finland/Island via sitelog-sökningen:
//   https://gnss-metadata.eu/v1/sitelog/gnss-metadata?country=SWE&format=metadata-json
// → GeoJSON med properties {GNSS Station ID, Lat/Lon/Height ("65.67/21.00/75.9"),
// Country/Region, City, Station Status, Satellite Constellation (Current),
// GNSS Network, GNSS Receiver (Current), …}. Verifierat 2026-11-09: nyckelfritt,
// CC BY 4.0 – citera doi:10.24414/ROB-GNSS-M3G (se README).
// OBS: API:t returnerar MAX 20 features per anrop och varken limit/page/offset
// fungerar (bbox validerat 2026-11-09). Därför hämtas varje land i ett fast
// rutnät av bbox-rutor; en ruta som svarar med exakt 20 (mättad) delas en gång
// i fyra kvadranter. Rutor som fortfarande är mättade efter delningen gör att
// landets antal rapporteras som "minst". Island täcks här – althingi.is och
// data.althingi.is svarar 403 resp. unreachable (2026-11-09).
// Varje ruta får ett retry-försök: en övergående 503/timeout hos M3G slog ut
// hela SWE+NOR i den planerade körningen 2026-11-11 (null-metrar i 24 h), medan
// samma rutnät svarade felfritt minuter senare. Ett land som felar efter
// retry rapporteras med null-metric + källstatus-händelse så felet syns.
import { jjson, now, sleep } from '../lib/http.js';

const BASE = 'https://gnss-metadata.eu/v1/sitelog/gnss-metadata';
export const CAP = 20; // API:ets hårdkodade feature-tak per anrop

const bands = (a, b, s) => {
  const out = [];
  for (let v = a; v < b; v += s) out.push([v, Math.min(v + s, b)]);
  return out;
};

// Fast verifierat rutnät per land (2026-11-09). Kostar ~50 anrop/dygn totalt.
export const GRIDS = {
  SWE: bands(55, 69, 7).flatMap(la => bands(4, 28, 6).map(lo => [...la, ...lo])),
  NOR: bands(57, 72, 5).flatMap(la => bands(3, 32, 7.25).map(lo => [...la, ...lo])),
  DNK: bands(54.4, 58, 1.8).flatMap(la => bands(7.8, 12.7, 1.63).map(lo => [...la, ...lo])),
  FIN: bands(59.5, 70.1, 5.3).flatMap(la => bands(20, 31.6, 5.8).map(lo => [...la, ...lo])),
  ISL: [[63, 66.6, -24.7, -13]],
};

export const tileUrl = (cc, [minlat, maxlat, minlon, maxlon]) =>
  `${BASE}?format=metadata-json&country=${cc}&minlat=${minlat}&maxlat=${maxlat}&minlon=${minlon}&maxlon=${maxlon}`;

// northwatch-standard tvåbokstaviga landskoder i recorden (API:t använder tre).
const CC2 = { SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', ISL: 'IS' };

// GeoJSON-feature → {id, lat, lon, city, status, constellation, network}
export const parseStation = f => {
  const p = f?.properties ?? {};
  const id = p['GNSS Station ID'] ?? null;
  if (!id) return null;
  const llh = String(p['Lat/Lon/Height'] ?? '').split('/').map(Number);
  return {
    id,
    lat: Number.isFinite(llh[0]) ? llh[0] : null,
    lon: Number.isFinite(llh[1]) ? llh[1] : null,
    city: p.City || null,
    status: p['Station Status'] ?? null,
    constellation: p['Satellite Constellation (Current)'] ?? null,
    network: p['GNSS Network'] ?? null,
  };
};

// Hämta ett lands stationer via rutnätet; dela mättade rutor en gång.
async function fetchCountry(cc, tiles, delayMs) {
  const byId = new Map();
  let capped = false;
  const run = async tile => {
    // Ett retry per ruta – se huvudkommentaren om 2026-11-11-inciden.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await jjson(tileUrl(cc, tile), { timeout: 30000 });
        return (d?.features ?? []).map(parseStation).filter(Boolean);
      } catch (e) {
        if (attempt === 1) throw e;
        await sleep(delayMs ? delayMs * 2 : 0); // paus mellan retries; nollas i tester
      }
    }
    return []; // unreachable
  };
  for (const tile of tiles) {
    if (delayMs > 0) await sleep(delayMs);
    let list = await run(tile);
    if (list.length === CAP) {
      const [a, b, p, q] = tile;
      const midL = (a + b) / 2; const midO = (p + q) / 2;
      const quads = [[a, midL, p, midO], [midL, b, p, midO], [a, midL, midO, q], [midL, b, midO, q]];
      let saturated = false;
      for (const quad of quads) {
        if (delayMs > 0) await sleep(delayMs);
        const sub = await run(quad);
        if (sub.length === CAP) saturated = true;
        list = list.concat(sub);
      }
      if (saturated) capped = true;
    }
    for (const s of list) byId.set(s.id, s);
  }
  return { stations: [...byId.values()], capped };
}

export default {
  id: 'gnss-metadata',
  name: 'M3G GNSS Stations API (EPOS)',
  area: 10,
  country: 'NORDIC',
  every: 86400,
  fetch: async () => {
    const delay = Number(process.env.M3G_DELAY_MS ?? 250);
    const ts = now();
    const records = [];
    let okCountries = 0;

    for (const [cc3, tiles] of Object.entries(GRIDS)) {
      const cc = CC2[cc3]; // posterna får nordwatch-kod (SE…), API-anropen trebokstavig
      let res;
      try {
        res = await fetchCountry(cc3, tiles, delay);
      } catch (e) {
        records.push({ t: 'm', area: 10, country: cc, source: 'gnss-metadata', indicator: 'GNSS-stationer (M3G)', value: null, unit: 'st', ts });
        records.push({
          t: 'e', area: 10, country: cc, source: 'gnss-metadata',
          kind: 'datakälla', severity: 'warn',
          title: `M3G gav inga GNSS-stationer för ${cc}`,
          detail: `Rutnätet för ${cc3} svarade inte ens efter retry – felet var: ${String(e?.message ?? e)}. Landet visas utan stationer tills nästa lyckade poll (var 24:e timme).`,
          start: ts,
        });
        continue;
      }
      okCountries++;
      const { stations, capped } = res;
      const active = stations.filter(s => /^active$/i.test(String(s.status ?? '')));
      const multi = stations.filter(s => String(s.constellation ?? '').includes('+'));
      records.push({
        t: 'm', area: 10, country: cc, source: 'gnss-metadata',
        indicator: `GNSS-stationer (M3G)${capped ? ' (minst)' : ''}`, value: stations.length, unit: 'st', ts,
      });
      if (stations.length) {
        records.push({
          t: 'm', area: 10, country: cc, source: 'gnss-metadata',
          indicator: 'Aktiva GNSS-stationer (andel)', value: Math.round(active.length / stations.length * 1000) / 10, unit: '%', ts,
        });
        records.push({
          t: 'm', area: 10, country: cc, source: 'gnss-metadata',
          indicator: 'Flerkonstellationsstationer (andel)', value: Math.round(multi.length / stations.length * 1000) / 10, unit: '%', ts,
        });
      }
      for (const s of stations) {
        if (s.lat == null || s.lon == null) continue;
        records.push({
          t: 'a', area: 10, country: cc, source: 'gnss-metadata',
          type: 'gnss-station', name: s.id,
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          attrs: { stad: s.city, status: s.status, konstellationer: s.constellation, nätverk: s.network },
          updated: ts,
        });
      }
    }

    if (!okCountries) throw new Error('M3G svarade inte för något land');
    return records;
  },
};
