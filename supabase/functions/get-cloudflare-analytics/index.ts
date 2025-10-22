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

    // 6. Chuẩn bị GraphQL query và variables
    const fromTime = (date_from ?? new Date().toISOString().slice(0,10)) + "T00:00:00Z";
    const toTime = new Date().toISOString();
    const pathVar = site.filter_path && site.filter_path !== "/" ? site.filter_path : null;

    // Tạo query với hoặc không có clientRequestPath filter
    const query = pathVar ? `
    query($zone: String!, $from: Time!, $to: Time!, $path: String) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            limit: 2000,
            filter: {
              datetime_geq: $from,
              datetime_leq: $to,
              clientRequestPath: $path
            }
          ) {
            dimensions { datetime, clientRequestPath }
            sum { requests }
          }
        }
      }
    }` : `
    query($zone: String!, $from: Time!, $to: Time!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            limit: 2000,
            filter: {
              datetime_geq: $from,
              datetime_leq: $to
            }
          ) {
            dimensions { datetime, clientRequestPath }
            sum { requests }
          }
        }
      }
    }`;

    const variables = pathVar 
      ? { zone: site.cloudflare_zone_id, from: fromTime, to: toTime, path: pathVar }
      : { zone: site.cloudflare_zone_id, from: fromTime, to: toTime };

    // Console.log an toàn
    console.log("CF_GRAPHQL:", CF_GRAPHQL, "zone:", site.cloudflare_zone_id.slice(0,6)+"...");
    console.log("Querying analytics for site:", site.id, "from:", fromTime, "to:", toTime);
    console.log("Filter path:", pathVar || "none (all paths)");

    // 7. Gọi Cloudflare
    const resp = await fetch(CF_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CF_TOKEN}` },
      body: JSON.stringify({ query, variables })
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Cloudflare API error: ${resp.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: resp.status,
      });
    }

    const payload = await resp.json();

    // 8. Trả về JSON gọn cho dashboard
    return new Response(JSON.stringify({
      site_id: site.id,
      filter_path: site.filter_path,
      from: fromTime, 
      to: toTime,
      cloudflare: payload
    }), { 
      status: 200, 
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