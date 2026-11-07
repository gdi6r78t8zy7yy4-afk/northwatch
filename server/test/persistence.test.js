import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence } from '../lib/persistence.js';

test('createPersistence kastar vid ogiltig STORE_DRIVER', () => {
  const prev = process.env.STORE_DRIVER;
  process.env.STORE_DRIVER = 'redis-invalid';
  try {
    assert.throws(() => createPersistence(), /Unsupported STORE_DRIVER: redis-invalid/);
  } finally {
    if (prev === undefined) delete process.env.STORE_DRIVER;
    else process.env.STORE_DRIVER = prev;
  }
});

test('createFirestorePersistence kastar om GOOGLE_CLOUD_PROJECT saknas', () => {
  const prevDriver = process.env.STORE_DRIVER;
  const prevProj = process.env.GOOGLE_CLOUD_PROJECT;
  const prevGCloud = process.env.GCLOUD_PROJECT;
  const prevFirebase = process.env.FIREBASE_PROJECT_ID;

  process.env.STORE_DRIVER = 'firestore';
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
  delete process.env.FIREBASE_PROJECT_ID;

  try {
    assert.throws(() => createPersistence(), /GOOGLE_CLOUD_PROJECT/);
  } finally {
    if (prevDriver === undefined) delete process.env.STORE_DRIVER;
    else process.env.STORE_DRIVER = prevDriver;
    if (prevProj !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevProj;
    if (prevGCloud !== undefined) process.env.GCLOUD_PROJECT = prevGCloud;
    if (prevFirebase !== undefined) process.env.FIREBASE_PROJECT_ID = prevFirebase;
  }
});

test('Firestore-adapter: chunking vid stora datamängder och städning av föregående snapshot', async () => {
  const prevDriver = process.env.STORE_DRIVER;
  const prevProj = process.env.GOOGLE_CLOUD_PROJECT;
  const prevToken = process.env.FIRESTORE_ACCESS_TOKEN;
  const realFetch = globalThis.fetch;

  process.env.STORE_DRIVER = 'firestore';
  process.env.GOOGLE_CLOUD_PROJECT = 'test-proj';
  process.env.FIRESTORE_ACCESS_TOKEN = 'mock-token';

  const mockDb = new Map(); // path -> payload
  const deleted = [];

  globalThis.fetch = async (urlStr, opt = {}) => {
    const url = new URL(urlStr);
    const method = opt.method || 'GET';
    const cleanPath = url.pathname.replace(/^\/v1\/projects\/test-proj\/databases\/\(default\)\/documents\/?/, '');

    if (method === 'GET') {
      if (mockDb.has(cleanPath)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: `projects/test-proj/databases/(default)/documents/${cleanPath}`, ...mockDb.get(cleanPath) }),
        };
      }
      // List query
      const prefix = cleanPath.split('?')[0];
      const matching = [];
      for (const [key, val] of mockDb.entries()) {
        if (key.startsWith(prefix + '/') && key.slice(prefix.length + 1).split('/').length === 1) {
          matching.push({ name: `projects/test-proj/databases/(default)/documents/${key}`, ...val });
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ documents: matching }),
      };
    }

    if (method === 'PATCH') {
      const body = JSON.parse(opt.body || '{}');
      mockDb.set(cleanPath, body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: `projects/test-proj/databases/(default)/documents/${cleanPath}`, ...body }),
      };
    }

    if (method === 'DELETE') {
      deleted.push(cleanPath);
      mockDb.delete(cleanPath);
      return { ok: true, status: 204, json: async () => null };
    }

    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  try {
    const persistence = createPersistence();
    assert.equal(persistence.driver, 'firestore');

    // Skapa en källa med många poster så att de delas upp i chunks (> 450 kB)
    const largeDesc = 'x'.repeat(150_000);
    const source = {
      id: 'svk',
      name: 'Svenska kraftnät',
      area: 1,
      country: 'SE',
      every: 60,
      status: 'ok',
      records: [
        { t: 'm', indicator: 'ind1', desc: largeDesc },
        { t: 'm', indicator: 'ind2', desc: largeDesc },
        { t: 'm', indicator: 'ind3', desc: largeDesc },
        { t: 'm', indicator: 'ind4', desc: largeDesc },
      ],
    };

    await persistence.saveSource(source);
    await persistence.flush();

    // Verifiera att chunks skapades
    const chunkPaths = [...mockDb.keys()].filter(k => k.includes('/chunks/'));
    assert.ok(chunkPaths.length >= 2, `Förväntade minst 2 chunks, fick ${chunkPaths.length}`);

    // Verifiera att loadSources kan rekonstruera alla poster
    const loaded = await persistence.loadSources();
    const svk = loaded.find(s => s.id === 'svk');
    assert.ok(svk);
    assert.equal(svk.records.length, 4);
    assert.equal(svk.records[0].indicator, 'ind1');
    assert.equal(svk.records[3].indicator, 'ind4');

    // Spara en ny snapshot och verifiera att föregående snapshot städas bort
    const prevSnapshotId = JSON.parse(mockDb.get('northwatch_sources/svk').fields.payload.stringValue).activeSnapshotId;
    await persistence.saveSource({ ...source, status: 'ok', records: [{ t: 'm', indicator: 'ind-new' }] });
    await persistence.flush();

    assert.ok(deleted.some(d => d.includes(prevSnapshotId)), 'Föregående snapshot raderades');
  } finally {
    globalThis.fetch = realFetch;
    if (prevDriver === undefined) delete process.env.STORE_DRIVER;
    else process.env.STORE_DRIVER = prevDriver;
    if (prevProj !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevProj;
    else delete process.env.GOOGLE_CLOUD_PROJECT;
    if (prevToken !== undefined) process.env.FIRESTORE_ACCESS_TOKEN = prevToken;
    else delete process.env.FIRESTORE_ACCESS_TOKEN;
  }
});

test('Firestore-adapter: sätter warning om en enskild post överskrider 450 kB', async () => {
  const prevDriver = process.env.STORE_DRIVER;
  const prevProj = process.env.GOOGLE_CLOUD_PROJECT;
  const prevToken = process.env.FIRESTORE_ACCESS_TOKEN;

  process.env.STORE_DRIVER = 'firestore';
  process.env.GOOGLE_CLOUD_PROJECT = 'test-proj';
  process.env.FIRESTORE_ACCESS_TOKEN = 'mock-token';

  try {
    const persistence = createPersistence();
    const hugeRecord = { t: 'm', indicator: 'huge', data: 'x'.repeat(460_000) };
    const source = { id: 'huge-src', area: 1, country: 'SE', records: [hugeRecord] };

    await persistence.saveSource(source);
    await persistence.flush();

    assert.ok(persistence.warning);
    assert.match(persistence.warning, /exceeds the 450 kB snapshot chunk limit/);
  } finally {
    if (prevDriver === undefined) delete process.env.STORE_DRIVER;
    else process.env.STORE_DRIVER = prevDriver;
    if (prevProj !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevProj;
    else delete process.env.GOOGLE_CLOUD_PROJECT;
    if (prevToken !== undefined) process.env.FIRESTORE_ACCESS_TOKEN = prevToken;
    else delete process.env.FIRESTORE_ACCESS_TOKEN;
  }
});
