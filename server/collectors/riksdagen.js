// SE: Sveriges riksdag (M11, område 12). https://data.riksdagen.se –
// ingen API-nyckel; ange alltid Sveriges riksdag som källa. Fyra flöden
// (veckohämtning):
//   1. Kammarkalendern: GET /kalender/?org=kamm&utformat=json – URL:en ska
//      sluta med snedstreck (utan det 404). {kalenderlista:{@antal, kalender:[{UID, SUMMARY,
//      CATEGORIES, LOCATION, DTSTART, DTEND, ...}]}} – ca 85 händelser:
//      ~4 veckor bakåt + tillfälliga (provisionella) händelser ~halvår framåt.
//   2. votering-<kammarår>.json.zip: en JSON per omröstning,
//      {dokvotering:{votering:[{rost:"Ja"|"Nej"|"Frånvarande"|..., namn, parti}]}}.
//   3. anforande-<kammarår>.json.zip: en JSON per anförande,
//      {anforande:{talare, parti, dok_titel, anforande_nummer, ...}}.
//   4. person.json.zip: en JSON per person, {person:{status, kon, parti, ...}}
//      – historiskt register (tjänstgörande + tidigare ledamöter m.m.).
// Kammaråret (t.ex. 202627) börjar med septembervalet; zip-datat byts ut löpande
// under kammaråret. Vid 404 på härledd kammarår provas föregående. Dokument-zips
// (mot/mo/prop/prot) ger 404 även vid plain GET – inga sådana flöden.
// Subflödesfel markeras som nollade "hämtfel"-records (comtrade-mönstret);
// källan är ok så snart minst ett flöde levererar.
import { j, jjson, now } from '../lib/http.js';
import { unzip, unzipJson } from '../lib/zip.js';

// Kammarår → sexsiffrig kod: sep–dec ger "YYYY(YY+1)" (ny mandatperiod inleds
// med septembervalet), jan–aug ger "(YYYY-1)YYYY". 2026-09-28 → 202627.
export const kammarAr = (d = new Date()) => {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-baserad; september = 8
  const from = m >= 8 ? y : y - 1;
  return `${from}${String(from + 1).slice(2)}`;
};

