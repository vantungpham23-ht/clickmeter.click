import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CF_TOKEN     = Deno.env.get('CLOUDFLARE_API_TOKEN')!
const CF_API       = 'https://api.cloudflare.com/client/v4/graphql'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function iso(d: Date){ return d.toISOString() }
function toDate(d: Date){ return iso(d).slice(0,10) }

type CFGroup = { sum?: Record<string, number>; dimensions?: Record<string, any> }

async function runCF(query: string, variables: Record<string, unknown>) {
  const resp = await fetch(CF_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CF_TOKEN}` },
    body: JSON.stringify({ query, variables })
  })
  const json = await resp.json()
  // ném lỗi có nghĩa để fallback
  if (json?.errors?.length) {
    const msg = json.errors.map((e:any)=>e.message).join('; ')
    throw new Error(msg || 'GraphQLError')
  }
  return json
}

function sumRequests(groups: CFGroup[]): number {
  return (groups ?? []).reduce((acc, g) => {
    const s = g?.sum ?? {}
    // chấp nhận cả requests hoặc count
    const v = (typeof s.requests === 'number') ? s.requests
            : (typeof s.count    === 'number') ? s.count
            : 0
    return acc + v
  }, 0)
}

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
      const path = (s.filter_path && s.filter_path !== '/') ? s.filter_path : '/'

      let clicks24h = 0
      // ------------- (A) thử Adaptive trước -------------
      // Không lấy dimensions để tránh unknown field
      // Có 2 biến thể sum: { requests } hoặc { count }
      const Q_ADAPTIVE = `
      query($zone:String!, $path:String!, $from:Time!, $to:Time!) {
        viewer {
          zones(filter:{zoneTag:$zone}) {
            httpRequestsAdaptiveGroups(
              limit: 10000,
              filter:{
                datetime_geq:$from,
                datetime_leq:$to,
                clientRequestPath:$path
                # responseStatus_geq:300, responseStatus_lt:400  // nếu zone không hỗ trợ, CF sẽ báo lỗi; ta bắt lỗi và fallback
              }
            ) {
              sum { requests count }
            }
          }
        }
      }`
      try {
        const j = await runCF(Q_ADAPTIVE, { zone, path, from: iso(from24), to: iso(now) })
        const groups: CFGroup[] = j?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []
        clicks24h = sumRequests(groups)
      } catch (e) {
        // ------------- (B) fallback về 1hGroups -------------
        // Cộng 24 dòng giờ gần nhất (nếu có dimension hour). Nếu schema không cho dimensions, vẫn chỉ lấy sum.
        const Q_1H = `
        query($zone:String!, $path:String!, $from:Time!, $to:Time!) {
          viewer {
            zones(filter:{zoneTag:$zone}) {
              httpRequests1hGroups(
                limit: 48,
                filter:{
                  datetimeHour_geq:$from,
                  datetimeHour_leq:$to,
                  clientRequestPath:$path
                  # responseStatus_geq:300, responseStatus_lt:400
                }
              ) {
                dimensions { datetimeHour }
                sum { requests count }
              }
            }
          }
        }`
        try {
          const j2 = await runCF(Q_1H, { zone, path, from: iso(from24), to: iso(now) })
          const groups: CFGroup[] = j2?.data?.viewer?.zones?.[0]?.httpRequests1hGroups ?? []
          clicks24h = sumRequests(groups)
        } catch (e2) {
          // ------------- (C) fallback cuối: 1dGroups -------------
          // Lấy 2 ngày gần nhất (today & yesterday), rồi tự tính "last 24h":
          // Với thiếu dimension giờ, đây là xấp xỉ tốt nhất dựa trên daily buckets (Cloudflare thường cập nhật daily theo UTC).
          const Q_1D = `
          query($zone:String!, $path:String!, $from:Date!, $to:Date!) {
            viewer {
              zones(filter:{zoneTag:$zone}) {
                httpRequests1dGroups(
                  limit: 2,
                  filter:{
                    date_geq:$from,
                    date_leq:$to,
                    clientRequestPath:$path
                    # responseStatus_geq:300, responseStatus_lt:400
                  }
                ) {
                  dimensions { date }
                  sum { requests count }
                }
              }
            }
          }`
          // fromDay = hôm qua, toDay = hôm nay (UTC) để bao phủ 24h gần nhất
          const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
          const yesterdayUTC = new Date(todayUTC.getTime() - 24*60*60*1000)
          try {
            const j3 = await runCF(Q_1D, { zone, path, from: toDate(yesterdayUTC), to: toDate(todayUTC) })
            const groups: CFGroup[] = j3?.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? []
            clicks24h = sumRequests(groups) // gần đúng "last 24h" khi không có granular hơn
          } catch (e3) {
            // Nếu cả 3 đều lỗi, cho 0 và ghi log lỗi
            console.error('All CF queries failed:', { adaptive: String(e), oneHour: String(e2), oneDay: String(e3) })
            clicks24h = 0
          }
        }
      }

      // Upsert cache
      const clickDate = toDate(now)
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