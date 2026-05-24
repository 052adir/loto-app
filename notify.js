/**
 * Lotto Israel - Weekly Telegram Notifier
 *
 * Run by the scheduled task every Friday before Saturday's draw.
 * Workflow:
 *   1. Refresh draw history (calls update_data.js).
 *   2. Generate recommendations via analyze.js.
 *   3. Send formatted message to the configured Telegram chat.
 *
 * Uses only Node.js built-ins (https, child_process) + dotenv.
 */

require('dotenv').config();
const https = require('https');
const { spawnSync } = require('child_process');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error('❌ TELEGRAM_TOKEN or TELEGRAM_CHAT_ID missing from .env');
  process.exit(1);
}

/**
 * POST to Telegram sendMessage API. Returns the raw JSON body on success.
 */
function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) resolve(body);
          else reject(new Error(`Telegram API ${res.statusCode}: ${body}`));
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Telegram request timed out after 15s'));
    });
    req.write(payload);
    req.end();
  });
}

(async () => {
  console.log(`\n🎰 Lotto weekly notifier — ${new Date().toLocaleString('he-IL')}\n`);

  // --- 1. Refresh draw data ---
  console.log('🔄 Refreshing draw history (update_data.js)...');
  const updateResult = spawnSync('node', [path.join(__dirname, 'update_data.js')], {
    stdio: 'inherit',
    cwd: __dirname,
  });

  if (updateResult.status !== 0) {
    console.error('⚠️  update_data.js exited with status', updateResult.status, '— falling back to cached data.');
  }

  // --- 2. Generate recommendations (require AFTER update so cache is fresh) ---
  // Clear the require cache for analyze.js in case it was loaded before the update.
  delete require.cache[require.resolve('./analyze')];
  const { fetchAllDraws, generateRecommendations, formatWhatsAppMessage } = require('./analyze');

  console.log('\n📊 Generating recommendations...');
  // Clear analyze.js's in-memory draws cache by re-requiring after update finished
  const draws = fetchAllDraws();
  const rec = generateRecommendations(draws);
  const message = formatWhatsAppMessage(rec);

  console.log('\n--- Message preview ---');
  console.log(message);
  console.log('-----------------------\n');

  // --- 3. Send to Telegram ---
  console.log('📤 Sending to Telegram...');
  try {
    await sendTelegram(message);
    console.log('✅ Notification sent successfully!');
  } catch (e) {
    console.error('❌ Failed to send Telegram message:', e.message);
    process.exit(1);
  }
})();
