import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CF_TOKEN     = Deno.env.get('CLOUDFLARE_API_TOKEN')!
const CF_API       = 'https://api.cloudflare.com/client/v4/graphql'

const Q_NORMALIZED_24H = `
query($zone:String!, $path:String!, $from:Time!, $to:Time!) {
  viewer {
    zones(filter:{zoneTag:$zone}) {
      httpRequestsAdaptiveGroups(
        limit: 2000,
        filter: {
          datetime_geq: $from,
          datetime_leq: $to,
          clientRequestPath: $path,
          clientRequestMethod: "GET",
          responseStatus_geq: 300,
          responseStatus_lt: 400
        }
      ) {
        sum { requests }
      }
    }
  }
}`

function iso(d: Date) { return d.toISOString() }

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    const body = await req.json().catch(() => ({}))
    // có thể truyền site_id để chạy 1 site, nếu không sẽ chạy tất cả
    const siteId: string | null = body.site_id ?? null

    const q = supabase.from('sites')
      .select('id, site_name, cloudflare_zone_id, filter_path')
      .not('cloudflare_zone_id', 'is', null)

    const { data: sites, error } = siteId ? await q.eq('id', siteId) : await q
    if (error) throw error

    const now = new Date()
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const results: any[] = []

    for (const s of sites ?? []) {
      const path = (s.filter_path && s.filter_path !== '/') ? s.filter_path : '/'

      // gọi CF GraphQL
      const resp = await fetch(CF_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CF_TOKEN}`
        },
        body: JSON.stringify({
          query: Q_NORMALIZED_24H,
          variables: {
            zone: s.cloudflare_zone_id,
            path,
            from: iso(from),
            to: iso(now)
          }
        })
      })
      const json = await resp.json()
      const groups = json?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []
      const clicks24h = groups.reduce((sum: number, g: any) => sum + (g?.sum?.requests ?? 0), 0)

      // upsert vào cache table
      const clickDate = iso(now).slice(0,10) // YYYY-MM-DD
      const { error: upErr } = await supabase
        .from('cf_normalized_clicks')
        .upsert({
          site_id: s.id,
          path,
          click_date: clickDate,
          clicks_24h: clicks24h,
          created_at: iso(now)
        }, { onConflict: 'site_id,path,click_date' })
      if (upErr) throw upErr

      results.push({ site_id: s.id, site_name: s.site_name, path, clicks24h })
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})
