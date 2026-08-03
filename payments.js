/**
 * M-Pesa (Safaricom Daraja) integration — the only payment provider.
 *   - Deposits  : STK Push (Lipa na M-Pesa Online) — prompts the user's phone.
 *   - Withdrawals: B2C — pays KES from the business shortcode to a phone.
 *
 * Credentials come from environment variables (see .env.example). When a flow
 * isn't configured, server.js falls back to a clearly-labelled demo transaction.
 * Uses Node's global fetch (Node 18+).
 */

const CFG = {
  env: (process.env.MPESA_ENV || 'sandbox').toLowerCase(),
  key: process.env.MPESA_CONSUMER_KEY,
  secret: process.env.MPESA_CONSUMER_SECRET,
  // B2C (withdrawals)
  shortcode: process.env.MPESA_SHORTCODE,
  initiator: process.env.MPESA_INITIATOR_NAME,
  securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
  resultUrl: process.env.MPESA_RESULT_URL,
  timeoutUrl: process.env.MPESA_TIMEOUT_URL,
  commandId: process.env.MPESA_COMMAND_ID || 'BusinessPayment',
  // STK Push (deposits)
  stkShortcode: process.env.MPESA_STK_SHORTCODE,          // BusinessShortCode (paybill, or Buy Goods store/HO number)
  stkTill: process.env.MPESA_STK_TILL,                    // Buy Goods only: PartyB (the till). Defaults to the shortcode for paybills.
  stkTransactionType: process.env.MPESA_STK_TRANSACTION_TYPE || 'CustomerPayBillOnline', // or CustomerBuyGoodsOnline
  passkey: process.env.MPESA_PASSKEY,
  stkCallbackUrl: process.env.MPESA_STK_CALLBACK_URL,
};

const base = () => (CFG.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

// Withdrawals (B2C) ready? Result/timeout URLs are auto-derived by the server, so
// they aren't required here — only the core Daraja credentials are.
function mpesaConfigured() {
  return !!(CFG.key && CFG.secret && CFG.shortcode && CFG.initiator && CFG.securityCredential);
}
// Deposits (STK) ready? The callback URL is auto-derived, so it isn't required here.
function mpesaStkConfigured() {
  return !!(CFG.key && CFG.secret && CFG.stkShortcode && CFG.passkey);
}

// Normalise a Kenyan number to 2547XXXXXXXX / 2541XXXXXXXX.
function normalizePhone(p) {
  let s = String(p || '').replace(/\D/g, '');
  if (s.startsWith('0')) s = '254' + s.slice(1);
  else if (s.startsWith('7') || s.startsWith('1')) s = '254' + s;
  else if (s.startsWith('2540')) s = '254' + s.slice(4);
  return s;
}

function stkTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function token() {
  const auth = Buffer.from(`${CFG.key}:${CFG.secret}`).toString('base64');
  const r = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!r.ok) throw new Error(`M-Pesa auth HTTP ${r.status}`);
  const j = await r.json();
  if (!j.access_token) throw new Error('M-Pesa auth: no access_token');
  return j.access_token;
}

// ---- Deposits: STK Push ----
async function mpesaStkPush({ phone, amount, accountRef = 'Gweno', description = 'Wallet top-up', callbackUrl }) {
  const cbUrl = callbackUrl || CFG.stkCallbackUrl;
  if (!cbUrl) throw new Error('M-Pesa STK callback URL is not configured.');
  const t = await token();
  const ts = stkTimestamp();
  const sc = CFG.stkShortcode;                 // BusinessShortCode (paybill, or Buy Goods store/HO)
  const partyB = CFG.stkTill || sc;            // PartyB: the till for Buy Goods; same as sc for a paybill
  const password = Buffer.from(sc + CFG.passkey + ts).toString('base64');
  const body = {
    BusinessShortCode: sc,
    Password: password,
    Timestamp: ts,
    TransactionType: CFG.stkTransactionType,   // CustomerPayBillOnline or CustomerBuyGoodsOnline
    Amount: Math.round(amount),
    PartyA: normalizePhone(phone),
    PartyB: partyB,
    PhoneNumber: normalizePhone(phone),
    CallBackURL: cbUrl,
    AccountReference: accountRef,
    TransactionDesc: description,
  };
  const r = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errorCode || j.ResponseCode !== '0') {
    throw new Error(j.errorMessage || j.ResponseDescription || `STK push HTTP ${r.status}`);
  }
  return { checkoutRequestId: j.CheckoutRequestID, merchantRequestId: j.MerchantRequestID, customerMessage: j.CustomerMessage };
}

// ---- Withdrawals: B2C ----
async function mpesaB2C({ phone, amount, remarks = 'Gweno payout', resultUrl, timeoutUrl }) {
  const rUrl = resultUrl || CFG.resultUrl;
  const tUrl = timeoutUrl || CFG.timeoutUrl;
  if (!rUrl || !tUrl) throw new Error('M-Pesa B2C result/timeout URLs are not configured.');
  const t = await token();
  const body = {
    InitiatorName: CFG.initiator,
    SecurityCredential: CFG.securityCredential,
    CommandID: CFG.commandId,
    Amount: Math.round(amount),
    PartyA: CFG.shortcode,
    PartyB: normalizePhone(phone),
    Remarks: remarks,
    QueueTimeOutURL: tUrl,
    ResultURL: rUrl,
    Occasion: 'Redeem',
  };
  const r = await fetch(`${base()}/mpesa/b2c/v1/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errorCode) throw new Error(j.errorMessage || j.ResponseDescription || `M-Pesa B2C HTTP ${r.status}`);
  return {
    conversationId: j.ConversationID,
    originatorConversationId: j.OriginatorConversationID,
    responseDescription: j.ResponseDescription,
  };
}

// Diagnostics: attempt an OAuth token so the admin can see whether the credentials
// and environment (sandbox vs production) are correct — without exposing any secret.
async function mpesaOAuthTest() {
  try { const t = await token(); return { ok: true, tokenPreview: t ? t.slice(0, 6) + '…' : null }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

module.exports = { mpesaConfigured, mpesaStkConfigured, mpesaStkPush, mpesaB2C, mpesaOAuthTest, normalizePhone, CFG };
