"""
RemoteOK Job Scraper (JSON API + Anti-Bot Protection)
Stack: Python + Apify SDK + curl_cffi + StealthKit
Author: Jobs Counsel
"""

from __future__ import annotations
import asyncio
import random
from datetime import datetime
from typing import Any, Dict, List, Set

from apify import Actor
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

# RemoteOK uses JavaScript to render jobs, so we use their JSON API instead
REMOTEOK_API_URL = "https://remoteok.com/api"
REMOTEOK_WEB_URL = "https://remoteok.com"

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

async def fetch_json(session: AsyncSession, url: str, retries: int = 3) -> List[Dict[str, Any]]:
    """Fetch JSON data from RemoteOK API with retry logic."""
    for attempt in range(retries):
        try:
            # Rotate user agents for each attempt
            user_agent = USER_AGENTS[attempt % len(USER_AGENTS)]
            
            headers = {
                "User-Agent": user_agent,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Referer": "https://remoteok.com/",
                "Origin": "https://remoteok.com",
                "Connection": "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "DNT": "1",
            }
            
            Actor.log.debug(f"Fetching JSON from {url}")
            
            resp = await session.get(url, headers=headers, timeout=60, allow_redirects=True)
            
            Actor.log.debug(f"Response status: {resp.status_code}, Content-Length: {len(resp.text)} chars")
            
            if resp.status_code == 403:
                Actor.log.warning(f"⚠️ 403 Forbidden on attempt {attempt + 1}/{retries}. Waiting before retry...")
                await asyncio.sleep(random.uniform(3, 6))
                continue
                
            if resp.status_code == 429:
                Actor.log.warning(f"⚠️ Rate limited (429). Waiting 10 seconds...")
                await asyncio.sleep(10)
                continue
                
            if resp.status_code != 200:
                Actor.log.warning(f"❌ Unexpected status {resp.status_code} on attempt {attempt + 1}/{retries}")
                if attempt < retries - 1:
                    await asyncio.sleep(random.uniform(2, 4))
                    continue
                raise RuntimeError(f"Failed to fetch {url} (status {resp.status_code})")
            
            # Parse JSON response
            try:
                data = resp.json()
                if isinstance(data, list):
                    Actor.log.info(f"✅ Fetched {len(data)} items from API")
                    return data
                else:
                    Actor.log.warning(f"⚠️ Unexpected JSON format: {type(data)}")
                    return []
            except Exception as json_err:
                Actor.log.error(f"Failed to parse JSON: {json_err}")
                Actor.log.debug(f"Response preview: {resp.text[:500]}")
                if attempt < retries - 1:
                    await asyncio.sleep(random.uniform(2, 4))
                    continue
                raise
                    
        except Exception as e:
            Actor.log.warning(f"⚠️ Error on attempt {attempt + 1}/{retries}: {e}")
            if attempt < retries - 1:
                await asyncio.sleep(random.uniform(2, 4))
            else:
                raise
    
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts")


