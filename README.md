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
