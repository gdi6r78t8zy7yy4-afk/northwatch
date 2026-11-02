// OSM/Overpass – extraktion av kritiska anläggningar per område (M3).
// Öppet API, ingen nyckel. Veckocache på disk (server/cache/osm-*.json);
// vid nätverksmisse återanvänds åldrig cache om det finns, annars står
// källan i 'error' i hälsan (övergående – se lib/geolayers.js).
// OSM-data: ODbL, sparsamt attributval (namn/koordinat/få tekniska fält).
import { OSM_SPECS, refreshOsm, OSM_WEEK } from '../lib/geolayers.js';

const mk = (id, name, area) => ({
  id,
  name,
  area,
  country: 'NORDIC',
  every: OSM_WEEK,
  fetch: () => refreshOsm(id),
});

export default [
  mk('osm-energi', 'OSM (kraft & nät)', OSM_SPECS['osm-energi'].area),
  mk('osm-digital', 'OSM (datacenter)', OSM_SPECS['osm-digital'].area),
  mk('osm-transport', 'OSM (flygplatser)', OSM_SPECS['osm-transport'].area),
  mk('osm-vatten', 'OSM (vattenverk)', OSM_SPECS['osm-vatten'].area),
];
