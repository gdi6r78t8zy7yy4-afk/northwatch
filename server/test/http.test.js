// Enhetstester för lib/http.js – User-Agent-skydd (funnet i live-smoke
// 2026-11-06): undicis fetch kastar "Cannot convert argument to a
// ByteString" för headervärden utanför Latin-1, och .env.example:s
// CONTACT-mall innehåller ett tanstreck (U+2013) → alla externa anrop
// hade kunnat 500:a. safeContact() sanifierar; UA() och de tre
// Digitraffic-kollektoners Digitraffic-User-header byggd på den.
//
// Kör: node --test "server/test/http.test.js"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UA, safeContact } from '../lib/http.js';

test('safeContact mappar typografiska streck till bindestreck', () => {
  // .env.example-mallen: "Er Namn – Northwatch (contact: ni@example.org)"
  assert.equal(
    safeContact('Er Namn – Northwatch (contact: ni@example.org)'),
    'Er Namn - Northwatch (contact: ni@example.org)',
  );
  // Övriga typografiska streck (U+2010…U+2015) samma behandling.
  for (let cp = 0x2010; cp <= 0x2015; cp += 1) {
    const d = String.fromCodePoint(cp);
    assert.equal(safeContact(`a${d}b`), 'a-b', `streck U+${cp.toString(16)}`);
  }
});

test('safeContact behåller Latin-1 (svenska tecken) och struntar övrigt', () => {
  assert.equal(safeContact('Åsa Lindqvist – Nordö'), 'Åsa Lindqvist - Nordö');
  // Emoji/CJK (utanför U+00FF) tas bort – headervärdet ska alltid bli
  // ByteString-säkert för undici.
  assert.equal(safeContact('Carl 😀 北'), 'Carl  ');
  assert.equal(safeContact(undefined), '');
  assert.ok([...safeContact('Åsa – 😀')].every(c => c.codePointAt(0) <= 0xff));
});

test('UA är Latin-1-säker även med .env.example-mallens tanstreck', () => {
  const prev = process.env.CONTACT;
  try {
    process.env.CONTACT = 'Er Namn – Northwatch (contact: ni@example.org)';
    const ua = UA();
    assert.ok(ua.startsWith('northwatch/0.1 (contact: '));
    assert.ok(ua.includes('Er Namn - Northwatch'));
    // Precis den egenskap undici kräver för fetch-headers.
    for (const c of ua) assert.ok(c.charCodeAt(0) <= 0xff, `icke-Latin-1: ${c}`);
    // fetch-moten: bygg ett reellt headerobjekt (kastar vid ogiltigt).
    const headers = new Headers({ 'User-Agent': ua });
    assert.equal(headers.get('user-agent'), ua);
  } finally {
    if (prev === undefined) delete process.env.CONTACT;
    else process.env.CONTACT = prev;
  }
});

test('UA utan CONTACT faller tillbaka på kontaktlös markerad', () => {
  const prev = process.env.CONTACT;
  delete process.env.CONTACT;
  try {
    assert.equal(UA(), 'northwatch/0.1 (contact: unset)');
  } finally {
    if (prev !== undefined) process.env.CONTACT = prev;
  }
});
