const ENERGY_SEARCH_ALIASES = [
  ['hydro', 'vattenkraft', 'water power'],
  ['wind', 'vind', 'vindkraft'],
  ['solar', 'sol', 'solkraft'],
  ['geothermal', 'geotermisk', 'geotermi'],
  ['nuclear', 'kärnkraft', 'karnkraft'],
];

function searchTerms(query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return [];
  const aliases = ENERGY_SEARCH_ALIASES.find(group =>
    group.some(term => term.includes(needle) || needle.includes(term)));
  return [...new Set([needle, ...(aliases ?? [])])];
}

export function filterEnergyHistorySeries(series = [], query = '') {
  const terms = searchTerms(query);
  if (!terms.length) return series;
  return series.filter(item => {
    const fields = [item.country, item.source, item.indicator, item.unit]
      .map(value => String(value ?? '').toLocaleLowerCase());
    return terms.some(term => fields.some(value => value.includes(term)));
  });
}
