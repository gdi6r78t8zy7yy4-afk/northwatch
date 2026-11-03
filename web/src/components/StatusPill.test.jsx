// StatusPill (M6): etikett + klass per status, med fallback för okänd.
import { test, expect, describe } from 'vitest';
import { render } from '@testing-library/react';
import StatusPill from './StatusPill.jsx';

const CASES = [
  ['ok', 'OK', 'st-ok'],
  ['stale', 'Föråldrad', 'st-warn'],
  ['no_key', 'Saknar nyckel', 'st-warn'],
  ['error', 'Fel', 'st-err'],
  ['running', 'Hämtar…', 'st-mut'],
  ['none', 'Ingen källa', 'st-none'],
];

describe('StatusPill', () => {
  for (const [status, label, cls] of CASES) {
    test(`${status} → ${label} (${cls})`, () => {
      const { container } = render(<StatusPill status={status} />);
      expect(container.firstChild).toHaveClass(cls);
      expect(container.firstChild).toHaveTextContent(label);
    });
  }

  test('okänd status → Hämtar…-fallback', () => {
    const { container } = render(<StatusPill status="okänd" />);
    expect(container.firstChild).toHaveClass('st-mut');
    expect(container.firstChild).toHaveTextContent('Hämtar…');
  });
});
