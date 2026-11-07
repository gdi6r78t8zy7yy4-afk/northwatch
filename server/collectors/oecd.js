// OECD SDMX (STI) – råstålkapacitet per land, årlig (M10).
// ÖPPT API, ingen nyckel. Verifierat 2026-11-07:
//   GET https://sdmx.oecd.org/public/rest/data/OECD.STI.SIP,DSD_STEEL_CAPACITY@DF_CRUDE_STEEL,1.0/all
//     ?dimensionAtObservation=AllDimensions&format=csvfilewithlabels
//     → CSV med kod+etikett-kolumnpar (24 kolumner). OBS: REF_AREA-etiketten
//       "China (People's Republic of)" kan innehålla ett OTCITERAT kommatecken
//       (och CRLF-radslut) → vänsterankrade fält förskjuts på den raden;
//       högerankrade fält är däremot fasta på alla rader:
//       TIME_PERIOD -10, OBS_VALUE -8, OBS_STATUS -4, UNIT_MULT -2.
//   UNIT_MULT = 6 ("Millions") → OBS_VALUE i miljoner ton (Mt);
//   en annan multiplicator skala-skaleras med 10^(6-mult).
//   DNK/ISL-rader har tomt OBS_VALUE (ingen stålkapacitet) → släpps.
//   Nordiska länderna + DEU/JPN/CHN som internationell kontext.
import { j, now } from '../lib/http.js';

const URL = process.env.OECD_STEEL_URL ||
  'https://sdmx.oecd.org/public/rest/data/OECD.STI.SIP,DSD_STEEL_CAPACITY@DF_CRUDE_STEEL,1.0/all' +
  '?dimensionAtObservation=AllDimensions&format=csvfilewithlabels';

const AREA_CODES = { SWE: 'SE', NOR: 'NO', FIN: 'FI', DNK: 'DK', ISL: 'IS', DEU: 'DE', JPN: 'JP', CHN: 'CN' };
const AREA_NAMES = {
  SE: 'Sverige', NO: 'Norge', FI: 'Finland', DK: 'Danmark', IS: 'Island',
  DE: 'Tyskland', JP: 'Japan', CN: 'Kina',
};

// En CSV-rad → kända fält. Högerankrade index (komma i REF_AREA-etiketten
// och CRLF tryggar: samma offset för alla rader).
export function parseRow(line) {
  const f = line.trim().split(',');
  return {
    refArea: f[4],
    time: f.at(-10),
    value: f.at(-8),
    status: f.at(-4),
    unitMult: f.at(-2),
  };
}

export default {
  id: 'oecd',
  name: 'OECD (stålkapacitet)',
  area: 7,
  country: 'NORDIC',
  every: 604800,
  fetch: async () => {
    const r = await j(URL);
    const lines = (await r.text()).split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('OECD stål: tom CSV (ingen data under rubriken)');
    const rows = lines.slice(1).map(parseRow);
    const withValue = rows.filter(x => x.value !== '' && Number.isFinite(Number(x.value)));
    if (!withValue.length) throw new Error('OECD stål: inga värden i CSV');
    const latest = withValue.reduce((m, x) => (x.time > m ? x.time : m), '');
    const records = [];
    for (const row of withValue) {
      const code = AREA_CODES[row.refArea];
      if (!code || row.time !== latest) continue;
      const v = Number(row.value);
      const mult = Number(row.unitMult) || 0;
      records.push({
        t: 'm', area: 7, country: code, source: 'oecd',
        indicator: `Stålkapacitet, råstål (${AREA_NAMES[code]}), ${row.time}`,
        value: v * 10 ** (6 - mult), unit: 'Mt', ts: row.time,
      });
    }
    if (!records.length) throw new Error('OECD stål: inga värden för kartade länder');
    return records;
  },
};
