// Pollar varje källa med sitt interval (från API-katalogens förslag).
// Förstakörningen förskjuts stegvis så att vi inte slår alla externa
// tjänster samtidigt vid uppstart.
import { setResult, setError, setNoKey, state } from './store.js';

// setTimeout kan inte representera mer än 2^31-1 ms; Node clampar annars
// tiden till 1 ms och källan pollaras back-to-back i stället för med sin
// takt. Månadstakter (2 592 000 s) kläms därför till ~24,9 d.
const MAX_TIMEOUT_MS = 2147483647;

async function run(c) {
  const s = state.sources.get(c.id);
  // need kan vara ett env-namn eller en lista (svk.js/svk-hist.js har varsin
  // lista med resource-id:n); saknas något visas källan "Saknar …".
  const missing = (Array.isArray(c.need) ? c.need : [c.need])
    .filter(Boolean)
    .filter(n => !process.env[n]);
  if (missing.length) { setNoKey(c.id, missing.join(', ')); return; }
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
      const delay = Math.min(c.every * 1000, MAX_TIMEOUT_MS);
      const loop = () => { run(c).finally(() => setTimeout(loop, delay)); };
      setTimeout(loop, 25000);
    }, Math.min(i * 2000, 20000));
  });
}
