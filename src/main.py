"""
RemoteOK job scraper (Python version)
Stack: Crawlee + BeautifulSoup + StealthKit + curl_cffi + httpx[http2] + lxml
Fetches job listings directly from RemoteOK HTML pages with anti-blocking.
Extracts: job title, company, location, job type, salary, description_html/text, logo, and tags.
"""

from __future__ import annotations
import asyncio
import random
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from apify import Actor  # type: ignore
from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession
from stealthkit import StealthConfig, StealthMiddleware  # stealthkit helps bypass Cloudflare


# ---------------- CONFIG ---------------- #
REMOTEOK_URL = "https://remoteok.com/remote-jobs"
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; rv:118.0) Gecko/20100101 Firefox/118.0",
]


def format_salary(min_salary: Optional[int], max_salary: Optional[int]) -> Optional[str]:
    if not min_salary and not max_salary:
        return None
    if min_salary and max_salary:
        return f"${min_salary:,} - ${max_salary:,}"
    if min_salary:
        return f"${min_salary:,}+"
    return f"Up to ${max_salary:,}" if max_salary else None


# ---------------- SCRAPER ---------------- #
async def fetch_html(session: AsyncSession, url: str) -> str:
    """Fetch HTML content with stealth headers."""
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://google.com/",
        "Connection": "keep-alive",
    }

    resp = await session.get(url, headers=headers, timeout=45)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch {url}, status {resp.status_code}")
    return resp.text


def parse_jobs_from_html(html: str) -> List[Dict[str, Any]]:
    """Extract job listings from RemoteOK HTML."""
    soup = BeautifulSoup(html, "lxml")
    job_rows = soup.select("tr.job")
    jobs: List[Dict[str, Any]] = []

    for row in job_rows:
        try:
            title_tag = row.select_one('h2[itemprop="title"]')
            company_tag = row.select_one('h3[itemprop="name"]')
            link_tag = row.select_one('a.preventLink')

            title = title_tag.text.strip() if title_tag else None
            company = company_tag.text.strip() if company_tag else None
            url = f"https://remoteok.com{link_tag['href']}" if link_tag and link_tag.get("href") else None
            if not title or not company or not url:
                continue

            location_tag = row.select_one(".location")
            location = location_tag.text.strip() if location_tag else "Worldwide"

            time_tag = row.select_one("time")
            date_posted = time_tag["datetime"] if time_tag and time_tag.has_attr("datetime") else None

            tags = [t.text.strip() for t in row.select(".tags .tag")]
            desc_html = row.select_one(".description, .expandContents")
            description_html = str(desc_html) if desc_html else None
            description_text = desc_html.get_text(strip=True) if desc_html else None

            salary = format_salary(None, None)  # RemoteOK hides salary in HTML

            logo_tag = row.select_one("img.logo")
            logo = logo_tag.get("data-src") or logo_tag.get("src") if logo_tag else None

            job_type = None
            for tag in tags:
                if "full" in tag.lower():
                    job_type = "Full-time"
                elif "part" in tag.lower():
                    job_type = "Part-time"
                elif "contract" in tag.lower():
                    job_type = "Contract"

            jobs.append(
                {
                    "job_title": title,
                    "company": company,
                    "location": location,
                    "job_type": job_type or "Remote",
                    "job_url": url,
                    "description_html": description_html,
                    "description_text": description_text,
                    "tags": tags,
                    "salary": salary,
                    "logo": logo,
                    "date_posted": date_posted,
                    "source_url": REMOTEOK_URL,
                    "collected_at": datetime.utcnow().isoformat(),
                }
            )
        except Exception:
            continue

    return jobs


def filter_jobs(
    jobs: List[Dict[str, Any]],
    keyword: Optional[str],
    location: Optional[str],
    date_filter: Optional[str],
) -> List[Dict[str, Any]]:
    """Apply filters: keyword, location, and date window."""
    now = datetime.utcnow()
    window_map = {"today": 1, "week": 7, "month": 31}
    days_limit = window_map.get(date_filter, None)

    filtered = []
    for job in jobs:
        text = " ".join(
            [
                job.get("job_title", ""),
                job.get("company", ""),
                job.get("location", ""),
                " ".join(job.get("tags", [])),
                job.get("description_text", "") or "",
            ]
        ).lower()

        if keyword and keyword.lower() not in text:
            continue

        if location and location.lower() not in (job.get("location", "")).lower():
            continue

        if days_limit and job.get("date_posted"):
            try:
                dt = datetime.fromisoformat(job["date_posted"])
                if (now - dt).days > days_limit:
                    continue
            except Exception:
                pass

        filtered.append(job)
    return filtered


# ---------------- MAIN ---------------- #
async def main() -> None:
    """Entry point for Apify actor."""
    async with Actor:
        actor_input = await Actor.get_input() or {}
        keyword = actor_input.get("keyword")
        location = actor_input.get("location")
        date_filter = actor_input.get("dateFilter", "all")
        max_jobs = int(actor_input.get("maxJobs") or 100)

        proxy_config = actor_input.get("proxyConfiguration")
        proxies = None
        if proxy_config and proxy_config.get("proxyUrls"):
            proxies = random.choice(proxy_config["proxyUrls"])

        stealth = StealthConfig(browser="chrome")
        async with AsyncSession(
            impersonate="chrome110",
            http2=True,
            proxies=proxies,
            timeout=45,
            middleware=[StealthMiddleware(stealth)],
        ) as session:
            Actor.log.info("Fetching RemoteOK page with stealth...")
            html = await fetch_html(session, REMOTEOK_URL)
            jobs = parse_jobs_from_html(html)
            Actor.log.info(f"Fetched {len(jobs)} jobs from RemoteOK HTML.")

            filtered = filter_jobs(jobs, keyword, location, date_filter)
            Actor.log.info(f"{len(filtered)} jobs matched filters.")

            total = 0
            for job in filtered[:max_jobs]:
                await Actor.push_data(job)
                total += 1

            Actor.log.info(f"✅ Scrape complete. Pushed {total} jobs.")


if __name__ == "__main__":
    asyncio.run(main())
