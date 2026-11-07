// UN Comtrade – nordisk varuhandel (export/import) per land, årlig, USD (M10).
// Två lägen (se README "M10"):
//   - preview, UTAN nyckel: public/v1/preview – gratis men hårt rate-limited
//     (429 vid för snabba upprepningar) → 4 s paus mellan anropen
//     (COMTRADE_PREVIEW_DELAY_MS, standard 4000).
//   - full, MED COMTRADE_API_KEY: data/v1/get med header
//     Ocp-Apim-Subscription-Key (gratisnyckel från comtradeplus.un.org,
//     ~500 anrop/dag).
// Felenheter: reporterCode 752 SE / 578 NO / 208 DK / 246 FI / 352 IS,
// period = senaste genomförda år, partnerCode 0 (världen), cmdCode TOTAL.
// Svaret: {data:[{primaryValue, refYear, refMonth:52 (årligt), ...}]}.
// Felisolering per anrop: misslyckas ALLA throwas; misslyckas några får de
// en "Comtrade {country} {flow}: hämtfel"-metrik och övriga levereras.
import { j, now, sleep } from '../lib/http.js';

const PREVIEW_BASE = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const KEY_BASE = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';

export const REPORTERS = [
  { code: 752, country: 'SE' },
  { code: 578, country: 'NO' },
  { code: 208, country: 'DK' },
  { code: 246, country: 'FI' },
  { code: 352, country: 'IS' },
];
export const FLOWS = [
  { code: 'X', name: 'Exporter' },
  { code: 'M', name: 'Importer' },
];

export const periodYear = () => new Date().getFullYear() - 1;

export default {
  id: 'comtrade',
  name: 'UN Comtrade (varuhandel)',
  area: 7,
  country: 'NORDIC',
  every: 604800,
  fetch: async () => {
    const key = process.env.COMTRADE_API_KEY;
    const year = periodYear();
    const delay = key ? 0 : Number(process.env.COMTRADE_PREVIEW_DELAY_MS ?? 4000);
    const records = [];
    const failed = [];
    let first = true;
    for (const rep of REPORTERS) {
      for (const flow of FLOWS) {
        if (!first && delay > 0) await sleep(delay);
        first = false;
        const url = key
          ? `${KEY_BASE}/${rep.code}/A${year}/0/${flow.code}/HS/TOTAL`
          : `${PREVIEW_BASE}?reporterCode=${rep.code}&period=${year}&partnerCode=0&cmdCode=TOTAL&flowCode=${flow.code}`;
        try {
          const opt = key ? { headers: { 'Ocp-Apim-Subscription-Key': key } } : {};
          const doc = await (await j(url, opt)).json();
          const v = doc?.data?.[0]?.primaryValue;
          if (!Number.isFinite(v)) throw new Error(doc?.error || `inget värde i svaret (refYear=${doc?.data?.[0]?.refYear})`);
          records.push({
            t: 'm', area: 7, country: rep.country, source: 'comtrade',
            indicator: `${flow.name} (UN Comtrade, USD), ${year}`,
            value: v, unit: 'USD', ts: String(year),
          });
        } catch (e) {
          failed.push({ country: rep.country, flow: flow.code, message: e.message });
        }
      }
    }
    if (failed.length === REPORTERS.length * FLOWS.length) {
      throw new Error(`UN Comtrade: alla ${failed.length} hämtningar misslyckades – ${failed[0].message}`);
    }
    for (const f of failed) {
      records.push({
        t: 'm', area: 7, country: f.country, source: 'comtrade',
        indicator: `Comtrade ${f.country} ${f.flow}: hämtfel`, value: null, unit: '', ts: now(),
      });
    }
    return records;
  },
};
