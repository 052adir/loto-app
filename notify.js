/**
 * Telegram notification sender
 * Uses native Node.js fetch API (Node 18+)
 */

require('dotenv').config();
const { fetchAllDraws, generateRecommendations, formatWhatsAppMessage } = require('./analyze');

const TELEGRAM_API = 'https://api.telegram.org';

async function sendTelegramNotification() {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('❌ Missing Telegram configuration. Check your .env file.');
    console.error('   Required: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID');
    process.exit(1);
  }

  console.log('🔄 Fetching lottery data...');
  const draws = await fetchAllDraws();
  const rec = generateRecommendations(draws);
  const message = formatWhatsAppMessage(rec);

  console.log('📤 Sending Telegram message...');

  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || JSON.stringify(data)}`);
  }

  console.log(`✅ Message sent! Message ID: ${data.result.message_id}`);
  return data;
}

module.exports = { sendTelegramNotification };

if (require.main === module) {
  sendTelegramNotification().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
