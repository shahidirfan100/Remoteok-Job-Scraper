# RemoteOK Job Scraper

<div align="center">
  <img src="https://apify.com/assets/img/apify_logo.svg" alt="Apify logo" width="200" height="auto">
</div>

## 📋 Description

This Apify actor scrapes job listings from [RemoteOK](https://remoteok.com/remote-jobs), a popular remote job board. It collects comprehensive job data including title, company, location, job type, category, salary, and posting date. The actor also extracts both HTML and plain text versions of each job description for maximum flexibility.

The scraper runs entirely on the Apify platform and can be customized to limit the number of results, define start URLs, and configure proxies for higher volume scraping.

## ✨ Features

- **Comprehensive Data Extraction**: Collects all essential job fields including category, type, and salary information
- **Dual Description Formats**: Provides both formatted HTML and clean plain text job descriptions
- **Flexible Input Options**: Supports custom start URLs or keyword-based searches with location and date filtering
- **Automatic Pagination**: Handles RemoteOK's pagination system seamlessly
- **Proxy Support**: Configurable proxy settings for stable, high-volume scraping
- **Anti-Bot Protection**: Implements advanced stealth techniques including randomized timing, session rotation, and realistic headers
- **Cloud-Native**: Runs entirely on Apify platform without local dependencies

## 🚀 Usage

### Basic Usage

1. **On Apify Platform**:
   - Go to [RemoteOK Job Scraper](https://apify.com/your-actor-link) on Apify
   - Click "Run" to start with default settings
   - View results in the Dataset tab

2. **Via API**:
   ```bash
   curl -X POST "https://api.apify.com/v2/acts/your-actor-id/runs" \
        -H "Authorization: Bearer YOUR_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{}'
   ```

### Input Configuration

The actor accepts the following input parameters:

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `startUrls` | Array of strings | Custom RemoteOK listing URLs to start scraping from | `[]` |
| `searchQuery` | String | Keyword to filter job searches | `""` |
| `location` | String | Location filter for job searches | `""` |
| `dateFilter` | String | Filter jobs by posting date (`all`, `today`, `week`, `month`) | `"all"` |
| `maxItems` | Integer | Maximum number of job listings to collect | `100` |
| `proxyConfiguration` | Object | Proxy settings for stable scraping | Residential proxy |

### Example Input

```json
{
  "searchQuery": "software engineer",
  "location": "San Francisco",
  "dateFilter": "week",
  "maxItems": 50,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## 📊 Output

Each scraped job is saved as a JSON object in the Apify dataset with the following structure:

```json
{
  "title": "Frontend Engineer",
  "company": "Acme Corp",
  "location": "Remote",
  "date_posted": "2025-10-18",
  "job_type": "Full-time",
  "job_category": "Engineering",
  "salary": "$120k – $150k",
  "description_html": "<div><p>We are hiring a frontend engineer...</p></div>",
  "description_text": "We are hiring a frontend engineer...",
  "job_url": "https://remoteok.com/remote-jobs/12345"
}
```

### Output Fields

- **`title`** *(string)*: Job position title
- **`company`** *(string)*: Hiring company name
- **`location`** *(string)*: Job location (e.g., "Remote", "Worldwide")
- **`date_posted`** *(string)*: Publication date in ISO format
- **`job_type`** *(string)*: Employment type (e.g., "Full-time", "Contract")
- **`job_category`** *(string)*: Job category (e.g., "Engineering", "Design")
- **`salary`** *(string)*: Salary range or information
- **`description_html`** *(string)*: Full job description in HTML format
- **`description_text`** *(string)*: Plain text version of job description
- **`job_url`** *(string)*: Direct link to the job posting

## ⚙️ Configuration

### Proxy Configuration

For optimal performance and to avoid rate limiting, configure Apify Proxy:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "US"
  }
}
```

### Limiting Results

Control the number of jobs collected:

```json
{
  "maxItems": 1000
}
```

### Custom Search URLs

Start from specific RemoteOK pages:

```json
{
  "startUrls": [
    "https://remoteok.com/remote-jobs?search=developer",
    "https://remoteok.com/remote-jobs?page=2"
  ]
}
```

### Location and Date Filtering

When using keyword search, you can filter by location and posting date:

```json
{
  "searchQuery": "developer",
  "location": "Europe",
  "dateFilter": "week"
}
```

## 📈 Examples

### Scrape Recent Software Engineering Jobs

```json
{
  "searchQuery": "software engineer",
  "maxItems": 200
}
```

### Scrape from Specific Category Pages

```json
{
  "startUrls": [
    "https://remoteok.com/remote-jobs?category=engineering"
  ],
  "maxItems": 500
}
```

### High-Volume Scraping with Proxies

```json
{
  "searchQuery": "remote",
  "maxItems": 10000,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## 📝 Notes

- The actor respects RemoteOK's terms of service and implements reasonable delays between requests
- Advanced anti-detection measures are applied including randomized user agents, session management, and human-like browsing patterns
- For large-scale scraping, use residential proxies to ensure stability
- Results are automatically deduplicated based on job URLs
- The actor handles RemoteOK's dynamic content loading and pagination
- If RemoteOK updates their site structure, the actor may need updates to maintain compatibility

## 🆘 Troubleshooting

### Common Issues

**Low success rate**: Ensure proxy configuration is enabled for residential proxies.

**Missing data**: Some jobs may not have all fields populated on RemoteOK.

**Rate limiting**: Reduce `maxItems` or add delays if encountering blocks.

### Support

For issues or feature requests, please create an issue in the actor's repository or contact Apify support.

---

<div align="center">
  <p>Built with ❤️ on the <a href="https://apify.com">Apify Platform</a></p>
</div>