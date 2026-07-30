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
const BLOCK = /\b(cricket|wicket|innings|rugby|tennis|wimbledon|nba|nfl|mlb|nhl|golf|olympic|boxing|\bufc\b|formula ?1|grand prix|premier league|\bfifa\b|marathon|actor|actress|celebrity|singer|songwriter|rapper|\balbum\b|box office|film review|netflix series|spider-man|royal family|prince |princess |wedding|horoscope|recipe|restaurant review|my (friend|husband|wife|son|daughter|children|kids|mother|father|mom|dad|parents|advis[eo]r|boyfriend|girlfriend|fianc\w+|family|sister|brother|in-laws?)|fair share|inheritance|estate plan|prenup|dear (moneyist|therapist|abby|prudence)|the moneyist|how (can|do|should) i\b|should i (buy|sell|invest|take|retire|claim)|i'm \d+|i am \d+|can i (afford|retire|claim)|my \d+-year)/i;

const ALLOW = {
  // "Global Politics" — prominent political figures, institutions (EU, NATO,
  // UN, governments), political processes (elections, diplomacy, sanctions),
  // and the major conflicts. Deliberately excludes generic crime/court stories.
  geopolitics: /\b(trump|biden|harris|\bvance\b|putin|zelensky\w*|xi jinping|netanyahu|starmer|macron|scholz|\bmerz\b|meloni|erdogan|\bmodi\b|orban|von der leyen|\blula\b|milei|kim jong|president\w*|prime minister|\bpm\b|chancellor|foreign minister|defen[cs]e secretary|secretary of state|\bsenator\b|congress\w*|\bsenate\b|parliament\w*|cabinet|\bminister\b|government|administration|white house|downing street|kremlin|brussels|capitol|\beu\b|european union|\bnato\b|united nations|security council|\bg7\b|\bg20\b|\bsummit\b|election\w*|referendum|\bballot\b|coalition|diplomat\w*|diplomacy|sanction\w*|\btreaty\b|\balliance\b|ceasefire|geopolit\w*|foreign policy|impeach\w*|legislation|regime|\bcoup\b|brexit|\btroops\b|\bmilitary\b|\bstrikes?\b|missile\w*|airstrike\w*|invasion|\bwar\b|russia\w*|ukrain\w*|iran\w*|israel\w*|\bgaza\b|taiwan\w*|north korea\w*|hamas|hezbollah|houthi\w*)/i,
  // "Markets" — real market movers (major indices / big companies), FX
  // (dollar, euro, pound, yen), central banks & rates, inflation prints, and
  // commodities. Tuned to exclude personal-finance advice columns.
  markets: /\b(stocks?\b|shares? (?:rose|fell|jump|jumped|slump|slumped|gain|gained|drop|dropped|surge|surged|sink|sank|tumble|tumbled|climb|climbed|slid|slide|rise|rally)|share price|shareholders?|equit\w*|wall street|s&p ?500|s&p|nasdaq|\bdow\b|dow jones|ftse|nikkei|\bdax\b|hang seng|sensex|stock (?:market|index|exchange)|\bindices\b|fed\b|federal reserve|central bank|\becb\b|\bboe\b|bank of england|european central bank|powell|lagarde|interest rate\w*|rate (?:cut|hike|rise|decision)|\brates\b|inflation|consumer price\w*|producer price\w*|wholesale price\w*|price index|\bcpi\b|\bppi\b|\bgdp\b|economic growth|stimulus|earnings|revenue\w*|profits?|record profit|\bipo\b|bond yields?|\byields?\b|treasur\w*|\bdollar\b|\beuro\b|\bpound\b|sterling|\byen\b|\byuan\b|currenc\w*|\bforex\b|exchange rate|\boil\b|crude|brent|\bwti\b|opec|\bgold\b|\bsilver\b|copper|commodit\w*|recession|jobless|payrolls?|unemployment|tariff\w*|trade war|\bbank\b|dividend\w*|\betf\b|\bfutures\b|selloff|sell-off|bull market|bear market|semiconductor\w*|\bchips?\b|monetary policy|market cap)/i,
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
