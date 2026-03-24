/**
 * Lotto Data Updater
 * Run locally (not on Render) to fetch all draws and save to public/draws.json.
 * Usage: node update_data.js
 */

const fs = require('fs');
const path = require('path');

const PAIS_API = 'https://paisapi.azurewebsites.net';
const PAIS_DRAW_URL = 'http://www.pais.co.il/lotto/currentlotto.aspx';
const PAIS_API_LAST_ID = 3744;
const TOTAL_NUMBERS = 37;
const STRONG_MAX = 7;
const OUTPUT_PATH = path.join(__dirname, 'public', 'draws.json');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function scrapeSingleDraw(id) {
  try {
    const res = await fetch(`${PAIS_DRAW_URL}?lotteryId=${id}`, {
      signal: AbortSignal.timeout(15000),
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return null;

    const html = await res.text();

    if (html.includes('הדף לא קיים') || html.includes('שגיאת שרת') || html.length < 1000) return null;

    let winNumbers = null;
    let strongNumber = null;

    // Strategy 1: <li> inside <ol>
    const olMatches = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/g);
    if (olMatches) {
      for (const olBlock of olMatches) {
        const liNums = [];
        const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/g;
        let m;
        while ((m = liPattern.exec(olBlock)) !== null) {
          const numMatch = m[1].match(/(\d{1,2})/);
          if (numMatch) liNums.push(parseInt(numMatch[1]));
        }
        const valid = liNums.filter(n => n >= 1 && n <= TOTAL_NUMBERS);
        if (valid.length === 6) { winNumbers = valid; break; }
      }
    }

    // Strategy 2: text between markers
    if (!winNumbers) {
      const textBlock = stripHtml(html);
      const lottoSection = textBlock.match(/הגרלת\s*הלוטו([\s\S]*?)המספר\s*החזק/);
      if (lottoSection) {
        const nums = lottoSection[1].match(/\b(\d{1,2})\b/g);
        if (nums) {
          const valid = nums.map(Number).filter(n => n >= 1 && n <= TOTAL_NUMBERS);
          if (valid.length >= 6) {
            const allNums = nums.map(Number);
            if (allNums.length >= 12) {
              const extracted = [];
              for (let i = 0; i < allNums.length - 1; i++) {
                if (allNums[i] >= 1 && allNums[i] <= 6 && allNums[i] === extracted.length + 1) {
                  const val = allNums[i + 1];
                  if (val >= 1 && val <= TOTAL_NUMBERS) extracted.push(val);
                }
              }
              if (extracted.length === 6) winNumbers = extracted;
            }
            if (!winNumbers && valid.length === 6) winNumbers = valid;
            if (!winNumbers && valid.length > 6) winNumbers = valid.slice(valid.length - 6);
          }
        }
      }
    }

    // Strategy 3: number clusters in tags
    if (!winNumbers) {
      const numPattern = /<(?:span|div|td|li|p)[^>]*>\s*(\d{1,2})\s*<\/(?:span|div|td|li|p)>/g;
      const allPageNums = [];
      let m;
      while ((m = numPattern.exec(html)) !== null) {
        const n = parseInt(m[1]);
        if (n >= 1 && n <= TOTAL_NUMBERS) allPageNums.push({ n, idx: m.index });
      }
      for (let i = 0; i <= allPageNums.length - 6; i++) {
        const cluster = allPageNums.slice(i, i + 6);
        const spread = cluster[5].idx - cluster[0].idx;
        if (spread < 2000) {
          const nums = cluster.map(c => c.n);
          const unique = new Set(nums);
          if (unique.size === 6) { winNumbers = nums; break; }
        }
      }
    }

    if (!winNumbers || winNumbers.length !== 6) return null;

    // Strong number
    const strongAfter = html.match(/המספר\s*החזק[\s\S]*?<[^>]*>\s*(\d)\s*</);
    if (strongAfter) {
      const n = parseInt(strongAfter[1]);
      if (n >= 1 && n <= STRONG_MAX) strongNumber = n;
    }
    if (!strongNumber) {
      const textBlock = stripHtml(html);
      const strongTextMatch = textBlock.match(/המספר\s*החזק\s*(\d)/);
      if (strongTextMatch) {
        const n = parseInt(strongTextMatch[1]);
        if (n >= 1 && n <= STRONG_MAX) strongNumber = n;
      }
    }
    if (!strongNumber) {
      const textBlock = stripHtml(html);
      const strongBefore = textBlock.match(/(\d)\s*המספר\s*החזק/);
      if (strongBefore) {
        const n = parseInt(strongBefore[1]);
        if (n >= 1 && n <= STRONG_MAX) strongNumber = n;
      }
    }

    if (!strongNumber) return null;

    let date = null;
    const dateMatch = html.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T12:00:00.000Z`;
    }

    return { _id: id, date, winNumbers, strongNumber };
  } catch (e) {
    console.log(`   ⚠️  Draw ${id} scrape error: ${e.message}`);
    return null;
  }
}

async function fetchApiDraws() {
  const draws = [];
  console.log(`📦 Fetching historical draws from third-party API (IDs 1-${PAIS_API_LAST_ID})...`);
  const batchSize = 500;
  for (let start = 1; start <= PAIS_API_LAST_ID; start += batchSize) {
    const end = Math.min(start + batchSize - 1, PAIS_API_LAST_ID);
    try {
      const res = await fetch(`${PAIS_API}/lotto/byID/${start}/${end}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) draws.push(...data);
      }
    } catch (e) {
      console.log(`   ⚠️  API batch ${start}-${end} skipped: ${e.message}`);
    }
  }
  console.log(`   ✅ API returned ${draws.length} historical draws`);
  return draws;
}

async function scrapeNewDraws(startId) {
  const draws = [];
  const batchSize = 10;
  const maxConsecutiveFails = 3;
  let consecutiveFails = 0;
  let currentId = startId;

  console.log(`🌐 Scraping new draws from pais.co.il starting at ID ${startId}...`);

  while (consecutiveFails < maxConsecutiveFails) {
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(scrapeSingleDraw(currentId + i));
    }
    const results = await Promise.all(batch);

    let batchSuccessCount = 0;
    for (const draw of results) {
      if (draw) { draws.push(draw); batchSuccessCount++; }
    }

    if (batchSuccessCount > 0) {
      console.log(`   ✅ Batch ${currentId}-${currentId + batchSize - 1}: ${batchSuccessCount} draws found`);
      consecutiveFails = 0;
    } else {
      consecutiveFails++;
      console.log(`   ⏭️  Batch ${currentId}-${currentId + batchSize - 1}: empty (${consecutiveFails}/${maxConsecutiveFails})`);
    }

    currentId += batchSize;
  }

  return draws;
}

(async () => {
  console.log('🔄 Lotto Data Updater — fetching all draws...\n');

  // Phase 1: API draws
  const apiDraws = await fetchApiDraws();

  // Phase 2: scrape newer draws from pais.co.il
  const scrapedDraws = await scrapeNewDraws(PAIS_API_LAST_ID + 1);

  // Merge & deduplicate
  const allMap = new Map();
  for (const d of apiDraws) allMap.set(d._id, d);
  for (const d of scrapedDraws) allMap.set(d._id, d);

  const allDraws = Array.from(allMap.values());
  allDraws.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Save to public/draws.json
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allDraws, null, 2), 'utf-8');

  console.log(`\n✅ Done! Saved ${allDraws.length} draws to ${OUTPUT_PATH}`);
})();
