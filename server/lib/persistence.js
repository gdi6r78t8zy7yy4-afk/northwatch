import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = () => process.env.NORTHWATCH_STORE_FILE || path.join(moduleDir, '..', 'data', 'store.json');
const historyPath = () => process.env.NORTHWATCH_ENERGY_HISTORY_FILE || path.join(moduleDir, '..', 'data', 'energy-history.jsonl');
const historyId = record => createHash('sha256')
  .update([record.source, record.indicator, record.ts].join('|')).digest('hex').slice(0, 40);
const utcDay = value => new Date(value).toISOString().slice(0, 10);

function createLocalPersistence() {
  let sources = new Map();
  let writeQueue = Promise.resolve();
  let warning = null;
  let historyLoaded = false;
  const history = new Map();
  const flush = () => writeQueue;
  async function loadEnergyMeasurements({ from, to } = {}) {
    if (!historyLoaded) {
      try {
        const raw = await fs.readFile(historyPath(), 'utf8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try { const item = JSON.parse(line); if (item?.id && item.record) history.set(item.id, item.record); } catch { /* ignore a partial final line */ }
        }
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      historyLoaded = true;
    }
    return [...history.values()].filter(r => (!from || r.ts >= from) && (!to || r.ts <= to));
  }
  function saveEnergyMeasurements(records) {
    const fresh = [];
    for (const record of records) {
      const id = historyId(record);
      if (history.has(id)) continue;
      const item = { id, record };
      history.set(id, record); fresh.push(JSON.stringify(item));
    }
    if (!fresh.length) return writeQueue;
    const target = historyPath();
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.appendFile(target, fresh.join('\n') + '\n', { mode: 0o600 });
    }).catch(error => {
      warning = String(error?.message ?? error);
      console.error('[store] local energy history failed:', warning);
    });
    return writeQueue;
  }
  function saveSource(source) {
    sources.set(source.id, source);
    const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), sources: [...sources.values()] });
    const target = sourcePath();
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temp, payload, { mode: 0o600 });
      await fs.rename(temp, target);
      warning = null;
    }).catch(error => {
      warning = String(error?.message ?? error);
      console.error('[store] local persistence failed:', warning);
    });
    return writeQueue;
  }
  return { loadSources, saveSource, loadEnergyMeasurements, saveEnergyMeasurements, flush, get warning() { return warning; }, driver: 'local' };
}

