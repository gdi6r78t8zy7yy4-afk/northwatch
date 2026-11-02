// Energi Data Service (danmarks elsystem) – senaste 15-minutersbild för DK:
// produktion per typ, förbrukning, nettoexport/import och CO2-intensitet.
// Öppet dataset-API, ingen nyckel. Verifierat 2026-11-01:
//   /dataset/GenerationProdTypeExchange?limit=N – raderna nyast först,
//   TimeUTC + PriceArea (DK1/DK2); fält OnshoreWindPower, OffshoreWindPower,
//   SolarPower, HydroPower, Biomass, …, Exchange<Land> (positivt = export),
//   GrossCon, CO2PerkWh.
// Summerar DK1+DK2 vid senaste tidsstämpel → hel-DK-siffror.
import { jjson } from '../lib/http.js';

const BASE = process.env.EDS_BASE || 'https://api.energidataservice.dk/dataset';

const GEN_FIELDS = [
  'OffshoreWindPower', 'OnshoreWindPower', 'HydroPower', 'SolarPower',
  'SolarPowerSelfCon', 'Biomass', 'Biogas', 'Waste', 'FossilGas',
  'FossilOil', 'FossilHardCoal',
];

export default {
  id: 'energidataservice',
  name: 'Energi Data Service',
  area: 1,
  country: 'DK',
  every: 300,
  fetch: async () => {
    const d = await jjson(`${BASE}/GenerationProdTypeExchange?limit=8`);
    const recs = d.records ?? [];
    if (!recs.length) throw new Error('GenerationProdTypeExchange returnerade inga rader');
    const latestTs = recs[0].TimeUTC;
    const rows = recs.filter(r => r.TimeUTC === latestTs);
    const sum = f => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
    const round = v => Math.round(v * 100) / 100;

    const wind = round(sum('OffshoreWindPower') + sum('OnshoreWindPower'));
    const solar = round(sum('SolarPower') + sum('SolarPowerSelfCon'));
    const gen = round(GEN_FIELDS.reduce((a, f) => a + sum(f), 0));
    const exch = round(
      Object.keys(rows[0]).filter(k => k.startsWith('Exchange')).reduce((a, f) => a + sum(f), 0),
    );

    // CO2-intensitet (g/kWh) är per-prisområde – summering av DK1+DK2 hade
    // dubbelräknat. Vägt med förbrukning (GrossCon) per prisområde.
    const totCons = rows.reduce((a, r) => a + (Number(r.GrossCon) || 0), 0);
    const co2 = totCons > 0
      ? round(rows.reduce((a, r) => a + (Number(r.CO2PerkWh) || 0) * (Number(r.GrossCon) || 0), 0) / totCons)
      : round(sum('CO2PerkWh'));

    return [
      { t: 'm', area: 1, country: 'DK', source: 'energidataservice',
        indicator: 'Vindproduktion (DK)', value: wind, unit: 'MW', ts: latestTs },
      { t: 'm', area: 1, country: 'DK', source: 'energidataservice',
        indicator: 'Solproduktion (DK)', value: solar, unit: 'MW', ts: latestTs },
      { t: 'm', area: 1, country: 'DK', source: 'energidataservice',
        indicator: 'Total produktion (DK)', value: gen, unit: 'MW', ts: latestTs },
      { t: 'm', area: 1, country: 'DK', source: 'energidataservice',
        indicator: 'Total förbrukning (DK)', value: round(sum('GrossCon')), unit: 'MW', ts: latestTs },
      { t: 'm', area: 1, country: 'DK', source: 'energidataservice',
        indicator: 'Nettoflöde (DK)', value: exch, unit: 'MW', ts: latestTs },
      { t: 'm', area: 1, country: 'DK', source: 'energidataservice',
        indicator: 'CO2-intensitet (DK)', value: co2, unit: 'g/kWh', ts: latestTs },
    ];
  },
};
