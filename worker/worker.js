export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname; // ví dụ: /link1
    const ip = req.headers.get('CF-Connecting-IP') || '';
    const ua = req.headers.get('User-Agent') || '';

    // Map link -> đích cần redirect
    const routes = {
      '/link1': 'https://flixindo2.tv/voddetail/14247.html'
    };

    const SITE_ID = '900e85ff-2536-44ea-bcac-a90a0acb7ada';

    if (routes[path]) {
      // Ghi log vào Supabase REST
      await fetch(env.SUPABASE_URL + '/rest/v1/cf_logs', {
        method: 'POST',
        headers: {
          'apikey': env.SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ site_id: SITE_ID, path, ip, ua })
      }).catch(() => {});

      return Response.redirect(routes[path], 307);
    }

    return new Response('Not found', { status: 404 });
  }
}
