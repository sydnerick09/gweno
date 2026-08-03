/**
 * Static catalog of real microtasks. Every task is SELF-CONTAINED: all the content a
 * worker needs (the passage to type, the brief to write from, the rows to enter) lives
 * in the instructions, so nothing ever refers to a link/image/file that doesn't exist.
 *
 * Each task declares a `proofType` and the system validates the submitted proof against
 * it, so junk like ".", "123" or random letters is rejected before it reaches review.
 *
 * proofType:
 *   match  — must closely reproduce `expected` (typing / proofreading)
 *   text   — substantive free text (writing / translation); `minWords`/`minChars`
 *   email  — a valid email address
 *   url    — a valid http(s) link
 *   photo  — a link to an uploaded image
 *   social — a profile/post link or an @username
 *   data   — several rows in the requested delimited format; `minLines`
 *   code   — an exact confirmation code (surveys); `code`
 */

const RAW = [
  // ---------------- FREE / BASIC (simple, ≤ $0.50) ----------------
  {
    title: 'Type a sentence exactly', category: 'Typing', reward: 0.5, tier: 'basic',
    proofType: 'match', minSimilarity: 0.85,
    expected: 'The quick brown fox jumps over the lazy dog while the sun sets slowly.',
    instructions: [
      'Read the sentence in quotes below.',
      'Sentence: "The quick brown fox jumps over the lazy dog while the sun sets slowly."',
      'Type it out exactly, keeping the spelling, spacing and punctuation.',
      'Paste your typed sentence in the box below.',
    ],
  },
  {
    title: 'Correct the spelling mistakes', category: 'Proofreading', reward: 0.5, tier: 'basic',
    proofType: 'match', minSimilarity: 0.85,
    expected: 'Our team received your message and will respond within a few hours.',
    instructions: [
      'Here is a sentence with spelling mistakes: "Our teem recieved your mesage and will respund within a few hours."',
      'Rewrite it with every word spelled correctly.',
      'Paste your corrected sentence below.',
    ],
  },
  {
    title: 'Submit a valid email address', category: 'Email', reward: 0.4, tier: 'basic',
    proofType: 'email',
    instructions: [
      'We are testing our newsletter delivery.',
      'Enter a valid email address that you own and check regularly.',
      'It must be a real, correctly formatted address (for example name@example.com).',
    ],
  },
  {
    title: 'Share a relevant article link', category: 'Link', reward: 0.4, tier: 'basic',
    proofType: 'url',
    instructions: [
      'Find one online news article about online jobs or the digital economy in Africa.',
      'Copy the full web address of that article.',
      'Paste the complete link below (it must start with http:// or https://).',
    ],
  },
  {
    title: 'Follow Gweno on social media', category: 'Social media', reward: 0.5, tier: 'basic',
    proofType: 'social',
    instructions: [
      'Follow the official Gweno page @GwenoApp on the social network you use most.',
      'Copy your own profile link, or your @username.',
      'Paste your profile link or @username below so we can confirm the follow.',
    ],
  },
  {
    title: 'Complete a quick opinion check', category: 'Survey', reward: 0.5, tier: 'basic',
    proofType: 'code', code: 'GWENO-DONE',
    instructions: [
      'Answer these three questions honestly, for yourself: 1) How did you first hear about Gweno? 2) Which feature do you use most? 3) Would you recommend Gweno to a friend?',
      'When you have thought through all three, type the confirmation code exactly: GWENO-DONE',
      'Paste the confirmation code below.',
    ],
  },

  // ---------------- PREMIUM · Typing ----------------
  {
    title: 'Type out a full paragraph', category: 'Typing', reward: 1.5, tier: 'premium',
    proofType: 'match', minSimilarity: 0.85,
    expected: 'Remote work has opened new doors for people across the world. With a phone and an internet connection, anyone can complete tasks, learn new skills and earn an income from home.',
    instructions: [
      'Read the paragraph below carefully.',
      'Paragraph: "Remote work has opened new doors for people across the world. With a phone and an internet connection, anyone can complete tasks, learn new skills and earn an income from home."',
      'Type it out exactly as written, keeping all punctuation.',
      'Paste your typed paragraph below.',
    ],
  },
  {
    title: 'Digitise a short note', category: 'Typing', reward: 1.3, tier: 'premium',
    proofType: 'match', minSimilarity: 0.85,
    expected: 'Meeting moved to Thursday at 3pm. Please bring the sales report and the updated budget for review.',
    instructions: [
      'Below is the text of a handwritten note.',
      'Note: "Meeting moved to Thursday at 3pm. Please bring the sales report and the updated budget for review."',
      'Type it out cleanly and accurately.',
      'Paste the typed text below.',
    ],
  },

  // ---------------- PREMIUM · Writing ----------------
  {
    title: 'Write a 150-word product description', category: 'Writing', reward: 2.0, tier: 'premium',
    proofType: 'text', minWords: 60, minChars: 300,
    instructions: [
      'Product: a stainless-steel water bottle. Details: 750ml, keeps drinks cold for 24 hours, BPA-free, leak-proof lid.',
      'Write a persuasive description of about 150 words that highlights the benefits.',
      'Paste your description below.',
    ],
  },
  {
    title: 'Write 5 social media captions', category: 'Writing', reward: 1.8, tier: 'premium',
    proofType: 'text', minWords: 25, minChars: 140,
    instructions: [
      'Brand: a small coffee shop launching a new cold brew.',
      'Write 5 short, engaging captions (each with one or two relevant hashtags).',
      'Paste all 5 captions below, numbered 1 to 5.',
    ],
  },
  {
    title: 'Write a 300-word blog introduction', category: 'Writing', reward: 3.0, tier: 'premium',
    proofType: 'text', minWords: 90, minChars: 500,
    instructions: [
      'Topic: how anyone can start earning online with just a smartphone.',
      'Write an introduction of about 300 words that hooks the reader and previews the article.',
      'Paste your introduction below.',
    ],
  },
  {
    title: 'Write 3 SEO meta descriptions', category: 'Writing', reward: 1.5, tier: 'premium',
    proofType: 'text', minWords: 25, minChars: 140,
    instructions: [
      'Page titles: 1) "Best budget smartphones 2026", 2) "How to save money on groceries", 3) "Beginner guide to investing".',
      'Write one SEO meta description (up to 155 characters) for each title.',
      'Paste all 3 below, numbered 1 to 3.',
    ],
  },
  {
    title: 'Rewrite a paragraph to be clearer', category: 'Writing', reward: 1.2, tier: 'premium',
    proofType: 'text', minWords: 20, minChars: 110,
    instructions: [
      'Original: "Due to the fact that the product was not in a condition that was acceptable, we made the decision to send it back to the seller for a refund of the money."',
      'Rewrite it so it is shorter and clearer, keeping the same meaning.',
      'Paste your rewrite below.',
    ],
  },
  {
    title: 'Research and share 3 facts', category: 'Research', reward: 1.6, tier: 'premium',
    proofType: 'text', minWords: 25, minChars: 140,
    instructions: [
      'Topic: mobile money in East Africa.',
      'Find three accurate, interesting facts about it.',
      'Write each fact as a full sentence. Paste all three below, numbered 1 to 3.',
    ],
  },

  // ---------------- PREMIUM · Translation ----------------
  {
    title: 'Translate a sentence to Swahili', category: 'Translation', reward: 1.0, tier: 'premium',
    proofType: 'text', minWords: 3, minChars: 12,
    instructions: [
      'English sentence: "Thank you for your help. We are happy to work with you."',
      'Translate it into natural, fluent Swahili.',
      'Paste your Swahili translation below.',
    ],
  },
  {
    title: 'Translate a short paragraph', category: 'Translation', reward: 2.5, tier: 'premium',
    proofType: 'text', minWords: 25, minChars: 140,
    instructions: [
      'English paragraph: "Our new app makes it easy to send and receive money. You can pay bills, buy airtime and save for the future, all from your phone. Getting started takes only a few minutes."',
      'Translate the whole paragraph into fluent Swahili.',
      'Paste your translation below.',
    ],
  },

  // ---------------- PREMIUM · Data entry ----------------
  {
    title: 'Enter 10 rows of contact data', category: 'Data entry', reward: 2.0, tier: 'premium',
    proofType: 'data', minLines: 10,
    instructions: [
      'Create 10 sample contact rows for a test address book.',
      'Enter one contact per line in this exact format:  Full Name, Phone, Email',
      'Example row:  Jane Doe, +254712345678, jane@example.com',
      'Paste all 10 rows below, one per line.',
    ],
  },
  {
    title: 'Format a plain list into rows', category: 'Data entry', reward: 1.0, tier: 'premium',
    proofType: 'data', minLines: 5,
    instructions: [
      'Here is a plain list of products and prices: Notebook 250, Pen 50, Stapler 400, Folder 120, Marker 90.',
      'Turn it into clean rows, one per line, in the format:  Product, Price',
      'Paste all 5 rows below, one per line.',
    ],
  },
  {
    title: 'Tag 5 customer reviews', category: 'Data', reward: 2.0, tier: 'premium',
    proofType: 'data', minLines: 5,
    instructions: [
      'Reviews: 1) "Loved it, works perfectly!" 2) "It was okay, nothing special." 3) "Terrible, broke on day one." 4) "Fast delivery and great quality." 5) "Not worth the price."',
      'Label each review as positive, neutral or negative.',
      'Enter one per line in the format:  1, positive',
      'Paste all 5 labelled rows below, one per line.',
    ],
  },

  // ---------------- PREMIUM · Research / verification (links) ----------------
  {
    title: 'Find an official company website', category: 'Research', reward: 1.6, tier: 'premium',
    proofType: 'url',
    instructions: [
      'Find the official website of a well-known company in your country (for example a bank, telecom or retailer).',
      'Make sure it is the real official site, not a directory or social page.',
      'Paste the full website link below (it must start with http:// or https://).',
    ],
  },

  // ---------------- PREMIUM · Photography ----------------
  {
    title: 'Upload a photo of a printed receipt', category: 'Photography', reward: 2.0, tier: 'premium',
    proofType: 'photo',
    instructions: [
      'Take a clear photo of any printed shop receipt (personal details can be covered).',
      'Upload the photo to a free image host (for example imgur.com or imgbb.com), or Google Drive set to "anyone with the link".',
      'Paste the direct image link below.',
    ],
  },
  {
    title: 'Upload a photo of a product on a shelf', category: 'Photography', reward: 1.5, tier: 'premium',
    proofType: 'photo',
    instructions: [
      'Take a clear photo of any product on a shop shelf, with its price visible.',
      'Upload the photo to a free image host and copy the direct image link.',
      'Paste the image link below.',
    ],
  },

  // ---------------- PREMIUM · Social media ----------------
  {
    title: 'Share a post about Gweno', category: 'Social media', reward: 1.8, tier: 'premium',
    proofType: 'social',
    instructions: [
      'Write a short, positive post about Gweno on your social media and publish it.',
      'Open the published post and copy its link.',
      'Paste the post link below (a direct link to the post you shared).',
    ],
  },
  {
    title: 'Submit your social profile username', category: 'Social media', reward: 1.2, tier: 'premium',
    proofType: 'social',
    instructions: [
      'Choose the social network where you are most active.',
      'Copy your public @username or your profile link.',
      'Paste your @username or profile link below.',
    ],
  },
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

// Required subscription tier is derived AUTOMATICALLY from the reward (spec):
//   reward <= $1.00   -> basic
//   $1.01 - $2.00     -> premium
//   $2.01 - $7.00     -> premiumpro
function tierForReward(reward) {
  const r = Number(reward) || 0;
  if (r <= 1.00) return 'basic';
  if (r <= 2.00) return 'premium';
  return 'premiumpro';
}

const TASKS = RAW.map((t, i) => {
  const reward = Math.min(Math.max(Number(t.reward) || 0, 0.01), 7.00); // clamp to $0.01–$7.00
  return {
    id: 'T' + String(i + 1).padStart(3, '0'),
    title: t.title,
    category: t.category,
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
    estMinutes: Math.max(2, Math.round(reward * 4)),
    instructions: t.instructions,
  };
});

module.exports = {
  TASKS,
  byId: (id) => TASKS.find((t) => t.id === id) || null,
  validateProof,
  tierForReward,
};
