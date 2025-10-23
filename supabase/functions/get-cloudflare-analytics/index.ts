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

    // 8. Nếu site.filter_path === "/" (không lọc path) → dùng 1dGroups (nhanh, rẻ)
    const qDaily = `
    query($zone:String!,$from:Date!,$to:Date!){
      viewer {
        zones(filter:{ zoneTag:$zone }) {
          httpRequests1dGroups(
            limit: 31,
            filter:{ date_geq:$from, date_leq:$to }
          ){
            dimensions { date }
            sum { requests cachedRequests bytes }
          }
        }
      }
    }`;

    const varsDaily = { zone: site.cloudflare_zone_id, from: fromDate, to: fromDate };

    // 9. Nếu filter_path khác "/" → dùng Adaptive + lọc path
    const qAdaptive = `
    query($zone:String!,$from:Time!,$to:Time!,$path:String){
      viewer {
        zones(filter:{ zoneTag:$zone }) {
          httpRequestsAdaptiveGroups(
            limit: 2000,
            filter:{ datetime_geq:$from, datetime_leq:$to, clientRequestPath:$path }
          ){
            dimensions { datetime clientRequestPath }
            sum { requests cachedRequests bytes }
          }
        }
      }
    }`;
    const varsAdaptive = { zone: site.cloudflare_zone_id, from, to, path: site.filter_path };

    // 10. Thực thi: nếu site.filter_path === "/" → gọi qDaily; ngược lại gọi qAdaptive
    let queryUsed: string;
    let res: any;

    if (site.filter_path === "/") {
      queryUsed = "daily";
      res = await callCF(qDaily, varsDaily);
    } else {
      queryUsed = "adaptive";
      res = await callCF(qAdaptive, varsAdaptive);
    }

    // 11. Chuẩn hóa output để dashboard dễ vẽ
    function normalizeRows(payload: any) {
      const z = payload?.data?.viewer?.zones?.[0];
      const groups = z?.httpRequestsAdaptiveGroups ?? z?.httpRequests1dGroups ?? [];
      
      return groups.map((g: any) => {
        const d = g.dimensions || {};
        const s = g.sum || {};
        
        if (queryUsed === "daily") {
          // Nếu daily: map về { label: d.date, total: s.requests, cached: s.cachedRequests, bytes: s.bytes }
          return {
            label: d.date,
            total: s.requests,
            cached: s.cachedRequests,
            bytes: s.bytes
          };
        } else {
          // Nếu adaptive: map về { label: d.datetime, path: d.clientRequestPath, total: s.requests, cached: s.cachedRequests, bytes: s.bytes }
          return {
            label: d.datetime,
            path: d.clientRequestPath,
            total: s.requests,
            cached: s.cachedRequests,
            bytes: s.bytes
          };
        }
      });
    }

    // 12. Console.log an toàn
    console.log("Query used:", queryUsed, "from:", from, "to:", to);

    // 13. Trả JSON
    const body = {
      site_id: site.id,
      filter_path: site.filter_path,
      from, to,
      rows: res.payload?.data ? normalizeRows(res.payload) : [],
      raw: res.payload
    };
    return new Response(JSON.stringify(body), { 
      status: res.ok ? 200 : 502, 
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