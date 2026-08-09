/**
 * Gweno microtask marketplace catalog — a diverse set of realistic freelance-style
 * tasks across 12 professional categories (Writing, Transcription, Research, Data
 * Entry, Design, Marketing, Translation, Education, Administrative Support, Audio,
 * Testing, Surveys). Each task is self-contained (the brief/content lives in the
 * instructions) and declares a `proofType` the system validates before review.
 *
 * proofType:
 *   text   — substantive free text; `minWords` / `minChars`
 *   data   — several rows in a delimited format; `minLines`
 *   url    — a valid http(s) link (e.g. to your uploaded design/screenshot)
 *   photo  — a link to an uploaded image
 *   email  — a valid email address
 *   social — a profile/post link or @username
 *   code   — an exact confirmation code; `code`
 *   match  — must closely reproduce `expected`; `minSimilarity`
 */

// Category metadata (icon shown on task cards + filters).
const CAT_META = {
  'Writing':                { icon: '✍️' },
  'Transcription':          { icon: '🎧' },
  'Research':               { icon: '🔎' },
  'Data Entry':             { icon: '⌨️' },
  'Design':                 { icon: '🎨' },
  'Marketing':              { icon: '📣' },
  'Translation':            { icon: '🌐' },
  'Education':              { icon: '🎓' },
  'Administrative Support': { icon: '🗂️' },
  'Audio Tasks':            { icon: '🔊' },
  'Testing':                { icon: '🧪' },
  'Surveys':                { icon: '📊' },
};

// Compact task builder. extra = { minWords, minChars, minLines, expected, code, minSimilarity }.
function T(title, category, reward, difficulty, proofType, skills, description, instructions, extra) {
  return Object.assign({ title, category, reward, difficulty, proofType, skills, description, instructions }, extra || {});
}

