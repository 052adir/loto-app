/**
 * Israeli Lotto Analyzer
 * Loads historical data from public/draws.json and calculates recommended numbers
 * using multiple statistical methods.
 *
 * Lotto format: 6 numbers from 1-37 + 1 strong number from 1-7
 */

const fs = require('fs');
const path = require('path');

const DRAWS_PATH = path.join(__dirname, 'public', 'draws.json');
const TOTAL_NUMBERS = 37;
const PICK_COUNT = 6;
const STRONG_MAX = 7;

// In-memory cache
let _drawsCache = null;

/**
 * Load all draws from the static JSON file (public/draws.json).
 * No network requests — data is updated offline via update_data.js.
 */
function fetchAllDraws() {
  if (_drawsCache) return _drawsCache;

  if (!fs.existsSync(DRAWS_PATH)) {
    throw new Error(`draws.json not found at ${DRAWS_PATH}. Run "npm run update" locally first.`);
  }

  const raw = fs.readFileSync(DRAWS_PATH, 'utf-8');
  const draws = JSON.parse(raw);

  if (!Array.isArray(draws) || draws.length === 0) {
    throw new Error('draws.json is empty or invalid. Run "npm run update" to regenerate it.');
  }

  // Ensure sorted newest-first
  draws.sort((a, b) => new Date(b.date) - new Date(a.date));

  _drawsCache = draws;
  console.log(`📊 Loaded ${draws.length} draws from draws.json`);
  return _drawsCache;
}

function fetchRecentDraws(count = 200) {
  const all = fetchAllDraws();
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
 * Structural balance helpers — assess whether a 6-number combo "looks like"
 * a realistic Lotto draw. Based on stats from real historical draws:
 *   - Sum of 6 numbers from 1-37 typically falls between ~80 and ~160 (mean ≈ 114).
 *   - Most draws contain 2-4 odd numbers (out of 6).
 *   - Most draws have a spread across low (1-12), mid (13-25), high (26-37).
 *   - Long consecutive runs (3+ in a row) are uncommon.
 *
 * These checks don't change the probability of winning (lotto is truly random),
 * but they avoid degenerate-looking picks like {1,2,3,4,5,6}.
 */
function isStructurallyBalanced(nums) {
  if (!nums || nums.length !== PICK_COUNT) return false;
  const sorted = [...nums].sort((a, b) => a - b);

  // Sum check
  const sum = sorted.reduce((s, n) => s + n, 0);
  if (sum < 80 || sum > 160) return false;

  // Odd/even balance: 2-4 odd numbers
  const odds = sorted.filter((n) => n % 2 === 1).length;
  if (odds < 2 || odds > 4) return false;

  // Range spread: at least one in each of low / mid / high
  const low = sorted.filter((n) => n <= 12).length;
  const mid = sorted.filter((n) => n > 12 && n <= 25).length;
  const high = sorted.filter((n) => n > 25).length;
  if (low === 0 || mid === 0 || high === 0) return false;

  // Avoid 4+ consecutive
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run++;
      if (run >= 4) return false;
    } else {
      run = 1;
    }
  }

  return true;
}

/**
 * Weighted random sampling without replacement.
 * Each item is picked with probability proportional to its weight,
 * which means high-scoring numbers dominate but lower-scoring ones still
 * have a chance — producing variation between runs while keeping picks
 * grounded in the algorithm's scores.
 */
