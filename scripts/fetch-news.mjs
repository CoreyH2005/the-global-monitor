// Fetches real headlines from a curated list of RSS feeds and writes
// data/news.json, which index.html reads at page load.
//
// Run manually with:  node scripts/fetch-news.mjs
// Run automatically by: .github/workflows/update-news.yml (every 6 hours)
//
// To add or remove a source: edit the FEEDS object below. Each entry needs
// a "name" (shown on the site as the source credit) and a "url" (the RSS
// feed itself). Nothing else needs to change — the script treats every
// feed in a category the same way.

import Parser from 'rss-parser';
import { writeFile, mkdir } from 'node:fs/promises';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'TheGlobalMonitor/1.0 (+https://github.com/)' },
});

const FEEDS = {
  geopolitics: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'CNBC World', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  ],
  markets: [
    { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
    { name: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
    { name: 'CNBC Markets', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  ],
};

const ITEMS_PER_CATEGORY = 8;

// --- Relevance filtering ------------------------------------------------
// The source feeds are broad (Al Jazeera's feed carries sport, culture and
// human-interest; MarketWatch carries personal-finance advice columns), so
// each headline is filtered twice before it can appear on the site:
//   1. BLOCK  — drop anything that is clearly sport / entertainment / fluff.
//   2. ALLOW  — keep only headlines that contain a keyword relevant to the
//               category (geopolitics or markets). Anything that matches
//               neither is treated as off-topic and dropped.
// To loosen or tighten the feed, edit these expressions.
const BLOCK = /\b(cricket|wicket|innings|batsman|bowler|\bt20\b|\bodi\b|rugby|tennis|wimbledon|nba|nfl|mlb|nhl|golf|\bpga\b|olympic|boxing|\bufc\b|\bmma\b|formula ?1|grand prix|premier league|la liga|marathon|gymnast|actor|actress|celebrity|singer|rapper|\balbum\b|box office|film review|netflix series|royal family|prince |princess |duchess|dating app|wedding|horoscope|recipe|restaurant review|sells (his|her|their)[^.]*home|my adviser|was i (lucky|right)|should i buy|dear (moneyist|tax)|i'm \d+ (and|with))\b/i;

const ALLOW = {
  geopolitics: /\b(?:war(?:s|fare|time)?|militar\w*|troops?|missiles?|strikes?|airstrikes?|sanctions?|elections?|presidents?|prime ministers?|ministers?|govern\w*|regimes?|coup|borders?|nuclear|diploma\w*|nato|united nations|treaty|treaties|ceasefires?|conflicts?|invasions?|invaded?|occupations?|protests?|uprisings?|insurgen\w*|militias?|terror\w*|hostages?|refugees?|geopolit\w*|tensions?|ambassadors?|parliament\w*|senate|congress|tariffs?|sovereign\w*|annex\w*|referend\w*|drones?|army|armies|navy|air force|defen[cs]e\w*|weapons?|arms|espionage|spy(?:ing)?|spies|iran\w*|israel\w*|gaza|ukrain\w*|russia\w*|chinese|china|taiwan\w*|north korea\w*|hamas|hezbollah|houthi\w*|kremlin|pentagon|white house|beijing|moscow|tehran|kyiv|zelensky\w*|netanyahu|putin)\b/i,
  markets: /\b(?:stocks?|shares?|equit\w*|markets?|wall street|s&p|nasdaq|dow|ftse|nikkei|indices|index(?:es|ed)?|fed|federal reserve|central banks?|interest rates?|rates?|inflation\w*|deflation|cpi|ppi|gdp|earnings|revenues?|profits?|guidance|ipo|bonds?|yields?|treasur\w*|dollars?|euros?|yen|currenc\w*|forex|oil|crude|brent|wti|opec|gold|commodit\w*|recession\w*|jobless|payrolls?|unemployment|jobs?|tariffs?|trade\w*|econom\w*|banks?|lending|credit|debts?|defaults?|mergers?|acquisitions?|buybacks?|dividends?|etfs?|futures|hedge funds?|valuations?|selloffs?|sell-offs?|rall(?:y|ies)|bull\w*|bear market|monetary|fiscal|semiconductors?|chips?|prices?|growth|stimulus|imports?|exports?|ecb|boe)\b/i,
};

function isRelevant(title, category) {
  if (!title) return false;
  if (BLOCK.test(title)) return false;
  const allow = ALLOW[category];
  return allow ? allow.test(title) : true;
}

function cleanTitle(title) {
  return (title || '')
    .replace(/<[^>]+>/g, '')   // strip any stray HTML
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchCategory(sources, category) {
  const results = await Promise.allSettled(
    sources.map(async (src) => {
      const feed = await parser.parseURL(src.url);
      return (feed.items || []).map((item) => ({
        title: cleanTitle(item.title),
        link: item.link,
        source: src.name,
        publishedAt: item.isoDate || item.pubDate || null,
      }));
    })
  );

  const items = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      console.error('Feed failed:', r.reason?.message || r.reason);
    }
  }

  // Dedupe by link, drop anything with no title/link, sort newest first
  const seen = new Set();
  const deduped = items.filter((it) => {
    if (!it.title || !it.link) return false;
    if (seen.has(it.link)) return false;
    seen.add(it.link);
    if (!isRelevant(it.title, category)) return false;
    return true;
  });

  deduped.sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return db - da;
  });

  return deduped.slice(0, ITEMS_PER_CATEGORY);
}

async function main() {
  const [geopolitics, markets] = await Promise.all([
    fetchCategory(FEEDS.geopolitics, 'geopolitics'),
    fetchCategory(FEEDS.markets, 'markets'),
  ]);

  if (geopolitics.length === 0 && markets.length === 0) {
    console.error('All feeds failed — leaving the existing data/news.json in place rather than overwriting it with nothing.');
    process.exitCode = 1;
    return;
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    geopolitics,
    markets,
  };

  await mkdir('data', { recursive: true });
  await writeFile('data/news.json', JSON.stringify(payload, null, 2) + '\n', 'utf-8');

  console.log(`Wrote data/news.json — ${geopolitics.length} geopolitics, ${markets.length} markets items.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
