"""Apify Actor entry point: Job Scraper (Python, JSON API).

This Actor fetches job listings from Remoteok or custom JSON API endpoints. It extracts detailed
information about job opportunities including titles, companies, locations, salaries, job types,
posting dates, and descriptions. Supports filtering by keywords, location, and date.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any, Dict, List, Optional, Set

from apify import Actor  # pyright: ignore[reportMissingImports]
import httpx


def format_salary(salary_min: Optional[int], salary_max: Optional[int]) -> Optional[str]:
    """Format salary range from Remoteok's salary_min and salary_max fields."""
    if not salary_min and not salary_max:
        return None
    
    if salary_min and salary_max:
        return f"${salary_min:,} - ${salary_max:,}"
    elif salary_min:
        return f"${salary_min:,}+"
    elif salary_max:
        return f"Up to ${salary_max:,}"
    return None


async def main() -> None:
    """Remoteok job scraper main entry."""
    async with Actor:
        actor_input = await Actor.get_input() or {}

        # Get input parameters
        url: str = (actor_input.get('url') or '').strip()
        keyword: str = (actor_input.get('keyword') or '').strip()
        location: str = (actor_input.get('location') or '').strip()
        job_date: str = (actor_input.get('jobDate') or '').strip()
        max_jobs: int = int(actor_input.get('maxJobs') or 0)
        
        # Remoteok doesn't have traditional pagination - all jobs are in one JSON response
        # We'll implement our own pagination by processing jobs in batches
        batch_size: int = int(actor_input.get('batchSize') or 50)
        
        # Get proxy configuration
        proxy_config = actor_input.get('proxyConfiguration')
        proxy_url = None
        effective_proxy: Optional[str] = None
        
        if proxy_config:
            use_apify_proxy = proxy_config.get('useApifyProxy', False)
            if use_apify_proxy:
                # Get Apify proxy URL from the Actor configuration
                proxy_url = Actor.create_proxy_configuration(actor_proxy_input=proxy_config)
                if proxy_url:
                    Actor.log.info('Using Apify Proxy to avoid IP blocking')
            elif proxy_config.get('proxyUrls'):
                # Use custom proxy if provided
                proxy_urls = proxy_config.get('proxyUrls', [])
                if proxy_urls:
                    proxy_url = random.choice(proxy_urls)
                    Actor.log.info(f'Using custom proxy')
        
        # Validate that at least one filter is provided
        if not any([url, keyword, location, job_date]):
            Actor.log.info('Provide at least one filter: url, keyword, location, or jobDate. Exiting...')
            await Actor.exit()

        # Set API URL - use custom URL if provided, otherwise use Remoteok default
        if url:
            api_url = url
            Actor.log.info(f'Using custom API URL: {api_url}')
        else:
            api_url = 'https://remoteok.com/remote-jobs.json'
            Actor.log.info(f'Using default Remoteok API: {api_url}')
        
        # Configure HTTP client
        client_kwargs = {
            'timeout': 30.0,
            'follow_redirects': True,
        }
        
        if proxy_url:
            # For Apify proxy, we need to get the actual proxy URL string
            if hasattr(proxy_url, 'new_url'):
                # ProxyConfiguration object - get a new URL for each session
                proxy_str = await proxy_url.new_url()
                client_kwargs['proxies'] = proxy_str
                effective_proxy = proxy_str
                Actor.log.info(f'Configured session with Apify Proxy')
            elif isinstance(proxy_url, str):
                client_kwargs['proxies'] = proxy_url
                effective_proxy = proxy_url
                Actor.log.info(f'Configured session with custom proxy')
        
        async with httpx.AsyncClient(**client_kwargs) as session:
            Actor.log.info(f'Fetching jobs from API: {api_url}')
            
            # Fetch all jobs from the JSON API
            response = await session.get(api_url)
            if response.status_code != 200:
                Actor.log.error(f'Failed to fetch jobs from API. Status: {response.status_code}')
                await Actor.exit()
            
            try:
                jobs_data = response.json()
            except Exception as e:
                Actor.log.error(f'Failed to parse JSON response: {e}')
                await Actor.exit()
            
            # Remove the first item which contains API terms (Remoteok specific)
            if not url and jobs_data and isinstance(jobs_data[0], dict) and 'legal' in jobs_data[0]:
                jobs_data = jobs_data[1:]
            
            Actor.log.info(f'Fetched {len(jobs_data)} jobs from API')
            
            total_pushed = 0
            seen_urls: Set[str] = set()
            
            # Process jobs in batches
            for i in range(0, len(jobs_data), batch_size):
                batch = jobs_data[i:i + batch_size]
                batch_jobs = 0
                
                for job_data in batch:
                    # Apply filters
                    should_include = True
                    
                    # Filter by keyword if provided
                    if keyword:
                        # Check if keyword appears in position, company, description, or tags
                        searchable_text = ' '.join([
                            job_data.get('position', ''),
                            job_data.get('company', ''),
                            job_data.get('description', ''),
                            ' '.join(job_data.get('tags', []))
                        ]).lower()
                        
                        if keyword.lower() not in searchable_text:
                            should_include = False
                    
                    # Filter by location if provided
                    if should_include and location:
                        job_location = job_data.get('location', '').lower()
                        if location.lower() not in job_location:
                            should_include = False
                    
                    # Filter by job date if provided
                    if should_include and job_date:
                        job_posting_date = job_data.get('date', '')
                        if job_posting_date < job_date:
                            should_include = False
                    
                    # Skip job if it doesn't match filters
                    if not should_include:
                        continue
                    
                    # Convert Remoteok job data to our standardized format
                    job_item = {
                        'job_title': job_data.get('position', ''),
                        'company': job_data.get('company', ''),
                        'location': job_data.get('location', 'Remote'),
                        'date_posted': job_data.get('date', ''),
                        'job_type': 'Remote',  # All Remoteok jobs are remote
                        'job_url': job_data.get('url', ''),
                        'description_text': job_data.get('description', ''),
                        'description_html': None,  # Remoteok provides plain text
                        'salary': format_salary(job_data.get('salary_min', None), job_data.get('salary_max', None)),
                        'tags': job_data.get('tags', []),
                        'source_url': api_url,
                        'remoteok_id': job_data.get('id'),
                        'company_logo': job_data.get('company_logo', ''),
                    }
                    
                    # Skip if no URL or already seen
                    job_url = job_item.get('job_url')
                    if not job_url or job_url in seen_urls:
                        continue
                    
                    await Actor.push_data(job_item)
                    total_pushed += 1
                    batch_jobs += 1
                    seen_urls.add(job_url)
                    
                    # Check max jobs limit
                    if max_jobs > 0 and total_pushed >= max_jobs:
                        break
                
                Actor.log.info(f'Processed batch {i//batch_size + 1}: pushed {batch_jobs} jobs (total {total_pushed})')
                
                # Check max jobs limit
                if max_jobs > 0 and total_pushed >= max_jobs:
                    Actor.log.info(f'Reached maxJobs limit ({max_jobs}). Stopping.')
                    break
                
                # Small delay between batches to be respectful
                if i + batch_size < len(jobs_data):
                    await asyncio.sleep(0.5)
            
            Actor.log.info(f'Scrape complete. Total items: {total_pushed}.')