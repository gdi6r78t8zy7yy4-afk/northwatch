// DMI climate data (DK) – timvis observationsdata från
// Köbenhavns Lufthavn (station 06180, WMO). OGC-API-stil:
//   /v2/climateData/collections/stationValue/items
// Verifierat 2026-11-01:
//   parameterId: mean_temp, mean_wind_speed, acc_precip, mean_pressure m.fl.
//   (ingen "temp"/"wind" på timupplösning); sortorder=from,DESC ger senaste först.
// Stationslista: /collections/station/items (bbox/stationId-filter).
// Prognosservicen (vokodan.dmi.dk) löser inte DNS från testnätet –
// M2 levererar observationsdata endast.
import { jjson } from '../lib/http.js';

const BASE = process.env.DMI_BASE ||
  'https://opendataapi.dmi.dk/v2/climateData/collections/stationValue/items';
const STATION = process.env.DMI_STATION_ID || '06180';
const STATION_NAME = 'Köbenhavns Lufthavn';

const PARAMS = [
  ['mean_temp', 'Temperatur', '°C'],
  ['mean_wind_speed', 'Vindhastighet', 'm/s'],
  ['acc_precip', 'Nederbörd (per timme)', 'mm'],
  ['mean_pressure', 'Tryck', 'hPa'],
];

export default {
  id: 'dmi',
  name: 'DMI climate data',
  area: 11,
  country: 'DK',
  every: 1800,
  fetch: async () => {
    const records = [];
    for (const [pid, label, unit] of PARAMS) {
      const d = await jjson(
        `${BASE}?stationId=${STATION}&timeResolution=hour&sortorder=from,DESC&limit=1&parameterId=${pid}`,
      );
      const f = d.features?.[0];
      if (!f) throw new Error(`DMI gav inget ${pid}-värde för station ${STATION}`);
      const p = f.properties;
      records.push({
        t: 'm', area: 11, country: 'DK', source: 'dmi',
        indicator: `${STATION_NAME} ${label.toLowerCase()}`,
        value: p.value, unit, ts: p.from,
      });
    }
    const temp = records[0];
    const wind = records[1];
    if (wind.value >= 17) records.push({
      t: 'e', area: 11, country: 'DK', source: 'dmi',
      kind: 'väder', severity: 'warn',
      title: `Stormvind vid ${STATION_NAME}: ${wind.value} m/s`,
      detail: `Vindhastighet över 17 m/s (stormstyrka) senast ${wind.ts}.`,
      start: wind.ts,
    });
    if (temp.value <= -5) records.push({
      t: 'e', area: 11, country: 'DK', source: 'dmi',
      kind: 'väder', severity: 'info',
      title: `Utmärkt kyla vid ${STATION_NAME}: ${temp.value} °C`,
      detail: `Temperatur under −5 °C senast ${temp.ts}.`,
      start: temp.ts,
    });
    return records;
  },
};
