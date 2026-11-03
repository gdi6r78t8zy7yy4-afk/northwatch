// Deterministisk Leaflet-mock (M6).
//
// Verklig Leaflet i jsdom saknar layout (behållare med höjd 0, fitBounds
// utan kartprojektion) – och kontraktet vi testar är *vilka* vy-anrop
// komponenten gör, inte Leaflets interna matematik. Mocken registreras för
// alla testfiler från src/test/setup.js och loggar:
//
//   __leaf.view           – ur ordning: { type: 'setView', center, zoom }
//                           och { type: 'fitBounds', opts }
//   __leaf.invalidateSize – antal anrop
//   __leaf.clearLayers    – antal layerGroup.clearLayers-anrop
//   __leaf.removed        – antal map.remove-anrop
//   __leaf.created        – alla skapade lager:
//                           { kind, arg, options, popup, tooltip }
//
// Testfiler som behöver loggen importerar __leaf/__resetLeaflet härifrån
// (samma modulinstans som mocken använder).
export const __leaf = {
  view: [],
  invalidateSize: 0,
  clearLayers: 0,
  removed: 0,
  created: [],
};

export const __resetLeaflet = () => {
  __leaf.view.length = 0;
  __leaf.invalidateSize = 0;
  __leaf.clearLayers = 0;
  __leaf.removed = 0;
  __leaf.created.length = 0;
};

// Alla getBounds-anrop ger giltiga bounds – tillräckligt för att komponenten
// ska ta sin fitBounds-väg i tests.
const bounds = {
  isValid: () => true,
  pad: () => bounds,
  getCenter: () => [64, 8],
};

function layer(entry) {
  return {
    bindPopup(html) { entry.popup = html; return this; },
    bindTooltip(text, options) { entry.tooltip = { text, options: options ?? {} }; return this; },
    addTo() { return this; },
    setStyle() { return this; },
    getBounds: () => bounds,
  };
}

const created = (kind, arg, options) => {
  const entry = { kind, arg, options: options ?? {}, popup: null, tooltip: null };
  __leaf.created.push(entry);
  return layer(entry);
};

export const L = {
  map(el, opts) {
    return {
      setView(center, zoom) { __leaf.view.push({ type: 'setView', center, zoom }); return this; },
      fitBounds(b, opts) { __leaf.view.push({ type: 'fitBounds', opts: opts ?? {} }); return this; },
      invalidateSize() { __leaf.invalidateSize += 1; return this; },
      remove() { __leaf.removed += 1; return this; },
      on() { return this; },
      off() { return this; },
    };
  },
  tileLayer: (url, options) => created('tileLayer', url, options),
  layerGroup() {
    return {
      clearLayers() { __leaf.clearLayers += 1; return this; },
      addTo() { return this; },
      addLayer() { return this; },
    };
  },
  geoJSON: (geo, options) => created('geoJSON', geo, options),
  circleMarker: (latlng, options) => created('circleMarker', latlng, options),
  polyline: (coords, options) => created('polyline', coords, options),
};

export default L;
