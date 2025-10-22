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

    // 6. Chuẩn hóa thời gian để always to >= from
    // date_from: "YYYY-MM-DD"
    const fromDate = (date_from ?? new Date().toISOString().slice(0,10));
    const from = `${fromDate}T00:00:00Z`;
    let to = new Date().toISOString();
    if (new Date(to).getTime() < new Date(from).getTime()) {
      to = `${fromDate}T23:59:59Z`;
    }

    // 7. Chuẩn bị path lọc
    const pathVar = site.filter_path && site.filter_path !== "/" ? site.filter_path : null;

    // 8. Tạo helper gọi CF GraphQL
    async function callCF(query: string, variables: Record<string, unknown>) {
      const resp = await fetch(CF_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CF_TOKEN}` },
        body: JSON.stringify({ query, variables })
      });
      const payload = await resp.json();
      return { ok: resp.ok, payload };
    }

    // 9. Tạo 3 "ứng viên" truy vấn và thử lần lượt đến khi cái nào thành công
    // A) Adaptive + fields kiểu cũ
    const qA = `
    query($zone:String!,$from:Time!,$to:Time!,$path:String){
      viewer{ zones(filter:{zoneTag:$zone}){
        httpRequestsAdaptiveGroups(
          limit:2000,
          filter:{ datetime_geq:$from, datetime_leq:$to ${pathVar ? ", clientRequestPath:$path" : ""} }
        ){
          dimensions{ datetime ${pathVar ? ", clientRequestPath" : ""} }
          sum{ requests cachedRequests bytes cachedBytes }
        }
      }}}
    `;

    // B) Adaptive + fields kiểu mới
    const qB = `
    query($zone:String!,$from:Time!,$to:Time!,$path:String){
      viewer{ zones(filter:{zoneTag:$zone}){
        httpRequestsAdaptiveGroups(
          limit:2000,
          filter:{ datetime_geq:$from, datetime_leq:$to ${pathVar ? ", clientRequestPath:$path" : ""} }
        ){
          dimensions{ datetime ${pathVar ? ", clientRequestPath" : ""} }
          sum{ count cachedCount uncachedCount bytes }
        }
      }}}
    `;

    // C) 1dGroups (theo ngày) – khi adaptive không hợp lệ
    const qC = `
    query($zone:String!,$from:Date!,$to:Date!){
      viewer{ zones(filter:{zoneTag:$zone}){
        httpRequests1dGroups(
          limit:31,
          filter:{ date_geq:$from, date_leq:$to }
        ){
          dimensions{ date }
          sum{ requests bytes }
        }
      }}}
    `;

    const varsA: Record<string,unknown> = { zone: site.cloudflare_zone_id, from, to };
    if (pathVar) varsA.path = pathVar;
    const varsB = varsA;
    const varsC = { zone: site.cloudflare_zone_id, from: fromDate, to: fromDate }; // 1 ngày

    // Thử lần lượt
    let used = "A"; 
    let res = await callCF(qA, varsA);

    function hasUnknownFieldError(p:any){
      return Array.isArray(p?.errors) && p.errors.some((e:any)=>String(e?.message||"").includes("unknown field"));
    }

    if (!res.ok || hasUnknownFieldError(res.payload)) {
      used = "B";
      res = await callCF(qB, varsB);
    }
    if (!res.ok || hasUnknownFieldError(res.payload)) {
      used = "C";
      res = await callCF(qC, varsC);
    }

    // 10. Chuẩn hoá dữ liệu về dạng thống nhất
    function normalize(payload:any){
      const z = payload?.data?.viewer?.zones?.[0];
      const groups = z?.httpRequestsAdaptiveGroups ?? z?.httpRequests1dGroups ?? [];
      const items = groups.map((g:any)=>{
        const d = g.dimensions || {};
        const s = g.sum || {};
        // lấy được gì thì map về
        const total = s.requests ?? s.count ?? (typeof s.cachedCount==="number" && typeof s.uncachedCount==="number" ? s.cachedCount + s.uncachedCount : null);
        const cached = s.cachedRequests ?? s.cachedCount ?? null;
        return {
          datetime: d.datetime ?? d.date ?? null,
          path: d.clientRequestPath ?? null,
          totalRequests: total,
          cachedRequests: cached,
          bytes: s.bytes ?? s.edgeResponseBytes ?? s.cachedBytes ?? null
        };
      });
      return { items };
    }

    // 11. Console.log an toàn
    console.log("Query used:", used, "from:", from, "to:", to, "path:", pathVar);

    // 12. Trả về response
    const body = {
      site_id: site.id,
      filter_path: site.filter_path,
      from, to,
      query_used: used,
      cloudflare: res.payload,
      normalized: res.payload?.data ? normalize(res.payload) : null
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