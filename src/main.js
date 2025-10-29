// RemoteOK job scraper with Crawlee + Apify SDK + gotScraping (HTTP)
// Features: pagination, keyword/location/date filters, strong anti-blocking measures.

import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

const BASE_URL = 'https://remoteok.com/remote-jobs';
const DATE_WINDOWS = {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 31 * 24 * 60 * 60 * 1000,
};

// ---- helpers ----
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = async (min = 1000, max = 2500) =>
    delay(Math.random() * (max - min) + min);
const stripHtml = (html) =>
    html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';

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
    'Referer': 'https://google.com/',
    'Origin': 'https://remoteok.com',
};

const DATE_FILTERS = DATE_WINDOWS;
const buildUrl = ({ searchQuery, location, page }) => {
    const p = new URLSearchParams();
    if (searchQuery) p.set('search', searchQuery);
    if (location) p.set('location', location);
    if (page > 1) p.set('pg', page);
    const qs = p.toString() ? `?${p.toString()}` : '';
    return `${BASE_URL}${qs}`;
};

// ---- parsing & filtering ----
const parseJobs = ($) => {
    const jobs = [];
    $('tr.job').each((_, el) => {
        const $el = $(el);
        const title = $el.find('h2[itemprop="title"]').text().trim();
        const company = $el.find('h3[itemprop="name"]').text().trim();
        if (!title || !company) return;
        const id = $el.attr('data-id') || null;
        const location =
            $el.find('.location').text().trim() || 'Worldwide';
        const date = $el.find('time').attr('datetime') || null;
        const tags = $el
            .find('.tags .tag')
            .map((i, t) => $(t).text().trim())
            .get()
            .filter(Boolean);
        const href = $el.find('a.preventLink').attr('href') || '';
        const url = href.startsWith('http')
            ? href
            : `https://remoteok.com${href}`;
        const desc = stripHtml(
            $el.find('.description, .expandContents').html() || ''
        );
        const logo =
            $el.find('img.logo').attr('data-src') ||
            $el.find('img.logo').attr('src') ||
            null;
        jobs.push({
            id,
            title,
            company,
            location,
            date_posted: date,
            tags: tags.length ? tags : null,
            description_text: desc,
            logo,
            url,
            source: 'remoteok.com',
            collected_at: new Date().toISOString(),
        });
    });
    return jobs;
};

const filterJobs = (jobs, { searchQuery, location, dateFilter }) => {
    const q = searchQuery?.toLowerCase() || '';
    const loc = location?.toLowerCase() || '';
    const win = DATE_FILTERS[dateFilter] || null;
    const now = Date.now();

    return jobs.filter((j) => {
        const text = [
            j.title,
            j.company,
            j.description_text,
            j.tags?.join(' '),
        ]
            .join(' ')
            .toLowerCase();
        const kwOk = !q || text.includes(q);
        const locOk = !loc || j.location?.toLowerCase().includes(loc);
        let dateOk = true;
        if (win && j.date_posted) {
            const t = Date.parse(j.date_posted);
            if (Number.isFinite(t)) dateOk = now - t <= win;
        }
        return kwOk && locOk && dateOk;
    });
};

const nextPageUrl = ($, currentUrl, currentPage, filters) => {
    const href = $('a[rel="next"]').attr('href');
    if (href)
        return href.startsWith('http')
            ? href
            : new URL(href, BASE_URL).toString();
    const next = currentPage + 1;
    return buildUrl({ ...filters, page: next });
};

// ---- main ----
async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '',
            location = '',
            dateFilter = 'all',
            maxItems: rawMax = 200,
            maxPages: rawPages = 10,
            proxyConfiguration,
        } = input;
        const maxItems = Number(rawMax) || 200;
        const maxPages = Number(rawPages) || 10;

        const proxyCfg = proxyConfiguration
            ? await Actor.createProxyConfiguration(proxyConfiguration)
            : await Actor.createProxyConfiguration({
                  useApifyProxy: true,
                  apifyProxyGroups: ['RESIDENTIAL', 'SHADER'],
              });

        const requestQueue = await Actor.openRequestQueue();
        await requestQueue.addRequest({
            url: buildUrl({ searchQuery, location, page: 1 }),
            userData: { page: 1 },
        });

        let saved = 0;
        const seen = new Set();

        const crawler = new CheerioCrawler({
            requestQueue,
            proxyConfiguration: proxyCfg,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 12,
                sessionOptions: { maxAgeSecs: 1800, maxUsageCount: 10 },
            },
            maxConcurrency: 2,
            maxRequestRetries: 3,
            requestHandlerTimeoutSecs: 180,
            additionalMimeTypes: ['text/html'],

            preNavigationHooks: [
                async ({ request }, gotoOpts) => {
                    await randomDelay();
                    gotoOpts.headers = {
                        ...BASE_HEADERS,
                        'User-Agent':
                            USER_AGENTS[
                                Math.floor(Math.random() * USER_AGENTS.length)
                            ],
                    };
                    if (Math.random() < 0.4)
                        gotoOpts.headers.Referer = 'https://duckduckgo.com/';
                },
            ],

            async requestHandler({ request, $, session, log: clog }) {
                const { page = 1 } = request.userData;
                const html = $.html();
                if (/Cloudflare|Just a moment|captcha/i.test(html)) {
                    clog.warning('Cloudflare detected; cooling off...');
                    session.retire(); // rotate identity
                    await delay(5000 + Math.random() * 3000);
                    throw new Error('Cloudflare challenge detected');
                }

                const jobs = parseJobs($);
                const filtered = filterJobs(jobs, {
                    searchQuery,
                    location,
                    dateFilter,
                });

                clog.info(
                    `Page ${page}: ${filtered.length}/${jobs.length} jobs match filters`
                );

                for (const j of filtered) {
                    if (saved >= maxItems) break;
                    const key = j.id || j.url;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    await Dataset.pushData(j);
                    saved++;
                    clog.info(
                        `Saved ${saved}/${maxItems}: ${j.title} @ ${j.company}`
                    );
                }

                if (saved < maxItems && page < maxPages) {
                    const nxt = nextPageUrl($, request.url, page, {
                        searchQuery,
                        location,
                    });
                    if (nxt) {
                        await requestQueue.addRequest({
                            url: nxt,
                            userData: { page: page + 1 },
                        });
                    }
                }
            },

            failedRequestHandler({ request, error }) {
                log.warning(
                    `❌ ${request.url} failed after retries: ${error.message}`
                );
            },
        });

        log.info(`🚀 Starting RemoteOK scraper:
  - searchQuery: "${searchQuery}"
  - location: "${location}"
  - dateFilter: "${dateFilter}"
  - maxItems: ${maxItems}
  - maxPages: ${maxPages}`);

        await crawler.run();
        log.info(`🎯 Finished. Saved ${saved} jobs.`);
    } finally {
        await Actor.exit();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
