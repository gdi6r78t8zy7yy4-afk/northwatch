// Widgetregister för energidashboarden – ren data och selektorer, ingen JSX.
// Kortens innehåll väljs av EnergyDashboard via widget-id; allt klickbart
// material öppnar WidgetDetailModal med serie- och observationsdata.
// Saknad information pekar alltid på den källa som fattas – inga nollor.

export const COUNTRY_ORDER = ['SE', 'NO', 'DK', 'FI', 'IS'];

const isNum = v => v != null && v !== '' && Number.isFinite(Number(v));
const hasValue = r => r?.value != null && Number.isFinite(Number(r.value)) && Boolean(r.ts);

export const latestMetric = (metrics, test) => metrics
  .filter(r => hasValue(r) && test(r))
  .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] ?? null;

// Senaste giltigt mätvärde per indikator (t.ex. per elområde). För day-ahead-
// serier prioriteras det intervall som gäller nu; annars närmaste framtida.
export function latestPerIndicator(metrics, test) {
  const now = Date.now();
  const groups = new Map();
  for (const row of metrics.filter(r => hasValue(r) && test(r))) {
    const key = `${row.indicator}|${row.source}`;
    const at = Date.parse(row.ts ?? '');
    if (!Number.isFinite(at)) continue;
    const rank = at <= now ? now - at : Number.MAX_SAFE_INTEGER + at;
    const prev = groups.get(key);
    if (!prev || rank < prev.rank) groups.set(key, { row, rank });
  }
  return [...groups.values()].map(g => g.row)
    .sort((a, b) => a.indicator.localeCompare(b.indicator));
}

// —— Dag-spotpriser ————————————————————————————————————————————————
export const PRICE_RE = /^Dag-ahead-pris /;
export function priceRows(ctx) {
  const scoped = ctx.country === 'ALL' ? ctx.metrics : ctx.metrics.filter(r => r.country === ctx.country);
  return latestPerIndicator(scoped, r => PRICE_RE.test(r.indicator ?? ''))
    .map(row => ({
      zone: String(row.indicator).replace(PRICE_RE, '').trim(),
      country: row.country, value: Number(row.value), unit: row.unit,
      ts: row.ts, sourceName: row.sourceName ?? row.source,
    }));
}

// —— Produktion och förbrukning ————————————————————————————————
export const GENERATION_RE = /^Total produktion \([A-Z]{2}\)$/;
export const DEMAND_RE = /^Total förbrukning \([A-Z]{2}\)$|^Beräknad förbrukning \(DK, SCADA\)$/;

// Senaste generation/eftersfrågan per land med balans endast vid exakt
// samma tidsstämpel och enhet (samma regel som serverns analys).
export function genDemandRows(ctx) {
  const countries = ctx.country === 'ALL' ? COUNTRY_ORDER : [ctx.country];
  return countries.map(country => {
    const generation = latestMetric(ctx.metrics, r => r.country === country && GENERATION_RE.test(r.indicator ?? ''));
    const demand = latestMetric(ctx.metrics, r => r.country === country && DEMAND_RE.test(r.indicator ?? ''));
    const aligned = Boolean(generation && demand && generation.ts === demand.ts && generation.unit === demand.unit);
    return {
      country, generation, demand, aligned,
      balance: aligned ? Number(generation.value) - Number(demand.value) : null,
      derivedDemand: demand?.indicator === 'Beräknad förbrukning (DK, SCADA)',
    };
  }).filter(row => row.generation || row.demand);
}

// —— Produktionsmix ————————————————————————————————————————————————
export const GENERATION_COMPONENTS = {
  DK: [{ name: 'Vind', indicator: 'Vindproduktion (DK)' }, { name: 'Sol', indicator: 'Solproduktion (DK)' }],
  FI: [
    { name: 'Vind', indicator: 'Vindproduktion (FI)' },
    { name: 'Vattenkraft', indicator: 'Vattenkraftproduktion (FI)' },
    { name: 'Kärnkraft', indicator: 'Kärnkraftsproduktion (FI)' },
    { name: 'Industriell kraftvärme', indicator: 'Industriell kraftvärmeproduktion (FI)' },
  ],
  IS: [
    { name: 'Geotermisk', indicator: 'Geotermisk produktion (IS)' },
    { name: 'Vattenkraft', indicator: 'Vattenkraftproduktion (IS)' },
    { name: 'Olja', indicator: 'Oljeproduktion (IS)' },
  ],
};

