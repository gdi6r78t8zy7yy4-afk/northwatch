// Pollar varje källa med sitt interval (från API-katalogens förslag).
// Förstakörningen förskjuts stegvis så att vi inte slår alla externa
// tjänster samtidigt vid uppstart.
import { setResult, setError, setNoKey, state } from './store.js';

async function run(c) {
  const s = state.sources.get(c.id);
  if (c.need && !process.env[c.need]) { setNoKey(c.id, c.need); return; }
  const t = Date.now();
  try {
    const records = await c.fetch();
    if (!Array.isArray(records)) throw new Error('collector returnerade inte en lista');
    setResult(c.id, records, Date.now() - t);
  } catch (e) {
    setError(c.id, e, Date.now() - t);
  }
}

export function startScheduler(collectors) {
  collectors.forEach((c, i) => {
    setTimeout(() => {
      run(c);
      const loop = () => { run(c).finally(() => setTimeout(loop, c.every * 1000)); };
      setTimeout(loop, 25000);
    }, Math.min(i * 2000, 20000));
  });
}
