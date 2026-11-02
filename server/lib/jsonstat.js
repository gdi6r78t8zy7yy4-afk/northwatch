// Minimal parser för json-stat 2.0 – SCB Statistikdatabasen v2 och
// SSB pxwebapi v2 (M4, verifierat 2026-11-02). Båda levererar toppnyckeln
// "value" (singular); "values" hanteras som fallback.
//
// SCB och SSB returnerar "value" som PLATT array: row-major i "id"-ordning
// (sista dimensionen byter snabbast), null = saknad observation. Platt
// layout är tillåtet av v2-specen. Dimensioner med size 1 (t.ex. en enda
// månad i TAB4516/08864) förekommer inte som egen indexnivå.
// Nästlade arrayer (om en annan källa väljer den formen) hanteras också,
// där dimensioner med size 1 saknas i lagarna.

// Yieldar { code: {dim: kod}, label: {dim: text}, value } för varje observation.
export function* jsonstatRows(json) {
  const vals = json.value ?? json.values;
  if (!Array.isArray(vals)) throw new Error('json-stat: "value" saknas i svaret');
  const dims = json.id ?? [];
  const sizes = (json.size ?? dims.map(() => 1)).map(Number);
  const total = sizes.reduce((a, b) => a * b, 1);
  const codes = {};
  const label = {};
  dims.forEach(d => {
    const cat = json.dimension?.[d]?.category ?? {};
    codes[d] = Object.keys(cat.label ?? {}); // kod per position (indexordning)
    label[d] = cat.label ?? {};
  });
  const buildRow = (value, pos) => {
    const code = {};
    const lab = {};
    dims.forEach((d, di) => {
      code[d] = codes[d][pos[di]] ?? pos[di];
      lab[d] = label[d][code[d]] ?? code[d];
    });
    return { code, label: lab, value };
  };
  if (vals.length === total) {
    // Platt array (SCB v2 + SSB v2, verifierad form).
    for (let i = 0; i < total; i++) {
      let rem = i;
      const pos = [];
      for (let d = dims.length - 1; d >= 0; d--) {
        pos[d] = sizes[d] === 1 ? 0 : rem % sizes[d];
        rem = Math.floor(rem / sizes[d]);
      }
      yield buildRow(vals[i], pos);
    }
    return;
  }
  // Fallback: nästlad array – dimensioner med size 1 saknas i lagarna.
  const walk = function* (arr, prefix) {
    if (!Array.isArray(arr)) {
      const pos = [];
      let p = 0;
      dims.forEach((d, di) => { pos[di] = sizes[di] === 1 ? 0 : prefix[p++]; });
      yield buildRow(arr, pos);
      return;
    }
    for (const v of arr) yield* walk(v, [...prefix, prefix.length]);
  };
  yield* walk(vals, []);
}

// Metrikposter för senaste tidsperioden.
// o: { source, area, country, unit?, indicator? } där
// indicator(row, lastTime) → sträng (tillval; annars generisk
// "dimmärken · (period)").
export function jsonstatLatest(json, o) {
  const rows = [...jsonstatRows(json)];
  const timeDim = (json.role?.time ?? [])[0];
  if (!timeDim) throw new Error('json-stat: role.time saknas');
  const times = [...new Set(rows.map(r => r.code[timeDim]))].sort();
  const last = times[times.length - 1];
  const others = (json.id ?? []).filter(d => d !== timeDim);
  return rows
    .filter(r => r.code[timeDim] === last && r.value != null && r.value !== '')
    .map(r => {
      const value = Number(r.value);
      if (!Number.isFinite(value)) return null;
      const parts = others.map(d => r.label[d]).filter(Boolean);
      const generic = `${parts.join(' · ')} (${last})`;
      return {
        t: 'm', area: o.area, country: o.country, source: o.source,
        indicator: o.indicator ? (o.indicator(r, last) || generic) : generic,
        value, unit: o.unit ?? '', ts: last,
      };
    })
    .filter(Boolean);
}