// Justerade komponenter (samma ts+enhet) för ett land; null + anledning annars.
export function mixParts(ctx, country) {
  const definitions = GENERATION_COMPONENTS[country] ?? [];
  if (!definitions.length) return { parts: [], reason: 'no-definitions' };
  const candidates = definitions.map(def => ({
    ...def,
    metric: latestMetric(ctx.metrics, r => r.country === country && r.indicator === def.indicator),
  })).filter(item => item.metric);
  const groups = new Map();
  for (const item of candidates) {
    const key = `${item.metric.ts}|${item.metric.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const aligned = [...groups.values()].sort((a, b) =>
    b.length - a.length || String(b[0]?.metric.ts).localeCompare(String(a[0]?.metric.ts)))[0] ?? [];
  if (aligned.length < 2) return { parts: [], reason: 'not-aligned' };
  const parts = aligned.map(item => ({ name: item.name, value: Number(item.metric.value), unit: aligned[0].metric.unit }));
  const total = latestMetric(ctx.metrics, r => r.country === country && GENERATION_RE.test(r.indicator ?? ''));
  if (country === 'DK' && total && total.ts === aligned[0].metric.ts && total.unit === aligned[0].metric.unit) {
    const reported = parts.reduce((sum, part) => sum + part.value, 0);
    if (Number(total.value) >= reported) parts.push({ name: 'Övrigt (ej fördelat)', value: Number(total.value) - reported, unit: total.unit });
  }
  return { parts, ts: aligned[0].metric.ts, reason: null };
}

// —— CO₂-intensitet ————————————————————————————————————————————————
export const CO2_RE = /^CO2-intensitet \([A-Z]{2}\)$/;
export function co2Rows(ctx) {
  return latestPerIndicator(ctx.metrics, r => CO2_RE.test(r.indicator ?? '') &&
    (ctx.country === 'ALL' || r.country === ctx.country))
    .map(row => ({ country: row.country, value: Number(row.value), unit: row.unit, ts: row.ts, sourceName: row.sourceName ?? row.source }));
}

// —— Gränsflöden ————————————————————————————————————————————————
export function flowRows(ctx, limit = 8) {
  return ctx.flows
    .filter(f => f.attrs?.mw != null && f.attrs.mw !== '' && Number.isFinite(Number(f.attrs.mw)))
    .map(f => ({
      id: `${f.source}|${f.name}`,
      name: f.name, sourceName: f.sourceName ?? f.source, updated: f.updated,
      mw: Number(f.attrs.mw), from: f.attrs.from, to: f.attrs.to,
      label: Number(f.attrs.mw) < 0 ? `${f.attrs.to} → ${f.attrs.from}` : `${f.attrs.from} → ${f.attrs.to}`,
    }))
    .sort((a, b) => Math.abs(b.mw) - Math.abs(a.mw))
    .slice(0, limit);
}

// —— Reservmarknad ————————————————————————————————————————————————
export function reserveRows(ctx) {
  const scoped = ctx.country === 'ALL' ? ctx.metrics : ctx.metrics.filter(r => r.country === ctx.country);
  const capacities = scoped.filter(r => /^(aFRR|mFRR)-kapacitet /.test(r.indicator ?? '') && hasValue(r));
  const latestTs = capacities.reduce((latest, row) => (row.ts > latest ? row.ts : latest), '');
  const current = capacities.filter(row => row.ts === latestTs).sort((a, b) => a.indicator.localeCompare(b.indicator));
  const prices = new Map(scoped.filter(r => /^(aFRR|mFRR)-kapacitetspris /.test(r.indicator ?? '') &&
    r.ts === latestTs && hasValue(r)).map(r => [r.indicator.replace('-kapacitetspris ', '-kapacitet '), r]));
  const rows = current.map(row => {
    const match = row.indicator.match(/^(aFRR|mFRR)-kapacitet (.+) (up|down)$/);
    if (!match) return null;
    const [, product, zone, direction] = match;
    const price = prices.get(row.indicator);
    return {
      id: row.indicator, product, zone, direction, country: row.country,
      capacity: Number(row.value), unit: row.unit, ts: row.ts,
      price: price ? Number(price.value) : null, priceUnit: price?.unit ?? null,
      sourceName: row.sourceName ?? row.source,
    };
  }).filter(Boolean);
  const demand = latestPerIndicator(scoped, r => /^Mfrr-efterfrågan/.test(r.indicator ?? ''))
    .map(row => ({ id: row.indicator, product: 'mFRR', zone: row.indicator.replace(/^Mfrr-efterfrågan /, '').replace(/ .*$/, ''), direction: 'uppgift', country: row.country, capacity: null, unit: row.unit, value: Number(row.value), ts: row.ts, price: null, sourceName: row.sourceName ?? row.source }));
  return { blockTs: latestTs || null, rows: [...rows, ...demand] };
}

// —— Prisspridning ————————————————————————————————————————————————
export function spreadData(ctx) {
  const comparisons = ctx.comparisons ?? [];
  return { latest: comparisons[0] ?? null, count: comparisons.length };
}

// —— Källor och täckning ————————————————————————————————————————————————
export function sourceRows(ctx) {
  return (ctx.sources ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
}

// —— Tomtillstånd: namnger källan som saknas per widget + scope ——————
const EMPTY_NOTES = {
  pris: {
    FI: 'Finska priser saknas – Fingrid-dataset 337 är kopplat men kräver gratis API-nyckel (FINGRID_KEY).',
    IS: 'Inga isländska spotpriser – Landsnet Amper svarar 403 och publicerar inga priser.',
    default: 'Inga dag-ahead-prisintervall från anslutna källor i urvalet.',
  },
  produktion: {
    SE: 'Sverige saknar nationell produktions-/förbrukningsaggregat – ingen öppen källa publicerar heltals-MW för hela landet.',
    FI: 'Finska totalserier saknas – Fingrid kräver gratis API-nyckel (FINGRID_KEY).',
    IS: 'Isländsk produktion saknas – Landsnet Amper svarar 403 (WAF-blockad) uppströms.',
    default: 'Inga produktions- eller förbrukningsmätvärden i urvalet.',
  },
  balans: {
    SE: 'Ingen inrikesbalans möjlig – Sverige saknar nationell produktion och förbrukning som matchande tidsseriepar.',
    FI: 'Balans kräver Fingrid-nyckel (FINGRID_KEY) – kollektorn är klar.',
    IS: 'Balans kräver Landsnet, som svarar 403 uppströms; förbrukning saknas dessutom helt.',
    default: 'Produktion och förbrukning finns inte med samma tidsstämpel och enhet i urvalet.',
  },
  mix: {
    SE: 'Svensk produktionsmix per teknik saknas – SVK publicerar inga nationella tekniksindikatorer.',
    NO: 'Norsk produktionsmix per teknik saknas – Statnett rapporterar endast totalslag (MWh/dygn).',
    FI: 'Finska tekniksindikatorer kräver Fingrid-nyckel (FINGRID_KEY).',
    IS: 'Isländsk produktionsmix kräver Landsnet, som svarar 403 uppströms.',
    default: 'Inga justerade teknikkomponenter med gemensam tidsstämpel.',
  },
  co2: {
    FI: 'Finsk CO₂-intensitet saknas – Fingrid-dataset för emissionsintensitet är inte upptagna.',
    IS: 'Isländsk CO₂-intensitet saknas – Landsnet blockerad (403).',
    default: 'Ingen publicerad CO₂-intensitet i urvalet – danska Energinet/EDS är enda källan idag.',
  },
  floden: { default: 'Inga fysiska gränsflöden rapporterade just nu.' },
  reserv: {
    NO: 'Norsk reservmarknad saknas – Statnett publicerar inga aFRR/mFRR-block via öppna API:t.',
    FI: 'Finsk reservmarknad saknas – Fingrids balansdata kräver nyckel (FINGRID_KEY).',
    IS: 'Isländsk reservmarknad saknas – Landsnet blockerad (403).',
    default: 'Inga aFRR/mFRR-leveransblock publicerade i urvalet.',
  },
  prisspridning: {
    NO: 'Prisspridning kräver minst två zoner med samma valuta – Norge har idag endast NO2 (EUR/MWh).',
    FI: 'Prisspridning kräver minst två finska elområden eller Fingrid-prisnyckel.',
    IS: 'Island har inga publicerade spotpriser att jämföra.',
    default: 'Inga justerade prismoment med minst två zoner, samma tidsstämpel och enhet ännu.',
  },
  analys: { default: 'Inga observationer kan härledas ur matchande, tidsjusterade mätvärden ännu.' },
  kallor: { default: 'Inga energikällor i urvalet.' },
};

export function emptyNote(widgetId, country) {
  const notes = EMPTY_NOTES[widgetId] ?? {};
  return (country !== 'ALL' && notes[country]) || notes.default;
}

// —— Datatolkning per widget (modalens fotnoter) ——————————————————
const CAVEATS = {
  karta: ['Kartans zonankare och vissa HVDC-länkar är schematiska approximationer, inte verifierad fysisk nätgeometri.', 'Flödeslinjerna visar källrapporterade MW med respektive teckenkonvention – inte tillgänglig överföringskapacitet.'],
  pris: ['Priser visas som publicerade av respektive källa – valuta och enhet behålls, inga omräkningar görs. Spotpriser exkluderar moms, påslag och skatter.', 'Norska NO2 anges i EUR/MWh (Oslo-området); övriga norska zoner publiceras inte av de anslutna källorna.'],
  produktion: ['Värden är källornas mätningar med respektive upplösning – Statnetts norska totalslag levereras som dygnssummor i MWh/dygn, inte momentana MW.', 'Dansk förbrukning kan vara SCADA-härledd (approximativ) i stället för en avräkningsmätning.'],
  balans: ['En inrikesbalans är produktion minus förbrukning vid exakt samma tidsstämpel och enhet – inte en systembedömning. Import, export, förluster och lagring ingår inte.', 'Bartande eller framtida leveransblock ska inte tolkas som aktuell driftstatus.'],
  mix: ['Teknikkomponenterna är källornas rapporterade delslag, inte en fullständig bränslemix. De får aldrig summeras till total produktion.', 'Endast komponenter med gemensam tidsstämpel och enhet jämförs; annars visas ingen mix.'],
  co2: ['CO₂-intensiteten är danska Energinets/EDS beräknade systemmedelvärde i gram per kWh – inte en utsläppsmätning vid någon specifik förbrukningspunkt.'],
  floden: ['Flödena är källrapporterade MW med respektive teckenkonvention; kartans zonankare och vissa länkar är schematiska approximationer.', 'Flödet visar inte tillgänglig överföringskapacitet eller orsaken till en separation.'],
  reserv: ['Kapacitetsvolymen är publicerad volym för ett leveransblock – inte aktiverad balansenergi, omedelbar reserv eller kvarstående systemmarginal.', 'Pris visas endast när samma källa och block publicerar det; saknade priser lämnas tomma.'],
  prisspridning: ['Spridningen är högsta minus lägsta rapporterade pris i justerade ögonblick med minst två zoner, samma tidsstämpel och enhet – valutor omräknas inte.', 'En spridningsförändring beskriver observerad prisseparation, inte trängsel eller överföringskapacitet.'],
  analys: ['Observationerna är deterministiska jämförelser av mätvärden med justerade tidsstämplar – inga incidentbedömningar eller prognoser.', 'Statistiska avvikelser är signaler för granskning, inte bevis för orsaker.'],
  kallor: ['Hämtfrekvens, körstatus och uppströms observationers ålder visas separat – frontendens uppdateringstakt garanterar inte att källan publicerar nytt.', 'Saknade eller blockerade källor ersätts aldrig med skattade värden.'],
};

export function caveatOf(widgetId) {
  return CAVEATS[widgetId] ?? [];
}

// —— Modalens serie- och observationsfilter per widget ——————
const DETAIL_SPECS = {
  pris: { pattern: PRICE_RE, labelOf: row => String(row.indicator).replace(PRICE_RE, '').trim() },
  produktion: { pattern: /(^Total produktion \([A-Z]{2}\)$)|(^Total förbrukning \([A-Z]{2}\)$)|Beräknad förbrukning/, labelOf: row => `${row.country} · ${row.indicator}` },
  balans: { pattern: /(^Total produktion \([A-Z]{2}\)$)|(^Total förbrukning \([A-Z]{2}\)$)|Beräknad förbrukning/, labelOf: row => `${row.country} · ${row.indicator}` },
  mix: { pattern: /produktion/i, labelOf: row => `${row.country} · ${row.indicator}` },
  co2: { pattern: CO2_RE, labelOf: row => `${row.country} · ${row.indicator}` },
  floden: { pattern: /^Nettoflöde .+→.+$/, labelOf: row => row.indicator },
  reserv: { pattern: /^(aFRR|mFRR)-|^Mfrr-efterfrågan/, labelOf: row => `${row.country} · ${row.indicator}` },
};

export function detailFilter(widgetId) {
  return DETAIL_SPECS[widgetId] ?? null;
}

// Filtrerar historiserade serier för modalen. item = vald underpunkt på kortet
// (t.ex. elområde "SE1" eller flödesid), annars hela widgetens seriefamilj.
export function selectDetailSeries(widgetId, series, { country, item }) {
  const spec = DETAIL_SPECS[widgetId];
  if (!spec) return [];
  let out = (series ?? []).filter(s => spec.pattern.test(s.indicator ?? ''));
  if (country !== 'ALL') out = out.filter(s => s.country === country || s.country === 'NORDIC');
  if (item) {
    if (widgetId === 'pris') out = out.filter(s => String(s.indicator).replace(PRICE_RE, '').trim() === item);
    else if (widgetId === 'floden' && item.includes('→')) {
      const [from, to] = item.split('→').map(part => part.trim());
      out = out.filter(s => s.indicator.includes(`${from}→${to}`) || s.indicator.includes(`${to}→${from}`));
    } else if (widgetId === 'mix') {
      const def = Object.entries(GENERATION_COMPONENTS).flatMap(([code, list]) => code === country || country === 'ALL' ? list.map(d => d.indicator) : []);
      out = out.filter(s => def.includes(s.indicator));
    } else if (['produktion', 'balans'].includes(widgetId)) {
      out = out.filter(s => s.country === item);
    } else if (widgetId === 'co2') {
      out = out.filter(s => s.country === item);
    } else if (widgetId === 'reserv') {
      out = out.filter(s => s.indicator.includes(item));
    }
  }
  return out;
}

// Råa observationer för modalens tabell – senaste N per indikator.
export function selectDetailObservations(widgetId, metrics, { country, item, limit = 24 }) {
  const spec = DETAIL_SPECS[widgetId];
  if (!spec) return [];
  let rows = (metrics ?? []).filter(r => hasValue(r) && spec.pattern.test(r.indicator ?? ''));
  if (country !== 'ALL') rows = rows.filter(r => r.country === country || r.country === 'NORDIC');
  if (item) {
    if (widgetId === 'pris') rows = rows.filter(r => String(r.indicator).replace(PRICE_RE, '').trim() === item);
    else if (['produktion', 'balans'].includes(widgetId)) rows = rows.filter(r => r.country === item);
    else if (widgetId === 'co2') rows = rows.filter(r => r.country === item);
    else if (widgetId === 'reserv') rows = rows.filter(r => r.indicator.includes(item));
  }
  rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const perIndicator = Math.max(2, Math.floor(limit / Math.max(1, new Set(rows.map(r => `${r.country}|${r.indicator}`)).size)));
  const counts = new Map();
  return rows.filter(row => {
    const key = `${row.country}|${row.indicator}`;
    const used = counts.get(key) ?? 0;
    if (used >= perIndicator) return false;
    counts.set(key, used + 1);
    return true;
  }).slice(0, limit);
}

// Fast curated ordning – inga användarvalda omarrangemang.
export const WIDGETS = [
  { id: 'karta', title: 'Nordiskt elnät', hint: 'Gränsflöden och zoner i karta' },
  { id: 'pris', title: 'Dag-spotpriser', hint: 'Publicerade day-ahead-intervall per elområde' },
  { id: 'produktion', title: 'Produktion & förbrukning', hint: 'Senaste nationella mätvärden per land' },
  { id: 'balans', title: 'Inrikesbalans', hint: 'Produktion minus förbrukning, endast tidsjusterat' },
  { id: 'mix', title: 'Produktionsmix', hint: 'Rapporterade teknikkomponenter per land' },
  { id: 'co2', title: 'CO₂-intensitet', hint: 'Gram CO₂ per kWh från danska systemet' },
  { id: 'floden', title: 'Gränsflöden', hint: 'Fysiska MW-flöden mellan zoner och länder' },
  { id: 'reserv', title: 'Reservmarknad', hint: 'Publicerade aFRR/mFRR-leveransblock' },
  { id: 'prisspridning', title: 'Prisspridning elområden', hint: 'Högst minus lägsta pris i justerade ögonblick' },
  { id: 'analys', title: 'Analysobservationer', hint: 'Deterministiska jämförelser av mätvärden' },
  { id: 'kallor', title: 'Källor & täckning', hint: 'Kollektorkur, status och senaste uppdatering' },
];

export const widgetById = id => WIDGETS.find(w => w.id === id) ?? null;
