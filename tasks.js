/**
 * Static catalog of real microtasks — writing, typing, transcription (audio-to-text),
 * translation, data entry and labelling. Deterministic (no randomness) so task ids and
 * rewards stay stable across restarts. Format:
 *   [title, category, rewardUSD, requiresProof, [instructions...]]
 * A handful of simple, low-pay tasks are FREE (basic); the rest are Premium.
 */
const RAW = [
  // ---------- FREE / BASIC (simple, ≤ $0.50) ----------
  ['Type out a short paragraph', 'Typing', 0.5, true,
    ['Open the image/scan from the task link.', 'Type the paragraph exactly as written, keeping spelling and punctuation.', 'Paste your typed text below as proof.']],
  ['Translate one sentence (English ↔ Swahili)', 'Translation', 0.5, true,
    ['Open the sentence from the task link.', 'Translate it accurately into the other language.', 'Paste your translation below.']],
  ['Write one product title', 'Writing', 0.4, true,
    ['Read the short product details in the link.', 'Write one clear, catchy product title (max 12 words).', 'Paste your title below.']],
  ['Categorise 10 images', 'Data', 0.5, true,
    ['Open the labelling sheet from the link.', 'Tag each of the 10 images with the correct category.', 'Submit and paste the confirmation code.']],
  ['Proofread a short note', 'Proofreading', 0.5, true,
    ['Open the 80–100 word note from the link.', 'Fix any spelling, grammar and punctuation mistakes.', 'Paste the corrected text below.']],
  ['Quick opinion survey', 'Survey', 0.5, false,
    ['Open the survey from the link.', 'Answer every question honestly.', 'Paste the completion code shown at the end.']],

  // ---------- PREMIUM · Transcription (audio → text) ----------
  ['Transcribe a 2-minute audio clip', 'Transcription', 2.5, true,
    ['Listen to the 2-minute clip from the link.', 'Type out everything you hear, word for word.', 'Use correct punctuation and speaker labels if there are two speakers.', 'Paste your full transcript below.']],
  ['Transcribe a 5-minute interview', 'Transcription', 4.0, true,
    ['Listen to the interview recording.', 'Transcribe it accurately with speaker labels (e.g. "Q:" and "A:").', 'Paste your transcript below.']],
  ['Transcribe a voicemail message', 'Transcription', 1.2, true,
    ['Play the short voicemail from the link.', 'Type exactly what is said.', 'Paste the text below.']],
  ['Transcribe a podcast segment', 'Transcription', 3.0, true,
    ['Listen to the 3–4 minute podcast segment.', 'Transcribe it cleanly, removing filler words like "um".', 'Paste the transcript below.']],
  ['Add captions to a 1-minute video', 'Transcription', 2.0, true,
    ['Watch the 1-minute video from the link.', 'Write timed captions (00:00 – line of text) for the whole clip.', 'Paste your caption lines below.']],

  // ---------- PREMIUM · Translation ----------
  ['Translate a 200-word article (English → Swahili)', 'Translation', 3.0, true,
    ['Open the 200-word article from the link.', 'Translate it into natural, fluent Swahili.', 'Paste your translation below.']],
  ['Translate product descriptions (Swahili → English)', 'Translation', 2.5, true,
    ['Open the 5 product descriptions from the link.', 'Translate each into clear English.', 'Paste all translations below, numbered 1–5.']],
  ['Translate a customer email', 'Translation', 1.5, true,
    ['Open the customer email from the link.', 'Translate it into the requested language.', 'Paste your translation below.']],
  ['Translate app menu labels', 'Translation', 2.0, true,
    ['Open the list of 15 app menu labels.', 'Translate each into the target language, keeping them short.', 'Paste the translated list below.']],
  ['Localise a short survey', 'Translation', 2.2, true,
    ['Open the 10-question survey from the link.', 'Translate all questions and answer options naturally.', 'Paste the translated survey below.']],

  // ---------- PREMIUM · Writing ----------
  ['Write a 150-word product description', 'Writing', 2.0, true,
    ['Read the product details in the link.', 'Write a persuasive 150-word description highlighting the benefits.', 'Paste your description below.']],
  ['Write 5 social media captions', 'Writing', 1.8, true,
    ['Read the brand brief in the link.', 'Write 5 short, engaging captions with relevant hashtags.', 'Paste all 5 captions below.']],
  ['Write a 300-word blog intro', 'Writing', 3.0, true,
    ['Read the blog topic and key points in the link.', 'Write a 300-word introduction that hooks the reader.', 'Paste your intro below.']],
  ['Write 3 SEO meta descriptions', 'Writing', 1.5, true,
    ['Open the 3 page titles from the link.', 'Write an SEO meta description (max 155 characters) for each.', 'Paste all 3 below.']],
  ['Write a short customer FAQ', 'Writing', 2.5, true,
    ['Read the product info in the link.', 'Write 5 useful FAQ questions with clear answers.', 'Paste the FAQ below.']],
  ['Rewrite a paragraph to be clearer', 'Writing', 1.2, true,
    ['Open the paragraph from the link.', 'Rewrite it to be simpler and clearer, keeping the meaning.', 'Paste your rewrite below.']],

  // ---------- PREMIUM · Typing / Data entry ----------
  ['Retype a scanned document page', 'Typing', 1.5, true,
    ['Open the scanned page from the link.', 'Type the full page accurately, keeping the layout.', 'Paste the typed text below.']],
  ['Enter 25 rows of contact data', 'Data entry', 2.0, true,
    ['Open the sheet and the source list from the link.', 'Enter all 25 rows (name, phone, email) correctly.', 'Submit and paste the confirmation code.']],
  ['Digitise a handwritten note', 'Typing', 1.3, true,
    ['Open the handwritten note image from the link.', 'Type out exactly what it says.', 'Paste the text below.']],
  ['Format a list into a table', 'Data entry', 1.0, true,
    ['Open the plain list from the link.', 'Organise it into a clean table with the given columns.', 'Paste the table (or its confirmation code) below.']],

  // ---------- PREMIUM · Data labelling / research ----------
  ['Label 30 product images by category', 'Data', 2.5, true,
    ['Open the labelling tool from the link.', 'Tag each of the 30 images with the correct category.', 'Paste the finish code below.']],
  ['Tag 25 reviews (positive / neutral / negative)', 'Data', 2.0, true,
    ['Open the tagging sheet from the link.', 'Label each of the 25 reviews with the right sentiment.', 'Paste the confirmation code below.']],
  ['Verify 15 business phone numbers', 'Research', 1.6, true,
    ['Open the list of 15 businesses from the link.', 'Confirm each phone number is correct online.', 'Paste "correct" or the fixed number for each, numbered 1–15.']],
  ['Clean 40 rows of messy data', 'Data', 2.8, true,
    ['Open the spreadsheet from the link.', 'Remove duplicates, fix obvious typos and standardise the formatting.', 'Paste the confirmation code below.']],
];

// Free tier = exactly these simple tasks (each ≤ $0.50). Everything else is Premium.
const BASIC_TITLES = new Set([
  'Type out a short paragraph',
  'Translate one sentence (English ↔ Swahili)',
  'Write one product title',
  'Categorise 10 images',
  'Proofread a short note',
  'Quick opinion survey',
]);
const BASIC_MAX_USD = 0.5;
const TASKS = RAW.map((t, i) => {
  const isBasic = BASIC_TITLES.has(t[0]);
  const reward = isBasic ? Math.min(t[2], BASIC_MAX_USD) : t[2]; // basic never exceeds $0.50
  return {
    id: 'T' + String(i + 1).padStart(3, '0'),
    title: t[0],
    category: t[1],
    reward,                                // USD
    tier: isBasic ? 'basic' : 'premium',
    requiresProof: t[3],   // whether a text proof is required on submit
    approveRate: null,     // "N/A" for a brand-new platform
    estMinutes: Math.max(2, Math.round(reward * 4)),
    instructions: t[4],
  };
});

module.exports = { TASKS, byId: (id) => TASKS.find((t) => t.id === id) || null };
