// Generisk OpenAI-kompatibel chatt-client (LM Studio, Ollama m.fl.) för
// områdets sammanfattningar. HELT VALFRI: utan LLM_BASE_URL är funktionen
// avstängd och returnerar null – inga nätverksanrop sker då, aldrig i tester.
// Modellstandard qwen3.8-flash-next (LLM_MODEL). In-memory-cache per prompt
// så att en pollande frontend inte slår på modellen varje gång.
const cache = new Map(); // key → { summary, at }

export const llmEnabled = () => !!process.env.LLM_BASE_URL;

export async function llmSummarize(prompt, opt = {}) {
  if (!llmEnabled()) return null;
  const model = opt.model ?? process.env.LLM_MODEL ?? 'qwen3.8-flash-next';
  const ttlMs = opt.ttlMs ?? 15 * 60_000;
  const key = `${model}\u0000${prompt}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.summary;

  try {
    const r = await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Du skriver korta, sakliga svenska statusrapporter för en nordisk rymd- och GNSS-dashboard. 2–3 meningar, inga rubriker.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 180,
      }),
      signal: AbortSignal.timeout(opt.timeoutMs ?? 20000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const summary = String(data?.choices?.[0]?.message?.content ?? '').trim();
    if (!summary) throw new Error('tomt svar');
    cache.set(key, { summary, at: Date.now() });
    return summary;
  } catch {
    return null; // modellen är en berikelse – misslyckad eller frånvarande LLM
    // gör aldrig en route fel; anroparen faller tillbaka på deterministisk text.
  }
}
