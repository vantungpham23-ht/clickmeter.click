import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CF_TOKEN     = Deno.env.get('CLOUDFLARE_API_TOKEN')!
const CF_API       = 'https://api.cloudflare.com/client/v4/graphql'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function iso(d: Date){ return d.toISOString() }
function toDate(d: Date){ return iso(d).slice(0,10) }

async function runCF(query: string, variables: Record<string, unknown>) {
  const resp = await fetch(CF_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CF_TOKEN}` },
    body: JSON.stringify({ query, variables })
  })
  const json = await resp.json()
  if (json?.errors?.length) {
    const msg = json.errors.map((e:any)=>e.message).join('; ')
    throw new Error(msg || 'GraphQLError')
  }
  return json
}

const Q_1H_GROUP_BY_PATH = `
query($zone:String!, $from:Time!, $to:Time!) {
  viewer {
    zones(filter:{zoneTag:$zone}) {
    httpRequests1hGroups(
      limit: 10000,
      filter: { datetimeHour_geq:$from, datetimeHour_leq:$to }
    ) {
        dimensions { datetimeHour clientRequestPath }
        sum { requests count }
      }
    }
  }
}`

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(()=> ({}))
    const siteId: string | null = body.site_id ?? null

    const q = supabase.from('sites')
      .select('id, site_name, cloudflare_zone_id, filter_path')
      .not('cloudflare_zone_id', 'is', null)

    const { data: sites, error } = siteId ? await q.eq('id', siteId) : await q
    if (error) throw error

    const now = new Date()
    const from24 = new Date(now.getTime() - 24*60*60*1000)

    const results:any[] = []

    for (const s of sites ?? []) {
      const zone = s.cloudflare_zone_id
      const wantedPath = (s.filter_path && s.filter_path !== '/') ? s.filter_path : '/'

      let clicks24h = 0
      try {
        const j = await runCF(Q_1H_GROUP_BY_PATH, { zone, from: iso(from24), to: iso(now) })
        const groups = j?.data?.viewer?.zones?.[0]?.httpRequests1hGroups ?? []

        // lọc đúng path rồi cộng requests/count
        let reqSum = 0, cntSum = 0
        for (const g of groups) {
          if (g?.dimensions?.clientRequestPath === wantedPath) {
            const s = g?.sum ?? {}
            reqSum += (typeof s.requests === 'number') ? s.requests : 0
            cntSum += (typeof s.count    === 'number') ? s.count    : 0
          }
        }
        clicks24h = (reqSum || cntSum || 0)
      } catch (e) {
        console.error('CF 1hGroups failed:', String(e))
        clicks24h = 0
      }

      const { error: upErr } = await supabase
        .from('cf_normalized_clicks')
        .upsert({
          site_id: s.id,
          path: wantedPath,
          click_date: toDate(now),
          clicks_24h: clicks24h,
          created_at: iso(now)
        }, { onConflict: 'site_id,path,click_date' })
      if (upErr) throw upErr

      results.push({ site_id: s.id, site_name: s.site_name, path: wantedPath, clicks24h })
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})