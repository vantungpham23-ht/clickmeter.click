import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CF_TOKEN = Deno.env.get('CLOUDFLARE_API_TOKEN')!;
const CF_API = 'https://api.cloudflare.com/client/v4/graphql';

const Q_DAILY = `
query($zone:String!,$from:Date!,$to:Date!){
  viewer { zones(filter:{ zoneTag:$zone }) {
    httpRequests1dGroups(limit: 1, filter:{ date_geq:$from, date_leq:$to }) {
      dimensions { date }
      sum { requests cachedRequests bytes }
    }
  } }
}`;

async function fetchDaily(zone: string, day: string) {
  const body = { query: Q_DAILY, variables: { zone, from: day, to: day } };
  const resp = await fetch(CF_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CF_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  const json = await resp.json();
  const sum = json?.data?.viewer?.zones?.[0]?.httpRequests1dGroups?.[0]?.sum ?? {};
  return {
    requests: sum.requests ?? 0,
    cached: sum.cachedRequests ?? 0,
    bytes: sum.bytes ?? 0
  };
}

function toYMD(date: Date) {
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const { days = 180 } = await req.json().catch(() => ({}));

  // Lấy danh sách site có Cloudflare zone ID
  const { data: sites, error } = await supabase
    .from('sites')
    .select('id, cloudflare_zone_id')
    .not('cloudflare_zone_id', 'is', null);

  if (error) {
    return new Response(JSON.stringify({ error }), { status: 500 });
  }

  const today = new Date();
  const start = new Date();
  start.setUTCDate(today.getUTCDate() - days);

  const results: any[] = [];

  for (const site of sites) {
    const zone = site.cloudflare_zone_id;
    for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = toYMD(d);
      try {
        const stats = await fetchDaily(zone, day);
        await supabase
          .from('cf_daily_agg')
          .upsert({
            site_id: site.id,
            day,
            requests: stats.requests,
            cached: stats.cached,
            bytes: stats.bytes
          }, { onConflict: 'site_id,day' });
        results.push({ site: site.id, day, ok: true, ...stats });
      } catch (e) {
        results.push({ site: site.id, day, error: String(e) });
      }
    }
  }

  return new Response(JSON.stringify({ range: { start: toYMD(start), end: toYMD(today) }, results }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
