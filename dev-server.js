/**
 * dev-server.js — Local development proxy server
 * Run: node dev-server.js
 * Then open: http://localhost:3000
 *
 * This proxies /api/wialon → https://hst-api.wialon.com/wialon/ajax.html
 * so the app works locally without CORS issues (identical to Vercel behaviour).
 */

const http     = require('http');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const url      = require('url');

const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ── Proxy handler ──────────────────────────────────────────
function proxyWialon(req, res) {
  const parsed  = url.parse(req.url, true);
  const qs      = new URLSearchParams(parsed.query).toString();
  const target  = `https://hst-api.wialon.com/wialon/ajax.html?${qs}`;

  console.log(`[PROXY] ${target.slice(0, 80)}…`);

  https.get(target, (wialonRes) => {
    let data = '';
    wialonRes.on('data', chunk => data += chunk);
    wialonRes.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  }).on('error', (err) => {
    console.error('[PROXY ERROR]', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: -1, reason: err.message }));
  });
}

// ── Static file handler ────────────────────────────────────
function serveStatic(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? '/index.html' : req.url);

  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end(); return;
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } else {
        res.writeHead(500); res.end();
      }
    } else {
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    }
  });
}

// ── Server ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
    res.end();
    return;
  }

  if (req.url.startsWith('/api/wialon')) {
    proxyWialon(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Gajashakthi GPS Demo Dev Server`);
  console.log(`   → http://localhost:${PORT}\n`);
  console.log(`   Proxy: /api/wialon → hst-api.wialon.com`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
