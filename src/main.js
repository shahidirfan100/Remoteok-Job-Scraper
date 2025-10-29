// RemoteOK jobs scraper - CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            searchQuery = '', location = '', dateFilter = 'all', maxItems: MAX_ITEMS_RAW = 100, startUrls, proxyConfiguration,
        } = input;

        const MAX_ITEMS = Number.isFinite(+MAX_ITEMS_RAW) ? Math.max(1, +MAX_ITEMS_RAW) : Number.MAX_SAFE_INTEGER;

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

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });

        let saved = 0;
        const seenJobs = new Set();

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
            maxConcurrency: 2,
            requestHandlerTimeoutSecs: 180,
            navigationTimeoutSecs: 120,
            ignoreSslErrors: true,
            additionalHttpRequestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    'Cache-Control': 'max-age=0',
                    'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                    'Connection': 'keep-alive',
                },
            },
            preNavigationHooks: [
                async ({ request }) => {
                    // Add random delay to simulate human behavior (2-5 seconds)
                    const delay = Math.random() * 3000 + 2000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                },
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                crawlerLog.info(`Processing: ${request.url}`);
                
                // Log page info for debugging
                const pageTitle = $('title').text();
                const htmlLength = $.html().length;
                crawlerLog.info(`Page title: "${pageTitle}"`);
                crawlerLog.info(`HTML length: ${htmlLength} characters`);
                
                // Try multiple selector strategies for RemoteOK
                let jobRows = $('tr.job[data-url]');
                crawlerLog.info(`Strategy 1 - tr.job[data-url]: ${jobRows.length} jobs`);
                
                if (jobRows.length === 0) {
                    jobRows = $('tr[data-url]');
                    crawlerLog.info(`Strategy 2 - tr[data-url]: ${jobRows.length} jobs`);
                }
                
                if (jobRows.length === 0) {
                    jobRows = $('tr[data-id]');
                    crawlerLog.info(`Strategy 3 - tr[data-id]: ${jobRows.length} jobs`);
                }
                
                if (jobRows.length === 0) {
                    jobRows = $('table tr').filter((i, el) => {
                        return $(el).attr('data-url') || $(el).attr('data-id');
                    });
                    crawlerLog.info(`Strategy 4 - table tr with data attrs: ${jobRows.length} jobs`);
                }
                
                if (jobRows.length === 0) {
                    // Log sample HTML for debugging
                    const sampleHtml = $.html().substring(0, 2000);
                    crawlerLog.warning('No job rows found with any strategy');
                    crawlerLog.info(`Sample HTML (first 2000 chars):\n${sampleHtml}`);
                    
                    // Check if we're being blocked or redirected
                    const bodyText = $('body').text();
                    if (bodyText.includes('cloudflare') || bodyText.includes('blocked') || bodyText.includes('captcha')) {
                        crawlerLog.error('Possible bot detection/blocking detected');
                    }
                }

                jobRows.each((index, row) => {
                    if (saved >= MAX_ITEMS) return;

                    try {
                        const $row = $(row);
                        
                        // Extract data from data attributes and HTML
                        const jobId = $row.attr('data-id') || $row.attr('id') || null;
                        const jobUrl = $row.attr('data-url') || $row.find('a.preventLink').attr('href') || null;
                        
                        // Skip if already processed
                        if (jobId && seenJobs.has(jobId)) return;
                        if (jobId) seenJobs.add(jobId);

                        // Extract job details from table cells - multiple strategies
                        const company = $row.find('.company h3').text().trim() || 
                                      $row.find('.companyLink').text().trim() || 
                                      $row.find('h3[itemprop="name"]').text().trim() ||
                                      $row.attr('data-company') || null;
                        
                        const title = $row.find('.position').text().trim() || 
                                    $row.find('h2[itemprop="title"]').text().trim() ||
                                    $row.find('h2').first().text().trim() ||
                                    $row.attr('data-position') || null;
                        
                        const location = $row.find('.location').text().trim() || 
                                       $row.find('.region').text().trim() ||
                                       $row.attr('data-location') || 
                                       'Remote';
                        
                        // Extract tags for job type and category
                        const tags = [];
                        $row.find('.tags .tag, .tag').each((_, tag) => {
                            const tagText = $(tag).text().trim();
                            if (tagText && !tags.includes(tagText)) tags.push(tagText);
                        });

                        const job_type = tags.find(t => /full.?time|part.?time|contract|freelance|internship/i.test(t)) || null;
                        const job_category = tags.find(t => !/full.?time|part.?time|contract|freelance|internship/i.test(t)) || tags[0] || null;

                        // Extract salary/compensation
                        const salary = $row.find('.salary').text().trim() || 
                                     $row.find('[data-salary]').attr('data-salary') ||
                                     $row.find('.compensation').text().trim() || null;

                        // Extract date
                        const datePosted = $row.find('time').attr('datetime') || 
                                         $row.find('.time').text().trim() || 
                                         $row.find('time').text().trim() ||
                                         $row.attr('data-date') || null;

                        // Build job URL
                        const fullJobUrl = jobUrl ? `https://remoteok.com${jobUrl}` : null;

                        // For description, extract from row
                        const descriptionPreview = $row.find('.description').text().trim() || 
                                                  $row.find('.markdown').text().trim() ||
                                                  null;

                        const item = {
                            title: title || null,
                            company: company || null,
                            location: location || null,
                            date_posted: datePosted || null,
                            job_type: job_type || null,
                            job_category: job_category || null,
                            salary: salary || null,
                            description_html: descriptionPreview ? `<p>${descriptionPreview}</p>` : null,
                            description_text: descriptionPreview || null,
                            job_url: fullJobUrl || null,
                            tags: tags.length > 0 ? tags : null,
                        };

                        // Only save if we have at least title or company
                        if (item.title || item.company) {
                            Dataset.pushData(item);
                            saved++;
                            crawlerLog.info(`✓ Saved job ${saved}/${MAX_ITEMS}: ${item.title} at ${item.company}`);
                        } else {
                            crawlerLog.warning(`Skipped row ${index} - no title or company found`);
                        }

                    } catch (err) {
                        crawlerLog.error(`Error processing job row ${index}: ${err.message}`);
                    }
                });

                // Handle pagination
                if (saved < MAX_ITEMS && jobRows.length > 0) {
                    const pageNo = request.userData?.pageNo || 1;
                    
                    // Only paginate if we found jobs on this page
                    if (jobRows.length >= 5) {
                        // RemoteOK uses URL pattern for pagination
                        const currentUrl = new URL(request.url);
                        const nextPageNo = pageNo + 1;
                        
                        // Build next page URL
                        currentUrl.searchParams.set('page', nextPageNo);
                        const nextUrl = currentUrl.href;
                        
                        await enqueueLinks({ 
                            urls: [nextUrl], 
                            userData: { pageNo: nextPageNo } 
                        });
                        crawlerLog.info(`→ Enqueued next page ${nextPageNo}: ${nextUrl}`);
                    } else {
                        crawlerLog.info(`Stopping pagination - only ${jobRows.length} jobs found on page ${pageNo}`);
                    }
                }
            }
        });

        log.info(`🚀 Starting crawler with ${initial.length} initial URLs: ${initial.join(', ')}`);
        log.info(`📊 Settings: maxItems=${MAX_ITEMS}, searchQuery="${searchQuery}", location="${location}", dateFilter="${dateFilter}"`);

        await crawler.run(initial.map(u => ({ url: u, userData: { pageNo: 1 } })));
        
        log.info(`✅ Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
