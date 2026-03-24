/**
 * Lotto Israel - Web Server (zero dependencies)
 * Uses only Node.js built-in modules
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  fetchAllDraws,
  generateRecommendations,
  formatWhatsAppMessage,
} = require('./analyze');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const API_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API routes — always return fresh data, never cached
  if (url.pathname === '/api/analyze' && req.method === 'GET') {
    try {
      const draws = await fetchAllDraws();
      const rec = generateRecommendations(draws);
      res.writeHead(200, API_HEADERS);
      res.end(JSON.stringify(rec));
    } catch (err) {
      res.writeHead(500, API_HEADERS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/recommend' && req.method === 'GET') {
    try {
      const draws = await fetchAllDraws();
      const rec = generateRecommendations(draws);
      res.writeHead(200, API_HEADERS);
      res.end(JSON.stringify({
        line1: rec.line1,
        line2: rec.line2,
        totalDraws: rec.analysis.totalDrawsAnalyzed,
        message: formatWhatsAppMessage(rec),
      }));
    } catch (err) {
      res.writeHead(500, API_HEADERS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/draws' && req.method === 'GET') {
    try {
      const draws = await fetchAllDraws();
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      res.writeHead(200, API_HEADERS);
      res.end(JSON.stringify(draws.slice(0, limit)));
    } catch (err) {
      res.writeHead(500, API_HEADERS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    const headers = { 'Content-Type': contentType };
    // Service worker and HTML must never be cached — ensures SW updates propagate
    if (url.pathname === '/sw.js' || ext === '.html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Start the server — data loads synchronously from draws.json (no network)
server.listen(PORT, () => {
  console.log(`Lotto Israel running at http://localhost:${PORT}`);
  try {
    const draws = fetchAllDraws();
    console.log(`✅ Data ready: ${draws.length} draws loaded from draws.json`);
  } catch (err) {
    console.error('⚠️  Data load failed:', err.message);
  }
});
