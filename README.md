# RemoteOK Job Scraper

<div align="center">

![RemoteOK Logo](https://remoteok.com/assets/logo.png)

**Extract remote job listings from RemoteOK.com with comprehensive filtering and data extraction**

[![Apify Actor](https://img.shields.io/badge/Apify-Actor-blue)](https://apify.com)
[![RemoteOK](https://img.shields.io/badge/RemoteOK-Jobs-orange)](https://remoteok.com)

</div>

---

## 📋 Overview

This Apify Actor efficiently scrapes remote job listings from [RemoteOK.com](https://remoteok.com), the world's largest remote job board. It leverages RemoteOK's official JSON API to extract detailed job information including titles, companies, locations, salaries, job types, posting dates, and comprehensive descriptions.

The actor is designed for reliability and performance, featuring built-in anti-bot protection measures and comprehensive filtering capabilities to help you find exactly the remote jobs you're looking for.

## ✨ Key Features

- **🔍 Advanced Filtering**: Filter jobs by keywords, locations, and posting dates
- **📊 Comprehensive Data Extraction**: Captures all essential job details including salaries, tags, and descriptions
- **🚀 High Performance**: Uses RemoteOK's JSON API for fast, reliable data extraction
- **🛡️ Anti-Bot Protection**: Built-in measures to handle rate limiting and access restrictions
- **🔄 Real-time Updates**: Access the latest remote job postings
- **📈 Scalable**: Configurable limits for large-scale job data collection
- **🌐 Proxy Support**: Optional proxy configuration for enhanced reliability

## ⚙️ Input Configuration

The actor accepts the following input parameters to customize your job scraping:

### Basic Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `keyword` | `string` | Search term to filter jobs (matches titles, companies, descriptions, and tags) | `"developer"` |
| `location` | `string` | Geographic filter for job locations (case-insensitive partial matching) | `""` |
| `dateFilter` | `string` | Time-based filter for job postings | `"all"` |
| `maxJobs` | `integer` | Maximum number of jobs to collect | `200` |

### Advanced Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `proxyConfiguration` | `object` | Proxy settings for enhanced access reliability | `{"useApifyProxy": true}` |

### Input Schema Details

#### `keyword`
- **Type**: `string`
- **Description**: Enter any keyword to filter relevant jobs. The search is performed across job titles, company names, job descriptions, and associated tags.
- **Examples**: `"python developer"`, `"ux designer"`, `"data scientist"`

#### `location`
- **Type**: `string`
- **Description**: Filter jobs by geographic location. Supports partial matching and is case-insensitive.
- **Examples**: `"San Francisco"`, `"New York"`, `"Europe"`, `"Remote"`

#### `dateFilter`
- **Type**: `string`
- **Allowed Values**: `"all"`, `"today"`, `"week"`, `"month"`
- **Description**: Limit results to jobs posted within a specific time frame.
- **Default**: `"all"` (no date restriction)

#### `maxJobs`
- **Type**: `integer`
- **Range**: `1` - unlimited
- **Description**: Set the maximum number of job listings to collect. Useful for managing dataset size and processing time.
- **Default**: `200`

#### `proxyConfiguration`
- **Type**: `object`
- **Description**: Configure proxy settings to improve access reliability and avoid potential blocking.
- **Recommended**: Enable Apify Proxy for optimal performance.

## 📤 Output Data Structure

The actor outputs structured JSON data for each job listing to the default dataset. Each job record contains the following fields:

### Core Job Information
- **`job_title`** (`string`): The job position title
- **`company`** (`string`): Company name offering the position
- **`job_url`** (`string`): Direct link to the job posting on RemoteOK
- **`location`** (`string`): Geographic location or "Worldwide" for fully remote positions

### Compensation & Employment Details
- **`salary_min`** (`number`): Minimum salary range (when available)
- **`salary_max`** (`number`): Maximum salary range (when available)
- **`job_type`** (`string`): Employment type (Full-time, Part-time, Contract, or Remote)

### Additional Metadata
- **`tags`** (`array`): Associated skill tags and keywords
- **`logo`** (`string`): Company logo URL
- **`date_posted`** (`string`): ISO 8601 timestamp of job posting
- **`description_html`** (`string`): Full job description in HTML format
- **`description_text`** (`string`): Plain text version of job description
- **`source_url`** (`string`): Base URL of the source platform
- **`collected_at`** (`string`): Timestamp when the data was collected

## 🚀 Usage Examples

### Example Input Configurations

#### Find Python Developer Positions
```json
{
  "keyword": "python developer",
  "dateFilter": "week",
  "maxJobs": 100
}
```

#### Search for Design Roles in Europe
```json
{
  "keyword": "designer",
  "location": "Europe",
  "dateFilter": "month"
}
```

#### Collect Recent Remote Marketing Jobs
```json
{
  "keyword": "marketing",
  "dateFilter": "today",
  "maxJobs": 50
}
```

#### Gather All Available Remote Positions
```json
{
  "maxJobs": 500
}
```

### Sample Output Record

```json
{
  "job_title": "Senior Python Backend Developer",
  "company": "TechCorp Inc.",
  "job_url": "https://remoteok.com/remote-jobs/senior-python-backend-developer-techcorp-inc-12345",
  "location": "USA",
  "tags": ["python", "backend", "django", "postgresql", "remote"],
  "logo": "https://remoteok.com/assets/jobs/12345/logo.png",
  "date_posted": "2025-10-27T10:00:00+00:00",
  "description_html": "<p>We are seeking a senior Python backend developer to join our remote team...</p>",
  "description_text": "We are seeking a senior Python backend developer to join our remote team...",
  "salary_min": 120000,
  "salary_max": 160000,
  "source_url": "https://remoteok.com",
  "collected_at": "2025-10-30T12:00:00.000Z",
  "job_type": "Full-time"
}
```

## 🛠️ Configuration & Best Practices

### Proxy Configuration
For optimal performance and to avoid potential access restrictions, configure proxy settings:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

### Performance Optimization
- **Use Specific Keywords**: Narrow searches with targeted keywords for faster, more relevant results
- **Set Reasonable Limits**: Configure `maxJobs` based on your processing capacity
- **Date Filtering**: Use date filters to focus on recent opportunities

### Data Processing Tips
- **Salary Information**: Not all jobs include salary data; check for `null` values
- **Location Flexibility**: Many positions are "Worldwide" or fully remote
- **Tag Utilization**: Use tags for advanced filtering and categorization

## 📊 Output Dataset Views

The actor provides a structured dataset view called "Overview" that displays jobs in a tabular format with the following columns:

- Job Title
- Company
- Location
- Salary Range
- Job Type
- Posting Date
- Job URL (clickable link)
- Description Preview
- Associated Tags
- Company Logo

## 🔗 Resources & Links

- [**RemoteOK Job Board**](https://remoteok.com) - The source platform for remote job listings
- [**Apify Platform**](https://apify.com) - Run and manage this actor
- [**Apify Documentation**](https://docs.apify.com) - Learn more about Apify actors and automation

## 📝 Notes

- The actor respects RemoteOK's terms of service and implements appropriate request patterns
- Job data is collected in real-time from RemoteOK's API
- Salary information is only included when provided by the job poster
- All timestamps are in UTC and follow ISO 8601 format

---

<div align="center">

**Built with ❤️ for the remote work community**

*Extract • Filter • Analyze • Succeed*

</div>
