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

    // 12. Console.log an toàn
    console.log("Totals query:", resTotals.ok, "Chart query:", resChart.ok, "pathVar:", pathVar);

    // 13. Response
    return new Response(JSON.stringify({
      site_id: site.id, 
      filter_path: site.filter_path, 
      from, to,
      totals,       // luôn là tổng toàn zone trong range
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