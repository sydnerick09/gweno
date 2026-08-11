/**
 * Exclusive-plan mathematics task engine.
 *
 * Generates intermediate→advanced maths problems across many categories, each with a
 * CANONICAL answer computed here (server-side only — never sent to the client). Also
 * provides the comparison engine used to grade a client submission and to compare an
 * AI answer against the canonical answer (numeric tolerance + light normalisation).
 *
 * A generated task = { category, difficulty, question, instructions, canonical,
 * verifyMethod }. `canonical` is a display string; `verifyMethod` is 'numeric' | 'set'
 * | 'expression'. Comparison is tolerant of form (e.g. "x = 3", "3 = x", "3", "3.0").
 */

const CATEGORIES = [
  'Arithmetic', 'Percentages', 'Ratios', 'Linear equations', 'Simultaneous equations',
  'Quadratic equations', 'Sequences and series', 'Logarithms and exponents', 'Statistics',
  'Probability', 'Geometry', 'Trigonometry', 'Functions', 'Differentiation', 'Integration',
  'Limits', 'Optimization', 'Word problems',
];

const rint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const nonzero = (min, max) => { let v = 0; while (v === 0) v = rint(min, max); return v; };

// ---- Generators: each returns { category, difficulty, question, canonical, verifyMethod } ----
const GEN = {
  Arithmetic() {
    const a = rint(12, 40), b = rint(3, 12), c = rint(5, 25), d = rint(2, 9);
    return { difficulty: 'Intermediate', question: `Evaluate ${a} + ${b} × ${c} − ${d}.`,
      canonical: String(a + b * c - d), verifyMethod: 'numeric' };
  },
  Percentages() {
    const p = pick([5, 10, 12, 15, 20, 25, 30, 40]), n = rint(4, 40) * 10;
    return { difficulty: 'Intermediate', question: `What is ${p}% of ${n}?`,
      canonical: String(round(n * p / 100)), verifyMethod: 'numeric' };
  },
  Ratios() {
    const total = rint(6, 20) * 10, a = rint(2, 6), b = rint(2, 6);
    const larger = Math.max(a, b), share = round(total * larger / (a + b));
    return { difficulty: 'Intermediate', question: `An amount of ${total} is shared in the ratio ${a}:${b}. What is the larger share?`,
      canonical: String(share), verifyMethod: 'numeric' };
  },
  'Linear equations'() {
    const a = nonzero(2, 9), x = rint(-6, 9), b = rint(-12, 12), c = a * x + b;
    return { difficulty: 'Intermediate', question: `Solve for x:  ${a}x ${b >= 0 ? '+ ' + b : '− ' + -b} = ${c}.`,
      canonical: `x = ${x}`, verifyMethod: 'numeric' };
  },
  'Simultaneous equations'() {
    const x = rint(-5, 6), y = rint(-5, 6);
    const a1 = nonzero(1, 4), b1 = nonzero(1, 4), c1 = a1 * x + b1 * y;
    const a2 = nonzero(1, 4), b2 = nonzero(-4, 4) || 1, c2 = a2 * x + b2 * y;
    return { difficulty: 'Advanced', question: `Solve the simultaneous equations:  ${a1}x + ${b1}y = ${c1}  and  ${a2}x ${b2 >= 0 ? '+ ' + b2 : '− ' + -b2}y = ${c2}.`,
      canonical: `x = ${x}, y = ${y}`, verifyMethod: 'set' };
  },
  'Quadratic equations'() {
    const r1 = rint(-6, 6), r2 = rint(-6, 6);          // (x-r1)(x-r2)=0 => x^2 -(r1+r2)x + r1r2
    const b = -(r1 + r2), c = r1 * r2;
    return { difficulty: 'Advanced', question: `Solve for x:  x² ${b >= 0 ? '+ ' + b : '− ' + -b}x ${c >= 0 ? '+ ' + c : '− ' + -c} = 0.`,
      canonical: `x = ${Math.min(r1, r2)} or x = ${Math.max(r1, r2)}`, verifyMethod: 'set' };
  },
  'Sequences and series'() {
    const a = rint(1, 8), d = rint(2, 6), n = rint(6, 15);
    if (Math.random() < 0.5) {
      const term = a + (n - 1) * d;
      return { difficulty: 'Intermediate', question: `An arithmetic sequence has first term ${a} and common difference ${d}. Find the ${n}th term.`,
        canonical: String(term), verifyMethod: 'numeric' };
    }
    const sum = (n / 2) * (2 * a + (n - 1) * d);
    return { difficulty: 'Advanced', question: `Find the sum of the first ${n} terms of an arithmetic series with first term ${a} and common difference ${d}.`,
      canonical: String(round(sum)), verifyMethod: 'numeric' };
  },
  'Logarithms and exponents'() {
    if (Math.random() < 0.5) {
      const base = pick([2, 3, 5, 10]), k = rint(2, 5), val = base ** k;
      return { difficulty: 'Intermediate', question: `Evaluate log base ${base} of ${val}  (i.e. log_${base}(${val})).`,
        canonical: String(k), verifyMethod: 'numeric' };
    }
    const base = rint(2, 5), m = rint(2, 6), n = rint(2, 5), val = base ** (m + n);
    return { difficulty: 'Intermediate', question: `Simplify and evaluate:  ${base}^${m} × ${base}^${n}.`,
      canonical: String(val), verifyMethod: 'numeric' };
  },
  Statistics() {
    const list = Array.from({ length: pick([5, 7]) }, () => rint(2, 40));
    if (Math.random() < 0.5) {
      const mean = round(list.reduce((s, v) => s + v, 0) / list.length, 2);
      return { difficulty: 'Intermediate', question: `Find the mean of the data set: ${list.join(', ')}.`,
        canonical: String(mean), verifyMethod: 'numeric' };
    }
    const sorted = list.slice().sort((a, b) => a - b), median = sorted[(sorted.length - 1) / 2];
    return { difficulty: 'Intermediate', question: `Find the median of the data set: ${list.join(', ')}.`,
      canonical: String(median), verifyMethod: 'numeric' };
  },
  Probability() {
    const scenarios = [
      { q: 'A fair six-sided die is rolled. What is the probability of getting an even number? Give your answer as a decimal.', a: 0.5 },
      { q: 'A fair six-sided die is rolled. What is the probability of getting a number greater than 4? Give your answer as a decimal.', a: round(2 / 6) },
      { q: 'A card is drawn from a standard 52-card deck. What is the probability it is a heart? Give your answer as a decimal.', a: 0.25 },
      { q: 'A bag has 3 red and 5 blue balls. One is drawn at random. What is the probability it is red? Give your answer as a decimal.', a: round(3 / 8) },
    ];
    const s = pick(scenarios);
    return { difficulty: 'Intermediate', question: s.q, canonical: String(s.a), verifyMethod: 'numeric' };
  },
  Geometry() {
    const t = pick(['rect', 'triangle', 'circle', 'pyth']);
    if (t === 'rect') { const l = rint(4, 20), w = rint(3, 15); return { difficulty: 'Intermediate', question: `A rectangle is ${l} cm by ${w} cm. Find its area in cm².`, canonical: String(l * w), verifyMethod: 'numeric' }; }
    if (t === 'triangle') { const base = rint(4, 20), h = rint(3, 16); return { difficulty: 'Intermediate', question: `A triangle has base ${base} cm and height ${h} cm. Find its area in cm².`, canonical: String(round(0.5 * base * h)), verifyMethod: 'numeric' }; }
    if (t === 'circle') { const r = rint(2, 10); return { difficulty: 'Advanced', question: `Find the area of a circle of radius ${r} cm. Use π = 3.14159 and give your answer to 2 decimal places.`, canonical: String(round(Math.PI * r * r, 2)), verifyMethod: 'numeric' }; }
    const legs = pick([[3, 4], [6, 8], [5, 12], [8, 15], [9, 12]]);
    return { difficulty: 'Intermediate', question: `A right-angled triangle has the two shorter sides ${legs[0]} cm and ${legs[1]} cm. Find the length of the hypotenuse in cm.`,
      canonical: String(round(Math.hypot(legs[0], legs[1]), 4)), verifyMethod: 'numeric' };
  },
  Trigonometry() {
    const angles = [[30, 'sin', 0.5], [30, 'cos', round(Math.cos(Math.PI / 6))], [45, 'sin', round(Math.sin(Math.PI / 4))], [60, 'sin', round(Math.sin(Math.PI / 3))], [60, 'cos', 0.5], [45, 'tan', 1], [30, 'tan', round(Math.tan(Math.PI / 6))]];
    const [deg, fn, val] = pick(angles);
    return { difficulty: 'Advanced', question: `Evaluate ${fn}(${deg}°). Give your answer to 4 decimal places.`,
      canonical: String(val), verifyMethod: 'numeric' };
  },
  Functions() {
    const a = rint(1, 5), b = rint(-6, 6), c = rint(-6, 6), x = rint(-4, 5);
    const val = a * x * x + b * x + c;
    return { difficulty: 'Intermediate', question: `Given f(x) = ${a}x² ${b >= 0 ? '+ ' + b : '− ' + -b}x ${c >= 0 ? '+ ' + c : '− ' + -c}, find f(${x}).`,
      canonical: String(val), verifyMethod: 'numeric' };
  },
  Differentiation() {
    const a = rint(2, 5), n = rint(2, 4), b = rint(1, 6), x = rint(1, 4);
    // f(x)=a x^n + b x ; f'(x)= a n x^(n-1) + b ; evaluate at x
    const dv = a * n * x ** (n - 1) + b;
    return { difficulty: 'Advanced', question: `Given f(x) = ${a}x^${n} + ${b}x, find f′(x) evaluated at x = ${x}.`,
      canonical: String(dv), verifyMethod: 'numeric' };
  },
  Integration() {
    const a = rint(1, 4), lo = rint(0, 2), hi = lo + rint(1, 3);
    // ∫ (2a x) dx from lo to hi = a(hi^2 - lo^2)
    const val = a * (hi * hi - lo * lo);
    return { difficulty: 'Advanced', question: `Evaluate the definite integral of ${2 * a}x with respect to x from ${lo} to ${hi}.`,
      canonical: String(val), verifyMethod: 'numeric' };
  },
  Limits() {
    const a = rint(2, 5), b = rint(1, 6), c = rint(1, 6), x0 = rint(1, 4);
    // lim x->x0 of (a x^2 + b x + c) [continuous polynomial]
    const val = a * x0 * x0 + b * x0 + c;
    return { difficulty: 'Advanced', question: `Find the limit as x → ${x0} of (${a}x² + ${b}x + ${c}).`,
      canonical: String(val), verifyMethod: 'numeric' };
  },
  Optimization() {
    const a = rint(1, 4), h = rint(-4, 4), k = rint(-8, 8);
    // f(x)=a(x-h)^2 + k  → expand; minimum value = k at x=h
    const b = -2 * a * h, c = a * h * h + k;
    if (Math.random() < 0.5) {
      return { difficulty: 'Advanced', question: `The function f(x) = ${a}x² ${b >= 0 ? '+ ' + b : '− ' + -b}x ${c >= 0 ? '+ ' + c : '− ' + -c} has a minimum. Find the value of x at which the minimum occurs.`,
        canonical: `x = ${h}`, verifyMethod: 'numeric' };
    }
    return { difficulty: 'Advanced', question: `The function f(x) = ${a}x² ${b >= 0 ? '+ ' + b : '− ' + -b}x ${c >= 0 ? '+ ' + c : '− ' + -c} has a minimum. Find the minimum value of f(x).`,
      canonical: String(k), verifyMethod: 'numeric' };
  },
  'Word problems'() {
    const type = pick(['speed', 'work', 'age', 'mix']);
    if (type === 'speed') { const d = rint(60, 400), t = rint(2, 8); return { difficulty: 'Intermediate', question: `A car travels ${d} km in ${t} hours at a constant speed. What is its speed in km/h?`, canonical: String(round(d / t, 4)), verifyMethod: 'numeric' }; }
    if (type === 'work') { const r1 = rint(3, 8), r2 = rint(3, 8); const together = round((r1 * r2) / (r1 + r2), 4); return { difficulty: 'Advanced', question: `One pipe fills a tank in ${r1} hours and another in ${r2} hours. Working together, how many hours do they take to fill the tank? Give your answer to 2 decimal places.`, canonical: String(round(together, 2)), verifyMethod: 'numeric' }; }
    if (type === 'age') { const diff = rint(4, 20), sum = diff + rint(10, 40) * 2; const older = (sum + diff) / 2; return { difficulty: 'Intermediate', question: `Two people's ages sum to ${sum} and differ by ${diff}. How old is the older person?`, canonical: String(older), verifyMethod: 'numeric' }; }
    const price = rint(200, 900), disc = pick([10, 15, 20, 25]); return { difficulty: 'Intermediate', question: `An item costs ${price} and is offered at a ${disc}% discount. What is the final price?`, canonical: String(round(price * (1 - disc / 100), 2)), verifyMethod: 'numeric' };
  },
};

