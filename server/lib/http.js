// HTTP-hjälp för alla externa anrop. Samtliga exekteras i backend –
// nycklar/tokens lämnar aldrig processen och visas aldrig i frontend.
export const UA = () =>
  process.env.CONTACT
    ? `northwatch/0.1 (contact: ${process.env.CONTACT})`
    : 'northwatch/0.1 (contact: unset)';

export async function j(url, opt = {}) {
  const headers = { ...opt.headers };
  if (opt.noUA !== true) headers['User-Agent'] = UA();
  const r = await fetch(url, { ...opt, headers, signal: AbortSignal.timeout(opt.timeout ?? 20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).host}`);
  return r;
}

export const jjson = async (url, opt = {}) => (await j(url, opt)).json();
export const now = () => new Date().toISOString();
export const sleep = ms => new Promise(s => setTimeout(s, ms));
