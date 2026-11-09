// GSC – European GNSS Service Centre (område 10). Två öppna ytor utan nyckel:
//   RSS https://www.gsc-europa.eu/rss.xml → NAGU-poster ("NOTICE ADVISORY TO
//     GALILEO USERS (NAGU) 2026047") med strukturerade fält i description:
//       NAGU TYPE / NAGU NUMBER / NAGU SUBJECT / START DATE EVENT (UTC) /
//       END DATE EVENT (UTC) / SATELLITE AFFECTED
//   HTML https://www.gsc-europa.eu/system-service-status/constellation-information
//     → tabell Satellite Name | SV ID | Clock | Status | Active NAGU | …
// Verifierat 2026-11-09: RSS 10 items (varav NAGU med fält), konstellationssidan
// ~30 GSAT-rader ("GSAT0101 E11 RAFS USABLE", "… PHM NOT USABLE 2021008 …").
// Ingen parser-beroende: regex + entityavkodning (ytan är Drupal-RSS med HTML i
// description). Tabellparsningen pinns av fixturetestet – ytan är skör.
import { j, now } from '../lib/http.js';

const RSS_URL = 'https://www.gsc-europa.eu/rss.xml';
const CONST_URL = 'https://www.gsc-europa.eu/system-service-status/constellation-information';

export const unescapeHtml = s => String(s ?? '')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const stripTags = s => unescapeHtml(s).replace(/<[^>]*>/g, ' ');

// "2026-11-02 13:41" → ISO (UTC); null för N/A/tomma.
export const eventTime = v => {
  const m = String(v ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}Z` : null;
};

// NAGU-fälten ur en item-block (raw XML). Returnerar null om blocket inte är en NAGU.
export const parseNagu = rawItem => {
  const titleM = String(rawItem.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  const numM = unescapeHtml(titleM).match(/\(NAGU\)\s*(\d{7})/);
  if (!numM) return null;
  const descRaw = String(rawItem.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '');
  // Block-element (p/div/li/br) → radbrytning innan taggarna stryks, så att
  // fälten inte rinner ihop till en rad (Drupal-RSS blandar <br> och <p>).
  const text = unescapeHtml(descRaw)
    .replace(/<\/?(?:p|div|li|ul|ol|h\d)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  const field = name => {
    const m = text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const start = eventTime(field('START DATE EVENT \\(UTC\\)'));
  if (!start) return null;
  const endRaw = field('END DATE EVENT \\(UTC\\)');
  const end = /N\/?A/i.test(endRaw) ? null : eventTime(endRaw);
  const subject = field('NAGU SUBJECT');
  const type = field('NAGU TYPE');
  const sat = field('SATELLITE AFFECTED');
  // Återställda/testade avbrott är information; pågående eller okända är varning.
  const resolved = /RECOVERED|TEST|USABLE AS FROM/i.test(`${subject} ${type}`); // "USABLE AS FROM" = satellit tillbaka i drift
  return {
    number: numM[1], type, subject, start, end,
    satellite: sat && !/^N\/?A$/i.test(sat) ? sat : null,
    severity: resolved ? 'info' : 'warn',
    link: String(rawItem.match(/<link>(\S+)<\/link>/)?.[1] ?? '').trim(),
  };
};

// Konstellationstabellen (HTML) → [{name, svId, clock, usable, nagu}]
export const parseConstellation = html => {
  const rows = String(html ?? '').match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? [];
  const out = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => stripTags(m[1]).replace(/\s+/g, ' ').trim());
    if (!cells.length || !/^GSAT\d{4}$/i.test(cells[0])) continue;
    const status = cells.slice(3).join(' ');
    out.push({
      name: cells[0].toUpperCase(),
      svId: cells[1] ?? null,
      clock: (cells[2] ?? '').toUpperCase() || null,
      usable: !/NOT USABLE/i.test(status),
      nagu: cells.slice(4).join(' ').match(/\b(\d{7})\b/)?.[1] ?? null,
    });
  }
  return out;
};

export default {
  id: 'gsc-europa',
  name: 'GSC – Galileo NAGU och konstellationsstatus',
  area: 10,
  country: 'NORDIC',
  every: 900,
  fetch: async () => {
    const ts = now();
    const [rssRes, constRes] = await Promise.all([
      j(RSS_URL, { headers: { Accept: 'application/rss+xml, application/xml' }, timeout: 30000 }),
      j(CONST_URL, { timeout: 30000 }),
    ]);
    const [rss, html] = await Promise.all([rssRes.text(), constRes.text()]);

    const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
    const nagus = items.map(parseNagu).filter(Boolean);
    if (!nagus.length && !/<title>/.test(rss)) throw new Error('GSC-RSS saknade poster');

    const records = [];
    for (const n of nagus) {
      records.push({
        t: 'e', area: 10, country: 'NORDIC', source: 'gsc-europa',
        kind: 'nagu', severity: n.severity,
        title: `NAGU ${n.number}: ${n.subject || n.type}`.slice(0, 200),
        detail: [
          n.type && `Typ: ${n.type}`,
          n.satellite && `Satellit: ${n.satellite}`,
          `Start: ${n.start}${n.end ? ` · Slut: ${n.end}` : ' · pågående'}`,
        ].filter(Boolean).join(' · '),
        start: n.start, end: n.end ?? undefined, ref: n.number, url: n.link || undefined,
      });
    }

    const sv = parseConstellation(html);
    if (sv.length) {
      const usable = sv.filter(s => s.usable).length;
      records.push(
        { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Galileo-satelliter i konstellationen', value: sv.length, unit: 'st', ts },
        { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Galileo-satelliter tillgängliga (USABLE)', value: usable, unit: 'st', ts },
        { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Andel tillgängliga Galileo-satelliter', value: Math.round(usable / sv.length * 1000) / 10, unit: '%', ts },
        { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Galileo-satelliter med fast atomur (PHM)', value: sv.filter(s => s.clock === 'PHM').length, unit: 'st', ts },
        { t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Aktiva NAGU (konstellationssidan)', value: sv.filter(s => s.nagu).length, unit: 'st', ts },
      );
    } else {
      records.push({ t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Konstellationstabell (GSC)', value: null, unit: '', ts });
    }

    const active = nagus.filter(n => !n.end || Date.parse(n.end) > Date.now());
    records.push({ t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Rapporterade NAGU i feeden', value: nagus.length, unit: 'st', ts });
    records.push({ t: 'm', area: 10, country: 'NORDIC', source: 'gsc-europa', indicator: 'Pågående/öppna NAGU (feed)', value: active.length, unit: 'st', ts });
    return records;
  },
};