function generate(category) {
  const cat = GEN[category] ? category : pick(CATEGORIES.filter((c) => GEN[c]));
  const base = GEN[cat]();
  return {
    category: cat,
    difficulty: base.difficulty || 'Intermediate',
    question: base.question,
    instructions: 'Solve the problem and enter your final answer. Show just the answer (e.g. "x = 5" or a number).',
    canonical: base.canonical,
    verifyMethod: base.verifyMethod || 'numeric',
  };
}

// ---- Comparison engine -----------------------------------------------------
// Extract numeric values from an answer string, evaluating simple fractions ("3/4").
function extractNumbers(str) {
  const s = String(str == null ? '' : str).replace(/[×x*]\s*10\s*\^?\s*(-?\d+)/gi, 'e$1'); // 1.2 x 10^3 -> 1.2e3
  const out = [];
  const re = /-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?(?:e-?\d+)?/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tok = m[0];
    if (tok.includes('/')) { const [a, b] = tok.split('/').map(Number); if (b) out.push(a / b); }
    else out.push(Number(tok));
  }
  return out.filter((n) => Number.isFinite(n));
}
const TOL = 1e-3;
const near = (a, b) => Math.abs(a - b) <= TOL || (Math.abs(b) > 1 && Math.abs(a - b) / Math.abs(b) <= 1e-3);

