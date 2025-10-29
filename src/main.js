// RemoteOK Job Scraper with Crawlee + Apify SDK + gotScraping (via CheerioCrawler)
// Features: pagination, filters (keyword/location/date), anti-blocking measures, dataset output.

import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

// ====== CONSTANTS ======
const BASE_URL = 'https://remoteok.com/remote-jobs';
const MAX_PAGES_DEFAULT = 10; // safety cap on pagination

const DATE_WINDOWS = {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 31 * 24 * 60 * 60 * 1000,
};

// ====== HELPERS ======
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = async (min = 800, max = 2200) => delay(Math.random() * (max - min) + min);

const stripHtml = (html) => html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; rv:118.0) Gecko/20100101 Firefox/118.0',
];

const BASE_HEADERS = {
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    // Referer/Origin help pass some edge WAF checks
    'Referer': 'https://google.com/',
    'Origin': 'https://remoteok.com',
};

/**
 * Build RemoteOK search URL from filters and page number.
 * RemoteOK typically supports "search" and "location" query params on /remote-jobs.
 */
const buildSearchUrl = ({ searchQuery, location, page = 1 }) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (location) params.set('location', location);
    // Prefer pg= for pagination (common on RemoteOK); fall back logic is in getNextPageUrl
    if (page > 1) params.set('pg', String(page));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return `${BASE_URL}${qs}`;
};

/**
 * Try to derive the "next page" URL from DOM; otherwise construct it.
 */
const getNextPageUrl = ($, currentUrl, currentPage, searchQuery, location) => {
    // 1) Try rel="next"
    const hrefNext = $('a[rel="next"]').attr('href');
    if (hrefNext) {
        // Make absolute if needed
        const nextAbs = hrefNext.startsWith('http') ? hrefNext : new URL(hrefNext, BASE_URL).toString();
        return nextAbs;
    }

    // 2) Try pagination anchors with text "Next"
    const altNext = $('a:contains("Next"), a:contains("next")').attr('href');
    if (altNext) {
        const nextAbs = altNext.startsWith('http') ? altNext : new URL(altNext, BASE_URL).toString();
        return nextAbs;
    }

    // 3) Construct from our known pattern (fallback)
    const nextPage = Number.isFinite(currentPage) ? currentPage + 1 : 2;

    // Preserve existing query (search/location). Prefer pg= param
    const url = new URL(currentUrl);
    const qp = url.searchParams;
    // If the site uses different key (e.g., page=), normalize to pg=
    qp.delete('page');
    qp.set('pg', String(nextPage));
    // Also ensure search/location are present if provided
    if (searchQuery && !qp.get('search')) qp.set('search', searchQuery);
    if (location && !qp.get('location')) qp.set('location', location);

    url.search = qp.toString();
    return url.toString();
};

/**
 * Convert raw DOM into structured job records.
 * Uses the Cheerio instance `$` provided by CheerioCrawler, no external "cheerio" import needed.
 */
const parseJobsFromPage = ($) => {
    const jobs = [];

    // Each job row typically has class "job"
    $('tr.job').each((_, el) => {
        const $el = $(el);
        const id = $el.attr('data-id') || null;

        const title = $el.find('h2[itemprop="title"]').text().trim() || null;
        const company = $el.find('h3[itemprop="name"]').text().trim() || null;

        // If either title or company missing, skip
        if (!title || !company) return;

        const locationText = $el.find('.location').text().trim();
        const location = locationText || 'Worldwide';

        const datePosted = $el.find('time').attr('datetime') || null;

        const tags = $el
            .find('.tags .tag')
            .map((i, t) => $(t).text().trim())
            .get()
            .filter(Boolean);
        const tagsOut = tags.length ? tags : null;

        const linkPath = $el.find('a.preventLink').attr('href') || '';
        const url = linkPath.startsWith('http') ? linkPath : `https://remoteok.com${linkPath}`;

        const logo = $el.find('img.logo').attr('data-src') || $el.find('img.logo').attr('src') || null;

        // Some descriptions appear on the list; if not, this stays empty (still useful item)
        const descHtml = $el.find('.description, .expandContents').html() || '';
        const description = stripHtml(descHtml) || null;

        jobs.push({
            id,
            title,
            company,
            location,
            date_posted: datePosted,
            tags: tagsOut,
            logo,
            description_text: description,
            url,
            source: 'remoteok.com',
            collected_at: new Date().toISOString(),
        });
    });

    return jobs;
};

/**
 * Apply keyword, location, and date filters client-side (in addition to URL params).
 */
