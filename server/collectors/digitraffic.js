// Digitraffic (Fintraffic) vägtrafikmeddelanden – ÖPNA API, ingen nyckel.
// IDENTIFIERING: Digitraffic-User-headern krävs; gzip krävs (Accept-Encoding).
// Verifierad 2026-11-01: v1/messages är den fungerande endpointen –
// GeoJSON FeatureCollection (~400–450 features, ~871 KB) med properties:
//   situationId, situationType, trafficAnnouncementType, releaseTime,
//   versionTime, announcements[] {language, title, location, locationDetails};
//   toppfält dataUpdatedTime. v2-endpointen (DATEX-II) finns i dokumentationen
//   men levererar i nuläget tomma payload.
// 871 KB per anrop + ToS (max 1 anrop/s) → pollar var 5:e minut.
import { j, now, safeContact } from '../lib/http.js';

const DEFAULT_URL = 'https://tie.digitraffic.fi/api/traffic-message/v1/messages?inactiveHours=0&includeAreaGeometry=false';

// Föredrar svensk meddelandetext, annars första tillgängliga.
const ann = f => {
  const list = f.properties?.announcements ?? [];
  return list.find(a => a.language === 'sv') ?? list[0] ?? null;
};

export default {
  id: 'digitraffic',
  name: 'Digitraffic (väg)',
  area: 3,
  country: 'FI',
  every: 300,
  fetch: async () => {
    const url = process.env.DIGITRAFFIC_MESSAGES_URL || DEFAULT_URL;
    const r = await j(url, {
      headers: {
        // Tillkrav i deras ToS: unik identifiering –(CONTACT från .env, annars
        // kontaktlös markerad) i stället för inbakad placeholder.
        'Digitraffic-User': process.env.CONTACT
          ? `northwatch/0.1 (${safeContact(process.env.CONTACT)})`
          : 'northwatch/0.1 (contact: unset)',
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
        value: feats.length, unit: 'st',
        ts: geojson.dataUpdatedTime ?? now(),
      },
      ...feats.slice(0, 50).map(f => {
        const a = ann(f);
        const title = f.properties.situationType ?? 'Händelse';
        return {
          t: 'e', area: 3, country: 'FI', source: 'digitraffic',
          kind: 'trafikmeddelande',
          severity: 'info',
          title: a?.title ? `${title}: ${a.title}` : title,
          detail: a ? [a.location, a.locationDetails].filter(Boolean).join(' – ') : '',
          start: f.properties.releaseTime ?? now(),
          end: null,
          geo: f.geometry ?? null,
        };
      }),
    ];
  },
};