function createFirestorePersistence() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  const collection = process.env.FIRESTORE_COLLECTION || 'northwatch_sources';\n  const historyCollection = process.env.FIRESTORE_ENERGY_HISTORY_COLLECTION || 'northwatch_energy_history';
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT (or FIREBASE_PROJECT_ID) is required for STORE_DRIVER=firestore');
  const base = emulator
    ? `http://${emulator.replace(/^https?:\/\//, '')}/v1/projects/${projectId}/databases/${databaseId}/documents`
    : `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
  let tokenCache = { value: null, expiresAt: 0 };
  let writeQueue = Promise.resolve();
  let warning = null;

  async function accessToken() {
    if (emulator) return null;
    if (process.env.FIRESTORE_ACCESS_TOKEN) return process.env.FIRESTORE_ACCESS_TOKEN;
    if (tokenCache.value && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.value;
    try {
      const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error(`Google metadata token request failed: HTTP ${response.status}`);
      const body = await response.json();
      tokenCache = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 300) * 1000 };
      return tokenCache.value;
    } catch {
      return null;
    }
  }

  async function request(method, resource, body) {
    const token = await accessToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const apiKey = process.env.FIREBASE_API_KEY;
    let url = `${base}/${resource}`;
    if (!token && apiKey) {
      url += (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(apiKey)}`;
    }
    const response = await fetch(url, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(`Firestore REST ${method} ${resource}: HTTP ${response.status} ${detail}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  const docName = id => `${collection}/${encodeURIComponent(id)}`;
  const fieldPayload = value => ({ fields: { payload: { stringValue: JSON.stringify(value) } } });
  const readPayload = doc => {
    const raw = doc?.fields?.payload?.stringValue;
    return raw ? JSON.parse(raw) : null;
  };
  async function listDocuments(pathName) {
    const all = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ pageSize: '1000' });
      if (pageToken) query.set('pageToken', pageToken);
      const result = await request('GET', `${pathName}?${query}`);
      all.push(...(result.documents || []));
      pageToken = result.nextPageToken || '';
    } while (pageToken);
    return all;
  }
  async function deleteSnapshot(sourceId, snapshotId) {
    if (!snapshotId) return;
    const prefix = `${docName(sourceId)}/snapshots/${snapshotId}/chunks`;
    const docs = await listDocuments(prefix);
    for (const doc of docs) {
      const name = doc.name.split('/documents/')[1];
      await request('DELETE', name);
    }
    await request('DELETE', `${docName(sourceId)}/snapshots/${snapshotId}`).catch(() => {});
  }
  async function loadSources() {
    const docs = await listDocuments(collection);
    const result = [];
    for (const doc of docs) {
      const meta = readPayload(doc);
      if (!meta) continue;
      const id = doc.name.split('/').pop();
      const source = { ...meta, id, records: [] };
      if (meta.activeSnapshotId) {
        const chunks = await listDocuments(`${docName(id)}/snapshots/${meta.activeSnapshotId}/chunks`);
        chunks.sort((a, b) => Number(a.name.split('/').pop()) - Number(b.name.split('/').pop()));
        for (const chunk of chunks) {
          const records = readPayload(chunk);
          if (Array.isArray(records)) source.records.push(...records);
        }
      }
      result.push(source);
    }
    return result;
  }
  async function loadEnergyMeasurements({ from, to } = {}) {
    const start = new Date(from || Date.now() - 24 * 3600 * 1000);
    const end = new Date(to || Date.now());
    const days = [];
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
    const records = [];
    for (const day of days) {
      const docs = await listDocuments(`${historyCollection}/${day}/measurements`);
      for (const doc of docs) {
        const record = readPayload(doc);
        if (record && (!from || record.ts >= from) && (!to || record.ts <= to)) records.push(record);
      }
    }
    return records;
  }
  async function saveEnergyMeasurements(records) {
    for (const record of records) {
      const day = utcDay(record.ts);
      const id = historyId(record);
      await request('PATCH', `${historyCollection}/${day}/measurements/${id}`, fieldPayload(record));
    }
  }
  async function saveSource(source) {
    const snapshotId = randomUUID();
    const records = Array.isArray(source.records) ? source.records : [];
    // Keep each Firestore document comfortably below its 1 MiB document limit.
    let chunk = [], bytes = 2, chunks = [];
    for (const record of records) {
      const encoded = JSON.stringify(record);
      const size = Buffer.byteLength(encoded, 'utf8') + 1;
      if (size > 450_000) throw new Error(`Firestore record for source ${source.id} exceeds the 450 kB snapshot chunk limit`);
      if (chunk.length && bytes + size > 450_000) {
        chunks.push(chunk); chunk = []; bytes = 2;
      }
      chunk.push(record); bytes += size;
    }
    if (chunk.length || chunks.length === 0) chunks.push(chunk);

    const previousDoc = await request('GET', docName(source.id)).catch(error => {
      if (String(error.message).includes('HTTP 404')) return null;
      throw error;
    });
    const previous = readPayload(previousDoc)?.activeSnapshotId;
    const snapshotRoot = `${docName(source.id)}/snapshots/${snapshotId}`;
    for (let i = 0; i < chunks.length; i++) {
      await request('PATCH', `${snapshotRoot}/chunks/${String(i).padStart(6, '0')}`, fieldPayload(chunks[i]));
    }
    const { records: _records, ...meta } = source;
    await request('PATCH', docName(source.id), fieldPayload({ ...meta, activeSnapshotId: snapshotId }));
    // The new pointer is committed before deleting the old snapshot.
    if (previous && previous !== snapshotId) await deleteSnapshot(source.id, previous);
  }
  function queueSave(source) {
    writeQueue = writeQueue.then(async () => {
      await saveSource(source);
      warning = null;
    });
    writeQueue = writeQueue.catch(error => {
      warning = String(error?.message ?? error);
      console.error('[store] Firestore persistence failed:', error);
    });
    return writeQueue;
  }
  return { loadSources, saveSource: queueSave, loadEnergyMeasurements, saveEnergyMeasurements: records => { writeQueue = writeQueue.then(() => saveEnergyMeasurements(records)).catch(error => { warning = String(error?.message ?? error); console.error('[store] Firestore energy history failed:', error); }); return writeQueue; }, flush: () => writeQueue, get warning() { return warning; }, driver: 'firestore' };
}

export function createPersistence() {
  const driver = (process.env.STORE_DRIVER || 'local').toLowerCase();
  if (driver === 'firestore') return createFirestorePersistence();
  if (driver !== 'local') throw new Error(`Unsupported STORE_DRIVER: ${driver}`);
  return createLocalPersistence();
}
