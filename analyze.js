/**
 * Israeli Lotto Analyzer
 * Fetches historical data from PaisAPI and calculates recommended numbers
 * using multiple statistical methods.
 *
 * Lotto format: 6 numbers from 1-37 + 1 strong number from 1-7
 */

const PAIS_API = 'https://paisapi.azurewebsites.net';
const TOTAL_NUMBERS = 37;
const PICK_COUNT = 6;
const STRONG_MAX = 7;

// In-memory cache to avoid repeated slow API calls
let _drawsCache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchAllDraws() {
  // Return cache if still valid
  if (_drawsCache && Date.now() - _cacheTime < CACHE_TTL) {
    return _drawsCache;
  }

  // Fetch in batches by ID range (most recent draw is ~3744)
  // Fetch from ID 1 to 4000 in chunks of 500
  const allDraws = [];
  const batchSize = 500;
  const maxId = 4000;

  for (let start = 1; start <= maxId; start += batchSize) {
    const end = Math.min(start + batchSize - 1, maxId);
    try {
      const res = await fetch(`${PAIS_API}/lotto/byID/${start}/${end}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          allDraws.push(...data);
        }
      }
    } catch (e) {
      // Skip failed batch, continue with others
      console.log(`Batch ${start}-${end} skipped: ${e.message}`);
    }
  }

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

  // Combined score for each number
  const scores = new Array(TOTAL_NUMBERS + 1).fill(0);
  const strongScores = new Array(STRONG_MAX + 1).fill(0);

  // Frequency score (normalized 0-100)
  const maxFreq = freq.ranked[0].count;
  for (const item of freq.ranked) {
    scores[item.number] += (item.count / maxFreq) * 35; // 35% weight
  }

  // Trend score (normalized 0-100)
  const maxTrend = trend.ranked[0].score;
  for (const item of trend.ranked) {
    scores[item.number] += (item.score / maxTrend) * 40; // 40% weight
  }

  // Overdue score (normalized 0-100)
  const maxOverdue = overdue.ranked[0].drawsSinceLastSeen;
  if (maxOverdue > 0 && maxOverdue !== Infinity) {
    for (const item of overdue.ranked) {
      if (item.drawsSinceLastSeen !== Infinity) {
        scores[item.number] += (item.drawsSinceLastSeen / maxOverdue) * 25; // 25% weight
      }
    }
  }

  // Strong number scores
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
      hotPairs: hotPairsAnalysis(draws),
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
