// SMHI-kodmappning (M8): väderbildekod 1–27, nederbördsart 0–12,
// 16-ros-rosetten. Ren data – inget DOM.
import { test, expect, describe } from 'vitest';
import {
  SYMBOL_CODES, PTYPE_CODES, symbolLabel, ptypeLabel, compass, compassTowards,
} from './symbolCodes.js';

describe('symbolLabel', () => {
  test('alla 27 väderbildekoder har etikett', () => {
    for (let i = 1; i <= 27; i += 1) {
      expect(Object.prototype.hasOwnProperty.call(SYMBOL_CODES, i), `kod ${i}`).toBe(true);
      expect(symbolLabel(i)).toBe(SYMBOL_CODES[i]);
      expect(symbolLabel(String(i))).toBe(SYMBOL_CODES[i]); // strängkod ur JSON
    }
  });

  test('spot-checkar kända koder', () => {
    expect(symbolLabel(1)).toBe('Klart');
    expect(symbolLabel(7)).toBe('Dimma');
    expect(symbolLabel(11)).toBe('Åska');
    expect(symbolLabel(26)).toBe('Snöfall');
  });

  test('okänd kod → förklarande etikett; null/undefined → –', () => {
    expect(symbolLabel(0)).toBe('okänd väderkod 0');
    expect(symbolLabel(28)).toBe('okänd väderkod 28');
    expect(symbolLabel(null)).toBe('–');
    expect(symbolLabel(undefined)).toBe('–');
  });
});

describe('ptypeLabel', () => {
  test('alla 13 nederbördsarter (0–12) har etikett', () => {
    for (let i = 0; i <= 12; i += 1) {
      expect(Object.prototype.hasOwnProperty.call(PTYPE_CODES, i), `kod ${i}`).toBe(true);
      expect(ptypeLabel(i)).toBe(PTYPE_CODES[i]);
    }
  });

  test('spot-checkar kända koder', () => {
    expect(ptypeLabel(0)).toBe('Ingen nederbörd');
    expect(ptypeLabel(1)).toBe('Regn');
    expect(ptypeLabel(3)).toBe('Isaregn');
    expect(ptypeLabel(5)).toBe('Snö');
  });

  test('okänd kod → förklarande etikett; null → –', () => {
    expect(ptypeLabel(13)).toBe('okänd nederbördsart 13');
    expect(ptypeLabel(null)).toBe('–');
  });
});

describe('compass (16-ros, vindfrånriktning)', () => {
  test('rosens huvudriktningar', () => {
    expect(compass(0)).toBe('N');
    expect(compass(45)).toBe('NO');
    expect(compass(90)).toBe('O');
    expect(compass(135)).toBe('SO');
    expect(compass(180)).toBe('S');
    expect(compass(225)).toBe('SV');
    expect(compass(270)).toBe('V');
    expect(compass(315)).toBe('NV');
  });

  test('kantslättna: 359° → N, 360° → N, negativ rullas fram', () => {
    expect(compass(359)).toBe('N');
    expect(compass(360)).toBe('N');
    expect(compass(-45)).toBe('NV');
    expect(compass(11.25)).toBe('NNO'); // närmaste roten
  });

  test('ogiltig → – (inkl. null – Number(null) = 0 får inte bli N)', () => {
    expect(compass('abc')).toBe('–');
    expect(compass(null)).toBe('–');
    expect(compass(undefined)).toBe('–');
  });
});

describe('compassTowards', () => {
  test('vindriktning vänd mot +180: frän N → mot S, frän O → mot V', () => {
    expect(compassTowards(0)).toBe('S');
    expect(compassTowards(90)).toBe('V'); // östervind blåser mot väster
    expect(compassTowards(270)).toBe('O'); // västervind blåser mot öster
  });
});
