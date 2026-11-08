// UN Comtrade – nordisk varuhandel (export/import) per land, årlig, USD (M10).
// API:t dokumenteras på https://comtradeplus.un.org/ApiDocs (Swagger genererad
// ur OpenAPI-specarna https://comtradeapi.un.org/files/v1/app/apim/*.json).
// Två lägen (se README "M10"):
//   - preview, UTAN nyckel: public/v1/preview – gratis men hårt rate-limited
//     (429 vid för snabba upprepningar) → 4 s paus mellan anropen
//     (COMTRADE_PREVIEW_DELAY_MS, standard 4000).
//   - full, MED COMTRADE_API_KEY: data/v1/get med header
//     Ocp-Apim-Subscription-Key (gratisnyckel från comtradeplus.un.org,
//     ~500 anrop/dag).
// BÅDA lägena är querystring-baserade: sökvägen bär bara typ/freq/klassificering
// (C/A/HS), resterande koder – inkl. period som PLINT 4-siffrigt år (inte A2025) –
// går som query parameters. Den gamla vägsbaserade formen
// (/get/C/A/HS/752/A2025/0/X/HS/TOTAL) ger 404 mot nuvarande API.
// Felenheter: reporterCode 752 SE / 578 NO / 208 DK / 246 FI / 352 IS,
// period = senaste genomförda år, partnerCode 0 (världen), cmdCode TOTAL.
// Svaret: {data:[...]}. KEYED-läget bryter ner raderna på motCode
// (transportmedel; 9900 = ej deklarerat, 0 = summa) × partner2Code (0 = allt,
// 899 = icke-angivet m.m.) och ärAggregate är true på ALLA rader – det enda
// tillförlitliga valet är den unika raden motCode=0 && partner2Code=0 som
// matchar preview:s headlinevärde (verifierat 2026-11-08: SE X 2025 =
// 208 483 056 356 USD i båda lägena). motCode som query-param hänger, så
// valet görs klientsida i båda lägen.
// Keyed-API:t är långsamt (1–6 s/anrop) och ger sporadiska 500:or (verifierat
// 2026-11-08) → 2 s takt mellan anropen (COMTRADE_KEYED_DELAY_MS) + begränsad
// retry med exponentiell backoff (COMTRADE_RETRY_MAX, standard 2 → 3 försök)
// på 429/5xx/nätverk/timeout – samma mönster som lib/cyber.js.
// Felisolering per anrop: misslyckas ALLA throwas; misslyckas några får de
// en "Comtrade {country} {flow}: hämtfel"-metrik och övriga levereras.
import { j, now, sleep } from '../lib/http.js';

const PREVIEW_BASE = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const KEY_BASE = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';
const retryMax = () => Number(process.env.COMTRADE_RETRY_MAX ?? 2);
const isRetryable = msg => /HTTP (429|5\d\d)\b|fetch failed|network|timed? ?out/i.test(String(msg));

// Hämtar svaret som JSON; transients misslyckanden (429/5xx/nätverk/timeout)
// retryas med backoff (1 s, 2 s, …) – keyed-API:t ger sporadiska 500:or.
export const fetchTotal = async (url, opt) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await (await j(url, opt)).json();
    } catch (e) {
      if (!isRetryable(e?.message ?? String(e)) || attempt >= retryMax()) throw e;
      await sleep(Math.min(30000, 1000 * 2 ** attempt));
    }
  }
};

export const queryFor = (rep, year, flow) =>
  `reporterCode=${rep.code}&period=${year}&partnerCode=0&cmdCode=TOTAL&flowCode=${flow.code}`;

// Den unika totalraden: transportmedel=0 (summa) och partner2=0 (allt).
// Preview returnerar exakt denna rad; keyed returnerar den bland transport-
// och partner2-nedbrytningar. count=0 (API:t svarar men rapportören har inget
// data) är INTE ett hämtfel – kastar med eget budskap så att kollektören kan
// skilja "ej rapporterat" från nätverksfel (NO har inga dataset i Comtrade
// alls, verifierat via getDA 2026-11-08).
export const pickTotal = (doc, year) => {
  const rows = doc?.data ?? [];
  const row = rows.find(r => Number(r.motCode) === 0 && Number(r.partner2Code) === 0);
  if (!row || !Number.isFinite(row.primaryValue)) {
    if (!rows.length && !doc?.error) {
      throw new Error(`ej rapporterat (count=0) – ${year} saknas för rapportören`);
    }
    throw new Error(doc?.error || `ingen totalrad (motCode=0, partner2Code=0) i svaret (period=${year})`);
  }
  return row.primaryValue;
};

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
    // Takt mellan anropen: 4 s i preview-läge (hårt rate-limitat), 2 s i
    // keyed-läge (API:t är långsamt och ger sporadiska 500:or vid burst).
    const delay = key
      ? Number(process.env.COMTRADE_KEYED_DELAY_MS ?? 2000)
      : Number(process.env.COMTRADE_PREVIEW_DELAY_MS ?? 4000);
    const records = [];
    const failed = [];
    let first = true;
    for (const rep of REPORTERS) {
      for (const flow of FLOWS) {
        if (!first && delay > 0) await sleep(delay);
        first = false;
        const url = key
          ? `${KEY_BASE}?${queryFor(rep, year, flow)}`
          : `${PREVIEW_BASE}?${queryFor(rep, year, flow)}`;
        try {
          const opt = key ? { headers: { 'Ocp-Apim-Subscription-Key': key } } : {};
          const doc = await fetchTotal(url, opt);
          const v = pickTotal(doc, year);
          records.push({
            t: 'm', area: 7, country: rep.country, source: 'comtrade',
            indicator: `${flow.name} (UN Comtrade, USD), ${year}`,
            value: v, unit: 'USD', ts: String(year),
          });
        } catch (e) {
          failed.push({
            country: rep.country, flow: flow.code, message: e.message,
            noData: String(e.message).startsWith('ej rapporterat'),
          });
        }
      }
    }
    if (failed.length === REPORTERS.length * FLOWS.length) {
      throw new Error(`UN Comtrade: alla ${failed.length} hämtningar misslyckades – ${failed[0].message}`);
    }
    for (const f of failed) {
      records.push(f.noData
        // Landet rapporterar inte till Comtrade (NO har inga dataset alls) –
        // inte ett fel, men ingen data heller.
        ? {
          t: 'm', area: 7, country: f.country, source: 'comtrade',
          indicator: `Comtrade ${f.country} ${f.flow}: ej rapporterat (${year})`,
          value: null, unit: '', ts: String(year),
        }
        : {
          t: 'm', area: 7, country: f.country, source: 'comtrade',
          indicator: `Comtrade ${f.country} ${f.flow}: hämtfel`, value: null, unit: '', ts: now(),
        });
    }
    return records;
  },
};
