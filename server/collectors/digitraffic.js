// Digitraffic (Fintraffic) vägtrafikmeddelanden – ÖPNA API, ingen nyckel.
// IDENTIFIERING: Digitraffic-User-headern krävs; gzip krävs (Accept-Encoding).
// OBS 2026-11-01: v1/v2-på vägarna ger 404 i produktion – Digitraffic har
// flyttat sina API (v2 dokumenteras i deras swagger, som inte är öppet
// anropbart). DIGITRAFFIC_MESSAGES_URL sätter rätt väg när den verifieras (M2).
import { j, now } from '../lib/http.js';

const DEFAULT_URL = 'https://tie.digitraffic.fi/api/traffic-message/v1/traffic-messages?inactiveHours=0&includeAreaGeometry=false';

export default {
  id: 'digitraffic',
  name: 'Digitraffic (väg)',
  area: 3,
  country: 'FI',
  every: 120,
  fetch: async () => {
    const url = process.env.DIGITRAFFIC_MESSAGES_URL || DEFAULT_URL;
    const r = await j(url, {
      headers: {
        'Digitraffic-User': `northwatch/0.1 (dev@localhost)`,
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
      },
    });
    const geojson = await r.json();
    const feats = geojson.features ?? [];
    return [
      {
        t: 'm', area: 3, country: 'FI', source: 'digitraffic',
        indicator: 'Aktiva trafikmeddelanden (väg, FI)',
        value: feats.length, unit: 'st', ts: now(),
      },
      ...feats.slice(0, 50).map(f => ({
        t: 'e', area: 3, country: 'FI', source: 'digitraffic',
        kind: 'trafikmeddelande',
        severity: (f.properties.severity ?? 'info').toLowerCase(),
        title: `${f.properties.situationType ?? 'Händelse'}${f.properties.severity ? ' (' + f.properties.severity + ')' : ''}`,
        detail: f.properties.description ?? '',
        start: f.properties.issueTime ?? now(),
        end: f.properties.expectedClearTime ?? null,
        geo: f.geometry ?? null,
      })),
    ];
  },
};
