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

function cleanTitle(title) {
  return (title || '')
    .replace(/<[^>]+>/g, '')   // strip any stray HTML
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchCategory(sources) {
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
    fetchCategory(FEEDS.geopolitics),
    fetchCategory(FEEDS.markets),
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
