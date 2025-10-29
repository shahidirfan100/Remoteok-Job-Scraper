// RemoteOK jobs scraper - CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '', location = '', dateFilter = 'all', maxItems: MAX_ITEMS_RAW = 100, startUrls, proxyConfiguration,
        } = input;

        const MAX_ITEMS = Number.isFinite(+MAX_ITEMS_RAW) ? Math.max(1, +MAX_ITEMS_RAW) : Number.MAX_SAFE_INTEGER;

        const toAbs = (href, base = 'https://remoteok.com') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const buildStartUrl = (search, loc, date) => {
            const u = new URL('https://remoteok.com/remote-jobs');
            if (search) u.searchParams.set('search', String(search).trim());
            if (loc) u.searchParams.set('location', String(loc).trim());
            if (date && date !== 'all') u.searchParams.set('date', date);
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (!initial.length) initial.push(buildStartUrl(searchQuery, location, dateFilter));

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;

        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: (e.jobLocation && e.jobLocation.address && (e.jobLocation.address.addressLocality || e.jobLocation.address.addressRegion)) || null,
                                job_type: e.employmentType || null,
                                salary: e.baseSalary?.value || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        function findJobLinks($, base) {
            const links = new Set();
            // RemoteOK specific: look for job links in table rows or direct links
            $('tr.job a[href], a[itemprop="url"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                if (/\/remote-jobs\/\d+/i.test(href) && /remoteok\.com/i.test(href)) {
                    const abs = toAbs(href, base);
                    if (abs) links.add(abs);
                }
            });
            return [...links];
        }

        function findNextPage($, base, pageNo) {
            // Check for standard pagination links
            const rel = $('a[rel="next"]').attr('href');
            if (rel) return toAbs(rel, base);
            
            // Check for next button or link
            const next = $('a').filter((_, el) => /(^|\s)(next|›|»|>|load more|more jobs)(\s|$)/i.test($(el).text())).first().attr('href');
            if (next) return toAbs(next, base);
            
            // RemoteOK specific: append ?page= for pagination
            const url = new URL(base);
            url.searchParams.set('page', pageNo + 1);
            return url.href;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 5,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: {
                    maxUsageCount: 5,
                    maxAgeSecs: 1800,
                },
            },
            maxConcurrency: 3,
            requestHandlerTimeoutSecs: 120,
            additionalHttpRequestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'max-age=0',
                    'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                },
            },
            preNavigationHooks: [
                async ({ request }) => {
                    // Add random delay to simulate human behavior
                    const delay = Math.random() * 3000 + 2000; // 2-5 seconds
                    await new Promise(resolve => setTimeout(resolve, delay));
                },
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`LIST ${request.url} -> found ${links.length} links`);

                    const remaining = MAX_ITEMS - saved;
                    const toEnqueue = links.slice(0, Math.max(0, remaining));
                    if (toEnqueue.length) await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });

                    if (saved < MAX_ITEMS) {
                        const next = findNextPage($, request.url, pageNo);
                        if (next) await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= MAX_ITEMS) return;
                    // Simulate reading time
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
                    try {
                        const json = extractFromJsonLd($);
                        const data = json || {};
                        if (!data.title) data.title = $('h1[itemprop="title"], h1, .job-title').first().text().trim() || null;
                        if (!data.company) data.company = $('span[itemprop="name"], .company, .employer, [itemprop="hiringOrganization"] [itemprop="name"]').first().text().trim() || null;
                        if (!data.location) data.location = $('span[itemprop="addressLocality"], .location, [itemprop="jobLocation"] [itemprop="addressLocality"]').first().text().trim() || null;
                        if (!data.date_posted) data.date_posted = $('time[itemprop="datePosted"]').attr('datetime') || $('time, .time, .date').first().text().trim() || null;
                        
                        // Extract job type and category from tags
                        const tags = [];
                        $('.tag, .tags span').each((_, el) => {
                            const tag = $(el).text().trim();
                            if (tag) tags.push(tag);
                        });
                        if (!data.job_type) {
                            data.job_type = tags.find(t => /full.?time|part.?time|contract|freelance|internship/i.test(t)) || null;
                        }
                        if (!data.job_category) {
                            data.job_category = tags.find(t => !/full.?time|part.?time|contract|freelance|internship/i.test(t)) || null;
                        }
                        
                        if (!data.salary) data.salary = $('.salary, .compensation, [itemprop="baseSalary"]').first().text().trim() || null;
                        if (!data.description_html) { 
                            const desc = $('[itemprop="description"], .description, .job-description, .content, .entry-content').first(); 
                            data.description_html = desc && desc.length ? String(desc.html()).trim() : null; 
                        }
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            location: data.location || null,
                            date_posted: data.date_posted || null,
                            job_type: data.job_type || null,
                            job_category: data.job_category || null,
                            salary: data.salary || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            job_url: request.url,
                        };

                        await Dataset.pushData(item);
                        saved++;
                    } catch (err) { crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`); }
                }
            }
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
