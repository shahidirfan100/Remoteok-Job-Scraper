// RemoteOK jobs scraper leveraging RemoteOK public API with Crawlee + gotScraping
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
};

const DATE_WINDOWS = {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 31 * 24 * 60 * 60 * 1000,
};

let cachedJobs;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripHtml = (html) => {
    if (!html) return null;
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null;
};

const normalize = (value) => {
    if (!value || typeof value !== 'string') return '';
    return value.trim();
};

const parseFiltersFromUrl = (urlString, defaults) => {
    const filters = { ...defaults };

    try {
        const url = new URL(urlString);
        const { pathname, searchParams } = url;

        if (pathname.includes('/remote-jobs/')) {
            const slug = pathname.split('/').filter(Boolean).pop();
            if (slug) filters.slug = slug;
        }

        const searchParam = searchParams.get('search') || searchParams.get('q');
        if (searchParam) filters.searchQuery = searchParam;

        const tagParam = searchParams.get('tag') || searchParams.get('tags');
        if (tagParam) {
            filters.searchQuery = filters.searchQuery
                ? `${filters.searchQuery} ${tagParam}`
                : tagParam;
        }

        const locationParam = searchParams.get('location');
        if (locationParam) filters.location = locationParam;

        const dateParam = searchParams.get('date');
        if (dateParam && ['today', 'week', 'month'].includes(dateParam)) filters.dateFilter = dateParam;
    } catch (err) {
        log.warning(`Failed to parse start URL "${urlString}": ${err.message}`);
    }

    filters.searchQuery = normalize(filters.searchQuery);
    filters.location = normalize(filters.location);
    filters.dateFilter = filters.dateFilter || 'all';
    filters.slug = filters.slug ? filters.slug.trim() : undefined;

    return filters;
};

const deriveJobType = (tags = []) => {
    const tag = tags.find((t) =>
        /full.?time|part.?time|contract|freelance|internship|temporary/i.test(t)
    );
    return tag || null;
};

const matchesSearch = (job, filters) => {
    if (!filters.searchQueryLower) return true;
    const haystacks = [
        job.position,
        job.company,
        job.location,
        job.description,
        Array.isArray(job.tags) ? job.tags.join(' ') : null,
    ];
    return haystacks.some(
        (value) => typeof value === 'string' && value.toLowerCase().includes(filters.searchQueryLower)
    );
};

const matchesLocation = (job, filters) => {
    if (!filters.locationLower) return true;
    if (!job.location) return false;
    return job.location.toLowerCase().includes(filters.locationLower);
};

const matchesDate = (job, filters) => {
    if (!filters.dateFilter || filters.dateFilter === 'all') return true;

    const now = Date.now();
    let jobTimestamp;

    if (job.epoch) jobTimestamp = Number(job.epoch) * 1000;
    if (!Number.isFinite(jobTimestamp)) jobTimestamp = Date.parse(job.date);

    if (!Number.isFinite(jobTimestamp)) return true;
    if (jobTimestamp > now) return true;

    const windowMs = DATE_WINDOWS[filters.dateFilter];
    return typeof windowMs === 'number' ? now - jobTimestamp <= windowMs : true;
};

const matchesSlug = (job, filters) => {
    if (!filters.slug) return true;
    const slug = filters.slug.toLowerCase();
    const jobSlug = (job.slug || '').toLowerCase();
    const jobUrl = (job.url || '').toLowerCase();
    return jobSlug === slug || jobUrl.endsWith(slug);
};

const buildFilters = (baseFilters) => ({
    ...baseFilters,
    searchQueryLower: baseFilters.searchQuery ? baseFilters.searchQuery.toLowerCase() : undefined,
    locationLower: baseFilters.location ? baseFilters.location.toLowerCase() : undefined,
});

const transformJob = (job, filters) => {
    const salaryMin = Number(job.salary_min);
    const salaryMax = Number(job.salary_max);
    const tags = Array.isArray(job.tags) ? [...new Set(job.tags)] : [];

    return {
        id: job.id ?? null,
        slug: job.slug ?? null,
        title: job.position ?? null,
        company: job.company ?? null,
        company_logo: job.company_logo || job.logo || null,
        location: job.location ?? null,
        verified: job.verified ?? null,
        job_type: deriveJobType(tags),
        tags: tags.length ? tags : null,
        description_html: job.description ?? null,
        description_text: stripHtml(job.description),
        salary_min: Number.isFinite(salaryMin) && salaryMin > 0 ? salaryMin : null,
        salary_max: Number.isFinite(salaryMax) && salaryMax > 0 ? salaryMax : null,
        apply_url: job.apply_url ?? job.url ?? null,
        url: job.url ?? null,
        date_posted: job.date ?? null,
        epoch: job.epoch ?? null,
        search_query: filters.searchQuery || null,
        location_filter: filters.location || null,
        date_filter: filters.dateFilter || 'all',
        source: 'remoteok.com',
        collected_at: new Date().toISOString(),
    };
};