// Compare a submission against the canonical answer. Returns 'CORRECT' | 'INCORRECT'.
function grade(canonical, submitted, method) {
  const cN = extractNumbers(canonical), sN = extractNumbers(submitted);
  if (!cN.length) { // fall back to string match when canonical isn't numeric
    return normStr(canonical) === normStr(submitted) ? 'CORRECT' : 'INCORRECT';
  }
  if ((method === 'set' && cN.length > 1) || cN.length > 1) {
    if (sN.length < cN.length) return 'INCORRECT';
    const used = new Array(sN.length).fill(false);
    const ok = cN.every((c) => { const i = sN.findIndex((v, idx) => !used[idx] && near(v, c)); if (i >= 0) { used[i] = true; return true; } return false; });
    return ok ? 'CORRECT' : 'INCORRECT';
  }
  return sN.some((v) => near(v, cN[0])) ? 'CORRECT' : 'INCORRECT';
}
function normStr(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').replace(/[=]+/g, '='); }

// Compare an AI answer with the canonical answer → MATCH | EQUIVALENT | DIFFERENT | NEEDS_REVIEW.
function aiStatus(canonical, aiAnswer, method) {
  if (aiAnswer == null || String(aiAnswer).trim() === '') return 'NEEDS_REVIEW';
  const cN = extractNumbers(canonical), aN = extractNumbers(aiAnswer);
  if (!cN.length || !aN.length) {
    if (!cN.length && normStr(canonical) === normStr(aiAnswer)) return 'MATCH';
    return 'NEEDS_REVIEW';
  }
  const graded = grade(canonical, aiAnswer, method);
  if (graded === 'CORRECT') return normStr(canonical) === normStr(aiAnswer) ? 'MATCH' : 'EQUIVALENT';
  return 'DIFFERENT';
}

module.exports = { CATEGORIES, generate, grade, aiStatus, extractNumbers };
