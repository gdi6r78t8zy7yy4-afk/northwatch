// Prognosrutnät-rasterisering (M8): bbox, radordning (norr först trots
// roterat scanordning), 9999 → transparent, rampfärgning, null-kontrakt.
// jsdom saknar canvas → url blir fallback-dataURL; kontraktet som testas
// är bbox + pixels + parametrar, inte pixelart.
import { test, expect, describe } from 'vitest';
import { paintWxGrid, nowIndex, WX_RAMPS, MISSING } from './wxGrid.js';

// Rotat scan: syrra först – rad 0 i rasteret ska ändå vara norr (lat 60).
const COORDS = [[10, 58], [12, 58], [10, 60], [12, 60]];
const VALUES = [-30, 9999, 28, 9999];
const P = 'air_temperature';

describe('paintWxGrid', () => {
  test('null-kontrakt: icke-arrayer, tomma, lengths som inte stämmer', () => {
    expect(paintWxGrid(null, COORDS, P)).toBeNull();
    expect(paintWxGrid(VALUES, null, P)).toBeNull();
    expect(paintWxGrid('x', COORDS, P)).toBeNull();
    expect(paintWxGrid([], [], P)).toBeNull();
    expect(paintWxGrid(VALUES.slice(0, 3), COORDS, P)).toBeNull();
    // Inga giltiga koordinater alls → ingen bbox.
    expect(paintWxGrid([1], [[null, null]], P)).toBeNull();
  });

  test('bbox = [[s,v],[n,o]], rad 0 = norr även om scann startar i syd', () => {
    const res = paintWxGrid(VALUES, COORDS, P);
    expect(res.bbox).toEqual([[58, 10], [60, 12]]);
    // Cellstorlek: median-steg 2°; i 59°N är 2° longitud < en cell (cos) så
    // båda longituderna hamnar i kolumn 0 – kolumn 1 blir tom. W=2, H=2.
    expect([res.width, res.height]).toEqual([2, 2]);
    // Rad 0 (norr, 28°) = sista rampstoppet, rad 1 (syd, −30°) = första.
    expect(Array.from(res.pixels)).toEqual([
      142, 26, 79, 215, 0, 0, 0, 0,  // norr: 28° (#8e1a4f), 9999 → tom
      27, 66, 153, 215, 0, 0, 0, 0,  // syd: −30° (#1b4299), 9999 → tom
    ]);
  });

  test('9999 (missingValue) → transparenta pixlar', () => {
    const allMissing = paintWxGrid([9999, 9999, 9999, 9999], COORDS, P);
    expect(allMissing).not.toBeNull();
    expect(Array.from(allMissing.pixels)).toEqual(new Array(16).fill(0));
  });

  test('ramp: exakta stopp interpoleras linjärt mellan stoppen', () => {
    // −15° = mittemellan −30 (#1b4299) och −10 (#60a5e8) → [79,140,212].
    const mid = paintWxGrid([-15], [[10, 60]], P);
    expect(Array.from(mid.pixels)).toEqual([79, 140, 212, 215]);
    // 0° = exakt stopp.
    const zero = paintWxGrid([0], [[10, 60]], P);
    expect(Array.from(zero.pixels)).toEqual([244, 244, 244, 215]);
  });

  test('nederbörd använder sqrt-skala (låg 1 mm syns)', () => {
    const one = paintWxGrid([1], [[10, 60]], 'precipitation_amount_mean');
    expect(Array.from(one.pixels)).toEqual([188, 217, 240, 215]); // #bcd9f0
    const none = paintWxGrid([0], [[10, 60]], 'precipitation_amount_mean');
    expect(Array.from(none.pixels)).toEqual([242, 247, 251, 215]); // #f2f7fb
  });

  test('ogiltig parameter fallerar till temperaturrampen', () => {
    const res = paintWxGrid([28], [[10, 60]], 'helt_ogiltig_param');
    expect(res).not.toBeNull();
    expect(Array.from(res.pixels)).toEqual([142, 26, 79, 215]);
  });

  test('url är en PNG-dataURL (fallback i jsdom utan canvas)', () => {
    const res = paintWxGrid(VALUES, COORDS, P);
    expect(res.url).toMatch(/^data:image\/png;base64,/);
  });
});

describe('nowIndex', () => {
  const times = ['2026-11-05T10:00:00Z', '2026-11-05T11:00:00Z', '2026-11-05T12:00:00Z'];

  test('första steget som är nu eller senare', () => {
    expect(nowIndex(times, new Date('2026-11-05T10:00:00Z'))).toBe(0); // exakt nu
    expect(nowIndex(times, new Date('2026-11-05T10:30:00Z'))).toBe(1);
  });

  test('allt i det förflutna → sista steget', () => {
    expect(nowIndex(times, new Date('2026-11-05T23:59:00Z'))).toBe(2);
  });
});

describe('WX_RAMPS (kartlegenden)', () => {
  test('alla fyra rutnätsparametrarna har etikett, gradient och skala', () => {
    for (const p of [
      'air_temperature', 'wind_speed_of_gust',
      'precipitation_amount_mean', 'probability_of_precipitation',
    ]) {
      const r = WX_RAMPS[p];
      expect(r, p).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.css).toMatch(/^linear-gradient/);
      expect(Number.isFinite(r.min)).toBe(true);
      expect(Number.isFinite(r.max)).toBe(true);
    }
  });

  test('MISSING är SMHIs missingValue 9999', () => {
    expect(MISSING).toBe(9999);
  });
});
