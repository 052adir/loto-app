/**
 * Randomness sanity-check: do the REAL Israeli lotto draws behave like a fair
 * random draw, or is there a "guiding hand" avoiding weird-looking patterns
 * (like 4+ consecutive numbers)?
 *
 * Method:
 *   1. Measure the longest run of consecutive numbers in each real draw.
 *   2. Compute the EXACT theoretical distribution by enumerating ALL
 *      C(37,6) = 2,324,784 possible draws.
 *   3. Compare observed vs expected. If they match → it's genuinely random.
 */
const { fetchAllDraws } = require('./analyze');

const N = 37, K = 6;

// Longest run of consecutive integers in a sorted set of K numbers.
function longestRun(sortedNums) {
  let best = 1, run = 1;
  for (let i = 1; i < sortedNums.length; i++) {
    if (sortedNums[i] === sortedNums[i - 1] + 1) { run++; if (run > best) best = run; }
    else run = 1;
  }
  return best;
}

const draws = fetchAllDraws();
const total = draws.length;

// ---- 1. Observed distribution ----
const observed = {}; // longestRun -> count
const drawsWithLongRun = []; // run >= 4
let observedAnyPair = 0; // draws with at least one consecutive pair (run >= 2)
let minSum = Infinity, minSumDraw = null, maxSum = -Infinity, maxSumDraw = null;

for (const d of draws) {
  const nums = [...d.winNumbers].sort((a, b) => a - b);
  const run = longestRun(nums);
  observed[run] = (observed[run] || 0) + 1;
  if (run >= 2) observedAnyPair++;
  if (run >= 4) drawsWithLongRun.push({ date: d.date.slice(0, 10), id: d._id, nums, run });
  const sum = nums.reduce((s, n) => s + n, 0);
  if (sum < minSum) { minSum = sum; minSumDraw = { date: d.date.slice(0, 10), nums }; }
  if (sum > maxSum) { maxSum = sum; maxSumDraw = { date: d.date.slice(0, 10), nums }; }
}

// ---- 2. EXACT theoretical distribution: enumerate every C(37,6) draw ----
const theory = {}; // longestRun -> count of combinations
let theoryTotal = 0;
const c = [1, 2, 3, 4, 5, 6];
function nextCombo() {
  let i = K - 1;
  while (i >= 0 && c[i] === N - K + 1 + i) i--;
  if (i < 0) return false;
  c[i]++;
  for (let j = i + 1; j < K; j++) c[j] = c[j - 1] + 1;
  return true;
}
do {
  const run = longestRun(c);
  theory[run] = (theory[run] || 0) + 1;
  theoryTotal++;
} while (nextCombo());

// ---- 3. Report ----
console.log(`\n================ בדיקת אקראיות — ${total} הגרלות אמיתיות ================\n`);
console.log(`סך הצירופים האפשריים בלוטו (6 מתוך 37): ${theoryTotal.toLocaleString()}\n`);

console.log('רצף הכי ארוך של מספרים עוקבים בהגרלה — נצפה מול צפוי:\n');
console.log('  רצף | נצפה בפועל | צפוי אקראית | הסתברות אקראית');
console.log('  ----|-----------|-------------|----------------');
let chi2 = 0;
for (let run = 1; run <= 6; run++) {
  const obs = observed[run] || 0;
  const p = (theory[run] || 0) / theoryTotal;
  const exp = p * total;
  if (exp > 0) chi2 += Math.pow(obs - exp, 2) / exp;
  const label = run === 1 ? 'אין עוקבים' : `${run} ברצף`;
  console.log(`  ${run.toString().padStart(2)} (${label.padEnd(11)}) | ${obs.toString().padStart(6)} | ${exp.toFixed(1).padStart(8)} | ${(p * 100).toFixed(3)}%`);
}
console.log(`\n  χ² (התאמה בין נצפה לצפוי) = ${chi2.toFixed(2)}  (df=5; ערך נמוך = התאמה מצוינת לאקראי)`);

const pPairTheory = 1 - (theory[1] || 0) / theoryTotal;
console.log(`\n• הסתברות אקראית ל"לפחות זוג עוקב" בהגרלה: ${(pPairTheory * 100).toFixed(1)}%`);
console.log(`  בפועל בהגרלות שלך: ${observedAnyPair}/${total} = ${(observedAnyPair / total * 100).toFixed(1)}%`);

console.log(`\n================ ההגרלות ה"לא הגיוניות" שבאמת יצאו ================\n`);
console.log(`הגרלות עם 4 מספרים עוקבים או יותר: ${drawsWithLongRun.length} מתוך ${total}`);
console.log(`(צפוי אקראית: ${(((theory[4] || 0) + (theory[5] || 0) + (theory[6] || 0)) / theoryTotal * total).toFixed(1)})\n`);
for (const d of drawsWithLongRun) {
  console.log(`  ${d.date}  →  ${d.nums.join(', ')}   (רצף של ${d.run})`);
}

console.log(`\nההגרלה עם הסכום הנמוך ביותר: ${minSumDraw.nums.join(', ')} (סכום ${minSum}, ${minSumDraw.date})`);
console.log(`ההגרלה עם הסכום הגבוה ביותר: ${maxSumDraw.nums.join(', ')} (סכום ${maxSum}, ${maxSumDraw.date})`);
console.log('');
