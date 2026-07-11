/**
 * Static catalog of 36 microtasks. Deterministic (no randomness) so task ids and
 * rewards stay stable across restarts. Rewards range from $0.50 to $4.00.
 */
const RAW = [
  ['Sign up for the NovaBank demo', 'Sign-up', 3.5, false,
    ['Open the offer link and click "Create demo account".', 'Register with a valid email address.', 'Confirm your email from the inbox.', 'Paste the email you used as your proof below.']],
  ['Install the BrightPay app', 'App Install', 2.0, false,
    ['Install BrightPay from your app store using the offer link.', 'Open the app and complete the welcome screen.', 'Keep the app installed for at least 48 hours.', 'Enter the email tied to your app account as proof.']],
  ['Watch a 2-minute product video', 'Video', 0.5, true,
    ['Watch the full video from the offer link.', 'Note the codeword shown at the end.', 'Type the codeword below as proof.']],
  ['Complete a Google search task', 'Search', 0.5, true,
    ['Search the given phrase on Google.', 'Click the highlighted result and stay 30 seconds.', 'Enter the title of the page you landed on.']],
  ['Follow the Gweno page on X', 'Social', 0.8, false,
    ['Open our X (Twitter) profile from the link.', 'Follow the page.', 'Enter your X username as proof.']],
  ['Write a short app review', 'Review', 1.5, true,
    ['Install the app and use it for a few minutes.', 'Leave an honest 4–5 sentence review on the store.', 'Paste a screenshot link or your review text as proof.']],
  ['Categorise 20 product images', 'Data', 2.5, true,
    ['Open the labelling sheet from the link.', 'Tag each of the 20 images with the right category.', 'Submit the sheet and paste the confirmation code.']],
  ['Complete the lifestyle survey', 'Survey', 1.2, false,
    ['Open the survey from the link.', 'Answer all questions honestly.', 'Paste the completion code shown at the end.']],
  ['Register on QuickCash rewards', 'Sign-up', 3.0, false,
    ['Create a free QuickCash account via the link.', 'Verify your phone number.', 'Enter your QuickCash username as proof.']],
  ['Install and open PixelPlay', 'App Install', 1.8, false,
    ['Install PixelPlay via the offer link.', 'Reach level 2 in the tutorial.', 'Enter your in-game name as proof.']],
  ['Watch 3 short clips', 'Video', 0.6, true,
    ['Watch all three clips end to end.', 'Remember the word shown after the last clip.', 'Type that word as proof.']],
  ['Search and compare prices', 'Search', 0.7, true,
    ['Search the given product on the shopping site.', 'Find the cheapest listing.', 'Enter the price you found.']],
  ['Join the Gweno Facebook group', 'Social', 0.9, false,
    ['Open our Facebook group link.', 'Request to join and accept the rules.', 'Enter your Facebook display name.']],
  ['Rate 5 songs in the demo app', 'Review', 1.0, true,
    ['Open the music demo app.', 'Rate any 5 songs.', 'Paste the confirmation code.']],
  ['Transcribe a 1-minute clip', 'Data', 2.2, true,
    ['Listen to the short audio clip.', 'Type out what you hear accurately.', 'Paste your transcript below.']],
  ['Take the shopping-habits survey', 'Survey', 1.4, false,
    ['Open the survey link.', 'Complete every section.', 'Paste the completion code.']],
  ['Create a TrendWallet account', 'Sign-up', 3.8, false,
    ['Sign up on TrendWallet via the link.', 'Complete the starter checklist inside.', 'Enter your TrendWallet username.']],
  ['Try the CloudNest free trial', 'App Install', 2.6, false,
    ['Start the CloudNest free trial from the link.', 'Upload one test file.', 'Enter the email used to sign up.']],
  ['Watch a webinar replay', 'Video', 0.8, true,
    ['Watch at least 5 minutes of the replay.', 'Note the passphrase mentioned.', 'Enter the passphrase.']],
  ['Verify a business listing', 'Search', 1.1, true,
    ['Search the business name provided.', 'Confirm the phone number matches.', 'Enter "match" or "no match" and the number.']],
  ['Subscribe to the Gweno channel', 'Social', 0.7, false,
    ['Open our YouTube channel link.', 'Subscribe and turn on notifications.', 'Enter your YouTube handle.']],
  ['Review a restaurant page', 'Review', 1.3, true,
    ['Visit the restaurant page from the link.', 'Write a 3–4 sentence review.', 'Paste your review text.']],
  ['Tag 15 support messages', 'Data', 2.0, true,
    ['Open the tagging tool.', 'Label 15 messages as positive/neutral/negative.', 'Paste the finish code.']],
  ['Finish the travel survey', 'Survey', 1.6, false,
    ['Open the travel survey link.', 'Answer all questions.', 'Paste the completion code.']],
  ['Open a Zenpay demo wallet', 'Sign-up', 3.2, false,
    ['Create a Zenpay demo wallet via the link.', 'Add a test payment method.', 'Enter your wallet ID.']],
  ['Install SnapForm builder', 'App Install', 1.9, false,
    ['Install SnapForm from the link.', 'Create one sample form.', 'Enter your SnapForm account email.']],
  ['Watch a tutorial to the end', 'Video', 0.5, true,
    ['Watch the tutorial fully.', 'Note the final on-screen code.', 'Enter the code.']],
  ['Find an address on the map', 'Search', 0.6, true,
    ['Search the place name provided on the map.', 'Read the street address shown.', 'Enter the street address.']],
  ['Share our post', 'Social', 0.8, false,
    ['Open the post from the link.', 'Share it publicly to your timeline.', 'Enter the link to your shared post.']],
  ['Review a mobile game', 'Review', 1.7, true,
    ['Play the game for 5 minutes.', 'Leave an honest review on the store.', 'Paste your review text.']],
  ['Clean a small dataset', 'Data', 2.8, true,
    ['Open the spreadsheet from the link.', 'Remove duplicate rows and fix obvious typos.', 'Paste the confirmation code.']],
  ['Complete the tech-use survey', 'Survey', 1.5, false,
    ['Open the survey link.', 'Answer all questions.', 'Paste the completion code.']],
  ['Join GoMart loyalty', 'Sign-up', 2.9, false,
    ['Sign up for GoMart loyalty via the link.', 'Confirm your membership email.', 'Enter your membership number.']],
  ['Test the Vibe beta app', 'App Install', 4.0, false,
    ['Install the Vibe beta from the link.', 'Complete onboarding and post one item.', 'Enter your Vibe username.']],
  ['Watch and rate an advert', 'Video', 0.6, true,
    ['Watch the advert fully.', 'Rate it from 1 to 5 inside the player.', 'Enter the rating you gave.']],
  ['Verify a product barcode', 'Search', 0.9, true,
    ['Search the barcode number provided.', 'Confirm the product name that appears.', 'Enter the product name.']],
];

// Free tier = exactly these 4 tasks, each paying $0.50 or less. Everything else is
// Premium (needs a subscription). Basic rewards are capped at $0.50.
const BASIC_TITLES = new Set([
  'Watch a 2-minute product video',
  'Complete a Google search task',
  'Watch a tutorial to the end',
  'Find an address on the map',
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
