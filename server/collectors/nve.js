// NVE (Norges Vassdrag- og energidirektorat) HydAPI – vattenstånd i norska
// vattendrag (område 4). NYCKELKRÄVande: header "X-API-Key" (gratis
// registrering, https://hydapi.nve.no). Verifierat 2026-11-02:
//   Utan nyckel: 401 (auth = X-API-Key enligt swagger).
//   GET /api/v1/Stations?Active=true
//     → aktiva stationer {stationId ("6.10.0"), stationName, ...}
//   GET /api/v1/Observations?StationId=6.10.0,7.10.0&Parameter=vannstand
//     → senaste observation per station när ReferenceTime utelämnas
//     (poster med stationId, value, observationTime, ...).
// Parameter kan vara parameterId (siffra) eller namn (text); standard
// "vannstand" (vattenstånd, m). Stationer: NVE_STATIONS i .env ("6.10.0,...")
// annars de NVE_STATION_LIMIT första aktiva stationerna från API:t.
import { jjson, now } from '../lib/http.js';

const BASE = process.env.NVE_BASE || 'https://hydapi.nve.no/api/v1';
const H = () => ({ 'X-API-Key': process.env.NVE_API_KEY, Accept: 'application/json' });

export default {
  id: 'nve',
  name: 'NVE HydAPI (vattenstånd)',
  area: 4,
  country: 'NO',
  every: 300,
  need: 'NVE_API_KEY',
  fetch: async () => {
    // Stationsval: fast lista i .env, annars ur aktivstations-API:t.
    const fixed = (process.env.NVE_STATIONS || '').split(',').map(s => s.trim()).filter(Boolean);
    let stations;
    if (fixed.length) {
      stations = fixed.map(id => ({ stationId: id, stationName: id }));
    } else {
      const limit = Number(process.env.NVE_STATION_LIMIT || 5);
      const st = await jjson(`${BASE}/Stations?Active=true`, { headers: H() });
      const list = Array.isArray(st) ? st : st.value ?? st.stations ?? [];
      stations = list.slice(0, limit);
    }
    if (!stations.length) throw new Error('NVE: inga stationer att hämta (sätt NVE_STATIONS)');

    const param = process.env.NVE_PARAMETER || 'vannstand';
    const ids = stations.map(s => s.stationId).join(',');
    const obs = await jjson(
      `${BASE}/Observations?StationId=${encodeURIComponent(ids)}&Parameter=${encodeURIComponent(param)}`,
      { headers: H() },
    );
    const rows = Array.isArray(obs) ? obs : obs.observations ?? obs.value ?? [];
    const nameOf = new Map(stations.map(s => [s.stationId, s.stationName ?? s.stationId]));
    const records = rows
      .filter(r => r.value != null && Number.isFinite(Number(r.value)))
      .map(r => ({
        t: 'm', area: 4, country: 'NO', source: 'nve',
        indicator: `NVE ${r.stationId ?? '?'} (${nameOf.get(r.stationId) ?? 'vattendrag'}) – vattenstånd`,
        value: Number(r.value), unit: 'm', ts: r.observationTime ?? now(),
      }));
    if (!records.length) {
      throw new Error('NVE: Observations levererade inga värden (kontrollera NVE_STATIONS/NVE_PARAMETER)');
    }
    return records;
  },
};
