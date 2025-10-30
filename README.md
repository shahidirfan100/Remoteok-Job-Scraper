# RemoteOK Job Scraper

This Apify Actor scrapes remote job listings from [Remoteok.com](https://remoteok.com), a popular platform for remote work opportunities. It extracts detailed information about remote jobs including titles, companies, locations, salaries, job types, posting dates, and descriptions.

## Key Features

- **Keyword Filtering**: Filter remote jobs using specific keywords (e.g., "python developer", "designer").
- **Location Filtering**: Filter jobs by a specific location.
- **Date Filtering**: Filter jobs by when they were posted.
- **Fast and Reliable**: Uses RemoteOK's official JSON API for fast and reliable data extraction.
- **Comprehensive Data**: Extracts detailed job information.
- **Proxy Support**: Supports using proxies to prevent blocking.

## Input

The actor's behavior can be configured using the following input fields:

| Field | Type | Description | Default Value |
|---|---|---|---|
| `keyword` | string | Keyword to filter jobs (e.g., 'python', 'developer', 'designer'). If empty, all jobs will be returned. The keyword is matched against job titles, companies, descriptions, and tags. | `developer` |
| `location` | string | Filter jobs by location (e.g., 'San Francisco', 'New York', 'Remote'). Case-insensitive partial matching. | |
| `dateFilter` | string | Filter jobs by posting date. Possible values are `all`, `today`, `week`, `month`. | `all` |
| `maxJobs` | integer | Maximum number of jobs to collect. | `200` |
| `proxyConfiguration` | object | Proxy settings for accessing RemoteOK API. It is recommended to use Apify Proxy. | `{ "useApifyProxy": true }` |

<details>
<summary>Input JSON Example</summary>

```json
{
  "keyword": "react",
  "location": "USA",
  "dateFilter": "week",
  "maxJobs": 50
}
```

</details>

## Output

The Actor outputs structured JSON data for each job listing to the default dataset.

<details>
<summary>Output JSON Example</summary>

```json
{
  "job_title": "Senior Frontend Developer",
  "company": "Awesome Tech Inc",
  "job_url": "https://remoteok.com/remote-jobs/senior-frontend-developer-awesome-tech-inc-54321",
  "location": "USA",
  "tags": [
    "react",
    "javascript",
    "frontend",
    "remote"
  ],
  "logo": "https://remoteok.com/assets/jobs/54321/logo.png",
  "date_posted": "2025-10-27T10:00:00+00:00",
  "description_html": "<p>We are looking for a senior frontend developer to join our remote team...</p>",
  "description_text": "We are looking for a senior frontend developer to join our remote team...",
  "salary_min": 90000,
  "salary_max": 130000,
  "source_url": "https://remoteok.com",
  "collected_at": "2025-10-30T12:00:00.000Z",
  "job_type": "Full-time"
}
```
</details>

## Usage

To get the best results, it is recommended to use this actor with Apify Proxy. Using proxies will help to avoid getting blocked.

### Scrape Python developer jobs posted this week

```json
{
  "keyword": "python developer",
  "dateFilter": "week"
}
```

### Scrape all remote jobs in New York

```json
{
  "location": "New York"
}
```

## Resources

- [Apify Platform Documentation](https://docs.apify.com/platform)
- [Apify Python SDK](https://docs.apify.com/sdk/python/)
- [Remoteok Job Board](https://remoteok.com)
