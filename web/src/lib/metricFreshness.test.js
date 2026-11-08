import { describe, expect, test } from 'vitest';
import { formatObservationAge } from './metricFreshness.js';

describe('formatObservationAge', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');

  test('formats recent observations in minutes', () => {
    expect(formatObservationAge('2026-11-07T11:57:00.000Z', now)).toBe('3m ago');
    expect(formatObservationAge('2026-11-07T12:00:00.000Z', now)).toBe('just now');
  });

  test('formats older observations with hours and days', () => {
    expect(formatObservationAge('2026-11-07T09:30:00.000Z', now)).toBe('2h 30m ago');
    expect(formatObservationAge('2026-11-05T10:00:00.000Z', now)).toBe('2d 2h ago');
  });

  test('does not silently clamp future timestamps', () => {
    expect(formatObservationAge('2026-11-07T12:03:00.000Z', now)).toBe('3 min ahead');
    expect(formatObservationAge('2026-11-07T13:01:00.000Z', now)).toBe('1h 1m ahead');
    expect(formatObservationAge('2026-11-08T14:00:00.000Z', now)).toBe('1d 2h ahead');
  });

  test('handles missing and invalid timestamps', () => {
    expect(formatObservationAge(null, now)).toBe('age unavailable');
    expect(formatObservationAge('not-a-date', now)).toBe('age unavailable');
  });
});
