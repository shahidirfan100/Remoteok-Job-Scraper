// RemoteOK RSS Job Scraper using Apify SDK + Crawlee + gotScraping
// Features: keyword/location/date filters, anti-blocking headers, dataset output.
// Works via RSS feed (no Cloudflare challenge).

import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

// ====== CONFIG ======
const RSS_URL = 'https://remoteok.com/rss';
const DATE_WINDOWS = {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 31 * 24 * 60 * 60 * 1000,
};

// ====== HELPERS ======
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = async (min = 500, max = 1500) =>
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
    'Accept': 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'Referer': 'https://google.com/',
};

// ====== PARSING ======
const parseRssItems = ($) => {
    const jobs = [];
    $('item').each((_, el) => {
        const $el = $(el);
        const title = $el.find('title').text().trim();
        const link = $el.find('link').text().trim();
        const pubDate = $el.find('pubDate').text().trim();
        const descriptionHtml = $el.find('description').text();
        const description = stripHtml(descriptionHtml);
        const guid = $el.find('guid').text().trim() || link;
        const category = $el.find('category').map((i, t) => $(t).text().trim()).get();

        // Attempt to extract company & location from title or description
        const titleParts = title.split(' at ');
        const jobTitle = titleParts[0]?.trim() || title;
        const company = titleParts[1]?.trim() || null;

        jobs.push({
            id: guid,
            title: jobTitle,
            company,
            location: null, // not directly in RSS; can infer later
            tags: category.length ? category : null,
            date_posted: pubDate || null,
            description_text: description,
            url: link,
            source: 'remoteok.com/rss',
            collected_at: new Date().toISOString(),
        });
    });
    return jobs;
};

// ====== FILTERS ======
const filterJobs = (jobs, { searchQuery, location, dateFilter }) => {
    const q = searchQuery?.toLowerCase() || '';
    const loc = location?.toLowerCase() || '';
    const windowMs = DATE_WINDOWS[dateFilter] || null;
    const now = Date.now();

    return jobs.filter((job) => {
        const text = [
            job.title,
            job.company,
            job.description_text,
            job.tags?.join(' '),
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        const kwOk = !q || text.includes(q);
        const locOk = !loc || text.includes(loc);

        let dateOk = true;
        if (windowMs && job.date_posted) {
            const ts = Date.parse(job.date_posted);
            if (Number.isFinite(ts)) dateOk = now - ts <= windowMs;
        }

        return kwOk && locOk && dateOk;
    });
};

// ====== MAIN ======
async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '',
            location = '',
            dateFilter = 'all',
            maxItems: rawMaxItems = 200,
            proxyConfiguration,
        } = input;

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

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConfig,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 10,
                sessionOptions: { maxAgeSecs: 1800, maxUsageCount: 10 },
            },
            maxConcurrency: 1,
            maxRequestRetries: 2,
            requestHandlerTimeoutSecs: 90,
            additionalMimeTypes: ['application/rss+xml', 'application/xml', 'text/xml'],
            preNavigationHooks: [
                async ({ request }, gotoOptions) => {
                    await randomDelay();
                    gotoOptions.headers = {
                        ...BASE_HEADERS,
                        'User-Agent':
                            USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                    };
                },
            ],
            async requestHandler({ $, log: crawlerLog }) {
                if (!$) throw new Error('No RSS content parsed.');
                const allJobs = parseRssItems($);
                const filteredJobs = filterJobs(allJobs, {
                    searchQuery,
                    location,
                    dateFilter,
                });

                crawlerLog.info(
                    `Found ${filteredJobs.length}/${allJobs.length} jobs matching filters.`
                );

                for (const job of filteredJobs) {
                    if (saved >= maxItems) break;
                    await Dataset.pushData(job);
                    saved++;
                    crawlerLog.info(`Saved ${saved}/${maxItems}: ${job.title}`);
                }

                if (saved === 0) {
                    crawlerLog.warning(
                        'No matching jobs. Try broadening filters or check feed availability.'
                    );
                }
            },
        });

        log.info(`🚀 Starting RemoteOK RSS scraper with:
  - searchQuery: "${searchQuery}"
  - location: "${location}"
  - dateFilter: "${dateFilter}"
  - maxItems: ${maxItems}`);

        await crawler.run([{ url: RSS_URL }]);

        log.info(`🎯 Finished. Saved ${saved} jobs.`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