const RAW = [
  // ---------------- Writing ----------------
  T('Write a customer support reply', 'Writing', 0.9, 'Easy', 'text', ['Writing', 'English'],
    'Reply politely to a customer complaint.',
    ['A customer writes: "My order arrived 3 days late and the box was damaged."',
     'Write a polite, helpful support reply (2–4 sentences) apologising and offering a solution.',
     'Paste your reply below.'], { minWords: 20 }),
  T('Write 3 social media captions', 'Writing', 1.2, 'Medium', 'text', ['Writing', 'Social media'],
    'Create 3 short captions for a small business.',
    ['Business: a neighbourhood coffee shop launching a new cold brew.',
     'Write 3 short, engaging captions (with a relevant hashtag each).',
     'Paste all 3 captions below, numbered 1–3.'], { minWords: 20 }),
  T('Write a short product description', 'Writing', 1.6, 'Medium', 'text', ['Writing', 'Marketing'],
    'Write a persuasive product description.',
    ['Product: a 750ml stainless-steel insulated water bottle (keeps drinks cold 24h).',
     'Write a clear, persuasive description of 60–90 words highlighting the benefits.',
     'Paste your description below.'], { minWords: 55 }),
  T('Write a 250-word blog introduction', 'Writing', 3.0, 'Hard', 'text', ['Writing', 'Content'],
    'Write an engaging blog intro from a topic.',
    ['Topic: "5 simple ways to save money on your monthly shopping".',
     'Write a 200–260 word introduction that hooks the reader and previews the article.',
     'Paste your introduction below.'], { minWords: 190 }),

  // ---------------- Transcription ----------------
  T('Clean up a rough voice-note transcript', 'Transcription', 1.0, 'Easy', 'text', ['Typing', 'Attention'],
    'Rewrite a messy auto-transcript cleanly.',
    ['Rough transcript: "so umm yeah i think we should uh meet on tuesday maybe around ten if thats okay".',
     'Rewrite it as clean, correctly punctuated text (remove filler words like "um").',
     'Paste the cleaned version below.'], { minWords: 10 }),
  T('Add timestamps to a short transcript', 'Transcription', 1.5, 'Medium', 'data', ['Typing', 'Accuracy'],
    'Break a transcript into timed lines.',
    ['Transcript: "Welcome to the show. Today we talk about savings. Let\'s begin."',
     'Write 3 lines in the format  mm:ss - text  (estimate reasonable times).',
     'Enter one line per row, e.g.  00:00 - Welcome to the show.'], { minLines: 3 }),
  T('Transcribe a 1-minute recording', 'Transcription', 2.0, 'Medium', 'text', ['Typing', 'Listening'],
    'Type out a one-minute recording you are given.',
    ['Open the 1-minute recording from your task pack and listen fully.',
     'Type everything said, word for word, with correct punctuation.',
     'Paste your full transcript below (aim for accuracy).'], { minWords: 30 }),
  T('Transcribe a 3-minute interview', 'Transcription', 3.0, 'Hard', 'text', ['Typing', 'Listening'],
    'Transcribe an interview with speaker labels.',
    ['Listen to the 3-minute interview recording in your task pack.',
     'Transcribe it with speaker labels (e.g. "Q:" and "A:").',
     'Paste the full transcript below.'], { minWords: 60 }),

  // ---------------- Research ----------------
  T('Find a company\'s official website & email', 'Research', 0.8, 'Easy', 'data', ['Research', 'Web search'],
    'Locate official contact details for a company.',
    ['Company: a well-known local supermarket chain of your choice.',
     'Find its official website and a public contact email.',
     'Enter 2 rows:  Website: https://…   and   Email: name@company.com'], { minLines: 2 }),
  T('Compare prices across 3 stores', 'Research', 1.5, 'Medium', 'data', ['Research', 'Comparison'],
    'Find the cheapest option for a product.',
    ['Product: a 65-inch smart TV (any popular model).',
     'Check 3 online stores and note each store name and its price.',
     'Enter 3 rows:  Store name: price'], { minLines: 3 }),
  T('Collect 5 business contacts in a niche', 'Research', 2.0, 'Medium', 'data', ['Research', 'Lead gen'],
    'Build a small list of businesses in a niche.',
    ['Niche: gyms/fitness centres in a city of your choice.',
     'Find 5 businesses with a name and a website or phone.',
     'Enter 5 rows:  Business name, website or phone'], { minLines: 5 }),
  T('Verify 5 online facts', 'Research', 2.5, 'Medium', 'data', ['Research', 'Verification'],
    'Confirm whether simple statements are true.',
    ['Statements: (1) Nairobi is the capital of Kenya (2) Water boils at 100°C at sea level (3) The Nile is in South America (4) A triangle has 3 sides (5) There are 7 continents.',
     'For each, write the number and "true" or "false".',
     'Enter 5 rows, e.g.  1: true'], { minLines: 5 }),

  // ---------------- Data Entry ----------------
  T('Enter 5 rows of contact data', 'Data Entry', 0.7, 'Easy', 'data', ['Data entry', 'Accuracy'],
    'Type 5 clean contact rows from a sample.',
    ['Create 5 sample contacts (you may invent realistic ones).',
     'Each row must have a name, phone and email.',
     'Enter 5 rows:  Name, +2547XXXXXXXX, name@example.com'], { minLines: 5 }),
  T('Copy fields from a sample invoice', 'Data Entry', 1.2, 'Easy', 'data', ['Data entry', 'Attention'],
    'Extract key fields from an invoice.',
    ['Invoice: No. INV-2045, Date 2026-08-01, Customer Jane Doe, Total KES 4,500.',
     'Enter each field as a row  Field: value.',
     'Include at least: Invoice No, Date, Customer, Total.'], { minLines: 4 }),
  T('Categorise 10 products into groups', 'Data Entry', 1.8, 'Medium', 'data', ['Data entry', 'Sorting'],
    'Assign products to the right category.',
    ['Products: milk, t-shirt, hammer, apple, jeans, screwdriver, bread, jacket, banana, drill.',
     'For each, write  product: category (Groceries / Clothing / Tools).',
     'Enter 10 rows.'], { minLines: 10 }),
  T('Organise 15 records into a clean list', 'Data Entry', 2.5, 'Medium', 'data', ['Data entry', 'Organisation'],
    'Standardise a set of messy records.',
    ['Create/clean 15 rows of member records (name and city).',
     'Use a consistent format on every row.',
     'Enter 15 rows:  Name, City'], { minLines: 15 }),

  // ---------------- Design ----------------
  T('Suggest a colour palette for a brand', 'Design', 0.9, 'Easy', 'text', ['Design', 'Colour'],
    'Propose brand colours with hex codes.',
    ['Brand: an eco-friendly cleaning products company.',
     'Suggest 3–4 colours with hex codes and a one-line reason for the mood.',
     'Paste your palette and reasoning below.'], { minWords: 15 }),
  T('Write a logo concept brief', 'Design', 1.5, 'Medium', 'text', ['Design', 'Branding'],
    'Describe a logo idea in words.',
    ['Brand: "GreenLeaf", an organic grocery delivery service.',
     'Describe a logo concept: symbol, colours, font style and the feeling it conveys.',
     'Paste your concept (40+ words) below.'], { minWords: 35 }),
  T('Create a simple social media post', 'Design', 2.0, 'Medium', 'url', ['Design', 'Canva'],
    'Design a post and share the link.',
    ['Create a simple square social post (e.g. in Canva) announcing a 20% weekend sale.',
     'Export it and upload to an image host or Drive (make it public).',
     'Paste the direct link to your design below.']),
  T('Design a banner concept', 'Design', 2.9, 'Hard', 'url', ['Design', 'Layout'],
    'Design a web banner and share the link.',
    ['Design a 1200×300 web banner for a fitness app free-trial promotion.',
     'Upload it to an image host or Drive (public link).',
     'Paste the direct link below.']),

  // ---------------- Marketing ----------------
  T('Write 2 promotional captions', 'Marketing', 0.9, 'Easy', 'text', ['Marketing', 'Copy'],
    'Write catchy promo captions.',
    ['Promotion: buy-one-get-one-free on pizzas this Friday.',
     'Write 2 short, punchy promotional captions with a call to action.',
     'Paste both captions below.'], { minWords: 15 }),
  T('Review an advertisement', 'Marketing', 1.4, 'Medium', 'text', ['Marketing', 'Analysis'],
    'Give feedback on an ad idea.',
    ['Ad: a billboard that only shows a phone number and the word "CALL".',
     'Explain what works, what is weak, and 2 improvements (40+ words).',
     'Paste your review below.'], { minWords: 40 }),
  T('Suggest 5 marketing ideas for a shop', 'Marketing', 2.0, 'Medium', 'text', ['Marketing', 'Ideas'],
    'Brainstorm low-budget marketing ideas.',
    ['Shop: a small local bakery wanting more weekday customers.',
     'Suggest 5 practical, low-budget marketing ideas.',
     'Paste your 5 ideas (numbered) below.'], { minWords: 30 }),
  T('Analyse a post\'s engagement', 'Marketing', 3.0, 'Hard', 'text', ['Marketing', 'Analytics'],
    'Interpret simple engagement numbers.',
    ['Post stats: 10,000 views, 400 likes, 25 comments, 12 shares.',
     'Calculate the engagement rate and explain what it suggests, plus 2 tips (60+ words).',
     'Paste your analysis below.'], { minWords: 55 }),

  // ---------------- Translation ----------------
  T('Translate a sentence: English → Swahili', 'Translation', 0.8, 'Easy', 'text', ['Bilingual', 'Swahili'],
    'Translate one sentence accurately.',
    ['Sentence: "Thank you for your order, it will be delivered tomorrow."',
     'Translate it into natural Swahili.',
     'Paste your translation below.'], { minWords: 6 }),
  T('Translate a short customer message', 'Translation', 1.0, 'Easy', 'text', ['Bilingual', 'Support'],
    'Translate a message for support.',
    ['Message (Swahili): "Nimelipa lakini sijapokea risiti yangu."',
     'Translate it into clear English.',
     'Paste your translation below.'], { minWords: 6 }),
  T('Translate 5 product titles to Swahili', 'Translation', 1.5, 'Medium', 'data', ['Bilingual', 'E-commerce'],
    'Localise product titles.',
    ['Titles: 1) Wireless earbuds 2) Cotton bedsheet 3) Kitchen knife set 4) Baby stroller 5) Phone charger.',
     'Translate each into Swahili, keeping them short.',
     'Enter 5 rows:  1: <swahili>'], { minLines: 5 }),
  T('Translate a paragraph: Swahili → English', 'Translation', 2.0, 'Medium', 'text', ['Bilingual', 'Writing'],
    'Translate a paragraph fluently.',
    ['Paragraph (Swahili): "Gweno ni jukwaa linalowawezesha watu kupata kazi ndogo mtandaoni na kulipwa. Ni rahisi, salama na la haraka."',
     'Translate it into natural, fluent English.',
     'Paste your translation below.'], { minWords: 20 }),

  // ---------------- Education ----------------
  T('Answer 5 general-knowledge questions', 'Education', 0.6, 'Easy', 'data', ['Knowledge'],
    'Answer 5 quick questions.',
    ['Q1 Capital of Kenya? Q2 2+2? Q3 Largest planet? Q4 Colour of the sky on a clear day? Q5 Days in a week?',
     'Answer each as a row  number: answer.',
     'Enter 5 rows.'], { minLines: 5 }),
  T('Check a simple maths assignment', 'Education', 1.2, 'Easy', 'text', ['Maths', 'Reviewing'],
    'Mark simple sums as right or wrong.',
    ['Answers to check: (a) 12+8=20 (b) 9×3=28 (c) 15-6=9 (d) 20÷4=5.',
     'For each, say if it is correct; if wrong, give the right answer (a–d).',
     'Paste your marking below.'], { minWords: 12 }),
  T('Summarise a short article in 60 words', 'Education', 1.5, 'Medium', 'text', ['Reading', 'Summarising'],
    'Condense a passage into a summary.',
    ['Passage: "Saving money starts with tracking what you spend. Small daily costs add up. Setting a weekly budget and cooking at home are two easy wins that build savings over time."',
     'Write a clear 50–70 word summary.',
     'Paste your summary below.'], { minWords: 45 }),
  T('Categorise 6 learning topics by subject', 'Education', 2.0, 'Medium', 'data', ['Sorting'],
    'Sort topics into subjects.',
    ['Topics: photosynthesis, fractions, World War II, gravity, grammar, the water cycle.',
     'For each write  topic: subject (Science / Maths / History / English).',
     'Enter 6 rows.'], { minLines: 6 }),

  // ---------------- Administrative Support ----------------
  T('Sort a list of files by type', 'Administrative Support', 0.7, 'Easy', 'data', ['Organisation'],
    'Group filenames by their type.',
    ['Files: report.pdf, logo.png, budget.xlsx, notes.docx, photo.jpg, data.csv.',
     'For each write  filename: type (Document / Image / Spreadsheet).',
     'Enter 6 rows.'], { minLines: 6 }),
  T('Rename 8 documents to a naming rule', 'Administrative Support', 1.2, 'Easy', 'data', ['Organisation'],
    'Apply a consistent naming convention.',
    ['Rule: YYYY-MM-DD_Topic. Create 8 example renamed files for meeting notes across different dates.',
     'Enter 8 rows, one renamed filename per row.'], { minLines: 8 }),
  T('Prepare a simple weekly schedule', 'Administrative Support', 1.5, 'Medium', 'text', ['Planning'],
    'Draft a tidy weekly plan.',
    ['Create a simple Mon–Fri schedule for a small shop (opening, restocking, cleaning, admin).',
     'List each day with 1–2 tasks.',
     'Paste your schedule below.'], { minWords: 25 }),
  T('Verify & tidy 10 records', 'Administrative Support', 2.5, 'Medium', 'data', ['Accuracy', 'Cleanup'],
    'Standardise 10 member records.',
    ['Create 10 rows of member records with name and email, using one consistent format.',
     'Make sure each email looks valid.',
     'Enter 10 rows:  Name, email'], { minLines: 10 }),

  // ---------------- Audio Tasks ----------------
  T('Label 5 everyday sounds', 'Audio Tasks', 0.8, 'Easy', 'data', ['Listening'],
    'Name the sounds you are given.',
    ['Sounds in your pack: (1) dog barking (2) rain (3) car horn (4) doorbell (5) typing.',
     'Confirm each with  number: label.',
     'Enter 5 rows.'], { minLines: 5 }),
  T('Describe the audio quality of a clip', 'Audio Tasks', 1.2, 'Easy', 'text', ['Listening', 'QA'],
    'Rate and describe a clip\'s quality.',
    ['Listen to the sample clip in your pack.',
     'Rate the quality (clear / muffled / noisy) and describe any issues in 1–2 sentences.',
     'Paste your assessment below.'], { minWords: 12 }),
  T('Match 4 audio clips to their text', 'Audio Tasks', 1.8, 'Medium', 'data', ['Listening'],
    'Pair each clip with the right line.',
    ['Clips A–D and lines 1–4 are in your pack.',
     'Match each clip to a line.',
     'Enter 4 rows:  A: 3'], { minLines: 4 }),
  T('Detect background noise in recordings', 'Audio Tasks', 2.0, 'Medium', 'text', ['Listening', 'QA'],
    'Flag noise problems in recordings.',
    ['Listen to the 3 short recordings in your pack.',
     'For each, note whether there is background noise and what kind.',
     'Paste your notes (one line per recording) below.'], { minWords: 15 }),

  // ---------------- Testing ----------------
  T('Report a bug you find on a page', 'Testing', 1.0, 'Easy', 'text', ['QA', 'Attention'],
    'Describe a bug clearly.',
    ['Open the test page in your task pack and try the main actions.',
     'Describe one bug: what you did, what happened, and what you expected.',
     'Paste your bug report below.'], { minWords: 20 }),
  T('Verify buttons work on a page', 'Testing', 1.5, 'Easy', 'text', ['QA'],
    'Check each button and report.',
    ['Open the test page and click each visible button.',
     'List each button and whether it worked (or the error).',
     'Paste your checklist below.'], { minWords: 15 }),
  T('Test a signup form & report issues', 'Testing', 2.0, 'Medium', 'text', ['QA', 'Forms'],
    'Test form validation thoroughly.',
    ['Try the signup form with valid and invalid inputs (blank fields, bad email, weak password).',
     'Report which validations worked and which failed.',
     'Paste your findings below.'], { minWords: 30 }),
  T('Complete a checkout user-flow test', 'Testing', 2.8, 'Hard', 'text', ['QA', 'UX'],
    'Walk through checkout end-to-end.',
    ['Go through a full add-to-cart → checkout flow on the test store.',
     'Describe each step, any friction, and 2 suggestions to improve it.',
     'Paste your full report below.'], { minWords: 50 }),

  // ---------------- Surveys ----------------
  T('Answer a 5-question opinion survey', 'Surveys', 0.5, 'Easy', 'data', ['Opinion'],
    'Share your honest opinions.',
    ['Q1 How often do you shop online? Q2 Preferred payment? Q3 Do you use mobile money? Q4 Favourite device? Q5 Do you read reviews?',
     'Answer each  number: answer.',
     'Enter 5 rows.'], { minLines: 5 }),
  T('Complete a product feedback form', 'Surveys', 1.2, 'Easy', 'text', ['Feedback'],
    'Give feedback on a product experience.',
    ['Think of a product/app you used recently.',
     'Describe what you liked, one problem, and whether you\'d recommend it (30+ words).',
     'Paste your feedback below.'], { minWords: 30 }),
  T('Brand awareness questionnaire', 'Surveys', 1.6, 'Medium', 'data', ['Opinion'],
    'Answer brand-recognition questions.',
    ['Q1 Name a mobile-money brand you know. Q2 A soft-drink brand. Q3 A bank. Q4 A supermarket. Q5 An airline.',
     'Answer each  number: brand.',
     'Enter 5 rows.'], { minLines: 5 }),
  T('Market research: shopping habits', 'Surveys', 2.0, 'Medium', 'text', ['Opinion', 'Research'],
    'Describe your shopping behaviour.',
    ['Answer in a short paragraph: where you shop, how often, what influences your choices, and your budget approach.',
     'Write 40+ words.',
     'Paste your response below.'], { minWords: 40 }),

  // ---------------- Executive tier ($14–$23) — Executive plan only ----------------
  T('Write a 700-word thought-leadership article', 'Writing', 18.0, 'Hard', 'text', ['Writing', 'Strategy'],
    'Write a polished long-form article for an executive audience.',
    ['Topic: "How small businesses in Africa can use AI to grow in 2026".',
     'Write a well-structured 650–750 word article with an intro, 3 key points, and a conclusion.',
     'Paste the full article below.'], { minWords: 620 }),
  T('Build a competitor analysis report', 'Research', 21.0, 'Hard', 'text', ['Research', 'Analysis'],
    'Research and compare 3 competitors in a market.',
    ['Pick a market you know (e.g. food delivery in Nairobi). Identify 3 real competitors.',
     'For each: pricing, strengths, weaknesses, and 1 opportunity. Then a short recommendation.',
     'Paste your full report (250+ words) below.'], { minWords: 250 }),
  T('Draft a 12-month marketing strategy', 'Marketing', 22.0, 'Hard', 'text', ['Marketing', 'Strategy'],
    'Create a high-level annual marketing plan.',
    ['Business: a new fintech app for savings groups.',
     'Outline quarterly goals, channels, budget split, and 3 KPIs to track.',
     'Paste your plan (250+ words) below.'], { minWords: 250 }),
  T('Full UX review of a checkout flow', 'Testing', 16.0, 'Hard', 'url', ['UX', 'Testing'],
    'Review a checkout flow and report issues.',
    ['Open any online store checkout you use.',
     'Write up 6+ specific usability issues and a fix for each, then upload your notes (doc/screenshot).',
     'Paste the link to your uploaded review.']),
  T('Translate a 500-word business document', 'Translation', 15.0, 'Hard', 'text', ['Translation', 'Business'],
    'Translate a formal business document accurately.',
    ['Translate a 450–550 word business text between two languages you are fluent in (state which).',
     'Keep the tone formal and accurate.',
     'Paste the full translation below.'], { minWords: 400 }),
  T('Transcribe a 20-minute interview', 'Transcription', 17.0, 'Hard', 'text', ['Transcription', 'Audio'],
    'Produce a clean, timestamped transcript.',
    ['Transcribe a 20-minute interview or podcast segment of your choice.',
     'Include speaker labels and timestamps every ~2 minutes.',
     'Paste the transcript (300+ words) below.'], { minWords: 300 }),
  T('Design a complete brand style guide', 'Design', 23.0, 'Hard', 'url', ['Design', 'Branding'],
    'Create a mini brand guide (logo, colours, type).',
    ['Design a 1–2 page brand style guide for a fictional business.',
     'Include a logo concept, colour palette, typography and usage rules.',
     'Upload it and paste the link below.']),
  T('Prepare a board meeting summary pack', 'Administrative Support', 14.0, 'Hard', 'text', ['Admin', 'Reporting'],
    'Summarise documents into an executive brief.',
    ['Imagine 3 department updates (sales, ops, finance).',
     'Write a concise 1-page board summary with key figures, risks and 3 decisions needed.',
     'Paste your summary (200+ words) below.'], { minWords: 200 }),
];

