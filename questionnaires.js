/**
 * Professional earning questionnaires. Each is multiple-choice with a scored answer
 * key (moderate difficulty, some scenario-based). Access is gated by subscription tier:
 *   basic    -> Basic plan and up
 *   premium  -> Premium plan and up
 *   pro      -> Pro (premiumpro) plan only
 * Free users may complete ONE basic questionnaire as their single free earning activity.
 *
 * Flow: user answers -> auto-scored -> submitted -> admin approves -> reward paid + the
 * questionnaire rotates out (never shown to that user again).
 *
 * Reward bands (per plan decision): basic $0.30–$0.60, premium $0.60–$1.50, pro $1.50–$3.00.
 */

const TIER_RANK = { basic: 1, premium: 2, pro: 3 };
const PLAN_TO_QUIZ_RANK = { free: 0, basic: 1, premium: 2, premiumpro: 3 };
const CATEGORY_ICON = {
  Business: '💼', Technology: '💻', Marketing: '📣', Finance: '💰', AI: '🤖',
  Entrepreneurship: '🚀', 'Customer Service': '🎧', 'Digital Skills': '🖥️',
  'Data Analysis': '📊', Productivity: '⏱️',
};

const q = (text, options, answer) => ({ q: text, options, answer }); // answer = 0-based index