// iCal-datum "20260928T090000" → "2026-09-28T09:00:00" (naiv tid, anses CET).
export const icalDate = s => {
  const m = String(s ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
};

// Laddar ett Riksdagen-zip (varje post = ett JSON-dokument). votering/anförande
// är kammarårstäckta (name-år.zip); person.zip är en statisk fil. Vid 404 på ett
// kammarårstängt zip provas föregående kammarår (övergång mellan perioder).
// Namnet används bara som identifierare – inte för felsökningsbesked.
async function fetchZipJson(url, name, ar) {
  const get = async (u, tag) => {
    const buf = Buffer.from(await (await j(u)).arrayBuffer());
    return { entries: unzipJson(buf), ar: tag };
  };
  try {
    return await get(url, ar);
  } catch (e) {
    if (!/HTTP 404/.test(e.message) || !ar || ar === 'latest') throw e;
    const prev = `${Number(ar.slice(0, 4)) - 1}${String(Number(ar.slice(0, 4)) - 1).slice(2)}`;
    return get(`https://data.riksdagen.se/dataset/${name}/${name}-${prev}.json.zip`, prev);
  }
}

// Kalenderhändelser → event-records (t:'e'), sorterade efter start.
export function kalenderEvents(list) {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr.map(e => ({
    t: 'e', area: 12, country: 'SE', source: 'riksdagen', kind: 'kammarkalender',
    severity: 'info', title: e.SUMMARY ?? e.UID ?? 'Kalenderhändelse',
    detail: [e.CATEGORIES, e.LOCATION].filter(Boolean).join(' · '),
    start: icalDate(e.DTSTART), end: icalDate(e.DTEND),
  })).filter(e => e.start);
}

// Voteringar: per omröstning + röster per inställning (Ja/Nej/Frånvarande).
export function voteringStats(entries) {
  const rost = {};
  let omrosten = 0;
  let rasts = 0;
  for (const d of entries) {
    const rows = d?.dokvotering?.votering;
    if (!Array.isArray(rows)) continue;
    omrosten += 1;
    for (const r of rows) {
      const v = r?.rost ?? 'Okänt';
      rost[v] = (rost[v] ?? 0) + 1;
      rasts += 1;
    }
  }
  return { omrosten, rost, rasts };
}

// Ledamötsregistret: tjänstgörande ledamöter + könsfördelning bland dem.
export function personStats(entries) {
  const active = entries.filter(p => /^Tjänstgörande riksdagsledamot/i.test(p?.status ?? ''));
  const kon = { man: 0, kvinna: 0 };
  for (const p of active) if (kon[p.kon] != null) kon[p.kon] += 1;
  return {
    totalt: entries.length,
    tjanstgorande: active.length,
    kvinnor: kon.kvinna,
    man: kon.man,
  };
}

export default {
  id: 'riksdagen',
  name: 'Sveriges riksdag (kalender, voteringar, anföranden)',
  area: 12,
  country: 'SE',
  every: 604800,
  fetch: async () => {
    const records = [];
    const failed = [];
    const ar = kammarAr();
    const ts = now();

    try {
      const doc = await jjson('https://data.riksdagen.se/kalender/?org=kamm&utformat=json');
      const events = kalenderEvents(doc?.kalenderlista?.kalender);
      records.push(...events);
      records.push({
        t: 'm', area: 12, country: 'SE', source: 'riksdagen',
        indicator: 'Kalenderhändelser, kammarkalendern', value: events.length, unit: 'st', ts,
      });
    } catch (e) {
      failed.push({ name: 'kalender', message: e.message });
    }

    try {
      const { entries, ar: usedAr } = await fetchZipJson(
        `https://data.riksdagen.se/dataset/votering/votering-${ar}.json.zip`, 'votering', ar);
      const st = voteringStats(entries);
      records.push({
        t: 'm', area: 12, country: 'SE', source: 'riksdagen',
        indicator: `Omröstningar (kammaråret ${usedAr})`, value: st.omrosten, unit: 'st', ts,
      });
      for (const [rost, n] of Object.entries(st.rost)) {
        records.push({
          t: 'm', area: 12, country: 'SE', source: 'riksdagen',
          indicator: `Röster: ${rost}`, value: n, unit: 'st', ts,
        });
      }
    } catch (e) {
      failed.push({ name: 'votering', message: e.message });
    }

    try {
      const { entries, ar: usedAr } = await fetchZipJson(
        `https://data.riksdagen.se/dataset/anforande/anforande-${ar}.json.zip`, 'anforande', ar);
      records.push({
        t: 'm', area: 12, country: 'SE', source: 'riksdagen',
        indicator: `Anföranden (kammaråret ${usedAr})`, value: entries.length, unit: 'st', ts,
      });
    } catch (e) {
      failed.push({ name: 'anforande', message: e.message });
    }

    try {
      const { entries } = await fetchZipJson(
        'https://data.riksdagen.se/dataset/person/person.json.zip', 'person', 'latest');
      const st = personStats(entries);
      records.push(
        {
          t: 'm', area: 12, country: 'SE', source: 'riksdagen',
          indicator: 'Tjänstgörande riksdagsledamöter', value: st.tjanstgorande, unit: 'st', ts,
        },
        {
          t: 'm', area: 12, country: 'SE', source: 'riksdagen',
          indicator: 'Kvinnor bland tjänstgörande ledamöter', value: st.kvinnor, unit: 'st', ts,
        },
        {
          t: 'm', area: 12, country: 'SE', source: 'riksdagen',
          indicator: 'Personregister (historiskt)', value: st.totalt, unit: 'st', ts,
        },
      );
    } catch (e) {
      failed.push({ name: 'person', message: e.message });
    }

    if (failed.length === 4) {
      throw new Error(`Riksdagen: alla 4 flöden misslyckades – ${failed[0].message}`);
    }
    for (const f of failed) {
      records.push({
        t: 'm', area: 12, country: 'SE', source: 'riksdagen',
        indicator: `Riksdagen ${f.name}: hämtfel`, value: null, unit: '', ts,
      });
    }
    return records;
  },
};
