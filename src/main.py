"""
RemoteOK Job Scraper (Full Stealth + Pagination)
Stack: Python + Crawlee + BeautifulSoup + StealthKit + curl_cffi[http2] + lxml
Author: Jobs Counsel
"""

from __future__ import annotations
import asyncio
import random
from datetime import datetime
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from apify import Actor
from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession

# --- UNIVERSAL STEALTHKIT IMPORT (works with all versions) ---
try:
    from stealthkit.stealth import StealthConfig, StealthMiddleware  # ≥0.4
except ImportError:
    try:
        from stealthkit import StealthConfig, StealthMiddleware      # 0.3.x
    except ImportError:
        try:
            from stealthkit.config import StealthConfig               # <0.3
            from stealthkit.middleware import StealthMiddleware
        except ImportError:
            # fallback dummy classes to allow script to run without stealthkit
            class StealthConfig:
                def __init__(self, *_, **__): ...
            class StealthMiddleware:
                def __init__(self, *_, **__): ...
            print("[WARN] ⚠️ StealthKit not fully available; using dummy classes.")

# ============================================================ #
#                        CONFIGURATION                         #
# ============================================================ #

REMOTEOK_URL = "https://remoteok.com/remote-jobs"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; rv:118.0) Gecko/20100101 Firefox/118.0",
]

DATE_WINDOWS = {"today": 1, "week": 7, "month": 31}


# ============================================================ #
#                        SCRAPER CORE                          #
# ============================================================ #

async def fetch_html(session: AsyncSession, url: str, retries: int = 3) -> str:
    """Fetch HTML with retry logic and enhanced headers to avoid 403 blocks."""
    for attempt in range(retries):
        try:
            headers = {
                "User-Agent": random.choice(USER_AGENTS),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Referer": "https://www.google.com/",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "DNT": "1",
            }
            resp = await session.get(url, headers=headers, timeout=60, allow_redirects=True)
            
            if resp.status_code == 403:
                Actor.log.warning(f"⚠️ 403 Forbidden on attempt {attempt + 1}/{retries}. Waiting before retry...")
                await asyncio.sleep(random.uniform(2, 5))
                continue
                
            if resp.status_code == 429:
                Actor.log.warning(f"⚠️ Rate limited (429). Waiting 10 seconds...")
                await asyncio.sleep(10)
                continue
                
            if resp.status_code != 200:
                Actor.log.warning(f"❌ Unexpected status {resp.status_code} on attempt {attempt + 1}/{retries}")
                if attempt < retries - 1:
                    await asyncio.sleep(random.uniform(1, 3))
                    continue
                raise RuntimeError(f"Failed to fetch {url} (status {resp.status_code})")
                
            return resp.text
            
        except Exception as e:
            Actor.log.warning(f"⚠️ Error on attempt {attempt + 1}/{retries}: {e}")
            if attempt < retries - 1:
                await asyncio.sleep(random.uniform(2, 4))
            else:
                raise
    
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts")


def parse_jobs(html: str) -> List[Dict[str, Any]]:
    """Parse job listings from RemoteOK HTML with robust selectors."""
    soup = BeautifulSoup(html, "lxml")
    jobs = []
    
    # RemoteOK uses tr.job for job rows
    job_rows = soup.select("tr.job")
    
    if not job_rows:
        Actor.log.warning("⚠️ No job rows found with selector 'tr.job'. Page structure may have changed.")
        return jobs
    
    Actor.log.info(f"Found {len(job_rows)} job rows on page")
    
    for idx, row in enumerate(job_rows, 1):
        try:
            # Try multiple selectors for robustness
            title_elem = row.select_one('h2[itemprop="title"]') or row.select_one('h2.title') or row.select_one('td.company_and_position h2')
            company_elem = row.select_one('h3[itemprop="name"]') or row.select_one('h3.company') or row.select_one('td.company_and_position h3')
            link_elem = row.select_one("a.preventLink") or row.select_one("td.company_and_position a")
            
            if not title_elem or not company_elem:
                Actor.log.debug(f"Job row {idx}: Missing title or company, skipping")
                continue

            # Extract job URL
            job_url = None
            if link_elem and link_elem.get("href"):
                href = link_elem["href"]
                job_url = href if href.startswith("http") else f"https://remoteok.com{href}"
            elif row.get("data-url"):
                job_url = f"https://remoteok.com{row['data-url']}"
            
            if not job_url:
                Actor.log.debug(f"Job row {idx}: No URL found, skipping")
                continue

            # Extract location
            location = "Worldwide"
            location_elem = row.select_one(".location") or row.select_one("td.location")
            if location_elem:
                location = location_elem.get_text(strip=True) or "Worldwide"

            # Extract tags
            tags = []
            tag_elems = row.select(".tags .tag") or row.select("td.tags .tag")
            tags = [t.get_text(strip=True) for t in tag_elems if t.get_text(strip=True)]

            # Extract logo
            logo = None
            logo_elem = row.select_one("img.logo") or row.select_one("td.logo img")
            if logo_elem:
                logo = logo_elem.get("data-src") or logo_elem.get("src")

            # Extract date posted
            date_posted = None
            time_elem = row.select_one("time")
            if time_elem:
                date_posted = time_elem.get("datetime")

            # Extract description
            description_elem = row.select_one(".description") or row.select_one(".expandContents")
            description_html = str(description_elem) if description_elem else ""
            description_text = description_elem.get_text(strip=True) if description_elem else ""

            job = {
                "job_title": title_elem.get_text(strip=True),
                "company": company_elem.get_text(strip=True),
                "job_url": job_url,
                "location": location,
                "tags": tags,
                "logo": logo,
                "date_posted": date_posted,
                "description_html": description_html,
                "description_text": description_text,
                "source_url": REMOTEOK_URL,
                "collected_at": datetime.utcnow().isoformat(),
            }

            # Derive job type from tags
            job_type = None
            for tag in tags:
                tag_low = tag.lower()
                if "full" in tag_low or "fulltime" in tag_low:
                    job_type = "Full-time"
                    break
                elif "part" in tag_low or "parttime" in tag_low:
                    job_type = "Part-time"
                    break
                elif "contract" in tag_low:
                    job_type = "Contract"
                    break
            job["job_type"] = job_type or "Remote"

            jobs.append(job)
            
        except Exception as e:
            Actor.log.debug(f"Error parsing job row {idx}: {e}")
            continue
            
    return jobs