const QUESTIONNAIRES = [
  // ---------------------------------------------------------------- Basic tier
  {
    id: 'QZ_BUS_B', title: 'Business Fundamentals', category: 'Business', tier: 'basic', reward: 0.50,
    questions: [
      q('What does "revenue" mean?', ['Total income from sales before costs', 'Profit after all expenses', 'Money owed to suppliers', 'Cash in the bank'], 0),
      q('A business spends more than it earns each month. This is called operating at a…', ['Surplus', 'Loss', 'Margin', 'Dividend'], 1),
      q('Which is a fixed cost for a small shop?', ['Monthly rent', 'Cost of stock sold', 'Sales commission', 'Delivery fees per order'], 0),
      q('A customer complains about a late order. The best first response is to…', ['Ignore it', 'Apologise and offer a clear solution', 'Blame the courier', 'Ask them to email again'], 1),
      q('"Gross profit" is…', ['Revenue minus cost of goods sold', 'Revenue minus all expenses', 'Total revenue', 'Money left after tax'], 0),
      q('A supplier offers 10% off if you pay within 7 days. This is a…', ['Markup', 'Early-payment discount', 'Refund', 'Tax'], 1),
      q('Which best describes a target market?', ['Everyone', 'The specific group most likely to buy', 'Your competitors', 'Your suppliers'], 1),
      q('Cash flow refers to…', ['The money moving in and out of a business', 'Only profit', 'The value of stock', 'The owner’s salary'], 0),
      q('You have limited money to grow. The wisest first step is to…', ['Spend on what brings the best return', 'Buy the most expensive equipment', 'Hire many staff at once', 'Rent a bigger office'], 0),
      q('A "unique selling point" is…', ['What makes your offer stand out', 'Your cheapest product', 'Your address', 'Your logo'], 0),
    ],
  },
  {
    id: 'QZ_DIG_B', title: 'Digital Skills Essentials', category: 'Digital Skills', tier: 'basic', reward: 0.45,
    questions: [
      q('A strong password usually…', ['Is your name', 'Mixes letters, numbers and symbols', 'Is "123456"', 'Is your birth year'], 1),
      q('You get an email asking for your password urgently. You should…', ['Reply with it', 'Ignore/verify — likely phishing', 'Click every link', 'Forward to friends'], 1),
      q('Which file is an image?', ['report.docx', 'photo.png', 'data.csv', 'notes.txt'], 1),
      q('"The cloud" mostly means…', ['Storing files on remote servers you access online', 'Weather data', 'Your phone battery', 'A type of virus'], 0),
      q('To find the exact phrase online, you can search using…', ['ALL CAPS', 'Quotation marks around the phrase', 'More words', 'Emojis'], 1),
      q('Two-factor authentication adds security by…', ['Requiring a second verification step', 'Using a longer password only', 'Sharing your login', 'Disabling the account'], 0),
      q('A spreadsheet is best for…', ['Editing videos', 'Organising and calculating data in rows/columns', 'Sending mail', 'Drawing logos'], 1),
      q('Which keeps your work safe if a device is lost?', ['Regular backups', 'Never turning it off', 'Deleting files', 'Sharing passwords'], 0),
      q('A URL that starts with https:// means…', ['The connection is encrypted', 'The site is free', 'The site is fast', 'Nothing at all'], 0),
      q('Best way to avoid malware from downloads?', ['Download from trusted, official sources', 'Open every attachment', 'Disable antivirus', 'Use one password everywhere'], 0),
    ],
  },
  {
    id: 'QZ_CS_B', title: 'Customer Service Basics', category: 'Customer Service', tier: 'basic', reward: 0.55,
    questions: [
      q('An angry customer calls. Your first goal is to…', ['Win the argument', 'Listen and understand the problem', 'Transfer them away', 'End the call'], 1),
      q('"Active listening" means…', ['Waiting to talk', 'Fully focusing and confirming understanding', 'Multitasking', 'Interrupting politely'], 1),
      q('A customer wants a refund your policy doesn’t allow. Best response?', ['Say "no" and hang up', 'Explain options empathetically and escalate if needed', 'Ignore them', 'Argue policy line-by-line'], 1),
      q('Response time matters because…', ['Fast, clear help builds trust', 'It looks busy', 'It avoids work', 'It’s a rule only'], 0),
      q('The best tone in a complaint reply is…', ['Defensive', 'Calm, empathetic and solution-focused', 'Sarcastic', 'Robotic'], 1),
      q('A customer repeats their issue after a fix failed. You should…', ['Blame them', 'Apologise, take ownership and resolve it', 'Close the ticket', 'Send a survey only'], 1),
      q('"Under-promise, over-deliver" means…', ['Promise a lot, do little', 'Set realistic expectations, then exceed them', 'Never promise', 'Delay everything'], 1),
      q('First-contact resolution is…', ['Solving the issue on the first interaction', 'Answering fast then transferring', 'Sending many emails', 'Closing without a fix'], 0),
      q('A confused customer needs steps. You should…', ['Use jargon', 'Give clear, simple, numbered steps', 'Send a long paragraph', 'Say "figure it out"'], 1),
      q('After resolving an issue, a good habit is to…', ['Confirm they’re satisfied and thank them', 'Hang up immediately', 'Upsell aggressively', 'Mark unresolved'], 0),
    ],
  },
  {
    id: 'QZ_PROD_B', title: 'Personal Productivity', category: 'Productivity', tier: 'basic', reward: 0.40,
    questions: [
      q('The Pareto (80/20) principle suggests…', ['80% of results come from 20% of efforts', 'Do everything equally', 'Work 80 hours', 'Ignore priorities'], 0),
      q('"Time-blocking" means…', ['Blocking websites', 'Scheduling focused time for specific tasks', 'Working without breaks', 'Avoiding calendars'], 1),
      q('A task is urgent but not important. You should ideally…', ['Do it first always', 'Delegate or minimise it', 'Ignore all tasks', 'Spend the day on it'], 1),
      q('Multitasking usually…', ['Boosts quality', 'Reduces focus and increases errors', 'Saves the most time', 'Has no effect'], 1),
      q('A good daily habit is to…', ['Plan your top 3 priorities', 'Check email all day', 'Skip planning', 'Say yes to everything'], 0),
      q('The "two-minute rule" says…', ['If it takes < 2 min, do it now', 'Never start small tasks', 'Take 2-min breaks only', 'Meetings must be 2 min'], 0),
      q('Batching similar tasks helps because…', ['It reduces context switching', 'It looks busy', 'It delays work', 'It needs more tools'], 0),
      q('To avoid burnout you should…', ['Skip all rest', 'Take regular breaks and set boundaries', 'Work every weekend', 'Never say no'], 1),
      q('A realistic to-do list is…', ['50 items daily', 'A short, prioritised set you can finish', 'Empty', 'Only long-term goals'], 1),
      q('"Deep work" refers to…', ['Distraction-free focused effort on hard tasks', 'Shallow email replies', 'Scrolling social media', 'Random tasks'], 0),
    ],
  },

  // -------------------------------------------------------------- Premium tier
  {
    id: 'QZ_MKT_P', title: 'Digital Marketing Strategy', category: 'Marketing', tier: 'premium', reward: 1.10,
    questions: [
      q('A high click-through rate but low conversions suggests a problem with…', ['The ad reaching people', 'The landing page or offer', 'The impressions', 'The currency'], 1),
      q('"CTA" stands for…', ['Cost To Advertise', 'Call To Action', 'Customer Target Age', 'Click Total Average'], 1),
      q('SEO mainly improves…', ['Paid ad cost', 'Organic (unpaid) search visibility', 'Email open rates', 'Server speed only'], 1),
      q('A/B testing is used to…', ['Compare two versions to see which performs better', 'Double the budget', 'Avoid analytics', 'Copy competitors'], 0),
      q('Your ad spend is $100 and it returns $400 in sales. ROAS is…', ['0.25', '4', '100', '400'], 1),
      q('The "top of funnel" audience is best served content that…', ['Hard-sells immediately', 'Builds awareness and educates', 'Only shows pricing', 'Asks for payment'], 1),
      q('Retargeting shows ads to…', ['Brand-new strangers', 'People who already engaged with you', 'Only competitors', 'Random users'], 1),
      q('A brand’s "tone of voice" should be…', ['Different in every post', 'Consistent across channels', 'Only formal', 'Only emojis'], 1),
      q('Email marketing success is best measured by…', ['Number of fonts used', 'Open, click and conversion rates', 'Email length', 'Send time only'], 1),
      q('Which metric best shows loyalty over time?', ['One-time clicks', 'Repeat purchase / retention rate', 'Impressions', 'Ad reach'], 1),
    ],
  },
  {
    id: 'QZ_TECH_P', title: 'Technology & Web Basics', category: 'Technology', tier: 'premium', reward: 1.25,
    questions: [
      q('An API is best described as…', ['A physical server', 'A way for software to talk to other software', 'A password', 'A web browser'], 1),
      q('HTTP status 404 means…', ['Success', 'Not Found', 'Server error', 'Redirect'], 1),
      q('"Frontend" refers to…', ['The database', 'What users see and interact with', 'The payment gateway', 'The server logs'], 1),
      q('A database is used to…', ['Style web pages', 'Store and retrieve structured data', 'Send emails only', 'Host videos only'], 1),
      q('HTTPS protects data by…', ['Encrypting it in transit', 'Making pages load faster only', 'Blocking all ads', 'Compressing images'], 0),
      q('Which is a programming language?', ['HTML', 'JavaScript', 'HTTP', 'JSON'], 1),
      q('"Responsive design" means a site…', ['Loads only on desktop', 'Adapts layout to any screen size', 'Uses no images', 'Is always dark mode'], 1),
      q('A "bug" in software is…', ['A feature', 'An error causing wrong behaviour', 'A user', 'A server'], 1),
      q('Caching improves performance by…', ['Storing results to serve repeat requests faster', 'Deleting data', 'Slowing responses', 'Encrypting passwords'], 0),
      q('JSON is commonly used to…', ['Style pages', 'Exchange structured data between systems', 'Compress video', 'Host websites'], 1),
    ],
  },
  {
    id: 'QZ_FIN_P', title: 'Personal & Business Finance', category: 'Finance', tier: 'premium', reward: 1.00,
    questions: [
      q('"Compound interest" means interest is earned on…', ['Only the original amount', 'The principal plus accumulated interest', 'Nothing', 'Fees only'], 1),
      q('An emergency fund should typically cover…', ['One day of costs', '3–6 months of expenses', '10 years', 'Nothing'], 1),
      q('Diversification reduces risk by…', ['Putting all money in one asset', 'Spreading investments across assets', 'Avoiding saving', 'Borrowing more'], 1),
      q('A budget is…', ['A plan for income and spending', 'A type of loan', 'A tax form', 'A bank'], 0),
      q('If revenue is $1,000 and expenses are $700, net profit is…', ['$1,700', '$300', '$700', '$1,000'], 1),
      q('High-interest debt (e.g., some loans) should generally be…', ['Ignored', 'Paid down as a priority', 'Increased', 'Refinanced upward'], 1),
      q('"Liquidity" refers to…', ['How quickly an asset becomes cash', 'How risky an asset is', 'The interest rate', 'The tax rate'], 0),
      q('Inflation means…', ['Prices generally rising over time', 'Money gaining value', 'Fixed prices', 'Falling wages only'], 0),
      q('A profit margin of 20% on $50 revenue is…', ['$5', '$10', '$20', '$40'], 1),
      q('Paying yourself first means…', ['Spending then saving', 'Saving/investing before discretionary spending', 'Never saving', 'Only paying bills'], 1),
    ],
  },
  {
    id: 'QZ_ENT_P', title: 'Entrepreneurship & Startups', category: 'Entrepreneurship', tier: 'premium', reward: 1.20,
    questions: [
      q('An MVP (Minimum Viable Product) is…', ['A final polished product', 'The simplest version that tests the core idea', 'A marketing plan', 'A legal document'], 1),
      q('"Product-market fit" means…', ['You have an office', 'Your product satisfies real market demand', 'You raised money', 'You have a logo'], 1),
      q('Validating an idea early is best done by…', ['Building everything first', 'Talking to potential customers', 'Ignoring feedback', 'Guessing'], 1),
      q('"Runway" refers to…', ['How long cash lasts at current spend', 'The office hallway', 'Total revenue', 'Number of staff'], 0),
      q('A pivot is…', ['Giving up', 'Changing strategy based on learning', 'Hiring more', 'A funding round'], 1),
      q('Which is usually the riskiest assumption to test first?', ['The logo colour', 'Whether anyone will pay for it', 'The office location', 'The font'], 1),
      q('Bootstrapping means…', ['Funding growth from revenue/own funds', 'Taking huge loans', 'Only using investors', 'Not selling anything'], 0),
      q('Customer churn is…', ['New customers gained', 'The rate customers stop using you', 'Total revenue', 'Ad spend'], 1),
      q('A scalable business can…', ['Grow revenue without proportional cost increases', 'Never grow', 'Only serve one client', 'Avoid customers'], 0),
      q('Early feedback that stings is…', ['Useless', 'Often valuable for improving the product', 'A reason to quit', 'Always wrong'], 1),
    ],
  },
  {
    id: 'QZ_DATA_P', title: 'Data Analysis Foundations', category: 'Data Analysis', tier: 'premium', reward: 1.40,
    questions: [
      q('The "mean" of 2, 4, 9 is…', ['4', '5', '9', '15'], 1),
      q('The "median" of 3, 7, 9, 12, 20 is…', ['7', '9', '12', '10'], 1),
      q('A percentage change from 50 to 60 is…', ['10%', '20%', '60%', '120%'], 1),
      q('A bar chart is best for…', ['Comparing categories', 'Showing a single number', 'Encrypting data', 'Writing text'], 0),
      q('An "outlier" is…', ['A typical value', 'A value far from the others', 'The average', 'A missing value'], 1),
      q('Correlation means…', ['One thing causes another', 'Two variables move together (not always causal)', 'Data is wrong', 'Nothing'], 1),
      q('If 30 of 150 users convert, the conversion rate is…', ['5%', '20%', '30%', '45%'], 1),
      q('"Clean data" means…', ['Data with errors removed and consistent format', 'Deleted data', 'Encrypted data', 'Random data'], 0),
      q('A line chart is best for…', ['Trends over time', 'Comparing unrelated items', 'Passwords', 'Static totals'], 0),
      q('Sample size matters because…', ['Bigger, representative samples give more reliable insights', 'Small samples are always best', 'It has no effect', 'It only affects colour'], 0),
    ],
  },

  // ------------------------------------------------------------------ Pro tier
  {
    id: 'QZ_AI_PRO', title: 'Applied Artificial Intelligence', category: 'AI', tier: 'pro', reward: 3.00,
    questions: [
      q('A "large language model" primarily…', ['Stores images', 'Predicts and generates text from patterns', 'Sends emails', 'Runs databases'], 1),
      q('"Training data" is…', ['The data a model learns patterns from', 'The final answer', 'A password', 'A server'], 0),
      q('An AI "hallucination" is when a model…', ['Runs fast', 'Produces confident but incorrect information', 'Refuses to answer', 'Uses less memory'], 1),
      q('A good prompt for reliable output is…', ['Vague and short', 'Clear, specific, with context and constraints', 'All caps', 'Empty'], 1),
      q('"Bias" in AI often comes from…', ['Biased or unrepresentative training data', 'Fast servers', 'Good prompts', 'Encryption'], 0),
      q('Which task suits classification?', ['Sorting emails into spam/not-spam', 'Rendering a video', 'Hosting a site', 'Encrypting files'], 0),
      q('Keeping a human "in the loop" means…', ['People review AI outputs before acting', 'AI works alone', 'No oversight', 'Disabling AI'], 0),
      q('"Fine-tuning" a model means…', ['Adjusting it on task-specific data', 'Deleting it', 'Renaming it', 'Turning it off'], 0),
      q('Sensitive data in prompts should be…', ['Shared freely', 'Handled carefully / minimised', 'Posted publicly', 'Ignored'], 1),
      q('AI outputs should be treated as…', ['Always perfectly correct', 'Helpful drafts that need verification', 'Legal advice', 'Never useful'], 1),
    ],
  },
  {
    id: 'QZ_BUS_PRO', title: 'Advanced Business Strategy', category: 'Business', tier: 'pro', reward: 2.50,
    questions: [
      q('A SWOT analysis covers…', ['Strengths, Weaknesses, Opportunities, Threats', 'Sales only', 'Staff only', 'Software only'], 0),
      q('A "competitive moat" is…', ['A durable advantage rivals struggle to copy', 'A marketing budget', 'A logo', 'A discount'], 0),
      q('Customer Lifetime Value (CLV) measures…', ['One purchase', 'Total value a customer brings over time', 'Ad cost', 'Tax owed'], 1),
      q('If CLV is $120 and it costs $30 to acquire a customer (CAC), the ratio is…', ['1:1', '4:1', '30:1', '120:1'], 1),
      q('A "blue ocean" strategy seeks…', ['Fierce competition in crowded markets', 'New, uncontested market space', 'Lower quality', 'No customers'], 1),
      q('Economies of scale mean…', ['Cost per unit falls as volume rises', 'Costs rise with volume', 'No change', 'Fewer sales'], 0),
      q('A key risk of rapid scaling is…', ['Nothing', 'Outgrowing cash flow and quality control', 'Too much profit', 'Slower growth'], 1),
      q('Differentiation strategy competes on…', ['Being the cheapest only', 'Unique value customers will pay more for', 'Copying rivals', 'Hiding pricing'], 1),
      q('A leading indicator (vs lagging) is…', ['Last quarter’s profit', 'Signups this week predicting future revenue', 'Annual tax', 'Historical sales only'], 1),
      q('When entering a new market, first you should…', ['Assume it works', 'Research demand, competition and fit', 'Spend the whole budget', 'Copy your home market exactly'], 1),
    ],
  },
  {
    id: 'QZ_DATA_PRO', title: 'Advanced Data & Metrics', category: 'Data Analysis', tier: 'pro', reward: 2.80,
    questions: [
      q('A/B test result: variant B beats A but the sample is tiny. You should…', ['Ship B immediately', 'Gather more data for significance', 'Delete the test', 'Ignore results'], 1),
      q('"Statistical significance" helps you judge…', ['Whether a result is likely real vs chance', 'The colour of a chart', 'The file size', 'The font'], 0),
      q('A funnel with a big drop at checkout suggests…', ['A problem at the checkout step', 'A traffic problem', 'A logo problem', 'Nothing'], 0),
      q('Cohort analysis groups users by…', ['Random IDs', 'A shared characteristic/time (e.g., signup month)', 'Colour', 'Password'], 1),
      q('If a metric doubles from 4% to 8%, that is…', ['A 4 percentage-point increase', 'A 50% increase', 'A halving', 'No change'], 0),
      q('"Vanity metrics" are…', ['Numbers that look good but don’t drive decisions', 'The most useful metrics', 'Revenue', 'Retention'], 0),
      q('Median is preferred over mean when data…', ['Has extreme outliers', 'Is perfectly even', 'Is text', 'Is empty'], 0),
      q('A dashboard should primarily…', ['Show every possible number', 'Highlight the few metrics that drive action', 'Hide data', 'Use no charts'], 1),
      q('Segmenting results (e.g., by region) helps because…', ['Averages can hide important differences', 'It slows analysis', 'It’s decorative', 'It never helps'], 0),
      q('Correlation ≠ causation means…', ['Related data doesn’t prove one causes the other', 'All correlations are causal', 'Data is useless', 'Charts lie'], 0),
    ],
  },
];

