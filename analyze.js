/**
 * Israeli Lotto Analyzer
 * Fetches historical data from PaisAPI and calculates recommended numbers
 * using multiple statistical methods.
 *
 * Lotto format: 6 numbers from 1-37 + 1 strong number from 1-7
 */

const PAIS_API = 'https://paisapi.azurewebsites.net';
const PAIS_DRAW_URL = 'http://www.pais.co.il/lotto/currentlotto.aspx';
const PAIS_API_LAST_ID = 3744; // Last draw available in the third-party API
const TOTAL_NUMBERS = 37;
const PICK_COUNT = 6;
const STRONG_MAX = 7;

// In-memory cache to avoid repeated slow API calls
let _drawsCache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Strip HTML tags and collapse whitespace to get plain text.
 */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse a single draw page from the official Pais website.
 * Uses multiple extraction strategies for robustness.
 * Returns a draw object or null if the page doesn't exist / can't be parsed.
 */
async function scrapeSingleDraw(id) {
  try {
    const res = await fetch(`${PAIS_DRAW_URL}?lotteryId=${id}`, {
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.5',
      },
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Detect error / empty pages
    if (html.includes('הדף לא קיים') || html.includes('שגיאת שרת') || html.length < 1000) return null;

    let winNumbers = null;
    let strongNumber = null;

    // --- Strategy 1: Extract from <li> elements inside an <ol> ---
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
        if (valid.length === 6) {
          winNumbers = valid;
          break;
        }
      }
    }

    // --- Strategy 2: Text-based — find 6 numbers between "הגרלת הלוטו" and "המספר החזק" ---
    if (!winNumbers) {
      const textBlock = stripHtml(html);
      const lottoSection = textBlock.match(/הגרלת\s*הלוטו([\s\S]*?)המספר\s*החזק/);
      if (lottoSection) {
        const nums = lottoSection[1].match(/\b(\d{1,2})\b/g);
        if (nums) {
          const valid = nums.map(Number).filter(n => n >= 1 && n <= TOTAL_NUMBERS);
          // Take the last 6 valid numbers (skipping ordinal list indices 1-6)
          if (valid.length >= 6) {
            // The page shows "1. 3 2. 7 3. 9 ..." so filter out the ordinal prefixes
            // by taking only numbers that could be lotto numbers (may overlap with 1-6)
            // The actual winning numbers are the ones AFTER each ordinal index.
            // Since ordinals go 1,2,3,4,5,6 and values can also be 1-6, pair them:
            const allNums = nums.map(Number);
            if (allNums.length >= 12) {
              // Ordered list format: [1, val, 2, val, 3, val, 4, val, 5, val, 6, val]
              const extracted = [];
              for (let i = 0; i < allNums.length - 1; i++) {
                if (allNums[i] >= 1 && allNums[i] <= 6 && allNums[i] === extracted.length + 1) {
                  const val = allNums[i + 1];
                  if (val >= 1 && val <= TOTAL_NUMBERS) {
                    extracted.push(val);
                  }
                }
              }
              if (extracted.length === 6) winNumbers = extracted;
            }
            // Fallback: if the page just lists 6 numbers without ordinals
            if (!winNumbers && valid.length === 6) {
              winNumbers = valid;
            }
            // Fallback: take the last 6 valid numbers
            if (!winNumbers && valid.length > 6) {
              winNumbers = valid.slice(valid.length - 6);
            }
          }
        }
      }
    }

    // --- Strategy 3: Find 6 consecutive number-like spans/divs near lotto markers ---
    if (!winNumbers) {
      // Look for sequences of numbers in span/div tags near the lottery section
      const numPattern = /<(?:span|div|td|li|p)[^>]*>\s*(\d{1,2})\s*<\/(?:span|div|td|li|p)>/g;
      const allPageNums = [];
      let m;
      while ((m = numPattern.exec(html)) !== null) {
        const n = parseInt(m[1]);
        if (n >= 1 && n <= TOTAL_NUMBERS) allPageNums.push({ n, idx: m.index });
      }
      // Find the first cluster of 6 valid lotto numbers appearing close together
      for (let i = 0; i <= allPageNums.length - 6; i++) {
        const cluster = allPageNums.slice(i, i + 6);
        const spread = cluster[5].idx - cluster[0].idx;
        if (spread < 2000) { // within 2000 chars of each other
          const nums = cluster.map(c => c.n);
          const unique = new Set(nums);
          if (unique.size === 6) {
            winNumbers = nums;
            break;
          }
        }
      }
    }

    if (!winNumbers || winNumbers.length !== 6) return null;

    // --- Extract strong number ---
    // Try: number right after "המספר החזק"
    const strongAfter = html.match(/המספר\s*החזק[\s\S]*?<[^>]*>\s*(\d)\s*</);
    if (strongAfter) {
      const n = parseInt(strongAfter[1]);
      if (n >= 1 && n <= STRONG_MAX) strongNumber = n;
    }
    // Fallback: plain text after "המספר החזק"
    if (!strongNumber) {
      const textBlock = stripHtml(html);
      const strongTextMatch = textBlock.match(/המספר\s*החזק\s*(\d)/);
      if (strongTextMatch) {
        const n = parseInt(strongTextMatch[1]);
        if (n >= 1 && n <= STRONG_MAX) strongNumber = n;
      }
    }
    // Fallback: number right before "המספר החזק"
    if (!strongNumber) {
      const textBlock = stripHtml(html);
      const strongBefore = textBlock.match(/(\d)\s*המספר\s*החזק/);
      if (strongBefore) {
        const n = parseInt(strongBefore[1]);
        if (n >= 1 && n <= STRONG_MAX) strongNumber = n;
      }
    }

    if (!strongNumber) return null;

    // --- Extract date (dd/mm/yyyy) ---
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

/**
 * Scrape multiple draws in parallel batches from the official Pais website.
 * Starts from startId and keeps going until we hit 3 consecutive empty batches.
 */
async function scrapeNewDraws(startId) {
  const draws = [];
  const batchSize = 10;
  const maxConsecutiveFails = 3; // 3 empty batches = 30 missing IDs = definitely past the end
  let consecutiveFails = 0;
  let currentId = startId;

  console.log(`   📡 Scraping batches of ${batchSize} starting at ID ${startId}...`);

  while (consecutiveFails < maxConsecutiveFails) {
    // Fetch a batch in parallel
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(scrapeSingleDraw(currentId + i));
    }
    const results = await Promise.all(batch);

    let batchSuccessCount = 0;
    for (const draw of results) {
      if (draw) {
        draws.push(draw);
        batchSuccessCount++;
      }
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

async function fetchAllDraws() {
  // Return cache if still valid
  if (_drawsCache && Date.now() - _cacheTime < CACHE_TTL) {
    return _drawsCache;
  }

  const allDraws = [];

  // --- Phase 1: Fetch historical draws from third-party API (IDs 1-3744) ---
  console.log(`📦 Phase 1: Fetching historical draws from third-party API (IDs 1-${PAIS_API_LAST_ID})...`);
  const batchSize = 500;
  let apiCount = 0;
  for (let start = 1; start <= PAIS_API_LAST_ID; start += batchSize) {
    const end = Math.min(start + batchSize - 1, PAIS_API_LAST_ID);
    try {
      const res = await fetch(`${PAIS_API}/lotto/byID/${start}/${end}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          allDraws.push(...data);
          apiCount += data.length;
        }
      }
    } catch (e) {
      console.log(`   ⚠️  API batch ${start}-${end} skipped: ${e.message}`);
    }
  }
  console.log(`   ✅ API returned ${apiCount} historical draws`);

  // --- Phase 2: Scrape newer draws directly from official Pais website ---
  console.log(`🌐 Phase 2: Scraping new draws from pais.co.il (starting at ID ${PAIS_API_LAST_ID + 1})...`);
  try {
    const newDraws = await scrapeNewDraws(PAIS_API_LAST_ID + 1);
    if (newDraws.length > 0) {
      const maxScrapedId = Math.max(...newDraws.map(d => d._id));
      const latestDate = newDraws.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date;
      console.log(`   ✅ Scraped ${newDraws.length} new draws (IDs ${PAIS_API_LAST_ID + 1}-${maxScrapedId}, latest: ${latestDate})`);
      allDraws.push(...newDraws);
    } else {
      console.log('   ⚠️  No new draws scraped. The scraping selectors may need updating.');
    }
  } catch (e) {
    console.log(`   ❌ Scraping failed: ${e.message}`);
  }

  console.log(`📊 Total draws collected: ${allDraws.length} (${apiCount} API + ${allDraws.length - apiCount} scraped)`);

  if (allDraws.length === 0) {
    throw new Error('Could not fetch any lottery data from API');
  }

  // Sort by date descending (newest first)
  allDraws.sort((a, b) => new Date(b.date) - new Date(a.date));

  _drawsCache = allDraws;
  _cacheTime = Date.now();
  return allDraws;
}

async function fetchRecentDraws(count = 200) {
  const all = await fetchAllDraws();
  return all.slice(0, count);
}

/**
 * Method 1: Frequency Analysis
 * Numbers that appear most often historically
 */
function frequencyAnalysis(draws) {
  const freq = new Array(TOTAL_NUMBERS + 1).fill(0);
  const strongFreq = new Array(STRONG_MAX + 1).fill(0);

  for (const draw of draws) {
    for (const num of draw.winNumbers) {
      freq[num]++;
    }
    if (draw.strongNumber) {
      strongFreq[draw.strongNumber]++;
    }
  }

  const ranked = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    ranked.push({ number: i, count: freq[i], pct: ((freq[i] / draws.length) * 100).toFixed(1) });
  }
  ranked.sort((a, b) => b.count - a.count);

  const strongRanked = [];
  for (let i = 1; i <= STRONG_MAX; i++) {
    strongRanked.push({ number: i, count: strongFreq[i], pct: ((strongFreq[i] / draws.length) * 100).toFixed(1) });
  }
  strongRanked.sort((a, b) => b.count - a.count);

  return { ranked, strongRanked };
}

/**
 * Method 2: Recent Trend Analysis (last N draws weighted)
 * More recent draws get higher weight
 */
function recentTrendAnalysis(draws, window = 100) {
  const recent = draws.slice(0, window);
  const score = new Array(TOTAL_NUMBERS + 1).fill(0);
  const strongScore = new Array(STRONG_MAX + 1).fill(0);

  for (let i = 0; i < recent.length; i++) {
    const weight = (window - i) / window; // newest = 1.0, oldest = ~0
    for (const num of recent[i].winNumbers) {
      score[num] += weight;
    }
    if (recent[i].strongNumber) {
      strongScore[recent[i].strongNumber] += weight;
    }
  }

  const ranked = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    ranked.push({ number: i, score: parseFloat(score[i].toFixed(2)) });
  }
  ranked.sort((a, b) => b.score - a.score);

  const strongRanked = [];
  for (let i = 1; i <= STRONG_MAX; i++) {
    strongRanked.push({ number: i, score: parseFloat(strongScore[i].toFixed(2)) });
  }
  strongRanked.sort((a, b) => b.score - a.score);

  return { ranked, strongRanked };
}

/**
 * Method 3: Overdue Numbers (numbers that haven't appeared in a while)
 */
function overdueAnalysis(draws) {
  const lastSeen = new Array(TOTAL_NUMBERS + 1).fill(Infinity);
  const strongLastSeen = new Array(STRONG_MAX + 1).fill(Infinity);

  for (let i = 0; i < draws.length; i++) {
    for (const num of draws[i].winNumbers) {
      if (lastSeen[num] === Infinity) {
        lastSeen[num] = i;
      }
    }
    if (draws[i].strongNumber && strongLastSeen[draws[i].strongNumber] === Infinity) {
      strongLastSeen[draws[i].strongNumber] = i;
    }
  }

  const ranked = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    ranked.push({ number: i, drawsSinceLastSeen: lastSeen[i] });
  }
  ranked.sort((a, b) => b.drawsSinceLastSeen - a.drawsSinceLastSeen);

  const strongRanked = [];
  for (let i = 1; i <= STRONG_MAX; i++) {
    strongRanked.push({ number: i, drawsSinceLastSeen: strongLastSeen[i] });
  }
  strongRanked.sort((a, b) => b.drawsSinceLastSeen - a.drawsSinceLastSeen);

  return { ranked, strongRanked };
}

/**
 * Method 4: Hot Pairs - pairs of numbers that often appear together
 */
function hotPairsAnalysis(draws) {
  const pairCount = {};

  for (const draw of draws) {
    const nums = draw.winNumbers.sort((a, b) => a - b);
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const key = `${nums[i]}-${nums[j]}`;
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
    }
  }

  const pairs = Object.entries(pairCount)
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count);

  return pairs.slice(0, 20);
}

/**
 * Combined scoring: weighted blend of all methods
 * Returns 2 recommended lines
 */
function generateRecommendations(draws) {
  const freq = frequencyAnalysis(draws);
  const trend = recentTrendAnalysis(draws, 100);
  const overdue = overdueAnalysis(draws);
  const hotPairs = hotPairsAnalysis(draws);

  // Combined score for each number
  const scores = new Array(TOTAL_NUMBERS + 1).fill(0);
  const strongScores = new Array(STRONG_MAX + 1).fill(0);

  // Frequency score (30% weight)
  const maxFreq = freq.ranked[0].count;
  for (const item of freq.ranked) {
    scores[item.number] += (item.count / maxFreq) * 30;
  }

  // Trend score (35% weight)
  const maxTrend = trend.ranked[0].score;
  for (const item of trend.ranked) {
    scores[item.number] += (item.score / maxTrend) * 35;
  }

  // Overdue score (20% weight)
  const maxOverdue = overdue.ranked[0].drawsSinceLastSeen;
  if (maxOverdue > 0 && maxOverdue !== Infinity) {
    for (const item of overdue.ranked) {
      if (item.drawsSinceLastSeen !== Infinity) {
        scores[item.number] += (item.drawsSinceLastSeen / maxOverdue) * 20;
      }
    }
  }

  // Hot Pairs boost (15% weight)
  // Count how many times each number appears in the top 20 pairs
  const pairBoost = new Array(TOTAL_NUMBERS + 1).fill(0);
  for (const p of hotPairs) {
    const [a, b] = p.pair.split('-').map(Number);
    pairBoost[a] += p.count;
    pairBoost[b] += p.count;
  }
  const maxPairBoost = Math.max(...pairBoost.filter(v => v > 0), 1);
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    scores[i] += (pairBoost[i] / maxPairBoost) * 15;
  }

  // Strong number scores (unchanged — pairs don't apply to strong numbers)
  const maxStrongFreq = freq.strongRanked[0].count;
  for (const item of freq.strongRanked) {
    strongScores[item.number] += (item.count / maxStrongFreq) * 35;
  }
  const maxStrongTrend = trend.strongRanked[0].score;
  for (const item of trend.strongRanked) {
    strongScores[item.number] += (item.score / maxStrongTrend) * 40;
  }
  const maxStrongOverdue = overdue.strongRanked[0].drawsSinceLastSeen;
  if (maxStrongOverdue > 0 && maxStrongOverdue !== Infinity) {
    for (const item of overdue.strongRanked) {
      if (item.drawsSinceLastSeen !== Infinity) {
        strongScores[item.number] += (item.drawsSinceLastSeen / maxStrongOverdue) * 25;
      }
    }
  }

  // Rank all numbers by combined score
  const allRanked = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    allRanked.push({ number: i, score: parseFloat(scores[i].toFixed(2)) });
  }
  allRanked.sort((a, b) => b.score - a.score);

  const allStrongRanked = [];
  for (let i = 1; i <= STRONG_MAX; i++) {
    allStrongRanked.push({ number: i, score: parseFloat(strongScores[i].toFixed(2)) });
  }
  allStrongRanked.sort((a, b) => b.score - a.score);

  // Line 1: Top 6 by combined score
  const line1 = allRanked.slice(0, PICK_COUNT)
    .map(x => x.number)
    .sort((a, b) => a - b);
  const strong1 = allStrongRanked[0].number;

  // Line 2: Mix of top frequency + top overdue (diversified pick)
  const usedInLine1 = new Set(line1);
  const line2candidates = allRanked.filter(x => !usedInLine1.has(x.number));
  // Take top 3 from remaining by score, then top 3 overdue not already picked
  const top3remaining = line2candidates.slice(0, 3).map(x => x.number);
  const overdueNotPicked = overdue.ranked
    .filter(x => !usedInLine1.has(x.number) && !top3remaining.includes(x.number));
  const top3overdue = overdueNotPicked.slice(0, 3).map(x => x.number);
  const line2 = [...top3remaining, ...top3overdue].sort((a, b) => a - b);
  const strong2 = allStrongRanked[1] ? allStrongRanked[1].number : allStrongRanked[0].number;

  return {
    line1: { numbers: line1, strong: strong1 },
    line2: { numbers: line2, strong: strong2 },
    analysis: {
      totalDrawsAnalyzed: draws.length,
      dateRange: {
        from: draws[draws.length - 1].date,
        to: draws[0].date,
      },
      topFrequent: freq.ranked.slice(0, 10),
      topTrending: trend.ranked.slice(0, 10),
      topOverdue: overdue.ranked.slice(0, 10),
      hotPairs,
      allScores: allRanked,
      strongScores: allStrongRanked,
    },
  };
}

/**
 * Format recommendations as WhatsApp-friendly message
 */
function formatWhatsAppMessage(rec) {
  const d = new Date();
  const dateStr = d.toLocaleDateString('he-IL');

  const line1Str = rec.line1.numbers.join(', ');
  const line2Str = rec.line2.numbers.join(', ');

  return [
    `🎰 *לוטו - המלצות ל-${dateStr}*`,
    ``,
    `📊 ניתוח ${rec.analysis.totalDrawsAnalyzed} הגרלות`,
    ``,
    `*שורה 1:*`,
    `🔢 ${line1Str}  |  💪 חזק: ${rec.line1.strong}`,
    ``,
    `*שורה 2:*`,
    `🔢 ${line2Str}  |  💪 חזק: ${rec.line2.strong}`,
    ``,
    `🔥 *חמים:* ${rec.analysis.topFrequent.slice(0, 5).map(x => x.number).join(', ')}`,
    `📈 *במגמה:* ${rec.analysis.topTrending.slice(0, 5).map(x => x.number).join(', ')}`,
    `⏰ *מאחרים:* ${rec.analysis.topOverdue.slice(0, 5).map(x => x.number).join(', ')}`,
    ``,
    `בהצלחה! 🍀`,
  ].join('\n');
}

module.exports = {
  fetchAllDraws,
  fetchRecentDraws,
  frequencyAnalysis,
  recentTrendAnalysis,
  overdueAnalysis,
  hotPairsAnalysis,
  generateRecommendations,
  formatWhatsAppMessage,
};

// If run directly, show analysis
if (require.main === module) {
  (async () => {
    console.log('🔄 Fetching all historical draws...');
    const draws = await fetchAllDraws();
    console.log(`✅ Fetched ${draws.length} draws\n`);

    const rec = generateRecommendations(draws);
    console.log(formatWhatsAppMessage(rec));

    console.log('\n--- Detailed Scores ---');
    console.log('Top 15 numbers by combined score:');
    for (const item of rec.analysis.allScores.slice(0, 15)) {
      console.log(`  #${item.number.toString().padStart(2)}: ${item.score}`);
    }
  })();
}
