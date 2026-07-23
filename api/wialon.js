// api/wialon.js — Vercel Serverless Proxy
// Forwards all requests to the Wialon API, bypassing browser CORS restrictions.
// Deploy to Vercel and call /api/wialon?svc=...&params=...&sid=...

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Rebuild query string from incoming request params
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    params.set(key, value);
  }

  const wialonUrl = `https://hst-api.wialon.com/wialon/ajax.html?${params.toString()}`;

  try {
    const response = await fetch(wialonUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (err) {
    console.error('[Wialon Proxy Error]', err);
    res.status(500).json({ error: -1, reason: 'proxy_error', message: err.message });
  }
}
