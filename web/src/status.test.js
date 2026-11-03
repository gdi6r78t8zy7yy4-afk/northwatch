// Enhetstester för gemensam statusmodell och formathjälpare (M6).
import { test, expect } from 'vitest';
import { STATUS, statusMeta, CELL_BG, COUNTRY_NAMES, fmtTime, fmtAge } from './status.js';

test('statusMeta ger etikett + klass för alla kända statusar', () => {
  expect(statusMeta('ok')).toEqual({ label: 'OK', cls: 'st-ok' });
  expect(statusMeta('stale')).toEqual({ label: 'Föråldrad', cls: 'st-warn' });
  expect(statusMeta('no_key')).toEqual({ label: 'Saknar nyckel', cls: 'st-warn' });
  expect(statusMeta('error')).toEqual({ label: 'Fel', cls: 'st-err' });
  expect(statusMeta('none')).toEqual({ label: 'Ingen källa', cls: 'st-none' });
});

test('statusMeta fallerar till Hämtar… för okänd status', () => {
  expect(statusMeta('vitsenlig')).toEqual(STATUS.running);
  expect(statusMeta(undefined)).toEqual(STATUS.running);
});

test('CELL_BG har värmefärg för varje status', () => {
  for (const key of Object.keys(STATUS)) {
    expect(CELL_BG[key]).toMatch(/^var\(--/);
  }
});

test('COUNTRY_NAMES täcker alla dashboardländer + gemensamma', () => {
  for (const code of ['SE', 'NO', 'DK', 'FI', 'IS', 'NORDIC', 'ALL']) {
    expect(COUNTRY_NAMES[code]).toBeTruthy();
  }
});

test('fmtTime: tomt värde → –, ogiltigt datum som-is, giltigt → sv-format', () => {
  expect(fmtTime(null)).toBe('–');
  expect(fmtTime(0)).toBe('–');
  expect(fmtTime('helt-ogiltigt')).toBe('helt-ogiltigt');
  const out = fmtTime(Date.now());
  expect(out).not.toBe('–');
  expect(out).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/); // dd/mm HH:MM (sv-SE)
});

test('fmtAge: nyss / min / h / d-bunkar', () => {
  expect(fmtAge(null)).toBe('');
  expect(fmtAge(Date.now() - 30_000)).toBe('nyss');
  expect(fmtAge(Date.now() - 10 * 60_000)).toBe('10 min sedan');
  expect(fmtAge(Date.now() - 3 * 3_600_000)).toBe('3 h sedan');
  expect(fmtAge(Date.now() - 2 * 86_400_000)).toBe('2 d sedan');
});