function weightedSampleWithoutReplacement(items, k, getWeight) {
  const pool = items.slice();
  const picks = [];

  while (picks.length < k && pool.length > 0) {
    const totalWeight = pool.reduce((s, x) => s + Math.max(0, getWeight(x)), 0);
    if (totalWeight <= 0) {
      // All remaining weights are 0 — pick uniformly at random
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool[idx]);
      pool.splice(idx, 1);
      continue;
    }
    let r = Math.random() * totalWeight;
    for (let j = 0; j < pool.length; j++) {
      r -= Math.max(0, getWeight(pool[j]));
      if (r <= 0) {
        picks.push(pool[j]);
        pool.splice(j, 1);
        break;
      }
    }
  }

  return picks;
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
 * Method 5: Statistical Significance (z-score) Analysis  — the "brain" of line 1.
 *
 * In a FAIR lotto draw every number is equally likely, so "most frequent" or
 * "overdue" carry no predictive power (the ball has no memory — leaning on
 * overdue numbers is the gambler's fallacy). The ONLY thing that could give a
 * real edge is a physical bias: a number that appears MORE often than pure
 * chance can explain, across the whole history.
 *
 * For each number we model its appearances as Binomial(N, p):
 *   - main numbers: p = PICK_COUNT / TOTAL_NUMBERS  (6/37)
 *   - strong number: p = 1 / STRONG_MAX             (1/7)
 * The z-score = (observed - expected) / standardDeviation tells us how many
 * standard deviations a number sits above (or below) chance. |z| > ~2 means
 * the deviation is unlikely to be random noise (~95% confidence).
 *
 * We expose a positive 0-100 "smartScore" (= 50 + 10*z, clamped) so the UI
 * heatmap and selection logic can rank numbers: 50 ≈ exactly as chance predicts,
 * >50 = over-represented (mild real-bias signal), <50 = under-represented.
 */
function signalAnalysis(draws) {
  const N = draws.length;
  const freq = new Array(TOTAL_NUMBERS + 1).fill(0);
  const strongFreq = new Array(STRONG_MAX + 1).fill(0);

  for (const draw of draws) {
    for (const num of draw.winNumbers) freq[num]++;
    if (draw.strongNumber) strongFreq[draw.strongNumber]++;
  }

  const zToScore = (z) => parseFloat(Math.max(0, Math.min(100, 50 + 10 * z)).toFixed(2));

  const pMain = PICK_COUNT / TOTAL_NUMBERS;
  const sdMain = Math.sqrt(N * pMain * (1 - pMain));
  const ranked = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) {
    const expected = N * pMain;
    const z = sdMain > 0 ? (freq[i] - expected) / sdMain : 0;
    ranked.push({ number: i, observed: freq[i], expected: parseFloat(expected.toFixed(1)), z: parseFloat(z.toFixed(2)), score: zToScore(z) });
  }
  ranked.sort((a, b) => b.score - a.score);

  const pStrong = 1 / STRONG_MAX;
  const sdStrong = Math.sqrt(N * pStrong * (1 - pStrong));
  const strongRanked = [];
  for (let i = 1; i <= STRONG_MAX; i++) {
    const expected = N * pStrong;
    const z = sdStrong > 0 ? (strongFreq[i] - expected) / sdStrong : 0;
    strongRanked.push({ number: i, observed: strongFreq[i], expected: parseFloat(expected.toFixed(1)), z: parseFloat(z.toFixed(2)), score: zToScore(z) });
  }
  strongRanked.sort((a, b) => b.score - a.score);

  return { ranked, strongRanked };
}

/**
 * Build the SMART line (line 1): a deterministic, fully-reasoned decision.
 *
 * Instead of randomly sampling, we take the top CANDIDATE_POOL numbers by
 * statistical signal and EXHAUSTIVELY search every 6-number subset of them
 * (C(12,6) = 924 combos — trivial) for the one that:
 *   (a) passes structural balance (realistic sum / parity / spread / no long run), AND
 *   (b) maximizes total signal score.
 * This is a genuine upgrade in decision quality: it considers the combo as a
 * whole rather than picking 6 numbers independently, and it never falls back on
 * the gambler's-fallacy "overdue" heuristic.
 */
