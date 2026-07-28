# The Global Monitor — Claude Design version, with live news wired in

This is the version Claude Design built (the React-based interactive one with
modals, mobile menu, live clock), now connected to the same real-news
pipeline as the plain static version: BBC, Al Jazeera, CNBC, and MarketWatch
headlines, refreshed automatically every 6 hours.

## What changed

- **Geopolitics cards** now render from `data/news.json` when it's available:
  real headline, real source, relative time ("2h ago"), and the card links
  straight out to the original article in a new tab. Falls back to the
  original hand-written cards if the data hasn't loaded yet or fails.
- **Markets cards** — same idea. Since real RSS headlines don't come with
  price/trend data, I didn't fabricate a fake "+6.2%" style figure for real
  items — the sparkline goes flat/neutral grey and the number badge shows
  time-since-published instead. The original colorful trend cards are still
  there as the fallback when no live data is loaded.
- **"In Brief" list** on the hero now pulls the two most recent geopolitics
  + two most recent market headlines, same fallback behaviour.
- **Small "Live feed · updated Xm ago" labels** added under the Geopolitics
  and Markets headings so it's visible at a glance whether you're looking at
  real data or the fallback.
- The featured article (the one that opens in a modal) and the article
  archive are **untouched** — those are your own original writing, not
  aggregated headlines, so they're out of scope for this change.

## Important: this needs the same hosting setup as before

This file fetches `data/news.json` via a relative path, exactly like the
static version did. That means:

- It needs to be served over `http(s)`, not opened locally as a file.
- `data/news.json`, `scripts/fetch-news.mjs`, `package.json`, and
  `.github/workflows/update-news.yml` all need to sit alongside it in the
  same repo, in the same folder structure, for the automatic refresh to work.
- I've included both `The_Global_Monitor_dc.html` (in case you want to
  re-upload this into Claude Design later to keep editing it there) and an
  identical `index.html` (GitHub Pages looks for a file with exactly that
  name to serve as the homepage — the original filename won't work for that).

Setup steps are otherwise identical to `NEWS-SETUP.md` from the static
version: push everything to the repo, enable GitHub Pages, then go to
Actions → "Update news data" → Run workflow once to populate `data/news.json`
immediately rather than waiting up to 6 hours.

## One thing worth knowing about this version specifically

This file is built on Anthropic's "Dynamic Component" format — the actual
page content is plain HTML/CSS, but the interactive bits (modals, mobile
menu, hover states) are a React component that gets compiled live in the
browser. `support.js` loads React, ReactDOM, and Babel from a CDN
(unpkg.com) at runtime to make that work. Practically:

- It'll work fine once hosted — nothing here needs Claude Design itself to
  be running.
- It's meaningfully heavier than the plain static version: every visitor's
  browser downloads and compiles three extra scripts just to render what's
  mostly a static content page, and it depends on unpkg.com being reachable.
- If you ever want to go back to editing it, that class-based JS at the
  bottom of the file is exactly what Claude Design edits when you make
  changes there — the `newsData`/`newsLoaded`/`newsError` state and the
  fetch call in `componentDidMount()` are the parts I added for this.
