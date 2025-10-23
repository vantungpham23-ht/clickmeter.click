# ClickMeter Dashboard

## Edge Function: get-cloudflare-analytics

### 1) Set secret trên Supabase (UI hoặc CLI):
```bash
supabase functions secrets set CLOUDFLARE_API_TOKEN=cf_xxx
# optional
supabase functions secrets set GRAPHQL_ENDPOINT=https://api.cloudflare.com/client/v4/graphql
```

### 2) Deploy function:
```bash
supabase functions deploy get-cloudflare-analytics
```

### 3) Chạy local:
```bash
supabase functions serve get-cloudflare-analytics --env-file ./supabase/.env
```

### 4) Test online (thay PROJECT_REF, SITE_ID, ACCESS_TOKEN):
```bash
curl -X POST \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"site_id":"<SITE_ID>","date_from":"2025-10-01"}' \
  https://<PROJECT_REF>.functions.supabase.co/get-cloudflare-analytics
```

## Secrets & Deployment

### ⚠️ Security Notice
- **KHÔNG** dán token vào repo/chat
- **KHÔNG** commit secrets vào Git
- Sử dụng environment variables và Supabase secrets

### Thiết lập Secret:
```bash
# 1. Export token (tạm thời)
export CF_TOKEN='h9_XD7hyiqXM2EnLz99n3ywK2CO7COvgdkRHmQZS'

# 2. Set secret trong Supabase
supabase secrets set CLOUDFLARE_API_TOKEN="$CF_TOKEN"

# 3. Xóa token khỏi environment
unset CF_TOKEN

# 4. Deploy function với secret mới
supabase functions deploy get-cloudflare-analytics
```

### Test Function:
```bash
# Test với curl (thay các giá trị thật)
curl -X POST \
  -H "Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "your-site-uuid",
    "date_from": "2025-10-01"
  }' \
  https://tkzeotjknumllqvkgkzk.functions.supabase.co/get-cloudflare-analytics
```

### Response Format:
```json
{
  "site_id": "uuid",
  "filter_path": "/path",
  "from": "2025-10-01T00:00:00Z",
  "to": "2025-10-01T23:59:59Z",
  "query_used": "A|B|C",
  "cloudflare": { /* raw Cloudflare response */ },
  "normalized": {
    "items": [
      {
        "datetime": "2025-10-01T00:00:00Z",
        "path": "/api",
        "totalRequests": 1000,
        "cachedRequests": 800,
        "bytes": 1024000
      }
    ]
  }
}
```