function buildSmartLine(signalRanked) {
  const CANDIDATE_POOL = 12;
  const candidates = signalRanked.slice(0, CANDIDATE_POOL);

  let best = null;
  let bestScore = -Infinity;
  // Enumerate all 6-subsets of the candidate pool.
  const idx = [0, 1, 2, 3, 4, 5];
  const n = candidates.length;
  const combo = () => idx.map((i) => candidates[i]);
  const advance = () => {
    // odometer-style next combination
    let i = PICK_COUNT - 1;
    while (i >= 0 && idx[i] === n - PICK_COUNT + i) i--;
    if (i < 0) return false;
    idx[i]++;
    for (let j = i + 1; j < PICK_COUNT; j++) idx[j] = idx[j - 1] + 1;
    return true;
  };

  do {
    const set = combo();
    const nums = set.map((x) => x.number);
    if (isStructurallyBalanced(nums)) {
      const total = set.reduce((s, x) => s + x.score, 0);
      if (total > bestScore) {
        bestScore = total;
        best = nums.slice().sort((a, b) => a - b);
      }
    }
  } while (advance());

  // Fallback: no balanced subset found — take the top 6 by signal.
  if (!best) {
    best = candidates.slice(0, PICK_COUNT).map((x) => x.number).sort((a, b) => a - b);
  }
  return best;
}

/**
 * Build the RANDOM line (line 2): a fair, uniform random pick — exactly what an
 * honest "quick pick" is. 6 distinct numbers from 1-37 + a strong number 1-7,
 * every combination equally likely. No analysis, no bias, no pretense.
 */
