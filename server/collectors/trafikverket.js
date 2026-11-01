// Trafikverket öppna API för trafikinformation (DOC_VERIFIED).
// XML-fråga i request-body, JSON i svaret. API-nyckel i .env (TRAFIKVERKET_KEY),
// konto + licens enligt Trafikverkets dokumentation.
import { j, now } from '../lib/http.js';

export default {
  id: 'trafikverket',
  name: 'Trafikverket',
  area: 3,
  country: 'SE',
  every: 120,
  need: 'TRAFIKVERKET_KEY',
  fetch: async () => {
    const body = `<REQUEST><LOGIN authenticationkey="${process.env.TRAFIKVERKET_KEY}"/>` +
      `<QUERY objecttype="Situation" schemaversion="1.5" limit="500"><FILTER/><INCLUDE>Id</INCLUDE></QUERY></REQUEST>`;
    const r = await j('https://api.trafikinfo.trafikverket.se/v2/data.json', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
    });
    const json = await r.json();
    const situations = json.RESPONSE?.RESULT?.[0]?.Situation;
    const n = Array.isArray(situations) ? situations.length : (situations ? 1 : 0);
    return [
      {
        t: 'm', area: 3, country: 'SE', source: 'trafikverket',
        indicator: 'Aktiva trafikhändelser (väg)',
        value: n, unit: 'st', ts: now(),
      },
      ...(Array.isArray(situations) ? situations.slice(0, 10).map(s => ({
        t: 'e', area: 3, country: 'SE', source: 'trafikverket',
        kind: 'trafikhändelse',
        severity: 'warn',
        title: s.SituationType ?? `Händelse ${s.Id ?? ''}`.trim(),
        detail: s.Description ?? s.Reason ?? '',
        start: s.OccurrenceTime ?? now(),
        end: s.ClearTime ?? null,
        geo: s.LocationGeometry ? {
          type: 'Point',
          coordinates: [Number(s.LocationGeometry.Longitude ?? s.LocationGeometry.x), Number(s.LocationGeometry.Latitude ?? s.LocationGeometry.y)],
        } : null,
      })) : []),
    ];
  },
};