const filterJobs = (jobs, { searchQuery, location, dateFilter }) => {
    const now = Date.now();
    const q = (searchQuery || '').toLowerCase();
    const loc = (location || '').toLowerCase();
    const windowMs = DATE_WINDOWS[dateFilter] || null;

    return jobs.filter((job) => {
        // Keyword match (title, company, description, tags)
        const haystacks = [
            job.title,
            job.company,
            job.description_text,
            Array.isArray(job.tags) ? job.tags.join(' ') : '',
        ]
            .filter(Boolean)
            .map((s) => s.toLowerCase());
        const keywordOk = !q || haystacks.some((s) => s.includes(q));

        // Location match
        const locationOk = !loc || (job.location && job.location.toLowerCase().includes(loc));

        // Date window match
        let dateOk = true;
        if (windowMs && job.date_posted) {
            const ts = Date.parse(job.date_posted);
            if (Number.isFinite(ts)) {
                dateOk = now - ts <= windowMs;
            }
        }

        return keywordOk && locationOk && dateOk;
    });
};

// ====== MAIN ======
async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '',
            location = '',
            dateFilter = 'all', // 'today' | 'week' | 'month' | 'all'
            maxItems: rawMaxItems = 200,
            maxPages: rawMaxPages = MAX_PAGES_DEFAULT,
            proxyConfiguration,
        } = input;

        const maxItems = Number.isFinite(+rawMaxItems) ? Math.max(1, +rawMaxItems) : 200;
        const MAX_PAGES = Number.isFinite(+rawMaxPages) ? Math.max(1, +rawMaxPages) : MAX_PAGES_DEFAULT;

        const proxyConfig = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : await Actor.createProxyConfiguration({
                useApifyProxy: true,
                apifyProxyGroups: ['RESIDENTIAL'],
            });

        // Use a request queue so we can queue more pages from inside the handler
        const requestQueue = await Actor.openRequestQueue();

        // Prepare the starting URL with filters in the query string
        const startUrl = buildSearchUrl({ searchQuery, location, page: 1 });
        await requestQueue.addRequest({ url: startUrl, userData: { page: 1 } });

        let saved = 0;
        const seenIds = new Set();

        const crawler = new CheerioCrawler({
            requestQueue,
            proxyConfiguration: proxyConfig,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 12,
                sessionOptions: {
                    maxAgeSecs: 1800,
                    maxUsageCount: 12,
                },
            },
            // Anti-blocking: lower concurrency + retries
            maxConcurrency: 2,
            maxRequestRetries: 2,
            requestHandlerTimeoutSecs: 180,
            additionalMimeTypes: ['text/html'],

            preNavigationHooks: [
                async ({ request, session, proxyInfo }, gotoOptions) => {
                    // Random headers & slight think time
                    await randomDelay(900, 2200);

                    const headers = {
                        ...BASE_HEADERS,
                        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                    };

                    // Set headers via gotoOptions which CheerioCrawler (gotScraping) respects
                    gotoOptions.headers = {
                        ...(gotoOptions.headers || {}),
                        ...headers,
                    };

                    // Small chance to change referer pattern to look less robotic
                    if (Math.random() < 0.33) {
                        gotoOptions.headers.Referer = 'https://duckduckgo.com/';
                    }
                },
            ],

            async requestHandler({ request, $, log: crawlerLog, session }) {
                const { page = 1 } = request.userData || {};
                crawlerLog.info(`Processing page ${page}: ${request.url}`);

                // Quick HTML sanity checks (Cloudflare/captcha guard)
                const htmlText = $.html() || '';
                if (!htmlText.includes('<html')) {
                    throw new Error('Invalid HTML body (no <html>), likely blocked.');
                }
                if (/Cloudflare|Just a moment|captcha/i.test(htmlText)) {
                    throw new Error('Cloudflare challenge detected, retrying...');
                }

                // Parse current page jobs
                const rawJobs = parseJobsFromPage($);
                const filtered = filterJobs(rawJobs, { searchQuery, location, dateFilter });

                crawlerLog.info(`Found ${filtered.length}/${rawJobs.length} jobs matching filters on page ${page}.`);

                for (const job of filtered) {
                    if (saved >= maxItems) break;
                    const key = job.id || job.url; // fallback for uniqueness
                    if (seenIds.has(key)) continue;
                    seenIds.add(key);
                    await Dataset.pushData(job);
                    saved += 1;
                    crawlerLog.info(`Saved ${saved}/${maxItems}: ${job.title} @ ${job.company}`);
                }

                // Pagination: queue the next page if we still need more items
                if (saved < maxItems && page < MAX_PAGES) {
                    const nextUrl = getNextPageUrl($, request.url, page, searchQuery, location);
                    if (nextUrl) {
                        crawlerLog.info(`Queueing next page (${page + 1}): ${nextUrl}`);
                        await requestQueue.addRequest({ url: nextUrl, userData: { page: page + 1 } });
                    } else {
                        crawlerLog.info('No next page link found.');
                    }
                }
            },

            failedRequestHandler({ request, log: crawlerLog }) {
                crawlerLog.error(`Request ${request.url} failed after retries.`);
            },
        });

        log.info(`🚀 Starting RemoteOK scraper with:
  - searchQuery: "${searchQuery}"
  - location: "${location}"
  - dateFilter: "${dateFilter}"
  - maxItems: ${maxItems}
  - maxPages: ${MAX_PAGES}`);

        await crawler.run();

        log.info(`🎯 Finished. Saved ${saved} job(s).`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