function buildRandomLine() {
  const pool = [];
  for (let i = 1; i <= TOTAL_NUMBERS; i++) pool.push(i);
  // Fisher-Yates partial shuffle for the first PICK_COUNT slots.
  for (let i = 0; i < PICK_COUNT; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const numbers = pool.slice(0, PICK_COUNT).sort((a, b) => a - b);
  const strong = 1 + Math.floor(Math.random() * STRONG_MAX);
  return { numbers, strong };
}

// Default weights for the combined scoring
const DEFAULT_WEIGHTS = { frequency: 30, trend: 35, overdue: 20, pairs: 15 };
const DEFAULT_STRONG_WEIGHTS = { frequency: 35, trend: 40, overdue: 25 };
const WEIGHTS_PATH = path.join(__dirname, 'public', 'adaptive_weights.json');

/**
 * Load adaptive weights from disk, or return defaults.
 */
function loadAdaptiveWeights() {
  try {
    if (fs.existsSync(WEIGHTS_PATH)) {
      const data = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8'));
      if (data.weights && data.strongWeights) return data;
    }
  } catch (_) { /* fall through to defaults */ }
  return { weights: { ...DEFAULT_WEIGHTS }, strongWeights: { ...DEFAULT_STRONG_WEIGHTS } };
}

/**
 * Save adaptive weights to disk.
 */
function saveAdaptiveWeights(weights, strongWeights, meta = {}) {
  const data = { weights, strongWeights, updatedAt: new Date().toISOString(), ...meta };
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Combined scoring: weighted blend of all methods
 * Returns 2 recommended lines
 * Accepts optional custom weights for adaptive tuning.
 */
function generateRecommendations(draws, customWeights, customStrongWeights) {
  const w = customWeights || loadAdaptiveWeights().weights;
  const sw = customStrongWeights || loadAdaptiveWeights().strongWeights;

  const freq = frequencyAnalysis(draws);
  const trend = recentTrendAnalysis(draws, 100);
  const overdue = overdueAnalysis(draws);
  const hotPairs = hotPairsAnalysis(draws);

  // ---- The "brain": statistical-significance ranking (see signalAnalysis). ----
  // Numbers are ranked by how far their real appearance rate deviates from pure
  // chance, NOT by raw frequency or by the gambler's-fallacy "overdue" idea.
  const signal = signalAnalysis(draws);
  const allRanked = signal.ranked.map((x) => ({ number: x.number, score: x.score, z: x.z, observed: x.observed, expected: x.expected }));
  const allStrongRanked = signal.strongRanked.map((x) => ({ number: x.number, score: x.score, z: x.z, observed: x.observed, expected: x.expected }));

  // ---- Line 1 (SMART): deterministic best-balanced subset of the top-signal
  // numbers. Considers the whole combo, not 6 independent picks. ----
  const line1 = buildSmartLine(signal.ranked);
  const strong1 = signal.strongRanked[0].number;

  // ---- Line 2 (RANDOM): a fair uniform quick-pick. No analysis applied. ----
  const randomLine = buildRandomLine();
  const line2 = randomLine.numbers;
  const strong2 = randomLine.strong;

  return {
    line1: { numbers: line1, strong: strong1, type: 'smart', label: 'חיזוי חכם' },
    line2: { numbers: line2, strong: strong2, type: 'random', label: 'אקראי לחלוטין' },
    weightsUsed: { ...w },
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
 * Backtest: for a given draw index, use all draws AFTER it (older) to predict,
 * then compare against the actual draw at that index.
 * Returns hit counts for line1, line2, and strong numbers.
 */
function backtestSingleDraw(allDraws, drawIndex, weights, strongWeights) {
  const actual = allDraws[drawIndex];
  // Use only draws older than this one (indices > drawIndex since sorted newest-first)
  const historicalDraws = allDraws.slice(drawIndex + 1);
  if (historicalDraws.length < 50) return null; // Not enough history

  const rec = generateRecommendations(historicalDraws, weights, strongWeights);

  const actualSet = new Set(actual.winNumbers);
  const line1Hits = rec.line1.numbers.filter(n => actualSet.has(n));
  const line2Hits = rec.line2.numbers.filter(n => actualSet.has(n));
  const strong1Hit = rec.line1.strong === actual.strongNumber;
  const strong2Hit = rec.line2.strong === actual.strongNumber;

  // Also check how many of the top-12 recommended (both lines combined) hit
  const allRecommended = new Set([...rec.line1.numbers, ...rec.line2.numbers]);
  const totalHits = [...allRecommended].filter(n => actualSet.has(n));

  return {
    drawId: actual._id,
    date: actual.date,
    actual: { numbers: actual.winNumbers, strong: actual.strongNumber },
    line1: { predicted: rec.line1.numbers, hits: line1Hits, strong: { predicted: rec.line1.strong, hit: strong1Hit } },
    line2: { predicted: rec.line2.numbers, hits: line2Hits, strong: { predicted: rec.line2.strong, hit: strong2Hit } },
    totalUniqueHits: totalHits.length,
    totalUniquePredicted: allRecommended.size,
  };
}

/**
 * Run backtest over the last N draws.
 * Returns individual results and aggregate stats.
 */
function backtestOverRange(allDraws, count = 50, weights, strongWeights) {
  const results = [];
  const limit = Math.min(count, allDraws.length - 50); // need at least 50 historical draws

  for (let i = 0; i < limit; i++) {
    const result = backtestSingleDraw(allDraws, i, weights, strongWeights);
    if (result) results.push(result);
  }

  if (results.length === 0) return { results: [], stats: null };

  // Aggregate statistics
  const totalLine1Hits = results.reduce((s, r) => s + r.line1.hits.length, 0);
  const totalLine2Hits = results.reduce((s, r) => s + r.line2.hits.length, 0);
  const totalStrong1Hits = results.filter(r => r.line1.strong.hit).length;
  const totalStrong2Hits = results.filter(r => r.line2.strong.hit).length;
  const totalUniqueHits = results.reduce((s, r) => s + r.totalUniqueHits, 0);

  // Per-method contribution tracking: for each draw, see which method contributed most hits
  const methodContrib = { frequency: 0, trend: 0, overdue: 0, pairs: 0 };
  for (let i = 0; i < Math.min(count, allDraws.length - 50); i++) {
    const actual = allDraws[i];
    const historical = allDraws.slice(i + 1);
    if (historical.length < 50) continue;

    const actualSet = new Set(actual.winNumbers);
    const freq = frequencyAnalysis(historical);
    const trend = recentTrendAnalysis(historical, 100);
    const overdue = overdueAnalysis(historical);
    const pairs = hotPairsAnalysis(historical);

    // Top 6 from each method
    const freqTop = new Set(freq.ranked.slice(0, 6).map(x => x.number));
    const trendTop = new Set(trend.ranked.slice(0, 6).map(x => x.number));
    const overdueTop = new Set(overdue.ranked.slice(0, 6).map(x => x.number));
    // For pairs: collect numbers that appear most in hot pairs
    const pairNums = {};
    for (const p of pairs) {
      const [a, b] = p.pair.split('-').map(Number);
      pairNums[a] = (pairNums[a] || 0) + p.count;
      pairNums[b] = (pairNums[b] || 0) + p.count;
    }
    const pairTop = new Set(Object.entries(pairNums).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => Number(x[0])));

    for (const n of actual.winNumbers) {
      if (freqTop.has(n)) methodContrib.frequency++;
      if (trendTop.has(n)) methodContrib.trend++;
      if (overdueTop.has(n)) methodContrib.overdue++;
      if (pairTop.has(n)) methodContrib.pairs++;
    }
  }

  const stats = {
    drawsTested: results.length,
    line1: {
      avgHits: parseFloat((totalLine1Hits / results.length).toFixed(2)),
      totalHits: totalLine1Hits,
      strongHitRate: parseFloat(((totalStrong1Hits / results.length) * 100).toFixed(1)),
    },
    line2: {
      avgHits: parseFloat((totalLine2Hits / results.length).toFixed(2)),
      totalHits: totalLine2Hits,
      strongHitRate: parseFloat(((totalStrong2Hits / results.length) * 100).toFixed(1)),
    },
    combined: {
      avgUniqueHits: parseFloat((totalUniqueHits / results.length).toFixed(2)),
      totalUniqueHits,
    },
    methodContrib,
  };

  return { results, stats };
}

/**
 * Compute adaptive weights based on recent backtest performance.
 *
 * Strategy: run a backtest over the last 50 draws, measure how many hits each
 * individual method's top-6 produced, then redistribute weight proportionally.
 * Weights are clamped between 10 and 50 to prevent any single method from
 * dominating, and they are normalized to sum to 100.
 */
function computeAdaptiveWeights(allDraws, backtestWindow = 50) {
  const bt = backtestOverRange(allDraws, backtestWindow, DEFAULT_WEIGHTS, DEFAULT_STRONG_WEIGHTS);
  if (!bt.stats) return { weights: { ...DEFAULT_WEIGHTS }, strongWeights: { ...DEFAULT_STRONG_WEIGHTS } };

  const mc = bt.stats.methodContrib;
  const totalContrib = mc.frequency + mc.trend + mc.overdue + mc.pairs;

  if (totalContrib === 0) return { weights: { ...DEFAULT_WEIGHTS }, strongWeights: { ...DEFAULT_STRONG_WEIGHTS } };

  // Raw proportional weights (out of 100)
  let rawWeights = {
    frequency: (mc.frequency / totalContrib) * 100,
    trend: (mc.trend / totalContrib) * 100,
    overdue: (mc.overdue / totalContrib) * 100,
    pairs: (mc.pairs / totalContrib) * 100,
  };

  // Clamp between 10 and 50
  const CLAMP_MIN = 10;
  const CLAMP_MAX = 50;
  for (const key of Object.keys(rawWeights)) {
    rawWeights[key] = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, rawWeights[key]));
  }

  // Normalize to sum to 100
  const rawSum = Object.values(rawWeights).reduce((a, b) => a + b, 0);
  const weights = {};
  for (const key of Object.keys(rawWeights)) {
    weights[key] = parseFloat(((rawWeights[key] / rawSum) * 100).toFixed(1));
  }

  // Strong weights: keep proportional between frequency & trend based on strong hit rates
  // (overdue gets a fixed share for strong since there are only 7 options)
  const strongWeights = { ...DEFAULT_STRONG_WEIGHTS };

  return { weights, strongWeights, methodContrib: mc, backtestStats: bt.stats };
}

/**
 * Evaluate the latest draw for the frontend.
 * Uses all draws except the newest to predict, then compares against actual.
 * Returns a structured object ready for JSON serialization.
 */
function evaluateLatestDraw(allDraws) {
  if (!allDraws || allDraws.length < 51) return null;

  const latestDraw = allDraws[0];
  const historicalDraws = allDraws.slice(1);

  const rec = generateRecommendations(historicalDraws);

  const actualSet = new Set(latestDraw.winNumbers);
  const line1Hits = rec.line1.numbers.filter(n => actualSet.has(n));
  const line2Hits = rec.line2.numbers.filter(n => actualSet.has(n));
  const strong1Hit = rec.line1.strong === latestDraw.strongNumber;
  const strong2Hit = rec.line2.strong === latestDraw.strongNumber;

  const allPredicted = new Set([...rec.line1.numbers, ...rec.line2.numbers]);
  const totalUniqueHits = [...allPredicted].filter(n => actualSet.has(n));

  // Per-number detail for line1 and line2 (for visual hit/miss display)
  const line1Detail = rec.line1.numbers.map(n => ({ number: n, hit: actualSet.has(n) }));
  const line2Detail = rec.line2.numbers.map(n => ({ number: n, hit: actualSet.has(n) }));

  return {
    drawId: latestDraw._id,
    date: latestDraw.date,
    actual: { numbers: latestDraw.winNumbers, strong: latestDraw.strongNumber },
    line1: {
      predicted: rec.line1.numbers,
      detail: line1Detail,
      hitsCount: line1Hits.length,
      hits: line1Hits,
      strong: { predicted: rec.line1.strong, hit: strong1Hit },
    },
    line2: {
      predicted: rec.line2.numbers,
      detail: line2Detail,
      hitsCount: line2Hits.length,
      hits: line2Hits,
      strong: { predicted: rec.line2.strong, hit: strong2Hit },
    },
    totalUniqueHits: totalUniqueHits.length,
    totalUniquePredicted: allPredicted.size,
  };
}

/**
 * Generate human-readable Hebrew insights based on adaptive weight changes.
 * Compares current adaptive weights against defaults, and summarizes
 * which methods the algorithm is leaning into or away from.
 */
function generateAlgorithmInsights(allDraws) {
  if (!allDraws || allDraws.length < 100) return null;

  const adaptive = computeAdaptiveWeights(allDraws, 50);
  const prev = loadAdaptiveWeights();
  const newW = adaptive.weights;
  const oldW = prev.weights;

  const METHOD_NAMES = {
    frequency: 'התדירות',
    trend: 'המגמה',
    overdue: 'המספרים המאחרים',
    pairs: 'הזוגות',
  };

  const METHOD_DESCRIPTIONS = {
    frequency: 'מספרים שמופיעים הכי הרבה פעמים בהיסטוריה',
    trend: 'מספרים שנמצאים במגמת עלייה בהגרלות האחרונות',
    overdue: 'מספרים שלא הופיעו כבר זמן רב',
    pairs: 'זוגות מספרים שנוטים להופיע יחד',
  };

  const insights = [];

  // Find the biggest movers (delta between new and old weights)
  const deltas = Object.keys(newW).map(key => ({
    key,
    delta: newW[key] - oldW[key],
    newVal: newW[key],
  }));
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Significant increases
  const increased = deltas.filter(d => d.delta > 1.5);
  const decreased = deltas.filter(d => d.delta < -1.5);

  for (const d of increased) {
    insights.push(
      `המערכת זיהתה ששיטת ${METHOD_NAMES[d.key]} (${METHOD_DESCRIPTIONS[d.key]}) מדויקת יותר לאחרונה, ולכן משקלה הועלה ל-${d.newVal.toFixed(1)}% לקראת ההגרלה הבאה.`
    );
  }

  for (const d of decreased) {
    insights.push(
      `שיטת ${METHOD_NAMES[d.key]} הראתה פחות דיוק בהגרלות האחרונות, ולכן משקלה הורד ל-${d.newVal.toFixed(1)}%.`
    );
  }

  // If no significant changes, report stability
  if (insights.length === 0) {
    insights.push('כל השיטות מציגות ביצועים יציבים — המשקלות נשארו ללא שינוי משמעותי.');
  }

  // Always add a summary of the dominant method
  const dominant = deltas.reduce((best, d) => d.newVal > best.newVal ? d : best, deltas[0]);
  insights.push(
    `השיטה המשפיעה ביותר כרגע: ${METHOD_NAMES[dominant.key]} (${dominant.newVal.toFixed(1)}%).`
  );

  // Add backtest hit-rate context if available
  if (adaptive.backtestStats) {
    const s = adaptive.backtestStats;
    const bestLine = s.line1.avgHits >= s.line2.avgHits ? 1 : 2;
    const bestAvg = Math.max(s.line1.avgHits, s.line2.avgHits);
    insights.push(
      `בבדיקה לאחור על ${s.drawsTested} הגרלות אחרונות, שורה ${bestLine} הצליחה בממוצע ${bestAvg} מתוך 6 מספרים.`
    );
  }

  return {
    insights,
    weights: newW,
    previousWeights: oldW,
    deltas: deltas.map(d => ({ method: d.key, name: METHOD_NAMES[d.key], delta: parseFloat(d.delta.toFixed(1)), weight: d.newVal })),
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
    `*שורה 1 — 🧠 חיזוי חכם:*`,
    `🔢 ${line1Str}  |  💪 חזק: ${rec.line1.strong}`,
    ``,
    `*שורה 2 — 🎲 אקראי לחלוטין:*`,
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
  signalAnalysis,
  buildSmartLine,
  buildRandomLine,
  generateRecommendations,
  evaluateLatestDraw,
  generateAlgorithmInsights,
  formatWhatsAppMessage,
  backtestSingleDraw,
  backtestOverRange,
  computeAdaptiveWeights,
  loadAdaptiveWeights,
  saveAdaptiveWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_STRONG_WEIGHTS,
};

// If run directly, show analysis
if (require.main === module) {
  console.log('🔄 Loading draws from draws.json...');
  const draws = fetchAllDraws();
  console.log(`✅ Loaded ${draws.length} draws\n`);

  // Run adaptive weight computation
  console.log('⚙️  Computing adaptive weights from recent backtest...');
  const adaptive = computeAdaptiveWeights(draws, 50);
  saveAdaptiveWeights(adaptive.weights, adaptive.strongWeights, {
    methodContrib: adaptive.methodContrib,
  });
  console.log(`   Adaptive weights: freq=${adaptive.weights.frequency}% trend=${adaptive.weights.trend}% overdue=${adaptive.weights.overdue}% pairs=${adaptive.weights.pairs}%`);

  const rec = generateRecommendations(draws);
  console.log(`\n   Using weights: freq=${rec.weightsUsed.frequency}% trend=${rec.weightsUsed.trend}% overdue=${rec.weightsUsed.overdue}% pairs=${rec.weightsUsed.pairs}%\n`);
  console.log(formatWhatsAppMessage(rec));

  console.log('\n--- Detailed Scores ---');
  console.log('Top 15 numbers by combined score:');
  for (const item of rec.analysis.allScores.slice(0, 15)) {
    console.log(`  #${item.number.toString().padStart(2)}: ${item.score}`);
  }

  // Show quick backtest summary
  if (adaptive.backtestStats) {
    const s = adaptive.backtestStats;
    console.log('\n--- Backtest Summary (last 50 draws) ---');
    console.log(`   Line 1: avg ${s.line1.avgHits}/6 hits per draw | Strong hit rate: ${s.line1.strongHitRate}%`);
    console.log(`   Line 2: avg ${s.line2.avgHits}/6 hits per draw | Strong hit rate: ${s.line2.strongHitRate}%`);
    console.log(`   Combined unique: avg ${s.combined.avgUniqueHits} hits per draw`);
    console.log(`   Method contributions: freq=${adaptive.methodContrib.frequency} trend=${adaptive.methodContrib.trend} overdue=${adaptive.methodContrib.overdue} pairs=${adaptive.methodContrib.pairs}`);
  }
}
