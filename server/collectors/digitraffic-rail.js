// Digitraffic (Rata) – tågtrafik och resenärinformation (järnväg, FI).
// ÖPPT API, ingen nyckel. IDENTIFIERING: Digitraffic-User-headern krävs
// (samma ToS som väg). Verifierat 2026-11-02:
//   GET https://rata.digitraffic.fi/api/v1/passenger-information/active
//     → array {id, trainNumber, stations[], startValidity, endValidity,
//              video:{text:{fi, sv, en}}} (aktiva förseningsinformationer)
//   GET https://rata.digitraffic.fi/api/v1/trains
//     → array {runningCurrently, cancelled, trainNumber, operatorShortCode,
//              timeTableRows:[{differenceInMinutes, scheduledTime, actualTime,
//              stationShortCode, ...}]} – INGEN position → metriska poster.
// ToS max 1 anrop/s → anropen iaktskänbar; pollar var 10:e minut.
import { jjson, now, sleep, safeContact } from '../lib/http.js';

const BASE = 'https://rata.digitraffic.fi/api/v1';
const H = () => ({
  // Unik identifiering enligt Digitraffics villkor (CONTACT från .env).
  'Digitraffic-User': process.env.CONTACT
    ? `northwatch/0.1 (${safeContact(process.env.CONTACT)})`
    : 'northwatch/0.1 (contact: unset)',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip',
});

export default {
  id: 'digitraffic-rail',
  name: 'Digitraffic (järnväg)',
  area: 3,
  country: 'FI',
  every: 600,
  fetch: async () => {
    const records = [];

    // Aktiva resenärmeddelanden (förseningar) → händelser.
    const info = await jjson(`${BASE}/passenger-information/active`, { headers: H() });
    const list = Array.isArray(info) ? info : [];
    for (const x of list.slice(0, 30)) {
      const t = x.video?.text ?? {};
      const text = t.sv ?? t.en ?? t.fi ?? '';
      const end = x.endValidity ? `${String(x.endValidity).slice(0, 16).replace('T', ' ')} h` : null;
      records.push({
        t: 'e', area: 3, country: 'FI', source: 'digitraffic-rail',
        kind: 'tågförsening',
        severity: 'medium',
        title: `Tåg ${x.trainNumber ?? '?'}${x.stations?.length ? ` ${x.stations.join('–')}` : ''}`.trim(),
        detail: [text, end ? `Aktiv t.o.m. ${end}` : ''].filter(Boolean).join(' · '),
        start: x.startValidity ?? now(),
        end: x.endValidity ?? null,
        geo: null,
      });
    }

    await sleep(1100);

    // Tågbestånd → metrik (antal i trafik, inställda, medelfördröjning).
    const trains = await jjson(`${BASE}/trains`, { headers: H() });
    const list2 = Array.isArray(trains) ? trains : [];
    const running = list2.filter(t => t.runningCurrently).length;
    const cancelled = list2.filter(t => t.cancelled).length;
    const diffs = list2
      .flatMap(t => (t.timeTableRows ?? []).map(x => x.differenceInMinutes))
      .filter(v => v != null && Number.isFinite(Number(v)));
    const avg = diffs.length
      ? Math.round(diffs.reduce((s, v) => s + Number(v), 0) / diffs.length)
      : 0;
    records.push(
      {
        t: 'm', area: 3, country: 'FI', source: 'digitraffic-rail',
        indicator: 'Tåg i trafik just nu (antal)', value: running, unit: 'st', ts: now(),
      },
      {
        t: 'm', area: 3, country: 'FI', source: 'digitraffic-rail',
        indicator: 'Inställda tåg (antal, avresedag)', value: cancelled, unit: 'st', ts: now(),
      },
      {
        t: 'm', area: 3, country: 'FI', source: 'digitraffic-rail',
        indicator: 'Medelfördröjning mot tidsplan (min, FI)', value: avg, unit: 'min', ts: now(),
      },
    );
    return records;
  },
};
