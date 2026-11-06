// HTTP-hjälp för alla externa anrop. Samtliga exekteras i backend –
// nycklar/tokens lämnar aldrig processen och visas aldrig i frontend.
// undicis fetch förkastar headervärden utanför Latin-1 (t.ex. tanstreck
// i .env.example:s CONTACT-mall) – mappa typografiska streck till
// bindestreck och strunta tecken ovanför U+00FF.
export const safeContact = s => String(s ?? '')
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/[^\x00-\xFF]/g, '');

export const UA = () =>
  process.env.CONTACT
    ? `northwatch/0.1 (contact: ${safeContact(process.env.CONTACT)})`
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
