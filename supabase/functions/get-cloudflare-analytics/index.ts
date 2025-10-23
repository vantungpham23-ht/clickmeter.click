// supabase/functions/get-cloudflare-analytics/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Xử lý CORS (Bắt buộc)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Xử lý CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Đọc secret
    const CF_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN");
    const CF_GRAPHQL = Deno.env.get("GRAPHQL_ENDPOINT") ?? "https://api.cloudflare.com/client/v4/graphql";
    if (!CF_TOKEN) {
      console.error("❌ CLOUDFLARE_API_TOKEN not set");
      return new Response("Server misconfigured", { status: 500 });
    }

    // 2. Tạo Supabase client để lấy user hiện hành
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );

    // 3. Lấy user
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // 4. Nhận body JSON { site_id, date_from }
    const { site_id, date_from } = await req.json();
    
    // Validate site_id là uuid string
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!site_id || !uuidRegex.test(site_id)) {
      return new Response(JSON.stringify({ error: 'Invalid site_id format' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Validate date_from là YYYY-MM-DD (optional)
    if (date_from && !/^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
      return new Response(JSON.stringify({ error: 'Invalid date_from format (YYYY-MM-DD)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // 5. Query bảng public.sites có RLS
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, user_id, cloudflare_zone_id, filter_path')
      .eq('id', site_id)
      .eq('user_id', user.id)
      .single();

    if (siteError || !site) {
      return new Response(JSON.stringify({ error: 'Site not found or access denied' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    // 6. Chuẩn hóa thời gian đầu vào
    const fromDate = (date_from ?? new Date().toISOString().slice(0,10)); // YYYY-MM-DD
    const from = `${fromDate}T00:00:00Z`;
    let to = new Date().toISOString();
    if (new Date(to) < new Date(from)) to = `${fromDate}T23:59:59Z`;
    const pathVar = site.filter_path !== '/' ? site.filter_path : null;

    // 7. Tạo helper gọi CF GraphQL
    async function callCF(query: string, variables: Record<string, unknown>) {
      const resp = await fetch(CF_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CF_TOKEN}` },
        body: JSON.stringify({ query, variables })
      });
      const payload = await resp.json();
      return { ok: resp.ok, payload };
    }

    // 8. Query A - Totals toàn zone (KHÔNG lọc path, theo ngày)
    const qTotals = `
    query($zone:String!,$from:Date!,$to:Date!){
      viewer { zones(filter:{zoneTag:$zone}) {
        httpRequests1dGroups(limit: 31, filter:{date_geq:$from, date_leq:$to}) {
          dimensions { date }
          sum { requests cachedRequests bytes }
        }
      } }
    }`;
    const varsTotals = { zone: site.cloudflare_zone_id, from: fromDate, to: fromDate };

    // 9. Query B - Chart (tuỳ pathVar)
    let qChart: string;
    let varsChart: Record<string, unknown>;

    if (pathVar != null) {
      // Adaptive + lọc path theo thời gian
      qChart = `
      query($zone:String!,$from:Time!,$to:Time!,$path:String){
        viewer { zones(filter:{zoneTag:$zone}) {
          httpRequestsAdaptiveGroups(
            limit: 2000,
            filter:{ datetime_geq:$from, datetime_leq:$to, clientRequestPath:$path }
          ){
            dimensions { datetime clientRequestPath }
            sum { requests cachedRequests bytes }
          }
        } }
      }`;
      varsChart = { zone: site.cloudflare_zone_id, from, to, path: pathVar };
    } else {
      // 1dGroups (nhanh, rẻ)
      qChart = `
      query($zone:String!,$from:Date!,$to:Date!){
        viewer { zones(filter:{zoneTag:$zone}) {
          httpRequests1dGroups(limit:31, filter:{date_geq:$from, date_leq:$to}){
            dimensions { date }
            sum { requests cachedRequests bytes }
          }
        } }
      }`;
      varsChart = { zone: site.cloudflare_zone_id, from: fromDate, to: fromDate };
    }

    // 10. Gọi Cloudflare
    const resTotals = await callCF(qTotals, varsTotals);
    const resChart = await callCF(qChart, varsChart);

    // 11. Chuẩn hóa
    function sumReq(s: any) { return s?.requests ?? 0; }
    function sumCached(s: any) { return s?.cachedRequests ?? 0; }
    function sumBytes(s: any) { return s?.bytes ?? 0; }

    const payloadTotals = resTotals.payload;
    const payloadChart = resChart.payload;

    const totalsGroups = payloadTotals?.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
    const totals = totalsGroups.reduce((a: any, g: any) => {
      a.requests += sumReq(g.sum); 
      a.cached += sumCached(g.sum); 
      a.bytes += sumBytes(g.sum); 
      return a;
    }, { requests: 0, cached: 0, bytes: 0 });

    const chartGroups = payloadChart?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups
                     ?? payloadChart?.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];

    const rows = chartGroups.map((g: any) => ({
      label: g.dimensions?.datetime ?? g.dimensions?.date ?? null,
      path: g.dimensions?.clientRequestPath ?? null,
      total: sumReq(g.sum), 
      cached: sumCached(g.sum), 
      bytes: sumBytes(g.sum)
    }));

    // 12. Tổng all-time từ bảng cf_daily_agg
    const { data: aggRows, error: aggErr } = await supabase
      .from('cf_daily_agg')
      .select('requests,cached,bytes')
      .eq('site_id', site.id);

    let totals_all_time = { requests: 0, cached: 0, bytes: 0 };
    if (!aggErr && aggRows?.length) {
      for (const r of aggRows) {
        totals_all_time.requests += r.requests;
        totals_all_time.cached   += r.cached;
        totals_all_time.bytes    += r.bytes;
      }
    }

    // 13. NEW: tính "chuẩn hoá (24h gần nhất)" với cache logic
    let normalized_24h = 0;
    
    // === Kiểm tra cache trước khi gọi Cloudflare ===
    const { data: cached } = await supabase
      .from('cf_normalized_clicks')
      .select('clicks_24h, created_at')
      .eq('site_id', site.id)
      .eq('path', site.filter_path || '/')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached && new Date().getTime() - new Date(cached.created_at).getTime() < 30 * 60 * 1000) {
      normalized_24h = cached.clicks_24h;
      console.log("Using cached normalized_24h:", normalized_24h);
    } else {
      // Gọi Cloudflare API để lấy dữ liệu mới
      try {
        const Q_NORMALIZED_24H = `
        query($zone:String!, $path:String!, $from:Time!, $to:Time!) {
          viewer {
            zones(filter:{ zoneTag: $zone }) {
              httpRequestsAdaptiveGroups(
                limit: 2000,
                filter:{
                  datetime_geq:$from,
                  datetime_leq:$to,
                  clientRequestPath:$path,
                  clientRequestMethod_in:["GET", "HEAD"],
                  responseStatus_geq:300,
                  responseStatus_lt:400
                }
              ) {
                sum { requests }
              }
            }
          }
        }`;

        const now = new Date();
        const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const resp24h = await fetch(CF_GRAPHQL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${CF_TOKEN}`
          },
          body: JSON.stringify({
            query: Q_NORMALIZED_24H,
            variables: {
              zone: site.cloudflare_zone_id,
              path: site.filter_path || "/",
              from: from24h.toISOString(),
              to: now.toISOString()
            }
          })
        });
        
        const json24h = await resp24h.json();
        const groups24h = json24h?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
        normalized_24h = groups24h.reduce((sum: number, g: any) => sum + (g?.sum?.requests ?? 0), 0);
        
        console.log("Normalized 24h query:", resp24h.ok, "clicks:", normalized_24h);
        
        // === Lưu dữ liệu normalized vào Supabase cache table ===
        try {
          const clickDate = new Date().toISOString().slice(0,10);
          await supabase.from('cf_normalized_clicks').upsert({
            site_id: site.id,
            path: site.filter_path || '/',
            click_date: clickDate,
            clicks_24h: normalized_24h,
            created_at: new Date().toISOString()
          }, { onConflict: 'site_id,path,click_date' });
          console.log("Cached normalized_24h:", normalized_24h);
        } catch (err) {
          console.error("Cache save failed", err);
        }
      } catch (e) {
        console.log("Normalized 24h error:", e.message);
        normalized_24h = 0;
      }
    }

    // 14. Lấy lịch sử 7 ngày gần nhất để vẽ biểu đồ
    const { data: normalizedHistory } = await supabase
      .from('cf_normalized_clicks')
      .select('click_date, clicks_24h')
      .eq('site_id', site.id)
      .eq('path', site.filter_path || '/')
      .order('click_date', { ascending: false })
      .limit(7);

    // 15. Console.log an toàn
    console.log("Totals query:", resTotals.ok, "Chart query:", resChart.ok, "pathVar:", pathVar);
    console.log("All-time totals:", totals_all_time);
    console.log("Normalized history:", normalizedHistory?.length || 0, "days");

    // 16. Response
    return new Response(JSON.stringify({
      site_id: site.id, 
      filter_path: site.filter_path, 
      from, to,
      totals,       // luôn là tổng toàn zone trong range
      totals_all_time,   // tổng all-time lấy từ DB
      normalized_24h,   // chuẩn hoá (24h gần nhất) - GET requests với status 3xx
      normalized_history: normalizedHistory ?? [], // lịch sử 7 ngày gần nhất
      rows,         // theo path nếu có, ngược lại theo ngày
      raw: { totals: payloadTotals, chart: payloadChart }
    }), { 
      status: (resTotals.ok && resChart.ok) ? 200 : 502, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error) {
    console.error("Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})