// ✅ Robust fetchJobs with Cloudflare/HTML detection + retries
const fetchJobs = async ({ proxyUrl, session, crawlerLog }) => {
    if (cachedJobs && cachedJobs.timestamp > Date.now() - 5 * 60 * 1000) {
        return cachedJobs.jobs;
    }

    const options = {
        url: 'https://remoteok.com/api',
        headers: {
            ...HEADERS,
            Referer: 'https://remoteok.com/',
            Origin: 'https://remoteok.com',
        },
        timeout: 45_000,
        responseType: 'text',
        proxyUrl,
        sessionToken: session,
    };

    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            response = await gotScraping(options);
            const body = response.body?.trim();

            // Detect non-JSON (HTML / Cloudflare)
            if (!body || body.startsWith('<!DOCTYPE html') || body.startsWith('<html')) {
                crawlerLog.warning(`Received non-JSON response on attempt ${attempt}`);
                await delay(1000 * attempt);
                continue;
            }

            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch {
                crawlerLog.warning(`JSON parse failed on attempt ${attempt}`);
                await delay(1000 * attempt);
                continue;
            }

            const jobs = Array.isArray(parsed)
                ? parsed.filter((j) => j && j.id)
                : [];
            if (jobs.length > 0) {
                cachedJobs = { timestamp: Date.now(), jobs };
                crawlerLog.info(`Fetched ${jobs.length} jobs from RemoteOK API`);
                return jobs;
            }

            crawlerLog.warning(`Parsed empty job list, retrying (${attempt}/3)...`);
            await delay(1000 * attempt);
        } catch (err) {
            crawlerLog.warning(`Fetch attempt ${attempt} failed: ${err.message}`);
            await delay(1000 * attempt);
        }
    }

    throw new Error('Failed to retrieve valid job data from RemoteOK after 3 attempts.');
};

// 🧠 MAIN EXECUTION
async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '',
            location = '',
            dateFilter = 'all',
            maxItems: rawMaxItems = 100,
            startUrls,
            proxyConfiguration,
        } = input;

        const maxItems = Number.isFinite(+rawMaxItems)
            ? Math.max(1, +rawMaxItems)
            : Number.MAX_SAFE_INTEGER;
        const defaults = {
            searchQuery: normalize(searchQuery),
            location: normalize(location),
            dateFilter: ['today', 'week', 'month'].includes(dateFilter)
                ? dateFilter
                : 'all',
        };

        const initialRequests = [];
        if (Array.isArray(startUrls) && startUrls.length) {
            for (const url of startUrls) {
                const filters = buildFilters(parseFiltersFromUrl(url, defaults));
                initialRequests.push({
                    url: 'https://remoteok.com/api',
                    userData: { filters, label: 'START_URL', originalUrl: url },
                });
            }
        } else {
            const filters = buildFilters({ ...defaults });
            initialRequests.push({
                url: 'https://remoteok.com/api',
                userData: {
                    filters,
                    label: 'DEFAULT',
                    originalUrl: 'https://remoteok.com/remote-jobs',
                },
            });
        }

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
            additionalMimeTypes: ['application/json'],
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: {
                    maxAgeSecs: 1800,
                    maxUsageCount: 10,
                },
            },
            preNavigationHooks: [
                async () => {
                    await delay(500 + Math.random() * 1500);
                },
            ],
            async requestHandler({ request, proxyInfo, session, log: crawlerLog }) {
                if (saved >= maxItems) return;

                const { filters, label, originalUrl } = request.userData || {};
                const activeFilters = filters || buildFilters({ ...defaults });
                crawlerLog.info(
                    `Processing ${label || 'REQUEST'} (${originalUrl || request.url})`
                );

                let jobs;
                try {
                    jobs = await fetchJobs({
                        proxyUrl: proxyInfo?.url,
                        session,
                        crawlerLog,
                    });
                } catch (error) {
                    crawlerLog.exception(error, 'Failed to fetch jobs from RemoteOK API');
                    throw error;
                }

                for (const job of jobs) {
                    if (saved >= maxItems) break;
                    if (!job?.id || seenIds.has(job.id)) continue;
                    if (!matchesSlug(job, activeFilters)) continue;
                    if (!matchesSearch(job, activeFilters)) continue;
                    if (!matchesLocation(job, activeFilters)) continue;
                    if (!matchesDate(job, activeFilters)) continue;

                    const item = transformJob(job, activeFilters);
                    await Dataset.pushData(item);
                    seenIds.add(job.id);
                    saved += 1;
                    crawlerLog.info(
                        `Saved ${saved}/${maxItems}: ${item.title || 'Untitled'} @ ${
                            item.company || 'Unknown'
                        }`
                    );
                }

                if (saved === 0) {
                    crawlerLog.warning(
                        'No jobs matched the provided filters. Consider relaxing search/location/date constraints.'
                    );
                }
            },
        });

        log.info(
            `Starting RemoteOK crawler with ${initialRequests.length} filter set(s).`
        );
        log.info(
            `Filters: search="${defaults.searchQuery}", location="${defaults.location}", dateFilter="${defaults.dateFilter}", maxItems=${maxItems}`
        );

        await crawler.run(initialRequests);

        log.info(`Finished. Saved ${saved} job(s).`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