def parse_jobs_from_api(api_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Parse job listings from RemoteOK JSON API response."""
    jobs = []
    
    if not api_data:
        Actor.log.warning("⚠️ No data received from API")
        return jobs
    
    Actor.log.info(f"Processing {len(api_data)} items from API")
    
    for idx, item in enumerate(api_data, 1):
        try:
            # RemoteOK API: First item is often metadata, skip if it doesn't have expected job fields
            if not item.get("position") and not item.get("company"):
                Actor.log.debug(f"Item {idx}: Skipping non-job item (likely metadata)")
                continue
            
            # Extract job ID and URL
            job_id = item.get("id") or item.get("slug")
            job_url = item.get("url")
            
            if not job_url and job_id:
                job_url = f"https://remoteok.com/remote-jobs/{job_id}"
            
            if not job_url:
                Actor.log.debug(f"Item {idx}: No URL found, skipping")
                continue
            
            # Extract title (position)
            job_title = item.get("position") or item.get("title") or "Unknown Position"
            
            # Extract company
            company = item.get("company") or item.get("company_name") or "Unknown Company"
            
            # Extract location
            location = item.get("location") or "Worldwide"
            
            # Extract tags
            tags = item.get("tags") or []
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",")]
            
            # Extract logo
            logo = item.get("logo") or item.get("company_logo")
            
            # Extract date posted - handle both ISO string and epoch timestamp
            date_posted = item.get("date")
            epoch_time = item.get("epoch")
            
            # Prefer the date string if available, otherwise convert epoch
            if not date_posted and epoch_time:
                if isinstance(epoch_time, (int, float)):
                    # Convert epoch timestamp to ISO format
                    date_posted = datetime.fromtimestamp(epoch_time).isoformat()
            
            # Extract description
            description = item.get("description") or ""
            
            # Extract salary if available
            salary_min = item.get("salary_min")
            salary_max = item.get("salary_max")
            
            job = {
                "job_title": str(job_title).strip(),
                "company": str(company).strip(),
                "job_url": job_url,
                "location": location,
                "tags": tags,
                "logo": logo,
                "date_posted": str(date_posted) if date_posted else None,
                "description_html": description,
                "description_text": description,
                "salary_min": salary_min,
                "salary_max": salary_max,
                "source_url": REMOTEOK_WEB_URL,
                "collected_at": datetime.utcnow().isoformat(),
            }
            
            # Derive job type from tags
            job_type = None
            for tag in tags:
                if not isinstance(tag, str):
                    continue
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
            Actor.log.debug(f"✓ Parsed job {len(jobs)}: {job['job_title']} @ {job['company']}")
            
        except Exception as e:
            Actor.log.warning(f"Error parsing job item {idx}: {e}")
            Actor.log.debug(f"Item data: {item}")
            continue
    
    Actor.log.info(f"Successfully parsed {len(jobs)} jobs from API")
    return jobs


def filter_jobs(jobs: List[Dict[str, Any]], keyword=None, location=None, date_filter=None):
    """Filter jobs based on keyword, location, and date criteria."""
    now = datetime.utcnow()
    days = DATE_WINDOWS.get(date_filter)
    result = []
    
    for j in jobs:
        # Build searchable text from job fields
        tags_list = j.get("tags", [])
        if isinstance(tags_list, list):
            tags_text = " ".join(str(t) for t in tags_list if t)
        else:
            tags_text = str(tags_list) if tags_list else ""
            
        text = " ".join(
            [
                str(j.get("job_title", "")),
                str(j.get("company", "")),
                str(j.get("location", "")),
                tags_text,
                str(j.get("description_text", "")),
            ]
        ).lower()

        # Apply keyword filter
        if keyword and keyword.lower() not in text:
            continue
            
        # Apply location filter
        if location and location.lower() not in str(j.get("location", "")).lower():
            continue
            
        # Apply date filter
        if days and j.get("date_posted"):
            try:
                date_str = j["date_posted"]
                # Handle both ISO format and potential other formats
                if isinstance(date_str, str):
                    dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    if (now - dt).days > days:
                        continue
            except Exception as e:
                Actor.log.debug(f"Could not parse date: {j.get('date_posted')} - {e}")
                pass
                
        result.append(j)
    return result


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

            Actor.log.info(f"🌐 Fetching jobs from RemoteOK API: {REMOTEOK_API_URL}")
            
            seen: Set[str] = set()
            total_saved = 0

            try:
                # Fetch all jobs from API (RemoteOK returns all jobs in one request)
                api_data = await fetch_json(session, REMOTEOK_API_URL)
                
                # Save raw API response for debugging (first 10 items)
                if api_data:
                    await Actor.set_value("debug_api_response.json", api_data[:10], content_type="application/json")
                    Actor.log.info("Saved API response sample to key-value store for debugging")
                
                # Parse jobs from API response
                jobs = parse_jobs_from_api(api_data)
                
                if not jobs:
                    Actor.log.warning("❌ No jobs found in API response")
                    Actor.log.info(f"🎯 Scraping complete! Collected 0 job postings.")
                    return
                
                # Filter jobs based on criteria
                filtered = filter_jobs(jobs, keyword, location, date_filter)
                Actor.log.info(f"📋 Filtered: {len(filtered)}/{len(jobs)} jobs matched filters")

                # Save filtered jobs
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
                    Actor.log.info(f"✅ Saved {total_saved}/{max_jobs}: {job['job_title']} @ {job['company']}")

                Actor.log.info(f"🎯 Scraping complete! Collected {total_saved} job postings total.")
                
            except Exception as e:
                Actor.log.error(f"❌ Failed to fetch or parse jobs: {e}")
                raise


if __name__ == "__main__":
    asyncio.run(main())
