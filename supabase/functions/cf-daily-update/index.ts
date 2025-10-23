import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

const CF_TOKEN = Deno.env.get('CLOUDFLARE_API_TOKEN');
const CF_API = 'https://api.cloudflare.com/client/v4/graphql';

const Q_DAILY = `
query($zone:String!,$from:Date!,$to:Date!){
  viewer { zones(filter:{zoneTag:$zone}) {
    httpRequests1dGroups(limit:1, filter:{date_geq:$from, date_leq:$to}) {
      sum { requests cachedRequests bytes }
    }
  } }
}`;

async function getDailyStats(zone_id: string, day: string) {
  const body = { query: Q_DAILY, variables: { zone: zone_id, from: day, to: day } };
  const resp = await fetch(CF_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CF_TOKEN}` },
    body: JSON.stringify(body)
  });
  const payload = await resp.json();
  const groups = payload?.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
  const sum = groups[0]?.sum ?? {};
  return {
    requests: sum.requests ?? 0,
    cached: sum.cachedRequests ?? 0,
    bytes: sum.bytes ?? 0
  };
}

Deno.serve(async (req) => {
  // Allow CORS for testing
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      } 
    });
  }

  // For testing purposes, allow requests without auth
  const authHeader = req.headers.get('authorization');
  if (!authHeader && req.method === 'POST') {
    console.log('Running without auth for testing');
  }
  // ngày hôm qua (UTC)
  const today = new Date();
  today.setUTCDate(today.getUTCDate() - 1);
  const day = today.toISOString().slice(0,10);

  const { data: sites, error } = await supabase
    .from('sites')
    .select('id, cloudflare_zone_id')
    .not('cloudflare_zone_id','is',null);

  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  const results:any[] = [];
  for (const site of sites) {
    try {
      const stats = await getDailyStats(site.cloudflare_zone_id, day);
      await supabase
        .from('cf_daily_agg')
        .upsert({
          site_id: site.id,
          day,
          requests: stats.requests,
          cached: stats.cached,
          bytes: stats.bytes
        }, { onConflict: 'site_id,day' });
      results.push({ site: site.id, ok: true, ...stats });
    } catch (e) {
      results.push({ site: site.id, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ day, results }), { 
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    } 
  });
});
