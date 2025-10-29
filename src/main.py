"""
RemoteOK Job Scraper (Full Stealth + Pagination)
Stack: Python + Crawlee + BeautifulSoup + StealthKit + curl_cffi[http2] + lxml
Author: Jobs Counsel
Description:
    - Scrapes multiple pages of RemoteOK without Cloudflare blocking.
    - Uses stealth TLS (curl_cffi) and Chrome fingerprint emulation.
    - Extracts title, company, location, type, tags, salary, and descriptions.
    - Supports filters (keyword, location, date) and pagination.
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
from stealthkit import StealthConfig, StealthMiddleware


# ===================== CONFIG ===================== #
REMOTEOK_URL = "https://remoteok.com/remote-jobs"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; rv:118.0) Gecko/20100101 Firefox/118.0",
]

DATE_WINDOWS = {"today": 1, "week": 7, "month": 31}


# ===================== CORE SCRAPER ===================== #
async def fetch_html(session: AsyncSession, url: str) -> str:
    """Stealth fetch with realistic headers."""
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://google.com/",
        "Connection": "keep-alive",
    }

    resp = await session.get(url, headers=headers, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch {url} (HTTP {resp.status_code})")
    return resp.text


def parse_jobs(html: str) -> List[Dict[str, Any]]:
    """Parse job cards from RemoteOK HTML."""
    soup = BeautifulSoup(html, "lxml")
    job_rows = soup.select("tr.job")
    jobs: List[Dict[str, Any]] = []

    for row in job_rows:
        try:
            title = row.select_one('h2[itemprop="title"]')
            company = row.select_one('h3[itemprop="name"]')
            link = row.select_one("a.preventLink")
            if not (title and company and link):
                continue

            job = {
                "job_title": title.text.strip(),
                "company": company.text.strip(),
                "job_url": f"https://remoteok.com{link['href']}" if link.get("href") else None,
                "location": (row.select_one(".location") or {}).get_text(strip=True) or "Worldwide",
                "tags": [t.text.strip() for t in row.select(".tags .tag")],
                "logo": (row.select_one("img.logo") or {}).get("data-src")
                or (row.select_one("img.logo") or {}).get("src"),
                "date_posted": (row.select_one("time") or {}).get("datetime"),
                "description_html": str(row.select_one(".description, .expandContents") or ""),
                "description_text": (row.select_one(".description, .expandContents") or {}).get_text(strip=True),
                "source_url": REMOTEOK_URL,
                "collected_at": datetime.utcnow().isoformat(),
            }
            # Guess job type
            job_type = None
            for tag in job["tags"]:
                if "full" in tag.lower():
                    job_type = "Full-time"
                elif "part" in tag.lower():
                    job_type = "Part-time"
                elif "contract" in tag.lower():
                    job_type = "Contract"
            job["job_type"] = job_type or "Remote"
            jobs.append(job)
        except Exception:
            continue
    return jobs


def filter_jobs(
    jobs: List[Dict[str, Any]],
    keyword: Optional[str],
    location: Optional[str],
    date_filter: Optional[str],
) -> List[Dict[str, Any]]:
    """Apply filters for keyword, location, and posting age."""
    now = datetime.utcnow()
    days = DATE_WINDOWS.get(date_filter)
    filtered = []
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
        filtered.append(j)
    return filtered


def next_page_url(current_url: str) -> str:
    """Increment page parameter (pg=) for pagination."""
    parts = urlparse(current_url)
    qs = parse_qs(parts.query)
    page = int(qs.get("pg", [1])[0]) + 1
    qs["pg"] = [str(page)]
    return urlunparse(parts._replace(query=urlencode(qs, doseq=True)))


async def random_delay(min_ms=700, max_ms=1500):
    await asyncio.sleep(random.uniform(min_ms, max_ms) / 1000)


# ===================== MAIN ACTOR ===================== #
async def main() -> None:
    """Main Apify Actor entrypoint."""
    async with Actor:
        actor_input = await Actor.get_input() or {}
        keyword = actor_input.get("keyword")
        location = actor_input.get("location")
        date_filter = actor_input.get("dateFilter", "all")
        max_jobs = int(actor_input.get("maxJobs", 200))
        max_pages = int(actor_input.get("maxPages", 10))
        proxy_conf = actor_input.get("proxyConfiguration")

        proxies = None
        if proxy_conf and proxy_conf.get("proxyUrls"):
            proxies = random.choice(proxy_conf["proxyUrls"])

        stealth = StealthConfig(browser="chrome")
        async with AsyncSession(
            impersonate="chrome120",
            http2=True,
            proxies=proxies,
            timeout=60,
            middleware=[StealthMiddleware(stealth)],
        ) as session:
            page_url = REMOTEOK_URL
            seen: Set[str] = set()
            total_saved = 0

            for page in range(1, max_pages + 1):
                Actor.log.info(f"🌐 Fetching page {page}: {page_url}")
                try:
                    html = await fetch_html(session, page_url)
                except Exception as e:
                    Actor.log.warning(f"❌ Failed to fetch {page_url}: {e}")
                    break

                jobs = parse_jobs(html)
                if not jobs:
                    Actor.log.info("No more jobs found, stopping pagination.")
                    break

                filtered = filter_jobs(jobs, keyword, location, date_filter)
                Actor.log.info(f"Page {page}: {len(filtered)} / {len(jobs)} jobs matched filters.")

                for job in filtered:
                    if total_saved >= max_jobs:
                        break
                    if job["job_url"] in seen:
                        continue
                    seen.add(job["job_url"])
                    await Actor.push_data(job)
                    total_saved += 1
                    Actor.log.info(f"✅ Saved {total_saved}/{max_jobs}: {job['job_title']} @ {job['company']}")
                if total_saved >= max_jobs:
                    break

                await random_delay(800, 2000)
                page_url = next_page_url(page_url)

            Actor.log.info(f"🎯 Finished. Collected {total_saved} job postings.")


if __name__ == "__main__":
    asyncio.run(main())
