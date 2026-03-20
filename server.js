/**
 * Lotto Israel - Web Server (zero dependencies)
 * Uses only Node.js built-in modules
 */

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { sendTelegramNotification } = require('./notify');
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

  if (url.pathname === '/api/notify' && req.method === 'POST') {
    try {
      const { sendTelegramNotification } = require('./notify');
      const result = await sendTelegramNotification();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, messageId: result.result.message_id }));
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

  // Schedule Telegram notifications every Tuesday and Friday at 08:00 AM
  cron.schedule('0 8 * * 2,5', async () => {
    console.log(`⏰ [${new Date().toLocaleString('he-IL')}] Running scheduled Telegram notification...`);
    try {
      await sendTelegramNotification();
      console.log('✅ Scheduled notification sent successfully.');
    } catch (err) {
      console.error('❌ Scheduled notification failed:', err.message);
    }
  });

  console.log('📅 Cron scheduled: Telegram notifications every Tue & Fri at 08:00');
});
