import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

Deno.serve(async (req) => {
  try {
    const { site_id, path } = await req.json()
    if (!site_id || !path) {
      return new Response(JSON.stringify({ ok:false, error:'Missing site_id/path' }), { status:400 })
    }

    // 24h gần nhất
    const { count: clicks_24h } = await supabase
      .from('cf_logs')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site_id)
      .eq('path', path)
      .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())

    // All-time
    const { count: clicks_all } = await supabase
      .from('cf_logs')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', site_id)
      .eq('path', path)

    return new Response(JSON.stringify({
      ok: true,
      site_id, path,
      clicks_24h: clicks_24h ?? 0,
      clicks_all: clicks_all ?? 0
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e) }), { status:500 })
  }
})
