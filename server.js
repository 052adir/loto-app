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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API routes
  if (url.pathname === '/api/analyze' && req.method === 'GET') {
    try {
      const draws = await fetchAllDraws();
      const rec = generateRecommendations(draws);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rec));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/recommend' && req.method === 'GET') {
    try {
      const draws = await fetchAllDraws();
      const rec = generateRecommendations(draws);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        line1: rec.line1,
        line2: rec.line2,
        totalDraws: rec.analysis.totalDrawsAnalyzed,
        message: formatWhatsAppMessage(rec),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/draws' && req.method === 'GET') {
    try {
      const draws = await fetchAllDraws();
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(draws.slice(0, limit)));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
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
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Lotto Israel running at http://localhost:${PORT}`);

  // Pre-fetch lottery data on startup so the first request is fast
  fetchAllDraws()
    .then(draws => console.log(`📊 Startup: ${draws.length} draws loaded and cached.`))
    .catch(err => console.error('⚠️  Startup pre-fetch failed:', err.message));
});
