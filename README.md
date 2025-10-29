# Remoteok Job Scraper

This Apify Actor scrapes remote job listings from [Remoteok.com](https://remoteok.com), a popular platform for remote work opportunities. It extracts detailed information about remote jobs including titles, companies, locations, salaries, job types, posting dates, and descriptions.

## Features

- **Keyword Filtering**: Filter remote jobs using specific keywords (e.g., "python developer", "designer")
- **JSON API**: Uses Remoteok's official JSON API for fast and reliable data extraction
- **Comprehensive Data**: Extracts detailed job information including:
  - Job title and URL
  - Company name and logo
  - Location (all remote jobs)
  - Salary range information
  - Job tags and categories
  - Posting date
  - Full job description
- **Batch Processing**: Processes jobs in configurable batches for optimal performance
- **Duplicate Prevention**: Automatically avoids duplicate job listings
- **Remote Focus**: All jobs are remote work opportunities

## Input Parameters

- **keyword** (optional): Keyword to filter jobs by. Searches across job titles, companies, descriptions, and tags. If empty, returns all remote jobs.
- **maxJobs**: Maximum number of jobs to collect (default: 100, 0 = unlimited)
- **batchSize**: Number of jobs to process in each batch (default: 50)
- **proxyConfiguration**: Proxy settings for API access (optional)

## Output

The Actor outputs structured JSON data for each job listing to the default dataset. Each item contains:

## Output

The Actor outputs structured JSON data for each job listing to the default dataset. Each item contains:

```json
{
  "job_title": "Senior Python Developer",
  "company": "Tech Startup Inc",
  "location": "Remote",
  "date_posted": "2025-10-28T14:00:19+00:00",
  "job_type": "Remote",
  "job_url": "https://remoteok.com/remote-jobs/senior-python-developer-tech-startup-inc-123456",
  "description_text": "We are looking for a senior Python developer to join our remote team...",
  "description_html": null,
  "salary": "$80,000 - $120,000",
  "tags": ["python", "django", "remote", "senior"],
  "source_url": "https://remoteok.com/remote-jobs.json",
  "remoteok_id": "123456",
  "company_logo": "https://remoteok.com/assets/logo.png"
}

## Quick Start

### Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run the Actor locally:
   ```bash
   apify run
   ```

### Deploy to Apify

1. Login to Apify:
   ```bash
   apify login
   ```

2. Push the Actor:
   ```bash
   apify push
   ```

## Usage Example

To scrape Python developer remote jobs:

```json
{
  "keyword": "python developer",
  "maxJobs": 50,
  "batchSize": 25
}
```

To scrape all remote jobs (no keyword filter):

```json
{
  "maxJobs": 100
}
```

## Dependencies

- apify
- beautifulsoup4
- requests-html
- lxml
- stealthkit (optional, for enhanced stealth)

## Project Structure

```
.actor/
├── actor.json           # Actor configuration
├── input_schema.json    # Input validation schema
├── output_schema.json   # Output schema definition
└── dataset_schema.json  # Dataset structure and views
src/
└── main.py             # Main scraper logic
requirements.txt        # Python dependencies
Dockerfile             # Container definition
README.md              # This file
```

## Dependencies

- apify
- httpx
- curl-cffi (optional, for enhanced TLS impersonation)

## Resources

- [Apify Platform Documentation](https://docs.apify.com/platform)
- [Apify Python SDK](https://docs.apify.com/sdk/python/)
- [Remoteok Job Board](https://remoteok.com)