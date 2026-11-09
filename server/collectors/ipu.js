// FEM LÄNDER: IPU Parline (M11, område 12) – parlamenten som nordisk
// grundbaslinje för offentlig förvaltning. https://api.data.ipu.org/v1/
// {parliaments, chambers, elections, political_parties} – ingen nyckel;
// källtillkännagivande enligt IPU:s villkor. Viktigt: bar query-parametrar
// IGNORERAS – filter=<fält>:<op>:<värde> (t.ex. filter=id:eq:IS). Envelop
// {data, meta:{total}, links}; parlament/kammare/val-records är
// {type, id, attributes:{...}} där varje attribut är en tidsserie
// [{value, date_from, ...}] → ta sist icke-nulla värde; party-records är
// PLATTA ({political_party_code, party_name, political_party_country}).
// elections returneras i stigande datumordning → hämta allt (≤25/land) och ta
// det senaste valet (max-datum).
// Kammarens id är <CC>-LC01 (andra kammaren; IS är enkammar). Veckohämtning,
// 1 s takt mellan IPU-anropen (IPU_DELAY_MS) – 20 anrop per körning.
import { j, now, sleep } from '../lib/http.js';

const BASE = 'https://api.data.ipu.org/v1';
export const NORDIC5 = ['SE', 'NO', 'DK', 'FI', 'IS'];

// Attributvärde (tidsserie eller singelobjekt) → sist icke-nulla value.
export const lastVal = attr => {
  if (attr == null) return null;
  const arr = Array.isArray(attr) ? attr : [attr];
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const v = arr[i]?.value;
    if (v != null) return v;
  }
  return null;
};

// Datumattribut → ISO-datumsträng ("YYYY-MM-DD..."). Värden kan vara
// {from, to}, sträng eller timestamp.
export const dateOf = v => {
  if (v == null) return null;
  const s = typeof v === 'object' ? v.from ?? v.value ?? null : v;
  const m = String(s ?? '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};

const ipuGet = async (path, delayMs, i) => {
  if (i > 0 && delayMs > 0) await sleep(delayMs);
  const r = await j(`${BASE}${path}`);
  return r.json();
};

// Ett lands parlament → records. counter håller koll på anropsnummer för takt.
async function countryRecords(cc, delayMs, counter) {
  const ts = now();
  const rec = (indicator, value, unit = 'st') => ({
    t: 'm', area: 12, country: cc, source: 'ipu', indicator, value, unit, ts,
  });
  const out = [];
  const get = path => ipuGet(path, delayMs, (counter.i += 1));

  const parl = await get(`/parliaments?filter=id:eq:${cc}&page[size]=1`);
  const pa = parl?.data?.[0]?.attributes ?? {};
  const laws = lastVal(pa.num_laws_adopt_parliament_per_year);
  const staff = lastVal(pa.num_permanent_staff);
  if (laws != null) out.push(rec('Lagar antagna per år (IPU)', laws));
  if (staff != null) out.push(rec('Parlamentsanställda (IPU)', staff));

  const chamber = await get(`/chambers?filter=id:eq:${cc}-LC01&page[size]=1`);
  const ca = chamber?.data?.[0]?.attributes ?? {};
  const members = lastVal(ca.current_members_number);
  const women = lastVal(ca.current_women_number);
  const groups = lastVal(ca.groups_number);
  if (members != null) out.push(rec('Ledamöter, kammare (IPU)', members));
  if (women != null) out.push(rec('Kvinnor bland ledamöter (IPU)', women));
  if (groups != null) out.push(rec('Partigrupper i kammaren (IPU)', groups));
  const chamberElection = dateOf(lastVal(ca.last_election));

  // Senaste valet: hela elections-listan (ASC) → max-datum.
  const elections = await get(`/elections?filter=chamber:eq:${cc}-LC01&page[size]=100`);
  let maxDate = null;
  for (const d of elections?.data ?? []) {
    const dt = dateOf(lastVal(d?.attributes?.election_date));
    if (dt && (!maxDate || dt > maxDate)) maxDate = dt;
  }
  const electionDate = maxDate ?? chamberElection;
  if (electionDate) {
    const days = Math.max(0, Math.floor((Date.parse(ts) - Date.parse(electionDate)) / 86400000));
    out.push(rec(`Dagar sedan senaste val (${electionDate})`, days, 'dagar'));
  }

  const parties = await get(`/political_parties?filter=political_party_country:eq:${cc}&page[size]=1`);
  const partyCount = Number(parties?.meta?.total);
  if (Number.isFinite(partyCount)) out.push(rec('Politiska partier (IPU)', partyCount));

  if (!out.length) throw new Error(`IPU: inga records för ${cc}`);
  return out;
}

export default {
  id: 'ipu',
  name: 'IPU Parline (parlament, 5 länder)',
  area: 12,
  country: 'NORDIC',
  every: 604800,
  fetch: async () => {
    const delay = Number(process.env.IPU_DELAY_MS ?? 1000);
    const ts = now();
    const records = [];
    const failed = [];
    const counter = { i: 0 };
    for (const cc of NORDIC5) {
      try {
        records.push(...await countryRecords(cc, delay, counter));
      } catch (e) {
        failed.push({ country: cc, message: e.message });
        records.push({
          t: 'm', area: 12, country: cc, source: 'ipu',
          indicator: `IPU ${cc}: hämtfel`, value: null, unit: '', ts,
        });
      }
    }
    if (failed.length === NORDIC5.length) {
      throw new Error(`IPU: alla 5 länder misslyckades – ${failed[0].message}`);
    }
    return records;
  },
};
