/**
 * Card / PayPal / Paystack funding for investments (USD). M-Pesa is handled by
 * payments.js (STK Push in KES). Every provider here is REAL — it stays disabled
 * (throws a clear "add your keys" error) until its keys are set in .env:
 *
 *   Stripe   : STRIPE_SECRET_KEY                       (Checkout, also powers "Card")
 *   PayPal   : PAYPAL_CLIENT_ID + PAYPAL_SECRET        (PAYPAL_ENV = sandbox|live)
 *   Paystack : PAYSTACK_SECRET_KEY
 *
 * Each provider exposes:
 *   xConfigured()                              -> boolean
 *   createCheckout({ amountUSD, email, ref, returnUrl, cancelUrl }) -> { url, providerRef }
 *   verify(providerRef)                        -> true if the payment completed
 *
 * The hosted-checkout pattern (redirect the user to the provider, then verify on
 * return) needs only a secret key server-side — no client SDK. Uses global fetch.
 */
const cents = (usd) => Math.round((Number(usd) || 0) * 100);
const form = (obj) => new URLSearchParams(obj).toString();

/* ------------------------------ Stripe ------------------------------ */
const stripeKey = () => process.env.STRIPE_SECRET_KEY || '';
function stripeConfigured() { return !!stripeKey(); }

async function stripeCreate({ amountUSD, email, ref, returnUrl, cancelUrl }) {
  const body = form({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    success_url: returnUrl,
    cancel_url: cancelUrl,
    client_reference_id: ref,
    'customer_email': email || '',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents(amountUSD)),
    'line_items[0][price_data][product_data][name]': 'Gweno investment',
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error((j.error && j.error.message) || `Stripe HTTP ${r.status}`);
  return { url: j.url, providerRef: j.id };
}

async function stripeVerify(sessionId) {
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripeKey()}` },
  });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.payment_status === 'paid';
}

/* ------------------------------ Paystack ------------------------------ */
const paystackKey = () => process.env.PAYSTACK_SECRET_KEY || '';
function paystackConfigured() { return !!paystackKey(); }

// Paystack settles in the merchant account's own currency (e.g. KES for a Kenyan
// account). Pass the already-converted local amount + currency; falls back to USD.
async function paystackCreate({ amountUSD, amountMajor, currency, email, ref, returnUrl }) {
  const cur = (currency || 'USD').toUpperCase();
  const amt = amountMajor != null ? amountMajor : amountUSD;
  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${paystackKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email || 'investor@gweno.app',
      amount: cents(amt),   // subunit (e.g. cents for the account currency)
      currency: cur,
      reference: ref,
      callback_url: returnUrl,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status || !j.data || !j.data.authorization_url) {
    throw new Error((j && j.message) || `Paystack HTTP ${r.status}`);
  }
  return { url: j.data.authorization_url, providerRef: j.data.reference || ref };
}

async function paystackVerify(reference) {
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${paystackKey()}` },
  });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.status && j.data && j.data.status === 'success';
}

/* ------------------------------ PayPal ------------------------------ */
const paypalEnv = () => (String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live'
  ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
function paypalConfigured() { return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET); }

async function paypalToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const r = await fetch(`${paypalEnv()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || `PayPal auth HTTP ${r.status}`);
  return j.access_token;
}

async function paypalCreate({ amountUSD, ref, returnUrl, cancelUrl }) {
  const t = await paypalToken();
  const r = await fetch(`${paypalEnv()}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: ref, amount: { currency_code: 'USD', value: (Number(amountUSD) || 0).toFixed(2) } }],
      application_context: { brand_name: 'Gweno', user_action: 'PAY_NOW', return_url: returnUrl, cancel_url: cancelUrl },
    }),
  });
  const j = await r.json().catch(() => ({}));
  const approve = (j.links || []).find((l) => l.rel === 'approve');
  if (!r.ok || !j.id || !approve) throw new Error((j && j.message) || `PayPal HTTP ${r.status}`);
  return { url: approve.href, providerRef: j.id };
}

// On return, capture the order; treat COMPLETED as paid.
async function paypalVerify(orderId) {
  const t = await paypalToken();
  const r = await fetch(`${paypalEnv()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.status === 'COMPLETED') return true;
  // Already captured earlier? Fall back to reading the order status.
  const g = await fetch(`${paypalEnv()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  const gj = await g.json().catch(() => ({}));
  return g.ok && gj.status === 'COMPLETED';
}

// method -> unified create/verify (Card is processed by Stripe)
async function createCheckout(method, args) {
  if (method === 'Stripe' || method === 'Card') return stripeCreate(args);
  if (method === 'Paystack') return paystackCreate(args);
  if (method === 'PayPal') return paypalCreate(args);
  throw new Error('Unsupported payment method.');
}
async function verify(method, providerRef) {
  if (method === 'Stripe' || method === 'Card') return stripeVerify(providerRef);
  if (method === 'Paystack') return paystackVerify(providerRef);
  if (method === 'PayPal') return paypalVerify(providerRef);
  return false;
}

module.exports = {
  stripeConfigured, paypalConfigured, paystackConfigured,
  createCheckout, verify,
};