def filter_jobs(jobs: List[Dict[str, Any]], keyword=None, location=None, date_filter=None):
    now = datetime.utcnow()
    days = DATE_WINDOWS.get(date_filter)
    result = []
    for j in jobs:
        text = " ".join(
            [
                j.get("job_title", ""),
                j.get("company", ""),
                j.get("location", ""),
                " ".join(j.get("tags", [])),
                j.get("description_text", ""),
            ]
        ).lower()

        if keyword and keyword.lower() not in text:
            continue
        if location and location.lower() not in j.get("location", "").lower():
            continue
        if days and j.get("date_posted"):
            try:
                dt = datetime.fromisoformat(j["date_posted"])
                if (now - dt).days > days:
                    continue
            except Exception:
                pass
        result.append(j)
    return result


def next_page_url(current_url: str) -> str:
    parts = urlparse(current_url)
    qs = parse_qs(parts.query)
    page = int(qs.get("pg", [1])[0]) + 1
    qs["pg"] = [str(page)]
    return urlunparse(parts._replace(query=urlencode(qs, doseq=True)))


async def random_delay(min_ms=1500, max_ms=3000):
    """Add random delay to appear more human-like and avoid rate limiting."""
    delay = random.uniform(min_ms, max_ms) / 1000
    Actor.log.debug(f"Waiting {delay:.2f}s before next request...")
    await asyncio.sleep(delay)


# ============================================================ #
#                            MAIN                              #
# ============================================================ #

async def main() -> None:
    async with Actor:
        inp = await Actor.get_input() or {}
        keyword = inp.get("keyword")
        location = inp.get("location")
        date_filter = inp.get("dateFilter", "all")
        max_jobs = int(inp.get("maxJobs", 200))
        max_pages = int(inp.get("maxPages", 10))
        proxy_conf = inp.get("proxyConfiguration")

        proxies = None
        if proxy_conf and proxy_conf.get("proxyUrls"):
            proxies = random.choice(proxy_conf["proxyUrls"])

        stealth = StealthConfig(browser="chrome")
        async with AsyncSession(
            impersonate="chrome120",
            proxies=proxies,
            timeout=60,
        ) as session:

            page_url = REMOTEOK_URL
            seen: Set[str] = set()
            total_saved = 0
            consecutive_empty = 0

            for page in range(1, max_pages + 1):
                Actor.log.info(f"🌐 Fetching page {page}: {page_url}")
                
                # Add delay before each page request (except first)
                if page > 1:
                    await random_delay(2000, 4000)
                
                try:
                    html = await fetch_html(session, page_url)
                except Exception as e:
                    Actor.log.error(f"❌ Failed to fetch page {page}: {e}")
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        Actor.log.warning("Too many consecutive failures, stopping pagination.")
                        break
                    continue

                jobs = parse_jobs(html)
                if not jobs:
                    Actor.log.warning(f"No jobs found on page {page}")
                    consecutive_empty += 1
                    if consecutive_empty >= 3:
                        Actor.log.info("No jobs found on 3 consecutive pages, stopping pagination.")
                        break
                    continue
                
                consecutive_empty = 0  # Reset counter on successful page

                
                filtered = filter_jobs(jobs, keyword, location, date_filter)
                Actor.log.info(f"📋 Page {page}: {len(filtered)}/{len(jobs)} jobs matched filters")

                new_jobs_count = 0
                for job in filtered:
                    if total_saved >= max_jobs:
                        Actor.log.info(f"🎯 Reached max jobs limit ({max_jobs})")
                        break
                    if job["job_url"] in seen:
                        Actor.log.debug(f"Skipping duplicate: {job['job_url']}")
                        continue
                    seen.add(job["job_url"])
                    await Actor.push_data(job)
                    total_saved += 1
                    new_jobs_count += 1
                    Actor.log.info(f"✅ Saved {total_saved}/{max_jobs}: {job['job_title']} @ {job['company']}")
                
                Actor.log.info(f"Page {page} complete: {new_jobs_count} new jobs saved")
                
                if total_saved >= max_jobs:
                    Actor.log.info("Max jobs limit reached, stopping scraper.")
                    break

                page_url = next_page_url(page_url)

            Actor.log.info(f"🎯 Scraping complete! Collected {total_saved} job postings total.")


if __name__ == "__main__":
    asyncio.run(main())