// URL check shared by url / photo / social validators.
function isHttpUrl(s) {
  try { const u = new URL(String(s).trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch (_) { return false; }
}
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
// Reject obvious junk: too few letters, one repeated char, or barely any distinct characters.
function looksLikeJunk(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  if (letters < 3) return true;
  if (/^(.)\1*$/.test(t.replace(/\s/g, ''))) return true;
  if (new Set(t.replace(/\s/g, '').toLowerCase()).size < 4) return true;
  return false;
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function similarity(a, b) {
  const A = normalizeText(a), B = normalizeText(b);
  if (!A || !B) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

/**
 * Validate a proof string for a task. Returns { ok:true } or { ok:false, error }.
 * Used by the server (authoritative) and mirrored on the client for instant feedback.
 */
function validateProof(task, raw) {
  const proof = String(raw == null ? '' : raw).trim();
  if (!task || !task.requiresProof) return { ok: true };
  if (!proof) return { ok: false, error: 'Please enter your proof of completion.' };

  switch (task.proofType) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(proof)) return { ok: false, error: 'Enter a valid email address, e.g. name@example.com.' };
      return { ok: true };

    case 'url':
      if (!isHttpUrl(proof)) return { ok: false, error: 'Enter a valid link that starts with http:// or https://.' };
      return { ok: true };

    case 'photo':
      if (!isHttpUrl(proof)) return { ok: false, error: 'Paste a valid image link that starts with http:// or https://.' };
      if (!/\.(png|jpe?g|gif|webp|heic|bmp)(\?|#|$)/i.test(proof) &&
          !/(imgur|ibb\.co|imgbb|postimg|drive\.google|photos\.app\.goo|cloudinary|dropbox|githubusercontent)/i.test(proof)) {
        return { ok: false, error: 'That does not look like an uploaded image link. Upload your photo and paste the direct image link.' };
      }
      return { ok: true };

    case 'social': {
      const isHandle = /^@?[a-z0-9_.]{3,30}$/i.test(proof);
      if (!isHandle && !isHttpUrl(proof)) return { ok: false, error: 'Enter your profile/post link, or your @username.' };
      return { ok: true };
    }

    case 'code': {
      const want = String(task.code || '').trim().toLowerCase();
      if (want && proof.toLowerCase() !== want) return { ok: false, error: 'That confirmation code is not correct. Follow the steps and enter the exact code shown.' };
      return { ok: true };
    }

    case 'data': {
      const lines = proof.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const need = task.minLines || 3;
      if (lines.length < need) return { ok: false, error: `Enter at least ${need} rows, one per line.` };
      const wellFormed = lines.filter((l) => /[,:]/.test(l) && /[a-z0-9]/i.test(l)).length;
      if (wellFormed < need) return { ok: false, error: 'Each row must use the requested format (values separated by a comma or colon).' };
      return { ok: true };
    }

    case 'match': {
      if (looksLikeJunk(proof)) return { ok: false, error: 'Please type your full answer.' };
      if (similarity(proof, task.expected) < (task.minSimilarity || 0.8)) {
        return { ok: false, error: 'Your text does not closely match the passage. Please type it exactly as shown.' };
      }
      return { ok: true };
    }

    default: { // 'text'
      if (looksLikeJunk(proof)) return { ok: false, error: 'Please enter a real answer, not random characters.' };
      const minW = task.minWords || 8, minC = task.minChars || 30;
      if (wordCount(proof) < minW) return { ok: false, error: `Please write at least ${minW} words.` };
      if (proof.length < minC) return { ok: false, error: `Your answer looks too short. Please write at least ${minC} characters.` };
      return { ok: true };
    }
  }
}

// Required subscription tier is derived AUTOMATICALLY from the reward:
//   reward <= $1.00 -> basic | $1.01–$2.00 -> premium | $2.01–$3.00 -> premiumpro
//   above $3.00 (i.e. the $14–$23 band) -> executive (hidden top plan, untouched)
function tierForReward(reward) {
  const r = Number(reward) || 0;
  if (r <= 1.00) return 'basic';
  if (r <= 2.00) return 'premium';
  if (r <= 3.00) return 'premiumpro';
  return 'executive';           // high-value tasks ($14–$23) — Executive plan only
}

const EST_MIN = { Easy: 5, Medium: 11, Hard: 20 };
const TASKS = RAW.map((t, i) => {
  const reward = Math.min(Math.max(Number(t.reward) || 0, 0.01), 25.00); // clamp to $0.01–$25.00 (Executive tasks reach $23)
  const difficulty = t.difficulty || (reward <= 1 ? 'Easy' : reward <= 2 ? 'Medium' : 'Hard');
  return {
    id: 'T' + String(i + 1).padStart(3, '0'),
    title: t.title,
    category: t.category,
    icon: (CAT_META[t.category] || {}).icon || '📌',
    description: t.description || '',
    difficulty,
    skills: t.skills || [],
    reward,                               // USD
    tier: tierForReward(reward),          // basic | premium | premiumpro
    proofType: t.proofType || 'text',
    requiresProof: true,
    // validation params surfaced to the client for instant feedback:
    expected: t.expected || null,
    minSimilarity: t.minSimilarity || null,
    minWords: t.minWords || null,
    minChars: t.minChars || null,
    minLines: t.minLines || null,
    code: t.code || null,
    approveRate: null,                    // "N/A" for a brand-new platform
    estMinutes: (EST_MIN[difficulty] || 8) + (i % 3) * 2,
    instructions: t.instructions,
  };
});

const CATEGORIES = Object.keys(CAT_META).map((name) => ({ name, icon: CAT_META[name].icon }));

// ---------------------------------------------------------------------------
//  FREE TASKS — the single, regenerating free task shown to users with NO active
//  subscription. Each is Easy and pays $0.40. A free user sees exactly one at a
//  time; when it's done, the next one appears. The pool is finite (once exhausted
//  the user must subscribe) so there's no unlimited free earning.
// ---------------------------------------------------------------------------
const FREE_RAW = [
  T('Answer 3 quick opinion questions', 'Surveys', 0.40, 'Easy', 'data', ['Opinion'],
    'A 30-second opinion micro-survey.',
    ['Q1 Do you shop online? Q2 Do you use mobile money? Q3 Do you read reviews before buying?',
     'Answer each as a row  number: answer (yes/no).', 'Enter 3 rows.'], { minLines: 3 }),
  T('Write a one-sentence app review', 'Surveys', 0.40, 'Easy', 'text', ['Feedback'],
    'Share a quick thought on any app you use.',
    ['Think of an app you used this week.', 'Write one honest sentence about what you like or dislike.',
     'Paste your sentence below.'], { minWords: 8 }),
  T('Name 3 brands you recognise', 'Surveys', 0.40, 'Easy', 'data', ['Opinion'],
    'A fast brand-recognition check.',
    ['Q1 A mobile-money brand. Q2 A supermarket. Q3 A soft drink.',
     'Answer each  number: brand.', 'Enter 3 rows.'], { minLines: 3 }),
  T('Sort 4 items into groups', 'Data Entry', 0.40, 'Easy', 'data', ['Sorting'],
    'Put each item in the right group.',
    ['Items: milk, t-shirt, banana, jeans.', 'For each write  item: group (Food / Clothing).',
     'Enter 4 rows.'], { minLines: 4 }),
  T('List 3 uses for a smartphone', 'Education', 0.40, 'Easy', 'text', ['Ideas'],
    'A quick brainstorm.',
    ['Think about everyday phone use.', 'List 3 different things people use a smartphone for.',
     'Paste your 3 answers (numbered) below.'], { minWords: 8 }),
  T('Answer 3 general-knowledge questions', 'Education', 0.40, 'Easy', 'data', ['Knowledge'],
    'Three quick questions.',
    ['Q1 Capital of Kenya? Q2 2+2? Q3 Days in a week?', 'Answer each  number: answer.',
     'Enter 3 rows.'], { minLines: 3 }),
  T('Translate "hello, how are you?" to Swahili', 'Translation', 0.40, 'Easy', 'text', ['Swahili'],
    'One quick translation.',
    ['Translate the phrase "Hello, how are you?" into natural Swahili.',
     'Paste your translation below.'], { minWords: 3 }),
  T('Suggest a name for a coffee shop', 'Marketing', 0.40, 'Easy', 'text', ['Ideas'],
    'A one-line naming task.',
    ['A new neighbourhood coffee shop needs a name.', 'Suggest one catchy name and a 5-word tagline.',
     'Paste your idea below.'], { minWords: 6 }),
  T('Describe your favourite meal', 'Writing', 0.40, 'Easy', 'text', ['Writing'],
    'A short, fun writing warm-up.',
    ['Think of a meal you love.', 'Describe it in one or two sentences.',
     'Paste your description below.'], { minWords: 10 }),
  T('Pick 3 colours for a logo', 'Design', 0.40, 'Easy', 'text', ['Colour'],
    'Quick colour choices.',
    ['Brand: a fresh juice bar.', 'Suggest 3 colours (names or hex codes) that would suit it.',
     'Paste your 3 colours below.'], { minWords: 4 }),
  T('Enter 3 sample contacts', 'Data Entry', 0.40, 'Easy', 'data', ['Data entry'],
    'Type three clean contact rows.',
    ['Invent 3 realistic sample contacts.', 'Each row: a name and a phone number.',
     'Enter 3 rows:  Name, +2547XXXXXXXX'], { minLines: 3 }),
  T('Answer a 3-question shopping survey', 'Surveys', 0.40, 'Easy', 'data', ['Opinion'],
    'Tell us how you shop.',
    ['Q1 Where do you shop most? Q2 How often? Q3 Cash or mobile money?',
     'Answer each  number: answer.', 'Enter 3 rows.'], { minLines: 3 }),
];
const FREE_TASKS = FREE_RAW.map((t, i) => ({
  id: 'F' + String(i + 1).padStart(3, '0'),
  title: t.title,
  category: t.category,
  icon: (CAT_META[t.category] || {}).icon || '📌',
  description: t.description || '',
  difficulty: 'Easy',
  skills: t.skills || [],
  reward: 0.40,
  tier: 'free',                         // accessible to everyone (see canAccessTask)
  free: true,
  proofType: t.proofType || 'text',
  requiresProof: true,
  expected: t.expected || null,
  minSimilarity: t.minSimilarity || null,
  minWords: t.minWords || null,
  minChars: t.minChars || null,
  minLines: t.minLines || null,
  code: t.code || null,
  approveRate: null,
  estMinutes: 3 + (i % 3),
  instructions: t.instructions,
}));

const ALL_BY_ID = {};
TASKS.forEach((t) => { ALL_BY_ID[t.id] = t; });
FREE_TASKS.forEach((t) => { ALL_BY_ID[t.id] = t; });

module.exports = {
  TASKS,
  FREE_TASKS,
  CATEGORIES,
  CAT_META,
  byId: (id) => ALL_BY_ID[id] || null,   // searches both the paid catalog and free pool
  validateProof,
  tierForReward,
};
