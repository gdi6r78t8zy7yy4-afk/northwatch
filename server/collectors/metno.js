// MET Norway Weather API – DOC_VERIFIED i API-katalogen.
// Kräver unik identifierande User-Agent med kontaktuppgift (CONTACT i .env);
// annars 403 IllegalUserAgent. Hantera 429 med backoff (kommer i M2).
import { jjson, now } from '../lib/http.js';

const LAT = process.env.METNO_LAT || '59.91';
const LON = process.env.METNO_LON || '10.75';
const CITY = process.env.METNO_CITY || 'Oslo';

export default {
  id: 'metno',
  name: 'MET Norway',
  area: 11,
  country: 'NO',
  every: 1800,
  fetch: async () => {
    const r = await jjson(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`);
    const d = r.properties.timeseries[0];
    const i = d.data.instant.details;
    return [
      {
        t: 'm', area: 11, country: 'NO', source: 'metno',
        indicator: `${CITY} temperatur`, value: i.air_temperature, unit: '°C', ts: d.time,
      },
      {
        t: 'm', area: 11, country: 'NO', source: 'metno',
        indicator: `${CITY} vind`, value: i.wind_speed, unit: 'm/s', ts: d.time,
      },
    ];
  },
};
