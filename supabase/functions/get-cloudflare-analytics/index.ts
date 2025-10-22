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
    // 1. Khởi tạo Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // 2. Xác thực người dùng
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // 3. Lấy input từ Dashboard
    const { site_id, date_from } = await req.json()
    if (!site_id || !date_from) {
      throw new Error('Missing site_id or date_from')
    }

    // 4. Lấy thông tin site từ DB (đã được RLS bảo vệ)
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('cloudflare_zone_id, filter_path')
      .eq('id', site_id)
      .eq('user_id', user.id) // RLS sẽ lo việc này, nhưng cẩn thận vẫn hơn
      .single()

    if (siteError || !siteData) {
      return new Response(JSON.stringify({ error: 'Site not found or access denied' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    // 5. Lấy API Token bí mật
    const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN')
    const { cloudflare_zone_id, filter_path } = siteData

    // 6. Xây dựng truy vấn GraphQL
    const graphqlQuery = {
      query: `
        query {
          viewer {
            zones(filter: { zoneTag: "${cloudflare_zone_id}" }) {
              httpRequests1dGroups(
                filter: {
                  date_gt: "${date_from}",
                  requestPath: "${filter_path}"
                },
                limit: 30,
                orderBy: [date_ASC]
              ) {
                sum {
                  requests
                }
                dimensions {
                  date
                }
              }
            }
          }
        }
      `
    }

    // 7. Gọi API Cloudflare
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify(graphqlQuery)
    })

    if (!response.ok) {
      throw new Error(`Cloudflare API error: ${await response.text()}`)
    }

    const data = await response.json()

    // 8. Trả dữ liệu về cho Dashboard
    return new Response(
      JSON.stringify(data.data.viewer.zones[0].httpRequests1dGroups),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})