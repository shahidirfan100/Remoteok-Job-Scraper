// RemoteOK Job Scraper with Crawlee + Apify SDK + gotScraping
// Features: pagination, anti-blocking headers, session management, retries, dataset output.

import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import cheerio from 'cheerio';

await Actor.init();

// ====== CONFIG ======
const BASE_URL = 'https://remoteok.com/remote-jobs';
const MAX_PAGES = 10; // limit for pagination to avoid infinite crawl
const JOBS_PER_PAGE = 50; // RemoteOK usually shows up to ~50 jobs per page

// ====== HELPERS ======
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = async (min = 800, max = 2500) => delay(Math.random() * (max - min) + min);

const HEADERS_BASE = {
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
};

// realistic user-agents for rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/118.0',
];

/**
 * Fetches a RemoteOK HTML page with anti-blocking headers & retries.
 */
const fetchPageHtml = async ({ url, proxyUrl, session, crawlerLog }) => {
    const headers = {
        ...HEADERS_BASE,
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://google.com/',
        'Origin': 'https://remoteok.com',
    };

    const options = {
        url,
        headers,
        proxyUrl,
        sessionToken: session,
        responseType: 'text',
        timeout: 45_000,
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await gotScraping(options);
            const body = res.body?.trim();

            if (!body || !body.includes('<html')) {
                crawlerLog.warning(`Attempt ${attempt}: invalid HTML (maybe Cloudflare)`);
                await randomDelay();
                continue;
            }

            if (/Cloudflare|Just a moment|captcha/i.test(body)) {
                crawlerLog.warning(`Attempt ${attempt}: Cloudflare challenge detected`);
                await randomDelay();
                continue;
            }

            return body;
        } catch (err) {
            crawlerLog.warning(`Attempt ${attempt} failed: ${err.message}`);
            await randomDelay();
        }
    }

    throw new Error(`Failed to fetch HTML for ${url} after 3 attempts.`);
};

/**
 * Parses job data from RemoteOK HTML.
 */
const parseJobs = (html) => {
    const $ = cheerio.load(html);
    const jobs = [];

    $('tr.job').each((_, el) => {
        const $el = $(el);
        const id = $el.attr('data-id') || null;
        const title = $el.find('h2[itemprop="title"]').text().trim();
        const company = $el.find('h3[itemprop="name"]').text().trim();
        const location = $el.find('.location').text().trim() || 'Worldwide';
        const date = $el.find('time').attr('datetime') || null;
        const urlPath = $el.find('a.preventLink').attr('href') || '';
        const url = urlPath.startsWith('http')
            ? urlPath
            : `https://remoteok.com${urlPath}`;
        const tags = $el
            .find('.tags .tag')
            .map((i, t) => $(t).text().trim())
            .get()
            .filter(Boolean);
        const description = $el.find('.description, .expandContents').text().trim() || null;
        const logo = $el.find('img.logo').attr('data-src') || null;

        if (title && company) {
            jobs.push({
                id,
                title,
                company,
                location,
                tags: tags.length ? tags : null,
                logo,
                date_posted: date,
                description_text: description,
                url,
                source: 'remoteok.com',
                collected_at: new Date().toISOString(),
            });
        }
    });

    return jobs;
};

// ====== MAIN ======
async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const { maxItems: rawMaxItems = 200, proxyConfiguration } = input;
        const maxItems = Number.isFinite(+rawMaxItems)
            ? Math.max(1, +rawMaxItems)
            : 200;

        const proxyConfig = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : await Actor.createProxyConfiguration({
                  useApifyProxy: true,
                  apifyProxyGroups: ['RESIDENTIAL'],
              });

        let saved = 0;
        const seenIds = new Set();

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConfig,
            maxConcurrency: 2,
            maxRequestRetries: 2,
            requestHandlerTimeoutSecs: 180,
            additionalMimeTypes: ['text/html'],
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 10,
                sessionOptions: {
                    maxAgeSecs: 1800,
                    maxUsageCount: 10,
                },
            },
            preNavigationHooks: [
                async () => {
                    await randomDelay(1000, 3000);
                },
            ],
            async requestHandler({ request, session, proxyInfo, log: crawlerLog }) {
                const url = request.url;
                crawlerLog.info(`Fetching: ${url}`);

                const html = await fetchPageHtml({ url, proxyUrl: proxyInfo?.url, session, crawlerLog });
                const jobs = parseJobs(html);
                crawlerLog.info(`Parsed ${jobs.length} jobs from ${url}`);

                for (const job of jobs) {
                    if (saved >= maxItems) return;
                    if (seenIds.has(job.id)) continue;
                    seenIds.add(job.id);
                    await Dataset.pushData(job);
                    saved++;
                    crawlerLog.info(`✅ Saved ${saved}/${maxItems}: ${job.title} @ ${job.company}`);
                }

                // pagination
                const currentPageMatch = url.match(/page=(\d+)/);
                const currentPage = currentPageMatch ? Number(currentPageMatch[1]) : 1;
                if (currentPage < MAX_PAGES && saved < maxItems) {
                    const nextPageUrl = `${BASE_URL}?page=${currentPage + 1}`;
                    crawlerLog.info(`Queueing next page: ${nextPageUrl}`);
                    await crawler.addRequests([{ url: nextPageUrl }]);
                }
            },
        });

        // Start from first page
        await crawler.run([{ url: BASE_URL }]);

        log.info(`🎯 Finished. Saved ${saved} jobs in total.`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
