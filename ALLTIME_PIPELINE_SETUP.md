# All-time Analytics Pipeline - Cron Setup

## Manual Cron Setup Instructions

Since Supabase CLI doesn't support schedule creation, you need to set up the cron job manually:

### Option 1: Supabase Dashboard
1. Go to https://supabase.com/dashboard/project/tkzeotjknumllqvkgkzk/functions
2. Find `cf-daily-update` function
3. Go to "Schedules" tab
4. Create new schedule:
   - **Cron Expression**: `30 0 * * *` (runs daily at 00:30 UTC)
   - **Timezone**: UTC
   - **Method**: POST
   - **Headers**: None required (function handles auth internally)

### Option 2: External Cron Service
Use a service like cron-job.org or GitHub Actions to call the function:

```bash
# Daily at 00:30 UTC
curl -X POST "https://tkzeotjknumllqvkgkzk.functions.supabase.co/cf-daily-update" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

### Option 3: GitHub Actions (Recommended)
Create `.github/workflows/daily-update.yml`:

```yaml
name: Daily Analytics Update
on:
  schedule:
    - cron: '30 0 * * *'  # Daily at 00:30 UTC
  workflow_dispatch:  # Allow manual trigger

jobs:
  update-analytics:
    runs-on: ubuntu-latest
    steps:
      - name: Call cf-daily-update
        run: |
          curl -X POST "https://tkzeotjknumllqvkgkzk.functions.supabase.co/cf-daily-update" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
```

## Testing the Pipeline

### 1. Manual Test
```bash
# Test the daily update function
curl -X POST "https://tkzeotjknumllqvkgkzk.functions.supabase.co/cf-daily-update" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" | jq
```

### 2. Check Database
```sql
-- Check if data was inserted
SELECT * FROM cf_daily_agg ORDER BY day DESC LIMIT 10;

-- Check totals for a specific site
SELECT 
  site_id,
  SUM(requests) as total_requests,
  SUM(cached) as total_cached,
  SUM(bytes) as total_bytes
FROM cf_daily_agg 
WHERE site_id = 'YOUR_SITE_ID'
GROUP BY site_id;
```

### 3. Test Analytics API
```bash
# Test get-cloudflare-analytics with all-time data
curl -X POST "https://tkzeotjknumllqvkgkzk.functions.supabase.co/get-cloudflare-analytics" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"site_id":"YOUR_SITE_ID","date_from":"2025-10-22"}' | jq
```

## Expected Response Format

The updated `get-cloudflare-analytics` now returns:

```json
{
  "site_id": "uuid",
  "filter_path": "/path",
  "from": "2025-10-01T00:00:00Z",
  "to": "2025-10-01T23:59:59Z",
  "totals": {
    "requests": 1000,
    "cached": 800,
    "bytes": 1024000
  },
  "totals_all_time": {
    "requests": 50000,
    "cached": 40000,
    "bytes": 51200000
  },
  "rows": [...],
  "raw": {...}
}
```

## Notes

- `totals`: Data for the selected date range
- `totals_all_time`: Sum of all daily aggregated data from `cf_daily_agg` table
- The pipeline runs daily at 00:30 UTC to fetch yesterday's data
- Data is upserted to avoid duplicates
- All-time totals will be higher than range totals (unless range is all-time)
