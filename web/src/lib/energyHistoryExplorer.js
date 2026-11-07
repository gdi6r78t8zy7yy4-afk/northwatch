export function filterEnergyHistorySeries(series = [], query = '') {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return series;
  return series.filter(item => [
    item.country, item.source, item.indicator, item.unit,
  ].some(value => String(value ?? '').toLocaleLowerCase().includes(needle)));
}
