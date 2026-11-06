// SMHI-prognosrutnät → pixelmatris för Leaflet imageOverlay.
// Rutnätet (multipoint, ds20) är ROTerat ~20° så radordning kan inte
// antas – varje punkt rasteriseras uttryckligen från sin koordinat mot
// bgränsen (bbox), och cellstorleken uppskattas av median-avståndet
// mellan närliggande punkter i scanordning.
//
// paintWxGrid(values, coords, parameter) är ren (testbar i jsdom):
//   – 9999 (missingValue) / ogiltiga koordinater → transparent
//   – canvas → dataURL; saknas canvas (jsdom) → 1×1-blank fallback så
//     imageOverlay ändå skapas (test-kontraktet är bbox + parametrar).
export const MISSING = 9999;

// Första tidssteg som är nu eller senare (samma regel som servern).
export function nowIndex(times, at = new Date()) {
  const t = at.getTime();
  for (let i = 0; i < times.length; i += 1) {
    if (new Date(times[i]).getTime() >= t) return i;
  }
  return times.length - 1;
}

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Färgkurvor per parameter (svag → stark; värden utanför clampas).
const RAMPS = {
  air_temperature: {
    stops: [[-30, hex('#1b4299')], [-10, hex('#60a5e8')], [0, hex('#f4f4f4')], [8, hex('#f0b27a')], [16, hex('#d4553a')], [28, hex('#8e1a4f')]],
  },
  wind_speed_of_gust: {
    stops: [[0, hex('#eef3e6')], [5, hex('#b7d9a0')], [10, hex('#e8d26b')], [17, hex('#e08a2e')], [22.5, hex('#d4574a')], [30, hex('#7a1f4e')]],
  },
  // Intervallsumma – sqrt-skala så låga värden (1–5 mm) syns.
  precipitation_amount_mean: {
    scale: v => Math.sqrt(Math.max(0, v)),
    stops: [[0, hex('#f2f7fb')], [1, hex('#bcd9f0')], [2, hex('#6ba3d8')], [2.83, hex('#2f6db3')], [3.87, hex('#173e7a')], [5, hex('#0c1f4d')]],
  },
  probability_of_precipitation: {
    stops: [[0, hex('#f4f6f8')], [30, hex('#bcd2ea')], [60, hex('#5d8ec4')], [100, hex('#274e86')]],
  },
};

const makeRamp = ({ stops, scale = v => v }) => v => {
  const x = scale(v);
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (x <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = (x - v0) / (v1 - v0);
      return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * t));
    }
  }
  return stops.at(-1)[1];
};

// CSS-gradering + etikett för kartlegenden.
export const WX_RAMPS = {
  air_temperature: {
    label: 'Temperatur (°C)', min: -30, max: 28,
    css: 'linear-gradient(90deg,#1b4299,#60a5e8,#f4f4f4,#f0b27a,#d4553a,#8e1a4f)',
  },
  wind_speed_of_gust: {
    label: 'Vindbyar (m/s)', min: 0, max: 30,
    css: 'linear-gradient(90deg,#eef3e6,#b7d9a0,#e8d26b,#e08a2e,#d4574a,#7a1f4e)',
  },
  precipitation_amount_mean: {
    label: 'Nederbörd (mm/interval)', min: 0, max: 25,
    css: 'linear-gradient(90deg,#f2f7fb,#bcd9f0,#6ba3d8,#2f6db3,#173e7a,#0c1f4d)',
  },
  probability_of_precipitation: {
    label: 'Nederbördssannolikhet (%)', min: 0, max: 100,
    css: 'linear-gradient(90deg,#f4f6f8,#bcd2ea,#5d8ec4,#274e86)',
  },
};

const ramp = p => makeRamp(RAMPS[p] ?? RAMPS.air_temperature);

// Median-avståndet (grader) mellan närliggande punkter i scanordning.
function cellStep(coords) {
  const dists = [];
  const n = Math.min(coords.length, 600);
  for (let i = 1; i < n; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    if (!a || !b) continue;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > 0 && d < 5) dists.push(d); // <5°: utesluter radhopp/störning
  }
  if (!dists.length) return null;
  dists.sort((x, y) => x - y);
  return dists[Math.floor(dists.length / 2)];
}

const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function toDataUrl(pixels, w, h) {
  try {
    if (typeof document === 'undefined' || !document.createElement) return BLANK_PNG;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return BLANK_PNG; // jsdom saknar canvas
    ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return BLANK_PNG;
  }
}

/**
 * @param {number[]} values  skalär per koordinatindex (9999 = saknad)
 * @param {[number,number][]} coords  [lon, lat] per index (SMHI-ordning)
 * @param {string} parameter  en av WX_RAMPS-nycklarna
 * @returns {null | { width, height, bbox, pixels, url }}
 */
export function paintWxGrid(values, coords, parameter) {
  if (!Array.isArray(values) || !Array.isArray(coords)
    || !values.length || values.length !== coords.length) return null;
  let minLon = Infinity; let maxLon = -Infinity;
  let minLat = Infinity; let maxLat = -Infinity;
  for (const c of coords) {
    const lon = c?.[0];
    const lat = c?.[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon)) return null;

  // Cellstorlek: median-steg (grader) → dLat direkt, dLon korrigerat med
  // cos(bredvid midbredvidden) eftersom grader blir kortare i norr.
  const step = cellStep(coords);
  const latMid = ((minLat + maxLat) / 2) * Math.PI / 180;
  const dLon = step ? step / Math.max(0.2, Math.cos(latMid)) : (maxLon - minLon) / 40 || 1;
  const dLat = step || (maxLat - minLat) / 40 || 1;
  const W = Math.max(1, Math.min(600, Math.ceil((maxLon - minLon) / dLon) + 1));
  const H = Math.max(1, Math.min(600, Math.ceil((maxLat - minLat) / dLat) + 1));

  const color = ramp(parameter);
  const pixels = new Uint8ClampedArray(W * H * 4);
  coords.forEach((c, i) => {
    const v = values[i];
    if (v == null || v === MISSING || !Number.isFinite(v)) return;
    const lon = c?.[0];
    const lat = c?.[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const x = Math.min(W - 1, Math.max(0, Math.floor((lon - minLon) / dLon)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((maxLat - lat) / dLat))); // rad 0 = norr
    const [r, g, b] = color(v);
    const o = (y * W + x) * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = 215;
  });

  return {
    width: W,
    height: H,
    bbox: [[minLat, minLon], [maxLat, maxLon]], // Leaflet [[s,v],[n,o]]
    pixels,
    url: toDataUrl(pixels, W, H),
  };
}
