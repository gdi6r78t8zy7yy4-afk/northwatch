// M8: handgjord SVG-graf för prognostidsserier (inga nyberoenden).
// En gemensam hover-index (tidsskrov) styrs av föräldern: pekare i
// plotområdet, range-slider i panelen och "nu"-markör pekar på samma steg.
// 9999/saknade värden renderas som avbrott i linjen (gap).
export const CHART_W = 720;
export const CHART_H = 150;
const M = { l: 48, r: 10, t: 14, b: 26 };

const p2 = n => String(n).padStart(2, '0');

// Aksetick: dd-mm HH:MM (året räknas konstant inom en cykel; den fulla
// yyyy-mm-dd hh:mm UTC-formen visas i tidsskrovens läsvärde).
export function tickLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export function defaultTicks(times) {
  const n = times.length;
  if (n < 2) return n === 1 ? [0] : [];
  const count = Math.min(7, n);
  const out = new Set();
  for (let k = 0; k < count; k += 1) out.add(Math.round((k * (n - 1)) / (count - 1)));
  return [...out].sort((a, b) => a - b);
}

// Linje med gap vid saknade värden (9999 → null).
function seriesPath(values, xs, ys) {
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export default function ForecastChart({
  title,
  unit,
  times,
  series,
  hover = null,
  onHover,
  nowIdx = 0,
  thresholds = [],
  ticks,
  valueFmt,
  height = CHART_H,
}) {
  const n = times.length;
  const plotW = CHART_W - M.l - M.r;
  const plotH = height - M.t - M.b;
  const xs = i => (n <= 1 ? M.l + plotW / 2 : M.l + (i / (n - 1)) * plotW);

  // Y-område: endast mätdata (tröskellinjer markeras vid kanten om de
  // ligger utanför).
  const dataVals = [];
  for (const s of series) {
    for (const v of s.values) {
      if (v != null && Number.isFinite(v)) dataVals.push(v);
    }
  }
  let lo = dataVals.length ? Math.min(...dataVals) : 0;
  let hi = dataVals.length ? Math.max(...dataVals) : 1;
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const ys = v => M.t + (1 - (v - lo) / (hi - lo)) * plotH;

  const tickIdx = ticks ?? defaultTicks(times);
  const yTicks = [0, 1, 2, 3].map(k => lo + (k * (hi - lo)) / 3);
  const fmt = valueFmt ?? (v => String(Math.round(v * 10) / 10));
  const hoverI = hover == null ? null : Math.max(0, Math.min(n - 1, Math.round(hover)));

  // Peka → index: rectens box är exakt plotområdet (viewBox skalar).
  const pick = e => {
    if (!onHover || n < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / Math.max(1, r.width);
    onHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };

  return (
    <div className="fchart">
      <div className="fctitle">
        {title}{unit ? ` (${unit})` : ''}
        <span className="flegend">
          {series.map(s => (
            <span key={s.label} className="flg"><i style={{ background: s.color }} />{s.label}</span>
          ))}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${height}`}
        role="img"
        aria-label={`${title}: ${series.map(s => s.label).join(', ')} (${n} tidssteg)`}
      >
        {yTicks.map((v, k) => (
          <g key={k}>
            <line x1={M.l} x2={CHART_W - M.r} y1={ys(v)} y2={ys(v)} className="fcgrid" />
            <text x={M.l - 6} y={ys(v) + 3.5} textAnchor="end" className="fclbl">{fmt(v)}</text>
          </g>
        ))}
        {0 >= lo && 0 <= hi && (
          <line x1={M.l} x2={CHART_W - M.r} y1={ys(0)} y2={ys(0)} className="fzero" />
        )}
        {tickIdx.map(i => (
          <text
            key={i}
            x={xs(i)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            className="fclbl"
          >
            {tickLabel(times[i])}
          </text>
        ))}
        {thresholds.map(t => {
          const inside = t.value >= lo && t.value <= hi;
          const y = inside ? ys(t.value) : (t.value > hi ? M.t : M.t + plotH);
          return (
            <g key={t.label ?? t.value}>
              <line
                x1={M.l} x2={CHART_W - M.r} y1={y} y2={y}
                stroke={t.color} strokeDasharray={inside ? '5 4' : '2 4'} opacity={0.75}
              />
              <text
                x={CHART_W - M.r - 2}
                y={inside ? y - 3 : (t.value > hi ? y + 10 : y - 4)}
                textAnchor="end"
                className="fclbl"
                fill={t.color}
              >
                {t.label}
              </text>
            </g>
          );
        })}
        {/* Nu-markör */}
        <line x1={xs(nowIdx)} x2={xs(nowIdx)} y1={M.t} y2={M.t + plotH} className="fnow" />
        <text
          x={xs(nowIdx)}
          y={M.t - 4}
          textAnchor={nowIdx === 0 ? 'start' : nowIdx >= n - 1 ? 'end' : 'middle'}
          className="fclbl fnowlbl"
        >
          nu
        </text>
        {series.map(s => (
          <path
            key={s.label}
            d={seriesPath(s.values, xs, ys)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 1.5 : 2}
            strokeDasharray={s.dashed ? '5 3' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hoverI != null && (
          <g>
            <line x1={xs(hoverI)} x2={xs(hoverI)} y1={M.t} y2={M.t + plotH} className="fhover" />
            {series.map(s => {
              const v = s.values[hoverI];
              if (v == null || !Number.isFinite(v)) return null;
              return (
                <circle key={s.label} cx={xs(hoverI)} cy={ys(v)} r={3.4}
                  fill={s.color} stroke="var(--card)" strokeWidth={1.2} />
              );
            })}
          </g>
        )}
        <rect
          x={M.l} y={M.t} width={plotW} height={plotH}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => onHover && onHover(null)}
        />
      </svg>
    </div>
  );
}