// ---- Helpers ---------------------------------------------------------------
const ALL_BY_ID = {};
QUESTIONNAIRES.forEach((z) => { ALL_BY_ID[z.id] = z; });

function byId(id) { return ALL_BY_ID[id] || null; }

// A questionnaire the client can SEE (question text + options), without the answer key.
function publicView(z) {
  return {
    id: z.id, title: z.title, category: z.category, icon: CATEGORY_ICON[z.category] || '📝',
    tier: z.tier, reward: z.reward, count: z.questions.length,
    questions: z.questions.map((qq) => ({ q: qq.q, options: qq.options.slice() })),
  };
}

// Auto-score: answers is { "0": choiceIndex, "1": choiceIndex, ... }. Pass = >= 60% correct.
function score(z, answers) {
  const a = answers || {};
  let correct = 0;
  z.questions.forEach((qq, i) => { if (Number(a[i]) === qq.answer) correct += 1; });
  const total = z.questions.length;
  const pct = total ? correct / total : 0;
  return { correct, total, pct: Math.round(pct * 100), passed: pct >= 0.6 };
}

// Whether a plan (id) can access a questionnaire tier. Free (rank 0) may access basic
// (that's their single free activity — the ONE-activity limit is enforced separately).
function tierUnlocked(planId, quizTier) {
  const planRank = PLAN_TO_QUIZ_RANK[planId || 'free'] != null ? PLAN_TO_QUIZ_RANK[planId || 'free'] : 0;
  const need = TIER_RANK[quizTier] || 99;
  if (planRank === 0) return quizTier === 'basic'; // free users: basic only
  return planRank >= need;
}

const TIER_NAME = { basic: 'Basic', premium: 'Premium', pro: 'Pro' };

module.exports = {
  QUESTIONNAIRES, byId, publicView, score, tierUnlocked,
  CATEGORY_ICON, TIER_NAME, TIER_RANK,
  categories: Object.keys(CATEGORY_ICON),
};
